// Design gallery spec for the Daily Balances page (liquidity), desktop.
// Content comes from the data file; this file holds no personal figures.
// The look (Cloud, brand blue, Outfit + Plus Jakarta, hairline panels, top bar,
// underlined controls) was decided on the Cards pages and is locked here.
// Purpose (Omer, 2026-11-05): see what liquid money is available to cover
// bills as they come due, mainly card payments, without the Excel sheet's
// one-column-per-account horizontal scrolling.
(function(){
const ICONS={home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',tx:'<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/>',cal:'<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="3" x2="21" y1="10" y2="10"/>',cash:'<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/>',bank:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/>',star:'<polygon points="12 2 15 8 22 9 17 14 18 21 12 18 6 21 7 14 2 9 9 8"/>',card:'<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',wallet:'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>',down:'<path d="m6 9 6 6 6-6"/>',right:'<path d="m9 6 6 6-6 6"/>',alert:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',check:'<path d="M20 6 9 17l-5-5"/>',
  inA:'<path d="M17 7 7 17M7 7v10h10"/>',outA:'<path d="M7 17 17 7M7 7h10v10"/>',swap:'<path d="m17 3 4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3"/>',home2:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',dots:'<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};
const ic=(n,s=15)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'var(--ac-l)','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,var(--ac-l) 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C','--plate':'#fff'});
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DEFAULT_PAYER=126;   // Chase Checking 8997 pays almost every card

/* ── Preview state that survives re-renders ──────────────── */
const S={hz:'30',lens:'acct',focus:null,tr:[],wk:new Set(),wkInit:false,day:null,row:null,tab:'main',col:{'Other Assets':true},cards:false};
let L=null,M=null,MK='';

