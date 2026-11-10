# Cards: Actions strip (Portfolio and Ecosystem)

Chosen with the design gallery (round 1, 2026-11-07; brief written 2026-11-05). Desktop approved; built 2026-11-10 (Cards step 5, see "Built" at the end). Phone design is a separate, later exercise.
Gallery: https://claude.ai/artifact/UMrPe1TgDKxY4byEWpMEGq, source spec `mockups/design-gallery/cards-actions.spec.js` (id `cards-actions-final`, every choice locked). Inherits the look in `docs/cards-portfolio-design.md` and the expiring-credit card in `docs/cards-card-design.md`.

Built together with the Portfolio and Ecosystem pages (Cards step 4), after the benefits data model (step 3), so it never shows wrong amounts.

## Why
Today, expiring credits appear only on each Card page (Expiring credits row plus the Benefits "Expires if unused" box). Nothing gathers what needs doing across all cards. Portfolio lists every challenge but doesn't separate the urgent ones. Ecosystem has challenges but no credits.

## Design
- **Look:** Cloud color scheme, brand blue accent, Outfit + Plus Jakarta, 13px corners, 1.25 spacing, top navigation bar.
- **Placement:** a strip at the top of the page.
  - **Portfolio:** the first section under the header bar, above Rewards programs. Page order becomes actions, programs, cards, challenges.
  - **Ecosystem:** under the balance header, above the balance ledger, with only that program's cards in scope.
- **Heading:** "Actions" on the left; two count chips on the right, "N credits, $X" (amber dot) and "N challenges at risk" (red dot). A chip hides when its count is zero. Amounts are real dollars only; no value per point is ever shown.
- **Two labeled rows:** "Credits expiring", then "Challenges at risk". A row with nothing in it is not shown.
- **How many:** each row shows as many items as fit on one line, with a 240px smallest item width. When more are waiting, a narrow dashed "+N more" card (about 112px) closes the row. Clicking it expands that row in place to show every item as cards, and the same card then reads "Show fewer". Each row expands on its own.
- **Order within a row:** soonest first, then the larger amount first.

### Item card
The Card page's expiring-credit card, plus a header line for the card it comes from.
- **Header line:** a small card-art thumbnail, then the card name and whose card it is ("Amex Platinum 1008 · Omer"), with a hairline under it. A card with no cardholder shows the name only.
- **Body:** a countdown circle on the left (days left in the middle, the arc showing the share of the period left), then the name and one line of detail.
  - Credits: "$X left, by <date>".
  - Challenges: "$X to go, by <date>", in whole dollars.
  - The amount takes the circle's color.
- **Circle color:** red at 14 days or less, amber at 30 or less, otherwise blue. Challenges use the same countdown as credits: days left to the end date, the arc showing the share of the challenge window left.
- **Height:** the card is about 18px taller than the Card page's expiring card, for the header line. Every card in the strip is the same height.

### Which items
- **Credits:** any credit whose current period still has money left and resets within 60 days. This is the Card page's rule, applied to every card in scope.
- **Challenges at risk:** active and not complete, and either:
  - the end date is within 30 days, or
  - it is behind pace: spent less than the target times the share of the challenge window already gone. The window counts from the activation date when that is later than the start date.

  Challenges on track appear only in the challenge grid.

### Actions
- **Credits:** the Card page's mark-used flow, unchanged. Hover or keyboard focus shows a check in a circle. A click marks the whole remaining amount used: the card turns green with "Marked used", an Undo button and a 5-second bar. When the time runs out:
  - the card fades out;
  - the next waiting item slides in;
  - the chips' counts and total update;
  - the credit shows as Used in that card's Benefits.

  Partial amounts are logged in Benefits.
- **Challenges:** no quick action, because spend is calculated. Hover shows a blue border and a "›". A click (or Enter) opens the challenge's Card page.
- **Challenge grid:** a challenge in the strip is also marked in the challenge grid below it, with a red border and a red line "At risk, N days left" under its bonus. The grid still lists every challenge.

