"""
Tests for the 2027 earning engine (core/merchant_classifier.py,
core/earn_engine.py, routers/earning.py) against
docs/cards-categorization-rules.md. The stateless rate table lives in
docs/categorization_engine_check.py; these cover what needs a database:
caps, top categories, selections, refunds, the fresh-start switch and the API.
"""
import os
import sys
from datetime import date, datetime
from types import SimpleNamespace as NS

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import pytest

from core.earn_engine import forget_earning_cache
from core.earn_rules_seed import initial_merchant_rules, migrate_merchant_rules_once, seed_earning_catalog
from core.merchant_classifier import Catalog, RuleIndex, classify_transaction
from core.points_engine import _lock_points_for_transaction
from database import (
    Account, Card, CardCategorySelection, CardProduct, CardProductReward, MerchantCategory,
    PointsCategory, Transaction,
)

INDEX = RuleIndex.from_dicts(initial_merchant_rules())
CAT = Catalog.from_seed()


def _classify(desc, merchant=None, amount=-10.0, action='Expense', pfc=None):
    t = NS(merchant_name=merchant, description_raw=desc, amount=amount, action=action,
           pfc_detailed=pfc, merchant_country=None, classification_source=None, is_foreign=None,
           txn_kind=None, brand=None, merchant_category=None, merchant_rule_id=None)
    classify_transaction(t, INDEX, CAT)
    return t


# ── Classifier (no database) ──────────────────────────────────────────────────

class TestClassifier:
    def test_whole_words_only(self):
        assert _classify('LAZ PARKING 123', 'LAZ Parking').merchant_category == 'Transit'
        assert _classify('KINGS #3626', 'Kings').merchant_category == 'Groceries'
        assert _classify('T-MOBILE AUTOPAY X', 'T-Mobile', amount=-80).merchant_category == 'Wireless'
        assert _classify('DAVIS DELI', 'Davis Deli').merchant_category is None   # not "avis"

    def test_longest_pattern_wins(self):
        gift = _classify('DD *DOORDASH GIFTCARDS', 'DoorDash')
        food = _classify('DD *DOORDASH', 'DoorDash')
        assert (gift.merchant_category, gift.brand) == ('Gift Cards', None)
        assert (food.merchant_category, food.brand) == ('Dining', 'DoorDash')
        assert _classify('UBER EATS', 'Uber Eats').brand == 'Uber Eats'
        assert _classify('COSTCO GAS #1', 'Costco Gas').merchant_category == 'Gas Stations'

    def test_portal_contains_match_and_brand_default(self):
        t = _classify('AMEX Fine Hotels andAmexTravel.com')
        assert (t.merchant_category, t.brand) == ('Portal', 'Amex Travel')
        assert _classify('WALMART.COM', 'Walmart').merchant_category == 'Superstores'

    def test_plaid_fallback_and_unknown(self):
        t = _classify('TST* CITY BISTRO', 'City Bistro', pfc='FOOD_AND_DRINK_RESTAURANT')
        assert (t.merchant_category, t.classification_source) == ('Dining', 'plaid')
        u = _classify('ZZQX STORE', 'Zzqx Store')
        assert (u.merchant_category, u.classification_source) == (None, 'none')

    def test_kinds(self):
        assert _classify('ANNUAL MEMBERSHIP FEE', amount=-450).txn_kind == 'fee'
        assert _classify('ANNUAL FEE REFUND', amount=95).txn_kind == 'credit'
        assert _classify('INTEREST CHARGE ON PURCHASES', amount=-3).txn_kind == 'interest'
        assert _classify('PLATINUM HOTEL CREDIT', amount=300).txn_kind == 'credit'
        assert _classify('CREDIT KARMA PLUS', 'Credit Karma', amount=-10).txn_kind == 'purchase'
        assert _classify('MOBILE PAYMENT - THANK YOU', amount=500).txn_kind == 'payment'
        assert _classify('VENMO *JOHN', 'Venmo', amount=-50).txn_kind == 'p2p'
        assert _classify('OFFER 05 MOVED TO STANDARD PURCH', 'Moved', amount=-1210).txn_kind == 'adjustment'
        assert _classify('AMAZON MKTPLACE PMTS', 'Amazon', amount=20).txn_kind == 'refund'


# ── Engine (in-memory SQLite) ─────────────────────────────────────────────────

