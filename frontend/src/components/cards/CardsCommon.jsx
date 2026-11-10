/* Shared pieces of the rebuilt Cards pages on desktop (Cards step 5): program
   logos, card faces, the cards row (whole cards, arrows, owner chips), the
   challenge grid (one circle with dollars to go, Archive on completed ones,
   Show archived, the dashed "+"), the header bar and the Actions strip
   (docs/cards-actions-design.md). No value per point is shown anywhere. */
import {useState,useEffect,useLayoutEffect,useRef,useCallback} from 'react';
import {apiFetch} from '../../lib/api';
import '../../styles/cloud.css';
import './cards.css';

const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const f=n=>Math.round(n||0).toLocaleString('en-US');
export const sg=v=>(v>0?'+':v<0?'−':'')+f(Math.abs(v));
export const usd0=n=>'$'+Math.round(n||0).toLocaleString('en-US');
export const usd=n=>{const r=Math.round((n||0)*100)/100;return '$'+(r%1?r.toFixed(2):r.toLocaleString('en-US'));};
export const usd2=n=>'$'+Math.abs(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export const mdy=s=>{if(!s)return '';const[,m,d]=s.slice(0,10).split('-');return `${MON[Number(m)-1]} ${Number(d)}`;};
export const md=s=>{if(!s)return '';const[,m,d]=s.slice(0,10).split('-');return `${Number(m)}/${Number(d)}`;};
export const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const short=n=>n>=1000?'$'+(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+'k':'$'+Math.round(n);

/* ── Theme (the program logos have light and dark files) ───────────────── */
export function usePageTheme(){
  const[t,setT]=useState(()=>document.documentElement.getAttribute('data-theme')||'dark');
  useEffect(()=>{
    const o=new MutationObserver(()=>setT(document.documentElement.getAttribute('data-theme')||'dark'));
    o.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    return()=>o.disconnect();
  },[]);
  return t;
}

/* ── Program colors and logos ──────────────────────────────────────────── */
const GRADS=[['chase','#1e40af,#0f2a5f'],['ultimate','#1e40af,#0f2a5f'],['amex','#0a2f6b,#2563eb'],['membership','#0a2f6b,#2563eb'],
  ['citi','#155e75,#0c4a5e'],['marriott','#78350f,#451a03'],['bonvoy','#78350f,#451a03'],['hilton','#4c1d95,#2e1065'],
  ['united','#374151,#111827'],['delta','#1e3a5f,#0f172a'],['hyatt','#7f1d1d,#450a0a'],['capital','#991b1b,#450a0a'],
  ['bilt','#14532d,#052e16'],['atmos','#065f46,#022c22'],['aadvantage','#334155,#0f172a'],['cash','#b45309,#78350f'],['discover','#9a3412,#7c2d12']];
export const gradFor=name=>{const n=(name||'').toLowerCase();const g=GRADS.find(([k])=>n.includes(k));return `linear-gradient(135deg,${g?g[1]:'#374151,#1f2937'})`;};
const LOGO_KEYS=[['chase','chase'],['ultimate','chase'],['amex','amex'],['membership','amex'],['hilton','hilton'],['citi','citi'],
  ['marriott','bonvoy'],['bonvoy','bonvoy'],['delta','delta'],['skymiles','delta'],['hyatt','hyatt'],['united','united'],
  ['mileageplus','united'],['aadvantage','aa'],['atmos','atmos'],['capital one','capitalone'],['bilt','bilt']];
const VARIANTS={hilton:['dark','light'],amex:['light'],citi:['dark','light'],chase:['dark','light'],bonvoy:['dark','light'],delta:['dark','light'],
  hyatt:['dark','light'],united:['dark','light'],aa:['dark','light'],atmos:['dark','light'],capitalone:['dark','light'],bilt:['dark','light']};
export function logoSrc(name,theme){
  const n=(name||'').toLowerCase(),k=(LOGO_KEYS.find(([s])=>n.includes(s))||[])[1];
  if(!k)return null;
  const v=VARIANTS[k]||[],want=theme==='light'?'light':'dark';
  if(!v.includes(want)&&k!=='amex')return null;
  return `/static/ecosystem-logos/${k}_t_${v.includes(want)?want:v[0]}.png`;
}
export function ProgramLogo({name,theme}){
  const[bad,setBad]=useState(false);
  const src=logoSrc(name,theme);
  if(!src||bad)return <span className="cds-mono"><i>{(name||'?')[0]}</i><span>{name}</span></span>;
  return <span className="cds-lg"><img src={src} alt={name} onError={()=>setBad(true)}/></span>;
}

/* ── Card art ──────────────────────────────────────────────────────────── */
export function CardFace({card,mask=true}){
  const[bad,setBad]=useState(false);
  return(
    <div className="cds-face" style={{background:gradFor(card.ecosystem||card.name)}}>
      {(!card.product_key||bad)&&<span className="fb">{card.name}</span>}
      {card.product_key&&!bad&&<img src={`/static/cards/${card.product_key}.png`} alt="" onError={()=>setBad(true)}/>}
      {mask&&card.mask&&<span className="mask">{card.mask}</span>}
    </div>);
}
export function CardThumb({productKey,eco}){
  const[bad,setBad]=useState(false);
  return <span className="cds-thumb" style={{background:gradFor(eco)}} aria-hidden="true">
    {productKey&&!bad&&<img src={`/static/cards/${productKey}.png`} alt="" onError={()=>setBad(true)}/>}</span>;
}

/* ── Cards row: arrows, whole cards only, 175px target width ──────────── */
const CARD_W=175;
export function CardRow({cards,onOpen,caption,title='Your cards',ownerChips=false}){
  const sc=useRef(null);
  const[own,setOwn]=useState('');
  const[fit,setFit]=useState({w:CARD_W,extra:0,page:0});
  const owners=[...new Set(cards.map(c=>c.owner||'Unassigned'))];
  const shown=own?cards.filter(c=>(c.owner||'Unassigned')===own):cards;
  const measure=useCallback(()=>{
    const el=sc.current;if(!el)return;
    const w=el.getBoundingClientRect().width,g=parseFloat(getComputedStyle(el).columnGap)||0;
    const n=Math.max(1,Math.floor((w+g)/(CARD_W+g))),iw=(w-g*(n-1))/n;
    setFit({w:iw,extra:(n-shown.length%n)%n,page:n*(iw+g)});
  },[shown.length]);
  useLayoutEffect(()=>{
    measure();
    const ro=new ResizeObserver(measure);
    if(sc.current)ro.observe(sc.current);
    return()=>ro.disconnect();
  },[measure]);
  useEffect(()=>{if(sc.current)sc.current.scrollLeft=0;},[own]);
  if(!cards.length)return null;
  const by=d=>sc.current&&sc.current.scrollBy({left:d*(fit.page||sc.current.clientWidth*.8),behavior:'smooth'});
  return(
    <section>
      <div className="cds-sh"><h2>{title} <span className="ct">{shown.length}</span></h2>
        {ownerChips&&owners.length>1&&<div className="cds-own" role="group" aria-label="Filter by cardholder">
          {['',...owners].map(o=><button type="button" key={o||'all'} className={`cds-chip ${own===o?'on':''}`} onClick={()=>setOwn(o)}>{o||'All'}</button>)}
        </div>}
      </div>
      <div className="cds-cw">
        <button type="button" className="cds-arr" aria-label="Scroll cards left" onClick={()=>by(-1)}>‹</button>
        <div className="cds-cs" ref={sc} style={{'--whole-w':fit.w+'px'}}>
          {shown.map(c=>(
            <button type="button" key={c.account_id} className="cds-ci" title={`${c.name}${c.mask?' '+c.mask:''}${c.owner?', '+c.owner:''}`} onClick={()=>onOpen(c.account_id)}>
              <CardFace card={c}/>
              {caption&&<div className="cds-cap">{caption(c)}</div>}
            </button>))}
          {fit.extra>0&&<i className="cds-sp" style={{width:fit.extra*(fit.w+15)-15}}/>}
        </div>
        <button type="button" className="cds-arr" aria-label="Scroll cards right" onClick={()=>by(1)}>›</button>
      </div>
    </section>);
}

/* ── Challenges ─────────────────────────────────────────────────────────── */
function ChRing({ch}){
  const r=22,C=2*Math.PI*r,pct=Math.min(ch.progress_pct||0,100);
  const label=ch.done?'Done':ch.progress_target?short(ch.remaining_spend||0):'n/a';
  return(<svg className="cds-ring" viewBox="0 0 54 54" aria-hidden="true">
    <circle cx="27" cy="27" r={r} fill="none" stroke="var(--c-line)" strokeWidth="5"/>
    <circle cx="27" cy="27" r={r} fill="none" stroke="var(--c-ac)" strokeWidth="5" strokeLinecap="round"
      strokeDasharray={`${C*(ch.done?100:pct)/100} ${C}`} transform="rotate(-90 27 27)"/>
    <text x="27" y="31" textAnchor="middle" fill="var(--c-tx)" fontSize={label.length>4?10.5:12} fontWeight="600">{label}</text>
  </svg>);
}
export function bonusText(ch){
  const a=ch.bonus_amount||0,cats=(ch.category_names||[]).join(', ');
  if(ch.bonus_type==='per_dollar')return `+${a}x${cats?' on '+cats:''}${ch.spend_cap?`, up to ${usd0(ch.spend_cap)}`:''}`;
  if(ch.bonus_type==='statement_credit')return `${usd(a)} statement credit`;
  if(ch.bonus_type==='benefit')return a===1?'1 reward':`${f(a)} rewards`;
  return `${f(a)} ${ch.currency||'points'}`;
}
export const isDone=ch=>ch.done??(ch.status==='unlocked'||(ch.progress_target!=null&&!ch.remaining_spend));
function ChallengeCard({ch,onOpen,onArchive,bonus}){
  const done=isDone(ch),risk=ch.at_risk;
  const open=onOpen?()=>onOpen(ch):null;
  return(
    <div className={`c-panel cds-ch ${risk?'risk':''}`} role={open?'button':undefined} tabIndex={open?0:undefined}
      onClick={open||undefined} onKeyDown={open?e=>{if(e.key==='Enter'&&e.target===e.currentTarget)open();}:undefined}
      title={open?'Open this card’s transactions for the challenge':undefined}>
      <figure><ChRing ch={{...ch,done}}/><figcaption>{done?'':'to go'}</figcaption></figure>
      <div className="cds-cht"><b>{ch.name}</b><span>{ch.card_name} {ch.last_four??''}</span>
        <span className="bonus">{bonusText(ch)}</span>
        {risk&&<span className="risk">At risk, {ch.days_left} day{ch.days_left===1?'':'s'} left</span>}</div>
      {bonus&&<div className="cds-bon" onClick={e=>e.stopPropagation()}>
        {bonus.state==='waiting'
          ?<><span className="w">Bonus waiting to post</span><button type="button" className="c-btn pri sm" onClick={bonus.onMark}>Mark posted</button></>
          :<><span className="p">✓ Bonus posted {bonus.date}</span>{bonus.undo&&<button type="button" className="c-btn sm" onClick={bonus.onUndo}>Undo</button>}</>}
      </div>}
      {onArchive&&done&&<button type="button" className="cds-arch" onClick={e=>{e.stopPropagation();onArchive(ch,!ch.is_archived);}}>{ch.is_archived?'Restore':'Archive'}</button>}
    </div>);
}
/* challenges: in-window challenges, each with at_risk/done (core/card_actions.py). */
export function ChallengeGrid({challenges,onOpen,onAdd,onArchive,bonusFor,title='Active challenges',rowRef}){
  const live=challenges.filter(c=>!c.is_archived),arch=challenges.filter(c=>c.is_archived);
  const key=c=>`${c.id}-${c.this_card_id??c.account_id}`;
  return(
    <section ref={rowRef}>
      <h2>{title} <span className="ct">{live.length}</span></h2>
      <div className={`cds-chg ${live.length?'':'none'}`} style={{'--chl':live.length}}>
        {live.map(c=><ChallengeCard key={key(c)} ch={c} onOpen={onOpen} onArchive={onArchive} bonus={bonusFor&&bonusFor(c)}/>)}
        {onAdd&&<button type="button" className="cds-add" aria-label="Add a challenge" onClick={onAdd}><span>+</span></button>}
      </div>
      {arch.length>0&&<details className="cds-archd"><summary>Show archived ({arch.length})</summary>
        <div className="cds-chg">{arch.map(c=><ChallengeCard key={key(c)} ch={c} onOpen={onOpen} onArchive={onArchive}/>)}</div></details>}
    </section>);
}
export async function archiveChallenge(ch,on,toast){
  try{await apiFetch(`/challenges/${ch.id}`,{method:'PATCH',body:JSON.stringify({is_archived:on})});toast&&toast(on?'Challenge archived':'Challenge restored');return true;}
  catch(e){toast&&toast(e.message||'Could not archive it','error');return false;}
}

/* ── Header bar ─────────────────────────────────────────────────────────── */
export function PeriodPicker({period,setPeriod,year,setYear,years}){
  return(
    <div className="cds-per">
      <div className="cds-und" role="group" aria-label="Period">
        {['mtd','qtd','ytd'].map(p=><button type="button" key={p} className={period===p?'on':''} aria-pressed={period===p} onClick={()=>setPeriod(p)}>{p.toUpperCase()}</button>)}
      </div>
      {setYear&&<select className="cds-yr" aria-label="Year" value={year} onChange={e=>setYear(Number(e.target.value))}>
        {years.map(y=><option key={y} value={y}>{y}</option>)}</select>}
    </div>);
}
export function Crumbs({items}){
  return(<nav className="cds-crumbs" aria-label="Breadcrumb">
    {items.map((it,i)=>[i>0&&<i key={'s'+i} aria-hidden="true">›</i>,
      it.onClick?<button type="button" key={i} onClick={it.onClick}>{it.label}</button>:<b key={i} aria-current="page">{it.label}</b>])}
  </nav>);
}

/* ── Actions strip ──────────────────────────────────────────────────────── */
function Countdown({days,span}){
  const r=20,C=2*Math.PI*r,pc=Math.max(0,Math.min(1,days/(span||1)));
  return(<svg className="act-ring" viewBox="0 0 50 50" aria-hidden="true">
    <circle cx="25" cy="25" r={r} fill="none" stroke="var(--c-line)" strokeWidth="4.5"/>
    <circle cx="25" cy="25" r={r} fill="none" stroke="var(--uc)" strokeWidth="4.5" strokeLinecap="round" strokeDasharray={`${C*pc} ${C}`} transform="rotate(-90 25 25)"/>
    <text x="25" y="29" textAnchor="middle" fill="var(--c-tx)" fontSize="12" fontWeight="600">{days}d</text>
  </svg>);
}
const urg=d=>d<=14?'u-hi':d<=30?'u-md':'u-lo';
const UNDO_MS=5000,MIN_W=240,MORE_W=112,GAP=11;
function useFit(ref){
  const[n,setN]=useState({all:4,more:3});
  useLayoutEffect(()=>{
    const m=()=>{const el=ref.current;if(!el)return;const w=el.getBoundingClientRect().width;
      setN({all:Math.max(1,Math.floor((w+GAP)/(MIN_W+GAP))),more:Math.max(1,Math.floor((w-MORE_W)/(MIN_W+GAP)))});};
    m();const ro=new ResizeObserver(m);if(ref.current)ro.observe(ref.current);return()=>ro.disconnect();
  },[ref]);
  return n;
}
function StripRow({label,items,render}){
  const ref=useRef(null),fit=useFit(ref);
  const[open,setOpen]=useState(false);
  const fitsAll=items.length<=(fit.all||4);
  const k=fitsAll?items.length:(fit.more||3);
  const shown=open?items:items.slice(0,k),more=items.length-k;
  const style=open?undefined:{gridTemplateColumns:fitsAll?`repeat(${Math.max(fit.all||1,1)},minmax(0,1fr))`:`repeat(${k},minmax(0,1fr)) ${MORE_W}px`};
  return(
    <div>
      <p className="act-lbl">{label}</p>
      <div ref={ref} className={`act-row ${open?'open':''}`} style={style}>
        {shown.map(render)}
        {(more>0||open)&&!fitsAll&&<button type="button" className="act-more" onClick={()=>setOpen(o=>!o)}>{open?'Show fewer':`+${more} more`}</button>}
      </div>
    </div>);
}
function Head({it}){
  return <div className="act-ih"><CardThumb productKey={it.product_key} eco={it.card_name}/>
    <span>{it.card_name} {it.last_four}{it.person?` · ${it.person}`:''}</span></div>;
}
/* data: GET /api/cards/actions (core/card_actions.py). */
export function ActionsStrip({data,reload,onOpenChallenge,toast}){
  const[marked,setMarked]=useState({});   // key -> use id, during the 5 seconds of Undo
  const[gone,setGone]=useState({});
  const[out,setOut]=useState({});
  const timers=useRef({});
  useEffect(()=>()=>Object.values(timers.current).forEach(clearTimeout),[]);
  useEffect(()=>{setGone({});setOut({});},[data]);
  if(!data)return null;
  const key=x=>`${x.card_id}:${x.benefit_id}`;
  const credits=data.credits.filter(x=>!gone[key(x)]);
  const risk=data.at_risk;
  const total=credits.reduce((t,x)=>t+(marked[key(x)]?0:x.left),0);
  const finish=()=>{if(!Object.keys(timers.current).length)reload&&reload();};
  const mark=async x=>{
    const k=key(x);if(marked[k])return;
    try{
      const r=await apiFetch(`/cards/${x.card_id}/benefits/${x.benefit_id}/mark-used`,{method:'POST',body:JSON.stringify({})});
      setMarked(m=>({...m,[k]:r.use_id}));
      timers.current[k]=setTimeout(()=>{
        setOut(o=>({...o,[k]:true}));
        timers.current[k]=setTimeout(()=>{
          delete timers.current[k];
          setMarked(m=>{const n={...m};delete n[k];return n;});
          setGone(g=>({...g,[k]:true}));finish();
        },300);
      },UNDO_MS);
    }catch(e){toast&&toast(e.message||'Could not mark it used','error');}
  };
  const undo=async(x,ev)=>{
    ev.stopPropagation();const k=key(x),id=marked[k];if(!id)return;
    clearTimeout(timers.current[k]);delete timers.current[k];
    try{await apiFetch(`/benefit-usage/${id}`,{method:'DELETE'});setMarked(m=>{const n={...m};delete n[k];return n;});}
    catch(e){toast&&toast(e.message||'Undo failed','error');}
  };
  const credit=x=>{const k=key(x),m=marked[k];return(
    <div key={k} className={`c-panel act-it cr ${urg(x.days)} ${m?'used':''} ${out[k]?'out':''}`} role="button" tabIndex={0}
      aria-label={m?`${x.name} marked used. Undo available.`:`Mark ${x.name} on ${x.card_name} ${x.last_four} as used`}
      onClick={()=>mark(x)} onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&e.target===e.currentTarget){e.preventDefault();mark(x);}}}>
      <Head it={x}/>
      <div className="act-ib"><Countdown days={x.days} span={x.span}/>
        <span className="t"><b title={x.name}>{x.name}</b><small><em>{usd(x.left)}</em> left, by {mdy(x.end)}</small></span></div>
      <span className="act-o" aria-hidden="true"><i>✓</i></span>
      {m&&<span className="act-s"><span className="act-s-t"><i>✓</i>Marked used</span>
        <button type="button" className="c-btn sm" onClick={e=>undo(x,e)}>Undo</button><span className="act-tm"/></span>}
    </div>);};
  const challenge=c=>(
    <div key={`${c.id}-${c.this_card_id}`} className={`c-panel act-it ch ${urg(c.days_left)}`} role="button" tabIndex={0}
      aria-label={`Open ${c.name} on ${c.card_name} ${c.last_four??''}`}
      onClick={()=>onOpenChallenge(c)} onKeyDown={e=>{if(e.key==='Enter'&&e.target===e.currentTarget)onOpenChallenge(c);}}>
      <Head it={{...c,last_four:c.last_four??''}}/>
      <div className="act-ib"><Countdown days={c.days_left} span={c.span}/>
        <span className="t"><b title={c.name}>{c.name}</b><small><em>{usd0(c.remaining_spend)}</em> to go, by {mdy(c.end_date)}</small></span></div>
      <span className="act-go" aria-hidden="true">›</span>
    </div>);
  const nCred=credits.filter(x=>!marked[key(x)]).length;
  if(!credits.length&&!risk.length){
    const nx=data.next;
    return(<section className="c-panel act-none"><b>Actions</b><span><span className="ok">✓</span> All caught up for the next {data.within} days.
      {nx&&<> Next: <b>{nx.name}</b> on {nx.card_name} {nx.last_four}, {usd(nx.left)} by {mdy(nx.end)}.</>}</span></section>);
  }
  return(
    <section>
      <div className="act-h"><h2>Actions</h2>
        <div className="act-chips">
          {nCred>0&&<span className="act-chip"><i className="a"/>{nCred} credit{nCred===1?'':'s'}, {usd(total)}</span>}
          {risk.length>0&&<span className="act-chip"><i className="r"/>{risk.length} challenge{risk.length===1?'':'s'} at risk</span>}
        </div>
      </div>
      <div className="act-rows">
        {credits.length>0&&<StripRow label="Credits expiring" items={credits} render={credit}/>}
        {risk.length>0&&<StripRow label="Challenges at risk" items={risk} render={challenge}/>}
      </div>
    </section>);
}

export function useActions(ecoId,reloadKey){
  const[A,setA]=useState(null);
  const load=useCallback(()=>apiFetch(`/cards/actions${ecoId?`?ecosystem_id=${ecoId}`:''}`).then(setA).catch(()=>setA(null)),[ecoId]);
  useEffect(()=>{load();},[load,reloadKey]);
  return{A,load};
}
