"""
Tests for GET /api/cash-flow — verifies that only checking/savings/cash/HSA/FSA
accounts are included, credit cards are excluded, and inflows/outflows
are categorized correctly.
"""

from datetime import datetime
from tests.conftest import make_transaction


class TestCashFlowAccountInclusion:
    """Only depository / cash-type accounts should appear in cash flow."""

    def test_checking_included(
        self, client, db_session, seed_categories, checking_account
    ):
        make_transaction(db_session, checking_account, 5000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["inflows"] == 5000.0
        assert data["transaction_count"] == 1

    def test_savings_included(
        self, client, db_session, seed_categories, savings_account
    ):
        make_transaction(db_session, savings_account, 1000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["inflows"] == 1000.0

    def test_hsa_included(
        self, client, db_session, seed_categories, hsa_account
    ):
        make_transaction(db_session, hsa_account, 500.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["inflows"] == 500.0

    def test_credit_card_excluded(
        self, client, db_session, seed_categories, credit_card_account
    ):
        """Transactions on a credit card should NOT appear in cash flow."""
        make_transaction(db_session, credit_card_account, -80.00, "Expense", "Dining",
                         date=datetime(2025, 3, 10))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["transaction_count"] == 0
        assert data["inflows"] == 0
        assert data["outflows"] == 0

    def test_investment_account_excluded(
        self, client, db_session, seed_categories, investment_account
    ):
        """Investment accounts are not cash-flow eligible."""
        make_transaction(db_session, investment_account, 1000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["transaction_count"] == 0


class TestCashFlowInOutClassification:
    """Verify that inflows and outflows are categorized correctly."""

    def test_income_is_inflow(
        self, client, db_session, seed_categories, checking_account
    ):
        make_transaction(db_session, checking_account, 5000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["inflows"] == 5000.0
        assert data["income"] == 5000.0
        assert "Work" in data["by_inflow"]

    def test_expense_is_outflow(
        self, client, db_session, seed_categories, checking_account
    ):
        make_transaction(db_session, checking_account, -120.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["outflows"] == -120.0
        assert data["expenses"] == 120.0
        assert "Groceries" in data["by_outflow"]

    def test_net_calculation(
        self, client, db_session, seed_categories, checking_account
    ):
        make_transaction(db_session, checking_account, 5000.00, "Income", "Work",
                         date=datetime(2025, 3, 1))
        make_transaction(db_session, checking_account, -200.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["net"] == 4800.0
        assert data["inflows"] == 5000.0
        assert data["outflows"] == -200.0

    def test_transfer_outflow_cc_payment(
        self, client, db_session, seed_categories, checking_account
    ):
        """A Transfer with CC payment keywords should be categorized as CC payment."""
        make_transaction(
            db_session, checking_account, -500.00, "Transfer", "Transfer",
            date=datetime(2025, 3, 15),
            description_raw="CHASE CREDIT CRD AUTOPAY",
        )
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["cc_payments"] == 500.0
        assert "Credit Card Payments" in data["by_outflow"]

    def test_gcb_excluded_from_cash_flow(
        self, client, db_session, seed_categories, checking_account
    ):
        """GCB-tagged transactions should be excluded from cash flow."""
        make_transaction(db_session, checking_account, -100.00, "Expense", "Business",
                         date=datetime(2025, 3, 5), is_gcb=True)
        make_transaction(db_session, checking_account, -50.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 6))
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["transaction_count"] == 1
        assert data["outflows"] == -50.0

    def test_excluded_transactions_omitted(
        self, client, db_session, seed_categories, checking_account
    ):
        make_transaction(db_session, checking_account, -100.00, "Expense", "Groceries",
                         date=datetime(2025, 3, 5), is_excluded=True)
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        assert data["transaction_count"] == 0


class TestCashFlowResponseFormat:
    """Verify the response has the expected structure."""

    def test_empty_response_structure(self, client, db_session, seed_categories):
        """Even with no accounts, the response should have the right shape."""
        resp = client.get("/api/cash-flow", params={
            "start_date": "2025-03-01", "end_date": "2025-03-31"
        })
        data = resp.json()
        for key in ["start_date", "end_date", "inflows", "outflows", "net",
                     "income", "expenses", "cc_payments", "loan_repayments",
                     "transfers_between", "by_inflow", "by_outflow",
                     "transaction_count"]:
            assert key in data, f"Missing key: {key}"
