import {useState} from 'react';
import {fmt} from '../lib/format';

export function ImportModal({accounts,onClose,onImported,toast}){
  const[accountId,setAccountId]=useState('');
  const[signConvention,setSignConvention]=useState('auto');
  const[file,setFile]=useState(null);
  const[stage,setStage]=useState('upload');   // 'upload' | 'preview' | 'importing' | 'done'
  const[preview,setPreview]=useState(null);
  const[result,setResult]=useState(null);
  const[error,setError]=useState('');

  const runPreview=async()=>{
    if(!file||!accountId){setError('Please select an account and a file.');return;}
    setError('');setStage('preview');setPreview(null);
    const fd=new FormData();
    fd.append('file',file);
    try{
      const res=await fetch(`/api/transactions/import?account_id=${accountId}&sign_convention=${signConvention}&preview_only=true`,{method:'POST',body:fd});
      if(!res.ok){const d=await res.json();throw new Error(d.detail||'Preview failed');}
      setPreview(await res.json());
    }catch(e){setError(e.message);setStage('upload');}
  };

  const runImport=async()=>{
    setStage('importing');setError('');
    const fd=new FormData();
    fd.append('file',file);
    try{
      const res=await fetch(`/api/transactions/import?account_id=${accountId}&sign_convention=${signConvention}&preview_only=false`,{method:'POST',body:fd});
      if(!res.ok){const d=await res.json();throw new Error(d.detail||'Import failed');}
      const r=await res.json();
      setResult(r);setStage('done');
      toast(`Imported ${r.imported} transactions (${r.skipped_duplicates} duplicates skipped)`);
      onImported();
    }catch(e){setError(e.message);setStage('preview');}
  };

  return(
    <div className="modal-overlay">
      <div className="modal" style={{maxWidth:640,width:'100%'}}>
        <div className="modal-header">
          <div className="modal-title">Import Transactions</div>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{padding:'20px 24px'}}>
          {error&&<div style={{color:'var(--red)',fontSize:13,marginBottom:12,padding:'8px 12px',background:'rgba(248,113,113,0.08)',borderRadius:6}}>{error}</div>}

          {/* ── UPLOAD STAGE ── */}
          {(stage==='upload'||stage==='preview')&&<>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-muted)',display:'block',marginBottom:4}}>Account</label>
                <select className="filter-select" style={{width:'100%'}} value={accountId} onChange={e=>setAccountId(e.target.value)}>
                  <option value="">— Select account —</option>
                  {accounts.map(a=><option key={a.id} value={a.id}>{a.account_name}{a.mask?` ···${a.mask}`:''}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-muted)',display:'block',marginBottom:4}}>Amount sign</label>
                <select className="filter-select" style={{width:'100%'}} value={signConvention} onChange={e=>setSignConvention(e.target.value)}>
                  <option value="auto">Auto-detect (recommended)</option>
                  <option value="bank">Bank CSV (debits positive)</option>
                  <option value="plaid">Plaid-style (expenses negative)</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:500,color:'var(--text-muted)',display:'block',marginBottom:4}}>File (CSV or OFX/QFX)</label>
              <input type="file" accept=".csv,.ofx,.qfx" onChange={e=>setFile(e.target.files?.[0]||null)}
                style={{fontSize:13,width:'100%',padding:'6px 0'}}/>
            </div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginTop:8,lineHeight:1.5}}>
              CSV columns auto-detected. Supported: Date, Amount (or Debit/Credit), Description / Name / Memo.<br/>
              OFX/QFX files from most US banks work natively.
            </div>
          </>}

          {/* ── PREVIEW STAGE ── */}
          {stage==='preview'&&!preview&&<div className="loading" style={{padding:24}}><div className="spinner"/><span>Analysing file…</span></div>}
          {stage==='preview'&&preview&&<>
            <div className="grid-3" style={{gap:10,margin:'16px 0'}}>
              <div style={{textAlign:'center',padding:'12px 8px',background:'var(--bg)',borderRadius:8}}>
                <div style={{fontSize:22,fontWeight:400}}>{preview.total_rows}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>Total rows</div>
              </div>
              <div style={{textAlign:'center',padding:'12px 8px',background:'rgba(52,211,153,0.1)',borderRadius:8}}>
                <div style={{fontSize:22,fontWeight:400,color:'var(--green)'}}>{preview.to_import}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>New to import</div>
              </div>
              <div style={{textAlign:'center',padding:'12px 8px',background:'var(--elevated)',borderRadius:8}}>
                <div style={{fontSize:22,fontWeight:400,color:'var(--text-muted)'}}>{preview.duplicates}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>Duplicates (skip)</div>
              </div>
            </div>
            {preview.sample_rows?.length>0&&<>
              <div style={{fontSize:12,fontWeight:500,color:'var(--text-muted)',marginBottom:6}}>
                Preview (first {Math.min(preview.sample_rows.length,10)} rows)
              </div>
              <div style={{maxHeight:220,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead><tr style={{background:'var(--bg)'}}>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:500}}>Date</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:500}}>Description</th>
                    <th style={{padding:'6px 8px',textAlign:'right',fontWeight:500}}>Amount</th>
                    <th style={{padding:'6px 8px',textAlign:'center',fontWeight:500}}>Status</th>
                  </tr></thead>
                  <tbody>{preview.sample_rows.slice(0,10).map((r,i)=>(
                    <tr key={i} style={{borderTop:'1px solid var(--border)',opacity:r.duplicate?0.45:1}}>
                      <td style={{padding:'5px 8px',color:'var(--text-secondary)'}}>{r.date}</td>
                      <td style={{padding:'5px 8px',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.description}</td>
                      <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'Plus Jakarta Sans',color:r.amount<0?'var(--red)':'var(--green)'}}>{r.amount<0?'-':'+'}{fmt(Math.abs(r.amount))}</td>
                      <td style={{padding:'5px 8px',textAlign:'center'}}>
                        {r.duplicate
                          ?<span style={{fontSize:10,color:'var(--text-muted)',background:'var(--elevated)',borderRadius:4,padding:'2px 6px'}}>skip</span>
                          :<span style={{fontSize:10,color:'var(--green)',background:'rgba(52,211,153,0.1)',borderRadius:4,padding:'2px 6px'}}>new</span>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>}
            {preview.to_import===0&&<div style={{color:'var(--amber)',fontSize:13,marginTop:8}}>⚠ All rows are duplicates — nothing will be imported.</div>}
          </>}

          {/* ── IMPORTING ── */}
          {stage==='importing'&&<div className="loading" style={{padding:24}}><div className="spinner"/><span>Importing and categorising…</span></div>}

          {/* ── DONE ── */}
          {stage==='done'&&result&&<div style={{textAlign:'center',padding:'20px 0'}}>
            <div style={{fontSize:32,marginBottom:8}}>✓</div>
            <div style={{fontSize:18,fontWeight:400,color:'var(--green)',marginBottom:4}}>{result.imported} transactions imported</div>
            <div style={{fontSize:13,color:'var(--text-muted)'}}>{result.skipped_duplicates} duplicates skipped · {result.llm_calls} LLM enrichments</div>
          </div>}
        </div>

        {/* Footer buttons */}
        <div style={{padding:'12px 24px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'flex-end',gap:8}}>
          {stage==='upload'&&<>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={runPreview} disabled={!file||!accountId}>Preview →</button>
          </>}
          {stage==='preview'&&preview&&<>
            <button type="button" className="btn btn-ghost" onClick={()=>setStage('upload')}>← Back</button>
            <button type="button" className="btn btn-primary" onClick={runImport} disabled={preview.to_import===0}>
              Import {preview.to_import} transactions
            </button>
          </>}
          {stage==='done'&&<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}

/* ── Batch Edit Modal ────────────────────────────────────────────────────────
   Allows editing Type + Category (and optionally "mark reviewed") across all
   selected transactions in one shot. Leave a field at "— keep —" to skip it. */
