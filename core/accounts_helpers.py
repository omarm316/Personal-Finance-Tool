"""
core/accounts_helpers.py — shared account classification, balance computation,
and Plaid-sync-adjacent helpers used by routers/accounts.py and others.

Extracted from main.py (Phase 0 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
import hashlib
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import Account, Transaction, AccountMonthlySnapshot, Card, CardProduct

logger = logging.getLogger('moresheth')

_ISSUER_NAME_MAP = {
    'chase': 'CHASE', 'american express': 'AMEX', 'amex': 'AMEX',
    'citibank': 'CITI', 'citi': 'CITI', 'discover': 'DISCOVER',
    'bank of america': 'BOA', 'capital one': 'CAPITAL ONE',
    'wells fargo': 'WELLS FARGO', 'us bank': 'US BANK', 'barclays': 'BARCLAYS',
    'synchrony': 'SYNCHRONY', 'bilt': 'BILT', 'fidelity': 'FIDELITY',
}
def _guess_issuer(institution_name: str | None) -> str | None:
    name = (institution_name or '').lower()
    for key, code in _ISSUER_NAME_MAP.items():
        if key in name:
            return code
    return None
ACCOUNT_TYPE_MAP = {
    # Assets — Cash & Savings (included in Cash Flow)
    'checking':       ('Cash & Savings', True, False),
    'savings':        ('Cash & Savings', True, False),
    'cash':           ('Cash & Savings', True, False),
    'gift card':      ('Cash & Savings', True, False),
    'money market':   ('Cash & Savings', True, False),
    'cd':             ('Cash & Savings', True, False),
    'hsa':            ('Cash & Savings', True, False),
    'fsa':            ('Cash & Savings', True, False),
    # Assets — Investments
    'investment':     ('Investments', True, False),
    '401k':           ('Investments', True, False),
    'ira':            ('Investments', True, False),
    'brokerage':      ('Investments', True, False),
    # Assets — Other
    'real_estate':    ('Real Estate', True, False),
    'vehicle':        ('Other Assets', True, False),
    'business_owned': ('Other Assets', True, False),
    'other':          ('Other Assets', True, False),
    # Liabilities
    'credit card':    ('Credit Cards', False, True),
    'credit':         ('Credit Cards', False, True),
    'mortgage':       ('Mortgage', False, True),
    'loan':           ('Personal Loans', False, True),
    'student':        ('Personal Loans', False, True),
    'auto':           ('Personal Loans', False, True),
    'business_loan':  ('Business Loans', False, True),
}
def classify_account(account_type: str) -> dict:
    """
    Compute classification flags for an account based on its type.
    Returns is_asset, is_liability, is_credit, and bucket name.
    """
    acct_type = (account_type or 'other').lower().strip()
    bucket, is_asset, is_liability = ACCOUNT_TYPE_MAP.get(acct_type, ('Other Assets', True, False))
    return {
        'is_asset': is_asset,
        'is_liability': is_liability,
        'is_credit': acct_type == 'credit',
        'bucket': bucket,
    }
def _account_hash(institution_id: str, mask: str, account_type: str) -> str:
    """
    Stable 12-char identity hash for an account.
    Formula: SHA256(institution_id|mask|normalised_type)[:12]

    Written once at exchange-token time and stored on the account row.
    Because it uses Plaid's immutable institution_id (e.g. "ins_3" for Chase)
    plus the last-4 mask, it survives sever-plaid and is the primary matching
    key when a user re-links a bank — no database JOIN required.
    """
    raw = f"{(institution_id or '').strip()}|{(mask or '').strip()}|{(account_type or '').lower().strip()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]
def _content_base_hash(account_id: int, date, amount: float, description_raw: str) -> str:
    """
    14-character prefix of SHA-256(account_id|date|amount|description_raw).
    Stable: uses the raw bank string (not enriched merchant name), normalised
    amount (2 dp), and uppercase description so minor spacing/case changes
    don't break the match.
    """
    raw = f"{account_id}|{date}|{amount:.2f}|{(description_raw or '').strip().upper()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:14]
def _assign_content_hash(db: Session, account_id: int, date, amount: float, description_raw: str) -> str:
    """
    Assign a unique content_hash for a new transaction.
    Counts existing transactions that share the same base hash to determine
    the next suffix: -00, -01, -02 …
    Thread-safe within a single DB session (flush before calling if needed).
    """
    base  = _content_base_hash(account_id, date, amount, description_raw)
    count = db.query(Transaction).filter(
        Transaction.content_hash.like(f'{base}-%')
    ).count()
    return f'{base}-{count:02d}'
def _sign_plaid_balance(raw: Optional[float], account_type_str: str) -> Optional[float]:
    """Apply sign convention: credit/loan balances stored as negative (Plaid reports amount-owed as positive)."""
    if raw is None:
        return None
    t = (account_type_str or '').lower().strip()
    # Match both Plaid type ("credit") and stored subtype ("credit card")
    return -raw if t.startswith('credit') or t in ('loan',) else raw
def _plaid_anchor_date(account_type_str: str) -> datetime:
    """
    Return the effective anchor date for a Plaid balance snapshot.

    Plaid's `current` balance lags behind real-time:
      - Checking/Savings: typically 1-2 business days lag
      - Credit cards/Loans: typically near real-time (same-day)

    Instead of using datetime.utcnow() (which creates a gap where recent
    transactions fall BEFORE the anchor and never get counted), we step
    back to account for the lag, anchoring at end-of-day.
    """
    from datetime import timedelta, time as _time
    t = (account_type_str or '').lower().strip()
    is_liability = t.startswith('credit') or t in ('loan',)
    lag_days = 0 if is_liability else 2
    effective = datetime.utcnow() - timedelta(days=lag_days)
    return datetime.combine(effective.date(), _time(23, 59, 59))
def get_account_balance(db: Session, account_id: int, as_of_date: datetime = None) -> float:
    """
    Compute account balance at a given date (or now if not specified).

    Uses the same anchor model as get_daily_balances() to ensure consistency:
      anchor_balance + SUM(transactions from anchor_date through as_of_date)

    Anchor model (start_date is set):
      starting_balance = Plaid balance AT start_date (end of that day).
      Transactions AFTER start_date are accumulated forward.

    Legacy model (start_date is None):
      starting_balance is a pre-all-transactions offset.
      ALL transactions are accumulated forward.

    NOTE: Monthly snapshots are used for charting and historical analysis only.
    Balance Observations are used for RECONCILIATION MONITORING only.
    """
    from sqlalchemy import func as _func

    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        return 0.0

    anchor = account.starting_balance or 0.0
    anchor_dt = account.start_date

    if anchor_dt is None:
        # Legacy: starting_balance = pre-all-transactions offset
        q = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account_id,
        )
        if as_of_date:
            q = q.filter(Transaction.date <= as_of_date)
        return round(anchor + (q.scalar() or 0.0), 2)

    # Anchor model: starting_balance = Plaid balance at end of start_date
    anchor_eod = datetime.combine(anchor_dt.date() if hasattr(anchor_dt, 'date') else anchor_dt,
                                   datetime.max.time())
    as_of_cmp = as_of_date if as_of_date else datetime.utcnow()

    if as_of_cmp >= anchor_eod:
        # Normal: accumulate transactions after anchor through as_of
        q = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account_id,
            Transaction.date > anchor_eod,
        )
        if as_of_date:
            q = q.filter(Transaction.date <= as_of_date)
        return round(anchor + (q.scalar() or 0.0), 2)
    else:
        # as_of is before anchor: walk backward
        q = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account_id,
            Transaction.date > as_of_date,
            Transaction.date <= anchor_eod,
        )
        return round(anchor - (q.scalar() or 0.0), 2)
def get_account_balances_bulk(db: Session, accounts: list) -> dict:
    """
    Current balance for many accounts in ONE query.

    get_account_balance() costs two round-trips per account — it re-fetches the
    Account it was given the id of, then runs a per-account SUM. Calling it in a
    loop is what made /api/accounts 98 queries / 7.1s (49 account fetches +
    48 sums) against the remote DB. See B4.

    Same anchor model as get_account_balance(), expressed set-wise:
      no start_date  → anchor + SUM(all transactions)
      start_date set → anchor + SUM(transactions on a LATER DAY than the anchor)

    `date(t.date) > date(a.start_date)` is exactly equivalent to the scalar
    version's `t.date > end-of-anchor-day` comparison, without needing to
    materialise a per-account timestamp.

    Accounts whose anchor is in the *future* take the scalar function's
    walk-backward branch, which has no set-wise equivalent here; they're rare,
    so they fall back to the per-account path rather than complicating this.
    """
    from sqlalchemy import func as _func
    if not accounts:
        return {}
    now = datetime.utcnow()

    def _anchor_eod(a):
        d = a.start_date
        if d is None:
            return None
        return datetime.combine(d.date() if hasattr(d, 'date') else d, datetime.max.time())

    future_ids = {a.id for a in accounts
                  if (_eod := _anchor_eod(a)) is not None and _eod > now}
    normal = [a for a in accounts if a.id not in future_ids]

    sums: dict[int, float] = {}
    if normal:
        rows = (
            db.query(Transaction.account_id, _func.sum(Transaction.amount))
            .join(Account, Account.id == Transaction.account_id)
            .filter(Transaction.account_id.in_([a.id for a in normal]))
            .filter(or_(
                Account.start_date.is_(None),
                _func.date(Transaction.date) > _func.date(Account.start_date),
            ))
            .group_by(Transaction.account_id)
            .all()
        )
        sums = {aid: (total or 0.0) for aid, total in rows}

    out: dict[int, float] = {}
    for a in accounts:
        if a.id in future_ids:
            out[a.id] = get_account_balance(db, a.id)
        else:
            out[a.id] = round((a.starting_balance or 0.0) + sums.get(a.id, 0.0), 2)
    return out
def rebuild_monthly_snapshots(db: Session, account_id: int) -> int:
    """
    Full rebuild of monthly opening/closing snapshots for one account.
    Uses account.starting_balance as the baseline before the earliest transaction.
    Returns the number of months built.
    """
    from collections import defaultdict
    from sqlalchemy import func as _func
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        return 0
    txns = db.query(Transaction).filter(
        Transaction.account_id == account_id,
    ).order_by(Transaction.date).all()
    if not txns:
        return 0
    by_month: dict = defaultdict(float)
    for t in txns:
        by_month[(t.date.year, t.date.month)] += t.amount
    db.query(AccountMonthlySnapshot).filter_by(account_id=account_id).delete(synchronize_session=False)

    if account.start_date:
        # Anchor model: starting_balance = Plaid balance AT start_date.
        pre_anchor_sum = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account_id,
            Transaction.date <= account.start_date,
        ).scalar() or 0.0
        running = round((account.starting_balance or 0.0) - pre_anchor_sum, 4)
    else:
        # Legacy: starting_balance is already the pre-all-transactions offset
        running = account.starting_balance or 0.0
    sorted_months = sorted(by_month.keys())
    for (year, month) in sorted_months:
        opening = running
        closing = round(running + by_month[(year, month)], 2)
        db.add(AccountMonthlySnapshot(
            account_id=account_id,
            year=year,
            month=month,
            opening_balance=round(opening, 2),
            closing_balance=closing,
        ))
        running = closing
    return len(sorted_months)
def _refresh_current_month_snapshot(db: Session, account_id: int) -> None:
    """
    Lightweight post-sync update: recalculate only the current month's closing_balance.
    Creates the current-month snapshot if it doesn't exist yet (month rollover handled).
    Does NOT commit — caller is responsible for committing.
    """
    from sqlalchemy import func as _func
    now = datetime.utcnow()
    year, month = now.year, now.month
    snapshot = db.query(AccountMonthlySnapshot).filter_by(
        account_id=account_id, year=year, month=month
    ).first()
    if snapshot is None:
        prev_m, prev_y = (month - 1, year) if month > 1 else (12, year - 1)
        prev = db.query(AccountMonthlySnapshot).filter_by(
            account_id=account_id, year=prev_y, month=prev_m
        ).first()
        if prev is None:
            return  # No snapshot base yet — Balance Sync hasn't been run
        snapshot = AccountMonthlySnapshot(
            account_id=account_id, year=year, month=month,
            opening_balance=round(prev.closing_balance, 2),
            closing_balance=round(prev.closing_balance, 2),
        )
        db.add(snapshot)
    # ALL transactions — must match the filter used when starting_balance was anchored.
    month_sum = db.query(_func.sum(Transaction.amount)).filter(
        Transaction.account_id == account_id,
        Transaction.year == year,
        Transaction.month == month,
    ).scalar() or 0.0
    snapshot.closing_balance = round(snapshot.opening_balance + month_sum, 2)
    snapshot.synced_at = datetime.utcnow()
def _ensure_cards_for_new_accounts(db: Session, new_accounts: list, institution_name: str | None = None) -> int:
    """
    Create a `Card` row for each brand-new credit-card `Account` just created
    by this sync (the caller passes exactly the accounts it added, not every
    account on the item — deliberately narrow, see below).

    Plaid sync only ever creates/updates the `Account` row — it never creates
    the `Card` row that earning rates, benefits, and the ecosystem pages all
    key off. Without one, a newly-synced card silently earns nothing even
    after its CardProduct is linked (this was previously a manual fixup done
    by hand for every new card — see BACKLOG B18). Called right after account
    reconciliation (both first link and "+ Add Account" on an existing item)
    so new cards work end-to-end without a manual DB step.

    Scoped to accounts created in THIS call, not "every orphaned credit
    account on the item" — B31 documents a still-open duplicate/mislabeled
    account (168) sharing a mask with a real one; blindly backfilling every
    Card-less credit account on an item would hand that duplicate a
    permanent Card row and complicate its planned cleanup. Pre-existing
    orphans (B18's West Elm/Fidelity cases) stay manual fixes for now.
    """
    accounts = [a for a in new_accounts if 'credit' in (a.account_type or '').lower()]
    if not accounts:
        return 0
    issuer = _guess_issuer(institution_name)
    created = 0
    for a in accounts:
        if db.query(Card).filter_by(account_id=a.id).first():
            continue
        base_card_id = (a.account_name or f"Account {a.id}").strip()[:50]
        card_id = base_card_id
        suffix = 2
        while db.query(Card).filter_by(card_id=card_id).first():
            card_id = f"{base_card_id[:46]} #{suffix}"
            suffix += 1
        db.add(Card(
            card_id=card_id,
            issuer=issuer,
            card_name=a.official_name or a.account_name,
            account_id=a.id,
            is_active=True,
        ))
        created += 1
    if created:
        db.commit()
        logger.info(f"[sync] {institution_name or 'item'}: auto-created {created} Card row(s)")
    return created
def _refresh_product_held_status(db: Session, product_id: int | None) -> None:
    """
    A CardProduct's `status` ('active' vs 'not_held') should reflect whether
    any Account or Card currently links to it, not whatever it was seeded as.
    Call after every product link/unlink/change so the catalog badge stays
    truthful without a manual flip.
    """
    if not product_id:
        return
    product = db.query(CardProduct).filter_by(id=product_id).first()
    if not product:
        return
    still_held = (
        db.query(Account).filter_by(product_id=product_id).first()
        or db.query(Card).filter_by(product_id=product_id).first()
    )
    product.status = 'active' if still_held else 'not_held'
