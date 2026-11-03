"""
core/earn_engine.py — points for transactions dated on or after
POINTS_FRESH_START (docs/cards-categorization-rules.md).

Earlier rows keep the old engine in core/points_engine.py, untouched, and are
never re-scored by this one: no repair of history.

How a transaction's rate is found (rule 3): every EarnRule of the card's
product that matches the transaction's merchant path and passes its
conditions is a candidate. Candidates are tried most specific first — brand,
then sub-category, then category, then base — and within a level the highest
rate first. A capped rule pays its rate until the cap period's spend runs
out, then the rest of the purchase falls to the next candidate (or to
rate_after_cap when set).

Caps, top-category rules (Custom Cash, Business Gold) and capped selected
categories depend on the card's other transactions, so on such a card every
2027 row is re-scored in date order whenever one of them is locked. That
keeps each row's stored points right even when an earlier charge arrives
late.
"""
import calendar
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from core.merchant_classifier import (
    EARNING_KINDS, Catalog, classify_transaction, get_catalog, get_rule_index, normalize,
)

POINTS_FRESH_START = date(2027, 1, 1)
POINTS_FRESH_START_DT = datetime(2027, 1, 1)

REFUND_LOOKBACK_DAYS = 120


def uses_new_engine(txn_date) -> bool:
    d = txn_date.date() if hasattr(txn_date, 'date') else txn_date
    return d >= POINTS_FRESH_START


@dataclass(frozen=True)
class Rule:
    category: str | None
    brand: str | None
    rate: float
    rule_type: str = 'fixed'
    top_n: int | None = None
    slot: str | None = None
    domestic_only: bool = False
    online_only: bool = False
    foreign_only: bool = False
    cap: float | None = None
    cap_period: str | None = None
    cap_group: str | None = None
    rate_after_cap: float | None = None
    effective_from: date | None = None
    effective_to: date | None = None

    @property
    def is_base(self) -> bool:
        return self.rule_type == 'fixed' and not self.category and not self.brand

    @property
    def cap_key(self) -> str:
        return self.cap_group or f'{self.rule_type}:{self.category}:{self.brand}:{self.slot}'

    def in_effect(self, d: date) -> bool:
        return ((self.effective_from is None or d >= self.effective_from)
                and (self.effective_to is None or d < self.effective_to))


@dataclass(frozen=True)
class Selection:
    slot: str
    category: str | None
    brand: str | None
    start: date
    end: date | None

    def covers(self, d: date) -> bool:
        return self.start <= d and (self.end is None or d <= self.end)


@dataclass
class CardInfo:
    issuer: str | None
    close_day: int | None
    issue_date: date | None
    selections: list[Selection]


def rules_from_spec(spec: dict) -> list[Rule]:
    """EarnRule-shaped Rules from one EARN_RULES entry (engine check, tests)."""
    base = spec['base'] if isinstance(spec['base'], dict) else {'rate': spec['base']}
    return [Rule(category=r.get('category'), brand=r.get('brand'), rate=r['rate'],
                 rule_type=r.get('type', 'fixed'), top_n=r.get('top_n'), slot=r.get('slot'),
                 domestic_only=bool(r.get('domestic')), online_only=bool(r.get('online')),
                 foreign_only=bool(r.get('foreign')), cap=r.get('cap'), cap_period=r.get('per'),
                 cap_group=r.get('group'), rate_after_cap=r.get('after'),
                 effective_from=r.get('from'), effective_to=r.get('to'))
            for r in [base] + spec['rules']]


def is_stateful(rules: list[Rule]) -> bool:
    return any(r.cap or r.rule_type == 'top_n' for r in rules)


# ── Periods ───────────────────────────────────────────────────────────────────

def _billing_cycle_key(d: date, close_day: int | None):
    if not close_day:
        return (d.year, d.month)              # no close day known: calendar month
    last = calendar.monthrange(d.year, d.month)[1]
    close = d.replace(day=min(close_day, last))
    if d <= close:
        return close
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(y, m, min(close_day, calendar.monthrange(y, m)[1]))


