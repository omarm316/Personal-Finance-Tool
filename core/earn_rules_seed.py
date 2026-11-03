"""
core/earn_rules_seed.py — the data behind the 2027 earning engine
(docs/cards-categorization-rules.md):

  * MERCHANT_CATEGORIES — the merchant path tree (seeded every startup)
  * BRANDS              — the shared brand list and each brand's default path
  * EARN_RULES          — what each held card product pays (rewritten every
                          startup, like seed_card_products() does for the old
                          CardProductReward table)
  * initial_merchant_rules() — the one-time starting content of the
                          merchant_rules table. After the first deploy the
                          table is the only place merchant rules live; this
                          list is never consulted at runtime again.

Rates are TOTAL points per dollar. Each product carries a `checked` note:
'verified <date>' means the terms were compared with a published source,
'ported' means copied from the 2026 catalog in database.py and still needs
checking against current terms.
"""
from datetime import date

from database import (
    Brand, Card, CardCategorySelection, CardProduct, CategorizationRule,
    EarnRule, MerchantCategory, MerchantPointsMapping, MerchantRule,
)

# (name, parent, display_order). Rates name these levels, so a rule on
# 'Travel' also covers its sub-categories unless a more specific rule exists.
MERCHANT_CATEGORIES: list[tuple[str, str | None, int]] = [
    ('Travel',            None,        10),
    ('Airlines',          'Travel',    11),
    ('Hotels',            'Travel',    12),
    ('Car Rental',        'Travel',    13),
    ('Vacation Rentals',  'Travel',    14),
    ('Transit',           'Travel',    15),   # rideshare, taxis, trains, subway, parking, tolls
    ('Portal',            None,        20),   # booking portals are merchants (rule 7)
    ('Dining',            None,        30),
    ('Food Delivery',     None,        31),
    ('Groceries',         None,        40),
    ('Superstores',       None,        41),   # Walmart, Target — not Groceries (rule 4)
    ('Wholesale Clubs',   None,        42),   # Costco, Sam's Club
    ('Gas & EV',          None,        50),
    ('Gas Stations',      'Gas & EV',  51),
    ('EV Charging',       'Gas & EV',  52),
    ('Drugstores',        None,        60),
    ('Streaming',         None,        61),
    ('Online Shopping',   None,        62),
    ('Electronics',       None,        63),
    ('Home Improvement',  None,        64),
    ('Fitness',           None,        65),
    ('Live Entertainment', None,       66),
    ('Phone & Internet',  None,        70),
    ('Wireless',          'Phone & Internet', 71),
    ('Cable & Internet',  'Phone & Internet', 72),
    ('Advertising',       None,        80),
    ('Software & Cloud',  None,        81),
    ('Gift Cards',        None,        90),   # own category, base rate unless a card lists it (rule 11)
    ('Other',             None,        99),   # known merchant with no bonus category
]

BRANDS: list[tuple[str, str]] = [
    ('Hilton', 'Hotels'), ('Marriott', 'Hotels'), ('Hyatt', 'Hotels'), ('IHG', 'Hotels'),
    ('United', 'Airlines'), ('Delta', 'Airlines'), ('American Airlines', 'Airlines'),
    ('Alaska Airlines', 'Airlines'), ('Hawaiian Airlines', 'Airlines'), ('Southwest', 'Airlines'),
    ('JetBlue', 'Airlines'), ('El Al', 'Airlines'), ('Air Canada', 'Airlines'), ('Air France', 'Airlines'),
    ('Uber', 'Transit'), ('Lyft', 'Transit'),
    ('DoorDash', 'Food Delivery'), ('Uber Eats', 'Food Delivery'), ('Grubhub', 'Food Delivery'),
    ('Whole Foods', 'Groceries'), ('Instacart', 'Groceries'),
    ('Walmart', 'Superstores'), ('Target', 'Superstores'),
    ('Costco', 'Wholesale Clubs'), ("Sam's Club", 'Wholesale Clubs'), ("BJ's", 'Wholesale Clubs'),
    ('Amazon', 'Online Shopping'), ('Best Buy', 'Electronics'),
    ('Chase Travel', 'Portal'), ('Amex Travel', 'Portal'), ('Citi Travel', 'Portal'),
    ('Bilt Travel', 'Portal'), ('Capital One Travel', 'Portal'),
]

