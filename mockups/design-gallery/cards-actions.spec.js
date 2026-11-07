// Design gallery spec for the Cards Actions strip (Portfolio and Ecosystem pages).
// Brief: docs/cards-actions-design.md. Content comes from the data file; this file holds no personal figures.
(function(){
const NAV=['Dashboard','Transactions','Budgets','Daily Balances','Cash Flow','Loans','GCB','Cards','Accounts','Settings'];
const GRAD={Chase:'#1e40af,#0f2a5f',Amex:'#0a2f6b,#2563eb',Citi:'#155e75,#0c4a5e',Marriott:'#78350f,#451a03',Hilton:'#4c1d95,#2e1065',United:'#374151,#111827',Delta:'#1e3a5f,#0f172a',Hyatt:'#7f1d1d,#450a0a',Capital:'#991b1b,#450a0a',Bilt:'#14532d,#052e16',Atmos:'#065f46,#022c22',AA:'#334155,#0f172a',Cash:'#b45309,#78350f',Discover:'#9a3412,#7c2d12'};
const grad=eco=>{const k=Object.keys(GRAD).find(k=>(eco||'').startsWith(k));return k?GRAD[k]:'#374151,#1f2937'};
const f=n=>Math.round(n||0).toLocaleString('en-US');
const mo=n=>{const r=Math.round(n*100)/100;return '$'+r.toLocaleString('en-US',r%1?{minimumFractionDigits:2,maximumFractionDigits:2}:{})};
const short=n=>n>=1000?'$'+(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+'k':'$'+Math.round(n);
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dt=s=>{const[y,m,d]=s.split('-');return `${MON[m-1]} ${Number(d)}`};
const dd=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/864e5);
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'#2563EB','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,#2563EB 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C'});

/* ---------- Which items are due ---------- */
function actionItems(p,d){
  if(p.scenario==='none')return [];
  const scope=p.page==='Portfolio'?null:p.page,T=d.today,W=d.window;
  const cr=d.credits.filter(c=>(p.scenario==='stored'||c.src==='model')&&(!scope||c.eco===scope)).map(c=>{const dl=dd(T,c.end)+1;
    return {k:'credit',card:c.card,owner:c.owner,key:c.key,eco:c.eco,name:c.name,amt:c.left,end:c.end,days:dl,frac:dl/(dd(c.start,c.end)+1)}}).filter(x=>x.days<=W);
  const ch=d.challenges.filter(c=>c.status!=='unlocked'&&c.pct<100&&(!scope||c.eco===scope)).map(c=>{const dl=dd(T,c.end)+1,tot=dd(c.start,c.end)+1,el=Math.max(0,dd(c.start,T));
    return {k:'ch',card:`${c.card} ${c.mask}`,owner:c.owner,key:c.key,eco:c.eco,name:c.name,amt:c.remaining,end:c.end,days:dl,frac:dl/tot,pct:c.pct,behind:c.spent<c.target*el/tot}}).filter(x=>x.days<=30||(p.risk==='pace'&&x.behind));
  const by=(a,b)=>a.days-b.days||b.amt-a.amt;cr.sort(by);ch.sort(by);
  const all=p.order==='date'?[...cr,...ch].sort(by):[...cr,...ch];
  all.forEach((x,i)=>x.i=i);return all;
}
const urg=x=>x.days<=14?'u-hi':x.days<=30?'u-md':'u-lo';
function circ(x,p,mini){const r=20,C=2*Math.PI*r,fs=mini?14:12;
  if(x.k==='ch'&&p.chCircle==='progress'){const l=short(x.amt);return `<svg class="ring sm" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="${r}" fill="none" stroke="var(--line)" stroke-width="4.5"/><circle cx="25" cy="25" r="${r}" fill="none" stroke="var(--uc)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${C*Math.min(x.pct,100)/100} ${C}" transform="rotate(-90 25 25)"/><text x="25" y="29" text-anchor="middle" fill="var(--tx)" font-size="${mini?12.5:l.length>4?10.5:11.5}" font-weight="600">${mini?Math.round(x.pct)+'%':l}</text></svg>`;}
  return `<svg class="ring sm" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="${r}" fill="none" stroke="var(--line)" stroke-width="4.5"/><circle cx="25" cy="25" r="${r}" fill="none" stroke="var(--uc)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${C*Math.min(1,x.frac)} ${C}" transform="rotate(-90 25 25)"/><text x="25" y="29.5" text-anchor="middle" fill="var(--tx)" font-size="${fs}" font-weight="600">${x.days}d</text></svg>`;}
const art=(x,h,cls)=>{const a=h.img('card_'+x.key);return `<span class="xart ${cls||''}" style="background:linear-gradient(135deg,${grad(x.eco)})">${a?`<img src="${a}" alt="">`:''}</span>`};
const who=(x,p,h)=>h.esc(x.card)+(p.showOwner&&x.owner?` · ${h.esc(x.owner)}`:'');
const line=x=>x.k==='credit'?`<em>${mo(x.amt)}</em> left, by ${dt(x.end)}`:`<em>$${f(x.amt)}</em> to go, by ${dt(x.end)}`;
function tile(x,p,h){const th=p.thumb,nm=h.esc(x.name);
  const top=th==='top'?`<span class="xt">${art(x,h)}<span>${who(x,p,h)}</span></span>`:'';
  const act=x.k==='credit'?`<span class="xo" aria-hidden="true"><i>✓</i></span><span class="xs" hidden><span class="xs-t"><i>✓</i>Marked used</span><button type="button" class="btn sm undo">Undo</button><span class="tm" style="animation-duration:5s"></span></span>`:`<span class="xgo" aria-hidden="true">›</span>`;
  const lab=x.k==='credit'?`Mark ${nm} on ${h.esc(x.card)} as used`:`Open the Card page for ${h.esc(x.card)}`;
  return `<div class="sf xc ${urg(x)} th-${th} k-${x.k}" role="button" tabindex="0" aria-label="${lab}" data-xi="${x.i}">${top}${th==='left'?art(x,h,'big'):''}<span class="xcirc">${circ(x,p)}${th==='badge'?art(x,h,'chip'):''}</span><span class="xb"><b>${nm}</b><small>${line(x)}</small>${th!=='top'?`<span class="xcard">${who(x,p,h)}</span>`:''}</span>${act}</div>`;}
function head(I,p){const cr=I.filter(x=>x.k==='credit'),n=I.length,amt=cr.reduce((t,x)=>t+x.amt,0),nch=n-cr.length;
  const hid=b=>b?'':' hidden';
  if(p.head==='split')return `<div class="ah" data-ah><h2>Actions <span class="ct" data-hn>${n}</span></h2><span class="ah-sum"><span data-hcrw${hid(cr.length)}><b data-hamt>${mo(amt)}</b> in credits expiring</span><span data-hchw${hid(nch)}><span class="sep" data-hcrw${hid(cr.length)}> · </span><b data-hch>${nch}</b> challenge<span data-hchs>${nch===1?'':'s'}</span> at risk</span></span></div>`;
  if(p.head==='chips')return `<div class="ah" data-ah><h2>Actions</h2><span class="ah-chips"><span class="achip" data-hcrw${hid(cr.length)}><i></i><b data-hcr>${cr.length}</b>&nbsp;credits, <b data-hamt>${mo(amt)}</b></span><span class="achip ch" data-hchw${hid(nch)}><i></i><b data-hch>${nch}</b>&nbsp;challenge<span data-hchs>${nch===1?'':'s'}</span> at risk</span></span></div>`;
  return `<div class="ah" data-ah><h2>Actions <span class="ct">· <span data-hn>${n}</span> item<span data-hns>${n===1?'':'s'}</span><span data-hcrw${hid(cr.length)}> · <span data-hamt>${mo(amt)}</span> in credits expiring</span></span></h2></div>`;}
