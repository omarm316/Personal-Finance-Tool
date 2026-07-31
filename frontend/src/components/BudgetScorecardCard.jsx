import {fmt} from '../lib/format';

export function BudgetScorecardCard({targets,actuals,view='month',ytdActuals={},viewMonth,viewYear}){
  const now=new Date();
  const yr=viewYear||now.getFullYear();
  const mo=viewMonth||(now.getMonth()+1);
  const mStr=String(mo);
  const monthLabel=new Date(yr,mo-1,1).toLocaleString('default',{month:'long'});
  const SKIP=new Set(['Transfer','Work']);
  const isAnnual=view==='annual';
  const title=isAnnual?`Budget vs. Actual — ${yr} YTD`:`Budget vs. Actual — ${monthLabel} ${yr}`;

  // Annual mode: use ytdActuals from /stats (expense-only, credits netted).
  // Monthly mode: use budgetActuals per-month slice.
  const allCats=new Set([
    ...Object.keys(targets),
    ...(isAnnual?Object.keys(ytdActuals):Object.keys(actuals)),
  ]);
  const rows=[];
  allCats.forEach(cat=>{
    if(SKIP.has(cat))return;
    let budget,actual;
    if(isAnnual){
      budget=(()=>{let s=0;for(let m=1;m<=12;m++)s+=(targets[cat]?.[String(m)]?.amount||0);return s;})();
      actual=ytdActuals[cat]||0; // expense-only from /stats, already nets credits
    }else{
      budget=targets[cat]?.[mStr]?.amount||0;
      actual=actuals[cat]?.[mStr]||0;
    }
    if(budget===0&&actual===0)return;
    rows.push({cat,budget,actual});
  });
  rows.sort((a,b)=>{
    const hA=a.budget>0,hB=b.budget>0;
    if(hA&&hB)return(b.actual/b.budget)-(a.actual/a.budget);
    if(hA&&!hB)return -1;
    if(!hA&&hB)return 1;
    return b.actual-a.actual;
  });
  if(rows.length===0)return(
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,display:'flex',flexDirection:'column',gap:6,padding:20}}>
      <div style={{fontSize:11,fontWeight:500,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)'}}>{title}</div>
      <div style={{color:'var(--text-muted)',fontSize:13,textAlign:'center',padding:'12px 0 8px'}}>
        {isAnnual?'No budget or spending data for this year yet.':'No budget or spending data for this month yet.'}
      </div>
    </div>
  );
  const totalBudget=rows.reduce((s,r)=>s+r.budget,0);
  const totalActual=rows.reduce((s,r)=>s+r.actual,0);
  const fmtSigned=(n)=>n<0?`-${fmt(n)}`:fmt(n);
  const totalPct=totalBudget>0?totalActual/totalBudget:null;
  const totalOver=totalBudget>0&&totalActual>totalBudget;
  const totalDotColor=totalPct===null?'var(--text-muted)':totalPct>=1?'var(--red)':totalPct>=0.8?'var(--amber)':'var(--green)';
  const totalFill=totalPct===null?'transparent':totalPct>=1?'rgba(239,68,68,0.15)':totalPct>=0.8?'rgba(245,158,11,0.15)':'rgba(16,185,129,0.15)';
  const totalBarPct=totalBudget>0?Math.min(totalActual/totalBudget*100,100):0;

  const PillRow=({cat,budget,actual,isTotal=false})=>{
    const isCredit=actual<0;
    const pct=(!isCredit&&budget>0)?actual/budget:null;
    const over=budget>0&&actual>budget;
    const overAmt=over?actual-budget:0;
    const dotColor=isCredit?'var(--green)':pct===null?'var(--text-muted)':over?'var(--red)':pct>=0.8?'var(--amber)':'var(--green)';
    const pillFill=isCredit?'rgba(52,211,153,0.12)':pct===null?'transparent':over?'rgba(248,113,113,0.12)':pct>=0.8?'rgba(251,191,36,0.12)':'rgba(52,211,153,0.12)';
    const barPct=(!isCredit&&budget>0)?Math.min(actual/budget*100,100):0;
    return(
      <div style={{padding:'5px 14px',borderBottom:isTotal?'2px solid var(--border)':'1px solid var(--border)',display:'flex',alignItems:'center',gap:10}}>
        <div style={{flex:1,position:'relative',borderRadius:8,overflow:'hidden',background:'var(--elevated)',height:32,border:'1px solid var(--border)'}}>
          {barPct>0&&<div style={{position:'absolute',left:0,top:0,bottom:0,width:`${barPct}%`,background:pillFill,transition:'width 0.35s ease'}}/>}
          <div style={{position:'relative',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 10px',height:'100%',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:dotColor,flexShrink:0}}/>
              <span style={{fontSize:isTotal?12.5:12,fontWeight:isTotal?500:400,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cat}</span>
            </div>
            {!isCredit&&pct!==null&&<span style={{fontSize:11,fontWeight:500,color:dotColor,flexShrink:0}}>{Math.round(pct*100)}%</span>}
            {isCredit&&<span style={{fontSize:11,fontWeight:500,color:'var(--green)',flexShrink:0}}>credit</span>}
          </div>
        </div>
        <div style={{fontSize:12,minWidth:90,textAlign:'right',whiteSpace:'nowrap',flexShrink:0,fontWeight:300,fontFamily:'Plus Jakarta Sans, sans-serif'}}>
          {isCredit
            ?<span style={{color:'var(--green)',fontWeight:400}}>{fmtSigned(actual)}</span>
            :budget>0
              ?<span style={{fontWeight:isTotal?500:400}}>{fmt(actual)}<span style={{color:'var(--text-muted)',fontWeight:300}}> / {fmt(budget)}</span>{over&&<span style={{color:'var(--red)',fontWeight:300}}> +{fmt(overAmt)}</span>}</span>
              :<span style={{color:'var(--text-muted)'}}>{fmt(actual)}</span>}
        </div>
      </div>
    );
  };

  return(
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,overflow:'hidden'}}>
      <div style={{padding:'16px 20px 8px',fontSize:11,fontWeight:500,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)'}}>{title}</div>
      <div style={{padding:'4px 0 8px'}}>
        <PillRow cat="Total" budget={totalBudget} actual={totalActual} isTotal={true}/>
        {rows.map(({cat,budget,actual})=>(
          <PillRow key={cat} cat={cat} budget={budget} actual={actual}/>
        ))}
      </div>
    </div>
  );
}

/* ── Budget vs. Actual + Spending combined table ─────────────────────────── */
