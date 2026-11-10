"""
Tests for Omer's two-level personal categories (2026-11-03): the starting
tree, the Settings editor (rename, move, hide, merge, delete), the checks on
category writes, top-level filtering and roll-ups, and the AI category list.
"""

from datetime import datetime
from unittest.mock import patch

import pytest

import database
from database import (
    BudgetTarget, CategorizationRule, Category, Transaction, TransactionSplit,
    LOCKED_CATEGORIES, STARTING_CATEGORY_TREE,
)
from core.categories import known_or_unclassified, parent_map, rollup, top_level, with_children
from tests.conftest import make_transaction, make_split


@pytest.fixture()
def tree(db_session):
    """The starting tree, seeded the way a fresh database gets it."""
    database.seed_categories(db_session)
    return {c.name: c for c in db_session.query(Category).all()}


def _cat_id(db_session, name):
    return db_session.query(Category).filter_by(name=name).one().id


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

class TestSeed:
    def test_empty_table_gets_the_tree(self, db_session, tree):
        assert len(tree) == len(STARTING_CATEGORY_TREE)
        assert tree['Airlines'].parent_category == 'Travel'
        assert tree['Travel'].parent_category is None
        assert tree['For Others'].parent_category == 'Other'

    def test_reseed_leaves_edits_alone(self, db_session, tree):
        tree['Books'].name = 'Reading'
        tree['Video Games'].is_active = False
        db_session.commit()
        database.seed_categories(db_session)
        names = {c.name: c for c in db_session.query(Category).all()}
        assert 'Reading' in names and 'Books' not in names
        assert names['Video Games'].is_active is False

    def test_missing_locked_category_comes_back(self, db_session, tree):
        db_session.delete(tree['Unclassified'])
        tree['Transfer'].is_active = False
        db_session.commit()
        database.seed_categories(db_session)
        names = {c.name: c for c in db_session.query(Category).all()}
        assert names['Unclassified'].is_active and names['Transfer'].is_active

    def test_every_locked_name_is_in_the_tree(self):
        assert LOCKED_CATEGORIES <= {name for name, _, _ in STARTING_CATEGORY_TREE}


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

class TestLookups:
    def test_parent_map_and_rollup(self, db_session, tree):
        pmap = parent_map(db_session)
        assert top_level('Hotels', pmap) == 'Travel'
        assert top_level('Groceries', pmap) == 'Groceries'
        assert top_level('Hidden Name', pmap) == 'Hidden Name'
        assert with_children('Vehicle', pmap) == {'Vehicle', 'Maintenance', 'Licensing', 'Auto Insurance'}
        assert rollup({'Hotels': 10, 'Airlines': 5.5, 'Travel': 1, 'Groceries': 2}, pmap) == \
            {'Travel': 16.5, 'Groceries': 2}

    def test_known_or_unclassified(self):
        assert known_or_unclassified('Dining', {'Dining'}) == 'Dining'
        assert known_or_unclassified('Home', {'Dining'}) == 'Unclassified'
        assert known_or_unclassified('', {'Dining'}) == ''


# ---------------------------------------------------------------------------
# The Settings editor
# ---------------------------------------------------------------------------

