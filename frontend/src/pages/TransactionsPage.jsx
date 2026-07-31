import {useState,useEffect,useCallback,useMemo} from 'react';
import {BatchEditModal} from '../components/BatchEditModal';
import {ImportModal} from '../components/ImportModal';
import {ManualTransactionModal} from '../components/ManualTransactionModal';
import {MobileTxnList} from '../components/MobileTxnList';
import {MultiSelectFilter} from '../components/MultiSelectFilter';
import {ReviewModal} from '../components/ReviewModal';
import {SkeletonTable} from '../components/SkeletonTable';
import {SplitEditorModal} from '../components/SplitEditorModal';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {fmt,fmtDate,sortedCats,todayStr} from '../lib/format';

export function TransactionsPage({categories,toast,refreshKey}){
  const[txns,setTxns]=useState([]);
  const[loading,setLoading]=useState(true);
  const[search,setSearch]=useState('');
  const[needsReview,setNeedsReview]=useState(false);
  const[startDate,setStartDate]=useState('');
  const[endDate,setEndDate]=useState('');
  const[minAmount,setMinAmount]=useState('');
  const[maxAmount,setMaxAmount]=useState('');
  const[catFilter,setCatFilter]=useState(null);       // null=all, Set=specific
  const[actionFilter,setActionFilter]=useState(null);  // null=all, Set=specific
  /* Draft copies for the type/category/account dropdowns — only take effect (copied into
     the applied state above) when the user clicks Apply, so toggling checkboxes doesn't
     re-filter/re-fetch on every click. */
  const[draftCatFilter,setDraftCatFilter]=useState(null);
  const[draftActionFilter,setDraftActionFilter]=useState(null);
  const[reviewTxn,setReviewTxn]=useState(null);
  const[showManual,setShowManual]=useState(false);
  const[splitTxn,setSplitTxn]=useState(null);
  const[accounts,setAccounts]=useState([]);
  const[accountFilter,setAccountFilter]=useState(null); // null=all, Set=specific
  const[draftAccountFilter,setDraftAccountFilter]=useState(null);
  const[showImport,setShowImport]=useState(false);
  const[enrichJob,setEnrichJob]=useState(null); // {job_id,status,processed,total,llm_calls,override_hits,errors}
  const[showMoreMenu,setShowMoreMenu]=useState(false);
  const[selectedIds,setSelectedIds]=useState(new Set());
  const[showBatchEdit,setShowBatchEdit]=useState(false);
  const[showDupes,setShowDupes]=useState(false);
  const[showExcluded,setShowExcluded]=useState(false);
  const[quickYear,setQuickYear]=useState('');
  const[quickMonth,setQuickMonth]=useState('');
  const[sortCol,setSortCol]=useState(null); // null|'date'|'description'|'amount'|'type'|'category'|'account'
  const[sortDir,setSortDir]=useState('asc');
  const toggleSort=col=>{if(sortCol===col){setSortDir(d=>d==='asc'?'desc':'asc');}else{setSortCol(col);setSortDir('asc');}};

  const[tableLoading,setTableLoading]=useState(false);
  /* Non-null when the last load failed. Keeps "the fetch broke" distinguishable
     from "the filters matched nothing" — previously both rendered the same
     confident "No transactions found" (B28). */
  const[loadError,setLoadError]=useState(null);
  const _acctKey=useMemo(()=>accountFilter===null?'__all__':[...accountFilter].sort().join(','),[accountFilter]);
  const _catKey=useMemo(()=>catFilter===null?'__all__':[...catFilter].sort().join(','),[catFilter]);
  const _actionKey=useMemo(()=>actionFilter===null?'__all__':[...actionFilter].sort().join(','),[actionFilter]);
  const load=useCallback(async({silent=false}={})=>{
    if(!silent)setLoading(true);
    setTableLoading(true);
    try{
      let q='?limit=500';
      if(needsReview)q+='&needs_review=true';
      if(startDate)q+=`&start_date=${startDate}`;
      if(endDate)q+=`&end_date=${endDate}`;
      if(accountFilter&&accountFilter.size===1)q+=`&account_id=${[...accountFilter][0]}`;
      if(catFilter&&catFilter.size===1)q+=`&category=${encodeURIComponent([...catFilter][0])}`;
      /* allSettled, not all: these were coupled, so a failure on EITHER threw
         away BOTH results and left the table empty — and because the accounts
         call is only needed for filter labels, a slow/failed /accounts could
         blank the transaction list entirely. That is how a backend slowdown
         surfaced as a confident "No transactions found" (B28). Each result is
         now applied on its own merits. */
      const[tRes,aRes]=await Promise.allSettled([apiFetch(`/transactions${q}`),apiFetch('/accounts')]);
      if(tRes.status==='fulfilled'){setTxns(tRes.value);setLoadError(null);}
      else{setLoadError(tRes.reason?.message||'Could not load transactions');toast('Failed to load transactions','error');}
      if(aRes.status==='fulfilled')setAccounts(aRes.value);
      else console.warn('Accounts fetch failed (filters may be incomplete):',aRes.reason);
    }catch(e){setLoadError(e?.message||'Could not load transactions');toast('Failed to load','error');}
    finally{if(!silent)setLoading(false);setTableLoading(false);}
  },[needsReview,startDate,endDate,_acctKey,_catKey]);

  useEffect(()=>{load();},[load,refreshKey]);

  const handleSave=async(id,updates)=>{
    if(updates.__deleted){await load();return;}
    try{
      await apiFetch(`/transactions/${id}`,{method:'PATCH',body:JSON.stringify(updates)});
      await load({silent:true});
      toast('Saved');
    }
    catch(e){toast('Failed to save','error');}
  };
  const handleIgnore=async(id)=>{await handleSave(id,{needs_review:false});toast('Ignored');};

  /* ── Multi-select helpers ─────────────────────────────────────── */
  const toggleSelect=(id)=>setSelectedIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const selectAll=()=>setSelectedIds(new Set(visible.map(t=>t.id)));
  const handleBatchSave=async(updates)=>{
    const count=selectedIds.size;
    try{
      await apiFetch('/transactions/batch-update',{method:'POST',body:JSON.stringify({ids:[...selectedIds],updates})});
      await load();
      setSelectedIds(new Set());setShowBatchEdit(false);
      toast(`Updated ${count} transaction${count!==1?'s':''}`);
    }catch(e){toast('Batch update failed: '+e.message,'error');}
  };
  /* Clear selection whenever the visible set changes (filter applied) */
  useEffect(()=>{setSelectedIds(new Set());},[search,_catKey,_actionKey,needsReview,_acctKey,startDate,endDate,minAmount,maxAmount,showDupes,showExcluded]);

  /* Section 4A: Filter CC payment credits on the credit-card side (structural, not keyword-based).
     A CC payment shows up twice: once as a debit on the checking account (keep) and once as a
     positive credit on the credit card account (hide by default — it's the duplicate).
     Refunds/credits from merchants are typically Expense-type so they pass through unaffected.
     We catch both Transfer-action payments AND Income-action payments whose description
     contains payment keywords (catches CC payments mis-categorized as Income). */
  const CC_PAY_WORDS=['PAYMENT','AUTOPAY','PMT','PYMT','TRANSFER'];
  const isCCPaymentDuplicate=(t)=>{
    if(t.amount<=0)return false;
    const type=(t.account_type||'').toLowerCase();
    if(type!=='credit'&&type!=='credit card')return false;
    if(t.action==='Transfer')return true;
    if(t.action==='Income'){
      const d=(t.description_raw||'').toUpperCase();
      return CC_PAY_WORDS.some(w=>d.includes(w));
    }
    return false;
  };

  let visible=txns;
  if(!showDupes)visible=visible.filter(t=>!isCCPaymentDuplicate(t));
  if(!showExcluded)visible=visible.filter(t=>!t.is_excluded);
  if(search)visible=visible.filter(t=>(t.description_display||t.description_raw||'').toLowerCase().includes(search.toLowerCase())||t.description_raw?.toLowerCase().includes(search.toLowerCase()));
  if(catFilter!==null)visible=visible.filter(t=>catFilter.has(t.category_final));
  if(actionFilter!==null)visible=visible.filter(t=>actionFilter.has(t.action));
  if(accountFilter!==null)visible=visible.filter(t=>accountFilter.has(String(t.account_id)));
  const _minAmt=minAmount!==''?Math.abs(parseFloat(minAmount)):null;
  const _maxAmt=maxAmount!==''?Math.abs(parseFloat(maxAmount)):null;
  if(_minAmt!==null&&!isNaN(_minAmt))visible=visible.filter(t=>Math.abs(t.amount)>=_minAmt);
  if(_maxAmt!==null&&!isNaN(_maxAmt))visible=visible.filter(t=>Math.abs(t.amount)<=_maxAmt);
  if(sortCol){
    const key=t=>sortCol==='date'?t.date||'':sortCol==='description'?(t.description_display||t.description_raw||'').toLowerCase():sortCol==='amount'?t.amount||0:sortCol==='type'?(t.action||'').toLowerCase():sortCol==='category'?(t.category_final||'').toLowerCase():(t.account_name||'').toLowerCase();
    visible=[...visible].sort((a,b)=>{const ka=key(a),kb=key(b);const cmp=typeof ka==='number'?ka-kb:ka<kb?-1:ka>kb?1:0;return sortDir==='asc'?cmp:-cmp;});
  }

  const _expCatSet=new Set(categories.filter(c=>c.category_type==='expense'||c.category_type==='both').map(c=>c.name));
  const _budgetVisible=visible.filter(t=>!t.is_gcb&&!t.gcb_tagged&&(t.action==='Expense'||t.action==='Income'));
  const visibleExpenses=_budgetVisible.filter(t=>t.action==='Expense'||(t.action==='Income'&&_expCatSet.has(t.category_final))).reduce((s,t)=>s+(-t.amount),0);
  const visibleIncome=_budgetVisible.filter(t=>t.action==='Income'&&!_expCatSet.has(t.category_final)).reduce((s,t)=>s+t.amount,0);
  const visibleNet=visibleIncome-visibleExpenses;

  const exportCSV=()=>{
    const h=['Date','Description','Amount','Type','Category','Account'];
    const rows=visible.map(t=>[fmtDate(t.date),t.description_display||t.description_raw,t.amount,t.action,t.category_final,t.account_name]);
    const csv=[h,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='transactions.csv';a.click();
  };

  /* Batch LLM enrichment — starts a background job, polls until done */
  const startEnrich=async()=>{
    try{
      const r=await apiFetch('/llm/enrich-transactions',{method:'POST',body:JSON.stringify({limit:300,overwrite_existing:false})});
      setEnrichJob({job_id:r.job_id,status:'running',processed:0,total:0,llm_calls:0,override_hits:0,errors:0,startedAt:Date.now()});
    }catch(e){toast('Failed to start enrichment: '+e.message,'error');}
  };

  /* Poll job status every 2s while running — preserve client-only startedAt across updates */
  useEffect(()=>{
    if(!enrichJob||enrichJob.status!=='running')return;
    const id=setInterval(async()=>{
      try{
        const s=await apiFetch(`/llm/enrich-status/${enrichJob.job_id}`);
        setEnrichJob(prev=>({...s,startedAt:prev?.startedAt}));
        if(s.status==='done'||s.status==='error'){
          clearInterval(id);
          if(s.status==='done'){load();toast(`Enriched ${s.processed} transactions`);}
          else toast('Enrichment failed: '+(s.error||'unknown error'),'error');
        }
      }catch(e){clearInterval(id);}
    },2000);
    return()=>clearInterval(id);
  },[enrichJob?.job_id,enrichJob?.status]);

  return(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {reviewTxn&&<ReviewModal txn={reviewTxn} categories={categories} onSave={handleSave} onDiscard={()=>setReviewTxn(null)} onIgnore={handleIgnore} onClose={()=>setReviewTxn(null)}/>}
      {showManual&&<ManualTransactionModal accounts={accounts} categories={categories} onClose={()=>setShowManual(false)} onSaved={load} toast={toast}/>}
      {splitTxn&&<SplitEditorModal txn={splitTxn} categories={categories} onClose={()=>setSplitTxn(null)} onSaved={load} toast={toast}/>}
      {showImport&&<ImportModal accounts={accounts} onClose={()=>setShowImport(false)} onImported={load} toast={toast}/>}
      {showBatchEdit&&<BatchEditModal count={selectedIds.size} categories={categories} onSave={handleBatchSave} onClose={()=>setShowBatchEdit(false)}/>}
      
      <div className="card" style={{padding:0, overflow:'hidden'}}>
        {/* ── Row 1: search + primary filters ── */}
        <div className="filters" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <input className="search-input" placeholder="Search transactions…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <MultiSelectFilter label="All types" options={TXN_TYPES.map(a=>({value:a,label:a}))}
              selected={draftActionFilter} onChange={setDraftActionFilter} onApply={()=>setActionFilter(draftActionFilter)}/>
            <MultiSelectFilter label="All categories" options={sortedCats(categories).map(c=>({value:c.name,label:c.name}))}
              selected={draftCatFilter} onChange={setDraftCatFilter} onApply={()=>setCatFilter(draftCatFilter)}/>
            <MultiSelectFilter label="All accounts" options={accounts.map(a=>({value:String(a.id),label:a.account_name}))}
              selected={draftAccountFilter} onChange={setDraftAccountFilter} onApply={()=>setAccountFilter(draftAccountFilter)}/>
            <button type="button" className="btn btn-primary" onClick={()=>setShowManual(true)}>+ Manual</button>
            <button type="button" className="btn btn-secondary" onClick={()=>setShowImport(true)}>↑ Import</button>
          </div>
        </div>

        {/* ── Row 2: Secondary filters & Dates ── */}
        <div className="filters" style={{ padding: '12px 24px', background: 'rgba(var(--blue-vibrant-rgb), 0.03)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="filter-select" value={quickYear} onChange={e=>{
              const y=e.target.value; setQuickYear(y); setQuickMonth('');
              if(!y){setStartDate('');setEndDate('');}
              else{const isCurY=y===String(new Date().getFullYear());setStartDate(`${y}-01-01`);setEndDate(isCurY?todayStr():`${y}-12-31`);}
            }}>
              <option value="">All years</option>
              {Array.from({length:3},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            {quickYear&&<select className="filter-select" value={quickMonth} onChange={e=>{
              const m=e.target.value;setQuickMonth(m);
              if(!m){const isCurY=quickYear===String(new Date().getFullYear());setStartDate(`${quickYear}-01-01`);setEndDate(isCurY?todayStr():`${quickYear}-12-31`);}
              else{const mP=String(m).padStart(2,'0');const ld=new Date(parseInt(quickYear),parseInt(m),0).getDate();setStartDate(`${quickYear}-${mP}-01`);setEndDate(`${quickYear}-${mP}-${String(ld).padStart(2,'0')}`);}
            }}>
              <option value="">All months</option>
              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((lbl,i)=><option key={i+1} value={i+1}>{lbl}</option>)}
            </select>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="date" className="date-input" value={startDate} onChange={e=>setStartDate(e.target.value)}/>
              <span style={{color:'var(--text-muted)',fontSize:13}}>→</span>
              <input type="date" className="date-input" value={endDate} onChange={e=>setEndDate(e.target.value)}/>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title="Filters by dollar magnitude, regardless of expense/income direction">
              <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="Min $" className="date-input" style={{width:90}}
                value={minAmount} onChange={e=>setMinAmount(e.target.value)}/>
              <span style={{color:'var(--text-muted)',fontSize:13}}>→</span>
              <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="Max $" className="date-input" style={{width:90}}
                value={maxAmount} onChange={e=>setMaxAmount(e.target.value)}/>
            </div>
            <label className="filter-label"><input type="checkbox" checked={needsReview} onChange={e=>setNeedsReview(e.target.checked)}/> Needs review</label>
          </div>
          
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {(startDate||endDate||minAmount||maxAmount||search||catFilter!==null||actionFilter!==null||needsReview||accountFilter!==null||quickYear||draftCatFilter!==null||draftActionFilter!==null||draftAccountFilter!==null)&&
              <button type="button" className="btn btn-sm btn-ghost" onClick={()=>{setSearch('');setCatFilter(null);setActionFilter(null);setDraftCatFilter(null);setDraftActionFilter(null);setStartDate('');setEndDate('');setMinAmount('');setMaxAmount('');setNeedsReview(false);setAccountFilter(null);setDraftAccountFilter(null);setQuickYear('');setQuickMonth('');}}>Clear Filters</button>}
            <button type="button" className="btn btn-sm btn-secondary" onClick={()=>setShowMoreMenu(p=>!p)}>⋯</button>
            {showMoreMenu&&<div style={{position:'absolute',right:24,top:'100%',marginTop:4,background:'var(--surface)',backdropFilter:'var(--glass-blur)',border:'1px solid var(--border)',borderRadius:16,padding:8,zIndex:20,boxShadow:'var(--card-shadow)',minWidth:180}}
              onMouseLeave={()=>setShowMoreMenu(false)}>
              <button type="button" className="nav-item" onClick={()=>{exportCSV();setShowMoreMenu(false);}}>↓ Export CSV</button>
              <button type="button" className="nav-item" disabled={enrichJob?.status==='running'} onClick={()=>{startEnrich();setShowMoreMenu(false);}}>✨ {enrichJob?.status==='running'?'Enriching…':'AI Enrich'}</button>
            </div>}
          </div>
        </div>

        {/* ── Info Bar ── */}
        <div style={{padding:'10px 24px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:24,fontSize:12,color:'var(--text-muted)',fontWeight:600}}>
          <span><b style={{color:'var(--text-primary)'}}>{visible.length}</b> TRANSACTIONS</span>
          {visibleExpenses!==0&&<span>EXPENSES: <b style={{color:visibleExpenses>0?'var(--red)':'var(--green)'}}>{fmt(visibleExpenses)}</b></span>}
          {visibleIncome>0&&<span>INCOME: <b style={{color:'var(--green)'}}>{fmt(visibleIncome)}</b></span>}
        </div>
        {enrichJob&&(()=>{
          const elapsed=enrichJob.startedAt?Math.round((Date.now()-enrichJob.startedAt)/1000):0;
          const timedOut=enrichJob.status==='running'&&elapsed>90;
          const bgColor=timedOut?'rgba(251,191,36,0.08)':enrichJob.status==='done'?'rgba(52,211,153,0.08)':enrichJob.status==='error'?'rgba(248,113,113,0.08)':'rgba(var(--blue-primary-rgb), 0.12)';
          return(
          <div style={{padding:'8px 16px',background:bgColor,borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10,fontSize:13,fontWeight:300}}>
            {enrichJob.status==='running'&&<div className="spinner" style={{width:14,height:14,flexShrink:0}}/>}
            {enrichJob.status==='done'&&<span style={{color:'var(--green)',fontWeight:400}}>✓</span>}
            {enrichJob.status==='error'&&<span style={{color:'var(--red)',fontWeight:400}}>✗</span>}
            <span>
              {enrichJob.status==='running'&&`Enriching… ${enrichJob.processed}/${enrichJob.total||'?'} transactions`}
              {enrichJob.status==='done'&&`Enrichment complete — ${enrichJob.processed} enriched · ${enrichJob.llm_calls} AI calls · ${enrichJob.override_hits} from saved rules`}
              {enrichJob.status==='error'&&`Enrichment failed: ${enrichJob.error||'unknown error'}`}
            </span>
            {enrichJob.status==='running'&&enrichJob.last&&<span style={{color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:200,fontWeight:300}}>last: {enrichJob.last.merchant||enrichJob.last.raw}</span>}
            {timedOut&&<span style={{color:'var(--amber)',fontSize:12,fontWeight:400,flexShrink:0}}>Taking longer than usual ({elapsed}s)</span>}
            <button type="button" className="btn btn-sm btn-ghost" style={{marginLeft:'auto',fontSize:11,flexShrink:0}} onClick={()=>setEnrichJob(null)}>
              {enrichJob.status==='running'?'Hide':'Dismiss'}
            </button>
          </div>
          );
        })()}
        {selectedIds.size>0&&(
          <div style={{padding:'8px 16px',background:'rgba(var(--blue-primary-rgb), 0.12)',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10,fontSize:13}}>
            <span style={{fontWeight:400,color:'var(--blue-primary)'}}>{selectedIds.size} selected</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>setShowBatchEdit(true)}>✎ Edit Selected</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setSelectedIds(new Set())}>✕ Deselect All</button>
          </div>
        )}
        <div style={{position:'relative'}}>
        {tableLoading&&<div style={{position:'absolute',inset:0,background:'rgba(var(--bg-rgb,12,12,16),0.6)',zIndex:10,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(2px)',borderRadius:14}}>
          <div className="spinner"/>
        </div>}
        {loading&&txns.length===0?<SkeletonTable rows={10}/>
          :loadError&&txns.length===0?<div className="empty">
              <div className="empty-icon" style={{color:'var(--red)'}}>!</div>
              <span>Couldn't load transactions</span>
              <div style={{fontSize:12,color:'var(--text-muted)',marginTop:6,maxWidth:420,textAlign:'center'}}>{loadError}</div>
              <button type="button" className="btn btn-secondary" style={{marginTop:12}} onClick={()=>load()}>Retry</button>
            </div>
          :visible.length===0&&!tableLoading?<div className="empty"><div className="empty-icon">◎</div><span>No transactions found</span></div>
          :<MobileTxnList visible={visible} categories={categories} onSave={handleSave} onReview={setReviewTxn} onSplit={setSplitTxn} selectedIds={selectedIds} toggleSelect={toggleSelect} selectAll={selectAll} setSelectedIds={setSelectedIds} sortCol={sortCol} sortDir={sortDir} toggleSort={toggleSort} setShowBatchEdit={setShowBatchEdit} toast={toast}/>
        }
        </div>
      </div>
    </div>
  );
}