### Nothing due
One line in place of the strip: "ACTIONS ✓ All caught up for the next 60 days. Next: <credit> on <card>, $X by <date>." Next is the soonest credit whose period ends after the 60-day window, in its current or a coming period. When there is none, the line stops after the first sentence. The same line appears when the last item is marked used.

## Seen in the gallery (Nov 7, 2026 figures)
- From the statement model (Platinum 1008, Aspire 2007, SP 3698), the Portfolio strip holds 10 credits ($697.81) and 2 challenges. The challenges are Atmos Ascent 5707's companion certificate ($1,076 to go by Nov 19) and Prime Visa 6639's $100 off $750 ($750 to go by Nov 20).
- With every stored credit counted as unused, it reaches 43 credits ($3,981.56), because most annual credits reset Dec 31. In that case the "+N more" card carries most of the load in November and December.
- The Freedom Q4 challenges and AA's flight discount are on pace, so today the "behind pace" half of the rule adds nothing.

## Later, not in phase 1
Annual fee coming due, payment due day, the earning engine's review list of unknown merchants, and missing card data (statement close days, networks).

## Depends on
- Cards step 3, the benefits data model: per-period amounts, reset frequency, calendar or card year, uses with source, mark used with undo. Today's `CardBenefit` and `BenefitUsage` tables can't answer "resets within 60 days" reliably, and Platinum's stored credits are out of date.
- **Every card's credits set up and checked before the strip ships** (Omer's question, 2026-11-07). The strip trusts the data completely: a card with no credits stored adds nothing, so the page can say "All caught up" while a credit is open. The gallery shows this on Marriott Bonvoy, where Bonvoy Brilliant's $25 monthly dining credit isn't in the statement model. Only Platinum 1008, Aspire 2007 and SP 3698 are modelled today. Step 3 is done only when, for each of the roughly ten other cards with credits (Platinum 1009, SP 7154, Business Gold, BBP, Brilliant, Delta Gold, Bilt Obsidian, United Quest, United Explorer, Strata Premier):
  1. its credits match the current terms (amount per period, reset frequency, calendar or card year, the anniversary where it matters);
  2. each credit paid as a statement credit has its match text, so uses count themselves from synced transactions, and the rest are marked "Log by hand";
  3. 2026 uses are backfilled by running the match over this year's transactions, and Omer checks the list card by card. This is how the three modelled cards were built. Without it, every unused-looking credit shows as open, as in the gallery's stress scenario.

  No extra "unchecked card" state in the UI; finishing step 3 is the safeguard. After that, by-hand credits (Uber Cash, DoorDash) stay right only if they're marked used, from the strip or from Benefits.
- `SpendChallenge.start_date`, `activation_date` and `end_date`, and the existing challenge progress in `core/challenges_helpers.py` (`lap_spend`, `progress_target`, `remaining_spend`).
- A read endpoint for the strip (credits and challenges for one scope, with the "Next" credit) is a build-time decision; the gallery computed it all in the browser.

## Built (2026-11-10)
- **Read endpoint:** `GET /api/cards/actions` (optional `ecosystem_id`), in `core/card_actions.py` and `routers/cards_pages.py`. It returns the credits (current period open, resetting within 60 days, with the card, owner, art and the period's length for the arc), the challenges at risk, every in-window challenge with `at_risk`, `done`, `days_left` and `span`, and the Next credit. `GET /api/benefits/expiring` is unchanged.
- **At risk:** active, not done, not archived, with a spend target, and either ending within 30 days or behind pace (spent less than the target times the share of the window gone, the window starting at the later of start and activation).
- **Front end:** `ActionsStrip` in `frontend/src/components/cards/CardsCommon.jsx`. Each row fits as many 240px items as one line holds; when more wait, a 112px "+N more" card closes the row and expands it in place. Mark used, Undo, the 5-second bar, the fade and the next item sliding in work as on the Card page.
- **Seen on the production copy (Nov 10):** 44 credits ($4,336.84) and 4 challenges at risk on Portfolio: Atmos Ascent 5707's companion certificate, Prime Visa 6639's $100 off $750, and Freedom Flex 5780's Q4 categories, which is behind pace; and, on the copy only, a test challenge. Most credits are by-hand ones that haven't been marked used, as the "Depends on" note above warned.
