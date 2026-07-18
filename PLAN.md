# Moresheth — Current Plan

> Updated each session. Tracks what we're actively working on and next steps.
> Last updated: 2026-07-18

---

## Current Focus

### Cards module — deep review in progress (Omer's main focus for the next few days)
Going screen-by-screen through Cards/Ecosystems fixing behaviors, coordinated with the sibling MARGIN project (shared backend) via `~/Library/Mobile Documents/com~apple~CloudDocs/MARGIN-MORESHETH-INTEGRATION.md`.

**Deployed 2026-07-17 (commit `3fb7f33`)**:
- Redemption/Transfer/TransferRatio split (`database.py`, `main.py`) — Redemption is now pure value-capture; Transfer is a separate value-neutral point-movement model with effective-dated `TransferRatio`s per ecosystem pair.
- Earn-logic correction: `compute_points_earn()` rewritten as a pure function (deterministic sign+category rules, `is_excluded` as the manual escape hatch), replacing 4 previously-inconsistent call sites. New `points_earn_override` column/PATCH fields for manual per-transaction correction.
- Cash Back ecosystem drill-down 422 fixed (route-registration order).
- `v2.html`: Redemptions form simplified, new Transfers UI, `TxnRow` classification-aware points display (earn/clawback/excluded/manual override) with inline adjust controls, Cards page `annual_fee` `??` fix.
- **Deliberately not ported to `frontend.html`** (being retired) — verified the new backend response shape stays fully backward-compatible with the old committed `frontend.html`, so production (still served from `frontend.html` at `/`) is unaffected.

**Outstanding**: benefit-credit `is_excluded` cleanup pass — review large-magnitude `clawback` transactions (e.g. "Platinum Hotel Credit") and manually exclude genuine benefit credits; correct-per-design but not correct-per-reality until excluded. See `MARGIN-MORESHETH-INTEGRATION.md` Known issues for detail.

**Deployed 2026-07-17, round 2**:
- Font consistency: 92 `fontFamily:'DM Sans'` references in `v2.html` pointed at a font that was never actually loaded (only `Outfit` and `Plus Jakarta Sans` are in the Google Fonts import) — silently fell back to whatever generic sans-serif the OS provides. Replaced all with `Plus Jakarta Sans`.
- Cards module transaction table (`AccountCardDetailPage`'s "Transactions" section) gained inline Action-type editing (Expense/Transfer/Income/etc., same click-to-edit pattern as the existing CSC editor) and an Exclude/Include toggle wired to the existing `is_excluded` field (zeroes points + drops SUB spend credit — verified this was already the backend's behavior, just never exposed here).
- Two bugs found and fixed en route: `/api/accounts/{id}/transactions` was hard-filtering out any `is_excluded` transaction (so excluding one made it vanish with no way to see/undo it — inconsistent with the main Transactions page, which dims but still shows them); and `row-excluded`/`row-locked`/`row-review`/`row-transfer` CSS classes were referenced throughout `v2.html` but never defined, so excluding a transaction gave zero visual feedback anywhere in the app. Also fixed the Cards table's points column, which computed a stale client-side estimate instead of reading the corrected `points_earn`/classification fields.
- SUB finding (not changed, flagged for awareness): spend-challenge tracking only sums negative-amount transactions — a positive-amount credit, whether a genuine benefit credit or an actual return, never adds to *or subtracts from* SUB spend today. Benefit credits correctly don't touch SUB; an actual returned purchase still counts toward SUB forever. Not fixed — would need the purchase-matching logic that was deliberately removed for being unreliable.

**Deployed 2026-07-18, round 3 — points-earn accuracy fixes**:
- New "P2P Payments" CSC, added to `_NON_EARNING_CATS` (zero points + zero SUB spend credit, same mechanism as fees/interest). Venmo auto-tags via a new `CategorizationRule` (pattern="VENMO", `notes="points:P2P Payments"`) and all 56 existing Venmo transactions were backfilled. Zelle needed no fix — already `action='Transfer'`, already fully excluded.
- **Found and fixed a real regression caused mid-session**: creating that Venmo rule triggered the app's documented `_reapply_rules(force_unlock=True)` behavior, which exposed a pre-existing dormant bug — a single 2026-03-04 correction (txn 6045, Best Buy, Expense→Transfer) had been "learned" and was blanket-overriding every Best Buy transaction to Transfer, because the learning system's own anti-over-generalization safeguard (word-overlap between the correction's description and the new transaction's) degenerates to a no-op when the only shared word is the merchant name itself. 8 real Best Buy purchases got flipped; reverted all 8 back to `Expense`, verified points restored. **The underlying over-generalization bug in `_check_transfer_correction()` (categorization.py) is still unfixed** — worth a dedicated look, since any merchant with exactly one Transfer-correction and a generic description is at risk, not just Best Buy.
- **Amex per-dollar rounding**: `compute_points_earn()` now rounds the dollar amount UP to the nearest whole dollar before multiplying by the rate, but *only* for `Card.issuer == 'AMEX'` (confirmed against a real statement: $4.66 dining spend × 7x earned 35 pts, not 32.6 — Amex rounds to $5 first). Explicitly scoped to Amex only, pending confirmation for other issuers — `Card.issuer` already exists to extend this later if needed.
- Also flagged, not fixed: a stray auto-created rule mistags some Venmo transactions as budget category "Healthcare" (5 rejections, 0 acceptances in its history — worth cleaning up).

