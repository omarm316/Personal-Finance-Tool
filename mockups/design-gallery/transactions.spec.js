// Design gallery spec for the Transactions page, desktop.
// Content comes from the data file; this file holds no personal figures.
// The look (Cloud, brand blue, Outfit + Plus Jakarta, hairline panels, top bar,
// underlined period controls) was decided on the Cards pages and is locked here.
(function(){
const ICONS={home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',tx:'<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/>',trend:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>',cal:'<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="3" x2="21" y1="10" y2="10"/>',cash:'<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/>',bank:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/>',star:'<polygon points="12 2 15 8 22 9 17 14 18 21 12 18 6 21 7 14 2 9 9 8"/>',card:'<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',wallet:'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',plus:'<path d="M12 5v14M5 12h14"/>',up:'<path d="M12 19V5M5 12l7-7 7 7"/>',dots:'<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',split:'<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.2-2.9L3 3"/><path d="m15 9 6-6"/>',info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',ban:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  alert:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>',down:'<path d="m6 9 6 6 6-6"/>',right:'<path d="m9 6 6 6-6 6"/>',upc:'<path d="m18 15-6-6-6 6"/>',filter:'<path d="M3 5h18M6 12h12M10 19h4"/>',
  inA:'<path d="M17 7 7 17M7 7v10h10"/>',outA:'<path d="M7 17 17 7M7 7h10v10"/>',swap:'<path d="m17 3 4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3"/>'};
const NAV=[['Dashboard','home'],['Transactions','tx'],['Budgets','target'],['Net Worth','trend'],['Daily Balances','cal'],['Cash Flow','cash'],['Loans','bank'],['GCB','star'],['Cards','card'],['Accounts','wallet'],['Settings','gear']];
const ic=(n,s=16)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'var(--ac-l)','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,var(--ac-l) 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C','--plate':'#fff'});

const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const TYPES=['Expense','Income','Transfer','Investment Gain (Loss)','Purchase','Sale','Depreciation','Other'];
const FIRST='2026-08';   // the preview data starts here
const HUE={Groceries:'#0D9488',Dining:'#EA580C',Transportation:'#0284C7',Travel:'#7C3AED','Health & Wellness':'#16A34A',Housing:'#475569',Shopping:'#DB2777',Financial:'#64748B',Entertainment:'#9333EA',Family:'#D97706',Vehicle:'#A16207',Business:'#4F46E5',Other:'#78716C',Work:'#15803D',Unclassified:'#CBD5E1'};
const ECO={'Amex MR':'MR','Chase UR':'UR','Citi ThankYou':'ThankYou','Bilt Rewards':'Bilt','Hilton Honors':'Hilton','United MileagePlus':'United','Marriott Bonvoy':'Bonvoy','AA AAdvantage':'AAdvantage','Discover Cashback':'Discover','Cash Back':'cash back','Delta SkyMiles':'SkyMiles','Atmos Rewards':'Atmos','Capital One Miles':'Capital One'};
const FKEYS=[['act','Type','All types'],['cat','Category','All categories'],['acct','Account','All accounts'],['net','Network','All networks']];

// Preview state that survives re-renders. Edits live in S.ed and never leave the page.
const S={per:'m:2026-10',from:'',to:'',q:'',f:{act:null,cat:null,acct:null,net:null},min:'',max:'',rev:false,tab:'all',
  sel:new Set(),open:null,sort:null,dir:'asc',exp:new Set(),pop:null,draft:null,edit:null,ed:{},queue:null,fpanel:false,
  ropen:new Set(),batch:false,bd:{act:'',cat:''},cd:null,dd:null};
let L=null,PAR={},TODAY='2026-11-03';

