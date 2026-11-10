"""The points ledger from the fresh start (docs/cards-ledger-design.md).

One anchor per person per program: the posted balance the program showed on
the ledger's start date (2027-01-01), stored as a PointsBalanceSnapshot dated
that day. From there the ledger adds card points per statement (locked
`points_earned`), challenge bonuses once marked posted, redemptions, transfers,
transfers between people and adjustments. Nothing dated before the start
counts, apart from the first statement of each card (see _card_lines).

A balance check is an adjustment with the reason "Balance adjustment" and the
figure the program showed; it never resets anything.

Until the start date the app keeps the older balance math in
core/points_engine.py (_compute_ecosystem_balance). `ledger_active()` is the
switch the endpoints read.
"""
import calendar
import os
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from core.earn_engine import POINTS_FRESH_START
from core.points_engine import _statement_close_date
from database import (
    Account, Card, CardProduct, PersonPointsTransfer, PointsAdjustment, PointsBalanceSnapshot,
    PointsEcosystem, Redemption, SpendChallenge, Transaction, Transfer,
)

REASONS = ['Stay or flight', 'Sign-up bonus', 'Referral', 'Promotion', 'Points expired', 'Balance adjustment', 'Other']
CHECK_REASON = 'Balance adjustment'
BONUS_REASON = 'Sign-up bonus'
NO_OWNER = 'No owner'
STALE_DAYS = 60


def ledger_start() -> date:
    """2027-01-01 unless POINTS_LEDGER_START is set (tests and local previews)."""
    v = os.environ.get('POINTS_LEDGER_START')
    if v:
        try:
            return date.fromisoformat(v)
        except ValueError:
            pass
    return POINTS_FRESH_START


def ledger_active(today: date = None) -> bool:
    return (today or date.today()) >= ledger_start()


# ── Which accounts belong to which program ────────────────────────────────────

def program_accounts(db):
    """{account_id: (ecosystem_id, Card, product_key)} for active credit accounts with a card,
    resolved the way /api/ecosystems/{id}/earn-detail does (account's product, then the card's
    product, then the card's legacy ecosystem_id)."""
    card_by_acct = {}
    for c in db.query(Card).all():
        if c.account_id and c.account_id not in card_by_acct:
            card_by_acct[c.account_id] = c
    if not card_by_acct:
        return {}
    products = {p.id: p for p in db.query(CardProduct).all()}
    out = {}
    accts = db.query(Account).filter(Account.id.in_(list(card_by_acct))).all()
    for a in accts:
        if a.is_active is False or 'credit' not in (a.account_type or '').lower():
            continue
        c = card_by_acct[a.id]
        prod = products.get(a.product_id) or products.get(c.product_id)
        eco = prod.ecosystem_id if prod and prod.ecosystem_id else c.ecosystem_id
        if eco:
            out[a.id] = (eco, c, prod.product_key if prod else None)
    return out


def _mask(card):
    return str(card.last_four).zfill(4) if card.last_four is not None else None


def _card_label(card):
    m = _mask(card)
    return f"{card.card_name or 'Card'}{' ' + m if m else ''}"


# ── Card points, one line per statement ───────────────────────────────────────

def _prev_close(close: date, close_day: int) -> date:
    y, m = (close.year - 1, 12) if close.month == 1 else (close.year, close.month - 1)
    return date(y, m, min(close_day, calendar.monthrange(y, m)[1]))