@pytest.fixture()
def catalog(db_session):
    """Every product in EARN_RULES, then the earning catalog and rule list."""
    from core.earn_rules_seed import EARN_RULES
    for key in EARN_RULES:
        db_session.add(CardProduct(product_key=key, card_name=key))
    db_session.commit()
    seed_earning_catalog(db_session)
    migrate_merchant_rules_once(db_session)
    return db_session


_acct_seq = iter(range(1, 10_000))


def make_card(db, product_key, issuer='CHASE', close_day=None):
    n = next(_acct_seq)
    acct = Account(account_name=f'Card {n}', account_type='Credit Card', is_active=True, is_manual=True,
                   starting_balance=0.0, start_date=datetime(2025, 1, 1))
    db.add(acct)
    db.flush()
    product = db.query(CardProduct).filter_by(product_key=product_key).one()
    card = Card(card_id=f'TEST {n}', account_id=acct.id, product_id=product.id, issuer=issuer,
                network='VISA', statement_close_day=close_day, is_active=True)
    db.add(card)
    db.commit()
    return card


def spend(db, card, amount, desc, merchant=None, d=date(2027, 1, 10), **kw):
    t = Transaction(account_id=card.account_id, card_id=card.id, amount=amount, action='Expense',
                    description_raw=desc, merchant_name=merchant, date=datetime(d.year, d.month, d.day),
                    year=d.year, month=d.month, day=d.day, **kw)
    db.add(t)
    db.flush()
    _lock_points_for_transaction(db, t)
    db.commit()
    return t


