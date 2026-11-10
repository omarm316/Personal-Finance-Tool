"""Card benefits: credits per period, uses, statement-credit matching and
expiring credits (docs/cards-card-design.md, "Benefits" and "Expiring credits";
build notes in its "Benefits built" section).

Each benefit is stored the way the card issues it: an amount per period and a
cadence, with the year running by calendar or by card anniversary
(card.issue_date). Cadences: monthly, quarterly, semiannual, annual,
multi_year (every `every_years` years, from the last use) and per_use.

Uses come from two places:
  - Statement credits: money-back rows on the card's account whose description
    contains the benefit's match text, whatever the row's type. Excluded rows
    are skipped (which also skips rows the sync soft-deleted). They are read
    live, so a sync, a type change or Exclude shows at once.
  - Uses logged in the app (benefit_usage rows): by hand (Add use, Mark fully
    used) or from a purchase (Log credit use, transaction_id set).

Counting, per period:
  - A credit with no match text is logged by hand: every logged use counts.
  - An auto-tracked credit counts its statement credits. A use logged from a
    purchase only records which purchase the credit paid for. A use logged by
    hand counts until statement credits dated on or after it, in the same
    period, replace it, so marking a credit used before it posts never counts
    it twice.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta

from sqlalchemy import or_

from database import BenefitUsage, Card, CardBenefit, CardProduct, Transaction

CADENCES = ('monthly', 'quarterly', 'semiannual', 'annual', 'multi_year', 'per_use')
YEAR_TYPES = ('calendar', 'card')
STEP = {'monthly': 1, 'quarterly': 3, 'semiannual': 6, 'annual': 12}
EXPIRING_DAYS = 60
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
EPS = 0.005


def today_() -> date:
    """Today, in one place so tests can pin it."""
    return date.today()


# ── Dates ───────────────────────────────────────────────────────────────────
def _dim(y: int, m: int) -> int:
    return calendar.monthrange(y, m)[1]


def _safe(y: int, m: int, d: int) -> date:
    return date(y, m, min(d, _dim(y, m)))


def _add_months(d: date, n: int, day: int | None = None) -> date:
    k = d.month - 1 + n
    y, m = d.year + k // 12, k % 12 + 1
    return _safe(y, m, day or d.day)


def _as_date(v) -> date | None:
    if v is None:
        return None
    return v.date() if isinstance(v, datetime) else v


def year_start(b: CardBenefit, issue: date | None, d: date) -> date:
    """First day of the benefit year that holds `d`."""
    if (b.year_type or 'calendar') == 'card' and issue:
        a = _safe(d.year, issue.month, issue.day)
        return a if a <= d else _safe(d.year - 1, issue.month, issue.day)
    return date(d.year, 1, 1)


def _year_periods(b: CardBenefit, issue: date | None, d: date) -> list[tuple[date, date]]:
    ys = year_start(b, issue, d)
    step, day = STEP[b.cadence], ys.day
    out = []
    for i in range(12 // step):
        s = _add_months(ys, i * step, day)
        e = _add_months(ys, (i + 1) * step, day) - timedelta(days=1)
        out.append((s, e))
    return out


def period_of(b: CardBenefit, issue: date | None, d: date) -> tuple[date, date] | None:
    """(start, end) of the period holding `d`, for the period cadences."""
    if b.cadence not in STEP:
        return None
    for s, e in _year_periods(b, issue, d):
        if s <= d <= e:
            return s, e
    return None


def _label(b: CardBenefit, s: date, e: date) -> str:
    cal = (b.year_type or 'calendar') != 'card'
    if b.cadence == 'monthly':
        return MON[s.month - 1]
    if b.cadence == 'quarterly' and cal:
        return f'Q{(s.month - 1) // 3 + 1}'
    if b.cadence == 'annual':
        return str(s.year) if cal else 'Card year'
    return f'{MON[s.month - 1]}–{MON[e.month - 1]}'


# ── Legacy fields → the new model (startup backfill) ────────────────────────
def cadence_from_legacy(b: CardBenefit) -> tuple[str, float | None]:
    f = (b.reset_frequency or 'annual').lower()
    name = (b.benefit_name or '').lower()
    if f.startswith('every_'):
        try:
            return 'multi_year', float(f.split('_')[1])
        except ValueError:
            return 'multi_year', 4.0
    if 'global entry' in name or 'tsa precheck' in name:
        return 'multi_year', 4.5 if '4.5' in name else 4.0
    if (b.tracking_type or '') == 'by_use':
        return 'per_use', None
    return {'monthly': 'monthly', 'quarterly': 'quarterly', 'semi-annual': 'semiannual',
            'semiannual': 'semiannual'}.get(f, 'annual'), None


def _cycle_start(cycle: str) -> date | None:
    """Start of a legacy cycle key: "2026", "2026-H2", "2026-Q3", "2026-03"."""
    try:
        y = int(cycle[:4])
        rest = cycle[5:]
        if not rest:
            return date(y, 1, 1)
        if rest[0] == 'H':
            return date(y, 1 if rest == 'H1' else 7, 1)
        if rest[0] == 'Q':
            return date(y, (int(rest[1]) - 1) * 3 + 1, 1)
        return date(y, int(rest), 1)
    except (ValueError, IndexError, TypeError):
        return None


# Amex Platinum's 2026 credits, checked against the 2026 statements and the
# card's published terms (2026-11-10). The Saks credit ended June 30, 2026.
# (name, amount per period, cadence, every_years, match text, notes)
PLATINUM_2026 = [
    ('Hotel credit', 300, 'semiannual', None, 'Platinum Hotel Credit',
     'Prepaid Fine Hotels + Resorts or The Hotel Collection stays through Amex Travel.'),
    ('Resy dining credit', 100, 'quarterly', None, 'Platinum Resy Credit',
     'U.S. Resy restaurants.'),
    ('lululemon credit', 75, 'quarterly', None, 'Platinum Lululemon Credit',
     'U.S. lululemon stores and online.'),
    ('Digital entertainment credit', 25, 'monthly', None, 'Platinum Digital Entertainment Credit',
     'Disney+, Hulu, ESPN+, Peacock, NYT, WSJ, Paramount+, YouTube Premium and YouTube TV.'),
    ('Uber Cash', 15, 'monthly', None, None,
     'Paid into the Uber account, so it is logged by hand. December adds $20 more ($35).'),
    ('Walmart+ credit', 12.95, 'monthly', None, None, 'A monthly Walmart+ membership.'),
    ('Equinox credit', 300, 'annual', None, 'Equinox Credit', 'Equinox club or Equinox+.'),
    ('CLEAR Plus credit', 209, 'annual', None, 'CLEAR PLUS CREDIT', None),
    ('Airline fee credit', 200, 'annual', None, None,
     'Incidental fees on the one airline picked each year.'),
    ('Uber One credit', 120, 'annual', None, None, 'An auto-renewing Uber One membership.'),
    ('Oura Ring credit', 200, 'annual', None, None, None),
    ('Global Entry or TSA PreCheck credit', 120, 'multi_year', 4.0, None,
     'Global Entry $120 every 4 years, or TSA PreCheck $85 every 4.5 years.'),
]
PLATINUM_OLD = ['$240 Digital Entertainment', '$200 Hotel Credit (FHR/THC)', '$100 Saks Credit',
                '$189 CLEAR Plus Credit', '$200 Airline Fee Credit', '$200 Uber Cash',
                '$155 Walmart+ Credit', 'Global Entry/TSA PreCheck']

# Statement-credit texts seen in the 2026 transactions (read-only, 2026-11-10).
# Set once, only where a benefit has none yet.
MATCH_TEXTS = [
    ('marriott_bonvoy_brilliant', '$25/mo Dining Credit ($300/yr; statement credit at restaurants worldwide)',
     'Brilliant Dining Credit'),
    ('amex_business_gold', 'ChatGPT Business Credit', 'ChatGPT Business Credit'),
    ('amex_business_gold', 'Squarespace Credit', 'Squarespace Statement Credit'),
    ('amex_business_gold', 'FedEx/Grubhub/Office Supply Credit', 'FLEXIBLE BUSINESS CREDIT'),
    ('hilton_aspire', '$209 CLEAR+ Credit (annual)', 'CLEAR PLUS CREDIT'),
    ('united_quest', 'Rideshare Credit (requires annual enrollment; $12 in December)', 'RIDESHARE CREDIT'),
    ('united_explorer', 'Rideshare Credit', 'RIDESHARE CREDIT'),
]


def backfill(session) -> dict:
    """Runs at every startup; each step only touches rows it hasn't done yet."""
    n = {'cadence': 0, 'uses': 0, 'platinum': 0, 'match': 0}
    for b in session.query(CardBenefit).filter(CardBenefit.cadence.is_(None)).all():
        b.cadence, ey = cadence_from_legacy(b)
        b.every_years = ey
        b.year_type = b.year_type or 'calendar'
        if b.remind is None:
            b.remind = True
        n['cadence'] += 1
    for u in session.query(BenefitUsage).filter(BenefitUsage.use_date.is_(None)).all():
        u.use_date = _cycle_start(u.cycle or '') or _as_date(u.updated_at) or today_()
        n['uses'] += 1
    session.flush()

    plat = session.query(CardProduct).filter_by(product_key='amex_platinum').first()
    if plat:
        rows = session.query(CardBenefit).filter_by(product_id=plat.id).all()
        old = [b for b in rows if b.benefit_name in PLATINUM_OLD]
        if any(b.benefit_name == '$240 Digital Entertainment' for b in old):
            have = {b.benefit_name for b in rows}
            for b in old:
                if not session.query(BenefitUsage).filter_by(benefit_id=b.id).first():
                    session.delete(b)
            for name, amt, cad, ey, match, notes in PLATINUM_2026:
                if name in have:
                    continue
                session.add(CardBenefit(
                    product_id=plat.id, benefit_name=name, amount=amt, cadence=cad, every_years=ey,
                    year_type='calendar', match_text=match, notes=notes, remind=True,
                    reset_frequency={'semiannual': 'semi-annual', 'multi_year': 'every_4_years'}.get(cad, cad),
                    tracking_type='by_use' if cad == 'multi_year' else 'periodic'))
                n['platinum'] += 1

    keys = {k for k, _, _ in MATCH_TEXTS}
    prods = {p.product_key: p.id for p in session.query(CardProduct).filter(CardProduct.product_key.in_(keys)).all()}
    for key, name, text in MATCH_TEXTS:
        if key not in prods:
            continue
        b = session.query(CardBenefit).filter_by(product_id=prods[key], benefit_name=name).first()
        if b and b.match_text is None:
            b.match_text = text
            n['match'] += 1
    session.commit()
    return n