/* ── Small helpers ────────────────────────────────────────── */
const pad=n=>String(n).padStart(2,'0');
const dt=s=>new Date(s+'T12:00:00');
const iso=x=>`${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
const addD=(s,k)=>{const x=dt(s);x.setDate(x.getDate()+k);return iso(x)};
const diffD=(a,b)=>Math.round((dt(b)-dt(a))/864e5);
const shortD=s=>{const x=dt(s);return `${MON[x.getMonth()]} ${x.getDate()}`};
const dowD=s=>{const x=dt(s);return `${DOW[x.getDay()]}, ${MON[x.getMonth()]} ${x.getDate()}`};
const range=(a,b)=>{const x=dt(a),y=dt(b);return x.getMonth()===y.getMonth()?`${MON[x.getMonth()]} ${x.getDate()}–${y.getDate()}`:`${shortD(a)}–${shortD(b)}`};
const money=n=>(n<-0.004?'−':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const sgn=n=>(n<0?'−':'+')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const m0=n=>(n<-0.5?'−':'')+'$'+Math.round(Math.abs(n)).toLocaleString('en-US');
const k1=n=>{const a=Math.abs(n),s=n<0?'−':'';return a>=1e6?s+'$'+(a/1e6).toFixed(2)+'M':a>=1e4?s+'$'+Math.round(a/1e3)+'k':a>=1e3?s+'$'+(a/1e3).toFixed(1)+'k':s+'$'+Math.round(a)};
const paren=v=>{if(v==null)return'—';const a=Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});return v<0?`(${a})`:a};
const esc=s=>L.h.esc(s==null?'':String(s));
const plural=(n,w,ws)=>`${n} ${n===1?w:(ws||w+'s')}`;
function tcase(s){
  if(!s||/[a-z]/.test(s))return s;
  return s.split(/(\s+|[\/\-*#&.,()])/).map(w=>{if(!/[A-Z]/.test(w))return w;
    if(/\d/.test(w)||(w.length<=3&&!/[AEIOUY]/.test(w)))return w;
    const lw=w.toLowerCase();return lw.charAt(0).toUpperCase()+lw.slice(1)}).join('');
}
const tidy=s=>tcase((s||'').replace(/\b(PPD|WEB) ID:.*$/,'').replace(/\s+[A-Z0-9]{10,}\s*$/,'').trim());
const pageName=p=>({daily:'Daily Balances',liq:'Liquidity',bills:'Cash & Bills'})[p.name];

/* ── The forecast model ──────────────────────────────────── */
const HZ={'30':['Next 30 days',t=>addD(t,30)],'60':['Next 60 days',t=>addD(t,60)],
  'eom':[null,t=>{const x=dt(t);return iso(new Date(x.getFullYear(),x.getMonth()+2,0))}]};
const hzLabel=(k,t)=>k==='eom'?`Through ${MONL[(dt(t).getMonth()+1)%12]}`:HZ[k][0];
const lensOf=p=>p.lens==='both'?S.lens:p.lens;

function model(p){
  const d=L.d,lens=lensOf(p);
  const key=[p.amount,p.nextStmt,p.nodue,p.cushion,lens,S.hz,JSON.stringify(S.tr)].join('|');
  if(M&&MK===key&&M.d===d)return M;
  const T=d.today,end=HZ[S.hz][1](T),cush=+p.cushion,A={};
  d.accounts.forEach(a=>A[a.id]=a);
  const payers=d.accounts.filter(a=>a.group==='cash'||a.group==='savings').map(a=>a.id);
  const isPayer=id=>payers.includes(id);
  const ev=[],unsched=[];
  d.events.forEach(e=>{if(e.d>=T&&e.d<=end)ev.push(Object.assign({},e))});
  d.cards.forEach(c=>{
    const from=c.payFrom||DEFAULT_PAYER,noFrom=!c.payFrom;
    if(c.due){
      const amt=p.amount==='stmt'?c.stmtLeft:c.owedNow,due=c.due<T?T:c.due;
      if(amt>0.004&&due<=end)ev.push({d:due,acct:from,amt:-amt,kind:'card',label:c.name,card:c.id,noFrom,closed:c.close,stmt:c.stmt});
      if(p.amount==='stmt'&&p.nextStmt&&c.newCharges>0.004&&c.nextDue<=end)
        ev.push({d:c.nextDue,acct:from,amt:-c.newCharges,kind:'card',label:c.name,card:c.id,est:true,noFrom,closed:c.nextClose});
    }else if(c.owedNow>0.004){
      if(p.nodue==='worst')ev.push({d:T,acct:from,amt:-c.owedNow,kind:'card',label:c.name,card:c.id,nodue:true,noFrom});
      else unsched.push(c);
    }
  });
  S.tr.forEach((t,i)=>{
    ev.push({d:t.d,acct:t.from,amt:-t.amt,kind:'move',label:`Move to ${A[t.to].name}`,tr:i,other:t.to});
    ev.push({d:t.d,acct:t.to,amt:t.amt,kind:'move',label:`Move from ${A[t.from].name}`,tr:i,other:t.from});
  });
  ev.sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:b.amt-a.amt);   // money in before money out on the same day
  const days=[];for(let x=T;x<=end;x=addD(x,1))days.push(x);
  const proj={};d.accounts.forEach(a=>proj[a.id]=days.map(()=>a.bal));
  const bump=(id,i,v)=>{const r=proj[id];if(!r)return;for(let k=i;k<r.length;k++)r[k]+=v};
  ev.forEach(e=>{const i=days.indexOf(e.d);if(i<0)return;bump(e.acct,i,e.amt);if(e.kind==='card')bump(e.card,i,-e.amt)});
  const run={};let pool=payers.reduce((s,id)=>s+A[id].bal,0);const cashNow=pool;
  ev.forEach(e=>{run[e.acct]=(run[e.acct]!=null?run[e.acct]:A[e.acct].bal)+e.amt;e.after=run[e.acct];if(isPayer(e.acct))pool+=e.amt;e.poolAfter=pool});
  const poolS=days.map((_,i)=>payers.reduce((s,id)=>s+proj[id][i],0));
  const lowOf=arr=>{let mi=0;arr.forEach((v,i)=>{if(v<arr[mi])mi=i});const f=arr.findIndex(v=>v<cush-0.005);return{low:arr[mi],lowD:days[mi],first:f<0?null:days[f]}};
  const lows={};payers.forEach(id=>{lows[id]=Object.assign({id,pays:ev.some(e=>e.acct===id&&e.amt<0)},lowOf(proj[id]))});
  const poolLow=Object.assign({id:'pool',pays:true},lowOf(poolS));
  const shortA=payers.map(id=>lows[id]).filter(l=>l.pays&&l.first).sort((a,b)=>a.low-b.low);   // deepest shortfall first
  const out=ev.filter(e=>e.kind==='card'||e.kind==='loan'),inc=ev.filter(e=>e.kind==='income');
  const dueTot=-out.reduce((s,e)=>s+e.amt,0),inTot=inc.reduce((s,e)=>s+e.amt,0);
  const invest=d.accounts.filter(a=>a.group==='invest');
  M={d,T,end,cush,lens,A,payers,isPayer,ev,unsched,days,proj,poolS,lows,poolLow,shortA,out,inc,dueTot,inTot,cashNow,invest,
     endPool:poolS[poolS.length-1]};
  M.plan=coverPlan(M);
  MK=key;return M;
}

// Plain arithmetic: how much each short account needs, and what other accounts can spare.
function coverPlan(m){
  const targets=m.lens==='pool'?(m.poolLow.first?[Object.assign({need:m.cush-m.poolLow.low},m.poolLow)]:[])
    :m.shortA.map(l=>Object.assign({need:m.cush-l.low},l));
  const shortIds=new Set(m.shortA.map(l=>l.id));
  const cash=m.lens==='pool'?[]:m.payers.filter(id=>!shortIds.has(id)).map(id=>{
      const r=m.proj[id],spare=Math.min(...r)-m.cush;return{id,spare,kind:'cash'}}).filter(s=>s.spare>=1);
  const inv=m.invest.map(a=>({id:a.id,spare:m.proj[a.id][m.proj[a.id].length-1],kind:'invest'})).filter(s=>s.spare>=1);
  const need=targets.reduce((s,t)=>s+t.need,0),cashSpare=cash.reduce((s,c)=>s+c.spare,0);
  const fromCash=Math.min(need,cashSpare),fromInv=Math.max(0,need-fromCash);
  const to=m.lens==='pool'?(m.shortA[0]?m.shortA[0].id:DEFAULT_PAYER):null;
  return{targets,cash,inv,need,cashSpare,fromCash,fromInv,to};
}
const moveDate=(m,by,kind)=>{const x=addD(by,kind==='invest'?-3:-1);return x<m.T?m.T:x};
const acctFocus=m=>S.focus&&m.A[S.focus]?S.focus:(m.shortA[0]?m.shortA[0].id:DEFAULT_PAYER);
const focusId=m=>m.lens==='pool'?'pool':acctFocus(m);
const nameOf=(m,id)=>id==='pool'?'All cash':m.A[id].name;
const seriesAt=(m,id,i)=>id==='pool'?m.poolS[i]:m.proj[id][i];
function balOn(m,id,day){   // history before today, forecast from today
  const a=m.A[id];
  if(day<m.T){const i=diffD(L.d.histStart,day);return i>=0&&i<a.hist.length?a.hist[i]:a.hist[0]}
  const i=diffD(m.T,day);return m.proj[id][Math.min(i,m.days.length-1)];
}
const poolOn=(m,day)=>m.payers.reduce((s,id)=>s+balOn(m,id,day),0);
const evFor=(m,id)=>id==='pool'?m.ev.filter(e=>m.isPayer(e.acct)&&!(e.kind==='move'&&m.isPayer(e.other))):m.ev.filter(e=>e.acct===id);
const chipAccts=m=>m.payers.filter(id=>m.A[id].bal>=100||m.ev.some(e=>e.acct===id));

/* ── Small pieces ─────────────────────────────────────────── */
function evLabel(e){
  const tags=[];
  if(e.est)tags.push('<span class="tg">next statement, charges so far</span>');
  if(e.nodue)tags.push('<span class="tg warn">no due date, counted today</span>');
  if(e.noFrom)tags.push('<span class="tg warn">pay-from not set</span>');
  const sub=e.kind==='card'&&!e.est&&!e.nodue&&e.closed?`<small>statement closed ${shortD(e.closed)}</small>`:e.kind==='loan'?'<small>monthly payment</small>':'';
  const icn=e.kind==='income'?'inA':e.kind==='move'?'swap':e.kind==='loan'?'home2':'card';
  return `<span class="ev ev-${e.kind}">${ic(icn,14)}</span><span class="evt"><b>${esc(e.label)}</b>${sub}${tags.join('')}</span>`;
}
function focusChips(m,withPool){
  if(m.lens==='pool'&&!withPool)return'';
  const f=withPool?acctFocus(m):focusId(m),ids=chipAccts(m);
  return `<div class="chips" role="group" aria-label="Account">${ids.map(id=>{const sh=m.lows[id]&&m.lows[id].pays&&m.lows[id].first;
    return `<button type="button" data-focus="${id}" class="${f===id?'on':''}">${sh?'<i class="dot bad"></i>':''}${esc(m.A[id].name)}</button>`}).join('')}</div>`;
}
function coverCallout(m,p,t){
  const pl=m.plan;if(!t)return'';
  const src=pl.cash.concat(pl.inv);
  return `<div class="callout"><span class="ci">${ic('alert',15)}</span><div><b>${esc(nameOf(m,t.id))} goes below ${m0(m.cush)} on ${shortD(t.first)}.</b> It needs ${money(t.need)} to stay above the cushion through ${shortD(m.end)}.
    <div class="srcs">${src.length?'Cover from: '+src.map(s=>planBtn(m,s,t)).join(''):'Nothing else can spare money in this window.'}</div></div></div>`;
}
function planBtn(m,s,t,short){
  const to=t.id==='pool'?m.plan.to:t.id,amt=Math.ceil(Math.min(s.spare,t.need)*100)/100;
  if(amt<1)return'';
  const lab=short?`Plan a ${m0(amt)} move`:`${esc(m.A[s.id].name)} <b>${m0(amt)}</b>${s.kind==='invest'?'<small>sell, 2–3 days</small>':''}`;
  return `<button type="button" class="srcb${short?' sm':''}" data-plan data-from="${s.id}" data-to="${to}" data-amt="${amt.toFixed(2)}" data-d="${moveDate(m,t.first,s.kind)}" title="Move ${money(amt)} to ${esc(nameOf(m,to))} on ${shortD(moveDate(m,t.first,s.kind))}">${lab}</button>`;
}

/* ── App chrome ───────────────────────────────────────────── */
function nav(p){
  const NAV=[['Dashboard','home'],['Transactions','tx'],['Budgets','target'],[pageName(p),'cal'],['Cash Flow','cash'],['Loans','bank'],['GCB','star'],['Cards','card'],['Accounts','wallet'],['Settings','gear']];
  return `<nav class="appnav" data-region="decided"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(([l,i])=>`<button type="button" class="${l===pageName(p)?'on':''}">${ic(i)}<span>${esc(l)}</span></button>`).join('')}</div></nav>`;
}
function tabs(p){
  const hasHist=p.history!=='off';
  const T=p.tabs==='two'?[['main','Balances'],['recon','Reconciliation']]:p.tabs==='three'?[['main','Upcoming']].concat(hasHist?[['history','Balance history']]:[]).concat([['recon','Reconciliation']]):[];
  if(!T.length)return'';
  if(!T.some(t=>t[0]===S.tab))S.tab='main';
  return `<div class="und tabs" role="tablist">${T.map(([k,l])=>`<button type="button" role="tab" data-tab="${k}" class="${S.tab===k?'on':''}">${l}</button>`).join('')}</div>`;
}
function header(p,m){
  const last=L.d.accounts.filter(a=>a.group==='cash').map(a=>a.last).filter(Boolean).sort().pop();
  const lensCtl=p.lens==='both'?`<div class="und" role="group" aria-label="View">${[['acct','By account'],['pool','All cash together']].map(([k,l])=>`<button type="button" data-lens="${k}" class="${S.lens===k?'on':''}">${l}</button>`).join('')}</div><span class="vsep"></span>`:'';
  const hz=`<div class="und" role="group" aria-label="Look ahead">${['30','60','eom'].map(k=>`<button type="button" data-hz="${k}" class="${S.hz===k?'on':''}">${hzLabel(k,m.T)}</button>`).join('')}</div>`;
  const menu=p.tabs==='menu'?`<button type="button" class="ibtn" title="More: Reconciliation">${ic('dots',16)}</button>`:'';
  return `<header class="hdr sf" data-region="chrome"><div class="hl"><h1 class="sm">${esc(pageName(p))}</h1><span class="mut">Balances through ${shortD(last||m.T)} · today is ${dowD(m.T)}</span></div>
    ${tabs(p)}
    <div class="hdr-r">${lensCtl}${hz}<button type="button" class="btn">${ic('plus',14)}Planned item</button>${menu}</div></header>`;
}

/* ── Summary ──────────────────────────────────────────────── */
function bigOut(m,id,day){return evFor(m,id).filter(e=>e.d===day&&e.amt<0).sort((a,b)=>a.amt-b.amt)}
function verdictText(m){
  if(m.lens==='pool'){
    const l=m.poolLow;
    if(!l.first)return{ok:true,html:`All your cash together stays above your ${m0(m.cush)} cushion through ${shortD(m.end)}. The lowest point is ${money(l.low)} on ${shortD(l.lowD)}.`};
    const b=bigOut(m,'pool',l.first).slice(0,2).map(e=>esc(e.label));
    return{ok:false,html:`All your cash together drops below ${m0(m.cush)} on <b>${dowD(l.first)}</b>${b.length?`, when ${b.join(' and ')} ${b.length>1?'are':'is'} paid`:''}, and bottoms out at <b class="bad">${money(l.low)}</b> on ${shortD(l.lowD)}.`};
  }
  if(!m.shortA.length)return{ok:true,html:`Every account that pays a bill stays above your ${m0(m.cush)} cushion through ${shortD(m.end)}.`};
  const s=m.shortA.map((l,i)=>{const b=bigOut(m,l.id,l.first).slice(0,2).map(e=>esc(e.label));
    return i===0?`<b>${esc(m.A[l.id].name)}</b> drops below ${m0(m.cush)} on <b>${dowD(l.first)}</b>${b.length?`, when ${b.join(' and ')} ${b.length>1?'are':'is'} paid`:''}, and bottoms out at <b class="bad">${money(l.low)}</b> on ${shortD(l.lowD)}.`
      :`${esc(m.A[l.id].name)} dips to <b class="bad">${money(l.low)}</b> on ${shortD(l.lowD)}${b.length?` (${b.join(', ')})`:''}.`});
  return{ok:false,html:s.join(' ')};
}
function lowFig(m){const l=m.lens==='pool'?m.poolLow:(m.shortA[0]||m.lows[DEFAULT_PAYER]);return{v:l.low,d:l.lowD,who:nameOf(m,l.id)}}
function kv(v,l,sub,cls){return `<div class="kv ${cls||''}"><span class="kn val">${v}</span><span class="kl">${l}</span>${sub?`<span class="ksub">${sub}</span>`:''}</div>`}
function summary(p,m){
  const st=p.summary,lf=lowFig(m);
  if(st==='current'){
    const nw=day=>m.d.accounts.reduce((s,a)=>{const v=day<m.T?balOn(m,a.id,day):a.bal;return s+(a.group==='card'?-Math.abs(v):v)},0);
    const s0=`${m.T.slice(0,8)}01`,now=nw(m.T),st0=nw(s0),chg=now-st0;let pk=-Infinity;for(let x=s0;x<=m.T;x=addD(x,1))pk=Math.max(pk,nw(x));
    const c=(l,v,sub,col)=>`<div class="sf mc"><div class="ml">${l}</div><div class="mv val ${col}">${paren(v)}</div><div class="ms">${sub}</div></div>`;
    return `<section class="mgrid" data-region="summary">${c('Net Worth — Today',now,m.T.toUpperCase(),now>=0?'good':'bad')}${c('Start of Period',st0,s0.toUpperCase(),'good')}${c('Net Change',chg,`<span class="pill ${chg>=0?'good':'bad'}">${chg>=0?'+':''}${(chg/Math.abs(st0)*100).toFixed(1)}%</span>`,chg>=0?'good':'bad')}${c('Period Peak',pk,'ACTUAL HIGH IN RANGE','good')}</section>`;
  }
  const v=verdictText(m);
  if(st==='verdict'){
    return `<section class="sf panel verdict ${v.ok?'ok':'no'}" data-region="summary"><div class="vh"><span class="vi">${ic(v.ok?'check':'alert',18)}</span><p>${v.html}</p></div>
      <div class="figs">${kv(m0(m.cashNow),'Cash on hand now')}${kv(m0(m.dueTot),`Due by ${shortD(m.end)}`,`${plural(m.out.length,'payment')}`)}${kv(m0(m.inTot),'Coming in',`${plural(m.inc.length,'deposit')}`,'gd')}${kv(money(lf.v),'Lowest point',`${esc(lf.who)} · ${shortD(lf.d)}`,lf.v<m.cush?'bd':'')}</div></section>`;
  }
  if(st==='equation'){
    const term=(v,l,cls)=>`<div class="term ${cls||''}"><span class="val">${m0(v)}</span><span>${l}</span></div>`;
    return `<section class="sf panel eqp" data-region="summary"><div class="eq">${term(m.cashNow,'Cash on hand now')}<i>+</i>${term(m.inTot,'Coming in','gd')}<i>−</i>${term(m.dueTot,`Due by ${shortD(m.end)}`)}<i>=</i>${term(m.endPool,`Left on ${shortD(m.end)}`,m.endPool<m.cush?'bd':'gd')}</div>
      <p class="eqn ${v.ok?'':'no'}">${ic(v.ok?'check':'alert',15)}<span>${v.html}</span></p></section>`;
  }
  // coverage: what is going out against what can pay for it
  const avail=m.cashNow+m.inTot,inv=m.invest.reduce((s,a)=>s+a.bal,0),need=m.dueTot+m.cush,mx=Math.max(need,avail+inv);
  const w=v=>`${(Math.max(0,v)/mx*100).toFixed(2)}%`,cov=Math.min(1,avail/need);
  return `<section class="sf panel covp" data-region="summary"><div class="ph"><h2>Can I cover what is due?</h2><span class="mut">${hzLabel(S.hz,m.T)}</span></div>
    <p class="cvh"><span class="val">${Math.round(cov*100)}%</span> of what is due by ${shortD(m.end)}, plus your ${m0(m.cush)} cushion, is covered by cash on hand and money coming in.${cov<1?` The last <b>${m0(need-avail)}</b> would come from investments.`:''}</p>
    <div class="cvrow"><span class="cvl">Going out</span><div class="cvbar"><i class="seg out" style="width:${w(m.dueTot)}" title="Due ${money(m.dueTot)}"></i><i class="seg cush" style="width:${w(m.cush)}" title="Cushion ${money(m.cush)}"></i></div><b class="val">${m0(need)}</b></div>
    <div class="cvrow"><span class="cvl">Available</span><div class="cvbar"><i class="seg cash" style="width:${w(m.cashNow)}" title="Cash ${money(m.cashNow)}"></i><i class="seg inc" style="width:${w(m.inTot)}" title="Coming in ${money(m.inTot)}"></i><i class="seg inv" style="width:${w(inv)}" title="Investments ${money(inv)}"></i><span class="mark" style="left:${w(need)}"></span></div><b class="val">${m0(avail+inv)}</b></div>
    <div class="lg"><span><i class="out"></i>Cards and mortgage ${m0(m.dueTot)}</span><span><i class="cush"></i>Cushion ${m0(m.cush)}</span><span><i class="cash"></i>Cash ${m0(m.cashNow)}</span><span><i class="inc"></i>Coming in ${m0(m.inTot)}</span><span><i class="inv"></i>Investments ${m0(inv)}</span></div>
    <p class="hint">${v.html}</p></section>`;
}

/* ── Forecast chart ───────────────────────────────────────── */
function niceStep(r){const e=Math.pow(10,Math.floor(Math.log10(r))),f=r/e;return(f<=1?1:f<=2?2:f<=5?5:10)*e}
function seriesFor(m,id,p){
  const hd=[];if(p.hist)for(let k=30;k>=1;k--)hd.push(addD(m.T,-k));
  const hv=hd.map(x=>id==='pool'?poolOn(m,x):balOn(m,id,x)),fv=m.days.map((_,i)=>seriesAt(m,id,i));
  return{xs:hd.concat(m.days),vs:hv.concat(fv),ti:hd.length};
}
function stepPath(pts){if(!pts.length)return'';let s=`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;for(let i=1;i<pts.length;i++)s+=`H${pts[i][0].toFixed(1)}V${pts[i][1].toFixed(1)}`;return s}
function drawChart(W,p,m,id,mode,H0){
  const sr=seriesFor(m,id,p),n=sr.xs.length,H=H0||(mode==='flow'?190:240),cp=H<120,pl=62,pr=18,pt=cp?10:20,pb=mode==='flow'?8:cp?22:30;
  const x=i=>pl+(W-pl-pr)*(n<2?0:i/(n-1)),cush=m.cush;
  let lo=Math.min(0,cush,...sr.vs),hi=Math.max(cush,...sr.vs);const padv=(hi-lo)*.08||100;lo-=cp?padv:padv*2.4;hi+=padv;
  const y=v=>pt+(H-pt-pb)*(hi-v)/(hi-lo),yc=y(cush);
  const pts=sr.vs.map((v,i)=>[x(i),y(v)]);
  const histP=stepPath(pts.slice(0,sr.ti+1)),foreP=stepPath(pts.slice(sr.ti));
  const all=stepPath(pts),area=`${all}L${x(n-1).toFixed(1)},${yc.toFixed(1)}L${x(0).toFixed(1)},${yc.toFixed(1)}Z`;
  const under=`${stepPath(pts.slice(sr.ti))}L${x(n-1).toFixed(1)},${(H-pb).toFixed(1)}L${x(sr.ti).toFixed(1)},${(H-pb).toFixed(1)}Z`;
  const st=niceStep((hi-lo)/(cp?2:4));let g='';
  for(let v=Math.ceil(lo/st)*st;v<=hi;v+=st)g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="gl"/><text x="${pl-8}" y="${(y(v)+4).toFixed(1)}" class="ax" text-anchor="end">${k1(v)}</text>`;
  let xt='';if(mode!=='flow')for(let i=0;i<n;i+=7)xt+=`<text x="${x(i).toFixed(1)}" y="${H-10}" class="ax" text-anchor="middle">${shortD(sr.xs[i])}</text>`;
  const uid='c'+Math.random().toString(36).slice(2,7);
  // Outflow days as dots on the line, sized by the day's total.
  const evs=evFor(m,id),byDay={};evs.forEach(e=>{(byDay[e.d]=byDay[e.d]||[]).push(e)});
  let dots='';
  if(p.markers)Object.keys(byDay).forEach(dd=>{const i=sr.xs.indexOf(dd);if(i<0)return;const es=byDay[dd],o=es.filter(e=>e.amt<0),inn=es.filter(e=>e.amt>0);
    const tip=es.map(e=>`${e.label}: ${sgn(e.amt)}`).join('\n');
    const ot=-o.reduce((s,e)=>s+e.amt,0);
    if(ot>=100){const r=cp?Math.min(5,2.5+Math.sqrt(ot)/40):Math.min(10,3+Math.sqrt(ot)/18),v=sr.vs[i];dots+=`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r.toFixed(1)}" class="${v<cush?'dbad':'dout'}"><title>${esc(shortD(dd)+'\n'+tip)}</title></circle>`}
    else if(inn.length){const v=sr.vs[i];dots+=`<path d="M${x(i).toFixed(1)},${(y(v)-9).toFixed(1)}l4,6h-8z" class="din"><title>${esc(shortD(dd)+'\n'+tip)}</title></path>`}});
  const lw=sr.vs.slice(sr.ti).reduce((b,v,i)=>v<b.v?{v,i:i+sr.ti}:b,{v:Infinity,i:sr.ti});
  const lowLbl=`<g class="lowl"><line x1="${x(lw.i).toFixed(1)}" x2="${x(lw.i).toFixed(1)}" y1="${y(lw.v).toFixed(1)}" y2="${(y(lw.v)+14).toFixed(1)}"/><text x="${Math.min(W-pr-4,Math.max(pl+4,x(lw.i))).toFixed(1)}" y="${(Math.min(H-pb-2,y(lw.v)+26)).toFixed(1)}" text-anchor="${x(lw.i)>W-140?'end':x(lw.i)<pl+80?'start':'middle'}" class="${lw.v<cush?'lbad':'llow'}">Lowest ${money(lw.v)} · ${shortD(sr.xs[lw.i])}</text></g>`;
  let bars='';
  if(mode==='flow'){
    const bh=74,by0=H+8,days=m.days,slot=(W-pl-pr)/Math.max(1,n-1),bw=Math.max(2,Math.min(14,slot*.62));
    const tot=days.map(dd=>{const es=byDay[dd]||[];return{o:-es.filter(e=>e.amt<0).reduce((s,e)=>s+e.amt,0),i:es.filter(e=>e.amt>0).reduce((s,e)=>s+e.amt,0)}});
    const mx=Math.max(1,...tot.map(t=>Math.max(t.o,t.i))),mid=by0+bh*.42;
    bars=`<line x1="${pl}" x2="${W-pr}" y1="${mid}" y2="${mid}" class="gl"/><text x="${pl-8}" y="${by0+10}" class="ax" text-anchor="end">in</text><text x="${pl-8}" y="${by0+bh}" class="ax" text-anchor="end">out</text>`+
      tot.map((t,j)=>{const i=j+sr.ti,cx=x(i)-bw/2,ti=days[j],tip=(byDay[ti]||[]).map(e=>`${e.label}: ${sgn(e.amt)}`).join('\n');
        return (t.i?`<rect x="${cx.toFixed(1)}" y="${(mid-t.i/mx*bh*.42).toFixed(1)}" width="${bw.toFixed(1)}" height="${(t.i/mx*bh*.42).toFixed(1)}" class="bin"><title>${esc(shortD(ti)+'\n'+tip)}</title></rect>`:'')+
          (t.o?`<rect x="${cx.toFixed(1)}" y="${mid}" width="${bw.toFixed(1)}" height="${(t.o/mx*bh*.58).toFixed(1)}" class="bout"><title>${esc(shortD(ti)+'\n'+tip)}</title></rect>`:'')}).join('');
    for(let i=0;i<n;i+=7)bars+=`<text x="${x(i).toFixed(1)}" y="${by0+bh+18}" class="ax" text-anchor="middle">${shortD(sr.xs[i])}</text>`;
  }
  const Ht=mode==='flow'?H+108:H;
  return `<svg viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" role="img" aria-label="Balance forecast for ${esc(nameOf(m,id))}">
    <defs><clipPath id="${uid}b"><rect x="0" y="${yc.toFixed(1)}" width="${W}" height="${H}"/></clipPath><clipPath id="${uid}a"><rect x="0" y="0" width="${W}" height="${yc.toFixed(1)}"/></clipPath></defs>
    ${g}<path d="${under}" class="aup" clip-path="url(#${uid}a)"/><path d="${area}" class="adn" clip-path="url(#${uid}b)"/>
    ${lo<0?`<line x1="${pl}" x2="${W-pr}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="zl"/>`:''}
    <line x1="${pl}" x2="${W-pr}" y1="${yc.toFixed(1)}" y2="${yc.toFixed(1)}" class="cl"/>${cp?'':`<text x="${W-pr}" y="${(yc-6).toFixed(1)}" class="clt" text-anchor="end">Cushion ${m0(cush)}</text>`}
    ${sr.ti?`<path d="${histP}" class="lh"/><line x1="${x(sr.ti).toFixed(1)}" x2="${x(sr.ti).toFixed(1)}" y1="${pt-6}" y2="${H-pb}" class="tl"/><text x="${(x(sr.ti)+5).toFixed(1)}" y="${pt}" class="tlt">Today</text>`:''}
    <path d="${foreP}" class="lf"/>${dots}${cp?'':lowLbl}${xt}${bars}</svg>`;
}
function forecast(p,m){
  const id=focusId(m),st=p.chart;
  if(st==='current'){
    const f=id==='pool'?DEFAULT_PAYER:id,acc=m.payers.filter(x=>['Checking','Savings'].includes(m.A[x].type));
    const box=m.days.slice(0,31).map((dd,i)=>{const v=m.proj[f][i],sh=v<m.cush;return `<div class="fbox ${sh?'sh':''}"><span>${shortD(dd).toUpperCase()}</span><b class="val">${m0(v)}</b>${sh?'<em>SHORTFALL</em>':''}</div>`}).join('');
    return `<section class="sf panel" data-region="forecast"><div class="ph"><div><h3 class="t18">Liquidity Forecast</h3><p class="mut">Projected 30-day runway including scheduled flows</p></div>
      <div class="phr"><select class="sel" data-focus-sel aria-label="Account">${acc.map(x=>`<option value="${x}" ${x===f?'selected':''}>${esc(m.A[x].name)}</option>`).join('')}</select><button type="button" class="btn pri">+ Planned Spend</button></div></div>
      <div class="fstrip">${box}</div></section>`;
  }
  if(st==='multi'){
    const ids=(m.lens==='pool'?['pool']:[]).concat(chipAccts(m).filter(i=>m.ev.some(e=>e.acct===i)));
    return `<section class="sf panel" data-region="forecast"><div class="ph"><h2>Balance forecast, each paying account</h2><span class="mut">${hzLabel(S.hz,m.T)}${p.hist?' · last 30 days shaded':''}</span></div>
      <div class="multi">${ids.map(i=>{const l=i==='pool'?m.poolLow:m.lows[i],now=i==='pool'?m.cashNow:m.A[i].bal;
        return `<div class="mrow"><div class="mlab"><b>${esc(nameOf(m,i))}</b><span class="mut">Now ${m0(now)}</span><span class="${l.low<m.cush?'bad':'mut'}">Lowest ${money(l.low)} · ${shortD(l.lowD)}</span></div><div class="chart" data-chart="${i}" data-mode="line" data-h="96"></div></div>`}).join('')}</div></section>`;
  }
  const t=st==='flow'?'Money in and out, and the balance it leaves':'Balance forecast';
  return `<section class="sf panel" data-region="forecast"><div class="ph"><div><h2>${t}</h2><p class="mut sub2">${esc(nameOf(m,id))} · ${hzLabel(S.hz,m.T)}. Dots are payments; hover one for the detail.</p></div>${focusChips(m)}</div>
    <div class="chart" data-chart="${id}" data-mode="${st==='flow'?'flow':'line'}"></div></section>`;
}

/* ── Upcoming: what is due when ───────────────────────────── */
const weekKey=s=>{const x=dt(s),k=(x.getDay()+6)%7;x.setDate(x.getDate()-k);return iso(x)};
function weekName(m,k){const a=k<m.T?m.T:k,b0=addD(k,6),b=b0>m.end?m.end:b0,t0=weekKey(m.T);
  return `${k===t0?'This week':k===addD(t0,7)?'Next week':'Week of '+shortD(k)} · ${a===b?shortD(a):range(a,b)}`}
function unschedNote(m){
  if(!m.unsched.length)return'';
  const tot=m.unsched.reduce((s,c)=>s+c.owedNow,0);
  return `<div class="foot"><span class="ci warn">${ic('clock',14)}</span><div><b>Not on the timeline: ${plural(m.unsched.length,'card')} with no due date set, ${money(tot)} owed.</b>
    <div class="mut">${m.unsched.sort((a,b)=>b.owedNow-a.owedNow).map(c=>`${esc(c.name)} ${money(c.owedNow)}`).join(' · ')}. Set statement and due days in Cards to place them.</div></div></div>`;
}
function upcoming(p,m){
  const st=p.upStyle,pool=m.lens==='pool',cover=p.cover==='inline';
  const rows=pool?evFor(m,'pool'):m.ev;
  const head=`<div class="ph"><h2>${st==='cards'?'Card payments':'What is due, and when'}</h2><span class="mut">${hzLabel(S.hz,m.T)} · ${plural(m.out.length,'payment')} · ${money(m.dueTot)}</span></div>`;
  const after=e=>pool?e.poolAfter:e.after;
  if(st==='register'){
    const seen=new Set();let html='',wk='';
    rows.forEach((e,i)=>{
      const k=weekKey(e.d);
      if(k!==wk){wk=k;const we=rows.filter(r=>weekKey(r.d)===k),o=-we.filter(r=>r.kind!=='move'&&r.amt<0).reduce((s,r)=>s+r.amt,0),n=we.filter(r=>r.kind==='income').reduce((s,r)=>s+r.amt,0);
        html+=`<tr class="wkh"><td colspan="5"><b>${weekName(m,k)}</b><span class="mut">in ${m0(n)} · out ${m0(o)}</span></td></tr>`}
      const a=after(e),sh=a<m.cush,first=i===0||rows[i-1].d!==e.d;
      const key=pool?'pool':e.acct;
      html+=`<tr class="${sh?'short':''}"><td class="dcol">${first?`<b>${DOW[dt(e.d).getDay()]}</b> ${shortD(e.d)}`:''}</td><td><div class="wh">${evLabel(e)}${e.kind==='move'?`<button type="button" class="xb" data-unplan="${e.tr}" title="Remove this move">${ic('x',12)}</button>`:''}</div></td>
        <td class="mut acc">${esc(m.A[e.acct].name)}</td><td class="num ${e.amt>0?'good':''}">${sgn(e.amt)}</td><td class="num bal ${sh?'bad':''}">${money(a)}</td></tr>`;
      if(cover&&sh&&!seen.has(key)){seen.add(key);const t=m.plan.targets.find(t=>t.id===key);if(t)html+=`<tr class="cvr"><td></td><td colspan="4">${coverCallout(m,p,t)}</td></tr>`}
    });
    return `<section class="sf panel" data-region="upcoming">${head}<table class="reg"><thead><tr><th>Date</th><th>What</th><th>Account</th><th class="num">Amount</th><th class="num">${pool?'All cash after':'Balance after'}</th></tr></thead><tbody>${html||'<tr><td colspan="5" class="mut">Nothing scheduled in this window.</td></tr>'}</tbody></table>${unschedNote(m)}</section>`;
  }
  const top=cover?m.plan.targets.map(t=>coverCallout(m,p,t)).join(''):'';
  if(st==='calendar'){
    const id=focusId(m),months=[];
    for(let x=m.T.slice(0,7);x<=m.end.slice(0,7);){months.push(x);const[yy,mm]=x.split('-').map(Number);x=mm===12?`${yy+1}-01`:`${yy}-${pad(mm+1)}`}
    const cal=months.map(ym=>{const[yy,mm]=ym.split('-').map(Number),n=new Date(yy,mm,0).getDate(),lead=(new Date(yy,mm-1,1).getDay()+6)%7;let c='';
      for(let i=0;i<lead;i++)c+='<span class="cd blank"></span>';
      for(let dd=1;dd<=n;dd++){const day=`${ym}-${pad(dd)}`,past=day<m.T,out=day>m.end,es=past||out?[]:evFor(m,id).filter(e=>e.d===day);
        const v=out?null:(id==='pool'?(past?poolOn(m,day):m.poolS[diffD(m.T,day)]):balOn(m,id,day)),sh=v!=null&&!past&&v<m.cush;
        const os=es.filter(e=>e.amt<0).sort((a,b)=>a.amt-b.amt),ins=es.filter(e=>e.amt>0);
        const chips=os.slice(0,2).map(e=>`<em class="co" title="${esc(e.label)}">${esc(e.label.replace(/\s\d{4}$/,''))} ${k1(e.amt)}</em>`).join('')+(os.length>2?`<em class="cm">+${os.length-2} more</em>`:'')+(ins.length?`<em class="cn">+${k1(ins.reduce((s,e)=>s+e.amt,0))} in</em>`:'');
        c+=`<button type="button" class="cd ${past?'past':''} ${out?'out':''} ${day===m.T?'today':''} ${sh?'sh':''} ${S.day===day?'sel':''}" data-day="${day}" ${out?'disabled':''}><span class="cn0">${dd}</span>${chips}${v!=null?`<span class="cb ${sh?'bad':''}">${k1(v)}</span>`:''}</button>`}
      return `<div class="calm"><h3>${MONL[mm-1]} ${yy}</h3><div class="cgrid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(w=>`<span class="wd">${w}</span>`).join('')}${c}</div></div>`}).join('');
    const sel=S.day&&S.day>=m.T&&S.day<=m.end?S.day:null,se=sel?rows.filter(e=>e.d===sel):[];
    const det=sel?`<div class="dayd"><div class="ph"><h3>${dowD(sel)}</h3><button type="button" class="xb" data-day="${sel}">${ic('x',13)}</button></div>${se.length?se.map(e=>`<div class="dl">${evLabel(e)}<span class="mut">${esc(m.A[e.acct].name)}</span><b class="num ${e.amt>0?'good':''}">${sgn(e.amt)}</b></div>`).join(''):'<p class="mut">Nothing scheduled.</p>'}</div>`:'<p class="hint">Click a day to see what is paid that day. The figure at the bottom of each day is the balance at the end of it.</p>';
    return `<section class="sf panel" data-region="upcoming">${head}${top}<div class="calh">${focusChips(m)}<span class="mut">${esc(nameOf(m,id))}, end-of-day balance</span></div><div class="cals">${cal}</div>${det}${unschedNote(m)}</section>`;
  }
  if(st==='weeks'){
    const id=focusId(m),ks=[];m.days.forEach(dd=>{const k=weekKey(dd);if(!ks.includes(k))ks.push(k)});
    if(!S.wkInit){S.wkInit=true;const f=m.lens==='pool'?m.poolLow.first:(m.shortA[0]&&m.shortA[0].first);if(f)S.wk.add(weekKey(f))}
    const body=ks.map(k=>{const ds=m.days.filter(dd=>weekKey(dd)===k),we=rows.filter(e=>weekKey(e.d)===k),o=-we.filter(e=>e.kind!=='move'&&e.amt<0).reduce((s,e)=>s+e.amt,0),n=we.filter(e=>e.kind==='income').reduce((s,e)=>s+e.amt,0);
      const vals=ds.map(dd=>id==='pool'?m.poolS[diffD(m.T,dd)]:m.proj[id][diffD(m.T,dd)]),endv=vals[vals.length-1],low=Math.min(...vals),open=S.wk.has(k);
      const items=open?`<div class="wki">${we.length?we.map(e=>`<div class="dl"><span class="mut dcol">${shortD(e.d)}</span>${evLabel(e)}<span class="mut">${esc(m.A[e.acct].name)}</span><b class="num ${e.amt>0?'good':''}">${sgn(e.amt)}</b></div>`).join(''):'<p class="mut">Nothing scheduled.</p>'}</div>`:'';
      return `<div class="wk ${low<m.cush?'short':''}"><button type="button" class="wkb" data-wk="${k}" aria-expanded="${open}"><span class="chev">${ic(open?'down':'right',14)}</span><b>${weekName(m,k)}</b><span class="num good">${n?'+'+m0(n):'—'}</span><span class="num">${o?'−'+m0(o):'—'}</span><span class="num ${endv<m.cush?'bad':''}">${money(endv)}</span><span class="num ${low<m.cush?'bad':'mut'}">${money(low)}</span></button>${items}</div>`}).join('');
    return `<section class="sf panel" data-region="upcoming">${head}${top}<div class="calh">${focusChips(m)}</div><div class="wkhd"><span></span><span>Week</span><span class="num">Coming in</span><span class="num">Going out</span><span class="num">${esc(nameOf(m,id))} at week end</span><span class="num">Lowest in week</span></div>${body}${unschedNote(m)}</section>`;
  }
  // cards: one row per card, by due date
  const list=L.d.cards.slice().sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:(a.due||'9')>(b.due||'9')?1:b.owedNow-a.owedNow);
  const status=c=>{if(!c.due)return p.nodue==='worst'?['warn','Counted today']:['warn','No due date'];
    if(c.stmt<=0.004)return['mut','Nothing due'];if(c.stmtLeft<=0.004)return['good','Paid'];
    const dd=diffD(m.T,c.due);if(c.due>m.end)return['mut',`Due ${shortD(c.due)}`];
    const l=m.lows[c.payFrom||DEFAULT_PAYER],sh=l&&l.first&&l.first<=c.due;
    return[sh?'bad':dd<=3?'warn':'ac',dd===0?'Due today':dd===1?'Due tomorrow':`Due in ${dd} days`]};
  const vis=p.showZero?list:list.filter(c=>c.due?(p.amount==='stmt'?c.stmtLeft:c.owedNow)>0.004:c.owedNow>0.004);
  const stale=c=>c.owedNow>0.004&&L.d.accounts.find(a=>a.id===c.id).last&&diffD(L.d.accounts.find(a=>a.id===c.id).last,m.T)>45;
  const body=vis.map(c=>{const[sc,sl]=status(c),left=p.amount==='stmt'?c.stmtLeft:c.owedNow,a=L.d.accounts.find(x=>x.id===c.id);
    return `<tr><td><b>${esc(c.name)}</b><small>${esc(c.holder||'—')}${p.fresh&&a.last?` · last activity ${shortD(a.last)}`:''}${stale(c)&&p.fresh?' <span class="tg warn">no new activity in 45+ days</span>':''}</small></td>
      <td>${c.due?`${shortD(c.due)}<small>closed ${shortD(c.close)}</small>`:'<span class="mut">not set</span>'}</td>
      <td class="mut nw">${c.payFrom?esc(m.A[c.payFrom].name):`<span class="tg warn">not set</span>`}</td>
      <td class="num">${c.due?money(c.stmt):'—'}</td><td class="num mut">${c.due&&c.credits?money(c.credits):'—'}</td>
      <td class="num"><b>${c.due?money(left):money(c.owedNow)}</b></td><td class="num mut">${c.due&&c.newCharges?money(c.newCharges):'—'}</td>
      <td><span class="pill ${sc}">${sl}</span></td></tr>`}).join('');
  const tot=vis.reduce((s,c)=>s+(c.due?(p.amount==='stmt'?c.stmtLeft:c.owedNow):c.owedNow),0);
  const loans=m.out.filter(e=>e.kind==='loan'),incs=m.inc;
  return `<section class="sf panel" data-region="upcoming">${head}${top}<div class="tw"><table class="ctab"><thead><tr><th>Card</th><th>Due</th><th>Pay from</th><th class="num">Statement</th><th class="num">Paid since</th><th class="num">${p.amount==='stmt'?'Left to pay':'Owed now'}</th><th class="num">New since statement</th><th>Status</th></tr></thead><tbody>${body}</tbody>
    <tfoot><tr><td colspan="5">${plural(vis.length,'card')}</td><td class="num"><b>${money(tot)}</b></td><td colspan="2"></td></tr></tfoot></table></div>
    <p class="also">${loans.length?`Also due: ${loans.map(e=>`${esc(e.label)} ${money(-e.amt)} on ${shortD(e.d)} from ${esc(m.A[e.acct].name)}`).join('; ')}. `:''}Coming in: ${money(m.inTot)} from ${plural(incs.length,'deposit')}.</p></section>`;
}

