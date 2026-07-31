export function ChallengeCard({ch,onClick}){
  const progress=ch.progress_pct||0;
  // Repeatable challenges stay "isThreshold" (still show the lap progress bar)
  // even once the first occurrence is unlocked, as long as more can still be earned.
  const isThreshold=ch.spend_threshold&&(!ch.bonus_unlocked||(ch.max_occurrences&&(ch.occurrences_earned||0)<ch.max_occurrences));
  // A per_dollar challenge with a spend_cap (e.g. "5x Groceries, up to $1,000")
  // gets the exact same spent/goal/to-go progress treatment as a threshold
  // challenge — the backend's _challenge_progress() already computes
  // progress_pct/progress_target/remaining_spend identically for both cases
  // (B17, 2026-07-25) — this was previously threshold-only, so capped
  // per_dollar challenges showed only a flat "+Nx" line with no progress bar.
  const hasCapProgress=!isThreshold&&ch.bonus_type==='per_dollar'&&ch.spend_cap;
  const showProgress=isThreshold||hasCapProgress;
  return(
    <div className="card" style={{padding:'16px 18px',cursor:onClick?'pointer':'default'}} onClick={onClick}
      title={onClick?"View this card's transactions for this challenge's date range":undefined}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ch.name}</div>
          {/* Category names deliberately left out here — shown once, in the
              "+Nx on [Categories]" line below, instead of duplicated in both
              places (B17). */}
          <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
            {ch.card_name&&<span>{ch.card_name}{ch.last_four?` ···${ch.last_four}`:''}</span>}
          </div>
        </div>
        <span style={{fontSize:10,padding:'2px 7px',borderRadius:10,marginLeft:8,flexShrink:0,
          background:ch.status==='unlocked'?'rgba(52,211,153,0.12)':ch.status==='active'?'rgba(var(--blue-primary-rgb), 0.12)':'var(--elevated)',
          color:ch.status==='unlocked'?'var(--green)':ch.status==='active'?'var(--blue-primary)':'var(--text-muted)',
          fontWeight:500,textTransform:'uppercase',letterSpacing:'0.5px'}}>
          {ch.status}
        </span>
      </div>
      {showProgress&&<>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text-muted)',marginBottom:4}}>
          <span>${(ch.lap_spend??ch.current_spend??0).toLocaleString(undefined,{maximumFractionDigits:0})} spent{ch.max_occurrences?` (${ch.occurrences_earned||0}/${ch.max_occurrences})`:''}</span>
          <span>${(ch.progress_target??ch.spend_threshold??ch.spend_cap).toLocaleString(undefined,{maximumFractionDigits:0})} goal</span>
        </div>
        <div style={{height:5,borderRadius:5,background:'var(--elevated)',overflow:'hidden',marginBottom:6}}>
          <div style={{height:'100%',borderRadius:5,width:`${progress}%`,background:'linear-gradient(90deg,var(--blue-primary),#93c5fd)',transition:'width 0.5s ease'}}/>
        </div>
        {ch.remaining_spend>0&&<div style={{fontSize:11,color:'var(--text-muted)'}}>${ch.remaining_spend.toLocaleString(undefined,{maximumFractionDigits:0})} to go</div>}
      </>}
      {/* "+Nx on [Categories]" — shown for every per_dollar challenge (capped
          or not) now that it's the only place categories appear; dollar
          figures deliberately dropped from this line when a progress bar is
          also showing (hasCapProgress) since it would just repeat the same
          spent/goal numbers already shown above. */}
      {ch.bonus_type==='per_dollar'&&<div style={{fontSize:12,color:'var(--text-secondary)',marginTop:4}}>
        <span style={{fontWeight:400,fontFamily:'Plus Jakarta Sans',fontSize:16,color:'var(--blue-primary)'}}>+{ch.bonus_amount}x</span>
        {ch.category_names?.length>0&&<span style={{color:'var(--text-muted)',marginLeft:6}}>on {ch.category_names.join(', ')}</span>}
        {ch.spend_cap&&!hasCapProgress&&<span style={{color:'var(--text-muted)',marginLeft:6}}>· ${(ch.current_spend||0).toLocaleString(undefined,{maximumFractionDigits:0})} / ${ch.spend_cap.toLocaleString(undefined,{maximumFractionDigits:0})}</span>}
      </div>}
    </div>
  );
}
