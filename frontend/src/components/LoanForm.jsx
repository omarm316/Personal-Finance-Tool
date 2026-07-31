export function LoanForm({editVals,setEditVals,accounts,loanTypes,isNew,onSave,onCancel}){
  const inp=(field,type='text',step)=>(
    <input type={type} step={step} value={editVals[field]??''} onChange={e=>setEditVals(v=>({...v,[field]:e.target.value}))}
      style={{width:'100%',border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',fontSize:12,fontWeight:300,fontFamily:'Plus Jakarta Sans, sans-serif',background:'var(--elevated)',color:'var(--text-primary)',outline:'none'}}/>
  );
  const sel=(field,opts)=>(
    <select value={editVals[field]??''} onChange={e=>setEditVals(v=>({...v,[field]:e.target.value}))}
      style={{width:'100%',border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',fontSize:12,fontWeight:300,fontFamily:'Plus Jakarta Sans, sans-serif',background:'var(--elevated)',color:'var(--text-primary)'}}>
      {opts}
    </select>
  );
  const lbl=(text,req)=><label style={{fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:2}}>{text}{req&&<span style={{color:'var(--red)'}}> *</span>}</label>;
  const checkAccts=accounts.filter(a=>['Checking','Savings'].includes(a.account_type));
  const liabAccts=accounts.filter(a=>a.is_liability);
  const bal=parseFloat(editVals.current_balance)||0;
  const rate=parseFloat(editVals.interest_rate)||0;
  const pmt=parseFloat(editVals.monthly_payment)||0;
  const tax=parseFloat(editVals.property_tax_monthly)||0;
  const ins=parseFloat(editVals.insurance_monthly)||0;
  const prevInt=pmt>0?Math.round(bal*(rate/100/12)*100)/100:0;
  const prevEsc=tax+ins;
  const prevPrin=pmt>0?Math.round((pmt-prevInt-prevEsc)*100)/100:0;
  return(
    <div style={{padding:'16px 20px',background:'rgba(var(--blue-primary-rgb), 0.12)',border:'1px solid var(--blue-primary)',borderRadius:14,margin:'0 0 16px'}}>
      <div style={{fontSize:13,fontWeight:400,marginBottom:12,color:'var(--text-primary)'}}>{isNew?'New Loan':'Edit Loan'}</div>
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:8,marginBottom:8}}>
        <div>{lbl('Lender',true)}{inp('lender')}</div>
        <div>{lbl('Type')}{sel('loan_type',loanTypes.map(t=><option key={t}>{t}</option>))}</div>
        <div>{lbl('Linked Account (Liability)')}{sel('account_id',[<option key="" value="">— None —</option>,...liabAccts.map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)])}</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:8}}>
        <div>{lbl('Original Principal',true)}{inp('original_principal','number','0.01')}</div>
        <div>{lbl('Balance (as of below)')}{inp('current_balance','number','0.01')}</div>
        <div>{lbl('Balance Date')}{inp('balance_date','date')}</div>
        <div>{lbl('Remaining Months')}{inp('remaining_term_months','number','1')}</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:8}}>
        <div>{lbl('Interest Rate (%)')}{inp('interest_rate','number','0.001')}</div>
        <div>{lbl('Total Monthly Payment')}{inp('monthly_payment','number','0.01')}</div>
        <div>{lbl('Property Tax / mo')}{inp('property_tax_monthly','number','0.01')}</div>
        <div>{lbl('Insurance / mo')}{inp('insurance_monthly','number','0.01')}</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:8}}>
        <div>{lbl('Paid From (Checking)')}{sel('payment_account_id',[<option key="" value="">— None —</option>,...checkAccts.map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)])}</div>
        <div>{lbl('Due Day of Month')}{inp('payment_due_day','number','1')}</div>
        <div>{lbl('Original Term (months)')}{inp('term_months','number','1')}</div>
        <div>{lbl('Maturity Date')}{inp('maturity_date','date')}</div>
      </div>
      {pmt>0&&<div style={{background:'var(--elevated)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',marginBottom:8,fontSize:12,fontWeight:300,display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontWeight:500,color:'var(--text-muted)'}}>Next payment preview:</span>
        <span>Principal <b style={{fontFamily:'Plus Jakarta Sans'}}>${prevPrin.toLocaleString()}</b></span>
        <span>Interest <b style={{fontFamily:'Plus Jakarta Sans',color:'var(--red)'}}>${prevInt.toLocaleString()}</b></span>
        {tax>0&&<span>Prop Tax <b style={{fontFamily:'Plus Jakarta Sans'}}>${tax.toLocaleString()}</b></span>}
        {ins>0&&<span>Insurance <b style={{fontFamily:'Plus Jakarta Sans'}}>${ins.toLocaleString()}</b></span>}
      </div>}
      <div style={{marginBottom:8}}>{lbl('Notes')}{inp('notes')}</div>
      <div style={{display:'flex',gap:8}}>
        <button type="button" className="btn btn-sm btn-success" onClick={onSave}>Save</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
