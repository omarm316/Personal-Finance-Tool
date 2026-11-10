# Cards: Portfolio page design

Chosen with the design gallery (rounds 1-3, 2026-11-02). Desktop approved; built 2026-11-10 (Cards step 5, see "Built" at the end). Phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/cards-portfolio.spec.js`.

- **Look:** Cloud color scheme, brand blue accent, Outfit + Plus Jakarta (the gallery default; no other typeface was picked), hairline panels, 13px corners, 1.25 spacing.
- **Chrome:** top navigation bar; boxed header bar with underlined Cards tabs and underlined period selector.
- **Order:** programs, cards, challenges. The Actions strip (chosen 2026-11-07, `docs/cards-actions-design.md`) goes above programs, so the build order is actions, programs, cards, challenges.
- **Programs:** compact tiles, logo on the surface, highest balance first, cash back as a normal tile. Each tile shows earned this period and pending when above zero.
- **Cards:** row with arrows, whole cards only, 175px target width, digits on the art (decided: keep, even though they cover the printed name), cardholder filter chips.
- **Card art:** 1000 x 630 PNG, edge to edge, 44px transparent corners. Replacement files are in `mockups/design-gallery/card-art`; they replace `static/cards` when this page is built, after shrinking them. No new art will be sourced for now.
- **Challenges:** grid; one circle with the dollars to go inside and "to go" below; the blue arc shows progress with no percentage; "Done" when complete. Archive appears on hover for completed challenges only. A "Show archived" section sits under the grid. A dashed "+" card adds a challenge.

Round 3's position and style options for challenges were left at their defaults: circle left of the text, corner Archive button, dashed "+" with no label.

## Built (2026-11-10)
Cards step 5, desktop only; phones keep today's page (`CardsPhonePage.jsx`).
- **Where:** `frontend/src/pages/CardsPage.jsx` picks desktop or phone; `pages/cards/CardsDesktop.jsx` (header bar, tabs, period selector, which page shows) and `pages/cards/PortfolioDesktop.jsx`. Shared pieces in `components/cards/` (`CardsCommon.jsx`, `cards.css`).
- **Data:** programs from `/api/cards/earn-summary`; the cards row from `GET /api/cards/wallet` (open credit-card accounts with product art, owner and program; a card marked closed leaves it); the Actions strip and the challenge grid from `GET /api/cards/actions` (`core/card_actions.py`).
- **Card art:** the files in `mockups/design-gallery/card-art` replaced `static/cards`, shrunk to 480 x 302 and reduced to 256 colors (680 KB for 23 files). Products with no file show the program's gradient and the card's name.
- **Challenges:** in-window challenges, one per card they count on (per-card spend, as before). Archive sets `spend_challenges.is_archived`; Show archived lists them with Restore. The dashed "+" opens Add a challenge with a card picker. A challenge in the Actions strip also gets the red border and "At risk, N days left" here.
- **Swipe Advisor and Card Management** weren't redesigned: their tabs show today's content inside the new header bar.
- **Navigation:** still the app's sidebar, as on the Transactions page and Dashboard; the top bar is an app-wide change of its own.
