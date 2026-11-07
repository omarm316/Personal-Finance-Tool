# Cards: Actions strip (Portfolio and Ecosystem)

Proposed 2026-11-05; **design gallery round 1 published 2026-11-07, waiting on Omer's picks**: https://claude.ai/artifact/UMrPe1TgDKxY4byEWpMEGq (spec `mockups/design-gallery/cards-actions.spec.js`, id `cards-actions-r1`). This brief stays the starting point until the picks come back. Desktop only; phone design comes later. Built together with the Portfolio and Ecosystem pages (Cards step 4), after the benefits data model (step 3), so it never shows wrong amounts.

## Why
Today, expiring credits appear only on each Card page (Expiring credits row plus the Benefits "Expires if unused" box). Nothing gathers what needs doing across all cards. Portfolio lists every challenge but doesn't separate the urgent ones. Ecosystem has challenges but no credits.

## Proposal (starting point for the gallery)
- **Portfolio placement:** a strip above programs. Order becomes actions, programs, cards, challenges.
- **Ecosystem placement:** the same strip, filtered to that program's cards, under the header (above the balance ledger).
- **Contents, phase 1:**
  1. **Expiring credits from every card in scope.** Same rule as the Card page: the current period still has money left and resets within 60 days, soonest first, then the larger amount first.
  2. **Challenges at risk.** Active, not complete, and `end_date` within 30 days, or behind the pace needed to finish by `end_date`. Challenges that are on track stay only in the challenges grid, so the strip doesn't repeat it.
- **Item card:** the same component as the Card page's expiring-credit card (same height, countdown circle, red at 14 days or less, amber at 30 or less, otherwise blue). Added: a small card-art thumbnail and the card name, because items come from several cards. Credits read "$X left, by <date>"; challenges read "$X to go, by <date>".
- **Actions:** credits use the Card page's mark-used flow unchanged (hover check, "Marked used", Undo, 5-second bar, then the next item slides in). Challenges have no quick action, because spend is calculated. Clicking one opens its Card page.
- **Overflow:** up to 4 or 5 items, then a dashed "+N more" card that opens the full list grouped by card. Per the working rules, a window closes only with its buttons.
- **Heading:** "Actions · N items · $X in credits expiring". Credit amounts are real dollars only; no value per point is ever shown.
- **Empty state:** one line, "All caught up for the next 60 days. Next: <credit>, $X by <date>", so the strip takes almost no room.

## Questions for the gallery
- Strip at the top vs. a side rail vs. a header badge that opens a panel.
- How many items before "+N more" (4 or 5), and whether credits and challenges are mixed by date or grouped.
- The challenge "at risk" rule: days left only, or also pace.
- How the card thumbnail sits on the item card.

## Later, not in phase 1
Annual fee coming due, payment due day, the earning engine's review list of unknown merchants, and missing card data (statement close days, networks).

## Depends on
- Cards step 3, the benefits data model: per-period amounts, reset frequency, calendar or card year, uses with source, mark used with undo. Today's `CardBenefit` and `BenefitUsage` tables can't answer "resets within 60 days" reliably, and Platinum's stored credits are out of date.
- `SpendChallenge.end_date` and the existing challenge progress in `core/challenges_helpers.py`.
