# Transactions page design

Chosen with the design gallery (rounds 1-2, 2026-11-04 to 2026-11-05). Two follow-ups were settled on 2026-11-07: the Excluded chip, and the Card earning box in the details window. **Desktop built 2026-11-07;** see "Build notes" at the end for the small calls made while building. Phones keep the earlier layout; phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/transactions.spec.js` (id `transactions-final`). Final rendering with real rows: https://claude.ai/artifact/HrVA3kE5bYSmXCGFS4Fe6W
Replaces the layout of today's `frontend/src/pages/TransactionsPage.jsx`, `components/TxnRow.jsx` and `components/ReviewModal.jsx`. Behavior stays as today unless a section below says otherwise.
Example figures are from October 2026, using rows pulled 2026-11-04 (Aug 1 to Nov 3).

## Look and chrome
- **Look (carried over from Cards, locked):** Cloud color scheme, brand blue accent, Outfit headings with Plus Jakarta body, hairline panels, 13px corners, 1.25 spacing.
- **Navigation:** the top bar, as on Cards and the Dashboard.
- **Header:** one slim boxed bar. On the left are the title "Transactions" and the count shown ("262 shown"). On the right:
  - **+ Add ▾**, a primary button whose menu has "Manual transaction" and "Import a file (CSV, OFX)".
  - **⋯**, whose menu has "Export CSV" and "✨ AI Enrich".
- **Modals:** every window on this page (details, review, edit selected, split, manual, import) closes only with its own buttons, never on a backdrop click or Escape.

## Page order, top to bottom
1. Header bar
2. One list card, holding:
   1. Toolbar
   2. Totals strip
   3. Selection bar (only while rows are selected)
   4. Column headers and rows

## Toolbar
One row at the top of the list card that wraps when it runs out of room, in this order:
1. **Search:** an underline-only box, "Search transactions…". It matches the display name and the bank description as you type.
2. **Filter chips** (soft grey; a chip turns blue while it filters):
   - **Type, Category, Account, Network.** Each opens a checklist with a search box, a count beside each option, Clear all / Select all, and Apply. The chip label reads "All types" when nothing is filtered, "Type: Expense" for one pick, and "Type (2/8)" for several.
   - **Category** lists each top level with its subcategories indented under it. Ticking a top level also matches its subcategories.
3. **Amount chip:** opens Min $ and Max $ fields, matched on dollar size in either direction, with Clear and Done. While set, the label reads "Amount: $50 – $200" ("any" for an empty side).
4. **Needs review chip:** an ⚠ icon, the label and the count ("Needs review 36" in October). Clicking it shows only rows that need review; clicking again shows all rows. The count follows the period and the other filters.
5. **Excluded chip:** a ⊘ icon, "Excluded" and the count ("Excluded 3" in October). Clicking it shows only the excluded rows, which are otherwise hidden; clicking again goes back. It follows the period and the other filters.
   - Excluded and Needs review are separate views, so turning one on turns the other off.
   - An exclusion is undone from the details window's ⊘ "Excluded" pill. The row then leaves the excluded view and counts in totals again.
   - Fixes B37 for exclusions.
6. **Period** (outlined boxes):
   - A **Year** dropdown ("All years", then each year).
   - A **Month** dropdown ("All months", Jan to Dec), shown once a year is picked.
   - **From → To** date fields, always shown. They fill in from the year and month. Editing either one switches to a custom range.
   - The default is the current month, through today.
7. **Clear filters:** a text link at the end, shown only while a search, filter or chip is on. It also turns off Needs review and Excluded.

## Totals strip
An uppercase line under the toolbar, for exactly the rows shown: "262 TRANSACTIONS · EXPENSES: $10,498.71 · INCOME: $28,674.94". It uses today's rules:
- GCB rows are left out. For Others rows count, so a purchase made for someone nets out against its reimbursement, which is booked to the same category.
- Income booked in a spending category reduces spending; it doesn't count as income.
- Excluded rows and the credit-card payment duplicates stay out of the list and the totals.
- In the excluded view, the strip reads "3 EXCLUDED TRANSACTIONS · LEFT OUT OF EVERY TOTAL" instead of dollar totals.
- The credit-card payment duplicates (the card side of a payment already shown from checking) stay hidden, as today, with no control to show them.

## Selection bar
- **Checkboxes:** a checkbox column is always shown, and the header checkbox selects every row shown.
- **The bar:** while rows are selected, a bar sits above the list with "n selected", **✎ Edit selected** and **✕ Deselect all**.
- **Edit selected** opens a window with Type and Category dropdowns, each defaulting to "Keep as is", plus Cancel and "Apply to n". Applying sets only the fields that were changed and marks the rows reviewed.

## The list: dense ledger
- **Columns, left to right:**

  | Column | Width |
  |---|---|
  | Checkbox | fits its content |
  | Date | 58px |
  | Description | at least 120px, 1.6 shares |
  | Type | fits its content |
  | Category | at least 60px, 1.2 shares |
  | Account | at least 60px, 1 share |
  | Amount | fits, right-aligned |
  | Actions | fits, right-aligned |

  Points, card network and spender columns are off.
- **Rows:**
  - About 38px tall. The ledger uses 0.66 of the gallery's 58px row-height setting.
  - Striped, with a hairline under each row.
  - No grouping; the date is a column.
- **Sorting:** Date, Description, Type, Category, Account and Amount headers sort, with ⇅ when idle and ▲/▼ when active. Date and Amount sort descending first; the rest sort ascending first.
- **Clicking a row** (anywhere outside a control) opens the details window. So do Enter or Space on a focused row.

### Cells
- **Date:** numeric, "10/31". On a split row, a ▸ arrow sits before the date. It shows the parts under the row ("↳ note, category, amount") and turns to show they are open.
- **Description:** the stored display name, as the bank or enrichment left it, with no title-casing. Hovering shows the raw bank description. AI labels follow the name on the same line, so the row height doesn't change:
  - "30% AI CONFIDENCE" when confidence is under 80% and the row isn't locked.
  - The enrichment source: "AI ENRICHED", "FALLBACK" or "AUTO-OVERRIDE". Rule-sourced rows show none.
- **Type:** plain text with a small ▾. Clicking it opens a menu of the eight types (Expense, Income, Transfer, Investment Gain (Loss), Purchase, Sale, Depreciation, Other). One click saves the type and marks the row reviewed, and a "Type saved" toast confirms. The server locks the row, as it does for any type change. A split whose parts have different types shows "Multiple" and isn't clickable.
- **Category:** a blue pill with the full path ("Housing › Furniture"), with ✎ when it was set by hand. Types outside Expense and Income show "—".
  - Clicking the pill opens a popover headed "Category for {name}". It has a search box and a grouped list: each top level has its color dot, with its subcategories under it.
  - One click picks and saves, marks the row manual and reviewed, and a "Category saved" toast confirms. The server locks the row, as it does for any category change.
  - Typing in the search box narrows the list to matching groups and categories.
- **Account:** the account name, cut short with the full name on hover.
- **Amount:** signed dollars, red for money out and green for money in. Transfers stay neutral.
- **Actions:** always shown, in this order:
  1. A primary **Review** button, only on rows that need review.
  2. Emoji chips: ⭐ GCB, ⊘ excluded, 🔒 locked.
  3. Three icon buttons with tooltips: ⓘ Details, ✎ Edit, and the split icon ("Split", or "Splits" on a split row).

### Editing a row (✎)
The row's cells turn into fields, as today:
- Description becomes a text input.
- Type becomes a dropdown.
- Category becomes the grouped dropdown. It is hidden ("—") for types outside Expense and Income.
- The actions become **Save** and **✕**.

Saving does what today's save does: it marks the row reviewed and locked. For a row whose enrichment came from AI or an override, it then offers to create a merchant rule. In edit mode the type field is fixed at 112px, so the row doesn't push the table sideways.

### Review window (Review button)
Today's review window, in the new look. Round 2 didn't ask what the Review button opens, so it stays as today.
- **Header:** "Review transaction", with the date, the signed amount and the account under it, and an ✕.
- **Description box:** the name, "Raw: …" when it differs, and the AI confidence when there is one.
- **Fields:** a Type dropdown and the grouped Category dropdown. Category is hidden for types outside Expense and Income.
- **Rule checkbox:** "Save as a rule for this merchant". It appears for AI- or fallback-sourced rows and is ticked by default.
- **Buttons:**
  - **Ignore**, on the left: takes the row off the review list without changing anything.
  - **Discard:** closes without saving.
  - **Save**, the primary button: saves the type and category, marks the row reviewed, and creates the rule when ticked.

## Details window (ⓘ or a row click)
A window in the middle, laid out as a grid of fact tiles. It is read-only; editing happens in the row.
1. **Header:** "Transaction details", "ID #10044" and ✕.
2. **Description box:** the name, plus "Raw: …" when the bank text differs.
3. **Tiles:**
   - Always: Date, Amount, Account, Type, Category ("Top › Sub", or "—" for types outside Expense and Income), Confidence, Import source (Plaid, CSV, OFX or Manual) and Enrichment (AI, Rule, Manual override, Fallback or Plaid category).
   - When present: Network and Spender.
4. **Card earning box:** one box for how the card scores the row, headed "Card earning" with an **Edit** link at the top right. Today's separate Merchant category box and points block merge into it.
   - **Four cells in a row:** Merchant category, Brand, Kind and Foreign, sized 1.7 / 1.2 / 1 / 0.8 shares. An empty merchant category shows "Not classified".
   - **Edit** turns the four cells into fields in place, with Cancel and Save under them:
     - Merchant category: a dropdown with "Not classified" first.
     - Brand: a dropdown from `/api/brands` with "None" first. Picking a brand with no merchant category fills in the brand's default category, as the API does.
     - Kind: a dropdown of Purchase, Refund, Fee, Interest, Credit, Payment, Person to person and Adjustment.
     - Foreign: a checkbox.
   - **Saving** sends the fields to `PATCH /api/transactions/{id}`, and a "Card earning saved" toast confirms. On a 2027 row the API marks the classification manual.
   - **Rows dated 2027-01-01 on:** all four fields show and edit. The merchant category list is the 2027 one (`/api/merchant-categories`).
   - **Earlier rows:**
     - Brand, Kind and Foreign show "—" and stay disabled in edit mode, since the API accepts them only on 2027 rows.
     - The note "Brand, kind and foreign fill in on rows from January 1, 2027." sits under the cells.
     - Merchant category edits today's points category from today's list.
   - **No scope selector** (this card / every network card / all cards): merchant rules are global from 2027.
   - **Points**, at the bottom of the box:
     - The label is "Points earned", "Points clawback", "Not counted for points" or "Manual override".
     - Then the merchant category (or base rate) with the rate ("2x") and the signed points with the program ("+148 AA AAdvantage").
     - Accounts without points say "No card points on this account."
     - There is no estimated dollar value. This fixes B38.
5. **Tag pills:**
   - ⭐ "Tag as GCB" / "GCB tagged"
   - 👥 "Mark for others" / "For others"
   - ⊘ "Exclude" / "Excluded"
   - 🔒 "Locked", shown only when the row is locked
   - A "⚠ Needs review" label when the row needs review
6. **Splits:** when the row is split, its parts, each with its note, category, type and amount.
7. **Footer:** ⊕ Split (or ✎ Edit splits), Create rule, and Delete (red, behind the existing confirmation) on the left, with Close on the right.

## Open questions for the build
None from the gallery. Omer settled both remaining questions on 2026-11-07:
- Excluded rows get a chip.
- Brand, kind and foreign go in the Card earning box, as recommended.

## Build notes (2026-11-07)
Calls made while building that the gallery didn't decide:
- **Navigation:** the sidebar stays for now; the top bar comes with the app-wide change, best done with the Dashboard build. The app's own title bar still reads "Transactions" above the page's header bar until then.
- **Look:** the Cloud tokens live in `frontend/src/styles/cloud.css`, scoped to `.cloud`. The app still has a dark mode, so dark gets matching neutrals rather than an inversion.
- **Brand chip:** it appears after Network once rows carry a brand (from 2027), as today's page does.
- **AI labels:** Plaid-categorized rows show "PLAID CATEGORY", matching the Enrichment tile.
- **Unclassified:** an expense or income row with no category shows an "Unclassified" pill, not "Other".
- **Split rows:** their type and category aren't clickable. The parts carry their own, so change them in the splits.
- **👥 For others:** "Mark for others" sets the category to For Others and marks the row reviewed. Once set, the pill is a label; picking another category undoes it.
- **Points:** today's Adjust link stays at the right of the points label (a manual points figure, or back to automatic).
- **Card earning on rows before 2027:** saving sets the old points category only. It no longer teaches the old merchant-category rule to other rows, since there is no scope selector.
- **Edit selected:** Type and Category only, as designed. Today's GCB and "mark reviewed" options are gone; applying always marks the rows reviewed.
- **Loading:** the whole period loads (up to 5,000 rows, while all history is about 3,500). The list draws 200 at a time and more as you scroll, with a Show more button as a fallback. A note appears in the totals strip if a period ever hits the cap.
- **Column widths:** a hidden row holds the widest type, amount and status chips among the rows shown, so columns don't shift as more rows draw or a row is edited.
