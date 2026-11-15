import {SheetCell} from '../../components/ui/SheetCell';
import {ALL12,MON,fv,heatBg,isCur,isFuture,m2,monthsSoFar,sx,unitsFor} from '../../lib/budgetData';
import {LockIcon} from './MonthView';

/* The Annual view's two Excel-style sheets: the Spent heat map and the Edit
   Year budgets sheet. Rows follow category order; top levels open in the
   heat map and are always open in the budgets sheet. */

function Head({T,Y,locked}){
  return(
    <div className="bg-yr head">
      <span className="yn">Category</span>
      {MON.map((l,i)=><span key={l} className={`${isCur(T,Y,i+1)?'cur':''} ${locked(i+1)?'lkh':''}`}>{l}{locked(i+1)&&<LockIcon/>}</span>)}
      <span className="ytot">Total</span>
    </div>
  );
}

function Name({u,lvl,grp,open,toggle,onClick,on}){
  return(
    <span className={`yn ${onClick?'click':''} ${on?'on':''}`} onClick={onClick} role={onClick?'button':undefined} tabIndex={onClick?0:undefined}
      onKeyDown={onClick?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick();}}:undefined}>
      <span className={`bg-nm ${lvl?'kid':''}`}>
        {grp&&<button type="button" className={`bg-car ${open?'on':''}`} aria-expanded={open} aria-label={`${open?'Hide':'Show'} the categories in ${u.cat}`}
          onClick={e=>{e.stopPropagation();toggle(u.cat);}}>▸</button>}
        <span className={`tx ${u.oth?'oth':''}`}>{u.oth?'Other':u.cat}</span>
        {grp&&!open&&<span className="bg-cnt">{u.kids.length-1}</span>}
      </span>
    </span>
  );
}

const sumTops=(M,inc,f,m)=>M.tops(inc).reduce((s,t)=>s+f('g:'+t,m),0);

/* Spent: each month's spending in whole dollars, colored against that
   month's own budget. Months to come show their budget in grey. Clicking a
   month edits its budget in the cell. */
export function HeatSheet({M,T,Y,open,toggle,detail,setDetail,locked,onSave,onPaste,cf}){
  const n=monthsSoFar(T,Y);
  const cell=(u,m)=>{
    const k=u.key,b=M.bOf(k,m),a=M.aOf(k,m),fut=isFuture(T,Y,m),cur=isCur(T,Y,m);
    const show=fut?(b?sx(b):''):Math.abs(a)>=.5?sx(a,{credit:!u.inc}):b?'0':'';
    const bg=cf&&!fut?heatBg(b,a,u.inc):null;
    const tip=`${u.oth?'Other':u.cat}, ${MON[m-1]}: ${m2(a)} ${u.inc?'received':'spent'}${b?' of '+m2(b):', no budget'}`;
    const cls=`yc ${cur?'cur':''} ${fut?'fut':''}`;
    if(u.ek&&!locked(m))return(
      <span key={m} className={`${cls} ed`} style={bg?{background:bg}:undefined}>
        <SheetCell k={u.ek} m={m} g="heat" row={u.ek} col={m} show={show} raw={fv(b)} className="hc" cap={`${MON[m-1]} budget`}
          label={`${u.isG?u.cat+' total':u.cat}, ${MON[m-1]} budget`} title={tip} onSave={onSave} onPaste={onPaste}/>
      </span>
    );
    return <span key={m} className={cls} style={bg?{background:bg}:undefined} title={tip}>{show}</span>;
  };
  const total=u=>{
    const bY=ALL12.filter(m=>m<=n).reduce((s,m)=>s+M.bOf(u.key,m),0),ta=ALL12.reduce((s,m)=>s+M.aOf(u.key,m),0);
    const bg=cf?heatBg(bY,ta,u.inc):null;
    return <span className="ytot" style={bg?{background:bg}:undefined}>{sx(ta,{credit:!u.inc})}</span>;
  };
  const row=(u,lvl)=>{
    const grp=!!(u.isG&&u.kids?.length),isOpen=!!open[u.cat];
    return(
      <div key={u.key} className={`bg-yr ${lvl?'kid':''} ${grp?'grp':''} ${u.oth?'othr':''}`}>
        <Name u={u} lvl={lvl} grp={grp} open={isOpen} toggle={toggle} on={detail===u.key} onClick={()=>setDetail(d=>d===u.key?null:u.key)}/>
        {ALL12.map(m=>cell(u,m))}
        {total(u)}
      </div>
    );
  };
  const totRow=(label,inc)=>{
    let TA=0,BY=0;
    const cells=ALL12.map(m=>{
      const b=sumTops(M,inc,M.bOf,m),a=sumTops(M,inc,M.aOf,m),fut=isFuture(T,Y,m);TA+=a;if(m<=n)BY+=b;
      const bg=cf&&!fut?heatBg(b,a,inc):null;
      return <span key={m} className={`yc ${fut?'fut':''}`} style={bg?{background:bg}:undefined}>{fut?(b?sx(b):''):sx(a,{credit:!inc,zero:true})}</span>;
    });
    const bg=cf?heatBg(BY,TA,inc):null;
    return <div className="bg-yr tot"><span className="yn">{label}</span>{cells}<span className="ytot" style={bg?{background:bg}:undefined}>{sx(TA,{credit:!inc,zero:true})}</span></div>;
  };
  const netRow=()=>{
    let NA=0;
    const cells=ALL12.map(m=>{
      const nb=sumTops(M,true,M.bOf,m)-sumTops(M,false,M.bOf,m),na=sumTops(M,true,M.aOf,m)-sumTops(M,false,M.aOf,m);
      if(isFuture(T,Y,m))return <span key={m} className="yc fut">{Math.abs(nb)>=.5?sx(nb,{signed:true}):''}</span>;
      NA+=na;
      return <span key={m} className="yc"><b className={cf?(na>=0?'c-good':'c-bad'):''}>{sx(na,{signed:true,zero:true})}</b></span>;
    });
    return <div className="bg-yr net"><span className="yn">Net</span>{cells}<span className="ytot"><b className={cf?(NA>=0?'c-good':'c-bad'):''}>{sx(NA,{signed:true,zero:true})}</b></span></div>;
  };
  const section=(label,inc)=>[
    <div className="bg-ysec" key={'s'+label}>{label}</div>,
    ...unitsFor(M,inc,ALL12,'tree').flatMap(u=>[row(u,0),...(u.isG&&open[u.cat]?u.kids.map(k=>row(k,1)):[])]),
    <div key={'t'+label}>{totRow(`Total ${label.toLowerCase()}`,inc)}</div>,
  ];
  return(
    <div className="bg-yg" data-sheet>
      <Head T={T} Y={Y} locked={locked}/>
      {section('Income',true)}
      {section('Expenses',false)}
      {netRow()}
    </div>
  );
}

