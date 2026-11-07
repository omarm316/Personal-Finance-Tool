// Design gallery spec for the Cards points ledger: the Ecosystem page's balance ledger and Activity,
// checking a balance, adjustments with a reason, challenge bonuses waiting to post, and the
// 2027-01-01 opening balances. Content comes from the data file; this file holds no personal figures.
(function(){
const NAV=['Dashboard','Transactions','Budgets','Daily Balances','Cash Flow','Loans','GCB','Cards','Accounts','Settings'];
const GRAD={Chase:'#1e40af,#0f2a5f',Amex:'#0a2f6b,#2563eb',Citi:'#155e75,#0c4a5e',Marriott:'#78350f,#451a03',Hilton:'#4c1d95,#2e1065',United:'#374151,#111827',Delta:'#1e3a5f,#0f172a',Hyatt:'#7f1d1d,#450a0a',Capital:'#991b1b,#450a0a',Bilt:'#14532d,#052e16',Atmos:'#065f46,#022c22',AA:'#334155,#0f172a'};
const grad=eco=>{const k=Object.keys(GRAD).find(k=>(eco||'').startsWith(k));return k?GRAD[k]:'#374151,#1f2937'};
const f=n=>Math.round(n||0).toLocaleString('en-US');
const sg=v=>(v>0?'+':v<0?'−':'')+f(Math.abs(v)),cl=v=>v>0?'up':v<0?'neg':'mut';
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
const dt=s=>{const[y,m,d]=s.split('-');return `${MON[m-1]} ${Number(d)}`};
const dd=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/864e5);
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'#2563EB','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,#2563EB 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C'});
const JAN1='2027-01-01',NOOWN='No owner';
const REASONS=[['Stay or flight',1,'Points from a hotel stay or a flight'],['Sign-up bonus',1,'A bonus with no challenge in the app'],['Referral',1,'For referring someone'],['Promotion',1,'An offer, a promo or a goodwill credit'],['Points expired',-1,'Points the program took away'],['Balance check',0,'A difference found when checking the balance'],['Other',0,'Anything else; say what in the note']];
const KIND={open:'Opening',earn:'Card earnings',bonus:'Adjustment',red:'Redemption',xout:'Transfer',xin:'Transfer',adj:'Adjustment',check:'Adjustment',p2p:'Between us'};
const RANK={open:0,earn:1,check:3};

/* ---------- Preview state (lives across re-renders) ---------- */
const S={win:null,pw:null,pp:null,pm:null,kf:'',pf:'',posted:{},undo:null,box:null,added:{},openSet:{},ck:{},adj:null,grid:{},toast:'',uid:0};
let LAST=null,TT=0,UT=0;
const esc=s=>LAST.h.esc(s);
const today=p=>p.moment==='jan1'?JAN1:LAST.d.today;
const prog=(p,d)=>d.programs[p.page];

/* ---------- Ledger arithmetic ---------- */
function entries(p,d){const e=prog(p,d);let L;
  if(p.moment==='jan1')L=e.people.filter(x=>S.openSet[e.name+'|'+x]!=null).map(x=>({id:'o-'+x,kind:'open',date:JAN1,person:x,title:'Opening balance',sub:'Entered on opening day',pts:S.openSet[e.name+'|'+x],status:'posted'}));
  else L=e.entries.map(x=>{
    if(x.kind==='open'&&S.openSet[e.name+'|'+x.person]!=null)return {...x,pts:S.openSet[e.name+'|'+x.person],sub:'Edited in the preview'};
    if(x.kind==='bonus'&&S.posted[x.id])return {...x,status:'posted',date:S.posted[x.id].date,pts:S.posted[x.id].pts,postedNow:true};
    return {...x}});
  return L.concat((S.added[e.name]||[]).map(x=>({...x})));}
function sums(L,person){const s={open:0,earn:0,earnPend:0,bonusPend:0,red:0,xout:0,xin:0,out:0,inn:0,adj:{},adjAll:0,cur:0,hasOpen:false};
  L.filter(x=>person==null||x.person===person).forEach(x=>{const v=x.pts||0;
    if(x.kind==='open'){s.open+=v;s.hasOpen=true}
    else if(x.kind==='earn'){s.earn+=v;if(x.status==='pending')s.earnPend+=v}
    else if(x.kind==='bonus'){if(x.status==='pending')s.bonusPend+=v;else{s.adj['Sign-up bonus']=(s.adj['Sign-up bonus']||0)+v;s.adjAll+=v}}
    else if(x.kind==='red')s.red+=v;else if(x.kind==='xout')s.xout+=v;else if(x.kind==='xin')s.xin+=v;
    else if(x.kind==='p2p'){if(v<0)s.out+=v;else s.inn+=v}
    else if(x.kind==='adj'||x.kind==='check'){const r=x.kind==='check'?'Balance check':x.reason||'Other';s.adj[r]=(s.adj[r]||0)+v;s.adjAll+=v}});
  s.cur=s.open+s.earn-s.earnPend+s.red+s.xout+s.xin+s.out+s.inn+s.adjAll;return s;}
const order=(a,b)=>a.date<b.date?-1:a.date>b.date?1:(RANK[a.kind]??2)-(RANK[b.kind]??2);
// Balance before and after each posted entry, for its own person and for the chosen scope.
function runBalances(L,scope){const per={},tot={v:0};
  [...L].filter(x=>x.status!=='pending').sort(order).forEach(x=>{const k=x.person;per[k]=per[k]||0;x.pb=per[k];per[k]+=x.pts||0;x.pa=per[k];
    if(scope==null||x.person===scope){x.sb=tot.v;tot.v+=x.pts||0;x.sa=tot.v}});}
function lastCheck(L,person){const c=L.filter(x=>x.kind==='check'&&x.person===person).sort(order);return c.length?c[c.length-1]:null;}
function checkText(c,t){if(!c)return {cls:'never',short:'Not checked',long:'Not checked yet'};
  const ago=dd(c.date,t),when=`${dt(c.date)}${ago>0?`, ${ago} day${ago===1?'':'s'} ago`:''}`;
  if(!c.pts)return {cls:'ok',short:dt(c.date),long:`Checked ${when}, matched`};
  return {cls:'gap',short:dt(c.date),long:`Checked ${when}, program had ${f(Math.abs(c.pts))} ${c.pts>0?'more':'fewer'}`};}

/* ---------- Page chrome (decided in the Portfolio and Ecosystem galleries) ---------- */
const nav=()=>`<nav class="appnav"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(n=>`<button type="button" class="${n==='Cards'?'on':''}">${n}</button>`).join('')}</div></nav>`;
const period=d=>`<div class="period"><div class="und">${['MTD','QTD','YTD'].map(x=>`<button type="button" class="${x===d.period?'on':''}">${x}</button>`).join('')}</div><select class="yr" aria-label="Year"><option>${d.year}</option><option>${d.year-1}</option></select></div>`;
function header(p,d){const port=p.page==='Portfolio';
  const left=port?`<div class="und big">${['Portfolio','Swipe Advisor','Card Management'].map((t,i)=>`<button type="button" class="${i?'':'on'}">${t}</button>`).join('')}</div>`:`<div class="crumbs"><button type="button">Cards</button><i>›</i><button type="button">Portfolio</button><i>›</i><b>${esc(p.page)}</b></div>`;
  const menu=port&&gridOn(p)&&p.gridOpen==='menu'?`<details class="kb"><summary aria-label="More">⋯</summary><div><button type="button" data-act="grid">Opening balances…</button><button type="button">Export</button></div></details>`:'';
  return `<header class="hdr sf"><div class="hdr-r">${left}<div class="hdr-x">${period(d)}${menu}</div></div></header>`;}
function logo(name,key,h){const s=key?h.img(`logo_${key}_light`):'';return s?`<span class="lg"><img src="${s}" alt="${esc(name)}"></span>`:`<span class="mono"><i>${esc(name[0])}</i><span>${esc(name)}</span></span>`;}
const gridOn=p=>p.openWhere!=='program',progOn=p=>p.openWhere!=='grid';

/* ---------- Portfolio ---------- */
function gridCount(p,d){let n=0,of=0;d.grid.forEach(r=>['Omer','Daniella'].forEach(x=>{if(!r.people[x].card)return;of++;if(S.openSet[r.name+'|'+x]!=null)n++}));return {n,of};}
function portfolio(p,d,h){
  const jan=p.moment==='jan1',gc=gridCount(p,d),all=gc.n>=gc.of;
  const tiles=d.grid.map(r=>{const pr=d.programs[r.name];let bal,pend=0,earned=0,chk=null;
    if(pr){const L=entries({...p,page:r.name},d),s=sums(L);bal=jan&&!pr.people.some(x=>S.openSet[r.name+'|'+x]!=null)?null:s.cur;pend=s.earnPend;
      earned=L.filter(x=>x.kind==='earn'&&x.date>=d.periodStart).reduce((t,x)=>t+x.pts,0);
      const cs=pr.people.map(x=>lastCheck(L,x));chk=cs.every(Boolean)?cs.sort((a,b)=>a.date<b.date?-1:1)[0]:null;}
    else{const o=d.others.find(x=>x.name===r.name)||{};const set=['Omer','Daniella'].filter(x=>S.openSet[r.name+'|'+x]!=null);
      bal=jan?(set.length?set.reduce((t,x)=>t+S.openSet[r.name+'|'+x],0):null):o.balance;pend=jan?0:o.pending||0;earned=jan?0:o.earned||0;}
    const ct=checkText(chk,today(p)),stale=!chk||dd(chk.date,today(p))>60;
    const line=p.tileCheck==='line'&&!jan?`<span class="t-chk ${ct.cls}">${chk?`Checked ${dd(chk.date,today(p))}d ago`:'Not checked'}</span>`:'';
    const dot=p.tileCheck==='dot'&&!jan&&stale?`<i class="t-dot" title="${chk?'Last checked more than 60 days ago':'Balance not checked yet'}" aria-label="${chk?'Last checked more than 60 days ago':'Balance not checked yet'}"></i>`:'';
    return `<div class="e-tile sf">${dot}${logo(r.name,r.logo,h)}<div class="e-b"><b class="val">${bal==null?'—':f(bal)}</b><div class="meta">${bal==null?'<span class="mut">Not set</span>':`<span class="${earned>0?'up':'mut'}">+${f(earned)} ${d.period}</span>${pend>0?`<span class="pend">${f(pend)} pending</span>`:''}`}</div>${line}</div></div>`}).join('');
  const banner=gridOn(p)&&p.gridOpen==='banner'&&jan&&!all?`<div class="ob sf"><div class="ob-t"><b>Start the points ledger</b><span>Enter the balance each program shows today, Jan 1, 2027. From here the app adds card points, bonuses and everything you log.</span></div><span class="ob-n">${gc.n} of ${gc.of} set</span><button type="button" class="btn pri" data-act="grid">Enter balances</button></div>`:'';
  const hbtn=gridOn(p)&&(p.gridOpen==='heading'||(p.gridOpen==='banner'&&(!jan||all)))?`<button type="button" class="btn-g" data-act="grid">Opening balances</button>`:'';
  const inl=S.win&&S.win.t==='grid'&&p.winStyle==='inline'?gridWin(p,d,h):'';
  return `${banner}${p.gridOpen==='banner'?inl:''}<section><div class="s-head"><h2>Rewards programs</h2>${hbtn}</div>${p.gridOpen!=='banner'?inl:''}<div class="e-tiles">${tiles}<div class="e-tile sf"><span class="mono"><i>$</i><span>Cash Back</span></span><div class="e-b"><b class="val good">$${(d.cashBack||0).toFixed(2)}</b><div class="meta"><span class="mut">earned ${d.period}</span></div></div></div></div></section><section><p class="emp sf pn">Your cards and Active challenges sit here as approved; not repeated in this gallery.</p></section>`;}

