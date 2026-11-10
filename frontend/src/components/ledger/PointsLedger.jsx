/* The points ledger (docs/cards-ledger-design.md): the Ecosystem page's
   balance ledger cards, its Activity table and the Check balance, adjustment
   and opening-balance side panels. Data comes from /api/ecosystems/{id}/ledger
   (core/points_ledger.py). Shown from the ledger's start date, 2027-01-01. */
import {useState,useEffect,useCallback,useMemo} from 'react';
import {apiFetch} from '../../lib/api';
import {SidePanel} from '../ui/SidePanel';
import '../../styles/cloud.css';
import './ledger.css';

const NO_OWNER='No owner';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const f=n=>Math.round(n||0).toLocaleString('en-US');
const sg=v=>(v>0?'+':v<0?'−':'')+f(Math.abs(v));
const tone=v=>v>0?'up':v<0?'neg':'mut';
const md=s=>{const[,m,d]=s.split('-');return `${Number(m)}/${Number(d)}`;};
const longDate=s=>new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const parsePts=v=>{const t=String(v??'').replace(/[,\s]/g,'').replace('−','-');if(t===''||t==='-')return NaN;const n=Number(t);return Number.isFinite(n)?n:NaN;};

const TYPE={open:'Opening',earn:'Purchases',red:'Redemption',xout:'Transfer out',xin:'Transfer in',p2p:'Between us',adj:'Adjustment',check:'Adjustment',bonus:'Adjustment'};
const GROUP={open:'o',earn:'e',red:'r',xout:'t',xin:'t',p2p:'t',adj:'a',check:'a',bonus:'a'};
const CHIP={earn:'Purchases',red:'Redemption',xout:'Transfer',xin:'Transfer',p2p:'Between us',adj:'Adjustment',check:'Adjustment',bonus:'Adjustment'};
const CHIPS=['','Purchases','Redemption','Transfer','Adjustment','Between us'];
const RANK={open:0,earn:1,check:3};
const reasonRow=r=>r==='Balance adjustment'?'Balance adjustments':r;

/* ── Data ─────────────────────────────────────────────────────────────── */
export function usePointsLedger(ecoId,{reloadKey,toast}={}){
  const[L,setL]=useState(null);
  const[panel,setPanel]=useState(null); // {t:'check'|'adjust'|'open', person?, entry?}
  const load=useCallback(async()=>{
    if(!ecoId)return;
    try{setL(await apiFetch(`/ecosystems/${ecoId}/ledger`));}
    catch(e){toast&&toast('Couldn’t load the points ledger','error');}
  },[ecoId]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{load();},[load,reloadKey]);
  return {L,setL,load,panel,setPanel};
}

/* Posted balance for one person at the end of a day, from the ledger's own lines. */
const postedOn=(L,person,day)=>Math.round(L.entries.filter(e=>e.status==='posted'&&e.person===person&&e.date<=day).reduce((t,e)=>t+e.pts,0));

function checkState(c){
  if(!c)return {cls:'never',short:'Not checked',long:'Not checked yet'};
  const when=`${longDate(c.date)}${c.days_ago>0?`, ${c.days_ago} day${c.days_ago===1?'':'s'} ago`:''}`;
  if(!c.gap)return {cls:'ok',short:md(c.date),long:`Checked ${when}, matched`};
  return {cls:'gap',short:md(c.date),long:`Checked ${when}, program had ${f(Math.abs(c.gap))} ${c.gap>0?'more':'fewer'}`};
}

/* ── Balance ledger: a card per person, Total first ────────────────────── */
const ROWS=reasons=>[
  ['Earned',b=>b.earned+b.pending_bonus],
  ['Pending, not yet posted',b=>-(b.pending_cards+b.pending_bonus)],
  ['Redeemed',b=>b.redeemed],
  ['Transferred out',b=>b.transferred_out],
  ['Transferred in',b=>b.transferred_in],
  ...reasons.map(r=>[reasonRow(r),b=>b.by_reason?.[r]||0]),
  ['Sent to other',b=>b.sent],
  ['Received from other',b=>b.received],
];

