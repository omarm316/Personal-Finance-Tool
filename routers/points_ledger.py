"""
routers/points_ledger.py — the points ledger from the fresh start
(docs/cards-ledger-design.md): each program's ledger and Activity lines, balance
checks, opening balances, and marking a challenge bonus posted.

Writes are refused before the ledger's start date. The older balance math still
runs until then and would pick up a check or an opening balance dated now.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.points_ledger import (
    BONUS_REASON, CHECK_REASON, NO_OWNER, all_programs, ledger_start, posted_balance, program_accounts,
    program_ledger,
)
from database import Card, PointsAdjustment, PointsBalanceSnapshot, PointsEcosystem, SpendChallenge, get_db

router = APIRouter()


def _eco(db, eco_id):
    eco = db.query(PointsEcosystem).filter_by(id=eco_id).first()
    if not eco:
        raise HTTPException(status_code=404, detail='Program not found')
    return eco


def _require_started(d: date):
    start = ledger_start()
    if d < start:
        raise HTTPException(status_code=409, detail=f'The points ledger starts on {start.isoformat()}.')


def _person(p: Optional[str]) -> str:
    p = (p or '').strip()
    if not p or p == NO_OWNER:
        raise HTTPException(status_code=400, detail='Whose points is required')
    return p


@router.get('/api/points-ledger')
def ledger_overview(db: Session = Depends(get_db)):
    """Every program's balance, pending points, balance checks and opening balances still to set (Portfolio)."""
    return all_programs(db)


@router.get('/api/ecosystems/{eco_id}/ledger')
def ecosystem_ledger(eco_id: int, db: Session = Depends(get_db)):
    _eco(db, eco_id)
    return program_ledger(db, eco_id)


class BalanceCheckIn(BaseModel):
    person: str
    reported_balance: float
    check_date: Optional[date] = None
    notes: Optional[str] = None


@router.post('/api/ecosystems/{eco_id}/balance-checks')
def create_balance_check(eco_id: int, body: BalanceCheckIn, db: Session = Depends(get_db)):
    """Log what the program shows. The difference from the app's posted balance on that day becomes
    a "Balance adjustment"; a check that matches is saved with 0 points so its date is kept."""
    _eco(db, eco_id)
    person = _person(body.person)
    d = body.check_date or date.today()
    _require_started(d)
    if d > date.today():
        raise HTTPException(status_code=400, detail='A balance check can’t be dated in the future')
    app_has = posted_balance(db, eco_id, person, d)
    gap = round(body.reported_balance) - app_has
    db.add(PointsAdjustment(
        ecosystem_id=eco_id, person=person, points_delta=gap, adjustment_date=d,
        description='Balance check', notes=(body.notes or '').strip() or None,
        reason=CHECK_REASON, reported_balance=round(body.reported_balance),
    ))
    db.commit()
    out = program_ledger(db, eco_id)
    out['saved'] = dict(person=person, app_had=app_has, reported=round(body.reported_balance), gap=gap)
    return out


class OpeningIn(BaseModel):
    balance: float
    notes: Optional[str] = None


@router.put('/api/ecosystems/{eco_id}/opening-balances/{person}')
def set_opening_balance(eco_id: int, person: str, body: OpeningIn, db: Session = Depends(get_db)):
    """The posted balance the program showed on the start date, one per person per program."""
    _eco(db, eco_id)
    person = _person(person)
    start = ledger_start()
    _require_started(date.today())
    snap = (db.query(PointsBalanceSnapshot)
            .filter_by(ecosystem_id=eco_id, person=person, snapshot_date=start).first())
    if snap is None:
        snap = PointsBalanceSnapshot(ecosystem_id=eco_id, person=person, snapshot_date=start, balance=0)
        db.add(snap)
    snap.balance = round(body.balance)
    snap.notes = (body.notes or '').strip() or None
    db.commit()
    return program_ledger(db, eco_id)


def _challenge_program(db, ch):
    for acct_id, (eco, card, _pk) in program_accounts(db).items():
        if card.id == ch.card_id:
            return eco, card
    return None, db.query(Card).filter_by(id=ch.card_id).first()


class BonusPostedIn(BaseModel):
    posted_date: Optional[date] = None
    points: Optional[float] = None


@router.post('/api/challenges/{challenge_id}/bonus-posted')
def mark_bonus_posted(challenge_id: int, body: BonusPostedIn = None, db: Session = Depends(get_db)):
    """Mark a met challenge's points bonus as posted: one Sign-up bonus adjustment linked to it."""
    body = body or BonusPostedIn()
    ch = db.query(SpendChallenge).filter_by(id=challenge_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail='Challenge not found')
    if ch.bonus_type != 'flat' or not ch.bonus_amount:
        raise HTTPException(status_code=400, detail='Only a challenge with a points bonus can be marked posted')
    if not ch.bonus_unlocked:
        raise HTTPException(status_code=400, detail='This challenge hasn’t been met yet')
    eco, card = _challenge_program(db, ch)
    if not eco:
        raise HTTPException(status_code=400, detail='This challenge’s card isn’t linked to a points program')
    d = body.posted_date or date.today()
    _require_started(d)
    existing = db.query(PointsAdjustment).filter_by(challenge_id=challenge_id).first()
    if existing:
        raise HTTPException(status_code=409, detail='This bonus is already marked posted')
    person = (ch.spender_filter or '').strip() or (card.primary_user if card else None) or None
    db.add(PointsAdjustment(
        ecosystem_id=eco, person=person, points_delta=round(body.points if body.points is not None else ch.bonus_amount),
        adjustment_date=d, description=ch.name, reason=BONUS_REASON, challenge_id=challenge_id,
    ))
    db.commit()
    return program_ledger(db, eco)


@router.delete('/api/challenges/{challenge_id}/bonus-posted')
def undo_bonus_posted(challenge_id: int, db: Session = Depends(get_db)):
    """Undo: the bonus goes back to waiting."""
    rows = db.query(PointsAdjustment).filter_by(challenge_id=challenge_id).all()
    if not rows:
        raise HTTPException(status_code=404, detail='This bonus isn’t marked posted')
    eco = rows[0].ecosystem_id
    for r in rows:
        db.delete(r)
    db.commit()
    return program_ledger(db, eco)
