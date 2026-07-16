# Moresheth — Current Plan

> Updated each session. Tracks what we're actively working on and next steps.
> Last updated: 2026-07-16

---

## Current Focus

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
