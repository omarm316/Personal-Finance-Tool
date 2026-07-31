import {useState,useEffect,useCallback,useMemo} from 'react';
import {CardDetailErrorBoundary} from '../components/CardDetailErrorBoundary';
import {ChallengeCard} from '../components/ChallengeCard';
import {SearchCreateSelect} from '../components/SearchCreateSelect';
import {apiFetch} from '../lib/api';
import {AccountCardDetailPage} from './AccountCardDetailPage';
import {EcosystemDetailPage} from './EcosystemDetailPage';

export function CardsPage({toast,refreshKey}){
  // Theme toggle mutates document.documentElement's data-theme attribute
  // directly (colors update instantly via CSS, no React re-render needed
  // for that) — but the ecosystem logo picker below needs to know the
  // *current* theme at render time, and a stale read (e.g. via a plain
  // document.documentElement.getAttribute() inline in the render) would
  // only reflect whatever the theme was the last time this component
  // happened to re-render for some other reason. Track it as real state.
  const[pageTheme,setPageTheme]=useState(()=>document.documentElement.getAttribute('data-theme')||'dark');
  useEffect(()=>{
    const obs=new MutationObserver(()=>setPageTheme(document.documentElement.getAttribute('data-theme')||'dark'));
    obs.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    return()=>obs.disconnect();
  },[]);
  const[accounts,setAccounts]=useState([]);
  const[allAccounts,setAllAccounts]=useState([]);
  const[products,setProducts]=useState([]);
  const[loading,setLoading]=useState(true);
  const[selectedAccount,setSelectedAccount]=useState(null);
  const[pendingChallengeFilter,setPendingChallengeFilter]=useState(null); // {start,end,name} — set when navigating in via a challenge card
  const[selectedEcosystem,setSelectedEcosystem]=useState(null); // {id,name}
  const[suggestions,setSuggestions]=useState([]);
  const[linking,setLinking]=useState({});
  const[tab,setTab]=useState('accounts'); // 'accounts' | 'swipe' | 'cards'
  const[swipeData,setSwipeData]=useState(null);
  const[swipeLoading,setSwipeLoading]=useState(false);
  // Earn summary state
  const[earnData,setEarnData]=useState(null);
  const[earnLoading,setEarnLoading]=useState(true);
  const[earnPeriod,setEarnPeriod]=useState('qtd');
  const[earnYear,setEarnYear]=useState(new Date().getFullYear());
  const earnYears=useMemo(()=>{const y=new Date().getFullYear();return[y,y-1,y-2];},[]);
  // Legacy card management state
  const[cards,setCards]=useState([]);
  const[editing,setEditing]=useState(null);
  const[editVals,setEditVals]=useState({});
  const[showInactive,setShowInactive]=useState(false);
  // Primary Cardholder options — same baseline+discovered convention as
  // spender tagging elsewhere (SearchCreateSelect on the ecosystem pages).
  const[people,setPeople]=useState(['Omer','Daniella']);
  useEffect(()=>{apiFetch('/transactions/spenders').then(s=>setPeople(p=>Array.from(new Set([...p,...s])))).catch(()=>{});},[]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const[accts,prods,cards_]=await Promise.all([
        apiFetch('/accounts'),apiFetch('/card-products'),apiFetch('/cards'),
      ]);
      // Filter to credit card accounts
      const creditAccts=accts.filter(a=>a.account_type&&a.account_type.toLowerCase().includes('credit'));
      setAccounts(creditAccts);
      setAllAccounts(accts);
      setProducts(prods);
      setCards(cards_);
    }catch(e){toast('Failed to load','error');}
    finally{setLoading(false);}
  },[]);

  const loadEarnSummary=useCallback(async(p,y)=>{
    setEarnLoading(true);
    try{setEarnData(await apiFetch(`/cards/earn-summary?period=${p}&year=${y}`));}
    catch(e){setEarnData(null);}
    finally{setEarnLoading(false);}
  },[]);

  useEffect(()=>{loadEarnSummary(earnPeriod,earnYear);},[earnPeriod,earnYear,refreshKey]);

  const loadSwipe=async()=>{
    setSwipeLoading(true);
    try{setSwipeData(await apiFetch('/cards/swipe-advisor'));}
    catch(e){toast('Failed to load swipe data','error');}
    finally{setSwipeLoading(false);}
  };

  const loadSuggestions=async()=>{
    try{
      const s=await apiFetch('/accounts/product-suggestions');
      setSuggestions(s);
    }catch(e){}
  };

  const linkProduct=async(accountId,productId)=>{
    setLinking(l=>({...l,[accountId]:true}));
    try{
      const r=await apiFetch(`/accounts/${accountId}/link-product`,{method:'POST',body:JSON.stringify({product_id:productId})});
      toast(`Linked to ${r.product_name}`);
      await load();
      setSuggestions(s=>s.filter(x=>x.account_id!==accountId));
    }catch(e){toast('Link failed','error');}
    finally{setLinking(l=>({...l,[accountId]:false}));}
  };

  const unlinkProduct=async(accountId)=>{
    try{
      await apiFetch(`/accounts/${accountId}/link-product`,{method:'POST',body:JSON.stringify({product_id:null})});
      toast('Product unlinked');
      await load();
    }catch(e){toast('Unlink failed','error');}
  };

  useEffect(()=>{load().then(()=>loadSuggestions());},[load,refreshKey]);

  // Legacy card management
  const startEdit=(card)=>{setEditing(card.id);setEditVals({card_name:card.card_name||'',last_four:card.last_four??'',statement_close_day:card.statement_close_day??'',payment_due_day:card.payment_due_day??'',credit_limit:card.credit_limit??'',account_id:card.account_id||null,payment_account_id:card.payment_account_id||null,is_active:card.is_active,notes:card.notes||'',annual_fee:card.annual_fee??'',primary_user:card.primary_user||'',issue_date:card.issue_date?card.issue_date.slice(0,10):''});};
  // Anniversary date doubles as the annual-fee due date — the fee posts
  // each year on this date's month/day. Returns days until the next
  // occurrence (handles Feb 29 in non-leap years by clamping to the 28th,
  // same convention as the backend's statement/payment day math).
  const daysToAnniversary=isoDate=>{
    if(!isoDate)return null;
    const d=new Date(isoDate+'T00:00:00');
    const today=new Date();today.setHours(0,0,0,0);
    const mkDate=(y,m,day)=>{const last=new Date(y,m+1,0).getDate();return new Date(y,m,Math.min(day,last));};
    let next=mkDate(today.getFullYear(),d.getMonth(),d.getDate());
    if(next<today)next=mkDate(today.getFullYear()+1,d.getMonth(),d.getDate());
    return Math.round((next-today)/86400000);
  };
  const cancelEdit=()=>{setEditing(null);setEditVals({});};
  const saveEdit=async(cardId)=>{
    try{
      await apiFetch(`/cards/${cardId}`,{method:'PATCH',body:JSON.stringify({...editVals,last_four:editVals.last_four?parseInt(editVals.last_four):null,statement_close_day:editVals.statement_close_day?parseInt(editVals.statement_close_day):null,payment_due_day:editVals.payment_due_day?parseInt(editVals.payment_due_day):null,credit_limit:editVals.credit_limit?parseFloat(editVals.credit_limit):null,annual_fee:editVals.annual_fee?parseFloat(editVals.annual_fee):null,payment_account_id:editVals.payment_account_id?parseInt(editVals.payment_account_id):null})});
      await load();setEditing(null);toast('Card updated');
    }catch(e){toast('Failed to save','error');}
  };

  const networkColor={VISA:'#1a1f71',AMEX:'#016FD0',MC:'#EB001B',DISCOVER:'#FF6600'};

  // Account detail takes highest priority
  const closeAccountDetail=()=>{setSelectedAccount(null);setPendingChallengeFilter(null);};
  if(selectedAccount)return<CardDetailErrorBoundary onBack={closeAccountDetail}><AccountCardDetailPage accountId={selectedAccount} onBack={closeAccountDetail} toast={toast} initialChallengeFilter={pendingChallengeFilter}/></CardDetailErrorBoundary>;

  // Ecosystem detail page
  if(selectedEcosystem)return(
    <EcosystemDetailPage
      ecoId={selectedEcosystem.id} ecoName={selectedEcosystem.name}
      initPeriod={earnPeriod} initYear={earnYear}
      onBack={()=>setSelectedEcosystem(null)}
      onSelectAccount={(id)=>{setPendingChallengeFilter(null);setSelectedAccount(id);}}
      toast={toast}/>
  );

  // Open a card's detail page pre-filtered to one of its challenges — used by
  // ChallengeCard clicks on the Portfolio page.
  const openChallenge=(ch)=>{
    if(!ch.account_id)return;
    setPendingChallengeFilter({start:(ch.start_date||'').slice(0,10),end:(ch.end_date||'').slice(0,10),name:ch.name});
    setSelectedAccount(ch.account_id);
  };

  // Find linked product info for each account
  const getProductForAccount=(acctId)=>{
    const acct=accounts.find(a=>a.id===acctId);
    if(acct&&acct.product_id)return products.find(p=>p.id===acct.product_id);
    // Fallback: check if a card links this account to a product
    const card=cards.find(c=>c.account_id===acctId&&c.product_id);
    if(card)return products.find(p=>p.id===card.product_id);
    return null;
  };

  const linkedCount=accounts.filter(a=>getProductForAccount(a.id)).length;
  const unlinkedCount=accounts.length-linkedCount;
  const visible=cards.filter(c=>showInactive||c.is_active);

  return(
    <div>
      {/* Tab switcher — the MTD/QTD/YTD + year range selector lives inline
          here (only relevant to the Portfolio tab) instead of its own row
          below, to save vertical space. */}
      <div className="card" style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,marginBottom:24,padding:'12px 24px'}}>
        <div style={{display:'flex',gap:24}}>
          {[{id:'accounts',label:'Portfolio'},{id:'swipe',label:'Swipe Advisor'},{id:'cards',label:'Card Management'}].map(t=>(
            <button type="button" key={t.id} onClick={()=>{setTab(t.id);if(t.id==='swipe'&&!swipeData)loadSwipe();}}
              style={{padding:'8px 0',border:'none',borderBottom:tab===t.id?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:12,fontWeight:tab===t.id?500:400,letterSpacing:'0.2px',
                background:'transparent',color:tab===t.id?'var(--blue-primary)':'var(--text-muted)',
                transition:'all 0.15s',marginBottom:'-1px'}}>
              {t.label}
            </button>
          ))}
        </div>
        {tab==='accounts'&&<div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
          <div style={{display:'flex',gap:16}}>
            {['mtd','qtd','ytd'].map(p=>(
              <button type="button" key={p} onClick={()=>setEarnPeriod(p)}
                style={{padding:'4px 0',border:'none',borderBottom:earnPeriod===p?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:11,fontWeight:earnPeriod===p?500:400,letterSpacing:'0.5px',
                  background:'transparent',color:earnPeriod===p?'var(--blue-primary)':'var(--text-muted)',
                  transition:'all 0.15s',textTransform:'uppercase'}}>
                {p}
              </button>
            ))}
          </div>
          <select value={earnYear} onChange={e=>setEarnYear(Number(e.target.value))}
            style={{fontSize:11,fontWeight:400,border:'1px solid var(--border)',borderRadius:8,padding:'6px 12px',background:'var(--elevated)',color:'var(--text-primary)'}}>
            {earnYears.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>}
      </div>

      {tab==='swipe'?(
        /* WHERE SHOULD I SWIPE */
        <div>
          <div style={{marginBottom:20}}>
            <h2 style={{fontSize:18,fontWeight:400,margin:'0 0 4px'}}>Where Should I Swipe?</h2>
            <p style={{fontSize:13,color:'var(--text-muted)',margin:0}}>Best card for every spending category, ranked by your point valuations.</p>
          </div>
          {swipeLoading?<div style={{padding:40,textAlign:'center'}}><div className="spinner"/></div>
            :swipeData?.categories?.map((cat,i)=>(
              <div key={i} className="card" style={{marginBottom:10,padding:'14px 18px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:500}}>{cat.category}</div>
                  </div>
                  {cat.best&&<div style={{display:'flex',alignItems:'center',gap:16}}>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:13,fontWeight:500}}>{cat.best.card_name}</div>
                      <div style={{fontSize:11,color:'var(--text-muted)'}}>{cat.best.issuer} · {cat.best.ecosystem}</div>
                    </div>
                    <div style={{textAlign:'center',minWidth:55}}>
                      <div style={{fontSize:20,fontWeight:400,fontFamily:'Plus Jakarta Sans',color:'var(--green)'}}>{cat.best.earn_rate}x</div>
                      <div style={{fontSize:10,color:'var(--text-muted)'}}>earn rate</div>
                    </div>
                    <div style={{textAlign:'center',minWidth:55}}>
                      <div style={{fontSize:16,fontWeight:500,fontFamily:'Plus Jakarta Sans',color:'var(--blue)'}}>{cat.best.your_value}{'\u00A2'}</div>
                      <div style={{fontSize:10,color:'var(--text-muted)'}}>per $1</div>
                    </div>
                    {cat.runner_up&&<div style={{fontSize:11,color:'var(--text-muted)',textAlign:'right',minWidth:100,paddingLeft:8,borderLeft:'1px solid var(--border)'}}>
                      <div>Runner-up:</div>
                      <div style={{fontWeight:500}}>{cat.runner_up.card_name}</div>
                      <div>{cat.runner_up.earn_rate}x · {cat.runner_up.your_value}{'\u00A2'}/$</div>
                    </div>}
                  </div>}
                </div>
              </div>
            ))
          }
        </div>
      ):tab==='cards'?(
        /* LEGACY CARD MANAGEMENT */
        <div>
          {/* ── Auto-detected Product Matches ── */}
          {suggestions.length>0&&<div className="card" style={{marginBottom:20,border:'1px solid var(--blue-primary)',borderLeft:'3px solid var(--blue-primary)'}}>
            <div className="section-header" style={{paddingBottom:8}}>
              <div className="section-title" style={{color:'var(--blue-primary)',fontSize:13}}>Auto-detected Product Matches</div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setSuggestions([])}>Dismiss</button>
            </div>
            <div style={{padding:'0 20px 14px',display:'flex',flexDirection:'column',gap:8}}>
              {suggestions.map(s=>(
                <div key={s.account_id} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 12px',background:'var(--elevated)',borderRadius:8,border:'1px solid var(--border)'}}>
                  <div style={{flex:1,fontSize:13,fontWeight:400}}>{s.account_name}{s.mask?` ···${s.mask}`:''} <span style={{fontWeight:300,color:'var(--text-muted)'}}>→ {s.suggested_product_name}</span></div>
                  <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,background:s.confidence==='high'?'rgba(52,211,153,0.12)':'rgba(var(--blue-primary-rgb), 0.12)',color:s.confidence==='high'?'var(--green)':'var(--blue-primary)',fontWeight:500}}>{s.confidence}</span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={linking[s.account_id]} onClick={()=>linkProduct(s.account_id,s.suggested_product_id)}>{linking[s.account_id]?'...':'Confirm'}</button>
                </div>
              ))}
            </div>
          </div>}
          <div className="card">
            <div className="section-header">
              <div className="section-title">Cards ({visible.length})</div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <label className="filter-label">
                  <input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/> Show inactive
                </label>
              </div>
            </div>
            {loading?<div className="loading"><div className="spinner"/></div>
              :<div className="table-wrap"><table>
                <thead><tr>
                  <th>Card</th><th>Issuer</th><th>Network</th>
                  <th style={{textAlign:'center'}}>Close Day</th><th style={{textAlign:'center'}}>Due Day</th>
                  <th>Anniversary</th>
                  <th style={{textAlign:'right'}}>Credit Limit</th><th style={{textAlign:'right'}}>Annual Fee</th>
                  <th>Linked Account</th><th>Primary User</th><th>Actions</th>
                </tr></thead>
                <tbody>{visible.map(c=>(
                  <tr key={c.id} style={{opacity:c.is_active?1:0.5}}>
                    <td>
                      <div style={{fontWeight:500,fontSize:13}}>{c.card_name||c.brand}</div>
                      <div style={{fontSize:11,color:'var(--text-muted)'}}>{c.card_id}</div>
                    </td>
                    {editing===c.id?<>
                      <td style={{fontSize:12}}>{c.issuer}</td>
                      <td><span style={{fontFamily:'Plus Jakarta Sans',fontSize:11,fontWeight:400,color:networkColor[c.network]||'var(--text-secondary)'}}>{c.network}</span></td>
                      <td onClick={e=>e.stopPropagation()}><input type="number" min="1" max="31" value={editVals.statement_close_day} onChange={e=>setEditVals(v=>({...v,statement_close_day:e.target.value}))} style={{width:50,border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',fontSize:12}}/></td>
                      <td onClick={e=>e.stopPropagation()}><input type="number" min="1" max="31" value={editVals.payment_due_day} onChange={e=>setEditVals(v=>({...v,payment_due_day:e.target.value}))} style={{width:50,border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',fontSize:12}}/></td>
                      <td onClick={e=>e.stopPropagation()}><input type="date" value={editVals.issue_date} onChange={e=>setEditVals(v=>({...v,issue_date:e.target.value}))} style={{width:130,border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',fontSize:12}}/></td>
                      <td onClick={e=>e.stopPropagation()}><input type="number" value={editVals.credit_limit} onChange={e=>setEditVals(v=>({...v,credit_limit:e.target.value}))} style={{width:90,border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',fontSize:12}}/></td>
                      <td onClick={e=>e.stopPropagation()}><input type="number" value={editVals.annual_fee} onChange={e=>setEditVals(v=>({...v,annual_fee:e.target.value}))} style={{width:70,border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',fontSize:12}}/></td>
                      <td onClick={e=>e.stopPropagation()}>
                        <select value={editVals.account_id||''} onChange={e=>setEditVals(v=>({...v,account_id:e.target.value?parseInt(e.target.value):null}))} style={{fontSize:12,border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',maxWidth:150}}>
                          <option value="">-- Not linked --</option>
                          {allAccounts.map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)}
                        </select>
                      </td>
                      <td onClick={e=>e.stopPropagation()} style={{minWidth:120}}>
                        <SearchCreateSelect value={editVals.primary_user||''} options={people} placeholder="Shared / unassigned"
                          emptyLabel="Shared / unassigned" onChange={v=>setEditVals(vv=>({...vv,primary_user:v}))}/>
                      </td>
                      <td onClick={e=>e.stopPropagation()}><div style={{display:'flex',gap:4}}>
                        <button type="button" className="btn btn-sm btn-success" onClick={()=>saveEdit(c.id)}>Save</button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={cancelEdit}>X</button>
                      </div></td>
                    </>:<>
                      <td style={{fontSize:12,color:'var(--text-muted)'}}>{c.issuer}</td>
                      <td><span style={{fontFamily:'Plus Jakarta Sans',fontSize:11,fontWeight:400,color:networkColor[c.network]||'var(--text-secondary)'}}>{c.network}</span></td>
                      <td style={{textAlign:'center',fontSize:12,fontFamily:'Plus Jakarta Sans'}}>{c.statement_close_day||'--'}</td>
                      <td style={{textAlign:'center',fontSize:12,fontFamily:'Plus Jakarta Sans'}}>{c.payment_due_day||'--'}</td>
                      <td style={{fontSize:12}}>
                        {c.issue_date
                          ?<>
                            <div style={{fontFamily:'Plus Jakarta Sans'}}>{new Date(c.issue_date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</div>
                            {!!c.annual_fee&&<div style={{fontSize:10,color:'var(--text-muted)'}}>${c.annual_fee} in {daysToAnniversary(c.issue_date.slice(0,10))}d</div>}
                          </>
                          :<span style={{color:'var(--text-muted)'}}>--</span>}
                      </td>
                      <td style={{textAlign:'right',fontSize:13,fontFamily:'Plus Jakarta Sans'}}>{c.credit_limit?`$${c.credit_limit.toLocaleString()}`:<span style={{color:'var(--text-muted)'}}>--</span>}</td>
                      <td style={{textAlign:'right',fontSize:13,fontFamily:'Plus Jakarta Sans',color:c.annual_fee?'var(--red)':'var(--text-muted)'}}>{c.annual_fee?`$${c.annual_fee}`:'$0'}</td>
                      <td style={{fontSize:12}}>
                        {c.account_id
                          ?<span style={{display:'flex',alignItems:'center',gap:4}}>
                            <span style={{width:7,height:7,borderRadius:'50%',background:'var(--green)',display:'inline-block',flexShrink:0}}/>
                            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:130}} title={c.linked_account_name}>{c.linked_account_name}</span>
                          </span>
                          :<span style={{color:'var(--text-muted)',fontSize:11}}>Not linked</span>}
                      </td>
                      <td style={{fontSize:12,color:c.primary_user?'var(--text-primary)':'var(--text-muted)'}}>{c.primary_user||'Shared'}</td>
                      <td onClick={e=>e.stopPropagation()}><button type="button" className="btn btn-sm btn-secondary" onClick={(e)=>{e.stopPropagation();startEdit(c);}}>Edit</button></td>
                    </>}
                  </tr>
                ))}</tbody>
              </table></div>
            }
          </div>
        </div>
      ):(
        /* ACCOUNTS — Portfolio Overview */
        <div>
          {/* Heading + period selector moved into the tab-switcher row above
              (2026-07-24) to save vertical space — no longer duplicated here. */}
          {/* ── Ecosystem cards + challenges ── */}
          {earnLoading
            ?<div style={{padding:60,textAlign:'center'}}><div className="spinner"/></div>
            :earnData?(()=>{
              const ecoColor=(name)=>{
                const n=(name||'').toLowerCase();
                if(n.includes('chase')||n.includes('ultimate'))return'#1a56db';
                if(n.includes('amex')||n.includes('membership'))return'#059669';
                if(n.includes('hilton'))return'#7c3aed';
                if(n.includes('citi'))return'#0891b2';
                if(n.includes('marriott')||n.includes('bonvoy'))return'#b45309';
                if(n.includes('delta')||n.includes('skymiles'))return'#1e40af';
                if(n.includes('hyatt'))return'#9f1239';
                if(n.includes('united')||n.includes('mileageplus'))return'#374151';
                if(n.includes('capital one'))return'#dc2626';
                if(n.includes('atmos'))return'#0891b2';
                if(n.includes('bilt'))return'#15803d';
                return'var(--blue-primary)';
              };
              // Real vector-quality logos Omer supplied (assets/logos_color/,
              // 2026-07-24) — replaces the old small monochrome-silhouette
              // treatment. Files are per-theme (_t_dark/_t_light); some
              // ecosystems only have one variant (chase=dark only, amex=light
              // only — amex's mark has no dark-only elements so its light
              // version reads fine on either theme), so this falls back to
              // whichever exists rather than requiring both.
              const logoVariants={hilton:['dark','light'],amex:['light'],citi:['dark','light'],chase:['dark','light'],
                bonvoy:['dark','light'],delta:['dark','light'],hyatt:['dark','light'],united:['dark','light'],aa:['dark','light'],
                atmos:['dark','light'],capitalone:['dark','light'],bilt:['dark','light']};
              // Marks with their own solid-color backdrop (e.g. Amex's filled
              // blue box) read fine against either theme, so it's safe to
              // reuse their only variant on the "wrong" theme. Bare line-art
              // marks (Chase's dark-only white text has no backdrop of its
              // own) go invisible if forced onto the mismatched theme — for
              // those, no available variant means no logo, not a broken one.
              const selfContainedKeys=new Set(['amex']);
              const logoKey=(name)=>{
                const n=(name||'').toLowerCase();
                if(n.includes('chase')||n.includes('ultimate'))return'chase';
                if(n.includes('amex')||n.includes('membership'))return'amex';
                if(n.includes('hilton'))return'hilton';
                if(n.includes('citi'))return'citi';
                if(n.includes('marriott')||n.includes('bonvoy'))return'bonvoy';
                if(n.includes('delta')||n.includes('skymiles'))return'delta';
                if(n.includes('hyatt'))return'hyatt';
                if(n.includes('united')||n.includes('mileageplus'))return'united';
                if(n.includes('aadvantage'))return'aa';
                if(n.includes('atmos'))return'atmos';
                if(n.includes('capital one'))return'capitalone';
                if(n.includes('bilt'))return'bilt';
                return null;
              };
              const ecoLogo=(name)=>{
                const key=logoKey(name);
                if(!key)return null;
                const variants=logoVariants[key]||[];
                const want=pageTheme==='light'?'light':'dark';
                if(!variants.includes(want)&&!selfContainedKeys.has(key))return null;
                const use=variants.includes(want)?want:variants[0];
                return use?`/static/ecosystem-logos/${key}_t_${use}.png`:null;
              };
              const pointsEcos=earnData.ecosystems.filter(e=>!e.is_cash_back);
              const cashTotal=earnData.cash_back.total+(earnData.ecosystems.filter(e=>e.is_cash_back).reduce((s,e)=>s+e.est_value,0));
              return(
                <>
                  {/* ── Ecosystem Grid — logo-forward tiles, sized down (2026-07-26)
                      so more fit per row/without vertical scroll now that Capital
                      One/Atmos/Bilt bring the ecosystem count past what the old
                      230px-min/220px-tall tiles comfortably fit on one screen. */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:24}}>
                    {pointsEcos.map(eco=>{
                      const col=ecoColor(eco.name);
                      const logo=ecoLogo(eco.name);
                      return(
                        <div key={eco.id}
                          style={{padding:'16px 14px 14px',borderRadius:14,minHeight:140,
                            background:'var(--surface)',border:'1px solid var(--border)',cursor:'pointer',
                            position:'relative',overflow:'hidden',display:'flex',flexDirection:'column',justifyContent:'space-between',
                            transition:'all 0.2s ease'}}
                          onClick={()=>setSelectedEcosystem({id:eco.id,name:eco.name})}
                          onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='var(--shadow-md)';e.currentTarget.style.borderColor=`${col}44`;}}
                          onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='var(--shadow)';e.currentTarget.style.borderColor='var(--border)';}}>
                          <div style={{position:'absolute',top:-36,right:-36,width:120,height:120,borderRadius:'50%',
                            background:`radial-gradient(circle, ${col} 0%, transparent 70%)`,opacity:0.16,pointerEvents:'none'}}/>
                          {logo
                            ?<img src={logo} alt={eco.name} style={{height:56,maxWidth:'100%',objectFit:'contain',objectPosition:'left center',position:'relative',marginBottom:8}}
                                onError={e=>{e.target.style.display='none';e.target.nextSibling.style.display='block';}}/>
                            :null}
                          <div style={{fontSize:12,fontWeight:600,color:'var(--text-secondary)',position:'relative',marginBottom:8,display:logo?'none':'block'}}>{eco.name}</div>
                          <div style={{position:'relative',display:'flex',alignItems:'flex-end',justifyContent:'space-between'}}>
                            <div>
                              <div style={{fontSize:21,fontWeight:300,fontFamily:'Plus Jakarta Sans',letterSpacing:'-0.4px',lineHeight:1,color:'var(--blue-primary)'}}>{(eco.current_balance??eco.points_earned).toLocaleString()}</div>
                              {eco.current_balance!=null&&<div style={{fontSize:10,color:eco.points_earned>=0?'var(--green)':'var(--red)',marginTop:4,fontWeight:300}}>{eco.points_earned>=0?'+':''}{eco.points_earned.toLocaleString()} {earnPeriod.toUpperCase()}</div>}
                              {!!eco.pending_balance&&<div style={{fontSize:10,color:'var(--amber)',marginTop:2,fontWeight:300}}>{Math.round(eco.pending_balance).toLocaleString()} pending</div>}
                            </div>
                            <div style={{color:'var(--text-muted)',fontSize:14,opacity:0.4}}>›</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Cash Back (full width, clickable) ── */}
                  {cashTotal>0&&(
                    <div style={{display:'flex',alignItems:'center',gap:16,padding:'18px 20px',borderRadius:14,
                      background:'var(--surface)',border:'1px solid var(--border)',marginBottom:24,cursor:'pointer',
                      transition:'all 0.2s ease'}}
                      onClick={()=>setSelectedEcosystem({id:'cash-back',name:'Cash Back'})}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='var(--shadow-md)';e.currentTarget.style.borderColor='rgba(217,119,6,0.3)';}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='var(--shadow)';e.currentTarget.style.borderColor='var(--border)';}}>
                      <div style={{width:44,height:30,borderRadius:8,background:'linear-gradient(135deg,#b45309,#d97706)',flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:400,color:'var(--text-primary)'}}>Cash Back</div>
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2,fontWeight:300}}>Earned this period</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:26,fontWeight:300,fontFamily:'Plus Jakarta Sans',lineHeight:1,letterSpacing:'-1px',color:'var(--green)'}}>${cashTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                      </div>
                      <div style={{color:'var(--text-muted)',fontSize:16,marginLeft:4,opacity:0.4}}>›</div>
                    </div>
                  )}

                  {/* ── Empty state ── */}
                  {pointsEcos.length===0&&cashTotal===0&&(
                    <div style={{padding:48,textAlign:'center',color:'var(--text-muted)',fontSize:13,lineHeight:1.6,fontWeight:300}}>
                      No earn data for this period.<br/>Make sure accounts are linked to card products.
                    </div>
                  )}

                  {/* ── Your Cards (horizontal scroll) ── */}
                  {accounts.length>0&&(
                    <div style={{marginBottom:24}}>
                      <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',letterSpacing:1.5,textTransform:'uppercase',marginBottom:12}}>Your Cards</div>
                      {/* paddingTop matches paddingBottom so the hover-lift transform
                          (translateY(-3px) scale(1.02) below) has room to render without
                          getting clipped — setting overflowX:auto implicitly computes
                          overflowY to auto too (CSS spec), not visible, so a lifted tile
                          would otherwise get its top edge cut off by the container. */}
                      <div style={{display:'flex',gap:12,overflowX:'auto',paddingTop:8,paddingBottom:8}}>
                        {accounts.map(acct=>{
                          const prod=getProductForAccount(acct.id);
                          const cardKey=prod?.product_key;
                          const imgSrc=cardKey?`/static/cards/${cardKey}.png`:null;
                          // Same key-naming fix as EcosystemDetailPage's cardGrads above —
                          // must match CardProduct.product_key exactly (e.g.
                          // 'chase_freedom_flex', not 'freedom_flex').
                          const cardGrads={
                            chase_freedom_flex:'linear-gradient(135deg,#0d9488,#115e59)',
                            chase_freedom:'linear-gradient(135deg,#1e40af,#1e3a5f)',
                            chase_freedom_unlimited:'linear-gradient(135deg,#0369a1,#0c4a6e)',
                            chase_sapphire_preferred:'linear-gradient(135deg,#1e3a5f,#0f172a)',
                            chase_sapphire_reserve:'linear-gradient(135deg,#0f172a,#020617)',
                            hilton_aspire:'linear-gradient(135deg,#4c1d95,#2e1065)',
                            united_quest:'linear-gradient(135deg,#374151,#111827)',
                            united_explorer:'linear-gradient(135deg,#1e3a5f,#0f172a)',
                            delta_gold:'linear-gradient(135deg,#1e3a5f,#0f172a)',
                            marriott_bonvoy_boundless:'linear-gradient(135deg,#78350f,#451a03)',
                            hyatt_personal:'linear-gradient(135deg,#7f1d1d,#450a0a)',
                            citi_custom_cash:'linear-gradient(135deg,#155e75,#0c4a5e)',
                            citi_double_cash:'linear-gradient(135deg,#0e7490,#164e63)',
                            citi_strata:'linear-gradient(135deg,#164e63,#0c4a5e)',
                            citi_strata_premier:'linear-gradient(135deg,#0c4a6e,#082f49)',
                            citi_strata_elite:'linear-gradient(135deg,#1e1b4b,#312e81)',
                            us_bank_cash_plus:'linear-gradient(135deg,#6b21a8,#4c1d95)',
                            amex_blue_business_plus:'linear-gradient(135deg,#1e40af,#1e3a5f)',
                            amex_gold:'linear-gradient(135deg,#b8860b,#8b6914)',
                            amex_platinum:'linear-gradient(135deg,#57534e,#292524)',
                            capital_one_venture:'linear-gradient(135deg,#991b1b,#450a0a)',
                            capital_one_venture_x:'linear-gradient(135deg,#450a0a,#1c0a0a)',
                          };
                          const bg=cardGrads[cardKey]||'linear-gradient(135deg,#374151,#1f2937)';
                          return(
                            <div key={acct.id} title={prod?.card_name||acct.account_name}
                              onClick={()=>{setPendingChallengeFilter(null);setSelectedAccount(acct.id);}}
                              style={{width:180,height:114,borderRadius:12,background:bg,padding:'14px 16px',
                                flexShrink:0,cursor:'pointer',position:'relative',overflow:'hidden',
                                boxShadow:'0 4px 12px rgba(0,0,0,0.3)',transition:'transform 0.2s ease',
                                display:'flex',flexDirection:'column',justifyContent:'flex-end'}}
                              onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-3px) scale(1.02)';}}
                              onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';}}>
                              {/* Real card art shown near-full-strength (not the old 0.3 wash-out) —
                                  a bottom-anchored scrim (not a flat opacity cut) keeps the mask
                                  legible without dimming the art itself. Card name deliberately
                                  dropped from the face (made the tile busy) — it's on the native
                                  hover tooltip (title=) instead, same as ChallengeCard elsewhere. */}
                              {imgSrc&&<img src={imgSrc} alt="" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',borderRadius:12,opacity:0.95}} onError={e=>{e.target.style.display='none'}}/>}
                              {imgSrc&&<div style={{position:'absolute',inset:0,borderRadius:12,background:'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 45%, transparent 68%)'}}/>}
                              {/* Network-chip placeholder removed — it was a static
                                  translucent box never wired to real network data, and
                                  the card art itself already shows the real Visa/etc. logo. */}
                              {/* Digits sit inside their own dark, mostly-opaque rounded badge
                                  instead of directly on the art — sized to just the four digits
                                  (not a wide bar) so the badge's own edge already reads as "this is
                                  the number," making the "···" redaction prefix redundant, and the
                                  dark backdrop keeps the digits from blending into busy/bright card
                                  art underneath (F9, 2026-07-25; tightened + darkened 2026-07-26).
                                  Inner span has a fixed minWidth (measured for "0000", the widest
                                  4-digit combo at this font — "1111" is the narrowest at ~59% of
                                  that) so every badge is the same size regardless of which digits
                                  a given card happens to have, instead of hugging narrower digits
                                  into a smaller box. */}
                              {acct.mask&&<div style={{position:'relative',zIndex:1,display:'inline-block',padding:'2px 6px',borderRadius:5,background:'rgba(0,0,0,0.78)',border:'1px solid rgba(255,255,255,0.1)'}}>
                                <span style={{fontSize:13,fontWeight:700,letterSpacing:'0.5px',color:'#fff',display:'inline-block',minWidth:39,textAlign:'center'}}>{acct.mask}</span>
                              </div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Active Challenges ── */}
                  {earnData.active_challenges.length>0&&(
                    <div>
                      <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',letterSpacing:1.5,textTransform:'uppercase',marginBottom:12}}>Active Challenges</div>
                      <div className="grid-auto-sm" style={{gap:10}}>
                        {earnData.active_challenges.map(ch=><ChallengeCard key={ch.id} ch={ch} onClick={()=>openChallenge(ch)}/>)}
                      </div>
                    </div>
                  )}
                </>
              );
            })()
            :<div style={{padding:48,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>Could not load portfolio data.</div>
          }
        </div>
      )}
    </div>
  );
}
