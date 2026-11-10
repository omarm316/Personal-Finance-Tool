/* Portfolio on desktop (docs/cards-portfolio-design.md): Actions, Rewards
   programs, Your cards, Active challenges. */
import {useState,useEffect,useMemo,useCallback} from 'react';
import {apiFetch} from '../../lib/api';
import {ActionsStrip,useActions,CardRow,ChallengeGrid,ProgramLogo,usePageTheme,archiveChallenge,f,usd2} from '../../components/cards/CardsCommon';
import {ChallengePanel} from '../../components/cards/CardPanels';

export function PortfolioDesktop({period,year,wallet,onOpenEco,onOpenCard,toast,reloadKey,onChanged}){
  const theme=usePageTheme();
  const[earn,setEarn]=useState(null);
  const[err,setErr]=useState(false);
  const[ledger,setLedger]=useState(null);
  const[panel,setPanel]=useState(null);
  const[cats,setCats]=useState([]);
  const[people,setPeople]=useState(['Omer','Daniella']);
  const[bonusUndo,setBonusUndo]=useState({});
  const{A,load:loadA}=useActions(null,reloadKey);
  useEffect(()=>{setErr(false);apiFetch(`/cards/earn-summary?period=${period}&year=${year}`).then(setEarn).catch(()=>{setEarn(null);setErr(true);});},[period,year,reloadKey]);
  const loadLedger=useCallback(()=>apiFetch('/points-ledger').then(setLedger).catch(()=>setLedger(null)),[]);
  useEffect(()=>{loadLedger();},[loadLedger,reloadKey]);
  useEffect(()=>{apiFetch('/points-categories').then(c=>setCats((c||[]).filter(x=>x.is_active!==false))).catch(()=>{});
    apiFetch('/transactions/spenders').then(s=>setPeople(p=>[...new Set([...p,...s])])).catch(()=>{});},[]);
  const ledgerOn=!!ledger?.active;
  const byEco=useMemo(()=>Object.fromEntries((ledger?.programs||[]).map(p=>[p.ecosystem_id,p])),[ledger]);
  const per=period.toUpperCase();

  const programs=useMemo(()=>{
    if(!earn)return[];
    return earn.ecosystems.filter(e=>!e.is_cash_back)
      .map(e=>({...e,bal:e.current_balance??e.points_earned}))
      .sort((a,b)=>b.bal-a.bal);
  },[earn]);
  const cashTotal=earn?earn.cash_back.total+earn.ecosystems.filter(e=>e.is_cash_back).reduce((t,e)=>t+e.est_value,0):0;
  const hasCash=cashTotal>0||wallet.some(c=>c.is_cash_back);

  const dropUndo=id=>setBonusUndo(u=>{const n={...u};delete n[id];return n;});
  const bonusFor=ch=>{
    if(!ledgerOn)return null;
    for(const p of ledger.programs){
      if(p.pending_bonus_challenges.includes(ch.id))return{state:'waiting',onMark:async()=>{
        try{await apiFetch(`/challenges/${ch.id}/bonus-posted`,{method:'POST',body:'{}'});setBonusUndo(u=>({...u,[ch.id]:true}));setTimeout(()=>dropUndo(ch.id),5000);loadLedger();}
        catch(e){toast(e.message,'error');}}};
      const posted=(p.posted_bonus||[]).find(b=>b.challenge_id===ch.id);
      if(posted){const[,m,d]=posted.date.split('-');return{state:'posted',date:`${Number(m)}/${Number(d)}`,undo:!!bonusUndo[ch.id],onUndo:async()=>{
        try{await apiFetch(`/challenges/${ch.id}/bonus-posted`,{method:'DELETE'});dropUndo(ch.id);toast('Bonus back to waiting');loadLedger();}
        catch(e){toast(e.message,'error');}}};}
    }
    return null;
  };
  const openChallenge=c=>c.account_id&&onOpenCard(c.account_id,{id:c.id,start:c.start_date,end:c.end_date,name:c.name});
  const archive=async(c,on)=>{if(await archiveChallenge(c,on,toast)){loadA();}};

  return(<>
    <ActionsStrip data={A} reload={loadA} onOpenChallenge={openChallenge} toast={toast}/>

    {ledgerOn&&ledger.opening_set<ledger.opening_needed&&<section className="cds-jan">
      <div><b>Start the points ledger</b>
        <span>Set each program’s {new Date(ledger.start+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} balance on its own ledger. Still to set:</span>
        <span className="chips">{ledger.programs.filter(p=>p.unset.length).map(p=><button type="button" key={p.ecosystem_id} className="c-fb" onClick={()=>onOpenEco(p.ecosystem_id,p.name)}>{p.name}</button>)}</span></div>
      <span>{ledger.opening_set} of {ledger.opening_needed} set</span>
    </section>}

    <section>
      <h2>Rewards programs</h2>
      {!earn?<p className="cds-mut">{err?'Couldn’t load the programs.':'Loading…'}</p>:
      <div className="cds-tiles">
        {programs.map(e=>{
          const lp=ledgerOn?byEco[e.id]:null,unset=lp&&!lp.has_opening,stale=lp&&lp.has_opening&&lp.stale.length>0;
          return(<button type="button" key={e.id} className="c-panel cds-tile" onClick={()=>onOpenEco(e.id,e.name)} title={e.name}>
            {stale&&<span className="cds-dot" title={`Not checked in 60 days: ${lp.stale.join(', ')}`} aria-label={`Not checked in 60 days: ${lp.stale.join(', ')}`}/>}
            <ProgramLogo name={e.name} theme={theme}/>
            <span className="cds-tb"><b className="c-val cds-v">{unset?'—':f(e.bal)}</b>
              <span className="cds-meta">
                {unset?<span className="mut">Not set</span>:<span className={e.points_earned>0?'up':'mut'}>+{f(e.points_earned)} {per}</span>}
                {e.pending_balance>0&&<span className="pend">{f(e.pending_balance)} pending</span>}
              </span></span>
          </button>);})}
        {hasCash&&<button type="button" className="c-panel cds-tile" onClick={()=>onOpenEco('cash-back','Cash Back')}>
          <span className="cds-mono cds-cash"><i>$</i><span>Cash Back</span></span>
          <span className="cds-tb"><b className="c-val cds-v up">{usd2(cashTotal)}</b><span className="cds-meta"><span className="mut">earned {per}</span></span></span>
        </button>}
      </div>}
    </section>

    <CardRow cards={wallet} onOpen={id=>onOpenCard(id)} ownerChips/>

    {A&&<ChallengeGrid challenges={A.challenges} onOpen={openChallenge} onArchive={archive} bonusFor={bonusFor}
      onAdd={()=>setPanel({})}/>}

    {panel&&<ChallengePanel ch={null} cards={wallet} categories={cats} people={people} toast={toast}
      onClose={()=>setPanel(null)} onSaved={()=>{setPanel(null);loadA();onChanged&&onChanged();}}/>}
  </>);
}
