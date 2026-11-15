import {useEffect,useState} from 'react';
import {apiFetch} from '../../lib/api';
import {ALL12,MON,MONL,flags,isFuture,keyName,lastDay,m2,ncat,r2} from '../../lib/budgetData';

const SHOW=20;
const pad=n=>String(n).padStart(2,'0');

/* The side panel a category opens: the amount spent of its budget for the
   period, a top level's categories, the year by month, then the period's
   transactions. It closes only with its ✕. */
export function BudgetPanel({M,T,Y,mo,view,dkey,refreshKey,toast,onClose,onMore}){
  const grp=dkey.startsWith('g:'),oth=dkey.startsWith('o:'),name=keyName(dkey);
  const top=grp||oth?name:M.topOf(name),yr=view!=='month',ms=yr?ALL12:[mo];
  const inc=M.isInc(name);
  const r=flags({inc,budget:r2(ms.reduce((s,m)=>s+M.bOf(dkey,m),0)),actual:r2(ms.reduce((s,m)=>s+M.aOf(dkey,m),0))});
  const start=`${Y}-${pad(ms[0])}-01`,end=`${Y}-${pad(ms[ms.length-1])}-${pad(lastDay(Y,ms[ms.length-1]))}`;
  const period=yr?String(Y):`${MONL[mo-1]} ${Y}`;

  const[rows,setRows]=useState(null);
  useEffect(()=>{
    let alive=true;setRows(null);
    // Ask for the whole top level and keep the wanted rows; Unclassified shows as Other.
    const asks=top==='Other'?['Other','Unclassified']:[top];
    Promise.all(asks.map(c=>apiFetch(`/stats/detail?category=${encodeURIComponent(c)}&start_date=${start}&end_date=${end}`)))
      .then(rs=>{
        if(!alive)return;
        const want=x=>{
          const c=ncat(x.category);
          if(grp)return M.topOf(c)===name;
          if(oth){if(c===name)return true;const m=Number(x.date.slice(5,7));return M.topOf(c)===name&&M.getB(c,m)<=0;}
          return c===name;
        };
        setRows(rs.flatMap(x=>x.rows||[]).filter(want).map(x=>({...x,v:-(x.is_split?x.split_amount:x.amount)}))
          .sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:b.v-a.v));
      })
      .catch(()=>{if(alive){setRows([]);toast('Failed to load the category\'s transactions','error');}});
    return()=>{alive=false;};
  },[dkey,start,end,refreshKey]);// eslint-disable-line react-hooks/exhaustive-deps

  const a=r.actual,b=r.budget;
  const status=inc?null:r.hasB?(r.over?<span className="c-bad">{m2(a-b)} over</span>:<span className="c-good">{m2(b-a)} left</span>)
    :r.credit?<span className="c-good">net credit</span>:<span className="c-mut">no budget set</span>;
  const kids=grp?[{k:'o:'+name,label:'Other'},...M.subs(name).map(c=>({k:c,label:c}))].map(x=>flags({...x,inc,
    budget:r2(ms.reduce((s,m)=>s+M.bOf(x.k,m),0)),actual:r2(ms.reduce((s,m)=>s+M.aOf(x.k,m),0))})):[];
  const show=(rows||[]).slice(0,SHOW);

  return(
    <aside className="c-panel bg-side" aria-label={`${name} detail`}>
      <div className="bg-sh">
        <div>
          <b>{oth?`Other · ${name}`:name}</b>
          <span className="c-val">{r.credit?'+'+m2(-a):m2(a)}</span>
          <span className="c-mut">{b?`of ${m2(b)} · `:''}{period}</span>
          {status}
        </div>
        <button type="button" className="c-x" onClick={onClose} aria-label={`Close ${name}`}>✕</button>
      </div>
      {kids.length>0&&<div className="bg-sk">
        {kids.map(x=><span key={x.k}><b className={x.k.startsWith('o:')?'oth':''}>{x.label}</b> <em className={x.over?'c-bad':x.credit?'c-good':''}>{x.credit?'+'+m2(-x.actual):m2(x.actual)}</em>{x.hasB?` of ${m2(x.budget)}`:' · no budget'}</span>)}
      </div>}
      <Chart M={M} T={T} Y={Y} dkey={dkey} sel={yr?null:mo}/>
      <div className="bg-sl">
        {rows===null?<p className="c-mut bg-pad">Loading…</p>
          :show.length?show.map((x,i)=>(
            <div className="bg-dr" key={`${x.id}-${i}`}>
              <span className="bg-rd">{MON[Number(x.date.slice(5,7))-1]} {Number(x.date.slice(8,10))}</span>
              <div className="bg-rn"><b>{x.merchant||x.description}</b><span>{grp||oth?`${ncat(x.category)}${x.account?` · ${x.account}`:''}`:(x.account||'')}</span></div>
              <b className={`bg-amt ${x.v<0?'c-good':''}`}>{x.v<0?'+'+m2(-x.v):m2(x.v)}</b>
            </div>
          )):<p className="c-mut bg-pad">No transactions in this period.</p>}
        {rows&&rows.length>show.length&&<button type="button" className="c-lnk bg-more" onClick={onMore}>{rows.length-show.length} more in Transactions →</button>}
      </div>
    </aside>
  );
}

/* The year by month: bars for spending, ticks for the budget */
function Chart({M,T,Y,dkey,sel}){
  const W=320,H=118,P={t:10,b:20,l:4,r:4},cw=W-P.l-P.r,ch=H-P.t-P.b,sl=cw/12;
  const v=ALL12.map(m=>({m,a:M.aOf(dkey,m),b:M.bOf(dkey,m)}));
  const mx=Math.max(...v.map(x=>Math.max(x.a,x.b)),1)*1.08,y=x=>P.t+ch-Math.max(x,0)/mx*ch;
  return(
    <div className="bg-cw">
      <div className="bg-cl"><span>{Y} by month</span><span><i className="kb"/>spent<i className="kt"/>budget</span></div>
      <svg className="bg-ch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${Y} by month`}>
        {v.map((x,i)=>{
          const cx=P.l+(i+.5)*sl,bw=sl*.56,top=y(x.a),on=sel===x.m,over=x.b>0&&x.a>x.b;
          return(
            <g key={x.m}>
              {!isFuture(T,Y,x.m)&&<rect className={`b ${over?'over':''} ${on?'on':''}`} x={cx-bw/2} y={top} width={bw} height={Math.max(P.t+ch-top,0)} rx="2">
                <title>{MON[x.m-1]}: {m2(x.a)}{x.b?` of ${m2(x.b)}`:''}</title></rect>}
              {x.b>0&&<line className="t" x1={cx-bw/2-3} x2={cx+bw/2+3} y1={y(x.b)} y2={y(x.b)}/>}
              <text className={`x ${on?'on':''}`} x={cx} y={H-5} textAnchor="middle">{MON[x.m-1][0]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
