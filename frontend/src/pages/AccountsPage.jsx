import React,{useState,useEffect,useCallback} from 'react';
import {AccountRow} from '../components/AccountRow';
import {ConfirmModal} from '../components/ConfirmModal';
import {DeleteAccountModal} from '../components/DeleteAccountModal';
import {ManualAccountModal} from '../components/ManualAccountModal';
import {MergeAccountModal} from '../components/MergeAccountModal';
import {apiFetch} from '../lib/api';
import {fmt} from '../lib/format';

export function AccountsPage({banks,onConnectBank,onSync,toast,refreshKey}){
  const[accounts,setAccounts]=useState([]);
  const[loading,setLoading]=useState(true);
  const[showManual,setShowManual]=useState(false);
  const[editingId,setEditingId]=useState(null);
  const[editVals,setEditVals]=useState({});
  const[mergeAccount,setMergeAccount]=useState(null);
  const[deleteAccount,setDeleteAccount]=useState(null);
  const[cm,setCm]=useState(null);

  const load=useCallback(async()=>{
    setLoading(true);
    try{setAccounts(await apiFetch('/accounts'));}catch(e){}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{load();},[load,refreshKey]);

  const startEdit=(a)=>{setEditingId(a.id);setEditVals({account_name:a.account_name||'',notes:a.notes||'',account_type:a.account_type||''});};
  const cancelEdit=()=>{setEditingId(null);setEditVals({});};
  const saveEdit=async(id)=>{
    try{await apiFetch(`/accounts/${id}`,{method:'PATCH',body:JSON.stringify(editVals)});toast('Account updated');setEditingId(null);await load();}
    catch(e){toast('Failed to save','error');}
  };
  const severPlaid=(a)=>{
    setCm({
      title:'Sever Plaid Connection',
      body:`Disconnect Plaid from "${a.account_name}"? Your transactions will be kept, but this account will no longer sync automatically.`,
      confirmLabel:'Sever Connection',danger:true,
      onConfirm:async()=>{
        try{await apiFetch(`/accounts/${a.id}/sever-plaid`,{method:'POST'});toast('Plaid connection severed');await load();}
        catch(e){toast('Failed: '+(e.message||'error'),'error');}
      }
    });
  };
  const handleMergeDone=(msg,err)=>{setMergeAccount(null);if(err)toast(err,'error');else{toast(msg);load();}};
  const handleDeleteDone=(msg,err)=>{setDeleteAccount(null);if(err)toast(err,'error');else{toast(msg);load();}};

  const rowProps={editingId,editVals,setEditVals,onSave:saveEdit,onCancel:cancelEdit,onStartEdit:startEdit,onSever:severPlaid,onMerge:setMergeAccount,onDelete:setDeleteAccount};

  const totalAssets=accounts.filter(a=>a.is_asset).reduce((s,a)=>s+(a.balance!=null?a.balance:(a.starting_balance||0)),0);
  const totalLiab=accounts.filter(a=>a.is_liability).reduce((s,a)=>s+Math.abs(a.balance!=null?a.balance:(a.starting_balance||0)),0);
  const netWorth=totalAssets-totalLiab;

  return(
    <div className="accounts-container">
      {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}
      {showManual&&<ManualAccountModal onClose={()=>setShowManual(false)} onSaved={load} toast={toast}/>}
      {mergeAccount&&<MergeAccountModal source={mergeAccount} allAccounts={accounts} onDone={handleMergeDone} onClose={()=>setMergeAccount(null)}/>}
      {deleteAccount&&<DeleteAccountModal account={deleteAccount} onDone={handleDeleteDone} onClose={()=>setDeleteAccount(null)}/>}

      {/* Page Header */}
      <div className="card" style={{display:'flex', justifyContent:'flex-end', alignItems:'center', padding:'16px 24px', marginBottom:24}}>
        <div style={{display:'flex', gap:10}}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={(e)=>{e.preventDefault();onSync()}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:6}}><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            Sync All
          </button>
          <button type="button" className="btn btn-sm" onClick={(e)=>{e.preventDefault();onConnectBank()}}>+ Connect Bank</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={(e)=>{e.preventDefault();setShowManual(true)}}>+ Manual</button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="metric-grid" style={{marginBottom:32}}>
        <div className="card metric-card">
          <div className="metric-label">Total Assets</div>
          <div className="metric-value" style={{color:'var(--green)'}}>{fmt(totalAssets)}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Total Liabilities</div>
          <div className="metric-value" style={{color:'var(--red)'}}>{fmt(totalLiab)}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Net Worth</div>
          <div className="metric-value" style={{color:netWorth>=0?'var(--blue-vibrant)':'var(--red)'}}>{fmt(netWorth)}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Accounts</div>
          <div className="metric-value">{accounts.length}</div>
        </div>
      </div>

      {/* Grouped Accounts */}
      {(()=>{
        const typeOrder=[
          {key:'checking',label:'Checking',isAsset:true},
          {key:'savings',label:'Savings',isAsset:true},
          {key:'investment',label:'Investments',isAsset:true},
          {key:'other_asset',label:'Other Assets',isAsset:true},
          {key:'credit card',label:'Credit Cards',isAsset:false},
          {key:'loan',label:'Loans',isAsset:false},
          {key:'other_liability',label:'Other Liabilities',isAsset:false},
        ];
        const normalize=t=>{
          const s=(t||'').toLowerCase();
          if(s.includes('check'))return'checking';
          if(s.includes('saving'))return'savings';
          if(s.includes('invest')||s.includes('brokerage')||s.includes('401')||s.includes('ira'))return'investment';
          if(s.includes('credit'))return'credit card';
          if(s.includes('loan')||s.includes('mortgage')||s.includes('student'))return'loan';
          if(s.includes('other')&&(s.includes('liab')||s.includes('debt')))return'other_liability';
          return'other_asset';
        };
        const grouped={};
        accounts.forEach(a=>{const k=normalize(a.account_type);(grouped[k]=grouped[k]||[]).push(a);});
        let lastIsAsset=null;
        return typeOrder.filter(g=>(grouped[g.key]||[]).length>0).map(g=>{
          const showSectionLabel=lastIsAsset!==null&&lastIsAsset!==g.isAsset;
          lastIsAsset=g.isAsset;
          return(
            <React.Fragment key={g.key}>
              {showSectionLabel && (
                <div style={{margin:'40px 0 20px', display:'flex', alignItems:'center', gap:16}}>
                  <span style={{fontSize:12, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'2px', whiteSpace:'nowrap'}}>Liabilities</span>
                  <div style={{height:1, background:'var(--border-strong)', width:'100%'}}/>
                </div>
              )}
              <div style={{marginBottom:32}}>
                <div style={{fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'1.5px', marginBottom:12, display:'flex', alignItems:'center', gap:8}}>
                  {g.label}
                  <span style={{fontSize:10, opacity:0.6}}>({grouped[g.key].length})</span>
                </div>
                <div className="grid-auto-sm" style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:20}}>
                  {grouped[g.key].map(a=><AccountRow key={a.id} a={a} showPlaidActions={!a.is_manual} {...rowProps}/>)}
                </div>
              </div>
            </React.Fragment>
          );
        });
      })()}
    </div>
  );
}