# Old points_category names → (merchant category, brand) in the new model.
# Used to migrate taught rules and to translate edits made from the old
# Merchant Category dropdown on rows dated 2027 or later.
LEGACY_CATEGORY_MAP: dict[str, tuple[str | None, str | None]] = {
    'Ground Transportation': ('Transit', None),
    'Transit & Rideshare': ('Transit', None),
    'Drugstore': ('Drugstores', None), 'Drug Store': ('Drugstores', None),
    'Dining & Restaurants': ('Dining', None),
    'Gas & EV Charging': ('Gas & EV', None),
    'Streaming & Subscriptions': ('Streaming', None),
    'Fitness & Gyms': ('Fitness', None),
    'Cable': ('Cable & Internet', None),
    'Rideshare: Lyft': (None, 'Lyft'), 'Rideshare: Uber': (None, 'Uber'),
    'United Purchases': (None, 'United'),
    'Amex Travel Hotels': (None, 'Amex Travel'),
    'Renowned Hotels & Resorts': ('Hotels', None),
    'Spa & Salon': ('Other', None), 'Marshalls': ('Other', None), 'West Elm': ('Other', None),
    'C&B': ('Other', None), 'General Merchandise': ('Other', None),
    'Other / Uncategorized': ('Other', None), 'Healthcare & Medical': ('Other', None),
    'Online Retail': ('Online Shopping', None),
}

_CATEGORY_NAMES = {name for name, _, _ in MERCHANT_CATEGORIES}
_BRAND_NAMES = {name for name, _ in BRANDS}


def translate_legacy_category(name: str | None) -> tuple[str | None, str | None] | None:
    """(merchant category, brand) for an old points_category name, or None
    if it has no equivalent (P2P Payments is a transaction kind, not a path)."""
    if not name:
        return None
    if name in _CATEGORY_NAMES:
        return (name, None)
    if name in _BRAND_NAMES:
        return (None, name)
    return LEGACY_CATEGORY_MAP.get(name)


