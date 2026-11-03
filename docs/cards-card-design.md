# Cards: Card page design

Chosen with the design gallery (rounds 1-8, 2026-11-02 to 2026-11-03). Desktop approved; not yet implemented. Phone design is a separate, later exercise.
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
- **Transactions:** full table with columns for checkbox, date, merchant, bonus category, spender, type, rate, points, amount and a ⋯ menu. On a purchase the menu holds Log credit use…, then Exclude from points and Set points by hand; on a statement credit it holds only the last two.
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

The gallery did not cover editing a transaction's spender or category; see the Cards functionality items in `BACKLOG.md`. Figures in the gallery are not all correct, also tracked there. The app's stored Platinum benefits are out of date against the 2026 statements (for example $240 a year digital entertainment, $200 hotel; the statements show a $300 hotel credit each half year plus Resy, Lululemon and Equinox credits); fix when building.
