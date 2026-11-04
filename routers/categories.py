"""
routers/categories.py — Omer's personal category tree: the list every picker
reads, and the Settings > Categories editor (add, rename, move, reorder, hide,
merge, delete). Two levels only: a top level and its sub-categories.

A rename or merge rewrites every use of the name (transactions, splits, rules,
budget targets) through core.categories.rename_category. Points are never
touched: they come from the merchant path, not from these categories.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from database import (
    get_db, BudgetTarget, CategorizationRule, Category, Transaction, TransactionSplit,
)
from core.categories import LOCKED_CATEGORIES, rename_category

router = APIRouter()

CATEGORY_TYPES = ('expense', 'income', 'both')


class CategoryCreate(BaseModel):
    name: str
    parent_category: Optional[str] = None   # None = a new top level
    category_type: str = 'expense'


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_category: Optional[str] = None   # '' = make it a top level
    category_type: Optional[str] = None
    is_active: Optional[bool] = None


class CategoryMerge(BaseModel):
    into: str


class CategoryOrder(BaseModel):
    names: List[str]


def _category_dict(c: Category) -> dict:
    return {
        'id': c.id, 'name': c.name, 'category_type': c.category_type,
        'parent_category': c.parent_category, 'display_order': c.display_order,
        'is_active': bool(c.is_active), 'is_locked': c.name in LOCKED_CATEGORIES,
    }


def _get(db, category_id: int) -> Category:
    cat = db.query(Category).filter_by(id=category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat


def _clean_name(db, name: Optional[str], exclude_id: Optional[int] = None) -> str:
    name = (name or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail="A category needs a name")
    if len(name) > 100:
        raise HTTPException(status_code=400, detail="Category names are at most 100 characters")
    clash = db.query(Category).filter(func.lower(Category.name) == name.lower())
    if exclude_id is not None:
        clash = clash.filter(Category.id != exclude_id)
    if clash.first():
        raise HTTPException(status_code=400, detail=f"'{name}' already exists (names are unique across the tree)")
    return name


def _check_parent(db, parent: str, moving: Optional[Category] = None) -> str:
    top = db.query(Category).filter_by(name=parent, is_active=True).first()
    if not top or top.parent_category:
        raise HTTPException(status_code=400, detail=f"'{parent}' is not an active top level")
    if moving is not None:
        if moving.name == parent:
            raise HTTPException(status_code=400, detail="A category can't sit under itself")
        if db.query(Category.id).filter_by(parent_category=moving.name).first():
            raise HTTPException(status_code=400,
                                detail=f"'{moving.name}' has sub-categories; move them first (two levels only)")
    return parent


def _check_unlocked(cat: Category):
    if cat.name in LOCKED_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"'{cat.name}' is locked: the app relies on this name")


@router.get("/api/categories")
async def get_categories(db: Session = Depends(get_db)):
    """Active categories in display order, each with its top level (if any)."""
    cats = db.query(Category).filter_by(is_active=True).order_by(Category.display_order, Category.name).all()
    return [_category_dict(c) for c in cats]


@router.get("/api/categories/manage")
async def manage_categories(db: Session = Depends(get_db)):
    """Every category, hidden ones included, with how often each is used, for
    the Settings editor. Transaction counts use the final category (a manual
    choice wins over the automatic one), like everywhere else."""
    final = case(
        (func.coalesce(Transaction.category_manual, '') != '', Transaction.category_manual),
        else_=Transaction.category_auto,
    )
    txn_counts = dict(db.query(final, func.count(Transaction.id)).group_by(final).all())
    split_counts = dict(db.query(TransactionSplit.category, func.count(TransactionSplit.id))
                        .group_by(TransactionSplit.category).all())
    rule_counts = dict(db.query(CategorizationRule.set_category, func.count(CategorizationRule.id))
                       .filter(CategorizationRule.is_active == True)  # noqa: E712
                       .group_by(CategorizationRule.set_category).all())
    budget_counts = dict(db.query(BudgetTarget.category, func.count(BudgetTarget.id))
                         .group_by(BudgetTarget.category).all())
    out = []
    for c in db.query(Category).order_by(Category.display_order, Category.name).all():
        d = _category_dict(c)
        d.update({
            'transactions': txn_counts.get(c.name, 0), 'splits': split_counts.get(c.name, 0),
            'rules': rule_counts.get(c.name, 0), 'budget_targets': budget_counts.get(c.name, 0),
        })
        out.append(d)
    return out


@router.post("/api/categories")
async def create_category(body: CategoryCreate, db: Session = Depends(get_db)):
    name = _clean_name(db, body.name)
    parent = _check_parent(db, body.parent_category) if body.parent_category else None
    if body.category_type not in CATEGORY_TYPES:
        raise HTTPException(status_code=400, detail=f"Type must be one of {', '.join(CATEGORY_TYPES)}")
    last = db.query(func.max(Category.display_order)).scalar() or 0
    cat = Category(name=name, parent_category=parent, category_type=body.category_type,
                   display_order=last + 1, is_active=True)
    db.add(cat)
    db.commit()
    return _category_dict(cat)


@router.patch("/api/categories/{category_id}")
async def update_category(category_id: int, body: CategoryUpdate, db: Session = Depends(get_db)):
    cat = _get(db, category_id)
    renamed = None

    if body.name is not None and body.name.strip() != cat.name:
        _check_unlocked(cat)
        new = _clean_name(db, body.name, exclude_id=cat.id)
        renamed = rename_category(db, cat.name, new)
        cat.name = new

    if body.parent_category is not None and (body.parent_category or None) != cat.parent_category:
        _check_unlocked(cat)
        cat.parent_category = _check_parent(db, body.parent_category, moving=cat) if body.parent_category else None

    if body.category_type is not None and body.category_type != cat.category_type:
        _check_unlocked(cat)
        if body.category_type not in CATEGORY_TYPES:
            raise HTTPException(status_code=400, detail=f"Type must be one of {', '.join(CATEGORY_TYPES)}")
        cat.category_type = body.category_type

    if body.is_active is not None and body.is_active != bool(cat.is_active):
        _check_unlocked(cat)
        if body.is_active and cat.parent_category:
            _check_parent(db, cat.parent_category)   # its top level must be active too
        if not body.is_active and db.query(Category.id).filter_by(parent_category=cat.name, is_active=True).first():
            raise HTTPException(status_code=400,
                                detail=f"'{cat.name}' has active sub-categories; hide or move them first")
        cat.is_active = body.is_active

    db.commit()
    out = _category_dict(cat)
    if renamed is not None:
        out['renamed'] = renamed
    return out


@router.post("/api/categories/reorder")
async def reorder_categories(body: CategoryOrder, db: Session = Depends(get_db)):
    """Set display order from a list of names (the editor sends the whole tree
    in the order shown). Names left out keep their place after the listed ones."""
    by_name = {c.name: c for c in db.query(Category).all()}
    unknown = [n for n in body.names if n not in by_name]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown categories: {', '.join(unknown)}")
    for order, name in enumerate(body.names, start=1):
        by_name[name].display_order = order
    rest = sorted((c for n, c in by_name.items() if n not in set(body.names)),
                  key=lambda c: (c.display_order or 0, c.name))
    for order, c in enumerate(rest, start=len(body.names) + 1):
        c.display_order = order
    db.commit()
    return {'ordered': len(body.names)}


@router.post("/api/categories/{category_id}/merge")
async def merge_category(category_id: int, body: CategoryMerge, db: Session = Depends(get_db)):
    """Move everything in this category into another one, then remove it."""
    cat = _get(db, category_id)
    _check_unlocked(cat)
    target = db.query(Category).filter_by(name=body.into, is_active=True).first()
    if not target or target.id == cat.id:
        raise HTTPException(status_code=400, detail=f"'{body.into}' is not another active category")
    if db.query(Category.id).filter_by(parent_category=cat.name).first():
        raise HTTPException(status_code=400,
                            detail=f"'{cat.name}' has sub-categories; move or merge them first")
    moved = rename_category(db, cat.name, target.name)
    db.delete(cat)
    db.commit()
    return {'merged_into': target.name, 'moved': moved}


@router.delete("/api/categories/{category_id}")
async def delete_category(category_id: int, db: Session = Depends(get_db)):
    """Delete a category nothing uses. Anything in use is merged or hidden instead."""
    cat = _get(db, category_id)
    _check_unlocked(cat)
    in_use = (
        db.query(Transaction.id).filter(
            (Transaction.category_auto == cat.name) | (Transaction.category_manual == cat.name)).first()
        or db.query(TransactionSplit.id).filter_by(category=cat.name).first()
        or db.query(CategorizationRule.id).filter_by(set_category=cat.name).first()
        or db.query(BudgetTarget.id).filter_by(category=cat.name).first()
        or db.query(Category.id).filter_by(parent_category=cat.name).first()
    )
    if in_use:
        raise HTTPException(status_code=400,
                            detail=f"'{cat.name}' is in use; merge it into another category or hide it")
    db.delete(cat)
    db.commit()
    return {'deleted': cat.name}
