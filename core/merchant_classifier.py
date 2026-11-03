"""
core/merchant_classifier.py — merchant path and transaction kind for the
2027 earning engine (docs/cards-categorization-rules.md, rules 1, 4, 6-8,
10, 14 and 15).

One rule list (the merchant_rules table). Patterns match whole words in the
merchant name or the raw description after both are normalized the same way
(upper case, punctuation to spaces), so "KING" no longer matches "PARKING".
The longest matching pattern wins. Kind and path are resolved separately:
"PLATINUM HOTEL CREDIT" is a credit whatever its path says.
"""
import re
from dataclasses import dataclass

# '+' is kept so "DISNEY+" and "APPLE TV+" stay distinct from "DISNEY".
_SEPARATORS = re.compile(r'[^A-Z0-9+]+')

# Plaid personal_finance_category (detailed) → merchant category, used only
# when no merchant rule sets a path. Keys checked against Plaid's published
# taxonomy, which fixes the wrong keys in the old _PFC_POINTS_MAP (B34).
PFC_CATEGORY_MAP: dict[str, str] = {
    'TRAVEL_FLIGHTS': 'Airlines',
    'TRAVEL_LODGING': 'Hotels',
    'TRAVEL_RENTAL_CARS': 'Car Rental',
    'TRAVEL_OTHER_TRAVEL': 'Travel',
    'TRANSPORTATION_TAXIS_AND_RIDE_SHARES': 'Transit',
    'TRANSPORTATION_PUBLIC_TRANSIT': 'Transit',
    'TRANSPORTATION_PARKING': 'Transit',
    'TRANSPORTATION_TOLLS': 'Transit',
    'TRANSPORTATION_GAS': 'Gas Stations',
    'FOOD_AND_DRINK_RESTAURANT': 'Dining',
    'FOOD_AND_DRINK_FAST_FOOD': 'Dining',
    'FOOD_AND_DRINK_COFFEE': 'Dining',
    'FOOD_AND_DRINK_GROCERIES': 'Groceries',
    'GENERAL_MERCHANDISE_SUPERSTORES': 'Superstores',
    'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES': 'Online Shopping',
    'GENERAL_MERCHANDISE_ELECTRONICS': 'Electronics',
    'MEDICAL_PHARMACIES_AND_SUPPLEMENTS': 'Drugstores',
    'HOME_IMPROVEMENT_HARDWARE': 'Home Improvement',
    'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': 'Fitness',
    'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_CONCERTS': 'Live Entertainment',
    'ENTERTAINMENT_MUSIC_AND_AUDIO': 'Streaming',
    'RENT_AND_UTILITIES_TELEPHONE': 'Wireless',
    'RENT_AND_UTILITIES_INTERNET_AND_CABLE': 'Cable & Internet',
}

# Card-payment descriptors (same list the old engine uses) plus the
# "PAYMENT ... THANK YOU" pair.
_PAYMENT_KEYWORDS = ('CREDIT CRD', 'CREDIT CARD', 'AUTOPAY', 'CC PAYMENT', 'CARD PAYMENT')

EARNING_KINDS = frozenset({'purchase', 'refund'})
NON_EARNING_KINDS = frozenset({'fee', 'interest', 'credit', 'payment', 'p2p', 'adjustment'})


def normalize(text: str | None) -> str:
    if not text:
        return ''
    return _SEPARATORS.sub(' ', text.upper()).strip()


@dataclass(frozen=True)
class RuleEntry:
    id: int | None
    norm: str
    match_type: str
    category: str | None
    brand: str | None
    kind: str | None


class RuleIndex:
    """Active merchant rules sorted most specific first."""

    def __init__(self, entries: list[RuleEntry]):
        self.entries = sorted(entries, key=lambda e: (-len(e.norm), e.id or 0))

    @classmethod
    def from_db(cls, db) -> 'RuleIndex':
        from database import MerchantRule
        rows = db.query(MerchantRule).filter(MerchantRule.is_active == True).all()  # noqa: E712
        return cls([
            RuleEntry(r.id, normalize(r.pattern), r.match_type or 'word',
                      r.merchant_category.name if r.merchant_category else None,
                      r.brand.name if r.brand else None, r.txn_kind)
            for r in rows if normalize(r.pattern)
        ])

    @classmethod
    def from_dicts(cls, rows: list[dict]) -> 'RuleIndex':
        """For the engine check and tests: rows shaped like initial_merchant_rules()."""
        return cls([
            RuleEntry(i, normalize(r['pattern']), r.get('match_type', 'word'),
                      r.get('category'), r.get('brand'), r.get('kind'))
            for i, r in enumerate(rows, 1) if r.get('is_active', True) and normalize(r['pattern'])
        ])

    def match(self, *texts: str | None) -> tuple[RuleEntry | None, RuleEntry | None]:
        """(most specific rule that sets a path, most specific rule that sets a kind)."""
        plain = [normalize(t) for t in texts if t]
        padded = [f' {p} ' for p in plain]
        path_rule = kind_rule = None
        for e in self.entries:
            if path_rule and kind_rule:
                break
            wants_path = path_rule is None and (e.category or e.brand)
            wants_kind = kind_rule is None and e.kind
            if not (wants_path or wants_kind):
                continue
            if e.match_type == 'contains':
                hit = any(e.norm in p for p in plain)
            else:
                hit = any(f' {e.norm} ' in p for p in padded)
            if not hit:
                continue
            if wants_path:
                path_rule = e
            if wants_kind:
                kind_rule = e
        return path_rule, kind_rule