export function LedgerCards({lg,onBetween,onOpenCard}){
  const L=lg.L;if(!L)return null;
  const people=L.people,rows=ROWS(L.reasons);
  const all=[...people.map(p=>L.balances[p]),L.total];
  const shown=rows.filter(([,get])=>all.some(b=>Math.abs(get(b))>=.5));
  const card=(name,b,isTotal)=>{
    // Total always shows its rows (points from a card with no owner can arrive before any opening balance).
    const unset=!isTotal&&!b.has_opening,c=!isTotal&&checkState(L.last_checks[name]);
    return(
      <div key={name} className={`lgr-p ${isTotal?'tot':''}`}>
        <div className="lgr-ph"><b>{name}</b>
          {!isTotal&&!unset&&<span className={`lgr-dot ${c.cls}`} title={c.long}><i/>{c.short}</span>}
        </div>
        {isTotal||unset
          ?<div className="c-val lgr-cur">{unset&&!isTotal?'—':f(b.current)}</div>
          :<button type="button" className="c-val lgr-cur lgr-fig" title="Check balance" aria-label={`Check ${name}’s balance`}
              onClick={()=>lg.setPanel({t:'check',person:name})}>{f(b.current)}<i aria-hidden="true">✎</i></button>}
        <dl>
          <dt>Opening balance</dt>
          <dd className="lgr-o">{unset||!b.has_opening?<span className="mut">not set</span>:f(b.opening)}
            {!isTotal&&!unset&&<button type="button" className="lgr-oe" aria-label={`Edit ${name}’s opening balance`} onClick={()=>lg.setPanel({t:'open',person:name})}>✎</button>}
          </dd>
          {!unset&&shown.map(([label,get])=>{const v=get(b);return [<dt key={label+'t'}>{label}</dt>,<dd key={label+'d'} className={tone(v)}>{sg(v)}</dd>];})}
        </dl>
        {!isTotal&&unset&&<button type="button" className="c-btn pri sm lgr-set" onClick={()=>lg.setPanel({t:'open',person:name})}>Set opening balance</button>}
      </div>);
  };
  return(
    <section className="cloud lgr">
      <div className="lgr-sh"><h2>Balance ledger</h2>
        {people.length>1&&onBetween&&<button type="button" className="c-btn sm" onClick={onBetween}>+ Transfer between us</button>}
      </div>
      <div className="c-panel lgr-pn">
        <div className="lgr-people">{card('Total',L.total,true)}{people.map(p=>card(p,L.balances[p],false))}</div>
        {L.no_owner&&<p className="lgr-warn"><b>{f(L.no_owner.balance)}</b> points from {L.no_owner.cards.join(', ')||'a card'} have no owner, so they count in Total only.{' '}
          {(L.no_owner.accounts||[]).filter(a=>a.account_id).map((a,i)=>onOpenCard
            ?<button type="button" key={a.account_id} className="c-lnk" onClick={()=>onOpenCard(a.account_id)}>Set {L.no_owner.accounts.length>1?`${a.card_name}’s`:'the card’s'} owner</button>
            :<span key={i}>Set the card’s owner in Card Management.</span>)}</p>}
      </div>
    </section>);
}

