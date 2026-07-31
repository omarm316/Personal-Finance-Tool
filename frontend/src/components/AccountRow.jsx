import {BUCKET_STYLE} from '../lib/constants';
import {fmt,fmtAcctType,instColor} from '../lib/format';

export function AccountRow({a,showPlaidActions,editingId,editVals,setEditVals,onSave,onCancel,onStartEdit,onSever,onMerge,onDelete}){
  const isEditing=editingId===a.id;
  const color=instColor(a);
  const bucketS=BUCKET_STYLE[a.bucket]||{bg:'var(--elevated)',color:'var(--text-muted)'};
  const bal=a.balance!=null?a.balance:(a.starting_balance||0);
  return(
    <div className="card" style={{padding:0, overflow:'hidden', position:'relative', transition:'transform 0.2s', cursor:'default'}}>
      <div style={{height:4, background:color}}/>
      <div style={{padding:'20px'}}>
        {/* Top row: name + balance */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12}}>
          <div style={{flex:1, minWidth:0}}>
            {isEditing ? (
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                <input value={editVals.account_name} onChange={e=>setEditVals(v=>({...v,account_name:e.target.value}))} className="search-input" style={{fontSize:14, fontWeight:600}} placeholder="Account Name"/>
                <select value={editVals.account_type||''} onChange={e=>setEditVals(v=>({...v,account_type:e.target.value}))} className="filter-select" style={{width:'100%'}}>
                  <option value="">— type —</option>
                  {['checking','savings','cash','money market','cd','hsa','fsa','investment','brokerage','401k','ira','credit card','mortgage','loan','student','auto','other'].map(t=>
                    <option key={t} value={t}>{fmtAcctType(t)}</option>)}
                </select>
                <input value={editVals.notes} onChange={e=>setEditVals(v=>({...v,notes:e.target.value}))} className="search-input" style={{fontSize:12}} placeholder="Notes (optional)"/>
              </div>
            ) : (
              <>
                <div style={{fontSize:16, fontWeight:700, color:'var(--text-primary)', fontFamily:'Outfit, sans-serif'}}>{a.account_name}</div>
                {a.notes && <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:4, fontWeight:450}}>{a.notes}</div>}
              </>
            )}
          </div>
          <div style={{textAlign:'right', flexShrink:0, marginLeft:16}}>
            <div style={{fontFamily:'Outfit, sans-serif', fontSize:18, fontWeight:700, color:a.is_liability?'var(--red)':'var(--blue-vibrant)'}}>
              {a.is_liability?'(':''}{fmt(Math.abs(bal))}{a.is_liability?')':''}
            </div>
            <div style={{fontSize:11, color:'var(--text-muted)', marginTop:2, fontWeight:500}}>{a.transaction_count.toLocaleString()} txns</div>
          </div>
        </div>
        {/* Badges row */}
        <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:isEditing?12:0}}>
          <span className="badge" style={{background:bucketS.bg, color:bucketS.color, padding:'3px 10px', borderRadius:20}}>{fmtAcctType(a.account_type)}</span>
          {a.mask && <span className="badge badge-transfer" style={{padding:'3px 10px', borderRadius:20}}>····{a.mask}</span>}
          {!a.is_manual && <span className="badge badge-income" style={{background:'rgba(16,185,129,0.08)', padding:'3px 10px', borderRadius:20}}>● Plaid</span>}
          {a.is_manual && <span className="badge" style={{background:'rgba(245,158,11,0.08)', color:'var(--amber)', padding:'3px 10px', borderRadius:20}}>Manual</span>}
        </div>
        {/* Actions */}
        <div style={{display:'flex', gap:8, marginTop:16, flexWrap:'wrap'}}>
          {isEditing ? (
            <>
              <button type="button" className="btn btn-sm" style={{background:'var(--green)'}} onClick={(e)=>{e.preventDefault();onSave(a.id)}}>Save</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={(e)=>{e.preventDefault();onCancel()}}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-sm btn-secondary" onClick={(e)=>{e.preventDefault();onStartEdit(a)}}>Edit</button>
              {showPlaidActions && <button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--amber)', border:'1px solid rgba(245,158,11,0.2)'}} onClick={(e)=>{e.preventDefault();onSever(a)}}>Sever</button>}
              <button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--blue-vibrant)', border:'1px solid rgba(59,130,246,0.2)'}} onClick={(e)=>{e.preventDefault();onMerge(a)}}>Merge</button>
              <button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)', border:'1px solid rgba(239,68,68,0.2)'}} onClick={(e)=>{e.preventDefault();onDelete(a)}}>Delete</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
