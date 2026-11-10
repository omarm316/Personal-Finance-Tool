/* Figures for the Dashboard (docs/dashboard-design.md). Plain arithmetic on
   what /api/budget/targets, /api/budget/actuals and /api/stats return, so the
   page and its checks share one definition of every number. */
import {topLevelOf} from './categories';

// Transfer is money moving between accounts; Work is the income bucket.
export const SKIP=new Set(['Transfer','Work']);
export const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
// Where the money went: fixed colors by rank, the rest grey.
export const CATC=['#2563EB','#0D9488','#F59E0B','#DB2777','#7C3AED','#0EA5E9','#65A30D','#EA580C'];
export const REST_COLOR='#94A3B8';
export const WHERE_NAMED=5;   // 8 until 2026-11-07; 5 keeps the card level with pace and trend

export const pad=n=>String(n).padStart(2,'0');
export const lastDay=(y,m)=>new Date(y,m,0).getDate();
export const shiftYm=(y,m,k)=>{const d=new Date(y,m-1+k,1);return[d.getFullYear(),d.getMonth()+1];};
const r2=n=>Math.round(n*100)/100;

/* Unclassified (or no category) shows as Other */
export const ncat=c=>(!c||c==='Unclassified')?'Other':c;
export const topOf=c=>topLevelOf(ncat(c));

