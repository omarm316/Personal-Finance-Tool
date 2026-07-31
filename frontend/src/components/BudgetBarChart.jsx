export function BudgetBarChart({actuals,targets,actualsPrior,targetsPrior,expenseCats}){
  const MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now=new Date();const curM=now.getMonth()+1,curY=now.getFullYear();
  /* Build last 12 calendar months */
  const months12=Array.from({length:12},(_,i)=>{
    const d=new Date(curY,curM-1-(11-i),1);
    return{year:d.getFullYear(),month:d.getMonth()+1,isCur:i===11};
  });
  const getA=(year,month)=>{
    const src=year===curY?actuals:actualsPrior;
    return expenseCats.reduce((s,cat)=>s+(src[cat]?.[String(month)]||0),0);
  };
  const getB=(year,month)=>{
    const src=year===curY?targets:targetsPrior;
    return expenseCats.reduce((s,cat)=>s+(src[cat]?.[String(month)]?.amount||0),0);
  };
  const data=months12.map(({year,month,isCur},i)=>({
    label:MO[month-1]+(month===1?` '${String(year).slice(2)}`:''),
    actual:getA(year,month),budget:getB(year,month),isCur,isFuture:false,
  }));
  const maxVal=Math.max(...data.map(d=>Math.max(d.actual,d.budget)),100);
  const W=560,H=190;
  const pad={top:20,right:12,bottom:28,left:58};
  const cW=W-pad.left-pad.right,cH=H-pad.top-pad.bottom;
  const colW=cW/12,barW=colW*0.55;
  const xMid=i=>pad.left+i*colW+colW/2;
  const yV=v=>pad.top+cH-(v/maxVal)*cH;
  const yTicks=[0,0.25,0.5,0.75,1].map(p=>maxVal*p);
  const cs=typeof window!=='undefined'?getComputedStyle(document.documentElement):null;
  const gv=p=>cs?cs.getPropertyValue(p).trim():'';
  const gridC=gv('--border')||'rgba(255,255,255,0.06)';
  const labelC=gv('--text-muted')||'#707080';
  const curC=gv('--blue-primary')||'#2563EB';
  const greenC=gv('--green')||'#34d399';
  const amberC=gv('--amber')||'#fbbf24';
  const redC=gv('--red')||'#f87171';
  const txtC=gv('--text-primary')||'#e8e8ed';
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:H,display:'block'}}>
      {/* Y grid + labels */}
      {yTicks.map((v,i)=>(
        <g key={i}>
          <line x1={pad.left} y1={yV(v)} x2={pad.left+cW} y2={yV(v)} stroke={gridC} strokeWidth={1}/>
          <text x={pad.left-6} y={yV(v)+4} textAnchor="end" fontSize={9} fill={labelC}>{v>=1000?`$${(v/1000).toFixed(0)}k`:`$${Math.round(v)}`}</text>
        </g>
      ))}
      {/* Bars + budget target ticks */}
      {data.map(({label,actual,budget,isCur},i)=>{
        const over=budget>0&&actual>budget;
        const close=budget>0&&!over&&actual>budget*0.85;
        const barColor=over?redC:close?amberC:greenC;
        const bH=Math.max((actual/maxVal)*cH,actual>0?2:0);
        const x=xMid(i)-barW/2;
        return(
          <g key={i}>
            {isCur&&<rect x={pad.left+i*colW} y={pad.top} width={colW} height={cH} fill={curC} opacity={0.06} rx={2}/>}
            {actual>0&&<rect x={x} y={yV(actual)} width={barW} height={bH} fill={barColor} opacity={0.82} rx={2}/>}
            {budget>0&&<line x1={x-3} y1={yV(budget)} x2={x+barW+3} y2={yV(budget)} stroke={labelC} strokeWidth={2} strokeLinecap="round"/>}
            <text x={xMid(i)} y={H-6} textAnchor="middle" fontSize={9} fill={isCur?txtC:labelC} fontWeight={isCur?500:300}>{label}</text>
          </g>
        );
      })}
      {/* Legend */}
      <rect x={pad.left} y={3} width={8} height={8} fill={greenC} rx={1} opacity={0.82}/>
      <text x={pad.left+11} y={10} fontSize={8.5} fill={labelC}>Under budget</text>
      <rect x={pad.left+85} y={3} width={8} height={8} fill={amberC} rx={1} opacity={0.82}/>
      <text x={pad.left+96} y={10} fontSize={8.5} fill={labelC}>Near limit</text>
      <rect x={pad.left+158} y={3} width={8} height={8} fill={redC} rx={1} opacity={0.82}/>
      <text x={pad.left+169} y={10} fontSize={8.5} fill={labelC}>Over budget</text>
      <line x1={pad.left+230} y1={7} x2={pad.left+244} y2={7} stroke={labelC} strokeWidth={2} strokeLinecap="round"/>
      <text x={pad.left+247} y={10} fontSize={8.5} fill={labelC}>Budget target</text>
    </svg>
  );
}
