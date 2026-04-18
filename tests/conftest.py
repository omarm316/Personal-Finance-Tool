"""
Shared fixtures for the finance-automation test suite.

Uses an in-memory SQLite database so tests are fast, isolated, and
never touch the production DB.  The FastAPI ``get_db`` dependency is
overridden so every request uses the test session.

Key design choice: we use a **single shared connection** for the in-memory
SQLite DB. This avoids the "objects created in a different thread" error
that arises when TestClient (sync, runs the ASGI app in a thread) and
the test body use different connections.
"""

import os
import sys
from datetime import datetime

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Ensure the project root is on sys.path so ``import database`` works.
# ---------------------------------------------------------------------------
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# ---------------------------------------------------------------------------
# Import models BEFORE the app so the metadata is populated.
# ---------------------------------------------------------------------------
from database import (
    Base,
    Account,
    Transaction,
    TransactionSplit,
    Category,
    CardProduct,
    CardProductReward,
    PointsCategory,
    PointsEcosystem,
    Card,
    Loan,
    BudgetTarget,
)


# ---------------------------------------------------------------------------
# Engine / Session — one engine per test-session, fresh tables per test.
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def engine():
    """
    Create a single in-memory SQLite engine.
    ``check_same_thread=False`` is required because TestClient dispatches
    requests in a worker thread while the test body runs in the main thread.
    Both share the same underlying connection via ``creator``.
    """
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        echo=False,
        poolclass=__import__("sqlalchemy.pool", fromlist=["StaticPool"]).StaticPool,
    )

    @event.listens_for(eng, "connect")
    def _set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return eng


@pytest.fixture(autouse=True)
def tables(engine):
    """Create all tables before each test and drop them after."""
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture()
def db_session(engine):
    """
    Yield a SQLAlchemy Session bound to the test engine.
    Rolled back after the test to ensure a clean slate.
    """
    TestSession = sessionmaker(bind=engine)
    session = TestSession()
    yield session
    session.rollback()
    session.close()


@pytest.fixture()
def client(engine, db_session):
    """
    FastAPI TestClient whose ``get_db`` dependency is overridden to use the
    in-memory test database.
    """
    from main import app, get_db

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass  # session lifecycle is managed by the db_session fixture

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helper fixtures — seed common entities used across multiple test modules.
# ---------------------------------------------------------------------------

@pytest.fixture()
def seed_categories(db_session):
    """
    Insert the core expense / income / both categories that the stats and
    budget-actuals endpoints rely on.
    Returns a dict of {name: Category}.
    """
    cats_data = [
        ("Groceries",           "expense"),
        ("Dining",              "expense"),
        ("Transportation",      "expense"),
        ("Utilities",           "expense"),
        ("Other",               "expense"),
        ("Fees & Interest",     "expense"),
        ("Business",            "both"),
        ("Work",                "income"),
        ("Transfer",            "both"),
        ("Unclassified",        "both"),
    ]
    result = {}
    for name, cat_type in cats_data:
        c = Category(name=name, category_type=cat_type, is_active=True, display_order=1)
        db_session.add(c)
        result[name] = c
    db_session.commit()
    return result


@pytest.fixture()
def checking_account(db_session):
    """A plain checking account (asset, cash-flow eligible)."""
    a = Account(
        account_name="Test Checking",
        account_type="checking",
        is_active=True,
        is_manual=True,
        starting_balance=5000.0,
        start_date=datetime(2025, 1, 1),
    )
    db_session.add(a)
    db_session.commit()
    return a


@pytest.fixture()
def savings_account(db_session):
    """A plain savings account (asset, cash-flow eligible)."""
    a = Account(
        account_name="Test Savings",
        account_type="savings",
        is_active=True,
        is_manual=True,
        starting_balance=10000.0,
        start_date=datetime(2025, 1, 1),
    )
    db_session.add(a)
    db_session.commit()
    return a


@pytest.fixture()
def credit_card_account(db_session):
    """A credit card account (liability, NOT cash-flow eligible)."""
    a = Account(
        account_name="Test Credit Card",
        account_type="credit card",
        is_active=True,
        is_manual=True,
        starting_balance=0.0,
        start_date=datetime(2025, 1, 1),
    )
    db_session.add(a)
    db_session.commit()
    return a


@pytest.fixture()
def investment_account(db_session):
    """An investment account (asset, NOT cash-flow eligible)."""
    a = Account(
        account_name="Test 401k",
        account_type="401k",
        is_active=True,
        is_manual=True,
        starting_balance=50000.0,
        start_date=datetime(2025, 1, 1),
    )
    db_session.add(a)
    db_session.commit()
    return a


