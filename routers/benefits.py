"""Card benefits routes (docs/cards-card-design.md, "Benefits", "Expiring
credits" and "Log credit use"). The counting rules live in core/benefits.py."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core import benefits as BEN
from database import BenefitUsage, Card, CardBenefit, CardProduct, Transaction, get_db

router = APIRouter()


def _card(db: Session, card_id: int) -> Card:
    c = db.query(Card).filter_by(id=card_id).first()
    if not c:
        raise HTTPException(status_code=404, detail='Card not found')
    return c


def _date(v: Optional[str], field: str) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f'{field} must be YYYY-MM-DD')


@router.get('/api/cards/{card_id}/benefits')
def card_benefits(card_id: int, for_date: Optional[str] = None, db: Session = Depends(get_db)):
    """This card's credits with every period of the benefit year, their uses,
    the year's totals and what expires in the next 60 days. `for_date` adds
    what's left in the period a purchase on that day falls in (Log credit use)."""
    c = _card(db, card_id)
    return BEN.for_card(db, c, for_date=_date(for_date, 'for_date'))


@router.get('/api/benefits/expiring')
def benefits_expiring(within: int = BEN.EXPIRING_DAYS, db: Session = Depends(get_db)):
    """Open credits on every active card that reset within `within` days, for
    the Actions strip (docs/cards-actions-design.md)."""
    return {'within': within, 'items': BEN.expiring_all(db, within=within)}


class BenefitIn(BaseModel):
    benefit_name: Optional[str] = None
    amount: Optional[float] = None
    cadence: Optional[str] = None
    year_type: Optional[str] = None
    every_years: Optional[float] = None
    match_text: Optional[str] = None
    remind: Optional[bool] = None
    notes: Optional[str] = None


_LEGACY_FREQ = {'semiannual': 'semi-annual', 'multi_year': 'every_4_years'}


def _apply(b: CardBenefit, body: BenefitIn, fields: set[str]):
    if 'benefit_name' in fields:
        name = (body.benefit_name or '').strip()
        if not name:
            raise HTTPException(status_code=400, detail='A benefit needs a name')
        b.benefit_name = name
    if 'amount' in fields:
        if body.amount is None or body.amount < 0:
            raise HTTPException(status_code=400, detail='The amount must be 0 or more')
        b.amount = round(body.amount, 2)
    if 'cadence' in fields:
        if body.cadence not in BEN.CADENCES:
            raise HTTPException(status_code=400, detail=f'Resets must be one of {", ".join(BEN.CADENCES)}')
        b.cadence = body.cadence
        b.reset_frequency = _LEGACY_FREQ.get(body.cadence, body.cadence)
        b.tracking_type = 'by_use' if body.cadence in ('multi_year', 'per_use') else 'periodic'
    if 'year_type' in fields:
        if body.year_type not in BEN.YEAR_TYPES:
            raise HTTPException(status_code=400, detail='The year runs by calendar or card')
        b.year_type = body.year_type
    if 'every_years' in fields:
        b.every_years = body.every_years
    if 'match_text' in fields:
        b.match_text = (body.match_text or '').strip()
    if 'remind' in fields:
        b.remind = bool(body.remind)
    if 'notes' in fields:
        b.notes = (body.notes or '').strip() or None
    if b.cadence == 'multi_year' and not (b.every_years and b.every_years > 0):
        b.every_years = 4.0


@router.post('/api/card-products/{product_id}/benefits')
def create_benefit(product_id: int, body: BenefitIn, db: Session = Depends(get_db)):
    if not db.query(CardProduct).filter_by(id=product_id).first():
        raise HTTPException(status_code=404, detail='Card product not found')
    b = CardBenefit(product_id=product_id, cadence='annual', year_type='calendar', match_text='', remind=True,
                    reset_frequency='annual', tracking_type='periodic', benefit_name='', amount=0)
    fields = body.model_fields_set | {'benefit_name', 'amount'}
    _apply(b, body, fields)
    db.add(b)
    db.commit()
    return {'id': b.id}


