# Kickoff prompt

Use this as the first message in a new Claude project, or paste the part between the lines into the project instructions. Upload these files with it: `SPEC.md`, `reference/engine.js`, `reference/rules.json` and `reference/points-decision-tree.html`.

---

I'm bringing over a credit card points model I built in another workspace. It works out how a purchase becomes points, values those points two ways (cash back and travel), and picks the best card in my household for each kind of spending. The full logic, data and visual design are in `SPEC.md`. `reference/engine.js` and `reference/rules.json` are the working implementation and card data. `reference/points-decision-tree.html` is the finished explainer page; open it to see the visual.

In the files, my household is **Holder A** (me) and **Holder B**. Ask me for names if you need them.

**First:**
1. Read `SPEC.md` in full, then the reference files. Before building anything, give me a short list of anything unclear, contradictory or out of date.
2. Rebuild the explainer page as an artifact (or a single HTML file) that matches section 6 of the spec (the visual) and reproduces section 7 (the acceptance checks) exactly. Keep the card rules and currency values as separate, editable data rather than mixing them into the code.

**Then, phase 2 (section 8 of the spec):** make point values depend on the whole portfolio, and add recommendations. For example, with a Chase Sapphire Reserve, Ultimate Rewards move to Hyatt 1:1, which raises the travel value of every Chase point I earn, including points from the Freedom cards. Start by proposing the data model and the first recommendations view; don't build until I've agreed. Ask me for my real portfolio and spending rather than assuming them.

**Ground rules:**
- **Card terms change.** Before relying on an earn rate, transfer ratio, cash-out value or credit, check it against a published source. Record the source and date, and mark unverified terms visibly.
- **Point values are estimates.** Label them as estimates, keep them editable, and never present them as value I've actually received.
- **Keep the logic simple.** I'd rather pick values and settings from a plain list than rely on inference that needs upkeep.
- **Write page copy in plain language:** short sentences, and explain any jargon the first time it appears.
- **This compares published terms; it isn't financial advice.** Say so on any page that recommends cards.
- **Ask before any assumption that changes results.** For example, who holds a card, or whether two accounts are pooled.

---

## What carries over and what doesn't

- **Carried over:** the decision tree logic, the category tree and brands, the earn rules for 26 products, the currency values and their sources, the best-card picking, the visual design and the known gaps.
- **Not carried over:** real transactions, balances, account numbers and names. The engine in the original app scores real transactions from a bank feed; here, the samples and spending rows stand in for them until you connect real data.
