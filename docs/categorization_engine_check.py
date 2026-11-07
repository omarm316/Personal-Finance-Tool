"""
Read-only comparison of the old points engine, the 2027 engine and the agreed
rules in docs/cards-categorization-rules.md. Touches no database: it runs the
real classifiers and rate functions on in-memory transactions, with the 2027
engine reading its starting merchant rule list and earn rules from
core/earn_rules_seed.py.

Run from the project root:  python3 docs/categorization_engine_check.py [--all]
--all also lists the rows where the old engine differs.
Not collected by pytest. "Expected" rates are prototype values from card terms.
"""
import sys
from datetime import date
from types import SimpleNamespace as NS

sys.path.insert(0, '.')
from core.points_engine import infer_points_category, compute_points_earn
from core.merchant_classifier import EARNING_KINDS, Catalog, RuleIndex, classify_transaction
from core.earn_rules_seed import EARN_RULES, initial_merchant_rules
from core.earn_engine import CardInfo, Selection, _CapState, purchase_points, rules_from_spec

PARENTS = {'Alaska Airlines': 'Airlines', 'American Airlines': 'Airlines', 'Delta': 'Airlines', 'United': 'Airlines',
           'Amex Travel Hotels': 'Hotels', 'Hilton': 'Hotels', 'Hyatt': 'Hotels', 'IHG': 'Hotels', 'Marriott': 'Hotels',
           'Walmart': 'Groceries', 'Target': 'Groceries', 'Rideshare: Lyft': 'Ground Transportation',
           'Rideshare: Uber': 'Ground Transportation', 'Amazon': 'Online Shopping'}

# Old catalog: base rate plus bonus-on-top, copied from card_product_rewards.
CATALOG = {
    'Aspire': ('AMEX', 3, {'Airlines': 4, 'Car Rental': 4, 'Dining': 4, 'Hilton': 11}),
    'Platinum': ('AMEX', 1, {'Airlines': 4, 'Amex Travel Hotels': 4}),
    'Biz Gold': ('AMEX', 1, {}),
    'Strata Prem': ('CITI', 1, {'Airlines': 2, 'Dining': 2, 'Gas Stations': 2, 'Groceries': 2, 'Hotels': 2}),
    'Sapphire Pref': ('CHASE', 1, {'Airlines': 1, 'Car Rental': 1, 'Chase Travel': 4, 'Dining': 2, 'Food Delivery': 2,
                                   'Groceries': 2, 'Ground Transportation': 1, 'Hotels': 1, 'Rideshare: Lyft': 4,
                                   'Streaming': 2, 'Transit': 1, 'Travel': 1}),
    'Freedom Flex': ('CHASE', 1, {'Dining': 2, 'Drugstore': 2, 'Food Delivery': 2}),
    'Bilt Obsidian': ('BILT', 1, {'Airlines': 1, 'Car Rental': 1, 'Groceries': 2, 'Hotels': 1, 'Travel': 1}),
}
PRODUCT_KEYS = {'Aspire': 'hilton_aspire', 'Platinum': 'amex_platinum', 'Biz Gold': 'amex_business_gold',
                'Strata Prem': 'citi_strata_premier', 'Sapphire Pref': 'chase_sapphire_preferred',
                'Freedom Flex': 'chase_freedom_flex', 'Bilt Obsidian': 'bilt_obsidian'}
# Bilt's chosen category (Omer, confirmed); no Freedom Flex quarter is set.
SELECTIONS = {'Bilt Obsidian': [Selection('choice', 'Groceries', None, date(2027, 1, 1), None)]}

# Agreed rules: the rate a card pays at each level of the merchant path, most
# specific first. Written by hand from card terms, independent of the seed.
RULES = {
    'Aspire': (3, {'Hotels>Hilton': 14, 'Airlines': 7, 'Car Rental': 7, 'Dining:US': 7}),
    'Platinum': (1, {'Airlines': 5, 'Portal>Amex Travel': 5}),
    'Biz Gold': (1, {'Portal>Amex Travel': 3, 'Dining:US': 'top2', 'Gas Stations': 'top2', 'Transit': 'top2'}),
    'Strata Prem': (1, {'Airlines': 3, 'Hotels': 3, 'Dining': 3, 'Groceries': 3, 'Gas Stations': 3}),
    'Sapphire Pref': (1, {'Portal>Chase Travel': 5, 'Dining': 3, 'Streaming': 3, 'Gas Stations': 3,
                          'Groceries:online': 3, 'Airlines': 2, 'Hotels': 2, 'Transit': 2}),
    'Freedom Flex': (1, {'Portal>Chase Travel': 5, 'Dining': 3, 'Drugstores': 3, 'rotating': 'Q'}),
    'Bilt Obsidian': (1, {'Groceries': '3 to cap', 'Airlines': 2, 'Hotels': 2}),
}


