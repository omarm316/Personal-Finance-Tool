/* Settings › Categories: the editor for Omer's two-level personal category
   tree (top level › sub-category). Layout chosen in the design gallery, see
   docs/settings-categories-design.md: two panes, number columns, a side panel
   for edits, drag handles, a merge window. API: routers/categories.py.
   Windows and panels close only with their buttons, never by clicking outside
   or Escape. These categories feed budgets and reports; card points never
   read them. */
import {useState,useEffect} from 'react';
import ReactDOM from 'react-dom';
import {apiFetch} from '../lib/api';
import {ConfirmModal} from './ConfirmModal';
import {CategoryOptions} from './CategoryOptions';

const TYPE={expense:'Expense',income:'Income',both:'Both'};
const WHY={
  'Work':'Dashboards and budgets treat Work as income',
  'Transfer':'It marks money moving between your own accounts',
  'Unclassified':'Rules and the AI fall back to it',
  'Fees & Interest':'The card page’s annual-fee tile adds it up',
};
const fmtN=n=>Number(n||0).toLocaleString('en-US');
const dash=n=>n?fmtN(n):'–';
const count=(n,one,many)=>`${fmtN(n)} ${n===1?one:(many||one+'s')}`;
const andList=a=>a.length<2?(a[0]||''):`${a.slice(0,-1).join(', ')} and ${a[a.length-1]}`;
/* "202 transactions, 35 rules and 12 budget months" from a manage row or rename counts */
const usage=c=>andList([
  c.transactions&&count(c.transactions,'transaction'),
  c.splits&&count(c.splits,'split line'),
  c.rules&&count(c.rules,'rule'),
  c.budget_targets&&count(c.budget_targets,'budget month'),
].filter(Boolean));
const inUse=(c,cats)=>!!(c.transactions||c.splits||c.rules||c.budget_targets||cats.some(k=>k.parent_category===c.name));
const onKey=fn=>e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}};

const Lock=({name})=><span className="cx-lock" title={`Locked: ${WHY[name]||'the app relies on this name'}`} aria-label="Locked">🔒</span>;
const TypeTag=({t})=>t&&t!=='expense'?<span className={`cx-ty ${t}`}>{TYPE[t]}</span>:null;

