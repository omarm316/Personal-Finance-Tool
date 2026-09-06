"""
Finance Automation — FastAPI backend
Clean consolidated version — all features included
"""
import asyncio
import io
import math
import os

# ── Load .env from iCloud Drive path ────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request, Response, BackgroundTasks, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
import hashlib
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from pydantic import BaseModel
from typing import List, Optional, Union
from datetime import datetime

from database import (
    init_db, get_db, Account, Transaction, Category,
    CategorizationRule, PlaidItem, seed_categories,
    Card, PointsCategory, MerchantPointsMapping,
    PointsEcosystem, CardProduct, CardProductReward, CardEarningRate, CardProductHistory,
    CardBenefit, BenefitUsage, SpendChallenge, ChallengeCardLink, ChallengeCategoryLink,
    Redemption, TransferRatio, Transfer, PointsBalanceSnapshot, PointsAdjustment, PersonPointsTransfer,
    CHALLENGE_TEMPLATES,
    seed_points_categories, seed_points_ecosystems, seed_card_products,
    import_cards_from_excel, import_points_from_excel,
    TransactionSplit, BudgetTarget, Loan,
    AccountMonthlySnapshot, UserCorrection, DuplicateIgnore, CashFlowOverlay,
    SalaryPayment, SalaryAllocation, BalanceObservation, PlannedPurchase,
)
from core.accounts_helpers import (
    ACCOUNT_TYPE_MAP, classify_account, _account_hash, _content_base_hash,
    _assign_content_hash, _sign_plaid_balance, _plaid_anchor_date,
    get_account_balance, get_account_balances_bulk,
    rebuild_monthly_snapshots, _refresh_current_month_snapshot,
    _ensure_cards_for_new_accounts, _refresh_product_held_status,
)
from core.points_engine import (
    infer_points_category, calc_earn_rate, compute_points_earn,
    calc_auto_top_category_points, _build_product_rate_maps, _build_points_lookup,
    _resolve_merchant_csc, _build_network_lookup, _resolve_product_for_date,
    _lock_points_for_transaction, _compute_ecosystem_balance, _statement_close_date,
    _points_pending, _load_products_by_id, _NON_EARNING_CATS, _CC_PAYMENT_KW,
)
from core.challenges_helpers import (
    _challenge_progress, _recalc_challenge, _challenge_spend_for_card,
    _sync_challenge_links, _current_cycle, _cycles_for_year,
)
from core.serializers import (
    serialize_account, _serialize_txn, _serialize_card, _serialize_challenge,
    _serialize_redemption, _serialize_balance_snapshot, _serialize_adjustment,
    _serialize_transfer_ratio, _serialize_transfer, _serialize_person_transfer,
    _serialize_benefit, serialize_loan, _overlay_to_dict, _salary_to_dict,
    _compute_pmt_split,
)
from core.import_helpers import (
    _compute_import_hash, _parse_csv_rows, _parse_ofx_rows, _build_preview,
)
from core.app_helpers import _frontend_index
from core.constants import TRANSACTION_TYPES, BUDGET_TYPES, BALANCE_TYPES
from core.rules_helpers import _reapply_rules
from llm_service import enrich_transaction, _call_groq, VALID_CATEGORIES
from categorization import CategorizationEngine, load_rules_from_excel, compute_needs_review, find_overlapping_rules
from plaid_integration import setup_plaid_from_env
from plaid.exceptions import ApiException as PlaidApiException
import logging
import time

# ---------------------------------------------------------------------------
# Structured logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-5s  %(name)s  %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger('moresheth')

# ---------------------------------------------------------------------------
# Account classification helpers
# ---------------------------------------------------------------------------

# Bucket mapping: account_type → (bucket_name, is_asset, is_liability)
# Keys match Plaid subtypes (checking, savings, credit card) and manual types

# ---------------------------------------------------------------------------
# Content-hash helpers — stable transaction identity across Plaid re-links
# ---------------------------------------------------------------------------







# Map Plaid top-level types to our types (fallback when subtype is missing)
PLAID_TYPE_FALLBACK = {
    'depository':  'checking',
    'credit':      'credit card',
    'investment':  'investment',
    'loan':        'loan',
}

# Institution name substring → issuer short code, for auto-created Card rows.
# Same institutions the /api/accounts/product-suggestions matcher already
# recognizes, kept as a separate map since that one keys off product_key.







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

# Plaid pfc_detailed → points category (L1 fallback when no merchant match)




# Expense categories that are fees/charges and do NOT earn points

# Credit-card-payment description keywords — the categorization pipeline
# doesn't consistently tag these action='Transfer' (some land as action=
# 'Expense'/category 'Fees & Interest' instead), so compute_points_earn()
# also checks description text directly rather than relying on action alone.
# Same list used by the cash-flow calc's own CC-payment detection.
























# ---------------------------------------------------------------------------
# Balance snapshot helpers (Section 0B)
# ---------------------------------------------------------------------------









# ---------------------------------------------------------------------------
# Transaction Type System (Section 2A)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# App + DB init
# ---------------------------------------------------------------------------

engine, SessionLocal = init_db()

app = FastAPI(title="Finance Automation API", version="1.0.0")

# Serve static assets (card images, backgrounds, etc.) from /static
_here = os.path.dirname(os.path.abspath(__file__))
_static_dir = os.path.join(_here, "static")
os.makedirs(_static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=_static_dir), name="static")

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


# Request logging middleware — logs method, path, status, and duration for every API call.
# Errors (4xx/5xx) are logged at WARNING/ERROR level with details.
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith('/api/'):
            return await call_next(request)
        t0 = time.perf_counter()
        method = request.method
        path = request.url.path
        qs = str(request.url.query)
        try:
            response = await call_next(request)
            elapsed = (time.perf_counter() - t0) * 1000
            status = response.status_code
            if status >= 500:
                logger.error(f'{method} {path}{"?" + qs if qs else ""}  → {status}  ({elapsed:.0f}ms)')
            elif status >= 400:
                logger.warning(f'{method} {path}{"?" + qs if qs else ""}  → {status}  ({elapsed:.0f}ms)')
            elif elapsed > 2000:
                logger.warning(f'{method} {path}{"?" + qs if qs else ""}  → {status}  SLOW ({elapsed:.0f}ms)')
            else:
                logger.info(f'{method} {path}{"?" + qs if qs else ""}  → {status}  ({elapsed:.0f}ms)')
            return response
        except Exception as exc:
            elapsed = (time.perf_counter() - t0) * 1000
            logger.exception(f'{method} {path}  → UNHANDLED  ({elapsed:.0f}ms): {exc}')
            raise

app.add_middleware(RequestLoggingMiddleware)


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
    is_for_others: bool = False
    is_split: bool = False
    is_excluded: bool = False
    points_category: Optional[str] = None
    network: Optional[str] = None
    spender: Optional[str] = None
    # Points earn summary — None when card/product is unknown or txn isn't an expense
    points_earn: Optional[dict] = None
    account_name: str
    account_id: int = 0
    account_type: Optional[str] = None
    card_id: Optional[int] = None
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
    is_for_others: Optional[bool] = None
    is_excluded: Optional[bool] = None
    points_category: Optional[str] = None
    description_clean: Optional[str] = None
    # Manual override for the signed points-earn value (see compute_points_earn()).
    # clear_points_earn_override resets to auto-classification; points_earn_override
    # sets an explicit value. clear takes precedence if both are sent.
    points_earn_override: Optional[float] = None
    clear_points_earn_override: Optional[bool] = None
    # Free-text "who spent this" tag — manual only, see Transaction.spender.
    spender: Optional[str] = None


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
    is_for_others: bool = False
    notes: Optional[str] = None


class SplitsRequest(BaseModel):
    """Request body for creating splits on a transaction (Section 3a)."""
    splits: List[SplitCreate]


class LinkTokenResponse(BaseModel):
    link_token: str


class PublicTokenExchange(BaseModel):
    public_token: str






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
    is_for_others: bool = False


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
    logger.info('═══ Moresheth starting up ═══')
    t0 = time.perf_counter()
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
                    logger.info(f"Auto-loaded {n} rules from {fname}")
                    break
            else:
                logger.info("No Excel file found — run /api/init/import-rules manually")
        else:
            logger.info(f"Rules loaded: {rule_count} active rules")

        # Seed points ecosystems and card products
        try:
            seed_points_ecosystems(session)
            logger.info("Ecosystems seeded OK")
        except Exception as eco_err:
            session.rollback()
            logger.warning(f"seed_points_ecosystems failed: {eco_err}")
        try:
            seed_card_products(session)
            logger.info("Card products seeded OK")
        except Exception as prod_err:
            session.rollback()
            logger.warning(f"seed_card_products failed: {prod_err}")
            import traceback
            traceback.print_exc()

        # Product catalog is seeded by seed_card_products() above — no Excel import needed

        try:
            _backfill_product_history_and_locked_points(session)
        except Exception as lock_err:
            session.rollback()
            logger.warning(f"_backfill_product_history_and_locked_points failed: {lock_err}")
            import traceback
            traceback.print_exc()

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
            logger.info(f"Fixed {_fixed} balance observations with wrong sign for credit/loan accounts")

        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(f"Database initialized ({elapsed:.0f}ms)")
        client_id = os.getenv("PLAID_CLIENT_ID")
        plaid_env = os.getenv("PLAID_ENV")
        if client_id:
            logger.info(f"Plaid credentials loaded: {client_id[:8]}... ({plaid_env})")
        else:
            logger.warning("PLAID_CLIENT_ID not found — check your .env file")
        total_elapsed = (time.perf_counter() - t0) * 1000
        accts = session.query(Account).filter_by(is_active=True).count()
        txns = session.query(Transaction).count()
        logger.info(f'═══ Moresheth ready — {accts} accounts, {txns:,} transactions ({total_elapsed:.0f}ms) ═══')
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------


@app.get("/")
async def serve_frontend():
    # v2.html (formerly the "/v2" sandbox) was promoted to the one production
    # frontend on 2026-07-21. As of 2026-07-30 it is built by Vite from
    # frontend/src instead of being served as a single hand-edited file.
    # frontend.html (the old gold/dark theme) is no longer served anywhere.
    return FileResponse(_frontend_index(), media_type="text/html")

# Service worker — must be served from root scope for PWA
@app.get("/sw.js")
async def serve_service_worker():
    here = os.path.dirname(os.path.abspath(__file__))
    return FileResponse(os.path.join(here, "static", "sw.js"), media_type="application/javascript")

