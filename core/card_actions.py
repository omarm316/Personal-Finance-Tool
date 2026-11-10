"""The rebuilt Cards pages' shared reads (Cards step 5).

- `wallet`: the cards row on Portfolio and Ecosystem (whole cards, card art,
  owner chips), one entry per open credit-card account.
- `actions`: the Actions strip (docs/cards-actions-design.md): credits whose
  current period still has money left and resets within 60 days, challenges
  at risk, and the "Next" credit for the empty state. It also returns every
  in-window challenge with its at-risk flag, so the challenge grid under the
  strip marks the same ones.

Amounts are real dollars only; no value per point is ever computed here.
"""
from __future__ import annotations

from datetime import date, datetime

from core import benefits as BEN
from core.challenges_helpers import _challenge_spend_for_card
from core.serializers import _serialize_challenge
from database import Account, Card, CardProduct, PointsEcosystem, SpendChallenge

AT_RISK_DAYS = 30


def _d(v):
    return v.date() if isinstance(v, datetime) else v


def _product_for(acct: Account | None, card: Card | None, products: dict) -> CardProduct | None:
    pid = (acct.product_id if acct and acct.product_id else None) or (card.product_id if card else None)
    return products.get(pid) if pid else None


def _eco_id(prod: CardProduct | None, card: Card | None):
    return (prod.ecosystem_id if prod else None) or (card.ecosystem_id if card else None)


def wallet(db) -> list[dict]:
    """Open credit-card accounts, with the card's product, owner and program.
    A card marked closed (Card.is_active false) leaves the row."""
    products = {p.id: p for p in db.query(CardProduct).all()}
    ecos = {e.id: e for e in db.query(PointsEcosystem).all()}
    cards_by_acct = {}
    for c in db.query(Card).filter(Card.account_id.isnot(None)).all():
        # An account can carry an old closed row and a live one; the live one wins.
        prev = cards_by_acct.get(c.account_id)
        if prev is None or (c.is_active and not prev.is_active):
            cards_by_acct[c.account_id] = c
    out = []
    for a in db.query(Account).filter(Account.is_active.is_(True)).order_by(Account.id).all():
        if 'credit' not in (a.account_type or '').lower():
            continue
        c = cards_by_acct.get(a.id)
        if c is not None and c.is_active is False:
            continue
        prod = _product_for(a, c, products)
        eid = _eco_id(prod, c)
        eco = ecos.get(eid) if eid else None
        mask = a.mask or (f'{c.last_four:04d}' if c and c.last_four is not None else '')
        out.append({
            'account_id': a.id,
            'card_id': c.id if c else None,
            'name': prod.card_name if prod else (c.card_name if c and c.card_name else a.account_name),
            'account_name': a.account_name,
            'mask': mask,
            'owner': c.primary_user if c else None,
            'product_key': prod.product_key if prod else None,
            'ecosystem_id': eid,
            'ecosystem': eco.name if eco else None,
            'is_cash_back': bool(eco.is_cash_back) if eco else False,
        })
    return out


def _challenge_entry(db, ch, card: Card, prod, eid, today: date) -> dict:
    spend = _challenge_spend_for_card(db, ch, card.account_id) if card.account_id else None
    ser = _serialize_challenge(ch, spend_override=spend)
    ser.update({
        'card_name': card.card_name, 'last_four': card.last_four, 'account_id': card.account_id,
        'this_card_id': card.id, 'product_key': prod.product_key if prod else None,
        'ecosystem_id': eid, 'person': card.primary_user,
    })
    start = _d(ch.start_date)
    if ch.activation_date and _d(ch.activation_date) > start:
        start = _d(ch.activation_date)
    end = _d(ch.end_date)
    span = max(1, (end - start).days + 1)
    days = (end - today).days
    target = ser['progress_target']
    remaining = ser['remaining_spend']
    done = ser['status'] == 'unlocked' or (target is not None and not remaining)
    spent = ser['lap_spend'] if ser['lap_spend'] is not None else ser['current_spend']
    gone = min(1.0, max(0.0, ((today - start).days + 1) / span))
    behind = bool(target) and spent < target * gone
    ser.update({
        'days_left': days, 'span': span, 'done': done,
        'at_risk': bool(target) and not done and not ser.get('is_archived') and (days <= AT_RISK_DAYS or behind),
        'behind_pace': behind,
    })
    return ser


