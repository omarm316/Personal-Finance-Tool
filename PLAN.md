# Moresheth — Current Plan

> Updated each session. Tracks what we're actively working on and next steps.
> Last updated: 2026-09-05

---

> Session writeups through 2026-07-26 are archived in
> [docs/archive/PLAN-sessions-through-2026-07-26.md](docs/archive/PLAN-sessions-through-2026-07-26.md).

---

## Session 2026-09-05 — Transactions: edit UX, "For Others" tag, merchant category/network engine

Omer's brief, framed as "our big focus": (1) editing a transaction visually "jumps" the table, (2) the row is too cramped — buttons bleed off-screen in edit mode, (3) "For Others" should stop being a category and become a tag (excluded from budget, kept for cash flow — same shape as GCB), (4) bring the Cards pages' merchant-category (CSC) logic into the main engine so every transaction can show a personal category *and* a merchant category, plus an identifier for which payment network coded it that way, and (5) a general visual/back-end cleanup pass, rules-based auto-classification included. Confirmed two defaults up front via AskUserQuestion before touching schema: existing "For Others" transactions reset to Unclassified + tagged (none existed live), and "merchant category" = the existing CSC/points_category system, extended rather than duplicated.

**Root-caused both UX bugs before touching anything:**
- The "jump" was `TransactionsPage.handleSave()` calling a full `load({silent:true})` — refetching all 500 transactions — after every single-row edit (Save, GCB toggle, Exclude toggle). `/api/transactions` had no secondary sort key (`ORDER BY date DESC` only), so Postgres doesn't guarantee stable order among same-day rows; combined with virtual scrolling (windows by scroll position, not by transaction id) for lists >80 rows, a refetch could silently reorder or reposition rows you weren't touching.
- The button bleed was `TxnRow.jsx`'s non-editing action cluster: up to 7 buttons (Review, Info, Edit, Split, GCB, Rule, Exclude, Lock toggle) crammed into one flex row with no wrap, in the table's last column.

**Fixes shipped:**
- `main.py`: `/api/transactions` now sorts `Transaction.date.desc(), Transaction.id.desc()` (stable). `PATCH /api/transactions/{id}` now returns the fully serialized updated row instead of `{"message": ...}`.
- `TransactionsPage.jsx`: `handleSave()` merges the PATCH response into local `txns` state by id instead of reloading — no more full-list refetch/reshuffle on a single-row edit. Batch edit and delete still do a full `load()` (correctly, since those can add/remove rows from view).
- `TxnRow.jsx`: the row's non-editing action row is now just a few small status chips (⭐/👥/🔒) plus Info/Edit/Split — GCB toggle, For Others toggle, Exclude toggle, Lock toggle, and "Create Rule" moved into the Details modal, which has room for them as labeled buttons instead of icon-only squeezed buttons. `.edit-actions` also got `flex-wrap: wrap` as a defensive fallback. Verified live: editing no longer moves other rows, Save/Cancel stay fully visible with no horizontal scroll needed.
- **Found and fixed a real, unrelated pre-existing crash while verifying**: `MobileTxnList.jsx` called two `useState` hooks *after* an early `return` for the desktop branch — classic "rendered fewer hooks than expected" bug, dormant because `useIsMobile()`'s initial value rarely changes mid-render, but reproducible by deep-linking straight to `#transactions` (blanked the whole app, not just this page, since an uncaught render error unmounts the whole React tree with no ErrorBoundary catching it). Hoisted both hooks above the branch. Bumped `sw.js` `CACHE_VERSION` to `v14` since this class of fix needs the shell cache evicted to reach real users.

**"For Others" → tag (mirrors `is_gcb` exactly):** New `Transaction.is_for_others` / `TransactionSplit.is_for_others` columns. Excluded from `/api/stats`, `/api/stats/detail`, `/api/budget/actuals`, `/api/budget/suggestions`, and the Transactions page's own local expense/income summary — but deliberately **not** `/api/cash-flow`, since GCB *is* excluded there (a separate business's cash movement) but "For Others" money genuinely still moved through the user's own accounts. "For Others" removed from `seed_categories()` (the seeder auto-deactivates removed rows) and from `VALID_CATEGORIES`/`_CATEGORY_REMAP` in `llm_service.py`. Old `_CAT_REMAP` aliases (`Siblings`/`Parents`/`For Others` → the old target) now resolve to `Unclassified` instead of resurrecting the dead category — this migration runs on every startup, so it already fixed the 6 live `CategorizationRule` rows that used to `set_category='For Others'` (all Excel-imported Israeli merchant patterns — pharmacy/supermarket/telecom) the moment the server restarted. Added `for_others:true` as a rule-notes marker (mirroring the existing `gcb:true` convention) so those same 6 rules also auto-tag `is_for_others=True` going forward, both in the Plaid sync path and — previously missing entirely — the CSV/OFX import path. Frontend: toggle button added everywhere GCB already had one (`TxnRow`, `MobileTxnModal`, `BatchEditModal`, `SplitEditorModal`, `ManualTransactionModal`), plus removed from category dropdowns/sort-last lists (`format.js`, `constants.js`, `BudgetsPage.jsx`, `Sidebar.jsx` comment).

