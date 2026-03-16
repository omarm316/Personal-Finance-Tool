# Finance App — Backlog

> Maintained collaboratively. Update priorities here at the start of each session.
> Status: 🔴 Bug/Blocker · 🟡 High Priority · 🔵 Queued · 💡 Nice-to-Have

---

## 🔴 Active Bugs / Needs Verification

| # | Item | Notes |
|---|------|-------|
| B1 | **Challenges: NOT NULL constraint errors** | `product_id`, `required_spend`, `reward_value` — comprehensive migration deployed; verify no new columns surface |
| B2 | **Challenges: "cannot load challenge" error** | `db.rollback()` fix deployed; verify challenge list loads cleanly |
| B3 | **Blank card page** | Benefits `try/except` + migration fix deployed; verify card detail loads again |

---

## 🟡 Cards Module — High Priority

| # | Item | Notes |
|---|------|-------|
| C1 | **Transaction: filter by description/merchant** | Text search input in the Transactions section; client-side filter on loaded rows |
| C2 | **Transaction: sortable columns** | Click any column header (Date, Description, Amount, Category, CSC, Rate) to toggle asc/desc |
| C3 | **Challenge: verify recalc correctness** | Confirm spend from `activation_date` → today is captured correctly after all the datetime fixes |
| C4 | **Card Research Skill — capture benefits** | When researching a card, extract full benefit list (name, $, frequency) and auto-POST to `/api/card-products/{id}/benefits` |
| C5 | **Cards Landing Page** | Portfolio overview: total annual fees, total annual credits, points by ecosystem, utilization across all cards, upcoming statement close/payment dates |

---

## 🔵 Features — Queued

| # | Item | Notes |
|---|------|-------|
| F1 | **Classify merchant with AI** | "Ask AI" button next to null-CSC merchants — Claude web-searches MCC/category → saves as merchant mapping |
| F2 | **Plaid re-link safety** | Guarantee no duplicate transactions or broken accounts when re-linking a Plaid item |
| F3 | **Benefits: auto-track from transactions** | If a benefit has `trigger_category` set, auto-update `amount_used` from matching transactions in the current cycle |
| F4 | **Challenges: suggestions / templates** | "Suggested challenges for your cards" based on `CHALLENGE_TEMPLATES` — already exists on backend, wire to UI |
| F5 | **Visa/MC merchant category API** | Use Visa Supplier Locator API to look up merchant MCCs programmatically; map MCC → CSC |

---

## 💡 Nice-to-Have / Phase 2

| # | Item | Notes |
|---|------|-------|
| N1 | **AI-driven UI polish** | Use v0 / Lovable to generate specific isolated components (charts, cards, icon sets) once functionality is stable; manually integrate |
| N2 | **Component refactor** | Extract the 7k-line frontend.html into proper component files — prerequisite for scalable AI-assisted UI work |
| N3 | **Dark mode** | CSS variable foundation is already in place |
| N4 | **Mobile / responsive layout** | Cards page and transaction table don't adapt well to small screens yet |
| N5 | **Export to CSV/PDF** | Export transactions for the selected period/filter — useful for bank statement reconciliation |
| N6 | **Points valuation** | Apply a CPP (cents-per-point) multiplier per ecosystem to show estimated $ value alongside raw points |

---

## ✅ Recently Completed

- Benefits & Credits section (full CRUD, usage tracking, progress bars, log usage inline)
- Merchant CSC teaching system (teach from inline edit, bulk assign from No-CSC view)
- Inline CSC editing on transactions
- CSC filter + points summary bar on transactions
- Monthly / QTD / YTD toggle with period navigation on transactions
- Challenge bonus section in Earn Summary (progress bar, threshold status)
- apiFetch signature fixes (DELETE, PATCH, POST methods)
- Comprehensive `spend_challenges` NOT NULL migration (covers all legacy relic columns)
- `merchant_points_mappings` wired into sync pipeline (user-taught patterns checked first)
- Main frame width increase
- Earn Summary rename + silent period refresh