/* ---------- Ecosystem: header ---------- */
function fan(e,h){const cs=e.cards.filter(c=>c.key).slice(0,3),more=e.cards.length-cs.length;return `<div class="fan">${cs.map(c=>`<span class="fc" style="background:linear-gradient(135deg,${grad(e.name)})"><img src="${h.img('card_'+c.key)}" alt=""></span>`).join('')}${more>0?`<span class="fc more">+${more}</span>`:''}</div>`;}
function hero(p,d,h,L){const e=prog(p,d),jan=p.moment==='jan1',s=sums(L),started=L.some(x=>x.kind==='open');
  const ppl=e.people.map(x=>{const sx=sums(L,x);return `<div class="h-st"><span>${esc(x)}</span><b class="val">${sx.hasOpen||!jan?f(sx.cur):'—'}</b></div>`}).join('');
  const earned=L.filter(x=>x.kind==='earn'&&x.date>=d.periodStart).reduce((t,x)=>t+x.pts,0);
  let pend=`<div class="h-st"><span>Pending</span><b class="val pend">${f(s.earnPend+(p.hdrPend==='both'?s.bonusPend:0))}</b></div>`;
  if(p.hdrPend==='split')pend=`<div class="h-st"><span>Pending from cards</span><b class="val pend">${f(s.earnPend)}</b></div><div class="h-st"><span>Bonus to confirm</span><b class="val pend">${f(s.bonusPend)}</b></div>`;
  return `<section class="h-split sf" data-region="hdr"><div class="h-a"><div class="h-lgo">${logo(e.name,e.logo,h)}</div><small>${e.cards.length} cards linked, ${esc(e.currency)}</small></div><div class="h-b"><small class="h-lab">Current balance, posted</small><div class="val h-big">${jan&&!started?'—':f(s.cur)}</div></div><div class="h-sts">${ppl}${pend}<div class="h-st"><span>Earned ${d.period}</span><b class="val up">+${f(jan?0:earned)}</b></div></div>${fan(e,h)}</section>`;}

/* ---------- Ecosystem: balance ledger ---------- */
function ledgerRows(p,L,people){
  const S0=people.map(x=>sums(L,x)),any=g=>S0.some(s=>Math.abs(g(s))>=.5),bp=p.bonusRow==='pending';
  const base=[['Earned',s=>s.earn+(bp?s.bonusPend:0)],['Pending, not yet posted',s=>-(s.earnPend+(bp?s.bonusPend:0))]];
  let R;
  if(p.adjRows==='groups')R=[['Earned on cards',s=>s.earn],['Pending, not yet posted',s=>-(s.earnPend+(bp?s.bonusPend:0))],['Other points in',s=>s.xin+s.inn+Object.entries(s.adj).filter(([k,v])=>k!=='Balance check'&&v>0).reduce((t,[,v])=>t+v,0)+(bp?s.bonusPend:0)],['Points out',s=>s.red+s.xout+s.out+Object.entries(s.adj).filter(([k,v])=>k!=='Balance check'&&v<0).reduce((t,[,v])=>t+v,0)],['Balance checks',s=>s.adj['Balance check']||0]];
  else{R=[...base,['Redeemed',s=>s.red],['Transferred out',s=>s.xout],['Transferred in',s=>s.xin]];
    if(p.adjRows==='reason')REASONS.forEach(([r])=>R.push([r==='Balance check'?'Balance checks':r,s=>s.adj[r]||0]));
    else R.push(['Adjusted',s=>s.adjAll]);
    R.push(['Sent to other',s=>s.out],['Received from other',s=>s.inn]);}
  return R.filter(r=>any(r[1]));}
function ledger(p,d,h,L){const e=prog(p,d),jan=p.moment==='jan1',T=today(p);
  const owners=[...new Set(L.map(x=>x.person))].filter(x=>!e.people.includes(x)),people=e.people;
  const noOwn=owners.includes(NOOWN)?sums(L,NOOWN):null,rows=ledgerRows(p,L,[...people,...owners]);
  const sel=p.histPerson==='ledger'?S.pf:'';
  const btnCheck=x=>`<button type="button" class="btn-g sm" data-act="check" data-person="${esc(x)}">Check balance</button>`;
  const card=(name,s,tot)=>{const isP=!tot&&people.includes(name),c=isP?lastCheck(L,name):null,ct=checkText(c,T),unset=jan&&!s.hasOpen;
    const dot=isP&&p.checkLine==='dot'&&!unset?`<span class="ck-dot ${ct.cls}" title="${esc(ct.long)}"><i></i>${esc(ct.short)}</span>`:'';
    const line=isP&&p.checkLine==='line'&&!unset?`<div class="ck-line ${ct.cls}">${ct.cls==='ok'?'✓ ':''}${esc(ct.long)}</div>`:'';
    const fig=unset?'—':f(s.cur);
    const figH=isP&&p.checkBtn==='figure'&&!unset?`<button type="button" class="val l-cur l-fig" data-act="check" data-person="${esc(name)}" aria-label="Check ${esc(name)}’s balance" title="Check balance">${fig}<i aria-hidden="true">✎</i></button>`:`<div class="val l-cur">${fig}</div>`;
    const openRow=unset?`<dt>Opening balance</dt><dd class="mut">not set</dd>`:`<dt>Opening balance${p.moment==='jan1'?'':' <small>Sep 1</small>'}</dt><dd class="o-dd">${f(s.open)}${isP&&progOn(p)&&p.openBtn==='row'?`<button type="button" class="o-ed" data-act="open" data-person="${esc(name)}" aria-label="Edit ${esc(name)}’s opening balance">✎</button>`:''}</dd>`;
    const bonus=p.bonusRow==='own'&&s.bonusPend?`<div class="l-bonus"><span>Bonus waiting to post</span><b>${f(s.bonusPend)}</b><small>Not in the balance until you mark it posted</small></div>`:'';
    const unsetBtn=isP&&unset?(progOn(p)?`<button type="button" class="btn pri sm" data-act="open" data-person="${esc(name)}">Set opening balance</button>`:`<button type="button" class="btn-g sm" data-act="go-port">Set on Portfolio</button>`):'';
    const inCard=isP&&!unset&&p.checkBtn==='card'?`<div class="l-cb">${btnCheck(name)}</div>`:'';
    return `<div class="l-p ${tot?'tot':''} ${sel&&sel===name?'sel':''} ${p.histPerson==='ledger'&&isP?'pick':''}" ${p.histPerson==='ledger'&&isP?`data-lp="${esc(name)}" role="button" tabindex="0" aria-pressed="${sel===name}" aria-label="Show ${esc(name)}’s activity"`:''}><div class="l-ph"><b>${esc(name)}</b>${dot}</div>${figH}${line}<dl>${openRow}${unset?'':rows.map(r=>{const v=r[1](s);return `<dt>${r[0]}</dt><dd class="${cl(v)}">${sg(v)}</dd>`}).join('')}</dl>${bonus}${unsetBtn}${inCard}</div>`};
  const tot=card('Total',sums(L),true),P=people.map(x=>card(x,sums(L,x))).join('');
  const noCard=noOwn&&p.noOwner==='card'?`<div class="l-p no"><div class="l-ph"><b>No owner</b></div><div class="val l-cur">${f(noOwn.cur)}</div><dl>${rows.map(r=>{const v=r[1](noOwn);return `<dt>${r[0]}</dt><dd class="${cl(v)}">${sg(v)}</dd>`}).join('')}</dl><p class="no-t">From ${esc(noOwnCards(L))}, which has no owner.</p><button type="button" class="btn-g sm" data-act="owner">Set owner</button></div>`:'';
  const noLine=noOwn&&p.noOwner==='warn'?`<p class="leg warn"><b>${f(noOwn.cur)}</b> points from ${esc(noOwnCards(L))} have no owner, so they count in Total only. <button type="button" class="lnk" data-act="owner">Set the card’s owner</button></p>`:'';
  const below=[];
  if(!jan||people.some(x=>sums(L,x).hasOpen)){
    const ob=x=>`<button type="button" class="btn-g" data-act="open" data-person="${esc(x)}">${sums(L,x).hasOpen?'Edit':'Set'} opening balance</button>`,has=x=>sums(L,x).hasOpen;
    if(p.checkBtn==='below')people.forEach(x=>below.push(`<div><b>${esc(x)}</b>${progOn(p)&&p.openBtn==='below'?ob(x):''}${has(x)?btnCheck(x):''}</div>`));
    else if(progOn(p)&&p.openBtn==='below')people.forEach(x=>below.push(`<div><b>${esc(x)}</b>${ob(x)}</div>`));
    if(!progOn(p))below.push(`<div class="mut">Opening balances are set on Portfolio. <button type="button" class="lnk" data-act="go-port">Open the grid</button></div>`);}
  const headBtns=`${p.checkBtn==='head'&&!(jan&&!L.length)?`<button type="button" class="btn-g" data-act="check" data-person="">Check balances</button>`:''}<button type="button" class="btn-g">+ Transfer between us</button>`;
  const inl=S.win&&p.winStyle==='inline'&&(S.win.t==='check'||S.win.t==='open')?winBody(p,d,h,L):'';
  return `<section data-region="ledger"><div class="s-head"><h2>Balance ledger</h2><span class="s-btns">${headBtns}</span></div>${inl}<div class="sf pn"><div class="l-people">${tot}${P}${noCard}</div>${noLine}${below.length?`<div class="l-acts">${below.join('')}</div>`:''}</div></section>`;}
function noOwnCards(L){return [...new Set(L.filter(x=>x.person===NOOWN&&x.cardName).map(x=>x.cardName))].join(', ');}

/* ---------- Ecosystem: challenges ---------- */
function ring(c){const r=22,C=2*Math.PI*r,l=c.done?'Done':'$'+(c.remaining>=1000?(c.remaining/1000).toFixed(1).replace(/\.0$/,'')+'k':Math.round(c.remaining));
  return `<svg class="ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--ac)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C*Math.min(c.pct,100)/100} ${C}" transform="rotate(-90 27 27)"/><text x="27" y="31" text-anchor="middle" fill="var(--tx)" font-size="${l.length>4?10.5:12}" font-weight="600">${l}</text></svg>`;}
