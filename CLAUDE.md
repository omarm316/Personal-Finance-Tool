# Moresheth — Project Guide

Personal finance app (transactions, budgets, net worth, credit cards and points). Detailed state lives in `PLAN.md` (current focus, session writeups, Architecture Notes) and `BACKLOG.md` (every item with status). Read those before starting; keep both updated as work progresses.

## Stack
- **Backend:** FastAPI + SQLAlchemy. `main.py` plus domain routers split out under H7 into `routers/` (`plaid_routes.py`, `budgets.py`, `transactions.py`, ...) and shared `core/` modules (`core/points_engine.py`, `core/plaid_sync.py`, `core/accounts_helpers.py`).
- **Frontend:** Vite + React under `frontend/` (one file per page in `frontend/src/pages/`). `v2.html` and `frontend.html` are retired.
- **Database:** PostgreSQL on Railway. `DATABASE_URL` in `.env` points at production, so local dev reads and writes real data. Use read-only queries when investigating.
- **Data in:** Plaid sync (`transactions` product) plus CSV/OFX import.

## Production
- Railway, auto-deploys from GitHub on every push to `main`: https://personal-finance-tool-production.up.railway.app
- Always `git push` after every commit (no need to ask).
- Single user (Omer); no test-credential pattern is recorded.

## Working rules
- One Claude Code session per page or module; don't expand scope mid-session.
- New page layouts are chosen with the `design-gallery` skill first; code follows. Phone design is a separate, later exercise per screen.
- Modals never close on backdrop click or Escape; explicit buttons only.
- Never show an assumed dollar value per point; only real redeemed values.

## Pending Features
Cards module, in this order (see `PLAN.md` "Cards module layout work" and `BACKLOG.md` "Cards module findings"):
1. ~~**Sync drops real same-day repeat charges.**~~ Fixed 2026-11-03 (`cb4e4cd`, PR #1). Future syncs only; no backfill.
2. **Categorization and earning rules** from `docs/cards-categorization-rules.md`. **Stage 1 built 2026-11-03:** the 2027 engine (`core/earn_engine.py`, `core/merchant_classifier.py`, rules in `core/earn_rules_seed.py`, API in `routers/earning.py`) scores rows dated 2027-01-01 on; history keeps the old engine. Next: confirm the held cards' terms (most products are "ported"), the data fixes waiting on Omer (six close days, Atmos Summit product; the three product links were done 2026-11-03), and the Q1 2027 rotating and chosen categories. Checks: `docs/categorization_engine_check.py` (no DB), `docs/earning_dry_run.py` (read-only), `tests/test_earning.py`. Run tests with a SQLite `DATABASE_URL` (see PLAN.md traps).
3. **Benefits data model:** amount per period, reset frequency, calendar or card year, uses logged per period with source, optional statement-credit match text, mark used with undo, optional link from a use to its purchase. Platinum's stored credits are out of date against the 2026 statements.
4. **Build the Portfolio, Ecosystem and Card pages** to `docs/cards-portfolio-design.md`, `docs/cards-ecosystem-design.md` and `docs/cards-card-design.md`. Pages go last so the new layout never shows wrong figures. Also an Actions strip (expiring credits and challenges at risk) on Portfolio and Ecosystem: design chosen 2026-11-07 in `docs/cards-actions-design.md` (gallery spec `mockups/design-gallery/cards-actions.spec.js`). The small flows behind the card ⋯ menu are designed while building.
- **Deferred to 2027-01-01:** points balance syncing, anchored to balances on that date (the Hilton balance is known wrong until then). The ledger, balance checks, adjustments with reasons, pending challenge bonuses and the opening-balance entry are in design: gallery round 1 published 2026-11-07 (`mockups/design-gallery/cards-ledger.spec.js`, PLAN.md "Cards points ledger"), waiting on picks. Build before Jan 1.
- **Parked:** duplicate-import cleanup (94 rows flagged); editing a transaction's spender and category (waits on item 2).

## Recently Completed
- 2026-11-08 — Plaid connection flows (add, Reconnect, + Add Account) share one account matcher, `core/plaid_accounts.py`; this was B41's cause (Amex reissues account IDs). Check Health fixed. Both Bank of America logins must be connected again with + Connect Bank; Plaid refuses Reconnect for them, and + Connect Bank waits on Bank of America's OAuth registration in the Plaid Dashboard (B42). Tests 130 passed.
- 2026-11-07 — Transactions page rebuilt on desktop to `docs/transactions-design.md` (Excluded chip, Card earning box, no dollar value on points; B37 and B38 fixed). Shared Cloud-look pieces for the next builds: `styles/cloud.css` and `components/ui/` (Popover, Window, FilterChip, CategoryList). Phones keep the old layout.
- 2026-11-07 — `design-gallery` skill now lives in the repo (`.claude/skills/design-gallery/`), so cloud sessions have it. Cards Actions strip designed in one gallery round; final spec in `docs/cards-actions-design.md`.
- 2026-11-05 — 2027 engine: Food Delivery folded into Dining, so delivery orders earn each card's dining rate. Tests 113 passed; engine check 200/200.
- 2026-11-05 — Net Worth hidden from the menu (page and route kept). Daily Balances design gallery round 1 published, rebuilt around liquidity (`mockups/design-gallery/daily-balances.spec.js`); waiting on picks.
- 2026-11-04 — Two-level personal categories (top level › sub-category) with a Settings › Categories editor (`routers/categories.py`, `CategoryEditor.jsx`, design in `docs/settings-categories-design.md`). History moved by `docs/category_tree_migration.py`. The For Others tag is now the Other › For Others category. Tests 111 passed.
- 2026-11-03 — Cards step 2 stage 1: the 2027 earning engine (merchant path, brand, kinds, earn rules with caps, top categories, selections and country limits; review list and before-and-after recalculation). Engine check 195/195; tests 85 passed (B27 fixed).
- 2026-11-03 — Sync fix: real same-day repeat charges no longer dropped (`cb4e4cd`).
- 2026-11-03 — Cards desktop designs approved (Portfolio, Ecosystem, Card page through 8 gallery rounds), categorization rules and engine check written, build order and the 2027-01-01 fresh start recorded (`ec80d9b`).
- 2026-10-25 — Missing travel earn rates added and Plaid travel tagging fixed; 52 history rows retagged.
- 2026-09-06 — H7: `main.py` split into `core/` modules and domain routers.
