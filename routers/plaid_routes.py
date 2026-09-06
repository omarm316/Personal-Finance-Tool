"""
routers/plaid_routes.py — Plaid Link token creation, item/account linking,
sync triggers, diagnostics, and the account-recovery endpoint for bad merges.

The actual sync engine (_sync_item, _sync_item_background) lives in
core/plaid_sync.py, not here — it is also called by routers/accounts.py's
(not yet split) reset-and-resync endpoint and by /api/reset-all, still in
main.py, so it can't be owned by this router alone.

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
import logging
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from database import get_db, Account, Loan, PlaidItem, Transaction, TransactionSplit
from plaid_integration import setup_plaid_from_env

from core.accounts_helpers import _account_hash, _ensure_cards_for_new_accounts, _sign_plaid_balance, rebuild_monthly_snapshots
from core.app_helpers import _frontend_index
from core.plaid_sync import PLAID_TYPE_FALLBACK, _sync_item, _sync_item_background

logger = logging.getLogger('moresheth')

router = APIRouter()


class LinkTokenResponse(BaseModel):
    link_token: str

class PublicTokenExchange(BaseModel):
    public_token: str

@router.get("/plaid/oauth-return")
async def plaid_oauth_return():
    return FileResponse(_frontend_index(), media_type="text/html")

@router.get("/api/plaid/link-token", response_model=LinkTokenResponse)
async def create_link_token(request: Request, user_id: str = "default_user"):
    try:
        plaid = setup_plaid_from_env()
        # Build OAuth redirect URI from the incoming request so it works on
        # any deployment (localhost, Railway, custom domain, etc.)
        base_url = os.getenv("PLAID_REDIRECT_URI")
        if not base_url:
            scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
            host = request.headers.get("host", request.url.netloc)
            base_url = f"{scheme}://{host}/plaid/oauth-return"
        return {"link_token": plaid.create_link_token(user_id, redirect_uri=base_url)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/plaid/update-link-token/{item_id}")
async def create_update_link_token(item_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Create a Plaid Link token in *update mode* for an existing item.
    Used when an item has ITEM_LOGIN_REQUIRED — re-authenticates the same
    item in-place without changing the access_token or item_id.
    """
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        plaid_client = setup_plaid_from_env()
        base_url = os.getenv("PLAID_REDIRECT_URI")
        if not base_url:
            scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
            host = request.headers.get("host", request.url.netloc)
            base_url = f"{scheme}://{host}/plaid/oauth-return"
        access_token = item.access_token
        link_token = plaid_client.create_link_token(
            "default_user", redirect_uri=base_url, access_token=access_token
        )
        return {"link_token": link_token, "item_id": item_id,
                "institution_name": item.institution_name}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/plaid/update-complete/{item_id}")
async def plaid_update_complete(item_id: str, background_tasks: BackgroundTasks,
                                db: Session = Depends(get_db)):
    """
    Called after a successful Plaid Link update-mode flow.
    Clears the stored error, marks the item healthy, and kicks off a fresh sync.
    No public_token exchange is needed — the access_token is unchanged.

    clear_cursor=True is required here (not just for error-recovery): update
    mode is also how newly-selected accounts (account_selection_enabled) get
    added to an existing item, and only the clear_cursor branch of
    _sync_item_background reconciles Plaid's account list into new `Account`
    rows. Without it, a newly-added account has no `Account` row and every
    one of its transactions is silently skipped by `_sync_item` (no matching
    account_id).
    """
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.last_error_code    = None
    item.last_error_message = None
    item.last_error_at      = None
    db.commit()
    background_tasks.add_task(_sync_item_background, item_id, True)
    return {"message": f"{item.institution_name} reconnected — sync started",
            "institution_name": item.institution_name}

