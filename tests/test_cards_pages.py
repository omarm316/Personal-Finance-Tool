"""
Tests for the rebuilt Cards pages' backend (Cards step 5): the cards row
(core/card_actions.wallet), the Actions strip (core/card_actions.actions,
docs/cards-actions-design.md), challenge Archive, Mark card as closed, the
Card page table's fields, the draft-rule preview and the kind rules' sign
(docs/cards-card-transactions-design.md).
"""
import os
import sys
from datetime import date, datetime, timedelta
from types import SimpleNamespace as NS

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import pytest

from core import benefits as BEN
from core import card_actions as CA
from core.merchant_classifier import _resolve_kind
from database import Account, Card, CardBenefit, CardProduct, PointsEcosystem, SpendChallenge, Transaction

TODAY = date.today()   # challenge status reads the real date, so the tests do too


@pytest.fixture(autouse=True)
def pin_today(monkeypatch):
    monkeypatch.setattr(BEN, 'today_', lambda: TODAY)


_seq = iter(range(1, 10_000))


def eco(db, name='Chase UR', cash=False):
    e = PointsEcosystem(name=name, currency_name=name, eco_type='bank', conservative_cpp=1, your_cpp=1, is_cash_back=cash)
    db.add(e)
    db.commit()
    return e


def product(db, e=None, key=None):
    p = CardProduct(product_key=key or f'prod_{next(_seq)}', card_name=f'Card {next(_seq)}', ecosystem_id=e.id if e else None)
    db.add(p)
    db.commit()
    return p


def card(db, p, owner='Omer', active=True, acct_active=True, mask=None):
    n = next(_seq)
    a = Account(account_name=f'Card {n}', account_type='Credit Card', is_active=acct_active, is_manual=True,
                starting_balance=0.0, start_date=datetime(2025, 1, 1), mask=mask or f'{n:04d}')
    db.add(a)
    db.flush()
    c = Card(card_id=f'TEST {n}', account_id=a.id, product_id=p.id, card_name=p.card_name, last_four=n,
             primary_user=owner, is_active=active, issue_date=datetime(2024, 1, 1))
    db.add(c)
    db.commit()
    return c


def charge(db, c, d, amount, desc='ZZQX STORE', merchant=None, action='Expense', **kw):
    t = Transaction(account_id=c.account_id, card_id=c.id, amount=amount, action=action, description_raw=desc,
                    merchant_name=merchant, date=datetime(d.year, d.month, d.day), year=d.year, month=d.month, day=d.day, **kw)
    db.add(t)
    db.commit()
    return t


def challenge(db, c, start, end, threshold=4000, bonus=60000, **kw):
    ch = SpendChallenge(card_id=c.id, name=kw.pop('name', 'Sign-up bonus'), challenge_type='sub', start_date=start, end_date=end,
                        bonus_type='flat', bonus_amount=bonus, spend_threshold=threshold, is_active=True, **kw)
    db.add(ch)
    db.commit()
    return ch


# ── Cards row ────────────────────────────────────────────────────────────────

class TestWallet:
    def test_open_cards_with_art_owner_and_program(self, db_session):
        db = db_session
        e = eco(db)
        p = product(db, e, key='chase_sapphire_preferred')
        c = card(db, p, owner='Daniella', mask='3698')
        closed = card(db, p)
        closed.is_active = False
        db.commit()
        card(db, p, acct_active=False)
        rows = CA.wallet(db)
        assert [r['account_id'] for r in rows] == [c.account_id]   # a closed card and a closed account leave the row
        r = rows[0]
        assert (r['mask'], r['owner'], r['product_key'], r['ecosystem_id'], r['ecosystem']) == \
            ('3698', 'Daniella', 'chase_sapphire_preferred', e.id, 'Chase UR')


# ── Actions strip ────────────────────────────────────────────────────────────