class TestEngine:
    def test_fresh_start_switch(self, catalog):
        db = catalog
        card = make_card(db, 'chase_sapphire_preferred')
        # Old catalog: Walmart is a Groceries L2 and CSP pays Groceries +2.
        db.add_all([PointsCategory(name='Groceries'), PointsCategory(name='Walmart', parent_key='Groceries')])
        db.flush()
        groceries = db.query(PointsCategory).filter_by(name='Groceries').one()
        db.add_all([CardProductReward(product_id=card.product_id, multiplier=1, is_base_rate=True),
                    CardProductReward(product_id=card.product_id, points_category_id=groceries.id, multiplier=2)])
        db.commit()

        old = spend(db, card, -100, 'WALMART', 'Walmart', d=date(2026, 12, 31), points_category='Walmart')
        new = spend(db, card, -100, 'WALMART', 'Walmart', d=date(2027, 1, 1))
        assert old.points_earned == 300 and old.merchant_category is None and old.txn_kind is None
        assert new.points_earned == 100 and new.merchant_category == 'Superstores'
        assert new.points_category == 'Walmart'          # display label mirrored for old pages

    def test_food_delivery_earns_dining(self, catalog):
        db = catalog
        aspire = make_card(db, 'hilton_aspire', issuer='AMEX')
        strata = make_card(db, 'citi_strata_premier', issuer='CITI')
        assert spend(db, aspire, -100, 'DD *DOORDASH', 'DoorDash').points_earned == 700
        assert spend(db, strata, -100, 'UBER EATS', 'Uber Eats').points_earned == 300

    def test_retired_category_folds_into_dining(self, catalog):
        from database import Brand, MerchantRule
        db = catalog
        old = MerchantCategory(name='Food Delivery', display_order=31)
        db.add(old)
        db.flush()
        db.query(Brand).filter_by(name='DoorDash').update({'default_category_id': old.id})
        rule = MerchantRule(pattern='postmates', merchant_category_id=old.id)
        db.add(rule)
        card = make_card(db, 'chase_sapphire_preferred')
        t = spend(db, card, -20, 'SEAMLESS NYC', 'Seamless')
        t.merchant_category = t.points_category = 'Food Delivery'
        db.commit()

        seed_earning_catalog(db)
        dining = db.query(MerchantCategory).filter_by(name='Dining').one()
        assert db.query(MerchantCategory).filter_by(name='Food Delivery').first() is None
        assert db.query(Brand).filter_by(name='DoorDash').one().default_category_id == dining.id
        assert db.get(MerchantRule, rule.id).merchant_category_id == dining.id
        assert (t.merchant_category, t.points_category) == ('Dining', 'Dining')
        seed_earning_catalog(db)                         # second run is a no-op

    def test_fees_and_credits_earn_zero(self, catalog):
        card = make_card(catalog, 'hilton_aspire', issuer='AMEX')
        fee = spend(catalog, card, -550, 'RENEWAL MEMBERSHIP FEE')
        credit = spend(catalog, card, 50, 'AMEX AIRLINE FEE REIMBURSEMENT')
        assert (fee.points_earned, fee.points_earn_classification) == (0, 'excluded')
        assert (credit.txn_kind, credit.points_earned) == ('credit', 0)

    def test_domestic_only_and_amex_rounding(self, catalog):
        card = make_card(catalog, 'hilton_aspire', issuer='AMEX')
        home = spend(catalog, card, -4.66, 'STARBUCKS #1', 'Starbucks')
        abroad = spend(catalog, card, -100, 'STARBUCKS TLV', 'Starbucks', merchant_country='IL')
        assert home.points_earned == 35                  # $4.66 rounds to $5, at 7x
        assert abroad.points_earned == 300 and abroad.is_foreign is True

    def test_cap_and_late_arrival(self, catalog):
        db = catalog
        card = make_card(db, 'marriott_bonvoy_boundless')
        a = spend(db, card, -5000, 'KINGS #1', 'Kings', d=date(2027, 1, 10))
        b = spend(db, card, -2000, 'KINGS #1', 'Kings', d=date(2027, 2, 1))
        assert (a.points_earned, b.points_earned) == (15000, 1000 * 3 + 1000 * 2)
        late = spend(db, card, -1000, 'KINGS #1', 'Kings', d=date(2027, 1, 5))
        db.refresh(a), db.refresh(b)
        assert (late.points_earned, a.points_earned, b.points_earned) == (3000, 15000, 4000)

    def test_top_category_follows_the_cycle(self, catalog):
        db = catalog
        card = make_card(db, 'citi_custom_cash', issuer='CITI', close_day=10)
        dining = spend(db, card, -300, 'STARBUCKS #1', 'Starbucks', d=date(2027, 1, 15))
        groc1 = spend(db, card, -200, 'KINGS #1', 'Kings', d=date(2027, 1, 16))
        assert (dining.points_earned, groc1.points_earned) == (1500, 200)
        groc2 = spend(db, card, -400, 'KINGS #1', 'Kings', d=date(2027, 1, 20))
        db.refresh(dining), db.refresh(groc1)
        # Groceries ($600) now beat Dining ($300); the $500 cap runs out mid-purchase.
        assert (dining.points_earned, groc1.points_earned, groc2.points_earned) == (300, 1000, 300 * 5 + 100)
        next_cycle = spend(db, card, -100, 'STARBUCKS #1', 'Starbucks', d=date(2027, 2, 11))
        assert next_cycle.points_earned == 500

    def test_rotating_selection(self, catalog):
        db = catalog
        card = make_card(db, 'chase_freedom_flex')
        groceries = db.query(MerchantCategory).filter_by(name='Groceries').one()
        db.add(CardCategorySelection(card_id=card.id, slot='rotating', merchant_category_id=groceries.id,
                                     period_start=date(2027, 1, 1), period_end=date(2027, 3, 31)))
        db.commit()
        forget_earning_cache(db)
        q1a = spend(db, card, -1000, 'KINGS #1', 'Kings', d=date(2027, 2, 1))
        q1b = spend(db, card, -1000, 'KINGS #1', 'Kings', d=date(2027, 3, 1))
        q2 = spend(db, card, -1000, 'KINGS #1', 'Kings', d=date(2027, 4, 1))
        assert (q1a.points_earned, q1b.points_earned, q2.points_earned) == (5000, 500 * 5 + 500, 1000)

    def test_bilt_choice_is_seeded(self, catalog):
        card = make_card(catalog, 'bilt_obsidian', issuer='BILT')
        seed_earning_catalog(catalog)                    # KNOWN_SELECTIONS needs the card to exist
        forget_earning_cache(catalog)
        assert spend(catalog, card, -100, 'KINGS #1', 'Kings').points_earned == 300

    def test_refunds(self, catalog):
        db = catalog
        card = make_card(db, 'chase_sapphire_preferred')
        spend(db, card, -100, 'STARBUCKS #1', 'Starbucks', d=date(2027, 1, 5))
        matched = spend(db, card, 40, 'STARBUCKS #1', 'Starbucks', d=date(2027, 1, 8))
        unmatched = spend(db, card, 40, 'WALMART', 'Walmart', d=date(2027, 1, 8))
        assert (matched.points_earned, matched.points_earn_classification) == (-120, 'clawback')
        assert unmatched.points_earned == -40           # no purchase found: its own path rate
        # A 2026 purchase refunded in 2027 reverses at what it earned then.
        old = Transaction(account_id=card.account_id, card_id=card.id, amount=-50, action='Expense',
                          description_raw='TARGET', merchant_name='Target', date=datetime(2026, 12, 20),
                          points_earned=150, points_earn_rate=3, points_locked_at=datetime(2026, 12, 21))
        db.add(old)
        db.commit()
        refund = spend(db, card, 50, 'TARGET', 'Target', d=date(2027, 1, 5))
        assert refund.points_earned == -150

    def test_capped_base_rate(self, catalog):
        card = make_card(catalog, 'amex_blue_business_plus', issuer='AMEX')
        a = spend(catalog, card, -49000, 'ZZQX STORE', 'Zzqx Store', d=date(2027, 3, 1))
        b = spend(catalog, card, -2000, 'ZZQX STORE', 'Zzqx Store', d=date(2027, 4, 1))
        assert (a.points_earned, b.points_earned) == (98000, 1000 * 2 + 1000)


