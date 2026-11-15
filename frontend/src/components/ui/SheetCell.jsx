import {useRef,useState} from 'react';

/* A cell that edits like a spreadsheet (house rule for dense grids). It shows
   `show` and, while it has focus, the plain number `raw`, selected. Cells are
   found by their `data-g` group inside the nearest [data-sheet] element, in
   the order they are on the page:
     Tab / Shift+Tab   next or previous cell (right, then the next row)
     Enter             save and stay
     Arrows            up and down the column; left and right at the text's edge
     Escape            put the cell back
   Leaving a cell saves it through onSave(k, m, n). Pasting a block copied from
   Excel spreads right and down from the cell and goes to onPaste([{k, m, n}]).
   Locked cells are not SheetCells, so Tab and pasting pass over them. */
export function SheetCell({k,m,g,row,col,show,raw,label,title,cap,className='',onSave,onPaste}){
  const[draft,setDraft]=useState(null);
  const ref=useRef(null);
  const parse=v=>{
    const t=String(v).trim().replace(/[$,\s]/g,'');
    const n=t===''?0:Number(t);
    return isFinite(n)&&n>=0?n:null;
  };
  const commit=v=>{
    if(v==null||String(v).trim()===raw)return;
    const n=parse(v);
    if(n===null){setDraft(raw);return;}
    if(Math.abs(n-(parseFloat(raw)||0))<.005)return;
    onSave(k,m,n);
  };
  const cells=()=>{
    const box=ref.current?.closest('[data-sheet]');
    return box?[...box.querySelectorAll('input.sc')].filter(x=>x.dataset.g===g):[];
  };
  const move=to=>{if(to){to.focus();}else ref.current?.select();};
  const onKeyDown=e=>{
    const L=cells(),i=L.indexOf(e.currentTarget),me=e.currentTarget;
    const inCol=d=>{for(let j=i+d;j>=0&&j<L.length;j+=d)if(L[j].dataset.col===me.dataset.col)return L[j];return null;};
    const inRow=d=>{const n=L[i+d];return n&&n.dataset.row===me.dataset.row?n:null;};
    if(e.key==='Tab'){e.preventDefault();return move(L[i+(e.shiftKey?-1:1)]||null);}
    if(e.key==='Enter'){e.preventDefault();commit(draft);requestAnimationFrame(()=>me.select());return;}
    if(e.key==='Escape'){e.preventDefault();setDraft(raw);requestAnimationFrame(()=>me.select());return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();return move(inCol(e.key==='ArrowDown'?1:-1));}
    const all=me.selectionStart===0&&me.selectionEnd===me.value.length;
    if(e.key==='ArrowRight'&&(all||me.selectionStart===me.value.length)){const n=inRow(1);if(n){e.preventDefault();move(n);}}
    if(e.key==='ArrowLeft'&&(all||me.selectionEnd===0)){const n=inRow(-1);if(n){e.preventDefault();move(n);}}
  };
  const paste=e=>{
    const txt=e.clipboardData?.getData('text')||'';
    if(!onPaste||!/[\t\n]/.test(txt.trim()))return;
    e.preventDefault();
    const rows=[];
    cells().forEach(c=>{if(!rows.length||rows[rows.length-1].k!==c.dataset.row)rows.push({k:c.dataset.row,c:[]});rows[rows.length-1].c.push(c);});
    const ri=rows.findIndex(r=>r.k===row),ci=ri<0?-1:rows[ri].c.indexOf(e.currentTarget);
    if(ci<0)return;
    const out=[];
    txt.replace(/\r/g,'').replace(/\n+$/,'').split('\n').forEach((line,a)=>{
      const r=rows[ri+a];if(!r)return;
      line.split('\t').forEach((v,b)=>{
        const c=r.c[ci+b],t=v.replace(/[$,\s()]/g,'');
        if(!c||t===''||t==='-'||t==='—')return;
        const x=Number(t);if(!isFinite(x))return;
        out.push({k:c.dataset.k,m:Number(c.dataset.m),n:Math.abs(x)});
      });
    });
    setDraft(null);
    onPaste(out);
  };
  const on=draft!==null;
  const input=(
    <input ref={ref} className={`sc ${className} ${on?'on':''}`} data-g={g} data-row={row} data-col={col} data-k={k} data-m={m}
      value={on?draft:show} onChange={e=>setDraft(e.target.value)}
      onFocus={e=>{const t=e.currentTarget;setDraft(raw);requestAnimationFrame(()=>{if(document.activeElement===t)t.select();});}}
      onBlur={()=>{commit(draft);setDraft(null);}}
      onKeyDown={onKeyDown} onPaste={paste}
      // A click selects the whole figure, as in Excel; the mouse would otherwise drop the caret where it landed.
      onMouseDown={e=>{if(document.activeElement!==e.currentTarget){e.preventDefault();e.currentTarget.focus();}}}
      inputMode="decimal" autoComplete="off" spellCheck={false} aria-label={label} title={title||label}/>
  );
  return cap?<>{input}{on&&<em className="sc-cap">{cap}</em>}</>:input;
}