def period_key(period: str | None, d: date, card: CardInfo):
    if period == 'quarter':
        return (d.year, (d.month - 1) // 3)
    if period == 'billing_cycle':
        return _billing_cycle_key(d, card.close_day)
    if period == 'card_year' and card.issue_date:
        anniv = card.issue_date.replace(year=d.year)
        return anniv if anniv <= d else card.issue_date.replace(year=d.year - 1)
    return d.year                              # calendar_year, or card_year with no open date


# ── Matching ──────────────────────────────────────────────────────────────────

def _target_level(category: str | None, brand: str | None, t, catalog: Catalog) -> int:
    """How specifically a (category, brand) target matches t's merchant path:
    3 brand, 2 sub-category, 1 category, 0 no match."""
    if brand:
        return 3 if brand == t.brand else 0
    if category:
        if category == t.merchant_category:
            return catalog.level(category)
        if category == catalog.parent.get(t.merchant_category):
            return 1
    return 0


def _conditions_pass(rule: Rule, t) -> bool:
    if rule.domestic_only and t.is_foreign:
        return False
    if rule.foreign_only and not t.is_foreign:
        return False
    if rule.online_only and (t.payment_channel or '').lower() != 'online':
        return False
    return True


def _candidates(t, d: date, rules: list[Rule], card: CardInfo, catalog: Catalog, top_slots) -> list[tuple[int, Rule]]:
    out = []
    for r in rules:
        if not r.in_effect(d) or not _conditions_pass(r, t):
            continue
        if r.rule_type == 'selected':
            level = max((_target_level(s.category, s.brand, t, catalog)
                         for s in card.selections if s.slot == r.slot and s.covers(d)), default=0)
            if level == 0:
                continue
        elif r.rule_type == 'top_n':
            level = _target_level(r.category, r.brand, t, catalog)
            if level == 0 or (r.slot or r.category) not in top_slots:
                continue
        elif r.is_base:
            level = 0
        else:
            level = _target_level(r.category, r.brand, t, catalog)
            if level == 0:
                continue
        out.append((level, r))
    out.sort(key=lambda lr: (-lr[0], -lr[1].rate))
    return out


def _dollars(t, issuer: str | None) -> float:
    # Amex rounds to the nearest whole dollar before the multiplier (see
    # compute_points_earn); floor(x + 0.5) avoids banker's rounding.
    return math.floor(abs(t.amount) + 0.5) if issuer == 'AMEX' else abs(t.amount)


class _CapState:
    def __init__(self):
        self.used: dict[tuple, float] = {}

    def room(self, rule: Rule, d: date, card: CardInfo) -> float:
        key = (rule.cap_key, period_key(rule.cap_period, d, card))
        return max(0.0, rule.cap - self.used.get(key, 0.0))

    def spend(self, rule: Rule, d: date, card: CardInfo, amount: float) -> None:
        key = (rule.cap_key, period_key(rule.cap_period, d, card))
        self.used[key] = self.used.get(key, 0.0) + amount


def purchase_points(t, d: date, rules, card: CardInfo, catalog: Catalog,
                    caps: _CapState | None, top_slots=frozenset()) -> tuple[float, float]:
    """(points, effective rate) for a purchase. caps=None scores without
    consuming any cap (used for a refund with no matching purchase)."""
    dollars = _dollars(t, card.issuer)
    if dollars == 0:
        return 0.0, next((r.rate for r in rules if r.is_base), 1.0)
    remaining, points = dollars, 0.0
    for _level, r in _candidates(t, d, rules, card, catalog, top_slots):
        if r.cap and caps is not None:
            portion = min(remaining, caps.room(r, d, card))
            if portion > 0:
                points += portion * r.rate
                caps.spend(r, d, card, portion)
                remaining -= portion
            if remaining <= 0:
                break
            if r.rate_after_cap is not None:
                points += remaining * r.rate_after_cap
                remaining = 0
                break
            continue
        points += remaining * r.rate
        remaining = 0
        break
    if remaining > 0:   # no base rule found — should not happen with seeded products
        points += remaining * 1.0
    return points, points / dollars


def top_slots_by_cycle(rows, rules: list[Rule], card: CardInfo, catalog: Catalog) -> dict:
    """{billing cycle: frozenset of winning slots} for top-N rules, ranked by
    each slot's purchase spend in that cycle (whole cycle, so order doesn't
    matter)."""
    top_rules = [r for r in rules if r.rule_type == 'top_n']
    if not top_rules:
        return {}
    n = max(r.top_n or 1 for r in top_rules)
    spend: dict = {}
    for t in rows:
        if t.txn_kind != 'purchase' or t.is_excluded or not t.amount or t.amount >= 0:
            continue
        d = t.date.date() if hasattr(t.date, 'date') else t.date
        cycle = _billing_cycle_key(d, card.close_day)
        slots = {r.slot or r.category for r in top_rules
                 if r.in_effect(d) and _conditions_pass(r, t)
                 and _target_level(r.category, r.brand, t, catalog) > 0}
        for s in slots:
            spend.setdefault(cycle, {})
            spend[cycle][s] = spend[cycle].get(s, 0.0) + abs(t.amount)
    return {cycle: frozenset(s for s, _ in sorted(by_slot.items(), key=lambda kv: (-kv[1], kv[0]))[:n])
            for cycle, by_slot in spend.items()}


# ── Loading ───────────────────────────────────────────────────────────────────

def get_product_rules(db, product_id: int) -> list[Rule]:
    cache = db.info.setdefault('earn_rules_by_product', {})
    if product_id not in cache:
        from database import CardProductReward, EarnRule
        rows = db.query(EarnRule).filter_by(product_id=product_id).all()
        rules = [Rule(category=r.merchant_category.name if r.merchant_category else None,
                      brand=r.brand.name if r.brand else None, rate=r.rate,
                      rule_type=r.rule_type or 'fixed', top_n=r.top_n, slot=r.slot,
                      domestic_only=bool(r.domestic_only), online_only=bool(r.online_only),
                      foreign_only=bool(r.foreign_only), cap=r.cap_amount, cap_period=r.cap_period,
                      cap_group=r.cap_group, rate_after_cap=r.rate_after_cap,
                      effective_from=r.effective_from, effective_to=r.effective_to)
                 for r in rows]
        if not rules:
            # A product with no EARN_RULES entry (not held when the seed was
            # written) earns its catalog base rate until rules are added.
            base = db.query(CardProductReward).filter_by(product_id=product_id, is_base_rate=True).first()
            rules = [Rule(category=None, brand=None, rate=float(base.multiplier) if base else 1.0)]
        cache[product_id] = rules
    return cache[product_id]


def get_card_info(db, card_id: int) -> CardInfo:
    cache = db.info.setdefault('earn_card_info', {})
    if card_id not in cache:
        from database import Card, CardCategorySelection
        card = db.query(Card).filter_by(id=card_id).first()
        sels = db.query(CardCategorySelection).filter_by(card_id=card_id).all()
        issue = card.issue_date.date() if card and card.issue_date and hasattr(card.issue_date, 'date') else None
        cache[card_id] = CardInfo(
            issuer=card.issuer if card else None,
            close_day=card.statement_close_day if card else None,
            issue_date=issue,
            selections=[Selection(s.slot, s.merchant_category.name if s.merchant_category else None,
                                  s.brand.name if s.brand else None, s.period_start, s.period_end)
                        for s in sels],
        )
    return cache[card_id]


def _product_resolver(db, card_id: int):
    """In-memory version of points_engine._resolve_product_for_date for one card."""
    from database import Card, CardProductHistory
    hist = db.query(CardProductHistory).filter_by(card_id=card_id).all()
    card = db.query(Card).filter_by(id=card_id).first()
    current = card.product_id if card else None

    def resolve(d: date):
        best = None
        for h in hist:
            if h.effective_from <= d and (h.effective_to is None or h.effective_to > d):
                if best is None or h.effective_from > best.effective_from:
                    best = h
        return best.product_id if best else current
    return resolve


# ── Scoring and locking ───────────────────────────────────────────────────────

def _clear(t, product_id=None):
    t.points_earned = None
    t.points_earn_classification = None
    t.points_earn_rate = None
    t.points_product_id = product_id


def _refund_rate(db, t, d: date) -> float | None:
    """Rate stored on the purchase this refund reverses (rule 9): the most
    recent purchase on the same card within REFUND_LOOKBACK_DAYS, at the same
    merchant, at least as large as the refund. The purchase may predate the
    fresh start; its old-engine rate is what it earned. None if not found."""
    from database import Transaction

    def same_merchant(p):
        if t.merchant_name and p.merchant_name:
            return normalize(p.merchant_name) == normalize(t.merchant_name)
        if t.brand and p.brand:
            return p.brand == t.brand
        return normalize(p.description_raw) == normalize(t.description_raw)

    lo = datetime.combine(d - timedelta(days=REFUND_LOOKBACK_DAYS), datetime.min.time())
    # Session query: rows re-scored earlier in this pass come back with their
    # new in-memory rates (autoflush).
    pool = db.query(Transaction).filter(
        Transaction.card_id == t.card_id, Transaction.date >= lo,
        Transaction.date <= t.date, Transaction.amount < 0,
    ).all()
    matches = [p for p in pool
               if p is not t and abs(p.amount) >= abs(t.amount) - 0.005
               and p.points_earn_rate is not None and not p.is_excluded and same_merchant(p)]
    if not matches:
        return None
    return max(matches, key=lambda p: (p.date, p.id or 0)).points_earn_rate


def forget_earning_cache(db) -> None:
    """Call after changing rules, selections or card fields in this session."""
    from core.merchant_classifier import forget_cached_rules
    forget_cached_rules(db)
    db.info.pop('earn_rules_by_product', None)
    db.info.pop('earn_card_info', None)


def _score(db, t, rules, card: CardInfo, catalog: Catalog, caps, top_by_cycle, product_id):
    d = t.date.date() if hasattr(t.date, 'date') else t.date
    t.points_product_id = product_id
    if t.points_earn_override is not None:
        t.points_earned, t.points_earn_classification, t.points_earn_rate = t.points_earn_override, 'manual_override', None
        return
    if t.is_excluded or t.txn_kind not in EARNING_KINDS or not t.amount:
        t.points_earned, t.points_earn_classification, t.points_earn_rate = 0.0, 'excluded', None
        return
    if t.txn_kind == 'refund':
        rate = _refund_rate(db, t, d)
        if rate is None:
            _pts, rate = purchase_points(t, d, rules, card, catalog, None,
                                         top_by_cycle.get(_billing_cycle_key(d, card.close_day), frozenset()))
        t.points_earned = -(_dollars(t, card.issuer) * rate)
        t.points_earn_classification, t.points_earn_rate = 'clawback', rate
        return
    pts, rate = purchase_points(t, d, rules, card, catalog, caps,
                                top_by_cycle.get(_billing_cycle_key(d, card.close_day), frozenset()))
    t.points_earned, t.points_earn_classification, t.points_earn_rate = pts, 'earn', rate


def _ensure_classified(db, t, index=None, catalog=None):
    if t.classification_source in (None, 'none'):
        classify_transaction(t, index or get_rule_index(db), catalog or get_catalog(db))
    # Mirror a display label into the old column so existing pages that
    # group by points_category show 2027 rows sensibly.
    t.points_category = t.brand or t.merchant_category


def recompute_card(db, card_id: int, extra=None) -> int:
    """Re-score every 2027 row on one card in date order. Returns rows scored."""
    from database import Transaction
    rows = db.query(Transaction).filter(
        Transaction.card_id == card_id, Transaction.date >= POINTS_FRESH_START_DT,
    ).order_by(Transaction.date, Transaction.id).all()
    if extra is not None and extra not in rows:
        rows.append(extra)
        rows.sort(key=lambda r: (r.date, r.id or 0))
    catalog = get_catalog(db)
    card = get_card_info(db, card_id)
    resolve = _product_resolver(db, card_id)
    now = datetime.utcnow()
    for t in rows:
        _ensure_classified(db, t, catalog=catalog)
    by_product: dict = {}
    for t in rows:
        by_product.setdefault(resolve(t.date.date()), []).append(t)
    for product_id, prows in by_product.items():
        if not product_id:
            for t in prows:
                _clear(t)
                t.points_locked_at = now
            continue
        rules = get_product_rules(db, product_id)
        top = top_slots_by_cycle(prows, rules, card, catalog)
        caps = _CapState()
        for t in prows:
            _score(db, t, rules, card, catalog, caps, top, product_id)
            t.points_locked_at = now
    return len(rows)


def rescore_cards(db, card_ids, reclassify: bool = True) -> int:
    """Re-score every 2027 row on these cards; with reclassify, non-manual
    rows are classified again from the current rules first. Callers decide
    whether to commit (rule 13: preview before applying)."""
    from database import Transaction
    from sqlalchemy import or_
    card_ids = [c for c in card_ids if c]
    if reclassify and card_ids:
        for t in db.query(Transaction).filter(
            Transaction.card_id.in_(card_ids), Transaction.date >= POINTS_FRESH_START_DT,
            or_(Transaction.classification_source.is_(None), Transaction.classification_source != 'manual'),
        ).all():
            t.classification_source = None
    return sum(recompute_card(db, cid) for cid in card_ids)


def lock_points_2027(db, t) -> None:
    """_lock_points_for_transaction() for rows dated on or after the fresh start."""
    from core.points_engine import _resolve_product_for_date
    t.points_locked_at = datetime.utcnow()
    _ensure_classified(db, t)
    if not t.card_id:
        _clear(t)
        return
    product_id = _resolve_product_for_date(db, t.card_id, t.date)
    if not product_id:
        _clear(t)
        return
    rules = get_product_rules(db, product_id)
    if is_stateful(rules):
        recompute_card(db, t.card_id, extra=t)
        return
    _score(db, t, rules, get_card_info(db, t.card_id), get_catalog(db), _CapState(), {}, product_id)
