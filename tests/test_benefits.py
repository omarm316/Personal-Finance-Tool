"""
Tests for card benefits (core/benefits.py, routers/benefits.py) against
docs/cards-card-design.md: periods by calendar or card year, statement credits
matched by text, uses logged by hand or from a purchase, the year's totals,
expiring credits, the legacy backfill and the one-time Platinum update.
"""
import os
import sys
from datetime import date, datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import pytest

from core import benefits as BEN
from database import Account, BenefitUsage, Card, CardBenefit, CardProduct, Transaction

TODAY = date(2026, 11, 10)


@pytest.fixture(autouse=True)
def pin_today(monkeypatch):
    monkeypatch.setattr(BEN, 'today_', lambda: TODAY)


_seq = iter(range(1, 10_000))


def product(db, key=None):
    p = CardProduct(product_key=key or f'prod_{next(_seq)}', card_name='Test card')
    db.add(p)
    db.commit()
    return p


def card(db, p, issue=None):
    n = next(_seq)
    a = Account(account_name=f'Card {n}', account_type='Credit Card', is_active=True, is_manual=True,
                starting_balance=0.0, start_date=datetime(2025, 1, 1))
    db.add(a)
    db.flush()
    c = Card(card_id=f'TEST {n}', account_id=a.id, product_id=p.id, card_name='Test card', last_four=1000 + n,
             primary_user='Omer', is_active=True, issue_date=datetime.combine(issue, datetime.min.time()) if issue else None)
    db.add(c)
    db.commit()
    return c


def benefit(db, p, name='Resy dining credit', amount=100, cadence='quarterly', match='', year='calendar', every=None):
    b = CardBenefit(product_id=p.id, benefit_name=name, amount=amount, cadence=cadence, match_text=match,
                    year_type=year, every_years=every, remind=True, reset_frequency='annual', tracking_type='periodic')
    db.add(b)
    db.commit()
    return b


def txn(db, c, d, amount, desc='Platinum Resy Credit', action='Income', excluded=False):
    t = Transaction(account_id=c.account_id, card_id=c.id, amount=amount, action=action, description_raw=desc,
                    date=datetime(d.year, d.month, d.day), year=d.year, month=d.month, day=d.day,
                    is_excluded=excluded)
    db.add(t)
    db.commit()
    return t


def use(db, c, b, d, amount, txn_id=None):
    u = BenefitUsage(benefit_id=b.id, card_id=c.id, use_date=d, amount_used=amount, transaction_id=txn_id,
                     cycle=d.isoformat(), confirmed=True)
    db.add(u)
    db.commit()
    return u


def ben(pay, b):
    return next(x for x in pay['benefits'] if x['id'] == b.id)


def period(x, label):
    return next(p for p in x['periods'] if p['label'] == label)


# ── Periods ─────────────────────────────────────────────────────────────────
def test_calendar_periods_and_days_left(db_session):
    p = product(db_session)
    c = card(db_session, p)
    b = benefit(db_session, p)
    x = ben(BEN.for_card(db_session, c, today=TODAY), b)
    assert [q['label'] for q in x['periods']] == ['Q1', 'Q2', 'Q3', 'Q4']
    assert [q['status'] for q in x['periods']] == ['miss', 'miss', 'miss', 'open']
    assert x['end'] == '2026-12-31' and x['days_left'] == 52 and x['left'] == 100
    d = benefit(db_session, p, 'Digital', 25, 'monthly')
    m = ben(BEN.for_card(db_session, c, today=TODAY), d)
    assert len(m['periods']) == 12 and m['periods'][10]['label'] == 'Nov' and m['days_left'] == 21


def test_card_year_runs_from_the_anniversary(db_session):
    p = product(db_session)
    c = card(db_session, p, issue=date(2023, 5, 21))
    b = benefit(db_session, p, 'Free night', 200, 'annual', year='card')
    x = ben(BEN.for_card(db_session, c, today=TODAY), b)
    assert x['periods'][0]['start'] == '2026-05-21' and x['periods'][0]['end'] == '2027-05-20'
    assert x['periods'][0]['label'] == 'Card year' and x['days_left'] == 192
    s = benefit(db_session, p, 'Half', 50, 'semiannual', year='card')
    y = ben(BEN.for_card(db_session, c, today=TODAY), s)
    assert [(q['start'], q['end']) for q in y['periods']] == [('2026-05-21', '2026-11-20'), ('2026-11-21', '2027-05-20')]
    # No open date: falls back to the calendar and says so.
    c2 = card(db_session, p)
    assert BEN.for_card(db_session, c2, today=TODAY)['needs_open_date'] is True


