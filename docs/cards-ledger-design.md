# Cards: Points ledger and adjustments

Chosen with the design gallery (rounds 1 and 2, 2026-11-07 to 2026-11-10). Desktop approved; not yet implemented. Phone design is a separate, later exercise.
Gallery: https://claude.ai/artifact/FCaxUkP6VeKYb6jGmKnDg2, source spec `mockups/design-gallery/cards-ledger.spec.js` (id `cards-ledger-final`, every choice locked). Inherits the look and page order in `docs/cards-ecosystem-design.md` and `docs/cards-portfolio-design.md`. It replaces that doc's starting-balance buttons and Activity timeline.

Built in Cards step 3 (program balances), before 2027-01-01, so the opening balances can be entered on that day.

## How balances work
- **One anchor per person per program:** the posted balance the program shows on Jan 1, 2027. Nothing before that date counts. Today's model, where each snapshot resets the baseline, goes away. The five snapshots stored today aren't used by the new math.
- **Movements from there on:**
  - card points, posted at each statement close (locked `points_earned`; excluded rows skipped);
  - challenge bonuses, once marked posted;
  - redemptions;
  - transfers out and in;
  - transfers between Omer and Daniella;
  - adjustments.
- **Current balance:** posted points only. **Pending:** card points on statements that haven't closed yet, plus bonuses waiting to be marked posted.
- **Balance check:** Omer types what the program shows. The app logs the difference as an adjustment with the reason Balance adjustment, dated that day. A check that matches is still saved, with 0 points, so its date is kept. A check never resets anything.
- **Adjustment reasons**, a fixed list: Stay or flight, Sign-up bonus, Referral, Promotion, Points expired, Balance adjustment, Other. The note is optional. Points are a signed number.
- **Challenge bonuses:**
  - When a challenge with a flat points bonus is met, its bonus is added as pending. It turns posted only when Omer marks it.
  - Per-dollar challenge bonuses (Freedom 5x and the like) are not added. From 2027 card points already include them through category selections, so adding them would count them twice.
- **Card points by statement:**
  - One line per card per statement, grouped by the card's statement close day. A statement posts the day after it closes; the open cycle is pending.
  - A card with no close day gets one line per calendar month, counted as charged, until its close day is entered.
- **First statement of 2027:** charges between a card's last 2026 close and Dec 31 post on its January statement, so they aren't in the opening balance. That first statement line counts them (their old-engine locked points), or they'd be lost.
- **Whose points:** the transaction's spender, else the card's owner (`primary_user`). A card with no owner puts its points under No owner. Those count in Total only, under a warning.
- **Fixes after a check:** a Card page fix to a 2027 row can reach back before the last balance check. That covers category, type, a rule's recalculation, points by hand and Exclude. The next check absorbs it. Nothing is built for this. The ledger is off by that amount until the next check logs it back. See `docs/cards-card-transactions-design.md`, "Where this meets the other Cards and Transactions designs".
- No assumed dollar value per point anywhere; only realized redemption values.

## Ecosystem page

### Header strip
As approved. Pending counts card points not yet posted plus bonuses waiting to be marked posted.

### Balance ledger
- **Layout:** one card per person with the Total card first (approved). The heading keeps "+ Transfer between us". There are no buttons below the cards.
- **Rows, top to bottom:**
  - Opening balance: ✎ on hover edits it.
  - Earned: card points plus bonuses waiting.
  - Pending, not yet posted: subtracts what hasn't posted.
  - Redeemed, Transferred out, Transferred in.
  - One row per adjustment reason: Stay or flight, Sign-up bonus, Referral, Promotion, Points expired, Balance adjustments, Other.
  - Sent to other, Received from other.

  Rows that are zero for everyone are hidden.
- **Last check:** a dot and the date beside each person's name. Green means matched, amber means it found a gap, grey says "Not checked". Hover gives the sentence, for example "Checked Oct 31, 7 days ago, program had 212 more".
- **Checking a balance:** click the person's balance figure. It shows ✎ on hover and opens the Check balance panel. There is no separate button.
- **No owner:** a warning line under the cards, for example "2,209 points from Strata Premier 7957 have no owner, so they count in Total only." It ends with a link, "Set the card's owner", that opens the card's details.
- **Before the opening balance is set:** the figure reads "—", the Opening balance row says "not set", and a Set opening balance button sits inside the card. The header's figures also read "—".

