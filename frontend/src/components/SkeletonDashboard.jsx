import {SkeletonCard} from './SkeletonCard';

export function SkeletonDashboard(){return(
  <div style={{display:'flex',flexDirection:'column',gap:24}}>
    <div className="metric-grid">
      {[1,2,3,4,5].map(i=><SkeletonCard key={i} height={100}/>)}
    </div>
    <SkeletonCard height={300}/>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
      <SkeletonCard height={300}/>
      <SkeletonCard height={300}/>
    </div>
  </div>
);}
