import {useState} from 'react';
import {Icon} from './Icon';

export function Sidebar({page,setPage,banks,onConnectBank,onSync,collapsed,setCollapsed}){
  const nav=[
    {id:'dashboard',icon:<Icon name="home"/>,label:'Dashboard'},
    {id:'transactions',icon:<Icon name="arrowUpDown"/>,label:'Transactions'},
    {id:'budgets',icon:<Icon name="target"/>,label:'Budgets'},
    {id:'networth',icon:<Icon name="trendingUp"/>,label:'Net Worth'},
    {id:'cashflow',icon:<Icon name="calendar"/>,label:'Daily Balances'},
    {id:'cashplanner',icon:<Icon name="banknote"/>,label:'Cash Flow'},
    {id:'loans',icon:<Icon name="building"/>,label:'Loans'},
    {id:'gcb',icon:<Icon name="star"/>,label:'GCB'},
    {id:'cards',icon:<Icon name="creditCard"/>,label:'Cards'},
    {id:'accounts',icon:<Icon name="wallet"/>,label:'Accounts'},
    {id:'settings',icon:<Icon name="settings"/>,label:'Settings'},
  ];
  const uniqueBanks=[...new Map(banks.map(b=>[b.institution_name,b])).values()];
  const toggle=()=>{const next=!collapsed;setCollapsed(next);try{localStorage.setItem('nav-collapsed',next?'1':'0');}catch(e){}};
  const[banksOpen,setBanksOpen]=useState(()=>{try{return localStorage.getItem('banks-open')!=='0';}catch(e){return true;}});
  const toggleBanks=()=>{const next=!banksOpen;setBanksOpen(next);try{localStorage.setItem('banks-open',next?'1':'0');}catch(e){}};

  return(
    <aside className={`sidebar${collapsed?' collapsed':''}`}>
      <div className="sidebar-logo">
        <div className="logo-icon-box">M</div>
        {!collapsed&&<h1>Moresheth</h1>}
      </div>
      
      <button type="button" className="sidebar-toggle" onClick={toggle} title={collapsed?'Expand':'Collapse'}>
        <Icon name={collapsed?'chevronRight':'chevronLeft'} size={14}/>
      </button>

      <nav className="sidebar-nav">
        {nav.map(n=>(
          <button type="button" key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={(e)=>{e.preventDefault();setPage(n.id);}} title={collapsed?n.label:''}>
            <span className="nav-icon">{n.icon}</span>
            {!collapsed&&<span>{n.label}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:1,marginBottom:8,padding:'0 4px'}}>Connections</div>}
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {banksOpen && !collapsed && uniqueBanks.map((b,i)=>(
            <div key={i} className="sidebar-bank"><span className="bank-dot"/><span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{b.institution_name}</span></div>
          ))}
          <div style={{display:'flex',gap:6,marginTop:collapsed?0:8}}>
            <button type="button" className="btn btn-sm btn-primary" style={{flex:1,justifyContent:'center'}} onClick={onConnectBank} title="Connect bank">{collapsed?'+':'+ Bank'}</button>
            {!collapsed && <button type="button" className="btn btn-sm btn-secondary" style={{flex:1,justifyContent:'center'}} onClick={onSync}>Sync</button>}
          </div>
        </div>
      </div>
    </aside>
  );
}

/* Sort categories: alphabetical, with "Other", "Unclassified" pinned to the bottom */
