// Design gallery spec for the main page (Dashboard), desktop.
// Content comes from the data file; this file holds no personal figures.
// The look (Cloud, brand blue, Outfit + Plus Jakarta, hairline panels, top bar,
// underlined controls) was decided on the Cards pages and is locked here.
(function(){
const ICONS={home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',tx:'<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/>',trend:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>',cal:'<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="3" x2="21" y1="10" y2="10"/>',cash:'<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/>',bank:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/>',star:'<polygon points="12 2 15 8 22 9 17 14 18 21 12 18 6 21 7 14 2 9 9 8"/>',card:'<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',wallet:'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'};
const NAV=[['Dashboard','home'],['Transactions','tx'],['Budgets','target'],['Net Worth','trend'],['Daily Balances','cal'],['Cash Flow','cash'],['Loans','bank'],['GCB','star'],['Cards','card'],['Accounts','wallet'],['Settings','gear']];
const icon=n=>`<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'var(--ac-l)','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,var(--ac-l) 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C','--plate':'#fff'});

const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const SKIP=new Set(['Transfer','Work']);
const TODAY={y:2026,m:11,d:4};
// Preview state that survives re-renders (period, open category, sort, expanded list).
const S={ym:'2026-10',view:'month',detail:null,sort:'pct',dir:'desc',showAll:false};
let LAST=null,AGG=null;

const pad=n=>String(n).padStart(2,'0');
const lastDay=(y,m)=>new Date(y,m,0).getDate();
const m2=n=>(n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const k1=n=>{const a=Math.abs(n),s=n<0?'-':'';return s+(a>=1e6?'$'+(a/1e6).toFixed(2)+'M':a>=1e4?'$'+Math.round(a/1e3)+'k':a>=1e3?'$'+(a/1e3).toFixed(1)+'k':'$'+Math.round(a))};
const ncat=c=>(!c||c==='Unclassified')?'Other':c;
const ymOf=(y,m)=>`${y}-${pad(m)}`;
const shiftYm=(y,m,k)=>{const d=new Date(y,m-1+k,1);return[d.getFullYear(),d.getMonth()+1]};

function agg(d){
  if(AGG)return AGG;
  const mon={},day={};
  d.lines.forEach(l=>{const ym=l.d.slice(0,7),o=mon[ym]=mon[ym]||{spend:0,inc:0,exp:0};
    if(l.k==='i')o.inc+=l.v;else o.exp+=l.v;
    if(!SKIP.has(l.c)){o.spend+=l.v;day[l.d]=(day[l.d]||0)+l.v}});
  const bud=(y,m)=>y!==2026?0:Object.entries(d.targets).reduce((s,[c,mm])=>SKIP.has(c)?s:s+(mm[m]||0),0);
  return AGG={mon,day,bud};
}

// Every figure for the selected period, computed the way the app computes it.
function ctx(d){
  const[Y,M]=S.ym.split('-').map(Number);
  const isCM=Y===TODAY.y&&M===TODAY.m,endDay=isCM?TODAY.d:lastDay(Y,M);
  let start,end,pStart,pEnd;
  if(S.view==='month'){const[pY,pM]=shiftYm(Y,M,-1);start=`${Y}-${pad(M)}-01`;end=`${Y}-${pad(M)}-${pad(endDay)}`;pStart=`${pY}-${pad(pM)}-01`;pEnd=`${pY}-${pad(pM)}-${pad(Math.min(endDay,lastDay(pY,pM)))}`}
  else{start=`${Y}-01-01`;end=`${Y}-${pad(M)}-${pad(endDay)}`;pStart=`${Y-1}-01-01`;pEnd=`${Y-1}-${pad(M)}-${pad(Math.min(endDay,lastDay(Y-1,M)))}`}
  const inR=(l,a,b)=>l.d>=a&&l.d<=b;
  let inc=0,exp=0,pInc=0,pExp=0;
  d.lines.forEach(l=>{if(inR(l,start,end)){if(l.k==='i')inc+=l.v;else exp+=l.v}
    if(inR(l,pStart,pEnd)){if(l.k==='i')pInc+=l.v;else pExp+=l.v}});
  const map=new Map(),add=(c,b,a)=>{const k=ncat(c),e=map.get(k)||{cat:k,budget:0,actual:0};e.budget+=b;e.actual+=a;map.set(k,e)};
  const months=S.view==='month'?[M]:Array.from({length:M},(_,i)=>i+1);
  Object.entries(d.targets).forEach(([c,mm])=>{if(!SKIP.has(c))add(c,months.reduce((s,m)=>s+(mm[m]||0),0),0)});
  d.lines.forEach(l=>{if(!SKIP.has(l.c)&&inR(l,start,end))add(l.c,0,l.v)});
  const rows=[...map.values()].map(r=>({...r,actual:Math.round(r.actual*100)/100})).filter(r=>Math.abs(r.budget)>.004||Math.abs(r.actual)>.004);
  rows.forEach(r=>{r.hasB=r.budget>0;r.credit=r.actual<0;r.pct=r.hasB?r.actual/r.budget:0;r.over=r.hasB&&!r.credit&&r.pct>=1;r.near=r.hasB&&!r.over&&!r.credit&&r.pct>=.8;r.noB=!r.hasB&&r.actual>0});
  const tot={cat:'Total',budget:rows.reduce((s,r)=>s+r.budget,0),actual:rows.reduce((s,r)=>s+r.actual,0)};
  const pc=(c,p)=>(p===null||Math.abs(p)<.01)?null:Math.round((c-p)/Math.abs(p)*100);
  const nw=d.nw[d.nw.length-1];
  const label=S.view==='month'?`${MONL[M-1]} ${Y}`:`Jan – ${MON[M-1]} ${Y}`;
  return{Y,M,isCM,endDay,start,end,inc,exp,net:inc-exp,pInc,pExp,rows,tot,nw,label,
    pct:{inc:pc(inc,pInc),exp:pc(exp,pExp),net:pc(inc-exp,pInc-pExp)},cmp:S.view==='month'?'vs. last month':'vs. last year'};
}
function sorted(rows,key=S.sort,dir=S.dir){
  return[...rows].sort((a,b)=>{const ao=a.cat==='Other',bo=b.cat==='Other';if(ao!==bo)return ao?1:-1;
    if(key==='pct'){if(a.hasB!==b.hasB)return a.hasB?-1:1;if(!a.hasB)return b.actual-a.actual}
    const v=r=>key==='pct'?r.actual/r.budget:key==='actual'?r.actual:r.budget;
    return dir==='desc'?v(b)-v(a):v(a)-v(b)});
}

/* ── Header and period controls ───────────────────────────── */
function viewToggle(){return `<div class="und" role="group" aria-label="View">${[['month','Monthly'],['annual','Year to date']].map(([v,l])=>`<button type="button" data-view="${v}" class="${S.view===v?'on':''}">${l}</button>`).join('')}</div>`}
function picker(picks,c){
  const{Y,M}=c,p=picks.picker;
  if(p==='stepper'){const first=M===1,lastM=Y===TODAY.y&&M===TODAY.m;
    return `<div class="step"><button type="button" data-step="-1" aria-label="Previous month" ${first?'disabled':''}>‹</button><b>${MONL[M-1]} ${Y}</b><button type="button" data-step="1" aria-label="Next month" ${lastM?'disabled':''}>›</button></div>`}
  if(p==='strip')return `<div class="strip" role="group" aria-label="Month">${MON.map((m,i)=>`<button type="button" data-month="${i+1}" class="${i+1===M?'on':''}" ${i+1>TODAY.m?'disabled':''}>${m}</button>`).join('')}<span class="yr-t">${Y}</span></div>`;
  return `<div class="dd"><select id="pv_year" aria-label="Year"><option>2026</option><option disabled>2025</option><option disabled>2024</option></select><select id="pv_month" aria-label="Month">${MON.map((m,i)=>`<option value="${i+1}" ${i+1===M?'selected':''} ${i+1>TODAY.m?'disabled':''}>${m}</option>`).join('')}</select></div>`;
}
function greeting(){const hr=new Date().getHours();return `Good ${hr<12?'morning':hr<17?'afternoon':'evening'}, Omer`}
function header(picks,c){
  const ctl=`<div class="hdr-r">${viewToggle()}${picks.header==='current'?'':picker(picks,c)}</div>`;
  if(picks.header==='current')return `<header class="hdr big sf" data-region="round1"><div><h1>${greeting()}</h1><p class="sub">Here's your financial overview today.</p></div>${ctl}</header>`;
  if(picks.header==='bar')return `<header class="hdr sf" data-region="round1"><h1 class="sm">${greeting()}</h1>${ctl}</header>`;
  if(picks.header==='month'){const as=c.isCM?`Month to date · through ${MON[TODAY.m-1]} ${TODAY.d}`:S.view==='month'?'Full month':'Year to date';
    const h1=`<h1 class="mo">${S.view==='month'?`${MONL[c.M-1]} ${c.Y}`:`${c.Y} through ${MON[c.M-1]}`}</h1>`,st=picks.picker==='stepper';
    // With the arrows picked, they wrap the headline instead of repeating the month beside it.
    const title=st?`<div class="step big"><button type="button" data-step="-1" aria-label="Previous month" ${c.M===1?'disabled':''}>‹</button>${h1}<button type="button" data-step="1" aria-label="Next month" ${c.isCM?'disabled':''}>›</button></div>`:h1;
    return `<header class="hdr open" data-region="round1"><div><p class="eyebrow">${greeting()}</p>${title}<p class="sub">${as}</p></div><div class="hdr-r">${viewToggle()}${st?'':picker(picks,c)}</div></header>`}
  const over=c.rows.filter(r=>r.over).length;
  return `<header class="hdr big sf" data-region="round1"><div><h1>${greeting()}</h1><p class="sub">${c.label}: <b class="good">${m2(c.inc)}</b> in, <b>${m2(c.exp)}</b> out. ${over?`<b class="bad">${over} ${over===1?'category':'categories'}</b> over budget.`:'Every category within budget.'}</p></div>${ctl}</header>`;
}

/* ── Summary figures ──────────────────────────────────────── */
function kpiList(c){
  return[{id:'cash',label:'Checking & Savings',v:m2(c.nw.cash),p:null},{id:'nw',label:'Net Worth',v:m2(c.nw.nw),p:null,hl:true},
    {id:'inc',label:'Income',v:m2(c.inc),p:c.pct.inc},{id:'exp',label:'Expenses',v:m2(c.exp),p:c.pct.exp,inv:true},
    {id:'net',label:'Net Cash Flow',v:c.net<0?`(${m2(-c.net)})`:m2(c.net),p:c.pct.net}];
}
function chg(k,picks,c){
  if(picks.change==='none')return '';
  if(k.p===null)return `<div class="ksub"><span class="mut">—</span></div>`;
  const good=k.inv?k.p<=0:k.p>=0,cls=good?'good':'bad';
  const v=picks.change==='pill'?`<span class="chg pill ${cls}">${k.p>0?'+':''}${k.p}%</span>`:`<span class="chg txt ${cls}">${k.p>0?'▲':k.p<0?'▼':''} ${Math.abs(k.p)}%</span>`;
  return `<div class="ksub">${v}<span class="mut">${c.cmp}</span></div>`;
}
const kv=(k,picks,c,extra='')=>`<div class="kv ${k.hl?'hl':''} ${extra}"><span class="kl">${k.label}</span><b class="kn val">${k.v}</b>${chg(k,picks,c)}</div>`;
function spark(d){
  const v=d.nw.map(p=>p.nw),mn=Math.min(...v),mx=Math.max(...v),W=200,H=44;
  const pts=v.map((y,i)=>[i/(v.length-1)*W,H-4-(y-mn)/((mx-mn)||1)*(H-8)]);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" vector-effect="non-scaling-stroke"/></svg>`;
}
function kpis(picks,c,d){
  const L=kpiList(c),s=picks.kpiStyle;
  if(s==='strip')return `<section class="kpis-strip sf" data-region="round1">${L.map(k=>kv(k,picks,c)).join('')}</section>`;
  if(s==='hero'){const n=L[1],first=d.nw[0],ch=c.nw.nw-first.nw,[fy,fm]=first.m.split('-').map(Number);
    return `<section class="kpis-hero" data-region="round1"><div class="hero sf">${kv(n,picks,c)}${spark(d)}<span class="mut">${ch<0?'−':'+'}${m2(Math.abs(ch))} since ${MON[fm-1]} ${fy}</span></div><div class="hero-g">${[L[0],L[2],L[3],L[4]].map(k=>`<div class="sf cell">${kv(k,picks,c)}</div>`).join('')}</div></section>`}
  if(s==='groups'){const share=c.inc>0?Math.min(c.exp/c.inc,1.5):1;
    return `<section class="kpis-groups" data-region="round1"><div class="sf grp-p"><h2>Balances today</h2><div class="grp-r">${kv(L[0],picks,c)}${kv(L[1],picks,c)}</div></div>
      <div class="sf grp-p"><h2>${c.label} cash flow</h2><div class="grp-r">${kv(L[2],picks,c)}${kv(L[3],picks,c)}${kv(L[4],picks,c)}</div>
      <div class="flowbar" title="Expenses as a share of income"><i class="in"></i><i class="out ${share>1?'bad':''}" style="width:${Math.min(share,1)*100}%"></i></div><div class="flow-l"><span>Spent ${c.inc>0?Math.round(c.exp/c.inc*100)+'%':'—'} of income</span></div></div></section>`}
  return `<section class="kpis-cards" data-region="round1">${L.map(k=>`<div class="sf cell">${kv(k,picks,c)}</div>`).join('')}</section>`;
}

/* ── Spending chart (drawn after layout, at the real width) ─ */
function trend(picks,c){
  const ch=picks.chart,leg=ch==='pace'?`<div class="leg"><span><i class="lg-cur"></i>${S.view==='month'?MON[c.M-1]:c.Y}</span><span><i class="lg-prev"></i>${S.view==='month'?MON[shiftYm(c.Y,c.M,-1)[1]-1]:'Budget'}</span>${S.view==='month'?'<span><i class="lg-bud"></i>Budget</span>':''}</div>`
    :ch==='inout'?`<div class="leg"><span><i class="lg-in"></i>Income</span><span><i class="lg-out"></i>Spending</span></div>`:ch==='bars'?`<div class="leg"><span><i class="lg-bud"></i>Budget</span></div>`:'';
  const title={line:'Spending trend',bars:'Spending vs budget',pace:S.view==='month'?'Spending pace':'Spending vs budget, cumulative',inout:'Income vs spending'}[ch];
  return `<section class="sf panel p-trend" data-region="round3"><div class="ph"><h2>${title}</h2><span class="mut">${chartRange(picks,c).label}</span></div>${leg}<div class="chart" data-chart="trend"></div>${ch!=='pace'?'<p class="hint">Click a month to open it.</p>':''}</section>`;
}
function chartRange(picks,c){
  const n=picks.range==='ytd'?c.M:6,ms=[];
  for(let i=n-1;i>=0;i--){const[y,m]=shiftYm(c.Y,c.M,-i);ms.push({y,m,ym:ymOf(y,m),lab:MON[m-1]})}
  const label=picks.chart==='pace'?(S.view==='month'?`${MON[c.M-1]} 1 – ${c.endDay}`:`Jan – ${MON[c.M-1]} ${c.Y}`):ms[0].y!==ms[ms.length-1].y?`${ms[0].lab} ${ms[0].y} – ${ms[ms.length-1].lab} ${ms[ms.length-1].y}`:`${ms[0].lab} – ${ms[ms.length-1].lab} ${c.Y}`;
  return{ms,label};
}
function smooth(p){
  const n=p.length;if(n<2)return'';if(n===2)return`M${p[0][0]},${p[0][1]} L${p[1][0]},${p[1][1]}`;
  const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]),d=[];for(let i=0;i<n-1;i++)d.push((ys[i+1]-ys[i])/(xs[i+1]-xs[i]));
  const m=new Array(n);m[0]=d[0];m[n-1]=d[n-2];for(let i=1;i<n-1;i++)m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
  for(let i=0;i<n-1;i++){if(d[i]===0){m[i]=0;m[i+1]=0}else{const a=m[i]/d[i],b=m[i+1]/d[i],h=Math.hypot(a,b);if(h>3){const t=3/h;m[i]=t*a*d[i];m[i+1]=t*b*d[i]}}}
  let s=`M${xs[0]},${ys[0]}`;for(let i=0;i<n-1;i++){const dx=(xs[i+1]-xs[i])/3;s+=` C${xs[i]+dx},${ys[i]+m[i]*dx} ${xs[i+1]-dx},${ys[i+1]-m[i+1]*dx} ${xs[i+1]},${ys[i+1]}`}
  return s;
}
function drawTrend(W,picks,c,d,HH){
  const A=agg(d),H=HH||200,P={t:22,r:16,b:26,l:16},cw=W-P.l-P.r,chh=H-P.t-P.b,ch=picks.chart,labels=picks.pointLabels;
  const y=(v,mx)=>P.t+chh-(Math.max(v,0)/mx)*chh,base=P.t+chh;
  let g=[0,.25,.5,.75,1].map(f=>`<line class="grid" x1="${P.l}" x2="${W-P.r}" y1="${P.t+(1-f)*chh}" y2="${P.t+(1-f)*chh}"/>`).join('');
  if(ch==='pace'){
    let cur=[],prev=[],bud=null,xl=[],n;
    if(S.view==='month'){const[pY,pM]=shiftYm(c.Y,c.M,-1);n=lastDay(c.Y,c.M);let s=0,ps=0;
      for(let i=1;i<=n;i++){if(i<=c.endDay){s+=A.day[`${c.Y}-${pad(c.M)}-${pad(i)}`]||0;cur.push([i,s])}if(i<=lastDay(pY,pM)){ps+=A.day[`${pY}-${pad(pM)}-${pad(i)}`]||0;prev.push([i,ps])}}
      bud=A.bud(c.Y,c.M);xl=[1,8,15,22,29].filter(i=>i<=n).map(i=>[i,`${MON[c.M-1]} ${i}`]);
    }else{n=c.M;let s=0,b=0;for(let m=1;m<=c.M;m++){s+=(A.mon[ymOf(c.Y,m)]||{}).spend||0;b+=A.bud(c.Y,m);cur.push([m,s]);prev.push([m,b])}xl=cur.map(p=>[p[0],MON[p[0]-1]])}
    const mx=Math.max(...cur.map(p=>p[1]),...prev.map(p=>p[1]),bud||0,100)*1.12,x=i=>P.l+(n===1?cw/2:(i-1)/(n-1)*cw);
    const path=a=>a.map((p,i)=>(i?'L':'M')+x(p[0]).toFixed(1)+','+y(p[1],mx).toFixed(1)).join(' ');
    const lc=cur[cur.length-1];
    g+=`<path class="ln-prev" d="${path(prev)}"/>`+(bud?`<line class="ln-bud" x1="${P.l}" x2="${W-P.r}" y1="${y(bud,mx)}" y2="${y(bud,mx)}"/><text class="tl bud" x="${P.l+2}" y="${y(bud,mx)-5}">Budget ${k1(bud)}</text>`:'')
      +`<path class="ln" d="${path(cur)}"/><circle class="dot" cx="${x(lc[0])}" cy="${y(lc[1],mx)}" r="4"/><text class="tl strong" x="${Math.min(x(lc[0]),W-P.r-30)}" y="${y(lc[1],mx)-9}" text-anchor="middle">${k1(lc[1])}</text>`
      +xl.map(([i,l])=>`<text class="tx" x="${x(i)}" y="${H-6}" text-anchor="middle">${l}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Cumulative spending">${g}</svg>`;
  }
  const{ms}=chartRange(picks,c),n=ms.length,slot=cw/n;
  const rows=ms.map(m=>{const o=A.mon[m.ym]||{spend:0,inc:0,exp:0};return{...m,spend:o.spend,inc:o.inc,exp:o.exp,bud:A.bud(m.y,m.m)}});
  // In narrow panels, label only the first, last and selected months so labels never collide.
  const dense=slot<46,show=(r,i)=>labels&&(!dense||i===0||i===n-1||r.ym===S.ym);
  const lab=(v,x0,y0,r,i)=>show(r,i)?`<text class="tl" x="${x0}" y="${y0}" text-anchor="middle">${k1(v)}</text>`:'';
  const hit=(r,i)=>`<rect class="hit" data-ym="${r.ym}" x="${P.l+i*slot}" y="${P.t}" width="${slot}" height="${chh+P.b}"><title>${MONL[r.m-1]} ${r.y}</title></rect>`;
  const xlab=(r,i)=>`<text class="tx ${r.ym===S.ym?'on':''}" x="${P.l+(i+.5)*slot}" y="${H-6}" text-anchor="middle">${r.lab}</text>`;
  if(ch==='line'){
    // Guide lines: the monthly budget, and the average of the complete months shown.
    const cm=rows.filter(r=>!(r.y===TODAY.y&&r.m===TODAY.m)),avg=cm.length?cm.reduce((s,r)=>s+r.spend,0)/cm.length:0,gb=picks.chartBud&&rows[0].bud>0,ga=picks.chartAvg&&avg>0;
    const mx=Math.max(...rows.map(r=>r.spend),gb?Math.max(...rows.map(r=>r.bud)):0,ga?avg:0,100)*1.1,pts=rows.map((r,i)=>[P.l+(i+.5)*slot,y(r.spend,mx)]),dd=smooth(pts);
    g+=`<defs><linearGradient id="pvArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="st0"/><stop offset="100%" class="st1"/></linearGradient></defs><path class="area" d="${dd} L${pts[n-1][0]},${base} L${pts[0][0]},${base} Z"/>`
      +(gb?`<path class="ln-bud" d="${rows.map((r,i)=>r.bud>0?`M${P.l+i*slot},${y(r.bud,mx)} L${P.l+(i+1)*slot},${y(r.bud,mx)}`:'').join(' ')}"/><text class="tl bud" x="${P.l+2}" y="${y(rows[0].bud,mx)-5}">Budget</text>`:'')
      +(ga?`<line class="ln-avg" x1="${P.l}" x2="${W-P.r}" y1="${y(avg,mx)}" y2="${y(avg,mx)}"/><text class="tl avg" x="${W-P.r-2}" y="${y(avg,mx)-5}" text-anchor="end">Average ${k1(avg)}</text>`:'')
      +`<path class="ln" d="${dd}"/>`
      +rows.map((r,i)=>`<circle class="dot ${r.ym===S.ym?'on':''}" cx="${pts[i][0]}" cy="${pts[i][1]}" r="${r.ym===S.ym?5.5:4}"/>${lab(r.spend,pts[i][0],pts[i][1]<P.t+18?pts[i][1]+16:pts[i][1]-9,r,i)}${xlab(r,i)}${hit(r,i)}`).join('');
  }else if(ch==='bars'){
    const mx=Math.max(...rows.map(r=>Math.max(r.spend,r.bud)),100)*1.12,bw=Math.min(slot*.56,46);
    g+=rows.map((r,i)=>{const cx=P.l+(i+.5)*slot,top=y(r.spend,mx),over=r.bud>0&&r.spend>r.bud;
      return `<rect class="bar ${over?'over':''} ${r.ym===S.ym?'on':''}" x="${cx-bw/2}" y="${top}" width="${bw}" height="${Math.max(base-top,0)}" rx="4"/>${r.bud?`<line class="tick" x1="${cx-bw/2-5}" x2="${cx+bw/2+5}" y1="${y(r.bud,mx)}" y2="${y(r.bud,mx)}"/>`:''}${lab(r.spend,cx,Math.min(top,r.bud?y(r.bud,mx):top)-6,r,i)}${xlab(r,i)}${hit(r,i)}`}).join('');
  }else{
    const mx=Math.max(...rows.map(r=>Math.max(r.inc,r.exp)),100)*1.12,bw=Math.min(slot*.3,24);
    g+=rows.map((r,i)=>{const cx=P.l+(i+.5)*slot,ti=y(r.inc,mx),te=y(r.exp,mx);
      return `<rect class="bar-in ${r.ym===S.ym?'on':''}" x="${cx-bw-1.5}" y="${ti}" width="${bw}" height="${Math.max(base-ti,0)}" rx="3"/><rect class="bar-out ${r.ym===S.ym?'on':''}" x="${cx+1.5}" y="${te}" width="${bw}" height="${Math.max(base-te,0)}" rx="3"/>${show(r,i)?`<text class="tl" x="${cx}" y="${Math.min(ti,te)-6}" text-anchor="middle">${r.inc-r.exp<0?'−':'+'}${k1(Math.abs(r.inc-r.exp))}</text>`:''}${xlab(r,i)}${hit(r,i)}`}).join('');
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly spending">${g}</svg>`;
}

/* ── Recent transactions ──────────────────────────────────── */
function recent(picks,d){
  const rows=d.recent.filter(t=>!(t.act==='Transfer'&&t.at==='credit card')).slice(0,picks.rows);
  const dt=s=>new Date(s+'T12:00:00'),short=s=>{const x=dt(s);return `${MON[x.getMonth()]} ${x.getDate()}`};
  const amt=t=>{const cls=t.amt>0?'good':picks.amountColor==='both'&&t.amt<0?'bad':'';return `<b class="amt ${cls}">${t.amt<0?'-':'+'}${m2(Math.abs(t.amt))}</b>`};
  const cat=t=>(t.act==='Expense'||t.act==='Income')?ncat(t.cat):'Transfer';
  let body;
  if(picks.recentStyle==='avatar')body=rows.map(t=>`<div class="rr av"><span class="ini">${(t.n||'?').replace(/[^A-Za-z0-9]/g,'')[0]||'?'}</span><div class="rn"><b>${LAST.h.esc(t.n)}</b><span>${cat(t)} · ${LAST.h.esc(t.a)}</span></div><div class="ra">${amt(t)}<span>${short(t.d)}</span></div></div>`).join('');
  else if(picks.recentStyle==='days'){let last='';body=rows.map(t=>{const x=dt(t.d),diff=Math.round((new Date(2026,10,3,12)-x)/864e5);
      const head=t.d!==last?`<div class="dayh">${diff===0?'Today':diff===1?'Yesterday':`${DOW[x.getDay()]}, ${short(t.d)}`}</div>`:'';last=t.d;
      return head+`<div class="rr dy"><div class="rn"><b>${LAST.h.esc(t.n)}</b><span>${cat(t)}</span></div>${amt(t)}</div>`}).join('')}
  else body=rows.map(t=>`<div class="rr cur"><span class="rd">${short(t.d)}</span><div class="rn"><b>${LAST.h.esc(t.n)}</b>${t.act==='Expense'||t.act==='Income'?`<span>${ncat(t.cat)}</span>`:''}</div>${amt(t)}</div>`).join('');
  return `<section class="sf panel rec see-${picks.seeAll}" data-region="round1"><div class="ph"><h2>Recent transactions</h2><button type="button" class="link">See all →</button></div><div class="rlist">${body}</div></section>`;
}

/* ── Budget performance (the 24px in-bar-label bars are decided) ── */
function gradedColor(p){const h=p<.8?205-160*(p/.8):p<1?45-40*((p-.8)/.2):5;return `hsl(${Math.round(h)},78%,${p>=1?47:50}%)`}
function bar(r){
  const P=LAST.picks||{},w=r.hasB&&!r.credit?Math.min(r.pct*100,100):0,cls=r.over?'over':r.near?'near':'ok';
  const inv=r.over&&(P.fill||0)>=.6;
  const lab=r.hasB&&!r.credit?`<span class="${inv?'inv':r.over?'bad':''}">${Math.round(r.pct*100)}%</span>`:r.noB?'<span class="mut">no budget set</span>':'';
  const bg=P.barPalette==='graded'?`;background:${gradedColor(r.pct)}`:'';
  return `<div class="bt ${cls}">${w>0?`<i style="width:${w}%${bg}"></i>`:''}${r.credit?'':'<s style="left:25%"></s><s style="left:50%"></s><s style="left:75%"></s>'}${lab}</div>`;
}
const amtCell=r=>`<span class="ba ${r.credit?'good':r.over?'bad':''}">${r.credit?'+'+m2(-r.actual):m2(r.actual)}</span>`;
function brow(r,total){return `<div class="br ${total?'tot':''} ${S.detail===r.cat?'on':''}" ${total?'':`data-cat="${LAST.h.esc(r.cat)}" role="button" tabindex="0"`}><span class="bc">${total?'Total':LAST.h.esc(r.cat)}</span>${bar(total?{...r,hasB:r.budget>0,credit:r.actual<0,pct:r.budget>0?r.actual/r.budget:0,over:r.budget>0&&r.actual>=r.budget,near:r.budget>0&&r.actual<r.budget&&r.actual>=.8*r.budget}:r)}${amtCell(total?{...r,credit:r.actual<0,over:r.budget>0&&r.actual>=r.budget}:r)}<span class="bb">${r.budget>0?m2(r.budget):'—'}</span></div>`}
function sortHead(){const b=(k,l,al)=>`<button type="button" data-sort="${k}" class="${S.sort===k?'on':''} ${al||''}">${l}<i>${S.sort===k?(S.dir==='desc'?'↓':'↑'):'↕'}</i></button>`;
  return `<div class="br head"><span class="bc">Category</span>${b('pct','Progress','l')}${b('actual','Actual')}${b('budget','Budget')}</div>`}
const legend=`<div class="bleg"><span><i class="k-ok"></i>Under budget</span><span><i class="k-near"></i>Near limit</span><span><i class="k-over"></i>Over budget</span><span><i class="k-none"></i>No budget set</span><span><i class="k-q"></i>25 / 50 / 75% of budget</span></div>`;
/* ── Round 4: top-level categories (rows store the most specific name) ── */
const topOf=c=>((LAST&&LAST.d.parents)||{})[c]||c;
function groupRows(c){
  const m=new Map();
  c.rows.forEach(r=>{const t=topOf(r.cat),g=m.get(t)||{cat:t,budget:0,actual:0,kids:[]};g.budget+=r.budget;g.actual+=r.actual;g.kids.push(r);m.set(t,g)});
  return[...m.values()].map(g=>{g.actual=Math.round(g.actual*100)/100;g.hasB=g.budget>0;g.credit=g.actual<0;g.pct=g.hasB?g.actual/g.budget:0;
    g.over=g.hasB&&!g.credit&&g.pct>=1;g.near=g.hasB&&!g.over&&!g.credit&&g.pct>=.8;g.noB=!g.hasB&&g.actual>0;
    g.kids=sorted(g.kids,'pct','desc');g.solo=g.kids.length===1&&g.kids[0].cat===g.cat;return g});
}
const grouped=p=>!!p.budGroup&&p.budGroup!=='flat';
function detail(picks,c,d){
  if(!S.detail)return '';
  const grp=S.detail.startsWith('g:'),name=grp?S.detail.slice(2):S.detail,inCat=l=>grp?topOf(ncat(l.c))===name:ncat(l.c)===name,e=LAST.h.esc;
  const g=grp?groupRows(c).find(x=>x.cat===name):null;
  const kids=g&&!g.solo?`<div class="det-k">${g.kids.map(k=>`<span><b>${e(k.cat)}</b> <em class="${k.over?'bad':k.credit?'good':''}">${k.credit?'+'+m2(-k.actual):m2(k.actual)}</em>${k.hasB?` of ${m2(k.budget)}`:' · no budget'}</span>`).join('')}</div>`:'';
  const rows=d.lines.filter(l=>!SKIP.has(l.c)&&inCat(l)&&l.d>=c.start&&l.d<=c.end).sort((a,b)=>a.d<b.d?1:a.d>b.d?-1:b.v-a.v);
  const tot=rows.reduce((s,l)=>s+l.v,0),show=rows.slice(0,14);
  return `<div class="det"><div class="det-h"><div><b>${LAST.h.esc(name)}</b><span class="${tot>=0?'bad':'good'}">${tot>=0?'-':'+'}${m2(Math.abs(tot))}</span><span class="mut">${rows.length} transactions · ${c.label}</span></div><button type="button" class="x" data-close aria-label="Close category detail">✕</button></div>${kids}
    <div class="det-l">${show.length?show.map(l=>{const x=new Date(l.d+'T12:00:00');return `<div class="dr"><span class="rd">${MON[x.getMonth()]} ${x.getDate()}</span><div class="rn"><b>${LAST.h.esc(l.n)}</b><span>${LAST.h.esc(grp?ncat(l.c)+' · '+l.a:l.a)}</span></div><b class="amt ${l.v>=0?'':'good'}">${l.v>=0?'-':'+'}${m2(Math.abs(l.v))}</b></div>`}).join(''):'<p class="mut pad">No transactions in this period.</p>'}
    ${rows.length>show.length?`<button type="button" class="link more">${rows.length-show.length} more in Transactions →</button>`:''}</div></div>`;
}
const tileFig=(r,p)=>p.tileFig!=='left'||!r.hasB||r.credit?amtCell(r):r.actual>r.budget?`<span class="ba bad">${m2(r.actual-r.budget)} over</span>`:`<span class="ba good">${m2(r.budget-r.actual)} left</span>`;
const tileSub=(r,p)=>p.tileFig==='left'&&r.hasB&&!r.credit?`${m2(r.actual)} of ${m2(r.budget)}`:r.hasB?`of ${m2(r.budget)}`:r.credit?'net credit':'no budget set';
function budget(picks,c,d){
  const lay=picks.budgetLayout,det=picks.detail,all=lay==='tiles'?sorted(c.rows,picks.tileOrder||'pct','desc'):sorted(c.rows);
  const inl=r=>det==='inline'&&S.detail===r.cat?`<div class="det-inline">${detail(picks,c,d)}</div>`:'';
  const rowsHtml=list=>list.map(r=>brow(r)+inl(r)).join('');
  let body;
  if(lay==='capped'){const n=picks.cap,show=S.showAll?all:all.slice(0,n);
    body=sortHead()+brow(c.tot,true)+rowsHtml(show)+(all.length>n?`<button type="button" class="link showall" data-showall>${S.showAll?'Show fewer':`Show all ${all.length} →`}</button>`:'')}
  else if(lay==='status'){const G=[['Over budget',r=>r.over],['Near limit',r=>r.near],['On track',r=>r.hasB&&!r.over&&!r.near&&!r.credit],['No budget set',r=>r.noB],['Credits and refunds',r=>r.credit]];
    body=brow(c.tot,true)+G.map(([l,f])=>{const g=all.filter(f);return g.length?`<div class="bg-h">${l}<span>${g.length}</span></div>`+rowsHtml(g):''}).join('')}
  else if(lay==='tiles'){
    const e=LAST.h.esc,bg=picks.budGroup||'flat',G=bg==='flat'?null:sorted(groupRows(c),'pct','desc');
    const tile=(r,key,extra='')=>`<div class="bti ${S.detail===key?'on':''}" data-cat="${e(key)}" role="button" tabindex="0"><div class="bti-h"><b>${e(r.cat)}</b>${tileFig(r,picks)}</div>${bar(r)}<span class="mut">${tileSub(r,picks)}</span>${extra}</div>`;
    const kidAmt=k=>`<b class="${k.over?'bad':k.credit?'good':''}">${k.credit?'+'+m2(-k.actual):m2(k.actual)}</b>`;
    let inner;
    if(bg==='groups')inner=`<div class="btiles">${G.map(g=>tile(g,'g:'+g.cat,g.solo?'':`<span class="bti-k">${g.kids.filter(k=>Math.abs(k.actual)>.004).map(k=>e(k.cat)).join(' · ')||'Nothing spent yet'}</span>`)).join('')}</div>`;
    else if(bg==='inside')inner=`<div class="btiles in">${G.map(g=>tile(g,'g:'+g.cat,g.solo?'':`<div class="bk2s">${g.kids.map(k=>`<div class="bk2 ${S.detail===k.cat?'on':''}" data-cat="${e(k.cat)}" role="button" tabindex="0"><span>${e(k.cat)}</span>${kidAmt(k)}<small>${k.hasB?'of '+m2(k.budget):k.credit?'net credit':'no budget'}</small><i class="bk2-t ${k.over?'over':k.near?'near':''}"><em style="width:${k.hasB&&!k.credit?Math.min(k.pct*100,100):0}%"></em></i></div>`).join('')}</div>`)).join('')}</div>`;
    else if(bg==='sections')inner=`<div class="bsecs">${G.map(g=>`<div class="bsec"><div class="bsec-h ${S.detail==='g:'+g.cat?'on':''}" data-cat="${e('g:'+g.cat)}" role="button" tabindex="0"><b>${e(g.cat)}</b>${bar(g)}${tileFig(g,picks)}<span class="mut">${tileSub(g,picks)}</span></div>${g.solo?'':`<div class="btiles sub">${g.kids.map(k=>tile(k,k.cat)).join('')}</div>`}</div>`).join('')}</div>`;
    else inner=`<div class="btiles">${all.map(r=>tile(r,r.cat)+inl(r)).join('')}</div>`;
    body=`<div class="btot"><span>Total spent</span><b class="val">${m2(c.tot.actual)}</b><span class="mut">of ${m2(c.tot.budget)} budgeted</span></div>${inner}`}
  else body=sortHead()+brow(c.tot,true)+rowsHtml(all);
  const ctl=picks.header==='current'?`<div class="hdr-r">${viewToggle()}${picker(picks,c)}</div>`:`<span class="mut">${c.label}</span>`;
  const side=det==='side'&&S.detail,below=det==='below'||(det==='inline'&&lay==='never');
  return `<section class="sf panel bud wide p-bud ${side?'has-side':''}" data-region="round4"><div class="ph"><h2>Budget performance</h2>${ctl}</div>
    <div class="bud-in"><div class="btab lay-${lay}">${body}${lay!=='tiles'?legend:''}</div>${side?`<aside class="det-side">${detail(picks,c,d)}</aside>`:''}</div></section>${below&&S.detail?`<section class="sf det-below wide">${detail(picks,c,d)}</section>`:''}`;
}

/* ── New panels: net worth, rewards programs ──────────────── */
function networth(picks,c,d){
  if(!picks.showNW)return '';
  const first=d.nw[0],ch=c.nw.nw-first.nw,[fy,fm]=first.m.split('-').map(Number);
  let body;
  if(picks.nwStyle==='breakdown'){const B=Object.entries(d.buckets).sort((a,b)=>b[1]-a[1]),mx=Math.max(...B.map(b=>Math.abs(b[1])));
    body=`<div class="bk">${B.map(([k,v])=>`<div class="bk-r"><span>${k}</span><div class="bk-t"><i class="${v<0?'neg':''}" style="width:${Math.max(Math.abs(v)/mx*100,1.5)}%"></i></div><b class="${v<0?'bad':''}">${v<0?'−':''}${k1(Math.abs(v))}</b></div>`).join('')}</div>`}
  else body=`<div class="chart" data-chart="nw"></div>`;
  return `<section class="sf panel" data-region="elements"><div class="ph"><h2>Net worth</h2><span class="mut">${picks.nwStyle==='breakdown'?'today':`${MON[fm-1]} ${fy} – today`}</span></div><div class="nw-top"><b class="val">${m2(c.nw.nw)}</b><span class="${ch<0?'bad':'good'}">${ch<0?'−':'+'}${m2(Math.abs(ch))} in 12 months</span></div>${body}</section>`;
}
function drawNW(W,picks,d){
  const H=150,P={t:18,r:14,b:24,l:14},cw=W-P.l-P.r,chh=H-P.t-P.b,v=d.nw,n=v.length;
  const mn=Math.min(...v.map(p=>p.nw)),mx=Math.max(...v.map(p=>p.nw)),lo=mn-(mx-mn)*.35,hi=mx+(mx-mn)*.2,y=x=>P.t+chh-(x-lo)/(hi-lo)*chh;
  const lab=p=>p.m==='now'?`${MON[TODAY.m-1]} ${TODAY.d}`:MON[Number(p.m.split('-')[1])-1];
  if(picks.nwStyle==='bars'){const slot=cw/n,bw=Math.min(slot*.55,28);
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Net worth by month">${v.map((p,i)=>{const cx=P.l+(i+.5)*slot,t=y(p.nw),dlt=i?p.nw-v[i-1].nw:0;
      return `<rect class="bar ${p.m==='now'?'on':''}" x="${cx-bw/2}" y="${t}" width="${bw}" height="${P.t+chh-t}" rx="3"><title>${lab(p)}: ${m2(p.nw)}</title></rect>${i&&(i%2===0||i===n-1)?`<text class="tl ${dlt<0?'neg':'pos'}" x="${cx}" y="${t-5}" text-anchor="middle">${dlt<0?'−':'+'}${k1(Math.abs(dlt))}</text>`:''}${i%2===0||i===n-1?`<text class="tx" x="${cx}" y="${H-6}" text-anchor="middle">${lab(p)}</text>`:''}`}).join('')}</svg>`}
  const pts=v.map((p,i)=>[P.l+i/(n-1)*cw,y(p.nw)]),dd=smooth(pts);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Net worth over 12 months"><defs><linearGradient id="pvNW" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="st0"/><stop offset="100%" class="st1"/></linearGradient></defs><path class="area nw" d="${dd} L${pts[n-1][0]},${P.t+chh} L${pts[0][0]},${P.t+chh} Z"/><path class="ln" d="${dd}"/><circle class="dot" cx="${pts[n-1][0]}" cy="${pts[n-1][1]}" r="4"/>${v.map((p,i)=>i%3===0||i===n-1?`<text class="tx" x="${pts[i][0]}" y="${H-6}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}">${lab(p)}</text>`:'').join('')}</svg>`;
}
function rewards(picks,d){
  if(!picks.showPts)return '';
  const E=[...d.ecos].sort((a,b)=>b.balance-a.balance),h=LAST.h;
  const lg=e=>{const s=h.img(`logo_${e.logo}_light`);return s?`<span class="lg"><img src="${s}" alt="${h.esc(e.name)}"></span>`:`<span class="mono">${h.esc(e.name)}</span>`};
  const body=picks.ptsStyle==='list'?`<div class="pts-l">${E.slice(0,6).map(e=>`<div class="pr">${lg(e)}<b class="val">${h.num(e.balance)}</b><span class="${e.earned>0?'good':'mut'}">+${h.num(e.earned)} ${d.ecoPeriod}</span></div>`).join('')}</div><button type="button" class="link">All ${E.length} programs in Cards →</button>`
    :`<div class="pts-t">${E.map(e=>`<div class="pt">${lg(e)}<b class="val">${h.num(e.balance)}</b></div>`).join('')}</div>`;
  return `<section class="sf panel" data-region="elements"><div class="ph"><h2>Rewards programs</h2><span class="mut">balances</span></div>${body}</section>`;
}

