import {useState} from 'react';
import ReactDOM from 'react-dom';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {fmt,fmtDate,showCategoryForType,sortedCats} from '../lib/format';

export function MobileTxnModal({txn,categories,onSave,onClose,toast}){
  const[category,setCategory]=useState(txn.category_final||'');
  const[action,setAction]=useState(txn.action||'Expense');
  const[descClean,setDescClean]=useState(txn.description_clean||txn.description_display||'');
  const[gcb,setGcb]=useState(txn.is_gcb||false);
  const[saving,setSaving]=useState(false);
  const[ruleCreating,setRuleCreating]=useState(false);
  const handleTypeChange=(newType)=>{setAction(newType);if(!showCategoryForType(newType))setCategory('');};
  const handleSave=async()=>{
    setSaving(true);
    try{
      const updates={action,needs_review:false,category,is_gcb:gcb};
      if(descClean!==(txn.description_clean||txn.description_display||''))updates.description_clean=descClean;
      await onSave(txn.id,updates);
      onClose();
    }catch(e){toast&&toast('Save failed','error');}
    finally{setSaving(false);}
  };
  const createRule=async()=>{
    setRuleCreating(true);
    try{
      await apiFetch(`/llm/create-rule-from-transaction/${txn.id}`,{method:'POST'});
      toast&&toast('Rule created');
      await onSave(txn.id,{});
    }catch(e){toast&&toast('Failed to create rule','error');}
    finally{setRuleCreating(false);onClose();}
  };
  const inpStyle={width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'9px 12px',fontSize:14,color:'var(--text)',background:'var(--elevated)',boxSizing:'border-box',appearance:'none'};
  const lblStyle={fontSize:11.5,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:6};
  return ReactDOM.createPortal(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:2000,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div style={{background:'var(--elevated)',backdropFilter:'var(--glass-blur)',WebkitBackdropFilter:'var(--glass-blur)',border:'1px solid var(--border-strong)',borderRadius:'16px 16px 0 0',width:'100%',maxWidth:640,padding:'12px 16px 36px',maxHeight:'92vh',overflowY:'auto',boxShadow:'0 -4px 24px rgba(0,0,0,0.18)'}}>
        <div style={{width:40,height:4,borderRadius:2,background:'var(--border)',margin:'0 auto 16px'}}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:18}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:500,fontSize:15,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{txn.description_display||txn.description_raw}</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {fmtDate(txn.date)} · <span style={{color:txn.action==='Expense'?'var(--red)':txn.action==='Income'?'var(--green)':'var(--text-muted)',fontWeight:500}}>{txn.amount<0?'–':'+'}{fmt(txn.amount)}</span>
              {txn.account_name&&<span> · {txn.account_name}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{background:'none',border:'none',fontSize:22,color:'var(--text-muted)',cursor:'pointer',padding:'0 0 0 12px',lineHeight:1}}>✕</button>
        </div>
        <div style={{marginBottom:14}}>
          <label style={lblStyle}>Display Name</label>
          <input value={descClean} onChange={e=>setDescClean(e.target.value)} placeholder="Edit display name…" style={inpStyle}/>
          {txn.description_raw&&txn.description_raw!==descClean&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>Raw: {txn.description_raw}</div>}
        </div>
        <div style={{marginBottom:14}}>
          <label style={lblStyle}>Type</label>
          <select value={action} onChange={e=>handleTypeChange(e.target.value)} style={inpStyle}>
            {TXN_TYPES.map(a=><option key={a}>{a}</option>)}
          </select>
        </div>
        {showCategoryForType(action)&&<div style={{marginBottom:14}}>
          <label style={lblStyle}>Category</label>
          <select value={category} onChange={e=>setCategory(e.target.value)} style={inpStyle}>
            <option value="">Unclassified</option>
            {sortedCats(categories).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>}
        <div style={{marginBottom:14}}>
          <label style={lblStyle}>GCB Tag</label>
          <button type="button" onClick={()=>setGcb(g=>!g)}
            style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'9px 12px',
              border:`1px solid ${gcb?'rgba(251,191,36,0.5)':'var(--border)'}`,borderRadius:8,
              background:gcb?'rgba(251,191,36,0.08)':'var(--elevated)',cursor:'pointer',
              color:gcb?'var(--amber)':'var(--text-muted)',fontSize:14,fontFamily:'inherit'}}>
            <span>{gcb?'⭐':'☆'}</span>
            <span>{gcb?'GCB Tagged':'Not GCB'}</span>
          </button>
        </div>
        <div style={{display:'flex',gap:10,marginTop:20}}>
          <button type="button" onClick={createRule} disabled={ruleCreating}
            style={{flex:1,padding:'11px 0',border:'1px solid var(--border)',borderRadius:10,fontSize:13,fontWeight:500,color:'var(--text-secondary)',background:'var(--elevated)',cursor:'pointer'}}>
            {ruleCreating?'…':'📐 Rule'}
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{flex:2,padding:'11px 0',border:'none',borderRadius:10,fontSize:14,fontWeight:500,color:'#fff',background:'var(--primary)',cursor:'pointer'}}>
            {saving?'…':'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Swipeable row for mobile — reveals action buttons behind the card ── */