/* ── Activity: a table, one line per entry ─────────────────────────────── */
function describe(e){
  switch(e.kind){
    case 'earn':return e.monthly?'Month of charges':'Statement close';
    case 'open':return 'Opening balance';
    case 'red':return 'Redemption';
    case 'xout':return `To ${e.partner||'another program'}`;
    case 'xin':return `From ${e.partner||'another program'}`;
    case 'p2p':return `${e.from_person} to ${e.to_person}`;
    default:return e.reason||'Other';
  }
}
function details(e,L){
  const note=e.note?[e.note]:[];
  switch(e.kind){
    case 'earn':{
      if(e.monthly)return `${MONTHS[Number(e.statement_to.slice(5,7))-1]} charges (${e.charges}); no statement close day set, so counted as charged`;
      const pre=e.before_start?` (${e.before_start} from before ${longDate(L.start)})`:'';
      return `${md(e.statement_from)} to ${md(e.statement_to)}, ${e.charges} charge${e.charges===1?'':'s'}${pre}${e.status==='pending'?`; posts ${md(e.date)}`:''}`;}
    case 'open':return note.join('; ');
    case 'red':return [e.description,e.cash_value_usd!=null?`$${e.cash_value_usd.toFixed(2)} realized`:null,...note].filter(Boolean).join('; ');
    case 'xout':case 'xin':return [e.detail,...note].filter(Boolean).join('; ');
    case 'p2p':return ['Same program, nets to zero',...note].join('; ');
    case 'check':{const rep=e.reported_balance;const had=rep!=null?rep-e.pts:e.person_before;
      return [e.pts?`Program showed ${f(rep)}, the app had ${f(had)}`:`Matched the program at ${f(rep)}`,...note].join('. ');}
    case 'bonus':return e.status==='pending'
      ?`${e.challenge_name}. Challenge met${e.threshold?` ($${f(e.threshold)} spent)`:''}; mark it posted on its challenge card once the program shows it`
      :[`${e.challenge_name||e.description}; marked posted ${md(e.date)}`,...note].join('; ');
    default:return [e.description&&e.description!==e.reason&&e.description!==e.note?e.description:null,...note].filter(Boolean).join('; ');
  }
}

