/* A program's page on desktop (docs/cards-ecosystem-design.md): header
   strip, Actions, Balance ledger, Points by category, Your cards, Active
   challenges and Activity. From the points ledger's start date (2027-01-01)
   the ledger and Activity come from components/ledger; before it, the older
   balances, with their starting balances and adjustments in side panels. */
import {useState,useEffect,useMemo,useCallback} from 'react';
import {apiFetch} from '../../lib/api';
import {usePointsLedger,LedgerCards,LedgerActivity,LedgerPanels} from '../../components/ledger/PointsLedger';
import {ActionsStrip,CardRow,ChallengeGrid,ProgramLogo,usePageTheme,archiveChallenge,f,sg,md,usd2,gradFor} from '../../components/cards/CardsCommon';
import {ChallengePanel} from '../../components/cards/CardPanels';
import {RedemptionPanel,TransferPanel,BetweenPanel,StartingBalancePanel,LegacyAdjustPanel} from '../../components/cards/ProgramPanels';
import '../../components/ledger/ledger.css';

export function EcosystemDesktop({ecoId,ecoName,period,year,wallet,onOpenCard,toast,reloadKey,onChanged}){
  const theme=usePageTheme();
  const isCash=ecoId==='cash-back';
  const[data,setData]=useState(null);
  const[err,setErr]=useState(false);
  const[A,setA]=useState(null);
  const[panel,setPanel]=useState(null);   // {t:'red'|'xfer'|'p2p'|'start'|'adj'|'ch', ...}
  const[snaps,setSnaps]=useState([]);
  const[ecos,setEcos]=useState([]);
  const[cats,setCats]=useState([]);
  const[spenders,setSpenders]=useState([]);
  const[bonusUndo,setBonusUndo]=useState({});
  const[bump,setBump]=useState(0);
  const load=useCallback(()=>{setErr(false);return apiFetch(isCash?`/ecosystems/cash-back/earn-detail?period=${period}&year=${year}`:`/ecosystems/${ecoId}/earn-detail?period=${period}&year=${year}`)
    .then(setData).catch(()=>{setErr(true);});},[ecoId,isCash,period,year]);
  useEffect(()=>{load();},[load,reloadKey,bump]);
  const myCards=useMemo(()=>wallet.filter(c=>isCash?c.is_cash_back:c.ecosystem_id===ecoId),[wallet,ecoId,isCash]);
  const acctIds=useMemo(()=>new Set(myCards.map(c=>c.account_id)),[myCards]);
  const loadA=useCallback(()=>apiFetch(`/cards/actions${isCash?'':`?ecosystem_id=${ecoId}`}`).then(setA).catch(()=>setA(null)),[ecoId,isCash]);
  useEffect(()=>{loadA();},[loadA,reloadKey,bump]);
  const Ascoped=useMemo(()=>{
    if(!A||!isCash)return A;
    const inS=x=>acctIds.has(x.account_id);
    const cr=A.credits.filter(inS);
    return{...A,credits:cr,credits_total:cr.reduce((t,x)=>t+x.left,0),at_risk:A.at_risk.filter(inS),challenges:A.challenges.filter(inS),next:A.next&&inS(A.next)?A.next:null};
  },[A,isCash,acctIds]);
  const loadSnaps=useCallback(()=>{if(!isCash)apiFetch(`/ecosystems/${ecoId}/balance-snapshots`).then(setSnaps).catch(()=>{});},[ecoId,isCash]);
  useEffect(()=>{loadSnaps();},[loadSnaps,bump]);
  useEffect(()=>{apiFetch('/ecosystems').then(setEcos).catch(()=>{});
    apiFetch('/points-categories').then(c=>setCats((c||[]).filter(x=>x.is_active!==false))).catch(()=>{});
    apiFetch('/transactions/spenders').then(setSpenders).catch(()=>{});},[]);

  const ledgerOn=!!data?.ledger_active&&!isCash;
  const lg=usePointsLedger(ledgerOn?ecoId:null,{reloadKey:data,toast});
  const people=useMemo(()=>ledgerOn&&lg.L?lg.L.people:(data?.known_people||[]),[ledgerOn,lg.L,data]);
  const changed=()=>{setPanel(null);setBump(b=>b+1);onChanged&&onChanged();};
  const per=period.toUpperCase();

  /* challenge bonuses waiting to post (points ledger) */
  const dropUndo=id=>setBonusUndo(u=>{const n={...u};delete n[id];return n;});
  const bonusFor=ch=>{
    if(!ledgerOn||!lg.L)return null;
    const e=lg.L.entries.find(x=>x.kind==='bonus'&&x.challenge_id===ch.id);
    if(!e)return null;
    const[,m,d]=e.date.split('-');
    return e.status==='pending'
      ?{state:'waiting',onMark:async()=>{try{lg.setL(await apiFetch(`/challenges/${ch.id}/bonus-posted`,{method:'POST',body:'{}'}));setBonusUndo(u=>({...u,[ch.id]:true}));setTimeout(()=>dropUndo(ch.id),5000);}catch(x){toast(x.message,'error');}}}
      :{state:'posted',date:`${Number(m)}/${Number(d)}`,undo:!!bonusUndo[ch.id],onUndo:async()=>{try{lg.setL(await apiFetch(`/challenges/${ch.id}/bonus-posted`,{method:'DELETE'}));dropUndo(ch.id);toast('Bonus back to waiting');}catch(x){toast(x.message,'error');}}};
  };
  const openChallenge=c=>c.account_id&&onOpenCard(c.account_id,{id:c.id,start:c.start_date,end:c.end_date,name:c.name});
  const archive=async(c,on)=>{if(await archiveChallenge(c,on,toast))loadA();};

  if(err)return <p className="cds-mut">Couldn’t load {ecoName}.</p>;
  if(!data)return <p className="cds-mut">Loading…</p>;

  /* ── Header strip ── */
  const L=ledgerOn?lg.L:null;
  const unsetP=p=>L&&!L.balances[p]?.has_opening;
  const big=isCash?usd2((data.total_points||0)*.01):L?(people.length&&people.every(unsetP)?'—':f(L.total.current)):f(data.current_balance);
  const pending=L?L.total.pending_cards+L.total.pending_bonus:(data.pending_balance||0);
  const personBal=p=>L?(unsetP(p)?'—':f(L.balances[p]?.current)):f(data.balance_by_person?.[p]?.current_balance);
  const fan=myCards.slice(0,3),more=myCards.length-3;
  const header=(
    <section className="c-panel eco-h">
      <div className="eco-a"><div className="eco-lgo"><ProgramLogo name={isCash?'Cash Back':data.name||ecoName} theme={theme}/></div>
        <small>{myCards.length} card{myCards.length===1?'':'s'} linked{isCash?'':`, ${data.currency_name}`}</small></div>
      <div><small className="eco-lab">{isCash?'Cash back earned':'Current balance, posted'}</small><div className="c-val eco-big">{big}</div></div>
      <div className="eco-sts">
        {!isCash&&people.map(p=><div key={p} className="eco-st"><span>{p}</span><b className="c-val">{personBal(p)}</b></div>)}
        {!isCash&&<div className="eco-st"><span>Pending</span><b className="c-val pend">{f(pending)}</b></div>}
        <div className="eco-st"><span>Earned {per}</span><b className="c-val up">{isCash?usd2((data.total_points||0)*.01):`+${f(data.total_points)}`}</b></div>
      </div>
      {fan.length>0&&<div className="eco-fan" aria-hidden="true">
        {fan.map(c=><span key={c.account_id} className="eco-fc" style={{background:gradFor(c.ecosystem||ecoName)}}>{c.product_key&&<img src={`/static/cards/${c.product_key}.png`} alt="" onError={e=>{e.currentTarget.style.display='none';}}/>}</span>)}
        {more>0&&<span className="eco-fc more">+{more}</span>}</div>}
    </section>);

  /* ── Points by category ── */
  const catList=data.by_category||[],maxPts=Math.max(1,...catList.map(c=>c.points));
  const cats_=catList.length>0&&<section>
    <h2>{isCash?'Cash back':'Points'} by category <span className="ct">{per}</span></h2>
    <div className="c-panel cds-pn"><div className="eco-bars">{catList.map(c=>(
      <div key={c.category||'Other'} className="eco-cb"><span title={c.category||'Other'}>{c.category==='Other'||!c.category?'All other purchases':c.category}</span>
        <div className="cds-bar"><i style={{width:`${Math.max(0,c.points)/maxPts*100}%`}}/></div>
        <b>{isCash?usd2(c.points*.01):f(c.points)}</b><em>{Math.round(c.pct)}%</em></div>))}</div></div>
  </section>;

  /* ── Your cards, with whose card and this period's points ── */
  const ptsBy=Object.fromEntries((data.by_card||[]).map(c=>[c.account_id,c.points]));
  const caption=c=><><span>{c.owner||'Unassigned'}</span><b>{isCash?usd2((ptsBy[c.account_id]||0)*.01):`${f(ptsBy[c.account_id]||0)} pts`}</b></>;

  const challenges=Ascoped?Ascoped.challenges:[];
  return(<>
    {header}
    <ActionsStrip data={Ascoped} reload={loadA} onOpenChallenge={openChallenge} toast={toast}/>
    {!isCash&&(ledgerOn
      ?<LedgerCards lg={lg} onBetween={()=>setPanel({t:'p2p'})} onOpenCard={id=>onOpenCard(id)}/>
      :<LegacyLedger data={data} people={people} snaps={snaps} onBetween={()=>setPanel({t:'p2p'})}
        onStart={(p,snap)=>setPanel({t:'start',person:p,snap,suggest:data.balance_by_person?.[p]?.current_balance})}/>)}
    {cats_}
    <CardRow cards={myCards} onOpen={id=>onOpenCard(id)} caption={caption}/>
    <ChallengeGrid challenges={challenges} onOpen={openChallenge} onArchive={archive} bonusFor={bonusFor} onAdd={()=>setPanel({t:'ch'})}/>
    {!isCash&&(ledgerOn
      ?<LedgerActivity lg={lg} onRedemption={()=>setPanel({t:'red'})} onTransfer={()=>setPanel({t:'xfer'})} onBetween={()=>setPanel({t:'p2p'})}
        onEditRedemption={id=>{const r=data.redemptions.find(x=>x.id===id);if(r)setPanel({t:'red',r});}}
        onEditBetween={id=>{const pt=(data.person_transfers||[]).find(x=>x.id===id);if(pt)setPanel({t:'p2p',pt});}}
        onDeleteTransfer={async id=>{if(!window.confirm('Delete this transfer?'))return;try{await apiFetch(`/transfers/${id}`,{method:'DELETE'});toast('Transfer deleted');changed();}catch(e){toast(e.message,'error');}}}/>
      :<LegacyActivity data={data} people={people} onAdd={t=>setPanel({t})} onEdit={(t,x)=>setPanel({t,...x})}
        onDeleteTransfer={async id=>{if(!window.confirm('Delete this transfer?'))return;try{await apiFetch(`/transfers/${id}`,{method:'DELETE'});toast('Transfer deleted');changed();}catch(e){toast(e.message,'error');}}}/>)}

    {ledgerOn&&<LedgerPanels lg={lg} ecoId={ecoId} ecoName={ecoName} legacy={data.legacy_balance_by_person} toast={toast} onChanged={()=>{setBump(b=>b+1);onChanged&&onChanged();}}/>}
    {panel?.t==='red'&&<RedemptionPanel ecoId={ecoId} ecoName={ecoName} people={people} r={panel.r} toast={toast} onClose={()=>setPanel(null)} onSaved={changed}/>}
    {panel?.t==='xfer'&&<TransferPanel ecoId={ecoId} ecoName={ecoName} people={people} ecosystems={ecos} toast={toast} onClose={()=>setPanel(null)} onSaved={changed}/>}
    {panel?.t==='p2p'&&<BetweenPanel ecoId={ecoId} people={people.length>1?people:['Omer','Daniella']} pt={panel.pt} toast={toast} onClose={()=>setPanel(null)} onSaved={changed}/>}
    {panel?.t==='start'&&<StartingBalancePanel ecoId={ecoId} person={panel.person} snap={panel.snap} suggest={panel.suggest} toast={toast} onClose={()=>setPanel(null)} onSaved={()=>{loadSnaps();changed();}}/>}
    {panel?.t==='adj'&&<LegacyAdjustPanel ecoId={ecoId} people={people} a={panel.a} toast={toast} onClose={()=>setPanel(null)} onSaved={changed}/>}
    {panel?.t==='ch'&&<ChallengePanel ch={null} cards={myCards} categories={cats} people={[...new Set(['Omer','Daniella',...spenders])]} toast={toast}
      onClose={()=>setPanel(null)} onSaved={()=>{setPanel(null);loadA();onChanged&&onChanged();}}/>}
  </>);
}

