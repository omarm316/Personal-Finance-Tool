import React,{useState,useEffect,useCallback,useRef} from 'react';
import {apiFetch,parseHash} from '../lib/api';

export function usePullToRefresh(contentRef,onRefresh){
  const[ptrState,setPtrState]=useState('idle'); // idle|pulling|releasing|done
  const[pullY,setPullY]=useState(0);
  const startY=useRef(0);const active=useRef(false);
  const THRESHOLD=70;
  useEffect(()=>{
    const el=contentRef.current;if(!el)return;
    const isMobile=()=>window.innerWidth<=768;
    const onStart=e=>{if(!isMobile()||el.scrollTop>5)return;startY.current=e.touches[0].clientY;active.current=true;};
    const onMove=e=>{
      if(!active.current)return;
      const dy=e.touches[0].clientY-startY.current;
      if(dy<0||el.scrollTop>5){active.current=false;setPullY(0);setPtrState('idle');return;}
      /* Dampen the pull distance */
      const dampened=Math.min(dy*0.45,120);
      setPullY(dampened);setPtrState(dampened>=THRESHOLD?'releasing':'pulling');
      if(dy>10)e.preventDefault();
    };
    const onEnd=()=>{
      if(!active.current)return;active.current=false;
      if(ptrState==='releasing'){setPtrState('done');onRefresh();setTimeout(()=>{setPtrState('idle');setPullY(0);},600);}
      else{setPtrState('idle');setPullY(0);}
    };
    el.addEventListener('touchstart',onStart,{passive:true});
    el.addEventListener('touchmove',onMove,{passive:false});
    el.addEventListener('touchend',onEnd,{passive:true});
    return()=>{el.removeEventListener('touchstart',onStart);el.removeEventListener('touchmove',onMove);el.removeEventListener('touchend',onEnd);};
  },[contentRef,onRefresh,ptrState]);
  return{ptrState,pullY};
}

/* ── Pull-to-refresh indicator component ───────────────────────────── */

export function useToast(){
  const[toasts,setToasts]=useState([]);
  const add=(msg,type='success')=>{
    const id=Date.now();
    setToasts(t=>[...t,{id,msg,type}]);
    // Error toasts stay 8 seconds so diagnostic text can be read
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),type==='error'?8000:3500);
  };
  return{toasts,toast:add};
}

export function useIsMobile(){
  const[m,setM]=useState(()=>typeof window!=='undefined'&&window.innerWidth<768);
  useEffect(()=>{
    const fn=()=>setM(window.innerWidth<768);
    window.addEventListener('resize',fn,{passive:true});
    return()=>window.removeEventListener('resize',fn);
  },[]);
  return m;
}

export function useVirtualScroll(containerRef,itemCount,itemHeight,overscan=8){
  const[range,setRange]=useState({start:0,end:40});
  useEffect(()=>{
    const el=containerRef.current;if(!el)return;
    const onScroll=()=>{
      const scrollTop=el.scrollTop;const viewH=el.clientHeight;
      const start=Math.max(0,Math.floor(scrollTop/itemHeight)-overscan);
      const end=Math.min(itemCount,Math.ceil((scrollTop+viewH)/itemHeight)+overscan);
      setRange(r=>(r.start===start&&r.end===end)?r:{start,end});
    };
    onScroll();
    el.addEventListener('scroll',onScroll,{passive:true});
    return()=>el.removeEventListener('scroll',onScroll);
  },[containerRef,itemCount,itemHeight,overscan]);
  return{start:range.start,end:range.end,totalHeight:itemCount*itemHeight,offsetY:range.start*itemHeight};
}

/* ── Mobile transaction list: replaces full table on narrow screens ─────── */

