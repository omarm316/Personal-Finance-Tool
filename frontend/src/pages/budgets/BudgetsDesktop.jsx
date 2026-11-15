import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import '../../styles/cloud.css';
import './budgets.css';
import {apiFetch,parseHash,syncHashParams} from '../../lib/api';
import {ALL12,MON,MONL,applyCells,buildModel,isPast,m2,sg,today,totalsFor} from '../../lib/budgetData';
import {MonthView} from './MonthView';
import {HeatSheet,BudgetSheet} from './YearSheets';
import {BudgetPanel} from './BudgetPanel';

/* Budgets, desktop (docs/budgets-design.md): Month view, the Annual heat map
   and the Edit Year budgets sheet. Every grid edits like a spreadsheet; each
   cell saves as you leave it. */
export function BudgetsDesktop({categories,toast,setPage,refreshKey}){
  const T=useMemo(()=>today(),[]);
  const[sel,setSel]=useState(()=>{
    const p=parseHash().params,v=p.get('view');
    const m=parseInt(p.get('month'));
    return{view:['annual','edit'].includes(v)?v:'month',Y:parseInt(p.get('year'))||T.y,M:m>=1&&m<=12?m:T.m};
  });
  const{view,Y,M:mo}=sel;
  useEffect(()=>{syncHashParams({view,year:Y,month:mo});},[view,Y,mo]);
  const go=patch=>{setSel(s=>({...s,...patch}));setDetail(null);};

  const[data,setData]=useState(null);
  const targetsRef=useRef({});
  const load=useCallback(async()=>{
    try{
      const[t,a]=await Promise.all([apiFetch(`/budget/targets?year=${Y}`),apiFetch(`/budget/actuals?year=${Y}`)]);
      targetsRef.current=t.categories||{};
      setData({Y,targets:targetsRef.current,actuals:a.categories||{}});
    }catch(e){toast('Failed to load budgets','error');}
  },[Y,toast]);
  useEffect(()=>{load();},[load,refreshKey]);

  const ready=data&&data.Y===Y;
  const model=useMemo(()=>buildModel(categories,ready?data.targets:{},ready?data.actuals:{}),[categories,data,ready]);

  // UI state shared by the views
  const[open,setOpen]=useState({});
  const toggle=t=>setOpen(o=>({...o,[t]:!o[t]}));
  const[detail,setDetail]=useState(null);
  const[cf,setCf]=useState(true);
  const[unlock,setUnlock]=useState(false);
  const locked=useCallback(m=>!unlock&&isPast(T,Y,m),[unlock,T,Y]);

  /* Saving: apply the Other rule here, show it at once, then write in order. */
  const queue=useRef(Promise.resolve());
  const saveCells=useCallback(list=>{
    const cells=list.filter(c=>!locked(c.m));
    if(!cells.length)return 0;
    const{targets:next,writes}=applyCells(model,targetsRef.current,cells);
    if(!writes.length)return 0;
    targetsRef.current=next;
    setData(d=>d&&d.Y===Y?{...d,targets:next}:d);
    const body=JSON.stringify({targets:writes.map(w=>({year:Y,...w}))});
    queue.current=queue.current.then(()=>apiFetch('/budget/targets/bulk',{method:'POST',body}))
      .catch(()=>{toast('Failed to save the budget','error');load();});
    return cells.length;
  },[model,locked,Y,toast,load]);
  const onSave=useCallback((k,m,n)=>{saveCells([{k,m,n}]);},[saveCells]);
  const onPaste=useCallback(list=>{
    const n=saveCells(list);
    toast(n?`Pasted ${n} ${n===1?'cell':'cells'}`:'Nothing to paste');
  },[saveCells,toast]);

  const[busy,setBusy]=useState(false);
  const hasTargets=ready&&Object.values(data.targets).some(ms=>Object.values(ms||{}).some(v=>v?.amount>0));
  const copyPrev=async()=>{
    setBusy(true);
    try{
      const prior=(await apiFetch(`/budget/targets?year=${Y-1}`)).categories||{};
      const bulk=[];let skipped=0;
      Object.entries(prior).forEach(([category,ms])=>Object.entries(ms||{}).forEach(([m,v])=>{
        if(!(v?.amount>0))return;
        if(locked(Number(m))){skipped++;return;}
        bulk.push({year:Y,month:Number(m),category,amount:v.amount});
      }));
      if(!bulk.length){toast(skipped?'Nothing copied: those months are locked':`No budgets found in ${Y-1}`,'error');return;}
      await queue.current;
      await apiFetch('/budget/targets/bulk',{method:'POST',body:JSON.stringify({targets:bulk})});
      toast(`Copied ${bulk.length} budgets from ${Y-1}${skipped?`; ${skipped} in past months skipped (locked)`:''}`);
      await load();
    }catch(e){toast('Copy failed','error');}finally{setBusy(false);}
  };

  const years=[T.y-1,T.y,T.y+1];if(!years.includes(Y))years.push(Y);years.sort();
  const ctx={M:model,T,Y,mo,view,open,toggle,detail,setDetail,locked,onSave,onPaste};
  const pastYear=Y<T.y||(Y===T.y&&T.m>1);
  const lockSw=<Toggle on={!unlock} onClick={()=>setUnlock(u=>!u)} label="Past months locked"/>;
  const copyBtn=<button type="button" className="c-btn" onClick={copyPrev} disabled={busy}>{busy?'Copying…':`Copy from ${Y-1}`}</button>;

  let toolbar;
  if(view==='month'){
    const past=isPast(T,Y,mo);
    toolbar=<Toolbar left={<>{past&&lockSw}<span className="bg-note">{past&&!unlock?`${MONL[mo-1]} ${Y} is past, so its budgets are locked`:'Click a budget and type · Tab moves down the column · Enter saves'}</span></>} right={copyBtn}/>;
  }else if(view==='annual'){
    toolbar=<Toolbar left={<><Toggle on={cf} onClick={()=>setCf(v=>!v)} label="Conditional formatting"/>{pastYear&&lockSw}<span className="bg-note">Click a month to change its budget{cf?' · White is on budget, green under, red over':''}</span></>}
      right={<>{!hasTargets&&copyBtn}<button type="button" className="c-btn" onClick={()=>go({view:'edit'})}>Edit Year</button></>}/>;
  }else{
    toolbar=<Toolbar left={<>{pastYear&&lockSw}<span className="bg-note">{Y} budgets (hover a cell for its spending) · Tab moves right, then to the start of the next row · Enter saves · each cell saves as you leave it</span></>}
      right={<>{!hasTargets&&copyBtn}<button type="button" className="c-btn pri" onClick={()=>go({view:'annual'})}>Done</button></>}/>;
  }

  const body=!ready?<p className="c-mut bg-pad">Loading…</p>
    :view==='month'?<MonthView {...ctx}/>
    :view==='annual'?<HeatSheet {...ctx} cf={cf}/>
    :<BudgetSheet {...ctx}/>;
  const panel=detail&&ready&&view!=='edit';

  return(
    <div className="bgp cloud">
      <header className="c-panel bg-hdr">
        <h1>Budgets</h1>
        <div className="bg-hdr-r">
          <div className="bg-und" role="group" aria-label="View">
            {[['month','Month'],['annual','Annual'],['edit','Edit Year']].map(([v,l])=><button type="button" key={v} className={view===v?'on':''} onClick={()=>go({view:v})}>{l}</button>)}
          </div>
          <div className="bg-und" role="group" aria-label="Year">
            {years.map(y=><button type="button" key={y} className={Y===y?'on':''} onClick={()=>go({Y:y})}>{y}</button>)}
          </div>
          {view==='month'&&<div className="bg-und bg-mos" role="group" aria-label="Month">
            {MON.map((l,i)=><button type="button" key={l} className={mo===i+1?'on':''} onClick={()=>go({M:i+1})}>{l}</button>)}
          </div>}
        </div>
      </header>
      {ready&&<Summary M={model} view={view} mo={mo}/>}
      <div className={panel?'bg-with':''}>
        <section className={`c-panel bg-card ${view==='month'?'':'bg-sheetcard'}`}>
          {toolbar}
          {body}
        </section>
        {panel&&<BudgetPanel M={model} T={T} Y={Y} mo={mo} view={view} dkey={detail} refreshKey={refreshKey} toast={toast}
          onClose={()=>setDetail(null)} onMore={()=>setPage&&setPage('transactions')}/>}
      </div>
    </div>
  );
}

