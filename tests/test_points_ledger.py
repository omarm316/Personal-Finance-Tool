"""
Tests for the points ledger (core/points_ledger.py, routers/points_ledger.py)
against docs/cards-ledger-design.md: statement lines, the first-statement rule,
whose points, balances, balance checks, opening balances and challenge bonuses.
"""
import os
import sys
from datetime import date, datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import pytest

from core.points_ledger import CHECK_REASON, NO_OWNER, all_programs, program_ledger
from database import (
    Account, Card, CardProduct, PersonPointsTransfer, PointsAdjustment, PointsBalanceSnapshot,
    PointsEcosystem, Redemption, SpendChallenge, Transaction, Transfer,
)

START = date(2026, 9, 1)
TODAY = date(2026, 11, 10)


@pytest.fixture(autouse=True)
def ledger_start(monkeypatch):
    monkeypatch.setenv('POINTS_LEDGER_START', START.isoformat())


_seq = iter(range(1, 10_000))


def program(db, name='Amex MR'):
    e = PointsEcosystem(name=name, currency_name=name, eco_type='Flexible')
    db.add(e)
    db.flush()
    p = CardProduct(product_key=f'prod_{e.id}', card_name=name, ecosystem_id=e.id)
    db.add(p)
    db.commit()
    return e, p


def card(db, product, owner='Omer', close_day=18, last_four=1008, name='Platinum'):
    n = next(_seq)
    a = Account(account_name=f'Card {n}', account_type='Credit Card', is_active=True, is_manual=True,
                starting_balance=0.0, start_date=datetime(2025, 1, 1))
    db.add(a)
    db.flush()
    c = Card(card_id=f'TEST {n}', account_id=a.id, product_id=product.id, card_name=name, last_four=last_four,
             statement_close_day=close_day, primary_user=owner, is_active=True)
    db.add(c)
    db.commit()
    return c


def charge(db, c, d, pts, spender=None, action='Expense', excluded=False):
    t = Transaction(account_id=c.account_id, card_id=c.id, amount=-10.0, action=action, description_raw='X',
                    date=datetime(d.year, d.month, d.day), year=d.year, month=d.month, day=d.day,
                    points_earned=pts, spender=spender, is_excluded=excluded)
    db.add(t)
    db.commit()
    return t


def opening(db, eco, person, bal):
    db.add(PointsBalanceSnapshot(ecosystem_id=eco.id, person=person, snapshot_date=START, balance=bal))
    db.commit()


class TestStatementLines:
    def test_one_line_per_statement_with_the_first_statement_rule(self, db_session):
        eco, prod = program(db_session)
        c = card(db_session, prod, close_day=18)
        charge(db_session, c, date(2026, 8, 10), 500)   # closes Aug 18, before the start: in the opening balance
        charge(db_session, c, date(2026, 8, 25), 30)    # closes Sep 18, so it posts on the first statement
        charge(db_session, c, date(2026, 9, 5), 70)
        charge(db_session, c, date(2026, 10, 20), 9)    # closes Nov 18: still pending on Nov 10
        L = program_ledger(db_session, eco.id, today=TODAY)
        earn = [e for e in L['entries'] if e['kind'] == 'earn']
        assert [(e['date'], e['pts'], e['status'], e['charges'], e['before_start']) for e in earn] == [
            ('2026-09-19', 100, 'posted', 2, 1),
            ('2026-11-19', 9, 'pending', 1, 0),
        ]
        assert earn[0]['statement_from'] == '2026-08-19' and earn[0]['statement_to'] == '2026-09-18'
        assert earn[0]['card_mask'] == '1008'
        b = L['balances']['Omer']
        assert (b['earned'], b['pending_cards'], b['current']) == (109, 9, 100)

    def test_card_with_no_close_day_gets_a_line_per_month(self, db_session):
        eco, prod = program(db_session)
        c = card(db_session, prod, close_day=None)
        charge(db_session, c, date(2026, 8, 30), 40)    # before the start, counted as charged
        charge(db_session, c, date(2026, 9, 2), 10)
        charge(db_session, c, date(2026, 9, 20), 15)
        charge(db_session, c, date(2026, 11, 3), 5)
        L = program_ledger(db_session, eco.id, today=TODAY)
        earn = [(e['date'], e['pts'], e['status'], e['monthly']) for e in L['entries'] if e['kind'] == 'earn']
        assert earn == [('2026-09-30', 25, 'posted', True), ('2026-11-10', 5, 'posted', True)]

    def test_excluded_rows_and_old_non_expense_rows_never_count(self, db_session):
        eco, prod = program(db_session)
        c = card(db_session, prod, close_day=18)
        charge(db_session, c, date(2026, 9, 5), 70)
        charge(db_session, c, date(2026, 9, 6), 99, excluded=True)
        charge(db_session, c, date(2026, 8, 25), 33, action='Income')   # before the start: only Expense rows had points
        L = program_ledger(db_session, eco.id, today=TODAY)
        assert sum(e['pts'] for e in L['entries'] if e['kind'] == 'earn') == 70

    def test_whose_points(self, db_session):
        eco, prod = program(db_session)
        mine = card(db_session, prod, owner='Omer')
        nobody = card(db_session, prod, owner=None, close_day=None, last_four=7957, name='Strata Premier')
        charge(db_session, mine, date(2026, 9, 5), 10)
        charge(db_session, mine, date(2026, 9, 6), 20, spender='Daniella')
        charge(db_session, nobody, date(2026, 9, 7), 30)
        L = program_ledger(db_session, eco.id, today=TODAY)
        assert L['people'] == ['Omer', 'Daniella']
        assert L['balances']['Omer']['current'] == 10 and L['balances']['Daniella']['current'] == 20
        assert L['no_owner'] == {'balance': 30, 'cards': ['Strata Premier 7957'],
                                 'accounts': [{'card_name': 'Strata Premier 7957', 'account_id': nobody.account_id}]}
        assert L['total']['current'] == 60


