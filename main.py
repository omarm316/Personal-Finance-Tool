"""
Finance Automation — FastAPI backend
Clean consolidated version — all features included
"""
import asyncio
import io
import os

# ── Load .env from iCloud Drive path ────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request, Response, BackgroundTasks, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import hashlib
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from database import (
    init_db, Account, Transaction, Category,
    CategorizationRule, PlaidItem, seed_categories,
    Card, PointsCategory, MerchantPointsMapping,
    PointsEcosystem, CardProduct, CardProductReward, CardEarningRate,
    CardBenefit, BenefitUsage, SpendChallenge,
    seed_points_categories, seed_points_ecosystems, seed_card_products,
    import_cards_from_excel, import_points_from_excel,
    TransactionSplit, BudgetTarget, Loan, MerchantOverride,
    AccountMonthlySnapshot, UserCorrection, DuplicateIgnore, CashFlowOverlay,
    SalaryPayment, SalaryAllocation, BalanceObservation,
)
from llm_service import enrich_transaction, save_override, _call_groq, VALID_CATEGORIES
from categorization import CategorizationEngine, load_rules_from_excel
from plaid_integration import setup_plaid_from_env
from plaid.exceptions import ApiException as PlaidApiException

# ---------------------------------------------------------------------------
# Account classification helpers
# ---------------------------------------------------------------------------

# Bucket mapping: account_type → (bucket_name, is_asset, is_liability)
# Keys match Plaid subtypes (checking, savings, credit card) and manual types
ACCOUNT_TYPE_MAP = {
    # Assets
    'checking':       ('Cash & Savings', True, False),
    'savings':        ('Cash & Savings', True, False),
    'cash':           ('Cash & Savings', True, False),
    'gift card':      ('Cash & Savings', True, False),
    'money market':   ('Cash & Savings', True, False),
    'cd':             ('Cash & Savings', True, False),
    'investment':     ('Investments', True, False),
    '401k':           ('Investments', True, False),
    'ira':            ('Investments', True, False),
    'brokerage':      ('Investments', True, False),
    'real_estate':    ('Real Estate', True, False),
    'vehicle':        ('Other Assets', True, False),
    'business_owned': ('Other Assets', True, False),
    'other':          ('Other Assets', True, False),
    # Liabilities
    'credit card':    ('Credit Cards', False, True),
    'credit':         ('Credit Cards', False, True),
    'mortgage':       ('Mortgage', False, True),
    'loan':           ('Personal Loans', False, True),
    'student':        ('Personal Loans', False, True),
    'auto':           ('Personal Loans', False, True),
    'business_loan':  ('Business Loans', False, True),
}

# ---------------------------------------------------------------------------
# Content-hash helpers — stable transaction identity across Plaid re-links
# ---------------------------------------------------------------------------

def _account_hash(institution_id: str, mask: str, account_type: str) -> str:
    """
    Stable 12-char identity hash for an account.
    Formula: SHA256(institution_id|mask|normalised_type)[:12]

    Written once at exchange-token time and stored on the account row.
    Because it uses Plaid's immutable institution_id (e.g. "ins_3" for Chase)
    plus the last-4 mask, it survives sever-plaid and is the primary matching
    key when a user re-links a bank — no database JOIN required.
    """
    raw = f"{(institution_id or '').strip()}|{(mask or '').strip()}|{(account_type or '').lower().strip()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def _content_base_hash(account_id: int, date, amount: float, description_raw: str) -> str:
    """
    14-character prefix of SHA-256(account_id|date|amount|description_raw).
    Stable: uses the raw bank string (not enriched merchant name), normalised
    amount (2 dp), and uppercase description so minor spacing/case changes
    don't break the match.
    """
    raw = f"{account_id}|{date}|{amount:.2f}|{(description_raw or '').strip().upper()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:14]


def _assign_content_hash(db: Session, account_id: int, date, amount: float, description_raw: str) -> str:
    """
    Assign a unique content_hash for a new transaction.
    Counts existing transactions that share the same base hash to determine
    the next suffix: -00, -01, -02 …
    Thread-safe within a single DB session (flush before calling if needed).
    """
    base  = _content_base_hash(account_id, date, amount, description_raw)
    count = db.query(Transaction).filter(
        Transaction.content_hash.like(f'{base}-%')
    ).count()
    return f'{base}-{count:02d}'


# Map Plaid top-level types to our types (fallback when subtype is missing)
PLAID_TYPE_FALLBACK = {
    'depository':  'checking',
    'credit':      'credit card',
    'investment':  'investment',
    'loan':        'loan',
}

# Plaid personal_finance_category.primary → (app_category, action)
# Used as a deterministic fallback when rules don't produce a match.
# Only applied when Plaid confidence_level is HIGH or VERY_HIGH.
_PLAID_PFC_MAP: dict[str, tuple[str, str]] = {
    'INCOME':                    ('Work',            'Income'),
    'TRANSFER_IN':               ('Transfer',        'Transfer'),
    'TRANSFER_OUT':              ('Transfer',        'Transfer'),
    'CREDIT_CARD_PAYMENT':       ('Transfer',        'Transfer'),
    'LOAN_PAYMENTS':             ('Fees & Interest', 'Expense'),
    'BANK_FEES':                 ('Fees & Interest', 'Expense'),
    'FOOD_AND_DRINK':            ('Dining',          'Expense'),
    'GROCERIES':                 ('Groceries',       'Expense'),
    'TRANSPORTATION':            ('Transportation',  'Expense'),
    'TRAVEL':                    ('Travel',          'Expense'),
    'ENTERTAINMENT':             ('Entertainment',   'Expense'),
    'PERSONAL_CARE':             ('Self Care',       'Expense'),
    'MEDICAL':                   ('Healthcare',      'Expense'),
    'RENT_AND_UTILITIES':        ('Utilities',       'Expense'),
    'HOME_IMPROVEMENT':          ('Home',            'Expense'),
    'GENERAL_MERCHANDISE':       ('Other',           'Expense'),
    'GENERAL_SERVICES':          ('Other',           'Expense'),
    'GOVERNMENT_AND_NON_PROFIT': ('Other',           'Expense'),
    'EDUCATION':                 ('Education',       'Expense'),
}


# ---------------------------------------------------------------------------
# Points category inference
# ---------------------------------------------------------------------------

# Merchant name patterns → L2 (or L1) points category.
# Checked in order — put more-specific patterns first so "Uber Eats" wins
# over the plain "Uber" rideshare match.
# Each entry: (substring_to_match_lowercased, points_category_name)
_MERCHANT_POINTS_PATTERNS: list[tuple[str, str]] = [
    # ── Food delivery (before rideshare so "uber eats" hits here first) ──
    ("uber eats",        "Food Delivery"),
    ("doordash",         "Food Delivery"),
    ("door dash",        "Food Delivery"),
    ("grubhub",          "Food Delivery"),
    ("postmates",        "Food Delivery"),
    ("seamless",         "Food Delivery"),
    ("instacart",        "Groceries"),       # grocery delivery → Groceries
    # ── Rideshare ─────────────────────────────────────────────────────────
    ("lyft",             "Rideshare: Lyft"),
    ("uber",             "Rideshare: Uber"),
    # ── Airlines ──────────────────────────────────────────────────────────
    ("united air",       "United"),
    ("united airline",   "United"),
    ("united.com",       "United"),
    ("ual ",             "United"),          # United Airlines IATA code in merchant names
    ("delta air",        "Delta"),
    ("delta.com",        "Delta"),
    ("american airline", "American Airlines"),
    ("aa.com",           "American Airlines"),
    ("southwest air",    "Southwest"),
    ("southwest.com",    "Southwest"),
    ("jetblue",          "JetBlue"),
    ("alaska air",       "Alaska Airlines"),
    ("alaskaair",        "Alaska Airlines"),
    # ── Hotels ────────────────────────────────────────────────────────────
    ("hilton",           "Hilton"),          # matches Hampton Inn, DoubleTree, etc.
    ("marriott",         "Marriott"),
    ("sheraton",         "Marriott"),
    ("westin",           "Marriott"),
    ("w hotel",          "Marriott"),
    ("ritz-carlton",     "Marriott"),
    ("ritz carlton",     "Marriott"),
    ("courtyard",        "Marriott"),
    ("hyatt",            "Hyatt"),           # matches Park Hyatt, Grand Hyatt, Andaz, etc.
    ("intercontinental", "IHG"),
    ("holiday inn",      "IHG"),
    ("crowne plaza",     "IHG"),
    ("kimpton",          "IHG"),
    ("ihg",              "IHG"),
    # ── Retail / grocery ─────────────────────────────────────────────────
    ("walmart",          "Walmart"),
    ("wal-mart",         "Walmart"),
    ("target",           "Target"),
    ("amazon",           "Amazon"),          # also catches Amazon Fresh
    ("whole foods",      "Groceries"),
    ("trader joe",       "Groceries"),
    ("costco",           "Wholesale Clubs"),
    ("sam's club",       "Wholesale Clubs"),
    ("sams club",        "Wholesale Clubs"),
    ("best buy",         "Best Buy"),
    # ── Gas stations ─────────────────────────────────────────────────────
    ("shell",            "Gas Stations"),
    ("exxon",            "Gas Stations"),
    ("mobil",            "Gas Stations"),
    ("bp ",              "Gas Stations"),
    ("chevron",          "Gas Stations"),
    ("sunoco",           "Gas Stations"),
    ("circle k",         "Gas Stations"),
    ("speedway",         "Gas Stations"),
    # ── Streaming ─────────────────────────────────────────────────────────
    ("netflix",          "Streaming"),
    ("spotify",          "Streaming"),
    ("hulu",             "Streaming"),
    ("disney+",          "Streaming"),
    ("disneyplus",       "Streaming"),
    ("peacock",          "Streaming"),
    ("hbomax",           "Streaming"),
    ("hbo max",          "Streaming"),
    ("paramount+",       "Streaming"),
    ("paramountplus",    "Streaming"),
    ("apple tv",         "Streaming"),
    ("apple music",      "Streaming"),
    ("siriusxm",         "Streaming"),
    ("youtube premium",  "Streaming"),
    # ── Drugstore ─────────────────────────────────────────────────────────
    ("cvs",              "Drugstore"),
    ("walgreen",         "Drugstore"),
    ("rite aid",         "Drugstore"),
    # ── Grocery chains not covered above ─────────────────────────────────
    ("kings",            "Groceries"),   # Kings Food Markets / Kings Supermarkets
    ("kroger",           "Groceries"),
    ("safeway",          "Groceries"),
    ("publix",           "Groceries"),
    ("stop & shop",      "Groceries"),
    ("stop and shop",    "Groceries"),
    ("shoprite",         "Groceries"),
    ("h-e-b",            "Groceries"),
    ("wegmans",          "Groceries"),
    ("aldi",             "Groceries"),
    ("sprouts",          "Groceries"),
    ("fresh market",     "Groceries"),
]

# Plaid pfc_detailed → points category (L1 fallback when no merchant match)
_PFC_POINTS_MAP: dict[str, str] = {
    "TRAVEL_AIRLINES":                           "Airlines",
    "TRAVEL_LODGING":                            "Hotels",
    "TRAVEL_CAR_RENTALS":                        "Car Rental",
    "TRANSPORTATION_TAXIS":                      "Ground Transportation",
    "TRANSPORTATION_PUBLIC_TRANSIT":             "Ground Transportation",
    "TRANSPORTATION_GAS_STATIONS":               "Gas Stations",
    "FOOD_AND_DRINK_RESTAURANTS":                "Dining",
    "FOOD_AND_DRINK_FAST_FOOD":                  "Dining",
    "FOOD_AND_DRINK_BAR":                        "Dining",
    "FOOD_AND_DRINK_COFFEE":                     "Dining",
    "FOOD_AND_DRINK_FOOD_DELIVERY_SERVICES":     "Food Delivery",
    "SHOPS_GROCERIES":                           "Groceries",
    "SHOPS_PHARMACIES":                          "Drugstore",
    "ENTERTAINMENT_STREAMING_SERVICES":          "Streaming",
    "ENTERTAINMENT_MUSIC_AND_AUDIO":             "Streaming",
}


def infer_points_category(
    merchant_name: str | None,
    pfc_detailed: str | None = None,
    pfc_primary: str | None = None,
) -> str | None:
    """
    Infer the points_category name for a transaction using a two-step approach:

    1. Merchant name substring match → L2 (brand-specific) or L1 result.
       This is preferred because it's the most precise signal.
    2. Plaid pfc_detailed → L1 fallback when no merchant pattern fires.

    Returns None if we can't confidently classify — callers should leave
    points_category as NULL rather than guess.
    """
    if merchant_name:
        needle = merchant_name.lower()
        for pattern, cat in _MERCHANT_POINTS_PATTERNS:
            if pattern in needle:
                return cat

    if pfc_detailed:
        cat = _PFC_POINTS_MAP.get(pfc_detailed)
        if cat:
            return cat

    # pfc_primary gives a coarser signal — only use it for unambiguous mappings
    if pfc_primary == "GROCERIES":
        return "Groceries"

    return None


def calc_earn_rate(
    bonus_by_name: dict[str, float],
    base_rate: float,
    points_category_name: str | None,
    cat_parent_map: dict[str, str | None],
) -> float:
    """
    Waterfall earn-rate lookup: L2 (brand) → L1 (broad) → base.

    bonus_by_name    : {category_name: additional_multiplier} — pre-built from
                       the card product's CardProductReward rows (non-base only).
    base_rate        : the card's base earn rate (e.g. 1.5 for CFU).
    points_category_name : the transaction's assigned points category, or None.
    cat_parent_map   : {category_name: parent_key} — from PointsCategory table.

    Returns the total earn rate (base + bonus).
    """
    if not points_category_name:
        return base_rate
    # L2: card has an explicit rate for this brand/category
    if points_category_name in bonus_by_name:
        return base_rate + bonus_by_name[points_category_name]
    # L1: fall back to parent category (e.g. "United" → "Airlines")
    parent = cat_parent_map.get(points_category_name)
    if parent and parent in bonus_by_name:
        return base_rate + bonus_by_name[parent]
    return base_rate


def classify_account(account_type: str) -> dict:
    """
    Compute classification flags for an account based on its type.
    Returns is_asset, is_liability, is_credit, and bucket name.
    """
    acct_type = (account_type or 'other').lower().strip()
    bucket, is_asset, is_liability = ACCOUNT_TYPE_MAP.get(acct_type, ('Other Assets', True, False))
    return {
        'is_asset': is_asset,
        'is_liability': is_liability,
        'is_credit': acct_type == 'credit',
        'bucket': bucket,
    }


def serialize_account(a: Account, transaction_count: int = 0) -> dict:
    """
    Standard serialization for an Account object, including classification flags.
    Used by all endpoints that return account data.
    """
    flags = classify_account(a.account_type)
    return {
        'id': a.id,
        'plaid_account_id': a.plaid_account_id,
        'persistent_account_id': getattr(a, 'persistent_account_id', None),
        'institution_id': getattr(a, 'institution_id', None),
        'plaid_item_id': a.plaid_item_id,
        'account_name': a.account_name,
        'account_type': a.account_type,
        'official_name': a.official_name,
        'mask': a.mask,
        'is_manual': bool(a.is_manual),
        'is_active': a.is_active,
        'starting_balance': a.starting_balance or 0,
        'start_date': a.start_date.strftime('%Y-%m-%d') if a.start_date else None,
        'notes': a.notes,
        'is_asset': flags['is_asset'],
        'is_liability': flags['is_liability'],
        'is_credit': flags['is_credit'],
        'bucket': flags['bucket'],
        'transaction_count': transaction_count,
        # Plaid Liabilities product — populated by POST /api/plaid/sync-liabilities
        'liability_min_payment':      getattr(a, 'liability_min_payment', None),
        'liability_next_due_date':    a.liability_next_due_date.strftime('%Y-%m-%d') if getattr(a, 'liability_next_due_date', None) else None,
        'liability_last_statement_bal': getattr(a, 'liability_last_statement_bal', None),
        'liability_last_payment':     getattr(a, 'liability_last_payment', None),
        'liability_last_payment_date': a.liability_last_payment_date.strftime('%Y-%m-%d') if getattr(a, 'liability_last_payment_date', None) else None,
        'liability_purchase_apr':     getattr(a, 'liability_purchase_apr', None),
        'product_id':                 getattr(a, 'product_id', None),
    }


def get_account_balance(db: Session, account_id: int, as_of_date: datetime = None) -> float:
    """
    Compute account balance at a given date (or now if not specified).

    Uses the same anchor model as get_daily_balances() to ensure consistency:
      anchor_balance + SUM(transactions from anchor_date through as_of_date)

    Anchor model (start_date is set):
      starting_balance = Plaid balance AT start_date (end of that day).
      Transactions AFTER start_date are accumulated forward.

    Legacy model (start_date is None):
      starting_balance is a pre-all-transactions offset.
      ALL transactions are accumulated forward.

    NOTE: Monthly snapshots are used for charting and historical analysis only.
    Balance Observations are used for RECONCILIATION MONITORING only.
    """
    from sqlalchemy import func as _func

    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        return 0.0

    anchor = account.starting_balance or 0.0
    anchor_dt = account.start_date

    if anchor_dt is None:
        # Legacy: starting_balance = pre-all-transactions offset
        q = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account_id,
        )
        if as_of_date:
            q = q.filter(Transaction.date <= as_of_date)
        return round(anchor + (q.scalar() or 0.0), 2)

    # Anchor model: starting_balance = Plaid balance at end of start_date
    anchor_eod = datetime.combine(anchor_dt.date() if hasattr(anchor_dt, 'date') else anchor_dt,
                                   datetime.max.time())
    as_of_cmp = as_of_date if as_of_date else datetime.utcnow()

    if as_of_cmp >= anchor_eod:
        # Normal: accumulate transactions after anchor through as_of
        q = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account_id,
            Transaction.date > anchor_eod,
        )
        if as_of_date:
            q = q.filter(Transaction.date <= as_of_date)
        return round(anchor + (q.scalar() or 0.0), 2)
    else:
        # as_of is before anchor: walk backward
        q = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account_id,
            Transaction.date > as_of_date,
            Transaction.date <= anchor_eod,
        )
        return round(anchor - (q.scalar() or 0.0), 2)


# ---------------------------------------------------------------------------
# Balance snapshot helpers (Section 0B)
# ---------------------------------------------------------------------------

def _sign_plaid_balance(raw: Optional[float], account_type_str: str) -> Optional[float]:
    """Apply sign convention: credit/loan balances stored as negative (Plaid reports amount-owed as positive)."""
    if raw is None:
        return None
    t = (account_type_str or '').lower().strip()
    # Match both Plaid type ("credit") and stored subtype ("credit card")
    return -raw if t.startswith('credit') or t in ('loan',) else raw


def _plaid_anchor_date(account_type_str: str) -> datetime:
    """
    Return the effective anchor date for a Plaid balance snapshot.

    Plaid's `current` balance lags behind real-time:
      - Checking/Savings: typically 1-2 business days lag
      - Credit cards/Loans: typically near real-time (same-day)

    Instead of using datetime.utcnow() (which creates a gap where recent
    transactions fall BEFORE the anchor and never get counted), we step
    back to account for the lag, anchoring at end-of-day.
    """
    from datetime import timedelta, time as _time
    t = (account_type_str or '').lower().strip()
    is_liability = t.startswith('credit') or t in ('loan',)
    lag_days = 0 if is_liability else 2
    effective = datetime.utcnow() - timedelta(days=lag_days)
    return datetime.combine(effective.date(), _time(23, 59, 59))


def rebuild_monthly_snapshots(db: Session, account_id: int) -> int:
    """
    Full rebuild of monthly opening/closing snapshots for one account.
    Uses account.starting_balance as the baseline before the earliest transaction.
    Returns the number of months built.
    """
    from collections import defaultdict
    from sqlalchemy import func as _func
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        return 0
    txns = db.query(Transaction).filter(
        Transaction.account_id == account_id,
    ).order_by(Transaction.date).all()
    if not txns:
        return 0
    by_month: dict = defaultdict(float)
    for t in txns:
        by_month[(t.date.year, t.date.month)] += t.amount
    db.query(AccountMonthlySnapshot).filter_by(account_id=account_id).delete(synchronize_session=False)

    if account.start_date:
        # Anchor model: starting_balance = Plaid balance AT start_date.
        pre_anchor_sum = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account_id,
            Transaction.date <= account.start_date,
        ).scalar() or 0.0
        running = round((account.starting_balance or 0.0) - pre_anchor_sum, 4)
    else:
        # Legacy: starting_balance is already the pre-all-transactions offset
        running = account.starting_balance or 0.0
    sorted_months = sorted(by_month.keys())
    for (year, month) in sorted_months:
        opening = running
        closing = round(running + by_month[(year, month)], 2)
        db.add(AccountMonthlySnapshot(
            account_id=account_id,
            year=year,
            month=month,
            opening_balance=round(opening, 2),
            closing_balance=closing,
        ))
        running = closing
    return len(sorted_months)


def _refresh_current_month_snapshot(db: Session, account_id: int) -> None:
    """
    Lightweight post-sync update: recalculate only the current month's closing_balance.
    Creates the current-month snapshot if it doesn't exist yet (month rollover handled).
    Does NOT commit — caller is responsible for committing.
    """
    from sqlalchemy import func as _func
    now = datetime.utcnow()
    year, month = now.year, now.month
    snapshot = db.query(AccountMonthlySnapshot).filter_by(
        account_id=account_id, year=year, month=month
    ).first()
    if snapshot is None:
        prev_m, prev_y = (month - 1, year) if month > 1 else (12, year - 1)
        prev = db.query(AccountMonthlySnapshot).filter_by(
            account_id=account_id, year=prev_y, month=prev_m
        ).first()
        if prev is None:
            return  # No snapshot base yet — Balance Sync hasn't been run
        snapshot = AccountMonthlySnapshot(
            account_id=account_id, year=year, month=month,
            opening_balance=round(prev.closing_balance, 2),
            closing_balance=round(prev.closing_balance, 2),
        )
        db.add(snapshot)
    # ALL transactions — must match the filter used when starting_balance was anchored.
    month_sum = db.query(_func.sum(Transaction.amount)).filter(
        Transaction.account_id == account_id,
        Transaction.year == year,
        Transaction.month == month,
    ).scalar() or 0.0
    snapshot.closing_balance = round(snapshot.opening_balance + month_sum, 2)
    snapshot.synced_at = datetime.utcnow()


# ---------------------------------------------------------------------------
# Transaction Type System (Section 2A)
# ---------------------------------------------------------------------------

# The 8 canonical transaction types
TRANSACTION_TYPES = [
    'Expense', 'Income', 'Transfer',
    'Investment Gain (Loss)', 'Purchase', 'Sale',
    'Depreciation', 'Other',
]

# Types that count toward budget actuals
BUDGET_TYPES = {'Expense', 'Income'}

# Types that affect account balances / net worth
BALANCE_TYPES = {
    'Expense', 'Income', 'Transfer',
    'Investment Gain (Loss)', 'Purchase', 'Sale',
    'Depreciation', 'Other',
}

# ---------------------------------------------------------------------------
# App + DB init
# ---------------------------------------------------------------------------

engine, SessionLocal = init_db()

