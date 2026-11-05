// Design gallery spec: the transactions table on the individual Card page, desktop.
// Content comes from the data file; this file holds no personal figures.
// The rest of the Card page (look, banner, side column) was approved in
// docs/cards-card-design.md and is drawn here only as context.
(function(){
const NAV=['Dashboard','Transactions','Budgets','Net Worth','Daily Balances','Cash Flow','Loans','GCB','Cards','Accounts','Settings'];
const GRAD={'Chase UR':'#1e40af,#0f2a5f','Amex MR':'#0a2f6b,#2563eb','Hilton Honors':'#4c1d95,#2e1065'};
const HUE={Groceries:'#0D9488',Dining:'#EA580C',Transportation:'#0284C7',Travel:'#7C3AED','Health & Wellness':'#16A34A',Housing:'#475569',Shopping:'#DB2777',Financial:'#64748B',Entertainment:'#9333EA',Family:'#D97706',Vehicle:'#A16207',Business:'#4F46E5',Other:'#78716C',Work:'#15803D',Unclassified:'#CBD5E1',Transfer:'#94A3B8'};
const KIND={purchase:'Purchase',refund:'Refund',credit:'Credit',fee:'Fee',interest:'Interest',payment:'Payment',p2p:'P2P',adjustment:'Adjustment'};
const KINDS_PL={credit:'Credits',fee:'Fees',interest:'Interest',payment:'Payments',p2p:'P2P',adjustment:'Adjustments'};
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
const FIRST='2026-06-01';   // the preview data starts here
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'#2563EB','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,#2563EB 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C'});

// Preview state that survives re-renders. Edits stay on this page.
const S={};
function resetS(){Object.assign(S,{q:'',pq:'',f:{ycat:null,mcat:null,brand:null,sp:null,kind:null},fd:null,chip:'',top:'',sub:'',unk:false,
  r:null,sort:null,dir:'desc',sel:new Set(),pop:null,ed:{},exp:new Set(),spx:new Set(),coll:null,all:false,modal:null,bd:null})}
resetS();
let L=null,PAR={},TODAY='2026-11-05';

