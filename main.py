"""
Finance Automation — FastAPI backend
Clean consolidated version — all features included
"""
import io
import os

# ── Load .env from iCloud Drive path ────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from database import (
    init_db, Account, Transaction, Category,
    CategorizationRule, PlaidItem, seed_categories,
    Card, PointsCategory, MerchantPointsMapping,
    seed_points_categories, import_cards_from_excel,
    TransactionSplit, BudgetTarget, Loan, MerchantOverride,
)
from llm_service import enrich_transaction, save_override, _call_groq, VALID_CATEGORIES
from categorization import CategorizationEngine, load_rules_from_excel
from plaid_integration import setup_plaid_from_env

# ---------------------------------------------------------------------------
# Account classification helpers
# ---------------------------------------------------------------------------

# Bucket mapping: account_type → (bucket_name, is_asset, is_liability)
# Keys match Plaid subtypes (checking, savings, credit card) and manual types
ACCOUNT_TYPE_MAP = {
    # Assets
    'checking':       ('Cash & Savings', True, False),
    'savings':        ('Cash & Savings', True, False),
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

# Map Plaid top-level types to our types (fallback when subtype is missing)
PLAID_TYPE_FALLBACK = {
    'depository':  'checking',
    'credit':      'credit card',
    'investment':  'investment',
    'loan':        'loan',
}


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


def serialize_account(a: Account) -> dict:
    """
    Standard serialization for an Account object, including classification flags.
    Used by all endpoints that return account data.
    """
    flags = classify_account(a.account_type)
    return {
        'id': a.id,
        'plaid_account_id': a.plaid_account_id,
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
    }


def get_account_balance(db: Session, account_id: int, as_of_date: datetime = None) -> float:
    """
    Compute account balance at a given date (or now if not specified).
    Formula: starting_balance + SUM(transactions.amount WHERE date <= target_date)
    This is the single reusable helper for all balance calculations.
    """
    account = db.query(Account).filter_by(id=account_id).first()
    if not account:
        return 0.0

    starting = account.starting_balance or 0.0
    start_dt = account.start_date

    # Build query for transactions after start_date up to as_of_date
    query = db.query(Transaction).filter(Transaction.account_id == account_id)
    if start_dt:
        query = query.filter(Transaction.date >= start_dt)
    if as_of_date:
        query = query.filter(Transaction.date <= as_of_date)

    # Sum transaction amounts
    txn_sum = sum(t.amount for t in query.all())
    return round(starting + txn_sum, 2)


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
    description_clean: Optional[str]
    merchant_name: Optional[str]
    amount: float
    action: str
    category_auto: Optional[str]
    category_manual: Optional[str]
    category_final: str
    category_confidence: Optional[float]
    needs_review: bool
    is_locked: bool
    is_gcb: bool = False
    is_split: bool = False
    points_category: Optional[str] = None
    account_name: str
    account_id: int = 0

    class Config:
        from_attributes = True


class TransactionUpdate(BaseModel):
    """Fields that can be patched on a transaction."""
    category: Optional[str] = None
    action: Optional[str] = None
    needs_review: Optional[bool] = None
    is_locked: Optional[bool] = None
    is_gcb: Optional[bool] = None
    points_category: Optional[str] = None


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


class ManualTransactionCreate(BaseModel):
    """Request body for manual value-change transactions (Section 2c)."""
    account_id: int
    date: str  # YYYY-MM-DD
    amount: float  # Caller is responsible for sign (positive or negative)
    description: str
    action: str = "Other"  # Purchase, Sale, Unrealized Gain/Loss, Transfer, Depreciation, Other


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
        plaid_item = db.query(PlaidItem).filter_by(item_id=item_id).first()
        if plaid_item:
            plaid_item.access_token = access_token
            plaid_item.is_active    = True
            plaid_item.updated_at   = datetime.utcnow()
            # Refresh institution name in case it was set incorrectly before
            refreshed = plaid.get_institution_name(access_token)
            if refreshed:
                plaid_item.institution_name = refreshed
        else:
            # Fetch the proper institution name from Plaid; fall back to first word of account name
            institution_name = (
                plaid.get_institution_name(access_token)
                or (accounts[0]['name'].split(' ')[0] if accounts else 'Unknown')
            )
            plaid_item = PlaidItem(item_id=item_id, institution_name=institution_name, is_active=True)
            plaid_item.access_token = access_token
            db.add(plaid_item)

        db.flush()

        # Create Account records — use subtype for better classification
        for a in accounts:
            existing = db.query(Account).filter_by(plaid_account_id=a['account_id']).first()
            if existing:
                existing.is_active = True
            else:
                # Prefer subtype (checking, savings, credit card) over type (depository, credit)
                raw_subtype = (a.get('subtype') or '').lower().strip()
                raw_type = (a.get('type') or '').lower().strip()
                account_type = raw_subtype or PLAID_TYPE_FALLBACK.get(raw_type, raw_type) or 'other'

                db.add(Account(
                    plaid_account_id=a['account_id'],
                    plaid_item_id=item_id,
                    account_name=f"{a['name']} {a.get('mask','')}".strip(),
                    account_type=account_type,
                    official_name=a.get('official_name'),
                    mask=a.get('mask'),
                    is_active=True,
                ))

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

        msg = f"Linked {len(accounts)} account(s) and synced {synced} transaction(s)"
        if sync_error:
            msg += f" (sync warning: {sync_error})"

        return {
            "message": msg,
            "item_id": item_id,
            "accounts_linked": len(accounts),
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
    result = plaid.sync_transactions(
        access_token=plaid_item.access_token,
        cursor=cursor,
    )

    # Pre-load rules with notes for GCB/points tagging
    rules_with_notes = db.query(CategorizationRule).filter(
        CategorizationRule.is_active == True,
        CategorizationRule.notes != None,
        CategorizationRule.notes != '',
    ).all()

    for txn_data in result['added']:
        existing = db.query(Transaction).filter_by(
            plaid_transaction_id=txn_data['plaid_transaction_id']
        ).first()
        if existing:
            if not existing.is_locked:
                existing.merchant_name = txn_data.get('merchant_name') or existing.merchant_name
            continue

        account = db.query(Account).filter_by(
            plaid_account_id=txn_data['plaid_account_id']
        ).first()
        if not account:
            continue

        # Resolve card_id from account→card FK (set via match-accounts flow)
        linked_card_id = account.card.id if account.card else None

        # Normalize sign: Plaid sends expenses as positive, we store as negative
        amount = -txn_data['amount']

        action, category, confidence, display_desc = categorizer.categorize(
            txn_data['description_raw'],
            amount,
            txn_data.get('merchant_name'),
        )

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

        txn_date = txn_data['date']

        # ── Auto-LLM when no rule produced a useful result ───────────────────
        # Call Groq directly (not enrich_transaction) to avoid DB session issues
        # with an in-flight unsaved transaction.
        # Trigger: non-Transfer AND (missing clean description OR unclassified category)
        llm_source = None
        llm_description_clean = display_desc or categorizer.clean_description(txn_data['description_raw'])
        llm_merchant = txn_data.get('merchant_name')
        llm_category = '' if action == 'Transfer' else category

        needs_llm = action != 'Transfer' and (not display_desc or category == 'Unclassified')
        if needs_llm:
            llm_key = os.getenv("ANTHROPIC_API_KEY", "")
            if llm_key:
                try:
                    result_llm = _call_groq(txn_data['description_raw'], llm_key)
                    if result_llm:
                        llm_merchant = str(result_llm.get("merchant_name") or "").strip() or llm_merchant
                        llm_description_clean = str(result_llm.get("description_clean") or "").strip() or llm_description_clean
                        raw_cat = str(result_llm.get("category") or "").strip()
                        llm_category = raw_cat if raw_cat in VALID_CATEGORIES else 'Unclassified'
                        llm_source = "llm"
                        confidence = 0.75  # LLM enriched but not user-confirmed
                        print(f"LLM enriched '{txn_data['description_raw']}' → '{llm_merchant}' / {llm_category}")
                    else:
                        print(f"LLM returned no result for '{txn_data['description_raw']}'")
                except Exception as _llm_err:
                    print(f"LLM ingest error for '{txn_data['description_raw']}': {_llm_err}")

        # Determine final enrichment source
        if llm_source:
            final_source = llm_source
        elif display_desc or (category and category != 'Unclassified'):
            final_source = 'rule'
        else:
            final_source = 'fallback'

        # needs_review: Transfers never need review; LLM results always do;
        # rule results only if confidence < 0.85
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
            year=txn_date.year,
            month=txn_date.month,
            day=txn_date.day,
        ))
        total_added += 1

    # Store cursor — use None instead of empty string for clean state
    plaid_item.cursor         = result['next_cursor'] or None
    plaid_item.last_synced_at = datetime.utcnow()
    db.commit()
    return total_added


