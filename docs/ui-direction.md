# UI direction — "airy," derived from Monarch

Reference images: `assets/example_images/`. Written 2026-07-30 from Omer's brief:
*"tighten up the layouts, both mobile and desktop… I like the 'airy' feel of Monarch…
the menus and color schemes could use tightening."*

## Decisions already made

- **Thick budget bars stay.** Monarch uses thin (~8px) bars with "spent/remaining" as
  text below; Omer prefers the 24px in-bar-label design shipped 2026-07-27. **Do not
  revert it.** This doc is about chrome, not that component.
- Scope is **menus, color, spacing, density** — not a palette change. Blue stays.

## What actually makes Monarch feel airy

It is not more whitespace. It is **less color and less enclosure**. Concretely:

### 1. Neutral chrome, one accent, used once per screen
Their entire UI is greyscale except:
- the active nav item (orange text + 2px underline),
- data itself (green income / red expense / category hues).

Everything else — buttons, filters, dropdowns, tabs, headers — is neutral with a
hairline border. **Our chrome is heavily saturated by comparison**: filled blue pills
for the active nav, filled blue segmented controls, filled badges. Biggest single win
is to demote most of that to text + underline or text + hairline border, and reserve
filled blue for exactly one active element per screen.

### 2. Hairline borders, no shadows, no glass
Cards are a flat surface with a 1px very-low-contrast border and **no shadow and no
backdrop blur**. Our `--glass-blur` + `card-shadow` reads heavier and muddier,
especially where cards sit on cards. Flatten: hairline border, no shadow, no blur.

### 3. Controls are outlined, not filled
Every control (`This month`, `Filters`, `By category & group`, `Sort`) is: white
surface, hairline border, ~6px radius, small icon + label, modest padding. Uniform.
Ours mixes filled pills, ghost buttons and outlined selects at different radii.

### 4. Value-first KPI typography
Monarch: **big value on top, small uppercase grey label underneath.**
Ours is the inverse (label above, value below). Theirs reads bolder at the same size.
Worth trying on the Dashboard KPI row — cheap change, big perceived difference.

### 5. Row density
Transaction/account rows are ~50–54px with a consistent anatomy:

```
[icon] Merchant                [category chip]  [account]        $amount  ›
       small grey subtitle                       small grey time
```

Left side carries identity, right side carries value + a grey secondary line.
Everything aligns to shared columns. Ours vary in height and alignment per page.

### 6. Sidebar
Inactive items have **no fill at all** — just icon + label. Active is a soft neutral
rounded rectangle, *not* a saturated brand fill. Line icons, uniform stroke weight,
~8–10px vertical padding.

### 7. Tabs
Plain text, active = accent text + 2px underline. No pill, no background fill.
(We already use this on Budgets; make it the standard everywhere.)

## Mobile specifics (from the phone screenshot)

- Section header = group name left, **group total right**, with a delta + context line
  (`↑ $1,081.99 (1.7%) 1 month` / `7% of assets`) directly beneath. Dense but readable.
- Time-range selector is a **plain text row** (`1M 3M 6M 1Y ALL`), evenly spaced, no
  pills — much lighter than our filled segmented control.
- Bottom nav: 5 items, icon + tiny label. (Ours already matches.)

## Translating to dark mode

Our app is dark-first and Monarch's shots are light, so this is a translation, not a
copy. The airy qualities that carry over:
- reduce **saturation** of chrome (not lightness),
- hairline borders instead of shadows/blur,
- one accent per screen,
- consistent control shape and row rhythm.

Do the pass in **both** themes; light mode is where over-saturated chrome hurts most.

## Sequence

Do this **after** the Vite Phase 2 component split. Editing `components/Button.jsx`
once beats hunting ~70 call sites in an 11k-line file, and several of these changes
(control shape, tabs, KPI order) are exactly the kind that touch every page.

## Dashboard layout — DECIDED 2026-07-30

**Two-column masonry + cap the Budget Performance card.** Omer approved the cap.

Mockup: [`mockups/dashboard-airy-masonry.html`](../mockups/dashboard-airy-masonry.html)
(interactive — before/after, budget cap, light/dark; real tokens, real July 2026 data).

Measuring it changed the recommendation, so record the reasoning:

| variant | page height | columns |
|---|---|---|
| Before — stacked, all 22 rows | 2244px | — |
| Masonry, all 22 rows | 1861px (−17%) | 1539 vs 913 → **626px dead space** |
| Masonry + budget capped to 8 | **1235px (−45%)** | 629 vs 913 |

**Masonry alone is not the win.** Monarch runs ~6 similarly-sized cards; we have 3,
one of which (Budget Performance, 22 rows) dwarfs the others — so two columns without
a cap merely relocate the scroll into one column and leave the other ragged. The
change that pays off is *capping the budget card with a "Show all N →" link and adding
a card to the short column* (Net Worth in the mockup). Masonry is what makes that
worthwhile.

Tuning note: at 8 rows the left column becomes the shorter one (629 vs 913), so
**~12 rows balances most closely**. A knob, not a structural question.

### Known nits to fix when this is built for real
- Light theme: over-budget fills at 0.42 opacity across a full track read very pink.
- The `96%` / `114%` labels sit on the fill, where contrast is tightest.