# ── API ───────────────────────────────────────────────────────────────────────

class TestApi:
    def test_review_list_and_recalculation(self, client, catalog):
        db = catalog
        card = make_card(db, 'chase_sapphire_preferred')
        t = spend(db, card, -100, 'ZZQX STORE', 'Zzqx Store')
        assert t.points_earned == 100

        review = client.get('/api/earning/review').json()
        assert review['total'] == 1 and review['rows'][0]['id'] == t.id

        assert client.post('/api/merchant-rules', json={'pattern': 'Zzqx Store',
                                                         'merchant_category': 'Dining'}).status_code == 200
        preview = client.post('/api/earning/recalculate', json={'card_id': card.id}).json()
        assert preview['rows_changed'] == 1 and preview['points_after'] == 300
        db.refresh(t)
        assert t.points_earned == 100                    # preview wrote nothing

        applied = client.post('/api/earning/recalculate', json={'card_id': card.id, 'apply': True}).json()
        assert applied['applied'] and applied['points_after'] == 300
        db.refresh(t)
        assert (t.points_earned, t.merchant_category) == (300, 'Dining')
        assert client.get('/api/earning/review').json()['total'] == 0

    def test_patch_merchant_path(self, client, catalog):
        db = catalog
        card = make_card(db, 'hilton_aspire', issuer='AMEX')
        old = spend(db, card, -100, 'ZZQX STORE', d=date(2026, 12, 1))
        new = spend(db, card, -100, 'ZZQX STORE', d=date(2027, 1, 2))

        r = client.patch(f'/api/transactions/{old.id}', json={'brand': 'Hilton'})
        assert r.status_code == 400

        r = client.patch(f'/api/transactions/{new.id}', json={'brand': 'Hilton'})
        assert r.status_code == 200, r.text
        db.refresh(new)
        assert (new.brand, new.merchant_category, new.classification_source) == ('Hilton', 'Hotels', 'manual')
        assert new.points_earned == 1400

        # The old Merchant Category dropdown still works on 2027 rows.
        r = client.patch(f'/api/transactions/{new.id}', json={'points_category': 'Rideshare: Uber'})
        assert r.status_code == 200, r.text
        db.refresh(new)
        assert (new.brand, new.merchant_category, new.points_earned) == ('Uber', 'Transit', 300)

    def test_selection_endpoint_checks_slot(self, client, catalog):
        card = make_card(catalog, 'chase_freedom_flex')
        bad = client.post(f'/api/cards/{card.id}/category-selections',
                          json={'slot': 'choice', 'merchant_category': 'Groceries', 'period_start': '2027-01-01'})
        assert bad.status_code == 400
        ok = client.post(f'/api/cards/{card.id}/category-selections',
                         json={'slot': 'rotating', 'merchant_category': 'Groceries',
                               'period_start': '2027-01-01', 'period_end': '2027-03-31'})
        assert ok.status_code == 200, ok.text
