import React,{useState} from 'react';
import {fmt,normalizeCat} from '../lib/format';

export function BudgetAndSpendingCard({targets,actuals,view,ytdActuals,viewMonth,viewYear,onSetView,onSetYear,onSetMonth,onCatClick,activeCat}){
  const[sortBy,setSortBy]=React.useState('pct');
  const[sortDir,setSortDir]=React.useState('desc');
  const now=new Date();
  const yr=viewYear||now.getFullYear();
  const mo=viewMonth||(now.getMonth()+1);
  const mStr=String(mo);
  const SKIP=new Set(['Transfer','Work']);
  const isAnnual=view==='annual';
  const fmt0=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.abs(n??0));
  const BLUE='var(--sidebar-active-color)';
  const BLUE_BG='var(--sidebar-active-bg)';

  // Build rows, merging any keys that normalize to the same display name (fixes duplicate "Other")
  const allCats=new Set([...Object.keys(targets),...(isAnnual?Object.keys(ytdActuals):Object.keys(actuals))]);
  const catMap=new Map();
  allCats.forEach(cat=>{
    if(SKIP.has(cat))return;
    const dCat=normalizeCat(cat);
    let budget,actual;
    if(isAnnual){
      // Budget: sum Jan through selected month (not full year)
      budget=(()=>{let s=0;for(let m=1;m<=mo;m++)s+=(targets[cat]?.[String(m)]?.amount||0);return s;})();
      actual=ytdActuals[cat]||0;
    }else{
      budget=targets[cat]?.[mStr]?.amount||0;
      actual=actuals[cat]?.[mStr]||0;
    }
    if(budget===0&&actual===0)return;
    if(catMap.has(dCat)){const e=catMap.get(dCat);catMap.set(dCat,{cat:dCat,budget:e.budget+budget,actual:e.actual+actual});}
    else catMap.set(dCat,{cat:dCat,budget,actual});
  });
  const rows=[...catMap.values()];

  const totalBudget=rows.reduce((s,r)=>s+r.budget,0);
  const totalActual=rows.reduce((s,r)=>s+r.actual,0);

  const handleSort=col=>{
    if(sortBy===col)setSortDir(d=>d==='desc'?'asc':'desc');
    else{setSortBy(col);setSortDir('desc');}
  };

  const sortedRows=[...rows].sort((a,b)=>{
    const aBot=a.cat==='Other';
    const bBot=b.cat==='Other';
    if(aBot&&!bBot)return 1;if(!aBot&&bBot)return -1;
    // Unbudgeted rows have no % to rank on. They used to sort as Infinity,
    // which pinned them above genuinely over-budget categories and made the
    // order look arbitrary — a $270 no-budget row outranking Travel at 458%.
    // They now sink below every budgeted row, ordered among themselves by
    // amount, so "worst overrun first" actually holds at the top of the table.
    if(sortBy==='pct'){
      const aNo=!(a.budget>0),bNo=!(b.budget>0);
      if(aNo!==bNo)return aNo?1:-1;
      if(aNo&&bNo)return b.actual-a.actual;
    }
    let aV,bV;
    if(sortBy==='pct'){aV=a.actual/a.budget;bV=b.actual/b.budget;}
    else if(sortBy==='actual'){aV=a.actual;bV=b.actual;}
    else{aV=a.budget;bV=b.budget;}
    return sortDir==='desc'?bV-aV:aV-bV;
  });

  const SortBtn=({col,label,align='right'})=>(
    <button type="button" onClick={()=>handleSort(col)} style={{background:'none',border:'none',cursor:'pointer',padding:0,
      display:'flex',alignItems:'center',justifyContent:align==='left'?'flex-start':'flex-end',gap:3,
      fontSize:10,fontWeight:500,textTransform:'uppercase',letterSpacing:'1.5px',
      color:sortBy===col?'var(--text-primary)':'var(--text-muted)'}}>
      {label}<span style={{fontSize:9,opacity:sortBy===col?1:0.35}}>{sortBy===col?(sortDir==='desc'?'↓':'↑'):'↕'}</span>
    </button>
  );

  const COLS='150px 1fr 100px 80px';

  const RowEl=({cat,budget,actual,isTotal=false})=>{
    const isCredit=actual<0;
    const hasBudget=budget>0;
    const hasActual=actual>0;
    const pct=hasBudget?actual/budget:0;
    const over=hasBudget&&pct>=1;
    const near=hasBudget&&!over&&pct>=0.8;
    const noBudget=!hasBudget&&hasActual;
    // Every track runs 0–100% of that row's own budget, so a given position
    // means the same thing on every row and the 25/50/75 markers are readable
    // at a glance. Over-budget rows fill the track and carry their true figure
    // in the label (458% fills the same as 101% — the number disambiguates).
    const barPct=hasBudget?Math.min(pct*100,100):0;
    // Over/near fills are weighted *heavier* than under-budget ones. At a 100%
    // scale every over-budget row fills the whole track, so if the alarm colors
    // were the faintest the rows needing attention would read as the calmest
    // ones on screen — the opposite of the point.
    const fillBg=over?'var(--red)':near?'var(--amber)':'var(--blue-primary)';
    const fillOpacity=over?0.42:near?0.38:0.30;
    // The label is right-aligned to the *track*, so on anything under 100% it
    // sits on empty track rather than on the fill — and --blue-soft/--amber on
    // a near-white track fails contrast in light theme. Only over-budget rows
    // (fill reaches the label) keep a status color; the rest use body text and
    // let the bar carry the status.
    const pctColor=over?'var(--red)':'var(--text-secondary)';
    // Credit rows get no % either: "-17% of budget" for a net refund is noise,
    // and the green +$732.61 in the Actual column already says what happened.
    const pctLabel=(hasBudget&&!isCredit)?`${Math.round(pct*100)}%`:null;
    const isActive=!isTotal&&activeCat===cat;
    const clickable=!isTotal&&onCatClick;
    return(
      <div onClick={clickable?()=>onCatClick(cat):undefined}
        style={{display:'grid',gridTemplateColumns:COLS,alignItems:'center',padding:'10px 24px',gap:14,
        borderBottom:isTotal?'2px solid var(--border)':'1px solid var(--border)',
        background:isActive?'rgba(var(--blue-primary-rgb), 0.1)':isTotal?'var(--elevated)':'transparent',
        cursor:clickable?'pointer':'default',transition:'all 0.2s ease'}}
        className={clickable?'row-hover':''}>
        <span style={{fontSize:14,fontWeight:isTotal?600:500,color:'var(--text-primary)',
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {isTotal?'Total':cat}
        </span>
        <div style={{position:'relative',height:24,borderRadius:6,overflow:'hidden',
          background:'var(--border)',border:'1px solid var(--border)'}}>
          {barPct>0&&<div style={{position:'absolute',left:0,top:0,bottom:0,width:`${barPct}%`,
            background:fillBg,opacity:fillOpacity,transition:'width 0.4s ease'}}/>}
          {/* Quarter markers, drawn over the fill so they stay legible on a
              filled track. Credit rows get an empty track — no bar, no label —
              since "% of budget spent" is meaningless for a net refund. */}
          {!isCredit&&[25,50,75].map(m=>(
            <div key={m} style={{position:'absolute',left:`${m}%`,top:0,bottom:0,width:1,
              background:'var(--border-strong)'}}/>
          ))}
          <div style={{position:'relative',height:'100%',display:'flex',alignItems:'center',
            justifyContent:'flex-end',padding:'0 8px'}}>
            {pctLabel&&<span style={{fontSize:10.5,fontWeight:700,color:pctColor,
              fontVariantNumeric:'tabular-nums'}}>{pctLabel}</span>}
            {noBudget&&<span style={{fontSize:9.5,fontWeight:500,color:'var(--text-muted)'}}>no budget set</span>}
          </div>
        </div>
        {/* Just the number — the % moved into the bar, so this column stays a
            clean, sortable column of dollar amounts. */}
        <span style={{textAlign:'right',fontSize:14,fontWeight:isTotal?700:600,fontVariantNumeric:'tabular-nums',
          color:isCredit?'var(--green)':over?'var(--red)':'var(--text-primary)'}}>
          {isCredit?`+${fmt(Math.abs(actual))}`:fmt(actual)}
        </span>
        <span style={{textAlign:'right',fontSize:13,fontWeight:isTotal?600:400,
          color:'var(--text-secondary)'}}>
          {hasBudget?fmt(budget):'—'}
        </span>
      </div>
    );
  };

  return(
    <div className="card" style={{padding:0, overflow:'hidden'}}>
      <div style={{padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid var(--border)'}}>
        <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px'}}>Budget Performance</div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{display:'flex',gap:16}}>
            {[['month','Monthly'],['annual','YTD']].map(([v,label])=>(
              <button type="button" key={v} onClick={()=>onSetView(v)}
                style={{padding:'4px 0',border:'none',borderBottom:view===v?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:12,fontWeight:view===v?600:400,letterSpacing:'0.2px',
                  background:'transparent',color:view===v?'var(--blue-primary)':'var(--text-muted)',
                  transition:'all 0.2s ease'}}>
                {label}
              </button>
            ))}
          </div>
          <select className="filter-select" value={yr} onChange={e=>onSetYear(+e.target.value)}>
            {Array.from({length:3},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <select className="filter-select" value={mo} onChange={e=>onSetMonth(+e.target.value)}>
            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>(
              <option key={i+1} value={i+1}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:COLS,alignItems:'center',padding:'10px 24px',gap:14,borderBottom:'1px solid var(--border)',background:'var(--elevated)'}}>
        <span style={{fontSize:10,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px'}}>Category</span>
        <SortBtn col="pct" label="Progress" align="left"/>
        <SortBtn col="actual" label="Actual"/>
        <SortBtn col="budget" label="Budget"/>
      </div>
      <RowEl cat="Total" budget={totalBudget} actual={totalActual} isTotal={true}/>
      {sortedRows.length===0
        ?<div style={{color:'var(--text-muted)',fontSize:13,textAlign:'center',padding:'40px 0'}}>No activity found for this period.</div>
        :sortedRows.map(({cat,budget,actual})=><RowEl key={cat} cat={cat} budget={budget} actual={actual}/>)}
      {sortedRows.length>0&&<div style={{display:'flex',gap:16,flexWrap:'wrap',padding:'12px 24px 16px',fontSize:10.5,color:'var(--text-muted)'}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:5}}><i style={{width:7,height:7,borderRadius:'50%',background:'var(--blue-primary)',display:'inline-block'}}/>Under budget</span>
        <span style={{display:'inline-flex',alignItems:'center',gap:5}}><i style={{width:7,height:7,borderRadius:'50%',background:'var(--amber)',display:'inline-block'}}/>Near limit</span>
        <span style={{display:'inline-flex',alignItems:'center',gap:5}}><i style={{width:7,height:7,borderRadius:'50%',background:'var(--red)',display:'inline-block'}}/>Over budget</span>
        <span style={{display:'inline-flex',alignItems:'center',gap:5}}><i style={{width:7,height:7,borderRadius:'50%',background:'var(--text-muted)',display:'inline-block'}}/>No budget set</span>
        <span style={{display:'inline-flex',alignItems:'center',gap:5}}><i style={{width:1,height:9,background:'var(--border-strong)',display:'inline-block'}}/>25 / 50 / 75% of budget</span>
      </div>}
    </div>
  );
}
