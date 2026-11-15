import {SheetCell} from '../../components/ui/SheetCell';
import {MON,fv,flags,isCur,lastDay,m0,r2,sg,unitsFor} from '../../lib/budgetData';

export const LockIcon=()=><svg className="bg-lk" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;

/* Month view: income, expenses (one row per top level that opens), net.
   Most spent first at both levels; the budget column is spreadsheet cells. */
export function MonthView({M,T,Y,mo,open,toggle,detail,setDetail,locked,onSave,onPaste}){
  const ms=[mo],lk=locked(mo),cur=isCur(T,Y,mo);
  const inc=unitsFor(M,true,ms,'spend'),exp=unitsFor(M,false,ms,'spend');
  const tot=(list,isInc,label)=>flags({cat:label,inc:isInc,isTot:true,budget:r2(list.reduce((s,u)=>s+u.budget,0)),actual:r2(list.reduce((s,u)=>s+u.actual,0))});
  const ti=tot(inc,true,'Total Income'),te=tot(exp,false,'Total Expenses');
  const net={cat:'NET',isNet:true,budget:ti.budget-te.budget,actual:ti.actual-te.actual};
  const mark=cur?`${(T.d/lastDay(Y,mo)*100).toFixed(1)}%`:null;

  const budgetCell=u=>{
    if(u.isNet)return sg(u.budget);
    if(u.oth)return <span className="bg-oth" title={`Other: the ${u.cat} total minus its categories`}>{u.budget?m0(u.budget):'—'}</span>;
    if(!u.ek)return u.budget?m0(u.budget):<span className="bg-dim">—</span>;
    if(lk)return <span className="bg-lkc" title={`${MON[mo-1]} ${Y} is past, so its budget is locked`}>{u.budget?m0(u.budget):''}</span>;
    return <SheetCell k={u.ek} m={mo} g="month" row={u.ek} col="b" show={u.budget?m0(u.budget):''} raw={fv(u.budget)}
      label={`${u.isG?u.cat+' total':u.cat}, ${MON[mo-1]} budget`} onSave={onSave} onPaste={onPaste}/>;
  };
  const row=(u,lvl,kind)=>{
    const grp=!!(u.isG&&u.kids?.length),isOpen=!!open[u.cat],click=kind==='row';
    return(
      <div key={(kind||'')+u.key+(u.cat||'')} className={`bg-r ${kind||''} ${lvl?'kid':''} ${grp?'grp':''} ${click&&detail===u.key?'on':''} ${click?'click':''}`}
        onClick={click?()=>setDetail(d=>d===u.key?null:u.key):undefined}>
        <span className="bg-nm">
          {grp&&<button type="button" className={`bg-car ${isOpen?'on':''}`} aria-expanded={isOpen} aria-label={`${isOpen?'Hide':'Show'} the categories in ${u.cat}`}
            onClick={e=>{e.stopPropagation();toggle(u.cat);}}>▸</button>}
          <span className={`tx ${u.oth?'oth':''}`}>{u.oth?'Other':u.cat}</span>
          {grp&&!isOpen&&<span className="bg-cnt">{u.kids.length-1}</span>}
        </span>
        <span className="c"><span className="bg-ab"><Amt u={u}/>{u.hasB&&!u.isNet?<MiniBar u={u} mark={mark}/>:<i className="bg-mbsp"/>}</span></span>
        <span className="c c-budget" onClick={e=>e.stopPropagation()}>{budgetCell(u)}</span>
        <span className="c"><Variance u={u}/></span>
      </div>
    );
  };
  const section=(label,units)=>[
    <div className="bg-sec" key={'s'+label}>{label}</div>,
    ...units.flatMap(u=>[row(u,0,'row'),...(u.isG&&open[u.cat]?u.kids.map(k=>row(k,1,'row')):[])]),
  ];
  return(
    <div className="bg-lst" data-sheet>
      <div className="bg-r head">
        <span>Category</span><span className="c">Actual</span>
        <span className="c c-budget">{MON[mo-1]} budget{lk&&<LockIcon/>}</span><span className="c">Variance</span>
      </div>
      {section('Income',inc)}
      {row(ti,0,'tot')}
      {section('Expenses',exp)}
      {row(te,0,'tot')}
      {row(net,0,'net')}
    </div>
  );
}

export function Amt({u}){
  const a=u.actual;
  if(u.isNet)return <span className={a>=0?'c-good':'c-bad'}>{sg(a)}</span>;
  if(Math.abs(a)<.005)return <span className="bg-dim">—</span>;
  if(u.credit)return <span className="c-good">+{m0(-a)}</span>;
  return <span className={u.inc?'c-good':u.over?'c-bad':''}>{m0(a)}</span>;
}

function MiniBar({u,mark}){
  return(
    <span className="bg-mb"><i className={u.inc?'inc':u.over?'over':''} style={{width:`${Math.min(Math.max(u.pct,0),1)*100}%`}}/>
      {mark&&!u.inc&&<s style={{left:mark}} title="Even pace for today"/>}</span>
  );
}

/* Signed, green when good: "+$262" / "−$4,970" */
function Variance({u}){
  if(u.isNet){const d=u.actual-u.budget;return Math.abs(d)<.5?<span className="bg-dim">—</span>:<span className={d>=0?'c-good':'c-bad'}>{sg(d)}</span>;}
  if(Math.abs(u.v)<.5)return <span className="bg-dim">—</span>;
  return <span className={u.v>0?'c-good':'c-bad'}>{sg(u.v)}</span>;
}
