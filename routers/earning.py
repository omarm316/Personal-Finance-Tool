"""
routers/earning.py — the 2027 earning engine's API (docs/cards-categorization-rules.md):
merchant categories, brands, the one merchant rule list, card category
selections, the unknown-merchant review list and the before-and-after
recalculation.

Nothing here touches transactions dated before POINTS_FRESH_START.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.earn_engine import (
    POINTS_FRESH_START, POINTS_FRESH_START_DT, forget_earning_cache, rescore_cards,
)
from core.merchant_classifier import EARNING_KINDS, NON_EARNING_KINDS, RuleEntry, RuleIndex, normalize
from database import (
    get_db, Brand, Card, CardCategorySelection, CardProduct, EarnRule, MerchantCategory,
    MerchantRule, Transaction,
)

router = APIRouter()


def _category_id(db, name: Optional[str]) -> Optional[int]:
    if not name:
        return None
    c = db.query(MerchantCategory).filter_by(name=name).first()
    if not c:
        raise HTTPException(status_code=400, detail=f"Unknown merchant category '{name}'")
    return c.id


def _brand_id(db, name: Optional[str]) -> Optional[int]:
    if not name:
        return None
    b = db.query(Brand).filter_by(name=name).first()
    if not b:
        raise HTTPException(status_code=400, detail=f"Unknown brand '{name}' — add it with POST /api/brands")
    return b.id


# ── Categories and brands ─────────────────────────────────────────────────────

@router.get("/api/merchant-categories")
async def list_merchant_categories(db: Session = Depends(get_db)):
    cats = db.query(MerchantCategory).order_by(MerchantCategory.display_order).all()
    by_id = {c.id: c.name for c in cats}
    return [{'name': c.name, 'parent': by_id.get(c.parent_id)} for c in cats]


@router.get("/api/brands")
async def list_brands(db: Session = Depends(get_db)):
    by_id = {c.id: c.name for c in db.query(MerchantCategory).all()}
    return [{'id': b.id, 'name': b.name, 'merchant_category': by_id.get(b.default_category_id)}
            for b in db.query(Brand).order_by(Brand.name).all()]


class BrandCreate(BaseModel):
    name: str
    merchant_category: str


@router.post("/api/brands")
async def create_brand(body: BrandCreate, db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if db.query(Brand).filter_by(name=name).first():
        raise HTTPException(status_code=409, detail=f"Brand '{name}' already exists")
    db.add(Brand(name=name, default_category_id=_category_id(db, body.merchant_category)))
    db.commit()
    return {'name': name, 'merchant_category': body.merchant_category}


# ── Merchant rules (rule 15) ──────────────────────────────────────────────────

def _rule_out(r: MerchantRule) -> dict:
    return {
        'id': r.id, 'pattern': r.pattern, 'match_type': r.match_type,
        'merchant_category': r.merchant_category.name if r.merchant_category else None,
        'brand': r.brand.name if r.brand else None, 'txn_kind': r.txn_kind,
        'source': r.source, 'is_active': bool(r.is_active), 'notes': r.notes,
    }


@router.get("/api/merchant-rules")
async def list_merchant_rules(q: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(MerchantRule)
    if q:
        query = query.filter(MerchantRule.pattern.ilike(f'%{q}%'))
    return [_rule_out(r) for r in query.order_by(MerchantRule.pattern).all()]


class MerchantRuleBody(BaseModel):
    pattern: Optional[str] = None
    match_type: Optional[str] = None        # 'word' (default) | 'contains'
    merchant_category: Optional[str] = None
    brand: Optional[str] = None
    txn_kind: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


def _apply_rule_body(db, r: MerchantRule, body: MerchantRuleBody) -> None:
    if body.pattern is not None:
        if not body.pattern.strip():
            raise HTTPException(status_code=400, detail="pattern can't be empty")
        r.pattern = body.pattern.strip()
    if body.match_type is not None:
        if body.match_type not in ('word', 'contains'):
            raise HTTPException(status_code=400, detail="match_type is 'word' or 'contains'")
        r.match_type = body.match_type
    if body.merchant_category is not None:
        r.merchant_category_id = _category_id(db, body.merchant_category)
    if body.brand is not None:
        r.brand_id = _brand_id(db, body.brand)
    if body.txn_kind is not None:
        if body.txn_kind and body.txn_kind not in EARNING_KINDS | NON_EARNING_KINDS:
            raise HTTPException(status_code=400, detail=f"Unknown transaction kind '{body.txn_kind}'")
        r.txn_kind = body.txn_kind or None
    if body.is_active is not None:
        r.is_active = body.is_active
    if body.notes is not None:
        r.notes = body.notes or None
    if not (r.merchant_category_id or r.brand_id or r.txn_kind):
        raise HTTPException(status_code=400, detail="A rule must set a merchant category, a brand or a kind")


@router.post("/api/merchant-rules")
async def create_merchant_rule(body: MerchantRuleBody, db: Session = Depends(get_db)):
    """Add a rule. Existing 2027 rows change only through
    POST /api/earning/recalculate (rule 13)."""
    if not body.pattern:
        raise HTTPException(status_code=400, detail="pattern is required")
    r = MerchantRule(match_type='word', source='taught', is_active=True)
    _apply_rule_body(db, r, body)
    db.add(r)
    db.commit()
    return _rule_out(r)


@router.post("/api/merchant-rules/preview")
async def preview_merchant_rule(body: MerchantRuleBody, db: Session = Depends(get_db)):
    """What a draft rule would do, writing nothing (the Card page's rule tick
    box): how many 2027 charges on any card it matches, how many of those
    would change, and the change in points. Rows fixed by hand are left out,
    since rules don't reclassify them."""
    if not (body.pattern or '').strip():
        raise HTTPException(status_code=400, detail="pattern is required")
    r = MerchantRule(match_type='word', source='taught', is_active=True)
    target = bool(body.merchant_category or body.brand or body.txn_kind)
    if target:
        _apply_rule_body(db, r, body)
    else:   # no category or type picked yet: count the matches only
        r.pattern = body.pattern.strip()
        r.match_type = body.match_type if body.match_type in ('word', 'contains') else 'word'
    entry = RuleEntry(None, normalize(r.pattern), r.match_type or 'word',
                      body.merchant_category or None, body.brand or None, r.txn_kind or ('purchase' if not target else None))
    idx = RuleIndex([entry])
    rows = db.query(Transaction).filter(
        Transaction.date >= POINTS_FRESH_START_DT, Transaction.card_id.isnot(None),
    ).all()
    hit = []
    for t in rows:
        if t.classification_source == 'manual':
            continue
        path, kind = idx.match(t.merchant_name, t.description_raw)
        if path or kind:
            hit.append(t)
    if not target:
        return {'matches': len(hit), 'match_ids': [t.id for t in hit], 'changed_ids': [], 'points_delta': 0}
    before = {t.id: tuple(getattr(t, f) for f in _SNAPSHOT_FIELDS) for t in hit}
    changed, delta = [], 0.0
    try:
        db.add(r)
        db.flush()
        forget_earning_cache(db)
        rescore_cards(db, sorted({t.card_id for t in hit}), reclassify=True)
        for t in hit:
            new = tuple(getattr(t, f) for f in _SNAPSHOT_FIELDS)
            if new != before[t.id]:
                changed.append(t.id)
                delta += (new[0] or 0) - (before[t.id][0] or 0)
    finally:
        db.rollback()
        forget_earning_cache(db)
    return {'matches': len(hit), 'match_ids': [t.id for t in hit], 'changed_ids': changed,
            'points_delta': round(delta, 2)}


