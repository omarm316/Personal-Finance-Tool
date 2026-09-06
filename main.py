"""
Finance Automation — FastAPI backend
Clean consolidated version — all features included
"""
import os

# ── Load .env from iCloud Drive path ────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import FastAPI, Depends, HTTPException, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime

from database import (
    init_db, get_db, Account, Transaction, Category,
    CategorizationRule, PlaidItem, seed_categories,
    Card, PointsCategory, MerchantPointsMapping,
    PointsEcosystem, CardProduct, CardProductReward, CardProductHistory,
    CardBenefit, BenefitUsage, SpendChallenge, ChallengeCardLink,
    Redemption, TransferRatio, Transfer, PointsBalanceSnapshot, PointsAdjustment, PersonPointsTransfer,
    CHALLENGE_TEMPLATES,
    seed_points_categories, seed_points_ecosystems, seed_card_products,
    AccountMonthlySnapshot, BalanceObservation,
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

# Institution name substring → issuer short code, for auto-created Card rows.
# Same institutions the /api/accounts/product-suggestions matcher already
# recognizes, kept as a separate map since that one keys off product_key.







# Plaid personal_finance_category.primary → (app_category, action)
# Used as a deterministic fallback when rules don't produce a match.
# Only applied when Plaid confidence_level is HIGH or VERY_HIGH.


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

# ---------------------------------------------------------------------------
# Plaid: link token
# ---------------------------------------------------------------------------







# ---------------------------------------------------------------------------
# Plaid: exchange token
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Sync helper
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Plaid: background sync helper + sync endpoints
# ---------------------------------------------------------------------------















































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








# ---------------------------------------------------------------------------
# Transactions: single
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Transactions: update
# ---------------------------------------------------------------------------





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








# ---------------------------------------------------------------------------
# Init / maintenance
# ---------------------------------------------------------------------------





# ---------------------------------------------------------------------------
# CSV / OFX Transaction Import  (Option B + preview)
# ---------------------------------------------------------------------------















# ---------------------------------------------------------------------------
# Categorization Rules CRUD (Section 2D)
# ---------------------------------------------------------------------------















# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Accounts: list all + manual creation
# ---------------------------------------------------------------------------







# ---------------------------------------------------------------------------
# Per-account controls  (Change 4)
# Route order matters: static paths must come BEFORE /{id} patterns
# ---------------------------------------------------------------------------



























# ---------------------------------------------------------------------------
# Balance Sync + Monthly Snapshots
# ---------------------------------------------------------------------------











# ---------------------------------------------------------------------------
# Manual Transactions
# ---------------------------------------------------------------------------




# ---------------------------------------------------------------------------
# Transaction Splits (Section 3a)
# ---------------------------------------------------------------------------









# ---------------------------------------------------------------------------
# Budget Targets (Section 4)
# ---------------------------------------------------------------------------











# ---------------------------------------------------------------------------
# Balance Timeline (Section 5 prerequisite)
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Balance Reconciliation (Section 5 supplement)
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Net Worth (Section 5) — entirely account-driven
# ---------------------------------------------------------------------------





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
# `init_db()` above, not at module top: routers/llm.py and core/plaid_sync.py
# (imported transitively by routers/accounts.py, routers/admin.py, and
# routers/plaid_routes.py) all do `from database import SessionLocal` at
# their own top level, and that name must already be the real sessionmaker
# (not the `None` placeholder database.py defines before init_db() runs) by
# the time that import executes, or the module would bind the stale None
# permanently.
# ---------------------------------------------------------------------------
from routers.misc import router as misc_router
from routers.loans import router as loans_router
from routers.cash_flow import router as cash_flow_router
from routers.llm import router as llm_router
from routers.plaid_routes import router as plaid_router
from routers.budgets import router as budgets_router
from routers.net_worth import router as net_worth_router
from routers.transactions import router as transactions_router
from routers.rules import router as rules_router
from routers.admin import router as admin_router
from routers.accounts import router as accounts_router

app.include_router(misc_router)
app.include_router(loans_router)
app.include_router(cash_flow_router)
app.include_router(llm_router)
app.include_router(plaid_router)
app.include_router(budgets_router)
app.include_router(net_worth_router)
app.include_router(transactions_router)
app.include_router(rules_router)
app.include_router(admin_router)
app.include_router(accounts_router)



# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