# ── Statement credits ───────────────────────────────────────────────────────
def test_statement_credits_match_by_text_any_type(db_session):
    p = product(db_session)
    c, other = card(db_session, p), card(db_session, p)
    b = benefit(db_session, p, match='Platinum Resy Credit')
    txn(db_session, c, date(2026, 2, 25), 100)                                  # Q1
    txn(db_session, c, date(2026, 5, 3), 60, action='Transfer')                 # Q2, any type
    txn(db_session, c, date(2026, 5, 9), 40, excluded=True)                     # skipped
    txn(db_session, c, date(2026, 8, 1), -50)                                   # money out: not a credit
    txn(db_session, other, date(2026, 8, 2), 100)                               # another card
    x = ben(BEN.for_card(db_session, c, today=TODAY), b)
    assert x['tracked'] == 'auto'
    assert [(q['label'], q['used'], q['status']) for q in x['periods']] == [
        ('Q1', 100, 'full'), ('Q2', 60, 'part'), ('Q3', 0, 'miss'), ('Q4', 0, 'open')]
    assert period(x, 'Q1')['uses'][0]['kind'] == 'statement'


def test_the_longest_match_text_owns_a_credit(db_session):
    p = product(db_session)
    c = card(db_session, p)
    short = benefit(db_session, p, 'Any credit', 50, 'annual', match='Credit')
    long_ = benefit(db_session, p, 'Resy', 100, 'quarterly', match='Platinum Resy Credit')
    txn(db_session, c, date(2026, 10, 3), 100)
    pay = BEN.for_card(db_session, c, today=TODAY)
    assert ben(pay, long_)['periods'][3]['used'] == 100
    assert ben(pay, short)['periods'][0]['used'] == 0


def test_a_hand_mark_is_replaced_by_the_statement_credit(db_session):
    p = product(db_session)
    c = card(db_session, p)
    b = benefit(db_session, p, match='Platinum Resy Credit')
    use(db_session, c, b, date(2026, 10, 2), 100)          # marked used before it posted
    x = ben(BEN.for_card(db_session, c, today=TODAY), b)
    assert period(x, 'Q4')['used'] == 100                 # counts while waiting
    txn(db_session, c, date(2026, 10, 6), 100)
    q = period(ben(BEN.for_card(db_session, c, today=TODAY), b), 'Q4')
    assert q['used'] == 100                               # not 200
    assert [u['replaced'] for u in q['uses'] if u['kind'] == 'hand'] == [True]


def test_a_hand_mark_after_a_credit_still_counts(db_session):
    p = product(db_session)
    c = card(db_session, p)
    b = benefit(db_session, p, match='Platinum Resy Credit')
    txn(db_session, c, date(2026, 10, 6), 40)
    use(db_session, c, b, date(2026, 10, 20), 60)          # "the rest", not posted yet
    assert period(ben(BEN.for_card(db_session, c, today=TODAY), b), 'Q4')['used'] == 100
    txn(db_session, c, date(2026, 11, 2), 60)              # it posts
    assert period(ben(BEN.for_card(db_session, c, today=TODAY), b), 'Q4')['used'] == 100


def test_a_purchase_link_records_only_on_auto_tracked_credits(db_session):
    p = product(db_session)
    c = card(db_session, p)
    auto = benefit(db_session, p, match='Platinum Resy Credit')
    hand = benefit(db_session, p, 'Uber Cash', 15, 'monthly')
    buy = txn(db_session, c, date(2026, 10, 1), -106.78, desc="MARTHA'S", action='Expense')
    ride = txn(db_session, c, date(2026, 11, 3), -18.2, desc='UBER TRIP', action='Expense')
    use(db_session, c, auto, date(2026, 10, 1), 100, txn_id=buy.id)
    use(db_session, c, hand, date(2026, 11, 3), 15, txn_id=ride.id)
    pay = BEN.for_card(db_session, c, today=TODAY)
    assert period(ben(pay, auto), 'Q4')['used'] == 0       # waits for the statement credit
    assert period(ben(pay, hand), 'Nov')['used'] == 15     # by hand: counts
    txn(db_session, c, date(2026, 10, 4), 100)
    pay = BEN.for_card(db_session, c, today=TODAY)
    q = period(ben(pay, auto), 'Q4')
    st = next(u for u in q['uses'] if u['kind'] == 'statement')
    assert q['used'] == 100 and st['for_purchase']['desc'] == "MARTHA'S" and st['for_purchase']['amount'] == 106.78
    assert set(pay['linked_purchases']) == {str(buy.id), str(ride.id)}


