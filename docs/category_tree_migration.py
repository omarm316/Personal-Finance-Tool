"""
One-time move of Omer's categories onto the two-level tree (agreed 2026-11-03;
see PLAN.md, session "Two-level personal categories").

Dry run by default: everything happens inside one transaction, the changes are
printed, then rolled back. `--apply` commits the same transaction.

    python3 docs/category_tree_migration.py            # dry run
    python3 docs/category_tree_migration.py --apply    # write

What it does, in order:
1. Renames that carry rows, splits, rules and budget targets with them
   (Home -> Home Maintenance, plus three stray old names).
2. Sets up the tree from STARTING_CATEGORY_TREE (creates, re-parents,
   re-activates) and hides active categories that aren't in it (Insurance).
3. Moves rows and rules into the new sub-categories by merchant (MOVES).
   Both the automatic and the manual category move: each move stays inside
   the category Omer picked, it only gets more specific.
4. Moves the Insurance budget to Auto Insurance.
5. Points the six For Others marker rules at the For Others category and
   drops the retired is_for_others marker from their notes.
6. Adds Expedia as a brand with a merchant rule (merchant path: Travel).

Never touches points: they come from the merchant path, not these categories.
"""
import argparse
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from dotenv import load_dotenv  # noqa: E402
load_dotenv(os.path.join(ROOT, '.env'))   # database.py never loads it; see PLAN.md

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from database import (  # noqa: E402
    STARTING_CATEGORY_TREE, Brand, CategorizationRule, Category, MerchantCategory,
    MerchantRule, Transaction,
)
from core.categories import rename_category  # noqa: E402

RENAMES = [
    ('Home', 'Home Maintenance'),
    ('Expense', 'Fees & Interest'),                       # one paper statement fee
    ('Unrealized Gain/Loss', 'Investment Gain (Loss)'),
    ('Fees and Interest', 'Fees & Interest'),             # two old splits
]

# (from, to, pattern on merchant name + descriptions in upper case[, exclude]).
# The first entry that matches a row's category wins. Rows that match nothing
# stay on their category, so odd ones stay visible on the top level.
MOVES = [
    ('Insurance', 'Auto Insurance', r'GEICO'),
    ('Insurance', 'Home Insurance', r'CONDO'),

    ('Transportation', 'Food Delivery', r'UBER ?EATS'),
    ('Transportation', 'Licensing', r'\bMVC\b|MOTOR VEHICLE'),
    ('Transportation', 'Gas', r'\bSHELL\b|CHEVRON|EXXON|TEXACO|\bBP\b|PAZ OIL|TRUCK STOP|COSTCO GAS|SUNOCO'),
    ('Transportation', 'Ground Transportation', r'LYFT|\bUBER\b|TRANSIT|\bMTA\b|E-?Z ?PASS|TAXI|PARK|GARAGE|TOLL|'
                                                r'PASSNY|PAYGO|\bPATH\b|FERRY|WATERWAY|RIDESHARE|\bNJT\b|GGMC|PLATEPASS|'
                                                r'AMERICAN DREAM|HOBOKEN MUNICIPALITY|NAP RIDGE HILL|PMUSA'),

    ('Vehicle', 'Maintenance', r'MERCEDES|TIRE|SPLASH'),

    ('Travel', 'Travel Agencies', r'AMEXTRAVEL|AMEX TRAVEL|EXPEDIA|CHASE TRAVEL|TRAVEL\.CHASE|'
                                  r'CAPITAL ?ONE TRAVEL|CITI ?TRAVEL|BILT TRAVEL|BOOKING\.COM|HOTELS\.COM|PRICELINE'),
    ('Travel', 'Car Rental', r'\bSIXT\b|HERTZ|\bAVIS\b|\bENTERPRISE\b|RENT ?A[ -]?CAR|CAR RENTAL|ALAMO|BUDGET RENT'),
    ('Travel', 'Airlines', r'AIRLINE|AIR LINES|AIRWAYS|\bUNITED\b|\bDELTA\b|ALASKA AIR|AIR CANADA|AIR FRANCE|'
                           r'\bEL AL\b|JETBLUE|SOUTHWEST|LUFTHANSA|ISRAIR'),
    ('Travel', 'Hotels', r'HILTON|CONRAD|WALDORF|HYATT|ANDAZ|MARRIOTT|RITZ|EDITION|TAMPA EDIT|THOMPSON|'
                         r'GRAND WAILEA|SWIFTWATER|WESTIN|SHERATON|FOUR SEASONS|HOLIDAY INN|\bHOTEL'),

    # DoorDash gift cards (GIFTCARSAN, DOORDASHG) are gift-card buys, not delivery
    ('Dining', 'Food Delivery', r'DOORDASH|DOORDASAN|UBER ?EATS|GRUBHUB|SEAMLESS|POSTMATES', r'GIFT|DOORDASHG'),

    ('Other', 'Licensing', r'\bMVC\b|MOTOR VEHICLE'),
    ('Other', 'For Others', r'NATIONAL INSURANCE'),

    ('Unclassified', 'Travel Agencies', r'AMEXTRAVEL'),
]
MOVES = [(m[0], m[1], re.compile(m[2]), re.compile(m[3]) if len(m) > 3 else None) for m in MOVES]

BUDGET_MOVES = [('Insurance', 'Auto Insurance')]

FOR_OTHERS_MARKER = 'for_others:true'
# Marker rules not pointed at For Others, with the reason (printed).
FOR_OTHERS_SKIP = {}


def _move_for(category, text):
    for src, dst, pattern, exclude in MOVES:
        if src == category and pattern.search(text) and not (exclude and exclude.search(text)):
            return dst
    return None


def _label(t):
    return (t.merchant_name or t.description_clean or t.description_raw or '')[:40]