class TestBalances:
    def test_every_movement_from_the_opening_balance(self, db_session):
        eco, prod = program(db_session)
        hilton, _ = program(db_session, 'Hilton Honors')
        c = card(db_session, prod)
        opening(db_session, eco, 'Omer', 50_000)
        opening(db_session, eco, 'Daniella', 1_000)
        db_session.add(PointsBalanceSnapshot(ecosystem_id=eco.id, person='Omer', snapshot_date=date(2026, 7, 24), balance=9))
        charge(db_session, c, date(2026, 9, 5), 300)
        db_session.add_all([
            Redemption(ecosystem_id=eco.id, points_redeemed=10_000, redemption_date=date(2026, 10, 1),
                       description='Flight', cash_value_usd=150, person='Omer'),
            Transfer(source_ecosystem_id=eco.id, destination_ecosystem_id=hilton.id, points_sent=5_000,
                     base_ratio_used=2, points_received=10_000, transfer_date=date(2026, 10, 2), person='Omer'),
            PersonPointsTransfer(ecosystem_id=eco.id, from_person='Omer', to_person='Daniella', points=2_000,
                                 transfer_date=date(2026, 10, 3)),
            PointsAdjustment(ecosystem_id=eco.id, points_delta=1_500, adjustment_date=date(2026, 10, 4),
                             description='Stay', reason='Stay or flight', person='Daniella'),
            PointsAdjustment(ecosystem_id=eco.id, points_delta=999, adjustment_date=date(2026, 8, 4),
                             description='Before the start', reason='Other', person='Omer'),
        ])
        db_session.commit()
        L = program_ledger(db_session, eco.id, today=TODAY)
        o, d = L['balances']['Omer'], L['balances']['Daniella']
        assert o['opening'] == 50_000 and o['current'] == 50_000 + 300 - 10_000 - 5_000 - 2_000
        assert d['current'] == 1_000 + 2_000 + 1_500 and d['by_reason']['Stay or flight'] == 1_500
        assert L['total']['current'] == o['current'] + d['current']
        H = program_ledger(db_session, hilton.id, today=TODAY)
        assert H['entries'][0]['kind'] == 'xin' and H['entries'][0]['pts'] == 10_000
        # Balance after each line, for its person and for everyone
        last = [e for e in L['entries'] if e['status'] == 'posted'][-1]
        assert last['total_after'] == L['total']['current']


