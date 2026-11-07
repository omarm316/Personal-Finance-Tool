// Points decision tree engine (see SPEC.md). A JavaScript mirror of the original
// app's Python engine. RULES comes from rules.json (earn rules + holders).
// In Node: const E = require('./engine.js'); E.buildCards(require('./rules.json')).

const CATS = {
  'Travel': null, 'Airlines': 'Travel', 'Hotels': 'Travel', 'Car Rental': 'Travel',
  'Vacation Rentals': 'Travel', 'Transit': 'Travel', 'Portal': null, 'Dining': null,
  'Groceries': null, 'Superstores': null, 'Wholesale Clubs': null,
  'Gas & EV': null, 'Gas Stations': 'Gas & EV', 'EV Charging': 'Gas & EV', 'Drugstores': null,
  'Streaming': null, 'Online Shopping': null, 'Electronics': null, 'Home Improvement': null,
  'Fitness': null, 'Live Entertainment': null, 'Phone & Internet': null,
  'Wireless': 'Phone & Internet', 'Cable & Internet': 'Phone & Internet', 'Advertising': null,
  'Software & Cloud': null, 'Gift Cards': null, 'Other': null,
};
const parentOf = c => CATS[c] || null;
const levelOf = c => (CATS[c] ? 2 : 1);

// Values in cents per point. kind: brand (hotel/airline), flex (transferable), cash.
const CUR_DEFAULTS = {
  ur:      { name: 'Chase Ultimate Rewards', short: 'Chase UR', kind: 'flex', fm: 1.5, cash: 1.0, floor: 1.0,
             floorHow: 'cash, or Chase Travel', cashHow: 'deposit or statement credit' },
  mr:      { name: 'Amex Membership Rewards', short: 'Amex MR', kind: 'flex', fm: 1.5, cash: 0.6, floor: 1.0,
             floorHow: 'flights paid with points on Amex Travel', cashHow: 'statement credit' },
  ty:      { name: 'Citi ThankYou', short: 'Citi TY', kind: 'flex', fm: 1.5, cash: 0.75, cashCC: 1.0, floor: 1.0,
             floorHow: 'Citi Travel', cashHow: 'Strata Premier account, since Aug 2025',
             cashCCHow: 'Custom Cash and Double Cash accounts' },
  c1:      { name: 'Capital One Miles', short: 'Capital One', kind: 'flex', fm: 1.45, cash: 0.5, floor: 1.0,
             floorHow: 'erase a travel purchase', cashHow: 'statement credit' },
  bilt:    { name: 'Bilt Points', short: 'Bilt', kind: 'flex', fm: 1.55, cash: 0.55, floor: 1.25,
             floorHow: 'Bilt Travel', cashHow: 'statement credit' },
  hilton:  { name: 'Hilton Honors', short: 'Hilton', kind: 'brand', fm: 0.35 },
  marriott:{ name: 'Marriott Bonvoy', short: 'Marriott', kind: 'brand', fm: 0.73 },
  hyatt:   { name: 'World of Hyatt', short: 'Hyatt', kind: 'brand', fm: 1.5 },
  united:  { name: 'United MileagePlus', short: 'United', kind: 'brand', fm: 1.3 },
  delta:   { name: 'Delta SkyMiles', short: 'Delta', kind: 'brand', fm: 1.1 },
  aa:      { name: 'American AAdvantage', short: 'AAdvantage', kind: 'brand', fm: 1.4 },
  atmos:   { name: 'Atmos Rewards', short: 'Atmos', kind: 'brand', fm: 1.5 },
  cash:    { name: 'Cash back', short: 'cash', kind: 'cash', cash: 1.0 },
  amazon:  { name: 'Amazon points', short: 'Amazon', kind: 'cash', cash: 1.0 },
};

