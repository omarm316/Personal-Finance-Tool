"""
core/rules_helpers.py — re-applies the categorization engine to existing
transactions. Shared by the not-yet-split /api/rules/* routes (create_rule,
update_rule, reapply_rules — still in main.py) and routers/llm.py's
create_rule_from_transaction (Phase 1) — put here rather than in either
domain specifically so neither has to import it from the other.

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
from typing import List, Optional, Union

from sqlalchemy.orm import Session

from database import Transaction
from categorization import CategorizationEngine


def _reapply_rules(db: Session, force_unlock: bool = False,
                    pattern: Optional[Union[str, List[str]]] = None,
                    dry_run: bool = False) -> dict:
    """
    Re-run the categorization engine on transactions.

    Normal mode (force_unlock=False):
      - Only processes non-locked, non-manually-edited transactions.

    Force mode (force_unlock=True):
      - Also processes locked/manual transactions IF a rule now matches them.
        Clears category_manual and is_locked so the rule takes over,
        exactly as if the rule had been in place from the start.

    pattern: when given (a string, or a list of strings), scopes BOTH
        branches to transactions whose description_raw OR description_clean
        contains at least one of the given substrings (case-insensitive),
        instead of a full-table scan. Used when a single rule was just
        created/edited — there's no reason to re-examine every transaction
        in the database for a change that can only possibly affect rows
        matching the new/changed pattern (pass both old and new pattern as a
        list on update, so rows affected by either are reconsidered).
        Checking both raw and clean descriptions (not raw alone) matters
        because clean_description() can make text contiguous in the cleaned
        form that wasn't contiguous in the original raw text.

    dry_run: when True, computes and reports what would change without
        writing anything (no attribute mutation, no db.commit()). Use this to
        validate scoping/behavior before trusting it, or as a general safety
        net given there's no separate test database.

    Returns {'updated': N, 'total': M, 'unlocked': K}.
    """
    categorizer = CategorizationEngine(db)
    patterns = [pattern] if isinstance(pattern, str) else (pattern or [])
    patterns = [p for p in patterns if p]

    def _scope(query):
        if not patterns:
            return query
        clauses = [
            (Transaction.description_raw.ilike(f"%{p}%")) | (Transaction.description_clean.ilike(f"%{p}%"))
            for p in patterns
        ]
        combined = clauses[0]
        for c in clauses[1:]:
            combined = combined | c
        return query.filter(combined)

    # Always process unlocked, non-manual transactions
    txns = _scope(db.query(Transaction).filter(
        Transaction.is_locked == False,
        Transaction.category_manual == None,
    )).all()

    # In force mode also check system-locked transactions (transfer corrections) for new
    # rule matches.  Transactions where the user explicitly set category_manual are always
    # respected — a new rule never clobbers a conscious user edit.
    locked_txns = []
    if force_unlock:
        locked_txns = _scope(db.query(Transaction).filter(
            Transaction.is_locked == True,
            Transaction.category_manual == None,   # system-locked only, not user-manual edits
        )).all()

    updated = 0
    unlocked = 0

    for t in txns:
        action, category, confidence, display_desc = categorizer.categorize(
            t.description_raw, t.amount, t.merchant_name,
            account_type=(t.account.account_type if t.account else ''),
        )
        desc_clean = display_desc or categorizer.clean_description(t.description_raw)
        llm_category = category  # categorize() already clears this for Transfer
        source = 'rule' if confidence >= 0.85 else 'fallback'
        if (t.description_clean != desc_clean or
                t.category_auto != llm_category or
                t.action != action or
                t.enrichment_source != source):
            updated += 1
            if not dry_run:
                t.description_clean = desc_clean
                t.category_auto     = llm_category
                t.action            = action
                t.category_confidence = confidence
                t.enrichment_source   = source

    for t in locked_txns:
        matched_rule = categorizer.match_rule(t.description_raw, t.amount)
        if not matched_rule:
            continue  # Rule doesn't match — keep manual override intact
        action, category, confidence, display_desc = categorizer.categorize(
            t.description_raw, t.amount, t.merchant_name,
            account_type=(t.account.account_type if t.account else ''),
        )
        desc_clean = display_desc or categorizer.clean_description(t.description_raw)
        llm_category = category  # categorize() already clears this for Transfer
        unlocked += 1
        updated += 1
        if not dry_run:
            # Clear the manual override so the rule governs this transaction going forward
            t.category_manual   = None
            t.is_locked         = False
            t.description_clean = desc_clean
            t.category_auto     = llm_category
            t.action            = action
            t.category_confidence = confidence
            t.enrichment_source   = 'rule'

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return {'updated': updated, 'total': len(txns) + len(locked_txns), 'unlocked': unlocked}