def challenges(db, today: date | None = None) -> list[dict]:
    """Every active challenge whose window includes today, one entry per card
    it counts on (per-card spend, as /api/cards/earn-summary shows them)."""
    today = today or BEN.today_()
    products = {p.id: p for p in db.query(CardProduct).all()}
    cards = {c.id: c for c in db.query(Card).all()}
    out = []
    for ch in db.query(SpendChallenge).filter(SpendChallenge.is_active.is_(True)).all():
        if _d(ch.end_date) < today or _d(ch.start_date) > today:
            continue
        for cid in [ch.card_id] + [lnk.card_id for lnk in ch.card_links]:
            card = cards.get(cid)
            if not card or card.is_active is False:
                continue
            prod = products.get(card.product_id) if card.product_id else None
            out.append(_challenge_entry(db, ch, card, prod, _eco_id(prod, card), today))
    out.sort(key=lambda x: (x['end_date'], x['name']))
    return out


def actions(db, ecosystem_id: int | None = None, today: date | None = None,
            within: int = BEN.EXPIRING_DAYS) -> dict:
    today = today or BEN.today_()
    products = {p.id: p for p in db.query(CardProduct).all()}
    accts = {a.id: a for a in db.query(Account).all()}
    cards = [c for c in db.query(Card).filter(Card.is_active.isnot(False), Card.product_id.isnot(None)).all()]
    info = {}
    for c in cards:
        a = accts.get(c.account_id)
        if a is not None and a.is_active is False:
            continue
        prod = _product_for(a, c, products)
        info[c.id] = {'card': c, 'prod': prod, 'eid': _eco_id(prod, c), 'acct': a}
    if ecosystem_id is not None:
        info = {k: v for k, v in info.items() if v['eid'] == ecosystem_id}
    pays = BEN.for_cards(db, [v['card'] for v in info.values()], today=today) if info else {}

    def head(v):
        c, a, prod = v['card'], v['acct'], v['prod']
        return {'card_id': c.id, 'account_id': c.account_id,
                'card_name': prod.card_name if prod else c.card_name,
                'last_four': (a.mask if a and a.mask else (f'{c.last_four:04d}' if c.last_four is not None else '')),
                'person': c.primary_user, 'product_key': prod.product_key if prod else None,
                'ecosystem_id': v['eid']}

    credits, later = [], []
    for cid, pay in pays.items():
        v = info[cid]
        for x in pay['benefits']:
            if not (x['periods'] and x['open'] and x['days_left'] is not None):
                continue
            span = (date.fromisoformat(x['end']) - date.fromisoformat(x['start'])).days + 1
            item = {**head(v), 'benefit_id': x['id'], 'name': x['name'], 'left': x['left'],
                    'end': x['end'], 'days': x['days_left'], 'span': span}
            (credits if x['days_left'] <= within else later).append(item)
    credits.sort(key=lambda x: (x['days'], -x['left']))
    later.sort(key=lambda x: (x['days'], -x['left']))

    chs = challenges(db, today=today)
    if ecosystem_id is not None:
        chs = [c for c in chs if c['ecosystem_id'] == ecosystem_id]
    risk = sorted([c for c in chs if c['at_risk']], key=lambda c: (c['days_left'], -(c['remaining_spend'] or 0)))
    return {
        'today': today.isoformat(), 'within': within,
        'credits': credits, 'credits_total': round(sum(x['left'] for x in credits), 2),
        'at_risk': risk, 'challenges': chs,
        'next': later[0] if later else None,
    }