# ── Loading ─────────────────────────────────────────────────────────────────
def _desc(t: Transaction) -> str:
    return (t.merchant_name or t.description_clean or t.description_raw or '').strip()


def _uses_since(benefits: list[CardBenefit], cards: list[Card], today: date) -> date:
    since = date(today.year - 1, 1, 1)
    for b in benefits:
        if b.cadence == 'multi_year':
            yrs = b.every_years or 4
            since = min(since, _add_months(today, -int(round(yrs * 12)) - 1))
    return since


def load(db, cards: list[Card], today: date | None = None, since: date | None = None) -> dict:
    """Everything the engine needs for these cards, one query per table."""
    today = today or today_()
    cards = [c for c in cards if c.product_id]
    prod_ids = {c.product_id for c in cards}
    benefits = (db.query(CardBenefit).filter(CardBenefit.product_id.in_(prod_ids), CardBenefit.amount > 0)
                  .order_by(CardBenefit.id).all()) if prod_ids else []
    by_prod: dict[int, list[CardBenefit]] = {}
    for b in benefits:
        by_prod.setdefault(b.product_id, []).append(b)
    start = min(since or today, _uses_since(benefits, cards, today))
    card_ids = [c.id for c in cards]
    uses = (db.query(BenefitUsage).filter(BenefitUsage.card_id.in_(card_ids)).all()) if card_ids else []

    texts = sorted({(b.match_text or '').strip() for b in benefits if (b.match_text or '').strip()})
    acct_ids = [c.account_id for c in cards if c.account_id]
    stmts = []
    if texts and acct_ids:
        like = []
        for t in texts:
            p = f'%{t}%'
            like += [Transaction.description_raw.ilike(p), Transaction.merchant_name.ilike(p)]
        stmts = (db.query(Transaction)
                   .filter(Transaction.account_id.in_(acct_ids), Transaction.amount > 0,
                           Transaction.is_excluded.isnot(True),
                           Transaction.date >= datetime.combine(start, time()), or_(*like))
                   .order_by(Transaction.date, Transaction.id).all())
    pids = {u.transaction_id for u in uses if u.transaction_id}
    purchases = {t.id: t for t in db.query(Transaction).filter(Transaction.id.in_(pids)).all()} if pids else {}
    return {'today': today, 'cards': cards, 'by_prod': by_prod, 'uses': uses, 'stmts': stmts,
            'purchases': purchases}