def proposed(card, path, kind='purchase', foreign=False, online=False, pfc=None):
    """Rate under the agreed rules. Walks the merchant path from most to least specific."""
    if kind == 'non_earning':
        return 0
    base, rules = RULES[card]
    parts = path.split('>')
    for i in range(len(parts), 0, -1):
        key = '>'.join(parts[:i])
        if key in rules:
            return rules[key]
        if key + ':US' in rules and not foreign:
            return rules[key + ':US']
        if key + ':online' in rules and online:
            return rules[key + ':online']
    return base


# (label, description, merchant, amount, agreed merchant path, options).
# 'pfc' is the Plaid category the row would carry; paths use the 2027 tree.
SCENARIOS = [
    ('Hilton stay', 'CONRAD FT LAUDERDALE', 'Conrad Ft', -100, 'Hotels>Hilton', {}),
    ('Marriott, no merchant name', 'W Hoboken', None, -100, 'Hotels>Marriott', {}),
    ('Amex Travel hotel', 'AMEX Fine Hotels andAmexTravel.com', None, -100, 'Portal>Amex Travel', {}),
    ('Chase Travel booking', 'CHASE TRAVEL 800', None, -100, 'Portal>Chase Travel', {}),
    ('United direct', 'United Airlines', 'United Airlines', -100, 'Airlines>United', {}),
    ('Foreign airline', 'EL AL NATBAG', 'El Al Natbag', -100, 'Airlines', {'foreign': True}),
    ('Walmart', 'WALMART', 'Walmart', -100, 'Superstores>Walmart', {}),
    ('Target', 'TARGET', 'Target', -100, 'Superstores>Target', {}),
    ('Costco', 'COSTCO WHSE', 'Costco', -100, 'Wholesale Clubs>Costco', {}),
    ('Costco gas', 'COSTCO GAS #1234', 'Costco Gas', -100, 'Gas Stations', {}),
    ('U.S. supermarket', 'KINGS #3626', 'Kings', -100, 'Groceries', {}),
    ('Instacart', 'INSTACART', 'Instacart', -100, 'Groceries', {'online': True}),
    ('U.S. restaurant, unknown name', 'TST* CITY BISTRO', 'City Bistro', -100, 'Dining',
     {'pfc': 'FOOD_AND_DRINK_RESTAURANT'}),
    ('Foreign restaurant', 'MINENE ramat hashar', None, -100, 'Dining',
     {'foreign': True, 'pfc': 'FOOD_AND_DRINK_RESTAURANT'}),
    ('DoorDash food', 'DD *DOORDASH', 'DoorDash', -100, 'Dining>DoorDash', {}),   # delivery is dining
    ('Uber Eats food', 'UBER EATS', 'Uber Eats', -100, 'Dining>Uber Eats', {}),
    ('DoorDash gift card', 'DD *DOORDASH GIFTCARDS', 'DoorDash', -100, 'Gift Cards', {}),
    ('Giftcards.com', 'BHN*GIFTCARDS.COM', 'Giftcards.com', -100, 'Gift Cards', {}),
    ('CVS', 'CVS', 'CVS', -100, 'Drugstores', {}),
    ('Amazon', 'AMAZON', 'Amazon', -100, 'Online Shopping>Amazon', {}),
    ('Uber ride', 'UBER TRIP', 'Uber', -100, 'Transit>Uber', {}),
    ('Parking (rule 15)', 'LAZ PARKING 123', 'LAZ Parking', -100, 'Transit', {}),
    ('Annual fee', 'ANNUAL MEMBERSHIP FEE', None, -100, '-', {'kind': 'non_earning'}),
    ('Interest charge', 'INTEREST CHARGE ON PURCHASES', None, -100, '-', {'kind': 'non_earning'}),
    ('Late fee', 'LATE FEE', None, -29, '-', {'kind': 'non_earning'}),
    ('Merchant offer credit', 'MERCHANT OFFERS CREDIT', None, 100, '-', {'kind': 'non_earning'}),
    ('Annual fee refund', 'ANNUAL FEE REFUND', None, 100, '-', {'kind': 'non_earning'}),
    ('Interest refund', 'INTEREST CHARGE REFUND', None, 2, '-', {'kind': 'non_earning'}),
    ('Bookkeeping line', 'OFFER 05 MOVED TO STANDARD PURCH', 'Moved', -1210, '-', {'kind': 'non_earning'}),
    ('Card payment', 'MOBILE PAYMENT - THANK YOU', None, 500, '-', {'kind': 'non_earning'}),
    ('Venmo on a card', 'VENMO *JOHN', 'Venmo', -50, '-', {'kind': 'non_earning'}),
]

