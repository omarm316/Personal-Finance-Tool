"""
routers/misc.py — ungrouped small endpoints: dashboard stats, categories,
CSV export, health check, and legacy frontend-serving aliases.

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
import io
import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, Account, Category, PlannedPurchase, Transaction, TransactionSplit
from core.constants import TRANSACTION_TYPES, BUDGET_TYPES, BALANCE_TYPES
from core.app_helpers import PROJECT_ROOT, _frontend_index

router = APIRouter()


class CategoryResponse(BaseModel):
    id: int
    name: str
    category_type: str

    class Config:
        from_attributes = True

class StatsResponse(BaseModel):
    total_transactions: int
    needs_review: int
    total_income: float
    total_expenses: float
    by_category: dict

class PlannedPurchaseCreate(BaseModel):
    name: str
    amount: float
    expected_date: str  # ISO format
    vendor_tag: Optional[str] = None

@router.get("/api/categories", response_model=List[CategoryResponse])
async def get_categories(db: Session = Depends(get_db)):
    return db.query(Category).filter_by(is_active=True).order_by(Category.display_order).all()

@router.get("/api/transaction-types")
async def get_transaction_types():
    """Return the canonical transaction types and which ones affect budgets/balances."""
    return {
        'types': TRANSACTION_TYPES,
        'budget_types': sorted(BUDGET_TYPES),
        'balance_types': sorted(BALANCE_TYPES),
    }

@router.get("/api/stats", response_model=StatsResponse)
async def get_stats(
    year: Optional[int] = None,
    month: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction).filter(
        Transaction.is_excluded != True,  # noqa: E712
        Transaction.is_gcb != True,       # noqa: E712
        Transaction.gcb_tagged != True,   # noqa: E712
        Transaction.is_for_others != True,  # noqa: E712
    )
    if year:
        query = query.filter(Transaction.year == year)
    if month:
        query = query.filter(Transaction.month == month)
    if start_date:
        query = query.filter(Transaction.date >= datetime.strptime(start_date, "%Y-%m-%d"))
    if end_date:
        # Inclusive of entire day
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999)
        query = query.filter(Transaction.date <= end_dt)

    transactions = query.all()

    # Batch-load splits for all split transactions in one query
    split_txn_ids = [t.id for t in transactions if t.is_split]
    splits_map: dict = {}
    if split_txn_ids:
        all_splits = db.query(TransactionSplit).filter(
            TransactionSplit.parent_transaction_id.in_(split_txn_ids)
        ).all()
        for s in all_splits:
            splits_map.setdefault(s.parent_transaction_id, []).append(s)

    # Compute totals & by-category, handling split transactions correctly.
    # For split parents (is_split=True): skip the parent's own amount and instead
    # accumulate from the individual TransactionSplit line items (each with their own category).
    # Income-action transactions in expense-type categories (e.g. a "Dining" refund
    # coded as Income) are treated as expense offsets so totals match /budget/actuals.
    total_income = 0.0
    total_expenses = 0.0
    by_category: dict = {}

    # Expense-type categories: used to detect refunds that should offset expenses
    _expense_cats = set(
        c.name for c in db.query(Category).filter(
            Category.category_type.in_(['expense', 'both'])
        ).all()
    )

    for t in transactions:
        if t.action not in BUDGET_TYPES:
            continue
        if t.is_split:
            for s in splits_map.get(t.id, []):
                if s.is_gcb or s.is_for_others:
                    continue
                cat = s.category or t.category_final or 'Other'
                if t.action == 'Expense':
                    contrib = -s.amount
                    total_expenses += contrib
                    by_category[cat] = by_category.get(cat, 0) + contrib
                elif t.action == 'Income' and cat in _expense_cats:
                    # Refund in expense category → offset expenses
                    contrib = -s.amount
                    total_expenses += contrib
                    by_category[cat] = by_category.get(cat, 0) + contrib
                elif t.action == 'Income':
                    total_income += s.amount
        else:
            if t.is_gcb or t.gcb_tagged or t.is_for_others:
                continue
            cat = t.category_final or 'Other'
            if t.action == 'Expense':
                contrib = -t.amount
                total_expenses += contrib
                by_category[cat] = by_category.get(cat, 0) + contrib
            elif t.action == 'Income' and cat in _expense_cats:
                # Refund in expense category → offset expenses
                contrib = -t.amount
                total_expenses += contrib
                by_category[cat] = by_category.get(cat, 0) + contrib
            elif t.action == 'Income':
                total_income += t.amount

    return {
        "total_transactions": len(transactions),
        "needs_review":       sum(1 for t in transactions if t.needs_review),
        "total_income":       total_income,
        "total_expenses":     total_expenses,
        "by_category":        by_category,
    }

@router.get("/api/stats/detail")
async def get_stats_detail(
    category: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Return individual transactions (and split line items) that contribute to a
    given category's total in /api/stats — useful for debugging overstatement.
    """
    query = db.query(Transaction).filter(
        Transaction.is_excluded != True,  # noqa: E712
        Transaction.is_gcb != True,       # noqa: E712
        Transaction.gcb_tagged != True,   # noqa: E712
        Transaction.is_for_others != True,  # noqa: E712
        Transaction.action.in_(BUDGET_TYPES),
    )
    if year:
        query = query.filter(Transaction.year == year)
    if month:
        query = query.filter(Transaction.month == month)
    if start_date:
        query = query.filter(Transaction.date >= datetime.strptime(start_date, "%Y-%m-%d"))
    if end_date:
        # Inclusive of entire day
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999)
        query = query.filter(Transaction.date <= end_dt)

    transactions = query.all()
    split_txn_ids = [t.id for t in transactions if t.is_split]
    splits_map: dict = {}
    if split_txn_ids:
        all_splits = db.query(TransactionSplit).filter(
            TransactionSplit.parent_transaction_id.in_(split_txn_ids)
        ).all()
        for s in all_splits:
            splits_map.setdefault(s.parent_transaction_id, []).append(s)

    rows = []
    total = 0.0
    for t in transactions:
        if t.is_gcb or t.gcb_tagged or t.is_for_others:
            continue
        if t.is_split:
            for s in splits_map.get(t.id, []):
                if s.is_gcb or s.is_for_others:
                    continue
                cat = s.category or t.category_final or 'Other'
                if cat != category:
                    continue
                contrib = -s.amount if t.action == 'Expense' else s.amount
                total += contrib
                rows.append({
                    "id": t.id, "date": str(t.date)[:10],
                    "description": t.description_clean or t.description_raw,
                    "action": t.action, "is_split": True,
                    "split_description": s.description,
                    "split_category": cat,
                    "split_amount": s.amount, "contrib": round(contrib, 2),
                })
        else:
            cat = t.category_final or 'Other'
            if cat != category:
                continue
            contrib = -t.amount if t.action == 'Expense' else t.amount
            total += contrib
            rows.append({
                "id": t.id, "date": str(t.date)[:10],
                "description": t.description_clean or t.description_raw,
                "action": t.action, "is_split": False,
                "amount": t.amount, "contrib": round(contrib, 2),
            })

    rows.sort(key=lambda r: r["date"], reverse=True)
    return {"category": category, "total": round(total, 2), "count": len(rows), "rows": rows}