@router.post("/api/plaid/exchange-token")
async def exchange_public_token(data: PublicTokenExchange, db: Session = Depends(get_db)):
    """Exchange a Plaid public token for access token, create accounts, and sync transactions."""
    try:
        plaid        = setup_plaid_from_env()
        tokens       = plaid.exchange_public_token(data.public_token)
        access_token = tokens['access_token']
        item_id      = tokens['item_id']
        accounts     = plaid.get_accounts(access_token)

        # Create or update PlaidItem
        # Fetch institution info once — name (display) + institution_id (immutable, used for matching)
        inst_info = plaid.get_institution_info(access_token) or {}
        inst_name = inst_info.get('name') or (accounts[0]['name'].split(' ')[0] if accounts else 'Unknown')
        inst_id   = inst_info.get('institution_id')

        plaid_item = db.query(PlaidItem).filter_by(item_id=item_id).first()
        if plaid_item:
            plaid_item.access_token = access_token
            plaid_item.is_active    = True
            plaid_item.updated_at   = datetime.utcnow()
            # Always refresh canonical institution name and id from Plaid
            plaid_item.institution_name = inst_name
            if inst_id:
                plaid_item.institution_id = inst_id
        else:
            plaid_item = PlaidItem(
                item_id=item_id,
                institution_name=inst_name,
                institution_id=inst_id,
                is_active=True,
            )
            plaid_item.access_token = access_token
            db.add(plaid_item)

        db.flush()

        # ---------------------------------------------------------------------------
        # Account adoption — 4-step priority chain (most-reliable → least)
        #
        #  Step 1: persistent_account_id — stable across ALL re-links (Plaid-issued)
        #  Step 2: plaid_account_id      — same connection token reused (no re-link)
        #  Step 3: institution+mask+type — fallback for institutions without persistent IDs
        #  Step 4: no match             — create new account
        #
        # On adoption (steps 1-3): write plaid_account_id, plaid_item_id, persistent_account_id
        # and clear any stale holder of the same plaid_account_id first (UNIQUE safety).
        # ---------------------------------------------------------------------------
        account_results = []
        newly_created_accounts = []

        for a in accounts:
            # Prefer subtype (checking, savings, credit card) over type (depository, credit)
            raw_subtype  = (a.get('subtype') or '').lower().strip()
            raw_type     = (a.get('type') or '').lower().strip()
            account_type = raw_subtype or PLAID_TYPE_FALLBACK.get(raw_type, raw_type) or 'other'

            # Pre-compute the account_hash for this Plaid account using the
            # FRESH institution_id from Plaid (always reliable at exchange time).
            computed_hash = _account_hash(inst_id or '', a.get('mask') or '', account_type)

            existing = None

            # Step 1: match by persistent_account_id (survives every re-link, Plaid-issued)
            if a.get('persistent_account_id'):
                existing = (db.query(Account)
                    .filter(Account.persistent_account_id == a['persistent_account_id'],
                            Account.is_active == True)
                    .order_by(Account.id)
                    .first())

            # Step 2: match by current plaid_account_id (same token, no re-link needed)
            if not existing:
                existing = db.query(Account).filter_by(plaid_account_id=a['account_id']).first()

            # Step 2.5: match by account_hash — the primary re-link survivor key.
            # CRITICAL: only match UNLINKED accounts (plaid_account_id IS NULL).
            # If we matched a live account, we'd overwrite its Plaid ID, stealing
            # it from the account it belongs to. This is what caused the Amex 1008
            # collision: three cards share the same hash, so without this guard the
            # second and third would clobber the first.
            if not existing and inst_id and a.get('mask'):
                existing = (db.query(Account)
                    .filter(Account.account_hash == computed_hash,
                            Account.is_active == True,
                            Account.plaid_account_id == None)   # unlinked only
                    .order_by(Account.id)
                    .first())

            # Step 3: institution+mask+type JOIN — fallback for pre-hash accounts.
            # Same guard: only unlinked accounts are candidates.
            if not existing and a.get('mask'):
                base_filters = [
                    Account.mask == a['mask'],
                    Account.account_type == account_type,
                    Account.is_active == True,
                    Account.plaid_account_id == None,   # unlinked only
                ]
                if plaid_item.institution_id:
                    inst_match = or_(
                        PlaidItem.institution_id == plaid_item.institution_id,
                        and_(
                            Account.plaid_item_id == None,
                            Account.institution_id == plaid_item.institution_id,
                        ),
                    )
                else:
                    inst_match = or_(
                        PlaidItem.institution_name == plaid_item.institution_name,
                        Account.plaid_item_id == None,
                    )
                existing = (db.query(Account)
                    .outerjoin(PlaidItem, Account.plaid_item_id == PlaidItem.item_id)
                    .filter(*base_filters, inst_match)
                    .order_by(Account.id)
                    .first())

            if existing:
                # UNIQUE safety: clear any OTHER row that already holds this plaid_account_id
                db.query(Account).filter(
                    Account.plaid_account_id == a['account_id'],
                    Account.id != existing.id,
                ).update({'plaid_account_id': None}, synchronize_session=False)
                db.flush()

                # Adopt: update Plaid IDs so future transactions flow to the right account
                existing.plaid_account_id = a['account_id']
                existing.plaid_item_id    = item_id
                existing.is_active        = True
                if a.get('persistent_account_id'):
                    existing.persistent_account_id = a['persistent_account_id']
                if plaid_item.institution_id:
                    existing.institution_id = plaid_item.institution_id
                # Always refresh the account_hash — keeps it current
                existing.account_hash = computed_hash

                account_results.append({
                    "name": existing.account_name,
                    "mask": existing.mask,
                    "status": "matched",
                    "account_id": existing.id,
                })
            else:
                # Step 4: create new account
                # Use Plaid's current balance as the anchor so the balance engine
                # can compute accurate history immediately without a manual snapshot.
                plaid_balance = _sign_plaid_balance(a.get('balance'), raw_type)
                new_acct = Account(
                    plaid_account_id=a['account_id'],
                    persistent_account_id=a.get('persistent_account_id'),
                    institution_id=inst_id,
                    account_hash=computed_hash,
                    plaid_item_id=item_id,
                    account_name=f"{a['name']} {a.get('mask','')}".strip(),
                    account_type=account_type,
                    official_name=a.get('official_name'),
                    mask=a.get('mask'),
                    is_active=True,
                    starting_balance=plaid_balance or 0,
                    start_date=None,  # Legacy model: offset + all txns
                )
                db.add(new_acct)
                db.flush()
                newly_created_accounts.append(new_acct)

                account_results.append({
                    "name": new_acct.account_name,
                    "mask": new_acct.mask,
                    "status": "created",
                    "account_id": new_acct.id,
                })

        # Commit accounts first so sync failures don't lose the account link
        db.commit()

        # Auto-create the Card row each brand-new credit-card Account needs
        # (see B18) — failure here shouldn't block the account link/sync above.
        try:
            _ensure_cards_for_new_accounts(db, newly_created_accounts, plaid_item.institution_name)
        except Exception as card_err:
            logger.warning(f"[exchange-token] auto Card-row creation failed: {card_err}")

        # Sync transactions (separate step — errors here won't rollback accounts)
        synced = 0
        sync_error = None
        try:
            synced = await _sync_item(plaid_item, plaid, db)
        except Exception as sync_exc:
            import traceback; traceback.print_exc()
            sync_error = str(sync_exc)

        # Rebuild monthly snapshots for every account on this item so the
        # balance engine has accurate month-by-month history immediately.
        snapshot_errors = []
        for acct in db.query(Account).filter_by(plaid_item_id=item_id, is_active=True).all():
            try:
                rebuild_monthly_snapshots(db, acct.id)
            except Exception as snap_exc:
                snapshot_errors.append(f"acct {acct.id}: {snap_exc}")
        try:
            db.commit()
        except Exception:
            logger.exception('Unexpected error — rolling back')
            db.rollback()
        if snapshot_errors:
            logger.warning(f"[exchange-token] snapshot rebuild warnings: {snapshot_errors}")

        msg = f"Linked {len(accounts)} account(s) and synced {synced} transaction(s)"
        if sync_error:
            msg += f" (sync warning: {sync_error})"

        return {
            "message": msg,
            "item_id": item_id,
            "accounts": account_results,        # per-account outcome for post-link modal
            "accounts_linked": len(accounts),   # kept for backward compat
            "transactions_synced": synced,
        }

    except Exception as e:
        import traceback; traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/plaid/reset-stuck-cursors")