def _card_lines(txns, acct_map, start, today):
    """Group locked card points into one line per card per statement and person.

    A statement posts the day after it closes; until then it's pending. The first
    statement of each card counts its charges from before the start date, since they
    post on that statement and so aren't in the opening balance. A card with no close
    day gets one line per calendar month, counted as charged."""
    groups = {}
    for t in txns:
        info = acct_map.get(t.account_id)
        if not info:
            continue
        eco, card, pkey = info
        d = t.date.date() if isinstance(t.date, datetime) else t.date
        person = (t.spender or '').strip() or card.primary_user or NO_OWNER
        cd = card.statement_close_day
        if cd:
            close = _statement_close_date(d, cd)
            if close < start:
                continue  # posted before the ledger opened, so it's in the opening balance
            key = (eco, card.id, person, close)
            g = groups.get(key)
            if g is None:
                g = groups[key] = dict(eco=eco, card=card, pkey=pkey, person=person, close=close,
                                       frm=_prev_close(close, cd) + timedelta(days=1), monthly=False,
                                       pts=0.0, n=0, pre=0)
            if d < start:
                g['pre'] += 1
        else:
            if d < start:
                continue
            mend = date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])
            key = (eco, card.id, person, mend)
            g = groups.get(key)
            if g is None:
                g = groups[key] = dict(eco=eco, card=card, pkey=pkey, person=person, close=mend,
                                       frm=date(d.year, d.month, 1), monthly=True, pts=0.0, n=0, pre=0)
        g['pts'] += t.points_earned or 0
        g['n'] += 1
    out = defaultdict(list)
    for g in groups.values():
        card = g['card']
        if g['monthly']:
            posts, status = min(g['close'], today), 'posted'
        else:
            posts = g['close'] + timedelta(days=1)
            status = 'posted' if today >= posts else 'pending'
        out[g['eco']].append(dict(
            id=f"stmt-{card.id}-{g['person']}-{g['close'].isoformat()}", kind='earn', date=posts.isoformat(),
            person=g['person'], pts=round(g['pts']), status=status,
            card_id=card.id, card_mask=_mask(card), card_name=_card_label(card), product_key=g['pkey'],
            monthly=g['monthly'], statement_from=g['frm'].isoformat(), statement_to=g['close'].isoformat(),
            charges=g['n'], before_start=g['pre'],
        ))
    return out


# ── Loading everything once ───────────────────────────────────────────────────

def _txns_for(db, acct_ids, start):
    """Rows on the programs' cards that can land in the ledger: from the start date, plus
    the open December cycle the first statement picks up (at most a month back). Excluded
    rows never count. Before the fresh start only Expense rows carried points."""
    if not acct_ids:
        return []
    since = datetime.combine(start - timedelta(days=32), time.min)
    start_dt = datetime.combine(start, time.min)
    rows = db.query(Transaction).filter(
        Transaction.account_id.in_(acct_ids),
        Transaction.date >= since,
        Transaction.is_excluded.isnot(True),  # a NULL flag counts as not excluded
    ).all()
    out = []
    for t in rows:
        if t.date < start_dt and t.action != 'Expense':
            continue
        if not t.points_earned:
            continue
        out.append(t)
    return out


def load(db, eco_ids=None, today=None):
    """Everything the ledger needs, for one program or all of them, in one query per table."""
    today = today or date.today()
    start = ledger_start()
    acct_map = program_accounts(db)
    if eco_ids is not None:
        eco_ids = set(eco_ids)
        acct_map = {a: v for a, v in acct_map.items() if v[0] in eco_ids}
    flt = (lambda col: col.in_(eco_ids)) if eco_ids is not None else None

    def q(model, eco_col, date_col):
        query = db.query(model).filter(date_col >= start)
        if flt is not None:
            query = query.filter(flt(eco_col))
        return query.all()

    opens = db.query(PointsBalanceSnapshot).filter(PointsBalanceSnapshot.snapshot_date == start)
    if flt is not None:
        opens = opens.filter(flt(PointsBalanceSnapshot.ecosystem_id))
    xfers = db.query(Transfer).filter(Transfer.transfer_date >= start)
    if eco_ids is not None:
        xfers = xfers.filter((Transfer.source_ecosystem_id.in_(eco_ids)) | (Transfer.destination_ecosystem_id.in_(eco_ids)))
    eco_names = {e.id: e.name for e in db.query(PointsEcosystem).all()}
    challenges = db.query(SpendChallenge).filter(SpendChallenge.bonus_type == 'flat', SpendChallenge.end_date >= start).all()
    return dict(
        today=today, start=start, acct_map=acct_map, eco_names=eco_names,
        card_lines=_card_lines(_txns_for(db, list(acct_map), start), acct_map, start, today),
        opens=[s for s in opens.all() if s.person],
        adjustments=q(PointsAdjustment, PointsAdjustment.ecosystem_id, PointsAdjustment.adjustment_date),
        redemptions=q(Redemption, Redemption.ecosystem_id, Redemption.redemption_date),
        between=q(PersonPointsTransfer, PersonPointsTransfer.ecosystem_id, PersonPointsTransfer.transfer_date),
        transfers=xfers.all(), challenges=challenges,
        card_by_id={c.id: (eco, c, pk) for eco, c, pk in acct_map.values()},
    )


