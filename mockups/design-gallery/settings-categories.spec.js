// Design gallery spec for Settings > Categories: the editor for Omer's
// two-level personal category tree (top level > sub-category).
// Content comes from the data file; this file holds no personal figures.
(function(){
const NAV=['Dashboard','Transactions','Budgets','Net Worth','Daily Balances','Cash Flow','Loans','GCB','Cards','Accounts','Settings'];
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'#2563EB','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,#2563EB 10%,transparent)','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C'});
const f=n=>Number(n||0).toLocaleString('en-US');
const TYPE={expense:'Expense',income:'Income',both:'Both'};
const WHY={'Work':'Dashboards and budgets treat Work as income','Transfer':'Marks money moving between your own accounts','Unclassified':'Rules and the AI fall back to it','Fees & Interest':'The card page’s annual-fee tile adds it up'};
let D=null,P=null,H=null;   // render() stashes these for after()

function tree(d){const all=d.categories,act=all.filter(c=>c.active);
  const tops=act.filter(c=>!c.parent),kids={};act.filter(c=>c.parent).forEach(c=>(kids[c.parent]=kids[c.parent]||[]).push(c));
  return {tops,kids,hidden:all.filter(c=>!c.active),find:n=>all.find(c=>c.name===n)};}
const total=(t,c)=>c.tx+(t.kids[c.name]||[]).reduce((s,k)=>s+k.tx,0);
const usage=c=>`${f(c.tx)} transaction${c.tx===1?'':'s'}, ${f(c.rules)} rule${c.rules===1?'':'s'} and ${f(c.budgets)} budget month${c.budgets===1?'':'s'}`;

function lock(p,c,h){if(!c.locked)return '';return p.locks==='label'?`<span class="lk-l" title="${h.esc(WHY[c.name]||'')}">Used by the app</span>`:`<span class="lk" title="Locked: ${h.esc(WHY[c.name]||'')}" aria-label="Locked">🔒</span>`;}
function typeTag(p,c){if(p.typeShow==='editor')return '';if(p.typeShow==='exceptions'&&c.type==='expense')return '';return `<span class="ty ty-${c.type}">${TYPE[c.type]}</span>`;}
function counts(p,c,h,t){const tx=t&&!c.parent&&(t.kids[c.name]||[]).length?total(t,c):c.tx;
  if(p.counts==='cols')return `<span class="n">${tx?f(tx):'–'}</span><span class="n">${c.rules?f(c.rules):'–'}</span><span class="n">${c.budgets?f(c.budgets):'–'}</span>`;
  const s=`${f(tx)} transactions${c.rules?` · ${f(c.rules)} rules`:''}${c.budgets?` · budget`:''}`;
  return `<span class="ln ${p.counts==='hover'?'hov':''}">${tx||c.rules||c.budgets?s:'Not used yet'}</span>`;}
function menu(p,c,h,t){const child=!!c.parent,n=h.esc(c.name);
  if(c.locked)return `<details class="km"><summary aria-label="Actions for ${n}">⋯</summary><div>${p.reorder==='menu'?'<button type="button">Move up</button><button type="button">Move down</button>':''}<p class="mnote">${h.esc(WHY[c.name])}, so it can’t be renamed, moved or hidden.</p></div></details>`;
  const used=c.tx||c.rules||c.budgets||(t.kids[c.name]||[]).length;
  const del=p.deleteRule==='hidden'?(used?'':`<button type="button" class="bad">Delete</button>`):`<button type="button" class="bad" ${used?'disabled title="In use: merge or hide it instead"':''}>Delete</button>`;
  return `<details class="km"><summary aria-label="Actions for ${n}">⋯</summary><div><button type="button" data-rn="${n}">Rename</button>${child&&p.moveTo==='picker'?`<button type="button" data-mv="${n}">Move to another top level…</button>`:''}<button type="button" data-ty="${n}">Change type…</button>${p.reorder==='menu'?'<button type="button">Move up</button><button type="button">Move down</button>':''}<hr><button type="button" data-hide="${n}">Hide</button><button type="button" data-merge="${n}">Merge into another…</button>${del}</div></details>`;}