export function LedgerActivity({lg,onRedemption,onTransfer,onBetween,onEditRedemption,onEditBetween,onDeleteTransfer}){
  const L=lg.L;
  const[kf,setKf]=useState('');
  const[pf,setPf]=useState('');
  const rows=useMemo(()=>{
    if(!L)return [];
    return L.entries.filter(e=>(!pf||e.person===pf)&&(!kf||CHIP[e.kind]===kf))
      .slice().sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:(RANK[b.kind]??2)-(RANK[a.kind]??2));
  },[L,kf,pf]);
  if(!L)return null;
  const red=L.entries.filter(e=>e.kind==='red'),rp=-red.reduce((t,e)=>t+e.pts,0),cash=red.reduce((t,e)=>t+(e.cash_value_usd||0),0);
  const ownerIdx=p=>Math.max(0,L.people.indexOf(p));
  const action=e=>{
    if(e.status==='pending')return null;
    const edit=fn=><button type="button" className="c-btn sm lgr-ed" onClick={fn}>Edit</button>;
    if(e.kind==='adj'||e.kind==='check'||e.kind==='bonus')return edit(()=>lg.setPanel({t:'adjust',entry:e}));
    if(e.kind==='open')return edit(()=>lg.setPanel({t:'open',person:e.person}));
    if(e.kind==='red'&&onEditRedemption)return edit(()=>onEditRedemption(e.redemption_id));
    if(e.kind==='p2p'&&onEditBetween)return edit(()=>onEditBetween(e.person_transfer_id));
    if((e.kind==='xout'||e.kind==='xin')&&onDeleteTransfer)return <button type="button" className="c-btn sm lgr-ed" onClick={()=>onDeleteTransfer(e.transfer_id)}>Delete</button>;
    return null;
  };
  return(
    <section className="cloud lgr">
      <div className="lgr-sh"><h2>Activity</h2>
        <span className="lgr-btns">
          {onRedemption&&<button type="button" className="c-btn sm" onClick={onRedemption}>+ Redemption</button>}
          {onTransfer&&<button type="button" className="c-btn sm" onClick={onTransfer}>+ Transfer</button>}
          <button type="button" className="c-btn sm" onClick={()=>lg.setPanel({t:'adjust'})}>+ Adjustment</button>
          {onBetween&&L.people.length>1&&<button type="button" className="c-btn sm" onClick={onBetween}>+ Between us</button>}
        </span>
      </div>
      <div className="c-panel lgr-pn">
        {rp>0&&<div className="lgr-rs">
          <div><span>Points redeemed</span><b className="c-val">{f(rp)}</b></div>
          <div><span>Cash value realized</span><b className="c-val">${cash.toFixed(2)}</b></div>
          <div><span>Realized ¢ per point</span><b className="c-val">{(cash/rp*100).toFixed(2)}¢</b></div>
        </div>}
        <div className="lgr-chips">
          <span>{CHIPS.map(c=><button type="button" key={c||'all'} className={`c-fb ${kf===c?'on':''}`} onClick={()=>setKf(c)}>{c||'All'}</button>)}</span>
          {L.people.length>1&&<span>{['',...L.people].map(p=><button type="button" key={p||'all'} className={`c-fb ${pf===p?'on':''}`} onClick={()=>setPf(p)}>{p||'Everyone'}</button>)}</span>}
        </div>
        {!L.entries.length?<p className="mut">Nothing yet. The ledger starts once an opening balance is set.</p>
        :!rows.length?<p className="mut">Nothing of this type yet.</p>
        :<div className="lgr-tw"><table className="lgr-t">
          <thead><tr><th>Date</th><th>Card</th><th>Type</th><th>Description</th><th>Details</th>{!pf&&<th>Owner</th>}<th className="n">Points</th><th className="n">{pf?'Balance':'Balance, total'}</th><th>Status</th><th/></tr></thead>
          <tbody>{rows.map(e=>{const det=details(e,L),pend=e.status==='pending',bal=pf?e.person_after:e.total_after;
            return(
              <tr key={e.id} className={pend?'pend':''}>
                <td className="d">{md(e.date)}</td>
                <td className="cd" title={e.card_name||''}>{e.card_mask&&<span className="lgr-card">
                  {e.product_key&&<span className="lgr-art"><img src={`/static/cards/${e.product_key}.png`} alt="" onError={ev=>{ev.currentTarget.style.display='none';}}/></span>}…{e.card_mask}</span>}</td>
                <td><span className={`lgr-tp g-${GROUP[e.kind]}`}>{TYPE[e.kind]}</span></td>
                <td className="ds" title={describe(e)}>{describe(e)}</td>
                <td className="dt" title={det}>{det}</td>
                {!pf&&<td>{e.person===NO_OWNER
                  ?<span className="lgr-oc no" title="No owner" aria-label="No owner">?</span>
                  :<span className={`lgr-oc p-${ownerIdx(e.person)}`} title={e.person} aria-label={e.person}>{(e.person||'?')[0]}</span>}</td>}
                <td className={`n ${pend?'c-warn':e.kind==='open'?'':tone(e.pts)}`}>{e.kind==='open'?f(e.pts):e.kind==='check'&&!e.pts?'±0':sg(e.pts)}</td>
                <td className="n bal">{pend||bal==null?'':f(bal)}</td>
                <td className={pend?'c-warn b':'mut'}>{!pend?'Posted':e.kind==='bonus'?'To confirm':'Pending'}</td>
                <td className="ac">{action(e)}</td>
              </tr>);})}
          </tbody></table></div>}
      </div>
    </section>);
}

/* ── Side panels ──────────────────────────────────────────────────────── */
export function LedgerPanels({lg,ecoId,ecoName,legacy,toast,onChanged}){
  const L=lg.L,p=lg.panel;
  if(!L||!p)return null;
  const close=()=>lg.setPanel(null);
  const saved=(res,msg)=>{if(res&&res.entries)lg.setL(res);else lg.load();close();toast&&toast(msg);onChanged&&onChanged();};
  if(p.t==='check')return <CheckPanel key={'c'+p.person} L={L} person={p.person} ecoId={ecoId} ecoName={ecoName} close={close} saved={saved} toast={toast}/>;
  if(p.t==='open')return <OpeningPanel key={'o'+p.person} L={L} person={p.person} ecoId={ecoId} ecoName={ecoName} legacy={legacy} close={close} saved={saved} toast={toast}/>;
  if(p.t==='adjust')return <AdjustPanel key={'a'+(p.entry?.id||'new')} L={L} entry={p.entry} ecoId={ecoId} ecoName={ecoName} close={close} saved={saved} toast={toast}/>;
  return null;
}

