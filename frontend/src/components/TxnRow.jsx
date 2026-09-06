import React,{useState} from 'react';
import ReactDOM from 'react-dom';
import {ConfirmModal} from './ConfirmModal';
import {Icon} from './Icon';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {fmt,fmtDate,normalizeCat,showCategoryForType,sortedCats} from '../lib/format';

export function TxnRow({txn,categories,pointsCategories,onSave,onReview,onSplit,selected,onToggleSelect,onBatchEdit,toast}){
  const[locked,setLocked]=useState(txn.is_locked);
  const[gcb,setGcb]=useState(txn.is_gcb||false);
  const[forOthers,setForOthers]=useState(txn.is_for_others||false);
  /* Merchant category (CSC) — the network-facing classification (Visa,
     Mastercard, Amex, Discover — not the issuing bank), separate from the
     personal budget `category` above. Editable here + teachable to a scope
     (this card / this network / all cards) via /api/merchant-csc. */
  const[csc,setCsc]=useState(txn.points_category||'');
  const[showCscEdit,setShowCscEdit]=useState(false);
  const[cscVal,setCscVal]=useState(txn.points_category||'');
  const[cscScope,setCscScope]=useState('global');
  const[cscSaving,setCscSaving]=useState(false);
  const[excluded,setExcluded]=useState(txn.is_excluded||false);
  const[editing,setEditing]=useState(false);
  const[category,setCategory]=useState(txn.category_final);
  const[action,setAction]=useState(txn.action);
  const[descClean,setDescClean]=useState(txn.description_clean||txn.description_display||txn.description_raw||'');
  const[saving,setSaving]=useState(false);
  const[expanded,setExpanded]=useState(false);
  /* Transaction info modal */
  const[showTxnInfo,setShowTxnInfo]=useState(false);
  /* Quick Rule creation */
  const[showQuickRule,setShowQuickRule]=useState(false);
  const[rulePattern,setRulePattern]=useState(txn.description_clean||txn.description_raw||'');
  const[ruleDesc,setRuleDesc]=useState(txn.description_clean||txn.description_raw||'');
  const[ruleAction,setRuleAction]=useState(txn.action||'Expense');
  const[ruleCategory,setRuleCategory]=useState(txn.category_final||'');
  const[ruleSaving,setRuleSaving]=useState(false);
  /* rowClass: excluded rows get a distinct muted style */
  const rowClass=excluded?'row-excluded':locked?'row-locked':txn.needs_review?'row-review':txn.action==='Transfer'?'row-transfer':'';
  /* When type changes in edit mode, clear category if new type hides it */
  const handleTypeChange=(newType)=>{setAction(newType);if(!showCategoryForType(newType))setCategory('');};
  const[showRulePrompt,setShowRulePrompt]=useState(false);
  const[ruleCreating,setRuleCreating]=useState(false);
  const[cm,setCm]=useState(null);
  const isLlmSource=txn.enrichment_source==='llm'||txn.enrichment_source==='override';
  /* Points-earn manual override (see compute_points_earn in main.py) */
  const[showPointsOverride,setShowPointsOverride]=useState(false);
  const[pointsOverrideVal,setPointsOverrideVal]=useState(
    txn.points_earn&&txn.points_earn.classification==='manual_override'?String(txn.points_earn.points_estimated):''
  );
  const[pointsOverrideSaving,setPointsOverrideSaving]=useState(false);
  const savePointsOverride=async()=>{
    if(pointsOverrideVal===''||isNaN(Number(pointsOverrideVal)))return;
    setPointsOverrideSaving(true);
    try{await onSave(txn.id,{points_earn_override:Number(pointsOverrideVal)});toast&&toast('Points override saved');setShowPointsOverride(false);}
    catch(e){toast&&toast('Failed to save override: '+e.message,'error');}
    finally{setPointsOverrideSaving(false);}
  };
  const resetPointsOverride=async()=>{
    setPointsOverrideSaving(true);
    try{await onSave(txn.id,{clear_points_earn_override:true});toast&&toast('Reset to auto-classification');setPointsOverrideVal('');setShowPointsOverride(false);}
    catch(e){toast&&toast('Failed to reset: '+e.message,'error');}
    finally{setPointsOverrideSaving(false);}
  };
  const saveCsc=async()=>{
    if(!cscVal){setShowCscEdit(false);return;}
    setCscSaving(true);
    try{
      await onSave(txn.id,{points_category:cscVal});
      setCsc(cscVal);
      /* Teach the rule too, scoped as chosen, so future (and past-unclassified)
         transactions from this merchant pick it up automatically — this is
         the "establish rules across multiple txns" half of the ask, not just
         a one-off edit. */
      if(txn.merchant_name){
        const body={merchant_pattern:txn.merchant_name,points_category:cscVal,apply_to_existing:true};
        if(cscScope==='card')body.card_id=txn.card_id;
        else if(cscScope==='network')body.network=txn.network;
        const r=await apiFetch('/merchant-csc',{method:'POST',body:JSON.stringify(body)});
        toast&&toast(`Merchant category saved — ${r.transactions_updated||0} other transaction${r.transactions_updated===1?'':'s'} updated`);
      }else{
        toast&&toast('Merchant category saved');
      }
      setShowCscEdit(false);
    }catch(e){toast&&toast('Failed to save merchant category: '+(e?.message||''),'error');}
    finally{setCscSaving(false);}
  };
  const save=async()=>{
    const updates={category,action,needs_review:false};
    if(descClean!==(txn.description_clean||txn.description_display||txn.description_raw||''))updates.description_clean=descClean;
    setSaving(true);await onSave(txn.id,updates);setLocked(true);setSaving(false);setEditing(false);
    /* Only offer rule creation when enrichment came from LLM (not already a rule) */
    if(isLlmSource&&category&&category!=='Unclassified')setShowRulePrompt(true);
  };
  const createRuleFromTxn=async()=>{
    setRuleCreating(true);
    try{
      /* Use new smart rule API — uses clean merchant name, deduplicates, priority 200 */
      await apiFetch(`/llm/create-rule-from-transaction/${txn.id}`,{method:'POST'});
      onSave(txn.id,{needs_review:false});/* Mark reviewed + reload */
    }catch(e){}
    finally{setRuleCreating(false);setShowRulePrompt(false);}
  };
  const saveQuickRule=async()=>{
    if(!rulePattern.trim())return;
    setRuleSaving(true);
    try{
      const res=await apiFetch('/rules',{method:'POST',body:JSON.stringify({
        pattern:rulePattern.trim(),match_type:'contains',
        set_action:ruleAction||null,set_category:ruleCategory||null,
        set_description:ruleDesc.trim()||null,priority:100
      })});
      toast&&toast(`Rule created — ${res.reapplied?.updated??0} transactions updated (${res.reapplied?.unlocked??0} unlocked)`);
      await onSave(txn.id,{needs_review:false});/* Mark reviewed + reload */
    }catch(e){toast&&toast('Failed to create rule: '+e.message,'error');}
    finally{setRuleSaving(false);setShowQuickRule(false);}
  };
  const cancel=()=>{setCategory(txn.category_final);setAction(txn.action);setDescClean(txn.description_clean||txn.description_display||txn.description_raw||'');setEditing(false);};
  const toggleLock=async()=>{const nl=!locked;await onSave(txn.id,{is_locked:nl});setLocked(nl);};
  const toggleExclude=async()=>{const ne=!excluded;await onSave(txn.id,{is_excluded:ne});setExcluded(ne);};
  const amtClass=txn.action==='Transfer'?'amount-neutral':txn.amount<0?'amount-neg':'amount-pos';
  const typeBadge=(a)=>{const l=(a||'').toLowerCase();return l==='income'?'income':l==='transfer'?'transfer':'expense';};
  const displayAction=txn.action_display||txn.action;
  return(
    <React.Fragment>
    <tr className={rowClass} style={selected?{background:'rgba(var(--blue-primary-rgb), 0.08)'}:{}}>
      <td style={{width:48,paddingLeft:24,verticalAlign:'middle'}}>
        <input type="checkbox" checked={!!selected} onChange={()=>onToggleSelect(txn.id)} onClick={e=>e.stopPropagation()} style={{cursor:'pointer'}}/>
      </td>
      <td style={{color:'var(--text-secondary)',whiteSpace:'nowrap',fontSize:12}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          {txn.is_split&&<span onClick={()=>setExpanded(!expanded)} style={{cursor:'pointer',display:'inline-block',transition:'transform 0.2s',transform:expanded?'rotate(90deg)':'rotate(0deg)',fontSize:12,color:'var(--blue-primary)',userSelect:'none'}}>▸</span>}
          {fmtDate(txn.date)}
        </div>
      </td>
      <td>
        {editing
          ?<input value={descClean} onChange={e=>setDescClean(e.target.value)} className="search-input"
            style={{fontSize:12.5,padding:'6px 12px',width:'100%',boxSizing:'border-box'}}
            placeholder="Display name"/>
          :<div style={{fontWeight:600,fontSize:12.5,color:'var(--text-primary)'}}>{txn.description_display||txn.description_raw}</div>
        }
        <div style={{display:'flex',gap:6,alignItems:'center',marginTop:4,flexWrap:'wrap'}}>
          {txn.category_confidence<0.8&&!locked&&<span style={{fontSize:10,color:'var(--amber)',fontWeight:600}}>{Math.round((txn.category_confidence||0)*100)}% AI CONFIDENCE</span>}
          {txn.enrichment_source&&txn.enrichment_source!=='rule'&&(()=>{
            const src=txn.enrichment_source;
            const cfg={llm:{bg:'rgba(59,130,246,0.1)',color:'var(--blue-primary)',label:'AI ENRICHED'},override:{bg:'rgba(16,185,129,0.1)',color:'var(--green)',label:'AUTO-OVERRIDE'},fallback:{bg:'var(--border)',color:'var(--text-muted)',label:src.toUpperCase()}};
            const c=cfg[src]||cfg.fallback;
            return<span className="badge" style={{background:c.bg,color:c.color,fontSize:9}} title={`Source: ${src}`}>{c.label}</span>;
          })()}
        </div>
      </td>
      <td><span className={amtClass} style={{fontSize:12.5}}>{txn.amount<0?'-':'+'}{fmt(txn.amount)}</span></td>
      <td>
        {editing
          ?<select value={action} onChange={e=>handleTypeChange(e.target.value)} className="filter-select" style={{padding:'4px 8px'}}>
            {TXN_TYPES.map(a=><option key={a}>{a}</option>)}
          </select>
          :<span className={`badge badge-${typeBadge(txn.action)}`}>{displayAction}</span>
        }
      </td>
      <td>
        {!showCategoryForType(displayAction)
          ?<span style={{color:'var(--text-muted)',fontSize:12}}>—</span>
          :editing
            ?<select value={category} onChange={e=>setCategory(e.target.value)} className="filter-select" style={{padding:'4px 8px',width:140}}>
              <option value="">Unclassified</option>
              {sortedCats(categories).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            :<span className="badge" style={{background:'rgba(59,130,246,0.08)',color:'var(--blue-vibrant)'}}>
              {normalizeCat(txn.category_final)}
              {txn.category_manual&&<span style={{marginLeft:6,opacity:0.6}}>✎</span>}
            </span>
        }
      </td>
      <td style={{color:'var(--text-muted)',fontSize:12,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={txn.account_name}>{txn.account_name}</td>
      <td style={{paddingRight:24}}>
        {editing
          ?<div className="edit-actions" style={{justifyContent:'flex-end'}}>
            <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving?'…':'Save'}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={cancel}>✕</button>
          </div>
          :showRulePrompt
          ?<div className="edit-actions" style={{justifyContent:'flex-end'}}>
            <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:600}}>NEW RULE?</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={createRuleFromTxn} disabled={ruleCreating}>{ruleCreating?'…':'Create'}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setShowRulePrompt(false)}>No</button>
          </div>
          :<div className="edit-actions" style={{justifyContent:'flex-end'}}>
            <div style={{width:74,display:'flex',justifyContent:'flex-start'}}>
              {txn.needs_review&&!locked&&<button type="button" className="btn btn-sm btn-primary" style={{background:'var(--blue-neon)', boxShadow: '0 0 10px rgba(56,189,248,0.2)'}} onClick={()=>onReview(txn)}>Review</button>}
            </div>
            {/* Status chips — tap to open Details, where GCB/Exclude/Lock/Rule live.
                Keeping this row to just a few controls is what stops the row from
                needing horizontal space it doesn't have (previously up to 7 buttons
                here, which is what pushed Save/Cancel off the visible edge in edit
                mode — see PLAN.md). */}
            {gcb&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:20,background:'rgba(251,191,36,0.12)',color:'var(--amber)',border:'1px solid rgba(251,191,36,0.3)'}}>⭐</span>}
            {forOthers&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:20,background:'rgba(59,130,246,0.1)',color:'var(--blue-primary)',border:'1px solid rgba(59,130,246,0.25)'}}>👥</span>}
            {excluded&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:20,background:'rgba(248,113,113,0.08)',color:'var(--red)',border:'1px solid rgba(248,113,113,0.3)'}}>⊘</span>}
            {locked&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:20,background:'var(--elevated)',color:'var(--text-muted)',border:'1px solid var(--border)'}}>🔒</span>}
            <button type="button" className="btn btn-sm btn-ghost" style={{padding:6}} onClick={()=>setShowTxnInfo(true)} title="Details"><Icon name="info" size={14}/></button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={()=>selected?onBatchEdit():setEditing(true)}>Edit</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={()=>onSplit(txn)}>{txn.is_split?'Splits':'Split'}</button>
          </div>
        }
      </td>
    </tr>
    {expanded&&txn.splits&&txn.splits.map((s,i)=>(
      <tr key={`split-${txn.id}-${i}`} style={{background:'rgba(59,130,246,0.03)',fontSize:13}}>
        <td></td>
        <td></td>
        <td style={{paddingLeft:32,color:'var(--text-secondary)',fontWeight:500}}>{s.description||<span style={{color:'var(--text-muted)',fontStyle:'italic'}}>—</span>}</td>
        <td><span style={{color:'var(--text-secondary)',fontWeight:600}}>{s.amount<0?'-':'+'}{fmt(s.amount)}</span></td>
        <td><span className={`badge badge-${typeBadge(s.action)}`} style={{fontSize:11}}>{s.action||'Expense'}</span></td>
        <td>{s.category?<span className="badge badge-category" style={{fontSize:11}}>{s.category}</span>:<span style={{color:'var(--text-muted)'}}>—</span>}</td>
        <td></td>
        <td></td>
      </tr>
    ))}
    {showQuickRule&&ReactDOM.createPortal(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'var(--elevated)',backdropFilter:'var(--glass-blur)',WebkitBackdropFilter:'var(--glass-blur)',border:'1px solid var(--border-strong)',borderRadius:14,padding:32,width:500,maxWidth:'92vw',boxShadow:'0 24px 64px rgba(0,0,0,0.35)',display:'flex',flexDirection:'column',gap:20}}>
          {/* Header */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <div style={{fontWeight:400,fontSize:18,color:'var(--text-primary)'}}>Create Rule</div>
              <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>Auto-categorize future matching transactions</div>
            </div>
            <button type="button" className="btn btn-ghost" style={{padding:'4px 8px',fontSize:16,lineHeight:1}} onClick={()=>setShowQuickRule(false)}>✕</button>
          </div>
          {/* Source transaction */}
          <div style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',fontSize:12,color:'var(--text-secondary)'}}>
            <span style={{fontWeight:500,color:'var(--text-muted)',marginRight:6}}>From transaction:</span>
            <span style={{fontFamily:'monospace',color:'var(--text-primary)'}}>{txn.description_raw}</span>
          </div>
          {/* Match Pattern */}
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <label style={{fontWeight:500,fontSize:13,color:'var(--text-primary)'}}>Match Pattern</label>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:2}}>Text to look for in the bank description. Any transaction containing this text will match.</div>
            <input value={rulePattern} onChange={e=>setRulePattern(e.target.value)}
              placeholder="e.g. STARBUCKS"
              style={{fontSize:13,padding:'8px 12px',border:'1px solid var(--border)',borderRadius:7,width:'100%',boxSizing:'border-box',background:'var(--bg)',color:'var(--text-primary)'}}
              autoFocus/>
          </div>
          {/* Display Name */}
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <label style={{fontWeight:500,fontSize:13,color:'var(--text-primary)'}}>Display Name</label>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:2}}>The clean, readable name shown for matched transactions (replaces the raw bank description).</div>
            <input value={ruleDesc} onChange={e=>setRuleDesc(e.target.value)}
              placeholder="e.g. Starbucks Coffee"
              style={{fontSize:13,padding:'8px 12px',border:'1px solid var(--border)',borderRadius:7,width:'100%',boxSizing:'border-box',background:'var(--bg)',color:'var(--text-primary)'}}/>
          </div>
          {/* Type + Category */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <label style={{fontWeight:500,fontSize:13,color:'var(--text-primary)'}}>Type</label>
              <select value={ruleAction} onChange={e=>setRuleAction(e.target.value)}
                className="filter-select"
                style={{fontSize:13,padding:'8px 10px',border:'1px solid var(--border)',borderRadius:7,background:'var(--bg)',color:'var(--text-primary)'}}>
                {TXN_TYPES.map(a=><option key={a}>{a}</option>)}
              </select>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <label style={{fontWeight:500,fontSize:13,color:'var(--text-primary)'}}>Category</label>
              <select value={ruleCategory} onChange={e=>setRuleCategory(e.target.value)}
                className="filter-select"
                style={{fontSize:13,padding:'8px 10px',border:'1px solid var(--border)',borderRadius:7,background:'var(--bg)',color:'var(--text-primary)'}}>
                <option value="">No category</option>
                {sortedCats(categories).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>
          {/* Actions */}
          <div style={{display:'flex',gap:10,justifyContent:'flex-end',paddingTop:4}}>
            <button type="button" className="btn btn-ghost" style={{fontSize:13,padding:'8px 18px'}} onClick={()=>setShowQuickRule(false)}>Cancel</button>
            <button type="button" className="btn btn-success" style={{fontSize:13,padding:'8px 22px',fontWeight:500}} onClick={saveQuickRule} disabled={ruleSaving}>
              {ruleSaving?'Saving…':'Save Rule'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    {showTxnInfo&&ReactDOM.createPortal(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'var(--elevated)',backdropFilter:'var(--glass-blur)',WebkitBackdropFilter:'var(--glass-blur)',border:'1px solid var(--border-strong)',borderRadius:14,padding:32,width:580,maxWidth:'94vw',maxHeight:'85vh',overflowY:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.35)',display:'flex',flexDirection:'column',gap:18}}>
          {/* Header */}
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between'}}>
            <div>
              <div style={{fontWeight:400,fontSize:18,color:'var(--text-primary)'}}>Transaction Details</div>
              <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>ID #{txn.id}</div>
            </div>
            <button type="button" className="btn btn-ghost" style={{padding:'4px 8px',fontSize:16,lineHeight:1}} onClick={()=>setShowTxnInfo(false)}>✕</button>
          </div>
          {/* Description block */}
          <div style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px',display:'flex',flexDirection:'column',gap:4}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Description</div>
            <div style={{fontWeight:500,fontSize:15,color:'var(--text-primary)'}}>{txn.description_display||txn.description_raw}</div>
            {txn.description_display&&txn.description_display!==txn.description_raw&&(
              <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                <span style={{fontWeight:500}}>Raw: </span>
                <span style={{fontFamily:'monospace'}}>{txn.description_raw}</span>
              </div>
            )}
          </div>
          {/* Info grid */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {(()=>{
              const importLabel={plaid:'Plaid',csv:'CSV',ofx:'OFX',manual:'Manual'};
              const enrichLabel={llm:'AI',rule:'Rule',override:'Manual Override',fallback:'Fallback'};
              const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):'—';
              const src=txn.import_source||'plaid';
              const enr=txn.enrichment_source||null;
              return[
                ['Date',fmtDate(txn.date)],
                ['Amount',(txn.amount<0?'– ':'+ ')+fmt(txn.amount)],
                ['Account',txn.account_name],
                ['Type',txn.action_display||cap(txn.action)],
                ['Category',normalizeCat(txn.category_final)],
                ...(txn.network?[['Network',txn.network]]:[]),
                ['Confidence',txn.category_confidence!=null?Math.round(txn.category_confidence*100)+'%':'—'],
                ['Import Source',importLabel[src]||cap(src)],
                ['Enrichment',enr?(enrichLabel[enr]||cap(enr)):'—'],
              ];
            })().map(([label,value])=>(
              <div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'9px 12px'}}>
                <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:3}}>{label}</div>
                <div style={{fontSize:13,color:'var(--text-primary)',fontWeight:500,wordBreak:'break-word'}}>{value}</div>
              </div>
            ))}
          </div>
          {/* Category override note */}
          {txn.category_manual&&txn.category_auto&&txn.category_auto!==txn.category_manual&&(
            <div style={{fontSize:12,color:'var(--text-muted)',background:'var(--bg)',borderRadius:8,padding:'9px 13px',border:'1px solid var(--border)'}}>
              <span style={{fontWeight:500}}>AI suggested: </span><span>{txn.category_auto}</span>
              <span style={{margin:'0 8px',opacity:0.4}}>→</span>
              <span style={{fontWeight:500}}>Manual override: </span><span>{txn.category_manual}</span>
            </div>
          )}
          {/* Merchant category (CSC) — how the network codes this merchant,
              independent of the personal budget category above. Editable here
              and teachable to future transactions at a chosen scope. */}
          <div style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:showCscEdit?10:0}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Merchant Category</div>
              <button type="button" onClick={()=>{setCscVal(csc);setShowCscEdit(!showCscEdit);}}
                style={{fontSize:11,color:'var(--text-muted)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>
                {showCscEdit?'Cancel':csc?'Edit':'Set'}
              </button>
            </div>
            {!showCscEdit&&<div style={{fontSize:13,color:'var(--text-primary)',fontWeight:500}}>
              {csc||<span style={{color:'var(--text-muted)',fontStyle:'italic',fontWeight:400}}>Not classified</span>}
            </div>}
            {showCscEdit&&(
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <select value={cscVal} onChange={e=>setCscVal(e.target.value)}
                  style={{fontSize:13,padding:'7px 10px',borderRadius:8,border:'1px solid var(--border-strong)',background:'var(--elevated)',color:'var(--text-primary)'}}>
                  <option value="">— none —</option>
                  {(pointsCategories||[]).filter(c=>c.is_active).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                {txn.merchant_name&&<div style={{display:'flex',flexDirection:'column',gap:4}}>
                  <div style={{fontSize:11,color:'var(--text-muted)'}}>Apply to future "{txn.merchant_name}" transactions from:</div>
                  <select value={cscScope} onChange={e=>setCscScope(e.target.value)}
                    style={{fontSize:12,padding:'6px 9px',borderRadius:8,border:'1px solid var(--border)',background:'var(--elevated)',color:'var(--text-primary)'}}>
                    <option value="global">All cards</option>
                    {txn.network&&<option value="network">Every {txn.network} card</option>}
                    <option value="card">This card only</option>
                  </select>
                </div>}
                <button type="button" className="btn btn-sm btn-primary" style={{alignSelf:'flex-start'}} onClick={saveCsc} disabled={cscSaving}>
                  {cscSaving?'Saving…':'Save'}
                </button>
              </div>
            )}
          </div>
          {/* Points earn — color/label follow compute_points_earn()'s classification
              rather than always reading as a positive "you earned this" box. */}
          {txn.points_earn&&(()=>{
            const cls=txn.points_earn.classification;
            const isClawback=cls==='clawback';
            const isOverride=cls==='manual_override';
            const isNeutral=cls==='excluded';
            const color=isClawback?'var(--red)':isOverride?'var(--amber)':isNeutral?'var(--text-muted)':'var(--green)';
            const bg=isClawback?'rgba(248,113,113,0.1)':isOverride?'rgba(251,191,36,0.1)':isNeutral?'var(--elevated)':'rgba(52,211,153,0.1)';
            const border=isClawback?'rgba(248,113,113,0.3)':isOverride?'rgba(251,191,36,0.3)':isNeutral?'var(--border)':'rgba(52,211,153,0.3)';
            const label={
              earn:'Points Earn', clawback:'Points Clawback',
              excluded:'Excluded From Earn Calc', manual_override:'Manual Override',
            }[cls]||'Points Earn';
            return(
            <div style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:'12px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:500,color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</div>
                <button type="button" onClick={()=>setShowPointsOverride(!showPointsOverride)}
                  style={{fontSize:11,color:'var(--text-muted)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>
                  {isOverride?'Edit override':'Adjust'}
                </button>
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  {txn.points_earn.points_category?(
                    <span style={{display:'flex',alignItems:'center',gap:4}}>
                      {txn.points_earn.points_category_l1&&(
                        <>
                          <span style={{fontSize:12,color,background:bg,borderRadius:5,padding:'2px 7px'}}>{txn.points_earn.points_category_l1}</span>
                          <span style={{fontSize:11,color}}>›</span>
                        </>
                      )}
                      <span style={{fontSize:12,fontWeight:500,color,background:bg,borderRadius:5,padding:'2px 7px'}}>{txn.points_earn.points_category}</span>
                    </span>
                  ):(
                    <span style={{fontSize:12,color,fontStyle:'italic'}}>Base rate</span>
                  )}
                  {txn.points_earn.earn_rate!=null&&<span style={{fontSize:13,fontWeight:400,color}}>{txn.points_earn.earn_rate}x</span>}
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:18,fontWeight:400,color}}>
                    {txn.points_earn.points_estimated.toLocaleString(undefined,{maximumFractionDigits:0})} pts
                  </div>
                  <div style={{fontSize:11,color}}>
                    ≈ ${(txn.points_earn.points_estimated*txn.points_earn.cpp/100).toFixed(2)} value · {txn.points_earn.currency}
                  </div>
                </div>
              </div>
              {showPointsOverride&&(
                <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10,paddingTop:10,borderTop:`1px solid ${border}`}}>
                  <input type="number" step="1" value={pointsOverrideVal} onChange={e=>setPointsOverrideVal(e.target.value)}
                    placeholder="Points value" style={{width:110,padding:'6px 10px',fontSize:13,borderRadius:8,border:'1px solid var(--border-strong)',background:'var(--bg)',color:'var(--text-primary)'}}/>
                  <button type="button" className="btn btn-sm btn-secondary" disabled={pointsOverrideSaving} onClick={savePointsOverride}>Save</button>
                  {isOverride&&<button type="button" className="btn btn-sm btn-ghost" disabled={pointsOverrideSaving} onClick={resetPointsOverride}>Reset to auto</button>}
                </div>
              )}
            </div>
            );
          })()}
          {/* Tags & flags — toggleable here rather than as always-visible row
              buttons, which is what crowded the table row (see PLAN.md). */}
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button type="button" className="btn btn-sm"
              style={{fontSize:11,padding:'3px 10px',borderRadius:20,background:gcb?'rgba(251,191,36,0.12)':'var(--elevated)',color:gcb?'var(--amber)':'var(--text-muted)',border:gcb?'1px solid rgba(251,191,36,0.3)':'1px solid var(--border)'}}
              onClick={async()=>{const ng=!gcb;await onSave(txn.id,{is_gcb:ng});setGcb(ng);}}>
              ⭐ {gcb?'GCB Tagged':'Tag as GCB'}
            </button>
            <button type="button" className="btn btn-sm"
              style={{fontSize:11,padding:'3px 10px',borderRadius:20,background:forOthers?'rgba(59,130,246,0.1)':'var(--elevated)',color:forOthers?'var(--blue-primary)':'var(--text-muted)',border:forOthers?'1px solid rgba(59,130,246,0.25)':'1px solid var(--border)'}}
              onClick={async()=>{const nf=!forOthers;await onSave(txn.id,{is_for_others:nf});setForOthers(nf);}}
              title="Money spent on behalf of someone else — kept out of your own budget totals, still shown in cash flow">
              👥 {forOthers?'For Others':'Tag: For Others'}
            </button>
            <button type="button" className="btn btn-sm"
              style={{fontSize:11,padding:'3px 10px',borderRadius:20,background:excluded?'rgba(248,113,113,0.08)':'var(--elevated)',color:excluded?'var(--red)':'var(--text-muted)',border:excluded?'1px solid rgba(248,113,113,0.3)':'1px solid var(--border)'}}
              onClick={toggleExclude}
              title="Hide from totals and balances without deleting it">
              ⊘ {excluded?'Excluded':'Exclude'}
            </button>
            {locked&&<button type="button" className="btn btn-sm"
              style={{fontSize:11,padding:'3px 10px',borderRadius:20,background:'var(--elevated)',color:'var(--text-muted)',border:'1px solid var(--border)'}}
              onClick={toggleLock} title="Unlock — allow sync/rules to overwrite this again">
              🔒 Locked
            </button>}
            {txn.needs_review&&<span style={{fontSize:11,padding:'3px 10px',borderRadius:20,background:'rgba(251,191,36,0.1)',color:'var(--amber)',border:'1px solid rgba(251,191,36,0.3)'}}>⚠ Needs Review</span>}
          </div>
          {/* Splits breakdown */}
          {txn.is_split&&txn.splits&&txn.splits.length>0&&(
            <div>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:8}}>Splits ({txn.splits.length})</div>
              <div style={{border:'1px solid var(--border)',borderRadius:8,overflow:'hidden'}}>
                {txn.splits.map((s,i)=>(
                  <div key={i} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:10,alignItems:'center',padding:'10px 14px',borderBottom:i<txn.splits.length-1?'1px solid var(--border)':'none',background:i%2===0?'var(--bg)':'var(--elevated)'}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>{s.description||<span style={{fontStyle:'italic',color:'var(--text-muted)'}}>—</span>}</div>
                      {s.category&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{s.category}</div>}
                    </div>
                    <span className={`badge badge-${typeBadge(s.action)}`} style={{fontSize:10}}>{s.action}</span>
                    <span style={{fontWeight:500,fontSize:13,minWidth:70,textAlign:'right',color:'var(--text-primary)'}}>{s.amount<0?'–':'+' }{fmt(s.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Footer */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:6,borderTop:'1px solid var(--border)'}}>
            <div style={{display:'flex',gap:8}}>
              <button type="button" className="btn btn-sm btn-secondary"
                onClick={()=>{setShowTxnInfo(false);onSplit(txn);}}
                title={txn.is_split?'Edit existing splits':'Split this transaction into parts'}>
                {txn.is_split?'✎ Edit Splits':'⊕ Split Transaction'}
              </button>
              <button type="button" className="btn btn-sm btn-secondary"
                onClick={()=>{const d=txn.description_clean||txn.description_raw||'';setRulePattern(d);setRuleDesc(d);setRuleAction(txn.action||'Expense');setRuleCategory(txn.category_final||'');setShowTxnInfo(false);setShowQuickRule(true);}}
                title="Create a rule from this transaction">
                Create Rule
              </button>
              <button type="button" className="btn btn-sm"
                style={{background:'rgba(248,113,113,0.08)',color:'var(--red)',border:'1px solid rgba(248,113,113,0.3)',fontSize:12}}
                onClick={()=>setCm({
                  title:'Delete Transaction',
                  body:`Permanently delete "${txn.description_display||txn.description_raw}" (${fmtDate(txn.date)} · ${fmt(Math.abs(txn.amount))})?\n\nThis cannot be undone.`,
                  confirmLabel:'Delete',danger:true,
                  onConfirm:async()=>{
                    await apiFetch(`/transactions/${txn.id}`,{method:'DELETE'});
                    setShowTxnInfo(false);
                    toast&&toast('Transaction deleted');
                    onSave(txn.id,{__deleted:true});
                  }
                })}
                title="Permanently delete this transaction">
                🗑 Delete
              </button>
            </div>
            <button type="button" className="btn btn-ghost" style={{fontSize:13,padding:'8px 18px'}} onClick={()=>setShowTxnInfo(false)}>Close</button>
          </div>
        </div>
      </div>,
      document.body
    )}
    {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}
    </React.Fragment>
  );
}

/* Modal for creating manual value-change transactions (Section 2c) */
