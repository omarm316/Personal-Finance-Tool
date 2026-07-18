# Moresheth — Backlog

> Maintained collaboratively. Update priorities here at the start of each session.
> Status: 🔴 Bug/Blocker · 🟡 High Priority · 🔵 Queued · 💡 Nice-to-Have

---

## 🔴 Active Bugs / Needs Verification

| # | Item | Notes |
|---|------|-------|
| B1 | **Challenges: NOT NULL constraint errors** | `product_id`, `required_spend`, `reward_value` — migration deployed; verify no new columns surface |
| B2 | **Challenges: "cannot load challenge" error** | `db.rollback()` fix deployed; verify challenge list loads cleanly |
| B4 | **Backend: slow requests under concurrent load** | Page loads trigger a synchronous full Plaid sync across all banks; DB connection pool backed up to 90-100s+ response times during v2.html QA pass. Needs profiling — likely pool size or sync-on-every-load pattern. |
| B5 | **`/api/cash-flow` returns all zeros** | Cash Flow page (both frontend.html and v2.html use the shared endpoint) shows $0 income/expenses/breakdown for every month and every range toggle (This Month/Last 30/Next 30), despite plenty of transaction activity. Likely scoped to checking/savings only and either the scoping logic or the underlying data tagging is off. Not a v2.html-specific bug — pre-existing backend issue. |
| B7 | **Venmo mis-tagged "Healthcare" budget category** | A stray auto-created rule (`id=504`, "Auto-created from LLM enrichment") sets `set_category='Healthcare'` for any VENMO-pattern transaction — 5 rejections, 0 acceptances in its history, suggesting it's been silently wrong and manually corrected repeatedly. Found 2026-07-18 while adding the P2P Payments CSC. **Still not fixed** — now also visible directly in the Rules table (Settings → Rules) as "5m 0a 5r ⚠". A second, previously-undocumented bad Venmo rule was also found at priority 340 ("9m 0a 9r ⚠") — see B8. |
| B8 | **Rule cleanup pass — several rules with 100% rejection history** | Found 2026-07-18 once `times_rejected` was surfaced in the Rules table (Settings → Rules → STATS column, red ⚠ when rejected > accepted). Confirmed still active with 0 acceptances against real rejections: priority-340 Venmo rule (9m 0a 9r, duplicates B7's problem), `AUTOPAY` action rule (8m 0a 8r), `CHASE CREDIT CRD` (3m 0a 3r), `CITI AUTOPAY;CITI CARD ONLINE PAYMENT` (2m 0a 2r), `VERIZON` (2m 0a 2r), `TRANSFER` description rule (2m 0a 2r). Needs a human pass — each rule needs its own judgment call (fix pattern vs. deactivate vs. leave as duplicate-but-harmless), not a blanket delete. |

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

- **B6 fixed — `_check_transfer_correction()` over-generalization (deployed 2026-07-18)** — Root cause: the word-overlap safeguard counted merchant-name words as valid overlap, so a correction whose description was just the merchant name (e.g. "BEST BUY") became a no-op guard — it always matched, because every transaction from that merchant contains the merchant name too. Now excludes merchant-name words from the overlap set on both sides. Also fixed the actual delivery mechanism: `_reapply_rules(force_unlock=True)` (runs on every rule creation, `main.py:7446`) gated its locked-row loop on "does a rule match" but then applied the *full* `categorize()` output, including the separate correction-override — decoupled by adding an `apply_corrections` flag to `categorize()`, set to `False` in that branch so it only ever applies what its own gate check confirmed. Restored v2.html's missing GCB/Rule/Exclude row-action buttons (frontend.html had them, v2.html didn't) in the same pass — the Rule button matters beyond convenience since it's the only path that turns an LLM classification into a reusable rule. Surfaced `times_rejected` in the Rules table (previously tracked but not displayed) with a red ⚠ when rejections outnumber acceptances — immediately found B7 plus B8 (see above). **Caution for future sessions**: the local dev server points at the real production Postgres DB (`.env` `DATABASE_URL`, no separate test DB) — creating *any* rule unconditionally triggers a full reapply pass across all ~1800 transactions and ~530 rules, so even a throwaway test rule has real side effects. Verify against a non-mutating endpoint first where possible.
- **B3 fixed — Transactions page Expenses total diverging from KPI (deployed 2026-07-18)** — Root cause confirmed against live data across every month: under default settings the Transactions-page footer and the Dashboard KPI (`/api/stats`) already matched exactly. The one reproducible divergence was toggling "Show excluded" — its own tooltip says excluded transactions stay "hidden from totals," but the footer's `_budgetVisible` was built from the same list used for row display, so toggling it back into view also pulled it back into the sum (confirmed: two benefit-credit transactions caused an exact $550 gap for July). `_budgetVisible` now always excludes `is_excluded` rows regardless of the toggle. Also ported the Cards module's Redemptions/Transfers CRUD UI (already live in `v2.html`) into `frontend.html`'s `EcosystemDetailPage` — backend endpoints already existed, this just wired the UI; verified end-to-end (modal open/close, ecosystem dropdown population, live points-received calc).
- **Points-earn accuracy: P2P exclusion + Amex per-dollar rounding (deployed 2026-07-18)** — New "P2P Payments" CSC auto-excludes Venmo (and future Cash App/etc.) from points and SUB; backfilled 56 existing Venmo transactions. `compute_points_earn()` now rounds up to the nearest dollar before multiplying, scoped to Amex-issued cards only (verified: $4.66 × 7x → 35 pts, not 32.6). Found and fixed a real regression along the way: a stale learned correction was blanket-flipping every Best Buy transaction to `action='Transfer'`, exposed by triggering `_reapply_rules(force_unlock=True)` — reverted the 8 affected transactions. Underlying over-generalization bug in `_check_transfer_correction()` still needs a real fix — see PLAN.md.
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
