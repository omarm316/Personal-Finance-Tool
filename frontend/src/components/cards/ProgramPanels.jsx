/* The Ecosystem page's Redemption, Transfer and Between us forms, moved into
   side panels with today's fields (docs/cards-ledger-design.md, "Windows"),
   plus the starting balance and adjustment forms the page uses until the
   points ledger starts. Each closes only with its own buttons (house rule). */
import {useState,useEffect} from 'react';
import {apiFetch} from '../../lib/api';
import {SidePanel} from '../ui/SidePanel';
import {todayISO,f} from './CardsCommon';

const num=v=>{const t=String(v??'').replace(/[$,\s]/g,'').replace('−','-');if(t===''||t==='-')return NaN;const n=Number(t);return Number.isFinite(n)?n:NaN;};
function Foot({onCancel,onSave,busy,left,label='Save'}){
  return <>{left&&<span className="c-spf-l">{left}</span>}
    <button type="button" className="c-btn" onClick={onCancel}>Cancel</button>
    <button type="button" className="c-btn pri" disabled={busy} onClick={onSave}>{busy?'Saving…':label}</button></>;
}
function DeleteBtn({onDelete,busy}){
  const[c,setC]=useState(false);
  if(!onDelete)return null;
  return c?<span style={{display:'inline-flex',gap:6}}><button type="button" className="c-btn danger sm" disabled={busy} onClick={onDelete}>Delete it</button><button type="button" className="c-btn sm" onClick={()=>setC(false)}>Keep</button></span>
    :<button type="button" className="c-btn danger" onClick={()=>setC(true)}>Delete</button>;
}
function Person({people,value,onChange,label='Whose points',allowNone=true}){
  return(<div className="c-fld"><span>{label}</span>
    <div className="cds-seg" role="group" aria-label={label}>
      {allowNone&&<button type="button" className={!value?'on':''} onClick={()=>onChange('')}>Shared</button>}
      {people.map(p=><button type="button" key={p} className={value===p?'on':''} onClick={()=>onChange(p)}>{p}</button>)}
    </div></div>);
}
function usePanel(save,del,onSaved,toast){
  const[busy,setBusy]=useState(false);
  const run=fn=>async()=>{setBusy(true);try{const m=await fn();toast&&toast(m);onSaved();}catch(e){toast&&toast(e.message||'Could not save','error');setBusy(false);}};
  return{busy,save:run(save),del:del?run(del):null};
}

/* ── Redemption ─────────────────────────────────────────────────────────── */
export function RedemptionPanel({ecoId,ecoName,people,r,onClose,onSaved,toast}){
  const[v,setV]=useState({points_redeemed:r?.points_redeemed??'',redemption_date:r?.redemption_date||todayISO(),description:r?.description||'',
    cash_value_usd:r?.cash_value_usd??'',notes:r?.notes||'',person:r?.person||''});
  const set=(k,x)=>setV(o=>({...o,[k]:x}));
  const P=usePanel(async()=>{
    const pts=num(v.points_redeemed),cash=num(v.cash_value_usd);
    if(!v.description.trim())throw new Error('Say what it was for');
    if(!(pts>0)||!(cash>=0)||!v.redemption_date)throw new Error('Points, cash value and date are needed');
    const body={ecosystem_id:Number(ecoId),points_redeemed:pts,redemption_date:v.redemption_date,description:v.description.trim(),person:v.person||null,cash_value_usd:cash,notes:v.notes||null};
    if(r)await apiFetch(`/redemptions/${r.id}`,{method:'PATCH',body:JSON.stringify(body)});else await apiFetch('/redemptions',{method:'POST',body:JSON.stringify(body)});
    return r?'Redemption saved':'Redemption added';
  },r?async()=>{await apiFetch(`/redemptions/${r.id}`,{method:'DELETE'});return 'Redemption deleted';}:null,onSaved,toast);
  const pts=num(v.points_redeemed),cash=num(v.cash_value_usd);
  return(<SidePanel label={r?'Edit redemption':'Add redemption'} onClose={onClose}
    footer={<Foot onCancel={onClose} onSave={P.save} busy={P.busy} left={<DeleteBtn onDelete={P.del} busy={P.busy}/>}/>}>
    <p className="cds-mut">{ecoName} points spent on a flight, stay, statement credit or the like.</p>
    <label className="c-fld"><span>What it was for</span><input className="c-inp" value={v.description} onChange={e=>set('description',e.target.value)} placeholder="e.g. 3 nights, Park Hyatt Tokyo"/></label>
    {people.length>0&&<Person people={people} value={v.person} onChange={x=>set('person',x)}/>}
    <div className="cds-f2">
      <label className="c-fld"><span>Points redeemed</span><input className="c-inp" inputMode="numeric" value={v.points_redeemed} onChange={e=>set('points_redeemed',e.target.value)}/></label>
      <label className="c-fld"><span>Cash value realized ($)</span><input className="c-inp" inputMode="decimal" value={v.cash_value_usd} onChange={e=>set('cash_value_usd',e.target.value)}/></label>
    </div>
    {pts>0&&cash>=0&&<p className="cds-hint">That’s {(cash/pts*100).toFixed(2)}¢ per point, realized.</p>}
    <label className="c-fld"><span>Date</span><input type="date" className="c-inp" value={v.redemption_date} onChange={e=>set('redemption_date',e.target.value)}/></label>
    <label className="c-fld"><span>Note</span><input className="c-inp" value={v.notes} onChange={e=>set('notes',e.target.value)}/></label>
  </SidePanel>);
}