# ── Earn rules ────────────────────────────────────────────────────────────────
# Rule keys: category | brand, rate, and optionally domestic/online/foreign
# (conditions), type ('fixed' default | 'top_n' | 'selected'), top_n, slot,
# cap, per (calendar_year | card_year | quarter | billing_cycle), group
# (shared cap), after (rate once the cap is used; default falls through).
# 'base' is a rate, or a dict with the same cap keys for a capped base rate.
EARN_RULES: dict[str, dict] = {
    'hilton_aspire': {
        'checked': 'verified 2026-11-02', 'base': 3, 'rules': [
            {'brand': 'Hilton', 'rate': 14},
            {'category': 'Airlines', 'rate': 7},       # direct with the airline or via Amex Travel
            {'category': 'Car Rental', 'rate': 7},     # select companies, booked directly
            {'category': 'Dining', 'rate': 7, 'domestic': True},
        ]},
    'amex_platinum': {
        'checked': 'ported (rates from memory 2026-10-25, confirm)', 'base': 1, 'rules': [
            {'category': 'Airlines', 'rate': 5, 'cap': 500000, 'per': 'calendar_year', 'group': 'flights'},
            {'brand': 'Amex Travel', 'rate': 5},       # prepaid hotels and flights on AmexTravel.com
        ]},
    'amex_business_gold': {
        'checked': 'verified 2026-07-31', 'base': 1, 'rules': [
            {'brand': 'Amex Travel', 'rate': 3},
            # 4x on the 2 eligible categories with the most spend each billing
            # cycle, $150,000 combined per calendar year, then 1x. Rules that
            # share a slot rank as one Amex category.
            {'category': 'Advertising', 'rate': 4, 'type': 'top_n', 'top_n': 2, 'slot': 'advertising',
             'domestic': True, 'cap': 150000, 'per': 'calendar_year', 'group': 'top2'},
            {'category': 'Electronics', 'rate': 4, 'type': 'top_n', 'top_n': 2, 'slot': 'electronics_software',
             'domestic': True, 'cap': 150000, 'per': 'calendar_year', 'group': 'top2'},
            {'category': 'Software & Cloud', 'rate': 4, 'type': 'top_n', 'top_n': 2, 'slot': 'electronics_software',
             'domestic': True, 'cap': 150000, 'per': 'calendar_year', 'group': 'top2'},
            {'category': 'Gas Stations', 'rate': 4, 'type': 'top_n', 'top_n': 2, 'slot': 'gas',
             'domestic': True, 'cap': 150000, 'per': 'calendar_year', 'group': 'top2'},
            {'category': 'Dining', 'rate': 4, 'type': 'top_n', 'top_n': 2, 'slot': 'dining',
             'domestic': True, 'cap': 150000, 'per': 'calendar_year', 'group': 'top2'},
            {'category': 'Transit', 'rate': 4, 'type': 'top_n', 'top_n': 2, 'slot': 'transit',
             'cap': 150000, 'per': 'calendar_year', 'group': 'top2'},
            {'category': 'Wireless', 'rate': 4, 'type': 'top_n', 'top_n': 2, 'slot': 'wireless',
             'domestic': True, 'cap': 150000, 'per': 'calendar_year', 'group': 'top2'},
        ]},
    'citi_strata_premier': {
        'checked': 'verified 2026-11-02', 'base': 1, 'rules': [
            {'brand': 'Citi Travel', 'rate': 10},      # hotels, cars, attractions; portal flights earn 3x
            {'category': 'Airlines', 'rate': 3},
            {'category': 'Hotels', 'rate': 3},
            {'category': 'Dining', 'rate': 3},
            {'category': 'Groceries', 'rate': 3},
            {'category': 'Gas & EV', 'rate': 3},
        ]},
    'chase_freedom_flex': {
        'checked': 'verified 2026-11-02', 'base': 1, 'rules': [
            {'brand': 'Chase Travel', 'rate': 5},
            {'category': 'Dining', 'rate': 3},
            {'category': 'Food Delivery', 'rate': 3},
            {'category': 'Drugstores', 'rate': 3},
            {'type': 'selected', 'slot': 'rotating', 'rate': 5, 'cap': 1500, 'per': 'quarter', 'group': 'rotating'},
        ]},
    'chase_freedom': {
        'checked': 'ported', 'base': 1, 'rules': [
            {'type': 'selected', 'slot': 'rotating', 'rate': 5, 'cap': 1500, 'per': 'quarter', 'group': 'rotating'},
        ]},
    'chase_freedom_unlimited': {
        'checked': 'ported', 'base': 1.5, 'rules': [
            {'brand': 'Chase Travel', 'rate': 5},
            {'category': 'Dining', 'rate': 3},
            {'category': 'Drugstores', 'rate': 3},
            {'brand': 'Lyft', 'rate': 5},              # Lyft promo from the 2026 catalog; end date unconfirmed
        ]},
    'chase_sapphire_preferred': {
        'checked': 'ported (rates from memory, June 2026 refresh unconfirmed — B35)', 'base': 1, 'rules': [
            {'brand': 'Chase Travel', 'rate': 5},
            {'category': 'Dining', 'rate': 3},
            {'category': 'Food Delivery', 'rate': 3},
            {'category': 'Streaming', 'rate': 3},
            {'category': 'Groceries', 'rate': 3, 'online': True},
            {'category': 'Travel', 'rate': 2},
            {'brand': 'Lyft', 'rate': 5},              # Lyft promo from the 2026 catalog; end date unconfirmed
        ]},
    'chase_amazon_prime': {
        'checked': 'ported (from memory, confirm)', 'base': 1, 'rules': [
            {'brand': 'Amazon', 'rate': 5},
            {'brand': 'Whole Foods', 'rate': 5},
            {'brand': 'Chase Travel', 'rate': 5},
            {'category': 'Dining', 'rate': 2},
            {'category': 'Gas Stations', 'rate': 2},
            {'category': 'Transit', 'rate': 2},
        ]},
    'bilt_obsidian': {
        'checked': 'verified 2026-10-25', 'base': 1, 'rules': [
            # 3x on Omer's chosen category (Groceries, confirmed), groceries
            # capped at $25,000 a year.
            {'type': 'selected', 'slot': 'choice', 'rate': 3, 'cap': 25000, 'per': 'calendar_year', 'group': 'choice'},
            {'category': 'Travel', 'rate': 2},
            {'category': 'Transit', 'rate': 1},        # Bilt doesn't count rideshare/parking as travel (unconfirmed)
        ]},
    'united_quest': {
        'checked': 'ported', 'base': 1, 'rules': [
            {'brand': 'United', 'rate': 3},
            {'category': 'Travel', 'rate': 2},
            {'category': 'Dining', 'rate': 2},
            {'category': 'Streaming', 'rate': 2},
        ]},
    'united_explorer': {
        'checked': 'ported', 'base': 1, 'rules': [
            {'brand': 'United', 'rate': 2},
            {'category': 'Dining', 'rate': 2},
            {'category': 'Hotels', 'rate': 2},          # booked directly with the hotel
        ]},
    'amex_blue_business_plus': {
        'checked': 'ported', 'base': {'rate': 2, 'cap': 50000, 'per': 'calendar_year', 'after': 1}, 'rules': []},
    'marriott_bonvoy_brilliant': {
        # The 2026 catalog paid 6x at every hotel; the card pays 6x at Marriott only.
        'checked': 'ported (Hotels 6x narrowed to Marriott)', 'base': 2, 'rules': [
            {'brand': 'Marriott', 'rate': 6},
            {'category': 'Dining', 'rate': 3},
            {'category': 'Airlines', 'rate': 3},
        ]},
    'marriott_bonvoy_boundless': {
        'checked': 'ported (cap period unconfirmed)', 'base': 2, 'rules': [
            {'brand': 'Marriott', 'rate': 6},
            {'category': 'Groceries', 'rate': 3, 'cap': 6000, 'per': 'calendar_year', 'group': 'everyday3x'},
            {'category': 'Gas Stations', 'rate': 3, 'cap': 6000, 'per': 'calendar_year', 'group': 'everyday3x'},
            {'category': 'Dining', 'rate': 3, 'cap': 6000, 'per': 'calendar_year', 'group': 'everyday3x'},
        ]},
    'hilton_honors': {
        'checked': 'ported', 'base': 3, 'rules': [
            {'brand': 'Hilton', 'rate': 7},
            {'category': 'Dining', 'rate': 5, 'domestic': True},
            {'category': 'Groceries', 'rate': 5, 'domestic': True},
            {'category': 'Gas Stations', 'rate': 5, 'domestic': True},
        ]},
    'hyatt_personal': {
        'checked': 'ported (from memory, confirm)', 'base': 1, 'rules': [
            {'brand': 'Hyatt', 'rate': 4},
            {'category': 'Dining', 'rate': 2},
            {'category': 'Airlines', 'rate': 2},        # tickets bought directly from the airline
            {'category': 'Transit', 'rate': 2},
            {'category': 'Fitness', 'rate': 2},
        ]},
    'citi_custom_cash': {
        # 5x on the top eligible category each billing cycle, first $500.
        'checked': 'ported', 'base': 1, 'rules': [
            {'category': c, 'rate': 5, 'type': 'top_n', 'top_n': 1, 'slot': s,
             'cap': 500, 'per': 'billing_cycle', 'group': 'top1'}
            for c, s in [('Dining', 'dining'), ('Gas & EV', 'gas'), ('Groceries', 'grocery'),
                         ('Airlines', 'travel'), ('Hotels', 'travel'), ('Transit', 'transit'),
                         ('Streaming', 'streaming'), ('Drugstores', 'drugstores'),
                         ('Home Improvement', 'home_improvement'), ('Fitness', 'fitness'),
                         ('Live Entertainment', 'live_entertainment')]
        ]},
    'citi_double_cash': {'checked': 'ported', 'base': 2, 'rules': []},
    'citi_aa_platinum_select': {
        'checked': 'verified 2026-07-26', 'base': 1, 'rules': [
            {'brand': 'American Airlines', 'rate': 2},
            {'category': 'Dining', 'rate': 2},
            {'category': 'Gas Stations', 'rate': 2},
        ]},
    'delta_gold': {
        'checked': 'ported', 'base': 1, 'rules': [
            {'brand': 'Delta', 'rate': 2},
            {'category': 'Dining', 'rate': 2},
            {'category': 'Groceries', 'rate': 2, 'domestic': True},
        ]},
    'atmos_ascent': {
        'checked': 'ported', 'base': 1, 'rules': [
            {'brand': 'Alaska Airlines', 'rate': 3},
            {'brand': 'Hawaiian Airlines', 'rate': 3},
            {'category': 'Gas & EV', 'rate': 2},
            {'category': 'Cable & Internet', 'rate': 2},
            {'category': 'Streaming', 'rate': 2},
            {'category': 'Transit', 'rate': 2},
        ]},
    'discover_it': {
        'checked': 'ported', 'base': 1, 'rules': [
            {'type': 'selected', 'slot': 'rotating', 'rate': 5, 'cap': 1500, 'per': 'quarter', 'group': 'rotating'},
        ]},
    'us_bank_cash_plus': {
        'checked': 'ported', 'base': 1, 'rules': [
            {'type': 'selected', 'slot': 'five', 'rate': 5, 'cap': 2000, 'per': 'quarter', 'group': 'five'},
            {'type': 'selected', 'slot': 'two', 'rate': 2},
        ]},
    'bofa_customized_cash': {
        # $2,500 a quarter combined across the 3% choice and the 2% categories.
        'checked': 'ported', 'base': 1, 'rules': [
            {'type': 'selected', 'slot': 'choice', 'rate': 3, 'cap': 2500, 'per': 'quarter', 'group': 'bonus'},
            {'category': 'Groceries', 'rate': 2, 'cap': 2500, 'per': 'quarter', 'group': 'bonus'},
            {'category': 'Wholesale Clubs', 'rate': 2, 'cap': 2500, 'per': 'quarter', 'group': 'bonus'},
        ]},
    'capital_one_venture_one': {
        'checked': 'ported', 'base': 1.25, 'rules': [
            {'brand': 'Capital One Travel', 'rate': 5},
        ]},
}