# ── One program's entries and balances ────────────────────────────────────────

_RANK = {'open': 0, 'earn': 1, 'check': 3}


def _order(e):
    return (e['date'], _RANK.get(e['kind'], 2), e['id'])


def _challenge_person(ch, card):
    return (ch.spender_filter or '').strip() or card.primary_user or NO_OWNER


def entries_for(data, eco_id):
    """Every ledger line for one program, oldest first."""
    start, today, names = data['start'], data['today'], data['eco_names']
    E = []
    for s in data['opens']:
        if s.ecosystem_id == eco_id:
            E.append(dict(id=f"open-{s.id}", kind='open', date=start.isoformat(), person=s.person,
                          pts=round(s.balance or 0), status='posted', snapshot_id=s.id, note=s.notes))
    E += data['card_lines'].get(eco_id, [])
    posted_bonus = set()
    for a in data['adjustments']:
        if a.ecosystem_id != eco_id:
            continue
        reason = a.reason or 'Other'
        kind = 'check' if reason == CHECK_REASON else 'bonus' if a.challenge_id else 'adj'
        if a.challenge_id:
            posted_bonus.add(a.challenge_id)
        e = dict(id=f"adj-{a.id}", kind=kind, date=a.adjustment_date.isoformat(), person=a.person or NO_OWNER,
                 pts=round(a.points_delta or 0), status='posted', reason=reason, adjustment_id=a.id,
                 description=a.description, note=a.notes, reported_balance=a.reported_balance,
                 challenge_id=a.challenge_id)
        E.append(e)
    for r in data['redemptions']:
        if r.ecosystem_id == eco_id:
            E.append(dict(id=f"red-{r.id}", kind='red', date=r.redemption_date.isoformat(), person=r.person or NO_OWNER,
                          pts=-round(r.points_redeemed or 0), status='posted', redemption_id=r.id,
                          description=r.description, note=r.notes, cash_value_usd=r.cash_value_usd))
    for t in data['transfers']:
        ratio = f"{t.points_sent:,.0f} sent, {t.points_received:,.0f} received, ratio 1:{t.base_ratio_used:g}"
        if t.bonus_pct:
            ratio += f", +{t.bonus_pct * 100:g}% bonus"
        if t.source_ecosystem_id == eco_id:
            E.append(dict(id=f"xout-{t.id}", kind='xout', date=t.transfer_date.isoformat(), person=t.person or NO_OWNER,
                          pts=-round(t.points_sent or 0), status='posted', transfer_id=t.id,
                          partner=names.get(t.destination_ecosystem_id), detail=ratio, note=t.notes))
        if t.destination_ecosystem_id == eco_id:
            E.append(dict(id=f"xin-{t.id}", kind='xin', date=t.transfer_date.isoformat(),
                          person=t.to_person or t.person or NO_OWNER, pts=round(t.points_received or 0), status='posted',
                          transfer_id=t.id, partner=names.get(t.source_ecosystem_id), detail=ratio, note=t.notes))
    for p in data['between']:
        if p.ecosystem_id != eco_id:
            continue
        for person, sign in ((p.from_person, -1), (p.to_person, 1)):
            E.append(dict(id=f"p2p-{p.id}-{'out' if sign < 0 else 'in'}", kind='p2p', date=p.transfer_date.isoformat(),
                          person=person, pts=sign * round(p.points or 0), status='posted', person_transfer_id=p.id,
                          from_person=p.from_person, to_person=p.to_person, note=p.notes))
    # Challenge bonuses: a met flat-points challenge on this program's cards is pending until marked posted.
    for ch in data['challenges']:
        info = data['card_by_id'].get(ch.card_id)
        if not info or info[0] != eco_id or not ch.bonus_unlocked or ch.id in posted_bonus or not ch.bonus_amount:
            continue
        _, card, pkey = info
        E.append(dict(id=f"bonus-{ch.id}", kind='bonus', date=today.isoformat(), person=_challenge_person(ch, card),
                      pts=round(ch.bonus_amount), status='pending', reason=BONUS_REASON, challenge_id=ch.id,
                      challenge_name=ch.name, card_id=card.id, card_mask=_mask(card), card_name=_card_label(card),
                      product_key=pkey, threshold=ch.spend_threshold))
    # Bonuses already posted show the card they came from.
    for e in E:
        if e['kind'] == 'bonus' and e['status'] == 'posted' and e.get('challenge_id'):
            ch = next((c for c in data['challenges'] if c.id == e['challenge_id']), None)
            info = data['card_by_id'].get(ch.card_id) if ch else None
            if info:
                _, card, pkey = info
                e.update(card_id=card.id, card_mask=_mask(card), card_name=_card_label(card), product_key=pkey,
                         challenge_name=ch.name, threshold=ch.spend_threshold)
    E.sort(key=_order)
    _running(E)
    return E