/* ── Small helpers ────────────────────────────────────────── */
const pad=n=>String(n).padStart(2,'0');
const lastDay=(y,m)=>new Date(y,m,0).getDate();
const money=n=>'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const sgn=n=>(n<0?'-':'+')+money(n);
const dt=s=>new Date(s+'T12:00:00');
const shortD=s=>{const x=dt(s);return `${MON[x.getMonth()]} ${x.getDate()}`};
const fullD=s=>{const x=dt(s);return `${MON[x.getMonth()]} ${x.getDate()}, ${x.getFullYear()}`};
const dayH=s=>{const x=dt(s),diff=Math.round((dt(TODAY)-x)/864e5);return diff===0?'Today':diff===1?'Yesterday':`${DOW[x.getDay()]}, ${MONL[x.getMonth()]} ${x.getDate()}`};
const esc=s=>L.h.esc(s==null?'':String(s));
const topOf=c=>PAR[c]||c;
const hue=c=>HUE[topOf(c)]||'#94A3B8';
const isBudget=a=>a==='Expense'||a==='Income';
function tcase(s){
  if(!s||/[a-z]/.test(s))return s;
  return s.split(/(\s+|[\/\-*#&.,()])/).map(w=>{if(!/[A-Z]/.test(w))return w;
    if(/\d/.test(w)||(w.length<=3&&!/[AEIOUY]/.test(w)))return w;
    const lw=w.toLowerCase();return lw.charAt(0).toUpperCase()+lw.slice(1)}).join('');
}
const T=t=>S.ed[t.id]?Object.assign({},t,S.ed[t.id]):t;
const byId=id=>{const t=L.d.txns.find(x=>x.id===id);return t?T(t):null};
const PAYW=['PAYMENT','AUTOPAY','PMT','PYMT','TRANSFER'];
function isDup(t){
  if(t.amt<=0||(t.at!=='credit'&&t.at!=='credit card'))return false;
  if(t.act==='Transfer')return true;
  return t.act==='Income'&&PAYW.some(w=>(t.raw||'').toUpperCase().includes(w));
}

/* ── Period ───────────────────────────────────────────────── */
function rangeOf(p){
  if(p.startsWith('m:')){const[y,m]=p.slice(2).split('-').map(Number),b=`${y}-${pad(m)}-${pad(lastDay(y,m))}`;return[`${y}-${pad(m)}-01`,b<TODAY?b:TODAY]}
  if(p.startsWith('y:')){const y=p.slice(2);return[`${y}-01-01`,`${y}-12-31`<TODAY?`${y}-12-31`:TODAY]}
  if(p==='last')return rangeOf('m:2026-10');
  if(p==='q3')return['2026-08-04',TODAY];
  if(p==='custom')return[S.from||'0000-00-00',S.to||'9999-12-31'];
  return['0000-00-00','9999-12-31'];
}
const perRange=()=>rangeOf(S.per);
function perLabel(){
  const p=S.per;
  if(p.startsWith('m:')){const[y,m]=p.slice(2).split('-').map(Number);return `${MONL[m-1]} ${y}`}
  if(p.startsWith('y:'))return p.slice(2);
  if(p==='last')return 'October 2026';
  if(p==='q3')return 'Last 3 months';
  if(p==='custom')return S.from||S.to?`${S.from?shortD(S.from):'Start'} – ${S.to?shortD(S.to):'today'}`:'All dates';
  return 'All dates';
}
const curYm=()=>S.per.startsWith('m:')?S.per.slice(2):S.per==='last'?'2026-10':null;
function stepYm(ym,k){const[y,m]=ym.split('-').map(Number),d=new Date(y,m-1+k,1);return `${d.getFullYear()}-${pad(d.getMonth()+1)}`}
const ymOk=ym=>ym>=FIRST&&ym<=TODAY.slice(0,7);
function arrows(big){
  const ym=curYm(),cur=ym||TODAY.slice(0,7),prev=stepYm(cur,-1),next=stepYm(cur,1);
  const label=big?`<h1 class="mo">${perLabel()}</h1>`:`<b>${ym?perLabel():'All dates'}</b>`;
  return `<div class="step ${big?'big':''}" data-region="period"><button type="button" data-ym="${prev}" aria-label="Previous month" ${ymOk(prev)?'':'disabled'}>‹</button>${label}<button type="button" data-ym="${next}" aria-label="Next month" ${ym&&ymOk(next)?'':'disabled'}>›</button></div>`;
}
function period(p){
  const st=p.period,ym=curYm();
  let body;
  if(st==='arrows')return arrows(false);
  if(st==='strip')body=`<div class="und strip" role="group" aria-label="Month">${MON.slice(0,11).map((m,i)=>{const k=`2026-${pad(i+1)}`;return `<button type="button" data-ym="${k}" class="${ym===k?'on':''}" ${ymOk(k)?'':'disabled title="Not in the preview data"'}>${m}</button>`}).join('')}<span class="yr-t">2026</span><button type="button" data-per="all" class="${S.per==='all'?'on':''}">All</button></div>`;
  else if(st==='presets'){const P=[['m:'+TODAY.slice(0,7),'This month'],['m:'+stepYm(TODAY.slice(0,7),-1),'Last month'],['q3','Last 3 months'],['y:2026','This year'],['all','All'],['custom','Custom']];
    body=`<div class="und" role="group" aria-label="Dates">${P.map(([k,l])=>`<button type="button" data-per="${k}" class="${S.per===k?'on':''}">${l}</button>`).join('')}</div>${S.per==='custom'?dateInputs():''}`}
  else{const yr=S.per.startsWith('m:')?S.per.slice(2,6):S.per.startsWith('y:')?S.per.slice(2):'';
    body=`<div class="dd"><select data-ysel aria-label="Year"><option value="">All years</option>${['2026','2025','2024'].map(y=>`<option ${yr===y?'selected':''} ${y!=='2026'?'disabled':''}>${y}</option>`).join('')}</select>
      ${yr?`<select data-msel aria-label="Month"><option value="">All months</option>${MON.map((m,i)=>`<option value="${i+1}" ${S.per===`m:${yr}-${pad(i+1)}`?'selected':''}>${m}</option>`).join('')}</select>`:''}${dateInputs()}</div>`}
  return `<div class="per" data-region="period">${body}</div>`;
}
function dateInputs(){const[a,b]=S.per==='all'?['','']:perRange();
  return `<span class="dr"><input type="date" data-date="from" value="${a.startsWith('0000')?'':a}" aria-label="From"><span class="mut">→</span><input type="date" data-date="to" value="${b.startsWith('9999')?'':b}" aria-label="To"></span>`}

/* ── Which rows show ──────────────────────────────────────── */
function inPeriod(){const[a,b]=perRange();return L.d.txns.map(T).filter(t=>t.d>=a&&t.d<=b)}
function scoped(p,rows){
  if(p.reviewStyle==='tabs'&&S.tab==='excluded')return rows.filter(t=>t.exc);
  let v=rows.filter(t=>!t.exc&&!isDup(t));
  if(p.reviewStyle==='tabs'){if(S.tab==='review')v=v.filter(t=>t.rev);else if(S.tab==='gcb')v=v.filter(t=>t.gcb);else if(S.tab==='split')v=v.filter(t=>t.spl)}
  else if(S.rev)v=v.filter(t=>t.rev);
  return v;
}
const keyOf=(t,k)=>k==='act'?t.act:k==='acct'?t.acct:k==='net'?(t.net||''):t.cat;
function facet(v,skip){
  for(const[k]of FKEYS){if(k===skip||!S.f[k])continue;const s=S.f[k];v=v.filter(t=>k==='cat'?(s.has(t.cat)||s.has(topOf(t.cat))):s.has(keyOf(t,k)))}
  const q=S.q.trim().toLowerCase();
  if(q)v=v.filter(t=>(t.n||'').toLowerCase().includes(q)||(t.raw||'').toLowerCase().includes(q));
  const mn=S.min!==''?Math.abs(parseFloat(S.min)):null,mx=S.max!==''?Math.abs(parseFloat(S.max)):null;
  if(mn!==null&&!isNaN(mn))v=v.filter(t=>Math.abs(t.amt)>=mn);
  if(mx!==null&&!isNaN(mx))v=v.filter(t=>Math.abs(t.amt)<=mx);
  return v;
}
function visible(p){
  let v=facet(scoped(p,inPeriod()));
  if(S.sort){const k=S.sort,key=t=>k==='date'?t.d:k==='amount'?t.amt:k==='name'?(t.n||'').toLowerCase():k==='type'?t.act:k==='account'?t.acct:t.cat.toLowerCase();
    v=[...v].sort((a,b)=>{const x=key(a),y=key(b),c=typeof x==='number'?x-y:x<y?-1:x>y?1:0;return S.dir==='asc'?c:-c})}
  return v;
}
function options(p,k){
  const rows=facet(scoped(p,inPeriod()),k),cnt={};
  rows.forEach(t=>{const v=keyOf(t,k);if(!v)return;cnt[v]=(cnt[v]||0)+1;if(k==='cat'&&PAR[v])cnt[PAR[v]]=(cnt[PAR[v]]||0)+1});
  if(k==='act')return TYPES.map(v=>({v,l:v,n:cnt[v]||0}));
  if(k==='cat'){const out=[];Object.entries(L.d.tree).forEach(([top,kids])=>{out.push({v:top,l:top,n:cnt[top]||0,top:1});kids.forEach(c=>out.push({v:c,l:c,n:cnt[c]||0,kid:1,par:top}))});return out}
  return [...new Set(L.d.txns.map(t=>keyOf(t,k)).filter(Boolean))].sort().map(v=>({v,l:v,n:cnt[v]||0}));
}
// Same rules as the page: GCB and for-others rows stay out; income in a spending category offsets spending.
function totals(v){
  let exp=0,inc=0;
  v.forEach(t=>{if(t.gcb||t.fo||!isBudget(t.act))return;
    if(t.act==='Expense')exp-=t.amt;else if(t.cat==='Work'||!(t.cat in PAR||t.cat in L.d.tree))inc+=t.amt;else exp-=t.amt});
  return{exp,inc,net:inc-exp,n:v.length};
}

/* ── Header and actions ───────────────────────────────────── */
const moreBtn=()=>`<button type="button" class="btn ico" data-pop="more" aria-label="More actions">${ic('dots',16)}</button>`;
function actionBtns(p){
  const more=p.actionsPlace==='toolbar'?'':moreBtn();
  if(p.actionsPlace==='menu')return `<button type="button" class="btn pri" data-pop="add">${ic('plus',14)}Add${ic('down',12)}</button>${more}`;
  return `<button type="button" class="btn pri">+ Manual</button><button type="button" class="btn">↑ Import</button>${more}`;
}
const moreHere=p=>p.actionsPlace==='toolbar'?moreBtn():'';
const actsInHeader=p=>p.header!=='none'&&p.actionsPlace!=='toolbar';
function header(p,v){
  if(p.header==='none')return '';
  const tt=totals(v),acts=actsInHeader(p)?`<div class="acts">${actionBtns(p)}</div>`:'';
  const big=p.searchStyle==='header'?search(p,'hs'):'';
  if(p.header==='bar')return `<header class="hdr sf" data-region="header"><div class="ht"><h1>Transactions</h1><span class="mut">${tt.n} shown</span></div>${big}<div class="hdr-r">${period(p)}${acts}</div></header>`;
  const ar=p.period==='arrows';
  return `<header class="hdr open" data-region="header"><div><p class="eyebrow">Transactions</p>${ar?arrows(true):`<h1 class="mo">${perLabel()}</h1>`}<p class="sub">${tt.n} transactions · <b>${money(tt.exp)}</b> out · <b class="good">${money(tt.inc)}</b> in</p></div>${big}<div class="hdr-r">${ar?'':period(p)}${acts}</div></header>`;
}

/* ── Search and filters ───────────────────────────────────── */
function search(p,cls=''){
  return `<label class="srch s-${p.searchStyle} ${cls}">${ic('search',p.searchStyle==='header'||p.searchStyle==='large'?18:15)}<input id="pv_q" type="search" placeholder="Search transactions…" value="${esc(S.q)}" autocomplete="off"></label>`;
}
function fLabel(k,lab,all){
  const s=S.f[k];if(!s)return all;
  return s.size===1?`${lab}: ${[...s][0]}`:`${lab} (${s.size}/${options(L.picks,k).length})`;
}
function fBtn(p,k,lab,all){
  return `<button type="button" class="fb fb-${p.filterCtl} ${S.f[k]?'on':''}" data-pop="f:${k}">${esc(fLabel(k,lab,all))}${ic('down',12)}</button>`;
}
function fPop(k){
  const opts=options(L.picks,k),d=S.draft,chk=v=>!d||d.has(v);
  return `<div class="pop fl"><input class="psrch" data-psrch placeholder="Search…" aria-label="Search options"><div class="pl">${opts.map(o=>`<label class="po ${o.kid?'kid':''}" data-lab="${esc(o.l.toLowerCase())}"><input type="checkbox" data-dv="${esc(o.v)}" ${chk(o.v)?'checked':''}><span>${esc(o.l)}</span><em>${o.n||''}</em></label>`).join('')}</div>
    <div class="pf"><button type="button" class="lnk" data-dall>${d&&d.size===0?'Select all':'Clear all'}</button><button type="button" class="btn pri sm" data-apply="${k}">Apply</button></div></div>`;
}
const amtInputs=()=>`<span class="dr" title="Filters by dollar size, either direction"><input id="pv_min" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Min $" data-amt="min" value="${esc(S.min)}"><span class="mut">→</span><input id="pv_max" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Max $" data-amt="max" value="${esc(S.max)}"></span>`;
const revBox=p=>p.reviewStyle==='checkbox'?`<label class="cb"><input type="checkbox" data-rev ${S.rev?'checked':''}> Needs review</label>`:'';
const anyFilter=()=>S.q||S.min||S.max||S.rev||FKEYS.some(([k])=>S.f[k]);
const clearBtn=()=>anyFilter()?`<button type="button" class="lnk" data-clear>Clear filters</button>`:'';
function filters(p){
  const st=p.filterPlace,perHere=p.header==='none',acts=actsInHeader(p)?'':actionBtns(p);
  const srch=p.searchStyle==='large'||(p.searchStyle==='header'&&p.header!=='none')?'':search(p);
  if(S.sel.size&&p.batchBar==='toolbar')return `<div class="fz sel-tb" data-region="batch">${batchInner(p)}</div>`;
  if(st==='toolbar')return `<div class="fz tb" data-region="filters"><div class="tb1">${srch}<div class="fbs">${FKEYS.map(([k,l,a])=>fBtn(p,k,l,a)).join('')}${acts}</div></div>
    <div class="tb2"><div class="fbs">${perHere?period(p):''}${amtInputs()}${revBox(p)}</div><div class="fbs end">${clearBtn()}${moreHere(p)}</div></div></div>`;
  if(st==='panel'){const n=FKEYS.filter(([k])=>S.f[k]).length+(S.min||S.max?1:0)+(S.rev?1:0);
    return `<div class="fz row1" data-region="filters"><div class="fbs grow">${srch}<button type="button" class="fb fb-${p.filterCtl} ${S.fpanel||n?'on':''}" data-fpanel aria-expanded="${S.fpanel}">${ic('filter',14)}Filters${n?` · ${n}`:''}${ic(S.fpanel?'upc':'down',12)}</button>${perHere?period(p):''}</div><div class="fbs end">${clearBtn()}${acts}${moreHere(p)}</div></div>
      ${S.fpanel?`<div class="fpanel sf" data-region="filters">${FKEYS.map(([k,l])=>{const o=options(p,k).filter(x=>k!=='cat'||x.top||S.f.cat&&S.f.cat.has(x.v));
        return `<div class="fcol"><h3>${l}</h3><div class="fcl">${o.map(x=>`<label class="po"><input type="checkbox" data-live="${k}" value="${esc(x.v)}" ${S.f[k]&&S.f[k].has(x.v)?'checked':''}><span>${esc(x.l)}</span><em>${x.n||''}</em></label>`).join('')}</div></div>`}).join('')}
        <div class="fcol"><h3>Amount</h3>${amtInputs()}${p.reviewStyle==='checkbox'?`<h3 class="h3s">Status</h3>${revBox(p)}`:''}</div>
        <div class="pf wide"><button type="button" class="lnk" data-clear>Clear all</button><button type="button" class="btn sm" data-fpanel>Done</button></div></div>`:''}`}
  if(st==='chips'){
    const chips=FKEYS.filter(([k])=>S.f[k]).map(([k,l])=>`<span class="chip"><button type="button" data-pop="f:${k}">${esc(fLabel(k,l,''))}</button><button type="button" class="cx" data-unf="${k}" aria-label="Remove ${l} filter">${ic('x',12)}</button></span>`)
      .concat(S.min||S.max?[`<span class="chip"><button type="button" data-pop="addf">Amount ${S.min?'≥ $'+esc(S.min):''}${S.min&&S.max?' and ':''}${S.max?'≤ $'+esc(S.max):''}</button><button type="button" class="cx" data-unamt aria-label="Remove amount filter">${ic('x',12)}</button></span>`]:[])
      .concat(S.rev?[`<span class="chip"><button type="button" data-pop="addf">Needs review</button><button type="button" class="cx" data-unrev aria-label="Remove review filter">${ic('x',12)}</button></span>`]:[]).join('');
    return `<div class="fz row1" data-region="filters"><div class="fbs grow">${srch}<span class="chips">${chips}</span><button type="button" class="fb fb-${p.filterCtl}" data-pop="addf">${ic('plus',13)}Filter</button></div><div class="fbs end">${perHere?period(p):''}${clearBtn()}${acts}${moreHere(p)}</div></div>`}
  // rail: facets live in the left column; this row holds search, dates and actions
  return `<div class="fz row1" data-region="filters"><div class="fbs grow">${srch}${perHere?period(p):''}</div><div class="fbs end">${clearBtn()}${acts}${moreHere(p)}</div></div>`;
}
function rail(p){
  const sec=(k,l)=>{const o=options(p,k).filter(x=>x.n||S.f[k]&&S.f[k].has(x.v));
    const on=v=>S.f[k]&&S.f[k].has(v);
    const items=k==='cat'?o.filter(x=>x.top).map(x=>{const kids=o.filter(c=>c.par===x.v),op=S.ropen.has(x.v);
        return `<div class="rf ${on(x.v)?'on':''}">${kids.length?`<button type="button" class="tw" data-ropen="${esc(x.v)}" aria-expanded="${op}" aria-label="Sub-categories of ${esc(x.v)}">${ic(op?'down':'right',12)}</button>`:'<i class="tw"></i>'}<button type="button" class="rfb" data-rf="cat" data-v="${esc(x.v)}" aria-pressed="${!!on(x.v)}"><i class="cd" style="background:${hue(x.v)}"></i><span class="rl">${esc(x.l)}</span><em>${x.n}</em></button></div>`
          +(op?kids.map(c=>`<div class="rf kid ${on(c.v)?'on':''}"><i class="tw"></i><button type="button" class="rfb" data-rf="cat" data-v="${esc(c.v)}" aria-pressed="${!!on(c.v)}"><span class="rl">${esc(c.l)}</span><em>${c.n}</em></button></div>`).join(''):'')}).join('')
      :o.map(x=>`<div class="rf ${on(x.v)?'on':''}"><button type="button" class="rfb" data-rf="${k}" data-v="${esc(x.v)}" aria-pressed="${!!on(x.v)}"><span class="rl">${esc(x.l)}</span><em>${x.n}</em></button></div>`).join('');
    return `<div class="rs"><h3>${l}${S.f[k]?`<button type="button" class="lnk" data-unf="${k}">Clear</button>`:''}</h3>${items||'<p class="mut pad6">None in this period</p>'}</div>`};
  return `<aside class="rail sf" data-region="filters">${p.reviewStyle==='checkbox'?`<div class="rs">${revBox(p)}</div>`:''}${sec('act','Type')}${sec('cat','Category')}${sec('acct','Account')}${sec('net','Network')}<div class="rs"><h3>Amount</h3>${amtInputs()}</div></aside>`;
}

/* ── Popovers (one layer, placed under their button) ──────── */
function popLayer(p){
  const P=S.pop;if(!P)return '';
  let html='',right=false;
  if(P.k==='f')html=fPop(P.key);
  else if(P.k==='addf')html=`<div class="pop menu">${FKEYS.map(([k,l])=>`<button type="button" class="mi" data-pop="f:${k}">${l}</button>`).join('')}<div class="mi-in"><span>Amount</span>${amtInputs()}</div>${p.reviewStyle==='checkbox'?`<div class="mi-in">${revBox(p)}</div>`:''}</div>`;
  else if(P.k==='add'){right=true;html=`<div class="pop menu"><button type="button" class="mi">${ic('edit',14)}Manual transaction</button><button type="button" class="mi">${ic('up',14)}Import a file (CSV, OFX)</button></div>`}
  else if(P.k==='more'){right=true;html=`<div class="pop menu"><button type="button" class="mi">↓ Export CSV</button><button type="button" class="mi">✨ AI Enrich</button></div>`}
  else if(P.k==='rm'){right=true;const t=byId(P.id),ce=p.editMode==='row';if(!t)return '';
    html=`<div class="pop menu">${t.rev?`<button type="button" class="mi" data-reviewed="${t.id}">${ic('check',14)}Mark reviewed</button>`:''}<button type="button" class="mi" data-open="${t.id}">${ic('info',14)}Details</button><button type="button" class="mi" data-${ce?'edit':'open'}="${t.id}">${ic('edit',14)}Edit</button><button type="button" class="mi" data-open="${t.id}">${ic('split',14)}${t.spl?'Edit splits':'Split'}</button><button type="button" class="mi" data-tag="gcb:${t.id}">${ic('star',14)}${t.gcb?'Remove GCB tag':'Tag as GCB'}</button><button type="button" class="mi" data-tag="fo:${t.id}">${ic('users',14)}${t.fo?'Not for others':'For others'}</button><button type="button" class="mi" data-tag="exc:${t.id}">${ic('ban',14)}${t.exc?'Include again':'Exclude'}</button></div>`}
  else if(P.k==='cc'){const t=byId(P.id);if(!t)return '';html=`<div class="pop cpop"><span class="lbl">Category for ${nm(t,p)}</span>${catCtl(p,t.cat,'cell')}</div>`}
  return `<div class="popl ${right?'r':''}">${html}</div>`;
}
function placePop(root){
  const lay=root.querySelector('.popl');if(!lay)return;
  const P=S.pop,sel=P.k==='f'?`[data-pop="f:${P.key}"]`:P.id!=null?`[data-pop="${P.k}:${P.id}"]`:`[data-pop="${P.k}"]`;
  let a=[...root.querySelectorAll(sel)].find(x=>!x.closest('.popl'));
  if(!a&&P.k==='f')a=root.querySelector('[data-pop="addf"]');
  if(!a){lay.remove();return}
  const pr=root.getBoundingClientRect(),r=a.getBoundingClientRect(),w=lay.offsetWidth;
  let left=lay.classList.contains('r')?r.right-pr.left-w:r.left-pr.left;
  left=Math.max(8,Math.min(left,pr.width-w-8));
  lay.style.left=left+'px';lay.style.top=(r.bottom-pr.top+6)+'px';
  const f=lay.querySelector('[data-csr],.psrch');if(f&&!lay.dataset.f){lay.dataset.f=1;f.focus({preventScroll:true})}
}

/* ── Totals ───────────────────────────────────────────────── */
function summary(p,v,where){
  const s=p.summary;if(s==='none')return '';
  if((s==='bar'||s==='sentence')!==(where==='card'))return '';
  const tt=totals(v);
  if(s==='bar')return `<div class="ib" data-region="summary"><span><b>${tt.n}</b> TRANSACTIONS</span>${tt.exp?`<span>EXPENSES: <b class="${tt.exp>0?'bad':'good'}">${money(tt.exp)}</b></span>`:''}${tt.inc>0?`<span>INCOME: <b class="good">${money(tt.inc)}</b></span>`:''}</div>`;
  if(s==='sentence')return `<p class="sent" data-region="summary"><b>${tt.n}</b> transactions · <b>${money(tt.exp)}</b> out · <b class="good">${money(tt.inc)}</b> in · net <b class="${tt.net<0?'bad':'good'}">${tt.net<0?'−':'+'}${money(tt.net)}</b></p>`;
  const fig=(l,val,cls='')=>`<div class="kv"><b class="kn val ${cls}">${val}</b><span class="kl">${l}</span></div>`;
  const figs=`<div class="kvs">${fig('Spent',money(tt.exp))}${fig('Came in',money(tt.inc),'good')}${fig('Net',(tt.net<0?'−':'+')+money(tt.net),tt.net<0?'bad':'good')}${fig('Transactions',tt.n.toLocaleString('en-US'))}</div>`;
  if(s==='figures')return `<section class="sum sf" data-region="summary">${figs}</section>`;
  const by={};v.forEach(t=>{if(t.act!=='Expense'||t.gcb||t.fo)return;const k=topOf(t.cat);by[k]=(by[k]||0)-t.amt});
  const E=Object.entries(by).filter(e=>e[1]>0).sort((a,b)=>b[1]-a[1]),tot=E.reduce((s,e)=>s+e[1],0)||1,top=E.slice(0,7),rest=E.slice(7).reduce((s,e)=>s+e[1],0);
  const segs=top.map(([k,x])=>({k,x,c:hue(k)})).concat(rest>0?[{k:'',x:rest,c:'#E2E8F0'}]:[]);
  return `<section class="sum sf" data-region="summary">${figs}<div class="brk">${segs.map(g=>`<button type="button" style="flex:${g.x};background:${g.c}" ${g.k?`data-seg="${esc(g.k)}"`:''} title="${esc(g.k||'Everything else')}: ${money(g.x)}" aria-label="${esc(g.k||'Everything else')}: ${money(g.x)}"></button>`).join('')}</div>
    <div class="brl">${segs.map(g=>`<span><i style="background:${g.c}"></i>${esc(g.k||'Everything else')} <b>${Math.round(g.x/tot*100)}%</b></span>`).join('')}</div></section>`;
}

/* ── Needs review ─────────────────────────────────────────── */
function reviewBar(p){
  const all=inPeriod(),base=facet(all.filter(t=>!t.exc&&!isDup(t)));
  if(p.reviewStyle==='tabs'){
    const tabs=[['all','All',base.length],['review','Needs review',base.filter(t=>t.rev).length],['excluded','Excluded',facet(all.filter(t=>t.exc)).length],['gcb','GCB',base.filter(t=>t.gcb).length],['split','Split',base.filter(t=>t.spl).length]];
    return `<div class="tabs und" data-region="filters" role="tablist">${tabs.map(([k,l,c])=>`<button type="button" role="tab" aria-selected="${S.tab===k}" data-tab="${k}" class="${S.tab===k?'on':''}">${l}<em>${c}</em></button>`).join('')}</div>`}
  if(p.reviewStyle==='queue'){const n=base.filter(t=>t.rev).length;
    if(!n)return `<div class="qb ok" data-region="filters">${ic('check',15)}Everything shown for ${perLabel()} is reviewed.</div>`;
    return `<div class="qb" data-region="filters">${ic('alert',15)}<span><b>${n}</b> ${n===1?'transaction needs':'transactions need'} review in ${perLabel()}</span><button type="button" class="btn pri sm" data-queue>Start review</button></div>`}
  return '';
}

/* ── Row cells ────────────────────────────────────────────── */
const nm=(t,p)=>esc(p.nameCase==='title'?tcase(t.n):t.n);
function catLabel(t,p){
  if(!isBudget(t.act))return p.catStyle==='pill'?'<span class="mut">—</span>':'<span class="mut">Transfer</span>';
  const c=t.cat,par=PAR[c],st=p.catStyle;
  if(st==='pill')return `<span class="pill">${par?`<span class="pp">${esc(par)} › </span>`:''}${esc(c)}${t.man?'<span class="pen">✎</span>':''}</span>`;
  if(st==='dot')return `<span class="cdot"><i style="background:${hue(c)}"></i>${esc(c)}</span>`;
  if(st==='stack')return `<span class="cst"><b>${esc(c)}</b>${par?`<small>${esc(par)}</small>`:''}</span>`;
  return `<span class="ctx">${par?`<span class="pp">${esc(par)} › </span>`:''}${esc(c)}</span>`;
}
const inPlace=(t,p)=>S.edit===t.id&&p.editMode==='row'&&(p.rowStyle==='current'||p.rowStyle==='ledger')&&p.typeCtl==='dropdown'&&p.catCtl==='dropdown';
function catCell(t,p){
  if(inPlace(t,p))return isBudget(S.cd.act)?`<select data-cs="cd" aria-label="Category">${catOptions(S.cd.cat)}</select>`:'<span class="mut">—</span>';
  if(p.editMode==='cell'&&isBudget(t.act))return `<button type="button" class="cbtn" data-pop="cc:${t.id}" title="Change category">${catLabel(t,p)}${ic('down',11)}</button>`;
  return catLabel(t,p);
}
const typeBadge=a=>{const l=(a||'').toLowerCase();return l==='income'?'income':l==='transfer'?'transfer':'expense'};
function typeCell(t,p){
  if(inPlace(t,p))return `<select data-ts="cd" aria-label="Type">${TYPES.map(a=>`<option ${S.cd.act===a?'selected':''}>${a}</option>`).join('')}</select>`;
  const lab=t.spl&&new Set(t.spl.map(s=>s.act)).size>1?'Multiple':t.act;
  return p.rowStyle==='ledger'?`<span class="tt">${esc(lab)}</span>`:`<span class="badge b-${typeBadge(t.act)}">${esc(lab)}</span>`;
}
function amtCell(t,p){
  const c=p.amtColor,cls=t.act==='Transfer'?'':t.amt<0?(c==='both'?'bad':''):(c==='none'?'':'good');
  const g=p.typeShow==='glyph'?`<span class="gl" title="${esc(t.act)}">${ic(t.act==='Transfer'?'swap':t.amt<0?'outA':'inA',13)}</span>`:'';
  const sub=p.rowStyle==='airy'&&p.grouping!=='day'?`<small>${shortD(t.d)}</small>`:'';
  return `<span class="amt ${cls} ${t.exc&&p.flags==='edge'?'strike':''}">${g}${sgn(t.amt)}</span>${sub}`;
}
const acctCell=t=>`<span class="acct" title="${esc(t.acct)}">${esc(t.acct)}</span>`;
const netCell=t=>t.net?`<span class="mut">${esc(t.net)}</span>`:'';
const spCell=t=>t.sp?`<span class="sp1">${esc(t.sp)}</span>`:'<span class="mut">You</span>';
function ptsCell(t){
  if(t.pts==null)return '';
  if(t.pcls==='excluded')return '<span class="mut">—</span>';
  return `<span class="pts ${t.pts<0?'bad':''}">${t.pts>0?'+':''}${t.pts.toLocaleString('en-US')} ${esc(ECO[t.eco]||t.eco||'pts')}</span><small>${t.rate!=null?t.rate+'x':''}</small>`;
}
const caret=(t,p)=>t.spl&&p.splitShow==='caret'?`<button type="button" class="car ${S.exp.has(t.id)?'on':''}" data-exp="${t.id}" aria-expanded="${S.exp.has(t.id)}" aria-label="Show the ${t.spl.length} parts">▸</button>`:'';
const dateCell=(t,p)=>`<span class="dte">${caret(t,p)}${p.rowStyle==='ledger'?shortD(t.d):fullD(t.d)}</span>`;
function tagList(t,p){
  const g=[];
  if(t.rev)g.push(['Review','warn']);if(t.gcb)g.push(['GCB','gold']);if(t.fo)g.push(['For others','']);
  if(t.exc)g.push(['Excluded','bad']);if(t.spl)g.push([`Split · ${t.spl.length}`,'']);if(t.lk&&p.flags==='tags')g.push(['Locked','']);
  return g;
}
function flagsUnder(t,p){
  if(p.flags==='chips'){const b=[];
    if(t.conf!=null&&!t.lk)b.push(`<span class="conf">${Math.round(t.conf*100)}% AI CONFIDENCE</span>`);
    if(t.src&&t.src!=='rule'){const lab={llm:'AI ENRICHED',override:'AUTO-OVERRIDE'}[t.src]||t.src.toUpperCase();b.push(`<span class="src s-${t.src}">${lab}</span>`)}
    return b.length?`<div class="fl-u">${b.join('')}</div>`:''}
  if(p.flags==='icons')return '';
  const g=tagList(t,p).filter(x=>p.flags==='tags'||(x[0]!=='Review'&&x[0]!=='Excluded'));
  return g.length?`<span class="tags">${g.map(([l,c])=>`<span class="tg ${c}">${l}</span>`).join('')}</span>`:'';
}
function iconFlags(t){
  const I=[];
  if(t.rev)I.push(['alert','Needs review','warn']);if(t.gcb)I.push(['star','GCB','gold']);if(t.fo)I.push(['users','For others','']);
  if(t.exc)I.push(['ban','Excluded','bad']);if(t.spl)I.push(['split',`Split into ${t.spl.length}`,'']);if(t.lk)I.push(['lock','Locked: sync and rules leave it alone','']);
  return `<span class="ifl">${I.map(([n,l,c])=>`<span class="${c}" title="${l}" role="img" aria-label="${l}">${ic(n,14)}</span>`).join('')}</span>`;
}
function nameCell(t,p){
  const pts=p.showPoints&&t.pts!=null&&t.pcls!=='excluded'?`<span class="${t.pts<0?'bad':'ptsub'}">${t.pts>0?'+':''}${t.pts.toLocaleString('en-US')} ${esc(ECO[t.eco]||t.eco||'pts')}</span>`:'';
  const subs=[p.showAccount?esc(t.acct):'',p.showSpender&&t.sp?esc(t.sp):'',pts].filter(Boolean);
  const sub=p.rowStyle==='airy'&&subs.length?`<small>${subs.join(' · ')}</small>`:'';
  const nmH=inPlace(t,p)?`<input data-nm="cd" value="${esc(S.cd.n)}" aria-label="Display name">`:`<b class="nm" title="${esc(t.raw)}">${nm(t,p)}</b>`;
  const car=p.grouping==='day'||p.rowStyle==='airy'?caret(t,p):'';
  const inline=p.flags==='tags'||p.flags==='edge';
  return `<div class="nc">${inline?`<div class="nl">${car}${nmH}${flagsUnder(t,p)}</div>`:`<div class="nl">${car}${nmH}</div>${flagsUnder(t,p)}`}${sub}</div>`;
}
function avatar(t){const c=isBudget(t.act)?hue(t.cat):'#94A3B8',ch=(t.n||'?').replace(/[^A-Za-z0-9]/g,'').charAt(0).toUpperCase()||'?';
  return `<span class="av" style="color:${c};background:color-mix(in srgb,${c} 14%,var(--surface))" aria-hidden="true">${ch}</span>`}
const chk=t=>`<input type="checkbox" class="rchk" data-sel="${t.id}" ${S.sel.has(t.id)?'checked':''} aria-label="Select ${esc(t.n)}">`;
function actionsCell(t,p){
  const ra=p.rowActions;
  if(inPlace(t,p))return `<div class="ra"><button type="button" class="btn pri sm" data-save="${t.id}" data-scope="cd">Save</button><button type="button" class="btn sm ghost" data-cancel aria-label="Cancel">✕</button></div>`;
  const chips=p.flags==='chips'?(t.gcb?'<span class="ch gold" title="GCB">⭐</span>':'')+(t.exc?'<span class="ch bad" title="Excluded">⊘</span>':'')+(t.lk?'<span class="ch" title="Locked">🔒</span>':''):'';
  const ce=p.editMode==='row'?'edit':'open';
  if(ra==='buttons')return `<div class="ra"><span class="rv">${t.rev?`<button type="button" class="btn pri sm" data-review="${t.id}">Review</button>`:''}</span>${chips}<button type="button" class="btn sm ghost ico" data-open="${t.id}" title="Details" aria-label="Details">${ic('info',14)}</button><button type="button" class="btn sm" data-${ce}="${t.id}">Edit</button><button type="button" class="btn sm" data-open="${t.id}">${t.spl?'Splits':'Split'}</button></div>`;
  if(ra==='hover')return `<div class="ra">${chips}<div class="hov">${t.rev?`<button type="button" class="ib2" data-reviewed="${t.id}" title="Mark reviewed" aria-label="Mark reviewed">${ic('check',15)}</button>`:''}<button type="button" class="ib2" data-${ce}="${t.id}" title="Edit" aria-label="Edit">${ic('edit',15)}</button><button type="button" class="ib2" data-open="${t.id}" title="Split" aria-label="Split">${ic('split',15)}</button></div></div>`;
  if(ra==='menu')return `<div class="ra">${chips}<button type="button" class="ib2" data-pop="rm:${t.id}" aria-label="Actions for ${esc(t.n)}">${ic('dots',16)}</button></div>`;
  return chips?`<div class="ra">${chips}</div>`:'';
}

/* ── The list ─────────────────────────────────────────────── */
function defs(p){
  const st=p.rowStyle,day=p.grouping==='day',D=[];
  D.push({k:'chk',w:'max-content',h:'chk',c:chk});
  if(st==='airy')D.push({k:'av',w:'34px',h:'',c:avatar});
  if(!day&&st!=='airy')D.push({k:'date',w:st==='ledger'?'58px':'max-content',h:'Date',s:'date',c:dateCell});
  D.push({k:'name',w:'minmax(120px,1fr)',h:'Description',s:'name',c:nameCell});
  if(st==='current')D.push({k:'amt',w:'max-content',h:'Amount',s:'amount',c:amtCell});
  if(p.typeShow==='badge')D.push({k:'type',w:'max-content',h:'Type',s:'type',c:typeCell});
  D.push({k:'cat',w:'minmax(56px,max-content)',h:'Category',s:'category',c:catCell});
  if(p.showAccount&&st!=='airy')D.push({k:'acct',w:'minmax(56px,170px)',h:'Account',s:'account',c:acctCell});
  if(p.showNetwork)D.push({k:'net',w:'max-content',h:'Network',c:netCell});
  if(p.showSpender&&st!=='airy')D.push({k:'sp',w:'max-content',h:'Spender',c:spCell});
  if(p.showPoints&&st!=='airy')D.push({k:'pts',w:'max-content',h:'Points',c:ptsCell,r:1});
  if(p.flags==='icons')D.push({k:'fl',w:'max-content',h:'',c:iconFlags});
  if(st!=='current')D.push({k:'amt',w:'max-content',h:'Amount',s:'amount',c:amtCell,r:1});
  if(p.rowActions!=='none'||p.flags==='chips')D.push({k:'act',w:'max-content',h:st==='current'?'Actions':'',c:actionsCell,r:1});
  return D;
}
function headRow(p,D,v){
  const all=v.length&&v.every(t=>S.sel.has(t.id));
  return `<div class="tr th" data-region="cells">${D.map(c=>c.h==='chk'?`<div class="td c-chk"><input type="checkbox" class="rchk" data-selall ${all?'checked':''} aria-label="Select all shown"></div>`
    :c.s?`<div class="td ${c.r?'r':''}"><button type="button" data-sort="${c.s}" class="${S.sort===c.s?'on':''}">${c.h}<i>${S.sort===c.s?(S.dir==='asc'?'▲':'▼'):'⇅'}</i></button></div>`:`<div class="td ${c.r?'r':''}">${c.h}</div>`).join('')}</div>`;
}
const rowCls=(t,p)=>['tr',S.sel.has(t.id)?'sel':'',S.open===t.id&&p.detailOpen!=='modal'?'opn':'',p.flags==='edge'&&t.rev?'e-rev':'',p.flags==='edge'&&t.exc?'e-exc':'',t.exc?'exc':''].join(' ');
const gridRow=(t,p,D)=>`<div class="${rowCls(t,p)}" data-row="${t.id}" tabindex="0">${D.map(c=>`<div class="td c-${c.k} ${c.r?'r':''}">${c.c(t,p)}</div>`).join('')}</div>`;
function twoRow(t,p){
  const bits=[p.grouping==='day'?'':shortD(t.d),catLabel(t,{...p,catStyle:p.catStyle==='pill'?'text':p.catStyle}),p.showAccount?esc(t.acct):'',p.showNetwork&&t.net?esc(t.net):'',p.showSpender&&t.sp?esc(t.sp):''].filter(Boolean);
  const g=p.typeShow==='badge'?`<span class="badge b-${typeBadge(t.act)}">${esc(t.act)}</span>`:'';
  const pts=p.showPoints&&t.pts!=null?`<i>·</i><span class="c-pts">${ptsCell(t)}</span>`:'';
  return `<div class="${rowCls(t,p)} two" data-row="${t.id}" tabindex="0"><div class="td c-chk">${chk(t)}</div><div class="td c-main"><div class="l1">${caret(t,p)}<b class="nm" title="${esc(t.raw)}">${nm(t,p)}</b>${p.flags!=='chips'?flagsUnder(t,p):''}${p.flags==='icons'?iconFlags(t):''}<span class="spc"></span>${amtCell(t,p)}</div>
    <div class="l2">${bits.join('<i>·</i>')}${g}${p.flags==='chips'?flagsUnder(t,p):''}${pts}</div></div><div class="td r c-act">${actionsCell(t,p)}</div></div>`;
}
function splitRows(t,p){
  if(!t.spl||p.splitShow==='detail'||(p.splitShow==='caret'&&!S.exp.has(t.id)))return '';
  return t.spl.map(s=>`<div class="spr"><span class="mut">↳</span><span>${esc(s.n)||'<i class="mut">No note</i>'}</span>${isBudget(s.act)?catLabel({act:s.act,cat:s.cat},p):''}<span class="amt">${sgn(s.amt)}</span></div>`).join('');
}
function editStrip(t,p){
  if(S.edit!==t.id||p.editMode!=='row'||inPlace(t,p))return '';
  return `<div class="estrip" data-region="editctl"><label class="fld"><span>Display name</span><input data-nm="cd" value="${esc(S.cd.n)}"></label><div class="fld"><span>Type</span>${typeCtl(p,S.cd.act,'cd')}</div>${isBudget(S.cd.act)?`<div class="fld"><span>Category</span>${catCtl(p,S.cd.cat,'cd')}</div>`:'<div></div>'}
    <div class="eacts"><button type="button" class="btn pri sm" data-save="${t.id}" data-scope="cd">Save</button><button type="button" class="btn sm ghost" data-cancel>Cancel</button></div></div>`;
}
function list(p,v){
  if(!v.length)return `<div class="empty"><div class="ei">◎</div><span>No transactions found</span>${anyFilter()?'<button type="button" class="lnk" data-clear>Clear filters</button>':''}</div>`;
  const D=p.rowStyle==='twoline'?null:defs(p),gt=D?D.map(c=>c.w).join(' '):'';
  const one=t=>(D?gridRow(t,p,D):twoRow(t,p))+splitRows(t,p)+editStrip(t,p)+(p.detailOpen==='expand'&&S.open===t.id?`<div class="dexp" data-region="detail">${detail(t,p)}</div>`:'');
  let body;
  if(p.grouping==='flat')body=v.map(one).join('');
  else{const key=t=>p.grouping==='day'?t.d:t.d.slice(0,7),G=new Map();
    [...v].sort((a,b)=>a.d<b.d?1:a.d>b.d?-1:0).forEach(t=>{const k=key(t);if(!G.has(k))G.set(k,[]);G.get(k).push(t)});
    if(S.sort)G.forEach((rows,k)=>G.set(k,v.filter(t=>key(t)===k)));
    body=[...G.entries()].map(([k,rows])=>{const tt=totals(rows),lab=p.grouping==='day'?dayH(k):`${MONL[Number(k.slice(5))-1]} ${k.slice(0,4)}`;
      return `<div class="gh"><b>${lab}</b><span class="mut">${rows.length} ${rows.length===1?'transaction':'transactions'}${tt.exp?` · ${money(tt.exp)} spent`:''}${tt.inc>0?` · ${money(tt.inc)} in`:''}</span></div>`+rows.map(one).join('')}).join('')}
  return `<div class="lsx"><div class="lst-in rs-${p.rowStyle}" style="--gt:${gt}">${D?headRow(p,D,v):''}${body}</div></div>`;
}

/* ── Selecting several ────────────────────────────────────── */
function batchInner(p){
  return `<span class="bn">${S.sel.size} selected</span><button type="button" class="btn pri sm" data-batch>✎ Edit selected</button>${p.batchBar!=='top'?`<button type="button" class="btn sm" data-btag="gcb">${ic('star',13)}Tag GCB</button><button type="button" class="btn sm" data-btag="exc">${ic('ban',13)}Exclude</button><button type="button" class="btn sm" data-breviewed>${ic('check',13)}Mark reviewed</button>`:''}<button type="button" class="btn sm ghost" data-desel>✕ Deselect all</button>`;
}
function batch(p,where){
  if(!S.sel.size||p.batchBar!==where)return '';
  return where==='top'?`<div class="bb" data-region="batch">${batchInner(p)}</div>`:`<div class="bfloat" data-region="batch"><div class="bfi">${batchInner(p)}</div></div>`;
}

/* ── Edit controls (sc: cd = row edit, dd = details, bd = several, cell = category cell) ── */
function typeCtl(p,val,sc){
  if(p.typeCtl==='segmented'){const main=TYPES.slice(0,3),other=val&&!main.includes(val);
    return `<div class="seg" role="group" aria-label="Type">${main.map(a=>`<button type="button" data-tv="${sc}" data-v="${a}" class="${val===a?'on':''}" aria-pressed="${val===a}">${a}</button>`).join('')}<select data-ts="${sc}" class="${other?'on':''}" aria-label="Other types"><option value="">More…</option>${TYPES.slice(3).map(a=>`<option ${val===a?'selected':''}>${a}</option>`).join('')}</select></div>`}
  if(p.typeCtl==='radio')return `<div class="rad" role="radiogroup" aria-label="Type">${TYPES.slice(0,3).map(a=>`<label><input type="radio" name="ty_${sc}" data-tv="${sc}" value="${a}" ${val===a?'checked':''}>${a}</label>`).join('')}<select data-ts="${sc}" aria-label="Other types"><option value="">Other…</option>${TYPES.slice(3).map(a=>`<option ${val===a?'selected':''}>${a}</option>`).join('')}</select></div>`;
  return `<select data-ts="${sc}" aria-label="Type">${sc==='bd'?'<option value="">Keep as is</option>':''}${TYPES.map(a=>`<option ${val===a?'selected':''}>${a}</option>`).join('')}</select>`;
}
function catOptions(val){
  return Object.entries(L.d.tree).map(([top,kids])=>kids.length?`<optgroup label="${esc(top)}"><option value="${esc(top)}" ${val===top?'selected':''}>${esc(top)}</option>${kids.map(c=>`<option value="${esc(c)}" ${val===c?'selected':''}>${esc(c)}</option>`).join('')}</optgroup>`:`<option value="${esc(top)}" ${val===top?'selected':''}>${esc(top)}</option>`).join('');
}
function catCtl(p,val,sc){
  if(p.catCtl==='search')return `<div class="csr"><input data-csr placeholder="Find a category…" aria-label="Find a category"><div class="csl">${Object.entries(L.d.tree).map(([top,kids])=>`<div class="csg" data-lab="${esc((top+' '+kids.join(' ')).toLowerCase())}"><button type="button" data-cv="${sc}" data-v="${esc(top)}" class="top ${val===top?'on':''}"><i style="background:${hue(top)}"></i>${esc(top)}</button>${kids.map(c=>`<button type="button" data-cv="${sc}" data-v="${esc(c)}" class="${val===c?'on':''}" data-lab="${esc(c.toLowerCase())}">${esc(c)}</button>`).join('')}</div>`).join('')}</div></div>`;
  if(p.catCtl==='steps'){const top=sc==='cell'&&S.pop&&S.pop.top?S.pop.top:val?topOf(val):null,kids=top?L.d.tree[top]||[]:[];
    return `<div class="cst2"><div class="chs">${Object.keys(L.d.tree).map(t=>`<button type="button" data-ctop="${sc}" data-v="${esc(t)}" class="${top===t?'on':''}"><i style="background:${hue(t)}"></i>${esc(t)}</button>`).join('')}</div>${kids.length?`<div class="chs sub"><span class="mut">${esc(top)} ›</span><button type="button" data-cv="${sc}" data-v="${esc(top)}" class="${val===top?'on':''}">All of ${esc(top)}</button>${kids.map(c=>`<button type="button" data-cv="${sc}" data-v="${esc(c)}" class="${val===c?'on':''}">${esc(c)}</button>`).join('')}</div>`:''}</div>`}
  return `<select data-cs="${sc}" aria-label="Category">${sc==='bd'?'<option value="">Keep as is</option>':''}${catOptions(val)}</select>`;
}
function tagCtl(p,t){
  const TG=[['gcb','GCB','⭐'],['fo','For others','👥'],['exc','Exclude from totals','⊘'],['lk','Locked','🔒']];
  if(p.tagCtl==='switch')return `<div class="tsw">${TG.map(([k,l])=>`<label class="swt"><span>${l}</span><input type="checkbox" role="switch" data-tag="${k}:${t.id}" ${t[k]?'checked':''}><i></i></label>`).join('')}</div>`;
  if(p.tagCtl==='check')return `<div class="tcb">${TG.map(([k,l])=>`<label class="cb"><input type="checkbox" data-tag="${k}:${t.id}" ${t[k]?'checked':''}> ${l}</label>`).join('')}</div>`;
  return `<div class="tpl">${TG.filter(([k])=>k!=='lk'||t.lk).map(([k,,e])=>`<button type="button" class="tp ${t[k]?'on '+k:''}" data-tag="${k}:${t.id}" aria-pressed="${!!t[k]}">${e} ${k==='gcb'?(t.gcb?'GCB tagged':'Tag as GCB'):k==='exc'?(t.exc?'Excluded':'Exclude'):k==='lk'?'Locked':(t.fo?'For others':'Mark for others')}</button>`).join('')}${t.rev?'<span class="tp warn">⚠ Needs review</span>':''}</div>`;
}

/* ── Transaction details ──────────────────────────────────── */
function earn(t){
  if(t.pts==null)return `<p class="mut">No card points on this account.</p>`;
  const lab={clawback:'Points clawback',excluded:'Not counted for points',manual_override:'Manual override'}[t.pcls]||'Points earned';
  return `<div class="earn ${t.pcls||'earn'}"><span class="lbl">${lab}</span><div class="er"><span>${t.pcat?esc(t.pcat):'<i>Base rate</i>'}${t.rate!=null?` · ${t.rate}x`:''}</span><b class="val">${t.pts>0?'+':''}${t.pts.toLocaleString('en-US')} <small>${esc(t.eco||'points')}</small></b></div></div>`;
}
const later='<p class="mut later">Brand, kind and foreign fill in on rows from January 1, 2027.</p>';
function editBlock(p){
  return `<div class="dedit" data-region="editctl"><label class="fld"><span>Display name</span><input data-nm="dd" value="${esc(S.dd.n)}"></label><div class="fld"><span>Type</span>${typeCtl(p,S.dd.act,'dd')}</div>${isBudget(S.dd.act)?`<div class="fld"><span>Category</span>${catCtl(p,S.dd.cat,'dd')}</div>`:''}</div>`;
}
function queueFoot(){
  if(!S.queue)return '';
  const n=S.queue.ids.length;
  return `<div class="qf"><span class="mut">${n} left to review</span><button type="button" class="btn sm ghost" data-qskip>Skip</button><button type="button" class="btn pri sm" data-qok>Looks right, next ›</button></div>`;
}
function detail(t,p){
  if(!S.dd||S.dd.id!==t.id)S.dd={id:t.id,n:t.n,act:t.act,cat:t.cat};
  const st=p.detailStyle,ed=p.editMode==='detail'||st==='form'||!!S.queue;
  const close=`<button type="button" class="x" data-close aria-label="Close details">${ic('x',16)}</button>`;
  const foot=`${queueFoot()}<div class="df"><div class="fbs">${ed&&!S.queue?`<button type="button" class="btn pri sm" data-save="${t.id}" data-scope="dd">Save</button>`:''}<button type="button" class="btn sm">${t.spl?'✎ Edit splits':'⊕ Split'}</button><button type="button" class="btn sm">Create rule</button><button type="button" class="btn sm danger">Delete</button></div><button type="button" class="btn sm ghost" data-close>Close</button></div>`;
  const splits=t.spl&&p.splitShow!=='never'?`<div class="dsp"><span class="lbl">Splits (${t.spl.length})</span>${t.spl.map(s=>`<div class="dspr"><span>${esc(s.n)||'<i class="mut">No note</i>'}<small>${esc(s.cat)}</small></span><span class="badge b-${typeBadge(s.act)}">${esc(s.act)}</span><b>${sgn(s.amt)}</b></div>`).join('')}</div>`:'';
  const amtC=t.act==='Transfer'||t.amt<0?'':'good';
  const imp={plaid:'Plaid',csv:'CSV',ofx:'OFX',manual:'Manual'}[t.imp||'plaid']||t.imp,enr={llm:'AI',rule:'Rule',override:'Manual override',fallback:'Fallback',plaid_pfc:'Plaid category'}[t.src]||'—';
  const facts=[['Date',fullD(t.d)],['Amount',sgn(t.amt)],['Account',t.acct],['Type',t.act],['Category',isBudget(t.act)?(PAR[t.cat]?PAR[t.cat]+' › ':'')+t.cat:'—'],...(t.net?[['Network',t.net]]:[]),...(t.sp?[['Spender',t.sp]]:[]),['Confidence',t.conf!=null?Math.round(t.conf*100)+'%':'—'],['Import source',imp],['Enrichment',enr]];
  if(st==='form')return `<div class="dt dt-form"><div class="dh"><div><h3>${nm(t,p)}</h3><span class="mut">${fullD(t.d)} · ${esc(t.acct)}</span></div><b class="val big ${amtC}">${sgn(t.amt)}</b>${close}</div>
    ${editBlock(p)}<div class="fld" data-region="editctl"><span>Tags</span>${tagCtl(p,t)}</div>
    <div class="eline"><span class="lbl">Card earning</span><span>${t.pcat?`Merchant category <b>${esc(t.pcat)}</b>`:'No merchant category'}</span>${t.pts!=null&&t.pcls!=='excluded'?`<span>${t.rate!=null?t.rate+'x · ':''}<b>${t.pts>0?'+':''}${t.pts.toLocaleString('en-US')}</b> ${esc(t.eco||'')}</span>`:''}</div>
    ${splits}<details class="more"><summary>More details</summary><dl class="dl">${facts.map(([k,x])=>`<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}<dt>Bank description</dt><dd><code>${esc(t.raw)}</code></dd></dl></details>${foot}</div>`;
  if(st==='sections'){const row=(k,x)=>`<dt>${k}</dt><dd>${x}</dd>`;
    return `<div class="dt dt-sec"><div class="dh"><div><h3>${nm(t,p)}</h3><span class="mut">${t.rev?'<span class="tg warn">Needs review</span> ':''}ID ${t.id}</span></div><b class="val big ${amtC}">${sgn(t.amt)}</b>${close}</div>
      <section><h4>Overview</h4>${ed?editBlock(p):''}<dl class="dl">${row('Date',fullD(t.d))}${row('Account',esc(t.acct))}${ed?'':row('Type',esc(t.act))+row('Category',isBudget(t.act)?catLabel(t,p):'—')}${t.sp?row('Spender',esc(t.sp)):''}</dl></section>
      <section><h4>Card earning</h4><dl class="dl">${row('Merchant category',t.pcat?esc(t.pcat)+' <button type="button" class="lnk">Change</button>':'<span class="mut">Not classified</span> <button type="button" class="lnk">Set</button>')}${t.net?row('Network',esc(t.net)):''}${t.pts!=null?row('Points',`${t.pcls==='excluded'?'—':`${t.pts>0?'+':''}${t.pts.toLocaleString('en-US')} ${esc(t.eco||'')}`}${t.rate!=null?` <span class="mut">at ${t.rate}x</span>`:''}`):''}</dl>${later}</section>
      <section data-region="editctl"><h4>Tags</h4>${tagCtl(p,t)}</section>${splits?`<section>${splits}</section>`:''}
      <section><h4>Source</h4><dl class="dl">${row('Bank description',`<code>${esc(t.raw)}</code>`)}${row('Import',esc(imp))}${row('Enrichment',esc(enr))}${t.conf!=null?row('Confidence',Math.round(t.conf*100)+'%'):''}</dl></section>${foot}</div>`}
  return `<div class="dt dt-tiles"><div class="dh"><div><h3>Transaction details</h3><span class="mut">ID #${t.id}</span></div>${close}</div>
    <div class="dbox"><span class="lbl">Description</span><b>${nm(t,p)}</b>${t.raw!==t.n?`<span class="mut">Raw: <code>${esc(t.raw)}</code></span>`:''}</div>${ed?editBlock(p):''}
    <div class="tiles">${facts.map(([k,x])=>`<div class="tile"><span class="lbl">${k}</span><b>${esc(x)}</b></div>`).join('')}</div>
    <div class="dbox"><div class="dbr"><span class="lbl">Merchant category</span><button type="button" class="lnk">${t.pcat?'Edit':'Set'}</button></div><b>${t.pcat?esc(t.pcat):'<i class="mut">Not classified</i>'}</b>${later}</div>
    ${earn(t)}<div data-region="editctl">${tagCtl(p,t)}</div>${splits}${foot}</div>`;
}
function detailWrap(p){
  const t=S.open!=null?byId(S.open):null,m=p.detailOpen;
  if(m==='pane')return `<aside class="pane sf" data-region="detail">${t?detail(t,p):`<div class="pe">${ic('info',22)}<p>Pick a transaction to see its details here.</p></div>`}</aside>`;
  if(!t||m==='expand')return '';
  if(m==='drawer')return `<div class="ovl drw" data-region="detail"><div class="drw-p" role="dialog" aria-label="Transaction details">${detail(t,p)}</div></div>`;
  return `<div class="ovl mdl" data-region="detail"><div class="mdl-p" role="dialog" aria-modal="true" aria-label="Transaction details">${detail(t,p)}</div></div>`;
}
function batchModal(p){
  if(!S.batch)return '';
  return `<div class="ovl mdl" data-region="editctl"><div class="mdl-p sm" role="dialog" aria-modal="true" aria-label="Edit selected"><div class="dt"><div class="dh"><div><h3>Edit ${S.sel.size} transactions</h3><span class="mut">Only the fields you set change.</span></div></div>
    <div class="fld"><span>Type</span>${typeCtl(p,S.bd.act,'bd')}</div><div class="fld"><span>Category</span>${catCtl(p,S.bd.cat,'bd')}</div>
    <div class="df"><span></span><div class="fbs"><button type="button" class="btn sm ghost" data-bclose>Cancel</button><button type="button" class="btn pri sm" data-bapply>Apply to ${S.sel.size}</button></div></div></div></div></div>`;
}

/* ── Page ─────────────────────────────────────────────────── */
function nav(){
  return `<nav class="appnav" data-region="decided"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(([l,i])=>`<button type="button" class="${l==='Transactions'?'on':''}" title="${l}">${ic(i,17)}<span>${l}</span></button>`).join('')}</div></nav>`;
}
function page(p){
  const v=visible(p),hasRail=p.filterPlace==='rail',pane=p.detailOpen==='pane',tbIn=p.filterPlace==='toolbar';
  const big=p.searchStyle==='large'?`<div class="bigs" data-region="filters">${search(p)}</div>`:'';
  const card=`<section class="lst sf" data-region="rows">${tbIn?filters(p):''}${summary(p,v,'card')}${reviewBar(p)}${batch(p,'top')}${list(p,v)}</section>`;
  const main=`<div class="colm">${tbIn?'':filters(p)}${summary(p,v,'above')}${card}${batch(p,'float')}</div>`;
  return `<div class="app">${nav()}<div class="main">${header(p,v)}${big}<div class="body ${hasRail?'w-rail':''} ${pane?'w-pane':''}">${hasRail?rail(p):''}${main}${pane?detailWrap(p):''}</div></div>${pane?'':detailWrap(p)}${batchModal(p)}${popLayer(p)}<div class="toast" role="status" aria-live="polite"></div></div>`;
}

/* ── Interactions ─────────────────────────────────────────── */
function view(){
  const stage=document.getElementById('stage'),root=L.root;if(!stage||!root)return null;
  const off=root.getBoundingClientRect().top-stage.getBoundingClientRect().top+stage.scrollTop;
  return{top:stage.scrollTop-off,h:stage.clientHeight};
}
function placeOverlays(){
  const w=view();if(!w)return;
  L.root.querySelectorAll('.ovl').forEach(o=>{o.style.top=w.top+'px';o.style.height=w.h+'px'});
}
function rr(){
  const root=L.root,stage=document.getElementById('stage'),top=stage?stage.scrollTop:0;
  const ae=document.activeElement,fid=ae&&ae.id&&root.contains(ae)?ae.id:null,pos=fid?ae.selectionStart:null;
  const sc=[...root.querySelectorAll('.drw-p,.mdl-p,.pane,.lsx,.csl')].map(x=>[x.className,x.scrollTop,x.scrollLeft]);
  root.innerHTML=page(L.picks);wire(root,L.picks);
  if(stage)stage.scrollTop=top;
  sc.forEach(([c,t,l])=>{const x=root.getElementsByClassName(c.split(' ')[0])[0];if(x){x.scrollTop=t;x.scrollLeft=l}});
  if(fid){const el=document.getElementById(fid);if(el){el.focus();try{if(pos!=null)el.setSelectionRange(pos,pos)}catch(e){}}}
}
function toast(msg){
  const el=L.root.querySelector('.toast'),w=view();if(!el)return;
  if(w)el.style.top=(w.top+w.h-(S.sel.size&&L.picks.batchBar==='float'?120:64))+'px';
  el.textContent=msg;el.classList.add('on');clearTimeout(window.__txT);window.__txT=setTimeout(()=>el.classList.remove('on'),1700);
}
function setEd(id,o){S.ed[id]=Object.assign({},S.ed[id]||{},o)}
function save(id,sc){
  const d=S[sc],t=byId(id),o={n:d.n,act:d.act,rev:0,lk:1};
  if(isBudget(d.act)){o.cat=d.cat||'Unclassified';if(o.cat!==t.cat)o.man=1}
  setEd(id,o);if(sc==='cd'){S.edit=null;S.cd=null}else S.dd=null;
}
function openRow(id,p){
  const toggle=p.detailOpen==='pane'||p.detailOpen==='expand';
  S.open=toggle&&S.open===id?null:id;S.dd=null;S.pop=null;S.queue=null;
}
function qNext(done){
  const q=S.queue,i=q.ids.indexOf(S.open);
  if(done)q.ids.splice(i,1);
  const nx=done?q.ids[i]:q.ids[i+1];
  S.dd=null;if(nx==null){S.queue=null;S.open=null;return 'Review finished'}S.open=nx;return '';
}
function wire(root,p){
  const app=root.querySelector('.app');if(!app)return;
  placeOverlays();placePop(root);
  const stage=document.getElementById('stage');
  if(stage&&!window.__txSc){window.__txSc=1;stage.addEventListener('scroll',()=>{if(L&&L.root)placeOverlays()},{passive:true})}
  app.addEventListener('click',e=>{
    const el=e.target.closest('button,[data-row],input,label,select,summary');
    if(S.pop&&!e.target.closest('.popl')&&!(el&&'pop' in el.dataset)){S.pop=null;root.querySelectorAll('.popl').forEach(x=>x.remove())}
    if(!el)return;
    const D=el.dataset,stop=()=>e.stopPropagation(),has=k=>k in D;
    if(el.matches('input,select,label,summary')&&!['sel','selall','tag','tv','dv','live'].some(has))return;
    if(has('pop')){stop();const[k,id]=D.pop.split(':'),P=S.pop;
      const same=P&&P.k===k&&(k==='f'?P.key===id:id==null||P.id===Number(id));
      if(same)S.pop=null;else{S.pop=k==='f'?{k,key:id}:id!=null?{k,id:Number(id)}:{k};if(k==='f')S.draft=S.f[id]?new Set(S.f[id]):null}
      rr();return}
    if(has('dv')){stop();const v=D.dv,opts=options(p,S.pop.key).map(o=>o.v),d=S.draft?new Set(S.draft):new Set(opts);
      d.has(v)?d.delete(v):d.add(v);S.draft=d.size>=opts.length?null:d;return}
    if(has('dall')){stop();S.draft=S.draft&&S.draft.size===0?null:new Set();rr();return}
    if(has('apply')){stop();S.f[D.apply]=S.draft;S.pop=null;rr();return}
    const toggleIn=(k,v)=>{const s=S.f[k]?new Set(S.f[k]):new Set();s.has(v)?s.delete(v):s.add(v);S.f[k]=s.size?s:null};
    if(has('live')){stop();toggleIn(D.live,el.value);rr();return}
    if(has('rf')){stop();toggleIn(D.rf,D.v);rr();return}
    if(has('ropen')){stop();S.ropen.has(D.ropen)?S.ropen.delete(D.ropen):S.ropen.add(D.ropen);rr();return}
    if(has('unf')){stop();S.f[D.unf]=null;rr();return}
    if(has('unamt')){stop();S.min=S.max='';rr();return}
    if(has('unrev')){stop();S.rev=false;rr();return}
    if(has('clear')){stop();S.q='';S.min=S.max='';S.rev=false;FKEYS.forEach(([k])=>S.f[k]=null);rr();return}
    if(has('fpanel')){stop();S.fpanel=!S.fpanel;rr();return}
    if(has('seg')){stop();S.f.cat=S.f.cat&&S.f.cat.size===1&&S.f.cat.has(D.seg)?null:new Set([D.seg]);rr();return}
    if(has('ym')){stop();if(ymOk(D.ym)){S.per='m:'+D.ym;rr()}return}
    if(has('per')){stop();S.per=D.per;if(D.per==='custom'&&!S.from&&!S.to){S.from='2026-10-01';S.to='2026-10-31'}rr();return}
    if(has('tab')){stop();S.tab=D.tab;rr();return}
    if(has('sort')){stop();if(S.sort===D.sort)S.dir=S.dir==='asc'?'desc':'asc';else{S.sort=D.sort;S.dir=D.sort==='date'||D.sort==='amount'?'desc':'asc'}rr();return}
    if(has('selall')){stop();const v=visible(p);if(el.checked)v.forEach(t=>S.sel.add(t.id));else S.sel.clear();rr();return}
    if(has('sel')){stop();const id=Number(D.sel);S.sel.has(id)?S.sel.delete(id):S.sel.add(id);rr();return}
    if(has('desel')){stop();S.sel.clear();rr();return}
    if(has('batch')){stop();S.batch=true;S.bd={act:'',cat:''};rr();return}
    if(has('bclose')){stop();S.batch=false;rr();return}
    if(has('bapply')){stop();const o={rev:0};if(S.bd.act)o.act=S.bd.act;if(S.bd.cat){o.cat=S.bd.cat;o.man=1}const n=S.sel.size;S.sel.forEach(id=>setEd(id,o));S.sel.clear();S.batch=false;rr();toast(`Updated ${n} transactions`);return}
    if(has('btag')){stop();const n=S.sel.size;S.sel.forEach(id=>setEd(id,{[D.btag]:1}));S.sel.clear();rr();toast(`Updated ${n} transactions`);return}
    if(has('breviewed')){stop();const n=S.sel.size;S.sel.forEach(id=>setEd(id,{rev:0}));S.sel.clear();rr();toast(`Marked ${n} reviewed`);return}
    if(has('exp')){stop();const id=Number(D.exp);S.exp.has(id)?S.exp.delete(id):S.exp.add(id);rr();return}
    if(has('edit')){stop();const t=byId(Number(D.edit));S.edit=t.id;S.cd={id:t.id,n:t.n,act:t.act,cat:t.cat};S.pop=null;rr();return}
    if(has('cancel')){stop();S.edit=null;S.cd=null;rr();return}
    if(has('save')){stop();save(Number(D.save),D.scope);const m=S.queue&&D.scope==='dd'?qNext(true):'';rr();toast(m||'Saved');return}
    if(has('tv')){stop();S[D.tv].act=D.v||el.value;rr();return}
    if(has('ctop')){stop();const sc=D.ctop,kids=L.d.tree[D.v]||[];
      if(sc==='cell'){if(kids.length){S.pop.top=D.v;rr()}else{setEd(S.pop.id,{cat:D.v,man:1,rev:0});S.pop=null;rr();toast('Category saved')}return}
      S[sc].cat=D.v;rr();return}
    if(has('cv')){stop();if(D.cv==='cell'){setEd(S.pop.id,{cat:D.v,man:1,rev:0});S.pop=null;rr();toast('Category saved')}else{S[D.cv].cat=D.v;rr()}return}
    if(has('tag')){stop();const[k,id]=D.tag.split(':'),t=byId(Number(id));setEd(t.id,{[k]:t[k]?0:1});S.pop=null;rr();return}
    if(has('review')){stop();openRow(Number(D.review),p);rr();return}
    if(has('reviewed')){stop();setEd(Number(D.reviewed),{rev:0});S.pop=null;rr();toast('Marked reviewed');return}
    if(has('queue')){stop();const ids=visible({...p,reviewStyle:'checkbox'}).filter(t=>t.rev).map(t=>t.id);openRow(ids[0],p);S.queue={ids};rr();return}
    if(has('qok')){stop();save(S.open,'dd');const m=qNext(true);rr();toast(m||'Saved');return}
    if(has('qskip')){stop();const m=qNext(false);rr();if(m)toast(m);return}
    if(has('close')){stop();S.open=null;S.dd=null;S.queue=null;rr();return}
    if(has('open')){stop();openRow(Number(D.open),p);rr();return}
    if(has('row')){stop();if(e.target.closest('.c-chk'))return;openRow(Number(D.row),p);rr();return}
  });
  app.addEventListener('keydown',e=>{const r=e.target.closest('[data-row]');if(r&&e.target===r&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openRow(Number(r.dataset.row),p);rr()}});
  app.addEventListener('input',e=>{const el=e.target,D=el.dataset;
    if(el.id==='pv_q'){S.q=el.value;rr();return}
    if(D.amt){S[D.amt]=el.value;clearTimeout(window.__txA);window.__txA=setTimeout(rr,450);return}
    if(D.nm){S[D.nm].n=el.value;return}
    if('psrch' in D){const q=el.value.toLowerCase();el.closest('.pop').querySelectorAll('[data-lab]').forEach(o=>o.style.display=o.dataset.lab.includes(q)?'':'none');return}
    if('csr' in D){const q=el.value.toLowerCase();el.closest('.csr').querySelectorAll('.csg').forEach(g=>{const topHit=g.querySelector('.top').textContent.toLowerCase().includes(q);
      g.style.display=g.dataset.lab.includes(q)?'':'none';g.querySelectorAll('button[data-lab]').forEach(b=>b.style.display=!q||topHit||b.dataset.lab.includes(q)?'':'none')});return}
  });
  app.addEventListener('change',e=>{const el=e.target,D=el.dataset;
    if('ysel' in D){S.per=el.value?'y:'+el.value:'all';rr();return}
    if('msel' in D){const y=S.per.startsWith('m:')?S.per.slice(2,6):S.per.slice(2);S.per=el.value?`m:${y}-${pad(el.value)}`:'y:'+y;rr();return}
    if(D.date){if(S.per!=='custom'){const[a,b]=S.per==='all'?['','']:perRange();S.from=a.startsWith('0000')?'':a;S.to=b.startsWith('9999')?'':b}S[D.date]=el.value;S.per='custom';rr();return}
    if('rev' in D){S.rev=el.checked;rr();return}
    if(D.ts){if(el.value)S[D.ts].act=el.value;else if(D.ts==='bd')S.bd.act='';rr();return}
    if(D.cs){if(D.cs==='cell'){setEd(S.pop.id,{cat:el.value,man:1,rev:0});S.pop=null;rr();toast('Category saved')}else S[D.cs].cat=el.value;return}
  });
}

Gallery.define({
  id:'transactions-r1',
  name:'Transactions, round 1',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap'],
  groups:[
   {id:'header',label:'Page header and actions',open:true,controls:[
    {id:'header',label:'Header',type:'choice',options:[
      {id:'none',label:'No header',current:true,hint:'Today: the page opens straight into the search box.'},
      {id:'bar',label:'Slim bar, like Cards and the Dashboard',hint:'Title and count left; dates and buttons right.'},
      {id:'headline',label:'Big period headline',hint:'The period as the title, with a one-line total under it.'},
    ]},
    {id:'actionsPlace',label:'Manual, Import, Export, AI Enrich',type:'choice',options:[
      {id:'toolbar',label:'Buttons in the filter row',current:true,hint:'Today: + Manual and ↑ Import beside the filters; Export and AI Enrich under ⋯.'},
      {id:'header',label:'Buttons in the header',hint:'Needs a header; with "No header" they stay with the filters.'},
      {id:'menu',label:'One "Add" menu and ⋯',hint:'Manual and Import fold into one button.'},
    ]},
   ]},
   {id:'period',label:'Dates',open:true,controls:[
    {id:'period',label:'Picking the period',type:'choice',options:[
      {id:'dropdowns',label:'Year and month dropdowns, date fields',current:true,hint:'Today.'},
      {id:'arrows',label:'Arrows around the month',hint:'As picked for the Dashboard. With the big headline, the arrows wrap the title.'},
      {id:'strip',label:'Row of months',hint:'Underlined, like the Cards controls. Months before August aren\'t in the preview data.'},
      {id:'presets',label:'Ranges: this month, last month, 3 months, year, all, custom'},
    ]},
   ]},
   {id:'filters',label:'Search and filters',open:true,controls:[
    {id:'filterPlace',label:'Where the filters sit',type:'choice',options:[
      {id:'toolbar',label:'Two toolbar rows',current:true,hint:'Today: search and dropdowns, then dates, amounts and Needs review.'},
      {id:'panel',label:'One row and a Filters panel',hint:'All filters open together under one button.'},
      {id:'chips',label:'Chips you add one at a time',hint:'Only the filters in use take up space.'},
      {id:'rail',label:'Column on the left with counts',hint:'Click to filter at once; categories fold open to their sub-categories.'},
    ]},
    {id:'filterCtl',label:'Filter buttons',type:'choice',options:[
      {id:'outline',label:'Outlined, blue when in use',current:true},
      {id:'under',label:'Plain text, underlined when in use'},
      {id:'soft',label:'Soft grey chips'},
    ]},
    {id:'searchStyle',label:'Search box',type:'choice',options:[
      {id:'boxed',label:'Boxed',current:true},
      {id:'underline',label:'Underline only'},
      {id:'large',label:'Wide, on its own row'},
      {id:'header',label:'In the header',hint:'Needs a header; otherwise it stays with the filters.'},
    ]},
    {id:'reviewStyle',label:'Needs review',type:'choice',options:[
      {id:'checkbox',label:'Checkbox filter and a Review button per row',current:true,hint:'Today.'},
      {id:'tabs',label:'Tabs: All, Needs review, Excluded, GCB, Split',hint:'Also the only way to see excluded rows, which today are always hidden.'},
      {id:'queue',label:'Banner that walks you through them',hint:'Start review opens each in turn with "Looks right, next".'},
    ]},
   ]},
   {id:'summary',label:'Totals',controls:[
    {id:'summary',label:'Totals for what\'s shown',type:'choice',options:[
      {id:'bar',label:'Uppercase strip',current:true,hint:'Today: count, expenses, income.'},
      {id:'sentence',label:'One quiet sentence'},
      {id:'figures',label:'Four figures, value first'},
      {id:'breakdown',label:'Figures and a spending-by-category bar',hint:'Click a color to filter to that category.'},
      {id:'none',label:'None'},
    ]},
   ]},
   {id:'rows',label:'Rows',open:true,controls:[
    {id:'rowStyle',label:'Row layout',type:'choice',options:[
      {id:'current',label:'Table with badges and buttons',current:true,hint:'Today.'},
      {id:'airy',label:'Airy rows: initial, merchant, category, amount',hint:'Account under the name, date under the amount, no column headings.'},
      {id:'ledger',label:'Dense ledger',hint:'Short plain-text columns, amount last.'},
      {id:'twoline',label:'Two lines per transaction',hint:'Merchant and amount, then date, category and account.'},
    ]},
    {id:'grouping',label:'Grouping',type:'choice',options:[
      {id:'flat',label:'None, date column',current:true},
      {id:'day',label:'By day, with day totals'},
      {id:'month',label:'By month, with month totals',hint:'Most useful with a longer range picked.'},
    ]},
    {id:'rowH',label:'Row height',type:'slider',min:36,max:68,step:2,default:54,unit:'px'},
    {id:'splitShow',label:'Split transactions',type:'choice',options:[
      {id:'caret',label:'Arrow to show the parts',current:true},
      {id:'always',label:'Parts always shown under the row'},
      {id:'detail',label:'Only in the details'},
    ]},
    {id:'hoverChecks',label:'Checkboxes only on hover',type:'toggle',default:false},
   ]},
   {id:'cells',label:'What each row shows',open:true,controls:[
    {id:'nameCase',label:'Merchant names',type:'choice',options:[
      {id:'stored',label:'As the bank sends them',current:true,hint:'Mostly capitals.'},
      {id:'title',label:'Title case',hint:'Short letter-only codes like CVS and TD stay in capitals.'},
    ]},
    {id:'catStyle',label:'Category',type:'choice',options:[
      {id:'pill',label:'Blue pill with the full path',current:true},
      {id:'dot',label:'Colored dot and name'},
      {id:'text',label:'Plain text with the path'},
      {id:'stack',label:'Name, with Level 1 under it'},
    ]},
    {id:'typeShow',label:'Type',type:'choice',options:[
      {id:'badge',label:'Badge column',current:true},
      {id:'glyph',label:'Small arrow beside the amount'},
      {id:'none',label:'Not shown',hint:'The amount color and the category carry it.'},
    ]},
    {id:'amtColor',label:'Amount colors',type:'choice',options:[
      {id:'both',label:'Red out, green in',current:true},
      {id:'in',label:'Green in only'},
      {id:'none',label:'No color'},
    ]},
    {id:'flags',label:'Review, GCB, excluded, locked, split',type:'choice',options:[
      {id:'chips',label:'Emoji chips and AI labels',current:true,hint:'Today: ⭐ ⊘ 🔒 by the buttons; AI confidence and source under the name.'},
      {id:'tags',label:'Small word tags after the name'},
      {id:'icons',label:'Icon column with tooltips'},
      {id:'edge',label:'Amber edge for review, faded row when excluded'},
    ]},
    {id:'rowActions',label:'Row buttons',type:'choice',options:[
      {id:'buttons',label:'Review, ⓘ, Edit, Split always shown',current:true},
      {id:'hover',label:'Icons on hover'},
      {id:'menu',label:'One ⋯ menu per row'},
      {id:'none',label:'None: click the row'},
    ]},
    {id:'showAccount',label:'Account',type:'toggle',default:true},
    {id:'showPoints',label:'Points earned',type:'toggle',default:false},
    {id:'showNetwork',label:'Card network',type:'toggle',default:false},
    {id:'showSpender',label:'Spender',type:'toggle',default:false},
   ]},
   {id:'detail',label:'Transaction details',open:true,controls:[
    {id:'detailOpen',label:'Where details open',type:'choice',options:[
      {id:'modal',label:'Window in the middle',current:true,hint:'Closes only with its buttons.'},
      {id:'drawer',label:'Drawer from the right',hint:'The list stays usable beside it.'},
      {id:'pane',label:'Pane beside the list',hint:'Always there; click rows to switch. Today\'s wide table scrolls sideways beside it here, since this options panel takes part of the screen.'},
      {id:'expand',label:'Opens under the row'},
    ]},
    {id:'detailStyle',label:'Details layout',type:'choice',options:[
      {id:'tiles',label:'Grid of fact tiles',current:true,hint:'Today, minus the estimated dollar value of points.'},
      {id:'form',label:'Edit fields first, facts folded away'},
      {id:'sections',label:'Labeled sections: overview, card earning, tags, source'},
    ]},
    {id:'editMode',label:'Editing name, type and category',type:'choice',options:[
      {id:'row',label:'In the row',current:true,hint:'Today the cells turn into fields; with other row layouts or pickers, a strip opens under the row.'},
      {id:'detail',label:'In the details'},
      {id:'cell',label:'Click the category to change it',hint:'Saves at once. Quickest for the many Unclassified rows.'},
    ]},
   ]},
   {id:'editctl',label:'Edit controls',controls:[
    {id:'typeCtl',label:'Type picker',type:'choice',options:[
      {id:'dropdown',label:'Dropdown',current:true},
      {id:'segmented',label:'Segmented: Expense, Income, Transfer, More'},
      {id:'radio',label:'Radio buttons'},
    ]},
    {id:'catCtl',label:'Category picker',type:'choice',options:[
      {id:'dropdown',label:'Grouped dropdown',current:true},
      {id:'search',label:'Search box over a grouped list'},
      {id:'steps',label:'Level 1, then a sub-category',hint:'Two rows of chips.'},
    ]},
    {id:'tagCtl',label:'Tags: GCB, for others, exclude, locked',type:'choice',options:[
      {id:'pills',label:'Pill buttons',current:true},
      {id:'switch',label:'Switches'},
      {id:'check',label:'Checkboxes'},
    ]},
   ]},
   {id:'batch',label:'Selecting several',controls:[
    {id:'batchBar',label:'Selection bar',type:'choice',options:[
      {id:'top',label:'Bar above the list',current:true,hint:'Today: Edit selected and Deselect all.'},
      {id:'float',label:'Floating at the bottom',hint:'Adds Tag GCB, Exclude and Mark reviewed.'},
      {id:'toolbar',label:'Takes over the filter row',hint:'Same buttons as floating; the filters come back when nothing is selected.'},
    ]},
   ]},
   {id:'decided',label:'Decided on the Cards pages',open:false,controls:[
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',swatches:['#EEF2F7','#FFFFFF','#2563EB'],tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'accent',label:'Accent',type:'choice',locked:true,options:[{id:'blue',label:'Brand blue',tokens:{'--ac-l':'#2563EB','--ac-d':'#60A5FA'}}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'outfit',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'surface',label:'Panels',type:'choice',locked:true,options:[{id:'hairline',label:'Hairline'}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'controls',label:'Period and view controls',type:'choice',locked:true,options:[{id:'underline',label:'Underlined text'}]},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
   ]},
  ],
  render(picks,d,h){
    if(!L||L.d!==d){PAR={};Object.entries(d.tree).forEach(([top,kids])=>kids.forEach(c=>PAR[c]=top));TODAY=d.today||TODAY}
    if(L&&L.lastDO&&L.lastDO!==picks.detailOpen){S.open=null;S.queue=null}
    L=Object.assign(L||{},{d,h,picks,lastDO:picks.detailOpen});
    if(picks.editMode!=='row'){S.edit=null;S.cd=null}
    if(picks.reviewStyle!=='tabs')S.tab='all';
    if(picks.reviewStyle!=='checkbox')S.rev=false;
    if(picks.reviewStyle!=='queue')S.queue=null;
    S.pop=null;
    return page(picks);
  },
  after(root,picks){L.root=root;L.picks=picks;wire(root,picks)},
  css:`