/* ── Cover the gap (panel) ────────────────────────────────── */
function coverPanel(p,m){
  const pl=m.plan,moves=S.tr;
  const mv=moves.length?`<div class="moves"><h3>Planned moves</h3>${moves.map((t,i)=>`<div class="mv">${ic('swap',14)}<span><b>${money(t.amt)}</b> from ${esc(m.A[t.from].name)} to ${esc(m.A[t.to].name)} on ${shortD(t.d)}</span><button type="button" class="xb" data-unplan="${i}" title="Remove">${ic('x',12)}</button></div>`).join('')}<p class="hint">Planned moves are part of the forecast until the real transfer shows up.</p></div>`:'';
  if(!pl.targets.length)return `<section class="sf panel cov ok" data-region="cover"><div class="ph"><h2>Cover the gap</h2></div><p class="okl">${ic('check',16)}<span>Nothing to cover. Every paying account stays above ${m0(m.cush)} through ${shortD(m.end)}.</span></p>${mv}</section>`;
  const tg=pl.targets.map(t=>`<div class="tgt"><div class="tgh"><b>${esc(nameOf(m,t.id))}</b><span class="val bad">${money(t.need)}</span></div><p class="mut">needed by ${dowD(t.first)} to stay above ${m0(m.cush)} through ${shortD(m.end)}. Lowest ${money(t.low)} on ${shortD(t.lowD)}.</p></div>`).join('');
  const t0=pl.targets[0];
  const src=(arr,label,note)=>arr.length?`<h3>${label}</h3>${arr.map(s=>{const a=m.A[s.id],stale=!a.last||a.manual?freshTxt(a,m):'';
    return `<div class="src"><div><b>${esc(a.name)}</b><small>${s.kind==='invest'?'sell and settle, 2–3 days':'spare after its own bills'}${stale?` · ${stale}`:''}</small></div><span class="num">${m0(s.spare)}</span>${planBtn(m,s,t0,true)}</div>`}).join('')}${note||''}`:'';
  const sum=`<div class="covsum"><span>Needed <b>${m0(pl.need)}</b></span>${m.lens==='pool'?'':`<span>Other checking can spare <b>${m0(pl.cashSpare)}</b></span>`}<span>${pl.fromInv>0?`Investments would cover <b class="bad">${m0(pl.fromInv)}</b>`:'<b class="good">Covered by cash</b>'}</span></div>`;
  return `<section class="sf panel cov" data-region="cover"><div class="ph"><h2>Cover the gap</h2><span class="mut">${m.lens==='pool'?'All cash together':'Each account on its own'}</span></div>${tg}${sum}
    ${src(pl.cash,'Other cash accounts')}${src(pl.inv,'Investments')}${mv}</section>`;
}