**Merchant category (CSC) + network, brought into the main engine:** This was `points_category` — previously only editable buried in `AccountCardDetailPage`, and its `MerchantPointsMapping.card_id` scope field was **silently never consulted** by either the Plaid-sync auto-classifier or the "teach merchant" backfill — both only ever checked the global (`card_id IS NULL`) tier. Fixed via a new shared `_resolve_merchant_csc()` helper (card-specific > network-specific > global precedence) used by both ingestion paths and the `/api/merchant-csc` backfill.

**Correction mid-session, from Omer directly: "issuer" was the wrong axis.** Built the first pass around `Card.issuer` (the issuing bank — Chase, Bilt, Amex-the-bank, etc.), but the real mechanic the user cares about is the **payment network** (Visa/Mastercard/Amex/Discover — `Card.network`), since that's what actually determines how a merchant gets coded, not which bank issued the card. Renamed throughout before this ever reached a real user: `MerchantPointsMapping.network` (the briefly-live `.issuer` column stays as an unused, harmless column per this table's additive-only migration convention — see `gcb_tagged` for precedent — rather than a destructive rename), `_build_network_lookup()`, `_resolve_merchant_csc(..., network)`, `/api/merchant-csc` body param `network`, frontend `txn.network` / "All networks" filter / "Every {network} card" scope option. Verified live against real data: Bilt Obsidian Card correctly resolves to network `MC` (Mastercard), not issuer `BILT`.

