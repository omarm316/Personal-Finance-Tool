import {useState,useEffect} from 'react';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {fmt,showCategoryForType,sortedCats} from '../lib/format';

export function SplitEditorModal({txn,categories,onClose,onSaved,toast}){
  const[splits,setSplits]=useState([]);
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[error,setError]=useState('');

  useEffect(()=>{
    (async()=>{
      try{const s=await apiFetch(`/transactions/${txn.id}/splits`);
        setSplits(s.length?s:[{amount:txn.amount,description:'',category:txn.category_final||'',action:txn.action||'Expense',is_gcb:false,is_for_others:false,notes:''}]);
      }catch(e){setSplits([{amount:txn.amount,description:'',category:txn.category_final||'',action:txn.action||'Expense',is_gcb:false,is_for_others:false,notes:''}]);}
      finally{setLoading(false);}
    })();
  },[txn.id]);

  const addRow=()=>setSplits([...splits,{amount:0,description:'',category:'',action:txn.action||'Expense',is_gcb:false,is_for_others:false,notes:''}]);
  const removeRow=(i)=>{if(splits.length>1)setSplits(splits.filter((_,j)=>j!==i));};
  const updateRow=(i,field,val)=>{const s=[...splits];s[i]={...s[i],[field]:val};setSplits(s);};

  const total=splits.reduce((s,r)=>s+parseFloat(r.amount||0),0);
  const balanced=Math.abs(Math.round(total*100)-Math.round(txn.amount*100))===0;
  const remaining=Math.round((txn.amount-total)*100)/100;

  const handleSave=async()=>{
    if(!balanced){setError(`Splits sum to ${total.toFixed(2)}, need ${txn.amount.toFixed(2)}`);return;}
    setSaving(true);setError('');
    try{
      await apiFetch(`/transactions/${txn.id}/splits`,{method:'POST',body:JSON.stringify({splits:splits.map(s=>({
        amount:parseFloat(s.amount),description:s.description,category:s.category,action:s.action||null,is_gcb:!!s.is_gcb,is_for_others:!!s.is_for_others,notes:s.notes
      }))})});
      toast('Splits saved');onSaved();onClose();
    }catch(e){setError(e.message||'Failed to save splits');}
    finally{setSaving(false);}
  };

  const handleUnsplit=async()=>{
    try{await apiFetch(`/transactions/${txn.id}/splits`,{method:'DELETE'});toast('Splits removed');onSaved();onClose();}
    catch(e){toast('Failed to remove splits','error');}
  };

  if(loading)return<div className="review-overlay" style={{zIndex:6000}}><div className="review-panel" style={{maxWidth:100,textAlign:'center'}}><div className="spinner"/></div></div>;

  return(
    <div className="review-overlay" style={{zIndex: 6000}}>
      <div className="review-panel" style={{maxWidth:800, width:'95vw'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
          <div>
            <h3 style={{fontSize:18,fontWeight:600,fontFamily:'Outfit'}}>Split Transaction</h3>
            <p style={{fontSize:13,color:'var(--text-secondary)',marginTop:4}}>{txn.description_display||txn.description_raw} · <span className={txn.amount<0?'amount-neg':'amount-pos'}>{fmt(Math.abs(txn.amount))}</span></p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{padding:4, minHeight: 0}}>✕</button>
        </div>

        {error&&<div style={{color:'var(--red)',fontSize:13,marginBottom:16,padding:'10px 14px',background:'rgba(239, 68, 68, 0.1)',borderRadius:10,fontWeight:600}}>⚠️ {error}</div>}

        <div className="table-wrap" style={{marginBottom: 20, maxHeight: '50vh', overflowY:'auto'}}>
          <table>
            <thead><tr>
              <th>Amount</th>
              <th>Description</th>
              <th>Type</th>
              <th>Category</th>
              <th style={{textAlign:'center'}}>GCB</th>
              <th style={{textAlign:'center'}}>For Others</th>
              <th style={{width:40}}></th>
            </tr></thead>
            <tbody>{splits.map((s,i)=>(
              <tr key={i}>
                <td><input type="number" step="0.01" value={s.amount} onChange={e=>updateRow(i,'amount',e.target.value)} className="search-input" style={{width:100, padding:'6px 10px'}}/></td>
                <td><input value={s.description||''} onChange={e=>updateRow(i,'description',e.target.value)} className="search-input" style={{width:'100%', padding:'6px 10px'}} placeholder="Optional note…"/></td>
                <td>
                  <select className="filter-select" value={s.action||'Expense'} onChange={e=>{updateRow(i,'action',e.target.value);if(!showCategoryForType(e.target.value))updateRow(i,'category','');}}>
                    {TXN_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </td>
                <td>
                  {showCategoryForType(s.action||'Expense')
                    ?<select className="filter-select" value={s.category||''} onChange={e=>updateRow(i,'category',e.target.value)}>
                      <option value="">Unclassified</option>{sortedCats(categories).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    :<span style={{color:'var(--text-muted)',fontSize:12}}>—</span>}
                </td>
                <td style={{textAlign:'center'}}><input type="checkbox" checked={!!s.is_gcb} onChange={e=>updateRow(i,'is_gcb',e.target.checked)} style={{width:16, height:16}}/></td>
                <td style={{textAlign:'center'}}><input type="checkbox" checked={!!s.is_for_others} onChange={e=>updateRow(i,'is_for_others',e.target.checked)} style={{width:16, height:16}}/></td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={()=>removeRow(i)} style={{color:'var(--red)'}}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:24}}>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <button type="button" className="btn btn-secondary" onClick={addRow}>+ Add Row</button>
            {!balanced&&splits.length>0&&<button type="button" className="btn btn-ghost btn-sm"
              style={{color:'var(--blue-primary)',fontWeight:700}}
              title={`Adjust last row to cover the ${remaining>0?'unallocated':'excess'} ${fmt(Math.abs(remaining))}`}
              onClick={()=>{
                const s=[...splits];
                const last=parseFloat(s[s.length-1].amount||0);
                s[s.length-1]={...s[s.length-1],amount:Math.round((last+remaining)*100)/100};
                setSplits(s);
              }}>↓ Auto-balance</button>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:16}}>
            {balanced
              ?<span className="badge badge-income" style={{fontSize:13}}>✓ BALANCED</span>
              :remaining>0
                ?<span className="badge" style={{background:'rgba(245,158,11,0.1)',color:'var(--amber)',fontSize:13}}>{fmt(remaining)} REMAINING</span>
                :<span className="badge badge-expense" style={{fontSize:13}}>{fmt(Math.abs(remaining))} OVER</span>
            }
            <div style={{display:'flex',gap:12}}>
              {txn.is_split&&<button type="button" className="btn btn-ghost" onClick={handleUnsplit} style={{color:'var(--red)'}}>Unsplit</button>}
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving||!balanced}>{saving?'Saving…':'Save Splits'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── CSV/OFX Import Modal ──────────────────────────────────────────────────── */
