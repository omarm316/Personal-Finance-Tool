"""
core/points_engine.py — points/rewards earn-rate computation, ecosystem
balance math, and merchant-category (CSC) resolution shared across
routers/cards.py and routers/ecosystems.py.

_compute_ecosystem_balance() is deliberately shared between
/api/cards/earn-summary and /api/ecosystems/{id}/earn-detail so the two
can't diverge (see its docstring) — this module has to exist independent
of any single router for exactly that reason.

Extracted from main.py (Phase 0 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
import math
from datetime import datetime

from sqlalchemy import or_

from database import (
    Card, PointsCategory, CardProduct, CardProductReward, PointsEcosystem,
    CardProductHistory, PointsBalanceSnapshot, Transaction,
)

_MERCHANT_POINTS_PATTERNS: list[tuple[str, str]] = [
    # ── Food delivery (before rideshare so "uber eats" hits here first) ──
    ("uber eats",        "Food Delivery"),
    ("doordash",         "Food Delivery"),
    ("door dash",        "Food Delivery"),
    ("grubhub",          "Food Delivery"),
    ("postmates",        "Food Delivery"),
    ("seamless",         "Food Delivery"),
    ("instacart",        "Groceries"),       # grocery delivery → Groceries
    # ── Rideshare ─────────────────────────────────────────────────────────
    ("lyft",             "Rideshare: Lyft"),
    ("uber",             "Rideshare: Uber"),
    # ── Airlines ──────────────────────────────────────────────────────────
    ("united air",       "United"),
    ("united airline",   "United"),
    ("united.com",       "United"),
    ("ual ",             "United"),          # United Airlines IATA code in merchant names
    ("delta air",        "Delta"),
    ("delta.com",        "Delta"),
    ("american airline", "American Airlines"),
    ("aa.com",           "American Airlines"),
    ("southwest air",    "Southwest"),
    ("southwest.com",    "Southwest"),
    ("jetblue",          "JetBlue"),
    ("alaska air",       "Alaska Airlines"),
    ("alaskaair",        "Alaska Airlines"),
    # ── Hotels ────────────────────────────────────────────────────────────
    ("hilton",           "Hilton"),          # matches Hampton Inn, DoubleTree, etc.
    ("marriott",         "Marriott"),
    ("sheraton",         "Marriott"),
    ("westin",           "Marriott"),
    ("w hotel",          "Marriott"),
    ("ritz-carlton",     "Marriott"),
    ("ritz carlton",     "Marriott"),
    ("courtyard",        "Marriott"),
    ("hyatt",            "Hyatt"),           # matches Park Hyatt, Grand Hyatt, Andaz, etc.
    ("intercontinental", "IHG"),
    ("holiday inn",      "IHG"),
    ("crowne plaza",     "IHG"),
    ("kimpton",          "IHG"),
    ("ihg",              "IHG"),
    # ── Retail / grocery ─────────────────────────────────────────────────
    ("walmart",          "Walmart"),
    ("wal-mart",         "Walmart"),
    ("target",           "Target"),
    ("amazon",           "Amazon"),          # also catches Amazon Fresh
    ("whole foods",      "Groceries"),
    ("trader joe",       "Groceries"),
    ("costco",           "Wholesale Clubs"),
    ("sam's club",       "Wholesale Clubs"),
    ("sams club",        "Wholesale Clubs"),
    ("best buy",         "Best Buy"),
    # ── Gas stations ─────────────────────────────────────────────────────
    ("shell",            "Gas Stations"),
    ("exxon",            "Gas Stations"),
    ("mobil",            "Gas Stations"),
    ("bp ",              "Gas Stations"),
    ("chevron",          "Gas Stations"),
    ("sunoco",           "Gas Stations"),
    ("circle k",         "Gas Stations"),
    ("speedway",         "Gas Stations"),
    # ── Streaming ─────────────────────────────────────────────────────────
    ("netflix",          "Streaming"),
    ("spotify",          "Streaming"),
    ("hulu",             "Streaming"),
    ("disney+",          "Streaming"),
    ("disneyplus",       "Streaming"),
    ("peacock",          "Streaming"),
    ("hbomax",           "Streaming"),
    ("hbo max",          "Streaming"),
    ("paramount+",       "Streaming"),
    ("paramountplus",    "Streaming"),
    ("apple tv",         "Streaming"),
    ("apple music",      "Streaming"),
    ("siriusxm",         "Streaming"),
    ("youtube premium",  "Streaming"),
    # ── Drugstore ─────────────────────────────────────────────────────────
    ("cvs",              "Drugstore"),
    ("walgreen",         "Drugstore"),
    ("rite aid",         "Drugstore"),
    # ── Grocery chains not covered above ─────────────────────────────────
    ("kings",            "Groceries"),   # Kings Food Markets / Kings Supermarkets
    ("kroger",           "Groceries"),
    ("safeway",          "Groceries"),
    ("publix",           "Groceries"),
    ("stop & shop",      "Groceries"),
    ("stop and shop",    "Groceries"),
    ("shoprite",         "Groceries"),
    ("h-e-b",            "Groceries"),
    ("wegmans",          "Groceries"),
    ("aldi",             "Groceries"),
    ("sprouts",          "Groceries"),
    ("fresh market",     "Groceries"),
    # ── Dining: coffee, fast food, restaurants ────────────────────────────
    ("starbucks",        "Dining"),
    ("shake shack",      "Dining"),
    ("pruplaza",         "Dining"),    # Pru Plaza Cafe (72 txns)
    ("pru plaza",        "Dining"),
    ("blue angel",       "Dining"),    # Blue Angel Cafe & Bakery (multiple Plaid variants)
    ("shokudo",          "Dining"),
    ("juicylicious",     "Dining"),
    ("emanu el",         "Dining"),    # Emanu El Deli, Tenafly NJ
    ("hellas retail",    "Dining"),    # Hellas Retail Bakery
    ("chipotle",         "Dining"),
    ("panera",           "Dining"),
    ("chick-fil-a",      "Dining"),
    ("mcdonald",         "Dining"),
    ("dunkin",           "Dining"),
    ("subway",           "Dining"),
    ("taco bell",        "Dining"),
    ("domino",           "Dining"),
    ("five guys",        "Dining"),
    ("sweetgreen",       "Dining"),
    ("chill bros",       "Dining"),    # ice cream
    ("kilwin",           "Dining"),    # Kilwin's ice cream & candy
    ("stix restaurant",  "Dining"),
    # ── Spa & Salon ───────────────────────────────────────────────────────
    ("hudson cuts",      "Spa & Salon"),   # barbershop
    # ── Food delivery variants ────────────────────────────────────────────
    ("doordasan",        "Food Delivery"),  # Plaid normalization of DoorDash
    # ── Ground transportation ─────────────────────────────────────────────
    ("nj transit",       "Ground Transportation"),
    ("njtransit",        "Ground Transportation"),
    ("e-zpass",          "Ground Transportation"),
    ("ezpass",           "Ground Transportation"),
    ("paybyphone",       "Ground Transportation"),   # parking app
    ("parkmobile",       "Ground Transportation"),   # parking app
    ("mta",              "Ground Transportation"),   # NYC/NJ Transit Authority
    ("pay parking by phone", "Ground Transportation"),  # alternate Plaid normalization of PayByPhone
    ("las olas",         "Ground Transportation"),   # Las Olas parking, Fort Lauderdale
    # ── Car rental ────────────────────────────────────────────────────────
    ("sixt",             "Car Rental"),
    ("enterprise",       "Car Rental"),
    ("national car",     "Car Rental"),
    ("avis",             "Car Rental"),
    ("budget car",       "Car Rental"),
    ("alamo",            "Car Rental"),
    ("dollar rent",      "Car Rental"),
    ("thrifty",          "Car Rental"),
    # ── Hotel brands: Hilton family ───────────────────────────────────────
    ("conrad",           "Hilton"),    # Conrad Hotels & Resorts — Hilton luxury brand
    # ── Hotel brands: Marriott family ─────────────────────────────────────
    ("the edition",      "Marriott"),  # The EDITION — Marriott luxury brand
    ("tampa edit",       "Marriott"),  # truncated Plaid variant of Tampa EDITION
    ("edition hotel",    "Marriott"),
    ("st. regis",        "Marriott"),
    ("st regis",         "Marriott"),
    ("w hotel",          "Marriott"),
    # ── Streaming ─────────────────────────────────────────────────────────
    ("espn",             "Streaming"),   # covers ESPN+
    ("new york times",   "Streaming"),   # digital subscription
    ("nytimes",          "Streaming"),
    ("wsj",              "Streaming"),   # Wall Street Journal
    ("washington post",  "Streaming"),
    # ── Online shopping ───────────────────────────────────────────────────
    ("newegg",           "Online Shopping"),
    ("ebay",             "Online Shopping"),
    ("etsy",             "Online Shopping"),
    ("rakuten",          "Online Shopping"),
]
_PFC_POINTS_MAP: dict[str, str] = {
    "TRAVEL_AIRLINES":                           "Airlines",
    "TRAVEL_LODGING":                            "Hotels",
    "TRAVEL_CAR_RENTALS":                        "Car Rental",
    "TRANSPORTATION_TAXIS":                      "Ground Transportation",
    "TRANSPORTATION_PUBLIC_TRANSIT":             "Ground Transportation",
    "TRANSPORTATION_GAS_STATIONS":               "Gas Stations",
    "FOOD_AND_DRINK_RESTAURANTS":                "Dining",
    "FOOD_AND_DRINK_FAST_FOOD":                  "Dining",
    "FOOD_AND_DRINK_BAR":                        "Dining",
    "FOOD_AND_DRINK_COFFEE":                     "Dining",
    "FOOD_AND_DRINK_FOOD_DELIVERY_SERVICES":     "Food Delivery",
    "SHOPS_GROCERIES":                           "Groceries",
    "SHOPS_PHARMACIES":                          "Drugstore",
    "ENTERTAINMENT_STREAMING_SERVICES":          "Streaming",
    "ENTERTAINMENT_MUSIC_AND_AUDIO":             "Streaming",
}
def infer_points_category(
    merchant_name: str | None,
    pfc_detailed: str | None = None,
    pfc_primary: str | None = None,
) -> str | None:
    """
    Infer the points_category name for a transaction using a two-step approach:

    1. Merchant name substring match → L2 (brand-specific) or L1 result.
       This is preferred because it's the most precise signal.
    2. Plaid pfc_detailed → L1 fallback when no merchant pattern fires.

    Returns None if we can't confidently classify — callers should leave
    points_category as NULL rather than guess.
    """
    if merchant_name:
        needle = merchant_name.lower()
        for pattern, cat in _MERCHANT_POINTS_PATTERNS:
            if pattern in needle:
                return cat

    if pfc_detailed:
        cat = _PFC_POINTS_MAP.get(pfc_detailed)
        if cat:
            return cat

    # pfc_primary gives a coarser signal — only use it for unambiguous mappings
    if pfc_primary == "GROCERIES":
        return "Groceries"

    return None
_NON_EARNING_CATS: frozenset[str] = frozenset({
    'Annual Fee',
    'Late Fee',
    'Card Interest Expense',
    'Interest Charge',
    'Finance Charges',
    'Bank Fees',
    'P2P Payments',   # Venmo/Zelle/Cash App — no points, no SUB spend credit
})
_CC_PAYMENT_KW = ('CREDIT CRD', 'CREDIT CARD', 'AUTOPAY', 'CC PAYMENT', 'CARD PAYMENT')
def calc_earn_rate(
    bonus_by_name: dict[str, float],
    base_rate: float,
    points_category_name: str | None,
    cat_parent_map: dict[str, str | None],
) -> float:
    """
    Waterfall earn-rate lookup: L2 (brand) → L1 (broad) → base.

    bonus_by_name    : {category_name: additional_multiplier} — pre-built from
                       the card product's CardProductReward rows (non-base only).
    base_rate        : the card's base earn rate (e.g. 1.5 for CFU).
    points_category_name : the transaction's assigned points category, or None.
    cat_parent_map   : {category_name: parent_key} — from PointsCategory table.

    Returns the total earn rate (base + bonus).
    """
    if not points_category_name:
        return base_rate
    # L2: card has an explicit rate for this brand/category
    if points_category_name in bonus_by_name:
        return base_rate + bonus_by_name[points_category_name]
    # L1: fall back to parent category (e.g. "United" → "Airlines")
    parent = cat_parent_map.get(points_category_name)
    if parent and parent in bonus_by_name:
        return base_rate + bonus_by_name[parent]
    return base_rate
def compute_points_earn(t, base_rate: float, bonus_by_name: dict, cat_parent_map: dict, issuer: str = None) -> dict:
    """
    Signed points-earn for a single transaction — the one place every
    earn-rate call site routes through. Deliberately simple, per Omer's
    design (2026-07-16, replacing an earlier fuzzy-matching version — see
    MARGIN-MORESHETH-INTEGRATION.md for why): sign + category rules only,
    no purchase-matching, no auto-detected benefit credits.

    1. Expense, negative amount (a normal purchase) → earn at the category rate.
    2. Expense, positive amount (a credit) → same category rate, subtracted.
    3. Category is a fee/interest type (_NON_EARNING_CATS) → 0.
    4. It's a payment (by action or description) → 0.
    5. Anything else that shouldn't move points — a genuine benefit credit,
       an adjustment, a balance transfer, a cash advance, etc. — is the
       user's call via the existing `is_excluded` toggle, checked first
       below so it always wins.

    Only `action == 'Expense'` transactions ever earn or lose points —
    Income/Transfer/other action types are out of scope (rare on credit
    cards, not worth handling here).

    Amex-issued cards round the dollar amount to the NEAREST whole dollar
    (standard rounding, not always up) before applying the multiplier —
    confirmed 2026-07-18 against a real statement ($4.66 dining spend at 7x
    earned 35 points, i.e. rounded to $5) and corrected 2026-07-20 after
    that example turned out to round the same way under ceil() or round()
    ($4.66 rounds to $5 either way — not actually a distinguishing case).
    Scoped to issuer == 'AMEX' only since that's the only issuer this has
    been verified against — other issuers keep the raw fractional-dollar
    calculation until confirmed.

    Returns {'points': float, 'classification': str, 'earn_rate': float|None}.
    """
    def _zero(cls):
        return {'points': 0.0, 'classification': cls, 'earn_rate': None}

    if t.points_earn_override is not None:
        return {'points': t.points_earn_override, 'classification': 'manual_override', 'earn_rate': None}

    if t.is_excluded:
        return _zero('excluded')

    if t.action != 'Expense':
        return _zero('excluded')

    # Payments aren't consistently tagged action='Transfer' by the
    # categorization pipeline, so this also checks description text —
    # the known-keyword list, plus the broader "PAYMENT"+"THANK"
    # co-occurrence (issuer payment-confirmation descriptions vary by
    # channel — "MOBILE PAYMENT - THANK YOU", "PAYMENT THANK YOU", "ONLINE
    # PAYMENT, THANK YOU" — but consistently include both words).
    _desc_upper = (t.description_raw or '').upper()
    if (any(kw in _desc_upper for kw in _CC_PAYMENT_KW)
            or ('PAYMENT' in _desc_upper and 'THANK' in _desc_upper)):
        return _zero('excluded')

    if t.points_category in _NON_EARNING_CATS:
        return _zero('excluded')

    if t.amount is None or t.amount == 0:
        return _zero('excluded')

    rate = calc_earn_rate(bonus_by_name, base_rate, t.points_category, cat_parent_map)
    # math.floor(x + 0.5) rather than round() — round() uses banker's rounding
    # (round-half-to-even), which would silently round some .50 amounts down.
    dollars = math.floor(abs(t.amount) + 0.5) if issuer == 'AMEX' else abs(t.amount)
    if t.amount < 0:
        return {'points': dollars * rate, 'classification': 'earn', 'earn_rate': rate}
    else:
        return {'points': -(dollars * rate), 'classification': 'clawback', 'earn_rate': rate}
def calc_auto_top_category_points(db, account_id, product, start_date, end_date):
    """
    For auto_top_category cards (e.g. Citi Custom Cash):
    Each calendar month within [start_date, end_date]:
      - Find eligible categories (CardProductReward rows with reward_type='auto_top_category')
      - Group account transactions by category for that month
      - Top category (by absolute spend) gets 5x on first $500, 1x above $500
      - All other eligible categories get 1x (same as base)
      - Non-eligible categories get base earn rate
    Returns total points earned.
    """
    # Get eligible categories for auto_top_category
    auto_rewards = [r for r in product.rewards if getattr(r, 'reward_type', 'fixed') == 'auto_top_category']
    base_reward  = next((r for r in product.rewards if r.is_base_rate), None)
    base_rate    = float(base_reward.multiplier if base_reward else 1)

    eligible_cat_names = set()
    for r in auto_rewards:
        if r.points_category:
            eligible_cat_names.add(r.points_category.name)

    bonus_multiplier = base_rate + (float(auto_rewards[0].multiplier) if auto_rewards else 4)
    spend_cap = 500.0

    # One query for the whole range, then bucket by calendar month in Python.
    # This used to issue a separate query *per month* while walking the range.
    # _compute_balance_bucket() calls this with start_date=2000-01-01 whenever
    # the bucket has no baseline snapshot, so a single auto-top account cost
    # ~318 round-trips (Jan 2000 → today) — the dominant cost in
    # /api/cards/earn-summary's ~43s. Months with no activity contribute
    # nothing, so skipping them entirely is equivalent. See BACKLOG B26.
    #
    # Range note: the original walked from start_date.replace(day=1), so
    # transactions earlier in start_date's own month were included. Preserved
    # deliberately rather than silently narrowing the window.
    range_start = start_date.replace(day=1)
    all_txns = db.query(Transaction).filter(
        Transaction.account_id == account_id,
        Transaction.date >= range_start,
        Transaction.date <= end_date,
        Transaction.action == 'Expense',
        Transaction.amount < 0,
        Transaction.is_excluded != True,
    ).all()

    # month key (year, month) → {category → spend}
    by_month: dict[tuple, dict] = {}
    for t in all_txns:
        key = (t.date.year, t.date.month)
        cat = t.points_category or 'Other'
        m = by_month.setdefault(key, {})
        m[cat] = m.get(cat, 0.0) + abs(float(t.amount))

    total_points = 0.0
    for cat_spend in by_month.values():
        # Find top eligible category by spend
        top_cat = None
        top_amt = 0.0
        for cat, amt in cat_spend.items():
            if cat in eligible_cat_names and amt > top_amt:
                top_cat = cat
                top_amt = amt

        # Calculate points for this month
        for cat, amt in cat_spend.items():
            if cat == top_cat:
                bonus_spend = min(amt, spend_cap)
                over_spend = max(0.0, amt - spend_cap)
                total_points += bonus_spend * bonus_multiplier + over_spend * base_rate
            else:
                total_points += amt * base_rate

    return round(total_points, 1)
def _build_product_rate_maps(db, product_ids: list[int]) -> dict[int, tuple]:
    """
    The per-product half of the rate lookup, shared by _build_points_lookup()
    (keyed by account, for "what does this card currently earn" displays) and
    _lock_points_for_transaction() (keyed by whichever product was actually in
    effect on one specific transaction's date).

    Returns {product_id: (base_rate, bonus_by_name, currency_name, eco_name, your_cpp)}
    where bonus_by_name = {category_name: additional_multiplier}.
    """
    if not product_ids:
        return {}

    products   = {p.id: p for p in db.query(CardProduct).filter(CardProduct.id.in_(product_ids)).all()}
    eco_ids    = [p.ecosystem_id for p in products.values() if p.ecosystem_id]
    ecosystems = {e.id: e for e in db.query(PointsEcosystem).filter(PointsEcosystem.id.in_(eco_ids)).all()}

    # joinedload the category: the bonus_by_name build below reads
    # r.points_category.name, which lazy-loads one query per reward row
    # otherwise (26 queries / 1.9s on a 500-transaction page). See B4.
    from sqlalchemy.orm import joinedload as _joinedload
    all_rewards = db.query(CardProductReward)\
        .options(_joinedload(CardProductReward.points_category))\
        .filter(CardProductReward.product_id.in_(product_ids)).all()
    rewards_by_product: dict[int, list] = {}
    for r in all_rewards:
        rewards_by_product.setdefault(r.product_id, []).append(r)

    rate_maps: dict[int, tuple] = {}
    for product_id, product in products.items():
        eco     = ecosystems.get(product.ecosystem_id) if product.ecosystem_id else None
        rewards = rewards_by_product.get(product_id, [])
        base    = next((r.multiplier for r in rewards if r.is_base_rate), 1.0)
        bonus_by_name = {
            r.points_category.name: r.multiplier
            for r in rewards
            if not r.is_base_rate and r.points_category
        }
        rate_maps[product_id] = (
            base,
            bonus_by_name,
            eco.currency_name if eco else 'Points',
            eco.name if eco else None,
            eco.your_cpp if eco else 1.0,
        )
    return rate_maps
def _build_points_lookup(db, account_ids: list[int]) -> tuple[dict, dict]:
    """
    Pre-build the data structures needed to display a card's CURRENT earn
    structure for a batch of accounts without N+1 queries. NOTE: this answers
    "what does this account's card earn today" — it is no longer used to
    compute any specific transaction's points (those are locked, see
    Transaction.points_earned / _lock_points_for_transaction below); it's for
    "current rate" displays like the portfolio and benefits pages.

    Returns:
      points_lookup  : {account_id: (base_rate, bonus_by_name, currency_name, eco_name, your_cpp, issuer)}
                       where bonus_by_name = {category_name: additional_multiplier}
      cat_parent_map : {category_name: parent_key}  — for the L2→L1 waterfall
    """
    cat_parent_map = {c.name: c.parent_key for c in db.query(PointsCategory).all()}

    if not account_ids:
        return {}, cat_parent_map

    cards = db.query(Card).filter(Card.account_id.in_(account_ids)).all()
    acct_to_card = {c.account_id: c for c in cards}

    product_ids = [c.product_id for c in cards if c.product_id]
    if not product_ids:
        return {}, cat_parent_map

    rate_maps = _build_product_rate_maps(db, product_ids)

    points_lookup: dict[int, tuple] = {}
    for acct_id, card in acct_to_card.items():
        if not card.product_id or card.product_id not in rate_maps:
            continue
        base, bonus_by_name, currency_name, eco_name, your_cpp = rate_maps[card.product_id]
        points_lookup[acct_id] = (base, bonus_by_name, currency_name, eco_name, your_cpp, card.issuer)

    return points_lookup, cat_parent_map
def _resolve_merchant_csc(
    mpm_lookup: list[tuple[str, str, int | None, str | None]],
    merchant_name: str,
    card_id: int | None,
    network: str | None,
) -> str | None:
    """Resolve a merchant name to a taught merchant-category (CSC) mapping,
    most-specific-wins: a rule scoped to this exact card beats one scoped to
    every card on this payment network (Visa/Mastercard/Amex/Discover —
    Card.network, not the issuing bank), which beats a global (card_id and
    network both null) rule. Previously this only ever checked the global
    tier — card_id/network on MerchantPointsMapping were stored but silently
    never consulted, so a mapping taught "for this card only" or "for this
    network" never actually applied to new transactions (see PLAN.md).
    """
    needle = merchant_name.lower()
    card_match = network_match = global_match = None
    for pat, cat, m_card_id, m_network in mpm_lookup:
        if pat not in needle:
            continue
        if card_id is not None and m_card_id == card_id and card_match is None:
            card_match = cat
        elif network is not None and m_card_id is None and m_network == network and network_match is None:
            network_match = cat
        elif m_card_id is None and m_network is None and global_match is None:
            global_match = cat
    return card_match or network_match or global_match
def _build_network_lookup(db, account_ids: list[int]) -> dict[int, str | None]:
    """{account_id: network} for every linked Card, regardless of whether the
    card has a product/reward structure attached — unlike _build_points_lookup,
    which skips product-less cards since it exists for earn-rate display, not
    identity. Network (Visa/Mastercard/Amex/Discover — Card.network) is what
    actually determines how a merchant gets coded; the issuing bank
    (Card.issuer, e.g. Chase or Bilt) doesn't.
    """
    if not account_ids:
        return {}
    cards = db.query(Card).filter(Card.account_id.in_(account_ids)).all()
    return {c.account_id: c.network for c in cards}
def _resolve_product_for_date(db, card_id: int, txn_date) -> int | None:
    """
    Which CardProduct was in effect for this card on this date. Checks
    CardProductHistory (effective-dated, mirrors TransferRatio) first; falls
    back to the card's CURRENT product_id if no history row exists yet
    (every card before its first product change, and legacy data before this
    feature shipped).
    """
    if not card_id:
        return None
    d = txn_date.date() if hasattr(txn_date, 'date') else txn_date
    hist = (
        db.query(CardProductHistory)
        .filter(
            CardProductHistory.card_id == card_id,
            CardProductHistory.effective_from <= d,
        )
        .filter(or_(CardProductHistory.effective_to.is_(None), CardProductHistory.effective_to > d))
        .order_by(CardProductHistory.effective_from.desc())
        .first()
    )
    if hist:
        return hist.product_id
    card = db.query(Card).filter_by(id=card_id).first()
    return card.product_id if card else None
def _lock_points_for_transaction(db, t) -> None:
    """
    Compute this transaction's points-earn ONCE, using whichever product was
    actually in effect on the transaction's own date, and freeze the result
    onto the row (points_earned/points_earn_classification/points_product_id/
    points_locked_at). Nothing else re-derives this later on read — see the
    module docstring near Transaction.points_earned in database.py.

    Call this at creation (sync/import/manual) and again whenever an edit
    changes a field compute_points_earn() depends on (category, is_excluded,
    points_earn_override, action). Re-locking still resolves the product as
    of the transaction's OWN date, so correcting an old transaction's category
    today doesn't pull in today's (possibly changed) product's rates.
    """
    t.points_locked_at = datetime.utcnow()

    if not t.card_id:
        t.points_earned = None
        t.points_earn_classification = None
        t.points_earn_rate = None
        t.points_product_id = None
        return

    product_id = _resolve_product_for_date(db, t.card_id, t.date)
    if not product_id:
        t.points_earned = None
        t.points_earn_classification = None
        t.points_earn_rate = None
        t.points_product_id = None
        return

    rate_info = _build_product_rate_maps(db, [product_id]).get(product_id)
    if not rate_info:
        t.points_earned = None
        t.points_earn_classification = None
        t.points_earn_rate = None
        t.points_product_id = product_id
        return

    base_rate, bonus_by_name = rate_info[0], rate_info[1]
    card = db.query(Card).filter_by(id=t.card_id).first()
    cat_parent_map = {c.name: c.parent_key for c in db.query(PointsCategory).all()}
    result = compute_points_earn(t, base_rate, bonus_by_name, cat_parent_map, card.issuer if card else None)

    t.points_earned = result['points']
    t.points_earn_classification = result['classification']
    t.points_earn_rate = result['earn_rate']
    t.points_product_id = product_id
def _statement_close_date(txn_date, close_day):
    """The close date of the billing cycle a transaction on `txn_date` falls
    into, given a card's `statement_close_day` (1-31). Clamps to the last
    real day of the month (e.g. close_day=31 in February -> Feb 28/29),
    same convention as every other day-of-month field in this app."""
    import calendar
    last_day = calendar.monthrange(txn_date.year, txn_date.month)[1]
    this_close = txn_date.replace(day=min(close_day, last_day))
    if txn_date.day <= this_close.day:
        return this_close
    year, month = (txn_date.year + 1, 1) if txn_date.month == 12 else (txn_date.year, txn_date.month + 1)
    last_day_next = calendar.monthrange(year, month)[1]
    return txn_date.replace(year=year, month=month, day=min(close_day, last_day_next))
def _points_pending(txn_date, close_day, today):
    """Points sit "pending" in the loyalty program from the purchase date
    until the day after the statement closes — this app's flat +1-day
    posting rule (Omer's call: applies uniformly, no per-issuer variation
    modeled). A card with no known statement_close_day is treated as
    posting immediately (can't compute a cycle without one — expected to
    become rare as close days get filled in for every active card)."""
    if not close_day:
        return False
    from datetime import timedelta as _td
    posts_on = _statement_close_date(txn_date, close_day) + _td(days=1)
    return today < posts_on
def _load_products_by_id(db, credit_accounts, card_by_acct):
    """
    Batch-load every CardProduct reachable from these accounts/cards in ONE
    query. Replaces a per-account `.filter_by(id=...).first()` that ran inside
    the account loop in three separate handlers (cards_earn_summary,
    cash_back_earn_detail, ecosystem_earn_detail) — ~40 round-trips each,
    against a remote DB, for a set of rows that mostly repeat. See BACKLOG B26.
    """
    pids = {a.product_id for a in credit_accounts if a.product_id}
    pids |= {c.product_id for c in card_by_acct.values() if c.product_id}
    if not pids:
        return {}
    return {p.id: p for p in db.query(CardProduct).filter(CardProduct.id.in_(pids)).all()}
def _compute_ecosystem_balance(db, eco_id, eco_accts, acct_info, cat_parent_map,
                                redemption_rows, transfers_out, transfers_in,
                                adjustment_rows, person_transfer_rows, known_people):
    """
    Current balance, split per-person (Omer / Daniella / "Shared" for
    untagged legacy data) with a combined Total. Shared by
    /api/ecosystems/{id}/earn-detail (full ledger detail, the source of
    truth) and /api/cards/earn-summary (Portfolio tile headline number) so
    the two can never silently diverge on what "current balance" means —
    they did exactly that (period-earned vs. all-time balance) before this
    was factored out, which is what prompted this refactor.

    A manual PointsBalanceSnapshot (if any exists FOR THAT BUCKET) is its
    baseline — corrects for drift the computed math can't see (unlogged
    promo bonuses, benefit credits, redemptions made outside this app,
    etc.). Only activity after the snapshot's date is added on top;
    everything before it is assumed already folded into the snapshotted
    value. Each bucket can have its own baseline date (Omer might set his
    balance today, Daniella's might still be unset) — there is
    deliberately no single shared "as of" date at the Total level.
    """
    from datetime import date as _date, timedelta as _timedelta, datetime as _datetime, time as _dtime

    def _bucket_matches(row_person, bucket):
        if bucket is None:  # "Shared" — untagged/legacy rows
            return not row_person
        return row_person == bucket

    # Card.primary_user is the fallback owner for any transaction with no
    # spender manually tagged — a card's whole history belongs to its
    # cardholder by default, "Shared" is now only for cards with genuinely
    # no assigned owner (or a joint card left that way on purpose). spender
    # still wins whenever it's set (e.g. one specific purchase on a joint
    # card actually made by the other person).
    card_primary_user: dict[int, str] = {}
    # Statement close day per card — drives the pending-vs-posted split
    # below (points sit "pending" from purchase date until the day after
    # the card's statement closes; a card with no close day set is treated
    # as posting immediately, see _points_pending()).
    card_close_day: dict[int, int] = {}
    if eco_accts:
        for c in db.query(Card).filter(Card.account_id.in_(eco_accts)).all():
            if c.primary_user:
                card_primary_user[c.id] = c.primary_user
            if c.statement_close_day:
                card_close_day[c.id] = c.statement_close_day

    _today = _date.today()

    # ── Prefetched once, partitioned per bucket in Python ────────────────────
    # This used to issue one snapshot query AND one full transaction query per
    # bucket (per person, plus Shared) — and this whole helper is itself called
    # once per ecosystem by /api/cards/earn-summary. That fanned out to 357
    # transaction round-trips and 48 snapshot round-trips on a ~12-ecosystem
    # portfolio. Against the remote Railway Postgres (~70ms per round-trip)
    # that alone was ~28s of the endpoint's ~43s. Every per-bucket filter is on
    # `spender` / `card_id` / date, all of which are just as easy to evaluate
    # in Python, so we fetch once and slice in memory instead. See BACKLOG B26.
    _all_snaps = db.query(PointsBalanceSnapshot).filter_by(ecosystem_id=eco_id).all()
    _all_txns = []
    if eco_accts:
        _all_txns = db.query(Transaction).filter(
            Transaction.account_id.in_(eco_accts),
            Transaction.is_excluded != True,
        ).all()
    _owner_card_ids = set(card_primary_user.keys())

    def _txn_in_bucket(t, bucket):
        """Python equivalent of the per-bucket spender/card_id SQL filter."""
        sp = t.spender or ''          # matches `spender IS NULL OR spender = ''`
        if bucket is None:
            # Shared: untagged AND not claimed by any owned card's default.
            return (not sp) and (t.card_id is None or t.card_id not in _owner_card_ids)
        if sp == bucket:
            return True
        # Untagged transactions fall back to the card's primary_user.
        return (not sp) and t.card_id is not None and card_primary_user.get(t.card_id) == bucket

    def _compute_balance_bucket(bucket):
        if bucket is None:
            _snaps = [s for s in _all_snaps if not s.person]
        else:
            _snaps = [s for s in _all_snaps if s.person == bucket]
        latest = max(_snaps, key=lambda s: s.snapshot_date) if _snaps else None
        b_baseline = latest.balance if latest else 0.0
        b_baseline_date = latest.snapshot_date if latest else None

        b_earned = 0.0
        # Points earned but not yet posted to the loyalty account (still
        # within the card's current billing cycle + 1 day) — subtracted out
        # of current_balance below, since they aren't actually redeemable
        # yet. Auto-top-category accounts (Citi Custom Cash-style) are
        # deliberately excluded from this — their bonus is computed monthly,
        # not per-transaction, so there's no single purchase date to check
        # against a statement cycle; treated as posted immediately, a known
        # simplification (same class of limitation as B11).
        b_pending = 0.0
        if eco_accts:
            # Transaction.date is a timestamp, snapshot_date a plain date.
            # SQL's `timestamp > date` coerces the date to midnight, so do the
            # same here — comparing a datetime to a date directly is a
            # TypeError in Python, and truncating t.date to a date instead
            # would silently drop any same-day-after-midnight transaction that
            # the original query counted.
            _baseline_dt = _datetime.combine(b_baseline_date, _dtime.min) if b_baseline_date else None
            for t in _all_txns:
                if not _txn_in_bucket(t, bucket):
                    continue
                if _baseline_dt and not (t.date > _baseline_dt):
                    continue
                if t.action != 'Expense':
                    continue
                # auto_top_category accounts can't be read from the locked
                # column (it can't express the "top category" waterfall) —
                # handled separately below. See B11.
                if acct_info.get(t.account_id, {}).get('has_auto_top'):
                    continue
                # Locked at write time — see _lock_points_for_transaction().
                pts = t.points_earned or 0
                b_earned += pts
                if pts and _points_pending(t.date.date(), card_close_day.get(t.card_id), _today):
                    b_pending += pts

            # auto_top_category accounts (e.g. Citi Custom Cash), Shared
            # bucket only: calc_auto_top_category_points() computes a whole
            # account's bonus month-by-month and has no per-spender
            # breakdown, so this only attributes correctly as long as no
            # transaction on that account has ever been tagged to a specific
            # person (true for every such account today). See B11.
            if bucket is None:
                for acct_id in eco_accts:
                    a_info = acct_info.get(acct_id, {})
                    if not a_info.get('has_auto_top'):
                        continue
                    product = a_info.get('product')
                    if not product:
                        continue
                    auto_start = (b_baseline_date + _timedelta(days=1)) if b_baseline_date else _date(2000, 1, 1)
                    try:
                        b_earned += calc_auto_top_category_points(db, acct_id, product, auto_start, _date.today())
                    except Exception:
                        pass

        b_redeemed = sum(
            r.points_redeemed for r in redemption_rows
            if _bucket_matches(r.person, bucket) and (not b_baseline_date or r.redemption_date > b_baseline_date)
        )
        b_transferred_out = sum(
            t['points_sent'] for t in transfers_out
            if _bucket_matches(t.get('person'), bucket) and (not b_baseline_date or _date.fromisoformat(t['transfer_date']) > b_baseline_date)
        )
        b_transferred_in = sum(
            t['points_received'] for t in transfers_in
            if _bucket_matches(t.get('to_person'), bucket) and (not b_baseline_date or _date.fromisoformat(t['transfer_date']) > b_baseline_date)
        )
        b_adjusted = sum(
            a.points_delta for a in adjustment_rows
            if _bucket_matches(a.person, bucket) and (not b_baseline_date or a.adjustment_date > b_baseline_date)
        )
        # Person-to-person transfers only ever move between two named
        # people — "Shared" can't send or receive one.
        b_person_out = 0.0
        b_person_in = 0.0
        if bucket is not None:
            b_person_out = sum(
                pt.points for pt in person_transfer_rows
                if pt.from_person == bucket and (not b_baseline_date or pt.transfer_date > b_baseline_date)
            )
            b_person_in = sum(
                pt.points for pt in person_transfer_rows
                if pt.to_person == bucket and (not b_baseline_date or pt.transfer_date > b_baseline_date)
            )

        # current_balance only counts POSTED points — pending ones aren't
        # actually redeemable yet. earned_since_baseline stays the full
        # accrual figure (period-earned stats elsewhere in the app want
        # "how much did I earn," not "how much can I spend right now").
        b_posted = b_earned - b_pending
        b_current = round(
            b_baseline + b_posted - b_redeemed - b_transferred_out + b_transferred_in
            + b_adjusted - b_person_out + b_person_in
        )
        return {
            'starting_balance': round(b_baseline, 2),
            'earned_since_baseline': round(b_earned, 2),
            'pending_since_baseline': round(b_pending, 2),
            'posted_since_baseline': round(b_posted, 2),
            'redeemed_since_baseline': round(b_redeemed, 2),
            'transferred_out_since_baseline': round(b_transferred_out, 2),
            'transferred_in_since_baseline': round(b_transferred_in, 2),
            'adjusted_since_baseline': round(b_adjusted, 2),
            'person_transfer_out_since_baseline': round(b_person_out, 2),
            'person_transfer_in_since_baseline': round(b_person_in, 2),
            'current_balance': b_current,
            'balance_as_of': b_baseline_date.isoformat() if b_baseline_date else None,
        }

    balance_by_person = {person: _compute_balance_bucket(person) for person in known_people}
    shared_bucket = _compute_balance_bucket(None)
    # Only surface "Shared" if it actually holds something — otherwise every
    # ecosystem would show a pointless all-zero third row forever.
    if any(shared_bucket[f] for f in (
        'starting_balance', 'earned_since_baseline', 'redeemed_since_baseline',
        'transferred_out_since_baseline', 'transferred_in_since_baseline',
        'adjusted_since_baseline', 'current_balance',
    )):
        balance_by_person['Shared'] = shared_bucket

    def _total_field(field):
        return round(sum(b[field] for b in balance_by_person.values()), 2)

    current_balance = round(sum(b['current_balance'] for b in balance_by_person.values()))
    # No single shared "as of" date makes sense once buckets can each have
    # their own — surface the most recent one that exists as a summary
    # label (None if not a single bucket has a snapshot yet).
    _bucket_dates = [b['balance_as_of'] for b in balance_by_person.values() if b['balance_as_of']]
    baseline_date = max((_date.fromisoformat(d) for d in _bucket_dates), default=None)

    balance_breakdown = {
        'starting_balance': _total_field('starting_balance'),
        'earned_since_baseline': _total_field('earned_since_baseline'),
        'pending_since_baseline': _total_field('pending_since_baseline'),
        'posted_since_baseline': _total_field('posted_since_baseline'),
        'redeemed_since_baseline': _total_field('redeemed_since_baseline'),
        'transferred_out_since_baseline': _total_field('transferred_out_since_baseline'),
        'transferred_in_since_baseline': _total_field('transferred_in_since_baseline'),
        'adjusted_since_baseline': _total_field('adjusted_since_baseline'),
    }
    pending_balance = _total_field('pending_since_baseline')

    return {
        'current_balance': current_balance,
        'pending_balance': pending_balance,
        'balance_as_of': baseline_date.isoformat() if baseline_date else None,
        'balance_breakdown': balance_breakdown,
        'balance_by_person': balance_by_person,
    }