class TestRoutes:
    def _setup(self, db):
        eco, prod = program(db)
        c = card(db, prod)
        opening(db, eco, 'Omer', 10_000)
        charge(db, c, date(2026, 9, 5), 500)   # posts Sep 19
        return eco, c

    def test_balance_check_logs_the_gap(self, client, db_session):
        eco, _ = self._setup(db_session)
        r = client.post(f'/api/ecosystems/{eco.id}/balance-checks', json={'person': 'Omer', 'reported_balance': 10_712})
        assert r.status_code == 200, r.text
        assert r.json()['saved'] == {'person': 'Omer', 'app_had': 10_500, 'reported': 10_712, 'gap': 212}
        a = db_session.query(PointsAdjustment).one()
        assert (a.reason, a.points_delta, a.reported_balance) == (CHECK_REASON, 212, 10_712)
        r = client.post(f'/api/ecosystems/{eco.id}/balance-checks', json={'person': 'Omer', 'reported_balance': 10_712})
        assert r.json()['saved']['gap'] == 0          # a matching check is saved with 0
        assert r.json()['balances']['Omer']['current'] == 10_712
        assert r.json()['last_checks']['Omer']['gap'] == 0

    def test_checked_as_of_an_earlier_day(self, client, db_session):
        eco, _ = self._setup(db_session)
        r = client.post(f'/api/ecosystems/{eco.id}/balance-checks',
                        json={'person': 'Omer', 'reported_balance': 10_000, 'check_date': '2026-09-10'})
        assert r.json()['saved']['app_had'] == 10_000   # the statement posts Sep 19, after the check

    def test_writes_wait_for_the_start(self, client, db_session, monkeypatch):
        eco, _ = self._setup(db_session)
        monkeypatch.setenv('POINTS_LEDGER_START', '2027-01-01')
        r = client.post(f'/api/ecosystems/{eco.id}/balance-checks', json={'person': 'Omer', 'reported_balance': 1})
        assert r.status_code == 409
        r = client.put(f'/api/ecosystems/{eco.id}/opening-balances/Omer', json={'balance': 1})
        assert r.status_code == 409
        assert client.get(f'/api/ecosystems/{eco.id}/ledger').json()['active'] is False

    def test_opening_balance_is_set_and_edited(self, client, db_session):
        eco, _ = program(db_session)
        r = client.put(f'/api/ecosystems/{eco.id}/opening-balances/Daniella', json={'balance': 4_200})
        assert r.status_code == 200 and r.json()['balances']['Daniella']['opening'] == 4_200
        client.put(f'/api/ecosystems/{eco.id}/opening-balances/Daniella', json={'balance': 4_300})
        snaps = db_session.query(PointsBalanceSnapshot).filter_by(person='Daniella').all()
        assert [(s.snapshot_date, s.balance) for s in snaps] == [(START, 4_300)]

    def test_adjustment_with_a_reason(self, client, db_session):
        eco, _ = self._setup(db_session)
        r = client.post(f'/api/ecosystems/{eco.id}/points-adjustments',
                        json={'points_delta': -2_100, 'adjustment_date': '2026-10-30', 'reason': 'Points expired', 'person': 'Omer'})
        assert r.status_code == 200, r.text
        assert r.json()['reason'] == 'Points expired' and r.json()['description'] == 'Points expired'
        r = client.post(f'/api/ecosystems/{eco.id}/points-adjustments',
                        json={'points_delta': 1, 'adjustment_date': '2026-10-30', 'reason': 'Nope', 'person': 'Omer'})
        assert r.status_code == 400

    def test_challenge_bonus_waits_until_marked_posted(self, client, db_session):
        eco, c = self._setup(db_session)
        ch = SpendChallenge(card_id=c.id, name='Sign-up bonus', challenge_type='sub', start_date=date(2026, 8, 1),
                            end_date=date(2026, 11, 30), bonus_type='flat', bonus_amount=70_000,
                            spend_threshold=10_000, bonus_unlocked=True)
        rate = SpendChallenge(card_id=c.id, name='5x', challenge_type='rate_cap', start_date=date(2026, 10, 1),
                              end_date=date(2026, 12, 31), bonus_type='per_dollar', bonus_amount=4, bonus_unlocked=True)
        db_session.add_all([ch, rate])
        db_session.commit()
        L = client.get(f'/api/ecosystems/{eco.id}/ledger').json()
        bonus = [e for e in L['entries'] if e['kind'] == 'bonus']
        assert [(e['status'], e['pts'], e['challenge_id']) for e in bonus] == [('pending', 70_000, ch.id)]
        assert L['balances']['Omer']['pending_bonus'] == 70_000 and L['balances']['Omer']['current'] == 10_500
        r = client.post(f'/api/challenges/{ch.id}/bonus-posted', json={})
        assert r.status_code == 200, r.text
        assert r.json()['balances']['Omer']['current'] == 80_500
        assert client.post(f'/api/challenges/{ch.id}/bonus-posted', json={}).status_code == 409
        assert client.post(f'/api/challenges/{rate.id}/bonus-posted', json={}).status_code == 400
        r = client.delete(f'/api/challenges/{ch.id}/bonus-posted')
        assert r.json()['balances']['Omer']['pending_bonus'] == 70_000

    def test_portfolio_overview(self, client, db_session):
        eco, c = self._setup(db_session)
        prod = db_session.query(CardProduct).filter_by(ecosystem_id=eco.id).one()
        card(db_session, prod, owner='Daniella', last_four=1009)
        o = client.get('/api/points-ledger').json()
        p = o['programs'][0]
        assert (p['balance'], p['owners'], p['unset'], p['stale']) == (10_500, ['Omer', 'Daniella'], ['Daniella'], ['Omer', 'Daniella'])
        assert (o['opening_set'], o['opening_needed'], o['active']) == (1, 2, True)