/* ── Round 2: insight panels ──────────────────────────────── */
// Every figure here is plain arithmetic on the period's rows: no guessing, nothing to maintain.
const CATC=['#2563EB','#0D9488','#F59E0B','#DB2777','#7C3AED','#0EA5E9','#65A30D','#EA580C'];
function catSpend(d,a,b,lv){const o={};d.lines.forEach(l=>{if(SKIP.has(l.c)||l.d<a||l.d>b)return;const k=lv?topOf(ncat(l.c)):ncat(l.c);o[k]=(o[k]||0)+l.v});return o}
function monthCtx(c){
  const{Y,M,endDay}=c,[pY,pM]=shiftYm(Y,M,-1);
  return{start:`${Y}-${pad(M)}-01`,end:`${Y}-${pad(M)}-${pad(endDay)}`,pStart:`${pY}-${pad(pM)}-01`,pEnd:`${pY}-${pad(pM)}-${pad(Math.min(endDay,lastDay(pY,pM)))}`,name:MONL[M-1],pName:MONL[pM-1],partial:c.isCM};
}
const purchases=(c,d)=>d.lines.filter(l=>!SKIP.has(l.c)&&l.k==='e'&&l.v>0&&l.d>=c.start&&l.d<=c.end);
const dstr=s=>{const x=new Date(s+'T12:00:00');return `${MON[x.getMonth()]} ${x.getDate()}`};
function cushion(d){
  const A=agg(d),ms=[];for(let i=6;i>=1;i--){const[y,m]=shiftYm(TODAY.y,TODAY.m,-i);ms.push((A.mon[ymOf(y,m)]||{}).exp||0)}
  const avg=ms.reduce((s,v)=>s+v,0)/ms.length,cash=d.nw[d.nw.length-1].cash;
  return{avg,cash,months:avg>0?cash/avg:0,from:MON[shiftYm(TODAY.y,TODAY.m,-6)[1]-1],to:MON[shiftYm(TODAY.y,TODAY.m,-1)[1]-1]};
}
// Round 3: pick which insights appear. Each is plain arithmetic on the period's rows.
const INS=[['spend','Change in spending',true],['over','Furthest over budget',true],['kept','Share of income kept',true],['nobud','Spending with no budget',true],
  ['move','Biggest change by category (monthly view)',false],['big','Largest purchase',false],['merchant','Top merchant',false],['cushion','Cash cushion',false]];
