"""
routers/llm.py — LLM-based transaction enrichment (Claude/Groq merchant-name
and category inference) plus the "create a rule from this enriched
transaction" action that lets a one-off LLM call become a free, instant
rule for future transactions from the same merchant.

`_run_enrich_job` runs in a background thread with its own DB session — it
grabs `SessionLocal` directly rather than via the request-scoped `get_db`
dependency, since there's no request to scope it to.

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
import logging
import os
import threading as _threading
import uuid as _uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, SessionLocal, CategorizationRule, Transaction
from core.rules_helpers import _reapply_rules
from llm_service import enrich_transaction
from categorization import find_overlapping_rules

logger = logging.getLogger('moresheth')

router = APIRouter()


class LLMEnrichRequest(BaseModel):
    limit: int = 50                  # Max transactions to process in one call
    overwrite_existing: bool = False # Re-process even if already enriched

@router.get("/api/llm/test-groq")
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
                    description_raw=txn.description_raw,
                    api_key=api_key,
                )
                txn.merchant_name     = enriched["merchant_name"]
                txn.description_clean = enriched["description_clean"]
                if not txn.category_manual:
                    txn.category_auto = enriched["category"]
                txn.enrichment_source = enriched["source"]
                if enriched.get("is_for_others"):
                    txn.is_for_others = True
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

@router.post("/api/llm/enrich-transactions")
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

@router.get("/api/llm/enrich-status/{job_id}")
async def llm_enrich_status(job_id: str):
    """Poll enrichment job status."""
    job = _enrich_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, **job}

@router.post("/api/llm/create-rule-from-transaction/{transaction_id}")
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

    # Non-blocking: warn if this pattern overlaps an existing active rule
    # that disagrees on category/action.
    conflicts = find_overlapping_rules(db, pattern, category, action)

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
    # This is the review UI's actual rule-creation path (the "Save as auto-
    # categorization rule" checkbox and the inline-edit "Create rule?" prompt
    # both call this endpoint) — without a reapply here, closing a review by
    # creating a rule only benefited *future* transactions; other backlog
    # transactions matching the same merchant sat unresolved until someone
    # separately ran a full reapply. Scoped to this rule's own pattern, same
    # reasoning as create_rule.
    reapplied = _reapply_rules(db, force_unlock=True, pattern=pattern)
    response = {"status": "created", "rule_id": rule.id, "pattern": pattern, "category": category,
                "action": action, "reapplied": reapplied}
    if conflicts:
        response['warning'] = (
            f"Pattern overlaps {len(conflicts)} existing rule(s) with a different category/action: "
            + ", ".join(f"#{c['rule_id']} '{c['pattern']}' -> {c['set_category'] or c['set_action']}" for c in conflicts)
        )
        response['conflicts'] = conflicts
    return response

@router.post("/api/llm/enrich-single/{transaction_id}")
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
        description_raw=txn.description_raw,
        api_key=api_key,
    )

    txn.merchant_name = enriched["merchant_name"]
    txn.description_clean = enriched["description_clean"]
    if not txn.category_manual:
        txn.category_auto = enriched["category"]
    if enriched.get("is_for_others"):
        txn.is_for_others = True

    db.commit()
    return {
        "id": txn.id,
        "merchant_name": enriched["merchant_name"],
        "description_clean": enriched["description_clean"],
        "category": enriched["category"],
        "source": enriched["source"],
    }