@pytest.fixture()
def mortgage_account(db_session):
    """A mortgage liability account."""
    a = Account(
        account_name="Test Mortgage",
        account_type="mortgage",
        is_active=True,
        is_manual=True,
        starting_balance=-300000.0,
        start_date=datetime(2025, 1, 1),
    )
    db_session.add(a)
    db_session.commit()
    return a


@pytest.fixture()
def hsa_account(db_session):
    """An HSA account (asset, cash-flow eligible)."""
    a = Account(
        account_name="Test HSA",
        account_type="hsa",
        is_active=True,
        is_manual=True,
        starting_balance=2000.0,
        start_date=datetime(2025, 1, 1),
    )
    db_session.add(a)
    db_session.commit()
    return a


# ---------------------------------------------------------------------------
# Transaction builder — keeps tests concise.
# ---------------------------------------------------------------------------

def make_transaction(
    db_session,
    account,
    amount,
    action,
    category,
    date=None,
    is_gcb=False,
    gcb_tagged=False,
    is_excluded=False,
    is_split=False,
    description_raw="Test txn",
    merchant_name=None,
    points_category=None,
    card_id=None,
    loan_id=None,
):
    """
    Helper to create a Transaction row with sensible defaults.
    ``date`` defaults to 2025-03-15 if not supplied.
    """
    if date is None:
        date = datetime(2025, 3, 15)
    t = Transaction(
        account_id=account.id,
        amount=amount,
        action=action,
        category_auto=category,
        date=date,
        year=date.year,
        month=date.month,
        day=date.day,
        is_gcb=is_gcb,
        gcb_tagged=gcb_tagged,
        is_excluded=is_excluded,
        is_split=is_split,
        description_raw=description_raw,
        merchant_name=merchant_name,
        points_category=points_category,
        card_id=card_id,
        loan_id=loan_id,
        needs_review=False,
    )
    db_session.add(t)
    db_session.commit()
    return t


def make_split(db_session, parent_transaction, amount, category, is_gcb=False, action=None):
    """Helper to create a TransactionSplit row."""
    s = TransactionSplit(
        parent_transaction_id=parent_transaction.id,
        amount=amount,
        category=category,
        is_gcb=is_gcb,
        action=action,
    )
    db_session.add(s)
    db_session.commit()
    return s


# ---------------------------------------------------------------------------
# Card / product / ecosystem helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def chase_ur_ecosystem(db_session):
    """A Chase Ultimate Rewards points ecosystem."""
    eco = PointsEcosystem(
        name="Chase UR",
        currency_name="Ultimate Rewards",
        eco_type="Flexible",
        conservative_cpp=1.5,
        your_cpp=1.8,
        is_cash_back=False,
    )
    db_session.add(eco)
    db_session.commit()
    return eco


@pytest.fixture()
def cash_back_ecosystem(db_session):
    """A cash-back ecosystem (always 1 cpp)."""
    eco = PointsEcosystem(
        name="Cash Back",
        currency_name="Cash Back",
        eco_type="Cash",
        conservative_cpp=1.0,
        your_cpp=1.0,
        is_cash_back=True,
    )
    db_session.add(eco)
    db_session.commit()
    return eco


def make_card_product(db_session, product_key, card_name, ecosystem, rewards=None):
    """
    Create a CardProduct with optional reward tiers.

    ``rewards`` is a list of dicts with keys:
        - multiplier (float)
        - is_base_rate (bool)
        - points_category_id (int or None)
        - reward_type (str, default 'fixed')
    """
    prod = CardProduct(
        product_key=product_key,
        card_name=card_name,
        ecosystem_id=ecosystem.id,
        status="active",
    )
    db_session.add(prod)
    db_session.flush()
    for r in (rewards or []):
        db_session.add(CardProductReward(
            product_id=prod.id,
            multiplier=r["multiplier"],
            is_base_rate=r.get("is_base_rate", False),
            points_category_id=r.get("points_category_id"),
            reward_type=r.get("reward_type", "fixed"),
        ))
    db_session.commit()
    return prod


def make_card(db_session, card_id, account, product=None, ecosystem=None):
    """Create a Card row linked to an account and optionally a product."""
    c = Card(
        card_id=card_id,
        account_id=account.id,
        product_id=product.id if product else None,
        ecosystem_id=ecosystem.id if ecosystem else None,
        is_active=True,
        issuer="TEST",
        brand="Test",
        card_name="Test Card",
        network="VISA",
    )
    db_session.add(c)
    db_session.commit()
    return c


def make_points_category(db_session, name, parent_key=None):
    """Create a PointsCategory (L1 or L2)."""
    pc = PointsCategory(name=name, parent_key=parent_key, is_active=True)
    db_session.add(pc)
    db_session.commit()
    return pc