/* Edit Year: every category's twelve budgets as cells. A top level's row is
   its total; the grey Other row under it is the total minus its categories.
   Spending shows on hover. */
export function BudgetSheet({M,T,Y,locked,onSave,onPaste}){
  const row=(u,lvl,cls='')=>{
    let tot=0;
    const cells=ALL12.map(m=>{
      const b=M.bOf(u.key,m),a=M.aOf(u.key,m),show=sx(b);tot+=b;
      const name=u.oth?`Other (${u.cat})`:u.isG?`${u.cat} total`:u.cat;
      const tip=`${name}, ${MON[m-1]}: budget ${b?m2(b):'none'} · ${u.inc?'received':'spent'} ${Math.abs(a)>=.5?m2(a):'nothing'}`;
      const c=isCur(T,Y,m)?'cur':'';
      if(!u.ek)return <span key={m} className={`scw ${c}`}><span className="bg-lkc oth" title={`${tip} · Other is the total minus its categories`}>{show}</span></span>;
      if(locked(m))return <span key={m} className={`scw ${c}`}><span className="bg-lkc" title={`${tip} · past month, locked`}>{show}</span></span>;
      return <span key={m} className={`scw ${c}`}><SheetCell k={u.ek} m={m} g="grid" row={u.ek} col={m} show={show} raw={fv(b)}
        label={`${name}, ${MON[m-1]} budget`} title={tip} onSave={onSave} onPaste={onPaste}/></span>;
    });
    return(
      <div key={u.key} className={`bg-yr sh ${lvl?'kid':''} ${cls}`}>
        <span className="yn"><span className={`bg-nm ${lvl?'kid':''}`}><span className={`tx ${u.oth?'oth':''}`}>{u.oth?'Other':u.cat}</span></span></span>
        {cells}
        <span className="ytot">{sx(tot,{zero:true})}</span>
      </div>
    );
  };
  const sumRow=(label,inc)=>{
    let T2=0;
    const cells=ALL12.map(m=>{const v=sumTops(M,inc,M.bOf,m);T2+=v;return <span key={m}>{sx(v,{zero:true})}</span>;});
    return <div className="bg-yr tot"><span className="yn">{label}</span>{cells}<span className="ytot">{sx(T2,{zero:true})}</span></div>;
  };
  const section=(label,inc)=>[
    <div className="bg-ysec" key={'s'+label}>{label}</div>,
    ...unitsFor(M,inc,ALL12,'tree').flatMap(u=>u.isG?[row(u,0,'grp'),...u.kids.map(k=>row(k,1,k.oth?'othr':''))]:[row(u,0)]),
    <div key={'t'+label}>{sumRow(`Total ${label.toLowerCase()}`,inc)}</div>,
  ];
  return(
    <div className="bg-yg" data-sheet>
      <Head T={T} Y={Y} locked={locked}/>
      {section('Income',true)}
      {section('Expenses',false)}
    </div>
  );
}
