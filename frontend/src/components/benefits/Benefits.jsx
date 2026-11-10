/* Card benefits (docs/cards-card-design.md, "Benefits", "Expiring credits"
   and "Log credit use"): the Benefits panel with per-period dots and period
   detail, the Expiring credits row with Mark used and Undo, the edit side
   panel and the two-step Log credit use window. Data comes from
   /api/cards/{id}/benefits (core/benefits.py). Windows and panels close only
   with their buttons (house rule). */
import {useState,useEffect,useCallback,useRef} from 'react';
import {apiFetch} from '../../lib/api';
import {SidePanel} from '../ui/SidePanel';
import {Window} from '../ui/Window';
import {Popover} from '../ui/Popover';
import '../../styles/cloud.css';
import './benefits.css';

const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const mo=n=>{const r=Math.round((n||0)*100)/100;return '$'+(r%1?r.toFixed(2):r.toLocaleString('en-US'));};
const m0=n=>'$'+Math.round(n||0).toLocaleString('en-US');
const dt=s=>{if(!s)return '';const[,m,d]=s.split('-');return `${MON[Number(m)-1]} ${Number(d)}`;};
const md=s=>{const[,m,d]=s.split('-');return `${Number(m)}/${Number(d)}`;};
const CAD={monthly:'a month',quarterly:'a quarter',semiannual:'each half year',annual:'a year',per_use:'per use'};
const cadText=x=>x.cadence==='multi_year'?`every ${x.every_years||4} years`:CAD[x.cadence]||'';
const cadLine=x=>`${mo(x.amount)} ${cadText(x)}${x.year_type==='card'?', card year':''}`;
const RESETS=[['monthly','Monthly'],['quarterly','Quarterly'],['semiannual','Twice a year'],['annual','Yearly'],['multi_year','Every few years'],['per_use','Per use']];
const periodic=x=>x.periods&&x.periods.length>0;
const cur=x=>periodic(x)?x.periods.findIndex(p=>p.state==='current'):-1;
const minDate=(a,b)=>a<b?a:b;
const UNDO_MS=5000;

/* ── Data ─────────────────────────────────────────────────────────────── */
export function useCardBenefits(cardId,{toast,reloadKey}={}){
  const[B,setB]=useState(null);
  const load=useCallback(async()=>{
    if(!cardId){setB(null);return;}
    try{setB(await apiFetch(`/cards/${cardId}/benefits`));}
    catch(e){toast&&toast('Failed to load benefits','error');}
  },[cardId]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{load();},[load,reloadKey]);
  return{B,setB,load};
}

/* ── Expiring credits ─────────────────────────────────────────────────── */
function Ring({days,span}){
  const r=20,C=2*Math.PI*r,pc=Math.max(0,Math.min(1,days/(span||1)));
  return(<svg className="bnf-ring" viewBox="0 0 50 50" aria-hidden="true">
    <circle cx="25" cy="25" r={r} fill="none" stroke="var(--c-line)" strokeWidth="4.5"/>
    <circle cx="25" cy="25" r={r} fill="none" stroke="var(--uc)" strokeWidth="4.5" strokeLinecap="round"
      strokeDasharray={`${C*pc} ${C}`} transform="rotate(-90 25 25)"/>
    <text x="25" y="29" textAnchor="middle" fill="var(--c-tx)" fontSize="12" fontWeight="600">{days}d</text>
  </svg>);
}

