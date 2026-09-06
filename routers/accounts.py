"""
routers/accounts.py — account CRUD, card-product linking, per-account card
detail/transactions views, duplicate detection/merging, Plaid balance sync,
reconciliation, and balance timelines.

backfill_account_balances is grouped here (with sync_account_balances) even
though it sat far from the rest of this domain in main.py — it's the same
"anchor this account's balance from Plaid" job as sync-balances, just a
one-time variant, not because of its original file position.

Extracted from main.py (Phase 1 batch 2 of the backend token-usage refactor —
see PLAN.md "main.py -> domain routers split").
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import (
    get_db, Account, AccountMonthlySnapshot, BalanceObservation, BenefitUsage,
    Card, CardProduct, CardProductReward, ChallengeCardLink, DuplicateIgnore,
    PlaidItem, PointsCategory, PointsEcosystem, SpendChallenge, Transaction,
)
from plaid_integration import setup_plaid_from_env

from core.accounts_helpers import (
    classify_account, get_account_balance, get_account_balances_bulk,
    rebuild_monthly_snapshots, _refresh_product_held_status, _sign_plaid_balance,
)
from core.challenges_helpers import (
    _challenge_progress, _challenge_spend_for_card, _current_cycle, _recalc_challenge,
)
from core.plaid_sync import _sync_item_background
from core.points_engine import calc_earn_rate
from core.serializers import serialize_account, _serialize_benefit

logger = logging.getLogger('moresheth')

router = APIRouter()


class AccountCreate(BaseModel):
    """Request body for creating a manual account (Section 2b)."""
    name: str
    account_type: str  # checking, savings, credit, investment, loan, real_estate, vehicle, etc.
    starting_balance: float = 0.0
    start_date: str  # YYYY-MM-DD
    notes: Optional[str] = None

@router.get("/api/accounts/product-suggestions")
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

@router.post("/api/accounts/{account_id}/link-product")
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

@router.get("/api/accounts/{account_id}/card-detail")
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

@router.get("/api/accounts/{account_id}/transactions")
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

@router.get("/api/accounts")
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

@router.post("/api/accounts")
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

@router.patch("/api/accounts/{account_id}")
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

@router.post("/api/accounts/rebuild-all-snapshots")
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

@router.post("/api/accounts/{account_id}/reset-and-resync")
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

@router.post("/api/accounts/{account_id}/rebuild-snapshots")
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

@router.post("/api/accounts/{account_id}/sever-plaid")
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

@router.post("/api/accounts/{account_id}/merge-into/{target_id}")
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

@router.get("/api/accounts/detect-duplicates")
async def detect_duplicate_accounts(db: Session = Depends(get_db)):
    """
    Find groups of active accounts that appear to be duplicates.
    Applies official_name guard and user ignore list — same filters as merge.
    """
    groups, ignored = _find_duplicate_pairs(db)
    return {'duplicates': groups, 'count': len(groups), 'ignored': ignored}

@router.post("/api/accounts/ignore-duplicate-pair")
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

@router.delete("/api/accounts/ignore-duplicate-pair")
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

@router.post("/api/accounts/merge-pair")
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

@router.post("/api/accounts/merge-duplicates")
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

@router.delete("/api/accounts/{account_id}")
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

@router.post("/api/accounts/backfill-balances")
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

@router.post("/api/accounts/sync-balances")
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

@router.get("/api/reconciliation")
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

@router.post("/api/reconciliation/{account_id}/reanchor")
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

@router.post("/api/reconciliation/reanchor-all")
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

@router.get("/api/balances/monthly")
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

@router.get("/api/accounts/{account_id}/balance-timeline")
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

@router.get("/api/accounts/{account_id}/reconcile")
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
