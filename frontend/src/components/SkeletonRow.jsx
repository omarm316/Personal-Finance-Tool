export function SkeletonRow({count=5}){return <>{Array.from({length:count},(_,i)=><div key={i} className="skeleton skeleton-row"/>)}</>;}
