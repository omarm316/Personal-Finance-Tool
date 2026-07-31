import React,{useState} from 'react';
import {ConfirmModal} from './ConfirmModal';
import {apiFetch} from '../lib/api';

export function ResetResyncButton({toast,onDone}){
  const[busy,setBusy]=useState(false);
  const[cm,setCm]=useState(null);
  const run=()=>{
    setCm({
      title:'Reset & Full Resync',
      body:'This will delete ALL Plaid-synced transactions and re-fetch everything from scratch.\n\nManually entered transactions are kept.',
      confirmLabel:'Reset & Resync',danger:true,
      onConfirm:async()=>{
        setBusy(true);
        try{
          const r=await apiFetch('/plaid/reset-and-resync',{method:'POST'});
          toast(`${r.message} — refreshing in 15s`);
          setTimeout(()=>onDone&&onDone(),15000);
        }catch(e){toast('Reset failed: '+(e.message||e),'error');}
        finally{setBusy(false);}
      }
    });
  };
  return<React.Fragment>
    {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}
    <button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)',border:'1px solid rgba(248,113,113,0.3)',fontSize:11}} onClick={run} disabled={busy}>{busy?'Resetting…':'⟳ Reset & Full Resync'}</button>
  </React.Fragment>;
}