class TestActions:
    def test_credits_within_60_days_with_span_and_scope(self, db_session):
        db = db_session
        e1, e2 = eco(db, 'Amex MR'), eco(db, 'Hilton Honors')
        p1, p2 = product(db, e1), product(db, e2)
        c1, c2 = card(db, p1), card(db, p2)
        for p in (p1, p2):
            db.add(CardBenefit(product_id=p.id, benefit_name='Monthly credit', amount=25, cadence='monthly', match_text='',
                               year_type='calendar', remind=True, reset_frequency='monthly', tracking_type='periodic'))
        # Once a year, all of it left, resetting long after the window: the "Next" line.
        db.add(CardBenefit(product_id=p1.id, benefit_name='Yearly far', amount=300, cadence='multi_year', every_years=4,
                           match_text='', year_type='calendar', remind=True, reset_frequency='annual', tracking_type='by_use'))
        db.commit()
        a = CA.actions(db, today=TODAY)
        assert {(x['card_id'], x['name']) for x in a['credits']} == {(c1.id, 'Monthly credit'), (c2.id, 'Monthly credit')}
        x = a['credits'][0]
        last = (date(TODAY.year + (TODAY.month == 12), TODAY.month % 12 + 1, 1) - timedelta(days=1))
        assert x['end'] == last.isoformat() and x['span'] == last.day and x['days'] == (last - TODAY).days + 1   # today counts
        assert x['account_id'] and x['person'] == 'Omer' and x['left'] == 25
        assert a['credits_total'] == 50
        only = CA.actions(db, ecosystem_id=e2.id, today=TODAY)
        assert [x['card_id'] for x in only['credits']] == [c2.id]

    def test_challenge_at_risk_rules(self, db_session):
        db = db_session
        p = product(db, eco(db))
        c = card(db, p)
        # Ends within 30 days, not done: at risk.
        soon = challenge(db, c, TODAY - timedelta(days=60), TODAY + timedelta(days=10), name='Ends soon')
        # Plenty of time, but behind pace: 1/2 of the window gone and nothing spent.
        behind = challenge(db, c, TODAY - timedelta(days=90), TODAY + timedelta(days=90), name='Behind')
        # On pace: spent more than the share of the window gone.
        ok = challenge(db, c, TODAY - timedelta(days=10), TODAY + timedelta(days=170), threshold=1000, name='On pace')
        charge(db, c, TODAY - timedelta(days=2), -500)
        # Done: never at risk. Archived: never at risk.
        done = challenge(db, c, TODAY - timedelta(days=60), TODAY + timedelta(days=5), threshold=100, name='Done')
        arch = challenge(db, c, TODAY - timedelta(days=60), TODAY + timedelta(days=5), name='Archived', is_archived=True)
        a = CA.actions(db, today=TODAY)
        by = {x['name']: x for x in a['challenges']}
        assert by['Ends soon']['at_risk']                      # nothing spent either, so also behind pace
        assert by['Behind']['at_risk'] and by['Behind']['behind_pace']
        assert not by['On pace']['at_risk']
        assert by['Done']['done'] and not by['Done']['at_risk']
        assert by['Archived']['is_archived'] and not by['Archived']['at_risk']
        assert [x['name'] for x in a['at_risk']] == ['Ends soon', 'Behind']   # soonest first
        s = by['Ends soon']
        assert s['days_left'] == 10 and s['span'] == 71 and s['this_card_id'] == c.id

    def test_closed_card_leaves_the_strip(self, client, db_session):
        db = db_session
        p = product(db, eco(db))
        c = card(db, p)
        challenge(db, c, TODAY - timedelta(days=60), TODAY + timedelta(days=10))
        assert len(client.get('/api/cards/actions').json()['at_risk']) == 1
        r = client.patch(f'/api/cards/{c.id}', json={'is_active': False, 'close_date': TODAY.isoformat()})
        assert r.status_code == 200, r.text
        db.refresh(c)
        assert c.is_active is False and c.close_date.date() == TODAY
        assert client.get('/api/cards/actions').json()['at_risk'] == []
        assert client.get('/api/cards/wallet').json() == []


# ── Challenge archive ────────────────────────────────────────────────────────

def test_archive_a_challenge(client, db_session):
    c = card(db_session, product(db_session))
    ch = challenge(db_session, c, TODAY - timedelta(days=5), TODAY + timedelta(days=5))
    r = client.patch(f'/api/challenges/{ch.id}', json={'is_archived': True})
    assert r.status_code == 200 and r.json()['is_archived'] is True
    assert client.get(f'/api/challenges?card_id={c.id}').json()[0]['is_archived'] is True


# ── The Card page table ──────────────────────────────────────────────────────

