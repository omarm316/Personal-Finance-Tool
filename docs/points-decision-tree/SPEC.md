# Points decision tree: logic and visual spec

How a credit card purchase becomes points, how those points are valued two ways (cash back and travel), and how to pick the best card for each kind of spending across a household's cards. It also covers the explainer page that shows all of this.

Written 2026-11-07 from a working build: a Python engine in a personal finance app, plus a JavaScript mirror and an HTML explainer. Card terms and point values change, so every rate, ratio and cash-out value here is dated and should be checked again before you rely on it.

**Files in this bundle**

| File | What it is |
|---|---|
| `PROMPT.md` | The message to start a new project with |
| `SPEC.md` | This document |
| `reference/engine.js` | The scoring logic in about 190 lines: category tree, currency values, products, rule matching, best-card picking |
| `reference/rules.json` | Earn rules for 26 card products, as data |
| `reference/points-decision-tree.html` | The finished explainer page, self-contained. It inlines `engine.js` and `rules.json`; open it in a browser to see the visual |

Household members appear as **Holder A** and **Holder B**. Replace them with real names where you work.

---

## 1. Vocabulary

- **Earn rate:** the *total* points per dollar a rule pays, not a bonus on top of the base. "Dining 3x" means 3 points per dollar, all in.
- **Merchant path:** how the card network sees the merchant: category › sub-category › brand, such as Travel › Hotels › Hilton. Points are worked out from this path only.
- **Your category:** the household's own budget category, such as Dining › Food Delivery. It is independent of the merchant path and **never** affects points.
- **Brand:** the merchant itself (Hilton, Costco, Chase Travel). It sits at the bottom of the merchant path.
- **Currency kinds:**
  - **Transferable:** Chase Ultimate Rewards, Amex Membership Rewards, Citi ThankYou, Capital One, Bilt. These can be cashed out and moved to airline and hotel partners.
  - **Hotel or airline:** Hilton, Marriott, Hyatt, United, Delta, AAdvantage, Atmos. These can't be cashed out.
  - **Cash:** cash-back cards, and Amazon points (1¢ each at Amazon).

---

## 2. The tree, step by step

Every card line goes through five steps. The explainer page draws them as a vertical trunk (steps 1 and 2). The trunk then forks into one lane per card (steps 3 to 5), because the merchant path is the same for every card while the rate differs.

### Step 1: What kind of line is it?

This is read from the transaction itself (the descriptor, the sign of the amount, payment keywords), never from the merchant category.

| Kind | Examples | Outcome |
|---|---|---|
| Purchase | Any charge | Goes on to step 2 |
| Refund | Merchant return | Goes on to step 2 to find the rate it reverses |
| Statement credit | Card benefit credit, merchant offer | Earns 0. Points already earned on the purchase stay |
| Fee or interest | Annual fee, interest, late fee, foreign transaction fee | Earns 0, whatever the merchant line says |
| Payment, transfer or adjustment | Card payment, P2P (Venmo), bookkeeping lines | Earns 0 |

A fee or interest line with a positive amount is a credit. The word "CREDIT" on a purchase is ignored.

### Step 2: Where does the merchant sit?

Four sources are tried in order, and the first one that gives an answer is used:

