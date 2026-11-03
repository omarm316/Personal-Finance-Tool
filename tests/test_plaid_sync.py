"""
Tests for the Plaid sync content-hash fallback in core/plaid_sync._sync_item().

The fallback lets a row survive Plaid regenerating transaction IDs (re-link,
cursor reset) by matching on account|date|amount|description. It must not
treat a real same-day repeat charge as the same transaction: before the fix,
the second of two identical charges overwrote the first row's Plaid ID, so
2 charges became 1 row and 4 became 2.

_sync_item() runs against the in-memory SQLite DB with a fake Plaid client.
"""

import asyncio
import os
import sys
from datetime import datetime
from types import SimpleNamespace

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from database import Account, Transaction
from core.accounts_helpers import _assign_content_hash
from core.plaid_sync import _sync_item

DAY = datetime(2026, 8, 11)
DESC = "UBER G.CO/HELPPAY#"


class FakePlaid:
    def __init__(self, result):
        self.result = result
        self.cursors = []

    def sync_transactions(self, access_token, cursor):
        self.cursors.append(cursor)
        return self.result


def _account(db):
    a = Account(account_name="Business Gold 1000", account_type="credit card",
                plaid_account_id="acct-1", is_active=True)
    db.add(a)
    db.commit()
    return a


def _txn(pid, amount=85.00, desc=DESC):
    # Plaid's sign convention: expenses positive.
    return {"plaid_transaction_id": pid, "plaid_account_id": "acct-1",
            "date": DAY, "amount": amount, "description_raw": desc,
            "merchant_name": "Uber", "pending": False}


def _existing_row(db, account, pid, desc=DESC, is_excluded=False, description_clean=None):
    t = Transaction(
        plaid_transaction_id=pid, account_id=account.id, date=DAY,
        year=DAY.year, month=DAY.month, day=DAY.day, amount=-85.00,
        description_raw=desc, description_clean=description_clean or "Uber",
        action="Expense", category_auto="Transportation", needs_review=False,
        is_excluded=is_excluded,
        content_hash=_assign_content_hash(db, account.id, DAY, -85.00, desc),
    )
    db.add(t)
    db.commit()
    return t


def _sync(db, added, cursor="cur-1", removed=None):
    item = SimpleNamespace(access_token="tok", cursor=cursor,
                           institution_name="Amex", last_synced_at=None)
    plaid = FakePlaid({"added": added, "modified": [], "removed": removed or [],
                       "next_cursor": "cur-2"})
    return asyncio.run(_sync_item(item, plaid, db))


def _rows(db):
    return db.query(Transaction).order_by(Transaction.content_hash).all()


class TestSameDayRepeats:

    def test_six_identical_charges_in_one_sync_all_stored(self, db_session):
        _account(db_session)
        added = _sync(db_session, [_txn(f"p{i}") for i in range(6)], cursor=None)
        rows = _rows(db_session)
        assert added == 6
        assert sorted(r.plaid_transaction_id for r in rows) == [f"p{i}" for i in range(6)]
        assert [r.content_hash[-2:] for r in rows] == ["00", "01", "02", "03", "04", "05"]

    def test_repeat_in_later_incremental_sync_inserts_new_row(self, db_session):
        acct = _account(db_session)
        _existing_row(db_session, acct, "p0")
        added = _sync(db_session, [_txn("p1")])
        assert added == 1
        assert sorted(r.plaid_transaction_id for r in _rows(db_session)) == ["p0", "p1"]

    def test_full_download_does_not_hijack_row_whose_id_is_still_live(self, db_session):
        # Cursor reset on the same item: Plaid re-sends p0 (live) and p1 (new
        # repeat). p1 arrives first, so it must not take p0's row.
        acct = _account(db_session)
        row = _existing_row(db_session, acct, "p0")
        added = _sync(db_session, [_txn("p1"), _txn("p0")], cursor=None)
        assert added == 1
        assert sorted(r.plaid_transaction_id for r in _rows(db_session)) == ["p0", "p1"]
        db_session.refresh(row)
        assert row.plaid_transaction_id == "p0"  # user's row keeps its own charge


class TestReLinkStillAdopts:

    def test_full_download_adopts_rows_with_old_item_ids(self, db_session):
        # Re-link: two identical charges stored under old IDs; the new item
        # sends both under new IDs. Both rows are kept, no duplicates.
        acct = _account(db_session)
        a = _existing_row(db_session, acct, "old-a")
        b = _existing_row(db_session, acct, "old-b")
        added = _sync(db_session, [_txn("new-1"), _txn("new-2")], cursor=None)
        assert added == 0
        rows = _rows(db_session)
        assert [r.id for r in rows] == [a.id, b.id]
        assert sorted(r.plaid_transaction_id for r in rows) == ["new-1", "new-2"]

    def test_row_without_plaid_id_is_adopted(self, db_session):
        acct = _account(db_session)
        row = _existing_row(db_session, acct, None)
        assert _sync(db_session, [_txn("p1")]) == 0
        db_session.refresh(row)
        assert row.plaid_transaction_id == "p1"

    def test_id_removed_in_same_result_is_adopted_not_soft_deleted(self, db_session):
        # Plaid removes p0 and re-adds the same charge as p1 in one sync.
        acct = _account(db_session)
        row = _existing_row(db_session, acct, "p0")
        assert _sync(db_session, [_txn("p1")], removed=["p0"]) == 0
        db_session.refresh(row)
        assert row.plaid_transaction_id == "p1"
        assert not row.is_excluded

    def test_row_soft_deleted_by_earlier_removal_is_adopted_and_restored(self, db_session):
        acct = _account(db_session)
        note = " [removed by Plaid — may reappear with a new ID]"
        row = _existing_row(db_session, acct, "p0", is_excluded=True,
                            description_clean="Uber" + note)
        assert _sync(db_session, [_txn("p1")]) == 0
        db_session.refresh(row)
        assert row.plaid_transaction_id == "p1"
        assert not row.is_excluded
        assert row.description_clean == "Uber"