/* ── Helpers ─────────────────────────────────────────────── */
const pad=n=>String(n).padStart(2,'0');
const dt=s=>new Date(s+'T12:00:00');
const iso=x=>`${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
const md=s=>{const x=dt(s);return `${MON[x.getMonth()]} ${x.getDate()}`};
const money=n=>'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const m0=n=>'$'+Math.round(Math.abs(n||0)).toLocaleString('en-US');
const f0=n=>Math.round(n||0).toLocaleString('en-US');
const esc=s=>L.h.esc(s==null?'':String(s));
const topOf=c=>PAR[c]||c;
const catPath=c=>c?(PAR[c]?`${PAR[c]} › ${c}`:c):'—';
const hue=c=>HUE[topOf(c)]||'#94A3B8';
const rateTxt=r=>r?`${Math.round(r*100)/100}x`:'';
const ptsSpan=v=>v<0?`<span class="neg">−${f0(-v)}</span>`:v>0?`<span class="up">+${f0(v)}</span>`:'<span class="dim">0</span>';
function groupCats(){const G=[],by={};L.d.cats.forEach(c=>{if(!c.p){const g={top:c.n,kids:[]};G.push(g);by[c.n]=g}});L.d.cats.forEach(c=>{if(c.p&&by[c.p])by[c.p].kids.push(c.n)});return G}
function mcatTree(){const M=L.d.mparent,G=[],by={};Object.keys(M).forEach(n=>{if(!M[n]){const g={top:n,kids:[]};G.push(g);by[n]=g}});Object.keys(M).forEach(n=>{if(M[n]&&by[M[n]])by[M[n]].kids.push(n)});G.sort((a,b)=>a.top.localeCompare(b.top));G.forEach(g=>g.kids.sort());return G}

/* ── Statement periods ───────────────────────────────────── */
const closeOn=(y,m,day)=>new Date(y,m,Math.min(day,new Date(y,m+1,0).getDate()),12);
function stmtOf(d,close){const x=dt(d);let end=closeOn(x.getFullYear(),x.getMonth(),close);if(x>end)end=closeOn(x.getFullYear(),x.getMonth()+1,close);
  const prev=closeOn(end.getFullYear(),end.getMonth()-1,close),start=new Date(prev);start.setDate(prev.getDate()+1);return {s:iso(start),e:iso(end)}}
function stmtStep(k,close){const cur=stmtOf(TODAY,close),e=dt(cur.e);return stmtOf(iso(closeOn(e.getFullYear(),e.getMonth()+k,close)),close)}
function dueOf(e,due){const x=dt(e);let d=closeOn(x.getFullYear(),x.getMonth(),due);if(d<=x)d=closeOn(x.getFullYear(),x.getMonth()+1,due);return iso(d)}

/* ── Period ──────────────────────────────────────────────── */
function defPeriod(p){return p.period==='stmt'?{mode:'stmt',off:0}:p.period==='ymd'?{mode:'ym',y:'2026',m:'11'}:{mode:'ytd',off:0}}
function rangeOf(c){const r=S.r,t=dt(TODAY);
  if(r.mode==='month'){const x=new Date(t.getFullYear(),t.getMonth()+r.off,1,12),e=new Date(x.getFullYear(),x.getMonth()+1,0,12);return [iso(x),iso(e)<TODAY?iso(e):TODAY,`${MONL[x.getMonth()]} ${x.getFullYear()}`]}
  if(r.mode==='qtd'){const q=Math.floor(t.getMonth()/3)+r.off,x=new Date(t.getFullYear(),q*3,1,12),e=new Date(x.getFullYear(),x.getMonth()+3,0,12);return [iso(x),iso(e)<TODAY?iso(e):TODAY,`Q${Math.floor(x.getMonth()/3)+1} ${x.getFullYear()}`]}
  if(r.mode==='ytd')return ['2026-01-01',TODAY,'2026 to date'];
  if(r.mode==='stmt'){const s=stmtStep(r.off,c.close);return [s.s,s.e,`${md(s.s)} – ${md(s.e)}`]}
  if(r.mode==='ym'){if(!r.y)return [FIRST,TODAY,'All dates'];if(!r.m)return [`${r.y}-01-01`,`${r.y}-12-31`<TODAY?`${r.y}-12-31`:TODAY,r.y];
    const e=iso(new Date(+r.y,+r.m,0,12));return [`${r.y}-${pad(+r.m)}-01`,e<TODAY?e:TODAY,`${MONL[+r.m-1]} ${r.y}`]}
  const a=r.from||FIRST,b=r.to||TODAY;return [a,b,`${md(a)} – ${md(b)}`]}

/* ── Rows ────────────────────────────────────────────────── */
function view(r,p){const nw=p.data==='new',w=r.w,o=r.o,ed=S.ed[r.id]||{};let kind,mc,mtop,brand,pts,rate;
  if(nw){kind=w.k;mc=w.c;mtop=w.t;brand=w.b;pts=w.p;rate=w.r}
  else{kind=r.act==='Transfer'?'payment':r.amt>0?(o.k==='clawback'?'refund':'credit'):(r.cat==='Fees & Interest'?'fee':'purchase');mc=o.c;mtop=null;brand=null;pts=o.p;rate=o.r}
  if(ed.mc){mc=ed.mc;mtop=L.d.mparent[ed.mc]||null}
  const exc='exc' in ed?ed.exc:!!r.exc;
  const t={id:r.id,d:r.d,n:r.n,raw:r.raw,amt:r.amt,act:r.act,cat:ed.cat||r.cat,man:ed.cat?1:r.man,sp:'sp' in ed?ed.sp:(r.sp||''),note:ed.note!=null?ed.note:'',
    spl:r.spl,exc,link:r.link,kind,mc,mtop,brand,pts:exc?0:pts,rate:exc?0:rate,demo:r.id===8720};
  t.earn=kind==='purchase'||kind==='refund';t.unk=t.earn&&!mc;return t}
function cardRows(c,p){let R=c.rows;if(p.splitDemo)R=R.concat([L.d.splitDemo]).sort((a,b)=>a.d<b.d?1:a.d>b.d?-1:b.id-a.id);return R.map(r=>view(r,p))}
function scoped(c,p){const[a,b]=rangeOf(c);let R=cardRows(c,p).filter(t=>t.d>=a&&t.d<=b);if(p.payments==='hide')R=R.filter(t=>t.kind!=='payment');if(p.emptyDemo)R=[];
  let pend=[];if(p.pending==='top'&&R[0]&&R[0].d>=TODAY.slice(0,8)+'01'){const i=R.findIndex(t=>t.kind==='purchase');if(i>=0){pend=[R[i]];R=R.slice(0,i).concat(R.slice(i+1))}}return {R,pend}}
function matches(t){if(S.q){const n=S.q.toLowerCase();if(![t.n,t.raw,t.brand,t.mc,t.cat,t.note].some(x=>x&&String(x).toLowerCase().includes(n)))return false}
  const F=S.f;if(F.ycat&&!(F.ycat.has(t.cat)||F.ycat.has(PAR[t.cat])))return false;
  if(F.mcat&&!F.mcat.has(t.earn?(t.mc||'__none__'):'__k:'+t.kind))return false;
  if(F.brand&&!F.brand.has(t.brand||'__none__'))return false;if(F.sp&&!F.sp.has(t.sp||'__none__'))return false;if(F.kind&&!F.kind.has(t.kind))return false;
  if(S.chip&&(S.chip==='__none__'?!t.unk:t.mc!==S.chip))return false;if(S.top&&topOf(t.cat)!==S.top)return false;if(S.sub&&t.cat!==S.sub)return false;
  if(S.unk&&!t.unk)return false;return true}
const anyFilter=()=>S.q||S.chip||S.top||S.unk||Object.values(S.f).some(Boolean);
const SORTV={d:t=>t.d,n:t=>t.n.toLowerCase(),cat:t=>catPath(t.cat),mc:t=>t.mc||'~',brand:t=>t.brand||'~',sp:t=>t.sp||'~',kind:t=>t.kind,rate:t=>t.rate||0,pts:t=>t.pts,amt:t=>-t.amt};
function sorted(R){if(!S.sort)return R;const f=SORTV[S.sort],k=S.dir==='asc'?1:-1;return R.slice().sort((a,b)=>{const x=f(a),y=f(b);return x<y?-k:x>y?k:0})}
function totalsOf(R){let spend=0,cred=0,pts=0,unk=0;R.forEach(t=>{if(t.kind==='payment')return;if(t.amt<0&&!t.exc)spend-=t.amt;if(t.amt>0)cred+=t.amt;pts+=t.pts;if(t.unk)unk++});return {n:R.length,spend,cred,pts,unk}}

/* ── Grouping ────────────────────────────────────────────── */
function groupsOf(R,c,p){if(p.group==='none')return [{key:'',rows:R}];const G=new Map();let kf,lab;
  if(p.group==='stmt'){kf=t=>stmtOf(t.d,c.close).e;lab=k=>{const s=stmtOf(k,c.close),open=s.e>=TODAY;return {label:`${md(s.s)} – ${md(s.e)}`,tag:open?`Open, closes ${md(s.e)}`:`Closed ${md(s.e)}, due ${md(dueOf(s.e,c.due))}`,open}}}
  else if(p.group==='month'){kf=t=>t.d.slice(0,7);lab=k=>({label:`${MONL[+k.slice(5)-1]} ${k.slice(0,4)}`})}
  else if(p.groupCat==='yours'){kf=t=>t.kind==='payment'?'~Payments':topOf(t.cat);lab=k=>({label:k==='~Payments'?'Payments':k==='Multiple'?'Split rows':k,dot:HUE[k]})}
  else{kf=t=>t.earn?(t.mtop||t.mc||'~Unknown'):'~'+(KINDS_PL[t.kind]||KIND[t.kind]);lab=k=>({label:k==='~Unknown'?'Unknown merchant':k.replace(/^~/,'')})}
  R.forEach(t=>{const k=kf(t);(G.get(k)||G.set(k,[]).get(k)).push(t)});
  const arr=[...G].map(([k,rows])=>Object.assign({key:k,rows},lab(k)));
  if(p.group==='cat')arr.sort((a,b)=>(a.key.startsWith('~')-b.key.startsWith('~'))||(totalsOf(b.rows).spend-totalsOf(a.rows).spend));else arr.sort((a,b)=>a.key<b.key?1:-1);
  return arr}

/* ── Page chrome (decided; context only) ─────────────────── */
function chrome(c,p,inner){const crumbs=`<div class="sf hdr"><div class="crumbs"><button type="button">Cards</button><i>›</i><button type="button">Portfolio</button><i>›</i><button type="button">${esc(c.eco)}</button><i>›</i><b>${esc(p.card)}</b></div><div class="und"><button type="button">MTD</button><button type="button" class="on">QTD</button><button type="button">YTD</button></div></div>`;
  return `<div class="app"><nav class="appnav"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(n=>`<button type="button" class="${n==='Cards'?'on':''}">${n}</button>`).join('')}</div></nav><div class="main">${crumbs}${banner(c,p)}${inner}</div><div class="pops">${popLayer(c,p)}${modalLayer(c,p)}</div><div class="toast" role="status" hidden></div></div>`}
function qtdRows(c,p){return cardRows(c,p).filter(t=>t.d>='2026-10-01'&&t.earn&&!t.exc)}
function banner(c,p){const art=L.h.img('card_'+c.key),Q=qtdRows(c,p),earned=Q.reduce((s,t)=>s+t.pts,0),util=c.limit?Math.abs(c.balance)/c.limit*100:null;
  const st=(l,v)=>`<div class="st"><span>${l}</span><b>${v}</b></div>`;
  return `<section class="ban" style="background:linear-gradient(135deg,${GRAD[c.eco]||'#374151,#1f2937'})"><div class="ban-t"><div class="ban-id"><div class="ban-n"><h1>${esc(c.product)}</h1><button type="button" class="dots" aria-label="Card menu">⋯</button></div><p>${esc(c.eco)} · ending ${esc(c.mask)}</p><div class="bal"><small>Current balance</small><b>${money(c.balance)}</b></div></div>${art?`<img class="ban-art" src="${art}" alt="">`:''}</div>
    <div class="ban-f">${st('Earned this quarter',(earned<0?'−':'+')+f0(Math.abs(earned)))}${st('Credit limit',m0(c.limit))}${st('Statement closes','Day '+c.close)}${st('Payment due','Day '+c.due)}</div>${util!=null?`<div class="u"><div class="u-l"><span>Utilization</span><span>${util.toFixed(1)}%</span></div><div class="bar"><i style="width:${Math.min(100,util)}%"></i></div></div>`:''}</section>`}
function earnSec(c,p){const Q=qtdRows(c,p),G=new Map();Q.forEach(t=>{const k=t.mc&&t.rate>c.base+.001?t.mc:'All other purchases',g=G.get(k)||G.set(k,{spend:0,pts:0,rate:{}}).get(k);g.spend+=-t.amt;g.pts+=t.pts;g.rate[rateTxt(t.rate)]=(g.rate[rateTxt(t.rate)]||0)+1});
  const rows=[...G].map(([k,g])=>({k,spend:g.spend,pts:g.pts,rate:Object.entries(g.rate).sort((a,b)=>b[1]-a[1])[0][0]||rateTxt(c.base)})).sort((a,b)=>(a.k==='All other purchases')-(b.k==='All other purchases')||b.pts-a.pts),mx=Math.max(1,...rows.map(r=>r.pts));
  return `<section><h2>Earnings <span class="ct">this quarter</span></h2><div class="sf pn">${rows.length?`<table class="t et"><thead><tr><th>Category</th><th class="n">Rate</th><th class="n">Spend</th><th class="n">Points</th></tr></thead><tbody>${rows.map(r=>`<tr><td><div class="eb"><span>${esc(r.k)}</span><i style="width:${Math.max(3,r.pts/mx*100)}%"></i></div></td><td class="n ac">${r.rate}</td><td class="n">${m0(r.spend)}</td><td class="n">${f0(r.pts)}</td></tr>`).join('')}</tbody></table>`:'<p class="emp">No purchases this quarter.</p>'}</div></section>`}
function benSec(c){const B=c.ben;return `<section><h2>Benefits</h2><div class="sf pn">${B.length?B.map(b=>`<div class="bn"><div><b>${esc(b.name)}</b><small>${esc(b.cad)} <span class="tg ${b.auto?'auto':'hand'}">${b.auto?'Auto-tracked':'Log by hand'}</span></small></div><span class="pill2 ${b.left>0?'o':'d'}">${b.left>0?m0(b.left)+' left':'Used'}</span></div>`).join(''):'<p class="emp">No benefits on this card.</p>'}</div></section>`}

/* ── Toolbar: period, search, filters ────────────────────── */
function periodCtl(c,p){const r=S.r,[a,b,lab]=rangeOf(c),arrows=`<span class="nav"><button type="button" class="ib" data-step="-1" aria-label="Earlier">‹</button><b>${lab}</b><button type="button" class="ib" data-step="1" aria-label="Later" ${r.off>=0?'disabled':''}>›</button></span>`;
  const dates=`<span class="dr"><input class="inp d" type="date" data-from value="${a}" aria-label="From"><span>→</span><input class="inp d" type="date" data-to value="${b}" aria-label="To"></span>`;
  if(p.period==='ymd'){const yv=r.mode==='ym'?r.y:'',mv=r.mode==='ym'?r.m:'';return `<div class="per"><select class="inp" data-ym="y" aria-label="Year"><option value="">All years</option><option value="2026" ${yv==='2026'?'selected':''}>2026</option></select>${yv?`<select class="inp" data-ym="m" aria-label="Month"><option value="">All months</option>${MONL.map((m,i)=>`<option value="${i+1}" ${mv==String(i+1)?'selected':''}>${m}</option>`).join('')}</select>`:''}${dates}</div>`}
  const T=p.period==='stmt'?[['stmt','Statement'],['month','Month'],['ytd','Year to date'],['custom','Custom']]:[['month','Monthly'],['qtd','QTD'],['ytd','YTD'],['custom','Custom']];
  let extra='';if(r.mode==='stmt'){const s=stmtStep(r.off,c.close),open=s.e>=TODAY;extra=`${arrows}<span class="sst ${open?'o':''}">${open?`Open, closes ${md(s.e)}`:`Closed, due ${md(dueOf(s.e,c.due))}`}</span>`}
  else if(r.mode==='month'||r.mode==='qtd')extra=arrows;else if(r.mode==='custom')extra=dates;
  return `<div class="per"><div class="und">${T.map(([k,l])=>`<button type="button" class="${r.mode===k?'on':''}" data-mode="${k}">${l}</button>`).join('')}</div>${extra}</div>`}
const searchBox=p=>`<input class="srch ${p.search}" type="search" data-q placeholder="Search merchants, brands, notes" value="${esc(S.q)}" aria-label="Search">`;
function options(k,R){const C=new Map(),add=(v,l,x)=>{const o=C.get(v)||C.set(v,{v,l,n:0,x}).get(v);o.n++};
  if(k==='ycat'){const G=groupCats(),cnt={};R.forEach(t=>{if(t.kind==='payment')return;cnt[t.cat]=(cnt[t.cat]||0)+1;if(PAR[t.cat])cnt[PAR[t.cat]]=(cnt[PAR[t.cat]]||0)+1});
    const out=[];G.forEach(g=>{if(!cnt[g.top])return;out.push({v:g.top,l:g.top,n:cnt[g.top],top:1});g.kids.forEach(s=>{if(cnt[s])out.push({v:s,l:s,n:cnt[s],sub:1})})});if(cnt.Multiple)out.push({v:'Multiple',l:'Split rows',n:cnt.Multiple,top:1});return out}
  R.forEach(t=>{if(k==='mcat')t.earn?add(t.mc||'__none__',t.mc?(t.mtop?t.mtop+' › ':'')+t.mc:'Unknown merchant'):add('__k:'+t.kind,KINDS_PL[t.kind]||KIND[t.kind]);
    else if(k==='brand')add(t.brand||'__none__',t.brand||'No brand');else if(k==='sp')add(t.sp||'__none__',t.sp||'Nobody');else if(k==='kind')add(t.kind,KIND[t.kind])});
  return [...C.values()].sort((a,b)=>(a.v.startsWith('__')-b.v.startsWith('__'))||b.n-a.n)}
const FL={ycat:['Your category','All your categories'],mcat:['Merchant category','All merchant categories'],brand:['Brand','All brands'],sp:['Spender','Everyone'],kind:['Kind','All kinds']};
function fChip(k,R){const s=S.f[k],O=options(k,R),[lab,all]=FL[k];let t=all;if(s){const one=[...s][0],o=O.find(x=>x.v===one);t=s.size===1?`${lab}: ${o?o.l:one}`:`${lab} (${s.size}/${O.length})`}
  return `<button type="button" class="fchip ${s?'on':''}" data-pop="f:${k}">${esc(t)} <span class="cv">▾</span></button>`}
function filters(c,p,R){const hasSp=c.rows.some(r=>r.sp),unkN=R.filter(t=>t.unk).length,clear=anyFilter()?'<button type="button" class="lnk" data-clear>Clear filters</button>':'';
  const unkChip=p.fUnknown&&unkN?`<button type="button" class="fchip w ${S.unk?'on':''}" data-unk>⚠ Unknown merchant ${unkN}</button>`:'';
  if(p.filterStyle==='menus')return `<div class="fl">${fChip('ycat',R)}${fChip('mcat',R)}${p.fBrand?fChip('brand',R):''}${hasSp?fChip('sp',R):''}${fChip('kind',R)}${unkChip}${clear}</div>`;
  if(p.filterStyle==='tops'){const cnt={};R.forEach(t=>{if(t.kind!=='payment'){const k=topOf(t.cat);cnt[k]=(cnt[k]||0)+1}});const tops=groupCats().map(g=>g.top).filter(x=>cnt[x]);if(cnt.Multiple)tops.push('Multiple');
    let subs='';if(S.top){const sc={};R.forEach(t=>{if(topOf(t.cat)===S.top&&t.cat!==S.top)sc[t.cat]=(sc[t.cat]||0)+1});const own=R.filter(t=>t.cat===S.top).length,ks=Object.keys(sc);
      if(ks.length)subs=`<div class="t-ch sub"><span class="lbl">${esc(S.top)} ›</span><button type="button" class="chip ${!S.sub?'on':''}" data-sub="">All ${cnt[S.top]}</button>${ks.map(k=>`<button type="button" class="chip ${S.sub===k?'on':''}" data-sub="${esc(k)}">${esc(k)} <em>${sc[k]}</em></button>`).join('')}${own?`<button type="button" class="chip ${S.sub===S.top?'on':''}" data-sub="${esc(S.top)}">${esc(S.top)} itself <em>${own}</em></button>`:''}</div>`}
    return `<div class="t-ch"><button type="button" class="chip ${!S.top?'on':''}" data-top="">All</button>${tops.map(x=>`<button type="button" class="chip ${S.top===x?'on':''}" data-top="${esc(x)}"><i style="background:${HUE[x]||'#94A3B8'}"></i>${esc(x==='Multiple'?'Split':x)} <em>${cnt[x]}</em></button>`).join('')}</div>${subs}<div class="fl">${fChip('mcat',R)}${p.fBrand?fChip('brand',R):''}${hasSp?fChip('sp',R):''}${unkChip}${clear}</div>`}
  const mcs=[...new Set(R.filter(t=>t.earn&&t.mc).map(t=>t.mc))],extra=(p.fBrand?fChip('brand',R):'')+clear;
  return `<div class="t-ch"><button type="button" class="chip ${!S.chip?'on':''}" data-chip="">All</button>${mcs.map(x=>`<button type="button" class="chip ${S.chip===x?'on':''}" data-chip="${esc(x)}">${esc(x)}</button>`).join('')}${unkN?`<button type="button" class="chip warn ${S.chip==='__none__'?'on':''}" data-chip="__none__">${p.cardCol==='bonus'?'No bonus category':'Unknown merchant'} (${unkN})</button>`:''}</div>${extra?`<div class="fl">${extra}</div>`:''}`}

/* ── Totals ──────────────────────────────────────────────── */
function totals(R,p){if(!R.length)return '';const T=totalsOf(R),unk=T.unk?`${T.unk} ${p.cardCol==='bonus'?'with no bonus category':'unknown merchant'+(T.unk>1?'s':'')}`:'';
  if(p.totals==='strip')return `<div class="strip" data-region="tot">${T.n} transaction${T.n===1?'':'s'} · Spend: ${money(T.spend)}${p.totCredits&&T.cred?` · Credits and refunds: ${money(T.cred)}`:''} · Points: ${T.pts<0?'−':'+'}${f0(Math.abs(T.pts))}${unk?` · <span class="warn-t">${unk}</span>`:''}</div>`;
  if(p.totals==='figs'){const ppd=T.spend?T.pts/T.spend:0,fig=(l,v,s='')=>`<div class="fg"><b class="val ${s}">${v}</b><span>${l}</span></div>`;
    return `<div class="figs" data-region="tot">${fig('Spend',money(T.spend))}${p.totCredits?fig('Credits and refunds',T.cred?'−'+money(T.cred):'$0.00','up'):''}${fig('Points',(T.pts<0?'−':'+')+f0(Math.abs(T.pts)),'up')}${fig('Points per dollar',ppd.toFixed(2)+'x')}${unk?`<div class="fg w"><b class="val">${T.unk}</b><span>${p.cardCol==='bonus'?'No bonus category':'Unknown merchant'}</span></div>`:''}</div>`}
  return `<div class="t-sum" data-region="tot"><span>Spend <b>${m0(T.spend)}</b></span>${p.totCredits&&T.cred?`<span>Credits <b class="up">−${m0(T.cred)}</b></span>`:''}<span>Points <b class="up">${T.pts<0?'−':''}${f0(Math.abs(T.pts))}</b></span>${unk?`<span class="warn-t">${unk}</span>`:''}</div>`}
function selBar(p,R){if(!S.sel.size)return '';const n=S.sel.size;
  if(p.selBar==='full')return `<div class="selbar"><b>${n} selected</b>${p.yourCol!=='off'||p.catEdit!=='none'?'<button type="button" class="btn" data-pop="bcat">Set category ▾</button>':''}<button type="button" class="btn" data-pop="bsp">Set spender ▾</button><button type="button" class="btn" data-bexc>Exclude from points</button><button type="button" class="btn ghost" data-desel>✕ Deselect all</button></div>`;
  if(p.selBar==='tx')return `<div class="selbar"><b>${n} selected</b><button type="button" class="btn" data-bedit>✎ Edit selected</button><button type="button" class="btn ghost" data-desel>✕ Deselect all</button></div>`;
  return `<div class="selbar"><b>${n} selected</b><span class="mut">Tag as:</span><button type="button" class="btn" data-pop="bsp">Who spent this? ▾</button><button type="button" class="btn ghost" data-desel>Clear selection</button></div>`}

/* ── Table ───────────────────────────────────────────────── */
function yourCell(t,p){if(t.kind==='payment'||t.act==='Transfer')return '<span class="dim">—</span>';const c=t.cat,par=PAR[c],st=p.yourCol;let inner;
  if(c==='Multiple')inner=`<span class="pill">Multiple</span>`;
  else if(st==='pill')inner=`<span class="pill">${par?`<span class="pp">${esc(par)} › </span>`:''}${esc(c)}${t.man?'<span class="pen" title="Set by hand">✎</span>':''}</span>`;
  else if(st==='sub')inner=`<span class="cdot" title="${esc(catPath(c))}"><i style="background:${hue(c)}"></i>${esc(c)}${t.man?'<span class="pen">✎</span>':''}</span>`;
  else inner=`<span class="cst"><b>${esc(c)}${t.man?'<span class="pen">✎</span>':''}</b>${par?`<small>${esc(par)}</small>`:''}</span>`;
  return p.catEdit==='pill'&&c!=='Multiple'?`<button type="button" class="cbtn" data-pop="cat:${t.id}" title="Change category">${inner}</button>`:inner}
function cardCell(t,p){const st=p.cardCol,br=p.brandCol==='card'&&t.brand?` · <b>${esc(t.brand)}</b>`:'';
  if(!t.earn)return st==='kind'?`<span class="kb">${KIND[t.kind]}</span>`:(t.mc&&st!=='bonus'?`<span class="dim">${esc(t.mc)}</span>`:'<span class="dim">—</span>');
  if(!t.mc){const u=`<span class="warn-t">${st==='bonus'?'None':'Unknown'}</span>${br}`;return p.merchEdit==='unknown'?`<button type="button" class="cbtn unk" data-pop="mc:${t.id}" title="Set the merchant category">${u}<span class="cv">▾</span></button>`:u}
  const rf=st==='kind'&&t.kind==='refund'?' <span class="kb">Refund</span>':'';
  if(st==='bonus')return esc(t.mc)+br+rf;
  return `<span class="ctx">${t.mtop?`<span class="pp">${esc(t.mtop)} › </span>`:''}${esc(t.mc)}</span>${br}${rf}`}
function nameCell(t,p,pd){const car=t.spl?`<button type="button" class="car ${S.spx.has(t.id)?'on':''}" data-spx="${t.id}" aria-expanded="${S.spx.has(t.id)}" aria-label="Show the ${t.spl.length} parts">▸</button>`:'';
  const tags=(pd?'<span class="tag pd">Pending</span>':'')+(t.exc?'<span class="tag" title="Excluded from points">⊘ Excluded</span>':'')+(t.link?`<span class="lk1" title="${esc(t.link)}" role="img" aria-label="${esc(t.link)}">$</span>`:'')+(p.brandCol==='inline'&&t.brand?`<span class="btag">${esc(t.brand)}</span>`:'');
  const nt=t.note&&p.extras!=='none'?`<small class="note">${esc(t.note)}</small>`:'';
  return `<div class="nmw">${car}<span class="mn" title="${esc(t.raw)}">${esc(t.n)}</span>${tags}</div>${nt}`}
function spCell(t,p){const inner=t.sp?`<span class="spn">${esc(t.sp)}</span>`:'<span class="dim">–</span>';return p.spEdit==='click'?`<button type="button" class="cbtn" data-pop="sp:${t.id}" title="Set spender">${inner}</button>`:inner}
function typeCell(t,p){if(p.typeCol==='type')return t.kind==='payment'?'Payment':t.amt>0?'Credit':'Expense';if(p.typeCol==='kind')return KIND[t.kind];return t.kind==='purchase'?'':`<span class="kb">${KIND[t.kind]}</span>`}
function amtCell(t,p){if(p.amtStyle==='card')return t.amt<0?money(t.amt):`<span class="up">−${money(t.amt)}</span>`;const cls=t.kind==='payment'?'':t.amt<0?'neg':'up';return `<span class="${cls}">${t.amt<0?'−':'+'}${money(t.amt)}</span>`}
const dateTxt=(s,p)=>{const x=dt(s);return p.dateFmt==='num'?`${x.getMonth()+1}/${x.getDate()}`:md(s)};
function cols(c,p){const hasSp=c.rows.some(r=>r.sp),D=[];
  D.push({k:'chk',h:'<input type="checkbox" data-allsel aria-label="Select all shown">',cls:'ck',cell:(t,pd)=>pd?'':`<input type="checkbox" data-sel="${t.id}" ${S.sel.has(t.id)?'checked':''} aria-label="Select ${esc(t.n)}">`});
  D.push({k:'date',h:'Date',s:'d',cls:'nw dte',cell:t=>dateTxt(t.d,p)});
  D.push({k:'n',h:'Merchant',s:'n',cls:'mc',cell:(t,pd)=>nameCell(t,p,pd)});
  if(p.yourCol!=='off')D.push({k:'cat',h:'Your category',s:'cat',cls:'yc',cell:t=>yourCell(t,p)});
  D.push({k:'mc',h:p.cardCol==='bonus'?'Bonus category':'Merchant category',s:'mc',cls:'cc',cell:t=>cardCell(t,p)});
  if(p.brandCol==='col')D.push({k:'brand',h:'Brand',s:'brand',cls:'nw',cell:t=>t.brand?esc(t.brand):'<span class="dim">–</span>'});
  if(p.spCol==='always'||(p.spCol==='auto'&&hasSp))D.push({k:'sp',h:'Spender',s:'sp',cls:'nw',cell:t=>spCell(t,p)});
  if(p.typeCol!=='off')D.push({k:'kind',h:p.typeCol==='kind'?'Kind':'Type',s:'kind',cls:'nw',cell:t=>typeCell(t,p)});
  if(p.ptsCol==='two'){D.push({k:'rate',h:'Rate',s:'rate',cls:'n',cell:(t,pd)=>pd||!t.rate?'<span class="dim">–</span>':`<span class="ac">${rateTxt(t.rate)}</span>`});D.push({k:'pts',h:'Points',s:'pts',cls:'n',cell:(t,pd)=>pd?'<span class="dim">–</span>':ptsSpan(t.pts)})}
  else if(p.ptsCol==='one')D.push({k:'pts',h:'Points',s:'pts',cls:'n',cell:(t,pd)=>pd?'<span class="dim">when posted</span>':`<span class="p2">${ptsSpan(t.pts)}${t.rate?`<small>${rateTxt(t.rate)}</small>`:''}</span>`});
  else D.push({k:'pts',h:'Points',s:'pts',cls:'n',cell:(t,pd)=>pd?'<span class="dim">–</span>':`<span title="${t.rate?rateTxt(t.rate)+' on this purchase':'No points'}">${ptsSpan(t.pts)}</span>`});
  D.push({k:'amt',h:'Amount',s:'amt',cls:'n am',cell:(t,pd)=>pd?`<span class="dim">${t.amt<0?money(t.amt):'−'+money(t.amt)}</span>`:amtCell(t,p)});
  D.push({k:'act',h:'<span class="sr">Actions</span>',cls:'ra',cell:(t,pd)=>pd?'':`<button type="button" class="dotb" data-pop="menu:${t.id}" aria-label="Actions for ${esc(t.n)}">⋯</button>`});
  return D}
function th(col,p){if(!p.sortable||!col.s)return `<th class="${col.cls||''}">${col.h}</th>`;const on=S.sort===col.s;
  return `<th class="${col.cls||''}"><button type="button" class="sb ${on?'on':''}" data-sort="${col.s}">${col.h}<i>${on?(S.dir==='asc'?'▲':'▼'):'⇅'}</i></button></th>`}
function gHead(g,n,p){const col=S.coll.has(g.key),T=totalsOf(g.rows);
  return `<tr class="gh"><td colspan="${n}"><div class="ghw"><button type="button" class="gt" data-gt="${esc(g.key)}" aria-expanded="${!col}"><span class="chev ${col?'':'on'}">▸</span>${g.dot?`<i class="gd" style="background:${g.dot}"></i>`:''}${esc(g.label)}${g.tag?`<span class="gtag ${g.open?'o':''}">${esc(g.tag)}</span>`:''}</button>${p.groupSub?`<span class="gs">${T.n} · ${money(T.spend)} · ${ptsSpan(T.pts)} pts</span>`:`<span class="gs">${T.n}</span>`}</div></td></tr>`}
function stripRow(t,n,p){const dl=(k,v)=>`<dt>${k}</dt><dd>${v}</dd>`;
  return `<tr class="xp"><td colspan="${n}"><div class="xpg"><div><h4>How the card sees it</h4><dl>${dl('Merchant category',t.mc?esc((t.mtop?t.mtop+' › ':'')+t.mc):t.earn?'<span class="warn-t">Unknown</span>, earns the base rate':'—')}${dl('Brand',esc(t.brand||'—'))}${dl('Kind',KIND[t.kind])}${dl('Points',`${ptsSpan(t.pts)}${t.rate?' at '+rateTxt(t.rate):''}`)}</dl></div><div><h4>Your side</h4><dl>${dl('Category',esc(catPath(t.cat)))}${dl('Spender',esc(t.sp||'—'))}${dl('Note',esc(t.note||'—'))}${t.spl?dl('Parts',t.spl.map(s=>`${esc(catPath(s.cat))} ${money(s.amt)}`).join('<br>')):''}</dl></div></div></td></tr>`}
function splitRows(t,n,p,D){if(!t.spl||!S.spx.has(t.id))return '';const pre=D.findIndex(c=>c.k==='n');
  return t.spl.map(s=>`<tr class="sp"><td colspan="${pre}"></td><td colspan="${n-pre-2}"><span class="spr">↳ ${s.n?esc(s.n)+', ':''}${esc(catPath(s.cat))}${s.note?` <small>${esc(s.note)}</small>`:''}</span></td><td class="n am">${amtCell({amt:s.amt,kind:'purchase'},p)}</td><td></td></tr>`).join('')}
function table(c,p,R,pend){const D=cols(c,p),n=D.length,G=groupsOf(sorted(R),c,p);
  if(S.coll===null){S.coll=new Set(p.groupFold&&p.group!=='none'?G.slice(1).map(g=>g.key):[])}
  let body='',shown=0;const limit=p.length==='more'&&!S.all?12:1e9;
  const row=(t,pd)=>`<tr class="tr ${t.exc?'exc':''} ${pd?'pend':''} ${S.sel.has(t.id)?'sel':''} ${p.rowClick!=='none'?'clk':''} ${t.kind==='payment'?'pay':''}" data-row="${t.id}" ${p.rowClick!=='none'?'tabindex="0"':''}>${D.map(col=>`<td class="${col.cls||''}">${col.cell(t,pd)}</td>`).join('')}</tr>`;
  if(pend.length)body+=`<tr class="gh pg"><td colspan="${n}"><div class="ghw"><span class="gt"><span class="tag pd">Pending</span> Not posted yet; points count once it posts</span></div></td></tr>`+pend.map(t=>row(t,true)).join('');
  for(const g of G){if(shown>=limit)break;if(p.group!=='none')body+=gHead(g,n,p);if(S.coll.has(g.key))continue;
    for(const t of g.rows){if(shown>=limit)break;body+=row(t,false);shown++;if(S.exp.has(t.id)&&p.rowClick==='expand')body+=stripRow(t,n,p);body+=splitRows(t,n,p,D)}}
  const more=p.length==='more'&&!S.all&&R.length>limit?`<div class="t-more"><button type="button" class="btn" data-all>Show all ${R.length}</button></div>`:'';
  return `<div class="t-s ${p.length==='scroll'?'cap':''}"><table class="t tx ${p.rowStyle}"><thead data-region="cols"><tr>${D.map(col=>th(col,p)).join('')}</tr></thead><tbody>${body}</tbody></table></div>${more}`}
function emptyBox(c,p,all){const[a,b]=rangeOf(c);
  if(anyFilter())return p.empty==='helpful'?`<div class="empty"><b>Nothing matches these filters</b><span>${all.length} transaction${all.length===1?'':'s'} in ${md(a)} – ${md(b)}, none of them match.</span><button type="button" class="btn" data-clear>Clear filters</button></div>`:'<p class="emp c">No matches.</p>';
  if(p.empty!=='helpful')return '<p class="emp c">No transactions for this period.</p>';
  const last=cardRows(c,p).find(t=>t.d<a&&t.kind!=='payment');
  return `<div class="empty"><b>No charges on this card from ${md(a)} to ${md(b)}</b>${last?`<span>The last one was ${md(last.d)}: ${esc(last.n)}, ${money(last.amt)}.</span><button type="button" class="btn" data-back="${last.d}">Show ${p.period==='stmt'?'that statement':MONL[dt(last.d).getMonth()]}</button>`:'<span>No earlier charges either.</span>'}</div>`}
function txSection(c,p){const {R,pend}=scoped(c,p),V=R.filter(matches),[a,b,lab]=rangeOf(c);
  const ct=`${V.length}${anyFilter()?` of ${R.length}`:''} in ${lab}${pend.length?`, plus ${pend.length} pending`:''}`;
  const body=V.length||pend.length?table(c,p,V,pend):emptyBox(c,p,R);
  return `<section data-region="tx"><h2>Transactions <span class="ct">${ct}</span></h2><div class="sf pn"><div class="tb" data-region="find"><div class="tb1">${periodCtl(c,p)}${searchBox(p)}</div>${filters(c,p,R)}</div>${totals(V,p)}${selBar(p,V)}${body}</div></section>`}

/* ── Popovers and windows ────────────────────────────────── */
function catPicker(title,cur){const q=(S.pq||'').toLowerCase();let h=`<div class="ph">${esc(title)}</div><input class="inp pq" data-pq placeholder="Search categories" value="${esc(S.pq||'')}" aria-label="Search categories"><div class="pl">`;
  groupCats().forEach(g=>{const tm=!q||g.top.toLowerCase().includes(q),kids=g.kids.filter(k=>tm||k.toLowerCase().includes(q));if(!tm&&!kids.length)return;
    h+=`<button type="button" class="po top ${cur===g.top?'on':''}" data-pick="${esc(g.top)}"><i style="background:${HUE[g.top]||'#94A3B8'}"></i>${esc(g.top)}</button>`+kids.map(k=>`<button type="button" class="po sub ${cur===k?'on':''}" data-pick="${esc(k)}">${esc(k)}</button>`).join('')});
  return h+'</div>'}
function mcPicker(t){const q=(S.pq||'').toLowerCase();let h=`<div class="ph">Merchant category for ${esc(t.n)}</div><p class="pn2">Saves a merchant rule for every card. Past points recalculate after a before-and-after review.</p><input class="inp pq" data-pq placeholder="Search" value="${esc(S.pq||'')}" aria-label="Search merchant categories"><div class="pl">`;
  mcatTree().forEach(g=>{const tm=!q||g.top.toLowerCase().includes(q),kids=g.kids.filter(k=>tm||k.toLowerCase().includes(q));if(!tm&&!kids.length)return;h+=`<button type="button" class="po top" data-pick="${esc(g.top)}">${esc(g.top)}</button>`+kids.map(k=>`<button type="button" class="po sub" data-pick="${esc(k)}">${esc(k)}</button>`).join('')});return h+'</div>'}
function spPicker(title,cur){const N=L.d.spenders;return `<div class="ph">${esc(title)}</div><div class="pl">${N.map(n=>`<button type="button" class="po ${cur===n?'on':''}" data-pick="${esc(n)}">${esc(n)}</button>`).join('')}<button type="button" class="po dim2" data-pick="">Nobody</button></div><div class="padd"><input class="inp" data-newsp placeholder="Add a name" aria-label="Add a name"><button type="button" class="btn" data-addsp>Add</button></div>`}
function menuPop(t,p){const it=(a,l,cls='')=>`<button type="button" class="mi ${cls}" data-ma="${a}">${l}</button>`;let h='';
  if(t.kind==='purchase')h+=it('log','Log credit use…')+'<hr>';
  if(p.catEdit==='menu')h+=it('cat','Change category…');if(p.spEdit==='menu')h+=it('sp','Set spender…');
  if(p.merchEdit==='unknown'&&t.unk)h+=it('mc','Set merchant category…');
  if(p.extras==='menu')h+=it('split',t.spl?'Edit split…':'Split…')+it('note',t.note?'Edit note…':'Add note…');
  if(p.merchEdit==='details'||p.extras==='details'||p.rowClick==='details')h+=it('details','Transaction details');
  if(h&&!h.endsWith('<hr>'))h+='<hr>';
  return h+it('exc',t.exc?'Include in points':'Exclude from points')+it('pts','Set points by hand')}
function fPop(k,R){const O=options(k,R),D=S.fd;return `<div class="ph">${esc(FL[k][0])}</div><div class="pl ck">${O.map(o=>`<label class="fo ${o.sub?'sub':''}"><input type="checkbox" data-fx="${esc(o.v)}" ${!D||D.has(o.v)?'checked':''}><span>${esc(o.l)}</span><em>${o.n}</em></label>`).join('')||'<p class="emp">Nothing in this period.</p>'}</div><div class="pf"><span><button type="button" class="lnk" data-fall="0">Clear all</button><button type="button" class="lnk" data-fall="1">Select all</button></span><button type="button" class="btn pri" data-fapply>Apply</button></div>`}
function popLayer(c,p){const P=S.pop;if(!P)return '';const all=cardRows(c,p),t=P.id!=null?all.find(x=>x.id===P.id):null;let inner='';
  if(P.k==='menu'&&t)inner=menuPop(t,p);else if(P.k==='cat'&&t)inner=catPicker(`Category for ${t.n}`,t.cat);else if(P.k==='bcat')inner=catPicker(`Category for ${S.sel.size} selected`,'');
  else if(P.k==='sp'&&t)inner=spPicker(`Spender for ${t.n}`,t.sp);else if(P.k==='bsp')inner=spPicker(`Spender for ${S.sel.size} selected`,'');
  else if(P.k==='mc'&&t)inner=mcPicker(t);else if(P.k==='note'&&t)inner=`<div class="ph">Note on ${esc(t.n)}</div><textarea class="inp nt" data-notev rows="3" aria-label="Note">${esc(t.note)}</textarea><div class="pf"><button type="button" class="lnk" data-popx>Cancel</button><button type="button" class="btn pri" data-notesave>Save</button></div>`;
  else if(P.k.startsWith('f:'))inner=fPop(P.k.slice(2),scoped(c,p).R);
  return inner?`<div class="pop ${P.k==='menu'?'menu':''}" style="left:${P.x}px;top:${P.y}px;width:${P.w}px" role="dialog" aria-label="Options">${inner}</div>`:''}
function modalLayer(c,p){const M=S.modal;if(!M)return '';let body;
  if(M.k==='details'){const t=cardRows(c,p).find(x=>x.id===M.id);if(!t)return '';const tile=(k,v)=>`<div class="tl"><span>${k}</span><b>${v}</b></div>`;
    body=`<div class="mh"><div><h3 id="mdl-t">Transaction details</h3><small>ID #${t.id}</small></div><button type="button" class="ib x" data-mx aria-label="Close">×</button></div><div class="mb"><div class="dbox"><b>${esc(t.n)}</b>${t.raw!==t.n?`<small>Raw: ${esc(t.raw)}</small>`:''}</div><div class="tiles">${tile('Date',md(t.d)+', 2026')}${tile('Amount',amtCell(t,{amtStyle:'signed'}))}${tile('Account',esc(p.card))}${tile('Category',esc(catPath(t.cat)))}${t.sp?tile('Spender',esc(t.sp)):''}${tile('Kind',KIND[t.kind])}</div>
      <div class="dbox mcb"><div class="row"><span>Merchant category</span><button type="button" class="lnk">${t.mc?'Edit':'Set'}</button></div><b>${t.mc?esc((t.mtop?t.mtop+' › ':'')+t.mc):'Not classified'}</b><small>Brand: ${esc(t.brand||'none')} · Kind: ${KIND[t.kind]}</small></div>
      <div class="dbox"><div class="row"><span>${t.pts<0?'Points clawback':t.exc?'Not counted for points':'Points earned'}</span></div><b>${ptsSpan(t.pts)} ${esc(c.eco)}${t.rate?` · ${rateTxt(t.rate)}`:''}</b></div>
      <p class="mut">Same window as the Transactions page (docs/transactions-design.md); shortened here.</p></div><div class="mf"><span><button type="button" class="btn">⊕ Split</button></span><button type="button" class="btn pri" data-mx>Close</button></div>`}
  else{const opts=groupCats().map(g=>`<optgroup label="${esc(g.top)}"><option>${esc(g.top)}</option>${g.kids.map(k=>`<option>${esc(k)}</option>`).join('')}</optgroup>`).join('');
    body=`<div class="mh"><h3 id="mdl-t">Edit ${S.sel.size} selected</h3><button type="button" class="ib x" data-mx aria-label="Close">×</button></div><div class="mb"><label class="fld">Category<select class="inp" data-bcat><option value="">Keep as is</option>${opts}</select></label><label class="fld">Spender<select class="inp" data-bsp><option value="">Keep as is</option>${L.d.spenders.map(n=>`<option>${esc(n)}</option>`).join('')}<option value="__none__">Nobody</option></select></label></div><div class="mf"><span></span><span><button type="button" class="btn" data-mx>Cancel</button><button type="button" class="btn pri" data-bapply>Apply to ${S.sel.size}</button></span></div>`}
  return `<div class="mdl-bk"></div><div class="mdl" role="dialog" aria-modal="true" aria-labelledby="mdl-t" style="top:${M.y}px">${body}</div>`}

/* ── Wiring ──────────────────────────────────────────────── */
function redraw(focus){const st=L.root.closest('#stage')||document.getElementById('stage'),top=st?st.scrollTop:0;L.root.innerHTML=page(L.picks);wire(L.root,L.picks);if(st)st.scrollTop=top;
  if(focus){const el=L.root.querySelector(focus);if(el){el.focus();const v=el.value||'';try{el.setSelectionRange(v.length,v.length)}catch(e){}}}}
// Shown after the redraw that follows every action, so it isn't wiped by it.
function toast(msg){setTimeout(()=>{const el=L.root.querySelector('.toast');if(!el)return;el.textContent='✓ '+msg;el.style.top=(S.ty||200)+'px';el.hidden=false;clearTimeout(L.tt);L.tt=setTimeout(()=>{const e2=L.root.querySelector('.toast');if(e2)e2.hidden=true},2600)},0)}
function rel(el,w,alignRight){const app=L.root.querySelector('.app').getBoundingClientRect(),r=el.getBoundingClientRect();let x=(alignRight?r.right-w:r.left)-app.left;x=Math.max(8,Math.min(x,app.width-w-8));return {x,y:r.bottom-app.top+4}}
const setEd=(id,o)=>{S.ed[id]=Object.assign(S.ed[id]||{},o)};
function wire(root,p){const c=L.d.cards[p.card];
  root.onclick=e=>{const g=e.target,q=s=>g.closest(s);let el;
    if(S.pop&&!q('.pop')&&!q('[data-pop]')){S.pop=null;S.pq='';S.fd=null;redraw();return}
    if(el=q('[data-pop]')){const k=el.dataset.pop,[kind,id]=k.split(':'),W={menu:210,cat:290,bcat:290,sp:230,bsp:230,mc:290,note:280}[kind]||270;
      if(S.pop&&S.pop.key===k){S.pop=null;redraw();return}
      const pos=rel(el,W,kind==='menu');S.pop={key:k,k:kind==='f'?k:kind,id:id&&kind!=='f'?Number(id):null,x:pos.x,y:pos.y,w:W};S.pq='';S.ty=pos.y;
      if(kind==='f'){const s=S.f[id];S.fd=s?new Set(s):null}redraw(kind==='cat'||kind==='bcat'||kind==='mc'?'[data-pq]':null);return}
    if(el=q('[data-pick]')){const v=el.dataset.pick,P=S.pop;
      if(P.k==='cat'){setEd(P.id,{cat:v});toast('Category saved')}else if(P.k==='bcat'){S.sel.forEach(id=>setEd(id,{cat:v}));toast(`Category set on ${S.sel.size}`)}
      else if(P.k==='sp'){setEd(P.id,{sp:v});toast(v?'Spender saved':'Spender cleared')}else if(P.k==='bsp'){S.sel.forEach(id=>setEd(id,{sp:v}));toast(`Spender set on ${S.sel.size}`)}
      else if(P.k==='mc'){setEd(P.id,{mc:v});toast(`Rule saved: ${v} (preview only)`)}
      S.pop=null;S.pq='';redraw();return}
    if(q('[data-addsp]')){const v=(root.querySelector('[data-newsp]').value||'').trim();if(v){if(!L.d.spenders.includes(v))L.d.spenders.push(v);const P=S.pop;if(P.k==='sp')setEd(P.id,{sp:v});else S.sel.forEach(id=>setEd(id,{sp:v}));S.pop=null;toast('Spender saved');redraw()}return}
    if(q('[data-popx]')){S.pop=null;redraw();return}
    if(q('[data-notesave]')){setEd(S.pop.id,{note:root.querySelector('[data-notev]').value.trim()});S.pop=null;toast('Note saved');redraw();return}
    if(el=q('[data-ma]')){const a=el.dataset.ma,P=S.pop,t=cardRows(c,p).find(x=>x.id===P.id);
      if(a==='cat'||a==='sp'||a==='mc'||a==='note'){const w=a==='sp'?230:290;S.pop=Object.assign({},P,{key:a+':'+P.id,k:a,w,x:Math.max(8,P.x-(w-P.w))});redraw(a==='note'?'[data-notev]':a==='sp'?null:'[data-pq]');return}
      S.pop=null;
      if(a==='exc'){setEd(t.id,{exc:!t.exc});toast(t.exc?'Counted for points again':'Excluded from points')}
      else if(a==='details'){S.modal={k:'details',id:t.id,y:Math.max(8,P.y-160)}}
      else if(a==='log')toast('Opens the two-step Log credit use window (decided in round 8)');
      else if(a==='pts')toast('Set points by hand: unchanged from the approved design');
      else if(a==='split')toast('Opens the Transactions page split window');
      redraw();return}
    if(q('[data-mx]')){S.modal=null;redraw();return}
    if(q('[data-bapply]')){const cv=root.querySelector('[data-bcat]').value,sv=root.querySelector('[data-bsp]').value;S.sel.forEach(id=>{if(cv)setEd(id,{cat:cv});if(sv)setEd(id,{sp:sv==='__none__'?'':sv})});toast(`Applied to ${S.sel.size}`);S.modal=null;redraw();return}
    if(q('[data-bedit]')){S.modal={k:'batch',y:Math.max(8,rel(q('[data-bedit]'),10).y-40)};redraw();return}
    if(q('[data-bexc]')){S.sel.forEach(id=>setEd(id,{exc:true}));toast(`Excluded ${S.sel.size} from points`);S.sel.clear();redraw();return}
    if(q('[data-desel]')){S.sel.clear();redraw();return}
    if(el=q('[data-fall]')){const O=options(S.pop.k.slice(2),scoped(c,p).R);S.fd=el.dataset.fall==='1'?null:new Set();redraw();return}
    if(q('[data-fapply]')){const k=S.pop.k.slice(2),O=options(k,scoped(c,p).R),D=S.fd;S.f[k]=D&&D.size<O.length?D:null;S.pop=null;S.fd=null;S.all=false;redraw();return}
    if(el=q('[data-chip]')){S.chip=el.dataset.chip;S.all=false;redraw();return}
    if(el=q('[data-top]')){S.top=el.dataset.top;S.sub='';redraw();return}
    if(el=q('[data-sub]')){S.sub=el.dataset.sub;redraw();return}
    if(q('[data-unk]')){S.unk=!S.unk;redraw();return}
    if(q('[data-clear]')){S.q='';S.chip='';S.top='';S.sub='';S.unk=false;Object.keys(S.f).forEach(k=>S.f[k]=null);redraw();return}
    if(el=q('[data-sort]')){const k=el.dataset.sort;if(S.sort===k){if(S.dir==='desc'&&['d','amt','pts','rate'].includes(k)||S.dir==='asc'&&!['d','amt','pts','rate'].includes(k))S.dir=S.dir==='asc'?'desc':'asc';else{S.sort=null}}else{S.sort=k;S.dir=['d','amt','pts','rate'].includes(k)?'desc':'asc'}redraw();return}
    if(el=q('[data-mode]')){const m=el.dataset.mode;S.r={mode:m,off:0,from:S.r.from,to:S.r.to};S.coll=null;S.all=false;redraw();return}
    if(el=q('[data-step]')){S.r.off=Math.min(0,(S.r.off||0)+Number(el.dataset.step));S.coll=null;redraw();return}
    if(el=q('[data-back]')){const d=el.dataset.back;if(p.period==='stmt'){const s=stmtOf(d,c.close),cur=stmtOf(TODAY,c.close);let k=0;const e=dt(s.e),ce=dt(cur.e);k=(e.getFullYear()-ce.getFullYear())*12+e.getMonth()-ce.getMonth();S.r={mode:'stmt',off:k}}
      else if(p.period==='ymd')S.r={mode:'ym',y:d.slice(0,4),m:String(+d.slice(5,7))};else{const x=dt(d),t0=dt(TODAY);S.r={mode:'month',off:(x.getFullYear()-t0.getFullYear())*12+x.getMonth()-t0.getMonth()}}
      redraw();return}
    if(el=q('[data-gt]')){const k=el.dataset.gt;S.coll.has(k)?S.coll.delete(k):S.coll.add(k);redraw();return}
    if(el=q('[data-spx]')){const id=Number(el.dataset.spx);S.spx.has(id)?S.spx.delete(id):S.spx.add(id);redraw();return}
    if(q('[data-all]')){S.all=true;redraw();return}
    if(q('button,input,select,textarea,label,a'))return;
    if(el=q('tr[data-row]')){const id=Number(el.dataset.row);if(el.classList.contains('pend'))return;
      if(p.rowClick==='expand'){S.exp.has(id)?S.exp.delete(id):S.exp.add(id);redraw()}
      else if(p.rowClick==='details'){S.modal={k:'details',id,y:Math.max(8,rel(el,10).y-200)};redraw()}}};
  root.onkeydown=e=>{const tr=e.target.closest&&e.target.closest('tr[data-row].clk');if(tr&&e.target===tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();tr.click()}};
  root.oninput=e=>{const g=e.target;
    if(g.matches('[data-q]')){S.q=g.value;S.all=false;redraw('[data-q]')}
    else if(g.matches('[data-pq]')){S.pq=g.value;redraw('[data-pq]')}};
  root.onchange=e=>{const g=e.target;
    if(g.matches('[data-fx]')){const k=S.pop.k.slice(2),O=options(k,scoped(c,p).R);if(!S.fd)S.fd=new Set(O.map(o=>o.v));g.checked?S.fd.add(g.dataset.fx):S.fd.delete(g.dataset.fx)}
    else if(g.matches('[data-sel]')){const id=Number(g.dataset.sel);g.checked?S.sel.add(id):S.sel.delete(id);redraw()}
    else if(g.matches('[data-allsel]')){const {R}=scoped(c,p),V=R.filter(matches);if(g.checked)V.forEach(t=>S.sel.add(t.id));else S.sel.clear();redraw()}
    else if(g.matches('[data-ym]')){const r=S.r.mode==='ym'?S.r:{mode:'ym',y:'',m:''};r[g.dataset.ym]=g.value;if(g.dataset.ym==='y'&&!g.value)r.m='';S.r=r;S.coll=null;redraw()}
    else if(g.matches('[data-from],[data-to]')){const[a,b]=rangeOf(c);S.r={mode:p.period==='ymd'?'custom':'custom',from:g.matches('[data-from]')?g.value:a,to:g.matches('[data-to]')?g.value:b,off:0};
      if(p.period==='ymd')S.r.mode='custom';S.coll=null;redraw()}};}
function page(p){const c=L.d.cards[p.card];
  const side=`<div class="col side">${earnSec(c,p)}${benSec(c)}</div>`;
  return chrome(c,p,`<div class="rail"><div class="col">${txSection(c,p)}</div>${side}</div>`)}

Gallery.define({
  id:'cards-card-tx-r1',
  name:'Cards: Card page transactions',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap'],
  groups:[
   {id:'see',label:'What to preview (not design choices)',open:true,controls:[
    {id:'card',label:'Card',type:'choice',options:[
      {id:'Amex Platinum 1008',label:'Amex Platinum 1008',hint:'Brands on airlines, hotels and Walmart; statement credits; a linked purchase (Martha’s, Oct 2).'},
      {id:'Hilton Aspire 2007',label:'Hilton Aspire 2007',hint:'Fees, interest, refunds, and 16 rows excluded from points.'},
      {id:'Chase SP 3698',label:'Chase SP 3698',hint:'Short list, mostly restaurants.'},
      {id:'Amex BBP 1008',label:'Amex BBP 1008',hint:'The only card with spender tags (Daniella, Omer). No rows after Oct 15, so the current month is empty.'}]},
    {id:'data',label:'Rows shown as',type:'choice',options:[
      {id:'new',label:'From 2027 on',hint:'Merchant category, brand and kind, scored read-only by the 2027 engine. Unknown is overcounted: Plaid’s category, which fills many from 2027, isn’t stored on these rows.'},
      {id:'old',label:'2026 history, as stored',hint:'The old bonus category and points; no brand. Rows dated before 2027 stay like this.'}]},
    {id:'splitDemo',label:'Add a split row (real, from Bilt 8961, Aug 6)',type:'toggle',default:false},
    {id:'emptyDemo',label:'Show the empty list',type:'toggle',default:false},
   ]},
   {id:'cols',label:'Columns',open:true,controls:[
    {id:'yourCol',label:'Your category (top level › sub-category)',type:'choice',options:[
      {id:'off',label:'Not on this page',current:true,hint:'Approved layout: your categories live on the Transactions page.'},
      {id:'pill',label:'Top › Sub pill',hint:'Same pill as the Transactions page; ✎ when set by hand.'},
      {id:'sub',label:'Sub-category with a color dot',hint:'The dot is the top level’s color; full path on hover. Narrower.'},
      {id:'stack',label:'Two lines',hint:'Sub-category, with the top level under it in grey.'}]},
    {id:'cardCol',label:'The card’s category',type:'choice',options:[
      {id:'bonus',label:'Bonus category',current:true,hint:'Approved: the category the points came from, None in amber.'},
      {id:'path',label:'Merchant category path',hint:'Travel › Hotels. Unknown in amber. Fees, credits and payments show —.'},
      {id:'kind',label:'Merchant category, kind badges',hint:'Fees, credits, payments and refunds get a grey badge in the same cell, so the Type column can go.'}]},
    {id:'brandCol',label:'Brand',type:'choice',options:[
      {id:'off',label:'Not shown',current:true},{id:'col',label:'Its own column'},
      {id:'inline',label:'Tag after the merchant name'},{id:'card',label:'In the card’s category cell',hint:'Hotels · Hilton'}]},
    {id:'typeCol',label:'Type',type:'choice',options:[
      {id:'type',label:'Expense or Credit',current:true,hint:'Approved.'},{id:'kind',label:'Kind',hint:'Purchase, Refund, Credit, Fee, Interest, Payment.'},
      {id:'badge',label:'Only when it isn’t a purchase'},{id:'off',label:'Off'}]},
    {id:'spCol',label:'Spender',type:'choice',options:[
      {id:'always',label:'Always',current:true,hint:'Approved.'},{id:'auto',label:'Only on cards with spender tags',hint:'Shows on BBP, hidden on the other three.'},{id:'off',label:'Off'}]},
    {id:'ptsCol',label:'Rate and points',type:'choice',options:[
      {id:'two',label:'Rate and Points columns',current:true},{id:'one',label:'One column, rate under the points'},{id:'pts',label:'Points only, rate on hover'}]},
    {id:'amtStyle',label:'Amount',type:'choice',options:[
      {id:'card',label:'Card statement style',current:true,hint:'Approved: $107.00 for a charge, green −$100.00 for a credit.'},
      {id:'signed',label:'Transactions page style',hint:'−$107.00 in red, +$100.00 in green, payments plain.'}]},
    {id:'dateFmt',label:'Date',type:'choice',options:[{id:'mon',label:'Oct 25',current:true},{id:'num',label:'10/25, as on Transactions'}]},
    {id:'rowStyle',label:'Rows',type:'choice',options:[{id:'plain',label:'Today’s table rows',current:true},{id:'ledger',label:'Dense ledger, striped (Transactions page)'}]},
    {id:'payments',label:'Card payments',type:'choice',options:[
      {id:'hide',label:'Hidden',current:true,hint:'Today the page lists expense rows only.'},{id:'show',label:'Shown, dimmed, no points'}]},
    {id:'pending',label:'Pending charges',type:'choice',options:[
      {id:'skip',label:'Not shown until they post',current:true,hint:'The sync skips pending charges today.'},
      {id:'top',label:'At the top, marked Pending',hint:'Needs a sync change to store them. The preview marks the newest charge as pending to show the look.'}]},
   ]},
   {id:'find',label:'Filters and search',controls:[
    {id:'period',label:'Date selector',type:'choice',options:[
      {id:'own',label:'Monthly, QTD, YTD, Custom',current:true,hint:'Approved.'},
      {id:'stmt',label:'Statement periods',hint:'Step through statements by close day; Month, Year to date and Custom too.'},
      {id:'ymd',label:'Year and month dropdowns with dates',hint:'Transactions page.'}]},
    {id:'filterStyle',label:'Filters',type:'choice',options:[
      {id:'chips',label:'Bonus category chips',current:true,hint:'Approved: one row of chips.'},
      {id:'menus',label:'Filter menus (Transactions page)',hint:'Your category, merchant category, brand, spender and kind, each a checklist with counts. A top level includes its sub-categories.'},
      {id:'tops',label:'Your top levels as chips',hint:'Click a top level to see its sub-categories as chips; merchant category, brand and spender as menus.'}]},
    {id:'fBrand',label:'Brand filter',type:'toggle',default:false},
    {id:'fUnknown',label:'Unknown merchant chip with its count',type:'toggle',default:false},
    {id:'search',label:'Search box',type:'choice',options:[{id:'box',label:'Outlined box',current:true},{id:'line',label:'Underline (Transactions page)'}]},
   ]},
   {id:'order',label:'Order and grouping',controls:[
    {id:'group',label:'Grouping',type:'choice',options:[
      {id:'none',label:'None, latest first',current:true},{id:'stmt',label:'By statement',hint:'Each header says open or closed, and when it’s due.'},
      {id:'month',label:'By month'},{id:'cat',label:'By category',hint:'Biggest spend first.'}]},
    {id:'groupCat',label:'By category uses',type:'choice',options:[{id:'yours',label:'Your top level'},{id:'card',label:'The merchant category'}]},
    {id:'groupSub',label:'Subtotals in group headers',type:'toggle',default:true},
    {id:'groupFold',label:'Older groups start folded',type:'toggle',default:false},
    {id:'sortable',label:'Click a header to sort',type:'toggle',default:true},
    {id:'length',label:'Long lists',type:'choice',options:[
      {id:'more',label:'Latest 12, then Show all',current:true,hint:'Approved.'},{id:'all',label:'The whole period'},{id:'scroll',label:'The panel scrolls, headers stay'}]},
   ]},
   {id:'edit',label:'Changing a row',controls:[
    {id:'catEdit',label:'Your category',type:'choice',options:[
      {id:'none',label:'Read-only here',current:true},{id:'pill',label:'Click it: grouped list with search',hint:'One click saves, as on the Transactions page. Needs the column on.'},
      {id:'menu',label:'From the ⋯ menu'}]},
    {id:'spEdit',label:'Spender',type:'choice',options:[
      {id:'click',label:'Click the cell: pick or add a name',current:true,hint:'Today’s behavior.'},{id:'menu',label:'From the ⋯ menu'},{id:'bulk',label:'Only for selected rows'}]},
    {id:'merchEdit',label:'Merchant category and brand',type:'choice',options:[
      {id:'none',label:'Read-only here',current:true,hint:'Edited in the Transactions page’s details window.'},
      {id:'unknown',label:'Set it when Unknown',hint:'Click the amber Unknown. Saves a merchant rule for every card, then the before-and-after recalculation.'},
      {id:'details',label:'⋯ → Transaction details',hint:'Opens the Transactions page’s details window, merchant category box included.'}]},
    {id:'extras',label:'Splits and notes',type:'choice',options:[
      {id:'none',label:'Not here',current:true},{id:'menu',label:'⋯ → Split…, Add note…',hint:'A note shows under the merchant name. Notes need a new field on transactions.'},
      {id:'details',label:'Through the details window'}]},
    {id:'rowClick',label:'Clicking a row',type:'choice',options:[
      {id:'none',label:'Nothing',current:true},{id:'expand',label:'Opens a strip under the row',hint:'The card’s view beside yours.'},{id:'details',label:'Opens the details window'}]},
    {id:'selBar',label:'Selection bar',type:'choice',options:[
      {id:'spender',label:'Tag a spender',current:true,hint:'Today’s bar.'},{id:'full',label:'Category, spender, exclude'},{id:'tx',label:'Edit selected (Transactions page)'}]},
   ]},
   {id:'tot',label:'Totals and empty states',controls:[
    {id:'totals',label:'Totals',type:'choice',options:[
      {id:'bar',label:'Totals bar',current:true,hint:'Approved: spend, points, rows missing a category.'},
      {id:'strip',label:'Uppercase line (Transactions page)'},{id:'figs',label:'Figure tiles',hint:'Adds points per dollar of spend.'}]},
    {id:'totCredits',label:'Show credits and refunds',type:'toggle',default:false},
    {id:'empty',label:'Empty list',type:'choice',options:[
      {id:'plain',label:'“No transactions for this period.”',current:true},{id:'helpful',label:'Say when the last charge was, offer to go there'}]},
   ]},
   {id:'decided',label:'Decided earlier (Card page, rounds 1-8)',open:false,controls:[
    {id:'look',label:'Look',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud, brand blue, Outfit + Plus Jakarta, 13px corners',tokens:Object.assign(light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F'),{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"})}]},
    {id:'layoutD',label:'Layout',type:'choice',locked:true,options:[{id:'rail',label:'Transactions in the main column, Earnings then Benefits beside it'}]},
    {id:'menuD',label:'Row ⋯ menu',type:'choice',locked:true,options:[{id:'m',label:'Log credit use…, Exclude from points, Set points by hand'}]},
    {id:'credD',label:'Statement credits',type:'choice',locked:true,options:[{id:'g',label:'Green −$100.00'}]},
    {id:'ptsD',label:'Points',type:'choice',locked:true,options:[{id:'c',label:'+14 green, −14 red, 0 grey'}]},
    {id:'linkD',label:'Linked purchase',type:'choice',locked:true,options:[{id:'dot',label:'Green $ circle after the merchant'}]},
   ]},
  ],
  render(p,d,h){if(!L||L.card!==p.card||L.data!==p.data||L.period!==p.period||L.fs!==p.filterStyle){resetS();S.r=defPeriod(p)}
    if(L&&(L.group!==p.group||L.groupCat!==p.groupCat||L.fold!==p.groupFold))S.coll=null;
    L=Object.assign(L||{},{d,h,picks:p,card:p.card,data:p.data,period:p.period,fs:p.filterStyle,group:p.group,groupCat:p.groupCat,fold:p.groupFold});
    TODAY=d.today;PAR={};d.cats.forEach(c=>{if(c.p)PAR[c.n]=c.p});S.pop=null;S.modal=null;
    return page(p)},
  after(root,p){L.root=root;L.picks=p;wire(root,p)},
  css:`