1. **Your fix:** a manual correction on the transaction.
2. **Merchant rule:** one list of patterns matched against the merchant name and description.
   - A rule matches whole words (so "AVIS" doesn't match "DAVIS DELI"). For glued descriptors such as `andAmexTravel.com`, a rule can be set to match anywhere in the text instead.
   - The longest matching pattern wins. There are no priority numbers, so "DOORDASH GIFTCARDS" beats "DOORDASH".
   - A rule can set any of three things: merchant category, brand, and line kind.
   - A rule that names only a brand takes that brand's default category.
3. **The bank feed's category:** Plaid's detailed category, mapped as below.
4. **Unknown:** the line earns the base rate and goes on a review list until someone names the merchant.

**Plaid category map**

| Plaid detailed category | Merchant category |
|---|---|
| TRAVEL_FLIGHTS | Airlines |
| TRAVEL_LODGING | Hotels |
| TRAVEL_RENTAL_CARS | Car Rental |
| TRAVEL_OTHER_TRAVEL | Travel |
| TRANSPORTATION_TAXIS_AND_RIDE_SHARES, _PUBLIC_TRANSIT, _PARKING, _TOLLS | Transit |
| TRANSPORTATION_GAS | Gas Stations |
| FOOD_AND_DRINK_RESTAURANT, _FAST_FOOD, _COFFEE | Dining |
| FOOD_AND_DRINK_GROCERIES | Groceries |
| GENERAL_MERCHANDISE_SUPERSTORES | Superstores |
| GENERAL_MERCHANDISE_ONLINE_MARKETPLACES | Online Shopping |
| GENERAL_MERCHANDISE_ELECTRONICS | Electronics |
| MEDICAL_PHARMACIES_AND_SUPPLEMENTS | Drugstores |
| HOME_IMPROVEMENT_HARDWARE | Home Improvement |
| PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS | Fitness |
| ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_CONCERTS | Live Entertainment |
| ENTERTAINMENT_MUSIC_AND_AUDIO | Streaming |
| RENT_AND_UTILITIES_TELEPHONE | Wireless |
| RENT_AND_UTILITIES_INTERNET_AND_CABLE | Cable & Internet |

**Merchant category tree** (two levels, plus the brand)

- Travel › Airlines, Hotels, Car Rental, Vacation Rentals, Transit (rides, taxis, trains, parking, tolls)
- Portal (booking sites run by card issuers)
- Dining (restaurants, plus delivery: DoorDash, Uber Eats, Grubhub)
- Groceries
- Superstores (Walmart, Target)
- Wholesale Clubs (Costco, Sam's Club, BJ's)
- Gas & EV › Gas Stations, EV Charging
- Drugstores, Streaming, Online Shopping, Electronics, Home Improvement, Fitness, Live Entertainment
- Phone & Internet › Wireless, Cable & Internet
- Advertising, Software & Cloud
- Gift Cards
- Other (a known merchant with no bonus category)

**Brands and the category each one implies**

- **Hotels:** Hilton, Marriott, Hyatt, IHG
- **Airlines:** United, Delta, American Airlines, Alaska Airlines, Hawaiian Airlines, Southwest, JetBlue, El Al, Air Canada, Air France
- **Transit:** Uber, Lyft
- **Dining:** DoorDash, Uber Eats, Grubhub
- **Groceries:** Whole Foods, Instacart
- **Superstores:** Walmart, Target
- **Wholesale Clubs:** Costco, Sam's Club, BJ's
- **Online Shopping:** Amazon
- **Electronics:** Best Buy
- **Portal:** Chase Travel, Amex Travel, Citi Travel, Bilt Travel, Capital One Travel

**Design rules for the path**

1. **One merchant path per transaction.** The path doesn't change from card to card; each card pays at whatever level its rule names.
2. **Superstores and wholesale clubs are not groceries.** A card that pays on them names them directly.
3. **Booking sites are merchants.** A hotel booked on Citi Travel has the path Portal › Citi Travel, not Hotels › Hilton. A booking site's rate never applies to a direct booking. Rates that require booking direct (such as flights booked with the airline) don't apply to third-party agencies.
4. **Delivery is dining.** There is no separate delivery category, so every card's dining rate covers delivery orders.
5. **Gift cards have their own category.** They earn the base rate unless a card's terms say otherwise, and they are reported apart so a change in terms is easy to spot.
6. **Unknown is a visible state.** It earns the base rate and goes on the review list; it is never silently filed under Other.

### Step 3: Which rule pays?

Each card has a list of rules. Each rule targets one of these:
- a **brand**;
- a **category** or **sub-category**;
- a **slot**, which is a rotating or chosen category on that card;
- nothing at all, which makes it the **base rate**.

**Rule fields** (as in `rules.json`):

```
{ category | brand, rate,
  domestic?: true,  online?: true,  foreign?: true,       // conditions
  type?: 'fixed' (default) | 'top_n' | 'selected',
  top_n?, slot?,                                          // top-category and chosen/rotating rules
  cap?, per?: 'billing_cycle' | 'quarter' | 'calendar_year' | 'card_year',
  group?,                                                 // rules that share one cap
  after? }                                                // rate once the cap is used; omit to fall through
base: number | { rate, cap, per, after }                  // a capped base rate, e.g. Blue Business Plus
```

**Matching level** (`targetLevel` in `engine.js`):

| Rule targets | Matches when | Level |
|---|---|---|
| Brand | the path's brand is that brand | 3 |
| Sub-category | the path's sub-category is that one | 2 |
| Category | the path's category is that one, **or** it is the parent of the path's sub-category ("Travel 2x" covers Airlines) | 1 |
| Base | always | 0 |

**Choosing the winner**
1. Drop rules whose level is 0 (except the base rate).
2. Drop rules whose condition fails:
   - **US only** (`domestic`): the merchant is abroad.
   - **Abroad only** (`foreign`): the merchant is in the US.
   - **Online only** (`online`): the purchase wasn't made online.

   When a rule is dropped this way, the next rung down pays. On the page, the dropped rule shows struck through in the warning color.
3. Sort what's left by level (highest first), then by rate (highest first). The first rule pays.
4. **`selected` rules** apply through the card's current choice for that slot. Examples are Bilt's chosen category, the Freedom and Discover quarterly categories, Cash+ and BofA picks. With no choice set, the rule never matches.
5. **`top_n` rules** (Citi Custom Cash, Amex Business Gold) pay only on the N slots with the most purchase spend in that card's **billing cycle**. All the cycle's spend counts, so the order of purchases doesn't matter. Rules that share a `slot` rank as one category.

### Step 4: Any limit?

- A capped rule pays its rate until the period's room runs out. Room is tracked per `group`, so rules in the same group share one cap, and per period:
  - **Billing cycle:** from the card's statement close day, or the calendar month when it isn't known.
  - **Quarter.**
  - **Calendar year.**
  - **Card year:** from the open date.
- If a purchase crosses the cap, it is split: the portion within the room earns the capped rate. The rest earns the rule's `after` rate if it has one, or falls through to the next matching rule.

### Step 5: Points

- **Dollars:** Amex rounds the amount to the nearest whole dollar before multiplying (round half up). Other issuers use the exact amount.
- **Points** = dollars × rate. A purchase that crossed a cap adds its split portions.
- **Refunds** take back points at the rate stored on the most recent matching purchase. A matching purchase is on the same card, at the same merchant, within 120 days, and at least as large as the refund. With no match, the refund uses its own path's rate. A refund doesn't give cap room back.
- A rate set by hand on a transaction overrides everything above.

---

## 3. Valuing points: two paths

Points are converted to a value per dollar spent so that cards in different currencies can be compared. The comparison has two paths, and the travel path has two presets.

| Path | Value per point |
|---|---|
| **Cash back** | What the currency turns into **in one step**: a deposit or a statement credit. Hotel and airline currencies can't be cashed out, so those cards are left out of this path. |
| **Travel, Frequent Miler preset** | Frequent Miler's Reasonable Redemption Value (RRV) for the currency: its typical award value. Cash currencies count at face value, since cash pays for travel too. |
| **Travel, minimum preset** | For transferable currencies, the least that a travel booking always gets. Hotel and airline currencies keep their RRV, since they have no floor. Cash counts at face value. |

**Value per dollar** = rate × cents per point − foreign transaction fee (abroad rows only). On the cash path it is shown as a percentage, and on the travel path as cents per dollar.

**Currency values** (cents per point). The RRVs are from [Frequent Miler](https://frequentmiler.com/reasonable-redemption-values-rrvs/), read 2026-11-05.

| Currency | Kind | RRV | Cash-out | How it cashes out | Minimum | How the minimum is reached |
|---|---|---|---|---|---|---|
| Chase Ultimate Rewards | transferable | 1.5 | 1.0 | deposit or statement credit | 1.0 | cash, or Chase Travel |
| Amex Membership Rewards | transferable | 1.5 | 0.6 | statement credit | 1.0 | flights paid with points on Amex Travel |
| Citi ThankYou (Strata Premier) | transferable | 1.5 | 0.75 | since Aug 24, 2025 | 1.0 | Citi Travel |
| Citi ThankYou (Custom Cash, Double Cash) | transferable | 1.5 | 1.0 | from those accounts | 1.0 | Citi Travel |
| Capital One Miles | transferable | 1.45 | 0.5 | statement credit | 1.0 | erase a travel purchase |
| Bilt Points | transferable | 1.55 | 0.55 | statement credit | 1.25 | Bilt Travel |
| Hilton Honors | hotel | 0.35 | — | — | — | — |
| Marriott Bonvoy | hotel | 0.73 | — | — | — | — |
| World of Hyatt | hotel | 1.5 | — | — | — | — |
| United MileagePlus | airline | 1.3 | — | — | — | — |
| Delta SkyMiles | airline | 1.1 | — | — | — | — |
| American AAdvantage | airline | 1.4 | — | — | — | — |
| Atmos Rewards | airline | 1.5 | — | — | — | — |
| Cash back, Amazon points | cash | — | 1.0 | face value | — | — |

**Rules for values**
- Values are **estimates**. Label them as such, let the user change any of them (the page has an editable values table with a reset button), and never present them as value actually realized. Only real redemptions are real value.
- **Citi caveat:** Citi told cardholders in 2025 that Strata Premier points in the same ThankYou account as a Custom Cash or Double Cash still cash out at 1¢ ([Doctor of Credit](https://www.doctorofcredit.com/citi-reducing-citi-strata-premier-thankyou-rewards-cashout-offer-from-1%C2%A2-to-0-75%C2%A2-per-point/)). This hasn't been reconfirmed, so the default stays 0.75¢.
- **Pooling is hard-coded in this version.** On the travel path:
  - Freedom points count as transferable because they can move to a Sapphire Preferred.
  - Custom Cash and Double Cash points count as transferable because they can move to the Strata Premier.

  Phase 2 (section 8) replaces this with logic that depends on which cards are held.

---

## 4. Best card for each kind of spending

**Rows**, grouped by kind. Each row is a sample merchant path.

| Group | Row | Path | Special handling |
|---|---|---|---|
| Everyday | Restaurants in the US | Dining | |
| | Restaurants abroad | Dining, abroad | subtract each card's foreign transaction fee |
| | DoorDash and other delivery | Dining › DoorDash | |
| | Supermarkets, in store | Groceries | |
| | Whole Foods | Groceries › Whole Foods | |
| | Amazon | Online Shopping › Amazon | |
| | Walmart and Target | Superstores | |
| | Costco | Wholesale Clubs › Costco | Visa cards only (Costco warehouses take only Visa) |
| | Gas stations | Gas & EV › Gas Stations | |
| | Streaming | Streaming | |
| | Drugstores | Drugstores | |
| Travel | Flights, booked with the airline | Travel › Airlines | |
| | United flights | Travel › Airlines › United | |
| | Hilton / Marriott / Hyatt stays | Travel › Hotels › brand | |
| | Other hotels, booked direct | Travel › Hotels | |
| | Hotels on a card's own travel site | Portal › (each card's own issuer site) | only cards that have a booking site; each is scored on its own issuer's site |
| | Car rental, booked direct | Travel › Car Rental | |
| | Uber, taxis and transit | Travel › Transit › Uber | |
| Everything else | Anything without a bonus | Other | |

**Picking** (`pick()` in `engine.js`), for each row on the chosen path and preset:
1. For every card, list what one dollar can earn (`offers()`), in the engine's order:
   - **A capped rule** is listed, then the next thing that pays once the cap is used.
   - **A `top_n` rule** is skipped here, because it depends on the month's spending. It appears under bonus slots instead.
2. Each offer's value is rate × cents per point − fee. A capped offer counts as **capped** only if its cap is under $100,000 a year (caps are annualized: cycle ×12, quarter ×4). Bigger caps are treated as no cap.
3. **Top** is the highest value across all offers. **Steady** is the highest value among uncapped offers. When they differ, the row shows a "Past the limit" column: "Then *card* at *value*".
4. **Ties:** every card at the top value is listed. Order:
   1. cards whose terms are verified;
   2. uncapped before capped;
   3. by name.

   The first three are shown, then "or N more at the same rate: …".
5. Each card shows its holder chip (A, B, Both, or "Owner not set"). It also shows "up to $X a period" when the winning offer is capped, and "terms not confirmed" when the card's terms are ported rather than verified.

**Fewest cards that cover every row:** a greedy set cover over each row's tied winners. Repeatedly pick the card that wins the most rows not yet covered. Break ties by verified terms first, then by name. List each picked card with the rows it covers.

**Bonus slots that can beat the table:** these cards pay more on categories that change with spending or choices, up to a limit. Each shows its value per dollar on the current path, a one-line description, and a warning line when its choices aren't entered.
- **Citi Custom Cash:** 5x on the top eligible category each billing cycle, first $500.
- **Amex Business Gold:** 4x on the top 2 of its categories each cycle, US purchases, $150,000 a year combined.
- **Chase Freedom and Freedom Flex:** 5x on the quarter's categories, $1,500 a quarter each.
- **Discover it:** 5% on the quarter's categories, $1,500 a quarter.
- **U.S. Bank Cash+:** 5% on two chosen categories (sharing $2,000 a quarter), plus 2% on one everyday category.
- **BofA Customized Cash:** 3% on one chosen category, sharing $2,500 a quarter with 2% on groceries and wholesale clubs.

---

## 5. Card catalog

The rates are total points per dollar. Brackets name a cap group.
- **verified:** checked against a published source (see each product's `checked` note in `rules.json`).
- **ported:** copied from an older catalog and not yet checked.
- **FTF:** foreign transaction fee.

| Card | Currency | Network | FTF | Base | Bonus rules (total points per $) | Terms | Holder |
|---|---|---|---|---|---|---|---|
| Hilton Aspire `hilton_aspire` | Hilton | Amex | 0 | 3x | Hilton 14x · Airlines 7x · Car Rental 7x · Dining 7x (US) | verified | A |
| Amex Platinum `amex_platinum` | Amex MR | Amex | 0 | 1x | Airlines 5x to $500,000/yr [flights] · Amex Travel 5x | ported | A, B |
| Amex Business Gold `amex_business_gold` | Amex MR | Amex | 0 | 1x | Amex Travel 3x · 4x on top 2 of: Advertising (US), Electronics (US), Software & Cloud (US), Gas Stations (US), Dining (US), Transit, Wireless (US) to $150,000/yr [top2] | verified | A |
| Citi Strata Premier `citi_strata_premier` | Citi TY | Mastercard | 0 | 1x | Citi Travel 10x · Airlines 3x · Hotels 3x · Dining 3x · Groceries 3x · Gas & EV 3x | verified | not set |
| Chase Freedom Flex `chase_freedom_flex` | Chase UR | Mastercard | 3% | 1x | Chase Travel 5x · Dining 3x · Drugstores 3x · 5x on the `rotating` slot to $1,500/qtr [rotating] | verified | A |
| Chase Freedom `chase_freedom` | Chase UR | Visa | 3% | 1x | 5x on the `rotating` slot to $1,500/qtr [rotating] | ported | A, B |
| Chase Freedom Unlimited `chase_freedom_unlimited` | Chase UR | Visa | 3% | 1.5x | Chase Travel 5x · Dining 3x · Drugstores 3x · Lyft 5x | ported | A, B |
| Chase Sapphire Preferred `chase_sapphire_preferred` | Chase UR | Visa | 0 | 1x | Chase Travel 5x · Dining 3x · Streaming 3x · Groceries 3x (online) · Gas & EV 3x · Travel 2x · Lyft 5x | ported | A, B |
| Amazon Prime Visa `chase_amazon_prime` | Amazon | Visa | 0 | 1x | Amazon 5x · Whole Foods 5x · Chase Travel 5x · Dining 2x · Gas Stations 2x · Transit 2x | ported | A |
| Bilt Obsidian `bilt_obsidian` | Bilt | Mastercard | 0 | 1x | 3x on the `choice` slot to $25,000/yr [choice] · Travel 2x · Transit 1x | verified | A |
| United Quest `united_quest` | United | Visa | 0 | 1x | United 3x · Travel 2x · Dining 2x · Streaming 2x | ported | A |
| United Explorer `united_explorer` | United | Visa | 0 | 1x | United 2x · Dining 2x · Hotels 2x | ported | B |
| Amex Blue Business Plus `amex_blue_business_plus` | Amex MR | Amex | 2.7% | 2x to $50,000/yr, then 1x | none | ported | A |
| Marriott Bonvoy Brilliant `marriott_bonvoy_brilliant` | Marriott | Amex | 0 | 2x | Marriott 6x · Dining 3x · Airlines 3x | ported | B |
| Marriott Bonvoy Boundless `marriott_bonvoy_boundless` | Marriott | Visa | 0 | 2x | Marriott 6x · Groceries 3x to $6,000/yr [everyday3x] · Gas Stations 3x to $6,000/yr [everyday3x] · Dining 3x to $6,000/yr [everyday3x] | ported | A, B |
| Hilton Honors (Amex) `hilton_honors` | Hilton | Amex | 0 | 3x | Hilton 7x · Dining 5x (US) · Groceries 5x (US) · Gas Stations 5x (US) | ported | A, B |
| World of Hyatt `hyatt_personal` | Hyatt | Visa | 0 | 1x | Hyatt 4x · Dining 2x · Airlines 2x · Transit 2x · Fitness 2x | ported | A |
| Citi Custom Cash `citi_custom_cash` | Citi TY | Mastercard | 3% | 1x | 5x on top 1 of: Dining, Gas & EV, Groceries, Airlines, Hotels, Transit, Streaming, Drugstores, Home Improvement, Fitness, Live Entertainment to $500/cycle [top1] | ported | A |
| Citi Double Cash `citi_double_cash` | Citi TY | Mastercard | 3% | 2x | none | ported | B |
| Citi AAdvantage Platinum Select `citi_aa_platinum_select` | AAdvantage | Mastercard | 0 | 1x | American Airlines 2x · Dining 2x · Gas Stations 2x | verified | A |
| Delta SkyMiles Gold `delta_gold` | Delta | Amex | 0 | 1x | Delta 2x · Dining 2x · Groceries 2x (US) | ported | B |
| Atmos Ascent `atmos_ascent` | Atmos | Visa | 0 | 1x | Alaska Airlines 3x · Hawaiian Airlines 3x · Gas & EV 2x · Cable & Internet 2x · Streaming 2x · Transit 2x | ported | B |
| Discover it `discover_it` | cash | Discover | 0 | 1x | 5x on the `rotating` slot to $1,500/qtr [rotating] | ported | A |
| U.S. Bank Cash+ `us_bank_cash_plus` | cash | Visa | 3% | 1x | 5x on the `five` slot to $2,000/qtr [five] · 2x on the `two` slot | ported | A |
| BofA Customized Cash `bofa_customized_cash` | cash | Visa | 3% | 1x | 3x on the `choice` slot to $2,500/qtr [bonus] · Groceries 2x to $2,500/qtr [bonus] · Wholesale Clubs 2x to $2,500/qtr [bonus] | ported | A, B |
| Capital One VentureOne `capital_one_venture_one` | Capital One | Mastercard | 0 | 1.25x | Capital One Travel 5x | ported | A |

**Current slot choices:** Bilt Obsidian `choice` = Groceries. No quarter's rotating categories are entered. Cash+ and BofA choices are not entered.

**Held but not modeled** (no terms set up): Fidelity Rewards, Amex Cash Magnet, Atmos Summit, Best Buy, Rakuten, store cards.

---

## 6. Visual spec (the explainer page)

Open `reference/points-decision-tree.html` to see it working. The page is one reading column, at most 1080px wide.

### Structure
1. **Header:** an eyebrow ("Cards"), the H1 "How a purchase becomes points", and a lede. The lede names the two example cards: one hotel-points card (Hilton Aspire) and one transferable card (Citi Strata Premier).
2. **The decision tree**
   - **Sample picker:** pill chips grouped Travel / Everyday / Edge cases, with 17 samples. The choice is remembered.
   - **Trunk:** node 1 (line kind), a wire, then node 2 (merchant path).
   - **Fork:** an SVG that splits one wire into two lanes.
   - **Two lanes,** one per card. Each has a card header (a small card-art swatch, the card name, and "Hotel points · Amex" or "Transferable points · Mastercard"), then nodes 3, 4 and 5.
   - **Footnote:** the start date, and that a rate set by hand overrides everything.
3. **Best card for each kind of spending**
   - **Controls:** a segmented control for Cash back / Travel. A smaller segmented control for Frequent Miler values / Minimum value appears only on the Travel path.
   - A mode note: one sentence on how values are counted.
   - **Fewest cards panel:** "N cards cover every row", then a chip for each card listing the rows it covers.
   - **The table:** Spending | Best card | Cash back (or Travel value per $) | Past the limit. Group rows act as dividers.
   - **Bonus slots:** an auto-fit grid of small panels.
   - **"Values used":** a collapsible panel with the editable table of cents per point, and a reset button.
   - **"Where the numbers come from":** a sources list with links and dates, ending with "This compares the cards' published terms. It isn't advice from a licensed financial advisor."

### Tree node details
- **Node:** a surface panel with a hairline border and 13px corners. Its header has a step number in a 24px outlined circle (accent color), the title, and a right-aligned muted hint.
- **Node 1:**
  - The five kinds are shown as dashed pills, and the active one is solid with an accent tint.
  - For a kind that can't earn, an end box shows a big "0" and the reason. Everything after it is dimmed (38% opacity) and the lanes show 0 points.
- **Node 2:**
  - **The lookup chain:** "Your fix → Merchant rule → Plaid's category → Unknown". Sources that were tried and missed are struck through, and the one used is accent-tinted and bold.
  - **Two path boxes side by side:**
    - "Merchant path · used for points": the path in large type, with "In the US" or "Abroad" under it, on an accent-tinted background.
    - "Your category · budgets only": the budget category, with "Points never read it", in a dashed outline.
  - A one-sentence "why" explanation under the boxes.
- **Node 3, the ladder:** four rungs, Brand / Sub-category / Category / Base rate, each with a hint ("the merchant itself", "e.g. Hotels"…). Every rule of the card appears as a chip on its rung.
  - **Rung states:**
    - **hit:** the winning rung, accent tint and accent label.
    - **miss:** a higher rung that didn't match, normal.
    - **skip:** below the winner, dimmed to 42%.
  - **Chip states:**
    - **win:** solid accent.
    - **fail:** matches the path but the condition fails. Warning color with the rate struck through, plus a sentence: "Dining matches, but its 7x is US only, so the next rung down pays."
    - **lower:** matches but loses. Dashed border.
    - **plain:** doesn't match.
  - Tags on chips: "US only", "online only", "covers Airlines" (a category rule reaching a sub-category).
- **Node 4:** one line, either "Capped at $X." or "No cap on this rule…" with a short explanation of caps.
- **Node 5:** the points in 30px display type, with the currency unit beside it.
  - The formula under it: "$120 × 7".
  - For Amex, "Amex rounds the amount to the nearest dollar first."
  - For refunds, a minus sign and the warning color.
  - For unknown merchants, a "Goes to the review list" flag.

**Samples** (id: path, plus what each one teaches)

| Group | Sample | Merchant path | Lesson |
|---|---|---|---|
| Travel | Hilton stay, booked with Hilton | Hotels › Hilton | brand rung wins |
| | Hilton stay, booked on Citi Travel | Portal › Citi Travel | the booking site is the merchant; your category can still say Hotels |
| | Marriott stay, booked with Marriott | Hotels › Marriott | |
| | United flight, booked with United | Airlines › United | |
| | Uber ride | Transit › Uber | your category differs (Ground Transportation) |
| Everyday | Dinner in the US | Dining (from Plaid) | the bank feed's category used |
| | Dinner abroad | Dining, abroad | Aspire's US-only 7x fails and drops to base |
| | DoorDash order | Dining › DoorDash | delivery earns dining rates |
| | Whole Foods | Groceries › Whole Foods | |
| | Costco | Wholesale Clubs › Costco | not Groceries, even if your category says so |
| | Shell gas station | Gas Stations (from Plaid) | |
| Edge cases | Gift card | Gift Cards | own category, base rate |
| | A merchant nobody knows | none | base rate plus the review list |
| | Refund of the Hilton stay | Hotels › Hilton | negative points at the purchase's rate |
| | Statement credit / Annual fee / Card payment | — | the tree stops at step 1 |

### Design tokens
Colors are tokens on `:root`, redefined for dark mode under `prefers-color-scheme: dark` and `[data-theme="dark"]`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #EEF2F7 | #0B1220 | page |
| `--surface` | #FFFFFF | #111A2B | panels |
| `--raised` | #F5F8FB | #172236 | table heads, chips, end boxes |
| `--line` | rgba(15,23,42,.10) | rgba(226,232,240,.11) | hairlines |
| `--line-2` | rgba(15,23,42,.20) | rgba(226,232,240,.22) | wires, inputs, dashed outlines |
| `--tx` / `--tx2` / `--tx3` | #0F172A / #475569 / #6B7A8F | #E6ECF4 / #A9B6C8 / #8392A8 | text, secondary, muted |
| `--ac` | #2563EB | #60A5FA | accent (brand blue) |
| `--ac-fg` | #FFFFFF | #06122A | text on accent |
| `--ac-soft` | rgba(37,99,235,.09) | rgba(96,165,250,.15) | accent tint |
| `--good` / `--good-soft` | #047857 / .10 | #34D399 / .13 | (reserved) |
| `--warn` / `--warn-soft` | #B45309 / .10 | #FBBF24 / .13 | failed conditions, caps, unconfirmed terms |

**Type and spacing**
- **Fonts:** Outfit (500/600/700) for headings and numbers; Plus Jakarta Sans (400–700) for body text, at 15px with 1.55 line height.
- **Sizes:** H1 clamp(30px, 4.4vw, 42px); H2 24px; H3 16px.
- **Numbers:** tabular figures.
- **Corners:** 13px on panels, 9–10px on inner boxes, 999px on pills.
- **Spacing:** 64px between sections and 18px inside them. Wires are 2px wide and 22px tall.

### Behavior
- **Responsive, at 760px and below:**
  - the lanes stack and the fork is hidden;
  - the path boxes stack and the rung labels go above their chips;
  - the best-card table turns into stacked cards, each cell labelled from `data-l`.
- **Memory:** the sample, path, preset and edited values are kept in `localStorage` (keys `pdt:sample`, `pdt:path`, `pdt:preset`, `pdt:vals`). Every read and write is wrapped in try/catch, so the page works without storage.
- **Accessibility:**
  - Chips and segmented buttons use `aria-pressed`, and the tree region is `aria-live="polite"`.
  - Focus is a 2px accent outline.
  - Reduced motion turns off transitions.
- **Copy style:** plain language and short sentences. Each sample has a one-sentence "why", and "Your category" always carries the note "Points never read it".

---

## 7. Acceptance checks

These figures were computed from `reference/engine.js` and `reference/rules.json` (2026-11-07). A rebuild should reproduce them exactly.

**Tree:** the rate and points on the two example cards.

| Purchase | Hilton Aspire | Citi Strata Premier |
|---|---|---|
| Hilton stay, $400 | 14x → 5,600 | 3x → 1,200 |
| Hilton stay on Citi Travel, $400 | 3x → 1,200 | 10x → 4,000 |
| United flight, $600 | 7x → 4,200 | 3x → 1,800 |
| Dinner in the US, $120 | 7x → 840 | 3x → 360 |
| Dinner abroad, $120 | 3x → 360 | 3x → 360 |
| DoorDash, $45 | 7x → 315 | 3x → 135 |
| Costco, $250 | 3x → 750 | 1x → 250 |
| Gas station, $60 | 3x → 180 | 3x → 180 |
| Gift card, $200 | 3x → 600 | 1x → 200 |
| Unknown merchant, $80 | 3x → 240 | 1x → 80 |
| Amex rounding: dinner $45.50 | 7x → 322 | 3x → 136.5 |

Non-Amex cards use the exact amount, so fractional points can appear (136.5).

**Best card:** the top value per dollar and the cards that tie for it (first three shown, "+N" for the rest), with the value past the cap where one applies.

| Spending | Cash back | Travel, Frequent Miler | Travel, minimum |
|---|---|---|---|
| Restaurants in the US | 3% Chase Freedom Flex / Chase Freedom Unlimited / Chase Sapphire Preferred | 4.5¢ Citi Strata Premier / Chase Freedom Flex / Chase Freedom Unlimited (+1) | 3¢ Citi Strata Premier / Chase Freedom Flex / Chase Freedom Unlimited (+2) |
| Restaurants abroad | 3% Chase Sapphire Preferred | 4.5¢ Citi Strata Premier / Chase Sapphire Preferred | 3¢ Citi Strata Premier / Chase Sapphire Preferred / World of Hyatt |
| Supermarkets, in store | 2.25% Citi Strata Premier | 4.65¢ Bilt Obsidian; past the cap 4.5¢ | 3.75¢ Bilt Obsidian; past the cap 3¢ |
| Costco (Visa only) | 2% BofA Customized Cash; past the cap 1.5% | 2.25¢ Chase Freedom Unlimited | 2¢ BofA Customized Cash; past the cap 1.5¢ |
| Gas stations | 3% Chase Sapphire Preferred | 4.5¢ Citi Strata Premier / Chase Sapphire Preferred | 3¢ Citi Strata Premier / Chase Sapphire Preferred / Atmos Ascent |
| Flights, booked with the airline | 3% Amex Platinum | 7.5¢ Amex Platinum | 5¢ Amex Platinum |
| Hilton stays | 2.25% Citi Strata Premier | 4.9¢ Hilton Aspire | 4.9¢ Hilton Aspire |
| Hyatt stays | 2.25% Citi Strata Premier | 6¢ World of Hyatt | 6¢ World of Hyatt |
| Hotels on a card's own travel site | 7.5% Citi Strata Premier | 15¢ Citi Strata Premier | 10¢ Citi Strata Premier |
| Anything without a bonus | 2% Citi Double Cash | 3¢ Amex Blue Business Plus / Citi Double Cash | 2¢ Amex Blue Business Plus / Citi Double Cash |

On the travel path, "Supermarkets, in store" is capped: Bilt pays 3x up to $25,000 a year, after which Strata Premier takes over.

---

## 8. Phase 2: valuation that depends on the whole portfolio

### The problem
A point's value depends on the **other** cards the holder (or household) has, not just on the card that earned it:
- **Chase:** Ultimate Rewards earned on a Freedom card are worth 1¢ in cash on their own. Holding a Sapphire Preferred, Sapphire Reserve or Ink Business Preferred unlocks transfers to partners. Which card unlocks them can change the ratio. Example (the owner's note, to verify): with a Sapphire Reserve, points move to Hyatt 1:1. The Sapphire Preferred's June 2026 refresh reportedly cut its Hyatt ratio to 4:3 from October 2026 ([The Points Guy](https://thepointsguy.com/news/chase-sapphire-preferred-refresh-2026)).
- **Citi:** Strata Premier points cash out at 0.75¢ alone, but reportedly at 1¢ when a Custom Cash or Double Cash shares the ThankYou account. Custom Cash and Double Cash points become transferable only alongside a Strata Premier (or Strata Elite).
- **Amex:** Membership Rewards cash-out and portal values can differ by card. Verify any per-card terms before modeling them.

Version 1 (this spec) hard-codes two of these links (Freedom → Sapphire Preferred, Custom Cash and Double Cash → Strata Premier) and gives each currency a fixed value. Phase 2 makes the value depend on the portfolio.

### Proposed data model
```
Program (currency)          ur, mr, ty, c1, bilt, hyatt, …
  pooling:                  who can combine points with whom
                            (same holder only | one household member | anyone), with limits and source
  routes: [                 ways to redeem
    { type: 'cash' | 'portal' | 'transfer',
      partner?: 'hyatt',    // transfer only
      ratio?: 1.0,          // partner points per program point (4:3 → 0.75)
      cents?: 1.0,          // cash or portal value per point
      requires_any?: ['chase_sapphire_reserve', …],   // a card that must be held (by the holder, or by someone they can pool with)
      source, checked }     // link and date
  ]
Partner value               cents per partner point (default: the Frequent Miler RRV; user-editable)
Portfolio                   cards held: product key, holder, open date, statement close day
Spend profile               annual spend per row of the best-card table (from real transactions)
```

### Algorithm
For each card in the portfolio:
1. **Reachable routes:** the routes whose `requires_any` is met by a card the holder can pool with.
2. **Value per point on the cash path:** the best cash route.
3. **Value per point on the travel path:** the best of
   - each cash or portal route's `cents`, and
   - each transfer's `ratio × partner value`.

   Example: Ultimate Rewards to Hyatt at 1:1 × 1.5¢ = 1.5¢; at 4:3 it is 0.75 × 1.5¢ = 1.125¢.
4. Feed these values into the existing `pick()` in place of the fixed currency values, and show the route used ("via Hyatt 1:1 with Sapphire Reserve").

### Recommendations it enables
1. **Where to put each kind of spending:** the existing table, now aware of the portfolio.
2. **Before you redeem:** for example, "move Freedom points to the Sapphire before redeeming", or "link Custom Cash and Strata Premier in one ThankYou account".
3. **Add or keep a card:** the yearly change in value when a card is added or removed. This counts:
   - the change on each spending row (spend × the best value with the card, minus without it);
   - the change in value of points earned on *other* cards that the card unlocks or loses;
   - minus the annual fee;
   - plus credits, valued at the use the user says they get, never at face value by default.

   Present the result as a range, using the minimum and Frequent Miler presets.

### Guardrails
- Every route carries a source and a checked date. Unverified routes show a visible warning, and the user can switch them off.
- Point values are estimates and stay editable. Show the assumptions next to every recommendation.
- Prefer plain, user-chosen inputs (which cards are pooled, how much a credit is really used) over inference.
- Recommendations compare published terms. They are not financial advice from a licensed advisor.

---

## 9. Known gaps (as of 2026-11-07)

- **Flights booked on a card's travel site get the wrong rate.** A booking site is one merchant, so the engine can't tell flights from hotels there:
  - Hilton Aspire earns 3x on flights booked on Amex Travel, but the card pays 7x.
  - Strata Premier gets 10x on Citi Travel flights, but its 10x covers only hotels, car rentals and attractions; flights there earn 3x.
  - Platinum and Business Gold may overpay car rentals and pay-later hotels on Amex Travel the same way.

  Fixing this needs a booking-type signal from the descriptor or the bank feed.
- **Sapphire Preferred's June 2026 refresh is only partly modeled.**
  - In place: 3x on gas and EV charging, and 3x groceries online only.
  - Not added yet: 3x on vacation homes (Airbnb, Vrbo).
  - Not modeled: the Hyatt 4:3 change, which belongs in phase 2.
- **Most products are ported, not verified,** so check their terms before relying on them.
- **Foreign transaction fees are hard-coded** in `PRODUCTS`.
- **Top-category cards** (Custom Cash, Business Gold) are shown only as bonus slots. The best-card table doesn't model them because they depend on each cycle's spending.
- **Rotating and chosen categories** are entered only for Bilt.
- **The Citi 1¢ route** through a linked Custom Cash or Double Cash hasn't been reconfirmed since 2025.
