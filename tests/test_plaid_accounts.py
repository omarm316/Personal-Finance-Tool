"""
Tests for core/plaid_accounts.link_plaid_accounts() — the one matching step
behind every connection flow:

  - Add a connection          (exchange-token, new item)
  - Reconnect a connection    (update mode, same item)
  - Add cards to a connection (update mode with account selection, same item)

The Amex cases replay what happened on 2026-08-08, 08-11 and 11-08: Amex gave
cards new Plaid account IDs on re-consent, the old code matched on that ID
alone, and each card got a second row plus a second copy of its history (B41).
"""

import asyncio
import os
import sys
from datetime import datetime
from types import SimpleNamespace

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from database import Account, PlaidItem, Transaction
from core.accounts_helpers import _assign_content_hash
from core.plaid_accounts import (
    ALREADY_TRACKED, CREATED, MATCHED, RELINKED,
    link_plaid_accounts, retire_emptied_items,
)
from core.plaid_sync import _sync_item

AMEX = 'ins_10'
BOFA = 'ins_127989'


# ── helpers ──────────────────────────────────────────────────────────────────

def _item(db, item_id, inst_id, name, error=None, active=True):
    it = PlaidItem(item_id=item_id, institution_id=inst_id, institution_name=name,
                   is_active=active, last_error_code=error)
    it.access_token = f"tok-{item_id}"
    db.add(it)
    db.commit()
    return it


def _acct(db, item, pid, mask, official, name=None, acct_type="Credit Card", active=True):
    a = Account(plaid_account_id=pid, plaid_item_id=item.item_id if item else None,
                institution_id=item.institution_id if item else None,
                account_name=name or f"{official} {mask}", official_name=official,
                mask=mask, account_type=acct_type, is_active=active)
    db.add(a)
    db.commit()
    return a


def _pa(pid, mask, official, name=None, subtype="credit card", type_="credit", persistent=None):
    return {"account_id": pid, "persistent_account_id": persistent,
            "name": name or official, "official_name": official,
            "type": type_, "subtype": subtype, "mask": mask, "balance": 0}


def _by_status(outcome):
    out = {}
    for r in outcome.results:
        out.setdefault(r["status"], []).append(r["account_id"])
    return out


def _active_rows(db, item_id):
    return db.query(Account).filter_by(plaid_item_id=item_id, is_active=True).count()


# ── Add a connection ─────────────────────────────────────────────────────────