class TestEditor:
    def test_list_has_parents_and_locks(self, client, tree):
        cats = {c['name']: c for c in client.get('/api/categories').json()}
        assert cats['Hotels']['parent_category'] == 'Travel'
        assert cats['Work']['is_locked'] and not cats['Hotels']['is_locked']

    def test_rename_carries_every_use(self, client, db_session, tree, checking_account):
        t = make_transaction(db_session, checking_account, -40, 'Expense', 'Books')
        t.category_manual = 'Books'
        parent = make_transaction(db_session, checking_account, -30, 'Expense', 'Dining', is_split=True)
        make_split(db_session, parent, -30, 'Books')
        db_session.add(CategorizationRule(pattern='KINDLE', match_type='contains', set_category='Books'))
        db_session.add(BudgetTarget(year=2026, month=1, category='Books', amount=20))
        db_session.add(BudgetTarget(year=2026, month=1, category='Reading', amount=5))   # collides after rename
        db_session.commit()

        resp = client.patch(f"/api/categories/{_cat_id(db_session, 'Books')}", json={'name': 'Reading'})
        assert resp.status_code == 200, resp.text
        assert resp.json()['renamed'] == {'transactions': 1, 'splits': 1, 'rules': 1, 'budget_targets': 1}
        db_session.expire_all()
        t = db_session.get(Transaction, t.id)
        assert (t.category_auto, t.category_manual) == ('Reading', 'Reading')
        assert db_session.query(TransactionSplit).one().category == 'Reading'
        assert db_session.query(CategorizationRule).one().set_category == 'Reading'
        assert [(b.category, b.amount) for b in db_session.query(BudgetTarget).all()] == [('Reading', 25)]

    def test_renaming_a_top_level_moves_its_children(self, client, db_session, tree):
        assert client.patch(f"/api/categories/{_cat_id(db_session, 'Family')}", json={'name': 'Household'}).status_code == 200
        db_session.expire_all()
        assert {c.parent_category for c in db_session.query(Category).filter(Category.name.in_(['Kids', 'Gifts']))} == {'Household'}

    def test_names_stay_unique(self, client, db_session, tree):
        resp = client.post('/api/categories', json={'name': 'hotels', 'parent_category': 'Travel'})
        assert resp.status_code == 400

    def test_locked_categories_refuse_changes(self, client, db_session, tree):
        for body in ({'name': 'Salary'}, {'parent_category': 'Other'}, {'is_active': False}):
            assert client.patch(f"/api/categories/{_cat_id(db_session, 'Work')}", json=body).status_code == 400

    def test_create_under_a_top_level(self, client, db_session, tree):
        resp = client.post('/api/categories', json={'name': 'Cruises', 'parent_category': 'Travel'})
        assert resp.status_code == 200, resp.text
        assert resp.json()['parent_category'] == 'Travel'
        # a sub-category can't be a parent: two levels only
        assert client.post('/api/categories', json={'name': 'X', 'parent_category': 'Hotels'}).status_code == 400

    def test_move_rules(self, client, db_session, tree):
        hotels = _cat_id(db_session, 'Hotels')
        assert client.patch(f'/api/categories/{hotels}', json={'parent_category': 'Other'}).json()['parent_category'] == 'Other'
        assert client.patch(f'/api/categories/{hotels}', json={'parent_category': ''}).json()['parent_category'] is None
        # a top level with sub-categories can't go under another one
        assert client.patch(f"/api/categories/{_cat_id(db_session, 'Travel')}", json={'parent_category': 'Other'}).status_code == 400

    def test_hide_needs_children_hidden_first(self, client, db_session, tree):
        assert client.patch(f"/api/categories/{_cat_id(db_session, 'Vehicle')}", json={'is_active': False}).status_code == 400
        assert client.patch(f"/api/categories/{_cat_id(db_session, 'Licensing')}", json={'is_active': False}).status_code == 200
        names = {c['name'] for c in client.get('/api/categories').json()}
        assert 'Licensing' not in names
        manage = {c['name']: c for c in client.get('/api/categories/manage').json()}
        assert manage['Licensing']['is_active'] is False

    def test_merge_moves_everything_and_removes_the_source(self, client, db_session, tree, checking_account):
        make_transaction(db_session, checking_account, -12, 'Expense', 'Video Games')
        resp = client.post(f"/api/categories/{_cat_id(db_session, 'Video Games')}/merge", json={'into': 'Entertainment'})
        assert resp.status_code == 200, resp.text
        db_session.expire_all()
        assert db_session.query(Category).filter_by(name='Video Games').first() is None
        assert db_session.query(Transaction).one().category_auto == 'Entertainment'

    def test_delete_only_when_unused(self, client, db_session, tree, checking_account):
        make_transaction(db_session, checking_account, -12, 'Expense', 'Video Games')
        assert client.delete(f"/api/categories/{_cat_id(db_session, 'Video Games')}").status_code == 400
        assert client.delete(f"/api/categories/{_cat_id(db_session, 'Books')}").status_code == 200

    def test_manage_counts_use_the_final_category(self, client, db_session, tree, checking_account):
        t = make_transaction(db_session, checking_account, -12, 'Expense', 'Dining')
        t.category_manual = 'Food Delivery'
        db_session.commit()
        manage = {c['name']: c for c in client.get('/api/categories/manage').json()}
        assert manage['Food Delivery']['transactions'] == 1
        assert manage['Dining']['transactions'] == 0

    def test_reorder(self, client, db_session, tree):
        resp = client.post('/api/categories/reorder', json={'names': ['Travel', 'Hotels', 'Airlines']})
        assert resp.status_code == 200
        names = [c['name'] for c in client.get('/api/categories').json()]
        assert names[:3] == ['Travel', 'Hotels', 'Airlines']


# ---------------------------------------------------------------------------
# Writes, filters and roll-ups
# ---------------------------------------------------------------------------

