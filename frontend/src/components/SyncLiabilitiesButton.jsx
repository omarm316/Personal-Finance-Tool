import {useState} from 'react';
import {apiFetch} from '../lib/api';

export function SyncLiabilitiesButton({toast,onDone}){
  const[busy,setBusy]=useState(false);
  const run=async()=>{
    setBusy(true);
    try{
      const r=await apiFetch('/plaid/sync-liabilities',{method:'POST'});
      const msg=`Liability sync done — ${r.accounts_updated} account${r.accounts_updated!==1?'s':''} updated`;
      toast(r.errors&&r.errors.length?msg+` (${r.errors.length} skipped)`:msg);
      onDone&&onDone();
    }catch(e){toast('Liability sync failed: '+(e.message||e),'error');}
    finally{setBusy(false);}
  };
  return<button type="button" className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={run} disabled={busy} title="Pull minimum payments, due dates, and APRs from Plaid">{busy?'Syncing…':'💳 Sync Liabilities'}</button>;
}
