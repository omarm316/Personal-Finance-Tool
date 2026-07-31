import {SkeletonRow} from './SkeletonRow';

export function SkeletonTable({rows=8}){return(
  <div className="card" style={{padding:24, display:'flex', flexDirection:'column', gap:12}}>
    <div className="skeleton" style={{height:44, borderRadius:12, marginBottom:12}}/>
    <SkeletonRow count={rows}/>
  </div>
);}