@router.patch("/api/merchant-rules/{rule_id}")
async def update_merchant_rule(rule_id: int, body: MerchantRuleBody, db: Session = Depends(get_db)):
    r = db.query(MerchantRule).filter_by(id=rule_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rule not found")
    _apply_rule_body(db, r, body)
    db.commit()
    return _rule_out(r)


@router.delete("/api/merchant-rules/{rule_id}")
async def delete_merchant_rule(rule_id: int, db: Session = Depends(get_db)):
    r = db.query(MerchantRule).filter_by(id=rule_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(r)
    db.commit()
    return {'deleted': rule_id}


# ── Earn rules (read-only: they come from core/earn_rules_seed.py) ─────────────

@router.get("/api/earning/rules")
async def list_earn_rules(product_key: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(EarnRule, CardProduct).join(CardProduct, CardProduct.id == EarnRule.product_id)
    if product_key:
        query = query.filter(CardProduct.product_key == product_key)
    out: dict = {}
    for r, p in query.all():
        out.setdefault(p.product_key, {'card_name': p.card_name, 'checked': r.notes, 'rules': []})
        out[p.product_key]['rules'].append({
            'merchant_category': r.merchant_category.name if r.merchant_category else None,
            'brand': r.brand.name if r.brand else None, 'rate': r.rate, 'rule_type': r.rule_type,
            'top_n': r.top_n, 'slot': r.slot, 'domestic_only': r.domestic_only,
            'online_only': r.online_only, 'foreign_only': r.foreign_only, 'cap_amount': r.cap_amount,
            'cap_period': r.cap_period, 'cap_group': r.cap_group, 'rate_after_cap': r.rate_after_cap,
        })
    return out


# ── Rotating and chosen categories ────────────────────────────────────────────

class SelectionCreate(BaseModel):
    slot: str
    merchant_category: Optional[str] = None
    brand: Optional[str] = None
    period_start: date
    period_end: Optional[date] = None
    notes: Optional[str] = None


def _selection_out(s: CardCategorySelection) -> dict:
    return {'id': s.id, 'slot': s.slot,
            'merchant_category': s.merchant_category.name if s.merchant_category else None,
            'brand': s.brand.name if s.brand else None,
            'period_start': s.period_start.isoformat(),
            'period_end': s.period_end.isoformat() if s.period_end else None, 'notes': s.notes}


@router.get("/api/cards/{card_id}/category-selections")
async def list_selections(card_id: int, db: Session = Depends(get_db)):
    rows = db.query(CardCategorySelection).filter_by(card_id=card_id).order_by(CardCategorySelection.period_start).all()
    return [_selection_out(s) for s in rows]


@router.post("/api/cards/{card_id}/category-selections")
async def create_selection(card_id: int, body: SelectionCreate, db: Session = Depends(get_db)):
    """Record a quarter's rotating category or a chosen category. Affected
    2027 rows change only through POST /api/earning/recalculate."""
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if not (body.merchant_category or body.brand):
        raise HTTPException(status_code=400, detail="A selection needs a merchant category or a brand")
    slots = {r.slot for r in db.query(EarnRule).filter_by(product_id=card.product_id, rule_type='selected').all()}
    if body.slot not in slots:
        raise HTTPException(status_code=400, detail=f"This card's product has no selected-category slot "
                                                    f"'{body.slot}' (has: {sorted(s for s in slots if s)})")
    s = CardCategorySelection(card_id=card_id, slot=body.slot, period_start=body.period_start,
                              period_end=body.period_end, notes=body.notes,
                              merchant_category_id=_category_id(db, body.merchant_category),
                              brand_id=_brand_id(db, body.brand))
    db.add(s)
    db.commit()
    return _selection_out(s)


@router.delete("/api/category-selections/{selection_id}")
async def delete_selection(selection_id: int, db: Session = Depends(get_db)):
    s = db.query(CardCategorySelection).filter_by(id=selection_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Selection not found")
    db.delete(s)
    db.commit()
    return {'deleted': selection_id}


# ── Review list (rule 14) and recalculation (rule 13) ─────────────────────────

@router.get("/api/earning/review")
async def unknown_merchant_review(limit: int = 200, db: Session = Depends(get_db)):
    """2027 purchases and refunds with no merchant category: they earn the
    base rate until a rule or a manual edit gives them a path."""
    q = db.query(Transaction).filter(
        Transaction.date >= POINTS_FRESH_START_DT,
        Transaction.card_id.isnot(None),
        Transaction.txn_kind.in_(EARNING_KINDS),
        Transaction.merchant_category.is_(None),
        Transaction.is_excluded != True,  # noqa: E712
    )
    total = q.count()
    rows = q.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).all()
    return {
        'total': total,
        'rows': [{'id': t.id, 'date': t.date.date().isoformat(), 'amount': t.amount,
                  'merchant_name': t.merchant_name, 'description_raw': t.description_raw,
                  'card_id': t.card_id, 'txn_kind': t.txn_kind, 'pfc_detailed': t.pfc_detailed,
                  'points_earned': t.points_earned, 'points_earn_rate': t.points_earn_rate}
                 for t in rows],
    }


class RecalcRequest(BaseModel):
    card_id: Optional[int] = None    # None = every card
    reclassify: bool = True          # classify non-manual rows again from current rules
    apply: bool = False              # False = preview only, nothing is written


_SNAPSHOT_FIELDS = ('points_earned', 'points_earn_rate', 'merchant_category', 'brand', 'txn_kind')


@router.post("/api/earning/recalculate")
async def recalculate_2027(body: RecalcRequest, db: Session = Depends(get_db)):
    """Before-and-after for re-scoring 2027 rows after a rule, selection or
    card change (rule 13). Run with apply=false first; apply=true writes the
    same result."""
    q = db.query(Transaction).filter(
        Transaction.date >= POINTS_FRESH_START_DT, Transaction.card_id.isnot(None),
    )
    if body.card_id:
        q = q.filter(Transaction.card_id == body.card_id)
    rows = q.all()
    before = {t.id: tuple(getattr(t, f) for f in _SNAPSHOT_FIELDS) for t in rows}

    forget_earning_cache(db)
    rescore_cards(db, sorted({t.card_id for t in rows}), reclassify=body.reclassify)

    changes = []
    points_before = points_after = 0.0
    for t in rows:
        old, new = before[t.id], tuple(getattr(t, f) for f in _SNAPSHOT_FIELDS)
        points_before += old[0] or 0
        points_after += new[0] or 0
        if old != new:
            changes.append({
                'id': t.id, 'date': t.date.date().isoformat(), 'card_id': t.card_id,
                'amount': t.amount, 'merchant_name': t.merchant_name, 'description_raw': t.description_raw,
                'before': dict(zip(_SNAPSHOT_FIELDS, old)), 'after': dict(zip(_SNAPSHOT_FIELDS, new)),
            })
    if body.apply:
        db.commit()
    else:
        db.rollback()
    return {
        'applied': body.apply, 'fresh_start': POINTS_FRESH_START.isoformat(),
        'rows_checked': len(rows), 'rows_changed': len(changes),
        'points_before': round(points_before, 2), 'points_after': round(points_after, 2),
        'changes': changes[:500],
    }