#pv{--c-radius:13px;--c-density:1.25;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density))}
#pv *{box-sizing:border-box}
#pv [hidden]{display:none!important}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
#pv button:disabled{opacity:.35;cursor:default}
#pv button:focus-visible,#pv input:focus-visible,#pv select:focus-visible,#pv textarea:focus-visible,#pv tr:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv h1,#pv h2,#pv h3,#pv h4,#pv .val{font-family:var(--f-h)}
#pv h2{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);margin:0 0 var(--gap)}
#pv .ct{font-weight:500;letter-spacing:0;text-transform:none;margin-left:4px}
#pv .up{color:var(--good)}#pv .neg{color:var(--bad)}#pv .ac{color:var(--ac)}#pv .warn-t{color:var(--warn)}#pv .dim{color:var(--tx3)}#pv .mut{color:var(--tx3);font-size:12px}
#pv .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
#pv .app{position:relative;display:flex;flex-direction:column;min-height:100vh}
#pv .main{width:100%;min-width:0;padding:calc(22px*var(--c-density)) calc(26px*var(--c-density));display:grid;gap:calc(22px*var(--c-density));align-content:start}
#pv .main>*,#pv section,#pv .col{min-width:0}
#pv .col{display:grid;gap:calc(24px*var(--c-density));align-content:start}
#pv .rail{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(270px,1fr);gap:calc(var(--gap)*2);align-items:start}
#pv .appnav{display:flex;align-items:center;gap:14px;background:var(--surface);border-bottom:1px solid var(--line);padding:8px 16px;min-width:0}
#pv .brand{display:flex;align-items:center;gap:9px;font-family:var(--f-h);font-weight:600}
#pv .brand i{font-style:normal;width:30px;height:30px;border-radius:8px;background:var(--ac);color:var(--ac-fg);display:grid;place-items:center}
#pv .nv{display:flex;overflow-x:auto;gap:2px;min-width:0}
#pv .nv button{padding:7px 10px;border-radius:8px;color:var(--tx2);font-size:13.5px;white-space:nowrap}
#pv .nv button.on{background:var(--ac-soft);color:var(--ac);font-weight:600}
#pv .hdr{display:flex;justify-content:space-between;align-items:center;gap:10px 20px;flex-wrap:wrap;padding:10px 18px}
#pv .crumbs{display:flex;gap:7px;align-items:center;font-size:13px;flex-wrap:wrap}
#pv .crumbs button{color:var(--ac)}#pv .crumbs i{font-style:normal;color:var(--tx3)}#pv .crumbs b{font-weight:600}
#pv .und{display:flex;gap:16px;flex-wrap:wrap}
#pv .und button{padding:5px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12px}
#pv .und button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .btn{font-size:12px;font-weight:500;color:var(--ac);padding:5px 10px;border:1px solid var(--line);border-radius:8px;white-space:nowrap;background:var(--surface)}
#pv .btn:hover{background:var(--ac-soft)}#pv .btn.pri{background:var(--ac);color:var(--ac-fg);border-color:var(--ac)}#pv .btn.ghost{color:var(--tx2)}
#pv .lnk{color:var(--ac);font-size:12px;font-weight:500}
#pv .ib{width:24px;height:24px;border-radius:7px;display:inline-grid;place-items:center;color:var(--tx2);font-size:15px}#pv .ib:hover:not(:disabled){background:var(--ac-soft);color:var(--ac)}
#pv .pn{padding:calc(var(--p)*1.05)}
#pv .emp{font-size:12.5px;color:var(--tx3);margin:4px 0}#pv .emp.c{text-align:center;padding:18px 0}
#pv .bar{height:6px;border-radius:6px;background:var(--line);overflow:hidden}#pv .bar i{display:block;height:100%;background:var(--ac);border-radius:6px}
/* Banner */
#pv .ban{border-radius:calc(var(--c-radius)*1.3);padding:calc(var(--p)*1.25);color:#fff;display:grid;gap:calc(var(--gap)*1.1)}
#pv .ban-t{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
#pv .ban-n{display:flex;align-items:center;gap:10px}#pv .ban h1{font-size:21px;font-weight:600;margin:0}
#pv .ban p{margin:3px 0 12px;font-size:12.5px;opacity:.8}
#pv .dots{width:28px;height:28px;border-radius:50%;background:#fff;color:#0F172A;font-weight:700;line-height:1}
#pv .ban-art{width:150px;border-radius:9px;box-shadow:0 7px 14px -6px rgba(0,0,0,.5);flex:none}
#pv .bal small{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.72)}#pv .bal b{font:600 28px var(--f-h)}
#pv .ban-f{display:flex;flex-wrap:wrap;gap:10px calc(var(--gap)*2.2)}
#pv .st{display:grid;gap:2px}#pv .st span{font-size:11px;color:rgba(255,255,255,.72)}#pv .st b{font-size:15px;font-weight:600}
#pv .u{display:grid;gap:4px}#pv .u-l{display:flex;justify-content:space-between;font-size:11.5px;color:rgba(255,255,255,.8)}#pv .ban .bar{background:rgba(255,255,255,.22)}#pv .ban .bar i{background:#fff}
/* Side column (context) */
#pv .t{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
#pv .t th{font-weight:500;font-size:11px;color:var(--tx3);text-align:left;padding:0 8px 8px;white-space:nowrap;border-bottom:1px solid var(--line)}
#pv .t td{padding:8px;border-bottom:1px solid var(--line);vertical-align:middle}
#pv .t th:first-child,#pv .t td:first-child{padding-left:0}#pv .t th:last-child,#pv .t td:last-child{padding-right:0}
#pv .t .n{text-align:right}#pv .t .nw{white-space:nowrap}
#pv .et td:first-child{width:52%}#pv .eb{display:grid;gap:3px}#pv .eb i{display:block;height:4px;border-radius:4px;background:color-mix(in srgb,var(--ac) 55%,transparent)}
#pv .bn{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}#pv .bn:last-child{border:0}
#pv .bn b{display:block;font-weight:500;font-size:13px}#pv .bn small{font-size:11.5px;color:var(--tx3)}
#pv .tg{font-size:10px;padding:1px 6px;border-radius:5px;margin-left:4px}#pv .tg.auto{background:var(--ac-soft);color:var(--ac)}#pv .tg.hand{background:color-mix(in srgb,var(--warn) 12%,transparent);color:var(--warn)}
#pv .pill2{font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px;white-space:nowrap}#pv .pill2.o{background:color-mix(in srgb,var(--warn) 14%,transparent);color:var(--warn)}#pv .pill2.d{background:color-mix(in srgb,var(--good) 14%,transparent);color:var(--good)}
/* Toolbar */
#pv .tb{display:grid;gap:10px;margin-bottom:12px}
#pv .tb1{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between}
#pv .per{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
#pv .nav{display:inline-flex;align-items:center;gap:4px;font-size:12.5px}#pv .nav b{font-weight:600;min-width:84px;text-align:center}
#pv .sst{font-size:11.5px;color:var(--tx3)}#pv .sst.o{color:var(--ac)}
#pv .dr{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--tx3)}
#pv .inp{font:inherit;font-size:12px;padding:5px 8px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--tx);min-width:0;max-width:100%}
#pv .inp.d{width:132px}
#pv .srch{font:inherit;font-size:12.5px;color:var(--tx);background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:6px 10px;flex:1 1 170px;max-width:270px}
#pv .srch.line{background:none;border:0;border-bottom:1.5px solid var(--line);border-radius:0;padding:5px 2px}#pv .srch.line:focus{border-bottom-color:var(--ac);outline:0}
#pv .t-ch{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#pv .t-ch.sub{padding-left:10px;border-left:2px solid var(--line)}#pv .t-ch .lbl{font-size:11.5px;color:var(--tx3);margin-right:2px}
#pv .chip{padding:4px 11px;border:1px solid var(--line);border-radius:99px;font-size:12px;color:var(--tx2);display:inline-flex;align-items:center;gap:6px}
#pv .chip i{width:7px;height:7px;border-radius:50%}#pv .chip em{font-style:normal;color:var(--tx3);font-size:11px}
#pv .chip.on{background:var(--ac);color:var(--ac-fg);border-color:var(--ac);font-weight:600}#pv .chip.on em{color:inherit;opacity:.8}
#pv .chip.warn:not(.on){color:var(--warn)}
#pv .fl{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}
#pv .fchip{font-size:12px;padding:5px 11px;border-radius:99px;background:color-mix(in srgb,var(--tx) 6%,transparent);color:var(--tx2)}
#pv .fchip.on{background:var(--ac-soft);color:var(--ac);font-weight:600}#pv .fchip.w{color:var(--warn)}#pv .fchip.w.on{background:color-mix(in srgb,var(--warn) 14%,transparent)}
#pv .cv{font-size:9px;opacity:.7}
/* Totals */
#pv .t-sum{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:var(--tx2);padding:8px 12px;background:var(--raised);border-radius:8px;margin-bottom:10px}#pv .t-sum b{color:var(--tx);font-weight:600}#pv .t-sum b.up{color:var(--good)}
#pv .strip{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx2);margin:0 0 10px}
#pv .figs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
#pv .fg{flex:1 1 110px;border:1px solid var(--line);border-radius:10px;padding:8px 12px;display:grid;gap:1px}#pv .fg b{font-size:17px;font-weight:600}#pv .fg span{font-size:11px;color:var(--tx3)}#pv .fg.w b{color:var(--warn)}
#pv .selbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:7px 10px;margin-bottom:10px;border-radius:9px;background:var(--ac-soft);font-size:12.5px}#pv .selbar b{color:var(--ac);margin-right:4px}#pv .selbar .ghost{margin-left:auto}
/* Transactions table */
#pv .t-s{overflow-x:auto}
#pv .t-s.cap{max-height:540px;overflow:auto}#pv .t-s.cap thead th{position:sticky;top:0;background:var(--surface);z-index:1}
#pv .tx th .sb{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--tx3);font-weight:500}#pv .tx th .sb i{font-style:normal;font-size:9px;opacity:.55}#pv .tx th .sb.on{color:var(--tx)}#pv .tx th .sb.on i{opacity:1;color:var(--ac)}
#pv .tx th.n .sb{flex-direction:row-reverse}
#pv .tx td{padding:8px 6px}#pv .tx th{padding:0 6px 8px}#pv .tx th .sb{gap:2px}
#pv .tx .ck{width:24px}#pv input[type=checkbox]{accent-color:var(--ac);margin:0}
#pv .tx .dte{color:var(--tx2);white-space:nowrap}
#pv .tx td.mc{width:100%;max-width:0;min-width:130px;overflow:hidden}
#pv .nmw{display:flex;align-items:center;gap:6px;min-width:0}
#pv .mn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-weight:500}
#pv .note{display:block;font-size:11px;color:var(--tx3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .tag{flex:none;font-size:10px;font-weight:600;padding:1px 6px;border-radius:5px;background:color-mix(in srgb,var(--tx) 7%,transparent);color:var(--tx3);white-space:nowrap}
#pv .tag.pd{background:color-mix(in srgb,var(--warn) 14%,transparent);color:var(--warn)}
#pv .btag{flex:none;font-size:10.5px;padding:0 6px;border-radius:5px;border:1px solid var(--line);color:var(--tx2);white-space:nowrap}
#pv .lk1{flex:none;width:15px;height:15px;border-radius:50%;background:var(--good);color:#fff;font-size:9.5px;font-weight:700;display:inline-grid;place-items:center}
#pv .car{flex:none;font-size:10px;color:var(--tx3);width:16px;height:16px;border-radius:4px;transition:transform .12s}#pv .car.on{transform:rotate(90deg);color:var(--ac)}
#pv .pill{display:inline-block;vertical-align:middle;font-size:11.5px;padding:2px 8px;border-radius:99px;background:var(--ac-soft);color:var(--ac);white-space:nowrap;max-width:175px;overflow:hidden;text-overflow:ellipsis}
#pv .ctx,#pv .cdot,#pv .cst b{max-width:165px;overflow:hidden;text-overflow:ellipsis}#pv .ctx{display:inline-block;vertical-align:middle}
#pv .pill .pp{opacity:.68}#pv .pen{font-size:9.5px;opacity:.7;margin-left:3px}
#pv .cdot{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}#pv .cdot i{width:8px;height:8px;border-radius:50%;flex:none}
#pv .cst{display:grid;line-height:1.2}#pv .cst b{font-weight:500;font-size:12.5px;white-space:nowrap}#pv .cst small{font-size:10.5px;color:var(--tx3)}
#pv .ctx{white-space:nowrap}#pv .ctx .pp{color:var(--tx3)}
#pv .kb{display:inline-block;font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:5px;background:color-mix(in srgb,var(--tx) 7%,transparent);color:var(--tx2);white-space:nowrap}
#pv .spn{font-size:11.5px;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,#7C3AED 11%,transparent);color:#6D28D9;white-space:nowrap}
#pv .cbtn{display:inline-flex;align-items:center;gap:4px;border-radius:7px;padding:1px 2px;max-width:100%}#pv .cbtn:hover{background:var(--ac-soft)}
#pv .cbtn.unk{border:1px dashed color-mix(in srgb,var(--warn) 55%,transparent);padding:0 6px}
#pv .p2{display:inline-grid;justify-items:end;line-height:1.15}#pv .p2 small{font-size:10.5px;color:var(--ac)}
#pv .tx .am{white-space:nowrap;font-weight:500}
#pv .dotb{width:26px;height:24px;border-radius:7px;color:var(--tx2);font-weight:700}#pv .dotb:hover{background:var(--ac-soft);color:var(--ac)}
#pv .tx tr.exc td:not(.ra):not(.ck){opacity:.5}#pv .tx tr.pay td:not(.ra):not(.ck){opacity:.55}
#pv .tx tr.pend td{font-style:italic;color:var(--tx3)}#pv .tx tr.pend .mn{font-weight:400}
#pv .tx tr.sel td{background:var(--ac-soft)}
#pv .tx tr.clk{cursor:pointer}#pv .tx tr.clk:hover td{background:color-mix(in srgb,var(--ac) 5%,transparent)}
#pv .tx.ledger td{padding-top:5px;padding-bottom:5px}#pv .tx.ledger tbody tr.tr:nth-child(even) td{background:color-mix(in srgb,var(--tx) 2.6%,transparent)}
#pv .tx.ledger tbody tr.tr.sel td{background:var(--ac-soft)}
#pv .gh td{padding:12px 0 6px;border-bottom:1px solid var(--line);background:none!important}
#pv .gh.pg td{padding-top:4px}
#pv .ghw{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
#pv .gt{display:inline-flex;align-items:center;gap:7px;font:600 13px var(--f-h);color:var(--tx)}
#pv .chev{font-size:9px;color:var(--tx3);transition:transform .12s}#pv .chev.on{transform:rotate(90deg)}
#pv .gd{width:8px;height:8px;border-radius:50%}
#pv .gtag{font:500 11px var(--f-b);color:var(--tx3);padding:1px 7px;border-radius:99px;background:color-mix(in srgb,var(--tx) 6%,transparent)}#pv .gtag.o{color:var(--ac);background:var(--ac-soft)}
#pv .gs{font-size:11.5px;color:var(--tx2);font-variant-numeric:tabular-nums}
#pv .xp td{background:var(--raised)!important;padding:10px 12px 12px}
#pv .xpg{display:grid;grid-template-columns:1fr 1fr;gap:14px 26px}
#pv .xpg h4{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3)}
#pv .xpg dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:12px}#pv .xpg dt{color:var(--tx3)}#pv .xpg dd{margin:0}
#pv .sp td{padding-top:3px;padding-bottom:3px;border-bottom:1px dashed var(--line);font-size:12px;color:var(--tx2)}#pv .spr small{color:var(--tx3)}
#pv .t-more{display:flex;justify-content:center;padding-top:12px}
#pv .empty{display:grid;justify-items:center;gap:6px;text-align:center;padding:26px 10px 18px;font-size:12.5px;color:var(--tx2)}#pv .empty b{font:600 14px var(--f-h);color:var(--tx)}#pv .empty .btn{margin-top:6px}
/* Popovers, windows, toast */
#pv .pops{position:absolute;inset:0;pointer-events:none}#pv .pops>*{pointer-events:auto}
#pv .pop{position:absolute;z-index:20;background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:0 12px 30px rgba(15,23,42,.18);padding:8px;display:grid;gap:6px}
#pv .pop.menu{padding:4px;gap:0}
#pv .ph{font:600 12.5px var(--f-h);padding:2px 4px}#pv .pn2{margin:0 4px;font-size:11px;color:var(--tx3)}
#pv .pq{width:100%}
#pv .pl{display:grid;max-height:260px;overflow:auto;gap:1px}
#pv .po{text-align:left;font-size:12.5px;padding:5px 8px;border-radius:6px;display:flex;align-items:center;gap:7px}#pv .po:hover{background:var(--ac-soft)}#pv .po.on{color:var(--ac);font-weight:600}
#pv .po.top{font-weight:600}#pv .po.top i{width:8px;height:8px;border-radius:50%}#pv .po.sub{padding-left:24px}#pv .po.dim2{color:var(--tx3)}
#pv .padd{display:flex;gap:6px}#pv .padd .inp{flex:1}
#pv .mi{text-align:left;font-size:12.5px;padding:7px 9px;border-radius:6px}#pv .mi:hover{background:var(--ac-soft)}
#pv .pop hr{border:0;border-top:1px solid var(--line);margin:4px 2px}
#pv .fo{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 6px;border-radius:6px;cursor:pointer}#pv .fo:hover{background:var(--ac-soft)}#pv .fo span{flex:1}#pv .fo em{font-style:normal;font-size:11px;color:var(--tx3)}#pv .fo.sub{padding-left:24px}
#pv .pf{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--line);padding-top:7px}#pv .pf span{display:flex;gap:12px}
#pv textarea.nt{width:100%;resize:vertical}
#pv .mdl-bk{position:absolute;inset:0;background:rgba(15,23,42,.32);z-index:30}
#pv .mdl{position:absolute;left:50%;transform:translateX(-50%);z-index:31;width:min(560px,calc(100% - 24px));background:var(--surface);border-radius:14px;box-shadow:0 22px 50px rgba(15,23,42,.3);display:grid}
#pv .mh{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px 10px;border-bottom:1px solid var(--line)}#pv .mh h3{margin:0;font-size:15px}#pv .mh small{font-size:11px;color:var(--tx3)}
#pv .mb{padding:14px 16px;display:grid;gap:10px}#pv .mf{display:flex;justify-content:space-between;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--line)}#pv .mf span{display:flex;gap:8px}
#pv .dbox{border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:grid;gap:3px;font-size:12.5px}#pv .dbox small{color:var(--tx3);font-size:11.5px}#pv .dbox .row{display:flex;justify-content:space-between;font-size:11px;color:var(--tx3)}
#pv .tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}#pv .tl{border:1px solid var(--line);border-radius:10px;padding:8px 10px;display:grid;gap:2px}#pv .tl span{font-size:10.5px;color:var(--tx3)}#pv .tl b{font-size:12.5px;font-weight:600}
#pv .fld{display:grid;gap:4px;font-size:12px;color:var(--tx2)}
#pv .toast{position:absolute;right:28px;z-index:40;background:#0F172A;color:#fff;font-size:12.5px;padding:8px 14px;border-radius:9px;box-shadow:0 8px 20px rgba(15,23,42,.25)}
@media (max-width:980px){#pv .rail{grid-template-columns:minmax(0,1fr)}}
`});
})();
