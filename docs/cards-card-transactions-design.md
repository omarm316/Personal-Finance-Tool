# Cards: Card page transactions table

Chosen with the design gallery in four rounds (2026-11-05 to 2026-11-07). Omer approved this desktop design on 2026-11-07, and the row icons in round 4 the same day; it is not built yet. The Card page is built last, after the benefits data model (CLAUDE.md, Cards step 4). Phone design is a separate, later exercise.

- **Gallery:** https://claude.ai/artifact/Td3kGZkHsEvw7YvkVX5sQa.
- **Source spec:** `mockups/design-gallery/cards-card-transactions.spec.js` (id `cards-card-tx-final`).
- **Inherited:** the rest of the Card page (look, layout, banner, Earnings, Benefits, Log credit use) as approved in `docs/cards-card-design.md`.

## Columns

Checkbox · Date · Merchant · Bonus category · Spender · Type · Rate · Points · Amount · row icons

- **Date:** month/day, as on the Transactions page (10/25).
- **Merchant:** the clean name; the bank text shows on hover. Tags after the name:
  - Pending.
  - ⊘ Excluded.
  - The green $ circle for a linked purchase.
- **Bonus category:** the card's category for the charge, with the brand after it in gray ("Superstores · Walmart").
  - From 2027 it is the merchant category, shown by its own name ("Hotels", not "Travel › Hotels"). Before 2027 it is the stored bonus category.
  - A purchase with no category shows "None" in amber. Rows that aren't purchases or refunds show "—".
- **Spender:** always shown. Click the cell to pick a name or add one.
- **Type:** every row names its type: Purchase, Refund, Credit, Fee, Interest or P2P. Adjustment appears only when the engine sets it.
- **Rate:** "3x" in blue; "–" when the row earns no rate.
- **Points:** +14 green, −14 red, 0 gray. A ✎ follows points set by hand.
- **Amount:** card statement style. Charges read $13.81; money back reads −$100.00 in green.
- **Your category** (the personal category) is not on this page.

## Rows