class TestAddConnection:
    def test_new_bank_creates_every_account(self, db_session):
        item = _item(db_session, "boa-new", BOFA, "Bank of America (Omer)")
        outcome = link_plaid_accounts(db_session, item, [
            _pa("p1", "4574", "Adv SafeBalance Banking", subtype="checking", type_="depository"),
            _pa("p2", "7384", "Customized Cash Rewards Visa Signature"),
        ])
        assert [r["status"] for r in outcome.results] == [CREATED, CREATED]
        assert {a.account_type for a in outcome.created} == {"Checking", "Credit Card"}
        assert all(a.plaid_item_id == "boa-new" and a.institution_id == BOFA for a in outcome.created)
        assert outcome.duplicate_of is None

    def test_same_login_already_working_is_a_duplicate(self, db_session):
        old = _item(db_session, "boa-old", BOFA, "Bank of America (Omer)")
        _acct(db_session, old, "o1", "4574", "Adv SafeBalance Banking", acct_type="Checking")
        _acct(db_session, old, "o2", "7384", "Customized Cash Rewards Visa Signature")
        new = _item(db_session, "boa-dup", BOFA, "Bank of America")
        outcome = link_plaid_accounts(db_session, new, [
            _pa("n1", "4574", "Adv SafeBalance Banking", subtype="checking", type_="depository"),
            _pa("n2", "7384", "Customized Cash Rewards Visa Signature"),
        ])
        assert outcome.duplicate_of == "boa-old"
        assert not outcome.created
        assert _active_rows(db_session, "boa-old") == 2

    def test_replaces_a_connection_that_needs_a_login(self, db_session):
        """+ Connect Bank used instead of Reconnect: rows move over, old one is switched off."""
        old = _item(db_session, "boa-old", BOFA, "Bank of America (Omer)", error="ITEM_LOGIN_REQUIRED")
        chk = _acct(db_session, old, "o1", "4574", "Adv SafeBalance Banking", acct_type="Checking")
        card = _acct(db_session, old, "o2", "7384", "Customized Cash Rewards Visa Signature")
        new = _item(db_session, "boa-new", BOFA, "Bank of America")
        outcome = link_plaid_accounts(db_session, new, [
            _pa("n1", "4574", "Adv SafeBalance Banking", subtype="checking", type_="depository"),
            _pa("n2", "7384", "Customized Cash Rewards Visa Signature"),
        ])
        assert _by_status(outcome) == {RELINKED: [chk.id, card.id]}
        assert (chk.plaid_account_id, chk.plaid_item_id) == ("n1", "boa-new")
        assert outcome.emptied_items == ["boa-old"]
        assert retire_emptied_items(db_session, outcome) == ["Bank of America (Omer)"]
        assert db_session.query(PlaidItem).filter_by(item_id="boa-old").one().is_active is False

    def test_replacement_login_where_the_bank_renamed_accounts(self, db_session):
        """Bank of America, Nov 2026: Plaid would not refresh the March connection,
        so it is connected again; the new OAuth data may name accounts differently."""
        old = _item(db_session, "boa-old", BOFA, "Bank of America (Omer)", error="ITEM_LOGIN_REQUIRED")
        chk = _acct(db_session, old, "o1", "4574", "Adv SafeBalance Banking", acct_type="Checking")
        card = _acct(db_session, old, "o2", "7384", "Customized Cash Rewards Visa Signature")
        new = _item(db_session, "boa-new", BOFA, "Bank of America")
        outcome = link_plaid_accounts(db_session, new, [
            _pa("n1", "4574", "BofA Advantage SafeBalance Banking", subtype="checking", type_="depository"),
            _pa("n2", "7384", "Bank of America Customized Cash Rewards Visa Signature"),
        ])
        assert _by_status(outcome) == {RELINKED: [chk.id, card.id]}
        assert outcome.emptied_items == ["boa-old"]

    def test_renamed_but_two_candidates_is_not_guessed(self, db_session):
        old = _item(db_session, "x-old", "ins_x", "Bank X", error="ITEM_LOGIN_REQUIRED")
        _acct(db_session, old, "a", "1111", "Gold Card")
        _acct(db_session, old, "b", "1111", "Silver Card")
        new = _item(db_session, "x-new", "ins_x", "Bank X")
        outcome = link_plaid_accounts(db_session, new, [_pa("n", "1111", "Platinum Card")])
        assert [r["status"] for r in outcome.results] == [CREATED]

    def test_renamed_account_on_a_working_connection_is_not_taken(self, db_session):
        """Only a connection that is off or needs a login gives up its rows."""
        omer = _item(db_session, "amex-o", AMEX, "American Express (Omer)")
        gold = _acct(db_session, omer, "o1", "1000", "Business Gold Card")
        dani = _item(db_session, "amex-d", AMEX, "American Express (Daniella)")
        outcome = link_plaid_accounts(db_session, dani, [_pa("d1", "1000", "Gold Card")])
        assert [r["status"] for r in outcome.results] == [CREATED]
        assert gold.plaid_item_id == "amex-o"

    def test_adopts_rows_left_by_a_removed_connection(self, db_session):
        """Remove severs rows (no Plaid IDs) but keeps the bank's institution_id."""
        row = _acct(db_session, None, None, "7384", "Customized Cash Rewards Visa Signature")
        row.institution_id = BOFA
        db_session.commit()
        new = _item(db_session, "boa-new", BOFA, "Bank of America")
        outcome = link_plaid_accounts(db_session, new, [
            _pa("n2", "7384", "Customized Cash Rewards Visa Signature")])
        assert _by_status(outcome) == {RELINKED: [row.id]}

    def test_second_person_with_a_joint_account(self, db_session):
        """A joint account another working login already syncs is not added twice."""
        omer = _item(db_session, "chase-o", "ins_56", "Chase (Omer)")
        joint = _acct(db_session, omer, "o1", "8997", "Total Checking", acct_type="Checking")
        dani = _item(db_session, "chase-d", "ins_56", "Chase (Daniella)")
        outcome = link_plaid_accounts(db_session, dani, [
            _pa("d1", "8997", "Total Checking", subtype="checking", type_="depository"),
            _pa("d2", "3663", "Marriott Bonvoy Boundless Credit Card"),
        ])
        assert [r["status"] for r in outcome.results] == [ALREADY_TRACKED, CREATED]
        assert outcome.results[0]["tracked_by"] == "Chase (Omer)"
        assert outcome.duplicate_of is None
        assert joint.plaid_item_id == "chase-o" and joint.plaid_account_id == "o1"

    def test_same_last4_different_card_on_another_login(self, db_session):
        """Amex 1000 is Business Gold for Omer and Bonvoy Brilliant for Daniella."""
        omer = _item(db_session, "amex-o", AMEX, "American Express (Omer)")
        gold = _acct(db_session, omer, "o1", "1000", "Business Gold Card")
        dani = _item(db_session, "amex-d", AMEX, "American Express (Daniella)")
        outcome = link_plaid_accounts(db_session, dani, [
            _pa("d1", "1000", "Marriott Bonvoy Brilliant® American Express® Card")])
        assert [r["status"] for r in outcome.results] == [CREATED]
        assert gold.plaid_item_id == "amex-o"