/* ── Before the points ledger: one card per person, Total first ─────────── */
const LROWS=[['Earned',b=>b.earned_since_baseline],['Pending, not yet posted',b=>-(b.pending_since_baseline||0)],
  ['Redeemed',b=>-(b.redeemed_since_baseline||0)],['Transferred out',b=>-(b.transferred_out_since_baseline||0)],
  ['Transferred in',b=>b.transferred_in_since_baseline||0],['Adjusted',b=>b.adjusted_since_baseline||0],
  ['Sent to other',b=>-(b.person_transfer_out_since_baseline||0)],['Received from other',b=>b.person_transfer_in_since_baseline||0]];
const tone=v=>v>0?'up':v<0?'neg':'mut';
function LegacyLedger({data,people,snaps,onBetween,onStart}){
  const B=data.balance_by_person||{};
  const ppl=people.filter(p=>B[p]);
  const all=[...ppl.map(p=>B[p]),...(B.Shared?[B.Shared]:[])];
  const sum=get=>all.reduce((t,b)=>t+(get(b)||0),0);
  const rows=LROWS.filter(([,get])=>all.some(b=>Math.abs(get(b)||0)>=.5));
  const startFor=p=>{const l=snaps.filter(s=>(s.person||'Shared')===p);return l.length?l[l.length-1]:null;};
  const card=(name,b,get,isTot)=>(
    <div key={name} className={`lgr-p ${isTot?'tot':''}`}>
      <div className="lgr-ph"><b>{name}</b></div>
      <div className="c-val lgr-cur">{f(isTot?data.current_balance:b.current_balance)}</div>
      <dl><dt>Starting balance</dt><dd>{f(get(x=>x.starting_balance))}</dd>
        {rows.map(([l,g])=>{const v=get(g);return [<dt key={l+'t'}>{l}</dt>,<dd key={l+'d'} className={tone(v)}>{sg(v)}</dd>];})}</dl>
    </div>);
  const shared=B.Shared&&(B.Shared.starting_balance||0)>0;
  return(
    <section className="cloud lgr">
      <div className="lgr-sh"><h2>Balance ledger</h2>{ppl.length>1&&<button type="button" className="c-btn sm" onClick={onBetween}>+ Transfer between us</button>}</div>
      <div className="c-panel lgr-pn">
        <div className="lgr-people">{card('Total',null,g=>sum(g),true)}{ppl.map(p=>card(p,B[p],g=>g(B[p])||0,false))}</div>
        {shared&&<p className="eco-leg">{f(B.Shared.starting_balance)} of the starting balance has no person assigned{B.Shared.balance_as_of?` (as of ${B.Shared.balance_as_of})`:''}. It counts in Total only.</p>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:14}}>
          {ppl.map(p=>{const s=startFor(p);return <button type="button" key={p} className="c-btn sm" onClick={()=>onStart(p,s)}>{s?'Edit':'Set'} {p}’s starting balance</button>;})}
          {shared&&<button type="button" className="c-btn sm" onClick={()=>onStart('Shared',startFor('Shared'))}>Edit the shared starting balance</button>}
        </div>
      </div>
    </section>);
}

