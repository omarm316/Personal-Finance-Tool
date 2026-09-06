"""
routers/rules.py — categorization rules CRUD, merchant-category (CSC) mapping
management, and Excel-based bulk import (rules, cards, points ecosystems).

Extracted from main.py (Phase 1 batch 2 of the backend token-usage refactor —
see PLAN.md "main.py -> domain routers split"). upload_and_import_cards and
upload_and_import_points live here rather than under a cards.py/points.py of
their own — they're Excel-catalog-import routes, the same job as
import_cards_endpoint/import_rules just below them, not card/points business
logic — grouped by what they do, not by their URL prefix.
"""
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from database import (
    get_db, Account, Card, CategorizationRule, MerchantPointsMapping,
    PointsCategory, Transaction, import_cards_from_excel, import_points_from_excel,
)
from categorization import CategorizationEngine, compute_needs_review, find_overlapping_rules, load_rules_from_excel

from core.app_helpers import PROJECT_ROOT
from core.rules_helpers import _reapply_rules

router = APIRouter()


@router.post("/api/merchant-csc")
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

@router.get("/api/merchant-csc")
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

@router.delete("/api/merchant-csc/{mapping_id}")
async def delete_merchant_csc(mapping_id: int, db: Session = Depends(get_db)):
    """Remove a taught merchant → CSC mapping. Does not touch transactions
    already backfilled by it — only stops it from applying going forward."""
    row = db.query(MerchantPointsMapping).filter_by(id=mapping_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(row)
    db.commit()
    return {"message": "Mapping deleted"}

@router.post("/api/init/import-cards")
async def import_cards_endpoint(db: Session = Depends(get_db)):
    """Import cards from the local cards.xlsx file."""
    here = PROJECT_ROOT
    path = os.path.join(here, "cards.xlsx")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="cards.xlsx not found")
    n = import_cards_from_excel(path, db)
    return {"imported": n, "total": db.query(Card).count()}

@router.post("/api/cards/upload-and-import")
async def upload_and_import_cards(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a cards.xlsx file, save it, and import cards from it (Section 7B)."""
    import tempfile
    import shutil

    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be .xlsx or .xls")

    # Save to the working directory as cards.xlsx
    here = PROJECT_ROOT
    dest = os.path.join(here, "cards.xlsx")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    n = import_cards_from_excel(dest, db)
    return {"imported": n, "total": db.query(Card).count(), "message": f"Uploaded and imported {n} cards"}

@router.post("/api/points/upload-and-import")
async def upload_and_import_points(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a points Excel file and import ecosystems + earning rates."""
    import shutil

    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be .xlsx or .xls")

    here = PROJECT_ROOT
    dest = os.path.join(here, "points.xlsx")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    result = import_points_from_excel(dest, db)
    return {**result, "message": f"Imported {result['ecosystems_imported']} ecosystems, {result['cards_with_rates']} card earning rates"}

@router.post("/api/init/import-rules")
async def import_rules(db: Session = Depends(get_db)):
    here = PROJECT_ROOT
    excel_path = os.path.join(here, "i_e_v9_2_2026.xlsx")
    if not os.path.exists(excel_path):
        raise HTTPException(status_code=404, detail=f"Excel file not found at {excel_path}")
    try:
        load_rules_from_excel(excel_path, db)
        return {"message": "Rules imported successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/init/upload-rules")
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

@router.post("/api/init/recategorize")
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

@router.post("/api/init/fix-signs")
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

@router.get("/api/rules")
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

@router.post("/api/rules/reapply")
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

@router.post("/api/rules/clean-descriptions")
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

@router.post("/api/rules")
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

@router.patch("/api/rules/{rule_id}")
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

@router.delete("/api/rules/{rule_id}")
async def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    """Deactivate a categorization rule (soft delete)."""
    rule = db.query(CategorizationRule).filter_by(id=rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rule.is_active = False
    rule.updated_at = datetime.utcnow()
    db.commit()
    return {'message': 'Rule deactivated'}
