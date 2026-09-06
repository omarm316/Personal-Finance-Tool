"""
routers/loans.py — manual loan tracking: CRUD, P/I/Tax/Insurance payment-split
computation, and linking checking-account transactions to a loan as payments.

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, Account, Loan, Transaction, TransactionSplit
from core.accounts_helpers import get_account_balance
from core.serializers import serialize_loan, _compute_pmt_split
from core.points_engine import _lock_points_for_transaction

router = APIRouter()


class LoanCreate(BaseModel):
    """Request body for creating/updating a loan."""
    lender: str
    loan_type: str  # mortgage, auto, student, personal, other
    original_principal: float
    current_balance: Optional[float] = None
    balance_date: Optional[str] = None              # YYYY-MM-DD — when current_balance was recorded
    remaining_term_months: Optional[int] = None     # Remaining months as of balance_date
    interest_rate: Optional[float] = None           # Annual % (e.g. 6.5)
    term_months: Optional[int] = None               # Original total term
    monthly_payment: Optional[float] = None         # Total PITI payment
    property_tax_monthly: Optional[float] = None    # Escrow: property tax portion
    insurance_monthly: Optional[float] = None       # Escrow: insurance portion
    payment_account_id: Optional[int] = None        # Checking account that makes the payment
    payment_due_day: Optional[int] = None           # Day of month (1-31)
    start_date: Optional[str] = None                # YYYY-MM-DD
    maturity_date: Optional[str] = None             # YYYY-MM-DD
    account_id: Optional[int] = None                # Linked liability account
    notes: Optional[str] = None

@router.get("/api/loans")
async def list_loans(db: Session = Depends(get_db)):
    """List all active loans."""
    loans = db.query(Loan).filter_by(is_active=True).order_by(Loan.lender).all()
    return [serialize_loan(l) for l in loans]

@router.get("/api/loans/{loan_id}")
async def get_loan(loan_id: int, db: Session = Depends(get_db)):
    """Get a single loan with linked account balance info."""
    loan = db.query(Loan).filter_by(id=loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    result = serialize_loan(loan)
    # Include linked account balance if available
    if loan.account_id:
        result['account_balance'] = get_account_balance(db, loan.account_id)
        account = db.query(Account).filter_by(id=loan.account_id).first()
        result['account_name'] = account.account_name if account else None
    return result

@router.post("/api/loans")
async def create_loan(data: LoanCreate, db: Session = Depends(get_db)):
    """Create a new loan."""
    loan = Loan(
        lender=data.lender,
        loan_type=data.loan_type,
        original_principal=data.original_principal,
        current_balance=data.current_balance,
        balance_date=datetime.strptime(data.balance_date, "%Y-%m-%d") if data.balance_date else None,
        remaining_term_months=data.remaining_term_months,
        interest_rate=data.interest_rate,
        term_months=data.term_months,
        monthly_payment=data.monthly_payment,
        property_tax_monthly=data.property_tax_monthly,
        insurance_monthly=data.insurance_monthly,
        payment_account_id=data.payment_account_id,
        payment_due_day=data.payment_due_day,
        start_date=datetime.strptime(data.start_date, "%Y-%m-%d") if data.start_date else None,
        maturity_date=datetime.strptime(data.maturity_date, "%Y-%m-%d") if data.maturity_date else None,
        account_id=data.account_id,
        notes=data.notes,
        is_active=True,
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return {'id': loan.id, 'message': 'Loan created'}

@router.patch("/api/loans/{loan_id}")
async def update_loan(loan_id: int, updates: dict, db: Session = Depends(get_db)):
    """Update loan fields."""
    loan = db.query(Loan).filter_by(id=loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    _date_fields = ('start_date', 'maturity_date', 'balance_date')
    allowed = ['lender', 'loan_type', 'original_principal', 'current_balance',
               'balance_date', 'remaining_term_months',
               'interest_rate', 'term_months', 'monthly_payment',
               'property_tax_monthly', 'insurance_monthly',
               'payment_account_id', 'payment_due_day',
               'start_date', 'maturity_date', 'account_id', 'notes', 'is_active']
    _int_fields = ('payment_account_id', 'payment_due_day', 'remaining_term_months',
                   'term_months', 'account_id')
    _float_fields = ('original_principal', 'current_balance', 'interest_rate',
                      'monthly_payment', 'property_tax_monthly', 'insurance_monthly')
    for k, v in updates.items():
        if k in allowed:
            if k in _date_fields:
                setattr(loan, k, datetime.strptime(v, "%Y-%m-%d") if v else None)
            elif k in _int_fields:
                setattr(loan, k, int(v) if v not in (None, '', 'null') else None)
            elif k in _float_fields:
                setattr(loan, k, float(v) if v not in (None, '', 'null') else None)
            else:
                setattr(loan, k, v)
    loan.updated_at = datetime.utcnow()
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to save loan: {e}")
    return {'message': 'Loan updated'}

@router.delete("/api/loans/{loan_id}")
async def delete_loan(loan_id: int, db: Session = Depends(get_db)):
    """Deactivate a loan (soft delete)."""
    loan = db.query(Loan).filter_by(id=loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    loan.is_active = False
    loan.updated_at = datetime.utcnow()
    db.commit()
    return {'message': 'Loan deactivated'}

@router.get("/api/loans/{loan_id}/compute-split")
async def compute_loan_split(loan_id: int, db: Session = Depends(get_db)):
    """
    Compute the P/I/Tax/Insurance split for the next payment on this loan,
    based on current_balance, interest_rate, monthly_payment, property_tax_monthly,
    and insurance_monthly. Returns a preview the user can confirm before linking.
    """
    loan = db.query(Loan).filter_by(id=loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if not loan.monthly_payment:
        raise HTTPException(status_code=400, detail="monthly_payment not set on loan")
    split = _compute_pmt_split(
        loan.current_balance or 0,
        loan.interest_rate or 0,
        loan.monthly_payment,
        loan.property_tax_monthly or 0,
        loan.insurance_monthly or 0,
    )
    return {**split, 'current_balance': loan.current_balance,
            'balance_after': round((loan.current_balance or 0) - split['principal'], 2)}

@router.get("/api/loans/{loan_id}/linked-transactions")
async def get_linked_transactions(loan_id: int, db: Session = Depends(get_db)):
    """Return all transactions linked to this loan, with their split breakdown."""
    loan = db.query(Loan).filter_by(id=loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    txns = db.query(Transaction).filter_by(loan_id=loan_id).order_by(Transaction.date.desc()).all()
    result = []
    for t in txns:
        splits = db.query(TransactionSplit).filter_by(parent_transaction_id=t.id).all()
        result.append({
            'id': t.id,
            'date': str(t.date),
            'description': t.description_clean or t.description_raw,
            'amount': t.amount,
            'splits': [{'description': s.description, 'amount': s.amount, 'category': s.category} for s in splits],
        })
    return result

@router.get("/api/loans/{loan_id}/candidate-transactions")
async def get_loan_candidate_transactions(
    loan_id: int, limit: int = 6, db: Session = Depends(get_db)
):
    """
    Return recent transactions from the loan's payment_account that are
    close in amount to monthly_payment and not yet linked to any loan.
    These are candidates for the user to link as a loan payment.
    """
    loan = db.query(Loan).filter_by(id=loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if not loan.payment_account_id or not loan.monthly_payment:
        return []

    target = loan.monthly_payment
    tolerance = max(target * 0.15, 50.0)  # ±15% or $50, whichever is larger

    # Transactions from the payment account matching the payment amount
    # In Plaid sign convention stored: outflow = negative for liabilities... but checking
    # account outflows can be either sign depending on setup. We look for amount near ±target.
    txns = (
        db.query(Transaction)
        .filter(
            Transaction.account_id == loan.payment_account_id,
            Transaction.loan_id.is_(None),
            Transaction.amount.between(-(target + tolerance), -(target - tolerance)),
        )
        .order_by(Transaction.date.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            'id': t.id,
            'date': t.date.strftime('%Y-%m-%d'),
            'amount': t.amount,
            'description_raw': t.description_raw,
            'description_clean': t.description_clean,
            'action': t.action,
            'is_split': t.is_split,
        }
        for t in txns
    ]

@router.post("/api/loans/{loan_id}/link-transaction")
async def link_loan_transaction(
    loan_id: int, body: dict, db: Session = Depends(get_db)
):
    """
    Link an existing checking-account transaction to this loan as a payment.

    Steps:
    1. Compute P/I/Tax/Insurance split from current loan state
    2. Delete any existing splits on the transaction
    3. Create new TransactionSplit rows for each component
    4. Mark transaction is_split=True, loan_id=loan_id, action='Transfer'
    5. Subtract principal from loan.current_balance
    6. Decrement loan.remaining_term_months by 1
    7. Update loan.balance_date to this transaction's date
    """
    transaction_id = body.get('transaction_id')
    if not transaction_id:
        raise HTTPException(status_code=400, detail="transaction_id required")

    loan = db.query(Loan).filter_by(id=loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    txn = db.query(Transaction).filter_by(id=transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    split = _compute_pmt_split(
        loan.current_balance or 0,
        loan.interest_rate or 0,
        loan.monthly_payment or abs(txn.amount),
        loan.property_tax_monthly or 0,
        loan.insurance_monthly or 0,
    )

    # Remove any existing splits on this transaction
    db.query(TransactionSplit).filter_by(parent_transaction_id=transaction_id).delete()

    # Create split records
    components = [
        (split['principal'],    'Transfer',  '',                 'Mortgage Principal'),
        (split['interest'],     'Expense',   'Fees and Interest','Mortgage Interest'),
    ]
    if split['property_tax'] > 0:
        components.append((split['property_tax'], 'Expense', 'Housing', 'Property Tax'))
    if split['insurance'] > 0:
        components.append((split['insurance'], 'Expense', 'Insurance', "Homeowner's Insurance"))

    for amt, action, category, desc in components:
        if amt <= 0:
            continue
        db.add(TransactionSplit(
            parent_transaction_id=transaction_id,
            amount=amt,
            description=desc,
            category=category,
            action=action,
        ))

    # Update the parent transaction
    txn.is_split = True
    txn.loan_id = loan_id
    txn.action = 'Transfer'
    txn.description_clean = f'{loan.lender} payment'
    txn.needs_review = False
    txn.is_locked = True
    _lock_points_for_transaction(db, txn)

    # Update the loan
    loan.current_balance = round((loan.current_balance or 0) - split['principal'], 2)
    loan.balance_date = txn.date
    if loan.remaining_term_months and loan.remaining_term_months > 0:
        loan.remaining_term_months -= 1
    loan.updated_at = datetime.utcnow()

    db.commit()
    return {
        'message': 'Transaction linked',
        'split': split,
        'new_balance': loan.current_balance,
        'remaining_term_months': loan.remaining_term_months,
    }

@router.delete("/api/loans/{loan_id}/unlink-transaction/{transaction_id}")
async def unlink_loan_transaction(
    loan_id: int, transaction_id: int, db: Session = Depends(get_db)
):
    """Reverse a loan payment link: restore splits, unlink, and add principal back to balance."""
    loan = db.query(Loan).filter_by(id=loan_id).first()
    txn = db.query(Transaction).filter_by(id=transaction_id).first()
    if not loan or not txn:
        raise HTTPException(status_code=404, detail="Not found")

    # Find principal split to reverse the balance update
    principal_split = (
        db.query(TransactionSplit)
        .filter_by(parent_transaction_id=transaction_id, action='Transfer')
        .first()
    )
    if principal_split:
        loan.current_balance = round((loan.current_balance or 0) + principal_split.amount, 2)
        if loan.remaining_term_months is not None:
            loan.remaining_term_months += 1
        loan.updated_at = datetime.utcnow()

    db.query(TransactionSplit).filter_by(parent_transaction_id=transaction_id).delete()
    txn.is_split = False
    txn.loan_id = None
    txn.is_locked = False
    txn.needs_review = True
    db.commit()
    return {'message': 'Transaction unlinked'}
