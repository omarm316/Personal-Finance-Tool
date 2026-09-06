"""
core/constants.py — small, static, cross-domain lookup tables.

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split"). Not one of the originally-scoped
core/ modules — added because BUDGET_TYPES is read by routers/misc.py's
/api/stats* routes (Phase 1) *and* by transaction/budget routes still in
main.py (not yet split), so it needs a home neither side has to import from
the other for. TRANSACTION_TYPES/BALANCE_TYPES are only used by
routers/misc.py today, but are kept alongside BUDGET_TYPES since the three
are one related "canonical transaction type" trio.
"""

# The 8 canonical transaction types
TRANSACTION_TYPES = [
    'Expense', 'Income', 'Transfer',
    'Investment Gain (Loss)', 'Purchase', 'Sale',
    'Depreciation', 'Other',
]

# Types that count toward budget actuals
BUDGET_TYPES = {'Expense', 'Income'}

# Types that affect account balances / net worth
BALANCE_TYPES = {
    'Expense', 'Income', 'Transfer',
    'Investment Gain (Loss)', 'Purchase', 'Sale',
    'Depreciation', 'Other',
}
