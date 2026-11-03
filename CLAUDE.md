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
1. **Sync drops real same-day repeat charges.** Content-hash fallback in `core/plaid_sync.py` (~145-170) adopts an existing row that already holds a live Plaid ID instead of inserting. In progress in a separate session (started 2026-11-03). Fix future syncs only; no backfill or deletes.
2. **Categorization and earning rules** from `docs/cards-categorization-rules.md`: user category plus merchant category, one shared brand field, rate rules in order (portal, caps, rotating or chosen categories for held cards, country limits), fees and interest earn nothing, superstores out of merchant Groceries. Points calculated forward from the fresh start on **2027-01-01**; no repair of history. `docs/categorization_engine_check.py` is the read-only test harness.
3. **Benefits data model:** amount per period, reset frequency, calendar or card year, uses logged per period with source, optional statement-credit match text, mark used with undo, optional link from a use to its purchase. Platinum's stored credits are out of date against the 2026 statements.
4. **Build the Portfolio, Ecosystem and Card pages** to `docs/cards-portfolio-design.md`, `docs/cards-ecosystem-design.md` and `docs/cards-card-design.md`. Pages go last so the new layout never shows wrong figures. The small flows behind the card ⋯ menu are designed while building.
- **Deferred to 2027-01-01:** points balance syncing, anchored to balances on that date (the Hilton balance is known wrong until then).
- **Parked:** duplicate-import cleanup (94 rows flagged); editing a transaction's spender and category (waits on item 2); collapsing the Category field to Level 1 plus sub-categories.

## Recently Completed
- 2026-11-03 — Cards desktop designs approved (Portfolio, Ecosystem, Card page through 8 gallery rounds), categorization rules and engine check written, build order and the 2027-01-01 fresh start recorded (`ec80d9b`).
- 2026-10-25 — Missing travel earn rates added and Plaid travel tagging fixed; 52 history rows retagged.
- 2026-09-06 — H7: `main.py` split into `core/` modules and domain routers.
