# Moresheth — Current Plan

> Updated each session. Tracks what we're actively working on and next steps.
> Last updated: 2026-07-16

---

## Current Focus

### V2 Redesign — Premium Glassy Blue (v2.html, served at `/v2`)
Gemini CLI built a full parallel redesign in `v2.html` (light/dark glassmorphic blue theme, static mockup at `/mockup`). Now doing a page-by-page QA pass to operationalize it before it can replace `frontend.html`.

- [x] Dashboard — fixed sidebar-overlap layout bug (orphaned CSS block, missing `@media (max-width: 480px)` wrapper)
- [x] Transactions — fixed crash (`TxnRow` referenced undefined `t` instead of `txn`)
- [x] Budgets — fixed crash (leftover reference to removed `error` state)
- [x] Daily Balances (incl. Liquidity Forecast card) — verified clean
- [x] Accounts, Net Worth, Cash Flow, Loans, GCB, Cards — verified clean
- [x] Settings — fixed unstyled Preferences/Data Management tabs
- [x] Systemic fix: added CSS for ~20 classes referenced in JSX but never defined in the stylesheet (`.modal*`, `.grid-*`, `.section-title/header/desc`, `.settings-*`, `.sel-drop`, etc.) — was breaking modals (rendered inline instead of as overlays) and leaving headers/labels unstyled across many pages

**Next**: decide whether to promote `v2.html` → `frontend.html` (retire the old gold/dark theme), or keep both routes live for a while longer.

**Known issue (backend, not v2-specific)**: page loads trigger a synchronous full Plaid sync across all connected banks; under concurrent load this backed up the DB connection pool badly enough that some requests took 90-100+ seconds. Worth profiling separately.

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