def _running(E):
    """Balance after each posted line, for its own person and for everyone together."""
    per, tot = defaultdict(float), 0.0
    for e in E:
        if e['status'] != 'posted':
            continue
        e['person_before'] = round(per[e['person']])
        per[e['person']] += e['pts']
        tot += e['pts']
        e['person_after'] = round(per[e['person']])
        e['total_after'] = round(tot)


def _empty():
    return dict(opening=0, has_opening=False, earned=0, pending_cards=0, pending_bonus=0, redeemed=0,
                transferred_out=0, transferred_in=0, sent=0, received=0,
                by_reason={r: 0 for r in REASONS}, adjusted=0, current=0)


def summarize(E, people):
    """Per-person ledger rows plus Total. `earned` includes pending card points; the
    current balance counts posted lines only."""
    S = {p: _empty() for p in people}
    for e in E:
        s = S.setdefault(e['person'], _empty())
        v, k = e['pts'], e['kind']
        if k == 'open':
            s['opening'] += v
            s['has_opening'] = True
        elif k == 'earn':
            s['earned'] += v
            if e['status'] == 'pending':
                s['pending_cards'] += v
        elif k == 'bonus' and e['status'] == 'pending':
            s['pending_bonus'] += v
        elif k == 'red':
            s['redeemed'] += v
        elif k == 'xout':
            s['transferred_out'] += v
        elif k == 'xin':
            s['transferred_in'] += v
        elif k == 'p2p':
            s['sent' if v < 0 else 'received'] += v
        else:  # adj, check, posted bonus
            r = e.get('reason') or 'Other'
            s['by_reason'][r] = s['by_reason'].get(r, 0) + v
            s['adjusted'] += v
    for s in S.values():
        s['current'] = (s['opening'] + s['earned'] - s['pending_cards'] + s['redeemed'] + s['transferred_out']
                        + s['transferred_in'] + s['sent'] + s['received'] + s['adjusted'])
    total = _empty()
    for s in S.values():
        for k, v in s.items():
            if k == 'by_reason':
                for r, x in v.items():
                    total['by_reason'][r] = total['by_reason'].get(r, 0) + x
            elif k == 'has_opening':
                total[k] = total[k] or v
            else:
                total[k] += v
    return S, total


def last_checks(E, people, today):
    out = {}
    for p in people:
        checks = [e for e in E if e['kind'] == 'check' and e['person'] == p]
        if not checks:
            out[p] = None
            continue
        c = checks[-1]
        out[p] = dict(date=c['date'], gap=c['pts'], days_ago=(today - date.fromisoformat(c['date'])).days)
    return out


