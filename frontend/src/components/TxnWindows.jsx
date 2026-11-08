import {useState} from 'react';
import {CategoryOptions} from './CategoryOptions';
import {CIcon} from './ui/CIcon';
import {Window} from './ui/Window';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {amtClass,isBudget,longDate,signed} from '../lib/txnView';

const nameOf=t=>t.description_display||t.description_raw||'';

/* Review window (the row's Review button): today's window in the new look.
   Ignore takes the row off the review list without changing anything. */
export function TxnReviewWindow({t,categories,onSave,onClose,toast}){
  const[action,setAction]=useState(t.action||'Expense');
  const[category,setCategory]=useState(t.category_final&&t.category_final!=='Unclassified'?t.category_final:'');
  const ai=t.enrichment_source==='llm'||t.enrichment_source==='fallback';
  const[rule,setRule]=useState(ai);
  const[busy,setBusy]=useState(false);
  const pickType=a=>{setAction(a);if(!isBudget(a))setCategory('');};
  const save=async()=>{
    setBusy(true);
    const ok=await onSave(t.id,{category:isBudget(action)?category:'',action,needs_review:false},'Reviewed');
    if(ok&&rule&&ai&&isBudget(action)&&category&&category!=='Unclassified'){
      try{await apiFetch(`/llm/create-rule-from-transaction/${t.id}`,{method:'POST'});toast('Rule saved for this merchant');}
      catch(e){toast('Saved, but the rule failed: '+e.message,'error');}
    }
    setBusy(false);
    if(ok)onClose();
  };
  const ignore=async()=>{setBusy(true);const ok=await onSave(t.id,{needs_review:false},'Ignored');setBusy(false);if(ok)onClose();};
  return(
    <Window label="Review transaction" size="sm">
      <div className="c-wb">
        <div className="c-wh">
          <div><h3>Review transaction</h3>
            <span className="c-mut">{longDate(t.date)} · <b className={amtClass(t)}>{signed(t.amount)}</b> · {t.account_name}</span></div>
          <button type="button" className="c-x" aria-label="Close" onClick={onClose}><CIcon name="x"/></button>
        </div>
        <div className="c-box">
          <span className="c-lbl">Description</span>
          <b>{nameOf(t)}</b>
          {nameOf(t)!==t.description_raw&&<span className="c-mut">Raw: <code>{t.description_raw}</code></span>}
          {t.category_confidence!=null&&<span className="c-mut">AI confidence {Math.round(t.category_confidence*100)}%</span>}
        </div>
        <div className="tx-rvf">
          <label className="c-fld"><span>Type</span>
            <select className="c-sel" value={action} onChange={e=>pickType(e.target.value)}>{TXN_TYPES.map(a=><option key={a}>{a}</option>)}</select>
          </label>
          {isBudget(action)&&<label className="c-fld"><span>Category</span>
            <select className="c-sel" value={category} onChange={e=>setCategory(e.target.value)}>
              <option value="">Select a category</option>
              <CategoryOptions categories={categories}/>
            </select>
          </label>}
        </div>
        {ai&&isBudget(action)&&<label className="c-cb" style={{fontSize:13}}>
          <input type="checkbox" checked={rule} onChange={e=>setRule(e.target.checked)}/> Save as a rule for this merchant
        </label>}
        <div className="c-wf">
          <button type="button" className="c-btn ghost sm" onClick={ignore} disabled={busy} title="Takes it off the review list without changing anything">Ignore</button>
          <div className="c-row">
            <button type="button" className="c-btn sm" onClick={onClose} disabled={busy}>Discard</button>
            <button type="button" className="c-btn pri sm" onClick={save} disabled={busy}>{busy?'Saving…':'Save'}</button>
          </div>
        </div>
      </div>
    </Window>
  );
}

/* Edit selected: only the fields that were changed are set, and the rows are
   marked reviewed. */