@dataclass
class Catalog:
    """Merchant category tree and brand defaults, by name."""
    parent: dict[str, str | None]
    brand_category: dict[str, str | None]

    @classmethod
    def from_db(cls, db) -> 'Catalog':
        from database import Brand, MerchantCategory
        cats = db.query(MerchantCategory).all()
        by_id = {c.id: c.name for c in cats}
        return cls(
            parent={c.name: by_id.get(c.parent_id) for c in cats},
            brand_category={b.name: by_id.get(b.default_category_id) for b in db.query(Brand).all()},
        )

    @classmethod
    def from_seed(cls) -> 'Catalog':
        from core.earn_rules_seed import BRANDS, MERCHANT_CATEGORIES
        return cls(parent={n: p for n, p, _ in MERCHANT_CATEGORIES},
                   brand_category=dict(BRANDS))

    def level(self, category: str | None) -> int:
        """2 for a sub-category, 1 for a top-level category, 0 for none."""
        if not category:
            return 0
        return 2 if self.parent.get(category) else 1


def get_rule_index(db) -> RuleIndex:
    """Per-session cache: a sync classifies many rows with one rule load."""
    if 'merchant_rule_index' not in db.info:
        db.info['merchant_rule_index'] = RuleIndex.from_db(db)
    return db.info['merchant_rule_index']


def get_catalog(db) -> Catalog:
    if 'merchant_catalog' not in db.info:
        db.info['merchant_catalog'] = Catalog.from_db(db)
    return db.info['merchant_catalog']


def forget_cached_rules(db) -> None:
    """Call after changing merchant rules, brands or categories in this session."""
    db.info.pop('merchant_rule_index', None)
    db.info.pop('merchant_catalog', None)


def _resolve_kind(rule_kind: str | None, t) -> str:
    amount = t.amount or 0
    if rule_kind in ('fee', 'interest') and amount > 0:
        return 'credit'          # a fee or interest refund
    if rule_kind == 'credit' and amount < 0:
        rule_kind = None         # "CREDIT" in a purchase descriptor isn't a statement credit
    if rule_kind:
        return rule_kind
    desc = (t.description_raw or '').upper()
    if any(kw in desc for kw in _PAYMENT_KEYWORDS) or ('PAYMENT' in desc and 'THANK' in desc):
        return 'payment'
    if t.action and t.action != 'Expense':
        return 'payment' if t.action in ('Transfer', 'Income') else 'adjustment'
    return 'refund' if amount > 0 else 'purchase'


def classify_transaction(t, index: RuleIndex, catalog: Catalog) -> None:
    """Set merchant_category, brand, txn_kind, merchant_rule_id,
    classification_source and is_foreign on one transaction. A manual
    classification is left alone."""
    if t.merchant_country and t.classification_source != 'manual':
        t.is_foreign = t.merchant_country.upper() != 'US'
    if t.classification_source == 'manual':
        return

    path_rule, kind_rule = index.match(t.merchant_name, t.description_raw)
    t.txn_kind = _resolve_kind(kind_rule.kind if kind_rule else None, t)

    if path_rule:
        t.brand = path_rule.brand
        t.merchant_category = path_rule.category or catalog.brand_category.get(path_rule.brand)
        t.merchant_rule_id = path_rule.id
        t.classification_source = 'rule'
    elif t.pfc_detailed and t.pfc_detailed in PFC_CATEGORY_MAP:
        t.brand = None
        t.merchant_category = PFC_CATEGORY_MAP[t.pfc_detailed]
        t.merchant_rule_id = None
        t.classification_source = 'plaid'
    else:
        t.brand = None
        t.merchant_category = None
        t.merchant_rule_id = None
        t.classification_source = 'none'   # unknown is a visible state (rule 14)
