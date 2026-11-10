import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import '../styles/cloud.css';
import './dashboard.css';
import {useIsMobile} from '../hooks/index';
import {apiFetch,parseHash,syncHashParams} from '../lib/api';
import {topLevelOf} from '../lib/categories';
import {MON,MONL,budgetRows,groupRows,k1,m2,ncat,pace,period,shiftYm,topOf,topSpend,trendMonths,usd0,whereData} from '../lib/dashData';
import {DashboardPhonePage} from './DashboardPhonePage';

/* Dashboard. Desktop follows docs/dashboard-design.md; the phone keeps its
   earlier layout until phone design is done for this screen. */
export function DashboardPage(props){
  const mobile=useIsMobile();
  return mobile?<DashboardPhonePage {...props}/>:<DashboardDesktop {...props}/>;
}

const DETAIL_ROWS=14;
const ymNum=(y,m)=>y*12+m;

function DashboardDesktop({categories,toast,setPage,refreshKey}){
  const now=new Date(),cy=now.getFullYear(),cm=now.getMonth()+1;
  // The month stepper runs from January two years back (the Transactions page's range) to this month.
  const floor=ymNum(cy-2,1),ceil=ymNum(cy,cm);
  const[sel,setSel]=useState(()=>{
    const p=parseHash().params,view=p.get('view')==='annual'?'annual':'month';
    let Y=parseInt(p.get('year'))||cy,M=parseInt(p.get('month'))||cm;
    if(M<1||M>12)M=cm;
    if(ymNum(Y,M)>ceil){Y=cy;M=cm;}
    if(ymNum(Y,M)<floor){Y=cy-2;M=1;}
    return{view,Y,M};
  });
  const{view,Y,M}=sel;
  useEffect(()=>{syncHashParams({view,year:Y,month:M});},[view,Y,M]);
  const per=useMemo(()=>period(view,Y,M),[view,Y,M]);
  const goTo=(y,m)=>{if(ymNum(y,m)>=floor&&ymNum(y,m)<=ceil)setSel(s=>({...s,Y:y,M:m}));};

  /* Net worth: today's snapshot and the last 12 month-ends */
  const[nw,setNw]=useState(null),[nwLine,setNwLine]=useState(null);
  useEffect(()=>{
    let alive=true;
    apiFetch('/net-worth').then(d=>{if(alive)setNw(d);}).catch(()=>{if(alive)toast('Failed to load net worth','error');});
    apiFetch('/net-worth/timeline?months=12').then(d=>{if(alive)setNwLine(d.timeline||[]);}).catch(()=>{if(alive)setNwLine([]);});
    return()=>{alive=false;};
  },[refreshKey]);// eslint-disable-line react-hooks/exhaustive-deps

  /* Budgets and actuals for the selected year, plus last year's actuals for the chart */
  const[bud,setBud]=useState(null);
  useEffect(()=>{
    let alive=true;
    Promise.all([
      apiFetch(`/budget/targets?year=${Y}`),
      apiFetch(`/budget/actuals?year=${Y}`),
      apiFetch(`/budget/actuals?year=${Y-1}`).catch(()=>({categories:{}})),
    ]).then(([t,a,a0])=>{if(alive)setBud({Y,targets:t.categories||{},actuals:{[Y]:a.categories||{},[Y-1]:a0.categories||{}}});})
      .catch(()=>{if(alive)toast('Failed to load budgets','error');});
    return()=>{alive=false;};
  },[Y,refreshKey]);// eslint-disable-line react-hooks/exhaustive-deps

  /* Income, expenses and spending by category for the period and its comparison */
  const[stats,setStats]=useState(null);
  useEffect(()=>{
    let alive=true;
    const q=(a,b)=>apiFetch(`/stats?start_date=${a}&end_date=${b}`);
    Promise.all([q(per.start,per.end),q(per.pStart,per.pEnd)])
      .then(([cur,prev])=>{if(alive)setStats({key:per.start+per.end,cur,prev});})
      .catch(()=>{if(alive)toast('Failed to load the period\'s figures','error');});
    return()=>{alive=false;};
  },[per.start,per.end,per.pStart,per.pEnd,refreshKey]);// eslint-disable-line react-hooks/exhaustive-deps

  const budgetReady=bud&&bud.Y===Y;
  const B=useMemo(()=>budgetReady?budgetRows(bud.targets,bud.actuals[Y],per.months):null,[budgetReady,bud,Y,per.months]);
  // `categories` is in the deps because the tree that groups them arrives with it.
  const groups=useMemo(()=>B?groupRows(B.rows):[],[B,categories]);

  /* The open category ('g:<top level>' for a whole tile) and its transactions */
  const[detail,setDetail]=useState(null);
  const[det,setDet]=useState(null);
  const detRef=useRef(null);
  useEffect(()=>{
    if(!detail){setDet(null);return;}
    let alive=true;
    const grp=detail.startsWith('g:'),name=grp?detail.slice(2):detail,top=grp?name:topLevelOf(name);
    // Ask for the whole top level (it includes its categories) and keep the wanted rows;
    // Unclassified shows as Other, so Other asks for both.
    const asks=top==='Other'?['Other','Unclassified']:[top];
    setDet(d=>({key:detail,loading:true,rows:d&&d.key===detail?d.rows:[]}));
    Promise.all(asks.map(c=>apiFetch(`/stats/detail?category=${encodeURIComponent(c)}&start_date=${per.start}&end_date=${per.end}`)))
      .then(rs=>{
        if(!alive)return;
        const rows=rs.flatMap(r=>r.rows||[])
          .filter(r=>grp?topOf(r.category)===name:ncat(r.category)===name)
          .map(r=>({...r,v:-(r.is_split?r.split_amount:r.amount)}))
          .sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:b.v-a.v);
        setDet({key:detail,loading:false,rows});
      })
      .catch(()=>{if(alive){setDet(null);toast('Failed to load the category\'s transactions','error');}});
    return()=>{alive=false;};
  },[detail,per.start,per.end,refreshKey]);// eslint-disable-line react-hooks/exhaustive-deps
  // Bring the panel into view when it opens below the fold
  useEffect(()=>{if(det&&!det.loading)detRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[det?.key,det?.loading]);// eslint-disable-line react-hooks/exhaustive-deps
  const toggle=key=>setDetail(d=>d===key?null:key);

  const statsReady=stats&&stats.key===per.start+per.end;
  return(
    <div className="dbp cloud">
      <Header per={per} setView={v=>setSel(s=>({...s,view:v}))} step={k=>goTo(...shiftYm(Y,M,k))} canBack={ymNum(Y,M)>floor} canFwd={ymNum(Y,M)<ceil}/>
      <Summary nw={nw} nwLine={nwLine} per={per} stats={statsReady?stats:null}/>
      <div className="db-row">
        <PacePanel per={per} tot={B?.tot}/>
        <TrendPanel per={per} bud={budgetReady?bud:null} onPick={goTo}/>
        <WherePanel per={per} stats={statsReady?stats:null}/>
      </div>
      <BudgetCard per={per} B={B} groups={groups} detail={detail} onPick={toggle}/>
      {detail&&<DetailPanel panelRef={detRef} per={per} detail={detail} det={det} groups={groups} onClose={()=>setDetail(null)} onMore={()=>setPage('transactions')}/>}
    </div>
  );
}

