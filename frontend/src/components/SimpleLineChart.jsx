export function SimpleLineChart({lines,height=180,fmtY}){
  if(!lines||lines.length===0||lines.every(l=>!l.points||l.points.length===0))
    return<div style={{padding:'32px 0',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>No data yet — run Balance Sync first</div>;
  const yFmt=fmtY||(v=>{const abs=Math.abs(v);const s=v<0?'-':'';return s+(abs>=1000000?`$${(abs/1000000).toFixed(2)}M`:abs>=1000?`$${(abs/1000).toFixed(2)}k`:`$${abs.toFixed(2)}`);});
  const allY=lines.flatMap(l=>l.points.map(p=>p.y));
  const minY=Math.min(...allY);const maxY=Math.max(...allY);
  const rangeY=maxY-minY||1;
  const xs=lines[0].points.map(p=>p.x);
  const W=600,H=height;
  const pad={top:12,right:12,bottom:28,left:64};
  const cW=W-pad.left-pad.right,cH=H-pad.top-pad.bottom;
  const xPos=i=>pad.left+(xs.length<2?cW/2:i/(xs.length-1)*cW);
  const yPos=v=>pad.top+cH-((v-minY)/rangeY)*cH;
  const yTicks=[0,1,2,3,4].map(i=>minY+rangeY*i/4);
  const step=xs.length>18?6:xs.length>9?3:1;
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:height,display:'block'}}>
      {yTicks.map((v,i)=>(
        <g key={i}>
          <line x1={pad.left} y1={yPos(v)} x2={pad.left+cW} y2={yPos(v)} stroke="#f3f4f6" strokeWidth="1"/>
          <text x={pad.left-6} y={yPos(v)+4} textAnchor="end" fontSize="10" fill="#9ca3af">{yFmt(v)}</text>
        </g>
      ))}
      {minY<0&&maxY>0&&<line x1={pad.left} y1={yPos(0)} x2={pad.left+cW} y2={yPos(0)} stroke="#e5e7eb" strokeWidth="1.5" strokeDasharray="4,2"/>}
      {lines.map((line,li)=>{
        const pts=line.points.map((p,i)=>`${xPos(i)},${yPos(p.y)}`).join(' ');
        return<polyline key={li} points={pts} fill="none" stroke={line.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>;
      })}
      {xs.map((x,i)=>i%step===0&&<text key={i} x={xPos(i)} y={H-6} textAnchor="middle" fontSize="9" fill="#9ca3af">{x}</text>)}
    </svg>
  );
}

/* ── Spending Breakdown: interactive donut + ranked category list ──────────── */