async def reset_stuck_cursors(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Alias for sync-transactions — kept for backward compatibility."""
    return await sync_all_transactions(background_tasks, db)

@router.post("/api/plaid/sync-transactions")
async def sync_all_transactions(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Unified smart sync — one endpoint that does everything:

    • Healthy items  → incremental sync from stored cursor (fast, only new txns)
    • Stuck items    → cursor reset first, then full re-download
      A "stuck" item is one that has a non-auth error stored OR has never synced.
      Cursor reset is safe — it just re-fetches from scratch, no data is lost.
    • Auth-error items (ITEM_LOGIN_REQUIRED etc.) → skipped; user must reconnect
      via Plaid Link before sync can proceed.

    Returns per-item status so the UI can report which accounts need attention.
    """
    AUTH_ERROR_CODES = {
        'ITEM_LOGIN_REQUIRED', 'INVALID_CREDENTIALS', 'INVALID_ACCESS_TOKEN',
        'USER_PERMISSION_REVOKED', 'ITEM_NOT_FOUND', 'ACCESS_NOT_GRANTED',
    }

    items = db.query(PlaidItem).filter_by(is_active=True).all()
    if not items:
        return {"message": "No connected accounts.", "items_queued": 0,
                "items_cursor_reset": 0, "items_errored": 0,
                "errored": [], "items": [], "status": "idle"}

    item_statuses = []
    queued         = 0
    cursor_resets  = 0
    errored        = []

    for item in items:
        if item.last_error_code and item.last_error_code in AUTH_ERROR_CODES:
            # Connection is broken at the Plaid level — only re-linking fixes this
            errored.append({"institution_name": item.institution_name,
                            "error_code": item.last_error_code})
            item_statuses.append({"institution_name": item.institution_name,
                                  "status": "skipped",
                                  "error_code": item.last_error_code})
        else:
            stuck = bool(item.last_error_code) or (item.last_synced_at is None)
            if stuck:
                # Clear bad cursor/error so the sync starts clean
                item.cursor             = None
                item.last_error_code    = None
                item.last_error_message = None
                item.last_error_at      = None
                cursor_resets += 1
                item_statuses.append({"institution_name": item.institution_name,
                                      "status": "queued", "cursor_reset": True})
                logger.info(f"[sync] {item.institution_name}: cursor reset (was stuck) — re-downloading")
            else:
                item_statuses.append({"institution_name": item.institution_name,
                                      "status": "queued", "cursor_reset": False})
            background_tasks.add_task(_sync_item_background, item.item_id, False)
            queued += 1

    db.commit()

    parts = []
    if queued:
        parts.append(f"Sync started for {queued} bank{'' if queued == 1 else 's'}")
    if cursor_resets:
        parts.append(f"{cursor_resets} re-downloading from scratch")
    if errored:
        names = ", ".join(e["institution_name"] for e in errored)
        parts.append(f"{len(errored)} need reconnecting ({names})")

    return {
        "message":            " — ".join(parts) or "Nothing to sync",
        "items":              item_statuses,
        "items_queued":       queued,
        "items_cursor_reset": cursor_resets,
        "items_errored":      len(errored),
        "errored":            errored,
        "status":             "started" if queued else "idle",
    }

@router.post("/api/plaid/items/{item_id}/deactivate")
async def deactivate_item(item_id: str, db: Session = Depends(get_db)):
    """Mark a stale PlaidItem as inactive so it no longer participates in syncs."""
    item = db.query(PlaidItem).filter_by(item_id=item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_active = False
    db.commit()
    return {"message": f"Deactivated {item.institution_name} ({item_id})"}

@router.delete("/api/plaid/items/{item_id}")
async def remove_plaid_item(item_id: str, db: Session = Depends(get_db)):
    """Deactivate a PlaidItem and delete any of its accounts that have 0 transactions."""
    item = db.query(PlaidItem).filter_by(item_id=item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    accounts = db.query(Account).filter_by(plaid_item_id=item_id).all()
    deleted_accounts = 0
    for account in accounts:
        txn_count = db.query(Transaction).filter_by(account_id=account.id).count()
        if txn_count == 0:
            db.delete(account)
            deleted_accounts += 1
        else:
            # Sever the Plaid link so the account survives without the item
            account.plaid_item_id = None
            account.plaid_account_id = None
            account.is_active = True
    db.delete(item)
    db.commit()
    return {
        "removed": True,
        "deleted_empty_accounts": deleted_accounts,
        "remaining_accounts": len(accounts) - deleted_accounts,
    }

@router.get("/api/plaid/item-status")
async def plaid_item_status(db: Session = Depends(get_db)):
    """
    Diagnostic endpoint: calls Plaid /item/get for every active PlaidItem and
    returns health info — error codes, last successful/failed update timestamps,
    consent expiration time, and update_type (background vs user_present).
    Use this to identify stale or broken Plaid connections (e.g. ITEM_LOGIN_REQUIRED).
    """
    plaid = setup_plaid_from_env()
    if plaid is None:
        return {"error": "Plaid not configured"}
    items = db.query(PlaidItem).filter_by(is_active=True).all()
    results = []
    for item in items:
        access_token = item.access_token
        status = plaid.get_item_status(access_token)
        results.append({
            "institution_name": item.institution_name,
            "item_id": item.item_id,
            "last_synced_at": item.last_synced_at.isoformat() if item.last_synced_at else None,
            # Internal sync error state — set when our own sync code fails (not a Plaid
            # connection error). Separate from the Plaid-side error returned above.
            "internal_error_code":    item.last_error_code,
            "internal_error_message": item.last_error_message,
            "internal_error_at":      item.last_error_at.isoformat() if item.last_error_at else None,
            **status,
        })
    # Sort: broken items first, then by institution name
    results.sort(key=lambda r: (r.get('ok', False), r.get('institution_name', '')))
    return results

@router.post("/api/plaid/sync-liabilities")
async def sync_liabilities(db: Session = Depends(get_db)):
    """
    Pull the Plaid Liabilities product for every active item and write
    liability details (minimum payment, next due date, APR, last statement
    balance, etc.) onto the matching Account rows.

    Also updates Loan.interest_rate for any Loan record whose account_id
    matches a mortgage or student-loan account returned by Plaid.

    Safe to call repeatedly — all writes are idempotent overwrites.
    Institutions that don't support the Liabilities product are skipped silently.
    """
    def _plaid_date(raw) -> Optional[datetime]:
        """Parse a Plaid date value (date object, datetime, or YYYY-MM-DD string)."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw
        try:
            from datetime import date as _date
            if isinstance(raw, _date):
                return datetime(raw.year, raw.month, raw.day)
        except Exception:
            logger.debug('Suppressed exception', exc_info=True)
        try:
            return datetime.strptime(str(raw)[:10], '%Y-%m-%d')
        except Exception:
            return None

    plaid = setup_plaid_from_env()
    items = db.query(PlaidItem).filter(PlaidItem.is_active.is_(True)).all()

    accounts_updated = 0
    loans_updated    = 0
    errors: list[str] = []

    for item in items:
        try:
            liab = plaid.get_liabilities(item.access_token)
        except Exception as e:
            errors.append(f"{item.institution_name or item.item_id}: {e}")
            continue

        # ── Credit cards ──────────────────────────────────────────────────────
        for cc in liab.get('credit') or []:
            acct = db.query(Account).filter_by(
                plaid_account_id=cc.get('account_id')
            ).first()
            if not acct:
                continue
            acct.liability_min_payment        = cc.get('minimum_payment_amount')
            acct.liability_next_due_date      = _plaid_date(cc.get('next_payment_due_date'))
            acct.liability_last_statement_bal = cc.get('last_statement_balance')
            acct.liability_last_payment       = cc.get('last_payment_amount')
            acct.liability_last_payment_date  = _plaid_date(cc.get('last_payment_date'))
            # Purchase APR (first match in aprs list)
            for apr in cc.get('aprs') or []:
                if apr.get('apr_type') == 'purchase_apr':
                    acct.liability_purchase_apr = apr.get('apr_percentage')
                    break
            accounts_updated += 1

        # ── Student loans ─────────────────────────────────────────────────────
        for sl in liab.get('student') or []:
            acct = db.query(Account).filter_by(
                plaid_account_id=sl.get('account_id')
            ).first()
            if not acct:
                continue
            acct.liability_min_payment        = sl.get('minimum_payment_amount')
            acct.liability_next_due_date      = _plaid_date(sl.get('next_payment_due_date'))
            acct.liability_last_statement_bal = sl.get('last_statement_balance')
            acct.liability_last_payment       = sl.get('last_payment_amount')
            acct.liability_last_payment_date  = _plaid_date(sl.get('last_payment_date'))
            accounts_updated += 1
            # Back-fill Loan.interest_rate if we have a linked Loan record
            rate = sl.get('interest_rate_percentage')
            if rate is not None:
                loan = db.query(Loan).filter_by(account_id=acct.id).first()
                if loan:
                    loan.interest_rate = rate
                    loans_updated += 1

        # ── Mortgages ─────────────────────────────────────────────────────────
        for mtg in liab.get('mortgage') or []:
            acct = db.query(Account).filter_by(
                plaid_account_id=mtg.get('account_id')
            ).first()
            if not acct:
                continue
            acct.liability_min_payment       = mtg.get('next_monthly_payment')
            acct.liability_next_due_date     = _plaid_date(mtg.get('next_payment_due_date'))
            acct.liability_last_payment      = mtg.get('last_payment_amount')
            acct.liability_last_payment_date = _plaid_date(mtg.get('last_payment_date'))
            accounts_updated += 1
            # Back-fill Loan interest rate
            ir = mtg.get('interest_rate') or {}
            rate = ir.get('percentage') if isinstance(ir, dict) else None
            if rate is not None:
                loan = db.query(Loan).filter_by(account_id=acct.id).first()
                if loan:
                    loan.interest_rate = rate
                    loans_updated += 1

    db.commit()
    return {
        "accounts_updated": accounts_updated,
        "loans_updated":    loans_updated,
        "items_processed":  len(items),
        "errors":           errors,
    }

@router.post("/api/plaid/reset-and-resync")
async def reset_and_resync(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Wipe all Plaid-sourced transactions and accounts, clear cursors, then resync from scratch."""
    # 1. Delete splits belonging to Plaid transactions
    plaid_txn_ids = [r[0] for r in db.query(Transaction.id).filter(Transaction.plaid_transaction_id != None).all()]
    if plaid_txn_ids:
        db.query(TransactionSplit).filter(TransactionSplit.parent_transaction_id.in_(plaid_txn_ids)).delete(synchronize_session=False)
    # 2. Delete Plaid transactions (keep manually-entered ones)
    deleted_txns = db.query(Transaction).filter(Transaction.plaid_transaction_id != None).delete(synchronize_session=False)
    # 3. Delete Plaid-linked accounts (keep manual accounts)
    db.query(Account).filter(Account.plaid_account_id != None).delete(synchronize_session=False)
    # 4. Clear all cursors
    items = db.query(PlaidItem).filter_by(is_active=True).all()
    for item in items:
        item.cursor = None
    db.commit()
    logger.warning(f"[reset] deleted {deleted_txns} Plaid transactions; starting fresh sync for {len(items)} item(s)")
    # 5. Resync all items (re-fetches accounts + transactions)
    for item in items:
        background_tasks.add_task(_sync_item_background, item.item_id, True)
    return {
        "message": f"Reset complete — deleted {deleted_txns} transactions. Resync started for {len(items)} bank(s).",
        "transactions_deleted": deleted_txns,
        "items": len(items),
        "status": "started",
    }

@router.get("/api/plaid/debug/{item_id}")
async def debug_plaid_item(item_id: str, db: Session = Depends(get_db)):
    """
    Diagnostic: calls Plaid directly and reports raw counts without writing anything to the DB.
    Tells you whether 0 transactions is a Plaid issue or a processing issue.
    """
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        plaid = setup_plaid_from_env()

        # Raw account IDs from Plaid
        plaid_accounts = plaid.get_accounts(item.access_token)
        plaid_account_ids = [a['account_id'] for a in plaid_accounts]

        # Account IDs we have in the DB for this item
        db_accounts = db.query(Account).filter_by(plaid_item_id=item_id, is_active=True).all()
        db_account_ids = [a.plaid_account_id for a in db_accounts]

        # One raw call to transactions/sync (no cursor = full history, read-only — cursor NOT saved)
        from plaid.model.transactions_sync_request import TransactionsSyncRequest
        response = plaid.client.transactions_sync(
            TransactionsSyncRequest(access_token=item.access_token)
        )
        raw_added    = len(response['added'])
        raw_modified = len(response['modified'])
        raw_removed  = len(response['removed'])
        has_more     = response['has_more']

        # Which transaction account IDs from Plaid match our DB accounts
        sample_txn_account_ids = list({t['account_id'] for t in response['added'][:50]})
        matched = [aid for aid in sample_txn_account_ids if aid in db_account_ids]
        unmatched = [aid for aid in sample_txn_account_ids if aid not in db_account_ids]

        return {
            "institution":         item.institution_name,
            "environment":         os.getenv('PLAID_ENV', 'sandbox'),
            "cursor_stored":       bool(item.cursor),
            "plaid_accounts":      plaid_account_ids,
            "db_accounts":         db_account_ids,
            "accounts_matched":    matched,
            "accounts_unmatched":  unmatched,
            "raw_added":           raw_added,
            "raw_modified":        raw_modified,
            "raw_removed":         raw_removed,
            "has_more_pages":      has_more,
            "diagnosis": (
                "Plaid returned 0 transactions — data may not be ready yet (normal for new OAuth connections; wait a few minutes and retry)"
                if raw_added == 0
                else f"Plaid has {raw_added} transactions but {len(unmatched)} account ID(s) in those transactions don't match the DB — those will be skipped"
                if unmatched
                else f"Plaid has {raw_added} transactions and all account IDs match — processing should work"
            ),
        }
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/plaid/items")
async def list_items(db: Session = Depends(get_db)):
    all_items = db.query(PlaidItem).order_by(PlaidItem.created_at.desc()).all()
    env = os.getenv('PLAID_ENV', 'sandbox')
    result = []
    for item in all_items:
        accounts = db.query(Account).filter_by(plaid_item_id=item.item_id, is_active=True).all()
        txn_count = db.query(Transaction).filter(
            Transaction.account_id.in_([a.id for a in accounts])
        ).count() if accounts else 0
        result.append({
            "item_id":            item.item_id,
            "institution_name":   item.institution_name,
            "last_synced_at":     item.last_synced_at,
            "created_at":         item.created_at,
            "is_active":          item.is_active,
            "account_count":      len(accounts),
            "accounts":           [{
                "id": a.id, "name": a.account_name, "type": a.account_type, "mask": a.mask,
                "start_date": a.start_date.strftime('%Y-%m-%d') if a.start_date else None,
                "anchor_age_days": (datetime.utcnow() - a.start_date).days if a.start_date else None,
                "starting_balance": a.starting_balance,
            } for a in accounts],
            "transaction_count":  txn_count,
            "has_cursor":         bool(item.cursor),
            "environment":        env,
            # Sync error state — set when Plaid returns an API error during sync
            "last_error_code":    item.last_error_code,
            "last_error_message": item.last_error_message,
            "last_error_at":      item.last_error_at.isoformat() if item.last_error_at else None,
        })
    return result

@router.patch("/api/plaid/items/{item_id}")
async def update_item(item_id: str, body: dict, db: Session = Depends(get_db)):
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if "institution_name" in body:
        name = str(body["institution_name"]).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        item.institution_name = name
    db.commit()
    return {"item_id": item.item_id, "institution_name": item.institution_name}

@router.post("/api/plaid/items/{item_id}/force-resync")
async def force_resync_item(item_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Clear the stored cursor and re-fetch all historical transactions in the background."""
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    background_tasks.add_task(_sync_item_background, item_id, True)
    return {"message": f"Resync started for {item.institution_name}", "status": "started"}

@router.post("/api/plaid/backfill-persistent-ids")
async def backfill_persistent_ids(db: Session = Depends(get_db)):
    """
    One-time backfill: for every active Plaid item, call Plaid's accounts API
    and write persistent_account_id onto any DB account that still has NULL.

    Matches Plaid accounts to DB rows via plaid_account_id (exact, fast).
    Updates only rows where persistent_account_id IS NULL so it is safe to
    re-run any number of times.

    Returns a per-institution summary and overall counts.
    """
    plaid  = setup_plaid_from_env()
    items  = db.query(PlaidItem).filter_by(is_active=True).all()

    total_updated   = 0
    total_no_pid    = 0   # Plaid returned None for persistent_account_id (institution doesn't support it)
    results         = []

    for item in items:
        item_updated  = 0
        item_skipped  = 0
        item_no_pid   = 0
        errors        = []

        try:
            plaid_accounts = plaid.get_accounts(item.access_token)
        except Exception as e:
            results.append({
                'institution': item.institution_name,
                'item_id': item.item_id,
                'error': str(e),
            })
            continue

        for pa in plaid_accounts:
            pid = pa.get('persistent_account_id')
            if not pid:
                item_no_pid += 1
                continue  # institution doesn't provide persistent IDs — nothing to write

            # Match DB account by plaid_account_id (fast & unambiguous)
            db_acct = (db.query(Account)
                .filter_by(plaid_account_id=pa['account_id'])
                .first())

            if not db_acct:
                item_skipped += 1
                continue  # account not in DB (probably was deleted or never adopted)

            if db_acct.persistent_account_id:
                item_skipped += 1
                continue  # already populated — skip

            db_acct.persistent_account_id = pid
            item_updated += 1

        db.commit()
        total_updated += item_updated
        total_no_pid  += item_no_pid

        results.append({
            'institution':  item.institution_name,
            'item_id':      item.item_id,
            'updated':      item_updated,
            'skipped':      item_skipped,
            'no_pid':       item_no_pid,   # Plaid returned None — institution limitation
        })

    return {
        'total_updated': total_updated,
        'total_no_pid':  total_no_pid,
        'items':         results,
    }

@router.post("/api/plaid/items/{item_id}/recover-accounts")
async def recover_plaid_accounts_for_item(item_id: str, db: Session = Depends(get_db)):
    """
    Recovery endpoint for when accounts were wrongly merged (e.g. bad merge of
    duplicate accounts scrambled plaid_account_ids).

    Algorithm:
    1. Fetch all accounts from Plaid for this item.
    2. For each Plaid account, match DB account by official_name + mask ONLY
       (plaid_account_id is unreliable after a bad merge — surviving accounts
       hold the wrong IDs absorbed from deleted duplicates).
    3. If found but plaid_account_id differs → mark for UPDATE.
    4. If not found → mark for CREATE.
    5. UPDATEs first (raw SQL, frees the old unique IDs), then CREATEs.
    6. Delete Plaid-sourced transactions from updated accounts (mixed up).
    7. Reset sync cursor for full re-sync.
    """
    import traceback as _tb
    from sqlalchemy import text as _text
    from sqlalchemy.exc import IntegrityError as _IntegrityError

    try:
        plaid_svc = setup_plaid_from_env()
        item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
        if not item:
            raise HTTPException(404, "PlaidItem not found")

        # Fetch from Plaid — most common failure point (expired / wrong item)
        try:
            plaid_accounts = plaid_svc.get_accounts(item.access_token)
        except Exception as plaid_err:
            raise HTTPException(400,
                f"Plaid API error: {plaid_err}. "
                "If this connection was recently re-linked, try clicking 🔧 Recover "
                "on the NEWER entry for this bank instead."
            )

        import difflib as _difflib

        def _name_sim(a: str, b: str) -> float:
            """Character-level similarity ratio between two account name strings."""
            return _difflib.SequenceMatcher(
                None, (a or '').lower(), (b or '').lower()
            ).ratio()

        # ── Step 1: load all active DB accounts that belong to this Plaid item ──
        # We query by plaid_item_id rather than iterating Plaid accounts to also
        # capture accounts whose plaid_account_id was corrupted by a bad merge.
        db_accounts = (
            db.query(Account)
            .filter(Account.plaid_item_id == item.item_id, Account.is_active == True)
            .all()
        )
        # Remember original plaid_account_ids so we can tell which accounts had a
        # WRONG id after the bad merge (those need their Plaid transactions cleared).
        orig_plaid_ids: dict = {a.id: a.plaid_account_id for a in db_accounts}

        # ── Step 2: NULL every plaid_account_id for this item ──────────────────
        # PostgreSQL allows multiple NULLs in a UNIQUE column.  Zeroing them all
        # out first means the subsequent UPDATE/INSERT phase faces zero UNIQUE
        # conflicts, regardless of what IDs got shuffled during the bad merge.
        db.execute(
            _text(
                "UPDATE accounts SET plaid_account_id = NULL "
                "WHERE plaid_item_id = :iid AND is_active = true"
            ),
            {"iid": item.item_id},
        )
        db.flush()
        db.expire_all()   # discard ORM cache — every subsequent query hits the DB

        # ── Step 3: match Plaid accounts → DB accounts ──────────────────────────
        # Pass A — exact official_name + mask (case-insensitive).
        # Pass B — mask + account_type + best name-similarity score.
        #           Handles "The Platinum Card®" → "Platinum Card" drift.
        matched_pairs: list = []    # [(db_acct, plaid_pa)]
        remaining_db = list(db_accounts)
        unmatched_plaid = []

        for pa in plaid_accounts:
            pname = (pa.get('official_name') or pa.get('name') or '').strip()
            pmask = pa.get('mask')
            found = None
            if pname and pmask:
                for d in remaining_db:
                    if (d.mask == pmask and
                            (d.official_name or '').strip().lower() == pname.lower()):
                        found = d
                        break
            if found:
                matched_pairs.append((found, pa))
                remaining_db.remove(found)
            else:
                unmatched_plaid.append(pa)

        # Pass B: fallback for name-drifted accounts
        still_unmatched = []
        for pa in unmatched_plaid:
            pname = (pa.get('official_name') or pa.get('name') or '').strip()
            pmask  = pa.get('mask')
            ptype  = pa.get('type', '').lower()
            candidates = [
                d for d in remaining_db
                if d.mask == pmask and d.account_type == ptype
            ]
            if not candidates:
                still_unmatched.append(pa)
                continue
            best = max(
                candidates,
                key=lambda d: _name_sim(d.official_name or d.account_name or '', pname),
            )
            if _name_sim(best.official_name or best.account_name or '', pname) >= 0.4:
                matched_pairs.append((best, pa))
                remaining_db.remove(best)
            else:
                still_unmatched.append(pa)

        # ── Step 4: UPDATE matched accounts with correct plaid_account_ids ──────
        results = []
        updated_account_ids = []   # IDs where plaid_account_id changed → clear txns

        for db_acct, pa in matched_pairs:
            new_pid = pa['account_id']
            was_correct = (orig_plaid_ids.get(db_acct.id) == new_pid)
            db.execute(
                _text(
                    "UPDATE accounts SET plaid_account_id=:pid, plaid_item_id=:iid "
                    "WHERE id=:id"
                ),
                {"pid": new_pid, "iid": item.item_id, "id": db_acct.id},
            )
            if was_correct:
                results.append({'status': 'ok', 'account': db_acct.account_name})
            else:
                updated_account_ids.append(db_acct.id)
                results.append({
                    'status': 'updated',
                    'account': db_acct.account_name,
                    'new_plaid_id': new_pid,
                })
        db.flush()

        # ── Step 5: CREATE new accounts for Plaid entries with no DB match ──────
        created_account_ids = []
        for pa in still_unmatched:
            plaid_account_id = pa['account_id']
            mask = pa.get('mask')
            official_name = (pa.get('official_name') or pa.get('name', '')).strip()
            account_type = pa.get('type', '').lower()
            new_acct = Account(
                plaid_account_id=plaid_account_id,
                plaid_item_id=item.item_id,
                account_name=official_name or f"Account ···{mask}",
                account_type=account_type,
                official_name=official_name,
                mask=mask,
                is_active=True,
                is_manual=False,
                starting_balance=0,
            )
            db.add(new_acct)
            db.flush()
            created_account_ids.append(new_acct.id)
            results.append({
                'status': 'created',
                'account': new_acct.account_name,
                'plaid_id': plaid_account_id,
            })

        # Delete Plaid-sourced transactions from accounts whose plaid_account_id
        # was corrected — their transactions are mixed up after the bad merge.
        # Three FK constraints on transactions.id must be cleared in order:
        #   user_corrections.transaction_id
        #   transaction_splits.parent_transaction_id
        #   transactions.parent_transaction_id  (self-ref: split-child rows)
        total_deleted = 0
        for acct_id in updated_account_ids:
            # A) user_corrections on the Plaid txns themselves
            db.execute(_text(
                "DELETE FROM user_corrections WHERE transaction_id IN ("
                "  SELECT id FROM transactions"
                "  WHERE account_id = :a AND plaid_transaction_id IS NOT NULL)"
            ), {"a": acct_id})
            # B) user_corrections on any split-child txns of those Plaid txns
            db.execute(_text(
                "DELETE FROM user_corrections WHERE transaction_id IN ("
                "  SELECT id FROM transactions WHERE parent_transaction_id IN ("
                "    SELECT id FROM transactions"
                "    WHERE account_id = :a AND plaid_transaction_id IS NOT NULL))"
            ), {"a": acct_id})
            # C) transaction_splits rows referencing the Plaid txns
            db.execute(_text(
                "DELETE FROM transaction_splits WHERE parent_transaction_id IN ("
                "  SELECT id FROM transactions"
                "  WHERE account_id = :a AND plaid_transaction_id IS NOT NULL)"
            ), {"a": acct_id})
            # D) split-child transaction rows (parent_transaction_id → Plaid txn)
            db.execute(_text(
                "DELETE FROM transactions WHERE parent_transaction_id IN ("
                "  SELECT id FROM transactions"
                "  WHERE account_id = :a AND plaid_transaction_id IS NOT NULL)"
            ), {"a": acct_id})
            # E) the Plaid-sourced transactions themselves
            result = db.execute(_text(
                "DELETE FROM transactions"
                " WHERE account_id = :a AND plaid_transaction_id IS NOT NULL"
            ), {"a": acct_id})
            total_deleted += result.rowcount

        item.cursor = None
        db.commit()

        for acct_id in updated_account_ids + created_account_ids:
            try:
                rebuild_monthly_snapshots(db, acct_id)
            except Exception:
                logger.debug('Suppressed exception', exc_info=True)

        return {
            'accounts': results,
            'transactions_deleted': total_deleted,
            'cursor_reset': True,
            'message': f'Recovery complete. Run "↺ Full Resync" for {item.institution_name} to restore all transactions.',
        }

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        detail = f"{type(exc).__name__}: {exc}"
        logger.info(f"[recover-accounts] UNHANDLED ERROR for item {item_id}:\n{_tb.format_exc()}")
        raise HTTPException(500, f"Recovery failed: {detail}")