function grid(list,p,h,cap,label){return `<div class="xblk">${label?`<div class="xbl">${label}</div>`:''}<div class="xg" data-cap="${cap}">${list.map(x=>tile(x,p,h)).join('')}<button type="button" class="xm" data-more hidden><span>+0 more</span></button></div></div>`;}
function nextLine(p,d,h){const scope=p.page==='Portfolio'?'_all':p.page,n=(d.next[p.scenario==='stored'?'stored':'model']||{})[scope];
  return `All caught up for the next ${d.window} days.${n?` Next: <b>${h.esc(n.name)}</b> on ${h.esc(n.card)}, ${mo(n.left)} by ${dt(n.end)}.`:''}`;}
function emptyRow(p,d,h,shown){return `<div class="xe" data-xe ${shown?'':'hidden'}><h2>Actions</h2><span class="xe-ok" aria-hidden="true">✓</span><span>${nextLine(p,d,h)}</span></div>`;}
function actions(p,d,h,I,where){
  const cap=where==='rail'&&p.cap==='fit'?'railfit':p.cap;let body='';
  if(I.length){if(p.order==='rows'){const cr=I.filter(x=>x.k==='credit'),ch=I.filter(x=>x.k==='ch');body=(cr.length?grid(cr,p,h,cap,'Credits expiring'):'')+(ch.length?grid(ch,p,h,cap,'Challenges at risk'):'');}
    else body=grid(I,p,h,cap);}
  return `<section data-region="place" data-act class="act act-${where}" ${!I.length&&p.empty==='hide'?'hidden':''}>${I.length?head(I,p):''}${body}${emptyRow(p,d,h,!I.length)}</section>`;}
function badge(I,p,d,h){if(!I.length&&p.empty==='hide')return '';const cr=I.filter(x=>x.k==='credit'),amt=cr.reduce((t,x)=>t+x.amt,0);
  const u=I.length?urg(I.reduce((a,b)=>a.days<=b.days?a:b)):'ok';
  return `<button type="button" class="abadge ${u}" data-badge aria-label="Actions"><i data-hn>${I.length||'✓'}</i><span>${I.length?`Actions<span data-hcrw${cr.length?'':' hidden'}> · <b data-hamt>${mo(amt)}</b> expiring</span>`:'All caught up'}</span></button>`;}
function row(x,p,h){const act=x.k==='credit'?`<button type="button" class="btn sm" data-use>✓ Mark used</button><span class="xs" hidden><span class="xs-t"><i>✓</i>Marked used</span><button type="button" class="btn sm undo">Undo</button><span class="tm" style="animation-duration:5s"></span></span>`:`<button type="button" class="btn sm" data-open>Open card ›</button>`;
  return `<div class="fl-r ${urg(x)}" data-xi="${x.i}" data-k="${x.k}" data-amt="${x.amt}">${circ(x,p,true)}<span class="fl-n"><b>${h.esc(x.name)}</b><small>${line(x)}${x.k==='ch'?' · challenge':''}</small></span>${act}</div>`;}
function listBody(I,p,h){const G=new Map();I.forEach(x=>{if(!G.has(x.card))G.set(x.card,[]);G.get(x.card).push(x)});
  return [...G].map(([card,xs])=>{const x0=xs[0],cr=xs.filter(x=>x.k==='credit'),a=cr.reduce((t,x)=>t+x.amt,0);
    return `<div class="fl-g" data-flg><div class="fl-h">${art(x0,h)}<b>${h.esc(card)}</b>${x0.owner?`<span>${h.esc(x0.owner)}</span>`:''}<em data-flgc>${xs.length} item${xs.length===1?'':'s'}${cr.length?' · '+mo(a):''}</em></div>${xs.map(x=>row(x,p,h)).join('')}</div>`}).join('');}
function listShell(I,p,d,h){if(p.place!=='badge'&&p.more==='expand')return '';
  const inner=`<div class="mh"><h3>All actions <span class="ct" data-ln>${I.length}</span></h3><button type="button" class="ib" data-lclose aria-label="Close">×</button></div><div class="mb">${listBody(I,p,h)}<p class="xe1" data-xe1 ${I.length?'hidden':''}>${nextLine(p,d,h)}</p></div><div class="mf"><button type="button" class="btn pri" data-lclose>Done</button></div>`;
  if(p.place==='badge')return `<div class="apanel" data-list role="dialog" aria-label="All actions" hidden>${inner}</div>`;
  if(p.more==='drawer')return `<aside class="drw" data-list role="dialog" aria-label="All actions" hidden>${inner}</aside>`;
  return `<div class="mdl-bk" data-lbk hidden></div><div class="mdl" data-list role="dialog" aria-modal="true" aria-label="All actions" hidden>${inner}</div>`;}

/* ---------- Page chrome (decided in the Portfolio and Ecosystem galleries) ---------- */
const nav=()=>`<nav class="appnav"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(n=>`<button type="button" class="${n==='Cards'?'on':''}">${n}</button>`).join('')}</div></nav>`;
const period=d=>`<div class="period"><div class="und">${['MTD','QTD','YTD'].map(x=>`<button type="button" class="${x===d.period?'on':''}">${x}</button>`).join('')}</div><select class="yr" aria-label="Year"><option>${d.year}</option><option>${d.year-1}</option></select></div>`;
function header(p,d,h,bdg){const left=p.page==='Portfolio'?`<div class="und big">${['Portfolio','Swipe Advisor','Card Management'].map((t,i)=>`<button type="button" class="${i?'':'on'}">${t}</button>`).join('')}</div>`:`<div class="crumbs"><button type="button">Cards</button><i>›</i><button type="button">Portfolio</button><i>›</i><b>${h.esc(p.page)}</b></div>`;
  return `<header class="hdr sf"><div class="hdr-r">${left}<div class="hdr-x">${bdg}${period(d)}</div></div></header>`;}
function logo(name,key,h){const s=key?h.img(`logo_${key}_light`):'';return s?`<span class="lg"><img src="${s}" alt="${h.esc(name)}"></span>`:`<span class="mono"><i>${h.esc(name[0])}</i><span>${h.esc(name)}</span></span>`;}
function programs(d,h){const L=[...d.ecos].sort((a,b)=>b.balance-a.balance);
  return `<section><h2>Rewards programs</h2><div class="e-tiles">${L.map(e=>`<div class="e-tile sf">${logo(e.name,e.logo,h)}<div class="e-b"><b class="val">${f(e.balance)}</b><div class="meta"><span class="${e.earned>0?'up':'mut'}">+${f(e.earned)} ${d.period}</span>${e.pending>0?`<span class="pend">${f(e.pending)} pending</span>`:''}</div></div></div>`).join('')}<div class="e-tile sf"><span class="mono"><i>$</i><span>Cash Back</span></span><div class="e-b"><b class="val good">$${(d.cashBack||0).toFixed(2)}</b><div class="meta"><span class="mut">earned ${d.period}</span></div></div></div></div></section>`;}
