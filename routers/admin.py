"""
routers/admin.py — dangerous, cross-domain reset utilities that don't belong
to any single business domain (they touch accounts, transactions, and Plaid
items all at once). Not one of the originally-scoped router files — these two
routes (/api/reset-all, /api/nuke) were never assigned a home in the
PLAN.md router breakdown; grouped here rather than forced into accounts.py,
since neither is really "accounts" business logic.

Extracted from main.py (Phase 1 batch 2 of the backend token-usage refactor —
see PLAN.md "main.py -> domain routers split").
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from database import get_db, PlaidItem
from core.plaid_sync import _sync_item_background

logger = logging.getLogger('moresheth')

router = APIRouter()


@router.post("/api/reset-all")
async def reset_all(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Fresh start: wipe all Plaid-sourced transactions, delete ghost accounts
    (severed + no transactions), clear sync cursors, then trigger a full re-sync.

    Preserved: account records (names, types, starting balances, account_hash),
    categories, rules, card mappings, manual transactions.

    After this call, re-linking any bank will match existing accounts by
    account_hash — no duplicate accounts, no manual merging needed.
    """
    from sqlalchemy import text as _text

    # 1. Delete ghost accounts FIRST (while transaction counts are still accurate).
    #    Ghost = severed (no plaid_account_id), not manual, zero transactions.
    ghost_rows = db.execute(_text(
        "SELECT id FROM accounts "
        "WHERE plaid_account_id IS NULL AND is_manual = false "
        "AND id NOT IN (SELECT DISTINCT account_id FROM transactions WHERE account_id IS NOT NULL)"
    )).fetchall()
    ghost_ids = [r[0] for r in ghost_rows]
    if ghost_ids:
        ids_str = ','.join(str(i) for i in ghost_ids)
        db.execute(_text(f"DELETE FROM account_monthly_snapshots WHERE account_id IN ({ids_str})"))
        db.execute(_text(f"DELETE FROM accounts WHERE id IN ({ids_str})"))
    ghosts_deleted = len(ghost_ids)

    # 2. Delete all Plaid-sourced transactions (FK-safe order)
    db.execute(_text(
        "DELETE FROM user_corrections WHERE transaction_id IN "
        "(SELECT id FROM transactions WHERE plaid_transaction_id IS NOT NULL)"
    ))
    db.execute(_text(
        "DELETE FROM user_corrections WHERE transaction_id IN "
        "(SELECT id FROM transactions WHERE parent_transaction_id IN "
        "  (SELECT id FROM transactions WHERE plaid_transaction_id IS NOT NULL))"
    ))
    db.execute(_text(
        "DELETE FROM transaction_splits WHERE parent_transaction_id IN "
        "(SELECT id FROM transactions WHERE plaid_transaction_id IS NOT NULL)"
    ))
    db.execute(_text(
        "DELETE FROM transactions WHERE parent_transaction_id IN "
        "(SELECT id FROM transactions WHERE plaid_transaction_id IS NOT NULL)"
    ))
    txn_result = db.execute(_text(
        "DELETE FROM transactions WHERE plaid_transaction_id IS NOT NULL"
    ))
    txns_deleted = txn_result.rowcount

    # 3. Clear sync cursors so next sync re-fetches from the beginning
    items = db.query(PlaidItem).filter_by(is_active=True).all()
    for item in items:
        item.cursor = None

    db.commit()
    logger.info(f"[reset-all] {txns_deleted} transactions deleted, {ghosts_deleted} ghost accounts removed, {len(items)} cursors cleared")

    # 4. Trigger full re-sync for all active items
    for item in items:
        background_tasks.add_task(_sync_item_background, item.item_id, False)

    return {
        "transactions_deleted": txns_deleted,
        "ghost_accounts_deleted": ghosts_deleted,
        "syncs_started": len(items),
        "status": f"Fresh start — {txns_deleted} transactions cleared, {ghosts_deleted} ghost accounts removed. Re-syncing {len(items)} bank connection(s).",
    }

@router.post("/api/nuke")
async def nuke_everything(db: Session = Depends(get_db)):
    """
    Complete wipe: deletes every transaction, every account, and every Plaid
    connection. The database is left in a pristine state ready for fresh bank
    connections via Plaid Link.

    Preserved (no data lost):
      - Categories, categorization rules, budget targets
      - Cards (account_id nulled out — re-match after re-link)
      - Loans (account_id nulled out)
      - Manual transactions are wiped along with everything else
    """
    from sqlalchemy import text as _text

    # Null FKs on tables we're KEEPING before deleting what they point to
    db.execute(_text("UPDATE cards SET account_id = NULL, plaid_account_id = NULL, payment_account_id = NULL"))
    db.execute(_text("UPDATE loans SET account_id = NULL, payment_account_id = NULL"))
    # FK-safe deletion order
    db.execute(_text("DELETE FROM user_corrections"))
    db.execute(_text("DELETE FROM transaction_splits"))
    # transactions has a self-referential parent_transaction_id — delete children first
    db.execute(_text("DELETE FROM transactions WHERE parent_transaction_id IS NOT NULL"))
    db.execute(_text("DELETE FROM transactions"))
    db.execute(_text("DELETE FROM account_monthly_snapshots"))
    db.execute(_text("DELETE FROM duplicate_ignore"))   # table name has no trailing 's'
    db.execute(_text("DELETE FROM accounts"))
    db.execute(_text("DELETE FROM plaid_items"))
    db.commit()

    return {"status": "Clean slate — all accounts, transactions, and bank connections removed. Connect your banks fresh."}
