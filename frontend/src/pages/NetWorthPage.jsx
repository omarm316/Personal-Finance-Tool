import {useState,useEffect,useCallback} from 'react';
import {MultiSelectFilter} from '../components/MultiSelectFilter';
import {apiFetch} from '../lib/api';
import {fmt,fmtAcctType,localDateStr,todayStr} from '../lib/format';

export function NetWorthPage({toast,refreshKey}){
  /* ── shared "as of" date ─────────────────────────────────────────────── */
  const todayStr=localDateStr(new Date());
  const[asOf,setAsOf]=useState(todayStr);
  const[subTab,setSubTab]=useState('networth');   // 'networth' | 'balances'

  /* ── Net Worth tab state ─────────────────────────────────────────────── */
  const[nwData,setNwData]=useState(null);
  const[tlData,setTlData]=useState([]);
  const[nwLoading,setNwLoading]=useState(true);
  const[expanded,setExpanded]=useState({});
  /* inline edit for starting balance */
  const[editingAcct,setEditingAcct]=useState(null); // account_id
  const[editBal,setEditBal]=useState('');
  const[editDate,setEditDate]=useState('');
  const[editSaving,setEditSaving]=useState(false);

  /* ── Balances tab state ──────────────────────────────────────────────── */
  const[accounts,setAccounts]=useState([]);
  const[selectedId,setSelectedId]=useState(null);
  const[selectedAccount,setSelectedAccount]=useState(null);
  const[timeline,setTimeline]=useState(null);
  const[balLoading,setBalLoading]=useState(true);
  const[tlLoading,setTlLoading]=useState(false);
  const[error,setError]=useState('');
  /* filters */
  const[sideFilter,setSideFilter]=useState('');
  const[typeFilter,setTypeFilter]=useState(null); // null=all, Set=specific
  const[nameFilter,setNameFilter]=useState('');
  /* statement / reconcile view */
  const[stmtView,setStmtView]=useState(false);
  const[reconcileData,setReconcileData]=useState(null);
  const[reconcileLoading,setReconcileLoading]=useState(false);

  /* ── Net Worth: load data ────────────────────────────────────────────── */
  const loadNW=useCallback(async()=>{
    setNwLoading(true);setError('');
    try{
      const[nw,tl]=await Promise.all([
        apiFetch(`/net-worth?as_of=${asOf}`),
        apiFetch('/net-worth/timeline?months=12'),
      ]);
      setNwData(nw);setTlData(tl.timeline||[]);
    }catch(e){setError('Failed to load net worth');toast('Failed to load','error');}
    finally{setNwLoading(false);}
  },[asOf]);
  useEffect(()=>{loadNW();},[loadNW,refreshKey]);

  /* ── Balances: load accounts list ────────────────────────────────────── */
  const loadAccounts=useCallback(async()=>{
    setBalLoading(true);
    try{setAccounts(await apiFetch('/accounts'));}
    catch(e){setError('Failed to load accounts');}
    finally{setBalLoading(false);}
  },[]);
  useEffect(()=>{loadAccounts();},[loadAccounts,refreshKey]);

  /* ── Balances: load per-account timeline ─────────────────────────────── */
  const loadTimeline=useCallback(async(id)=>{
    setTlLoading(true);setError('');
    try{setTimeline(await apiFetch(`/accounts/${id}/balance-timeline?end=${asOf}`));}
    catch(e){setError('Failed to load balance timeline');toast('Failed to load','error');}
    finally{setTlLoading(false);}
  },[asOf]);
  useEffect(()=>{
    if(selectedId){setSelectedAccount(accounts.find(a=>a.id===selectedId)||null);loadTimeline(selectedId);}
    else{setTimeline(null);setSelectedAccount(null);}
  },[selectedId,asOf]);

  /* Fetch statement/reconcile data when account or date changes (only when stmtView is open) */
  useEffect(()=>{
    if(!selectedId||!stmtView){setReconcileData(null);return;}
    setReconcileLoading(true);
    apiFetch(`/accounts/${selectedId}/reconcile?end=${asOf}`)
      .then(d=>setReconcileData(d))
      .catch(()=>toast('Failed to load statement','error'))
      .finally(()=>setReconcileLoading(false));
  },[selectedId,stmtView,asOf]);

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const fmtBal=(v)=>v===0?'$0':(v<0?'-':'')+fmt(Math.abs(v));
  const toggleBucket=(b)=>setExpanded(prev=>({...prev,[b]:!prev[b]}));

  /* ── Starting balance inline edit ────────────────────────────────────── */
  const startEditAcct=(acct)=>{setEditingAcct(acct.account_id);setEditBal(String(Math.abs(acct.balance)));setEditDate(acct.start_date||'2025-12-31');};
  const cancelEditAcct=()=>{setEditingAcct(null);setEditBal('');setEditDate('');};
  const saveEditAcct=async(acct)=>{
    setEditSaving(true);
    try{
      // For liabilities the stored balance should be negative; user enters positive
      const isAsset=nwData?.buckets?.[Object.keys(nwData.buckets).find(k=>nwData.buckets[k].accounts.some(a=>a.account_id===acct.account_id))]?.is_asset??true;
      const amt=parseFloat(editBal)||0;
      const storedAmt=isAsset?amt:-amt;
      await apiFetch(`/accounts/${acct.account_id}`,{method:'PATCH',body:JSON.stringify({starting_balance:storedAmt,start_date:editDate})});
      toast('Starting balance saved');cancelEditAcct();loadNW();
    }catch(e){toast('Failed to save','error');}
    finally{setEditSaving(false);}
  };

  /* ══════════════════════════════════════════════════════════════════════
     NET WORTH TAB
  ══════════════════════════════════════════════════════════════════════ */
  const NW_ASSET_ORDER=['Cash & Savings','Investments','Real Estate','Other Assets'];
  const NW_LIAB_ORDER=['Mortgage','Credit Cards','Personal Loans','Business Loans','Other Liabilities'];

  const renderNWTab=()=>{
    if(nwLoading)return<div className="loading"><div className="spinner"/><span>Loading…</span></div>;
    const buckets=nwData?.buckets||{};
    const assetBuckets=NW_ASSET_ORDER.map(name=>[name,buckets[name]]).filter(([,v])=>v);
    // also include any unknown asset buckets
    Object.entries(buckets).forEach(([k,v])=>{if(v.is_asset&&!NW_ASSET_ORDER.includes(k))assetBuckets.push([k,v]);});
    const liabBuckets=NW_LIAB_ORDER.map(name=>[name,buckets[name]]).filter(([,v])=>v);
    Object.entries(buckets).forEach(([k,v])=>{if(!v.is_asset&&!NW_LIAB_ORDER.includes(k))liabBuckets.push([k,v]);});

    /* SVG timeline chart */
    const chartW=800;const chartH=160;const pad=36;
    const vals=tlData.map(d=>d.net_worth);
    const minV=vals.length?Math.min(...vals):0;const maxV=vals.length?Math.max(...vals):0;
    const rng=maxV-minV||1;
    const tlPts=tlData.map((d,i)=>{
      const x=pad+(i/(tlData.length-1||1))*(chartW-2*pad);
      const y=pad+(1-(d.net_worth-minV)/rng)*(chartH-2*pad);
      return`${x},${y}`;
    }).join(' ');

    const BucketPanel=({bucketList,isAsset})=>(
      <div>
        {bucketList.length===0&&<div className="empty" style={{padding:24}}><span>None</span></div>}
        {bucketList.map(([bucketName,bData])=>{
          const bucketTotal=bData.accounts.reduce((s,a)=>s+Math.abs(a.balance),0);
          const isExp=expanded[bucketName]!==false;
          return(
            <div key={bucketName} style={{borderBottom:'1px solid var(--border)'}}>
              {/* Bucket header row */}
              <div onClick={()=>toggleBucket(bucketName)}
                style={{padding:'10px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',background:'var(--elevated)'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:10,color:'var(--text-muted)',transform:isExp?'rotate(90deg)':'none',display:'inline-block',transition:'transform 0.15s'}}>▶</span>
                  <span style={{fontSize:13,fontWeight:400,color:'var(--text-primary)'}}>{bucketName}</span>
                  <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>({bData.accounts.length})</span>
                </div>
                <span style={{fontFamily:'Plus Jakarta Sans, sans-serif',fontSize:13,fontWeight:300,color:isAsset?'var(--green)':'var(--red)'}}>{fmtBal(bucketTotal)}</span>
              </div>
              {/* Account rows */}
              {isExp&&bData.accounts.map(a=>{
                const isEditing=editingAcct===a.account_id;
                const dispBal=Math.abs(a.balance);
                return(
                  <div key={a.account_id} style={{padding:'8px 16px 8px 40px',borderTop:'1px solid var(--border)',background:'var(--surface)'}}>
                    {isEditing?(
                      /* ── Inline edit form ── */
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <div style={{flex:1,minWidth:120}}>
                          <div style={{fontSize:12,fontWeight:400,marginBottom:2,color:'var(--text-primary)'}}>{a.account_name}{a.mask?` ···${a.mask}`:''}</div>
                          <div style={{fontSize:11,color:'var(--text-muted)'}}>{fmtAcctType(a.account_type)}</div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:11,color:'var(--text-muted)'}}>Balance $</span>
                          <input type="number" step="0.01" min="0" value={editBal} onChange={e=>setEditBal(e.target.value)}
                            style={{width:110,border:'1px solid var(--border)',borderRadius:6,padding:'3px 6px',fontSize:12,fontFamily:'Plus Jakarta Sans',fontWeight:300,textAlign:'right',background:'var(--elevated)',color:'var(--text-primary)',outline:'none'}}/>
                          <span style={{fontSize:11,color:'var(--text-muted)'}}>as of</span>
                          <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
                            style={{border:'1px solid var(--border)',borderRadius:6,padding:'3px 6px',fontSize:12,fontWeight:300,background:'var(--elevated)',color:'var(--text-primary)',outline:'none'}}/>
                          <button type="button" className="btn btn-sm btn-success" onClick={()=>saveEditAcct(a)} disabled={editSaving}>{editSaving?'…':'Save'}</button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={cancelEditAcct}>✕</button>
                        </div>
                      </div>
                    ):(
                      /* ── Read-only row ── */
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <div>
                          <span style={{fontSize:13,fontWeight:400,color:'var(--text-primary)'}}>{a.account_name}{a.mask?<span style={{fontSize:11,color:'var(--text-muted)',marginLeft:4,fontWeight:300}}>···{a.mask}</span>:null}</span>
                          <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                            {fmtAcctType(a.account_type)}{a.is_manual?' · Manual':''}
                            {a.start_date?<span style={{marginLeft:8}}>Anchor: {fmtBal(a.starting_balance)} as of {a.start_date}</span>:
                              <span style={{marginLeft:8,color:'var(--amber)'}}>⚠ No starting balance set</span>}
                          </div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <span style={{fontFamily:'Plus Jakarta Sans, sans-serif',fontSize:13,fontWeight:300,color:isAsset?'var(--green)':'var(--red)'}}>{fmtBal(dispBal)}</span>
                          <button type="button" className="btn btn-sm btn-ghost" style={{fontSize:11,padding:'2px 8px'}} onClick={()=>startEditAcct(a)}>Edit anchor</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );

    return(<>
      {/* KPI strip */}
      {(()=>{
        const currNW=nwData?.net_worth||0;
        const prevMo=tlData.length>=2?tlData[tlData.length-2]?.net_worth:null;
        const start12=tlData.length>=1?tlData[0]?.net_worth:null;
        const moChg=prevMo!=null?currNW-prevMo:null;
        const yr12Chg=start12!=null?currNW-start12:null;
        const moChgPct=moChg!=null&&Math.abs(prevMo)>1?Math.round(moChg/Math.abs(prevMo)*100):null;
        const yr12ChgPct=yr12Chg!=null&&Math.abs(start12)>1?Math.round(yr12Chg/Math.abs(start12)*100):null;
        const NWTrendBadge=({chg,pct})=>{
          if(chg==null)return<span style={{fontSize:11,color:'var(--text-muted)'}}>—</span>;
          const pos=chg>=0;
          return<span style={{background:pos?'rgba(52,211,153,0.12)':'rgba(248,113,113,0.12)',color:pos?'var(--green)':'var(--red)',borderRadius:12,padding:'2px 8px',fontSize:11,fontWeight:500}}>{chg>0?'+':''}{fmt(chg)}{pct!=null?` (${pct>0?'+':''}${pct}%)`:''}</span>;
        };
        return(
          <div className="metric-grid grid-4" style={{marginBottom:16}}>
            {[
              {label:'Net Worth',value:()=><span style={{color:currNW>=0?'var(--green)':'var(--red)'}}>{currNW<0?'-':''}{fmt(Math.abs(currNW))}</span>,sub:()=><><NWTrendBadge chg={moChg} pct={moChgPct}/><span style={{fontSize:11,color:'var(--text-muted)'}}>vs last month</span></>},
              {label:'Total Assets',value:()=><span style={{color:'var(--green)'}}>{fmt(nwData?.total_assets||0)}</span>,sub:()=><span style={{fontSize:11,color:'var(--text-muted)'}}>as of {asOf}</span>},
              {label:'Total Liabilities',value:()=><span style={{color:'var(--red)'}}>{fmt(Math.abs(nwData?.total_liabilities||0))}</span>,sub:()=><span style={{fontSize:11,color:'var(--text-muted)'}}>as of {asOf}</span>},
              {label:'12-Month Change',value:()=><span style={{color:yr12Chg!=null?(yr12Chg>=0?'var(--green)':'var(--red)'):'var(--text-primary)'}}>{yr12Chg!=null?(yr12Chg>0?'+':yr12Chg<0?'-':'')+fmt(Math.abs(yr12Chg)):'—'}</span>,sub:()=>yr12ChgPct!=null&&<span style={{fontSize:11,color:'var(--text-muted)'}}>{yr12ChgPct>0?'+':''}{yr12ChgPct}% · since {tlData[0]?.date}</span>},
            ].map(k=>(
              <div key={k.label} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:18}}>
                <div className="metric-label">{k.label}</div><div className="metric-value">{k.value()}</div><div className="metric-sub">{k.sub()}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Timeline chart — Catmull-Rom spline matching Dashboard style */}
      {tlData.length>1&&(()=>{
        const W=800,H=180,padC={t:14,r:20,b:28,l:52};
        const cW=W-padC.l-padC.r,cH=H-padC.t-padC.b;
        const yMax=maxV*1.05;const yMin=minV-(maxV-minV)*0.05;const yRng=yMax-yMin||1;
        const pts=tlData.map((d,i)=>[
          padC.l+(i/(tlData.length-1))*cW,
          padC.t+cH-((d.net_worth-yMin)/yRng)*cH
        ]);
        const smoothPath=(points)=>{
          if(points.length<2)return'';
          let d=`M${points[0][0]},${points[0][1]}`;
          for(let i=0;i<points.length-1;i++){
            const p0=points[Math.max(i-1,0)],p1=points[i],p2=points[i+1],p3=points[Math.min(i+2,points.length-1)];
            const t=0.3;
            d+=` C${p1[0]+(p2[0]-p0[0])*t},${p1[1]+(p2[1]-p0[1])*t} ${p2[0]-(p3[0]-p1[0])*t},${p2[1]-(p3[1]-p1[1])*t} ${p2[0]},${p2[1]}`;
          }
          return d;
        };
        const pathD=smoothPath(pts);
        const areaD=pathD+` L${pts[pts.length-1][0]},${padC.t+cH} L${pts[0][0]},${padC.t+cH} Z`;
        const MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return(
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'1.5px',marginBottom:16}}>Net Worth Over Time</div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',maxHeight:200}}>
            <defs><linearGradient id="nwAreaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--blue-primary)" stopOpacity="0.25"/><stop offset="100%" stopColor="var(--blue-primary)" stopOpacity="0"/></linearGradient></defs>
            {[0,0.25,0.5,0.75,1].map((p,i)=>{
              const y=padC.t+(1-p)*cH;const val=yMin+yRng*p;
              return(<g key={i}><line x1={padC.l} y1={y} x2={W-padC.r} y2={y} stroke="var(--border)" strokeWidth={1}/>
                <text x={padC.l-6} y={y+3} textAnchor="end" fontSize={9} fill="var(--text-muted)" fontFamily="Plus Jakarta Sans">{val>=10000||val<=-10000?`${(val/1000).toFixed(0)}k`:val>=1000?`${(val/1000).toFixed(1)}k`:`${Math.round(val)}`}</text></g>);
            })}
            {tlData.map((d,i)=>{
              if(tlData.length>6&&i%2!==0&&i!==tlData.length-1)return null;
              const dt=new Date(d.date+'T12:00:00');
              return<text key={i} x={pts[i][0]} y={H-4} textAnchor="middle" fontSize={9} fill="var(--text-muted)" fontFamily="Plus Jakarta Sans">{MO[dt.getMonth()]}</text>;
            })}
            <path d={areaD} fill="url(#nwAreaGrad)"/>
            <path d={pathD} fill="none" stroke="var(--blue-primary)" strokeWidth={2} strokeLinecap="round"/>
            {pts.map((p,i)=>(
              <g key={i}>
                <circle cx={p[0]} cy={p[1]} r={3} fill="var(--blue-primary)" style={{cursor:'pointer'}}/>
                <title>{tlData[i].date}: {fmt(tlData[i].net_worth)}</title>
              </g>
            ))}
          </svg>
        </div>);
      })()}

      {/* Assets | Liabilities two-column */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'2px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)'}}>Assets</span>
            <span style={{fontFamily:'Plus Jakarta Sans, sans-serif',fontSize:14,fontWeight:300,color:'var(--green)'}}>{fmt(nwData?.total_assets||0)}</span>
          </div>
          <BucketPanel bucketList={assetBuckets} isAsset={true}/>
        </div>
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'2px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)'}}>Liabilities</span>
            <span style={{fontFamily:'Plus Jakarta Sans, sans-serif',fontSize:14,fontWeight:300,color:'var(--red)'}}>{fmt(Math.abs(nwData?.total_liabilities||0))}</span>
          </div>
          <BucketPanel bucketList={liabBuckets} isAsset={false}/>
        </div>
      </div>
    </>);
  };

  /* ══════════════════════════════════════════════════════════════════════
     BALANCES TAB
  ══════════════════════════════════════════════════════════════════════ */
  const renderBalancesTab=()=>{
    const tlItems=timeline?.timeline||[];
    const startBal=timeline?.starting_balance||0;
    const asOfBal=tlItems.length?tlItems[tlItems.length-1].balance:startBal;
    const change=asOfBal-startBal;

    const chartW=800;const chartH=180;const pad=36;
    const minBal=tlItems.length?Math.min(...tlItems.map(d=>d.balance)):0;
    const maxBal=tlItems.length?Math.max(...tlItems.map(d=>d.balance)):0;
    const rng=maxBal-minBal||1;
    const balPts=tlItems.map((d,i)=>{
      const x=pad+(i/(tlItems.length-1||1))*(chartW-2*pad);
      const y=pad+(1-(d.balance-minBal)/rng)*(chartH-2*pad);
      return`${x},${y}`;
    }).join(' ');

    const accountTypes=[...new Set(accounts.map(a=>a.account_type))].sort();
    const filteredAccounts=accounts.filter(a=>{
      if(sideFilter==='asset'&&!a.is_asset)return false;
      if(sideFilter==='liability'&&!a.is_liability)return false;
      if(typeFilter!==null&&!typeFilter.has(a.account_type))return false;
      if(nameFilter&&a.id!==parseInt(nameFilter))return false;
      return true;
    });

    return(<>
      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
        <select className="filter-select" value={sideFilter} onChange={e=>setSideFilter(e.target.value)}>
          <option value="">Asset / Liability</option>
          <option value="asset">Assets only</option>
          <option value="liability">Liabilities only</option>
        </select>
        <MultiSelectFilter label="All types" options={accountTypes.map(t=>({value:t,label:fmtAcctType(t)}))}
          selected={typeFilter} onChange={setTypeFilter}/>
        <select className="filter-select" value={selectedId||''} onChange={e=>{setSelectedId(parseInt(e.target.value)||null);setTimeline(null);}}>
          <option value="">— Select account —</option>
          {filteredAccounts.map(a=><option key={a.id} value={a.id}>{a.account_name}{a.mask?` ···${a.mask}`:''}{a.is_manual?' (Manual)':''}</option>)}
        </select>
        {(sideFilter||typeFilter!==null)&&<button type="button" className="btn btn-sm btn-ghost" onClick={()=>{setSideFilter('');setTypeFilter(null);}}>Clear filters</button>}
      </div>

      {!selectedId
        ?<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:40,textAlign:'center'}}><div style={{color:'var(--text-muted)',fontSize:13,fontWeight:300}}>Select an account to view its balance as of {asOf}</div></div>
        :tlLoading
          ?<div className="loading"><div className="spinner"/><span>Loading…</span></div>
          :<>
            {/* KPI strip */}
            <div className="metric-grid grid-3" style={{marginBottom:16}}>
              {[
                {label:'Starting Balance',val:fmtBal(startBal),color:undefined,sub:timeline?.start_date?`as of ${timeline.start_date}`:''},
                {label:`Balance as of ${asOf}`,val:fmtBal(asOfBal),color:asOfBal>=0?'var(--green)':'var(--red)',sub:''},
                {label:'Change',val:(change>=0?'+':'')+fmtBal(change),color:change>=0?'var(--green)':'var(--red)',sub:''},
              ].map(k=>(
                <div key={k.label} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:18}}>
                  <div className="metric-label">{k.label}</div><div className="metric-value" style={{color:k.color}}>{k.val}</div>{k.sub&&<div className="metric-sub">{k.sub}</div>}
                </div>
              ))}
            </div>

            {/* Balance chart */}
            {tlItems.length>1&&<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:16,marginBottom:16}}>
              <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',marginBottom:8,textTransform:'uppercase',letterSpacing:'1.5px'}}>Balance Over Time</div>
              <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{width:'100%',height:180}}>
                <polyline fill="none" stroke="var(--blue-primary)" strokeWidth="2" points={balPts}/>
                <polyline fill="url(#balgrad)" stroke="none" points={`${pad},${chartH-pad} ${balPts} ${pad+(tlItems.length-1)/(tlItems.length-1||1)*(chartW-2*pad)},${chartH-pad}`}/>
                <defs><linearGradient id="balgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--blue-primary)" stopOpacity="0.15"/><stop offset="100%" stopColor="var(--blue-primary)" stopOpacity="0"/></linearGradient></defs>
                <text x={pad} y={chartH-pad+14} fontSize="10" fill="var(--text-muted)">{tlItems[0]?.date}</text>
                <text x={chartW-pad} y={chartH-pad+14} fontSize="10" fill="var(--text-muted)" textAnchor="end">{tlItems[tlItems.length-1]?.date}</text>
                <text x={pad-4} y={pad+4} fontSize="10" fill="var(--text-muted)" textAnchor="end">{fmtBal(maxBal)}</text>
                <text x={pad-4} y={chartH-pad+4} fontSize="10" fill="var(--text-muted)" textAnchor="end">{fmtBal(minBal)}</text>
              </svg>
            </div>}

            {/* Daily / Statement toggle card */}
            <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,overflow:'hidden'}}>
              <div style={{padding:'14px 20px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid var(--border)'}}>
                <span style={{fontSize:10,fontWeight:500,textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--text-muted)'}}>{stmtView?'Statement View':'Daily Balances'}</span>
                <div style={{display:'flex',alignItems:'center',gap:14}}>
                  {stmtView&&reconcileData&&<span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>
                    {reconcileData.transaction_count} txns
                    {reconcileData.excluded_count>0&&<span style={{color:'var(--amber)',marginLeft:6}}>· {reconcileData.excluded_count} excluded</span>}
                  </span>}
                  {!stmtView&&<span style={{fontSize:11,color:'var(--text-muted)',fontWeight:300}}>{tlItems.length} days</span>}
                  <div style={{display:'flex',gap:16}}>
                    <button type="button" onClick={()=>setStmtView(false)}
                      style={{padding:'4px 0',border:'none',borderBottom:!stmtView?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:11,fontWeight:!stmtView?500:400,
                        background:'transparent',color:!stmtView?'var(--blue-primary)':'var(--text-muted)',transition:'all 0.15s'}}>Daily</button>
                    <button type="button" onClick={()=>setStmtView(true)}
                      style={{padding:'4px 0',border:'none',borderBottom:stmtView?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:11,fontWeight:stmtView?500:400,
                        background:'transparent',color:stmtView?'var(--blue-primary)':'var(--text-muted)',transition:'all 0.15s'}}>Statement</button>
                  </div>
                </div>
              </div>

              {stmtView
                /* ── Statement view: individual transactions + running balance ── */
                ? reconcileLoading
                  ? <div className="loading" style={{padding:24}}><div className="spinner"/><span>Loading…</span></div>
                  : !reconcileData||reconcileData.transactions.length===0
                    ? <div className="empty"><span>No transactions since the anchor date</span></div>
                    : <div className="table-wrap" style={{maxHeight:440,overflowY:'auto'}}>
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Description</th>
                              <th style={{textAlign:'right'}}>Amount</th>
                              <th style={{textAlign:'right'}}>Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Anchor row (always first) */}
                            <tr style={{background:'var(--elevated)'}}>
                              <td style={{color:'var(--text-muted)',fontSize:12}}>{reconcileData.anchor_date||'—'}</td>
                              <td style={{fontSize:12,color:'var(--text-muted)',fontStyle:'italic'}}>⚓ Anchor — starting balance</td>
                              <td/>
                              <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontWeight:500}}>{fmtBal(reconcileData.anchor_balance)}</td>
                            </tr>
                            {/* Transactions oldest→newest */}
                            {reconcileData.transactions.map(t=>(
                              <tr key={t.id} style={{opacity:t.is_excluded?0.4:1,background:t.is_excluded?'var(--elevated)':undefined}}>
                                <td style={{color:'var(--text-secondary)',fontSize:13}}>{t.date}</td>
                                <td>
                                  <div style={{fontSize:13,textDecoration:t.is_excluded?'line-through':'none'}}>{t.description}</div>
                                  <div style={{fontSize:11,color:'var(--text-muted)',marginTop:1}}>
                                    {t.action}{t.category&&t.action!=='Transfer'?` · ${t.category}`:''}
                                    {t.is_excluded?<span style={{color:'var(--amber)',marginLeft:4}}>excluded</span>:''}
                                    {t.needs_review?<span style={{color:'var(--amber)',marginLeft:4}}>· needs review</span>:''}
                                  </div>
                                </td>
                                <td style={{textAlign:'right'}}>
                                  <span className={t.amount>0?'amount-pos':'amount-neg'} style={{textDecoration:t.is_excluded?'line-through':'none'}}>
                                    {t.amount>0?'+':''}{fmt(Math.abs(t.amount))}
                                  </span>
                                </td>
                                <td style={{textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:500,color:t.is_excluded?'var(--text-muted)':t.running_balance>=0?'var(--text-primary)':'var(--red)'}}>
                                  {t.is_excluded?'—':fmtBal(t.running_balance)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                /* ── Daily summary view (existing) ── */
                : tlItems.length===0
                  ? <div className="empty"><span>No transaction data in this range</span></div>
                  : <div className="table-wrap" style={{maxHeight:380,overflowY:'auto'}}>
                      <table>
                        <thead><tr><th>Date</th><th>Daily Change</th><th>Balance</th></tr></thead>
                        <tbody>{[...tlItems].reverse().map(d=>(
                          <tr key={d.date}>
                            <td style={{color:'var(--text-secondary)',fontSize:13}}>{d.date}</td>
                            <td><span className={d.change>0?'amount-pos':d.change<0?'amount-neg':'amount-neutral'}>{d.change>0?'+':d.change<0?'-':''}{d.change!==0?fmt(Math.abs(d.change)):'—'}</span></td>
                            <td><span style={{fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:500,color:d.balance>=0?'var(--text-primary)':'var(--red)'}}>{fmtBal(d.balance)}</span></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
              }
            </div>
          </>
      }
    </>);
  };

  /* ── Main render ─────────────────────────────────────────────────────── */
  return(
    <div>
      {/* Top bar: As Of date + sub-tabs */}
      <div className="card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:24,flexWrap:'wrap',padding:'12px 24px'}}>
        <div style={{display:'flex',gap:20}}>
          <button type="button" onClick={()=>setSubTab('networth')}
            style={{padding:'5px 0',border:'none',borderBottom:subTab==='networth'?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:12,fontWeight:subTab==='networth'?500:400,
              background:'transparent',color:subTab==='networth'?'var(--blue-primary)':'var(--text-muted)',transition:'all 0.15s'}}>Net Worth</button>
          <button type="button" onClick={()=>setSubTab('balances')}
            style={{padding:'5px 0',border:'none',borderBottom:subTab==='balances'?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:12,fontWeight:subTab==='balances'?500:400,
              background:'transparent',color:subTab==='balances'?'var(--blue-primary)':'var(--text-muted)',transition:'all 0.15s'}}>Account Balances</button>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:400}}>As of</span>
          <input type="date" value={asOf} onChange={e=>{setAsOf(e.target.value);setTimeline(null);}}
            className="date-input" style={{padding:'4px 8px',fontSize:13}}/>
          <button type="button" className="btn btn-sm btn-ghost" onClick={()=>{setAsOf(todayStr);setTimeline(null);}}>Today</button>
        </div>
      </div>

      {error&&<div style={{color:'var(--red)',fontSize:13,marginBottom:12}}>{error}</div>}

      {subTab==='networth'?renderNWTab():renderBalancesTab()}
    </div>
  );
}

/* ── Loans Page (Section 1) ──────────────────────────────────────────────── */

// LoanForm is a top-level component so React never remounts it mid-edit
// (if defined inside LoansPage, every keystroke re-creates a new function
// reference, causing React to unmount+remount the form and lose focus).