export function usePlaidLink(toast,onSuccess){
  const[linkSummary,setLinkSummary]=useState(null); // {accounts:[{name,mask,status}], transactions_synced}

  /* Shared handler called after successful exchange-token */
  const handleLinkSuccess=async(public_token,afterOAuth)=>{
    try{
      const r=await apiFetch('/plaid/exchange-token',{method:'POST',body:JSON.stringify({public_token})});
      setLinkSummary({accounts:r.accounts||[],transactions_synced:r.transactions_synced||0});
      if(afterOAuth)window.history.replaceState({},'','/');
    }catch(e){toast('Failed to link: '+(e.message||e),'error');}
  };

  /* Handle OAuth return — bank redirects back to /plaid/oauth-return */
  React.useEffect(()=>{
    if(!window.location.pathname.startsWith('/plaid/oauth-return'))return;
    (async()=>{
      try{
        const{link_token}=await apiFetch('/plaid/link-token');
        const handler=window.Plaid.create({
          token:link_token,
          receivedRedirectUri:window.location.href,
          onSuccess:async(public_token)=>handleLinkSuccess(public_token,true),
          onExit:()=>{window.history.replaceState({},'','/');},
        });
        handler.open();
      }catch(e){toast('OAuth return failed: '+(e.message||e),'error');}
    })();
  },[]);

  const openPlaid=async()=>{
    try{
      const{link_token}=await apiFetch('/plaid/link-token');
      const handler=window.Plaid.create({
        token:link_token,
        onSuccess:async(public_token)=>handleLinkSuccess(public_token,false),
        onExit:()=>{},
      });
      handler.open();
    }catch(e){toast('Failed to start connection: '+(e.message||e),'error');}
  };

  /* Post-link summary modal */
  const summaryModal=linkSummary&&(()=>{
    const matchedCount=linkSummary.accounts.filter(a=>a.status==='matched').length;
    const createdCount=linkSummary.accounts.length-matchedCount;
    const hasNew=createdCount>0;
    return(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'var(--elevated)',backdropFilter:'var(--glass-blur)',WebkitBackdropFilter:'var(--glass-blur)',border:'1px solid var(--border-strong)',borderRadius:12,padding:'28px 32px',minWidth:360,maxWidth:500,boxShadow:'0 8px 40px rgba(0,0,0,0.22)'}}>
          {/* Header */}
          <div style={{fontWeight:400,fontSize:16,marginBottom:3,color:'var(--text)'}}>Bank Connected</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:20}}>
            {matchedCount>0&&<span>{matchedCount} account{matchedCount!==1?'s':''} matched to existing history</span>}
            {matchedCount>0&&hasNew&&<span style={{margin:'0 6px'}}>·</span>}
            {hasNew&&<span>{createdCount} new account{createdCount!==1?'s':''} created</span>}
          </div>
          {/* Account list */}
          {linkSummary.accounts.map((a,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
              <span style={{fontWeight:500,fontSize:13,color:'var(--text)'}}>{a.name}{a.mask?` ••${a.mask}`:''}</span>
              {a.status==='matched'
                ?<span style={{background:'rgba(52,211,153,0.12)',color:'var(--green)',borderRadius:6,padding:'2px 10px',fontSize:11,fontWeight:500,flexShrink:0,marginLeft:12}}>✓ History preserved</span>
                :<span style={{background:'rgba(96,165,250,0.12)',color:'var(--blue)',borderRadius:6,padding:'2px 10px',fontSize:11,fontWeight:500,flexShrink:0,marginLeft:12}}>+ New</span>
              }
            </div>
          ))}
          {/* Transaction count */}
          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:14}}>
            {linkSummary.transactions_synced} transaction{linkSummary.transactions_synced!==1?'s':''} synced
          </div>
          {/* Duplicate scan prompt when new accounts were created */}
          {hasNew&&<div style={{marginTop:12,padding:'10px 14px',background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.3)',borderRadius:8,fontSize:12,color:'var(--amber)',lineHeight:1.5}}>
            {createdCount} new account{createdCount!==1?'s were':' was'} created. If you're re-linking an existing bank, use <strong>Settings → Bank Links → Scan for Duplicates</strong> to detect and merge any duplicate accounts.
          </div>}
          {/* Done */}
          <button type="button" onClick={()=>{setLinkSummary(null);onSuccess(hasNew);}}
            style={{marginTop:20,width:'100%',background:'var(--primary)',color:'#fff',border:'none',borderRadius:8,padding:'10px 0',fontWeight:500,fontSize:14,cursor:'pointer'}}>
            Done
          </button>
        </div>
      </div>
    );
  })();

  return[openPlaid,summaryModal];
}

export function useHashRouter(){
  const[route,setRoute]=useState(parseHash);
  useEffect(()=>{
    const h=()=>setRoute(parseHash());
    window.addEventListener('hashchange',h);
    return()=>window.removeEventListener('hashchange',h);
  },[]);
  const navigate=useCallback((page,params={})=>{
    const filtered=Object.fromEntries(
      Object.entries(params).filter(([,v])=>v!=null&&String(v)!=='')
    );
    const qs=new URLSearchParams(filtered).toString();
    window.location.hash=qs?`${page}?${qs}`:page;
  },[]);
  return{page:route.page,params:route.params,navigate};
}
