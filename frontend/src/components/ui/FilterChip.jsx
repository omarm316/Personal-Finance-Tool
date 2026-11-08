import {useRef,useState} from 'react';
import {CIcon} from './CIcon';
import {Popover} from './Popover';

/* A soft grey chip that opens a checklist: a search box, a count beside each
   option, Clear all / Select all, and Apply. `selected` is null for "no
   filter" (every box ticked) or a Set of values. Ticks are a draft until
   Apply; closing the list without Apply drops them.
   options: [{value, label, count, kid}] (kid indents a sub-option). */
export function FilterChip({label,active,options,selected,onApply}){
  const btn=useRef(null);
  const[open,setOpen]=useState(false);
  const[draft,setDraft]=useState(null);
  const[q,setQ]=useState('');
  const show=()=>{setDraft(selected?new Set(selected):null);setQ('');setOpen(true);};
  const close=()=>setOpen(false);
  const all=options.map(o=>o.value);
  const isOn=v=>draft===null||draft.has(v);
  const toggle=v=>setDraft(d=>{const n=new Set(d===null?all:d);n.has(v)?n.delete(v):n.add(v);return n;});
  const noneTicked=draft!==null&&draft.size===0;
  const apply=()=>{
    const d=draft===null||all.every(v=>draft.has(v))?null:draft;
    onApply(d);close();
  };
  const ql=q.trim().toLowerCase();
  const shown=ql?options.filter(o=>o.label.toLowerCase().includes(ql)):options;
  return(<>
    <button type="button" ref={btn} className={`c-fb ${active?'on':''}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={()=>open?close():show()}>
      {label}<CIcon name="down" size={12}/>
    </button>
    {open&&<Popover anchor={btn.current} onClose={close}>
      <div className="c-pop c-chk" role="dialog" aria-label={label}>
        <input className="c-psrch" data-autofocus placeholder="Search…" aria-label="Search options" value={q} onChange={e=>setQ(e.target.value)}/>
        <div className="c-pl">
          {shown.map(o=>(
            <label key={o.value} className={`c-po ${o.kid&&!ql?'kid':''}`}>
              <input type="checkbox" checked={isOn(o.value)} onChange={()=>toggle(o.value)}/>
              <span title={o.label}>{o.label}</span><em>{o.count||''}</em>
            </label>
          ))}
          {!shown.length&&<div className="c-empty-opt">Nothing matches “{q}”</div>}
        </div>
        <div className="c-pf">
          <button type="button" className="c-lnk" onClick={()=>setDraft(noneTicked?null:new Set())}>{noneTicked?'Select all':'Clear all'}</button>
          <button type="button" className="c-btn pri sm" onClick={apply}>Apply</button>
        </div>
      </div>
    </Popover>}
  </>);
}

/* "All types" / "Type: Expense" / "Type (2/8)" */
export function chipLabel(selected,name,allLabel,total,labelOf=v=>v){
  if(!selected)return allLabel;
  if(selected.size===1)return `${name}: ${labelOf([...selected][0])}`;
  return `${name} (${selected.size}/${total})`;
}
