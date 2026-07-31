import {useState} from 'react';
import {CHART_COLORS} from '../lib/constants';
import {fmt} from '../lib/format';

export function SpendingBreakdownCard({topCats,onCategoryClick,selectedCat}){
  const[hovCat,setHovCat]=useState(null);
  if(!topCats||topCats.length===0)return(
    <div className="card" style={{display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',minHeight:120,gap:6}}>
      <div className="section-header" style={{width:'100%'}}><div className="section-title">Spending Breakdown</div></div>
      <div style={{color:'var(--text-muted)',fontSize:13,textAlign:'center',padding:'12px 0 8px'}}>No spending recorded yet this month.</div>
    </div>
  );
  const total=topCats.reduce((s,[,a])=>s+a,0);
  const data=topCats.map(([cat,amount],i)=>({cat,amount,color:CHART_COLORS[i%CHART_COLORS.length]}));
  /* SVG donut via arc paths */
  const cx=85,cy=85,R=64,r=44,GAP=2.5;
  const polar=(radius,deg)=>{const a=(deg-90)*Math.PI/180;return[cx+radius*Math.cos(a),cy+radius*Math.sin(a)];};
  const segPath=(s,e)=>{
    const lg=e-s>180?1:0;
    const[x1,y1]=polar(R,s);const[x2,y2]=polar(R,e);const[x3,y3]=polar(r,e);const[x4,y4]=polar(r,s);
    return`M${x1},${y1} A${R},${R} 0 ${lg},1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${lg},0 ${x4},${y4} Z`;
  };
  let cum=0;
  const segs=data.map(({cat,amount,color})=>{
    const deg=(amount/total)*360;
    const seg={cat,color,path:segPath(cum+GAP/2,cum+deg-GAP/2)};
    cum+=deg;return seg;
  });
  const hd=hovCat?data.find(d=>d.cat===hovCat):null;
  return(
    <div className="card">
      <div className="section-header">
        <div className="section-title">Spending Breakdown</div>
        {selectedCat&&<span style={{fontSize:11,color:'var(--blue)',fontWeight:500}}>Click a category to toggle detail ↓</span>}
      </div>
      <div style={{display:'flex',alignItems:'center',padding:'8px 0 12px'}}>
        {/* Donut */}
        <svg width={170} height={170} style={{flexShrink:0,overflow:'visible',cursor:'default'}}>
          {segs.map(({cat,color,path})=>{
            const isSel=selectedCat===cat;
            return(
              <path key={cat} d={path} fill={color}
                opacity={hovCat&&hovCat!==cat&&!isSel?0.2:1}
                stroke={isSel?'#1d4ed8':'none'} strokeWidth={isSel?2.5:0}
                style={{cursor:'pointer',transition:'opacity 0.15s'}}
                onMouseEnter={()=>setHovCat(cat)} onMouseLeave={()=>setHovCat(null)}
                onClick={()=>onCategoryClick&&onCategoryClick(cat)}/>
            );
          })}
          <text x={cx} y={hd?cy-13:cy-9} textAnchor="middle" fontSize={9.5} fill="#9ca3af">{hd?hd.cat:'Total Spend'}</text>
          <text x={cx} y={hd?cy+5:cy+9} textAnchor="middle" fontSize={hd?13:14} fontWeight={400} fill="var(--text-primary)" fontFamily="Plus Jakarta Sans">{fmt(hd?hd.amount:total)}</text>
          {hd&&<text x={cx} y={cy+22} textAnchor="middle" fontSize={9.5} fill="#9ca3af">{Math.round(hd.amount/total*100)}% of spend</text>}
        </svg>
        {/* Category list — hover syncs with donut */}
        <div style={{flex:1,paddingRight:16}}>
          {data.map(({cat,amount,color})=>{
            const pct=Math.round(amount/total*100);
            const isHov=hovCat===cat;
            const isSel=selectedCat===cat;
            return(
              <div key={cat}
                style={{display:'flex',alignItems:'center',gap:8,padding:'5px 6px',borderRadius:6,
                  background:isSel?'#dbeafe':isHov?'#f0f6ff':'transparent',
                  cursor:'pointer',transition:'background 0.1s',
                  outline:isSel?'1.5px solid #93c5fd':'none'}}
                onMouseEnter={()=>setHovCat(cat)} onMouseLeave={()=>setHovCat(null)}
                onClick={()=>onCategoryClick&&onCategoryClick(cat)}>
                <span style={{width:8,height:8,borderRadius:'50%',background:color,flexShrink:0}}/>
                <span style={{flex:1,fontSize:12,fontWeight:isSel||isHov?600:400,color:'var(--text-primary)'}}>{cat}</span>
                <span style={{fontFamily:'Plus Jakarta Sans',fontSize:11,color:'var(--red)'}}>{fmt(amount)}</span>
                <span style={{fontFamily:'Plus Jakarta Sans',fontSize:10,color:'var(--text-muted)',minWidth:28,textAlign:'right'}}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Budget vs Actual: 12-month bar chart with target markers ─────────────── */