@router.get("/api/export/csv")
async def export_csv(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    import pandas as pd
    query = db.query(Transaction).join(Account)
    if start_date:
        query = query.filter(Transaction.date >= datetime.fromisoformat(start_date))
    if end_date:
        # Inclusive of entire day
        end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59, microsecond=999999)
        query = query.filter(Transaction.date <= end_dt)

    data = [
        {
            'Date': t.date.strftime('%Y-%m-%d'), 'Description': t.description_raw,
            'Amount': t.amount, 'Action': t.action, 'Category': t.category_final,
            'Account': t.account.account_name, 'GCB': t.gcb_tagged,
            'For Others': t.is_for_others,
            'Year': t.year, 'Month': t.month,
        }
        for t in query.order_by(Transaction.date).all()
    ]

    output = io.StringIO()
    import pandas as pd
    pd.DataFrame(data).to_csv(output, index=False)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transactions.csv"},
    )

@router.get("/mockup", response_class=HTMLResponse)
async def serve_mockup():
    """Serve the Premium Glassy Blue mockup."""
    path = os.path.join(PROJECT_ROOT, "mockup.html")
    with open(path, "r") as f:
        return f.read()

@router.get("/v2")
async def serve_v2():
    """
    Legacy alias for the app. Kept because it is bookmarked and appears in
    older notes; serves the exact same entry point as "/".
    """
    return FileResponse(_frontend_index(), media_type="text/html")

@router.get("/api/planned-purchases")
async def get_planned_purchases(db: Session = Depends(get_db)):
    """List all pending planned purchases."""
    purchases = db.query(PlannedPurchase).filter_by(status='pending').order_by(PlannedPurchase.expected_date).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "amount": p.amount,
            "expected_date": p.expected_date.isoformat(),
            "vendor_tag": p.vendor_tag,
            "status": p.status
        }
        for p in purchases
    ]

@router.post("/api/planned-purchases")
async def create_planned_purchase(data: PlannedPurchaseCreate, db: Session = Depends(get_db)):
    """Create a new planned purchase."""
    from datetime import date
    p = PlannedPurchase(
        name=data.name,
        amount=data.amount,
        expected_date=date.fromisoformat(data.expected_date),
        vendor_tag=data.vendor_tag,
        status='pending'
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "status": "created"}

@router.delete("/api/planned-purchases/{purchase_id}")
async def delete_planned_purchase(purchase_id: int, db: Session = Depends(get_db)):
    """Delete (cancel) a planned purchase."""
    p = db.query(PlannedPurchase).filter_by(id=purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    db.delete(p)
    db.commit()
    return {"status": "deleted"}

@router.get("/health")
async def health_check():
    return {"status": "healthy", "version": "1.0.0"}
