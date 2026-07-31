import React,{useState} from 'react';
import {ConfirmModal} from './ConfirmModal';
import {apiFetch} from '../lib/api';
import {fmt} from '../lib/format';

export function BankAccountRow({a,institutionName,toast,onSynced}){
  const[busy,setBusy]=useState(false);
  const[rebuilding,setRebuilding]=useState(false);
  const[cm,setCm]=useState(null);
  const redownload=()=>{
    setCm({
      title:`Re-download "${a.name}"`,
      body:`Resets the sync cursor so all transactions re-download from Plaid.\n\nExisting transactions are preserved and matched by content hash — no data lost.\n\nNote: cursor reset affects ALL accounts at ${institutionName}.`,
      confirmLabel:'Re-download',danger:false,
      onConfirm:async()=>{
        setBusy(true);
        try{
          await apiFetch(`/accounts/${a.id}/reset-and-resync`,{method:'POST'});
          toast(`⟳ Re-download started for ${a.name} — refresh in ~30s`);
          setTimeout(()=>onSynced&&onSynced(),30000);
        }catch(e){toast('Re-download failed: '+(e.message||e),'error');}
        finally{setBusy(false);}
      }
    });
  };
  const rebuildSnapshots=async()=>{
    setRebuilding(true);
    try{
      const r=await apiFetch(`/accounts/${a.id}/rebuild-snapshots`,{method:'POST'});
      toast(`↺ ${a.name}: rebuilt ${r.months_built} month snapshot${r.months_built!==1?'s':''}`);
      onSynced&&onSynced();
    }catch(e){toast('Snapshot rebuild failed: '+(e.message||e),'error');}
    finally{setRebuilding(false);}
  };
  return(
    <React.Fragment>
      {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}
      <div className="card" style={{padding:'16px 20px', background:'var(--surface-hover)', marginBottom:12, borderRadius:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
          <div style={{display:'flex',gap:12,fontSize:14,alignItems:'center'}}>
            <span style={{fontWeight:700,color:'var(--text-primary)', fontFamily:'Outfit, sans-serif'}}>{a.name}</span>
            <span style={{textTransform:'capitalize',color:'var(--text-secondary)', fontSize:12}}>{a.type}</span>
            {a.mask&&<span style={{color:'var(--text-muted)', fontSize:12}}>····{a.mask}</span>}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button type="button" className="btn btn-sm btn-secondary" style={{fontSize:11,padding:'6px 12px'}} disabled={rebuilding} onClick={(e)=>{e.preventDefault();rebuildSnapshots()}} title="Rebuild monthly balance snapshots for this account">
              {rebuilding?'…':'↺ Snapshots'}
            </button>
            <button type="button" className="btn btn-sm btn-secondary" style={{fontSize:11,padding:'6px 12px'}} disabled={busy} onClick={(e)=>{e.preventDefault();redownload()}} title="Re-download all transactions from Plaid (non-destructive)">
              {busy?'…':'⟳ Re-download'}
            </button>
          </div>
        </div>
        {/* Balance anchor row */}
        {(()=>{
          const ageDays=a.anchor_age_days;
          if(ageDays==null)return null;
          const stale=ageDays>180;
          const warn=ageDays>90&&ageDays<=180;
          const color=stale?'var(--red)':warn?'var(--amber)':'var(--text-muted)';
          return(
            <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:8,fontSize:12,color:'var(--text-secondary)'}}>
              <span>Balance anchor: <strong style={{color, fontWeight:600}}>{a.start_date}</strong>
                <span style={{color,marginLeft:6, opacity:0.8}}>({ageDays}d ago{stale?' — stale, consider Force Resync':warn?' — getting old':''})</span>
              </span>
              {a.starting_balance!=null&&<span>Anchor value: <strong style={{color:'var(--text-primary)', fontWeight:600}}>{a.starting_balance<0?'-':''}{fmt(Math.abs(a.starting_balance))}</strong></span>}
            </div>
          );
        })()}
        {/* Liability details row — shown for credit/loan accounts with Plaid data */}
        {a.is_liability&&(a.liability_min_payment!=null||a.liability_next_due_date)&&(
          <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:8,fontSize:12,color:'var(--text-secondary)'}}>
            {a.liability_min_payment!=null&&<span style={{color:a.liability_next_due_date&&new Date(a.liability_next_due_date)<new Date()?'var(--red)':'var(--text-secondary)'}}>
              Min due: <strong style={{color:'var(--text-primary)', fontWeight:600}}>${a.liability_min_payment.toFixed(2)}</strong>
            </span>}
            {a.liability_next_due_date&&<span>
              Due: <strong style={{color:'var(--text-primary)', fontWeight:600}}>{new Date(a.liability_next_due_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</strong>
            </span>}
            {a.liability_last_statement_bal!=null&&<span>
              Stmt bal: <strong style={{color:'var(--text-primary)', fontWeight:600}}>${Math.abs(a.liability_last_statement_bal).toFixed(2)}</strong>
            </span>}
            {a.liability_purchase_apr!=null&&<span>APR: <strong style={{color:'var(--text-primary)', fontWeight:600}}>{a.liability_purchase_apr}%</strong></span>}
          </div>
        )}
      </div>
    </React.Fragment>
  );
}
