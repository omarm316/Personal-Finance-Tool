import {useState} from 'react';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {fmt,fmtDate,showCategoryForType,sortedCats} from '../lib/format';

export function ReviewModal({txn,categories,onSave,onDiscard,onIgnore,onClose}){
  const[category,setCategory]=useState(txn.category_final||'');
  const[action,setAction]=useState(txn.action||'Expense');
  const[saving,setSaving]=useState(false);
  const[createRule,setCreateRule]=useState(txn.enrichment_source==='llm'||txn.enrichment_source==='fallback');
  /* When type changes, clear category if new type hides it */
  const handleTypeChange=(newType)=>{setAction(newType);if(!showCategoryForType(newType))setCategory('');};
  const handleSave=async()=>{
    setSaving(true);
    await onSave(txn.id,{category,action,needs_review:false});
    /* If checkbox is ticked and it's an LLM/fallback-sourced txn, create a rule */
    if(createRule&&showCategoryForType(action)&&category&&category!=='Unclassified'){
      try{await apiFetch(`/llm/create-rule-from-transaction/${txn.id}`,{method:'POST'});}
      catch(e){/* Non-fatal — rule creation failure shouldn't block the save */}
    }
    setSaving(false);onClose();
  };
  const isLlmOrFallback=txn.enrichment_source==='llm'||txn.enrichment_source==='fallback';
  return(
    <div className="review-overlay" style={{zIndex: 5000}}>
      <div className="review-panel" style={{maxWidth: 480}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
          <div>
            <h3 style={{fontSize:18,fontWeight:600,fontFamily:'Outfit'}}>Review Transaction</h3>
            <p style={{fontSize:13,color:'var(--text-secondary)',marginTop:4}}>{fmtDate(txn.date)} · <span className={txn.amount<0?'amount-neg':'amount-pos'}>{txn.amount<0?'-':'+'}{fmt(Math.abs(txn.amount))}</span></p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{padding:4, minHeight: 0}}>✕</button>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          <div className="review-field">
            <label>Description</label>
            <input className="search-input" value={txn.description_display||txn.description_raw} readOnly style={{background:'var(--surface)',color:'var(--text-secondary)',cursor:'default'}}/>
            {txn.description_display&&txn.description_display!==txn.description_raw&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:6,fontWeight:600}}>RAW: {txn.description_raw}</div>}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1.5fr',gap:16}}>
            <div className="review-field">
              <label>Type</label>
              <select className="filter-select" style={{width:'100%'}} value={action} onChange={e=>handleTypeChange(e.target.value)}>
                {TXN_TYPES.map(a=><option key={a}>{a}</option>)}
              </select>
            </div>
            {showCategoryForType(action)&&<div className="review-field">
              <label>Category</label>
              <select className="filter-select" style={{width:'100%'}} value={category} onChange={e=>setCategory(e.target.value)}>
                <option value="">— Select category —</option>
                {sortedCats(categories).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>}
          </div>

          {isLlmOrFallback&&showCategoryForType(action)&&
            <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--text-primary)',marginTop:8,cursor:'pointer',fontWeight:500}}>
              <input type="checkbox" style={{width:16,height:16}} checked={createRule} onChange={e=>setCreateRule(e.target.checked)}/>
              <span>Save as auto-categorization rule</span>
            </label>}
        </div>

        <div className="review-actions" style={{marginTop:32}}>
          <button type="button" className="btn btn-ghost" onClick={()=>{onIgnore(txn.id);onClose();}} title="Remove from review queue without categorizing">Ignore</button>
          <div style={{display:'flex',gap:12}}>
            <button type="button" className="btn btn-secondary" onClick={onDiscard}>Discard</button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'…':'✓ Save Changes'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── ConfirmModal — replaces all browser confirm()/prompt() ─────────────── */
