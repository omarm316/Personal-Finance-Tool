"""
Tests for GET /api/net-worth — asset/liability classification,
manual loans as liabilities, and response field names matching frontend.
"""

from datetime import datetime
from database import Account, Loan
from tests.conftest import make_transaction


class TestNetWorthBasic:
    """Core net worth calculations."""

    def test_asset_account_positive(
        self, client, db_session, seed_categories, checking_account
    ):
        """A checking account with positive balance contributes to total_assets."""
        resp = client.get("/api/net-worth")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_assets"] > 0
        assert data["net_worth"] == data["total_assets"] + data["total_liabilities"]

    def test_liability_account_negative(
        self, client, db_session, seed_categories, mortgage_account
    ):
        """A mortgage account should contribute negatively to total_liabilities."""
        resp = client.get("/api/net-worth")
        data = resp.json()
        assert data["total_liabilities"] < 0
        assert data["net_worth"] == data["total_assets"] + data["total_liabilities"]

    def test_multiple_account_types(
        self, client, db_session, seed_categories,
        checking_account, savings_account, credit_card_account, investment_account, mortgage_account
    ):
        """
        Multiple account types should be summed correctly:
        - checking, savings, 401k = assets
        - credit card, mortgage = liabilities
        """
        resp = client.get("/api/net-worth")
        data = resp.json()

        # Assets: checking(5000) + savings(10000) + 401k(50000) = 65000
        # (all have start_date set and no transactions, so balance = starting_balance)
        assert data["total_assets"] == 65000.0

        # Liabilities: credit card(0) + mortgage(-300000) = -300000
        assert data["total_liabilities"] == -300000.0

        assert data["net_worth"] == -235000.0

    def test_transactions_affect_balance(
        self, client, db_session, seed_categories, checking_account
    ):
        """Transactions after start_date should adjust the account balance."""
        # starting_balance = 5000, start_date = 2025-01-01
        # Add a deposit after start_date
        make_transaction(db_session, checking_account, 1000.00, "Income", "Work",
                         date=datetime(2025, 2, 1))

        resp = client.get("/api/net-worth")
        data = resp.json()
        assert data["total_assets"] == 6000.0


class TestNetWorthManualLoans:
    """Manual loans (from Loan table) without linked accounts appear as liabilities."""

    def test_manual_loan_as_liability(self, client, db_session, seed_categories):
        """A Loan with no linked account should appear in net worth as a liability."""
        loan = Loan(
            lender="Student Loan Corp",
            loan_type="student",
            original_principal=50000.0,
            current_balance=35000.0,
            is_active=True,
        )
        db_session.add(loan)
        db_session.commit()

        resp = client.get("/api/net-worth")
        data = resp.json()
        # Loan should be -35000
        assert data["total_liabilities"] == -35000.0
        assert data["net_worth"] == -35000.0
        assert "Loans" in data["buckets"]
        loan_accounts = data["buckets"]["Loans"]["accounts"]
        assert len(loan_accounts) == 1
        assert loan_accounts[0]["balance"] == -35000.0

    def test_loan_with_linked_account_not_double_counted(
        self, client, db_session, seed_categories
    ):
        """
        If a Loan has an account_id pointing to an active account,
        it should NOT be added again (the account already covers it).
        """
        acct = Account(
            account_name="Auto Loan Acct",
            account_type="loan",
            is_active=True,
            is_manual=True,
            starting_balance=-20000.0,
            start_date=datetime(2025, 1, 1),
        )
        db_session.add(acct)
        db_session.flush()

        loan = Loan(
            lender="Auto Lender",
            loan_type="auto",
            original_principal=25000.0,
            current_balance=20000.0,
            account_id=acct.id,
            is_active=True,
        )
        db_session.add(loan)
        db_session.commit()

        resp = client.get("/api/net-worth")
        data = resp.json()
        # Only the account balance counts (-20000), loan is not added again
        assert data["total_liabilities"] == -20000.0


class TestNetWorthResponseFormat:
    """Verify response field names match what the frontend expects."""

    def test_response_has_required_fields(
        self, client, db_session, seed_categories, checking_account
    ):
        resp = client.get("/api/net-worth")
        data = resp.json()
        # Top-level fields the frontend uses
        assert "net_worth" in data
        assert "total_assets" in data
        assert "total_liabilities" in data
        assert "buckets" in data
        assert "as_of" in data

    def test_bucket_structure(
        self, client, db_session, seed_categories, checking_account
    ):
        resp = client.get("/api/net-worth")
        data = resp.json()
        buckets = data["buckets"]
        # Checking should be in Cash & Savings bucket
        assert "Cash & Savings" in buckets
        bucket = buckets["Cash & Savings"]
        assert "is_asset" in bucket
        assert bucket["is_asset"] is True
        assert "accounts" in bucket
        accounts = bucket["accounts"]
        assert len(accounts) >= 1
        acct = accounts[0]
        assert "account_id" in acct
        assert "account_name" in acct
        assert "balance" in acct
        assert "account_type" in acct

    def test_as_of_date_param(self, client, db_session, seed_categories, checking_account):
        """The as_of parameter should be echoed back and affect the snapshot date."""
        resp = client.get("/api/net-worth", params={"as_of": "2025-06-15"})
        data = resp.json()
        assert data["as_of"] == "2025-06-15"