# ✅ Step 7: OAuth redirect landing route (serve the same frontend)
@app.get("/plaid/oauth-return")
async def plaid_oauth_return():
    return FileResponse(_frontend_index(), media_type="text/html")

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

    clear_cursor=True is required here (not just for error-recovery): update
    mode is also how newly-selected accounts (account_selection_enabled) get
    added to an existing item, and only the clear_cursor branch of
    _sync_item_background reconciles Plaid's account list into new `Account`
    rows. Without it, a newly-added account has no `Account` row and every
    one of its transactions is silently skipped by `_sync_item` (no matching
    account_id).
    """
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.last_error_code    = None
    item.last_error_message = None
    item.last_error_at      = None
    db.commit()
    background_tasks.add_task(_sync_item_background, item_id, True)
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
        newly_created_accounts = []

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
                newly_created_accounts.append(new_acct)

                account_results.append({
                    "name": new_acct.account_name,
                    "mask": new_acct.mask,
                    "status": "created",
                    "account_id": new_acct.id,
                })

        # Commit accounts first so sync failures don't lose the account link
        db.commit()

        # Auto-create the Card row each brand-new credit-card Account needs
        # (see B18) — failure here shouldn't block the account link/sync above.
        try:
            _ensure_cards_for_new_accounts(db, newly_created_accounts, plaid_item.institution_name)
        except Exception as card_err:
            logger.warning(f"[exchange-token] auto Card-row creation failed: {card_err}")

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
            logger.exception('Unexpected error — rolling back')
            db.rollback()
        if snapshot_errors:
            logger.warning(f"[exchange-token] snapshot rebuild warnings: {snapshot_errors}")

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

    # Pre-load user-taught merchant → CSC mappings (checked before hardcoded patterns)
    _mpm_rows = db.query(MerchantPointsMapping).all()
    # Tuples: (pattern_lower, category_name, card_id, network)
    _mpm_lookup: list[tuple[str, str, int | None, str | None]] = [
        (m.merchant_pattern.lower(), m.points_category.name, m.card_id, m.network)
        for m in _mpm_rows
        if m.points_category
    ]

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
                logger.info(f"[sync] skipping txn — no account for plaid_account_id={txn_data['plaid_account_id']}")
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
                logger.info(f"[sync] content-hash match: adopted new plaid_id for '{hash_match.description_raw[:40]}'")
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

            # Apply GCB / For Others auto-tag and points category from rule notes
            desc_upper = txn_data['description_raw'].upper()
            gcb_auto        = False
            for_others_auto = False
            points_cat = None
            for rule in rules_with_notes:
                if rule.pattern and rule.pattern.upper() in desc_upper:
                    if 'gcb:true' in rule.notes:
                        gcb_auto = True
                    if 'for_others:true' in rule.notes:
                        for_others_auto = True
                    if 'points:' in rule.notes:
                        points_cat = rule.notes.split('points:')[1].split(',')[0].strip()

            # Check user-taught merchant → CSC mappings first (highest priority
            # after explicit rule notes), then fall back to hardcoded patterns.
            if not points_cat and txn_data.get('merchant_name') and _mpm_lookup:
                points_cat = _resolve_merchant_csc(
                    _mpm_lookup, txn_data['merchant_name'],
                    linked_card_id, account.card.network if account.card else None,
                )

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
            # categorize() already clears category to '' for action=='Transfer';
            # the Plaid-PFC fallback above only ever fires when category was
            # 'Unclassified', which a Transfer's '' never is — so category is
            # already correct here without re-checking action.
            llm_category = category

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

            needs_review_flag = compute_needs_review(action, category, confidence, final_source)

            new_txn = Transaction(
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
                is_gcb=gcb_auto,
                gcb_tagged=gcb_auto,
                is_for_others=for_others_auto,
                points_category=points_cat,
                content_hash=_assign_content_hash(db, account.id, txn_date, amount, txn_data['description_raw']),
                year=txn_date.year,
                month=txn_date.month,
                day=txn_date.day,
            )
            db.add(new_txn)
            db.flush()   # catch constraint errors per-transaction, not at batch commit
            _lock_points_for_transaction(db, new_txn)
            sp.commit()  # release savepoint — this row is now safe in the outer transaction
            total_added += 1

        except Exception as txn_err:
            sp.rollback()  # roll back only THIS row — previously flushed rows are unaffected
            errors += 1
            logger.info(f"[sync] failed txn {txn_data.get('plaid_transaction_id','?')}: {txn_err}")

    if skipped:
        logger.info(f"[sync] {plaid_item.institution_name}: {skipped} transaction(s) skipped — no matching account")
    if errors:
        logger.error(f"[sync] {plaid_item.institution_name}: {errors} transaction(s) failed to write")

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
            _lock_points_for_transaction(db, existing)
            modified_count += 1
        except Exception as mod_err:
            modified_errors += 1
            logger.error(f"[sync] {plaid_item.institution_name}: failed to apply modified txn {txn_data.get('plaid_transaction_id','?')}: {mod_err}")
    if modified_count:
        logger.info(f"[sync] {plaid_item.institution_name}: {modified_count} transaction(s) updated (Plaid modified)")
    if modified_errors:
        logger.info(f"[sync] {plaid_item.institution_name}: {modified_errors} modified transaction(s) failed")

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
                logger.info(f"[sync] skipping removal of locked txn {plaid_id} — user manually confirmed")
                continue
            # Soft-delete: exclude from all views but keep the row in the DB
            existing.is_excluded = True
            existing.needs_review = False
            note = " [removed by Plaid — may reappear with a new ID]"
            if existing.description_clean and note not in existing.description_clean:
                existing.description_clean = existing.description_clean + note
            _lock_points_for_transaction(db, existing)
            removed_count += 1
            logger.info(f"[sync] soft-deleted txn {plaid_id} ({existing.description_raw}) — excluded, not hard-deleted")
        except Exception as rem_err:
            removed_errors += 1
            logger.error(f"[sync] {plaid_item.institution_name}: failed to process removed txn {plaid_id}: {rem_err}")
    if removed_count:
        logger.info(f"[sync] {plaid_item.institution_name}: {removed_count} transaction(s) soft-deleted (Plaid removed)")
    if removed_errors:
        logger.info(f"[sync] {plaid_item.institution_name}: {removed_errors} removed transaction(s) failed")
    if locked_skipped:
        logger.info(f"[sync] {plaid_item.institution_name}: {locked_skipped} locked transaction(s) NOT removed — review manually")

    # Store cursor — use None instead of empty string for clean state
    plaid_item.cursor         = result['next_cursor'] or None
    plaid_item.last_synced_at = datetime.utcnow()
    try:
        db.commit()
    except Exception as commit_err:
        # Commit failed — this is the exception that will propagate to
        # _sync_item_background's except-handler and be stored on the item.
        logger.info(f"[sync] {plaid_item.institution_name}: final commit failed: {commit_err}")
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
                newly_created_accounts = []
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
                        new_acct = Account(
                            plaid_account_id=a['account_id'],
                            plaid_item_id=item_id,
                            account_name=f"{a['name']} {a.get('mask','') or ''}".strip(),
                            account_type=account_type,
                            official_name=a.get('official_name'),
                            mask=a.get('mask'),
                            is_active=True,
                        )
                        db.add(new_acct)
                        newly_created_accounts.append(new_acct)
                db.commit()
                logger.info(f"[sync] {item.institution_name}: {len(accounts)} account(s) reconciled")
                try:
                    _ensure_cards_for_new_accounts(db, newly_created_accounts, item.institution_name)
                except Exception as card_err:
                    logger.warning(f"[sync] auto Card-row creation failed for {item_id}: {card_err}")
            except Exception as acc_err:
                logger.error(f"[sync] account refresh failed for {item_id}: {acc_err}")
            item.cursor = None
            db.commit()
        added = await _sync_item(item, plaid, db)
        logger.info(f"[sync] {item.institution_name}: {added} transaction(s) added")
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
            logger.info(f"[sync] {item.institution_name}: balance observations recorded")
        except Exception as obs_err:
            logger.info(f"[sync] {item.institution_name}: balance observation failed: {obs_err}")
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
        logger.info(f"[sync] {item_id} Plaid error {err_code}: {err_msg}")

        # Cursor-reset errors: Plaid requires us to start from scratch.
        # Reset cursor and retry once immediately — no user action needed.
        CURSOR_RESET_CODES = {
            'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
            'INVALID_CURSOR',
        }
        if err_code in CURSOR_RESET_CODES and item and not clear_cursor:
            logger.info(f"[sync] {item.institution_name}: {err_code} — resetting cursor and retrying once")
            try:
                item.cursor = None
                item.last_error_code    = None
                item.last_error_message = None
                item.last_error_at      = None
                db.commit()
                # Immediate retry with clean cursor (clear_cursor=True skips here)
                added = await _sync_item(item, plaid, db)
                logger.info(f"[sync] {item.institution_name}: cursor-reset retry succeeded — {added} transaction(s) added")
                return
            except Exception as retry_err:
                logger.info(f"[sync] {item.institution_name}: cursor-reset retry also failed: {retry_err}")
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
            logger.debug('Suppressed exception', exc_info=True)
    except Exception as e:
        import traceback; traceback.print_exc()
        err_type = type(e).__name__
        institution = getattr(item, 'institution_name', None) or item_id
        logger.error(f"[sync] {institution} background sync failed ({err_type}): {e}")
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
            logger.info(f"[sync] {institution}: could not store error on item: {store_err}")
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
                logger.info(f"[sync] {item.institution_name}: cursor reset (was stuck) — re-downloading")
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
            logger.debug('Suppressed exception', exc_info=True)
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
    logger.warning(f"[reset] deleted {deleted_txns} Plaid transactions; starting fresh sync for {len(items)} item(s)")
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
    logger.info(f"[reset-all] {txns_deleted} transactions deleted, {ghosts_deleted} ghost accounts removed, {len(items)} cursors cleared")

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
async def unclassified_merchants(
    limit: int = 50,
    account_id: int = None,
    db: Session = Depends(get_db),
):
    """
    Returns merchants (grouped by merchant_name) that have no points_category,
    sorted by total unoptimised spend descending.  Optional account_id filter.
    """
    from sqlalchemy import func as _func
    q = (
        db.query(
            Transaction.merchant_name,
            _func.count(Transaction.id).label("n"),
            _func.sum(_func.abs(Transaction.amount)).label("total_spend"),
        )
        .filter(
            Transaction.points_category == None,   # noqa: E711
            Transaction.merchant_name != None,     # noqa: E711
            Transaction.action == 'Expense',
        )
    )
    if account_id:
        q = q.filter(Transaction.account_id == account_id)
    rows = (
        q.group_by(Transaction.merchant_name)
        .order_by(_func.sum(_func.abs(Transaction.amount)).desc())
        .limit(limit)
        .all()
    )
    return {"unclassified": [
        {"merchant": r[0], "count": r[1], "total_spend": round(r[2] or 0, 2)}
        for r in rows
    ]}


@app.post("/api/merchant-csc")
async def save_merchant_csc(body: dict, db: Session = Depends(get_db)):
    """Save a user-taught merchant → CSC (merchant category) mapping.

    Body: {merchant_pattern, points_category, card_id (optional), network (optional),
           apply_to_existing (bool, default true)}

    Scope is exactly one of: card_id (this one physical card), network (every
    card on that payment network — Visa/Mastercard/Amex/Discover, e.g. "every
    Mastercard"; NOT the issuing bank), or neither (global, every card).
    card_id and network are mutually exclusive; card_id wins if both are sent
    by mistake.

    - Upserts into merchant_points_mappings (pattern + scope = unique key).
    - If apply_to_existing=True (default), backfills matching transactions
      that don't have a CSC yet (points_category IS NULL), scoped the same
      way — a card-scoped rule only backfills that card's transactions, a
      network-scoped rule only that network's. Previously this backfill (and
      the sync-time auto-classifier) ignored card_id/network scoping entirely
      and always applied globally — see _resolve_merchant_csc.
    Returns {saved, pattern, category, scope, transactions_updated}.
    """
    merchant_pattern = (body.get('merchant_pattern') or '').strip()
    points_category_name = (body.get('points_category') or '').strip()
    card_id = body.get('card_id')
    network = (body.get('network') or '').strip() or None
    if card_id is not None:
        network = None  # card_id is more specific; ignore network if both sent
    apply_to_existing = body.get('apply_to_existing', True)

    if not merchant_pattern or not points_category_name:
        raise HTTPException(status_code=400, detail='merchant_pattern and points_category are required')

    cat = db.query(PointsCategory).filter_by(name=points_category_name, is_active=True).first()
    if not cat:
        raise HTTPException(status_code=404, detail=f'Unknown or inactive points category: {points_category_name}')

    # Upsert — same pattern+scope triple → update, otherwise insert
    existing_mapping = (
        db.query(MerchantPointsMapping)
        .filter_by(merchant_pattern=merchant_pattern, card_id=card_id, network=network)
        .first()
    )
    if existing_mapping:
        existing_mapping.points_category_id = cat.id
    else:
        db.add(MerchantPointsMapping(
            merchant_pattern=merchant_pattern,
            card_id=card_id,
            network=network,
            points_category_id=cat.id,
        ))

    updated = 0
    if apply_to_existing:
        # ilike for case-insensitive substring match (mirrors infer logic)
        query = db.query(Transaction).filter(
            Transaction.merchant_name.ilike(f'%{merchant_pattern}%'),
            Transaction.points_category == None,   # noqa: E711
        )
        if card_id is not None:
            query = query.filter(Transaction.card_id == card_id)
        elif network is not None:
            network_account_ids = [
                a.id for a in db.query(Account.id).join(Card, Card.account_id == Account.id)
                .filter(Card.network == network).all()
            ]
            query = query.filter(Transaction.account_id.in_(network_account_ids))
        for t in query.all():
            t.points_category = points_category_name
            updated += 1

    db.commit()
    return {
        'saved': True,
        'pattern': merchant_pattern,
        'category': points_category_name,
        'scope': 'card' if card_id is not None else ('network' if network else 'global'),
        'transactions_updated': updated,
    }


@app.get("/api/merchant-csc")
async def list_merchant_csc(db: Session = Depends(get_db)):
    """List every taught merchant → CSC (merchant category) mapping, most
    specific scope first (card, then network, then global), for a review/
    management UI — these rules were previously create-only with no way to
    see or remove them once taught."""
    rows = (
        db.query(MerchantPointsMapping)
        .order_by(MerchantPointsMapping.merchant_pattern)
        .all()
    )
    card_ids = [r.card_id for r in rows if r.card_id]
    cards_by_id = {c.id: c for c in db.query(Card).filter(Card.id.in_(card_ids)).all()} if card_ids else {}
    return [
        {
            'id': r.id,
            'merchant_pattern': r.merchant_pattern,
            'points_category': r.points_category.name if r.points_category else None,
            'card_id': r.card_id,
            'card_name': cards_by_id[r.card_id].card_id if r.card_id in cards_by_id else None,
            'network': r.network,
            'scope': 'card' if r.card_id else ('network' if r.network else 'global'),
        }
        for r in rows
    ]


@app.delete("/api/merchant-csc/{mapping_id}")
async def delete_merchant_csc(mapping_id: int, db: Session = Depends(get_db)):
    """Remove a taught merchant → CSC mapping. Does not touch transactions
    already backfilled by it — only stops it from applying going forward."""
    row = db.query(MerchantPointsMapping).filter_by(id=mapping_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(row)
    db.commit()
    return {"message": "Mapping deleted"}


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
                logger.debug('Suppressed exception', exc_info=True)

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
        logger.info(f"[recover-accounts] UNHANDLED ERROR for item {item_id}:\n{_tb.format_exc()}")
        raise HTTPException(500, f"Recovery failed: {detail}")


# ---------------------------------------------------------------------------
# Transactions: list
# ---------------------------------------------------------------------------















def _backfill_product_history_and_locked_points(session):
    """
    One-time backfill, safe to run on every startup (both halves are guarded
    so already-processed rows are skipped):

    1. Bootstrap a CardProductHistory row for every card that has a product
       but no history yet — every card before this feature shipped.
    2. Lock points_earned for every transaction that predates this feature
       (points_locked_at IS NULL).

    Both use TODAY's current product — the best available truth for
    pre-existing data — so nothing visibly changes right after deploy. A
    real product change from here on is what starts writing a second history
    row and locking old spend under the product that was actually active.
    """
    from datetime import date as _date

    cards_with_product = session.query(Card).filter(Card.product_id.isnot(None)).all()
    bootstrapped = 0
    for card in cards_with_product:
        if session.query(CardProductHistory).filter_by(card_id=card.id).first():
            continue
        earliest_txn = (
            session.query(Transaction)
            .filter_by(card_id=card.id)
            .order_by(Transaction.date.asc())
            .first()
        )
        bootstrap_from = (
            earliest_txn.date.date() if earliest_txn
            else (card.issue_date.date() if card.issue_date else _date.today())
        )
        session.add(CardProductHistory(
            card_id=card.id, product_id=card.product_id,
            effective_from=bootstrap_from, effective_to=None,
        ))
        bootstrapped += 1
    if bootstrapped:
        session.commit()
        logger.info(f"  Migration: bootstrapped CardProductHistory for {bootstrapped} card(s)")

    # Locking each row via _lock_points_for_transaction() would re-query
    # PointsCategory/Card/CardProduct/etc. per transaction — fine for a
    # single interactive edit, far too slow here against a remote DB with
    # ~1-2k rows (each iteration is several network round trips). Precompute
    # everything once instead and iterate in pure Python.
    unlocked = session.query(Transaction).filter(Transaction.points_locked_at.is_(None)).all()
    if unlocked:
        cat_parent_map = {c.name: c.parent_key for c in session.query(PointsCategory).all()}
        card_ids = {t.card_id for t in unlocked if t.card_id}
        cards_by_id = (
            {c.id: c for c in session.query(Card).filter(Card.id.in_(card_ids)).all()}
            if card_ids else {}
        )
        product_ids = [c.product_id for c in cards_by_id.values() if c.product_id]
        rate_maps = _build_product_rate_maps(session, product_ids)

        now = datetime.utcnow()
        for t in unlocked:
            t.points_locked_at = now
            card = cards_by_id.get(t.card_id) if t.card_id else None
            product_id = card.product_id if card else None
            rate_info = rate_maps.get(product_id) if product_id else None
            if not rate_info:
                t.points_earned = None
                t.points_earn_classification = None
                t.points_earn_rate = None
                t.points_product_id = product_id
                continue
            base_rate, bonus_by_name = rate_info[0], rate_info[1]
            result = compute_points_earn(t, base_rate, bonus_by_name, cat_parent_map, card.issuer if card else None)
            t.points_earned = result['points']
            t.points_earn_classification = result['classification']
            t.points_earn_rate = result['earn_rate']
            t.points_product_id = product_id

        session.commit()
        logger.info(f"  Migration: locked points_earned for {len(unlocked)} pre-existing transaction(s)")




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
    # contains_eager, not a bare join: _serialize_txn reads t.account.account_name
    # and t.account.account_type, which lazy-load one query per distinct account
    # otherwise (37 queries / 2.6s on limit=500). The join is already here, so
    # contains_eager populates the relationship from it at no extra cost — unlike
    # joinedload, which would add a second join. See B4.
    from sqlalchemy.orm import contains_eager as _contains_eager
    query = db.query(Transaction).join(Account).options(_contains_eager(Transaction.account))
    if needs_review is not None:
        query = query.filter(Transaction.needs_review == needs_review)
    if start_date:
        query = query.filter(Transaction.date >= datetime.fromisoformat(start_date))
    if end_date:
        # Inclusive of entire day
        end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59, microsecond=999999)
        query = query.filter(Transaction.date <= end_dt)
    if category:
        # Replicate category_final logic: prefer category_manual, fall back to category_auto
        query = query.filter(
            (Transaction.category_manual == category) |
            ((Transaction.category_manual == None) & (Transaction.category_auto == category))
        )
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    # Secondary sort on id: without a tie-breaker, Postgres doesn't guarantee a
    # stable order among same-`date` rows, so a plain refetch (e.g. right after
    # editing one transaction) can silently reorder same-day rows relative to
    # each other — which read as the whole table "jumping" on every edit.
    txns = query.order_by(Transaction.date.desc(), Transaction.id.desc()).offset(skip).limit(limit).all()

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
    network_lookup = _build_network_lookup(db, account_ids)
    return [_serialize_txn(t, splits_map, categorizer, points_lookup, cat_parent_map, network_lookup) for t in txns]


@app.get("/api/transactions/spenders")
async def get_transaction_spenders(db: Session = Depends(get_db)):
    """Distinct Transaction.spender values in use, unioned with a baseline
    {"Omer", "Daniella"} so the tagging combobox always offers those two even
    before anything's been tagged yet.

    Registered ahead of /api/transactions/{transaction_id} deliberately —
    FastAPI matches routes by registration order, not by whether the path
    param's type conversion succeeds, so a literal-segment route defined
    after an int-typed dynamic route 422s instead of falling through (same
    class of bug as the pre-existing Cash Back ecosystem 422, see
    MARGIN-MORESHETH-INTEGRATION.md).
    """
    existing = {
        row[0] for row in db.query(Transaction.spender)
        .filter(Transaction.spender.isnot(None), Transaction.spender != '')
        .distinct().all()
    }
    return sorted(existing | {'Omer', 'Daniella'})


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
    network_lookup = _build_network_lookup(db, [t.account_id])
    return _serialize_txn(t, {t.id: splits} if splits else {}, categorizer, points_lookup, cat_parent_map, network_lookup)


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
    _relock      = False  # any field below that compute_points_earn() depends on

    if update.category is not None and update.category != t.category_manual:
        t.category_manual = update.category
        t.updated_at      = datetime.utcnow()
        t.is_locked       = True
        _relock           = True
        if old_category != update.category:
            categorizer.record_correction(t, old_category, update.category, old_action, update.action)

    if update.action is not None:
        t.action     = update.action
        t.updated_at = datetime.utcnow()
        t.is_locked  = True
        _relock      = True
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
    if update.is_for_others is not None:
        t.is_for_others = update.is_for_others
    if update.points_category is not None:
        t.points_category = update.points_category
        _relock = True
    if update.is_excluded is not None:
        t.is_excluded = update.is_excluded
        t.updated_at  = datetime.utcnow()
        _relock       = True

    if update.clear_points_earn_override:
        t.points_earn_override = None
        t.updated_at = datetime.utcnow()
        _relock = True
    elif update.points_earn_override is not None:
        t.points_earn_override = update.points_earn_override
        t.updated_at = datetime.utcnow()
        _relock = True

    if update.description_clean is not None:
        t.description_clean = update.description_clean
        t.updated_at = datetime.utcnow()

    if update.spender is not None:
        t.spender = update.spender or None
        t.updated_at = datetime.utcnow()

    if _relock:
        _lock_points_for_transaction(db, t)

    db.commit()
    # Return the updated row (same shape as GET /transactions/{id}) so the
    # frontend can patch its local list in place instead of refetching the
    # whole (up to 500-row) list — that refetch-and-replace was what made
    # editing one transaction visually reshuffle/jump the rest of the table.
    db.refresh(t)
    splits = db.query(TransactionSplit).filter_by(parent_transaction_id=t.id).all() if t.is_split else []
    categorizer2 = CategorizationEngine(db)
    points_lookup, cat_parent_map = _build_points_lookup(db, [t.account_id])
    network_lookup = _build_network_lookup(db, [t.account_id])
    return _serialize_txn(t, {t.id: splits} if splits else {}, categorizer2, points_lookup, cat_parent_map, network_lookup)


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
        _relock = False

        if update.category is not None:
            if update.category != t.category_manual:
                t.category_manual = update.category
                t.updated_at = datetime.utcnow()
                t.is_locked = True
                _relock = True
                if old_category != update.category:
                    categorizer.record_correction(t, old_category, update.category,
                                                  old_action, update.action)

        if update.action is not None:
            t.action = update.action
            t.updated_at = datetime.utcnow()
            t.is_locked = True
            _relock = True
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

        if update.is_for_others is not None:
            t.is_for_others = update.is_for_others

        if update.spender is not None:
            t.spender = update.spender or None
            t.updated_at = datetime.utcnow()

        if _relock:
            _lock_points_for_transaction(db, t)

        updated += 1

    db.commit()
    return {"updated": updated}


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------





# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------





# ---------------------------------------------------------------------------
# Cards
# ---------------------------------------------------------------------------



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
               "is_active", "notes", "annual_fee", "primary_user", "issue_date"]
    for k, v in updates.items():
        if k not in allowed:
            continue
        if k == 'primary_user':
            setattr(card, k, v or None)
        elif k == 'issue_date':
            # Doubles as the annual-fee anniversary — the fee posts each year
            # on this date's month/day (Omer's confirmed convention, no
            # separate anniversary field). Accepts a plain "YYYY-MM-DD" from
            # the date input.
            card.issue_date = datetime.fromisoformat(v) if v else None
        else:
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
        'spend_challenges': [],
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


@app.get("/api/cards/portfolio")
async def cards_portfolio(db: Session = Depends(get_db)):
    """
    Portfolio overview for the Cards Landing Page.

    Returns:
    - summary: portfolio-level aggregates (total fees, credits, utilization,
               upcoming statement/payment dates, ecosystems present)
    - cards: per-card enriched data including blended ¢/dollar value
             (base earn rate × CPP + proportional challenge bonus value)

    Blended ¢/dollar formula
    ─────────────────────────
    base_cpp = base_rate × your_cpp

    For each *active* challenge:
      per_dollar type  → incr += bonus_amount × your_cpp  (while cap not exhausted)
      flat type        → if threshold not yet unlocked:
                         incr += (bonus_amount × your_cpp) / remaining_spend_to_threshold

    blended_cpp (returned in ¢) = (base_cpp + Σ incr) × 100
    """
    import calendar as _calendar
    from datetime import date as _date

    today = _date.today()
    ecosystems = {e.id: e for e in db.query(PointsEcosystem).all()}

    credit_accounts = (
        db.query(Account)
        .filter(Account.is_active == True)
        .filter(Account.account_type.ilike('%credit%'))
        .all()
    )

    # Prefetch all cards once (avoids N queries for card lookup)
    card_by_account: dict[int, Card] = {}
    for c in db.query(Card).all():
        if c.account_id and c.account_id not in card_by_account:
            card_by_account[c.account_id] = c

    def _next_day_occurrence(d: int) -> _date:
        """Next calendar date whose day-of-month == d (handles month-end roll-over)."""
        if today.day <= d:
            last = _calendar.monthrange(today.year, today.month)[1]
            return today.replace(day=min(d, last))
        nm = today.month + 1 if today.month < 12 else 1
        ny = today.year if today.month < 12 else today.year + 1
        last = _calendar.monthrange(ny, nm)[1]
        return _date(ny, nm, min(d, last))

    cards_out = []
    total_annual_fees = 0.0
    total_annual_credits = 0.0
    total_annual_credits_remaining = 0.0
    utilizations: list[float] = []
    upcoming_statements: list[dict] = []
    upcoming_payments: list[dict] = []
    eco_summary: dict[str, dict] = {}

    for account in credit_accounts:
        balance = get_account_balance(db, account.id)
        card = card_by_account.get(account.id)

        # Product lookup (account.product_id takes priority, then Card.product_id)
        product = None
        if account.product_id:
            product = db.query(CardProduct).filter_by(id=account.product_id).first()
        if not product and card and card.product_id:
            product = db.query(CardProduct).filter_by(id=card.product_id).first()

        # Ecosystem
        eco = None
        if product and product.ecosystem_id:
            eco = ecosystems.get(product.ecosystem_id)
        elif card and card.ecosystem_id:
            eco = ecosystems.get(card.ecosystem_id)
        your_cpp = float(eco.your_cpp) if eco else 0.01  # 1¢ fallback

        # Base earn rate
        base_rate = 1.0
        if product:
            for r in db.query(CardProductReward).filter_by(
                product_id=product.id, is_base_rate=True
            ).all():
                base_rate = r.multiplier
        base_cpp_frac = base_rate * your_cpp  # e.g. 3 × 0.006 = 0.018

        # Annual fee
        annual_fee = float(card.annual_fee or 0) if card else 0.0
        total_annual_fees += annual_fee

        # Benefits (annual credits)
        benefit_total = 0.0
        benefit_remaining = 0.0
        benefits_list: list[dict] = []
        if product and card:
            try:
                for b in sorted(product.benefits, key=lambda x: -(x.amount or 0)):
                    cycle = _current_cycle(b.reset_frequency or 'annual')
                    usage = db.query(BenefitUsage).filter_by(
                        benefit_id=b.id, card_id=card.id, cycle=cycle
                    ).first()
                    ser = _serialize_benefit(b, usage)
                    benefits_list.append({
                        'name': ser['benefit_name'],
                        'amount': ser['amount'],
                        'remaining': ser['remaining'],
                        'pct_used': ser['pct_used'],
                    })
                    benefit_total += b.amount or 0.0
                    benefit_remaining += ser['remaining']
            except Exception:
                logger.exception('Unexpected error — rolling back')
                db.rollback()
        total_annual_credits += benefit_total
        total_annual_credits_remaining += benefit_remaining

        # Utilization
        util = None
        if card and card.credit_limit and balance:
            util = round(abs(balance) / card.credit_limit * 100, 1)
            utilizations.append(util)

        # Upcoming statement close
        days_to_statement = None
        statement_date = None
        if card and card.statement_close_day:
            statement_date = _next_day_occurrence(card.statement_close_day)
            days_to_statement = (statement_date - today).days
            upcoming_statements.append({
                'account_id': account.id, 'name': account.account_name,
                'mask': account.mask, 'days': days_to_statement,
                'date': statement_date.isoformat(),
            })

        # Upcoming payment due
        days_to_payment = None
        payment_date = None
        if card and card.payment_due_day:
            payment_date = _next_day_occurrence(card.payment_due_day)
            days_to_payment = (payment_date - today).days
            upcoming_payments.append({
                'account_id': account.id, 'name': account.account_name,
                'mask': account.mask, 'days': days_to_payment,
                'date': payment_date.isoformat(),
            })

        # Active challenges → blended ¢/dollar computation
        # Uses cached current_spend (avoids re-running full recalc for every card)
        challenge_incr_frac = 0.0
        active_challenges_out: list[dict] = []
        if card:
            try:
                challenges = (
                    db.query(SpendChallenge)
                    .filter(SpendChallenge.is_active == True)
                    .filter(
                        or_(
                            SpendChallenge.card_id == card.id,
                            SpendChallenge.id.in_(
                                db.query(ChallengeCardLink.challenge_id)
                                .filter(ChallengeCardLink.card_id == card.id)
                            )
                        )
                    )
                    .all()
                )
                for ch in challenges:
                    cs = _serialize_challenge(ch, eco)
                    if cs['status'] not in ('active', 'unlocked'):
                        continue
                    incr = 0.0
                    desc = ''
                    current_spend = float(ch.current_spend or 0)
                    bonus_amount = float(ch.bonus_amount or 0)

                    if ch.bonus_type == 'per_dollar':
                        if ch.spend_cap:
                            remaining_cap = max(0.0, float(ch.spend_cap) - current_spend)
                            if remaining_cap > 0:
                                incr = bonus_amount * your_cpp
                                desc = f"+{bonus_amount:g}x extra · ${remaining_cap:,.0f} cap left"
                        else:
                            # Ongoing multiplier with no cap
                            incr = bonus_amount * your_cpp
                            desc = f"+{bonus_amount:g}x extra (no cap)"
                    elif ch.bonus_type == 'flat':
                        # Threshold bonus not yet unlocked
                        if ch.spend_threshold and not ch.bonus_unlocked:
                            remaining_spend = max(0.0, float(ch.spend_threshold) - current_spend)
                            if remaining_spend > 0:
                                bonus_value = bonus_amount * your_cpp
                                incr = bonus_value / remaining_spend
                                desc = (
                                    f"${bonus_value:,.0f} bonus / "
                                    f"${remaining_spend:,.0f} remaining"
                                )

                    if incr > 0:
                        challenge_incr_frac += incr
                        active_challenges_out.append({
                            'id': ch.id,
                            'name': ch.name,
                            'incremental_cpp': round(incr * 100, 3),
                            'description': desc,
                            'status': cs['status'],
                        })
            except Exception:
                logger.exception('Unexpected error — rolling back')
                db.rollback()

        blended_frac = base_cpp_frac + challenge_incr_frac

        # Ecosystem tally
        if eco:
            ek = eco.name
            if ek not in eco_summary:
                eco_summary[ek] = {
                    'ecosystem': eco.name,
                    'currency_name': eco.currency_name,
                    'your_cpp': eco.your_cpp,
                    'card_count': 0,
                }
            eco_summary[ek]['card_count'] += 1

        cards_out.append({
            'account_id': account.id,
            'account_name': account.account_name,
            'mask': account.mask,
            'balance': balance,
            'product_name': product.card_name if product else None,
            'has_product': product is not None,
            'issuer': card.issuer if card else None,
            'network': card.network if card else None,
            'annual_fee': annual_fee,
            'annual_credits_total': round(benefit_total, 2),
            'annual_credits_remaining': round(benefit_remaining, 2),
            'net_annual_cost': round(annual_fee - benefit_total, 2),
            'benefits': benefits_list,
            'utilization': util,
            'credit_limit': card.credit_limit if card else None,
            'statement_close_day': card.statement_close_day if card else None,
            'payment_due_day': card.payment_due_day if card else None,
            'days_to_statement': days_to_statement,
            'statement_date': statement_date.isoformat() if statement_date else None,
            'days_to_payment': days_to_payment,
            'payment_date': payment_date.isoformat() if payment_date else None,
            'ecosystem': eco.name if eco else None,
            'ecosystem_currency': eco.currency_name if eco else None,
            'base_rate': base_rate,
            'your_cpp': your_cpp,
            'base_cpp': round(base_cpp_frac * 100, 3),          # ¢ per dollar
            'challenge_incremental_cpp': round(challenge_incr_frac * 100, 3),
            'blended_cpp': round(blended_frac * 100, 3),         # ¢ per dollar
            'active_challenges': active_challenges_out,
        })

    cards_out.sort(key=lambda x: x['blended_cpp'], reverse=True)
    upcoming_statements.sort(key=lambda x: x['days'])
    upcoming_payments.sort(key=lambda x: x['days'])
    avg_util = round(sum(utilizations) / len(utilizations), 1) if utilizations else None
    active_challenge_count = sum(len(c['active_challenges']) for c in cards_out)

    return {
        'summary': {
            'card_count': len(cards_out),
            'total_annual_fees': round(total_annual_fees, 2),
            'total_annual_credits': round(total_annual_credits, 2),
            'total_annual_credits_remaining': round(total_annual_credits_remaining, 2),
            'net_annual_cost': round(total_annual_fees - total_annual_credits, 2),
            'avg_utilization': avg_util,
            'active_challenge_count': active_challenge_count,
            'upcoming_statements': upcoming_statements[:6],
            'upcoming_payments': upcoming_payments[:6],
            'ecosystems': list(eco_summary.values()),
        },
        'cards': cards_out,
    }










@app.get("/api/cards/earn-summary")
async def cards_earn_summary(
    period: str = 'qtd',
    year: int = None,
    db: Session = Depends(get_db),
):
    """
    Points earned by ecosystem (and cash-back dollars) for a given period.

    period: 'mtd' | 'qtd' | 'ytd'  (default: qtd)
    year:   calendar year (default: current year)

    For the current year, MTD/QTD/YTD are cut off at today.
    For past years, the same calendar window is used but capped at period-end.

    Returns per-ecosystem totals, cash-back total, and active challenges.
    """
    import calendar as _cal
    from datetime import date as _date

    today = _date.today()
    if year is None:
        year = today.year
    is_current = (year == today.year)

    # ── date range ──────────────────────────────────────────────────────────
    if period == 'mtd':
        start = _date(year, today.month, 1)
        end   = today if is_current else _date(year, today.month,
                    _cal.monthrange(year, today.month)[1])
    elif period == 'qtd':
        q0 = ((today.month - 1) // 3) * 3 + 1          # first month of current quarter
        start = _date(year, q0, 1)
        end   = today if is_current else _date(year, q0 + 2,
                    _cal.monthrange(year, q0 + 2)[1])
    else:  # ytd
        start = _date(year, 1, 1)
        end   = today if is_current else _date(year, 12, 31)

    # ── base data ────────────────────────────────────────────────────────────
    ecosystems_map = {e.id: e for e in db.query(PointsEcosystem).all()}
    all_categories = db.query(PointsCategory).filter_by(is_active=True).all()
    cat_parent_map = {c.name: c.parent_key for c in all_categories}

    credit_accounts = (
        db.query(Account)
        .filter(Account.is_active == True)
        .filter(Account.account_type.ilike('%credit%'))
        .all()
    )
    acct_ids = [a.id for a in credit_accounts]

    # Build per-account earn-rate info (one product cache to avoid N queries)
    # products_cache maps product_id → (_base_rate, _bonus_by_name, _has_auto_top)
    products_cache: dict[int, tuple] = {}
    acct_info: dict[int, dict] = {}
    card_by_acct: dict[int, Card] = {}
    # product_objs_cache maps product_id → CardProduct object (for auto_top_category calculation)
    product_objs_cache: dict[int, object] = {}
    for c in db.query(Card).all():
        if c.account_id and c.account_id not in card_by_acct:
            card_by_acct[c.account_id] = c

    _products_by_id = _load_products_by_id(db, credit_accounts, card_by_acct)

    for acct in credit_accounts:
        card = card_by_acct.get(acct.id)
        product = None
        if acct.product_id:
            product = _products_by_id.get(acct.product_id)
        if not product and card and card.product_id:
            product = _products_by_id.get(card.product_id)

        eco_id = None
        if product and product.ecosystem_id:
            eco_id = product.ecosystem_id
        elif card and card.ecosystem_id:
            eco_id = card.ecosystem_id

        base_rate  = 1.0
        bonus_by_name: dict[str, float] = {}
        has_auto_top = False
        if product:
            pid = product.id
            product_objs_cache[pid] = product
            if pid not in products_cache:
                rates = db.query(CardProductReward).filter_by(product_id=pid).all()
                _b = 1.0
                _bb: dict[str, float] = {}
                _has_auto = False
                for r in rates:
                    if r.is_base_rate:
                        _b = r.multiplier
                    elif r.points_category_id and r.points_category:
                        rtype = getattr(r, 'reward_type', 'fixed') or 'fixed'
                        if rtype == 'auto_top_category':
                            _has_auto = True
                            # skip — handled by calc_auto_top_category_points
                        else:
                            _bb[r.points_category.name] = r.multiplier
                products_cache[pid] = (_b, _bb, _has_auto)
            base_rate, bonus_by_name, has_auto_top = products_cache[product.id]

        eco = ecosystems_map.get(eco_id) if eco_id else None
        acct_info[acct.id] = {
            'base_rate':     base_rate,
            'bonus_by_name': bonus_by_name,
            'eco_id':        eco_id,
            'eco':           eco,
            'is_cash_back':  eco.is_cash_back if eco else False,
            'account_name':  acct.account_name,
            'mask':          acct.mask,
            'has_auto_top':  has_auto_top,
            'product':       product,
            'issuer':        card.issuer if card else None,
        }

    # ── per-transaction points, read from the locked column ─────────────────
    # Matches /api/ecosystems/{id}/earn-detail's approach — points_earned was
    # frozen at write time (see _lock_points_for_transaction()), so summing
    # it here can't silently diverge from the ecosystem drill-down page.
    window_rows = (
        db.query(Transaction)
        .filter(
            Transaction.account_id.in_(acct_ids),
            Transaction.date >= start,
            Transaction.date <= end,
            Transaction.is_excluded != True,
        )
        .all()
    )

    # ── accumulate ───────────────────────────────────────────────────────────
    eco_totals: dict[int, dict] = {}
    cash_back_total = 0.0
    cash_back_by_acct: dict[int, float] = {}

    for t in window_rows:
        info = acct_info.get(t.account_id)
        if not info:
            continue
        # auto_top_category accounts are handled separately below
        if info.get('has_auto_top'):
            continue
        if t.action != 'Expense':
            continue
        # Locked at write time — see _lock_points_for_transaction().
        pts = t.points_earned or 0
        eco_id = info['eco_id']
        acct_id = t.account_id

        if info['is_cash_back']:
            cash_back_total += pts
            cash_back_by_acct[acct_id] = cash_back_by_acct.get(acct_id, 0.0) + pts
        elif eco_id:
            if eco_id not in eco_totals:
                eco_totals[eco_id] = {'points': 0.0, 'by_acct': {}, 'by_cat': {}}
            eco_totals[eco_id]['points'] += pts
            eco_totals[eco_id]['by_acct'][acct_id] = \
                eco_totals[eco_id]['by_acct'].get(acct_id, 0.0) + pts
            cat_key = t.points_category or 'Other'
            eco_totals[eco_id]['by_cat'][cat_key] = \
                eco_totals[eco_id]['by_cat'].get(cat_key, 0.0) + pts

    # ── auto_top_category accounts (e.g. Citi Custom Cash) ───────────────────
    auto_top_acct_ids = [aid for aid, info in acct_info.items() if info.get('has_auto_top')]
    for acct_id in auto_top_acct_ids:
        info = acct_info[acct_id]
        product = info.get('product')
        eco_id  = info['eco_id']
        if not product:
            continue
        try:
            pts = calc_auto_top_category_points(db, acct_id, product, start, end)
        except Exception:
            pts = 0.0
        if info['is_cash_back']:
            cash_back_total += pts
            cash_back_by_acct[acct_id] = cash_back_by_acct.get(acct_id, 0.0) + pts
        elif eco_id:
            if eco_id not in eco_totals:
                eco_totals[eco_id] = {'points': 0.0, 'by_acct': {}, 'by_cat': {}}
            eco_totals[eco_id]['points'] += pts
            eco_totals[eco_id]['by_acct'][acct_id] = \
                eco_totals[eco_id]['by_acct'].get(acct_id, 0.0) + pts
            eco_totals[eco_id]['by_cat']['Auto-Optimized (5% Top Category)'] = \
                eco_totals[eco_id]['by_cat'].get('Auto-Optimized (5% Top Category)', 0.0) + pts

    # ── ensure all linked non-cash ecosystems appear (even with $0 earned) ───
    # This guarantees Delta SkyMiles, United MileagePlus, etc. always show on
    # the landing page as long as the user has a card linked to that ecosystem.
    for acct_id, info in acct_info.items():
        eco_id = info.get('eco_id')
        if not eco_id:
            continue
        if info.get('is_cash_back'):
            continue
        if eco_id not in eco_totals:
            eco_totals[eco_id] = {'points': 0.0, 'by_acct': {acct_id: 0.0}, 'by_cat': {}}
        elif acct_id not in eco_totals[eco_id]['by_acct']:
            eco_totals[eco_id]['by_acct'][acct_id] = 0.0

    # ── batch every per-ecosystem ledger table into one query each ───────────
    # These were five separate .filter_by(ecosystem_id=...) queries plus a
    # Card lookup *inside* the output loop below — i.e. 6 round-trips per
    # ecosystem. Fetched once here and grouped in Python instead. See B26.
    _eco_ids_out = [e for e in eco_totals.keys() if ecosystems_map.get(e) and not ecosystems_map[e].is_cash_back]
    _redemptions_by_eco: dict[int, list] = {}
    _transfers_out_by_eco: dict[int, list] = {}
    _transfers_in_by_eco: dict[int, list] = {}
    _adjustments_by_eco: dict[int, list] = {}
    _person_transfers_by_eco: dict[int, list] = {}
    _snapshot_people_by_eco: dict[int, set] = {}
    if _eco_ids_out:
        for r in db.query(Redemption).filter(Redemption.ecosystem_id.in_(_eco_ids_out)).all():
            _redemptions_by_eco.setdefault(r.ecosystem_id, []).append(r)
        for t in db.query(Transfer).filter(Transfer.source_ecosystem_id.in_(_eco_ids_out)).all():
            _transfers_out_by_eco.setdefault(t.source_ecosystem_id, []).append(_serialize_transfer(t))
        for t in db.query(Transfer).filter(Transfer.destination_ecosystem_id.in_(_eco_ids_out)).all():
            _transfers_in_by_eco.setdefault(t.destination_ecosystem_id, []).append(_serialize_transfer(t))
        for a in db.query(PointsAdjustment).filter(PointsAdjustment.ecosystem_id.in_(_eco_ids_out)).all():
            _adjustments_by_eco.setdefault(a.ecosystem_id, []).append(a)
        for pt in db.query(PersonPointsTransfer).filter(PersonPointsTransfer.ecosystem_id.in_(_eco_ids_out)).all():
            _person_transfers_by_eco.setdefault(pt.ecosystem_id, []).append(pt)
        for s in db.query(PointsBalanceSnapshot).filter(PointsBalanceSnapshot.ecosystem_id.in_(_eco_ids_out)).all():
            if s.person:
                _snapshot_people_by_eco.setdefault(s.ecosystem_id, set()).add(s.person)
    # card_by_acct already holds every Card keyed by account, so the
    # primary_user lookup that ran per ecosystem needs no query at all.

    # ── shape output ─────────────────────────────────────────────────────────
    ecosystems_out = []
    for eco_id, data in eco_totals.items():
        eco = ecosystems_map.get(eco_id)
        if not eco:
            continue
        pts   = round(data['points'])
        cpp   = float(eco.your_cpp)
        value = round(pts * cpp, 2)
        cards = [
            {
                'account_id':   aid,
                'account_name': acct_info.get(aid, {}).get('account_name', ''),
                'mask':         acct_info.get(aid, {}).get('mask', ''),
                'points':       round(p),
            }
            for aid, p in sorted(data['by_acct'].items(), key=lambda x: -x[1])
        ]

        # Current balance — same math as the ecosystem drill-down page (see
        # _compute_ecosystem_balance), not just this period's earn, so the
        # Portfolio tile and the drill-down page never show two different
        # numbers for "how many points do I have." Skipped for cash back
        # (not a points balance to track) and Amex not currently modeled here.
        current_balance = None
        pending_balance = None
        if not eco.is_cash_back:
            eco_accts_bal = list(data['by_acct'].keys())
            redemption_rows_bal = _redemptions_by_eco.get(eco_id, [])
            transfers_out_bal = _transfers_out_by_eco.get(eco_id, [])
            transfers_in_bal = _transfers_in_by_eco.get(eco_id, [])
            adjustment_rows_bal = _adjustments_by_eco.get(eco_id, [])
            person_transfer_rows_bal = _person_transfers_by_eco.get(eco_id, [])
            known_people_bal = {'Omer', 'Daniella'}
            known_people_bal |= _snapshot_people_by_eco.get(eco_id, set())
            for a in adjustment_rows_bal:
                if a.person:
                    known_people_bal.add(a.person)
            for r in redemption_rows_bal:
                if r.person:
                    known_people_bal.add(r.person)
            for t in transfers_out_bal + transfers_in_bal:
                if t.get('person'):
                    known_people_bal.add(t['person'])
                if t.get('to_person'):
                    known_people_bal.add(t['to_person'])
            for pt in person_transfer_rows_bal:
                known_people_bal.add(pt.from_person)
                known_people_bal.add(pt.to_person)
            for _aid in eco_accts_bal:
                _c = card_by_acct.get(_aid)
                if _c and _c.primary_user:
                    known_people_bal.add(_c.primary_user)
            bal = _compute_ecosystem_balance(
                db, eco_id, eco_accts_bal, acct_info, cat_parent_map,
                redemption_rows_bal, transfers_out_bal, transfers_in_bal,
                adjustment_rows_bal, person_transfer_rows_bal, sorted(known_people_bal),
            )
            current_balance = bal['current_balance']
            pending_balance = bal['pending_balance']

        ecosystems_out.append({
            'id':            eco_id,
            'name':          eco.name,
            'currency_name': eco.currency_name,
            'your_cpp':      cpp,
            'is_cash_back':  eco.is_cash_back,
            'points_earned': pts,
            'est_value':     value,
            'current_balance': current_balance,
            'pending_balance': pending_balance,
            'cards':         cards,
        })
    ecosystems_out.sort(key=lambda x: x['est_value'], reverse=True)

    cash_back_cards = [
        {
            'account_id':   aid,
            'account_name': acct_info.get(aid, {}).get('account_name', ''),
            'mask':         acct_info.get(aid, {}).get('mask', ''),
            'amount':       round(amt, 2),
        }
        for aid, amt in sorted(cash_back_by_acct.items(), key=lambda x: -x[1])
    ]

    # Active challenges (summarised — used for the landing page strip)
    # Multi-card challenges are "exploded" into per-card entries so each
    # card shows its own spend progress and threshold independently.
    active_challenges_out: list[dict] = []
    try:
        _today = datetime.utcnow().date()
        _d_fn = lambda v: v.date() if isinstance(v, datetime) else v
        for ch in db.query(SpendChallenge).filter_by(is_active=True).all():
            if _d_fn(ch.end_date) < _today or _d_fn(ch.start_date) > _today:
                continue
            # Collect all card IDs: primary + linked
            all_card_ids = [ch.card_id] + [lnk.card_id for lnk in ch.card_links]
            for cid in all_card_ids:
                card_obj = db.query(Card).filter_by(id=cid).first()
                if not card_obj:
                    continue
                ch_eco = None
                pprod = db.query(CardProduct).filter_by(id=card_obj.product_id).first() \
                        if card_obj.product_id else None
                eid = (pprod.ecosystem_id if pprod else None) or card_obj.ecosystem_id
                ch_eco = ecosystems_map.get(eid) if eid else None
                # Per-card spend so each card shows its own progress
                spend_ov = (
                    _challenge_spend_for_card(db, ch, card_obj.account_id)
                    if card_obj.account_id else None
                )
                ser = _serialize_challenge(ch, eco=ch_eco, spend_override=spend_ov)
                ser['card_name']  = card_obj.card_name
                ser['last_four']  = card_obj.last_four
                ser['account_id'] = card_obj.account_id
                active_challenges_out.append(ser)
    except Exception:
        logger.exception('Unexpected error — rolling back')
        db.rollback()

    return {
        'period':      period,
        'year':        year,
        'start':       start.isoformat(),
        'end':         end.isoformat(),
        'ecosystems':  ecosystems_out,
        'cash_back':   {'total': round(cash_back_total, 2), 'cards': cash_back_cards},
        'active_challenges': active_challenges_out,
    }


@app.get("/api/ecosystems/cash-back/earn-detail")
async def cash_back_earn_detail(
    period: str = 'qtd',
    year: int = None,
    db: Session = Depends(get_db),
):
    """
    Aggregated earn detail for ALL cash-back ecosystems.
    Same shape as single-ecosystem detail but merges all is_cash_back=True ecosystems.
    Cash back amounts are in dollars (1 point = 1 cent → cpp fixed at 0.01).

    Registered BEFORE /api/ecosystems/{eco_id}/earn-detail on purpose — FastAPI/
    Starlette match routes in registration order, and {eco_id}:int structurally
    matches any single path segment (including the literal string "cash-back")
    before Pydantic's int validation runs, which fails with a 422 rather than
    falling through to this route. Keep this route above the {eco_id} one.
    """
    import calendar as _cal
    from datetime import date as _date
    from sqlalchemy import func as _func

    # Gather all cash-back ecosystem IDs
    cb_ecos = db.query(PointsEcosystem).filter_by(is_cash_back=True).all()
    cb_eco_ids = {e.id for e in cb_ecos}
    if not cb_eco_ids:
        return {
            'eco_id': 0, 'name': 'Cash Back', 'currency_name': 'Cash Back',
            'your_cpp': 0.01, 'period': period, 'year': year or _date.today().year,
            'start': '', 'end': '', 'total_points': 0, 'est_value': 0,
            'by_category': [], 'by_card': [], 'active_challenges': [],
            'sub_ecosystems': [],
        }

    today = _date.today()
    if year is None:
        year = today.year
    is_current = (year == today.year)

    if period == 'mtd':
        start = _date(year, today.month, 1)
        end   = today if is_current else _date(year, today.month,
                    _cal.monthrange(year, today.month)[1])
    elif period == 'qtd':
        q0    = ((today.month - 1) // 3) * 3 + 1
        start = _date(year, q0, 1)
        end   = today if is_current else _date(year, q0 + 2,
                    _cal.monthrange(year, q0 + 2)[1])
    else:
        start = _date(year, 1, 1)
        end   = today if is_current else _date(year, 12, 31)

    all_categories = db.query(PointsCategory).filter_by(is_active=True).all()
    cat_parent_map = {c.name: c.parent_key for c in all_categories}

    products_cache: dict[int, tuple] = {}
    card_by_acct: dict[int, Card] = {}
    for c in db.query(Card).all():
        if c.account_id and c.account_id not in card_by_acct:
            card_by_acct[c.account_id] = c

    credit_accounts = (
        db.query(Account)
        .filter(Account.is_active == True)
        .filter(Account.account_type.ilike('%credit%'))
        .all()
    )

    eco_accts: list[int] = []
    acct_info: dict[int, dict] = {}
    acct_eco: dict[int, int] = {}  # track which eco each account belongs to

    _products_by_id = _load_products_by_id(db, credit_accounts, card_by_acct)

    for acct in credit_accounts:
        card = card_by_acct.get(acct.id)
        product = None
        if acct.product_id:
            product = _products_by_id.get(acct.product_id)
        if not product and card and card.product_id:
            product = _products_by_id.get(card.product_id)

        a_eco_id = None
        if product and product.ecosystem_id:
            a_eco_id = product.ecosystem_id
        elif card and card.ecosystem_id:
            a_eco_id = card.ecosystem_id

        if a_eco_id not in cb_eco_ids:
            continue

        base_rate = 1.0
        bonus_by_name: dict[str, float] = {}
        if product:
            pid = product.id
            if pid not in products_cache:
                rates = db.query(CardProductReward).filter_by(product_id=pid).all()
                _b = 1.0
                _bb: dict[str, float] = {}
                for r in rates:
                    if r.is_base_rate:
                        _b = r.multiplier
                    elif r.points_category_id and r.points_category:
                        _bb[r.points_category.name] = r.multiplier
                products_cache[pid] = (_b, _bb)
            base_rate, bonus_by_name = products_cache[product.id]

        eco_accts.append(acct.id)
        acct_eco[acct.id] = a_eco_id
        acct_info[acct.id] = {
            'base_rate':     base_rate,
            'bonus_by_name': bonus_by_name,
            'account_name':  acct.account_name,
            'mask':          acct.mask,
            'product_key':   product.product_key if product else None,
            'card_name':     card.card_name if card else None,
            'issuer':        card.issuer if card else None,
        }

    if not eco_accts:
        return {
            'eco_id': 0, 'name': 'Cash Back', 'currency_name': 'Cash Back',
            'your_cpp': 0.01, 'period': period, 'year': year,
            'start': start.isoformat(), 'end': end.isoformat(),
            'total_points': 0, 'est_value': 0,
            'by_category': [], 'by_card': [], 'active_challenges': [],
            'sub_ecosystems': [],
        }

    rows = (
        db.query(
            Transaction.account_id,
            Transaction.points_category,
            _func.sum(Transaction.amount).label('total'),
        )
        .filter(
            Transaction.account_id.in_(eco_accts),
            Transaction.date >= start,
            Transaction.date <= end,
            Transaction.action == 'Expense',
            Transaction.amount < 0,
            Transaction.is_excluded != True,
        )
        .group_by(Transaction.account_id, Transaction.points_category)
        .all()
    )

    by_cat: dict[str, float] = {}
    by_acct: dict[int, float] = {}
    total_pts = 0.0
    for acct_id, pts_cat, total in rows:
        info = acct_info.get(acct_id)
        if not info:
            continue
        amt  = abs(float(total or 0))
        rate = calc_earn_rate(info['bonus_by_name'], info['base_rate'], pts_cat, cat_parent_map)
        pts  = amt * rate  # for cash back, "points" = cents earned per dollar → dollar value
        total_pts += pts
        cat_key = pts_cat or 'Other'
        by_cat[cat_key]   = by_cat.get(cat_key, 0.0)   + pts
        by_acct[acct_id]  = by_acct.get(acct_id, 0.0)  + pts

    # For cash back, cpp is 0.01 (1 point = 1 cent)
    cpp = 0.01
    total_pts_r = round(total_pts)

    by_cat_out = sorted(
        [{'category': k, 'points': round(v), 'pct': round(v / total_pts * 100, 1) if total_pts else 0}
         for k, v in by_cat.items()],
        key=lambda x: -x['points'],
    )
    # Same "Your Cards shouldn't drop a card with 0 spend this period" fix as
    # the non-cash-back branch below.
    for aid in eco_accts:
        by_acct.setdefault(aid, 0.0)
    by_card_out = sorted(
        [{'account_id': aid, 'account_name': acct_info[aid]['account_name'],
          'mask': acct_info[aid]['mask'],
          'product_key': acct_info[aid].get('product_key'),
          'points': round(p)}
         for aid, p in by_acct.items()],
        key=lambda x: -x['points'],
    )

    # Sub-ecosystem breakdown (e.g., Discover vs generic Cash Back)
    eco_name_map = {e.id: e.name for e in cb_ecos}
    sub_totals: dict[str, float] = {}
    for aid, pts in by_acct.items():
        eid = acct_eco.get(aid)
        ename = eco_name_map.get(eid, 'Cash Back')
        sub_totals[ename] = sub_totals.get(ename, 0) + pts
    sub_ecos = sorted(
        [{'name': k, 'points': round(v)} for k, v in sub_totals.items()],
        key=lambda x: -x['points'],
    )

    # Challenges across all cash-back cards
    active_ch_out: list[dict] = []
    try:
        card_ids_in_cb = [
            card_by_acct[aid].id for aid in eco_accts if aid in card_by_acct
        ]
        card_ids_set = set(card_ids_in_cb)
        _today = datetime.utcnow().date()
        _d_fn  = lambda v: v.date() if isinstance(v, datetime) else v
        for ch in (db.query(SpendChallenge)
                   .filter(SpendChallenge.is_active == True)
                   .filter(or_(
                       SpendChallenge.card_id.in_(card_ids_in_cb),
                       SpendChallenge.id.in_(
                           db.query(ChallengeCardLink.challenge_id)
                           .filter(ChallengeCardLink.card_id.in_(card_ids_in_cb))
                       )
                   )).all()):
            if _d_fn(ch.end_date) < _today or _d_fn(ch.start_date) > _today:
                continue
            all_card_ids = [ch.card_id] + [lnk.card_id for lnk in ch.card_links]
            eco_card_ids = [cid for cid in all_card_ids if cid in card_ids_set]
            for cid in eco_card_ids:
                card_obj = db.query(Card).filter_by(id=cid).first()
                if not card_obj:
                    continue
                spend_ov = (
                    _challenge_spend_for_card(db, ch, card_obj.account_id)
                    if card_obj.account_id else None
                )
                # Use the first cash-back eco for serialization
                ser = _serialize_challenge(ch, eco=cb_ecos[0], spend_override=spend_ov)
                ser['card_name']  = card_obj.card_name
                ser['last_four']  = card_obj.last_four
                ser['account_id'] = card_obj.account_id
                active_ch_out.append(ser)
    except Exception:
        logger.exception('Unexpected error — rolling back')
        db.rollback()

    return {
        'eco_id':        0,
        'name':          'Cash Back',
        'currency_name': 'Cash Back',
        'your_cpp':      cpp,
        'period':        period,
        'year':          year,
        'start':         start.isoformat(),
        'end':           end.isoformat(),
        'total_points':  total_pts_r,
        'est_value':     round(total_pts_r * cpp, 2),
        'by_category':   by_cat_out,
        'by_card':       by_card_out,
        'active_challenges': active_ch_out,
        'sub_ecosystems': sub_ecos,
    }


@app.get("/api/ecosystems/{eco_id}/earn-detail")
async def ecosystem_earn_detail(
    eco_id: int,
    period: str = 'qtd',
    year: int = None,
    db: Session = Depends(get_db),
):
    """
    Per-category earn breakdown for a single ecosystem (e.g. Chase UR).
    Returned to power the Ecosystem Detail Page.
    """
    import calendar as _cal
    from datetime import date as _date
    from sqlalchemy import func as _func

    eco = db.query(PointsEcosystem).filter_by(id=eco_id).first()
    if not eco:
        raise HTTPException(status_code=404, detail="Ecosystem not found")

    # Redemptions aren't period-scoped (like active_challenges below) — show
    # the full history of what this currency has actually been worth when
    # redeemed, not just what happened in the selected MTD/QTD/YTD window.
    redemption_rows = (
        db.query(Redemption)
        .filter_by(ecosystem_id=eco_id)
        .order_by(Redemption.redemption_date.desc())
        .all()
    )
    redemptions_out = [_serialize_redemption(r) for r in redemption_rows]
    total_points_redeemed = sum(r.points_redeemed for r in redemption_rows)
    total_cash_value_usd = sum(r.cash_value_usd for r in redemption_rows)
    realized_cpp = round((total_cash_value_usd / total_points_redeemed) * 100, 4) if total_points_redeemed else 0

    # Transfers are value-neutral, shown on both sides of the pair — also not
    # period-scoped, same rationale as redemptions above.
    transfers_out = [
        _serialize_transfer(t)
        for t in db.query(Transfer).filter_by(source_ecosystem_id=eco_id).order_by(Transfer.transfer_date.desc()).all()
    ]
    transfers_in = [
        _serialize_transfer(t)
        for t in db.query(Transfer).filter_by(destination_ecosystem_id=eco_id).order_by(Transfer.transfer_date.desc()).all()
    ]
    total_points_transferred_out = sum(t['points_sent'] for t in transfers_out)
    # points_received already bakes in bonus_pct (snapshotted at transfer time —
    # see Transfer model), so no separate bonus term is needed here.
    total_points_transferred_in  = sum(t['points_received'] for t in transfers_in)

    # Manual +/- corrections — also all-time, same rationale as redemptions/
    # transfers above (this is ledger history, not a period-scoped stat).
    adjustment_rows = (
        db.query(PointsAdjustment)
        .filter_by(ecosystem_id=eco_id)
        .order_by(PointsAdjustment.adjustment_date.desc())
        .all()
    )
    adjustments_out = [_serialize_adjustment(a) for a in adjustment_rows]
    total_points_adjusted = sum(a.points_delta for a in adjustment_rows)

    # Person-to-person transfers within this one ecosystem (e.g. Omer sends
    # 20,000 Chase UR to Daniella) — distinct from Transfer above, which
    # moves points between two different currencies for one person. Also
    # all-time/not period-scoped, same rationale as the ledger rows above.
    person_transfer_rows = (
        db.query(PersonPointsTransfer)
        .filter_by(ecosystem_id=eco_id)
        .order_by(PersonPointsTransfer.transfer_date.desc())
        .all()
    )
    person_transfers_out = [_serialize_person_transfer(pt) for pt in person_transfer_rows]

    # Known people for this ecosystem's per-person split — same baseline as
    # /api/transactions/spenders, plus any name actually used anywhere in
    # this ecosystem's ledger so a third person's tag is never silently
    # dropped into "Shared."
    known_people = {'Omer', 'Daniella'}
    for s in db.query(PointsBalanceSnapshot).filter_by(ecosystem_id=eco_id).all():
        if s.person:
            known_people.add(s.person)
    for a in adjustment_rows:
        if a.person:
            known_people.add(a.person)
    for r in redemption_rows:
        if r.person:
            known_people.add(r.person)
    for t in transfers_out:
        if t.get('person'):
            known_people.add(t['person'])
    for t in transfers_in:
        if t.get('person'):
            known_people.add(t['person'])
        if t.get('to_person'):
            known_people.add(t['to_person'])
    for pt in person_transfer_rows:
        known_people.add(pt.from_person)
        known_people.add(pt.to_person)
    # Also fold in anyone set as a card's primary_user in this ecosystem —
    # a person who only ever owns a card (never manually spender-tagged or
    # otherwise mentioned) still needs their own bucket, not to be silently
    # dropped into "Shared."
    _product_ids_in_eco = [p.id for p in db.query(CardProduct).filter_by(ecosystem_id=eco_id).all()]
    _card_owner_filter = Card.ecosystem_id == eco_id
    if _product_ids_in_eco:
        _card_owner_filter = or_(_card_owner_filter, Card.product_id.in_(_product_ids_in_eco))
    for c in db.query(Card).filter(_card_owner_filter, Card.primary_user.isnot(None)).all():
        known_people.add(c.primary_user)
    known_people = sorted(known_people)

    today = _date.today()
    if year is None:
        year = today.year
    is_current = (year == today.year)

    if period == 'mtd':
        start = _date(year, today.month, 1)
        end   = today if is_current else _date(year, today.month,
                    _cal.monthrange(year, today.month)[1])
    elif period == 'qtd':
        q0    = ((today.month - 1) // 3) * 3 + 1
        start = _date(year, q0, 1)
        end   = today if is_current else _date(year, q0 + 2,
                    _cal.monthrange(year, q0 + 2)[1])
    else:
        start = _date(year, 1, 1)
        end   = today if is_current else _date(year, 12, 31)

    all_categories = db.query(PointsCategory).filter_by(is_active=True).all()
    cat_parent_map = {c.name: c.parent_key for c in all_categories}

    # Accounts in this ecosystem
    products_cache: dict[int, tuple] = {}
    card_by_acct: dict[int, Card] = {}
    for c in db.query(Card).all():
        if c.account_id and c.account_id not in card_by_acct:
            card_by_acct[c.account_id] = c

    credit_accounts = (
        db.query(Account)
        .filter(Account.is_active == True)
        .filter(Account.account_type.ilike('%credit%'))
        .all()
    )
    eco_accts = []
    acct_info: dict[int, dict] = {}
    _products_by_id = _load_products_by_id(db, credit_accounts, card_by_acct)

    for acct in credit_accounts:
        card = card_by_acct.get(acct.id)
        product = None
        if acct.product_id:
            product = _products_by_id.get(acct.product_id)
        if not product and card and card.product_id:
            product = _products_by_id.get(card.product_id)

        a_eco_id = None
        if product and product.ecosystem_id:
            a_eco_id = product.ecosystem_id
        elif card and card.ecosystem_id:
            a_eco_id = card.ecosystem_id

        if a_eco_id != eco_id:
            continue

        base_rate = 1.0
        bonus_by_name: dict[str, float] = {}
        has_auto_top = False
        if product:
            pid = product.id
            if pid not in products_cache:
                rates = db.query(CardProductReward).filter_by(product_id=pid).all()
                _b = 1.0
                _bb: dict[str, float] = {}
                _has_auto = False
                for r in rates:
                    if r.is_base_rate:
                        _b = r.multiplier
                    elif r.points_category_id and r.points_category:
                        rtype = getattr(r, 'reward_type', 'fixed') or 'fixed'
                        if rtype == 'auto_top_category':
                            # skip — handled by calc_auto_top_category_points below
                            _has_auto = True
                        else:
                            _bb[r.points_category.name] = r.multiplier
                products_cache[pid] = (_b, _bb, _has_auto)
            base_rate, bonus_by_name, has_auto_top = products_cache[product.id]

        eco_accts.append(acct.id)
        acct_info[acct.id] = {
            'base_rate':     base_rate,
            'bonus_by_name': bonus_by_name,
            'account_name':  acct.account_name,
            'mask':          acct.mask,
            'card_name':     card.card_name if card else None,
            'issuer':        card.issuer if card else None,
            'has_auto_top':  has_auto_top,
            'product':       product,
        }

    # Current balance, split per-person with a combined Total — see
    # _compute_ecosystem_balance() for the actual math (shared with
    # /api/cards/earn-summary's Portfolio-tile headline number so the two
    # can never silently diverge). Deliberately NOT period-scoped like
    # total_points below (which only reflects the selected MTD/QTD/YTD
    # window) — this is "how many points do we actually have right now,"
    # not "how many did we earn this quarter."
    _bal = _compute_ecosystem_balance(
        db, eco_id, eco_accts, acct_info, cat_parent_map,
        redemption_rows, transfers_out, transfers_in, adjustment_rows,
        person_transfer_rows, known_people,
    )
    current_balance = _bal['current_balance']
    pending_balance = _bal['pending_balance']
    baseline_date = _date.fromisoformat(_bal['balance_as_of']) if _bal['balance_as_of'] else None
    balance_breakdown = _bal['balance_breakdown']
    balance_by_person = _bal['balance_by_person']

    if not eco_accts:
        return {
            'eco_id': eco_id, 'name': eco.name, 'currency_name': eco.currency_name,
            'your_cpp': eco.your_cpp, 'period': period, 'year': year,
            'start': start.isoformat(), 'end': end.isoformat(),
            'total_points': 0, 'est_value': 0,
            'current_balance': current_balance,
            'pending_balance': pending_balance,
            'balance_as_of': baseline_date.isoformat() if baseline_date else None,
            'balance_breakdown': balance_breakdown,
            'balance_by_person': balance_by_person,
            'known_people': known_people,
            'person_transfers': person_transfers_out,
            'by_category': [], 'by_card': [], 'active_challenges': [],
            'redemptions': redemptions_out,
            'total_points_redeemed': total_points_redeemed,
            'total_cash_value_usd': total_cash_value_usd,
            'realized_cpp': realized_cpp,
            'transfers_out': transfers_out,
            'transfers_in': transfers_in,
            'adjustments': adjustments_out,
            'total_points_adjusted': round(total_points_adjusted, 2),
        }

    # Per-transaction classification read from the locked column (points_earned
    # was frozen at write time — see _lock_points_for_transaction()) — a flat
    # SQL SUM can't express the sign-flip on credits, so this sums in Python.
    window_rows = (
        db.query(Transaction)
        .filter(
            Transaction.account_id.in_(eco_accts),
            Transaction.date >= start,
            Transaction.date <= end,
            Transaction.is_excluded != True,
        )
        .all()
    )

    by_cat: dict[str, float] = {}
    by_acct: dict[int, float] = {}
    total_pts = 0.0
    for t in window_rows:
        if t.action != 'Expense':
            continue
        # auto_top_category accounts are handled separately below, same as
        # /api/cards/earn-summary — compute_points_earn()'s flat base_rate
        # can't express the "top category gets 5x" waterfall.
        if acct_info[t.account_id].get('has_auto_top'):
            continue
        # Locked at write time — see _lock_points_for_transaction().
        pts = t.points_earned or 0
        total_pts += pts
        cat_key = t.points_category or 'Other'
        by_cat[cat_key]        = by_cat.get(cat_key, 0.0)        + pts
        by_acct[t.account_id]  = by_acct.get(t.account_id, 0.0)  + pts

    # auto_top_category accounts (e.g. Citi Custom Cash) — mirrors
    # /api/cards/earn-summary's equivalent branch so the Portfolio tile and
    # this drill-down page can't silently diverge on ecosystems that hold
    # one of these cards (see B11).
    for acct_id in eco_accts:
        info = acct_info[acct_id]
        if not info.get('has_auto_top'):
            continue
        product = info.get('product')
        if not product:
            continue
        try:
            pts = calc_auto_top_category_points(db, acct_id, product, start, end)
        except Exception:
            pts = 0.0
        total_pts += pts
        by_acct[acct_id] = by_acct.get(acct_id, 0.0) + pts
        by_cat['Auto-Optimized (5% Top Category)'] = \
            by_cat.get('Auto-Optimized (5% Top Category)', 0.0) + pts

    cpp   = float(eco.your_cpp)
    total_pts_r = round(total_pts)

    by_cat_out = sorted(
        [{'category': k, 'points': round(v), 'pct': round(v / total_pts * 100, 1) if total_pts else 0}
         for k, v in by_cat.items()],
        key=lambda x: -x['points'],
    )
    # Every card linked to this ecosystem belongs in "Your Cards," even one
    # with zero spend in the selected period — otherwise a card that simply
    # wasn't used this MTD/QTD/YTD silently vanishes from its own ecosystem
    # page instead of showing 0.
    for aid in eco_accts:
        by_acct.setdefault(aid, 0.0)
    by_card_out = sorted(
        [{'account_id': aid, 'account_name': acct_info[aid]['account_name'],
          'mask': acct_info[aid]['mask'],
          'product_key': acct_info[aid]['product'].product_key if acct_info[aid].get('product') else None,
          'points': round(p)}
         for aid, p in by_acct.items()],
        key=lambda x: -x['points'],
    )

    # Active challenges for this ecosystem's cards
    # Multi-card challenges are "exploded" into per-card entries so each
    # card shows its own spend progress and threshold independently.
    active_ch_out: list[dict] = []
    try:
        card_ids_in_eco = [
            card_by_acct[aid].id for aid in eco_accts if aid in card_by_acct
        ]
        card_ids_set = set(card_ids_in_eco)
        _today = datetime.utcnow().date()
        _d_fn  = lambda v: v.date() if isinstance(v, datetime) else v
        for ch in (db.query(SpendChallenge)
                   .filter(SpendChallenge.is_active == True)
                   .filter(or_(
                       SpendChallenge.card_id.in_(card_ids_in_eco),
                       SpendChallenge.id.in_(
                           db.query(ChallengeCardLink.challenge_id)
                           .filter(ChallengeCardLink.card_id.in_(card_ids_in_eco))
                       )
                   )).all()):
            if _d_fn(ch.end_date) < _today or _d_fn(ch.start_date) > _today:
                continue
            # Collect all card IDs involved: primary + linked
            all_card_ids = [ch.card_id] + [lnk.card_id for lnk in ch.card_links]
            # Only include cards that belong to this ecosystem
            eco_card_ids = [cid for cid in all_card_ids if cid in card_ids_set]
            if not eco_card_ids:
                continue
            for cid in eco_card_ids:
                card_obj = db.query(Card).filter_by(id=cid).first()
                if not card_obj:
                    continue
                # Per-card spend override so each card shows its own progress
                spend_ov = (
                    _challenge_spend_for_card(db, ch, card_obj.account_id)
                    if card_obj.account_id else None
                )
                ser = _serialize_challenge(ch, eco=eco, spend_override=spend_ov)
                ser['card_name']  = card_obj.card_name
                ser['last_four']  = card_obj.last_four
                ser['account_id'] = card_obj.account_id
                active_ch_out.append(ser)
    except Exception:
        logger.exception('Unexpected error — rolling back')
        db.rollback()

    return {
        'eco_id':        eco_id,
        'name':          eco.name,
        'currency_name': eco.currency_name,
        'your_cpp':      cpp,
        'period':        period,
        'year':          year,
        'start':         start.isoformat(),
        'end':           end.isoformat(),
        'total_points':  total_pts_r,
        'est_value':     round(total_pts_r * cpp, 2),
        'current_balance': current_balance,
        'pending_balance': pending_balance,
        'balance_as_of': baseline_date.isoformat() if baseline_date else None,
        'balance_breakdown': balance_breakdown,
        'balance_by_person': balance_by_person,
        'known_people': known_people,
        'person_transfers': person_transfers_out,
        'by_category':   by_cat_out,
        'by_card':       by_card_out,
        'active_challenges': active_ch_out,
        'redemptions': redemptions_out,
        'total_points_redeemed': total_points_redeemed,
        'total_cash_value_usd': total_cash_value_usd,
        'realized_cpp': realized_cpp,
        'transfers_out': transfers_out,
        'transfers_in': transfers_in,
        'adjustments': adjustments_out,
        'total_points_adjusted': round(total_points_adjusted, 2),
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
# Redemptions — points redeemed (optionally after a transfer from another
# ecosystem), so realized cpp (cash_value_usd / points_redeemed) can be
# compared against an ecosystem's assumed your_cpp.
# ---------------------------------------------------------------------------



@app.get("/api/redemptions")
async def list_redemptions(ecosystem_id: int = None, db: Session = Depends(get_db)):
    q = db.query(Redemption)
    if ecosystem_id is not None:
        q = q.filter_by(ecosystem_id=ecosystem_id)
    redemptions = q.order_by(Redemption.redemption_date.desc()).all()
    return [_serialize_redemption(r) for r in redemptions]


@app.post("/api/redemptions")
async def create_redemption(data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    try:
        r = Redemption(
            ecosystem_id     = data['ecosystem_id'],
            points_redeemed  = float(data['points_redeemed']),
            redemption_date  = _date.fromisoformat(data['redemption_date']),
            description      = data['description'],
            cash_value_usd   = float(data['cash_value_usd']),
            notes            = data.get('notes'),
            person           = data.get('person') or None,
        )
        db.add(r)
        db.commit()
        db.refresh(r)
        return _serialize_redemption(r)
    except Exception as e:
        db.rollback()
        import traceback
        raise HTTPException(status_code=500, detail=f"create redemption error: {e}\n{traceback.format_exc()}")


@app.patch("/api/redemptions/{redemption_id}")
async def update_redemption(redemption_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    r = db.query(Redemption).filter_by(id=redemption_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Redemption not found")
    if 'ecosystem_id' in data:
        r.ecosystem_id = data['ecosystem_id']
    for field in ('points_redeemed', 'cash_value_usd'):
        if field in data:
            setattr(r, field, float(data[field]) if data[field] is not None else None)
    if 'redemption_date' in data:
        r.redemption_date = _date.fromisoformat(data['redemption_date'])
    if 'description' in data:
        r.description = data['description']
    for field in ('notes', 'person'):
        if field in data:
            setattr(r, field, data[field] or None)
    db.commit()
    db.refresh(r)
    return _serialize_redemption(r)


@app.delete("/api/redemptions/{redemption_id}")
async def delete_redemption(redemption_id: int, db: Session = Depends(get_db)):
    r = db.query(Redemption).filter_by(id=redemption_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Redemption not found")
    db.delete(r)
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Points balance snapshots — manual "I checked and I have X points as of
# today" checkpoints. The most recent one (by snapshot_date) becomes the
# baseline current_balance is computed forward from in
# ecosystem_earn_detail, instead of always summing from account-opening.
# ---------------------------------------------------------------------------



@app.get("/api/ecosystems/{eco_id}/balance-snapshots")
async def list_balance_snapshots(eco_id: int, db: Session = Depends(get_db)):
    snaps = (
        db.query(PointsBalanceSnapshot)
        .filter_by(ecosystem_id=eco_id)
        .order_by(PointsBalanceSnapshot.snapshot_date.desc())
        .all()
    )
    return [_serialize_balance_snapshot(s) for s in snaps]


@app.post("/api/ecosystems/{eco_id}/balance-snapshots")
async def create_balance_snapshot(eco_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    eco = db.query(PointsEcosystem).filter_by(id=eco_id).first()
    if not eco:
        raise HTTPException(status_code=404, detail="Ecosystem not found")
    try:
        s = PointsBalanceSnapshot(
            ecosystem_id  = eco_id,
            balance       = float(data['balance']),
            snapshot_date = _date.fromisoformat(data['snapshot_date']),
            notes         = data.get('notes'),
            person        = data.get('person') or None,
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        return _serialize_balance_snapshot(s)
    except Exception as e:
        db.rollback()
        import traceback
        raise HTTPException(status_code=500, detail=f"create balance snapshot error: {e}\n{traceback.format_exc()}")


@app.patch("/api/balance-snapshots/{snapshot_id}")
async def update_balance_snapshot(snapshot_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    s = db.query(PointsBalanceSnapshot).filter_by(id=snapshot_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if 'balance' in data:
        s.balance = float(data['balance'])
    if 'snapshot_date' in data:
        s.snapshot_date = _date.fromisoformat(data['snapshot_date'])
    if 'notes' in data:
        s.notes = data['notes']
    if 'person' in data:
        s.person = data['person'] or None
    db.commit()
    db.refresh(s)
    return _serialize_balance_snapshot(s)


@app.delete("/api/balance-snapshots/{snapshot_id}")
async def delete_balance_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    s = db.query(PointsBalanceSnapshot).filter_by(id=snapshot_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    db.delete(s)
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Points adjustments — manual, dated +/- corrections to an ecosystem's
# running balance. See PointsAdjustment in database.py for how this differs
# from a PointsBalanceSnapshot (a delta from its date forward, not a reset).
# ---------------------------------------------------------------------------



@app.get("/api/ecosystems/{eco_id}/points-adjustments")
async def list_points_adjustments(eco_id: int, db: Session = Depends(get_db)):
    adjustments = (
        db.query(PointsAdjustment)
        .filter_by(ecosystem_id=eco_id)
        .order_by(PointsAdjustment.adjustment_date.desc())
        .all()
    )
    return [_serialize_adjustment(a) for a in adjustments]


@app.post("/api/ecosystems/{eco_id}/points-adjustments")
async def create_points_adjustment(eco_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    eco = db.query(PointsEcosystem).filter_by(id=eco_id).first()
    if not eco:
        raise HTTPException(status_code=404, detail="Ecosystem not found")
    try:
        a = PointsAdjustment(
            ecosystem_id    = eco_id,
            points_delta    = float(data['points_delta']),
            adjustment_date = _date.fromisoformat(data['adjustment_date']),
            description     = data['description'],
            notes           = data.get('notes'),
            person          = data.get('person') or None,
        )
        db.add(a)
        db.commit()
        db.refresh(a)
        return _serialize_adjustment(a)
    except Exception as e:
        db.rollback()
        import traceback
        raise HTTPException(status_code=500, detail=f"create points adjustment error: {e}\n{traceback.format_exc()}")


@app.patch("/api/points-adjustments/{adjustment_id}")
async def update_points_adjustment(adjustment_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    a = db.query(PointsAdjustment).filter_by(id=adjustment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Adjustment not found")
    if 'points_delta' in data:
        a.points_delta = float(data['points_delta'])
    if 'adjustment_date' in data:
        a.adjustment_date = _date.fromisoformat(data['adjustment_date'])
    if 'description' in data:
        a.description = data['description']
    for field in ('notes', 'person'):
        if field in data:
            setattr(a, field, data[field] or None)
    db.commit()
    db.refresh(a)
    return _serialize_adjustment(a)


@app.delete("/api/points-adjustments/{adjustment_id}")
async def delete_points_adjustment(adjustment_id: int, db: Session = Depends(get_db)):
    a = db.query(PointsAdjustment).filter_by(id=adjustment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Adjustment not found")
    db.delete(a)
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Transfer ratios — effective-dated base ratio per (source, destination)
# ecosystem pair. Editing closes the old "current" row and opens a new one;
# never overwrites history, since Transfers snapshot their own ratio anyway.
# ---------------------------------------------------------------------------



@app.get("/api/transfer-ratios")
async def list_transfer_ratios(current_only: bool = True, db: Session = Depends(get_db)):
    q = db.query(TransferRatio)
    if current_only:
        q = q.filter(TransferRatio.effective_to.is_(None))
    ratios = q.order_by(TransferRatio.source_ecosystem_id, TransferRatio.effective_from.desc()).all()
    return [_serialize_transfer_ratio(tr) for tr in ratios]


@app.post("/api/transfer-ratios")
async def create_transfer_ratio(data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    try:
        source_id = data['source_ecosystem_id']
        dest_id = data['destination_ecosystem_id']
        effective_from = _date.fromisoformat(data['effective_from']) if data.get('effective_from') else _date.today()

        # Close out whatever was "current" for this pair — never overwrite history.
        current = (
            db.query(TransferRatio)
            .filter_by(source_ecosystem_id=source_id, destination_ecosystem_id=dest_id, effective_to=None)
            .first()
        )
        if current:
            current.effective_to = effective_from

        tr = TransferRatio(
            source_ecosystem_id=source_id,
            destination_ecosystem_id=dest_id,
            base_ratio=float(data['base_ratio']),
            effective_from=effective_from,
        )
        db.add(tr)
        db.commit()
        db.refresh(tr)
        return _serialize_transfer_ratio(tr)
    except Exception as e:
        db.rollback()
        import traceback
        raise HTTPException(status_code=500, detail=f"create transfer ratio error: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Transfers — value-neutral point movement between ecosystems. Self-
# contained: base_ratio_used/points_received are snapshotted at creation,
# not recomputed later, so a future TransferRatio edit never touches
# historical Transfers.
# ---------------------------------------------------------------------------



@app.get("/api/transfers")
async def list_transfers(ecosystem_id: int = None, db: Session = Depends(get_db)):
    q = db.query(Transfer)
    if ecosystem_id is not None:
        q = q.filter(or_(Transfer.source_ecosystem_id == ecosystem_id, Transfer.destination_ecosystem_id == ecosystem_id))
    transfers = q.order_by(Transfer.transfer_date.desc()).all()
    return [_serialize_transfer(t) for t in transfers]


@app.post("/api/transfers")
async def create_transfer(data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    try:
        source_id = data['source_ecosystem_id']
        dest_id = data['destination_ecosystem_id']
        points_sent = float(data['points_sent'])
        bonus_pct = float(data['bonus_pct']) if data.get('bonus_pct') else None

        base_ratio_used = data.get('base_ratio_used')
        if base_ratio_used is None:
            current = (
                db.query(TransferRatio)
                .filter_by(source_ecosystem_id=source_id, destination_ecosystem_id=dest_id, effective_to=None)
                .first()
            )
            if not current:
                raise HTTPException(
                    status_code=400,
                    detail="No transfer ratio on file for this pair — set one via /api/transfer-ratios or pass base_ratio_used explicitly.",
                )
            base_ratio_used = current.base_ratio
        base_ratio_used = float(base_ratio_used)

        points_received = data.get('points_received')
        if points_received is None:
            points_received = points_sent * base_ratio_used * (1 + (bonus_pct or 0))
        points_received = float(points_received)

        t = Transfer(
            source_ecosystem_id=source_id,
            destination_ecosystem_id=dest_id,
            points_sent=points_sent,
            base_ratio_used=base_ratio_used,
            bonus_pct=bonus_pct,
            points_received=points_received,
            transfer_date=_date.fromisoformat(data['transfer_date']),
            notes=data.get('notes'),
            person=data.get('person') or None,
            to_person=data.get('to_person') or None,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return _serialize_transfer(t)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback
        raise HTTPException(status_code=500, detail=f"create transfer error: {e}\n{traceback.format_exc()}")


@app.patch("/api/transfers/{transfer_id}")
async def update_transfer(transfer_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    t = db.query(Transfer).filter_by(id=transfer_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transfer not found")
    for field in ('source_ecosystem_id', 'destination_ecosystem_id'):
        if field in data:
            setattr(t, field, data[field])
    for field in ('points_sent', 'base_ratio_used', 'bonus_pct', 'points_received'):
        if field in data:
            setattr(t, field, float(data[field]) if data[field] is not None else None)
    if 'transfer_date' in data:
        t.transfer_date = _date.fromisoformat(data['transfer_date'])
    for field in ('notes', 'person', 'to_person'):
        if field in data:
            setattr(t, field, data[field] or None)
    db.commit()
    db.refresh(t)
    return _serialize_transfer(t)


@app.delete("/api/transfers/{transfer_id}")
async def delete_transfer(transfer_id: int, db: Session = Depends(get_db)):
    t = db.query(Transfer).filter_by(id=transfer_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transfer not found")
    db.delete(t)
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Person-to-person points transfers — same currency, same ecosystem, just
# changing whose balance the points count against (e.g. Omer sends 20,000
# Chase UR points to Daniella). Distinct from Transfer above, which moves
# points between two different currencies for one person. No ratio/bonus:
# it's the same points. Whether a program actually allows this is a
# judgment call made when logging one, not something enforced here.
# ---------------------------------------------------------------------------



@app.get("/api/ecosystems/{eco_id}/person-transfers")
async def list_person_transfers(eco_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(PersonPointsTransfer)
        .filter_by(ecosystem_id=eco_id)
        .order_by(PersonPointsTransfer.transfer_date.desc())
        .all()
    )
    return [_serialize_person_transfer(pt) for pt in rows]


@app.post("/api/ecosystems/{eco_id}/person-transfers")
async def create_person_transfer(eco_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    eco = db.query(PointsEcosystem).filter_by(id=eco_id).first()
    if not eco:
        raise HTTPException(status_code=404, detail="Ecosystem not found")
    if not data.get('from_person') or not data.get('to_person'):
        raise HTTPException(status_code=400, detail="from_person and to_person are required")
    if data['from_person'] == data['to_person']:
        raise HTTPException(status_code=400, detail="from_person and to_person must be different people")
    try:
        pt = PersonPointsTransfer(
            ecosystem_id  = eco_id,
            from_person   = data['from_person'],
            to_person     = data['to_person'],
            points        = float(data['points']),
            transfer_date = _date.fromisoformat(data['transfer_date']),
            notes         = data.get('notes'),
        )
        db.add(pt)
        db.commit()
        db.refresh(pt)
        return _serialize_person_transfer(pt)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback
        raise HTTPException(status_code=500, detail=f"create person transfer error: {e}\n{traceback.format_exc()}")


@app.patch("/api/person-transfers/{transfer_id}")
async def update_person_transfer(transfer_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    pt = db.query(PersonPointsTransfer).filter_by(id=transfer_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="Person transfer not found")
    for field in ('from_person', 'to_person'):
        if field in data:
            setattr(pt, field, data[field])
    if 'points' in data:
        pt.points = float(data['points'])
    if 'transfer_date' in data:
        pt.transfer_date = _date.fromisoformat(data['transfer_date'])
    if 'notes' in data:
        pt.notes = data['notes']
    db.commit()
    db.refresh(pt)
    return _serialize_person_transfer(pt)


@app.delete("/api/person-transfers/{transfer_id}")
async def delete_person_transfer(transfer_id: int, db: Session = Depends(get_db)):
    pt = db.query(PersonPointsTransfer).filter_by(id=transfer_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="Person transfer not found")
    db.delete(pt)
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Spend Challenges
# ---------------------------------------------------------------------------

@app.get("/api/challenges")
async def get_challenges(
    active_only: bool = False,
    card_id: int = None,
    db: Session = Depends(get_db),
):
    """List challenges. Optionally filter by card_id (used by the card detail page)."""
    try:
        q = db.query(SpendChallenge)
        if active_only:
            q = q.filter_by(is_active=True)
        if card_id is not None:
            # Include challenges where this card is primary OR linked via ChallengeCardLink
            q = q.filter(
                or_(
                    SpendChallenge.card_id == card_id,
                    SpendChallenge.id.in_(
                        db.query(ChallengeCardLink.challenge_id)
                        .filter(ChallengeCardLink.card_id == card_id)
                    )
                )
            )
        challenges = q.order_by(SpendChallenge.end_date.desc()).all()
        # When fetching for a specific card, look up its account once so we
        # can display per-card spend rather than the multi-card aggregate.
        per_card_acct_id = None
        if card_id is not None:
            _this_card = db.query(Card).filter_by(id=card_id).first()
            if _this_card:
                per_card_acct_id = _this_card.account_id

        # Build eco lookup via card → product → ecosystem
        results = []
        for c in challenges:
            try:
                _recalc_challenge(db, c)
            except Exception:
                logger.exception('Unexpected error — rolling back')
                db.rollback()  # clear bad session state so the final commit doesn't fail
            eco = None
            card = db.query(Card).filter_by(id=c.card_id).first()
            if card and card.product_id:
                prod = db.query(CardProduct).filter_by(id=card.product_id).first()
                if prod and prod.ecosystem_id:
                    eco = db.query(PointsEcosystem).filter_by(id=prod.ecosystem_id).first()
            # Per-card spend override: only count this card's transactions
            spend_ov = (
                _challenge_spend_for_card(db, c, per_card_acct_id)
                if per_card_acct_id is not None else None
            )
            results.append(_serialize_challenge(c, eco, spend_override=spend_ov))
        db.commit()  # persist recalculated spend/bonus_unlocked
        return results
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"challenges error: {e}\n{traceback.format_exc()}")




@app.get("/api/challenges/suggestions")
async def get_challenge_suggestions(db: Session = Depends(get_db)):
    """Return CHALLENGE_TEMPLATES for cards the user currently holds that don't
    already have a matching active challenge this year."""
    from datetime import date as _date
    year = _date.today().year
    # Map product_key → card id for cards the user holds
    cards = db.query(Card).join(CardProduct, Card.product_id == CardProduct.id).all()
    product_key_to_card = {}
    for card in cards:
        prod = db.query(CardProduct).filter_by(id=card.product_id).first()
        if prod:
            product_key_to_card.setdefault(prod.product_key, []).append(card)

    # Existing active challenges this year (avoid duplicate suggestions)
    existing_names = {
        c.name for c in db.query(SpendChallenge)
        .filter(SpendChallenge.is_active == True)
        .filter(SpendChallenge.end_date >= _date(year, 1, 1))
        .all()
    }

    suggestions = []
    for tmpl in CHALLENGE_TEMPLATES:
        key = tmpl.get('product_key')
        if key not in product_key_to_card:
            continue
        if tmpl['name'] in existing_names:
            continue
        for card in product_key_to_card[key]:
            suggestions.append({**tmpl, 'card_id': card.id})
    return suggestions


@app.post("/api/challenges")
async def create_challenge(data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    try:
        c = SpendChallenge(
            card_id         = data['card_id'],
            name            = data['name'],
            challenge_type  = data['challenge_type'],
            start_date      = _date.fromisoformat(data['start_date'][:10]),
            end_date        = _date.fromisoformat(data['end_date'][:10]),
            activation_date = _date.fromisoformat(data['activation_date'][:10]) if data.get('activation_date') else None,
            bonus_type      = data['bonus_type'],
            bonus_amount    = float(data['bonus_amount']),
            spend_cap       = float(data['spend_cap']) if data.get('spend_cap') else None,
            spend_threshold = float(data['spend_threshold']) if data.get('spend_threshold') else None,
            spender_filter  = data.get('spender_filter') or None,
            max_occurrences = int(data['max_occurrences']) if data.get('max_occurrences') else None,
            is_active       = data.get('is_active', True),
            notes           = data.get('notes'),
        )
        db.add(c)
        db.flush()  # get c.id so junction rows can reference it
        _sync_challenge_links(db, c, data.get('additional_card_ids'), data.get('category_names'))
        db.flush()
        try:
            _recalc_challenge(db, c)
        except Exception as recalc_err:
            # Recalc is best-effort — don't block challenge creation if it fails.
            # The GET endpoint will retry recalc on every load.
            import traceback as _tb
            logger.info(f"[recalc warn] challenge {c.id}: {recalc_err}\n{_tb.format_exc()}")
        db.commit()
        db.refresh(c)
        return _serialize_challenge(c)
    except Exception as e:
        db.rollback()
        import traceback
        raise HTTPException(status_code=500, detail=f"create challenge error: {e}\n{traceback.format_exc()}")


@app.post("/api/challenges/recalc-all")
async def recalc_all_challenges(db: Session = Depends(get_db)):
    challenges = db.query(SpendChallenge).filter_by(is_active=True).all()
    for c in challenges:
        _recalc_challenge(db, c)
    db.commit()
    return {"recalculated": len(challenges)}


@app.patch("/api/challenges/{challenge_id}")
async def update_challenge(challenge_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    from datetime import date as _date
    c = db.query(SpendChallenge).filter_by(id=challenge_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Challenge not found")
    for field in ('name', 'challenge_type', 'bonus_type', 'notes', 'is_active'):
        if field in data:
            setattr(c, field, data[field])
    for field in ('bonus_amount', 'spend_cap', 'spend_threshold'):
        if field in data:
            setattr(c, field, float(data[field]) if data[field] is not None else None)
    if 'spender_filter' in data:
        c.spender_filter = data['spender_filter'] or None
    if 'max_occurrences' in data:
        c.max_occurrences = int(data['max_occurrences']) if data['max_occurrences'] else None
    for field in ('start_date', 'end_date'):
        if field in data:
            # [:10] — tolerate a full ISO datetime string (some legacy rows have
            # start_date/end_date stored with a "T00:00:00" suffix, which
            # date.fromisoformat() can't parse directly), not just plain YYYY-MM-DD.
            setattr(c, field, _date.fromisoformat(data[field][:10]))
    if 'activation_date' in data:
        c.activation_date = _date.fromisoformat(data['activation_date'][:10]) if data['activation_date'] else None
    # Update junction tables if provided
    if 'additional_card_ids' in data or 'category_names' in data:
        _sync_challenge_links(
            db, c,
            data.get('additional_card_ids'),
            data.get('category_names'),
        )
        db.flush()
    _recalc_challenge(db, c)
    db.commit()
    db.refresh(c)
    return _serialize_challenge(c)


@app.delete("/api/challenges/{challenge_id}")
async def delete_challenge(challenge_id: int, db: Session = Depends(get_db)):
    c = db.query(SpendChallenge).filter_by(id=challenge_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Challenge not found")
    db.delete(c)
    db.commit()
    return {"deleted": True}


@app.post("/api/challenges/{challenge_id}/recalc")
async def recalc_challenge(challenge_id: int, db: Session = Depends(get_db)):
    c = db.query(SpendChallenge).filter_by(id=challenge_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Challenge not found")
    _recalc_challenge(db, c)
    db.commit()
    db.refresh(c)
    return _serialize_challenge(c)


# ---------------------------------------------------------------------------
# Benefits (CardBenefit + BenefitUsage)
# ---------------------------------------------------------------------------







@app.get("/api/cards/{card_id}/benefits")
async def get_card_benefits(card_id: int, db: Session = Depends(get_db)):
    """All benefits for the product linked to this card, with current-cycle usage.

    'periodic' benefits with a sub-annual reset_frequency (monthly/quarterly/
    semi-annual) also get a `cycles` array — every period in the current year
    with its used/unused state — so the frontend can render a checkbox grid
    instead of a single current-cycle progress bar. 'by_use' benefits and
    annual/calendar_year ones get no `cycles` (single-instance treatment).
    """
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if not card.product_id:
        return []
    benefits = (db.query(CardBenefit)
                  .filter_by(product_id=card.product_id)
                  .order_by(CardBenefit.amount.desc(), CardBenefit.benefit_name)
                  .all())
    result = []
    for b in benefits:
        frequency = b.reset_frequency or 'annual'
        cycle = _current_cycle(frequency)
        usage = db.query(BenefitUsage).filter_by(
            benefit_id=b.id, card_id=card_id, cycle=cycle
        ).first()
        ser = _serialize_benefit(b, usage)
        if (b.tracking_type or 'periodic') == 'periodic' and frequency in ('monthly', 'quarterly', 'semi-annual'):
            from datetime import date as _date
            year = _date.today().year
            cycles = _cycles_for_year(frequency, year)
            usages_by_cycle = {
                u.cycle: u for u in db.query(BenefitUsage).filter(
                    BenefitUsage.benefit_id == b.id,
                    BenefitUsage.card_id == card_id,
                    BenefitUsage.cycle.in_(cycles),
                ).all()
            }
            ser['cycles'] = [{
                'cycle': c,
                'used': bool(usages_by_cycle.get(c) and usages_by_cycle[c].amount_used > 0),
                'amount_used': usages_by_cycle[c].amount_used if usages_by_cycle.get(c) else 0,
                'usage_id': usages_by_cycle[c].id if usages_by_cycle.get(c) else None,
            } for c in cycles]
        result.append(ser)
    return result


@app.post("/api/card-products/{product_id}/benefits")
async def create_benefit(product_id: int, body: dict, db: Session = Depends(get_db)):
    prod = db.query(CardProduct).filter_by(id=product_id).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Card product not found")
    b = CardBenefit(
        product_id=product_id,
        benefit_name=(body.get('benefit_name') or '').strip(),
        amount=float(body.get('amount') or 0),
        reset_frequency=body.get('reset_frequency') or 'annual',
        trigger_category=body.get('trigger_category') or None,
        notes=body.get('notes') or None,
        tracking_type=body.get('tracking_type') or 'periodic',
    )
    if not b.benefit_name:
        raise HTTPException(status_code=400, detail="benefit_name is required")
    db.add(b)
    db.commit()
    db.refresh(b)
    return _serialize_benefit(b, None)


@app.patch("/api/benefits/{benefit_id}")
async def update_benefit(benefit_id: int, body: dict, db: Session = Depends(get_db)):
    b = db.query(CardBenefit).filter_by(id=benefit_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Benefit not found")
    if 'benefit_name' in body:
        b.benefit_name = (body['benefit_name'] or '').strip()
    if 'amount' in body:
        b.amount = float(body['amount'] or 0)
    if 'reset_frequency' in body:
        b.reset_frequency = body['reset_frequency'] or 'annual'
    if 'trigger_category' in body:
        b.trigger_category = body['trigger_category'] or None
    if 'notes' in body:
        b.notes = body['notes'] or None
    if 'tracking_type' in body:
        b.tracking_type = body['tracking_type'] or 'periodic'
    db.commit()
    cycle = _current_cycle(b.reset_frequency or 'annual')
    usage = db.query(BenefitUsage).filter_by(benefit_id=b.id, cycle=cycle).first()
    return _serialize_benefit(b, usage)


@app.delete("/api/benefits/{benefit_id}")
async def delete_benefit(benefit_id: int, db: Session = Depends(get_db)):
    b = db.query(CardBenefit).filter_by(id=benefit_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Benefit not found")
    db.delete(b)
    db.commit()
    return {"deleted": True}


@app.put("/api/benefits/{benefit_id}/usage")
async def upsert_benefit_usage(benefit_id: int, body: dict, db: Session = Depends(get_db)):
    """Create or update usage for a benefit in the current (or specified) cycle."""
    b = db.query(CardBenefit).filter_by(id=benefit_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Benefit not found")
    card_id    = body.get('card_id')
    cycle      = body.get('cycle') or _current_cycle(b.reset_frequency or 'annual')
    amt_used   = float(body.get('amount_used', 0))
    confirmed  = bool(body.get('confirmed', True))
    notes      = body.get('notes') or None
    usage = db.query(BenefitUsage).filter_by(
        benefit_id=benefit_id, card_id=card_id, cycle=cycle
    ).first()
    if usage:
        usage.amount_used = amt_used
        usage.confirmed   = confirmed
        usage.notes       = notes
    else:
        usage = BenefitUsage(
            benefit_id=benefit_id, card_id=card_id, cycle=cycle,
            amount_used=amt_used, confirmed=confirmed, notes=notes,
        )
        db.add(usage)
    db.commit()
    db.refresh(usage)
    return _serialize_benefit(b, usage)


@app.delete("/api/benefit-usage/{usage_id}")
async def delete_benefit_usage(usage_id: int, db: Session = Depends(get_db)):
    u = db.query(BenefitUsage).filter_by(id=usage_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usage record not found")
    db.delete(u)
    db.commit()
    return {"deleted": True}


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
                    'best_buy': ['best buy'], 'united': ['united'],
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
        old_product_id = account.product_id
        account.product_id = None
        card = db.query(Card).filter_by(account_id=account_id).first()
        if card:
            card.product_id = None
        db.commit()
        _refresh_product_held_status(db, old_product_id)
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
    _refresh_product_held_status(db, product_id)
    db.commit()
    return {
        "status": "linked",
        "account_id": account_id,
        "product_id": product_id,
        "product_name": product.card_name,
    }


@app.post("/api/cards/{card_id}/change-product")
async def change_card_product(card_id: int, body: dict, db: Session = Depends(get_db)):
    """
    Convert a card to a different product going forward — e.g. the issuer
    product-changes a Marriott Bonvoy Boundless card to Ritz-Carlton — while
    keeping the same Account/Card and its full transaction history.

    Unlike link-product (a bare overwrite meant for first-time linking of an
    unlinked account), this closes out the current CardProductHistory row and
    opens a new one, so which product was active on any given date stays
    discoverable. Critically, it never touches any existing Transaction row:
    each one already locked its own points_earned/points_product_id at write
    time (see _lock_points_for_transaction()), so old spend keeps computing
    under the OLD product's rates and only new/edited transactions pick up
    the new one — no retroactive change to historical numbers.
    """
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    old_product_id = card.product_id

    new_product_id = body.get('product_id')
    if not new_product_id:
        raise HTTPException(status_code=400, detail="product_id is required")

    new_product = db.query(CardProduct).filter_by(id=new_product_id).first()
    if not new_product:
        raise HTTPException(status_code=404, detail="Product not found")

    from datetime import date as _date
    effective_date_str = body.get('effective_date')
    effective_date = _date.fromisoformat(effective_date_str[:10]) if effective_date_str else _date.today()

    current_hist = (
        db.query(CardProductHistory)
        .filter_by(card_id=card_id, effective_to=None)
        .order_by(CardProductHistory.effective_from.desc())
        .first()
    )
    if not current_hist and card.product_id:
        # Bootstrap: no history row exists yet (every card before its first
        # product change) — synthesize one starting from the card's earliest
        # transaction, falling back to its issue date.
        earliest_txn = (
            db.query(Transaction)
            .filter_by(card_id=card_id)
            .order_by(Transaction.date.asc())
            .first()
        )
        bootstrap_from = (
            earliest_txn.date.date() if earliest_txn
            else (card.issue_date.date() if card.issue_date else effective_date)
        )
        current_hist = CardProductHistory(
            card_id=card_id, product_id=card.product_id,
            effective_from=bootstrap_from, effective_to=None,
        )
        db.add(current_hist)
        db.flush()

    if current_hist:
        current_hist.effective_to = effective_date

    db.add(CardProductHistory(
        card_id=card_id, product_id=new_product_id,
        effective_from=effective_date, effective_to=None,
    ))

    # Same dual-write convention as link-product, so every "current product"
    # read site (e.g. _build_points_lookup) keeps working unchanged.
    card.product_id = new_product_id
    if new_product.ecosystem_id:
        card.ecosystem_id = new_product.ecosystem_id
    if card.account_id:
        account = db.query(Account).filter_by(id=card.account_id).first()
        if account:
            account.product_id = new_product_id

    db.commit()
    _refresh_product_held_status(db, old_product_id)
    _refresh_product_held_status(db, new_product_id)
    db.commit()
    return {
        "status": "changed",
        "card_id": card_id,
        "new_product_id": new_product_id,
        "new_product_name": new_product.card_name,
        "effective_date": effective_date.isoformat(),
    }


@app.get("/api/cards/{card_id}/product-history")
async def get_card_product_history(card_id: int, db: Session = Depends(get_db)):
    """Chronological product-change log for a card, oldest first."""
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    rows = (
        db.query(CardProductHistory)
        .filter_by(card_id=card_id)
        .order_by(CardProductHistory.effective_from.asc())
        .all()
    )
    product_ids = {r.product_id for r in rows}
    products = (
        {p.id: p for p in db.query(CardProduct).filter(CardProduct.id.in_(product_ids)).all()}
        if product_ids else {}
    )

    return [{
        "id": r.id,
        "product_id": r.product_id,
        "product_name": products[r.product_id].card_name if r.product_id in products else None,
        "effective_from": r.effective_from.isoformat(),
        "effective_to": r.effective_to.isoformat() if r.effective_to else None,
        "is_current": r.effective_to is None,
    } for r in rows]


def _annual_fee_cycle_window(issue_date) -> tuple:
    """
    (cycle_start, cycle_end) for the annual-fee cycle currently in effect,
    anchored to the card's issue_date anniversary — the fee posts on this
    date each year, so anchoring here (rather than calendar year) keeps a
    fee charged in, say, March correctly netted against credits redeemed
    through the following February, even though that window crosses Jan 1.
    Falls back to the current calendar year when issue_date is unset.
    """
    from datetime import date as _date, timedelta as _timedelta
    import calendar as _cal
    today = _date.today()
    if not issue_date:
        return _date(today.year, 1, 1), _date(today.year, 12, 31)
    d = issue_date.date() if hasattr(issue_date, 'date') else issue_date
    month, day = d.month, d.day

    def _safe_date(year, month, day):
        last_day = _cal.monthrange(year, month)[1]
        return _date(year, month, min(day, last_day))

    this_year_anniv = _safe_date(today.year, month, day)
    if today >= this_year_anniv:
        cycle_start = this_year_anniv
        cycle_end = _safe_date(today.year + 1, month, day) - _timedelta(days=1)
    else:
        cycle_start = _safe_date(today.year - 1, month, day)
        cycle_end = this_year_anniv - _timedelta(days=1)
    return cycle_start, cycle_end


@app.get("/api/accounts/{account_id}/card-detail")
async def account_card_detail(account_id: int, months: int = 3, period: str = None, db: Session = Depends(get_db)):
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
    today = now.date()
    # Compute lookback based on period or months
    if period == 'mtd':
        # Month-to-date: first day of current month
        lookback = datetime(today.year, today.month, 1)
    elif period == 'qtd':
        # Quarter-to-date: first day of current quarter (Jan/Apr/Jul/Oct)
        q_start_month = ((today.month - 1) // 3) * 3 + 1
        lookback = datetime(today.year, q_start_month, 1)
    elif period == 'ytd':
        # Year-to-date: Jan 1 of current year
        lookback = datetime(today.year, 1, 1)
    else:
        # Fallback: exact first-of-month N months ago
        lb_year = today.year
        lb_month = today.month - months
        while lb_month <= 0:
            lb_month += 12
            lb_year -= 1
        lookback = datetime(lb_year, lb_month, 1)

    # Recent transactions (last 30) — include points_category for display
    txns = db.query(Transaction).filter_by(account_id=account.id)\
        .filter(Transaction.is_excluded != True)\
        .order_by(Transaction.date.desc()).limit(30).all()
    recent_txns = []
    for t in txns:
        # Locked at write time — see _lock_points_for_transaction().
        recent_txns.append({
            'id': t.id, 'date': t.date.strftime('%Y-%m-%d'),
            'description': t.description_clean or t.description_raw,
            'amount': t.amount,
            'category': t.category_manual or t.category_auto,
            'points_category': t.points_category,
            'action': t.action,
            'earn_rate': t.points_earn_rate or 0,
            'points_earn': round(t.points_earned or 0, 1),
            'points_earn_classification': t.points_earn_classification,
        })

    # Spending grouped by points_category — sums the locked points_earned
    # column per category (a flat SQL SUM can't express the sign-flip on
    # credits, so this is a Python-side loop).
    window_txns = (
        db.query(Transaction)
        .filter(
            Transaction.account_id == account.id,
            Transaction.date >= lookback,
            Transaction.is_excluded != True,   # exclude soft-deleted (pending→posted dupes)
        )
        .all()
    )
    cat_agg: dict[str, dict] = {}
    for t in window_txns:
        if t.action != 'Expense':
            continue
        label = t.points_category or 'Other'
        entry = cat_agg.setdefault(label, {'amount': 0.0, 'count': 0, 'points': 0.0})
        entry['amount'] += -t.amount   # expenses negative, returns positive → net spend
        entry['count'] += 1
        entry['points'] += t.points_earned or 0  # locked at write time

    for label, agg in cat_agg.items():
        amt  = round(max(0.0, agg['amount']), 2)  # net spend ≥ 0 for display
        rate = calc_earn_rate(bonus_by_name, base_rate, None if label == 'Other' else label, cat_parent_map)
        pts  = round(agg['points'])
        spending_by_category.append({
            'category': label,
            'amount': amt,
            'count': agg['count'],
            'earn_rate': rate,
            'points_earned': pts,
        })
        points_earned['total'] += pts
        points_earned['by_category'].append({'category': label, 'points': pts})
    spending_by_category.sort(key=lambda x: x['amount'], reverse=True)

    # Monthly spending trend (expenses are stored negative → abs for display)
    month_spend = (
        db.query(
            _func.extract('year', Transaction.date).label('yr'),
            _func.extract('month', Transaction.date).label('mo'),
            _func.sum(Transaction.amount),
        )
        .filter(
            Transaction.account_id == account.id,
            Transaction.date >= lookback,
            Transaction.amount < 0,      # expenses are stored negative
            Transaction.action == 'Expense',
            Transaction.is_excluded != True,   # exclude soft-deleted dupes
        )
        .group_by('yr', 'mo').order_by('yr', 'mo').all()
    )
    for yr, mo, total in month_spend:
        monthly_spend.append({'month': f"{int(yr)}-{int(mo):02d}", 'amount': round(abs(total or 0), 2)})

    # Benefits
    benefits = []
    if product and card:
        try:
            for b in sorted(product.benefits, key=lambda x: -(x.amount or 0)):
                cycle = _current_cycle(b.reset_frequency or 'annual')
                usage = db.query(BenefitUsage).filter_by(
                    benefit_id=b.id, card_id=card.id, cycle=cycle
                ).first()
                benefits.append(_serialize_benefit(b, usage))
        except Exception:
            benefits = []
            db.rollback()

    # Utilization
    utilization = None
    if card and card.credit_limit and balance:
        utilization = round(abs(balance) / card.credit_limit * 100, 1)

    # Annual fee vs. credits — Omer classifies both the fee itself and any
    # credits he redeems under the general category 'Fees & Interest', so
    # netting that category within the current fee cycle answers "is this
    # fee worth it" directly, without a separate credits-tracking scheme.
    annual_fee_summary = None
    if card:
        cycle_start, cycle_end = _annual_fee_cycle_window(card.issue_date)
        fee_cat_txns = (
            db.query(Transaction)
            .filter(
                Transaction.account_id == account.id,
                Transaction.date >= cycle_start,
                Transaction.date <= cycle_end,
                Transaction.is_excluded != True,
            )
            .all()
        )
        fee_cat_txns = [t for t in fee_cat_txns if (t.category_manual or t.category_auto) == 'Fees & Interest']
        fee_charged = sum(-t.amount for t in fee_cat_txns if t.amount < 0)
        credits_received = sum(t.amount for t in fee_cat_txns if t.amount > 0)
        annual_fee_summary = {
            'fee_charged': round(fee_charged, 2),
            'credits_received': round(credits_received, 2),
            'net_cost': round(fee_charged - credits_received, 2),
            'cycle_start': cycle_start.isoformat(),
            'cycle_end': cycle_end.isoformat(),
        }

    # Challenge bonus points — separate from base-rate points.
    # Shows bonus pts earned across all active challenges for this card
    # (for threshold challenges, only count if threshold met).
    # Wrapped in try/except so a missing table (first deploy) never breaks card detail.
    challenge_points = []
    challenge_pts_total = 0.0     # points-currency challenges only ('flat'/'per_dollar')
    challenge_credit_total = 0.0  # 'statement_credit' challenges only — real dollars, kept separate
    if card:
        try:
            # Include challenges where this card is the primary card
            # OR where it appears as an additional linked card
            active_challenges = (
                db.query(SpendChallenge)
                .filter(SpendChallenge.is_active == True)
                .filter(
                    or_(
                        SpendChallenge.card_id == card.id,
                        SpendChallenge.id.in_(
                            db.query(ChallengeCardLink.challenge_id)
                            .filter(ChallengeCardLink.card_id == card.id)
                        )
                    )
                )
                .all()
            )
            for ch in active_challenges:
                try:
                    _recalc_challenge(db, ch)   # keeps aggregate spend fresh in DB
                except Exception:
                    logger.debug('Suppressed exception', exc_info=True)
            db.commit()
            for ch in active_challenges:
                # Use per-card spend so linked cards show their own spend,
                # not the multi-card aggregate stored in ch.current_spend.
                per_spend = _challenge_spend_for_card(db, ch, account.id)
                prog = _challenge_progress(ch, per_spend)
                bp = prog['bonus_pts']

                challenge_points.append({
                    'id': ch.id,
                    'name': ch.name,
                    'bonus_pts': round(bp, 0),
                    'bonus_amount': ch.bonus_amount,
                    'bonus_type': ch.bonus_type,
                    'bonus_currency': 'usd' if ch.bonus_type == 'statement_credit' else ('benefit' if ch.bonus_type == 'benefit' else 'points'),
                    'category_names': [lnk.category_name for lnk in ch.category_links],
                    'spend_cap': ch.spend_cap,
                    'spend_threshold': ch.spend_threshold,
                    'current_spend': round(per_spend, 2),   # per-card, not aggregate
                    'lap_spend': prog['lap_spend'],
                    'progress_pct': prog['progress_pct'],
                    'occurrences_earned': prog['occurrences_earned'],
                    'max_occurrences': prog['max_occurrences'],
                    'threshold_met': prog['bonus_unlocked'],
                })
                if ch.bonus_type == 'statement_credit':
                    challenge_credit_total += bp
                elif ch.bonus_type != 'benefit':
                    challenge_pts_total += bp
        except Exception:
            # challenge tables may not exist yet on first deploy — degrade gracefully
            challenge_points = []
            challenge_pts_total = 0.0
            challenge_credit_total = 0.0
            db.rollback()

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
        'annual_fee_summary': annual_fee_summary,
        'spend_challenges': [],   # loaded separately via /api/challenges
        'utilization': utilization,
        'spending_by_category': spending_by_category,
        'points_earned': points_earned,
        'challenge_points': challenge_points,
        'challenge_pts_total': round(challenge_pts_total, 0),
        'challenge_credit_total': round(challenge_credit_total, 2),
        'monthly_spend': monthly_spend,
        'recent_transactions': recent_txns,
    }


@app.get("/api/accounts/{account_id}/transactions")
async def account_transactions(
    account_id: int,
    year: int = None,
    month: int = None,
    quarter: int = None,
    start_date: str = None,
    end_date: str = None,
    action: str = None,
    csc: str = None,
    category: str = None,
    db: Session = Depends(get_db),
):
    """Filtered transaction list for an account.

    - start_date + end_date → arbitrary custom range (ISO 'YYYY-MM-DD'), takes
      precedence over year/month/quarter — e.g. to isolate spend for a spend
      challenge window that doesn't align to a calendar month/quarter
    - year + month          → calendar month
    - year + quarter (1-4)  → calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec)
    - year only             → full calendar year
    - neither               → most recent 200 transactions
    Optionally filter by action ('Expense', 'Income', etc.), csc (points_category,
    the earn-rate category), and category (category_manual/category_auto, the
    general finance category — independent of csc; e.g. 'Fees & Interest' for
    the annual-fee-vs-credits view, where txns are usually points-category-less).
    Pass csc='__none__' to return only transactions with no points_category assigned.
    Returns {transactions: [...], summary: {total_spend, total_pts, by_csc: {...}},
             available_cscs: [...]}.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Earn-rate helpers — check both account.product_id and card.product_id
    # to match the logic in /accounts/{id}/card-detail
    all_categories = db.query(PointsCategory).filter_by(is_active=True).all()
    cat_parent_map = {c.name: c.parent_key for c in all_categories}
    base_rate = 1.0
    bonus_by_name: dict[str, float] = {}
    product = None
    if account.product_id:
        product = db.query(CardProduct).filter_by(id=account.product_id).first()
    card = db.query(Card).filter_by(account_id=account_id).first()
    if not product and card and card.product_id:
        product = db.query(CardProduct).filter_by(id=card.product_id).first()
    if product:
        for r in db.query(CardProductReward).filter_by(product_id=product.id).all():
            if r.is_base_rate:
                base_rate = r.multiplier
            elif r.points_category:
                bonus_by_name[r.points_category.name] = r.multiplier

    # Note: deliberately does NOT filter out is_excluded transactions — matches
    # /api/transactions' convention of returning them (dimmed client-side) so a
    # user can see and un-exclude them, rather than making them disappear.
    q = db.query(Transaction).filter(
        Transaction.account_id == account_id,
    )
    if start_date and end_date:
        from datetime import date as _date
        q = q.filter(
            Transaction.date >= _date.fromisoformat(start_date),
            Transaction.date <= _date.fromisoformat(end_date),
        )
    elif year and month:
        from datetime import date as _date
        import calendar as _cal
        first_day = _date(year, month, 1)
        last_day  = _date(year, month, _cal.monthrange(year, month)[1])
        q = q.filter(Transaction.date >= first_day, Transaction.date <= last_day)
    elif year and quarter:
        from datetime import date as _date
        import calendar as _cal
        q_start_month = (quarter - 1) * 3 + 1
        q_end_month   = q_start_month + 2
        first_day = _date(year, q_start_month, 1)
        last_day  = _date(year, q_end_month, _cal.monthrange(year, q_end_month)[1])
        q = q.filter(Transaction.date >= first_day, Transaction.date <= last_day)
    elif year:
        from datetime import date as _date
        q = q.filter(
            Transaction.date >= _date(year, 1, 1),
            Transaction.date <= _date(year, 12, 31),
        )
    if action:
        q = q.filter(Transaction.action == action)

    # Fetch all matching transactions (before CSC filter) to compute available CSCs
    all_period_txns = q.order_by(Transaction.date.desc()).limit(500).all()
    available_cscs = sorted({t.points_category for t in all_period_txns if t.points_category})

    # Apply CSC filter
    if csc == '__none__':
        filtered = [t for t in all_period_txns if not t.points_category]
    elif csc:
        filtered = [t for t in all_period_txns if t.points_category == csc]
    else:
        filtered = all_period_txns

    # Apply general-category filter (independent of csc — e.g. 'Fees & Interest')
    if category:
        filtered = [t for t in filtered if (t.category_manual or t.category_auto) == category]

    # Build summary across filtered set — signed points-earn read straight
    # off the locked columns (see _lock_points_for_transaction()).
    total_spend = 0.0
    total_pts   = 0.0
    by_csc: dict[str, dict] = {}
    for t in filtered:
        pts = t.points_earned or 0
        # Excluded transactions (annual fees, etc.) don't count as spend either —
        # matches the SUB/challenge spend calc's own is_excluded filter.
        if t.amount and t.amount < 0 and not t.is_excluded:
            total_spend += abs(t.amount)
        total_pts += pts
        key = t.points_category or '__none__'
        if key not in by_csc:
            by_csc[key] = {'spend': 0.0, 'pts': 0.0, 'count': 0}
        if t.amount and t.amount < 0 and not t.is_excluded:
            by_csc[key]['spend'] += abs(t.amount)
        by_csc[key]['pts']   += pts
        by_csc[key]['count'] += 1

    rows = [{
        'id': t.id, 'date': t.date.strftime('%Y-%m-%d'),
        'description': t.description_clean or t.description_raw,
        'merchant_name': t.merchant_name,
        'amount': t.amount,
        'category': t.category_manual or t.category_auto,
        'points_category': t.points_category,
        'spender': t.spender,
        'action': t.action,
        'is_excluded': bool(t.is_excluded),
        'earn_rate': t.points_earn_rate or 0,
        'points_earn': round(t.points_earned or 0, 1),
        'points_earn_classification': t.points_earn_classification,
    } for t in filtered[:200]]

    return {
        'transactions': rows,
        'summary': {
            'total_spend': round(total_spend, 2),
            'total_pts': round(total_pts, 0),
            'by_csc': {k: {
                'spend': round(v['spend'], 2),
                'pts': round(v['pts'], 0),
                'count': v['count'],
            } for k, v in by_csc.items()},
        },
        'available_cscs': available_cscs,
        'base_rate': base_rate,
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
    return [{"id": c.id, "name": c.name, "is_active": c.is_active, "parent_key": c.parent_key} for c in cats]


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
            t.category_auto       = category  # categorize() already clears this for Transfer
            t.category_confidence = confidence
            t.description_clean   = display_desc or cat_engine.clean_description(t.description_raw)
            t.needs_review        = compute_needs_review(action, category, confidence)
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

    # Pre-load user-taught merchant → CSC mappings — CSV/OFX imports previously
    # never consulted these at all (only Plaid sync did), so a taught mapping
    # silently didn't apply to imported history. See _resolve_merchant_csc.
    _mpm_rows = db.query(MerchantPointsMapping).all()
    _mpm_lookup: list[tuple[str, str, int | None, str | None]] = [
        (m.merchant_pattern.lower(), m.points_category.name, m.card_id, m.network)
        for m in _mpm_rows
        if m.points_category
    ]

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

        # Apply GCB / For Others / points tags from rule notes
        desc_upper = desc_raw.upper()
        gcb_auto        = False
        for_others_auto = False
        points_cat = None
        for rule in rules_with_notes:
            if rule.pattern and rule.pattern.upper() in desc_upper:
                if 'gcb:true' in (rule.notes or ''):
                    gcb_auto = True
                if 'for_others:true' in (rule.notes or ''):
                    for_others_auto = True
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
                logger.debug('Suppressed exception', exc_info=True)

        # Check user-taught merchant → CSC mappings next (before the generic
        # inference fallback), same precedence as the Plaid sync path.
        if not points_cat and merchant_name and _mpm_lookup:
            points_cat = _resolve_merchant_csc(
                _mpm_lookup, merchant_name,
                account.card.id if account.card else None,
                account.card.network if account.card else None,
            )

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

        needs_review_flag = compute_needs_review(action, category, confidence, final_source)

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
            category_auto        = category,  # categorize() already clears this for Transfer
            category_manual      = None,
            category_confidence  = confidence,
            needs_review         = needs_review_flag,
            enrichment_source    = final_source,
            is_gcb               = gcb_auto,
            gcb_tagged           = gcb_auto,
            is_for_others        = for_others_auto,
            points_category      = points_cat,
            card_id              = linked_card_id,
            is_locked            = False,
        )
        db.add(txn)
        _lock_points_for_transaction(db, txn)
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
        t.category_auto       = category  # categorize() already clears this for Transfer
        t.category_confidence = confidence
        t.description_clean   = display_desc or cat_engine.clean_description(t.description_raw)
        t.needs_review        = compute_needs_review(action, category, confidence)
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
            t.category_auto       = category  # categorize() already clears this for Transfer
            t.category_confidence = confidence
            t.needs_review        = compute_needs_review(action, category, confidence)
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