/* ── Transfer to or from another program ───────────────────────────────── */
export function TransferPanel({ecoId,ecoName,people,ecosystems,onClose,onSaved,toast}){
  const[v,setV]=useState({direction:'out',other:'',points_sent:'',ratio:'',bonus_pct:'',transfer_date:todayISO(),notes:'',person:'',to_person:''});
  const[ratios,setRatios]=useState([]);
  useEffect(()=>{apiFetch('/transfer-ratios').then(setRatios).catch(()=>{});},[]);
  const set=(k,x)=>setV(o=>({...o,[k]:x}));
  const src=v.direction==='out'?Number(ecoId):Number(v.other),dst=v.direction==='out'?Number(v.other):Number(ecoId);
  const onFile=ratios.find(r=>r.source_ecosystem_id===src&&r.destination_ecosystem_id===dst);
  useEffect(()=>{if(v.other&&onFile)set('ratio',String(onFile.base_ratio));},[v.other,v.direction,onFile?.id]);// eslint-disable-line react-hooks/exhaustive-deps
  const sent=num(v.points_sent),ratio=num(v.ratio),bonus=v.bonus_pct?num(v.bonus_pct)/100:0;
  const got=sent>0&&ratio>0?sent*ratio*(1+(bonus||0)):null;
  const P=usePanel(async()=>{
    if(!v.other||!(sent>0)||!(ratio>0)||!v.transfer_date)throw new Error('Program, points, ratio and date are needed');
    if(!onFile||onFile.base_ratio!==ratio)await apiFetch('/transfer-ratios',{method:'POST',body:JSON.stringify({source_ecosystem_id:src,destination_ecosystem_id:dst,base_ratio:ratio,effective_from:v.transfer_date})});
    await apiFetch('/transfers',{method:'POST',body:JSON.stringify({source_ecosystem_id:src,destination_ecosystem_id:dst,points_sent:sent,base_ratio_used:ratio,
      bonus_pct:bonus||null,points_received:got,transfer_date:v.transfer_date,notes:v.notes||null,person:v.person||null,to_person:v.to_person||null})});
    return 'Transfer added';
  },null,onSaved,toast);
  const otherList=(ecosystems||[]).filter(e=>e.id!==Number(ecoId)&&!e.is_cash_back).sort((a,b)=>a.name.localeCompare(b.name));
  return(<SidePanel label="Add transfer" onClose={onClose} footer={<Foot onCancel={onClose} onSave={P.save} busy={P.busy}/>}>
    <div className="c-fld"><span>Direction</span><div className="cds-seg" role="group" aria-label="Direction">
      <button type="button" className={v.direction==='out'?'on':''} onClick={()=>set('direction','out')}>Out of {ecoName}</button>
      <button type="button" className={v.direction==='in'?'on':''} onClick={()=>set('direction','in')}>Into {ecoName}</button></div></div>
    <label className="c-fld"><span>{v.direction==='out'?'To':'From'}</span>
      <select className="c-sel" value={v.other} onChange={e=>set('other',e.target.value)}><option value="">Pick a program…</option>
        {otherList.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <div className="cds-f3">
      <label className="c-fld"><span>Points sent</span><input className="c-inp" inputMode="numeric" value={v.points_sent} onChange={e=>set('points_sent',e.target.value)}/></label>
      <label className="c-fld"><span>Ratio</span><input className="c-inp" inputMode="decimal" placeholder="1" value={v.ratio} onChange={e=>set('ratio',e.target.value)}/></label>
      <label className="c-fld"><span>Bonus %</span><input className="c-inp" inputMode="decimal" placeholder="0" value={v.bonus_pct} onChange={e=>set('bonus_pct',e.target.value)}/></label>
    </div>
    {got!=null&&<p className="cds-hint">{f(got)} received{onFile&&onFile.base_ratio!==ratio?'. The new ratio is saved for this pair':''}.</p>}
    {people.length>0&&<div className="cds-f2">
      <label className="c-fld"><span>Sent by</span><select className="c-sel" value={v.person} onChange={e=>set('person',e.target.value)}><option value="">Shared</option>{people.map(p=><option key={p}>{p}</option>)}</select></label>
      <label className="c-fld"><span>Received by</span><select className="c-sel" value={v.to_person} onChange={e=>set('to_person',e.target.value)}><option value="">Same person</option>{people.map(p=><option key={p}>{p}</option>)}</select></label>
    </div>}
    <label className="c-fld"><span>Date</span><input type="date" className="c-inp" value={v.transfer_date} onChange={e=>set('transfer_date',e.target.value)}/></label>
    <label className="c-fld"><span>Note</span><input className="c-inp" value={v.notes} onChange={e=>set('notes',e.target.value)}/></label>
  </SidePanel>);
}

/* ── Between us (same program, one person to the other) ────────────────── */
export function BetweenPanel({ecoId,people,pt,onClose,onSaved,toast}){
  const[v,setV]=useState({from_person:pt?.from_person||people[0]||'',to_person:pt?.to_person||people[1]||'',points:pt?.points??'',transfer_date:pt?.transfer_date||todayISO(),notes:pt?.notes||''});
  const set=(k,x)=>setV(o=>({...o,[k]:x}));
  const P=usePanel(async()=>{
    const pts=num(v.points);
    if(!v.from_person||!v.to_person||v.from_person===v.to_person)throw new Error('Pick two different people');
    if(!(pts>0)||!v.transfer_date)throw new Error('Points and date are needed');
    const body={from_person:v.from_person,to_person:v.to_person,points:pts,transfer_date:v.transfer_date,notes:v.notes||null};
    if(pt)await apiFetch(`/person-transfers/${pt.id}`,{method:'PATCH',body:JSON.stringify(body)});else await apiFetch(`/ecosystems/${ecoId}/person-transfers`,{method:'POST',body:JSON.stringify(body)});
    return pt?'Transfer saved':'Transfer added';
  },pt?async()=>{await apiFetch(`/person-transfers/${pt.id}`,{method:'DELETE'});return 'Transfer deleted';}:null,onSaved,toast);
  return(<SidePanel label={pt?'Edit transfer between us':'Transfer between us'} onClose={onClose}
    footer={<Foot onCancel={onClose} onSave={P.save} busy={P.busy} left={<DeleteBtn onDelete={P.del} busy={P.busy}/>}/>}>
    <Person people={people} value={v.from_person} onChange={x=>setV(o=>({...o,from_person:x,to_person:o.to_person===x?(people.find(p=>p!==x)||''):o.to_person}))} label="From" allowNone={false}/>
    <Person people={people} value={v.to_person} onChange={x=>set('to_person',x)} label="To" allowNone={false}/>
    <div className="cds-f2">
      <label className="c-fld"><span>Points</span><input className="c-inp" inputMode="numeric" value={v.points} onChange={e=>set('points',e.target.value)}/></label>
      <label className="c-fld"><span>Date</span><input type="date" className="c-inp" value={v.transfer_date} onChange={e=>set('transfer_date',e.target.value)}/></label>
    </div>
    <label className="c-fld"><span>Note</span><input className="c-inp" value={v.notes} onChange={e=>set('notes',e.target.value)}/></label>
    <p className="cds-mut">Same program, so the total doesn’t change.</p>
  </SidePanel>);
}

/* ── Before the points ledger starts: starting balance and adjustments ─── */
export function StartingBalancePanel({ecoId,person,snap,suggest,onClose,onSaved,toast}){
  const[v,setV]=useState({balance:snap?.balance??(suggest??''),snapshot_date:snap?.snapshot_date||todayISO(),notes:snap?.notes||''});
  const set=(k,x)=>setV(o=>({...o,[k]:x}));
  const P=usePanel(async()=>{
    const b=num(v.balance);if(!Number.isFinite(b)||!v.snapshot_date)throw new Error('Balance and date are needed');
    const body={balance:b,snapshot_date:v.snapshot_date,notes:v.notes||null,person:person&&person!=='Shared'?person:null};
    if(snap)await apiFetch(`/balance-snapshots/${snap.id}`,{method:'PATCH',body:JSON.stringify(body)});else await apiFetch(`/ecosystems/${ecoId}/balance-snapshots`,{method:'POST',body:JSON.stringify(body)});
    return 'Starting balance saved';
  },snap?async()=>{await apiFetch(`/balance-snapshots/${snap.id}`,{method:'DELETE'});return 'Starting balance deleted';}:null,onSaved,toast);
  return(<SidePanel label={`${snap?'Edit':'Set'} ${person}’s starting balance`} onClose={onClose}
    footer={<Foot onCancel={onClose} onSave={P.save} busy={P.busy} left={<DeleteBtn onDelete={P.del} busy={P.busy}/>}/>}>
    <div className="cds-f2">
      <label className="c-fld"><span>Balance</span><input className="c-inp" inputMode="numeric" value={v.balance} onChange={e=>set('balance',e.target.value)}/></label>
      <label className="c-fld"><span>As of</span><input type="date" className="c-inp" value={v.snapshot_date} onChange={e=>set('snapshot_date',e.target.value)}/></label>
    </div>
    <label className="c-fld"><span>Note</span><input className="c-inp" value={v.notes} onChange={e=>set('notes',e.target.value)}/></label>
    <p className="cds-mut">Card points after this date are added to it. From Jan 1, 2027 the points ledger takes over, with its own opening balance.</p>
  </SidePanel>);
}
export function LegacyAdjustPanel({ecoId,people,a,onClose,onSaved,toast}){
  const[v,setV]=useState({points_delta:a?.points_delta??'',adjustment_date:a?.adjustment_date||todayISO(),description:a?.description||'',notes:a?.notes||'',person:a?.person||''});
  const set=(k,x)=>setV(o=>({...o,[k]:x}));
  const P=usePanel(async()=>{
    const d=num(v.points_delta);
    if(!v.description.trim())throw new Error('Say what it was');
    if(!Number.isFinite(d)||!v.adjustment_date)throw new Error('Points and date are needed');
    const body={points_delta:d,adjustment_date:v.adjustment_date,description:v.description.trim(),notes:v.notes||null,person:v.person||null};
    if(a)await apiFetch(`/points-adjustments/${a.id}`,{method:'PATCH',body:JSON.stringify(body)});else await apiFetch(`/ecosystems/${ecoId}/points-adjustments`,{method:'POST',body:JSON.stringify(body)});
    return a?'Adjustment saved':'Adjustment added';
  },a?async()=>{await apiFetch(`/points-adjustments/${a.id}`,{method:'DELETE'});return 'Adjustment deleted';}:null,onSaved,toast);
  return(<SidePanel label={a?'Edit adjustment':'Add adjustment'} onClose={onClose}
    footer={<Foot onCancel={onClose} onSave={P.save} busy={P.busy} left={<DeleteBtn onDelete={P.del} busy={P.busy}/>}/>}>
    {people.length>0&&<Person people={people} value={v.person} onChange={x=>set('person',x)}/>}
    <label className="c-fld"><span>What it was</span><input className="c-inp" value={v.description} onChange={e=>set('description',e.target.value)}/></label>
    <div className="cds-f2">
      <label className="c-fld"><span>Points</span><input className="c-inp" inputMode="numeric" placeholder="5000 or −2100" value={v.points_delta} onChange={e=>set('points_delta',e.target.value)}/></label>
      <label className="c-fld"><span>Date</span><input type="date" className="c-inp" value={v.adjustment_date} onChange={e=>set('adjustment_date',e.target.value)}/></label>
    </div>
    <label className="c-fld"><span>Note</span><input className="c-inp" value={v.notes} onChange={e=>set('notes',e.target.value)}/></label>
  </SidePanel>);
}