// product_key → display, currency, network, portal brand, foreign fee (%)
const PRODUCTS = {
  hilton_aspire:            { name: 'Hilton Aspire', cur: 'hilton', net: 'Amex', issuer: 'AMEX', portal: 'Amex Travel' },
  amex_platinum:            { name: 'Amex Platinum', cur: 'mr', net: 'Amex', issuer: 'AMEX', portal: 'Amex Travel' },
  amex_business_gold:       { name: 'Amex Business Gold', cur: 'mr', net: 'Amex', issuer: 'AMEX', portal: 'Amex Travel' },
  citi_strata_premier:      { name: 'Citi Strata Premier', cur: 'ty', net: 'Mastercard', issuer: 'CITI', portal: 'Citi Travel' },
  chase_freedom_flex:       { name: 'Chase Freedom Flex', cur: 'ur', net: 'Mastercard', issuer: 'CHASE', portal: 'Chase Travel', ftf: 3 },
  chase_freedom:            { name: 'Chase Freedom', cur: 'ur', net: 'Visa', issuer: 'CHASE', portal: 'Chase Travel', ftf: 3 },
  chase_freedom_unlimited:  { name: 'Chase Freedom Unlimited', cur: 'ur', net: 'Visa', issuer: 'CHASE', portal: 'Chase Travel', ftf: 3 },
  chase_sapphire_preferred: { name: 'Chase Sapphire Preferred', cur: 'ur', net: 'Visa', issuer: 'CHASE', portal: 'Chase Travel' },
  chase_amazon_prime:       { name: 'Amazon Prime Visa', cur: 'amazon', net: 'Visa', issuer: 'CHASE', portal: 'Chase Travel' },
  bilt_obsidian:            { name: 'Bilt Obsidian', cur: 'bilt', net: 'Mastercard', issuer: 'BILT', portal: 'Bilt Travel' },
  united_quest:             { name: 'United Quest', cur: 'united', net: 'Visa', issuer: 'CHASE', portal: 'Chase Travel' },
  united_explorer:          { name: 'United Explorer', cur: 'united', net: 'Visa', issuer: 'CHASE', portal: 'Chase Travel' },
  amex_blue_business_plus:  { name: 'Amex Blue Business Plus', cur: 'mr', net: 'Amex', issuer: 'AMEX', portal: 'Amex Travel', ftf: 2.7 },
  marriott_bonvoy_brilliant:{ name: 'Marriott Bonvoy Brilliant', cur: 'marriott', net: 'Amex', issuer: 'AMEX', portal: 'Amex Travel' },
  marriott_bonvoy_boundless:{ name: 'Marriott Bonvoy Boundless', cur: 'marriott', net: 'Visa', issuer: 'CHASE', portal: 'Chase Travel' },
  hilton_honors:            { name: 'Hilton Honors (Amex)', cur: 'hilton', net: 'Amex', issuer: 'AMEX', portal: 'Amex Travel' },
  hyatt_personal:           { name: 'World of Hyatt', cur: 'hyatt', net: 'Visa', issuer: 'CHASE', portal: 'Chase Travel' },
  citi_custom_cash:         { name: 'Citi Custom Cash', cur: 'ty', cashKey: 'cashCC', net: 'Mastercard', issuer: 'CITI', portal: 'Citi Travel', ftf: 3 },
  citi_double_cash:         { name: 'Citi Double Cash', cur: 'ty', cashKey: 'cashCC', net: 'Mastercard', issuer: 'CITI', portal: 'Citi Travel', ftf: 3 },
  citi_aa_platinum_select:  { name: 'Citi AAdvantage Platinum Select', cur: 'aa', net: 'Mastercard', issuer: 'CITI', portal: 'Citi Travel' },
  delta_gold:               { name: 'Delta SkyMiles Gold', cur: 'delta', net: 'Amex', issuer: 'AMEX', portal: 'Amex Travel' },
  atmos_ascent:             { name: 'Atmos Ascent', cur: 'atmos', net: 'Visa', issuer: 'BOA' },
  discover_it:              { name: 'Discover it', cur: 'cash', net: 'Discover', issuer: 'DISCOVER' },
  us_bank_cash_plus:        { name: 'U.S. Bank Cash+', cur: 'cash', net: 'Visa', issuer: 'US BANK', ftf: 3 },
  bofa_customized_cash:     { name: 'BofA Customized Cash', cur: 'cash', net: 'Visa', issuer: 'BOA', ftf: 3 },
  capital_one_venture_one:  { name: 'Capital One VentureOne', cur: 'c1', net: 'Mastercard', issuer: 'CAPITALONE', portal: 'Capital One Travel' },
};

// Card-level choices already in the app (card_category_selections).
const SELECTIONS = { bilt_obsidian: { choice: 'Groceries' } };

function normRules(spec) {
  const base = typeof spec.base === 'object' ? spec.base : { rate: spec.base };
  return [{ ...base, isBase: true, type: 'fixed' }, ...spec.rules.map(r => ({ type: 'fixed', ...r }))];
}

function buildCards(RULES) {
  return Object.entries(RULES).map(([key, spec]) => ({
    key, ...PRODUCTS[key], owners: spec.owners, checked: spec.checked,
    verified: spec.checked.startsWith('verified'), rules: normRules(spec),
    selections: SELECTIONS[key] || {},
  }));
}

