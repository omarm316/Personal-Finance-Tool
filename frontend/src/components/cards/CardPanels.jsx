/* The small flows behind the Card page's ⋯ menu, as side panels (the benefit
   editing pattern; designed while building Cards step 5): Change product,
   Product history, Edit card details, Add or edit a challenge and Mark card
   as closed. Each closes only with its own buttons (house rule). */
import {useState,useEffect,useMemo} from 'react';
import {apiFetch} from '../../lib/api';
import {SidePanel} from '../ui/SidePanel';
import {mdy,todayISO,usd0} from './CardsCommon';

const longDate=s=>s?new Date(s.slice(0,10)+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';
const num=v=>{const t=String(v??'').replace(/[$,\s]/g,'');if(t==='')return null;const n=Number(t);return Number.isFinite(n)?n:NaN;};
function Foot({onCancel,onSave,busy,label='Save',left,danger}){
  return <>{left&&<span className="c-spf-l">{left}</span>}
    <button type="button" className="c-btn" onClick={onCancel}>Cancel</button>
    <button type="button" className={`c-btn ${danger?'danger':'pri'}`} disabled={busy} onClick={onSave}>{busy?'Saving…':label}</button></>;
}

/* ── Change product ─────────────────────────────────────────────────────── */
export function ChangeProductPanel({card,product,products,onClose,onSaved,toast}){
  const[pid,setPid]=useState('');
  const[day,setDay]=useState(todayISO());
  const[busy,setBusy]=useState(false);
  const list=useMemo(()=>[...products].filter(p=>p.id!==product?.id).sort((a,b)=>(a.card_name||'').localeCompare(b.card_name||'')),[products,product]);
  const save=async()=>{
    if(!pid){toast('Pick the new product','error');return;}
    setBusy(true);
    try{const r=await apiFetch(`/cards/${card.id}/change-product`,{method:'POST',body:JSON.stringify({product_id:Number(pid),effective_date:day})});
      toast(`Changed to ${r.new_product_name}`);onSaved();}
    catch(e){toast(e.message||'Could not change the product','error');setBusy(false);}
  };
  return(<SidePanel label={product?'Change product':'Link a product'} onClose={onClose} footer={<Foot onCancel={onClose} onSave={save} busy={busy} label={product?'Change product':'Link product'}/>}>
    {product&&<div className="cds-box"><span>Now</span><b>{product.card_name}</b></div>}
    <label className="c-fld"><span>New product</span>
      <select className="c-sel" value={pid} onChange={e=>setPid(e.target.value)} data-autofocus>
        <option value="">Pick a product…</option>
        {list.map(p=><option key={p.id} value={p.id}>{p.card_name}</option>)}</select></label>
    <label className="c-fld"><span>From</span><input type="date" className="c-inp" value={day} onChange={e=>setDay(e.target.value)}/></label>
    <p className="cds-mut">Charges before this date keep the points they earned. Charges from this date earn at the new product’s rates, and the card shows the new product’s benefits.</p>
  </SidePanel>);
}

/* ── Product history ────────────────────────────────────────────────────── */
export function ProductHistoryPanel({card,onClose,onChange}){
  const[rows,setRows]=useState(null);
  useEffect(()=>{apiFetch(`/cards/${card.id}/product-history`).then(setRows).catch(()=>setRows([]));},[card.id]);
  return(<SidePanel label="Product history" onClose={onClose} footer={<>
    <span className="c-spf-l"><button type="button" className="c-btn" onClick={onChange}>Change product…</button></span>
    <button type="button" className="c-btn pri" onClick={onClose}>Done</button></>}>
    {!rows?<p className="cds-mut">Loading…</p>
    :!rows.length?<p className="cds-mut">No product changes recorded for this card.</p>
    :<ul className="cds-hist">{[...rows].reverse().map(h=>(
      <li key={h.id} className={h.is_current?'cur':''}><i aria-hidden="true"/>
        <span><b>{h.product_name||'Unknown product'}</b>
          <small>{longDate(h.effective_from)} to {h.is_current?'today':longDate(h.effective_to)}</small></span></li>))}</ul>}
    <p className="cds-mut">Each charge keeps the points of the product it was made on.</p>
  </SidePanel>);
}

/* ── Edit card details ──────────────────────────────────────────────────── */
export function EditCardPanel({card,account,people,onClose,onSaved,toast}){
  const[v,setV]=useState({
    card_name:card.card_name||'',last_four:card.last_four!=null?String(card.last_four).padStart(4,'0'):'',
    primary_user:card.primary_user||'',issue_date:card.issue_date?card.issue_date.slice(0,10):'',
    annual_fee:card.annual_fee??'',credit_limit:card.credit_limit??'',
    statement_close_day:card.statement_close_day??'',payment_due_day:card.payment_due_day??'',notes:card.notes||'',
  });
  const[busy,setBusy]=useState(false);
  const[newOwner,setNewOwner]=useState(false);
  const set=(k,x)=>setV(o=>({...o,[k]:x}));
  const save=async()=>{
    const day=k=>{const n=num(v[k]);return n==null?null:n;};
    for(const k of ['statement_close_day','payment_due_day']){const n=day(k);if(n!=null&&(!Number.isInteger(n)||n<1||n>31)){toast('Days are 1 to 31','error');return;}}
    for(const k of ['annual_fee','credit_limit']){if(Number.isNaN(num(v[k]))){toast('Amounts are numbers','error');return;}}
    if(v.last_four&&!/^\d{4}$/.test(v.last_four)){toast('Last four is four digits','error');return;}
    setBusy(true);
    try{await apiFetch(`/cards/${card.id}`,{method:'PATCH',body:JSON.stringify({
      card_name:v.card_name.trim()||null,last_four:v.last_four?parseInt(v.last_four,10):null,primary_user:v.primary_user||null,
      issue_date:v.issue_date||null,annual_fee:num(v.annual_fee),credit_limit:num(v.credit_limit),
      statement_close_day:day('statement_close_day'),payment_due_day:day('payment_due_day'),notes:v.notes})});
      toast('Card details saved');onSaved();}
    catch(e){toast(e.message||'Could not save','error');setBusy(false);}
  };
  const owners=[...new Set([...(people||[]),v.primary_user].filter(Boolean))];
  return(<SidePanel label="Edit card details" onClose={onClose} footer={<Foot onCancel={onClose} onSave={save} busy={busy}/>}>
    <div className="cds-f2">
      <label className="c-fld"><span>Card name</span><input className="c-inp" value={v.card_name} onChange={e=>set('card_name',e.target.value)} data-autofocus/></label>
      <label className="c-fld"><span>Last four</span><input className="c-inp" inputMode="numeric" maxLength={4} value={v.last_four} onChange={e=>set('last_four',e.target.value.replace(/\D/g,''))}/></label>
    </div>
    <label className="c-fld"><span>Cardholder</span>
      {newOwner
        ?<input className="c-inp" autoFocus placeholder="Name" value={v.primary_user} onChange={e=>set('primary_user',e.target.value)}/>
        :<select className="c-sel" value={v.primary_user} onChange={e=>{if(e.target.value==='__new'){set('primary_user','');setNewOwner(true);}else set('primary_user',e.target.value);}}>
          <option value="">No owner</option>{owners.map(p=><option key={p} value={p}>{p}</option>)}<option value="__new">Add a name…</option></select>}
    </label>
    <p className="cds-hint">Points with no spender on the charge count toward the cardholder.</p>
    <div className="cds-f2">
      <label className="c-fld"><span>Opened on</span><input type="date" className="c-inp" value={v.issue_date} onChange={e=>set('issue_date',e.target.value)}/></label>
      <label className="c-fld"><span>Annual fee</span><input className="c-inp" inputMode="decimal" value={v.annual_fee} onChange={e=>set('annual_fee',e.target.value)}/></label>
    </div>
    <p className="cds-hint">The fee posts each year on the opening date; card-year credits reset on it too.</p>
    <div className="cds-f3">
      <label className="c-fld"><span>Credit limit</span><input className="c-inp" inputMode="decimal" value={v.credit_limit} onChange={e=>set('credit_limit',e.target.value)}/></label>
      <label className="c-fld"><span>Statement closes</span><input className="c-inp" inputMode="numeric" placeholder="Day" value={v.statement_close_day} onChange={e=>set('statement_close_day',e.target.value)}/></label>
      <label className="c-fld"><span>Payment due</span><input className="c-inp" inputMode="numeric" placeholder="Day" value={v.payment_due_day} onChange={e=>set('payment_due_day',e.target.value)}/></label>
    </div>
    <label className="c-fld"><span>Notes</span><textarea className="c-inp" rows={3} value={v.notes} onChange={e=>set('notes',e.target.value)}/></label>
    {account&&<p className="cds-mut">Bank account: {account.name}{account.mask?` ${account.mask}`:''}</p>}
  </SidePanel>);
}

/* ── Mark card as closed ────────────────────────────────────────────────── */
export function CloseCardPanel({card,name,onClose,onSaved,toast}){
  const[day,setDay]=useState(todayISO());
  const[busy,setBusy]=useState(false);
  const save=async()=>{
    setBusy(true);
    try{await apiFetch(`/cards/${card.id}`,{method:'PATCH',body:JSON.stringify({is_active:false,close_date:day})});
      toast(`${name} marked as closed`);onSaved();}
    catch(e){toast(e.message||'Could not close it','error');setBusy(false);}
  };
  return(<SidePanel label="Mark card as closed" onClose={onClose} footer={<Foot onCancel={onClose} onSave={save} busy={busy} label="Mark as closed" danger/>}>
    <div className="cds-box bad"><b>{name}</b><span>It leaves Portfolio, its program’s page and the Actions strip, and its credits and challenges stop counting.</span></div>
    <label className="c-fld"><span>Closed on</span><input type="date" className="c-inp" value={day} onChange={e=>setDay(e.target.value)} data-autofocus/></label>
    <p className="cds-mut">Its transactions, points and history stay as they are, and Card Management can reopen it (Show inactive, then Reopen).</p>
  </SidePanel>);
}

/* ── Add or edit a challenge ────────────────────────────────────────────── */
const TYPES=[['sub','Sign-up bonus'],['threshold_bonus','Spend $X, earn a bonus rate'],['rate_cap','Bonus rate up to a spend cap'],
  ['category_rate_cap','Category bonus up to a cap (rotating)'],['annual_threshold','Yearly spend threshold (e.g. free night)']];
const BONUS=[['flat','Points'],['per_dollar','Points per dollar'],['statement_credit','Statement credit'],['benefit','A reward (free night, status)']];
export function ChallengePanel({ch,cardId,cards,categories,people,onClose,onSaved,onShowTxns,toast}){
  const isNew=!ch?.id;
  const[v,setV]=useState(()=>ch?.id?{
    card_id:ch.card_id,name:ch.name,challenge_type:ch.challenge_type,start_date:ch.start_date,end_date:ch.end_date,activation_date:ch.activation_date||'',
    bonus_type:ch.bonus_type,bonus_amount:ch.bonus_amount??'',spend_cap:ch.spend_cap??'',spend_threshold:ch.spend_threshold??'',
    spender_filter:ch.spender_filter||'',max_occurrences:ch.max_occurrences||'',category_names:ch.category_names||[],
    additional_card_ids:ch.additional_card_ids||[],notes:ch.notes||''}
    :{card_id:cardId||'',name:'',challenge_type:'sub',start_date:todayISO(),end_date:'',activation_date:'',bonus_type:'flat',bonus_amount:'',
      spend_cap:'',spend_threshold:'',spender_filter:'',max_occurrences:'',category_names:[],additional_card_ids:[],notes:''});
  const[busy,setBusy]=useState(false);
  const[confirm,setConfirm]=useState(false);
  const set=(k,x)=>setV(o=>({...o,[k]:x}));
  const capT=['rate_cap','category_rate_cap'].includes(v.challenge_type);
  const thrT=['threshold_bonus','sub','annual_threshold'].includes(v.challenge_type);
  const amtLbl={flat:'Bonus points',per_dollar:'Extra points per dollar',statement_credit:'Credit amount ($)',benefit:'How many rewards'}[v.bonus_type];
  const toggle=(k,x)=>set(k,(v[k]||[]).includes(x)?v[k].filter(y=>y!==x):[...(v[k]||[]),x]);
  const save=async()=>{
    if(!v.card_id){toast('Pick the card','error');return;}
    if(!v.name.trim()||!v.start_date||!v.end_date||v.bonus_amount===''){toast('Name, dates and the bonus are needed','error');return;}
    if(v.end_date<v.start_date){toast('The end date is before the start','error');return;}
    setBusy(true);
    const body={card_id:Number(v.card_id),name:v.name.trim(),challenge_type:v.challenge_type,start_date:v.start_date,end_date:v.end_date,
      activation_date:v.activation_date||null,bonus_type:v.bonus_type,bonus_amount:Number(v.bonus_amount),
      spend_cap:capT&&v.spend_cap!==''?Number(v.spend_cap):null,spend_threshold:thrT&&v.spend_threshold!==''?Number(v.spend_threshold):null,
      spender_filter:v.spender_filter||null,max_occurrences:thrT&&v.max_occurrences?parseInt(v.max_occurrences,10):null,
      category_names:v.category_names,additional_card_ids:v.additional_card_ids.map(Number),is_active:true,notes:v.notes||null};
    try{
      if(isNew)await apiFetch('/challenges',{method:'POST',body:JSON.stringify(body)});
      else await apiFetch(`/challenges/${ch.id}`,{method:'PATCH',body:JSON.stringify(body)});
      toast(isNew?'Challenge added':'Challenge saved');onSaved();
    }catch(e){toast(e.message||'Could not save','error');setBusy(false);}
  };
  const del=async()=>{
    setBusy(true);
    try{await apiFetch(`/challenges/${ch.id}`,{method:'DELETE'});toast('Challenge deleted');onSaved();}
    catch(e){toast(e.message||'Could not delete','error');setBusy(false);}
  };
  const others=(cards||[]).filter(c=>c.card_id&&c.card_id!==Number(v.card_id));
  const left=!isNew&&(confirm
    ?<span style={{display:'inline-flex',gap:6,alignItems:'center'}}><button type="button" className="c-btn danger sm" onClick={del}>Delete it</button><button type="button" className="c-btn sm" onClick={()=>setConfirm(false)}>Keep</button></span>
    :<button type="button" className="c-btn danger" onClick={()=>setConfirm(true)}>Delete</button>);
  return(<SidePanel label={isNew?'Add a challenge':'Edit challenge'} onClose={onClose} footer={<Foot onCancel={onClose} onSave={save} busy={busy} left={left} label={isNew?'Add challenge':'Save'}/>}>
    {!isNew&&ch.progress_target!=null&&<div className="cds-box"><span>{isDoneText(ch)}</span>
      {onShowTxns&&<button type="button" className="c-lnk" style={{justifySelf:'start'}} onClick={()=>onShowTxns(ch)}>Show its transactions</button>}</div>}
    {!cardId&&<label className="c-fld"><span>Card</span>
      <select className="c-sel" value={v.card_id} onChange={e=>set('card_id',e.target.value)} data-autofocus>
        <option value="">Pick a card…</option>{(cards||[]).filter(c=>c.card_id).map(c=><option key={c.card_id} value={c.card_id}>{c.name} {c.mask}{c.owner?` · ${c.owner}`:''}</option>)}</select></label>}
    <label className="c-fld"><span>Name</span><input className="c-inp" value={v.name} placeholder="e.g. Sign-up bonus, Q1 5x groceries" onChange={e=>set('name',e.target.value)} data-autofocus={cardId?true:undefined}/></label>
    <label className="c-fld"><span>Kind</span>
      <select className="c-sel" value={v.challenge_type} onChange={e=>{const t=e.target.value;setV(o=>({...o,challenge_type:t,bonus_type:['sub','annual_threshold'].includes(t)?(o.bonus_type==='per_dollar'?'flat':o.bonus_type):'per_dollar'}));}}>
        {TYPES.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
    <div className="cds-f3">
      <label className="c-fld"><span>Starts</span><input type="date" className="c-inp" value={v.start_date} onChange={e=>set('start_date',e.target.value)}/></label>
      <label className="c-fld"><span>Ends</span><input type="date" className="c-inp" value={v.end_date} onChange={e=>set('end_date',e.target.value)}/></label>
      <label className="c-fld"><span>Activated</span><input type="date" className="c-inp" value={v.activation_date} onChange={e=>set('activation_date',e.target.value)}/></label>
    </div>
    <p className="cds-hint">Spend counts from the later of the start and activation dates.</p>
    <div className="cds-f2">
      <label className="c-fld"><span>Bonus</span><select className="c-sel" value={v.bonus_type} onChange={e=>set('bonus_type',e.target.value)}>
        {BONUS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
      <label className="c-fld"><span>{amtLbl}</span><input className="c-inp" inputMode="decimal" value={v.bonus_amount} onChange={e=>set('bonus_amount',e.target.value)}/></label>
    </div>
    {capT&&<label className="c-fld"><span>Spend cap ($)</span><input className="c-inp" inputMode="decimal" value={v.spend_cap} onChange={e=>set('spend_cap',e.target.value)}/></label>}
    {thrT&&<div className="cds-f2">
      <label className="c-fld"><span>Spend to reach ($)</span><input className="c-inp" inputMode="decimal" value={v.spend_threshold} onChange={e=>set('spend_threshold',e.target.value)}/></label>
      <label className="c-fld"><span>Repeats up to</span><input className="c-inp" inputMode="numeric" placeholder="Once" value={v.max_occurrences} onChange={e=>set('max_occurrences',e.target.value)}/></label>
    </div>}
    <div className="c-fld"><span>Counts only these categories</span>
      <div className="cds-checks">{(categories||[]).map(pc=>(
        <label key={pc.id} className={pc.parent_key?'kid':''}><input type="checkbox" checked={v.category_names.includes(pc.name)} onChange={()=>toggle('category_names',pc.name)}/>{pc.name}</label>))}</div></div>
    <p className="cds-hint">Leave them all unticked to count every purchase.</p>
    {others.length>0&&<div className="c-fld"><span>Also counts on</span>
      <div className="cds-checks">{others.map(c=>(
        <label key={c.card_id}><input type="checkbox" checked={v.additional_card_ids.map(Number).includes(c.card_id)} onChange={()=>toggle('additional_card_ids',c.card_id)}/>{c.name} {c.mask}</label>))}</div></div>}
    <label className="c-fld"><span>Only spend by</span>
      <select className="c-sel" value={v.spender_filter} onChange={e=>set('spender_filter',e.target.value)}>
        <option value="">Anyone</option>{[...new Set([...(people||[]),v.spender_filter].filter(Boolean))].map(p=><option key={p} value={p}>{p}</option>)}</select></label>
    <label className="c-fld"><span>Notes</span><input className="c-inp" value={v.notes} onChange={e=>set('notes',e.target.value)}/></label>
  </SidePanel>);
}
function isDoneText(ch){
  const spent=ch.lap_spend??ch.current_spend??0;
  if(!ch.remaining_spend)return `${usd0(spent)} of ${usd0(ch.progress_target)}, done`;
  return `${usd0(spent)} of ${usd0(ch.progress_target)} spent, ${usd0(ch.remaining_spend)} to go by ${mdy(ch.end_date)}`;
}
