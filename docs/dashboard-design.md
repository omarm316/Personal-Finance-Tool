# Dashboard page design

Chosen with the design gallery (rounds 1-4, 2026-11-03 to 2026-11-05). On 2026-11-07 Omer removed the insights card, moved the three charts above the budget card, and asked for those three cards to be the same height. Desktop approved; not yet implemented. Phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/dashboard.spec.js` (id `dashboard-final-r6`). Final rendering with real figures: https://claude.ai/artifact/PA8pANhJV9Z213UyqFEfPh
Replaces today's `frontend/src/pages/DashboardPage.jsx` layout. The aim from round 1: fewer raw figures, more plain statements of what changed and what needs a look.
Example figures below are October 2026, pulled 2026-11-04 after the two-level category migration.

## Look and chrome
- **Look (carried over from Cards, locked):** Cloud color scheme, brand blue accent, Outfit headings with Plus Jakarta body, hairline panels, 13px corners, 1.25 spacing.
- **Navigation:** the top bar, as on Cards.
- **Header:** one slim boxed bar. The greeting ("Good evening, Omer") sits on the left. On the right are the Monthly / Year to date control (underlined text) and the month stepper (‹ October 2026 ›). The back arrow is disabled at January and the forward arrow at the current month.

## Page order, top to bottom
1. Summary figures (full width)
2. One row of three panels: Month pace, Spending trend, Where the money went
3. Budget performance (full width)

When a category's detail panel is open, it sits under the budget card, at the bottom of the page.

**Panels per row:** three at full width, two when the content area is narrower than 1150px, and one under 860px. Wide panels always span the row.

**The row of three is level:** Month pace, Spending trend and Where the money went share one height, set by the tallest of them (320px in October, 301px in Year to date). The spending chart stretches to fill its card (never under 200px), the gauge sits centred in the space under the pace headline, and the credits note sits at the foot of Where the money went. At two per row, the two cards on a row match and Where the money went sits on the row below.

**Left off the page:** insights (removed 2026-11-07), biggest changes, recent transactions, largest purchases, top merchants, savings rate, cash cushion, spending by day, net worth panel, rewards balances. Their gallery designs stay in the spec in case one comes back.

## Shared rules for every figure
- **Period:** the selected month, or January 1 through the selected month in Year to date. When the selected month is the current one, it runs through today.
- **Comparisons:** a month in progress compares with the same days of last month. Year to date compares with the same span of last year.
- **Excluded categories:** budget-side figures leave out `Transfer` and `Work`, since `Work` is the income bucket. `Unclassified` shows as `Other`.
- **Top-level categories (decided in round 4):** rows store the most specific category. The budget card and where the money went both count at the top level of the category tree (Settings › Categories). A category with no parent is its own top level. A budget or spending booked on the top level itself counts toward that top level.
- **No dollar value per point:** nothing on the page shows an assumed value per point. Rewards are not on the page.

## Summary figures
- **Net worth hero, on the left:** the value comes first with the label under it. Below them are a 12-month sparkline and the change since the first month shown (for example "−$13,112.01 since Nov 2025").
- **2×2 grid, on the right:** Checking & Savings, Income, Expenses and Net Cash Flow. Each shows the value first and the label under it.
- **Change line:** Income, Expenses and Net Cash Flow carry a colored arrow with the percent change and "vs. last month" (or "vs. last year" in Year to date). Lower expenses count as green. Checking & Savings shows a dash because it is a balance.

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
- **This month's bar:** one stacked bar, 28px high. The 5 largest top levels are named in fixed colors (blue, teal, amber, pink, violet), with the rest grouped in grey as "N more categories". This was 8 until 2026-11-07; it came down to 5 so the card is no taller than the other two. In October the 5 named cover 87%, and "4 more categories" holds $2,068.97.
- **Last month's bar:** sits underneath, about 17px high, on the same scale as this month's bar, so bar length compares totals. It uses the same color per top level in this month's order, with anything else in grey. Labels "Oct" / "Sep" sit at the left and totals ("$16k" / "$30k") at the right. A finished month has no note under the bars. A month in progress compares the same days and says so: "Same days of October underneath." In Year to date only this period's bar shows, with no note.
- **Legend:** a list with a color square, the name, the percent of spending and the amount.
- **Credits note:** top levels that net to a credit can't be a slice. When there are any, one line at the foot of the card says so: "Leaves out $5,331.99 of net credits (Business, Financial)." Hovering it adds that this is gross spending, so it is more than the budget card's total.

## Open questions for the build
- **B25:** in Year to date the Expenses figure and the budget card's total differ by the $299 of `Work` expenses. Decide on one basis or add a footnote.
- **B36:** the house is bucketed as "Other Assets" in net worth. The figure is right; only the label is affected.
- Today's page reads `/api/stats`, budgets and transactions. Month pace and where the money went need per-category totals for the period and the comparison period, rolled up to top level (`/api/budget/actuals` already returns `top_levels` and `/api/stats` returns `by_top_level`). Decide while building whether the browser computes them from the period's rows or a small endpoint returns them.