/* ── Header ───────────────────────────────────────────────── */
function Header({per,setView,step,canBack,canFwd}){
  const hr=new Date().getHours(),greeting=`Good ${hr<12?'morning':hr<17?'afternoon':'evening'}, Omer`;
  return(
    <header className="c-panel db-hdr">
      <h1>{greeting}</h1>
      <div className="db-hdr-r">
        <div className="db-und" role="group" aria-label="View">
          {[['month','Monthly'],['annual','Year to date']].map(([v,l])=>(
            <button type="button" key={v} className={per.view===v?'on':''} aria-pressed={per.view===v} onClick={()=>setView(v)}>{l}</button>
          ))}
        </div>
        <div className="db-step">
          <button type="button" aria-label="Previous month" disabled={!canBack} onClick={()=>step(-1)}>‹</button>
          <b>{MONL[per.M-1]} {per.Y}</b>
          <button type="button" aria-label="Next month" disabled={!canFwd} onClick={()=>step(1)}>›</button>
        </div>
      </div>
    </header>
  );
}

/* ── Summary figures ──────────────────────────────────────── */
const pctChange=(c,p)=>(p==null||Math.abs(p)<.01)?null:Math.round((c-p)/Math.abs(p)*100);
function Figure({label,value,change,cmp,invert,hl}){
  let sub=<span className="c-mut">—</span>;
  if(change!==undefined&&change!==null){
    const good=invert?change<=0:change>=0;
    sub=<><span className={`db-chg ${good?'c-good':'c-bad'}`}>{change>0?'▲':change<0?'▼':''} {Math.abs(change)}%</span><span className="c-mut">{cmp}</span></>;
  }
  return(
    <div className={`db-kv ${hl?'hl':''}`}>
      <b className="db-kn c-val">{value}</b>
      <span className="db-kl">{label}</span>
      <div className="db-ksub">{sub}</div>
    </div>
  );
}
function Spark({points}){
  if(!points||points.length<2)return<div className="db-spark"/>;
  const v=points.map(p=>p.net_worth),mn=Math.min(...v),mx=Math.max(...v),W=200,H=44;
  const d=v.map((y,i)=>`${i?'L':'M'}${(i/(v.length-1)*W).toFixed(1)},${(H-4-(y-mn)/((mx-mn)||1)*(H-8)).toFixed(1)}`).join(' ');
  return<svg className="db-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><path d={d} vectorEffect="non-scaling-stroke"/></svg>;
}
function Summary({nw,nwLine,per,stats}){
  const cash=nw?(nw.buckets?.['Cash & Savings']?.accounts||[]).reduce((s,a)=>s+a.balance,0):null;
  const first=nwLine&&nwLine.length?nwLine[0]:null;
  let since=null;
  if(nw&&first){const[fy,fm]=first.date.split('-').map(Number),ch=nw.net_worth-first.net_worth;since=`${ch<0?'−':'+'}${m2(Math.abs(ch))} since ${MON[fm-1]} ${fy}`;}
  const inc=stats?.cur.total_income??null,exp=stats?.cur.total_expenses??null;
  const pInc=stats?.prev.total_income??null,pExp=stats?.prev.total_expenses??null;
  const net=stats?inc-exp:null,pNet=stats?pInc-pExp:null;
  const dash='—';
  return(
    <section className="db-kpis">
      <div className="c-panel db-hero">
        <Figure label="Net Worth" value={nw?m2(nw.net_worth):dash} hl/>
        <Spark points={nwLine}/>
        <span className="c-mut">{since||' '}</span>
      </div>
      <div className="db-hero-g">
        <div className="c-panel db-cell"><Figure label="Checking & Savings" value={cash==null?dash:m2(cash)}/></div>
        <div className="c-panel db-cell"><Figure label="Income" value={stats?m2(inc):dash} change={stats?pctChange(inc,pInc):undefined} cmp={per.cmp}/></div>
        <div className="c-panel db-cell"><Figure label="Expenses" value={stats?m2(exp):dash} change={stats?pctChange(exp,pExp):undefined} cmp={per.cmp} invert/></div>
        <div className="c-panel db-cell"><Figure label="Net Cash Flow" value={stats?(net<0?`(${m2(-net)})`:m2(net)):dash} change={stats?pctChange(net,pNet):undefined} cmp={per.cmp}/></div>
      </div>
    </section>
  );
}