# ---------------------------------------------------------------------------
# Plaid: sync all + list items
# ---------------------------------------------------------------------------

@app.post("/api/plaid/sync-transactions")
async def sync_all_transactions(db: Session = Depends(get_db)):
    try:
        plaid = setup_plaid_from_env()
        items = db.query(PlaidItem).filter_by(is_active=True).all()
        if not items:
            return {"message": "No connected accounts.", "transactions_added": 0, "items_synced": 0, "items_failed": 0, "details": []}
        total_added = 0
        details = []
        for item in items:
            try:
                added = await _sync_item(item, plaid, db)
                total_added += added
                details.append({"institution": item.institution_name, "added": added, "status": "ok"})
            except Exception as item_err:
                import traceback; traceback.print_exc()
                db.rollback()
                details.append({"institution": item.institution_name, "added": 0, "status": "error", "error": str(item_err)})
        items_failed = sum(1 for d in details if d["status"] == "error")
        return {
            "message": f"Sync complete — {total_added} new transaction(s) added",
            "items_synced": len(items) - items_failed,
            "items_failed": items_failed,
            "transactions_added": total_added,
            "details": details,
        }
    except Exception as e:
        import traceback; traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/plaid/items")
async def list_items(db: Session = Depends(get_db)):
    items = db.query(PlaidItem).filter_by(is_active=True).all()
    env = os.getenv('PLAID_ENV', 'sandbox')
    result = []
    for item in items:
        accounts = db.query(Account).filter_by(plaid_item_id=item.item_id, is_active=True).all()
        txn_count = db.query(Transaction).filter(
            Transaction.account_id.in_([a.id for a in accounts])
        ).count() if accounts else 0
        result.append({
            "item_id":          item.item_id,
            "institution_name": item.institution_name,
            "last_synced_at":   item.last_synced_at,
            "created_at":       item.created_at,
            "account_count":    len(accounts),
            "accounts":         [{"name": a.account_name, "type": a.account_type, "mask": a.mask} for a in accounts],
            "transaction_count": txn_count,
            "has_cursor":       bool(item.cursor),
            "environment":      env,
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
async def force_resync_item(item_id: str, db: Session = Depends(get_db)):
    """Clear the stored cursor for an item so the next sync re-fetches all historical transactions."""
    item = db.query(PlaidItem).filter_by(item_id=item_id, is_active=True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        plaid = setup_plaid_from_env()
        item.cursor = None
        db.commit()
        added = await _sync_item(item, plaid, db)
        return {"message": f"Resync complete — {added} transaction(s) added", "transactions_added": added}
    except Exception as e:
        import traceback; traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Transactions: list
# ---------------------------------------------------------------------------

def _serialize_txn(t, splits_map=None):
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

    return {
        "id": t.id, "date": t.date,
        "description_raw": t.description_raw,
        "description_clean": t.description_clean,
        "description_display": t.description_clean or t.description_raw,
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
        "is_split": is_split,
        "splits": [
            {"id": s.id, "amount": s.amount, "description": s.description,
             "category": s.category, "action": s.action, "is_gcb": bool(s.is_gcb)}
            for s in splits
        ] if is_split else [],
        "points_category": t.points_category,
        "enrichment_source": t.enrichment_source,
        "import_source": t.import_source or ('plaid' if t.plaid_transaction_id else None),
        "import_hash": t.import_hash,
        "account_name": t.account.account_name,
        "account_id": t.account_id,
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
        query = query.filter(
            (Transaction.category_manual == category) |
            (Transaction.category_auto   == category)
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

    return [_serialize_txn(t, splits_map) for t in txns]


# ---------------------------------------------------------------------------
# Transactions: single
# ---------------------------------------------------------------------------

@app.get("/api/transactions/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(transaction_id: int, db: Session = Depends(get_db)):
    t = db.query(Transaction).filter_by(id=transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    splits = db.query(TransactionSplit).filter_by(parent_transaction_id=t.id).all() if t.is_split else []
    return _serialize_txn(t, {t.id: splits} if splits else {})


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

    db.commit()
    return {"message": "Transaction updated"}


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
    query = db.query(Transaction)
    if year:
        query = query.filter(Transaction.year == year)
    if month:
        query = query.filter(Transaction.month == month)
    if start_date:
        query = query.filter(Transaction.date >= datetime.strptime(start_date, "%Y-%m-%d"))
    if end_date:
        query = query.filter(Transaction.date <= datetime.strptime(end_date, "%Y-%m-%d"))

    transactions   = query.all()
    total_income   = sum(t.amount for t in transactions if t.action == 'Income')
    total_expenses = sum(abs(t.amount) for t in transactions if t.action == 'Expense')
    by_category: dict = {}
    for t in transactions:
        if t.action == 'Expense':
            cat = t.category_final
            by_category[cat] = by_category.get(cat, 0) + abs(t.amount)

    return {
        "total_transactions": len(transactions),
        "needs_review":       sum(1 for t in transactions if t.needs_review),
        "total_income":       total_income,
        "total_expenses":     total_expenses,
        "by_category":        by_category,
    }


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
               "credit_limit", "plaid_account_id", "account_id", "is_active", "notes", "annual_fee"]
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
async def get_card_detail(card_id: int, db: Session = Depends(get_db)):
    """
    Get card detail including linked account balance and recent transactions.
    Used by the Cards page detail panel (Section 6).
    """
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    # Find linked account
    account = None
    balance = None
    recent_txns = []
    if card.plaid_account_id:
        account = db.query(Account).filter_by(plaid_account_id=card.plaid_account_id).first()
        if account:
            balance = get_account_balance(db, account.id)
            txns = db.query(Transaction).filter_by(account_id=account.id)\
                .order_by(Transaction.date.desc()).limit(20).all()
            recent_txns = [{
                'id': t.id, 'date': t.date.strftime('%Y-%m-%d'),
                'description': t.description_clean or t.description_raw, 'description_raw': t.description_raw, 'amount': t.amount,
                'category': t.category_final, 'action': t.action,
            } for t in txns]

    # Statement estimate: sum of transactions since last statement close
    statement_balance = None
    if card.statement_close_day and account:
        today = datetime.utcnow()
        # Find last statement close date
        close_day = min(card.statement_close_day, 28)
        if today.day > close_day:
            stmt_start = datetime(today.year, today.month, close_day)
        else:
            m = today.month - 1 if today.month > 1 else 12
            y = today.year if today.month > 1 else today.year - 1
            stmt_start = datetime(y, m, close_day)
        stmt_txns = db.query(Transaction).filter(
            Transaction.account_id == account.id,
            Transaction.date >= stmt_start,
        ).all()
        statement_balance = round(sum(t.amount for t in stmt_txns), 2)

    return {
        'card': {
            'id': card.id, 'card_id': card.card_id, 'card_name': card.card_name,
            'issuer': card.issuer, 'network': card.network,
            'credit_limit': card.credit_limit,
            'statement_close_day': card.statement_close_day,
            'payment_due_day': card.payment_due_day,
            'annual_fee': card.annual_fee, 'is_active': card.is_active,
        },
        'linked_account': {
            'id': account.id, 'name': account.account_name,
            'balance': balance,
        } if account else None,
        'statement_balance': statement_balance,
        'utilization': round(abs(balance) / card.credit_limit * 100, 1) if balance and card.credit_limit else None,
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
                t.description_raw, t.amount, t.merchant_name
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
            desc_raw, amount, None
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
        action, category, confidence, display_desc = cat_engine.categorize(t.description_raw, t.amount, t.merchant_name)
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
            action, category, confidence, display_desc = cat_engine.categorize(t.description_raw, t.amount, t.merchant_name)
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
    return {'id': rule.id, 'message': 'Rule created'}


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
    return {'message': 'Rule updated'}


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
    accounts = db.query(Account).filter_by(is_active=True).order_by(Account.created_at).all()
    return [serialize_account(a) for a in accounts]


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
    for k, v in updates.items():
        if k in allowed:
            if k == 'start_date' and v:
                setattr(account, k, datetime.strptime(v, "%Y-%m-%d"))
            else:
                setattr(account, k, v)
    db.commit()
    return {"message": "Account updated"}


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

    txn_date = datetime.strptime(data.date, "%Y-%m-%d")

    txn = Transaction(
        plaid_transaction_id=None,
        account_id=account.id,
        date=txn_date,
        amount=data.amount,  # Caller controls the sign
        description_raw=data.description,
        description_clean=data.description,
        action=data.action,
        category_auto=data.action,  # Set category_auto = action for manual txns
        category_confidence=1.0,
        needs_review=False,
        is_locked=True,
        year=txn_date.year,
        month=txn_date.month,
        day=txn_date.day,
    )
    db.add(txn)
    db.commit()
    return {"id": txn.id, "message": "Manual transaction created"}



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
    txns = db.query(Transaction).filter(
        Transaction.year == year,
        Transaction.action.in_(BUDGET_TYPES),
    ).all()

    # Build actuals: {category: {month: total_abs_amount}}
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
                cat = s.category or t.category_final or 'Unclassified'
                month = str(t.month)
                if cat not in actuals:
                    actuals[cat] = {}
                actuals[cat][month] = round(actuals[cat].get(month, 0) + abs(s.amount), 2)
        else:
            # Skip GCB-tagged whole transactions
            if t.is_gcb or t.gcb_tagged:
                continue
            cat = t.category_final or 'Unclassified'
            month = str(t.month)
            if cat not in actuals:
                actuals[cat] = {}
            actuals[cat][month] = round(actuals[cat].get(month, 0) + abs(t.amount), 2)

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

    # Fetch actuals for each of those months
    totals: dict[str, list] = {}
    for ty, tm in trailing:
        txns = db.query(Transaction).filter(
            Transaction.year == ty,
            Transaction.month == tm,
            Transaction.action.in_(BUDGET_TYPES),
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
                    cat = s.category or t.category_final or 'Unclassified'
                    month_totals[cat] = round(month_totals.get(cat, 0) + abs(s.amount), 2)
            else:
                if t.is_gcb or t.gcb_tagged:
                    continue
                cat = t.category_final or 'Unclassified'
                month_totals[cat] = round(month_totals.get(cat, 0) + abs(t.amount), 2)
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

    # Get all transactions for this account in range
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
        points.append({
            'date': dt.strftime('%Y-%m-%d'),
            'assets': round(assets, 2),
            'liabilities': round(liabs, 2),
            'net_worth': round(assets + liabs, 2),  # Assets + Liabilities (liabilities already negative)
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
    interest_rate: Optional[float] = None
    term_months: Optional[int] = None
    monthly_payment: Optional[float] = None
    start_date: Optional[str] = None  # YYYY-MM-DD
    maturity_date: Optional[str] = None  # YYYY-MM-DD
    account_id: Optional[int] = None
    notes: Optional[str] = None


def serialize_loan(loan: Loan) -> dict:
    """Standard serialization for a Loan object."""
    return {
        'id': loan.id,
        'account_id': loan.account_id,
        'lender': loan.lender,
        'loan_type': loan.loan_type,
        'original_principal': loan.original_principal,
        'current_balance': loan.current_balance,
        'interest_rate': loan.interest_rate,
        'term_months': loan.term_months,
        'monthly_payment': loan.monthly_payment,
        'start_date': loan.start_date.strftime('%Y-%m-%d') if loan.start_date else None,
        'maturity_date': loan.maturity_date.strftime('%Y-%m-%d') if loan.maturity_date else None,
        'is_active': loan.is_active,
        'notes': loan.notes,
        'created_at': loan.created_at.isoformat() if loan.created_at else None,
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
        interest_rate=data.interest_rate,
        term_months=data.term_months,
        monthly_payment=data.monthly_payment,
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
    allowed = ['lender', 'loan_type', 'original_principal', 'current_balance',
               'interest_rate', 'term_months', 'monthly_payment',
               'start_date', 'maturity_date', 'account_id', 'notes', 'is_active']
    for k, v in updates.items():
        if k in allowed:
            if k in ('start_date', 'maturity_date') and v:
                setattr(loan, k, datetime.strptime(v, "%Y-%m-%d"))
            else:
                setattr(loan, k, v)
    loan.updated_at = datetime.utcnow()
    db.commit()
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

    # Get transactions for depository accounts in date range
    txns = db.query(Transaction).filter(
        Transaction.account_id.in_(dep_ids),
        Transaction.date >= start_dt,
        Transaction.date <= end_dt,
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