def run(db):
    report = []
    say = report.append

    # 1. Renames
    say('== 1. Renames')
    for old, new in RENAMES:
        counts = rename_category(db, old, new)
        old_row = db.query(Category).filter_by(name=old).first()
        if old_row and not db.query(Category).filter_by(name=new).first():
            old_row.name = new
            note = 'category row renamed'
        else:
            note = 'old row left as is' if old_row else 'no category row'
        db.flush()
        say(f'  {old} -> {new}: {counts} ({note})')

    # 2. Tree
    say('== 2. Category tree')
    in_tree = set()
    for order, (name, parent, cat_type) in enumerate(STARTING_CATEGORY_TREE, start=1):
        in_tree.add(name)
        row = db.query(Category).filter_by(name=name).first()
        if not row:
            db.add(Category(name=name, parent_category=parent, category_type=cat_type,
                            display_order=order, is_active=True))
            say(f'  created   {name}' + (f' (under {parent})' if parent else ' (top level)'))
            continue
        changes = []
        if row.parent_category != parent:
            changes.append(f'parent {row.parent_category} -> {parent}')
            row.parent_category = parent
        if row.category_type != cat_type:
            changes.append(f'type {row.category_type} -> {cat_type}')
            row.category_type = cat_type
        if not row.is_active:
            changes.append('re-activated')
            row.is_active = True
        row.display_order = order
        if changes:
            say(f'  updated   {name}: ' + ', '.join(changes))
    for row in db.query(Category).filter_by(is_active=True).all():
        if row.name not in in_tree:
            row.is_active = False
            say(f'  hidden    {row.name} (not in the tree)')
    db.flush()

    # 3. Rows and rules by merchant
    say('== 3. Transactions moved by merchant (from -> to: rows; merchants)')
    moved = defaultdict(Counter)
    auto_only = Counter()   # automatic category moved under a different manual choice
    for t in db.query(Transaction).all():
        text = ' '.join(filter(None, [t.merchant_name, t.description_clean, t.description_raw])).upper()
        final = t.category_manual or t.category_auto
        for col in ('category_auto', 'category_manual'):
            src = getattr(t, col)
            dst = _move_for(src, text)
            if not dst:
                continue
            if src == final and (col == 'category_manual' or not t.category_manual):
                moved[(src, dst)][_label(t)] += 1
            elif col == 'category_auto':
                auto_only[(src, dst)] += 1
            setattr(t, col, dst)
    for (src, dst), merchants in sorted(moved.items()):
        total = sum(merchants.values())
        listing = ', '.join(f'{m} x{n}' if n > 1 else m for m, n in merchants.most_common())
        say(f'  {src} -> {dst}: {total} rows; {listing}')
    for (src, dst), n in sorted(auto_only.items()):
        say(f'  (automatic category only, a manual one wins) {src} -> {dst}: {n} rows')

    say('== 3b. Categorization rules re-pointed (from -> to: patterns)')
    repointed = defaultdict(list)
    for r in db.query(CategorizationRule).all():
        dst = _move_for(r.set_category, (r.pattern or '').upper())
        if dst:
            repointed[(r.set_category, dst)].append(r.pattern + ('' if r.is_active else ' (inactive)'))
            r.set_category = dst
    for (src, dst), patterns in sorted(repointed.items()):
        say(f'  {src} -> {dst}: {len(patterns)}; ' + ', '.join(patterns))
    db.flush()

    # 4. Budgets
    say('== 4. Budget targets')
    for old, new in BUDGET_MOVES:
        counts = rename_category(db, old, new)
        say(f'  {old} -> {new}: {counts}')

    # 5. For Others marker rules
    say('== 5. For Others marker rules')
    for r in db.query(CategorizationRule).filter(CategorizationRule.notes.ilike(f'%{FOR_OTHERS_MARKER}%')).all():
        notes = re.sub(r'[,;]?\s*' + re.escape(FOR_OTHERS_MARKER), '', r.notes or '').strip(' ,;') or None
        if r.pattern in FOR_OTHERS_SKIP:
            say(f'  {r.pattern}: marker dropped, category left at {r.set_category} ({FOR_OTHERS_SKIP[r.pattern]})')
        else:
            say(f'  {r.pattern} ({r.match_type}, priority {r.priority}): {r.set_category} -> For Others')
            r.set_category = 'For Others'
        r.notes = notes

    # 6. Expedia
    say('== 6. Expedia brand and merchant rule')
    travel = db.query(MerchantCategory).filter_by(name='Travel').first()
    brand = db.query(Brand).filter_by(name='Expedia').first()
    if not brand:
        brand = Brand(name='Expedia', default_category_id=travel.id if travel else None)
        db.add(brand)
        db.flush()
        say('  brand Expedia added (merchant category Travel)')
    if not db.query(MerchantRule).filter(MerchantRule.pattern.ilike('expedia')).first():
        db.add(MerchantRule(pattern='EXPEDIA', match_type='word',
                            merchant_category_id=travel.id if travel else None, brand_id=brand.id,
                            source='taught', is_active=True,
                            notes='Added 2026-11-03: third-party agency, so portal and book-direct rates do not apply'))
        say('  merchant rule EXPEDIA -> Travel, brand Expedia')
    db.flush()
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='commit (default: dry run, rolled back)')
    args = ap.parse_args()
    url = os.environ['DATABASE_URL'].replace('postgres://', 'postgresql://', 1)
    db = sessionmaker(bind=create_engine(url))()
    try:
        report = run(db)
        print('\n'.join(report))
        if args.apply:
            db.commit()
            print('\nAPPLIED.')
        else:
            db.rollback()
            print('\nDry run: rolled back, nothing written.')
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == '__main__':
    main()