const Loading=()=><p className="c-mut db-loading">Loading…</p>;

/* ── Month pace ───────────────────────────────────────────── */
function PacePanel({per,tot}){
  const title=per.view==='month'?'Month pace':'Year pace';
  if(!tot)return<section className="c-panel db-panel db-pace"><div className="db-ph"><h2>{title}</h2><span className="c-mut">{per.label}</span></div><Loading/></section>;
  const p=pace(per,tot);
  const head=p.done
    ?(p.over?<>Finished <b className="c-bad">{m2(p.X-p.B)}</b> over budget</>:<>Finished <b className="c-good">{m2(p.B-p.X)}</b> under budget</>)
    :(p.proj>p.B?<>On pace for {m2(p.proj)}, <b className="c-bad">{m2(p.proj-p.B)}</b> over</>:<>On pace for {m2(p.proj)}, <b className="c-good">within budget</b></>);
  const sub=`${m2(p.X)} spent of ${m2(p.B)} · ${per.view==='month'?`day ${p.elapsed} of ${p.total}`:per.label}`;
  // The arc runs from 0 to 150% of budget, so the Budget mark sits two thirds of the way round.
  const L=Math.PI*90,cap=1.5,fr=v=>Math.min(Math.max(v,0),cap)/cap,f=fr(p.pct),ARC='M20,112 A90,90 0 0 1 200,112';
  const pt=(t,R)=>{const th=Math.PI-Math.PI*t;return[110+R*Math.cos(th),112-R*Math.sin(th)];};
  const tick=(t,cls,lab)=>{const[x1,y1]=pt(t,76),[x2,y2]=pt(t,104),[lx,ly]=pt(t,116);
    return<g key={cls}><line className={cls} x1={x1} y1={y1} x2={x2} y2={y2}/><text className="db-tx" x={lx} y={ly} textAnchor="middle">{lab}</text></g>;};
  return(
    <section className="c-panel db-panel db-pace">
      <div className="db-ph"><h2>{title}</h2><span className="c-mut">{per.label}</span></div>
      <p className="db-pace-h">{head}</p>
      <p className="db-pace-s">{sub}</p>
      <svg className="db-gauge" viewBox="-40 -14 300 136" role="img" aria-label={`${Math.round(p.pct*100)}% of budget used`}>
        <path className="g-bg" d={ARC}/>
        <path className={`g-fg ${p.over?'over':''}`} d={ARC} strokeDasharray={`${L*f} ${L*2}`}/>
        {tick(1/cap,'g-tk','Budget')}
        {!p.done&&tick(p.share/cap,'g-td','Today')}
        <text className={`g-v ${p.over?'bad':''}`} x="110" y="98" textAnchor="middle">{usd0(Math.abs(p.over?p.X-p.B:p.B-p.X))}</text>
        <text className="db-tx" x="110" y="114" textAnchor="middle">{p.over?'over budget':'left to spend'}</text>
      </svg>
    </section>
  );
}

