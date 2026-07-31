import {useState,useEffect} from 'react';
import {useIsMobile} from '../hooks/index';

export function CollapsibleSection({title,children,defaultOpen=true,count}){
  const isMobile=useIsMobile();
  const[open,setOpen]=useState(defaultOpen||!isMobile);
  useEffect(()=>{if(!isMobile)setOpen(true);},[isMobile]);
  const label=count!=null?`${title} (${count})`:title;
  return(
    <div style={{marginBottom:16}}>
      <button type="button" onClick={()=>isMobile&&setOpen(!open)} style={{
        display:'flex',alignItems:'center',gap:8,width:'100%',border:'none',background:'none',
        cursor:isMobile?'pointer':'default',padding:'10px 0',fontFamily:'inherit'}}>
        <span style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px'}}>{label}</span>
        {isMobile&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"
          style={{transition:'transform 0.2s',transform:open?'rotate(180deg)':'rotate(0deg)'}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>}
        <div style={{flex:1,height:1,background:'var(--border)'}}/>
      </button>
      <div style={{overflow:'hidden',maxHeight:open?'none':'0',transition:open?'none':'max-height 0.3s ease',opacity:open?1:0}}>
        {children}
      </div>
    </div>
  );
}