Shipped: `Transaction`/`TransactionResponse` gained `network` (derived from `account.card.network` via a new bulk `_build_network_lookup()`, not stored — computed same as the existing points-rate lookup) and `card_id` (was missing from the API response entirely, needed by the frontend to scope "this card only"). `TxnRow.jsx` Details modal gained a Network info tile and an editable "Merchant Category" block (dropdown of `/api/points-categories` + a scope selector: this card / every {network} card / all cards) that both PATCHes the transaction and calls `/api/merchant-csc` to teach the rule forward. New `GET /api/merchant-csc` (list, with resolved card name) and `DELETE /api/merchant-csc/{id}` — this rule set was previously create-only with no way to see or remove a taught mapping. Transactions page gained an "All networks" multi-select filter (options derived from loaded transactions — verified live: exactly AMEX/DISCOVER/MC/VISA, matching Omer's four).

**Data-integrity note worth remembering for next session:** early in this session, standalone `python3 -c "from database import init_db..."` verification scripts didn't call `load_dotenv()` (only `main.py` does, at import time) and silently fell back to the SQLite default (`sqlite:///./finance.db`) instead of the real Railway Postgres — a stale local `finance.db` file from some earlier point in this project's life was sitting in the repo root and looked plausible enough (real-looking rule patterns) to not immediately notice. One rule-cleanup fix was first (harmlessly) applied to that wrong local file before being caught and redone correctly against production with `load_dotenv('.env')` explicit in the script. The stray local file has been deleted (it was gitignored, never tracked). **Any future standalone DB script in this repo must explicitly `load_dotenv('.env')` before importing from `database.py` — `database.py` itself never loads it.**

**Verified live, both against the real Railway Postgres:** edit-in-place with no row reshuffle and no overflow; GCB/For Others/Exclude/Lock toggles all working from the Details modal with the page's live expense total updating accordingly; deep-linking straight to `#transactions` no longer blanks the app; Network tile shows `MC` for a Bilt Obsidian Card; setting a merchant category with "every {network} card" scope correctly created a `MerchantPointsMapping(network=...)` row and is picked up by `_resolve_merchant_csc`; "For Others" gone from `/api/categories`; all test data (a manual category edit, a test merchant-category rule, a test For-Others tag) cleaned up from production afterward.

**Not done, flagged for a future session:** no dedicated "Merchant Rules" review UI yet (backend list/delete endpoints exist, ready for one); the general "visual polish" pass (item 5) was addressed only where it intersected with the row-decluttering work above, not as a standalone pass; card-scope (as opposed to network-scope) teaching was implemented symmetrically but not separately live-tested.

---

## Session 2026-08-10 — Citi Strata Premier onboarding question → fixed the general "new card" gap (B18)

Omer asked how to make sure his newly-acquired **Citi Strata Premier** shows up on the Citi ThankYou ecosystem page — automatically, or at least without the manual DB fixup every prior new card (Business Gold, Bilt, AA Platinum Select) has needed.

**Checked live production DB first, read-only, before touching anything.** `citi_strata_premier` (product id 44) already exists in the catalog exactly as the 2026-07-30 prep note said — real rates, the $100 hotel credit, card art — but **no `Account` row exists yet**: Omer hasn't linked the physical card via Plaid. So today's actual gap isn't the catalog, it's that even once linked, nothing auto-creates the `Card` row the earn/benefits engine needs (this is the B18 "sync doesn't auto-create a `Card` row" gap, hit by hand for every card so far).

**Fixed the recurring cause rather than doing another one-off manual fix** (Omer's choice when asked): added `_ensure_cards_for_new_accounts()` (`main.py`), called right after account reconciliation in both places `Account` rows get created — `exchange_public_token` (first-time Plaid Link) and `_sync_item_background`'s `clear_cursor` branch (Update Mode / "+ Add Account" on an existing item, the path Omer will actually use). It auto-creates a `Card` row for each brand-new credit-card account only — deliberately not a sweep of every Card-less credit account on an item, because **B31** (found 2026-08-10, same day) documents a still-open duplicate/mislabeled account sharing a mask with a real one on the Amex connection; a blanket backfill would have handed that duplicate a permanent `Card` row and complicated its planned cleanup.

Also fixed, found while doing this: `CardProduct.status` ('active'/'not_held', shown as a badge on the card detail page) was **write-once at seed time and never updated** — linking/unlinking/changing a product never touched it. Added `_refresh_product_held_status()`, called from `link-product` and `change-product`, that recomputes it from whether any `Account`/`Card` actually references the product. Also caught and fixed a small dual-write drift while there: unlinking an account previously cleared `account.product_id` but left `Card.product_id` stale — now clears both.

**Not done — needs Omer to actually run Plaid Link**, this can't be done from the backend: add the Strata Premier account to the Citi connection via Settings → Connected Banks → "+ Add Account". **Important per B30**: that flow re-presents the *full* account checklist for the connection — Omer must re-check every existing Citi account (Double Cash 8475, Custom Cash 3240, AA Platinum 1855, Citi Checking 6816), not just the new card, or they risk silent de-authorization like the Amex/Chase connections did. Once linked, the existing product-suggestion matcher should offer "Citi Strata Premier" as a one-click Confirm on the Cards page, and the new auto-Card-creation should mean no further manual step is needed — worth a live spot-check once Omer actually links it.

**Next**: verify end-to-end once the real Plaid Link happens (does the suggestion match correctly, does the Card row appear, does the ecosystem page pick it up). Also still open: B31 (Amex BBP/Platinum mask-collision cleanup) and the West Elm/Fidelity `Card`-row backfill this fix intentionally left alone.

---

## Session 2026-07-31 — Amex MR: cover-banner hero implemented for real, new card onboarded

Follow-through on the mockup Omer approved ("ABSOLUTELY gorgeous!!!", one fix requested — drop the CPP "assumed value" line, done). Asked to implement it for real, starting with Amex MR, then extend the pattern to the rest.

**Detour first — Omer had synced a new card, "Amex Biz Gold," and asked why it wasn't showing up + how to make sure new cards always do.** Traced it: genuinely new, unlinked account (`Business Gold Card 1000`, item "American Express (Omer)"), no catalog product existed for it. Answered the "how do we make sure" half directly: once the hero/card-grid reads off `data.by_card` (server-computed, not hardcoded), any correctly-linked card shows up automatically — the real prerequisite is Plaid sync + a `Card` row + a linked `CardProduct`, not frontend code. Used the card-research skill to pull real rates for the American Express® Business Gold Card (web search, not memory — $375/yr, 1x base, 4x on top-2-of-6 categories per billing cycle up to $150K/yr, plus 4 real periodic benefits), added it to the catalog as `amex_business_gold`, then did the now-familiar manual fix for a newly-synced account: created the missing `Card` row, linked the product, relocked its 6 transactions. The 4x-top-2 mechanic doesn't fit the existing `auto_top_category` engine (single category, $500/month cap — built for Citi Custom Cash) — modeled at 1x base only rather than faking the bonus, logged as B29.

**Then the actual implementation.** Found B19's real root cause while wiring the hero's card-art fan up against live data: `by_card_out` in `main.py` (both the regular and cash-back branches of `ecosystem_earn_detail`) never included `product_key`, so `EcosystemDetailPage.jsx`'s art/gradient lookup was always keyed on `''` — every ecosystem page's "Your Cards" list has been silently falling back to a blank box since the art-wiring work on 2026-07-24, not just Amex MR's. One-line fix in each branch. Also found the existing row list rendered card art at `opacity:0.4`, a second, independent cause of the washed-out look.

Implemented in `EcosystemDetailPage.jsx`: a cover-banner hero (ecosystem logo, capped 3-card art fan with a "+N more" chip, current posted balance as the primary figure, pending line beneath, QTD secondary) replacing the old plain stat block, and a real tile grid for "Your Cards" with a graceful brand-gradient-plus-name fallback for any card with no art file yet (verified live against the new, art-less Business Gold card — reads clean, not broken). Also fixed a real, unrelated-to-B19 color bug found in the process: Amex MR's badge/hero was `#059669` (green) against real (blue) Amex card art and logo — corrected to Amex's actual blue.

**Verified live**: dev server rebuilt (`npm run build`) and reloaded — required manually unregistering the service worker + a cache-busting reload to see the new build (SW caching bit again, same class of issue noted in earlier sessions; worth remembering: after any `frontend/` change, verifying via the dev server needs a forced SW/cache clear, not just a normal reload). Hero renders correctly in both themes with the real 4-card fan (Platinum ×2, BBP shown + "+1" for Business Gold), Business Gold's fallback tile shows its name legibly on the gradient, no console errors, the separate Portfolio-page tile grid (different component, untouched) unaffected.

**Not done, both already logged**: B20 (duplicate-looking "Other" categories, still visible, still deferred) and the new B29 (Business Gold's 4x-top-2 bonus not modeled).

**Next**: same hero pattern for the remaining ecosystem pages (Chase UR, Marriott Bonvoy, Citi ThankYou, Hilton Honors, etc.). Both backend fixes (`product_key`, the color-mismatch class of bug) already apply everywhere via the shared endpoint — worth spot-checking each ecosystem's badge color against its real brand before assuming it's fine, since Amex's green was apparently never checked against reality. Full detail in BACKLOG.md's Recently Completed section.

---

## Session 2026-07-30 (cont'd) — B4 + B28: the app is now fast

B28 was the visible symptom of B4, so they were fixed together. Headline: the
Transactions page went from rendering **"No transactions found"** indefinitely to
**464 rows in ~1 second**.

**The recorded cause of B4 was wrong, and profiling is what found that.** The backlog
had said "page loads trigger a synchronous full Plaid sync across all banks." I checked
every `@app.get` route for sync calls — **none triggers a Plaid sync**. The actual cause
was ordinary N+1 lazy-loading in two endpoints:

| endpoint | before | after |
|---|---|---|
| `/api/accounts` | 98 queries / 7.1s | **3 queries / 0.31s** |
| `/api/transactions?limit=500` | 70 queries / 5.5s | **8 queries / 1.0s** |

The `/api/accounts` fix is the interesting one: `get_account_balance()` re-fetches the
`Account` it was handed the id of *and* runs a per-account `SUM`, so calling it in a
loop cost two round-trips per account. The new `get_account_balances_bulk()` expresses
the same anchor model set-wise — `date(t.date) > date(a.start_date)` is exactly
equivalent to the scalar version's end-of-anchor-day comparison. Accounts with a
*future* anchor take the walk-backward branch, which has no set-wise equivalent, so
they fall back to the per-account path rather than complicating the query.
**Checked against all 48 real accounts: zero mismatches, 6.97s → 0.07s.**

For `/api/transactions`, `contains_eager` was the right tool rather than `joinedload`:
the query already joined `Account`, so `contains_eager` populates the relationship from
the join that was already being paid for, where `joinedload` would have added a second.

**B28 turned out to be three independent faults**, all worth fixing even now that the
backend is fast, because each would resurface under any future slowness:
1. `load()` coupled two fetches in one `Promise.all`, so either failing discarded both.
2. `sw.js` answered a failed `/api/` fetch with an empty **array** at status 503 — a
   payload indistinguishable from a legitimate "no results" for any caller that reads
   the body before the status. Now an explicit error **object**.
3. The empty state didn't distinguish "no results" from "failed to load."

**Method note that keeps paying off:** three times this session the backlog's *stated*
cause was wrong (B26's product lookups, B4's Plaid sync, B14 being open at all) and
profiling or a direct query found the real one in minutes. Treat the backlog's diagnosis
as a hypothesis, not a finding — especially on items logged weeks earlier.

---

## Session 2026-07-30 (cont'd) — Vite Phase 2: the component split

`main.jsx` (10,957 lines) → **62 modules**: `lib/` (3), `hooks/` (1), `components/` (44),
`pages/` (13), `App.jsx`, `main.jsx` (a 5-line entry).

**Done mechanically, and that was the right call.** Before writing anything I built the
dependency graph and ran Tarjan SCC over it: **zero cycles**. That is what made a
scripted split safe — imports are *computed from the graph*, not hand-written, so
nothing can be missed or go stale. The splitter lives in the session scratchpad; the
important part is the method, not the script.

**The bug worth remembering.** My first pass stripped comments *and string literals*
before scanning for references, to avoid false-positive imports. That was actively
wrong: JSX **text** routinely contains a bare apostrophe — `If you're re-linking...` —
which the naive regex read as the start of a string literal and used to swallow
everything up to the next quote. It ate `usePlaidLink`'s JSX through to
`useHashRouter`'s `useCallback`, which built fine and then threw
`ReferenceError: useCallback is not defined` at runtime. Fixed by stripping **comments
only** and detecting on raw code: over-detection is the safe direction, since every
symbol is exported so a spurious import is harmless and tree-shaken.

**A tell worth knowing:** the broken split produced a *smaller* bundle (635 kB vs
654 kB) precisely because the missing edges let real code be tree-shaken away. After
the fix it is 654.60 kB against the pre-split 654.63 kB — a 30-byte delta. **If a
refactor makes the bundle unexpectedly smaller, suspect lost references, not a win.**

**Verified:** all 94 symbols still exported (none missing, none extra); every line of
the original accounted for before writing; zero cycles; build clean; all 11 routes
render with no console errors.

### A severe pre-existing bug found while verifying — B28

The Transactions page renders **"No transactions found"** on a cold load. I suspected
my split and disproved it properly: rebuilt the pre-split monolith bundle and got the
identical result. The data path is fine (500 txns / 47 accounts, and the page's exact
`Promise.all` succeeds by hand in the console).

Cause is a three-way interaction: `load()` couples the transactions and accounts
fetches in one `Promise.all`, the backend is slow on a cold load (B4 — ~6.8s per call,
`--workers 1`), and `static/sw.js` answers a failed `/api/` fetch with
`Response(JSON.stringify([]), {status:503})`. `apiFetch` throws on `!res.ok`, so that
stub rejects the whole `Promise.all` and the table renders empty. **A backend slowdown
is being presented to the user as a confident, wrong empty state.** Full writeup and
the three separate fixes in BACKLOG.md.

---

## Session 2026-07-30 (cont'd) — Docs cleanup + Vite migration (Phase 1)

Omer: "start with cleanup, then the split."

**Docs cleanup — 186KB → 49KB.** BACKLOG.md 83→30KB, PLAN.md 103→19KB, with everything
older archived under `docs/archive/`. These two files are read at the start of every
session, so they were the largest *recurring* context cost in the project — bigger than
the code, which is only ever read in ranges. Also rewrote **Architecture Notes**, which
had drifted into being actively misleading (claimed SQLite, named the retired
`frontend.html`, described the long-removed gold theme) and added a "Traps that have
bitten more than once" section.

**Vite migration, Phase 1 — toolchain only, deliberately not the component split.**
The risky parts of this change are the build tooling and the Railway deploy, not the
file layout. So step one moves the *entire* former `v2.html` script into a single
`frontend/src/main.jsx` and proves the pipeline end to end. Phase 2 (splitting into
`components/`, `pages/`, `hooks/`, `lib/`) is now a pure refactor with a working build
underneath it and no deployment risk attached.

- `frontend/` — Vite + React 18 + `@vitejs/plugin-react`. Builds to `static/app`
  (`base: '/static/app/'`), which FastAPI's existing `/static` mount already serves.
- `main.py`: new `_frontend_index()` serves the build and **falls back to `v2.html`
  with a loud warning** if it's missing, so a fresh checkout still runs. `/`, `/v2`
  and `/plaid/oauth-return` all use it. `/v2` also stopped reading the file into a
  string and now returns a `FileResponse` like the others.
- `Dockerfile` is now multi-stage: `node:20-slim` builds, `python:3.11-slim` serves.
  Build output is gitignored and never committed.
- `static/sw.js` → `v12`, and its CDN precache list is now empty — React, ReactDOM and
  Babel are no longer fetched from cdnjs. Bumping the version is what evicts the old
  shell cache holding the pre-build HTML.

**A real bug the build caught that in-browser Babel had silently tolerated:** a
duplicate `display` key in one object literal (`display:'block'` then `display:'flex'`
on the same style object, v2.html ~line 5124). The second wins, so the first was dead
code. Worth knowing that esbuild surfaces this class of thing that Babel-standalone
just swallowed.

**Verified:** clean `npm ci && npm run build` reproduces identical asset hashes; `/`
serves the built index with no cdnjs/Babel tags; all 10 routes render with **zero
console errors**; `typeof Babel === 'undefined'` confirms the in-browser compiler is
gone; DOMContentLoaded is **15ms** (previously gated on downloading 736KB of HTML and
Babel-transforming ~11k lines on every load).

**Not verified — flagged deliberately:** Docker is not available in this environment,
so the multi-stage image build itself is untested. The failure mode is safe (a failed
Railway build leaves the current deploy live), and the two things most likely to break
it were found and fixed by inspection: `npm ci` needs the lockfile (committed), and
`frontend/node_modules` had to be added to `.dockerignore` or `COPY frontend/ ./`
would overwrite the container's install with macOS-native binaries. **Watch the first
Railway deploy.**

---

## Session 2026-07-30 (cont'd) — Backlog audit, B5 fixed, Plaid capability question

Omer handed over prioritization ("go by whatever you feel you should prioritize"), mentioned he holds a **VentureOne (no annual fee)** and just acquired a **Citi Strata Premier** that should sync soon, and said the next deep-dives are **Cash Flow, Daily Balances, and Loans**.

**Safety note discovered here: the local dev server is pointed at the production Railway Postgres** (`DATABASE_URL` in `.env`), not a local SQLite file. Every "live verification" in recent sessions has therefore been against real production data. Read-only audits are safe; writes need to be deliberate.

**Stale-item audit against production** (the five "verify" items I'd flagged as suspect turned out to be worth checking):
- **B14 closed as already-done** — `capital_one_venture_one` (id 46) exists and is active, account 152 linked, Card row 17 present. Fixed on 2026-07-26, never closed out.
- **B18 scope corrected and narrowed** — orphaned transactions are 1,356 → 583, but only **4** are on a credit account (all on West Elm 6184). The other 579 are Checking/Savings/HSA/FSA/Investment where a NULL `card_id` is correct. Two active credit accounts still lack a `Card` row: West Elm 6184 (blocked on F12's research) and Fidelity Visa Signature (0 transactions, so nothing is being lost).
- **Correction worth recording:** I first reported "no active credit account lacks a Card row" from a query filtering `account_type='credit'` — the real value is `'Credit Card'`, so it matched nothing and I read an empty result as a clean bill of health. Re-ran correctly. **`account_type` capitalization is a recurring trap in this codebase** — it is exactly what caused B5 too.

**B5 fixed** — `/api/cash-flow` all zeros. Same capitalization trap: the cash-account filter used lowercase literals against capitalized stored values, matched zero accounts, and short-circuited to an `empty` return. One-line fix (`func.lower(...)`). Prioritized specifically because it gates the Cash Flow deep-dive Omer asked for next. Full detail in BACKLOG.md.

**Strata Premier prep:** `citi_strata_premier` (id 44) already exists in the catalog with real researched rates (added 2026-07-24), currently `status='not_held'`. When the account syncs it will need: status → active, account → product link, and a **`Card` row created manually** — sync still doesn't auto-create one (the B18 addendum gap). No research needed; the catalog entry is ready.

**B26 fixed — 43s → 9s.** Full detail in BACKLOG.md. The method note worth keeping: **profiling first completely changed the diagnosis.** The backlog attributed the slowness to per-account `CardProduct` lookups; those were real but only 2.7s of 43s. The actual dominant cost was `calc_auto_top_category_points()` issuing **one query per calendar month** while being called with `start_date=2000-01-01` — ~318 round-trips for a single Citi Custom Cash account. Nothing about reading the code suggested that; it fell out of counting queries by SQL shape.

Two things this session established that should shape future perf work here:
- **The DB is remote (Railway proxy), so query *count* is the cost, not query complexity.** ~70ms per round-trip means 596 queries ≈ 41s before a single row is processed. Batch aggressively; prefer one `IN` query plus Python grouping over anything per-entity.
- **Prove perf refactors by diffing the actual response.** Captured all three periods plus six drill-downs, `git stash`ed, re-captured from the original, diffed recursively: zero differences. That is much stronger than spot-checking a few numbers, and it caught nothing only because the refactor was actually correct — the `timestamp` vs `date` comparison trap in `_compute_ecosystem_balance` would have surfaced here if I hadn't handled it.

**Next up:** B4 (sync-on-every-page-load) → then the Cash Flow / Daily Balances / Loans deep-dives.

---

## Session 2026-07-30 — Dashboard cleanup (B22/B23/B24 + `isMob`), and a much bigger mobile bug

Picked the Dashboard cluster off the backlog — the four items logged during the 2026-07-27 review. Mid-session Omer reported: **"scrolling does not work on my iphone, only when i rotate it to landscape."** That turned out to be an app-wide layout bug, not a Dashboard one, and took priority.

### The scrolling bug (highest-value find of the session)

The landscape/portrait asymmetry was the whole clue: it pointed at something gated on the 768px breakpoint. The mobile media query sets `.app-container { flex-direction: column }`, which flips the main axis to vertical. `.main` carried `min-width:0` — the fix for the *row* axis — but not `min-height:0`. Because `.main`'s `overflow` is `visible`, its automatic minimum size (`min-height:auto`) resolves to its full content height, so it grew past `.app-container`'s fixed height; `.content`'s `flex:1` then resolved against that inflated height and the scroll container ended up exactly as tall as its own content. `overflow:hidden` on `.app-container` clipped the remainder, making it permanently unreachable.

Fix is one declaration: `min-height: 0` on `.main`. Measured at 375×812 before → after: `.main` 1412px → 812px, `.app-container` scrollHeight 1412 (600px unreachable) → 812, `.content` 1348/1348 → 1096/748, and `scrollTop=400` went from a no-op to landing at the true max (348).

**Worth internalizing:** `min-width:0` and `min-height:0` are *axis-specific*. A flex item that's safe in a row container can break the moment a media query flips the container to column. And `overflow-y:auto` zeroes an item's automatic minimum size, which is why `.content` was never the problem and why this stayed latent — the flaw was one level up, on the item that *doesn't* scroll.

### The four Dashboard items

All shipped; full detail in BACKLOG.md's Recently Completed. Summary:
- **B22** — mirrored the desktop `RowEl`'s `hasBudget`/`isCredit`/`noBudget`/`over` flags into the mobile Top Budgets card. Also aligned `over` to desktop's `>=100` and killed the negative-% credit case. Cross-checking the rendered rows against `/api/budget/actuals` surfaced a **second** instance the backlog hadn't found ("For Others", $947.45).
- **B23** — 11 → 8 requests per dashboard load; removed the dead state plus `expCats` and `getDates()` (the latter became dead once `statsQ` went).
- **B24** — KPI cards 2-up on mobile, scoped `:not(.grid-3):not(.grid-4)` to avoid restructuring other pages' fixed grids. Verified by measuring real text widths (99px widest vs 133px available) rather than eyeballing.
- **`isMob`** — swapped for the existing `useIsMobile()` hook. This had been logged as a duplicate **B26**, colliding with the `/api/cards/earn-summary` item; that one is still open and keeps the number.

**Two method notes for next session:**
1. **The preview browser's `resize_window` does not dispatch a `resize` event.** It updates CSS media queries (the rendering engine handles those), but React hooks listening for `resize` never fire — so a resize-driven state fix looks broken when it isn't. Dispatch `new Event('resize')` manually to test. Cost a few minutes chasing a non-bug.
2. **The service worker re-registers on load and will serve stale HTML again** even after you've cleared it once — the first network batch on a fresh navigation came back showing the *old* request set. Clear it and re-navigate before trusting any network-log measurement. This is the same trap as the 2026-07-27 note; it recurs every session that edits `v2.html`.

**Not done:** B25 (the $299 basis mismatch) is still open — it needs a decision from Omer on which basis the dashboard should present, not a code change.

---

## Session 2026-07-28 — Card detail: annual fee vs. credits

Omer classifies both the annual fee itself and any credits he redeems under the general category `Fees & Interest` — asked for a way to see, at the card level, whether the fee "makes sense" by netting that category.

**Design agreed before building:** the existing "Annual Fee" KPI tile on `AccountCardDetailPage` (top stats row) was the natural home rather than a new section. Net cost = `sum(amount)` for `Fees & Interest`-categorized transactions (fee posts negative, credits post positive, so the sum falls out naturally) within the *current annual-fee cycle* — anchored to `Card.issue_date`'s month/day (the anniversary, added in an earlier session) rather than calendar year, so a fee charged in March correctly nets against credits redeemed through the following February even though that crosses Jan 1. Falls back to calendar year when `issue_date` is unset. Clicking the tile drills into the Transactions table below, filtered to that category + cycle window — same pattern already used for challenge-card clicks.

**Shipped:**
- `_annual_fee_cycle_window(issue_date)` (`main.py`) — the anniversary-anchored cycle helper, handles Feb 29 safely.
- `account_card_detail()` gained `annual_fee_summary` (`fee_charged`/`credits_received`/`net_cost`/`cycle_start`/`cycle_end`), computed from `Fees & Interest`-categorized txns (`category_manual`/`category_auto`, independent of the points-category/CSC field — annual fees and credits are typically points-category-less) in the current cycle.
- `account_transactions()` gained a `category` query param (general category, separate from the existing `csc` param) so the drill-down can filter on it.
- Frontend: Annual Fee tile shows `$X net` + `$Y fee · $Z credits` and is clickable when there's cycle activity (falls back to the plain sticker-fee display when there's none to drill into yet); reused/generalized the existing challenge-click-to-filter machinery (`challengeFilterName` badge copy now generic — "Filtered: X" — since it now serves two triggers, not just challenges) with a new `catFilter` state threaded through `loadTxns()`.

**Verified live** against Amex Platinum 1009 (real fee/credit data: $895 fee, $537 credits, cycle correctly anchored to the card's 3/25 issue-date anniversary → showed "$358 net"); confirmed the click-through filters the transaction table to exactly those 16 `Fees & Interest` rows, and the dismiss (✕) correctly clears both the date range and the new category filter back to the default Monthly view.

**Found, not fixed, unrelated to this change:** `/api/cards/earn-summary` (the Portfolio page's per-ecosystem earn tiles) took ~44s to respond during verification — pre-existing N+1-style per-account product lookups in that endpoint, not something touched today. Worth a dedicated look; logged as B26 in BACKLOG.md.

---

## Session 2026-07-27 (cont'd) — Dashboard layout pass

Omer's five follow-ups after the review below: 0–100% budget bars with 25/50/75 markers, thicker bars matching his proposal artifact, no "INCOME" label, Spending Trend and Recent Transactions as a 50/50 row with a hover-reveal "See more", and the old full-width Recent Activity table removed. All five shipped and verified in both themes at desktop and mobile widths — detail in BACKLOG.md's Recently Completed.

**Reference resolution note:** "similar to the proposal we recently looked at together" didn't match anything in `mockups/` (all five files there use 3–5px bars, *thinner* than what was live). Asked rather than guessed; Omer supplied a claude.ai artifact URL, which `WebFetch` can read directly — that gave the exact spec (24px track, 6px radius, in-bar right-aligned label at 10.5px/700). Worth remembering that artifact URLs are fetchable, since design references for this project increasingly live there rather than in the repo.

**Two corrections made during verification that the spec didn't cover** — both are cases where transplanting the artifact's values 1:1 would have been wrong, because the artifact assumed a *shared* scale and Omer had asked for a 100% scale:
- The artifact's soft fills (0.16 alpha) work for short over-budget bars. At a 100% scale, over-budget rows fill the entire track — so the faintest color ended up on the rows that most need attention. Over/near now weighted heavier than under-budget.
- The % label right-aligns to the track, so below 100% it sits on empty track rather than on the fill; `--blue-soft`/`--amber` there fails contrast in light theme. Only over-budget keeps a status color.

**Service-worker gotcha, cost real time:** after editing `v2.html`, the page kept executing a stale cached copy and threw `RecentTransactionsCard is not defined` for a function that was demonstrably in the file and in the server's response. The PWA service worker (`shell-v11`/`api-v11` caches) was serving the old HTML. Diagnose by reading the live `<script type="text/babel">` content and searching it for the new identifier — if it's missing there but present in `curl` output, it's the cache. Fix: unregister every SW registration, `caches.delete()` all keys, reload. Add this to the checklist alongside the Babel-syntax-error-blanks-the-page note below.

---

## Session 2026-07-27 — Dashboard page review

Omer: "let's look closely at the Dashboard page." Read it live at desktop and mobile widths and checked every displayed figure against the API rather than eyeballing it — which is what surfaced the main bug, since the chart *looked* plausible.

**Three fixes shipped** (all in `DashboardPage`, `v2.html`; full detail in BACKLOG.md's Recently Completed):
1. **Spending Trend was plotting spending + income** — `getMonthTotal` didn't apply the `Transfer`/`Work` SKIP set the rest of the dashboard uses, and `Work` is income. Not just a scale error: the chart claimed March was peak spending and declining since, when March was actually the *lowest* month and May the peak.
2. **Spending Trend ignored the year selector** — the 6-month window was built from `new Date()` while the data came from the `viewYear` payload, so picking 2025 plotted 2025 figures under 2026 labels. Window now ends on the selected month, and the header carries an explicit range label.
3. **"Checking & Savings" % badge was fabricated** — prior balance estimated as `current − net cash flow`, which rendered "+583%" in Annual YTD. Dropped rather than faked.

**Method note worth repeating:** the Spending Trend bug had been live for a while and is invisible to inspection — the line is smooth, the axis is sane, the numbers are the right order of magnitude. It only fell out of pulling `/api/budget/actuals` directly and summing it two ways (all categories vs. ex-`Transfer`/`Work`). For any dashboard number, compute the expected value from the API and diff it against the pixel; don't trust "looks about right." A related tell that would have caught it faster: the July chart point (16.1k) contradicted the Budget Performance Total (7.0k) *on the same screen* — cross-check figures against each other before assuming both are fine.

**Second method note:** consolidating the duplicate `const SKIP` was mandatory, not tidiness — two `const` declarations of the same name in one block scope is a syntax error, and per the 2026-07-26 session note that manifests as a fully blank v2.html with no useful console output. Check for an existing declaration before adding one to a shared IIFE body in this file.

**Logged, not fixed** (all found during this pass, all deferred to keep the change reviewable): **B22** mobile Top Budgets shows "$4,060.50 left" for a category with no budget; **B23** 3 of 11 dashboard API calls feed state nothing renders (ties into B4's slow loads); **B24** KPI cards stack 1-per-row on mobile, ~1,300px of scroll before content; **B25** the Expenses KPI and Budget Performance Total differ by $299 (`Work`-categorized expenses) with no indication they're on different bases.

**Not investigated:** whether the Recent Activity list should filter credit-card transfers server-side — it fetches `limit=12` then drops rows client-side, so it renders fewer than 12 (10 at the time of review). Cosmetic, no ticket opened.

---


---

## Architecture Notes

> Rewritten 2026-07-30. The previous version had drifted badly out of date —
> it claimed SQLite (it's Postgres), named `frontend.html` as the frontend
> (retired), and described a gold theme (removed in the 2026-07-25 gold→blue
> pass). Corrected against the actual code; keep this section honest.

### Stack
- **Backend**: FastAPI (`main.py`, ~11.8k lines, 176 routes) + SQLAlchemy
- **Database**: **PostgreSQL on Railway.** `DATABASE_URL` in `.env` points at
  `mainline.proxy.rlwy.net` — i.e. **the local dev server reads and writes
  production data.** SQLite (`finance.db`) is only a fallback default in
  `init_db()` and is not what runs. Two consequences worth remembering:
  every "live verification" is against real data, and **every query is a
  remote round-trip (~70ms)** — so query *count* dominates performance, not
  query complexity (see the B26 writeup).
- **Frontend**: `v2.html` — single-file React, ~11.4k lines / 736KB, 56
  components, JSX transformed **in the browser by Babel at runtime**.
  `frontend.html` is retired and should not be edited.
- **Deployment**: Railway, auto-deploys from GitHub on push to `main`.
- **Data in**: Plaid sync (`transactions` product only) + CSV/OFX import.

### Theme (v2.html)
- "Premium Glassy Blue" — `--blue-primary` accent. **There is no gold.**
  `--gold` was removed app-wide on 2026-07-25; `--amber` survives as a
  separate warning-state token that happens to share the old hex.
- **Fonts**: Plus Jakarta Sans (body) + Outfit (headings/logo/metric values).
- `[data-theme="dark"]` / `[data-theme="light"]` driving CSS custom properties.

### Key patterns
- `refreshKey` prop (not `key={}`) to reload data without destroying state.
- Points are **locked at write time** (`_lock_points_for_transaction()`), never
  recomputed on read — this is what lets a card's product change without
  rewriting history. `Transaction.points_earned` is the read path.
- `_compute_ecosystem_balance()` is shared by `/api/ecosystems/{id}/earn-detail`
  and `/api/cards/earn-summary` specifically so the two can't diverge on what
  "current balance" means. Don't inline a second copy.
- `MultiSelectFilter` for checkbox multi-select dropdowns.
- Modals never close on backdrop click or Escape — explicit buttons only.

### Traps that have bitten more than once
- **`account_type` capitalization.** Stored capitalized (`'Checking'`,
  `'Credit Card'`, `'HSA'`). Lowercase comparisons silently match nothing and
  fail *open* — an empty result reads as "no problems found." Caused B5, and
  caused a wrong audit conclusion the same day. Compare case-insensitively.
- **A JS syntax error in `v2.html` blanks the whole app** with no useful
  console error, because Babel's transform fails wholesale. If the page is
  blank, suspect the compile first. The "deoptimised … exceeds 500KB" notice
  *appearing* is the sign the compile succeeded.
- **The service worker serves stale HTML** after edits, and re-registers on
  load. Unregister all registrations + `caches.delete()` every key, then
  re-navigate, before trusting anything you see or measure.
- **`min-width:0` / `min-height:0` are axis-specific** on flex items. The
  mobile media query flips `.app-container` to `column`, which is why portrait
  scrolling broke app-wide while landscape worked.
- **`Transaction.date` is a timestamp; most other date columns are `date`.**
  Comparing them in Python is a `TypeError`; SQL coerces silently.
