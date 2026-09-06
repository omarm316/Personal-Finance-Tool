import {useState} from 'react';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {fmt,showCategoryForType,sortedCats,todayStr} from '../lib/format';

export function ManualTransactionModal({accounts,categories,onClose,onSaved,toast}){
  const[date,setDate]=useState(todayStr());
  const[desc,setDesc]=useState('');
  const[amount,setAmount]=useState('');
  const[action,setAction]=useState('Expense');
  const[category,setCategory]=useState('');
  const[accountId,setAccountId]=useState(accounts[0]?.id||'');
  const[saving,setSaving]=useState(false);
  const[error,setError]=useState('');
  const[dates,setDates]=useState([date]);
  const[useSplits,setUseSplits]=useState(false);
  const[splits,setSplits]=useState([
    {amount:'',description:'',category:'',action:'Expense',is_gcb:false,is_for_others:false},
    {amount:'',description:'',category:'',action:'Expense',is_gcb:false,is_for_others:false},
  ]);
  /* Use the same canonical list as the filter dropdown and everywhere else */
  const actions=TXN_TYPES;
  const addDate=()=>setDates(d=>[...d,'']);
  const removeDate=i=>setDates(d=>d.filter((_,idx)=>idx!==i));
  const updateDate=(i,v)=>setDates(d=>{const n=[...d];n[i]=v;return n;});
  const addSplit=()=>setSplits(s=>[...s,{amount:'',description:'',category:'',action:'Expense',is_gcb:false,is_for_others:false}]);
  const removeSplit=i=>setSplits(s=>s.filter((_,j)=>j!==i));
  const updateSplit=(i,field,val)=>setSplits(s=>{const n=[...s];n[i]={...n[i],[field]:val};return n;});

  const splitTotal=splits.reduce((s,r)=>s+parseFloat(r.amount||0),0);
  const parsedAmount=parseFloat(amount||0);
  const splitBalanced=useSplits&&Math.abs(Math.round(splitTotal*100)-Math.round(parsedAmount*100))===0;
  const splitRemaining=Math.round((parsedAmount-splitTotal)*100)/100;

  const handleSave=async()=>{
    const validDates=dates.filter(d=>d);
    if(!desc||!amount||!accountId){setError('Fill all required fields');return;}
    if(!validDates.length){setError('At least one date is required');return;}
    if(useSplits&&!splitBalanced){setError(`Splits sum to ${splitTotal.toFixed(2)}, need ${parsedAmount.toFixed(2)}`);return;}
    setSaving(true);setError('');
    try{
      const body={
        dates:validDates,description:desc,amount:parsedAmount,action,
        account_id:parseInt(accountId),category:category||null,
      };
      if(useSplits){
        body.splits=splits.map(s=>({
          amount:parseFloat(s.amount),description:s.description||null,
          category:s.category||null,action:s.action||action,is_gcb:!!s.is_gcb,is_for_others:!!s.is_for_others,
        }));
      }
      await apiFetch('/transactions/manual',{method:'POST',body:JSON.stringify(body)});
      toast(`${validDates.length} manual transaction${validDates.length>1?'s':''} added`);onSaved();onClose();
    }catch(e){setError('Failed to save transaction');}
    finally{setSaving(false);}
  };
  return(
    <div className="review-overlay">
      <div className="review-panel" style={{maxWidth:useSplits?700:480,width:'90vw'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:500}}>Add Manual Transaction</div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} style={{fontSize:18,padding:'0 4px',lineHeight:1}}>×</button>
        </div>
        {error&&<div style={{color:'var(--red)',fontSize:13,marginBottom:12}}>{error}</div>}
        <div className="review-field"><label>Account *</label>
          <select value={accountId} onChange={e=>setAccountId(e.target.value)}>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.account_name}{a.is_manual?' (Manual)':''}</option>)}
          </select>
        </div>
        <div className="review-field">
          <label>Date(s) <span style={{fontWeight:400,color:'var(--text-muted)',fontSize:12}}>— add multiple for recurring</span></label>
          {dates.map((d,i)=>(
            <div key={i} style={{display:'flex',gap:6,alignItems:'center',marginBottom:i<dates.length-1?6:0}}>
              <input type="date" value={d} onChange={e=>updateDate(i,e.target.value)} style={{flex:1}}/>
              {dates.length>1&&<button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)',padding:'2px 6px',fontSize:14}} onClick={()=>removeDate(i)}>×</button>}
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" style={{marginTop:6,fontSize:12,color:'var(--blue)'}} onClick={addDate}>+ Add date</button>
        </div>
        <div className="review-field"><label>Description *</label><input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. Home value update, Loan payment"/></div>
        <div className="review-field"><label>Amount * (negative = outflow)</label><input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="-500.00 or 1000.00"/></div>
        <div style={{display:'flex',gap:12}}>
          <div className="review-field" style={{flex:1}}><label>Type</label>
            <select value={action} onChange={e=>{setAction(e.target.value);if(!showCategoryForType(e.target.value))setCategory('');}}>
              {actions.map(a=><option key={a}>{a}</option>)}
            </select>
          </div>
          {!useSplits&&showCategoryForType(action)&&<div className="review-field" style={{flex:1}}><label>Category</label>
            <select value={category} onChange={e=>setCategory(e.target.value)}>
              <option value="">Unclassified</option>
              {sortedCats(categories).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>}
        </div>

        {/* Split toggle */}
        <div style={{marginTop:8,marginBottom:useSplits?8:0}}>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,cursor:'pointer',color:'var(--text-secondary)'}}>
            <input type="checkbox" checked={useSplits} onChange={e=>setUseSplits(e.target.checked)}/>
            Split into multiple categories
          </label>
        </div>

        {/* Split rows */}
        {useSplits&&<div style={{marginTop:8}}>
          <table style={{width:'100%',fontSize:13,marginBottom:8}}><thead><tr>
            <th style={{textAlign:'left',padding:'6px 8px'}}>Amount</th>
            <th style={{textAlign:'left',padding:'6px 8px'}}>Description</th>
            <th style={{textAlign:'left',padding:'6px 8px'}}>Type</th>
            <th style={{textAlign:'left',padding:'6px 8px'}}>Category</th>
            <th style={{textAlign:'center',padding:'6px 8px'}}>GCB</th>
            <th style={{textAlign:'center',padding:'6px 8px'}}>For Others</th>
            <th style={{width:32}}></th>
          </tr></thead><tbody>{splits.map((s,i)=>(
            <tr key={i}>
              <td style={{padding:'4px 8px'}}><input type="number" step="0.01" value={s.amount} onChange={e=>updateSplit(i,'amount',e.target.value)} style={{width:90,fontSize:13,padding:'4px 6px'}}/></td>
              <td style={{padding:'4px 8px'}}><input value={s.description||''} onChange={e=>updateSplit(i,'description',e.target.value)} style={{width:'100%',fontSize:13,padding:'4px 6px'}} placeholder="Optional"/></td>
              <td style={{padding:'4px 8px'}}><select value={s.action||'Expense'} onChange={e=>{updateSplit(i,'action',e.target.value);if(!showCategoryForType(e.target.value))updateSplit(i,'category','');}} style={{fontSize:12,padding:'4px'}}>
                {TXN_TYPES.map(t=><option key={t}>{t}</option>)}
              </select></td>
              <td style={{padding:'4px 8px'}}>{showCategoryForType(s.action||'Expense')
                ?<select value={s.category||''} onChange={e=>updateSplit(i,'category',e.target.value)} style={{fontSize:12,padding:'4px'}}>
                  <option value="">Unclassified</option>{sortedCats(categories).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                :<span style={{color:'var(--text-muted)',fontSize:12}}>—</span>}
              </td>
              <td style={{textAlign:'center',padding:'4px'}}><input type="checkbox" checked={!!s.is_gcb} onChange={e=>updateSplit(i,'is_gcb',e.target.checked)}/></td>
              <td style={{textAlign:'center',padding:'4px'}}><input type="checkbox" checked={!!s.is_for_others} onChange={e=>updateSplit(i,'is_for_others',e.target.checked)}/></td>
              <td style={{padding:'4px'}}>{splits.length>1&&<button type="button" className="btn btn-sm btn-ghost" onClick={()=>removeSplit(i)} style={{padding:'2px 6px',fontSize:13}}>×</button>}</td>
            </tr>
          ))}</tbody></table>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <button type="button" className="btn btn-sm btn-secondary" onClick={addSplit}>+ Add Row</button>
              {!splitBalanced&&splits.length>0&&amount&&<button type="button" className="btn btn-sm btn-ghost"
                style={{fontSize:11,color:'var(--blue)',border:'1px solid rgba(96,165,250,0.25)',padding:'3px 9px'}}
                title={`Adjust last row to cover the ${splitRemaining>0?'unallocated':'excess'} ${fmt(Math.abs(splitRemaining))}`}
                onClick={()=>{
                  const s=[...splits];
                  const last=parseFloat(s[s.length-1].amount||0);
                  s[s.length-1]={...s[s.length-1],amount:Math.round((last+splitRemaining)*100)/100};
                  setSplits(s);
                }}>↓ Fill Last</button>}
            </div>
            <div style={{textAlign:'right'}}>
              {!amount?<span style={{fontSize:13,color:'var(--text-muted)'}}>Enter total amount</span>
                :splitBalanced
                  ?<span style={{fontSize:13,fontWeight:500,color:'var(--green)'}}>✓ Balanced</span>
                  :splitRemaining>0
                    ?<span style={{fontSize:13,fontWeight:500,color:'var(--amber)'}}>{fmt(splitRemaining)} remaining</span>
                    :<span style={{fontSize:13,fontWeight:500,color:'var(--red)'}}>{fmt(Math.abs(splitRemaining))} over</span>
              }
            </div>
          </div>
        </div>}

        <div className="review-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-sm btn-success" onClick={handleSave} disabled={saving||(useSplits&&!splitBalanced)}>{saving?'…':`✓ Save${dates.length>1?` (${dates.filter(d=>d).length})`:''}`}</button>
        </div>
      </div>
    </div>
  );
}

/* Inline split editor modal (Section 2E) */
