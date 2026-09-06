"""
routers/cash_flow.py — true cash-movement reporting (checking/savings only),
manual cash-flow overlays (projected future inflows/outflows), salary-payment
allocation tracking, and the daily end-of-day balance table.

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import (
    get_db, Account, Card, CashFlowOverlay, Loan,
    SalaryAllocation, SalaryPayment, Transaction,
)
from core.points_engine import _CC_PAYMENT_KW
from core.serializers import _overlay_to_dict, _salary_to_dict
from core.accounts_helpers import get_account_balance, classify_account

router = APIRouter()


class CashFlowOverlayCreate(BaseModel):
    description: str
    amount: float                          # positive = inflow, negative = outflow
    flow_date: str                         # YYYY-MM-DD
    source: str = 'manual'                 # manual | cc_payment | loan_payment
    account_id: Optional[int] = None
    is_recurring: bool = False
    recurrence_day: Optional[int] = None   # 1–31

class CashFlowOverlayUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    flow_date: Optional[str] = None
    source: Optional[str] = None
    account_id: Optional[int] = None
    is_recurring: Optional[bool] = None
    recurrence_day: Optional[int] = None
    is_active: Optional[bool] = None

class SalaryAllocationIn(BaseModel):
    account_id: int
    amount: float

class SalaryPaymentCreate(BaseModel):
    payment_date: str          # YYYY-MM-DD
    description: str
    person: str
    allocations: List[SalaryAllocationIn]

class SalaryPaymentUpdate(BaseModel):
    payment_date: Optional[str] = None
    description:  Optional[str] = None
    person:       Optional[str] = None
    allocations:  Optional[List[SalaryAllocationIn]] = None

def todayStr_py():
    """Return today's date as YYYY-MM-DD string."""
    return datetime.utcnow().strftime("%Y-%m-%d")

