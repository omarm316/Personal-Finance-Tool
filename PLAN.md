# Moresheth — Current Plan

> Updated each session. Tracks what we're actively working on and next steps.
> Last updated: 2026-09-06

---

> Session writeups through 2026-07-26 are archived in
> [docs/archive/PLAN-sessions-through-2026-07-26.md](docs/archive/PLAN-sessions-through-2026-07-26.md).

---

## Session 2026-09-06 — Scoping only: `main.py` → domain routers split (backend token-usage refactor)

Omer asked how to cut token usage per session; the frontend is already fine (each page is
its own file under `frontend/src/pages/`, one per Vite-split component — see the
2026-07-30 writeup below). The actual monolith is the **backend**: `main.py` is
**12,196 lines / 177 routes**, so any backend-touching session — regardless of which
page it's for — has the whole file in play. Scoped the split below; **nothing has been
touched yet**, this is planning only, to be executed as its own dedicated session(s) per
the one-session-per-module convention.

### Proposed structure

`main.py` shrinks to app setup only: `FastAPI()`, static mount, `CORSMiddleware`,
`PasswordMiddleware`/`RequestLoggingMiddleware` (both defined here), the login page +
`/api/auth/*` (small, tied to the password gate), `get_db`, the `@app.on_event("startup")`
seed call, and one `app.include_router(...)` per domain module below. Target ~300-400 lines.

**`core/` — shared modules every router imports, extracted first:**
- `core/serializers.py` — `serialize_account`, `_serialize_txn`, `_serialize_card`,
  `_serialize_challenge`, `_serialize_redemption`, `_serialize_balance_snapshot`,
  `_serialize_adjustment`, `_serialize_transfer_ratio`, `_serialize_transfer`,
  `_serialize_person_transfer`, `_serialize_benefit`, `serialize_loan`,
  `_overlay_to_dict`, `_salary_to_dict`
- `core/points_engine.py` — `infer_points_category`, `calc_earn_rate`,
  `compute_points_earn`, `calc_auto_top_category_points`, `_build_product_rate_maps`,
  `_build_points_lookup`, `_resolve_merchant_csc`, `_build_network_lookup`,
  `_resolve_product_for_date`, `_lock_points_for_transaction`,
  `_compute_ecosystem_balance`, `_statement_close_date`, `_points_pending`,
  `_load_products_by_id`. **This is the module that has to exist** — Architecture Notes
  already flags `_compute_ecosystem_balance()` as deliberately shared between
  `/api/cards/earn-summary` and `/api/ecosystems/{id}/earn-detail` "so the two can't
  diverge"; cards.py and ecosystems.py cannot each get their own copy.
- `core/accounts_helpers.py` — `classify_account`, `get_account_balance`,
  `get_account_balances_bulk`, `ACCOUNT_TYPE_MAP`, `_account_hash`,
  `_content_base_hash`, `_assign_content_hash`, `_sign_plaid_balance`,
  `_plaid_anchor_date`, `rebuild_monthly_snapshots`, `_refresh_current_month_snapshot`,
  `_ensure_cards_for_new_accounts`, `_refresh_product_held_status`
- `core/challenges_helpers.py` — `_challenge_progress`, `_recalc_challenge`,
  `_challenge_spend_for_card`, `_sync_challenge_links`, `_current_cycle`, `_cycles_for_year`
- `core/import_helpers.py` — `_compute_import_hash`, `_parse_csv_rows`,
  `_parse_ofx_rows`, `_build_preview` (shared by `/api/transactions/import` and the
  `/api/init/*` bulk-import routes)

**`routers/` — one file per domain, Pydantic request/response models colocated with
their own router (they're declarations, not logic — no token-cost reason to split
them out separately):**
1. `plaid_routes.py` — `/api/plaid/*`, `/plaid/oauth-return`
2. `accounts.py` — `/api/accounts/*` (incl. duplicates/merge/sync-balances),
   `/api/accounts/{id}/card-detail`, `/balance-timeline`, `/reconcile`,
   `/api/reconciliation/*`, `/api/balances/monthly`