function face(c,eco,h){const a=h.img('card_'+c.key);return `<div class="c-face" style="background:linear-gradient(135deg,${grad(eco)})">${a?`<img src="${a}" alt="${h.esc(c.name)}">`:`<span class="c-fb">${h.esc(c.name)}</span>`}<span class="c-mask">${h.esc(c.mask||'')}</span></div>`;}
function cardRow(list,h,o){const items=list.map(c=>`<div class="c-item" data-owner="${h.esc(c.owner||'Unassigned')}">${face(c,c.eco,h)}${o.cap?`<div class="e-cap"><span>${h.esc(c.owner||'Unassigned')}</span><b>${f(c.points)} pts</b></div>`:''}</div>`).join('');
  const owners=[...new Set(list.map(c=>c.owner||'Unassigned'))];
  const chips=o.chips?`<div class="own" role="group" aria-label="Filter by cardholder"><button type="button" class="chip on" data-own="">All</button>${owners.map(x=>`<button type="button" class="chip" data-own="${h.esc(x)}">${h.esc(x)}</button>`).join('')}</div>`:'';
  return `<section><div class="s-head"><h2>Your cards <span class="ct">${list.length}</span></h2>${chips}</div><div class="c-wrap"><button type="button" class="arr l" aria-label="Scroll cards left">‹</button><div class="c-scroll">${items}</div><button type="button" class="arr r" aria-label="Scroll cards right">›</button></div></section>`;}
function ring(c){const r=22,C=2*Math.PI*r,done=c.status==='unlocked'||c.pct>=100,l=done?'Done':short(c.remaining);
  return `<svg class="ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--ac)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C*Math.min(c.pct,100)/100} ${C}" transform="rotate(-90 27 27)"/><text x="27" y="31" text-anchor="middle" fill="var(--tx)" font-size="${l.length>4?10.5:12}" font-weight="600">${l}</text></svg>`;}
function chGrid(list,p,d,h,I){const risk=new Map(I.filter(x=>x.k==='ch').map(x=>[x.card+'|'+x.name,x]));
  const body=list.map(c=>{const done=c.status==='unlocked'||c.pct>=100,r=p.flagGrid&&risk.get(`${c.card} ${c.mask}|${c.name}`);
    return `<div class="ch-card sf ring-c ${r?'risk':''}"><div class="rings"><figure>${ring(c)}<figcaption>${done?'':'to go'}</figcaption></figure></div><div class="ch-t"><b>${h.esc(c.name)}</b><span>${h.esc(c.card)} ${h.esc(c.mask)}</span><span class="ch-bonus">${h.esc(c.bonus)}</span>${r?`<span class="risk-t">At risk, ${r.days} days left</span>`:''}</div>${done?'<button type="button" class="arch">Archive</button>':''}</div>`}).join('');
  return `<section><h2>Active challenges <span class="ct">${list.length}</span></h2><div class="ch-grid">${body}<button type="button" class="ch-add" aria-label="Add a challenge"><span>+</span></button></div></section>`;}
/* Ecosystem */
function fan(e,h){const cs=e.cards.slice(0,3),more=e.cards.length-3;return `<div class="fan">${cs.map(c=>{const a=h.img('card_'+c.key);return `<span class="fc" style="background:linear-gradient(135deg,${grad(e.name)})">${a?`<img src="${a}" alt="">`:''}</span>`}).join('')}${more>0?`<span class="fc more">+${more}</span>`:''}</div>`;}
function eHero(e,d,h){const sub=`${e.cards.length} card${e.cards.length===1?'':'s'} linked, ${h.esc(e.currency)}`;
  const people=(e.people||[]).map(x=>`<div class="h-st"><span>${h.esc(x)}</span><b class="val">${f(e.buckets[x].current_balance)}</b></div>`).join('');
  return `<section class="h-split sf"><div class="h-a"><div class="h-lgo">${logo(e.name,e.logo,h)}</div><small>${sub}</small></div><div class="h-b"><small class="h-lab">Current balance, posted</small><div class="val h-big">${f(e.balance)}</div></div><div class="h-sts">${people}<div class="h-st"><span>Pending</span><b class="val pend">${f(e.pending)}</b></div><div class="h-st"><span>Earned ${d.period}</span><b class="val up">+${f(e.earned)}</b></div></div>${fan(e,h)}</section>`;}
const sg=v=>(v>0?'+':v<0?'−':'')+f(Math.abs(v)),cl=v=>v>0?'up':v<0?'neg':'mut';
function ledger(e,h){if(!e.buckets)return '';const b=e.buckets,all=Object.keys(b),sum=g=>all.reduce((s,x)=>s+g(b[x]),0);
  const R=[['Earned',x=>x.earned_since_baseline],['Pending, not yet posted',x=>-(x.pending_since_baseline||0)],['Redeemed',x=>-x.redeemed_since_baseline],['Transferred out',x=>-x.transferred_out_since_baseline],['Transferred in',x=>x.transferred_in_since_baseline],['Adjusted',x=>x.adjusted_since_baseline]].filter(r=>Math.abs(sum(r[1]))>=.5);
  const card=(n,cur,start,vals,tot)=>`<div class="l-p ${tot?'tot':''}"><div class="l-ph"><b>${n}</b></div><div class="val l-cur">${f(cur)}</div><dl><dt>Starting balance</dt><dd>${f(start)}</dd>${R.map((r,i)=>`<dt>${r[0]}</dt><dd class="${cl(vals[i])}">${sg(vals[i])}</dd>`).join('')}</dl></div>`;
  const T=card('Total',sum(x=>x.current_balance),sum(x=>x.starting_balance),R.map(r=>sum(r[1])),true);
  const P=e.people.map(x=>card(h.esc(x),b[x].current_balance,b[x].starting_balance,R.map(r=>r[1](b[x])))).join('');
  const legacy=b.Shared&&(b.Shared.starting_balance||0)>0?`<p class="leg">${f(b.Shared.starting_balance)} of the starting balance has no person assigned. It counts in Total only.</p>`:'';
  return `<section><div class="s-head"><h2>Balance ledger</h2><button type="button" class="btn-g">+ Transfer between us</button></div><div class="sf pn"><div class="l-people">${T}${P}</div>${legacy}<div class="l-acts">${e.people.map(x=>`<div><b>${h.esc(x)}</b><button type="button" class="btn-g">${b[x].balance_as_of?'Edit':'Set'} starting balance</button></div>`).join('')}</div></div></section>`;}
function cats(e,d,h){if(!e.cats||!e.cats.length)return '';const max=Math.max(...e.cats.map(c=>c.points),1);
  return `<section><h2>Points by category <span class="ct">${d.period}</span></h2><div class="sf pn"><div class="c-bars">${e.cats.map(c=>`<div class="cb"><span>${h.esc(c.category||'Other')}</span><div class="bar"><i style="width:${Math.max(0,Math.round(c.points/max*100))}%"></i></div><b>${f(c.points)}</b><em>${Math.round(c.pct)}%</em></div>`).join('')}</div></div></section>`;}
const activity=()=>`<section><div class="s-head"><h2>Activity</h2></div><div class="sf pn"><p class="emp">Timeline, filters and add buttons as approved for the Ecosystem page; not repeated in this gallery.</p></div></section>`;