function challenges(p,d,h,L){const e=prog(p,d);if(!e.challenges.length)return '';const showB=p.bonusWhere!=='history'&&p.moment!=='jan1';
  const body=e.challenges.map(c=>{let extra='';
    if(c.pendingBonus&&showB){const x=L.find(y=>y.id===c.pendingBonus);if(x)extra=x.status==='pending'?`<span class="ch-wait">Bonus waiting to post</span>${markCtl(p,x,true)}`:`<span class="ch-ok">✓ Bonus posted ${dt(x.date)}</span>${S.undo&&S.undo.id===x.id?undoCtl(x):''}`;}
    return `<div class="ch-card sf"><div class="rings"><figure>${ring(c)}<figcaption>${c.done?'':'to go'}</figcaption></figure></div><div class="ch-t"><b>${esc(c.name)}</b><span>${esc(c.card)} ${esc(c.mask)}</span><span class="ch-bonus">${esc(c.bonus)}</span>${extra}</div>${c.done?'<button type="button" class="arch">Archive</button>':''}</div>`}).join('');
  return `<section data-region="bonus"><h2>Active challenges <span class="ct">${e.challenges.length}</span></h2><div class="ch-grid">${body}<button type="button" class="ch-add" aria-label="Add a challenge"><span>+</span></button></div></section>`;}
function markCtl(p,x,small){
  if(S.box===x.id)return `<span class="mk-box"><label>Posted on<input type="date" data-mk-date value="${today(p)}"></label><label>Points<input data-mk-pts inputmode="numeric" value="${f(x.pts)}"></label><span class="mk-b"><button type="button" class="btn sm" data-act="mark-cancel">Cancel</button><button type="button" class="btn sm pri" data-act="mark-save" data-id="${x.id}">Save</button></span></span>`;
  return `<button type="button" class="btn ${small?'sm':'sm'} pri mk" data-act="mark" data-id="${x.id}">Mark posted</button>`;}
const undoCtl=x=>`<span class="mk-undo"><button type="button" class="btn sm" data-act="undo" data-id="${x.id}">Undo</button><span class="tm"></span></span>`;

/* ---------- Ecosystem: activity ---------- */
function displayList(p,L){
  let D=L.map(x=>({...x}));
  if(p.cardLines==='none')D=D.filter(x=>x.kind!=='earn');
  else if(p.cardLines==='month'){const G=new Map(),keep=[];
    D.forEach(x=>{if(x.kind!=='earn'||x.status==='pending'){keep.push(x);return}const k=x.cardName+'|'+x.person+'|'+x.date.slice(0,7);
      if(!G.has(k))G.set(k,{...x,id:'m-'+k,pts:0,n:0,cnt:0,date:x.date,last:null});const g=G.get(k);g.pts+=x.pts;g.n+=x.n||0;g.cnt++;if(x.date>g.date)g.date=x.date;if(!g.last||order(x,g.last)>0)g.last=x;});
    G.forEach(g=>{g.lastId=g.last.id;delete g.last;const[y,m]=g.date.split('-');g.date=`${y}-${m}-${String(new Date(Number(y),Number(m),0).getDate()).padStart(2,'0')}`;if(g.date>LAST.d.today)g.date=LAST.d.today;g.sub=`${MONL[Number(m)-1]}, ${g.cnt} statement${g.cnt===1?'':'s'}, ${g.n} charges`;keep.push(g)});D=keep;}
  if(p.pendAt==='hidden')D=D.filter(x=>x.status!=='pending');
  return D;}
function rowText(p,x,T){const k=x.kind;let title=x.title,sub=x.sub||'',tag='';
  if(k==='check'){title='Balance check';sub=x.pts?`Program showed ${f(x.pa)}, the app had ${f(x.pb)}`:`Matched the program, ${f(x.pa)}`;if(x.note)sub+=`. ${x.note}`;if(x.sample)title='Sample: Balance check';}
  if(k==='adj'||(k==='bonus'&&x.status!=='pending'))tag=x.reason||'Other';
  if(k==='bonus'&&x.status==='pending')sub=`${x.sub}. Waiting for you to mark it posted`;
  if(k==='earn'&&x.status==='pending')sub=`${x.sub}. Posts ${dt(x.date)}`;
  if(k==='bonus'&&x.postedNow)sub=`Marked posted ${dt(x.date)}`;
  return {title,sub,tag};}
function ptsCell(x){if(x.kind==='check'&&!x.pts)return '<b class="val mut">±0</b>';if(x.kind==='open')return `<b class="val">${f(x.pts)}</b>`;
  return `<b class="val ${x.status==='pending'?'pend':cl(x.pts)}">${sg(x.pts)}</b>`;}
function actCell(p,x){if(x.status==='pending'&&x.kind==='bonus'&&p.bonusWhere!=='challenge')return markCtl(p,x);
  if(S.undo&&S.undo.id===x.id)return undoCtl(x);
  if(x.status==='pending')return '';return `<span class="ev-a"><button type="button" class="btn-g sm">Edit</button></span>`;}
function activity(p,d,h,L){const e=prog(p,d),T=today(p),jan=p.moment==='jan1';
  const scope=(p.histPerson==='chips'||p.histPerson==='ledger')&&S.pf?S.pf:null;
  // Balances come from the whole ledger, so hiding card lines never changes a figure.
  const full=L.map(x=>({...x}));runBalances(full,scope);const B=new Map(full.map(x=>[x.id,x]));
  const D=displayList(p,L);D.forEach(x=>{const s=B.get(x.lastId||x.id);if(s){x.pb=s.pb;x.pa=s.pa;x.sb=s.sb;x.sa=s.sa}});
  const chips=['',...(p.cardLines!=='none'?['Card earnings']:[]),'Redemption','Transfer','Adjustment','Between us'];
  if(S.kf&&!chips.includes(S.kf))S.kf='';
  const V=D.filter(x=>(!scope||x.person===scope)&&(!S.kf||KIND[x.kind]===S.kf));
  const desc=(a,b)=>-order(a,b);
  const pend=V.filter(x=>x.status==='pending'),post=V.filter(x=>x.status!=='pending');
  let top=[],rest;
  if(p.pendAt==='top'){top=[...pend].sort(order);rest=post.sort(desc)}else rest=V.sort(desc);
  const showP=!scope;
  const red=L.filter(x=>x.kind==='red'),rp=-red.reduce((t,x)=>t+x.pts,0),rc=red.reduce((t,x)=>t+(parseFloat((x.sub||'').replace(/[^0-9.]/g,''))||0),0);
  const stats=rp?`<div class="r-st"><div><span>Points redeemed</span><b class="val">${f(rp)}</b></div><div><span>Cash value realized</span><b class="val">$${rc.toFixed(2)}</b></div><div><span>Realized ¢ per point</span><b class="val">${(rc/rp*100).toFixed(2)}¢</b></div></div>`:'';
  const chipH=`<div class="a-chips"><span class="cg">${chips.map(c=>`<button type="button" class="chip ${S.kf===c?'on':''}" data-kf="${c}">${c||'All'}</button>`).join('')}</span>${p.histPerson==='chips'&&e.people.length>1?`<span class="cg pg">${['',...e.people].map(x=>`<button type="button" class="chip ${S.pf===x?'on':''}" data-pf="${esc(x)}">${x?esc(x):'Everyone'}</button>`).join('')}</span>`:''}</div>`;
  const ledgerNote=p.histPerson==='ledger'?`<p class="a-note">${scope?`Showing ${esc(scope)}’s activity. <button type="button" class="lnk" data-pf="">Show everyone</button>`:'Click a person’s ledger card to see only their activity.'}</p>`:'';
  const balTxt=x=>p.runBal&&x.status!=='pending'&&x.sa!=null?`<small class="rb">${f(x.sa)}</small>`:'';
  const who=x=>showP&&x.person?`<span class="who ${x.person===NOOWN?'no':''}">${esc(x.person)}</span>`:'';
  const evRow=x=>{const t=rowText(p,x,T);return `<div class="a-row ${x.status==='pending'?'is-pend':''}" data-k="${KIND[x.kind]}"><span class="ev-k">${x.status==='pending'?'Pending':KIND[x.kind]}</span><div class="ev"><div class="ev-t"><b>${esc(t.title)}${t.tag?` <em class="rs">${esc(t.tag)}</em>`:''}</b><span>${x.status==='pending'?'':dt(x.date)+' · '}${esc(t.sub)}${showP&&x.person?` · ${esc(x.person)}`:''}</span></div><div class="ev-v">${ptsCell(x)}${balTxt(x)}</div>${actCell(p,x)}</div></div>`};
  const regRow=x=>{const t=rowText(p,x,T);return `<tr class="${x.status==='pending'?'is-pend':''}"><td class="d">${x.status==='pending'?'<span class="pt">Pending</span>':dt(x.date)}</td><td class="en"><b>${esc(t.title)}</b>${t.tag?`<em class="rs">${esc(t.tag)}</em>`:''}<small>${esc(t.sub)}</small></td>${showP?`<td>${who(x)}</td>`:''}<td class="n">${ptsCell(x)}</td>${p.runBal?`<td class="n bal">${x.status==='pending'||x.sa==null?'':f(x.sa)}</td>`:''}<td class="ac">${actCell(p,x)}</td></tr>`};
  let body='';
  if(!L.length)body=`<p class="emp">${jan?'Nothing yet. The ledger starts once the opening balance is set.':'No activity yet.'}</p>`;
  else if(p.histForm==='register'){const head=`<thead><tr><th>Date</th><th>Entry</th>${showP?'<th>Person</th>':''}<th class="n">Points</th>${p.runBal?`<th class="n">Balance${scope?'':', total'}</th>`:''}<th></th></tr></thead>`;
    body=`<div class="rg-w"><table class="rg">${head}<tbody>${top.length?top.map(regRow).join('')+`<tr class="rg-sep"><td colspan="6"></td></tr>`:''}${rest.map(regRow).join('')}</tbody></table></div>`;}
  else if(p.histForm==='months'){const M=new Map();rest.forEach(x=>{const k=x.date.slice(0,7);if(!M.has(k))M.set(k,[]);M.get(k).push(x)});
    const inScope=x=>x.status!=='pending'&&(!scope||x.person===scope);
    body=(top.length?`<div class="mo"><div class="mo-h"><b>Waiting to post</b><span>${f(top.reduce((t,x)=>t+x.pts,0))} points</span></div>${top.map(evRow).join('')}</div>`:'')+[...M].map(([k,xs])=>{const[y,m]=k.split('-'),net=full.filter(x=>inScope(x)&&x.kind!=='open'&&x.date.slice(0,7)===k).reduce((t,x)=>t+(x.pts||0),0);
      const close=full.filter(x=>inScope(x)&&x.date.slice(0,7)<=k).reduce((t,x)=>t+(x.pts||0),0);
      return `<div class="mo"><div class="mo-h"><b>${MONL[m-1]} ${y}</b><span class="${cl(net)}">${sg(net)}</span><span>${Number(k.slice(0,4))*12+Number(m)>=Number(T.slice(0,4))*12+Number(T.slice(5,7))?'Balance so far':'Closing balance'} <b class="val">${f(close)}</b></span></div>${xs.map(evRow).join('')}</div>`}).join('');}
  else body=`${top.length?`<div class="a-feed top">${top.map(evRow).join('')}</div>`:''}<div class="a-feed">${rest.map(evRow).join('')}</div>`;
  const inl=S.win&&S.win.t==='adjust'&&p.winStyle==='inline'?winBody(p,d,h,L):'';
  return `<section data-region="history"><div class="s-head"><h2>Activity</h2><span class="s-btns"><button type="button" class="btn-g sm">+ Redemption</button><button type="button" class="btn-g sm">+ Transfer</button><button type="button" class="btn-g sm" data-act="adjust">+ Adjustment</button><button type="button" class="btn-g sm">+ Between us</button></span></div>${inl}<div class="sf pn">${stats}${chipH}${ledgerNote}${body}</div></section>`;}