# Card-level choices already confirmed by Omer, inserted once if missing:
# (product_key, slot, category, period_start).
KNOWN_SELECTIONS: list[tuple[str, str, str, date]] = [
    ('bilt_obsidian', 'choice', 'Groceries', date(2027, 1, 1)),
]


# ── Merchant rules: starting content ──────────────────────────────────────────
# Transaction kinds identified from the descriptor itself (rule 8). Fee and
# interest kinds on a positive amount are read as a credit (a refund of the
# fee), and a credit kind on a negative amount is ignored.
KIND_RULES: list[tuple[str, str]] = [
    ('ANNUAL FEE', 'fee'), ('MEMBERSHIP FEE', 'fee'), ('LATE FEE', 'fee'),
    ('FOREIGN TRANSACTION FEE', 'fee'), ('FOREIGN TRANS FEE', 'fee'),
    ('RETURNED PAYMENT FEE', 'fee'), ('CASH ADVANCE FEE', 'fee'),
    ('BALANCE TRANSFER FEE', 'fee'), ('OVERLIMIT FEE', 'fee'),
    ('INTEREST CHARGE', 'interest'), ('INTEREST CHARGED', 'interest'),
    ('FINANCE CHARGE', 'interest'), ('INTEREST REF', 'interest'),
    ('MOVED TO STANDARD PURCH', 'adjustment'),
    ('CREDIT', 'credit'), ('STATEMENT CREDIT', 'credit'), ('OFFER', 'credit'),
    ('CASH BACK DEAL', 'credit'), ('REIMBURSEMENT', 'credit'),
    ('VENMO', 'p2p'), ('ZELLE', 'p2p'), ('CASH APP', 'p2p'),
]