export function TxnBatchWindow({count,categories,onApply,onClose}){
  const[action,setAction]=useState('');
  const[category,setCategory]=useState('');
  const[busy,setBusy]=useState(false);
  const showCat=!action||isBudget(action);
  const apply=async()=>{
    const u={needs_review:false};
    if(action)u.action=action;
    if(category&&showCat)u.category=category;
    setBusy(true);await onApply(u);setBusy(false);
  };
  return(
    <Window label="Edit selected" size="xs">
      <div className="c-wb">
        <div className="c-wh"><div><h3>Edit {count} transaction{count!==1?'s':''}</h3><span className="c-mut">Only the fields you set change. Every one is marked reviewed.</span></div></div>
        <label className="c-fld"><span>Type</span>
          <select className="c-sel" value={action} onChange={e=>setAction(e.target.value)}>
            <option value="">Keep as is</option>{TXN_TYPES.map(a=><option key={a}>{a}</option>)}
          </select>
        </label>
        {showCat&&<label className="c-fld"><span>Category</span>
          <select className="c-sel" value={category} onChange={e=>setCategory(e.target.value)}>
            <option value="">Keep as is</option><CategoryOptions categories={categories}/>
          </select>
        </label>}
        <div className="c-wf"><span/>
          <div className="c-row">
            <button type="button" className="c-btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="c-btn pri sm" onClick={apply} disabled={busy}>{busy?'Applying…':`Apply to ${count}`}</button>
          </div>
        </div>
      </div>
    </Window>
  );
}

/* Create rule (details footer): match text in the bank description, then
   set a display name, type and category on every match. */
export function TxnRuleWindow({t,categories,onClose,onCreated,toast}){
  const base=t.description_clean||t.description_raw||'';
  const[pattern,setPattern]=useState(base);
  const[desc,setDesc]=useState(base);
  const[action,setAction]=useState(t.action||'Expense');
  const[category,setCategory]=useState(t.category_final&&t.category_final!=='Unclassified'&&t.category_final!=='Multiple'?t.category_final:'');
  const[busy,setBusy]=useState(false);
  const save=async()=>{
    if(!pattern.trim())return;
    setBusy(true);
    try{
      const res=await apiFetch('/rules',{method:'POST',body:JSON.stringify({
        pattern:pattern.trim(),match_type:'contains',set_action:action||null,
        set_category:isBudget(action)&&category?category:null,set_description:desc.trim()||null,priority:100})});
      toast(`Rule created: ${res.reapplied?.updated??0} transactions updated`);
      await onCreated();
      onClose();
    }catch(e){toast('Failed to create rule: '+e.message,'error');}
    finally{setBusy(false);}
  };
  return(
    <Window label="Create rule" size="sm">
      <div className="c-wb">
        <div className="c-wh">
          <div><h3>Create rule</h3><span className="c-mut">Sorts future transactions that match</span></div>
          <button type="button" className="c-x" aria-label="Close" onClick={onClose}><CIcon name="x"/></button>
        </div>
        <div className="c-box"><span className="c-lbl">From transaction</span><code>{t.description_raw}</code></div>
        <label className="c-fld"><span>Match text</span>
          <input className="c-inp" value={pattern} onChange={e=>setPattern(e.target.value)} placeholder="e.g. STARBUCKS"/>
          <p className="tx-hint">Any transaction whose bank description contains this text matches.</p>
        </label>
        <label className="c-fld"><span>Display name</span>
          <input className="c-inp" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. Starbucks"/>
        </label>
        <div className="tx-rulef">
          <label className="c-fld"><span>Type</span>
            <select className="c-sel" value={action} onChange={e=>setAction(e.target.value)}>{TXN_TYPES.map(a=><option key={a}>{a}</option>)}</select>
          </label>
          {isBudget(action)&&<label className="c-fld"><span>Category</span>
            <select className="c-sel" value={category} onChange={e=>setCategory(e.target.value)}>
              <option value="">No category</option><CategoryOptions categories={categories}/>
            </select>
          </label>}
        </div>
        <div className="c-wf"><span/>
          <div className="c-row">
            <button type="button" className="c-btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="c-btn pri sm" onClick={save} disabled={busy||!pattern.trim()}>{busy?'Saving…':'Save rule'}</button>
          </div>
        </div>
      </div>
    </Window>
  );
}