/* ── Spending trend ───────────────────────────────────────── */
function smooth(p){
  const n=p.length;if(n<2)return'';if(n===2)return`M${p[0][0]},${p[0][1]} L${p[1][0]},${p[1][1]}`;
  // Monotone cubic: smooth, but never overshoots past a neighbouring month's value.
  const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]),d=[];for(let i=0;i<n-1;i++)d.push((ys[i+1]-ys[i])/(xs[i+1]-xs[i]));
  const m=new Array(n);m[0]=d[0];m[n-1]=d[n-2];for(let i=1;i<n-1;i++)m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
  for(let i=0;i<n-1;i++){if(d[i]===0){m[i]=0;m[i+1]=0;}else{const a=m[i]/d[i],b=m[i+1]/d[i],h=Math.hypot(a,b);if(h>3){const t=3/h;m[i]=t*a*d[i];m[i+1]=t*b*d[i];}}}
  let s=`M${xs[0]},${ys[0]}`;for(let i=0;i<n-1;i++){const dx=(xs[i+1]-xs[i])/3;s+=` C${xs[i]+dx},${ys[i]+m[i]*dx} ${xs[i+1]-dx},${ys[i+1]-m[i+1]*dx} ${xs[i+1]},${ys[i+1]}`;}
  return s;
}
/* Measures its box: the chart stretches to fill the card (never under 200px tall). */
function useBox(){
  const ref=useRef(null),[box,setBox]=useState(null);
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    const read=()=>{const W=Math.max(Math.round(el.clientWidth),240),H=Math.max(Math.round(el.clientHeight),200);setBox(b=>b&&b.W===W&&b.H===H?b:{W,H});};
    read();const ro=new ResizeObserver(read);ro.observe(el);return()=>ro.disconnect();
  },[]);
  return[ref,box];
}
function TrendPanel({per,bud,onPick}){
  const[ref,box]=useBox();
  const rows=bud?trendMonths(per.Y,per.M,bud.actuals):null,selYm=`${per.Y}-${String(per.M).padStart(2,'0')}`;
  let svg=null;
  if(rows&&box){
    const{W,H}=box,P={t:22,r:16,b:26,l:16},cw=W-P.l-P.r,chh=H-P.t-P.b,n=rows.length,slot=cw/n;
    const mx=Math.max(...rows.map(r=>r.spend),100)*1.1,y=v=>P.t+chh-(Math.max(v,0)/mx)*chh,base=P.t+chh;
    const pts=rows.map((r,i)=>[P.l+(i+.5)*slot,y(r.spend)]),dd=smooth(pts);
    // In narrow cards only the first, last and selected months keep their value labels.
    const dense=slot<46,show=(r,i)=>!dense||i===0||i===n-1||r.ym===selYm;
    svg=(
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Monthly spending, last 6 months">
        <defs><linearGradient id="dbArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" className="st0"/><stop offset="100%" className="st1"/></linearGradient></defs>
        {[0,.25,.5,.75,1].map(f=><line key={f} className="db-grid" x1={P.l} x2={W-P.r} y1={P.t+(1-f)*chh} y2={P.t+(1-f)*chh}/>)}
        <path className="db-area" d={`${dd} L${pts[n-1][0]},${base} L${pts[0][0]},${base} Z`}/>
        <path className="db-ln" d={dd}/>
        {rows.map((r,i)=>{const on=r.ym===selYm,[x,yy]=pts[i];return(
          <g key={r.ym}>
            <circle className="db-dot" cx={x} cy={yy} r={on?5.5:4}/>
            {show(r,i)&&<text className={`db-tl ${on?'strong':''}`} x={x} y={yy<P.t+18?yy+16:yy-9} textAnchor="middle">{k1(r.spend)}</text>}
            <text className={`db-tx ${on?'on':''}`} x={x} y={H-6} textAnchor="middle">{r.lab}</text>
            <rect className="db-hit" x={P.l+i*slot} y={P.t} width={slot} height={chh+P.b} onClick={()=>onPick(r.y,r.m)}><title>{MONL[r.m-1]} {r.y}</title></rect>
          </g>);})}
      </svg>
    );
  }
  const range=rows?(rows[0].y!==rows[5].y?`${rows[0].lab} ${rows[0].y} – ${rows[5].lab} ${rows[5].y}`:`${rows[0].lab} – ${rows[5].lab} ${rows[5].y}`):'';
  return(
    <section className="c-panel db-panel db-trend">
      <div className="db-ph"><h2>Spending trend</h2><span className="c-mut">{range}</span></div>
      <div className="db-chart" ref={ref}>{svg||<Loading/>}</div>
      <p className="db-hint">Click a month to open it.</p>
    </section>
  );
}