function insightList(c,d){
  const mc=monthCtx(c),o={};
  if(S.view==='month'&&c.pExp>0){const p=Math.round((c.exp-c.pExp)/c.pExp*100);
    o.spend={fig:`${p>0?'▲':'▼'} ${Math.abs(p)}%`,tone:p>0?'bad':'good',text:`Spending ${p>0?'up':'down'} from ${mc.pName}${mc.partial?' (same days)':''}: ${m2(c.exp)} against ${m2(c.pExp)}.`}}
  else o.spend={fig:k1(c.exp/c.M),tone:'',text:`Average a month this year; ${m2(c.exp)} spent so far.`};
  const BR=grouped(LAST.picks)?groupRows(c):c.rows,over=BR.filter(r=>r.over).sort((a,b)=>(b.actual-b.budget)-(a.actual-a.budget));
  if(over.length){const r=over[0];o.over={fig:'+'+k1(r.actual-r.budget),tone:'bad',text:`${r.cat} ran ${m2(r.actual-r.budget)} over its ${m2(r.budget)} budget${over.length>1?`. ${over.length-1} more ${over.length===2?'category is':'categories are'} over too`:''}.`}}
  else o.over={fig:'✓',tone:'good',text:'Every budgeted category is within budget.'};
  if(c.inc>0){const r=Math.round(c.net/c.inc*100);o.kept={fig:`${r}%`,tone:r>=0?'good':'bad',text:r>=0?`Kept ${r}% of what came in: ${m2(c.net)} of ${m2(c.inc)}.`:`Spent ${m2(-c.net)} more than came in.`}}
  else o.kept={fig:'$0',tone:'',text:'No income recorded in this period yet.'};
  const nb=BR.filter(r=>r.noB).sort((a,b)=>b.actual-a.actual);
  if(nb.length){const t=nb.reduce((s,r)=>s+r.actual,0);o.nobud={fig:k1(t),tone:'warn',text:`Went to categories with no budget: ${nb.slice(0,3).map(r=>r.cat).join(', ')}${nb.length>3?` and ${nb.length-3} more`:''}.`}}
  if(S.view==='month'){const cur=catSpend(d,mc.start,mc.end),cmp=catSpend(d,mc.pStart,mc.pEnd);
    const x=[...new Set([...Object.keys(cur),...Object.keys(cmp)])].map(k=>({k,a:cur[k]||0,b:cmp[k]||0})).filter(x=>x.a>=0&&x.b>=0).map(x=>({...x,d:x.a-x.b})).sort((p,q)=>Math.abs(q.d)-Math.abs(p.d))[0];
    if(x&&Math.abs(x.d)>=25)o.move={fig:`${x.d>0?'+':'−'}${k1(Math.abs(x.d))}`,tone:x.d>0?'bad':'good',text:`${x.k} ${x.d>0?'up':'down'} ${m2(Math.abs(x.d))} from ${mc.pName}${mc.partial?' (same days)':''}: ${m2(x.a)} against ${m2(x.b)}.`}}
  const P=purchases(c,d),big=[...P].sort((a,b)=>b.v-a.v)[0];
  if(big)o.big={fig:k1(big.v),tone:'',text:`Largest purchase: ${big.n} on ${dstr(big.d)} (${ncat(big.c)}).`};
  const g={};P.forEach(l=>{const k=(l.n||'').trim().toLowerCase(),m=g[k]=g[k]||{n:l.n,v:0,ct:0,cat:ncat(l.c)};m.v+=l.v;m.ct++});
  const tm=Object.values(g).sort((a,b)=>b.v-a.v)[0];
  if(tm)o.merchant={fig:k1(tm.v),tone:'',text:`Top merchant: ${tm.n}, ${tm.ct} ${tm.ct===1?'purchase':'purchases'} for ${m2(tm.v)} (${tm.cat}).`};
  const cu=cushion(d);o.cushion={fig:`${cu.months.toFixed(1)} mo`,tone:cu.months<3?'warn':'good',text:`Checking and savings cover ${cu.months.toFixed(1)} months of average spending.`};
  return o;
}
function insights(picks,c,d){
  const o=insightList(c,d),L=INS.filter(([k])=>picks['ins_'+k]&&o[k]).map(([k])=>o[k]),e=LAST.h.esc,lk=picks.insLook;
  const li=i=>`<li class="tn-${i.tone||'n'}"><b class="${i.tone}">${i.fig}</b><span>${e(i.text)}</span></li>`;
  let body;
  if(!L.length)body='<p class="mut">Nothing to show: switch on at least one insight.</p>';
  else if(lk==='lead'){const[a,...r]=L;body=`<p class="ins-lead"><b class="${a.tone}">${a.fig}</b><span>${e(a.text)}</span></p>${r.length?`<ul class="ins-l lk-plain sm">${r.map(li).join('')}</ul>`:''}`}
  else body=`<ul class="ins-l lk-${lk}">${L.map(li).join('')}</ul>`;
  return `<section class="wide sf panel ins p-ins" data-region="round3"><div class="ph"><h2>Insights</h2><span class="mut">${c.label}</span></div>${body}</section>`;
}
function pace(picks,c){
  const B=c.tot.budget,X=c.tot.actual,doy=(y,m,dd)=>Math.round((new Date(y,m-1,dd)-new Date(y,0,1))/864e5)+1;
  const tot=S.view==='month'?lastDay(c.Y,c.M):doy(c.Y,c.M,lastDay(c.Y,c.M)),el=S.view==='month'?c.endDay:doy(c.Y,c.M,c.endDay);
  const e=el/tot,done=el>=tot,proj=e>0?X/e:X,pct=B>0?X/B:0;
  const head=done?(X>B?`Finished <b class="bad">${m2(X-B)}</b> over budget`:`Finished <b class="good">${m2(B-X)}</b> under budget`)
    :(proj>B?`On pace for ${m2(proj)}, <b class="bad">${m2(proj-B)}</b> over`:`On pace for ${m2(proj)}, <b class="good">within budget</b>`);
  const sub=`${m2(X)} spent of ${m2(B)} · ${S.view==='month'?`day ${el} of ${tot}`:`${c.label}`}`;
  // The arc runs from 0 to 150% of budget, so the budget mark sits two thirds of the way round.
  const L=Math.PI*90,cap=1.5,fr=v=>Math.min(Math.max(v,0),cap)/cap,f=fr(pct),gs=picks.gaugeStyle,zn=gs==='zones',ARC='M20,112 A90,90 0 0 1 200,112';
  const pt=(t,R)=>{const th=Math.PI-Math.PI*t;return[110+R*Math.cos(th),112-R*Math.sin(th)]};
  const tick=(t,cls,lab)=>{const[x1,y1]=pt(t,76),[x2,y2]=pt(t,104),[lx,ly]=pt(t,116);return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text class="tx" x="${lx}" y="${ly}" text-anchor="middle">${lab}</text>`};
  const seg=(a,b,cls)=>b>a?`<path class="${cls}" d="${ARC}" stroke-dasharray="0 ${L*a} ${L*(b-a)} ${L*2}"/>`:'';
  const over=X>B,usd=v=>'$'+Math.round(v).toLocaleString('en-US');
  const[fig,figSub]=picks.gaugeFig==='dollars'?(over?[usd(X-B),'over budget']:[usd(B-X),'left to spend']):[Math.round(pct*100)+'%','of budget'];
  const showProj=gs==='proj'&&!done&&proj>X,fp=fr(B>0?proj/B:0);
  let arcs;
  if(zn){const[nx,ny]=pt(f,80);
    arcs=seg(0,fr(.8),'g-z ok')+seg(fr(.8),fr(1),'g-z near')+seg(fr(1),1,'g-z over')+tick(1/cap,'g-tk','Budget')+(done?'':tick(e/cap,'g-td','Today'))
      +`<line class="g-nd" x1="110" y1="112" x2="${nx}" y2="${ny}"/><circle class="g-pv" cx="110" cy="112" r="6"/>`}
  else arcs=`<path class="g-bg" d="${ARC}"/>`+(showProj?seg(f,fp,`g-pr ${proj>B?'over':''}`):'')+`<path class="g-fg ${over?'over':''}" d="${ARC}" stroke-dasharray="${L*f} ${L*2}"/>`+tick(1/cap,'g-tk','Budget')+(done?'':tick(e/cap,'g-td','Today'));
  const fy=zn?148:98;
  const svg=`<svg class="gauge" viewBox="-40 -14 300 ${zn?186:136}" role="img" aria-label="${Math.round(pct*100)}% of budget used">${arcs}<text class="g-v ${over?'bad':''}" x="110" y="${fy}" text-anchor="middle">${fig}</text><text class="tx" x="110" y="${fy+16}" text-anchor="middle">${figSub}</text></svg>`;
  const note=showProj?`<p class="mut g-note">Light arc: where today's pace lands, ${Math.round(proj/B*100)}% of budget.</p>`:gs==='proj'&&done?'<p class="mut g-note">The light arc appears while a month is in progress: pick November.</p>':'';
  return `<section class="sf panel p-pace" data-region="round3"><div class="ph"><h2>${S.view==='month'?'Month pace':'Year pace'}</h2><span class="mut">${c.label}</span></div><p class="pace-h">${head}</p><p class="pace-s">${sub}</p>${svg}${note}</section>`;
}
function where(picks,c,d){
  const lv=picks.whereGroup==='top';
  const all=Object.entries(catSpend(d,c.start,c.end,lv)),E=all.filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]),tot=E.reduce((s,x)=>s+x[1],0),N=picks.whereN;
  // Categories that net to a credit (refunds, business reimbursements) can't be a slice; say so, since the total then differs from the budget card's.
  const cr=all.filter(([,v])=>v<0).sort((a,b)=>a[1]-b[1]),crT=-cr.reduce((s,x)=>s+x[1],0);
  const crList=`${cr.slice(0,2).map(x=>LAST.h.esc(x[0])).join(', ')}${cr.length>2?'…':''}`;
  const crNote=crT<1?'':picks.evenRow?`<p class="mut wnote" title="Gross spending, so this is more than the budget card's total.">Leaves out ${m2(crT)} of net credits (${crList}).</p>`
    :`<p class="mut wnote">Gross spending. ${m2(crT)} of net credits (${crList}) are left out, so this is more than the budget card's total.</p>`;
  const it=E.slice(0,N).map(([k,v],i)=>({k,v,col:CATC[i%CATC.length]})),rest=E.slice(N).reduce((s,x)=>s+x[1],0),rn=E.length-N;
  if(rest>0)it.push({k:`${rn} more ${rn===1?'category':'categories'}`,v:rest,col:'#94A3B8',rest:true});
  const e=LAST.h.esc,pc=v=>tot>0?Math.round(v/tot*100)+'%':'—',H=picks.whereH;
  const seg=(x,t)=>`<i style="width:${x.v/t*100}%;background:${x.col}" title="${e(x.k)}: ${m2(x.v)}"></i>`;
  let bars;
  if(picks.wherePrev&&S.view==='month'){
    const mc=monthCtx(c),pm=shiftYm(c.Y,c.M,-1)[1],rank={},colOf={};it.forEach((x,i)=>{if(!x.rest){rank[x.k]=i;colOf[x.k]=x.col}});
    // Last month uses the same colour for the same category, in this month's order; anything else is grey.
    const pE=Object.entries(catSpend(d,mc.pStart,mc.pEnd,lv)).filter(([,v])=>v>0),ptot=pE.reduce((s,x)=>s+x[1],0);
    const pit=pE.filter(([k])=>k in rank).map(([k,v])=>({k,v,col:colOf[k]})).sort((a,b)=>rank[a.k]-rank[b.k]),pr=pE.filter(([k])=>!(k in rank)).reduce((s,x)=>s+x[1],0);
    if(pr>0)pit.push({k:'Other categories',v:pr,col:'#94A3B8'});
    const mx=Math.max(tot,ptot)||1;
    bars=`<div class="wb2"><div class="wb-r"><span>${MON[c.M-1]}</span><div><div class="wbar" style="height:${H}px;width:${tot/mx*100}%">${it.map(x=>seg(x,tot)).join('')}</div></div><b>${k1(tot)}</b></div>
      <div class="wb-r prev"><span>${MON[pm-1]}</span><div><div class="wbar" style="height:${Math.max(Math.round(H*.6),8)}px;width:${ptot/mx*100}%">${pit.map(x=>seg(x,ptot)).join('')}</div></div><b>${k1(ptot)}</b></div></div>
      ${picks.evenRow?(mc.partial?`<p class="mut wb-n">Same days of ${mc.pName} underneath.</p>`:''):`<p class="mut wb-n">${mc.pName}${mc.partial?', same days,':''} underneath, on the same scale.</p>`}`;
  }else bars=`<div class="wbar" style="height:${H}px">${it.map(x=>seg(x,tot)).join('')}</div>`+(picks.wherePrev&&!picks.evenRow?'<p class="mut wb-n">Last month\'s bar shows in the monthly view.</p>':'');
  let legend;
  if(picks.whereLegend==='chips')legend=`<div class="wchips">${it.map(x=>`<span class="wc" title="${e(x.k)}: ${m2(x.v)}"><i style="background:${x.col}"></i>${e(x.k)}<em>${pc(x.v)}</em></span>`).join('')}</div>`;
  else if(picks.whereLegend==='top3'){const t3=it.filter(x=>!x.rest).slice(0,3),more=it.slice(t3.length);
    legend=`<div class="wtop">${t3.map(x=>`<div><span><i style="background:${x.col}"></i>${e(x.k)}</span><b class="val">${k1(x.v)}</b><em>${pc(x.v)}</em></div>`).join('')}</div>${more.length?`<p class="wrest">Then ${more.map(x=>`<span><i style="background:${x.col}"></i>${e(x.k)} ${pc(x.v)}</span>`).join(', ')}.</p>`:''}`}
  else legend=`<div class="wl">${it.map(x=>`<div class="wl-r"><i style="background:${x.col}"></i><span>${e(x.k)}</span><em>${pc(x.v)}</em><b>${m2(x.v)}</b></div>`).join('')}</div>`;
  return `<section class="sf panel p-where" data-region="round4"><div class="ph"><h2>Where the money went</h2><span class="mut">${c.label}</span></div>${bars}${legend}${crNote}</section>`;
}
function movers(picks,c,d){
  const mc=monthCtx(c),cur=catSpend(d,mc.start,mc.end);let cmp={},cl;
  if(picks.moversCmp==='avg3'){
    // A month in progress is compared with the same share of an average month.
    const part=mc.partial?c.endDay/lastDay(c.Y,c.M):1;
    for(let i=1;i<=3;i++){const[y,m]=shiftYm(c.Y,c.M,-i);Object.entries(catSpend(d,`${y}-${pad(m)}-01`,`${y}-${pad(m)}-${pad(lastDay(y,m))}`)).forEach(([k,v])=>cmp[k]=(cmp[k]||0)+v/3*part)}
    cl=mc.partial?'the 3-month average, same share of the month':'the 3-month average'}
  else{cmp=catSpend(d,mc.pStart,mc.pEnd);cl=mc.pName+(mc.partial?' (same days)':'')}
  const D=[...new Set([...Object.keys(cur),...Object.keys(cmp)])].map(k=>({k,cur:cur[k]||0,cmp:cmp[k]||0})).filter(x=>x.cur>=0&&x.cmp>=0).map(x=>({...x,d:x.cur-x.cmp})).filter(x=>Math.abs(x.d)>=25);
  const up=D.filter(x=>x.d>0).sort((a,b)=>b.d-a.d).slice(0,4),dn=D.filter(x=>x.d<0).sort((a,b)=>a.d-b.d).slice(0,4),e=LAST.h.esc;
  const row=x=>`<div class="mv-r"><b>${e(x.k)}</b><em class="${x.d>0?'bad':'good'}">${x.d>0?'+':'−'}${m2(Math.abs(x.d))}</em><span>${m2(x.cur)} now, ${m2(x.cmp)} before</span></div>`;
  let body;
  if(picks.moversStyle==='bars'){const all=[...up,...dn].sort((a,b)=>b.d-a.d),mx=Math.max(...all.map(x=>Math.abs(x.d)),1);
    body=`<div class="dv">${all.map(x=>`<div class="dv-r"><span>${e(x.k)}</span><div class="dv-t"><i class="${x.d>0?'up':'dn'}" style="width:${Math.abs(x.d)/mx*50}%"></i></div><b class="${x.d>0?'bad':'good'}">${x.d>0?'+':'−'}${k1(Math.abs(x.d))}</b></div>`).join('')}</div><div class="dv-l"><span>Spent less</span><span>Spent more</span></div>`}
  else body=`<div class="mv"><div><h3>Spent more</h3>${up.map(row).join('')||'<p class="mut">Nothing rose by $25 or more.</p>'}</div><div><h3>Spent less</h3>${dn.map(row).join('')||'<p class="mut">Nothing fell by $25 or more.</p>'}</div></div>`;
  return `<section class="sf panel" data-region="movers"><div class="ph"><h2>Biggest changes</h2><span class="mut">${mc.name}${mc.partial?' so far':''} vs ${cl}</span></div>${body}</section>`;
}
function largest(picks,c,d){
  const L=purchases(c,d).sort((a,b)=>b.v-a.v).slice(0,5),e=LAST.h.esc;
  return `<section class="sf panel" data-region="elements"><div class="ph"><h2>Largest purchases</h2><span class="mut">${c.label}</span></div><div class="rlist">${L.map(l=>`<div class="rr cur"><span class="rd">${dstr(l.d)}</span><div class="rn"><b>${e(l.n)}</b><span>${e(ncat(l.c))} · ${e(l.a)}</span></div><b class="amt">${m2(l.v)}</b></div>`).join('')||'<p class="mut">No purchases yet.</p>'}</div></section>`;
}
function merchants(picks,c,d){
  const g={};purchases(c,d).forEach(l=>{const k=(l.n||'').trim().toLowerCase();const o=g[k]=g[k]||{n:l.n,v:0,ct:0,cat:ncat(l.c)};o.v+=l.v;o.ct++});
  const L=Object.values(g).sort((a,b)=>b.v-a.v).slice(0,5),mx=L.length?L[0].v:1,e=LAST.h.esc;
  return `<section class="sf panel" data-region="elements"><div class="ph"><h2>Top merchants</h2><span class="mut">${c.label}</span></div><div class="mlist">${L.map(m=>`<div class="mrow"><div class="rn"><b>${e(m.n)}</b><span>${m.ct} ${m.ct===1?'purchase':'purchases'} · ${e(m.cat)}</span></div><b class="amt">${m2(m.v)}</b><div class="mbar"><i style="width:${m.v/mx*100}%"></i></div></div>`).join('')}</div></section>`;
}
function savings(picks,c,d){
  const A=agg(d),ms=[];for(let i=5;i>=0;i--){const[y,m]=shiftYm(c.Y,c.M,-i),o=A.mon[ymOf(y,m)]||{inc:0,exp:0};ms.push({lab:MON[m-1],r:o.inc>0?(o.inc-o.exp)/o.inc:null,on:i===0})}
  let yi=0,ye=0;for(let m=1;m<=c.M;m++){const o=A.mon[ymOf(c.Y,m)]||{inc:0,exp:0};yi+=o.inc;ye+=o.exp}
  const r=c.inc>0?Math.round(c.net/c.inc*100):null,yr=yi>0?Math.round((yi-ye)/yi*100):null;
  return `<section class="sf panel" data-region="elements"><div class="ph"><h2>Savings rate</h2><span class="mut">share of income kept</span></div><div class="sv-top"><b class="val ${r!==null&&r<0?'bad':''}">${r===null?'—':r+'%'}</b><span class="mut">${c.label}${yr!==null&&S.view==='month'?` · ${yr}% for ${c.Y} so far`:''}</span></div>
    <div class="sv">${ms.map(x=>{const h=x.r===null?0:Math.min(Math.abs(x.r),1)*100;return `<div class="sv-c ${x.on?'on':''}"><div class="up">${x.r>0?`<i class="pos" style="height:${h}%"></i>`:''}</div><div class="dn">${x.r<0?`<i class="neg" style="height:${h}%"></i>`:''}</div><small>${x.lab}</small><em class="${x.r<0?'bad':''}">${x.r===null?'—':Math.round(x.r*100)+'%'}</em></div>`}).join('')}</div></section>`;
}
function cushionP(picks,d){
  const cu=cushion(d);
  return `<section class="sf panel" data-region="elements"><div class="ph"><h2>Cash cushion</h2><span class="mut">today</span></div><div class="sv-top"><b class="val">${cu.months.toFixed(1)} months</b><span class="mut">of average spending</span></div>
    <div class="cu-cells">${Array.from({length:6},(_,i)=>`<i><b style="width:${Math.max(Math.min(cu.months-i,1),0)*100}%"></b></i>`).join('')}</div><div class="cu-l"><span>1 mo</span><span>3 mo</span><span>6 mo</span></div>
    <p class="mut cu-n">${m2(cu.cash)} in checking and savings, against ${m2(cu.avg)} average monthly spending (${cu.from} – ${cu.to}).</p></section>`;
}
function calendar(picks,c,d){
  const A=agg(d),Y=c.Y,M=c.M,n=lastDay(Y,M),first=new Date(Y,M-1,1).getDay(),v=[];let mx=1;
  for(let i=1;i<=n;i++){const x=A.day[`${Y}-${pad(M)}-${pad(i)}`]||0;v.push(x);mx=Math.max(mx,x)}
  const cells=['S','M','T','W','T','F','S'].map(w=>`<span class="wd">${w}</span>`).join('')+Array.from({length:first},()=>'<span class="dc blank"></span>').join('')
    +v.map((x,i)=>{const fut=Y===TODAY.y&&M===TODAY.m&&i+1>TODAY.d,t=x>0?Math.sqrt(x/mx):0;
      return `<span class="dc ${fut?'fut':''} ${t>.62?'hot':''}" style="${x>0?`background:color-mix(in srgb,var(--ac) ${Math.round(6+64*t)}%,var(--surface))`:''}" title="${MON[M-1]} ${i+1}: ${m2(x)}"><em>${i+1}</em>${fut?'':x>=1?`<b>${k1(x)}</b>`:x<=-1?`<b class="good">+${k1(-x)}</b>`:''}</span>`}).join('');
  return `<section class="sf panel" data-region="elements"><div class="ph"><h2>Spending by day</h2><span class="mut">${MONL[M-1]} ${Y}</span></div><div class="cal">${cells}</div></section>`;
}