/* ── Before the points ledger: Activity as a one-line table ─────────────── */
const CH=['','Redemption','Transfer','Adjustment','Between us'];
function LegacyActivity({data,people,onAdd,onEdit,onDeleteTransfer}){
  const[kf,setKf]=useState('');
  const rows=useMemo(()=>{
    const R=[];
    for(const r of data.redemptions||[])R.push({k:'Redemption',g:'r',date:r.redemption_date,desc:r.description,det:`$${(r.cash_value_usd||0).toFixed(2)} realized`,who:r.person,pts:-r.points_redeemed,edit:()=>onEdit('red',{r})});
    for(const t of data.transfers_out||[])R.push({k:'Transfer',tag:'Transfer out',g:'t',date:t.transfer_date,desc:`To ${t.destination_ecosystem_name}`,det:`${f(t.points_sent)} sent, ${f(t.points_received)} received, ratio 1:${t.base_ratio_used}`,who:t.person,pts:-t.points_sent,del:()=>onDeleteTransfer(t.id)});
    for(const t of data.transfers_in||[])R.push({k:'Transfer',tag:'Transfer in',g:'t',date:t.transfer_date,desc:`From ${t.source_ecosystem_name}`,det:`${f(t.points_sent)} sent, ${f(t.points_received)} received, ratio 1:${t.base_ratio_used}`,who:t.to_person,pts:t.points_received,del:()=>onDeleteTransfer(t.id)});
    for(const a of data.adjustments||[])R.push({k:'Adjustment',g:'a',date:a.adjustment_date,desc:a.description,det:a.notes||'',who:a.person,pts:a.points_delta,edit:()=>onEdit('adj',{a})});
    for(const p of data.person_transfers||[])R.push({k:'Between us',g:'t',date:p.transfer_date,desc:`${p.from_person} to ${p.to_person}`,det:`${f(p.points)} points. Same program, nets to zero`,who:p.from_person,pts:0,edit:()=>onEdit('p2p',{pt:p})});
    return R.filter(r=>!kf||r.k===kf).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  },[data,kf]);// eslint-disable-line react-hooks/exhaustive-deps
  const rp=data.total_points_redeemed||0,cash=data.total_cash_value_usd||0;
  const idx=p=>Math.max(0,people.indexOf(p));
  return(
    <section className="cloud lgr">
      <div className="lgr-sh"><h2>Activity</h2>
        <span className="lgr-btns">
          <button type="button" className="c-btn sm" onClick={()=>onAdd('red')}>+ Redemption</button>
          <button type="button" className="c-btn sm" onClick={()=>onAdd('xfer')}>+ Transfer</button>
          <button type="button" className="c-btn sm" onClick={()=>onAdd('adj')}>+ Adjustment</button>
          {people.length>1&&<button type="button" className="c-btn sm" onClick={()=>onAdd('p2p')}>+ Between us</button>}
        </span></div>
      <div className="c-panel lgr-pn">
        {rp>0&&<div className="lgr-rs">
          <div><span>Points redeemed</span><b className="c-val">{f(rp)}</b></div>
          <div><span>Cash value realized</span><b className="c-val">${cash.toFixed(2)}</b></div>
          <div><span>Realized ¢ per point</span><b className="c-val">{(cash/rp*100).toFixed(2)}¢</b></div>
        </div>}
        <div className="lgr-chips"><span>{CH.map(c=><button type="button" key={c||'all'} className={`c-fb ${kf===c?'on':''}`} onClick={()=>setKf(c)}>{c||'All'}</button>)}</span></div>
        {!rows.length?<p className="mut">{kf?'Nothing of this type yet.':`No redemptions, transfers or adjustments logged for ${data.name} yet.`}</p>
        :<div className="lgr-tw"><table className="lgr-t eco-lt">
          <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Details</th><th>Owner</th><th className="n">Points</th><th/></tr></thead>
          <tbody>{rows.map((r,i)=>(
            <tr key={i}>
              <td className="d">{md(r.date)}</td>
              <td><span className={`lgr-tp g-${r.g}`}>{r.tag||r.k}</span></td>
              <td className="ds" title={r.desc}>{r.desc}</td>
              <td className="dt" title={r.det}>{r.det}</td>
              <td>{r.who?<span className={`lgr-oc p-${idx(r.who)}`} title={r.who} aria-label={r.who}>{r.who[0]}</span>:<span className="mut">Shared</span>}</td>
              <td className={`n ${tone(r.pts)}`}>{r.k==='Between us'?'±0':sg(r.pts)}</td>
              <td className="ac">{r.edit?<button type="button" className="c-btn sm lgr-ed" onClick={r.edit}>Edit</button>
                :r.del?<button type="button" className="c-btn sm lgr-ed" onClick={r.del}>Delete</button>:null}</td>
            </tr>))}</tbody></table></div>}
      </div>
    </section>);
}