function Footer({onCancel,onSave,busy,left}){
  return <>{left&&<span className="c-spf-l">{left}</span>}<button type="button" className="c-btn" onClick={onCancel}>Cancel</button><button type="button" className="c-btn pri" disabled={busy} onClick={onSave}>{busy?'Saving…':'Save'}</button></>;
}

function CheckPanel({L,person,ecoId,ecoName,close,saved,toast}){
  const today=todayISO();
  const[val,setVal]=useState('');
  const[day,setDay]=useState(today);
  const[note,setNote]=useState('');
  const[busy,setBusy]=useState(false);
  const app=postedOn(L,person,day),prog=parsePts(val),gap=Number.isFinite(prog)?Math.round(prog)-app:null;
  const pend=L.balances[person]?.pending_cards||0;
  const save=async()=>{
    if(!Number.isFinite(prog)){toast&&toast('Type the balance the program shows','error');return;}
    setBusy(true);
    try{const r=await apiFetch(`/ecosystems/${ecoId}/balance-checks`,{method:'POST',body:JSON.stringify({person,reported_balance:prog,check_date:day,notes:note||null})});
      saved(r,r.saved?.gap?`Balance check saved: ${sg(r.saved.gap)} logged for ${person}`:`Balance check saved: ${person} matched`);}
    catch(e){toast&&toast(e.message,'error');setBusy(false);}
  };
  return(
    <SidePanel label={`Check ${ecoName} balance · ${person}`} onClose={close} footer={<Footer onCancel={close} onSave={save} busy={busy}/>}>
      <p className="lgr-lead">The app has <b>{f(app)}</b> posted{day!==today?` on ${longDate(day)}`:''}{pend&&day===today?`; ${f(pend)} pending isn’t included`:''}.</p>
      <label className="c-fld"><span>The program shows</span>
        <input className="c-inp lgr-big" inputMode="numeric" autoComplete="off" autoFocus value={val} placeholder="As the program shows it" onChange={e=>setVal(e.target.value)}/></label>
      <div className="lgr-g3">
        <div><small>App</small><b className="c-val">{f(app)}</b></div>
        <div><small>Program</small><b className="c-val">{Number.isFinite(prog)?f(prog):'—'}</b></div>
        <div><small>Difference</small><b className={`c-val ${gap==null?'mut':tone(gap)}`}>{gap==null?'—':gap?sg(gap):'±0'}</b></div>
      </div>
      <div className="lgr-row">
        <label className="c-fld"><span>Checked on</span><input type="date" className="c-inp" value={day} min={L.start} max={today} onChange={e=>setDay(e.target.value||today)}/></label>
        <label className="c-fld grow"><span>Note (optional)</span><input className="c-inp" value={note} placeholder="Where you looked, anything odd" onChange={e=>setNote(e.target.value)}/></label>
      </div>
      <p className="mut">Programs show posted points only, so the app compares its posted figure. The difference is logged as a Balance adjustment, or 0 when it matches.</p>
    </SidePanel>);
}

