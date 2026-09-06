"""
core/serializers.py — SQLAlchemy-model-to-dict serializers shared across
every router. Kept in one module (rather than split per-router) because
several routers need the same serializer (e.g. transactions.py and
cards.py both need _serialize_txn).

Extracted from main.py (Phase 0 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
from datetime import datetime

from database import (
    Account, Card, Redemption, PointsBalanceSnapshot, PointsAdjustment,
    TransferRatio, Transfer, PersonPointsTransfer, CardBenefit, BenefitUsage,
    Loan, CashFlowOverlay, SalaryPayment,
)
from core.accounts_helpers import classify_account
from core.challenges_helpers import _challenge_progress, _current_cycle

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
def _serialize_txn(t, splits_map=None, categorizer=None, points_lookup=None, cat_parent_map=None, network_lookup=None):
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

    # Points earn — LOCKED at write time (see _lock_points_for_transaction()),
    # never recomputed here. currency/eco_name/cpp are still read from
    # points_lookup (the account's CURRENT product) purely for display
    # metadata — they don't affect the frozen points_earned value itself.
    points_earn = None
    if t.points_earned is not None:
        parent = cat_parent_map.get(t.points_category) if (cat_parent_map and t.points_category) else None
        currency = eco_name = your_cpp = None
        if points_lookup is not None and t.account_id in points_lookup:
            _, _, currency, eco_name, your_cpp, _ = points_lookup[t.account_id]
        points_earn = {
            'points_category':    t.points_category,       # e.g. "Drugstore" or "United"
            'points_category_l1': parent,                  # e.g. None or "Airlines"
            'earn_rate':          t.points_earn_rate,        # total multiplier, e.g. 3.0 (None when N/A)
            'points_estimated':   round(t.points_earned, 1),  # signed — negative for clawbacks
            'classification':     t.points_earn_classification,
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
        "is_for_others": bool(t.is_for_others or False),
        "is_excluded": bool(t.is_excluded or False),
        "is_split": is_split,
        "splits": [
            {"id": s.id, "amount": s.amount, "description": s.description,
             "category": s.category, "action": s.action, "is_gcb": bool(s.is_gcb),
             "is_for_others": bool(s.is_for_others)}
            for s in splits
        ] if is_split else [],
        "points_category": t.points_category,
        "network": (network_lookup or {}).get(t.account_id),
        "spender":         t.spender,
        "points_earn":     points_earn,
        "enrichment_source": t.enrichment_source,
        "import_source": t.import_source or ('plaid' if t.plaid_transaction_id else None),
        "import_hash": t.import_hash,
        "account_name": t.account.account_name,
        "account_id": t.account_id,
        "account_type": t.account.account_type,
        "card_id": t.card_id,
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
        "primary_user": c.primary_user,
        "is_active": c.is_active, "notes": c.notes,
    }
def _serialize_challenge(c, eco=None, spend_override: float = None):
    """Serialize a SpendChallenge to a dict for API responses.

    spend_override: when provided, substitutes c.current_spend for display.
                    Pass the result of _challenge_spend_for_card() when
                    rendering a challenge in a single card's context so the
                    card sees its own spend rather than the aggregate across
                    all linked cards.
    """
    # Guard against NULL values left by failed recalc on old rows
    current_spend = float(spend_override) if spend_override is not None else float(c.current_spend or 0)
    prog = _challenge_progress(c, current_spend)
    bonus_unlocked  = prog['bonus_unlocked']
    bonus_pts       = prog['bonus_pts']
    progress_target = prog['progress_target']
    progress_pct    = prog['progress_pct']
    remaining       = prog['remaining_spend']

    _cd = lambda v: v.date() if isinstance(v, datetime) else v
    today = datetime.utcnow().date()
    if today < _cd(c.start_date):
        status = 'upcoming'
    elif today > _cd(c.end_date):
        status = 'expired'
    elif bonus_unlocked and not c.spend_cap:
        status = 'unlocked'
    else:
        status = 'active'

    # Multi-card and multi-category info via direct link tables
    additional_card_ids = [lnk.card_id      for lnk in c.card_links]
    category_names      = [lnk.category_name for lnk in c.category_links]

    return {
        'id': c.id,
        'card_id': c.card_id,
        'name': c.name,
        'challenge_type': c.challenge_type,
        'start_date': c.start_date.isoformat(),
        'end_date': c.end_date.isoformat(),
        'activation_date': c.activation_date.isoformat() if c.activation_date else None,
        'bonus_type': c.bonus_type,
        'bonus_amount': c.bonus_amount,
        'bonus_currency': 'usd' if c.bonus_type == 'statement_credit' else ('benefit' if c.bonus_type == 'benefit' else 'points'),
        'spend_cap': c.spend_cap,
        'spend_threshold': c.spend_threshold,
        'spender_filter': c.spender_filter,
        'max_occurrences': prog['max_occurrences'],
        'occurrences_earned': prog['occurrences_earned'],
        'category_names': category_names,
        'additional_card_ids': additional_card_ids,
        'current_spend': round(current_spend, 2),
        'lap_spend': prog['lap_spend'],
        'bonus_unlocked': bonus_unlocked,
        'bonus_pts_earned': bonus_pts,
        'progress_pct': progress_pct,
        'progress_target': progress_target,
        'remaining_spend': remaining,
        'status': status,
        'is_active': c.is_active,
        'notes': c.notes,
        'currency': eco.currency_name if eco else 'Points',
        'your_cpp': eco.your_cpp if eco else 1.0,
    }
def _serialize_redemption(r: Redemption) -> dict:
    realized_cpp = round((r.cash_value_usd / r.points_redeemed) * 100, 4) if r.points_redeemed else 0
    return {
        'id': r.id,
        'ecosystem_id': r.ecosystem_id,
        'ecosystem_name': r.ecosystem.name if r.ecosystem else None,
        'points_redeemed': r.points_redeemed,
        'redemption_date': r.redemption_date.isoformat(),
        'description': r.description,
        'cash_value_usd': r.cash_value_usd,
        'realized_cpp': realized_cpp,
        'notes': r.notes,
        'person': r.person,
    }
def _serialize_balance_snapshot(s: PointsBalanceSnapshot) -> dict:
    return {
        'id': s.id,
        'ecosystem_id': s.ecosystem_id,
        'ecosystem_name': s.ecosystem.name if s.ecosystem else None,
        'balance': s.balance,
        'snapshot_date': s.snapshot_date.isoformat(),
        'notes': s.notes,
        'person': s.person,
    }
def _serialize_adjustment(a: PointsAdjustment) -> dict:
    return {
        'id': a.id,
        'ecosystem_id': a.ecosystem_id,
        'ecosystem_name': a.ecosystem.name if a.ecosystem else None,
        'points_delta': a.points_delta,
        'adjustment_date': a.adjustment_date.isoformat(),
        'description': a.description,
        'notes': a.notes,
        'person': a.person,
    }
def _serialize_transfer_ratio(tr: TransferRatio) -> dict:
    return {
        'id': tr.id,
        'source_ecosystem_id': tr.source_ecosystem_id,
        'source_ecosystem_name': tr.source_ecosystem.name if tr.source_ecosystem else None,
        'destination_ecosystem_id': tr.destination_ecosystem_id,
        'destination_ecosystem_name': tr.destination_ecosystem.name if tr.destination_ecosystem else None,
        'base_ratio': tr.base_ratio,
        'effective_from': tr.effective_from.isoformat(),
        'effective_to': tr.effective_to.isoformat() if tr.effective_to else None,
    }
def _serialize_transfer(t: Transfer) -> dict:
    return {
        'id': t.id,
        'source_ecosystem_id': t.source_ecosystem_id,
        'source_ecosystem_name': t.source_ecosystem.name if t.source_ecosystem else None,
        'destination_ecosystem_id': t.destination_ecosystem_id,
        'destination_ecosystem_name': t.destination_ecosystem.name if t.destination_ecosystem else None,
        'points_sent': t.points_sent,
        'base_ratio_used': t.base_ratio_used,
        'bonus_pct': t.bonus_pct,
        'points_received': t.points_received,
        'transfer_date': t.transfer_date.isoformat(),
        'notes': t.notes,
        'person': t.person,
        'to_person': t.to_person or t.person,
    }
def _serialize_person_transfer(pt: PersonPointsTransfer) -> dict:
    return {
        'id': pt.id,
        'ecosystem_id': pt.ecosystem_id,
        'ecosystem_name': pt.ecosystem.name if pt.ecosystem else None,
        'from_person': pt.from_person,
        'to_person': pt.to_person,
        'points': pt.points,
        'transfer_date': pt.transfer_date.isoformat(),
        'notes': pt.notes,
    }
def _serialize_benefit(b: CardBenefit, usage: BenefitUsage | None) -> dict:
    amt_used = round(usage.amount_used if usage else 0.0, 2)
    pct      = round(amt_used / b.amount * 100, 1) if b.amount else 0.0
    return {
        'id':               b.id,
        'product_id':       b.product_id,
        'benefit_name':     b.benefit_name,
        'amount':           b.amount,
        'reset_frequency':  b.reset_frequency or 'annual',
        'trigger_category': b.trigger_category,
        'notes':            b.notes,
        'tracking_type':    b.tracking_type or 'periodic',
        'cycle':            _current_cycle(b.reset_frequency or 'annual'),
        'amount_used':      amt_used,
        'confirmed':        usage.confirmed if usage else False,
        'usage_id':         usage.id if usage else None,
        'pct_used':         pct,
        'remaining':        round((b.amount or 0) - amt_used, 2),
    }
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
