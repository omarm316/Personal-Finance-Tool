/* A card's page on desktop (docs/cards-card-design.md): breadcrumb header,
   color banner with the ⋯ menu, Active challenges beside Expiring credits,
   then Transactions in the main column and Earnings over Benefits in the side
   column. Benefits, Expiring credits and Log credit use are the step 4
   components (components/benefits). */
import {useState,useEffect,useMemo,useRef,useCallback} from 'react';
import {apiFetch} from '../../lib/api';
import {Popover} from '../../components/ui/Popover';
import {useCardBenefits,ExpiringCredits,BenefitsPanel,LogCreditUse} from '../../components/benefits/Benefits';
import {CardFace,ChallengeGrid,PeriodPicker,Crumbs,archiveChallenge,gradFor,f,usd0,usd2} from '../../components/cards/CardsCommon';
import {ChangeProductPanel,ProductHistoryPanel,EditCardPanel,CloseCardPanel,ChallengePanel} from '../../components/cards/CardPanels';
import {CardTxnTable} from './CardTxnTable';

export function CardDesktop({accountId,challenge,period,setPeriod,wallet,crumbs,toast,reloadKey,onChanged,onClosed}){
  const[d,setD]=useState(null);
  const[err,setErr]=useState(false);
  const[A,setA]=useState(null);
  const[products,setProducts]=useState([]);
  const[cats,setCats]=useState([]);
  const[people,setPeople]=useState(['Omer','Daniella']);
  const[panel,setPanel]=useState(null);    // {t:'product'|'history'|'edit'|'close'|'ch', ch?}
  const[menu,setMenu]=useState(null);
  const[addBen,setAddBen]=useState(0);
  const[lcTxn,setLcTxn]=useState(null);
  const[txKey,setTxKey]=useState(0);
  const[range,setRange]=useState(challenge?.start?{start:challenge.start.slice(0,10),end:challenge.end.slice(0,10),name:challenge.name}:null);
  const benRef=useRef(null),txRef=useRef(null),chRef=useRef(null);
  const load=useCallback(()=>{setErr(false);return apiFetch(`/accounts/${accountId}/card-detail?period=${period}`).then(setD).catch(()=>setErr(true));},[accountId,period]);
  useEffect(()=>{load();},[load,reloadKey]);
  const loadA=useCallback(()=>apiFetch('/cards/actions').then(setA).catch(()=>setA(null)),[]);
  useEffect(()=>{loadA();},[loadA,reloadKey]);
  useEffect(()=>{apiFetch('/card-products').then(setProducts).catch(()=>{});
    apiFetch('/points-categories').then(c=>setCats((c||[]).filter(x=>x.is_active!==false))).catch(()=>{});
    apiFetch('/transactions/spenders').then(s=>setPeople(p=>[...new Set([...p,...s])])).catch(()=>{});},[]);
  const cardId=d?.card?.id;
  const ben=useCardBenefits(cardId,{toast,reloadKey:txKey});
  useEffect(()=>{if(range&&d&&txRef.current)setTimeout(()=>txRef.current&&txRef.current.scrollIntoView({block:'start'}),150);},[!!d]);// eslint-disable-line react-hooks/exhaustive-deps

  const mine=useMemo(()=>(A?.challenges||[]).filter(c=>c.this_card_id===cardId),[A,cardId]);
  const hdr=eco=>(<header className="c-panel cds-hdr">
    <Crumbs items={[...crumbs(eco),{label:d?(d.card?.card_name||d.account.name):'Card'}]}/>
    <PeriodPicker period={period} setPeriod={setPeriod}/></header>);
  if(err)return <>{hdr(null)}<p className="cds-mut">Couldn’t load this card.</p></>;
  if(!d)return <>{hdr(null)}<p className="cds-mut">Loading…</p></>;

  const acct=d.account,c=d.card,p=d.product,eco=d.ecosystem;
  const w=wallet.find(x=>x.account_id===accountId);
  const face={name:p?.card_name||c?.card_name||acct.name,product_key:p?.product_key,mask:acct.mask||(c?.last_four!=null?String(c.last_four).padStart(4,'0'):''),ecosystem:eco?.name};
  const name=p?.card_name||c?.card_name||acct.name;
  const owner=w?.owner;
  const afs=d.annual_fee_summary,feeAct=afs&&(afs.fee_charged>0||afs.credits_received>0);
  const util=d.utilization;
  const per=period.toUpperCase();
  const cur=eco?.is_cash_back?null:(eco?.currency_name||'points');
  const earned=d.points_earned?.total||0;
  const reloadAll=()=>{load();loadA();setTxKey(k=>k+1);onChanged&&onChanged();};
  const showTxns=ch=>{setPanel(null);setRange({start:ch.start_date.slice(0,10),end:ch.end_date.slice(0,10),name:ch.name});setTimeout(()=>txRef.current&&txRef.current.scrollIntoView({block:'start',behavior:'smooth'}),60);};
  const archive=async(ch,on)=>{if(await archiveChallenge(ch,on,toast))loadA();};
  const item=(label,fn,cls='')=><button type="button" className={`c-mi ${cls}`} onClick={()=>{setMenu(null);fn();}}>{label}</button>;

  return(<>
    {hdr(eco)}
    <section className="crd-ban" style={{background:gradFor(eco?.name||name)}}>
      <div className="crd-t">
        <div style={{flex:1,minWidth:0}}>
          <div className="crd-ti"><h1>{name}</h1>
            {c&&<button type="button" className="crd-menu" aria-label="Manage card" aria-haspopup="menu" aria-expanded={!!menu} onClick={e=>setMenu(menu?null:e.currentTarget)}>⋯</button>}</div>
          <p>{acct.name}, {owner||'No owner'}{c?.network?` · ${c.network}`:''}{eco?` · ${eco.currency_name}`:''}</p>
        </div>
        <div className="crd-art"><CardFace card={face}/></div>
      </div>
      <div className="crd-bal"><small>Current balance</small><div className="c-val">{acct.balance<0?'−':''}{usd2(acct.balance)}</div></div>
      <div className="crd-b">
        <div className="crd-st"><span>Earned {per}</span><b className="c-val">{eco?.is_cash_back?usd2(earned*.01):`+${f(earned)}`}</b></div>
        {c&&<div className="crd-st"><span>Annual fee</span><b className="c-val" title={feeAct?`${usd0(afs.fee_charged)} in fees, ${usd0(afs.credits_received)} in statement credits this card year`:undefined}>{feeAct?`${afs.net_cost<0?'−':''}${usd0(Math.abs(afs.net_cost))} net`:usd0(c.annual_fee||0)}</b></div>}
        {c&&<div className="crd-st"><span>Credit limit</span><b className="c-val">{c.credit_limit?usd0(c.credit_limit):'—'}</b></div>}
        {c&&<div className="crd-st"><span>Statement closes</span><b className="c-val">{c.statement_close_day?`Day ${c.statement_close_day}`:'—'}</b></div>}
        {c&&<div className="crd-st"><span>Payment due</span><b className="c-val">{c.payment_due_day?`Day ${c.payment_due_day}`:'—'}</b></div>}
      </div>
      {util!=null&&c?.credit_limit>0&&<div className="crd-u">
        <div className="crd-ul"><span>Utilization</span><span>{util}% of {usd0(c.credit_limit)}</span></div>
        <div className="crd-ub"><i style={{width:`${Math.min(util,100)}%`,background:util>80?'#F87171':util>50?'#FBBF24':'#34D399'}}/></div></div>}
    </section>
    {menu&&<Popover anchor={menu} onClose={()=>setMenu(null)}>
      <div className="c-pop c-menu" role="menu" aria-label="Manage card">
        {item(p?'Change product':'Link a product',()=>setPanel({t:'product'}))}
        {item('Product history',()=>setPanel({t:'history'}))}
        {item('Edit card details',()=>setPanel({t:'edit'}))}
        <hr/>
        {p&&item('Add a benefit',()=>{setAddBen(n=>n+1);benRef.current&&benRef.current.scrollIntoView({block:'start',behavior:'smooth'});})}
        {item('Add a challenge',()=>setPanel({t:'ch',ch:null}))}
        <hr/>
        {item('Mark card as closed',()=>setPanel({t:'close'}),'crd-mi-bad')}
      </div></Popover>}

    {!p&&<div className="crd-warn"><b>No card product linked.</b> Link one from the ⋯ menu to see earning rates, benefits and points.</div>}
    {!c&&<div className="crd-warn"><b>No card record for this account.</b> Add it in Card Management to track its challenges and benefits.</div>}

    {c&&<div className="crd-top">
      <ChallengeGrid challenges={mine} rowRef={chRef} onOpen={ch=>setPanel({t:'ch',ch})} onArchive={archive} onAdd={()=>setPanel({t:'ch',ch:null})}/>
      {ben.B&&<ExpiringCredits B={ben.B} setB={ben.setB} cardId={cardId} toast={toast}
        onToBenefits={()=>benRef.current&&benRef.current.scrollIntoView({block:'start',behavior:'smooth'})}/>}
    </div>}

    <div className="crd-rail">
      <div className="crd-col" ref={txRef}>
        <CardTxnTable accountId={accountId} cardId={cardId} productKey={p?.product_key} baseRate={d.base_rate} range={range} setRange={setRange}
          B={ben.B} people={people} setPeople={setPeople} reloadKey={`${reloadKey}-${txKey}`} toast={toast}
          onLogCredit={t=>setLcTxn(t)} onChanged={()=>{load();ben.load();onChanged&&onChanged();}}/>
      </div>
      <div className="crd-col">
        {p&&<Earnings d={d} per={per} cur={cur}/>}
        {cardId&&<BenefitsPanel B={ben.B} setB={ben.setB} cardId={cardId} productId={p?.id} toast={toast} sectionRef={benRef} addRequest={addBen}/>}
      </div>
    </div>

    {lcTxn&&ben.B&&<LogCreditUse t={lcTxn} cardId={cardId} B={ben.B} toast={toast} onClose={()=>setLcTxn(null)} onSaved={b=>{ben.setB(b);setLcTxn(null);}}/>}
    {panel?.t==='product'&&<ChangeProductPanel card={c} product={p} products={products} toast={toast} onClose={()=>setPanel(null)} onSaved={()=>{setPanel(null);reloadAll();}}/>}
    {panel?.t==='history'&&<ProductHistoryPanel card={c} onClose={()=>setPanel(null)} onChange={()=>setPanel({t:'product'})}/>}
    {panel?.t==='edit'&&<EditCardPanel card={{...c,primary_user:owner,last_four:w?.mask?Number(w.mask):c.last_four}} account={acct} people={people} toast={toast} onClose={()=>setPanel(null)} onSaved={()=>{setPanel(null);reloadAll();}}/>}
    {panel?.t==='close'&&<CloseCardPanel card={c} name={`${name}${face.mask?' '+face.mask:''}`} toast={toast} onClose={()=>setPanel(null)} onSaved={()=>{setPanel(null);onClosed();}}/>}
    {panel?.t==='ch'&&<ChallengePanel ch={panel.ch} cardId={cardId} cards={wallet} categories={cats} people={people} toast={toast}
      onShowTxns={showTxns} onClose={()=>setPanel(null)} onSaved={()=>{setPanel(null);loadA();onChanged&&onChanged();}}/>}
  </>);
}
/* ── Earnings: category, points bar, rate, spend and points ─────────────── */
function Earnings({d,per,cur}){
  const rows=useMemo(()=>{
    const S=(d.spending_by_category||[]);
    const other=S.find(s=>s.category==='Other')||{amount:0,points_earned:0};
    const got=new Map(S.filter(s=>s.category!=='Other').map(s=>[s.category,{c:s.category,r:s.earn_rate,spend:s.amount,pts:s.points_earned}]));
    for(const e of d.earning_structure||[])if(e.bonus>0&&!got.has(e.category))got.set(e.category,{c:e.category,r:e.total,spend:0,pts:0});
    const list=[...got.values()].sort((a,b)=>b.pts-a.pts||b.r-a.r);
    return{list,other:{c:'All other purchases',r:d.base_rate,spend:other.amount,pts:other.points_earned}};
  },[d]);
  const mx=Math.max(1,rows.other.pts,...rows.list.map(r=>r.pts));
  const row=r=>(<tr key={r.c} className={r.pts?'':'dim'}>
    <td>{r.c}</td><td className="bc"><div className="cds-bar"><i style={{width:`${Math.max(0,r.pts)/mx*100}%`}}/></div></td>
    <td className="n ac">{r.r}x</td><td className="n">{r.spend?usd0(r.spend):'–'}</td><td className="n">{r.pts?f(r.pts):'–'}</td></tr>);
  return(<section>
    <h2>Earnings <span className="ct">{f(d.points_earned?.total)} {cur||'cash back'} {per}</span></h2>
    <div className="c-panel cds-pn"><table className="ern-t">
      <thead><tr><th colSpan={2}>Category</th><th className="n">Rate</th><th className="n">Spend</th><th className="n">Points</th></tr></thead>
      <tbody>{rows.list.map(row)}{row(rows.other)}</tbody></table></div>
  </section>);
}
