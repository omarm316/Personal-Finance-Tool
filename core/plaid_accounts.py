"""
core/plaid_accounts.py — the one place that ties the accounts Plaid reports
for a connection (PlaidItem) to our Account rows.

Every connection flow runs through link_plaid_accounts():
  - Add a connection          POST /api/plaid/exchange-token   (new item)
  - Reconnect a connection    POST /api/plaid/update-complete  (same item, Link update mode)
  - Add cards to a connection POST /api/plaid/update-complete  (same item, update mode
                                                                with account selection)
  - Every full re-download    _sync_item_background(clear_cursor=True)

Why one place: the three flows used to match accounts three different ways,
and the reconnect path matched on Plaid's account ID alone. Amex hands out new
account IDs when you re-consent, so each "+ Add Account" on Amex (Aug 8,
Aug 11, Nov 8 2026) created a second row for cards we already had, and the
full re-download then copied their history onto it (B41).

For each account Plaid reports, in this order:
  1. Same Plaid account ID          → that row.
  2. Same persistent_account_id     → that row.
  3. Same card under a new Plaid ID → a row at the same bank with the same
     last 4 and type whose own Plaid ID is no longer live: on this connection
     but missing from Plaid's list, unlinked (its connection was removed), or
     on a connection that is switched off or needs a login. Taken when the
     official names agree (the oldest row if several), or when it is the only
     candidate and one side has no official name. Different official names
     never match, so a new card sharing a last 4 with an old one gets its own row.
  4. Already synced by another working connection at the same bank (same
     last 4, type and official name, e.g. a joint account) → left there and
     not added twice.
  5. Otherwise a new row.
"""
import logging
import re
from dataclasses import dataclass, field

from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import Account, PlaidItem
from core.accounts_helpers import _account_hash

logger = logging.getLogger('moresheth')

# Plaid errors that only a fresh login (Link update mode) clears.
AUTH_ERROR_CODES = frozenset({
    'ITEM_LOGIN_REQUIRED', 'INVALID_CREDENTIALS', 'INVALID_ACCESS_TOKEN',
    'USER_PERMISSION_REVOKED', 'ITEM_NOT_FOUND', 'ACCESS_NOT_GRANTED',
})

# Plaid type → our type when Plaid sends no subtype.
PLAID_TYPE_FALLBACK = {
    'depository':  'checking',
    'credit':      'credit card',
    'investment':  'investment',
    'loan':        'loan',
}

# Stored casing for account types (database.py's startup migration uses the same map).
_TYPE_LABELS = {
    'checking':    'Checking',
    'savings':     'Savings',
    'brokerage':   'Brokerage',
    'investment':  'Investment',
    'credit card': 'Credit Card',
    'credit':      'Credit Card',
    'loan':        'Loan',
    'other':       'Other',
}

# Per-account outcomes, as returned to the UI.
MATCHED         = 'matched'          # same Plaid ID as before
RELINKED        = 'relinked'         # same card, Plaid gave it a new ID; history kept
CREATED         = 'created'          # new account row
ALREADY_TRACKED = 'already_tracked'  # another working connection already syncs it


def plaid_account_type(pa: dict) -> str:
    """Lower-case type for a Plaid account: subtype first, then the type fallback."""
    subtype = (pa.get('subtype') or '').lower().strip()
    if subtype and subtype != 'none':
        return subtype
    raw_type = (pa.get('type') or '').lower().strip()
    return PLAID_TYPE_FALLBACK.get(raw_type, raw_type) or 'other'


def type_label(account_type: str) -> str:
    return _TYPE_LABELS.get((account_type or '').lower().strip(), account_type)


def _norm_name(name) -> str:
    s = re.sub(r'[^a-z0-9 ]+', ' ', (name or '').lower())
    s = ' '.join(s.split())
    return s[4:] if s.startswith('the ') else s


def _names_agree(account: Account, pa: dict):
    """True or False when both sides have an official name; None when either is missing."""
    ours, theirs = _norm_name(account.official_name), _norm_name(pa.get('official_name'))
    if not ours or not theirs:
        return None
    return ours == theirs


