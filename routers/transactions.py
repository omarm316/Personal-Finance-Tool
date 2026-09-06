"""
routers/transactions.py — the core transaction CRUD/list/filter API, splits,
manual transactions, CSV/OFX import, and one-time backfill utilities.

Extracted from main.py (Phase 1 batch 2 of the backend token-usage refactor —
see PLAN.md "main.py -> domain routers split").

NOTE on route order: get_transaction_spenders (GET /api/transactions/spenders)
must stay registered before get_transaction (GET /api/transactions/{transaction_id})
— see that function's own docstring. FastAPI/Starlette matches routes in
registration order, so a literal path segment has to come before a dynamic
int-typed one at the same position or it 422s instead of falling through.
"""
import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import (
    get_db, Account, CategorizationRule, MerchantPointsMapping, Transaction,
    TransactionSplit, UserCorrection,
)
from llm_service import _call_groq, VALID_CATEGORIES
from categorization import CategorizationEngine, compute_needs_review

from core.accounts_helpers import _assign_content_hash
from core.import_helpers import _build_preview, _parse_csv_rows, _parse_ofx_rows
from core.points_engine import (
    _build_network_lookup, _build_points_lookup, _lock_points_for_transaction,
    _resolve_merchant_csc, infer_points_category,
)
from core.serializers import _serialize_txn
from core.constants import BUDGET_TYPES

import logging
logger = logging.getLogger('moresheth')

router = APIRouter()


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

@router.post("/api/transactions/backfill-points-categories")
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

@router.get("/api/transactions/unclassified-merchants")
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

@router.post("/api/transactions/backfill-content-hashes")
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

@router.get("/api/transactions", response_model=List[TransactionResponse])
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

@router.get("/api/transactions/spenders")
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

@router.get("/api/transactions/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(transaction_id: int, db: Session = Depends(get_db)):
    t = db.query(Transaction).filter_by(id=transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    splits = db.query(TransactionSplit).filter_by(parent_transaction_id=t.id).all() if t.is_split else []
    categorizer = CategorizationEngine(db)
    points_lookup, cat_parent_map = _build_points_lookup(db, [t.account_id])
    network_lookup = _build_network_lookup(db, [t.account_id])
    return _serialize_txn(t, {t.id: splits} if splits else {}, categorizer, points_lookup, cat_parent_map, network_lookup)

@router.patch("/api/transactions/{transaction_id}")
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

@router.post("/api/transactions/batch-update")
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

@router.post("/api/transactions/import")
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

@router.post("/api/transactions/manual")
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

@router.post("/api/transactions/{transaction_id}/splits")
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

@router.get("/api/transactions/{transaction_id}/splits")
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

@router.delete("/api/transactions/{transaction_id}/splits")
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

@router.delete("/api/transactions/{transaction_id}")
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
