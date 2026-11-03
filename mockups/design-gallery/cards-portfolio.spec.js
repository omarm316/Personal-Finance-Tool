// Design gallery spec for the Cards module's main page (Portfolio tab).
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

function logo(e,picks,h){
  const mode=MODE[picks.scheme],key=e.logo;
  const plate=picks.logoStyle==='plate';
  const src=key?(h.img(`logo_${key}_${plate?'light':mode}`)||(key==='amex'?h.img('logo_amex_light'):'')):'';
  if(picks.logoStyle==='name'||!src){
    return `<span class="mono"><i>${h.esc(e.name[0])}</i><span>${h.esc(e.name)}</span></span>`;
  }
  return `<span class="lg ${plate?'plate':''}"><img src="${src}" alt="${h.esc(e.name)}"></span>`;
}
function ecoList(picks,d){
  const s=[...d.ecos];
  if(picks.ecoSort==='balance')s.sort((a,b)=>b.balance-a.balance);
  else if(picks.ecoSort==='name')s.sort((a,b)=>a.name.localeCompare(b.name));
  return s;
}
function ecoMeta(e,picks,d,h){
  let m='';
  if(picks.showEarned)m+=`<span class="${e.earned>0?'up':'mut'}">+${h.num(e.earned)} ${d.period}</span>`;
  if(picks.showPending&&e.pending>0)m+=`<span class="pend">${h.num(e.pending)} pending</span>`;
  return m;
}
function ecosystems(picks,d,h){
  const list=ecoList(picks,d),cashTile=picks.cashBack==='tile';
  const cash=`$${d.cashBack.toFixed(2)}`;
  let body;
  if(picks.ecoLayout==='rows'){
    body=`<div class="e-rows">`+list.map(e=>`<div class="e-row sf">${logo(e,picks,h)}<span class="nm">${h.esc(e.name)}</span><b class="val">${h.num(e.balance)}</b><span class="meta">${ecoMeta(e,picks,d,h)}</span><span class="chev">›</span></div>`).join('')
      +(cashTile?`<div class="e-row sf"><span class="mono"><i>$</i></span><span class="nm">Cash Back</span><b class="val good">${cash}</b><span class="meta"><span class="mut">earned ${d.period}</span></span><span class="chev">›</span></div>`:'')+`</div>`;
  }else{
    const cls={tiles:'e-tiles',feature:'e-feature',wall:'e-wall'}[picks.ecoLayout];
    body=`<div class="${cls}">`+list.map(e=>`<div class="e-tile ${picks.ecoLayout==='wall'?'':'sf'}">${logo(e,picks,h)}<div class="e-b"><b class="val">${h.num(e.balance)}</b><div class="meta">${ecoMeta(e,picks,d,h)}</div></div></div>`).join('')
      +(cashTile?`<div class="e-tile ${picks.ecoLayout==='wall'?'':'sf'}"><span class="mono"><i>$</i><span>Cash Back</span></span><div class="e-b"><b class="val good">${cash}</b><div class="meta"><span class="mut">earned ${d.period}</span></div></div></div>`:'')+`</div>`;
  }
  const strip=picks.cashBack==='strip'?`<div class="cash sf"><span class="cb-chip"></span><div class="nm">Cash Back<small>Earned this period</small></div><b class="val good">${cash}</b><span class="chev">›</span></div>`:'';
  return `<section data-region="eco"><h2>Rewards programs</h2>${body}${strip}</section>`;
}
function cardFace(c,picks,h){
  const art=h.img('card_'+c.key);
  const lab=picks.cardLabel;
  return `<div class="c-face ${lab==='hover'?'hov':''}" style="background:linear-gradient(135deg,${grad(c.eco)})" title="${h.esc(c.name)} ${c.mask}">
    ${art?`<img src="${art}" alt="">`:`<span class="c-fb">${h.esc(c.name)}</span>`}
    ${lab!=='caption'?`<span class="c-mask">${c.mask}</span>`:''}</div>`;
}
function cardItem(c,picks,h){
  return `<div class="c-item" data-owner="${h.esc(c.owner||'Unassigned')}">${cardFace(c,picks,h)}${picks.cardLabel==='caption'?`<div class="c-cap"><b>${h.esc(c.name)}</b><span>•••• ${c.mask}${c.owner?' · '+h.esc(c.owner):''}</span></div>`:''}</div>`;
}
function ownerFilter(picks,d,h){
  const owners=[...new Set(d.cards.map(c=>c.owner||'Unassigned'))];
  if(picks.ownerFilter==='chips')return `<div class="own chips" role="group" aria-label="Filter by cardholder"><button type="button" class="chip on" data-own="">All</button>${owners.map(o=>`<button type="button" class="chip" data-own="${h.esc(o)}">${h.esc(o)}</button>`).join('')}</div>`;
  if(picks.ownerFilter==='checks')return `<div class="own checks" role="group" aria-label="Filter by cardholder">${owners.map((o,i)=>`<label><input type="checkbox" id="own_${i}" checked data-check="${h.esc(o)}"> ${h.esc(o)}</label>`).join('')}</div>`;
  return '';
}
function carousel(picks,d,h){
  const items=d.cards.map(c=>cardItem(c,picks,h)).join('');
  let body;
  if(picks.carousel==='arrows')body=`<div class="c-wrap"><button type="button" class="arr l" aria-label="Scroll cards left">‹</button><div class="c-scroll">${items}</div><button type="button" class="arr r" aria-label="Scroll cards right">›</button></div>`;
  else if(picks.carousel==='wall')body=`<div class="c-wall">${items}</div>`;
  else if(picks.carousel==='byeco'){
    const g={};d.cards.forEach(c=>(g[c.eco||'No program yet']=g[c.eco||'No program yet']||[]).push(c));
    body=`<div class="c-groups">`+Object.keys(g).map(k=>`<div class="c-group"><div class="gl">${h.esc(k)} <span>${g[k].length}</span></div><div class="c-fan">${g[k].map(c=>cardItem(c,picks,h)).join('')}</div></div>`).join('')+`</div>`;
  }else body=`<div class="c-scroll">${items}</div>`;
  return `<section data-region="cards"><div class="s-head"><h2>Your cards <span class="ct">${d.cards.length}</span></h2>${ownerFilter(picks,d,h)}</div>${body}</section>`;
}
const short=n=>n>=1000?'$'+(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+'k':'$'+Math.round(n);
function ring(c){
  const r=22,C=2*Math.PI*r,done=c.status==='unlocked'||c.pct>=100;
  const label=done?'Done':c.target?short(c.remaining):'n/a';
  return `<svg class="ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--ac)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C*Math.min(c.pct,100)/100} ${C}" transform="rotate(-90 27 27)"/><text x="27" y="31" text-anchor="middle" fill="var(--tx)" font-size="${label.length>4?10.5:12}" font-weight="600">${label}</text></svg>`;
}
function challenges(picks,d,h){
  const prog=c=>`<div class="bar"><i style="width:${Math.min(c.pct,100)}%"></i></div>`;
  const nums=c=>c.target?`<div class="ch-n"><span>$${h.num(c.spent)} of $${h.num(c.target)}</span><span>${c.remaining>0?'$'+h.num(c.remaining)+' to go':'Complete'}</span></div>`:'';
  const st=c=>`<span class="st ${c.status}">${c.status==='unlocked'?'Unlocked':'Active'}</span>`;
  const who=c=>`${h.esc(c.card)} ${c.mask}`;
  const it=picks.chDesign;
  let body=d.challenges.map(c=>{
    if(it==='row')return `<div class="ch-row"><div class="ch-t"><b>${h.esc(c.name)}</b><span>${who(c)}</span></div><span class="ch-bonus">${h.esc(c.bonus)}</span><div class="ch-p">${prog(c)}</div><span class="ch-pct">${Math.round(c.pct)}%</span>${st(c)}</div>`;
    if(it==='ring'){const done=c.status==='unlocked'||c.pct>=100;return `<div class="ch-card sf ring-c rings-${picks.chRings} ${done?'is-done':''}"><div class="rings"><figure>${ring(c)}<figcaption>${done?'':'to go'}</figcaption></figure></div><div class="ch-t"><b>${h.esc(c.name)}</b><span>${who(c)}</span><span class="ch-bonus">${h.esc(c.bonus)}</span></div>${done?`<button type="button" class="arch arch-${picks.chArchive}">Archive</button>`:''}</div>`;}
    if(it==='art'){const art=h.img('card_'+c.key);return `<div class="ch-card sf art-c"><div class="ch-art" style="background:linear-gradient(135deg,${grad(c.eco)})">${art?`<img src="${art}" alt="">`:''}</div><div class="ch-body"><div class="ch-top"><b>${h.esc(c.name)}</b>${st(c)}</div><span class="mut">${who(c)} · ${h.esc(c.bonus)}</span>${prog(c)}${nums(c)}</div></div>`;}
    return `<div class="ch-card sf"><div class="ch-top"><div class="ch-t"><b>${h.esc(c.name)}</b><span>${who(c)}</span></div>${st(c)}</div>${nums(c)}${prog(c)}<span class="ch-bonus">${h.esc(c.bonus)}</span></div>`;
  }).join('');
  if(it==='ring'){const lbl=picks.chAdd==='labeled';body+=`<button type="button" class="ch-add add-${picks.chAdd} ${picks.chAdd==='solid'?'sf':''}" aria-label="Add a challenge"><span>+</span>${lbl?'<em>Add a challenge</em>':''}</button>`;}
  const cls=it==='row'?'ch-list sf':(picks.chFlow==='scroll'?'ch-h':'ch-grid');
  return `<section data-region="challenges"><h2>Active challenges <span class="ct">${d.challenges.length}</span></h2><div class="${cls}">${body}</div>${it==='ring'?'<details class="ch-archived" hidden><summary>Show archived (<span>0</span>)</summary><div class="ch-grid"></div></details>':''}</section>`;
}
function period(picks,d,h){
  const P=['MTD','QTD','YTD'],year=`<select id="pv_year" class="yr" aria-label="Year"><option>${d.year}</option><option>${d.year-1}</option><option>${d.year-2}</option></select>`;
  const cur=d.period;let c;
  if(picks.period==='segmented')c=`<div class="seg" role="group" aria-label="Period">${P.map(p=>`<button type="button" class="${p===cur?'on':''}">${p}</button>`).join('')}</div>`;
  else if(picks.period==='radio')c=`<div class="rad" role="group" aria-label="Period">${P.map(p=>`<label><input type="radio" name="pv_period" id="pv_p_${p}" ${p===cur?'checked':''}> ${p}</label>`).join('')}</div>`;
  else if(picks.period==='slider')c=`<div class="sl"><input type="range" id="pv_period_sl" min="0" max="2" step="1" value="${P.indexOf(cur)}" aria-label="Period"><div class="sl-l">${P.map(p=>`<span class="${p===cur?'on':''}">${p}</span>`).join('')}</div></div>`;
  else c=`<div class="und" role="group" aria-label="Period">${P.map(p=>`<button type="button" class="${p===cur?'on':''}">${p}</button>`).join('')}</div>`;
  return `<div class="period" data-region="selectors">${c}${year}</div>`;
}
function submenu(picks){
  const T=['Portfolio','Swipe Advisor','Card Management'];
  if(picks.submenu==='segmented')return `<div class="seg big" data-region="menus">${T.map((t,i)=>`<button type="button" class="${i?'':'on'}">${t}</button>`).join('')}</div>`;
  if(picks.submenu==='pills')return `<div class="pills" data-region="menus">${T.map((t,i)=>`<button type="button" class="${i?'':'on'}">${t}</button>`).join('')}</div>`;
  return `<div class="und big" data-region="menus">${T.map((t,i)=>`<button type="button" class="${i?'':'on'}">${t}</button>`).join('')}</div>`;
}
function nav(picks){
  const items=NAV.map(([l,i])=>`<button type="button" class="${l==='Cards'?'on':''}" title="${l}">${icon(i)}<span>${l}</span></button>`).join('');
  return `<nav class="appnav" data-region="menus"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${items}</div></nav>`;
}
Gallery.define({
  id:'cards-portfolio-r3',
  name:'Cards: Portfolio, round 3',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Manrope:wght@400;500;600;700&family=Sora:wght@400;500;600&family=DM+Sans:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Figtree:wght@400;500;600;700&family=Nunito:wght@400;500;600;700&family=Quicksand:wght@400;500;600;700&family=Fredoka:wght@400;500;600&family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap'],
  groups:[
   {id:'type',label:'Typeface',open:true,controls:[
    {id:'font',label:'Typeface',type:'choice',options:[
      {id:'current',label:'Outfit + Plus Jakarta',hint:'Your round 1 pick.',current:true,sample:"font-family:'Outfit'",tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}},
      {id:'nunito',label:'Nunito',hint:'Softly rounded and very readable at small sizes.',sample:"font-family:'Nunito'",tokens:{'--f-h':"'Nunito',system-ui,sans-serif",'--f-b':"'Nunito',system-ui,sans-serif"}},
      {id:'quicksand',label:'Quicksand + Nunito',hint:'Geometric, fully rounded headings and balances.',sample:"font-family:'Quicksand'",tokens:{'--f-h':"'Quicksand',system-ui,sans-serif",'--f-b':"'Nunito',system-ui,sans-serif"}},
      {id:'fredoka',label:'Fredoka + Nunito',hint:'The most playful: chunky rounded headings.',sample:"font-family:'Fredoka'",tokens:{'--f-h':"'Fredoka',system-ui,sans-serif",'--f-b':"'Nunito',system-ui,sans-serif"}},
      {id:'mplus',label:'M PLUS Rounded',hint:'Fully rounded stroke ends, still tidy.',sample:"font-family:'M PLUS Rounded 1c'",tokens:{'--f-h':"'M PLUS Rounded 1c',system-ui,sans-serif",'--f-b':"'M PLUS Rounded 1c',system-ui,sans-serif"}},
    ]},
   ]},
   {id:'cards',label:'Card images',open:true,controls:[
    {id:'cardRow',label:'Cards at the row\'s edge',type:'choice',default:'whole',options:[
      {id:'whole',label:'Whole cards only',hint:'Cards resize slightly so a whole number fit. Arrows move one full set.'},
      {id:'fade',label:'Fade the edge',hint:'A partial card stays visible and fades out, hinting at more.'},
    ]},
    {id:'cardSize',label:'Card size',type:'slider',min:110,max:240,step:5,default:175,unit:'px'},
   ]},
   {id:'challenges',label:'Challenge cards',open:true,controls:[
    {id:'chRings',label:'Where the circle goes',type:'choice',options:[
      {id:'left',label:'Left of the text'},
      {id:'below',label:'Below the text',hint:'A larger circle.'},
      {id:'right',label:'Right of the text'},
    ]},
    {id:'chArchive',label:'Archive button on hover',type:'choice',options:[
      {id:'corner',label:'Corner button',hint:'Hover a completed challenge, click Archive, then open Show archived under the grid.'},
      {id:'bar',label:'Full-width footer'},
    ]},
    {id:'chAdd',label:'Add challenge card',type:'choice',options:[
      {id:'dashed',label:'Dashed outline, + only'},
      {id:'labeled',label:'Dashed outline, + and label'},
      {id:'solid',label:'Solid panel, + only'},
    ]},
   ]},
   {id:'look',label:'Fine-tuning',controls:[
    {id:'radius',label:'Corner roundness',type:'slider',min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',min:.75,max:1.35,step:.05,default:1.25},
   ]},
   {id:'decided',label:'Decided in round 1',open:false,controls:[
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',hint:'Light. Cool blue-grey page with white surfaces.',swatches:['#EEF2F7','#FFFFFF','#2563EB'],tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'accent',label:'Accent',type:'choice',locked:true,options:[{id:'blue',label:'Brand blue',current:true,swatches:['#2563EB','#60A5FA'],tokens:{'--ac-l':'#2563EB','--ac-d':'#60A5FA'}}]},
    {id:'surface',label:'Panels and cards',type:'choice',locked:true,options:[{id:'hairline',label:'Hairline'}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'submenu',label:'Cards sub-menu',type:'choice',locked:true,options:[{id:'underline',label:'Underlined tabs'}]},
    {id:'headerbox',label:'Page header',type:'choice',locked:true,options:[{id:'boxed',label:'Boxed bar'}]},
    {id:'period',label:'Period selector',type:'choice',locked:true,options:[{id:'underline',label:'Underlined text'}]},
    {id:'ecoLayout',label:'Ecosystem layout',type:'choice',locked:true,options:[{id:'tiles',label:'Compact tiles'}]},
    {id:'logoStyle',label:'Logo treatment',type:'choice',locked:true,options:[{id:'bare',label:'Logo on the surface'}]},
    {id:'ecoSort',label:'Ecosystem sort',type:'choice',locked:true,options:[{id:'balance',label:'Highest balance'}]},
    {id:'cashBack',label:'Cash back',type:'choice',locked:true,options:[{id:'tile',label:'Same as a program'}]},
    {id:'showEarned',label:'Show earned this period',type:'toggle',locked:true,default:true},
    {id:'showPending',label:'Show pending points',type:'toggle',locked:true,default:true},
    {id:'carousel',label:'Carousel layout',type:'choice',locked:true,options:[{id:'arrows',label:'Row with arrows'}]},
    {id:'cardLabel',label:'Card labels',type:'choice',locked:true,options:[{id:'badge',label:'Digits on the art'}]},
    {id:'ownerFilter',label:'Cardholder filter',type:'choice',locked:true,options:[{id:'chips',label:'Chips'}]},
    {id:'chDesign',label:'Challenge design',type:'choice',locked:true,options:[{id:'ring',label:'Progress ring'}]},
    {id:'chFlow',label:'Challenge arrangement',type:'choice',locked:true,options:[{id:'grid',label:'Grid'}]},
    {id:'sections',label:'Page order',type:'choice',locked:true,options:[{id:'eco',label:'Programs, cards, challenges'}]},
   ]},
  ],
  render(picks,d,h){
    const s={e:ecosystems(picks,d,h),c:carousel(picks,d,h),ch:challenges(picks,d,h)};
    const order={eco:['e','c','ch'],cards:['c','e','ch'],ch:['ch','e','c']}[picks.sections];
    const open=picks.headerbox==='open';
    return `<div class="app">${nav(picks)}<div class="main">
      <header class="hdr ${open?'':'sf'}">${open?'<h1>Cards</h1>':''}<div class="hdr-r">${submenu(picks)}${period(picks,d,h)}</div></header>
      ${order.map(k=>s[k]).join('')}</div></div>`;
  },
  after(root,picks){
    const ad=root.querySelector('.ch-archived');
    const syncA=()=>{if(!ad)return;const n=ad.querySelectorAll('.ch-card').length;ad.hidden=!n;ad.querySelector('span').textContent=n};
    root.querySelectorAll('.arch').forEach(b=>b.onclick=()=>{const card=b.closest('.ch-card'),arch=b.textContent==='Archive';
      if(arch){ad.querySelector('.ch-grid').append(card);b.textContent='Restore'}else{root.querySelector('section[data-region=challenges] > .ch-grid').prepend(card);b.textContent='Archive'}
      syncA()});
    if(window.__cRO){window.__cRO.disconnect();window.__cRO=null}
    const sc0=root.querySelector('.c-scroll');
    let fit=()=>{};
    if(sc0&&picks.cardRow==='whole'){
      fit=()=>{root.querySelectorAll('.c-scroll').forEach(sc=>{const w=sc.getBoundingClientRect().width,g=parseFloat(getComputedStyle(sc).columnGap)||0,base=picks.cardSize,
        n=Math.max(1,Math.floor((w+g)/(base+g))),iw=(w-g*(n-1))/n,items=sc.querySelectorAll('.c-item:not([hidden])').length,extra=(n-items%n)%n;
        sc.style.setProperty('--whole-w',iw+'px');sc.dataset.page=n*(iw+g);
        let sp=sc.querySelector('.c-sp');if(!sp){sp=document.createElement('i');sp.className='c-sp';sc.append(sp)}
        sp.style.width=extra*(iw+g)-g+'px';sp.hidden=!extra;});};
      fit();window.__cRO=new ResizeObserver(fit);window.__cRO.observe(sc0);
    }
    root.querySelectorAll('.c-wrap').forEach(w=>{const sc=w.querySelector('.c-scroll');
      w.querySelector('.l').onclick=()=>sc.scrollBy({left:-(Number(sc.dataset.page)||sc.clientWidth*.8),behavior:'smooth'});
      w.querySelector('.r').onclick=()=>sc.scrollBy({left:Number(sc.dataset.page)||sc.clientWidth*.8,behavior:'smooth'});});
    const show=f=>{root.querySelectorAll('.c-item').forEach(i=>{i.hidden=!f(i.dataset.owner)});
      root.querySelectorAll('.c-group').forEach(g=>{g.hidden=!g.querySelector('.c-item:not([hidden])')});fit();root.querySelectorAll('.c-scroll').forEach(c=>{c.scrollLeft=0});};
    root.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{root.querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));b.classList.add('on');const v=b.dataset.own;show(o=>!v||o===v)});
    root.querySelectorAll('[data-check]').forEach(c=>c.onchange=()=>{const on=[...root.querySelectorAll('[data-check]:checked')].map(x=>x.dataset.check);show(o=>on.includes(o))});
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
`
});
})();
