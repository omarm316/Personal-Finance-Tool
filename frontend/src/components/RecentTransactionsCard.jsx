import {useState} from 'react';
import {fmt,normalizeCat,showCategoryForType} from '../lib/format';

export function RecentTransactionsCard({recent,onSeeMore,onRowClick}){
  const[hover,setHover]=useState(false);
  const MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  /* Credit-card payment transfers are noise here — the same filter the old
     full-width table used. Applied before the slice so we always land on five
     real rows rather than five-minus-however-many-got-filtered. */
  const rows=(recent||[])
    .filter(t=>!(t.action==='Transfer'&&(t.account_type||'').toLowerCase()==='credit card'))
    .slice(0,5);
  /* On touch there's no hover, so the button would never appear. Pin it visible
     when the device can't hover at all. */
  const coarse=typeof window!=='undefined'&&window.matchMedia&&window.matchMedia('(hover: none)').matches;
  const showBtn=hover||coarse;
  return(
    <div className="card" style={{margin:0,display:'flex',flexDirection:'column'}}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      onFocus={()=>setHover(true)} onBlur={()=>setHover(false)}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:16,minHeight:24}}>
        <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px'}}>Recent Transactions</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSeeMore}
          tabIndex={showBtn?0:-1} aria-hidden={!showBtn}
          style={{opacity:showBtn?1:0,pointerEvents:showBtn?'auto':'none',
            transition:'opacity 0.18s ease',whiteSpace:'nowrap'}}>
          See more →
        </button>
      </div>
      {rows.length===0
        ?<div className="empty" style={{flex:1}}><div className="empty-icon">◎</div><span>No transactions yet</span></div>
        :<div style={{display:'flex',flexDirection:'column'}}>
          {rows.map((t,i)=>{
            const dt=new Date((t.date||'').substring(0,10)+'T12:00:00');
            const shortDate=`${MO[dt.getMonth()]} ${dt.getDate()}`;
            const amtDisplay=t.amount<0?`-${fmt(Math.abs(t.amount))}`:`+${fmt(t.amount)}`;
            return(
              <div key={t.id} onClick={()=>onRowClick(t)} className="row-hover"
                style={{display:'grid',gridTemplateColumns:'52px 1fr auto',alignItems:'center',gap:12,
                  padding:'11px 4px',cursor:'pointer',
                  borderTop:i===0?'none':'1px solid var(--border)'}}>
                <span style={{color:'var(--text-muted)',fontSize:12.5,fontWeight:400,whiteSpace:'nowrap'}}>{shortDate}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13.5,fontWeight:500,color:'var(--text-primary)',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {t.description_display||t.description_raw}
                  </div>
                  {showCategoryForType(t.action)&&
                    <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2,
                      overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {normalizeCat(t.category_final)}
                    </div>}
                </div>
                <span style={{textAlign:'right',whiteSpace:'nowrap',fontSize:13.5,fontWeight:600,
                  fontVariantNumeric:'tabular-nums',
                  color:t.amount<0?'var(--red)':t.amount>0?'var(--green)':'var(--text-primary)'}}>{amtDisplay}</span>
              </div>
            );
          })}
        </div>}
    </div>
  );
}