- Dense ledger rows, striped. Latest first, no grouping. Clicking a header sorts by that column.
- The latest 12 rows, then a "Show all N" button.
- Card payments are hidden.
- **Pending charges:** at the top, under a "Pending" divider (charges that haven't posted yet). They are italic and earn no points until they post. They can't be edited. This needs a sync change (see Open items).
- Excluded rows are dimmed and tagged ⊘ Excluded.
- Clicking a row does nothing. The cells and the row icons have their own actions.
- **Empty list:** "No transactions for this period." When filters hide every row: "No matches."

## Toolbar, totals and selection

- **Date selector:** Monthly, QTD, YTD, Custom; Monthly and QTD have ‹ › arrows.
- **Search:** an outlined search box (merchant names and brands).
- **Chips:** one bonus category chip per category in the period, plus All. There is no brand filter and no Unknown merchant chip.
- **Totals bar:** Spend and Points.
  - Spend counts purchases only. It leaves out fees, interest, P2P, credits, refunds and excluded rows.
  - Credits and refunds are not shown in the totals.
- **Selection bar** (shown when rows are ticked): "N selected · Tag as: Who spent this? ▾ · Clear selection". There is no bulk category or bulk type.

## Fixing a bonus category

- Click the bonus category cell. Every row that can be fixed shows a faint ▾, and "None" is outlined in amber. Pending rows can't be fixed.
- A list opens under the cell: a search box, then the merchant categories, grouped (Travel › Hotels).
  - Each category shows this card's rate on the right. It's blue where the card pays more than its base rate, with notes such as "3x online".
  - Rows before 2027 list the old bonus categories as a plain list, without rates (as today).
- **Rule tick box:** at the top of the list, on by default: "Use for every charge from <merchant>". When ticked, it shows:
  - The match text, editable. It defaults to the merchant name without trailing punctuation.
  - A Whole words / Contains switch.
  - A live line: "Matches 4 charges on your cards; 3 others change, +608 points".
- **Saving:** one click on a category saves. With the box ticked it also saves a merchant rule, which applies on every card, and recalculates the matching 2027 rows. A toast confirms it: "Rule saved: “CITY BISTRO” → Dining. 3 other charges updated, +608 points".
- **Type select:** under the list, offering only the types that fit the row (see below).
- A ✎ follows the category on rows fixed by hand.
- **Closing:** clicking outside the list closes it without saving. It is a list under a cell, not a window, so the rule that windows close only with their buttons doesn't apply.
- **Brand** is read-only here. Brand editing belongs to the Transactions page work.

## Changing the type

- Click the Type cell (a faint ▾ on every 2027 row). A list opens under the cell with only the types that fit the amount:
  - **A charge:** Purchase, Fee, Interest, P2P.
  - **Money back:** Refund, Credit.
  - Each type shows its rate and points on this row, for example: Purchase 1x +895, Fee 0.
- **Rule tick box:** same as for categories, on by default: "Use for every charge from <merchant>" or "Use for every money-back line from <merchant>". It has the editable match text, Whole words / Contains, and the live count.
  - A type rule covers one direction only. A rule made from money back leaves that merchant's charges alone, and the other way round.
- One click saves. A ✎ follows the type when it was changed by hand. Setting it back to the engine's type removes the ✎.
- **Rows before 2027:** the type is read-only (the API refuses `txn_kind` there). Its tooltip points to the Exclude and Set points icons.

## What each type earns

The 2027 engine already works this way (rules 8 to 10 in `docs/cards-categorization-rules.md`; `_score` in `core/earn_engine.py`, `_resolve_kind` in `core/merchant_classifier.py`).

| Type | Points |
|---|---|
| Purchase | The card's rate for the category |
| Refund | Takes back what the purchase earned |
| Credit (statement credits, offers, fee refunds) | Nothing, and takes nothing back |
| Fee, Interest | Nothing |
| P2P (Venmo, Zelle, Cash App) | Nothing |

From 2027, only purchases count toward a sign-up bonus or spend challenge (`core/challenges_helpers.py`), and only purchases make up Spend in the totals bar. History was scored by the old engine, which got some of this wrong: Platinum's $895 renewal fee earned 895 points, and Resy credits took 100 back. History keeps those points (fresh start on 2027-01-01).

## Excluding a charge

Omer's round 3 note: some charges, such as Venmo transfers, should earn no points and not count toward a sign-up bonus or spend challenges.

- **Venmo, Zelle and Cash App:** existing kind rules in `core/earn_rules_seed.py` already type them P2P. From 2027 they earn nothing and don't count toward challenges, without being excluded, and they still count in budgets. Any other transfer can be set to P2P in the Type cell, with a rule if it repeats.
- **The ⊘ Exclude icon** is for anything else, and for history. It works on every row and sets the existing `is_excluded` flag, which already removes the row from:
  - points (old and 2027 engines);
  - sign-up bonus and challenge spend;
  - the Spend total;
  - budgets and the dashboard totals (`/api/stats`). It is the same flag as the Transactions page's Exclude, so an excluded row leaves those pages too. That's why P2P, not Exclude, is the right fix for a Venmo payment that is real spending.
- **On screen:** one click excludes. The row dims and shows ⊘ Excluded, and the icon turns red; clicking it again includes the row. Toast: "Excluded: no points, not counted toward a sign-up bonus or spend challenges".

## Row icons

Icons replace the row ⋯ menu (round 4). They are bare icons, faint on every row and full strength when the row is hovered or has keyboard focus. An icon that shows a state (excluded, points set by hand) stays in color. Pending rows have none. Three icons take about 82px, against 32px for ⋯.

- **$ Log credit use…:** purchases only. It opens the Log credit use window from `docs/cards-card-design.md`, and afterward the purchase gets the green $ circle after its name. On other rows the slot stays empty, so the icons line up.
- **⊘ Exclude:** see Excluding a charge. Red when the row is excluded; click again to include it.
- **Pencil, Set points by hand:** puts the Points cell into edit mode, in place, like a spreadsheet. The number is selected, ready to type.
  - Enter saves and Escape cancels. Clicking elsewhere saves. Tab saves and moves to the next row's Points cell; Shift+Tab moves to the previous one.
  - Typing the card's own figure leaves the row on the card's figure.
  - Saved points show a ✎ after them and replace the card's figure, so rules and recalculation leave them alone. Toast: "Points set by hand: +250. ↺ goes back to the card's figure".
- **↺ Back to the card's figure** (Omer's round 4 note): once points are set by hand, the pencil becomes ↺, in blue. Its tooltip gives the card's figure ("Back to the card's figure (+107)"). One click clears the hand-set number, and the pencil returns.

## What it is built on