# ── Reconnect a connection ───────────────────────────────────────────────────

def _amex_omer(db):
    item = _item(db, "amex-o", AMEX, "American Express (Omer)")
    rows = {
        "bbp": _acct(db, item, "bbp-old", "1008", "Blue Business Plus Card", name="Amex BBP 1008"),
        "hilton": _acct(db, item, "hh-old", "1008", "Hilton Honors Card", name="Hilton Honors 1008"),
        "plat": _acct(db, item, "plat-1", "1008", "Platinum Card®", name="Amex Platinum 1008"),
        "aspire": _acct(db, item, "asp-old", "2007", "Hilton Honors Aspire Card", name="Hilton Aspire 2007"),
        "gold": _acct(db, item, "gold-1", "1000", "Business Gold Card"),
        "hysa": _acct(db, item, "hysa-1", "1820", "High Yield Savings Account", acct_type="Savings"),
    }
    return item, rows


class TestReconnect:
    def test_same_ids_match_and_create_nothing(self, db_session):
        item = _item(db_session, "boa-o", BOFA, "Bank of America (Omer)", error="ITEM_LOGIN_REQUIRED")
        chk = _acct(db_session, item, "o1", "4574", "Adv SafeBalance Banking", acct_type="Checking")
        card = _acct(db_session, item, "o2", "7384", "Customized Cash Rewards Visa Signature")
        outcome = link_plaid_accounts(db_session, item, [
            _pa("o1", "4574", "Adv SafeBalance Banking", subtype="checking", type_="depository"),
            _pa("o2", "7384", "Customized Cash Rewards Visa Signature"),
        ])
        assert _by_status(outcome) == {MATCHED: [chk.id, card.id]}
        assert not outcome.created and not outcome.emptied_items

    def test_bank_hands_out_new_ids(self, db_session):
        """The Nov 8 Amex case: BBP and Aspire come back under new IDs."""
        item, rows = _amex_omer(db_session)
        outcome = link_plaid_accounts(db_session, item, [
            _pa("bbp-new", "1008", "Blue Business Plus Card"),
            _pa("plat-1", "1008", "Platinum Card®"),
            _pa("asp-new", "2007", "Hilton Honors Aspire Card"),
            _pa("gold-1", "1000", "Business Gold Card"),
            _pa("hysa-1", "1820", "High Yield Savings Account", subtype="savings", type_="depository"),
        ])
        st = _by_status(outcome)
        assert sorted(st[RELINKED]) == sorted([rows["bbp"].id, rows["aspire"].id])
        assert CREATED not in st
        assert rows["bbp"].plaid_account_id == "bbp-new"
        assert rows["aspire"].plaid_account_id == "asp-new"
        # The closed Hilton Honors 1008 is reported, not touched.
        assert [r["account_id"] for r in outcome.not_returned] == [rows["hilton"].id]
        assert rows["hilton"].plaid_account_id == "hh-old"

    def test_name_drift_with_a_single_candidate_and_no_name(self, db_session):
        item = _item(db_session, "td", "ins_14", "TD Bank")
        row = _acct(db_session, item, "old", "7553", None, name="TD Checking 7553", acct_type="Checking")
        outcome = link_plaid_accounts(db_session, item, [
            _pa("new", "7553", "TD BEYOND CHECKING", subtype="checking", type_="depository")])
        assert _by_status(outcome) == {RELINKED: [row.id]}

    def test_two_candidates_without_names_are_not_guessed(self, db_session):
        item = _item(db_session, "x", "ins_x", "Bank X")
        _acct(db_session, item, "a-old", "1111", None)
        _acct(db_session, item, "b-old", "1111", None)
        outcome = link_plaid_accounts(db_session, item, [_pa("a-new", "1111", None)])
        assert [r["status"] for r in outcome.results] == [CREATED]

    def test_persistent_id_wins(self, db_session):
        item = _item(db_session, "chase-o", "ins_56", "Chase (Omer)")
        row = _acct(db_session, item, "old", "8997", None, acct_type="Checking")
        row.persistent_account_id = "per-1"
        db_session.commit()
        outcome = link_plaid_accounts(db_session, item, [
            _pa("new", "9999", "Total Checking", subtype="checking", type_="depository",
                persistent="per-1")])
        assert _by_status(outcome) == {RELINKED: [row.id]}
        assert row.plaid_account_id == "new"


