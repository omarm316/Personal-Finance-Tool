"""
Tests for GET /api/stats — income/expense totals, credit-netting,
GCB exclusion, split handling, and date filtering.
"""

from datetime import datetime
from tests.conftest import make_transaction, make_split


# ---------------------------------------------------------------------------
# Basic totals
# ---------------------------------------------------------------------------

class TestBasicTotals:
    """Verify that simple income and expense transactions produce correct totals."""

    def test_single_expense(self, client, db_session, seed_categories, checking_account):
        """A single expense transaction should appear in total_expenses."""
        make_transaction(db_session, checking_account, -50.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 10))
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_expenses"] == 50.0
        assert data["total_income"] == 0.0
        assert data["by_category"]["Groceries"] == 50.0

    def test_single_income(self, client, db_session, seed_categories, checking_account):
        """A single income transaction should appear in total_income."""
        make_transaction(db_session, checking_account, 3000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_income"] == 3000.0
        assert data["total_expenses"] == 0.0

    def test_mixed_income_and_expenses(self, client, db_session, seed_categories, checking_account):
        """Multiple transactions should be summed correctly."""
        make_transaction(db_session, checking_account, 5000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        make_transaction(db_session, checking_account, -200.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5))
        make_transaction(db_session, checking_account, -100.00, "Expense", "Dining",
                         date=datetime(2025, 3, 10))
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_income"] == 5000.0
        assert data["total_expenses"] == 300.0
        assert data["by_category"]["Groceries"] == 200.0
        assert data["by_category"]["Dining"] == 100.0


# ---------------------------------------------------------------------------
# Credit-netting: Income-action txns in expense-type categories offset expenses.
# ---------------------------------------------------------------------------

class TestCreditNetting:
    """
    When a transaction has action=Income but lands in an expense-type category
    (e.g. a Dining refund), it should reduce total_expenses — NOT increase
    total_income.
    """

    def test_refund_offsets_expense(self, client, db_session, seed_categories, checking_account):
        # Normal dining expense
        make_transaction(db_session, checking_account, -80.00, "Expense", "Dining",
                         date=datetime(2025, 3, 5))
        # Dining refund coded as Income
        make_transaction(db_session, checking_account, 20.00, "Income", "Dining",
                         date=datetime(2025, 3, 8))

        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        # Dining net: 80 charge - 20 refund = 60
        assert data["total_expenses"] == 60.0
        assert data["total_income"] == 0.0
        assert data["by_category"]["Dining"] == 60.0

    def test_income_in_income_category_counts_as_income(
        self, client, db_session, seed_categories, checking_account
    ):
        """Work is an income category, so Income-action should count as income."""
        make_transaction(db_session, checking_account, 5000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_income"] == 5000.0
        assert data["total_expenses"] == 0.0

    def test_income_in_both_category_offsets_expense(
        self, client, db_session, seed_categories, checking_account
    ):
        """
        'Business' is category_type='both' (which is in the expense cats set).
        An Income-action Business refund should offset expenses.
        """
        make_transaction(db_session, checking_account, -500.00, "Expense", "Business",
                         date=datetime(2025, 3, 2))
        make_transaction(db_session, checking_account, 100.00, "Income", "Business",
                         date=datetime(2025, 3, 5))

        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_expenses"] == 400.0
        assert data["total_income"] == 0.0


# ---------------------------------------------------------------------------
# GCB / excluded transactions
# ---------------------------------------------------------------------------

class TestGcbExcluded:
    """Transactions flagged as GCB or excluded should not appear in totals."""

    def test_is_gcb_excluded(self, client, db_session, seed_categories, checking_account):
        make_transaction(db_session, checking_account, -100.00, "Expense", "Business",
                         date=datetime(2025, 3, 5), is_gcb=True)
        make_transaction(db_session, checking_account, -50.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 6))
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_expenses"] == 50.0

    def test_gcb_tagged_excluded(self, client, db_session, seed_categories, checking_account):
        make_transaction(db_session, checking_account, -100.00, "Expense", "Business",
                         date=datetime(2025, 3, 5), gcb_tagged=True)
        make_transaction(db_session, checking_account, -50.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 6))
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_expenses"] == 50.0

    def test_is_excluded_flag(self, client, db_session, seed_categories, checking_account):
        make_transaction(db_session, checking_account, -100.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5), is_excluded=True)
        make_transaction(db_session, checking_account, -25.00, "Expense", "Dining",
                         date=datetime(2025, 3, 6))
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_expenses"] == 25.0


