"""
routers/net_worth.py — full net worth snapshot (assets/liabilities by bucket)
and its monthly historical timeline.

Extracted from main.py (Phase 1 batch 2 of the backend token-usage refactor —
see PLAN.md "main.py -> domain routers split").
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db, Account, Loan, Transaction, TransactionSplit
from core.accounts_helpers import get_account_balance, classify_account

router = APIRouter()


@router.get("/api/net-worth")
async def get_net_worth(as_of: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Compute full net worth snapshot from all active accounts as of a given date.
    Each account's balance = starting_balance + SUM(transactions up to as_of date).
    Groups accounts by Net Worth bucket category.
    as_of: ISO date string YYYY-MM-DD (defaults to today)
    """
    as_of_dt = datetime.strptime(as_of, "%Y-%m-%d").replace(hour=23, minute=59, second=59) if as_of else datetime.utcnow()

    accounts = db.query(Account).filter_by(is_active=True).all()
    buckets = {}
    total_assets = 0.0
    total_liabilities = 0.0

    for a in accounts:
        balance = get_account_balance(db, a.id, as_of_date=as_of_dt)
        flags = classify_account(a.account_type)
        bucket = flags['bucket']

        if bucket not in buckets:
            buckets[bucket] = {'is_asset': flags['is_asset'], 'accounts': []}

        buckets[bucket]['accounts'].append({
            'account_id': a.id,
            'account_name': a.account_name,
            'account_type': a.account_type,
            'mask': a.mask,
            'is_manual': bool(a.is_manual),
            'starting_balance': a.starting_balance or 0,
            'start_date': a.start_date.strftime('%Y-%m-%d') if a.start_date else None,
            'balance': balance,
        })

        if flags['is_asset']:
            total_assets += balance
        else:
            # Liabilities stored negative (e.g. credit card balance = -500)
            total_liabilities += balance

    # Add active loans that aren't already covered by a linked account in this snapshot
    from sqlalchemy import func as _func
    active_account_ids = {a.id for a in accounts}
    active_loans = db.query(Loan).filter_by(is_active=True).all()
    loan_items = []
    for loan in active_loans:
        if loan.account_id and loan.account_id in active_account_ids:
            continue  # already represented via its linked liability account
        balance = loan.current_balance or 0.0
        if loan.balance_date and balance > 0:
            # Subtract principal payments made after the recorded balance_date
            principal_paid = db.query(_func.sum(TransactionSplit.amount)).join(
                Transaction, TransactionSplit.parent_transaction_id == Transaction.id
            ).filter(
                TransactionSplit.description == 'Principal',
                Transaction.loan_id == loan.id,
                Transaction.date > loan.balance_date,
            ).scalar() or 0.0
            balance = max(0.0, balance - principal_paid)
        signed = -round(balance, 2)  # negative = liability (consistent with account convention)
        loan_items.append({
            'account_id': None,
            'account_name': f"{loan.lender} ({loan.loan_type})",
            'account_type': 'loan',
            'mask': None,
            'is_manual': True,
            'starting_balance': 0,
            'start_date': None,
            'balance': signed,
        })
        total_liabilities += signed

    if loan_items:
        if 'Loans' not in buckets:
            buckets['Loans'] = {'is_asset': False, 'accounts': []}
        buckets['Loans']['accounts'].extend(loan_items)

    return {
        'as_of': as_of_dt.strftime('%Y-%m-%d'),
        'total_assets': round(total_assets, 2),
        'total_liabilities': round(total_liabilities, 2),
        'net_worth': round(total_assets + total_liabilities, 2),
        'buckets': buckets,
    }

@router.get("/api/net-worth/timeline")
async def get_net_worth_timeline(months: int = 24, db: Session = Depends(get_db)):
    """
    Compute net worth at each month-end for the last N months plus today.
    Returns a list of {date, assets, liabilities, net_worth} data points.
    """
    from dateutil.relativedelta import relativedelta

    accounts = db.query(Account).filter_by(is_active=True).all()
    today = datetime.utcnow()
    points = []

    # Generate month-end dates for the last N months
    dates = []
    for i in range(months, 0, -1):
        # Last day of (today - i months)
        dt = today - relativedelta(months=i)
        # Set to last day of that month
        if dt.month == 12:
            end = datetime(dt.year + 1, 1, 1) - relativedelta(days=1)
        else:
            end = datetime(dt.year, dt.month + 1, 1) - relativedelta(days=1)
        end = end.replace(hour=23, minute=59, second=59)
        dates.append(end)
    # Add today
    dates.append(today)

    from sqlalchemy import func as _func
    loans = db.query(Loan).filter_by(is_active=True).all()

    for dt in dates:
        assets = 0.0
        liabs = 0.0
        for a in accounts:
            balance = get_account_balance(db, a.id, as_of_date=dt)
            flags = classify_account(a.account_type)
            if flags['is_asset']:
                assets += balance
            else:
                liabs += balance  # Already negative

        # Add loan liabilities — reconstruct historical balance from principal payments
        if loans:
            principal_paid_after = db.query(_func.sum(TransactionSplit.amount)).join(
                Transaction, TransactionSplit.parent_transaction_id == Transaction.id
            ).filter(
                TransactionSplit.description == 'Principal',
                Transaction.date > dt,
            ).scalar() or 0.0
            total_loan_balance = sum(l.current_balance or 0 for l in loans)
            # principal_paid_after is negative (payments); subtract negatives to get historical balance
            historical_loans = total_loan_balance - principal_paid_after
            liabs -= round(historical_loans, 2)  # loans are liabilities → subtract from net worth

        points.append({
            'date': dt.strftime('%Y-%m-%d'),
            'assets': round(assets, 2),
            'liabilities': round(liabs, 2),
            'net_worth': round(assets + liabs, 2),
        })

    return {'timeline': points}