### V2 Redesign — Premium Glassy Blue (v2.html, served at `/v2`) — QA COMPLETE
Gemini CLI built a full parallel redesign in `v2.html` (light/dark glassmorphic blue theme, static mockup at `/mockup`). Completed a full page-by-page pass: visual QA first, then a second pass clicking every real feature on every page (filters, modals, inline edit, toggles, drill-downs) to verify functionality, not just appearance.

**Visual/crash bugs fixed:**
- Dashboard — sidebar-overlap layout bug (orphaned CSS block, missing `@media (max-width: 480px)` wrapper)
- Transactions — `TxnRow` crash (undefined `t` instead of `txn`)
- Budgets — crash from leftover reference to removed `error` state
- Settings — unstyled Preferences/Data Management tabs
- Systemic: ~20 CSS classes referenced in JSX but never defined (`.modal*`, `.grid-*`, `.section-title/header/desc`, `.settings-*`, `.sel-drop`) — was breaking modals (rendered inline instead of as overlays) and leaving headers/labels unstyled across most pages

**Functional bugs fixed (found during the second pass):**
- **`--blue-primary`/`--blue-vibrant` were self-referencing circular CSS variables** (`--blue-primary: var(--blue-primary)`), invalid per spec, resolved to transparent. Broke 56+16 direct usages app-wide (budget progress bars, chart lines, borders, badges) in both themes — only dark-mode buttons were spared by a separate hardcoded override. Single highest-impact fix of the whole pass.
- Daily Balances 30d/90d range toggles sent no `start_date`/`end_date` at all (dead `'quarter'` branch never renamed to `'90d'`, no `'30d'` branch existed) — silently fell back to current-month data regardless of which toggle was selected.

**All 11 pages verified working**: Dashboard, Transactions, Budgets, Daily Balances, Accounts, Net Worth, Cash Flow, Loans, GCB, Cards, Settings — including modals, inline edit, batch edit, drill-downs, and every toggle.

**Next**: decide whether to promote `v2.html` → `frontend.html` (retire the old gold/dark theme), or keep both routes live for a while longer.

**Known issues (backend, not v2-specific — logged as B4/B5 in BACKLOG.md):**
- Page loads trigger a synchronous full Plaid sync across all connected banks; under concurrent load this backed up the DB connection pool badly enough that some requests took 90-100+ seconds.
- `/api/cash-flow` returns all zeros for historical actuals (This Month / Last 30 Days) despite plenty of transaction activity — the forward-looking forecast (Next 30 Days) works fine, so it's specifically the actuals query/scoping that's off.

### Transactions Page Polish
- [x] Multi-select dropdowns for type, category, account filters
- [x] Account type capitalization fix (IRA, HSA, FSA, CD, 401(k))
- [ ] Investigate: Transactions page Expenses total vs Dashboard KPI mismatch when filtering by month

### Expense Credit-Netting Alignment
- [x] `/budget/actuals` — Income in expense-type categories nets against expenses
- [x] `/stats` — Same logic applied with `Category.category_type` filter
- [ ] Verify: user confirms KPI card now matches Budget vs. Actual

---

## Up Next (Priority Order)

1. **Mobile QA** — awaiting user's findings from mobile testing pass
2. **Account reclassification** — user needs to reclassify FSA/HSA from "Other Assets"
3. **Card Research Skill enhancements** — auto-capture benefits
4. **AI merchant classification** — "Ask AI" for null-CSC merchants

---

## Architecture Notes

### Stack
- **Backend**: FastAPI (main.py) + SQLAlchemy + SQLite
- **Frontend**: Single-file React (frontend.html) with inline JSX via Babel
- **Deployment**: Railway (auto-deploys from GitHub on push to main)
- **Data**: Plaid for bank sync, manual import via CSV

### Key Patterns
- `refreshKey` prop pattern (not `key={}`) to reload data without destroying component state
- Credit-netting: `Category.category_type.in_(['expense', 'both'])` for refund detection
- `fmtAcctType()` helper for consistent account type display
- `MultiSelectFilter` reusable component for checkbox-based multi-select dropdowns
- `_challenge_spend_for_card()` for per-card challenge spend tracking
- Modals: never close on backdrop click or Escape — only explicit buttons

### Theme
- **Dark**: Midnight luxury — `#0c0c10` bg, `#d4a44a` gold accent
- **Fonts**: DM Sans (300/400/500) + Playfair Display (400/600 for logo)
- **CSS**: `[data-theme="dark"]` / `[data-theme="light"]` with CSS variables
