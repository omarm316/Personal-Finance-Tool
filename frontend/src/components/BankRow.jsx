import React,{useState} from 'react';
import {BankAccountRow} from './BankAccountRow';
import {ConfirmModal} from './ConfirmModal';
import {apiFetch} from '../lib/api';
import {fmtDate} from '../lib/format';

export function BankRow({item,toast,onRenamed,onSynced}){
  const[editing,setEditing]=useState(false);
  const[nameVal,setNameVal]=useState(item.institution_name);
  const[resyncing,setResyncing]=useState(false);
  const[reconnecting,setReconnecting]=useState(false);
  const[expanded,setExpanded]=useState(false);
  const[confirmingRemove,setConfirmingRemove]=useState(false);
  const[cm,setCm]=useState(null);
  const openReconnect=async()=>{
    setReconnecting(true);
    try{
      const{link_token}=await apiFetch(`/plaid/update-link-token/${item.item_id}`);
      const handler=window.Plaid.create({
        token:link_token,
        onSuccess:async()=>{
          try{
            await apiFetch(`/plaid/update-complete/${item.item_id}`,{method:'POST'});
            toast(`✓ ${item.institution_name} — syncing accounts…`);
            setTimeout(()=>onSynced&&onSynced(),15000);
          }catch(e){toast('Linked, but sync failed to start','error');}
          finally{setReconnecting(false);}
        },
        onExit:()=>setReconnecting(false),
      });
      handler.open();
    }catch(e){toast('Failed to open Plaid: '+(e.message||e),'error');setReconnecting(false);}
  };
  const save=async()=>{
    try{
      const r=await apiFetch(`/plaid/items/${item.item_id}`,{method:'PATCH',body:JSON.stringify({institution_name:nameVal})});
      onRenamed(item.item_id,r.institution_name);
      setEditing(false);
      toast('Name updated');
    }catch(e){toast('Failed to update: '+(e.message||e),'error');}
  };
  const forceResync=async()=>{
    setResyncing(true);
    try{
      await apiFetch(`/plaid/items/${item.item_id}/force-resync`,{method:'POST'});
      toast(`${item.institution_name}: sync started — refreshing in 15s`);
      setTimeout(()=>onSynced&&onSynced(),15000);
    }catch(e){toast(`Resync failed: ${e.message||e}`,'error');}
    finally{setResyncing(false);}
  };
  const envColor={'production':'var(--green)','development':'var(--amber)','sandbox':'var(--violet)'}[item.environment]||'var(--text-muted)';
  return(
    <React.Fragment>
    {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}
    <div className="card" style={{padding:'24px', marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between', flexWrap:'wrap', gap:16}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <div className="logo-icon-box" style={{width:40, height:40, borderRadius:12, fontSize:20}}>
            {item.institution_name ? item.institution_name[0] : 'B'}
          </div>
          <div>
            {editing
              ?<div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input className="search-input" style={{padding:'6px 12px',fontSize:14,width:200}} value={nameVal} onChange={e=>setNameVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape')setEditing(false);}} autoFocus/>
                  <button type="button" className="btn btn-sm" onClick={(e)=>{e.preventDefault();save()}}>Save</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={(e)=>{e.preventDefault();setNameVal(item.institution_name);setEditing(false);}}>Cancel</button>
                </div>
              :<div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{fontSize:18, fontWeight:700, fontFamily:'Outfit, sans-serif', color:'var(--text-primary)'}}>{item.institution_name}</div>
                  <button type="button" className="btn btn-sm btn-ghost" style={{fontSize:11,padding:'2px 8px'}} onClick={(e)=>{e.preventDefault();setNameVal(item.institution_name);setEditing(true);}}>Edit</button>
                </div>
            }
            <div style={{display:'flex',gap:16,marginTop:6,flexWrap:'wrap'}}>
              <span style={{fontSize:12, color:'var(--text-secondary)'}}>{item.account_count} account{item.account_count!==1?'s':''}</span>
              <span style={{fontSize:12, color:'var(--text-secondary)'}}>{item.transaction_count.toLocaleString()} txns</span>
              <span style={{fontSize:12, color:'var(--text-secondary)'}}>{item.last_synced_at?`Last sync: ${fmtDate(item.last_synced_at)}`:'Never synced'}</span>
            </div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',color:envColor,background:`${envColor}15`,borderRadius:20,padding:'4px 10px'}}>{item.environment}</span>
          {item.last_error_code
            ?<span style={{fontSize:11,fontWeight:600,color:'var(--red)',background:'rgba(239, 68, 68, 0.1)',borderRadius:20,padding:'4px 10px'}} title={item.last_error_message||''}>🔴 {item.last_error_code}</span>
            :item.is_active
              ?<span className="badge badge-income" style={{padding:'4px 10px'}}>Active</span>
              :<span style={{fontSize:11,fontWeight:600,color:'var(--amber)',background:'rgba(245, 158, 11, 0.1)',borderRadius:20,padding:'4px 10px'}}>Stale</span>
          }
          <button type="button" className="btn btn-sm btn-ghost" style={{fontSize:11,padding:'4px 10px'}} onClick={(e)=>{e.preventDefault();setExpanded(x=>!x)}}>{expanded?'▲':'▼'}</button>
          {item.is_active&&<button type="button" className="btn btn-sm btn-secondary" onClick={(e)=>{e.preventDefault();forceResync()}} disabled={resyncing}>{resyncing?'Syncing…':'↺ Sync'}</button>}
          {item.is_active&&!item.last_error_code&&<button type="button" className="btn btn-sm btn-secondary" onClick={(e)=>{e.preventDefault();openReconnect()}} disabled={reconnecting}>{reconnecting?'Opening…':'+ Add Account'}</button>}
          <button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)', border:'1px solid rgba(239, 68, 68, 0.2)'}} onClick={(e)=>{
            e.preventDefault();
            if(item.transaction_count===0){
              setCm({
                title:`Remove "${item.institution_name}"`,
                body:`This institution has 0 transactions — its ${item.account_count} empty account${item.account_count!==1?'s':''} will be deleted.`,
                confirmLabel:'Remove',danger:true,
                onConfirm:async()=>{
                  try{await apiFetch(`/plaid/items/${item.item_id}`,{method:'DELETE'});onSynced&&onSynced();toast('Removed');}
                  catch(e){toast('Failed: '+(e.message||e),'error');}
                }
              });
            }else{
              setConfirmingRemove(true);
            }
          }}>Remove</button>
        </div>
      </div>
      {item.last_error_code&&(
        <div style={{marginTop:16,background:'rgba(239, 68, 68, 0.05)',border:'1px solid rgba(239, 68, 68, 0.2)',borderRadius:16,padding:'16px'}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,color:'var(--red)',fontSize:14,marginBottom:6, fontFamily:'Outfit, sans-serif'}}>
                ⚠️ Sync error: {item.last_error_code}
                {item.last_error_at&&<span style={{fontWeight:400,fontSize:12,color:'var(--red)',opacity:0.7,marginLeft:12}}>since {item.last_error_at.slice(0,10)}</span>}
              </div>
              <div style={{fontSize:13,color:'var(--text-secondary)', lineHeight:1.5}}>
                {item.last_error_code==='ITEM_LOGIN_REQUIRED'
                  ?`${item.institution_name}'s OAuth consent expired (~90-day limit). Click Reconnect to re-authenticate in place — no data is lost.`
                  :item.last_error_message||'Plaid returned an error during the last sync attempt.'
                }
              </div>
            </div>
            {item.last_error_code==='ITEM_LOGIN_REQUIRED'&&(
              <button type="button" className="btn btn-sm" style={{flexShrink:0,background:'var(--red)'}} onClick={(e)=>{e.preventDefault();openReconnect()}} disabled={reconnecting}>
                {reconnecting?'Opening…':'🔗 Reconnect'}
              </button>
            )}
          </div>
        </div>
      )}
      {confirmingRemove&&(
        <div style={{marginTop:16,background:'rgba(239, 68, 68, 0.05)',border:'1px solid rgba(239, 68, 68, 0.2)',borderRadius:16,padding:'16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
          <div>
            <div style={{fontWeight:700,color:'var(--red)',fontSize:14,marginBottom:4, fontFamily:'Outfit, sans-serif'}}>⚠️ Remove "{item.institution_name}"?</div>
            <div style={{fontSize:12,color:'var(--text-secondary)', lineHeight:1.5}}>This will deactivate the connection — Plaid will stop syncing. Its <strong>{item.account_count} account{item.account_count!==1?'s':''}</strong> and <strong>{item.transaction_count.toLocaleString()} transaction{item.transaction_count!==1?'s':''}</strong> will be kept but no longer updated.</div>
          </div>
          <div style={{display:'flex',gap:10,flexShrink:0}}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={(e)=>{e.preventDefault();setConfirmingRemove(false)}}>Cancel</button>
            <button type="button" className="btn btn-sm" style={{background:'var(--red)',color:'#fff'}} onClick={async(e)=>{
              e.preventDefault();
              setConfirmingRemove(false);
              try{await apiFetch(`/plaid/items/${item.item_id}`,{method:'DELETE'});onSynced&&onSynced();toast('Connection removed');}
              catch(e){toast('Failed: '+(e.message||e),'error');}
            }}>Yes, Remove</button>
          </div>
        </div>
      )}
      {expanded&&item.accounts&&item.accounts.length>0&&(
        <div style={{marginTop:20,marginLeft:24,display:'flex',flexDirection:'column',gap:8}}>
          {item.accounts.map((a,i)=>(
            <BankAccountRow key={a.id||i} a={a} institutionName={item.institution_name} toast={toast} onSynced={onSynced}/>
          ))}
        </div>
      )}
    </div>
    </React.Fragment>
  );
}
