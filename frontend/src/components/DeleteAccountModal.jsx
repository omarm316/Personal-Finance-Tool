import {useState} from 'react';
import {apiFetch} from '../lib/api';

export function DeleteAccountModal({account,onDone,onClose}){
  const[busy,setBusy]=useState(false);
  const doDelete=async()=>{
    setBusy(true);
    try{
      const r=await apiFetch(`/accounts/${account.id}`,{method:'DELETE'});
      onDone(`Deleted "${account.account_name}" and ${r.transactions_deleted} transactions`);
    }catch(e){onDone(null,'Delete failed: '+(e.message||'error'));}
    finally{setBusy(false);}
  };
  return(
    <div className="modal-overlay">
      <div className="modal-content" style={{maxWidth:420}}>
        <div className="modal-header">
          <h3 style={{margin:0,color:'var(--red)'}}>Delete Account</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{padding:'16px 20px'}}>
          <p style={{margin:'0 0 12px',fontSize:13}}>This will permanently delete:</p>
          <ul style={{margin:'0 0 16px',paddingLeft:20,fontSize:13,lineHeight:1.7}}>
            <li><strong>{account.account_name}</strong></li>
            <li><strong>{account.transaction_count} transaction{account.transaction_count!==1?'s':''}</strong></li>
          </ul>
          <p style={{margin:0,fontSize:13,color:'var(--red)',fontWeight:500}}>This cannot be undone.</p>
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,padding:'12px 20px',borderTop:'1px solid var(--border)'}}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-sm" style={{background:'var(--red)',color:'#fff',border:'1px solid rgba(248,113,113,0.4)',padding:'6px 14px'}} onClick={doDelete} disabled={busy}>{busy?'Deleting…':'Delete Permanently'}</button>
        </div>
      </div>
    </div>
  );
}

/* AccountRow is a top-level component so React never remounts it on parent
   re-renders (same fix as LoanForm — defining it inside AccountsPage would
   create a new function reference each render, causing React to unmount/remount
   the row and swallow click events before modals can open). */
