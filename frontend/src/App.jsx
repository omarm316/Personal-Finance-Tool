import {useState,useEffect,useCallback,useRef} from 'react';
import {MobileNav} from './components/MobileNav';
import {PullToRefreshIndicator} from './components/PullToRefreshIndicator';
import {Sidebar} from './components/Sidebar';
import {ToastContainer} from './components/ToastContainer';
import {useHashRouter,usePlaidLink,usePullToRefresh,useToast} from './hooks/index';
import {apiFetch} from './lib/api';
import {AccountsPage} from './pages/AccountsPage';
import {BudgetsPage} from './pages/BudgetsPage';
import {CardsPage} from './pages/CardsPage';
import {CashFlowPage} from './pages/CashFlowPage';
import {DailyBalancesPage} from './pages/DailyBalancesPage';
import {DashboardPage} from './pages/DashboardPage';
import {GCBPage} from './pages/GCBPage';
import {LoansPage} from './pages/LoansPage';
import {NetWorthPage} from './pages/NetWorthPage';
import {SettingsPage} from './pages/SettingsPage';
import {TransactionsPage} from './pages/TransactionsPage';

export function App(){
  const{page,navigate}=useHashRouter();
  const setPage=useCallback((p)=>navigate(p),[navigate]);
  const[categories,setCategories]=useState([]);
  const[banks,setBanks]=useState([]);
  const[collapsed,setCollapsed]=useState(()=>{try{const v=localStorage.getItem('nav-collapsed');return v===null?true:v==='1';}catch(e){return true;}});
  const[refreshKey,setRefreshKey]=useState(0);
  const[refreshing,setRefreshing]=useState(false);
  const[pendingDupScan,setPendingDupScan]=useState(false);
  const[theme,setTheme]=useState(()=>{try{return localStorage.getItem('theme')||'dark'}catch(e){return'dark'}});
  const{toasts,toast}=useToast();
  const contentRef=useRef(null);

  useEffect(()=>{document.documentElement.setAttribute('data-theme',theme);try{localStorage.setItem('theme',theme)}catch(e){}const tc=document.querySelector('meta[name="theme-color"]');if(tc)tc.content=theme==='dark'?'#0c0c10':'#f5f3ef';},[theme]);

  const handleRefresh=useCallback(()=>{
    setRefreshing(true);
    setRefreshKey(k=>k+1);
    setTimeout(()=>setRefreshing(false),600);
  },[]);
  const{ptrState,pullY}=usePullToRefresh(contentRef,handleRefresh);

  const loadMeta=useCallback(async()=>{
    try{const[c,b]=await Promise.all([apiFetch('/categories'),apiFetch('/plaid/items')]);setCategories(c);setBanks(b);}catch(e){}
  },[]);

  // Auto-sync on app open — throttled to once per 20 minutes so refreshing
  // the page doesn't hammer Plaid.  Runs silently in the background.
  useEffect(()=>{
    loadMeta();
    if(!document.getElementById('plaid-script')){const s=document.createElement('script');s.id='plaid-script';s.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';document.head.appendChild(s);}
    const AUTO_SYNC_INTERVAL=20*60*1000;
    const last=parseInt(localStorage.getItem('lastAutoSync')||'0');
    if(Date.now()-last>AUTO_SYNC_INTERVAL){
      localStorage.setItem('lastAutoSync',String(Date.now()));
      apiFetch('/plaid/sync-transactions',{method:'POST'})
        .then(r=>{
          if(r.items_errored>0){
            const names=r.errored.map(e=>e.institution_name).join(', ');
            toast(`⚠️ ${r.items_errored} bank${r.items_errored!==1?' accounts need':'account needs'} reconnecting: ${names}`,'error');
          }
          if(r.items_cursor_reset>0){
            toast(`↺ ${r.items_cursor_reset} stuck account${r.items_cursor_reset!==1?'s':''} reset — re-downloading transactions`);
          }
          setTimeout(loadMeta,15000);
          apiFetch('/challenges/recalc-all',{method:'POST'}).catch(()=>{});
        })
        .catch(()=>{});
    }
  },[]);

  const sync=async()=>{
    try{
      const r=await apiFetch('/plaid/sync-transactions',{method:'POST'});
      if(r.items_errored>0&&r.items_queued===0){
        const names=r.errored.map(e=>e.institution_name).join(', ');
        toast(`Sync skipped — reconnect required: ${names} (Settings → Connected Banks)`,'error');
      }else if(r.items_errored>0){
        const names=r.errored.map(e=>e.institution_name).join(', ');
        const resetNote=r.items_cursor_reset>0?` (${r.items_cursor_reset} re-downloading from scratch)`:'';
        toast(`Syncing ${r.items_queued} bank${r.items_queued!==1?'s':''}${resetNote} — reconnect required: ${names}`,'error');
      }else if(r.items_cursor_reset>0){
        toast(`↺ ${r.items_cursor_reset} stuck account${r.items_cursor_reset!==1?'s':''} reset + syncing ${r.items_queued} bank${r.items_queued!==1?'s':''} — transactions will appear shortly`);
      }else{
        toast(`Syncing ${r.items_queued} bank${r.items_queued!==1?'s':''} — new transactions will appear shortly`);
      }
      loadMeta();
      setTimeout(loadMeta,15000);
      apiFetch('/challenges/recalc-all',{method:'POST'}).catch(()=>{});
    }catch(e){toast('Sync failed: '+(e.message||e),'error');}
  };

  /* After a successful link: reload meta; if new accounts were created,
     navigate to Settings → Bank Links and auto-trigger a duplicate scan */
  const handleLinkDone=useCallback((hasNew)=>{
    loadMeta();
    if(hasNew){setPage('settings');setPendingDupScan(true);}
  },[loadMeta]);

  const[openPlaid,linkSummaryModal]=usePlaidLink(toast,handleLinkDone);
  const[online,setOnline]=useState(navigator.onLine);
  useEffect(()=>{
    const on=()=>{setOnline(true);handleRefresh();toast('Back online — refreshing data');};
    const off=()=>{setOnline(false);toast('You\'re offline — showing cached data','error');};
    window.addEventListener('online',on);window.addEventListener('offline',off);
    return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off);};
  },[handleRefresh]);
  const titles={dashboard:'Dashboard',transactions:'Transactions',budgets:'Budgets',networth:'Net Worth',cashflow:'Daily Balance Timeline',cashplanner:'Cash Flow & Forecasting',loans:'Loans',gcb:'GCB',cards:'Cards',accounts:'Accounts',settings:'Settings'};

  return(
    <div className="app-container">
      <Sidebar page={page} setPage={setPage} banks={banks} onConnectBank={openPlaid} onSync={sync} collapsed={collapsed} setCollapsed={setCollapsed}/>
      
      <div className="main" style={{ marginLeft: collapsed ? 72 : 240 }}>
        <header className="topbar">
          <div className="topbar-title">{titles[page]}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!online && <div className="badge badge-expense" style={{ fontSize: 10 }}>OFFLINE</div>}
            {banks.length > 0 && <div className="badge badge-income" style={{ fontSize: 10 }}>{banks.length} ACTIVE</div>}
            
            <button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
              <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
              <span className="hide-mobile">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </button>

            <button type="button" className="btn btn-secondary btn-sm" onClick={handleRefresh} title="Refresh data" style={{ padding: '6px 10px' }}>
              <span style={{ display: 'inline-block', transition: 'transform 0.4s', transform: refreshing ? 'rotate(360deg)' : 'rotate(0deg)' }}>↻</span>
            </button>
          </div>
        </header>

        <main className="content" ref={contentRef}>
          <PullToRefreshIndicator pullY={pullY} ptrState={ptrState}/>
          {page==='dashboard'&&<DashboardPage categories={categories} toast={toast} setPage={setPage} refreshKey={refreshKey}/>}
          {page==='transactions'&&<TransactionsPage categories={categories} toast={toast} refreshKey={refreshKey}/>}
          {page==='budgets'&&<BudgetsPage categories={categories} toast={toast} refreshKey={refreshKey}/>}
          {page==='cashflow'&&<DailyBalancesPage toast={toast} refreshKey={refreshKey}/>}
          {page==='cashplanner'&&<CashFlowPage toast={toast} refreshKey={refreshKey}/>}
          {page==='networth'&&<NetWorthPage toast={toast} refreshKey={refreshKey}/>}
          {page==='loans'&&<LoansPage toast={toast} refreshKey={refreshKey}/>}
          {page==='accounts'&&<AccountsPage banks={banks} onConnectBank={openPlaid} onSync={sync} toast={toast} refreshKey={refreshKey}/>}
          {page==='cards'&&<CardsPage toast={toast} refreshKey={refreshKey}/>}
          {page==='gcb'&&<GCBPage toast={toast} refreshKey={refreshKey}/>}
          {page==='settings'&&<SettingsPage banks={banks} onConnectBank={openPlaid} toast={toast} onBanksChanged={loadMeta} categories={categories} autoScan={pendingDupScan} onAutoScanDone={()=>setPendingDupScan(false)}/>}
        </main>
      </div>

      <ToastContainer toasts={toasts}/>
      {linkSummaryModal}
      <MobileNav page={page} setPage={setPage}/>
    </div>
  );
}

export default App;
