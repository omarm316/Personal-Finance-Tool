import React,{memo,useEffect,useRef,useState} from 'react';
import {CategoryOptions} from './CategoryOptions';
import {CategoryList} from './ui/CategoryList';
import {CIcon} from './ui/CIcon';
import {Popover} from './ui/Popover';
import {TXN_TYPES} from '../lib/constants';
import {topLevelOf} from '../lib/categories';
import {amtClass,isBudget,lowConfidence,numDate,showReviewBtn,signed,SRC_LABEL} from '../lib/txnView';

/* Columns: checkbox, date, description, type, category, account, amount, actions */
export const LEDGER_COLUMNS='max-content 58px minmax(120px,1.6fr) max-content minmax(60px,1.2fr) minmax(60px,1fr) max-content max-content';

const typeOf=t=>t.action_display||t.action;
const nameOf=t=>t.description_display||t.description_raw||'';

function CatPill({name,manual}){
  if(!name||name==='Unclassified')return <span className="pill" style={{opacity:.75}}>Unclassified</span>;
  const top=topLevelOf(name);
  return <span className="pill" title={top&&top!==name?`${top} › ${name}`:name}>
    {top&&top!==name&&<span className="pp">{top} › </span>}{name}{manual&&<span className="pen">✎</span>}
  </span>;
}

/* The always-shown row buttons and status chips */
function RowActions({t,onAct}){
  return <div className="ra">
    <span className="rv">{showReviewBtn(t)&&<button type="button" className="c-btn pri sm" onClick={()=>onAct('review',t)}>Review</button>}</span>
    {t.is_gcb&&<span className="ch gold" title="GCB">⭐</span>}
    {t.is_excluded&&<span className="ch bad" title="Excluded from every total">⊘</span>}
    {t.is_locked&&<span className="ch" title="Locked: sync and rules leave it alone">🔒</span>}
    <button type="button" className="c-ib" title="Details" aria-label="Details" onClick={()=>onAct('open',t)}><CIcon name="info" size={15}/></button>
    <button type="button" className="c-ib" title="Edit" aria-label="Edit" onClick={()=>onAct('edit',t)}><CIcon name="edit" size={15}/></button>
    <button type="button" className="c-ib" title={t.is_split?'Splits':'Split'} aria-label={t.is_split?'Splits':'Split'} onClick={()=>onAct('split',t)}><CIcon name="split" size={15}/></button>
  </div>;
}

