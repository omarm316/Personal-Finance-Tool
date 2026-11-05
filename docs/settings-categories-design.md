# Settings: Categories design

Chosen with the design gallery (round 1, 2026-11-04). Desktop only; phone design is a separate, later exercise.
Source spec: `mockups/design-gallery/settings-categories.spec.js`. API: `routers/categories.py`.

The editor for Omer's personal category tree (top level › sub-category). These categories drive budgets and reports only; card points come from the merchant path and never read them.

- **Where:** its own Categories tab in Settings, right after Rules.
- **Look:** the Cards look was chosen (Cloud, Outfit + Plus Jakarta, 13px corners, 1.25 spacing, top bar). Until the app moves to it, the tab uses the app's current colors and theme (light and dark), with the same layout.
- **Header:** "Categories" with "N top levels, N sub-categories", the line "Your own categories for budgets and reports. Card points never use them.", and a find box on the right.
- **Layout: two panes.**
  - **Left:** the top levels in order, each with its sub-category count; a lock icon on locked ones. Clicking one selects it. "+ Add top level" at the end.
  - **Right:** the selected top level as a header row, then column headings and its sub-categories. A top level with none says "No sub-categories. Rows sit on <name> itself." "+ Add sub-category to <name>" at the end.
- **Usage counts:** number columns for Transactions, Rules and Budget months ("–" for zero). Each row counts its own uses. On a top level the Transactions cell's tooltip adds what its sub-categories hold.
- **Type:** a small tag only when a category is Income or Both; Expense shows nothing.
- **Locked categories** (Work, Transfer, Unclassified, Fees & Interest): a lock icon whose tooltip says why. They can be reordered but not renamed, moved, retyped, hidden, merged or deleted.
- **Top levels don't fold.**
- **Find box:** filters both panes by name (a top level matching shows all its sub-categories; otherwise only the matching ones). It also searches the hidden list. Dragging is off while a search is active.
- **Changing a category: side panel.** Clicking a row (the header row for a top level) opens a panel on the right with Name, Top level (a list: "None: it is a top level" or any active top level), Counts as (Expense, Income, Both), the usage sentence ("Used by 202 transactions, 35 rules and 12 budget months. A rename carries through all of them; card points never change."), then Hide, Merge into another… and Delete, and Cancel / Save at the bottom.
  - A top level with sub-categories can't be moved under another (two levels only); the list is disabled with the reason.
  - Locked categories show the panel read-only with the reason and a Close button.
  - A hidden category opens the same panel with Show again in place of Hide, so it can still be merged or deleted.
- **Reordering:** drag handles on every row: top levels in the left pane, sub-categories within their top level. The handle also moves with the arrow keys.
- **Moving a sub-category:** pick the new top level from the list in the panel.
- **Adding:** "+ Add" at the end of each group opens the panel empty, with the top level set; a new sub-category starts with its top level's type.
- **Hidden categories:** a folded "Hidden (N)" list at the bottom, each row with its counts and Show again. A top level with active sub-categories can't be hidden until they move or are hidden.
- **Merging:** a centered window: pick the category to merge into (its top level preselected for a sub-category), read what moves ("Moves 202 transactions, 3 split lines, 35 rules and 12 budget months to X. Budget months both have are added together. X is then removed. Card points don't change."), then Merge or Cancel. A category with sub-categories can't be merged until they move.
- **Deleting:** shown greyed out when the category is in use ("In use: merge or hide it instead"); enabled only when nothing uses it, behind a confirmation.
- **Windows and panels** close only with their buttons (Cancel, Save, Close, Merge), never by clicking outside or Escape.
- **After any change** the app reloads the category list, so every picker shows the new tree at once.
