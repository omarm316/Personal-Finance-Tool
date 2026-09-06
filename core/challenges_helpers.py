"""
core/challenges_helpers.py — SpendChallenge progress/recalculation and
benefit-cycle helpers, shared by routers/challenges.py and routers/cards.py.

Extracted from main.py (Phase 0 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
from datetime import datetime

from sqlalchemy import or_

from database import Card, Transaction, PointsCategory, ChallengeCardLink, ChallengeCategoryLink
from core.points_engine import _NON_EARNING_CATS

def _challenge_progress(c, current_spend: float) -> dict:
    """Single source of truth for a challenge's payout + progress, given its
    (already-computed) cumulative eligible spend for the window. Pure function,
    no DB access — used identically whether current_spend comes from the cached
    aggregate column or a per-card spend_override, so the two never drift.

    bonus_type shapes:
      'per_dollar'                              — scales with spend, capped by spend_cap.
      'flat' / 'statement_credit' / 'benefit'    — fixed payout once unlocked; the
                                                     latter two are semantically not
                                                     points (dollars / a non-numeric
                                                     reward like a free-night cert) but
                                                     numerically identical to 'flat'
                                                     here — only the frontend label
                                                     differs (see bonus_currency in
                                                     _serialize_challenge). Previously
                                                     'benefit' fell through to the
                                                     per_dollar branch below by accident
                                                     (e.g. a "1 free night cert" challenge
                                                     reporting bonus_pts_earned as
                                                     1 x current_spend) — fixed here.

    Repeatable challenges (c.max_occurrences > 1, requires spend_threshold): the
    threshold can be hit more than once — bonus_pts scales by how many times, and
    the progress bar reflects the *current lap* (spend since the last occurrence),
    not raw cumulative spend, so it never shows past 100%.
    """
    threshold = c.spend_threshold
    cap = c.spend_cap
    max_occ = c.max_occurrences or 1
    repeatable = bool(threshold and max_occ > 1)
    occurrences = None

    if c.bonus_type == 'per_dollar':
        eligible = current_spend
        if cap:
            eligible = min(eligible, cap)
        bonus_unlocked = eligible > 0
        bonus_pts = round(eligible * float(c.bonus_amount or 0), 1) if bonus_unlocked else 0.0
    elif repeatable:
        occurrences = min(max_occ, int(current_spend // threshold))
        bonus_unlocked = occurrences > 0
        bonus_pts = occurrences * float(c.bonus_amount or 0)
    else:
        bonus_unlocked = threshold is None or current_spend >= float(threshold or 0)
        bonus_pts = float(c.bonus_amount or 0) if bonus_unlocked else 0.0

    # lap_spend is what the Progress bar's numerator should show — for a
    # repeatable challenge that's spend since the last occurrence, not the raw
    # cumulative total (which would read as "spent more than the goal").
    lap_spend = current_spend
    if repeatable and occurrences < max_occ:
        progress_target = threshold
        lap_spend = current_spend - occurrences * threshold
        progress_pct = min(100, round(lap_spend / threshold * 100, 1))
        remaining = round(threshold - lap_spend, 2) if lap_spend < threshold else None
    elif repeatable:
        # All occurrences earned — show the final lap as complete, not overflowing.
        progress_target = threshold
        lap_spend = threshold
        progress_pct = 100
        remaining = None
    elif cap:
        progress_target = cap
        progress_pct = min(100, round(current_spend / cap * 100, 1))
        remaining = round(cap - current_spend, 2) if current_spend < cap else None
    elif threshold:
        progress_target = threshold
        progress_pct = min(100, round(current_spend / threshold * 100, 1))
        remaining = round(threshold - current_spend, 2) if current_spend < threshold else None
    else:
        progress_target = progress_pct = remaining = None

    return {
        'bonus_pts': bonus_pts,
        'bonus_unlocked': bonus_unlocked,
        'occurrences_earned': occurrences,
        'max_occurrences': max_occ if repeatable else None,
        'progress_target': progress_target,
        'progress_pct': progress_pct,
        'remaining_spend': remaining,
        'lap_spend': round(lap_spend, 2),
    }
def _recalc_challenge(db, challenge):
    """
    Recompute current_spend and bonus_unlocked for a SpendChallenge from
    actual transactions. Mutates the challenge object; caller must commit.

    Effective start = max(start_date, activation_date) — handles the case where
    a card was opened after the challenge period started (e.g. SUB clock begins
    at card activation, not at start of the year).

    Unions the primary card's account with all additional_cards accounts so that
    e.g. two Freedom cards on the same household contribute jointly to one quarterly cap.

    For category challenges, uses the challenge.categories junction rows and
    expands each selected L1 category to include its L2 children.
    """
    from sqlalchemy import func as _func

    # Normalise: old DB schema stored these as TIMESTAMP; current model uses DATE.
    # Calling .date() on a datetime is safe; a plain date passes through unchanged.
    def _d(v):
        return v.date() if isinstance(v, datetime) else v

    # Effective start date
    effective_start = _d(challenge.start_date)
    if challenge.activation_date:
        act = _d(challenge.activation_date)
        if act > effective_start:
            effective_start = act

    # Cap at today — for active challenges the end_date is in the future, so
    # capping ensures we only count posted transactions, not phantom future ones.
    # For expired challenges end_date <= today so min() keeps the challenge window.
    today = datetime.utcnow().date()
    end_date = min(_d(challenge.end_date), today)

    # Collect account IDs: primary card + all additional cards
    account_ids = []
    primary_card = db.query(Card).filter_by(id=challenge.card_id).first()
    if primary_card and primary_card.account_id:
        account_ids.append(primary_card.account_id)
    # Additional cards via direct link table (avoids complex secondary join)
    for lnk in challenge.card_links:
        extra_card = db.query(Card).filter_by(id=lnk.card_id).first()
        if extra_card and extra_card.account_id and extra_card.account_id not in account_ids:
            account_ids.append(extra_card.account_id)

    # Expenses are stored as negative amounts (Plaid sign is flipped on import).
    # Sum the absolute value by negating the sum of negative amounts.
    # Exclude fee/charge categories that should not count toward challenge spend.
    q = db.query(_func.sum(Transaction.amount)).filter(
        Transaction.date >= effective_start,
        Transaction.date <= end_date,
        Transaction.action == 'Expense',
        Transaction.amount < 0,           # expenses stored as negative
        Transaction.is_excluded != True,  # exclude soft-deleted dupes
        or_(
            Transaction.points_category == None,
            ~Transaction.points_category.in_(_NON_EARNING_CATS),
        ),
    )
    if account_ids:
        q = q.filter(Transaction.account_id.in_(account_ids))

    # Category filter — use direct link table
    cat_names = [lnk.category_name for lnk in challenge.category_links]
    if cat_names:
        children = [c.name for c in db.query(PointsCategory)
                    .filter(PointsCategory.parent_key.in_(cat_names)).all()]
        valid_cats = list(set(cat_names + children))
        q = q.filter(Transaction.points_category.in_(valid_cats))

    # Spender filter — for shared/employee-card accounts where a challenge's
    # terms require spend from one specific person (e.g. an authorized-user
    # SUB). NULL/blank means "anyone's spend counts" (the pre-existing behavior).
    if challenge.spender_filter:
        q = q.filter(Transaction.spender == challenge.spender_filter)

    raw = q.scalar() or 0
    current_spend = float(abs(raw))   # negate to get positive spend total
    challenge.current_spend = current_spend
    # Cosmetic/consistency only — _serialize_challenge always recomputes fresh
    # via _challenge_progress(), nothing reads this cached column for display.
    challenge.bonus_unlocked = _challenge_progress(challenge, current_spend)['bonus_unlocked']
    return challenge
def _challenge_spend_for_card(db, challenge, account_id: int) -> float:
    """
    Eligible spend for a SINGLE account only — used for per-card display.

    Identical date/category logic to _recalc_challenge but scoped to one
    account so linked-card challenges show each card's own spend rather than
    the multi-card aggregate stored in challenge.current_spend.
    """
    from sqlalchemy import func as _func

    def _d(v):
        return v.date() if isinstance(v, datetime) else v

    effective_start = _d(challenge.start_date)
    if challenge.activation_date:
        act = _d(challenge.activation_date)
        if act > effective_start:
            effective_start = act

    today = datetime.utcnow().date()
    end_date = min(_d(challenge.end_date), today)

    q = db.query(_func.sum(Transaction.amount)).filter(
        Transaction.date >= effective_start,
        Transaction.date <= end_date,
        Transaction.action == 'Expense',
        Transaction.amount < 0,
        Transaction.is_excluded != True,
        Transaction.account_id == account_id,
        or_(
            Transaction.points_category == None,
            ~Transaction.points_category.in_(_NON_EARNING_CATS),
        ),
    )
    cat_names = [lnk.category_name for lnk in challenge.category_links]
    if cat_names:
        children = [c.name for c in db.query(PointsCategory)
                    .filter(PointsCategory.parent_key.in_(cat_names)).all()]
        valid_cats = list(set(cat_names + children))
        q = q.filter(Transaction.points_category.in_(valid_cats))

    if challenge.spender_filter:
        q = q.filter(Transaction.spender == challenge.spender_filter)

    return float(abs(q.scalar() or 0))
def _sync_challenge_links(db, challenge, additional_card_ids, category_names):
    """Helper: replace junction-table rows for a challenge after create/update.
    Uses the direct relationship collections so SQLAlchemy stays in sync."""
    # Replace card links
    db.query(ChallengeCardLink).filter_by(challenge_id=challenge.id)\
        .delete(synchronize_session=False)
    for cid in (additional_card_ids or []):
        db.add(ChallengeCardLink(challenge_id=challenge.id, card_id=int(cid)))
    # Replace category links
    db.query(ChallengeCategoryLink).filter_by(challenge_id=challenge.id)\
        .delete(synchronize_session=False)
    for name in (category_names or []):
        if name:
            db.add(ChallengeCategoryLink(challenge_id=challenge.id, category_name=name))
def _current_cycle(frequency: str) -> str:
    """Return the current period key for a benefit's reset_frequency.
    annual / calendar_year → "2026"
    semi-annual           → "2026-H1" or "2026-H2"
    quarterly             → "2026-Q1" … "2026-Q4"
    monthly               → "2026-03"
    """
    from datetime import date as _date
    now = _date.today()
    if frequency in ('annual', 'calendar_year'):
        return str(now.year)
    if frequency == 'semi-annual':
        return f"{now.year}-{'H1' if now.month <= 6 else 'H2'}"
    if frequency == 'quarterly':
        return f"{now.year}-Q{(now.month - 1) // 3 + 1}"
    if frequency == 'monthly':
        return f"{now.year}-{now.month:02d}"
    return str(now.year)
def _cycles_for_year(frequency: str, year: int) -> list[str]:
    """All cycle keys for a given year at this benefit's reset_frequency.
    Only meaningful for sub-annual frequencies — used to build the multi-period
    usage grid for 'periodic' benefits (e.g. 12 boxes for a monthly credit).
    """
    if frequency == 'monthly':
        return [f"{year}-{m:02d}" for m in range(1, 13)]
    if frequency == 'quarterly':
        return [f"{year}-Q{q}" for q in range(1, 5)]
    if frequency == 'semi-annual':
        return [f"{year}-H1", f"{year}-H2"]
    return [str(year)]