function LedgerRowInner({t,zebra,selected,expanded,editing,categories,onAct}){
  const typeBtn=useRef(null),catBtn=useRef(null);
  const[pop,setPop]=useState(null);              // 'type' | 'cat'
  const[draft,setDraft]=useState(null);          // edit draft {name,action,category}
  const[saving,setSaving]=useState(false);
  const[rulePrompt,setRulePrompt]=useState(false);
  const[ruleBusy,setRuleBusy]=useState(false);
  const shownName=t.description_clean||t.description_display||t.description_raw||'';
  /* The draft starts from the row the moment editing starts (same frame) */
  const d=editing?(draft||{name:shownName,action:t.action,category:t.category_final}):null;
  useEffect(()=>{if(!editing)setDraft(null);},[editing]);

  const split=!!t.is_split;
  const ty=typeOf(t);
  const clickable=e=>!e.target.closest('button,input,select,label,a,textarea');
  const open=e=>{if(!editing&&clickable(e))onAct('open',t);};
  const key=e=>{if(e.target===e.currentTarget&&!editing&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onAct('open',t);}};

  const save=async()=>{
    const updates={category:isBudget(d.action)?d.category:'',action:d.action,needs_review:false};
    if(d.name!==shownName)updates.description_clean=d.name;
    setSaving(true);
    const ok=await onAct('saveEdit',t,updates);
    setSaving(false);
    if(!ok)return;
    onAct('cancel',t);
    /* Offer a merchant rule when the enrichment came from AI or an override */
    const ai=t.enrichment_source==='llm'||t.enrichment_source==='override';
    if(ai&&isBudget(d.action)&&d.category&&d.category!=='Unclassified')setRulePrompt(true);
  };
  const createRule=async()=>{setRuleBusy(true);await onAct('ruleFromTxn',t);setRuleBusy(false);setRulePrompt(false);};

  const cls=['tx-tr',zebra?'z':'',selected?'sel':'',editing?'ed':''].join(' ');
  return(<>
    <div className={cls} tabIndex={0} onClick={open} onKeyDown={key} aria-label={`${nameOf(t)}, ${signed(t.amount)}`}>
      <div className="td c-chkc">
        <input type="checkbox" className="rchk" checked={!!selected} onChange={()=>onAct('sel',t)} aria-label={`Select ${nameOf(t)}`}/>
      </div>
      <div className="td"><span className="dte">
        {split&&<button type="button" className={`car ${expanded?'on':''}`} aria-expanded={expanded} aria-label={`Show the ${(t.splits||[]).length} parts`} onClick={()=>onAct('exp',t)}>▸</button>}
        {numDate(t.date)}
      </span></div>
      <div className="td c-name">
        {d
          ?<input className="c-inp" value={d.name} onChange={e=>setDraft({...d,name:e.target.value})} aria-label="Display name" placeholder="Display name"/>
          :<div className="nl">
            <span className="nm" title={t.description_raw}>{nameOf(t)}</span>
            <span className="fl-u">
              {lowConfidence(t)&&<span className="conf">{Math.round(t.category_confidence*100)}% AI CONFIDENCE</span>}
              {SRC_LABEL[t.enrichment_source]&&<span className={`src s-${t.enrichment_source}`}>{SRC_LABEL[t.enrichment_source]}</span>}
            </span>
          </div>}
      </div>
      <div className="td c-type">
        {d
          ?<select className="c-sel" value={d.action} aria-label="Type" onChange={e=>{const a=e.target.value;setDraft({...d,action:a,category:isBudget(a)?d.category:''});}}>
            {TXN_TYPES.map(a=><option key={a}>{a}</option>)}
          </select>
          :split
            ?<span className="tt" title={ty==='Multiple'?'The parts have different types':'Change the type in the splits'}>{ty}</span>
            :<button type="button" ref={typeBtn} className="cbtn" title="Change type" aria-haspopup="menu" aria-expanded={pop==='type'} onClick={()=>setPop(pop==='type'?null:'type')}>
              <span className="tt">{ty}</span><CIcon name="down" size={11}/>
            </button>}
      </div>
      <div className="td c-cat">
        {d
          ?(isBudget(d.action)
            ?<select className="c-sel" value={d.category||''} aria-label="Category" onChange={e=>setDraft({...d,category:e.target.value})}>
              <option value="">Unclassified</option>
              <CategoryOptions categories={categories}/>
            </select>
            :<span className="c-mut">—</span>)
          :!isBudget(ty)
            ?<span className="c-mut">—</span>
            :split||t.category_final==='Multiple'
              ?<span title="Change the category in the splits"><CatPill name={t.category_final}/></span>
              :<button type="button" ref={catBtn} className="cbtn" title="Change category" aria-haspopup="dialog" aria-expanded={pop==='cat'} onClick={()=>setPop(pop==='cat'?null:'cat')}>
                <CatPill name={t.category_final} manual={!!t.category_manual}/><CIcon name="down" size={11}/>
              </button>}
      </div>
      <div className="td c-acct"><span className="acct" title={t.account_name}>{t.account_name}</span></div>
      <div className="td r"><span className={`amt ${amtClass(t)}`}>{signed(t.amount)}</span></div>
      <div className="td r">
        {editing
          ?<div className="ra">
            <button type="button" className="c-btn pri sm" onClick={save} disabled={saving}>{saving?'…':'Save'}</button>
            <button type="button" className="c-btn ghost sm" aria-label="Cancel" onClick={()=>onAct('cancel',t)}>✕</button>
          </div>
          :rulePrompt
            ?<div className="ra">
              <span className="rprompt">NEW RULE?</span>
              <button type="button" className="c-btn pri sm" onClick={createRule} disabled={ruleBusy}>{ruleBusy?'…':'Create'}</button>
              <button type="button" className="c-btn ghost sm" onClick={()=>setRulePrompt(false)}>No</button>
            </div>
            :<RowActions t={t} onAct={onAct}/>}
      </div>
    </div>
    {expanded&&split&&(t.splits||[]).map(s=>(
      <div key={`s${s.id}`} className="spr">
        <span className="c-mut">↳</span>
        <span>{s.description||<i className="c-mut">No note</i>}</span>
        <span>{isBudget(s.action||'Expense')&&s.category?<CatPill name={s.category}/>:<span className="c-mut">{s.action||'—'}</span>}</span>
        <span className="amt">{signed(s.amount)}</span>
      </div>
    ))}
    {pop==='type'&&<Popover anchor={typeBtn.current} onClose={()=>setPop(null)}>
      <div className="c-pop c-menu" role="menu" aria-label={`Type for ${nameOf(t)}`}>
        {TXN_TYPES.map(a=><button key={a} type="button" role="menuitem" className={`c-mi ${t.action===a?'on':''}`} data-autofocus={t.action===a||undefined}
          onClick={()=>{setPop(null);if(a!==t.action)onAct('saveType',t,a);}}>{a}</button>)}
      </div>
    </Popover>}
    {pop==='cat'&&<Popover anchor={catBtn.current} onClose={()=>setPop(null)}>
      <div className="c-pop tx-cpop" role="dialog" aria-label={`Category for ${nameOf(t)}`}>
        <span className="c-lbl">Category for {nameOf(t)}</span>
        <CategoryList categories={categories} value={t.category_final} onPick={c=>{setPop(null);if(c!==t.category_final||!t.category_manual)onAct('saveCat',t,c);}}/>
      </div>
    </Popover>}
  </>);
}

export const LedgerRow=memo(LedgerRowInner);

/* A hidden row holding the widest content the fitted columns need for the
   rows shown (type, amount, status chips), so widths don't shift as more
   rows load or a row is edited. */
export function SizerRow({widestType,widestAmount,chips}){
  return <div className="tx-tr sizer" aria-hidden="true">
    <div className="td c-chkc"><input type="checkbox" className="rchk" tabIndex={-1} readOnly/></div>
    <div className="td"/>
    <div className="td"/>
    <div className="td c-type"><span className="cbtn"><span className="tt">{widestType}</span><CIcon name="down" size={11}/></span><select className="c-sel" style={{width:112,height:0,padding:0,border:0,display:'block'}} tabIndex={-1}/></div>
    <div className="td"/>
    <div className="td"/>
    <div className="td r"><span className="amt">{widestAmount}</span></div>
    <div className="td r"><div className="ra"><span className="rv"/>{Array.from({length:chips},(_,i)=><span key={i} className="ch">⭐</span>)}<span className="c-ib"/><span className="c-ib"/><span className="c-ib"/></div></div>
  </div>;
}