@dataclass
class LinkOutcome:
    results: list = field(default_factory=list)      # one dict per Plaid account
    created: list = field(default_factory=list)      # new Account rows
    emptied_items: list = field(default_factory=list)  # other connections left with no accounts
    not_returned: list = field(default_factory=list)   # rows on this connection Plaid no longer lists

    @property
    def duplicate_of(self):
        """
        The connection this login duplicates, when every account it returned is
        already synced by one other working connection; otherwise None.
        """
        if not self.results or any(r['status'] != ALREADY_TRACKED for r in self.results):
            return None
        holders = {r['tracked_by_item_id'] for r in self.results}
        return holders.pop() if len(holders) == 1 else None


def link_plaid_accounts(db: Session, item: PlaidItem, plaid_accounts: list) -> LinkOutcome:
    """
    Match Plaid's account list for `item` to Account rows, adopt new Plaid IDs,
    create rows for new accounts, and flush. The caller commits.
    """
    live_ids = {pa['account_id'] for pa in plaid_accounts}
    items_cache: dict = {}

    def _item(item_id):
        if item_id not in items_cache:
            items_cache[item_id] = db.query(PlaidItem).filter_by(item_id=item_id).first()
        return items_cache[item_id]

    def holds_live_id(acc: Account) -> bool:
        """Is this row still receiving data under its current Plaid ID?"""
        if not acc.plaid_account_id:
            return False
        if acc.plaid_item_id == item.item_id:
            return acc.plaid_account_id in live_ids
        other = _item(acc.plaid_item_id) if acc.plaid_item_id else None
        return bool(other and other.is_active and other.last_error_code not in AUTH_ERROR_CODES)

    # Active rows at the same bank, oldest first.
    q = (db.query(Account)
         .outerjoin(PlaidItem, Account.plaid_item_id == PlaidItem.item_id)
         .filter(Account.is_active == True))
    if item.institution_id:
        q = q.filter(or_(Account.institution_id == item.institution_id,
                         PlaidItem.institution_id == item.institution_id))
    else:
        q = q.filter(PlaidItem.institution_name == item.institution_name)
    bank = q.order_by(Account.id).all()

    def same_card_shape(acc: Account, pa: dict) -> bool:
        return (bool(pa.get('mask')) and acc.mask == pa.get('mask')
                and (acc.account_type or '').lower().strip() == plaid_account_type(pa))

    claimed: set = set()
    matched: dict = {}   # plaid account_id → (Account, status)
    tracked: dict = {}   # plaid account_id → Account on another working connection

    # Steps 1 and 2: Plaid's own IDs.
    for pa in plaid_accounts:
        acc = db.query(Account).filter_by(plaid_account_id=pa['account_id']).first()
        if acc:
            matched[pa['account_id']] = (acc, MATCHED)
            claimed.add(acc.id)
            continue
        if pa.get('persistent_account_id'):
            acc = (db.query(Account)
                   .filter(Account.persistent_account_id == pa['persistent_account_id'],
                           Account.is_active == True)
                   .order_by(Account.id).first())
            if acc and acc.id not in claimed:
                if acc.plaid_item_id != item.item_id and holds_live_id(acc):
                    tracked[pa['account_id']] = acc
                else:
                    matched[pa['account_id']] = (acc, RELINKED)
                    claimed.add(acc.id)

    def free_candidates(pa):
        return [a for a in bank
                if a.id not in claimed and same_card_shape(a, pa) and not holds_live_id(a)]

    pending = [pa for pa in plaid_accounts
               if pa['account_id'] not in matched and pa['account_id'] not in tracked]

    # Step 3a: same card under a new ID, official names agree.
    for pa in pending:
        named = [a for a in free_candidates(pa) if _names_agree(a, pa) is True]
        if named:
            matched[pa['account_id']] = (named[0], RELINKED)
            claimed.add(named[0].id)

    # Step 3b: the only candidate, when a name is missing on either side.
    for pa in pending:
        if pa['account_id'] in matched:
            continue
        cands = free_candidates(pa)
        if len(cands) == 1 and _names_agree(cands[0], pa) is None:
            matched[pa['account_id']] = (cands[0], RELINKED)
            claimed.add(cands[0].id)

    # Step 4: already synced by another working connection.
    for pa in pending:
        if pa['account_id'] in matched:
            continue
        twins = [a for a in bank
                 if a.plaid_item_id != item.item_id and same_card_shape(a, pa)
                 and holds_live_id(a) and _names_agree(a, pa) is True]
        if twins:
            tracked[pa['account_id']] = twins[0]

    # Apply, in Plaid's order.
    outcome = LinkOutcome()
    left_items: set = set()
    for pa in plaid_accounts:
        pid = pa['account_id']
        acct_type = plaid_account_type(pa)
        if pid in tracked:
            holder = tracked[pid]
            holder_item = _item(holder.plaid_item_id)
            outcome.results.append({
                'name': holder.account_name, 'mask': holder.mask, 'status': ALREADY_TRACKED,
                'account_id': holder.id, 'tracked_by_item_id': holder.plaid_item_id,
                'tracked_by': holder_item.institution_name if holder_item else None,
            })
            continue
        if pid in matched:
            acc, status = matched[pid]
            if acc.plaid_item_id and acc.plaid_item_id != item.item_id:
                left_items.add(acc.plaid_item_id)
            acc.plaid_account_id = pid
            acc.plaid_item_id = item.item_id
            if item.institution_id:
                acc.institution_id = item.institution_id
            if pa.get('persistent_account_id'):
                acc.persistent_account_id = pa['persistent_account_id']
            if pa.get('official_name'):
                acc.official_name = pa['official_name']
            acc.account_hash = _account_hash(item.institution_id or '', pa.get('mask') or '', acct_type)
            if status == RELINKED:
                logger.info(f"[link] {item.institution_name}: {acc.account_name} kept its history under a new Plaid ID")
            outcome.results.append({'name': acc.account_name, 'mask': acc.mask,
                                    'status': status, 'account_id': acc.id})
            continue
        # Step 5: new account. History arrives with the sync, so the offset starts at 0.
        acc = Account(
            plaid_account_id=pid,
            persistent_account_id=pa.get('persistent_account_id'),
            plaid_item_id=item.item_id,
            institution_id=item.institution_id,
            account_hash=_account_hash(item.institution_id or '', pa.get('mask') or '', acct_type),
            account_name=f"{pa.get('name') or 'Account'} {pa.get('mask') or ''}".strip(),
            account_type=type_label(acct_type),
            official_name=pa.get('official_name'),
            mask=pa.get('mask'),
            is_active=True,
            starting_balance=0,
            start_date=None,
        )
        db.add(acc)
        db.flush()
        outcome.created.append(acc)
        outcome.results.append({'name': acc.account_name, 'mask': acc.mask,
                                'status': CREATED, 'account_id': acc.id})
        logger.info(f"[link] {item.institution_name}: new account {acc.account_name}")

    db.flush()

    outcome.not_returned = [
        {'name': a.account_name, 'mask': a.mask, 'account_id': a.id}
        for a in bank
        if a.plaid_item_id == item.item_id and a.id not in claimed
        and a.plaid_account_id and a.plaid_account_id not in live_ids
    ]
    for item_id in left_items:
        still_there = (db.query(Account)
                       .filter(Account.plaid_item_id == item_id, Account.is_active == True)
                       .count())
        if not still_there:
            outcome.emptied_items.append(item_id)
    return outcome


def retire_emptied_items(db: Session, outcome: LinkOutcome) -> list:
    """
    Switch off connections whose accounts all moved to a new login (the old
    one needed a login and the bank was connected again with + Connect Bank).
    Local only: the item stays at Plaid until removed in Settings.
    """
    names = []
    for item_id in outcome.emptied_items:
        old = db.query(PlaidItem).filter_by(item_id=item_id).first()
        if old and old.is_active:
            old.is_active = False
            names.append(old.institution_name)
            logger.info(f"[link] {old.institution_name}: switched off — its accounts moved to the new connection")
    return names
