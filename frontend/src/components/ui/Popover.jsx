import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import ReactDOM from 'react-dom';

/* A popover in document.body, placed under the element that opened it
   (left-aligned, or right-aligned with align="right") and kept on screen.
   Closes on a click outside it or the anchor, on Escape, and when the page
   scrolls under it. Popovers are menus and pickers, not windows: windows
   close only with their own buttons (see Window). */
export function Popover({anchor,onClose,align='left',children}){
  const ref=useRef(null);
  const[pos,setPos]=useState(null);
  useLayoutEffect(()=>{
    if(!anchor||!ref.current)return;
    const r=anchor.getBoundingClientRect(),w=ref.current.offsetWidth,h=ref.current.offsetHeight;
    let left=align==='right'?r.right-w:r.left;
    left=Math.max(8,Math.min(left,window.innerWidth-w-8));
    let top=r.bottom+6;
    if(top+h>window.innerHeight-8&&r.top-h-6>8)top=r.top-h-6;
    setPos({left,top});
  },[anchor,align]);
  useEffect(()=>{
    const down=e=>{if(ref.current&&!ref.current.contains(e.target)&&!(anchor&&anchor.contains(e.target)))onClose();};
    const key=e=>{if(e.key==='Escape'){e.stopPropagation();onClose();anchor&&anchor.focus&&anchor.focus();}};
    const scroll=e=>{if(ref.current&&ref.current.contains(e.target))return;onClose();};
    document.addEventListener('mousedown',down);
    document.addEventListener('keydown',key);
    window.addEventListener('scroll',scroll,true);
    window.addEventListener('resize',onClose);
    return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',onClose);};
  },[anchor,onClose]);
  useEffect(()=>{
    if(!pos||!ref.current)return;
    const f=ref.current.querySelector('[data-autofocus]');
    if(f)f.focus({preventScroll:true});
  },[pos]);
  return ReactDOM.createPortal(
    <div ref={ref} className="c-popl cloud" style={pos?{left:pos.left,top:pos.top}:{left:-9999,top:0,visibility:'hidden'}}>
      {children}
    </div>,document.body);
}
