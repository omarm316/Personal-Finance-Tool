# Cards: Ecosystem page design

Chosen with the design gallery (rounds 1-2, 2026-11-02). Desktop approved; built 2026-11-10 (Cards step 5, see "Built" at the end). Phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/cards-ecosystem.spec.js`. Inherits the look in `docs/cards-portfolio-design.md`.

- **Look:** Cloud color scheme, brand blue accent, Outfit + Plus Jakarta, 13px corners, 1.25 spacing, top navigation bar.
- **Layout:** one column, in this order: header, balance ledger, points by category, your cards, active challenges, activity. The Actions strip (chosen 2026-11-07, `docs/cards-actions-design.md`) goes between the header and the balance ledger, filtered to the program's cards.
- **Getting back:** breadcrumb (Cards > Portfolio > program), beside the period selector.
- **Header:** balance strip with the logo, posted balance, each person's balance, pending, earned this period and a card fan. Pending is its own figure and shows 0 rather than disappearing, so the strip keeps the same shape on every program.
- **Balance ledger:** one card per person with the Total card first. Rows that are all zero are hidden. Starting-balance buttons sit below the cards, and "+ Transfer between us" sits in the section heading. The column is named Total. Superseded in part on 2026-11-10 by `docs/cards-ledger-design.md`: a row per adjustment reason, opening balance edited with ✎ on its row, a balance checked by clicking it, and no buttons below the cards.
- **Points by category:** bars.
- **Your cards:** row with arrows, whole cards only, 175px target width, same as Portfolio.
- **Challenges:** same as Portfolio: one circle with dollars to go, Archive on hover when complete, dashed "+" card.
- **Activity:** one timeline with filter chips (All, Redemption, Transfer, Adjustment, Between us). One add button per type sits in the section heading, opposite the title. The realized value summary sits above the filters and uses real redemptions only. From 2026-11-10 the timeline is a table with one line per entry (Date, Card, Type, Description, Details, Owner, Points, Balance, Status) and a Purchases chip: see `docs/cards-ledger-design.md`.

Each person's balance appears in both the header and the ledger cards; Omer chose this knowingly.

Balances shown in the gallery are not correct (see the balance item in `BACKLOG.md`); that is a functionality fix, not a design decision. The activity rows in the gallery are labeled samples.

## Built (2026-11-10)
Cards step 5, desktop only (`frontend/src/pages/cards/EcosystemDesktop.jsx`); phones keep `EcosystemDetailPage.jsx`.
- **Header strip:** logo, posted balance, each person's balance, Pending (0 shows), Earned this period and a fan of up to three cards plus "+N". Cash Back shows cash earned instead, with no people or Pending.
- **Actions strip:** `GET /api/cards/actions?ecosystem_id=…`; Cash Back filters the full list to its cards.
- **Balance ledger and Activity:** from the points ledger's start date (2027-01-01) they are `LedgerCards` and `LedgerActivity` from `components/ledger/`. Before it, the page shows the older balances in the same look: a card per person with Total first, zero rows hidden, the no-person starting balance as a note, and Set/Edit starting balance buttons below the cards; Activity is a one-line table (Date, Type, Description, Details, Owner, Points) with the type chips and the realized-value summary.
- **Side panels** (`components/cards/ProgramPanels.jsx`): + Redemption (with Edit and Delete), + Transfer, + Between us (with Edit and Delete), starting balance and adjustments before the ledger starts. They keep today's fields and close only with their buttons. Transfers can still only be deleted.
- **Your cards:** caption with whose card and this period's points. **Challenges:** the Portfolio grid, filtered to the program; the dashed "+" adds one for a card in it.
