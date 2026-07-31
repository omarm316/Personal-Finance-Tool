import {fmt} from '../lib/format';

export function CategoryDetailPanel({detail,onClose}){
  const{cat,loading,rows,total}=detail;
  return(
    <div className="card" style={{padding:0, overflow:'hidden'}}>
      <div style={{padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:12}}>
          <span style={{fontSize:16,fontWeight:600,color:'var(--text-primary)'}}>{cat}</span>
          {!loading&&<span className="amount-neg" style={{fontSize:14}}>{fmt(total)}</span>}
          {!loading&&<span style={{fontSize:12,color:'var(--text-muted)',fontWeight:500}}>{rows.length} transactions</span>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{padding:4, minHeight: 0}}>✕</button>
      </div>
      {loading
        ?<div className="loading" style={{padding:'40px 0'}}><div className="spinner"/></div>
        :rows.length===0
          ?<div style={{padding:'32px',color:'var(--text-muted)',fontSize:14,textAlign:'center'}}>No transactions found.</div>
          :<div style={{maxHeight:400,overflowY:'auto'}}>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th style={{textAlign:'right'}}>Amount</th>
                </tr></thead>
                <tbody>{rows.map((r,i)=>(
                  <tr key={i}>
                    <td style={{fontSize:13,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{r.date}</td>
                    <td style={{fontSize:13,fontWeight:500}}>
                      {r.is_split
                        ?<span>{r.description} <span className="badge" style={{background:'rgba(59,130,246,0.1)',color:'var(--blue-primary)',marginLeft:4}}>split{r.split_description?': '+r.split_description:''}</span></span>
                        :r.description}
                    </td>
                    <td style={{textAlign:'right',fontSize:13,fontWeight:600,color:r.contrib>=0?'var(--red)':'var(--green)'}}>{r.contrib>=0?'-':'+'}{fmt(Math.abs(r.contrib))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
      }
    </div>
  );
}

/* Half-width companion to the Spending Trend chart. Shows the five most recent
   transactions; "See more" fades in on hover over the card rather than sitting
   there permanently, so the card reads as content first and navigation second.
   Kept touch-reachable by also revealing on focus-within and on tap (see the
   coarse-pointer note below). */