# (pattern, category, brand, match_type). Added on top of the old code list.
EXTRA_MERCHANT_RULES: list[tuple[str, str | None, str | None, str]] = [
    # Booking portals (rule 7)
    ('CHASE TRAVEL', None, 'Chase Travel', 'word'),
    ('AMEX TRAVEL', None, 'Amex Travel', 'word'),
    ('AMEXTRAVEL COM', None, 'Amex Travel', 'contains'),   # "AMEX Fine Hotels andAmexTravel.com"
    ('CITI TRAVEL', None, 'Citi Travel', 'word'),
    ('BILT TRAVEL', None, 'Bilt Travel', 'word'),
    ('CAPITAL ONE TRAVEL', None, 'Capital One Travel', 'word'),
    # Gift cards (rule 11) — "DD *DOORDASH GIFTCARDS" beats DoorDash by length
    ('GIFT CARD', 'Gift Cards', None, 'word'), ('GIFT CARDS', 'Gift Cards', None, 'word'),
    ('GIFTCARD', 'Gift Cards', None, 'word'), ('GIFTCARDS', 'Gift Cards', None, 'word'),
    ('GIFTCARDS COM', 'Gift Cards', None, 'word'),
    # Whole-word forms of old prefix patterns
    ('UNITED AIRLINES', None, 'United', 'word'), ('DELTA AIR LINES', None, 'Delta', 'word'),
    ('DELTA AIRLINES', None, 'Delta', 'word'), ('AMERICAN AIRLINES', None, 'American Airlines', 'word'),
    ('SOUTHWEST AIRLINES', None, 'Southwest', 'word'), ('ALASKA AIRLINES', None, 'Alaska Airlines', 'word'),
    ('HAWAIIAN AIRLINES', None, 'Hawaiian Airlines', 'word'),
    ('WALGREENS', 'Drugstores', None, 'word'), ('TRADER JOES', 'Groceries', None, 'word'),
    ('MCDONALDS', 'Dining', None, 'word'), ('DOMINOS', 'Dining', None, 'word'),
    ('KILWINS', 'Dining', None, 'word'), ('AMZN', None, 'Amazon', 'word'),
    ('WM SUPERCENTER', None, 'Walmart', 'word'),
    # Airlines and hotel families seen in the data or common
    ('EL AL', None, 'El Al', 'word'), ('AIR CANADA', None, 'Air Canada', 'word'),
    ('AIR FRANCE', None, 'Air France', 'word'),
    ('HAMPTON INN', None, 'Hilton', 'word'), ('DOUBLETREE', None, 'Hilton', 'word'),
    ('EMBASSY SUITES', None, 'Hilton', 'word'), ('WALDORF ASTORIA', None, 'Hilton', 'word'),
    ('HOMEWOOD SUITES', None, 'Hilton', 'word'), ('HOME2 SUITES', None, 'Hilton', 'word'),
    ('HILTON GARDEN', None, 'Hilton', 'word'), ('CURIO COLLECTION', None, 'Hilton', 'word'),
    ('RESIDENCE INN', None, 'Marriott', 'word'), ('FAIRFIELD INN', None, 'Marriott', 'word'),
    ('SPRINGHILL SUITES', None, 'Marriott', 'word'), ('TOWNEPLACE SUITES', None, 'Marriott', 'word'),
    ('RENAISSANCE HOTEL', None, 'Marriott', 'word'), ('AC HOTEL', None, 'Marriott', 'word'),
    ('MOXY', None, 'Marriott', 'word'), ('ALOFT', None, 'Marriott', 'word'),
    ('LE MERIDIEN', None, 'Marriott', 'word'), ('W HOBOKEN', None, 'Marriott', 'word'),
    ('ANDAZ', None, 'Hyatt', 'word'), ('THOMPSON HOUSTON', None, 'Hyatt', 'word'),
    # Categories
    ('COSTCO GAS', 'Gas Stations', None, 'word'), ('EXXONMOBIL', 'Gas Stations', None, 'word'),
    ('RENT A CAR', 'Car Rental', None, 'word'),
    ('AIRBNB', 'Vacation Rentals', None, 'word'), ('VRBO', 'Vacation Rentals', None, 'word'),
    ('PARKING', 'Transit', None, 'word'), ('TAXI', 'Transit', None, 'word'),
    ('NYCT PAYGO', 'Transit', None, 'word'), ('GETT', 'Transit', None, 'word'),
    ('DISNEY PLUS', 'Streaming', None, 'word'), ('APPLE TV+', 'Streaming', None, 'word'),
    ('PARAMOUNT PLUS', 'Streaming', None, 'word'), ('YOUTUBE TV', 'Streaming', None, 'word'),
    ('T MOBILE', 'Wireless', None, 'word'), ('VERIZON WIRELESS', 'Wireless', None, 'word'),
    ('VZWRLSS', 'Wireless', None, 'word'), ('VERIZON FIOS', 'Cable & Internet', None, 'word'),
    ('COMCAST', 'Cable & Internet', None, 'word'), ('XFINITY', 'Cable & Internet', None, 'word'),
    ('OPTIMUM', 'Cable & Internet', None, 'word'), ('SPECTRUM', 'Cable & Internet', None, 'word'),
    ('OPENAI', 'Software & Cloud', None, 'word'), ('CHATGPT', 'Software & Cloud', None, 'word'),
    ('SQUARESPACE', 'Software & Cloud', None, 'word'), ('ADOBE', 'Software & Cloud', None, 'word'),
    ('DROPBOX', 'Software & Cloud', None, 'word'), ('GOOGLE WORKSPACE', 'Software & Cloud', None, 'word'),
    ('GOOGLE ADS', 'Advertising', None, 'word'), ('FACEBK', 'Advertising', None, 'word'),
    ('META ADS', 'Advertising', None, 'word'),
    ('HOME DEPOT', 'Home Improvement', None, 'word'), ('LOWES', 'Home Improvement', None, 'word'),
    ('LOWE S', 'Home Improvement', None, 'word'),
    ('PLANET FITNESS', 'Fitness', None, 'word'), ('EQUINOX', 'Fitness', None, 'word'),
    ('TICKETMASTER', 'Live Entertainment', None, 'word'), ('STUBHUB', 'Live Entertainment', None, 'word'),
    ('LIVE NATION', 'Live Entertainment', None, 'word'), ('SEATGEEK', 'Live Entertainment', None, 'word'),
    # Carried forward from Omer's 2026 manual tags (whole-word matching would
    # otherwise lose them; found by the dry run)
    ('PRUPLAZACAFE', 'Dining', None, 'word'), ('TAMPA EDITION', None, 'Marriott', 'word'),
    ('ALUMA ATHINA', None, 'Hilton', 'word'), ('WALMART+', None, 'Walmart', 'word'),
    ('BURGER KING', 'Dining', None, 'word'), ('MECDONALDS', 'Dining', None, 'word'),
    ('LIDL', 'Groceries', None, 'word'), ('PASSNY', 'Transit', None, 'word'),
    ('PATH TAPP', 'Transit', None, 'word'), ('RAILWAY', 'Transit', None, 'word'),
    ('ALLIANZ', 'Travel', None, 'word'), ('CLEAR', 'Travel', None, 'word'),
    ('EXCHANGE PHYSICAL', 'Other', None, 'word'),
]