# ---------------------------------------------------------------------------
# Split transaction handling
# ---------------------------------------------------------------------------

class TestSplitTransactions:
    """
    When a transaction has is_split=True, its own amount is ignored and the
    child TransactionSplit rows are used instead.
    """

    def test_split_amounts_used(self, client, db_session, seed_categories, checking_account):
        parent = make_transaction(
            db_session, checking_account, -100.00, "Expense", "Other",
            date=datetime(2025, 3, 10), is_split=True,
        )
        make_split(db_session, parent, -60.00, "Groceries")
        make_split(db_session, parent, -40.00, "Dining")

        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        # -(-60) + -(-40) = 100
        assert data["total_expenses"] == 100.0
        assert data["by_category"]["Groceries"] == 60.0
        assert data["by_category"]["Dining"] == 40.0

    def test_split_gcb_lines_excluded(self, client, db_session, seed_categories, checking_account):
        """GCB split lines should be skipped."""
        parent = make_transaction(
            db_session, checking_account, -100.00, "Expense", "Other",
            date=datetime(2025, 3, 10), is_split=True,
        )
        make_split(db_session, parent, -60.00, "Groceries")
        make_split(db_session, parent, -40.00, "Business", is_gcb=True)

        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_expenses"] == 60.0
        assert "Business" not in data["by_category"]

    def test_split_uses_parent_category_as_fallback(
        self, client, db_session, seed_categories, checking_account
    ):
        """If a split has no category, use parent's category_final."""
        parent = make_transaction(
            db_session, checking_account, -80.00, "Expense", "Dining",
            date=datetime(2025, 3, 10), is_split=True,
        )
        make_split(db_session, parent, -50.00, "Groceries")
        make_split(db_session, parent, -30.00, None)  # should inherit "Dining"

        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_expenses"] == 80.0
        assert data["by_category"]["Groceries"] == 50.0
        assert data["by_category"]["Dining"] == 30.0


# ---------------------------------------------------------------------------
# Month/year filtering
# ---------------------------------------------------------------------------

class TestDateFiltering:
    def test_year_month_filter(self, client, db_session, seed_categories, checking_account):
        make_transaction(db_session, checking_account, -50.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 10))
        make_transaction(db_session, checking_account, -75.00, "Expense", "Dining",
                         date=datetime(2025, 4, 10))

        # March only
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_expenses"] == 50.0

        # April only
        resp = client.get("/api/stats", params={"year": 2025, "month": 4})
        data = resp.json()
        assert data["total_expenses"] == 75.0

    def test_start_end_date_filter(self, client, db_session, seed_categories, checking_account):
        make_transaction(db_session, checking_account, -50.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5))
        make_transaction(db_session, checking_account, -75.00, "Expense", "Dining",
                         date=datetime(2025, 3, 20))

        # Only first half of March
        resp = client.get("/api/stats", params={
            "start_date": "2025-03-01", "end_date": "2025-03-10"
        })
        data = resp.json()
        assert data["total_expenses"] == 50.0

    def test_transfers_not_counted(self, client, db_session, seed_categories, checking_account):
        """Transfer actions should be excluded from stats totals (not in BUDGET_TYPES)."""
        make_transaction(db_session, checking_account, -500.00, "Transfer", "Transfer",
                         date=datetime(2025, 3, 5))
        make_transaction(db_session, checking_account, -30.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5))
        resp = client.get("/api/stats", params={"year": 2025, "month": 3})
        data = resp.json()
        assert data["total_expenses"] == 30.0
        assert data["total_income"] == 0.0