export function ExpiringCredits({B,setB,cardId,toast,onToBenefits,max=4}){
  const[marked,setMarked]=useState({});      // benefit_id -> {useId}, during the 5 seconds of Undo
  const[gone,setGone]=useState({});          // marked and timed out, until the reload lands
  const[didMark,setDidMark]=useState(false);
  const timers=useRef({});
  const latest=useRef(null);
  useEffect(()=>()=>Object.values(timers.current).forEach(clearTimeout),[]);
  if(!B)return null;
  const E=B.expiring,win=E.window;
  const items=E.items.filter(x=>!gone[x.benefit_id]);
  const urg=d=>d<=14?'u-hi':d<=30?'u-md':'u-lo';
  const mark=async x=>{
    if(marked[x.benefit_id])return;
    try{
      const r=await apiFetch(`/cards/${cardId}/benefits/${x.benefit_id}/mark-used`,{method:'POST',body:JSON.stringify({})});
      latest.current=r.benefits;
      setMarked(m=>({...m,[x.benefit_id]:{useId:r.use_id}}));
      timers.current[x.benefit_id]=setTimeout(()=>{
        delete timers.current[x.benefit_id];
        setDidMark(true);
        setMarked(m=>{const n={...m};delete n[x.benefit_id];return n;});
        setGone(g=>({...g,[x.benefit_id]:true}));
        // Reload once no other card is still inside its Undo time.
        if(!Object.keys(timers.current).length&&latest.current){setB(latest.current);setGone({});}
      },UNDO_MS);
    }catch(e){toast&&toast(e.message||'Could not mark it used','error');}
  };
  const undo=async(x,ev)=>{
    ev.stopPropagation();
    const m=marked[x.benefit_id];if(!m)return;
    clearTimeout(timers.current[x.benefit_id]);delete timers.current[x.benefit_id];
    try{
      const r=await apiFetch(`/benefit-usage/${m.useId}`,{method:'DELETE'});
      latest.current=r.benefits;
      setMarked(s=>{const n={...s};delete n[x.benefit_id];return n;});
      if(!Object.keys(timers.current).length&&r.benefits){setB(r.benefits);setGone({});}
    }catch(e){toast&&toast(e.message||'Undo failed','error');}
  };
  const shown=items.slice(0,max),more=items.length-shown.length;
  const nxt=E.next&&<p className="bnf-xn">Next: <b>{E.next.name}</b>, {mo(E.next.left)} by {dt(E.next.end)}</p>;
  let body;
  if(!B.benefits.length)body=<div className="c-panel bnf-pn"><p className="bnf-mut">No credits set up for this card.</p></div>;
  else if(!items.length)body=<div className="c-panel bnf-pn bnf-xe"><p className="bnf-mut">{didMark?`All caught up for the next ${win} days.`:`Nothing expires in the next ${win} days.`}</p>{nxt}</div>;
  else body=(<div className="bnf-xg">
    {shown.map(x=>{const m=marked[x.benefit_id];return(
      <div key={x.benefit_id} className={`c-panel bnf-xc ${urg(x.days)} ${m?'used':''}`} role="button" tabIndex={0}
        aria-label={m?`${x.name} marked used. Undo available.`:`Mark ${x.name} as used`}
        onClick={()=>mark(x)} onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&e.target===e.currentTarget){e.preventDefault();mark(x);}}}>
        <Ring days={x.days} span={x.span}/>
        <span className="bnf-xb"><b>{x.name}</b><small><em>{mo(x.left)}</em> left, by {dt(x.end)}</small></span>
        <span className="bnf-xo" aria-hidden="true"><i>✓</i></span>
        {m&&<span className="bnf-xs"><span className="bnf-xs-t"><i>✓</i>Marked used</span>
          <button type="button" className="c-btn sm" onClick={e=>undo(x,e)}>Undo</button><span className="bnf-tm"/></span>}
      </div>);})}
    {more>0&&<button type="button" className="bnf-xm" onClick={onToBenefits}>+{more} more in Benefits</button>}
  </div>);
  return(<section className="cloud bnf">
    <div className="bnf-sh"><h2>Expiring credits {items.length>0&&<span className="bnf-ct">{items.length}, {mo(E.total)} in the next {win} days</span>}</h2></div>
    {body}
  </section>);
}

/* ── Benefits panel ───────────────────────────────────────────────────── */
function pillOf(x){
  if(periodic(x))return x.open?{c:'o',t:`${mo(x.left)} left`}:{c:'d',t:'Used'};
  if(x.cadence==='multi_year')return x.open?{c:'n',t:'Unused'}:{c:'d',t:'Used'};
  const n=x.uses.filter(u=>u.counts>0).length;
  return n?{c:'d',t:`Used ${n}×`}:{c:'n',t:'Unused'};
}

