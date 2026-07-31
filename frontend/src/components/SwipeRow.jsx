import {useState,useEffect,useRef} from 'react';

export function SwipeRow({children,leftActions,rightActions,isOpen,onOpen,onClose}){
  const ref=useRef(null);
  const startX=useRef(0);const startY=useRef(0);const dx=useRef(0);const swiping=useRef(false);const dirLocked=useRef(null);
  const rightW=rightActions?144:0;const leftW=leftActions?72:0;
  const[offset,setOffset]=useState(0);
  useEffect(()=>{if(!isOpen)setOffset(0);},[isOpen]);
  const onStart=e=>{const touch=e.touches[0];startX.current=touch.clientX;startY.current=touch.clientY;dx.current=0;swiping.current=true;dirLocked.current=null;};
  const onMove=e=>{
    if(!swiping.current)return;
    const touch=e.touches[0];const deltaX=touch.clientX-startX.current;const deltaY=touch.clientY-startY.current;
    if(dirLocked.current===null){
      if(Math.abs(deltaX)>8||Math.abs(deltaY)>8){
        dirLocked.current=Math.abs(deltaX)>Math.abs(deltaY)?'h':'v';
      }
      return;
    }
    if(dirLocked.current==='v'){swiping.current=false;return;}
    e.preventDefault();
    dx.current=deltaX;
    const base=isOpen?(dx.current>0?0:-rightW):0;
    const raw=base+deltaX;
    const clamped=Math.max(-rightW,Math.min(leftW,raw));
    setOffset(clamped);
  };
  const onEnd=()=>{
    if(!swiping.current&&dirLocked.current!=='h')return;swiping.current=false;
    const threshold=40;
    if(offset<-threshold){setOffset(-rightW);onOpen();}
    else if(offset>threshold){setOffset(leftW);onOpen();}
    else{setOffset(0);onClose();}
  };
  return(
    <div style={{position:'relative',overflow:'hidden',borderBottom:'1px solid var(--border)'}}>
      {/* Left actions (revealed on swipe right) */}
      {leftActions&&<div style={{position:'absolute',left:0,top:0,bottom:0,width:leftW,display:'flex'}}>{leftActions}</div>}
      {/* Right actions (revealed on swipe left) */}
      {rightActions&&<div style={{position:'absolute',right:0,top:0,bottom:0,width:rightW,display:'flex',justifyContent:'flex-end'}}>{rightActions}</div>}
      {/* Foreground card */}
      <div ref={ref}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        style={{transform:`translateX(${offset}px)`,transition:swiping.current?'none':'transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)',
          position:'relative',zIndex:2,background:'var(--elevated)'}}>
        {children}
      </div>
    </div>
  );
}

/* ── Virtual scroll hook — renders only visible items + buffer ───────── */