export function CategoryEditor({toast,onChanged}){
  const[cats,setCats]=useState(null);
  const[sel,setSel]=useState(null);
  const[q,setQ]=useState('');
  const[panel,setPanel]=useState(null);   // {id} to edit one, {parent} to add one
  const[mergeId,setMergeId]=useState(null);
  const[cm,setCm]=useState(null);
  const[drag,setDrag]=useState(null);     // {kind:'top'|'sub', name}
  const[over,setOver]=useState(null);     // {name, after}

  const load=async()=>{
    try{setCats(await apiFetch('/categories/manage'));}
    catch(e){toast('Could not load categories: '+e.message,'error');setCats(c=>c||[]);}
  };
  useEffect(()=>{load();},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const changed=async()=>{await load();onChanged&&onChanged();};

  if(!cats)return <div className="loading"><div className="spinner"/></div>;

  const active=cats.filter(c=>c.is_active);
  const tops=active.filter(c=>!c.parent_category);
  const kidsOf=name=>active.filter(c=>c.parent_category===name);
  const hidden=cats.filter(c=>!c.is_active);
  const ql=q.trim().toLowerCase();
  const hit=name=>!!name&&name.toLowerCase().includes(ql);
  const showTops=ql?tops.filter(t=>hit(t.name)||kidsOf(t.name).some(k=>hit(k.name))):tops;
  const cur=showTops.find(t=>t.name===sel)||showTops[0]||null;
  const curKids=cur?(!ql||hit(cur.name)?kidsOf(cur.name):kidsOf(cur.name).filter(k=>hit(k.name))):[];
  const curKidsTx=cur?kidsOf(cur.name).reduce((s,k)=>s+(k.transactions||0),0):0;
  const showHidden=ql?hidden.filter(c=>hit(c.name)||hit(c.parent_category)):hidden;
  const topNames=tops.map(t=>t.name);
  const kidNames=cur?kidsOf(cur.name).map(k=>k.name):[];

  /* ── Order: the API takes the whole tree as one list of names ── */
  const saveOrder=async(newTops,newKids)=>{
    const order=[],seen=new Set(),push=n=>{if(!seen.has(n)){seen.add(n);order.push(n);}};
    [...newTops,...cats.filter(c=>!c.parent_category&&!c.is_active).map(c=>c.name)].forEach(t=>{
      push(t);
      (newKids&&newKids.parent===t?newKids.names:kidsOf(t).map(k=>k.name)).forEach(push);
      cats.filter(c=>c.parent_category===t).forEach(c=>push(c.name));   // hidden ones keep their top level
    });
    cats.forEach(c=>push(c.name));
    const idx=Object.fromEntries(order.map((n,i)=>[n,i]));
    setCats(prev=>[...prev].sort((a,b)=>idx[a.name]-idx[b.name]));
    try{await apiFetch('/categories/reorder',{method:'POST',body:JSON.stringify({names:order})});onChanged&&onChanged();}
    catch(e){toast('Could not save the new order: '+e.message,'error');load();}
  };
  const moveTo=(kind,list,name,to)=>{
    const rest=list.filter(n=>n!==name);
    const i=Math.max(0,Math.min(rest.length,to));
    const next=[...rest.slice(0,i),name,...rest.slice(i)];
    if(next.every((n,j)=>n===list[j]))return;
    if(kind==='top')saveOrder(next,null);
    else saveOrder(topNames,{parent:cur.name,names:next});
  };
  const drop=(kind,list)=>{
    const d=drag,o=over;setDrag(null);setOver(null);
    if(!d||d.kind!==kind||!o||o.name===d.name)return;
    const rest=list.filter(n=>n!==d.name);
    moveTo(kind,list,d.name,rest.indexOf(o.name)+(o.after?1:0));
  };
  const dropProps=(kind,name,list)=>({
    onDragOver:e=>{
      if(!drag||drag.kind!==kind)return;
      e.preventDefault();e.dataTransfer.dropEffect='move';
      const r=e.currentTarget.getBoundingClientRect(),after=e.clientY>r.top+r.height/2;
      if(!over||over.name!==name||over.after!==after)setOver({name,after});
    },
    onDrop:e=>{e.preventDefault();drop(kind,list);},
  });
  const dropCls=name=>!drag?'':drag.name===name?'cx-dragging':over&&over.name===name?(over.after?'cx-drop-after':'cx-drop-before'):'';
  const handle=(kind,name,list)=>ql
    ?<span className="cx-hd off" aria-hidden="true">⋮⋮</span>
    :<span className="cx-hd" data-hd={name} role="button" tabIndex={0} draggable
      title="Drag to reorder (or focus it and use the arrow keys)" aria-label={`Reorder ${name} with the arrow keys`}
      onClick={e=>e.stopPropagation()}
      onKeyDown={e=>{
        if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;
        e.preventDefault();e.stopPropagation();
        moveTo(kind,list,name,list.indexOf(name)+(e.key==='ArrowUp'?-1:1));
        setTimeout(()=>document.querySelector(`[data-hd="${CSS.escape(name)}"]`)?.focus(),0);
      }}
      onDragStart={e=>{
        e.stopPropagation();e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',name);
        const row=e.currentTarget.parentElement;if(row)e.dataTransfer.setDragImage(row,24,row.offsetHeight/2);
        setDrag({kind,name});
      }}
      onDragEnd={()=>{setDrag(null);setOver(null);}}>⋮⋮</span>;

  /* ── Actions ── */
  const setActive=async(c,on)=>{
    try{
      await apiFetch(`/categories/${c.id}`,{method:'PATCH',body:JSON.stringify({is_active:on})});
      toast(on?`${c.name} is back in the pickers`:`${c.name} is hidden. Past transactions keep it; it’s under Hidden at the bottom.`);
      setPanel(null);await changed();
    }catch(e){toast(e.message,'error');}
  };
  const askDelete=c=>setCm({
    title:`Delete ${c.name}?`,body:'Nothing uses it, so nothing else changes.',confirmLabel:'Delete',danger:true,
    onConfirm:async()=>{
      try{await apiFetch(`/categories/${c.id}`,{method:'DELETE'});toast(`${c.name} deleted`);setPanel(null);await changed();}
      catch(e){toast(e.message,'error');}
    },
  });
  const saved=async top=>{setPanel(null);if(top)setSel(top);await changed();};
  const merged=async into=>{
    const t=cats.find(c=>c.name===into);
    setMergeId(null);setSel(t?.parent_category||into);await changed();
  };

  const panelCat=panel&&panel.id!=null?cats.find(c=>c.id===panel.id):null;
  const mergeCat=mergeId!=null?cats.find(c=>c.id===mergeId):null;
  const nums=c=><>
    <span className="cx-n">{dash(c.transactions)}</span>
    <span className="cx-n">{dash(c.rules)}</span>
    <span className="cx-n">{dash(c.budget_targets)}</span>
  </>;
  const colHead=label=><div className="cx-row colh" aria-hidden="true">
    <span/><span>{label}</span><span className="cx-n">Transactions</span><span className="cx-n">Rules</span><span className="cx-n">Budget months</span><span/>
  </div>;

  return(
    <div className="cx">
      {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}
      <div className="cx-head">
        <div>
          <h2>Categories <small>{count(tops.length,'top level')}, {count(active.length-tops.length,'sub-category','sub-categories')}</small></h2>
          <div className="cx-sub">Your own categories for budgets and reports. Card points never use them.</div>
        </div>
        <input className="search-input cx-find" placeholder="Find a category…" aria-label="Find a category" value={q} onChange={e=>setQ(e.target.value)}/>
      </div>

      <div className="cx-panes">
        <div className="card cx-box cx-left" aria-label="Top levels">
          {showTops.map(t=>{const n=kidsOf(t.name).length;return(
            <div key={t.id} className={`cx-pli ${cur&&cur.name===t.name?'on':''} ${dropCls(t.name)}`}
              role="button" tabIndex={0} aria-pressed={!!cur&&cur.name===t.name} aria-label={t.name}
              onClick={()=>setSel(t.name)} onKeyDown={onKey(()=>setSel(t.name))}
              {...dropProps('top',t.name,topNames)}>
              {handle('top',t.name,topNames)}
              <span className="cx-nm"><span>{t.name}</span>{t.is_locked&&<Lock name={t.name}/>}</span>
              <small title={n?count(n,'sub-category','sub-categories'):undefined}>{n||''}</small>
            </div>);})}
          {ql&&!showTops.length&&<div className="cx-empty">No category matches “{q.trim()}”.</div>}
          {!ql&&<button type="button" className="cx-add" onClick={()=>setPanel({parent:null})}>+ Add top level</button>}
        </div>

        <div className="card cx-box cx-right">
          {cur?<>
            {colHead('Category')}
            <div className="cx-row top" role="button" tabIndex={0} aria-label={`Edit ${cur.name}`} onClick={()=>setPanel({id:cur.id})} onKeyDown={onKey(()=>setPanel({id:cur.id}))}>
              <span/>
              <span className="cx-nm"><span>{cur.name}</span>{cur.is_locked&&<Lock name={cur.name}/>}<TypeTag t={cur.category_type}/></span>
              <span className="cx-n" title={curKidsTx?`On ${cur.name} itself. Its sub-categories hold ${count(curKidsTx,'more transaction')}.`:undefined}>{dash(cur.transactions)}</span>
              <span className="cx-n">{dash(cur.rules)}</span>
              <span className="cx-n">{dash(cur.budget_targets)}</span>
              <span className="cx-chev" aria-hidden="true">›</span>
            </div>
            {curKids.map(k=>(
              <div key={k.id} className={`cx-row sub ${dropCls(k.name)}`} role="button" tabIndex={0} aria-label={`Edit ${k.name}`}
                onClick={()=>setPanel({id:k.id})} onKeyDown={onKey(()=>setPanel({id:k.id}))}
                {...dropProps('sub',k.name,kidNames)}>
                {handle('sub',k.name,kidNames)}
                <span className="cx-nm"><span>{k.name}</span>{k.is_locked&&<Lock name={k.name}/>}<TypeTag t={k.category_type}/></span>
                {nums(k)}
                <span className="cx-chev" aria-hidden="true">›</span>
              </div>))}
            {!curKids.length&&<div className="cx-empty">No sub-categories. Rows sit on {cur.name} itself.</div>}
            {!ql&&!cur.is_locked&&<button type="button" className="cx-add" onClick={()=>setPanel({parent:cur.name})}>+ Add sub-category to {cur.name}</button>}
          </>:<div className="cx-empty">Pick a top level on the left.</div>}
        </div>
      </div>

      {showHidden.length>0&&<details className="card cx-box cx-hidden" open={ql?true:undefined}>
        <summary>Hidden <small>{showHidden.length}</small></summary>
        {colHead('Category')}
        {showHidden.map(c=>(
          <div key={c.id} className="cx-row hid" role="button" tabIndex={0} aria-label={`Edit ${c.name} (hidden)`} onClick={()=>setPanel({id:c.id})} onKeyDown={onKey(()=>setPanel({id:c.id}))}>
            <span/>
            <span className="cx-nm"><span>{c.name}</span>{c.parent_category&&<span className="cx-under">under {c.parent_category}</span>}</span>
            {nums(c)}
            <span><button type="button" className="btn btn-xs btn-ghost" onClick={e=>{e.stopPropagation();setActive(c,true);}}>Show again</button></span>
          </div>))}
      </details>}

      {panel&&(panel.id==null||panelCat)&&<CategoryPanel key={panel.id??`new-${panel.parent}`}
        cat={panelCat} parent={panel.parent} cats={cats} toast={toast}
        onCancel={()=>setPanel(null)} onSaved={saved}
        onHide={c=>setActive(c,false)} onShow={c=>setActive(c,true)}
        onMerge={c=>{setPanel(null);setMergeId(c.id);}} onDelete={askDelete}/>}
      {mergeCat&&<MergeWindow cat={mergeCat} cats={cats} toast={toast} onCancel={()=>setMergeId(null)} onDone={merged}/>}
    </div>
  );
}

/* Side panel for one category, or a new one. Closes only with its buttons. */
function CategoryPanel({cat,parent,cats,toast,onCancel,onSaved,onHide,onShow,onMerge,onDelete}){
  const isNew=!cat;
  const locked=!!cat?.is_locked;
  const parentType=parent?cats.find(c=>c.name===parent)?.category_type:null;
  const[name,setName]=useState(cat?.name||'');
  const[top,setTop]=useState(cat?(cat.parent_category||''):(parent||''));
  const[type,setType]=useState(cat?.category_type||parentType||'expense');
  const[busy,setBusy]=useState(false);
  const kids=cat?cats.filter(c=>c.parent_category===cat.name):[];
  const activeKids=kids.filter(k=>k.is_active);
  const kidsTx=kids.reduce((s,k)=>s+(k.transactions||0),0);
  const used=!!cat&&inUse(cat,cats);
  /* Work, Transfer and Unclassified take no sub-categories: the app checks those names exactly */
  const tops=cats.filter(c=>c.is_active&&!c.parent_category&&!c.is_locked&&(!cat||c.id!==cat.id)).map(c=>c.name);
  if(top&&!tops.includes(top))tops.push(top);   // its top level is hidden: keep it selectable
  const what=cat?usage(cat):'';

  const save=async()=>{
    const nm=name.trim();
    if(!nm||busy)return;
    setBusy(true);
    try{
      if(isNew){
        await apiFetch('/categories',{method:'POST',body:JSON.stringify({name:nm,parent_category:top||null,category_type:type})});
        toast(`Added ${top?`${top} › `:''}${nm}`);
      }else{
        const body={};
        if(nm!==cat.name)body.name=nm;
        if(top!==(cat.parent_category||''))body.parent_category=top;
        if(type!==cat.category_type)body.category_type=type;
        if(!Object.keys(body).length){onCancel();return;}
        const r=await apiFetch(`/categories/${cat.id}`,{method:'PATCH',body:JSON.stringify(body)});
        const moved=r.renamed&&usage(r.renamed);
        toast(body.name?`Renamed ${cat.name} to ${nm}${moved?`, carried through ${moved}`:''}`:`Saved ${nm}`);
      }
      await onSaved(top||nm);
    }catch(e){toast(e.message,'error');setBusy(false);}
  };

  return ReactDOM.createPortal(<>
    <div className="cx-scrim"/>
    <aside className="cx-panel" role="dialog" aria-modal="true" aria-labelledby="cx-p-title">
      <div className="cx-pbody">
        <h3 id="cx-p-title">{isNew?(parent?`New sub-category in ${parent}`:'New top level'):locked?cat.name:'Edit category'}</h3>
        {locked&&<div className="cx-note">🔒 {WHY[cat.name]}, so its name, top level and type stay as they are. You can still drag it to another place in the list.</div>}
        {cat&&!cat.is_active&&<div className="cx-note">Hidden: past transactions keep it, but the pickers don’t offer it.</div>}
        <label className="cx-field">Name
          <input className="search-input" value={name} onChange={e=>setName(e.target.value)} disabled={locked||busy}
            placeholder="e.g. Cruises" maxLength={100} autoFocus={isNew} onKeyDown={e=>{if(e.key==='Enter')save();}}/>
        </label>
        <label className="cx-field">Top level
          <select className="sel-drop" value={top} onChange={e=>setTop(e.target.value)} disabled={locked||busy||kids.length>0} style={{width:'100%'}}>
            <option value="">None: it is a top level</option>
            {tops.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
          {!locked&&kids.length>0&&<span className="cx-hint">It has sub-categories, so it stays a top level (two levels only).</span>}
        </label>
        <div className="cx-field"><span id="cx-p-type">Counts as</span>
          <div className="cx-seg" role="group" aria-labelledby="cx-p-type">
            {Object.entries(TYPE).map(([k,l])=><button type="button" key={k} className={type===k?'on':''} aria-pressed={type===k} disabled={locked||busy} onClick={()=>setType(k)}>{l}</button>)}
          </div>
        </div>
        {cat&&<div className="cx-note">
          {what?`Used by ${what}.`:'Nothing uses it yet.'}
          {kids.length?` Its ${count(kids.length,'sub-category','sub-categories')} hold ${count(kidsTx,'more transaction')}.`:''}
          {what&&!locked?' A rename carries through all of them; card points never change.':''}
        </div>}
        {cat&&!locked&&<div className="cx-danger">
          {cat.is_active
            ?<button type="button" className="btn btn-sm btn-ghost" onClick={()=>onHide(cat)} disabled={busy||activeKids.length>0}
              title={activeKids.length?'Hide or move its sub-categories first':'Past transactions keep it; the pickers stop offering it'}>Hide</button>
            :<button type="button" className="btn btn-sm btn-ghost" onClick={()=>onShow(cat)} disabled={busy}>Show again</button>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={()=>onMerge(cat)} disabled={busy||kids.length>0}
            title={kids.length?'Move or merge its sub-categories first':undefined}>Merge into another…</button>
          <button type="button" className="btn btn-sm btn-ghost cx-del" onClick={()=>onDelete(cat)} disabled={busy||used}
            title={used?'In use: merge or hide it instead':undefined}>Delete</button>
          {(used||activeKids.length>0)&&<div className="cx-hint" style={{width:'100%'}}>
            {activeKids.length>0?'Hide, merge and delete wait until its sub-categories move. ':''}
            {used&&!activeKids.length?`Delete is only for categories nothing uses: ${cat.is_active?'merge or hide this one':'merge this one into another'} instead.`:''}
          </div>}
        </div>}
      </div>
      <div className="cx-pfoot">
        {locked
          ?<button type="button" className="btn btn-sm btn-primary" onClick={onCancel}>Close</button>
          :<>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={busy||!name.trim()}>{busy?'Saving…':isNew?'Add':'Save'}</button>
          </>}
      </div>
    </aside>
  </>,document.body);
}

/* Merge window: pick where everything goes, read what moves, then Merge or Cancel. */
function MergeWindow({cat,cats,toast,onCancel,onDone}){
  const targets=cats.filter(c=>c.is_active&&c.id!==cat.id);
  const[into,setInto]=useState(cat.parent_category&&targets.some(t=>t.name===cat.parent_category)?cat.parent_category:(targets[0]?.name||''));
  const[busy,setBusy]=useState(false);
  const what=usage(cat);
  const go=async()=>{
    if(!into||busy)return;
    setBusy(true);
    try{
      const r=await apiFetch(`/categories/${cat.id}/merge`,{method:'POST',body:JSON.stringify({into})});
      const moved=usage(r.moved||{});
      toast(`Merged ${cat.name} into ${into}${moved?`: moved ${moved}`:''}`);
      await onDone(into);
    }catch(e){toast(e.message,'error');setBusy(false);}
  };
  return ReactDOM.createPortal(
    <div className="modal-overlay" style={{zIndex:2100}}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cx-m-title">
        <div className="modal-header"><div className="modal-title" id="cx-m-title">Merge {cat.name} into another category</div></div>
        <div className="modal-body" style={{display:'grid',gap:14}}>
          <label className="cx-field">Into
            <select className="sel-drop" value={into} onChange={e=>setInto(e.target.value)} disabled={busy} style={{width:'100%'}}>
              <CategoryOptions categories={targets}/>
            </select>
          </label>
          <div className="cx-note">
            {what?`Moves ${what} to ${into}.`:`Nothing uses ${cat.name} yet.`}
            {cat.budget_targets?' Budget months both have are added together.':''}
            {` ${cat.name} is then removed. Card points don’t change.`}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn" onClick={go} disabled={busy||!into}
            style={{background:'var(--red)',borderColor:'var(--red)',boxShadow:'none'}}>{busy?'Merging…':'Merge'}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
