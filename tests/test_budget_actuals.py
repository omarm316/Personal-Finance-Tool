"""
Tests for GET /api/budget/actuals — verifies that budget actuals match
stats expenses and that credit-netting is consistent between the two
endpoints.
"""

from datetime import datetime
from tests.conftest import make_transaction, make_split


class TestBudgetActualsBasic:
    """Basic budget actuals calculations."""

    def test_single_expense(self, client, db_session, seed_categories, checking_account):
        make_transaction(db_session, checking_account, -120.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 15))

        resp = client.get("/api/budget/actuals", params={"year": 2025})
        assert resp.status_code == 200
        data = resp.json()
        assert data["year"] == 2025
        cats = data["categories"]
        assert cats["Groceries"]["3"] == 120.0

    def test_multiple_months(self, client, db_session, seed_categories, checking_account):
        make_transaction(db_session, checking_account, -100.00, "Expense", "Groceries",
                         date=datetime(2025, 1, 10))
        make_transaction(db_session, checking_account, -200.00, "Expense", "Groceries",
                         date=datetime(2025, 2, 10))
        make_transaction(db_session, checking_account, -50.00, "Expense", "Dining",
                         date=datetime(2025, 2, 15))

        resp = client.get("/api/budget/actuals", params={"year": 2025})
        data = resp.json()
        cats = data["categories"]
        assert cats["Groceries"]["1"] == 100.0
        assert cats["Groceries"]["2"] == 200.0
        assert cats["Dining"]["2"] == 50.0

    def test_gcb_excluded(self, client, db_session, seed_categories, checking_account):
        """GCB transactions should be excluded from actuals."""
        make_transaction(db_session, checking_account, -100.00, "Expense", "Business",
                         date=datetime(2025, 3, 5), is_gcb=True)
        make_transaction(db_session, checking_account, -50.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 6))
        resp = client.get("/api/budget/actuals", params={"year": 2025})
        data = resp.json()
        cats = data["categories"]
        assert "Business" not in cats
        assert cats["Groceries"]["3"] == 50.0

    def test_gcb_tagged_excluded(self, client, db_session, seed_categories, checking_account):
        """Legacy gcb_tagged flag should also exclude."""
        make_transaction(db_session, checking_account, -100.00, "Expense", "Business",
                         date=datetime(2025, 3, 5), gcb_tagged=True)
        resp = client.get("/api/budget/actuals", params={"year": 2025})
        data = resp.json()
        assert "Business" not in data["categories"]

    def test_excluded_flag(self, client, db_session, seed_categories, checking_account):
        make_transaction(db_session, checking_account, -100.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5), is_excluded=True)
        resp = client.get("/api/budget/actuals", params={"year": 2025})
        data = resp.json()
        assert data["categories"] == {}


class TestBudgetActualsSplits:
    """Split transactions in budget actuals."""

    def test_split_amounts(self, client, db_session, seed_categories, checking_account):
        parent = make_transaction(
            db_session, checking_account, -150.00, "Expense", "Other",
            date=datetime(2025, 3, 10), is_split=True,
        )
        make_split(db_session, parent, -100.00, "Groceries")
        make_split(db_session, parent, -50.00, "Dining")

        resp = client.get("/api/budget/actuals", params={"year": 2025})
        cats = resp.json()["categories"]
        assert cats["Groceries"]["3"] == 100.0
        assert cats["Dining"]["3"] == 50.0

    def test_split_gcb_lines_excluded(self, client, db_session, seed_categories, checking_account):
        parent = make_transaction(
            db_session, checking_account, -200.00, "Expense", "Other",
            date=datetime(2025, 3, 10), is_split=True,
        )
        make_split(db_session, parent, -120.00, "Groceries")
        make_split(db_session, parent, -80.00, "Business", is_gcb=True)

        resp = client.get("/api/budget/actuals", params={"year": 2025})
        cats = resp.json()["categories"]
        assert cats["Groceries"]["3"] == 120.0
        assert "Business" not in cats


class TestBudgetActualsCreditNetting:
    """
    Credit-netting must be consistent between /stats and /budget/actuals.
    An Income-action transaction in an expense-type category offsets that
    category's spend in BOTH endpoints.
    """

    def test_refund_offsets_in_actuals(
        self, client, db_session, seed_categories, checking_account
    ):
        """A dining refund (Income action, Dining cat) should reduce the Dining actual."""
        make_transaction(db_session, checking_account, -80.00, "Expense", "Dining",
                         date=datetime(2025, 3, 5))
        make_transaction(db_session, checking_account, 20.00, "Income", "Dining",
                         date=datetime(2025, 3, 8))

        resp = client.get("/api/budget/actuals", params={"year": 2025})
        cats = resp.json()["categories"]
        # Net = 80 - 20 = 60
        assert cats["Dining"]["3"] == 60.0

    def test_stats_and_actuals_match(
        self, client, db_session, seed_categories, checking_account
    ):
        """
        The sum of all expense-category actuals for a month should equal
        total_expenses from /stats for that same month.
        """
        make_transaction(db_session, checking_account, 5000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        make_transaction(db_session, checking_account, -200.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5))
        make_transaction(db_session, checking_account, -100.00, "Expense", "Dining",
                         date=datetime(2025, 3, 10))
        # Dining refund — should offset expenses, not add to income
        make_transaction(db_session, checking_account, 30.00, "Income", "Dining",
                         date=datetime(2025, 3, 12))

        # Get stats
        stats = client.get("/api/stats", params={"year": 2025, "month": 3}).json()

        # Get actuals
        actuals_resp = client.get("/api/budget/actuals", params={"year": 2025}).json()
        cats = actuals_resp["categories"]

        # Sum all expense-category actuals for month 3
        expense_cats = {c.name for c in db_session.query(
            __import__("database").Category
        ).filter(
            __import__("database").Category.category_type.in_(["expense", "both"])
        ).all()}

        actuals_total = 0.0
        for cat_name, months in cats.items():
            if cat_name in expense_cats and "3" in months:
                actuals_total += months["3"]

        assert abs(stats["total_expenses"] - actuals_total) < 0.01

    def test_split_credit_netting_consistent(
        self, client, db_session, seed_categories, checking_account
    ):
        """Credit-netting also works through split transactions."""
        # A split refund where action=Income on an expense category
        parent = make_transaction(
            db_session, checking_account, 50.00, "Income", "Other",
            date=datetime(2025, 3, 10), is_split=True,
        )
        make_split(db_session, parent, 30.00, "Dining")
        make_split(db_session, parent, 20.00, "Groceries")

        # Normal expenses
        make_transaction(db_session, checking_account, -100.00, "Expense", "Dining",
                         date=datetime(2025, 3, 5))
        make_transaction(db_session, checking_account, -80.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 6))

        stats = client.get("/api/stats", params={"year": 2025, "month": 3}).json()
        actuals = client.get("/api/budget/actuals", params={"year": 2025}).json()

        # Stats: Dining = 100 - 30 = 70, Groceries = 80 - 20 = 60, total = 130
        assert stats["total_expenses"] == 130.0
        assert stats["by_category"]["Dining"] == 70.0
        assert stats["by_category"]["Groceries"] == 60.0

        # Actuals should match
        assert actuals["categories"]["Dining"]["3"] == 70.0
        assert actuals["categories"]["Groceries"]["3"] == 60.0