# ── Add cards to a connection ────────────────────────────────────────────────

class TestAddCards:
    def test_new_card_alongside_reissued_ids(self, db_session):
        """+ Add Account on Amex: Business Platinum is new, BBP gets a new ID."""
        item, rows = _amex_omer(db_session)
        outcome = link_plaid_accounts(db_session, item, [
            _pa("bbp-new", "1008", "Blue Business Plus Card"),
            _pa("plat-1", "1008", "Platinum Card®"),
            _pa("bizplat", "1007", "Business Platinum Card®"),
        ])
        st = _by_status(outcome)
        assert st[RELINKED] == [rows["bbp"].id]
        assert st[MATCHED] == [rows["plat"].id]
        assert len(st[CREATED]) == 1
        new = outcome.created[0]
        assert (new.mask, new.official_name, new.account_type) == ("1007", "Business Platinum Card®", "Credit Card")

    def test_new_card_sharing_last4_with_a_closed_card(self, db_session):
        """Different official name: never merged into the old card's history."""
        item, rows = _amex_omer(db_session)
        outcome = link_plaid_accounts(db_session, item, [
            _pa("bbp-new", "1008", "Blue Business Plus Card"),
            _pa("plat-1", "1008", "Platinum Card®"),
            _pa("delta", "1008", "Delta SkyMiles® Reserve Card"),
        ])
        st = _by_status(outcome)
        assert len(st[CREATED]) == 1
        assert rows["hilton"].plaid_account_id == "hh-old"

    def test_running_twice_changes_nothing(self, db_session):
        """update-complete links, then the background re-download links again."""
        item, rows = _amex_omer(db_session)
        accounts = [_pa("bbp-new", "1008", "Blue Business Plus Card"),
                    _pa("bizplat", "1007", "Business Platinum Card®")]
        link_plaid_accounts(db_session, item, accounts)
        db_session.commit()
        before = db_session.query(Account).count()
        again = link_plaid_accounts(db_session, item, accounts)
        assert {r["status"] for r in again.results} == {MATCHED}
        assert db_session.query(Account).count() == before


# ── End to end: reissued IDs + full re-download, no copied history ───────────

class _FakePlaid:
    def __init__(self, result):
        self.result = result

    def sync_transactions(self, access_token, cursor):
        return self.result


def test_full_redownload_after_new_ids_adds_no_duplicates(db_session):
    item, rows = _amex_omer(db_session)
    bbp = rows["bbp"]
    day = datetime(2026, 8, 11)
    desc = "UBER G.CO/HELPPAY#"
    db_session.add(Transaction(
        plaid_transaction_id="txn-old", account_id=bbp.id, date=day,
        year=day.year, month=day.month, day=day.day, amount=-85.00,
        description_raw=desc, description_clean="Uber", action="Expense",
        category_auto="Transportation", needs_review=False,
        content_hash=_assign_content_hash(db_session, bbp.id, day, -85.00, desc),
    ))
    db_session.commit()

    link_plaid_accounts(db_session, item, [_pa("bbp-new", "1008", "Blue Business Plus Card")])
    db_session.commit()

    sync_item = SimpleNamespace(access_token="tok", cursor=None,
                                institution_name="American Express (Omer)", last_synced_at=None)
    added = asyncio.run(_sync_item(sync_item, _FakePlaid({
        "added": [{"plaid_transaction_id": "txn-new", "plaid_account_id": "bbp-new",
                   "date": day, "amount": 85.00, "description_raw": desc,
                   "merchant_name": "Uber", "pending": False}],
        "modified": [], "removed": [], "next_cursor": "c1",
    }), db_session))

    assert added == 0
    rows_now = db_session.query(Transaction).all()
    assert len(rows_now) == 1
    assert rows_now[0].account_id == bbp.id and rows_now[0].plaid_transaction_id == "txn-new"
    assert db_session.query(Account).filter_by(mask="1008", is_active=True).count() == 3


