"""
routers/budgets.py — monthly budget targets (CRUD) and actual-spend
computation (actuals vs. targets, trailing-3-month suggestions).

Extracted from main.py (Phase 1 batch 2 of the backend token-usage refactor —
see PLAN.md "main.py -> domain routers split").
"""
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, BudgetTarget, Category, Transaction, TransactionSplit
from core.constants import BUDGET_TYPES

router = APIRouter()


class BudgetTargetCreate(BaseModel):
    """Request body for a single budget target (Section 4)."""
    year: int
    month: int  # 1-12
    category: str
    amount: float

class BudgetTargetBulk(BaseModel):
    """Request body for bulk budget target upsert (Section 4)."""
    targets: List[BudgetTargetCreate]

@router.get("/api/budget/targets")
async def get_budget_targets(year: int, db: Session = Depends(get_db)):
    """
    Get all budget targets for a given year.
    Returns a dict keyed by category, each containing month→amount mappings.
    """
    targets = db.query(BudgetTarget).filter_by(year=year).all()
    # Group by category → {month: {id, amount}}
    result = {}
    for t in targets:
        if t.category not in result:
            result[t.category] = {}
        result[t.category][str(t.month)] = {'id': t.id, 'amount': t.amount}
    return {'year': year, 'categories': result}

@router.post("/api/budget/targets")
async def upsert_budget_target(data: BudgetTargetCreate, db: Session = Depends(get_db)):
    """
    Create or update a single budget target.
    Upserts on (year, month, category) unique constraint.
    """
    if data.month < 1 or data.month > 12:
        raise HTTPException(status_code=400, detail="Month must be 1-12")

    existing = db.query(BudgetTarget).filter_by(
        year=data.year, month=data.month, category=data.category
    ).first()
    if existing:
        existing.amount = data.amount
        existing.updated_at = datetime.utcnow()
    else:
        db.add(BudgetTarget(
            year=data.year, month=data.month,
            category=data.category, amount=data.amount,
        ))
    db.commit()
    return {"message": "Budget target saved"}

@router.post("/api/budget/targets/bulk")
async def bulk_upsert_budget_targets(data: BudgetTargetBulk, db: Session = Depends(get_db)):
    """
    Bulk create/update budget targets.
    Each target is upserted on (year, month, category).
    """
    for t in data.targets:
        existing = db.query(BudgetTarget).filter_by(
            year=t.year, month=t.month, category=t.category
        ).first()
        if existing:
            existing.amount = t.amount
            existing.updated_at = datetime.utcnow()
        else:
            db.add(BudgetTarget(
                year=t.year, month=t.month,
                category=t.category, amount=t.amount,
            ))
    db.commit()
    return {"message": f"Saved {len(data.targets)} budget targets"}

