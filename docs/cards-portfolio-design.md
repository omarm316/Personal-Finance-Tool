# Cards: Portfolio page design

Chosen with the design gallery (rounds 1-3, 2026-11-02). Desktop approved; not yet implemented. Phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/cards-portfolio.spec.js`.

- **Look:** Cloud color scheme, brand blue accent, Outfit + Plus Jakarta (the gallery default; no other typeface was picked), hairline panels, 13px corners, 1.25 spacing.
- **Chrome:** top navigation bar; boxed header bar with underlined Cards tabs and underlined period selector.
- **Order:** programs, cards, challenges.
- **Programs:** compact tiles, logo on the surface, highest balance first, cash back as a normal tile. Each tile shows earned this period and pending when above zero.
- **Cards:** row with arrows, whole cards only, 175px target width, digits on the art (decided: keep, even though they cover the printed name), cardholder filter chips.
- **Card art:** 1000 x 630 PNG, edge to edge, 44px transparent corners. Replacement files are in `mockups/design-gallery/card-art`; they replace `static/cards` when this page is built, after shrinking them. No new art will be sourced for now.
- **Challenges:** grid; one circle with the dollars to go inside and "to go" below; the blue arc shows progress with no percentage; "Done" when complete. Archive appears on hover for completed challenges only. A "Show archived" section sits under the grid. A dashed "+" card adds a challenge.

Round 3's position and style options for challenges were left at their defaults: circle left of the text, corner Archive button, dashed "+" with no label.