def _stmt_owner(t: Transaction, bens: list[CardBenefit]) -> CardBenefit | None:
    """The benefit a statement credit belongs to: the longest match text it contains."""
    hay = f'{t.description_raw or ""} {t.merchant_name or ""}'.lower()
    best = None
    for b in bens:
        m = (b.match_text or '').strip().lower()
        if m and m in hay and (best is None or len(m) > len(best.match_text.strip())):
            best = b
    return best


# ── Counting ────────────────────────────────────────────────────────────────
def _count(U: list[dict], auto: bool) -> None:
    """Sets `counts` on each use in one period (see the module notes)."""
    for u in U:
        u['counts'] = u['amount'] if (u['kind'] != 'statement' or auto) else 0.0
        u['replaced'] = False
    if not auto:
        return
    hands = sorted([u for u in U if u['kind'] == 'hand'], key=lambda u: (u['date'], u['id'] or 0))
    for u in U:
        if u['kind'] == 'purchase':
            u['counts'] = 0.0
    for st in sorted([u for u in U if u['kind'] == 'statement'], key=lambda u: u['date']):
        amt = st['amount']
        for h in hands:
            if amt <= EPS:
                break
            if h['date'] <= st['date'] and h['counts'] > EPS:
                take = min(h['counts'], amt)
                h['counts'] -= take
                amt -= take
    for h in hands:
        h['counts'] = round(h['counts'], 2)
        h['replaced'] = h['counts'] <= EPS
    # Show each purchase on the statement credit that paid for it.
    open_st = sorted([u for u in U if u['kind'] == 'statement'], key=lambda u: u['date'])
    for p in sorted([u for u in U if u['kind'] == 'purchase'], key=lambda u: u['date']):
        for st in open_st:
            if st['date'] >= p['date'] and not st.get('for_purchase'):
                st['for_purchase'] = p['purchase']
                st['link_use_id'] = p['id']
                p['paired'] = True
                break