function targetLevel(category, brand, t) {
  if (brand) return brand === t.brand ? 3 : 0;
  if (category && t.cat) {
    if (category === t.cat) return levelOf(category);
    if (category === parentOf(t.cat)) return 1;
  }
  return 0;
}

function condFail(r, t) {
  if (r.domestic && t.foreign) return 'US only';
  if (r.foreign && !t.foreign) return 'abroad only';
  if (r.online && !t.online) return 'online only';
  return null;
}

// Every rule of the card, with how it fares against transaction t.
// Order of the matching ones follows the engine: most specific level, then highest rate.
function evaluate(card, t) {
  const rows = [];
  for (const r of card.rules) {
    if (r.isBase) continue;
    let lvl, target;
    if (r.type === 'selected') {
      const sel = card.selections[r.slot];
      if (!sel) { rows.push({ r, lvl: 0, status: 'unset' }); continue; }
      target = sel;
      lvl = targetLevel(sel, null, t);
    } else {
      lvl = targetLevel(r.category, r.brand, t);
    }
    if (!lvl) { rows.push({ r, lvl: 0, status: 'no', target }); continue; }
    const fail = condFail(r, t);
    rows.push({ r, lvl, status: fail ? 'fail' : 'match', why: fail, target });
  }
  const cands = rows.filter(x => x.status === 'match').sort((a, b) => b.lvl - a.lvl || b.r.rate - a.r.rate);
  return { rows, cands, base: card.rules.find(r => r.isBase) };
}

// What one dollar can earn on this card for t: the first offer in the
// engine's order, then what applies once a cap is used up or a top-category
// condition doesn't hold. A top-N rule is shown as conditional.
function offers(card, t) {
  const { cands, base } = evaluate(card, t);
  const out = [];
  for (const c of cands) {
    const r = c.r;
    if (r.type === 'top_n') { out.push({ rate: r.rate, cond: 'top', r }); continue; }
    if (r.cap) {
      out.push({ rate: r.rate, cond: 'cap', r });
      if (r.after != null) { out.push({ rate: r.after, cond: null, after: r }); return out; }
      continue;
    }
    out.push({ rate: r.rate, cond: null, r });
    return out;
  }
  if (base.cap) {
    out.push({ rate: base.rate, cond: 'cap', r: base });
    out.push({ rate: base.after ?? 1, cond: null, after: base });
  } else out.push({ rate: base.rate, cond: null, r: base });
  return out;
}

function centsPerPoint(card, path, preset, CUR) {
  const c = CUR[card.cur];
  if (path === 'cash') return c.kind === 'brand' ? null : c[card.cashKey || 'cash'] ?? c.cash;
  if (c.kind === 'cash') return c.cash;
  if (preset === 'fm') return c.fm;
  return c.kind === 'flex' ? c.floor : c.fm;
}

const near = (a, b) => Math.abs(a - b) < 1e-9;
const YEARLY = { billing_cycle: 12, quarter: 4, calendar_year: 1, card_year: 1 };
// A cap matters for picking when it is under $100,000 a year.
const capMatters = r => r && r.cap && r.cap * (YEARLY[r.per] || 1) < 100000;

// Best card for one kind of spending on one path. Top-category bonuses
// (Custom Cash, Business Gold) move with your spending each cycle, so they
// are left out here and shown with the other bonus slots.
function pick(CARDS, row, path, preset, CUR) {
  const all = [];
  for (const card of CARDS) {
    if (row.portal && !card.portal) continue;
    if (row.network && card.net !== row.network) continue;
    const t = row.portal ? { ...row.t, brand: card.portal } : row.t;
    const cpp = centsPerPoint(card, path, preset, CUR);
    if (cpp == null) continue;
    const fee = row.t.foreign ? (card.ftf || 0) : 0;
    for (const o of offers(card, t)) {
      if (o.cond === 'top') continue;
      const capped = o.cond === 'cap' && capMatters(o.r);
      all.push({ card, rate: o.rate, r: o.r || o.after, capped, cpp, fee, value: o.rate * cpp - fee });
    }
  }
  const best = list => {
    const m = Math.max(...list.map(o => o.value));
    const seen = new Set();
    return { value: m, offers: list.filter(o => near(o.value, m) && !seen.has(o.card.key) && seen.add(o.card.key)) };
  };
  const top = best(all);
  const steady = best(all.filter(o => !o.capped));
  return { top, steady, capped: !near(top.value, steady.value) };
}

if (typeof module !== 'undefined') module.exports = { CATS, CUR_DEFAULTS, PRODUCTS, buildCards, evaluate, offers, pick, centsPerPoint, parentOf, levelOf, capMatters };
