import {useState,useEffect,useCallback} from 'react';
import {apiFetch} from '../lib/api';
import {fmt,fmtDate} from '../lib/format';

export function GCBPage({toast,refreshKey}){
  const MO=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now=new Date();
  const[txns,setTxns]=useState([]);
  const[loading,setLoading]=useState(true);
  const[year,setYear]=useState(now.getFullYear());
  const[month,setMonth]=useState(0); // 0 = all months
  const[error,setError]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      let q=`/transactions?limit=500`;
      if(month>0){
        const start=`${year}-${String(month).padStart(2,'0')}-01`;
        const endM=month===12?1:month+1;
        const endY=month===12?year+1:year;
        const end=`${endY}-${String(endM).padStart(2,'0')}-01`;
        q+=`&start_date=${start}&end_date=${end}`;
      }else{
        q+=`&start_date=${year}-01-01&end_date=${year}-12-31`;
      }
      const data=await apiFetch(q);
      setTxns(data.filter(t=>t.is_gcb));
    }catch(e){setError('Failed to load');toast('Failed to load','error');}
    finally{setLoading(false);}
  },[year,month]);
  useEffect(()=>{load();},[load,refreshKey]);

  const revenue=txns.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
  const costs=txns.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
  const net=revenue-costs;
  const txnCount=txns.length;
  const margin=revenue>0?Math.round(net/revenue*100):0;

  return(
    <div>
      {error&&<div style={{color:'var(--red)',fontSize:13,marginBottom:12}}>{error}</div>}

      {/* Period selector */}
      <div className="card" style={{display:'flex',alignItems:'center',gap:10,marginBottom:24,padding:'12px 24px'}}>
        <select className="filter-select" value={year} onChange={e=>setYear(parseInt(e.target.value))}>
          {[now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <select className="filter-select" value={month} onChange={e=>setMonth(parseInt(e.target.value))}>
          <option value={0}>All Months</option>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{MO[m]}</option>)}
        </select>
        <span className="filter-count">{txnCount} GCB transactions</span>
      </div>

      {/* KPI cards */}
      <div className="metric-grid" style={{marginBottom:20}}>
        <div className="card metric-card"><div className="metric-label">GCB Revenue</div><div className="metric-value" style={{color:'var(--green)'}}>{fmt(revenue)}</div></div>
        <div className="card metric-card"><div className="metric-label">GCB Costs</div><div className="metric-value" style={{color:'var(--red)'}}>{fmt(costs)}</div></div>
        <div className="card metric-card"><div className="metric-label">Net P&L</div><div className="metric-value" style={{color:net>=0?'var(--green)':'var(--red)'}}>{net>=0?'+':''}{fmt(net)}</div></div>
        <div className="card metric-card"><div className="metric-label">Margin</div><div className="metric-value" style={{color:margin>=0?'var(--green)':'var(--red)'}}>{margin}%</div></div>
      </div>

      <div className="card">
        <div className="section-header"><div className="section-title">GCB Transactions{month>0?` — ${MO[month]} ${year}`:` — ${year}`}</div></div>
        {loading?<div className="loading"><div className="spinner"/><span>Loading…</span></div>
          :txns.length===0?<div className="empty"><div className="empty-icon">$</div><span>No GCB-tagged transactions{month>0?` in ${MO[month]} ${year}`:` in ${year}`}</span><span style={{fontSize:12,color:'var(--text-muted)'}}>Tag transactions as GCB from the Transactions page</span></div>
          :<div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Type</th><th>Category</th><th>Account</th></tr></thead>
            <tbody>{txns.map(t=>(
              <tr key={t.id}>
                <td style={{color:'var(--text-secondary)',fontSize:12,whiteSpace:'nowrap'}}>{fmtDate(t.date)}</td>
                <td style={{fontWeight:500,fontSize:13.5}}>{t.description_display||t.description_raw}</td>
                <td><span className={t.amount<0?'amount-neg':'amount-pos'}>{t.amount<0?'–':'+'}{fmt(t.amount)}</span></td>
                <td><span className={`badge badge-${t.action?.toLowerCase()==='income'?'income':t.action?.toLowerCase()==='transfer'?'transfer':'expense'}`}>{t.action}</span></td>
                <td>{t.action!=='Transfer'&&<span className="badge badge-category">{t.category_final}</span>}</td>
                <td style={{fontSize:12,color:'var(--text-muted)'}}>{t.account_name}</td>
              </tr>
            ))}</tbody>
          </table></div>
        }
      </div>
    </div>
  );
}
