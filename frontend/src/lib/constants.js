export const CHART_COLORS=['#38BDF8','#6ee7b7','#fcd34d','#c4b5fd','#67e8f9','#fdba74','rgba(248,113,113,0.3)','#bef264'];
// Canonical category colors — primary keys match database.py seed_categories exactly.
// Legacy aliases kept for backward-compat (old transactions may carry these names).

export const CATEGORY_COLORS={
  // ── Canonical (database.py seed) ──────────────────────────────────────────
  'Groceries':'#16a34a','Dining':'#ea580c','Transportation':'var(--blue-primary)',
  'Housing':'#b45309','Utilities':'#0891b2','Healthcare':'#dc2626',
  'Insurance':'#4f46e5','Vehicle':'#7c3aed','Fitness':'#0d9488',
  'Self Care':'#c026d3','Clothing':'#db2777','Electronics':'#475569',
  'Streaming':'#9333ea','Travel':'#0284c7','Home':'#92400e',
  'Kids':'#65a30d','Entertainment':'#9333ea','Gifts':'#e11d48',
  'Education':'#ca8a04','Fees & Interest':'#475569',
  'Other':'#6b7280','Business':'#0891b2','Investment Gain (Loss)':'#15803d',
  'Work':'#15803d','Transfer':'#94a3b8','Unclassified':'#9ca3af',
  // ── Legacy aliases ────────────────────────────────────────────────────────
  'Supermarket':'#16a34a','Restaurants':'#ea580c','Food & Drink':'#ea580c',
  'Auto':'var(--blue-primary)','Gas':'#7c3aed','Fuel':'#7c3aed',
  'Electric':'#0891b2','Water':'#0891b2','Internet':'#0891b2',
  'Health':'#dc2626','Medical':'#dc2626','Pharmacy':'#dc2626',
  'Personal Care':'#c026d3','Subscriptions':'#9333ea',
  'Hotel':'#0284c7','Flights':'#0284c7','Shopping':'#db2777',
  'Tuition':'#ca8a04','Rent':'#b45309','Mortgage':'#b45309',
  'Coffee':'#92400e','Pets':'#65a30d','Charity':'#e11d48',
  'Taxes':'#475569','Fees':'#475569','Income':'#15803d','Paycheck':'#15803d',
};

export const ICON_PATHS={
  home:`<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
  arrowUpDown:`<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>`,
  target:`<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`,
  trendingUp:`<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`,
  calendar:`<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>`,
  banknote:`<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>`,
  building:`<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>`,
  star:`<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  creditCard:`<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>`,
  wallet:`<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>`,
  settings:`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  chevronLeft:`<polyline points="15 18 9 12 15 6"/>`,
  chevronRight:`<polyline points="9 18 15 12 9 6"/>`,
  info:`<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
};

export const TXN_TYPES=['Expense','Income','Transfer','Investment Gain (Loss)','Purchase','Sale','Depreciation','Other'];
/* Types that show a category selector — only Expense and Income (Section 4C) */

export const BUDGET_TYPES_SET=new Set(['Expense','Income']);
/* Category only shown for Expense/Income */

export const INST_COLORS={'ins_3':'#003087','ins_4':'#003087','ins_56':'#003087',/*Chase*/'ins_5':'#016fd0','ins_10':'#016fd0',/*Amex*/'ins_13':'#1b3c6b',/*Citi*/'ins_127989':'#c41230',/*BofA*/'ins_12':'#cc0000','ins_15':'#d22e2e',/*Wells*/'ins_21':'#ff5f00',/*Discover*/'ins_22':'#f7931a',/*Cap1*/'ins_6':'#ef3829',/*HSBC*/'ins_11':'#e31837',/*USB*/'ins_19':'#1a8c39',/*TD*/};

export const BUCKET_STYLE={'Checking & Savings':{bg:'rgba(52,211,153,0.10)',color:'var(--green)'},'Investments':{bg:'rgba(96,165,250,0.10)',color:'#60a5fa'},'Credit Cards':{bg:'rgba(251,191,36,0.10)',color:'var(--amber)'},'Loans':{bg:'rgba(248,113,113,0.10)',color:'var(--red)'}};

export const PAGES=['dashboard','transactions','budgets','networth','cashflow',
             'cashplanner','loans','gcb','cards','accounts','settings'];