/* ---------- Windows ---------- */
function shell(p,title,inner,foot){const cls=p.winStyle==='drawer'?'drw':p.winStyle==='inline'?'inl sf':'mdl';
  return `<div class="${cls}" role="dialog" aria-label="${esc(title)}"><div class="mh"><h3>${esc(title)}</h3><button type="button" class="ib" data-act="close" aria-label="Close">×</button></div><div class="mb">${inner}</div><div class="mf">${foot}</div></div>`;}
function gapHtml(p,app,v){if(v===''||v==null||isNaN(v))return `<span class="mut">Type the balance the program shows.</span>`;
  const g=Math.round(v-app);
  if(p.gapShow==='figures')return `<span class="g3"><span><small>App</small><b>${f(app)}</b></span><span><small>Program</small><b>${f(v)}</b></span><span><small>Difference</small><b class="${cl(g)}">${g?sg(g):'±0'}</b></span></span>`;
  if(p.gapShow==='after')return g?`<span>Balance <b>${f(app)}</b> → <b>${f(v)}</b> <b class="${cl(g)}">(${sg(g)})</b></span>`:`<span>Balance stays <b>${f(app)}</b>. Matches.</span>`;
  return g?`<span>The program has <b class="${cl(g)}">${f(Math.abs(g))} ${g>0?'more':'fewer'}</b>. Saving logs <b>${sg(g)}</b> as a balance check.</span>`:`<span class="good">Matches. Saving records the check with no change.</span>`;}
const reasonOpts=(sel,only)=>REASONS.filter(r=>!only||only(r)).map(([r])=>`<option ${r===sel?'selected':''}>${r}</option>`).join('');
function checkWin(p,d,h,L){const e=prog(p,d),who=S.win.person?[S.win.person]:e.people,T=today(p);
  const inner=who.map(x=>{const s=sums(L,x),v=S.ck[x];
    const reason=p.gapReason==='pick'?`<label class="fld">Log the difference as<select data-ckr="${esc(x)}">${reasonOpts('Balance check')}</select></label>`:
      p.gapReason==='split'?`<div class="split"><span class="fl-l">Explain part of it (optional)</span><div class="sp-r"><select aria-label="Reason">${reasonOpts('Stay or flight',r=>r[0]!=='Balance check')}</select><input aria-label="Points" inputmode="numeric" placeholder="Points"></div><button type="button" class="lnk">+ Add a part</button><small class="mut">Whatever is left is logged as a balance check.</small></div>`:'';
    return `<div class="ck"><div class="ck-h"><b>${esc(x)}</b><span>The app has <b>${f(s.cur)}</b> posted${s.earnPend?`; ${f(s.earnPend)} pending isn’t included`:''}.</span></div><label class="fld">The program shows<input class="big-in" data-ck="${esc(x)}" data-app="${s.cur}" inputmode="numeric" autocomplete="off" value="${v!=null?esc(v):''}" placeholder="As the program shows it"></label><div class="ck-gap" data-ckgap="${esc(x)}">${gapHtml(p,s.cur,v===''||v==null?null:Number(String(v).replace(/[,\s]/g,'')))}</div>${reason}</div>`}).join('');
  const meta=`<div class="frow"><label class="fld">Checked on<input type="date" value="${T}"></label><label class="fld grow">Note (optional)<input placeholder="Where you looked, anything odd"></label></div><p class="hint">Programs show posted points only, so the app compares its posted figure.</p>`;
  return shell(p,`Check ${e.name} balance${who.length===1?` · ${who[0]}`:''}`,inner+meta,`<button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn pri" data-act="save-check">Save</button>`);}
function adjWin(p,d,h){const e=prog(p,d),A=S.adj,T=today(p),R=REASONS.find(r=>r[0]===A.reason)||REASONS[0];
  const ppl=e.people.length>1?`<div class="fld"><span class="fl-l">Whose points</span><div class="seg">${e.people.map(x=>`<button type="button" class="${A.person===x?'on':''}" data-adj-person="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`:'';
  let rs;
  if(p.reasonPick==='chips')rs=`<div class="fld"><span class="fl-l">Reason</span><div class="rchips">${REASONS.map(([r])=>`<button type="button" class="chip ${A.reason===r?'on':''}" data-adj-reason="${r}">${r}</button>`).join('')}</div></div>`;
  else if(p.reasonPick==='list')rs=`<div class="fld"><span class="fl-l">Reason</span><div class="rlist">${REASONS.map(([r,,t])=>`<label class="${A.reason===r?'on':''}"><input type="radio" name="adj-r" ${A.reason===r?'checked':''} data-adj-reason="${r}"><b>${r}</b><small>${t}</small></label>`).join('')}</div></div>`;
  else rs=`<label class="fld">Reason<select data-adj-rsel>${reasonOpts(A.reason)}</select></label>`;
  const sign=A.sign;let pts;
  if(p.sign==='signed')pts=`<label class="fld">Points<input class="big-in" data-adj-pts inputmode="numeric" value="${esc(A.raw||'')}" placeholder="5000 or −2100"></label>`;
  else if(p.sign==='buttons')pts=`<div class="fld"><span class="fl-l">Points</span><div class="seg"><button type="button" class="${sign>0?'on':''}" data-adj-sign="1">Add points</button><button type="button" class="${sign<0?'on':''}" data-adj-sign="-1">Remove points</button></div><input class="big-in" data-adj-pts inputmode="numeric" value="${esc(A.raw||'')}" placeholder="Points" aria-label="Points"></div>`;
  else pts=`<div class="fld"><span class="fl-l">Points</span><div class="pm"><button type="button" class="pm-s ${sign>0?'pos':'neg'}" data-adj-flip aria-label="${sign>0?'Adding points, click to remove instead':'Removing points, click to add instead'}">${sign>0?'+':'−'}</button><input class="big-in" data-adj-pts inputmode="numeric" value="${esc(A.raw||'')}" placeholder="Points" aria-label="Points"></div><small class="mut">${R[1]===0?'Pick + or − for this reason.':`${A.reason} ${R[1]>0?'adds':'removes'} points; flip the sign if needed.`}</small></div>`;
  const inner=`${ppl}${rs}${pts}<div class="frow"><label class="fld">Date<input type="date" value="${T}"></label><label class="fld grow">Note (optional)<input data-adj-note value="${esc(A.note||'')}" placeholder="${A.reason==='Stay or flight'?'Hotel, nights, booking':'Anything worth remembering'}"></label></div>`;
  return shell(p,`Add adjustment · ${e.name}`,inner,`<button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn pri" data-act="save-adj">Save</button>`);}
function openWin(p,d,h,L){const e=prog(p,d),x=S.win.person||e.people[0],k=e.name+'|'+x,cur=S.openSet[k]!=null?S.openSet[k]:(L.find(y=>y.kind==='open'&&y.person===x)||{}).pts;
  const inner=`<label class="fld">${esc(x)}’s balance on Jan 1, 2027<input class="big-in" data-open-v inputmode="numeric" autocomplete="off" value="${cur!=null?f(cur):''}" placeholder="As the program shows it"></label><p class="hint">The posted balance the program shows on Jan 1. Card points, bonuses and everything you log are added from there.</p>`;
  return shell(p,`Opening balance · ${e.name}`,inner,`<button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn pri" data-act="save-open" data-person="${esc(x)}">Save</button>`);}
