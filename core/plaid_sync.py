"""
core/plaid_sync.py — the Plaid sync engine: pulls transactions/accounts for
one item and reconciles them into the DB. Deliberately shared, not owned by
routers/plaid_routes.py alone — called by 4 plaid routes *and* by
routers/accounts.py's (not yet split) reset-and-resync endpoint and the
still-unassigned /api/reset-all, matching the _compute_ecosystem_balance()
precedent from the original core/ scoping: a function two not-yet-siblinged
call sites both need goes to core/, not to whichever router happened to move
first.

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
import asyncio
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from database import (
    SessionLocal, Account, BalanceObservation, CategorizationRule,
    MerchantPointsMapping, PlaidItem, Transaction,
)
from categorization import CategorizationEngine, compute_needs_review
from plaid.exceptions import ApiException as PlaidApiException
from plaid_integration import setup_plaid_from_env

from core.accounts_helpers import (
    _account_hash, _assign_content_hash, _content_base_hash,
    _ensure_cards_for_new_accounts, _refresh_current_month_snapshot,
    _sign_plaid_balance, get_account_balance,
)
from core.points_engine import _lock_points_for_transaction, _resolve_merchant_csc, infer_points_category

logger = logging.getLogger('moresheth')

PLAID_TYPE_FALLBACK = {
    'depository':  'checking',
    'credit':      'credit card',
    'investment':  'investment',
    'loan':        'loan',
}

_PLAID_PFC_MAP: dict[str, tuple[str, str]] = {
    'INCOME':                    ('Work',            'Income'),
    'TRANSFER_IN':               ('Transfer',        'Transfer'),
    'TRANSFER_OUT':              ('Transfer',        'Transfer'),
    'CREDIT_CARD_PAYMENT':       ('Transfer',        'Transfer'),
    'LOAN_PAYMENTS':             ('Fees & Interest', 'Expense'),
    'BANK_FEES':                 ('Fees & Interest', 'Expense'),
    'FOOD_AND_DRINK':            ('Dining',          'Expense'),
    'GROCERIES':                 ('Groceries',       'Expense'),
    'TRANSPORTATION':            ('Transportation',  'Expense'),
    'TRAVEL':                    ('Travel',          'Expense'),
    'ENTERTAINMENT':             ('Entertainment',   'Expense'),
    'PERSONAL_CARE':             ('Self Care',       'Expense'),
    'MEDICAL':                   ('Healthcare',      'Expense'),
    'RENT_AND_UTILITIES':        ('Utilities',       'Expense'),
    'HOME_IMPROVEMENT':          ('Home',            'Expense'),
    'GENERAL_MERCHANDISE':       ('Other',           'Expense'),
    'GENERAL_SERVICES':          ('Other',           'Expense'),
    'GOVERNMENT_AND_NON_PROFIT': ('Other',           'Expense'),
    'EDUCATION':                 ('Education',       'Expense'),
}

async def _sync_item(plaid_item: PlaidItem, plaid, db: Session) -> int:
    """Sync transactions for a single PlaidItem. Returns count of new transactions added."""
    categorizer = CategorizationEngine(db)
    total_added = 0

    # Pass None if cursor is empty/missing — Plaid requires None for initial sync
    cursor = plaid_item.cursor if plaid_item.cursor else None
    # Run blocking Plaid I/O in a thread pool so the uvicorn event loop
    # stays responsive — without this, Gunicorn kills the worker after 30s.
    result = await asyncio.to_thread(
        plaid.sync_transactions,
        plaid_item.access_token,
        cursor,
    )

    # Pre-load rules with notes for GCB/points tagging
    rules_with_notes = db.query(CategorizationRule).filter(
        CategorizationRule.is_active == True,
        CategorizationRule.notes != None,
        CategorizationRule.notes != '',
    ).all()

    # Pre-load user-taught merchant → CSC mappings (checked before hardcoded patterns)
    _mpm_rows = db.query(MerchantPointsMapping).all()
    # Tuples: (pattern_lower, category_name, card_id, network)
    _mpm_lookup: list[tuple[str, str, int | None, str | None]] = [
        (m.merchant_pattern.lower(), m.points_category.name, m.card_id, m.network)
        for m in _mpm_rows
        if m.points_category
    ]

    skipped = 0
    errors  = 0
    # Track DB row IDs matched via content_hash this sync so each row is
    # only adopted once (handles multiple identical transactions on the same day).
    content_matched_ids: set = set()

    for txn_data in result['added']:
        sp = db.begin_nested()  # savepoint — so a single-row failure only rolls back that row
        try:
            existing = db.query(Transaction).filter_by(
                plaid_transaction_id=txn_data['plaid_transaction_id']
            ).first()
            if existing:
                if not existing.is_locked:
                    existing.merchant_name = txn_data.get('merchant_name') or existing.merchant_name
                # If Plaid previously removed this txn and we soft-deleted it,
                # re-enable it now that Plaid is re-sending it as "added".
                if existing.is_excluded:
                    existing.is_excluded  = False
                    existing.needs_review = False
                # Backfill content_hash if this row predates the feature
                if not existing.content_hash:
                    existing.content_hash = _assign_content_hash(
                        db, existing.account_id, existing.date,
                        existing.amount, existing.description_raw
                    )
                # CRITICAL: always close the savepoint before continue.
                # Without this, every iteration leaks a nested SQLAlchemy
                # subtransaction. After thousands of iterations (Chase full
                # re-download) db.commit() recurses 1000+ frames → RecursionError.
                sp.commit()
                continue

            # Skip pending transactions (holds/authorizations not yet posted) — they distort balances
            if txn_data.get('pending'):
                sp.rollback()
                skipped += 1
                continue

            account = db.query(Account).filter_by(
                plaid_account_id=txn_data['plaid_account_id']
            ).first()
            if not account:
                logger.info(f"[sync] skipping txn — no account for plaid_account_id={txn_data['plaid_account_id']}")
                skipped += 1
                sp.rollback()  # close savepoint before continue (nothing to keep)
                continue

            # ── Content-hash fallback (re-link survivor) ──────────────────────
            # plaid_transaction_id didn't match — Plaid regenerated IDs (re-link).
            # Try to find the existing row by content hash so we preserve all
            # user work (category, notes, locks) and just adopt the new Plaid ID.
            txn_amount  = -txn_data['amount']
            txn_date    = txn_data['date']
            base_hash   = _content_base_hash(account.id, txn_date, txn_amount, txn_data['description_raw'])
            # Avoid SQLAlchemy's notin_() with a large set — it builds a recursive
            # Python expression tree that exceeds Python's recursion limit (~1000)
            # when content_matched_ids grows large (e.g. Chase full-history re-download).
            # Instead: fetch all rows sharing this base hash (typically 0-3 rows)
            # and exclude already-matched IDs in Python.
            hash_candidates = (
                db.query(Transaction)
                .filter(Transaction.content_hash.like(f'{base_hash}-%'))
                .order_by(Transaction.content_hash)  # lowest suffix first → stable ordering
                .all()
            )
            hash_match = next(
                (r for r in hash_candidates if r.id not in content_matched_ids),
                None,
            )
            if hash_match:
                # Adopt the new Plaid ID — all user classifications are preserved
                hash_match.plaid_transaction_id = txn_data['plaid_transaction_id']
                content_matched_ids.add(hash_match.id)
                logger.info(f"[sync] content-hash match: adopted new plaid_id for '{hash_match.description_raw[:40]}'")
                sp.commit()
                continue  # do NOT insert a duplicate row

            # Resolve card_id from account→card FK (set via match-accounts flow)
            linked_card_id = account.card.id if account.card else None

            # Normalize sign: Plaid sends expenses as positive, we store as negative
            amount = -txn_data['amount']

            action, category, confidence, display_desc = categorizer.categorize(
                txn_data['description_raw'],
                amount,
                txn_data.get('merchant_name'),
                account_type=account.account_type or '',
            )

            # Apply GCB / For Others auto-tag and points category from rule notes
            desc_upper = txn_data['description_raw'].upper()
            gcb_auto        = False
            for_others_auto = False
            points_cat = None
            for rule in rules_with_notes:
                if rule.pattern and rule.pattern.upper() in desc_upper:
                    if 'gcb:true' in rule.notes:
                        gcb_auto = True
                    if 'for_others:true' in rule.notes:
                        for_others_auto = True
                    if 'points:' in rule.notes:
                        points_cat = rule.notes.split('points:')[1].split(',')[0].strip()

            # Check user-taught merchant → CSC mappings first (highest priority
            # after explicit rule notes), then fall back to hardcoded patterns.
            if not points_cat and txn_data.get('merchant_name') and _mpm_lookup:
                points_cat = _resolve_merchant_csc(
                    _mpm_lookup, txn_data['merchant_name'],
                    linked_card_id, account.card.network if account.card else None,
                )

            # Auto-infer points category from merchant name + Plaid PFC when
            # no categorization rule provided one explicitly.
            if not points_cat:
                points_cat = infer_points_category(
                    txn_data.get('merchant_name'),
                    txn_data.get('pfc_detailed'),
                    txn_data.get('pfc_primary'),
                )

            txn_date = txn_data['date']

            # ── Plaid PFC fallback: when rules leave category as Unclassified ────
            # personal_finance_category is Plaid's deterministic hierarchical taxonomy.
            # Only trust it when Plaid reports HIGH or VERY_HIGH confidence.
            pfc_applied = False
            if category == 'Unclassified':
                _pfc_primary = txn_data.get('pfc_primary')
                _pfc_conf    = txn_data.get('pfc_confidence', '')
                if _pfc_primary and _pfc_conf in ('VERY_HIGH', 'HIGH'):
                    _pfc_result = _PLAID_PFC_MAP.get(_pfc_primary)
                    if _pfc_result:
                        category   = _pfc_result[0]
                        action     = _pfc_result[1]
                        confidence = 0.72   # trustworthy but below a matched rule (0.85)
                        pfc_applied = True

            # ── Auto-LLM when no rule produced a useful result ───────────────────
            llm_source = None
            llm_description_clean = display_desc or categorizer.clean_description(txn_data['description_raw'])
            llm_merchant = txn_data.get('merchant_name')
            # categorize() already clears category to '' for action=='Transfer';
            # the Plaid-PFC fallback above only ever fires when category was
            # 'Unclassified', which a Transfer's '' never is — so category is
            # already correct here without re-checking action.
            llm_category = category

            # Skip LLM during background sync — each Claude call is 1-3s synchronous HTTP,
            # so 100 transactions × 2s = 3+ minutes, which kills the Gunicorn worker.
            # Transactions flagged needs_review=True will surface in the review queue
            # where the user (or a dedicated enrichment job) can enrich them on-demand.
            needs_llm = False

            if llm_source:
                final_source = llm_source
            elif pfc_applied:
                final_source = 'plaid_pfc'
            elif display_desc or (category and category != 'Unclassified'):
                final_source = 'rule'
            else:
                final_source = 'fallback'

            needs_review_flag = compute_needs_review(action, category, confidence, final_source)

            new_txn = Transaction(
                plaid_transaction_id=txn_data['plaid_transaction_id'],
                account_id=account.id,
                date=txn_date,
                amount=amount,
                description_raw=txn_data['description_raw'],
                description_clean=llm_description_clean,
                merchant_name=llm_merchant,
                action=action,
                category_auto=llm_category,
                category_confidence=confidence,
                needs_review=needs_review_flag,
                enrichment_source=final_source,
                card_id=linked_card_id,
                is_gcb=gcb_auto,
                gcb_tagged=gcb_auto,
                is_for_others=for_others_auto,
                points_category=points_cat,
                content_hash=_assign_content_hash(db, account.id, txn_date, amount, txn_data['description_raw']),
                year=txn_date.year,
                month=txn_date.month,
                day=txn_date.day,
            )
            db.add(new_txn)
            db.flush()   # catch constraint errors per-transaction, not at batch commit
            _lock_points_for_transaction(db, new_txn)
            sp.commit()  # release savepoint — this row is now safe in the outer transaction
            total_added += 1

        except Exception as txn_err:
            sp.rollback()  # roll back only THIS row — previously flushed rows are unaffected
            errors += 1
            logger.info(f"[sync] failed txn {txn_data.get('plaid_transaction_id','?')}: {txn_err}")

    if skipped:
        logger.info(f"[sync] {plaid_item.institution_name}: {skipped} transaction(s) skipped — no matching account")
    if errors:
        logger.error(f"[sync] {plaid_item.institution_name}: {errors} transaction(s) failed to write")

    # ── Handle modified transactions ─────────────────────────────────────────
    # Plaid sends updated metadata (date shift, merchant enrichment, amount
    # correction) in the 'modified' list.  We update unlocked transactions only —
    # locked ones represent a manual override that should be preserved.
    modified_count = 0
    modified_errors = 0
    for txn_data in result.get('modified', []):
        try:
            existing = db.query(Transaction).filter_by(
                plaid_transaction_id=txn_data['plaid_transaction_id']
            ).first()
            if not existing or existing.is_locked:
                continue
            new_amount = -txn_data['amount']
            new_date   = txn_data['date']
            existing.date          = new_date
            existing.year          = new_date.year
            existing.month         = new_date.month
            existing.day           = new_date.day
            existing.amount        = new_amount
            existing.merchant_name = txn_data.get('merchant_name') or existing.merchant_name
            _lock_points_for_transaction(db, existing)
            modified_count += 1
        except Exception as mod_err:
            modified_errors += 1
            logger.error(f"[sync] {plaid_item.institution_name}: failed to apply modified txn {txn_data.get('plaid_transaction_id','?')}: {mod_err}")
    if modified_count:
        logger.info(f"[sync] {plaid_item.institution_name}: {modified_count} transaction(s) updated (Plaid modified)")
    if modified_errors:
        logger.info(f"[sync] {plaid_item.institution_name}: {modified_errors} modified transaction(s) failed")

    # ── Handle removed transactions ───────────────────────────────────────────
    # Plaid removes a transaction when: a date/ID changes on settlement, a
    # pending txn is cancelled, or bank data is corrected.  Since we never
    # import pending transactions, every txn in our DB is already posted.
    # Hard-deleting posted transactions is too aggressive — Plaid often removes
    # a settled txn and re-adds it with a new ID when the date is adjusted.
    # Instead we SOFT-DELETE (is_excluded=True + flag in description_clean) so
    # the user can see and recover them.  Locked transactions are never touched.
    removed_count  = 0
    removed_errors = 0
    locked_skipped = 0
    for plaid_id in result.get('removed', []):
        try:
            existing = db.query(Transaction).filter_by(plaid_transaction_id=plaid_id).first()
            if not existing:
                continue
            if existing.is_locked:
                locked_skipped += 1
                logger.info(f"[sync] skipping removal of locked txn {plaid_id} — user manually confirmed")
                continue
            # Soft-delete: exclude from all views but keep the row in the DB
            existing.is_excluded = True
            existing.needs_review = False
            note = " [removed by Plaid — may reappear with a new ID]"
            if existing.description_clean and note not in existing.description_clean:
                existing.description_clean = existing.description_clean + note
            _lock_points_for_transaction(db, existing)
            removed_count += 1
            logger.info(f"[sync] soft-deleted txn {plaid_id} ({existing.description_raw}) — excluded, not hard-deleted")
        except Exception as rem_err:
            removed_errors += 1
            logger.error(f"[sync] {plaid_item.institution_name}: failed to process removed txn {plaid_id}: {rem_err}")
    if removed_count:
        logger.info(f"[sync] {plaid_item.institution_name}: {removed_count} transaction(s) soft-deleted (Plaid removed)")
    if removed_errors:
        logger.info(f"[sync] {plaid_item.institution_name}: {removed_errors} removed transaction(s) failed")
    if locked_skipped:
        logger.info(f"[sync] {plaid_item.institution_name}: {locked_skipped} locked transaction(s) NOT removed — review manually")

    # Store cursor — use None instead of empty string for clean state
    plaid_item.cursor         = result['next_cursor'] or None
    plaid_item.last_synced_at = datetime.utcnow()
    try:
        db.commit()
    except Exception as commit_err:
        # Commit failed — this is the exception that will propagate to
        # _sync_item_background's except-handler and be stored on the item.
        logger.info(f"[sync] {plaid_item.institution_name}: final commit failed: {commit_err}")
        db.rollback()
        raise
    return total_added

async def _sync_item_background(item_id: str, clear_cursor: bool = False):
    """Run a sync for a single item in the background with its own DB session."""
    db = SessionLocal()
    try:
        plaid = setup_plaid_from_env()
        item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
        if not item:
            return
        if clear_cursor:
            # Re-fetch accounts from Plaid so nothing gets silently skipped
            try:
                accounts = plaid.get_accounts(item.access_token)
                newly_created_accounts = []
                for a in accounts:
                    raw_subtype  = (a.get('subtype') or '').lower().strip()
                    raw_type     = (a.get('type') or '').lower().strip()
                    account_type = raw_subtype or PLAID_TYPE_FALLBACK.get(raw_type, raw_type) or 'other'

                    existing = db.query(Account).filter_by(plaid_account_id=a['account_id']).first()

                    # Fallback dedup for re-linked institutions
                    if not existing and a.get('mask'):
                        existing = (db.query(Account)
                            .join(PlaidItem, Account.plaid_item_id == PlaidItem.item_id)
                            .filter(
                                Account.mask == a['mask'],
                                Account.account_type == account_type,
                                PlaidItem.institution_name == item.institution_name,
                            ).first())

                    if existing:
                        existing.plaid_account_id = a['account_id']
                        existing.plaid_item_id    = item_id
                        existing.is_active        = True
                    else:
                        new_acct = Account(
                            plaid_account_id=a['account_id'],
                            plaid_item_id=item_id,
                            account_name=f"{a['name']} {a.get('mask','') or ''}".strip(),
                            account_type=account_type,
                            official_name=a.get('official_name'),
                            mask=a.get('mask'),
                            is_active=True,
                        )
                        db.add(new_acct)
                        newly_created_accounts.append(new_acct)
                db.commit()
                logger.info(f"[sync] {item.institution_name}: {len(accounts)} account(s) reconciled")
                try:
                    _ensure_cards_for_new_accounts(db, newly_created_accounts, item.institution_name)
                except Exception as card_err:
                    logger.warning(f"[sync] auto Card-row creation failed for {item_id}: {card_err}")
            except Exception as acc_err:
                logger.error(f"[sync] account refresh failed for {item_id}: {acc_err}")
            item.cursor = None
            db.commit()
        added = await _sync_item(item, plaid, db)
        logger.info(f"[sync] {item.institution_name}: {added} transaction(s) added")
        # Clear any previous error now that sync succeeded
        if item.last_error_code:
            item.last_error_code    = None
            item.last_error_message = None
            item.last_error_at      = None
            db.commit()
        # Refresh current-month balance snapshots for all accounts in this item
        item_accounts = db.query(Account).filter_by(plaid_item_id=item_id, is_active=True).all()
        for acct in item_accounts:
            _refresh_current_month_snapshot(db, acct.id)
        if item_accounts:
            db.commit()

        # ── Record balance observations ──────────────────────────────────────
        # Capture Plaid's reported balance for each account in this item.
        # Used as self-correcting anchors for daily balance calculations.
        try:
            plaid_accts = plaid.get_accounts(item.access_token)
            plaid_bal_map = {}
            for pa in plaid_accts:
                bal = pa.get('balance')
                if bal is not None:
                    plaid_bal_map[pa['account_id']] = bal
            for acct in item_accounts:
                raw_bal = plaid_bal_map.get(acct.plaid_account_id)
                if raw_bal is not None:
                    signed_bal = _sign_plaid_balance(raw_bal, acct.account_type)
                    computed   = get_account_balance(db, acct.id)
                    db.add(BalanceObservation(
                        account_id=acct.id,
                        observed_at=datetime.utcnow(),
                        plaid_balance=round(signed_bal, 4),
                        computed_balance=round(computed, 2),
                        delta=round(signed_bal - computed, 2),
                        source='sync',
                    ))
            db.commit()
            logger.info(f"[sync] {item.institution_name}: balance observations recorded")
        except Exception as obs_err:
            logger.info(f"[sync] {item.institution_name}: balance observation failed: {obs_err}")
    except PlaidApiException as e:
        # Structured Plaid error — extract code and store for UI display
        import traceback; traceback.print_exc()
        try:
            import json as _json
            body = _json.loads(e.body) if isinstance(e.body, str) else (e.body or {})
            err_code = body.get('error_code') or 'PLAID_ERROR'
            err_msg  = body.get('display_message') or body.get('error_message') or str(e)
        except Exception:
            err_code = 'PLAID_ERROR'
            err_msg  = str(e)
        logger.info(f"[sync] {item_id} Plaid error {err_code}: {err_msg}")

        # Cursor-reset errors: Plaid requires us to start from scratch.
        # Reset cursor and retry once immediately — no user action needed.
        CURSOR_RESET_CODES = {
            'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
            'INVALID_CURSOR',
        }
        if err_code in CURSOR_RESET_CODES and item and not clear_cursor:
            logger.info(f"[sync] {item.institution_name}: {err_code} — resetting cursor and retrying once")
            try:
                item.cursor = None
                item.last_error_code    = None
                item.last_error_message = None
                item.last_error_at      = None
                db.commit()
                # Immediate retry with clean cursor (clear_cursor=True skips here)
                added = await _sync_item(item, plaid, db)
                logger.info(f"[sync] {item.institution_name}: cursor-reset retry succeeded — {added} transaction(s) added")
                return
            except Exception as retry_err:
                logger.info(f"[sync] {item.institution_name}: cursor-reset retry also failed: {retry_err}")
                # Fall through to store the error below

        # Persist error on item so the UI can show a reconnect warning.
        # Rollback first — if we got here via a DB error, the session may be in
        # ROLLBACK_REQUIRED state and commit would silently fail without it.
        try:
            db.rollback()
            if item:
                item.last_error_code    = err_code
                item.last_error_message = err_msg
                if not item.last_error_at:   # Record when error first appeared
                    item.last_error_at = datetime.utcnow()
                db.commit()
        except Exception:
            logger.debug('Suppressed exception', exc_info=True)
    except Exception as e:
        import traceback; traceback.print_exc()
        err_type = type(e).__name__
        institution = getattr(item, 'institution_name', None) or item_id
        logger.error(f"[sync] {institution} background sync failed ({err_type}): {e}")
        # Store generic errors on the item so they appear in the health check.
        # Rollback first — a failed DB operation (e.g. constraint violation) leaves
        # the session in ROLLBACK_REQUIRED state; commit without rollback is a no-op.
        try:
            db.rollback()
            if item:
                item.last_error_code    = f'SYNC_ERROR:{err_type}'
                item.last_error_message = str(e)[:500]
                item.last_error_at      = item.last_error_at or datetime.utcnow()
                db.commit()
        except Exception as store_err:
            logger.info(f"[sync] {institution}: could not store error on item: {store_err}")
    finally:
        db.close()