@router.get("/api/cash-flow")
async def get_cash_flow(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Compute cash flow for depository (cash) accounts only:
    checking, savings, money market, cd, cash.
    Reflects true cash movement: income, expenses paid from cash,
    liability payments, and inter-account transfers.
    Returns categorised inflows/outflows with CC payment and loan breakdowns.
    """
    # Default to current month
    if not start_date:
        now = datetime.utcnow()
        start_date = f"{now.year}-{now.month:02d}-01"
    if not end_date:
        end_date = todayStr_py()

    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date, "%Y-%m-%d")

    # Cash accounts = checking, savings, money market, cd, cash.
    # Matched case-insensitively: account_type is stored capitalized
    # ('Checking', 'Savings', 'HSA', 'FSA'), so a plain .in_() against these
    # lowercase literals matched *nothing* — cash_id_list came back empty and
    # the endpoint short-circuited to `empty`, which is why every range
    # reported $0 income/expenses with transaction_count 0 (BACKLOG B5).
    from sqlalchemy import func as _func
    cash_types = {'checking', 'savings', 'money market', 'cd', 'cash', 'hsa', 'fsa'}
    cash_accounts = db.query(Account).filter(
        Account.is_active == True,
        _func.lower(Account.account_type).in_(cash_types),
    ).all()
    cash_ids = set(a.id for a in cash_accounts)
    cash_id_list = list(cash_ids)

    empty = {
        'start_date': start_date, 'end_date': end_date,
        'inflows': 0, 'outflows': 0, 'net': 0,
        'income': 0, 'expenses': 0,
        'cc_payments': 0, 'loan_repayments': 0, 'transfers_between': 0,
        'by_inflow': {}, 'by_outflow': {},
        'transaction_count': 0,
    }
    if not cash_id_list:
        return empty

    txns = db.query(Transaction).filter(
        Transaction.account_id.in_(cash_id_list),
        Transaction.date >= start_dt,
        Transaction.date <= end_dt,
        Transaction.is_excluded != True,
        Transaction.is_gcb != True,
    ).order_by(Transaction.date.desc()).all()

    inflows = 0.0
    outflows = 0.0
    income_total = 0.0
    expense_total = 0.0
    cc_payments = 0.0
    loan_repayments = 0.0
    transfers_between = 0.0  # net-zero transfers between own cash accounts
    by_inflow: dict[str, float] = {}   # category/description → positive amount
    by_outflow: dict[str, float] = {}  # category/description → positive amount

    # Pre-load all account IDs to detect internal transfers
    all_account_ids = set(a.id for a in db.query(Account).filter(
        Account.is_active == True
    ).all())

    # CC and Loan keywords for detection
    _CC_KW = _CC_PAYMENT_KW
    _LOAN_KW = ('LOAN', 'MORTGAGE', 'STUDENT', 'SLS SERVICING', 'FREEDOM MORTGAGE',
                'LAKEVIEW', 'DOVENMUEHLE', 'ESCROW')

    for t in txns:
        desc_upper = (t.description_raw or '').upper()
        action = t.action or ''
        cat = t.category_final or 'Other'

        if t.amount > 0:
            # Inflow: income, refunds, or incoming transfers
            inflows += t.amount
            if action == 'Income':
                income_total += t.amount
                key = cat if cat != 'Other' else 'Other Income'
                by_inflow[key] = by_inflow.get(key, 0) + t.amount
            elif action == 'Transfer':
                # Transfer in — could be from own account or external
                by_inflow['Transfers In'] = by_inflow.get('Transfers In', 0) + t.amount
            else:
                key = f"Refund / {cat}" if cat != 'Other' else 'Refunds'
                by_inflow[key] = by_inflow.get(key, 0) + t.amount
        else:
            amt = abs(t.amount)
            outflows += t.amount  # keep negative

            if action == 'Transfer':
                # Detect CC payments vs loan payments vs internal transfers
                if any(kw in desc_upper for kw in _CC_KW):
                    cc_payments += amt
                    by_outflow['Credit Card Payments'] = by_outflow.get('Credit Card Payments', 0) + amt
                elif any(kw in desc_upper for kw in _LOAN_KW):
                    loan_repayments += amt
                    by_outflow['Loan / Mortgage'] = by_outflow.get('Loan / Mortgage', 0) + amt
                else:
                    by_outflow['Other Transfers'] = by_outflow.get('Other Transfers', 0) + amt
            elif action == 'Expense':
                expense_total += amt
                by_outflow[cat] = by_outflow.get(cat, 0) + amt
            else:
                by_outflow['Other'] = by_outflow.get('Other', 0) + amt

    # Sort breakdowns by amount descending
    by_inflow_sorted = dict(sorted(by_inflow.items(), key=lambda x: -x[1]))
    by_outflow_sorted = dict(sorted(by_outflow.items(), key=lambda x: -x[1]))

    return {
        'start_date': start_date,
        'end_date': end_date,
        'inflows': round(inflows, 2),
        'outflows': round(outflows, 2),
        'net': round(inflows + outflows, 2),
        'income': round(income_total, 2),
        'expenses': round(expense_total, 2),
        'cc_payments': round(cc_payments, 2),
        'loan_repayments': round(loan_repayments, 2),
        'transfers_between': round(transfers_between, 2),
        'by_inflow': {k: round(v, 2) for k, v in by_inflow_sorted.items()},
        'by_outflow': {k: round(v, 2) for k, v in by_outflow_sorted.items()},
        'transaction_count': len(txns),
    }

@router.get("/api/cash-flow-overlays")
async def list_cash_flow_overlays(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return all active cash flow overlays, optionally filtered by date range."""
    from sqlalchemy import Date as SA_Date
    q = db.query(CashFlowOverlay).filter(CashFlowOverlay.is_active == True)
    if start_date:
        q = q.filter(CashFlowOverlay.flow_date >= start_date)
    if end_date:
        q = q.filter(CashFlowOverlay.flow_date <= end_date)
    overlays = q.order_by(CashFlowOverlay.flow_date, CashFlowOverlay.id).all()
    return [_overlay_to_dict(o) for o in overlays]

@router.post("/api/cash-flow-overlays")
async def create_cash_flow_overlay(
    payload: CashFlowOverlayCreate,
    db: Session = Depends(get_db),
):
    from datetime import date as _date
    o = CashFlowOverlay(
        description    = payload.description,
        amount         = payload.amount,
        flow_date      = _date.fromisoformat(payload.flow_date),
        source         = payload.source or 'manual',
        account_id     = payload.account_id,
        is_recurring   = payload.is_recurring,
        recurrence_day = payload.recurrence_day,
        is_active      = True,
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return _overlay_to_dict(o)

@router.patch("/api/cash-flow-overlays/{overlay_id}")
async def update_cash_flow_overlay(
    overlay_id: int,
    payload: CashFlowOverlayUpdate,
    db: Session = Depends(get_db),
):
    from datetime import date as _date
    o = db.query(CashFlowOverlay).filter_by(id=overlay_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Overlay not found")
    if payload.description  is not None: o.description    = payload.description
    if payload.amount        is not None: o.amount         = payload.amount
    if payload.flow_date     is not None: o.flow_date      = _date.fromisoformat(payload.flow_date)
    if payload.source        is not None: o.source         = payload.source
    if payload.account_id    is not None: o.account_id     = payload.account_id
    if payload.is_recurring  is not None: o.is_recurring   = payload.is_recurring
    if payload.recurrence_day is not None: o.recurrence_day = payload.recurrence_day
    if payload.is_active     is not None: o.is_active      = payload.is_active
    o.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(o)
    return _overlay_to_dict(o)

@router.delete("/api/cash-flow-overlays/{overlay_id}")
async def delete_cash_flow_overlay(
    overlay_id: int,
    db: Session = Depends(get_db),
):
    o = db.query(CashFlowOverlay).filter_by(id=overlay_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Overlay not found")
    o.is_active = False
    db.commit()
    return {"deleted": overlay_id}

@router.post("/api/cash-flow-overlays/generate")
async def generate_cash_flow_overlays(db: Session = Depends(get_db)):
    """
    Auto-generate ONE upcoming overlay entry per card/loan:
    - Credit cards: uses balance at the most recent statement close date as
      the payment amount, scheduled on the next upcoming payment_due_day.
      Close-date logic: if today.day > close_day → close = this month's close_day,
      else → close = last month's close_day.
    - Loans: fixed monthly_payment scheduled on next upcoming payment_due_day.
    Skips entries that already exist (same source + description + flow_date).
    """
    from datetime import date as _date
    import calendar

    today = _date.today()
    created = 0
    skipped = 0

    # Build set of existing (source, description, flow_date ISO) to avoid duplicates
    existing = db.query(CashFlowOverlay).filter(
        CashFlowOverlay.is_active == True,
        CashFlowOverlay.source.in_(['cc_payment', 'loan_payment']),
    ).all()
    existing_keys = {
        (o.source, o.description, o.flow_date.isoformat())
        for o in existing if o.flow_date
    }

    def _safe_date(y, m, day):
        last = calendar.monthrange(y, m)[1]
        return _date(y, m, min(day, last))

    def _next_due(due_day: int) -> _date:
        """Return the next upcoming date matching due_day (today or later)."""
        this_month = _safe_date(today.year, today.month, due_day)
        if this_month >= today:
            return this_month
        # Move to next month
        nm = today.month + 1 if today.month < 12 else 1
        ny = today.year if today.month < 12 else today.year + 1
        return _safe_date(ny, nm, due_day)

    # ── Credit cards: ONE upcoming payment per card ────────────────────────
    cards = db.query(Card).filter(
        Card.is_active == True,
        Card.account_id != None,
        Card.payment_account_id != None,
        Card.payment_due_day != None,
    ).all()

    for card in cards:
        desc = f"{card.card_name or 'Card'} Payment"
        close_day = card.statement_close_day or 25  # fallback if not configured

        # Most recent statement close date
        if today.day > close_day:
            close_date = _safe_date(today.year, today.month, close_day)
        else:
            pm = today.month - 1 or 12
            py = today.year if today.month > 1 else today.year - 1
            close_date = _safe_date(py, pm, close_day)

        balance_at_close = get_account_balance(
            db, card.account_id,
            as_of_date=datetime.combine(close_date, datetime.max.time()),
        )
        if balance_at_close >= -1.0:       # no meaningful balance, skip
            continue
        payment_amount = -abs(balance_at_close)  # outflow → negative

        due = _next_due(card.payment_due_day)
        key = ('cc_payment', desc, due.isoformat())
        if key in existing_keys:
            skipped += 1
            continue
        db.add(CashFlowOverlay(
            description = desc,
            amount      = payment_amount,
            flow_date   = due,
            source      = 'cc_payment',
            account_id  = card.payment_account_id,
            is_active   = True,
        ))
        existing_keys.add(key)
        created += 1

    # ── Loans: ONE upcoming payment per loan ──────────────────────────────
    loans = db.query(Loan).filter(
        Loan.is_active == True,
        Loan.payment_account_id != None,
        Loan.payment_due_day != None,
        Loan.monthly_payment != None,
    ).all()

    for loan in loans:
        desc = f"{loan.lender} Payment"
        payment_amount = -(loan.monthly_payment or 0)  # outflow → negative

        due = _next_due(loan.payment_due_day)
        key = ('loan_payment', desc, due.isoformat())
        if key in existing_keys:
            skipped += 1
            continue
        db.add(CashFlowOverlay(
            description = desc,
            amount      = payment_amount,
            flow_date   = due,
            source      = 'loan_payment',
            account_id  = loan.payment_account_id,
            is_active   = True,
        ))
        existing_keys.add(key)
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped}

@router.get("/api/salary-payments")
async def list_salary_payments(db: Session = Depends(get_db)):
    """Return all active salary payments with their per-account allocations."""
    rows = (
        db.query(SalaryPayment)
        .filter(SalaryPayment.is_active == True)
        .order_by(SalaryPayment.payment_date.desc(), SalaryPayment.id)
        .all()
    )
    return [_salary_to_dict(r) for r in rows]

@router.post("/api/salary-payments")
async def create_salary_payment(body: SalaryPaymentCreate, db: Session = Depends(get_db)):
    from datetime import date as _date
    sp = SalaryPayment(
        payment_date = _date.fromisoformat(body.payment_date),
        description  = body.description,
        person       = body.person,
        is_active    = True,
    )
    db.add(sp)
    db.flush()   # get sp.id before adding child rows
    for a in body.allocations:
        if a.amount and a.amount != 0:
            db.add(SalaryAllocation(
                salary_payment_id = sp.id,
                account_id        = a.account_id,
                amount            = abs(a.amount),   # always stored positive
            ))
    db.commit()
    db.refresh(sp)
    return _salary_to_dict(sp)

@router.patch("/api/salary-payments/{payment_id}")
async def update_salary_payment(
    payment_id: int, body: SalaryPaymentUpdate, db: Session = Depends(get_db)
):
    from datetime import date as _date
    sp = db.query(SalaryPayment).filter_by(id=payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary payment not found")
    if body.payment_date is not None:
        sp.payment_date = _date.fromisoformat(body.payment_date)
    if body.description is not None:
        sp.description = body.description
    if body.person is not None:
        sp.person = body.person
    if body.allocations is not None:
        db.query(SalaryAllocation).filter_by(salary_payment_id=sp.id).delete()
        for a in body.allocations:
            if a.amount and a.amount != 0:
                db.add(SalaryAllocation(
                    salary_payment_id = sp.id,
                    account_id        = a.account_id,
                    amount            = abs(a.amount),
                ))
    db.commit()
    db.refresh(sp)
    return _salary_to_dict(sp)

@router.delete("/api/salary-payments/{payment_id}")
async def delete_salary_payment(payment_id: int, db: Session = Depends(get_db)):
    sp = db.query(SalaryPayment).filter_by(id=payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary payment not found")
    db.delete(sp)
    db.commit()
    return {"deleted": payment_id}

@router.get("/api/daily-balances")
async def get_daily_balances(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    client_today: Optional[str] = None,   # client's local YYYY-MM-DD (avoids UTC drift)
    db: Session = Depends(get_db),
):
    """
    Daily end-of-day balance table for all active accounts.

    Returns accounts grouped by type (Checking & Savings, Investments,
    Other Assets, Credit Cards, Loans, Other Liabilities) with a balance
    value for each day in the requested range.

    Future balance projections are driven exclusively by active CashFlowOverlay
    entries — auto CC/loan projections have been replaced by explicit user-managed
    overlays (created manually or via POST /api/cash-flow-overlays/generate).
    """
    from datetime import date, timedelta
    import calendar as _cal
    from sqlalchemy import func

    # Prefer the client's local date — avoids UTC midnight rollover shifting "today"
    try:
        today = date.fromisoformat(client_today) if client_today else datetime.utcnow().date()
    except ValueError:
        today = datetime.utcnow().date()

    if not start_date:
        start_date = f"{today.year}-{today.month:02d}-01"
    if not end_date:
        last = _cal.monthrange(today.year, today.month)[1]
        end_date = f"{today.year}-{today.month:02d}-{last:02d}"

    start_dt = date.fromisoformat(start_date)
    end_dt = date.fromisoformat(end_date)
    num_days = (end_dt - start_dt).days + 1
    dates = [(start_dt + timedelta(days=i)).isoformat() for i in range(num_days)]
    dates_set = set(dates)

    accounts = db.query(Account).filter(Account.is_active == True).all()
    if not accounts:
        return {"start_date": start_date, "end_date": end_date,
                "today": today.isoformat(), "dates": dates, "groups": []}

    # ── Per-account daily balances ─────────────────────────────────────────
    acct_balances = {}  # {account_id: [float per day]}

    for acct in accounts:
        anchor_balance = acct.starting_balance or 0.0
        anchor_date = acct.start_date.date() if acct.start_date else date(2000, 1, 1)
        range_start_dt = datetime.combine(start_dt, datetime.min.time())
        range_end_dt = datetime.combine(end_dt, datetime.max.time())
        # Use end-of-day for anchor so transactions ON anchor_date are considered
        # "already in the Plaid snapshot" (anchor_balance includes them).
        anchor_dt = datetime.combine(anchor_date, datetime.max.time())

        # Compute balance at EOD(range_start - 1) using the anchor.
        #
        # Anchor model (start_date is set):
        #   anchor_balance = Plaid balance AT anchor_dt (end of anchor day).
        #   If anchor is WITHIN or AFTER the display range: go backward —
        #     subtract transactions from range_start through anchor_dt
        #     to get the balance just before range_start.
        #   If anchor is BEFORE the display range: go forward —
        #     add transactions from anchor_dt up to (but not including) range_start.
        #
        # Legacy model (start_date is None, anchor_dt = year 2000):
        #   pre_sum forward from year 2000 to range_start (same as before).
        if anchor_dt >= range_start_dt:
            # Anchor within or after range: walk backward to range_start - 1
            pre_sum = -(
                db.query(func.sum(Transaction.amount))
                .filter(
                    Transaction.account_id == acct.id,
                    Transaction.date >= range_start_dt,
                    Transaction.date <= anchor_dt,
                )
                .scalar() or 0.0
            )
        else:
            # Anchor before range: walk forward to range_start - 1
            pre_sum = (
                db.query(func.sum(Transaction.amount))
                .filter(
                    Transaction.account_id == acct.id,
                    Transaction.date >= anchor_dt,
                    Transaction.date < range_start_dt,
                )
                .scalar() or 0.0
            )

        # Fetch ALL transactions within the range (same reasoning).
        txns = (
            db.query(Transaction.date, Transaction.amount)
            .filter(
                Transaction.account_id == acct.id,
                Transaction.date >= range_start_dt,
                Transaction.date <= range_end_dt,
            )
            .all()
        )

        # Group by date string (EOD balance: sum all txns on that day)
        daily_delta: dict[str, float] = {}
        for txn_date, txn_amount in txns:
            d_obj = txn_date.date() if hasattr(txn_date, 'date') else txn_date
            d_str = d_obj.isoformat()
            daily_delta[d_str] = daily_delta.get(d_str, 0.0) + txn_amount

        running = anchor_balance + pre_sum
        daily: list[float] = []
        for d in dates:
            running += daily_delta.get(d, 0.0)
            daily.append(round(running, 2))

        acct_balances[acct.id] = daily

    # ── Snapshot raw balances (before any projections) ───────────────────
    # Stored per-account so the balance-detail modal can show "system balance"
    # (what the balance would be without any overlay / salary projections).
    raw_balances: dict[int, list] = {aid: list(bal) for aid, bal in acct_balances.items()}

    # ── Projection step: CashFlowOverlays + SalaryAllocations ────────────
    # Both types are applied as step-changes: the amount is added to every day
    # from flow_date forward.  projection_details records per-account per-date
    # entries so the frontend modal can break down each projected cell.
    projected_dates:    dict[int, set]  = {}   # {account_id: {date_str, …}}
    projection_details: dict[int, dict] = {}   # {account_id: {date_str: [entries]}}

    def _apply_projection(acct_id: int, pdate_str: str, entry: dict):
        date_idx = dates.index(pdate_str)
        for i in range(date_idx, num_days):
            acct_balances[acct_id][i] = round(acct_balances[acct_id][i] + entry["amount"], 2)
        projected_dates.setdefault(acct_id, set()).add(pdate_str)
        projection_details.setdefault(acct_id, {}).setdefault(pdate_str, []).append(entry)

    # CashFlowOverlay entries
    overlays = (
        db.query(CashFlowOverlay)
        .filter(
            CashFlowOverlay.is_active == True,
            CashFlowOverlay.flow_date >= today,
        )
        .all()
    )
    for ov in overlays:
        if not ov.account_id or ov.account_id not in acct_balances:
            continue
        pdate_str = ov.flow_date.isoformat()
        if pdate_str not in dates_set:
            continue
        _apply_projection(ov.account_id, pdate_str, {
            "description": ov.description,
            "amount":      ov.amount,
            "source":      ov.source,
        })

    # SalaryAllocation entries (future pay dates only)
    from sqlalchemy.orm import joinedload as _jl
    salary_allocs = (
        db.query(SalaryAllocation)
        .options(_jl(SalaryAllocation.salary_payment))
        .join(SalaryPayment)
        .filter(
            SalaryPayment.is_active   == True,
            SalaryPayment.payment_date >= today,
        )
        .all()
    )
    for alloc in salary_allocs:
        if alloc.account_id not in acct_balances:
            continue
        pdate_str = alloc.salary_payment.payment_date.isoformat()
        if pdate_str not in dates_set:
            continue
        desc = f"{alloc.salary_payment.description} ({alloc.salary_payment.person})"
        _apply_projection(alloc.account_id, pdate_str, {
            "description": desc,
            "amount":      alloc.amount,   # always positive
            "source":      "salary",
        })

    # ── Group by account type ─────────────────────────────────────────────
    GROUP_ORDER = [
        ("Checking & Savings", {"Checking", "Savings", "checking", "savings",
                                 "money market", "Money Market", "cd", "CD",
                                 "HSA", "hsa", "FSA", "fsa"}),
        ("Investments",        {"Brokerage", "Investment", "brokerage", "investment",
                                 "401k", "401K", "ira", "IRA"}),
        ("Other Assets",       {"vehicle", "Vehicle", "real_estate", "business_owned", "Other"}),
        ("Credit Cards",       {"Credit Card", "credit card", "credit"}),
        ("Loans",              {"Loan", "loan", "mortgage", "Mortgage", "student", "auto"}),
        ("Other Liabilities",  set()),
    ]

    def _get_group(acct_type: str) -> str:
        t = (acct_type or 'other').strip()
        t_lower = t.lower()
        for grp_name, types in GROUP_ORDER:
            if t in types or t_lower in {x.lower() for x in types}:
                return grp_name
        flags = classify_account(t)
        return "Other Liabilities" if flags['is_liability'] else "Other Assets"

    groups_map: dict[str, list] = {grp: [] for grp, _ in GROUP_ORDER}

    for acct in accounts:
        grp = _get_group(acct.account_type)
        p_dates = projected_dates.get(acct.id, set())
        groups_map[grp].append({
            "id":              acct.id,
            "account_name":    acct.account_name,
            "account_type":    acct.account_type,
            "mask":            acct.mask,
            "balances":        acct_balances[acct.id],
            "raw_balances":    raw_balances[acct.id],
            "projected_dates": sorted(p_dates),
        })

    _ASSET_GROUPS = {"Checking & Savings", "Investments", "Other Assets"}
    result_groups = []
    for grp_name, _ in GROUP_ORDER:
        accts = groups_map.get(grp_name, [])
        if not accts:
            continue
        totals = [round(sum(a["balances"][i] for a in accts), 2) for i in range(num_days)]
        result_groups.append({
            "group": grp_name,
            "is_asset": grp_name in _ASSET_GROUPS,
            "accounts": accts,
            "totals": totals,
        })

    return {
        "start_date":         start_date,
        "end_date":           end_date,
        "today":              today.isoformat(),
        "dates":              dates,
        "groups":             result_groups,
        # projection_details: {str(account_id): {date_str: [{description, amount, source}]}}
        # Used by the frontend balance-detail modal.
        "projection_details": {str(k): v for k, v in projection_details.items()},
    }

@router.get("/api/forecast/{account_id}")
async def get_liquidity_forecast(account_id: int, days: int = 30, db: Session = Depends(get_db)):
    """Execute the calculate_liquidity_shortfall SQL function."""
    from sqlalchemy import text
    
    # We use a raw SQL execution to call the function
    sql = text("SELECT * FROM calculate_liquidity_shortfall(:acct_id, :days)")
    result = db.execute(sql, {"acct_id": account_id, "days": days})
    
    forecast = [
        {
            "date": row.forecast_date.isoformat(),
            "balance": float(row.projected_balance),
            "shortfall": bool(row.shortfall_flag)
        }
        for row in result
    ]
    return forecast