INDEX = RuleIndex.from_dicts(initial_merchant_rules())
CAT = Catalog.from_seed()
CHECK_DATE = date(2027, 1, 15)


def fmt(x):
    if x is None:
        return '-'
    return f'{x:g}' if isinstance(x, (int, float)) else str(x)


def new_engine(card, desc, merchant, amount, opts):
    """(rate, path, kind) from the 2027 classifier and engine. Top-category
    rules are scored as if the category won its cycle, caps as if unused."""
    t = NS(merchant_name=merchant, description_raw=desc, amount=amount, action='Expense',
           pfc_detailed=opts.get('pfc'), payment_channel='online' if opts.get('online') else 'in store',
           merchant_country='IL' if opts.get('foreign') else 'US', classification_source=None,
           is_foreign=None, txn_kind=None, brand=None, merchant_category=None, merchant_rule_id=None,
           is_excluded=False, points_earn_override=None)
    classify_transaction(t, INDEX, CAT)
    path = '>'.join(p for p in (t.merchant_category, t.brand) if p) or '-'
    if t.txn_kind not in EARNING_KINDS:
        return 0, path, t.txn_kind
    issuer = CATALOG[card][0]
    rules = rules_from_spec(EARN_RULES[PRODUCT_KEYS[card]])
    info = CardInfo(issuer=issuer, close_day=None, issue_date=None, selections=SELECTIONS.get(card, []))
    all_slots = frozenset(r.slot or r.category for r in rules if r.rule_type == 'top_n')
    _pts, rate = purchase_points(t, CHECK_DATE, rules, info, CAT, _CapState(), all_slots)
    return rate, path, t.txn_kind


def path_matches(expected, got):
    if expected == '-':
        return True
    if expected == got:
        return True
    return '>' not in expected and got.split('>')[0] == expected


rows, total = [], 0
old_diff = new_diff = stateful = path_diff = 0
for label, desc, merchant, amount, path, opts in SCENARIOS:
    csc = infer_points_category(merchant, description=desc)
    for card, (issuer, base, bonus) in CATALOG.items():
        if path == 'Portal>Amex Travel' and issuer != 'AMEX' or path == 'Portal>Chase Travel' and issuer != 'CHASE':
            continue  # a card can't be charged through another issuer's portal
        t = NS(points_earn_override=None, is_excluded=False, action='Expense', description_raw=desc,
               points_category=csc, amount=amount)
        old = compute_points_earn(t, base, bonus, PARENTS, issuer)
        old_rate = abs(old['points']) / abs(amount)
        want = proposed(card, path, **opts)
        new_rate, new_path, kind = new_engine(card, desc, merchant, amount, opts)
        total += 1
        if not isinstance(want, (int, float)):
            stateful += 1
            res_old = res_new = 'state'
        else:
            res_old = 'ok' if abs(want - old_rate) < 1e-9 else 'DIFF'
            res_new = 'ok' if abs(want - new_rate) < 1e-9 else 'DIFF'
            old_diff += res_old == 'DIFF'
            new_diff += res_new == 'DIFF'
        pm = path_matches(path, new_path)
        path_diff += not pm
        rows.append((label, csc, new_path, kind, card, old_rate, new_rate, want, res_old, res_new, pm))

fixed = total - stateful
print(f'{total} combinations ({fixed} fixed-rate, {stateful} depend on running totals)')
print(f'  old engine: {fixed - old_diff} of {fixed} match the agreed rates, {old_diff} differ')
print(f'  2027 engine: {fixed - new_diff} of {fixed} match, {new_diff} differ; '
      f'{path_diff} merchant paths differ from the agreed path\n')

show_all = '--all' in sys.argv
print(f'{"Scenario":32}{"2027 path":26}{"Kind":10}{"Card":15}{"Old":>6}{"2027":>6}{"Rule":>10}  Result')
for label, csc, new_path, kind, card, old_rate, new_rate, want, res_old, res_new, pm in rows:
    if res_new != 'ok' or not pm or (show_all and res_old != 'ok'):
        result = res_new if pm else f'{res_new}, PATH'
        print(f'{label:32}{new_path:26}{kind:10}{card:15}{fmt(old_rate):>6}{fmt(new_rate):>6}{fmt(want):>10}  {result}')