/* ── What can cover it: balances by how fast they turn into cash ── */
function tierList(p){
  const g=k=>L.d.accounts.filter(a=>a.group===k),T=[
    {k:'cash',name:'Ready now',speed:'Checking, same day',accts:g('cash')},
    {k:'savings',name:'Next business day',speed:'Savings transfer',accts:g('savings')},
    {k:'invest',name:'In 2–3 days',speed:'Sell and settle',accts:g('invest')}];
  if(p.illiquid)T.push({k:'restricted',name:'Restricted',speed:'Medical and dependent care only',accts:g('restricted')},{k:'property',name:'Not liquid',speed:'Home and car, not counted',accts:g('property')});
  T.forEach(t=>t.tot=t.accts.reduce((s,a)=>s+a.bal,0));return T;
}
function freshTxt(a,m){if(a.group==='property')return'entered by hand';if(!a.last)return a.manual?'entered by hand':'<span class="warnt">no activity since it was linked</span>';const n=diffD(a.last,m.T);return n<=1?'updated today':a.manual?`by hand, ${shortD(a.last)}`:n>30?`<span class="warnt">last activity ${shortD(a.last)}</span>`:`last activity ${shortD(a.last)}`}
function tiers(p,m){
  const T=tierList(p),pl=m.plan,st=p.tierStyle;
  const line=pl.need>0?`<p class="tline">${m.lens==='pool'?'All cash together':'Short accounts'} need <b>${m0(pl.need)}</b>${m.lens==='pool'?'':`; other checking can spare <b>${m0(pl.cashSpare)}</b>`}${pl.fromInv>0?`; investments would cover <b class="bad">${m0(pl.fromInv)}</b>.`:'.'}</p>`:`<p class="tline good">${ic('check',14)} Cash covers everything due in this window.</p>`;
  const accts=(t,spark)=>t.accts.filter(a=>Math.abs(a.bal)>=0.005||a.last).map(a=>`<div class="ta"><span>${esc(a.name)}${p.fresh?`<small>${freshTxt(a,m)}</small>`:''}</span>${spark?`<span class="spk" data-spark="${a.id}"></span>`:''}<b class="num">${money(a.bal)}</b></div>`).join('');
  if(st==='ladder'){
    let cum=0;
    return `<section class="sf panel" data-region="tiers"><div class="ph"><h2>What can cover it</h2><span class="mut">By how fast it becomes cash</span></div>${line}
      <div class="ladder">${T.map((t,i)=>{const counted=t.k==='cash'||t.k==='savings'||t.k==='invest';if(counted)cum+=t.tot;
        const use=t.k==='invest'?pl.fromInv:t.k==='cash'&&m.lens!=='pool'?pl.fromCash:0;
        return `<div class="rung ${counted?'':'nc'}"><div class="rh"><span class="rn">${i+1}</span><div><b>${t.name}</b><small>${t.speed}</small></div><span class="val num">${m0(t.tot)}</span><span class="num mut cum">${counted?'running '+m0(cum):'not counted'}</span></div>
          ${use>0?`<div class="use"><i style="width:${Math.min(100,use/Math.max(t.tot,1)*100).toFixed(1)}%"></i><span>${m0(use)} of it would go to the gap</span></div>`:''}
          <div class="tas">${accts(t)}</div></div>`}).join('')}</div></section>`;
  }
  if(st==='stack'){
    const counted=T.filter(t=>t.k!=='property'),tot=counted.reduce((s,t)=>s+Math.max(0,t.tot),0)||1,prop=T.find(t=>t.k==='property');
    const col={cash:'var(--ac)',savings:'#0EA5E9',invest:'#7C3AED',restricted:'#94A3B8'};
    let x=0;const segs=counted.map(t=>{const w=Math.max(0,t.tot)/tot*100,s=`<i class="sg" style="width:${w.toFixed(2)}%;background:${col[t.k]}" title="${t.name} ${money(t.tot)}"></i>`;x+=w;return s}).join('');
    const invStart=counted.filter(t=>t.k==='cash'||t.k==='savings').reduce((s,t)=>s+Math.max(0,t.tot),0)/tot*100,gapW=Math.min(pl.fromInv,counted.find(t=>t.k==='invest').tot)/tot*100;
    return `<section class="sf panel" data-region="tiers"><div class="ph"><h2>What can cover it</h2><span class="mut">${m0(tot)} you could reach</span></div>${line}
      <div class="stk">${segs}${pl.fromInv>0?`<span class="gap" style="left:${invStart.toFixed(2)}%;width:${gapW.toFixed(2)}%" title="Needed from investments ${money(pl.fromInv)}"></span>`:''}</div>
      <div class="stl">${counted.map(t=>`<div class="sli"><i style="background:${col[t.k]}"></i><div><b>${t.name}</b><small>${t.speed}</small>${accts(t)}</div><span class="val num">${m0(t.tot)}</span></div>`).join('')}</div>
      ${prop?`<p class="hint">Not liquid, not in the bar: ${prop.accts.map(a=>`${esc(a.name)} ${m0(a.bal)}`).join(' · ')}.</p>`:''}${pl.fromInv>0?'<p class="hint">The hatched part of the investments segment is what the gap would use.</p>':''}</section>`;
  }
  // list: grouped accounts with a 30-day sparkline
  return `<section class="sf panel" data-region="tiers"><div class="ph"><h2>Accounts</h2><span class="mut">Last 30 days and the forecast</span></div>${line}
    <div class="glist">${T.map(t=>`<div class="gl1"><div class="glh"><b>${t.name}</b><span class="mut">${t.speed}</span><span class="val num">${m0(t.tot)}</span></div>${accts(t,true)}</div>`).join('')}</div></section>`;
}