# Old code patterns whose old mapping doesn't carry over as-is.
_OLD_PATTERN_OVERRIDES: dict[str, tuple[str | None, str | None]] = {
    'new york times': ('Other', None), 'nytimes': ('Other', None),   # news isn't streaming at most issuers
    'wsj': ('Other', None), 'washington post': ('Other', None),
    'instacart': (None, 'Instacart'), 'whole foods': (None, 'Whole Foods'),
    'costco': (None, 'Costco'), "sam's club": (None, "Sam's Club"), 'sams club': (None, "Sam's Club"),
    'uber eats': (None, 'Uber Eats'), 'doordash': (None, 'DoorDash'), 'door dash': (None, 'DoorDash'),
    'doordasan': (None, 'DoorDash'), 'grubhub': (None, 'Grubhub'),
}

# Taught rows (merchant_points_mappings) needing a decision, by id. 'skip'
# drops the row; 'review' migrates it inactive for Omer to decide.
_TAUGHT_OVERRIDES: dict[int, object] = {
    29: 'skip',      # "King" → Groceries matched "Parking"; the code rule "Kings" covers the stores
    16: 'skip',      # "DoorDash" → Dining contradicted the Food Delivery rule
    15: ('Gift Cards', None),     # Giftcards.com
    23: ('Other', None),          # Lululemon
    17: 'review', 8: 'review', 9: 'review',   # "Aspire" → Hilton, "Liberty Science"/"TPA" → Dining
}