def _settle(p: dict, amount: float) -> dict:
    """Used, left and status of a period from its uses' counted amounts."""
    used = round(sum(u['counts'] for u in p['uses']), 2)
    if p.get('before_card'):
        status = 'none'
    elif used >= amount - EPS:
        status = 'full'
    elif used > EPS:
        status = 'part'
    else:
        status = {'past': 'miss', 'current': 'open', 'future': 'fut'}[p['state']]
    p.update(used=used, status=status, left=round(max(0.0, amount - used), 2))
    p['uses'].sort(key=lambda u: (u['date'], u['id'] or 0))
    return p


def _period(b, s: date, e: date, today: date, U: list[dict], auto: bool, issue: date | None = None) -> dict:
    _count(U, auto)
    p = {'label': _label(b, s, e), 'start': s.isoformat(), 'end': e.isoformat(),
         'state': 'past' if e < today else 'future' if s > today else 'current', 'uses': U}
    if issue and e < issue:
        p['before_card'] = True
    return _settle(p, b.amount)


def _carry_back(P: list[dict], amount: float) -> None:
    """A statement credit often posts days after the purchase, in the next
    period. A period can't use more than its amount, so statement credits over
    it count toward the period before, if that one has room (earliest credits
    first, since they're the likeliest late ones)."""
    for i in range(len(P) - 1, 0, -1):
        cur, prev = P[i], P[i - 1]
        extra = round(cur['used'] - amount, 2)
        room = round(amount - prev['used'], 2)
        if extra <= EPS or room <= EPS or prev.get('before_card'):
            continue
        move = min(extra, room)
        for u in sorted([u for u in cur['uses'] if u['kind'] == 'statement' and u['counts'] > EPS],
                        key=lambda u: u['date']):
            if move <= EPS:
                break
            take = round(min(u['counts'], move), 2)
            u['counts'] = round(u['counts'] - take, 2)
            u['carried_to'] = prev['label']
            prev['uses'].append({**u, 'counts': take, 'carried_from': cur['label'], 'carried_to': None,
                                 'for_purchase': None, 'link_use_id': None})
            move -= take
        _settle(cur, amount)
        _settle(prev, amount)