def people_for(data, eco_id, E=None):
    """Card owners in the program, Omer first, then anyone else with a line or an opening balance."""
    ppl = {c.primary_user for eco, c, _ in data['acct_map'].values() if eco == eco_id and c.primary_user}
    for e in E or []:
        if e['person'] and e['person'] != NO_OWNER:
            ppl.add(e['person'])
    return sorted(ppl, key=lambda p: (p != 'Omer', p))


def program_ledger(db, eco_id, today=None, data=None):
    """Everything the Ecosystem page's ledger and Activity table show for one program."""
    data = data or load(db, [eco_id], today)
    today = data['today']
    E = entries_for(data, eco_id)
    people = people_for(data, eco_id, E)
    S, total = summarize(E, people)
    no_owner = S.get(NO_OWNER)
    no_owner_cards = sorted({e['card_name'] for e in E if e['person'] == NO_OWNER and e.get('card_name')})
    acct_of = {c.id: a for a, (eco, c, _pk) in data['acct_map'].items() if eco == eco_id}
    no_owner_accts = sorted({(e['card_name'], acct_of.get(e.get('card_id'))) for e in E
                             if e['person'] == NO_OWNER and e.get('card_name')}, key=lambda x: x[0])
    return dict(
        ecosystem_id=eco_id, name=data['eco_names'].get(eco_id), active=ledger_active(today),
        start=data['start'].isoformat(), today=today.isoformat(), people=people,
        balances={p: S[p] for p in people}, total=total,
        no_owner=dict(balance=no_owner['current'], cards=no_owner_cards,
                      accounts=[dict(card_name=n, account_id=a) for n, a in no_owner_accts])
        if no_owner and (no_owner['current'] or no_owner_cards) else None,
        last_checks=last_checks(E, people, today), entries=E, reasons=REASONS,
        cards=[dict(card_id=c.id, card_name=_card_label(c), card_mask=_mask(c), product_key=pk, owner=c.primary_user)
               for eco, c, pk in data['acct_map'].values() if eco == eco_id],
    )


def posted_balance(db, eco_id, person, as_of: date, today=None):
    """A person's posted balance at the end of `as_of`, for a balance check."""
    data = load(db, [eco_id], today)
    E = entries_for(data, eco_id)
    return round(sum(e['pts'] for e in E if e['status'] == 'posted' and e['person'] == person and e['date'] <= as_of.isoformat()))


def all_programs(db, today=None):
    """Per-program totals for Portfolio: balance, pending, checks and opening balances still to set."""
    data = load(db, None, today)
    today = data['today']
    eco_ids = {v[0] for v in data['acct_map'].values()}
    cash = {e.id for e in db.query(PointsEcosystem).filter(PointsEcosystem.is_cash_back == True).all()}  # noqa: E712
    out, need, have = {}, 0, 0
    for eco_id in sorted(eco_ids - cash):
        E = entries_for(data, eco_id)
        owners = people_for(data, eco_id)
        people = people_for(data, eco_id, E)
        S, total = summarize(E, people)
        checks = last_checks(E, people, today)
        unset = [p for p in owners if not S.get(p, {}).get('has_opening')]
        need += len(owners)
        have += len(owners) - len(unset)
        stale = [p for p in owners if not checks.get(p) or checks[p]['days_ago'] > STALE_DAYS]
        out[eco_id] = dict(ecosystem_id=eco_id, name=data['eco_names'].get(eco_id), balance=total['current'],
                           pending=total['pending_cards'] + total['pending_bonus'], owners=owners,
                           unset=unset, has_opening=total['has_opening'], stale=stale, last_checks=checks,
                           pending_bonus_challenges=[e['challenge_id'] for e in E if e['kind'] == 'bonus' and e['status'] == 'pending'],
                           posted_bonus_challenges=[e['challenge_id'] for e in E if e['kind'] == 'bonus' and e['status'] == 'posted'],
                           posted_bonus=[dict(challenge_id=e['challenge_id'], date=e['date']) for e in E
                                         if e['kind'] == 'bonus' and e['status'] == 'posted'])
    return dict(active=ledger_active(today), start=data['start'].isoformat(), today=today.isoformat(),
                programs=list(out.values()), opening_set=have, opening_needed=need)
