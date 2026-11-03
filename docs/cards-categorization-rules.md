# Cards: categorization and points rules

Agreed in principle with Omer on 2026-11-02. Not implemented, and no data has been changed. The comparison script is `docs/categorization_engine_check.py`; it reads no database.

## The model
Each transaction has two separate paths and one shared brand.

| Field | Who owns it | Example | What it drives |
|---|---|---|---|
| My category and sub-category | Omer | Travel > Hotels | Budgets and reporting |
| Brand | Shared | Hilton | Both paths |
| Merchant path | Card network's view | Travel > Hotels > Hilton | Points |

**On hold:** Omer's existing Category field may collapse to Level 1 categories with matching Sub-Categories. Do not change it until Omer picks this up.

## Rules
1. **One merchant path per transaction.** The path does not vary by card. A card pays at whichever level its rule names.
2. **Your category and the merchant path are independent.** Neither is derived from the other. Your category is stored per split; the merchant path is stored per transaction.
3. **Most specific rule wins.** Look up brand, then sub-category, then category, then the card's base rate.
4. **Superstores are not Groceries in the merchant path.** Walmart and Target sit under Superstores, and Costco and Sam's Club under Wholesale Clubs, unless a card's terms say otherwise. They can stay under Groceries in your categories. A card that pays on one lists it directly.
5. **Exclusions are per card.** Use them only where rule 4 doesn't cover the case.
6. **One brand field.** A hotel booked through a portal has Chase Travel as its brand, unless Omer adds the hotel himself.
7. **Booking portals are merchants.** Path: Portal > Chase Travel. Portal rates never apply to a direct booking. Direct-only rates, such as flights booked with the airline, do not apply to third-party agencies.
8. **Only purchases earn.** Annual fees, interest, late fees and foreign transaction fees earn 0, identified by the transaction itself rather than by merchant category. Payments and bookkeeping lines earn 0.
9. **Refunds reverse points at the rate the purchase earned.**
10. **Statement credits and fee refunds earn 0.** They do not reduce points, unless a card's statements show otherwise.
11. **Gift cards get their own merchant category.** They earn the base rate unless a statement shows otherwise. Reported separately so that a change in card terms is easy to spot.
12. **Rates can depend on more than category.** Build in this order: booking portal, spending caps, then rotating or chosen categories for cards Omer holds, then country limits. Top-category cards (Citi Custom Cash, Amex Business Gold) use the card's billing cycle.
13. **Corrections recalculate past points after a before-and-after review.** A recalculation uses the product in effect on the transaction's date.
14. **Unknown is a visible state.** A transaction with no merchant category earns the base rate and goes to a review list.
15. **One place for merchant rules.** Move the rules in code and the database into one list, match on whole words, and let specific rules beat general ones.

Bilt Obsidian's 3x category is Groceries (confirmed by Omer), which carries a $25,000 yearly cap.

## Engine test
Today's real `infer_points_category()` and `compute_points_earn()` ran against the proposed rules: 23 scenarios from real descriptors on 7 cards, 152 possible combinations.

| Result | Combinations |
|---|---|
| Same rate | 94 |
| Different rate | 55 |
| Depends on running totals | 3 |

Of the 55 differences, 28 are fees, interest and credits. The rest are unrecognized merchants, superstores on grocery cards, and portal or in-store and online differences.

Expected rates for Aspire, Strata Premier, Business Gold, Bilt and Freedom Flex were checked against published sources. Platinum and Sapphire Preferred rates are from memory and need confirming. Rotating categories are not modeled. No scenario was compared with an actual statement.

## Edge cases and how the rules handle them
Figures are from card transactions in the live database on 2026-11-02.

| Case | Found | Handling |
|---|---|---|
| Likely duplicate imports | 94 rows flagged; statement check confirmed 25 and showed 6 were real. **Parked (2026-11-03):** Omer prefers a fresh start for points tracking on a chosen date (for example 2027-01-01) and calculating forward only | Not cleaning history for now. |
| Missing repeat charges | The same statements show about 19 real charges the app never stored: same card, same day, same amount (for example six $85 Uber charges on Business Gold, 3 stored). Likely cause: the content-hash fallback in `core/plaid_sync.py` (~145-170) adopts an existing row when an identical charge arrives in a later sync, overwriting its Plaid ID instead of inserting | Fix the sync to skip rows that already hold a live Plaid ID, then backfill from statements. |
| Same-day repeats | Rows imported together on one day; Air Canada tickets differ only by ticket number | Probably real. Leave them. |
| Annual fees earning points | 14 rows, 4,471 points | Rule 8 |
| Interest and late fees earning points | 15 rows, 346 points | Rule 8 |
| Credits and offers reducing points | 150 rows, -5,697 points | Rule 10, once checked against statements |
| Gift cards coded Dining | 25 rows, $7,039, up to 3x | Rule 11 |
| Gift cards overall | 107 rows, $44,255, 65,276 points | Rule 11 |
| "King" rule matching "Parking" | About 9 parking rows coded Groceries | Rule 15 |
| Odd rules | "Aspire" to Hilton, "Liberty Science" and "TPA" to Dining | Review in the merchant rule cleanup |
| Merchant name missing | Hotels and fees such as "W Hoboken" get no category | Fall back to the description |
| Rates saved before a catalog fix | Hilton Honors groceries stored at 3x and 5x; Boundless at 2x and 3x (66 rows) | Rule 13 |
| Cards with no product link | Citi Custom Cash, Bonvoy Boundless 3663, Citi Double Cash, Atmos Summit: 129 rows, no points | Link products, then recalculate. Atmos Summit also needs a product set up. |
| Business Gold top two categories | Every purchase stored at 1x | Rule 12 |
| Custom Cash window | Code uses calendar months; terms use billing cycles | Rule 12 |
| Foreign purchases | Israeli merchants mostly have no category; U.S.-only restaurant and supermarket rates need a country | Add a foreign flag. Rule 12. |
| Bookkeeping lines | "OFFER 05 MOVED TO STANDARD PURCH", $1,211 | Rule 8 |

## Not yet known
- Whether card statements confirm rules 10 and 11. Statement points for a few cycles would settle them and show how accurate the engine is overall.
