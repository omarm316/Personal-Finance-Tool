"""Reads for the rebuilt Cards pages (Cards step 5): the cards row and the
Actions strip on Portfolio and Ecosystem. The logic lives in core/card_actions.py."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core import card_actions as CA
from database import get_db

router = APIRouter()


@router.get('/api/cards/wallet')
def cards_wallet(db: Session = Depends(get_db)):
    """Open credit-card accounts with card art, owner and program."""
    return CA.wallet(db)


@router.get('/api/cards/actions')
def cards_actions(ecosystem_id: Optional[int] = None, db: Session = Depends(get_db)):
    """The Actions strip (docs/cards-actions-design.md): credits expiring in the
    next 60 days, challenges at risk, the Next credit, and every in-window
    challenge with its at-risk flag. `ecosystem_id` narrows it to one program."""
    return CA.actions(db, ecosystem_id=ecosystem_id)