function row(p,c,h,t,opts={}){const n=h.esc(c.name),top=!c.parent,kids=(t.kids[c.name]||[]).length;
  const fold=top&&kids&&p.collapse?`<button type="button" class="fd" data-fold="${n}" aria-label="Fold ${n}" aria-expanded="true">▾</button>`:`<span class="fd-sp"></span>`;
  const hd=p.reorder==='drag'?`<span class="hd" title="Drag to reorder${p.moveTo==='drag'&&!top?' or move under another top level':''}" aria-hidden="true">⋮⋮</span>`:'';
  const ar=p.reorder==='arrows'?`<span class="ar"><button type="button" aria-label="Move ${n} up">↑</button><button type="button" aria-label="Move ${n} down">↓</button></span>`:'';
  const click=p.editStyle!=='inline'&&!opts.noEdit?`data-edit="${n}" role="button" tabindex="0"`:'';
  const nm=p.editStyle==='inline'&&!c.locked?`<span class="nm" data-inl="${n}" title="Click to rename">${n}</span>`:`<span class="nm">${n}</span>`;
  const act=p.editStyle==='inline'?menu(p,c,h,t):`<span class="chev" aria-hidden="true">›</span>`;
  return `<div class="rw ${top?'top':'sub'} ${c.active?'':'off'} ${opts.cls||''}" data-name="${n}" ${c.parent?`data-under="${h.esc(c.parent)}"`:''} ${click}>${hd}${fold}<span class="nmw"><span class="nml">${nm}${lock(p,c,h)}${typeTag(p,c)}${!c.active?'<span class="ty">Hidden</span>':''}</span>${p.counts==='cols'?'':counts(p,c,h,t)}</span>${p.counts==='cols'?counts(p,c,h,t):''}${ar}<span class="acts">${c.active?act:'<button type="button" class="btn sm">Show again</button>'}</span></div>`;}
const addSub=(p,top,h)=>p.add==='rows'?`<button type="button" class="addr" data-add="${h.esc(top)}">+ Add sub-category to ${h.esc(top)}</button>`:'';
function colHead(p){return p.counts==='cols'?`<div class="rw hd-row">${p.reorder==='drag'?'<span class="hd"></span>':''}<span class="fd-sp"></span><span class="nmw">Category</span><span class="n">Transactions</span><span class="n">Rules</span><span class="n">Budget months</span><span class="acts"></span></div>`:'';}

function listTree(p,t,h){const inl=p.hidden==='inline';
  const groups=t.tops.map(c=>`<div class="grp" data-grp="${h.esc(c.name)}">${row(p,c,h,t)}<div class="kids">${(t.kids[c.name]||[]).map(k=>row(p,k,h,t)).join('')}${addSub(p,c.name,h)}</div></div>`);
  if(inl)t.hidden.forEach(c=>{const i=t.tops.findIndex(x=>x.name===c.parent);groups.splice(i<0?groups.length:i+1,0,`<div class="grp hid-grp" hidden>${row(p,c,h,t)}</div>`);});
  return `<div class="sf pn0 lst">${colHead(p)}${groups.join('')}${p.add==='rows'?`<button type="button" class="addr top" data-add="">+ Add top level</button>`:''}</div>`;}
function listCards(p,t,h){const legend=p.counts==='cols'?`<p class="lgd">Numbers: transactions · rules · budget months</p>`:'';
  return `${legend}<div class="cgrid">${t.tops.map(c=>`<div class="sf ccard" data-grp="${h.esc(c.name)}">${row(p,c,h,t,{cls:'chd'})}<div class="kids">${(t.kids[c.name]||[]).map(k=>row(p,k,h,t)).join('')}${addSub(p,c.name,h)}</div></div>`).join('')}${p.add==='rows'?`<button type="button" class="ccard addc" data-add="">+ Add top level</button>`:''}${p.hidden==='inline'?t.hidden.map(c=>`<div class="sf ccard hid-grp" hidden>${row(p,c,h,t,{cls:'chd'})}</div>`).join(''):''}</div>`;}
function listPanes(p,t,h){const sel=t.tops.find(c=>c.name==='Travel')||t.tops[0];
  const left=`<div class="sf pn0 pl">${t.tops.map(c=>`<button type="button" class="pli ${c===sel?'on':''}" data-pane="${h.esc(c.name)}"><span>${h.esc(c.name)}${c.locked?' 🔒':''}</span><small>${(t.kids[c.name]||[]).length||''}</small></button>`).join('')}${p.add==='rows'?`<button type="button" class="addr top" data-add="">+ Add top level</button>`:''}${p.hidden==='inline'?t.hidden.map(c=>`<button type="button" class="pli off hid-grp" hidden><span>${h.esc(c.name)}</span><small>Hidden</small></button>`).join(''):''}</div>`;
  const right=t.tops.map(c=>`<div class="sf pn0 pr" data-pv="${h.esc(c.name)}" ${c===sel?'':'hidden'}>${row(p,c,h,t,{cls:'phd'})}${colHead(p)}<div class="kids">${(t.kids[c.name]||[]).map(k=>row(p,k,h,t)).join('')||`<p class="emp">No sub-categories. Rows sit on ${h.esc(c.name)} itself.</p>`}${addSub(p,c.name,h)}</div></div>`).join('');
  return `<div class="panes">${left}<div>${right}</div></div>`;}