function Toolbar({left,right}){
  return <div className="bg-tbar"><div className="bg-tl">{left}</div><div className="bg-tr">{right}</div></div>;
}

export function Toggle({on,onClick,label}){
  return <button type="button" className={`bg-tg ${on?'on':''}`} role="switch" aria-checked={on} onClick={onClick}><i/>{label}</button>;
}

/* Four cards, label first. The Month view covers the month; the Annual and
   Edit Year views cover the year (its full budget, with actual so far). */
function Summary({M,view,mo}){
  const yr=view!=='month',t=totalsFor(M,yr?ALL12:[mo]),L=MON[mo-1];
  const used=t.eb>0?Math.round(t.ea/t.eb*100):0,uc=used>=100?'c-bad':used>=80?'c-warn':'c-good';
  const nb=t.ib-t.eb,na=t.ia-t.ea;
  const card=(label,val,sub,vc='')=>(
    <div className="c-panel bg-kpi" key={label}><span className="bg-kl">{label}</span><b className={`c-val bg-kn ${vc}`}>{val}</b><span className="bg-ks">{sub}</span></div>
  );
  return(
    <section className="bg-kpis">
      {card(yr?'Annual income':`Income — ${L}`,m2(t.ib),`Actual: ${m2(t.ia)}`,'c-good')}
      {card(yr?'Annual expenses':`Expenses — ${L}`,m2(t.eb),`Actual: ${m2(t.ea)}`)}
      {card('Budget used',`${used}%`,<span className={uc}>{m2(t.ea)} of {m2(t.eb)}</span>,uc)}
      {card(yr?'Annual net':`Net — ${L}`,sg(nb,m2),`Actual: ${sg(na,m2)}`,nb>=0?'bg-acc':'c-bad')}
    </section>
  );
}
