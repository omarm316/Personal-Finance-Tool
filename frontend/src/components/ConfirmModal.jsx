import {useState} from 'react';
import ReactDOM from 'react-dom';

export function ConfirmModal({title,body,confirmLabel='Confirm',danger=false,requiredInput=null,onConfirm,onClose}){
  const[inputVal,setInputVal]=useState('');
  const[busy,setBusy]=useState(false);
  const canConfirm=!requiredInput||inputVal===requiredInput;
  const handleConfirm=async()=>{
    if(!canConfirm||busy)return;
    setBusy(true);
    try{await onConfirm();}
    finally{setBusy(false);onClose();}
  };
  return ReactDOM.createPortal(
    <div className="review-overlay" style={{zIndex:11000}}>
      <div className="review-panel" style={{maxWidth:420}}>
        <div style={{fontSize:18,fontWeight:600,marginBottom:12,fontFamily:'Outfit',color:danger?'var(--red)':'var(--text-primary)'}}>{title}</div>
        {body&&<div style={{fontSize:14,color:'var(--text-secondary)',marginBottom:requiredInput?16:32,lineHeight:1.5}}>{body}</div>}
        {requiredInput&&<div style={{marginBottom:24}}>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:8,fontWeight:600}}>Type <strong style={{color:'var(--text-primary)'}}>{requiredInput}</strong> to confirm:</div>
          <input className="search-input" value={inputVal} onChange={e=>setInputVal(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter')handleConfirm();}}
            placeholder={requiredInput} autoFocus />
        </div>}
        <div style={{display:'flex',justifyContent:'flex-end',gap:12}}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn" disabled={!canConfirm||busy} onClick={handleConfirm}
            style={{background:danger?'var(--red)':'var(--blue-primary)',boxShadow:danger?'0 4px 15px rgba(239, 68, 68, 0.2)':'0 4px 15px rgba(var(--blue-primary-rgb), 0.2)', opacity: canConfirm?1:0.5}}>
            {busy?'…':confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