/* ── Where the money went ─────────────────────────────────── */
function WherePanel({per,stats}){
  const head=<div className="db-ph"><h2>Where the money went</h2><span className="c-mut">{per.label}</span></div>;
  if(!stats)return<section className="c-panel db-panel db-where">{head}<Loading/></section>;
  const month=per.view==='month';
  const w=whereData(topSpend(stats.cur.by_category),month?topSpend(stats.prev.by_category):null);
  const pc=v=>w.tot>0?Math.round(v/w.tot*100)+'%':'—';
  const seg=(x,t)=><i key={x.k} style={{width:`${x.v/t*100}%`,background:x.col}} title={`${x.k}: ${m2(x.v)}`}/>;
  let bars;
  if(month){
    const mx=Math.max(w.tot,w.ptot)||1;
    bars=(
      <>
        <div className="db-wb2">
          <div className="db-wb-r"><span>{MON[per.M-1]}</span><div><div className="db-wbar" style={{height:28,width:`${w.tot/mx*100}%`}}>{w.items.map(x=>seg(x,w.tot))}</div></div><b>{k1(w.tot)}</b></div>
          <div className="db-wb-r prev" title={`${MONL[per.pM-1]}${per.isCM?', same days,':''} on the same scale`}><span>{MON[per.pM-1]}</span><div><div className="db-wbar" style={{height:17,width:`${w.ptot/mx*100}%`}}>{(w.prevItems||[]).map(x=>seg(x,w.ptot||1))}</div></div><b>{k1(w.ptot)}</b></div>
        </div>
        {per.isCM&&<p className="c-mut db-wb-n">Same days of {MONL[per.pM-1]} underneath.</p>}
      </>
    );
  }else bars=<div className="db-wbar solo" style={{height:28}}>{w.items.map(x=>seg(x,w.tot))}</div>;
  return(
    <section className="c-panel db-panel db-where">
      {head}
      {w.tot>0?<>{bars}
        <div className="db-wl">{w.items.map(x=><div className="db-wl-r" key={x.k}><i style={{background:x.col}}/><span>{x.k}</span><em>{pc(x.v)}</em><b>{m2(x.v)}</b></div>)}</div></>
        :<p className="c-mut">No spending in this period yet.</p>}
      {w.creditTotal>=1&&<p className="c-mut db-wnote" title="Gross spending, so this is more than the budget card's total.">Leaves out {m2(w.creditTotal)} of net credits ({w.credits.slice(0,2).join(', ')}{w.credits.length>2?'…':''}).</p>}
    </section>
  );
}