def _year(b, issue, uses: list[dict], today: date, ref: date, auto: bool) -> list[dict]:
    """Every period of the benefit year holding `ref`, counted."""
    P = [_period(b, s, e, today, [dict(u) for u in uses if s <= u['date'] <= e], auto, issue)
         for s, e in _year_periods(b, issue, ref)]
    if auto:
        _carry_back(P, b.amount)
    return P


def _benefit(b: CardBenefit, card: Card, uses: list[dict], today: date) -> dict:
    issue = _as_date(card.issue_date)
    auto = bool((b.match_text or '').strip())
    out = {
        'id': b.id, 'name': b.benefit_name, 'amount': round(b.amount or 0, 2), 'cadence': b.cadence or 'annual',
        'year_type': b.year_type or 'calendar', 'every_years': b.every_years, 'match_text': b.match_text or '',
        'remind': b.remind is not False, 'notes': b.notes or '', 'tracked': 'auto' if auto else 'hand',
        'needs_open_date': (b.year_type == 'card' and not issue),
        'periods': [], 'uses': [], 'open': False, 'left': None, 'days_left': None, 'end': None, 'start': None,
        'year_value': 0.0, 'year_used': 0.0, 'year_missed': 0.0, 'year_left': 0.0, 'next_on': None,
    }
    if b.cadence in STEP:
        P = _year(b, issue, uses, today, today, auto)
        out['periods'] = P
        for p in P:
            if p.get('before_card'):
                continue
            got = min(p['used'], b.amount)
            out['year_value'] += b.amount
            out['year_used'] += got
            if p['state'] == 'past':
                out['year_missed'] += b.amount - got
            else:
                out['year_left'] += b.amount - got
        cur = next((p for p in P if p['state'] == 'current'), None)
        if cur:
            out.update(left=cur['left'], end=cur['end'], start=cur['start'], open=cur['status'] != 'full',
                       days_left=(date.fromisoformat(cur['end']) - today).days + 1)
    else:
        if b.cadence == 'multi_year':
            yrs = b.every_years or 4
            frm = _add_months(today, -int(round(yrs * 12))) + timedelta(days=1)
            U = [dict(u) for u in uses if u['date'] >= frm]
        else:
            frm = date(today.year, 1, 1)
            U = [dict(u) for u in uses if u['date'] >= frm]
        p = _period(b, frm, today, today, U, auto)
        out['uses'] = p['uses']
        counted = [u for u in p['uses'] if u['counts'] > EPS]
        this_year = sum(min(u['counts'], b.amount) for u in counted if u['date'].year == today.year)
        out['year_value'] = out['year_used'] = round(this_year, 2)
        if b.cadence == 'multi_year':
            full = p['used'] >= b.amount - EPS
            out['open'] = not full
            out['left'] = p['left']
            if counted:
                last = max(u['date'] for u in counted)
                out['next_on'] = _add_months(last, int(round(yrs * 12))).isoformat()
        else:
            out['open'] = True
    for k in ('year_value', 'year_used', 'year_missed', 'year_left'):
        out[k] = round(out[k], 2)
    return out


def _use_dict(u: BenefitUsage, purchases: dict) -> dict:
    t = purchases.get(u.transaction_id) if u.transaction_id else None
    return {'id': u.id, 'kind': 'purchase' if u.transaction_id else 'hand', 'date': _as_date(u.use_date),
            'amount': round(u.amount_used or 0, 2), 'notes': u.notes or '',
            'purchase': ({'id': t.id, 'date': _as_date(t.date).isoformat(), 'desc': _desc(t),
                          'amount': round(abs(t.amount), 2)} if t else None)}