# ── History check on full re-downloads (B41, Nov 8 2026) ─────────────────────

_PLAT_HISTORY = [  # (day, amount stored, description)
    (datetime(2026, 8, 10), -37.87, "AIR FRANCE"),
    (datetime(2026, 8, 12), -14.50, "RESY CREDIT"),
    (datetime(2026, 8, 20), -220.00, "SAKS FIFTH AVENUE"),
    (datetime(2026, 9, 3), -61.12, "LULULEMON"),
    (datetime(2026, 9, 15), -3.00, "NYCT PAYGO"),
    (datetime(2026, 10, 1), 6892.64, "AUTOPAY PAYMENT - THANK YOU"),
]


def _stored(db, acct, pid, day, amount, desc):
    db.add(Transaction(
        plaid_transaction_id=pid, account_id=acct.id, date=day,
        year=day.year, month=day.month, day=day.day, amount=amount,
        description_raw=desc, description_clean=desc.title(), action="Expense",
        category_auto="Shopping", needs_review=False,
        content_hash=_assign_content_hash(db, acct.id, day, amount, desc),
    ))
    db.commit()


def _incoming(plaid_acct, rows, prefix):
    return [{"plaid_transaction_id": f"{prefix}-{i}", "plaid_account_id": plaid_acct,
             "date": d, "amount": -amt, "description_raw": desc,
             "merchant_name": None, "pending": False}
            for i, (d, amt, desc) in enumerate(rows)]


def _full_sync(db, item, added):
    item.cursor = None
    db.commit()
    return asyncio.run(_sync_item(item, _FakePlaid({
        "added": added, "modified": [], "removed": [], "next_cursor": "c-next",
    }), db))


def test_reissued_id_named_after_a_sibling_card_lands_on_the_right_row(db_session):
    """Amex reissued Platinum 1008 under the name "Blue Business Plus Card"."""
    item, rows = _amex_omer(db_session)
    plat, bbp = rows["plat"], rows["bbp"]
    for i, r in enumerate(_PLAT_HISTORY):
        _stored(db_session, plat, f"old-plat-{i}", *r)
    _stored(db_session, bbp, "old-bbp-0", datetime(2026, 9, 9), -42.00, "OFFICE DEPOT")

    # The name step hands the reissued Platinum ID to BBP.
    out = link_plaid_accounts(db_session, item, [_pa("plat-new", "1008", "Blue Business Plus Card")])
    db_session.commit()
    assert out.results[0]["account_id"] == bbp.id

    repeat = (datetime(2026, 8, 10), -37.87, "AIR FRANCE")   # a real second ticket
    added = _full_sync(db_session, item, _incoming("plat-new", _PLAT_HISTORY + [repeat], "p"))

    db_session.refresh(plat); db_session.refresh(bbp)
    assert plat.plaid_account_id == "plat-new" and plat.is_active
    assert bbp.plaid_account_id is None and bbp.is_active   # keeps its own rows
    assert added == 1                                       # only the real repeat
    assert db_session.query(Transaction).filter_by(account_id=plat.id).count() == 7
    assert db_session.query(Transaction).filter_by(account_id=bbp.id).count() == 1
    assert item.cursor == "c-next" and item.last_error_code is None


def test_history_on_a_new_empty_row_moves_back_and_the_empty_row_is_switched_off(db_session):
    """What the old code did on Nov 8: a new row 176 for Platinum 1008."""
    from database import Card
    item, rows = _amex_omer(db_session)
    plat = rows["plat"]
    for i, r in enumerate(_PLAT_HISTORY):
        _stored(db_session, plat, f"old-plat-{i}", *r)
    copy = _acct(db_session, item, "plat-new", "1008", "Blue Business Plus Card",
                 name="Blue Business Plus Card 1008")
    card = Card(card_id="Blue Business Plus Card 1008", account_id=copy.id, is_active=True)
    db_session.add(card); db_session.commit()

    added = _full_sync(db_session, item, _incoming("plat-new", _PLAT_HISTORY, "p"))

    db_session.refresh(plat); db_session.refresh(copy); db_session.refresh(card)
    assert added == 0
    assert plat.plaid_account_id == "plat-new"
    assert not copy.is_active and copy.plaid_account_id is None and not card.is_active
    assert db_session.query(Transaction).filter_by(account_id=copy.id).count() == 0
    assert {t.plaid_transaction_id for t in
            db_session.query(Transaction).filter_by(account_id=plat.id)} == {f"p-{i}" for i in range(6)}


