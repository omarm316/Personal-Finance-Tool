import {useState} from 'react';
import {groupCats} from '../../lib/categories';
import {getCatColor} from '../../lib/format';

/* The grouped category list with a search box: each top level with its color
   dot, its sub-categories under it. One click picks. Typing narrows the list
   to matching groups and categories. */
export function CategoryList({categories,value,onPick}){
  const[q,setQ]=useState('');
  const ql=q.trim().toLowerCase();
  const groups=groupCats(categories).map(({top,children})=>{
    if(!ql)return{top,kids:children,showTop:true};
    const topHit=top.name.toLowerCase().includes(ql);
    const kids=topHit?children:children.filter(c=>c.name.toLowerCase().includes(ql));
    return{top,kids,showTop:topHit||kids.length>0};
  }).filter(g=>g.showTop);
  return(
    <div className="c-csr">
      <input className="c-inp" data-autofocus placeholder="Find a category…" aria-label="Find a category" value={q} onChange={e=>setQ(e.target.value)}/>
      <div className="c-csl" role="listbox" aria-label="Categories">
        {groups.map(({top,kids})=>(
          <div key={top.id} className="c-csg">
            <button type="button" role="option" aria-selected={value===top.name} className={`top ${value===top.name?'on':''}`} onClick={()=>onPick(top.name)}>
              <i style={{background:getCatColor(top.name)}}/>{top.name}
            </button>
            {kids.map(c=>(
              <button key={c.id} type="button" role="option" aria-selected={value===c.name} className={value===c.name?'on':''} onClick={()=>onPick(c.name)}>{c.name}</button>
            ))}
          </div>
        ))}
        {!groups.length&&<div className="c-empty-opt">Nothing matches “{q}”</div>}
      </div>
    </div>
  );
}