# ── Totals and expiring ─────────────────────────────────────────────────────
def test_year_totals_reconcile(db_session):
    p = product(db_session)
    c = card(db_session, p)
    b = benefit(db_session, p, match='Platinum Resy Credit')
    txn(db_session, c, date(2026, 2, 25), 100)
    txn(db_session, c, date(2026, 5, 3), 150)              # more than the period: capped
    pay = BEN.for_card(db_session, c, today=TODAY)
    t = pay['totals']
    assert t == {'value': 400, 'used': 200, 'missed': 100, 'left': 100}
    assert t['value'] == t['used'] + t['missed'] + t['left']


def test_expiring_lists_open_credits_within_60_days(db_session):
    p = product(db_session)
    c = card(db_session, p)
    a = benefit(db_session, p, 'Digital', 25, 'monthly')                         # Nov 30: 21 days
    q = benefit(db_session, p, 'Resy', 100, 'quarterly')                         # Dec 31: 52 days
    y = benefit(db_session, p, 'Equinox', 300, 'annual')                         # Dec 31, larger
    h = benefit(db_session, p, 'Hotel', 300, 'semiannual', year='card')         # no open date: calendar
    benefit(db_session, p, 'Stay', 100, 'per_use')
    later = card(db_session, p, issue=date(2023, 3, 25))
    use(db_session, c, a, date(2026, 11, 2), 25)                                # Nov used
    pay = BEN.for_card(db_session, c, today=TODAY)
    names = [x['name'] for x in pay['expiring']['items']]
    assert names == ['Equinox', 'Hotel', 'Resy']                                 # same day: larger first
    assert pay['expiring']['total'] == 700 and pay['expiring']['next'] is None
    assert pay['order'][:3] == [y.id, h.id, q.id]
    # On a card opened Mar 25, the card-year half runs Sep 25 to Mar 24, so it's
    # the next credit after the 60 days rather than one of them.
    pay2 = BEN.for_card(db_session, later, today=TODAY)
    assert [x['name'] for x in pay2['expiring']['items']] == ['Digital', 'Equinox', 'Resy']
    assert pay2['expiring']['next']['name'] == 'Hotel' and pay2['expiring']['next']['end'] == '2027-03-24'
    allx = BEN.expiring_all(db_session, within=60)
    assert {x['card_id'] for x in allx} == {c.id, later.id}


def test_multi_year_credit(db_session):
    p = product(db_session)
    c = card(db_session, p)
    b = benefit(db_session, p, 'Global Entry', 120, 'multi_year', every=4)
    x = ben(BEN.for_card(db_session, c, today=TODAY), b)
    assert x['open'] and x['periods'] == [] and x['next_on'] is None
    use(db_session, c, b, date(2023, 6, 1), 120)
    x = ben(BEN.for_card(db_session, c, today=TODAY), b)
    assert not x['open'] and x['next_on'] == '2027-06-01'
    assert x['year_value'] == 0                                    # used in 2023, not this year