3. `transactions.py` — `/api/transactions/*` (splits, manual, batch-update, import)
4. `cards.py` — `/api/cards/*`, `/api/card-products/*`, `/api/benefits/*`,
   `/api/points-categories`
5. `ecosystems.py` — `/api/ecosystems/*`, `/api/redemptions`, `/api/transfer-ratios`,
   `/api/transfers`, `/api/person-transfers`, `/api/balance-snapshots`,
   `/api/points-adjustments`
6. `challenges.py` — `/api/challenges/*`
7. `rules.py` — `/api/rules/*`, `/api/merchant-csc`, `/api/init/*`
8. `budgets.py` — `/api/budget/*`
9. `net_worth.py` — `/api/net-worth/*`
10. `loans.py` — `/api/loans/*`
11. `cash_flow.py` — `/api/cash-flow*`, `/api/cash-flow-overlays`,
    `/api/salary-payments`, `/api/daily-balances`, `/api/forecast/{account_id}`
12. `llm.py` — `/api/llm/*`
13. `misc.py` — `/health`, `/mockup`, `/v2`, `/api/stats*`, `/api/categories`,
    `/api/transaction-types`, `/api/export/csv`, `/api/planned-purchases`

### Method (reusing what worked for the Vite Phase 2 split)

The `main.jsx` → 62-module split (below) worked because it was **scripted, not
hand-copied**: a dependency graph was built, checked for cycles (Tarjan SCC, zero
found), and imports were computed from the graph rather than typed by hand. Do the
same here — build the graph over ~180 route handlers + ~70 helper functions (which
helper calls which, which globals/models each touches), assign each helper to `core/`
if ≥2 domains use it, then move code by script per the graph rather than by hand.
**Over-detect references, don't under-detect** — the Vite split's real bug was a regex
that under-matched (stripped string literals containing an apostrophe) and silently
dropped a real dependency; an unused import here is harmless, a missing one is a
runtime `NameError`.

**Verify by:** route count identical before/after (177 in, 177 out, same
path+method set), existing tests still pass (`tests/`), and live smoke-test each
migrated domain against production data the same way every session in this backlog
already does.

### Phasing (not started)

Do `core/` first — every router depends on it. Then split domains in order of
coupling, cheapest/lowest-risk first, since each phase proves the method before the
riskiest one:
1. `loans.py`, `cash_flow.py`, `llm.py`, `misc.py` — self-contained, few/no
   cross-domain helper calls
2. `budgets.py`, `net_worth.py`, `accounts.py`, `transactions.py`, `rules.py` —
   moderate, mostly depend on `core/accounts_helpers.py` + `core/serializers.py`
3. `cards.py`, `ecosystems.py`, `challenges.py` — do last, together — this is the
   cluster that shares `core/points_engine.py` most heavily and has the least clean
   boundary (see the `_compute_ecosystem_balance()` note above)

Not scheduled yet — flagged in BACKLOG.md (H7) for a future dedicated session, likely
several given the phasing above.

---

## Session 2026-09-06 (cont'd) — H7 Phase 0 executed: `core/` extraction

Did the Phase 0 extraction scoped above in the same session (Omer asked to continue
past scoping). **Router split (Phase 1+) is still not started** — this was `core/`
only, `main.py` keeps every one of its 177 routes, just importing helpers instead of
defining them inline.

**Method, per the scoped plan:** built the dependency graph with an AST script rather
than by hand — for each of the 51 target functions/constants (the ones named in the
`core/` breakdown above), walked its AST for every `Name` reference and intersected
against main.py's top-level symbol table, then closed the graph transitively. That
closure surfaced **8 additional helpers the original scoping pass didn't name**:
`_best_description`, `_compute_pmt_split`, `_guess_issuer`, `_ISSUER_NAME_MAP`,
`_CC_PAYMENT_KW`, `_MERCHANT_POINTS_PATTERNS`, `_NON_EARNING_CATS`, `_PFC_POINTS_MAP` —
each pulled in by a named target (e.g. `_serialize_txn` calls `_best_description`,
`_ensure_cards_for_new_accounts` calls `_guess_issuer`). All 8 moved alongside their
callers into the same core module. Two of them (`_CC_PAYMENT_KW`, `_compute_pmt_split`)
are *also* called from route code staying in `main.py`, so `main.py` re-imports those
two from `core/` as well.