app = FastAPI(title="Finance Automation API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Simple password gate (set APP_PASSWORD env var to enable)
# ---------------------------------------------------------------------------

APP_PASSWORD = os.getenv("APP_PASSWORD", "")

_PUBLIC_PATHS = {"/health", "/api/auth/login", "/api/auth/check"}


class PasswordMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not APP_PASSWORD:
            return await call_next(request)
        path = request.url.path
        if path in _PUBLIC_PATHS:
            return await call_next(request)
        token = request.cookies.get("fin_auth") or request.query_params.get("token")
        if token != APP_PASSWORD:
            if path.startswith("/api/"):
                return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
            return HTMLResponse(_login_page(), status_code=401)
        return await call_next(request)


if APP_PASSWORD:
    app.add_middleware(PasswordMiddleware)


def _login_page():
    return """<!DOCTYPE html><html><head><title>Login</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}
.box{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}
input{padding:.5rem;font-size:1rem;border:1px solid #ddd;border-radius:4px;margin:.5rem 0}
button{padding:.5rem 1.5rem;font-size:1rem;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer}
.err{color:red;font-size:.85rem;display:none}</style></head>
<body><div class="box"><h2>Finance Automation</h2>
<form onsubmit="return go(event)"><input id="pw" type="password" placeholder="Password" autofocus>
<br><button type="submit">Login</button><p class="err" id="err">Wrong password</p></form>
<script>async function go(e){e.preventDefault();const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});if(r.ok){location.reload()}else{document.getElementById('err').style.display='block'}}</script>
</div></body></html>"""


@app.post("/api/auth/login")
async def auth_login(data: dict):
    pw = data.get("password", "")
    if not APP_PASSWORD or pw != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password")
    resp = JSONResponse({"ok": True})
    resp.set_cookie("fin_auth", APP_PASSWORD, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30)
    return resp


@app.get("/api/auth/check")
async def auth_check(request: Request):
    if not APP_PASSWORD:
        return {"authenticated": True}
    token = request.cookies.get("fin_auth")
    return {"authenticated": token == APP_PASSWORD}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TransactionResponse(BaseModel):
    """Standard response shape for transaction list/detail endpoints."""
    id: int
    date: datetime
    description_raw: str
    description_clean: Optional[str] = None
    description_display: Optional[str] = None   # computed best display name
    merchant_name: Optional[str] = None
    amount: float
    action: str
    action_display: Optional[str] = None
    category_auto: Optional[str] = None
    category_manual: Optional[str] = None
    category_final: str
    category_confidence: Optional[float] = None
    needs_review: bool
    is_locked: bool
    is_gcb: bool = False
    is_split: bool = False
    is_excluded: bool = False
    points_category: Optional[str] = None
    # Points earn summary — None when card/product is unknown or txn isn't an expense
    points_earn: Optional[dict] = None
    account_name: str
    account_id: int = 0
    account_type: Optional[str] = None
    enrichment_source: Optional[str] = None
    import_source: Optional[str] = None
    splits: Optional[list] = None

    class Config:
        from_attributes = True


class TransactionUpdate(BaseModel):
    """Fields that can be patched on a transaction."""
    category: Optional[str] = None
    action: Optional[str] = None
    needs_review: Optional[bool] = None
    is_locked: Optional[bool] = None
    is_gcb: Optional[bool] = None
    is_excluded: Optional[bool] = None
    points_category: Optional[str] = None
    description_clean: Optional[str] = None


class BatchTransactionUpdate(BaseModel):
    """Batch-update payload: a list of IDs and the fields to set on all of them."""
    ids: List[int]
    updates: TransactionUpdate


class SplitCreate(BaseModel):
    """A single split line item."""
    amount: float
    description: Optional[str] = None
    category: Optional[str] = None
    action: Optional[str] = None  # Type per split line (Section 4F)
    is_gcb: bool = False
    notes: Optional[str] = None


class SplitsRequest(BaseModel):
    """Request body for creating splits on a transaction (Section 3a)."""
    splits: List[SplitCreate]


class LinkTokenResponse(BaseModel):
    link_token: str


class PublicTokenExchange(BaseModel):
    public_token: str


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


class AccountCreate(BaseModel):
    """Request body for creating a manual account (Section 2b)."""
    name: str
    account_type: str  # checking, savings, credit, investment, loan, real_estate, vehicle, etc.
    starting_balance: float = 0.0
    start_date: str  # YYYY-MM-DD
    notes: Optional[str] = None


class ManualSplitItem(BaseModel):
    """A single split row for a manual transaction."""
    amount: float
    description: Optional[str] = None
    category: Optional[str] = None
    action: Optional[str] = None
    is_gcb: bool = False


class ManualTransactionCreate(BaseModel):
    """Request body for manual value-change transactions (Section 2c)."""
    account_id: int
    date: Optional[str] = None  # YYYY-MM-DD (single date — legacy)
    dates: Optional[List[str]] = None  # YYYY-MM-DD list (multi-date)
    amount: float  # Caller is responsible for sign (positive or negative)
    description: str
    action: str = "Other"  # Purchase, Sale, Unrealized Gain/Loss, Transfer, Depreciation, Other
    category: Optional[str] = None  # Category for unsplit transactions
    splits: Optional[List[ManualSplitItem]] = None  # Optional split rows


class BudgetTargetCreate(BaseModel):
    """Request body for a single budget target (Section 4)."""
    year: int
    month: int  # 1-12
    category: str
    amount: float


class BudgetTargetBulk(BaseModel):
    """Request body for bulk budget target upsert (Section 4)."""
    targets: List[BudgetTargetCreate]


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    session = SessionLocal()
    try:
        seed_categories(session)
        seed_points_categories(session)

        rule_count = session.query(CategorizationRule).count()
        if rule_count == 0:
            here = os.path.dirname(os.path.abspath(__file__))
            for fname in ["i_e_v9_2_2026.xlsx", "finance_data.xlsx"]:
                excel_path = os.path.join(here, fname)
                if os.path.exists(excel_path):
                    n = load_rules_from_excel(excel_path, session)
                    print(f"Auto-loaded {n} rules from {fname}")
                    break
            else:
                print("No Excel file found — run /api/init/import-rules manually")
        else:
            print(f"Rules loaded: {rule_count} active rules")

        # Seed points ecosystems and card products
        try:
            seed_points_ecosystems(session)
            print("Ecosystems seeded OK")
        except Exception as eco_err:
            session.rollback()
            print(f"WARNING: seed_points_ecosystems failed: {eco_err}")
        try:
            seed_card_products(session)
            print("Card products seeded OK")
        except Exception as prod_err:
            session.rollback()
            print(f"WARNING: seed_card_products failed: {prod_err}")
            import traceback
            traceback.print_exc()

        # Product catalog is seeded by seed_card_products() above — no Excel import needed

        # One-time fix: correct balance observations for credit/loan accounts
        # where plaid_balance was stored with wrong sign (positive instead of negative).
        # Use _sign_plaid_balance to determine which accounts are liability-type.
        _all_accts = session.query(Account).all()
        _liability_ids = [a.id for a in _all_accts if _sign_plaid_balance(1.0, a.account_type or '') == -1.0]
        _fixed = 0
        if _liability_ids:
            _bad_obs = session.query(BalanceObservation).filter(
                BalanceObservation.account_id.in_(_liability_ids),
                BalanceObservation.plaid_balance > 0,
            ).all()
            for _ob in _bad_obs:
                _ob.plaid_balance = -abs(_ob.plaid_balance)
                _ob.delta = round(_ob.plaid_balance - (_ob.computed_balance or 0), 2)
                _fixed += 1
        if _fixed:
            session.commit()
            print(f"Fixed {_fixed} balance observations with wrong sign for credit/loan accounts")

        print("Database initialized")
        client_id = os.getenv("PLAID_CLIENT_ID")
        plaid_env = os.getenv("PLAID_ENV")
        if client_id:
            print(f"Plaid credentials loaded: {client_id[:8]}... ({plaid_env})")
        else:
            print("WARNING: PLAID_CLIENT_ID not found — check your .env file")
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

@app.get("/")
async def serve_frontend():
    here = os.path.dirname(os.path.abspath(__file__))
    return FileResponse(os.path.join(here, "frontend.html"), media_type="text/html")

# ✅ Step 7: OAuth redirect landing route (serve the same frontend)
@app.get("/plaid/oauth-return")
async def plaid_oauth_return():
    here = os.path.dirname(os.path.abspath(__file__))
    return FileResponse(os.path.join(here, "frontend.html"), media_type="text/html")

# ---------------------------------------------------------------------------
# Plaid: link token
# ---------------------------------------------------------------------------

@app.get("/api/plaid/link-token", response_model=LinkTokenResponse)
async def create_link_token(request: Request, user_id: str = "default_user"):
    try:
        plaid = setup_plaid_from_env()
        # Build OAuth redirect URI from the incoming request so it works on
        # any deployment (localhost, Railway, custom domain, etc.)
        base_url = os.getenv("PLAID_REDIRECT_URI")
        if not base_url:
            scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
            host = request.headers.get("host", request.url.netloc)
            base_url = f"{scheme}://{host}/plaid/oauth-return"
        return {"link_token": plaid.create_link_token(user_id, redirect_uri=base_url)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/plaid/update-link-token/{item_id}")
async def create_update_link_token(item_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Create a Plaid Link token in *update mode* for an existing item.
    Used when an item has ITEM_LOGIN_REQUIRED — re-authenticates the same
    item in-place without changing the access_token or item_id.
    """
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        plaid_client = setup_plaid_from_env()
        base_url = os.getenv("PLAID_REDIRECT_URI")
        if not base_url:
            scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
            host = request.headers.get("host", request.url.netloc)
            base_url = f"{scheme}://{host}/plaid/oauth-return"
        access_token = item.access_token
        link_token = plaid_client.create_link_token(
            "default_user", redirect_uri=base_url, access_token=access_token
        )
        return {"link_token": link_token, "item_id": item_id,
                "institution_name": item.institution_name}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/plaid/update-complete/{item_id}")
async def plaid_update_complete(item_id: str, background_tasks: BackgroundTasks,
                                db: Session = Depends(get_db)):
    """
    Called after a successful Plaid Link update-mode flow.
    Clears the stored error, marks the item healthy, and kicks off a fresh sync.
    No public_token exchange is needed — the access_token is unchanged.
    """
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.last_error_code    = None
    item.last_error_message = None
    item.last_error_at      = None
    db.commit()
    background_tasks.add_task(_sync_item_background, item_id, False)
    return {"message": f"{item.institution_name} reconnected — sync started",
            "institution_name": item.institution_name}


# ---------------------------------------------------------------------------
# Plaid: exchange token
# ---------------------------------------------------------------------------

@app.post("/api/plaid/exchange-token")
async def exchange_public_token(data: PublicTokenExchange, db: Session = Depends(get_db)):
    """Exchange a Plaid public token for access token, create accounts, and sync transactions."""
    try:
        plaid        = setup_plaid_from_env()
        tokens       = plaid.exchange_public_token(data.public_token)
        access_token = tokens['access_token']
        item_id      = tokens['item_id']
        accounts     = plaid.get_accounts(access_token)

        # Create or update PlaidItem
        # Fetch institution info once — name (display) + institution_id (immutable, used for matching)
        inst_info = plaid.get_institution_info(access_token) or {}
        inst_name = inst_info.get('name') or (accounts[0]['name'].split(' ')[0] if accounts else 'Unknown')
        inst_id   = inst_info.get('institution_id')

        plaid_item = db.query(PlaidItem).filter_by(item_id=item_id).first()
        if plaid_item:
            plaid_item.access_token = access_token
            plaid_item.is_active    = True
            plaid_item.updated_at   = datetime.utcnow()
            # Always refresh canonical institution name and id from Plaid
            plaid_item.institution_name = inst_name
            if inst_id:
                plaid_item.institution_id = inst_id
        else:
            plaid_item = PlaidItem(
                item_id=item_id,
                institution_name=inst_name,
                institution_id=inst_id,
                is_active=True,
            )
            plaid_item.access_token = access_token
            db.add(plaid_item)

        db.flush()

        # ---------------------------------------------------------------------------
        # Account adoption — 4-step priority chain (most-reliable → least)
        #
        #  Step 1: persistent_account_id — stable across ALL re-links (Plaid-issued)
        #  Step 2: plaid_account_id      — same connection token reused (no re-link)
        #  Step 3: institution+mask+type — fallback for institutions without persistent IDs
        #  Step 4: no match             — create new account
        #
        # On adoption (steps 1-3): write plaid_account_id, plaid_item_id, persistent_account_id
        # and clear any stale holder of the same plaid_account_id first (UNIQUE safety).
        # ---------------------------------------------------------------------------
        account_results = []

        for a in accounts:
            # Prefer subtype (checking, savings, credit card) over type (depository, credit)
            raw_subtype  = (a.get('subtype') or '').lower().strip()
            raw_type     = (a.get('type') or '').lower().strip()
            account_type = raw_subtype or PLAID_TYPE_FALLBACK.get(raw_type, raw_type) or 'other'

            # Pre-compute the account_hash for this Plaid account using the
            # FRESH institution_id from Plaid (always reliable at exchange time).
            computed_hash = _account_hash(inst_id or '', a.get('mask') or '', account_type)

            existing = None

            # Step 1: match by persistent_account_id (survives every re-link, Plaid-issued)
            if a.get('persistent_account_id'):
                existing = (db.query(Account)
                    .filter(Account.persistent_account_id == a['persistent_account_id'],
                            Account.is_active == True)
                    .order_by(Account.id)
                    .first())

            # Step 2: match by current plaid_account_id (same token, no re-link needed)
            if not existing:
                existing = db.query(Account).filter_by(plaid_account_id=a['account_id']).first()

            # Step 2.5: match by account_hash — the primary re-link survivor key.
            # CRITICAL: only match UNLINKED accounts (plaid_account_id IS NULL).
            # If we matched a live account, we'd overwrite its Plaid ID, stealing
            # it from the account it belongs to. This is what caused the Amex 1008
            # collision: three cards share the same hash, so without this guard the
            # second and third would clobber the first.
            if not existing and inst_id and a.get('mask'):
                existing = (db.query(Account)
                    .filter(Account.account_hash == computed_hash,
                            Account.is_active == True,
                            Account.plaid_account_id == None)   # unlinked only
                    .order_by(Account.id)
                    .first())

            # Step 3: institution+mask+type JOIN — fallback for pre-hash accounts.
            # Same guard: only unlinked accounts are candidates.
            if not existing and a.get('mask'):
                base_filters = [
                    Account.mask == a['mask'],
                    Account.account_type == account_type,
                    Account.is_active == True,
                    Account.plaid_account_id == None,   # unlinked only
                ]
                if plaid_item.institution_id:
                    inst_match = or_(
                        PlaidItem.institution_id == plaid_item.institution_id,
                        and_(
                            Account.plaid_item_id == None,
                            Account.institution_id == plaid_item.institution_id,
                        ),
                    )
                else:
                    inst_match = or_(
                        PlaidItem.institution_name == plaid_item.institution_name,
                        Account.plaid_item_id == None,
                    )
                existing = (db.query(Account)
                    .outerjoin(PlaidItem, Account.plaid_item_id == PlaidItem.item_id)
                    .filter(*base_filters, inst_match)
                    .order_by(Account.id)
                    .first())

            if existing:
                # UNIQUE safety: clear any OTHER row that already holds this plaid_account_id
                db.query(Account).filter(
                    Account.plaid_account_id == a['account_id'],
                    Account.id != existing.id,
                ).update({'plaid_account_id': None}, synchronize_session=False)
                db.flush()

                # Adopt: update Plaid IDs so future transactions flow to the right account
                existing.plaid_account_id = a['account_id']
                existing.plaid_item_id    = item_id
                existing.is_active        = True
                if a.get('persistent_account_id'):
                    existing.persistent_account_id = a['persistent_account_id']
                if plaid_item.institution_id:
                    existing.institution_id = plaid_item.institution_id
                # Always refresh the account_hash — keeps it current
                existing.account_hash = computed_hash

                account_results.append({
                    "name": existing.account_name,
                    "mask": existing.mask,
                    "status": "matched",
                    "account_id": existing.id,
                })
            else:
                # Step 4: create new account
                # Use Plaid's current balance as the anchor so the balance engine
                # can compute accurate history immediately without a manual snapshot.
                plaid_balance = _sign_plaid_balance(a.get('balance'), raw_type)
                new_acct = Account(
                    plaid_account_id=a['account_id'],
                    persistent_account_id=a.get('persistent_account_id'),
                    institution_id=inst_id,
                    account_hash=computed_hash,
                    plaid_item_id=item_id,
                    account_name=f"{a['name']} {a.get('mask','')}".strip(),
                    account_type=account_type,
                    official_name=a.get('official_name'),
                    mask=a.get('mask'),
                    is_active=True,
                    starting_balance=plaid_balance or 0,
                    start_date=None,  # Legacy model: offset + all txns
                )
                db.add(new_acct)
                db.flush()

                account_results.append({
                    "name": new_acct.account_name,
                    "mask": new_acct.mask,
                    "status": "created",
                    "account_id": new_acct.id,
                })

        # Commit accounts first so sync failures don't lose the account link
        db.commit()

        # Sync transactions (separate step — errors here won't rollback accounts)
        synced = 0
        sync_error = None
        try:
            synced = await _sync_item(plaid_item, plaid, db)
        except Exception as sync_exc:
            import traceback; traceback.print_exc()
            sync_error = str(sync_exc)

        # Rebuild monthly snapshots for every account on this item so the
        # balance engine has accurate month-by-month history immediately.
        snapshot_errors = []
        for acct in db.query(Account).filter_by(plaid_item_id=item_id, is_active=True).all():
            try:
                rebuild_monthly_snapshots(db, acct.id)
            except Exception as snap_exc:
                snapshot_errors.append(f"acct {acct.id}: {snap_exc}")
        try:
            db.commit()
        except Exception:
            db.rollback()
        if snapshot_errors:
            print(f"[exchange-token] snapshot rebuild warnings: {snapshot_errors}")

        msg = f"Linked {len(accounts)} account(s) and synced {synced} transaction(s)"
        if sync_error:
            msg += f" (sync warning: {sync_error})"

        return {
            "message": msg,
            "item_id": item_id,
            "accounts": account_results,        # per-account outcome for post-link modal
            "accounts_linked": len(accounts),   # kept for backward compat
            "transactions_synced": synced,
        }

    except Exception as e:
        import traceback; traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Sync helper
# ---------------------------------------------------------------------------

async def _sync_item(plaid_item: PlaidItem, plaid, db: Session) -> int:
    """Sync transactions for a single PlaidItem. Returns count of new transactions added."""
    categorizer = CategorizationEngine(db)
    total_added = 0

    # Pass None if cursor is empty/missing — Plaid requires None for initial sync
    cursor = plaid_item.cursor if plaid_item.cursor else None
    # Run blocking Plaid I/O in a thread pool so the uvicorn event loop
    # stays responsive — without this, Gunicorn kills the worker after 30s.
    result = await asyncio.to_thread(
        plaid.sync_transactions,
        plaid_item.access_token,
        cursor,
    )

    # Pre-load rules with notes for GCB/points tagging
    rules_with_notes = db.query(CategorizationRule).filter(
        CategorizationRule.is_active == True,
        CategorizationRule.notes != None,
        CategorizationRule.notes != '',
    ).all()

    skipped = 0
    errors  = 0
    # Track DB row IDs matched via content_hash this sync so each row is
    # only adopted once (handles multiple identical transactions on the same day).
    content_matched_ids: set = set()

    for txn_data in result['added']:
        sp = db.begin_nested()  # savepoint — so a single-row failure only rolls back that row
        try:
            existing = db.query(Transaction).filter_by(
                plaid_transaction_id=txn_data['plaid_transaction_id']
            ).first()
            if existing:
                if not existing.is_locked:
                    existing.merchant_name = txn_data.get('merchant_name') or existing.merchant_name
                # If Plaid previously removed this txn and we soft-deleted it,
                # re-enable it now that Plaid is re-sending it as "added".
                if existing.is_excluded:
                    existing.is_excluded  = False
                    existing.needs_review = False
                # Backfill content_hash if this row predates the feature
                if not existing.content_hash:
                    existing.content_hash = _assign_content_hash(
                        db, existing.account_id, existing.date,
                        existing.amount, existing.description_raw
                    )
                # CRITICAL: always close the savepoint before continue.
                # Without this, every iteration leaks a nested SQLAlchemy
                # subtransaction. After thousands of iterations (Chase full
                # re-download) db.commit() recurses 1000+ frames → RecursionError.
                sp.commit()
                continue

            # Skip pending transactions (holds/authorizations not yet posted) — they distort balances
            if txn_data.get('pending'):
                sp.rollback()
                skipped += 1
                continue

            account = db.query(Account).filter_by(
                plaid_account_id=txn_data['plaid_account_id']
            ).first()
            if not account:
                print(f"[sync] skipping txn — no account for plaid_account_id={txn_data['plaid_account_id']}")
                skipped += 1
                sp.rollback()  # close savepoint before continue (nothing to keep)
                continue

            # ── Content-hash fallback (re-link survivor) ──────────────────────
            # plaid_transaction_id didn't match — Plaid regenerated IDs (re-link).
            # Try to find the existing row by content hash so we preserve all
            # user work (category, notes, locks) and just adopt the new Plaid ID.
            txn_amount  = -txn_data['amount']
            txn_date    = txn_data['date']
            base_hash   = _content_base_hash(account.id, txn_date, txn_amount, txn_data['description_raw'])
            # Avoid SQLAlchemy's notin_() with a large set — it builds a recursive
            # Python expression tree that exceeds Python's recursion limit (~1000)
            # when content_matched_ids grows large (e.g. Chase full-history re-download).
            # Instead: fetch all rows sharing this base hash (typically 0-3 rows)
            # and exclude already-matched IDs in Python.
            hash_candidates = (
                db.query(Transaction)
                .filter(Transaction.content_hash.like(f'{base_hash}-%'))
                .order_by(Transaction.content_hash)  # lowest suffix first → stable ordering
                .all()
            )
            hash_match = next(
                (r for r in hash_candidates if r.id not in content_matched_ids),
                None,
            )
            if hash_match:
                # Adopt the new Plaid ID — all user classifications are preserved
                hash_match.plaid_transaction_id = txn_data['plaid_transaction_id']
                content_matched_ids.add(hash_match.id)
                print(f"[sync] content-hash match: adopted new plaid_id for '{hash_match.description_raw[:40]}'")
                sp.commit()
                continue  # do NOT insert a duplicate row

            # Resolve card_id from account→card FK (set via match-accounts flow)
            linked_card_id = account.card.id if account.card else None

            # Normalize sign: Plaid sends expenses as positive, we store as negative
            amount = -txn_data['amount']

            action, category, confidence, display_desc = categorizer.categorize(
                txn_data['description_raw'],
                amount,
                txn_data.get('merchant_name'),
                account_type=account.account_type or '',
            )

            # If action=Transfer was determined via a user-correction override
            # (not a built-in rule), lock the new transaction immediately so
            # future recategorisation runs and /apply-rules don't revert it.
            _correction_locked = False
            if action == 'Transfer':
                _m = txn_data.get('merchant_name') or categorizer.extract_merchant(txn_data['description_raw'])
                if _m and categorizer._check_transfer_correction(
                    _m, categorizer.clean_description(txn_data['description_raw'])
                ):
                    _correction_locked = True

            # Apply GCB auto-tag and points category from rule notes
            desc_upper = txn_data['description_raw'].upper()
            gcb_auto   = False
            points_cat = None
            for rule in rules_with_notes:
                if rule.pattern and rule.pattern.upper() in desc_upper:
                    if 'gcb:true' in rule.notes:
                        gcb_auto = True
                    if 'points:' in rule.notes:
                        points_cat = rule.notes.split('points:')[1].split(',')[0].strip()

            # Auto-infer points category from merchant name + Plaid PFC when
            # no categorization rule provided one explicitly.
            if not points_cat:
                points_cat = infer_points_category(
                    txn_data.get('merchant_name'),
                    txn_data.get('pfc_detailed'),
                    txn_data.get('pfc_primary'),
                )

            txn_date = txn_data['date']

            # ── Plaid PFC fallback: when rules leave category as Unclassified ────
            # personal_finance_category is Plaid's deterministic hierarchical taxonomy.
            # Only trust it when Plaid reports HIGH or VERY_HIGH confidence.
            pfc_applied = False
            if category == 'Unclassified':
                _pfc_primary = txn_data.get('pfc_primary')
                _pfc_conf    = txn_data.get('pfc_confidence', '')
                if _pfc_primary and _pfc_conf in ('VERY_HIGH', 'HIGH'):
                    _pfc_result = _PLAID_PFC_MAP.get(_pfc_primary)
                    if _pfc_result:
                        category   = _pfc_result[0]
                        action     = _pfc_result[1]
                        confidence = 0.72   # trustworthy but below a matched rule (0.85)
                        pfc_applied = True

            # ── Auto-LLM when no rule produced a useful result ───────────────────
            llm_source = None
            llm_description_clean = display_desc or categorizer.clean_description(txn_data['description_raw'])
            llm_merchant = txn_data.get('merchant_name')
            llm_category = '' if action == 'Transfer' else category

            # Skip LLM during background sync — each Claude call is 1-3s synchronous HTTP,
            # so 100 transactions × 2s = 3+ minutes, which kills the Gunicorn worker.
            # Transactions flagged needs_review=True will surface in the review queue
            # where the user (or a dedicated enrichment job) can enrich them on-demand.
            needs_llm = False

            if llm_source:
                final_source = llm_source
            elif pfc_applied:
                final_source = 'plaid_pfc'
            elif display_desc or (category and category != 'Unclassified'):
                final_source = 'rule'
            else:
                final_source = 'fallback'

            if action == 'Transfer':
                needs_review_flag = False
            elif final_source in ('llm', 'fallback', 'override'):
                needs_review_flag = True
            else:
                needs_review_flag = confidence < 0.85

            db.add(Transaction(
                plaid_transaction_id=txn_data['plaid_transaction_id'],
                account_id=account.id,
                date=txn_date,
                amount=amount,
                description_raw=txn_data['description_raw'],
                description_clean=llm_description_clean,
                merchant_name=llm_merchant,
                action=action,
                category_auto=llm_category,
                category_confidence=confidence,
                needs_review=needs_review_flag,
                enrichment_source=final_source,
                card_id=linked_card_id,
                gcb_tagged=gcb_auto,
                points_category=points_cat,
                is_locked=_correction_locked,
                content_hash=_assign_content_hash(db, account.id, txn_date, amount, txn_data['description_raw']),
                year=txn_date.year,
                month=txn_date.month,
                day=txn_date.day,
            ))
            db.flush()   # catch constraint errors per-transaction, not at batch commit
            sp.commit()  # release savepoint — this row is now safe in the outer transaction
            total_added += 1

        except Exception as txn_err:
            sp.rollback()  # roll back only THIS row — previously flushed rows are unaffected
            errors += 1
            print(f"[sync] failed txn {txn_data.get('plaid_transaction_id','?')}: {txn_err}")

    if skipped:
        print(f"[sync] {plaid_item.institution_name}: {skipped} transaction(s) skipped — no matching account")
    if errors:
        print(f"[sync] {plaid_item.institution_name}: {errors} transaction(s) failed to write")

    # ── Handle modified transactions ─────────────────────────────────────────
    # Plaid sends updated metadata (date shift, merchant enrichment, amount
    # correction) in the 'modified' list.  We update unlocked transactions only —
    # locked ones represent a manual override that should be preserved.
    modified_count = 0
    modified_errors = 0
    for txn_data in result.get('modified', []):
        try:
            existing = db.query(Transaction).filter_by(
                plaid_transaction_id=txn_data['plaid_transaction_id']
            ).first()
            if not existing or existing.is_locked:
                continue
            new_amount = -txn_data['amount']
            new_date   = txn_data['date']
            existing.date          = new_date
            existing.year          = new_date.year
            existing.month         = new_date.month
            existing.day           = new_date.day
            existing.amount        = new_amount
            existing.merchant_name = txn_data.get('merchant_name') or existing.merchant_name
            modified_count += 1
        except Exception as mod_err:
            modified_errors += 1
            print(f"[sync] {plaid_item.institution_name}: failed to apply modified txn {txn_data.get('plaid_transaction_id','?')}: {mod_err}")
    if modified_count:
        print(f"[sync] {plaid_item.institution_name}: {modified_count} transaction(s) updated (Plaid modified)")
    if modified_errors:
        print(f"[sync] {plaid_item.institution_name}: {modified_errors} modified transaction(s) failed")

    # ── Handle removed transactions ───────────────────────────────────────────
    # Plaid removes a transaction when: a date/ID changes on settlement, a
    # pending txn is cancelled, or bank data is corrected.  Since we never
    # import pending transactions, every txn in our DB is already posted.
    # Hard-deleting posted transactions is too aggressive — Plaid often removes
    # a settled txn and re-adds it with a new ID when the date is adjusted.
    # Instead we SOFT-DELETE (is_excluded=True + flag in description_clean) so
    # the user can see and recover them.  Locked transactions are never touched.
    removed_count  = 0
    removed_errors = 0
    locked_skipped = 0
    for plaid_id in result.get('removed', []):
        try:
            existing = db.query(Transaction).filter_by(plaid_transaction_id=plaid_id).first()
            if not existing:
                continue
            if existing.is_locked:
                locked_skipped += 1
                print(f"[sync] skipping removal of locked txn {plaid_id} — user manually confirmed")
                continue
            # Soft-delete: exclude from all views but keep the row in the DB
            existing.is_excluded = True
            existing.needs_review = False
            note = " [removed by Plaid — may reappear with a new ID]"
            if existing.description_clean and note not in existing.description_clean:
                existing.description_clean = existing.description_clean + note
            removed_count += 1
            print(f"[sync] soft-deleted txn {plaid_id} ({existing.description_raw}) — excluded, not hard-deleted")
        except Exception as rem_err:
            removed_errors += 1
            print(f"[sync] {plaid_item.institution_name}: failed to process removed txn {plaid_id}: {rem_err}")
    if removed_count:
        print(f"[sync] {plaid_item.institution_name}: {removed_count} transaction(s) soft-deleted (Plaid removed)")
    if removed_errors:
        print(f"[sync] {plaid_item.institution_name}: {removed_errors} removed transaction(s) failed")
    if locked_skipped:
        print(f"[sync] {plaid_item.institution_name}: {locked_skipped} locked transaction(s) NOT removed — review manually")

    # Store cursor — use None instead of empty string for clean state
    plaid_item.cursor         = result['next_cursor'] or None
    plaid_item.last_synced_at = datetime.utcnow()
    try:
        db.commit()
    except Exception as commit_err:
        # Commit failed — this is the exception that will propagate to
        # _sync_item_background's except-handler and be stored on the item.
        print(f"[sync] {plaid_item.institution_name}: final commit failed: {commit_err}")
        db.rollback()
        raise
    return total_added


# ---------------------------------------------------------------------------
# Plaid: background sync helper + sync endpoints
# ---------------------------------------------------------------------------

async def _sync_item_background(item_id: str, clear_cursor: bool = False):
    """Run a sync for a single item in the background with its own DB session."""
    db = SessionLocal()
    try:
        plaid = setup_plaid_from_env()
        item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
        if not item:
            return
        if clear_cursor:
            # Re-fetch accounts from Plaid so nothing gets silently skipped
            try:
                accounts = plaid.get_accounts(item.access_token)
                for a in accounts:
                    raw_subtype  = (a.get('subtype') or '').lower().strip()
                    raw_type     = (a.get('type') or '').lower().strip()
                    account_type = raw_subtype or PLAID_TYPE_FALLBACK.get(raw_type, raw_type) or 'other'

                    existing = db.query(Account).filter_by(plaid_account_id=a['account_id']).first()

                    # Fallback dedup for re-linked institutions
                    if not existing and a.get('mask'):
                        existing = (db.query(Account)
                            .join(PlaidItem, Account.plaid_item_id == PlaidItem.item_id)
                            .filter(
                                Account.mask == a['mask'],
                                Account.account_type == account_type,
                                PlaidItem.institution_name == item.institution_name,
                            ).first())

                    if existing:
                        existing.plaid_account_id = a['account_id']
                        existing.plaid_item_id    = item_id
                        existing.is_active        = True
                    else:
                        db.add(Account(
                            plaid_account_id=a['account_id'],
                            plaid_item_id=item_id,
                            account_name=f"{a['name']} {a.get('mask','') or ''}".strip(),
                            account_type=account_type,
                            official_name=a.get('official_name'),
                            mask=a.get('mask'),
                            is_active=True,
                        ))
                db.commit()
                print(f"[sync] {item.institution_name}: {len(accounts)} account(s) reconciled")
            except Exception as acc_err:
                print(f"[sync] account refresh failed for {item_id}: {acc_err}")
            item.cursor = None
            db.commit()
        added = await _sync_item(item, plaid, db)
        print(f"[sync] {item.institution_name}: {added} transaction(s) added")
        # Clear any previous error now that sync succeeded
        if item.last_error_code:
            item.last_error_code    = None
            item.last_error_message = None
            item.last_error_at      = None
            db.commit()
        # Refresh current-month balance snapshots for all accounts in this item
        item_accounts = db.query(Account).filter_by(plaid_item_id=item_id, is_active=True).all()
        for acct in item_accounts:
            _refresh_current_month_snapshot(db, acct.id)
        if item_accounts:
            db.commit()

        # ── Record balance observations ──────────────────────────────────────
        # Capture Plaid's reported balance for each account in this item.
        # Used as self-correcting anchors for daily balance calculations.
        try:
            plaid_accts = plaid.get_accounts(item.access_token)
            plaid_bal_map = {}
            for pa in plaid_accts:
                bal = pa.get('balance')
                if bal is not None:
                    plaid_bal_map[pa['account_id']] = bal
            for acct in item_accounts:
                raw_bal = plaid_bal_map.get(acct.plaid_account_id)
                if raw_bal is not None:
                    signed_bal = _sign_plaid_balance(raw_bal, acct.account_type)
                    computed   = get_account_balance(db, acct.id)
                    db.add(BalanceObservation(
                        account_id=acct.id,
                        observed_at=datetime.utcnow(),
                        plaid_balance=round(signed_bal, 4),
                        computed_balance=round(computed, 2),
                        delta=round(signed_bal - computed, 2),
                        source='sync',
                    ))
            db.commit()
            print(f"[sync] {item.institution_name}: balance observations recorded")
        except Exception as obs_err:
            print(f"[sync] {item.institution_name}: balance observation failed: {obs_err}")
    except PlaidApiException as e:
        # Structured Plaid error — extract code and store for UI display
        import traceback; traceback.print_exc()
        try:
            import json as _json
            body = _json.loads(e.body) if isinstance(e.body, str) else (e.body or {})
            err_code = body.get('error_code') or 'PLAID_ERROR'
            err_msg  = body.get('display_message') or body.get('error_message') or str(e)
        except Exception:
            err_code = 'PLAID_ERROR'
            err_msg  = str(e)
        print(f"[sync] {item_id} Plaid error {err_code}: {err_msg}")

        # Cursor-reset errors: Plaid requires us to start from scratch.
        # Reset cursor and retry once immediately — no user action needed.
        CURSOR_RESET_CODES = {
            'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
            'INVALID_CURSOR',
        }
        if err_code in CURSOR_RESET_CODES and item and not clear_cursor:
            print(f"[sync] {item.institution_name}: {err_code} — resetting cursor and retrying once")
            try:
                item.cursor = None
                item.last_error_code    = None
                item.last_error_message = None
                item.last_error_at      = None
                db.commit()
                # Immediate retry with clean cursor (clear_cursor=True skips here)
                added = await _sync_item(item, plaid, db)
                print(f"[sync] {item.institution_name}: cursor-reset retry succeeded — {added} transaction(s) added")
                return
            except Exception as retry_err:
                print(f"[sync] {item.institution_name}: cursor-reset retry also failed: {retry_err}")
                # Fall through to store the error below

        # Persist error on item so the UI can show a reconnect warning.
        # Rollback first — if we got here via a DB error, the session may be in
        # ROLLBACK_REQUIRED state and commit would silently fail without it.
        try:
            db.rollback()
            if item:
                item.last_error_code    = err_code
                item.last_error_message = err_msg
                if not item.last_error_at:   # Record when error first appeared
                    item.last_error_at = datetime.utcnow()
                db.commit()
        except Exception:
            pass
    except Exception as e:
        import traceback; traceback.print_exc()
        err_type = type(e).__name__
        institution = getattr(item, 'institution_name', None) or item_id
        print(f"[sync] {institution} background sync failed ({err_type}): {e}")
        # Store generic errors on the item so they appear in the health check.
        # Rollback first — a failed DB operation (e.g. constraint violation) leaves
        # the session in ROLLBACK_REQUIRED state; commit without rollback is a no-op.
        try:
            db.rollback()
            if item:
                item.last_error_code    = f'SYNC_ERROR:{err_type}'
                item.last_error_message = str(e)[:500]
                item.last_error_at      = item.last_error_at or datetime.utcnow()
                db.commit()
        except Exception as store_err:
            print(f"[sync] {institution}: could not store error on item: {store_err}")
    finally:
        db.close()


@app.post("/api/plaid/reset-stuck-cursors")
async def reset_stuck_cursors(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Alias for sync-transactions — kept for backward compatibility."""
    return await sync_all_transactions(background_tasks, db)


@app.post("/api/plaid/sync-transactions")
async def sync_all_transactions(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Unified smart sync — one endpoint that does everything:

    • Healthy items  → incremental sync from stored cursor (fast, only new txns)
    • Stuck items    → cursor reset first, then full re-download
      A "stuck" item is one that has a non-auth error stored OR has never synced.
      Cursor reset is safe — it just re-fetches from scratch, no data is lost.
    • Auth-error items (ITEM_LOGIN_REQUIRED etc.) → skipped; user must reconnect
      via Plaid Link before sync can proceed.

    Returns per-item status so the UI can report which accounts need attention.
    """
    AUTH_ERROR_CODES = {
        'ITEM_LOGIN_REQUIRED', 'INVALID_CREDENTIALS', 'INVALID_ACCESS_TOKEN',
        'USER_PERMISSION_REVOKED', 'ITEM_NOT_FOUND', 'ACCESS_NOT_GRANTED',
    }

    items = db.query(PlaidItem).filter_by(is_active=True).all()
    if not items:
        return {"message": "No connected accounts.", "items_queued": 0,
                "items_cursor_reset": 0, "items_errored": 0,
                "errored": [], "items": [], "status": "idle"}

    item_statuses = []
    queued         = 0
    cursor_resets  = 0
    errored        = []

    for item in items:
        if item.last_error_code and item.last_error_code in AUTH_ERROR_CODES:
            # Connection is broken at the Plaid level — only re-linking fixes this
            errored.append({"institution_name": item.institution_name,
                            "error_code": item.last_error_code})
            item_statuses.append({"institution_name": item.institution_name,
                                  "status": "skipped",
                                  "error_code": item.last_error_code})
        else:
            stuck = bool(item.last_error_code) or (item.last_synced_at is None)
            if stuck:
                # Clear bad cursor/error so the sync starts clean
                item.cursor             = None
                item.last_error_code    = None
                item.last_error_message = None
                item.last_error_at      = None
                cursor_resets += 1
                item_statuses.append({"institution_name": item.institution_name,
                                      "status": "queued", "cursor_reset": True})
                print(f"[sync] {item.institution_name}: cursor reset (was stuck) — re-downloading")
            else:
                item_statuses.append({"institution_name": item.institution_name,
                                      "status": "queued", "cursor_reset": False})
            background_tasks.add_task(_sync_item_background, item.item_id, False)
            queued += 1

    db.commit()

    parts = []
    if queued:
        parts.append(f"Sync started for {queued} bank{'' if queued == 1 else 's'}")
    if cursor_resets:
        parts.append(f"{cursor_resets} re-downloading from scratch")
    if errored:
        names = ", ".join(e["institution_name"] for e in errored)
        parts.append(f"{len(errored)} need reconnecting ({names})")

    return {
        "message":            " — ".join(parts) or "Nothing to sync",
        "items":              item_statuses,
        "items_queued":       queued,
        "items_cursor_reset": cursor_resets,
        "items_errored":      len(errored),
        "errored":            errored,
        "status":             "started" if queued else "idle",
    }


@app.post("/api/plaid/items/{item_id}/deactivate")
async def deactivate_item(item_id: str, db: Session = Depends(get_db)):
    """Mark a stale PlaidItem as inactive so it no longer participates in syncs."""
    item = db.query(PlaidItem).filter_by(item_id=item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_active = False
    db.commit()
    return {"message": f"Deactivated {item.institution_name} ({item_id})"}


@app.delete("/api/plaid/items/{item_id}")
async def remove_plaid_item(item_id: str, db: Session = Depends(get_db)):
    """Deactivate a PlaidItem and delete any of its accounts that have 0 transactions."""
    item = db.query(PlaidItem).filter_by(item_id=item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    accounts = db.query(Account).filter_by(plaid_item_id=item_id).all()
    deleted_accounts = 0
    for account in accounts:
        txn_count = db.query(Transaction).filter_by(account_id=account.id).count()
        if txn_count == 0:
            db.delete(account)
            deleted_accounts += 1
        else:
            # Sever the Plaid link so the account survives without the item
            account.plaid_item_id = None
            account.plaid_account_id = None
            account.is_active = True
    db.delete(item)
    db.commit()
    return {
        "removed": True,
        "deleted_empty_accounts": deleted_accounts,
        "remaining_accounts": len(accounts) - deleted_accounts,
    }


@app.get("/api/plaid/item-status")
async def plaid_item_status(db: Session = Depends(get_db)):
    """
    Diagnostic endpoint: calls Plaid /item/get for every active PlaidItem and
    returns health info — error codes, last successful/failed update timestamps,
    consent expiration time, and update_type (background vs user_present).
    Use this to identify stale or broken Plaid connections (e.g. ITEM_LOGIN_REQUIRED).
    """
    plaid = setup_plaid_from_env()
    if plaid is None:
        return {"error": "Plaid not configured"}
    items = db.query(PlaidItem).filter_by(is_active=True).all()
    results = []
    for item in items:
        access_token = item.access_token
        status = plaid.get_item_status(access_token)
        results.append({
            "institution_name": item.institution_name,
            "item_id": item.item_id,
            "last_synced_at": item.last_synced_at.isoformat() if item.last_synced_at else None,
            # Internal sync error state — set when our own sync code fails (not a Plaid
            # connection error). Separate from the Plaid-side error returned above.
            "internal_error_code":    item.last_error_code,
            "internal_error_message": item.last_error_message,
            "internal_error_at":      item.last_error_at.isoformat() if item.last_error_at else None,
            **status,
        })
    # Sort: broken items first, then by institution name
    results.sort(key=lambda r: (r.get('ok', False), r.get('institution_name', '')))
    return results


@app.post("/api/plaid/sync-liabilities")
async def sync_liabilities(db: Session = Depends(get_db)):
    """
    Pull the Plaid Liabilities product for every active item and write
    liability details (minimum payment, next due date, APR, last statement
    balance, etc.) onto the matching Account rows.

    Also updates Loan.interest_rate for any Loan record whose account_id
    matches a mortgage or student-loan account returned by Plaid.

    Safe to call repeatedly — all writes are idempotent overwrites.
    Institutions that don't support the Liabilities product are skipped silently.
    """
    def _plaid_date(raw) -> Optional[datetime]:
        """Parse a Plaid date value (date object, datetime, or YYYY-MM-DD string)."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw
        try:
            from datetime import date as _date
            if isinstance(raw, _date):
                return datetime(raw.year, raw.month, raw.day)
        except Exception:
            pass
        try:
            return datetime.strptime(str(raw)[:10], '%Y-%m-%d')
        except Exception:
            return None

    plaid = setup_plaid_from_env()
    items = db.query(PlaidItem).filter(PlaidItem.is_active.is_(True)).all()

    accounts_updated = 0
    loans_updated    = 0
    errors: list[str] = []

    for item in items:
        try:
            liab = plaid.get_liabilities(item.access_token)
        except Exception as e:
            errors.append(f"{item.institution_name or item.item_id}: {e}")
            continue

        # ── Credit cards ──────────────────────────────────────────────────────
        for cc in liab.get('credit') or []:
            acct = db.query(Account).filter_by(
                plaid_account_id=cc.get('account_id')
            ).first()
            if not acct:
                continue
            acct.liability_min_payment        = cc.get('minimum_payment_amount')
            acct.liability_next_due_date      = _plaid_date(cc.get('next_payment_due_date'))
            acct.liability_last_statement_bal = cc.get('last_statement_balance')
            acct.liability_last_payment       = cc.get('last_payment_amount')
            acct.liability_last_payment_date  = _plaid_date(cc.get('last_payment_date'))
            # Purchase APR (first match in aprs list)
            for apr in cc.get('aprs') or []:
                if apr.get('apr_type') == 'purchase_apr':
                    acct.liability_purchase_apr = apr.get('apr_percentage')
                    break
            accounts_updated += 1

        # ── Student loans ─────────────────────────────────────────────────────
        for sl in liab.get('student') or []:
            acct = db.query(Account).filter_by(
                plaid_account_id=sl.get('account_id')
            ).first()
            if not acct:
                continue
            acct.liability_min_payment        = sl.get('minimum_payment_amount')
            acct.liability_next_due_date      = _plaid_date(sl.get('next_payment_due_date'))
            acct.liability_last_statement_bal = sl.get('last_statement_balance')
            acct.liability_last_payment       = sl.get('last_payment_amount')
            acct.liability_last_payment_date  = _plaid_date(sl.get('last_payment_date'))
            accounts_updated += 1
            # Back-fill Loan.interest_rate if we have a linked Loan record
            rate = sl.get('interest_rate_percentage')
            if rate is not None:
                loan = db.query(Loan).filter_by(account_id=acct.id).first()
                if loan:
                    loan.interest_rate = rate
                    loans_updated += 1

        # ── Mortgages ─────────────────────────────────────────────────────────
        for mtg in liab.get('mortgage') or []:
            acct = db.query(Account).filter_by(
                plaid_account_id=mtg.get('account_id')
            ).first()
            if not acct:
                continue
            acct.liability_min_payment       = mtg.get('next_monthly_payment')
            acct.liability_next_due_date     = _plaid_date(mtg.get('next_payment_due_date'))
            acct.liability_last_payment      = mtg.get('last_payment_amount')
            acct.liability_last_payment_date = _plaid_date(mtg.get('last_payment_date'))
            accounts_updated += 1
            # Back-fill Loan interest rate
            ir = mtg.get('interest_rate') or {}
            rate = ir.get('percentage') if isinstance(ir, dict) else None
            if rate is not None:
                loan = db.query(Loan).filter_by(account_id=acct.id).first()
                if loan:
                    loan.interest_rate = rate
                    loans_updated += 1

    db.commit()
    return {
        "accounts_updated": accounts_updated,
        "loans_updated":    loans_updated,
        "items_processed":  len(items),
        "errors":           errors,
    }


@app.post("/api/plaid/reset-and-resync")
async def reset_and_resync(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Wipe all Plaid-sourced transactions and accounts, clear cursors, then resync from scratch."""
    # 1. Delete splits belonging to Plaid transactions
    plaid_txn_ids = [r[0] for r in db.query(Transaction.id).filter(Transaction.plaid_transaction_id != None).all()]
    if plaid_txn_ids:
        db.query(TransactionSplit).filter(TransactionSplit.parent_transaction_id.in_(plaid_txn_ids)).delete(synchronize_session=False)
    # 2. Delete Plaid transactions (keep manually-entered ones)
    deleted_txns = db.query(Transaction).filter(Transaction.plaid_transaction_id != None).delete(synchronize_session=False)
    # 3. Delete Plaid-linked accounts (keep manual accounts)
    db.query(Account).filter(Account.plaid_account_id != None).delete(synchronize_session=False)
    # 4. Clear all cursors
    items = db.query(PlaidItem).filter_by(is_active=True).all()
    for item in items:
        item.cursor = None
    db.commit()
    print(f"[reset] deleted {deleted_txns} Plaid transactions; starting fresh sync for {len(items)} item(s)")
    # 5. Resync all items (re-fetches accounts + transactions)
    for item in items:
        background_tasks.add_task(_sync_item_background, item.item_id, True)
    return {
        "message": f"Reset complete — deleted {deleted_txns} transactions. Resync started for {len(items)} bank(s).",
        "transactions_deleted": deleted_txns,
        "items": len(items),
        "status": "started",
    }


@app.post("/api/reset-all")
async def reset_all(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Fresh start: wipe all Plaid-sourced transactions, delete ghost accounts
    (severed + no transactions), clear sync cursors, then trigger a full re-sync.

    Preserved: account records (names, types, starting balances, account_hash),
    categories, rules, card mappings, manual transactions.

    After this call, re-linking any bank will match existing accounts by
    account_hash — no duplicate accounts, no manual merging needed.
    """
    from sqlalchemy import text as _text

    # 1. Delete ghost accounts FIRST (while transaction counts are still accurate).
    #    Ghost = severed (no plaid_account_id), not manual, zero transactions.
    ghost_rows = db.execute(_text(
        "SELECT id FROM accounts "
        "WHERE plaid_account_id IS NULL AND is_manual = false "
        "AND id NOT IN (SELECT DISTINCT account_id FROM transactions WHERE account_id IS NOT NULL)"
    )).fetchall()
    ghost_ids = [r[0] for r in ghost_rows]
    if ghost_ids:
        ids_str = ','.join(str(i) for i in ghost_ids)
        db.execute(_text(f"DELETE FROM account_monthly_snapshots WHERE account_id IN ({ids_str})"))
        db.execute(_text(f"DELETE FROM accounts WHERE id IN ({ids_str})"))
    ghosts_deleted = len(ghost_ids)

    # 2. Delete all Plaid-sourced transactions (FK-safe order)
    db.execute(_text(
        "DELETE FROM user_corrections WHERE transaction_id IN "
        "(SELECT id FROM transactions WHERE plaid_transaction_id IS NOT NULL)"
    ))
    db.execute(_text(
        "DELETE FROM user_corrections WHERE transaction_id IN "
        "(SELECT id FROM transactions WHERE parent_transaction_id IN "
        "  (SELECT id FROM transactions WHERE plaid_transaction_id IS NOT NULL))"
    ))
    db.execute(_text(
        "DELETE FROM transaction_splits WHERE parent_transaction_id IN "
        "(SELECT id FROM transactions WHERE plaid_transaction_id IS NOT NULL)"
    ))
    db.execute(_text(
        "DELETE FROM transactions WHERE parent_transaction_id IN "
        "(SELECT id FROM transactions WHERE plaid_transaction_id IS NOT NULL)"
    ))
    txn_result = db.execute(_text(
        "DELETE FROM transactions WHERE plaid_transaction_id IS NOT NULL"
    ))
    txns_deleted = txn_result.rowcount

    # 3. Clear sync cursors so next sync re-fetches from the beginning
    items = db.query(PlaidItem).filter_by(is_active=True).all()
    for item in items:
        item.cursor = None

    db.commit()
    print(f"[reset-all] {txns_deleted} transactions deleted, {ghosts_deleted} ghost accounts removed, {len(items)} cursors cleared")

    # 4. Trigger full re-sync for all active items
    for item in items:
        background_tasks.add_task(_sync_item_background, item.item_id, False)

    return {
        "transactions_deleted": txns_deleted,
        "ghost_accounts_deleted": ghosts_deleted,
        "syncs_started": len(items),
        "status": f"Fresh start — {txns_deleted} transactions cleared, {ghosts_deleted} ghost accounts removed. Re-syncing {len(items)} bank connection(s).",
    }


@app.post("/api/nuke")
async def nuke_everything(db: Session = Depends(get_db)):
    """
    Complete wipe: deletes every transaction, every account, and every Plaid
    connection. The database is left in a pristine state ready for fresh bank
    connections via Plaid Link.

    Preserved (no data lost):
      - Categories, categorization rules, budget targets
      - Cards (account_id nulled out — re-match after re-link)
      - Loans (account_id nulled out)
      - Manual transactions are wiped along with everything else
    """
    from sqlalchemy import text as _text

    # Null FKs on tables we're KEEPING before deleting what they point to
    db.execute(_text("UPDATE cards SET account_id = NULL, plaid_account_id = NULL, payment_account_id = NULL"))
    db.execute(_text("UPDATE loans SET account_id = NULL, payment_account_id = NULL"))
    # FK-safe deletion order
    db.execute(_text("DELETE FROM user_corrections"))
    db.execute(_text("DELETE FROM transaction_splits"))
    # transactions has a self-referential parent_transaction_id — delete children first
    db.execute(_text("DELETE FROM transactions WHERE parent_transaction_id IS NOT NULL"))
    db.execute(_text("DELETE FROM transactions"))
    db.execute(_text("DELETE FROM account_monthly_snapshots"))
    db.execute(_text("DELETE FROM duplicate_ignore"))   # table name has no trailing 's'
    db.execute(_text("DELETE FROM accounts"))
    db.execute(_text("DELETE FROM plaid_items"))
    db.commit()

    return {"status": "Clean slate — all accounts, transactions, and bank connections removed. Connect your banks fresh."}


@app.post("/api/accounts/backfill-balances")
async def backfill_account_balances(db: Session = Depends(get_db)):
    """
    One-time fix: fetch current balances from Plaid for every active linked account
    and write them as the starting_balance anchor. Then rebuild monthly snapshots
    so the balance engine has accurate history immediately.

    Safe to run multiple times — only updates accounts where start_date is NULL
    or starting_balance is 0 (i.e. accounts that don't already have a real anchor).
    """
    plaid = setup_plaid_from_env()
    updated = 0
    errors  = []

    items = db.query(PlaidItem).filter_by(is_active=True).all()
    for item in items:
        try:
            plaid_accounts = plaid.get_accounts(item.access_token)
        except Exception as e:
            errors.append(f"item {item.item_id}: {e}")
            continue

        for pa in plaid_accounts:
            acct = db.query(Account).filter_by(
                plaid_account_id=pa['account_id'], is_active=True
            ).first()
            if not acct:
                continue

            # Only update accounts that lack a real balance anchor
            if acct.start_date is not None and (acct.starting_balance or 0) != 0:
                continue

            raw_type      = (pa.get('type') or '').lower().strip()
            plaid_balance = _sign_plaid_balance(pa.get('balance'), raw_type)
            if plaid_balance is None:
                continue

            # Calibration: offset = plaid_balance − SUM(all txns)
            from sqlalchemy import func as _sbf
            _txn_sum = db.query(_sbf.sum(Transaction.amount)).filter(
                Transaction.account_id == acct.id).scalar() or 0.0
            acct.starting_balance = round(plaid_balance - _txn_sum, 4)
            acct.start_date       = None  # Legacy model
            updated += 1

    db.commit()

    # Rebuild snapshots for ALL active accounts now that anchors are set
    rebuilt = 0
    for acct in db.query(Account).filter_by(is_active=True).all():
        try:
            rebuild_monthly_snapshots(db, acct.id)
            rebuilt += 1
        except Exception as e:
            errors.append(f"snapshot acct {acct.id}: {e}")
    db.commit()

    return {
        "accounts_updated": updated,
        "snapshots_rebuilt": rebuilt,
        "errors": errors,
    }


@app.get("/api/plaid/debug/{item_id}")
async def debug_plaid_item(item_id: str, db: Session = Depends(get_db)):
    """
    Diagnostic: calls Plaid directly and reports raw counts without writing anything to the DB.
    Tells you whether 0 transactions is a Plaid issue or a processing issue.
    """
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        plaid = setup_plaid_from_env()

        # Raw account IDs from Plaid
        plaid_accounts = plaid.get_accounts(item.access_token)
        plaid_account_ids = [a['account_id'] for a in plaid_accounts]

        # Account IDs we have in the DB for this item
        db_accounts = db.query(Account).filter_by(plaid_item_id=item_id, is_active=True).all()
        db_account_ids = [a.plaid_account_id for a in db_accounts]

        # One raw call to transactions/sync (no cursor = full history, read-only — cursor NOT saved)
        from plaid.model.transactions_sync_request import TransactionsSyncRequest
        response = plaid.client.transactions_sync(
            TransactionsSyncRequest(access_token=item.access_token)
        )
        raw_added    = len(response['added'])
        raw_modified = len(response['modified'])
        raw_removed  = len(response['removed'])
        has_more     = response['has_more']

        # Which transaction account IDs from Plaid match our DB accounts
        sample_txn_account_ids = list({t['account_id'] for t in response['added'][:50]})
        matched = [aid for aid in sample_txn_account_ids if aid in db_account_ids]
        unmatched = [aid for aid in sample_txn_account_ids if aid not in db_account_ids]

        return {
            "institution":         item.institution_name,
            "environment":         os.getenv('PLAID_ENV', 'sandbox'),
            "cursor_stored":       bool(item.cursor),
            "plaid_accounts":      plaid_account_ids,
            "db_accounts":         db_account_ids,
            "accounts_matched":    matched,
            "accounts_unmatched":  unmatched,
            "raw_added":           raw_added,
            "raw_modified":        raw_modified,
            "raw_removed":         raw_removed,
            "has_more_pages":      has_more,
            "diagnosis": (
                "Plaid returned 0 transactions — data may not be ready yet (normal for new OAuth connections; wait a few minutes and retry)"
                if raw_added == 0
                else f"Plaid has {raw_added} transactions but {len(unmatched)} account ID(s) in those transactions don't match the DB — those will be skipped"
                if unmatched
                else f"Plaid has {raw_added} transactions and all account IDs match — processing should work"
            ),
        }
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/plaid/items")
async def list_items(db: Session = Depends(get_db)):
    all_items = db.query(PlaidItem).order_by(PlaidItem.created_at.desc()).all()
    env = os.getenv('PLAID_ENV', 'sandbox')
    result = []
    for item in all_items:
        accounts = db.query(Account).filter_by(plaid_item_id=item.item_id, is_active=True).all()
        txn_count = db.query(Transaction).filter(
            Transaction.account_id.in_([a.id for a in accounts])
        ).count() if accounts else 0
        result.append({
            "item_id":            item.item_id,
            "institution_name":   item.institution_name,
            "last_synced_at":     item.last_synced_at,
            "created_at":         item.created_at,
            "is_active":          item.is_active,
            "account_count":      len(accounts),
            "accounts":           [{
                "id": a.id, "name": a.account_name, "type": a.account_type, "mask": a.mask,
                "start_date": a.start_date.strftime('%Y-%m-%d') if a.start_date else None,
                "anchor_age_days": (datetime.utcnow() - a.start_date).days if a.start_date else None,
                "starting_balance": a.starting_balance,
            } for a in accounts],
            "transaction_count":  txn_count,
            "has_cursor":         bool(item.cursor),
            "environment":        env,
            # Sync error state — set when Plaid returns an API error during sync
            "last_error_code":    item.last_error_code,
            "last_error_message": item.last_error_message,
            "last_error_at":      item.last_error_at.isoformat() if item.last_error_at else None,
        })
    return result


@app.patch("/api/plaid/items/{item_id}")
async def update_item(item_id: str, body: dict, db: Session = Depends(get_db)):
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if "institution_name" in body:
        name = str(body["institution_name"]).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        item.institution_name = name
    db.commit()
    return {"item_id": item.item_id, "institution_name": item.institution_name}


@app.post("/api/plaid/items/{item_id}/force-resync")
async def force_resync_item(item_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Clear the stored cursor and re-fetch all historical transactions in the background."""
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    background_tasks.add_task(_sync_item_background, item_id, True)
    return {"message": f"Resync started for {item.institution_name}", "status": "started"}


@app.post("/api/plaid/backfill-persistent-ids")
async def backfill_persistent_ids(db: Session = Depends(get_db)):
    """
    One-time backfill: for every active Plaid item, call Plaid's accounts API
    and write persistent_account_id onto any DB account that still has NULL.

    Matches Plaid accounts to DB rows via plaid_account_id (exact, fast).
    Updates only rows where persistent_account_id IS NULL so it is safe to
    re-run any number of times.

    Returns a per-institution summary and overall counts.
    """
    plaid  = setup_plaid_from_env()
    items  = db.query(PlaidItem).filter_by(is_active=True).all()

    total_updated   = 0
    total_no_pid    = 0   # Plaid returned None for persistent_account_id (institution doesn't support it)
    results         = []

    for item in items:
        item_updated  = 0
        item_skipped  = 0
        item_no_pid   = 0
        errors        = []

        try:
            plaid_accounts = plaid.get_accounts(item.access_token)
        except Exception as e:
            results.append({
                'institution': item.institution_name,
                'item_id': item.item_id,
                'error': str(e),
            })
            continue

        for pa in plaid_accounts:
            pid = pa.get('persistent_account_id')
            if not pid:
                item_no_pid += 1
                continue  # institution doesn't provide persistent IDs — nothing to write

            # Match DB account by plaid_account_id (fast & unambiguous)
            db_acct = (db.query(Account)
                .filter_by(plaid_account_id=pa['account_id'])
                .first())

            if not db_acct:
                item_skipped += 1
                continue  # account not in DB (probably was deleted or never adopted)

            if db_acct.persistent_account_id:
                item_skipped += 1
                continue  # already populated — skip

            db_acct.persistent_account_id = pid
            item_updated += 1

        db.commit()
        total_updated += item_updated
        total_no_pid  += item_no_pid

        results.append({
            'institution':  item.institution_name,
            'item_id':      item.item_id,
            'updated':      item_updated,
            'skipped':      item_skipped,
            'no_pid':       item_no_pid,   # Plaid returned None — institution limitation
        })

    return {
        'total_updated': total_updated,
        'total_no_pid':  total_no_pid,
        'items':         results,
    }


@app.post("/api/transactions/backfill-points-categories")
async def backfill_points_categories(db: Session = Depends(get_db)):
    """
    One-time (and idempotent) backfill: infer points_category for every
    transaction that has merchant_name set but points_category NULL.

    Uses the same infer_points_category() logic as live sync, so results
    are consistent with newly ingested transactions.  Safe to run multiple
    times — only NULL rows with a known merchant are touched.

    Returns {updated, skipped} counts.
    """
    txns = (
        db.query(Transaction)
        .filter(
            Transaction.points_category == None,   # noqa: E711
            Transaction.merchant_name != None,     # noqa: E711
        )
        .all()
    )
    updated = 0
    skipped = 0
    for t in txns:
        cat = infer_points_category(t.merchant_name)
        if cat:
            t.points_category = cat
            updated += 1
        else:
            skipped += 1
    db.commit()
    return {"updated": updated, "skipped": skipped}


@app.get("/api/transactions/unclassified-merchants")
async def unclassified_merchants(limit: int = 50, db: Session = Depends(get_db)):
    """
    Returns the top merchants (by transaction count) that have a merchant_name
    but no points_category assigned. Useful for discovering which patterns to
    add to _MERCHANT_POINTS_PATTERNS next.
    """
    from sqlalchemy import func as _func
    rows = (
        db.query(Transaction.merchant_name, _func.count(Transaction.id).label("n"))
        .filter(
            Transaction.points_category == None,   # noqa: E711
            Transaction.merchant_name != None,     # noqa: E711
        )
        .group_by(Transaction.merchant_name)
        .order_by(_func.count(Transaction.id).desc())
        .limit(limit)
        .all()
    )
    return {"unclassified": [{"merchant": r[0], "count": r[1]} for r in rows]}


@app.post("/api/transactions/backfill-content-hashes")
async def backfill_content_hashes(db: Session = Depends(get_db)):
    """
    One-time backfill: assign content_hash to every transaction that was
    created before this feature was added (i.e. content_hash IS NULL).

    content_hash = SHA256(account_id|date|amount|description_raw)[:14] + "-NN"
    where NN is a zero-padded counter that disambiguates identical transactions
    on the same account/date with the same amount and description.

    Safe to run multiple times — only NULL rows are touched.
    Returns count of rows updated.
    """
    txns = (
        db.query(Transaction)
        .filter(Transaction.content_hash == None)   # noqa: E711
        .order_by(Transaction.account_id, Transaction.date, Transaction.id)
        .all()
    )
    updated = 0
    for txn in txns:
        txn.content_hash = _assign_content_hash(
            db, txn.account_id, txn.date, txn.amount, txn.description_raw
        )
        db.flush()  # make hash visible so the next count() is correct
        updated += 1

    db.commit()
    return {"backfilled": updated}


@app.post("/api/plaid/items/{item_id}/recover-accounts")
async def recover_plaid_accounts_for_item(item_id: str, db: Session = Depends(get_db)):
    """
    Recovery endpoint for when accounts were wrongly merged (e.g. bad merge of
    duplicate accounts scrambled plaid_account_ids).

    Algorithm:
    1. Fetch all accounts from Plaid for this item.
    2. For each Plaid account, match DB account by official_name + mask ONLY
       (plaid_account_id is unreliable after a bad merge — surviving accounts
       hold the wrong IDs absorbed from deleted duplicates).
    3. If found but plaid_account_id differs → mark for UPDATE.
    4. If not found → mark for CREATE.
    5. UPDATEs first (raw SQL, frees the old unique IDs), then CREATEs.
    6. Delete Plaid-sourced transactions from updated accounts (mixed up).
    7. Reset sync cursor for full re-sync.
    """
    import traceback as _tb
    from sqlalchemy import text as _text
    from sqlalchemy.exc import IntegrityError as _IntegrityError

    try:
        plaid_svc = setup_plaid_from_env()
        item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
        if not item:
            raise HTTPException(404, "PlaidItem not found")

        # Fetch from Plaid — most common failure point (expired / wrong item)
        try:
            plaid_accounts = plaid_svc.get_accounts(item.access_token)
        except Exception as plaid_err:
            raise HTTPException(400,
                f"Plaid API error: {plaid_err}. "
                "If this connection was recently re-linked, try clicking 🔧 Recover "
                "on the NEWER entry for this bank instead."
            )

        import difflib as _difflib

        def _name_sim(a: str, b: str) -> float:
            """Character-level similarity ratio between two account name strings."""
            return _difflib.SequenceMatcher(
                None, (a or '').lower(), (b or '').lower()
            ).ratio()

        # ── Step 1: load all active DB accounts that belong to this Plaid item ──
        # We query by plaid_item_id rather than iterating Plaid accounts to also
        # capture accounts whose plaid_account_id was corrupted by a bad merge.
        db_accounts = (
            db.query(Account)
            .filter(Account.plaid_item_id == item.item_id, Account.is_active == True)
            .all()
        )
        # Remember original plaid_account_ids so we can tell which accounts had a
        # WRONG id after the bad merge (those need their Plaid transactions cleared).
        orig_plaid_ids: dict = {a.id: a.plaid_account_id for a in db_accounts}

        # ── Step 2: NULL every plaid_account_id for this item ──────────────────
        # PostgreSQL allows multiple NULLs in a UNIQUE column.  Zeroing them all
        # out first means the subsequent UPDATE/INSERT phase faces zero UNIQUE
        # conflicts, regardless of what IDs got shuffled during the bad merge.
        db.execute(
            _text(
                "UPDATE accounts SET plaid_account_id = NULL "
                "WHERE plaid_item_id = :iid AND is_active = true"
            ),
            {"iid": item.item_id},
        )
        db.flush()
        db.expire_all()   # discard ORM cache — every subsequent query hits the DB

        # ── Step 3: match Plaid accounts → DB accounts ──────────────────────────
        # Pass A — exact official_name + mask (case-insensitive).
        # Pass B — mask + account_type + best name-similarity score.
        #           Handles "The Platinum Card®" → "Platinum Card" drift.
        matched_pairs: list = []    # [(db_acct, plaid_pa)]
        remaining_db = list(db_accounts)
        unmatched_plaid = []

        for pa in plaid_accounts:
            pname = (pa.get('official_name') or pa.get('name') or '').strip()
            pmask = pa.get('mask')
            found = None
            if pname and pmask:
                for d in remaining_db:
                    if (d.mask == pmask and
                            (d.official_name or '').strip().lower() == pname.lower()):
                        found = d
                        break
            if found:
                matched_pairs.append((found, pa))
                remaining_db.remove(found)
            else:
                unmatched_plaid.append(pa)

        # Pass B: fallback for name-drifted accounts
        still_unmatched = []
        for pa in unmatched_plaid:
            pname = (pa.get('official_name') or pa.get('name') or '').strip()
            pmask  = pa.get('mask')
            ptype  = pa.get('type', '').lower()
            candidates = [
                d for d in remaining_db
                if d.mask == pmask and d.account_type == ptype
            ]
            if not candidates:
                still_unmatched.append(pa)
                continue
            best = max(
                candidates,
                key=lambda d: _name_sim(d.official_name or d.account_name or '', pname),
            )
            if _name_sim(best.official_name or best.account_name or '', pname) >= 0.4:
                matched_pairs.append((best, pa))
                remaining_db.remove(best)
            else:
                still_unmatched.append(pa)

        # ── Step 4: UPDATE matched accounts with correct plaid_account_ids ──────
        results = []
        updated_account_ids = []   # IDs where plaid_account_id changed → clear txns

        for db_acct, pa in matched_pairs:
            new_pid = pa['account_id']
            was_correct = (orig_plaid_ids.get(db_acct.id) == new_pid)
            db.execute(
                _text(
                    "UPDATE accounts SET plaid_account_id=:pid, plaid_item_id=:iid "
                    "WHERE id=:id"
                ),
                {"pid": new_pid, "iid": item.item_id, "id": db_acct.id},
            )
            if was_correct:
                results.append({'status': 'ok', 'account': db_acct.account_name})
            else:
                updated_account_ids.append(db_acct.id)
                results.append({
                    'status': 'updated',
                    'account': db_acct.account_name,
                    'new_plaid_id': new_pid,
                })
        db.flush()

        # ── Step 5: CREATE new accounts for Plaid entries with no DB match ──────
        created_account_ids = []
        for pa in still_unmatched:
            plaid_account_id = pa['account_id']
            mask = pa.get('mask')
            official_name = (pa.get('official_name') or pa.get('name', '')).strip()
            account_type = pa.get('type', '').lower()
            new_acct = Account(
                plaid_account_id=plaid_account_id,
                plaid_item_id=item.item_id,
                account_name=official_name or f"Account ···{mask}",
                account_type=account_type,
                official_name=official_name,
                mask=mask,
                is_active=True,
                is_manual=False,
                starting_balance=0,
            )
            db.add(new_acct)
            db.flush()
            created_account_ids.append(new_acct.id)
            results.append({
                'status': 'created',
                'account': new_acct.account_name,
                'plaid_id': plaid_account_id,
            })

        # Delete Plaid-sourced transactions from accounts whose plaid_account_id
        # was corrected — their transactions are mixed up after the bad merge.
        # Three FK constraints on transactions.id must be cleared in order:
        #   user_corrections.transaction_id
        #   transaction_splits.parent_transaction_id
        #   transactions.parent_transaction_id  (self-ref: split-child rows)
        total_deleted = 0
        for acct_id in updated_account_ids:
            # A) user_corrections on the Plaid txns themselves
            db.execute(_text(
                "DELETE FROM user_corrections WHERE transaction_id IN ("
                "  SELECT id FROM transactions"
                "  WHERE account_id = :a AND plaid_transaction_id IS NOT NULL)"
            ), {"a": acct_id})
            # B) user_corrections on any split-child txns of those Plaid txns
            db.execute(_text(
                "DELETE FROM user_corrections WHERE transaction_id IN ("
                "  SELECT id FROM transactions WHERE parent_transaction_id IN ("
                "    SELECT id FROM transactions"
                "    WHERE account_id = :a AND plaid_transaction_id IS NOT NULL))"
            ), {"a": acct_id})
            # C) transaction_splits rows referencing the Plaid txns
            db.execute(_text(
                "DELETE FROM transaction_splits WHERE parent_transaction_id IN ("
                "  SELECT id FROM transactions"
                "  WHERE account_id = :a AND plaid_transaction_id IS NOT NULL)"
            ), {"a": acct_id})
            # D) split-child transaction rows (parent_transaction_id → Plaid txn)
            db.execute(_text(
                "DELETE FROM transactions WHERE parent_transaction_id IN ("
                "  SELECT id FROM transactions"
                "  WHERE account_id = :a AND plaid_transaction_id IS NOT NULL)"
            ), {"a": acct_id})
            # E) the Plaid-sourced transactions themselves
            result = db.execute(_text(
                "DELETE FROM transactions"
                " WHERE account_id = :a AND plaid_transaction_id IS NOT NULL"
            ), {"a": acct_id})
            total_deleted += result.rowcount

        item.cursor = None
        db.commit()

        for acct_id in updated_account_ids + created_account_ids:
            try:
                rebuild_monthly_snapshots(db, acct_id)
            except Exception:
                pass

        return {
            'accounts': results,
            'transactions_deleted': total_deleted,
            'cursor_reset': True,
            'message': f'Recovery complete. Run "↺ Full Resync" for {item.institution_name} to restore all transactions.',
        }

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        detail = f"{type(exc).__name__}: {exc}"
        print(f"[recover-accounts] UNHANDLED ERROR for item {item_id}:\n{_tb.format_exc()}")
        raise HTTPException(500, f"Recovery failed: {detail}")


# ---------------------------------------------------------------------------
# Transactions: list
# ---------------------------------------------------------------------------

def _best_description(raw: str, stored_clean, enrichment_source=None, categorizer=None) -> str:
    """
    Compute the best human-readable description for a transaction.

    Design principle: only two trustworthy sources for display names —
      (a) an explicit Rule with set_description (user-controlled, deterministic)
      (b) the noise-stripper (deterministic regex, never hallucinates)

    LLM-written description_clean is intentionally SKIPPED because the LLM
    sometimes produces garbled output (e.g. 'CONRADFT LAUDERDALEFT LAUDERDALE').
    It is only trusted when a rule explicitly set it (enrichment_source == 'rule').

    Priority:
      1. Rule set_description  — rule matched AND has a display name != raw
      2. Noise-stripped raw    — deterministic: removes PPD IDs, long numbers,
                                 PAYROLL/DIR DEP suffixes, etc.
      3. Raw fallback
    """
    raw = (raw or "").strip()
    if not raw:
        return raw
    raw_upper = raw.upper()

    if categorizer:
        # Priority 1: rule with an explicit custom display name
        rule = categorizer.match_rule(raw, 0)
        if rule and rule.set_description:
            sd = rule.set_description.strip()
            if sd.upper() != raw_upper:
                return sd

        # Priority 2: noise-stripper (always deterministic)
        cleaned = categorizer.clean_description(raw)
        if cleaned and cleaned != raw_upper:
            return cleaned

    # Priority 3: fall back to raw (or rule-written stored_clean if source is 'rule')
    if enrichment_source == 'rule' and stored_clean:
        return stored_clean.strip() or raw
    return raw


def _build_points_lookup(db, account_ids: list[int]) -> tuple[dict, dict]:
    """
    Pre-build the data structures needed to compute earn rates for a batch of
    transactions without N+1 queries.

    Returns:
      points_lookup  : {account_id: (base_rate, bonus_by_name, currency_name, eco_name)}
                       where bonus_by_name = {category_name: additional_multiplier}
      cat_parent_map : {category_name: parent_key}  — for the L2→L1 waterfall
    """
    cat_parent_map = {c.name: c.parent_key for c in db.query(PointsCategory).all()}

    if not account_ids:
        return {}, cat_parent_map

    cards = db.query(Card).filter(Card.account_id.in_(account_ids)).all()
    acct_to_card = {c.account_id: c for c in cards}

    product_ids = [c.product_id for c in cards if c.product_id]
    if not product_ids:
        return {}, cat_parent_map

    products   = {p.id: p for p in db.query(CardProduct).filter(CardProduct.id.in_(product_ids)).all()}
    eco_ids    = [p.ecosystem_id for p in products.values() if p.ecosystem_id]
    ecosystems = {e.id: e for e in db.query(PointsEcosystem).filter(PointsEcosystem.id.in_(eco_ids)).all()}

    all_rewards = db.query(CardProductReward)\
        .filter(CardProductReward.product_id.in_(product_ids)).all()
    rewards_by_product: dict[int, list] = {}
    for r in all_rewards:
        rewards_by_product.setdefault(r.product_id, []).append(r)

    points_lookup: dict[int, tuple] = {}
    for acct_id, card in acct_to_card.items():
        if not card.product_id:
            continue
        product = products.get(card.product_id)
        if not product:
            continue
        eco     = ecosystems.get(product.ecosystem_id) if product.ecosystem_id else None
        rewards = rewards_by_product.get(card.product_id, [])
        base    = next((r.multiplier for r in rewards if r.is_base_rate), 1.0)
        bonus_by_name = {
            r.points_category.name: r.multiplier
            for r in rewards
            if not r.is_base_rate and r.points_category
        }
        points_lookup[acct_id] = (
            base,
            bonus_by_name,
            eco.currency_name if eco else 'Points',
            eco.name if eco else None,
            eco.your_cpp if eco else 1.0,
        )

    return points_lookup, cat_parent_map


def _serialize_txn(t, splits_map=None, categorizer=None, points_lookup=None, cat_parent_map=None):
    """Serialize a Transaction with inline splits and computed display fields."""
    splits = splits_map.get(t.id, []) if splits_map else []
    is_split = bool(t.is_split or False)

    # Compute display values for split transactions
    if is_split and splits:
        actions = {s.action for s in splits if s.action}
        cats    = {s.category for s in splits if s.category}
        action_display   = next(iter(actions)) if len(actions) == 1 else "Multiple"
        category_display = next(iter(cats))    if len(cats)    == 1 else "Multiple"
    else:
        action_display   = t.action
        category_display = t.category_final

    description_display = _best_description(
        t.description_raw, t.description_clean,
        enrichment_source=t.enrichment_source,
        categorizer=categorizer
    )

    # Points earn — only computed for expenses where we know the card's product
    points_earn = None
    if (points_lookup is not None and cat_parent_map is not None
            and t.action == 'Expense' and t.account_id in points_lookup):
        base, bonus_by_name, currency, eco_name, your_cpp = points_lookup[t.account_id]
        rate   = calc_earn_rate(bonus_by_name, base, t.points_category, cat_parent_map)
        parent = cat_parent_map.get(t.points_category) if t.points_category else None
        pts    = round(abs(t.amount) * rate, 1)
        points_earn = {
            'points_category':    t.points_category,       # e.g. "Drugstore" or "United"
            'points_category_l1': parent,                  # e.g. None or "Airlines"
            'earn_rate':          rate,                    # total multiplier, e.g. 3.0
            'points_estimated':   pts,                     # e.g. 29.1
            'currency':           currency,                # e.g. "Ultimate Rewards"
            'eco_name':           eco_name,
            'cpp':                your_cpp,                # for value estimate in UI
        }

    return {
        "id": t.id, "date": t.date,
        "description_raw": t.description_raw,
        "description_clean": t.description_clean,
        "description_display": description_display,
        "merchant_name": t.merchant_name,
        "amount": t.amount, "action": t.action,
        "action_display": action_display,
        "category_auto": t.category_auto,
        "category_manual": t.category_manual,
        "category_final": category_display,
        "category_confidence": t.category_confidence,
        "needs_review": t.needs_review,
        "is_locked": bool(t.is_locked or False),
        "is_gcb": bool(t.is_gcb or t.gcb_tagged or False),
        "is_excluded": bool(t.is_excluded or False),
        "is_split": is_split,
        "splits": [
            {"id": s.id, "amount": s.amount, "description": s.description,
             "category": s.category, "action": s.action, "is_gcb": bool(s.is_gcb)}
            for s in splits
        ] if is_split else [],
        "points_category": t.points_category,
        "points_earn":     points_earn,
        "enrichment_source": t.enrichment_source,
        "import_source": t.import_source or ('plaid' if t.plaid_transaction_id else None),
        "import_hash": t.import_hash,
        "account_name": t.account.account_name,
        "account_id": t.account_id,
        "account_type": t.account.account_type,
    }


@app.get("/api/transactions", response_model=List[TransactionResponse])
async def get_transactions(
    skip: int = 0,
    limit: int = 100,
    needs_review: Optional[bool] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
    account_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction).join(Account)
    if needs_review is not None:
        query = query.filter(Transaction.needs_review == needs_review)
    if start_date:
        query = query.filter(Transaction.date >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(Transaction.date <= datetime.fromisoformat(end_date))
    if category:
        # Replicate category_final logic: prefer category_manual, fall back to category_auto
        query = query.filter(
            (Transaction.category_manual == category) |
            ((Transaction.category_manual == None) & (Transaction.category_auto == category))
        )
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    txns = query.order_by(Transaction.date.desc()).offset(skip).limit(limit).all()

    # Batch-load splits for all split transactions in one query
    split_ids = [t.id for t in txns if t.is_split]
    splits_map = {}
    if split_ids:
        all_splits = db.query(TransactionSplit).filter(
            TransactionSplit.parent_transaction_id.in_(split_ids)
        ).all()
        for s in all_splits:
            splits_map.setdefault(s.parent_transaction_id, []).append(s)

    categorizer = CategorizationEngine(db)
    account_ids = list({t.account_id for t in txns})
    points_lookup, cat_parent_map = _build_points_lookup(db, account_ids)
    return [_serialize_txn(t, splits_map, categorizer, points_lookup, cat_parent_map) for t in txns]


# ---------------------------------------------------------------------------
# Transactions: single
# ---------------------------------------------------------------------------

@app.get("/api/transactions/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(transaction_id: int, db: Session = Depends(get_db)):
    t = db.query(Transaction).filter_by(id=transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    splits = db.query(TransactionSplit).filter_by(parent_transaction_id=t.id).all() if t.is_split else []
    categorizer = CategorizationEngine(db)
    points_lookup, cat_parent_map = _build_points_lookup(db, [t.account_id])
    return _serialize_txn(t, {t.id: splits} if splits else {}, categorizer, points_lookup, cat_parent_map)


# ---------------------------------------------------------------------------
# Transactions: update
# ---------------------------------------------------------------------------

@app.patch("/api/transactions/{transaction_id}")
async def update_transaction(
    transaction_id: int,
    update: TransactionUpdate,
    db: Session = Depends(get_db),
):
    t = db.query(Transaction).filter_by(id=transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")

    categorizer  = CategorizationEngine(db)
    old_category = t.category_final
    old_action   = t.action

    if update.category is not None and update.category != t.category_manual:
        t.category_manual = update.category
        t.updated_at      = datetime.utcnow()
        t.is_locked       = True
        if old_category != update.category:
            categorizer.record_correction(t, old_category, update.category, old_action, update.action)

    if update.action is not None:
        t.action     = update.action
        t.updated_at = datetime.utcnow()
        t.is_locked  = True
        # Section 4C: Clear category when type is not Expense/Income
        if update.action not in BUDGET_TYPES:
            t.category_manual = ''
            t.category_auto = ''

    if update.needs_review is not None:
        t.needs_review = update.needs_review
        if not update.needs_review:
            t.reviewed_at = datetime.utcnow()

    if update.is_locked is not None:
        t.is_locked = update.is_locked
    # Update both is_gcb and legacy gcb_tagged to keep in sync (Section 3b)
    if update.is_gcb is not None:
        t.is_gcb = update.is_gcb
        t.gcb_tagged = update.is_gcb  # Keep legacy column in sync
    if update.points_category is not None:
        t.points_category = update.points_category
    if update.is_excluded is not None:
        t.is_excluded = update.is_excluded
        t.updated_at  = datetime.utcnow()

    if update.description_clean is not None:
        t.description_clean = update.description_clean
        t.updated_at = datetime.utcnow()

    db.commit()
    return {"message": "Transaction updated"}


@app.post("/api/transactions/batch-update")
async def batch_update_transactions(
    payload: BatchTransactionUpdate,
    db: Session = Depends(get_db),
):
    """Apply the same classification changes to multiple transactions at once."""
    if not payload.ids:
        raise HTTPException(status_code=400, detail="No transaction IDs provided")

    update = payload.updates
    categorizer = CategorizationEngine(db)
    updated = 0

    for txn_id in payload.ids:
        t = db.query(Transaction).filter_by(id=txn_id).first()
        if not t:
            continue

        old_category = t.category_final
        old_action = t.action

        if update.category is not None:
            if update.category != t.category_manual:
                t.category_manual = update.category
                t.updated_at = datetime.utcnow()
                t.is_locked = True
                if old_category != update.category:
                    categorizer.record_correction(t, old_category, update.category,
                                                  old_action, update.action)

        if update.action is not None:
            t.action = update.action
            t.updated_at = datetime.utcnow()
            t.is_locked = True
            # Clear category when type doesn't support it
            if update.action not in BUDGET_TYPES:
                t.category_manual = ''
                t.category_auto = ''

        if update.needs_review is not None:
            t.needs_review = update.needs_review
            if not update.needs_review:
                t.reviewed_at = datetime.utcnow()

        if update.is_locked is not None:
            t.is_locked = update.is_locked

        if update.is_gcb is not None:
            t.is_gcb = update.is_gcb
            t.gcb_tagged = update.is_gcb

        updated += 1

    db.commit()
    return {"updated": updated}


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@app.get("/api/categories", response_model=List[CategoryResponse])
async def get_categories(db: Session = Depends(get_db)):
    return db.query(Category).filter_by(is_active=True).order_by(Category.display_order).all()


@app.get("/api/transaction-types")
async def get_transaction_types():
    """Return the canonical transaction types and which ones affect budgets/balances."""
    return {
        'types': TRANSACTION_TYPES,
        'budget_types': sorted(BUDGET_TYPES),
        'balance_types': sorted(BALANCE_TYPES),
    }


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@app.get("/api/stats", response_model=StatsResponse)
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
    )
    if year:
        query = query.filter(Transaction.year == year)
    if month:
        query = query.filter(Transaction.month == month)
    if start_date:
        query = query.filter(Transaction.date >= datetime.strptime(start_date, "%Y-%m-%d"))
    if end_date:
        query = query.filter(Transaction.date <= datetime.strptime(end_date, "%Y-%m-%d"))

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
    # This mirrors the logic in /budget/actuals and prevents double-counting.
    total_income = 0.0
    total_expenses = 0.0
    by_category: dict = {}

    for t in transactions:
        if t.action not in BUDGET_TYPES:
            continue
        if t.is_split:
            for s in splits_map.get(t.id, []):
                if s.is_gcb:
                    continue
                if t.action == 'Expense':
                    cat = s.category or t.category_final or 'Other'
                    # charges (s.amount < 0) → -s.amount is positive; credits → negative (nets correctly)
                    contrib = -s.amount
                    total_expenses += contrib
                    by_category[cat] = by_category.get(cat, 0) + contrib
                elif t.action == 'Income':
                    total_income += s.amount
        else:
            if t.is_gcb or t.gcb_tagged:
                continue
            if t.action == 'Expense':
                cat = t.category_final or 'Other'
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


@app.get("/api/stats/detail")
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
        Transaction.action.in_(BUDGET_TYPES),
    )
    if year:
        query = query.filter(Transaction.year == year)
    if month:
        query = query.filter(Transaction.month == month)
    if start_date:
        query = query.filter(Transaction.date >= datetime.strptime(start_date, "%Y-%m-%d"))
    if end_date:
        query = query.filter(Transaction.date <= datetime.strptime(end_date, "%Y-%m-%d"))

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
        if t.is_gcb or t.gcb_tagged:
            continue
        if t.is_split:
            for s in splits_map.get(t.id, []):
                if s.is_gcb:
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


# ---------------------------------------------------------------------------
# Cards
# ---------------------------------------------------------------------------

def _serialize_card(c: Card) -> dict:
    """Standard card serialization including linked account info."""
    linked_account_name = None
    if c.account_id and c.account:
        linked_account_name = c.account.account_name
    elif c.plaid_account_id:
        # Legacy fallback
        linked_account_name = c.plaid_account_id
    payment_account_name = None
    if c.payment_account_id and c.payment_account:
        payment_account_name = c.payment_account.account_name
    return {
        "id": c.id, "card_id": c.card_id, "last_four": c.last_four,
        "issuer": c.issuer, "brand": c.brand, "card_name": c.card_name,
        "network": c.network, "issue_date": c.issue_date,
        "annual_fee": c.annual_fee, "credit_limit": c.credit_limit,
        "statement_close_day": c.statement_close_day,
        "payment_due_day": c.payment_due_day,
        "plaid_account_id": c.plaid_account_id,
        "account_id": c.account_id,
        "linked_account_name": linked_account_name,
        "payment_account_id": c.payment_account_id,
        "payment_account_name": payment_account_name,
        "is_active": c.is_active, "notes": c.notes,
    }


@app.get("/api/cards")
async def get_cards(db: Session = Depends(get_db)):
    cards = db.query(Card).order_by(Card.issuer, Card.card_name).all()
    return [_serialize_card(c) for c in cards]


@app.patch("/api/cards/{card_id}")
async def update_card(card_id: int, updates: dict, db: Session = Depends(get_db)):
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    allowed = ["card_name", "last_four", "statement_close_day", "payment_due_day",
               "credit_limit", "plaid_account_id", "account_id", "payment_account_id",
               "is_active", "notes", "annual_fee"]
    for k, v in updates.items():
        if k in allowed:
            setattr(card, k, v)
    db.commit()
    return {"message": "Updated"}


@app.post("/api/cards/match-accounts")
async def match_cards_to_accounts(db: Session = Depends(get_db)):
    """
    Use Claude to suggest Account↔Card matches based on name, last 4 digits,
    issuer, and institution. Returns suggestions — does NOT auto-apply them.
    User confirms each match via POST /api/cards/{id}/link-account.
    """
    import urllib.request as _ur
    import json as _json

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    cards    = db.query(Card).filter_by(is_active=True).all()
    accounts = db.query(Account).filter_by(is_active=True).all()

    # Build compact representations for Claude
    cards_list = [
        {
            "card_db_id": c.id,
            "card_id": c.card_id,
            "issuer": c.issuer,
            "brand": c.brand,
            "card_name": c.card_name,
            "network": c.network,
            "last_four": c.last_four,
            "already_linked": c.account_id is not None,
        }
        for c in cards
    ]
    accounts_list = [
        {
            "account_db_id": a.id,
            "account_name": a.account_name,
            "official_name": a.official_name,
            "account_type": a.account_type,
            "mask": a.mask,   # Last 4 digits from Plaid
            "is_manual": a.is_manual,
        }
        for a in accounts
    ]

    prompt = f"""You are a financial data assistant. Match each credit/debit card to the most likely bank account.

CARDS (from user's card list):
{_json.dumps(cards_list, indent=2)}

ACCOUNTS (from Plaid/bank connections):
{_json.dumps(accounts_list, indent=2)}

Matching rules:
- last_four on card should match mask on account (both are last 4 digits of the card number)
- issuer/brand on card should match institution in account_name or official_name
- account_type 'credit' matches credit cards; 'checking'/'savings' matches debit cards
- Skip cards where already_linked is true — they are already matched
- Only suggest matches you are confident about (last_four+issuer agreement)
- A card can only match ONE account; an account can only match ONE card

Respond with a JSON array only, no explanation:
[
  {{
    "card_db_id": <int>,
    "account_db_id": <int>,
    "confidence": "high" | "medium" | "low",
    "reason": "<short explanation>"
  }},
  ...
]

If no confident matches exist, return an empty array: []"""

    payload = _json.dumps({
        "model": "claude-haiku-4-5",
        "max_tokens": 1000,
        "system": "You are a financial data assistant. Always respond with valid JSON only, no markdown.",
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")

    req = _ur.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _ur.urlopen(req, timeout=20) as resp:
            body = _json.loads(resp.read().decode("utf-8"))
            text = body["content"][0]["text"].strip()
            # Strip markdown fences if present
            import re as _re
            text = _re.sub(r"^```[a-z]*\n?", "", text)
            text = _re.sub(r"\n?```$", "", text.strip())
            suggestions = _json.loads(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude matching failed: {e}")

    # Enrich suggestions with display info
    card_map    = {c.id: c for c in cards}
    account_map = {a.id: a for a in accounts}
    result = []
    for s in suggestions:
        c = card_map.get(s.get("card_db_id"))
        a = account_map.get(s.get("account_db_id"))
        if not c or not a:
            continue
        result.append({
            "card_db_id":      c.id,
            "card_display":    f"{c.issuer} {c.card_name} (…{c.last_four})",
            "account_db_id":   a.id,
            "account_display": a.account_name,
            "confidence":      s.get("confidence", "low"),
            "reason":          s.get("reason", ""),
        })

    return {"suggestions": result, "total": len(result)}


@app.post("/api/cards/{card_id}/link-account")
async def link_card_to_account(card_id: int, body: dict, db: Session = Depends(get_db)):
    """
    Confirm a card↔account link. Sets Card.account_id and back-fills
    Transaction.card_id for all transactions on that account.
    Pass account_id=null to unlink.
    """
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    account_id = body.get("account_id")  # None to unlink

    if account_id is not None:
        account = db.query(Account).filter_by(id=account_id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        card.account_id      = account_id
        card.plaid_account_id = account.plaid_account_id  # Keep legacy field in sync

        # Back-fill card_id on all existing transactions for this account
        txn_count = db.query(Transaction).filter_by(account_id=account_id).update(
            {"card_id": card_id}, synchronize_session=False
        )
    else:
        # Unlink
        old_account_id  = card.account_id
        card.account_id = None
        txn_count = 0
        if old_account_id:
            txn_count = db.query(Transaction).filter_by(
                account_id=old_account_id, card_id=card_id
            ).update({"card_id": None}, synchronize_session=False)

    db.commit()
    return {
        "status": "linked" if account_id else "unlinked",
        "card_id": card_id,
        "account_id": account_id,
        "transactions_updated": txn_count,
    }


@app.get("/api/cards/{card_id}/detail")
async def get_card_detail(card_id: int, months: int = 3, db: Session = Depends(get_db)):
    """
    Enhanced card detail: account info, earning structure, spending analysis,
    points earned, and recent transactions.
    """
    from sqlalchemy import func as _func
    from collections import defaultdict

    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    # ── Linked account & balance ──────────────────────────────────────────
    account = None
    balance = None
    if card.account_id:
        account = db.query(Account).filter_by(id=card.account_id).first()
    elif card.plaid_account_id:
        account = db.query(Account).filter_by(plaid_account_id=card.plaid_account_id).first()
    if account:
        balance = get_account_balance(db, account.id)

    # ── Product, ecosystem & earning rates ────────────────────────────────
    product = db.query(CardProduct).filter_by(id=card.product_id).first() if card.product_id else None
    ecosystem = None
    eco_id = product.ecosystem_id if product else card.ecosystem_id
    if eco_id:
        eco = db.query(PointsEcosystem).filter_by(id=eco_id).first()
        if eco:
            ecosystem = {
                'id': eco.id, 'name': eco.name, 'currency_name': eco.currency_name,
                'conservative_cpp': eco.conservative_cpp, 'your_cpp': eco.your_cpp,
                'is_cash_back': eco.is_cash_back,
            }

    # Get rewards from product level (preferred) or legacy card-level
    rates = []
    if product:
        rates = db.query(CardProductReward).filter_by(product_id=product.id).all()

    base_rate = 1.0
    category_bonuses = []
    all_categories = db.query(PointsCategory).filter_by(is_active=True)\
        .order_by(PointsCategory.display_order).all()

    for r in rates:
        if r.is_base_rate:
            base_rate = r.multiplier
        else:
            category_bonuses.append({
                'category_id': r.points_category_id,
                'category_name': r.points_category.name if r.points_category else None,
                'additional': r.multiplier,
                'total': base_rate + r.multiplier,
            })

    # Build full earning structure (all categories with their rates)
    bonus_map = {b['category_id']: b for b in category_bonuses}
    earning_structure = []
    for cat in all_categories:
        bonus = bonus_map.get(cat.id)
        earning_structure.append({
            'category': cat.name,
            'category_id': cat.id,
            'base': base_rate,
            'bonus': bonus['additional'] if bonus else 0,
            'total': bonus['total'] if bonus else base_rate,
        })

    # ── Spending analysis (last N months) ─────────────────────────────────
    spending_by_category = []
    points_earned = {'total': 0, 'by_category': []}
    monthly_spend = []
    recent_txns = []

    if account:
        now = datetime.utcnow()
        lookback = datetime(now.year, now.month, 1) - timedelta(days=months * 30)

        # Recent transactions (last 30)
        txns = db.query(Transaction).filter_by(account_id=account.id)\
            .order_by(Transaction.date.desc()).limit(30).all()
        recent_txns = [{
            'id': t.id, 'date': t.date.strftime('%Y-%m-%d'),
            'description': t.description_clean or t.description_raw,
            'amount': t.amount,
            'category': t.category_final, 'action': t.action,
        } for t in txns]

        # Spending by category (charges only — negative amounts for credit cards)
        cat_spend = (
            db.query(
                Transaction.category_final,
                _func.sum(Transaction.amount),
                _func.count(Transaction.id),
            )
            .filter(
                Transaction.account_id == account.id,
                Transaction.date >= lookback,
                Transaction.amount < 0,  # Only charges
            )
            .group_by(Transaction.category_final)
            .all()
        )
        total_spend = 0
        for cat_name, total, count in cat_spend:
            amt = abs(total or 0)
            total_spend += amt
            # Find earning rate for this category
            rate = base_rate
            for es in earning_structure:
                if es['category'].lower() == (cat_name or '').lower():
                    rate = es['total']
                    break
            pts = round(amt * rate, 0)
            spending_by_category.append({
                'category': cat_name or 'Uncategorized',
                'amount': round(amt, 2),
                'count': count,
                'earn_rate': rate,
                'points_earned': pts,
            })
            points_earned['total'] += pts
            points_earned['by_category'].append({
                'category': cat_name or 'Uncategorized',
                'points': pts,
            })
        spending_by_category.sort(key=lambda x: x['amount'], reverse=True)

        # Monthly spending trend
        month_spend = (
            db.query(
                _func.extract('year', Transaction.date).label('yr'),
                _func.extract('month', Transaction.date).label('mo'),
                _func.sum(Transaction.amount),
            )
            .filter(
                Transaction.account_id == account.id,
                Transaction.date >= lookback,
                Transaction.amount < 0,
            )
            .group_by('yr', 'mo')
            .order_by('yr', 'mo')
            .all()
        )
        for yr, mo, total in month_spend:
            monthly_spend.append({
                'month': f"{int(yr)}-{int(mo):02d}",
                'amount': round(abs(total or 0), 2),
            })

    # ── Statement estimate ────────────────────────────────────────────────
    statement_balance = None
    if card.statement_close_day and account:
        today = datetime.utcnow()
        close_day = min(card.statement_close_day, 28)
        if today.day > close_day:
            stmt_start = datetime(today.year, today.month, close_day)
        else:
            m = today.month - 1 if today.month > 1 else 12
            y = today.year if today.month > 1 else today.year - 1
            stmt_start = datetime(y, m, close_day)
        stmt_sum = db.query(_func.sum(Transaction.amount)).filter(
            Transaction.account_id == account.id,
            Transaction.date >= stmt_start,
        ).scalar() or 0.0
        statement_balance = round(stmt_sum, 2)

    # ── Card age ──────────────────────────────────────────────────────────
    card_age_years = None
    if card.issue_date:
        card_age_years = round((datetime.utcnow() - card.issue_date).days / 365.25, 1)

    return {
        'card': {
            'id': card.id, 'card_id': card.card_id, 'card_name': card.card_name,
            'issuer': card.issuer, 'brand': card.brand, 'network': card.network,
            'credit_limit': card.credit_limit,
            'statement_close_day': card.statement_close_day,
            'payment_due_day': card.payment_due_day,
            'annual_fee': card.annual_fee, 'is_active': card.is_active,
            'issue_date': card.issue_date.strftime('%Y-%m-%d') if card.issue_date else None,
            'card_age_years': card_age_years,
            'notes': card.notes,
        },
        'product': {
            'id': product.id,
            'product_key': product.product_key,
            'card_name': product.card_name,
            'status': product.status,
        } if product else None,
        'ecosystem': ecosystem,
        'earning_structure': earning_structure,
        'base_rate': base_rate,
        'benefits': [{
            'id': b.id,
            'name': b.benefit_name,
            'amount': b.amount,
            'reset_frequency': b.reset_frequency,
            'trigger_category': b.trigger_category,
            'notes': b.notes,
        } for b in (product.benefits if product else [])],
        'spend_challenges': [{
            'id': sc.id,
            'name': sc.challenge_name,
            'required_spend': sc.required_spend,
            'reward_value': sc.reward_value,
            'reward_type': sc.reward_type,
            'start_date': sc.start_date.strftime('%Y-%m-%d') if sc.start_date else None,
            'end_date': sc.end_date.strftime('%Y-%m-%d') if sc.end_date else None,
            'current_spend': sc.current_spend,
            'is_met': sc.is_met,
        } for sc in (product.spend_challenges if product else [])],
        'linked_account': {
            'id': account.id, 'name': account.account_name,
            'balance': balance,
        } if account else None,
        'statement_balance': statement_balance,
        'utilization': round(abs(balance) / card.credit_limit * 100, 1) if balance and card.credit_limit else None,
        'spending_by_category': spending_by_category,
        'points_earned': points_earned,
        'monthly_spend': monthly_spend,
        'recent_transactions': recent_txns,
    }


@app.get("/api/cards/swipe-advisor")
async def swipe_advisor(category: Optional[str] = None, db: Session = Depends(get_db)):
    """
    "Where Should I Swipe?" — ranks active cards by value for a given spending category.
    Returns best card for each category, or ranks all cards for a specific category.
    """
    active_cards = db.query(Card).filter_by(is_active=True).all()
    categories = db.query(PointsCategory).filter_by(is_active=True)\
        .order_by(PointsCategory.display_order).all()
    ecosystems = {e.id: e for e in db.query(PointsEcosystem).all()}

    # Build hierarchy lookup: category_id → parent_category_id (for earn-rate waterfall)
    cat_name_to_id = {c.name: c.id for c in categories}
    cat_parent_id  = {c.id: cat_name_to_id.get(c.parent_key) for c in categories}

    # Build earning data per card (from product-level rewards)
    products_cache = {}  # product_id → (base, cat_bonuses)
    card_data = []
    for card in active_cards:
        base = 1.0
        cat_bonuses = {}
        product_id = card.product_id
        if product_id:
            if product_id not in products_cache:
                rates = db.query(CardProductReward).filter_by(product_id=product_id).all()
                _b = 1.0
                _cb = {}
                for r in rates:
                    if r.is_base_rate:
                        _b = r.multiplier
                    elif r.points_category_id:
                        _cb[r.points_category_id] = r.multiplier
                products_cache[product_id] = (_b, _cb)
            base, cat_bonuses = products_cache[product_id]
        eco_id = None
        if product_id:
            prod = db.query(CardProduct).filter_by(id=product_id).first()
            eco_id = prod.ecosystem_id if prod else card.ecosystem_id
        else:
            eco_id = card.ecosystem_id
        eco = ecosystems.get(eco_id) if eco_id else None
        card_data.append({
            'card': card,
            'base': base,
            'cat_bonuses': cat_bonuses,
            'eco': eco,
        })

    def _card_value(cd, cat_id, parent_cat_id=None):
        # Earn-rate waterfall: L2 (brand-specific) → L1 (broad) → base
        l2_bonus = cd['cat_bonuses'].get(cat_id)
        l1_bonus = cd['cat_bonuses'].get(parent_cat_id) if parent_cat_id else None
        bonus = l2_bonus if l2_bonus is not None else (l1_bonus or 0)
        total_rate = cd['base'] + bonus
        eco = cd['eco']
        cons_cpp = eco.conservative_cpp if eco else 1.0
        your_cpp = eco.your_cpp if eco else 1.0
        return {
            'card_id': cd['card'].id,
            'card_name': f"{cd['card'].card_name or cd['card'].brand} {cd['card'].last_four or ''}".strip(),
            'card_display_id': cd['card'].card_id,
            'issuer': cd['card'].issuer,
            'network': cd['card'].network,
            'earn_rate': total_rate,
            'ecosystem': eco.name if eco else 'Unknown',
            'currency': eco.currency_name if eco else 'Points',
            'conservative_value': round(total_rate * cons_cpp, 2),  # cents per dollar
            'your_value': round(total_rate * your_cpp, 2),
        }

    if category:
        # Find the matching category
        cat_match = None
        for c in categories:
            if c.name.lower() == category.lower():
                cat_match = c
                break
        if not cat_match:
            raise HTTPException(status_code=404, detail=f"Category '{category}' not found")

        parent_id = cat_parent_id.get(cat_match.id)
        rankings = [_card_value(cd, cat_match.id, parent_id) for cd in card_data]
        rankings.sort(key=lambda x: x['your_value'], reverse=True)
        return {
            'category': cat_match.name,
            'parent_category': cat_match.parent_key,
            'rankings': rankings[:10],  # Top 10
        }

    # Return best card per category
    results = []
    for cat in categories:
        parent_id = cat_parent_id.get(cat.id)
        rankings = [_card_value(cd, cat.id, parent_id) for cd in card_data]
        rankings.sort(key=lambda x: x['your_value'], reverse=True)
        best = rankings[0] if rankings else None
        runner_up = rankings[1] if len(rankings) > 1 else None
        results.append({
            'category': cat.name,
            'category_id': cat.id,
            'parent_category': cat.parent_key,
            'best': best,
            'runner_up': runner_up,
        })
    return {'categories': results}


@app.get("/api/ecosystems")
async def get_ecosystems(db: Session = Depends(get_db)):
    """Get all points ecosystems with valuations."""
    ecos = db.query(PointsEcosystem).order_by(PointsEcosystem.name).all()
    return [{
        'id': e.id, 'name': e.name, 'currency_name': e.currency_name,
        'conservative_cpp': e.conservative_cpp, 'your_cpp': e.your_cpp,
        'is_cash_back': e.is_cash_back,
    } for e in ecos]


@app.patch("/api/ecosystems/{eco_id}")
async def update_ecosystem(eco_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    """Update ecosystem valuation (cpp values)."""
    eco = db.query(PointsEcosystem).filter_by(id=eco_id).first()
    if not eco:
        raise HTTPException(status_code=404, detail="Ecosystem not found")
    if 'conservative_cpp' in data:
        eco.conservative_cpp = float(data['conservative_cpp'])
    if 'your_cpp' in data:
        eco.your_cpp = float(data['your_cpp'])
    if 'currency_name' in data:
        eco.currency_name = data['currency_name']
    db.commit()
    return {'status': 'ok', 'name': eco.name}


# ---------------------------------------------------------------------------
# Account → Product linking & card detail
# ---------------------------------------------------------------------------

@app.get("/api/card-products")
async def list_card_products(db: Session = Depends(get_db)):
    """List all card products in the catalog for the product-linking dropdown."""
    products = db.query(CardProduct).order_by(CardProduct.card_name).all()
    eco_map = {e.id: e.name for e in db.query(PointsEcosystem).all()}
    return [{
        'id': p.id,
        'product_key': p.product_key,
        'card_name': p.card_name,
        'ecosystem': eco_map.get(p.ecosystem_id, ''),
        'status': p.status,
    } for p in products]


@app.get("/api/accounts/product-suggestions")
async def suggest_products_for_accounts(db: Session = Depends(get_db)):
    """
    Auto-suggest card products for credit card accounts based on name matching.
    Returns suggestions for accounts that don't have a product linked yet.
    """
    accounts = db.query(Account).filter(
        Account.is_active == True,
        Account.product_id.is_(None),
        Account.account_type.ilike('%credit%'),
    ).all()

    products = db.query(CardProduct).all()

    suggestions = []
    for acct in accounts:
        name = (acct.account_name or '').lower()
        official = (acct.official_name or '').lower()

        best_match = None
        best_score = 0

        for prod in products:
            score = 0
            pname = prod.card_name.lower()
            pkey = prod.product_key.lower()

            # Exact product name match
            if pname in name or pname in official:
                score = 100
            # Key word matching
            else:
                words = pname.split()
                matched = sum(1 for w in words if len(w) > 2 and (w in name or w in official))
                if matched > 0:
                    score = (matched / len(words)) * 80

                # Issuer matching boost
                issuer_map = {
                    'chase': ['chase'], 'amex': ['amex', 'american express'],
                    'citi': ['citi', 'citibank'], 'discover': ['discover'],
                    'hilton': ['hilton'], 'hyatt': ['hyatt'], 'marriott': ['marriott'],
                    'capital_one': ['capital one'], 'fidelity': ['fidelity'],
                    'best_buy': ['best buy'],
                }
                for key, patterns in issuer_map.items():
                    if key in pkey:
                        if any(p in name or p in official for p in patterns):
                            score += 20

            if score > best_score and score >= 30:
                best_score = score
                best_match = prod

        if best_match:
            suggestions.append({
                'account_id': acct.id,
                'account_name': acct.account_name,
                'official_name': acct.official_name,
                'mask': acct.mask,
                'suggested_product_id': best_match.id,
                'suggested_product_name': best_match.card_name,
                'confidence': 'high' if best_score >= 70 else 'medium' if best_score >= 50 else 'low',
                'score': best_score,
            })

    suggestions.sort(key=lambda x: x['score'], reverse=True)
    return suggestions


@app.post("/api/accounts/{account_id}/link-product")
async def link_account_to_product(account_id: int, body: dict, db: Session = Depends(get_db)):
    """
    Link a bank account to a card product.
    This is the primary way users associate their Plaid accounts with
    specific card products (e.g., "Amex 1009 is an Amex Platinum").
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    product_id = body.get('product_id')
    if product_id is None:
        # Unlink
        account.product_id = None
        db.commit()
        return {"status": "unlinked", "account_id": account_id}

    product = db.query(CardProduct).filter_by(id=product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    account.product_id = product_id

    # Also link any Card row that references this account
    card = db.query(Card).filter_by(account_id=account_id).first()
    if card:
        card.product_id = product_id
        if product.ecosystem_id:
            card.ecosystem_id = product.ecosystem_id

    db.commit()
    return {
        "status": "linked",
        "account_id": account_id,
        "product_id": product_id,
        "product_name": product.card_name,
    }


@app.get("/api/accounts/{account_id}/card-detail")
async def account_card_detail(account_id: int, months: int = 3, db: Session = Depends(get_db)):
    """
    Card detail page driven by account (not card).
    This is the main entry point for viewing card product info for an account.
    If the account has a linked product, shows full earning structure + spending analysis.
    """
    from sqlalchemy import func as _func
    from datetime import timedelta

    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Find product — either from account.product_id or through Card
    product = None
    card = None
    if account.product_id:
        product = db.query(CardProduct).filter_by(id=account.product_id).first()

    # Also find Card row for this account
    card = db.query(Card).filter_by(account_id=account_id).first()
    if not product and card and card.product_id:
        product = db.query(CardProduct).filter_by(id=card.product_id).first()

    # Ecosystem
    ecosystem = None
    if product and product.ecosystem_id:
        eco = db.query(PointsEcosystem).filter_by(id=product.ecosystem_id).first()
        if eco:
            ecosystem = {
                'id': eco.id, 'name': eco.name, 'currency_name': eco.currency_name,
                'eco_type': eco.eco_type, 'conservative_cpp': eco.conservative_cpp,
                'your_cpp': eco.your_cpp, 'is_cash_back': eco.is_cash_back,
            }

    # Earning structure
    all_categories = db.query(PointsCategory).filter_by(is_active=True)\
        .order_by(PointsCategory.display_order).all()
    base_rate = 1.0
    category_bonuses = []
    earning_structure = []

    if product:
        rates = db.query(CardProductReward).filter_by(product_id=product.id).all()
        for r in rates:
            if r.is_base_rate:
                base_rate = r.multiplier
            elif r.points_category_id:
                category_bonuses.append({
                    'category_id': r.points_category_id,
                    'additional': r.multiplier,
                    'total': base_rate + r.multiplier,
                })

        bonus_map = {b['category_id']: b for b in category_bonuses}
        for cat in all_categories:
            bonus = bonus_map.get(cat.id)
            earning_structure.append({
                'category': cat.name,
                'category_id': cat.id,
                'base': base_rate,
                'bonus': bonus['additional'] if bonus else 0,
                'total': bonus['total'] if bonus else base_rate,
            })

    # Account balance
    balance = get_account_balance(db, account.id)

    # Pre-build structures needed for earn-rate calc
    # bonus_by_name: {category_name: additional_multiplier} for this card product
    # cat_parent_map: {category_name: parent_key} for the L2→L1 waterfall
    bonus_by_name: dict[str, float] = {}
    cat_parent_map: dict[str, str | None] = {c.name: c.parent_key for c in all_categories}
    if product:
        for r in db.query(CardProductReward).filter_by(product_id=product.id).all():
            if not r.is_base_rate and r.points_category:
                bonus_by_name[r.points_category.name] = r.multiplier

    # Spending analysis
    spending_by_category = []
    points_earned = {'total': 0, 'by_category': []}
    monthly_spend = []
    recent_txns = []

    now = datetime.utcnow()
    lookback = datetime(now.year, now.month, 1) - timedelta(days=months * 30)

    # Recent transactions (last 30) — include points_category for display
    txns = db.query(Transaction).filter_by(account_id=account.id)\
        .order_by(Transaction.date.desc()).limit(30).all()
    recent_txns = [{
        'id': t.id, 'date': t.date.strftime('%Y-%m-%d'),
        'description': t.description_clean or t.description_raw,
        'amount': t.amount,
        'category': t.category_manual or t.category_auto,
        'points_category': t.points_category,
        'action': t.action,
        'earn_rate': calc_earn_rate(bonus_by_name, base_rate, t.points_category, cat_parent_map),
    } for t in txns]

    # Spending grouped by points_category — uses the waterfall for accurate earn rates.
    # Transactions with NULL points_category are grouped under None (base rate applies).
    pts_cat_spend = (
        db.query(
            Transaction.points_category,
            _func.sum(Transaction.amount),
            _func.count(Transaction.id),
        )
        .filter(
            Transaction.account_id == account.id,
            Transaction.date >= lookback,
            Transaction.amount > 0,
            Transaction.action == 'Expense',
        )
        .group_by(Transaction.points_category)
        .all()
    )
    for pts_cat_name, total, count in pts_cat_spend:
        amt = round(total or 0, 2)
        rate = calc_earn_rate(bonus_by_name, base_rate, pts_cat_name, cat_parent_map)
        pts = round(amt * rate, 0)
        label = pts_cat_name or 'Other'
        spending_by_category.append({
            'category': label,
            'amount': amt,
            'count': count,
            'earn_rate': rate,
            'points_earned': pts,
        })
        points_earned['total'] += pts
        points_earned['by_category'].append({'category': label, 'points': pts})
    spending_by_category.sort(key=lambda x: x['amount'], reverse=True)

    # Monthly spending
    month_spend = (
        db.query(
            _func.extract('year', Transaction.date).label('yr'),
            _func.extract('month', Transaction.date).label('mo'),
            _func.sum(Transaction.amount),
        )
        .filter(
            Transaction.account_id == account.id,
            Transaction.date >= lookback,
            Transaction.amount > 0,
            Transaction.action == 'Expense',
        )
        .group_by('yr', 'mo').order_by('yr', 'mo').all()
    )
    for yr, mo, total in month_spend:
        monthly_spend.append({'month': f"{int(yr)}-{int(mo):02d}", 'amount': round(abs(total or 0), 2)})

    # Benefits
    benefits = []
    if product:
        benefits = [{
            'id': b.id, 'name': b.benefit_name, 'amount': b.amount,
            'reset_frequency': b.reset_frequency, 'trigger_category': b.trigger_category,
            'notes': b.notes,
        } for b in product.benefits]

    # Spend challenges
    spend_challenges = []
    if product:
        spend_challenges = [{
            'id': sc.id, 'name': sc.challenge_name,
            'required_spend': sc.required_spend, 'reward_value': sc.reward_value,
            'reward_type': sc.reward_type,
            'start_date': sc.start_date.strftime('%Y-%m-%d') if sc.start_date else None,
            'end_date': sc.end_date.strftime('%Y-%m-%d') if sc.end_date else None,
            'current_spend': sc.current_spend, 'is_met': sc.is_met,
        } for sc in product.spend_challenges]

    # Utilization
    utilization = None
    if card and card.credit_limit and balance:
        utilization = round(abs(balance) / card.credit_limit * 100, 1)
    elif account.account_type and 'credit' in account.account_type.lower():
        # Try to get credit limit from liability data
        if account.liability_last_statement_bal:
            pass  # No credit limit available without card row

    return {
        'account': {
            'id': account.id, 'name': account.account_name,
            'type': account.account_type, 'mask': account.mask,
            'balance': balance,
        },
        'card': {
            'id': card.id, 'card_name': card.card_name,
            'issuer': card.issuer, 'brand': card.brand, 'network': card.network,
            'credit_limit': card.credit_limit,
            'statement_close_day': card.statement_close_day,
            'payment_due_day': card.payment_due_day,
            'annual_fee': card.annual_fee, 'is_active': card.is_active,
            'issue_date': card.issue_date.strftime('%Y-%m-%d') if card.issue_date else None,
            'card_age_years': round((datetime.utcnow() - card.issue_date).days / 365.25, 1) if card and card.issue_date else None,
            'notes': card.notes,
        } if card else None,
        'product': {
            'id': product.id, 'product_key': product.product_key,
            'card_name': product.card_name, 'status': product.status,
        } if product else None,
        'ecosystem': ecosystem,
        'earning_structure': earning_structure,
        'base_rate': base_rate,
        'benefits': benefits,
        'spend_challenges': spend_challenges,
        'utilization': utilization,
        'spending_by_category': spending_by_category,
        'points_earned': points_earned,
        'monthly_spend': monthly_spend,
        'recent_transactions': recent_txns,
    }


@app.get("/api/cards/validate-plaid")
async def validate_cards_plaid(db: Session = Depends(get_db)):
    """Check which cards have plaid_account_id that matches an actual Account.plaid_account_id."""
    cards = db.query(Card).filter_by(is_active=True).all()
    results = []
    for c in cards:
        linked_account = None
        warning = None
        if c.plaid_account_id:
            account = db.query(Account).filter_by(plaid_account_id=c.plaid_account_id).first()
            if account:
                linked_account = {'id': account.id, 'name': account.account_name}
            else:
                warning = f"plaid_account_id '{c.plaid_account_id}' does not match any account"
        results.append({
            'card_id': c.id,
            'card_name': c.card_name,
            'plaid_account_id': c.plaid_account_id,
            'linked_account': linked_account,
            'warning': warning,
        })
    return results


@app.get("/api/points-categories")
async def get_points_categories(db: Session = Depends(get_db)):
    cats = db.query(PointsCategory).order_by(PointsCategory.display_order).all()
    return [{"id": c.id, "name": c.name} for c in cats]


@app.post("/api/init/import-cards")
async def import_cards_endpoint(db: Session = Depends(get_db)):
    """Import cards from the local cards.xlsx file."""
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "cards.xlsx")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="cards.xlsx not found")
    n = import_cards_from_excel(path, db)
    return {"imported": n, "total": db.query(Card).count()}


@app.post("/api/cards/upload-and-import")
async def upload_and_import_cards(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a cards.xlsx file, save it, and import cards from it (Section 7B)."""
    import tempfile
    import shutil

    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be .xlsx or .xls")

    # Save to the working directory as cards.xlsx
    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.join(here, "cards.xlsx")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    n = import_cards_from_excel(dest, db)
    return {"imported": n, "total": db.query(Card).count(), "message": f"Uploaded and imported {n} cards"}


@app.post("/api/points/upload-and-import")
async def upload_and_import_points(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a points Excel file and import ecosystems + earning rates."""
    import shutil

    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be .xlsx or .xls")

    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.join(here, "points.xlsx")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    result = import_points_from_excel(dest, db)
    return {**result, "message": f"Imported {result['ecosystems_imported']} ecosystems, {result['cards_with_rates']} card earning rates"}


# ---------------------------------------------------------------------------
# Init / maintenance
# ---------------------------------------------------------------------------

@app.post("/api/init/import-rules")
async def import_rules(db: Session = Depends(get_db)):
    here = os.path.dirname(os.path.abspath(__file__))
    excel_path = os.path.join(here, "i_e_v9_2_2026.xlsx")
    if not os.path.exists(excel_path):
        raise HTTPException(status_code=404, detail=f"Excel file not found at {excel_path}")
    try:
        load_rules_from_excel(excel_path, db)
        return {"message": "Rules imported successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/init/upload-rules")
async def upload_rules(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Upload an Excel rules file and immediately import + re-categorize all transactions.
    Use this to load your rules into Railway where the local file is unavailable.
    """
    import tempfile
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="File must be an Excel file (.xlsx or .xls)")
    try:
        content = await file.read()
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        rule_count = load_rules_from_excel(tmp_path, db)
        os.unlink(tmp_path)

        # Re-categorize all unlocked transactions with the new rules
        cat_engine = CategorizationEngine(db)
        transactions = db.query(Transaction).filter(Transaction.is_locked == False).all()
        for t in transactions:
            action, category, confidence, display_desc = cat_engine.categorize(
                t.description_raw, t.amount, t.merchant_name,
                account_type=(t.account.account_type if t.account else ''),
            )
            t.action              = action
            t.category_auto       = '' if action == 'Transfer' else category
            t.category_confidence = confidence
            t.description_clean   = display_desc or cat_engine.clean_description(t.description_raw)
            t.needs_review        = False if action == 'Transfer' else (confidence < 0.8 or category == 'Unclassified')
            t.enrichment_source   = 'rule' if confidence >= 0.85 else t.enrichment_source
        db.commit()

        return {
            "message": f"Imported {rule_count} rules and re-categorized {len(transactions)} transactions",
            "rules_imported": rule_count,
            "transactions_recategorized": len(transactions),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# CSV / OFX Transaction Import  (Option B + preview)
# ---------------------------------------------------------------------------

def _compute_import_hash(account_id: int, date_str: str, amount: float, description: str, occurrence: int) -> str:
    """
    Stable dedup key: SHA-256 of pipe-joined key fields.
    occurrence handles true duplicate rows (same day/amount/desc within one account).
    """
    import hashlib
    raw = f"{account_id}|{date_str}|{round(amount, 2):.2f}|{description.strip().lower()}|{occurrence}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _parse_csv_rows(content: bytes, account_id: int, sign_convention: str) -> list[dict]:
    """
    Parse CSV bytes into normalised row dicts.
    Tries to auto-detect common column name patterns used by major banks/cards.
    sign_convention: 'plaid' (expenses negative), 'bank' (expenses positive, income negative),
                     'auto' (detect from amount values — if most non-zero amounts are positive, flip)
    Returns list of {date, amount, description, raw_row}.
    """
    import csv, io as _io

    text = content.decode("utf-8-sig", errors="replace")  # handle BOM
    reader = csv.DictReader(_io.StringIO(text))
    headers = [h.strip().lower() for h in (reader.fieldnames or [])]

    # Column name aliases for common banks
    DATE_ALIASES   = ['date', 'transaction date', 'trans date', 'posted date', 'posting date', 'settlement date']
    AMT_ALIASES    = ['amount', 'transaction amount', 'debit/credit', 'net amount']
    DEBIT_ALIASES  = ['debit', 'debit amount', 'withdrawal', 'withdrawals']
    CREDIT_ALIASES = ['credit', 'credit amount', 'deposit', 'deposits']
    DESC_ALIASES   = ['description', 'transaction description', 'merchant', 'merchant name',
                      'name', 'memo', 'payee', 'details', 'narrative']

    def pick(aliases):
        for a in aliases:
            if a in headers:
                return reader.fieldnames[[h.strip().lower() for h in reader.fieldnames].index(a)]
        return None

    date_col   = pick(DATE_ALIASES)
    amt_col    = pick(AMT_ALIASES)
    debit_col  = pick(DEBIT_ALIASES)
    credit_col = pick(CREDIT_ALIASES)
    desc_col   = pick(DESC_ALIASES)

    if not date_col or not desc_col:
        raise ValueError(f"Cannot find date/description columns. Headers found: {reader.fieldnames}")
    if not amt_col and not (debit_col and credit_col):
        raise ValueError(f"Cannot find amount column(s). Headers found: {reader.fieldnames}")

    rows = []
    for row in reader:
        raw_date = row.get(date_col, '').strip()
        raw_desc = row.get(desc_col, '').strip()
        if not raw_date or not raw_desc:
            continue

        # Parse date — try common formats
        parsed_date = None
        for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%d/%m/%Y', '%Y/%m/%d', '%m-%d-%Y', '%d-%m-%Y'):
            try:
                parsed_date = datetime.strptime(raw_date, fmt)
                break
            except ValueError:
                continue
        if not parsed_date:
            continue  # skip unparseable dates

        # Parse amount
        def clean_num(s):
            return float(s.replace('$', '').replace(',', '').strip() or '0')

        if amt_col:
            try:
                amount = clean_num(row.get(amt_col, '0'))
            except ValueError:
                continue
        else:
            try:
                debit  = clean_num(row.get(debit_col,  '') or '0')
                credit = clean_num(row.get(credit_col, '') or '0')
                # Debit = money out (expense), credit = money in (income)
                amount = credit - debit  # result: positive = income, negative = expense
            except ValueError:
                continue

        # Apply sign convention
        if sign_convention == 'bank':
            # Bank statements: debits shown as positive → flip to our negative-expense convention
            amount = -amount
        elif sign_convention == 'auto':
            # Will be resolved after full parse; store as-is for now
            pass
        # 'plaid' → no flip needed (already negative for expenses)

        rows.append({
            'date': parsed_date,
            'date_str': parsed_date.strftime('%Y-%m-%d'),
            'amount': round(amount, 2),
            'description': raw_desc,
        })

    # Auto sign detection: if most expenses look positive, flip all
    if sign_convention == 'auto' and rows:
        positives = sum(1 for r in rows if r['amount'] > 0)
        if positives > len(rows) * 0.6:
            # Majority positive → likely bank convention, flip
            for r in rows:
                r['amount'] = -r['amount']

    return rows


def _parse_ofx_rows(content: bytes, account_id: int) -> list[dict]:
    """
    Parse OFX/QFX bytes into normalised row dicts.
    OFX uses SGML-like tags: <DTPOSTED>, <TRNAMT>, <NAME>/<MEMO>.
    OFX sign convention: negative = debit/expense, positive = credit/income — matches ours.
    """
    import re
    text = content.decode("utf-8-sig", errors="replace")

    def extract(tag, block):
        m = re.search(rf'<{tag}>(.*?)(?:<|$)', block, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else ''

    # Find all STMTTRN blocks
    blocks = re.findall(r'<STMTTRN>(.*?)</STMTTRN>', text, re.IGNORECASE | re.DOTALL)
    rows = []
    for block in blocks:
        raw_date = extract('DTPOSTED', block) or extract('DTUSER', block)
        raw_amt  = extract('TRNAMT', block)
        name     = extract('NAME', block) or extract('MEMO', block) or extract('PAYEE', block)

        if not raw_date or not raw_amt:
            continue

        # OFX date: YYYYMMDD[HHMMSS[.mmm][ZZZ]]
        date_str = raw_date[:8]
        try:
            parsed_date = datetime.strptime(date_str, '%Y%m%d')
        except ValueError:
            continue

        try:
            amount = round(float(raw_amt.replace(',', '')), 2)
        except ValueError:
            continue

        rows.append({
            'date': parsed_date,
            'date_str': parsed_date.strftime('%Y-%m-%d'),
            'amount': amount,
            'description': name or 'Unknown',
        })

    return rows


def _build_preview(rows: list[dict], account_id: int, db: Session) -> dict:
    """
    Given normalised rows, compute import hashes, check against existing transactions,
    and return a preview dict: {to_import, duplicates, rows}.
    """
    # Count occurrences of (date_str, amount, description) within this batch
    from collections import Counter
    seen_counter: Counter = Counter()
    result_rows = []

    # Pre-load existing hashes for this account for fast lookup
    existing_hashes = {
        h for (h,) in db.query(Transaction.import_hash)
        .filter(Transaction.account_id == account_id, Transaction.import_hash != None)
        .all()
    }
    # Also consider hashes we've already generated in this batch (within-batch dedup)
    batch_hashes: set[str] = set()

    for row in rows:
        key = (row['date_str'], round(row['amount'], 2), row['description'].strip().lower())
        occurrence = seen_counter[key]
        seen_counter[key] += 1

        h = _compute_import_hash(account_id, row['date_str'], row['amount'], row['description'], occurrence)

        is_duplicate = (h in existing_hashes) or (h in batch_hashes)
        batch_hashes.add(h)

        result_rows.append({
            **row,
            'import_hash': h,
            'duplicate': is_duplicate,
        })

    to_import  = [r for r in result_rows if not r['duplicate']]
    duplicates = [r for r in result_rows if r['duplicate']]

    return {
        'total_rows': len(result_rows),
        'to_import': len(to_import),
        'duplicates': len(duplicates),
        'rows': result_rows,
    }


@app.post("/api/transactions/import")
async def import_transactions(
    file: UploadFile = File(...),
    account_id: int = 0,
    sign_convention: str = 'auto',   # 'auto' | 'plaid' | 'bank'
    preview_only: bool = True,        # True = dry run, False = commit
    db: Session = Depends(get_db),
):
    """
    Import transactions from a CSV or OFX/QFX file.

    Two-phase flow:
      1. POST with preview_only=true  → returns preview (counts + rows, nothing written)
      2. POST with preview_only=false → commits non-duplicate rows, runs categorisation + LLM

    sign_convention:
      'auto'  — detect from data (default)
      'plaid' — amounts already negative for expenses
      'bank'  — amounts positive for debits (most bank CSV exports)

    Deduplication: SHA-256 hash of (account_id, date, amount, description, occurrence).
    Existing Plaid transactions are never touched.
    """
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id is required")

    account = db.query(Account).filter_by(id=account_id, is_active=True).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    content = await file.read()
    fname   = (file.filename or '').lower()

    # Parse based on file type
    try:
        if fname.endswith(('.ofx', '.qfx')):
            rows = _parse_ofx_rows(content, account_id)
            file_type = 'ofx'
        else:
            rows = _parse_csv_rows(content, account_id, sign_convention)
            file_type = 'csv'
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not rows:
        raise HTTPException(status_code=422, detail="No parseable rows found in file. Check column headers.")

    preview = _build_preview(rows, account_id, db)

    if preview_only:
        # Return preview without writing anything
        return {
            'preview': True,
            'file_type': file_type,
            'account_id': account_id,
            'account_name': account.account_name,
            'sign_convention': sign_convention,
            **{k: v for k, v in preview.items() if k != 'rows'},
            # Return first 50 rows for display (avoid huge payloads)
            'sample_rows': [
                {
                    'date': r['date_str'],
                    'amount': r['amount'],
                    'description': r['description'],
                    'duplicate': r['duplicate'],
                }
                for r in preview['rows'][:50]
            ],
        }

    # ── Commit phase ─────────────────────────────────────────────────────────
    categorizer = CategorizationEngine(db)
    llm_key = os.getenv("ANTHROPIC_API_KEY", "")

    # Pre-load GCB/points rules
    rules_with_notes = db.query(CategorizationRule).filter(
        CategorizationRule.is_active == True,
        CategorizationRule.notes != None,
        CategorizationRule.notes != '',
    ).all()

    imported = 0
    skipped  = 0
    llm_calls = 0

    for row in preview['rows']:
        if row['duplicate']:
            skipped += 1
            continue

        txn_date  = row['date']
        amount    = row['amount']
        desc_raw  = row['description']
        imp_hash  = row['import_hash']

        # Categorise with rules engine
        action, category, confidence, display_desc = categorizer.categorize(
            desc_raw, amount, None,
            account_type=account.account_type or '',
        )

        # Apply GCB / points tags from rule notes
        desc_upper = desc_raw.upper()
        gcb_auto   = False
        points_cat = None
        for rule in rules_with_notes:
            if rule.pattern and rule.pattern.upper() in desc_upper:
                if 'gcb:true' in (rule.notes or ''):
                    gcb_auto = True
                if 'points:' in (rule.notes or ''):
                    points_cat = rule.notes.split('points:')[1].split(',')[0].strip()

        # LLM enrichment for unclassified non-transfers
        llm_source         = None
        description_clean  = display_desc or categorizer.clean_description(desc_raw)
        merchant_name      = None

        needs_llm = action != 'Transfer' and (not display_desc or category == 'Unclassified')
        if needs_llm and llm_key:
            try:
                result_llm = _call_groq(desc_raw, llm_key)
                if result_llm:
                    merchant_name     = str(result_llm.get("merchant_name") or "").strip() or None
                    description_clean = str(result_llm.get("description_clean") or "").strip() or description_clean
                    raw_cat           = str(result_llm.get("category") or "").strip()
                    category          = raw_cat if raw_cat in VALID_CATEGORIES else 'Unclassified'
                    llm_source        = 'llm'
                    confidence        = 0.75
                    llm_calls        += 1
            except Exception:
                pass

        # Auto-infer points category from merchant name when no rule provided one.
        # CSV imports have no Plaid PFC, so merchant_name is the only signal here.
        if not points_cat:
            points_cat = infer_points_category(merchant_name)

        # Determine enrichment source
        if llm_source:
            final_source = 'llm'
        elif display_desc or (category and category != 'Unclassified'):
            final_source = 'rule'
        else:
            final_source = 'fallback'

        # needs_review logic
        if action == 'Transfer':
            needs_review_flag = False
        elif final_source in ('llm', 'fallback'):
            needs_review_flag = True
        else:
            needs_review_flag = confidence < 0.85 or category == 'Unclassified'

        linked_card_id = account.card.id if account.card else None

        txn = Transaction(
            plaid_transaction_id = None,
            import_hash          = imp_hash,
            import_source        = file_type,
            account_id           = account_id,
            date                 = txn_date,
            year                 = txn_date.year,
            month                = txn_date.month,
            day                  = txn_date.day,
            amount               = amount,
            description_raw      = desc_raw,
            description_clean    = description_clean,
            merchant_name        = merchant_name,
            action               = action,
            category_auto        = '' if action == 'Transfer' else category,
            category_manual      = None,
            category_confidence  = confidence,
            needs_review         = needs_review_flag,
            enrichment_source    = final_source,
            is_gcb               = gcb_auto,
            gcb_tagged           = gcb_auto,
            points_category      = points_cat,
            card_id              = linked_card_id,
            is_locked            = False,
        )
        db.add(txn)
        imported += 1

    db.commit()

    return {
        'preview': False,
        'file_type': file_type,
        'account_id': account_id,
        'account_name': account.account_name,
        'total_rows': preview['total_rows'],
        'imported': imported,
        'skipped_duplicates': skipped,
        'llm_calls': llm_calls,
    }


@app.post("/api/init/recategorize")
async def recategorize_all(db: Session = Depends(get_db)):
    cat_engine = CategorizationEngine(db)
    transactions = db.query(Transaction).filter(Transaction.is_locked == False).all()
    for t in transactions:
        action, category, confidence, display_desc = cat_engine.categorize(
            t.description_raw, t.amount, t.merchant_name,
            account_type=(t.account.account_type if t.account else ''),
        )
        t.action              = action
        t.category_auto       = '' if action == 'Transfer' else category
        t.category_confidence = confidence
        t.description_clean   = display_desc or cat_engine.clean_description(t.description_raw)
        t.needs_review        = False if action == 'Transfer' else (confidence < 0.8 or category == 'Unclassified')
    db.commit()
    return {"message": f"Re-categorized {len(transactions)} transactions"}


@app.post("/api/init/fix-signs")
async def fix_transaction_signs(db: Session = Depends(get_db)):
    """Flip signs on transactions imported with wrong Plaid sign convention."""
    cat_engine   = CategorizationEngine(db)
    transactions = db.query(Transaction).filter(Transaction.is_locked == False).all()
    fixed = 0
    for t in transactions:
        needs_flip = (
            (t.action == 'Expense' and t.amount > 0) or
            (t.action == 'Income'  and t.amount < 0)
        )
        if needs_flip:
            t.amount = -t.amount
            action, category, confidence, display_desc = cat_engine.categorize(
                t.description_raw, t.amount, t.merchant_name,
                account_type=(t.account.account_type if t.account else ''),
            )
            t.action              = action
            t.category_auto       = '' if action == 'Transfer' else category
            t.category_confidence = confidence
            t.needs_review        = False if action == 'Transfer' else confidence < 0.8
            fixed += 1
    db.commit()
    return {"fixed": fixed, "total": len(transactions)}


# ---------------------------------------------------------------------------
# Categorization Rules CRUD (Section 2D)
# ---------------------------------------------------------------------------

@app.get("/api/rules")
async def list_rules(
    skip: int = 0,
    limit: int = 200,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List categorization rules with optional pattern search."""
    query = db.query(CategorizationRule).filter_by(is_active=True)
    if search:
        query = query.filter(CategorizationRule.pattern.ilike(f"%{search}%"))
    rules = query.order_by(CategorizationRule.priority, CategorizationRule.priority_order)\
        .offset(skip).limit(limit).all()
    return [{
        'id': r.id,
        'priority': r.priority,
        'priority_order': r.priority_order or 0,
        'match_type': r.match_type,
        'pattern': r.pattern,
        'set_action': r.set_action,
        'set_category': r.set_category,
        'set_description': r.set_description,
        'clean_description': r.clean_description,
        'notes': r.notes,
        'times_matched': r.times_matched,
        'times_accepted': r.times_accepted,
        'times_rejected': r.times_rejected,
    } for r in rules]


def _reapply_rules(db: Session, force_unlock: bool = False) -> dict:
    """
    Re-run the categorization engine on transactions.

    Normal mode (force_unlock=False):
      - Only processes non-locked, non-manually-edited transactions.

    Force mode (force_unlock=True):
      - Also processes locked/manual transactions IF a rule now matches them.
        Clears category_manual and is_locked so the rule takes over,
        exactly as if the rule had been in place from the start.

    Returns {'updated': N, 'total': M, 'unlocked': K}.
    """
    categorizer = CategorizationEngine(db)

    # Always process unlocked, non-manual transactions
    txns = db.query(Transaction).filter(
        Transaction.is_locked == False,
        Transaction.category_manual == None,
    ).all()

    # In force mode also check system-locked transactions (transfer corrections) for new
    # rule matches.  Transactions where the user explicitly set category_manual are always
    # respected — a new rule never clobbers a conscious user edit.
    locked_txns = []
    if force_unlock:
        locked_txns = db.query(Transaction).filter(
            Transaction.is_locked == True,
            Transaction.category_manual == None,   # system-locked only, not user-manual edits
        ).all()

    updated = 0
    unlocked = 0

    for t in txns:
        action, category, confidence, display_desc = categorizer.categorize(
            t.description_raw, t.amount, t.merchant_name,
            account_type=(t.account.account_type if t.account else ''),
        )
        desc_clean = display_desc or categorizer.clean_description(t.description_raw)
        llm_category = '' if action == 'Transfer' else category
        source = 'rule' if confidence >= 0.85 else 'fallback'
        if (t.description_clean != desc_clean or
                t.category_auto != llm_category or
                t.action != action or
                t.enrichment_source != source):
            t.description_clean = desc_clean
            t.category_auto     = llm_category
            t.action            = action
            t.category_confidence = confidence
            t.enrichment_source   = source
            updated += 1

    for t in locked_txns:
        matched_rule = categorizer.match_rule(t.description_raw, t.amount)
        if not matched_rule:
            continue  # Rule doesn't match — keep manual override intact
        action, category, confidence, display_desc = categorizer.categorize(
            t.description_raw, t.amount, t.merchant_name,
            account_type=(t.account.account_type if t.account else ''),
        )
        desc_clean = display_desc or categorizer.clean_description(t.description_raw)
        llm_category = '' if action == 'Transfer' else category
        # Clear the manual override so the rule governs this transaction going forward
        t.category_manual   = None
        t.is_locked         = False
        t.description_clean = desc_clean
        t.category_auto     = llm_category
        t.action            = action
        t.category_confidence = confidence
        t.enrichment_source   = 'rule'
        unlocked += 1
        updated += 1

    db.commit()
    return {'updated': updated, 'total': len(txns) + len(locked_txns), 'unlocked': unlocked}


@app.post("/api/rules/reapply")
async def reapply_rules(db: Session = Depends(get_db)):
    """Re-apply all active rules to every non-locked, non-manually-edited transaction."""
    return _reapply_rules(db)


@app.post("/api/rules/clean-descriptions")
async def clean_all_descriptions(db: Session = Depends(get_db)):
    """
    Sync description_clean for every transaction to the best available display name.

    Priority order for each transaction:
      1. Rule set_description — IF it is set AND different from the raw description
         (if the user left the display name as the full noisy raw string, skip it)
      2. noise-stripped clean_description(description_raw) — always available
         and will strip PPD IDs, long numbers, PAYROLL suffixes, etc.

    Updates whenever the computed name differs from what is currently stored,
    so it also fixes transactions where description_clean == description_raw
    (LLM copied it verbatim without cleaning).

    Only touches description_clean. Never modifies category, action, is_locked,
    or category_manual. Safe to run at any time; idempotent.
    """
    categorizer = CategorizationEngine(db)
    all_txns = db.query(Transaction).filter(Transaction.description_raw != None).all()
    updated = 0

    for t in all_txns:
        raw = (t.description_raw or '').strip()
        if not raw:
            continue

        matched_rule = categorizer.match_rule(raw, t.amount)

        # Determine the best display name
        if (matched_rule
                and matched_rule.set_description
                and matched_rule.set_description.strip().upper() != raw.upper()):
            # Rule has a real custom display name (not just a copy of the raw description)
            wanted = matched_rule.set_description.strip()
        else:
            # Fall back to noise-stripped version — removes PPD ID, long numbers, etc.
            wanted = categorizer.clean_description(raw)

        if wanted and t.description_clean != wanted:
            t.description_clean = wanted
            updated += 1

    db.commit()
    return {'updated': updated, 'total': len(all_txns)}


@app.post("/api/rules")
async def create_rule(data: dict, db: Session = Depends(get_db)):
    """Create a new categorization rule."""
    rule = CategorizationRule(
        priority=data.get('priority', 100),
        priority_order=data.get('priority_order', 0),
        match_type=data.get('match_type', 'contains'),
        pattern=data.get('pattern', ''),
        set_action=data.get('set_action'),
        set_category=data.get('set_category'),
        set_description=data.get('set_description'),
        clean_description=data.get('clean_description'),
        notes=data.get('notes'),
        is_active=True,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    # force_unlock=True: if the new rule matches a previously-locked transaction,
    # clear the manual override so the rule takes over for all history.
    reapplied = _reapply_rules(db, force_unlock=True)
    return {'id': rule.id, 'message': 'Rule created', 'reapplied': reapplied}


@app.patch("/api/rules/{rule_id}")
async def update_rule(rule_id: int, data: dict, db: Session = Depends(get_db)):
    """Update an existing categorization rule."""
    rule = db.query(CategorizationRule).filter_by(id=rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    allowed = ['priority', 'priority_order', 'match_type', 'pattern',
               'set_action', 'set_category', 'set_description', 'clean_description',
               'notes', 'is_active']
    for k, v in data.items():
        if k in allowed:
            setattr(rule, k, v)
    rule.updated_at = datetime.utcnow()
    db.commit()
    reapplied = _reapply_rules(db)
    return {'message': 'Rule updated', 'reapplied': reapplied}


@app.delete("/api/rules/{rule_id}")
async def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    """Deactivate a categorization rule (soft delete)."""
    rule = db.query(CategorizationRule).filter_by(id=rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rule.is_active = False
    rule.updated_at = datetime.utcnow()
    db.commit()
    return {'message': 'Rule deactivated'}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@app.get("/api/export/csv")
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
        query = query.filter(Transaction.date <= datetime.fromisoformat(end_date))

    data = [
        {
            'Date': t.date.strftime('%Y-%m-%d'), 'Description': t.description_raw,
            'Amount': t.amount, 'Action': t.action, 'Category': t.category_final,
            'Account': t.account.account_name, 'GCB': t.gcb_tagged,
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


# ---------------------------------------------------------------------------
# Accounts: list all + manual creation
# ---------------------------------------------------------------------------

@app.get("/api/accounts")
async def list_accounts(db: Session = Depends(get_db)):
    """List all active accounts (Plaid + manual) with classification flags."""
    from sqlalchemy import func as _func
    accounts = db.query(Account).filter_by(is_active=True).order_by(Account.created_at).all()
    # Batch-load transaction counts (one query, not N+1)
    counts = dict(
        db.query(Transaction.account_id, _func.count(Transaction.id))
        .group_by(Transaction.account_id).all()
    )
    result = []
    for a in accounts:
        d = serialize_account(a, counts.get(a.id, 0))
        d['balance'] = get_account_balance(db, a.id)
        result.append(d)
    return result


@app.post("/api/accounts")
async def create_manual_account(data: AccountCreate, db: Session = Depends(get_db)):
    """
    Create a manual account (Section 2b).
    Manual accounts have plaid_account_id = NULL, is_manual = True.
    """
    account = Account(
        plaid_account_id=None,
        plaid_item_id=None,
        account_name=data.name,
        account_type=data.account_type,
        starting_balance=data.starting_balance,
        start_date=datetime.strptime(data.start_date, "%Y-%m-%d"),
        notes=data.notes,
        is_manual=True,
        is_active=True,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return {"id": account.id, "account_name": account.account_name, "message": "Manual account created"}


@app.patch("/api/accounts/{account_id}")
async def update_account(account_id: int, updates: dict, db: Session = Depends(get_db)):
    """Update editable account fields (nickname, notes, starting_balance, start_date)."""
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    allowed = ['account_name', 'notes', 'starting_balance', 'start_date', 'account_type']
    anchor_changed = False
    for k, v in updates.items():
        if k in allowed:
            if k == 'start_date' and v:
                setattr(account, k, datetime.strptime(v, "%Y-%m-%d"))
                anchor_changed = True
            else:
                setattr(account, k, v)
                if k == 'starting_balance':
                    anchor_changed = True
    db.commit()
    # Whenever the anchor (starting_balance / start_date) changes, rebuild monthly
    # snapshots so the balance history reflects the corrected starting point.
    if anchor_changed:
        rebuild_monthly_snapshots(db, account.id)
        db.commit()
    return {"message": "Account updated"}


# ---------------------------------------------------------------------------
# Per-account controls  (Change 4)
# Route order matters: static paths must come BEFORE /{id} patterns
# ---------------------------------------------------------------------------

@app.post("/api/accounts/rebuild-all-snapshots")
async def rebuild_all_snapshots(db: Session = Depends(get_db)):
    """
    Rebuild monthly balance snapshots for ALL active accounts.
    Non-destructive — safe to run any time. Use after bulk resyncs.
    """
    accounts = db.query(Account).filter_by(is_active=True).all()
    rebuilt = 0
    for acct in accounts:
        try:
            rebuild_monthly_snapshots(db, acct.id)
            rebuilt += 1
        except Exception as e:
            print(f"[rebuild-all-snapshots] account {acct.id} failed: {e}")
    db.commit()
    return {"rebuilt": True, "accounts_rebuilt": rebuilt}


@app.post("/api/accounts/{account_id}/reset-and-resync")
async def reset_and_resync_account(
    account_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Non-destructive re-download: reset the Plaid sync cursor so the next sync
    re-fetches all transactions from the beginning.  Existing transactions are
    NOT deleted — the sync loop will match them by content_hash and adopt the
    new Plaid IDs, preserving all user work (category, notes, locks, splits).

    Only truly new transactions (no content-hash match) will be inserted.

    NOTE: cursor reset affects ALL accounts sharing the same Plaid item
    (i.e. the same bank connection). This is unavoidable — Plaid's cursor is
    per-item, not per-account.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.is_manual:
        raise HTTPException(status_code=400, detail="Account is manual — nothing to resync")
    if not account.plaid_item_id:
        raise HTTPException(status_code=400, detail="Account has no Plaid item — reconnect first")

    # Reset cursor so the next sync re-fetches from the beginning.
    # Existing transactions are preserved; the content-hash fallback in
    # _sync_item() will match them and adopt new Plaid IDs without duplication.
    item = db.query(PlaidItem).filter_by(item_id=account.plaid_item_id).first()
    if item:
        item.cursor = None

    db.commit()

    # Kick off background resync for the whole item
    if item:
        background_tasks.add_task(_sync_item_background, item.item_id, False)

    return {
        "status": "resync started",
        "note": "Cursor reset — all transactions will re-download and be matched by content hash. No data deleted.",
    }


@app.post("/api/accounts/{account_id}/rebuild-snapshots")
async def rebuild_account_snapshots(account_id: int, db: Session = Depends(get_db)):
    """
    Rebuild monthly balance snapshots for a single account.
    Non-destructive — safe to run any time. Use when Daily Balances looks wrong.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    months_built = rebuild_monthly_snapshots(db, account_id)
    db.commit()
    return {"rebuilt": True, "months_built": months_built}


@app.post("/api/accounts/{account_id}/sever-plaid")
async def sever_plaid_connection(account_id: int, db: Session = Depends(get_db)):
    """
    Sever Plaid connection for an account (Section 6A).
    Converts the account to manual, preserving all transactions.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if not account.plaid_account_id:
        raise HTTPException(status_code=400, detail="Account is not Plaid-linked")

    account.plaid_account_id = None
    account.plaid_item_id = None
    account.is_manual = True
    db.commit()
    return {"message": f"Plaid connection severed for {account.account_name}. Account is now manual."}


@app.post("/api/accounts/{account_id}/merge-into/{target_id}")
async def merge_accounts(account_id: int, target_id: int, db: Session = Depends(get_db)):
    """
    Merge source account into target: reassign all transactions and card links,
    then delete the source account. Used to clean up duplicate accounts.
    """
    source = db.query(Account).filter_by(id=account_id).first()
    target = db.query(Account).filter_by(id=target_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source account not found")
    if not target:
        raise HTTPException(status_code=404, detail="Target account not found")
    if source.id == target.id:
        raise HTTPException(status_code=400, detail="Cannot merge account into itself")

    # Reassign all transactions to target
    txn_count = db.query(Transaction).filter_by(account_id=account_id).update(
        {'account_id': target_id}, synchronize_session=False
    )
    # Reassign any card links
    db.query(Card).filter_by(account_id=account_id).update(
        {'account_id': target_id, 'plaid_account_id': target.plaid_account_id},
        synchronize_session=False,
    )
    # Delete source account
    db.delete(source)
    db.commit()
    return {"merged": True, "transactions_moved": txn_count,
            "source": account_id, "target": target_id}


def _find_duplicate_pairs(db: Session):
    """
    Shared helper used by both detect and merge endpoints.
    Returns (mergeable_groups, ignored_groups).

    Filters applied:
      1. official_name WARN (not skip): if both accounts have a non-empty official_name
         that differs, the pair is shown with a "warning" flag so the user can decide.
         Previously this silently skipped pairs — that caused the Amex merge disaster
         (backend acted on pairs that never appeared in the UI).
      2. Ignore list: pairs recorded in duplicate_ignore are placed in
         ignored_groups instead of mergeable_groups.

    Each group dict has: mask, account_type, accounts (list), keep_id, discard_ids,
    and optionally "warning" (str) for name-mismatch pairs.
    """
    from sqlalchemy import func as _func

    ignored_pairs = {
        frozenset((r.account_id_a, r.account_id_b))
        for r in db.query(DuplicateIgnore).all()
    }

    dup_keys = (
        db.query(Account.mask, Account.account_type)
        .filter(Account.is_active == True, Account.mask != None, Account.mask != '')
        .group_by(Account.mask, Account.account_type)
        .having(_func.count(Account.id) > 1)
        .all()
    )

    mergeable = []
    ignored = []

    for mask, acct_type in dup_keys:
        accounts = (
            db.query(Account)
            .filter(Account.is_active == True, Account.mask == mask, Account.account_type == acct_type)
            .order_by(Account.id)
            .all()
        )

        def _acct_info(a):
            txn_count = db.query(Transaction).filter_by(account_id=a.id).count()
            card_count = db.query(Card).filter_by(account_id=a.id).count()
            return {
                'id': a.id,
                'name': a.account_name,
                'official_name': a.official_name,
                'persistent_account_id': a.persistent_account_id,
                'mask': a.mask,
                'account_type': a.account_type,
                'plaid_account_id': a.plaid_account_id,
                'plaid_item_id': a.plaid_item_id,
                'is_manual': a.is_manual,
                'transaction_count': txn_count,
                'card_count': card_count,
            }

        keep = accounts[0]
        keep_info = _acct_info(keep)
        for discard in accounts[1:]:
            discard_info = _acct_info(discard)
            pair = frozenset((keep.id, discard.id))

            # User-ignored pair → separate list (no longer silently skipped by official_name)
            if pair in ignored_pairs:
                ignored.append({
                    'mask': mask, 'account_type': acct_type,
                    'accounts': [keep_info, discard_info],
                    'keep_id': keep.id, 'discard_ids': [discard.id],
                })
                continue

            # Warn (don't skip) when official_names differ — user decides
            ko = (keep.official_name or '').strip()
            do = (discard.official_name or '').strip()
            warning = None
            if ko and do and ko.lower() != do.lower():
                warning = f'Different product names ("{ko}" vs "{do}") — confirm before merging'

            entry = {
                'mask': mask, 'account_type': acct_type,
                'accounts': [keep_info, discard_info],
                'keep_id': keep.id, 'discard_ids': [discard.id],
            }
            if warning:
                entry['warning'] = warning

            mergeable.append(entry)

    mergeable.sort(key=lambda g: g['mask'])
    return mergeable, ignored


@app.get("/api/accounts/detect-duplicates")
async def detect_duplicate_accounts(db: Session = Depends(get_db)):
    """
    Find groups of active accounts that appear to be duplicates.
    Applies official_name guard and user ignore list — same filters as merge.
    """
    groups, ignored = _find_duplicate_pairs(db)
    return {'duplicates': groups, 'count': len(groups), 'ignored': ignored}


@app.post("/api/accounts/ignore-duplicate-pair")
async def ignore_duplicate_pair(body: dict, db: Session = Depends(get_db)):
    """
    Permanently mark two accounts as NOT duplicates.
    The pair is stored in duplicate_ignore and will never appear in the scan again.
    """
    id_a = int(body.get('account_id_a', 0))
    id_b = int(body.get('account_id_b', 0))
    if not id_a or not id_b or id_a == id_b:
        raise HTTPException(status_code=400, detail="Provide two different account IDs")
    lo, hi = min(id_a, id_b), max(id_a, id_b)
    existing = db.query(DuplicateIgnore).filter_by(account_id_a=lo, account_id_b=hi).first()
    if not existing:
        db.add(DuplicateIgnore(account_id_a=lo, account_id_b=hi))
        db.commit()
    return {'ignored': True, 'account_id_a': lo, 'account_id_b': hi}


@app.delete("/api/accounts/ignore-duplicate-pair")
async def unignore_duplicate_pair(body: dict, db: Session = Depends(get_db)):
    """Remove a pair from the ignore list so it appears in future scans."""
    id_a = int(body.get('account_id_a', 0))
    id_b = int(body.get('account_id_b', 0))
    lo, hi = min(id_a, id_b), max(id_a, id_b)
    db.query(DuplicateIgnore).filter_by(account_id_a=lo, account_id_b=hi).delete()
    db.commit()
    return {'unignored': True}


def _do_merge_pair(keep_id: int, discard_id: int, db: Session) -> dict:
    """
    Core merge logic — move transactions and cards from discard → keep,
    adopt Plaid IDs from discard, delete discard, rebuild snapshots.
    Raises HTTPException on bad inputs; returns result dict on success.
    """
    from sqlalchemy import text as _text

    keep    = db.query(Account).filter_by(id=keep_id).first()
    discard = db.query(Account).filter_by(id=discard_id).first()
    if not keep:
        raise HTTPException(status_code=404, detail=f"Keep account {keep_id} not found")
    if not discard:
        raise HTTPException(status_code=404, detail=f"Discard account {discard_id} not found")
    if keep_id == discard_id:
        raise HTTPException(status_code=400, detail="keep_id and discard_id must differ")

    # 1. Move all transactions to canonical account
    txn_count = db.query(Transaction).filter_by(account_id=discard.id).update(
        {'account_id': keep.id}, synchronize_session=False
    )
    # 2. Move card links to canonical account
    db.query(Card).filter_by(account_id=discard.id).update(
        {'account_id': keep.id, 'plaid_account_id': keep.plaid_account_id},
        synchronize_session=False,
    )
    # 3. Capture discard values before deletion
    new_plaid_account_id = discard.plaid_account_id
    new_plaid_item_id    = discard.plaid_item_id
    discard_name         = discard.account_name
    # 4. Remove discard from ORM session before raw DELETE (frees UNIQUE constraint)
    db.expunge(discard)
    db.execute(_text("DELETE FROM accounts WHERE id = :id"), {"id": discard_id})
    # 5. Adopt the freed Plaid IDs onto keep so future syncs route here
    if new_plaid_account_id:
        db.execute(_text(
            "UPDATE accounts SET plaid_account_id=:pid, plaid_item_id=:iid, is_manual=false WHERE id=:kid"
        ), {"pid": new_plaid_account_id, "iid": new_plaid_item_id, "kid": keep.id})
        db.expire(keep)

    db.commit()

    try:
        rebuild_monthly_snapshots(db, keep.id)
    except Exception as e:
        print(f"[merge-pair] snapshot rebuild failed for account {keep.id}: {e}")

    return {
        'merged': True,
        'kept':       {'id': keep.id,   'name': keep.account_name},
        'discarded':  {'id': discard_id, 'name': discard_name},
        'transactions_moved': txn_count,
    }


@app.post("/api/accounts/merge-pair")
async def merge_one_pair(body: dict, db: Session = Depends(get_db)):
    """
    Merge exactly one duplicate pair selected by the user.
    Body: {keep_id: int, discard_id: int}
    Moves all transactions and card links from discard → keep,
    adopts discard's Plaid IDs onto keep, deletes discard, rebuilds snapshots.
    """
    keep_id    = body.get('keep_id')
    discard_id = body.get('discard_id')
    if not keep_id or not discard_id:
        raise HTTPException(status_code=400, detail="Provide keep_id and discard_id")
    return _do_merge_pair(int(keep_id), int(discard_id), db)


@app.post("/api/accounts/merge-duplicates")
async def merge_duplicate_accounts(body: dict, db: Session = Depends(get_db)):
    """
    Merge an explicit list of duplicate pairs.
    Body: {pair_ids: [{keep_id, discard_id}, ...]}
    Requires an explicit list — no silent "merge everything detected" behaviour.
    """
    pair_ids = body.get('pair_ids')
    if not pair_ids:
        raise HTTPException(
            status_code=400,
            detail="pair_ids is required — provide [{keep_id, discard_id}, ...] to specify which pairs to merge"
        )

    results = []
    for pair in pair_ids:
        keep_id    = pair.get('keep_id')
        discard_id = pair.get('discard_id')
        if not keep_id or not discard_id:
            continue
        try:
            result = _do_merge_pair(int(keep_id), int(discard_id), db)
            results.append(result)
        except HTTPException as e:
            results.append({'error': e.detail, 'keep_id': keep_id, 'discard_id': discard_id})

    return {'merged': results, 'count': len([r for r in results if r.get('merged')])}


@app.delete("/api/accounts/{account_id}")
async def delete_account(account_id: int, db: Session = Depends(get_db)):
    """
    Permanently delete an account and ALL its transactions.
    Also nulls out any card links that pointed to this account.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    txn_count = db.query(Transaction).filter_by(account_id=account_id).count()
    # Null card links first (FK constraint)
    db.query(Card).filter_by(account_id=account_id).update(
        {'account_id': None, 'plaid_account_id': None}, synchronize_session=False
    )
    # Delete all transactions
    db.query(Transaction).filter_by(account_id=account_id).delete(synchronize_session=False)
    # Delete account
    db.delete(account)
    db.commit()
    return {"deleted": True, "transactions_deleted": txn_count}


# ---------------------------------------------------------------------------
# Balance Sync + Monthly Snapshots
# ---------------------------------------------------------------------------

@app.post("/api/accounts/sync-balances")
async def sync_account_balances(force: bool = False, db: Session = Depends(get_db)):
    """
    Fetch today's balances from Plaid and rebuild all monthly snapshots.

    Normal mode (force=False): only writes the Plaid anchor for NEW accounts
    (accounts with no start_date yet).  Existing accounts keep their current anchor —
    the balance is instead derived from the transaction-based monthly snapshots.
    This avoids the "stale Plaid balance" problem where Plaid's reported balance
    lags behind our transaction data by several days (e.g. after a long weekend).

    Force mode (force=True): re-anchors ALL accounts from today's Plaid balance.
    Use only when you know Plaid's balance is current and you want to hard-reset.
    """
    plaid = setup_plaid_from_env()
    items = db.query(PlaidItem).filter_by(is_active=True).all()
    synced = []
    skipped = []
    for item in items:
        try:
            plaid_accounts = plaid.get_accounts(item.access_token)
        except Exception as e:
            print(f"[balance-sync] fetch failed for {item.institution_name}: {e}")
            continue
        for pa in plaid_accounts:
            raw_balance = pa.get('balance')
            if raw_balance is None:
                skipped.append({'name': pa['name'], 'reason': 'null balance from Plaid'})
                continue
            account = db.query(Account).filter_by(plaid_account_id=pa['account_id']).first()
            if not account:
                skipped.append({'name': pa['name'], 'reason': 'no matching account in DB'})
                continue
            signed_balance = _sign_plaid_balance(raw_balance, account.account_type)
            anchor_updated = False
            if force or account.start_date is None:
                # Force resync OR first-time setup: calibrate offset from Plaid.
                # offset = plaid_balance − SUM(all txns), so computed = plaid.
                # In normal (non-force) mode we preserve the existing anchor so
                # that a stale Plaid balance cannot corrupt the running history.
                from sqlalchemy import func as _sbf2
                _txn_sum = (db.query(_sbf2.sum(Transaction.amount))
                            .filter(Transaction.account_id == account.id)
                            .scalar() or 0.0)
                account.starting_balance = round(signed_balance - _txn_sum, 4)
                account.start_date = None  # Legacy model
                anchor_updated = True
            db.flush()
            months_built = rebuild_monthly_snapshots(db, account.id)
            db.flush()
            # Compute the transaction-derived balance after snapshots are rebuilt
            # so we can surface any discrepancy vs. Plaid's reported number.
            computed_balance = get_account_balance(db, account.id)
            delta = round(computed_balance - signed_balance, 2)
            # Record a balance observation for reconciliation tracking
            db.add(BalanceObservation(
                account_id=account.id,
                observed_at=datetime.utcnow(),
                plaid_balance=round(signed_balance, 4),
                computed_balance=round(computed_balance, 2),
                delta=delta,
                source='balance_sync',
            ))
            synced.append({
                '_account_id': account.id,
                'name': account.account_name,
                'account_type': account.account_type or '',
                'plaid_balance': signed_balance,
                'computed_balance': computed_balance,
                'delta': delta,
                'anchor_updated': anchor_updated,
                'months_built': months_built,
                'is_manual': False,
                'source': 'plaid',
            })
    db.commit()

    # Ensure every active DB account appears — even if Plaid returned a null
    # balance, the connection failed, or the account is manual.
    synced_ids = {e['_account_id'] for e in synced}
    all_accounts = db.query(Account).filter_by(is_active=True).all()
    for acct in all_accounts:
        if acct.id in synced_ids:
            continue
        computed_balance = get_account_balance(db, acct.id)
        is_manual = bool(acct.is_manual) or not acct.plaid_account_id
        synced.append({
            '_account_id': acct.id,
            'name': acct.account_name,
            'account_type': acct.account_type or '',
            'plaid_balance': None,
            'computed_balance': computed_balance,
            'delta': None,
            'anchor_updated': False,
            'months_built': 0,
            'is_manual': is_manual,
            # 'plaid_unavailable' = has a Plaid link but balance couldn't be fetched
            'source': 'manual' if is_manual else 'plaid_unavailable',
        })

    # Strip internal tracking field, sort A–Z
    for e in synced:
        e.pop('_account_id', None)
    synced.sort(key=lambda a: (a['name'] or '').lower())

    return {'synced': len(synced), 'skipped': len(skipped), 'accounts': synced, 'skipped_details': skipped}


@app.get("/api/reconciliation")
async def get_reconciliation_data(db: Session = Depends(get_db)):
    """
    Per-account reconciliation data: latest observation, drift history,
    and observation statistics.  Powers a reconciliation dashboard.
    """
    accounts = db.query(Account).filter_by(is_active=True).all()
    result = []
    for acct in accounts:
        latest = (
            db.query(BalanceObservation)
            .filter_by(account_id=acct.id)
            .order_by(BalanceObservation.observed_at.desc())
            .first()
        )
        recent = (
            db.query(BalanceObservation)
            .filter_by(account_id=acct.id)
            .order_by(BalanceObservation.observed_at.desc())
            .limit(60)
            .all()
        )
        obs_count = db.query(BalanceObservation).filter_by(account_id=acct.id).count()
        # Find last time drift was near zero
        last_reconciled = None
        for o in recent:
            if o.delta is not None and abs(o.delta) < 0.02:
                last_reconciled = o.observed_at.isoformat()
                break
        result.append({
            'account_id': acct.id,
            'account_name': acct.account_name,
            'account_type': acct.account_type,
            'latest': {
                'plaid_balance': latest.plaid_balance,
                'computed_balance': latest.computed_balance,
                'delta': latest.delta,
                'observed_at': latest.observed_at.isoformat(),
                'source': latest.source,
            } if latest else None,
            'drift_history': [
                {'date': o.observed_at.isoformat(), 'delta': o.delta, 'plaid': o.plaid_balance, 'computed': o.computed_balance}
                for o in reversed(recent)  # chronological order
            ],
            'observation_count': obs_count,
            'last_reconciled': last_reconciled,
        })
    result.sort(key=lambda r: abs(r['latest']['delta']) if r.get('latest') else 0, reverse=True)
    return {'accounts': result}


@app.post("/api/reconciliation/{account_id}/reanchor")
async def reanchor_from_observation(account_id: int, db: Session = Depends(get_db)):
    """
    Re-anchor an account's balance from the most recent Plaid observation.
    This corrects accumulated drift by resetting the anchor to Plaid's
    reported balance, then rebuilding all monthly snapshots.

    Use when the reconciliation panel shows significant drift for an account.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    obs = (
        db.query(BalanceObservation)
        .filter_by(account_id=account_id)
        .order_by(BalanceObservation.observed_at.desc())
        .first()
    )
    if not obs:
        raise HTTPException(status_code=404, detail="No balance observations — sync first")
    old_balance = get_account_balance(db, account_id)

    # ── Calibration approach ─────────────────────────────────────────────
    # Instead of guessing which date the Plaid balance corresponds to
    # (unreliable due to variable lag), we calibrate the offset:
    #
    #   starting_balance = plaid_balance − SUM(all transactions)
    #   start_date = None  (legacy model — no date cutoff)
    #
    # This guarantees: computed = starting_balance + SUM(all txns) = plaid_balance
    # As new transactions sync, they naturally increase the balance.
    # On the next re-anchor/sync, we can recalibrate if needed.
    from sqlalchemy import func as _func

    total_txn_sum = (
        db.query(_func.sum(Transaction.amount))
        .filter(Transaction.account_id == account_id)
        .scalar() or 0.0
    )

    account.starting_balance = round(obs.plaid_balance - total_txn_sum, 4)
    account.start_date = None  # Legacy model — include ALL transactions
    db.flush()
    months_built = rebuild_monthly_snapshots(db, account_id)
    db.commit()
    new_balance = get_account_balance(db, account_id)
    return {
        'account_name': account.account_name,
        'old_balance': old_balance,
        'new_balance': new_balance,
        'plaid_balance': obs.plaid_balance,
        'calibrated_offset': account.starting_balance,
        'months_rebuilt': months_built,
        'message': f"Calibrated to Plaid balance ${obs.plaid_balance:,.2f} (offset: ${account.starting_balance:,.4f})",
    }


@app.post("/api/reconciliation/reanchor-all")
async def reanchor_all_accounts(db: Session = Depends(get_db)):
    """
    Re-anchor every account that has a balance observation.
    Uses the calibration approach (offset = plaid_balance - SUM(txns)).
    """
    from sqlalchemy import func as _func

    accounts = db.query(Account).filter_by(is_active=True).all()
    results = []
    for account in accounts:
        obs = (
            db.query(BalanceObservation)
            .filter_by(account_id=account.id)
            .order_by(BalanceObservation.observed_at.desc())
            .first()
        )
        if not obs:
            continue
        old_balance = get_account_balance(db, account.id)
        total_txn_sum = (
            db.query(_func.sum(Transaction.amount))
            .filter(Transaction.account_id == account.id)
            .scalar() or 0.0
        )
        account.starting_balance = round(obs.plaid_balance - total_txn_sum, 4)
        account.start_date = None
        db.flush()
        rebuild_monthly_snapshots(db, account.id)
        new_balance = get_account_balance(db, account.id)
        drift = round(obs.plaid_balance - old_balance, 2)
        results.append({
            'account_name': account.account_name,
            'old_balance': old_balance,
            'new_balance': new_balance,
            'plaid_balance': obs.plaid_balance,
            'drift_corrected': drift,
        })
    db.commit()
    corrected = sum(1 for r in results if r['drift_corrected'] != 0)
    return {
        'total_accounts': len(results),
        'corrected': corrected,
        'results': results,
    }


@app.get("/api/balances/monthly")
async def get_monthly_balances(months: int = 24, db: Session = Depends(get_db)):
    """
    Return monthly opening/closing balance snapshots per account for charting.
    Only returns accounts that have snapshot data.
    """
    from dateutil.relativedelta import relativedelta
    cutoff = datetime.utcnow() - relativedelta(months=months)
    cutoff_ym = cutoff.year * 100 + cutoff.month
    accounts = db.query(Account).filter_by(is_active=True).all()
    result = []
    for account in accounts:
        snapshots = (
            db.query(AccountMonthlySnapshot)
            .filter(
                AccountMonthlySnapshot.account_id == account.id,
                (AccountMonthlySnapshot.year * 100 + AccountMonthlySnapshot.month) >= cutoff_ym,
            )
            .order_by(AccountMonthlySnapshot.year, AccountMonthlySnapshot.month)
            .all()
        )
        if not snapshots:
            continue
        flags = classify_account(account.account_type)
        result.append({
            'account_id': account.id,
            'account_name': account.account_name,
            'account_type': account.account_type,
            'mask': account.mask,
            'is_asset': flags['is_asset'],
            'months': [
                {'year': s.year, 'month': s.month, 'opening': s.opening_balance, 'closing': s.closing_balance}
                for s in snapshots
            ],
        })
    return result


# ---------------------------------------------------------------------------
# Manual Transactions
# ---------------------------------------------------------------------------

@app.post("/api/transactions/manual")
async def create_manual_transaction(data: ManualTransactionCreate, db: Session = Depends(get_db)):
    """
    Create a manual value-change transaction (Section 2c).
    These do NOT auto-categorize, do NOT trigger needs_review,
    and DO affect account balance calculations.
    plaid_transaction_id is NULL for manual transactions.
    """
    account = db.query(Account).filter_by(id=data.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Support both single date (legacy) and multi-date
    date_strings = data.dates if data.dates else ([data.date] if data.date else [])
    if not date_strings:
        raise HTTPException(status_code=400, detail="At least one date is required")

    created_ids = []
    for ds in date_strings:
        txn_date = datetime.strptime(ds, "%Y-%m-%d")
        txn = Transaction(
            plaid_transaction_id=None,
            account_id=account.id,
            date=txn_date,
            amount=data.amount,  # Caller controls the sign
            description_raw=data.description,
            description_clean=data.description,
            action=data.action,
            category_auto=data.category or '',
            category_manual=data.category or '',
            category_confidence=1.0,
            needs_review=False,
            is_locked=True,
            import_source='manual',
            year=txn_date.year,
            month=txn_date.month,
            day=txn_date.day,
        )
        db.add(txn)
        db.flush()
        created_ids.append(txn.id)

        # Create splits if provided
        if data.splits and len(data.splits) > 1:
            txn.is_split = True
            for split_item in data.splits:
                db.add(TransactionSplit(
                    parent_transaction_id=txn.id,
                    amount=split_item.amount,
                    description=split_item.description or '',
                    category=split_item.category or '',
                    action=split_item.action or data.action,
                    is_gcb=split_item.is_gcb,
                ))
            db.flush()

    db.commit()
    return {"ids": created_ids, "count": len(created_ids),
            "message": f"{len(created_ids)} manual transaction(s) created"}



# ---------------------------------------------------------------------------
# Transaction Splits (Section 3a)
# ---------------------------------------------------------------------------

@app.post("/api/transactions/{transaction_id}/splits")
async def create_splits(transaction_id: int, data: SplitsRequest, db: Session = Depends(get_db)):
    """
    Create splits for a transaction (replaces any existing splits).
    Validates that SUM(split amounts) == parent transaction amount.
    Returns 400 if amounts don't balance.
    """
    t = db.query(Transaction).filter_by(id=transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Validate: split amounts must sum to parent amount
    split_total = round(sum(s.amount for s in data.splits), 2)
    parent_amount = round(t.amount, 2)
    if split_total != parent_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Split amounts sum to {split_total}, but parent transaction amount is {parent_amount}. They must be equal."
        )

    # Delete existing splits for this transaction
    db.query(TransactionSplit).filter_by(parent_transaction_id=transaction_id).delete()

    # Create new splits
    for s in data.splits:
        db.add(TransactionSplit(
            parent_transaction_id=transaction_id,
            amount=s.amount,
            description=s.description,
            category=s.category,
            action=s.action,
            is_gcb=s.is_gcb,
            notes=s.notes,
        ))

    # Mark parent as split
    t.is_split = True
    t.updated_at = datetime.utcnow()
    db.commit()
    return {"message": f"Created {len(data.splits)} splits"}


@app.get("/api/transactions/{transaction_id}/splits")
async def get_splits(transaction_id: int, db: Session = Depends(get_db)):
    """List all split line items for a transaction."""
    splits = db.query(TransactionSplit).filter_by(parent_transaction_id=transaction_id).all()
    return [
        {
            "id": s.id,
            "parent_transaction_id": s.parent_transaction_id,
            "amount": s.amount,
            "description": s.description,
            "category": s.category,
            "action": s.action,
            "is_gcb": bool(s.is_gcb),
            "notes": s.notes,
        }
        for s in splits
    ]


@app.delete("/api/transactions/{transaction_id}/splits")
async def delete_splits(transaction_id: int, db: Session = Depends(get_db)):
    """Remove all splits (un-split the transaction)."""
    t = db.query(Transaction).filter_by(id=transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")

    db.query(TransactionSplit).filter_by(parent_transaction_id=transaction_id).delete()
    t.is_split = False
    t.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Splits removed"}


@app.delete("/api/transactions/{transaction_id}")
async def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    """Permanently delete a transaction and its splits. Used to clean up Plaid duplicates."""
    t = db.query(Transaction).filter_by(id=transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    # Clear all FK references before deleting the parent row
    db.query(TransactionSplit).filter_by(parent_transaction_id=transaction_id).delete(synchronize_session=False)
    db.query(UserCorrection).filter_by(transaction_id=transaction_id).delete(synchronize_session=False)
    # Nullify any child Transaction rows (split children stored as Transaction rows)
    db.query(Transaction).filter(Transaction.parent_transaction_id == transaction_id).update(
        {Transaction.parent_transaction_id: None}, synchronize_session=False
    )
    db.delete(t)
    db.commit()
    return {"deleted": True, "id": transaction_id}


# ---------------------------------------------------------------------------
# Budget Targets (Section 4)
# ---------------------------------------------------------------------------

@app.get("/api/budget/targets")
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


@app.post("/api/budget/targets")
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


@app.post("/api/budget/targets/bulk")
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


@app.get("/api/budget/actuals")
async def get_budget_actuals(year: int, db: Session = Depends(get_db)):
    """
    Get actual spending per category per month for a given year.
    - Excludes GCB-tagged transactions (is_gcb = True)
    - Excludes transfers
    - For split transactions: uses split amounts/categories instead of parent
    Returns a dict keyed by category, each containing month→amount mappings.
    """
    from sqlalchemy import and_

    # Get only BUDGET_TYPES transactions (Expense, Income) for the year
    # Exclude is_excluded, GCB-tagged, and Transfer transactions
    txns = db.query(Transaction).filter(
        Transaction.year == year,
        Transaction.action.in_(BUDGET_TYPES),
        Transaction.is_excluded != True,  # noqa: E712
        Transaction.is_gcb != True,       # noqa: E712
    ).all()

    # Build actuals: {category: {month: net_amount}}
    # Expense action: contribution = -t.amount
    #   → charges (amount < 0): -(-X) = +X  (increases total)
    #   → CC credits (amount > 0): -(+X) = -X  (reduces total — nets against charges)
    # Income action: contribution = +t.amount
    actuals = {}

    for t in txns:
        if t.is_split:
            # Use split line items instead of parent transaction
            splits = db.query(TransactionSplit).filter_by(
                parent_transaction_id=t.id
            ).all()
            for s in splits:
                if s.is_gcb:
                    continue  # Skip GCB-tagged splits
                cat = s.category or t.category_final or 'Other'
                month = str(t.month)
                contrib = (-s.amount) if t.action == 'Expense' else s.amount
                if cat not in actuals:
                    actuals[cat] = {}
                actuals[cat][month] = round(actuals[cat].get(month, 0) + contrib, 2)
        else:
            # Skip GCB-tagged whole transactions
            if t.is_gcb or t.gcb_tagged:
                continue
            cat = t.category_final or 'Other'
            month = str(t.month)
            contrib = (-t.amount) if t.action == 'Expense' else t.amount
            if cat not in actuals:
                actuals[cat] = {}
            actuals[cat][month] = round(actuals[cat].get(month, 0) + contrib, 2)

    return {'year': year, 'categories': actuals}


@app.get("/api/budget/suggestions")
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

    # Fetch actuals for each of those months (net signed amounts, excluding is_excluded + GCB)
    totals: dict[str, list] = {}
    for ty, tm in trailing:
        txns = db.query(Transaction).filter(
            Transaction.year == ty,
            Transaction.month == tm,
            Transaction.action.in_(BUDGET_TYPES),
            Transaction.is_excluded != True,  # noqa: E712
            Transaction.is_gcb != True,       # noqa: E712
        ).all()
        month_totals: dict[str, float] = {}
        for t in txns:
            if t.is_split:
                splits = db.query(TransactionSplit).filter_by(
                    parent_transaction_id=t.id
                ).all()
                for s in splits:
                    if s.is_gcb:
                        continue
                    cat = s.category or t.category_final or 'Other'
                    contrib = (-s.amount) if t.action == 'Expense' else s.amount
                    month_totals[cat] = round(month_totals.get(cat, 0) + contrib, 2)
            else:
                if t.is_gcb or t.gcb_tagged:
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


# ---------------------------------------------------------------------------
# Balance Timeline (Section 5 prerequisite)
# ---------------------------------------------------------------------------

@app.get("/api/accounts/{account_id}/balance-timeline")
async def get_balance_timeline(
    account_id: int,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Compute daily running balance for an account.
    Formula: starting_balance + cumulative SUM(transactions) day-by-day.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    starting = account.starting_balance or 0.0
    start_dt = account.start_date

    # Determine date range
    if start:
        range_start = datetime.strptime(start, "%Y-%m-%d")
    elif start_dt:
        range_start = start_dt
    else:
        range_start = datetime(datetime.utcnow().year, 1, 1)

    if end:
        range_end = datetime.strptime(end, "%Y-%m-%d")
    else:
        range_end = datetime.utcnow()

    # ALL transactions — must match the filter used when starting_balance was anchored.
    txns = db.query(Transaction).filter(
        Transaction.account_id == account_id,
        Transaction.date >= range_start,
        Transaction.date <= range_end,
    ).order_by(Transaction.date).all()

    # Group transaction amounts by date
    from collections import defaultdict
    daily = defaultdict(float)
    for t in txns:
        day_key = t.date.strftime('%Y-%m-%d')
        daily[day_key] += t.amount

    # Build running balance timeline
    from datetime import timedelta
    timeline = []
    balance = starting
    current = range_start
    while current <= range_end:
        day_key = current.strftime('%Y-%m-%d')
        change = round(daily.get(day_key, 0), 2)
        balance = round(balance + change, 2)
        timeline.append({'date': day_key, 'change': change, 'balance': balance})
        current += timedelta(days=1)

    return {
        'account_id': account_id,
        'account_name': account.account_name,
        'starting_balance': starting,
        'start_date': start_dt.strftime('%Y-%m-%d') if start_dt else None,
        'timeline': timeline,
    }


# ---------------------------------------------------------------------------
# Balance Reconciliation (Section 5 supplement)
# ---------------------------------------------------------------------------

@app.get("/api/accounts/{account_id}/reconcile")
async def reconcile_account(
    account_id: int,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Bank-statement-style transaction list with running balance, for auditing.

    Uses the same anchor + transactions formula as get_account_balance():
      - Anchor = starting_balance set at start_date (last known-good balance)
      - Live transactions = all transactions strictly after start_date
      - Running balance accumulates only from non-excluded transactions

    Excluded transactions are included in the response (flagged) so the user
    can see what was filtered out and identify wrongly-excluded items.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    anchor      = account.starting_balance or 0.0
    anchor_dt   = account.start_date
    range_end   = (
        datetime.strptime(end, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        if end else datetime.utcnow()
    )

    # Fetch transactions using same filter as get_account_balance anchor model:
    # strictly AFTER the anchor date (transactions ON the anchor day are already
    # included in the Plaid snapshot that set starting_balance).
    query = db.query(Transaction).filter(
        Transaction.account_id == account_id,
        Transaction.date <= range_end,
    )
    if anchor_dt:
        query = query.filter(Transaction.date > anchor_dt)

    txns = query.order_by(Transaction.date, Transaction.id).all()

    # Build per-transaction running balance.
    # Excluded transactions are shown grayed-out but do NOT move the balance.
    running = anchor
    rows = []
    for t in txns:
        excluded = bool(t.is_excluded)
        if not excluded:
            running = round(running + t.amount, 2)
        cat = t.category_manual or t.category_auto or 'Other'
        rows.append({
            'id':              t.id,
            'date':            t.date.strftime('%Y-%m-%d'),
            'description':     t.description_clean or t.description_raw or '',
            'amount':          t.amount,
            'action':          t.action,
            'category':        cat,
            'is_excluded':     excluded,
            'is_locked':       bool(t.is_locked),
            'needs_review':    bool(t.needs_review),
            'running_balance': running,
        })

    excluded_count = sum(1 for r in rows if r['is_excluded'])
    return {
        'account_id':        account_id,
        'account_name':      account.account_name,
        'account_type':      account.account_type,
        'is_manual':         bool(account.is_manual),
        'anchor_balance':    anchor,
        'anchor_date':       anchor_dt.strftime('%Y-%m-%d') if anchor_dt else None,
        'computed_balance':  running,
        'transaction_count': len(rows) - excluded_count,
        'excluded_count':    excluded_count,
        'transactions':      rows,
    }


# ---------------------------------------------------------------------------
# Net Worth (Section 5) — entirely account-driven
# ---------------------------------------------------------------------------

@app.get("/api/net-worth")
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


@app.get("/api/net-worth/timeline")
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


# ---------------------------------------------------------------------------
# Loans (Section 1)
# ---------------------------------------------------------------------------

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


def _compute_pmt_split(balance: float, annual_rate: float, monthly_payment: float,
                        property_tax: float = 0.0, insurance: float = 0.0) -> dict:
    """
    Split a single loan payment into P / I / Tax / Insurance components.
    Uses standard amortization: interest = balance × (annual_rate/12/100).
    """
    monthly_rate = (annual_rate or 0.0) / 100.0 / 12.0
    interest = round(balance * monthly_rate, 2) if monthly_rate > 0 else 0.0
    escrow = round((property_tax or 0.0) + (insurance or 0.0), 2)
    principal = round(monthly_payment - interest - escrow, 2)
    if principal < 0:
        principal = 0.0  # Edge case: payment doesn't cover interest yet
    return {
        'interest': interest,
        'principal': principal,
        'property_tax': round(property_tax or 0.0, 2),
        'insurance': round(insurance or 0.0, 2),
        'total': round(monthly_payment, 2),
    }


def serialize_loan(loan: Loan) -> dict:
    """Standard serialization for a Loan object."""
    return {
        'id': loan.id,
        'account_id': loan.account_id,
        'lender': loan.lender,
        'loan_type': loan.loan_type,
        'original_principal': loan.original_principal,
        'current_balance': loan.current_balance,
        'balance_date': loan.balance_date.strftime('%Y-%m-%d') if loan.balance_date else None,
        'remaining_term_months': loan.remaining_term_months,
        'interest_rate': loan.interest_rate,
        'term_months': loan.term_months,
        'monthly_payment': loan.monthly_payment,
        'property_tax_monthly': loan.property_tax_monthly,
        'insurance_monthly': loan.insurance_monthly,
        'payment_account_id': loan.payment_account_id,
        'payment_due_day': loan.payment_due_day,
        'start_date': loan.start_date.strftime('%Y-%m-%d') if loan.start_date else None,
        'maturity_date': loan.maturity_date.strftime('%Y-%m-%d') if loan.maturity_date else None,
        'is_active': loan.is_active,
        'notes': loan.notes,
        'created_at': loan.created_at.isoformat() if loan.created_at else None,
        # Computed: next payment split (based on current_balance)
        'next_split': _compute_pmt_split(
            loan.current_balance or 0,
            loan.interest_rate or 0,
            loan.monthly_payment or 0,
            loan.property_tax_monthly or 0,
            loan.insurance_monthly or 0,
        ) if loan.monthly_payment else None,
    }


@app.get("/api/loans")
async def list_loans(db: Session = Depends(get_db)):
    """List all active loans."""
    loans = db.query(Loan).filter_by(is_active=True).order_by(Loan.lender).all()
    return [serialize_loan(l) for l in loans]


@app.get("/api/loans/{loan_id}")
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


@app.post("/api/loans")
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


@app.patch("/api/loans/{loan_id}")
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


@app.delete("/api/loans/{loan_id}")
async def delete_loan(loan_id: int, db: Session = Depends(get_db)):
    """Deactivate a loan (soft delete)."""
    loan = db.query(Loan).filter_by(id=loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    loan.is_active = False
    loan.updated_at = datetime.utcnow()
    db.commit()
    return {'message': 'Loan deactivated'}


@app.get("/api/loans/{loan_id}/compute-split")
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


@app.get("/api/loans/{loan_id}/linked-transactions")
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


@app.get("/api/loans/{loan_id}/candidate-transactions")
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


@app.post("/api/loans/{loan_id}/link-transaction")
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


@app.delete("/api/loans/{loan_id}/unlink-transaction/{transaction_id}")
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


# ---------------------------------------------------------------------------
# Cash Flow (Section 2)
# ---------------------------------------------------------------------------

@app.get("/api/cash-flow")
async def get_cash_flow(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Compute cash flow for depository accounts only.
    Returns inflows, outflows, net, CC payments, and loan repayments.
    """
    # Default to current month
    if not start_date:
        now = datetime.utcnow()
        start_date = f"{now.year}-{now.month:02d}-01"
    if not end_date:
        end_date = todayStr_py()

    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date, "%Y-%m-%d")

    # Get depository account IDs (checking, savings, money market, cd)
    depository_types = {'checking', 'savings', 'money market', 'cd'}
    depository_accounts = db.query(Account).filter(
        Account.is_active == True,
        Account.account_type.in_(depository_types),
    ).all()
    dep_ids = [a.id for a in depository_accounts]

    if not dep_ids:
        return {
            'start_date': start_date, 'end_date': end_date,
            'inflows': 0, 'outflows': 0, 'net': 0,
            'cc_payments': 0, 'loan_repayments': 0, 'transactions': [],
        }

    # Get transactions for depository accounts in date range (skip excluded + GCB)
    txns = db.query(Transaction).filter(
        Transaction.account_id.in_(dep_ids),
        Transaction.date >= start_dt,
        Transaction.date <= end_dt,
        Transaction.is_excluded != True,  # noqa: E712
        Transaction.is_gcb != True,       # noqa: E712
    ).order_by(Transaction.date.desc()).all()

    inflows = 0.0
    outflows = 0.0
    cc_payments = 0.0
    loan_repayments = 0.0

    for t in txns:
        if t.amount > 0:
            inflows += t.amount
        else:
            outflows += t.amount  # negative
        # Detect CC payments and loan repayments via description/action
        desc_upper = (t.description_raw or '').upper()
        if t.action == 'Transfer':
            if any(kw in desc_upper for kw in ['CREDIT CRD', 'CREDIT CARD', 'AUTOPAY', 'CC PAYMENT']):
                cc_payments += abs(t.amount)
            elif any(kw in desc_upper for kw in ['LOAN', 'MORTGAGE', 'STUDENT']):
                loan_repayments += abs(t.amount)

    return {
        'start_date': start_date,
        'end_date': end_date,
        'inflows': round(inflows, 2),
        'outflows': round(outflows, 2),
        'net': round(inflows + outflows, 2),
        'cc_payments': round(cc_payments, 2),
        'loan_repayments': round(loan_repayments, 2),
        'transaction_count': len(txns),
    }


def todayStr_py():
    """Return today's date as YYYY-MM-DD string."""
    return datetime.utcnow().strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Cash Flow Overlays
# ---------------------------------------------------------------------------

def _overlay_to_dict(o: CashFlowOverlay) -> dict:
    return {
        "id":             o.id,
        "description":    o.description,
        "amount":         o.amount,
        "flow_date":      o.flow_date.isoformat() if o.flow_date else None,
        "source":         o.source,
        "account_id":     o.account_id,
        "account_name":   o.account.account_name if o.account else None,
        "is_recurring":   o.is_recurring,
        "recurrence_day": o.recurrence_day,
        "is_active":      o.is_active,
    }


@app.get("/api/cash-flow-overlays")
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


@app.post("/api/cash-flow-overlays")
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


@app.patch("/api/cash-flow-overlays/{overlay_id}")
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


@app.delete("/api/cash-flow-overlays/{overlay_id}")
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


@app.post("/api/cash-flow-overlays/generate")
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


# Salary Payments
# ---------------------------------------------------------------------------

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


def _salary_to_dict(sp: SalaryPayment) -> dict:
    return {
        "id":           sp.id,
        "payment_date": sp.payment_date.isoformat(),
        "description":  sp.description,
        "person":       sp.person,
        "is_active":    sp.is_active,
        "allocations":  [
            {
                "id":           a.id,
                "account_id":   a.account_id,
                "account_name": a.account.account_name if a.account else None,
                "amount":       a.amount,
            }
            for a in (sp.allocations or [])
        ],
    }


@app.get("/api/salary-payments")
async def list_salary_payments(db: Session = Depends(get_db)):
    """Return all active salary payments with their per-account allocations."""
    rows = (
        db.query(SalaryPayment)
        .filter(SalaryPayment.is_active == True)
        .order_by(SalaryPayment.payment_date.desc(), SalaryPayment.id)
        .all()
    )
    return [_salary_to_dict(r) for r in rows]


@app.post("/api/salary-payments")
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


@app.patch("/api/salary-payments/{payment_id}")
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


@app.delete("/api/salary-payments/{payment_id}")
async def delete_salary_payment(payment_id: int, db: Session = Depends(get_db)):
    sp = db.query(SalaryPayment).filter_by(id=payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary payment not found")
    db.delete(sp)
    db.commit()
    return {"deleted": payment_id}


# Daily Balances
# ---------------------------------------------------------------------------

@app.get("/api/daily-balances")
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


# ---------------------------------------------------------------------------
# LLM Merchant Enrichment (Section LLM)
# ---------------------------------------------------------------------------

class LLMEnrichRequest(BaseModel):
    limit: int = 50                  # Max transactions to process in one call
    overwrite_existing: bool = False # Re-process even if already enriched


class MerchantOverrideRequest(BaseModel):
    description_raw: str
    merchant_name: str
    description_clean: str
    category: str


@app.get("/api/llm/test-groq")
async def test_groq():
    """Diagnostic: test Anthropic API key with one real Claude call. Shows raw error if any."""
    import urllib.request, urllib.error, json as _json
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"status": "error", "detail": "ANTHROPIC_API_KEY env var is empty or not set"}
    key_preview = api_key[:8] + "..." + api_key[-4:]
    payload = _json.dumps({
        "model": "claude-haiku-4-5",
        "max_tokens": 50,
        "system": "You are a helpful assistant. Reply with valid JSON only.",
        "messages": [
            {"role": "user", "content": "Transaction: Walmart. Reply with JSON: {\"merchant_name\":\"Walmart\",\"category\":\"Groceries\"}"}
        ],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = _json.loads(resp.read().decode("utf-8"))
            return {"status": "ok", "key_preview": key_preview, "response": body}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"status": "http_error", "key_preview": key_preview, "code": e.code, "detail": error_body}
    except Exception as e:
        return {"status": "exception", "key_preview": key_preview, "detail": str(e)}


import threading as _threading
import uuid as _uuid

# In-memory job status store (resets on redeploy, which is fine)
_enrich_jobs: dict = {}

def _run_enrich_job(job_id: str, overwrite_existing: bool, limit: int):
    """Background worker — runs in a thread, uses its own DB session."""
    db = SessionLocal()
    job = _enrich_jobs[job_id]
    try:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            job["status"] = "error"
            job["error"] = "ANTHROPIC_API_KEY not configured"
            return

        from sqlalchemy import or_
        query = db.query(Transaction).filter(Transaction.is_locked == False)
        if not overwrite_existing:
            query = query.filter(or_(
                Transaction.description_clean == None,
                Transaction.description_clean == "",
                Transaction.category_auto == None,
                Transaction.category_auto == "Unclassified",
            ))
        txns = query.order_by(Transaction.date.desc()).limit(limit).all()
        job["total"] = len(txns)

        for txn in txns:
            try:
                enriched = enrich_transaction(
                    transaction_id=txn.id,
                    description_raw=txn.description_raw,
                    db_session=db,
                    api_key=api_key,
                )
                txn.merchant_name     = enriched["merchant_name"]
                txn.description_clean = enriched["description_clean"]
                if not txn.category_manual:
                    txn.category_auto = enriched["category"]
                txn.enrichment_source = enriched["source"]
                db.add(txn)
                db.commit()

                job["processed"] += 1
                if enriched["source"] == "override":
                    job["override_hits"] += 1
                elif enriched["source"] == "llm":
                    job["llm_calls"] += 1
                job["last"] = {"id": txn.id, "raw": txn.description_raw,
                               "merchant": enriched["merchant_name"],
                               "category": enriched["category"], "source": enriched["source"]}
            except Exception as e:
                job["errors"] += 1
                logger.error(f"Enrich error txn {txn.id}: {e}")

        job["status"] = "done"
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
    finally:
        db.close()


@app.post("/api/llm/enrich-transactions")
async def llm_enrich_transactions(
    req: LLMEnrichRequest,
    background_tasks: BackgroundTasks,
):
    """
    Start a background enrichment job. Returns a job_id immediately.
    Poll GET /api/llm/enrich-status/{job_id} to check progress.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    job_id = str(_uuid.uuid4())[:8]
    _enrich_jobs[job_id] = {
        "status": "running", "processed": 0, "total": 0,
        "llm_calls": 0, "override_hits": 0, "errors": 0, "last": None,
    }

    t = _threading.Thread(target=_run_enrich_job,
                          args=(job_id, req.overwrite_existing, req.limit),
                          daemon=True)
    t.start()

    return {"job_id": job_id, "message": f"Enrichment started for up to {req.limit} transactions. Poll /api/llm/enrich-status/{job_id}"}


@app.get("/api/llm/enrich-status/{job_id}")
async def llm_enrich_status(job_id: str):
    """Poll enrichment job status."""
    job = _enrich_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, **job}


@app.post("/api/llm/create-rule-from-transaction/{transaction_id}")
async def create_rule_from_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
):
    """
    Create a categorization rule from an LLM-enriched transaction that the
    user has accepted. Uses the clean merchant name as the pattern so future
    transactions from the same merchant are handled by rules (free, instant)
    instead of the LLM.

    Only useful when enrichment_source is 'llm' or 'override'.
    Safe to call multiple times — checks for duplicate patterns first.
    """
    txn = db.query(Transaction).filter_by(id=transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Use cleaned merchant name as pattern; fall back to description_clean
    pattern = (txn.merchant_name or txn.description_clean or txn.description_raw or "").strip()
    if not pattern:
        raise HTTPException(status_code=400, detail="Transaction has no usable pattern")

    category = txn.category_final
    action = txn.action

    if not category or category == "Unclassified":
        raise HTTPException(status_code=400, detail="Transaction must have a valid category before creating a rule")

    # Avoid creating duplicate rules for the same pattern
    existing = db.query(CategorizationRule).filter(
        CategorizationRule.pattern.ilike(pattern),
        CategorizationRule.is_active == True,
        CategorizationRule.set_category == category,
    ).first()
    if existing:
        return {"status": "exists", "rule_id": existing.id, "message": f"Rule for '{pattern}' already exists"}

    rule = CategorizationRule(
        priority=200,           # Below Excel rules (100) so manual rules override them
        priority_order=0,
        match_type="contains",
        pattern=pattern,
        set_action=action,
        set_category=category,
        set_description=txn.description_clean or pattern,
        is_active=True,
        notes=f"Auto-created from LLM enrichment (txn #{transaction_id})",
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {"status": "created", "rule_id": rule.id, "pattern": pattern, "category": category, "action": action}


@app.post("/api/llm/merchant-overrides")
async def create_merchant_override(
    req: MerchantOverrideRequest,
    db: Session = Depends(get_db),
):
    """
    Save a user-confirmed merchant → category override.
    Call this when the user manually corrects a merchant/category so future
    transactions from the same merchant resolve instantly without an LLM call.
    """
    if req.category not in [c.name for c in db.query(Category).all()]:
        raise HTTPException(status_code=400, detail=f"Unknown category: {req.category}")

    save_override(
        description_raw=req.description_raw,
        merchant_name=req.merchant_name,
        description_clean=req.description_clean,
        category=req.category,
        db_session=db,
    )
    return {"status": "saved", "merchant_name": req.merchant_name, "category": req.category}


@app.get("/api/llm/merchant-overrides")
async def list_merchant_overrides(db: Session = Depends(get_db)):
    """List all saved merchant overrides."""
    overrides = db.query(MerchantOverride).order_by(MerchantOverride.merchant_name).all()
    return [
        {
            "id": o.id,
            "merchant_key": o.merchant_key,
            "merchant_name": o.merchant_name,
            "description_clean": o.description_clean,
            "category": o.category,
            "updated_at": o.updated_at.isoformat() if o.updated_at else None,
        }
        for o in overrides
    ]


@app.delete("/api/llm/merchant-overrides/{override_id}")
async def delete_merchant_override(override_id: int, db: Session = Depends(get_db)):
    """Delete a saved merchant override."""
    override = db.query(MerchantOverride).filter_by(id=override_id).first()
    if not override:
        raise HTTPException(status_code=404, detail="Override not found")
    db.delete(override)
    db.commit()
    return {"status": "deleted"}


@app.post("/api/llm/enrich-single/{transaction_id}")
async def llm_enrich_single(transaction_id: int, db: Session = Depends(get_db)):
    """
    Enrich a single transaction by ID. Useful for on-demand enrichment
    when a user opens a transaction detail view.
    """
    txn = db.query(Transaction).filter_by(id=transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    enriched = enrich_transaction(
        transaction_id=txn.id,
        description_raw=txn.description_raw,
        db_session=db,
        api_key=api_key,
    )

    txn.merchant_name = enriched["merchant_name"]
    txn.description_clean = enriched["description_clean"]
    if not txn.category_manual:
        txn.category_auto = enriched["category"]

    db.commit()
    return {
        "id": txn.id,
        "merchant_name": enriched["merchant_name"],
        "description_clean": enriched["description_clean"],
        "category": enriched["category"],
        "source": enriched["source"],
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "1.0.0"}


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