# ── Backfill and catalog ────────────────────────────────────────────────────
def test_backfill_maps_legacy_fields_and_dates_old_uses(db_session):
    p = product(db_session)
    c = card(db_session, p)
    rows = {}
    for name, freq, track in [('Dining', 'monthly', 'periodic'), ('Resort', 'semi-annual', 'periodic'),
                              ('Global Entry/TSA PreCheck', 'every_4.5_years', 'by_use'),
                              ('Per stay credit', 'annual', 'by_use'), ('CLEAR', 'calendar_year', 'periodic'),
                              ('Global Entry / TSA PreCheck / NEXUS', 'annual', 'periodic')]:
        b = CardBenefit(product_id=p.id, benefit_name=name, amount=50, reset_frequency=freq, tracking_type=track)
        db_session.add(b)
        rows[name] = b
    db_session.commit()
    u = BenefitUsage(benefit_id=rows['Resort'].id, card_id=c.id, cycle='2026-H2', amount_used=200, confirmed=True)
    db_session.add(u)
    db_session.commit()
    BEN.backfill(db_session)
    got = {n: (b.cadence, b.every_years, b.year_type) for n, b in rows.items()}
    assert got == {'Dining': ('monthly', None, 'calendar'), 'Resort': ('semiannual', None, 'calendar'),
                   'Global Entry/TSA PreCheck': ('multi_year', 4.5, 'calendar'),
                   'Per stay credit': ('per_use', None, 'calendar'), 'CLEAR': ('annual', None, 'calendar'),
                   'Global Entry / TSA PreCheck / NEXUS': ('multi_year', 4.0, 'calendar')}
    assert u.use_date == date(2026, 7, 1)


def test_platinum_update_runs_once_and_keeps_used_benefits(db_session):
    p = product(db_session, 'amex_platinum')
    c = card(db_session, p)
    old = {}
    for name in BEN.PLATINUM_OLD:
        b = CardBenefit(product_id=p.id, benefit_name=name, amount=100, reset_frequency='annual', tracking_type='periodic')
        db_session.add(b)
        old[name] = b
    db_session.add(CardBenefit(product_id=p.id, benefit_name='Centurion Lounge Access', amount=0, reset_frequency='annual'))
    db_session.commit()
    use(db_session, c, old['$200 Airline Fee Credit'], date(2026, 3, 1), 80)
    n = BEN.backfill(db_session)
    names = {b.benefit_name for b in db_session.query(CardBenefit).filter_by(product_id=p.id)}
    assert n['platinum'] == len(BEN.PLATINUM_2026)
    assert '$240 Digital Entertainment' not in names and '$100 Saks Credit' not in names
    assert '$200 Airline Fee Credit' in names               # has a logged use: kept for Omer to delete
    assert {'Hotel credit', 'Resy dining credit', 'Centurion Lounge Access'} <= names
    resy = db_session.query(CardBenefit).filter_by(product_id=p.id, benefit_name='Resy dining credit').one()
    assert (resy.amount, resy.cadence, resy.match_text) == (100, 'quarterly', 'Platinum Resy Credit')
    assert BEN.backfill(db_session)['platinum'] == 0         # once


def test_seed_leaves_edited_and_deleted_benefits_alone(db_session):
    from database import seed_card_products, seed_points_categories, seed_points_ecosystems
    seed_points_ecosystems(db_session)
    seed_points_categories(db_session)
    seed_card_products(db_session)
    p = db_session.query(CardProduct).filter_by(product_key='amex_platinum').one()
    rows = db_session.query(CardBenefit).filter_by(product_id=p.id).all()
    assert any(b.benefit_name == 'Resy dining credit' for b in rows)
    resy = next(b for b in rows if b.benefit_name == 'Resy dining credit')
    resy.amount = 90
    gone = next(b for b in rows if b.benefit_name == 'Oura Ring credit')
    db_session.delete(gone)
    db_session.commit()
    seed_card_products(db_session)
    rows = db_session.query(CardBenefit).filter_by(product_id=p.id).all()
    assert next(b for b in rows if b.benefit_name == 'Resy dining credit').amount == 90
    assert not any(b.benefit_name == 'Oura Ring credit' for b in rows)