@app.post("/api/rules/reapply")
async def reapply_rules(
    pattern: Optional[str] = None,
    dry_run: bool = False,
    db: Session = Depends(get_db),
):
    """
    Re-apply all active rules to every non-locked, non-manually-edited transaction.
    Pass `pattern` to scope to matching transactions only, and/or `dry_run=true`
    to see what would change without writing anything.
    """
    return _reapply_rules(db, pattern=pattern, dry_run=dry_run)


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
    pattern = data.get('pattern', '')
    set_category = data.get('set_category')
    set_action = data.get('set_action')

    # Non-blocking: warn if this pattern overlaps an existing active rule
    # that disagrees on category/action, so contradictory rules (e.g. the
    # multiple conflicting Venmo rules found in BACKLOG.md B7/B8) don't
    # accumulate silently.
    conflicts = find_overlapping_rules(db, pattern, set_category, set_action)

    rule = CategorizationRule(
        priority=data.get('priority', 100),
        priority_order=data.get('priority_order', 0),
        match_type=data.get('match_type', 'contains'),
        pattern=pattern,
        set_action=set_action,
        set_category=set_category,
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
    # Scoped to this rule's own pattern — no reason to rescan the whole table
    # for a change that can only affect matching rows. contains_any/contains_all
    # patterns are semicolon-joined sub-patterns, not a literal substring, so
    # those fall back to an unscoped (correct, just slower) reapply.
    scope_pattern = rule.pattern if rule.match_type in ('contains', 'equals', 'starts_with', 'regex') else None
    reapplied = _reapply_rules(db, force_unlock=True, pattern=scope_pattern)
    response = {'id': rule.id, 'message': 'Rule created', 'reapplied': reapplied}
    if conflicts:
        response['warning'] = (
            f"Pattern overlaps {len(conflicts)} existing rule(s) with a different category/action: "
            + ", ".join(f"#{c['rule_id']} '{c['pattern']}' -> {c['set_category'] or c['set_action']}" for c in conflicts)
        )
        response['conflicts'] = conflicts
    return response


@app.patch("/api/rules/{rule_id}")
async def update_rule(rule_id: int, data: dict, db: Session = Depends(get_db)):
    """Update an existing categorization rule."""
    rule = db.query(CategorizationRule).filter_by(id=rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    old_pattern = rule.pattern
    allowed = ['priority', 'priority_order', 'match_type', 'pattern',
               'set_action', 'set_category', 'set_description', 'clean_description',
               'notes', 'is_active']
    for k, v in data.items():
        if k in allowed:
            setattr(rule, k, v)
    rule.updated_at = datetime.utcnow()
    db.commit()
    # Scope to whichever pattern(s) could plausibly be affected — both the old
    # and new pattern, since a transaction that matched under the old pattern
    # may no longer, and one that didn't may now. Falls back to an unscoped
    # (correct, just slower) reapply for compound match types, same reasoning
    # as create_rule.
    scope_patterns = None
    if rule.match_type in ('contains', 'equals', 'starts_with', 'regex'):
        scope_patterns = list({old_pattern, rule.pattern} - {None, ''})
    reapplied = _reapply_rules(db, pattern=scope_patterns)
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
    balances = get_account_balances_bulk(db, accounts)
    result = []
    for a in accounts:
        d = serialize_account(a, counts.get(a.id, 0))
        d['balance'] = balances.get(a.id, 0.0)
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
            logger.info(f"[rebuild-all-snapshots] account {acct.id} failed: {e}")
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
        logger.info(f"[merge-pair] snapshot rebuild failed for account {keep.id}: {e}")

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
            logger.info(f"[balance-sync] fetch failed for {item.institution_name}: {e}")
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

    linked_card_id = account.card.id if account.card else None

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
            card_id=linked_card_id,
            year=txn_date.year,
            month=txn_date.month,
            day=txn_date.day,
        )
        db.add(txn)
        db.flush()
        _lock_points_for_transaction(db, txn)
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
                    is_for_others=split_item.is_for_others,
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
            is_for_others=s.is_for_others,
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
            "is_for_others": bool(s.is_for_others),
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































# ---------------------------------------------------------------------------
# Cash Flow (Section 2)
# ---------------------------------------------------------------------------





# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Cash Flow Overlays
# ---------------------------------------------------------------------------













# Salary Payments
# ---------------------------------------------------------------------------















# Daily Balances
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# LLM Merchant Enrichment (Section LLM)
# ---------------------------------------------------------------------------





import threading as _threading
import uuid as _uuid

# In-memory job status store (resets on redeploy, which is fine)











# ---------------------------------------------------------------------------
# V2 Sandbox & Liquidity Forecasting
# ---------------------------------------------------------------------------









# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Domain routers (Phase 1 of the backend token-usage refactor — see
# PLAN.md "main.py -> domain routers split"). Imported here, after
# `init_db()` above, not at module top: routers/llm.py does
# `from database import SessionLocal` at its own top level, and that name
# must already be the real sessionmaker (not the `None` placeholder
# database.py defines before init_db() runs) by the time that import
# executes, or the module would bind the stale None permanently.
# ---------------------------------------------------------------------------
from routers.misc import router as misc_router
from routers.loans import router as loans_router
from routers.cash_flow import router as cash_flow_router
from routers.llm import router as llm_router

app.include_router(misc_router)
app.include_router(loans_router)
app.include_router(cash_flow_router)
app.include_router(llm_router)



# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
