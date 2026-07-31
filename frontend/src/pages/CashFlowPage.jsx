import {useState,useEffect,useCallback} from 'react';
import {ConfirmModal} from '../components/ConfirmModal';
import {SkeletonTable} from '../components/SkeletonTable';
import {apiFetch} from '../lib/api';
import {fmt,fmtAcctType,todayStr} from '../lib/format';

export function CashFlowPage({toast,refreshKey}){
  // Account types eligible as salary deposit destinations
  const SALARY_TYPES=new Set(['Checking','checking','Savings','savings','HSA','hsa','FSA','fsa','Investment','investment','Brokerage','brokerage','IRA','ira','401k','401K']);

  // ── Salary state ─────────────────────────────────────────────────────
  const[salaryPayments,setSalaryPayments]=useState([]);
  const[salaryAccounts,setSalaryAccounts]=useState([]);
  const[showSalaryForm,setShowSalaryForm]=useState(false);
  const[editingSalary,setEditingSalary]=useState(null);
  // payment_dates is always an array (multi-select on add, single-element on edit)
  const blankSF=()=>({payment_dates:[todayStr()],description:'Salary',person:'',allocations:{},frequency:'',freqConfig:{startDate:todayStr(),dayOfWeek:4,day1:15,day2:0,monthsAhead:3}});
  const[salaryForm,setSalaryForm]=useState(blankSF());
  const[salarySaving,setSalarySaving]=useState(false);
  // ── Selection state ───────────────────────────────────────────────────
  const[salSel,setSalSel]=useState(new Set());
  const[ovSel,setOvSel]=useState(new Set());

  // ── Overlay state ─────────────────────────────────────────────────────
  const[overlays,setOverlays]=useState([]);
  const[overlayAccounts,setOverlayAccounts]=useState([]);
  const[showOverlayForm,setShowOverlayForm]=useState(false);
  const[editingOverlay,setEditingOverlay]=useState(null);
  const[ovForm,setOvForm]=useState({description:'',amount:'',flow_date:todayStr(),source:'manual',account_id:''});
  const[ovSaving,setOvSaving]=useState(false);
  const[genBusy,setGenBusy]=useState(false);
  const[loading,setLoading]=useState(true);
  const[cm,setCm]=useState(null);

  // ── Analytics state ─────────────────────────────────────────────────
  const[monthlyTrend,setMonthlyTrend]=useState([]); // [{label,income,expenses}]
  const[breakdownRange,setBreakdownRange]=useState('month'); // 'month' | 'last30' | 'next30'
  const[breakdownData,setBdData]=useState({income:{},expenses:{},totalIn:0,totalOut:0});
  const[bdLoading,setBdLoading]=useState(false);

  const load=useCallback(async(autoGen=false)=>{
    setLoading(true);
    try{
      const[payments,accts,ovs]=await Promise.all([
        apiFetch('/salary-payments').catch(()=>[]),
        apiFetch('/accounts').catch(()=>[]),
        apiFetch('/cash-flow-overlays').catch(()=>[]),
      ]);
      setSalaryPayments(payments);
      setSalaryAccounts(accts.filter(a=>a.is_active&&SALARY_TYPES.has(a.account_type)));
      setOverlayAccounts(accts);
      setOverlays(ovs);
      if(autoGen){
        // Silently regenerate CC/loan overlays for the next 30 days
        try{
          const r=await apiFetch('/cash-flow-overlays/generate',{method:'POST'});
          if(r.created>0){
            const fresh=await apiFetch('/cash-flow-overlays').catch(()=>ovs);
            setOverlays(fresh);
            toast(`⚡ Auto-refreshed ${r.created} upcoming payment${r.created!==1?'s':''}`);
          }
        }catch(_){}
      }
    }catch(e){toast('Failed to load','error');}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{load(true);},[load,refreshKey]);

  // ── Load 6-month trend for chart (cash accounts only via /cash-flow) ──
  useEffect(()=>{
    (async()=>{
      try{
        const now=new Date();const months=[];
        for(let i=5;i>=0;i--){
          const d=new Date(now.getFullYear(),now.getMonth()-i,1);
          const y=d.getFullYear(),m=d.getMonth()+1;
          const start=`${y}-${String(m).padStart(2,'0')}-01`;
          const lastDay=new Date(y,m,0).getDate();
          const end=`${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
          months.push({year:y,month:m,label:d.toLocaleDateString('en-US',{month:'short'}),start,end});
        }
        const results=await Promise.all(months.map(m=>
          apiFetch(`/cash-flow?start_date=${m.start}&end_date=${m.end}`).catch(()=>({inflows:0,outflows:0}))
        ));
        setMonthlyTrend(months.map((m,i)=>({label:m.label,income:results[i].inflows||0,expenses:Math.abs(results[i].outflows||0)})));
      }catch(_){}
    })();
  },[]);

  // ── Load breakdown data based on selected range (cash accounts only) ──
  useEffect(()=>{
    (async()=>{
      setBdLoading(true);
      try{
        const now=new Date();const todayS=todayStr();
        let startD,endD;
        if(breakdownRange==='month'){
          const y=now.getFullYear(),m=now.getMonth()+1;
          startD=`${y}-${String(m).padStart(2,'0')}-01`;
          const lastDay=new Date(y,m,0).getDate();
          endD=`${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
        }else if(breakdownRange==='last30'){
          const d30ago=new Date(now);d30ago.setDate(d30ago.getDate()-30);
          startD=d30ago.toISOString().slice(0,10);
          endD=todayS;
        }else{
          // next30: use overlays + salary data, not cash-flow endpoint
          const d30=new Date(now);d30.setDate(d30.getDate()+30);
          const futEnd=d30.toISOString().slice(0,10);
          const fOvs=overlays.filter(o=>o.flow_date>=todayS&&o.flow_date<=futEnd);
          const fSals=salaryPayments.filter(sp=>sp.payment_date>=todayS&&sp.payment_date<=futEnd);
          const incCats={};const expCats={};let tIn=0,tOut=0;
          fSals.forEach(sp=>{const amt=spTotal(sp);tIn+=amt;const k=sp.description||'Salary';incCats[k]=(incCats[k]||0)+amt;});
          fOvs.forEach(o=>{
            if(o.amount>0){tIn+=o.amount;const k=o.description||'Other';incCats[k]=(incCats[k]||0)+o.amount;}
            else{const amt=Math.abs(o.amount);tOut+=amt;const k=o.description||'Other';expCats[k]=(expCats[k]||0)+amt;}
          });
          setBdData({income:incCats,expenses:expCats,totalIn:tIn,totalOut:tOut});
          setBdLoading(false);
          return;
        }
        const cf=await apiFetch(`/cash-flow?start_date=${startD}&end_date=${endD}`);
        setBdData({
          income:cf.by_inflow||{},
          expenses:cf.by_outflow||{},
          totalIn:cf.inflows||0,
          totalOut:Math.abs(cf.outflows||0),
        });
      }catch(_){setBdData({income:{},expenses:{},totalIn:0,totalOut:0});}
      finally{setBdLoading(false);}
    })();
  },[breakdownRange,overlays,salaryPayments]);

  // ── Salary helpers ────────────────────────────────────────────────────
  const openAddSalary=()=>{setEditingSalary(null);setSalaryForm(blankSF());setShowSalaryForm(true);};
  const openEditSalary=sp=>{
    setEditingSalary(sp);
    const allocs={};
    sp.allocations.forEach(a=>{allocs[a.account_id]=String(a.amount);});
    // Edit mode always has exactly one date (the record's own date)
    setSalaryForm({payment_dates:[sp.payment_date],description:sp.description,person:sp.person,allocations:allocs});
    setShowSalaryForm(true);
  };
  // Helpers for the multi-date picker (add mode only)
  const addDate=()=>setSalaryForm(f=>({...f,payment_dates:[...f.payment_dates,'']}));
  const removeDate=i=>setSalaryForm(f=>({...f,payment_dates:f.payment_dates.filter((_,idx)=>idx!==i)}));
  const setDate=(i,v)=>setSalaryForm(f=>{const d=[...f.payment_dates];d[i]=v;return{...f,payment_dates:d};});

  const saveSalary=async()=>{
    const validDates=[...new Set(salaryForm.payment_dates.filter(d=>!!d))].sort();
    if(validDates.length===0||!salaryForm.description||!salaryForm.person)
      return toast('Fill in at least one date, description, and person','error');
    const allocations=Object.entries(salaryForm.allocations)
      .filter(([,v])=>v&&parseFloat(v)!==0)
      .map(([account_id,amount])=>({account_id:parseInt(account_id),amount:parseFloat(amount)}));
    if(allocations.length===0)return toast('Enter at least one account amount','error');
    setSalarySaving(true);
    try{
      if(editingSalary){
        // Edit: patch the single existing record
        const body={payment_date:validDates[0],description:salaryForm.description,person:salaryForm.person,allocations};
        const u=await apiFetch(`/salary-payments/${editingSalary.id}`,{method:'PATCH',body:JSON.stringify(body)});
        setSalaryPayments(prev=>prev.map(p=>p.id===u.id?u:p));
        toast('Saved');
      }else{
        // Add: create one record per selected date (parallel)
        const results=await Promise.all(validDates.map(d=>
          apiFetch('/salary-payments',{method:'POST',body:JSON.stringify({payment_date:d,description:salaryForm.description,person:salaryForm.person,allocations})})
        ));
        setSalaryPayments(prev=>[...prev,...results].sort((a,b)=>b.payment_date.localeCompare(a.payment_date)));
        toast(`Created ${results.length} entr${results.length===1?'y':'ies'}`);
      }
      setShowSalaryForm(false);
    }catch(e){toast('Save failed','error');}
    finally{setSalarySaving(false);}
  };
  const deleteSalary=id=>{
    setCm({
      title:'Delete Salary Entry',
      body:'This salary entry will be permanently deleted.',
      confirmLabel:'Delete',danger:true,
      onConfirm:async()=>{
        try{
          await apiFetch(`/salary-payments/${id}`,{method:'DELETE'});
          setSalaryPayments(prev=>prev.filter(p=>p.id!==id));
          toast('Deleted');
        }catch(e){toast('Delete failed','error');}
      }
    });
  };
  const spTotal=sp=>sp.allocations.reduce((s,a)=>s+a.amount,0);

  // ── Frequency date generator ──────────────────────────────────────────
  const genFreqDates=(freq,cfg)=>{
    const out=[];
    const now=new Date();
    const end=new Date(now.getFullYear(),now.getMonth()+( cfg.monthsAhead||3),now.getDate());
    if(freq==='weekly'||freq==='biweekly'){
      const step=freq==='weekly'?7:14;
      let d=new Date(cfg.startDate||todayStr());
      while(d<=end){out.push(d.toISOString().slice(0,10));d=new Date(d);d.setDate(d.getDate()+step);}
    }else if(freq==='semimonthly'){
      let d=new Date(now.getFullYear(),now.getMonth(),1);
      while(d<=end){
        const yr=d.getFullYear(),mo=d.getMonth();
        const lastD=new Date(yr,mo+1,0).getDate();
        const d1=Math.min(cfg.day1||15,lastD);
        const d2=cfg.day2===0?lastD:Math.min(cfg.day2||lastD,lastD);
        const dt1=new Date(yr,mo,d1);if(dt1>=now&&dt1<=end)out.push(dt1.toISOString().slice(0,10));
        if(d1!==d2){const dt2=new Date(yr,mo,d2);if(dt2>=now&&dt2<=end)out.push(dt2.toISOString().slice(0,10));}
        d=new Date(yr,mo+1,1);
      }
    }else if(freq==='monthly'){
      let d=new Date(now.getFullYear(),now.getMonth(),1);
      while(d<=end){
        const yr=d.getFullYear(),mo=d.getMonth();
        const lastD=new Date(yr,mo+1,0).getDate();
        const day=cfg.day1===0?lastD:Math.min(cfg.day1||1,lastD);
        const dt=new Date(yr,mo,day);if(dt>=now&&dt<=end)out.push(dt.toISOString().slice(0,10));
        d=new Date(yr,mo+1,1);
      }
    }
    return[...new Set(out)].sort();
  };

  // ── Multi-select helpers ──────────────────────────────────────────────
  const toggleSalSel=id=>setSalSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAllSal=()=>setSalSel(s=>s.size===salaryPayments.length?new Set():new Set(salaryPayments.map(p=>p.id)));
  const deleteSelectedSalary=()=>{
    const ids=[...salSel];
    if(!ids.length)return;
    setCm({title:`Delete ${ids.length} Salary Entr${ids.length===1?'y':'ies'}`,body:`${ids.length} salary entr${ids.length===1?'y':'ies'} will be permanently deleted.`,confirmLabel:'Delete All',danger:true,
      onConfirm:async()=>{
        try{
          await Promise.all(ids.map(id=>apiFetch(`/salary-payments/${id}`,{method:'DELETE'})));
          setSalaryPayments(prev=>prev.filter(p=>!salSel.has(p.id)));
          setSalSel(new Set());
          toast(`Deleted ${ids.length} entr${ids.length===1?'y':'ies'}`);
        }catch(e){toast('Delete failed','error');}
      }
    });
  };
  const toggleOvSel=id=>setOvSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAllOv=()=>setOvSel(s=>s.size===overlays.length?new Set():new Set(overlays.map(o=>o.id)));
  const deleteSelectedOverlays=()=>{
    const ids=[...ovSel];
    if(!ids.length)return;
    setCm({title:`Delete ${ids.length} Entr${ids.length===1?'y':'ies'}`,body:`${ids.length} cash flow entr${ids.length===1?'y':'ies'} will be permanently deleted.`,confirmLabel:'Delete All',danger:true,
      onConfirm:async()=>{
        try{
          await Promise.all(ids.map(id=>apiFetch(`/cash-flow-overlays/${id}`,{method:'DELETE'})));
          setOverlays(prev=>prev.filter(o=>!ovSel.has(o.id)));
          setOvSel(new Set());
          toast(`Deleted ${ids.length} entr${ids.length===1?'y':'ies'}`);
        }catch(e){toast('Delete failed','error');}
      }
    });
  };

  // ── Overlay helpers ───────────────────────────────────────────────────
  const BLANK_OV={description:'',amount:'',flow_date:todayStr(),source:'manual',account_id:''};
  const SOURCE_BADGE={manual:{label:'Manual',bg:'rgba(var(--blue-primary-rgb), 0.12)',color:'var(--blue-primary)'},cc_payment:{label:'CC',bg:'rgba(248,113,113,0.12)',color:'var(--red)'},loan_payment:{label:'Loan',bg:'rgba(139,92,246,0.12)',color:'var(--violet)'}};
  const openAddOverlay=()=>{setEditingOverlay(null);setOvForm(BLANK_OV);setShowOverlayForm(true);};
  const openEditOverlay=o=>{
    setEditingOverlay(o);
    setOvForm({description:o.description,amount:String(o.amount),flow_date:o.flow_date,source:o.source,account_id:String(o.account_id||'')});
    setShowOverlayForm(true);
  };
  const saveOverlay=async()=>{
    if(!ovForm.description||!ovForm.amount||!ovForm.flow_date)return toast('Fill in description, amount, and date','error');
    setOvSaving(true);
    try{
      const body={description:ovForm.description,amount:parseFloat(ovForm.amount),flow_date:ovForm.flow_date,source:ovForm.source,account_id:ovForm.account_id?parseInt(ovForm.account_id):null};
      if(editingOverlay){
        const u=await apiFetch(`/cash-flow-overlays/${editingOverlay.id}`,{method:'PATCH',body:JSON.stringify(body)});
        setOverlays(prev=>prev.map(o=>o.id===u.id?u:o));
      }else{
        const c=await apiFetch('/cash-flow-overlays',{method:'POST',body:JSON.stringify(body)});
        setOverlays(prev=>[...prev,c].sort((a,b)=>a.flow_date.localeCompare(b.flow_date)));
      }
      setShowOverlayForm(false);toast('Saved');
    }catch(e){toast('Save failed','error');}
    finally{setOvSaving(false);}
  };
  const deleteOverlay=id=>{
    setCm({
      title:'Delete Cash Flow Entry',
      body:'This cash flow entry will be permanently deleted.',
      confirmLabel:'Delete',danger:true,
      onConfirm:async()=>{
        try{
          await apiFetch(`/cash-flow-overlays/${id}`,{method:'DELETE'});
          setOverlays(prev=>prev.filter(o=>o.id!==id));
          toast('Deleted');
        }catch(e){toast('Delete failed','error');}
      }
    });
  };
  const generateOverlays=async()=>{
    setGenBusy(true);
    try{
      const r=await apiFetch('/cash-flow-overlays/generate',{method:'POST'});
      toast(`⚡ Generated ${r.created} entr${r.created!==1?'ies':'y'}${r.skipped?`, ${r.skipped} already existed`:''}`);
      setOverlays(await apiFetch('/cash-flow-overlays'));
    }catch(e){toast('Generate failed','error');}
    finally{setGenBusy(false);}
  };

  const INP={border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:13,fontWeight:300,fontFamily:'Plus Jakarta Sans, sans-serif',background:'var(--elevated)',color:'var(--text-primary)',outline:'none'};

  if(loading)return<SkeletonTable rows={6}/>;

  const today=todayStr();
  const futureOvs=overlays.filter(o=>o.flow_date>=today);
  const futureSals=salaryPayments.filter(sp=>sp.payment_date>=today).sort((a,b)=>a.payment_date.localeCompare(b.payment_date));
  const ovUpIn=futureOvs.filter(o=>o.amount>0).reduce((s,o)=>s+o.amount,0);
  const ovUpOut=futureOvs.filter(o=>o.amount<0).reduce((s,o)=>s+o.amount,0);
  const salUpIn=futureSals.reduce((s,sp)=>s+spTotal(sp),0);
  const totalUpIn=ovUpIn+salUpIn;
  const netCF=totalUpIn+ovUpOut;
  const nextPayEntry=futureSals[0]||null;

  return(
    <div>
      {cm&&<ConfirmModal {...cm} onClose={()=>setCm(null)}/>}

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div className="metric-grid grid-4" style={{marginBottom:24}}>
        <div className="card metric-card">
          <div className="metric-label">Upcoming Income</div>
          <div className="metric-value" style={{color:'var(--green)'}}>+{fmt(totalUpIn)}</div>
          <div className="metric-sub"><span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>salary + one-time</span></div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Upcoming Outflows</div>
          <div className="metric-value" style={{color:'var(--red)'}}>({fmt(Math.abs(ovUpOut))})</div>
          <div className="metric-sub"><span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>bills & payments</span></div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Net Cash Flow</div>
          <div className="metric-value" style={{color:netCF>=0?'var(--blue-primary)':'var(--red)'}}>{netCF>=0?'+':''}{netCF<0?`(${fmt(Math.abs(netCF))})`:fmt(netCF)}</div>
          <div className="metric-sub"><span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>income − outflows</span></div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Next Pay Date</div>
          <div className="metric-value" style={{fontSize:18,fontFamily:'Plus Jakarta Sans'}}>{nextPayEntry?nextPayEntry.payment_date:'—'}</div>
          {nextPayEntry&&<div className="metric-sub"><span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>+{fmt(spTotal(nextPayEntry))} · {nextPayEntry.person}</span></div>}
        </div>
      </div>

      {/* ── Monthly Cash Flow Chart ────────────────────────────────────────── */}
      {monthlyTrend.length>0&&(()=>{
        const maxVal=Math.max(...monthlyTrend.map(m=>Math.max(m.income,m.expenses)),1);
        const chartH=160;
        return(
          <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px',marginBottom:16}}>Monthly Cash Flow — Last 6 Months</div>
            <div style={{display:'flex',alignItems:'flex-end',gap:8,height:chartH,paddingBottom:24,position:'relative'}}>
              {/* Horizontal grid lines */}
              {[0.25,0.5,0.75,1].map(pct=>(
                <div key={pct} style={{position:'absolute',left:0,right:0,bottom:24+(chartH-24)*pct,height:1,background:'var(--border)',pointerEvents:'none'}}/>
              ))}
              {monthlyTrend.map((m,i)=>{
                const incH=Math.max(2,m.income/maxVal*(chartH-24));
                const expH=Math.max(2,m.expenses/maxVal*(chartH-24));
                const net=m.income-m.expenses;
                return(
                  <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:0,position:'relative'}}>
                    <div style={{display:'flex',gap:3,alignItems:'flex-end',flex:1,width:'100%',justifyContent:'center'}}>
                      <div title={`Income: ${fmt(m.income)}`} style={{width:'38%',maxWidth:28,height:incH,background:'var(--green)',borderRadius:'4px 4px 0 0',opacity:0.85,transition:'height 0.4s ease'}}/>
                      <div title={`Expenses: ${fmt(m.expenses)}`} style={{width:'38%',maxWidth:28,height:expH,background:'var(--red)',borderRadius:'4px 4px 0 0',opacity:0.85,transition:'height 0.4s ease'}}/>
                    </div>
                    <div style={{fontSize:10,color:'var(--text-muted)',marginTop:6,fontWeight:400}}>{m.label}</div>
                    <div style={{fontSize:9,color:net>=0?'var(--green)':'var(--red)',fontWeight:500,fontFamily:'Plus Jakarta Sans'}}>{net>=0?'+':''}{net<0?`(${fmt(Math.abs(net))})`:fmt(net)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{display:'flex',gap:20,justifyContent:'center',marginTop:8}}>
              <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--text-muted)'}}><div style={{width:10,height:10,borderRadius:2,background:'var(--green)',opacity:0.85}}/> Income</div>
              <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--text-muted)'}}><div style={{width:10,height:10,borderRadius:2,background:'var(--red)',opacity:0.85}}/> Expenses</div>
            </div>
          </div>
        );
      })()}

      {/* ── Income & Expense Breakdowns ─────────────────────────────────────── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
        {/* Range toggle — spans both columns */}
        <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px'}}>Breakdown</div>
          <div style={{display:'flex',gap:16}}>
            {[['month','This Month'],['last30','Last 30 Days'],['next30','Next 30 Days']].map(([k,label])=>(
              <button type="button" key={k} onClick={()=>setBreakdownRange(k)}
                style={{padding:'4px 0',border:'none',borderBottom:breakdownRange===k?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:12,fontWeight:breakdownRange===k?500:400,
                  background:'transparent',color:breakdownRange===k?'var(--blue-primary)':'var(--text-muted)',
                  transition:'all 0.15s',fontFamily:'inherit',letterSpacing:'0.2px'}}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Income sources */}
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20}}>
          <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px',marginBottom:14}}>Income Sources</div>
          {bdLoading?<div style={{textAlign:'center',padding:20,color:'var(--text-muted)',fontSize:12}}>Loading…</div>
          :Object.keys(breakdownData.income).length===0?<div style={{textAlign:'center',padding:20,color:'var(--text-muted)',fontSize:12}}>No income data</div>
          :<div style={{display:'flex',flexDirection:'column',gap:10}}>
            {Object.entries(breakdownData.income).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([cat,amt])=>{
              const pct=breakdownData.totalIn>0?amt/breakdownData.totalIn*100:0;
              return(
                <div key={cat}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4}}>
                    <span style={{fontSize:12,fontWeight:400,color:'var(--text-primary)'}}>{cat}</span>
                    <span style={{fontSize:12,fontWeight:400,fontFamily:'Plus Jakarta Sans',color:'var(--green)'}}>+{fmt(amt)}</span>
                  </div>
                  <div style={{height:6,background:'var(--elevated)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${Math.min(pct,100)}%`,background:'var(--green)',borderRadius:3,opacity:0.7,transition:'width 0.4s ease'}}/>
                  </div>
                </div>
              );
            })}
            <div style={{borderTop:'1px solid var(--border)',paddingTop:8,display:'flex',justifyContent:'space-between',fontSize:13,fontWeight:500}}>
              <span style={{color:'var(--text-muted)'}}>Total</span>
              <span style={{color:'var(--green)',fontFamily:'Plus Jakarta Sans'}}>+{fmt(breakdownData.totalIn)}</span>
            </div>
          </div>}
        </div>

        {/* Top expenses */}
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20}}>
          <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px',marginBottom:14}}>Top Expenses</div>
          {bdLoading?<div style={{textAlign:'center',padding:20,color:'var(--text-muted)',fontSize:12}}>Loading…</div>
          :Object.keys(breakdownData.expenses).length===0?<div style={{textAlign:'center',padding:20,color:'var(--text-muted)',fontSize:12}}>No expense data</div>
          :<div style={{display:'flex',flexDirection:'column',gap:10}}>
            {Object.entries(breakdownData.expenses).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([cat,amt])=>{
              const pct=breakdownData.totalOut>0?amt/breakdownData.totalOut*100:0;
              return(
                <div key={cat}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4}}>
                    <span style={{fontSize:12,fontWeight:400,color:'var(--text-primary)'}}>{cat}</span>
                    <span style={{fontSize:12,fontWeight:400,fontFamily:'Plus Jakarta Sans',color:'var(--red)'}}>{fmt(amt)}</span>
                  </div>
                  <div style={{height:6,background:'var(--elevated)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${Math.min(pct,100)}%`,background:'var(--red)',borderRadius:3,opacity:0.7,transition:'width 0.4s ease'}}/>
                  </div>
                </div>
              );
            })}
            <div style={{borderTop:'1px solid var(--border)',paddingTop:8,display:'flex',justifyContent:'space-between',fontSize:13,fontWeight:500}}>
              <span style={{color:'var(--text-muted)'}}>Total</span>
              <span style={{color:'var(--red)',fontFamily:'Plus Jakarta Sans'}}>{fmt(breakdownData.totalOut)}</span>
            </div>
          </div>}
        </div>
      </div>

      {/* ── Predicted Flows (existing) ─ divider ───────────────────────────── */}
      <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px',marginBottom:16,marginTop:8}}>Predicted Cash Flows</div>

      {/* ── Salary modal ───────────────────────────────────────────────────── */}
      {showSalaryForm&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:28,minWidth:520,maxWidth:720,width:'90%',maxHeight:'85vh',overflowY:'auto',boxShadow:'var(--shadow-md)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontWeight:400,fontSize:16,letterSpacing:'-0.2px'}}>{editingSalary?'Edit Salary Payment':'New Salary Payment'}</div>
              <button type="button" onClick={()=>setShowSalaryForm(false)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--text-muted)',lineHeight:1,padding:0}}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Description</label>
                <input value={salaryForm.description} onChange={e=>setSalaryForm(f=>({...f,description:e.target.value}))} placeholder="Salary, HSA Contribution…" style={INP}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Person</label>
                <input value={salaryForm.person} onChange={e=>setSalaryForm(f=>({...f,person:e.target.value}))} placeholder="Omer, Daniella…" style={INP}/>
              </div>
            </div>
            {/* ── Frequency picker (add mode only) ── */}
            {!editingSalary&&(
              <div style={{marginBottom:16}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:8}}>Frequency</label>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {[['','One-time'],['weekly','Weekly'],['biweekly','Bi-weekly'],['semimonthly','Semi-monthly'],['monthly','Monthly']].map(([f,label])=>(
                    <button key={f} type="button" onClick={()=>{
                      if(f===''){setSalaryForm(sf=>({...sf,frequency:'',payment_dates:[todayStr()]}));}
                      else{setSalaryForm(sf=>{const dates=genFreqDates(f,sf.freqConfig);return{...sf,frequency:f,payment_dates:dates.length?dates:[todayStr()]};});}
                    }} style={{padding:'4px 12px',borderRadius:20,fontSize:12,fontWeight:500,cursor:'pointer',border:'1.5px solid',borderColor:salaryForm.frequency===f?'var(--primary)':'var(--border)',background:salaryForm.frequency===f?'var(--primary)':'transparent',color:salaryForm.frequency===f?'#fff':'var(--text-secondary)'}}>
                      {label}
                    </button>
                  ))}
                </div>
                {salaryForm.frequency&&(
                  <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end',marginTop:10,padding:'10px 12px',background:'var(--bg)',borderRadius:8,border:'1px solid var(--border)'}}>
                    {(salaryForm.frequency==='weekly'||salaryForm.frequency==='biweekly')&&(
                      <div style={{display:'flex',flexDirection:'column',gap:3}}>
                        <label style={{fontSize:11,color:'var(--text-muted)',fontWeight:500}}>Start date</label>
                        <input type="date" value={salaryForm.freqConfig.startDate} onChange={e=>{const cfg={...salaryForm.freqConfig,startDate:e.target.value};setSalaryForm(sf=>{const dates=genFreqDates(sf.frequency,cfg);return{...sf,freqConfig:cfg,payment_dates:dates.length?dates:[todayStr()]};});}} style={{...INP,padding:'4px 8px',fontSize:12}}/>
                      </div>
                    )}
                    {(salaryForm.frequency==='semimonthly'||salaryForm.frequency==='monthly')&&(
                      <div style={{display:'flex',flexDirection:'column',gap:3}}>
                        <label style={{fontSize:11,color:'var(--text-muted)',fontWeight:500}}>{salaryForm.frequency==='semimonthly'?'1st day of month':'Day of month'}</label>
                        <select value={salaryForm.freqConfig.day1} onChange={e=>{const cfg={...salaryForm.freqConfig,day1:parseInt(e.target.value)};setSalaryForm(sf=>{const dates=genFreqDates(sf.frequency,cfg);return{...sf,freqConfig:cfg,payment_dates:dates.length?dates:[todayStr()]};});}} style={{...INP,padding:'4px 8px',fontSize:12}}>
                          {Array.from({length:28},(_,i)=>i+1).map(d=><option key={d} value={d}>{d}</option>)}
                          <option value={0}>Last day</option>
                        </select>
                      </div>
                    )}
                    {salaryForm.frequency==='semimonthly'&&(
                      <div style={{display:'flex',flexDirection:'column',gap:3}}>
                        <label style={{fontSize:11,color:'var(--text-muted)',fontWeight:500}}>2nd day of month</label>
                        <select value={salaryForm.freqConfig.day2} onChange={e=>{const cfg={...salaryForm.freqConfig,day2:parseInt(e.target.value)};setSalaryForm(sf=>{const dates=genFreqDates(sf.frequency,cfg);return{...sf,freqConfig:cfg,payment_dates:dates.length?dates:[todayStr()]};});}} style={{...INP,padding:'4px 8px',fontSize:12}}>
                          {Array.from({length:28},(_,i)=>i+1).map(d=><option key={d} value={d}>{d}</option>)}
                          <option value={0}>Last day</option>
                        </select>
                      </div>
                    )}
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <label style={{fontSize:11,color:'var(--text-muted)',fontWeight:500}}>Months ahead</label>
                      <select value={salaryForm.freqConfig.monthsAhead} onChange={e=>{const cfg={...salaryForm.freqConfig,monthsAhead:parseInt(e.target.value)};setSalaryForm(sf=>{const dates=genFreqDates(sf.frequency,cfg);return{...sf,freqConfig:cfg,payment_dates:dates.length?dates:[todayStr()]};});}} style={{...INP,padding:'4px 8px',fontSize:12}}>
                        {[1,2,3,6,12].map(m=><option key={m} value={m}>{m} mo</option>)}
                      </select>
                    </div>
                    <div style={{fontSize:12,color:'var(--text-muted)',alignSelf:'center',paddingBottom:2}}>
                      → <strong style={{color:'var(--text-primary)'}}>{salaryForm.payment_dates.filter(d=>d).length}</strong> pay dates
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* ── Pay date(s) ── */}
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>{editingSalary?'Pay Date':'Pay Dates'}</label>
                {!editingSalary&&!salaryForm.frequency&&<button type="button" className="btn btn-sm btn-ghost" style={{padding:'2px 10px',fontSize:11}} onClick={addDate}>＋ Add Date</button>}
              </div>
              {(!editingSalary&&salaryForm.frequency)?(
                <div style={{fontSize:12,color:'var(--text-muted)',background:'var(--bg)',borderRadius:6,padding:'6px 10px'}}>
                  {salaryForm.payment_dates.filter(d=>d).length} dates will be created &mdash; {salaryForm.payment_dates[0]} through {salaryForm.payment_dates[salaryForm.payment_dates.length-1]}
                </div>
              ):(
                <>
                  <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                    {salaryForm.payment_dates.map((d,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'center',gap:4}}>
                        <input type="date" value={d} onChange={e=>setDate(i,e.target.value)} style={{...INP,padding:'5px 8px'}}/>
                        {!editingSalary&&salaryForm.payment_dates.length>1&&(
                          <button type="button" onClick={()=>removeDate(i)} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text-muted)',lineHeight:1,padding:'0 2px'}}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {!editingSalary&&salaryForm.payment_dates.filter(d=>d).length>1&&(
                    <div style={{fontSize:11,color:'var(--text-muted)',marginTop:6}}>
                      Will create <strong>{[...new Set(salaryForm.payment_dates.filter(d=>d))].length}</strong> separate entr{[...new Set(salaryForm.payment_dates.filter(d=>d))].length===1?'y':'ies'}.
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:10}}>Deposit Amounts Per Account</label>
              {salaryAccounts.length===0
                ?<div style={{fontSize:12,color:'var(--text-muted)',background:'var(--bg)',borderRadius:8,padding:'10px 14px'}}>No eligible accounts (add Checking / Savings / HSA / FSA / Investment accounts first).</div>
                :<div className="grid-auto-sm" style={{gap:10}}>
                  {salaryAccounts.map(a=>(
                    <div key={a.id} style={{display:'flex',flexDirection:'column',gap:3}}>
                      <label style={{fontSize:11,color:'var(--text-secondary)',fontWeight:500}}>{a.account_name} <span style={{opacity:0.55,fontSize:10}}>({fmtAcctType(a.account_type)})</span></label>
                      <input type="number" step="0.01" min="0" value={salaryForm.allocations[a.id]||''} onChange={e=>setSalaryForm(f=>({...f,allocations:{...f.allocations,[a.id]:e.target.value}}))} placeholder="0.00" style={{...INP,padding:'5px 8px'}}/>
                    </div>
                  ))}
                </div>
              }
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)',paddingTop:16}}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setShowSalaryForm(false)}>Cancel</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={saveSalary} disabled={salarySaving}>{salarySaving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Overlay modal ──────────────────────────────────────────────────── */}
      {showOverlayForm&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:28,minWidth:420,maxWidth:560,width:'90%',boxShadow:'var(--shadow-md)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontWeight:400,fontSize:16,letterSpacing:'-0.2px'}}>{editingOverlay?'Edit Cash Flow Entry':'New Cash Flow Entry'}</div>
              <button type="button" onClick={()=>setShowOverlayForm(false)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--text-muted)',lineHeight:1,padding:0}}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
              <div style={{gridColumn:'1/-1',display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Description</label>
                <input value={ovForm.description} onChange={e=>setOvForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Tax Refund, Chase Payment…" style={INP}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Amount <span style={{fontWeight:400,opacity:0.7,textTransform:'none'}}>(– outflow, + inflow)</span></label>
                <input type="number" step="0.01" value={ovForm.amount} onChange={e=>setOvForm(f=>({...f,amount:e.target.value}))} placeholder="-1500.00" style={INP}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Date</label>
                <input type="date" value={ovForm.flow_date} onChange={e=>setOvForm(f=>({...f,flow_date:e.target.value}))} style={INP}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Source</label>
                <select value={ovForm.source} onChange={e=>setOvForm(f=>({...f,source:e.target.value}))} style={INP}>
                  <option value="manual">Manual</option>
                  <option value="cc_payment">CC Payment</option>
                  <option value="loan_payment">Loan Payment</option>
                </select>
              </div>
              <div style={{gridColumn:'1/-1',display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Account <span style={{fontWeight:400,opacity:0.7,textTransform:'none'}}>(optional)</span></label>
                <select value={ovForm.account_id} onChange={e=>setOvForm(f=>({...f,account_id:e.target.value}))} style={INP}>
                  <option value="">— None —</option>
                  {overlayAccounts.filter(a=>a.is_active).map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)}
                </select>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)',paddingTop:16}}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setShowOverlayForm(false)}>Cancel</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={saveOverlay} disabled={ovSaving}>{ovSaving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Salary & Income card ───────────────────────────────────────────── */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,overflow:'hidden',marginBottom:20}}>
        <div style={{padding:'18px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px'}}>Salary & Income</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {salSel.size>0&&<button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)'}} onClick={deleteSelectedSalary}>Delete Selected ({salSel.size})</button>}
            <button type="button" className="btn btn-sm btn-primary" onClick={openAddSalary}>+ Add Payment</button>
          </div>
        </div>
        {salaryPayments.length===0
          ?<div style={{textAlign:'center',padding:'28px 0',color:'var(--text-muted)',fontSize:13}}>No salary entries yet — click <strong>+ Add Payment</strong> to add a pay date.</div>
          :<div className="table-wrap"><table style={{fontSize:13}}>
            <thead><tr>
              <th style={{width:32,textAlign:'center'}}><input type="checkbox" checked={salSel.size>0&&salSel.size===salaryPayments.length} onChange={toggleAllSal} style={{cursor:'pointer'}}/></th>
              <th style={{minWidth:100}}>Date</th>
              <th>Description</th>
              <th>Person</th>
              {salaryAccounts.map(a=>(
                <th key={a.id} style={{textAlign:'right',minWidth:110,maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={`${a.account_name} (${fmtAcctType(a.account_type)})`}>{a.account_name}</th>
              ))}
              <th style={{textAlign:'right',minWidth:100}}>Total</th>
              <th style={{textAlign:'center'}}>Actions</th>
            </tr></thead>
            <tbody>{salaryPayments.map(sp=>{
              const allocMap={};
              sp.allocations.forEach(a=>{allocMap[a.account_id]=a.amount;});
              const isPast=sp.payment_date<today;
              return(
                <tr key={sp.id} style={{opacity:isPast?0.5:1,background:isPast?'var(--elevated)':'transparent'}}>
                  <td style={{textAlign:'center'}}><input type="checkbox" checked={salSel.has(sp.id)} onChange={()=>toggleSalSel(sp.id)} style={{cursor:'pointer'}}/></td>
                  <td style={{fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:300,whiteSpace:'nowrap',color:isPast?'var(--text-muted)':'var(--text-primary)'}}>{sp.payment_date}</td>
                  <td style={{fontWeight:300}}>{sp.description}</td>
                  <td><span style={{display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:400,background:'rgba(52,211,153,0.12)',color:'var(--green)'}}>{sp.person}</span></td>
                  {salaryAccounts.map(a=>{
                    const amt=allocMap[a.id];
                    return<td key={a.id} style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,color:amt?'var(--green)':'var(--text-muted)'}}>{amt?'+$'+amt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>;
                  })}
                  <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontWeight:400,color:'var(--green)'}}>+${spTotal(sp).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                  <td style={{textAlign:'center'}}>
                    <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                      <button type="button" className="btn btn-sm btn-ghost" style={{padding:'2px 8px',fontSize:11}} onClick={()=>openEditSalary(sp)}>Edit</button>
                      <button type="button" className="btn btn-sm btn-ghost" style={{padding:'2px 8px',fontSize:11,color:'var(--red)'}} onClick={()=>deleteSalary(sp.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        }
      </div>

      {/* ── Expected Outflows & One-Time Income card ───────────────────────── */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,overflow:'hidden'}}>
        <div style={{padding:'18px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px'}}>Expected Outflows & One-Time Income</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {ovSel.size>0&&<button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)'}} onClick={deleteSelectedOverlays}>Delete Selected ({ovSel.size})</button>}
            <button type="button" className="btn btn-sm btn-secondary" onClick={generateOverlays} disabled={genBusy} title="Auto-create entries from credit card and loan payment schedules">
              {genBusy?'Generating…':'Generate from Cards & Loans'}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={openAddOverlay}>+ Add</button>
          </div>
        </div>
        {overlays.length===0
          ?<div style={{textAlign:'center',padding:'28px 0',color:'var(--text-muted)',fontSize:13}}>No entries yet — add one manually or click <strong>Generate from Cards &amp; Loans</strong>.</div>
          :<div className="table-wrap">
            <table style={{fontSize:13}}>
              <thead><tr>
                <th style={{width:32,textAlign:'center'}}><input type="checkbox" checked={ovSel.size>0&&ovSel.size===overlays.length} onChange={toggleAllOv} style={{cursor:'pointer'}}/></th>
                <th style={{minWidth:90}}>Date</th>
                <th>Description</th>
                <th style={{textAlign:'right',minWidth:100}}>Amount</th>
                <th>Account</th>
                <th>Source</th>
                <th style={{textAlign:'center'}}>Actions</th>
              </tr></thead>
              <tbody>{overlays.map(o=>{
                const badge=SOURCE_BADGE[o.source]||SOURCE_BADGE.manual;
                const isOut=o.amount<0;
                const isPast=o.flow_date<today;
                return(
                  <tr key={o.id} style={{opacity:isPast?0.5:1,background:isPast?'var(--elevated)':'transparent'}}>
                    <td style={{textAlign:'center'}}><input type="checkbox" checked={ovSel.has(o.id)} onChange={()=>toggleOvSel(o.id)} style={{cursor:'pointer'}}/></td>
                    <td style={{fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:300,whiteSpace:'nowrap',color:isPast?'var(--text-muted)':'var(--text-primary)'}}>{o.flow_date}</td>
                    <td style={{fontWeight:300}}>{o.description}</td>
                    <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontWeight:300,color:isOut?'var(--red)':'var(--green)',whiteSpace:'nowrap'}}>
                      {isOut?'(':'+'}{isOut?'':'$'}{Math.abs(o.amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}{isOut?')':''}
                    </td>
                    <td style={{color:'var(--text-muted)',fontSize:12}}>{o.account_name||'—'}</td>
                    <td><span style={{display:'inline-block',padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:500,background:badge.bg,color:badge.color}}>{badge.label}</span></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button type="button" className="btn btn-sm btn-ghost" style={{padding:'2px 8px',fontSize:11}} onClick={()=>openEditOverlay(o)}>Edit</button>
                        <button type="button" className="btn btn-sm btn-ghost" style={{padding:'2px 8px',fontSize:11,color:'var(--red)'}} onClick={()=>deleteOverlay(o.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
            {overlays.length>0&&(()=>{
              const net=ovUpIn+ovUpOut;
              return(
                <div style={{display:'flex',gap:28,padding:'10px 18px',borderTop:'1px solid var(--border)',background:'var(--elevated)',fontSize:12,fontWeight:300,color:'var(--text-muted)'}}>
                  <span>Upcoming inflows: <span style={{color:'var(--green)',fontFamily:'Plus Jakarta Sans',fontWeight:400}}>+{fmt(ovUpIn)}</span></span>
                  <span>Outflows: <span style={{color:'var(--red)',fontFamily:'Plus Jakarta Sans',fontWeight:400}}>({fmt(Math.abs(ovUpOut))})</span></span>
                  <span>Net: <span style={{color:net>=0?'var(--blue-primary)':'var(--red)',fontFamily:'Plus Jakarta Sans',fontWeight:400}}>{net>=0?'+':''}{net<0?`(${fmt(Math.abs(net))})`:fmt(net)}</span></span>
                </div>
              );
            })()}
          </div>
        }
      </div>
    </div>
  );
}

/* ── Reconciliation Panel ──────────────────────────────────────────────── */