# ── Routes ──────────────────────────────────────────────────────────────────
def test_routes_create_edit_mark_used_and_undo(client, db_session):
    p = product(db_session)
    c = card(db_session, p)
    r = client.post(f'/api/card-products/{p.id}/benefits', json={'benefit_name': 'Resy', 'amount': 100, 'cadence': 'quarterly'})
    assert r.status_code == 200
    bid = r.json()['id']
    assert client.post(f'/api/card-products/{p.id}/benefits', json={'benefit_name': '', 'amount': 5}).status_code == 400
    assert client.post(f'/api/card-products/{p.id}/benefits', json={'benefit_name': 'X', 'amount': 5, 'cadence': 'weekly'}).status_code == 400
    assert client.patch(f'/api/benefits/{bid}', json={'match_text': '  Platinum Resy Credit '}).status_code == 200
    pay = client.get(f'/api/cards/{c.id}/benefits').json()
    assert ben(pay, type('B', (), {'id': bid})) ['tracked'] == 'auto'
    txn(db_session, c, date(2026, 10, 6), 40)
    r = client.post(f'/api/cards/{c.id}/benefits/{bid}/mark-used', json={})
    assert r.status_code == 200 and r.json()['amount'] == 60
    q4 = r.json()['benefits']['benefits'][0]['periods'][3]
    assert q4['used'] == 100 and q4['status'] == 'full'
    assert client.post(f'/api/cards/{c.id}/benefits/{bid}/mark-used', json={}).status_code == 409
    undo = client.delete(f"/api/benefit-usage/{r.json()['use_id']}")
    assert undo.status_code == 200 and undo.json()['benefits']['benefits'][0]['periods'][3]['used'] == 40


def test_routes_log_a_use_from_a_purchase(client, db_session):
    p = product(db_session)
    c, other = card(db_session, p), card(db_session, p)
    b = benefit(db_session, p, 'Uber Cash', 15, 'monthly')
    ride = txn(db_session, c, date(2026, 10, 30), -18.2, desc='UBER TRIP', action='Expense')
    elsewhere = txn(db_session, other, date(2026, 10, 30), -9, desc='UBER TRIP', action='Expense')
    at = client.get(f'/api/cards/{c.id}/benefits', params={'for_date': '2026-10-30'}).json()['at_date'][str(b.id)]
    assert at == {'label': 'Oct', 'start': '2026-10-01', 'end': '2026-10-31', 'left': 15, 'used': 0}
    r = client.post(f'/api/cards/{c.id}/benefit-uses', json={'benefit_id': b.id, 'amount': 15, 'transaction_id': ride.id})
    assert r.status_code == 200
    oct_ = r.json()['benefits']['benefits'][0]['periods'][9]
    assert oct_['used'] == 15 and oct_['uses'][0]['purchase']['desc'] == 'UBER TRIP'
    assert client.post(f'/api/cards/{c.id}/benefit-uses', json={'benefit_id': b.id, 'amount': 9,
                                                              'transaction_id': elsewhere.id}).status_code == 400
    q = product(db_session)
    foreign = benefit(db_session, q, 'Other card', 10, 'monthly')
    assert client.post(f'/api/cards/{c.id}/benefit-uses', json={'benefit_id': foreign.id, 'amount': 5}).status_code == 404
    assert client.get('/api/benefits/expiring').status_code == 200


def test_a_late_credit_counts_toward_the_period_before(db_session):
    p = product(db_session)
    c = card(db_session, p)
    b = benefit(db_session, p, 'lululemon credit', 75, 'quarterly', match='Platinum Lululemon Credit')
    txn(db_session, c, date(2026, 4, 2), 75, desc='Platinum Lululemon Credit')   # for a March purchase
    txn(db_session, c, date(2026, 6, 20), 75, desc='Platinum Lululemon Credit')
    x = ben(BEN.for_card(db_session, c, today=TODAY), b)
    q1, q2 = period(x, 'Q1'), period(x, 'Q2')
    assert (q1['used'], q1['status'], q2['used'], q2['status']) == (75, 'full', 75, 'full')
    assert q1['uses'][0]['carried_from'] == 'Q2' and q2['uses'][0]['carried_to'] == 'Q1'
    assert BEN.for_card(db_session, c, today=TODAY)['totals']['used'] == 150
    at = BEN.for_card(db_session, c, today=TODAY, for_date=date(2026, 3, 15))['at_date'][str(b.id)]
    assert at['label'] == 'Q1' and at['left'] == 0


def test_periods_before_the_card_was_opened_dont_count(db_session):
    p = product(db_session)
    c = card(db_session, p, issue=date(2026, 7, 23))
    b = benefit(db_session, p, 'FedEx', 20, 'monthly')
    x = ben(BEN.for_card(db_session, c, today=TODAY), b)
    assert [q['status'] for q in x['periods'][:7]] == ['none'] * 6 + ['miss']   # Jan-Jun none, Jul missed
    assert x['year_value'] == 20 * 6 and x['year_missed'] == 20 * 4