function gridWin(p,d,h){const ppl=['Omer','Daniella'];
  const cell=(r,x)=>{const P=r.people[x],k=r.name+'|'+x,v=S.grid[k]!=null?S.grid[k]:S.openSet[k]!=null?f(S.openSet[k]):'';
    const hint=p.gridHint==='app'&&P.app!=null?`<small>app ${f(P.app)}</small>`:p.gridHint==='last'&&P.last?`<small>checked ${f(P.last.bal)}, ${dt(P.last.date)}</small>`:'';
    return `<td class="${P.card?'':'nc'}"><input class="sc" data-g="grid" data-k="${esc(k)}" data-row="${esc(r.name)}" value="${esc(v)}" placeholder="${P.card?'–':'no card'}" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="${esc(r.name)}, ${x}">${hint}</td>`};
  const rows=d.grid.map(r=>`<tr><th>${logo(r.name,r.logo,h)}<span class="gn">${esc(r.name)}</span>${p.gridHint==='last'&&r.noPerson?`<small>checked ${f(r.noPerson.bal)}, ${dt(r.noPerson.date)}, no person</small>`:''}</th>${ppl.map(x=>cell(r,x)).join('')}</tr>`).join('');
  const gc=gridCount(p,d);
  const inner=`<p class="hint">The posted balance each program shows on Jan 1, 2027. Tab moves right, then to the next row; Enter moves down; you can paste a block copied from Excel. Leave a cell blank if that person has no account.</p><table class="og"><thead><tr><th>Program</th>${ppl.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  return shell(p,'Opening balances · Jan 1, 2027',inner,`<span class="mf-l" data-gcount>${gc.n} of ${gc.of} set</span><button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn pri" data-act="save-grid">Save</button>`);}
function winBody(p,d,h,L){if(!S.win)return '';const t=S.win.t;
  if(t==='grid')return gridWin(p,d,h);if(p.page==='Portfolio')return '';
  if(t==='check')return checkWin(p,d,h,L);if(t==='adjust')return adjWin(p,d,h);if(t==='open')return openWin(p,d,h,L);return '';}
function windowLayer(p,d,h,L){if(!S.win||p.winStyle==='inline')return '';const b=winBody(p,d,h,L);return b?`<div class="mdl-bk"></div>${b}`:'';}

/* ---------- Opening a window from the "What to preview" control ---------- */
function syncPicks(p,d){
  if(S.pp!==p.page||S.pm!==p.moment){S.kf='';S.pf='';S.box=null;S.undo=null;S.ck={};}
  if(S.pw!==p.win||S.pp!==p.page||S.pm!==p.moment){const e=d.programs[p.page];
    S.win=null;
    if(p.win==='opening'){if(!e){if(gridOn(p))S.win={t:'grid'}}else if(progOn(p))S.win={t:'open',person:e.people[0]}}
    if(e&&p.win==='check')S.win={t:'check',person:p.checkBtn==='head'?'':e.people[0]};
    if(e&&p.win==='adjust')S.win={t:'adjust'};
    if(S.win&&S.win.t==='check'&&e&&p.moment!=='jan1'){const L=entries(p,d);const pp=S.win.person||e.people[0];S.ck={[pp]:f(sums(L,pp).cur+212)};}
    if(S.win&&S.win.t==='adjust')S.adj=newAdj(p,d);}
  S.pw=p.win;S.pp=p.page;S.pm=p.moment;}
function newAdj(p,d){const e=prog(p,d);return {person:e?e.people[0]:'Omer',reason:'Stay or flight',sign:1,raw:'',note:''};}

Gallery.define({
  id:'cards-ledger-r1',
  name:'Cards: Points ledger and adjustments, round 1',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap'],
  groups:[
   {id:'see',label:'What to preview (not design choices)',open:true,controls:[
    {id:'page',label:'Page',type:'choice',options:[
      {id:'Amex MR',label:'Ecosystem: Amex MR',hint:'Both of you, a sample sign-up bonus waiting to post, a transfer out, a referral and a check with a gap.'},
      {id:'Chase UR',label:'Ecosystem: Chase UR',hint:'Five statements still pending, a transfer between you and a redemption.'},
      {id:'Hilton Honors',label:'Ecosystem: Hilton Honors',hint:'A hotel program: points from a stay, a transfer in from Amex and an award stay.'},
      {id:'Marriott Bonvoy',label:'Ecosystem: Marriott Bonvoy',hint:'Daniella checked and matched; Omer has expired points and no check yet.'},
      {id:'Citi ThankYou',label:'Ecosystem: Citi ThankYou',hint:'Real gap: Strata Premier has no owner, so its points belong to no one.'},
      {id:'Portfolio',label:'Portfolio',hint:'Program tiles and where the opening-balance grid starts.'},
    ]},
    {id:'moment',label:'Moment',type:'choice',options:[
      {id:'running',label:'Nov 7, the ledger running',hint:'The preview opens the ledger on Sep 1, 2026 so it can use real card points; the app opens it on Jan 1, 2027. Opening balances are stand-ins. Redemptions, transfers, adjustments, checks and the bonus are labeled samples.'},
      {id:'jan1',label:'Jan 1, 2027, opening day',hint:'No opening balances yet. Set some to see the ledger start.'},
    ]},
    {id:'win',label:'Open in the preview',type:'choice',options:[
      {id:'none',label:'Nothing',hint:'The buttons on the page open these too.'},
      {id:'check',label:'Check balance'},
      {id:'adjust',label:'Add adjustment'},
      {id:'opening',label:'Opening balance',hint:'The grid on Portfolio, or one program’s window, by your pick under Opening balances.'},
    ]},
   ]},
   {id:'ledger',label:'Balance ledger',open:true,controls:[
    {id:'adjRows',label:'Rows on each card',type:'choice',options:[
      {id:'one',label:'One Adjusted row',current:true,hint:'Today’s rows: earned, pending, redeemed, transfers, adjusted, between you.'},
      {id:'reason',label:'A row per reason',hint:'Stay or flight, Sign-up bonus, Referral, Promotion, Points expired, Balance checks, Other; empty ones hidden.'},
      {id:'groups',label:'Four groups',hint:'Earned on cards, Other points in, Points out, Balance checks.'},
    ]},
    {id:'bonusRow',label:'A bonus waiting to post, on the card',type:'choice',options:[
      {id:'own',label:'Its own line, not in the balance'},
      {id:'pending',label:'Inside Earned and Pending',hint:'Counted like card points that haven’t posted.'},
      {id:'none',label:'Not on the ledger card'},
    ]},
    {id:'checkLine',label:'Last balance check',type:'choice',options:[
      {id:'off',label:'Not shown',current:true},
      {id:'line',label:'A line under the balance',hint:'“Checked Oct 31, 7 days ago, matched”. Amber when it found a gap.'},
      {id:'dot',label:'Dot and date by the name',hint:'Green matched, amber gap, grey never. Hover for the sentence.'},
    ]},
    {id:'checkBtn',label:'Where Check balance starts',type:'choice',options:[
      {id:'below',label:'Buttons below the cards',current:true,hint:'Where today’s “+ Add Correction” sits.'},
      {id:'card',label:'Inside each person’s card'},
      {id:'head',label:'One button in the heading',hint:'One window for both of you.'},
      {id:'figure',label:'Click the balance itself',hint:'The figure shows ✎ on hover.'},
    ]},
    {id:'openBtn',label:'Editing an opening balance later',type:'choice',options:[
      {id:'below',label:'Button below the cards',current:true},
      {id:'row',label:'✎ on the Opening balance row'},
    ]},
    {id:'noOwner',label:'Points from a card with no owner',type:'choice',options:[
      {id:'warn',label:'A warning line under the cards',current:true,hint:'With a link to set the owner. Counted in Total only.'},
      {id:'card',label:'Its own “No owner” card'},
    ]},
   ]},
   {id:'hdr',label:'Header strip',open:false,controls:[
    {id:'hdrPend',label:'Pending figure',type:'choice',options:[
      {id:'cards',label:'Card points only',current:true},
      {id:'both',label:'Card points and bonuses waiting'},
      {id:'split',label:'Two figures',hint:'Pending from cards, and Bonus to confirm.'},
    ]},
   ]},
   {id:'history',label:'Activity',open:true,controls:[
    {id:'histForm',label:'Layout',type:'choice',options:[
      {id:'timeline',label:'Timeline',current:true,hint:'The approved Activity list.'},
      {id:'register',label:'Register table',hint:'Date, entry, person, points, balance, like a bank register.'},
      {id:'months',label:'By month',hint:'Each month with its change and closing balance.'},
    ]},
    {id:'cardLines',label:'Card points in Activity',type:'choice',options:[
      {id:'none',label:'Not listed',current:true,hint:'Only the Earned row on the ledger card.'},
      {id:'statement',label:'One line per statement',hint:'How programs post them. Cards with no close day get a line per month.'},
      {id:'month',label:'One line per card per month'},
    ]},
    {id:'pendAt',label:'Pending lines',type:'choice',options:[
      {id:'top',label:'At the top, soonest first'},
      {id:'inline',label:'In date order'},
      {id:'hidden',label:'Not listed',hint:'The bonus then can only be marked posted from its challenge.'},
    ]},
    {id:'histPerson',label:'Whose activity',type:'choice',options:[
      {id:'tag',label:'Everyone, named on each row',current:true},
      {id:'chips',label:'Person chips',hint:'Everyone, Omer, Daniella beside the type chips.'},
      {id:'ledger',label:'Click a ledger card',hint:'The card you click filters the list.'},
    ]},
    {id:'runBal',label:'Balance after each line',type:'toggle',default:false},
   ]},
   {id:'check',label:'Check balance window',open:true,controls:[
    {id:'gapShow',label:'How the difference reads',type:'choice',options:[
      {id:'sentence',label:'A sentence',hint:'“The program has 212 more. Saving logs +212 as a balance check.”'},
      {id:'figures',label:'Three figures',hint:'App, Program, Difference.'},
      {id:'after',label:'Before and after',hint:'“Balance 81,688 → 81,900 (+212)”.'},
    ]},
    {id:'gapReason',label:'What the difference is logged as',type:'choice',options:[
      {id:'fixed',label:'Always a balance check'},
      {id:'pick',label:'Pick a reason, Balance check first'},
      {id:'split',label:'Explain part, the rest is a balance check'},
    ]},
   ]},
   {id:'adjust',label:'Adjustment window',open:true,controls:[
    {id:'reasonPick',label:'Choosing the reason',type:'choice',options:[
      {id:'select',label:'Dropdown'},
      {id:'chips',label:'Chips'},
      {id:'list',label:'List with a line each'},
    ]},
    {id:'sign',label:'Adding or removing points',type:'choice',options:[
      {id:'signed',label:'Type a signed number',current:true,hint:'Today’s form: −2100 removes.'},
      {id:'auto',label:'Sign follows the reason',hint:'Expired is −, the rest +; a +/− button flips it.'},
      {id:'buttons',label:'Add points or Remove points'},
    ]},
   ]},
   {id:'windows',label:'Windows',open:false,controls:[
    {id:'winStyle',label:'Check balance, adjustment and opening balances open in',type:'choice',options:[
      {id:'modal',label:'A window in the middle',current:true},
      {id:'drawer',label:'A side panel',hint:'Like benefit editing on the Card page.'},
      {id:'inline',label:'Under the section, in the page'},
    ]},
   ]},
   {id:'bonus',label:'Challenge bonuses',open:true,controls:[
    {id:'bonusWhere',label:'Where you mark a bonus posted',type:'choice',options:[
      {id:'history',label:'Its pending line in Activity'},
      {id:'challenge',label:'On the challenge card'},
      {id:'both',label:'Both'},
    ]},
    {id:'markFlow',label:'Marking it posted',type:'choice',options:[
      {id:'undo',label:'One click, Undo for 5 seconds',hint:'Posted today, like marking a credit used.'},
      {id:'box',label:'A small box with the date and points',hint:'For a bonus that posted on another day or for a different amount.'},
      {id:'now',label:'One click, fix the date later with Edit'},
    ]},
   ]},
   {id:'opening',label:'Opening balances, Jan 1, 2027',open:true,controls:[
    {id:'openWhere',label:'Where you enter them',type:'choice',options:[
      {id:'program',label:'On each program’s ledger',current:true},
      {id:'grid',label:'One grid of every program',hint:'Opened from Portfolio; edits like a spreadsheet.'},
      {id:'both',label:'Both'},
    ]},
    {id:'gridOpen',label:'Opening the grid',type:'choice',options:[
      {id:'banner',label:'Banner on Portfolio until all are set',hint:'Afterwards an Opening balances button in the programs heading.'},
      {id:'heading',label:'Button in the programs heading'},
      {id:'menu',label:'In a ⋯ menu in the header bar'},
    ]},
    {id:'gridHint',label:'Beside each grid cell',type:'choice',options:[
      {id:'blank',label:'Nothing'},
      {id:'app',label:'The app’s own figure today'},
      {id:'last',label:'The last checked figure, where one exists'},
    ]},
   ]},
   {id:'tiles',label:'Portfolio program tiles',open:false,controls:[
    {id:'tileCheck',label:'Balance check on the tile',type:'choice',options:[
      {id:'none',label:'Not shown',current:true},
      {id:'line',label:'“Checked 7d ago” line'},
      {id:'dot',label:'Amber dot when not checked in 60 days'},
    ]},
   ]},
   {id:'settled',label:'Settled in chat, 2026-11-07',open:false,controls:[
    {id:'anchor',label:'Balance check',type:'choice',locked:true,options:[{id:'gap',label:'One anchor on Jan 1, 2027; each check logs the gap as an adjustment'}]},
    {id:'other',label:'Points from outside card spend',type:'choice',locked:true,options:[{id:'reason',label:'An adjustment with a reason from a fixed list'}]},
    {id:'bonusModel',label:'Challenge bonuses',type:'choice',locked:true,options:[{id:'pending',label:'Added as pending when the challenge is met; you mark them posted'}]},
   ]},
   {id:'decided',label:'Decided in the Cards galleries',open:false,controls:[
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'current',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
    {id:'ledgerStyle',label:'Ledger format',type:'choice',locked:true,options:[{id:'people',label:'A card per person, Total first, all-zero rows hidden'}]},
    {id:'actFilters',label:'Activity',type:'choice',locked:true,options:[{id:'chips',label:'Filter chips, one add button per type in the heading, realized value from real redemptions only'}]},
    {id:'windows2',label:'Windows and panels',type:'choice',locked:true,options:[{id:'buttons',label:'Close only with their buttons'}]},
    {id:'noCpp',label:'Dollar value of points',type:'choice',locked:true,options:[{id:'never',label:'Never an assumed value per point'}]},
   ]},
  ],
  render(p,d,h){LAST={d,h,p};syncPicks(p,d);
    let body,L=[];
    if(p.page==='Portfolio')body=portfolio(p,d,h);
    else{L=entries(p,d);body=hero(p,d,h,L)+`<p class="emp sf pn slim">Actions strip and Points by category sit here as approved; not repeated in this gallery.</p>`+ledger(p,d,h,L)+challenges(p,d,h,L)+activity(p,d,h,L);}
    const layer=p.page==='Portfolio'?(S.win&&S.win.t==='grid'&&p.winStyle!=='inline'?`<div class="mdl-bk"></div>${gridWin(p,d,h)}`:''):windowLayer(p,d,h,L);
    return `<div class="app">${nav()}<div class="main">${header(p,d)}${body}</div>${layer}${S.toast?`<div class="toast" role="status">${esc(S.toast)}</div>`:''}</div>`;
  },
  after(root,p){
    const app=root.querySelector('.app');if(!app)return;const d=LAST.d,stage=document.getElementById('stage');
    const rr=()=>{const top=stage?stage.scrollTop:0;root.innerHTML=Gallery.spec.render(p,LAST.d,LAST.h);Gallery.spec.after(root,p);if(stage)stage.scrollTop=top};
    const toast=t=>{S.toast=t;rr()};
    const st=stage?stage.scrollTop:0,sh=stage?stage.clientHeight:800;
    const m=app.querySelector('.mdl');if(m)m.style.top=(st+40)+'px';
    const dr=app.querySelector('.drw');if(dr){dr.style.top=st+'px';dr.style.height=sh+'px'}
    const t=app.querySelector('.toast');if(t)t.style.top=(st+sh-70)+'px';
    clearTimeout(TT);if(S.toast)TT=setTimeout(()=>{S.toast='';rr()},2600);
    const e=d.programs[p.page];
    const num=v=>{const n=Number(String(v).replace(/[,\s]/g,'').replace('−','-'));return isFinite(n)?n:NaN};
    const addEntry=x=>{(S.added[e.name]=S.added[e.name]||[]).push({id:'a'+(++S.uid),status:'posted',...x})};
    app.addEventListener('click',ev=>{
      const b=ev.target.closest('[data-act],[data-kf],[data-pf],[data-lp],[data-adj-person],[data-adj-reason],[data-adj-sign],[data-adj-flip]');if(!b)return;
      if(b.dataset.kf!=null){S.kf=b.dataset.kf;return rr()}
      if(b.dataset.pf!=null){S.pf=b.dataset.pf;return rr()}
      if(b.dataset.lp!=null){S.pf=S.pf===b.dataset.lp?'':b.dataset.lp;return rr()}
      if(b.dataset.adjPerson!=null){S.adj.person=b.dataset.adjPerson;return rr()}
      if(b.dataset.adjReason!=null){S.adj.reason=b.dataset.adjReason;const R=REASONS.find(r=>r[0]===S.adj.reason);if(R&&R[1])S.adj.sign=R[1];return rr()}
      if(b.dataset.adjSign!=null){S.adj.sign=Number(b.dataset.adjSign);return rr()}
      if(b.dataset.adjFlip!=null){S.adj.sign=-S.adj.sign;return rr()}
      const a=b.dataset.act,L=e?entries(p,d):[];
      if(a==='close'){S.win=null;return rr()}
      if(a==='check'){S.win={t:'check',person:b.dataset.person||''};S.ck={};return rr()}
      if(a==='adjust'){S.win={t:'adjust'};S.adj=newAdj(p,d);return rr()}
      if(a==='open'){S.win={t:'open',person:b.dataset.person};return rr()}
      if(a==='grid'){S.win={t:'grid'};S.grid={};return rr()}
      if(a==='go-port')return toast('Opens Portfolio, where the opening-balance grid lives.');
      if(a==='owner')return toast('Opens the card’s details to set whose card it is.');
      if(a==='save-check'){let n=0,msg=[];
        Object.entries(S.ck).forEach(([x,v])=>{if(v===''||v==null)return;const val=num(v);if(isNaN(val))return;const g=Math.round(val-sums(L,x).cur);
          const rsel=app.querySelector(`[data-ckr="${CSS.escape(x)}"]`),reason=rsel?rsel.value:'Balance check';
          if(reason==='Balance check')addEntry({kind:'check',date:today(p),person:x,reason,title:'Balance check',sub:'',pts:g});
          else{addEntry({kind:'adj',date:today(p),person:x,reason,title:reason,sub:'Found while checking the balance',pts:g});addEntry({kind:'check',date:today(p),person:x,reason:'Balance check',title:'Balance check',sub:'',pts:0})}
          n++;msg.push(`${x} ${g?sg(g):'matched'}`)});
        S.win=null;S.ck={};return toast(n?`Balance check saved: ${msg.join(', ')}`:'Nothing entered, nothing saved')}
      if(a==='save-adj'){const A=S.adj,v=num(A.raw);if(!A.raw||isNaN(v)||v===0)return toast('Enter the points first');
        const pts=p.sign==='signed'?v:Math.abs(v)*A.sign;
        addEntry({kind:'adj',date:today(p),person:A.person,reason:A.reason,title:A.note||A.reason,sub:'Added in the preview',pts});S.win=null;return toast(`${A.reason} saved: ${sg(pts)} for ${A.person}`)}
      if(a==='save-open'){const i=app.querySelector('[data-open-v]'),v=num(i?i.value:'');if(i&&i.value!==''&&!isNaN(v)){S.openSet[e.name+'|'+b.dataset.person]=v}S.win=null;return toast('Opening balance saved')}
      if(a==='save-grid'){let n=0;Object.entries(S.grid).forEach(([k,v])=>{if(v===''){delete S.openSet[k];return}const x=num(v);if(!isNaN(x)){S.openSet[k]=x;n++}});S.win=null;S.grid={};return toast(n?`Saved ${n} opening balance${n===1?'':'s'}`:'Nothing changed')}
      if(a==='mark'){const x=L.find(y=>y.id===b.dataset.id);if(!x)return;
        if(p.markFlow==='box'){S.box=x.id;return rr()}
        S.posted[x.id]={date:today(p),pts:x.pts};
        if(p.markFlow==='undo'){S.undo={id:x.id};clearTimeout(UT);UT=setTimeout(()=>{S.undo=null;rr()},5000);return rr()}
        return toast(`Marked posted ${dt(today(p))}. Use Edit on the line to change the date.`)}
      if(a==='undo'){delete S.posted[b.dataset.id];S.undo=null;clearTimeout(UT);return toast('Back to waiting')}
      if(a==='mark-cancel'){S.box=null;return rr()}
      if(a==='mark-save'){const di=app.querySelector('[data-mk-date]'),pi=app.querySelector('[data-mk-pts]'),x=L.find(y=>y.id===b.dataset.id);const v=num(pi.value);
        S.posted[b.dataset.id]={date:di.value||today(p),pts:isNaN(v)?x.pts:v};S.box=null;return toast(`Bonus posted ${dt(di.value||today(p))}`)}
    });
    app.addEventListener('keydown',ev=>{const t=ev.target;if((ev.key==='Enter'||ev.key===' ')&&t.dataset&&t.dataset.lp!=null){ev.preventDefault();t.click()}});
    app.addEventListener('input',ev=>{const i=ev.target,D=i.dataset;
      if(D.ck!=null){S.ck[D.ck]=i.value;const box=app.querySelector(`[data-ckgap="${CSS.escape(D.ck)}"]`),v=i.value.trim();if(box)box.innerHTML=gapHtml(p,Number(D.app),v===''?null:num(v));return}
      if(D.adjPts!=null){S.adj.raw=i.value;return}
      if(D.adjNote!=null){S.adj.note=i.value;return}
    });
    app.addEventListener('change',ev=>{const i=ev.target,D=i.dataset;
      if(D.adjRsel!=null){S.adj.reason=i.value;const R=REASONS.find(r=>r[0]===i.value);if(R&&R[1])S.adj.sign=R[1];return rr()}
      if(D.adjReason!=null&&i.type==='radio'){S.adj.reason=D.adjReason;const R=REASONS.find(r=>r[0]===D.adjReason);if(R&&R[1])S.adj.sign=R[1];return rr()}
    });
    if(S.undo){const tm=app.querySelector('.mk-undo .tm');if(tm)tm.style.animationDuration='5s'}
    // ── Opening-balance grid: spreadsheet cells ──
    const cells=[...app.querySelectorAll('input.sc[data-g=grid]')];
    const cnt=()=>{const c=app.querySelector('[data-gcount]');if(!c)return;let n=0,of=0;d.grid.forEach(r=>['Omer','Daniella'].forEach(x=>{if(!r.people[x].card)return;of++;const k=r.name+'|'+x,v=S.grid[k]!=null?S.grid[k]:S.openSet[k];if(v!=null&&v!=='')n++}));c.textContent=`${n} of ${of} set`};
    cells.forEach((c,ix)=>{
      c.addEventListener('focus',()=>c.select());
      c.addEventListener('input',()=>{S.grid[c.dataset.k]=c.value;cnt()});
      c.addEventListener('blur',()=>{const v=c.value.trim();if(v==='')return;const n=num(v);if(!isNaN(n)){c.value=f(n);S.grid[c.dataset.k]=c.value}});
      c.addEventListener('keydown',ev=>{const go=j=>{const n=cells[j];if(n){ev.preventDefault();n.focus()}};
        if(ev.key==='Tab'){if(!ev.shiftKey&&ix===cells.length-1)return;return go(ix+(ev.shiftKey?-1:1))}
        if(ev.key==='Enter'||ev.key==='ArrowDown')return go(ix+2);
        if(ev.key==='ArrowUp')return go(ix-2);
        const all=c.selectionStart===0&&c.selectionEnd===c.value.length;
        if(ev.key==='ArrowRight'&&(all||c.selectionStart===c.value.length)&&ix%2===0)return go(ix+1);
        if(ev.key==='ArrowLeft'&&(all||c.selectionEnd===0)&&ix%2===1)return go(ix-1);
        if(ev.key==='Escape'){ev.preventDefault();c.value=S.openSet[c.dataset.k]!=null?f(S.openSet[c.dataset.k]):'';delete S.grid[c.dataset.k];c.select();cnt()}});
      c.addEventListener('paste',ev=>{const txt=(ev.clipboardData||window.clipboardData).getData('text')||'';if(!/[\t\n]/.test(txt.trim()))return;ev.preventDefault();
        txt.replace(/\r/g,'').replace(/\n+$/,'').split('\n').forEach((line,a)=>line.split('\t').forEach((v,b2)=>{const row=Math.floor(ix/2)+a,col=ix%2+b2;if(col>1)return;const t2=cells[row*2+col];if(!t2)return;const n=num(v);if(v.trim()===''||isNaN(n))return;t2.value=f(n);S.grid[t2.dataset.k]=t2.value}));cnt()});
    });
  },
  css:`
#pv{--c-radius:13px;--c-density:1.25;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density))}
#pv *{box-sizing:border-box}
#pv [hidden]{display:none!important}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
#pv button:focus-visible,#pv select:focus-visible,#pv input:focus-visible,#pv [tabindex]:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
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
#pv .kb{position:relative}#pv .kb summary{list-style:none;cursor:pointer;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--tx2);font-size:18px}
#pv .kb summary::-webkit-details-marker{display:none}#pv .kb summary:hover{background:var(--raised)}
#pv .kb>div{position:absolute;right:0;top:34px;z-index:20;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 30px rgba(15,23,42,.18);padding:5px;display:grid;min-width:180px}
#pv .kb>div button{text-align:left;padding:7px 10px;border-radius:7px;font-size:12.5px}#pv .kb>div button:hover{background:var(--raised)}
/* Figures */
#pv .val{font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#pv .good,#pv .up{color:var(--good)}#pv .neg{color:var(--bad)}#pv .pend{color:var(--warn)}#pv .mut{color:var(--tx3)}
#pv .meta{display:flex;flex-wrap:wrap;gap:1px 8px;font-size:11px}
#pv .lg{display:flex;align-items:center;min-width:0}
#pv .lg img{height:100%;width:auto;max-width:100%;object-fit:contain;object-position:left center;display:block}
#pv .mono{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;color:var(--tx2);min-width:0}
#pv .mono i{flex:none;font-style:normal;width:26px;height:26px;border-radius:7px;background:var(--ac-soft);color:var(--ac);display:grid;place-items:center;font-weight:600}
#pv .s-head{display:flex;justify-content:space-between;align-items:baseline;gap:6px 14px;flex-wrap:wrap}
#pv .s-btns{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--gap)}
#pv .btn-g{font-size:12px!important;font-weight:500;color:var(--ac)!important;padding:5px 10px!important;border:1px solid var(--line)!important;border-radius:8px;white-space:nowrap}
#pv .btn-g.sm{font-size:11.5px!important;padding:4px 9px!important}
#pv .btn-g:hover{background:var(--ac-soft)}
#pv .btn{font-size:12.5px;font-weight:500;padding:6px 12px;border-radius:8px;border:1px solid var(--line)!important;color:var(--tx);white-space:nowrap;background:var(--surface)}
#pv .btn.sm{font-size:11.5px;padding:4px 9px}
#pv .btn.pri{background:var(--ac)!important;border-color:var(--ac)!important;color:var(--ac-fg)!important;font-weight:600}
#pv .btn:hover{border-color:var(--ac)!important}
#pv .lnk{color:var(--ac);font-weight:500;text-decoration:underline;text-underline-offset:2px}
#pv .pn{padding:calc(var(--p)*1.1)}
#pv .emp{font-size:12.5px;color:var(--tx3);margin:0}#pv .emp.slim{padding:10px 14px}
#pv .chip{padding:4px 11px;border:1px solid var(--line)!important;border-radius:99px;font-size:12px;color:var(--tx2)}
#pv .chip.on{background:var(--ac);color:var(--ac-fg);border-color:var(--ac)!important;font-weight:600}
/* Portfolio */
#pv .e-tiles{display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fill,minmax(158px,1fr))}
#pv .e-tile{padding:var(--p);display:flex;flex-direction:column;justify-content:space-between;gap:12px;min-width:0;position:relative}
#pv .e-tile .lg{height:38px}#pv .e-tile .val{font-size:21px;display:block}#pv .e-b{display:grid;gap:3px}
#pv .t-chk{font-size:10.5px;color:var(--tx3)}#pv .t-chk.gap{color:var(--warn)}#pv .t-chk.never{color:var(--tx3);font-style:italic}
#pv .t-dot{position:absolute;top:10px;right:10px;width:9px;height:9px;border-radius:50%;background:#F59E0B;box-shadow:0 0 0 3px color-mix(in srgb,#F59E0B 22%,transparent)}
#pv .ob{display:flex;align-items:center;gap:12px 18px;padding:calc(var(--p)*.9) var(--p);border-color:color-mix(in srgb,var(--ac) 35%,var(--line));background:color-mix(in srgb,var(--ac) 5%,var(--surface));flex-wrap:wrap}
#pv .ob-t{display:grid;gap:2px;flex:1;min-width:240px}#pv .ob-t b{font-family:var(--f-h);font-weight:600;font-size:15px}#pv .ob-t span{font-size:12.5px;color:var(--tx2)}
#pv .ob-n{font-size:12.5px;color:var(--tx2);font-weight:500}
/* Ecosystem header */
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
/* Ledger */
#pv .l-people{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:var(--gap)}
#pv .l-p{background:var(--raised);border-radius:calc(var(--c-radius)*.75);padding:var(--p);min-width:0;border:1.5px solid transparent;display:flex;flex-direction:column}
#pv .l-p.tot{background:var(--ac-soft)}
#pv .l-p.no{background:color-mix(in srgb,#F59E0B 8%,var(--raised))}
#pv .l-p.pick{cursor:pointer}#pv .l-p.pick:hover{border-color:color-mix(in srgb,var(--ac) 35%,transparent)}
#pv .l-p.sel{border-color:var(--ac);background:var(--surface)}
#pv .l-ph{font-size:12.5px;display:flex;align-items:center;justify-content:space-between;gap:8px}#pv .l-ph b{font-weight:500;color:var(--tx2)}
#pv .l-cur{font-size:25px;font-weight:600;margin:3px 0 9px;text-align:left;display:block}
#pv button.l-fig{display:inline-flex;align-items:baseline;gap:6px;border-radius:6px;align-self:flex-start}
#pv button.l-fig i{font-style:normal;font-size:13px;color:var(--ac);opacity:0;transition:opacity .12s}
#pv button.l-fig:hover{text-decoration:underline dotted var(--ac);text-underline-offset:5px}#pv button.l-fig:hover i,#pv button.l-fig:focus-visible i{opacity:1}
#pv .l-p dl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;font-size:12px;margin:0;font-variant-numeric:tabular-nums}
#pv .l-p dt{color:var(--tx3)}#pv .l-p dt small{font-size:10.5px;opacity:.8;margin-left:3px}#pv .l-p dd{margin:0;text-align:right}
#pv .o-dd{display:flex;gap:4px;justify-content:flex-end;align-items:center}
#pv .o-ed{color:var(--ac);font-size:11.5px;opacity:0;width:16px}#pv .l-p:hover .o-ed,#pv .o-ed:focus-visible{opacity:1}
#pv .ck-line{font-size:11.5px;margin:-4px 0 10px;color:var(--tx3)}#pv .ck-line.ok{color:var(--good)}#pv .ck-line.gap{color:var(--warn)}
#pv .ck-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--tx3);cursor:default}
#pv .ck-dot i{width:8px;height:8px;border-radius:50%;background:var(--tx3);opacity:.5}
#pv .ck-dot.ok i{background:var(--good);opacity:1}#pv .ck-dot.gap i{background:#F59E0B;opacity:1}
#pv .l-bonus{margin-top:9px;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,#F59E0B 11%,transparent);display:grid;grid-template-columns:1fr auto;gap:1px 8px;font-size:12px}
#pv .l-bonus b{color:var(--warn);font-weight:600;font-variant-numeric:tabular-nums}#pv .l-bonus small{grid-column:1/-1;font-size:10.5px;color:var(--tx3)}
#pv .l-p>.btn,#pv .l-cb{margin-top:12px}#pv .l-p>.btn,#pv .l-p>.btn-g{align-self:flex-start;margin-top:12px}
#pv .no-t{font-size:11px;color:var(--tx3);margin:8px 0}
#pv .leg{font-size:11.5px;color:var(--tx3);margin:12px 0 0}#pv .leg.warn{color:var(--tx2);padding:8px 11px;border-radius:8px;background:color-mix(in srgb,#F59E0B 10%,transparent)}#pv .leg b{font-weight:600}
#pv .l-acts{display:flex;gap:10px 22px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
#pv .l-acts>div{display:flex;gap:8px;align-items:center;font-size:12.5px}#pv .l-acts b{font-weight:500;color:var(--tx2)}
/* Challenges */
#pv .ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr));gap:var(--gap)}
#pv .ch-card{padding:var(--p);display:grid;grid-template-columns:auto minmax(0,1fr);gap:13px;align-items:center;min-width:0;position:relative}
#pv .ch-t{display:grid;gap:2px;min-width:0;justify-items:start}#pv .ch-t b{font-weight:500;font-size:13.5px}
#pv .ch-t>span{font-size:11.5px;color:var(--tx3)}#pv .ch-t>span.ch-bonus{color:var(--ac);font-weight:500}
#pv .ch-t .ch-wait{color:var(--warn);font-weight:600;margin-top:4px}#pv .ch-t .ch-ok{color:var(--good);font-weight:600;margin-top:4px}
#pv .ch-t .mk{margin-top:4px}
#pv .rings figure{margin:0;display:grid;justify-items:center;gap:3px;width:58px}
#pv .rings figcaption{font-size:10px;color:var(--tx3)}
#pv .ring{width:58px;height:58px;display:block}
#pv .arch{position:absolute;top:7px;right:7px;padding:3px 9px!important;border-radius:99px;font-size:11.5px;font-weight:600;color:var(--ac);background:var(--surface)!important;border:1px solid var(--ac)!important;opacity:0;transition:opacity .12s}
#pv .ch-card:hover .arch,#pv .arch:focus-visible{opacity:1}
#pv .ch-add{display:flex;align-items:center;justify-content:center;min-height:96px;border-radius:var(--c-radius);color:var(--ac)!important;border:1.5px dashed color-mix(in srgb,var(--ac) 50%,var(--line))!important}
#pv .ch-add span{font-size:30px;line-height:1}
/* Activity */
#pv .r-st{display:flex;gap:calc(var(--gap)*2);flex-wrap:wrap;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--line)}
#pv .r-st div{display:grid;gap:2px}#pv .r-st span{font-size:11px;color:var(--tx3)}#pv .r-st b{font-size:17px;font-weight:600}
#pv .a-chips{display:flex;gap:6px 14px;flex-wrap:wrap;margin-bottom:8px;align-items:center;justify-content:space-between}
#pv .cg{display:flex;gap:6px;flex-wrap:wrap}
#pv .a-note{font-size:12px;color:var(--tx3);margin:2px 0 8px}
#pv .a-feed>[data-k]{display:grid;grid-template-columns:86px minmax(0,1fr);gap:8px;align-items:center;border-bottom:1px solid var(--line)}
#pv .a-feed>[data-k]:last-child{border:0}
#pv .a-feed.top{border-radius:9px;background:color-mix(in srgb,#F59E0B 7%,transparent);padding:0 10px;margin-bottom:10px}
#pv .a-feed.top>[data-k]{border-color:color-mix(in srgb,#F59E0B 20%,transparent)}
#pv .ev-k{font-size:10.5px;color:var(--tx3);font-weight:600}
#pv .is-pend .ev-k{color:var(--warn)}
#pv .ev{display:flex;align-items:center;gap:12px;padding:9px 0;min-width:0}
#pv .ev-t{flex:1;display:grid;gap:1px;min-width:0;font-size:13px}#pv .ev-t b{font-weight:500}#pv .ev-t span{font-size:11.5px;color:var(--tx3)}
#pv .ev-v{display:grid;justify-items:end;gap:0}
#pv .ev .val{font-size:14px;font-weight:600;white-space:nowrap}
#pv .rb{font-size:10.5px;color:var(--tx3);font-variant-numeric:tabular-nums}
#pv .rs{font-style:normal;font-size:10.5px;font-weight:600;color:var(--ac);background:var(--ac-soft);padding:1px 7px;border-radius:99px;margin-left:4px;white-space:nowrap}
#pv .ev-a{opacity:0;transition:opacity .12s}#pv .ev:hover .ev-a,#pv .ev-a:focus-within{opacity:1}
#pv .mk-undo{display:flex;align-items:center;gap:6px;position:relative;padding-bottom:3px}
#pv .mk-undo .tm{position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--ac);transform-origin:left;animation:lg-shrink 5s linear forwards}
@keyframes lg-shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}
#pv .mk-box{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:8px;border:1px solid var(--line);border-radius:9px;background:var(--surface);margin-top:4px}
#pv .mk-box label{display:grid;gap:2px;font-size:10.5px;color:var(--tx3)}
#pv .mk-box input{font:inherit;font-size:12px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;width:116px;color:var(--tx);background:var(--surface)}
#pv .mk-b{display:flex;gap:6px}
#pv .rg-w{overflow-x:auto}
#pv table.rg{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
#pv .rg th{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
#pv .rg td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
#pv .rg tbody tr:nth-child(even):not(.rg-sep){background:color-mix(in srgb,var(--tx) 2.5%,transparent)}
#pv .rg tr.is-pend{background:color-mix(in srgb,#F59E0B 7%,transparent)!important}
#pv .rg .rg-sep td{padding:0;height:6px;border:0;background:var(--surface)}
#pv .rg .d{white-space:nowrap;color:var(--tx2);width:62px}#pv .rg .pt{color:var(--warn);font-weight:600;font-size:11px}
#pv .rg .en b{font-weight:500}#pv .rg .en small{display:block;font-size:11px;color:var(--tx3)}
#pv .rg .n{text-align:right;white-space:nowrap}#pv .rg .bal{color:var(--tx2)}#pv .rg .ac{width:1%;white-space:nowrap;text-align:right}
#pv .rg tr:hover .ev-a{opacity:1}
#pv .who{font-size:11.5px;color:var(--tx2)}#pv .who.no{color:var(--warn)}
#pv .mo{margin-bottom:12px}#pv .mo:last-child{margin:0}
#pv .mo-h{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;padding:6px 10px;border-radius:8px;background:var(--raised);font-size:12px;color:var(--tx3)}
#pv .mo-h>b{font-family:var(--f-h);font-size:13px;font-weight:600;color:var(--tx);margin-right:auto}#pv .mo-h span b{color:var(--tx);font-size:13px}
#pv .mo .a-row{display:grid;grid-template-columns:86px minmax(0,1fr);gap:8px;align-items:center;border-bottom:1px solid var(--line);padding:0 10px}
#pv .mo .a-row:last-child{border:0}
/* Windows */
#pv .mdl-bk{position:absolute;inset:0;background:rgba(15,23,42,.32);z-index:30}
#pv .mdl,#pv .drw{z-index:31;background:var(--surface);display:grid;grid-template-rows:auto minmax(0,1fr) auto}
#pv .mdl{position:absolute;left:50%;transform:translateX(-50%);width:min(540px,calc(100% - 24px));max-height:640px;border:1px solid var(--line);border-radius:calc(var(--c-radius)*1.1);box-shadow:0 24px 60px rgba(15,23,42,.28)}
#pv .drw{position:absolute;right:0;width:min(440px,100%);border-left:1px solid var(--line);box-shadow:-12px 0 32px rgba(15,23,42,.18)}
#pv .inl{display:grid;grid-template-rows:auto auto auto;margin-bottom:var(--gap);border-color:color-mix(in srgb,var(--ac) 40%,var(--line));box-shadow:0 8px 24px rgba(15,23,42,.08)}
#pv .mh{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 10px;border-bottom:1px solid var(--line)}
#pv .mh h3{margin:0;font-size:15px;font-weight:600}
#pv .ib{width:30px;height:30px;border-radius:8px;color:var(--tx2);font-size:19px}#pv .ib:hover{background:var(--raised)}
#pv .mb{padding:12px 16px;overflow-y:auto;min-height:0;display:grid;gap:14px;align-content:start}
#pv .mf{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--line)}
#pv .mf-l{margin-right:auto;font-size:12px;color:var(--tx3)}
#pv .fld{display:grid;gap:5px;font-size:11.5px;color:var(--tx3);font-weight:500;min-width:0}
#pv .fl-l{font-size:11.5px;color:var(--tx3);font-weight:500}
#pv .fld input,#pv .fld select,#pv .split select,#pv .split input{font:inherit;font-size:13px;font-weight:400;color:var(--tx);padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--surface);min-width:0;width:100%}
#pv .fld input.big-in{font-family:var(--f-h);font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;padding:8px 10px}
#pv .frow{display:flex;gap:10px;flex-wrap:wrap}#pv .frow .fld{flex:0 0 150px}#pv .frow .fld.grow{flex:1 1 200px}
#pv .hint{font-size:11.5px;color:var(--tx3);margin:0}
#pv .ck{display:grid;gap:8px;padding-bottom:14px;border-bottom:1px solid var(--line)}
#pv .ck-h{display:grid;gap:2px;font-size:12.5px}#pv .ck-h>b{font-weight:600}#pv .ck-h span{color:var(--tx2)}
#pv .ck-gap{font-size:12.5px;color:var(--tx2);min-height:20px}
#pv .g3{display:flex;gap:18px}#pv .g3>span{display:grid;gap:1px}#pv .g3 small{font-size:10.5px;color:var(--tx3)}#pv .g3 b{font-family:var(--f-h);font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}
#pv .split{display:grid;gap:6px;justify-items:start}#pv .sp-r{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:6px;width:100%}
#pv .seg{display:inline-flex;border:1px solid var(--line);border-radius:9px;padding:2px;gap:2px;justify-self:start}
#pv .seg button{padding:5px 12px;border-radius:7px;font-size:12.5px;color:var(--tx2)}#pv .seg button.on{background:var(--ac);color:var(--ac-fg);font-weight:600}
#pv .fld .seg+input{margin-top:6px}
#pv .rchips{display:flex;gap:6px;flex-wrap:wrap}
#pv .rlist{display:grid;gap:4px}
#pv .rlist label{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 8px;align-items:center;padding:6px 9px;border:1px solid var(--line);border-radius:8px;cursor:pointer;color:var(--tx)}
#pv .rlist label.on{border-color:var(--ac);background:var(--ac-soft)}
#pv .rlist input{grid-row:span 2;margin:0;width:auto}#pv .rlist b{font-weight:500;font-size:12.5px}#pv .rlist small{font-size:11px;color:var(--tx3);font-weight:400}
#pv .pm{display:grid;grid-template-columns:44px minmax(0,1fr);gap:6px}
#pv .pm-s{border-radius:8px;font-size:20px;font-weight:600;border:1px solid var(--line)!important}
#pv .pm-s.pos{color:var(--good);background:color-mix(in srgb,var(--good) 9%,transparent)!important}#pv .pm-s.neg{color:var(--bad);background:color-mix(in srgb,var(--bad) 9%,transparent)!important}
#pv table.og{width:100%;border-collapse:collapse;font-size:12.5px}
#pv .og th,#pv .og td{border-bottom:1px solid var(--line);padding:3px 4px;text-align:left;vertical-align:middle}
#pv .og thead th{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);font-weight:600;padding:6px 4px}
#pv .og thead th:not(:first-child){text-align:right;width:132px}
#pv .og tbody th{font-weight:500;display:flex;align-items:center;gap:8px;min-height:38px;flex-wrap:wrap}
#pv .og tbody th .lg{height:20px;width:52px;flex:none}#pv .og tbody th .mono i{width:20px;height:20px}#pv .og tbody th .mono span{display:none}
#pv .og .gn{font-size:12.5px}#pv .og th small{flex-basis:100%;font-size:10.5px;color:var(--tx3);font-weight:400;padding-left:60px;margin-top:-6px}
#pv .og td small{display:block;text-align:right;font-size:10.5px;color:var(--tx3);padding-right:6px}
#pv input.sc{display:block;width:100%;font:inherit;font-size:13px;font-variant-numeric:tabular-nums;text-align:right;color:var(--tx);background:transparent;border:1px solid transparent;border-radius:4px;padding:5px 6px;cursor:cell}
#pv input.sc::placeholder{color:var(--tx3);opacity:.6}
#pv input.sc:hover{border-color:color-mix(in srgb,var(--ac) 40%,transparent)}
#pv input.sc:focus{outline:2px solid var(--ac);outline-offset:-1px;background:var(--surface);cursor:text}
#pv td.nc input.sc::placeholder{font-style:italic;opacity:.45}
#pv .toast{position:absolute;left:50%;transform:translateX(-50%);z-index:40;background:#0F172A;color:#fff;font-size:12.5px;font-weight:500;padding:9px 14px;border-radius:9px;box-shadow:0 10px 26px rgba(15,23,42,.3);max-width:calc(100% - 24px)}
@container pv (max-width:900px){#pv .fan{margin-left:0}}
`
});
})();
