// Design gallery spec for the Cards module's Ecosystem page (for example Hilton Honors).
// Content comes from the data file; this file holds no personal figures.
(function(){
const ICONS={home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',tx:'<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/>',trend:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>',cal:'<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="3" x2="21" y1="10" y2="10"/>',cash:'<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/>',bank:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/>',star:'<polygon points="12 2 15 8 22 9 17 14 18 21 12 18 6 21 7 14 2 9 9 8"/>',card:'<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',wallet:'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'};
const NAV=[['Dashboard','home'],['Transactions','tx'],['Budgets','target'],['Net Worth','trend'],['Daily Balances','cal'],['Cash Flow','cash'],['Loans','bank'],['GCB','star'],['Cards','card'],['Accounts','wallet'],['Settings','gear']];
const icon=n=>`<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const dark=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'var(--ac-d)','--ac-fg':'#06122a','--ac-soft':'color-mix(in srgb,var(--ac-d) 16%,transparent)','--good':'#34D399','--warn':'#FBBF24','--bad':'#F87171','--plate':'#fff'});
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'var(--ac-l)','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,var(--ac-l) 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C','--plate':'#fff'});
const MODE={navy:'dark',graphite:'dark',cloud:'light',paper:'light'};
const GRAD={Chase:'#1e40af,#0f2a5f',Amex:'#0a2f6b,#2563eb',Citi:'#155e75,#0c4a5e',Marriott:'#78350f,#451a03',Hilton:'#4c1d95,#2e1065',United:'#374151,#111827',Delta:'#1e3a5f,#0f172a',Hyatt:'#7f1d1d,#450a0a',Capital:'#991b1b,#450a0a',Bilt:'#14532d,#052e16',Atmos:'#065f46,#022c22',AA:'#334155,#0f172a',Cash:'#b45309,#78350f',Discover:'#9a3412,#7c2d12'};
const grad=eco=>{const k=Object.keys(GRAD).find(k=>(eco||'').startsWith(k));return k?GRAD[k]:'#374151,#1f2937'};


const f=n=>Math.round(n||0).toLocaleString('en-US');
const SAMPLE={redemptions:[{d:'Sample: 2 nights, resort stay',date:'Sep 12, 2026',pts:95000,cash:640},{d:'Sample: Airline award flight',date:'Jun 3, 2026',pts:40000,cash:520}],
  transfers:[{d:'Sample: To a partner program',date:'Aug 20, 2026',sent:20000,got:26000,note:'ratio 1, +30% bonus',dir:'out'},{d:'Sample: From a partner program',date:'May 2, 2026',sent:10000,got:10000,note:'ratio 1',dir:'in'}],
  adjustments:[{d:'Sample: Issuer goodwill credit',date:'Jul 8, 2026',delta:500}],between:[{d:'Sample: Omer to Daniella',date:'Apr 18, 2026',pts:5000}]};
const prog=(p,d)=>d.programs[p.program];
function nav(picks){
  const items=NAV.map(([l,i])=>`<button type="button" class="${l==='Cards'?'on':''}" title="${l}">${icon(i)}<span>${l}</span></button>`).join('');
  return `<nav class="appnav" data-region="menus"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${items}</div></nav>`;
}
function eLogo(e,h){const src=e.logo?h.img(`logo_${e.logo}_light`):'';return src?`<span class="lg"><img src="${src}" alt="${h.esc(e.name)}"></span>`:`<span class="mono"><i>${h.esc(e.name[0])}</i><span>${h.esc(e.name)}</span></span>`;}
function fan(e,h){const cs=e.cards.slice(0,3),more=e.cards.length-3;return `<div class="fan">${cs.map(c=>{const a=h.img('card_'+c.key);return `<span class="fc" style="background:linear-gradient(135deg,${grad(e.name)})">${a?`<img src="${a}" alt="">`:''}</span>`}).join('')}${more>0?`<span class="fc more">+${more}</span>`:''}</div>`;}
function pendingBit(e,picks){if(e.isCash||!(e.pending>0))return '';const n=f(e.pending);
  if(picks.pendStyle==='pill')return `<span class="p-pill">${n} pending</span>`;
  if(picks.pendStyle==='stat')return '';
  return `<div class="p-line"><i></i>${n} pending, posts after next statement close</div>`;}
function hero(picks,d,h){const e=prog(picks,d),big=e.isCash?`$${(e.cash||0).toFixed(2)}`:f(e.balance),lab=e.isCash?'Cash back earned':'Current balance, posted';
  const earned=e.isCash?`$${(e.earned||0).toFixed(2)}`:`+${f(e.earned)}`;const sub=e.isCash?'All cash back cards':`${e.cards.length} card${e.cards.length===1?'':'s'} linked, ${h.esc(e.currency)}`;
  const fanH=picks.heroFan?fan(e,h):'';
  const stat=!e.isCash&&picks.pendStyle==='stat'&&(e.pending>0||picks.pendZero==='show')?`<div class="h-st"><span>Pending</span><b class="val pend">${f(e.pending)}</b></div>`:'';
  const earnedSt=`<div class="h-st"><span>Earned ${d.period}</span><b class="val up">${earned}</b></div>`;
  if(picks.heroStyle==='banner')return `<section data-region="hero" class="h-ban" style="background:linear-gradient(135deg,${grad(e.name)})"><div class="h-top"><div class="h-id"><span class="h-plate">${eLogo(e,h)}</span><div><b>${h.esc(e.name)}</b><small>${sub}</small></div></div>${fanH}</div><div class="h-bot"><div><small class="h-lab">${lab}</small><div class="val h-big">${big}${picks.pendStyle==='pill'?pendingBit(e,picks):''}</div>${picks.pendStyle==='line'?pendingBit(e,picks):''}</div><div class="h-sts">${stat}${earnedSt}</div></div></section>`;
  const people=!e.isCash&&e.buckets&&picks.stripPeople==='show'?e.people.map(p=>`<div class="h-st"><span>${h.esc(p)}</span><b class="val">${f(e.buckets[p].current_balance)}</b></div>`).join(''):'';
  if(picks.heroStyle==='split')return `<section data-region="hero" class="h-split sf"><div class="h-a"><div class="h-lgo">${eLogo(e,h)}</div><small>${sub}</small></div><div class="h-b"><small class="h-lab">${lab}</small><div class="val h-big">${big}${picks.pendStyle==='pill'?pendingBit(e,picks):''}</div>${picks.pendStyle==='line'?pendingBit(e,picks):''}</div><div class="h-sts">${people}${stat}${earnedSt}</div>${fanH}</section>`;
  return `<section data-region="hero" class="h-plain sf"><div class="h-top"><div class="h-lgo">${eLogo(e,h)}</div>${fanH}</div><small class="h-sub">${sub}</small><div class="h-bot"><div><small class="h-lab">${lab}</small><div class="val h-big">${big}${picks.pendStyle==='pill'?pendingBit(e,picks):''}</div>${picks.pendStyle==='line'?pendingBit(e,picks):''}</div><div class="h-sts">${stat}${earnedSt}</div></div></section>`;
}
function ledgerRows(e,picks){const b=e.buckets,all=Object.keys(b),sum=g=>all.reduce((s,p)=>s+g(b[p]),0);
  const R=[['Earned',x=>x.earned_since_baseline,'+'],['Pending, not yet posted',x=>-(x.pending_since_baseline||0),'-'],['Redeemed',x=>-x.redeemed_since_baseline,'-'],['Transferred out',x=>-x.transferred_out_since_baseline,'-'],['Transferred in',x=>x.transferred_in_since_baseline,'+'],['Adjusted',x=>x.adjusted_since_baseline,'+'],['Sent to other',x=>-(x.person_transfer_out_since_baseline||0),'-'],['Received from other',x=>x.person_transfer_in_since_baseline||0,'+']];
  return R.filter(r=>!picks.hideZero||Math.abs(sum(r[1]))>=.5).map(r=>({label:r[0],get:r[1],sum:sum(r[1])}));}
const sg=v=>(v>0?'+':v<0?'−':'')+f(Math.abs(v));const cl=v=>v>0?'up':v<0?'neg':'mut';
function ledgerActions(e,p,picks,h){const s=e.buckets[p]||{};
  if(picks.ledgerActions==='menu')return `<details class="kebab"><summary aria-label="Balance actions for ${h.esc(p)}">⋯</summary><div><button type="button">${s.balance_as_of?'Edit':'Set'} starting balance</button><button type="button">Add correction</button></div></details>`;return '';}
function ledger(picks,d,h){const e=prog(picks,d);if(e.isCash||!e.buckets)return '';const b=e.buckets,ppl=e.people,all=Object.keys(b),rows=ledgerRows(e,picks),tot=picks.sharedName==='total'?'Total':'Shared';
  const sum=g=>all.reduce((s,p)=>s+g(b[p]),0);let body;
  const legacy=b.Shared&&(b.Shared.starting_balance||0)>0?`<p class="leg">${f(b.Shared.starting_balance)} of the starting balance has no person assigned (as of ${h.esc(b.Shared.balance_as_of||'')}). It counts in ${tot} only.</p>`:'';
  if(picks.ledgerStyle==='table')body=`<div class="l-scroll"><table class="l-t"><thead><tr><th></th>${ppl.map(p=>`<th>${h.esc(p)}${ledgerActions(e,p,picks,h)}</th>`).join('')}<th class="tt">${tot}</th></tr></thead><tbody><tr class="ls"><td>Starting balance</td>${ppl.map(p=>`<td>${f(b[p].starting_balance)}<small>${b[p].balance_as_of?'as of '+h.esc(b[p].balance_as_of):'not set'}</small></td>`).join('')}<td class="tt">${f(sum(x=>x.starting_balance))}</td></tr>${rows.map(r=>`<tr><td class="rl">${r.label}</td>${ppl.map(p=>{const v=r.get(b[p]);return `<td class="${cl(v)}">${sg(v)}</td>`}).join('')}<td class="tt ${cl(r.sum)}">${sg(r.sum)}</td></tr>`).join('')}<tr class="cu"><td>Current balance</td>${ppl.map(p=>`<td>${f(b[p].current_balance)}</td>`).join('')}<td class="tt">${f(sum(x=>x.current_balance))}</td></tr></tbody></table></div>`;
  else if(picks.ledgerStyle==='people')body=(()=>{const P=`${ppl.map(p=>`<div class="l-p"><div class="l-ph"><b>${h.esc(p)}</b>${ledgerActions(e,p,picks,h)}</div><div class="val l-cur">${f(b[p].current_balance)}</div><dl><dt>Starting balance</dt><dd>${f(b[p].starting_balance)}</dd>${rows.map(r=>{const v=r.get(b[p]);return `<dt>${r.label}</dt><dd class="${cl(v)}">${sg(v)}</dd>`}).join('')}</dl></div>`).join('')}`,T=`<div class="l-p tot"><div class="l-ph"><b>${tot}</b></div><div class="val l-cur">${f(sum(x=>x.current_balance))}</div><dl><dt>Starting balance</dt><dd>${f(sum(x=>x.starting_balance))}</dd>${rows.map(r=>`<dt>${r.label}</dt><dd class="${cl(r.sum)}">${sg(r.sum)}</dd>`).join('')}</dl></div>`;return `<div class="l-people">${picks.totalPos==='first'?T+P:P+T}</div>`})();
  else{const max=Math.max(1,...all.map(p=>Math.abs(b[p].current_balance)),sum(x=>x.current_balance));const totV=sum(x=>x.current_balance),L=[...ppl];
    body=`<div class="l-flow">${L.map(p=>{const pc=Math.max(0,b[p].current_balance)/Math.max(1,totV)*100;return `<div class="lf"><div class="lf-h"><b>${h.esc(p)}</b>${ledgerActions(e,p,picks,h)}<span class="val">${f(b[p].current_balance)}</span></div><div class="lf-bar"><i style="width:${pc}%"></i></div><div class="lf-m"><span>Start ${f(b[p].starting_balance)}</span>${rows.map(r=>{const v=r.get(b[p]);return Math.abs(v)>=.5?`<span class="${cl(v)}">${r.label} ${sg(v)}</span>`:''}).join('')}</div></div>`}).join('')}<div class="lf tot"><div class="lf-h"><b>${tot}</b><span class="val">${f(totV)}</span></div></div></div>`;}
  const acts=picks.ledgerActions==='inline'?`<div class="l-acts">${ppl.map(p=>`<div><b>${h.esc(p)}</b><button type="button" class="btn-g">${b[p].balance_as_of?'Edit':'Set'} starting balance</button></div>`).join('')}</div>`:'';
  return `<section data-region="ledger"><div class="s-head"><h2>Balance ledger</h2>${ppl.length>1?'<button type="button" class="btn-g">+ Transfer between us</button>':''}</div><div class="sf pn">${body}${legacy}${acts}</div></section>`;}
function cats(picks,d,h){const e=prog(picks,d);if(!e.cats.length)return '';const v=c=>e.isCash?`$${(c.points*.01).toFixed(2)}`:f(c.points),max=e.cats[0].points||1;let b;
  if(picks.catStyle==='donut'){let a=0;const seg=e.cats.map((c,i)=>{const s=a;a+=c.pct;return `color-mix(in srgb,var(--ac) ${Math.max(18,100-i*17)}%,var(--surface)) ${s}% ${a}%`}).join(',');
    b=`<div class="c-donut"><div class="dn" style="background:conic-gradient(${seg})"><span class="val">${v({points:e.earned})}</span></div><div class="dl">${e.cats.map((c,i)=>`<div><i style="background:color-mix(in srgb,var(--ac) ${Math.max(18,100-i*17)}%,var(--surface))"></i><span>${h.esc(c.category||'Other')}</span><b>${v(c)}</b><em>${Math.round(c.pct)}%</em></div>`).join('')}</div></div>`;}
  else if(picks.catStyle==='tiles')b=`<div class="c-tiles">${e.cats.map(c=>`<div class="c-tl"><span>${h.esc(c.category||'Other')}</span><b class="val">${v(c)}</b><em>${Math.round(c.pct)}%</em></div>`).join('')}</div>`;
  else b=`<div class="c-bars">${e.cats.map(c=>`<div class="cb"><span>${h.esc(c.category||'Other')}</span><div class="bar"><i style="width:${Math.round(c.points/max*100)}%"></i></div><b>${v(c)}</b><em>${Math.round(c.pct)}%</em></div>`).join('')}</div>`;
  return `<section data-region="cats"><h2>${e.isCash?'Cash back':'Points'} by category <span class="ct">${d.period}</span></h2><div class="${picks.catStyle==='tiles'?'':'sf pn'}">${b}</div></section>`;}
function cards(picks,d,h){const e=prog(picks,d);if(!e.cards.length)return '';const pts=c=>e.isCash?`$${(c.points*.01).toFixed(2)}`:`${f(c.points)} pts`;
  const face=c=>{const a=h.img('card_'+c.key);return `<div class="c-face" style="background:linear-gradient(135deg,${grad(e.name)})"><span class="c-fb">${h.esc(c.name)}</span>${a?`<img src="${a}" alt="${h.esc(c.name)}" loading="lazy">`:''}<span class="c-mask">${h.esc(c.mask||'')}</span></div>`};
  const item=c=>`<div class="c-item">${face(c)}<div class="e-cap"><span>${h.esc(c.owner||'Unassigned')}</span><b>${pts(c)}</b></div></div>`;let b;
  if(picks.eCards==='row')b=`<div class="c-wrap"><button type="button" class="arr l" aria-label="Previous">‹</button><div class="c-scroll">${e.cards.map(item).join('')}</div><button type="button" class="arr r" aria-label="Next">›</button></div>`;
  else if(picks.eCards==='list')b=`<div class="sf pn e-list">${e.cards.map(c=>`<div class="el"><div class="el-a">${face(c)}</div><div class="el-t"><b>${h.esc(c.name)}</b><span>${h.esc(c.owner||'Unassigned')}</span></div><b class="val">${pts(c)}</b><span class="chev">›</span></div>`).join('')}</div>`;
  else b=`<div class="c-wall">${e.cards.map(item).join('')}</div>`;
  return `<section data-region="ecards"><h2>Your cards <span class="ct">${e.cards.length}</span></h2>${b}</section>`;}
const short=n=>n>=1000?'$'+(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+'k':'$'+Math.round(n);
function ring(c){const r=22,C=2*Math.PI*r,done=c.status==='unlocked'||c.pct>=100,label=done?'Done':c.target?short(c.remaining):'n/a';
  return `<svg class="ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--ac)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C*Math.min(c.pct,100)/100} ${C}" transform="rotate(-90 27 27)"/><text x="27" y="31" text-anchor="middle" fill="var(--tx)" font-size="${label.length>4?10.5:12}" font-weight="600">${label}</text></svg>`;}
function challenges(picks,d,h){const e=prog(picks,d);
  const body=e.challenges.map(c=>{const done=c.status==='unlocked'||c.pct>=100;return `<div class="ch-card sf ring-c rings-left"><div class="rings"><figure>${ring(c)}<figcaption>${done?'':'to go'}</figcaption></figure></div><div class="ch-t"><b>${h.esc(c.name)}</b><span>${h.esc(c.card||'')} ${h.esc(c.mask||'')}</span><span class="ch-bonus">${h.esc(c.bonus||'')}</span></div>${done?'<button type="button" class="arch arch-corner">Archive</button>':''}</div>`}).join('');
  return `<section data-region="ch"><h2>Active challenges <span class="ct">${e.challenges.length}</span></h2><div class="ch-grid">${body}<button type="button" class="ch-add add-dashed" aria-label="Add a challenge"><span>+</span></button></div></section>`;}
function events(){const S=SAMPLE;return [...S.redemptions.map(r=>({k:'Redemption',t:r.d,date:r.date,sub:`$${r.cash.toFixed(2)} realized, ${(r.cash/r.pts*100).toFixed(2)}¢ per point`,val:-r.pts})),...S.transfers.map(t=>({k:'Transfer',t:t.d,date:t.date,sub:`${f(t.sent)} sent, ${f(t.got)} received, ${t.note}`,val:t.dir==='out'?-t.sent:t.got})),...S.adjustments.map(a=>({k:'Adjustment',t:a.d,date:a.date,sub:'Manual correction',val:a.delta})),...S.between.map(b=>({k:'Between us',t:b.d,date:b.date,sub:'Same program, net zero',val:0}))];}
function evRow(x,edit){return `<div class="ev"><div class="ev-t"><b>${x.t}</b><span>${x.date} · ${x.sub}</span></div>${x.val?`<b class="val ${cl(x.val)}">${sg(x.val)}</b>`:'<b class="val mut">±0</b>'}${edit?'<span class="ev-a"><button type="button" class="btn-g sm">Edit</button></span>':''}</div>`;}
function activity(picks,d,h){const e=prog(picks,d);if(e.isCash)return '';const ev=picks.sampleAct?events():[],empty=k=>`<p class="emp">No ${k} logged for ${h.esc(e.name)} yet.</p>`;
  const KINDS=[['Redemption','redemptions','+ Redemption'],['Transfer','transfers','+ Transfer'],['Adjustment','adjustments','+ Adjustment'],['Between us','transfers between you','+ Between us']];
  const heads=picks.addStyle==='each'&&picks.addPlace==='head'?`<span class="a-eachs">${KINDS.map(k=>`<button type="button" class="btn-g sm">${k[2]}</button>`).join('')}</span>`:'';const one=picks.addStyle==='menu'?`<details class="addm"><summary>+ Add</summary><div>${KINDS.map(k=>`<button type="button">${k[2].slice(2)}</button>`).join('')}</div></details>`:'';
  const red=ev.filter(x=>x.k==='Redemption');const rp=picks.sampleAct?SAMPLE.redemptions.reduce((s,r)=>s+r.pts,0):0,rc=picks.sampleAct?SAMPLE.redemptions.reduce((s,r)=>s+r.cash,0):0;
  const stats=picks.realized&&rp?`<div class="r-st"><div><span>Points redeemed</span><b class="val">${f(rp)}</b></div><div><span>Cash value realized</span><b class="val">$${f(rc)}</b></div><div><span>Realized ¢ per point</span><b class="val">${(rc/rp*100).toFixed(2)}¢</b></div></div>`:'';
  let b;
  if(picks.actLayout==='panels')b=`<div class="a-panels">${KINDS.map(k=>{const xs=ev.filter(x=>x.k===k[0]);return `<div class="sf pn"><div class="s-head"><h3>${k[0]==='Between us'?'Transfers between us':k[1][0].toUpperCase()+k[1].slice(1)}</h3>${picks.addStyle==='each'?`<button type="button" class="btn-g">${k[2]}</button>`:''}</div>${k[0]==='Redemption'?stats:''}${xs.length?xs.map(x=>evRow(x,true)).join(''):empty(k[1])}</div>`}).join('')}</div>`;
  else if(picks.actLayout==='tabs')b=`<div class="sf pn"><div class="a-tabs und">${KINDS.map((k,i)=>`<button type="button" class="${i?'':'on'}" data-tab="${k[0]}">${k[1]==='transfers between you'?'Between us':k[1][0].toUpperCase()+k[1].slice(1)} (${ev.filter(x=>x.k===k[0]).length})</button>`).join('')}</div>${KINDS.map((k,i)=>{const xs=ev.filter(x=>x.k===k[0]);return `<div class="a-pane" data-pane="${k[0]}" ${i?'hidden':''}>${picks.addStyle==='each'?`<div class="a-add"><button type="button" class="btn-g">${k[2]}</button></div>`:''}${k[0]==='Redemption'?stats:''}${xs.length?xs.map(x=>evRow(x,true)).join(''):empty(k[1])}</div>`}).join('')}</div>`;
  else b=`<div class="sf pn">${stats}<div class="a-chips"><button type="button" class="chip on" data-f="">All</button>${KINDS.map(k=>`<button type="button" class="chip" data-f="${k[0]}">${k[0]}</button>`).join('')}${picks.addStyle==='each'&&picks.addPlace!=='head'?`<span class="a-eachs">${KINDS.map(k=>`<button type="button" class="btn-g sm">${k[2]}</button>`).join('')}</span>`:''}</div><div class="a-feed">${ev.length?ev.map(x=>`<div data-k="${x.k}"><span class="ev-k">${x.k}</span>${evRow(x,true)}</div>`).join(''):empty('activity')}</div></div>`;
  return `<section data-region="activity"><div class="s-head"><h2>Activity${picks.sampleAct?' <span class="ct">sample rows</span>':''}</h2>${one}${heads}</div>${b}</section>`;}
function top(picks,d,h){const e=prog(picks,d),per=`<div class="period"><div class="und">${['MTD','QTD','YTD'].map(p=>`<button type="button" class="${p===d.period?'on':''}">${p}</button>`).join('')}</div><select class="yr" aria-label="Year"><option>${d.year}</option><option>${d.year-1}</option></select></div>`;
  const T=['Portfolio','Swipe Advisor','Card Management'];
  let l;if(picks.crumb==='back')l=`<button type="button" class="bk">← Portfolio</button>`;
  else if(picks.crumb==='crumb')l=`<div class="crumbs"><button type="button">Cards</button><i>›</i><button type="button">Portfolio</button><i>›</i><b>${h.esc(e.name)}</b></div>`;
  else return `<header class="hdr sf"><div class="hdr-r"><div class="und big">${T.map((t,i)=>`<button type="button" class="${i?'':'on'}">${t}</button>`).join('')}</div>${per}</div></header><button type="button" class="bk under">← Back to all programs</button>`;
  return `<header class="hdr sf"><div class="hdr-r">${l}${per}</div></header>`;}
Gallery.define({
  id:'cards-ecosystem-r2',
  name:'Cards: Ecosystem page, round 2',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap'],
  groups:[
   {id:'see',label:'What to preview',open:true,controls:[
    {id:'program',label:'Program (not a design choice)',type:'choice',options:['Hilton Honors','Chase UR','United MileagePlus','Amex MR','Cash Back'].map(n=>({id:n,label:n}))},
    {id:'sampleAct',label:'Show sample activity rows',type:'toggle',default:true},
   ]},
   {id:'hero',label:'Header',open:true,controls:[
    {id:'stripPeople',label:'Each person in the header',type:'choice',options:[
      {id:'show',label:'Show',hint:'Your pick. Their balances also lead the ledger cards just below.'},
      {id:'hide',label:'Hide',hint:'Leaves the strip to the balance, pending and earned.'},
    ]},
    {id:'pendZero',label:'Pending figure at zero',type:'choice',options:[
      {id:'hide',label:'Hide it',hint:'Matches the Portfolio tiles. Try Hilton Honors.'},
      {id:'show',label:'Show 0',hint:'The strip keeps the same shape on every program.'},
    ]},
   ]},
   {id:'ledger',label:'Balance ledger',open:true,controls:[
    {id:'totalPos',label:'Total card',type:'choice',options:[
      {id:'last',label:'After the people',hint:'Your pick.'},
      {id:'first',label:'Before the people'},
    ]},
   ]},
   {id:'activity',label:'Activity',open:true,controls:[
    {id:'addPlace',label:'Add buttons',type:'choice',options:[
      {id:'row',label:'Beside the filters',hint:'Your pick. Filters and add buttons share one row.'},
      {id:'head',label:'In the section heading',hint:'Filters get their own row, add buttons sit opposite the Activity title.'},
    ]},
   ]},
   {id:'decided',label:'Decided: round 1 and Portfolio',open:false,controls:[
    {id:'layout',label:'Columns',type:'choice',locked:true,options:[{id:'stack',label:'One column'}]},
    {id:'order',label:'Section order',type:'choice',locked:true,options:[{id:'ledger',label:'Ledger first'}]},
    {id:'crumb',label:'Getting back',type:'choice',locked:true,options:[{id:'crumb',label:'Breadcrumb'}]},
    {id:'heroStyle',label:'Header style',type:'choice',locked:true,options:[{id:'split',label:'Balance strip'}]},
    {id:'pendStyle',label:'Pending points',type:'choice',locked:true,options:[{id:'stat',label:'Its own figure'}]},
    {id:'heroFan',label:'Show card fan',type:'toggle',locked:true,default:true},
    {id:'ledgerStyle',label:'Ledger format',type:'choice',locked:true,options:[{id:'people',label:'A card per person'}]},
    {id:'hideZero',label:'Hide rows that are all zero',type:'toggle',locked:true,default:true},
    {id:'sharedName',label:'Sum column name',type:'choice',locked:true,options:[{id:'total',label:'Total'}]},
    {id:'ledgerActions',label:'Balance actions',type:'choice',locked:true,options:[{id:'inline',label:'Buttons below the ledger'}]},
    {id:'catStyle',label:'Points by category',type:'choice',locked:true,options:[{id:'bars',label:'Bars'}]},
    {id:'eCards',label:'Your cards',type:'choice',locked:true,options:[{id:'row',label:'Row with arrows'}]},
    {id:'actLayout',label:'Activity',type:'choice',locked:true,options:[{id:'feed',label:'One timeline with filters'}]},
    {id:'addStyle',label:'Adding an entry',type:'choice',locked:true,options:[{id:'each',label:'A button per type'}]},
    {id:'realized',label:'Show realized value summary',type:'toggle',locked:true,default:true},
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',swatches:['#EEF2F7','#FFFFFF','#2563EB'],tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'accent',label:'Accent',type:'choice',locked:true,options:[{id:'blue',label:'Brand blue',swatches:['#2563EB','#60A5FA'],tokens:{'--ac-l':'#2563EB','--ac-d':'#60A5FA'}}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'current',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'cardRow',label:'Card row',type:'choice',locked:true,options:[{id:'whole',label:'Whole cards only'}]},
    {id:'chDesign',label:'Challenge cards',type:'choice',locked:true,options:[{id:'ring',label:'One circle with $ to go'}]},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
    {id:'cardSize',label:'Card size',type:'slider',locked:true,min:110,max:240,step:5,default:175,unit:'px'},
   ]},
  ],
  render(picks,d,h){
    const S={ledger:ledger(picks,d,h),cats:cats(picks,d,h),cards:cards(picks,d,h),ch:challenges(picks,d,h),act:activity(picks,d,h)};
    const O={ledger:['ledger','cats','cards','ch','act'],cards:['cards','ch','ledger','cats','act'],activity:['ledger','act','cats','cards','ch']}[picks.order];
    let body;
    if(picks.layout==='rail'){const side=['cards','cats','ch'],main=O.filter(k=>!side.includes(k));body=`<div class="rail"><div class="r-main">${main.map(k=>S[k]).join('')}</div><div class="r-side">${O.filter(k=>side.includes(k)).map(k=>S[k]).join('')}</div></div>`;}
    else if(picks.layout==='tabs'){const V=[['Overview',O.filter(k=>['cards','cats','ch'].includes(k))],['Ledger',['ledger']],['Activity',['act']]].filter(v=>v[1].some(k=>S[k]));body=`<div class="p-tabs und big">${V.map((v,i)=>`<button type="button" class="${i?'':'on'}" data-pt="${v[0]}">${v[0]}</button>`).join('')}</div>${V.map((v,i)=>`<div class="p-view" data-pv="${v[0]}" ${i?'hidden':''}>${v[1].map(k=>S[k]).join('')}</div>`).join('')}`;}
    else body=O.map(k=>S[k]).join('');
    return `<div class="app">${nav({})}<div class="main">${top(picks,d,h)}${hero(picks,d,h)}${body}</div></div>`;
  },
  after(root,picks){
    root.querySelectorAll('.arch').forEach(b=>b.onclick=()=>{b.closest('.ch-card').hidden=true});
    root.querySelectorAll('[data-pt]').forEach(b=>b.onclick=()=>{root.querySelectorAll('[data-pt]').forEach(x=>x.classList.toggle('on',x===b));root.querySelectorAll('[data-pv]').forEach(v=>{v.hidden=v.dataset.pv!==b.dataset.pt});fit()});
    root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{root.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('on',x===b));root.querySelectorAll('[data-pane]').forEach(v=>{v.hidden=v.dataset.pane!==b.dataset.tab})});
    root.querySelectorAll('.a-chips .chip').forEach(b=>b.onclick=()=>{root.querySelectorAll('.a-chips .chip').forEach(x=>x.classList.toggle('on',x===b));root.querySelectorAll('.a-feed>[data-k]').forEach(r=>{r.hidden=!!b.dataset.f&&r.dataset.k!==b.dataset.f})});
    if(window.__cRO){window.__cRO.disconnect();window.__cRO=null}
    const fit=()=>{root.querySelectorAll('.c-scroll').forEach(sc=>{const w=sc.getBoundingClientRect().width;if(!w)return;const g=parseFloat(getComputedStyle(sc).columnGap)||0,n=Math.max(1,Math.floor((w+g)/(picks.cardSize+g))),iw=(w-g*(n-1))/n,items=sc.querySelectorAll('.c-item').length,extra=(n-items%n)%n;
      sc.style.setProperty('--whole-w',iw+'px');sc.dataset.page=n*(iw+g);let sp=sc.querySelector('.c-sp');if(!sp){sp=document.createElement('i');sp.className='c-sp';sc.append(sp)}sp.style.width=extra*(iw+g)-g+'px';sp.hidden=!extra;});};
    const sc0=root.querySelector('.c-scroll');if(sc0){fit();window.__cRO=new ResizeObserver(fit);window.__cRO.observe(sc0)}
    root.querySelectorAll('.c-wrap').forEach(w=>{const sc=w.querySelector('.c-scroll');w.querySelector('.l').onclick=()=>sc.scrollBy({left:-Number(sc.dataset.page),behavior:'smooth'});w.querySelector('.r').onclick=()=>sc.scrollBy({left:Number(sc.dataset.page),behavior:'smooth'});});
  },
  css:`
#pv{--c-radius:14px;--c-density:1;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density))}
#pv *{box-sizing:border-box}
#pv[data-surface=glass]{background-image:radial-gradient(circle at 12% 18%,color-mix(in srgb,var(--ac) 9%,transparent),transparent 42%),radial-gradient(circle at 88% 80%,color-mix(in srgb,var(--ac) 7%,transparent),transparent 42%)}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv[data-surface=glass] .sf{background:color-mix(in srgb,var(--surface) 62%,transparent);backdrop-filter:blur(16px);box-shadow:0 8px 28px rgba(0,0,0,.14)}
#pv[data-surface=soft] .sf{border-color:transparent;box-shadow:0 2px 14px rgba(5,12,30,.12)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#pv button:focus-visible,#pv input:focus-visible,#pv select:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv h1,#pv h2,#pv .val{font-family:var(--f-h)}
#pv h1{font-size:24px;font-weight:600;margin:0 0 6px}
#pv h2{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);margin:0 0 var(--gap)}
#pv .ct{font-weight:500;opacity:.8;margin-left:3px}
#pv .app{display:flex;min-height:100vh;min-width:0}
#pv .main{flex:1;min-width:0;padding:calc(22px*var(--c-density)) calc(26px*var(--c-density));display:grid;gap:calc(26px*var(--c-density));align-content:start}
#pv section{min-width:0}
/* Navigation */
#pv .appnav{flex:none;border-right:1px solid var(--line);background:var(--surface);padding:14px 10px;display:flex;flex-direction:column;gap:14px;position:sticky;top:0;align-self:flex-start;height:100vh}
#pv .brand{display:flex;align-items:center;gap:9px;font-family:var(--f-h);font-weight:600;padding:0 5px}
#pv .brand i{font-style:normal;width:30px;height:30px;flex:none;border-radius:8px;background:var(--ac);color:var(--ac-fg);display:grid;place-items:center}
#pv .nv{display:flex;flex-direction:column;gap:2px}
#pv .nv button{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:var(--tx2);font-size:13.5px;white-space:nowrap}
#pv .nv button.on{background:var(--ac-soft);color:var(--ac);font-weight:600}
#pv[data-nav=rail] .appnav span{display:none}
#pv[data-nav=side] .appnav{width:214px}
#pv[data-nav=top] .app{flex-direction:column}
#pv[data-nav=top] .appnav{position:static;height:auto;width:100%;flex-direction:row;align-items:center;border-right:0;border-bottom:1px solid var(--line);padding:8px 16px;align-self:stretch;min-width:0}
#pv[data-nav=top] .nv{flex-direction:row;overflow-x:auto;min-width:0}
#pv[data-nav=top] .nv svg{display:none}
#pv[data-nav=top] .nv button{padding:7px 10px}
#pv[data-nav=top] .main{width:100%}
/* Header */
#pv .hdr-r{display:flex;justify-content:space-between;align-items:center;gap:12px 20px;flex-wrap:wrap}
#pv .hdr.sf{padding:10px 18px}
#pv .und{display:flex;gap:18px}
#pv .und button{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12px}
#pv .und.big button{font-size:13px}
#pv .und button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .seg{display:inline-flex;padding:3px;background:var(--raised);border:1px solid var(--line);border-radius:9px;gap:2px;max-width:100%;overflow-x:auto}
#pv .seg button{padding:5px 11px;border-radius:6px;color:var(--tx2);font-size:12px;white-space:nowrap}
#pv .seg.big button{font-size:13px;padding:6px 13px}
#pv .seg button.on{background:var(--ac);color:var(--ac-fg);font-weight:600}
#pv .pills{display:flex;gap:7px;flex-wrap:wrap}
#pv .pills button{padding:7px 14px;border-radius:99px;border:1px solid var(--line);color:var(--tx2);font-size:13px}
#pv .pills button.on{background:var(--ac-soft);color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .period{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
#pv .yr{font:inherit;font-size:12px;padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--raised);color:var(--tx)}
#pv .rad{display:flex;gap:12px;font-size:12.5px;color:var(--tx2)}
#pv .rad label{display:flex;gap:5px;align-items:center;cursor:pointer}
#pv .rad input,#pv .sl input,#pv .checks input{accent-color:var(--ac)}
#pv .sl{width:124px}
#pv .sl input{width:100%;margin:0;display:block}
#pv .sl-l{display:flex;justify-content:space-between;font-size:10.5px;color:var(--tx3)}
#pv .sl-l .on{color:var(--ac);font-weight:600}
/* Programs */
#pv .val{font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#pv .good{color:var(--good)}
#pv .meta{display:flex;flex-wrap:wrap;gap:1px 8px;font-size:11px}
#pv .up{color:var(--good)}#pv .mut{color:var(--tx3);font-size:11px}#pv .pend{color:var(--warn)}
#pv .lg{display:flex;align-items:center;min-width:0}
#pv .lg img{height:100%;width:auto;max-width:100%;object-fit:contain;object-position:left center;display:block}
#pv .lg.plate{background:var(--plate);border-radius:calc(var(--c-radius)*.55);padding:5px 8px;border:1px solid rgba(15,23,42,.08);width:fit-content;max-width:100%}
#pv .mono{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;color:var(--tx2);min-width:0}
#pv .mono i{flex:none;font-style:normal;width:26px;height:26px;border-radius:7px;background:var(--ac-soft);color:var(--ac);display:grid;place-items:center;font-weight:600}
#pv .e-tiles,#pv .e-feature,#pv .e-wall{display:grid;gap:var(--gap)}
#pv .e-tiles{grid-template-columns:repeat(auto-fill,minmax(158px,1fr))}
#pv .e-feature{grid-template-columns:repeat(auto-fill,minmax(236px,1fr))}
#pv .e-wall{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:calc(var(--gap)*1.6) var(--gap)}
#pv .e-tile{padding:var(--p);display:flex;flex-direction:column;justify-content:space-between;gap:12px;min-width:0}
#pv .e-tile .lg{height:38px}#pv .e-tile .lg.plate{height:40px}
#pv .e-tile .val{font-size:21px;display:block}
#pv .e-b{display:grid;gap:3px}
#pv .e-feature .e-tile{padding:calc(var(--p)*1.25);gap:18px}
#pv .e-feature .lg{height:52px}#pv .e-feature .lg.plate{height:54px}
#pv .e-feature .val{font-size:30px}
#pv .e-wall .e-tile{padding:0;align-items:center;text-align:center}
#pv .e-wall .meta{justify-content:center}
#pv .e-wall .lg{height:42px;justify-content:center}
#pv .e-wall .lg img{object-position:center}
#pv .e-wall .val{font-size:18px}
#pv .e-rows{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,430px),1fr));gap:calc(var(--gap)*.6) var(--gap)}
#pv .e-row{display:grid;grid-template-columns:82px minmax(0,1fr) auto auto 12px;align-items:center;gap:12px;padding:calc(var(--p)*.6) var(--p)}
#pv .e-row .lg{height:28px}#pv .e-row .lg.plate{height:32px;padding:3px 5px}
#pv .e-row .mono span{display:none}
#pv .e-row .nm{font-size:13px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .e-row .val{font-size:16px;text-align:right}
#pv .e-row .meta{width:104px;justify-content:flex-end;text-align:right}
#pv .chev{color:var(--tx3)}
#pv .cash{display:flex;align-items:center;gap:14px;padding:var(--p);margin-top:var(--gap)}
#pv .cb-chip{width:42px;height:28px;border-radius:7px;background:linear-gradient(135deg,#b45309,#d97706);flex:none}
#pv .cash .nm{flex:1;min-width:0}#pv .cash small{display:block;color:var(--tx3);font-size:11px}
#pv .cash .val{font-size:23px}
/* Cards */
#pv .s-head{display:flex;justify-content:space-between;align-items:baseline;gap:6px 14px;flex-wrap:wrap}
#pv .own{display:flex;gap:6px 12px;flex-wrap:wrap;align-items:center;margin-bottom:var(--gap);font-size:12.5px;color:var(--tx2)}
#pv .own.chips{gap:6px}
#pv .chip{padding:4px 11px;border:1px solid var(--line)!important;border-radius:99px;font-size:12px;color:var(--tx2)}
#pv .chip.on{background:var(--ac);color:var(--ac-fg);border-color:var(--ac)!important;font-weight:600}
#pv .checks label{display:flex;gap:5px;align-items:center;cursor:pointer}
#pv .c-scroll{display:flex;gap:var(--gap);overflow-x:auto;padding:4px 2px 10px;min-width:0;scrollbar-width:thin}
#pv .c-item{flex:none;width:var(--c-cardSize,180px);max-width:100%}
#pv .c-item[hidden]{display:none}
#pv .c-face{position:relative;aspect-ratio:1000/630;border-radius:calc(var(--c-radius)*.75);overflow:hidden;box-shadow:0 5px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
#pv .c-face img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#pv .c-fb{font-size:11.5px;font-weight:600;color:rgba(255,255,255,.9);text-align:center;padding:0 10px}
#pv .c-mask{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.78);color:#fff;font-size:12px;font-weight:700;padding:2px 6px;border-radius:5px;font-variant-numeric:tabular-nums}
#pv .c-face.hov .c-mask{opacity:0;transition:opacity .15s}
#pv .c-face.hov:hover .c-mask{opacity:1}
@media (hover:none){#pv .c-face.hov .c-mask{opacity:1}}
#pv .c-cap{padding-top:6px;display:grid;font-size:11.5px;color:var(--tx3)}
#pv .c-cap b{font-weight:500;color:var(--tx);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .c-wrap{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) 34px;gap:6px;align-items:center}
#pv .arr{height:34px;width:34px;border-radius:50%;border:1px solid var(--line)!important;background:var(--surface)!important;font-size:19px!important;line-height:1}
#pv .c-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--c-cardSize,180px)),1fr));gap:var(--gap)}
#pv .c-wall .c-item{width:auto}
#pv .c-groups{display:flex;flex-wrap:wrap;gap:calc(var(--gap)*1.5) calc(var(--gap)*2.4)}
#pv .c-group[hidden]{display:none}
#pv .gl{font-size:12px;font-weight:500;color:var(--tx2);margin-bottom:7px}#pv .gl span{color:var(--tx3);margin-left:3px}
#pv .c-fan{display:flex;padding-right:8px}
#pv .c-fan .c-item{width:calc(var(--c-cardSize,180px)*.72);transition:transform .15s}
#pv .c-fan .c-item:not(:first-child){margin-left:calc(var(--c-cardSize,180px)*-.48)}
#pv .c-fan .c-item:hover{transform:translateY(-5px);z-index:3}
#pv[data-cardLabel=caption] .c-fan .c-item:not(:first-child){margin-left:8px}
/* Challenges */
#pv .ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr));gap:var(--gap)}
#pv .ch-h{display:flex;gap:var(--gap);overflow-x:auto;padding-bottom:10px;scrollbar-width:thin}
#pv .ch-h>*{flex:none;width:min(290px,85%)}
#pv .ch-card{padding:var(--p);display:grid;gap:7px;align-content:start;min-width:0}
#pv .ch-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
#pv .ch-top b,#pv .ch-t b{font-weight:500;font-size:13.5px}
#pv .ch-t{display:grid;gap:2px;min-width:0}
#pv .ch-t>span{font-size:11.5px;color:var(--tx3)}
#pv .ch-t>span.ch-bonus{color:var(--ac);font-weight:500}
#pv .ch-bonus{color:var(--ac);font-size:12px;font-weight:500}
#pv .st{flex:none;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:99px;background:var(--ac-soft);color:var(--ac)}
#pv .st.unlocked{background:color-mix(in srgb,var(--good) 15%,transparent);color:var(--good)}
#pv .bar{height:6px;border-radius:6px;background:var(--line);overflow:hidden}
#pv .bar i{display:block;height:100%;background:var(--ac);border-radius:6px}
#pv .ch-n{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--tx2);font-variant-numeric:tabular-nums}
#pv .ring-c{grid-template-columns:54px minmax(0,1fr);gap:13px;align-items:center}
#pv .art-c{grid-template-columns:92px minmax(0,1fr);gap:13px;align-items:start}
#pv .ch-art{aspect-ratio:1000/630;border-radius:calc(var(--c-radius)*.45);overflow:hidden}
#pv .ch-art img{width:100%;height:100%;object-fit:cover;display:block}
#pv .ch-body{display:grid;gap:6px;min-width:0}
#pv .ch-list{padding:calc(var(--p)*.3) var(--p)}
#pv .ch-row{display:grid;grid-template-columns:minmax(150px,1.6fr) minmax(80px,.8fr) minmax(70px,1fr) 38px 72px;gap:14px;align-items:center;padding:calc(10px*var(--c-density)) 0;border-bottom:1px solid var(--line)}
#pv .ch-row:last-child{border:0}
#pv .ch-pct{text-align:right;font-size:12px;font-variant-numeric:tabular-nums}
#pv .ch-row .st{justify-self:end}

/* Round 2 */
#pv[data-cardRow=whole] .c-scroll{scroll-snap-type:x mandatory;padding-inline:0;scrollbar-width:none}
#pv[data-cardRow=whole] .c-item{width:var(--whole-w,var(--c-cardSize));scroll-snap-align:start}
#pv[data-cardRow=whole] .c-face{box-shadow:0 7px 9px -6px rgba(0,0,0,.4)}
#pv .c-sp{flex:none;display:block;height:1px}
#pv .c-sp[hidden]{display:none}
#pv .ch-archived{margin-top:var(--gap);font-size:13px;color:var(--tx2,var(--tx3))}
#pv .ch-archived summary{cursor:pointer;margin-bottom:10px}
#pv .ch-archived .ch-card{opacity:.75}
#pv[data-cardRow=fade] .c-scroll{-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent);padding-right:60px;scrollbar-width:none}
#pv .ring-c{position:relative}
#pv .ring-c[hidden]{display:none}
#pv .rings{display:flex;gap:10px}
#pv .rings figure{margin:0;display:grid;justify-items:center;gap:3px;width:58px}
#pv .rings figcaption{font-size:10px;color:var(--tx3)}
#pv .ring{width:58px;height:58px;display:block}
#pv .ring-c.rings-left{grid-template-columns:auto minmax(0,1fr);align-items:center}
#pv .ring-c.rings-right{grid-template-columns:minmax(0,1fr) auto;align-items:center}
#pv .ring-c.rings-right .rings{order:2}
#pv .ring-c.rings-below{grid-template-columns:minmax(0,1fr)}
#pv .ring-c.rings-below .rings{order:2;gap:18px;margin-top:4px}
#pv .ring-c.rings-below .rings figure{width:76px}
#pv .ring-c.rings-below .ring{width:76px;height:76px}
#pv .arch{position:absolute;font-size:11.5px;font-weight:600;color:var(--ac);background:var(--surface);border:1px solid var(--ac);opacity:0;transition:opacity .12s}
#pv .ring-c:hover .arch,#pv .arch:focus-visible{opacity:1}
@media (hover:none){#pv .arch{opacity:1}}
#pv .arch-corner{top:7px;right:7px;padding:3px 9px;border-radius:99px}
#pv .arch-bar{left:-1px;right:-1px;bottom:-1px;padding:6px;border-radius:0 0 var(--c-radius) var(--c-radius)}
#pv .ch-add{display:flex;flex-direction:column;gap:3px;align-items:center;justify-content:center;min-height:96px;border-radius:var(--c-radius);color:var(--ac)!important;width:100%}
#pv .add-dashed,#pv .add-labeled{border:1.5px dashed color-mix(in srgb,var(--ac) 50%,var(--line))!important}
#pv .ch-add:hover{background:var(--ac-soft)!important}
#pv .ch-add span{font-size:30px;line-height:1;font-weight:400}
#pv .ch-add em{font-style:normal;font-size:12.5px;font-weight:500}
/* Narrow preview */
@container pv (max-width:760px){
  #pv .app{flex-direction:column}
  #pv .appnav,#pv[data-nav=side] .appnav,#pv[data-nav=rail] .appnav{position:static;height:auto;width:100%;flex-direction:row;align-items:center;border-right:0;border-bottom:1px solid var(--line);padding:8px 12px;min-width:0;align-self:stretch}
  #pv .brand span{display:none}
  #pv .nv{flex-direction:row;overflow-x:auto;min-width:0}
  #pv .nv button span{display:none}
  #pv .nv button.on span{display:inline}
  #pv[data-nav=top] .nv svg{display:block}
  #pv .main{padding:16px;width:100%}
  #pv .e-row{grid-template-columns:62px minmax(0,1fr) auto 10px}
  #pv .e-row .nm{display:none}
  #pv .e-row .val{grid-column:2;text-align:left}
  #pv .e-row .meta{grid-column:3;width:auto}
  #pv .ch-row{grid-template-columns:minmax(0,1fr) auto;gap:5px 10px}
  #pv .ch-row .ch-bonus{grid-column:1}
  #pv .ch-row .ch-p{grid-column:1}
  #pv .ch-row .ch-pct{grid-column:2;grid-row:3}
  #pv .ch-row .st{grid-column:2;grid-row:1}
  #pv .arr{display:none}
  #pv .c-wrap{grid-template-columns:minmax(0,1fr)}
}

#pv section[hidden],#pv [hidden]{display:none!important}
#pv h3{font:600 13px var(--f-h);margin:0;color:var(--tx)}
#pv .neg{color:var(--bad)}
#pv .pn{padding:calc(var(--p)*1.1)}
#pv .btn-g{font-size:12px!important;font-weight:500;color:var(--ac)!important;padding:5px 10px;border:1px solid var(--line)!important;border-radius:8px;white-space:nowrap}
#pv .btn-g:hover{background:var(--ac-soft)}#pv .btn-g.sm{padding:3px 8px;font-size:11px!important}
#pv .bk{color:var(--ac)!important;font-size:13px;font-weight:500;padding:6px 0;text-align:left;justify-self:start}
#pv .bk.under{padding:0;margin-top:calc(var(--gap)*-.8)}
#pv .crumbs{display:flex;gap:7px;align-items:center;font-size:13px;flex-wrap:wrap}
#pv .crumbs button{color:var(--ac)}#pv .crumbs i{font-style:normal;color:var(--tx3)}#pv .crumbs b{font-weight:600}
/* Header */
#pv .h-lab{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}
#pv .h-big{font-size:38px;font-weight:600;line-height:1.05;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
#pv .h-top,#pv .h-bot{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}
#pv .h-bot{align-items:flex-end;margin-top:calc(var(--p)*1.1)}
#pv .h-sts{display:flex;gap:calc(var(--gap)*1.6);flex-wrap:wrap}
#pv .h-st{display:grid;gap:2px}#pv .h-st span{font-size:11px;color:var(--tx3)}#pv .h-st b{font-size:17px;font-weight:600}
#pv .p-line{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--warn);margin-top:7px}
#pv .p-line i{width:6px;height:6px;border-radius:50%;background:currentColor}
#pv .p-pill{font:600 12px var(--f-b);letter-spacing:0;padding:3px 10px;border-radius:99px;color:var(--warn);background:color-mix(in srgb,var(--warn) 13%,transparent)}
#pv .h-ban{border-radius:calc(var(--c-radius)*1.3);padding:calc(var(--p)*1.5);color:#fff}
#pv .h-ban .h-id{display:flex;gap:12px;align-items:center}
#pv .h-plate{width:64px;height:40px;border-radius:9px;background:#fff;display:grid;place-items:center;padding:4px;flex:none}
#pv .h-plate .lg{height:100%;width:100%;justify-content:center}#pv .h-plate .lg img{object-position:center}
#pv .h-plate .mono span{display:none}
#pv .h-id b{font:600 20px var(--f-h);display:block}#pv .h-id small{font-size:12px;opacity:.75}
#pv .h-ban .h-lab{opacity:.65}#pv .h-ban .h-st span{color:rgba(255,255,255,.7)}#pv .h-ban .h-st b,#pv .h-ban .up,#pv .h-ban .pend{color:#fff}
#pv .h-ban .p-line{color:#FCD34D}#pv .h-ban .p-pill{color:#FCD34D;background:rgba(0,0,0,.25)}
#pv .h-plain{padding:calc(var(--p)*1.4)}
#pv .h-lgo{height:46px;display:flex;align-items:center}#pv .h-lgo .lg{height:100%}
#pv .h-sub{display:block;font-size:12px;color:var(--tx3);margin-top:6px}
#pv .h-plain .h-lab,#pv .h-split .h-lab{color:var(--tx3)}
#pv .h-split{padding:calc(var(--p)*1.2) calc(var(--p)*1.4);display:flex;align-items:center;gap:calc(var(--gap)*2.4);flex-wrap:wrap}
#pv .h-a{display:grid;gap:6px;max-width:180px}#pv .h-a small{font-size:11px;color:var(--tx3)}
#pv .h-split .h-big{font-size:32px}#pv .h-split .h-sts{flex:1;min-width:0}#pv .h-split .fan{margin-left:auto}
#pv .fan{display:flex;align-items:center}
#pv .fc{width:70px;aspect-ratio:1000/630;border-radius:6px;overflow:hidden;margin-left:-24px;box-shadow:0 5px 12px -4px rgba(0,0,0,.5);display:grid;place-items:center;flex:none}
#pv .fc:first-child{margin-left:0}#pv .fc img{width:100%;height:100%;object-fit:cover;display:block}
#pv .fc.more{background:#334155;color:#fff;font-size:12px;font-weight:600}
/* Ledger */
#pv .l-scroll{overflow-x:auto}
#pv .l-t{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
#pv .l-t th{font-weight:500;color:var(--tx2);text-align:right;padding:0 10px 8px;white-space:nowrap}
#pv .l-t td{text-align:right;padding:6px 10px;white-space:nowrap}
#pv .l-t td:first-child{text-align:left;padding-left:0}#pv .l-t .tt{font-weight:600;padding-right:0}
#pv .l-t .rl{color:var(--tx3)}#pv .l-t small{display:block;font-size:10px;color:var(--tx3);font-weight:400}
#pv .l-t .ls td{border-block:1px solid var(--line)}
#pv .l-t .cu td{border-top:1px solid var(--line);padding-top:10px;font-weight:600}#pv .l-t .cu td:not(:first-child){color:var(--ac)}
#pv .leg{font-size:11.5px;color:var(--tx3);margin:12px 0 0}
#pv .l-acts{display:flex;gap:10px 22px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
#pv .l-acts>div{display:flex;gap:8px;align-items:center;font-size:12.5px}#pv .l-acts b{font-weight:500;color:var(--tx2)}
#pv .l-people{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:var(--gap)}
#pv .l-p{background:var(--raised);border-radius:calc(var(--c-radius)*.75);padding:var(--p);min-width:0}
#pv .l-p.tot{background:var(--ac-soft)}
#pv .l-ph{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12.5px}#pv .l-ph b{font-weight:500;color:var(--tx2)}
#pv .l-cur{font-size:25px;font-weight:600;margin:3px 0 9px}
#pv .l-p dl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;font-size:12px;margin:0;font-variant-numeric:tabular-nums}
#pv .l-p dt{color:var(--tx3)}#pv .l-p dd{margin:0;text-align:right}
#pv .l-flow{display:grid;gap:14px}
#pv .lf-h{display:flex;align-items:center;gap:8px;font-size:13px}#pv .lf-h b{font-weight:500}#pv .lf-h .val{margin-left:auto;font-weight:600;font-size:16px}
#pv .lf-bar{height:8px;background:var(--line);border-radius:8px;overflow:hidden;margin:6px 0}#pv .lf-bar i{display:block;height:100%;background:var(--ac);border-radius:8px}
#pv .lf-m{display:flex;gap:2px 12px;flex-wrap:wrap;font-size:11.5px;color:var(--tx3)}
#pv .lf.tot{border-top:1px solid var(--line);padding-top:10px}
#pv .kebab,#pv .addm{position:relative;display:inline-block}
#pv .kebab summary,#pv .addm summary{list-style:none;cursor:pointer}#pv .kebab summary::-webkit-details-marker,#pv .addm summary::-webkit-details-marker{display:none}
#pv .kebab summary{padding:0 6px;color:var(--tx3);font-weight:700}
#pv .addm summary{font-size:12.5px;font-weight:600;background:var(--ac);color:var(--ac-fg);padding:6px 13px;border-radius:8px}
#pv .kebab div,#pv .addm div{position:absolute;right:0;top:calc(100% + 4px);z-index:5;background:var(--surface);border:1px solid var(--line);border-radius:9px;box-shadow:0 8px 22px rgba(15,23,42,.14);padding:4px;display:grid;min-width:164px}
#pv .kebab div button,#pv .addm div button{text-align:left;padding:7px 9px;border-radius:6px;font-size:12.5px;font-weight:400;color:var(--tx)}
#pv .kebab div button:hover,#pv .addm div button:hover{background:var(--ac-soft)}
/* Categories */
#pv .c-bars{display:grid;gap:11px}
#pv .cb{display:grid;grid-template-columns:minmax(70px,110px) minmax(0,1fr) 62px 36px;gap:10px;align-items:center;font-size:12.5px;font-variant-numeric:tabular-nums}
#pv .cb b{font-weight:500;text-align:right}#pv .cb em,#pv .dl em,#pv .c-tl em{font-style:normal;color:var(--tx3);text-align:right;font-size:11.5px}
#pv .c-donut{display:flex;gap:22px;align-items:center;flex-wrap:wrap}
#pv .dn{width:128px;height:128px;border-radius:50%;display:grid;place-items:center;flex:none;position:relative}
#pv .dn::before{content:'';position:absolute;inset:22px;background:var(--surface);border-radius:50%}#pv .dn span{position:relative;font-weight:600;font-size:16px}
#pv .dl{flex:1;display:grid;gap:7px;min-width:170px;font-size:12.5px}
#pv .dl>div{display:grid;grid-template-columns:10px minmax(0,1fr) auto 34px;gap:8px;align-items:center}
#pv .dl i{width:10px;height:10px;border-radius:3px}#pv .dl b{font-weight:500}
#pv .c-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:var(--gap)}
#pv .c-tl{background:var(--surface);border:1px solid var(--line);border-radius:var(--c-radius);padding:var(--p);display:grid;gap:3px;font-size:12px;color:var(--tx2)}
#pv .c-tl b{font-size:18px;color:var(--tx);font-weight:500}#pv .c-tl em{text-align:left}
/* Cards */
#pv .e-cap{display:flex;justify-content:space-between;gap:6px;font-size:11.5px;color:var(--tx3);padding-top:6px;flex-wrap:wrap}#pv .e-cap b{font-weight:600;color:var(--tx)}
#pv .e-list{display:grid;gap:0;padding-block:calc(var(--p)*.4)}
#pv .el{display:grid;grid-template-columns:68px minmax(0,1fr) auto 12px;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}#pv .el:last-child{border:0}
#pv .el .c-mask{font-size:9px;left:3px;bottom:3px;padding:0 3px}#pv .el .c-fb{font-size:8px;padding:0 3px}
#pv .el-t{display:grid;font-size:13px;min-width:0}#pv .el-t b{font-weight:500}#pv .el-t span{font-size:11.5px;color:var(--tx3)}
#pv .el .val{font-size:13.5px;font-weight:600}
/* Activity */
#pv .a-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:var(--gap)}
#pv .a-panels .s-head{align-items:center;margin-bottom:6px}
#pv .ev{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}#pv .ev:last-child{border:0}
#pv .ev-t{flex:1;display:grid;gap:1px;min-width:0;font-size:13px}#pv .ev-t b{font-weight:500}#pv .ev-t span{font-size:11.5px;color:var(--tx3)}
#pv .ev .val{font-size:14px;font-weight:600;white-space:nowrap}
#pv .ev-a{opacity:0;transition:opacity .12s}#pv .ev:hover .ev-a,#pv .ev-a:focus-within{opacity:1}@media (hover:none){#pv .ev-a{opacity:1}}
#pv .emp{font-size:12.5px;color:var(--tx3);margin:6px 0}
#pv .r-st{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;margin-bottom:8px}
#pv .r-st>div{background:var(--raised);border-radius:9px;padding:8px 11px;display:grid;gap:2px}#pv .r-st span{font-size:10.5px;color:var(--tx3)}#pv .r-st b{font-size:15px;font-weight:600}
#pv .a-tabs{margin-bottom:10px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:4px 18px}
#pv .a-add{display:flex;justify-content:flex-end;margin-bottom:6px}
#pv .a-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center}
#pv .a-eachs{display:flex;gap:5px;margin-left:auto;flex-wrap:wrap}
#pv .a-feed>[data-k]{display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;align-items:center;border-bottom:1px solid var(--line)}#pv .a-feed>[data-k]:last-child{border:0}
#pv .a-feed .ev{border:0}#pv .ev-k{font-size:10.5px;color:var(--tx3);font-weight:600}
/* Layouts */
#pv .rail{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(250px,1fr);gap:calc(var(--gap)*2);align-items:start}
#pv .r-main,#pv .r-side,#pv .p-view{display:grid;gap:calc(26px*var(--c-density));min-width:0}
#pv .p-tabs{border-bottom:1px solid var(--line);gap:22px}
#pv .r-side .ch-grid{grid-template-columns:minmax(0,1fr)}#pv .r-side .a-panels{grid-template-columns:minmax(0,1fr)}
@container pv (max-width:760px){
  #pv .rail{grid-template-columns:minmax(0,1fr)}
  #pv .h-big{font-size:32px}
  #pv .h-split{align-items:flex-start;flex-direction:column}#pv .h-split .fan{margin-left:0}
  #pv .cb{grid-template-columns:minmax(60px,86px) minmax(0,1fr) 54px 32px;gap:7px}
  #pv .a-feed>[data-k]{grid-template-columns:minmax(0,1fr);gap:0;padding-top:7px}
}
`
});
})();