@router.get("/api/budget/actuals")
async def get_budget_actuals(year: int, db: Session = Depends(get_db)):
    """
    Get actual spending per category per month for a given year.
    - Excludes GCB-tagged and For-Others-tagged transactions
    - Excludes transfers
    - For split transactions: uses split amounts/categories instead of parent
    Returns a dict keyed by category, each containing month→amount mappings.
    """
    from sqlalchemy import and_

    # Get only BUDGET_TYPES transactions (Expense, Income) for the year
    # Exclude is_excluded, GCB-tagged, For-Others-tagged, and Transfer transactions
    txns = db.query(Transaction).filter(
        Transaction.year == year,
        Transaction.action.in_(BUDGET_TYPES),
        Transaction.is_excluded != True,  # noqa: E712
        Transaction.is_gcb != True,       # noqa: E712
        Transaction.is_for_others != True,  # noqa: E712
    ).all()

    # Build actuals: {category: {month: net_amount}}
    # For expense categories the budget tracks NET spend: charges minus credits.
    # Expense action: contribution = -t.amount
    #   → charges (amount < 0): -(-X) = +X  (increases total)
    #   → CC credits/refunds (amount > 0): -(+X) = -X  (reduces total)
    # Income action with an expense category (e.g. refund tagged "Dining"):
    #   treated as a credit that offsets expenses → contribution = -t.amount
    # Pure Income action: contribution = +t.amount
    actuals = {}

    # Pre-load expense-type category names so we can detect income-action refunds
    # (e.g. a Dining refund coded as Income) that should offset that category's
    # expense actuals instead of counting as pure income.
    _expense_cats = set(
        c.name for c in db.query(Category).filter(
            Category.category_type.in_(['expense', 'both'])
        ).all()
    )

    for t in txns:
        if t.is_split:
            splits = db.query(TransactionSplit).filter_by(
                parent_transaction_id=t.id
            ).all()
            for s in splits:
                if s.is_gcb or s.is_for_others:
                    continue
                cat = s.category or t.category_final or 'Other'
                month = str(t.month)
                if t.action == 'Expense':
                    contrib = -s.amount
                elif t.action == 'Income' and cat in _expense_cats:
                    # Refund in an expense category — offsets that category's spend
                    contrib = -s.amount
                else:
                    contrib = s.amount
                if cat not in actuals:
                    actuals[cat] = {}
                actuals[cat][month] = round(actuals[cat].get(month, 0) + contrib, 2)
        else:
            if t.is_gcb or t.gcb_tagged or t.is_for_others:
                continue
            cat = t.category_final or 'Other'
            month = str(t.month)
            if t.action == 'Expense':
                contrib = -t.amount
            elif t.action == 'Income' and cat in _expense_cats:
                # Refund in an expense category — offsets that category's spend
                contrib = -t.amount
            else:
                contrib = t.amount
            if cat not in actuals:
                actuals[cat] = {}
            actuals[cat][month] = round(actuals[cat].get(month, 0) + contrib, 2)

    return {'year': year, 'categories': actuals}

@router.get("/api/budget/suggestions")
async def get_budget_suggestions(year: int, month: int, db: Session = Depends(get_db)):
    """
    Return trailing 3-month average actual spending per category.
    Used as hint text in edit mode.
    For month=1 (Jan), looks at Oct/Nov/Dec of prior year.
    Returns: {category: avg_amount}
    """
    # Build list of (year, month) for the 3 months before the requested month
    trailing = []
    y, m = year, month
    for _ in range(3):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
        trailing.append((y, m))

    # Fetch actuals for each of those months (net signed amounts, excluding
    # is_excluded + GCB + For Others)
    totals: dict[str, list] = {}
    for ty, tm in trailing:
        txns = db.query(Transaction).filter(
            Transaction.year == ty,
            Transaction.month == tm,
            Transaction.action.in_(BUDGET_TYPES),
            Transaction.is_excluded != True,  # noqa: E712
            Transaction.is_gcb != True,       # noqa: E712
            Transaction.is_for_others != True,  # noqa: E712
        ).all()
        month_totals: dict[str, float] = {}
        for t in txns:
            if t.is_split:
                splits = db.query(TransactionSplit).filter_by(
                    parent_transaction_id=t.id
                ).all()
                for s in splits:
                    if s.is_gcb or s.is_for_others:
                        continue
                    cat = s.category or t.category_final or 'Other'
                    contrib = (-s.amount) if t.action == 'Expense' else s.amount
                    month_totals[cat] = round(month_totals.get(cat, 0) + contrib, 2)
            else:
                if t.is_gcb or t.gcb_tagged or t.is_for_others:
                    continue
                cat = t.category_final or 'Other'
                contrib = (-t.amount) if t.action == 'Expense' else t.amount
                month_totals[cat] = round(month_totals.get(cat, 0) + contrib, 2)
        for cat, amt in month_totals.items():
            totals.setdefault(cat, []).append(amt)

    # Average across months that had data
    suggestions = {}
    for cat, amounts in totals.items():
        suggestions[cat] = round(sum(amounts) / 3, 0)  # avg over 3 months (0 for missing)

    return {'year': year, 'month': month, 'suggestions': suggestions}
