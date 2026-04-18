"""
Tests for earn-rate calculation logic — calc_earn_rate(), product lookup
(account.product_id vs card.product_id), and the parent-category fallback.

These tests exercise the pure function ``calc_earn_rate`` directly (unit tests)
and also validate the full endpoint integration via /api/cards/earn-summary.
"""

import sys
import os

# Ensure project root is importable
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from main import calc_earn_rate
from tests.conftest import (
    make_transaction,
    make_card_product,
    make_card,
    make_points_category,
)
from datetime import datetime


# ---------------------------------------------------------------------------
# Unit tests for calc_earn_rate
# ---------------------------------------------------------------------------

class TestCalcEarnRateUnit:
    """Pure-function tests — no DB or HTTP involved."""

    def test_base_rate_no_category(self):
        """When points_category_name is None, return base_rate."""
        rate = calc_earn_rate(
            bonus_by_name={},
            base_rate=1.5,
            points_category_name=None,
            cat_parent_map={},
        )
        assert rate == 1.5

    def test_base_rate_no_bonus_match(self):
        """If no bonus matches the category, return base_rate."""
        rate = calc_earn_rate(
            bonus_by_name={"Dining": 2.0},
            base_rate=1.0,
            points_category_name="Groceries",
            cat_parent_map={},
        )
        assert rate == 1.0

    def test_direct_category_bonus(self):
        """L2 (direct) match returns base + bonus."""
        rate = calc_earn_rate(
            bonus_by_name={"Dining": 2.0},
            base_rate=1.0,
            points_category_name="Dining",
            cat_parent_map={},
        )
        assert rate == 3.0  # 1.0 base + 2.0 bonus

    def test_parent_category_fallback(self):
        """
        L2 category "United" should fall back to L1 parent "Airlines"
        when no direct "United" bonus exists.
        """
        rate = calc_earn_rate(
            bonus_by_name={"Airlines": 4.0},
            base_rate=1.0,
            points_category_name="United",
            cat_parent_map={"United": "Airlines", "Airlines": None},
        )
        assert rate == 5.0  # 1.0 + 4.0

    def test_l2_overrides_l1(self):
        """When both L2 and L1 have bonuses, L2 wins."""
        rate = calc_earn_rate(
            bonus_by_name={"Airlines": 2.0, "United": 4.0},
            base_rate=1.0,
            points_category_name="United",
            cat_parent_map={"United": "Airlines"},
        )
        assert rate == 5.0  # 1.0 + 4.0 (L2 match first)

    def test_zero_base_rate(self):
        """Base rate of 0 still works."""
        rate = calc_earn_rate(
            bonus_by_name={"Dining": 3.0},
            base_rate=0.0,
            points_category_name="Dining",
            cat_parent_map={},
        )
        assert rate == 3.0

    def test_parent_not_in_bonus(self):
        """
        If a category has a parent_key, but that parent has no bonus either,
        fall through to base.
        """
        rate = calc_earn_rate(
            bonus_by_name={"Streaming": 2.0},
            base_rate=1.0,
            points_category_name="Hilton",
            cat_parent_map={"Hilton": "Hotels"},
        )
        assert rate == 1.0


# ---------------------------------------------------------------------------
# Integration tests — product lookup via account.product_id and card.product_id
# ---------------------------------------------------------------------------