function useText(u,x){
  const auto=x.tracked==='auto';
  if(u.kind==='statement'){
    let s='Statement credit';
    if(u.for_purchase)s+=`, for ${u.for_purchase.desc} ${mo(u.for_purchase.amount)}`;
    if(u.carried_from)s+=`, posted in ${u.carried_from}`;
    if(u.carried_to)s+=`, ${mo(u.amount-u.counts)} counted in ${u.carried_to}`;
    return s;
  }
  if(u.kind==='purchase'){
    const p=u.purchase?`for ${u.purchase.desc} ${mo(u.purchase.amount)}`:'from a purchase';
    return auto?`Logged ${p}, waiting for the statement credit`:`Logged by hand, ${p}`;
  }
  if(!auto)return 'Logged by hand'+(u.notes&&u.notes!=='Marked fully used'?`: ${u.notes}`:'');
  if(u.replaced)return 'Logged by hand, replaced by the statement credit';
  if(u.counts<u.amount-0.005)return `Logged by hand, ${mo(u.amount-u.counts)} replaced by the statement credit`;
  return 'Logged by hand, waiting for the statement credit';
}

function PeriodDetail({x,p,today,cardId,onSaved,onClose,toast}){
  const isP=!!p.start&&periodic(x);
  const end=isP?minDate(p.end,today):today;
  const[d,setD]=useState(isP?(p.state==='current'?today:p.end):today);
  const[a,setA]=useState('');
  const[busy,setBusy]=useState(false);
  const amtRef=useRef(null);
  useEffect(()=>{if(p.focusAdd&&amtRef.current)amtRef.current.focus();},[p.focusAdd]);
  const run=async(fn,msg)=>{setBusy(true);try{const r=await fn();onSaved(r.benefits);msg&&toast&&toast(msg,'success');}catch(e){toast&&toast(e.message||'Something went wrong','error');}finally{setBusy(false);}};
  const add=()=>{const n=parseFloat(String(a).replace(/[^0-9.]/g,''));
    if(!(n>0)){toast&&toast('Enter the amount used','error');return;}
    run(()=>apiFetch(`/cards/${cardId}/benefit-uses`,{method:'POST',body:JSON.stringify({benefit_id:x.id,amount:n,date:d})}),'Use logged').then(()=>setA(''));};
  const full=()=>run(()=>x.cadence==='multi_year'
    ?apiFetch(`/cards/${cardId}/benefit-uses`,{method:'POST',body:JSON.stringify({benefit_id:x.id,amount:x.amount,date:d})})
    :apiFetch(`/cards/${cardId}/benefits/${x.id}/mark-used`,{method:'POST',body:JSON.stringify({date:d})}),'Marked fully used');
  const remove=id=>run(()=>apiFetch(`/benefit-usage/${id}`,{method:'DELETE'}),'Removed');
  const U=p.uses.filter(u=>!(u.kind==='purchase'&&u.paired));
  const future=isP&&p.state==='future';
  const canFull=x.cadence!=='per_use'&&!future&&p.status!=='full'&&p.status!=='none'&&!(x.cadence==='multi_year'&&!x.open);
  return(<div className="bnf-pd">
    <div className="bnf-pd-h"><b>{isP?<>{p.label} <small>{dt(p.start)} – {dt(p.end)}</small></>:x.cadence==='multi_year'?<>Last {x.every_years||4} years</>:<>Uses this year</>}</b>
      {x.cadence!=='per_use'&&<span>{mo(p.used)} of {mo(x.amount)}</span>}</div>
    {p.status==='none'?<p className="bnf-mut">Before the card was opened.</p>
    :U.length?<ul>{U.map((u,i)=>(<li key={(u.id||'s')+'-'+(u.txn_id||'')+'-'+i}>
        <span>{md(u.date)}</span>
        <b className={u.kind==='hand'&&u.replaced?'bnf-dim':''}>{mo(u.kind==='statement'?u.counts:u.amount)}</b>
        <small>{useText(u,x)}</small>
        {u.kind==='statement'?(u.link_use_id?<button type="button" className="c-lnk" disabled={busy} onClick={()=>remove(u.link_use_id)}>Unlink</button>:<span/>)
          :<button type="button" className="c-lnk" disabled={busy} onClick={()=>remove(u.id)}>Remove</button>}
      </li>))}</ul>
    :<p className="bnf-mut">{future?"This period hasn't started.":'Nothing used in this period.'}</p>}
    {!future&&p.status!=='none'&&<div className="bnf-pd-add">
      <input className="c-inp" type="date" aria-label="Date" value={d} min={isP?p.start:undefined} max={end} onChange={e=>setD(e.target.value)}/>
      <input ref={amtRef} className="c-inp bnf-amt" type="text" inputMode="decimal" aria-label="Amount" value={a}
        placeholder={mo(isP?(p.left||x.amount):x.amount)} onChange={e=>setA(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')add();}}/>
      <button type="button" className="c-btn sm" disabled={busy} onClick={add}>Add use</button>
    </div>}
    {x.tracked==='auto'&&!future&&p.status!=='none'&&<p className="bnf-note">Statement credits containing “{x.match_text}” count here by themselves. A use you add counts until the statement credit posts.</p>}
    <div className="bnf-pd-f">
      {canFull&&<button type="button" className="c-btn sm" disabled={busy} onClick={full}>Mark fully used</button>}
      <button type="button" className="c-btn sm pri" onClick={onClose}>Done</button>
    </div>
  </div>);
}

export function BenefitsPanel({B,setB,cardId,productId,toast,sectionRef}){
  const[open,setOpen]=useState(null);       // {id, j, focusAdd}
  const[menu,setMenu]=useState(null);       // {id, el}
  const[edit,setEdit]=useState(null);       // benefit or {} for new
  const[del,setDel]=useState(null);
  if(!B)return null;
  const byId=Object.fromEntries(B.benefits.map(x=>[x.id,x]));
  const order=B.order.map(id=>byId[id]).filter(Boolean);
  const T=B.totals;
  const openCurrent=(x,focusAdd)=>{setMenu(null);setOpen({id:x.id,j:periodic(x)?Math.max(0,cur(x)):'x',focusAdd:!!focusAdd});};
  const markFull=async x=>{setMenu(null);
    try{const r=await apiFetch(`/cards/${cardId}/benefits/${x.id}/mark-used`,{method:'POST',body:JSON.stringify({})});setB(r.benefits);toast&&toast(`${x.name} marked used`,'success');}
    catch(e){toast&&toast(e.message||'Could not mark it used','error');}};
  const periodFor=(x,j)=>j==='x'?{label:null,start:null,end:null,state:'current',status:x.open?'open':'full',used:x.uses.reduce((t,u)=>t+u.counts,0),left:x.left,uses:x.uses}:x.periods[j];
  return(<section className="cloud bnf" ref={sectionRef} id="bnf-benefits">
    <div className="bnf-sh"><h2>Benefits and credits <span className="bnf-ct">{B.benefits.length||''}</span></h2>
      {productId&&<button type="button" className="c-btn sm" onClick={()=>setEdit({})}>+ Add benefit</button>}</div>
    {B.benefits.length>0&&<p className="bnf-line">{m0(T.value)} in credits this year, <span className="bnf-up">{m0(T.used)} used</span>, {T.missed>0&&<>{m0(T.missed)} missed, </>}{m0(T.left)} left</p>}
    {B.needs_open_date&&<p className="bnf-note">Card-year credits follow the calendar year until this card’s open date is set.</p>}
    {B.expiring.items.length>0&&<div className="bnf-alert"><b>{mo(B.expiring.total)} expires if unused</b>
      {B.expiring.items.map(e=>(<button type="button" key={e.benefit_id} className="bnf-al" onClick={()=>openCurrent(byId[e.benefit_id])}>
        <span>{e.name}</span><span>{mo(e.left)}</span><small>by {dt(e.end)}</small></button>))}</div>}
    {!B.benefits.length?<div className="c-panel bnf-pn"><p className="bnf-mut">No credits set up for this card.</p></div>
    :<div className="c-panel bnf-list">{order.map(x=>{const pl=pillOf(x),o=open&&open.id===x.id;return(
      <div key={x.id} className="bnf-r">
        <div className="bnf-rw">
          <div className="bnf-rn"><b title={x.notes||undefined}>{x.name}</b>
            <small>{cadLine(x)} <span className={`bnf-tg ${x.tracked}`}>{x.tracked==='auto'?'Auto-tracked':'Log by hand'}</span></small></div>
          <div className="bnf-rs">
            {periodic(x)&&x.periods.length>1&&<span className="bnf-dots">{x.periods.map((p,j)=>(
              <button type="button" key={j} className={`bnf-dt s-${p.status} ${p.state==='current'?'cur':''} ${o&&open.j===j?'sel':''}`}
                title={p.status==='none'?`${p.label}: before the card was opened`:`${p.label}: ${mo(p.used)} of ${mo(x.amount)}`}
                aria-label={`${p.label}: ${mo(p.used)} of ${mo(x.amount)}`}
                onClick={()=>setOpen(o&&open.j===j?null:{id:x.id,j})}/>))}</span>}
            <button type="button" className={`bnf-pill ${pl.c}`} title={x.next_on?`Next on ${dt(x.next_on)}, ${x.next_on.slice(0,4)}`:undefined}
              onClick={()=>o?setOpen(null):openCurrent(x)}>{pl.t}</button>
          </div>
          <button type="button" className="c-ib bnf-more" aria-label={`Actions for ${x.name}`} onClick={e=>setMenu({id:x.id,el:e.currentTarget})}>⋯</button>
        </div>
        {o&&<PeriodDetail key={`${x.id}-${open.j}`} x={x} p={{...periodFor(x,open.j),focusAdd:open.focusAdd}} today={B.today} cardId={cardId}
          onSaved={setB} onClose={()=>setOpen(null)} toast={toast}/>}
      </div>);})}</div>}
    {menu&&(()=>{const x=byId[menu.id];if(!x)return null;return(
      <Popover anchor={menu.el} align="right" onClose={()=>setMenu(null)}>
        <div className="c-pop c-menu" role="menu" aria-label={`Actions for ${x.name}`}>
          <button type="button" className="c-mi" data-autofocus onClick={()=>openCurrent(x,true)}>Log a use</button>
          {x.open&&x.cadence!=='per_use'&&<button type="button" className="c-mi" onClick={()=>markFull(x)}>Mark fully used</button>}
          <button type="button" className="c-mi" onClick={()=>{setMenu(null);setEdit(x);}}>Edit</button>
          <button type="button" className="c-mi bnf-bad" onClick={()=>{setMenu(null);setDel(x);}}>Delete</button>
        </div>
      </Popover>);})()}
    {edit&&<BenefitEditPanel x={edit} productId={productId} needsDate={B.needs_open_date} toast={toast}
      onClose={()=>setEdit(null)} onDelete={()=>{const x=edit;setEdit(null);setDel(x);}}
      onSaved={async()=>{setEdit(null);try{setB(await apiFetch(`/cards/${cardId}/benefits`));}catch{}}}/>}
    {del&&<Window label="Delete benefit" size="xs"><div className="c-wb">
      <div className="c-wh"><div><h3>Delete {del.name}?</h3></div></div>
      <p className="bnf-mut">It’s removed from every card of this product, with its logged uses. This can’t be undone. Statement credits stay in your transactions.</p>
      <div className="c-wf"><span/><div className="c-row">
        <button type="button" className="c-btn" onClick={()=>setDel(null)}>Cancel</button>
        <button type="button" className="c-btn danger" onClick={async()=>{const x=del;setDel(null);setOpen(null);
          try{await apiFetch(`/benefits/${x.id}`,{method:'DELETE'});setB(await apiFetch(`/cards/${cardId}/benefits`));toast&&toast(`${x.name} deleted`,'success');}
          catch(e){toast&&toast(e.message||'Delete failed','error');}}}>Delete</button>
      </div></div></div></Window>}
  </section>);
}

/* ── Edit benefit (side panel) ────────────────────────────────────────── */
function BenefitEditPanel({x,productId,needsDate,onClose,onSaved,onDelete,toast}){
  const isNew=!x.id;
  const[f,setF]=useState({name:x.name||'',amount:x.id?String(x.amount):'',cadence:x.cadence||'annual',year_type:x.year_type||'calendar',
    every_years:String(x.every_years||4),match_text:x.match_text||'',remind:x.id?x.remind!==false:true});
  const[busy,setBusy]=useState(false);
  const set=(k,v)=>setF(s=>({...s,[k]:v}));
  const save=async()=>{
    const amt=parseFloat(String(f.amount).replace(/[^0-9.]/g,''));
    if(!f.name.trim()){toast&&toast('A benefit needs a name','error');return;}
    if(!(amt>=0)){toast&&toast('Enter the amount each time it resets','error');return;}
    const body={benefit_name:f.name.trim(),amount:amt,cadence:f.cadence,year_type:f.year_type,match_text:f.match_text.trim(),remind:f.remind,
      every_years:f.cadence==='multi_year'?(parseFloat(f.every_years)||4):null};
    setBusy(true);
    try{
      if(isNew)await apiFetch(`/card-products/${productId}/benefits`,{method:'POST',body:JSON.stringify(body)});
      else await apiFetch(`/benefits/${x.id}`,{method:'PATCH',body:JSON.stringify(body)});
      toast&&toast(isNew?'Benefit added':'Benefit saved','success');onSaved();
    }catch(e){toast&&toast(e.message||'Save failed','error');}
    finally{setBusy(false);}
  };
  return(<SidePanel label={isNew?'Add benefit':'Edit benefit'} onClose={onClose} footer={<>
    {isNew?<span/>:<button type="button" className="c-lnk bnf-bad" onClick={onDelete}>Delete benefit</button>}
    <div className="c-row"><button type="button" className="c-btn" onClick={onClose}>Cancel</button>
      <button type="button" className="c-btn pri" disabled={busy} onClick={save}>{busy?'Saving…':'Save'}</button></div></>}>
    <div className="bnf-ef">
      <label className="c-fld"><span>Name</span><input className="c-inp" value={f.name} onChange={e=>set('name',e.target.value)}/></label>
      <div className="bnf-ef2">
        <label className="c-fld"><span>Amount each time it resets</span><input className="c-inp" inputMode="decimal" value={f.amount} placeholder="$0" onChange={e=>set('amount',e.target.value)}/></label>
        <label className="c-fld"><span>Year runs</span><select className="c-sel" value={f.year_type} onChange={e=>set('year_type',e.target.value)}>
          <option value="calendar">Calendar year</option><option value="card">Card anniversary</option></select></label>
      </div>
      {f.year_type==='card'&&needsDate&&<p className="bnf-note">This card has no open date in the app, so its year follows the calendar until one is set.</p>}
      <fieldset className="c-fld bnf-fs"><span>Resets</span><div className="bnf-seg">{RESETS.map(([k,l])=>(
        <button type="button" key={k} className={f.cadence===k?'on':''} aria-pressed={f.cadence===k} onClick={()=>set('cadence',k)}>{l}</button>))}</div></fieldset>
      {f.cadence==='multi_year'&&<label className="c-fld"><span>Every how many years</span><input className="c-inp bnf-yrs" inputMode="decimal" value={f.every_years} onChange={e=>set('every_years',e.target.value)}/></label>}
      <label className="c-fld"><span>Track automatically: statement credits containing</span>
        <input className="c-inp" value={f.match_text} placeholder="Leave empty to log by hand" onChange={e=>set('match_text',e.target.value)}/></label>
      <label className="c-cb"><input type="checkbox" checked={f.remind} onChange={e=>set('remind',e.target.checked)}/> Remind me 7 days before an unused credit resets</label>
    </div>
  </SidePanel>);
}

/* ── Log credit use (from a purchase row) ─────────────────────────────── */
export function LogCreditUse({t,cardId,B,onClose,onSaved,toast}){
  const[at,setAt]=useState(null);
  const[step,setStep]=useState(1);
  const[pick,setPick]=useState(null);
  const[amt,setAmt]=useState('');
  const[busy,setBusy]=useState(false);
  const day=t.date.slice(0,10),spent=Math.abs(t.amount);
  useEffect(()=>{apiFetch(`/cards/${cardId}/benefits?for_date=${day}`).then(r=>setAt(r.at_date)).catch(()=>setAt({}));},[cardId,day]);
  const list=[...(B?.benefits||[])].sort((a,b)=>a.id-b.id);
  useEffect(()=>{if(!pick&&list.length)setPick(list[0].id);},[list.length]);// eslint-disable-line react-hooks/exhaustive-deps
  const q=id=>at&&at[String(id)];
  const status=x=>{const p=q(x.id);if(!periodic(x))return x.cadence==='per_use'?'Per use':'Every few years';
    if(!p)return '…';return p.left>0?`${mo(p.left)} left for ${p.label}`:`${p.label} already used`;};
  const chosen=list.find(x=>x.id===pick);
  const next=()=>{if(!chosen)return;const p=q(chosen.id);const left=periodic(chosen)&&p?p.left:chosen.amount;
    setAmt((Math.round(Math.min(spent,left||chosen.amount)*100)/100).toFixed(2));setStep(2);};
  const log=async()=>{const n=parseFloat(String(amt).replace(/[^0-9.]/g,''));
    if(!(n>0)){toast&&toast('Enter the amount of the credit used','error');return;}
    setBusy(true);
    try{const r=await apiFetch(`/cards/${cardId}/benefit-uses`,{method:'POST',body:JSON.stringify({benefit_id:chosen.id,amount:n,transaction_id:t.id})});
      const p=q(chosen.id);toast&&toast(`${t.description} linked to ${chosen.name}${p&&p.label?` (${p.label})`:''}`,'success');onSaved(r.benefits);}
    catch(e){toast&&toast(e.message||'Could not log it','error');setBusy(false);}
  };
  const p=chosen&&q(chosen.id);
  return(<Window label="Log credit use" size="sm"><div className="c-wb">
    <div className="c-wh"><div><h3>Log credit use</h3><span className="bnf-pur"><span>{md(day)}</span><b>{t.description}</b><b>{mo(spent)}</b></span></div>
      <button type="button" className="c-x" onClick={onClose} aria-label="Close">×</button></div>
    {step===1?<>
      <p className="bnf-stp">Step 1 of 2: which credit paid for this?</p>
      {!list.length?<p className="bnf-mut">No credits set up for this card.</p>:
      <div className="bnf-ops">{list.map(x=>(<label key={x.id} className={`bnf-op ${pick===x.id?'on':''}`}>
        <input type="radio" name="lcb" checked={pick===x.id} onChange={()=>setPick(x.id)}/>
        <span><b>{x.name}</b><small>{cadLine(x)} · {status(x)}</small></span></label>))}</div>}
    </>:<>
      <p className="bnf-stp">Step 2 of 2</p>
      <div className="bnf-chosen"><b>{chosen.name}</b><small>{cadLine(chosen)} · {status(chosen)}</small></div>
      <div className="bnf-ef2">
        <label className="c-fld"><span>Amount of the credit used</span><input className="c-inp" inputMode="decimal" value={amt} onChange={e=>setAmt(e.target.value)} autoFocus/></label>
        <label className="c-fld"><span>Counts toward</span><input className="c-inp" readOnly value={p&&p.label?`${p.label} (${dt(p.start)} – ${dt(p.end)})`:'This use'}/></label>
      </div>
      <p className="bnf-mut">{chosen.tracked==='auto'?'This credit is tracked from your statement credits, so this only records which purchase it paid for. The total doesn’t change.':'This credit is logged by hand, so this amount is added to the period.'}</p>
    </>}
    <div className="c-wf">
      {step===2?<button type="button" className="c-btn" onClick={()=>setStep(1)}>Back</button>:<span/>}
      <div className="c-row"><button type="button" className="c-btn" onClick={onClose}>Cancel</button>
        {step===1?<button type="button" className="c-btn pri" disabled={!chosen||!at} onClick={next}>Next</button>
        :<button type="button" className="c-btn pri" disabled={busy} onClick={log}>{busy?'Saving…':'Log use'}</button>}</div>
    </div>
  </div></Window>);
}

/* The small green "$" after a purchase that a credit paid for. */
export function LinkedMark({links}){
  if(!links||!links.length)return null;
  const lbl=links.map(l=>`${l.name} applied, ${mo(l.amount)}`).join('; ');
  return <span className="cloud bnf-lk" title={lbl} aria-label={lbl} role="img">$</span>;
}