class TestTransactions:
    def test_unknown_category_is_refused(self, client, db_session, tree, checking_account):
        t = make_transaction(db_session, checking_account, -10, 'Expense', 'Dining')
        assert client.patch(f'/api/transactions/{t.id}', json={'category': 'Insurance'}).status_code == 400
        assert client.patch(f'/api/transactions/{t.id}', json={'category': 'Food Delivery'}).status_code == 200

    def test_category_edit_leaves_points_alone(self, client, db_session, tree, credit_card_account):
        t = make_transaction(db_session, credit_card_account, -10, 'Expense', 'Dining')
        t.points_earned, t.points_earn_rate = 123.0, 4.0
        db_session.commit()
        assert client.patch(f'/api/transactions/{t.id}', json={'category': 'Food Delivery'}).status_code == 200
        db_session.expire_all()
        t = db_session.get(Transaction, t.id)
        assert (t.points_earned, t.points_earn_rate) == (123.0, 4.0)

    def test_filter_by_top_level_includes_sub_categories(self, client, db_session, tree, checking_account):
        make_transaction(db_session, checking_account, -300, 'Expense', 'Airlines')
        make_transaction(db_session, checking_account, -200, 'Expense', 'Travel')
        make_transaction(db_session, checking_account, -50, 'Expense', 'Dining')
        rows = client.get('/api/transactions', params={'category': 'Travel'}).json()
        assert sorted(r['category_final'] for r in rows) == ['Airlines', 'Travel']
        rows = client.get('/api/transactions', params={'category': 'Airlines'}).json()
        assert [r['category_final'] for r in rows] == ['Airlines']

    def test_split_categories_are_checked(self, client, db_session, tree, checking_account):
        t = make_transaction(db_session, checking_account, -20, 'Expense', 'Dining')
        bad = {'splits': [{'amount': -10, 'category': 'Dining'}, {'amount': -10, 'category': 'Nope'}]}
        assert client.post(f'/api/transactions/{t.id}/splits', json=bad).status_code == 400

    def test_stats_and_budget_roll_up_to_top_levels(self, client, db_session, tree, checking_account):
        make_transaction(db_session, checking_account, -300, 'Expense', 'Airlines', date=datetime(2026, 3, 1))
        make_transaction(db_session, checking_account, -200, 'Expense', 'Hotels', date=datetime(2026, 3, 2))
        make_transaction(db_session, checking_account, -50, 'Expense', 'Groceries', date=datetime(2026, 3, 3))
        stats = client.get('/api/stats', params={'year': 2026}).json()
        assert stats['by_top_level'] == {'Travel': 500.0, 'Groceries': 50.0}
        actuals = client.get('/api/budget/actuals', params={'year': 2026}).json()
        assert actuals['top_levels']['Travel'] == {'3': 500.0}
        assert actuals['categories']['Airlines'] == {'3': 300.0}
        detail = client.get('/api/stats/detail', params={'category': 'Travel', 'year': 2026}).json()
        assert detail['count'] == 2 and detail['total'] == 500.0
        # The Dashboard's detail list shows each row's own category and its account
        assert sorted(r['category'] for r in detail['rows']) == ['Airlines', 'Hotels']
        assert all(r['account'] == checking_account.account_name and 'merchant' in r for r in detail['rows'])

    def test_budget_target_needs_a_known_category(self, client, tree):
        assert client.post('/api/budget/targets', json={'year': 2026, 'month': 1, 'category': 'Nope', 'amount': 5}).status_code == 400
        assert client.post('/api/budget/targets', json={'year': 2026, 'month': 1, 'category': 'Hotels', 'amount': 5}).status_code == 200


# ---------------------------------------------------------------------------
# The AI categorizer
# ---------------------------------------------------------------------------

class TestAiCategories:
    def test_answer_must_be_in_the_list_it_was_given(self):
        import llm_service
        names = ['Dining', 'Food Delivery', 'Unclassified', 'For Others']
        with patch.object(llm_service, '_call_llm', return_value={'merchant_name': 'Wolt', 'category': 'Food Delivery'}) as call:
            out = llm_service.enrich_transaction('WOLT TEL AVIV', categories=names, api_key='x')
        assert out['category'] == 'Food Delivery'
        assert call.call_args.args[2] == names
        with patch.object(llm_service, '_call_llm', return_value={'merchant_name': 'X', 'category': 'Insurance'}):
            assert llm_service.enrich_transaction('X', categories=names, api_key='x')['category'] == 'Unclassified'
        with patch.object(llm_service, '_call_llm', return_value={'merchant_name': 'Mom', 'category': 'Parents'}):
            assert llm_service.enrich_transaction('X', categories=names, api_key='x')['category'] == 'For Others'

    def test_prompt_lists_the_categories(self):
        import llm_service
        prompt = llm_service._system_prompt(['Travel', 'Airlines'])
        assert '"Airlines"' in prompt and 'most specific' in prompt
