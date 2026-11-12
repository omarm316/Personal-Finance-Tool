# Cards: Card page design

Chosen with the design gallery (rounds 1-8, 2026-11-02 to 2026-11-03). Desktop approved. Benefits, Expiring credits and Log credit use were built on 2026-11-10 (see "Benefits built"); the rest of the page was built the same day in Cards step 5 (see "Page built" and "Card menu flows" at the end). Phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/cards-card.spec.js`. Inherits the look in `docs/cards-portfolio-design.md`.

- **Look:** Cloud color scheme, brand blue accent, Outfit + Plus Jakarta, 13px corners, 1.25 spacing, top navigation bar.
- **Layout, top to bottom:** breadcrumb header, color banner, then one shared row with Active challenges and Expiring credits, then two columns. The main column holds Transactions. The side column holds Earnings, then Benefits, so Benefits stays in view when the transaction list is expanded. The Transactions and Earnings panels start on the same pixel row.
- **Getting back:** breadcrumb (Cards > Portfolio > program > card), beside the period selector.
- **Banner:** color gradient with product name, card art, current balance on its own line, then earned this period, annual fee (net only), credit limit, statement close day and payment due day, then a utilization bar. The fee and credits breakdown does not appear here.
  - **Card menu:** a white ⋯ circle right after the card name. It opens Change product, Product history, Edit card details, Add a benefit, Add a challenge and Mark card as closed (in red). This replaces the separate Change product panel.
- **Active challenges:** same as Portfolio: one circle with dollars to go, Archive on hover when complete. A card with no challenges shows only the dashed "+" card. In the shared row, challenges take only the room they need.
- **Expiring credits:** fills the rest of the shared row. Repeats what the Benefits alert box shows, on purpose.
  - **Which credits:** any credit whose current period still has money left and resets within 60 days, soonest first, then the larger amount first.
  - **Cards:** the same height as the challenge cards (and the dashed "+" card), so the shared row lines up. Up to 4, then a dashed "+N more in Benefits" card that scrolls to Benefits. Each card has a countdown circle (time left in the period, with days in the middle), the credit name and "$X left, by <date>". The circle's color is red at 14 days or less, amber at 30 or less, otherwise blue.
  - **Marking used:** hovering (or keyboard focus) shows a see-through layer with a green check in a circle. Clicking marks the whole remaining amount used: the card turns green with "Marked used", an Undo button and a 5-second countdown bar. Undo restores the card. When the time runs out, the card fades out, the next queued credit slides in, the heading count and total update, and the credit's row in Benefits shows Used. Partial amounts are logged in Benefits.
  - **Nothing expiring:** "Nothing expires in the next 60 days." plus "Next: <credit>, $X by <date>" for the soonest credit after that window. After every card has been marked, it reads "All caught up for the next 60 days." with the same Next line.
- **Transactions:** full table with columns for checkbox, date, merchant, bonus category, spender, type, rate, points, amount and row icons in place of a ⋯ menu: Log credit use… (purchases only), Exclude, and Set points by hand. The full table spec, including fixing a bonus category, changing the type, merchant rules and excluding, is in `docs/cards-card-transactions-design.md` (design gallery, 2026-11-05 to 2026-11-07); it takes precedence over the lines below where they differ.
  - **Statement credits:** amount in green as "−$100.00", Type "Credit".
  - **Log credit use (deliberately simple):** a window that closes only with Cancel, × or Log use. Step 1 lists this card's credits in their stored order, each with its cadence and what's left in the period the purchase falls in; the user picks one. No ranking, suggestions or merchant matching, so changes to credits and terms need no code. Step 2 shows the chosen credit, the amount used (defaults to the smaller of the purchase and what's left) and the period it counts toward (from the purchase date), with Back, Cancel and Log use.
  - **Counting rule:** for an auto-tracked credit, statement credits stay the source of the total, so a logged use only records which purchase it paid for and the total doesn't change (the window says so). For a by-hand credit, the amount is added to the period.
  - **Linked purchase:** a small green circle with "$" right after the merchant name, no other text. Its tooltip and screen-reader label give the credit and amount ("Resy dining credit applied, $100"). The Benefits period detail shows the purchase on that use ("Statement credit, for Martha's $106.78").
  - **Points:** positive as green "+14", negative as red "−14", zero as gray "0".
  - **Controls:** its own date selector (Monthly, QTD, YTD, Custom), merchant search, bonus category chips and a totals bar.
  - **Length:** latest rows first, with a "Show all" button.
- **Earnings:** one table replaces the separate rates and points panels. Its columns are category, points bar beside the category, rate, spend and points.
  - **Rows:** most points first. Categories with no points this period are grayed out but keep their rate. "All other purchases" is always last and includes the General points.
- **Benefits:** under Earnings, with a one-line total ("$X in credits this year, $Y used, $Z left") and "+ Add benefit".
  - **Model:** each benefit is stored the way the card issues it: an amount per period and how often it resets (Monthly, Quarterly, Twice a year, Yearly, Every few years, Per use), with the year running by calendar or card anniversary. Uses are logged per period with date, amount and source.
  - **Tracking source:** a benefit can name the statement credit text to match (for example "Platinum Resy Credit"), and is then tagged "Auto-tracked". Without it, it is tagged "Log by hand" (for example Uber Cash, which is paid into the Uber account).
  - **"Expires if unused" box:** amber box at the top listing each open credit with its amount left and reset date, soonest first. Clicking a line opens that credit's current period.
  - **List:** one compact row per benefit, open credits closest to resetting first, used ones after. Each row shows name, amount and cadence with the source tag, one dot per period (used, partly used, missed, current outlined, future faded), a status pill ("$75 left" or "Used") and a ⋯ menu with Log a use, Mark fully used, Edit and Delete.
  - **Period detail:** clicking a dot opens that period under the row: its uses with date, amount and "Statement credit" or "Logged by hand", Remove on each, an Add use row (date and amount), Mark fully used and Done.
  - **Editing:** ✎ or Edit opens a side panel with name, amount per reset, year type, reset frequency, statement credit match text, a reminder checkbox, Delete benefit, Cancel and Save. It closes only with Cancel or Save.
- **Removed:** Monthly Spending bars, the Change product panel.

Editing a transaction's spender, bonus category and type was designed afterward, in `docs/cards-card-transactions-design.md`. Figures in the gallery are not all correct, also tracked there. The app's stored Platinum benefits are out of date against the 2026 statements (for example $240 a year digital entertainment, $200 hotel; the statements show a $300 hotel credit each half year plus Resy, Lululemon and Equinox credits); fix when building.

## Benefits built (2026-11-10)
Cards step 4. Live in today's Card page now: Expiring credits sits under the banner and the Benefits panel replaces the old Benefits & Credits section. The step 5 page reuses the same components.
- **Where:** `core/benefits.py` (counting), `routers/benefits.py` (routes), `frontend/src/components/benefits/` (Benefits panel, Expiring credits, edit side panel, Log credit use, the "$" mark). Tests: `tests/test_benefits.py`.
- **Stored:** `card_benefits` gains `cadence` (monthly, quarterly, semiannual, annual, multi_year, per_use), `year_type` (calendar or card, the card year running from `cards.issue_date`), `every_years`, `match_text` and `remind`. `benefit_usage` is now one row per use, with `use_date` and an optional `transaction_id` (the purchase it paid for). Startup filled these from the old fields once. Old uses, which were one total per period, are dated at their period's start.
- **Counting:**
  - Statement credits aren't stored. They are read from the card's transactions on each load: money back, any type, Excluded rows skipped, with the benefit's match text in the description. A credit matching two benefits goes to the longer match text.
  - A credit logged by hand counts every use. On an auto-tracked credit:
    - a use logged by hand (Add use, Mark fully used, Mark used on Expiring credits) counts until a statement credit dated on or after it, in the same period, replaces it;
    - a use logged from a purchase only records the purchase, and shows on that period's statement credit ("Statement credit, for Martha's $106.78").
  - **Late credits:** a statement credit often posts in the period after the purchase. Anything over a period's amount counts toward the period before, if that one has room. Platinum 1009's Q1 lululemon credit posted Apr 2; it now counts for Q1.
  - **Before the card was opened:** periods that end before `issue_date` show faded and don't count. Business Gold was opened Jul 23, 2026.
- **Totals line:** "$X in credits this year, $Y used, $M missed, $Z left". Missed is added when there is any, so the figures add up (B12). Per-use and every-few-years credits count only what was used this year.
- **Expiring credits:** credits whose current period has money left and resets within 60 days, soonest first, then the larger amount. Mark used saves the rest of the period at once. Undo deletes it within 5 seconds, then the card fades out. `GET /api/benefits/expiring` lists them across every card, for the Actions strip in step 5.
- **Catalog:**
  - The seed now fills only a product that has no benefits yet. Until now it wrote its figures back on every startup, which would undo Card page edits and bring back deleted benefits.
  - Amex Platinum got its 2026 credits, from the 2026 statements and the published terms. Saks ended June 30, 2026.
  - Match texts were set where the 2026 statements show the credit's text: Platinum (hotel, Resy, lululemon, digital entertainment, Equinox, CLEAR), Brilliant dining, Business Gold (ChatGPT, Squarespace, FedEx/Grubhub "FLEXIBLE BUSINESS CREDIT"), Aspire CLEAR, and both United rideshare credits.
- **Not yet as designed, or left out:**
  - A statement credit line in period detail has no Remove. To drop one, Exclude the transaction.
  - One amount per period: Platinum Uber Cash's extra $20 in December, and United Quest's $12 December rideshare, aren't modeled.
  - The reminder box is stored, but nothing sends reminders yet.
  - Log credit use is a "$ Credit" button in the row's Actions column, since today's table has no row menu.
  - By hand until their statement text is seen: Platinum's airline fee, Walmart+, Uber One, Oura and Global Entry credits, Aspire's resort and flight credits, and most United and Business Gold Walmart+ credits.
  - Other products' terms weren't re-checked. Some catalog rows are discounts rather than credits (AAdvantage's $125 flight discount, Atmos's Lounge+ discount), so they show as yearly credits until they are edited.

## Card menu flows (designed while building, 2026-11-10)
The gallery left the flows behind the ⋯ menu undesigned. They reuse the benefit editing side panel: on the right, closed only by Cancel, ×, or their own button. Code: `frontend/src/components/cards/CardPanels.jsx`.
- **Change product:** "Now: <product>", a New product list (every product but the current one, by name), From (defaults to today) and one line: charges before the date keep their points, charges from it earn at the new product's rates and the card shows its benefits. Button: Change product (Link product when none is linked). Uses `POST /api/cards/{id}/change-product`.
- **Product history:** a list, newest first, each product with "Mar 25, 2026 to today" and a dot (filled for the current one), then "Each charge keeps the points of the product it was made on." Footer: Change product… on the left (opens that panel), Done.
- **Edit card details:** Card name and Last four; Cardholder (a list of names, No owner, or Add a name…) with a hint that points with no spender count toward the cardholder; Opened on and Annual fee, with a hint that the fee and card-year credits follow the opening date; Credit limit, Statement closes (day) and Payment due (day); Notes; the bank account it's linked to, read-only. Save uses `PATCH /api/cards/{id}`.
- **Add a benefit:** opens the Benefits panel's own Add benefit side panel and scrolls to Benefits.
- **Add a challenge** (also the dashed "+" card): Name; Kind (sign-up bonus, spend $X for a bonus rate, bonus rate up to a cap, rotating category up to a cap, yearly threshold); Starts, Ends, Activated, with a hint that spend counts from the later of start and activation; Bonus (points, points per dollar, statement credit, a reward) and its amount; the cap or the spend to reach and how many times it repeats, as the kind needs; categories it counts (none ticked counts every purchase); other cards it also counts on; Only spend by; Notes. Clicking a challenge card on the Card page opens the same panel as Edit challenge, with a progress line, "Show its transactions" (sets the table to the challenge's dates) and Delete, which asks once more in place.
- **Mark card as closed** (red in the menu): a red-edged box naming the card and saying it leaves Portfolio, its program's page and the Actions strip, and its credits and challenges stop counting; Closed on (defaults to today); a line that its transactions, points and history stay and Card Management can reopen it (Show inactive, then Reopen, added 2026-11-12). The red Mark as closed button sends `is_active: false` and `close_date`, then returns to Portfolio.

## Page built (2026-11-10)
Cards step 5, desktop only (`frontend/src/pages/cards/CardDesktop.jsx`, the table in `CardTxnTable.jsx` and `cardtx.css`); phones keep `AccountCardDetailPage.jsx`.
- **Header:** breadcrumb (Cards > Portfolio > program > card) beside MTD, QTD and YTD. The card's figures come from `/api/accounts/{id}/card-detail`, which covers the current year only, so there's no year picker here.
- **Banner:** program gradient, product name with the white ⋯ circle, the account and owner line, card art, current balance on its own line, then Earned this period, Annual fee, Credit limit, Statement closes and Payment due, then utilization.
  - **Annual fee, net only:** fees charged less statement credits received in the current card year, by transaction type (Credit and Fee; history uses the same types the table shows). Until now it netted the personal category Fees & Interest. Platinum 1008 reads $495 net on the production copy ($895 fee, $400 credits); Platinum 1009 reads −$442 net.
- **Shared row:** challenge cards take 270px each, then a 112px dashed "+" (200px when the card has none); Expiring credits fills the rest on one line, the "+N more in Benefits" card 112px.
- **Earnings:** category, bar, rate, spend, points; most points first; categories in the product's earning table with no points this period stay grayed with their rate; All other purchases last. From 2027 rows group by merchant category with the rate locked on the row.
- **Not yet as designed:**
  - Pending charges: the sync still skips them, so the table has no Pending divider.
  - A type changed by hand has no ✎ (the app doesn't store the engine's own type); a category changed by hand does.
  - ↺'s tooltip says "Back to the card's figure" without the figure, which isn't stored once points are set by hand.
  - Earnings still lists base-rate categories that earned points as their own 1x rows, and shows negative points (BACKLOG).
