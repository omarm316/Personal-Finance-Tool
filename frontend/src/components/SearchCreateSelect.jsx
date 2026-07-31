import {useState,useEffect,useRef} from 'react';

export function SearchCreateSelect({value,onChange,options,placeholder,emptyLabel,autoFocus}){
  const[query,setQuery]=useState(value||'');
  const[open,setOpen]=useState(false);
  const rootRef=useRef(null);
  useEffect(()=>{setQuery(value||'');},[value]);
  useEffect(()=>{
    if(!open)return;
    const handler=e=>{
      if(rootRef.current&&!rootRef.current.contains(e.target)){setOpen(false);setQuery(value||'');}
    };
    document.addEventListener('mousedown',handler);
    return()=>document.removeEventListener('mousedown',handler);
  },[open,value]);
  const filtered=query.trim()
    ?options.filter(o=>o.toLowerCase().includes(query.trim().toLowerCase()))
    :options;
  const select=o=>{onChange(o);setQuery(o);setOpen(false);};
  const optStyle={padding:'6px 10px',cursor:'pointer',fontSize:12.5};
  return(
    <div ref={rootRef} style={{position:'relative'}}>
      <input autoFocus={autoFocus} value={query} placeholder={placeholder||'Search or add…'}
        onChange={e=>{setQuery(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)}
        style={{fontSize:12.5,padding:'5px 8px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',width:'100%',boxSizing:'border-box'}}/>
      {open&&<div style={{position:'absolute',top:'calc(100% + 4px)',left:0,minWidth:160,maxHeight:200,overflowY:'auto',
        background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,0.2)',zIndex:80,padding:'4px 0'}}>
        {!query.trim()&&emptyLabel&&
          <div style={{...optStyle,color:'var(--text-muted)'}} onClick={()=>{onChange('');setQuery('');setOpen(false);}}>{emptyLabel}</div>}
        {filtered.length>0
          ?filtered.map(o=>(
            <div key={o} style={optStyle} onClick={()=>select(o)}
              onMouseEnter={e=>e.currentTarget.style.background='var(--elevated)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{o}</div>
          ))
          :query.trim()
            ?<div style={{...optStyle,color:'var(--blue-primary)',fontWeight:600}} onClick={()=>select(query.trim())}>+ Add "{query.trim()}"</div>
            :<div style={{...optStyle,color:'var(--text-muted)',fontStyle:'italic',cursor:'default'}}>No matches</div>}
      </div>}
    </div>
  );
}