function hiddenBottom(p,t,h){if(p.hidden!=='bottom'||!t.hidden.length)return '';
  return `<details class="sf hb"><summary>Hidden <span class="ct">${t.hidden.length}</span></summary><div>${t.hidden.map(c=>row(p,c,h,t,{noEdit:true})).join('')}</div></details>`;}

// Overlays sit in a sticky, zero-height layer at the top of the preview, so
// the panel and its backdrop cover the preview only, wherever it's scrolled.
function editor(p){return `<div class="ovl"><div class="scrim" data-scrim hidden></div><aside class="ed ${p.editStyle==='window'?'win':'drw'}" data-ed hidden aria-label="Edit category"></aside><div class="ed win" data-mg hidden></div></div>`;}

function settings(p,d,h){const t=tree(d);
  const tabs=['Preferences','Data Management',p.place==='rules'?'Categories & Rules':'Rules',...(p.place==='tab'?['Categories']:[]),'Bank Links','About'];
  const on=p.place==='rules'?'Categories & Rules':'Categories';
  const nTop=t.tops.length,nSub=d.categories.filter(c=>c.active&&c.parent).length;
  const head=`<div class="s-h"><div><h2>Categories <span class="ct">${nTop} top levels, ${nSub} sub-categories</span></h2><p class="sub">Your own categories for budgets and reports. Card points never use them.</p></div><div class="s-r">${p.search?`<input class="inp srch" data-srch placeholder="Find a category…" aria-label="Find a category">`:''}${p.hidden==='inline'&&t.hidden.length?`<label class="sw"><input type="checkbox" data-showhid> Show hidden</label>`:''}${p.add==='button'?`<button type="button" class="btn pri" data-add="">+ New category</button>`:''}</div></div>`;
  const list=p.layout==='cards'?listCards(p,t,h):p.layout==='panes'?listPanes(p,t,h):listTree(p,t,h);
  const rules=p.place==='rules'?`<section class="sf pn rules-stub"><div class="s-h"><h2>Categorization rules <span class="ct">471</span></h2><span class="dimt">The rules table stays as it is today.</span></div></section>`:'';
  return `<div class="sf tabs">${tabs.map(x=>`<button type="button" class="${x===on?'on':''}">${x}</button>`).join('')}</div><section data-region="list" class="cat">${head}${list}${hiddenBottom(p,t,h)}</section>${rules}`;}