function nav(){
  return `<nav class="appnav" data-region="decided"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(([l,i])=>`<button type="button" class="${l==='Dashboard'?'on':''}" title="${l}">${icon(i)}<span>${l}</span></button>`).join('')}</div></nav>`;
}

function page(picks,d){
  // Round 2 settled the panels; 2026-11-07 removed insights and moved pace, chart and where above the budget card.
  const a=picks.arr,c=ctx(d),ins=a==='pacefirst'?'':insights(picks,c,d),pc=pace(picks,c),tr=trend(picks,c),wh=where(picks,c,d),bu=budget(picks,c,d);
  const body=a==='side'?`<div class="split"><div class="col">${tr}${bu}</div><div class="col">${ins}${pc}${wh}</div></div>`
    :`<div class="flow">${a==='budhigh'?ins+bu+pc+tr+wh:ins+pc+tr+wh+bu}</div>`;
  return `<div class="app">${nav()}<div class="main">${header(picks,c)}${kpis(picks,c,d)}${body}</div></div>`;
}

Gallery.define({
  id:'dashboard-final-r6',
  name:'Dashboard, final design',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap'],
  groups:[
   {id:'nov7',label:'Changed 2026-11-07',open:true,controls:[
    {id:'panels',label:'Panels shown',type:'choice',locked:true,options:[{id:'five',label:'Summary figures, month pace, spending chart, where the money went, budget'}]},
    {id:'panelsOff',label:'Left off',type:'choice',locked:true,options:[{id:'rest',label:'Insights, biggest changes, recent transactions, largest purchases, top merchants, savings rate, cash cushion, spending by day, net worth, rewards'}]},
    {id:'arr',label:'Where the panels sit',type:'choice',locked:true,options:[{id:'pacefirst',label:'Month pace, spending chart and where the money went above the budget card'}]},
    {id:'evenRow',label:'Those three cards the same height',type:'toggle',locked:true,default:true},
    {id:'whereN',label:'Categories named in where the money went',type:'slider',locked:true,min:4,max:8,step:1,default:5},
   ]},
   {id:'round4',label:'Decided in round 4',open:false,controls:[
    {id:'budGroup',label:'Budget card',type:'choice',locked:true,options:[{id:'inside',label:'Top-level tiles with their categories inside'}]},
    {id:'whereGroup',label:'Where the money went',type:'choice',locked:true,options:[{id:'top',label:'By top level'}]},
   ]},
   {id:'round3',label:'Decided in round 3',open:false,controls:[
    {id:'gaugeStyle',label:'Gauge',type:'choice',locked:true,options:[{id:'arc',label:'Filled arc'}]},
    {id:'gaugeFig',label:'Figure in the middle',type:'choice',locked:true,options:[{id:'dollars',label:'Dollars left, or how far over'}]},
    {id:'whereLegend',label:'Where the money went legend',type:'choice',locked:true,options:[{id:'list',label:'List with percent and amount'}]},
    {id:'whereH',label:'Bar height',type:'slider',locked:true,min:12,max:40,step:2,default:28,unit:'px'},
    {id:'wherePrev',label:'Last month\'s bar underneath',type:'toggle',locked:true,default:true},
    {id:'chartBud',label:'Monthly budget line on the chart',type:'toggle',locked:true,default:false},
    {id:'chartAvg',label:'Average line on the chart',type:'toggle',locked:true,default:false},
   ]},
   {id:'round2',label:'Decided in round 2',open:false,controls:[
    {id:'cols',label:'Panels per row',type:'choice',locked:true,options:[{id:'three',label:'Three'}]},
    {id:'paceStyle',label:'Month pace style',type:'choice',locked:true,options:[{id:'gauge',label:'Half-circle gauge'}]},
    {id:'whereStyle',label:'Where the money went style',type:'choice',locked:true,options:[{id:'bar',label:'One stacked bar'}]},
    {id:'barPalette',label:'Bar colors',type:'choice',locked:true,options:[{id:'blue',label:'Blue, amber, red',swatches:['#2563EB','#F59E0B','#EF4444']}]},
    {id:'fill',label:'Fill strength',type:'slider',locked:true,min:.2,max:1,step:.05,default:.5},
    {id:'tileFig',label:'Figure on each tile',type:'choice',locked:true,options:[{id:'left',label:'Left to spend, or how far over'}]},
    {id:'tileOrder',label:'Tile order',type:'choice',locked:true,options:[{id:'pct',label:'Furthest over budget first'}]},
   ]},
   {id:'round1',label:'Decided in round 1',open:false,controls:[
    {id:'layout',label:'Arrangement',type:'choice',locked:true,options:[{id:'stacked',label:'Stacked'}]},
    {id:'header',label:'Header',type:'choice',locked:true,options:[{id:'bar',label:'Slim bar, like Cards'}]},
    {id:'picker',label:'Month picker',type:'choice',locked:true,options:[{id:'stepper',label:'Arrows around the month'}]},
    {id:'kpiStyle',label:'Summary figures',type:'choice',locked:true,options:[{id:'hero',label:'Net worth hero'}]},
    {id:'labelPos',label:'Label position',type:'choice',locked:true,options:[{id:'below',label:'Value first, label under it'}]},
    {id:'change',label:'Change vs last period',type:'choice',locked:true,options:[{id:'text',label:'Colored text with an arrow'}]},
    {id:'chart',label:'Spending chart',type:'choice',locked:true,options:[{id:'line',label:'Line with shaded area'}]},
    {id:'range',label:'Months shown',type:'choice',locked:true,options:[{id:'six',label:'Last 6 months'}]},
    {id:'pointLabels',label:'Label every month',type:'toggle',locked:true,default:true},
    {id:'budgetLayout',label:'Budget layout',type:'choice',locked:true,options:[{id:'tiles',label:'Category tiles'}]},
    {id:'detail',label:'Click a category',type:'choice',locked:true,options:[{id:'below',label:'Panel under the card'}]},
   ]},
   {id:'decided',label:'Decided on the Cards pages',open:false,controls:[
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',swatches:['#EEF2F7','#FFFFFF','#2563EB'],tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'accent',label:'Accent',type:'choice',locked:true,options:[{id:'blue',label:'Brand blue',tokens:{'--ac-l':'#2563EB','--ac-d':'#60A5FA'}}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'outfit',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'surface',label:'Panels',type:'choice',locked:true,options:[{id:'hairline',label:'Hairline'}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'controls',label:'Period and view controls',type:'choice',locked:true,options:[{id:'underline',label:'Underlined text'}]},
    {id:'bars',label:'Budget bars',type:'choice',locked:true,options:[{id:'thick',label:'24px, label inside (decided 2026-07-27)'}]},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
   ]},
  ],
  render(picks,d,h){
    if(LAST&&LAST.d!==d)AGG=null;
    LAST={d,h,picks};
    return page(picks,d);
  },
  after(root,picks){
    const stage=document.getElementById('stage');
    const rr=()=>{const top=stage?stage.scrollTop:0;LAST.picks=picks;root.innerHTML=page(picks,LAST.d);Gallery.spec.after(root,picks);if(stage)stage.scrollTop=top};
    const setYm=(y,m)=>{if(y!==2026||m<1||m>TODAY.m)return;S.ym=ymOf(y,m);rr()};
    const[Y,M]=S.ym.split('-').map(Number);
    root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{S.view=b.dataset.view;rr()});
    root.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>setYm(...shiftYm(Y,M,Number(b.dataset.step))));
    root.querySelectorAll('[data-month]').forEach(b=>b.onclick=()=>setYm(Y,Number(b.dataset.month)));
    root.querySelectorAll('#pv_month').forEach(s=>s.onchange=()=>setYm(Y,Number(s.value)));
    root.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{const k=b.dataset.sort;if(S.sort===k)S.dir=S.dir==='desc'?'asc':'desc';else{S.sort=k;S.dir='desc'}rr()});
    root.querySelectorAll('[data-showall]').forEach(b=>b.onclick=()=>{S.showAll=!S.showAll;rr()});
    root.querySelectorAll('[data-cat]').forEach(el=>{const go=()=>{S.detail=S.detail===el.dataset.cat?null:el.dataset.cat;rr()};el.onclick=e=>{e.stopPropagation();go()};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();go()}}});
    root.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{S.detail=null;rr()});
    // Charts are drawn at their real width so text stays at its true size.
    const draw=()=>{root.querySelectorAll('[data-chart]').forEach(el=>{const W=Math.max(Math.round(el.clientWidth),240),Hh=el.dataset.chart==='trend'&&picks.evenRow?Math.max(Math.round(el.clientHeight),200):0,key=W+'x'+Hh;if(el.dataset.w===key)return;el.dataset.w=key;
      el.innerHTML=el.dataset.chart==='nw'?drawNW(W,picks,LAST.d):drawTrend(W,picks,ctx(LAST.d),LAST.d,Hh);
      el.querySelectorAll('[data-ym]').forEach(r=>r.onclick=()=>{const[y,m]=r.dataset.ym.split('-').map(Number);if(y===2026&&m<=TODAY.m){S.ym=r.dataset.ym;rr()}})})};
    draw();
    if(window.__dRO)window.__dRO.disconnect();
    window.__dRO=new ResizeObserver(draw);root.querySelectorAll('[data-chart]').forEach(el=>window.__dRO.observe(el));
  },
  css:`
#pv{--c-radius:13px;--c-density:1.25;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density));--b-ok:var(--ac);--b-near:#F59E0B;--b-over:#EF4444}
#pv *{box-sizing:border-box}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
#pv button:disabled{opacity:.35;cursor:default}
#pv button:focus-visible,#pv select:focus-visible,#pv [role=button]:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv h1,#pv h2,#pv .val{font-family:var(--f-h)}
#pv h2{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);margin:0}
#pv .val{font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#pv .good{color:var(--good)}#pv .bad{color:var(--bad)}#pv .mut{color:var(--tx3);font-size:11.5px}
#pv .link{color:var(--ac);font-size:12.5px;font-weight:500}
#pv .link:hover{text-decoration:underline}
#pv .hint{margin:6px 0 0;font-size:11px;color:var(--tx3)}
#pv .app{display:flex;flex-direction:column;min-height:100vh;min-width:0}
#pv .main{flex:1;min-width:0;width:100%;padding:calc(22px*var(--c-density)) calc(26px*var(--c-density));display:grid;gap:calc(20px*var(--c-density));align-content:start}
#pv section{min-width:0}
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
#pv .hdr.big.sf{padding:calc(14px*var(--c-density)) calc(20px*var(--c-density))}
#pv .hdr h1{margin:0;font-size:26px;font-weight:600;letter-spacing:-.4px}
#pv .hdr h1.sm{font-size:16px;font-weight:600;letter-spacing:0}
#pv .hdr h1.mo{font-size:30px}
#pv .hdr .sub{margin:4px 0 0;font-size:13.5px;color:var(--tx2)}
#pv .hdr .sub b{font-weight:600}
#pv .eyebrow{margin:0 0 2px;font-size:12.5px;color:var(--tx3)}
#pv .hdr.open{padding:2px 2px 0}
#pv .hdr-r{display:flex;align-items:center;gap:10px 18px;flex-wrap:wrap}
#pv .und{display:flex;gap:16px}
#pv .und button{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12.5px}
#pv .und button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .dd{display:flex;gap:6px}
#pv .dd select{font:inherit;font-size:12.5px;padding:5px 8px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--tx)}
#pv .step{display:flex;align-items:center;gap:4px}
#pv .step b{font-family:var(--f-h);font-weight:500;font-size:14px;min-width:118px;text-align:center}
#pv .step button{width:28px;height:28px;border-radius:7px;border:1px solid var(--line);font-size:16px;line-height:1;color:var(--tx2)}
#pv .step button:not(:disabled):hover{border-color:var(--ac);color:var(--ac)}
#pv .strip{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
#pv .strip button{padding:5px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12.5px}
#pv .strip button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .strip .yr-t{font-size:12px;color:var(--tx2);font-weight:600;margin-left:4px}
/* Summary figures */
#pv .kv{display:flex;flex-direction:column;gap:5px;min-width:0}
#pv .kl{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);order:0}
#pv .kn{font-size:22px;order:1;white-space:nowrap}
#pv .kv.hl .kn{color:var(--ac)}
#pv .ksub{display:flex;align-items:center;gap:7px;order:2;font-size:11px}
#pv[data-labelPos=below] .kv .kl{order:2;font-weight:500;letter-spacing:.06em}
#pv[data-labelPos=below] .kv .ksub{order:3}
#pv[data-labelPos=below] .kn{font-size:24px;font-weight:600}
#pv .chg{font-size:11px;font-weight:600}
#pv .chg.pill{padding:2px 8px;border-radius:12px}
#pv .chg.pill.good{background:color-mix(in srgb,var(--good) 12%,transparent)}
#pv .chg.pill.bad{background:color-mix(in srgb,var(--bad) 11%,transparent)}
#pv .kpis-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--gap)}
#pv .cell{padding:var(--p)}
#pv .kpis-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
#pv .kpis-strip .kv{padding:var(--p);border-left:1px solid var(--line);margin-left:-1px}
#pv .kpis-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:var(--gap)}
#pv .hero{padding:calc(var(--p)*1.2);display:grid;gap:10px;align-content:start}
#pv .hero .kn{font-size:34px}
#pv .spark{width:100%;height:46px;display:block}
#pv .spark path{fill:none;stroke:var(--ac);stroke-width:2}
#pv .hero-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap)}
#pv .kpis-groups{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:var(--gap)}
#pv .grp-p{padding:var(--p);display:grid;gap:12px;align-content:start}
#pv .grp-r{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
#pv .flowbar{position:relative;height:8px;border-radius:8px;background:color-mix(in srgb,var(--good) 22%,transparent);overflow:hidden}
#pv .flowbar .out{position:absolute;left:0;top:0;bottom:0;background:var(--tx2);border-radius:8px}
#pv .flowbar .out.bad{background:var(--bad)}
#pv .flow-l{font-size:11px;color:var(--tx3);margin-top:-6px}
/* Panels */
#pv .panel{padding:var(--p);display:flex;flex-direction:column;min-width:0}
#pv .ph{display:flex;justify-content:space-between;align-items:center;gap:8px 14px;flex-wrap:wrap;margin-bottom:12px;min-height:26px}
#pv .chart{width:100%;min-height:150px}
#pv .chart svg{display:block}
#pv .grid{stroke:var(--line);stroke-width:1}
#pv .ln{fill:none;stroke:var(--ac);stroke-width:2.5;stroke-linecap:round}
#pv .ln-prev{fill:none;stroke:var(--tx3);stroke-width:1.8;stroke-dasharray:4 4}
#pv .ln-bud{stroke:var(--bad);stroke-width:1.2;stroke-dasharray:2 4;opacity:.8}
#pv .area{fill:url(#pvArea)}#pv .area.nw{fill:url(#pvNW)}
#pv .st0{stop-color:var(--ac);stop-opacity:.16}#pv .st1{stop-color:var(--ac);stop-opacity:0}
#pv .dot{fill:var(--ac);stroke:var(--surface);stroke-width:2}
#pv .dot.on{fill:var(--ac)}
#pv .tl{font-size:10.5px;fill:var(--tx2);font-weight:600;font-variant-numeric:tabular-nums}
#pv .tl.strong{fill:var(--tx);font-size:11.5px}
#pv .tl.bud{fill:var(--bad);font-weight:500}
#pv .tl.neg{fill:var(--bad)}#pv .tl.pos{fill:var(--good)}
#pv .tx{font-size:10.5px;fill:var(--tx3);font-weight:500}
#pv .tx.on{fill:var(--ac);font-weight:700}
#pv .bar{fill:color-mix(in srgb,var(--ac) 30%,transparent)}
#pv .bar.on{fill:var(--ac)}
#pv .bar.over{fill:color-mix(in srgb,var(--bad) 40%,transparent)}
#pv .bar.over.on{fill:var(--bad)}
#pv .tick{stroke:var(--tx);stroke-width:2;stroke-dasharray:3 2}
#pv .bar-in{fill:color-mix(in srgb,var(--good) 45%,transparent)}#pv .bar-in.on{fill:var(--good)}
#pv .bar-out{fill:color-mix(in srgb,var(--ac) 35%,transparent)}#pv .bar-out.on{fill:var(--ac)}
#pv .hit{fill:transparent;cursor:pointer}
#pv .hit:hover{fill:color-mix(in srgb,var(--ac) 6%,transparent)}
#pv .leg{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--tx2);margin:-4px 0 6px}
#pv .leg span{display:inline-flex;align-items:center;gap:6px}
#pv .leg i{display:inline-block;width:16px;height:0;border-top:2.5px solid var(--ac)}
#pv .leg .lg-prev{border-top:2px dashed var(--tx3)}
#pv .leg .lg-bud{border-top:2px dotted var(--bad)}
#pv .step.big{gap:10px}
#pv .step.big button{width:32px;height:32px;font-size:18px}
#pv .leg .lg-in{height:9px;width:9px;border:0;border-radius:2px;background:var(--good)}
#pv .leg .lg-out{height:9px;width:9px;border:0;border-radius:2px;background:var(--ac)}
#pv[data-chart=bars] .leg .lg-bud{border-top:2px dashed var(--tx)}
/* Recent transactions */
#pv .rec .ph .link{opacity:0;transition:opacity .15s}
#pv .rec.see-always .ph .link,#pv .rec:hover .ph .link,#pv .rec:focus-within .ph .link{opacity:1}
@media (hover:none){#pv .rec .ph .link{opacity:1}}
#pv .rlist{display:flex;flex-direction:column}
#pv .rr{display:grid;align-items:center;gap:12px;padding:calc(9px*var(--c-density)) 2px;border-top:1px solid var(--line)}
#pv .rr:first-child,#pv .dayh+.rr{border-top:0}
#pv .rr.cur{grid-template-columns:50px minmax(0,1fr) auto}
#pv .rr.av{grid-template-columns:34px minmax(0,1fr) auto}
#pv .rr.dy{grid-template-columns:minmax(0,1fr) auto}
#pv .rd{color:var(--tx3);font-size:12.5px;white-space:nowrap}
#pv .rn{min-width:0;display:grid;gap:2px}
#pv .rn b{font-weight:500;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .rn span{font-size:11.5px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .amt{font-weight:600;font-size:13.5px;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
#pv .ra{display:grid;justify-items:end;gap:2px}
#pv .ra span{font-size:11.5px;color:var(--tx3)}
#pv .ini{width:34px;height:34px;border-radius:50%;background:var(--raised);border:1px solid var(--line);display:grid;place-items:center;font-weight:600;color:var(--tx2);font-size:13px}
#pv .dayh{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);padding:12px 2px 4px;border-top:1px solid var(--line)}
#pv .dayh:first-child{border-top:0;padding-top:0}
/* Budget card */
#pv .bud{padding:0;container-type:inline-size}
#pv .bud>.ph{padding:var(--p) calc(var(--p)*1.25);margin:0;border-bottom:1px solid var(--line)}
#pv .bud-in{display:grid;grid-template-columns:minmax(0,1fr)}
#pv .bud.has-side .bud-in{grid-template-columns:minmax(0,1fr) minmax(260px,34%)}
#pv .br{display:grid;grid-template-columns:minmax(96px,150px) minmax(0,1fr) 104px 84px;align-items:center;gap:14px;padding:calc(8px*var(--c-density)) calc(var(--p)*1.25);border-bottom:1px solid var(--line)}
#pv .br[data-cat]{cursor:pointer}
#pv .br[data-cat]:hover{background:var(--raised)}
#pv .br.on{background:var(--ac-soft)}
#pv .br.head{background:var(--raised);padding-top:8px;padding-bottom:8px}
#pv .br.head .bc,#pv .br.head button{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);display:flex;justify-content:flex-end;gap:3px}
#pv .br.head .bc{justify-content:flex-start}
#pv .br.head button.l{justify-content:flex-start}
#pv .br.head button.on{color:var(--tx)}
#pv .br.head button i{font-style:normal;opacity:.45}#pv .br.head button.on i{opacity:1}
#pv .br.tot{background:var(--raised);border-bottom-width:2px}
#pv .br.tot .bc,#pv .br.tot .ba{font-weight:700}
#pv .bc{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .ba{text-align:right;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
#pv .bb{text-align:right;font-size:13px;color:var(--tx2);font-variant-numeric:tabular-nums}
#pv .bt{position:relative;height:24px;border-radius:6px;overflow:hidden;background:var(--line);border:1px solid var(--line);display:flex;align-items:center;justify-content:flex-end;padding:0 8px}
#pv .bt i{position:absolute;left:0;top:0;bottom:0;opacity:var(--c-fill,.35);background:var(--b-ok)}
#pv .bt.near i{background:var(--b-near);opacity:min(1,calc(var(--c-fill,.35) + .08))}
#pv .bt.over i{background:var(--b-over);opacity:min(1,calc(var(--c-fill,.35) + .12))}
#pv .bt>span.inv{color:#fff}
#pv .bt s{position:absolute;top:0;bottom:0;width:1px;background:rgba(15,23,42,.16)}
#pv .bt>span{position:relative;font-size:10.5px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums}
#pv .bt>span.bad{color:var(--bad)}
#pv .bt>span.mut{font-weight:500;font-size:9.5px}
#pv[data-barColor=solid] .bt i{opacity:.2}
#pv[data-barColor=solid] .bt.near i{opacity:.45}
#pv[data-barColor=solid] .bt.over i{background:#DC2626;opacity:.92}
#pv[data-barColor=solid] .bt.over>span{color:#fff}
#pv[data-barColor=quiet] .bt.ok i{background:var(--tx3);opacity:.22}
#pv[data-barColor=quiet] .bt.near i{opacity:.5}
#pv[data-barColor=quiet] .bt.over i{opacity:.55}
#pv .bleg{display:flex;gap:16px;flex-wrap:wrap;padding:12px calc(var(--p)*1.25) 14px;font-size:10.5px;color:var(--tx3)}
#pv .bleg span{display:inline-flex;align-items:center;gap:5px}
#pv .bleg i{width:7px;height:7px;border-radius:50%;display:inline-block;background:var(--b-ok)}
#pv .bleg .k-near{background:var(--b-near)}#pv .bleg .k-over{background:var(--b-over)}#pv .bleg .k-none{background:var(--tx3)}
#pv .bleg .k-q{width:1px;height:9px;border-radius:0;background:rgba(15,23,42,.3)}
#pv[data-barColor=quiet] .bleg .k-ok{background:var(--tx3);opacity:.5}
#pv .showall{display:block;padding:12px calc(var(--p)*1.25);text-align:left;border-bottom:1px solid var(--line);width:100%}
#pv .bg-h{display:flex;gap:8px;align-items:center;padding:14px calc(var(--p)*1.25) 6px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--tx2);border-bottom:1px solid var(--line)}
#pv .bg-h span{color:var(--tx3);font-weight:500}
#pv .btot{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:var(--p) calc(var(--p)*1.25) 4px}
#pv .btot span:first-child{font-size:12.5px;color:var(--tx2)}
#pv .btot .val{font-size:22px}
#pv .btiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:var(--gap);padding:var(--gap) calc(var(--p)*1.25) calc(var(--p)*1.25)}
#pv .bti{padding:12px;border:1px solid var(--line);border-radius:calc(var(--c-radius)*.75);display:grid;gap:7px;cursor:pointer;background:var(--surface)}
#pv .bti:hover{border-color:color-mix(in srgb,var(--ac) 40%,var(--line))}
#pv .bti.on{border-color:var(--ac);background:var(--ac-soft)}
#pv .bti-h{display:flex;justify-content:space-between;gap:8px}
#pv .bti-h b{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .btiles .det-inline{grid-column:1/-1}
/* Category detail */
#pv .det-h{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px calc(var(--p)*1.25);border-bottom:1px solid var(--line)}
#pv .det-h>div{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
#pv .det-h b{font-size:15px;font-weight:600}
#pv .x{width:28px;height:28px;border-radius:7px;color:var(--tx2)}
#pv .x:hover{background:var(--raised)}
#pv .det-l{max-height:380px;overflow-y:auto}
#pv .dr{display:grid;grid-template-columns:50px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px calc(var(--p)*1.25);border-bottom:1px solid var(--line)}
#pv .more{padding:11px calc(var(--p)*1.25)}
#pv .pad{padding:20px}
#pv .det-below{padding:0;overflow:hidden}
#pv .det-inline{background:var(--raised);border-bottom:1px solid var(--line);box-shadow:inset 3px 0 0 var(--ac)}
#pv .btiles .det-inline{border:1px solid var(--line);border-radius:calc(var(--c-radius)*.75);overflow:hidden}
#pv .det-side{border-left:1px solid var(--line);min-width:0;background:var(--raised)}
#pv .det-side .dr{grid-template-columns:44px minmax(0,1fr) auto}
@container (max-width:760px){
  #pv .bud.has-side .bud-in{grid-template-columns:minmax(0,1fr)}
  #pv .det-side{border-left:0;border-top:1px solid var(--line)}
  #pv .br{grid-template-columns:minmax(80px,120px) minmax(0,1fr) 92px 70px;gap:10px}
}
@container (max-width:520px){
  #pv .br{grid-template-columns:minmax(0,1fr) 88px;gap:4px 10px}
  #pv .br .bt{grid-column:1/-1;grid-row:2}
  #pv .br .bb{display:none}
  #pv .br.head{display:none}
}
/* Net worth and rewards */
#pv .nw-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:-4px 0 8px}
#pv .nw-top .val{font-size:24px}
#pv .nw-top span{font-size:12px;font-weight:500}
#pv .bk{display:grid;gap:9px}
#pv .bk-r{display:grid;grid-template-columns:minmax(90px,120px) minmax(0,1fr) 72px;gap:10px;align-items:center;font-size:12.5px}
#pv .bk-r span{color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .bk-r b{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
#pv .bk-t{height:10px;border-radius:5px;background:var(--raised);overflow:hidden}
#pv .bk-t i{display:block;height:100%;border-radius:5px;background:color-mix(in srgb,var(--ac) 55%,transparent)}
#pv .bk-t i.neg{background:color-mix(in srgb,var(--bad) 45%,transparent)}
#pv .pts-t{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px 12px}
#pv .pt{display:grid;gap:6px;padding:10px;border:1px solid var(--line);border-radius:calc(var(--c-radius)*.7)}
#pv .pt .val{font-size:16px}
#pv .lg{display:flex;align-items:center;height:24px;min-width:0}
#pv .lg img{height:100%;width:auto;max-width:100%;object-fit:contain;object-position:left center;display:block}
#pv .mono{font-size:12px;font-weight:600;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .pts-l{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));column-gap:28px}
#pv .pr{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}
#pv .pr .val{font-size:15px;text-align:right}
#pv .pr>span:last-child{font-size:11.5px;width:96px;text-align:right}
#pv .pts-l+.link{margin-top:10px;align-self:flex-start}
/* Layouts */
#pv .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap)}
#pv .three{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--gap)}
#pv .mas{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:var(--gap);align-items:start}
#pv .railg{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:var(--gap);align-items:start}
#pv .col{display:grid;gap:var(--gap);align-content:start;min-width:0}
#pv .rail .kpis-cards,#pv .rail .kpis-strip{grid-template-columns:repeat(2,minmax(0,1fr))}
#pv .rail .kpis-strip .kv{border-top:1px solid var(--line);margin-top:-1px}
#pv .rail .kpis-cards .cell:nth-child(2),#pv .rail .kpis-strip .kv:nth-child(2){grid-column:span 1}
#pv .rail .kpis-cards .cell:first-child{grid-column:1/-1}
#pv .rail .kpis-strip .kv:first-child{grid-column:1/-1}
#pv .rail .kpis-hero,#pv .rail .kpis-groups{grid-template-columns:minmax(0,1fr)}
#pv .rail .kn{font-size:20px}
#pv .rail .hero .kn{font-size:30px}
@container pv (max-width:1050px){
  #pv .railg{grid-template-columns:minmax(0,1fr) 300px}
  #pv .kpis-hero,#pv .kpis-groups{grid-template-columns:minmax(0,1fr)}
}
@container pv (max-width:860px){
  #pv .two,#pv .mas,#pv .railg{grid-template-columns:minmax(0,1fr)}
  #pv .main{padding:16px}
  #pv .rail .kpis-cards,#pv .rail .kpis-strip{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
  #pv .rail .kpis-cards .cell:first-child,#pv .rail .kpis-strip .kv:first-child{grid-column:auto}
}
/* Round 2: bar palettes */
#pv[data-barPalette=teal]{--b-ok:#0D9488;--b-near:#F59E0B;--b-over:#EA580C}
#pv[data-barPalette=violet]{--b-ok:#7C3AED;--b-near:#F59E0B;--b-over:#DC2626}
#pv[data-barPalette=traffic]{--b-ok:#16A34A;--b-near:#EAB308;--b-over:#DC2626}
#pv[data-barPalette=teal] .bt>span.bad{color:#C2410C}
/* Round 2: flow of panels */
#pv .flow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap);grid-auto-flow:row dense}
#pv[data-cols=three] .flow{grid-template-columns:repeat(3,minmax(0,1fr))}
#pv .flow>.wide{grid-column:1/-1}
#pv .flow:empty{display:none}
#pv .panel{container-type:inline-size}
#pv .warn{color:var(--warn)}
/* Insights */
#pv .ins-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--gap)}
#pv .ins-card{padding:var(--p);display:grid;gap:6px;align-content:start}
#pv .ins-card .val{font-size:24px;font-weight:600}
#pv .ins-card span{font-size:13px;color:var(--tx2);line-height:1.45}
#pv .ins-l{list-style:none;margin:0;padding:0;display:grid;gap:11px}
#pv .ins-l li{display:grid;grid-template-columns:86px minmax(0,1fr);gap:14px;align-items:baseline;font-size:13.5px;color:var(--tx2)}
#pv .ins-l b{font-family:var(--f-h);font-size:17px;font-weight:600;text-align:right}
#pv .ins-c{display:flex;gap:10px;overflow-x:auto;scrollbar-width:thin;padding-bottom:4px}
#pv .chip-i{flex:none;display:flex;gap:9px;align-items:center;max-width:380px;padding:8px 14px;border:1px solid var(--line);border-radius:99px;background:var(--surface)}
#pv .chip-i b{font-family:var(--f-h);font-weight:600;white-space:nowrap}
#pv .chip-i span{font-size:12.5px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Month pace */
#pv .pace-h{font-size:16px;font-weight:500;margin:0 0 3px;font-family:var(--f-h)}
#pv .pace-h b{font-weight:600}
#pv .pace-s{font-size:12px;color:var(--tx3);margin:0 0 6px}
#pv .pt-track{position:relative;height:28px;border-radius:8px;background:var(--raised);border:1px solid var(--line);margin:30px 0 26px}
#pv .pt-fill{position:absolute;left:0;top:0;bottom:0;border-radius:7px 0 0 7px;background:color-mix(in srgb,var(--ac) 38%,transparent)}
#pv .pt-fill.over{background:color-mix(in srgb,var(--b-over) 42%,transparent)}
#pv .pt-proj{position:absolute;top:0;bottom:0;border:1.5px dashed color-mix(in srgb,var(--ac) 60%,transparent);border-left:0;border-radius:0 7px 7px 0}
#pv .pt-mk{position:absolute;top:-6px;bottom:-6px;width:2px;margin-left:-1px;background:var(--tx)}
#pv .pt-mk span{position:absolute;top:calc(100% + 3px);left:50%;transform:translateX(-50%);font-size:10.5px;color:var(--tx2);white-space:nowrap;font-style:normal}
#pv .pt-mk.today{background:var(--ac)}
#pv .pt-mk.today span{top:auto;bottom:calc(100% + 3px);color:var(--ac)}
#pv .pace-n{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:10px}
#pv .pace-n>div{display:grid;gap:3px;padding:12px;border:1px solid var(--line);border-radius:calc(var(--c-radius)*.7)}
#pv .pace-n .val{font-size:19px;white-space:nowrap}
#pv .gauge{width:100%;max-width:300px;margin:4px auto 0;display:block}
#pv .g-bg{fill:none;stroke:var(--raised);stroke-width:18}
#pv .g-fg{fill:none;stroke:color-mix(in srgb,var(--ac) 70%,transparent);stroke-width:18}
#pv .g-fg.over{stroke:color-mix(in srgb,var(--b-over) 70%,transparent)}
#pv .g-tk{stroke:var(--tx);stroke-width:2}
#pv .g-td{stroke:var(--ac);stroke-width:2;stroke-dasharray:3 2}
#pv .g-v{font-family:var(--f-h);font-size:26px;font-weight:600;fill:var(--tx)}
#pv .g-v.sm{font-size:17px}
/* Where the money went */
#pv .wh{display:grid;grid-template-columns:150px minmax(0,1fr);gap:18px;align-items:center}
#pv .donut{width:150px;height:150px;display:block}
#pv .wl{display:grid;gap:7px;min-width:0}
#pv .wl-r{display:grid;grid-template-columns:10px minmax(0,1fr) 40px 88px;gap:8px;align-items:center;font-size:12.5px}
#pv .wl-r i{width:10px;height:10px;border-radius:3px}
#pv .wl-r span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .wl-r em,#pv .wrank-r em{font-style:normal;color:var(--tx3);text-align:right;font-variant-numeric:tabular-nums}
#pv .wl-r b,#pv .wrank-r b{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
#pv .wbar{display:flex;height:22px;border-radius:6px;overflow:hidden;margin:4px 0 14px;gap:2px}
#pv .wbar i{display:block;height:100%}
#pv .wrank{display:grid;gap:10px}
#pv .wrank-r{display:grid;grid-template-columns:minmax(80px,130px) minmax(0,1fr) 40px 88px;gap:10px;align-items:center;font-size:12.5px}
#pv .wrank-r span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .wrank-t{height:10px;border-radius:5px;background:var(--raised);overflow:hidden}
#pv .wrank-t i{display:block;height:100%;border-radius:5px}
@container (max-width:430px){#pv .wh{grid-template-columns:minmax(0,1fr);justify-items:center}#pv .wh .wl{width:100%}}
/* Biggest changes */
#pv .mv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
#pv .mv h3{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px;color:var(--tx3)}
#pv .mv-r{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;padding:8px 0;border-bottom:1px solid var(--line)}
#pv .mv-r:last-child{border-bottom:0}
#pv .mv-r b{font-weight:500;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .mv-r em{font-style:normal;font-weight:600;font-size:13px;font-variant-numeric:tabular-nums}
#pv .mv-r span{grid-column:1/-1;font-size:11px;color:var(--tx3)}
#pv .dv{display:grid;gap:9px}
#pv .dv-r{display:grid;grid-template-columns:minmax(80px,120px) minmax(0,1fr) 62px;gap:10px;align-items:center;font-size:12.5px}
#pv .dv-r span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .dv-r b{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
#pv .dv-t{position:relative;height:14px}
#pv .dv-t:before{content:'';position:absolute;left:50%;top:-4px;bottom:-4px;width:1px;background:var(--line)}
#pv .dv-t i{position:absolute;top:0;bottom:0}
#pv .dv-t i.up{left:50%;border-radius:0 3px 3px 0;background:color-mix(in srgb,var(--bad) 55%,transparent)}
#pv .dv-t i.dn{right:50%;border-radius:3px 0 0 3px;background:color-mix(in srgb,var(--good) 55%,transparent)}
#pv .dv-l{display:grid;grid-template-columns:minmax(80px,120px) 1fr 1fr 62px;gap:0 10px;font-size:10.5px;color:var(--tx3);margin-top:6px}
#pv .dv-l span:first-child{grid-column:2;text-align:right;padding-right:8px}
#pv .dv-l span:last-child{grid-column:3;padding-left:8px}
@container (max-width:380px){#pv .mv{grid-template-columns:minmax(0,1fr)}}
/* Merchants */
#pv .mlist{display:grid}
#pv .mrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:9px 0;border-bottom:1px solid var(--line)}
#pv .mrow:last-child{border-bottom:0}
#pv .mbar{grid-column:1/-1;height:5px;border-radius:3px;background:var(--raised);overflow:hidden}
#pv .mbar i{display:block;height:100%;background:color-mix(in srgb,var(--ac) 55%,transparent)}
/* Savings rate and cash cushion */
#pv .sv-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
#pv .sv-top .val{font-size:30px;font-weight:600}
#pv .sv{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:12px}
#pv .sv-c{display:grid;grid-template-rows:56px 56px auto auto;justify-items:center}
#pv .sv-c .up{display:flex;align-items:flex-end;justify-content:center;width:100%;border-bottom:1px solid var(--line)}
#pv .sv-c .dn{display:flex;align-items:flex-start;justify-content:center;width:100%}
#pv .sv-c i{display:block;width:60%;max-width:34px}
#pv .sv-c .pos{background:color-mix(in srgb,var(--good) 40%,transparent);border-radius:4px 4px 0 0}
#pv .sv-c .neg{background:color-mix(in srgb,var(--bad) 35%,transparent);border-radius:0 0 4px 4px}
#pv .sv-c.on .pos{background:var(--good)}#pv .sv-c.on .neg{background:var(--bad)}
#pv .sv-c small{font-size:10.5px;color:var(--tx3);margin-top:4px}
#pv .sv-c.on small{color:var(--tx);font-weight:600}
#pv .sv-c em{font-style:normal;font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums}
#pv .cu-cells{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;margin:16px 0 6px}
#pv .cu-cells i{display:block;height:26px;border-radius:6px;background:var(--raised);border:1px solid var(--line);position:relative;overflow:hidden}
#pv .cu-cells b{position:absolute;left:0;top:0;bottom:0;background:color-mix(in srgb,var(--ac) 45%,transparent)}
#pv .cu-l{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));font-size:10.5px;color:var(--tx3)}
#pv .cu-l span:nth-child(2){grid-column:3}#pv .cu-l span:nth-child(3){grid-column:6}
#pv .cu-n{margin:12px 0 0;line-height:1.5}
/* Spending by day */
#pv .wnote{margin:12px 0 0;line-height:1.5}
#pv .cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
#pv .cal .wd{font-size:10px;color:var(--tx3);text-align:center;font-weight:600;padding-bottom:2px}
#pv .cal .dc{aspect-ratio:1.3;border-radius:6px;padding:4px 5px;display:flex;flex-direction:column;justify-content:space-between;font-size:10px;border:1px solid var(--line);min-width:0;overflow:hidden}
#pv .cal .dc em{font-style:normal;color:var(--tx3)}
#pv .cal .dc b{font-weight:600;font-size:10.5px;text-align:right;white-space:nowrap}
#pv .cal .dc.hot em,#pv .cal .dc.hot b{color:#fff}
#pv .cal .dc.fut{opacity:.45;border-style:dashed}
#pv .cal .dc.blank{border:0}
@container pv (max-width:1150px){#pv[data-cols=three] .flow{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container pv (max-width:860px){#pv .flow,#pv[data-cols=three] .flow{grid-template-columns:minmax(0,1fr)}}
/* Round 3: arrangements */
#pv[data-arr=twoone] .flow>.p-ins,#pv[data-arr=twoone] .flow>.p-trend{grid-column:span 2}
#pv .split{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:var(--gap);align-items:start}
#pv .split>.col{display:grid;gap:var(--gap);align-content:start;min-width:0}
@container pv (max-width:1150px){#pv[data-arr=twoone] .flow>.p-ins,#pv[data-arr=twoone] .flow>.p-trend{grid-column:1/-1}}
@container pv (max-width:960px){#pv .split{grid-template-columns:minmax(0,1fr)}}
@container pv (max-width:860px){#pv .flow>*{grid-column:1/-1}}
/* Round 3: insight looks */
#pv .ins-l.lk-two{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 32px}
@container (max-width:640px){#pv .ins-l.lk-two{grid-template-columns:minmax(0,1fr)}}
#pv .ins-l.lk-tone{gap:8px}
#pv .ins-l.lk-tone li{padding:9px 12px 9px 0;border-radius:calc(var(--c-radius)*.6);border-left:3px solid var(--line);background:var(--raised)}
#pv .ins-l.lk-tone li.tn-bad{border-left-color:var(--bad);background:color-mix(in srgb,var(--bad) 7%,var(--surface))}
#pv .ins-l.lk-tone li.tn-warn{border-left-color:var(--warn);background:color-mix(in srgb,var(--warn) 8%,var(--surface))}
#pv .ins-l.lk-tone li.tn-good{border-left-color:var(--good);background:color-mix(in srgb,var(--good) 7%,var(--surface))}
#pv .ins-lead{margin:0 0 14px;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;font-family:var(--f-h);font-size:20px;line-height:1.35;color:var(--tx)}
#pv .ins-lead b{font-size:28px;font-weight:600;white-space:nowrap}
#pv .ins-lead span{flex:1 1 260px;min-width:0}
#pv .ins-l.sm{padding-top:12px;border-top:1px solid var(--line);gap:8px}
#pv .ins-l.sm li{font-size:12.5px}
#pv .ins-l.sm b{font-size:14px}
/* Round 3: gauge variants */
#pv .g-pr{fill:none;stroke:color-mix(in srgb,var(--ac) 24%,transparent);stroke-width:18}
#pv .g-pr.over{stroke:color-mix(in srgb,var(--b-over) 26%,transparent)}
#pv .g-z{fill:none;stroke-width:18}
#pv .g-z.ok{stroke:color-mix(in srgb,var(--b-ok) 42%,transparent)}
#pv .g-z.near{stroke:color-mix(in srgb,var(--b-near) 55%,transparent)}
#pv .g-z.over{stroke:color-mix(in srgb,var(--b-over) 50%,transparent)}
#pv .g-nd{stroke:var(--tx);stroke-width:3;stroke-linecap:round}
#pv .g-pv{fill:var(--tx)}
#pv .g-v.bad{fill:var(--bad)}
#pv .g-note{margin:6px 0 0;text-align:center}
/* Round 3: where the money went */
#pv .wbar{margin:4px 0 14px}
#pv .wb2{display:grid;gap:8px;margin:4px 0 6px}
/* 2026-11-07: pace, chart and where level with each other */
#pv[data-arr=pacefirst] .p-trend .chart{position:relative;flex:1 1 0;min-height:200px}
#pv[data-arr=pacefirst] .p-trend .chart svg{position:absolute;left:0;top:0}
#pv[data-arr=pacefirst] .p-pace .gauge{margin:auto}
#pv[data-arr=pacefirst] .p-where .wb2{margin-bottom:14px}
#pv[data-arr=pacefirst] .p-where .wnote{margin:auto 0 0;padding-top:12px}
#pv .wb-r{display:grid;grid-template-columns:30px minmax(0,1fr) 44px;gap:10px;align-items:center;font-size:12px}
#pv .wb-r span{color:var(--tx2);font-weight:600}
#pv .wb-r b{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
#pv .wb-r .wbar{margin:0}
#pv .wb-r.prev{opacity:.75}
#pv .wb-r.prev span,#pv .wb-r.prev b{color:var(--tx3);font-weight:500}
#pv .wb-n{margin:0 0 14px}
#pv .wchips{display:flex;flex-wrap:wrap;gap:6px}
#pv .wc{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--line);border-radius:99px;font-size:12px;white-space:nowrap}
#pv .wc i,#pv .wtop i,#pv .wrest i{display:inline-block;width:9px;height:9px;border-radius:3px;flex:none}
#pv .wc em{font-style:normal;color:var(--tx3);font-variant-numeric:tabular-nums}
#pv .wtop{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
#pv .wtop>div{display:grid;gap:2px;min-width:0}
#pv .wtop span{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .wtop .val{font-size:21px;font-weight:600}
#pv .wtop em{font-style:normal;font-size:11.5px;color:var(--tx3)}
#pv .wrest{margin:12px 0 0;font-size:12px;color:var(--tx2);line-height:1.8}
#pv .wrest span{white-space:nowrap}
#pv .wrest i{margin-right:5px;vertical-align:0}
/* Round 3: chart guide lines */
#pv .ln-avg{stroke:var(--tx3);stroke-width:1.4;stroke-dasharray:1 4;stroke-linecap:round}
#pv .tl.avg{fill:var(--tx3);font-weight:500}
#pv path.ln-bud{fill:none}
/* Round 4: top-level categories */
#pv .bti-k{font-size:11px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .btiles.in{grid-template-columns:repeat(auto-fill,minmax(250px,1fr));align-items:start}
#pv .bk2s{display:grid;gap:2px;margin-top:4px;padding-top:8px;border-top:1px solid var(--line)}
#pv .bk2{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:2px 8px;align-items:baseline;padding:5px 6px;margin:0 -6px;border-radius:7px;font-size:12px}
#pv .bk2:hover{background:var(--raised)}
#pv .bk2.on{background:var(--ac-soft)}
#pv .bk2 span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tx2)}
#pv .bk2 b{font-weight:600;font-variant-numeric:tabular-nums}
#pv .bk2 small{font-size:10.5px;color:var(--tx3);white-space:nowrap}
#pv .bk2-t{grid-column:1/-1;height:4px;border-radius:2px;background:var(--line);overflow:hidden;display:block}
#pv .bk2-t em{display:block;height:100%;background:var(--b-ok);opacity:calc(var(--c-fill,.35) + .25)}
#pv .bk2-t.near em{background:var(--b-near)}
#pv .bk2-t.over em{background:var(--b-over)}
#pv .bsecs{display:grid;gap:calc(var(--gap)*1.4);padding:var(--gap) calc(var(--p)*1.25) calc(var(--p)*1.25)}
#pv .bsec-h{display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr) minmax(130px,auto);gap:4px 14px;align-items:center;padding:8px 10px;margin:0 -10px;border-radius:calc(var(--c-radius)*.6);cursor:pointer}
#pv .bsec-h:hover{background:var(--raised)}
#pv .bsec-h.on{background:var(--ac-soft)}
#pv .bsec-h>b{font-family:var(--f-h);font-size:15px;font-weight:600}
#pv .bsec-h>.ba{text-align:right}
#pv .bsec-h>.mut{grid-column:2}
#pv .btiles.sub{padding:8px 0 0 14px;margin-left:4px;border-left:2px solid var(--line);grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
#pv .det-k{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px calc(var(--p)*1.25);border-bottom:1px solid var(--line);font-size:12px;color:var(--tx3);background:var(--raised)}
#pv .det-k b{color:var(--tx);font-weight:600}
#pv .det-k em{font-style:normal;font-weight:600;color:var(--tx2);font-variant-numeric:tabular-nums}
#pv .det-k em.bad{color:var(--bad)}#pv .det-k em.good{color:var(--good)}
`
});
})();