class TestProductLookup:
    """
    The earn-summary endpoint resolves a card product in two ways:
    1. account.product_id (preferred)
    2. card.product_id (fallback)
    Verify both paths.
    """

    def test_account_product_id_used(
        self, client, db_session, seed_categories,
        credit_card_account, chase_ur_ecosystem,
    ):
        """When account.product_id is set, its rewards should be used."""
        dining_cat = make_points_category(db_session, "Dining")
        prod = make_card_product(db_session, "chase_sapphire", "Sapphire Preferred",
                                 chase_ur_ecosystem, rewards=[
            {"multiplier": 1.0, "is_base_rate": True},
            {"multiplier": 2.0, "points_category_id": dining_cat.id},
        ])
        # Link product to the ACCOUNT
        credit_card_account.product_id = prod.id
        db_session.commit()

        # Create card without product_id
        make_card(db_session, "VISA-1234", credit_card_account, ecosystem=chase_ur_ecosystem)

        # Create a dining expense
        make_transaction(
            db_session, credit_card_account, -100.00, "Expense", "Dining",
            date=datetime(2025, 3, 10), points_category="Dining",
        )

        resp = client.get("/api/cards/earn-summary", params={"period": "ytd", "year": 2025})
        assert resp.status_code == 200
        data = resp.json()
        # Ecosystems list has objects with 'points_earned' key
        ecosystems = data.get("ecosystems", [])
        assert len(ecosystems) >= 1
        ur = next((e for e in ecosystems if e["name"] == "Chase UR"), None)
        assert ur is not None
        # Should have earned 100 * (1.0 base + 2.0 dining bonus) = 300 points
        assert ur["points_earned"] == 300

    def test_card_product_id_fallback(
        self, client, db_session, seed_categories,
        credit_card_account, chase_ur_ecosystem,
    ):
        """When account.product_id is None, card.product_id should be used."""
        groceries_cat = make_points_category(db_session, "Groceries")
        prod = make_card_product(db_session, "chase_freedom_unlimited", "Freedom Unlimited",
                                 chase_ur_ecosystem, rewards=[
            {"multiplier": 1.5, "is_base_rate": True},
            {"multiplier": 1.5, "points_category_id": groceries_cat.id},
        ])
        # Do NOT set account.product_id — leave it as None
        # Instead set card.product_id
        make_card(db_session, "VISA-5678", credit_card_account, product=prod,
                  ecosystem=chase_ur_ecosystem)

        make_transaction(
            db_session, credit_card_account, -200.00, "Expense", "Groceries",
            date=datetime(2025, 3, 10), points_category="Groceries",
        )

        resp = client.get("/api/cards/earn-summary", params={"period": "ytd", "year": 2025})
        assert resp.status_code == 200
        data = resp.json()
        ecosystems = data.get("ecosystems", [])
        assert len(ecosystems) >= 1
        ur = next((e for e in ecosystems if e["name"] == "Chase UR"), None)
        assert ur is not None
        # Should have earned 200 * (1.5 base + 1.5 groceries bonus) = 600 points
        assert ur["points_earned"] == 600


class TestCashBackEarnRate:
    """Cash-back ecosystems accumulate in the cash_back section of the response."""

    def test_cash_back_accumulates(
        self, client, db_session, seed_categories,
        credit_card_account, cash_back_ecosystem,
    ):
        prod = make_card_product(db_session, "discover_it", "Discover it",
                                 cash_back_ecosystem, rewards=[
            {"multiplier": 1.0, "is_base_rate": True},
        ])
        credit_card_account.product_id = prod.id
        db_session.commit()
        make_card(db_session, "DISC-0001", credit_card_account, product=prod,
                  ecosystem=cash_back_ecosystem)

        make_transaction(
            db_session, credit_card_account, -500.00, "Expense", "Groceries",
            date=datetime(2025, 3, 10), points_category="Groceries",
        )

        resp = client.get("/api/cards/earn-summary", params={"period": "ytd", "year": 2025})
        assert resp.status_code == 200
        data = resp.json()
        # cash_back is a dict with 'total' and 'cards'
        cash_back = data["cash_back"]
        # 500 * 1.0 = 500 "points" (cash back)
        assert cash_back["total"] >= 500.0
        assert len(cash_back["cards"]) >= 1


class TestParentCategoryFallbackIntegration:
    """
    Full integration test: create L1 Airlines + L2 United, card product with
    Airlines bonus, and verify United transaction gets the Airlines rate.
    """

    def test_l2_falls_back_to_l1(
        self, client, db_session, seed_categories,
        credit_card_account, chase_ur_ecosystem,
    ):
        airlines_cat = make_points_category(db_session, "Airlines")
        united_cat = make_points_category(db_session, "United", parent_key="Airlines")

        prod = make_card_product(db_session, "chase_sapphire_reserve", "Sapphire Reserve",
                                 chase_ur_ecosystem, rewards=[
            {"multiplier": 1.0, "is_base_rate": True},
            {"multiplier": 2.0, "points_category_id": airlines_cat.id},  # bonus on Airlines L1
        ])
        credit_card_account.product_id = prod.id
        db_session.commit()
        make_card(db_session, "VISA-9999", credit_card_account, product=prod,
                  ecosystem=chase_ur_ecosystem)

        # Transaction tagged as "United" (L2)
        make_transaction(
            db_session, credit_card_account, -300.00, "Expense", "Travel",
            date=datetime(2025, 3, 10), points_category="United",
        )

        resp = client.get("/api/cards/earn-summary", params={"period": "ytd", "year": 2025})
        assert resp.status_code == 200
        data = resp.json()
        ecosystems = data.get("ecosystems", [])
        assert len(ecosystems) >= 1
        ur = next((e for e in ecosystems if e["name"] == "Chase UR"), None)
        assert ur is not None
        # 300 * (1.0 base + 2.0 Airlines bonus) = 900 points
        assert ur["points_earned"] == 900