def test_history_split_between_two_rows_is_held_back_and_flagged(db_session):
    item, rows = _amex_omer(db_session)
    plat, hilton = rows["plat"], rows["hilton"]
    for i, r in enumerate(_PLAT_HISTORY[:3]):
        _stored(db_session, plat, f"old-plat-{i}", *r)
    for i, r in enumerate(_PLAT_HISTORY[3:]):
        _stored(db_session, hilton, f"old-hh-{i}", *r)
    copy = _acct(db_session, item, "plat-new", "1008", "Blue Business Plus Card", name="New 1008")

    added = _full_sync(db_session, item, _incoming("plat-new", _PLAT_HISTORY, "p"))

    db_session.refresh(copy)
    assert added == 0
    assert db_session.query(Transaction).filter_by(account_id=copy.id).count() == 0
    assert copy.plaid_account_id == "plat-new"        # nothing moved
    assert item.last_error_code == "ACCOUNT_MATCH_UNCLEAR" and item.cursor is None
    assert "New 1008" in item.last_error_message


def test_a_new_card_with_its_own_history_is_left_alone(db_session):
    item, rows = _amex_omer(db_session)
    for i, r in enumerate(_PLAT_HISTORY):
        _stored(db_session, rows["plat"], f"old-plat-{i}", *r)
    new = _acct(db_session, item, "biz-plat", "1007", "Business Platinum Card")
    fresh = [(datetime(2026, 10, 28), -8823.39, "CWT US LLC")] + [
        (datetime(2026, 10, d), -6.00 * d, f"MERCHANT {d}") for d in range(1, 6)]

    added = _full_sync(db_session, item, _incoming("biz-plat", fresh, "b"))

    db_session.refresh(new)
    assert added == 6 and new.plaid_account_id == "biz-plat" and new.is_active
    assert item.last_error_code is None


# ── Routes ───────────────────────────────────────────────────────────────────

class _RoutePlaid:
    """Stands in for PlaidService in routers/plaid_routes.py."""
    def __init__(self, accounts, item_id="new-item", inst=(BOFA, "Bank of America")):
        self.accounts = accounts
        self.item_id = item_id
        self.inst = inst
        self.removed = []

    def exchange_public_token(self, public_token):
        return {"access_token": "tok-new", "item_id": self.item_id}

    def get_accounts(self, access_token):
        return self.accounts

    def get_institution_info(self, access_token):
        return {"institution_id": self.inst[0], "name": self.inst[1]}

    def remove_item(self, access_token):
        self.removed.append(access_token)


def _patch_plaid(monkeypatch, fake):
    import routers.plaid_routes as pr
    monkeypatch.setattr(pr, "setup_plaid_from_env", lambda: fake)

    async def _no_background(*a, **k):
        return None
    monkeypatch.setattr(pr, "_sync_item_background", _no_background)


def test_exchange_refuses_a_login_that_is_already_connected(client, db_session, monkeypatch):
    old = _item(db_session, "boa-old", BOFA, "Bank of America (Omer)")
    _acct(db_session, old, "o2", "7384", "Customized Cash Rewards Visa Signature")
    fake = _RoutePlaid([_pa("n2", "7384", "Customized Cash Rewards Visa Signature")])
    _patch_plaid(monkeypatch, fake)

    r = client.post("/api/plaid/exchange-token", json={"public_token": "pub"})
    assert r.status_code == 409
    assert "Bank of America (Omer)" in r.json()["detail"]
    assert fake.removed == ["tok-new"]
    assert db_session.query(PlaidItem).filter_by(item_id="new-item").first() is None
    assert db_session.query(Account).count() == 1


def test_update_complete_keeps_history_and_clears_the_error(client, db_session, monkeypatch):
    item, rows = _amex_omer(db_session)
    item.last_error_code = "ITEM_LOGIN_REQUIRED"
    db_session.commit()
    fake = _RoutePlaid([_pa("bbp-new", "1008", "Blue Business Plus Card"),
                        _pa("bizplat", "1007", "Business Platinum Card®")])
    _patch_plaid(monkeypatch, fake)

    r = client.post(f"/api/plaid/update-complete/{item.item_id}")
    assert r.status_code == 200
    statuses = {a["account_id"]: a["status"] for a in r.json()["accounts"]}
    assert statuses[rows["bbp"].id] == RELINKED
    assert sorted(statuses.values()) == [CREATED, RELINKED]
    db_session.refresh(item)
    assert item.last_error_code is None