#pv{position:relative;color-scheme:light;--c-radius:13px;--c-density:1.25;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density));--warnbg:color-mix(in srgb,#F59E0B 12%,transparent)}
#pv *{box-sizing:border-box}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
#pv button:disabled{opacity:.35;cursor:default}
#pv button:focus-visible,#pv select:focus-visible,#pv input:focus-visible,#pv [data-row]:focus-visible,#pv summary:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv input,#pv select{font:inherit;color:var(--tx)}
#pv h1,#pv h3,#pv .val{font-family:var(--f-h)}
#pv .val{font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#pv .good{color:var(--good)}#pv .bad{color:var(--bad)}#pv .warn{color:var(--warn)}#pv .mut{color:var(--tx3);font-size:12px}
#pv .lnk{color:var(--ac);font-size:12.5px;font-weight:500}
#pv .lnk:hover{text-decoration:underline}
#pv .pad6{padding:4px 6px;margin:0}
#pv .app{display:flex;flex-direction:column;min-height:100vh;min-width:0}
#pv .main{flex:1;min-width:0;width:100%;padding:calc(20px*var(--c-density)) calc(24px*var(--c-density)) 60px;display:grid;gap:calc(16px*var(--c-density));align-content:start}
/* Top bar (decided) */
#pv .appnav{display:flex;align-items:center;gap:14px;background:var(--surface);border-bottom:1px solid var(--line);padding:8px 16px;min-width:0}
#pv .brand{display:flex;align-items:center;gap:9px;font-family:var(--f-h);font-weight:600;padding:0 5px;flex:none}
#pv .brand i{font-style:normal;width:30px;height:30px;border-radius:8px;background:var(--ac);color:var(--ac-fg);display:grid;place-items:center}
#pv .nv{display:flex;gap:2px;overflow-x:auto;min-width:0;scrollbar-width:none}
#pv .nv svg{display:none}
#pv .nv button{padding:7px 10px;border-radius:8px;color:var(--tx2);font-size:13.5px;white-space:nowrap}
#pv .nv button.on{background:var(--ac-soft);color:var(--ac);font-weight:600}
/* Header */
#pv .hdr{display:flex;justify-content:space-between;align-items:center;gap:12px 20px;flex-wrap:wrap}
#pv .hdr.sf{padding:10px 18px}
#pv .ht{display:flex;align-items:baseline;gap:10px}
#pv .hdr h1{margin:0;font-size:16px;font-weight:600}
#pv .hdr h1.mo{font-size:30px;letter-spacing:-.4px;font-weight:600}
#pv .hdr .sub{margin:4px 0 0;font-size:13.5px;color:var(--tx2)}
#pv .hdr .sub b{font-weight:600}
#pv .eyebrow{margin:0 0 2px;font-size:12.5px;color:var(--tx3)}
#pv .hdr.open{padding:2px 2px 0}
#pv .hdr-r,#pv .acts,#pv .fbs{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap}
#pv .fbs.grow{flex:1;min-width:0}
#pv .fbs.end{margin-left:auto}
/* Period */
#pv .per{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
#pv .und{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
#pv .und button{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12.5px;white-space:nowrap}
#pv .und button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .strip{gap:12px}
#pv .yr-t{font-size:12px;color:var(--tx2);font-weight:600}
#pv .dd{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#pv select,#pv .dr input,#pv .fld input{font-size:12.5px;padding:6px 9px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--tx);min-width:0}
#pv .dr{display:inline-flex;align-items:center;gap:6px}
#pv .dr input[type=number]{width:84px}
#pv .step{display:flex;align-items:center;gap:4px}
#pv .step b{font-family:var(--f-h);font-weight:500;font-size:14px;min-width:120px;text-align:center}
#pv .step button{width:28px;height:28px;border-radius:7px;border:1px solid var(--line);font-size:16px;line-height:1;color:var(--tx2)}
#pv .step button:not(:disabled):hover{border-color:var(--ac);color:var(--ac)}
#pv .step.big{gap:10px}#pv .step.big button{width:32px;height:32px;font-size:18px}
#pv .step h1{margin:0}
/* Buttons */
#pv .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px;font-weight:500;color:var(--tx);white-space:nowrap}
#pv .btn:hover{border-color:color-mix(in srgb,var(--ac) 45%,var(--line))}
#pv .btn.pri{background:var(--ac);border-color:var(--ac);color:var(--ac-fg)}
#pv .btn.sm{padding:4px 9px;font-size:12px;border-radius:7px}
#pv .btn.ghost{border-color:transparent;background:none;color:var(--tx2)}
#pv .btn.ico{padding:6px 8px}
#pv .btn.ghost.ico{padding:5px}
#pv .btn.danger{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 35%,transparent)}
#pv .ib2{width:30px;height:30px;border-radius:7px;display:inline-grid;place-items:center;color:var(--tx2)}
#pv .ib2:hover{background:color-mix(in srgb,var(--ac) 8%,transparent);color:var(--ac)}
/* Popovers */
#pv .popl{position:absolute;z-index:70;left:0;top:0}
#pv .pop{background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.16);min-width:200px;text-align:left}
#pv .menu{padding:6px;display:grid}
#pv .mi{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:7px;font-size:13px;white-space:nowrap;color:var(--tx);text-align:left}
#pv .mi:hover{background:var(--raised)}
#pv .mi-in{display:grid;gap:6px;padding:8px 10px;border-top:1px solid var(--line);font-size:12px;color:var(--tx2)}
#pv .fl{width:280px;display:flex;flex-direction:column;max-height:400px}
#pv .psrch{margin:8px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--raised);font-size:12.5px}
#pv .pl{overflow-y:auto;padding:2px 0 6px;flex:1}
#pv .po{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 12px;font-size:13px;cursor:pointer}
#pv .po:hover{background:var(--raised)}
#pv .po.kid{padding-left:30px;color:var(--tx2)}
#pv .po em{font-style:normal;color:var(--tx3);font-size:11px;font-variant-numeric:tabular-nums}
#pv .po input{accent-color:var(--ac);margin:0}
#pv .pf{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-top:1px solid var(--line)}
#pv .cpop{width:320px;padding:12px;display:grid;gap:8px}
#pv .cpop select{width:100%}
/* Search */
#pv .srch{display:flex;align-items:center;gap:8px;color:var(--tx3);min-width:220px;flex:1;max-width:440px;cursor:text}
#pv .srch input{border:0;background:none;outline:none;flex:1;min-width:0;font-size:13.5px;color:var(--tx)}
#pv .srch.s-boxed,#pv .srch.s-header,#pv .srch.s-large{border:1px solid var(--line);border-radius:9px;padding:7px 11px;background:var(--surface)}
#pv .srch.s-underline{border-bottom:1.5px solid var(--line);padding:6px 2px}
#pv .srch:focus-within{border-color:var(--ac)}
#pv .bigs .srch{max-width:none;padding:11px 14px}#pv .bigs .srch input{font-size:15px}
#pv .srch.hs{max-width:420px;padding:9px 13px}
/* Filter buttons */
#pv .fb{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;white-space:nowrap;color:var(--tx)}
#pv .fb svg{opacity:.55}
#pv .fb-outline{padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
#pv .fb-outline.on{border-color:var(--ac);color:var(--ac);background:var(--ac-soft)}
#pv .fb-under{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx2)}
#pv .fb-under.on{border-color:var(--ac);color:var(--ac);font-weight:600}
#pv .fb-soft{padding:6px 11px;border-radius:99px;background:var(--raised);border:1px solid var(--line);color:var(--tx2)}
#pv .fb-soft.on{background:var(--ac-soft);border-color:transparent;color:var(--ac);font-weight:600}
#pv .cb{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--tx2);cursor:pointer;white-space:nowrap}
#pv .cb input{accent-color:var(--ac);margin:0}
/* Filter zones */
#pv .fz.tb{border-bottom:1px solid var(--line)}
#pv .tb1{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:calc(14px*var(--c-density)) calc(18px*var(--c-density))}
#pv .tb2{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px calc(18px*var(--c-density));background:color-mix(in srgb,var(--ac) 3%,transparent);border-top:1px solid var(--line)}
#pv .fz.row1{display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap}
#pv .fz.sel-tb{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:var(--ac-soft);border-radius:var(--c-radius);border:1px solid color-mix(in srgb,var(--ac) 30%,transparent)}
#pv .lst>.fz.sel-tb{border-radius:var(--c-radius) var(--c-radius) 0 0;border-width:0 0 1px}
#pv .chips{display:inline-flex;gap:6px;flex-wrap:wrap}
#pv .chip{display:inline-flex;align-items:center;border-radius:99px;background:var(--ac-soft);color:var(--ac);font-size:12.5px;font-weight:500}
#pv .chip button:first-child{padding:5px 4px 5px 11px}
#pv .chip .cx{padding:5px 8px 5px 4px;display:inline-grid;place-items:center}
#pv .fpanel{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;padding:16px}
#pv .fpanel h3,#pv .rs h3{font-family:var(--f-b);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);margin:0 0 6px;display:flex;justify-content:space-between;align-items:center}
#pv .fpanel .h3s{margin-top:14px}
#pv .fcl{max-height:270px;overflow-y:auto;margin:0 -12px;scrollbar-width:thin}
#pv .fpanel .dr{flex-wrap:wrap}
#pv .pf.wide{grid-column:1/-1;padding:10px 0 0}
/* Layout and rail */
#pv .body{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--gap);align-items:start}
#pv .body.w-rail{grid-template-columns:228px minmax(0,1fr)}
#pv .body.w-pane{grid-template-columns:minmax(0,1fr) minmax(320px,32%)}
#pv .body.w-rail.w-pane{grid-template-columns:200px minmax(0,1fr) 310px}
#pv .colm{display:grid;gap:var(--gap);min-width:0;align-content:start}
#pv .rail{padding:12px 8px;display:grid;gap:14px;min-width:0;overflow:hidden}
#pv .rs{display:grid;gap:1px}
#pv .rs h3{padding:0 6px}
#pv .rs .dr{padding:0 6px}#pv .rs .dr input{width:70px}
#pv .rs>.cb{padding:2px 6px}
#pv .rf{display:grid;grid-template-columns:16px minmax(0,1fr);align-items:center;border-radius:7px}
#pv .rf:not(:has(.tw)){grid-template-columns:minmax(0,1fr)}
#pv .rf.kid{padding-left:14px}
#pv .rf.on{background:var(--ac-soft)}
#pv .rf.on .rfb{color:var(--ac);font-weight:600}
#pv .rfb{display:flex;align-items:center;gap:7px;padding:6px;font-size:13px;text-align:left;color:var(--tx2);min-width:0;white-space:nowrap;overflow:hidden}
#pv .rfb:hover{color:var(--tx)}
#pv .rl{overflow:hidden;text-overflow:ellipsis;min-width:0}
#pv .rfb em{margin-left:auto;font-style:normal;font-size:11px;color:var(--tx3);font-variant-numeric:tabular-nums}
#pv .tw{display:grid;place-items:center;color:var(--tx3);width:16px;height:16px}
#pv .cd{width:8px;height:8px;border-radius:50%;flex:none}
/* Totals */
#pv .ib{display:flex;gap:24px;padding:10px calc(18px*var(--c-density));border-bottom:1px solid var(--line);font-size:12px;color:var(--tx3);font-weight:600;flex-wrap:wrap}
#pv .ib b{color:var(--tx)}#pv .ib b.bad{color:var(--bad)}#pv .ib b.good{color:var(--good)}
#pv .sent{margin:0;padding:10px calc(18px*var(--c-density));border-bottom:1px solid var(--line);font-size:13px;color:var(--tx2)}
#pv .sent b{font-weight:600;color:var(--tx)}#pv .sent b.good{color:var(--good)}#pv .sent b.bad{color:var(--bad)}
#pv .sum{padding:var(--p);container-type:inline-size}
#pv .kvs{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:14px 12px}
#pv .kv{display:flex;flex-direction:column;gap:4px;min-width:0}
#pv .kn{font-size:24px;font-weight:600;white-space:nowrap}
@container (max-width:560px){#pv .sum .kn{font-size:19px}}
#pv .kl{font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
#pv .brk{display:flex;gap:2px;height:14px;border-radius:7px;overflow:hidden;margin-top:16px}
#pv .brk button{height:100%;min-width:3px;opacity:.85}
#pv .brk button:hover{opacity:1}
#pv .brl{display:flex;gap:6px 16px;flex-wrap:wrap;margin-top:9px;font-size:11.5px;color:var(--tx2)}
#pv .brl span{display:inline-flex;align-items:center;gap:6px}
#pv .brl i{width:8px;height:8px;border-radius:2px}
#pv .brl b{font-weight:600;color:var(--tx)}
/* Needs review */
#pv .tabs{padding:0 calc(18px*var(--c-density));border-bottom:1px solid var(--line);gap:22px}
#pv .tabs button{padding:11px 0 9px;font-size:13px}
#pv .tabs em{font-style:normal;margin-left:6px;font-size:11px;color:var(--tx3);font-weight:500;font-variant-numeric:tabular-nums}
#pv .tabs button.on em{color:var(--ac)}
#pv .qb{display:flex;align-items:center;gap:10px;padding:10px calc(18px*var(--c-density));border-bottom:1px solid var(--line);background:var(--warnbg);font-size:13px;color:var(--tx)}
#pv .qb svg{color:var(--warn);flex:none}
#pv .qb .btn{margin-left:auto}
#pv .qb.ok{background:color-mix(in srgb,var(--good) 8%,transparent)}#pv .qb.ok svg{color:var(--good)}
/* Selecting several */
#pv .bb{display:flex;align-items:center;gap:10px;padding:8px 16px;background:var(--ac-soft);border-bottom:1px solid var(--line);font-size:13px;flex-wrap:wrap}
#pv .bn{font-weight:600;color:var(--ac);margin-right:4px;font-size:13px}
#pv .bfloat{position:sticky;bottom:18px;z-index:30;display:flex;justify-content:center;pointer-events:none}
#pv .bfi{pointer-events:auto;display:flex;align-items:center;gap:8px;padding:9px 12px 9px 18px;border-radius:14px;background:#0F172A;color:#fff;box-shadow:0 14px 40px rgba(15,23,42,.3);flex-wrap:wrap}
#pv .bfi .bn{color:#fff}
#pv .bfi .btn{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.18);color:#fff}
#pv .bfi .btn.pri{background:var(--ac);border-color:var(--ac)}
#pv .bfi .btn.ghost{background:none;border-color:transparent;color:rgba(255,255,255,.75)}
/* List: rows share one set of columns (subgrid) and scroll sideways when the page is narrow */
#pv .lst{min-width:0}
#pv .lsx{overflow-x:auto}
#pv .lst-in{display:grid;grid-template-columns:var(--gt);column-gap:12px;min-width:100%}
#pv .lst-in>*{grid-column:1/-1}
#pv .tr{display:grid;grid-template-columns:subgrid;align-items:center;padding:0;min-height:var(--c-rowH,54px);border-bottom:1px solid var(--line);cursor:pointer;position:relative}
#pv .tr:not(.th):hover{background:var(--raised)}
#pv .tr.sel{background:var(--ac-soft)}
#pv .tr.opn{background:var(--ac-soft);box-shadow:inset 3px 0 0 var(--ac)}
#pv .tr.th{min-height:38px;cursor:default;background:var(--raised)}
#pv .th .td,#pv .th button{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);display:inline-flex;gap:5px;align-items:center;white-space:nowrap}
#pv .th button.on{color:var(--tx)}
#pv .th i{font-style:normal;opacity:.45;font-size:9px}#pv .th button.on i{opacity:1}
#pv .td{min-width:0;padding:7px 0}
#pv .td.r{text-align:right;justify-self:end}
#pv .td.c-name,#pv .td.c-cat,#pv .td.c-acct{overflow:hidden}
#pv .td.c-cat .cbtn{margin:0;max-width:100%}
#pv .tr>.td:first-child{padding-left:calc(14px*var(--c-density))}
#pv .tr>.td:last-child{padding-right:calc(14px*var(--c-density))}
#pv .rs-current .tr>.c-chk{padding-right:8px}
#pv .c-chk{display:flex;align-items:center}
#pv .rchk{accent-color:var(--ac);margin:0;width:15px;height:15px;cursor:pointer}
#pv[data-hoverChecks=on] .tr:not(:hover):not(.sel) .rchk:not(:checked){opacity:0}
#pv[data-hoverChecks=on] .lst:has(.tr.sel) .rchk{opacity:1!important}
#pv .dte{display:inline-flex;align-items:center;gap:6px;color:var(--tx2);font-size:12px;white-space:nowrap}
#pv .nc{display:grid;gap:3px;min-width:0}
#pv .nl{display:flex;align-items:center;gap:8px;min-width:0}
#pv .nm{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
#pv .nc small{font-size:11.5px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .nc input{width:100%;padding:5px 9px;border:1px solid var(--ac);border-radius:7px;font-size:12.5px}
#pv .td select{width:100%;padding:4px 6px;max-width:220px}
#pv .amt{font-weight:600;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
#pv .amt.strike{text-decoration:line-through;color:var(--tx3)}
#pv .c-amt small{display:block;font-size:11px;color:var(--tx3);margin-top:2px}
#pv .gl{color:var(--tx3);display:inline-grid}
#pv .acct{display:block;font-size:12px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .sp1{font-size:12px;color:var(--tx2)}
#pv .pts{font-size:12px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
#pv .c-pts small{display:block;font-size:10.5px;color:var(--tx3)}
#pv .l2 .c-pts small{display:inline;margin-left:4px}
#pv .badge{display:inline-block;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap}
#pv .b-expense{background:color-mix(in srgb,var(--bad) 9%,transparent);color:var(--bad)}
#pv .b-income{background:color-mix(in srgb,var(--good) 11%,transparent);color:var(--good)}
#pv .b-transfer{background:var(--raised);color:var(--tx2);border:1px solid var(--line)}
#pv .tt{font-size:12px;color:var(--tx2)}
#pv .pill{display:inline-flex;align-items:center;max-width:100%;padding:3px 9px;border-radius:6px;background:var(--ac-soft);color:var(--ac);font-size:11.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .pp{opacity:.6;white-space:pre}
#pv .pen{margin-left:6px;opacity:.6}
#pv .cdot{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
#pv .cdot i{width:8px;height:8px;border-radius:50%;flex:none}
#pv .ctx{font-size:12.5px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
#pv .ctx .pp{color:var(--tx3);opacity:1}
#pv .cst{display:grid;line-height:1.25}#pv .cst b{font-weight:500;font-size:12.5px}#pv .cst small{font-size:10.5px;color:var(--tx3)}
#pv .cbtn{display:inline-flex;align-items:center;gap:4px;max-width:100%;border-radius:7px;padding:3px 5px;margin:-3px -5px;min-width:0;text-align:left}
#pv .cbtn:hover{background:color-mix(in srgb,var(--ac) 8%,transparent)}
#pv .cbtn>svg{opacity:.4;flex:none}
#pv .ra{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end}
#pv .rv{width:62px;display:inline-flex}
#pv .hov{position:absolute;right:calc(10px*var(--c-density));top:50%;transform:translateY(-50%);display:flex;gap:2px;padding:3px 3px 3px 28px;background:linear-gradient(to right,transparent,var(--raised) 26px);opacity:0;pointer-events:none;transition:opacity .12s;border-radius:0 8px 8px 0}
#pv .tr.sel .hov,#pv .tr.opn .hov{background:linear-gradient(to right,transparent,color-mix(in srgb,var(--ac) 10%,var(--surface)) 26px)}
#pv .tr:hover .hov,#pv .tr:focus-within .hov{opacity:1;pointer-events:auto}
#pv .ch{font-size:10px;padding:3px 7px;border-radius:20px;background:var(--raised);border:1px solid var(--line)}
#pv .ch.gold{background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.35)}
#pv .ch.bad{background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.3)}
#pv .fl-u{display:flex;gap:6px;flex-wrap:wrap}
#pv .l2 .fl-u{display:inline-flex}
#pv .conf{font-size:9.5px;color:#B45309;font-weight:700;letter-spacing:.02em}
#pv .src{font-size:9px;font-weight:700;padding:2px 6px;border-radius:5px;background:var(--line);color:var(--tx3)}
#pv .src.s-llm{background:color-mix(in srgb,var(--ac) 10%,transparent);color:var(--ac)}
#pv .tags{display:inline-flex;gap:4px;flex:none}
#pv .tg{font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:5px;border:1px solid var(--line);color:var(--tx2);white-space:nowrap}
#pv .tg.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 35%,transparent);background:var(--warnbg)}
#pv .tg.gold{color:#92400E;border-color:rgba(217,119,6,.35)}
#pv .tg.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 30%,transparent)}
#pv .ifl{display:inline-flex;gap:6px;color:var(--tx3)}
#pv .ifl .warn{color:var(--warn)}#pv .ifl .gold{color:#D97706}#pv .ifl .bad{color:var(--bad)}
#pv .tr.e-rev{box-shadow:inset 3px 0 0 #F59E0B}
#pv .tr.e-exc>.td:not(.c-chk):not(.c-act){opacity:.45}
#pv .tr.exc .nm{text-decoration:line-through}
#pv[data-flags=chips] .tr.exc .nm{text-decoration:none}
#pv .car{display:inline-grid;place-items:center;width:16px;color:var(--ac);transition:transform .15s;font-size:12px;flex:none}
#pv .car.on{transform:rotate(90deg)}
#pv .av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-family:var(--f-h);font-weight:600;font-size:13px}
#pv .gh{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:16px calc(14px*var(--c-density)) 7px;border-bottom:1px solid var(--line)}
#pv .gh b{font-family:var(--f-h);font-size:13px;font-weight:600}
#pv .spr{display:grid;grid-template-columns:24px minmax(0,1fr) minmax(120px,220px) 118px;gap:12px;align-items:center;padding:8px calc(14px*var(--c-density)) 8px 72px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--ac) 3%,transparent);font-size:12.5px;color:var(--tx2)}
#pv .spr .amt{justify-self:end;font-weight:500}
#pv .empty{display:grid;justify-items:center;gap:8px;padding:56px 20px;color:var(--tx2)}
#pv .ei{font-size:26px;color:var(--tx3)}
/* Row layouts */
#pv .rs-ledger .tr{min-height:calc(var(--c-rowH,54px)*.66)}
#pv .rs-ledger .tr:nth-child(even):not(.th){background:color-mix(in srgb,var(--raised) 70%,transparent)}
#pv .rs-ledger .tr:not(.th):hover{background:var(--raised)}
#pv .rs-ledger .tr.sel{background:var(--ac-soft)}
#pv .rs-ledger .td{padding:3px 0}
#pv .rs-ledger .nm{font-weight:500;font-size:12.5px}
#pv .rs-ledger .amt{font-weight:500;font-size:12.5px}
#pv .rs-airy{column-gap:13px}
#pv .ptsub{color:var(--good)}
#pv .rs-airy .nm{font-weight:500;font-size:13.5px}
#pv .rs-airy .amt{font-size:13.5px}
#pv .rs-airy .th{display:none}
#pv .lst-in.rs-twoline{display:block}
#pv .rs-twoline .tr{grid-template-columns:max-content minmax(0,1fr) auto;column-gap:12px;padding-top:8px;padding-bottom:8px}
#pv .two .c-main{display:grid;gap:4px;min-width:0}
#pv .l1{display:flex;align-items:center;gap:8px;min-width:0}
#pv .l1 .nm{font-size:13.5px;font-weight:500}
#pv .l1 .spc{flex:1}
#pv .l2{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--tx3);min-width:0;white-space:nowrap;overflow:hidden}
#pv .l2>i{font-style:normal;opacity:.6}
#pv .l2 .ctx,#pv .l2 .cdot{font-size:12px;color:var(--tx3)}
#pv .l2 .cst{display:inline-flex;gap:5px}#pv .l2 .cst b{font-size:12px;font-weight:400}
#pv .l2 .badge{padding:1px 6px;font-size:10px}
#pv .two .c-amt small{display:none}
/* Edit strip and fields */
#pv .estrip{display:grid;grid-template-columns:minmax(160px,1fr) auto minmax(220px,1.4fr);gap:12px 16px;align-items:start;padding:14px calc(16px*var(--c-density)) 14px 52px;background:var(--raised);border-bottom:1px solid var(--line);box-shadow:inset 3px 0 0 var(--ac)}
#pv .estrip .eacts{grid-column:1/-1;display:flex;gap:8px}
#pv .fld{display:grid;gap:5px;min-width:0}
#pv .fld>span{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
#pv .fld input{width:100%}
#pv .fld>select{width:100%}
#pv .seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface);width:max-content;max-width:100%}
#pv .seg button{padding:6px 11px;font-size:12.5px;color:var(--tx2);border-right:1px solid var(--line)}
#pv .seg button.on{background:var(--ac);color:var(--ac-fg)}
#pv .seg select{border:0;border-radius:0;padding:6px 8px;background:none}
#pv .seg select.on{background:var(--ac);color:var(--ac-fg)}
#pv .rad{display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;font-size:13px}
#pv .rad label{display:inline-flex;gap:6px;align-items:center;cursor:pointer}
#pv .rad input{accent-color:var(--ac);margin:0}
#pv .csr{display:grid;gap:6px;min-width:0}
#pv .csr input{padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;background:var(--surface)}
#pv .csl{max-height:210px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:4px}
#pv .csg{display:grid}
#pv .csl button{text-align:left;padding:5px 10px 5px 26px;font-size:12.5px;border-radius:6px;color:var(--tx2)}
#pv .csl button.top{padding-left:8px;font-weight:600;color:var(--tx);display:flex;gap:8px;align-items:center}
#pv .csl button.top i{width:8px;height:8px;border-radius:50%}
#pv .csl button:hover{background:var(--raised)}
#pv .csl button.on{background:var(--ac-soft);color:var(--ac)}
#pv .cst2{display:grid;gap:8px}
#pv .chs{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
#pv .chs button{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;border:1px solid var(--line);font-size:12px;background:var(--surface);color:var(--tx2)}
#pv .chs button i{width:7px;height:7px;border-radius:50%}
#pv .chs button.on{border-color:var(--ac);background:var(--ac-soft);color:var(--ac);font-weight:600}
#pv .chs.sub{padding-left:8px;border-left:2px solid var(--line)}
/* Tags */
#pv .tpl{display:flex;gap:8px;flex-wrap:wrap}
#pv .tp{font-size:11.5px;padding:4px 11px;border-radius:20px;background:var(--surface);border:1px solid var(--line);color:var(--tx3)}
#pv .tp.on{color:var(--tx);border-color:var(--tx3)}
#pv .tp.on.gcb{background:rgba(251,191,36,.12);color:#B45309;border-color:rgba(251,191,36,.35)}
#pv .tp.on.exc{background:rgba(248,113,113,.08);color:var(--bad);border-color:rgba(248,113,113,.3)}
#pv .tp.warn{background:var(--warnbg);color:var(--warn);border-color:rgba(245,158,11,.3)}
#pv .tsw{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px}
#pv .swt{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px;cursor:pointer;position:relative}
#pv .swt input{position:absolute;opacity:0;width:34px;height:20px;right:0;margin:0;cursor:pointer}
#pv .swt i{width:34px;height:20px;border-radius:10px;background:var(--line);position:relative;transition:background .15s;flex:none}
#pv .swt i:after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .15s}
#pv .swt input:checked+i{background:var(--ac)}
#pv .swt input:checked+i:after{left:16px}
#pv .swt input:focus-visible+i{outline:2px solid var(--ac);outline-offset:2px}
#pv .tcb{display:flex;gap:8px 18px;flex-wrap:wrap}
/* Details */
#pv .ovl{position:absolute;left:0;right:0;z-index:60}
#pv .mdl{background:rgba(15,23,42,.42);display:grid;place-items:center;padding:24px}
#pv .mdl-p{width:600px;max-width:100%;max-height:100%;overflow-y:auto;background:var(--surface);border-radius:14px;border:1px solid var(--line);box-shadow:0 24px 64px rgba(15,23,42,.3)}
#pv .mdl-p.sm{width:540px}
#pv .drw{pointer-events:none}
#pv .drw-p{pointer-events:auto;position:absolute;top:0;right:0;bottom:0;width:min(440px,92%);background:var(--surface);border-left:1px solid var(--line);box-shadow:-18px 0 48px rgba(15,23,42,.14);overflow-y:auto}
#pv .pane{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow-y:auto;min-width:0}
#pv .pe{display:grid;justify-items:center;gap:8px;padding:60px 24px;color:var(--tx3);text-align:center;font-size:13px}
#pv .dexp{border-bottom:1px solid var(--line);background:var(--raised);box-shadow:inset 3px 0 0 var(--ac)}
#pv .dexp .dt{max-width:900px}
#pv .dexp .tiles{grid-template-columns:repeat(4,minmax(0,1fr))}
#pv .dt{padding:22px;display:grid;gap:14px;min-width:0}
#pv .dh{display:flex;align-items:flex-start;gap:12px}
#pv .dh>div{flex:1;min-width:0;display:grid;gap:3px}
#pv .dh h3{margin:0;font-size:18px;font-weight:500;overflow-wrap:anywhere}
#pv .val.big{font-size:20px;white-space:nowrap}
#pv .x{width:30px;height:30px;border-radius:8px;color:var(--tx2);display:grid;place-items:center;flex:none}
#pv .x:hover{background:var(--raised)}
#pv .lbl{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
#pv .dbox{display:grid;gap:4px;padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:var(--bg)}
#pv .dbox b{font-weight:500;font-size:14.5px}
#pv .dbr{display:flex;justify-content:space-between}
#pv code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--tx);overflow-wrap:anywhere}
#pv .tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#pv .tile{display:grid;gap:3px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
#pv .tile b{font-weight:500;font-size:13px;overflow-wrap:anywhere}
#pv .earn{display:grid;gap:6px;padding:11px 13px;border-radius:9px;border:1px solid color-mix(in srgb,var(--good) 30%,transparent);background:color-mix(in srgb,var(--good) 7%,transparent)}
#pv .earn .lbl{color:var(--good)}
#pv .earn.clawback{border-color:color-mix(in srgb,var(--bad) 30%,transparent);background:color-mix(in srgb,var(--bad) 6%,transparent)}
#pv .earn.clawback .lbl,#pv .earn.clawback .val{color:var(--bad)}
#pv .earn.excluded{border-color:var(--line);background:var(--raised)}#pv .earn.excluded .lbl{color:var(--tx3)}
#pv .er{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13px;color:var(--tx2)}
#pv .er .val{font-size:18px;color:var(--good)}#pv .er small{font-size:11.5px;font-weight:400}
#pv .later{margin:2px 0 0;font-size:11.5px}
#pv .dedit{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:14px;border-radius:10px;border:1px solid var(--line);background:var(--raised)}
#pv .dt-form .dedit,#pv .dt-sec .dedit{background:none;border:0;padding:0}
#pv .eline{display:flex;gap:6px 16px;flex-wrap:wrap;align-items:baseline;font-size:13px;color:var(--tx2);padding:10px 12px;border-radius:9px;background:var(--raised)}
#pv .eline b{color:var(--tx);font-weight:600}
#pv details.more{border-top:1px solid var(--line);padding-top:10px}
#pv details.more summary{cursor:pointer;font-size:12.5px;color:var(--ac);font-weight:500}
#pv .dl{display:grid;grid-template-columns:130px minmax(0,1fr);gap:8px 14px;margin:10px 0 0;font-size:13px}
#pv .dl dt{color:var(--tx3);font-size:12px}#pv .dl dd{margin:0;min-width:0}
#pv .dt-sec section{display:grid;gap:4px;padding-top:12px;border-top:1px solid var(--line)}
#pv .dt-sec h4{margin:0;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3)}
#pv .dt-sec .dl{margin-top:4px}
#pv .dsp{display:grid;gap:6px}
#pv .dspr{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-size:13px}
#pv .dspr span:first-child{display:grid}#pv .dspr small{font-size:11px;color:var(--tx3)}
#pv .df{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--line)}
#pv .qf{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:9px;background:var(--warnbg)}
#pv .qf .mut{margin-right:auto}
#pv .pane .dt,#pv .drw-p .dt{padding:20px}
#pv .pane .dl,#pv .drw-p .dl{grid-template-columns:110px minmax(0,1fr)}
/* Toast */
#pv .toast{position:absolute;left:50%;top:0;transform:translate(-50%,12px);opacity:0;z-index:90;padding:9px 16px;border-radius:9px;background:#0F172A;color:#fff;font-size:13px;pointer-events:none;transition:opacity .2s,transform .2s}
#pv .toast.on{opacity:1;transform:translate(-50%,0)}
@container pv (max-width:1180px){
  #pv .body.w-rail.w-pane{grid-template-columns:184px minmax(0,1fr) 290px}
  #pv .fpanel{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@container pv (max-width:980px){
  #pv .body.w-pane{grid-template-columns:minmax(0,1fr)}
  #pv .body.w-rail.w-pane{grid-template-columns:196px minmax(0,1fr)}
  #pv .body.w-rail.w-pane .pane{grid-column:1/-1}
  #pv .pane{position:static;max-height:none}
  #pv .estrip{grid-template-columns:minmax(0,1fr);padding-left:20px}
  #pv .dexp .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`
});
})();
