import {useState,useEffect,useCallback} from 'react';
import {ConfirmModal} from '../components/ConfirmModal';
import {LoanForm} from '../components/LoanForm';
import {apiFetch} from '../lib/api';
import {fmt,toTitleCase} from '../lib/format';

export function LoansPage({toast,refreshKey}){
  const[loans,setLoans]=useState([]);
  const[accounts,setAccounts]=useState([]);
  const[loading,setLoading]=useState(true);
  const[editing,setEditing]=useState(null);
  const[editVals,setEditVals]=useState({});
  const[linkModal,setLinkModal]=useState(null);
  const[candidates,setCandidates]=useState([]);
  const[linkPreview,setLinkPreview]=useState(null);
  const[linking,setLinking]=useState(false);
  const[linkedTxns,setLinkedTxns]=useState([]);
  const[cm,setCm]=useState(null);

  const loanTypes=['Mortgage','Auto','Student','Personal','Other'];
  const blankLoan={lender:'',loan_type:'Mortgage',original_principal:'',current_balance:'',
    balance_date:'',remaining_term_months:'',interest_rate:'',term_months:'',monthly_payment:'',
    property_tax_monthly:'',insurance_monthly:'',payment_account_id:'',payment_due_day:'',
    start_date:'',maturity_date:'',account_id:'',notes:''};

  const load=useCallback(async()=>{
    setLoading(true);
    try{const[l,a]=await Promise.all([apiFetch('/loans'),apiFetch('/accounts')]);setLoans(l);setAccounts(a);}
    catch(e){toast('Failed to load loans','error');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{load();},[load,refreshKey]);

  const saveLoan=async()=>{
    const body={...editVals,
      original_principal:parseFloat(editVals.original_principal)||0,
      current_balance:editVals.current_balance!==''?parseFloat(editVals.current_balance):null,
      interest_rate:editVals.interest_rate!==''?parseFloat(editVals.interest_rate):null,
      term_months:editVals.term_months!==''?parseInt(editVals.term_months):null,
      remaining_term_months:editVals.remaining_term_months!==''?parseInt(editVals.remaining_term_months):null,
      monthly_payment:editVals.monthly_payment!==''?parseFloat(editVals.monthly_payment):null,
      property_tax_monthly:editVals.property_tax_monthly!==''?parseFloat(editVals.property_tax_monthly):null,
      insurance_monthly:editVals.insurance_monthly!==''?parseFloat(editVals.insurance_monthly):null,
      payment_account_id:editVals.payment_account_id?parseInt(editVals.payment_account_id):null,
      payment_due_day:editVals.payment_due_day!==''?parseInt(editVals.payment_due_day):null,
      account_id:editVals.account_id?parseInt(editVals.account_id):null,
    };
    try{
      if(editing==='new'){await apiFetch('/loans',{method:'POST',body:JSON.stringify(body)});toast('Loan created');}
      else{await apiFetch(`/loans/${editing}`,{method:'PATCH',body:JSON.stringify(body)});toast('Loan updated');}
      setEditing(null);await load();
    }catch(e){toast('Failed to save: '+e.message,'error');}
  };

  const deleteLoan=(id)=>{
    setCm({
      title:'Deactivate Loan',
      body:'This loan will be deactivated. Linked transactions will not be affected.',
      confirmLabel:'Deactivate',danger:true,
      onConfirm:async()=>{
        try{await apiFetch(`/loans/${id}`,{method:'DELETE'});toast('Loan deactivated');await load();}
        catch(e){toast('Failed','error');}
      }
    });
  };

  const openLinkModal=async(loan)=>{
    setLinkModal(loan);setLinkPreview(null);setCandidates([]);setLinkedTxns([]);
    try{
      const[cands,preview,linked]=await Promise.all([
        apiFetch(`/loans/${loan.id}/candidate-transactions`),
        apiFetch(`/loans/${loan.id}/compute-split`),
        apiFetch(`/loans/${loan.id}/linked-transactions`),
      ]);
      setCandidates(cands);setLinkPreview(preview);setLinkedTxns(linked);
    }catch(e){toast('Failed to load candidates: '+e.message,'error');}
  };

  const doLink=async(txnId)=>{
    if(!linkModal)return;
    setLinking(true);
    try{
      const r=await apiFetch(`/loans/${linkModal.id}/link-transaction`,{method:'POST',body:JSON.stringify({transaction_id:txnId})});
      toast(`Linked! Principal ${fmt(r.split.principal)}, Interest ${fmt(r.split.interest)}. New balance: ${fmt(r.new_balance)}`);
      setLinkModal(null);await load();
    }catch(e){toast('Link failed: '+e.message,'error');}
    finally{setLinking(false);}
  };

  const doUnlink=(txnId)=>{
    if(!linkModal)return;
    setCm({
      title:'Unlink Payment',
      body:'This payment will be unlinked and the loan balance will be restored.',
      confirmLabel:'Unlink',danger:true,
      onConfirm:async()=>{
        try{
          await apiFetch(`/loans/${linkModal.id}/unlink-transaction/${txnId}`,{method:'DELETE'});
          toast('Payment unlinked');
          const[cands,preview,linked]=await Promise.all([
            apiFetch(`/loans/${linkModal.id}/candidate-transactions`),
            apiFetch(`/loans/${linkModal.id}/compute-split`),
            apiFetch(`/loans/${linkModal.id}/linked-transactions`),
          ]);
          setCandidates(cands);setLinkPreview(preview);setLinkedTxns(linked);
          await load();
        }catch(e){toast('Unlink failed: '+e.message,'error');}
      }
    });
  };

  const totalPrincipal=loans.reduce((s,l)=>s+l.original_principal,0);
  const totalBalance=loans.reduce((s,l)=>s+(l.current_balance||0),0);
  const totalPayment=loans.reduce((s,l)=>s+(l.monthly_payment||0),0);

  return(
    <div>
      {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}
      {linkModal&&<div className="review-overlay">
        <div className="review-panel" style={{width:620,maxHeight:'80vh',overflowY:'auto'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div>
              <div style={{fontSize:15,fontWeight:500}}>Link Payment — {linkModal.lender}</div>
              <div style={{fontSize:12,color:'var(--text-muted)'}}>Pick the checking transaction that represents this loan payment</div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setLinkModal(null)}>✕</button>
          </div>
          {linkedTxns.length>0&&<div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:6}}>Linked Payments</div>
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Principal</th><th></th></tr></thead>
              <tbody>{linkedTxns.map(t=>{
                const principal=t.splits.find(s=>s.description==='Principal');
                return(
                  <tr key={t.id}>
                    <td style={{fontFamily:'Plus Jakarta Sans',fontSize:12}}>{t.date}</td>
                    <td style={{fontSize:12}}>{t.description}</td>
                    <td style={{fontFamily:'Plus Jakarta Sans',fontSize:12,color:'var(--red)'}}>{fmt(t.amount)}</td>
                    <td style={{fontFamily:'Plus Jakarta Sans',fontSize:12}}>{principal?fmt(principal.amount):'—'}</td>
                    <td><button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)'}} onClick={()=>doUnlink(t.id)}>Unlink</button></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </div>}
          {linkPreview&&<div className="grid-4" style={{background:'rgba(var(--blue-primary-rgb), 0.12)',border:'1px solid var(--blue-primary)',borderRadius:10,padding:'10px 14px',marginBottom:12,gap:8}}>
            {[['Principal',linkPreview.principal,'var(--text)'],['Interest',linkPreview.interest,'var(--red)'],['Prop Tax',linkPreview.property_tax,'var(--text-secondary)'],['Insurance',linkPreview.insurance,'var(--text-secondary)']].map(([lbl,val,color])=>(
              <div key={lbl} style={{textAlign:'center'}}>
                <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase'}}>{lbl}</div>
                <div style={{fontSize:15,fontWeight:500,fontFamily:'Plus Jakarta Sans',color}}>{fmt(val)}</div>
              </div>
            ))}
          </div>}
          {candidates.length===0
            ?<div style={{padding:'20px 0',textAlign:'center',color:'var(--text-muted)',fontSize:13}}>
                No matching transactions found.<br/>
                <span style={{fontSize:12}}>Ensure the loan has "Paid From" account and "Total Monthly Payment" set, and that the transaction exists in the DB.</span>
              </div>
            :<div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th></th></tr></thead>
              <tbody>{candidates.map(t=>(
                <tr key={t.id}>
                  <td style={{fontFamily:'Plus Jakarta Sans',fontSize:12}}>{t.date}</td>
                  <td style={{fontSize:12}}>{t.description_clean||t.description_raw}</td>
                  <td style={{fontFamily:'Plus Jakarta Sans',fontSize:12,color:'var(--red)'}}>{fmt(t.amount)}</td>
                  <td><button type="button" className="btn btn-sm btn-primary" onClick={()=>doLink(t.id)} disabled={linking}>Link</button></td>
                </tr>
              ))}</tbody>
            </table></div>}
        </div>
      </div>}

      {editing&&<div style={{marginBottom:16}}>
        <LoanForm editVals={editVals} setEditVals={setEditVals} accounts={accounts}
          loanTypes={loanTypes} isNew={editing==='new'}
          onSave={saveLoan} onCancel={()=>setEditing(null)}/>
      </div>}

      <div className="metric-grid grid-3" style={{marginBottom:20}}>
        {[
          {label:'Total Principal',val:fmt(totalPrincipal)},
          {label:'Total Balance',val:fmt(Math.abs(totalBalance)),color:'var(--red)'},
          {label:'Monthly Payments',val:fmt(totalPayment)},
        ].map(k=>(
          <div key={k.label} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:18}}>
            <div className="metric-label">{k.label}</div><div className="metric-value" style={{color:k.color}}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* ── Payoff Timeline ───────────────────────────────────────────────── */}
      {loans.length>0&&(()=>{
        // Compute payoff months for each loan with enough data
        const now=new Date();
        const timelineLoans=loans.map(l=>{
          const bal=Math.abs(l.current_balance||0);
          const rate=(l.interest_rate||0)/100/12; // monthly rate
          const pmt=l.monthly_payment||0;
          if(!bal||!pmt)return{...l,payoffMonths:null,payoffDate:null};
          let months;
          if(l.maturity_date){
            // If maturity date is set, use it directly
            const mat=new Date(l.maturity_date);
            months=Math.max(0,Math.round((mat-now)/(1000*60*60*24*30.44)));
          }else if(l.remaining_term_months){
            months=l.remaining_term_months;
          }else if(rate>0){
            // Amortization formula: n = -ln(1 - (r*PV)/PMT) / ln(1+r)
            const x=1-(rate*bal)/pmt;
            if(x<=0)months=999; // payment too low to ever pay off
            else months=Math.ceil(-Math.log(x)/Math.log(1+rate));
          }else{
            months=Math.ceil(bal/pmt);
          }
          const payDate=new Date(now.getFullYear(),now.getMonth()+months,1);
          return{...l,payoffMonths:months,payoffDate:payDate};
        }).filter(l=>l.payoffMonths!=null&&l.payoffMonths<600);

        if(!timelineLoans.length)return null;

        const maxMonths=Math.max(...timelineLoans.map(l=>l.payoffMonths),1);
        const maxYears=Math.ceil(maxMonths/12);
        const COLORS=['var(--blue-primary)','var(--green)','#06b6d4','#a78bfa','var(--red)','var(--amber)'];

        return(
          <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px',marginBottom:16}}>Payoff Timeline</div>
            <div style={{position:'relative',paddingBottom:24}}>
              {/* Year markers */}
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:12,paddingLeft:140}}>
                {Array.from({length:Math.min(maxYears+1,31)},(_,i)=>(
                  <div key={i} style={{fontSize:10,color:'var(--text-muted)',fontFamily:'Plus Jakarta Sans',fontWeight:300,position:'relative'}}>
                    {i===0?'Now':`${now.getFullYear()+i}`}
                  </div>
                ))}
              </div>
              {/* Loan bars */}
              {timelineLoans.map((l,i)=>{
                const pct=Math.min((l.payoffMonths/maxMonths)*100,100);
                const color=COLORS[i%COLORS.length];
                const payLabel=l.payoffDate?l.payoffDate.toLocaleDateString('en-US',{month:'short',year:'numeric'}):`${l.payoffMonths} mo`;
                return(
                  <div key={l.id} style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                    <div style={{width:128,flexShrink:0,textAlign:'right',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      <div style={{fontSize:12,fontWeight:400,color:'var(--text-primary)'}}>{l.lender}</div>
                      <div style={{fontSize:10,color:'var(--text-muted)',fontWeight:300}}>{fmt(Math.abs(l.current_balance||0))}</div>
                    </div>
                    <div style={{flex:1,position:'relative'}}>
                      <div style={{height:22,background:'var(--elevated)',borderRadius:6,overflow:'hidden',border:'1px solid var(--border)'}}>
                        <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:6,opacity:0.75,transition:'width 0.5s ease',display:'flex',alignItems:'center',justifyContent:'flex-end',paddingRight:pct>15?8:0}}>
                          {pct>15&&<span style={{fontSize:9,fontWeight:500,color:'#0c0c10',whiteSpace:'nowrap'}}>{payLabel}</span>}
                        </div>
                      </div>
                      {pct<=15&&<span style={{position:'absolute',left:`calc(${pct}% + 6px)`,top:3,fontSize:9,fontWeight:500,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{payLabel}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,overflow:'hidden'}}>
        <div style={{padding:'14px 20px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid var(--border)'}}>
          <span style={{fontSize:10,fontWeight:500,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)'}}>Loans ({loans.length})</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={()=>{setEditing('new');setEditVals({...blankLoan});}}>+ Add Loan</button>
        </div>
        {loading?<div className="loading"><div className="spinner"/></div>
          :loans.length===0&&!editing?<div className="empty"><div className="empty-icon">⌂</div><span>No loans yet</span></div>
          :<div className="table-wrap"><table>
            <thead><tr><th>Lender</th><th>Type</th><th>Balance</th><th>Rate</th><th>Principal / Interest / Tax / Ins</th><th>Remaining</th><th>Due</th><th>Actions</th></tr></thead>
            <tbody>{loans.map(l=>(
              <tr key={l.id}>
                <td style={{fontWeight:500}}>{l.lender}</td>
                <td><span className="badge badge-category" style={{fontSize:11}}>{toTitleCase(l.loan_type||'')}</span></td>
                <td style={{fontFamily:'Plus Jakarta Sans',fontSize:13,color:'var(--red)'}}>{l.current_balance!=null?fmt(Math.abs(l.current_balance)):'—'}{l.balance_date&&<span style={{fontSize:10,color:'var(--text-muted)',display:'block'}}>as of {l.balance_date}</span>}</td>
                <td style={{fontFamily:'Plus Jakarta Sans',fontSize:13}}>{l.interest_rate!=null?`${l.interest_rate}%`:'—'}</td>
                <td style={{fontSize:12}}>
                  {l.next_split?<span style={{fontFamily:'Plus Jakarta Sans'}}>
                    {fmt(l.next_split.principal)} / {fmt(l.next_split.interest)} / {fmt(l.next_split.property_tax||0)} / {fmt(l.next_split.insurance||0)}
                  </span>:<span style={{color:'var(--text-muted)'}}>—</span>}
                </td>
                <td style={{fontSize:12,color:'var(--text-muted)'}}>{l.remaining_term_months!=null?`${l.remaining_term_months} mo`:'—'}</td>
                <td style={{fontSize:12}}>{l.payment_due_day?`Day ${l.payment_due_day}`:<span style={{color:'var(--text-muted)'}}>—</span>}</td>
                <td><div className="edit-actions">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={()=>{setEditing(l.id);setEditVals({lender:l.lender,loan_type:l.loan_type,original_principal:l.original_principal,current_balance:l.current_balance??'',balance_date:l.balance_date||'',remaining_term_months:l.remaining_term_months??'',interest_rate:l.interest_rate??'',term_months:l.term_months??'',monthly_payment:l.monthly_payment??'',property_tax_monthly:l.property_tax_monthly??'',insurance_monthly:l.insurance_monthly??'',payment_account_id:l.payment_account_id??'',payment_due_day:l.payment_due_day??'',start_date:l.start_date||'',maturity_date:l.maturity_date||'',account_id:l.account_id??'',notes:l.notes||''});}}>Edit</button>
                  <button type="button" className="btn btn-sm btn-ghost" title="Link a payment transaction" onClick={()=>openLinkModal(l)}>💰</button>
                  <button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)'}} onClick={()=>deleteLoan(l.id)}>×</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        }
      </div>
    </div>
  );
}

/* ── Cash Flow Planner Page ──────────────────────────────────────────────── */