/* ── Balance history (the Excel sheet's job, without the width) ── */
const GRPN={cash:'Checking',savings:'Savings',invest:'Investments',restricted:'HSA and FSA',property:'Home and car',card:'Cards owed'};
function owedOn(m,day){return L.d.accounts.filter(a=>a.group==='card').reduce((s,a)=>s+Math.max(0,-balOn(m,a.id,day)),0)}
function grpOn(m,k,day){return L.d.accounts.filter(a=>a.group===k).reduce((s,a)=>s+balOn(m,a.id,day),0)}
function history(p,m){
  const st=p.history;if(st==='off')return'';
  const head=t=>`<div class="ph"><h2>${t}</h2><span class="mut">Italic rows are forecast</span></div>`;
  if(st==='current'){
    const y=+m.T.slice(0,4),mo=+m.T.slice(5,7),n=new Date(y,mo,0).getDate(),days=[];for(let i=1;i<=n;i++)days.push(`${m.T.slice(0,8)}${pad(i)}`);
    const G=[['Checking & Savings',a=>['cash','savings','restricted'].includes(a.group),true],['Investments',a=>a.group==='invest',true],['Other Assets',a=>a.group==='property',true],['Credit Cards',a=>a.group==='card',false]]
      .map(([g,f,as])=>({g,as,accts:L.d.accounts.filter(f)}));
    const th1=G.map(g=>`<th colspan="${S.col[g.g]?1:1+g.accts.length}" class="gh" data-col="${g.g}">${g.g.toUpperCase()} ${S.col[g.g]?'▸':'▾'}</th>`).join('');
    const th2=G.map(g=>`<th class="tot">TOTAL</th>${S.col[g.g]?'':g.accts.map(a=>`<th title="${esc(a.name)}">${esc(a.name.toUpperCase())}</th>`).join('')}`).join('');
    const body=days.map(dd=>{const fut=dd>m.T,v=a=>{const x=dd<=m.T?balOn(m,a.id,dd):(dd<=m.end?balOn(m,a.id,dd):balOn(m,a.id,m.end));return x};let gt=0;
      const cells=G.map(g=>{const vals=g.accts.map(a=>g.as?v(a):-v(a)),t=vals.reduce((s,x)=>s+x,0);gt+=g.as?t:-t;
        return `<td class="tot ${t<0?'bad':''}">${paren(t)}</td>${S.col[g.g]?'':vals.map(x=>`<td class="${x<0?'bad':''}">${paren(x)}</td>`).join('')}`}).join('');
      return `<tr class="${dd===m.T?'today':''} ${fut?'fut':''}"><td class="dc">${dd.slice(5)}${dd===m.T?' <span class="tb">TODAY</span>':''}</td>${cells}<td class="gt ${gt<0?'bad':'good'}">${paren(gt)}</td></tr>`}).join('');
    return `<section class="sf panel" data-region="history"><div class="ph"><h2>Daily balances</h2><span class="mut">${n} days · end-of-day · italic = projected · ${L.d.accounts.length} accounts</span></div><div class="wide"><table class="wt"><thead><tr><th rowspan="2" class="dc">DATE</th>${th1}<th rowspan="2" class="gt">GRAND TOTAL</th></tr><tr>${th2}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }
  if(st==='groups'){
    const ks=['cash','savings','invest'],days=[];for(let x=addD(m.T,-14);x<=m.end;x=addD(x,1))days.push(x);
    const body=days.map(dd=>{const v=ks.map(k=>grpOn(m,k,dd)),ow=owedOn(m,dd),liq=v[0]+v[1]-ow,open=S.row===dd;
      const det=open?`<tr class="rx"><td colspan="7"><div class="rxg">${['cash','savings','invest','restricted','card'].map(k=>{const as=L.d.accounts.filter(a=>a.group===k&&(Math.abs(balOn(m,a.id,dd))>=.005));
        return as.length?`<div><h4>${GRPN[k]}</h4>${as.map(a=>{const b=balOn(m,a.id,dd);return `<div class="ta"><span>${esc(a.name)}</span><b class="num ${k==='card'?'':b<0?'bad':''}">${k==='card'?money(Math.max(0,-b)):money(b)}</b></div>`}).join('')}</div>`:''}).join('')}</div></td></tr>`:'';
      return `<tr class="hr ${dd===m.T?'today':''} ${dd>m.T?'fut':''} ${open?'open':''}" data-row="${dd}" tabindex="0"><td class="dc">${dowD(dd)}${dd===m.T?' <span class="tb">Today</span>':''}</td>${v.map((x,i)=>`<td class="num ${i===0&&x<m.cush?'bad':''}">${money(x)}</td>`).join('')}<td class="num">${money(ow)}</td><td class="num b ${liq<0?'bad':''}">${money(liq)}</td><td class="chev">${ic(open?'down':'right',13)}</td></tr>${det}`}).join('');
    return `<section class="sf panel" data-region="history">${head('Daily balances by group')}<div class="tw"><table class="ht"><thead><tr><th>Date</th><th class="num">Checking</th><th class="num">Savings</th><th class="num">Investments</th><th class="num">Cards owed</th><th class="num">Cash after cards</th><th></th></tr></thead><tbody>${body}</tbody></table></div><p class="hint">Click a day to see every account on it. "Cash after cards" is checking plus savings minus everything owed on cards.</p></section>`;
  }
  if(st==='pivot'){
    const off=[-30,-7,0,7,14,30].filter(k=>addD(m.T,k)<=m.end).map(k=>addD(m.T,k));if(!off.includes(m.end))off.push(m.end);
    const lab=dd=>dd===m.T?'Today':shortD(dd);
    const G=['cash','savings','invest','restricted','card'];
    const rows=G.map(k=>{let as=L.d.accounts.filter(a=>a.group===k);if(k==='card')as=as.filter(a=>off.some(dd=>Math.abs(balOn(m,a.id,dd))>=.005));
      const sign=k==='card'?-1:1,closed=k==='card'&&!S.cards;
      const sub=`<tr class="gsub" ${k==='card'?'data-cards':''}><td>${k==='card'?`<span class="chev">${ic(closed?'right':'down',13)}</span>`:''}${GRPN[k]} <span class="mut">${plural(as.length,'account')}</span></td>${off.map(dd=>{const t=as.reduce((s,a)=>s+sign*balOn(m,a.id,dd),0);return `<td class="num ${dd>m.T?'fut':''}">${money(t)}</td>`}).join('')}</tr>`;
      return sub+(closed?'':as.map(a=>`<tr><td class="an">${esc(a.name)}</td>${off.map(dd=>{const b=sign*balOn(m,a.id,dd);return `<td class="num ${dd>m.T?'fut':''} ${k!=='card'&&b<0?'bad':''}">${Math.abs(b)<.005?'<span class="mut">—</span>':money(b)}</td>`}).join('')}</tr>`).join(''))}).join('');
    return `<section class="sf panel" data-region="history">${head('Balances at a glance')}<div class="tw"><table class="pv"><thead><tr><th>Account</th>${off.map(dd=>`<th class="num ${dd===m.T?'tdy':''}">${lab(dd)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><p class="hint">Accounts go down the side, so the table never gets wider as accounts are added. Cards show what is owed.</p></section>`;
  }
  // account: one account's daily register
  const id=acctFocus(m),rec=L.d.recent.filter(r=>r.acct===id),fut=m.ev.filter(e=>e.acct===id);
  const ds=[...new Set(rec.map(r=>r.d).concat(fut.map(e=>e.d)).concat([m.T]))].sort();
  const body=ds.map(dd=>{const its=dd<m.T?rec.filter(r=>r.d===dd).map(r=>({t:tidy(r.desc),a:r.amt})):fut.filter(e=>e.d===dd).map(e=>({t:e.label,a:e.amt,f:true}));
    const i=its.filter(x=>x.a>0).reduce((s,x)=>s+x.a,0),o=-its.filter(x=>x.a<0).reduce((s,x)=>s+x.a,0),b=balOn(m,id,dd);
    return `<tr class="${dd===m.T?'today':''} ${dd>m.T?'fut':''}"><td class="dc">${dowD(dd)}</td><td class="num good">${i?money(i):''}</td><td class="num">${o?money(o):''}</td><td class="num b ${b<m.cush&&dd>=m.T?'bad':''}">${money(b)}</td><td class="its">${its.map(x=>`<span>${esc(x.t)} <em class="${x.a>0?'good':''}">${sgn(x.a)}</em></span>`).join('')||'<span class="mut">no activity</span>'}</td></tr>`}).join('');
  return `<section class="sf panel" data-region="history"><div class="ph"><h2>Daily register</h2>${focusChips(m,true)}</div><div class="tw"><table class="ht ar"><thead><tr><th>Date</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance</th><th>What happened</th></tr></thead><tbody>${body}</tbody></table></div><p class="hint">Last 30 days of activity and the forecast, one account at a time. Quiet days are skipped.</p></section>`;
}

/* ── Page ─────────────────────────────────────────────────── */
function page(p){
  const m=model(p),useTabs=p.tabs!=='menu',histInTab=p.tabs==='three',hd=header(p,m);
  let main;
  if(useTabs&&S.tab==='recon')main=`<section class="sf panel recon"><div class="ph"><h2>Reconciliation</h2></div><p class="mut">Reconciliation keeps today's layout; it is not part of this gallery.</p></section>`;
  else if(useTabs&&S.tab==='history')main=history(p,m);
  else{
    const sm=summary(p,m),fc=forecast(p,m),cv=p.cover==='panel'?coverPanel(p,m):'',up=upcoming(p,m),tr=tiers(p,m),hi=histInTab?'':history(p,m);
    main=p.arrange==='split'?`${sm}<div class="split"><div class="col">${fc}${up}${hi}</div><div class="col rail">${cv}${tr}</div></div>`:`${sm}${fc}${cv}${up}${tr}${hi}`;
  }
  return `<div class="app">${nav(p)}<div class="main">${hd}${main}</div></div>`;
}

Gallery.define({
  id:'daily-balances-r1',
  name:'Daily Balances: liquidity',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap'],
  groups:[
   {id:'chrome',label:'Page header',open:true,controls:[
    {id:'name',label:'Page name',type:'choice',options:[
      {id:'daily',label:'Daily Balances',current:true,hint:'Today\'s name'},
      {id:'liq',label:'Liquidity',hint:'Names the purpose'},
      {id:'bills',label:'Cash & Bills',hint:'Plain words for what it shows'}]},
    {id:'tabs',label:'Tabs',type:'choice',options:[
      {id:'two',label:'Balances | Reconciliation',current:true,hint:'As today'},
      {id:'three',label:'Upcoming | Balance history | Reconciliation',hint:'The day-by-day table gets its own tab'},
      {id:'menu',label:'No tabs, Reconciliation in the ⋯ menu',hint:'One page; Reconciliation one click away'}]},
   ]},
   {id:'counts',label:'How the forecast counts',open:true,controls:[
    {id:'lens',label:'Shortfalls are judged',type:'choice',options:[
      {id:'acct',label:'Each account on its own',hint:'Chase 8997 can run short even when TD has money'},
      {id:'pool',label:'All cash together',hint:'One pot: checking plus savings'},
      {id:'both',label:'A switch on the page',hint:'By account by default, all cash one click away'}]},
    {id:'amount',label:'Amount planned for each card',type:'choice',options:[
      {id:'stmt',label:'Statement balance still unpaid',hint:'What the bank will ask for on the due date'},
      {id:'owed',label:'Everything owed now',hint:'Statement plus new charges, worst case'}]},
    {id:'nextStmt',label:'Add next statements (charges so far)',type:'toggle',default:true},
    {id:'nodue',label:'Cards with no due date set',type:'choice',options:[
      {id:'list',label:'Listed under the timeline',hint:'Bilt, Atmos Summit, AA Platinum and 3 more'},
      {id:'worst',label:'Counted as due today',hint:'Worst case, from Chase 8997'}]},
    {id:'cushion',label:'Cushion to keep in each account ($)',type:'slider',min:0,max:5000,step:250,default:1000},
    {id:'fresh',label:'Show when each balance last changed',type:'toggle',default:true},
   ]},
   {id:'summary',label:'Summary',open:false,controls:[
    {id:'summary',label:'Top of the page',type:'choice',options:[
      {id:'current',label:'Net worth figures',current:true,hint:'Today: net worth now, start, change, peak'},
      {id:'verdict',label:'Verdict sentence and four figures',hint:'Says which account runs short and when'},
      {id:'equation',label:'Cash + coming in − due = left',hint:'The arithmetic, laid out'},
      {id:'coverage',label:'Coverage bars',hint:'What goes out against what can pay for it'}]},
   ]},
   {id:'forecast',label:'Forecast chart',open:false,controls:[
    {id:'chart',label:'Chart',type:'choice',options:[
      {id:'current',label:'Day boxes',current:true,hint:'Today: 30 boxes in a scrolling row'},
      {id:'line',label:'Balance line',hint:'One account, cushion line, red where it runs short'},
      {id:'multi',label:'One small chart per paying account',hint:'Chase, TD and Citi side by side'},
      {id:'flow',label:'Money in and out, with the balance',hint:'Daily bars under the line'}]},
    {id:'hist',label:'Show the last 30 days before today',type:'toggle',default:true},
    {id:'markers',label:'Mark payment days',type:'toggle',default:true},
   ]},
   {id:'upcoming',label:'What is due, and when',open:false,controls:[
    {id:'upStyle',label:'Layout',type:'choice',options:[
      {id:'register',label:'Register',hint:'Checkbook rows by date with the balance after each'},
      {id:'calendar',label:'Calendar',hint:'Month grid; payments on their day'},
      {id:'weeks',label:'Week by week',hint:'One row a week; open one for its payments'},
      {id:'cards',label:'Card list',hint:'Every card: statement, due date, left to pay'}]},
    {id:'showZero',label:'Card list: include cards with nothing to pay',type:'toggle',default:false},
   ]},
   {id:'cover',label:'Cover the gap',open:false,controls:[
    {id:'cover',label:'Where it shows',type:'choice',options:[
      {id:'panel',label:'Its own panel',hint:'Needed amount, then what other accounts can spare'},
      {id:'inline',label:'Inside the list, where it runs short',hint:'A note at the first short day'},
      {id:'off',label:'Not shown'}]},
   ]},
   {id:'tiers',label:'What can cover it',open:false,controls:[
    {id:'tierStyle',label:'Layout',type:'choice',options:[
      {id:'ladder',label:'Ladder',hint:'Ready now, next day, 2–3 days, with a running total'},
      {id:'stack',label:'One stacked bar',hint:'Each tier\'s share, the gap hatched on top'},
      {id:'list',label:'Account list with sparklines',hint:'Grouped by tier, 30 days of history each'}]},
    {id:'illiquid',label:'Include HSA, FSA, home and car',type:'toggle',default:false},
   ]},
   {id:'history',label:'Balance history',open:false,controls:[
    {id:'history',label:'Day-by-day table',type:'choice',options:[
      {id:'current',label:'Every account as a column',current:true,hint:'Today, and the Excel sheet: scrolls sideways'},
      {id:'groups',label:'Group columns, click a day for accounts',hint:'Five columns; detail opens under the row'},
      {id:'pivot',label:'Accounts down the side, a few dates across',hint:'30 days ago to the end of the forecast'},
      {id:'account',label:'One account\'s register',hint:'In, out, balance and what happened'},
      {id:'off',label:'Not shown',hint:'The chart and the list replace it'}]},
   ]},
   {id:'arrange',label:'Arrangement',open:false,controls:[
    {id:'arrange',label:'Panels',type:'choice',options:[
      {id:'stack',label:'Stacked, full width'},
      {id:'split',label:'Main column with a right rail',hint:'Cover the gap and tiers on the right'}]},
   ]},
   {id:'decided',label:'Decided on the Cards pages',open:false,controls:[
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',swatches:['#EEF2F7','#FFFFFF','#2563EB'],tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'accent',label:'Accent',type:'choice',locked:true,options:[{id:'blue',label:'Brand blue',tokens:{'--ac-l':'#2563EB','--ac-d':'#60A5FA'}}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'outfit',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'surface',label:'Panels',type:'choice',locked:true,options:[{id:'hairline',label:'Hairline'}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar, Net Worth hidden'}]},
    {id:'header',label:'Header',type:'choice',locked:true,options:[{id:'bar',label:'Slim bar, like Cards'}]},
    {id:'controls',label:'Period and view controls',type:'choice',locked:true,options:[{id:'underline',label:'Underlined text'}]},
    {id:'labelPos',label:'Figures',type:'choice',locked:true,options:[{id:'below',label:'Value first, label under it'}]},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
   ]},
  ],
  render(picks,d,h){
    if(!L||L.d!==d)M=null;
    L={d,h,picks};
    return page(picks);
  },
  after(root,picks){
    const stage=document.getElementById('stage');
    const rr=()=>{const top=stage?stage.scrollTop:0;L.picks=picks;root.innerHTML=page(picks);Gallery.spec.after(root,picks);if(stage)stage.scrollTop=top};
    const on=(sel,fn,ev)=>root.querySelectorAll(sel).forEach(el=>el.addEventListener(ev||'click',e=>fn(el,e)));
    on('[data-hz]',b=>{S.hz=b.dataset.hz;S.day=null;rr()});
    on('[data-lens]',b=>{S.lens=b.dataset.lens;rr()});
    on('[data-tab]',b=>{S.tab=b.dataset.tab;rr()});
    on('[data-focus]',b=>{S.focus=Number(b.dataset.focus);rr()});
    on('[data-focus-sel]',s=>{S.focus=Number(s.value);rr()},'change');
    on('[data-plan]',b=>{S.tr.push({from:Number(b.dataset.from),to:Number(b.dataset.to),amt:Number(b.dataset.amt),d:b.dataset.d});rr()});
    on('[data-unplan]',b=>{S.tr.splice(Number(b.dataset.unplan),1);rr()});
    on('[data-wk]',b=>{const k=b.dataset.wk;S.wk.has(k)?S.wk.delete(k):S.wk.add(k);rr()});
    on('[data-day]',b=>{S.day=S.day===b.dataset.day?null:b.dataset.day;rr()});
    on('[data-row]',r=>{S.row=S.row===r.dataset.row?null:r.dataset.row;rr()});
    on('[data-row]',(r,e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();S.row=S.row===r.dataset.row?null:r.dataset.row;rr()}},'keydown');
    on('[data-col]',t=>{S.col[t.dataset.col]=!S.col[t.dataset.col];rr()});
    on('[data-cards]',()=>{S.cards=!S.cards;rr()});
    // Charts are drawn at their real width so text stays at its true size.
    const m=model(picks);
    const draw=()=>{root.querySelectorAll('[data-chart]').forEach(el=>{const W=Math.max(Math.round(el.clientWidth),260);if(el.dataset.w==String(W))return;el.dataset.w=W;
        const id=el.dataset.chart==='pool'?'pool':Number(el.dataset.chart);el.innerHTML=drawChart(W,picks,m,id,el.dataset.mode,el.dataset.h?Number(el.dataset.h):0)});
      root.querySelectorAll('[data-spark]').forEach(el=>{if(el.dataset.done)return;el.dataset.done=1;const id=Number(el.dataset.spark),a=m.A[id],W=110,H=26;
        const vs=[];for(let k=30;k>=1;k--)vs.push(balOn(m,id,addD(m.T,-k)));m.days.forEach((_,i)=>vs.push(m.proj[id][i]));
        const lo=Math.min(...vs),hi=Math.max(...vs),y=v=>hi===lo?H/2:2+(H-4)*(hi-v)/(hi-lo),x=i=>W*i/(vs.length-1);
        const pts=vs.map((v,i)=>[x(i),y(v)]);
        el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${stepPath(pts.slice(0,31))}" class="sph"/><path d="${stepPath(pts.slice(30))}" class="spf"/></svg>`})};
    draw();
    if(window.__dbRO)window.__dbRO.disconnect();
    window.__dbRO=new ResizeObserver(draw);root.querySelectorAll('[data-chart]').forEach(el=>window.__dbRO.observe(el));
  },
  css:`
#pv{--c-radius:13px;--c-density:1.25;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density))}
#pv *{box-sizing:border-box}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
#pv button:disabled{opacity:.35;cursor:default}
#pv button:focus-visible,#pv select:focus-visible,#pv [tabindex]:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv h1,#pv h2,#pv h3,#pv .val{font-family:var(--f-h)}
#pv h2{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);margin:0}
#pv h3{font-size:14px;font-weight:600;margin:0}
#pv .t18{font-size:18px;font-weight:600}
#pv .val{font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#pv .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
#pv .good{color:var(--good)}#pv .bad{color:var(--bad)}#pv .warnt{color:var(--warn)}#pv .mut{color:var(--tx3);font-size:12px}
#pv small{display:block;font-size:11.5px;color:var(--tx3);font-weight:400;margin-top:1px}
#pv .hint{margin:10px 0 0;font-size:11.5px;color:var(--tx3)}
#pv .app{display:flex;flex-direction:column;min-height:100vh;min-width:0}
#pv .main{flex:1;min-width:0;width:100%;padding:calc(22px*var(--c-density)) calc(26px*var(--c-density));display:grid;gap:calc(18px*var(--c-density));align-content:start}
#pv section{min-width:0}
#pv .panel{padding:var(--p)}
#pv .ph{display:flex;justify-content:space-between;align-items:flex-start;gap:10px 16px;flex-wrap:wrap;margin-bottom:12px}
#pv .ph .sub2{margin:4px 0 0}
#pv .phr{display:flex;gap:10px;align-items:center}
/* Top bar (decided) */
#pv .appnav{display:flex;align-items:center;gap:14px;background:var(--surface);border-bottom:1px solid var(--line);padding:8px 16px;min-width:0}
#pv .brand{display:flex;align-items:center;gap:9px;font-family:var(--f-h);font-weight:600;padding:0 5px;flex:none}
#pv .brand i{font-style:normal;width:30px;height:30px;border-radius:8px;background:var(--ac);color:var(--ac-fg);display:grid;place-items:center}
#pv .nv{display:flex;gap:2px;overflow-x:auto;min-width:0;scrollbar-width:none}
#pv .nv svg{display:none}
#pv .nv button{padding:7px 10px;border-radius:8px;color:var(--tx2);font-size:13.5px;white-space:nowrap}
#pv .nv button.on{background:var(--ac-soft);color:var(--ac);font-weight:600}
/* Header */
#pv .hdr{display:flex;justify-content:space-between;align-items:center;gap:10px 22px;flex-wrap:wrap;padding:10px 18px}
#pv .hl{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
#pv .hdr h1.sm{margin:0;font-size:16px;font-weight:600}
#pv .hdr-r{display:flex;align-items:center;gap:10px 18px;flex-wrap:wrap}
#pv .vsep{width:1px;height:18px;background:var(--line)}
#pv .und{display:flex;gap:16px;flex-wrap:wrap}
#pv .und button{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12.5px;white-space:nowrap}
#pv .und button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .tabs button{font-size:13px}
#pv .btn{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;color:var(--tx2);white-space:nowrap}
#pv .btn:hover{border-color:var(--ac);color:var(--ac)}
#pv .btn.pri{background:var(--ac);color:var(--ac-fg);border-color:var(--ac)}
#pv .ibtn{width:30px;height:30px;border:1px solid var(--line);border-radius:8px;display:grid;place-items:center;color:var(--tx2)}
#pv .sel{font:inherit;font-size:12.5px;padding:6px 9px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--tx)}
#pv .chips{display:flex;gap:6px;flex-wrap:wrap}
#pv .chips button{padding:5px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--tx2);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
#pv .chips button.on{background:var(--ac-soft);border-color:color-mix(in srgb,var(--ac) 40%,transparent);color:var(--ac);font-weight:600}
#pv .dot{width:7px;height:7px;border-radius:50%;display:inline-block}#pv .dot.bad{background:var(--bad)}
#pv .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap;background:color-mix(in srgb,currentColor 11%,transparent)}
#pv .pill.ac{color:var(--ac)}#pv .pill.warn{color:var(--warn)}#pv .pill.mut{color:var(--tx3);font-size:11.5px}
#pv .tg{display:inline-block;margin:3px 6px 0 0;padding:1px 7px;border-radius:5px;font-size:10.5px;font-weight:600;color:var(--tx3);background:var(--raised);border:1px solid var(--line)}
#pv .tg.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 9%,transparent);border-color:transparent}
/* Figures: value first, label under it (decided) */
#pv .kv{display:flex;flex-direction:column;gap:4px;min-width:0}
#pv .kn{font-size:24px;font-weight:600;white-space:nowrap}
#pv .kl{font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
#pv .ksub{font-size:11.5px;color:var(--tx3)}
#pv .kv.gd .kn{color:var(--good)}#pv .kv.bd .kn{color:var(--bad)}
/* Summary: today's net worth cards */
#pv .mgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--gap)}
#pv .mc{padding:var(--p)}
#pv .ml{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3)}
#pv .mv{font-size:24px;margin:6px 0}
#pv .ms{font-size:11px;color:var(--tx3);font-weight:600}
/* Summary: verdict */
#pv .verdict .vh{display:flex;gap:12px;align-items:flex-start}
#pv .verdict .vh p{margin:0;font-size:16px;line-height:1.55;max-width:900px}
#pv .vi{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center}
#pv .verdict.no .vi{background:color-mix(in srgb,var(--bad) 10%,transparent);color:var(--bad)}
#pv .verdict.ok .vi{background:color-mix(in srgb,var(--good) 10%,transparent);color:var(--good)}
#pv .figs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--gap);margin-top:calc(16px*var(--c-density));padding-top:calc(14px*var(--c-density));border-top:1px solid var(--line)}
/* Summary: equation */
#pv .eq{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
#pv .eq i{font-style:normal;font-family:var(--f-h);font-size:22px;color:var(--tx3)}
#pv .term{display:flex;flex-direction:column;gap:3px;padding:10px 14px;border-radius:10px;background:var(--raised);min-width:150px}
#pv .term .val{font-size:24px;font-weight:600}#pv .term span:last-child{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
#pv .term.gd .val{color:var(--good)}#pv .term.bd{background:color-mix(in srgb,var(--bad) 8%,transparent)}#pv .term.bd .val{color:var(--bad)}
#pv .eqn{display:flex;gap:8px;align-items:flex-start;margin:14px 0 0;font-size:14px;line-height:1.5;color:var(--tx2)}
#pv .eqn svg{flex:none;margin-top:3px;color:var(--good)}#pv .eqn.no svg{color:var(--bad)}
/* Summary: coverage */
#pv .cvh{margin:0 0 14px;font-size:15px;line-height:1.5}#pv .cvh .val{font-size:26px;font-weight:600;margin-right:4px}
#pv .cvrow{display:grid;grid-template-columns:90px minmax(0,1fr) 90px;gap:12px;align-items:center;margin:8px 0}
#pv .cvl{font-size:12px;color:var(--tx2);font-weight:600}
#pv .cvbar{position:relative;height:26px;border-radius:7px;background:var(--raised);display:flex;overflow:visible}
#pv .cvbar .seg{height:100%;display:block}#pv .cvbar .seg:first-child{border-radius:7px 0 0 7px}
#pv .seg.out,#pv .lg i.out{background:#F97316}#pv .seg.cush,#pv .lg i.cush{background:repeating-linear-gradient(45deg,#F97316 0 3px,transparent 3px 7px)}
#pv .seg.cash,#pv .lg i.cash{background:var(--ac)}#pv .seg.inc,#pv .lg i.inc{background:#10B981}#pv .seg.inv,#pv .lg i.inv{background:#A78BFA}
#pv .cvbar .mark{position:absolute;top:-5px;bottom:-5px;width:2px;background:var(--tx);border-radius:2px}
#pv .lg{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:var(--tx2)}
#pv .lg span{display:flex;align-items:center;gap:6px}#pv .lg i{width:11px;height:11px;border-radius:3px;display:inline-block}
/* Forecast */
#pv .chart{width:100%;min-height:60px}
#pv svg .gl{stroke:var(--line);stroke-width:1}
#pv svg .ax{font-size:11px;fill:var(--tx3);font-family:var(--f-b)}
#pv svg .zl{stroke:var(--tx3);stroke-width:1}
#pv svg .cl{stroke:#D97706;stroke-width:1.2;stroke-dasharray:5 4}
#pv svg .clt{font-size:10.5px;fill:#B45309;font-weight:600;font-family:var(--f-b)}
#pv svg .lh{fill:none;stroke:var(--tx3);stroke-width:1.6}
#pv svg .lf{fill:none;stroke:var(--ac);stroke-width:2.2}
#pv svg .aup{fill:color-mix(in srgb,var(--ac) 8%,transparent)}
#pv svg .adn{fill:color-mix(in srgb,var(--bad) 16%,transparent)}
#pv svg .tl{stroke:var(--tx3);stroke-dasharray:2 3}
#pv svg .tlt{font-size:10.5px;fill:var(--tx3);font-family:var(--f-b);font-weight:600}
#pv svg .dout{fill:var(--surface);stroke:var(--ac);stroke-width:2}
#pv svg .dbad{fill:var(--surface);stroke:var(--bad);stroke-width:2}
#pv svg .din{fill:#10B981}
#pv svg .lowl line{stroke:var(--tx3)}#pv svg .lbad{font-size:11.5px;font-weight:600;fill:var(--bad);font-family:var(--f-b)}#pv svg .llow{font-size:11.5px;font-weight:600;fill:var(--tx2);font-family:var(--f-b)}
#pv svg .bin{fill:#10B981;opacity:.8}#pv svg .bout{fill:#F97316;opacity:.85}
#pv .fstrip{display:flex;gap:12px;overflow-x:auto;padding-bottom:12px}
#pv .fbox{min-width:100px;flex:none;padding:14px 12px;border-radius:16px;border:1px solid var(--line);text-align:center;display:grid;gap:6px}
#pv .fbox span{font-size:11px;font-weight:700;color:var(--tx3);letter-spacing:.04em}#pv .fbox b{font-size:16px}
#pv .fbox.sh{background:color-mix(in srgb,var(--bad) 9%,transparent);border-color:var(--bad)}#pv .fbox.sh span,#pv .fbox.sh b,#pv .fbox em{color:var(--bad)}
#pv .fbox em{font-style:normal;font-size:9px;font-weight:800;letter-spacing:.05em}
#pv .multi{display:grid;gap:4px}
#pv .mrow{display:grid;grid-template-columns:200px minmax(0,1fr);gap:14px;align-items:center;padding:4px 0;border-top:1px solid var(--line)}
#pv .mrow:first-child{border-top:0}
#pv .mlab{display:grid;gap:2px}#pv .mlab span{font-size:11.5px}
/* Upcoming: register */
#pv table{border-collapse:collapse;width:100%;color:var(--tx);font-family:var(--f-b);font-size:13px}
#pv th{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
#pv th.num{text-align:right}
#pv td{padding:calc(7px*var(--c-density)) 10px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px}
#pv .reg .wkh td{background:var(--raised);padding:8px 10px;font-size:12px}
#pv .reg .wkh td b{margin-right:12px;font-family:var(--f-h);font-weight:600;font-size:13px}
#pv .reg .dcol{white-space:nowrap;color:var(--tx2);width:96px}
#pv .reg .wh{display:flex;gap:9px;align-items:flex-start}
#pv .reg .acc{white-space:nowrap}
#pv .reg tr.short td{background:color-mix(in srgb,var(--bad) 5%,transparent)}
#pv .reg .bal{font-weight:600}
#pv .ev{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--raised);color:var(--tx2)}
#pv .ev-income{color:var(--good);background:color-mix(in srgb,var(--good) 10%,transparent)}
#pv .ev-move{color:var(--ac);background:var(--ac-soft)}
#pv .evt{min-width:0}#pv .evt b{font-weight:600}
#pv .xb{margin-left:auto;width:22px;height:22px;border-radius:6px;display:grid;place-items:center;color:var(--tx3)}
#pv .xb:hover{background:var(--raised);color:var(--bad)}
#pv .callout{display:flex;gap:10px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--bad) 6%,var(--surface));border:1px solid color-mix(in srgb,var(--bad) 25%,transparent);font-size:13px;line-height:1.5;margin:4px 0 12px}
#pv .reg .callout{margin:0}
#pv .ci{flex:none;color:var(--bad);margin-top:2px}#pv .ci.warn{color:var(--warn)}
#pv .srcs{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;color:var(--tx2)}
#pv .srcb{display:inline-flex;align-items:baseline;gap:6px;padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:12.5px}
#pv .srcb:hover{border-color:var(--ac);color:var(--ac)}#pv .srcb small{display:inline;margin:0}
#pv .srcb.sm{padding:4px 9px;font-size:12px}
#pv .foot{display:flex;gap:10px;margin-top:14px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--warn) 6%,var(--surface));font-size:13px;line-height:1.5}
#pv .foot .mut{margin-top:2px}
/* Upcoming: calendar */
#pv .calh{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
#pv .cals{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:18px}
#pv .calm h3{margin-bottom:8px}
#pv .cgrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
#pv .wd{font-size:10.5px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;padding:0 4px 2px}
#pv .cd{min-height:78px;border-radius:8px;border:1px solid var(--line);padding:5px 6px;display:flex;flex-direction:column;align-items:stretch;gap:2px;text-align:left;min-width:0}
#pv .cd.blank{border:0}#pv .cd.past,#pv .cd.out{background:var(--raised);opacity:.6}
#pv .cd.today{border-color:var(--ac);box-shadow:inset 0 0 0 1px var(--ac)}
#pv .cd.sh{background:color-mix(in srgb,var(--bad) 6%,var(--surface))}
#pv .cd.sel{outline:2px solid var(--ac);outline-offset:1px}
#pv .cn0{font-size:11px;font-weight:600;color:var(--tx2)}
#pv .cd em{font-style:normal;font-size:10.5px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .co{color:var(--tx)}#pv .cm{color:var(--tx3)}#pv .cn{color:var(--good)}
#pv .cb{margin-top:auto;font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;color:var(--tx2)}
#pv .dayd{margin-top:14px;padding:12px 14px;border-radius:10px;background:var(--raised)}
#pv .dl{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}
#pv .dl:first-of-type{border-top:0}
#pv .wki .dl{grid-template-columns:60px auto minmax(0,1fr) auto auto}
/* Upcoming: weeks */
#pv .wkhd,#pv .wkb{display:grid;grid-template-columns:22px minmax(0,1.6fr) repeat(4,minmax(0,1fr));gap:10px;align-items:center}
#pv .wkhd{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);padding:6px 10px;border-bottom:1px solid var(--line)}
#pv .wk{border-bottom:1px solid var(--line)}
#pv .wkb{width:100%;padding:11px 10px;text-align:left}
#pv .wkb b{font-family:var(--f-h);font-weight:600}
#pv .wk.short .wkb{background:color-mix(in srgb,var(--bad) 4%,transparent)}
#pv .chev{color:var(--tx3);display:inline-grid}
#pv .wki{padding:2px 12px 10px 42px}
/* Upcoming: card list */
#pv .tw{overflow-x:auto}
#pv .ctab td small{display:block}
#pv .ctab tfoot td{border-bottom:0;font-weight:600;color:var(--tx2)}
#pv .nw{white-space:nowrap}
#pv .also{margin:12px 0 0;font-size:12.5px;color:var(--tx2)}
/* Cover the gap */
#pv .cov h3{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);margin:14px 0 6px}
#pv .tgt{padding:12px 14px;border-radius:10px;background:color-mix(in srgb,var(--bad) 6%,var(--surface));border:1px solid color-mix(in srgb,var(--bad) 22%,transparent);margin-bottom:8px}
#pv .tgh{display:flex;justify-content:space-between;gap:10px;align-items:baseline}#pv .tgh .val{font-size:20px;font-weight:600}
#pv .tgt p{margin:4px 0 0}
#pv .covsum{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--tx2);margin:10px 0 2px}
#pv .src{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
#pv .src .num{font-weight:600}
#pv .moves{margin-top:6px}
#pv .mv{display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid var(--line);font-size:13px;color:var(--tx2)}#pv .mv svg{color:var(--ac);flex:none}
#pv .okl{display:flex;gap:8px;align-items:center;margin:0;color:var(--good);font-size:14px}
/* Tiers */
#pv .tline{margin:0 0 12px;font-size:13.5px;color:var(--tx2);line-height:1.5}
#pv .ladder{display:grid;gap:8px}
#pv .rung{border:1px solid var(--line);border-radius:10px;padding:10px 12px}
#pv .rung.nc{opacity:.7;border-style:dashed}
#pv .rh{display:grid;grid-template-columns:26px minmax(0,1fr) auto auto;gap:10px;align-items:center}
#pv .rn{width:24px;height:24px;border-radius:50%;background:var(--raised);display:grid;place-items:center;font-size:12px;font-weight:600;color:var(--tx2)}
#pv .rh .val{font-size:18px;font-weight:600}#pv .rh .cum{min-width:120px}
#pv .use{display:flex;align-items:center;gap:10px;margin:8px 0 2px 36px;font-size:12px;color:var(--bad)}
#pv .use i{display:block;height:6px;border-radius:3px;background:var(--bad);opacity:.7;min-width:4px}
#pv .tas{margin:6px 0 0 36px}
#pv .ta{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:4px 0;font-size:13px}
#pv .ta small{display:block}
#pv .ta b{font-weight:500}
#pv .stk{position:relative;display:flex;height:28px;border-radius:8px;overflow:hidden;background:var(--raised)}
#pv .stk .sg{display:block;height:100%}
#pv .stk .gap{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.75) 0 4px,transparent 4px 9px);border-left:2px solid var(--bad);border-right:2px solid var(--bad)}
#pv .stl{display:grid;gap:4px;margin-top:12px}
#pv .sli{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:10px;align-items:start;padding:8px 0;border-top:1px solid var(--line)}
#pv .sli>i{width:12px;height:12px;border-radius:3px;margin-top:4px}#pv .sli .val{font-size:16px;font-weight:600}
#pv .glist{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px 22px}
#pv .glh{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:baseline;padding-bottom:6px;border-bottom:1px solid var(--line);margin-bottom:4px}
#pv .glh .val{font-size:16px;font-weight:600}
#pv .spk{display:block}#pv svg .sph{fill:none;stroke:var(--tx3);stroke-width:1.2}#pv svg .spf{fill:none;stroke:var(--ac);stroke-width:1.6}
/* History */
#pv .wide{overflow:auto;max-height:70vh;border:1px solid var(--line);border-radius:8px}
#pv .wt{width:max-content}
#pv .wt th,#pv .wt td{padding:7px 10px;font-size:11.5px;border-left:1px solid var(--line);text-align:right;white-space:nowrap}
#pv .wt thead th{position:sticky;top:0;background:var(--surface);z-index:2}
#pv .wt thead tr:nth-child(2) th{top:33px}
#pv .wt .gh{text-align:center;cursor:pointer;background:var(--raised)!important;letter-spacing:.08em}
#pv .wt .dc{position:sticky;left:0;background:var(--surface);z-index:1;text-align:left;font-weight:600}
#pv .wt thead .dc{z-index:3}
#pv .wt .tot{font-weight:700}
#pv .wt .gt{border-left:3px solid var(--ac);font-weight:700;background:var(--ac-soft)}
#pv .wt tr.fut td{font-style:italic;opacity:.8}
#pv .wt tr.today td{background:var(--ac-soft)}
#pv .tb{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:5px;background:var(--ac);color:var(--ac-fg);font-size:9.5px;font-weight:700;font-style:normal}
#pv .ht td.dc{white-space:nowrap;color:var(--tx2)}
#pv .ht tr.fut td{font-style:italic;color:var(--tx2)}
#pv .ht tr.today td{background:var(--ac-soft)}
#pv .ht .b{font-weight:600}
#pv .ht tr.hr{cursor:pointer}#pv .ht tr.hr:hover td{background:var(--raised)}
#pv .ht tr.open td{background:var(--raised)}
#pv .rx td{background:var(--raised);padding:4px 14px 14px}
#pv .rxg{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 24px}
#pv .rxg h4{margin:8px 0 2px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
#pv .pv .gsub td{background:var(--raised);font-weight:600}
#pv .pv tr[data-cards]{cursor:pointer}
#pv .pv td.fut{font-style:italic;color:var(--tx2)}
#pv .pv th.tdy{color:var(--ac)}
#pv .pv .an{padding-left:26px}
#pv .ar .its{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--tx2)}
#pv .ar .its em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--tx)}
#pv .ar .its em.good{color:var(--good)}
/* Arrangement */
#pv .split{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,380px);gap:calc(18px*var(--c-density));align-items:start}
#pv .split .col{display:grid;gap:calc(18px*var(--c-density));min-width:0}
#pv .recon{min-height:200px}
@media (max-width:1100px){#pv .split{grid-template-columns:minmax(0,1fr)}#pv .figs{grid-template-columns:repeat(2,minmax(0,1fr))}}
`
});
})();
