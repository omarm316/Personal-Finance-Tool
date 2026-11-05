# Dashboard page design

Chosen with the design gallery (rounds 1-4, 2026-11-03 to 2026-11-05). Desktop approved; not yet implemented. Phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/dashboard.spec.js` (id `dashboard-final-r4`). Final rendering with real figures: https://claude.ai/artifact/PA8pANhJV9Z213UyqFEfPh
Replaces today's `frontend/src/pages/DashboardPage.jsx` layout. The aim from round 1: fewer raw figures, more plain statements of what changed and what needs a look.
Example figures below are October 2026, pulled 2026-11-04 after the two-level category migration.

## Look and chrome
- **Look (carried over from Cards, locked):** Cloud color scheme, brand blue accent, Outfit headings with Plus Jakarta body, hairline panels, 13px corners, 1.25 spacing.
- **Navigation:** the top bar, as on Cards.
- **Header:** one slim boxed bar. The greeting ("Good evening, Omer") sits on the left. On the right are the Monthly / Year to date control (underlined text) and the month stepper (‹ October 2026 ›). The back arrow is disabled at January and the forward arrow at the current month.

## Page order, top to bottom
1. Summary figures (full width)
2. Insights (full width)
3. Budget performance (full width)
4. One row of three panels: Month pace, Spending trend, Where the money went

When a category's detail panel is open, it sits between the budget card and the row of three.

**Panels per row:** three at full width, two when the content area is narrower than 1150px, and one under 860px. Wide panels always span the row.

**Left off the page:** biggest changes, recent transactions, largest purchases, top merchants, savings rate, cash cushion, spending by day, net worth panel, rewards balances. Their gallery designs stay in the spec in case one comes back.

## Shared rules for every figure
- **Period:** the selected month, or January 1 through the selected month in Year to date. When the selected month is the current one, it runs through today.
- **Comparisons:** a month in progress compares with the same days of last month. Year to date compares with the same span of last year.
- **Excluded categories:** budget-side figures leave out `Transfer` and `Work`, since `Work` is the income bucket. `Unclassified` shows as `Other`.
- **Top-level categories (decided in round 4):** rows store the most specific category. The budget card, the insights that read budgets, and where the money went all count at the top level of the category tree (Settings › Categories). A category with no parent is its own top level. A budget or spending booked on the top level itself counts toward that top level.
- **No dollar value per point:** nothing on the page shows an assumed value per point. Rewards are not on the page.

## Summary figures
- **Net worth hero, on the left:** the value comes first with the label under it. Below them are a 12-month sparkline and the change since the first month shown (for example "−$13,112.01 since Nov 2025").
- **2×2 grid, on the right:** Checking & Savings, Income, Expenses and Net Cash Flow. Each shows the value first and the label under it.
- **Change line:** Income, Expenses and Net Cash Flow carry a colored arrow with the percent change and "vs. last month" (or "vs. last year" in Year to date). Lower expenses count as green. Checking & Savings shows a dash because it is a balance.

## Insights
One full-width panel with the period label at the top right. It holds four sentences, laid out in two columns (one column when the panel is under 640px). Each row has a bold figure in the tone's color, then the sentence. Fixed order:
1. **Change in spending:** "Spending down from September: $10,498.71 against $22,886.02." The figure is ▲/▼ with the percent (red when up, green when down). A month in progress adds "(same days)". In Year to date it shows the monthly average instead.
2. **Furthest over budget:** the top level with the largest dollar overrun, plus a count of the other over-budget top levels: "Groceries ran $4,969.52 over its $1,200.00 budget. 5 more categories are over too." The figure is "+$5.0k" in red. When nothing is over: "✓ Every budgeted category is within budget." in green.
3. **Share of income kept:** "Kept 63% of what came in: $18,176.23 of $28,674.94." Green when positive. When income is negative: "Spent $X more than came in." in red. With no income: "No income recorded in this period yet."
4. **Spending with no budget:** spending in top levels with no budget anywhere in them, in amber, naming the top three with "and N more" ("Went to categories with no budget: Other."). A subcategory with no budget of its own is covered by its top level's budget, so Airlines does not count here when Travel has one. The row is hidden when there are none.

Every figure is plain arithmetic on the period's rows. There is no ranking or inference to maintain.

## Budget performance
- **Card header:** the title and the period label. Under it sits a total line: "Total spent $10,498.71 of $9,265.00 budgeted".
- **One tile per top level:** an auto-fill grid with a minimum width of 210px. The tile's budget is the sum of every budget in the top level, and its spending is the sum of every row in it. In October, Travel reads "$237.75 over, $737.75 of $500.00", where the flat tiles showed Travel at $0 of $500 and Airlines with no budget.
  - **Top row:** the top level's name, with the figure on the right. The figure is "$X left" in green or "$X over" in red. A top level with no budget shows its spent amount. One that nets to a credit shows "+$X" in green.
  - **Bar:** 24px, the label inside (decided 2026-07-27), with 25/50/75% ticks. The fill is blue under 80%, amber at 80-99% and red at 100% and over, at strength 0.5 (amber +0.08, red +0.12). The percent sits at the right. A top level with no budget shows "no budget set" inside an empty bar.
  - **Sub-line:** "$2,832.21 of $200.00", or "no budget set", or "net credit".
  - **Categories inside:** under the sub-line, each category in the top level is a small row: the name on the left, the amount on the right (red when over its own budget, green for a credit), then "of $X", "no budget" or "net credit" in small text, and a 4px bar in the same three colors underneath. A budget or spending booked on the top level itself shows as its own row under the top level's name (for example "Travel $0.00 of $500.00" above Airlines). Rows follow the tile order rule. A top level with no categories in use (Groceries, Dining, Business, Other in October) shows only the tile, as in round 3.
- **Tile order:** furthest over budget first (spent divided by budget, highest first), then top levels with no budget by amount, with `Other` always last.
- **Clicking:** a category row opens that category's detail panel under the card and highlights the row, without toggling its tile. Anywhere else on the tile opens the whole top level and highlights the tile. Clicking again or pressing ✕ closes it.
- **Detail panel:** the name, the period's total and "N transactions · October 2026". A top level's panel adds a breakdown line of its categories ("Clothing $1,252.21 of $200.00 · Electronics $1,580.00 · no budget"), and each transaction's sub-line names its category before the account. Transactions list newest first, up to 14, then "N more in Transactions →".

## Month pace (Year pace in Year to date)
- **Headline:** "Finished $1,233.71 over budget" or "...under budget" for a closed period. For a period in progress: "On pace for $X, $Y over" or "...within budget". The pace is spending so far divided by the share of the period gone.
- **Sub-line:** "$10,498.71 spent of $9,265.00 · day 31 of 31".
- **Gauge:** a half circle with a filled arc. The arc runs from 0 to 150% of budget, so the black Budget mark sits two thirds of the way round. While the period is in progress, a dashed blue Today mark shows the even-pace point. The arc is blue, or red once over budget.
- **Figure in the middle:** dollars, whole: "$1,234 over budget" in red, or "$X left to spend".

## Spending trend
- **Chart:** a line with a shaded area, covering the last 6 months up to the selected month, with every month labelled. The selected month has the larger dot and a bold axis label.
- **Narrow panels:** when slots get narrow, only the first, last and selected months keep value labels.
- **Clicking a month:** opens that month. The hint "Click a month to open it." sits under the chart.
- **No guide lines:** there is no budget line and no average line (both tried in round 3 and left off).

## Where the money went
- **What it counts:** gross spending by top-level category for the period, excluding `Transfer` and `Work`.
- **This month's bar:** one stacked bar, 28px high. The 8 largest top levels are named in fixed colors (blue, teal, amber, pink, violet, sky, green, orange), with the rest grouped in grey as "N more categories". In October the 8 named cover all but $32.39.
- **Last month's bar:** sits underneath, about 17px high, on the same scale as this month's bar, so bar length compares totals. It uses the same color per top level in this month's order, with anything else in grey. Labels "Oct" / "Sep" sit at the left and totals ("$16k" / "$30k") at the right. The note under it reads "September underneath, on the same scale." A month in progress compares the same days. In Year to date only this period's bar shows.
- **Legend:** a list with a color square, the name, the percent of spending and the amount.
- **Credits note:** top levels that net to a credit can't be a slice. When there are any, a note says so: "Gross spending. $5,331.99 of net credits (Business, Financial) are left out, so this is more than the budget card's total."

## Open questions for the build
- **B25:** in Year to date the Expenses figure and the budget card's total differ by the $299 of `Work` expenses. Decide on one basis or add a footnote.
- **B36:** the house is bucketed as "Other Assets" in net worth. The figure is right; only the label is affected.
- Today's page reads `/api/stats`, budgets and transactions. Insights, pace and where-the-money-went need per-category totals for the period and the comparison period, rolled up to top level (`/api/budget/actuals` already returns `top_levels` and `/api/stats` returns `by_top_level`). Decide while building whether the browser computes them from the period's rows or a small endpoint returns them.
