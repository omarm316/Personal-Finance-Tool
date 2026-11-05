# Transactions page design

Chosen with the design gallery (rounds 1-2, 2026-11-04 to 2026-11-05). Desktop approved; not yet implemented. Phone design is a separate, later exercise.
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
5. **Period** (outlined boxes):
   - A **Year** dropdown ("All years", then each year).
   - A **Month** dropdown ("All months", Jan to Dec), shown once a year is picked.
   - **From → To** date fields, always shown. They fill in from the year and month. Editing either one switches to a custom range.
   - The default is the current month, through today.
6. **Clear filters:** a text link at the end, shown only while a search or filter is on.

## Totals strip
An uppercase line under the toolbar, for exactly the rows shown: "262 TRANSACTIONS · EXPENSES: $10,498.71 · INCOME: $28,674.94". It uses today's rules:
- GCB and For Others rows are left out.
- Income booked in a spending category reduces spending; it doesn't count as income.
- Excluded rows and the credit-card payment duplicates stay hidden from the list and the totals.

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
4. **Merchant category box:** shows the value with an **Edit** link, or "Not classified" with **Set**. The old scope selector (this card / every network card / all cards) is gone, because merchant rules are global from 2027. On rows dated 2027-01-01 on, the box also shows and edits brand, kind and foreign, through the `PATCH /api/transactions/{id}` fields from the earning engine. Earlier rows show the note "Brand, kind and foreign fill in on rows from January 1, 2027."
5. **Points:**
   - The label is "Points earned", "Points clawback", "Not counted for points" or "Manual override".
   - Then the merchant category (or base rate) with the rate ("4x") and the signed points with the program.
   - Accounts without points say "No card points on this account."
   - There is no estimated dollar value. This fixes B38.
6. **Tag pills:**
   - ⭐ "Tag as GCB" / "GCB tagged"
   - 👥 "Mark for others" / "For others"
   - ⊘ "Exclude" / "Excluded"
   - 🔒 "Locked", shown only when the row is locked
   - A "⚠ Needs review" label when the row needs review
7. **Splits:** when the row is split, its parts, each with its note, category, type and amount.
8. **Footer:** ⊕ Split (or ✎ Edit splits), Create rule, and Delete (red, behind the existing confirmation) on the left, with Close on the right.

## Open questions for the build
- **B37, excluded rows:** the chosen toolbar has no way to see excluded rows or undo an exclusion. A suggestion in the same style is an "Excluded" chip with a count after Needs review that shows only excluded rows. It is not decided.
- **2027 fields:** where brand, kind and foreign sit inside the merchant category box. They are small enough to lay out while building.
