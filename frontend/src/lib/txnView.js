/* Display helpers for transaction rows on the Cloud-look pages. */
import {BUDGET_TYPES_SET} from './constants';
import {fmt} from './format';

const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* Dates arrive as "2026-10-31T00:00:00"; read the calendar day as written,
   never through a time zone. */
export const ymd=d=>String(d||'').slice(0,10);
export const numDate=d=>{const[,m,day]=ymd(d).split('-');return m?`${Number(m)}/${Number(day)}`:'';};
export const longDate=d=>{const[y,m,day]=ymd(d).split('-');return m?`${MON[Number(m)-1]} ${Number(day)}, ${y}`:'';};

export const signed=n=>(n<0?'-':'+')+fmt(n);
export const isBudget=type=>BUDGET_TYPES_SET.has(type);
/* Red for money out, green for money in; transfers stay neutral */
export const amtClass=t=>t.action==='Transfer'?'':t.amount<0?'c-bad':'c-good';

/* The Review button and the Needs review chip */
export const needsReview=t=>!!t.needs_review;
export const showReviewBtn=t=>!!t.needs_review&&!t.is_locked;

/* AI labels after the name. Rule-sourced rows show none. */
export const SRC_LABEL={llm:'AI ENRICHED',fallback:'FALLBACK',override:'AUTO-OVERRIDE',plaid_pfc:'PLAID CATEGORY'};
export const lowConfidence=t=>t.category_confidence!=null&&t.category_confidence<0.8&&!t.is_locked;

export const IMPORT_LABEL={plaid:'Plaid',csv:'CSV',ofx:'OFX',manual:'Manual'};
export const ENRICH_LABEL={llm:'AI',rule:'Rule',override:'Manual override',fallback:'Fallback',plaid_pfc:'Plaid category'};

/* 2027 earning engine: merchant path fields apply from this date */
export const FRESH_START='2027-01-01';
export const is2027=t=>ymd(t.date)>=FRESH_START;
export const KINDS=[['purchase','Purchase'],['refund','Refund'],['fee','Fee'],['interest','Interest'],['credit','Credit'],['payment','Payment'],['p2p','Person to person'],['adjustment','Adjustment']];
export const kindLabel=k=>(KINDS.find(x=>x[0]===k)||[null,k])[1];
