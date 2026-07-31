import {useState,useEffect,useCallback,useMemo} from 'react';
import {useIsMobile} from '../hooks/index';
import {apiFetch,parseHash,syncHashParams} from '../lib/api';
import {fmt,fmtRound} from '../lib/format';

export function BudgetsPage({categories,toast,refreshKey}){
  const MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const curYear=new Date().getFullYear();
  const curMonth=new Date().getMonth()+1;
  const isMob=useIsMobile();

  /* ── State ─────────────────────────────────────────────────────────────── */
  const[view,_setView]=useState(()=>parseHash().params.get('view')||'month');
  const[year,_setYear]=useState(()=>parseInt(parseHash().params.get('year'))||curYear);
  const[month,_setMonth]=useState(()=>parseInt(parseHash().params.get('month'))||curMonth);
  const setView=useCallback(v=>{_setView(v);syncHashParams({view:v,year,month});},[year,month]);
  const setYear=useCallback(y=>{_setYear(y);syncHashParams({view,year:y,month});},[view,month]);
  const setMonth=useCallback(m=>{_setMonth(m);syncHashParams({view,year,month:m});},[view,year]);
  
  const[targets,setTargets]=useState({});
  const[actuals,setActuals]=useState({});
  const[editing,setEditing]=useState(false);
  const[edits,setEdits]=useState({});
  const[suggestions,setSuggestions]=useState({});
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[yearEdits,setYearEdits]=useState({});
  const[inlineEdit,setInlineEdit]=useState(null);
  const[inlineEditVal,setInlineEditVal]=useState('');
  const[pasteModal,setPasteModal]=useState(false);
  const[pasteText,setPasteText]=useState('');
  const[parsedRows,setParsedRows]=useState(null);
  const[parseErrors,setParseErrors]=useState([]);
  const[pasteSaving,setPasteSaving]=useState(false);

  /* ── Category sets ─────────────────────────────────────────────────────── */
  const incomeCats=useMemo(()=>categories.filter(c=>c.category_type==='income').map(c=>c.name),[categories]);
  const expenseCats=useMemo(()=>categories.filter(c=>c.category_type==='expense').map(c=>c.name),[categories]);

  /* ── Load data ─────────────────────────────────────────────────────────── */
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const[t,a]=await Promise.all([
        apiFetch(`/budget/targets?year=${year}`),
        apiFetch(`/budget/actuals?year=${year}`),
      ]);
      setTargets(t.categories||{});
      setActuals(a.categories||{});
    }catch(e){toast('Failed to load budget','error');}
    finally{setLoading(false);}
  },[year, toast]);
  useEffect(()=>{load();},[load,refreshKey]);

  const loadSuggestions=async(yr,mo)=>{
    try{
      const s=await apiFetch(`/budget/suggestions?year=${yr}&month=${mo}`);
      setSuggestions(s.suggestions||{});
    }catch(e){setSuggestions({});}
  };

  /* ── Helpers ───────────────────────────────────────────────────────────── */
  const getBudget=(cat,m)=>targets[cat]?.[String(m)]?.amount||0;
  const getActual=(cat,m)=>actuals[cat]?.[String(m)]||0;

  const alphaCats=useMemo(()=>(list)=>[...new Set(list)].sort((a,b)=>{
    const BOTTOM=['Unclassified','Other','For Others'];
    const aB=BOTTOM.includes(a),bB=BOTTOM.includes(b);
    if(aB&&!bB)return 1;if(!aB&&bB)return -1;
    return a.localeCompare(b);
  }),[]);

  const allIncomeCats=useMemo(()=>alphaCats([
    ...incomeCats,
    ...Object.keys(targets).filter(c=>incomeCats.includes(c)),
    ...Object.keys(actuals).filter(c=>incomeCats.includes(c)),
  ]),[incomeCats,targets,actuals,alphaCats]);

  const allExpenseCats=useMemo(()=>alphaCats([
    ...expenseCats,
    ...Object.keys(targets).filter(c=>!incomeCats.includes(c)&&!['Transfer','Work','Unclassified'].includes(c)),
    ...Object.keys(actuals).filter(c=>!incomeCats.includes(c)&&!['Transfer','Work','Unclassified'].includes(c)),
  ]),[expenseCats,targets,actuals,alphaCats]);

  const startEdit=async()=>{
    const e={};
    [...allIncomeCats,...allExpenseCats].forEach(cat=>{
      e[cat]={[String(month)]:targets[cat]?.[String(month)]?.amount?.toString()||''};
    });
    setEdits(e);setEditing(true);await loadSuggestions(year,month);
  };

  const saveEdits=async()=>{
    setSaving(true);
    try{
      const bulk=[];
      Object.entries(edits).forEach(([cat,months])=>{
        Object.entries(months).forEach(([m,val])=>{
          const amt=parseFloat(val);if(!isNaN(amt)&&amt>=0)bulk.push({year,month:parseInt(m),category:cat,amount:amt});
        });
      });
      if(bulk.length)await apiFetch('/budget/targets/bulk',{method:'POST',body:JSON.stringify({targets:bulk})});
      toast('Targets saved');setEditing(false);setSuggestions({});await load();
    }catch(e){toast('Failed to save','error');}finally{setSaving(false);}
  };

  const copyFromPrior=async()=>{
    setSaving(true);
    try{
      const prior=await apiFetch(`/budget/targets?year=${year-1}`);
      const priorCats=prior.categories||{};const bulk=[];
      Object.entries(priorCats).forEach(([cat,months])=>{
        Object.entries(months).forEach(([m,v])=>{if(v.amount>0)bulk.push({year,month:parseInt(m),category:cat,amount:v.amount});});
      });
      if(bulk.length){await apiFetch('/budget/targets/bulk',{method:'POST',body:JSON.stringify({targets:bulk})});toast(`Copied from ${year-1}`);await load();}
      else toast('No targets found in '+ (year-1),'error');
    }catch(e){toast('Copy failed','error');}finally{setSaving(false);}
  };

  const startYearEdit=()=>{
    const e={};[...allIncomeCats,...allExpenseCats].forEach(cat=>{
      e[cat]={};for(let m=1;m<=12;m++){const v=targets[cat]?.[String(m)]?.amount;e[cat][String(m)]=v!=null&&v>0?String(v):'';}
    });
    setYearEdits(e);setView('edit-year');
  };

  const saveYearEdits=async()=>{
    setSaving(true);
    try{
      const bulk=[];
      Object.entries(yearEdits).forEach(([cat,months])=>{
        Object.entries(months).forEach(([m,val])=>{const amt=parseFloat(val);if(!isNaN(amt)&&amt>=0)bulk.push({year,month:parseInt(m),category:cat,amount:amt});});
      });
      if(bulk.length)await apiFetch('/budget/targets/bulk',{method:'POST',body:JSON.stringify({targets:bulk})});
      toast('Annual targets saved');setView('annual');setYearEdits({});await load();
    }catch(e){toast('Failed to save','error');}finally{setSaving(false);}
  };

  const startInlineEdit=(cat,m)=>{
    const cur=targets[cat]?.[String(m)]?.amount;
    setInlineEdit({cat,m});setInlineEditVal(cur!=null&&cur>0?String(cur):'');
  };
  const commitInlineEdit=async(catArg,mArg,valArg)=>{
    const cat=catArg||inlineEdit?.cat;const m=mArg||inlineEdit?.m;const val=valArg!==undefined?valArg:inlineEditVal;
    setInlineEdit(null);setInlineEditVal('');if(!cat||m==null)return;
    const amt=parseFloat(val);if(isNaN(amt)||amt<0)return;
    try{
      await apiFetch('/budget/targets/bulk',{method:'POST',body:JSON.stringify({targets:[{year,month:m,category:cat,amount:amt}]})});
      setTargets(prev=>({...prev,[cat]:{...prev[cat],[String(m)]:{...(prev[cat]?.[String(m)]||{}),amount:amt}}}));
    }catch(e){toast('Failed to save','error');}
  };
  const cancelInlineEdit=()=>{setInlineEdit(null);setInlineEditVal('');};

  const parsePasteText=(text)=>{
    const allCats=[...allIncomeCats,...allExpenseCats];const lines=text.trim().split('\n').filter(l=>l.trim());
    if(!lines.length){setParsedRows(null);setParseErrors([]);return;}
    const rows=[];const errs=[];const MO_NAMES=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    let startIdx=0;if(lines[0].split('\t')[0].toLowerCase()==='category'||MO_NAMES.includes(lines[0].split('\t')[1]?.toLowerCase()))startIdx=1;
    for(let li=startIdx;li<lines.length;li++){
      const cells=lines[li].split('\t').map(c=>c.trim());if(!cells[0])continue;
      const matched=allCats.find(c=>c.toLowerCase()===cells[0].toLowerCase())||allCats.find(c=>c.toLowerCase().replace(/[^a-z]/g,'')===cells[0].toLowerCase().replace(/[^a-z]/g,''));
      if(!matched){errs.push(`Unknown: "${cells[0]}"`);continue;}
      const values=[];for(let vi=0;vi<12;vi++){const raw=(cells[vi+1]||'').replace(/[$,\s]/g,'');if(!raw||raw==='-'||raw==='—'){values.push(null);continue;}const n=parseFloat(raw);values.push(isNaN(n)?null:Math.abs(n));}
      rows.push({cat:matched,values});
    }
    setParsedRows(rows);setParseErrors(errs);
  };
  const confirmPaste=async()=>{
    if(!parsedRows||parsedRows.length===0)return;setPasteSaving(true);
    try{
      const bulk=[];parsedRows.forEach(({cat,values})=>{values.forEach((v,i)=>{if(v!=null)bulk.push({year,month:i+1,category:cat,amount:v});});});
      await apiFetch('/budget/targets/bulk',{method:'POST',body:JSON.stringify({targets:bulk})});
      toast(`Imported ${bulk.length} targets`);setPasteModal(false);setPasteText('');setParsedRows(null);setParseErrors([]);await load();
    }catch(e){toast('Import failed','error');}finally{setPasteSaving(false);}
  };
  const closePasteModal=()=>{setPasteModal(false);setPasteText('');setParsedRows(null);setParseErrors([]);};

  /* ── KPI values for selected month ───────────────────────────────────────── */
  const monthIncomeBudget=allIncomeCats.reduce((s,c)=>s+getBudget(c,month),0);
  const monthIncomeActual=allIncomeCats.reduce((s,c)=>s+getActual(c,month),0);
  const monthExpenseBudget=allExpenseCats.reduce((s,c)=>s+getBudget(c,month),0);
  const monthExpenseActual=allExpenseCats.reduce((s,c)=>s+getActual(c,month),0);
  const monthNetBudget=monthIncomeBudget-monthExpenseBudget;
  const monthNetActual=monthIncomeActual-monthExpenseActual;

  /* ── Annual KPI ────────────────────────────────────────────────────────── */
  const annualIncomeBudget=(()=>{let s=0;for(let m=1;m<=12;m++)s+=allIncomeCats.reduce((a,c)=>a+getBudget(c,m),0);return s;})();
  const annualIncomeActual=(()=>{let s=0;for(let m=1;m<=12;m++)s+=allIncomeCats.reduce((a,c)=>a+getActual(c,m),0);return s;})();
  const annualExpenseBudget=(()=>{let s=0;for(let m=1;m<=12;m++)s+=allExpenseCats.reduce((a,c)=>a+getBudget(c,m),0);return s;})();
  const annualExpenseActual=(()=>{let s=0;for(let m=1;m<=12;m++)s+=allExpenseCats.reduce((a,c)=>a+getActual(c,m),0);return s;})();

  /* ── Month View: P&L row renderer ─────────────────────────────────────── */
  const renderPLRow=(cat,isIncome,isEditing)=>{
    const budget=getBudget(cat,month);
    const actual=getActual(cat,month);
    const variance=isIncome?(actual-budget):(budget-actual); // positive = good
    const pct=budget>0?Math.min(actual/budget,1):0;
    const over=budget>0&&actual>budget;
    const barColor=isIncome?'var(--green)':(over?'var(--red)':'var(--blue-vibrant)');
    const varColor=variance>0?'var(--green)':(variance<0?'var(--red)':'var(--text-muted)');
    const editVal=edits[cat]?.[String(month)]||'';
    const suggestion=suggestions[cat];
    const actualColor=over?'var(--red)':isIncome?'var(--green)':'var(--text-primary)';

    if(!isEditing&&budget===0&&actual===0) return null;

    if(isMob&&!isEditing) return(
      <tr key={cat}>
        <td style={{fontWeight:600,fontSize:14,padding:'12px 16px',color:'var(--text-primary)', fontFamily:'Outfit, sans-serif'}}>{cat}</td>
        <td style={{textAlign:'right',fontSize:13,padding:'12px 8px',color:'var(--text-secondary)'}}>{budget>0?fmtRound(budget):'—'}</td>
        <td style={{textAlign:'right',fontSize:13,padding:'12px 8px', color:actualColor, fontWeight:600}}>
          {actual!==0?fmtRound(actual):'—'}
        </td>
        <td style={{textAlign:'right',fontSize:12,padding:'12px 16px',color:varColor, fontWeight:600}}>
          {budget>0?((variance>0?'+':'')+fmtRound(variance)):'—'}
        </td>
      </tr>
    );

    return(
      <tr key={cat}>
        <td style={{fontWeight:600,fontSize:14,padding:'12px 16px', color:'var(--text-primary)', fontFamily:'Outfit, sans-serif'}}>{cat}</td>
        <td style={{textAlign:'right',padding:'12px 8px'}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end', gap:12}}>
            {actual!==0&&<span style={{color:actualColor, fontWeight:600, fontSize:14}}>{fmtRound(actual)}</span>}
            {budget>0&&!isMob&&(
              <div style={{width:80, height:6, background:'var(--border)', borderRadius:3, overflow:'hidden'}}>
                <div style={{height:'100%',width:`${pct*100}%`,background:barColor,borderRadius:3,transition:'width 0.3s'}}/>
              </div>
            )}
          </div>
        </td>
        <td style={{textAlign:'right',padding:'12px 8px',minWidth:100}}>
          {isEditing?(
            <div style={{position:'relative'}}>
              <input type="number" step="1" min="0" value={editVal}
                onChange={e=>setEdits(prev=>({...prev,[cat]:{...prev[cat],[String(month)]:e.target.value}}))}
                className="search-input" style={{padding:'6px 8px', fontSize:13, textAlign:'right'}}
                placeholder={suggestion?Math.round(suggestion).toString():'0'}/>
              {suggestion&&!editVal&&<span style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',fontSize:10,color:'var(--text-muted)',pointerEvents:'none'}}>{Math.round(suggestion)}</span>}
            </div>
          ):(
            <span style={{color:budget>0?'var(--text-secondary)':'var(--text-muted)', fontSize:14}}>{budget>0?fmt(budget):'—'}</span>
          )}
        </td>
        {!isEditing&&<td className="hide-mobile" style={{textAlign:'right',fontSize:13,padding:'12px 16px',color:varColor, fontWeight:600}}>
          {variance!==0?(variance>0?'+':'')+fmtRound(variance):'—'}
        </td>}
        {isEditing&&<td/>}
      </tr>
    );
  };

  /* ── Month View: section separator ─────────────────────────────────────── */
  const renderSectionHeader=(label)=>(
    <tr style={{background:'var(--elevated)',borderTop:'2px solid var(--border)'}}>
      <td colSpan={4} style={{fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',paddingLeft:12,paddingTop:8,paddingBottom:4}}>{label}</td>
    </tr>
  );

  const renderSectionTotal=(label,totalBudget,totalActual)=>{
    const diff=totalBudget-totalActual;
    if(isMob) return(
      <tr style={{borderTop:'1px solid var(--border)',background:'var(--elevated)',fontWeight:400}}>
        <td style={{paddingLeft:10,fontSize:12.5,fontWeight:500,color:'var(--text-primary)'}}>{label}</td>
        <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:300,padding:'6px 5px',color:'var(--text-secondary)'}}>{totalBudget>0?fmtRound(totalBudget):'—'}</td>
        <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:400,padding:'6px 5px',color:'var(--text-primary)'}}>{fmtRound(totalActual)}</td>
        <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:11,fontWeight:400,padding:'6px 8px',color:diff>0?'var(--green)':diff<0?'var(--red)':'var(--text-muted)'}}>{diff!==0?(diff>0?'+':'')+fmtRound(diff):'—'}</td>
      </tr>
    );
    return(
      <tr style={{borderTop:'1px solid var(--border)',background:'var(--elevated)',fontWeight:400}}>
        <td style={{paddingLeft:12,fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>{label}</td>
        <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:400,padding:'6px 4px',color:'var(--text-primary)'}}>{fmtRound(totalActual)}</td>
        <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:300,padding:'6px 8px',color:'var(--text-secondary)'}}>{totalBudget>0?fmt(totalBudget):'—'}</td>
        <td className="hide-mobile" style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:11,fontWeight:400,padding:'6px 8px',color:diff>0?'var(--green)':diff<0?'var(--red)':'var(--text-muted)'}}>{diff!==0?(diff>0?'+':'')+fmtRound(diff):'—'}</td>
      </tr>
    );
  };

  /* ── NET row ───────────────────────────────────────────────────────────── */
  const renderNetRow=(budgetNet,actualNet)=>{
    if(isMob) return(
      <tr style={{borderTop:'3px solid var(--blue-primary)',background:'rgba(var(--blue-primary-rgb), 0.12)'}}>
        <td style={{fontWeight:500,fontSize:13,paddingLeft:10,paddingTop:8,paddingBottom:8,color:'var(--text-primary)'}}>NET</td>
        <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:400,color:'var(--text-secondary)',padding:'6px 5px'}}>{budgetNet>=0?'+':''}{fmtRound(budgetNet)}</td>
        <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:400,color:actualNet>=0?'var(--green)':'var(--red)',padding:'6px 5px'}}>{actualNet>=0?'+':''}{fmtRound(actualNet)}</td>
        <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:400,padding:'6px 8px',color:(budgetNet-actualNet)>=0?'var(--green)':'var(--red)'}}>{((budgetNet-actualNet)>0?'+':'')+fmtRound(budgetNet-actualNet)}</td>
      </tr>
    );
    return(
    <tr style={{borderTop:'3px solid var(--blue-primary)',background:'rgba(var(--blue-primary-rgb), 0.12)'}}>
      <td style={{fontWeight:500,fontSize:14,paddingLeft:12,paddingTop:8,paddingBottom:8,color:'var(--text-primary)'}}>NET</td>
      <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:400,color:actualNet>=0?'var(--green)':'var(--red)',padding:'6px 4px'}}>{actualNet>=0?'+':''}{fmtRound(actualNet)}</td>
      <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:400,color:'var(--text-secondary)',padding:'6px 8px'}}>{budgetNet>=0?'+':''}{fmt(budgetNet)}</td>
      <td className="hide-mobile"/>
    </tr>
  );
  };

  /* ═══════════════════════════════════════════════════════════════════════
     VIEW A — MONTH VIEW
  ═══════════════════════════════════════════════════════════════════════ */
  const renderMonthView=()=>{
    const prevMonth=()=>{if(month>1)setMonth(month-1);else{setYear(year-1);setMonth(12);}};
    const nextMonth=()=>{if(month<12)setMonth(month+1);else{setYear(year+1);setMonth(1);}};
    return(
    <div style={{padding:0}}>
      {/* Month selector + action buttons */}
      <div style={{display:'flex',alignItems:'center',gap:12,padding:'16px 20px',flexWrap:'wrap',justifyContent:'space-between', background:'var(--surface-hover)', borderBottom:'1px solid var(--border)'}}>
        <div className="hide-mobile" style={{display:'flex',gap:2}}>
          {MO.map((label,i)=>(
            <button type="button" key={i}
              onClick={(e)=>{e.preventDefault();setMonth(i+1);if(editing){loadSuggestions(year,i+1);const e={};[...allIncomeCats,...allExpenseCats].forEach(cat=>{e[cat]={[String(i+1)]:targets[cat]?.[String(i+1)]?.amount?.toString()||''};});setEdits(e);}}}
              style={{padding:'6px 10px',border:'none',borderBottom:month===i+1?'2px solid var(--blue-vibrant)':'2px solid transparent',cursor:'pointer',fontSize:13,fontWeight:month===i+1?700:500,fontFamily:'Outfit, sans-serif',
                background:'transparent',color:month===i+1?'var(--blue-vibrant)':'var(--text-muted)',
                transition:'all 0.2s', minWidth:44}}>{label}</button>
          ))}
        </div>
        <div style={{display:'flex',gap:10}}>
          {!editing&&<button type="button" className="btn btn-sm btn-secondary" onClick={(e)=>{e.preventDefault();copyFromPrior()}} disabled={saving}>Copy from {year-1}</button>}
          {!editing&&<button type="button" className="btn btn-sm" onClick={(e)=>{e.preventDefault();startEdit()}}>Edit {MO[month-1]}</button>}
          {editing&&<button type="button" className="btn btn-sm btn-ghost" onClick={(e)=>{e.preventDefault();setEditing(false);setSuggestions({});}}>Cancel</button>}
          {editing&&<button type="button" className="btn btn-sm" style={{background:'var(--green)'}} onClick={(e)=>{e.preventDefault();saveEdits()}} disabled={saving}>{saving?'Saving…':'Save'}</button>}
        </div>
      </div>

      {editing&&<div style={{fontSize:12,color:'var(--text-muted)',padding:'12px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:8}}>
        <span style={{width:8,height:8,borderRadius:'50%',background:'var(--blue-vibrant)',display:'inline-block'}}/>
        Hint values are 3-month trailing averages. Leave blank or enter 0 to clear.
      </div>}

      <div className="table-wrap" style={{margin:0, padding:0}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr style={{background:'var(--surface)', borderBottom:'1px solid var(--border-strong)'}}>
              <th style={{textAlign:'left',padding:'12px 16px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)', fontFamily:'Outfit, sans-serif'}}>Category</th>
              {isMob
                ?<><th style={{textAlign:'right',padding:'12px 8px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',minWidth:70}}>Budget</th>
                    <th style={{textAlign:'right',padding:'12px 8px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',minWidth:70}}>Actual</th>
                    <th style={{textAlign:'right',padding:'12px 16px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',minWidth:70}}>Var</th></>
                :<><th style={{textAlign:'right',padding:'12px 8px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)'}}>Actual</th>
                    <th style={{textAlign:'right',padding:'12px 8px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',minWidth:100}}>{MO[month-1]} Budget</th>
                    <th className="hide-mobile" style={{textAlign:'right',padding:'12px 16px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',minWidth:100}}>Variance</th></>
              }
            </tr>
          </thead>
          <tbody>
            {renderSectionHeader('Income')}
            {allIncomeCats.map(cat=>renderPLRow(cat,true,editing))}
            {renderSectionTotal('Total Income',monthIncomeBudget,monthIncomeActual)}

            {renderSectionHeader('Expenses')}
            {allExpenseCats.map(cat=>renderPLRow(cat,false,editing))}
            {renderSectionTotal('Total Expenses',monthExpenseBudget,monthExpenseActual)}

            {renderNetRow(monthNetBudget,monthNetActual)}
          </tbody>
        </table>
      </div>
    </div>
  );};

  /* ═══════════════════════════════════════════════════════════════════════
     VIEW B — ANNUAL VIEW  (read-only 12-column merged table)
  ═══════════════════════════════════════════════════════════════════════ */
  const renderAnnualCell=(cat,m)=>{
    const b=getBudget(cat,m);
    const isCur=m===curMonth&&year===curYear;
    const isIE=inlineEdit&&inlineEdit.cat===cat&&inlineEdit.m===m;
    return(
      <td key={m} style={{textAlign:'right',padding:'12px 16px',minWidth:90,background:isCur?'rgba(var(--blue-vibrant-rgb), 0.05)':'transparent',cursor:isIE?'default':'pointer',userSelect:'none', borderBottom:'1px solid var(--border)'}}
        onClick={isIE?undefined:()=>startInlineEdit(cat,m)}>
        {isIE?(
          <input type="number" step="1" min="0" autoFocus value={inlineEditVal}
            onChange={e=>setInlineEditVal(e.target.value)}
            onBlur={()=>commitInlineEdit(cat,m,inlineEditVal)}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitInlineEdit(cat,m,inlineEditVal);}if(e.key==='Escape'){e.preventDefault();cancelInlineEdit();}}}
            onClick={e=>e.stopPropagation()}
            className="search-input"
            style={{padding:'4px 8px', fontSize:12, textAlign:'right', border:'1px solid var(--blue-vibrant)'}}/>
        ):b>0?(
          <span style={{fontSize:13, fontWeight:600, color:'var(--text-primary)'}}>{fmtRound(b)}</span>
        ):(
          <span style={{color:'var(--text-muted)',fontSize:10,opacity:0.4}}>+</span>
        )}
      </td>
    );
  };

  const renderAnnualSection=(sectionLabel,catList)=>{
    return(<>
      <tr style={{background:'var(--surface-hover)'}}>
        <td colSpan={14} style={{fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',padding:'12px 16px', borderBottom:'1px solid var(--border-strong)', fontFamily:'Outfit, sans-serif'}}>{sectionLabel}</td>
      </tr>
      {catList.map(cat=>{
        const annualBudget=(()=>{let s=0;for(let m=1;m<=12;m++)s+=getBudget(cat,m);return s;})();
        if(annualBudget===0) return null;
        return(
          <tr key={cat}>
            <td style={{fontWeight:600,fontSize:14,padding:'12px 16px',minWidth:160,position:'sticky',left:0,background:'var(--surface)',zIndex:1,color:'var(--text-primary)', borderBottom:'1px solid var(--border)', fontFamily:'Outfit, sans-serif'}}>{cat}</td>
            {MO.map((mo,i)=>renderAnnualCell(cat,i+1))}
            <td style={{textAlign:'right',fontSize:13,fontWeight:700,padding:'12px 16px',minWidth:100,borderLeft:'1px solid var(--border-strong)', borderBottom:'1px solid var(--border)', color:'var(--text-primary)', background:'var(--surface-hover)'}}>
              {annualBudget>0?fmtRound(annualBudget):'—'}
            </td>
          </tr>
        );
      })}
      {(()=>{
        const totBudget=(()=>{let s=0;catList.forEach(c=>{for(let m=1;m<=12;m++)s+=getBudget(c,m);});return s;})();
        return(
          <tr style={{background:'rgba(var(--blue-vibrant-rgb), 0.03)'}}>
            <td style={{padding:'12px 16px',fontSize:13,fontWeight:700,color:'var(--text-primary)',position:'sticky',left:0,background:'var(--surface-hover)',zIndex:1, fontFamily:'Outfit, sans-serif'}}>Total {sectionLabel}</td>
            {MO.map((mo,i)=>{
              const m=i+1;
              const tb=catList.reduce((s,c)=>s+getBudget(c,m),0);
              const isCur=m===curMonth&&year===curYear;
              return(
                <td key={i} style={{textAlign:'right',padding:'12px 16px',background:isCur?'rgba(var(--blue-vibrant-rgb), 0.05)':'transparent', borderBottom:'1px solid var(--border-strong)'}}>
                  <span style={{fontSize:13,fontWeight:700,color:'var(--text-secondary)'}}>{tb>0?fmtRound(tb):'—'}</span>
                </td>
              );
            })}
            <td style={{textAlign:'right',fontSize:13,fontWeight:800,padding:'12px 16px',borderLeft:'1px solid var(--border-strong)', color:'var(--text-primary)', background:'var(--surface-hover)', borderBottom:'1px solid var(--border-strong)'}}>
              {totBudget>0?fmtRound(totBudget):'—'}
            </td>
          </tr>
        );
      })()}
    </>);
  };

  const renderAnnualView=()=>{
    const netBudget=annualIncomeBudget-annualExpenseBudget;
    return(
      <div style={{padding:0}}>
      <div style={{display:'flex',gap:12,padding:'16px 20px',justifyContent:'flex-end',alignItems:'center', background:'var(--surface-hover)', borderBottom:'1px solid var(--border)'}}>
        <span style={{fontSize:12,color:'var(--text-muted)',flex:1,fontWeight:500}}>Click any cell to edit inline · Enter to save</span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={(e)=>{e.preventDefault();setPasteModal(true)}}>📋 Paste from Excel</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={(e)=>{e.preventDefault();startYearEdit()}}>✏ Edit Year</button>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',minWidth:1200, width:'100%'}}>
          <thead>
            <tr style={{background:'var(--surface)',borderBottom:'1px solid var(--border-strong)'}}>
              <th style={{textAlign:'left',padding:'12px 16px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',minWidth:160,position:'sticky',left:0,background:'var(--surface)',zIndex:3, fontFamily:'Outfit, sans-serif'}}>Category</th>
              {MO.map((mo,i)=>{
                const isCur=(i+1)===curMonth&&year===curYear;
                return(
                  <th key={i} style={{textAlign:'right',padding:'12px 16px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1px',color:isCur?'var(--blue-vibrant)':'var(--text-muted)',minWidth:90,background:isCur?'rgba(var(--blue-vibrant-rgb), 0.05)':'transparent'}}>
                    {mo}
                  </th>
                );
              })}
              <th style={{textAlign:'right',padding:'12px 16px',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',minWidth:100,borderLeft:'1px solid var(--border-strong)'}}>Total</th>
            </tr>
          </thead>
          <tbody>
            {renderAnnualSection('Income',allIncomeCats)}
            {renderAnnualSection('Expenses',allExpenseCats)}
            {(()=>{
              return(
                <tr style={{background:'rgba(var(--blue-vibrant-rgb), 0.08)',fontWeight:700}}>
                  <td style={{padding:'16px',fontSize:15,fontWeight:800,position:'sticky',left:0,background:'var(--surface)',zIndex:1,color:'var(--text-primary)', fontFamily:'Outfit, sans-serif'}}>NET P&L</td>
                  {MO.map((mo,i)=>{
                    const m=i+1;
                    const ib=allIncomeCats.reduce((s,c)=>s+getBudget(c,m),0);
                    const eb=allExpenseCats.reduce((s,c)=>s+getBudget(c,m),0);
                    const nb=ib-eb;
                    const isCur=m===curMonth&&year===curYear;
                    return(
                      <td key={i} style={{textAlign:'right',padding:'16px',background:isCur?'rgba(var(--blue-vibrant-rgb), 0.1)':'transparent', borderTop:'2px solid var(--border-strong)'}}>
                        {nb!==0?<span style={{fontSize:13,fontWeight:700,color:nb>=0?'var(--green)':'var(--red)'}}>{nb>=0?'+':''}{fmtRound(nb)}</span>:<span style={{color:'var(--text-muted)',fontSize:11}}>—</span>}
                      </td>
                    );
                  })}
                  <td style={{textAlign:'right',fontSize:15,fontWeight:900,color:netBudget>=0?'var(--green)':'var(--red)',padding:'16px',borderLeft:'1px solid var(--border-strong)', borderTop:'2px solid var(--border-strong)'}}>{netBudget>=0?'+':''}{fmtRound(netBudget)}</td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
      <div style={{padding:'12px 16px',fontSize:12,fontWeight:500,color:'var(--text-muted)',borderTop:'1px solid var(--border)', background:'var(--surface-hover)'}}>
        Actuals &amp; progress tracking are on the Dashboard.
      </div>
      </div>
    );
  };

  /* ═══════════════════════════════════════════════════════════════════════
     VIEW C — EDIT YEAR  (spreadsheet grid, all 12 months × all categories)
  ═══════════════════════════════════════════════════════════════════════ */
  const renderEditYearView=()=>{
    const setCell=(cat,m,val)=>setYearEdits(prev=>({...prev,[cat]:{...prev[cat],[String(m)]:val}}));
    const renderSection=(label,catList,isIncome)=>(
      <>
        <tr style={{background:'var(--elevated)'}}>
          <td colSpan={13} style={{fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',paddingLeft:10,paddingTop:8,paddingBottom:4,borderTop:'2px solid var(--border)'}}>{label}</td>
        </tr>
        {catList.map(cat=>(
          <tr key={cat} style={{borderBottom:'1px solid var(--border)'}}>
            <td style={{fontWeight:400,fontSize:12,paddingLeft:10,minWidth:150,position:'sticky',left:0,background:'var(--surface)',zIndex:1,whiteSpace:'nowrap',color:'var(--text-primary)'}}>{cat}</td>
            {MO.map((mo,i)=>{
              const m=i+1;
              const isCur=m===curMonth&&year===curYear;
              const val=yearEdits[cat]?.[String(m)]??'';
              const actual=getActual(cat,m);
              return(
                <td key={m} style={{padding:'3px 3px',background:isCur?'rgba(var(--blue-primary-rgb), 0.12)':'transparent',minWidth:82}}>
                  <input type="number" step="1" min="0" value={val}
                    onChange={e=>setCell(cat,m,e.target.value)}
                    style={{width:'100%',border:'1px solid var(--border)',borderRadius:6,padding:'4px 5px',fontSize:11,textAlign:'right',fontFamily:'Plus Jakarta Sans',fontWeight:300,
                      background:isCur?'rgba(var(--blue-primary-rgb), 0.12)':'var(--elevated)',color:'var(--text-primary)',
                      outline:isCur?'1px solid var(--blue-primary)':undefined}}
                    placeholder={actual>0?String(Math.round(actual)):''}/>
                  {actual>0&&<div style={{fontSize:9,color:isIncome?'var(--green)':'var(--text-muted)',textAlign:'right',padding:'1px 3px 0',opacity:0.8,fontWeight:300}}>
                    act {fmt(actual)}</div>}
                </td>
              );
            })}
          </tr>
        ))}
      </>
    );
    return(
      <div>
        <div style={{display:'flex',gap:8,marginBottom:10,justifyContent:'flex-end',alignItems:'center'}}>
          <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>Editing all months for {year} · Current month (highlighted) shown first</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={()=>{setView('annual');setYearEdits({});}}>Cancel</button>
          <button type="button" className="btn btn-sm btn-success" onClick={saveYearEdits} disabled={saving}>{saving?'Saving…':'Save Year'}</button>
        </div>
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:0,overflow:'hidden'}}>
          <div style={{overflowX:'auto'}}>
            <table style={{borderCollapse:'collapse',minWidth:1100}}>
              <thead>
                <tr style={{background:'var(--elevated)',borderBottom:'2px solid var(--border)'}}>
                  <th style={{textAlign:'left',padding:'8px 10px',fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)',minWidth:150,position:'sticky',left:0,background:'var(--elevated)',zIndex:3}}>Category</th>
                  {MO.map((mo,i)=>{
                    const isCur=(i+1)===curMonth&&year===curYear;
                    return(
                      <th key={i} style={{textAlign:'center',padding:'6px 4px',fontWeight:isCur?500:400,fontSize:10,textTransform:'uppercase',letterSpacing:'1px',
                        color:isCur?'var(--blue-primary)':'var(--text-muted)',minWidth:82,
                        background:isCur?'rgba(var(--blue-primary-rgb), 0.12)':'transparent',
                        borderBottom:isCur?'2px solid var(--blue-primary)':undefined}}>
                        {mo}{isCur?' ★':''}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {renderSection('Income',allIncomeCats,true)}
                {renderSection('Expenses',allExpenseCats,false)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  /* ── KPI strip (shared across both views) ───────────────────────────────── */
  const renderKPIs=()=>{
    const kpiStyle={padding:20};
    if(view==='month'){
      const expPct=monthExpenseBudget>0?Math.round(monthExpenseActual/monthExpenseBudget*100):0;
      const expColor=expPct>=100?'var(--red)':expPct>=80?'var(--amber)':'var(--green)';
      return(
        <div className="metric-grid grid-4" style={{marginBottom:24}}>
          <div className="card metric-card" style={kpiStyle}><div className="metric-label">Income — {MO[month-1]}</div><div className="metric-value" style={{color:'var(--green)'}}>{fmt(monthIncomeBudget)}</div><div style={{fontSize:12, marginTop:4, opacity:0.8}}>Actual: {fmt(monthIncomeActual)}</div></div>
          <div className="card metric-card" style={kpiStyle}><div className="metric-label">Expenses — {MO[month-1]}</div><div className="metric-value">{fmt(monthExpenseBudget)}</div><div style={{fontSize:12, marginTop:4, opacity:0.8}}>Actual: {fmt(monthExpenseActual)}</div></div>
          <div className="card metric-card" style={kpiStyle}><div className="metric-label">Budget Used</div><div className="metric-value" style={{color:expColor}}>{expPct}%</div><div style={{fontSize:12, marginTop:4, color:expColor}}>{fmt(monthExpenseActual)} of {fmt(monthExpenseBudget)}</div></div>
          <div className="card metric-card" style={kpiStyle}><div className="metric-label">Net — {MO[month-1]}</div><div className="metric-value" style={{color:monthNetBudget>=0?'var(--blue-vibrant)':'var(--red)'}}>{monthNetBudget>=0?'+':''}{fmt(monthNetBudget)}</div><div style={{fontSize:12, marginTop:4, opacity:0.8}}>Actual: {monthNetActual>=0?'+':''}{fmt(monthNetActual)}</div></div>
        </div>
      );
    }else{
      const annExpPct=annualExpenseBudget>0?Math.round(annualExpenseActual/annualExpenseBudget*100):0;
      const annExpColor=annExpPct>=100?'var(--red)':annExpPct>=80?'var(--amber)':'var(--green)';
      return(
        <div className="metric-grid grid-4" style={{marginBottom:24}}>
          <div className="card metric-card" style={kpiStyle}><div className="metric-label">Annual Income</div><div className="metric-value" style={{color:'var(--green)'}}>{fmt(annualIncomeBudget)}</div><div style={{fontSize:12, marginTop:4, opacity:0.8}}>Actual: {fmt(annualIncomeActual)}</div></div>
          <div className="card metric-card" style={kpiStyle}><div className="metric-label">Annual Expenses</div><div className="metric-value">{fmt(annualExpenseBudget)}</div><div style={{fontSize:12, marginTop:4, opacity:0.8}}>Actual: {fmt(annualExpenseActual)}</div></div>
          <div className="card metric-card" style={kpiStyle}><div className="metric-label">Budget Used</div><div className="metric-value" style={{color:annExpColor}}>{annExpPct}%</div><div style={{fontSize:12, marginTop:4, color:annExpColor}}>{fmt(annualExpenseActual)} of {fmt(annualExpenseBudget)}</div></div>
          <div className="card metric-card" style={kpiStyle}><div className="metric-label">Annual Net</div><div className="metric-value" style={{color:(annualIncomeBudget-annualExpenseBudget)>=0?'var(--blue-vibrant)':'var(--red)'}}>{(annualIncomeBudget-annualExpenseBudget)>=0?'+':''}{fmt(annualIncomeBudget-annualExpenseBudget)}</div></div>
        </div>
      );
    }
  };

  /* ── Main render ────────────────────────────────────────────────────────── */
  return(
    <div className="budgets-page">
      {/* Top Header Card */}
      <div className="card" style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 24px', marginBottom:24, flexWrap:'wrap', gap:16}}>
        <div style={{display:'flex', alignItems:'center', gap:20}}>
          <div style={{display:'flex', gap:12}}>
            {[curYear-1,curYear,curYear+1].map(y=>(
              <button type="button" key={y} onClick={(e)=>{e.preventDefault();setYear(y);setEditing(false);setSuggestions({});}}
                style={{padding:'6px 0',border:'none',borderBottom:year===y?'2px solid var(--blue-vibrant)':'2px solid transparent',cursor:'pointer',fontSize:14,fontWeight:year===y?700:500,fontFamily:'Outfit, sans-serif',
                  background:'transparent',color:year===y?'var(--blue-vibrant)':'var(--text-muted)',
                  transition:'all 0.2s'}}>{y}</button>
            ))}
          </div>
        </div>
        
        <div className="sel-pill">
          <button type="button" data-active={view==='month'} onClick={(e)=>{e.preventDefault();setView('month')}}>Month</button>
          <button type="button" data-active={view==='annual'} onClick={(e)=>{e.preventDefault();setView('annual')}}>Annual</button>
          <button type="button" data-active={view==='edit-year'} onClick={(e)=>{e.preventDefault();startYearEdit()}}>Edit Year</button>
        </div>
      </div>

      {renderKPIs()}

      <div className="card" style={{padding:0, overflow:'hidden'}}>
        {loading
          ?<div className="loading"><div className="spinner"/><span>Loading…</span></div>
          :(allIncomeCats.length===0&&allExpenseCats.length===0&&Object.keys(targets).length===0)
            ?<div style={{padding:60,textAlign:'center'}}><div style={{color:'var(--text-muted)',fontSize:15,fontWeight:300}}>No budget data for {year}</div></div>
            :view==='edit-year'?renderEditYearView():view==='annual'?renderAnnualView():renderMonthView()
        }
      </div>

      {/* ── Paste from Excel modal ─────────────────────────────────────── */}
      {pasteModal&&(
        <div className="review-overlay">
          <div className="review-panel" style={{maxWidth:900}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <h3 style={{margin:0,fontSize:20,fontWeight:700,color:'var(--text-primary)',fontFamily:'Outfit, sans-serif'}}>📋 Paste Budget from Excel</h3>
              <button type="button" className="btn btn-sm btn-ghost" onClick={(e)=>{e.preventDefault();closePasteModal()}}>✕</button>
            </div>
            <p style={{fontSize:14,color:'var(--text-secondary)',margin:'0 0 20px',lineHeight:1.6}}>
              Copy from Excel/Sheets and paste below. Expected format: <strong>Category</strong> in column A, then columns for Jan–Dec.
            </p>
            <textarea
              className="search-input"
              style={{width:'100%',height:140,padding:12,fontSize:13,fontFamily:'inherit',resize:'vertical', marginBottom:20}}
              placeholder={"Category\tJan\tFeb\tMar...\nGroceries\t1200\t1200\t1300..."}
              value={pasteText}
              onChange={e=>{setPasteText(e.target.value);parsePasteText(e.target.value);}}
              autoFocus/>

            {parseErrors.length>0&&(
              <div style={{marginBottom:20,padding:'12px 16px',background:'rgba(239, 68, 68, 0.05)',border:'1px solid var(--red)',borderRadius:12,fontSize:13,color:'var(--red)'}}>
                {parseErrors.map((er,i)=><div key={i}>⚠ {er}</div>)}
              </div>
            )}

            {parsedRows&&parsedRows.length>0&&(
              <div style={{marginTop:20}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:'var(--text-primary)', fontFamily:'Outfit, sans-serif'}}>
                  Preview — {parsedRows.length} categories, {parsedRows.reduce((s,r)=>s+r.values.filter(v=>v!=null).length,0)} targets:
                </div>
                <div style={{overflowX:'auto', borderRadius:16, border:'1px solid var(--border)', background:'var(--surface-hover)'}}>
                  <table style={{borderCollapse:'collapse',fontSize:12,width:'100%'}}>
                    <thead>
                      <tr style={{background:'var(--surface)'}}>
                        <th style={{textAlign:'left',padding:'8px 12px',color:'var(--text-muted)',textTransform:'uppercase',fontSize:10,letterSpacing:'1px'}}>Category</th>
                        {MO.map(mo=><th key={mo} style={{textAlign:'right',padding:'8px 12px',color:'var(--text-muted)',textTransform:'uppercase',fontSize:10,letterSpacing:'1px'}}>{mo}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.map(({cat,values})=>(
                        <tr key={cat} style={{borderTop:'1px solid var(--border)'}}>
                          <td style={{padding:'8px 12px',fontWeight:600,color:'var(--text-primary)', fontFamily:'Outfit, sans-serif'}}>{cat}</td>
                          {values.map((v,i)=>(
                            <td key={i} style={{textAlign:'right',padding:'8px 12px',color:v!=null?'var(--text-primary)':'var(--text-muted)'}}>
                              {v!=null?fmtRound(v):'—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{display:'flex',justifyContent:'flex-end',gap:12,marginTop:24}}>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={(e)=>{e.preventDefault();closePasteModal()}}>Cancel</button>
                  <button type="button" className="btn btn-sm" onClick={(e)=>{e.preventDefault();confirmPaste()}} disabled={pasteSaving}>
                    {pasteSaving?'Saving…':`Save ${parsedRows.reduce((s,r)=>s+r.values.filter(v=>v!=null).length,0)} targets`}
                  </button>
                </div>
              </div>
            )}

            {(!parsedRows||parsedRows.length===0)&&pasteText.trim()&&(
              <div style={{marginTop:16,fontSize:14,color:'var(--text-muted)', textAlign:'center'}}>No valid rows found. Check that category names match exactly.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