/* $1,234.56, with a minus sign when negative */
export const m2=n=>(n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
/* Short form for chart labels: $950, $1.2k, $16k, $1.25M */
export const k1=n=>{const a=Math.abs(n),s=n<0?'-':'';return s+(a>=1e6?'$'+(a/1e6).toFixed(2)+'M':a>=1e4?'$'+Math.round(a/1e3)+'k':a>=1e3?'$'+(a/1e3).toFixed(1)+'k':'$'+Math.round(a));};
export const usd0=n=>'$'+Math.round(n).toLocaleString('en-US');

/* The selected period and the one it is compared with. A month in progress
   runs through today and compares with the same days of last month; Year to
   date runs Jan 1 through the selected month and compares with the same span
   of last year. */
export function period(view,Y,M,now=new Date()){
  const cy=now.getFullYear(),cm=now.getMonth()+1;
  const isCM=Y===cy&&M===cm,endDay=isCM?now.getDate():lastDay(Y,M);
  let start,end,pStart,pEnd,pY,pM;
  if(view==='month'){
    [pY,pM]=shiftYm(Y,M,-1);
    start=`${Y}-${pad(M)}-01`;end=`${Y}-${pad(M)}-${pad(endDay)}`;
    pStart=`${pY}-${pad(pM)}-01`;pEnd=`${pY}-${pad(pM)}-${pad(Math.min(endDay,lastDay(pY,pM)))}`;
  }else{
    pY=Y-1;pM=M;
    start=`${Y}-01-01`;end=`${Y}-${pad(M)}-${pad(endDay)}`;
    pStart=`${pY}-01-01`;pEnd=`${pY}-${pad(M)}-${pad(Math.min(endDay,lastDay(pY,M)))}`;
  }
  return{view,Y,M,isCM,endDay,start,end,pStart,pEnd,pY,pM,
    months:view==='month'?[M]:Array.from({length:M},(_,i)=>i+1),
    label:view==='month'?`${MONL[M-1]} ${Y}`:`Jan – ${MON[M-1]} ${Y}`,
    cmp:view==='month'?'vs. last month':'vs. last year'};
}

const flag=r=>{
  r.hasB=r.budget>0;r.credit=r.actual<0;r.pct=r.hasB?r.actual/r.budget:0;
  r.over=r.hasB&&!r.credit&&r.pct>=1;r.near=r.hasB&&!r.over&&!r.credit&&r.pct>=.8;r.noB=!r.hasB&&r.actual>0;
  return r;
};

/* One row per category with a budget or spending in the period. */
export function budgetRows(targets,actuals,months){
  const map=new Map();
  const add=(c,b,a)=>{const k=ncat(c),e=map.get(k)||{cat:k,budget:0,actual:0};e.budget+=b;e.actual+=a;map.set(k,e);};
  Object.entries(targets||{}).forEach(([c,mm])=>{if(!SKIP.has(c))add(c,months.reduce((s,m)=>s+(mm?.[m]?.amount||0),0),0);});
  Object.entries(actuals||{}).forEach(([c,mm])=>{if(!SKIP.has(c))add(c,0,months.reduce((s,m)=>s+(mm?.[m]||0),0));});
  const rows=[...map.values()].map(r=>flag({...r,budget:r2(r.budget),actual:r2(r.actual)}))
    .filter(r=>Math.abs(r.budget)>.004||Math.abs(r.actual)>.004);
  return{rows,tot:{budget:r2(rows.reduce((s,r)=>s+r.budget,0)),actual:r2(rows.reduce((s,r)=>s+r.actual,0))}};
}

/* Furthest over budget first, then no-budget rows by amount, Other always last */
export function sortRows(rows){
  return[...rows].sort((a,b)=>{
    const ao=a.cat==='Other',bo=b.cat==='Other';if(ao!==bo)return ao?1:-1;
    if(a.hasB!==b.hasB)return a.hasB?-1:1;
    if(!a.hasB)return b.actual-a.actual;
    return b.actual/b.budget-a.actual/a.budget;
  });
}

/* Categories added up within their top level. `kids` are the categories
   inside; `solo` when the only one is the top level itself. */
export function groupRows(rows){
  const m=new Map();
  rows.forEach(r=>{const t=topLevelOf(r.cat),g=m.get(t)||{cat:t,budget:0,actual:0,kids:[]};g.budget+=r.budget;g.actual+=r.actual;g.kids.push(r);m.set(t,g);});
  return sortRows([...m.values()].map(g=>{
    flag(Object.assign(g,{budget:r2(g.budget),actual:r2(g.actual)}));
    g.kids=sortRows(g.kids);g.solo=g.kids.length===1&&g.kids[0].cat===g.cat;
    return g;
  }));
}

/* Month pace: spending so far against the share of the period gone. */
export function pace(per,tot){
  const doy=(y,m,d)=>Math.round((new Date(y,m-1,d)-new Date(y,0,1))/864e5)+1;
  const{Y,M,endDay,view}=per,B=tot.budget,X=tot.actual;
  const total=view==='month'?lastDay(Y,M):doy(Y,M,lastDay(Y,M));
  const elapsed=view==='month'?endDay:doy(Y,M,endDay);
  const share=elapsed/total,done=elapsed>=total,proj=share>0?X/share:X;
  return{B,X,total,elapsed,share,done,proj,pct:B>0?X/B:0,over:X>B};
}

/* Monthly spending (every category but Transfer and Work) for the 6 months
   ending at the selected one. `actualsByYear` maps a year to its actuals. */
export function trendMonths(Y,M,actualsByYear){
  return Array.from({length:6},(_,i)=>{
    const[y,m]=shiftYm(Y,M,i-5),src=actualsByYear[y]||{};
    const spend=Object.entries(src).reduce((s,[c,mm])=>SKIP.has(c)?s:s+(mm?.[m]||0),0);
    return{y,m,ym:`${y}-${pad(m)}`,lab:MON[m-1],spend:r2(spend)};
  });
}

/* {top level: net spending} from /api/stats by_category, Transfer and Work left out */
export function topSpend(byCategory){
  const o={};
  Object.entries(byCategory||{}).forEach(([c,v])=>{if(SKIP.has(c))return;const k=topOf(c);o[k]=(o[k]||0)+v;});
  return o;
}

/* Where the money went: the largest top levels named in fixed colors, the
   rest in grey; last period's bar on the same scale, colored the same way;
   top levels that net to a credit listed for the note. */
export function whereData(cur,prev,N=WHERE_NAMED){
  const all=Object.entries(cur);
  const E=all.filter(([,v])=>v>.004).sort((a,b)=>b[1]-a[1]),tot=E.reduce((s,x)=>s+x[1],0);
  const credits=all.filter(([,v])=>v<-.004).sort((a,b)=>a[1]-b[1]),creditTotal=-credits.reduce((s,x)=>s+x[1],0);
  const items=E.slice(0,N).map(([k,v],i)=>({k,v,col:CATC[i%CATC.length]}));
  const rest=E.slice(N).reduce((s,x)=>s+x[1],0),rn=E.length-N;
  if(rest>.004)items.push({k:`${rn} more ${rn===1?'category':'categories'}`,v:rest,col:REST_COLOR,rest:true});
  let prevItems=null,ptot=0;
  if(prev){
    const pE=Object.entries(prev).filter(([,v])=>v>.004),rank={};
    items.forEach((x,i)=>{if(!x.rest)rank[x.k]=i;});
    ptot=pE.reduce((s,x)=>s+x[1],0);
    prevItems=pE.filter(([k])=>k in rank).map(([k,v])=>({k,v,col:items[rank[k]].col})).sort((a,b)=>rank[a.k]-rank[b.k]);
    const pr=pE.filter(([k])=>!(k in rank)).reduce((s,x)=>s+x[1],0);
    if(pr>.004)prevItems.push({k:'Other categories',v:pr,col:REST_COLOR,rest:true});
  }
  return{items,tot,prevItems,ptot,credits:credits.map(([k])=>k),creditTotal};
}
