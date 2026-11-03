"""
Read-only comparison of today's points engine against the proposed rules in
docs/cards-categorization-rules.md. Touches no database: it calls the real
infer_points_category() and compute_points_earn() on in-memory transactions.

Run from the project root:  python3 docs/categorization_engine_check.py
Not collected by pytest. "Expected" rates are prototype values from card terms.
"""
import sys
from types import SimpleNamespace as NS

sys.path.insert(0, '.')
from core.points_engine import infer_points_category, compute_points_earn

PARENTS = {'Alaska Airlines': 'Airlines', 'American Airlines': 'Airlines', 'Delta': 'Airlines', 'United': 'Airlines',
           'Amex Travel Hotels': 'Hotels', 'Hilton': 'Hotels', 'Hyatt': 'Hotels', 'IHG': 'Hotels', 'Marriott': 'Hotels',
           'Walmart': 'Groceries', 'Target': 'Groceries', 'Rideshare: Lyft': 'Ground Transportation',
           'Rideshare: Uber': 'Ground Transportation', 'Amazon': 'Online Shopping'}

# Today's catalog: base rate plus bonus-on-top, copied from card_product_rewards.
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

# Proposed rules: the rate a card pays at each level of the merchant path, most
# specific first. 'kind' values make non-purchases and rule types explicit.
RULES = {
    'Aspire': (3, {'Hotels>Hilton': 14, 'Airlines': 7, 'Car Rental': 7, 'Dining:US': 7}),
    'Platinum': (1, {'Airlines': 5, 'Portal>Amex Travel': 5}),
    'Biz Gold': (1, {'Portal>Amex Travel': 3, 'Dining:US': 'top2', 'Gas Stations': 'top2', 'Transit': 'top2'}),
    'Strata Prem': (1, {'Airlines': 3, 'Hotels': 3, 'Dining': 3, 'Groceries': 3, 'Gas Stations': 3}),
    'Sapphire Pref': (1, {'Portal>Chase Travel': 5, 'Dining': 3, 'Food Delivery': 3, 'Streaming': 3,
                          'Groceries:online': 3, 'Airlines': 2, 'Hotels': 2, 'Ground Transportation': 2}),
    'Freedom Flex': (1, {'Portal>Chase Travel': 5, 'Dining': 3, 'Drugstore': 3, 'Food Delivery': 3,
                         'rotating': 'Q'}),
    'Bilt Obsidian': (1, {'Groceries': '3 to cap', 'Airlines': 2, 'Hotels': 2}),
}


def proposed(card, path, kind='purchase', foreign=False, online=False):
    """Rate under the proposed rules. Walks the merchant path from most to least specific."""
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


# (label, description, merchant, amount, proposed merchant path, options)
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
    ('U.S. supermarket', 'KINGS #3626', 'Kings', -100, 'Groceries', {}),
    ('Instacart', 'INSTACART', 'Instacart', -100, 'Groceries', {'online': True}),
    ('U.S. restaurant, unknown name', 'TST* CITY BISTRO', 'City Bistro', -100, 'Dining', {}),
    ('Foreign restaurant', 'MINENE ramat hashar', None, -100, 'Dining', {'foreign': True}),
    ('DoorDash food', 'DD *DOORDASH', 'DoorDash', -100, 'Food Delivery', {}),
    ('DoorDash gift card', 'DD *DOORDASH GIFTCARDS', 'DoorDash', -100, 'Gift Cards', {}),
    ('Giftcards.com', 'BHN*GIFTCARDS.COM', 'Giftcards.com', -100, 'Gift Cards', {}),
    ('CVS', 'CVS', 'CVS', -100, 'Drugstore', {}),
    ('Amazon', 'AMAZON', 'Amazon', -100, 'Online Shopping>Amazon', {}),
    ('Uber ride', 'UBER TRIP', 'Uber', -100, 'Ground Transportation>Uber', {}),
    ('Annual fee', 'ANNUAL MEMBERSHIP FEE', None, -100, '-', {'kind': 'non_earning'}),
    ('Interest charge', 'INTEREST CHARGE ON PURCHASES', None, -100, '-', {'kind': 'non_earning'}),
    ('Merchant offer credit', 'MERCHANT OFFERS CREDIT', None, 100, '-', {'kind': 'non_earning'}),
    ('Annual fee refund', 'ANNUAL FEE REFUND', None, 100, '-', {'kind': 'non_earning'}),
]


def fmt(x):
    if x is None:
        return '-'
    return f'{x:g}' if isinstance(x, (int, float)) else str(x)


rows, mismatches, total = [], 0, 0
for label, desc, merchant, amount, path, opts in SCENARIOS:
    csc = infer_points_category(merchant, description=desc)
    for card, (issuer, base, bonus) in CATALOG.items():
        if path == 'Portal>Amex Travel' and issuer != 'AMEX' or path == 'Portal>Chase Travel' and issuer != 'CHASE':
            continue  # a card can't be charged through another issuer's portal
        t = NS(points_earn_override=None, is_excluded=False, action='Expense', description_raw=desc,
               points_category=csc, amount=amount)
        now = compute_points_earn(t, base, bonus, PARENTS, issuer)
        now_rate = abs(now['points']) / abs(amount)
        want = proposed(card, path, **opts)
        same = isinstance(want, (int, float)) and abs(want - now_rate) < 1e-9
        stateful = not isinstance(want, (int, float))
        total += 1
        mismatches += (not same and not stateful)
        rows.append((label, csc, card, now_rate, want, 'state' if stateful else ('ok' if same else 'DIFF')))

print(f'{total} combinations, {mismatches} differ, {sum(r[5] == "state" for r in rows)} depend on running totals\n')
print(f'{"Scenario":32}{"Today category":24}{"Card":15}{"Today":>6}{"Rule":>10}  Result')
for label, csc, card, now_rate, want, res in rows:
    if res != 'ok':
        print(f'{label:32}{str(csc):24}{card:15}{fmt(now_rate):>6}{fmt(want):>10}  {res}')