@router.patch('/api/benefits/{benefit_id}')
def update_benefit(benefit_id: int, body: BenefitIn, db: Session = Depends(get_db)):
    b = db.query(CardBenefit).filter_by(id=benefit_id).first()
    if not b:
        raise HTTPException(status_code=404, detail='Benefit not found')
    _apply(b, body, body.model_fields_set)
    db.commit()
    return {'id': b.id}


@router.delete('/api/benefits/{benefit_id}')
def delete_benefit(benefit_id: int, db: Session = Depends(get_db)):
    """Deletes the benefit for every card of this product, with its logged uses."""
    b = db.query(CardBenefit).filter_by(id=benefit_id).first()
    if not b:
        raise HTTPException(status_code=404, detail='Benefit not found')
    db.delete(b)
    db.commit()
    return {'deleted': True}


class UseIn(BaseModel):
    benefit_id: int
    amount: float
    date: Optional[str] = None
    transaction_id: Optional[int] = None
    notes: Optional[str] = None


def _benefit_for(db: Session, c: Card, benefit_id: int) -> CardBenefit:
    b = db.query(CardBenefit).filter_by(id=benefit_id).first()
    if not b or b.product_id != c.product_id:
        raise HTTPException(status_code=404, detail="That benefit isn't on this card")
    return b


def _add_use(db: Session, c: Card, b: CardBenefit, amount: float, d: date, txn_id=None, notes=None) -> BenefitUsage:
    p = BEN.period_of(b, BEN._as_date(c.issue_date), d)
    u = BenefitUsage(benefit_id=b.id, card_id=c.id, use_date=d, amount_used=round(amount, 2),
                     transaction_id=txn_id, notes=(notes or '').strip() or None, confirmed=True,
                     cycle=(p[0] if p else d).isoformat())
    db.add(u)
    db.commit()
    return u


@router.post('/api/cards/{card_id}/benefit-uses')
def add_use(card_id: int, body: UseIn, db: Session = Depends(get_db)):
    """Log a use: by hand (Add use in a period), or from a purchase (Log credit
    use), which records the purchase it paid for."""
    c = _card(db, card_id)
    b = _benefit_for(db, c, body.benefit_id)
    if body.amount is None or body.amount <= 0:
        raise HTTPException(status_code=400, detail='The amount must be more than 0')
    d = _date(body.date, 'date') or BEN.today_()
    if body.transaction_id:
        t = db.query(Transaction).filter_by(id=body.transaction_id).first()
        if not t or t.account_id != c.account_id:
            raise HTTPException(status_code=400, detail="That purchase isn't on this card")
        d = _date(body.date, 'date') or BEN._as_date(t.date)
    u = _add_use(db, c, b, body.amount, d, body.transaction_id, body.notes)
    return {'use_id': u.id, 'benefits': BEN.for_card(db, c)}


class MarkIn(BaseModel):
    date: Optional[str] = None


@router.post('/api/cards/{card_id}/benefits/{benefit_id}/mark-used')
def mark_used(card_id: int, benefit_id: int, body: MarkIn | None = None, db: Session = Depends(get_db)):
    """Logs the rest of the period holding `date` (default today) as used, by hand."""
    c = _card(db, card_id)
    b = _benefit_for(db, c, benefit_id)
    d = _date(body.date if body else None, 'date') or BEN.today_()
    pay = BEN.for_card(db, c, for_date=d)
    left = pay['at_date'][str(b.id)]['left']
    if left <= BEN.EPS:
        raise HTTPException(status_code=409, detail='Nothing is left in that period')
    u = _add_use(db, c, b, left, d, notes='Marked fully used')
    return {'use_id': u.id, 'amount': left, 'benefits': BEN.for_card(db, c)}


@router.delete('/api/benefit-usage/{usage_id}')
def delete_use(usage_id: int, db: Session = Depends(get_db)):
    """Removes one logged use (or a purchase link); statement credits aren't stored."""
    u = db.query(BenefitUsage).filter_by(id=usage_id).first()
    if not u:
        raise HTTPException(status_code=404, detail='Use not found')
    c = db.query(Card).filter_by(id=u.card_id).first()
    db.delete(u)
    db.commit()
    return {'deleted': True, 'benefits': BEN.for_card(db, c) if c else None}
