/* The Card page's transactions table (docs/cards-card-transactions-design.md):
   checkbox, date, merchant, bonus category, spender, type, rate, points,
   amount and row icons ($ Log credit use, ⊘ Exclude, ✎ / ↺ points by hand).
   Clicking the bonus category or type cell opens a list under it; one click
   saves, with a merchant rule ticked by default. Points edit in place like a
   spreadsheet (Enter, Tab, Shift+Tab, Escape). Card payments are hidden. */
import {useState,useEffect,useMemo,useRef,useCallback} from 'react';
import {apiFetch} from '../../lib/api';
import {Popover} from '../../components/ui/Popover';
import {LinkedMark} from '../../components/benefits/Benefits';
import {CIcon} from '../../components/ui/CIcon';
import {f,md,usd2} from '../../components/cards/CardsCommon';
import '../../components/benefits/benefits.css';
import './cardtx.css';

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const KIND={purchase:'Purchase',refund:'Refund',credit:'Credit',fee:'Fee',interest:'Interest',p2p:'P2P',payment:'Payment',adjustment:'Adjustment'};
const FITS={charge:['purchase','fee','interest','p2p'],back:['refund','credit']};
const EARNS=new Set(['purchase','refund']);
const SHOWN=12;
const cleanPattern=s=>(s||'').trim().replace(/[\s.,;:!*#-]+$/,'').toUpperCase();
const cat=t=>t.is_2027?t.merchant_category:t.points_category;
const fmtPts=v=>v>0?`+${f(v)}`:v<0?`−${f(Math.abs(v))}`:'0';
const ptsCls=v=>v>0?'up':v<0?'neg':'zero';

export function CardTxnTable({accountId,cardId,productKey,baseRate,range,setRange,B,people,setPeople,reloadKey,toast,onLogCredit,onChanged}){
  const now=new Date();
  const[view,setView]=useState(range?'custom':'monthly');
  const[year,setYear]=useState(now.getFullYear());
  const[month,setMonth]=useState(now.getMonth()+1);
  const[qtr,setQtr]=useState(Math.ceil((now.getMonth()+1)/3));
  const[cs,setCs]=useState(range?.start||'');
  const[ce,setCe]=useState(range?.end||'');
  const[rows,setRows]=useState(null);
  const[q,setQ]=useState('');
  const[chip,setChip]=useState('');
  const[sort,setSort]=useState({col:'date',dir:'desc'});
  const[all,setAll]=useState(false);
  const[sel,setSel]=useState(()=>new Set());
  const[pop,setPop]=useState(null);       // {t:'cat'|'type'|'who'|'tag', t_:row, el}
  const[edit,setEdit]=useState(null);     // {id, val}
  const[busy,setBusy]=useState(null);
  const[mcats,setMcats]=useState([]);
  const[rules,setRules]=useState(null);
  const[oldCats,setOldCats]=useState([]);
  useEffect(()=>{if(range){setView('custom');setCs(range.start);setCe(range.end);}},[range?.start,range?.end]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{apiFetch('/merchant-categories').then(setMcats).catch(()=>{});
    apiFetch('/points-categories').then(c=>setOldCats((c||[]).filter(x=>x.is_active!==false))).catch(()=>{});},[]);
  useEffect(()=>{if(productKey)apiFetch(`/earning/rules?product_key=${productKey}`).then(r=>setRules(r[productKey]?.rules||[])).catch(()=>setRules([]));},[productKey]);

  const qs=useMemo(()=>{
    if(view==='custom'&&cs&&ce)return `start_date=${cs}&end_date=${ce}`;
    if(view==='ytd')return `year=${year}`;
    if(view==='qtd')return `year=${year}&quarter=${qtr}`;
    return `year=${year}&month=${month}`;
  },[view,year,month,qtr,cs,ce]);
  const load=useCallback(async()=>{
    try{const r=await apiFetch(`/accounts/${accountId}/transactions?${qs}&action=Expense&limit=500`);setRows(r.transactions||[]);}
    catch(e){setRows([]);toast('Couldn’t load transactions','error');}
  },[accountId,qs]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{load();setSel(new Set());setAll(false);},[load,reloadKey]);
  const after=()=>{load();onChanged&&onChanged();};

  /* filters, chips, totals, sorting */
  const label=t=>{const c=cat(t);if(c)return c;return t.kind==='purchase'?'None':null;};
  const searched=useMemo(()=>{
    if(!rows)return[];const n=q.trim().toLowerCase();
    return n?rows.filter(t=>[t.description,t.merchant_name,t.description_raw,t.brand].some(x=>(x||'').toLowerCase().includes(n))):rows;
  },[rows,q]);
  const chips=useMemo(()=>{const m=new Map();for(const t of searched){const l=label(t);if(l)m.set(l,(m.get(l)||0)+1);}return[...m.entries()].sort((a,b)=>b[1]-a[1]);},[searched]);// eslint-disable-line react-hooks/exhaustive-deps
  const filtered=useMemo(()=>chip?searched.filter(t=>label(t)===chip):searched,[searched,chip]);// eslint-disable-line react-hooks/exhaustive-deps
  const sorted=useMemo(()=>{
    const k={date:t=>t.date+String(t.id).padStart(9,'0'),merchant:t=>(t.description||'').toLowerCase(),cat:t=>(label(t)||'~').toLowerCase(),
      who:t=>(t.spender||'~').toLowerCase(),type:t=>t.kind,rate:t=>t.earn_rate||0,pts:t=>t.points_earn||0,amt:t=>-(t.amount||0)}[sort.col];
    return[...filtered].sort((a,b)=>{const x=k(a),y=k(b);return(x<y?-1:x>y?1:0)*(sort.dir==='asc'?1:-1);});
  },[filtered,sort]);// eslint-disable-line react-hooks/exhaustive-deps
  const shown=all?sorted:sorted.slice(0,SHOWN);
  const spend=filtered.filter(t=>t.kind==='purchase'&&!t.is_excluded&&t.amount<0).reduce((s,t)=>s-t.amount,0);
  const pts=filtered.filter(t=>!t.is_excluded).reduce((s,t)=>s+(t.points_earn||0),0);
  const sortBy=col=>setSort(s=>s.col===col?{col,dir:s.dir==='asc'?'desc':'asc'}:{col,dir:['date','pts','amt','rate'].includes(col)?'desc':'asc'});
  const Th=({col,children,n})=><th className={n?'n':''} aria-sort={sort.col===col?(sort.dir==='asc'?'ascending':'descending'):undefined}>
    <button type="button" className={`ctx-sb ${sort.col===col?'on':''}`} onClick={()=>sortBy(col)}>{children}<i>{sort.col===col?(sort.dir==='asc'?'▲':'▼'):'↕'}</i></button></th>;

  /* date selector */
  const isNow=view==='monthly'?(year===now.getFullYear()&&month===now.getMonth()+1):(year===now.getFullYear()&&qtr>=Math.ceil((now.getMonth()+1)/3));
  const step=d=>{
    if(view==='monthly'){let m=month+d,y=year;if(m<1){m=12;y--;}if(m>12){m=1;y++;}setMonth(m);setYear(y);}
    else{let k=qtr+d,y=year;if(k<1){k=4;y--;}if(k>4){k=1;y++;}setQtr(k);setYear(y);}
  };
  const pickView=v=>{setView(v);if(v!=='custom'&&range)setRange(null);if(v!=='custom'){setYear(now.getFullYear());setMonth(now.getMonth()+1);setQtr(Math.ceil((now.getMonth()+1)/3));}};

  /* edits */
  const patch=async(t,body,msg)=>{setBusy(t.id);try{await apiFetch(`/transactions/${t.id}`,{method:'PATCH',body:JSON.stringify(body)});if(msg)toast(msg);after();return true;}
    catch(e){toast(e.message||'Couldn’t save','error');return false;}finally{setBusy(null);}};
  const toggleExclude=t=>patch(t,{is_excluded:!t.is_excluded},t.is_excluded?'Included again: it earns points and counts toward challenges':'Excluded: no points, not counted toward a sign-up bonus or spend challenges');
  const savePts=async(t,val)=>{
    const s=String(val).replace(/[,\s+]/g,'').replace('−','-');
    if(s===''||!Number.isFinite(Number(s)))return;
    const n=Number(s);
    if(!t.points_overridden&&Math.round(n)===Math.round(t.points_earn||0))return;
    if(await patch(t,{points_earn_override:n}))toast(`Points set by hand: ${fmtPts(n)}. ↺ goes back to the card’s figure`);
  };
  const resetPts=t=>patch(t,{clear_points_earn_override:true},'Back to the card’s figure');
  const startEdit=t=>setEdit({id:t.id,val:String(Math.round(t.points_earn||0))});
  const editKey=(e,t,i)=>{
    if(e.key==='Escape'){e.preventDefault();setEdit(null);return;}
    if(e.key==='Enter'){e.preventDefault();const v=edit.val;setEdit(null);savePts(t,v);return;}
    if(e.key==='Tab'){e.preventDefault();const v=edit.val;const list=shown.filter(r=>!r.pending);const j=list.findIndex(r=>r.id===t.id)+(e.shiftKey?-1:1);
      const nx=list[j];setEdit(nx?{id:nx.id,val:String(Math.round(nx.points_earn||0))}:null);savePts(t,v);}
  };
  const tagSel=async who=>{
    setPop(null);if(!who||!sel.size)return;
    try{await apiFetch('/transactions/batch-update',{method:'POST',body:JSON.stringify({ids:[...sel],updates:{spender:who}})});
      toast(`Tagged ${sel.size} charge${sel.size===1?'':'s'} as ${who}`);setSel(new Set());setPeople(p=>[...new Set([...p,who])]);after();}
    catch(e){toast(e.message||'Couldn’t tag them','error');}
  };
  const linked=t=>B?.linked_purchases?.[String(t.id)];
  const allSel=shown.length>0&&shown.every(t=>sel.has(t.id));

  const per=view==='monthly'?`${MONTHS[month-1]} ${year}`:view==='qtd'?`Q${qtr} ${year}`:view==='ytd'?String(year):'';
  return(
    <section className="ctx">
      <h2>Transactions</h2>
      <div className="c-panel cds-pn">
        <div className="ctx-tb">
          <div className="ctx-row">
            <div className="cds-seg" role="group" aria-label="Dates">
              {[['monthly','Monthly'],['qtd','QTD'],['ytd','YTD'],['custom','Custom']].map(([v,l])=><button type="button" key={v} className={view===v?'on':''} onClick={()=>pickView(v)}>{l}</button>)}
            </div>
            {(view==='monthly'||view==='qtd')&&<span className="ctx-nav"><button type="button" className="c-ib" aria-label="Earlier" onClick={()=>step(-1)}>‹</button><b>{per}</b>
              <button type="button" className="c-ib" aria-label="Later" disabled={isNow} onClick={()=>step(1)}>›</button></span>}
            {view==='ytd'&&<span className="ctx-nav"><b>{per}</b></span>}
            {view==='custom'&&<span className="ctx-nav"><input type="date" className="c-inp" aria-label="From" value={cs} onChange={e=>{setCs(e.target.value);setRange&&setRange(null);}}/>
              <span className="cds-mut">to</span><input type="date" className="c-inp" aria-label="To" value={ce} onChange={e=>{setCe(e.target.value);setRange&&setRange(null);}}/></span>}
            <input className="ctx-q" placeholder="Search merchants" aria-label="Search merchants" value={q} onChange={e=>setQ(e.target.value)}/>
          </div>
          {range&&<p className="ctx-rng">Showing {range.name}, {md(range.start)} to {md(range.end)} <button type="button" className="c-lnk" onClick={()=>{setRange(null);pickView('monthly');}}>Clear</button></p>}
          {chips.length>0&&<div className="ctx-chips">
            <button type="button" className={`c-fb ${!chip?'on':''}`} onClick={()=>setChip('')}>All</button>
            {chips.map(([c,n])=><button type="button" key={c} className={`c-fb ${chip===c?'on':''} ${c==='None'?'none':''}`} onClick={()=>setChip(chip===c?'':c)}>{c}<em>{n}</em></button>)}
          </div>}
        </div>
        <div className="ctx-sum"><span>Spend <b>{usd2(spend)}</b></span><span>Points <b className={pts>0?'up':''}>{fmtPts(Math.round(pts))}</b></span></div>
        {sel.size>0&&<div className="ctx-selbar"><b>{sel.size} selected</b><span>Tag as:</span>
          <button type="button" className="c-btn sm" onClick={e=>setPop({t:'tag',el:e.currentTarget})}>Who spent this? ▾</button>
          <button type="button" className="c-btn ghost sm" onClick={()=>setSel(new Set())}>Clear selection</button></div>}
        {rows===null?<p className="cds-mut">Loading…</p>
        :!rows.length?<p className="ctx-empty">No transactions for this period.</p>
        :!sorted.length?<p className="ctx-empty">No matches.</p>
        :<div className="ctx-tw"><table className="ctx-t">
          <thead><tr>
            <th className="ck"><input type="checkbox" aria-label="Select all shown" checked={allSel} onChange={()=>setSel(allSel?new Set():new Set(shown.map(t=>t.id)))}/></th>
            <Th col="date">Date</Th><Th col="merchant">Merchant</Th><Th col="cat">Bonus category</Th><Th col="who">Spender</Th><Th col="type">Type</Th>
            <Th col="rate" n>Rate</Th><Th col="pts" n>Points</Th><Th col="amt" n>Amount</Th><th className="ri"><span className="sr">Actions</span></th>
          </tr></thead>
          <tbody>{shown.map((t,i)=>{
            const c=cat(t),earns=EARNS.has(t.kind),lk=linked(t),ed=edit?.id===t.id;
            return(<tr key={t.id} className={`${t.is_excluded?'exc':''} ${sel.has(t.id)?'sel':''} ${pop&&pop.row?.id===t.id?'fx':''}`}>
              <td className="ck"><input type="checkbox" aria-label={`Select ${t.description}`} checked={sel.has(t.id)} onChange={()=>setSel(s=>{const n=new Set(s);n.has(t.id)?n.delete(t.id):n.add(t.id);return n;})}/></td>
              <td className="dte">{md(t.date)}</td>
              <td className="mc"><span className="mn" title={t.description_raw||t.description}>{t.description}</span>
                {t.is_excluded&&<span className="ctx-tag">⊘ Excluded</span>}<LinkedMark links={lk}/></td>
              <td className="bcat">{earns||c
                ?<button type="button" className={`ctx-cell ${!c&&t.kind==='purchase'?'none':''}`} onClick={e=>setPop({t:'cat',row:t,el:e.currentTarget})}>
                  <span>{c||'None'}{t.brand&&<span className="bnd"> · {t.brand}</span>}</span>{t.classification_source==='manual'&&<i className="hand" title="Fixed by hand">✎</i>}<i className="cv">▾</i></button>
                :<span className="dash">—</span>}</td>
              <td><button type="button" className={`ctx-cell ${t.spender?'':'nob'}`} onClick={e=>setPop({t:'who',row:t,el:e.currentTarget})}><span>{t.spender||'Add'}</span><i className="cv">▾</i></button></td>
              <td className="ty">{t.is_2027
                ?<button type="button" className="ctx-cell" onClick={e=>setPop({t:'type',row:t,el:e.currentTarget})}><span>{KIND[t.kind]||t.kind}</span><i className="cv">▾</i></button>
                :<span title="Types before 2027 stay as they are. To fix history, use Exclude or Set points by hand.">{KIND[t.kind]||t.kind}</span>}</td>
              <td className="n rt">{t.earn_rate>0&&earns?`${t.earn_rate}x`:'–'}</td>
              <td className={`n pts ${ptsCls(t.points_earn)}`}>{ed
                ?<input className="ctx-pe" autoFocus value={edit.val} aria-label={`Points for ${t.description}`} onFocus={e=>e.target.select()}
                  onChange={e=>setEdit({id:t.id,val:e.target.value})} onKeyDown={e=>editKey(e,t,i)} onBlur={()=>{if(edit&&edit.id===t.id){const v=edit.val;setEdit(null);savePts(t,v);}}}/>
                :<>{fmtPts(Math.round(t.points_earn||0))}{t.points_overridden&&<i className="hand" title="Set by hand">✎</i>}</>}</td>
              <td className={`n am ${t.amount>0?'up':''}`}>{t.amount>0?`−${usd2(t.amount)}`:usd2(t.amount)}</td>
              <td className="ri"><span className="acts">
                {t.kind==='purchase'&&B&&B.benefits.length>0
                  ?<button type="button" className="aic" title="Log credit use…" aria-label={`Log credit use for ${t.description}`} onClick={()=>{if(lk){toast(`${t.description} is already linked to a credit`);return;}onLogCredit(t);}}>$</button>
                  :<span className="aic sp"/>}
                <button type="button" className={`aic ${t.is_excluded?'on bad':''}`} disabled={busy===t.id} title={t.is_excluded?'Include again':'Exclude'} aria-label={t.is_excluded?`Include ${t.description}`:`Exclude ${t.description}`} aria-pressed={t.is_excluded} onClick={()=>toggleExclude(t)}><CIcon name="ban" size={14}/></button>
                {t.points_overridden
                  ?<button type="button" className="aic on" title="Back to the card’s figure" aria-label={`Back to the card’s figure for ${t.description}`} onClick={()=>resetPts(t)}>↺</button>
                  :<button type="button" className="aic" title="Set points by hand" aria-label={`Set points by hand for ${t.description}`} onClick={()=>startEdit(t)}><CIcon name="edit" size={14}/></button>}
              </span></td>
            </tr>);})}</tbody></table></div>}
        {!all&&sorted.length>SHOWN&&<button type="button" className="c-btn ctx-all" onClick={()=>setAll(true)}>Show all {sorted.length}</button>}
      </div>
      {pop?.t==='cat'&&<Popover anchor={pop.el} onClose={()=>setPop(null)}>
        {pop.row.is_2027
          ?<CatList2027 t={pop.row} mcats={mcats} rules={rules} baseRate={baseRate} toast={toast} onDone={()=>{setPop(null);after();}}/>
          :<CatListOld t={pop.row} cats={oldCats} toast={toast} onDone={()=>{setPop(null);after();}}/>}
      </Popover>}
      {pop?.t==='type'&&<Popover anchor={pop.el} onClose={()=>setPop(null)}>
        <TypeList t={pop.row} toast={toast} onDone={()=>{setPop(null);after();}}/></Popover>}
      {pop?.t==='who'&&<Popover anchor={pop.el} onClose={()=>setPop(null)}>
        <WhoList people={people} value={pop.row.spender} onPick={async w=>{const t=pop.row;setPop(null);if(await patch(t,{spender:w||''},w?`Spender: ${w}`:'Spender cleared')&&w)setPeople(p=>[...new Set([...p,w])]);}}/></Popover>}
      {pop?.t==='tag'&&<Popover anchor={pop.el} onClose={()=>setPop(null)}><WhoList people={people} onPick={tagSel} noClear/></Popover>}
    </section>);
}

/* ── Spender list ───────────────────────────────────────────────────────── */
function WhoList({people,value,onPick,noClear}){
  const[n,setN]=useState('');
  return(<div className="c-pop c-menu ctx-who" role="dialog" aria-label="Who spent this?">
    {people.map(p=><button type="button" key={p} className={`c-mi ${value===p?'on':''}`} onClick={()=>onPick(p)}>{p}</button>)}
    {!noClear&&value&&<button type="button" className="c-mi" onClick={()=>onPick('')}>No spender</button>}
    <div className="c-mi-in"><input className="c-inp" data-autofocus placeholder="Add a name" value={n} onChange={e=>setN(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&n.trim())onPick(n.trim());}}/></div>
  </div>);
}

/* ── Rule tick box with editable match text and a live count ───────────── */
function useRule(t){
  const[on,setOn]=useState(!!(t.merchant_name||t.description));
  const[text,setText]=useState(cleanPattern(t.merchant_name||t.description));
  const[mode,setMode]=useState('word');
  return{on,setOn,text,setText,mode,setMode};
}
function RuleBox({R,t,dirLabel,line}){
  const who=t.merchant_name||t.description;
  return(<div className="ctx-rule">
    <label className="c-cb"><input type="checkbox" checked={R.on} onChange={e=>R.setOn(e.target.checked)}/> Use for every {dirLabel} from {who}</label>
    {R.on&&<>
      <div className="ctx-rin"><input className="c-inp" aria-label="Match text" value={R.text} onChange={e=>R.setText(e.target.value.toUpperCase())}/>
        {R.setMode&&<div className="cds-seg" role="group" aria-label="How it matches">
          <button type="button" className={R.mode==='word'?'on':''} onClick={()=>R.setMode('word')}>Whole words</button>
          <button type="button" className={R.mode==='contains'?'on':''} onClick={()=>R.setMode('contains')}>Contains</button></div>}</div>
      {line&&<p className="ctx-rl">{line}</p>}</>}
  </div>);
}
function usePreview(R,body){
  const[res,setRes]=useState(null);
  const key=JSON.stringify([R.on,R.text,R.mode,body]);
  useEffect(()=>{
    if(!R.on||!R.text.trim()||!body){setRes(null);return;}
    const h=setTimeout(()=>{apiFetch('/merchant-rules/preview',{method:'POST',body:JSON.stringify({pattern:R.text,match_type:R.mode,...body})}).then(setRes).catch(()=>setRes(null));},300);
    return()=>clearTimeout(h);
  },[key]);// eslint-disable-line react-hooks/exhaustive-deps
  return res;
}
function previewLine(res,t){
  if(!res)return null;
  const others=res.changed_ids.filter(id=>id!==t.id).length,d=Math.round(res.points_delta);
  return `Matches ${res.matches} charge${res.matches===1?'':'s'} on your cards${others?`; ${others} other${others===1?'':'s'} change, ${d>=0?'+':'−'}${f(Math.abs(d))} points`:''}`;
}
async function saveRule(R,body,label,toast){
  await apiFetch('/merchant-rules',{method:'POST',body:JSON.stringify({pattern:R.text,match_type:R.mode,...body})});
  const r=await apiFetch('/earning/recalculate',{method:'POST',body:JSON.stringify({apply:true})});
  const n=Math.max(0,r.rows_changed-1),d=Math.round(r.points_after-r.points_before);
  toast(`Rule saved: “${R.text}” → ${label}. ${n} other charge${n===1?'':'s'} updated, ${d>=0?'+':'−'}${f(Math.abs(d))} points`);
}

/* ── Bonus category, 2027 rows: merchant categories with this card's rate ─ */
function rateFor(rules,catName,parent,base){
  if(!rules)return{r:base,note:''};
  const hit=rules.find(x=>x.merchant_category===catName&&!x.brand)||(parent&&rules.find(x=>x.merchant_category===parent&&!x.brand));
  if(!hit)return{r:base,note:''};
  const note=[hit.online_only&&'online',hit.domestic_only&&'US',hit.foreign_only&&'abroad',hit.cap_amount&&hit.cap_amount<100000&&`to $${f(hit.cap_amount)}`].filter(Boolean).join(', ');
  return{r:hit.rate,note};
}
function CatList2027({t,mcats,rules,baseRate,toast,onDone}){
  const R=useRule(t);
  const[q,setQ]=useState('');
  const[hov,setHov]=useState(null);
  const[busy,setBusy]=useState(false);
  const base=(rules||[]).find(x=>!x.merchant_category&&!x.brand)?.rate??baseRate??1;
  const res=usePreview(R,{merchant_category:hov||t.merchant_category||null});
  const ql=q.trim().toLowerCase();
  const tops=mcats.filter(c=>!c.parent),kids=p=>mcats.filter(c=>c.parent===p);
  const pick=async name=>{
    setBusy(true);
    try{
      await apiFetch(`/transactions/${t.id}`,{method:'PATCH',body:JSON.stringify({merchant_category:name})});
      if(R.on&&R.text.trim())await saveRule(R,{merchant_category:name},name,toast);else toast(`Bonus category: ${name}`);
      onDone();
    }catch(e){toast(e.message||'Couldn’t save','error');setBusy(false);}
  };
  const opt=(c,sub)=>{const{r,note}=rateFor(rules,c.name,c.parent,base);const hi=r>base;
    return <button type="button" key={c.name} className={`ctx-po ${sub?'sub':'top'} ${t.merchant_category===c.name?'on':''}`} disabled={busy}
      onMouseEnter={()=>setHov(c.name)} onFocus={()=>setHov(c.name)} onClick={()=>pick(c.name)}>
      <span className="pol">{c.name}</span><span className={`prt ${hi?'hi':''}`}>{r}x{note?` ${note}`:''}</span></button>;};
  return(<div className="c-pop ctx-pop" role="dialog" aria-label="Bonus category">
    <RuleBox R={R} t={t} dirLabel={t.amount>0?'money-back line':'charge'} line={previewLine(res,t)}/>
    <input className="c-psrch" data-autofocus placeholder="Find a category…" aria-label="Find a category" value={q} onChange={e=>setQ(e.target.value)}/>
    <div className="ctx-pl">{tops.map(tp=>{const ks=kids(tp.name);const topHit=!ql||tp.name.toLowerCase().includes(ql);const kk=topHit?ks:ks.filter(k=>k.name.toLowerCase().includes(ql));
      if(!topHit&&!kk.length)return null;return <div key={tp.name}>{opt(tp,false)}{kk.map(k=>opt(k,true))}</div>;})}</div>
    <TypeSelect t={t} toast={toast} onDone={onDone}/>
  </div>);
}
/* ── Bonus category, before 2027: the old bonus categories, no rates ────── */
function CatListOld({t,cats,toast,onDone}){
  const R=useRule(t);R.setMode=null;
  const[q,setQ]=useState('');
  const[busy,setBusy]=useState(false);
  const ql=q.trim().toLowerCase();
  const list=cats.filter(c=>!ql||c.name.toLowerCase().includes(ql));
  const pick=async name=>{
    setBusy(true);
    try{
      await apiFetch(`/transactions/${t.id}`,{method:'PATCH',body:JSON.stringify({points_category:name})});
      if(R.on&&R.text.trim()){const r=await apiFetch('/merchant-csc',{method:'POST',body:JSON.stringify({merchant_pattern:R.text,points_category:name,apply_to_existing:true})});
        const n=Math.max(0,(r.transactions_updated||0)-1);toast(`Rule saved: “${R.text}” → ${name}. ${n} other charge${n===1?'':'s'} updated`);}
      else toast(`Bonus category: ${name}`);
      onDone();
    }catch(e){toast(e.message||'Couldn’t save','error');setBusy(false);}
  };
  return(<div className="c-pop ctx-pop" role="dialog" aria-label="Bonus category">
    <RuleBox R={R} t={t} dirLabel="charge"/>
    <input className="c-psrch" data-autofocus placeholder="Find a category…" aria-label="Find a category" value={q} onChange={e=>setQ(e.target.value)}/>
    <div className="ctx-pl">{list.map(c=><button type="button" key={c.id} disabled={busy} className={`ctx-po ${c.parent_key?'sub':''} ${t.points_category===c.name?'on':''}`} onClick={()=>pick(c.name)}><span className="pol">{c.name}</span></button>)}
      {!list.length&&<div className="c-empty-opt">Nothing matches “{q}”</div>}</div>
  </div>);
}
/* ── Type: only the types that fit the amount, each with its points ─────── */
const kindsFor=t=>{const k=[...FITS[t.amount<0?'charge':'back']];if(t.kind&&!k.includes(t.kind))k.push(t.kind);return k;};
const ptsAs=(t,k)=>{const rate=t.earn_rate||0,a=Math.abs(t.amount||0);if(k==='purchase')return{r:rate,p:Math.round(a*rate)};if(k==='refund')return{r:rate,p:-Math.round(a*rate)};return{r:0,p:0};};
function TypeList({t,toast,onDone}){
  const R=useRule(t);
  const[hov,setHov]=useState(null);
  const[busy,setBusy]=useState(false);
  const res=usePreview(R,{txn_kind:hov||t.kind});
  const pick=async k=>{
    setBusy(true);
    try{
      await apiFetch(`/transactions/${t.id}`,{method:'PATCH',body:JSON.stringify({txn_kind:k})});
      if(R.on&&R.text.trim())await saveRule(R,{txn_kind:k},KIND[k],toast);else toast(`Type: ${KIND[k]}`);
      onDone();
    }catch(e){toast(e.message||'Couldn’t save','error');setBusy(false);}
  };
  return(<div className="c-pop ctx-pop sm" role="dialog" aria-label="Type">
    <RuleBox R={R} t={t} dirLabel={t.amount>0?'money-back line':'charge'} line={previewLine(res,t)}/>
    <div className="ctx-pl">{kindsFor(t).map(k=>{const{r,p}=ptsAs(t,k);return(
      <button type="button" key={k} disabled={busy} className={`ctx-po ${t.kind===k?'on':''}`} onMouseEnter={()=>setHov(k)} onFocus={()=>setHov(k)} onClick={()=>pick(k)}>
        <span className="pol">{KIND[k]}</span><span className="prt">{r?`${r}x `:''}{fmtPts(p)}</span></button>);})}</div>
  </div>);
}
function TypeSelect({t,toast,onDone}){
  const set=async k=>{if(k===t.kind)return;try{await apiFetch(`/transactions/${t.id}`,{method:'PATCH',body:JSON.stringify({txn_kind:k})});toast(`Type: ${KIND[k]}`);onDone();}catch(e){toast(e.message||'Couldn’t save','error');}};
  return(<label className="ctx-ts"><span>Type</span><select className="c-sel" value={t.kind} onChange={e=>set(e.target.value)}>
    {kindsFor(t).map(k=><option key={k} value={k}>{KIND[k]} ({fmtPts(ptsAs(t,k).p)})</option>)}</select></label>);
}
