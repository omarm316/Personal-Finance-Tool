import {useState,useEffect} from 'react';
import {apiFetch} from '../lib/api';
import {fmt,fmtAcctType} from '../lib/format';

export function ReconciliationPanel({toast}){
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(true);
  const load=async()=>{
    setLoading(true);
    try{const r=await apiFetch('/reconciliation');setData(r);}
    catch(e){toast('Failed to load reconciliation data','error');}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();},[]);
  if(loading)return<div style={{padding:40,textAlign:'center'}}><div className="spinner"/></div>;
  if(!data||!data.accounts?.length)return<div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>No balance observations yet. Click <strong>Sync</strong> in the sidebar to record the first observations.</div>;
  const fmtDt=(iso)=>{if(!iso)return'—';const d=new Date(iso);return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});};
  const driftColor=(d)=>{if(d==null)return'var(--text-muted)';const a=Math.abs(d);return a<0.02?'var(--green)':a<5?'var(--amber)':'var(--red)';};
  const driftBadge=(d)=>{if(d==null)return'—';const a=Math.abs(d);return a<0.02?'✓ Matched':d>0?`+${fmt(d)} over`:`${fmt(a)} under`;};
  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <h2 style={{fontSize:16,fontWeight:500,margin:0}}>Balance Reconciliation</h2>
          <p style={{fontSize:12,color:'var(--text-muted)',margin:'4px 0 0'}}>Plaid-reported vs. transaction-derived balances. Observations are recorded every sync.</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={async()=>{
            try{
              const r=await apiFetch('/reconciliation/reanchor-all',{method:'POST'});
              toast(`Re-anchored ${r.corrected} of ${r.total_accounts} accounts`);
              load();
            }catch(e){toast('Re-anchor all failed: '+e.message,'error');}
          }}>⚓ Re-anchor All</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={load}>↻ Refresh</button>
        </div>
      </div>
      <div className="table-wrap">
        <table style={{fontSize:13}}>
          <thead><tr>
            <th>Account</th>
            <th style={{textAlign:'right'}}>Plaid Balance</th>
            <th style={{textAlign:'right'}}>Computed Balance</th>
            <th style={{textAlign:'right'}}>Drift</th>
            <th>Last Observed</th>
            <th>Last Reconciled</th>
            <th style={{textAlign:'center'}}>Observations</th>
            <th></th>
          </tr></thead>
          <tbody>{data.accounts.map(a=>(
            <tr key={a.account_id}>
              <td style={{fontWeight:500}}>
                {a.account_name}
                <div style={{fontSize:11,color:'var(--text-muted)'}}>{fmtAcctType(a.account_type)}</div>
              </td>
              <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans'}}>{a.latest?(a.latest.plaid_balance<0?'−':'')+fmt(a.latest.plaid_balance):'—'}</td>
              <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans'}}>{a.latest?(a.latest.computed_balance<0?'−':'')+fmt(a.latest.computed_balance):'—'}</td>
              <td style={{textAlign:'right',fontWeight:500,color:driftColor(a.latest?.delta)}}>
                {a.latest?driftBadge(a.latest.delta):'—'}
              </td>
              <td style={{fontSize:12,color:'var(--text-secondary)'}}>{a.latest?fmtDt(a.latest.observed_at):'Never'}</td>
              <td style={{fontSize:12,color:'var(--text-secondary)'}}>{a.last_reconciled?fmtDt(a.last_reconciled):'Never'}</td>
              <td style={{textAlign:'center',color:'var(--text-muted)'}}>{a.observation_count}</td>
              <td>{a.latest&&Math.abs(a.latest.delta)>=0.02&&<button type="button" className="btn btn-sm btn-ghost" style={{fontSize:11,padding:'2px 8px',color:'var(--blue)'}}
                onClick={async()=>{
                  try{
                    const r=await apiFetch(`/reconciliation/${a.account_id}/reanchor`,{method:'POST'});
                    toast(`${a.account_name}: re-anchored from Plaid (${r.old_balance?.toFixed(2)} → ${r.new_balance?.toFixed(2)})`);
                    load();
                  }catch(e){toast('Re-anchor failed: '+e.message,'error');}
                }}>Re-anchor</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {/* Drift history sparklines for accounts with drift */}
      {data.accounts.filter(a=>a.drift_history?.length>1).map(a=>(
        <div key={a.account_id} style={{marginTop:16,padding:12,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:8}}>{a.account_name} — Drift History</div>
          <div style={{display:'flex',alignItems:'flex-end',gap:2,height:40}}>
            {(()=>{
              const pts=a.drift_history;
              const maxD=Math.max(...pts.map(p=>Math.abs(p.delta||0)),0.01);
              return pts.map((p,i)=>{
                const h=Math.max(2,Math.abs(p.delta||0)/maxD*36);
                const clr=(p.delta||0)===0?'var(--green)':(p.delta||0)>0?'#f59e0b':'var(--blue-primary)';
                return<div key={i} title={`${fmtDt(p.date)}: ${p.delta>0?'+':''}${p.delta?.toFixed(2)}`}
                  style={{width:Math.max(4,Math.floor(300/pts.length)),height:h,background:clr,borderRadius:2,opacity:0.8}}/>;
              });
            })()}
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text-muted)',marginTop:4}}>
            <span>{a.drift_history[0]?.date?.slice(0,10)}</span>
            <span>{a.drift_history[a.drift_history.length-1]?.date?.slice(0,10)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Daily Balances Page ─────────────────────────────────────────────────── */
