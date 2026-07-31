import {useState} from 'react';
import {apiFetch} from '../lib/api';

export function MergeAccountModal({source,allAccounts,onDone,onClose}){
  const others=allAccounts.filter(a=>a.id!==source.id);
  const[targetId,setTargetId]=useState('');
  const[busy,setBusy]=useState(false);
  const target=others.find(a=>a.id===parseInt(targetId));
  const doMerge=async()=>{
    if(!targetId)return;
    setBusy(true);
    try{
      const r=await apiFetch(`/accounts/${source.id}/merge-into/${targetId}`,{method:'POST'});
      onDone(`Merged — ${r.transactions_moved} transactions moved to "${target?.account_name}"`);
    }catch(e){onDone(null,'Merge failed: '+(e.message||'error'));}
    finally{setBusy(false);}
  };
  return(
    <div className="modal-overlay">
      <div className="modal-content" style={{maxWidth:440}}>
        <div className="modal-header">
          <h3 style={{margin:0}}>Merge Account</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>
          <p style={{margin:0,fontSize:13,color:'var(--text-muted)'}}>
            All transactions from <strong>{source.account_name}</strong> ({source.transaction_count} txns) will be moved to the account you select below. The source account will then be deleted.
          </p>
          <div>
            <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',marginBottom:4,display:'block'}}>Move into</label>
            <select value={targetId} onChange={e=>setTargetId(e.target.value)} className="filter-select" style={{width:'100%'}}>
              <option value="">— select target account —</option>
              {others.map(a=><option key={a.id} value={a.id}>{a.account_name} ({a.transaction_count} txns)</option>)}
            </select>
          </div>
          {target&&<p style={{margin:0,fontSize:12,background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.3)',borderRadius:6,padding:'8px 12px',color:'var(--amber)'}}>
            ⚠ <strong>{source.account_name}</strong> will be permanently deleted after the merge.
          </p>}
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,padding:'12px 20px',borderTop:'1px solid var(--border)'}}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={doMerge} disabled={!targetId||busy}>{busy?'Merging…':'Merge & Delete Source'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Delete Account Modal ────────────────────────────────────────────────────
   Permanently deletes an account and all its transactions. */