def card_payload(data: dict, card: Card, for_date: date | None = None) -> dict:
    today = data['today']
    bens = data['by_prod'].get(card.product_id, []) if card.product_id else []
    by_b: dict[int, list[dict]] = {b.id: [] for b in bens}
    for u in data['uses']:
        if u.card_id == card.id and u.benefit_id in by_b and u.use_date:
            by_b[u.benefit_id].append(_use_dict(u, data['purchases']))
    for t in data['stmts']:
        if t.account_id != card.account_id:
            continue
        b = _stmt_owner(t, bens)
        if b:
            by_b[b.id].append({'id': None, 'txn_id': t.id, 'kind': 'statement', 'date': _as_date(t.date),
                               'amount': round(t.amount, 2), 'desc': _desc(t), 'notes': '', 'purchase': None})
    items = [_benefit(b, card, by_b[b.id], today) for b in bens]

    def rank(x):
        if x['periods'] and x['open']:
            return (0, x['days_left'] or 0, -(x['left'] or 0))
        return (1 if x['periods'] else 2, 0, 0)
    order = [x['id'] for x in sorted(items, key=rank)]
    openp = sorted([x for x in items if x['periods'] and x['open'] and x['days_left'] is not None],
                   key=lambda x: (x['days_left'], -(x['left'] or 0)))
    soon = [x for x in openp if x['days_left'] <= EXPIRING_DAYS]
    later = next((x for x in openp if x['days_left'] > EXPIRING_DAYS), None)

    def exp(x):
        span = (date.fromisoformat(x['end']) - date.fromisoformat(x['start'])).days + 1
        return {'benefit_id': x['id'], 'name': x['name'], 'left': x['left'], 'end': x['end'],
                'days': x['days_left'], 'span': span}
    linked: dict[int, list[dict]] = {}
    for x in items:
        for u in x['uses'] + [u for p in x['periods'] for u in p['uses']]:
            if u['kind'] == 'purchase' and u.get('purchase'):
                linked.setdefault(u['purchase']['id'], []).append(
                    {'benefit_id': x['id'], 'name': x['name'], 'amount': u['amount'], 'use_id': u['id']})
    tot = {k: round(sum(x[f'year_{k}'] for x in items), 2) for k in ('value', 'used', 'missed', 'left')}
    out = {
        'card_id': card.id, 'product_id': card.product_id, 'today': today.isoformat(),
        'needs_open_date': any(x['needs_open_date'] for x in items), 'totals': tot,
        'benefits': items, 'order': order,
        'expiring': {'window': EXPIRING_DAYS, 'items': [exp(x) for x in soon],
                     'total': round(sum(x['left'] for x in soon), 2), 'next': exp(later) if later else None},
        'linked_purchases': {str(k): v for k, v in linked.items()},
    }
    if for_date:
        out['at_date'] = at_date(data, card, bens, by_b, for_date)
    return _jsonable(out)


def at_date(data, card, bens, by_b, d: date) -> dict:
    """What's left of each credit in the period a purchase dated `d` falls in."""
    issue = _as_date(card.issue_date)
    res = {}
    for b in bens:
        auto = bool((b.match_text or '').strip())
        if b.cadence in STEP:
            p = next(x for x in _year(b, issue, by_b[b.id], data['today'], d, auto)
                     if x['start'] <= d.isoformat() <= x['end'])
            res[str(b.id)] = {'label': p['label'], 'start': p['start'], 'end': p['end'], 'left': p['left'],
                              'used': p['used']}
        else:
            res[str(b.id)] = {'label': None, 'start': None, 'end': None, 'left': round(b.amount, 2), 'used': 0}
    return res


def _jsonable(o):
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_jsonable(v) for v in o]
    if isinstance(o, date):
        return o.isoformat()
    return o


def for_card(db, card: Card, today: date | None = None, for_date: date | None = None) -> dict:
    data = load(db, [card], today=today, since=for_date)
    return card_payload(data, card, for_date=for_date)


def for_cards(db, cards: list[Card], today: date | None = None) -> dict[int, dict]:
    data = load(db, cards, today=today)
    return {c.id: card_payload(data, c) for c in data['cards']}


def expiring_all(db, today: date | None = None, within: int = EXPIRING_DAYS) -> list[dict]:
    """Open credits on every active card that reset within `within` days."""
    cards = db.query(Card).filter(Card.is_active.isnot(False), Card.product_id.isnot(None)).all()
    by_id = {c.id: c for c in cards}
    out = []
    for cid, pay in for_cards(db, cards, today=today).items():
        c = by_id[cid]
        for x in pay['benefits']:
            if x['periods'] and x['open'] and x['days_left'] is not None and x['days_left'] <= within:
                out.append({'card_id': c.id, 'card_name': c.card_name, 'last_four': c.last_four,
                            'person': c.primary_user, 'benefit_id': x['id'], 'name': x['name'],
                            'left': x['left'], 'end': x['end'], 'days': x['days_left']})
    out.sort(key=lambda x: (x['days'], -x['left']))
    return out