def test_table_rows_name_their_type(client, db_session):
    db = db_session
    c = card(db, product(db))
    d = date(2026, 10, 3)
    charge(db, c, d, -13.81, 'WALMART')
    charge(db, c, d, 13.81, 'WALMART')
    charge(db, c, d, 100, 'PLATINUM RESY CREDIT')
    charge(db, c, d, -895, 'ANNUAL MEMBERSHIP FEE')
    charge(db, c, d, -3, 'INTEREST CHARGE ON PURCHASES')
    charge(db, c, d, -50, 'VENMO *JOHN')
    charge(db, c, d, 500, 'MOBILE PAYMENT - THANK YOU', action='Transfer')
    r = client.get(f'/api/accounts/{c.account_id}/transactions?year=2026&month=10&action=Expense').json()
    kinds = sorted((t['description'], t['kind']) for t in r['transactions'])
    assert kinds == sorted([('WALMART', 'purchase'), ('WALMART', 'refund'), ('PLATINUM RESY CREDIT', 'credit'),
                            ('ANNUAL MEMBERSHIP FEE', 'fee'), ('INTEREST CHARGE ON PURCHASES', 'interest'),
                            ('VENMO *JOHN', 'p2p')])                     # the card payment is left out
    assert r['total_count'] == 6
    t = r['transactions'][0]
    assert t['is_2027'] is False and t['points_overridden'] is False and 'merchant_category' in t


# ── Kind rules cover one direction ───────────────────────────────────────────

def test_kind_rule_follows_the_sign():
    back, out = NS(amount=20, description_raw='X', action='Expense'), NS(amount=-20, description_raw='X', action='Expense')
    assert _resolve_kind('purchase', back) == 'refund'
    assert _resolve_kind('purchase', out) == 'purchase'
    assert _resolve_kind('refund', out) == 'purchase'
    assert _resolve_kind('refund', back) == 'refund'


# ── 2027 rows: the sign check and the draft-rule preview ─────────────────────

@pytest.fixture()
def catalog(db_session):
    from core.earn_rules_seed import EARN_RULES, migrate_merchant_rules_once, seed_earning_catalog
    for key in EARN_RULES:
        db_session.add(CardProduct(product_key=key, card_name=key))
    db_session.commit()
    seed_earning_catalog(db_session)
    migrate_merchant_rules_once(db_session)
    return db_session


def spend27(db, c, amount, desc, merchant=None, d=date(2027, 1, 10)):
    from core.points_engine import _lock_points_for_transaction
    t = charge(db, c, d, amount, desc, merchant)
    _lock_points_for_transaction(db, t)
    db.commit()
    return t


def test_kind_must_fit_the_sign(client, catalog):
    db = catalog
    p = db.query(CardProduct).filter_by(product_key='chase_sapphire_preferred').one()
    c = card(db, p)
    t = spend27(db, c, -40, 'ZZQX STORE', 'Zzqx Store')
    assert client.patch(f'/api/transactions/{t.id}', json={'txn_kind': 'refund'}).status_code == 400
    r = client.patch(f'/api/transactions/{t.id}', json={'txn_kind': 'fee'})
    assert r.status_code == 200, r.text
    db.refresh(t)
    assert (t.txn_kind, t.points_earned) == ('fee', 0)


def test_rule_preview_writes_nothing(client, catalog):
    db = catalog
    p = db.query(CardProduct).filter_by(product_key='chase_sapphire_preferred').one()
    c = card(db, p)
    a = spend27(db, c, -100, 'CITY BISTRO NYC', 'City Bistro')
    b = spend27(db, c, -50, 'CITY BISTRO NYC', 'City Bistro', d=date(2027, 1, 12))
    spend27(db, c, -70, 'OTHER PLACE', 'Other Place')
    before = (a.points_earned, b.points_earned)
    r = client.post('/api/merchant-rules/preview', json={'pattern': 'CITY BISTRO', 'match_type': 'word',
                                                          'merchant_category': 'Dining'}).json()
    assert r['matches'] == 2 and set(r['changed_ids']) == {a.id, b.id}
    assert r['points_delta'] == (300 - before[0]) + (150 - before[1])   # Sapphire Preferred: 3x dining
    db.expire_all()
    assert (db.get(Transaction, a.id).points_earned, db.get(Transaction, b.id).points_earned) == before
    assert client.get('/api/merchant-rules?q=CITY').json() == []
    # Before a category is picked, it counts the matches only.
    m = client.post('/api/merchant-rules/preview', json={'pattern': 'CITY BISTRO'}).json()
    assert m['matches'] == 2 and m['changed_ids'] == []
