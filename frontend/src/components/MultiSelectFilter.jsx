import {useState,useEffect,useMemo,useRef} from 'react';

export function MultiSelectFilter({options,selected,onChange,label,renderOption,onApply}){
  const[open,setOpen]=useState(false);
  const[query,setQuery]=useState('');
  const ref=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const handler=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener('mousedown',handler);
    return()=>document.removeEventListener('mousedown',handler);
  },[open]);
  /* Reset the search box each time the panel closes, so it starts fresh next open */
  useEffect(()=>{if(!open)setQuery('');},[open]);
  const isAll=selected===null;
  const allVals=useMemo(()=>new Set(options.map(o=>o.value)),[options]);
  const isChecked=v=>isAll||selected.has(v);
  const checkedCount=isAll?options.length:(selected?selected.size:0);
  const isFiltered=!isAll;
  const toggle=v=>{
    if(isAll){/* uncheck one from "all" → Set with everything except v */
      const n=new Set(allVals);n.delete(v);onChange(n);
    }else if(selected.has(v)){
      const n=new Set(selected);n.delete(v);onChange(n);
    }else{
      const n=new Set(selected);n.add(v);
      /* if all are now checked, go back to null */
      if(n.size>=allVals.size)onChange(null);else onChange(n);
    }
  };
  /* Contains-match search over option labels (account labels already include the last-4 digits) */
  const filteredOptions=useMemo(()=>{
    const q=query.trim().toLowerCase();
    if(!q)return options;
    return options.filter(o=>String(o.label).toLowerCase().includes(q));
  },[options,query]);
  /* Search-to-select: typing (or clearing) the search box replaces the whole selection with
     exactly what's currently filtered, live on every keystroke — so "search, then Apply" is
     enough to end up with just the matches selected, no separate Clear All/checkbox step needed.
     Skipped on mount and while closed, so opening the panel never clobbers the existing selection
     (the query-reset-on-close effect above also changes `query`, which would otherwise re-fire this). */
  const didMountRef=useRef(false);
  useEffect(()=>{
    if(!didMountRef.current){didMountRef.current=true;return;}
    if(!open)return;
    onChange(filteredOptions.length>=allVals.size?null:new Set(filteredOptions.map(o=>o.value)));
  },[query]);
  /* Select All/Clear All toggle scopes to whatever's currently filtered, not the full option set */
  const visibleAllChecked=filteredOptions.length>0&&filteredOptions.every(o=>isChecked(o.value));
  const toggleVisible=()=>{
    const next=isAll?new Set(allVals):new Set(selected);
    if(visibleAllChecked)filteredOptions.forEach(o=>next.delete(o.value));
    else filteredOptions.forEach(o=>next.add(o.value));
    if(next.size>=allVals.size)onChange(null);else onChange(next);
  };
  const displayText=isAll?label:checkedCount===0?`${label} (none)`:`${label} (${checkedCount}/${options.length})`;
  return(
    <div ref={ref} style={{position:'relative',display:'inline-block'}}>
      <button type="button" onClick={()=>setOpen(o=>!o)} className="filter-select"
        style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',textAlign:'left',
          border:isFiltered?'1px solid var(--blue-primary)':'1px solid var(--border)',
          background:isFiltered?'rgba(var(--blue-primary-rgb),0.06)':'var(--surface)',
          color:isFiltered?'var(--blue-primary)':'var(--text-primary)',
          minWidth:0,whiteSpace:'nowrap',paddingRight:24,position:'relative'}}>
        <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{displayText}</span>
        <span style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',fontSize:10,opacity:.5}}>{open?'▲':'▼'}</span>
      </button>
      {open&&<div style={{position:'absolute',top:'calc(100% + 4px)',left:0,minWidth:240,maxHeight:380,
        display:'flex',flexDirection:'column',
        background:'var(--surface-solid)',border:'1px solid var(--border-strong)',borderRadius:10,boxShadow:'var(--shadow-lg)',
        zIndex:50,fontSize:13,fontFamily:'inherit',overflow:'hidden'}}>
        <div style={{padding:'8px 10px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
          <input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search…"
            onClick={e=>e.stopPropagation()}
            style={{width:'100%',boxSizing:'border-box',background:'var(--elevated)',border:'1px solid var(--border)',
              borderRadius:8,padding:'6px 10px',fontSize:12.5,color:'var(--text-primary)',fontFamily:'inherit'}}/>
        </div>
        <div style={{overflowY:'auto',padding:'6px 0'}}>
          {filteredOptions.length===0
            ?<div style={{padding:'16px 12px',textAlign:'center',color:'var(--text-muted)',fontSize:12.5}}>No matches</div>
            :filteredOptions.map(o=>{const chk=isChecked(o.value);return(
            <div key={o.value} onClick={()=>toggle(o.value)}
              style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',cursor:'pointer',
                background:chk?'rgba(var(--blue-primary-rgb),0.08)':'transparent',
                color:chk?'var(--text-primary)':'var(--text-muted)'}}
              onMouseEnter={e=>e.currentTarget.style.background=chk?'rgba(var(--blue-primary-rgb),0.12)':'var(--elevated)'}
              onMouseLeave={e=>e.currentTarget.style.background=chk?'rgba(var(--blue-primary-rgb),0.08)':'transparent'}>
              <span style={{width:16,height:16,borderRadius:4,border:`1.5px solid ${chk?'var(--blue-primary)':'var(--border)'}`,
                display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:11,
                background:chk?'var(--blue-primary)':'transparent',color:chk?'#fff':'transparent'}}>✓</span>
              <span style={{fontSize:13,fontWeight:chk?400:300}}>{renderOption?renderOption(o):o.label}</span>
            </div>
          );})}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderTop:'1px solid var(--border)',flexShrink:0}}>
          <button type="button" disabled={filteredOptions.length===0}
            style={{border:'none',background:'none',cursor:filteredOptions.length===0?'default':'pointer',fontSize:12,padding:0,fontFamily:'inherit',fontWeight:500,
              color:filteredOptions.length===0?'var(--text-muted)':'var(--blue-primary)'}}
            onClick={toggleVisible}>{visibleAllChecked?'Clear All':'Select All'}</button>
          <button type="button" className="btn btn-sm btn-primary" style={{padding:'4px 14px',fontSize:12}}
            onClick={()=>{onApply&&onApply();setOpen(false);}}>Apply</button>
        </div>
      </div>}
    </div>
  );
}

// Type-to-filter combobox: pick an existing option, or type a new value and
// click "+ Add" to create it on the fly. Ported from MARGIN's SearchCreateSelect.tsx
// (frontend/src/components/SearchCreateSelect.tsx) — same interaction, restyled
// inline to match this file's convention instead of MARGIN's separate CSS classes.
