"""
Read-only dry run of the 2027 earning engine on real card transactions.

Scores a window of past rows (default 2026-09-01 to 2026-10-31) in memory as
if they were dated after the fresh start, and compares with the points the
old engine locked. Uses raw SQL inside a READ ONLY transaction, so it works
before the 2027 columns exist and can't write anything. Merchant rules come
from core/earn_rules_seed.py plus the taught rows in merchant_points_mappings.

Run from the project root:
    python3 docs/earning_dry_run.py [START END] [--card=<card id>]

Limits: these rows have no stored Plaid category, channel or country, so the
Plaid fallback, online-only and U.S.-only conditions can't fire; unknown
merchants are overcounted and foreign purchases are scored as domestic.
"""
import os
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from types import SimpleNamespace as NS

sys.path.insert(0, '.')
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv('.env')   # database.py never loads it; see PLAN.md data-integrity note

from core.earn_engine import (
    CardInfo, Selection, _CapState, _billing_cycle_key, _dollars, purchase_points,
    rules_from_spec, top_slots_by_cycle,
)
from core.earn_rules_seed import EARN_RULES, KNOWN_SELECTIONS, initial_merchant_rules
from core.merchant_classifier import EARNING_KINDS, Catalog, RuleIndex, classify_transaction, normalize

args = [a for a in sys.argv[1:] if not a.startswith('--')]
card_filter = next((int(a.split('=')[1]) for a in sys.argv[1:] if a.startswith('--card=')), None)
start = date.fromisoformat(args[0]) if len(args) > 1 else date(2026, 9, 1)
end = date.fromisoformat(args[1]) if len(args) > 1 else date(2026, 10, 31)

url = os.environ['DATABASE_URL'].replace('postgres://', 'postgresql://', 1)
engine = create_engine(url)
with engine.connect() as conn:
    conn.execute(text('SET TRANSACTION READ ONLY'))
    taught = [dict(r._mapping) for r in conn.execute(text(
        'SELECT m.id, m.merchant_pattern AS pattern, pc.name AS category '
        'FROM merchant_points_mappings m JOIN points_categories pc ON pc.id = m.points_category_id'))]
    cards = {r.id: r for r in conn.execute(text(
        'SELECT c.id, c.card_id, c.card_name, c.issuer, c.statement_close_day, c.issue_date, '
        'c.product_id AS card_pid, a.product_id AS acct_pid, cp.product_key '
        'FROM cards c LEFT JOIN accounts a ON a.id = c.account_id '
        'LEFT JOIN card_products cp ON cp.id = COALESCE(c.product_id, a.product_id)'))}
    rows = [r for r in conn.execute(text(
        'SELECT id, card_id, date, amount, action, description_raw, merchant_name, is_excluded, '
        'points_earn_override, points_earned, points_category '
        'FROM transactions WHERE card_id IS NOT NULL AND date >= :s AND date < :e + 1 '
        'ORDER BY card_id, date, id'), {'s': start, 'e': end})]
    conn.rollback()

index = RuleIndex.from_dicts(initial_merchant_rules(taught))
catalog = Catalog.from_seed()
by_card = defaultdict(list)
for r in rows:
    t = NS(id=r.id, card_id=r.card_id, date=r.date, amount=r.amount, action=r.action,
           description_raw=r.description_raw, merchant_name=r.merchant_name,
           is_excluded=bool(r.is_excluded), points_earn_override=r.points_earn_override,
           old_points=r.points_earned or 0, old_category=r.points_category,
           pfc_detailed=None, payment_channel=None, merchant_country=None, is_foreign=None,
           classification_source=None, txn_kind=None, brand=None, merchant_category=None,
           merchant_rule_id=None, points_earned=None, points_earn_rate=None)
    classify_transaction(t, index, catalog)
    by_card[r.card_id].append(t)

