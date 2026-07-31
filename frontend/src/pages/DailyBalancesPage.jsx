import {useState,useEffect,useCallback} from 'react';
import {BalanceCellModal} from '../components/BalanceCellModal';
import {Icon} from '../components/Icon';
import {LiquidityForecastCard} from '../components/LiquidityForecastCard';
import {ReconciliationPanel} from '../components/ReconciliationPanel';
import {SkeletonTable} from '../components/SkeletonTable';
import {apiFetch} from '../lib/api';
import {fmt,todayStr} from '../lib/format';

export function DailyBalancesPage({toast,refreshKey}){
  const[tab,setTab]=useState('balances'); // 'balances' | 'reconciliation'
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(true);
  const[rangeMode,setRangeMode]=useState('month');
  const[customStart,setCustomStart]=useState('');
  const[customEnd,setCustomEnd]=useState('');
  const[collapsed,setCollapsed]=useState({'Other Assets':true,'Other Liabilities':true});
  const[cellModal,setCellModal]=useState(null);
  const[acctFilter,setAcctFilter]=useState(new Set());
  const[acctDropOpen,setAcctDropOpen]=useState(false);
  const toggleAcctFilter=(id)=>setAcctFilter(prev=>{const s=new Set(prev);if(s.has(String(id)))s.delete(String(id));else s.add(String(id));return s;});

  const getRange=()=>{
    const n=new Date();
    const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if(rangeMode==='month'){
      const y=n.getFullYear(),m=n.getMonth()+1;
      const s=`${y}-${String(m).padStart(2,'0')}-01`;
      const last=new Date(y,m,0).getDate();
      return{s,e:`${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`};
    }
    if(rangeMode==='30d'){
      const s=new Date(n);s.setDate(s.getDate()-29);
      return{s:fmt(s),e:fmt(n)};
    }
    if(rangeMode==='90d'){
      const s=new Date(n);s.setDate(s.getDate()-89);
      return{s:fmt(s),e:fmt(n)};
    }
    return{s:customStart,e:customEnd};
  };

  const load=useCallback(async()=>{
    const{s,e}=getRange();
    if(rangeMode==='custom'&&(!s||!e))return;
    setLoading(true);
    try{
      const ct=todayStr();
      const q=`?client_today=${ct}${s?`&start_date=${s}`:''}${e?`&end_date=${e}`:''}`;
      setData(await apiFetch(`/daily-balances${q}`));
    }catch(err){toast('Failed to load daily balances','error');}
    finally{setLoading(false);}
  },[rangeMode,customStart,customEnd]);

  useEffect(()=>{load();},[load,refreshKey]);
  const toggle=g=>setCollapsed(p=>({...p,[g]:!p[g]}));
  const fmtBal=v=>{
    if(v==null)return'—';
    const abs=Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    return v<0?`(${abs})`:abs;
  };

  const GRP_COLORS={'Checking & Savings':'rgba(16,185,129,0.05)','Investments':'rgba(59,130,246,0.05)','Other Assets':'rgba(139,92,246,0.05)','Credit Cards':'rgba(251,191,36,0.05)','Loans':'rgba(239,68,68,0.05)'};

  if(loading)return<SkeletonTable rows={6}/>;
  if(!data||!data.dates)return<div className="empty">No data found</div>;

  const{dates,groups=[],today,projection_details={}}=data;
  const numDays=dates.length;

  return(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card" style={{display:'flex',gap:24,padding:'12px 24px'}}>
        <button type="button" onClick={()=>setTab('balances')}
          style={{padding:'12px 0',border:'none',borderBottom:tab==='balances'?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:13,fontWeight:tab==='balances'?700:500,letterSpacing:'0.2px',
            background:'transparent',color:tab==='balances'?'var(--blue-primary)':'var(--text-muted)',transition:'all 0.2s ease',marginBottom:'-1px'}}>Daily Balances</button>
        <button type="button" onClick={()=>setTab('reconciliation')}
          style={{padding:'12px 0',border:'none',borderBottom:tab==='reconciliation'?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:13,fontWeight:tab==='reconciliation'?700:500,letterSpacing:'0.2px',
            background:'transparent',color:tab==='reconciliation'?'var(--blue-primary)':'var(--text-muted)',transition:'all 0.2s ease',marginBottom:'-1px'}}>Reconciliation</button>
      </div>

      {tab==='reconciliation'?<ReconciliationPanel toast={toast}/>:<>
      <LiquidityForecastCard toast={toast} />
      <div className="card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:16,padding:'16px 24px'}}>
        <div><p style={{fontSize:12,color:'var(--text-secondary)',margin:0}}>{numDays} days · end-of-day · <span style={{fontStyle:'italic', opacity: 0.8}}>italic = projected</span> · <span style={{color:'var(--blue-primary)'}}>◈</span> = detail</p>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <div className="sel-pill">
            {[['month','Month'],['30d','30d'],['90d','90d'],['custom','Custom']].map(([v,l])=>(
              <button type="button" key={v} onClick={()=>setRangeMode(v)} data-active={rangeMode===v} style={{
background:rangeMode===v?'var(--blue-primary)':'none',color:rangeMode===v?'white':'var(--text-secondary)',fontSize:11}}>{l}</button>
            ))}
          </div>
          {rangeMode==='custom'&&(
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <input type="date" className="date-input" value={customStart} onChange={e=>setCustomStart(e.target.value)}/>
              <span style={{color:'var(--text-muted)'}}>→</span>
              <input type="date" className="date-input" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/>
            </div>
          )}
          <div style={{position:'relative'}}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setAcctDropOpen(p=>!p)} style={{gap:6}}>
               <Icon name="wallet" size={13}/>
               <span>Accounts {acctFilter.size>0&&`(${acctFilter.size})`}</span>
               <span style={{fontSize:8}}>▼</span>
            </button>
            {acctDropOpen&&<div style={{position:'absolute',top:'100%',right:0,marginTop:8,background:'var(--surface)',backdropFilter:'var(--glass-blur)',border:'1px solid var(--border)',borderRadius:16,padding:12,zIndex:30,boxShadow:'var(--card-shadow)',minWidth:240,maxHeight:400,overflowY:'auto'}}
              onMouseLeave={()=>setAcctDropOpen(false)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <span style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase'}}>Show Accounts</span>
                {acctFilter.size>0&&<button type="button" style={{border:'none',background:'none',fontSize:10,color:'var(--blue-primary)',cursor:'pointer',fontWeight:600}} onClick={()=>setAcctFilter(new Set())}>✕ CLEAR</button>}
              </div>
              {groups.map(g=>(
                <div key={g.group} style={{marginBottom:12}}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}}>{g.group}</div>
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    {g.accounts.map(a=>(
                      <label key={a.id} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer',color:acctFilter.has(String(a.id))?'var(--text-primary)':'var(--text-secondary)'}}>
                        <input type="checkbox" checked={acctFilter.has(String(a.id))} onChange={()=>toggleAcctFilter(a.id)}/>
                        {a.account_name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>}
          </div>
        </div>
      </div>

      {cellModal&&<BalanceCellModal cell={cellModal} onClose={()=>setCellModal(null)} toast={toast}/>}

      {/* ── Filtered groups logic ── */}
      {(()=>{
        const filtIds=acctFilter.size>0?acctFilter:null;
        const fGroups=filtIds
          ?groups.map(g=>{
            const matchAccts=g.accounts.filter(a=>filtIds.has(String(a.id)));
            if(!matchAccts.length)return null;
            const totals={};
            matchAccts.forEach(a=>{Object.entries(a.balances||{}).forEach(([d,v])=>{totals[d]=(totals[d]||0)+v;});});
            return{...g,accounts:matchAccts,totals};
          }).filter(Boolean)
          :groups;
        
        const isSingle=filtIds&&filtIds.size===1;
        const singleId=isSingle?[...acctFilter][0]:null;
        const singleLabel=isSingle?data.accounts.find(a=>String(a.id)===singleId)?.account_name:'Selected';

        const computeNW=(di)=>{
          let s=0;
          fGroups.forEach(g=>{const v=g.totals[di]??0;s+=g.is_asset?v:-Math.abs(v);});
          return Math.round(s*100)/100;
        };
        const todayDi=dates.indexOf(today);
        const lastActualDi=todayDi>=0?todayDi:dates.reduce((best,d,i)=>d<=today?i:best,-1);
        const kpiStrip=lastActualDi<0?null:(()=>{
          const nwStart=computeNW(0);
          const nwNow=computeNW(lastActualDi);
          const nwChg=nwNow-nwStart;
          const nwChgPct=Math.abs(nwStart)>1?Math.round(nwChg/Math.abs(nwStart)*100):null;
          const nwPeak=Math.max(...Array.from({length:lastActualDi+1},(_,i)=>computeNW(i)));
          const fmtNW=v=>{const abs=fmt(Math.abs(v));return v<0?`(${abs})`:abs;};
          const chgPos=nwChg>=0;
          const lbl1=isSingle?`${singleLabel} — Today`:'Net Worth — Today';
          return(
            <div className="metric-grid">
              <div className="card metric-card">
                <div className="metric-label">{lbl1}</div>
                <div className="metric-value" style={{color:nwNow>=0?'var(--green)':'var(--red)'}}>{fmtNW(nwNow)}</div>
                <div className="metric-sub"><span style={{fontSize:11,color:'var(--text-muted)',fontWeight:600}}>{today.toUpperCase()}</span></div>
              </div>
              <div className="card metric-card">
                <div className="metric-label">Start of Period</div>
                <div className="metric-value" style={{color:nwStart>=0?'var(--green)':'var(--red)'}}>{fmtNW(nwStart)}</div>
                <div className="metric-sub"><span style={{fontSize:11,color:'var(--text-muted)',fontWeight:600}}>{dates[0].toUpperCase()}</span></div>
              </div>
              <div className="card metric-card">
                <div className="metric-label">Net Change</div>
                <div className="metric-value" style={{color:chgPos?'var(--green)':'var(--red)'}}>{chgPos?'+':''}{fmtNW(nwChg)}</div>
                <div className="metric-sub">{nwChgPct!=null&&<span className="badge" style={{background:chgPos?'rgba(16,185,129,0.1)':'rgba(239, 68, 68, 0.1)',color:chgPos?'var(--green)':'var(--red)'}}>{nwChgPct>0?'+':''}{nwChgPct}%</span>}</div>
              </div>
              <div className="card metric-card">
                <div className="metric-label">Period Peak</div>
                <div className="metric-value" style={{color:nwPeak>=0?'var(--green)':'var(--red)'}}>{fmtNW(nwPeak)}</div>
                <div className="metric-sub"><span style={{fontSize:11,color:'var(--text-muted)',fontWeight:600}}>ACTUAL HIGH IN RANGE</span></div>
              </div>
            </div>
          );
        })();

        return(<>
      {kpiStrip}

      <div className="card" style={{padding:0, overflow:'hidden'}}>
        <div className="table-wrap" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <table>
            <thead style={{position:'sticky',top:0,zIndex:10}}>
              <tr>
                <th rowSpan={2} style={{position:'sticky',left:0,zIndex:12,background:'var(--surface)',backdropFilter:'var(--glass-blur)',textAlign:'left',fontSize:11,fontWeight:700,borderBottom:'2px solid var(--border)',borderRight:'2px solid var(--border)',minWidth:90,color:'var(--text-muted)'}}>DATE</th>
                {fGroups.map(grp=>{
                  const span=collapsed[grp.group]?1:1+grp.accounts.length;
                  return(
                    <th key={grp.group} colSpan={span} style={{padding:'10px',textAlign:'center',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',borderBottom:'1px solid var(--border)',borderLeft:'2px solid var(--border)',background:'rgba(59,130,246,0.05)',cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}}
                      onClick={()=>toggle(grp.group)}>
                      {grp.group} {collapsed[grp.group]?'▸':'▾'}
                    </th>
                  );
                })}
                <th rowSpan={2} style={{padding:'10px',textAlign:'right',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',borderBottom:'2px solid var(--border)',borderLeft:'3px solid var(--blue-primary)',background:'rgba(var(--blue-primary-rgb), 0.1)',whiteSpace:'nowrap',color:'var(--blue-primary)',minWidth:120}}>GRAND TOTAL</th>
              </tr>
              <tr style={{background:'var(--surface)', backdropFilter:'var(--glass-blur)'}}>
                {fGroups.map(grp=>[
                  <th key={`${grp.group}-tot`} style={{padding:'8px 12px',textAlign:'right',fontSize:10,fontWeight:700,borderBottom:'2px solid var(--border)',borderLeft:'2px solid var(--border)',color:'var(--text-primary)',background:'rgba(59,130,246,0.02)'}}>TOTAL</th>,
                  ...(collapsed[grp.group]?[]:grp.accounts.map(acct=>(
                    <th key={acct.id} style={{padding:'8px 12px',textAlign:'right',fontSize:10,fontWeight:600,borderBottom:'2px solid var(--border)',borderLeft:'1px solid var(--border)',whiteSpace:'nowrap',maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',color:'var(--text-secondary)'}} title={acct.account_name}>{acct.account_name.toUpperCase()}</th>
                  )))
                ])}
              </tr>
            </thead>
            <tbody>
              {dates.map((d,di)=>{
                const isToday=d===today;
                const isFuture=d>today;
                const rowBg=isToday?'rgba(var(--blue-primary-rgb), 0.08)':isFuture?'rgba(var(--blue-vibrant-rgb), 0.02)':'transparent';
                return(
                  <tr key={d} style={{background:rowBg}}>
                    <td style={{position:'sticky',left:0,zIndex:2,background:isToday?'rgba(var(--blue-primary-rgb), 0.1)':isFuture?'var(--elevated)':'var(--surface)',padding:'8px 12px',fontSize:12,fontWeight:isToday?700:500,borderRight:'2px solid var(--border)',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap',color:isToday?'var(--blue-primary)':isFuture?'var(--text-muted)':'var(--text-secondary)'}}>
                      {d.slice(5)}{isToday&&<span className="badge" style={{marginLeft:8,fontSize:9,background:'var(--blue-primary)',color:'white'}}>TODAY</span>}
                    </td>
                    {(()=>{
                      let grandTotal=0;
                      const cells=fGroups.flatMap(grp=>{
                        const isLiab=!grp.is_asset;
                        const rawTot=grp.totals[di];
                        const dispTot=isLiab?-rawTot:rawTot;
                        grandTotal+=rawTot;
                        const totCell=(
                          <td key={`${grp.group}-tot`} style={{padding:'8px 12px',textAlign:'right',fontSize:12,fontWeight:700,borderLeft:'2px solid var(--border)',borderBottom:'1px solid var(--border)',color:dispTot<0?'var(--red)':'var(--text-primary)',background:'rgba(59,130,246,0.01)'}}>
                            {fmtBal(dispTot)}
                          </td>
                        );
                        const acctCells=collapsed[grp.group]?[]:grp.accounts.map(acct=>{
                          const val=acct.balances[di];
                          const dispVal=isLiab?-val:val;
                          const isProj=acct.projected_dates.includes(d);
                          const projEntries=projection_details[acct.id]?.[d];
                          const hasProj=!!(projEntries&&projEntries.length>0);
                          const isShortfall=isProj && ['Checking','Savings'].includes(acct.account_type) && dispVal < 200;
                          const handleClick=hasProj?()=>{
                            const entriesSum=projEntries.reduce((s,e)=>s+e.amount,0);
                            const balBefore=Math.round((dispVal-entriesSum)*100)/100;
                            setCellModal({acct_name:acct.account_name,date:d,raw_balance:balBefore,projected_balance:dispVal,entries:projEntries});
                          }:undefined;
                          return(
                            <td key={acct.id} onClick={handleClick} title={isShortfall?`WARNING: Projected shortfall` : (hasProj?`Click to see ${projEntries.length} projection${projEntries.length>1?'s':''}`:undefined)} 
                              style={{padding:'8px 12px',textAlign:'right',fontSize:12,borderLeft:'1px solid var(--border)',borderBottom:'1px solid var(--border)',
                                color:isShortfall?'var(--red)':dispVal<0?'var(--red)':'inherit',
                                fontWeight:isShortfall?700:400,
                                fontStyle:isProj?'italic':'normal',opacity:isProj?0.8:1,whiteSpace:'nowrap',cursor:hasProj?'pointer':undefined,
                                background:isShortfall?'rgba(239, 68, 68, 0.1)':hasProj?'rgba(var(--blue-primary-rgb), 0.05)':undefined,
                                boxShadow:isShortfall?'inset 0 0 10px rgba(239, 68, 68, 0.1)':undefined}}>
                              {fmtBal(dispVal)}{hasProj&&<span style={{marginLeft:4,fontSize:10,color:isShortfall?'var(--red)':'var(--blue-primary)',verticalAlign:'super'}}>◈</span>}
                            </td>
                          );
                        });
                        return[totCell,...acctCells];
                      });
                      grandTotal=Math.round(grandTotal*100)/100;
                      const gtColor=grandTotal>=0?'var(--green)':'var(--red)';
                      cells.push(
                        <td key="grand-total" style={{padding:'8px 12px',textAlign:'right',fontSize:13,fontWeight:700,borderLeft:'3px solid var(--blue-primary)',borderBottom:'1px solid var(--border)',color:gtColor,background:'rgba(var(--blue-primary-rgb), 0.08)'}}>
                          {fmtBal(grandTotal)}
                        </td>
                      );
                      return cells;
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>);
      })()}
      </>}
    </div>
  );
}

/* ── Hash-based URL routing ─────────────────────────────────────────────── */
