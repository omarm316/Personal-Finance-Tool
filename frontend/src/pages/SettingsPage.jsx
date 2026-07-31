import {useState,useEffect,useCallback} from 'react';
import {BankRow} from '../components/BankRow';
import {ConfirmModal} from '../components/ConfirmModal';
import {ResetResyncButton} from '../components/ResetResyncButton';
import {SyncLiabilitiesButton} from '../components/SyncLiabilitiesButton';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {sortedCats,todayStr} from '../lib/format';

export function SettingsPage({banks,onConnectBank,toast,onBanksChanged,categories,autoScan,onAutoScanDone}){
  const[tab,setTab]=useState('data');
  const[busy,setBusy]=useState(false);
  const[cm,setCm]=useState(null);
  const[items,setItems]=useState([]);
  /* Rules tab state */
  const[rules,setRules]=useState([]);
  const[rulesLoading,setRulesLoading]=useState(false);
  const[ruleSearch,setRuleSearch]=useState('');
  const[debouncedSearch,setDebouncedSearch]=useState('');
  const[ruleEditing,setRuleEditing]=useState(null);
  const[ruleEditVals,setRuleEditVals]=useState({});
  const[showAddRule,setShowAddRule]=useState(false);
  const[reapplying,setReapplying]=useState(false);

  const[balanceSyncing,setBalanceSyncing]=useState(false);
  const[balanceSyncResult,setBalanceSyncResult]=useState(null);
  const[healthChecking,setHealthChecking]=useState(false);
  const[healthResults,setHealthResults]=useState(null);
  const checkPlaidHealth=async()=>{
    setHealthChecking(true);
    try{const r=await apiFetch('/plaid/item-status');setHealthResults(r);}
    catch(e){toast('Health check failed: '+(e.message||e),'error');}
    finally{setHealthChecking(false);}
  };
  const syncBalances=async(force=false)=>{
    setBalanceSyncing(true);
    try{
      const url='/accounts/sync-balances'+(force?'?force=true':'');
      const r=await apiFetch(url,{method:'POST'});
      setBalanceSyncResult({...r,force});
      const anchored=r.accounts.filter(a=>a.anchor_updated).length;
      const snaps=r.accounts.reduce((s,a)=>s+a.months_built,0);
      if(force){
        toast(`Force resync complete — ${anchored} anchor${anchored!==1?'s':''} updated, ${snaps} month snapshots rebuilt`);
      }else{
        toast(`Balance sync complete — ${snaps} month snapshots rebuilt${anchored>0?` (${anchored} new anchor${anchored!==1?'s':''} set)`:''}`);
      }
    }catch(e){toast('Balance sync failed: '+(e.message||e),'error');}
    finally{setBalanceSyncing(false);}
  };
  const[dupResult,setDupResult]=useState(null); // {duplicates, ignored}
  const[dupScanning,setDupScanning]=useState(false);
  const dupGroups=dupResult?.duplicates||null;
  const dupIgnored=dupResult?.ignored||[];
  const scanDuplicates=async()=>{
    setDupScanning(true);
    try{
      const r=await apiFetch('/accounts/detect-duplicates');
      setDupResult(r);
      if(r.count===0)toast('No duplicate accounts found ✓');
    }catch(e){toast('Duplicate scan failed: '+(e.message||e),'error');}
    finally{setDupScanning(false);}
  };

  /* Auto-scan: triggered after a bank link that created new accounts */
  useEffect(()=>{
    if(!autoScan)return;
    setTab('bank');
    scanDuplicates();
    onAutoScanDone&&onAutoScanDone();
  },[autoScan]);

  const mergeOnePair=async(keepId,discardId)=>{
    try{
      const r=await apiFetch('/accounts/merge-pair',{method:'POST',body:JSON.stringify({keep_id:keepId,discard_id:discardId})});
      toast(`Merged: ${r.kept?.name} kept, ${r.discarded?.name} removed (${r.transactions_moved} txns moved)`);
      // Remove just this pair from local state — other pairs unaffected
      setDupResult(prev=>{
        if(!prev)return prev;
        const newGroups=prev.duplicates.map(g=>{
          if(g.keep_id!==keepId)return g;
          const newDiscards=g.discard_ids.filter(id=>id!==discardId);
          return newDiscards.length>0?{...g,discard_ids:newDiscards}:null;
        }).filter(Boolean);
        return{...prev,duplicates:newGroups,count:newGroups.length};
      });
      onBanksChanged&&onBanksChanged();
    }catch(e){toast('Merge failed: '+(e.message||e),'error');}
  };
  const ignoreDuplicatePair=async(idA,idB)=>{
    try{
      await apiFetch('/accounts/ignore-duplicate-pair',{method:'POST',body:JSON.stringify({account_id_a:idA,account_id_b:idB})});
      // Remove from groups, add to ignored in local state
      setDupResult(prev=>{
        if(!prev)return prev;
        const removedGroup=prev.duplicates.find(g=>g.keep_id===Math.min(idA,idB)||g.discard_ids.includes(Math.max(idA,idB)));
        const newGroups=prev.duplicates.filter(g=>!(g.keep_id===idA&&g.discard_ids.includes(idB))&&!(g.keep_id===idB&&g.discard_ids.includes(idA)));
        const newIgnored=[...prev.ignored];
        if(removedGroup)newIgnored.push(removedGroup);
        return{...prev,duplicates:newGroups,count:newGroups.length,ignored:newIgnored};
      });
      toast('Pair ignored — it won\'t appear in future scans');
    }catch(e){toast('Failed to ignore: '+(e.message||e),'error');}
  };
  const unignorePair=async(idA,idB)=>{
    try{
      await apiFetch('/accounts/ignore-duplicate-pair',{method:'DELETE',body:JSON.stringify({account_id_a:idA,account_id_b:idB})});
      await scanDuplicates(); // re-scan to move it back
    }catch(e){toast('Failed to unignore: '+(e.message||e),'error');}
  };
  const refreshItems=useCallback(()=>{apiFetch('/plaid/items').then(r=>{setItems(r);onBanksChanged&&onBanksChanged();}).catch(()=>{});},[onBanksChanged]);
  useEffect(()=>{refreshItems();},[]);

  const run=async(path,msg)=>{setBusy(true);try{const r=await apiFetch(path,{method:'POST'});toast(msg);return r;}catch(e){toast('Failed: '+(e.message||'unknown error'),'error');}finally{setBusy(false);}};

  /* Debounce ruleSearch → debouncedSearch (350ms) to avoid an API call per keystroke */
  useEffect(()=>{
    const id=setTimeout(()=>setDebouncedSearch(ruleSearch),350);
    return()=>clearTimeout(id);
  },[ruleSearch]);

  /* Load rules — keyed on debouncedSearch so the API is only called after typing pauses */
  const loadRules=useCallback(async()=>{
    setRulesLoading(true);
    try{setRules(await apiFetch(`/rules?limit=200${debouncedSearch?`&search=${encodeURIComponent(debouncedSearch)}`:''}`));}
    catch(e){toast('Failed to load rules','error');}
    finally{setRulesLoading(false);}
  },[debouncedSearch]);
  useEffect(()=>{if(tab==='rules')loadRules();},[tab,loadRules]);

  const startRuleEdit=(r)=>{setRuleEditing(r.id);setRuleEditVals({priority:r.priority,match_type:r.match_type,pattern:r.pattern,set_action:r.set_action||'',set_category:r.set_category||'',set_description:r.set_description||'',clean_description:r.clean_description||'',notes:r.notes||''});};
  const _reapplyMsg=r=>r?.reapplied?.updated>0?` — ${r.reapplied.updated} transaction${r.reapplied.updated!==1?'s':''} refreshed`:'';
  const saveRuleEdit=async(id)=>{
    try{const r=await apiFetch(`/rules/${id}`,{method:'PATCH',body:JSON.stringify(ruleEditVals)});toast(`Rule updated${_reapplyMsg(r)}`);setRuleEditing(null);await loadRules();}
    catch(e){toast('Failed to save','error');}
  };
  const deleteRule=(id)=>{
    setCm({
      title:'Deactivate Rule',
      body:'This rule will be deactivated and will no longer apply to new transactions.',
      confirmLabel:'Deactivate',danger:true,
      onConfirm:async()=>{
        try{await apiFetch(`/rules/${id}`,{method:'DELETE'});toast('Rule deactivated');await loadRules();}
        catch(e){toast('Failed','error');}
      }
    });
  };
  const addRule=async()=>{
    try{const r=await apiFetch('/rules',{method:'POST',body:JSON.stringify(ruleEditVals)});toast(`Rule created${_reapplyMsg(r)}`);setShowAddRule(false);setRuleEditVals({});await loadRules();}
    catch(e){toast('Failed to create','error');}
  };
  const applyRules=async()=>{
    setReapplying(true);
    try{const r=await apiFetch('/rules/reapply',{method:'POST'});toast(r.updated>0?`${r.updated} transaction${r.updated!==1?'s':''} refreshed (${r.total} checked)`:'No changes needed — all transactions already up to date');}
    catch(e){toast('Failed: '+(e.message||e),'error');}
    finally{setReapplying(false);}
  };
  const[cleaningDescs,setCleaningDescs]=useState(false);
  const cleanDescriptions=async()=>{
    setCleaningDescs(true);
    try{
      const r=await apiFetch('/rules/clean-descriptions',{method:'POST'});
      toast(r.updated>0?`Updated ${r.updated} display name${r.updated!==1?'s':''} across ${r.total} transactions`:'All display names already match their rules — nothing to update');
    }catch(e){toast('Failed: '+(e.message||e),'error');}
    finally{setCleaningDescs(false);}
  };

  /* Cards file upload */
  const uploadCards=async(e)=>{
    const file=e.target.files[0];if(!file)return;
    setBusy(true);
    try{
      const form=new FormData();form.append('file',file);
      const r=await fetch('/api/cards/upload-and-import',{method:'POST',body:form}).then(r=>r.json());
      toast(r.message||`Imported ${r.imported} cards`);
    }catch(err){toast('Upload failed','error');}
    finally{setBusy(false);e.target.value='';}
  };

  /* Preferences state — persisted in localStorage */
  const[prefs,setPrefs]=useState(()=>{
    try{return JSON.parse(localStorage.getItem('user-prefs'))||{};}catch(e){return{};}
  });
  const setPref=(k,v)=>{setPrefs(p=>{const n={...p,[k]:v};localStorage.setItem('user-prefs',JSON.stringify(n));return n;});};

  const tabs=[
    {id:'prefs',label:'Preferences'},
    {id:'data',label:'Data Management'},
    {id:'rules',label:'Rules'},
    {id:'bank',label:'Bank Links'},
    {id:'about',label:'About'},
  ];

  return(
    <div>
      {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}
      <div className="card" style={{display:'flex',gap:24,marginBottom:24,padding:'12px 24px'}}>
        {tabs.map(t=>(<button type="button" key={t.id} onClick={()=>setTab(t.id)}
          style={{padding:'8px 0',border:'none',borderBottom:tab===t.id?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:12,fontWeight:tab===t.id?500:400,
            background:'transparent',color:tab===t.id?'var(--blue-primary)':'var(--text-muted)',transition:'all 0.15s',marginBottom:'-1px'}}>{t.label}</button>))}
      </div>

      {tab==='prefs'&&<div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header"><div className="section-title">Display</div></div>
          <div className="settings-row">
            <div><div className="settings-label">Currency</div><div className="settings-desc">Currency symbol used throughout the app</div></div>
            <select className="sel-drop" value={prefs.currency||'USD'} onChange={e=>setPref('currency',e.target.value)} style={{width:120}}>
              {[['USD','$ USD'],['EUR','€ EUR'],['GBP','£ GBP'],['ILS','₪ ILS'],['CAD','$ CAD'],['AUD','$ AUD'],['JPY','¥ JPY']].map(([v,l])=>(
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <div><div className="settings-label">Date Format</div><div className="settings-desc">How dates are displayed in tables and charts</div></div>
            <select className="sel-drop" value={prefs.dateFormat||'MM/DD/YYYY'} onChange={e=>setPref('dateFormat',e.target.value)} style={{width:140}}>
              {['MM/DD/YYYY','DD/MM/YYYY','YYYY-MM-DD'].map(f=><option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="settings-row">
            <div><div className="settings-label">Number Format</div><div className="settings-desc">How amounts are formatted (thousands separator)</div></div>
            <select className="sel-drop" value={prefs.numFormat||'1,234.56'} onChange={e=>setPref('numFormat',e.target.value)} style={{width:140}}>
              {['1,234.56','1.234,56','1 234.56'].map(f=><option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header"><div className="section-title">Behavior</div></div>
          <div className="settings-row">
            <div><div className="settings-label">Default Transaction View</div><div className="settings-desc">Which month loads first on the Transactions page</div></div>
            <select className="sel-drop" value={prefs.defaultTxnView||'current'} onChange={e=>setPref('defaultTxnView',e.target.value)} style={{width:140}}>
              <option value="current">Current Month</option>
              <option value="previous">Previous Month</option>
              <option value="all">All Time</option>
            </select>
          </div>
          <div className="settings-row">
            <div><div className="settings-label">Compact Tables</div><div className="settings-desc">Reduce row height in transaction and balance tables</div></div>
            <button type="button" className="btn btn-sm" onClick={()=>setPref('compact',!prefs.compact)}
              style={{minWidth:56,background:prefs.compact?'var(--green)':'var(--elevated)',color:prefs.compact?'#fff':'var(--text-muted)',border:prefs.compact?'none':'1px solid var(--border)',fontWeight:500,fontSize:12,transition:'all 0.15s'}}>
              {prefs.compact?'On':'Off'}
            </button>
          </div>
          <div className="settings-row">
            <div><div className="settings-label">Show Cents</div><div className="settings-desc">Display decimal places in amounts (e.g. $1,234.56 vs $1,235)</div></div>
            <button type="button" className="btn btn-sm" onClick={()=>setPref('showCents',prefs.showCents===false?true:!(prefs.showCents!==false))}
              style={{minWidth:56,background:(prefs.showCents!==false)?'var(--green)':'var(--elevated)',color:(prefs.showCents!==false)?'#fff':'var(--text-muted)',border:(prefs.showCents!==false)?'none':'1px solid var(--border)',fontWeight:500,fontSize:12,transition:'all 0.15s'}}>
              {prefs.showCents!==false?'On':'Off'}
            </button>
          </div>
        </div>
        <div className="card">
          <div className="section-header"><div className="section-title">Data</div></div>
          <div className="settings-row">
            <div><div className="settings-label">Export All Transactions</div><div className="settings-desc">Download a CSV file of all transactions for external analysis</div></div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={async()=>{
              try{
                const resp=await fetch('/api/transactions?limit=999999');
                const txns=await resp.json();
                const headers=['date','description_clean','description_raw','amount','category_final','action','account_name','is_excluded'];
                const rows=txns.map(t=>headers.map(h=>JSON.stringify(t[h]??'')).join(','));
                const csv=[headers.join(','),...rows].join('\n');
                const blob=new Blob([csv],{type:'text/csv'});
                const url=URL.createObjectURL(blob);
                const link=document.createElement('a');link.href=url;link.download=`transactions-${todayStr()}.csv`;link.click();
                URL.revokeObjectURL(url);
                toast(`Exported ${txns.length} transactions`);
              }catch(e){toast('Export failed','error');}
            }}>↓ Export CSV</button>
          </div>
        </div>
      </div>}

      {tab==='data'&&<div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header"><div className="section-title">Categorization</div></div>
          <div className="settings-row">
            <div><div className="settings-label">Re-categorize All Transactions</div><div className="settings-desc">Re-runs all rules on unlocked transactions</div></div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={()=>run('/init/recategorize','Re-categorized!')} disabled={busy}>{busy?'…':'Run'}</button>
          </div>
          <div className="settings-row">
            <div><div className="settings-label">Re-import Rules from Excel</div><div className="settings-desc">Reloads categorization rules from your Excel file</div></div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={()=>run('/init/import-rules','Rules imported!')} disabled={busy}>{busy?'…':'Import'}</button>
          </div>
        </div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header"><div className="section-title">Data Fixes</div></div>
          <div className="settings-row">
            <div><div className="settings-label">Fix Transaction Signs</div><div className="settings-desc">Corrects sign convention (expenses negative, income positive)</div></div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={()=>run('/init/fix-signs','Signs fixed!')} disabled={busy}>{busy?'…':'Fix'}</button>
          </div>
          <div className="settings-row">
            <div><div className="settings-label">📊 Rebuild All Balance Snapshots</div><div className="settings-desc">Recalculates monthly opening/closing balances for every account. Safe to run any time — use if Daily Balances looks wrong after a sync or merge.</div></div>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={async()=>{
              setBusy(true);
              try{const r=await apiFetch('/accounts/rebuild-all-snapshots',{method:'POST'});toast(`📊 Rebuilt snapshots for ${r.accounts_rebuilt} account${r.accounts_rebuilt!==1?'s':''}`);}
              catch(e){toast('Rebuild failed: '+(e.message||e),'error');}
              finally{setBusy(false);}
            }}>{busy?'…':'Rebuild'}</button>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">🔑 Backfill Persistent Account IDs</div>
              <div className="settings-desc">One-time migration: fetches Plaid's stable account identifiers for all connected banks and stores them locally. Run once — enables reliable re-link matching in future. Safe to run multiple times.</div>
            </div>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={async()=>{
              setBusy(true);
              try{
                const r=await apiFetch('/plaid/backfill-persistent-ids',{method:'POST'});
                const noSupport=r.items.filter(i=>i.no_pid>0).map(i=>i.institution);
                let msg=`🔑 Backfilled ${r.total_updated} account${r.total_updated!==1?'s':''}`;
                if(noSupport.length>0)msg+=` (${noSupport.join(', ')}: no persistent IDs — institution limitation)`;
                toast(msg);
                // Show per-institution detail in console for debugging
                console.table(r.items);
              }catch(e){toast('Backfill failed: '+(e.message||e),'error');}
              finally{setBusy(false);}
            }}>{busy?'…':'Run Backfill'}</button>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">#️⃣ Backfill Transaction Content Hashes</div>
              <div className="settings-desc">One-time migration: assigns a stable content hash to every existing transaction. Required before "Re-download" can preserve your classifications across Plaid re-links. Safe to run multiple times — only unprocessed rows are updated.</div>
            </div>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={async()=>{
              setBusy(true);
              try{
                const r=await apiFetch('/transactions/backfill-content-hashes',{method:'POST'});
                toast(`#️⃣ Hashed ${r.backfilled} transaction${r.backfilled!==1?'s':''}`);
              }catch(e){toast('Backfill failed: '+(e.message||e),'error');}
              finally{setBusy(false);}
            }}>{busy?'…':'Run Backfill'}</button>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">💰 Fix Account Balances</div>
              <div className="settings-desc">Fetches the current balance for every linked account from Plaid and sets it as the balance anchor, then rebuilds monthly snapshots. Run this once after re-linking all banks to correct any $0 balances. Safe to run multiple times.</div>
            </div>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={async()=>{
              setBusy(true);
              try{
                const r=await apiFetch('/accounts/backfill-balances',{method:'POST'});
                const errs=r.errors&&r.errors.length?` (${r.errors.length} warning${r.errors.length!==1?'s':''})`:''
                toast(`💰 Updated ${r.accounts_updated} account${r.accounts_updated!==1?'s':''}, rebuilt ${r.snapshots_rebuilt} snapshot${r.snapshots_rebuilt!==1?'s':''}${errs}`);
              }catch(e){toast('Balance fix failed: '+(e.message||e),'error');}
              finally{setBusy(false);}
            }}>{busy?'…':'Fix Balances'}</button>
          </div>
        </div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header"><div className="section-title">⚠️ Danger Zone</div></div>
          <div className="settings-row">
            <div>
              <div className="settings-label">🔄 Fresh Start</div>
              <div className="settings-desc">Wipes all Plaid-sourced transactions, removes ghost accounts, clears sync cursors, triggers a full re-download. Account records, categories, and rules are preserved.</div>
            </div>
            <button type="button" className="btn btn-sm" style={{background:'var(--amber)',color:'#0c0c10',border:'1px solid rgba(251,191,36,0.4)',whiteSpace:'nowrap'}} disabled={busy} onClick={()=>setCm({
              title:'Fresh Start',
              body:'This will delete ALL Plaid-synced transactions and re-download everything from scratch.\n\nAccount records, categories, and rules are kept.',
              confirmLabel:'Fresh Start',danger:true,
              onConfirm:async()=>{
                setBusy(true);
                try{const r=await apiFetch('/reset-all',{method:'POST'});toast(`🔄 ${r.status}`);}
                catch(e){toast('Fresh Start failed: '+(e.message||e),'error');}
                finally{setBusy(false);}
              }
            })}>{busy?'…':'Fresh Start'}</button>
          </div>
          <div className="settings-row" style={{borderTop:'1px solid rgba(248,113,113,0.3)',marginTop:8,paddingTop:12}}>
            <div>
              <div className="settings-label">💣 Nuke Everything</div>
              <div className="settings-desc">Deletes ALL transactions, ALL accounts, and ALL bank connections. The app is left completely empty. Reconnect your banks from scratch via + Connect Bank. Categories and rules are preserved.</div>
            </div>
            <button type="button" className="btn btn-sm" style={{background:'var(--red)',color:'#fff',border:'1px solid rgba(248,113,113,0.4)',whiteSpace:'nowrap'}} disabled={busy} onClick={()=>setCm({
              title:'⚠️ Nuke Everything',
              body:'This will permanently delete:\n• All transactions\n• All accounts\n• All bank connections\n\nCategories and rules are kept. This cannot be undone.',
              confirmLabel:'💣 Nuke Everything',danger:true,requiredInput:'NUKE',
              onConfirm:async()=>{
                setBusy(true);
                try{const r=await apiFetch('/nuke',{method:'POST'});toast(`💣 ${r.status}`);}
                catch(e){toast('Nuke failed: '+(e.message||e),'error');}
                finally{setBusy(false);}
              }
            })}>{busy?'…':'💣 Nuke Everything'}</button>
          </div>
        </div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header"><div className="section-title">Cards Import</div></div>
          <div className="settings-row">
            <div><div className="settings-label">Import Cards from local file</div><div className="settings-desc">Loads card data from cards.xlsx on server</div></div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={()=>run('/init/import-cards','Cards imported!')} disabled={busy}>{busy?'…':'Import'}</button>
          </div>
          <div className="settings-row">
            <div><div className="settings-label">Upload cards.xlsx</div><div className="settings-desc">Upload a new cards.xlsx file and import</div></div>
            <label className="btn btn-sm btn-primary" style={{cursor:'pointer'}}>{busy?'…':'Upload'}<input type="file" accept=".xlsx,.xls" onChange={uploadCards} style={{display:'none'}}/></label>
          </div>
        </div>
      </div>}

      {tab==='rules'&&<div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div className="section-title">Categorization Rules ({rules.length})</div>
            <div style={{display:'flex',gap:8}}>
              <input className="search-input" placeholder="Search patterns…" value={ruleSearch} onChange={e=>setRuleSearch(e.target.value)} style={{width:200}}/>
              <button type="button" className="btn btn-sm btn-secondary" onClick={cleanDescriptions} disabled={cleaningDescs} title="Fill in missing display names for transactions that still show raw bank text">{cleaningDescs?'Cleaning…':'✦ Fix Descriptions'}</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={applyRules} disabled={reapplying} title="Re-apply all rules to existing non-locked transactions">{reapplying?'Applying…':'↺ Apply Rules'}</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={()=>{setShowAddRule(true);setRuleEditVals({priority:100,match_type:'contains',pattern:'',set_action:'',set_category:'',set_description:'',clean_description:'',notes:''});}}>+ Add Rule</button>
            </div>
          </div>
          {/* Add Rule modal */}
          {showAddRule&&<div style={{padding:'16px 20px',background:'rgba(var(--blue-primary-rgb), 0.12)',border:'1px solid var(--blue-primary)',borderRadius:10,margin:'0 16px 16px'}}>
            <div style={{fontSize:13,fontWeight:400,marginBottom:8,color:'var(--text-primary)'}}>New Rule</div>
            <div style={{display:'grid',gridTemplateColumns:'80px 100px 1fr 100px 100px',gap:8,fontSize:12,marginBottom:8}}>
              <input type="number" value={ruleEditVals.priority||100} onChange={e=>setRuleEditVals(v=>({...v,priority:parseInt(e.target.value)}))} placeholder="Priority" style={{border:'1px solid var(--border)',borderRadius:4,padding:'4px 6px',fontSize:12}}/>
              <select value={ruleEditVals.match_type||'contains'} onChange={e=>setRuleEditVals(v=>({...v,match_type:e.target.value}))} style={{border:'1px solid var(--border)',borderRadius:4,padding:'4px 6px',fontSize:12}}>
                {[['contains','Contains'],['contains_any','Contains Any'],['contains_all','Contains All'],['equals','Equals'],['starts_with','Starts With'],['regex','Regex']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
              <input value={ruleEditVals.pattern||''} onChange={e=>setRuleEditVals(v=>({...v,pattern:e.target.value}))} placeholder="Pattern" style={{border:'1px solid var(--border)',borderRadius:4,padding:'4px 6px',fontSize:12}}/>
              <select value={ruleEditVals.set_action||''} onChange={e=>setRuleEditVals(v=>({...v,set_action:e.target.value}))} style={{border:'1px solid var(--border)',borderRadius:4,padding:'4px 6px',fontSize:12}}>
                <option value="">— Action —</option>
                {TXN_TYPES.map(a=><option key={a} value={a}>{a}</option>)}
              </select>
              <select value={ruleEditVals.set_category||''} onChange={e=>setRuleEditVals(v=>({...v,set_category:e.target.value}))} style={{border:'1px solid var(--border)',borderRadius:4,padding:'4px 6px',fontSize:12}}>
                <option value="">— Category —</option>
                {sortedCats(categories||[]).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div style={{display:'flex',gap:8}}>
              <input value={ruleEditVals.set_description||''} onChange={e=>setRuleEditVals(v=>({...v,set_description:e.target.value}))} placeholder="Set Description" style={{flex:1,border:'1px solid var(--border)',borderRadius:4,padding:'4px 6px',fontSize:12}}/>
              <input value={ruleEditVals.notes||''} onChange={e=>setRuleEditVals(v=>({...v,notes:e.target.value}))} placeholder="Notes" style={{flex:1,border:'1px solid var(--border)',borderRadius:4,padding:'4px 6px',fontSize:12}}/>
              <button type="button" className="btn btn-sm btn-success" onClick={addRule}>Create</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setShowAddRule(false)}>Cancel</button>
            </div>
          </div>}
          {rulesLoading?<div className="loading"><div className="spinner"/></div>
            :<div className="table-wrap" style={{maxHeight:500,overflowY:'auto'}}><table style={{fontSize:12}}>
              <thead><tr><th>Pri</th><th>Match</th><th>Pattern</th><th>Action</th><th>Category</th><th>Description</th><th>Notes</th><th>Stats</th><th></th></tr></thead>
              <tbody>{rules.map(r=>(
                ruleEditing===r.id?<tr key={r.id} style={{background:'rgba(251,191,36,0.1)'}}>
                  <td><input type="number" value={ruleEditVals.priority} onChange={e=>setRuleEditVals(v=>({...v,priority:parseInt(e.target.value)}))} style={{width:50,fontSize:11,border:'1px solid var(--border)',borderRadius:4,padding:'2px 4px'}}/></td>
                  <td><select value={ruleEditVals.match_type} onChange={e=>setRuleEditVals(v=>({...v,match_type:e.target.value}))} style={{fontSize:11}}>
                    {[['contains','Contains'],['contains_any','Contains Any'],['contains_all','Contains All'],['equals','Equals'],['starts_with','Starts With'],['regex','Regex']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select></td>
                  <td><input value={ruleEditVals.pattern} onChange={e=>setRuleEditVals(v=>({...v,pattern:e.target.value}))} style={{width:'100%',fontSize:11,border:'1px solid var(--border)',borderRadius:4,padding:'2px 4px'}}/></td>
                  <td><select value={ruleEditVals.set_action} onChange={e=>setRuleEditVals(v=>({...v,set_action:e.target.value}))} style={{width:80,fontSize:11,border:'1px solid var(--border)',borderRadius:4,padding:'2px 4px'}}>
                    <option value="">—</option>
                    {TXN_TYPES.map(a=><option key={a} value={a}>{a}</option>)}
                  </select></td>
                  <td><select value={ruleEditVals.set_category} onChange={e=>setRuleEditVals(v=>({...v,set_category:e.target.value}))} style={{width:110,fontSize:11,border:'1px solid var(--border)',borderRadius:4,padding:'2px 4px'}}>
                    <option value="">—</option>
                    {sortedCats(categories||[]).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                  </select></td>
                  <td><input value={ruleEditVals.set_description} onChange={e=>setRuleEditVals(v=>({...v,set_description:e.target.value}))} style={{width:100,fontSize:11,border:'1px solid var(--border)',borderRadius:4,padding:'2px 4px'}}/></td>
                  <td><input value={ruleEditVals.notes} onChange={e=>setRuleEditVals(v=>({...v,notes:e.target.value}))} style={{width:80,fontSize:11,border:'1px solid var(--border)',borderRadius:4,padding:'2px 4px'}}/></td>
                  <td></td>
                  <td><div style={{display:'flex',gap:4}}><button type="button" className="btn btn-sm btn-success" onClick={()=>saveRuleEdit(r.id)} style={{fontSize:10,padding:'2px 6px'}}>Save</button><button type="button" className="btn btn-sm btn-ghost" onClick={()=>setRuleEditing(null)} style={{fontSize:10,padding:'2px 6px'}}>×</button></div></td>
                </tr>:<tr key={r.id}>
                  <td style={{fontFamily:'Plus Jakarta Sans',color:'var(--text-muted)'}}>{r.priority}</td>
                  <td style={{color:'var(--text-muted)'}}>{r.match_type}</td>
                  <td style={{fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.pattern}>{r.pattern}</td>
                  <td>{r.set_action&&<span className="badge badge-income" style={{fontSize:10}}>{r.set_action}</span>}</td>
                  <td>{r.set_category&&<span className="badge badge-category" style={{fontSize:10}}>{r.set_category}</span>}</td>
                  <td style={{color:'var(--text-muted)',maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.set_description}>{r.set_description||'—'}</td>
                  <td style={{fontSize:10,color:'var(--text-muted)',maxWidth:80,overflow:'hidden',textOverflow:'ellipsis'}} title={r.notes}>{r.notes||''}</td>
                  <td style={{fontSize:10,whiteSpace:'nowrap'}} title={r.times_matched>0?`Matched ${r.times_matched}× — ${r.times_accepted} accepted, ${r.times_rejected} rejected`:''}>
                    {r.times_matched>0&&<span style={{color:r.times_rejected>r.times_accepted?'var(--red)':'var(--text-muted)'}}>
                      {r.times_matched}m {r.times_accepted}a {r.times_rejected}r{r.times_rejected>r.times_accepted?' ⚠':''}
                    </span>}
                  </td>
                  <td><div style={{display:'flex',gap:4}}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={()=>startRuleEdit(r)} style={{fontSize:10,padding:'2px 6px'}}>Edit</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={()=>deleteRule(r.id)} style={{fontSize:10,padding:'2px 6px',color:'var(--red)'}}>×</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          }
        </div>
      </div>}

      {tab==='bank'&&<div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header">
            <div>
              <div className="section-title">Balance Sync</div>
              <div className="section-desc" style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>Rebuilds monthly balance snapshots from your transactions. Use <b>Force Resync</b> only when Plaid's balance is current (not right after a long weekend) — it re-anchors all accounts to today's Plaid balance.</div>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <button type="button" className="btn btn-sm btn-secondary" onClick={()=>syncBalances(false)} disabled={balanceSyncing}>{balanceSyncing?'Syncing…':'↺ Sync Balances'}</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={()=>setCm({
                title:'Force Balance Resync',
                body:"Re-anchors all accounts to today's Plaid balance.\n\nOnly do this when Plaid's balance is fully up to date (not right after a long weekend when transactions may not have posted yet).",
                confirmLabel:'Force Resync',danger:false,
                onConfirm:async()=>syncBalances(true)
              })} disabled={balanceSyncing} style={{borderColor:'var(--amber)',color:'var(--amber)'}}>⚡ Force Resync</button>
            </div>
          </div>
          {balanceSyncResult&&<div style={{marginTop:12}}>
            <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:8}}>
              Last sync: {balanceSyncResult.synced} account{balanceSyncResult.synced!==1?'s':''} processed
              {balanceSyncResult.force&&<span style={{marginLeft:8,fontWeight:500,color:'var(--amber)'}}>(force resync — anchors updated from Plaid)</span>}
              {balanceSyncResult.skipped>0&&<span style={{marginLeft:8,color:'var(--amber)'}}>({balanceSyncResult.skipped} skipped)</span>}
            </div>
            {balanceSyncResult.accounts&&balanceSyncResult.accounts.length>0&&(()=>{
              const fmtB=v=>{const neg=v<0;return (neg?'−':'')+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Math.abs(v));};
              const anyDelta=balanceSyncResult.accounts.some(a=>a.delta!=null&&Math.abs(a.delta)>0.01);
              return <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead><tr style={{borderBottom:'1px solid var(--border)',color:'var(--text-muted)'}}>
                    <th style={{textAlign:'left',padding:'4px 8px 4px 0',fontWeight:500}}>Account</th>
                    <th style={{textAlign:'right',padding:'4px 8px',fontWeight:500}}>Plaid Balance</th>
                    <th style={{textAlign:'right',padding:'4px 8px',fontWeight:500}}>System Balance</th>
                    <th style={{textAlign:'right',padding:'4px 0 4px 8px',fontWeight:500}}>Difference</th>
                  </tr></thead>
                  <tbody>{balanceSyncResult.accounts.map((a,i)=>{
                    const diff=a.delta;
                    const absDiff=diff!=null?Math.abs(diff):null;
                    const diffColor=diff==null?'var(--text-muted)':absDiff<0.01?'var(--text-muted)':absDiff<10?'var(--amber)':'var(--red)';
                    const plaidUnavail=a.source==='plaid_unavailable';
                    return <tr key={i} style={{borderBottom:'1px solid var(--border-light)'}}>
                      <td style={{padding:'5px 8px 5px 0'}}>
                        <span style={{fontWeight:500}}>{a.name}</span>
                        {a.is_manual&&<span style={{marginLeft:6,fontSize:10,background:'var(--bg-subtle)',color:'var(--text-muted)',borderRadius:3,padding:'1px 4px'}}>manual</span>}
                        {plaidUnavail&&<span style={{marginLeft:6,fontSize:10,background:'rgba(248,113,113,0.12)',color:'var(--red)',borderRadius:3,padding:'1px 4px'}} title="Plaid returned no balance for this account">no Plaid data</span>}
                        {a.anchor_updated&&<span style={{marginLeft:6,fontSize:10,background:'rgba(251,191,36,0.12)',color:'var(--amber)',borderRadius:3,padding:'1px 4px'}}>anchor reset</span>}
                      </td>
                      <td style={{textAlign:'right',padding:'5px 8px',fontFamily:'monospace',color:(a.is_manual||plaidUnavail)?'var(--text-muted)':'inherit'}}>
                        {a.plaid_balance!=null?fmtB(a.plaid_balance):'—'}
                      </td>
                      <td style={{textAlign:'right',padding:'5px 8px',fontFamily:'monospace'}}>{fmtB(a.computed_balance)}</td>
                      <td style={{textAlign:'right',padding:'5px 0 5px 8px',fontFamily:'monospace',color:diffColor,fontWeight:absDiff!=null&&absDiff>0.01?600:400}}>
                        {diff==null?'—':absDiff<0.01?'—':(diff>0?'+':'')+fmtB(diff)}
                      </td>
                    </tr>;
                  })}</tbody>
                </table>
                {anyDelta&&<div style={{marginTop:8,fontSize:11,color:'var(--text-muted)'}}>
                  A non-zero difference typically means Plaid's balance lags your transactions (e.g. after a weekend). If it persists once transactions have posted, use ⚡ Force Resync.
                </div>}
              </div>;
            })()}
          </div>}
        </div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header">
            <div>
              <div className="section-title">Duplicate Accounts</div>
              <div className="section-desc" style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>After re-linking a bank, Plaid sometimes creates duplicate accounts. Scan to detect them and merge with one click — your custom names, card links, and full history are preserved.</div>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <button type="button" className="btn btn-sm btn-secondary" onClick={scanDuplicates} disabled={dupScanning}>{dupScanning?'Scanning…':'🔍 Scan for Duplicates'}</button>
            </div>
          </div>
          {dupResult&&(()=>{
            const hasDups=dupGroups&&dupGroups.length>0;
            const hasIgnored=dupIgnored&&dupIgnored.length>0;
            if(!hasDups&&!hasIgnored)return<div style={{fontSize:12,color:'var(--text-muted)',marginTop:8}}>✓ No duplicate accounts found.</div>;
            const DupTable=({rows,showMerge,showIgnore,showUnignore})=>(
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{borderBottom:'1px solid var(--border)',color:'var(--text-muted)'}}>
                  <th style={{textAlign:'left',padding:'4px 8px 4px 0',fontWeight:500}}>Keep (oldest)</th>
                  <th style={{textAlign:'left',padding:'4px 8px',fontWeight:500}}>{showIgnore?'Flagged as duplicate':'Ignored (not a duplicate)'}</th>
                  <th style={{textAlign:'right',padding:'4px 0 4px 8px',fontWeight:500}}>Actions</th>
                </tr></thead>
                <tbody>{rows.map((g,gi)=>g.discard_ids.map((did,di)=>{
                  const keep=g.accounts.find(a=>a.id===g.keep_id);
                  const discard=g.accounts.find(a=>a.id===did);
                  return <tr key={`${gi}-${di}`} style={{borderBottom:'1px solid var(--border-light)'}}>
                    <td style={{padding:'5px 8px 5px 0'}}>
                      <span style={{fontWeight:500}}>{keep.name}</span>
                      <span style={{marginLeft:6,fontSize:10,background:'var(--bg-subtle)',color:'var(--text-muted)',borderRadius:3,padding:'1px 4px'}}>…{keep.mask}</span>
                      {keep.card_count>0&&<span style={{marginLeft:4,fontSize:10,background:'rgba(var(--blue-primary-rgb), 0.12)',color:'var(--blue-primary)',borderRadius:3,padding:'1px 4px'}}>{keep.card_count} card{keep.card_count!==1?'s':''}</span>}
                      <div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>{keep.transaction_count} txn{keep.transaction_count!==1?'s':''}</div>
                    </td>
                    <td style={{padding:'5px 8px'}}>
                      <span style={{color:'var(--text-muted)'}}>{discard.name}</span>
                      <div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>{discard.transaction_count} txn{discard.transaction_count!==1?'s':''}</div>
                      {showIgnore&&<span style={{marginLeft:0,fontSize:10,background:'rgba(248,113,113,0.12)',color:'var(--red)',borderRadius:3,padding:'1px 4px',display:'inline-block',marginTop:2}}>duplicate</span>}
                      {showUnignore&&<span style={{marginLeft:0,fontSize:10,background:'var(--bg-subtle)',color:'var(--text-muted)',borderRadius:3,padding:'1px 4px',display:'inline-block',marginTop:2}}>ignored</span>}
                      {g.warning&&<span title={g.warning} style={{marginLeft:4,fontSize:10,background:'rgba(251,191,36,0.12)',color:'var(--amber)',borderRadius:3,padding:'1px 4px',display:'inline-block',marginTop:2,cursor:'help'}}>⚠️ confirm</span>}
                    </td>
                    <td style={{textAlign:'right',padding:'5px 0 5px 8px',whiteSpace:'nowrap'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'flex-end',flexWrap:'nowrap'}}>
                        {showMerge&&<button type="button" className="btn btn-xs btn-primary" style={{fontSize:10,padding:'2px 8px'}} onClick={()=>{if(g.warning){setCm({title:'Confirm Merge',body:`⚠️ ${g.warning}\n\nThis will keep "${keep.name}" and remove "${discard.name}".`,confirmLabel:'Merge Anyway',danger:true,onConfirm:async()=>mergeOnePair(keep.id,did)});}else mergeOnePair(keep.id,did);}}>Merge ▶</button>}
                        {showIgnore&&<button type="button" className="btn btn-xs btn-secondary" style={{fontSize:10,padding:'2px 6px'}} onClick={()=>ignoreDuplicatePair(keep.id,did)} title="Mark as not a duplicate — won't appear in future scans">Ignore</button>}
                        {showUnignore&&<button type="button" className="btn btn-xs btn-secondary" style={{fontSize:10,padding:'2px 6px'}} onClick={()=>unignorePair(keep.id,did)}>Unignore</button>}
                      </div>
                    </td>
                  </tr>;
                }))}</tbody>
              </table>
            );
            return <div style={{marginTop:12}}>
              {hasDups&&<>
                <div style={{fontSize:12,color:'var(--amber)',marginBottom:8,fontWeight:500}}>{dupGroups.length} duplicate pair{dupGroups.length!==1?'s':''} found — use "Merge ▶" to fix each pair individually, or "Ignore" for false positives</div>
                <DupTable rows={dupGroups} showMerge={true} showIgnore={true} showUnignore={false}/>
                <div style={{marginTop:8,fontSize:11,color:'var(--text-muted)'}}>
                  Each "Merge ▶" keeps the oldest account's name and card links, adopts the new Plaid connection so future syncs work, and moves any transactions across. Pairs marked ⚠️ have different product names — hover for details, and confirm before merging. Use "Ignore" if two accounts share the same last 4 digits but are genuinely different cards.
                </div>
              </>}
              {hasIgnored&&<>
                <div style={{fontSize:12,color:'var(--text-muted)',marginTop:hasDups?20:0,marginBottom:8}}>Ignored pairs (confirmed not duplicates)</div>
                <DupTable rows={dupIgnored} showMerge={false} showIgnore={false} showUnignore={true}/>
              </>}
            </div>;
          })()}
        </div>
        <div className="card" style={{marginBottom:20}}>
          <div className="section-header">
            <div className="section-title">Connected Banks ({items.length})</div>
            <div style={{display:'flex',gap:8}}>
              {items.length>0&&<button type="button" className="btn btn-sm btn-secondary" style={{fontSize:11}} onClick={checkPlaidHealth} disabled={healthChecking} title="Check Plaid connection health for all institutions">{healthChecking?'Checking…':'🔍 Check Health'}</button>}
              {items.length>0&&<SyncLiabilitiesButton toast={toast} onDone={refreshItems}/>}
              {items.length>0&&<ResetResyncButton toast={toast} onDone={refreshItems}/>}
              <button type="button" className="btn btn-sm btn-primary" onClick={onConnectBank}>+ Connect Bank</button>
            </div>
          </div>
          {healthResults&&(
            <div style={{marginBottom:16,borderRadius:8,overflow:'hidden',border:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 14px',background:'var(--bg)',borderBottom:'1px solid var(--border)'}}>
                <div style={{fontSize:12,fontWeight:400,color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Plaid Connection Health</div>
                <button type="button" onClick={()=>setHealthResults(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:16,color:'var(--text-muted)',lineHeight:1}}>×</button>
              </div>
              {healthResults.map((r,i)=>{
                const healthy=r.ok;
                const errCode=r.error?.error_code;
                const needsRelink=errCode==='ITEM_LOGIN_REQUIRED'||errCode==='ITEM_NOT_FOUND'||errCode==='INVALID_ACCESS_TOKEN';
                const expiring=errCode==='PENDING_EXPIRATION';
                const hasInternalErr=!!r.internal_error_code;
                const isSyncErr=r.internal_error_code?.startsWith('SYNC_ERROR:');
                const internalErrLabel=isSyncErr?r.internal_error_code.replace('SYNC_ERROR:',''):r.internal_error_code;
                const bgColor=healthy?(hasInternalErr?'rgba(251,191,36,0.06)':'rgba(52,211,153,0.06)'):needsRelink||expiring?'rgba(251,191,36,0.06)':'rgba(248,113,113,0.06)';
                const dot=healthy?(hasInternalErr?'🟡':'🟢'):needsRelink||expiring?'🟡':'🔴';
                const fmtTs=ts=>ts?ts.replace('T',' ').slice(0,16)+' UTC':'—';
                return(
                  <div key={i} style={{padding:'10px 14px',background:bgColor,borderBottom:i<healthResults.length-1?'1px solid var(--border)':'none'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                      <span>{dot}</span>
                      <span style={{fontWeight:500,fontSize:13}}>{r.institution_name}</span>
                      {errCode&&<span style={{fontSize:11,fontWeight:400,padding:'1px 8px',borderRadius:20,background:needsRelink||expiring?'rgba(251,191,36,0.12)':'rgba(248,113,113,0.12)',color:needsRelink||expiring?'var(--amber)':'var(--red)'}}>{errCode}</span>}
                      {hasInternalErr&&<span style={{fontSize:11,fontWeight:400,padding:'1px 8px',borderRadius:20,background:'rgba(251,146,36,0.08)',color:'var(--amber)'}} title={r.internal_error_message||''}>⚠️ {internalErrLabel}</span>}
                    </div>
                    <div style={{display:'flex',gap:24,fontSize:11,color:'var(--text-muted)',flexWrap:'wrap',marginLeft:24}}>
                      <span>Last sync: <strong style={{color:'var(--text-primary)'}}>{fmtTs(r.last_synced_at)}</strong></span>
                      <span>Last successful update: <strong style={{color:r.last_successful_update?'var(--green)':'var(--text-muted)'}}>{fmtTs(r.last_successful_update)}</strong></span>
                      {r.last_failed_update&&<span>Last failed: <strong style={{color:'var(--red)'}}>{fmtTs(r.last_failed_update)}</strong></span>}
                      {r.consent_expiration_time&&<span>Consent expires: <strong style={{color:'var(--amber)'}}>{fmtTs(r.consent_expiration_time)}</strong></span>}
                      <span>Update type: <strong>{r.update_type||'—'}</strong></span>
                    </div>
                    {r.error?.display_message&&<div style={{marginTop:4,marginLeft:24,fontSize:11,color:'var(--red)'}}>{r.error.display_message}</div>}
                    {hasInternalErr&&<div style={{marginTop:4,marginLeft:24,fontSize:11,color:'var(--amber)'}}>{r.internal_error_message}</div>}
                    {needsRelink&&<div style={{marginTop:6,marginLeft:24,fontSize:12,color:'var(--amber)',fontWeight:500}}>⚠️ Reconnect required — use "+ Connect Bank" to re-link this institution.</div>}
                    {expiring&&<div style={{marginTop:6,marginLeft:24,fontSize:12,color:'var(--amber)',fontWeight:500}}>⚠️ OAuth consent is expiring soon — re-link soon to keep syncing.</div>}
                    {hasInternalErr&&!needsRelink&&<div style={{marginTop:6,marginLeft:24,fontSize:12,color:'var(--amber)',fontWeight:500}}>⚠️ Our sync has a stored error for this account. A new sync attempt will clear it if Plaid is healthy.</div>}
                  </div>
                );
              })}
            </div>
          )}
          {items.length===0?<div className="empty" style={{padding:40}}><div className="empty-icon">◫</div><span>No banks connected</span><span style={{fontSize:12,color:'var(--text-muted)'}}>Click "+ Connect Bank" to link via Plaid</span></div>
            :items.map((item,i)=><BankRow key={item.item_id||i} item={item} toast={toast} onRenamed={(id,name)=>{setItems(prev=>prev.map(it=>it.item_id===id?{...it,institution_name:name}:it));onBanksChanged&&onBanksChanged();}} onSynced={refreshItems}/>)
          }
        </div>
      </div>}

      {tab==='about'&&<div>
        <div className="card">
          <div className="section-header"><div className="section-title">About</div></div>
          <div style={{padding:'20px',fontSize:13,color:'var(--text-secondary)',lineHeight:1.8}}>
            <p style={{fontWeight:500,color:'var(--text-primary)'}}>Moresheth v2.0</p>
            <p>Plaid sync + rule-based categorization + manual accounts</p>
            <p style={{marginTop:8}}>Stack: FastAPI + SQLAlchemy + SQLite + React</p>
            <p>Features: Transactions, Budgets, Balance Timeline, Net Worth, Cards, GCB Tracking</p>
          </div>
        </div>
      </div>}
    </div>
  );
}