def initial_merchant_rules(taught_rows: list | None = None) -> list[dict]:
    """The starting rule list: kind rules, the old code patterns translated to
    the new model, the extra rules above, and Omer's taught rows. Later
    entries never replace earlier ones with the same pattern, so the order
    here is the precedence for exact duplicates."""
    from core.merchant_classifier import normalize
    from core.points_engine import _MERCHANT_POINTS_PATTERNS

    out: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def add(pattern, category=None, brand=None, kind=None, match_type='word',
            source='migrated', active=True, notes=None):
        key = (normalize(pattern), match_type)
        if not key[0] or key in seen:
            return
        seen.add(key)
        out.append({'pattern': pattern, 'match_type': match_type, 'category': category,
                    'brand': brand, 'kind': kind, 'source': source,
                    'is_active': active, 'notes': notes})

    for pattern, kind in KIND_RULES:
        add(pattern, kind=kind)
    for pattern, category, brand, match_type in EXTRA_MERCHANT_RULES:
        add(pattern, category, brand, match_type=match_type)
    for pattern, old_cat in _MERCHANT_POINTS_PATTERNS:
        mapped = _OLD_PATTERN_OVERRIDES.get(pattern) or translate_legacy_category(old_cat)
        if mapped:
            add(pattern, mapped[0], mapped[1])
    for row in taught_rows or []:
        decision = _TAUGHT_OVERRIDES.get(row['id'])
        if decision == 'skip':
            continue
        mapped = decision if isinstance(decision, tuple) else translate_legacy_category(row['category'])
        if decision == 'review':
            add(row['pattern'], *(mapped or (None, None)), source='taught', active=False,
                notes='Needs Omer\'s review before use (docs/cards-categorization-rules.md, "Odd rules")')
        elif mapped:
            add(row['pattern'], mapped[0], mapped[1], source='taught')
    return out