/* ── Budget performance ───────────────────────────────────── */
function Bar({r}){
  const w=r.hasB&&!r.credit?Math.min(r.pct*100,100):0,cls=r.over?'over':r.near?'near':'ok';
  const lab=r.hasB&&!r.credit?<span className={r.over?'c-bad':''}>{Math.round(r.pct*100)}%</span>:r.noB?<span className="nob">no budget set</span>:null;
  return(
    <div className={`db-bt ${cls}`}>
      {w>0&&<i style={{width:`${w}%`}}/>}
      {!r.credit&&<><s style={{left:'25%'}}/><s style={{left:'50%'}}/><s style={{left:'75%'}}/></>}
      {lab}
    </div>
  );
}
function TileFigure({r}){
  if(!r.hasB||r.credit)return<span className={`db-tf ${r.credit?'c-good':''}`}>{r.credit?'+'+m2(-r.actual):m2(r.actual)}</span>;
  return r.actual>r.budget?<span className="db-tf c-bad">{m2(r.actual-r.budget)} over</span>:<span className="db-tf c-good">{m2(r.budget-r.actual)} left</span>;
}
const tileSub=r=>r.hasB&&!r.credit?`${m2(r.actual)} of ${m2(r.budget)}`:r.hasB?`of ${m2(r.budget)}`:r.credit?'net credit':'no budget set';
const press=fn=>({role:'button',tabIndex:0,onClick:e=>{e.stopPropagation();fn();},onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();fn();}}});