Gallery.define({
  id:'cards-actions-r1',
  name:'Cards: Actions strip, round 1',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap'],
  groups:[
   {id:'see',label:'What to preview (not design choices)',open:true,controls:[
    {id:'page',label:'Page',type:'choice',options:[
      {id:'Portfolio',label:'Portfolio',hint:'Every card in scope.'},
      {id:'Amex MR',label:'Ecosystem: Amex MR',hint:'Platinum 1008’s six open credits.'},
      {id:'Hilton Honors',label:'Ecosystem: Hilton Honors',hint:'Aspire’s two credits; its night challenge is done, so it stays off the strip.'},
      {id:'Chase UR',label:'Ecosystem: Chase UR',hint:'Sapphire Preferred’s two credits. The three Freedom challenges are on pace, so none show.'},
      {id:'Marriott Bonvoy',label:'Ecosystem: Marriott Bonvoy',hint:'Nothing due, so you see the empty state.'},
    ]},
    {id:'scenario',label:'Credits',type:'choice',options:[
      {id:'model',label:'Today, from the statement model',hint:'Platinum 1008, Aspire 2007 and SP 3698, with their real 2026 uses. Other cards have no reliable credit data yet.'},
      {id:'stored',label:'Add every stored credit, none used',hint:'Adds 33 credits from the other cards as if unused. A stress test: year end is when most annual credits reset.'},
      {id:'none',label:'All caught up',hint:'Everything due has been used.'},
    ]},
   ]},
   {id:'place',label:'Where it goes',open:true,controls:[
    {id:'place',label:'Placement',type:'choice',options:[
      {id:'strip',label:'Strip at the top',hint:'The brief’s proposal. Portfolio: above programs. Ecosystem: under the balance header, above the ledger.'},
      {id:'rail',label:'Side rail',hint:'A column beside programs and cards (Portfolio) or beside the ledger (Ecosystem). Items stack.'},
      {id:'badge',label:'Header badge that opens a panel',hint:'Takes no room on the page. The count sits beside the period selector; the panel closes with × or Done.'},
    ]},
   ]},
   {id:'items',label:'The item card',open:true,controls:[
    {id:'thumb',label:'Card thumbnail',type:'choice',options:[
      {id:'top',label:'Card art and name across the top',hint:'A small header line names the card; the countdown and credit sit below.'},
      {id:'left',label:'Larger art on the left, circle on the right',hint:'The art leads, the countdown closes the row.'},
      {id:'badge',label:'Small art pinned to the circle',hint:'Card name as a third line of text.'},
      {id:'text',label:'No art, card name in text',hint:'Same card as the Card page, plus one line.'},
    ]},
    {id:'showOwner',label:'Show whose card it is',type:'toggle',default:true},
    {id:'chCircle',label:'Circle on a challenge',type:'choice',options:[
      {id:'days',label:'Days left, like credits',hint:'The brief’s proposal: the same countdown for both.'},
      {id:'progress',label:'Spend progress with $ to go',hint:'Matches the challenge cards below; the color still shows urgency.'},
    ]},
    {id:'itemW',label:'Smallest item card (as many as fit)',type:'slider',min:200,max:290,step:5,default:230,unit:'px'},
   ]},
   {id:'list',label:'How many, and in what order',open:true,controls:[
    {id:'cap',label:'Items before “+N more”',type:'choice',options:[
      {id:'4',label:'4'},
      {id:'5',label:'5'},
      {id:'fit',label:'As many as fit one row',hint:'In the side rail: as many as fit beside programs and cards.'},
    ]},
    {id:'order',label:'Credits and challenges',type:'choice',options:[
      {id:'date',label:'Mixed, soonest first'},
      {id:'group',label:'Credits first, then challenges',hint:'Each kind sorted soonest first.'},
      {id:'rows',label:'Two labeled rows',hint:'“Credits expiring” and “Challenges at risk”, each with its own “+N more”.'},
    ]},
    {id:'more',label:'“+N more” opens',type:'choice',options:[
      {id:'modal',label:'A window, grouped by card',hint:'The brief’s proposal. Closes only with × or Done. Credits can be marked used there too.'},
      {id:'drawer',label:'A side panel, grouped by card',hint:'Same list, from the right edge.'},
      {id:'expand',label:'Expands the strip in place',hint:'All items as cards, then “Show fewer”.'},
    ]},
    {id:'head',label:'Heading',type:'choice',options:[
      {id:'line',label:'One line',hint:'The brief’s “Actions · N items · $X in credits expiring”.'},
      {id:'split',label:'Count left, totals right'},
      {id:'chips',label:'Count chips',hint:'One chip for credits and one for challenges.'},
    ]},
   ]},
   {id:'risk',label:'Which challenges show',open:true,controls:[
    {id:'risk',label:'At risk means',type:'choice',options:[
      {id:'pace',label:'Ends within 30 days, or behind pace',hint:'The brief’s proposal. Behind pace: spent less than the target times the share of the window gone. Today both rules pick the same two (Prime Visa and Atmos).'},
      {id:'days',label:'Ends within 30 days only'},
    ]},
    {id:'flagGrid',label:'Mark at-risk challenges in the challenge grid',type:'toggle',default:false},
   ]},
   {id:'empty',label:'When nothing is due',open:true,controls:[
    {id:'empty',label:'Empty state',type:'choice',options:[
      {id:'line',label:'One line with the next credit',hint:'The brief’s proposal. Try Marriott Bonvoy, or mark everything used.'},
      {id:'hide',label:'Hide it completely'},
    ]},
   ]},
   {id:'decided',label:'Decided in the Cards galleries',open:false,controls:[
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'current',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
    {id:'itemCard',label:'Item card',type:'choice',locked:true,options:[{id:'ring',label:'Card page countdown card: red at 14 days or less, amber at 30, else blue'}]},
    {id:'window',label:'Counts as expiring',type:'choice',locked:true,options:[{id:'60',label:'Money left, resets within 60 days'}]},
    {id:'markUsed',label:'Marking a credit used',type:'choice',locked:true,options:[{id:'undo',label:'Hover check, Marked used, Undo for 5 seconds'}]},
    {id:'chClick',label:'Clicking a challenge',type:'choice',locked:true,options:[{id:'card',label:'Opens its Card page'}]},
    {id:'windows',label:'Windows and panels',type:'choice',locked:true,options:[{id:'buttons',label:'Close only with their buttons'}]},
   ]},
  ],
  render(p,d,h){
    const I=actionItems(p,d),bdg=p.place==='badge'?badge(I,p,d,h):'',A=w=>actions(p,d,h,I,w);
    let body;
    if(p.page==='Portfolio'){
      const P=programs(d,h),C=cardRow(d.cards,h,{chips:true}),CH=chGrid(d.challenges,p,d,h,I);
      if(p.place==='strip')body=A('strip')+P+C+CH;
      else if(p.place==='rail')body=`<div class="railwrap"><div class="rw-main" data-rwmain>${P}${C}</div><aside class="rw-side">${A('rail')}</aside></div>${CH}`;
      else body=P+C+CH;
    }else{
      const e=d.programs[p.page],H=eHero(e,d,h),L=ledger(e,h),K=cats(e,d,h),C=cardRow(e.cards.map(c=>({...c,eco:e.name})),h,{cap:true}),CH=chGrid(e.challenges,p,d,h,I);
      if(p.place==='strip')body=H+A('strip')+L+K+C+CH+activity();
      else if(p.place==='rail')body=H+`<div class="railwrap"><div class="rw-main" data-rwmain>${L}${K}</div><aside class="rw-side">${A('rail')}</aside></div>`+C+CH+activity();
      else body=H+L+K+C+CH+activity();
    }
    const src=h.esc(JSON.stringify(I.map(x=>({i:x.i,k:x.k,amt:x.amt,card:x.card}))));
    return `<div class="app" data-items="${src}">${nav()}<div class="main">${header(p,d,h,bdg)}${body}</div>${listShell(I,p,d,h)}<div class="toast" role="status" hidden></div></div>`;
  },
  after(root,p){
    const app=root.querySelector('.app'),stage=document.getElementById('stage'),toast=root.querySelector('.toast');
    const say=t=>{toast.textContent=t;toast.style.top=((stage?stage.scrollTop:0)+14)+'px';toast.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>{toast.hidden=true},2600)};
    if(window.__aRO)window.__aRO.forEach(o=>o.disconnect());window.__aRO=[];
    /* Card rows: whole cards only, arrows, cardholder chips */
    const fitCards=()=>root.querySelectorAll('.c-scroll').forEach(sc=>{const w=sc.getBoundingClientRect().width;if(!w)return;const g=parseFloat(getComputedStyle(sc).columnGap)||0,n=Math.max(1,Math.floor((w+g)/(175+g))),iw=(w-g*(n-1))/n,items=sc.querySelectorAll('.c-item:not([hidden])').length,extra=(n-items%n)%n;
      sc.style.setProperty('--whole-w',iw+'px');sc.dataset.page=n*(iw+g);let sp=sc.querySelector('.c-sp');if(!sp){sp=document.createElement('i');sp.className='c-sp';sc.append(sp)}sp.style.width=Math.max(0,extra*(iw+g)-g)+'px';sp.hidden=!extra;});
    fitCards();const sc0=root.querySelector('.c-scroll');if(sc0){const o=new ResizeObserver(fitCards);o.observe(sc0);window.__aRO.push(o)}
    root.querySelectorAll('.c-wrap').forEach(w=>{const sc=w.querySelector('.c-scroll');w.querySelector('.l').onclick=()=>sc.scrollBy({left:-Number(sc.dataset.page),behavior:'smooth'});w.querySelector('.r').onclick=()=>sc.scrollBy({left:Number(sc.dataset.page),behavior:'smooth'})});
    root.querySelectorAll('[data-own]').forEach(b=>b.onclick=()=>{root.querySelectorAll('[data-own]').forEach(x=>x.classList.toggle('on',x===b));const v=b.dataset.own;root.querySelectorAll('.c-item').forEach(i=>{i.hidden=!!v&&i.dataset.owner!==v});fitCards();root.querySelectorAll('.c-scroll').forEach(c=>{c.scrollLeft=0})});
    root.querySelectorAll('.arch').forEach(b=>b.onclick=()=>{b.closest('.ch-card').hidden=true;say('Archived. It moves to Show archived under the grid.')});
    /* Actions */
    const SRC=JSON.parse(app.dataset.items||'[]'),gone=new Set(),UNDO=5000;
    const sec=root.querySelector('[data-act]'),list=root.querySelector('[data-list]'),bk=root.querySelector('[data-lbk]'),bdg=root.querySelector('[data-badge]');
    const grids=[...root.querySelectorAll('.xg')],mainCol=root.querySelector('[data-rwmain]');
    const live=()=>SRC.filter(x=>!gone.has(x.i));
    const MORE=112;
    const plan=(g,n)=>{const c=g.dataset.cap;
      if(c==='fit'){const w=g.clientWidth,gap=parseFloat(getComputedStyle(g).columnGap)||0,all=Math.max(1,Math.floor((w+gap)/(p.itemW+gap)));
        if(n<=all)return {cap:n,cols:all};const cols=Math.max(1,Math.floor((w-MORE)/(p.itemW+gap)));return {cap:cols,cols}}
      if(c==='railfit'){const gap=parseFloat(getComputedStyle(g).rowGap)||0,avail=mainCol?mainCol.getBoundingClientRect().bottom-g.getBoundingClientRect().top:600,rows=Math.max(2,Math.floor((avail+gap)/((g._th||118)+gap)));return {cap:n>rows?rows-1:rows,cols:0}}
      const k=Number(c)||4;return {cap:k,cols:g.closest('.act-rail')?0:k}};
    function recount(){const L=live(),cr=L.filter(x=>x.k==='credit'),amt=cr.reduce((t,x)=>t+x.amt,0),nch=L.length-cr.length,set=(s,v)=>root.querySelectorAll(s).forEach(e=>{e.textContent=v});
      set('[data-hn]',L.length||'✓');set('[data-hns]',L.length===1?'':'s');set('[data-hamt]',mo(amt));set('[data-hcr]',cr.length);set('[data-hch]',nch);set('[data-hchs]',nch===1?'':'s');set('[data-ln]',L.length);
      root.querySelectorAll('[data-hcrw]').forEach(e=>{e.hidden=!cr.length});root.querySelectorAll('[data-hchw]').forEach(e=>{e.hidden=!nch});
      const empty=!L.length;
      if(sec&&empty){sec.querySelectorAll('[data-ah],.xblk').forEach(e=>{e.hidden=true});const xe=sec.querySelector('[data-xe]');if(xe)xe.hidden=false;if(p.empty==='hide')sec.hidden=true}
      if(bdg&&empty){bdg.classList.remove('u-hi','u-md','u-lo');bdg.classList.add('ok');bdg.querySelector('span').textContent='All caught up';if(p.empty==='hide')bdg.hidden=true}
      if(list){list.querySelectorAll('[data-flg]').forEach(g=>{const R=[...g.querySelectorAll('.fl-r:not(.gone)')];if(!R.length){g.remove();return}const c=R.filter(r=>r.dataset.k==='credit'),a=c.reduce((t,r)=>t+Number(r.dataset.amt),0);g.querySelector('[data-flgc]').textContent=`${R.length} item${R.length===1?'':'s'}${c.length?' · '+mo(a):''}`});
        const e1=list.querySelector('[data-xe1]');if(e1)e1.hidden=!empty}}
    function layout(enter){grids.forEach(g=>{const T=[...g.querySelectorAll('.xc')].filter(t=>!t.classList.contains('gone'));
        if(!g._th){const v=T.find(t=>t.offsetHeight);g._th=v?v.offsetHeight:118}
        const pl=plan(g,T.length);if(g.dataset.exp==='1'&&T.length<=pl.cap)g.dataset.exp='0';
        const exp=g.dataset.exp==='1',cap=exp?T.length:pl.cap;
        T.forEach((t,i)=>{const show=i<cap;if(show&&t.hidden&&enter){t.classList.remove('enter');void t.offsetWidth;t.classList.add('enter')}t.hidden=!show});
        const more=g.querySelector('[data-more]'),q=T.length-Math.min(cap,T.length);
        if(exp){more.hidden=false;more.firstChild.textContent='Show fewer'}else{more.hidden=!q;more.firstChild.textContent=`+${q} more`}
        if(pl.cols)g.style.gridTemplateColumns=`repeat(${pl.cols},minmax(0,1fr))${!exp&&q?` ${MORE}px`:''}`;
        const blk=g.closest('.xblk');if(blk)blk.hidden=!T.length;});
      recount();}
    function commit(xi){if(gone.has(xi))return;gone.add(xi);
      root.querySelectorAll(`[data-xi="${xi}"]`).forEach(e=>{clearTimeout(e._t);e.classList.add('drop');setTimeout(()=>{e.classList.add('gone');e.hidden=true},320)});
      setTimeout(()=>layout(true),340);}
    function arm(el){if(el.classList.contains('used'))return;el.classList.add('used');el.querySelector('.xs').hidden=false;el._t=setTimeout(()=>commit(Number(el.dataset.xi)),UNDO)}
    function undo(el){clearTimeout(el._t);el.classList.remove('used');el.querySelector('.xs').hidden=true}
    const find=xi=>SRC.find(s=>s.i===xi),openCard=x=>say(`Opens the Card page for ${x.card}`);
    root.querySelectorAll('.xc').forEach(t=>{const x=find(Number(t.dataset.xi));
      const act=e=>{e.stopPropagation();if(x.k==='credit')arm(t);else openCard(x)};
      t.onclick=e=>{if(e.target.closest('.undo'))return;act(e)};
      t.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===t){e.preventDefault();act(e)}};
      const u=t.querySelector('.undo');if(u)u.onclick=e=>{e.stopPropagation();undo(t);t.focus()};});
    root.querySelectorAll('.fl-r').forEach(r=>{const x=find(Number(r.dataset.xi));
      const b=r.querySelector('[data-use]');if(b)b.onclick=()=>arm(r);
      const o=r.querySelector('[data-open]');if(o)o.onclick=()=>openCard(x);
      const u=r.querySelector('.undo');if(u)u.onclick=()=>undo(r);});
    const openList=from=>{if(!list)return;const st=stage?stage.scrollTop:0;list.hidden=false;if(bk)bk.hidden=false;
      if(list.classList.contains('mdl'))list.style.top=Math.max(st+12,from.getBoundingClientRect().top-app.getBoundingClientRect().top-80)+'px';
      else if(list.classList.contains('drw')){list.style.top=st+'px';list.style.height=(stage?stage.clientHeight:640)+'px'}
      else{const hd=root.querySelector('.hdr');list.style.top=(hd.offsetTop+hd.offsetHeight+8)+'px'}
      recount();};
    const closeList=()=>{list.hidden=true;if(bk)bk.hidden=true};
    root.querySelectorAll('[data-lclose]').forEach(b=>b.onclick=closeList);
    root.querySelectorAll('[data-more]').forEach(m=>m.onclick=e=>{e.stopPropagation();const g=m.closest('.xg');if(p.more==='expand'){g.dataset.exp=g.dataset.exp==='1'?'0':'1';layout(true)}else openList(m)});
    if(bdg)bdg.onclick=()=>{if(list.hidden)openList(bdg)};
    layout(false);
    if(grids.length){const o=new ResizeObserver(()=>layout(false));o.observe(grids[0]);if(mainCol)o.observe(mainCol);window.__aRO.push(o)}
  },
  css:`
#pv{--c-radius:13px;--c-density:1.25;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density));--tile-h:calc(var(--p)*2 + 78px)}
#pv[data-thumb=top]{--tile-h:calc(var(--p)*2 + 96px)}
#pv *{box-sizing:border-box}
#pv [hidden]{display:none!important}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#pv button:focus-visible,#pv select:focus-visible,#pv [tabindex]:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv h1,#pv h2,#pv h3,#pv .val{font-family:var(--f-h)}
#pv h2{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);margin:0 0 var(--gap)}
#pv .ct{font-weight:500;opacity:.8;margin-left:3px}
#pv .app{display:flex;flex-direction:column;min-height:100vh;min-width:0;position:relative}
#pv .main{min-width:0;width:100%;padding:calc(22px*var(--c-density)) calc(26px*var(--c-density));display:grid;gap:calc(26px*var(--c-density));align-content:start}
#pv section{min-width:0}
#pv .appnav{display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--line);background:var(--surface);padding:8px 16px;min-width:0}
#pv .brand{display:flex;align-items:center;gap:9px;font-family:var(--f-h);font-weight:600;flex:none}
#pv .brand i{font-style:normal;width:30px;height:30px;border-radius:8px;background:var(--ac);color:var(--ac-fg);display:grid;place-items:center}
#pv .nv{display:flex;gap:2px;overflow-x:auto;min-width:0;scrollbar-width:none}
#pv .nv button{padding:7px 10px;border-radius:8px;color:var(--tx2);font-size:13.5px;white-space:nowrap}
#pv .nv button.on{background:var(--ac-soft);color:var(--ac);font-weight:600}
/* Header */
#pv .hdr.sf{padding:10px 18px}
#pv .hdr-r{display:flex;justify-content:space-between;align-items:center;gap:12px 20px;flex-wrap:wrap}
#pv .hdr-x{display:flex;align-items:center;gap:12px 18px;flex-wrap:wrap}
#pv .und{display:flex;gap:18px}
#pv .und button{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12px}
#pv .und.big button{font-size:13px}
#pv .und button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .period{display:flex;align-items:center;gap:12px}
#pv .yr{font:inherit;font-size:12px;padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--raised);color:var(--tx)}
#pv .crumbs{display:flex;gap:7px;align-items:center;font-size:13px;flex-wrap:wrap}
#pv .crumbs button{color:var(--ac)}#pv .crumbs i{font-style:normal;color:var(--tx3)}#pv .crumbs b{font-weight:600}
/* Programs */
#pv .val{font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#pv .good,#pv .up{color:var(--good)}#pv .neg{color:var(--bad)}#pv .pend{color:var(--warn)}#pv .mut{color:var(--tx3)}
#pv .meta{display:flex;flex-wrap:wrap;gap:1px 8px;font-size:11px}
#pv .lg{display:flex;align-items:center;min-width:0}
#pv .lg img{height:100%;width:auto;max-width:100%;object-fit:contain;object-position:left center;display:block}
#pv .mono{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;color:var(--tx2);min-width:0}
#pv .mono i{flex:none;font-style:normal;width:26px;height:26px;border-radius:7px;background:var(--ac-soft);color:var(--ac);display:grid;place-items:center;font-weight:600}
#pv .e-tiles{display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fill,minmax(158px,1fr))}
#pv .e-tile{padding:var(--p);display:flex;flex-direction:column;justify-content:space-between;gap:12px;min-width:0}
#pv .e-tile .lg{height:38px}#pv .e-tile .val{font-size:21px;display:block}#pv .e-b{display:grid;gap:3px}
/* Card rows */
#pv .s-head{display:flex;justify-content:space-between;align-items:baseline;gap:6px 14px;flex-wrap:wrap}
#pv .own{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--gap)}
#pv .chip{padding:4px 11px;border:1px solid var(--line)!important;border-radius:99px;font-size:12px;color:var(--tx2)}
#pv .chip.on{background:var(--ac);color:var(--ac-fg);border-color:var(--ac)!important;font-weight:600}
#pv .c-wrap{display:grid;grid-template-columns:34px minmax(0,1fr) 34px;gap:6px;align-items:center}
#pv .arr{height:34px;width:34px;border-radius:50%;border:1px solid var(--line)!important;background:var(--surface)!important;font-size:19px!important;line-height:1}
#pv .c-scroll{display:flex;gap:var(--gap);overflow-x:auto;padding:4px 0 10px;min-width:0;scroll-snap-type:x mandatory;scrollbar-width:none}
#pv .c-item{flex:none;width:var(--whole-w,175px);scroll-snap-align:start}
#pv .c-sp{flex:none;display:block;height:1px}
#pv .c-face{position:relative;aspect-ratio:1000/630;border-radius:calc(var(--c-radius)*.75);overflow:hidden;box-shadow:0 7px 9px -6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
#pv .c-face img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#pv .c-fb{font-size:11.5px;font-weight:600;color:rgba(255,255,255,.9);text-align:center;padding:0 10px}
#pv .c-mask{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.78);color:#fff;font-size:12px;font-weight:700;padding:2px 6px;border-radius:5px;font-variant-numeric:tabular-nums}
#pv .e-cap{display:flex;justify-content:space-between;gap:6px;font-size:11.5px;color:var(--tx3);padding-top:6px;flex-wrap:wrap}#pv .e-cap b{font-weight:600;color:var(--tx)}
/* Challenge grid */
#pv .ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr));gap:var(--gap)}
#pv .ch-card{padding:var(--p);display:grid;grid-template-columns:auto minmax(0,1fr);gap:13px;align-items:center;min-width:0;position:relative}
#pv .ch-t{display:grid;gap:2px;min-width:0}#pv .ch-t b{font-weight:500;font-size:13.5px}
#pv .ch-t>span{font-size:11.5px;color:var(--tx3)}#pv .ch-t>span.ch-bonus{color:var(--ac);font-weight:500}
#pv .ch-card.risk{border-color:color-mix(in srgb,var(--bad) 45%,var(--line))}
#pv .ch-t>span.risk-t{font-size:11px;font-weight:600;color:var(--bad)}
#pv .rings figure{margin:0;display:grid;justify-items:center;gap:3px;width:58px}
#pv .rings figcaption{font-size:10px;color:var(--tx3)}
#pv .ring{width:58px;height:58px;display:block}
#pv .arch{position:absolute;top:7px;right:7px;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:600;color:var(--ac);background:var(--surface);border:1px solid var(--ac)!important;opacity:0;transition:opacity .12s}
#pv .ch-card:hover .arch,#pv .arch:focus-visible{opacity:1}
#pv .ch-add{display:flex;align-items:center;justify-content:center;min-height:96px;border-radius:var(--c-radius);color:var(--ac)!important;border:1.5px dashed color-mix(in srgb,var(--ac) 50%,var(--line))!important}
#pv .ch-add:hover{background:var(--ac-soft)!important}#pv .ch-add span{font-size:30px;line-height:1}
/* Ecosystem */
#pv .pn{padding:calc(var(--p)*1.1)}
#pv .btn-g{font-size:12px!important;font-weight:500;color:var(--ac)!important;padding:5px 10px;border:1px solid var(--line)!important;border-radius:8px;white-space:nowrap}
#pv .btn-g:hover{background:var(--ac-soft)}
#pv .h-split{padding:calc(var(--p)*1.2) calc(var(--p)*1.4);display:flex;align-items:center;gap:calc(var(--gap)*2.4);flex-wrap:wrap}
#pv .h-a{display:grid;gap:6px;max-width:180px}#pv .h-a small{font-size:11px;color:var(--tx3)}
#pv .h-lgo{height:46px;display:flex;align-items:center}#pv .h-lgo .lg{height:100%}
#pv .h-lab{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;color:var(--tx3)}
#pv .h-big{font-size:32px;font-weight:600;line-height:1.05}
#pv .h-sts{display:flex;gap:calc(var(--gap)*1.6);flex-wrap:wrap;flex:1;min-width:0}
#pv .h-st{display:grid;gap:2px}#pv .h-st span{font-size:11px;color:var(--tx3)}#pv .h-st b{font-size:17px;font-weight:600}
#pv .fan{display:flex;align-items:center;margin-left:auto}
#pv .fc{width:70px;aspect-ratio:1000/630;border-radius:6px;overflow:hidden;margin-left:-24px;box-shadow:0 5px 12px -4px rgba(0,0,0,.5);display:grid;place-items:center;flex:none}
#pv .fc:first-child{margin-left:0}#pv .fc img{width:100%;height:100%;object-fit:cover;display:block}
#pv .fc.more{background:#334155;color:#fff;font-size:12px;font-weight:600}
#pv .l-people{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:var(--gap)}
#pv .l-p{background:var(--raised);border-radius:calc(var(--c-radius)*.75);padding:var(--p);min-width:0}
#pv .l-p.tot{background:var(--ac-soft)}
#pv .l-ph{font-size:12.5px}#pv .l-ph b{font-weight:500;color:var(--tx2)}
#pv .l-cur{font-size:25px;font-weight:600;margin:3px 0 9px}
#pv .l-p dl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;font-size:12px;margin:0;font-variant-numeric:tabular-nums}
#pv .l-p dt{color:var(--tx3)}#pv .l-p dd{margin:0;text-align:right}
#pv .leg{font-size:11.5px;color:var(--tx3);margin:12px 0 0}
#pv .l-acts{display:flex;gap:10px 22px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
#pv .l-acts>div{display:flex;gap:8px;align-items:center;font-size:12.5px}#pv .l-acts b{font-weight:500;color:var(--tx2)}
#pv .c-bars{display:grid;gap:11px}
#pv .cb{display:grid;grid-template-columns:minmax(70px,130px) minmax(0,1fr) 62px 36px;gap:10px;align-items:center;font-size:12.5px;font-variant-numeric:tabular-nums}
#pv .cb b{font-weight:500;text-align:right}#pv .cb em{font-style:normal;color:var(--tx3);text-align:right;font-size:11.5px}
#pv .bar{height:6px;border-radius:6px;background:var(--line);overflow:hidden}#pv .bar i{display:block;height:100%;background:var(--ac);border-radius:6px}
#pv .emp{font-size:12.5px;color:var(--tx3);margin:0}
/* Actions: heading */
#pv .act{display:grid}
#pv .ah{display:flex;align-items:baseline;justify-content:space-between;gap:6px 14px;flex-wrap:wrap;margin-bottom:var(--gap)}
#pv .ah h2{margin:0}
#pv .ah-sum{font-size:12.5px;color:var(--tx2)}#pv .ah-sum b{font-weight:600;color:var(--tx)}
#pv .ah-chips{display:flex;gap:6px;flex-wrap:wrap}
#pv .achip{display:inline-block;font-size:12px;color:var(--tx2);padding:3px 10px;border-radius:99px;background:var(--surface);border:1px solid var(--line)}
#pv .achip i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--warn);margin-right:7px;vertical-align:1px}#pv .achip.ch i{background:var(--bad)}
#pv .achip b{font-weight:600;color:var(--tx)}
#pv .act-rail .ah{display:grid;gap:6px}
/* Actions: grid and blocks */
#pv .xblk+.xblk{margin-top:calc(var(--gap)*1.1)}
#pv .xbl{font-size:12px;font-weight:600;color:var(--tx2);margin-bottom:8px}
#pv .xg{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--c-itemW,230px)),1fr));gap:calc(var(--gap)*.75)}
#pv .act-rail .xg{grid-template-columns:minmax(0,1fr)}
/* Actions: item card */
#pv .xc{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;align-items:center;align-content:center;padding:var(--p) calc(var(--p)*.8);min-height:var(--tile-h);text-align:left;cursor:pointer;overflow:hidden;transition:opacity .3s,transform .3s,border-color .15s}
#pv .xcirc{position:relative;width:46px;height:46px;flex:none}
#pv .ring.sm{width:46px;height:46px;display:block}
#pv .xb{display:grid;gap:2px;min-width:0}
#pv .xb b{font-weight:500;font-size:13px;line-height:1.25}
#pv .xb small{font-size:11.5px;color:var(--tx3)}#pv .xb em,#pv .fl-n em{font-style:normal;font-weight:600;color:var(--uc)}
#pv .xcard{font-size:11px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
#pv .xart{display:block;flex:none;width:30px;aspect-ratio:1000/630;border-radius:3px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.3)}
#pv .xart img{width:100%;height:100%;object-fit:cover;display:block}
#pv .xt{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--tx2);min-width:0;padding-bottom:8px;margin-bottom:2px;border-bottom:1px solid var(--line)}
#pv .xt>span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
#pv .th-left{grid-template-columns:auto minmax(0,1fr) auto}
#pv .th-left .xb{order:2}#pv .th-left .xcirc{order:3}
#pv .xart.big{width:60px;border-radius:5px}
#pv .xart.chip{position:absolute;right:-10px;bottom:-5px;width:30px;border-radius:4px;outline:1.5px solid var(--surface);box-shadow:0 2px 5px rgba(15,23,42,.35)}
#pv .th-badge .xcirc{margin-right:6px}
#pv .xo{position:absolute;inset:0;display:grid;place-content:center;background:color-mix(in srgb,var(--surface) 72%,transparent);backdrop-filter:blur(1.5px);opacity:0;transition:opacity .15s;pointer-events:none}
#pv .xo i,#pv .xs-t i{font-style:normal;display:grid;place-items:center;border-radius:50%;color:var(--good);font-weight:700}
#pv .xo i{width:40px;height:40px;border:2.5px solid var(--good);background:var(--surface);font-size:20px;box-shadow:0 4px 12px rgba(15,23,42,.12)}
#pv .k-credit:hover .xo,#pv .k-credit:focus-visible .xo{opacity:1}
#pv .xc.used .xo{opacity:0!important}
#pv .xc.used>:not(.xs){opacity:.18}
#pv .xs{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 calc(var(--p)*.8);background:color-mix(in srgb,var(--good) 9%,var(--surface))}
#pv .xs-t{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--good)}
#pv .xs-t i{width:24px;height:24px;background:var(--good);color:#fff;font-size:13px}
#pv .tm{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--good);transform-origin:left;animation:xtm linear forwards}
@keyframes xtm{from{transform:scaleX(1)}to{transform:scaleX(0)}}
#pv .xc.drop,#pv .fl-r.drop{opacity:0;transform:scale(.94)}
#pv .xc.enter{animation:xin .35s ease-out}
@keyframes xin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
#pv .k-ch:hover,#pv .k-ch:focus-visible{border-color:var(--ac)}
#pv .xgo{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:20px;color:var(--ac);opacity:0;transition:opacity .15s}
#pv .k-ch:hover .xgo,#pv .k-ch:focus-visible .xgo{opacity:1}
#pv .th-left .xgo{display:none}
#pv .xm{border:1.5px dashed color-mix(in srgb,var(--ac) 45%,var(--line))!important;border-radius:var(--c-radius);color:var(--ac)!important;font-size:12.5px;font-weight:600;min-height:var(--tile-h)}
#pv .act-rail .xm{min-height:46px}
#pv .xm:hover{background:var(--ac-soft)!important}
/* Actions: empty state */
#pv .xe{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;font-size:13px;color:var(--tx2)}
#pv .xe h2{margin:0}
#pv .xe-ok{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--good) 14%,transparent);color:var(--good);font-size:11px;font-weight:700;flex:none}
#pv .xe b,#pv .xe1 b{font-weight:600;color:var(--tx)}
#pv .act-rail .xe{align-items:flex-start}
/* Actions: rail and badge */
#pv .railwrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(270px,320px);gap:calc(26px*var(--c-density));align-items:start}
#pv .rw-main{display:grid;gap:calc(26px*var(--c-density));min-width:0}
#pv .rw-side{min-width:0}
#pv .abadge{display:inline-flex;align-items:center;gap:8px;padding:3px 12px 3px 3px;border-radius:99px;border:1px solid var(--line)!important;background:var(--surface)!important;font-size:12.5px;font-weight:500;color:var(--tx2)!important}
#pv .abadge i{font-style:normal;min-width:24px;height:24px;padding:0 7px;border-radius:99px;display:grid;place-items:center;background:var(--uc);color:#fff;font-weight:700;font-size:12px}
#pv .abadge b{color:var(--tx);font-weight:600}
#pv .abadge:hover{border-color:var(--ac)!important}
/* Actions: full list (window, side panel, header panel) */
#pv .mdl-bk{position:absolute;inset:0;background:rgba(15,23,42,.32);z-index:30}
#pv .mdl,#pv .drw,#pv .apanel{z-index:31;background:var(--surface);display:grid;grid-template-rows:auto minmax(0,1fr) auto}
#pv .mdl{position:absolute;left:50%;transform:translateX(-50%);width:min(560px,calc(100% - 24px));max-height:600px;border:1px solid var(--line);border-radius:calc(var(--c-radius)*1.1);box-shadow:0 24px 60px rgba(15,23,42,.28)}
#pv .drw{position:absolute;right:0;width:min(440px,100%);border-left:1px solid var(--line);box-shadow:-12px 0 32px rgba(15,23,42,.18)}
#pv .apanel{position:absolute;right:calc(26px*var(--c-density));width:min(460px,calc(100% - 24px));max-height:560px;border:1px solid var(--line);border-radius:var(--c-radius);box-shadow:0 18px 44px rgba(15,23,42,.22)}
#pv .mh{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 10px;border-bottom:1px solid var(--line)}
#pv .mh h3{margin:0;font-size:15px;font-weight:600}
#pv .ib{width:30px;height:30px;border-radius:8px;color:var(--tx2);font-size:19px}#pv .ib:hover{background:var(--raised)}
#pv .mb{padding:4px 16px 10px;overflow-y:auto;min-height:0}
#pv .mf{display:flex;justify-content:flex-end;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--line)}
#pv .btn{font-size:12.5px;font-weight:500;padding:6px 12px;border-radius:8px;border:1px solid var(--line)!important;color:var(--tx);white-space:nowrap;background:var(--surface)}
#pv .btn.sm{font-size:11.5px;padding:4px 9px}
#pv .btn.pri{background:var(--ac)!important;border-color:var(--ac)!important;color:var(--ac-fg)!important;font-weight:600}
#pv .btn:hover{border-color:var(--ac)!important}
#pv .fl-g{padding:10px 0 6px;border-bottom:1px solid var(--line)}#pv .fl-g:last-of-type{border:0}
#pv .fl-h{display:flex;align-items:center;gap:8px;font-size:12.5px;margin-bottom:2px}
#pv .fl-h b{font-weight:600}#pv .fl-h span{color:var(--tx3)}#pv .fl-h em{font-style:normal;margin-left:auto;color:var(--tx3);font-size:11.5px}
#pv .fl-r{position:relative;display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 0;overflow:hidden;transition:opacity .3s,transform .3s}
#pv .fl-r .ring.sm{width:36px;height:36px}
#pv .fl-n{display:grid;gap:1px;min-width:0;font-size:12.5px}#pv .fl-n b{font-weight:500}#pv .fl-n small{font-size:11.5px;color:var(--tx3)}
#pv .fl-r .xs{padding:0 6px;border-radius:8px}
#pv .fl-r.used>:not(.xs){opacity:.18}
#pv .xe1{margin:12px 0 4px;font-size:13px;color:var(--tx2)}
#pv .toast{position:absolute;left:50%;transform:translateX(-50%);z-index:40;background:#0F172A;color:#fff;font-size:12.5px;font-weight:500;padding:9px 14px;border-radius:9px;box-shadow:0 10px 26px rgba(15,23,42,.3)}
#pv .xc,#pv .fl-r,#pv .abadge,#pv .u-lo{--uc:var(--ac)}#pv .u-hi{--uc:var(--bad)}#pv .u-md{--uc:var(--warn)}#pv .abadge.ok{--uc:var(--good)}
@container pv (max-width:900px){
  #pv .railwrap{grid-template-columns:minmax(0,1fr)}
  #pv .fan{margin-left:0}
}
`
});
})();