Gallery.define({
  id:'settings-categories',
  name:'Settings: Categories',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap'],
  groups:[
   {id:'place',label:'Where it lives',controls:[
    {id:'place',label:'Place in Settings',type:'choice',options:[
      {id:'tab',label:'Its own tab',hint:'A Categories tab next to Rules.'},
      {id:'rules',label:'Shares the Rules tab',hint:'“Categories & Rules”: categories on top, the rules table below.'},
    ]},
   ]},
   {id:'list',label:'The category list',controls:[
    {id:'layout',label:'Layout',type:'choice',options:[
      {id:'tree',label:'One indented list',hint:'Top levels in bold, their sub-categories indented underneath.'},
      {id:'cards',label:'A card per top level',hint:'A grid of cards, each listing its sub-categories.'},
      {id:'panes',label:'Two panes',hint:'Top levels on the left; the one you pick shows its sub-categories on the right.'},
    ]},
    {id:'counts',label:'How much each is used',type:'choice',options:[
      {id:'cols',label:'Number columns',hint:'Transactions, rules and budget months, lined up.'},
      {id:'text',label:'One grey line',hint:'“202 transactions · 35 rules” after the name.'},
      {id:'hover',label:'Only on hover',hint:'Hidden until you point at a row.'},
    ]},
    {id:'typeShow',label:'Expense, income or both',type:'choice',options:[
      {id:'exceptions',label:'Only when not Expense',hint:'Most are expenses, so only Income and Both get a tag.'},
      {id:'all',label:'A tag on every row'},
      {id:'editor',label:'Only in the editor'},
    ]},
    {id:'collapse',label:'Top levels fold open and closed',type:'toggle',default:true},
    {id:'search',label:'Find box',type:'toggle',default:false},
    {id:'hidden',label:'Hidden categories',type:'choice',options:[
      {id:'bottom',label:'Folded list at the bottom',hint:'“Hidden (1)”, each with Show again.'},
      {id:'inline',label:'Greyed out in place',hint:'Behind a “Show hidden” switch.'},
    ]},
    {id:'locks',label:'Locked categories',type:'choice',options:[
      {id:'icon',label:'Lock icon',hint:'Hover it to see why: Work, Transfer, Unclassified, Fees & Interest.'},
      {id:'label',label:'“Used by the app” label'},
    ]},
   ]},
   {id:'edit',label:'Editing',controls:[
    {id:'editStyle',label:'Changing a category',type:'choice',options:[
      {id:'panel',label:'Side panel',hint:'Click a row; every field and action in a panel on the right. Same pattern as editing a benefit.'},
      {id:'inline',label:'Rename in place, ⋯ menu for the rest',hint:'Click the name to rename; the menu moves, hides, merges, deletes.'},
      {id:'window',label:'A centered window',hint:'Click a row; the same fields in a window.'},
    ]},
    {id:'reorder',label:'Reordering',type:'choice',options:[
      {id:'drag',label:'Drag handles'},
      {id:'arrows',label:'Up and down arrows on hover'},
      {id:'menu',label:'Move up / down in the menu or panel'},
    ]},
    {id:'moveTo',label:'Moving a sub-category to another top level',type:'choice',options:[
      {id:'picker',label:'Pick the new top level from a list'},
      {id:'drag',label:'Drag it under another top level',hint:'The list stays in the panel too.'},
    ]},
    {id:'add',label:'Adding',type:'choice',options:[
      {id:'rows',label:'“+ Add” at the end of each group',hint:'And “+ Add top level” at the bottom.'},
      {id:'button',label:'One “+ New category” button',hint:'The form asks which top level it goes under.'},
    ]},
   ]},
   {id:'merge',label:'Merging and deleting',controls:[
    {id:'mergeFlow',label:'Merging one category into another',type:'choice',options:[
      {id:'window',label:'A window that lists what moves',hint:'“Moves 202 transactions, 35 rules…”, then Merge or Cancel.'},
      {id:'strip',label:'An inline strip under the row',hint:'Pick the target, read the same sentence, Merge or Cancel.'},
    ]},
    {id:'deleteRule',label:'Delete for a category in use',type:'choice',options:[
      {id:'disabled',label:'Shown greyed out',hint:'With “In use: merge or hide it instead”.'},
      {id:'hidden',label:'Not shown',hint:'Delete appears only when nothing uses it.'},
    ]},
   ]},
   {id:'decided',label:'Decided earlier (Cards galleries)',open:false,controls:[
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',swatches:['#EEF2F7','#FFFFFF','#2563EB'],tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'current',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
    {id:'modals',label:'Windows and panels',type:'choice',locked:true,options:[{id:'buttons',label:'Close only with their buttons, never by clicking outside or Escape'}]},
   ]},
  ],
  render(p,d,h){D=d;P=p;H=h;
    return `<div class="app">${editor(p)}<nav class="appnav"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(n=>`<button type="button" class="${n==='Settings'?'on':''}">${n}</button>`).join('')}</div></nav><div class="main">${settings(p,d,h)}</div></div>`;
  },
  after(root,p){const h=H,t=tree(D),q=s=>root.querySelector(s),qa=s=>root.querySelectorAll(s);
    const scrim=q('[data-scrim]'),ed=q('[data-ed]'),mg=q('[data-mg]');
    const close=()=>{scrim.hidden=true;ed.hidden=true;mg.hidden=true;};
    const tops=t.tops.map(c=>c.name);
    const others=n=>D.categories.filter(c=>c.active&&c.name!==n);
    const openMerge=(n,anchor)=>{const c=t.find(n),opts=others(n).map(o=>`<option ${o.name===c.parent?'selected':''}>${h.esc(o.name)}</option>`).join('');
      const body=`<h3>Merge ${h.esc(n)} into another category</h3><label>Into<select class="inp" data-into>${opts}</select></label><p class="imp" data-imp></p><div class="ef-f"><span></span><span><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn pri bad-b" data-x>Merge</button></span></div>`;
      const sent=()=>{const into=root.querySelector('[data-into]').value;root.querySelector('[data-imp]').textContent=`Moves ${usage(c)} to ${into}. ${n} is then removed. Points don’t change.`;};
      if(p.mergeFlow==='strip'&&anchor){qa('.strip').forEach(x=>x.remove());const s=document.createElement('div');s.className='strip';s.innerHTML=body;anchor.after(s);s.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>s.remove());}
      else{mg.innerHTML=body;mg.hidden=false;scrim.hidden=false;mg.querySelectorAll('[data-x]').forEach(b=>b.onclick=close);}
      root.querySelector('[data-into]').onchange=sent;sent();};
    const openEd=(n,isNew,under)=>{const c=isNew?{name:'',parent:under||null,type:'expense',tx:0,rules:0,budgets:0}:t.find(n),lk=c.locked;
      const top=!c.parent,hasKids=(t.kids[c.name]||[]).length;
      const parentSel=`<label>Top level<select class="inp" ${lk||(hasKids&&!isNew)?'disabled':''}><option ${top?'selected':''}>None: it is a top level</option>${tops.filter(x=>x!==c.name).map(x=>`<option ${x===c.parent?'selected':''}>${h.esc(x)}</option>`).join('')}</select></label>`;
      const used=!isNew&&(c.tx||c.rules||c.budgets||hasKids);
      ed.innerHTML=`<h3>${isNew?'New category':'Edit category'}</h3>${lk?`<p class="mnote">🔒 ${h.esc(WHY[c.name])}, so the name, top level and type stay as they are.</p>`:''}<label>Name<input class="inp" value="${h.esc(c.name)}" ${lk?'disabled':''} placeholder="e.g. Cruises"></label>${p.moveTo==='picker'||p.moveTo==='drag'?parentSel:''}<fieldset><legend>Counts as</legend><div class="seg">${['expense','income','both'].map(k=>`<button type="button" class="${k===c.type?'on':''}" ${lk?'disabled':''}>${TYPE[k]}</button>`).join('')}</div></fieldset>${isNew?'':`<p class="imp">Used by ${usage(c)}${hasKids?`, with ${hasKids} sub-categor${hasKids===1?'y':'ies'}`:''}. A rename carries through all of them; points never change.</p>`}${p.reorder==='menu'&&!isNew?`<div class="rowb"><button type="button" class="btn sm">Move up</button><button type="button" class="btn sm">Move down</button></div>`:''}${isNew||lk?'':`<div class="dz"><button type="button" class="btn sm">Hide</button><button type="button" class="btn sm" data-m2="${h.esc(c.name)}">Merge into another…</button>${p.deleteRule==='hidden'&&used?'':`<button type="button" class="btn sm bad-b" ${used?'disabled title="In use: merge or hide it instead"':''}>Delete</button>`}</div>`}<div class="ef-f"><span></span><span><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn pri" data-x>${isNew?'Add':'Save'}</button></span></div>`;
      ed.hidden=false;scrim.hidden=false;ed.querySelectorAll('[data-x]').forEach(b=>b.onclick=close);
      ed.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{if(b.disabled)return;ed.querySelectorAll('.seg button').forEach(x=>x.classList.remove('on'));b.classList.add('on')});
      const m2=ed.querySelector('[data-m2]');if(m2)m2.onclick=()=>{close();openMerge(m2.dataset.m2,root.querySelector(`.rw[data-name="${CSS.escape(n)}"]`));};};
    // scrim clicks and Escape deliberately do nothing (modals close with their buttons only)
    qa('[data-edit]').forEach(r=>{const go=e=>{if(e.target.closest('button,summary,details,input'))return;openEd(r.dataset.edit)};r.onclick=go;r.onkeydown=e=>{if(e.key==='Enter')go(e)}});
    qa('[data-add]').forEach(b=>b.onclick=()=>{if(p.editStyle==='inline'&&b.dataset.add){const r=document.createElement('div');r.className='rw sub newrow';r.innerHTML=`<span class="nmw"><input class="inp" placeholder="New sub-category under ${h.esc(b.dataset.add)}" aria-label="New sub-category"></span><span class="acts"><button type="button" class="btn sm pri">Add</button><button type="button" class="btn sm">Cancel</button></span>`;b.before(r);r.querySelectorAll('button').forEach(x=>x.onclick=()=>r.remove());r.querySelector('input').focus();}else openEd('',true,b.dataset.add||null);});
    qa('[data-merge]').forEach(b=>b.onclick=()=>{b.closest('details').removeAttribute('open');openMerge(b.dataset.merge,b.closest('.rw'));});
    qa('[data-mv],[data-ty]').forEach(b=>b.onclick=()=>{b.closest('details').removeAttribute('open');openEd(b.dataset.mv||b.dataset.ty);});
    qa('[data-rn],[data-inl]').forEach(b=>b.onclick=e=>{const n=b.dataset.rn||b.dataset.inl;b.closest('details')?.removeAttribute('open');const nm=root.querySelector(`.rw[data-name="${CSS.escape(n)}"] .nm`);if(!nm||nm.querySelector('input'))return;const old=nm.textContent;nm.innerHTML=`<input class="inp rn" value="${h.esc(old)}" aria-label="Rename ${h.esc(old)}">`;const i=nm.querySelector('input');i.focus();i.select();const done=()=>{nm.textContent=i.value||old;};i.onblur=done;i.onkeydown=k=>{if(k.key==='Enter')i.blur();};e.stopPropagation();});
    qa('[data-fold]').forEach(b=>b.onclick=()=>{const g=b.closest('[data-grp]'),k=g&&g.querySelector('.kids');if(!k)return;k.hidden=!k.hidden;b.textContent=k.hidden?'▸':'▾';b.setAttribute('aria-expanded',String(!k.hidden));});
    qa('[data-pane]').forEach(b=>b.onclick=()=>{qa('[data-pane]').forEach(x=>x.classList.toggle('on',x===b));qa('[data-pv]').forEach(v=>v.hidden=v.dataset.pv!==b.dataset.pane);});
    const sh=q('[data-showhid]');if(sh)sh.onchange=()=>qa('.hid-grp').forEach(x=>x.hidden=!sh.checked);
    const sr=q('[data-srch]');if(sr)sr.oninput=()=>{const v=sr.value.trim().toLowerCase();qa('.rw[data-name]').forEach(r=>{const m=!v||r.dataset.name.toLowerCase().includes(v)||(r.dataset.under||'').toLowerCase().includes(v);r.style.display=m?'':'none';});};
  },
  css:`
#pv{--c-radius:13px;--c-density:1.25;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density))}
#pv *{box-sizing:border-box}
#pv [hidden]{display:none!important}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#pv button:disabled{opacity:.45;cursor:not-allowed}
#pv button:focus-visible,#pv input:focus-visible,#pv select:focus-visible,#pv summary:focus-visible,#pv [role=button]:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv h2,#pv h3{font-family:var(--f-h)}
#pv h2{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);margin:0}
#pv h3{font-size:15px;font-weight:600;margin:0 0 12px}
#pv .ct{font-weight:500;letter-spacing:0;text-transform:none;opacity:.85;margin-left:6px}
#pv .dimt{color:var(--tx3);font-size:12.5px}
#pv .app{display:flex;flex-direction:column;min-height:100vh}
#pv .main{width:100%;min-width:0;max-width:1180px;margin:0 auto;padding:calc(22px*var(--c-density)) calc(26px*var(--c-density));display:grid;gap:calc(20px*var(--c-density));align-content:start;position:relative}
#pv .appnav{display:flex;align-items:center;gap:14px;background:var(--surface);border-bottom:1px solid var(--line);padding:8px 16px;min-width:0}
#pv .brand{display:flex;align-items:center;gap:9px;font-family:var(--f-h);font-weight:600}
#pv .brand i{font-style:normal;width:30px;height:30px;border-radius:8px;background:var(--ac);color:var(--ac-fg);display:grid;place-items:center}
#pv .nv{display:flex;overflow-x:auto;gap:2px;min-width:0}
#pv .nv button{padding:7px 10px;border-radius:8px;color:var(--tx2);font-size:13.5px;white-space:nowrap}
#pv .nv button.on{background:var(--ac-soft);color:var(--ac);font-weight:600}
#pv .tabs{display:flex;gap:24px;padding:10px 22px}
#pv .tabs button{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12.5px}
#pv .tabs button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .cat{display:grid;gap:var(--gap)}
#pv .s-h{display:flex;justify-content:space-between;align-items:flex-end;gap:8px 16px;flex-wrap:wrap}
#pv .s-r{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#pv .sub{margin:4px 0 0;font-size:12.5px;color:var(--tx2)}
#pv .btn{font-size:12px;font-weight:500;color:var(--ac);padding:6px 11px;border:1px solid var(--line);border-radius:8px;white-space:nowrap;background:var(--surface)}
#pv .btn:hover:not(:disabled){background:var(--ac-soft)}#pv .btn.sm{font-size:11.5px;padding:4px 9px}
#pv .btn.pri{background:var(--ac);color:var(--ac-fg);border-color:var(--ac)}
#pv .btn.bad-b{color:var(--bad)}#pv .btn.pri.bad-b{background:var(--bad);border-color:var(--bad);color:#fff}
#pv .inp{font:inherit;font-size:13px;color:var(--tx);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 10px;width:100%}
#pv .srch{width:220px}
#pv .sw{display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--tx2)}
#pv .pn0{padding:6px 0}#pv .pn{padding:calc(var(--p)*1.1)}
#pv .rw{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:calc(7px*var(--c-density)) 16px;border-top:1px solid var(--line);font-size:13.5px}
#pv[data-counts="cols"] .rw{grid-template-columns:auto auto minmax(0,1fr) 96px 64px 104px auto auto}
#pv .lst>.rw:first-child,#pv .lst .grp:first-child>.rw.top,#pv .lst>.hd-row+.grp>.rw.top{border-top:0}
#pv .rw.top{font-weight:600}
#pv .rw.sub .nmw{padding-left:26px}
#pv [data-layout="cards"] .rw.sub .nmw,#pv [data-layout="panes"] .rw.sub .nmw{padding-left:0}
#pv .rw[data-edit]{cursor:pointer}#pv .rw[data-edit]:hover{background:var(--ac-soft)}
#pv .rw.off{opacity:.55}
#pv .hd-row{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);font-weight:600;border-top:0}
#pv .hd-row .nmw{grid-column:3}
#pv .nmw{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;grid-column:3}
#pv .nml{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%}
#pv .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pv .nm[data-inl]{cursor:text;border-bottom:1px dashed transparent}#pv .nm[data-inl]:hover{border-bottom-color:var(--tx3)}
#pv .nm .rn{width:200px;padding:3px 7px}
#pv .n{text-align:right;font-variant-numeric:tabular-nums;color:var(--tx2);font-weight:400}
#pv .ln{color:var(--tx3);font-size:12px;font-weight:400;white-space:nowrap}
#pv .ln.hov{visibility:hidden}#pv .rw:hover .ln.hov,#pv .rw:focus-within .ln.hov{visibility:visible}
#pv .ty{font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:20px;background:var(--raised);border:1px solid var(--line);color:var(--tx2)}
#pv .ty-income{color:var(--good)}#pv .ty-both{color:var(--warn)}
#pv .lk{font-size:11px;cursor:help}#pv .lk-l{font-size:10.5px;color:var(--tx3);border:1px dashed var(--line);border-radius:20px;padding:1px 7px;font-weight:500;cursor:help}
#pv .hd{color:var(--tx3);cursor:grab;letter-spacing:-2px;font-size:12px;grid-column:1}
#pv .fd,#pv .fd-sp{grid-column:2;width:18px;color:var(--tx3);font-size:12px}
#pv .ar{display:flex;gap:2px;visibility:hidden}#pv .rw:hover .ar,#pv .rw:focus-within .ar{visibility:visible}
#pv .ar button{width:22px;height:22px;border-radius:6px;color:var(--tx2)}#pv .ar button:hover{background:var(--ac-soft)}
#pv .acts{display:flex;justify-content:flex-end;min-width:22px}
#pv .chev{color:var(--tx3)}
#pv .km{position:relative}
#pv .km summary{list-style:none;cursor:pointer;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:var(--tx2);font-weight:700}
#pv .km summary::-webkit-details-marker{display:none}#pv .km summary:hover,#pv .km[open] summary{background:var(--ac-soft)}
#pv .km>div{position:absolute;right:0;top:calc(100% + 4px);z-index:6;display:grid;min-width:230px;padding:4px;background:var(--surface);border:1px solid var(--line);border-radius:9px;box-shadow:0 8px 22px rgba(15,23,42,.14);font-weight:400}
#pv .km>div button{text-align:left;padding:7px 9px;border-radius:6px;font-size:12.5px}
#pv .km>div button:hover:not(:disabled){background:var(--ac-soft)}#pv .km .bad{color:var(--bad)}
#pv .km hr{border:0;border-top:1px solid var(--line);margin:4px 0}
#pv .mnote{font-size:12px;color:var(--tx2);margin:6px 8px;line-height:1.45}
#pv .addr{display:block;text-align:left;width:100%;padding:calc(7px*var(--c-density)) 16px calc(7px*var(--c-density)) 60px;font-size:12.5px;color:var(--ac);border-top:1px dashed var(--line)}
#pv .addr.top{padding-left:42px;font-weight:600}
#pv [data-layout="cards"] .addr,#pv [data-layout="panes"] .addr{padding-left:16px}
#pv .newrow .nmw{padding-left:26px}#pv .newrow .inp{max-width:300px}
#pv .cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--gap);align-items:start}
#pv .ccard{overflow:visible;padding:4px 0}
#pv .ccard .rw.chd{border-top:0;font-size:14.5px}
#pv .addc{border:1px dashed var(--line);border-radius:var(--c-radius);min-height:80px;color:var(--ac);font-weight:600}
#pv .lgd{font-size:12px;color:var(--tx3);margin:0}
#pv[data-layout="cards"][data-counts="cols"] .rw{grid-template-columns:auto auto minmax(0,1fr) 44px 30px 34px auto auto;gap:6px}
#pv .panes{display:grid;grid-template-columns:240px minmax(0,1fr);gap:var(--gap);align-items:start}
#pv .pl{display:grid}
#pv .pli{display:flex;justify-content:space-between;padding:9px 16px;text-align:left;font-size:13.5px;border-left:3px solid transparent}
#pv .pli small{color:var(--tx3)}#pv .pli:hover{background:var(--ac-soft)}
#pv .pli.on{border-left-color:var(--ac);background:var(--ac-soft);color:var(--ac);font-weight:600}
#pv .pli.off{opacity:.55}
#pv .pr .rw.phd{border-top:0;font-size:15px}
#pv .emp{font-size:12.5px;color:var(--tx3);margin:10px 16px}
#pv .hb summary{cursor:pointer;padding:12px 16px;font-family:var(--f-h);font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3)}
#pv .rules-stub{opacity:.75}
#pv .ovl{position:sticky;top:0;height:0;z-index:20}
#pv .scrim{position:absolute;left:0;right:0;top:0;height:100vh;background:rgba(15,23,42,.28)}
#pv .ed{position:absolute;z-index:21;background:var(--surface);border:1px solid var(--line);box-shadow:0 18px 50px rgba(15,23,42,.22);display:grid;gap:14px;align-content:start;padding:22px}
#pv .ed.drw{top:0;right:0;height:100vh;width:400px;border-radius:var(--c-radius) 0 0 var(--c-radius);overflow:auto}
#pv .ed.win{top:12vh;left:50%;transform:translateX(-50%);width:460px;border-radius:var(--c-radius)}
#pv .ed label{display:grid;gap:5px;font-size:12px;color:var(--tx2);font-weight:500}
#pv .ed fieldset{border:0;padding:0;margin:0}#pv .ed legend{font-size:12px;color:var(--tx2);font-weight:500;margin-bottom:5px}
#pv .seg{display:inline-flex;border:1px solid var(--line);border-radius:9px;padding:2px;gap:2px}
#pv .seg button{padding:5px 12px;border-radius:7px;font-size:12.5px;color:var(--tx2)}#pv .seg button.on{background:var(--ac);color:var(--ac-fg)}
#pv .imp{font-size:12.5px;color:var(--tx2);margin:0;line-height:1.5;background:var(--raised);border:1px solid var(--line);border-radius:9px;padding:10px 12px}
#pv .rowb,#pv .dz{display:flex;gap:8px;flex-wrap:wrap}
#pv .dz{border-top:1px solid var(--line);padding-top:14px}
#pv .ef-f{display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid var(--line);padding-top:14px}
#pv .ef-f>span{display:flex;gap:8px}
#pv .strip{display:grid;gap:10px;margin:0 16px 10px;padding:14px;border:1px solid var(--ac);border-radius:10px;background:var(--ac-soft)}
#pv .strip h3{font-size:13px;margin:0}#pv .strip label{display:grid;gap:4px;font-size:12px;max-width:320px}
#pv .strip .ef-f{border-top:0;padding-top:0}
`,
});
})();
