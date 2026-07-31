import {BUDGET_TYPES_SET,CATEGORY_COLORS,INST_COLORS} from './constants';

export const fmt=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Math.abs(n??0));

export const fmtRound=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.abs(n??0));

export const fmtDate=d=>new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

export const fmtMonthLabel=d=>{const dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('en-US',{month:'short',year:'2-digit'});};
/* ── Pull-to-refresh hook (mobile only) ─────────────────────────────── */

export const _FALLBACK_COLORS=['#38BDF8','#16a34a','#ea580c','#7c3aed','#0891b2','#db2777','#9333ea','#ca8a04','#0d9488','#c026d3','#dc2626','#b45309'];

export const _hashStr=s=>Math.abs(s.split('').reduce((a,c)=>(a*31+c.charCodeAt(0))|0,0));

export const getCatColor=cat=>CATEGORY_COLORS[cat]||_FALLBACK_COLORS[_hashStr(cat||'')%_FALLBACK_COLORS.length];

export const hexToRgba=(hex,alpha)=>{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return`rgba(${r},${g},${b},${alpha})`;};

export const normalizeCat=cat=>(!cat||cat==='Unclassified')?'Other':cat;

export const monthStart=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;};

export const todayStr=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

export const localDateStr=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export const _CATS_LAST=new Set(['For Others','Other','Unclassified','other']);

export const sortedCats=(cats)=>{
  const regular=[...cats].filter(c=>!_CATS_LAST.has(c.name)).sort((a,b)=>a.name.localeCompare(b.name));
  const last=[...cats].filter(c=>_CATS_LAST.has(c.name)).sort((a,b)=>a.name.localeCompare(b.name));
  return[...regular,...last];
};
/* Capitalize first letter of each word — used for legacy lowercase DB values */

export const toTitleCase=s=>s?s.replace(/(^|\s|_)(\S)/g,(_,sep,c)=>(sep===' '?sep:' ')+c.toUpperCase()).trim():'';
/* Display-friendly account type labels (acronyms stay uppercase) */

export const _ACCT_TYPE_LABELS={'cd':'CD','hsa':'HSA','fsa':'FSA','ira':'IRA','401k':'401(k)'};

export const fmtAcctType=s=>s?(_ACCT_TYPE_LABELS[s.toLowerCase()]||toTitleCase(s)):'';

/* 8 canonical transaction types (Section 4B) */

export const showCategoryForType=(t)=>BUDGET_TYPES_SET.has(t);

/* ── Reusable multi-select dropdown filter ───────────────────────────── */
/* selected: null = all (no filter), Set = specific checked items.
   All checkboxes appear checked when selected is null.
   "Select All" → null.  "Clear All" → empty Set. */

export const instColor=(a)=>{
  const iid=a.institution_id||a.plaid_item_id||'';
  if(INST_COLORS[iid])return INST_COLORS[iid];
  // Deterministic color from institution name hash
  const s=a.account_name||'';let h=0;for(let i=0;i<s.length;i++)h=s.charCodeAt(i)+((h<<5)-h);
  const hues=[210,160,30,340,120,270,50];
  return `hsl(${hues[Math.abs(h)%hues.length]},45%,45%)`;
};