function AdjustPanel({L,entry,ecoId,ecoName,close,saved,toast}){
  const today=todayISO();
  const editing=!!entry;
  const[person,setPerson]=useState(entry?.person&&entry.person!==NO_OWNER?entry.person:L.people[0]||'');
  const[reason,setReason]=useState(entry?.reason||'Stay or flight');
  const[pts,setPts]=useState(entry?String(entry.pts):'');
  const[day,setDay]=useState(entry?.date||today);
  const[note,setNote]=useState(entry?.note||'');
  const[busy,setBusy]=useState(false);
  const save=async()=>{
    const n=parsePts(pts);
    if(!person){toast&&toast('Choose whose points','error');return;}
    if(!Number.isFinite(n)||(!n&&reason!=='Balance adjustment')){toast&&toast('Enter the points, for example 5000 or −2100','error');return;}
    setBusy(true);
    const body={points_delta:n,adjustment_date:day,reason,notes:note||null,person};
    try{
      const r=editing
        ?await apiFetch(`/points-adjustments/${entry.adjustment_id}`,{method:'PATCH',body:JSON.stringify(body)})
        :await apiFetch(`/ecosystems/${ecoId}/points-adjustments`,{method:'POST',body:JSON.stringify(body)});
      saved(r,editing?'Adjustment updated':`${reason} saved: ${sg(n)} for ${person}`);
    }catch(e){toast&&toast(e.message,'error');setBusy(false);}
  };
  const del=async()=>{
    if(!window.confirm('Delete this line from the ledger?'))return;
    setBusy(true);
    try{await apiFetch(`/points-adjustments/${entry.adjustment_id}`,{method:'DELETE'});saved(null,'Line deleted');}
    catch(e){toast&&toast(e.message,'error');setBusy(false);}
  };
  return(
    <SidePanel label={`${editing?'Edit':'Add'} adjustment · ${ecoName}`} onClose={close}
      footer={<Footer onCancel={close} onSave={save} busy={busy} left={editing&&<button type="button" className="c-btn danger" disabled={busy} onClick={del}>Delete</button>}/>}>
      {L.people.length>1&&<div className="c-fld"><span>Whose points</span>
        <div className="lgr-seg">{L.people.map(x=><button type="button" key={x} className={person===x?'on':''} onClick={()=>setPerson(x)}>{x}</button>)}</div></div>}
      <label className="c-fld"><span>Reason</span>
        <select className="c-sel" value={reason} disabled={entry?.kind==='check'||entry?.kind==='bonus'} onChange={e=>setReason(e.target.value)}>
          {L.reasons.map(r=><option key={r} value={r}>{r}</option>)}
        </select></label>
      <label className="c-fld"><span>Points</span>
        <input className="c-inp lgr-big" inputMode="numeric" autoComplete="off" autoFocus={!editing} value={pts} placeholder="5000 or −2100" onChange={e=>setPts(e.target.value)}/></label>
      <div className="lgr-row">
        <label className="c-fld"><span>Date</span><input type="date" className="c-inp" value={day} min={L.start} max={today} onChange={e=>setDay(e.target.value||today)}/></label>
        <label className="c-fld grow"><span>Note (optional)</span><input className="c-inp" value={note} placeholder={reason==='Stay or flight'?'Hotel, nights, booking':'Anything worth remembering'} onChange={e=>setNote(e.target.value)}/></label>
      </div>
    </SidePanel>);
}

function OpeningPanel({L,person,ecoId,ecoName,legacy,close,saved,toast}){
  const b=L.balances[person];
  const[val,setVal]=useState(b?.has_opening?f(b.opening):'');
  const[busy,setBusy]=useState(false);
  const app=legacy?.[person];
  const save=async()=>{
    const n=parsePts(val);
    if(!Number.isFinite(n)||n<0){toast&&toast('Type the balance the program showed','error');return;}
    setBusy(true);
    try{const r=await apiFetch(`/ecosystems/${ecoId}/opening-balances/${encodeURIComponent(person)}`,{method:'PUT',body:JSON.stringify({balance:n})});
      saved(r,`Opening balance saved for ${person}`);}
    catch(e){toast&&toast(e.message,'error');setBusy(false);}
  };
  return(
    <SidePanel label={`Opening balance · ${ecoName}`} onClose={close} footer={<Footer onCancel={close} onSave={save} busy={busy}/>}>
      <label className="c-fld"><span>{person}’s balance on {longDate(L.start)}</span>
        <input className="c-inp lgr-big" inputMode="numeric" autoComplete="off" autoFocus value={val} placeholder="As the program shows it" onChange={e=>setVal(e.target.value)}/></label>
      {app!=null&&!b?.has_opening&&<p className="mut">The app’s own figure today: <b>{f(app)}</b>. It was never checked, so use the program’s figure.</p>}
      <p className="mut">The posted balance the program shows on {longDate(L.start)}. Card points, bonuses and everything you log are added from there.</p>
    </SidePanel>);
}