### Activity table
- **Heading:** as approved: Activity, with + Redemption, + Transfer, + Adjustment and + Between us opposite the title. The realized-value summary sits above the filters and uses real redemptions only.
- **Filters:** type chips (All, Purchases, Redemption, Transfer, Adjustment, Between us). Owner chips on the right (Everyone, Omer, Daniella). Picking one owner hides the Owner column and turns Balance into that person's balance.
- **One line per entry.** No second lines and no group header rows. Description and Details cut off with "…" and show the full text on hover. Newest first. Pending lines carry their expected posting date, so open statements sit at the top.
- **Columns, in order:**
  - **Date:** 10/31.
  - **Card:** a small card-art thumbnail, then "…7154", with the card's name on hover. Blank on lines not tied to a card.
  - **Type:** a colored tag. Purchases blue, Adjustment violet, Redemption amber, Transfer out, Transfer in and Between us teal, Opening grey.
  - **Description:** what the line is. For adjustments, that's the reason.
  - **Details:** the specifics.
  - **Owner:** an initial in a circle, with the name on hover. No owner is an amber "?".
  - **Points:** + in green, − in red, amber while pending.
  - **Balance:** the balance after the line, for everyone or the chosen owner. Blank on pending lines.
  - **Status:** Posted, Pending, or To confirm for a bonus waiting to be marked posted.
  - **Edit:** on hover.

| Line | Type | Description | Details (examples) |
|---|---|---|---|
| Card points at a statement close | Purchases | Statement close | 9/12 to 10/11, 19 charges; a pending one adds "posts 11/12" |
| Card with no close day | Purchases | Month of charges | October charges (13); no statement close day set, so counted as charged |
| Opening balance | Opening | Opening balance | — |
| Redemption | Redemption | Redemption | What it was for; $375.00 realized |
| Transfer out | Transfer out | To Hilton Honors | 20,000 sent, 40,000 received, ratio 1:2 |
| Transfer in | Transfer in | From Amex MR | Same |
| Between us | Between us | Omer to Daniella | Same program, nets to zero |
| Adjustment | Adjustment | Its reason (Stay or flight, Referral, …) | The note |
| Balance check | Adjustment | Balance adjustment | Program showed 72,490, the app had 72,278 (or: Matched the program at 20,212) |
| Challenge bonus | Adjustment | Sign-up bonus | Business Gold sign-up bonus. Challenge met Oct 29: $10,000 in 3 months |

### Challenge bonuses on the challenge card
- **Waiting:** a met challenge with a flat points bonus shows "Bonus waiting to post" and a Mark posted button.
- **Marking it posted:** one click posts the full bonus, dated today. The card then shows "✓ Bonus posted 11/7" with Undo for 5 seconds.
- **Fixing it later:** change the date or amount with Edit on its Activity line.

## Windows
All three open as a side panel on the right, like benefit editing on the Card page, and close only with their buttons. The redemption, transfer and between-us forms keep today's fields, moved into the same side panel; they weren't redesigned here.
- **Check balance** (click a balance), one person at a time:
  - "The app has 72,535 posted; 7 pending isn't included."
  - A large "The program shows" field. Three figures update as you type: App, Program, Difference.
  - Checked on (defaults to today) and an optional note.
  - A line underneath: programs show posted points only.
  - Save logs a Balance adjustment, 0 if it matched.
- **Add adjustment** (+ Adjustment):
  - Whose points (Omer or Daniella, a segmented control).
  - Reason (dropdown).
  - Points (a signed number, "5000 or −2100").
  - Date (defaults to today) and an optional note.
- **Opening balance** (Set opening balance, or ✎ on the row):
  - The field is "<Person>'s balance on Jan 1, 2027".
  - A hint gives the app's own figure today, which was never checked, so the program's figure is the one to use.

## Portfolio
- **Program tiles:** an amber dot in the top right corner when anyone in that program has never been checked, or was last checked more than 60 days ago. Hover says which. Before the opening balances are set, a tile shows "—" and "Not set".
- **Jan 1 reminder:** a banner above Rewards programs until every opening balance is set.
  - It reads "Start the points ledger. Set each program's Jan 1, 2027 balance on its own ledger. Still to set:", followed by a chip per program; each chip opens that program's page.
  - "N of 18 set" sits on the right. It counts one per person with a card in the program, 18 today.
  - Balances are entered on each program's ledger; there is no grid.

## For the build
- **`points_adjustments`:**
  - a reason (the fixed list) and, for balance checks, the figure the program showed;
  - for bonuses, the challenge it comes from, pending or posted, and the posted date.
- **`points_balance_snapshots`:** holds only the Jan 1, 2027 opening balance per person per program. Decide at build whether today's five rows are kept as history or removed.
- **Card points by statement:** group locked `points_earned` per card by statement close day, posting the day after close, with the first-statement rule above. Excluded rows are skipped.
- **Running balances:** per person per program, for the Balance column; the API or the browser can compute them.
- **Data to fix before Jan 1:**
  - Citi Strata Premier has no owner.
  - Six cards have no statement close day (Business Gold, Strata Premier, Bilt, AA Platinum Select, Double Cash, Atmos Summit), so they'd get month lines.
  - Amex Platinum and Blue Business Plus both carry 1008 as their last four in the app (so does a Hilton Honors card). Check the real numbers so the Card column tells them apart; the card art helps meanwhile.
- **Later, not in this design:** phone layouts, expiration dates for points, and transfer-bonus history.
