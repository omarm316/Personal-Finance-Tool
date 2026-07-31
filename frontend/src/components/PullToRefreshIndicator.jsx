export function PullToRefreshIndicator({pullY,ptrState}){
  if(ptrState==='idle'&&pullY===0)return null;
  const ready=ptrState==='releasing'||ptrState==='done';
  const rotation=Math.min(pullY/70*180,180);
  return(
    <div className="ptr-indicator" style={{top:Math.max(pullY-20,12),opacity:pullY>10?1:0}}>
      <div className={`ptr-spinner ${ready?'releasing':''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          style={{transform:ready?undefined:`rotate(${rotation}deg)`}}>
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
      </div>
    </div>
  );
}

/* ── Skeleton loading placeholders ─────────────────────────────────── */