After writing each core module, ran a second, stricter static check — a scope-aware
AST walker (not just a flat name-intersection) that resolves every `Name` load against
a real nested-scope model (function params, comprehension/for/with targets, except
handlers, walrus, etc.) — over each finished `core/*.py` file in isolation, looking
for any name with no binding anywhere in scope. First pass found exactly one:
`core/challenges_helpers.py`'s `_sync_challenge_links` used `ChallengeCardLink` /
`ChallengeCategoryLink` (both SQLAlchemy models from `database.py`) that hadn't been
added to that module's import line — caught before it ever ran, fixed, re-checked
clean. This is the same class of bug the Vite split's postmortem flagged (a
under-detecting regex silently dropping a real reference) — over-detecting here (the
8 extra helpers, plus this stricter unresolved-name pass) is what caught it instead.

**Result:** `main.py` 12,196 → 10,129 lines. Five new modules: `core/serializers.py`,
`core/points_engine.py`, `core/accounts_helpers.py`, `core/challenges_helpers.py`,
`core/import_helpers.py`. Internal cross-core imports needed: `serializers.py` imports
`classify_account` from `accounts_helpers` and `_challenge_progress`/`_current_cycle`
from `challenges_helpers`; `challenges_helpers.py` imports `_NON_EARNING_CATS` from
`points_engine`. No core module imports from `main.py` (checked via AST, not
substring-grep — a substring check false-positived on every module's own "Extracted
from main.py" docstring).

**Verified clean, all four ways specified in scope:**
1. **Route parity** — AST-extracted every `@app.<method>(path)` decorator from both
   old and new `main.py`: 177 routes in both, identical (method, path) set.
2. **No circular imports** — confirmed via AST (`ImportFrom.module` / `Import.names`
   never starts with `main` in any `core/*.py`), and by actually importing all five
   modules plus `main` itself in one process with no error.
3. **Test suite** — `tests/` uses an in-memory SQLite DB (never touches production),
   but its `client` fixture triggers FastAPI's real `@app.on_event("startup")` per
   test, which runs seeding against the **production** Postgres via the module-level
   `SessionLocal` (pre-existing main.py behavior, confirmed byte-identical between old
   and new `main.py` — not something this session introduced, but worth knowing: it's
   why the suite takes ~23 min against the remote DB's per-call latency). Ran the full
   suite before and after (via `git stash`/`stash pop` to isolate `main.py` while
   keeping `core/` on disk): **53 passed, 4 failed both times, same 4 tests**
   (`tests/test_earn_rates.py`'s `TestProductLookup`/`TestCashBackEarnRate`/
   `TestParentCategoryFallbackIntegration` — all integration tests hitting
   `/api/cards/earn-summary` through `client`). Confirmed pre-existing, not a
   regression — this is the already-tracked B27, re-confirmed against this
   refactor rather than a new find.
4. **Live smoke test against production** — started the real server (old `main.py`
   via `git stash`, then new `main.py`) on the same data and diffed
   `json.dumps(resp, sort_keys=True)` for `/api/transactions`, `/api/accounts`,
   `/api/cards/earn-summary`, `/api/ecosystems`, `/api/ecosystems/11/earn-detail`,
   `/api/challenges`, `/api/net-worth` — **byte-identical on every endpoint**.

**Not done / next**: Phase 1 (splitting `main.py`'s 177 routes into the 13
`routers/*.py` files listed above) — explicitly not started per Omer's instruction to
stop after Phase 0 verification.

---

## Session 2026-09-06 (cont'd, 2) — H7 Phase 1 batch 1: `loans.py`, `cash_flow.py`,
## `llm.py`, `misc.py` split out of `main.py`

Omer said to go ahead and start Phase 1. Did the first phasing batch exactly as
scoped ("self-contained, few/no cross-domain helper calls"): `routers/loans.py`,
`routers/cash_flow.py`, `routers/llm.py`, `routers/misc.py` — 38 routes total. The
other 9 domains (including `plaid_routes.py`, see gap noted below) are still inline
in `main.py`, unstarted.

**Method:** same AST dependency-graph script as Phase 0, extended from
function-level to route-level — for the ~38 target routes/Pydantic models, walked
each one's AST for every top-level name it references, closed the graph
transitively, then also ran the *reverse* check (grep every moved name against the
post-edit `main.py` to confirm nothing left behind still calls it) — that reverse
check is new this round and is a cheap, high-value net given the scale.

**This phase surfaced a structural problem Phase 0 didn't have to deal with:**
a router module cannot `from main import X` for anything, since `main.py` imports
the router modules to call `app.include_router(...)` — any helper a moved route
needs that (a) isn't already in `core/` and (b) is *also* needed by a route still
in `main.py` creates an unavoidable circular import unless it moves somewhere
neither side has to import from the other. Four such items surfaced, each fixed by
promotion rather than duplication:

- **`get_db`** — every future router needs `Depends(get_db)`; moved from `main.py`
  into `database.py` (right next to `SessionLocal`, which it wraps — its natural
  home, not really a `core/` concern). `database.py` also now keeps `engine`/
  `SessionLocal` as live module globals (`init_db()` sets them via `global`, in
  addition to still returning them so `main.py`'s existing
  `engine, SessionLocal = init_db()` line needs no change) — needed because
  `routers/llm.py`'s background enrichment worker grabs `SessionLocal` directly
  (no request to scope a `Depends()` to). **This only works because the router
  imports in `main.py` are placed *after* `engine, SessionLocal = init_db()` runs**
  — a router doing `from database import SessionLocal` at its own top level would
  otherwise permanently bind the pre-`init_db()` `None` placeholder if imported
  first. Documented inline in `main.py` at the import site since it's a real
  footgun for whoever adds the next router.
- **`core/app_helpers.py`** (new) — `_frontend_index()`, needed by both `main.py`'s
  `/` route and `routers/misc.py`'s `/v2`. Also fixed a latent bug while moving it:
  it (and `routers/misc.py`'s `/mockup`) built its file path from
  `os.path.dirname(os.path.abspath(__file__))` — correct in `main.py`, silently
  wrong one directory level off once copied into `core/` or `routers/`. Added a
  `PROJECT_ROOT` constant computed once, correctly, from `core/app_helpers.py`'s
  own location, and pointed both call sites at it. This class of bug compiles,
  imports, and passes the in-memory-SQLite test suite cleanly — only a live
  request against the real filesystem layout would ever surface it, which is
  exactly why the live-smoke-test step below exists.
- **`core/constants.py`** (new) — `BUDGET_TYPES` is read by `routers/misc.py`'s
  `/api/stats*` (moved) *and* transaction/budget routes still in `main.py` (not
  yet split). `TRANSACTION_TYPES`/`BALANCE_TYPES` only need `routers/misc.py` today
  but were kept alongside it as one related trio rather than splitting them
  across two homes.
- **`core/rules_helpers.py`** (new) — `_reapply_rules` is called by 3 not-yet-split
  `/api/rules/*` routes (still in `main.py`) and by `routers/llm.py`'s
  `create_rule_from_transaction` (moved now). Same shape as the `_compute_ecosystem_balance()`
  precedent from the original `core/` scoping — a function two not-yet-siblinged
  call sites both need, so it goes to `core/` rather than either one importing
  from the other.

None of these four were named in the original Phase 0 `core/` scoping — expected,
per the plan's own "over-detect, don't under-detect" framing: the scoping pass was
done once, up front, before any router had actually been cut loose from `main.py`,
so it could name the *big* shared engines (`points_engine`, `serializers`, etc.) but
not every small infra seam a real split would expose. Recorded here rather than
silently patched so the pattern is visible for Phase 1's remaining batches.

**Gap found, not resolved:** `plaid_routes.py` is item 1 in the original router
list but was never assigned to any of the three phasing batches (1: loans/cash_flow/
llm/misc, 2: budgets/net_worth/accounts/transactions/rules, 3: cards/ecosystems/
challenges) — a plan omission, not a deliberate deferral. Its two biggest helpers
(`_sync_item`, `_sync_item_background`, ~450 lines combined) are called by plaid
routes *and* by `/api/accounts/{id}/reset-and-resync` (accounts.py, Phase 2) *and*
by `/api/reset-all` / `/api/nuke` / `/api/accounts/backfill-balances` (three routes
that also aren't assigned to any listed domain). Left entirely untouched this
session — deliberately didn't guess at a phase for it. Needs a decision before
Phase 1 continues: which batch plaid_routes.py belongs to, and where those three
orphan routes go (accounts.py looks likeliest given backfill-balances, but reset-all/
nuke touch every domain's tables).

**Verified the same four ways as Phase 0:**
1. **Route parity** — AST-diffed `(method, path)` across `main.py` +
   `routers/misc.py` + `routers/loans.py` + `routers/cash_flow.py` + `routers/llm.py`
   against the pre-Phase-1 commit: 177 in both, zero missing, zero extra.
2. **No circular imports** — confirmed via AST (no `routers/*.py` or `core/*.py`
   imports `main`) and by importing every new module plus `main` in one process.
3. **Reverse-reference check** (new this round) — grepped all 51 moved names
   against the edited `main.py`: zero remaining references, confirming nothing was
   left calling a name that no longer exists there.
4. **Test suite**: 53 passed / 4 failed, identical to the Phase 0 baseline (same
   B27 failures).
5. **Live smoke test against production** — `git stash`ed to the pre-Phase-1 commit,
   hit `/health`, `/api/categories`, `/api/transaction-types`, `/api/stats`,
   `/api/stats/detail`, `/api/loans`, `/api/cash-flow`, `/api/cash-flow-overlays`,
   `/api/salary-payments`, `/api/daily-balances`, `/api/planned-purchases`, `/v2`
   (raw HTML), `/api/llm/test-groq` on both old and new `main.py` — **byte-identical
   on every endpoint, including the HTML page** (which is what caught whether the
   `PROJECT_ROOT` fix above actually worked, since the in-memory test suite alone
   couldn't have).

**Result:** `main.py` 10,129 → 8,489 lines. New: `routers/__init__.py`,
`routers/misc.py`, `routers/loans.py`, `routers/cash_flow.py`, `routers/llm.py`,
`core/app_helpers.py`, `core/constants.py`, `core/rules_helpers.py`. `database.py`
gained `get_db()` plus module-level `engine`/`SessionLocal`.

**Not done / next**: the plaid_routes.py phasing decision above, then the rest of
Phase 1 batch 1's remaining domains don't exist (batch 1 is now fully done: loans,
cash_flow, llm, misc). Batch 2 (`budgets.py`, `net_worth.py`, `accounts.py`,
`transactions.py`, `rules.py`) and batch 3 (`cards.py`, `ecosystems.py`,
`challenges.py`, together) are unstarted — same stop-and-verify convention applies,
waiting for Omer to say go.

---

## Session 2026-09-06 (cont'd, 3) — H7: `plaid_routes.py` assigned and split out

Omer said to assign `plaid_routes.py` to a phase and continue. **Decision: its own
standalone extraction, not folded into batch 2's `accounts.py`.** Reasoning: its
~450-line sync engine (`_sync_item`/`_sync_item_background`) is needed by plaid
routes *and* by one not-yet-split `accounts.py` route
(`reset_and_resync_account`) *and* by three still-unassigned routes
(`/api/reset-all`, `/api/nuke`, `/api/accounts/backfill-balances`) — rather than
wait for accounts.py to decide the engine's home, promoted it straight to
`core/plaid_sync.py` now (same shape as `_compute_ecosystem_balance()` and this
session's earlier `_reapply_rules` promotion: a function needed by call sites on
both sides of a not-yet-drawn router boundary goes to `core/`, full stop). This
also means whichever session does batch 2's `accounts.py` next inherits a
already-solved dependency rather than having to solve it under batch 2's own
time pressure.

**Method**: same as batch 1 — AST dependency-graph script extended to this
domain's 18 routes + 2 Pydantic models + the 2-function sync engine, then the
scope-aware unresolved-name checker on each assembled file, then the reverse
grep-for-leftover-references check against the edited `main.py`.

**The scope-aware checker earned its keep again**: the AST reference-detector
(the one that intersects a function's `Name` loads against main.py's top-level
symbol table) silently missed that `_sync_item_background` calls
`SessionLocal()` directly — because `SessionLocal` is bound via
`engine, SessionLocal = init_db()`, a **tuple-unpacking assignment**, and the
detector's top-level-assign collector only recognized `ast.Name` targets, not
`ast.Tuple` targets, so `SessionLocal` was invisible to it as a top-level name
at all. The stricter unresolved-name checker (which walks real nested scopes
rather than a flat name-set) caught it immediately when run against the
assembled `core/plaid_sync.py`. Recorded as a known gap in the first script for
whoever runs this method again in batch 2/3 — the second-pass checker is not
optional, it is what actually catches this class of miss.

**New import-order landmine, same root cause as `routers/llm.py`'s in batch 1
but now touching `main.py` itself**: `core/plaid_sync.py` does
`from database import SessionLocal` at its own top level (needed because
`_sync_item_background` grabs its own session for a background task). Main.py's
*own* `reset_all`/`reset_and_resync_account` need `_sync_item_background` too,
so `main.py` now also does `from core.plaid_sync import _sync_item_background` —
and that import was first written into `main.py`'s top-of-file import block,
alongside all the other `core/*` imports, which run **before**
`engine, SessionLocal = init_db()`. Caught by re-running the live check this
session already relies on (`database.SessionLocal is core.plaid_sync.SessionLocal
and is not None`, checked after import) rather than by either static checker —
neither AST tool can see "this import happens too early," only a live import
does. Fixed by moving that one import down next to the router imports, all of
which already run after `init_db()`. Worth remembering as its own rule for
future phases: **any core/ module that touches `SessionLocal` directly (not
through `get_db`) must only ever be imported after `init_db()`, in main.py or
in any router** — `get_db()` itself is exempt (it resolves `SessionLocal` lazily
inside the generator body, at first request, by which time `init_db()` has
always already run).

**Verified the same way as every prior batch:**
1. **Route parity** — 177/177 across `main.py` + all 5 `routers/*.py` files,
   diffed against the pre-session committed state (had to include the
   already-existing `routers/*.py` files from batch 1 in the "before" set too,
   not just `main.py` — comparing against `main.py`-alone at HEAD would have
   shown 38 false "EXTRA" routes purely from batch 1 already having moved them
   out before this session started).
2. **No circular imports.**
3. **Reverse-reference check** — zero leftover calls to any of the 24 moved
   names in the edited `main.py` (one hit was a comment mentioning `_sync_item()`
   by name, not a real reference).
4. **Test suite**: 53 passed / 4 failed, identical to every prior baseline.
5. **Live smoke test against production** — `git stash`ed to the pre-session
   commit and diffed `/api/plaid/items` (pure DB read, no live Plaid call) and
   `/api/accounts` old vs new. `/api/accounts` was byte-identical.
   `/api/plaid/items` differed only in `last_synced_at` timestamps on 5 items —
   traced to Omer's own long-running local dev server (been running since
   before this session) periodically syncing in the background between the two
   curl calls; `account_count`/`transaction_count`/every other field matched
   exactly, confirming this was real background activity, not a code
   difference. Deliberately did **not** smoke-test any state-mutating plaid
   endpoint (sync-transactions, reset-and-resync, exchange-token, etc.) against
   production — the DB-read comparison plus the other four checks were enough
   without touching live Plaid state for a verification exercise.

**Result:** `main.py` 8,489 → 6,989 lines. New: `routers/plaid_routes.py` (18
routes: link-token creation, item CRUD, sync triggers, diagnostics, account
recovery), `core/plaid_sync.py` (the shared sync engine + its two Plaid-code
lookup tables, `PLAID_TYPE_FALLBACK`/`_PLAID_PFC_MAP`, which turned out to be
used by nothing else and moved along with the engine).

**Not done / next**: the three still-unassigned routes (`/api/reset-all`,
`/api/nuke`, `/api/accounts/backfill-balances`) remain in `main.py`, now calling
`core.plaid_sync._sync_item_background` — still no home decided; likeliest is
`accounts.py` given `backfill-balances`, but `reset-all`/`nuke` touch every
domain's tables and might be better as their own `admin.py` rather than forced
into accounts.py. Worth deciding at the start of batch 2 rather than guessing
now. Batch 2 (`budgets.py`, `net_worth.py`, `accounts.py`, `transactions.py`,
`rules.py`) and batch 3 (`cards.py`, `ecosystems.py`, `challenges.py`, together)
remain unstarted.

---

## Session 2026-09-06 (cont'd, 4) — H7 Phase 1 batch 2: `budgets.py`,
## `net_worth.py`, `transactions.py`, `rules.py`, `accounts.py`, `+admin.py`

Omer said to continue with batch 2. Much bigger than batch 1 or plaid_routes —
~56 routes across 5 named domains, plus the reset-all/nuke/backfill-balances
orphans flagged last session as needing a decision. `main.py`: 6,989 → 3,802
lines. What's left in `main.py` now is entirely the batch-3 cluster
(cards/ecosystems/challenges) plus app setup — nothing from batch 2 remains
inline.

**Orphan routes, resolved:** `backfill_account_balances` went into
`routers/accounts.py` (grouped with `sync_account_balances` — same "anchor this
account's balance from Plaid" job, just a one-time variant, regardless of where
it originally sat in the file). `reset_all` and `nuke_everything` got a new
**`routers/admin.py`** — neither is really accounts business logic (both wipe
data across accounts/transactions/plaid_items at once), and forcing them into
`accounts.py` would have muddied that router's actual domain boundary.

**Domain-assignment call not explicit in the original router list:**
`upload_and_import_cards` (`/api/cards/upload-and-import`) and
`upload_and_import_points` (`/api/points/upload-and-import`) went into
`routers/rules.py`, not a `cards.py`/`points.py` of their own — they're
Excel-catalog-import routes doing the exact same job as `import_cards_endpoint`
(`/api/init/import-cards`, already listed under rules.py) two routes below them
in the original file. Grouped by what the code does, not by URL prefix — same
reasoning as the plaid_routes.py `_sync_item`/`_sync_item_background` call.
`account_transactions` (`/api/accounts/{id}/transactions`) went into
`accounts.py` alongside `account_card_detail`, both per-account detail views
under the `/api/accounts/` prefix.

**Two more Pydantic models found by the closure, not the original per-route
scan:** `SplitCreate` (used only inside `SplitsRequest`'s own field
declaration, not by any route body directly) and `ManualSplitItem` (same shape,
nested inside `ManualTransactionCreate`). Neither route-level dependency script
run this project has used checks a model's OWN field-type references — only
route bodies — so a model referenced solely from inside another model's type
annotation is invisible to it. Caught by grepping each candidate model name
before finalizing the file, now flagged explicitly for whoever runs this method
in batch 3: check every Pydantic model moving with a domain for further models
in its own field types, not just what the routes reference directly.

**Same `__file__`-relative-path class of bug as batch 1, worse this time — 4
occurrences, not 1:** `import_cards_endpoint`, `upload_and_import_cards`,
`upload_and_import_points`, and `import_rules` all built their Excel-file paths
from `os.path.dirname(os.path.abspath(__file__))`, correct in `main.py`, wrong
one directory level deeper in `routers/rules.py`. Fixed the same way as
`serve_mockup` in batch 1 — replaced all 4 with `core.app_helpers.PROJECT_ROOT`.
Grep for `__file__` across every block being moved before assembling a router
file, every batch, going forward — it is the single highest-value check for
catching bugs that no import-checker or test suite (in-memory SQLite has no
`cards.xlsx` to find) will ever surface, only a live filesystem check will.

**Two genuine pre-existing bugs found by this session's own verification
tooling, confirmed present in the original pre-Phase-0 commit (9e49571) via
`git show`, not caused by this refactor — logged to BACKLOG.md rather than
fixed (both are in the not-yet-touched batch-3 `cards.py` domain / a
cross-cutting query, out of scope for a router-split session):**
- `get_card_detail`'s "last N months" branch calls `timedelta(...)` with no
  `timedelta` import anywhere in `main.py` (only `datetime` is imported) — a
  `NameError` waiting to fire the first time that code path actually runs.
  Found by running the scope-aware unresolved-name checker (built for
  verifying router extractions) against the *whole* remaining `main.py`, not
  just the newly-written files — worth doing again after every future batch,
  since it can only ever surface pre-existing dead code once enough of the file
  has been extracted around it to make the checker's job small enough to run
  whole-file.
- `get_net_worth`'s account query has no `ORDER BY`, so Postgres does not
  guarantee row order across calls — showed up as the *only* diff in this
  session's own `/api/net-worth` live smoke-test comparison (one account's
  position shifted in the "Cash & Savings" bucket list; every account's actual
  data was byte-identical). Confirmed non-deterministic-order, not a data
  bug, by running both old and new one more time and observing the same class
  of reordering happen even without any code difference at all — this is
  exactly the class of bug `/api/transactions` was already fixed for (stable
  `ORDER BY date DESC, id DESC`, see the 2026-09-05 session) but `get_net_worth`
  was missed.

**Verified the same four ways as every prior batch:**
1. **Route parity** — 177/177 across `main.py` + all 11 `routers/*.py` files,
   diffed against the pre-session committed state (again including the
   already-existing router files in the "before" set, not just `main.py`).
2. **No circular imports.**
3. **Reverse-reference check** — zero leftover calls to any of the 78 moved
   names in the edited `main.py`.
4. **Test suite**: 53 passed / 4 failed, identical to every prior baseline.
5. **Live smoke test against production** — `git stash`ed to the pre-session
   commit and diffed 9 endpoints (accounts, transactions, rules, budget
   targets/actuals, net-worth, reconciliation, duplicate-detection,
   merchant-csc) old vs new. 7 byte-identical; the 2 that differed
   (`net-worth`, `reconciliation`) were both traced to causes unrelated to this
   session's code (the pre-existing missing-ORDER-BY above, and — same as the
   plaid_routes.py session — Omer's own already-running dev server recording a
   new balance observation in the gap between the two curl calls).

**Result:** `main.py` 6,989 → 3,802 lines. New: `routers/budgets.py`,
`routers/net_worth.py`, `routers/transactions.py`, `routers/rules.py`,
`routers/admin.py`, `routers/accounts.py`. Also removed now-dead imports from
`main.py`'s top-of-file block (`asyncio`, `io`, `math`, `hashlib`, `and_`,
`Union`, `BaseModel`, `UploadFile`, `File`, `Response`, `BackgroundTasks`,
`StreamingResponse`, `CardEarningRate`, `import_cards_from_excel`,
`import_points_from_excel`, `TransactionSplit`, `BudgetTarget`,
`UserCorrection`, `DuplicateIgnore`, `CashFlowOverlay`, `SalaryPayment`,
`SalaryAllocation`, `PlannedPurchase`, `ChallengeCategoryLink`) — all became
dead specifically because of routes this session moved out, not unrelated
cleanup, and re-verified the whole-file unresolved-name checker stayed clean
afterward.

**Not done / next**: what remains in `main.py` (~99 routes) is entirely batch 3
— `cards.py`, `ecosystems.py`, `challenges.py`, the cluster the original
phasing plan flagged as riskiest (heaviest shared use of
`core/points_engine.py`, least clean boundary around
`_compute_ecosystem_balance()`) — plus the two bugs above logged to
BACKLOG.md for a separate fix session. Not started; needs Omer to say go.

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