function BudgetCard({per,B,groups,detail,onPick}){
  return(
    <section className="c-panel db-bud">
      <div className="db-ph db-bud-h"><h2>Budget performance</h2><span className="c-mut">{per.label}</span></div>
      {!B?<div className="db-pad"><Loading/></div>:<>
        <div className="db-btot"><span>Total spent</span><b className="c-val">{m2(B.tot.actual)}</b><span className="c-mut">of {m2(B.tot.budget)} budgeted</span></div>
        {groups.length?(
          <div className="db-tiles">
            {groups.map(g=>{const key='g:'+g.cat;return(
              <div key={key} className={`db-ti ${detail===key?'on':''}`} {...press(()=>onPick(key))} aria-pressed={detail===key}>
                <div className="db-ti-h"><b>{g.cat}</b><TileFigure r={g}/></div>
                <Bar r={g}/>
                <span className="c-mut">{tileSub(g)}</span>
                {!g.solo&&(
                  <div className="db-kids">
                    {g.kids.map(k=>(
                      <div key={k.cat} className={`db-kid ${detail===k.cat?'on':''}`} {...press(()=>onPick(k.cat))} aria-pressed={detail===k.cat}>
                        <span>{k.cat}</span>
                        <b className={k.over?'c-bad':k.credit?'c-good':''}>{k.credit?'+'+m2(-k.actual):m2(k.actual)}</b>
                        <small>{k.hasB?'of '+m2(k.budget):k.credit?'net credit':'no budget'}</small>
                        <i className={`db-kid-t ${k.over?'over':k.near?'near':''}`}><em style={{width:`${k.hasB&&!k.credit?Math.min(k.pct*100,100):0}%`}}/></i>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );})}
          </div>
        ):<p className="c-mut db-pad">No budgets or spending in this period.</p>}
      </>}
    </section>
  );
}

/* ── Category detail, under the budget card ───────────────── */
const shortDate=s=>{const[,m,d]=s.split('-').map(Number);return`${MON[m-1]} ${d}`;};
function DetailPanel({panelRef,per,detail,det,groups,onClose,onMore}){
  const grp=detail.startsWith('g:'),name=grp?detail.slice(2):detail;
  const g=grp?groups.find(x=>x.cat===name):null;
  const rows=det&&det.key===detail?det.rows:[],loading=!det||det.key!==detail||det.loading;
  const tot=rows.reduce((s,r)=>s+r.v,0),show=rows.slice(0,DETAIL_ROWS);
  return(
    <section className="c-panel db-det" ref={panelRef}>
      <div className="db-det-h">
        <div>
          <b>{name}</b>
          {!loading&&<span className={tot>=0?'c-bad':'c-good'}>{tot>=0?'-':'+'}{m2(Math.abs(tot))}</span>}
          <span className="c-mut">{loading?'Loading…':`${rows.length} transaction${rows.length===1?'':'s'} · ${per.label}`}</span>
        </div>
        <button type="button" className="c-x" aria-label="Close category detail" onClick={onClose}>✕</button>
      </div>
      {g&&!g.solo&&(
        <div className="db-det-k">
          {g.kids.map(k=><span key={k.cat}><b>{k.cat}</b> <em className={k.over?'c-bad':k.credit?'c-good':''}>{k.credit?'+'+m2(-k.actual):m2(k.actual)}</em>{k.hasB?` of ${m2(k.budget)}`:' · no budget'}</span>)}
        </div>
      )}
      {!loading&&(
        <div className="db-det-l">
          {show.length?show.map((r,i)=>(
            <div className="db-dr" key={`${r.id}-${i}`}>
              <span className="db-rd">{shortDate(r.date)}</span>
              <div className="db-rn"><b>{r.merchant||r.description}</b><span>{grp?`${ncat(r.category)}${r.account?` · ${r.account}`:''}`:(r.account||'')}</span></div>
              <b className={`db-amt ${r.v>=0?'':'c-good'}`}>{r.v>=0?'-':'+'}{m2(Math.abs(r.v))}</b>
            </div>
          )):<p className="c-mut db-pad">No transactions in this period.</p>}
          {rows.length>show.length&&<button type="button" className="c-lnk db-more" onClick={onMore}>{rows.length-show.length} more in Transactions →</button>}
        </div>
      )}
    </section>
  );
}