| Action | API |
|---|---|
| Category fix (2027 row) | `PATCH /api/transactions/{id}` with `merchant_category`. Sets `classification_source = 'manual'`; refuses rows before 2027 |
| Type change (2027 row) | The same, with `txn_kind` |
| Rule | `POST /api/merchant-rules` with `pattern`, `match_type` (`word` or `contains`) and `merchant_category` or `txn_kind`; then `POST /api/earning/recalculate` with `apply: true`. Rules are global (rule 1) |
| Category fix (before 2027) | Today's flow: the stored bonus category plus the teach-merchant rule, scored by the old engine |
| Exclude / Include | `PATCH /api/transactions/{id}` with `is_excluded` |
| Points by hand / back to the card's figure | `PATCH /api/transactions/{id}` with `points_earn_override`, or `clear_points_earn_override: true` |
| Spender | `PATCH /api/transactions/{id}` with `spender` |

## Where this meets the other Cards and Transactions designs

Checked 2026-11-07 against the Actions strip (`docs/cards-actions-design.md`), the points ledger (`PLAN.md` "Cards points ledger", round 1) and the Transactions page (`docs/transactions-design.md`, built in `75e50d9`).

- **Agreed already:**
  - Exclude is the same `is_excluded` flag everywhere. The Transactions page hides excluded rows behind its Excluded chip; the Card page keeps them in the list, dimmed, as today's Card page does.
  - Both pages save a merchant rule by default (a tick box here, "Save as a rule for this merchant" there). Rules are global.
  - Challenges at risk read `core/challenges_helpers.py`. It counts purchases only from 2027 and skips excluded rows, the same rule as this table's Spend.
  - Log credit use and the strip's mark-used flow both write uses to the step 3 benefits model, as `docs/cards-card-design.md` describes.
- **Kinds differ from the Transactions page:**
  - The Transactions page's Kind dropdown offers all eight kinds on any row (`KINDS` in `frontend/src/lib/txnView.js`). This table offers only the kinds that fit the amount.
  - Fix: `PATCH /api/transactions/{id}` refuses a kind that doesn't fit the sign, and both pages list the same kinds by sign. Payment and Adjustment stay available where the engine already set them.
  - The names differ too: "Person to person" there, "P2P" here (the Type column is narrow).
- **Benefits matching (step 3) and this table's edits:**
  - Auto-tracked credit uses come from statement-credit match text over synced rows, and the Type and Exclude edits here touch those same rows.
  - Proposed rule for the matcher: match by text whatever the row's type, and skip excluded rows. Skipping excluded rows also skips rows the sync soft-deleted, which carry the same flag.
  - So changing a Resy credit's type keeps its use, and an excluded duplicate isn't counted twice.
- **The points ledger and fixes to old rows:**
  - The ledger counts card points per statement from locked `points_earned`. Every edit here on a 2027 row changes those figures: category, type, a rule's recalculation, points by hand, Exclude.
  - A balance check logs the difference as an adjustment. So fixing a row from before the last check counts the change twice, until the next check logs it back.
  - To decide with the ledger's round 2: let the next check absorb it, which needs nothing built, or have this table warn when a fix reaches back before the program's last balance check.
  - **Decided 2026-11-10 (ledger round 2): the next check absorbs it.** Nothing is built here; see `docs/cards-ledger-design.md`.

## Open items (also in BACKLOG.md)

1. **A kind rule ignores the amount's sign.** A `purchase` rule applies to that merchant's refunds too, making them purchases that take back nothing. A `refund` rule on a charge is just as wrong. Fix: `_resolve_kind` should read a purchase rule on money back as a refund, and a refund rule on a charge as a purchase.
2. **A draft-rule preview for the live count.** `POST /api/earning/recalculate` previews only the saved rules. The tick box needs an endpoint that takes a draft rule (pattern, match type, category or type) and returns the matching rows and the change in points, writing nothing. Rows fixed by hand (`classification_source = 'manual'`) aren't reclassified by rules, so the count leaves them out.
3. **Pending charges:** the sync skips them today. Showing them needs the sync to store pending rows apart and replace each one when it posts.
4. **Column width:** the main column is about 656px at the gallery's width. With Spender and Type always shown, merchant names truncate early; check at build.
5. **The banner's annual-fee tile** nets the personal category Fees & Interest. Move it to the fee and credit types (existing BACKLOG item).
