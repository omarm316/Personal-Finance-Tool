import {useState} from 'react';
import {CIcon} from './ui/CIcon';
import {Window} from './ui/Window';
import {catLabel} from '../lib/categories';
import {ENRICH_LABEL,IMPORT_LABEL,is2027,isBudget,KINDS,kindLabel,longDate,signed} from '../lib/txnView';

const typeOf=t=>t.action_display||t.action;
const nameOf=t=>t.description_display||t.description_raw||'';
const fmtPts=n=>(n>0?'+':'')+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});

/* How the card scores the row: merchant category, brand, kind and foreign,
   edited in place, then the points. Never a dollar value per point. */
function CardEarning({t,lists,onSave,toast}){
  const r27=is2027(t);
  const curMc=r27?(t.merchant_category||''):(t.points_category||'');
  const[d,setD]=useState(null);
  const[busy,setBusy]=useState(false);
  const[adj,setAdj]=useState(false);
  const pe=t.points_earn;
  const[adjVal,setAdjVal]=useState(pe&&pe.classification==='manual_override'?String(Math.round(pe.points_estimated)):'');
  const start=()=>setD({mc:curMc,brand:t.brand||'',kind:t.txn_kind||'',foreign:!!t.is_foreign});
  const brandDefault=name=>(lists.brands.find(b=>b.name===name)||{}).merchant_category||'';
  const save=async()=>{
    const u={};
    if(r27){
      if(d.mc!==curMc)u.merchant_category=d.mc;
      if(d.brand!==(t.brand||''))u.brand=d.brand;
      if(d.kind&&d.kind!==(t.txn_kind||''))u.txn_kind=d.kind;
      if(d.foreign!==!!t.is_foreign)u.is_foreign=d.foreign;
    }else if(d.mc&&d.mc!==curMc)u.points_category=d.mc;
    if(!Object.keys(u).length){setD(null);return;}
    setBusy(true);
    const ok=await onSave(t.id,u,'Card earning saved');
    setBusy(false);
    if(ok)setD(null);
  };
  const saveAdj=async()=>{
    if(adjVal===''||isNaN(Number(adjVal)))return;
    setBusy(true);const ok=await onSave(t.id,{points_earn_override:Number(adjVal)},'Points override saved');setBusy(false);
    if(ok)setAdj(false);
  };
  const resetAdj=async()=>{
    setBusy(true);const ok=await onSave(t.id,{clear_points_earn_override:true},'Back to the automatic points');setBusy(false);
    if(ok){setAdj(false);setAdjVal('');}
  };
  const off={disabled:true,title:'Fills in on rows from January 1, 2027'};
  const dash=<span className="c-mut">—</span>;
  const mcGroups=()=>{
    const tops=lists.merchantCats.filter(c=>!c.parent);
    return tops.map(top=>{
      const kids=lists.merchantCats.filter(c=>c.parent===top.name);
      return kids.length
        ?<optgroup key={top.name} label={top.name}><option value={top.name}>{top.name}</option>{kids.map(k=><option key={k.name} value={k.name}>{k.name}</option>)}</optgroup>
        :<option key={top.name} value={top.name}>{top.name}</option>;
    });
  };
  const legacyOpts=lists.pointsCats.filter(c=>c.is_active||c.name===curMc);
  const cls=pe?pe.classification:null;
  const ptsLabel={clawback:'Points clawback',excluded:'Not counted for points',manual_override:'Manual override'}[cls]||'Points earned';
  const ptsCat=pe&&(pe.points_category||(r27?t.merchant_category:null));
  return(
    <div className="c-box">
      <div className="c-box-h"><span className="c-lbl">Card earning</span>{!d&&<button type="button" className="c-lnk" onClick={start}>Edit</button>}</div>
      <div className="tx-ecells">
        <div className="tx-ecl"><span className="c-lbl">Merchant category</span>
          {d?<select className="c-sel" aria-label="Merchant category" value={d.mc} onChange={e=>setD({...d,mc:e.target.value})}>
              <option value="" disabled={!r27&&!!curMc}>Not classified</option>
              {r27?mcGroups():legacyOpts.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            :curMc?<b title={curMc}>{curMc}</b>:<i className="c-mut">Not classified</i>}
        </div>
        <div className="tx-ecl"><span className="c-lbl">Brand</span>
          {d?(r27
              ?<select className="c-sel" aria-label="Brand" value={d.brand} onChange={e=>{const b=e.target.value;setD({...d,brand:b,mc:!d.mc&&b?brandDefault(b):d.mc});}}>
                <option value="">None</option>
                {lists.brands.map(b=><option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
              :<select className="c-sel" aria-label="Brand" {...off}><option>—</option></select>)
            :r27&&t.brand?<b title={t.brand}>{t.brand}</b>:dash}
        </div>
        <div className="tx-ecl"><span className="c-lbl">Kind</span>
          {d?(r27
              ?<select className="c-sel" aria-label="Kind" value={d.kind} onChange={e=>setD({...d,kind:e.target.value})}>
                {!d.kind&&<option value="" disabled>Not set</option>}
                {KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}
              </select>
              :<select className="c-sel" aria-label="Kind" {...off}><option>—</option></select>)
            :r27&&t.txn_kind?<b>{kindLabel(t.txn_kind)}</b>:dash}
        </div>
        <div className="tx-ecl"><span className="c-lbl">Foreign</span>
          {d?<label className="c-cb"><input type="checkbox" checked={r27&&d.foreign} onChange={e=>setD({...d,foreign:e.target.checked})} {...(r27?{}:off)}/> Foreign</label>
            :r27?<b>{t.is_foreign?'Yes':'No'}</b>:dash}
        </div>
      </div>
      {d&&<div className="tx-eacts">
        <button type="button" className="c-btn ghost sm" onClick={()=>setD(null)} disabled={busy}>Cancel</button>
        <button type="button" className="c-btn pri sm" onClick={save} disabled={busy}>{busy?'Saving…':'Save'}</button>
      </div>}
      {!r27&&<p className="tx-later">Brand, kind and foreign fill in on rows from January 1, 2027.</p>}
      {!pe
        ?<p className="c-mut" style={{margin:'6px 0 0'}}>No card points on this account.</p>
        :<div className={`tx-earn ${cls||'earn'}`}>
          <div className="c-box-h"><span className="c-lbl">{ptsLabel}</span>
            <button type="button" className="c-lnk" onClick={()=>setAdj(!adj)}>{adj?'Cancel':cls==='manual_override'?'Edit override':'Adjust'}</button>
          </div>
          <div className="tx-er">
            <span>{ptsCat?<>{pe.points_category_l1&&`${pe.points_category_l1} › `}{ptsCat}</>:<i>Base rate</i>}{pe.earn_rate!=null&&` · ${pe.earn_rate}x`}</span>
            <b className="c-val">{fmtPts(pe.points_estimated)} <small>{pe.currency||'points'}</small></b>
          </div>
          {adj&&<div className="tx-adj">
            <input className="c-inp" type="number" step="1" value={adjVal} onChange={e=>setAdjVal(e.target.value)} placeholder="Points" aria-label="Points"/>
            <button type="button" className="c-btn sm" onClick={saveAdj} disabled={busy}>Save</button>
            {cls==='manual_override'&&<button type="button" className="c-btn ghost sm" onClick={resetAdj} disabled={busy}>Back to automatic</button>}
          </div>}
        </div>}
    </div>
  );
}

/* Details window (ⓘ or a row click): read-only fact tiles; editing happens
   in the row. Tag pills and the Card earning box save straight away. */
export function TxnDetailsWindow({t,lists,onSave,onClose,onSplit,onRule,onDelete,toast}){
  const ty=typeOf(t);
  const forOthers=t.category_final==='For Others';
  const facts=[
    ['Date',longDate(t.date)],
    ['Amount',signed(t.amount)],
    ['Account',t.account_name],
    ['Type',ty],
    ['Category',isBudget(ty)?catLabel(t.category_final)||'Unclassified':'—'],
    ...(t.network?[['Network',t.network]]:[]),
    ...(t.spender?[['Spender',t.spender]]:[]),
    ['Confidence',t.category_confidence!=null?Math.round(t.category_confidence*100)+'%':'—'],
    ['Import source',IMPORT_LABEL[t.import_source||'plaid']||t.import_source],
    ['Enrichment',t.enrichment_source?(ENRICH_LABEL[t.enrichment_source]||t.enrichment_source):'—'],
  ];
  const tag=(u,msg)=>onSave(t.id,u,msg);
  return(
    <Window label="Transaction details">
      <div className="c-wb">
        <div className="c-wh">
          <div><h3>Transaction details</h3><span className="c-mut">ID #{t.id}</span></div>
          <button type="button" className="c-x" aria-label="Close details" onClick={onClose}><CIcon name="x"/></button>
        </div>
        <div className="c-box">
          <span className="c-lbl">Description</span>
          <b>{nameOf(t)}</b>
          {nameOf(t)!==t.description_raw&&<span className="c-mut">Raw: <code>{t.description_raw}</code></span>}
        </div>
        <div className="tx-tiles">
          {facts.map(([k,v])=><div key={k} className="tx-tile"><span className="c-lbl">{k}</span><b>{v}</b></div>)}
        </div>
        <CardEarning key={t.id} t={t} lists={lists} onSave={onSave} toast={toast}/>
        <div className="tx-tpl">
          <button type="button" className={`tx-tp ${t.is_gcb?'on gcb':''}`} aria-pressed={!!t.is_gcb} onClick={()=>tag({is_gcb:!t.is_gcb},t.is_gcb?'GCB tag removed':'Tagged as GCB')}>⭐ {t.is_gcb?'GCB tagged':'Tag as GCB'}</button>
          {isBudget(ty)&&(forOthers
            ?<span className="tx-tp on" title="Set by the For Others category; pick another category to undo">👥 For others</span>
            :<button type="button" className="tx-tp" onClick={()=>tag({category:'For Others',needs_review:false},'Marked for others')}>👥 Mark for others</button>)}
          <button type="button" className={`tx-tp ${t.is_excluded?'on exc':''}`} aria-pressed={!!t.is_excluded} title="Leave it out of every total without deleting it"
            onClick={()=>tag({is_excluded:!t.is_excluded},t.is_excluded?'Counted in totals again':'Excluded from totals')}>⊘ {t.is_excluded?'Excluded':'Exclude'}</button>
          {t.is_locked&&<button type="button" className="tx-tp on" title="Unlock: let sync and rules change it again" onClick={()=>tag({is_locked:false},'Unlocked')}>🔒 Locked</button>}
          {t.needs_review&&<span className="tx-tp warn">⚠ Needs review</span>}
        </div>
        {t.is_split&&(t.splits||[]).length>0&&<div className="tx-dsp">
          <span className="c-lbl">Splits ({t.splits.length})</span>
          {t.splits.map(s=><div key={s.id} className="tx-dspr">
            <span>{s.description||<i className="c-mut">No note</i>}{s.category&&<small>{catLabel(s.category)}</small>}</span>
            <span className="tt">{s.action||'Expense'}</span>
            <b className="c-val" style={{fontSize:13}}>{signed(s.amount)}</b>
          </div>)}
        </div>}
        <div className="c-wf">
          <div className="c-row">
            <button type="button" className="c-btn sm" onClick={onSplit}>{t.is_split?'✎ Edit splits':'⊕ Split'}</button>
            <button type="button" className="c-btn sm" onClick={onRule}>Create rule</button>
            <button type="button" className="c-btn sm danger" onClick={onDelete}>Delete</button>
          </div>
          <button type="button" className="c-btn ghost sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </Window>
  );
}
