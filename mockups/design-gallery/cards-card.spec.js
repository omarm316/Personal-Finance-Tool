// Design gallery spec for the Cards module's individual Card page.
// Content comes from the data file; this file holds no personal figures.
(function(){
const NAV=['Dashboard','Transactions','Budgets','Net Worth','Daily Balances','Cash Flow','Loans','GCB','Cards','Accounts','Settings'];
const GRAD={'Chase UR':'#1e40af,#0f2a5f','Amex MR':'#0a2f6b,#2563eb','Hilton Honors':'#4c1d95,#2e1065'};
const f=n=>Math.round(n||0).toLocaleString('en-US');
const m2=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const m0=n=>'$'+f(n);
const short=n=>n>=1000?'$'+(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+'k':'$'+Math.round(n);
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dt=s=>{const[y,m,d]=s.split('-');return `${MON[m-1]} ${Number(d)}`};
const dty=s=>{const[y,m,d]=s.split('-');return `${MON[m-1]} ${Number(d)}, ${y}`};
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'#2563EB','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,#2563EB 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C'});
const card=(p,d)=>d.cards[p.card];
const art=(c,h)=>{const a=h.img('card_'+c.key);return `<div class="face" style="background:linear-gradient(135deg,${GRAD[c.eco]||'#374151,#1f2937'})">${a?`<img src="${a}" alt="${h.esc(c.product)}">`:''}<span class="mask">${h.esc(c.mask||'')}</span></div>`};
const logo=(c,h)=>{const s=c.logo?h.img(`logo_${c.logo}_light`):'';return s?`<img class="logo" src="${s}" alt="${h.esc(c.eco)}">`:`<b>${h.esc(c.eco)}</b>`};
const owed=c=>m2(Math.abs(c.balance));
function util(c,p){if(c.util==null||!c.limit)return '';const t=`${c.util}% of ${m0(c.limit)} limit`;
  if(p.utilStyle==='text')return `<div class="u-text">${t}</div>`;
  const col=c.util>80?'var(--bad)':c.util>50?'var(--warn)':'var(--good)';
  return `<div class="u"><div class="u-l"><span>Utilization</span><span>${t}</span></div><div class="bar"><i style="width:${Math.min(c.util,100)}%;background:${col}"></i></div></div>`;}
function facts(c){const s=c.feeSum,act=s&&(s.fee_charged>0||s.credits_received>0);
  return [['Annual fee',act?`${m0(s.net_cost)} net`:m0(c.fee),act?`${m0(s.fee_charged)} fee, ${m0(s.credits_received)} credits`:'No activity this cycle',!!act],['Credit limit',m0(c.limit),''],['Statement closes',`Day ${c.close}`,''],['Payment due',`Day ${c.due}`,'']];}
function top(p,c,h){const per=`<div class="period"><div class="und">${['MTD','QTD','YTD'].map(x=>`<button type="button" class="${x==='QTD'?'on':''}">${x}</button>`).join('')}</div></div>`;
  const menu=p.productPlace==='menu'?`<details class="menu"><summary>Manage card</summary><div><button type="button">Change product</button><button type="button">Product history</button><button type="button">Edit card details</button></div></details>`:'';
  return `<header class="hdr sf"><div class="crumbs"><button type="button">Cards</button><i>›</i><button type="button">Portfolio</button><i>›</i><button type="button">${h.esc(c.eco)}</button><i>›</i><b>${h.esc(c.name)}</b></div><div class="hdr-r">${menu}${per}</div></header>`;}
const cmenu=c=>`<details class="cmenu"><summary aria-label="Manage card">⋯</summary><div><button type="button">Change product</button><button type="button">Product history</button><button type="button">Edit card details</button><hr><button type="button">Add a benefit</button><button type="button">Add a challenge</button><hr><button type="button" class="bad">Mark card as closed</button></div></details>`;
function hero(p,c,d,h){const sub=`${h.esc(c.owner||'Unassigned')} · ${h.esc(c.network||'')} · ${h.esc(c.currency)}`;
  const bal=`<div class="bal"><small>Current balance</small><div class="val big">${owed(c)}</div></div>`;
  const earned=`<div class="st"><span>Earned ${d.period}</span><b class="val up">+${f(c.earned)}</b></div>`;
  const inl=p.factsStyle==='header'?facts(c).map(x=>`<div class="st"><span>${x[0]}</span><b class="val">${x[1]}</b></div>`).join(''):'';
  if(p.heroStyle==='banner')return `<section data-region="hero" class="h-ban" style="background:linear-gradient(135deg,${GRAD[c.eco]||'#374151,#1f2937'})"><div class="h-t m-${p.menuSpot}"><div><div class="h-ti"><h1>${h.esc(c.product)}</h1>${p.menuSpot==='title'?cmenu(c):''}</div><p>${h.esc(c.name)}, ${sub}</p></div><div class="h-art">${art(c,h)}</div>${p.menuSpot==='corner'?cmenu(c):''}</div><div class="h-b">${bal}${earned}${inl}</div>${util(c,p)}</section>`;
  if(p.heroStyle==='feature')return `<section data-region="hero" class="h-fe sf"><div class="h-art lg">${art(c,h)}</div><div class="h-body"><div class="h-id"><span class="lgo">${logo(c,h)}</span><div><h1>${h.esc(c.product)}</h1><p>${sub}</p></div></div><div class="h-b">${bal}${earned}${inl}</div>${util(c,p)}</div></section>`;
  return `<section data-region="hero" class="h-st sf"><div class="h-art sm">${art(c,h)}</div><div class="h-nm"><h1>${h.esc(c.product)}</h1><p>${sub}</p></div>${bal}<div class="h-sts">${earned}${inl}</div>${util(c,p)}</section>`;}
function factsSec(p,c,h){if(p.factsStyle==='header'&&p.productPlace!=='facts')return '';
  const F=facts(c),chg=`<button type="button" class="btn">Change product</button>`;
  const prod=p.productPlace==='facts'?`<div class="f-prod"><span>Product</span><b>${h.esc(c.product)}</b>${chg}</div>`:'';
  let b='';
  if(p.factsStyle==='tiles')b=`<div class="f-tiles">${F.map(x=>`<div class="sf f-t ${x[3]?'link':''}"><span>${x[0]}</span><b class="val">${x[1]}</b>${x[2]?`<small>${x[2]}</small>`:''}</div>`).join('')}</div>${prod?`<div class="sf pn prodrow">${prod}</div>`:''}`;
  else if(p.factsStyle==='strip')b=`<div class="sf f-strip">${F.map(x=>`<div class="${x[3]?'link':''}"><span>${x[0]}</span><b class="val">${x[1]}</b>${x[2]?`<small>${x[2]}</small>`:''}</div>`).join('')}${prod}</div>`;
  else b=`<div class="sf pn prodrow">${prod}</div>`;
  return `<section data-region="facts">${b}</section>`;}
function productSec(p,c,h){if(p.productPlace!=='panel')return '';return `<section data-region="facts" class="sf pn p-row"><div><span>Card product</span><b>${h.esc(c.product)}</b><small>Since ${dty(c.history[0].from)}</small></div><button type="button" class="btn">Change product</button></section>`;}
function rates(p,c,h){const R=[{c:'All purchases',r:c.baseRate,base:true},...c.rates];
  if(p.rateStyle==='chips')return `<div class="r-chips">${R.map(r=>`<span class="${r.base?'base':''}"><b>${r.r}x</b> ${h.esc(r.c)}</span>`).join('')}</div>`;
  return `<div class="r-list">${R.map(r=>`<div class="${r.base?'base':''}"><span>${h.esc(r.c)}</span><b class="val">${r.r}x</b></div>`).join('')}</div>`;}
function earnBars(c,d,h){if(!c.earn.length)return `<p class="emp">Nothing earned this period.</p>`;const mx=Math.max(...c.earn.map(e=>e.pts),1);
  return `<div class="e-bars">${c.earn.map(e=>`<div><span>${h.esc(e.c)} <em>${e.r}x</em></span><div class="bar"><i style="width:${e.pts/mx*100}%"></i></div><b>${f(e.pts)}</b></div>`).join('')}</div>`;}
function earn(p,c,d,h){const tot=`<span class="ct">${f(c.earned)} ${h.esc(c.currency)} ${d.period}</span>`;let b;
  if(p.earnLayout==='merged'){const spend=p.earnCols==='spend',gen=c.earn.find(e=>e.c==='General')||{spend:0,pts:0},M=new Map(c.earn.filter(e=>e.c!=='General').map(e=>[e.c,e]));
    const rows=[...M.values(),...c.rates.filter(r=>!M.has(r.c)).map(r=>({c:r.c,r:r.r,spend:0,pts:0}))].sort((x,y)=>p.earnSort==='rate'?(y.r-x.r||y.pts-x.pts):(y.pts-x.pts||y.r-x.r));
    const mx=Math.max(gen.pts,...rows.map(e=>e.pts),1),beside=p.earnBar==='beside',bar=e=>`<div class="bar e-b"><i style="width:${Math.max(0,e.pts)/mx*100}%"></i></div>`;
    const row=(e,n)=>`<tr class="${e.pts?'':'dim'}"><td class="e-c">${h.esc(n)}${beside?'':bar(e)}</td>${beside?`<td class="e-bc">${bar(e)}</td>`:''}<td class="n ac">${e.r}x</td>${spend?`<td class="n">${e.spend?m0(e.spend):'–'}</td>`:''}<td class="n">${e.pts?f(e.pts):'–'}</td></tr>`;
    b=`<div class="sf pn">${p.align==='banner'?`<h2 class="in">Earnings ${tot}</h2>`:''}<table class="t"><thead><tr><th${beside?' colspan="2"':''}>Category</th><th class="n">Rate</th>${spend?`<th class="n">Spend</th>`:''}<th class="n">Points</th></tr></thead><tbody>${rows.map(e=>row(e,e.c)).join('')}${row({r:c.baseRate,spend:gen.spend,pts:gen.pts},'All other purchases')}</tbody></table></div>`;}
  else b=`<div class="${p.earnLayout==='side'?'two':'stack2'}"><div class="sf pn"><h3>Earning rates</h3>${rates(p,c,h)}</div><div class="sf pn"><h3>Points earned</h3>${earnBars(c,d,h)}</div></div>`;
  return `<section data-region="earn">${p.earnLayout==='merged'&&p.align==='banner'?'':`<h2>Earnings ${tot}</h2>`}${b}</section>`;}
const FQ={monthly:'a month',quarterly:'a quarter',semi:'each half year',annual:'a year',multi:'every 4 to 5 years',stay:'per stay'};
const GRP=[['monthly','Monthly'],['quarterly','Quarterly'],['semi','Twice a year'],['annual','Yearly'],['multi','Occasional'],['stay','Occasional']];
const mo=n=>{const r=Math.round(n*100)/100;return '$'+(r%1?r.toFixed(2):r.toLocaleString('en-US'))};
const last=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const pad=n=>String(n).padStart(2,'0');
function benModel(b,today){const y=Number(today.slice(0,4)),spans=[];
  if(b.freq==='monthly')for(let i=1;i<=12;i++)spans.push([MON[i-1],`${y}-${pad(i)}-01`,`${y}-${pad(i)}-${last(y,i)}`]);
  else if(b.freq==='quarterly')for(let q=0;q<4;q++)spans.push([`Q${q+1}`,`${y}-${pad(q*3+1)}-01`,`${y}-${pad(q*3+3)}-${last(y,q*3+3)}`]);
  else if(b.freq==='semi')spans.push(['Jan–Jun',`${y}-01-01`,`${y}-06-30`],['Jul–Dec',`${y}-07-01`,`${y}-12-31`]);
  else if(b.freq==='annual')spans.push([b.year==='cardmember'?'Card year':String(y),`${y}-01-01`,`${y}-12-31`]);
  const P=spans.map(([l,s,e])=>{const U=b.uses.filter(u=>u[0]>=s&&u[0]<=e),used=U.reduce((t,u)=>t+u[1],0);
    const state=e<today?'past':s>today?'future':'current',st=used>=b.per-.005?'full':used>0?'part':state==='past'?'miss':state==='current'?'open':'fut';
    return {l,s,e,U,used,state,st}});
  const cur=P.find(x=>x.state==='current'),days=cur?Math.round((Date.parse(cur.e)-Date.parse(today))/864e5)+1:null;
  const yUsed=b.uses.reduce((t,u)=>t+u[1],0),yVal=P.length?b.per*P.length:b.per;
  return {P,cur,days,left:cur?Math.max(0,b.per-cur.used):null,yUsed,yVal,open:!!cur&&cur.st!=='full'};}
const curName=(b,m)=>b.freq==='monthly'?MON[Number(m.cur.s.slice(5,7))-1]:b.freq==='quarterly'?m.cur.l:b.freq==='semi'?'This half':'This year';
const srcTag=(p,b,h)=>p.benSource?(b.match?'<span class="tg auto">Auto-tracked</span>':'<span class="tg hand">Log by hand</span>'):'';
function chip(b,m,j,i){const x=m.P[j],tip=`${x.l}: ${mo(x.used)} of ${mo(b.per)}`;const inner=b.freq==='monthly'?x.l:`${x.l}<em>${x.st==='full'?'✓':x.st==='fut'?'':mo(x.used)}</em>`;
  return `<button type="button" class="pc s-${x.st} ${x.state==='current'?'cur':''}" data-b="${i}" data-p="${j}" title="${tip}" aria-label="${tip}">${inner}</button>`;}
function dots(b,m,i){return `<span class="dots">${m.P.map((x,j)=>`<button type="button" class="dt s-${x.st} ${x.state==='current'?'cur':''}" data-b="${i}" data-p="${j}" title="${x.l}: ${mo(x.used)} of ${mo(b.per)}" aria-label="${x.l}: ${mo(x.used)} of ${mo(b.per)}"></button>`).join('')}</span>`;}
function nowLine(b,m){if(!m.P.length)return b.uses.length?`<span class="up">Used ${b.uses.length}×</span>`:'<span class="dimt">Nothing logged</span>';
  if(!m.open)return `<span class="up">${curName(b,m)} used ✓</span>`;return `<span class="lf"><b>${mo(m.left)}</b> left · ${m.days} day${m.days===1?'':'s'}</span>`;}
function detail(b,m,i){const D=(x,j)=>`<div class="pd" data-pd="${i}-${j}" hidden><div class="pd-h"><b>${x.l}</b><span>${mo(x.used)} of ${mo(b.per)}</span></div>${x.U.length?`<ul>${x.U.map(u=>`<li><span>${dt(u[0])}</span><b>${mo(u[1])}</b><small>${u[2]==='auto'?'Statement credit':'Logged by hand'}${u[4]!=null&&TXS[u[4]]?`, for <span class="lkp">${TXS[u[4]].desc} ${m2(TXS[u[4]].amt)}</span>`:''}</small><button type="button" class="lnk">Remove</button></li>`).join('')}</ul>`:'<p class="emp">Nothing used in this period.</p>'}<div class="pd-add"><input class="inp" type="date" aria-label="Date" value="${b.uses.length?'2026-11-03':'2026-11-03'}"><input class="inp amt" type="text" inputmode="decimal" aria-label="Amount" placeholder="${mo(Math.max(0,b.per-x.used)||b.per)}"><button type="button" class="btn sm">Add use</button></div><div class="pd-f">${x.st!=='full'?`<button type="button" class="btn sm">Mark fully used</button>`:''}<button type="button" class="btn sm pri" data-close>Done</button></div></div>`;
  if(!m.P.length)return D({l:FQ[b.freq]==='per stay'?'Uses':'Uses',U:b.uses,used:b.uses.reduce((t,u)=>t+u[1],0),st:'open'},'x');
  return m.P.map(D).join('');}
function editForm(b,i,h){const F=[['monthly','Monthly'],['quarterly','Quarterly'],['semi','Twice a year'],['annual','Yearly'],['multi','Every few years'],['stay','Per use']];
  return `<div class="ef" data-ef="${i}" hidden><h3>Edit benefit</h3><label>Name<input class="inp" value="${h.esc(b.name)}"></label><div class="ef-2"><label>Amount each time it resets<input class="inp" value="${mo(b.per)}"></label><label>Year runs<select class="inp"><option ${b.year!=='cardmember'?'selected':''}>Calendar year</option><option ${b.year==='cardmember'?'selected':''}>Card anniversary</option></select></label></div><fieldset><legend>Resets</legend><div class="seg">${F.map(([k,l])=>`<button type="button" class="${k===b.freq||(k==='multi'&&b.freq==='multi')?'on':''}">${l}</button>`).join('')}</div></fieldset><label>Track automatically: statement credits containing<input class="inp" value="${h.esc(b.match||'')}" placeholder="Leave empty to log by hand"></label><label class="ck"><input type="checkbox" checked> Remind me 7 days before an unused credit resets</label><div class="ef-f"><button type="button" class="lnk bad">Delete benefit</button><span><button type="button" class="btn" data-ecancel>Cancel</button><button type="button" class="btn pri" data-ecancel>Save</button></span></div></div>`;}
function benCard(p,b,m,i,h){const ed=`<button type="button" class="ib" data-edit="${i}" aria-label="Edit ${h.esc(b.name)}">✎</button>`,cad=`${mo(b.per)} ${FQ[b.freq]}${b.year==='cardmember'?', card year':''}`;
  const note=b.note?`<small class="nt">${h.esc(b.note)}</small>`:'';
  const yr=m.P.length>1?`<span class="yr">2026: <b>${mo(m.yUsed)}</b> of ${mo(m.yVal)}</span>`:'<span class="yr"></span>';
  const log=`<button type="button" class="btn sm" data-log="${i}">Log use</button>`;
  let body;
  if(p.benCard==='strip')body=`<div class="bc-h"><div><b>${h.esc(b.name)}</b><small>${cad} ${srcTag(p,b,h)}</small>${note}</div><div class="bc-a">${nowLine(b,m)}${ed}</div></div>${m.P.length>1?`<div class="pstrip n${m.P.length}">${m.P.map((_,j)=>chip(b,m,j,i)).join('')}</div>`:''}<div class="bc-f">${yr}${log}</div>`;
  else if(p.benCard==='now'){const pct=m.cur?Math.min(100,m.cur.used/b.per*100):0;
    body=`<div class="bc-h"><div><b>${h.esc(b.name)}</b><small>${cad} ${srcTag(p,b,h)}</small>${note}</div>${ed}</div>${m.cur?`<div class="nw-big">${m.open?`<b class="val">${mo(m.left)}</b><span>left ${b.freq==='monthly'?'in '+curName(b,m):b.freq==='quarterly'?'this quarter':b.freq==='semi'?'this half':'this year'}, resets in ${m.days} days</span>`:`<b class="val up">Used</b><span>${curName(b,m).toLowerCase()==='this year'?'for this year':'for '+curName(b,m)}, next resets in ${m.days} days</span>`}</div><div class="bar"><i style="width:${pct}%;${m.open?'':'background:var(--good)'}"></i></div>`:`<div class="nw-big">${nowLine(b,m)}</div>`}<div class="bc-f">${m.P.length>1?`<span class="hist">${dots(b,m,i)}${yr}</span>`:yr}<span class="bc-b">${m.open?`<button type="button" class="btn sm pri" data-full="${i}">Mark used</button>`:''}${log}</span></div>`;}
  else body=`<div class="rw"><div class="rw-n"><b>${h.esc(b.name)}</b><small>${cad} ${srcTag(p,b,h)}</small></div><div class="rw-s">${m.P.length>1?dots(b,m,i):''}<span class="pill ${m.open?'o':m.P.length?'d':'n'}">${m.P.length?(m.open?mo(m.left)+' left':'Used'):(b.uses.length?'Used':'Unused')}</span></div><details class="ra-m"><summary aria-label="Actions for ${h.esc(b.name)}">⋯</summary><div><button type="button" data-log="${i}">Log a use</button>${m.open?`<button type="button">Mark fully used</button>`:''}<button type="button" data-edit="${i}">Edit</button><button type="button" class="bad">Delete</button></div></details></div>`;
  return `<div class="${p.benCard==='rows'?'bcr':'sf bc'}" data-bc="${i}"><div class="bc-v">${body}</div>${detail(b,m,i)}${p.benEdit==='inline'?editForm(b,i,h):''}</div>`;}
let TXS=[];
function benefits(p,c,d,h){TXS=c.txns||[];const B=c.ben||[],today=d.today,M=B.map(b=>benModel(b,today));
  const tot=M.reduce((t,m)=>t+m.yVal,0),used=M.reduce((t,m)=>t+m.yUsed,0);
  const sum=B.length?`<p class="b-line">${m0(tot)} in credits this year, <span class="up">${m0(used)} used</span>, ${m0(Math.max(0,tot-used))} left</p>`:'';
  let idx=B.map((_,i)=>i);
  if(p.benOrder==='due')idx.sort((a,b)=>{const A=M[a],Bm=M[b],k=m=>m.open?0:m.P.length?1:2;return k(A)-k(Bm)||(A.open&&Bm.open?(A.days-Bm.days)||(Bm.left-A.left):0)});
  const card=i=>benCard(p,B[i],M[i],i,h);
  let list;
  if(p.benOrder==='freq'){const seen=new Set();list=GRP.filter(([k,l])=>{if(seen.has(l))return false;const has=idx.some(i=>B[i].freq===k||(l==='Occasional'&&['multi','stay'].includes(B[i].freq)));if(has)seen.add(l);return has}).map(([k,l])=>`<div class="bgrp"><h3>${l}</h3>${idx.filter(i=>l==='Occasional'?['multi','stay'].includes(B[i].freq):B[i].freq===k).map(card).join('')}</div>`).join('');}
  else list=idx.map(card).join('');
  if(p.benCard==='rows')list=`<div class="sf pn bcrs">${list}</div>`;
  const op=idx.filter(i=>M[i].open&&M[i].days<=60).sort((a,b)=>M[a].days-M[b].days);
  const alert=p.benAlert&&op.length?`<div class="b-alert"><b>${mo(op.reduce((t,i)=>t+M[i].left,0))} expires if unused</b>${op.map(i=>`<button type="button" class="al" data-log="${i}"><span>${h.esc(B[i].name)}</span><span>${mo(M[i].left)}</span><small>by ${dt(M[i].cur.e)}</small></button>`).join('')}</div>`:'';
  const legend=p.benCard!=='strip'?'':`<div class="lg"><span><i class="s-full"></i>Used</span><span><i class="s-part"></i>Partly</span><span><i class="s-miss"></i>Missed</span><span><i class="s-open cur"></i>Now</span></div>`;
  const drawer=p.benEdit==='panel'&&B.length?`<div class="scrim" hidden></div><aside class="drw" hidden aria-label="Edit benefit">${B.map((b,i)=>editForm(b,i,h)).join('')}</aside>`:'';
  return `<section data-region="benefits"><div class="s-h"><h2>Benefits and credits <span class="ct">${B.length}</span></h2><button type="button" class="btn">+ Add benefit</button></div>${sum}${alert}${legend}${B.length?`<div class="b-list">${list}</div>`:'<div class="sf pn"><p class="emp">No credits set up for this card.</p></div>'}${drawer}</section>`;}
function ring(x){const r=22,C=2*Math.PI*r,done=x.status==='unlocked'||x.pct>=100,l=done?'Done':short(x.remaining);return `<svg class="ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--ac)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C*Math.min(x.pct,100)/100} ${C}" transform="rotate(-90 27 27)"/><text x="27" y="31" text-anchor="middle" fill="var(--tx)" font-size="12" font-weight="600">${l}</text></svg>`;}
function expiring(p,c,d,h){const B=c.ben||[],M=B.map(b=>benModel(b,d.today)),win=Number(p.expWindow);
  const open=B.map((b,i)=>({b,m:M[i],i})).filter(x=>x.m.open).sort((x,y)=>x.m.days-y.m.days||y.m.left-x.m.left);
  const L=open.filter(x=>x.m.days<=win),cap=p.expMax==='all'?L.length:Number(p.expMax),after=open.find(x=>x.m.days>win);
  const tot=L.reduce((t,x)=>t+x.m.left,0),due=x=>dt(x.m.cur.e);
  const urg=x=>x.m.days<=14?'u-hi':x.m.days<=30?'u-md':'u-lo';
  const span=x=>Math.round((Date.parse(x.m.cur.e)-Date.parse(x.m.cur.s))/864e5)+1;
  const card=(x,k)=>{const nm=h.esc(x.b.name),r=20,C=2*Math.PI*r,pc=x.m.days/span(x);
    return `<div class="sf xc xr ${urg(x)}" role="button" tabindex="0" aria-label="Mark ${nm} as used" data-xu="${x.i}" data-left="${x.m.left}" ${k>=cap?'data-xq hidden':''}><svg class="ring sm" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="${r}" fill="none" stroke="var(--line)" stroke-width="4.5"/><circle cx="25" cy="25" r="${r}" fill="none" stroke="var(--uc)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${C*pc} ${C}" transform="rotate(-90 25 25)"/><text x="25" y="29" text-anchor="middle" fill="var(--tx)" font-size="12" font-weight="600">${x.m.days}d</text></svg><span class="xb"><b>${nm}</b><small><em>${mo(x.m.left)}</em> left, by ${due(x)}</small></span><span class="xo" aria-hidden="true"><i>✓</i>${p.xoLabel==='label'?'<em>Mark used</em>':''}</span><span class="xs" hidden><span class="xs-t"><i>✓</i>Marked used</span><button type="button" class="btn sm undo">Undo</button><span class="tm" style="animation-duration:${p.undoSec}s"></span></span></div>`;};
  const nxt=n=>n?`<p class="xn">Next: <b>${h.esc(n.b.name)}</b>, ${mo(n.m.left)} by ${due(n)}</p>`:'';
  let body;
  if(!B.length)body=`<div class="sf pn"><p class="emp">No credits set up for this card.</p></div>`;
  else if(!L.length)body=`<div class="sf pn xe"><p class="emp">Nothing expires in the next ${win} days.</p>${nxt(after)}</div>`;
  else body=`<div class="xg">${L.map(card).join('')}<button type="button" class="xm" data-tob ${L.length>cap?'':'hidden'}>+<span data-xmore>${L.length-cap}</span> more in Benefits</button></div><div class="sf pn xe" data-xdone hidden><p class="emp">All caught up for the next ${win} days.</p>${nxt(after)}</div>`;
  return `<section data-region="exp" data-win="${win}"><h2>Expiring credits <span class="ct" data-xct>${L.length?`${L.length}, ${mo(tot)} in the next ${win} days`:''}</span></h2>${body}</section>`;}
function challenges(p,c,h){const A=c.challenges.filter(x=>x.status!=='expired');
  if(!A.length&&p.chEmpty==='line')return `<section data-region="ch"><div class="s-h"><h2>Active challenges</h2><button type="button" class="btn">+ Add challenge</button></div><div class="sf pn"><p class="emp">No active challenges on this card.</p></div></section>`;
  return `<section data-region="ch"><h2>Active challenges <span class="ct">${A.length}</span></h2><div class="ch-g">${A.map(x=>{const done=x.status==='unlocked'||x.pct>=100;return `<div class="sf ch"><figure>${ring(x)}<figcaption>${done?'':'to go'}</figcaption></figure><div><b>${h.esc(x.name)}</b><small>Target ${m0(x.target)}</small></div>${done?'<button type="button" class="arch">Archive</button>':''}</div>`}).join('')}<button type="button" class="ch-add" aria-label="Add a challenge"><span>+</span></button></div></section>`;}
function txFilters(p,c,d,h){const cats=[...new Set(c.txns.map(t=>t.csc).filter(Boolean))];
  const per=p.txPeriod==='own'?`<div class="und">${['Monthly','QTD','YTD','Custom'].map((x,i)=>`<button type="button" class="${i===2?'on':''}">${x}</button>`).join('')}</div>`:'';
  const search=`<input class="inp" type="search" placeholder="Search merchants" aria-label="Search merchants">`;
  if(p.txFilter==='chips')return `<div class="t-f">${per}${search}</div><div class="t-ch"><button type="button" class="chip on" data-c="">All</button>${cats.map(x=>`<button type="button" class="chip" data-c="${h.esc(x)}">${h.esc(x)}</button>`).join('')}<button type="button" class="chip warn" data-c="__none__">No bonus category (${c.noCsc})</button></div>`;
  return `<div class="t-f">${per}<select class="inp" aria-label="Bonus category"><option>All bonus categories</option>${cats.map(x=>`<option>${h.esc(x)}</option>`).join('')}<option>No bonus category (${c.noCsc})</option></select>${search}</div>`;}
const rowAct=(p,t)=>t?`<details class="ra-m"><summary aria-label="Row actions">⋯</summary><div>${t.credit?'':`<button type="button" data-lc="${t.id}">Log credit use…</button><hr>`}<button type="button">Exclude from points</button><button type="button">Set points by hand</button></div></details>`:rowAct0(p);
const rowAct0=p=>p.txActions==='hover'?'<span class="ra-h"><button type="button" class="btn sm">Exclude</button><button type="button" class="btn sm">Set points</button></span>':'<details class="ra-m"><summary aria-label="Row actions">⋯</summary><div><button type="button">Exclude from points</button><button type="button">Set points by hand</button></div></details>';
const ptsCell=(p,v)=>v<0?`<span class="neg">${p.negPts==='paren'?'('+f(-v)+')':'−'+f(-v)}</span>`:v>0?`<span class="up">+${f(v)}</span>`:'<span class="dimt">0</span>';
function transactions(p,c,d,h){const T=c.txns,csc=t=>t.csc?h.esc(t.csc):'<span class="warn-t">None</span>',key=t=>h.esc(t.csc||'__none__');let b;
  if(p.txStyle==='rows')b=`<div class="t-rows">${T.map(t=>`<div class="t-r" data-k="${key(t)}"><input type="checkbox" aria-label="Select"><div class="t-n"><b>${h.esc(t.desc)}</b><small>${dt(t.date)} · ${csc(t)} · ${t.rate}x${t.spender?` · ${h.esc(t.spender)}`:''}</small></div><div class="t-v"><b class="val">${m2(t.amt)}</b><small>${ptsCell(p,t.pts)}</small></div></div>`).join('')}</div>`;
  else if(p.txStyle==='days'){const G=new Map();T.forEach(t=>{(G.get(t.date)||G.set(t.date,[]).get(t.date)).push(t)});b=`<div class="t-rows">${[...G].map(([k,v])=>`<div class="t-d" data-day>${dty(k)}</div>${v.map(t=>`<div class="t-r" data-k="${key(t)}"><input type="checkbox" aria-label="Select"><div class="t-n"><b>${h.esc(t.desc)}</b><small>${csc(t)} · ${t.rate}x</small></div><div class="t-v"><b class="val">${m2(t.amt)}</b><small>${ptsCell(p,t.pts)}</small></div></div>`).join('')}`).join('')}</div>`;}
  else b=`<div class="t-s ${p.txLength==='scroll'?'cap':''}"><table class="t tx"><thead><tr><th></th><th>Date</th><th>Merchant</th><th>Bonus category</th>${p.txCols!=='type'?'<th>Spender</th>':''}${p.txCols!=='spender'?'<th>Type</th>':''}<th class="n">Rate</th><th class="n">Points</th><th class="n">Amount</th><th></th></tr></thead><tbody>${T.map(t=>`<tr data-k="${key(t)}" data-tid="${t.id}" class="${t.credit?'cr':''}"><td><input type="checkbox" aria-label="Select"></td><td class="nw">${dt(t.date)}</td><td class="mc"><span class="mn">${h.esc(t.desc)}</span></td><td>${csc(t)}</td>${p.txCols!=='type'?`<td>${t.spender?h.esc(t.spender):'<span class="dimt">–</span>'}</td>`:''}${p.txCols!=='spender'?`<td class="nw">${t.credit?'Credit':'Expense'}</td>`:''}<td class="n ac">${t.rate}x</td><td class="n">${ptsCell(p,t.pts)}</td><td class="n am">${t.credit?`<span class="up">−${m2(t.amt)}</span>`:m2(t.amt)}</td><td class="ra">${rowAct(p,t)}</td></tr>`).join('')}</tbody></table></div>${p.txLength==='more'?`<div class="t-more"><button type="button" class="btn">Show all ${c.txCount}</button></div>`:''}`;
  const sum=p.txSummary?`<div class="t-sum"><span>Spend <b>${m0(c.spendTotal)}</b></span><span>Points <b class="up">${f(c.ptsTotal)}</b></span><span class="warn-t">${c.noCsc} with no bonus category</span></div>`:'';
  const BJ={today:d.today,show:p.linkShow,modal:p.linkModal,tx:T.map(t=>({id:t.id,date:t.date,desc:t.desc,amt:t.amt,credit:!!t.credit})),ben:(c.ben||[]).map(x=>{const m=benModel(x,d.today);return {name:x.name,cad:`${mo(x.per)} ${FQ[x.freq]}`,per:x.per,freq:x.freq,match:x.match||'',merchants:x.merchants||[],P:m.P.map(q=>({l:q.l,s:q.s,e:q.e})),uses:x.uses}})};
  const modal=`<div class="mdl-bk" hidden></div><div class="mdl" role="dialog" aria-modal="true" aria-labelledby="mdl-t" hidden></div><div class="toast" role="status" hidden></div>`;
  return `<section data-region="tx"><h2>Transactions <span class="ct">${c.txCount}, latest 12 shown</span></h2><div class="sf pn">${txFilters(p,c,d,h)}${sum}${b}</div><div hidden data-bj="${h.esc(JSON.stringify(BJ))}"></div>${modal}</section>`;}
function monthly(p,c,h){if(p.mStyle==='hide'||c.monthly.length<2)return '';const mx=Math.max(...c.monthly.map(x=>x.amount),1),lbl=x=>MON[Number(x.month.slice(5))-1];
  if(p.mStyle==='slim')return `<section data-region="monthly"><h2>Monthly spending</h2><div class="sf pn m-slim">${c.monthly.map(x=>`<div title="${lbl(x)}: ${m0(x.amount)}"><i style="height:${Math.max(4,x.amount/mx*44)}px"></i><span>${lbl(x)}</span></div>`).join('')}</div></section>`;
  return `<section data-region="monthly"><h2>Monthly spending</h2><div class="sf pn m-bars">${c.monthly.map(x=>`<div><small>${short(x.amount)}</small><i style="height:${Math.max(4,x.amount/mx*90)}px"></i><span>${lbl(x)}</span></div>`).join('')}</div></section>`;}
Gallery.define({
  id:'cards-card-final2',
  name:'Cards: Card page, final',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap'],
  groups:[
   {id:'see',label:'What to preview',open:true,controls:[
    {id:'card',label:'Card (not a design choice)',type:'choice',options:[{id:'Amex Platinum 1008',label:'Amex Platinum 1008',hint:'Try ⋯ on Martha’s (Oct 2) and log the Resy credit. Walmart+ is already linked.'},{id:'Chase SP 3698',label:'Chase SP 3698',hint:'Longest earnings table; no challenges.'},{id:'Hilton Aspire 2007',label:'Hilton Aspire 2007',hint:'Has a challenge card and 2 expiring credits.'}]},
   ]},
   {id:'decided8',label:'Decided: round 8',open:false,controls:[
    {id:'linkModal',label:'“Log credit use” window',type:'choice',locked:true,options:[{id:'steps',label:'Two steps: pick from the card’s credit list, then the amount'}]},
    {id:'linkShow',label:'A linked purchase in the table',type:'choice',locked:true,options:[{id:'dot',label:'Green $ circle after the merchant'}]},
   ]},
   {id:'decided7',label:'Decided: round 7',open:false,controls:[
    {id:'xoLabel',label:'On hover',type:'choice',locked:true,options:[{id:'check',label:'Check in a circle'}]},
    {id:'undoSec',label:'Undo stays for',type:'choice',locked:true,options:[{id:'5',label:'5 seconds'}]},
   ]},
   {id:'decided6',label:'Decided: round 6',open:false,controls:[
    {id:'negPts',label:'Negative points',type:'choice',locked:true,options:[{id:'minus',label:'−14 in red'}]},
    {id:'expPlace',label:'Next to Active challenges',type:'choice',locked:true,options:[{id:'row',label:'One shared row'}]},
    {id:'expCard',label:'Expiring card',type:'choice',locked:true,options:[{id:'ring',label:'Countdown circle'}]},
    {id:'expWindow',label:'Counts as expiring',type:'choice',locked:true,options:[{id:'60',label:'Within 60 days'}]},
    {id:'expMax',label:'How many cards',type:'choice',locked:true,options:[{id:'4',label:'Up to 4, then “+ more”'}]},
    {id:'expAct',label:'Acting on a card',type:'choice',locked:true,options:[{id:'click',label:'Click the card to mark it used, with Undo'}]},
    {id:'expEmpty',label:'When nothing is expiring',type:'choice',locked:true,options:[{id:'next',label:'Say so and show the next one'}]},
   ]},
   {id:'decided5',label:'Decided: round 5',open:false,controls:[
    {id:'menuSpot',label:'Where the ⋯ circle sits',type:'choice',locked:true,options:[{id:'title',label:'Next to the card name'}]},
    {id:'benCard',label:'Benefit card',type:'choice',locked:true,options:[{id:'rows',label:'Compact list'}]},
    {id:'benOrder',label:'Order',type:'choice',locked:true,options:[{id:'due',label:'Act on first'}]},
    {id:'benEdit',label:'Editing a benefit',type:'choice',locked:true,options:[{id:'panel',label:'Side panel'}]},
    {id:'benAlert',label:'“Expires if unused” box',type:'toggle',locked:true,default:true},
    {id:'benSource',label:'Mark auto-tracked vs by hand',type:'toggle',locked:true,default:true},
   ]},
   {id:'decided4',label:'Decided: round 4',open:false,controls:[
    {id:'align',label:'What starts on the same row',type:'choice',locked:true,options:[{id:'tables',label:'Transactions and Earnings'}]},
    {id:'factsStyle',label:'Fee, limit and dates',type:'choice',locked:true,options:[{id:'header',label:'Inside the banner'}]},
    {id:'earnBar',label:'Points bars',type:'choice',locked:true,options:[{id:'beside',label:'Beside the category'}]},
   ]},
   {id:'decided1',label:'Decided: rounds 1 to 3',open:false,controls:[
    {id:'layout',label:'Columns',type:'choice',locked:true,options:[{id:'rail',label:'Main plus side column'}]},
    {id:'order',label:'Section order',type:'choice',locked:true,options:[{id:'ch',label:'Challenges, then Transactions'}]},
    {id:'sideCol',label:'Side column order',type:'choice',locked:true,options:[{id:'earn',label:'Earnings, then Benefits'}]},
    {id:'heroStyle',label:'Header style',type:'choice',locked:true,options:[{id:'banner',label:'Color banner'}]},
    {id:'utilStyle',label:'Utilization',type:'choice',locked:true,options:[{id:'bar',label:'Bar'}]},
    {id:'productPlace',label:'Change product',type:'choice',locked:true,options:[{id:'banner',label:'In the banner ⋯ menu'}]},
    {id:'earnLayout',label:'Rates and points',type:'choice',locked:true,options:[{id:'merged',label:'One table'}]},
    {id:'earnCols',label:'Earnings columns',type:'choice',locked:true,options:[{id:'spend',label:'Rate, Spend and Points'}]},
    {id:'earnSort',label:'Earnings order',type:'choice',locked:true,options:[{id:'earning',label:'Most points first'}]},
    {id:'chEmpty',label:'A card with no challenges',type:'choice',locked:true,options:[{id:'plus',label:'Dashed + card'}]},
        {id:'benSummary',label:'Totals',type:'choice',locked:true,options:[{id:'line',label:'One line'}]},
    {id:'txStyle',label:'Transaction list',type:'choice',locked:true,options:[{id:'table',label:'Full table'}]},
    {id:'txPeriod',label:'Date selector',type:'choice',locked:true,options:[{id:'own',label:'Its own selector'}]},
    {id:'txFilter',label:'Bonus category filter',type:'choice',locked:true,options:[{id:'chips',label:'Chips'}]},
    {id:'txSummary',label:'Show totals bar',type:'toggle',locked:true,default:true},
    {id:'txLength',label:'Long lists',type:'choice',locked:true,options:[{id:'more',label:'Show all button'}]},
    {id:'txCols',label:'Table columns',type:'choice',locked:true,options:[{id:'both',label:'With Spender and Type'}]},
    {id:'txActions',label:'Exclude and set points',type:'choice',locked:true,options:[{id:'menu',label:'A ⋯ menu on each row'}]},
    {id:'mStyle',label:'Monthly spending',type:'choice',locked:true,options:[{id:'hide',label:'Removed'}]},
   ]},
   {id:'decided',label:'Decided: Portfolio and Ecosystem',open:false,controls:[
    {id:'crumb',label:'Getting back',type:'choice',locked:true,options:[{id:'crumb',label:'Breadcrumb'}]},
    {id:'chDesign',label:'Challenge cards',type:'choice',locked:true,options:[{id:'ring',label:'One circle with $ to go'}]},
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',swatches:['#EEF2F7','#FFFFFF','#2563EB'],tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'current',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
   ]},
  ],
  render(p,d,h){const c=card(p,d);
    const S={exp:expiring(p,c,d,h),earn:earn(p,c,d,h),benefits:benefits(p,c,d,h),ch:challenges(p,c,h),tx:transactions(p,c,d,h),monthly:monthly(p,c,h),product:productSec(p,c,h)};
    const O=['tx','earn','benefits'],H=hero(p,c,d,h),F=factsSec(p,c,h);
    let body;
    if(p.layout==='rail'){const side=['earn','benefits'],lead=p.align==='banner'?H+F+S.ch:'';const TOP=p.expPlace==='rail'?`<div class="rail"><div class="col">${S.ch}</div><div class="col side">${S.exp}</div></div>`:`<div class="toprow tr-${p.expPlace}">${S.ch}${S.exp}</div>`;body=`${p.align==='banner'?'':H+F+TOP}<div class="rail"><div class="col">${lead}${O.filter(k=>!side.includes(k)).map(k=>S[k]).join('')}</div><div class="col side">${O.filter(k=>side.includes(k)).map(k=>S[k]).join('')}</div></div>`;}
    else if(p.layout==='tabs'){const V=[['Overview',O.filter(k=>['earn','ch','monthly','product'].includes(k))],['Benefits',['benefits']],['Transactions',['tx']]];body=`<div class="und big p-tabs">${V.map((v,i)=>`<button type="button" class="${i?'':'on'}" data-pt="${v[0]}">${v[0]}</button>`).join('')}</div>${V.map((v,i)=>`<div class="col" data-pv="${v[0]}" ${i?'hidden':''}>${v[1].map(k=>S[k]).join('')}</div>`).join('')}`;}
    else body=O.map(k=>S[k]).join('');
    return `<div class="app"><nav class="appnav"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(n=>`<button type="button" class="${n==='Cards'?'on':''}">${n}</button>`).join('')}</div></nav><div class="main">${top(p,c,h)}${body}</div></div>`;
  },
  after(root){
    const pv=root.querySelector('.app');
    const closeEd=()=>{root.querySelectorAll('[data-ef]').forEach(f=>f.hidden=true);root.querySelectorAll('.bc-v').forEach(v=>v.hidden=false);const dr=root.querySelector('.drw');if(dr){dr.hidden=true;root.querySelector('.scrim').hidden=true}};
    const openPd=(i,j)=>{const bc=root.querySelector(`[data-bc="${i}"]`);if(!bc)return;const t=bc.querySelector(`[data-pd="${i}-${j}"]`)||bc.querySelector(`[data-pd^="${i}-"]`);const was=t&&!t.hidden;bc.querySelectorAll('.pd').forEach(x=>x.hidden=true);bc.querySelectorAll('.pc,.dt').forEach(x=>x.classList.remove('sel'));if(t&&!was){t.hidden=false;bc.querySelectorAll(`[data-p="${j}"]`).forEach(x=>x.classList.add('sel'))}};
    root.querySelectorAll('.pc,.dt').forEach(b=>b.onclick=()=>openPd(b.dataset.b,b.dataset.p));
    root.querySelectorAll('[data-log]').forEach(b=>b.onclick=()=>{b.closest('details')?.removeAttribute('open');const bc=root.querySelector(`[data-bc="${b.dataset.log}"]`);const cur=bc&&(bc.querySelector('.pc.cur,.dt.cur'));openPd(b.dataset.log,cur?cur.dataset.p:'x');bc?.scrollIntoView({block:'nearest'})});
    root.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{b.closest('.pd').hidden=true;b.closest('[data-bc]').querySelectorAll('.sel').forEach(x=>x.classList.remove('sel'))});
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{b.closest('details')?.removeAttribute('open');closeEd();const i=b.dataset.edit,dr=root.querySelector('.drw');if(dr){dr.hidden=false;root.querySelector('.scrim').hidden=false;dr.querySelector(`[data-ef="${i}"]`).hidden=false;dr.style.top=Math.max(0,b.getBoundingClientRect().top-pv.getBoundingClientRect().top-120)+'px'}else{const bc=root.querySelector(`[data-bc="${i}"]`);bc.querySelector('.bc-v').hidden=true;bc.querySelectorAll('.pd').forEach(x=>x.hidden=true);bc.querySelector('[data-ef]').hidden=false}});
    root.querySelectorAll('[data-tob]').forEach(b=>b.onclick=()=>root.querySelector('section[data-region=benefits]').scrollIntoView({block:'start',behavior:'smooth'}));
    root.querySelectorAll('[data-full]').forEach(b=>b.onclick=e=>{e.stopPropagation();const c=b.closest('.xc');if(c){c.classList.add('done');b.textContent='Used ✓';b.disabled=true}});
    const sec=root.querySelector('section[data-region=exp]');
    if(sec){const win=sec.dataset.win,live=()=>[...sec.querySelectorAll('[data-xu]')].filter(c=>!c.classList.contains('gone'));
      const recount=()=>{const L=live(),vis=L.filter(c=>!c.hidden),q=L.filter(c=>c.hidden),more=sec.querySelector('[data-tob]'),ct=sec.querySelector('[data-xct]');
        const t=L.reduce((s,c)=>s+Number(c.dataset.left),0);ct.textContent=L.length?`${L.length}, $${Math.round(t*100)/100} in the next ${win} days`:'';
        if(more){more.hidden=!q.length;more.querySelector('[data-xmore]').textContent=q.length}
        const done=sec.querySelector('[data-xdone]');if(done)done.hidden=!!L.length;if(done&&!L.length)sec.querySelector('.xg').hidden=true;};
      const syncBen=(i,used)=>{const row=root.querySelector(`.bcr[data-bc="${i}"] .pill`);if(row){if(!row.dataset.o)row.dataset.o=row.outerHTML;if(used){row.className='pill d';row.textContent='Used'}else{row.outerHTML=row.dataset.o}}
        root.querySelectorAll(`.b-alert [data-log="${i}"]`).forEach(a=>a.hidden=used)};
      sec.querySelectorAll('[data-xu]').forEach(c=>{const ms=()=>Number(c.querySelector('.tm').style.animationDuration)*1000||parseFloat(c.querySelector('.tm').style.animationDuration)*1000;
        const mark=()=>{if(c.classList.contains('used'))return;c.classList.add('used');c.querySelector('.xs').hidden=false;c.setAttribute('aria-label','Marked used. Undo available.');
          c._t=setTimeout(()=>{c.classList.add('drop');setTimeout(()=>{c.classList.add('gone');c.hidden=true;syncBen(c.dataset.xu,true);const nx=live().find(x=>x.hasAttribute('data-xq')&&x.hidden);if(nx){nx.hidden=false;nx.removeAttribute('data-xq');nx.classList.add('enter')}recount()},320)},ms());};
        c.onclick=e=>{if(e.target.closest('.undo'))return;mark()};
        c.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===c){e.preventDefault();mark()}};
        c.querySelector('.undo').onclick=e=>{e.stopPropagation();clearTimeout(c._t);c.classList.remove('used');c.querySelector('.xs').hidden=true;c.setAttribute('aria-label',c.getAttribute('aria-label').replace('Marked used. Undo available.','Mark as used'));c.focus()};});}
    const bjEl=root.querySelector('[data-bj]');
    if(bjEl){const D=JSON.parse(bjEl.dataset.bj),tx=D.tx,B=D.ben,mdl=root.querySelector('.mdl'),bk=root.querySelector('.mdl-bk'),toast=root.querySelector('.toast'),app=root.querySelector('.app');
      const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],dd=x=>{const[y,m,d]=x.split('-');return MN[m-1]+' '+Number(d)};
      const money=n=>{const r=Math.round(n*100)/100;return '$'+(r%1?r.toFixed(2):r.toLocaleString('en-US'))},m2=n=>'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const days=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/864e5),T=id=>tx.find(t=>t.id==id),row=id=>root.querySelector(`tr[data-tid="${id}"]`);
      const per=(b,dt)=>b.P.find(q=>dt>=q.s&&dt<=q.e)||null,usedIn=(b,q)=>b.uses.filter(u=>u[0]>=q.s&&u[0]<=q.e).reduce((t,u)=>t+u[1],0);
      const linkedP=()=>new Set(B.flatMap(b=>b.uses.filter(u=>u[4]!=null).map(u=>u[4])));
      function show(pid,cid,bi,amt){const pr=row(pid),b=B[bi];if(!pr)return;pr.classList.add('lkd');const lbl=`${b.name} applied, ${money(amt)}`;
        pr.querySelector('.mn').insertAdjacentHTML('afterend',`<span class="lk1" title="${lbl}" aria-label="${lbl}" role="img">$</span>`);}
      B.forEach((b,bi)=>b.uses.forEach(u=>{if(u[4]!=null)show(u[4],u[3],bi,u[1])}));
      const cands=t=>B.map((b,bi)=>{const q=b.P.length?per(b,t.date):null;return {b,bi,q,left:q?Math.max(0,b.per-usedIn(b,q)):b.per}});
      let cur=null;const close=()=>{mdl.hidden=true;bk.hidden=true;cur=null};
      const place=el=>{mdl.style.top=Math.max(8,el.getBoundingClientRect().top-app.getBoundingClientRect().top-150)+'px'};
      const status=c=>c.q?(c.left>0?`${money(c.left)} left for ${c.q.l}`:`${c.q.l} already used`):(c.b.freq==='stay'?'Per stay':'Every few years');
      const opt=(c,on)=>`<label class="op"><input type="radio" name="lcb" value="${c.bi}" ${on?'checked':''}><span><b>${c.b.name}</b><small>${c.b.cad} · ${status(c)}</small></span></label>`;
      const amountHTML=(c,t)=>`<div class="ef-2"><label>Amount of the credit used<input class="inp" data-amt value="${(Math.round(Math.min(t.amt,c.left||c.b.per)*100)/100).toFixed(2)}"></label><label>Counts toward<input class="inp" value="${c.q?`${c.q.l} (${dd(c.q.s)} – ${dd(c.q.e)})`:'This use'}" readonly></label></div><p class="mut">${c.b.match?'This credit is tracked from your statement credits, so this only records which purchase it paid for. The total doesn’t change.':'This credit is logged by hand, so this amount is added to the period.'}</p>`;
      const head=(ttl,a,b,c)=>`<div class="mh"><h3 id="mdl-t">${ttl}</h3><button type="button" class="ib x" data-mx aria-label="Close">×</button></div><div class="pur"><span>${a}</span><b>${b}</b><b>${c}</b></div>`;
      const pick=()=>{const r=mdl.querySelector('input[name=lcb]:checked');return r?cur.C.find(c=>c.bi==r.value):null};
      function render(){const{t,C}=cur;let body,foot;
        if(cur.step===2){const c=cur.c;body=`<p class="stp">Step 2 of 2</p><div class="chosen"><b>${c.b.name}</b><small>${c.b.cad} · ${status(c)}</small></div>${amountHTML(c,t)}`;foot=`<button type="button" class="btn" data-back>Back</button><span><button type="button" class="btn" data-mx>Cancel</button><button type="button" class="btn pri" data-ok>Log use</button></span>`;}
        else{body=`<p class="stp">Step 1 of 2: which credit paid for this?</p><div class="ops">${C.map((c,k)=>opt(c,cur.c?c.bi===cur.c.bi:!k)).join('')}</div>`;foot=`<span></span><span><button type="button" class="btn" data-mx>Cancel</button><button type="button" class="btn pri" data-next>Next</button></span>`;}
        mdl.innerHTML=`${head('Log credit use',dd(t.date),t.desc,m2(t.amt))}<div class="mb">${body}</div><div class="mf">${foot}</div>`;
        mdl.querySelectorAll('[data-mx]').forEach(x=>x.onclick=close);
        mdl.querySelector('[data-back]')&&(mdl.querySelector('[data-back]').onclick=()=>{cur.step=1;render()});
        mdl.querySelector('[data-next]')&&(mdl.querySelector('[data-next]').onclick=()=>{cur.c=pick();if(cur.c){cur.step=2;render()}});
        mdl.querySelector('[data-ok]')&&(mdl.querySelector('[data-ok]').onclick=()=>{const c=cur.c,amt=parseFloat((mdl.querySelector('[data-amt]').value||'').replace(/[^0-9.]/g,''))||0;
          c.b.uses.push([t.date,amt,c.b.match?'link':'manual',null,t.id]);show(t.id,null,c.bi,amt);note(`${t.desc} linked to ${c.b.name}${c.q?' ('+c.q.l+')':''}`);close()});}
      function note(msg){toast.textContent='✓ '+msg;toast.style.top=mdl.style.top;toast.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>toast.hidden=true,3200)}
      root.querySelectorAll('[data-lc]').forEach(x=>x.onclick=()=>{x.closest('details')?.removeAttribute('open');const t=T(x.dataset.lc);if(linkedP().has(t.id)){note(`${t.desc} is already linked`);return}cur={t,C:cands(t),step:1,c:null};mdl.hidden=false;bk.hidden=false;place(x.closest('tr'));render()});
}
    root.querySelectorAll('[data-ecancel]').forEach(b=>b.onclick=closeEd);
    root.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>b.parentNode.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)));
    root.querySelectorAll('.arch').forEach(b=>b.onclick=()=>{b.closest('.ch').hidden=true});
    root.querySelectorAll('[data-pt]').forEach(b=>b.onclick=()=>{root.querySelectorAll('[data-pt]').forEach(x=>x.classList.toggle('on',x===b));root.querySelectorAll('[data-pv]').forEach(v=>{v.hidden=v.dataset.pv!==b.dataset.pt})});
    root.querySelectorAll('.t-ch .chip').forEach(b=>b.onclick=()=>{root.querySelectorAll('.t-ch .chip').forEach(x=>x.classList.toggle('on',x===b));root.querySelectorAll('[data-k]').forEach(r=>{r.hidden=!!b.dataset.c&&r.dataset.k!==b.dataset.c});root.querySelectorAll('[data-day]').forEach(g=>{let n=g.nextElementSibling,any=false;while(n&&n.dataset.k!==undefined){if(!n.hidden)any=true;n=n.nextElementSibling}g.hidden=!any})});
  },
  css:`
#pv{--c-radius:13px;--c-density:1.25;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density))}
#pv *{box-sizing:border-box}
#pv [hidden]{display:none!important}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#pv button:focus-visible,#pv input:focus-visible,#pv select:focus-visible,#pv summary:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv h1,#pv h2,#pv h3,#pv .val{font-family:var(--f-h)}
#pv h1{font-size:22px;font-weight:600;margin:0}
#pv h2{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);margin:0 0 var(--gap)}
#pv h3{font-size:13px;font-weight:600;margin:0 0 10px}
#pv .ct{font-weight:500;letter-spacing:0;text-transform:none;opacity:.85;margin-left:4px}
#pv .val{font-weight:500;font-variant-numeric:tabular-nums}
#pv .up{color:var(--good)}#pv .neg{color:var(--bad)}#pv .ac{color:var(--ac)}#pv .warn-t{color:var(--warn)}#pv .dimt{color:var(--tx3)}
#pv .app{display:flex;flex-direction:column;min-height:100vh}
#pv .main{width:100%;min-width:0;padding:calc(22px*var(--c-density)) calc(26px*var(--c-density));display:grid;gap:calc(26px*var(--c-density));align-content:start}
#pv .main>*,#pv section,#pv .col{min-width:0}
#pv .col{display:grid;gap:calc(26px*var(--c-density));align-content:start}
#pv .appnav{display:flex;align-items:center;gap:14px;background:var(--surface);border-bottom:1px solid var(--line);padding:8px 16px;min-width:0}
#pv .brand{display:flex;align-items:center;gap:9px;font-family:var(--f-h);font-weight:600}
#pv .brand i{font-style:normal;width:30px;height:30px;border-radius:8px;background:var(--ac);color:var(--ac-fg);display:grid;place-items:center}
#pv .nv{display:flex;overflow-x:auto;gap:2px;min-width:0}
#pv .nv button{padding:7px 10px;border-radius:8px;color:var(--tx2);font-size:13.5px;white-space:nowrap}
#pv .nv button.on{background:var(--ac-soft);color:var(--ac);font-weight:600}
#pv .hdr{display:flex;justify-content:space-between;align-items:center;gap:10px 20px;flex-wrap:wrap;padding:10px 18px}
#pv .hdr-r{display:flex;align-items:center;gap:16px}
#pv .crumbs{display:flex;gap:7px;align-items:center;font-size:13px;flex-wrap:wrap}
#pv .crumbs button{color:var(--ac)}#pv .crumbs i{font-style:normal;color:var(--tx3)}#pv .crumbs b{font-weight:600}
#pv .und{display:flex;gap:18px;flex-wrap:wrap}
#pv .und button{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12px}
#pv .und.big button{font-size:13.5px}
#pv .und button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .p-tabs{border-bottom:1px solid var(--line);gap:22px}
#pv .menu{position:relative}
#pv .menu summary{list-style:none;cursor:pointer;font-size:12px;font-weight:500;color:var(--ac);padding:5px 10px;border:1px solid var(--line);border-radius:8px}
#pv .menu summary::-webkit-details-marker{display:none}
#pv .menu div{position:absolute;right:0;top:calc(100% + 4px);z-index:5;display:grid;min-width:170px;padding:4px;background:var(--surface);border:1px solid var(--line);border-radius:9px;box-shadow:0 8px 22px rgba(15,23,42,.14)}
#pv .menu div button{text-align:left;padding:7px 9px;border-radius:6px;font-size:12.5px}
#pv .menu div button:hover{background:var(--ac-soft)}
#pv .btn{font-size:12px;font-weight:500;color:var(--ac);padding:5px 10px;border:1px solid var(--line);border-radius:8px;white-space:nowrap}
#pv .btn:hover{background:var(--ac-soft)}#pv .btn.sm{font-size:11px;padding:3px 8px}
#pv .pn{padding:calc(var(--p)*1.1)}
#pv .s-h{display:flex;justify-content:space-between;align-items:baseline;gap:6px 14px;flex-wrap:wrap}
#pv .emp{font-size:12.5px;color:var(--tx3);margin:4px 0}
#pv .bar{height:6px;border-radius:6px;background:var(--line);overflow:hidden}
#pv .bar i{display:block;height:100%;background:var(--ac);border-radius:6px}
/* Card art */
#pv .face{position:relative;aspect-ratio:1000/630;border-radius:calc(var(--c-radius)*.75);overflow:hidden;box-shadow:0 7px 12px -6px rgba(0,0,0,.45)}
#pv .face img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#pv .mask{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.78);color:#fff;font-size:12px;font-weight:700;padding:2px 6px;border-radius:5px;font-variant-numeric:tabular-nums}
#pv .h-art{flex:none;width:175px}#pv .h-art.sm{width:112px}#pv .h-art.sm .mask{font-size:10px;left:5px;bottom:5px;padding:1px 4px}#pv .h-art.lg{width:min(320px,100%)}
/* Header */
#pv .bal small{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;color:var(--tx3)}
#pv .big{font-size:32px;font-weight:600;line-height:1.05}
#pv .st{display:grid;gap:2px}#pv .st span{font-size:11px;color:var(--tx3)}#pv .st b{font-size:17px;font-weight:600}
#pv .h-ban{border-radius:calc(var(--c-radius)*1.3);padding:calc(var(--p)*1.4);color:#fff;display:grid;gap:calc(var(--gap)*1.2)}
#pv .h-ban p{margin:4px 0 0;font-size:13px;opacity:.82}
#pv .h-t{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
#pv .h-b{display:flex;flex-wrap:wrap;gap:12px calc(var(--gap)*2.4);align-items:flex-end}
#pv .h-ban .bal small,#pv .h-ban .st span{color:rgba(255,255,255,.72)}#pv .h-ban .st b{color:#fff}
#pv .h-ban .u-l,#pv .h-ban .u-text{color:rgba(255,255,255,.8)}#pv .h-ban .bar{background:rgba(255,255,255,.22)}
#pv .u{display:grid;gap:4px;width:100%}#pv .u-l{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--tx2)}#pv .u-text{font-size:12px;color:var(--tx2);width:100%}
#pv .h-st{padding:calc(var(--p)*1.1) calc(var(--p)*1.3);display:flex;flex-wrap:wrap;align-items:center;gap:var(--gap) calc(var(--gap)*2.2)}
#pv .h-nm{min-width:170px}#pv .h-nm h1{font-size:18px}#pv .h-nm p{margin:3px 0 0;font-size:12px;color:var(--tx3)}
#pv .h-sts{display:flex;flex-wrap:wrap;gap:12px calc(var(--gap)*1.6);flex:1;min-width:0}
#pv .h-fe{padding:calc(var(--p)*1.3);display:flex;flex-wrap:wrap;gap:calc(var(--gap)*2);align-items:center}
#pv .h-body{flex:1;min-width:260px;display:grid;gap:calc(var(--gap)*1.2)}
#pv .h-id{display:flex;gap:14px;align-items:center;flex-wrap:wrap}#pv .h-id p{margin:3px 0 0;font-size:12.5px;color:var(--tx3)}
#pv .lgo{display:flex;align-items:center;height:34px}#pv .logo{height:100%;width:auto;max-width:90px;object-fit:contain}
/* Facts */
#pv .f-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:var(--gap)}
#pv .f-t{padding:var(--p);display:grid;gap:3px;align-content:start}
#pv .f-t span,#pv .f-strip span,#pv .f-prod span,#pv .p-row span{font-size:11px;color:var(--tx3)}
#pv .f-t b{font-size:20px}#pv .f-t small,#pv .f-strip small,#pv .p-row small{font-size:11px;color:var(--tx3)}
#pv .link{cursor:pointer}#pv .f-t.link:hover{border-color:var(--ac)}
#pv .f-strip{display:flex;flex-wrap:wrap;gap:12px calc(var(--gap)*2.6);padding:calc(var(--p)*.9) var(--p);align-items:flex-start}
#pv .f-strip>div{display:grid;gap:2px}#pv .f-strip b{font-size:16px}
#pv .f-tiles+.prodrow{margin-top:var(--gap)}
#pv .f-prod{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-left:auto}#pv .f-prod b{font-weight:500;font-size:13px}
#pv .prodrow .f-prod{margin-left:0}
#pv .p-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}#pv .p-row>div{display:grid;gap:1px}#pv .p-row b{font-weight:500}
/* Earnings */
#pv .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:var(--gap)}
#pv .stack2{display:grid;gap:var(--gap)}
#pv .r-list>div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12.5px}#pv .r-list>div:last-child{border:0}
#pv .r-list b{color:var(--good);font-weight:600}#pv .r-list .base b{color:var(--ac)}
#pv .r-chips{display:flex;flex-wrap:wrap;gap:6px}
#pv .r-chips span{font-size:12px;padding:4px 10px;border-radius:99px;border:1px solid var(--line)}#pv .r-chips b{color:var(--good);font-weight:600}#pv .r-chips .base b{color:var(--ac)}
#pv .e-bars{display:grid;gap:11px}
#pv .e-bars>div{display:grid;grid-template-columns:minmax(90px,150px) minmax(0,1fr) 56px;gap:10px;align-items:center;font-size:12.5px;font-variant-numeric:tabular-nums}
#pv .e-bars em{font-style:normal;color:var(--ac)}#pv .e-bars b{font-weight:500;text-align:right}
#pv .t{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
#pv .t th{font-weight:500;font-size:11px;color:var(--tx3);text-align:left;padding:0 10px 8px;white-space:nowrap;border-bottom:1px solid var(--line)}
#pv .t td{padding:8px 10px;border-bottom:1px solid var(--line)}#pv .t tr:last-child td{border:0}
#pv .t th:first-child,#pv .t td:first-child{padding-left:0}#pv .t th:last-child,#pv .t td:last-child{padding-right:0}
#pv .t .n{text-align:right}#pv .t .nw{white-space:nowrap}#pv .t .dim td{color:var(--tx3)}
/* Benefits */
#pv .b-line{font-size:12.5px;color:var(--tx2);margin:calc(var(--gap)*-.4) 0 var(--gap)}
#pv .b-figs{display:flex;flex-wrap:wrap;gap:var(--gap);margin-bottom:var(--gap)}
#pv .b-figs>div{flex:1;min-width:120px;background:var(--surface);border:1px solid var(--line);border-radius:calc(var(--c-radius)*.75);padding:10px 13px;display:grid;gap:2px}#pv .b-figs span{font-size:11px;color:var(--tx3)}#pv .b-figs b{font-size:18px}
#pv .b-cards{display:grid;gap:calc(var(--gap)*.8)}
#pv .b-c{padding:var(--p);display:grid;gap:9px}
#pv .b-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}#pv .b-h b,#pv .b-n b{font-weight:500;font-size:13.5px;display:block}#pv .b-h small,#pv .b-n small{font-size:11.5px;color:var(--tx3)}
#pv .b-s{font-size:11.5px;color:var(--tx2);white-space:nowrap}
#pv .b-ft{display:flex;justify-content:space-between;align-items:center;gap:8px}
#pv .cy{display:flex;gap:4px;flex-wrap:wrap}
#pv .cy button{font-size:10.5px;font-weight:500;min-width:32px;padding:4px 0;border-radius:6px;border:1px solid var(--line);color:var(--tx3)}
#pv .cy button.on{background:color-mix(in srgb,var(--good) 14%,transparent);border-color:var(--good);color:var(--good)}
#pv .b-rows{padding-block:calc(var(--p)*.4)}
#pv .b-r{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(110px,1fr) 84px auto;gap:14px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}#pv .b-r:last-child{border:0}
#pv .b-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,215px),1fr));gap:var(--gap)}
#pv .b-tl{padding:var(--p);display:grid;gap:8px;align-content:start}#pv .b-tl>.val{font-size:20px;font-weight:600}#pv .b-tl small{font:400 11px var(--f-b);color:var(--tx3)}#pv .b-nm{font-size:12.5px;color:var(--tx2);min-height:2.6em}
/* Challenges */
#pv .ch-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr));gap:var(--gap)}
#pv .ch{position:relative;padding:var(--p);display:grid;grid-template-columns:auto minmax(0,1fr);gap:13px;align-items:center}
#pv .ch figure{margin:0;display:grid;justify-items:center;gap:3px;width:58px}#pv .ch figcaption{font-size:10px;color:var(--tx3)}
#pv .ring{width:58px;height:58px;display:block}
#pv .ch b{font-weight:500;font-size:13.5px;display:block}#pv .ch small{font-size:11.5px;color:var(--tx3)}
#pv .arch{position:absolute;top:7px;right:7px;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:600;color:var(--ac);background:var(--surface);border:1px solid var(--ac);opacity:0;transition:opacity .12s}
#pv .ch:hover .arch,#pv .arch:focus-visible{opacity:1}
#pv .ch-add{display:grid;place-items:center;min-height:96px;border-radius:var(--c-radius);color:var(--ac);border:1.5px dashed color-mix(in srgb,var(--ac) 50%,var(--line));width:100%}
#pv .ch-add:hover{background:var(--ac-soft)}#pv .ch-add span{font-size:30px;line-height:1}
/* Transactions */
#pv .t-f{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-bottom:10px}
#pv .inp{font:inherit;font-size:12px;padding:6px 9px;border-radius:8px;border:1px solid var(--line);background:var(--raised);color:var(--tx);min-width:0;max-width:100%}
#pv input.inp{flex:1 1 160px;margin-left:auto}
#pv .t-ch{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
#pv .chip{padding:4px 11px;border:1px solid var(--line);border-radius:99px;font-size:12px;color:var(--tx2)}
#pv .chip.on{background:var(--ac);color:var(--ac-fg);border-color:var(--ac);font-weight:600}
#pv .chip.warn:not(.on){color:var(--warn)}
#pv .t-sum{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:var(--tx2);padding:8px 12px;background:var(--raised);border-radius:8px;margin-bottom:10px}#pv .t-sum b{color:var(--tx);font-weight:600}#pv .t-sum b.up{color:var(--good)}
#pv .t-s{overflow-x:auto}
#pv input[type=checkbox]{accent-color:var(--ac);margin:0}
#pv .t-r{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:11px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}#pv .t-r:last-child{border:0}
#pv .t-n b{display:block;font-weight:500;font-size:13px}#pv .t-n small{font-size:11.5px;color:var(--tx3)}
#pv .t-v{text-align:right}#pv .t-v b{display:block;font-size:13.5px}#pv .t-v small{font-size:11.5px}
#pv .t-d{font-size:11px;font-weight:600;color:var(--tx3);padding:12px 0 4px;border-bottom:1px solid var(--line)}#pv .t-d:first-child{padding-top:0}
#pv .t-s.cap{max-height:340px;overflow-y:auto}
#pv .t-s.cap th{position:sticky;top:0;background:var(--surface);z-index:1}
#pv .t-more{display:flex;justify-content:center;padding-top:10px}
#pv .tx td,#pv .tx th{padding-inline:6px}
#pv .tx td{overflow-wrap:anywhere}
#pv .tx td.n,#pv .tx td.nw,#pv .tx td.ra{overflow-wrap:normal;white-space:nowrap}
#pv .ra{width:1%;white-space:nowrap;text-align:right;position:relative}
#pv .ra-h{position:absolute;right:0;top:50%;transform:translateY(-50%);display:inline-flex;gap:4px;padding:3px 0 3px 8px;background:var(--surface);opacity:0;transition:opacity .12s}
#pv .t-s:not(.cap){overflow:visible}
#pv .t-s.cap tr:nth-last-child(-n+2):not(:first-child) .ra-m div{top:auto;bottom:calc(100% + 4px)}
#pv tr:hover .ra-h,#pv .ra-h:focus-within{opacity:1}
#pv .ra-m{position:relative;display:inline-block}
#pv .ra-m summary{list-style:none;cursor:pointer;padding:0 6px;color:var(--tx3);font-weight:700}
#pv .ra-m summary::-webkit-details-marker{display:none}
#pv .ra-m div{position:absolute;right:0;top:calc(100% + 4px);z-index:5;display:grid;min-width:170px;padding:4px;background:var(--surface);border:1px solid var(--line);border-radius:9px;box-shadow:0 8px 22px rgba(15,23,42,.14)}
#pv .ra-m div button{text-align:left;padding:7px 9px;border-radius:6px;font-size:12.5px}
#pv .ra-m div button:hover{background:var(--ac-soft)}
/* Monthly */
#pv .m-bars,#pv .m-slim{display:flex;align-items:flex-end;gap:6px;overflow-x:auto}
#pv .m-bars>div,#pv .m-slim>div{flex:1;min-width:30px;display:grid;justify-items:center;gap:4px;font-size:10.5px;color:var(--tx3)}
#pv .m-bars i,#pv .m-slim i{display:block;width:100%;max-width:56px;background:var(--ac);border-radius:4px 4px 0 0}
#pv .m-slim i{max-width:26px}
/* Side column */
#pv .rail{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(280px,1fr);gap:calc(var(--gap)*2);align-items:start}
#pv .side .two{grid-template-columns:minmax(0,1fr)}#pv .side .ch-g{grid-template-columns:minmax(0,1fr)}
#pv .side .m-bars{gap:3px;overflow:visible}#pv .side .m-bars>div{min-width:0;font-size:9.5px}
#pv .side .b-h{flex-wrap:wrap}
#pv h2.in{margin-bottom:12px}
#pv .h-b:has(.st:nth-child(4)) .bal{flex-basis:100%}
#pv .e-bc{width:22%;min-width:46px;padding-inline:0!important}
#pv .e-b{height:5px}
#pv .e-c .e-b{margin-top:5px}
#pv .side .t th,#pv .side .t td{padding-inline:6px}
#pv .side .t th:first-child,#pv .side .t td:first-child{padding-left:0}#pv .side .t th:last-child,#pv .side .t td:last-child{padding-right:0}
/* Round 5: banner menu */
#pv .h-t.m-corner{flex-wrap:nowrap}#pv .h-t.m-corner>div:first-child{flex:1;min-width:0}
#pv .h-ti{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
#pv .cmenu{position:relative;flex:none}
#pv .cmenu summary{list-style:none;cursor:pointer;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-size:18px;font-weight:700;line-height:1;color:#fff;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.38)}
#pv .cmenu summary::-webkit-details-marker{display:none}#pv .cmenu summary:hover,#pv .cmenu[open] summary{background:rgba(255,255,255,.3)}
#pv .cmenu>div{position:absolute;right:0;top:calc(100% + 6px);z-index:6;display:grid;min-width:200px;padding:5px;background:var(--surface);color:var(--tx);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 26px rgba(15,23,42,.2)}
#pv .h-ti .cmenu>div{left:0;right:auto}
#pv .cmenu>div button{text-align:left;padding:8px 10px;border-radius:6px;font-size:13px}#pv .cmenu>div button:hover{background:var(--ac-soft)}
#pv .cmenu hr{border:0;border-top:1px solid var(--line);margin:4px 2px}
#pv .bad{color:var(--bad)!important}
/* Round 5: benefits */

#pv .b-list{display:grid;gap:calc(var(--gap)*.8)}
#pv .bgrp{display:grid;gap:calc(var(--gap)*.7)}#pv .bgrp h3{font-size:11.5px;color:var(--tx3);font-weight:600;margin:4px 0 0}
#pv .bc{padding:calc(var(--p)*.85);display:grid;gap:10px}
#pv .bc-v{display:grid;gap:10px}
#pv .bc-h{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
#pv .bc-h b,#pv .rw-n b{display:block;font-weight:500;font-size:13.5px}
#pv .bc-h small,#pv .rw-n small{font-size:11.5px;color:var(--tx3);display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}
#pv small.nt{display:block;font-style:italic;margin-top:2px}
#pv .bc-a{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}
#pv .lf{color:var(--warn)}#pv .lf b{font-weight:600}
#pv .tg{font-size:10px;font-weight:600;padding:1px 6px;border-radius:99px;border:1px solid var(--line)}
#pv .tg.auto{color:var(--ac);border-color:color-mix(in srgb,var(--ac) 35%,transparent)}#pv .tg.hand{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
#pv .ib{width:26px;height:26px;border-radius:50%;color:var(--tx3);font-size:13px;flex:none}#pv .ib:hover{background:var(--ac-soft);color:var(--ac)}
#pv .pstrip{display:grid;gap:3px}#pv .pstrip.n12{grid-template-columns:repeat(12,minmax(0,1fr))}#pv .pstrip.n4{grid-template-columns:repeat(4,1fr);gap:5px}#pv .pstrip.n2{grid-template-columns:repeat(2,1fr);gap:5px}
#pv .pc{border-radius:6px;border:1px solid var(--line);font-size:9.5px;font-weight:600;padding:5px 0;color:var(--tx3);display:grid;gap:1px;justify-items:center;min-width:0;overflow:hidden}
#pv .pstrip:not(.n12) .pc{font-size:11px;padding:6px 0}#pv .pc em{font-style:normal;font-weight:500;font-size:10.5px}
#pv .s-full{background:color-mix(in srgb,var(--good) 16%,transparent);border-color:color-mix(in srgb,var(--good) 55%,transparent);color:var(--good)}
#pv .s-part{background:color-mix(in srgb,var(--warn) 14%,transparent);border-color:color-mix(in srgb,var(--warn) 50%,transparent);color:var(--warn)}
#pv .s-miss{background:repeating-linear-gradient(135deg,transparent 0 3px,color-mix(in srgb,var(--bad) 12%,transparent) 3px 6px);border-color:color-mix(in srgb,var(--bad) 35%,transparent);color:var(--bad)}
#pv .s-open{background:var(--surface)}#pv .s-fut{opacity:.55}
#pv .cur{outline:2px solid var(--ac);outline-offset:1px}#pv .pc.sel,#pv .dt.sel{box-shadow:0 0 0 3px var(--ac-soft)}
#pv .bc-f{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
#pv .yr{font-size:11.5px;color:var(--tx3)}#pv .yr b{color:var(--tx);font-weight:600}
#pv .bc-b{display:flex;gap:6px}
#pv .btn.pri{background:var(--ac);color:var(--ac-fg);border-color:var(--ac)}#pv .btn.pri:hover{filter:brightness(1.08)}
#pv .nw-big{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}#pv .nw-big b{font-size:22px;font-weight:600}#pv .nw-big span{font-size:12px;color:var(--tx2)}
#pv .hist{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
#pv .dots{display:inline-flex;gap:3px;flex-wrap:wrap}
#pv .dt{width:11px;height:11px;border-radius:50%;padding:0;border:1px solid var(--line)}#pv .dt.cur{outline-width:1.5px}
#pv .bcrs{padding-block:calc(var(--p)*.3)}
#pv .bcr{border-bottom:1px solid var(--line)}#pv .bcr:last-child{border:0}
#pv .rw{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px 10px;align-items:center;padding:10px 0}
#pv .rw-s{display:flex;flex-direction:column;align-items:flex-end;gap:5px}
#pv .pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;white-space:nowrap}
#pv .pill.o{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}#pv .pill.d{color:var(--good);background:color-mix(in srgb,var(--good) 12%,transparent)}#pv .pill.n{color:var(--tx3);background:var(--raised)}
#pv .bcr .pd,#pv .bcr .ef{margin-bottom:10px}
#pv .pd{background:var(--raised);border-radius:9px;padding:10px 12px;display:grid;gap:8px;font-size:12px}
#pv .pd-h{display:flex;justify-content:space-between;gap:8px}#pv .pd-h span{color:var(--tx2)}
#pv .pd ul{list-style:none;margin:0;padding:0;display:grid;gap:5px}
#pv .pd li{display:grid;grid-template-columns:50px auto 1fr auto;gap:8px;align-items:baseline}#pv .pd li small{color:var(--tx3);font-size:11px}
#pv .lnk{font-size:11px;color:var(--ac)}#pv .lnk:hover{text-decoration:underline}
#pv .pd-add{display:flex;gap:6px;flex-wrap:wrap}#pv .pd-add .inp{flex:1 1 110px;margin:0}#pv .pd-add .amt{flex:0 1 80px}
#pv .pd-f{display:flex;justify-content:flex-end;gap:6px}
#pv .b-alert{border:1px solid color-mix(in srgb,var(--warn) 40%,transparent);background:color-mix(in srgb,var(--warn) 7%,var(--surface));border-radius:var(--c-radius);padding:10px 12px;display:grid;gap:2px;margin-bottom:var(--gap)}
#pv .b-alert>b{font-size:12.5px;font-weight:600;color:var(--warn);margin-bottom:4px}
#pv .al{display:grid;grid-template-columns:minmax(0,1fr) auto 62px;gap:8px;text-align:left;font-size:12px;padding:4px 0;border-top:1px solid color-mix(in srgb,var(--warn) 18%,transparent)}
#pv .al:hover span:first-child{color:var(--ac)}#pv .al span:nth-child(2){font-weight:600}#pv .al small{color:var(--tx3);text-align:right}
#pv .lg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--tx3);margin-bottom:8px}#pv .lg span{display:inline-flex;align-items:center;gap:5px}#pv .lg i{width:12px;height:10px;border-radius:3px;border:1px solid var(--line);display:inline-block}#pv .lg i.cur{outline-width:1.5px}
#pv .ef{display:grid;gap:10px;font-size:12px}#pv .ef h3{margin:0;font-size:14px}
#pv .ef label{display:grid;gap:4px;color:var(--tx2)}#pv .ef label .inp{margin:0;width:100%}
#pv .ef-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
#pv .ef fieldset{border:0;margin:0;padding:0}#pv .ef legend{color:var(--tx2);margin-bottom:4px;padding:0}
#pv .seg{display:flex;flex-wrap:wrap;gap:4px}#pv .seg button{font-size:11.5px;padding:4px 9px;border:1px solid var(--line);border-radius:99px;color:var(--tx2)}#pv .seg button.on{background:var(--ac);border-color:var(--ac);color:var(--ac-fg);font-weight:600}
#pv .ef label.ck{display:flex;align-items:center;gap:7px}
#pv .ef-f{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}#pv .ef-f span{display:flex;gap:6px}
#pv .app{position:relative}
#pv .scrim{position:absolute;inset:0;background:rgba(15,23,42,.28);z-index:20}
#pv .drw{position:absolute;right:0;z-index:21;width:min(400px,100%);background:var(--surface);border:1px solid var(--line);border-radius:var(--c-radius) 0 0 var(--c-radius);box-shadow:-12px 0 32px rgba(15,23,42,.18);padding:calc(var(--p)*1.2)}
/* Round 6: expiring credits */
#pv .toprow{display:grid;gap:calc(var(--gap)*2);align-items:start}
#pv .tr-halves{grid-template-columns:repeat(2,minmax(0,1fr))}
#pv .tr-row{grid-template-columns:auto minmax(0,1fr)}#pv .tr-row .ch-g{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:250px}
#pv .tr-row section[data-region=ch]{max-width:560px}
#pv .xg{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,215px),1fr));gap:calc(var(--gap)*.75)}
#pv .side .xg{grid-template-columns:minmax(0,1fr)}
#pv .xc{--uc:var(--ac);position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:11px;align-items:center;padding:calc(var(--p)*.7) calc(var(--p)*.8);text-align:left;width:100%;font:inherit;color:inherit}
#pv .u-hi{--uc:var(--bad)}#pv .u-md{--uc:var(--warn)}#pv .u-lo{--uc:var(--ac)}
#pv button.xc:hover{border-color:var(--ac)}
#pv .xb{display:grid;gap:2px;min-width:0}#pv .xb b{font-weight:500;font-size:13px;line-height:1.25}
#pv .xb small{font-size:11.5px;color:var(--tx3)}#pv .xb em{font-style:normal;font-weight:600;color:var(--uc)}
#pv .ring.sm{width:46px;height:46px;display:block}
#pv .cal{width:44px;border-radius:9px;overflow:hidden;border:1px solid var(--line);display:grid;text-align:center;background:var(--surface)}
#pv .cal small{background:var(--uc);color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 0}
#pv .cal b{font-family:var(--f-h);font-size:18px;font-weight:600;padding:2px 0 3px}
#pv .xa{grid-template-columns:minmax(0,1fr) auto;border-left:4px solid var(--uc)}
#pv .xa .xv{font-size:20px;font-weight:600;color:var(--tx)}
#pv .xc.done{opacity:.6}#pv .xc.done .btn{color:var(--good);border-color:var(--good)}
#pv .xm{border:1.5px dashed var(--line);border-radius:var(--c-radius);color:var(--ac);font-size:12.5px;font-weight:500;min-height:58px}#pv .xm:hover{background:var(--ac-soft)}
#pv .xe{display:grid;gap:4px}#pv .xn{margin:0;font-size:12.5px;color:var(--tx2)}#pv .xn b{font-weight:600;color:var(--tx)}
/* Round 8: linking credits to purchases */
#pv .lk1{display:inline-grid;place-items:center;width:16px;height:16px;margin-left:6px;border-radius:50%;background:var(--good);color:#fff;font-size:10px;font-weight:700;vertical-align:1px;cursor:default}
#pv table{color:inherit;font-size:inherit}
#pv .ra-m hr{border:0;border-top:1px solid var(--line);margin:4px 2px}
#pv .tx tr.cr .mn{color:var(--tx2)}
#pv .mc{min-width:140px}#pv .mc .mn{display:inline}
#pv .hint{margin-left:8px;font-size:10.5px;font-weight:600;color:var(--ac);border:1px dashed color-mix(in srgb,var(--ac) 55%,transparent);border-radius:99px;padding:1px 7px;vertical-align:1px}
#pv .hint:hover{background:var(--ac-soft)}
#pv .lk{display:flex;align-items:center;gap:5px;width:max-content;max-width:100%;margin-top:4px;font-size:11px;font-weight:500;color:var(--good);background:color-mix(in srgb,var(--good) 10%,transparent);border-radius:99px;padding:1px 8px 1px 2px}
#pv .lk i{font-style:normal;width:15px;height:15px;border-radius:50%;display:grid;place-items:center;background:var(--good);color:#fff;font-size:9.5px;font-weight:700}
#pv .lk.cr-l{color:var(--tx2);background:var(--raised);padding-left:8px}
#pv .am s{color:var(--tx3);font-weight:400;margin-right:2px}#pv .am b{font-weight:600}#pv .lkn{display:block;font-size:10.5px;color:var(--good);white-space:nowrap}
#pv tr.pairtop td{border-bottom-style:dashed}
#pv tr.paired td{background:color-mix(in srgb,var(--good) 5%,transparent)}
#pv tr.paired td.mc{position:relative}#pv .pj{color:var(--good);font-weight:700;margin-right:6px}
#pv .mdl-bk{position:absolute;inset:0;background:rgba(15,23,42,.32);z-index:30}
#pv .mdl{position:absolute;left:50%;transform:translateX(-50%);z-index:31;width:min(470px,calc(100% - 24px));background:var(--surface);border:1px solid var(--line);border-radius:calc(var(--c-radius)*1.1);box-shadow:0 24px 60px rgba(15,23,42,.28);display:grid;font-size:12.5px}
#pv .mh{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 6px}#pv .mh h3{margin:0;font-size:15px}
#pv .ib.x{font-size:18px}
#pv .pur{display:grid;grid-template-columns:auto 1fr auto;gap:10px;margin:0 16px;padding:9px 12px;background:var(--raised);border-radius:9px;font-size:12.5px}#pv .pur span{color:var(--tx3)}#pv .pur b{font-weight:600}
#pv .mb{padding:12px 16px;display:grid;gap:10px;max-height:420px;overflow-y:auto}
#pv .mf{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--line)}#pv .mf span{display:flex;gap:6px}
#pv .ops{display:grid;gap:5px}
#pv .og{margin:4px 0 0;font-size:11px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em}
#pv .op{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;padding:9px 11px;border:1px solid var(--line);border-radius:9px;cursor:pointer}
#pv .op:has(input:checked){border-color:var(--ac);background:var(--ac-soft)}#pv .op input{margin-top:2px;accent-color:var(--ac)}
#pv .op span{display:grid;gap:2px}#pv .op b{font-weight:500}#pv .op small{color:var(--tx3);font-size:11.5px}
#pv .op.dis{opacity:.5;cursor:default}
#pv .why{font-style:normal;font-size:11.5px;color:var(--good);font-weight:500}
#pv .att{display:grid;gap:3px;padding:10px 12px;border-radius:9px;background:color-mix(in srgb,var(--good) 9%,transparent);border:1px solid color-mix(in srgb,var(--good) 30%,transparent)}#pv .att b{color:var(--good);font-weight:600}#pv .att span{color:var(--tx2);font-size:12px}
#pv .mut{margin:0;font-size:11.5px;color:var(--tx3)}
#pv .mb .ef-2 label{display:grid;gap:4px;color:var(--tx2);font-size:12px}#pv .mb .ef-2 .inp{width:100%;margin:0}
#pv .sug{display:grid;gap:3px;padding:12px;border:1px solid var(--ac);background:var(--ac-soft);border-radius:10px}#pv .sug b{font-size:14px;font-weight:600}#pv .sug small{color:var(--tx2)}#pv .sug .tg{justify-self:start}
#pv .stp{margin:0;font-size:11.5px;color:var(--tx3);font-weight:600}
#pv .chosen{display:grid;gap:2px;padding:9px 12px;border-radius:9px;background:var(--raised)}#pv .chosen b{font-weight:600}#pv .chosen small{color:var(--tx3)}
#pv .bs{display:grid;gap:4px;color:var(--tx2)}#pv .bs .inp{width:100%;margin:0}
#pv .toast{position:absolute;left:50%;transform:translateX(-50%);z-index:32;background:#0F172A;color:#fff;font-size:12.5px;font-weight:500;padding:9px 14px;border-radius:9px;box-shadow:0 10px 26px rgba(15,23,42,.3)}
#pv .lkp{color:var(--tx)}
/* One height for challenge and expiring cards */
#pv{--tile-h:calc(var(--p)*2 + 78px)}
#pv .ch,#pv .ch-add,#pv .xc,#pv .xm{min-height:var(--tile-h)}
#pv .xc{padding-block:var(--p)}
/* Round 7: mark used with undo */
#pv .xc[data-xu]{cursor:pointer;overflow:hidden;transition:opacity .3s,transform .3s}
#pv .xo{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:3px;background:color-mix(in srgb,var(--surface) 72%,transparent);backdrop-filter:blur(1.5px);opacity:0;transition:opacity .15s;pointer-events:none}
#pv .xo i,#pv .xs-t i{font-style:normal;display:grid;place-items:center;border-radius:50%;color:var(--good);font-weight:700}
#pv .xo i{width:40px;height:40px;border:2.5px solid var(--good);background:var(--surface);font-size:20px;box-shadow:0 4px 12px rgba(15,23,42,.12)}
#pv .xo em{font-style:normal;font-size:11.5px;font-weight:600;color:var(--good)}
#pv .xc[data-xu]:hover .xo,#pv .xc[data-xu]:focus-visible .xo{opacity:1}
#pv .xc.used .xo{opacity:0!important}
#pv .xc.used>svg,#pv .xc.used>.xb{opacity:.18}
#pv .xs{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 calc(var(--p)*.8);background:color-mix(in srgb,var(--good) 9%,var(--surface))}
#pv .xs-t{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--good)}
#pv .xs-t i{width:24px;height:24px;background:var(--good);color:#fff;font-size:13px}
#pv .tm{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--good);transform-origin:left;animation:xtm linear forwards}
@keyframes xtm{from{transform:scaleX(1)}to{transform:scaleX(0)}}
#pv .xc.drop{opacity:0;transform:scale(.94)}
#pv .xc.enter{animation:xin .35s ease-out}
@keyframes xin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@container pv (max-width:760px){
  #pv .tr-halves,#pv .tr-row{grid-template-columns:minmax(0,1fr)}
  #pv .rail{grid-template-columns:minmax(0,1fr)}
  #pv .b-r{grid-template-columns:minmax(0,1fr) auto}
}
`
});
})();
