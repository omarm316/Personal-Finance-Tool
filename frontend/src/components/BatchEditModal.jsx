import {useState} from 'react';
import {TXN_TYPES} from '../lib/constants';
import {sortedCats} from '../lib/format';

export function BatchEditModal({count,categories,onSave,onClose}){
  const[action,setAction]=useState('');      // '' = keep existing
  const[category,setCategory]=useState(''); // '' = keep existing
  const[gcbAction,setGcbAction]=useState(''); // '' | 'tag' | 'untag'
  const[forOthersAction,setForOthersAction]=useState(''); // '' | 'tag' | 'untag'
  const[markReviewed,setMarkReviewed]=useState(false);
  const[saving,setSaving]=useState(false);
  const save=async()=>{
    const updates={};
    if(action) updates.action=action;
    if(category) updates.category=category;
    if(gcbAction==='tag') updates.is_gcb=true;
    if(gcbAction==='untag') updates.is_gcb=false;
    if(forOthersAction==='tag') updates.is_for_others=true;
    if(forOthersAction==='untag') updates.is_for_others=false;
    if(markReviewed) updates.needs_review=false;
    if(!Object.keys(updates).length){toast('No changes selected','error');return;}
    setSaving(true);
    try{await onSave(updates);}
    catch(e){}
    finally{setSaving(false);}
  };
  const label={fontSize:12,fontWeight:500,color:'var(--text-secondary)',marginBottom:4,display:'block'};
  return(
    <div className="modal-overlay">
      <div className="modal-content" style={{maxWidth:420}}>
        <div className="modal-header">
          <h3 style={{margin:0}}>Edit {count} Transaction{count!==1?'s':''}</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:14,padding:'16px 20px'}}>
          <p style={{margin:0,color:'var(--text-muted)',fontSize:13}}>Leave a field at <em>— keep —</em> to leave existing values unchanged.</p>
          <div>
            <label style={label}>Type</label>
            <select value={action} onChange={e=>setAction(e.target.value)} className="filter-select" style={{width:'100%'}}>
              <option value="">— keep existing —</option>
              {TXN_TYPES.map(a=><option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Category</label>
            <select value={category} onChange={e=>setCategory(e.target.value)} className="filter-select" style={{width:'100%'}}>
              <option value="">— keep existing —</option>
              <option value="Unclassified">Unclassified</option>
              {sortedCats(categories).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>GCB Tag</label>
            <select value={gcbAction} onChange={e=>setGcbAction(e.target.value)} className="filter-select" style={{width:'100%'}}>
              <option value="">— keep existing —</option>
              <option value="tag">🟡 Tag as GCB</option>
              <option value="untag">Remove GCB tag</option>
            </select>
          </div>
          <div>
            <label style={label}>For Others Tag</label>
            <select value={forOthersAction} onChange={e=>setForOthersAction(e.target.value)} className="filter-select" style={{width:'100%'}}>
              <option value="">— keep existing —</option>
              <option value="tag">👥 Tag as For Others</option>
              <option value="untag">Remove For Others tag</option>
            </select>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13}}>
            <input type="checkbox" checked={markReviewed} onChange={e=>setMarkReviewed(e.target.checked)}/>
            Mark all as reviewed
          </label>
        </div>
        <div className="modal-footer" style={{display:'flex',justifyContent:'flex-end',gap:8,padding:'12px 20px',borderTop:'1px solid var(--border)'}}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving?'Saving…':`Apply to ${count} transaction${count!==1?'s':''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Mobile edit modal: bottom-sheet for editing a transaction on mobile ─── */