report_cards, kinds, unknown, gift = [], Counter(), Counter(), defaultdict(float)
diffs = []
no_link = []
for card_id, txns in by_card.items():
    c = cards[card_id]
    if not c.card_pid:
        no_link.append(c)
    spec = EARN_RULES.get(c.product_key)
    if not spec:
        report_cards.append((c, len(txns), sum(t.old_points for t in txns), None))
        continue
    rules = rules_from_spec(spec)
    # Known choices (Bilt's Groceries) start in 2027; the dry run applies them to the window.
    sels = [Selection(slot, cat, None, start, None) for key, slot, cat, _s in KNOWN_SELECTIONS if key == c.product_key]
    info = CardInfo(issuer=c.issuer, close_day=c.statement_close_day,
                    issue_date=c.issue_date.date() if c.issue_date else None, selections=sels)
    top = top_slots_by_cycle(txns, rules, info, catalog)
    caps = _CapState()
    for t in txns:
        d = t.date.date()
        kinds[t.txn_kind] += 1
        if t.points_earn_override is not None:
            t.points_earned = t.points_earn_override
        elif t.is_excluded or t.txn_kind not in EARNING_KINDS or not t.amount:
            t.points_earned = 0
        elif t.txn_kind == 'refund':
            match = [p for p in txns if p is not t and p.date <= t.date and (p.amount or 0) < 0
                     and abs(p.amount) >= abs(t.amount) - 0.005 and p.points_earn_rate is not None
                     and (normalize(p.merchant_name) == normalize(t.merchant_name) if t.merchant_name
                          else normalize(p.description_raw) == normalize(t.description_raw))
                     and (t.date - p.date).days <= 120]
            if match:
                rate = match[-1].points_earn_rate
            else:
                _p, rate = purchase_points(t, d, rules, info, catalog, None,
                                           top.get(_billing_cycle_key(d, info.close_day), frozenset()))
            t.points_earned, t.points_earn_rate = -(_dollars(t, info.issuer) * rate), rate
        else:
            t.points_earned, t.points_earn_rate = purchase_points(
                t, d, rules, info, catalog, caps, top.get(_billing_cycle_key(d, info.close_day), frozenset()))
        if t.txn_kind in EARNING_KINDS and not t.is_excluded and t.merchant_category is None:
            unknown[t.merchant_name or t.description_raw] += abs(t.amount)
        if t.merchant_category == 'Gift Cards':
            gift[c.card_name] += abs(t.amount)
        if abs((t.points_earned or 0) - t.old_points) >= 1 and card_filter in (None, card_id):
            diffs.append((abs((t.points_earned or 0) - t.old_points), c, t))
    report_cards.append((c, len(txns), sum(t.old_points for t in txns), sum(t.points_earned or 0 for t in txns)))

print(f'Dry run {start} to {end}: {len(rows)} card transactions on {len(by_card)} cards. Nothing written.\n')
print(f'{"Card":40}{"Rows":>6}{"Old pts":>10}{"2027 pts":>10}{"Change":>9}')
tot_old = tot_new = 0
for c, n, old, new in sorted(report_cards, key=lambda x: -x[1]):
    tot_old += old
    tot_new += new or 0
    label = f'{c.card_name} ({c.card_id})'[:39]
    flag = '' if c.card_pid else '  (card has no product link)'
    if new is None:
        print(f'{label:40}{n:>6}{old:>10,.0f}{"—":>10}{"":>9}  no 2027 earn rules{flag}')
    else:
        print(f'{label:40}{n:>6}{old:>10,.0f}{new:>10,.0f}{new - old:>+9,.0f}{flag}')
print(f'{"Total":40}{len(rows):>6}{tot_old:>10,.0f}{tot_new:>10,.0f}{tot_new - tot_old:>+9,.0f}\n')

print('Kinds:', ', '.join(f'{k} {v}' for k, v in kinds.most_common()))
share = sum(unknown.values())
print(f'\nUnknown merchant (base rate, review list): {sum(1 for _ in unknown)} merchants, ${share:,.0f} of spend')
for m, amt in unknown.most_common(15):
    print(f'  ${amt:>9,.2f}  {m}')
if gift:
    print('\nGift cards:', ', '.join(f'{k} ${v:,.0f}' for k, v in gift.items()))
print('\nLargest row changes (old → 2027):')
for delta, c, t in sorted(diffs, key=lambda x: -x[0])[:20 if card_filter is None else 60]:
    path = '>'.join(p for p in (t.merchant_category, t.brand) if p) or '?'
    print(f'  {t.date.date()} {c.card_name[:22]:22} {t.amount:>9,.2f}  {(t.merchant_name or t.description_raw)[:28]:28} '
          f'{t.txn_kind:9} {path[:24]:24} {t.old_points:>8,.0f} → {t.points_earned or 0:>8,.0f}')
