/* The Cards module on desktop (Cards step 5): Portfolio, a program's page and
   a card's page, built to docs/cards-portfolio-design.md,
   docs/cards-ecosystem-design.md and docs/cards-card-design.md. Phones keep
   the older pages (CardsPhonePage). Swipe Advisor and Card Management weren't
   redesigned, so their tabs show today's content. */
import {useState,useEffect,useMemo,useCallback} from 'react';
import {apiFetch} from '../../lib/api';
import {PeriodPicker,Crumbs} from '../../components/cards/CardsCommon';
import {CardDetailErrorBoundary} from '../../components/CardDetailErrorBoundary';
import {CardsPhonePage} from '../CardsPhonePage';
import {PortfolioDesktop} from './PortfolioDesktop';
import {EcosystemDesktop} from './EcosystemDesktop';
import {CardDesktop} from './CardDesktop';

const TABS=[['portfolio','Portfolio'],['swipe','Swipe Advisor'],['manage','Card Management']];

export function CardsDesktop({toast,refreshKey}){
  const[tab,setTab]=useState('portfolio');
  const[view,setView]=useState({t:'portfolio'});   // {t:'eco',id,name} | {t:'card',accountId,from,challenge}
  const[period,setPeriod]=useState('qtd');
  const[year,setYear]=useState(new Date().getFullYear());
  const years=useMemo(()=>{const y=new Date().getFullYear();return[y,y-1,y-2];},[]);
  const[wallet,setWallet]=useState([]);
  const[bump,setBump]=useState(0);   // reload after a change on one page reaches the others
  const changed=useCallback(()=>setBump(b=>b+1),[]);
  const key=`${refreshKey||0}-${bump}`;
  const loadWallet=useCallback(()=>apiFetch('/cards/wallet').then(setWallet).catch(()=>setWallet([])),[]);
  useEffect(()=>{loadWallet();},[loadWallet,key]);
  useEffect(()=>{window.scrollTo({top:0});const m=document.querySelector('.main-content');if(m)m.scrollTop=0;},[view.t,view.id,view.accountId]);

  const toPortfolio=()=>{setTab('portfolio');setView({t:'portfolio'});};
  const openEco=(id,name)=>setView({t:'eco',id,name});
  const openCard=(accountId,challenge=null)=>setView(v=>({t:'card',accountId,challenge,
    from:v.t==='eco'?{id:v.id,name:v.name}:v.t==='card'?v.from:null}));

  let crumbs=null,body;
  if(view.t==='eco'){
    crumbs=[{label:'Cards',onClick:toPortfolio},{label:'Portfolio',onClick:toPortfolio},{label:view.name}];
    body=<EcosystemDesktop key={view.id} ecoId={view.id} ecoName={view.name} period={period} year={year} wallet={wallet}
      onOpenCard={openCard} toast={toast} reloadKey={key} onChanged={changed}/>;
  }else if(view.t==='card'){
    body=<CardDetailErrorBoundary onBack={toPortfolio}><CardDesktop key={view.accountId} accountId={view.accountId} challenge={view.challenge} period={period} setPeriod={setPeriod}
      wallet={wallet} toast={toast} reloadKey={key} onChanged={changed} onClosed={()=>{changed();toPortfolio();}}
      crumbs={eco=>[{label:'Cards',onClick:toPortfolio},{label:'Portfolio',onClick:toPortfolio},
        ...(eco?[{label:eco.name,onClick:()=>openEco(eco.id,eco.name)}]:[])]}/></CardDetailErrorBoundary>;
  }else if(tab!=='portfolio'){
    body=<CardsPhonePage toast={toast} refreshKey={key} forcedTab={tab==='swipe'?'swipe':'cards'}/>;
  }else{
    body=<PortfolioDesktop period={period} year={year} wallet={wallet} onOpenEco={openEco} onOpenCard={openCard}
      toast={toast} reloadKey={key} onChanged={changed}/>;
  }
  return(
    <div className="cloud cds">
      {view.t!=='card'&&<header className="c-panel cds-hdr">
        {crumbs?<Crumbs items={crumbs}/>
          :<div className="cds-und big" role="tablist" aria-label="Cards">
            {TABS.map(([id,l])=><button type="button" key={id} role="tab" aria-selected={tab===id} className={tab===id?'on':''} onClick={()=>{setTab(id);setView({t:'portfolio'});}}>{l}</button>)}
          </div>}
        {(view.t!=='portfolio'||tab==='portfolio')&&<PeriodPicker period={period} setPeriod={setPeriod} year={year} setYear={setYear} years={years}/>}
      </header>}
      {body}
    </div>);
}
