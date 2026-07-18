# Moresheth — Backlog

> Maintained collaboratively. Update priorities here at the start of each session.
> Status: 🔴 Bug/Blocker · 🟡 High Priority · 🔵 Queued · 💡 Nice-to-Have

---

## 🔴 Active Bugs / Needs Verification

| # | Item | Notes |
|---|------|-------|
| B1 | **Challenges: NOT NULL constraint errors** | `product_id`, `required_spend`, `reward_value` — migration deployed; verify no new columns surface |
| B2 | **Challenges: "cannot load challenge" error** | `db.rollback()` fix deployed; verify challenge list loads cleanly |
| B3 | **Txn page Expenses vs KPI mismatch** | User reported Expenses total on Transactions page doesn't match KPI card when filtering by month — needs investigation |
| B4 | **Backend: slow requests under concurrent load** | Page loads trigger a synchronous full Plaid sync across all banks; DB connection pool backed up to 90-100s+ response times during v2.html QA pass. Needs profiling — likely pool size or sync-on-every-load pattern. |
| B5 | **`/api/cash-flow` returns all zeros** | Cash Flow page (both frontend.html and v2.html use the shared endpoint) shows $0 income/expenses/breakdown for every month and every range toggle (This Month/Last 30/Next 30), despite plenty of transaction activity. Likely scoped to checking/savings only and either the scoping logic or the underlying data tagging is off. Not a v2.html-specific bug — pre-existing backend issue. |

---

## 🟡 High Priority

| # | Item | Notes |
|---|------|-------|
| H1 | **Mobile QA pass** | User working through mobile-specific bugs — awaiting findings |
| H2 | **Account reclassification** | User should reclassify FSA/HSA accounts from "Other Assets" to correct type using the new dropdown |
| H3 | **Transaction: filter by description/merchant** | Text search input — already exists; verify working well |
| H4 | **Challenge: verify recalc correctness** | Confirm spend from `activation_date` → today captured correctly |
| H5 | **Card Research Skill — capture benefits** | Extract full benefit list and auto-POST to `/api/card-products/{id}/benefits` |

---

## 🔵 Features — Queued

| # | Item | Notes |
|---|------|-------|
| F1 | **Classify merchant with AI** | "Ask AI" button next to null-CSC merchants — Claude web-searches MCC/category → saves as merchant mapping |
| F2 | **Plaid re-link safety** | No duplicate transactions or broken accounts when re-linking a Plaid item |
| F3 | **Benefits: auto-track from transactions** | If a benefit has `trigger_category`, auto-update `amount_used` from matching transactions |
| F4 | **Challenges: suggestions / templates** | "Suggested challenges for your cards" — backend exists, wire to UI |
| F5 | **Visa/MC merchant category API** | Use Visa Supplier Locator API to look up merchant MCCs; map MCC → CSC |
| F6 | **Network-specific CSC overrides** | Per-network merchant mapping for earn rate accuracy |
| F7 | **Points valuation** | CPP multiplier per ecosystem to show estimated $ value alongside raw points |

---

## 💡 Nice-to-Have / Phase 2

| # | Item | Notes |
|---|------|-------|
| ~~N1~~ | ~~**PWA v2**~~ | ✅ Pull-to-refresh, swipe actions, skeleton loading, virtual scroll, offline support — all shipped |
| N2 | **Component refactor** | Extract frontend.html into proper component files |
| N3 | **Export to CSV/PDF** | CSV export exists; add PDF support for statement reconciliation |
| N4 | **AI-driven UI polish** | Use v0/Lovable for isolated components once functionality stable |

---

## ✅ Recently Completed

- **Cards module: font fix + txn table Action/Exclude controls (deployed 2026-07-17, round 2)** — Fixed 92 `DM Sans` references to a font that was never loaded (fell back to OS default), app-wide. Added inline Action-type editing and an Exclude/Include toggle to the Cards module's own transaction table. Found and fixed two related bugs: `/api/accounts/{id}/transactions` was hard-hiding excluded transactions instead of dimming them, and `row-excluded`/`row-locked`/etc. CSS classes were referenced but never defined anywhere in `v2.html`.
- **Points/Transfers overhaul (deployed 2026-07-17, commit `3fb7f33`)** — Redemption/Transfer/TransferRatio split, `compute_points_earn()` rewritten as a deterministic pure function (fixes 4 previously-inconsistent earn-rate call sites), Cash Back drill-down 422 fixed, Transfers UI + classification-aware points display ported into `v2.html`. Coordinated with the sibling MARGIN project via `MARGIN-MORESHETH-INTEGRATION.md`. Outstanding: manual `is_excluded` cleanup pass on large clawback transactions (benefit credits).
- **V2 redesign full QA pass** — Two passes across all 11 pages: visual (fixed 3 crashes + systemic ~20-class CSS gap breaking modals/headers) then functional (clicked every filter, modal, toggle, and drill-down). Found and fixed the circular `--blue-primary`/`--blue-vibrant` CSS variable bug (broke 72 usages app-wide) and the Daily Balances 30d/90d toggles silently ignoring their range. `v2.html` is now fully operational.
- **Multi-select filters** — Type, Category, Account dropdowns on Transactions page now support multiple selections
- **Account type capitalization** — IRA, HSA, FSA, CD, 401(k) display correctly everywhere
- **Expense credit-netting** — `/stats` and `/budget/actuals` both net refunds in expense categories
- **KPI card fix** — Reverted broken income reclassification, re-applied with correct category_type filter
- **Moresheth branding** — Full rebrand: gold coin logo, Playfair Display, PWA icons/splash, manifest, favicon
- **Cash Flow rework** — Scoped to checking/savings/cash accounts only, categorized breakdown
- **Account reclassification** — Dropdown to change account types (HSA/FSA from "other" to "savings")
- **Lock icon alignment** — Moved to far right with fixed-width spacer for consistent row layout
- **Budget credit-netting** — Income-action transactions in expense categories offset expenses
- **Cards earn rate** — Product lookup checks both account.product_id and card.product_id
- **CSC edit silent reload** — Points estimate updates after CSC change without full page refresh
- **Refresh preserves state** — refreshKey prop pattern instead of key={refreshKey} destroying components
- **Mobile GCB tagging** — Toggle in mobile transaction edit modal
- **Multi-card challenge explosion** — Per-card entries with individual spend tracking
- **Dashboard "See more"** — setPage prop passed to DashboardPage
- Cards Landing Page (ecosystem overview, per-card challenges, earn summary)
- Benefits & Credits CRUD, merchant CSC teaching, inline CSC editing
- CSC filter + points summary, monthly/QTD/YTD toggle
- Challenge bonus in Earn Summary, comprehensive NOT NULL migration