# ── Seeding ───────────────────────────────────────────────────────────────────

def seed_earning_catalog(session) -> None:
    """Merchant category tree and brands (insert if missing, parents
    refreshed), then every product's earn rules rewritten from EARN_RULES.
    Safe on every startup."""
    cats = {c.name: c for c in session.query(MerchantCategory).all()}
    for name, _parent, order in MERCHANT_CATEGORIES:
        if name not in cats:
            cats[name] = MerchantCategory(name=name)
            session.add(cats[name])
        cats[name].display_order = order
    session.flush()
    for name, parent, _order in MERCHANT_CATEGORIES:
        cats[name].parent_id = cats[parent].id if parent else None

    brands = {b.name: b for b in session.query(Brand).all()}
    for name, cat in BRANDS:
        if name not in brands:
            brands[name] = Brand(name=name, default_category_id=cats[cat].id)
            session.add(brands[name])
    session.flush()

    products = {p.product_key: p for p in session.query(CardProduct).all()}
    for key, spec in EARN_RULES.items():
        product = products.get(key)
        if not product:
            continue
        session.query(EarnRule).filter_by(product_id=product.id).delete()
        base = spec['base'] if isinstance(spec['base'], dict) else {'rate': spec['base']}
        for r in [base] + spec['rules']:
            session.add(EarnRule(
                product_id=product.id,
                merchant_category_id=cats[r['category']].id if r.get('category') else None,
                brand_id=brands[r['brand']].id if r.get('brand') else None,
                rate=r['rate'],
                rule_type=r.get('type', 'fixed'),
                top_n=r.get('top_n'),
                slot=r.get('slot'),
                domestic_only=bool(r.get('domestic')),
                online_only=bool(r.get('online')),
                foreign_only=bool(r.get('foreign')),
                cap_amount=r.get('cap'),
                cap_period=r.get('per'),
                cap_group=r.get('group'),
                rate_after_cap=r.get('after'),
                effective_from=r.get('from'),
                effective_to=r.get('to'),
                notes=spec.get('checked'),
            ))

    for key, slot, cat, start in KNOWN_SELECTIONS:
        product = products.get(key)
        if not product:
            continue
        for card in session.query(Card).filter_by(product_id=product.id, is_active=True).all():
            exists = session.query(CardCategorySelection).filter_by(card_id=card.id, slot=slot).first()
            if not exists:
                session.add(CardCategorySelection(card_id=card.id, slot=slot, period_start=start,
                                                  merchant_category_id=cats[cat].id,
                                                  notes='Confirmed by Omer'))
    session.commit()


def migrate_merchant_rules_once(session) -> int:
    """Fill merchant_rules the first time only (an empty table). Never runs
    again, so a rule Omer deletes stays deleted. Returns rows inserted."""
    if session.query(MerchantRule).first():
        return 0
    cats = {c.name: c.id for c in session.query(MerchantCategory).all()}
    brands = {b.name: b.id for b in session.query(Brand).all()}
    taught = [
        {'id': m.id, 'pattern': m.merchant_pattern,
         'category': m.points_category.name if m.points_category else None}
        for m in session.query(MerchantPointsMapping).all()
    ]
    rows = initial_merchant_rules(taught)
    # The one points note on a categorization rule (VENMO → P2P Payments) is
    # covered by the VENMO kind rule; anything else would be listed here.
    for r in session.query(CategorizationRule).filter(CategorizationRule.notes.like('%points:%')).all():
        if r.pattern and r.pattern.upper() not in {k for k, _ in KIND_RULES}:
            rows.append({'pattern': r.pattern, 'match_type': 'word', 'category': None, 'brand': None,
                         'kind': None, 'source': 'taught', 'is_active': False,
                         'notes': f'From categorization rule {r.id} notes "{r.notes}" — needs review'})
    for r in rows:
        session.add(MerchantRule(
            pattern=r['pattern'], match_type=r['match_type'],
            merchant_category_id=cats.get(r['category']) if r['category'] else None,
            brand_id=brands.get(r['brand']) if r['brand'] else None,
            txn_kind=r['kind'], source=r['source'], is_active=r['is_active'], notes=r['notes'],
        ))
    session.commit()
    return len(rows)
