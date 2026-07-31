import {useState,useRef} from 'react';
import {MobileTxnModal} from './MobileTxnModal';
import {SwipeRow} from './SwipeRow';
import {TxnRow} from './TxnRow';
import {useIsMobile,useVirtualScroll} from '../hooks/index';
import {fmt,fmtDate} from '../lib/format';

export function MobileTxnList({visible,categories,onSave,onReview,selectedIds,toggleSelect,selectAll,setSelectedIds,sortCol,sortDir,toggleSort,setShowBatchEdit,toast,onSplit}){
  const isMobile=useIsMobile();
  // Desktop: full table with virtual scroll for large lists
  const desktopScrollRef=useRef(null);
  const ROW_H=56;
  const virt=useVirtualScroll(desktopScrollRef,visible.length,ROW_H);
  if(!isMobile){
    const useVirt=visible.length>80;
    const rows=useVirt?visible.slice(virt.start,virt.end):visible;
    return(
      <div className="table-wrap" ref={desktopScrollRef} style={useVirt?{maxHeight:'75vh',overflowY:'auto'}:undefined}>
        <table>
          <thead><tr>
            <th style={{width:48,paddingLeft:24}}>
              <input type="checkbox" title="Select / deselect all visible"
                checked={visible.length>0&&visible.every(t=>selectedIds.has(t.id))}
                onChange={e=>e.target.checked?selectAll():setSelectedIds(new Set())}
                style={{cursor:'pointer'}}/>
            </th>
            {[['date','Date'],['description','Description'],['amount','Amount'],['type','Type'],['category','Category'],['account','Account']].map(([col,lbl])=>(
              <th key={col} onClick={()=>toggleSort(col)} style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}}>
                {lbl}<span style={{marginLeft:6,opacity:sortCol===col?1:0.3,fontSize:10}}>{sortCol===col?(sortDir==='asc'?'▲':'▼'):'⇅'}</span>
              </th>
            ))}
            <th style={{textAlign:'right', paddingRight:24}}>Actions</th>
          </tr></thead>
          <tbody>
            {useVirt&&<tr style={{height:virt.offsetY}}><td colSpan="8"/></tr>}
            {rows.map(t=><TxnRow key={t.id} txn={t} categories={categories} onSave={onSave} onReview={onReview} onSplit={onSplit} selected={selectedIds.has(t.id)} onToggleSelect={toggleSelect} onBatchEdit={()=>setShowBatchEdit(true)} toast={toast}/>)}
            {useVirt&&<tr style={{height:Math.max(0,virt.totalHeight-virt.end*ROW_H)}}><td colSpan="8"/></tr>}
          </tbody>
        </table>
      </div>
    );
  }
  // Mobile: card list with swipe-to-reveal actions
  const[editTxn,setEditTxn]=useState(null);
  const[swipedId,setSwipedId]=useState(null); // which txn has actions revealed
  return(
    <div>
      {editTxn&&<MobileTxnModal txn={editTxn} categories={categories} onSave={onSave} onClose={()=>setEditTxn(null)} toast={toast}/>}
      {visible.map(t=>{
        const isExpense=t.action==='Expense';
        const isIncome=t.action==='Income';
        const needsRev=t.needs_review&&!t.is_locked;
        const catLabel=t.action==='Transfer'?'Transfer':(t.category_final||'Unclassified');
        const isOpen=swipedId===t.id;
        return(
          <SwipeRow key={t.id} isOpen={isOpen} onOpen={()=>setSwipedId(t.id)} onClose={()=>setSwipedId(null)}
            rightActions={
              <div style={{display:'flex',height:'100%'}}>
                <button type="button" onClick={e=>{e.stopPropagation();setEditTxn(t);setSwipedId(null);}}
                  style={{width:72,border:'none',background:'var(--blue)',color:'#fff',fontSize:11,fontWeight:500,fontFamily:'inherit',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3}}>
                  <span style={{fontSize:16}}>✎</span>Edit
                </button>
                {needsRev&&<button type="button" onClick={e=>{e.stopPropagation();onReview(t);setSwipedId(null);}}
                  style={{width:72,border:'none',background:'var(--amber)',color:'#1a1a2e',fontSize:11,fontWeight:500,fontFamily:'inherit',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3}}>
                  <span style={{fontSize:16}}>✓</span>Review
                </button>}
              </div>
            }
            leftActions={
              <button type="button" onClick={e=>{e.stopPropagation();onSave(t.id,{is_excluded:!t.is_excluded});setSwipedId(null);toast(t.is_excluded?'Included':'Excluded');}}
                style={{width:72,border:'none',background:t.is_excluded?'var(--green)':'var(--red)',color:'#fff',fontSize:11,fontWeight:500,fontFamily:'inherit',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,height:'100%'}}>
                <span style={{fontSize:16}}>{t.is_excluded?'↩':'⊘'}</span>{t.is_excluded?'Include':'Exclude'}
              </button>
            }>
            <div onClick={()=>setEditTxn(t)}
              style={{padding:'11px 14px',
                background:needsRev?'rgba(251,191,36,0.06)':t.is_locked?'rgba(96,165,250,0.06)':'var(--elevated)',
                display:'flex',flexDirection:'column',gap:5,cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>
              {/* Top row: description + amount */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                <div style={{fontWeight:300,fontSize:13,color:'var(--text-primary)',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {t.description_clean||t.description_display||t.description_raw}
                </div>
                <span style={{fontFamily:'Plus Jakarta Sans',fontWeight:300,fontSize:13,flexShrink:0,
                  color:isExpense?'var(--red)':isIncome?'var(--green)':'var(--text-secondary)'}}>
                  {t.amount<0?'–':'+'}{fmt(t.amount)}
                </span>
              </div>
              {/* Bottom row: date · account · category badge */}
              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>{fmtDate(t.date)}</span>
                {t.account_name&&<span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300,overflow:'hidden',textOverflow:'ellipsis',maxWidth:90,whiteSpace:'nowrap'}}>{t.account_name}</span>}
                <span style={{fontSize:10,padding:'1px 7px',borderRadius:4,
                  background:t.action==='Transfer'?'var(--elevated)':(t.category_final?'rgba(var(--blue-primary-rgb), 0.12)':'var(--elevated)'),
                  color:t.action==='Transfer'?'var(--text-muted)':(t.category_final?'var(--blue-primary)':'var(--text-muted)'),fontWeight:400}}>
                  {catLabel}
                </span>
                {needsRev&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:4,background:'rgba(251,191,36,0.12)',color:'var(--amber)',fontWeight:400}}>Review</span>}
                {t.is_locked&&<span style={{fontSize:11}}>🔒</span>}
              </div>
            </div>
          </SwipeRow>
        );
      })}
    </div>
  );
}
