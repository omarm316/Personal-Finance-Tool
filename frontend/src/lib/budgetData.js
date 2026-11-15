/* Figures for the Budgets page (docs/budgets-design.md). Plain arithmetic on
   what /api/budget/targets and /api/budget/actuals return, kept apart from the
   page so docs/budget_model_check.mjs can run it without a browser.

   Keys: a category name, "g:" + a top level for the top level's total (itself
   and everything in it), or "o:" + a top level for its Other row.

   Other: a top level's budget is its total. The budget stored on the top level
   itself is Other, the part its categories don't take. Other is never typed;
   changing a category takes from it, and when the categories add up to more
   than the total, the total rises and Other stays at zero. */

export const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const ALL12=[1,2,3,4,5,6,7,8,9,10,11,12];
export const r2=n=>Math.round(n*100)/100;
export const lastDay=(y,m)=>new Date(y,m,0).getDate();

/* Unclassified (or no category) counts as Other, as on the Dashboard */
export const ncat=c=>(!c||c==='Unclassified')?'Other':c;
const HIDDEN=new Set(['Transfer','Unclassified']);

/* $1,234.56 · $1,234 · 1,234 (the sheets) */
export const m2=n=>(n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export const m0=n=>(Math.round(n)<0?'-':'')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US');
const nAbs=n=>Math.abs(Math.round(n)).toLocaleString('en-US');
/* Signed: "+$262" / "−$4,970"; nothing for zero */
export const sg=(n,f=m0)=>(Math.round(n)>0?'+':Math.round(n)<0?'−':'')+f(Math.abs(n));
/* Sheet numbers: "1,200" with no dollar sign; credits "+3,303"; blank for zero
   unless `zero`; `signed` puts + or − on every figure (the Net row). */
export function sx(v,o={}){
  if(Math.abs(v)<.5)return o.zero?'0':'';
  if(o.signed)return(v>0?'+':'−')+nAbs(v);
  if(o.credit&&v<0)return'+'+nAbs(v);
  return(v<0?'−':'')+nAbs(v);
}
/* The plain number a cell shows while it has focus */
export const fv=n=>n?String(r2(n)):'';

/* Today, as the page sees it; past months lock */
export function today(now=new Date()){return{y:now.getFullYear(),m:now.getMonth()+1,d:now.getDate()};}
export const isPast=(T,y,m)=>y<T.y||(y===T.y&&m<T.m);
export const isFuture=(T,y,m)=>y>T.y||(y===T.y&&m>T.m);
export const isCur=(T,y,m)=>y===T.y&&m===T.m;
/* How many months of `y` have started: the heat map's total column compares
   spending with the budget for these months. */
export const monthsSoFar=(T,y)=>y<T.y?12:y>T.y?0:T.m;

export function buildModel(categories,targets,actuals){
  const par={},type={},ord={};
  (categories||[]).forEach((c,i)=>{par[c.name]=c.parent_category||null;type[c.name]=c.category_type;ord[c.name]=i;});
  const topOf=c=>par[c]||c;
  const isInc=c=>type[c]==='income'||type[topOf(c)]==='income';
  const A={};
  Object.entries(actuals||{}).forEach(([c,ms])=>{
    const t=A[ncat(c)]||(A[ncat(c)]={});
    Object.entries(ms||{}).forEach(([m,v])=>{t[m]=r2((t[m]||0)+v);});
  });
  const T=targets||{};
  const getB=(c,m)=>T[c]?.[m]?.amount||0;
  const getA=(c,m)=>A[c]?.[m]||0;
  // Every name on the page: the category list (so empty ones show) plus anything with a budget or spending.
  const mem={};
  const add=c=>{if(!c||HIDDEN.has(c))return;const t=topOf(c);(mem[t]||(mem[t]=new Set([t]))).add(c);};
  (categories||[]).forEach(c=>add(c.name));Object.keys(T).forEach(add);Object.keys(A).forEach(add);
  const members=t=>[...(mem[t]||[t])];
  const subs=t=>members(t).filter(c=>c!==t);
  const isGroup=t=>subs(t).length>0;
  const ordOf=c=>ord[c]===undefined?999:ord[c];
  const treeCmp=(a,b)=>ordOf(a)-ordOf(b)||a.localeCompare(b);
  const bOf=(k,m)=>{
    if(k.startsWith('g:'))return members(k.slice(2)).reduce((s,c)=>s+getB(c,m),0);
    if(k.startsWith('o:'))return getB(k.slice(2),m);
    return getB(k,m);
  };
  // Other's spending: what is booked on the top level itself, plus categories with no budget that month.
  const aOf=(k,m)=>{
    if(k.startsWith('g:'))return members(k.slice(2)).reduce((s,c)=>s+getA(c,m),0);
    if(k.startsWith('o:')){const t=k.slice(2);return subs(t).reduce((s,c)=>getB(c,m)>0?s:s+getA(c,m),getA(t,m));}
    return getA(k,m);
  };
  const tops=inc=>Object.keys(mem).filter(t=>isInc(t)===inc).sort(treeCmp);
  return{topOf,isInc,getB,getA,members,subs,isGroup,bOf,aOf,tops,treeCmp};
}

export const keyName=k=>k.startsWith('g:')||k.startsWith('o:')?k.slice(2):k;

export function flags(r){
  r.hasB=r.budget>0;r.credit=!r.inc&&r.actual<0;r.pct=r.hasB?r.actual/r.budget:0;
  r.over=!r.inc&&r.hasB&&!r.credit&&r.pct>=1;r.near=!r.inc&&r.hasB&&!r.over&&!r.credit&&r.pct>=.8;
  r.noB=!r.hasB&&r.actual>0;r.v=r.inc?r.actual-r.budget:r.budget-r.actual;
  return r;
}

/* One unit per top level: a plain row when it has no categories, else a group
   whose kids are its Other row (first) and its categories. `order` is 'spend'
   (most spent first, the Month view) or 'tree' (category order, the sheets). */
export function unitsFor(M,inc,ms,order){
  const sum=(k,f)=>r2(ms.reduce((s,m)=>s+f(k,m),0));
  const row=(k,extra)=>flags({key:k,inc,budget:sum(k,M.bOf),actual:sum(k,M.aOf),...extra});
  const sortBy=(list,name)=>order==='tree'?list.sort((a,b)=>M.treeCmp(name(a),name(b))):list.sort((a,b)=>b.actual-a.actual||M.treeCmp(name(a),name(b)));
  const units=M.tops(inc).map(t=>{
    if(!M.isGroup(t))return row(t,{cat:t,ek:t});
    const kids=sortBy(M.subs(t).map(c=>row(c,{cat:c,ek:c,top:t})),r=>r.cat);
    return row('g:'+t,{cat:t,ek:'g:'+t,isG:true,kids:[row('o:'+t,{cat:t,oth:true,ek:null,top:t}),...kids]});
  });
  sortBy(units,u=>u.cat);
  // The top level called Other always comes last.
  if(order!=='tree')units.sort((a,b)=>(a.cat==='Other')-(b.cat==='Other'));
  return units;
}

export function totalsFor(M,ms){
  const s=(inc,f)=>r2(M.tops(inc).reduce((a,t)=>a+ms.reduce((b,m)=>b+f('g:'+t,m),0),0));
  return{ib:s(true,M.bOf),ia:s(true,M.aOf),eb:s(false,M.bOf),ea:s(false,M.aOf)};
}

/* Applies typed cells in order and returns the new targets and the writes to
   send. A total sets Other to the total minus its categories (zero when they
   are more). A category takes the difference from Other; past zero the total
   rises instead. Writes are {category, month, amount}. */
export function applyCells(M,targets,cells){
  const T={...targets},W=new Map();
  const get=(c,m)=>T[c]?.[m]?.amount||0;
  const set=(c,m,v)=>{v=r2(v);T[c]={...(T[c]||{}),[m]:{...(T[c]?.[m]||{}),amount:v}};W.set(c+'|'+m,{category:c,month:m,amount:v});};
  cells.forEach(({k,m,n})=>{
    if(k.startsWith('o:'))return;
    if(k.startsWith('g:')){const t=k.slice(2),s=M.subs(t).reduce((a,c)=>a+get(c,m),0);return set(t,m,Math.max(0,n-s));}
    const t=M.topOf(k);
    if(t!==k){const d=n-get(k,m),o=Math.max(0,get(t,m)-d);set(k,m,n);if(Math.abs(o-get(t,m))>.004)set(t,m,o);return;}
    set(k,m,n);
  });
  return{targets:T,writes:[...W.values()]};
}

/* Heat map color: white on budget, green under and red over, by how far the
   cell is from its own budget; full color at 60% away. Income runs the other
   way. Spending with no budget is red. Months to come have none. */
export const HEAT_FULL=.6;
export function heatBg(b,a,inc){
  if(!(b>0)){if(inc||a<=.5)return null;return'color-mix(in srgb, var(--hr) 80%, var(--c-surface))';}
  const r=a/b,dev=inc?r-1:1-r,t=Math.min(Math.abs(dev)/HEAT_FULL,1);
  if(t<.02)return null;
  return`color-mix(in srgb, var(${dev>=0?'--hg':'--hr'}) ${Math.round(t*80)}%, var(--c-surface))`;
}
