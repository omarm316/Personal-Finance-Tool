import React,{useState,useEffect,useCallback,useRef} from 'react';
import {BudgetAndSpendingCard} from '../components/BudgetAndSpendingCard';
import {CategoryDetailPanel} from '../components/CategoryDetailPanel';
import {RecentTransactionsCard} from '../components/RecentTransactionsCard';
import {ReviewModal} from '../components/ReviewModal';
import {SkeletonDashboard} from '../components/SkeletonDashboard';
import {SplitEditorModal} from '../components/SplitEditorModal';
import {useIsMobile} from '../hooks/index';
import {apiFetch,parseHash,syncHashParams} from '../lib/api';
import {fmt,normalizeCat,todayStr} from '../lib/format';

export function DashboardPage({categories,toast,setPage,refreshKey}){
  const[recent,setRecent]=useState([]);
  const[netWorth,setNetWorth]=useState(null);
  const[reviewTxn,setReviewTxn]=useState(null);
  // Subscribes to resize, unlike the bare window.innerWidth read this replaced —
  // that was sampled during render with nothing listening, so crossing the
  // breakpoint (device rotation, most realistically) left the stale value in
  // place until some unrelated state change forced a re-render.
  const isMob=useIsMobile();
  const[splitTxn,setSplitTxn]=useState(null);
  const[loading,setLoading]=useState(true);
  const hasLoaded=React.useRef(false);
  const[spendHoverIdx,setSpendHoverIdx]=useState(null);
  const[budgetTargets,setBudgetTargets]=useState({});
  const[budgetActuals,setBudgetActuals]=useState({});
  // Prior-year *actuals* only. The matching prior-year targets call was dropped:
  // nothing rendered it. Actuals are read by the Spending Trend, whose 6-month
  // window can reach back into viewYear-1.
  const[budgetActualsPrior,setBudgetActualsPrior]=useState({});
  const[budgetView,_setBudgetView]=useState(()=>parseHash().params.get('view')||'month');
  const[ytdByCat,setYtdByCat]=useState({});          // expense-only YTD by_category from /stats
  const[catDetail,setCatDetail]=useState(null);       // null | {cat, loading, rows, total}
  const[viewYear,_setViewYear]=useState(()=>parseInt(parseHash().params.get('year'))||new Date().getFullYear());
  const[viewMonth,_setViewMonth]=useState(()=>parseInt(parseHash().params.get('month'))||new Date().getMonth()+1);
  const setBudgetView=useCallback(v=>{_setBudgetView(v);syncHashParams({view:v,year:viewYear,month:viewMonth});},[viewYear,viewMonth]);
  const setViewYear=useCallback(y=>{_setViewYear(y);syncHashParams({view:budgetView,year:y,month:viewMonth});},[budgetView,viewMonth]);
  const setViewMonth=useCallback(m=>{_setViewMonth(m);syncHashParams({view:budgetView,year:viewYear,month:m});},[budgetView,viewYear]);
  const[kpiStats,setKpiStats]=useState(null);
  const[kpiPriorStats,setKpiPriorStats]=useState(null);
  const[kpiLabel,setKpiLabel]=useState('');

  // Returns date range for the KPI cards (MTD for current month, full period for past)
  // and the comparison label like "vs Feb 6"
  const getKpiDates=()=>{
    const now=new Date();
    const cy=now.getFullYear(),cm=now.getMonth()+1,cd=now.getDate();
    const pad=n=>String(n).padStart(2,'0');
    const MONS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if(budgetView==='annual'){
      const yr=viewYear,pYr=yr-1;
      const isCY=yr===cy;
      const kpiEnd=isCY?todayStr():`${yr}-12-31`;
      const kpiStart=`${yr}-01-01`;
      const pEnd=isCY?`${pYr}-${pad(cm)}-${pad(cd)}`:`${pYr}-12-31`;
      const pStart=`${pYr}-01-01`;
      return{kpiStart,kpiEnd,priorKpiStart:pStart,priorKpiEnd:pEnd,kpiLabel:'vs. Last Year'};
    }
    const yr=viewYear,mo=viewMonth;
    const isCM=yr===cy&&mo===cm;
    const endDay=isCM?cd:new Date(yr,mo,0).getDate();
    const kpiEnd=`${yr}-${pad(mo)}-${pad(endDay)}`;
    const kpiStart=`${yr}-${pad(mo)}-01`;
    const pYr=mo===1?yr-1:yr,pMo=mo===1?12:mo-1;
    const pMaxDay=new Date(pYr,pMo,0).getDate();
    const pDay=Math.min(endDay,pMaxDay);
    const pEnd=`${pYr}-${pad(pMo)}-${pad(pDay)}`;
    const pStart=`${pYr}-${pad(pMo)}-01`;
    return{kpiStart,kpiEnd,priorKpiStart:pStart,priorKpiEnd:pEnd,kpiLabel:'vs. Last Month'};
  };

  const load=useCallback(async({silent=false}={})=>{
    if(!silent)setLoading(true);
    try{
      const yr=viewYear;
      const curY=new Date().getFullYear();
      // YTD stats: Jan 1 → end of viewMonth (capped at today so future months don't show zeros)
      const ytdMoEndDay=new Date(yr,viewMonth,0).getDate();
      const ytdMoEnd=`${yr}-${String(viewMonth).padStart(2,'0')}-${String(ytdMoEndDay).padStart(2,'0')}`;
      const ytdEnd=ytdMoEnd<todayStr()?ytdMoEnd:todayStr();
      const ytdQ=`/stats?start_date=${yr}-01-01&end_date=${ytdEnd}`;
      // KPI card stats: MTD vs same day last period
      const{kpiStart,kpiEnd,priorKpiStart,priorKpiEnd,kpiLabel:kLabel}=getKpiDates();
      const kpiQ=`/stats?start_date=${kpiStart}&end_date=${kpiEnd}`;
      const kpiPriorQ=`/stats?start_date=${priorKpiStart}&end_date=${priorKpiEnd}`;
      /* Three requests were dropped from this list because nothing rendered
         their results: the selected-range /stats call (fed `stats`/`topCats`),
         /transactions?needs_review=true&limit=50 (fed the Needs Review section,
         which was removed), and the prior-year /budget/targets call. The KPI
         cards use their own kpiQ/kpiPriorQ /stats calls and the category table
         uses ytdQ, so nothing on screen lost a data source. */
      const[r,nw,bt,ba,ba2,ytdS,kpiS,kpiPS]=await Promise.all([
        apiFetch('/transactions?limit=12'),
        apiFetch('/net-worth').catch(e=>{console.warn('Net worth fetch failed:',e);return null;}),
        apiFetch(`/budget/targets?year=${yr}`).catch(()=>({categories:{}})),
        apiFetch(`/budget/actuals?year=${yr}`).catch(()=>({categories:{}})),
        apiFetch(`/budget/actuals?year=${yr-1}`).catch(()=>({categories:{}})),
        apiFetch(ytdQ).catch(()=>({by_category:{}})),
        apiFetch(kpiQ).catch(()=>null),
        apiFetch(kpiPriorQ).catch(()=>null),
      ]);
      setRecent(r);setNetWorth(nw);
      setBudgetTargets(bt.categories||{});setBudgetActuals(ba.categories||{});
      setBudgetActualsPrior(ba2.categories||{});
      setYtdByCat(ytdS.by_category||{});
      setKpiStats(kpiS);setKpiPriorStats(kpiPS);setKpiLabel(kLabel);
    }catch(e){toast('Failed to load','error');}
    finally{if(!silent)setLoading(false);}
  },[budgetView,viewYear,viewMonth]);

  useEffect(()=>{
    const isFirst=!hasLoaded.current;
    hasLoaded.current=true;
    load({silent:!isFirst});
  },[load,refreshKey]);

  const handleSave=async(id,updates)=>{
    if(updates.__deleted){await load();return;}
    try{
      await apiFetch(`/transactions/${id}`,{method:'PATCH',body:JSON.stringify(updates)});
      if(updates.needs_review===false)toast('✓ Reviewed — transaction moved to Transactions page');
      else if(Object.keys(updates).length>0)toast('✓ Saved');
      await load({silent:true});
    }
    catch(e){toast('Failed to save','error');}
  };
  const handleIgnore=async(id)=>{await handleSave(id,{needs_review:false});};

  // Generation counter prevents stale async responses from overwriting newer state
  const catDetailGen=React.useRef(0);
  const loadCatDetail=async(cat,view,yr,mo)=>{
    const gen=++catDetailGen.current;
    const moStr=String(mo).padStart(2,'0');
    const lastDay=new Date(yr,mo,0).getDate();
    const{start,end}=view==='annual'
      ?{start:`${yr}-01-01`,end:todayStr()}
      :{start:`${yr}-${moStr}-01`,end:`${yr}-${moStr}-${String(lastDay).padStart(2,'0')}`};
    setCatDetail({cat,loading:true,rows:[],total:0});
    try{
      const d=await apiFetch(`/stats/detail?category=${encodeURIComponent(cat)}&start_date=${start}&end_date=${end}`);
      if(gen===catDetailGen.current)setCatDetail({cat,loading:false,rows:d.rows||[],total:d.total||0});
    }catch(e){
      if(gen===catDetailGen.current){setCatDetail(null);toast('Failed to load detail','error');}
    }
  };
  const openCatDetail=(cat)=>{
    if(catDetail?.cat===cat){setCatDetail(null);return;}
    loadCatDetail(cat,budgetView,viewYear,viewMonth);
  };

  if(loading)return<SkeletonDashboard/>;

  const hr=new Date().getHours();
  const greeting=hr<12?'morning':hr<17?'afternoon':'evening';
  // KPI card values
  const kpiIncome=kpiStats?.total_income??0;
  const kpiExpenses=kpiStats?.total_expenses??0;
  const kpiNet=kpiIncome-kpiExpenses;
  const priorIncome=kpiPriorStats?.total_income??null;
  const priorExpenses=kpiPriorStats?.total_expenses??null;
  const priorNet=(priorIncome!==null&&priorExpenses!==null)?priorIncome-priorExpenses:null;
  const kpiCalcPct=(curr,prior)=>(prior===null||Math.abs(prior)<0.01)?null:Math.round(((curr-prior)/Math.abs(prior))*100);
  const incomePct=kpiCalcPct(kpiIncome,priorIncome);
  const expensesPct=kpiCalcPct(kpiExpenses,priorExpenses);
  const netPct=kpiCalcPct(kpiNet,priorNet);
  const _bSum=key=>netWorth?.buckets?.[key]?.accounts?.reduce((s,a)=>s+a.balance,0)??0;
  const csBal=netWorth?_bSum('Cash & Savings'):null;
  // No % badge on Checking & Savings: it's a point-in-time balance and we have
  // no historical one to compare it against. The estimate that used to sit here
  // (prior balance = current − net cash flow) wasn't a real prior balance — net
  // cash flow spans every account, including card spend that never touched
  // checking — and it went absurd once the estimate crossed zero, rendering
  // "+583%" in Annual YTD. A real figure needs a per-bucket historical balance
  // from the backend; until that exists, show nothing rather than a fake.
  const netValue=kpiNet<0?`(${fmt(Math.abs(kpiNet))})`:fmt(kpiNet);

  return(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {reviewTxn&&<ReviewModal txn={reviewTxn} categories={categories} onSave={handleSave} onDiscard={()=>setReviewTxn(null)} onIgnore={handleIgnore} onClose={()=>setReviewTxn(null)}/>}
      {splitTxn&&<SplitEditorModal txn={splitTxn} categories={categories} onClose={()=>setSplitTxn(null)} onSaved={load} toast={toast}/>}

      {/* Header */}
      <header className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', marginBottom: 0, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{fontSize: 28, fontWeight: 600, letterSpacing: '-0.5px'}}>Good {greeting}, Omer</h2>
          <p style={{fontSize: 14, color: 'var(--text-secondary)', marginTop: 4}}>Here's your financial overview today.</p>
        </div>
        <div className="sel-pill">
          {['month','annual'].map(v=>(
            <button type="button" key={v} onClick={()=>setBudgetView(v)} data-active={budgetView===v} style={{
              background: budgetView===v?'var(--blue-primary)':'none',
              color: budgetView===v?'white':'var(--text-secondary)',
              boxShadow: budgetView===v?'0 4px 12px rgba(var(--blue-primary-rgb), 0.2)':'none'
            }}>{v==='month'?'Monthly':'Annual YTD'}</button>
          ))}
        </div>
      </header>

      {/* KPI row — 5 cards */}
      {(()=>{
        const PctBadge=({pct,invert=false})=>{
          if(pct===null)return<span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>—</span>;
          const good=invert?pct<=0:pct>=0;
          return<span style={{background:good?'rgba(16,185,129,0.12)':'rgba(239,68,68,0.12)',color:good?'var(--green)':'var(--red)',borderRadius:12,padding:'2px 8px',fontSize:11,fontWeight:600}}>{pct>0?'+':''}{pct}%</span>;
        };
        const cards=[
          {label:'Checking & Savings',value:csBal!==null?fmt(csBal):'—',pct:null,invert:false},
          {label:'Net Worth',value:netWorth?.net_worth!=null?fmt(netWorth.net_worth):'—',pct:null,invert:false, highlight: true},
          {label:'Income',value:fmt(kpiIncome),pct:incomePct,invert:false},
          {label:'Expenses',value:fmt(kpiExpenses),pct:expensesPct,invert:true},
          {label:'Net Cash Flow',value:netValue,pct:netPct,invert:false},
        ];
        return(
          <div className="metric-grid">
            {cards.map(c=>(
              <div key={c.label} className="card metric-card">
                <div className="metric-label">{c.label}</div>
                <div className="metric-value" style={c.highlight ? { color: 'var(--blue-neon)' } : undefined}>{c.value}</div>
                <div className="metric-sub">
                  <PctBadge pct={c.pct} invert={c.invert}/>
                  <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>{kpiLabel}</span>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Spending Trend (full-width on desktop) + Budget Overview (mobile only) ── */}
      {(()=>{
        /* Non-spending buckets. 'Work' is income and 'Transfer' is money moving
           between accounts — summing them into a "spending" line plots spend +
           income, which overstates every month and can invert the trend
           entirely. Same set BudgetAndSpendingCard and the mobile bars use. */
        const SKIP=new Set(['Transfer','Work']);
        /* Derive monthly spending totals from budgetActuals + budgetActualsPrior */
        const MO_LABELS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const curY=new Date().getFullYear();
        const curM=new Date().getMonth()+1;
        /* The window ends on the *selected* month, not on today. budgetActuals
           is fetched for viewYear (and budgetActualsPrior for viewYear-1), so
           anchoring on today would read the selected year's payload under
           current-year labels — picking 2025 silently plotted 2025 figures
           against Feb…Jul 2026. Clamped so we never trail into future months. */
        const endY=viewYear;
        const endM=viewYear<curY?12:Math.min(viewMonth,curM);
        const months6=Array.from({length:6},(_,i)=>{
          const d=new Date(endY,endM-1-(5-i),1);
          return{year:d.getFullYear(),month:d.getMonth()+1,label:MO_LABELS[d.getMonth()]};
        });
        /* months6 spans at most viewYear and viewYear-1, which is exactly the
           pair of payloads we hold — so this lookup can't cross into a year we
           didn't fetch. */
        const getMonthTotal=(yr,mo)=>{
          const src=yr===viewYear?budgetActuals:budgetActualsPrior;
          return Object.entries(src).reduce((s,[cat,catMonths])=>
            SKIP.has(cat)?s:s+(catMonths?.[String(mo)]||0),0);
        };
        const spanYears=months6[0].year!==months6[5].year;
        const rangeLabel=spanYears
          ?`${months6[0].label} ${months6[0].year} – ${months6[5].label} ${months6[5].year}`
          :`${months6[0].label} – ${months6[5].label} ${months6[5].year}`;
        const spendData=months6.map(m=>({...m,amount:getMonthTotal(m.year,m.month)}));
        const maxSpend=Math.max(...spendData.map(d=>d.amount),100);
        /* Add 10% headroom so the top of the chart doesn't get clipped */
        const yMax=maxSpend*1.1;
        /* SVG dimensions */
        /* Left padding dropped from 44 to 24 now that the y-axis labels are
           gone — 24 is just enough for the first/last point's direct value
           label to sit centered without clipping at the viewBox edge. */
        const W=500,H=160,pad={t:14,r:24,b:28,l:24};
        const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
        const pts=spendData.map((d,i)=>[
          pad.l+(i/(spendData.length-1))*cW,
          pad.t+cH-(d.amount/yMax)*cH
        ]);
        /* Monotone cubic (Fritsch-Carlson) — smooth like Catmull-Rom, but the
           tangent limiter keeps the curve from overshooting past whichever
           neighboring point is higher/lower, so it never implies a spike or
           dip the underlying monthly totals don't have. */
        const smoothPath=(points)=>{
          const n=points.length;
          if(n<2)return'';
          if(n===2)return`M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
          const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
          const d=[];for(let i=0;i<n-1;i++)d.push((ys[i+1]-ys[i])/(xs[i+1]-xs[i]));
          const m=new Array(n);
          m[0]=d[0];m[n-1]=d[n-2];
          for(let i=1;i<n-1;i++)m[i]=(d[i-1]*d[i]<=0)?0:(d[i-1]+d[i])/2;
          for(let i=0;i<n-1;i++){
            if(d[i]===0){m[i]=0;m[i+1]=0;}
            else{
              const a=m[i]/d[i],b=m[i+1]/d[i],h=Math.hypot(a,b);
              if(h>3){const t=3/h;m[i]=t*a*d[i];m[i+1]=t*b*d[i];}
            }
          }
          let path=`M${xs[0]},${ys[0]}`;
          for(let i=0;i<n-1;i++){
            const dx=(xs[i+1]-xs[i])/3;
            const cp1x=xs[i]+dx,cp1y=ys[i]+m[i]*dx;
            const cp2x=xs[i+1]-dx,cp2y=ys[i+1]-m[i+1]*dx;
            path+=` C${cp1x},${cp1y} ${cp2x},${cp2y} ${xs[i+1]},${ys[i+1]}`;
          }
          return path;
        };
        const pathD=smoothPath(pts);
        const areaD=pts.length>=2?pathD+` L${pts[pts.length-1][0]},${pad.t+cH} L${pts[0][0]},${pad.t+cH} Z`:'';

        /* Budget overview bars (mobile only) — top 6 categories for current month */
        const mo=viewMonth||(new Date().getMonth()+1);
        const mStr=String(mo);
        const budgetRows=[];
        const allCats=new Set([...Object.keys(budgetTargets),...Object.keys(budgetActuals)]);
        allCats.forEach(cat=>{
          if(SKIP.has(cat))return;
          const budget=budgetTargets[cat]?.[mStr]?.amount||0;
          const actual=budgetActuals[cat]?.[mStr]||0;
          if(budget<=0&&actual<=0)return;
          /* Mirrors the desktop RowEl's flags. An unbudgeted category used to
             get pct=100 and remaining=0−actual, and since `over` was pct>100
             (strictly greater) it fell through to the "left" branch — so a
             category with no budget at all and $4,060.50 spent rendered as
             "$4,060.50 left", the exact opposite of the truth. Credit rows
             (net refund) likewise have no meaningful "% of budget spent".
             `over` is >=100 here to match desktop, where exactly 100% is
             already treated as over. */
          const hasBudget=budget>0;
          const isCredit=actual<0;
          const noBudget=!hasBudget&&actual>0;
          const pct=hasBudget?Math.round((actual/budget)*100):0;
          const over=hasBudget&&!isCredit&&pct>=100;
          const remaining=budget-actual;
          budgetRows.push({cat:normalizeCat(cat),budget,actual,pct,remaining,hasBudget,isCredit,noBudget,over});
        });
        budgetRows.sort((a,b)=>b.actual-a.actual);
        const topBudgetRows=budgetRows.slice(0,6);

        return(
          <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
            {/* Spending Trend (left 50%) + Recent Transactions (right 50%) */}
            <div className="dash-split">
            <div className="card" style={{margin:0,display:'flex',flexDirection:'column'}}>
              <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px'}}>Spending Trend</div>
                <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:400}}>{rangeLabel}</div>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',maxHeight:240}}>
                <defs>
                  <linearGradient id="spendAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--blue-primary)" stopOpacity="0.15"/>
                    <stop offset="100%" stopColor="var(--blue-primary)" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                {/* Grid lines. No y-axis value labels — every point is already
                    directly labeled with its own figure, so the axis scale was
                    duplicating information while eating horizontal space this
                    card no longer has at half width. */}
                {[0,0.25,0.5,0.75,1].map((p,i)=>{
                  const y=pad.t+(1-p)*cH;
                  return <line key={i} x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke="var(--border)" strokeWidth={1}/>;
                })}
                {/* X labels */}
                {spendData.map((d,i)=>(
                  <text key={i} x={pts[i][0]} y={H-4} textAnchor="middle" fontSize={9} fill="var(--text-muted)" fontWeight={500}>{d.label}</text>
                ))}
                {/* Area fill */}
                {areaD&&<path d={areaD} fill="url(#spendAreaGrad)" style={{ transition: 'all 0.5s ease' }}/>}
                {/* Line */}
                {pathD&&<path d={pathD} fill="none" stroke="var(--blue-primary)" strokeWidth={2.5} strokeLinecap="round" style={{ transition: 'all 0.5s ease' }}/>}
                {/* Dots + hover labels */}
                {pts.map((p,i)=>(
                  <g key={i}>
                    <rect x={p[0] - (cW / (spendData.length - 1)) / 2} y={pad.t} width={cW / (spendData.length - 1)} height={cH} fill="transparent" style={{cursor:'pointer'}}
                      onMouseEnter={()=>setSpendHoverIdx(i)} onMouseLeave={()=>setSpendHoverIdx(null)}
                      onClick={()=>setSpendHoverIdx(spendHoverIdx===i?null:i)} />
                    <circle cx={p[0]} cy={p[1]} r={spendHoverIdx===i?6:4} fill="var(--blue-vibrant)" style={{pointerEvents:'none',transition:'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'}} />
                    {spendHoverIdx===i?(
                      <>
                        <rect x={p[0]-40} y={p[1]-26} width={80} height={20} rx={10} fill="var(--blue-primary)" style={{pointerEvents:'none'}} />
                        <text x={p[0]} y={p[1]-13} textAnchor="middle" fontSize={10} fill="white" fontWeight={700} style={{pointerEvents:'none'}}>
                          {fmt(spendData[i].amount)}
                        </text>
                      </>
                    ):(
                      /* Direct-label every point — with only 6 points, reading exact
                         values shouldn't require finding and hovering each dot. */
                      <text x={p[0]} y={p[1]<pad.t+20?p[1]+16:p[1]-10} textAnchor="middle" fontSize={9.5} fill="var(--text-secondary)" fontWeight={600} style={{pointerEvents:'none'}}>
                        {spendData[i].amount>=1000?`${(spendData[i].amount/1000).toFixed(1)}k`:`${Math.round(spendData[i].amount)}`}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
            </div>

            <RecentTransactionsCard recent={recent} onSeeMore={()=>setPage('transactions')} onRowClick={setReviewTxn}/>
            </div>

            {/* Budget Overview — mobile only */}
            {isMob&&<div className="card">
              <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px',marginBottom:16}}>Top Budgets</div>
              <div style={{display:'flex',flexDirection:'column',gap:16}}>
                {topBudgetRows.map(r=>{
                  const over=r.over;
                  /* No budget → say so, and show what was spent, rather than
                     inventing a remaining figure. Credit rows show the refund.
                     Only a real budget gets "left"/"over". */
                  const dollarLabel=r.noBudget?`${fmt(r.actual)} spent · no budget set`
                    :r.isCredit?`${fmt(Math.abs(r.actual))} refunded`
                    :over?`${fmt(Math.abs(r.remaining))} over`
                    :`${fmt(r.remaining)} left`;
                  /* An empty track for rows with no budget or a net credit —
                     a filled bar would imply a proportion of something that
                     doesn't exist. Same treatment as the desktop table. */
                  const barPct=r.hasBudget&&!r.isCredit?Math.min(r.pct,100):0;
                  return(
                    <div key={r.cat}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                        <span style={{fontSize:14,fontWeight:500}}>{r.cat}</span>
                        {r.hasBudget&&!r.isCredit
                          ?<span style={{fontSize:12,fontWeight:600,color:over?'var(--red)':'var(--text-secondary)'}}>{r.pct}%</span>
                          :<span style={{fontSize:10,fontWeight:500,color:'var(--text-muted)'}}>{r.noBudget?'no budget':''}</span>}
                      </div>
                      <div style={{height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                        {barPct>0&&<div style={{height:'100%',borderRadius:3,width:`${barPct}%`,
                          background:over?'var(--red)':'var(--blue-primary)',transition:'width 0.6s ease'}}/>}
                      </div>
                      <div style={{fontSize:10,color:'var(--text-muted)',marginTop:4,textAlign:'right'}}>{dollarLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>}
          </div>
        );
      })()}

      {/* ── Full-width Budget & Spending Detail ──────────────────────────── */}
      <div style={{marginTop:0}}>
        <BudgetAndSpendingCard
          targets={budgetTargets} actuals={budgetActuals}
          view={budgetView} ytdActuals={ytdByCat}
          viewMonth={viewMonth} viewYear={viewYear}
          onCatClick={openCatDetail}
          activeCat={catDetail?.cat||null}
          onSetView={v=>{setBudgetView(v);if(catDetail)loadCatDetail(catDetail.cat,v,viewYear,viewMonth);}}
          onSetYear={v=>{setViewYear(v);if(catDetail)loadCatDetail(catDetail.cat,budgetView,v,viewMonth);}}
          onSetMonth={v=>{setViewMonth(v);if(catDetail)loadCatDetail(catDetail.cat,budgetView,viewYear,v);}}/>
      </div>

      {/* Category Detail Panel — slides in below the budget table when a row is clicked */}
      {catDetail&&<div style={{marginTop:12}}>
        <CategoryDetailPanel detail={catDetail} onClose={()=>setCatDetail(null)}/>
      </div>}

      {/* Budget vs. Actual and Needs Review removed — use Budgets page and Transactions page respectively.
          The full-width Recent Activity table that used to sit here is gone too — recent
          transactions now live in the half-width card beside the Spending Trend. */}
    </div>
  );
}

/* Modal for creating a manual account (Section 2b) */
