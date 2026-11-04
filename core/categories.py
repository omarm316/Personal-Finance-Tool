"""
core/categories.py — Omer's personal categories: lookups over the two-level
tree, the check every category write goes through, and the rename the
Settings editor runs.

Rows, splits, rules and budget targets store one name each, the most specific
one picked (a top level or a sub-category). The top level comes from
Category.parent_category. See STARTING_CATEGORY_TREE in database.py.
Points never read these categories.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import or_

from database import (
    BudgetTarget, CategorizationRule, Category, LOCKED_CATEGORIES,
    Transaction, TransactionSplit,
)

__all__ = [
    'LOCKED_CATEGORIES', 'parent_map', 'top_level', 'with_children', 'rollup',
    'active_names', 'check_category', 'known_or_unclassified', 'rename_category',
]


def parent_map(db) -> dict:
    """{name: top level's name, or None for a top level}, hidden ones included."""
    return {name: parent for name, parent in db.query(Category.name, Category.parent_category).all()}


def top_level(name: Optional[str], pmap: dict) -> Optional[str]:
    return pmap.get(name) or name


def with_children(name: str, pmap: dict) -> set:
    """The name plus its sub-categories, so filtering on a top level covers them."""
    return {name} | {child for child, parent in pmap.items() if parent == name}


def rollup(by_name: dict, pmap: dict) -> dict:
    """Sum {category: amount} up to {top level: amount}."""
    out = {}
    for name, amount in by_name.items():
        top = top_level(name, pmap)
        out[top] = round(out.get(top, 0) + amount, 2)
    return out


def active_names(db) -> list:
    """Active category names in display order."""
    return [name for (name,) in db.query(Category.name)
            .filter_by(is_active=True).order_by(Category.display_order, Category.name).all()]


def check_category(db, name: Optional[str]) -> Optional[str]:
    """For writes a person makes: an empty value clears the category; anything
    else must be an active category. Returns the name unchanged."""
    if not name:
        return name
    if db.query(Category.id).filter_by(name=name, is_active=True).first() is None:
        raise HTTPException(status_code=400,
                            detail=f"Unknown category '{name}' — add it in Settings > Categories")
    return name


def known_or_unclassified(name: Optional[str], names) -> Optional[str]:
    """For automatic writers (the AI, Plaid's category map), which may name a
    category Omer has since renamed or hidden: fall back to Unclassified.
    An empty value (Transfers) stays empty."""
    if not name or name in names:
        return name
    return 'Unclassified'


def rename_category(db, old: str, new: str) -> dict:
    """Point every use of `old` at `new`: transactions (automatic and manual
    category), splits, rules, budget targets and sub-categories' parent link.
    A budget target that collides with one already on `new` for the same
    month is added to it. Doesn't touch the Category rows or commit; never
    touches points (locked points don't depend on the personal category)."""
    counts = {
        'transactions': db.query(Transaction).filter(
            or_(Transaction.category_auto == old, Transaction.category_manual == old)).count(),
    }
    db.query(Transaction).filter(Transaction.category_auto == old).update(
        {Transaction.category_auto: new}, synchronize_session=False)
    db.query(Transaction).filter(Transaction.category_manual == old).update(
        {Transaction.category_manual: new}, synchronize_session=False)
    counts['splits'] = db.query(TransactionSplit).filter(TransactionSplit.category == old).update(
        {TransactionSplit.category: new}, synchronize_session=False)
    counts['rules'] = db.query(CategorizationRule).filter(CategorizationRule.set_category == old).update(
        {CategorizationRule.set_category: new}, synchronize_session=False)

    counts['budget_targets'] = 0
    for target in db.query(BudgetTarget).filter_by(category=old).all():
        existing = db.query(BudgetTarget).filter_by(year=target.year, month=target.month, category=new).first()
        if existing:
            existing.amount = round((existing.amount or 0) + (target.amount or 0), 2)
            db.delete(target)
        else:
            target.category = new
        counts['budget_targets'] += 1

    db.query(Category).filter(Category.parent_category == old).update(
        {Category.parent_category: new}, synchronize_session=False)
    db.flush()
    return counts
