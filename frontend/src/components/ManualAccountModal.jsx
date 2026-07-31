import {useState} from 'react';
import {apiFetch} from '../lib/api';
import {todayStr} from '../lib/format';

export function ManualAccountModal({onClose,onSaved,toast}){
  const[name,setName]=useState('');
  const[type,setType]=useState('Checking');
  const[balance,setBalance]=useState('0');
  const[startDate,setStartDate]=useState(todayStr());
  const[notes,setNotes]=useState('');
  const[saving,setSaving]=useState(false);
  const[error,setError]=useState('');
  const handleSave=async()=>{
    if(!name){setError('Account name is required');return;}
    setSaving(true);setError('');
    try{
      /* POST /api/accounts — creates manual account with starting balance */
      await apiFetch('/accounts',{method:'POST',body:JSON.stringify({name,account_type:type,starting_balance:parseFloat(balance)||0,start_date:startDate,notes:notes||null})});
      toast('Manual account created');onSaved();onClose();
    }catch(e){setError('Failed to create account');}
    finally{setSaving(false);}
  };
  return(
    <div className="review-overlay" style={{zIndex: 5000}}>
      <div className="review-panel" style={{maxWidth: 480}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
          <div>
            <h3 style={{fontSize:18,fontWeight:600,fontFamily:'Outfit'}}>Add Manual Account</h3>
            <p style={{fontSize:13,color:'var(--text-secondary)',marginTop:4}}>Create an account not linked to a bank.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{padding:4, minHeight: 0}}>✕</button>
        </div>

        {error&&<div style={{color:'var(--red)',fontSize:13,marginBottom:16,padding:'10px 14px',background:'rgba(239, 68, 68, 0.1)',borderRadius:10,fontWeight:600}}>⚠️ {error}</div>}

        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          <div className="review-field">
            <label>Account Name *</label>
            <input className="search-input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Home, Vehicle, Cash"/>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1.5fr 1fr',gap:16}}>
            <div className="review-field">
              <label>Account Type</label>
              <select className="filter-select" style={{width:'100%'}} value={type} onChange={e=>setType(e.target.value)}>
                {[
                  ['Checking','Checking'],['Savings','Savings'],['HSA','HSA'],['FSA','FSA'],['Cash','Cash'],['Gift Card','Gift Card'],
                  ['Investment','Investment'],['Real Estate','Real Estate'],['Vehicle','Vehicle'],
                  ['Business','Business'],['Credit Card','Credit Card'],['Loan','Loan'],['Other','Other']
                ].map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="review-field">
              <label>Start Date</label>
              <input type="date" className="date-input" style={{width:'100%'}} value={startDate} onChange={e=>setStartDate(e.target.value)}/>
            </div>
          </div>

          <div className="review-field">
            <label>Starting Balance ($)</label>
            <input className="search-input" type="number" step="0.01" value={balance} onChange={e=>setBalance(e.target.value)} placeholder="0.00"/>
          </div>

          <div className="review-field">
            <label>Notes (Optional)</label>
            <input className="search-input" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Extra details…"/>
          </div>
        </div>

        <div className="review-actions" style={{marginTop:32}}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Creating…':'✓ Create Account'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Merge Account Modal ─────────────────────────────────────────────────────
   Reassigns all transactions from the source account into a chosen target,
   then deletes the source. Used to clean up duplicate accounts. */
