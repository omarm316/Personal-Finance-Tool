# Budgets page design

Chosen with the design gallery (rounds 1–3, 2026-11-05 to 2026-11-14). Desktop approved and **built 2026-11-15** (see "Built" at the end). Phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/budgets.spec.js` (id `budgets-final`). Final rendering with real figures: https://claude.ai/artifact/6HktA4vxaD62hYaYdu8rGV
Replaces the layout of today's `frontend/src/pages/BudgetsPage.jsx`. This is the Budgets half of F13 (grouping by top level). Behavior stays as today unless a section below says otherwise.

## Look and chrome
- **Look (locked from Cards and the Dashboard):** Cloud color scheme, brand blue accent, Outfit headings with Plus Jakarta body, hairline panels, 13px corners, 1.25 spacing. Budget bars are 24px with the label inside, blue/amber/red at fill strength 0.5.
- **Navigation:** the top bar.
- **Header:** one slim bar, as on the Dashboard. "Budgets" sits on the left. On the right are the view tabs (Month · Annual · Edit Year), the year tabs (2025 · 2026 · 2027) and, in the Month view, the row of months (Jan … Dec). All are underlined text.
- **Buttons:** they sit above the table (Copy from {last year} in the Month view; Edit Year in the Annual view). The Paste from Excel window goes away; pasting happens straight into the cells (see Editing).
- **Modals and panels:** they close only with their own buttons, never on a backdrop click or Escape.

## Summary figures
Four cards, label first, as today:
- Income — {Mon}: the planned budget, with "Actual: …" under it.
- Expenses — {Mon}: the budget, with "Actual: …".
- Budget used: a percent (red at 100% and up, amber from 80%), with "$X of $Y" under it.
- Net — {Mon}: the planned net, with "Actual: …".

In the Annual view they cover the year: the full-year budget, with actual so far. There is no "on pace" line.

## Month view
- **Rows:** one row per top level, closed when the page opens. ▸ opens it to show its categories. A count badge shows how many categories it holds.
- **Columns:** Category · Actual (with an 80×6px bar; budget column cells are described below) · {Mon} budget · Variance. The variance is signed ("+$262" / "−$4,970") and green when good. Today's mark on the small bars (current month only) shows even pace for the day.
- **Order:** most spent first, at both levels. Spending with no budget stays in its place in the list. Income comes first, then expenses, then the NET row. Categories with nothing this month are shown.
- **The budget column** is spreadsheet cells: thin Excel-grey borders and no padding, forming one continuous column.
- **Clicking a category** opens the side panel (below).
- **Unclassified** counts as Other, as on the Dashboard (today's page drops it from the list).

## Top-level budgets and "Other" (decided in round 3)
- **A top level's budget is its total.** The top-level row's budget cell is editable in the Month view and in Edit Year.
- **Other is computed, never typed.** Under every top level, a read-only, grey italic row called **Other** holds the total minus its categories' budgets. It shows even at zero.
- **Changing a category's budget takes from Other;** the total stays as it was. If the categories add up to more than the total, **the total rises to cover them** and Other stops at zero.
- **Spending booked on the top level itself** counts against Other, as does spending in a category with no budget of its own.
- **No data migration is needed.** A budget stored on the top level itself is exactly Other. Housing's own $1,100 plus Utilities $400 and Home Maintenance $450 reads as a $1,950 total with Other $1,100. A top level with only category budgets (Shopping: Clothing $200) totals their sum, with Other at $0.
- **Note for the build:** the top-level category that is itself called Other (Sales, Taxes, For Others) also gets an "Other" row.

## Annual view: an Excel-style sheet
- **Grid:** 1px Excel-grey gridlines (#D4D4D4), 28px rows and 7px padding inside cells (about 11px at the sides). The whole year fits on one screen at desktop width.
- **Headers:** small capitals, as on the other pages. The month headers stay in view while scrolling.
- **Numbers:** whole dollars without a dollar sign ("1,200"); credits show as "+3,303".
- **Totals:** Total income and Total expenses are bold, with a line above and a double line below. The total column is on the right.
- **Rows** follow the Month view: top levels that open, then the Other row and categories.
- **Selected cell:** the app's blue box.
- **Above the sheet:** the four summary cards, then the toolbar.
- **Width:** inside the page margins.
- **No formula bar.**

### The Spent sheet: the heat map
- **Cells:** each cell shows the amount spent in whole dollars, with no percent.
- **Conditional formatting:** a "Conditional formatting" switch sits above the sheet and starts on. Each cell is colored by how far it is from its *own* budget: white on budget, deeper green further under, deeper red further over, on a smooth scale reaching full color at 60% from the budget. Income runs the other way (above plan is green).
- **Spending with no budget** shows red, like over budget.
- **The current month** is compared with its whole month's budget.
- **Months to come** show their budget in grey italics.
- **The total column** colors the year's spending so far against the budget for the months so far. The Net row has colored text only.
- **Clicking a month** edits that month's budget in the cell: the cell shows the budget while you type, then goes back to the amount spent.

### Edit Year tab: the budgets sheet
- **Cells:** every category's twelve months as editable cells, with top-level rows holding the total and a read-only Other row under each.
- **Spending:** shown on hover (the cell's tooltip), not in the grid.

## Editing like a spreadsheet (every grid on the page)
- **Cells, not text boxes.** Click a cell and type. It shows the whole-dollar figure, and the plain number while it has focus.
- **Keys:**
  - **Tab** moves right, then to the first editable cell of the next row; **Shift+Tab** goes back.
  - **Enter** saves and stays.
  - **Arrows** move between cells.
  - **Escape** puts the cell back.
- **Saving:** each cell saves as you leave it, and totals and Other update at once. There are no Save or Cancel buttons.
- **Pasting from Excel:** paste a block straight into the cells. It spreads right and down from the selected cell and skips locked cells.
- **Past months are locked for editing by default.** Budgets for months before the current one (and every month of a past year) are shaded, read-only cells with a lock on the column header. Tab and pasting pass over them, and Copy from last year skips them. A "Past months locked" switch above the grid unlocks them. It appears in the budgets sheet, above the heat map and in the Month view when a past month is shown ("October 2026 is past, so its budgets are locked").
- **Hints:** none (no 3-month average in the cells).

## Side panel (clicking a category)
- **Opens on the right** and closes only with ✕.
- **Header:** the name, the amount spent of the budget, and the period.
- **Breakdown:** a top level's panel adds a line breaking down its categories.
- **Chart:** the year by month as bars (spent) with budget ticks; the selected month is highlighted.
- **Transactions:** the period's transactions, newest first, with "N more in Transactions →".
- **No budget cells:** there is no 12-month budget row in the panel.

## Starting a new year
2027 starts empty with the **Copy from 2026** button, as today. Copy leaves locked months alone.

## Open for the build
- **APIs:** `/api/budget/targets` and `/api/budget/actuals` (with `top_levels`) cover the figures. Editing totals needs the write rule above: the total minus the categories goes to the top level's own target, and when categories exceed the total, the top level's own target is 0.
- **Locking:** past-month locking is a front-end rule. Decide whether the API should also refuse past-month writes unless unlocked. (Built as a front-end rule only.)
- **Data:** the gallery used data pulled 2026-11-08 without the duplicate Amex accounts (since cleaned up, B41).

## Built (2026-11-15)
- **Files:** `frontend/src/pages/BudgetsPage.jsx` picks `pages/budgets/BudgetsDesktop.jsx` or `BudgetsPhonePage.jsx` (today's page, renamed; phones keep it). Desktop: `BudgetsDesktop.jsx` (header, cards, toolbars, saving), `MonthView.jsx`, `YearSheets.jsx` (the heat map and the budgets sheet), `BudgetPanel.jsx`, `budgets.css`. The figures and the Other rule live in `frontend/src/lib/budgetData.js`; the spreadsheet cell is `frontend/src/components/ui/SheetCell.jsx`, ready for other pages' grids.
- **No API change.** The page applies the Other rule itself (`applyCells`) and writes the category and its top level through `POST /api/budget/targets/bulk`, one request at a time in order. Other rows are never written.
- **Locking stays a front-end rule.** The API takes past-month writes as before (the open question above, left as is).
- **Other's spending** is what is booked on the top level itself plus its categories with no budget that month, so such a category's spending shows on its own row and again in Other. The top level's total counts it once.
- **Side panel:** a column beside the table (as in the gallery), not an overlay; Other rows open it too. "N more in Transactions →" opens the Transactions page.
- **Checks:** `node docs/budget_model_check.mjs` (15 checks on made-up figures, no database). In the browser on a SQLite copy of production (2025–2026 transactions, categories, budgets): typing a total, a category (Utilities 400 → 600 kept Housing at $1,950 and moved Other from $1,100 to $900), Tab, Shift+Tab, arrows, Enter, Escape, pasting a 2×2 block, locked October and its switch, the heat map's cell edit with its caption, Copy from 2026 into 2027, the side panel, light and dark, and a 1024px window with the panel open (the Month table drops its bars).
