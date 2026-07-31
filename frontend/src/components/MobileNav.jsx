export function MobileNav({page,setPage}){
  const S=({d,sz=20})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
  const tabs=[
    {id:'dashboard',label:'Home',icon:<S d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>},
    {id:'transactions',label:'Txns',icon:<S d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/>},
    {id:'cards',label:'Cards',icon:<S d="M1 4h22v16H1V4zm0 6h22"/>},
    {id:'budgets',label:'Budget',icon:<S d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 6v4l3 3"/>},
    {id:'settings',label:'More',icon:<S d="M12 13a1 1 0 100-2 1 1 0 000 2zm7 0a1 1 0 100-2 1 1 0 000 2zM5 13a1 1 0 100-2 1 1 0 000 2z"/>},
  ];
  return(
    <nav className="mobile-nav">
      {tabs.map(t=>(
        <button type="button" key={t.id} className={`mobile-nav-btn${page===t.id?' active':''}`} onClick={(e)=>{e.preventDefault();setPage(t.id);}}>
          <span className="nav-icon">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
