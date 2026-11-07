# Cards: Ecosystem page design

Chosen with the design gallery (rounds 1-2, 2026-11-02). Desktop approved; not yet implemented. Phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/cards-ecosystem.spec.js`. Inherits the look in `docs/cards-portfolio-design.md`.

- **Look:** Cloud color scheme, brand blue accent, Outfit + Plus Jakarta, 13px corners, 1.25 spacing, top navigation bar.
- **Layout:** one column, in this order: header, balance ledger, points by category, your cards, active challenges, activity. The Actions strip (chosen 2026-11-07, `docs/cards-actions-design.md`) goes between the header and the balance ledger, filtered to the program's cards.
- **Getting back:** breadcrumb (Cards > Portfolio > program), beside the period selector.
- **Header:** balance strip with the logo, posted balance, each person's balance, pending, earned this period and a card fan. Pending is its own figure and shows 0 rather than disappearing, so the strip keeps the same shape on every program.
- **Balance ledger:** one card per person with the Total card first. Rows that are all zero are hidden. Starting-balance buttons sit below the cards, and "+ Transfer between us" sits in the section heading. The column is named Total.
- **Points by category:** bars.
- **Your cards:** row with arrows, whole cards only, 175px target width, same as Portfolio.
- **Challenges:** same as Portfolio: one circle with dollars to go, Archive on hover when complete, dashed "+" card.
- **Activity:** one timeline with filter chips (All, Redemption, Transfer, Adjustment, Between us). One add button per type sits in the section heading, opposite the title. The realized value summary sits above the filters and uses real redemptions only.

Each person's balance appears in both the header and the ledger cards; Omer chose this knowingly.

Balances shown in the gallery are not correct (see the balance item in `BACKLOG.md`); that is a functionality fix, not a design decision. The activity rows in the gallery are labeled samples.
