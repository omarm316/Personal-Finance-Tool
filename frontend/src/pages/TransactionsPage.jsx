import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import '../styles/cloud.css';
import './transactions.css';
import {ConfirmModal} from '../components/ConfirmModal';
import {ImportModal} from '../components/ImportModal';
import {LEDGER_COLUMNS,LedgerRow,SizerRow} from '../components/LedgerRow';
import {ManualTransactionModal} from '../components/ManualTransactionModal';
import {SplitEditorModal} from '../components/SplitEditorModal';
import {TxnDetailsWindow} from '../components/TxnDetailsWindow';
import {TxnBatchWindow,TxnReviewWindow,TxnRuleWindow} from '../components/TxnWindows';
import {CIcon} from '../components/ui/CIcon';
import {chipLabel,FilterChip} from '../components/ui/FilterChip';
import {Popover} from '../components/ui/Popover';
import {useIsMobile} from '../hooks/index';
import {apiFetch} from '../lib/api';
import {groupCats,topLevelOf,catLabel} from '../lib/categories';
import {TXN_TYPES} from '../lib/constants';
import {fmt,todayStr} from '../lib/format';
import {longDate,needsReview,signed,ymd} from '../lib/txnView';
import {TransactionsPhonePage} from './TransactionsPhonePage';

/* Transactions page. Desktop follows docs/transactions-design.md; the phone
   keeps its earlier layout until phone design is done. */
export function TransactionsPage(props){
  const mobile=useIsMobile();
  return mobile?<TransactionsPhonePage {...props}/>:<TransactionsDesktop {...props}/>;
}

const LOAD_LIMIT=5000;   // every row in the period (the whole history is ~3,500)
const PAGE=200;          // rows drawn at a time; more load as you scroll
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad=n=>String(n).padStart(2,'0');
const lastDay=(y,m)=>new Date(y,m,0).getDate();
const EMPTY_F={act:null,cat:null,acct:null,net:null,brand:null};

/* The card side of a credit-card payment already shown from checking: hidden,
   as before (structural test, not keywords, except for Income-typed payments). */
const CC_PAY_WORDS=['PAYMENT','AUTOPAY','PMT','PYMT','TRANSFER'];
function isCCPaymentDuplicate(t){
  if(t.amount<=0)return false;
  const type=(t.account_type||'').toLowerCase();
  if(type!=='credit'&&type!=='credit card')return false;
  if(t.action==='Transfer')return true;
  if(t.action==='Income'){const d=(t.description_raw||'').toUpperCase();return CC_PAY_WORDS.some(w=>d.includes(w));}
  return false;
}

/* The month through today, a whole year, or nothing (all years) */
function rangeFor(year,month){
  const today=todayStr();
  if(!year)return['',''];
  if(!month){const end=`${year}-12-31`;return[`${year}-01-01`,end<today?end:today];}
  const m=Number(month),end=`${year}-${pad(m)}-${pad(lastDay(Number(year),m))}`;
  return[`${year}-${pad(m)}-01`,end<today?end:today];
}

function TransactionsDesktop({categories,toast,refreshKey}){
  const now=new Date();
  const[per,setPer]=useState(()=>{const y=String(now.getFullYear()),m=String(now.getMonth()+1);const[from,to]=rangeFor(y,m);return{year:y,month:m,from,to};});
  const[txns,setTxns]=useState([]);
  const[loaded,setLoaded]=useState(false);
  const[busy,setBusy]=useState(false);
  const[loadError,setLoadError]=useState(null);
  const[accounts,setAccounts]=useState([]);
  const[lists,setLists]=useState({merchantCats:[],brands:[],pointsCats:[]});

  const[q,setQ]=useState('');
  const[f,setF]=useState(EMPTY_F);
  const[amt,setAmt]=useState({min:'',max:''});
  const[rev,setRev]=useState(false);
  const[exc,setExc]=useState(false);
  const[sort,setSort]=useState({col:null,dir:'desc'});
  const[sel,setSel]=useState(()=>new Set());
  const[exp,setExp]=useState(()=>new Set());
  const[editId,setEditId]=useState(null);
  const[limit,setLimit]=useState(PAGE);

  const[openId,setOpenId]=useState(null);
  const[reviewId,setReviewId]=useState(null);
  const[ruleTxn,setRuleTxn]=useState(null);
  const[splitTxn,setSplitTxn]=useState(null);
  const[batch,setBatch]=useState(false);
  const[manual,setManual]=useState(false);
  const[importing,setImporting]=useState(false);
  const[confirm,setConfirm]=useState(null);
  const[menu,setMenu]=useState(null);           // 'add' | 'more' | 'amt'
  const[enrichJob,setEnrichJob]=useState(null);
  const addBtn=useRef(null),moreBtn=useRef(null),amtBtn=useRef(null),sentinel=useRef(null);

  /* ── Loading ─────────────────────────────────────────────── */
  const load=useCallback(async()=>{
    setBusy(true);
    let qs=`?limit=${LOAD_LIMIT}`;
    if(per.from)qs+=`&start_date=${per.from}`;
    if(per.to)qs+=`&end_date=${per.to}`;
    const[tRes,aRes]=await Promise.allSettled([apiFetch(`/transactions${qs}`),apiFetch('/accounts')]);
    if(tRes.status==='fulfilled'){setTxns(tRes.value);setLoadError(null);}
    else{setLoadError(tRes.reason?.message||'Could not load transactions');toast('Failed to load transactions','error');}
    if(aRes.status==='fulfilled')setAccounts(aRes.value);
    setLoaded(true);setBusy(false);
  },[per.from,per.to]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{load();},[load,refreshKey]);
  useEffect(()=>{
    Promise.allSettled([apiFetch('/merchant-categories'),apiFetch('/brands'),apiFetch('/points-categories')]).then(([m,b,p])=>
      setLists({merchantCats:m.value||[],brands:b.value||[],pointsCats:p.value||[]}));
  },[]);

  /* ── Saving ──────────────────────────────────────────────── */
  const saveTxn=useCallback(async(id,updates,msg='Saved')=>{
    try{
      const updated=await apiFetch(`/transactions/${id}`,{method:'PATCH',body:JSON.stringify(updates)});
      setTxns(prev=>prev.map(t=>t.id===id?updated:t));
      if(msg)toast(msg);
      return true;
    }catch(e){toast('Failed to save: '+(e.message||e),'error');return false;}
  },[toast]);

  /* ── Which rows show ─────────────────────────────────────── */
  const facet=useCallback((rows,skip)=>{
    let v=rows;
    if(skip!=='act'&&f.act)v=v.filter(t=>f.act.has(t.action));
    if(skip!=='cat'&&f.cat)v=v.filter(t=>f.cat.has(t.category_final)||f.cat.has(topLevelOf(t.category_final)));
    if(skip!=='acct'&&f.acct)v=v.filter(t=>f.acct.has(String(t.account_id)));
    if(skip!=='net'&&f.net)v=v.filter(t=>f.net.has(t.network));
    if(skip!=='brand'&&f.brand)v=v.filter(t=>f.brand.has(t.brand));
    const ql=q.trim().toLowerCase();
    if(ql)v=v.filter(t=>(t.description_display||'').toLowerCase().includes(ql)||(t.description_raw||'').toLowerCase().includes(ql));
    const mn=amt.min!==''?Math.abs(parseFloat(amt.min)):null,mx=amt.max!==''?Math.abs(parseFloat(amt.max)):null;
    if(mn!==null&&!isNaN(mn))v=v.filter(t=>Math.abs(t.amount)>=mn);
    if(mx!==null&&!isNaN(mx))v=v.filter(t=>Math.abs(t.amount)<=mx);
    return v;
  },[f,q,amt]);
  /* Excluded rows and the payment duplicates stay out of the list and totals,
     except in the Excluded view, which shows only excluded rows. */
  const counted=useMemo(()=>txns.filter(t=>!t.is_excluded&&!isCCPaymentDuplicate(t)),[txns]);
  const excludedRows=useMemo(()=>txns.filter(t=>t.is_excluded),[txns]);
  const scoped=useMemo(()=>exc?excludedRows:rev?counted.filter(needsReview):counted,[exc,rev,counted,excludedRows]);
  const visible=useMemo(()=>{
    let v=facet(scoped);
    if(sort.col){
      const k=sort.col;
      const key=t=>k==='date'?ymd(t.date):k==='amount'?t.amount:k==='description'?(t.description_display||t.description_raw||'').toLowerCase()
        :k==='type'?(t.action_display||t.action||'').toLowerCase():k==='category'?catLabel(t.category_final).toLowerCase():(t.account_name||'').toLowerCase();
      v=[...v].sort((a,b)=>{const x=key(a),y=key(b);const c=typeof x==='number'?x-y:x<y?-1:x>y?1:0;return sort.dir==='asc'?c:-c;});
    }
    return v;
  },[scoped,facet,sort]);
  const reviewCount=useMemo(()=>facet(counted).filter(needsReview).length,[facet,counted]);
  const excludedCount=useMemo(()=>facet(excludedRows).length,[facet,excludedRows]);

  /* Totals for exactly the rows shown: GCB rows are left out; income booked
     in a spending category reduces spending instead of counting as income. */
  const totals=useMemo(()=>{
    const spendCats=new Set(categories.filter(c=>c.category_type==='expense'||c.category_type==='both').map(c=>c.name));
    let exp=0,inc=0;
    visible.forEach(t=>{
      if(t.is_gcb||(t.action!=='Expense'&&t.action!=='Income'))return;
      if(t.action==='Expense'||spendCats.has(t.category_final))exp-=t.amount;else inc+=t.amount;
    });
    return{exp,inc};
  },[visible,categories]);

  /* Filter chip options, each with its count under the other filters */
  const opts=useMemo(()=>{
    const count=(k,keyOf)=>{const c={};facet(scoped,k).forEach(t=>{const v=keyOf(t);if(v==null||v==='')return;c[v]=(c[v]||0)+1;});return c;};
    const ca=count('act',t=>t.action);
    const cc={};facet(scoped,'cat').forEach(t=>{const v=t.category_final;if(!v)return;cc[v]=(cc[v]||0)+1;const top=topLevelOf(v);if(top!==v)cc[top]=(cc[top]||0)+1;});
    const cacct=count('acct',t=>String(t.account_id));
    const cn=count('net',t=>t.network),cb=count('brand',t=>t.brand);
    const nets=[...new Set(txns.map(t=>t.network).filter(Boolean))].sort();
    const brands=[...new Set(txns.map(t=>t.brand).filter(Boolean))].sort();
    return{
      act:TXN_TYPES.map(v=>({value:v,label:v,count:ca[v]})),
      cat:groupCats(categories).flatMap(({top,children})=>[{value:top.name,label:top.name,count:cc[top.name]},...children.map(c=>({value:c.name,label:c.name,count:cc[c.name],kid:true}))]),
      acct:[...accounts].sort((a,b)=>(a.account_name||'').localeCompare(b.account_name||'')).map(a=>({value:String(a.id),label:a.account_name,count:cacct[String(a.id)]})),
      net:nets.map(v=>({value:v,label:v,count:cn[v]})),
      brand:brands.map(v=>({value:v,label:v,count:cb[v]})),
    };
  },[facet,scoped,txns,categories,accounts]);
  const acctName=useMemo(()=>Object.fromEntries(accounts.map(a=>[String(a.id),a.account_name])),[accounts]);

  const anyFilter=!!(q||amt.min||amt.max||rev||exc||Object.values(f).some(Boolean));
  const clearFilters=()=>{setQ('');setF(EMPTY_F);setAmt({min:'',max:''});setRev(false);setExc(false);};

  /* A new set of rows starts unselected, at the top, with nothing open for editing */
  const viewKey=[per.from,per.to,q,amt.min,amt.max,rev,exc,...Object.values(f).map(s=>s?[...s].sort().join('|'):'')].join('~');
  useEffect(()=>{setSel(new Set());setLimit(PAGE);setEditId(null);},[viewKey]);
  useEffect(()=>{setLimit(PAGE);},[sort]);
  /* Draw more rows as the end of the list comes into view */
  useEffect(()=>{
    const el=sentinel.current;if(!el)return;
    const io=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting))setLimit(l=>l+PAGE);},{rootMargin:'600px'});
    io.observe(el);return()=>io.disconnect();
  },[visible.length,limit]);

  /* ── Row actions (one stable callback for every row) ─────── */
  const state=useRef({});state.current={sel,saveTxn};
  const onAct=useCallback((kind,t,arg)=>{
    const s=state.current;
    switch(kind){
      case 'sel':setSel(p=>{const n=new Set(p);n.has(t.id)?n.delete(t.id):n.add(t.id);return n;});return;
      case 'exp':setExp(p=>{const n=new Set(p);n.has(t.id)?n.delete(t.id):n.add(t.id);return n;});return;
      case 'open':setOpenId(t.id);return;
      case 'review':setReviewId(t.id);return;
      case 'edit':if(s.sel.has(t.id))setBatch(true);else setEditId(t.id);return;
      case 'cancel':setEditId(id=>id===t.id?null:id);return;
      case 'split':setSplitTxn(t);return;
      case 'saveEdit':return s.saveTxn(t.id,arg);
      case 'saveType':return s.saveTxn(t.id,{action:arg,needs_review:false},'Type saved');
      case 'saveCat':return s.saveTxn(t.id,{category:arg,needs_review:false},'Category saved');
      case 'ruleFromTxn':return apiFetch(`/llm/create-rule-from-transaction/${t.id}`,{method:'POST'})
        .then(()=>s.saveTxn(t.id,{needs_review:false},'Rule created'))
        .catch(e=>toast('Failed to create rule: '+e.message,'error'));
      default:return;
    }
  },[toast]);

  const toggleSort=col=>setSort(s=>s.col===col?{col,dir:s.dir==='asc'?'desc':'asc'}:{col,dir:col==='date'||col==='amount'?'desc':'asc'});
  const allSel=visible.length>0&&visible.every(t=>sel.has(t.id));

  const applyBatch=async updates=>{
    const ids=[...sel];
    try{
      await apiFetch('/transactions/batch-update',{method:'POST',body:JSON.stringify({ids,updates})});
      await load();setSel(new Set());setBatch(false);
      toast(`Updated ${ids.length} transaction${ids.length!==1?'s':''}`);
    }catch(e){toast('Batch update failed: '+e.message,'error');}
  };

  const askDelete=t=>setConfirm({
    title:'Delete transaction',
    body:`Permanently delete "${t.description_display||t.description_raw}" (${longDate(t.date)} · ${fmt(t.amount)})?\n\nThis cannot be undone.`,
    confirmLabel:'Delete',danger:true,
    onConfirm:async()=>{
      try{await apiFetch(`/transactions/${t.id}`,{method:'DELETE'});setTxns(p=>p.filter(x=>x.id!==t.id));setOpenId(null);toast('Transaction deleted');}
      catch(e){toast('Delete failed: '+e.message,'error');}
    },
  });

  const exportCSV=()=>{
    const cell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const rows=visible.map(t=>[ymd(t.date),t.description_display||t.description_raw,t.amount,t.action,catLabel(t.category_final),t.account_name]);
    const csv=[['Date','Description','Amount','Type','Category','Account'],...rows].map(r=>r.map(cell).join(',')).join('\n');
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='transactions.csv';a.click();
  };

  /* AI Enrich: a background job, polled every 2s */
  const startEnrich=async()=>{
    try{
      const r=await apiFetch('/llm/enrich-transactions',{method:'POST',body:JSON.stringify({limit:300,overwrite_existing:false})});
      setEnrichJob({job_id:r.job_id,status:'running',processed:0,total:0,llm_calls:0,override_hits:0,errors:0,startedAt:Date.now()});
    }catch(e){toast('Failed to start enrichment: '+e.message,'error');}
  };
  useEffect(()=>{
    if(!enrichJob||enrichJob.status!=='running')return;
    const id=setInterval(async()=>{
      try{
        const s=await apiFetch(`/llm/enrich-status/${enrichJob.job_id}`);
        setEnrichJob(prev=>({...s,startedAt:prev?.startedAt}));
        if(s.status==='done'||s.status==='error'){
          clearInterval(id);
          if(s.status==='done'){load();toast(`Enriched ${s.processed} transactions`);}
          else toast('Enrichment failed: '+(s.error||'unknown error'),'error');
        }
      }catch(e){clearInterval(id);}
    },2000);
    return()=>clearInterval(id);
  },[enrichJob?.job_id,enrichJob?.status]);// eslint-disable-line react-hooks/exhaustive-deps

  /* ── Period ──────────────────────────────────────────────── */
  const pickYear=y=>{const[from,to]=rangeFor(y,'');setPer({year:y,month:'',from,to});};
  const pickMonth=m=>{const[from,to]=rangeFor(per.year,m);setPer({...per,month:m,from,to});};
  const pickDate=(k,v)=>setPer({...per,year:'',month:'',[k]:v});
  const years=useMemo(()=>{const y=now.getFullYear();return[y,y-1,y-2].map(String);},[]);// eslint-disable-line react-hooks/exhaustive-deps

  const openT=openId!=null?txns.find(t=>t.id===openId):null;
  const reviewT=reviewId!=null?txns.find(t=>t.id===reviewId):null;
  const shown=visible.slice(0,limit);
  const sizer=useMemo(()=>{
    let amount='+$0.00',type='Expense',chips=0;
    visible.forEach(t=>{
      const a=signed(t.amount);if(a.length>amount.length)amount=a;
      const ty=t.action_display||t.action||'';if(ty.length>type.length)type=ty;
      chips=Math.max(chips,(t.is_gcb?1:0)+(t.is_excluded?1:0)+(t.is_locked?1:0));
    });
    return{amount,type,chips};
  },[visible]);
  const amtOn=!!(amt.min||amt.max);
  const job=enrichJob;
  const jobSecs=job?.startedAt?Math.round((Date.now()-job.startedAt)/1000):0;

  return(
    <div className="txp cloud">
      <header className="tx-hdr c-panel">
        <div className="tx-ht"><h1>Transactions</h1><span className="c-mut">{visible.length.toLocaleString('en-US')} shown</span></div>
        <div className="tx-acts">
          <button type="button" ref={addBtn} className="c-btn pri" aria-haspopup="menu" aria-expanded={menu==='add'} onClick={()=>setMenu(menu==='add'?null:'add')}>
            <CIcon name="plus" size={14}/>Add<CIcon name="down" size={12}/>
          </button>
          <button type="button" ref={moreBtn} className="c-btn ico" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu==='more'} onClick={()=>setMenu(menu==='more'?null:'more')}>
            <CIcon name="dots"/>
          </button>
        </div>
      </header>
      {menu==='add'&&<Popover anchor={addBtn.current} align="right" onClose={()=>setMenu(null)}>
        <div className="c-pop c-menu" role="menu">
          <button type="button" role="menuitem" className="c-mi" data-autofocus onClick={()=>{setMenu(null);setManual(true);}}><CIcon name="edit" size={14}/>Manual transaction</button>
          <button type="button" role="menuitem" className="c-mi" onClick={()=>{setMenu(null);setImporting(true);}}><CIcon name="up" size={14}/>Import a file (CSV, OFX)</button>
        </div>
      </Popover>}
      {menu==='more'&&<Popover anchor={moreBtn.current} align="right" onClose={()=>setMenu(null)}>
        <div className="c-pop c-menu" role="menu">
          <button type="button" role="menuitem" className="c-mi" data-autofocus onClick={()=>{setMenu(null);exportCSV();}}>↓ Export CSV</button>
          <button type="button" role="menuitem" className="c-mi" disabled={job?.status==='running'} onClick={()=>{setMenu(null);startEnrich();}}>✨ {job?.status==='running'?'Enriching…':'AI Enrich'}</button>
        </div>
      </Popover>}

      <section className="tx-card c-panel">
        <div className="tx-tb">
          <label className="tx-srch"><CIcon name="search" size={15}/>
            <input type="search" placeholder="Search transactions…" value={q} onChange={e=>setQ(e.target.value)} aria-label="Search transactions"/>
          </label>
          <div className="tx-tbs">
            <FilterChip label={chipLabel(f.act,'Type','All types',TXN_TYPES.length)} active={!!f.act} options={opts.act} selected={f.act} onApply={s=>setF({...f,act:s})}/>
            <FilterChip label={chipLabel(f.cat,'Category','All categories',opts.cat.length)} active={!!f.cat} options={opts.cat} selected={f.cat} onApply={s=>setF({...f,cat:s})}/>
            <FilterChip label={chipLabel(f.acct,'Account','All accounts',opts.acct.length,v=>acctName[v]||v)} active={!!f.acct} options={opts.acct} selected={f.acct} onApply={s=>setF({...f,acct:s})}/>
            {opts.net.length>0&&<FilterChip label={chipLabel(f.net,'Network','All networks',opts.net.length)} active={!!f.net} options={opts.net} selected={f.net} onApply={s=>setF({...f,net:s})}/>}
            {opts.brand.length>0&&<FilterChip label={chipLabel(f.brand,'Brand','All brands',opts.brand.length)} active={!!f.brand} options={opts.brand} selected={f.brand} onApply={s=>setF({...f,brand:s})}/>}
            <button type="button" ref={amtBtn} className={`c-fb ${amtOn?'on':''}`} aria-haspopup="dialog" aria-expanded={menu==='amt'} onClick={()=>setMenu(menu==='amt'?null:'amt')}>
              {amtOn?`Amount: ${amt.min?'$'+amt.min:'any'} – ${amt.max?'$'+amt.max:'any'}`:'Amount'}<CIcon name="down" size={12}/>
            </button>
            <button type="button" className={`c-fb ${rev?'on':''}`} aria-pressed={rev} onClick={()=>{setRev(!rev);setExc(false);}}>
              <CIcon name="alert" size={13}/>Needs review<em>{reviewCount}</em>
            </button>
            <button type="button" className={`c-fb ${exc?'on':''}`} aria-pressed={exc} title="Rows left out of every total" onClick={()=>{setExc(!exc);setRev(false);}}>
              <CIcon name="ban" size={13}/>Excluded<em>{excludedCount}</em>
            </button>
            <div className="tx-per">
              <select className="c-sel" aria-label="Year" value={per.year} onChange={e=>pickYear(e.target.value)}>
                <option value="">All years</option>{years.map(y=><option key={y} value={y}>{y}</option>)}
              </select>
              {per.year&&<select className="c-sel" aria-label="Month" value={per.month} onChange={e=>pickMonth(e.target.value)}>
                <option value="">All months</option>{MONTHS.map((m,i)=><option key={m} value={String(i+1)}>{m}</option>)}
              </select>}
              <span className="tx-dr">
                <input type="date" className="c-inp" aria-label="From" value={per.from} onChange={e=>pickDate('from',e.target.value)}/>
                <span className="c-mut">→</span>
                <input type="date" className="c-inp" aria-label="To" value={per.to} onChange={e=>pickDate('to',e.target.value)}/>
              </span>
            </div>
          </div>
          {anyFilter&&<button type="button" className="c-lnk tx-clear" onClick={clearFilters}>Clear filters</button>}
        </div>
        {menu==='amt'&&<Popover anchor={amtBtn.current} onClose={()=>setMenu(null)}>
          <div className="c-pop c-menu" role="dialog" aria-label="Amount">
            <div className="c-mi-in"><span>Amount, in either direction</span>
              <span className="tx-dr" style={{display:'inline-flex',alignItems:'center',gap:6}}>
                <input type="number" inputMode="decimal" min="0" step="0.01" className="c-inp" style={{width:90}} placeholder="Min $" data-autofocus value={amt.min} onChange={e=>setAmt({...amt,min:e.target.value})} aria-label="Minimum amount"/>
                <span className="c-mut">→</span>
                <input type="number" inputMode="decimal" min="0" step="0.01" className="c-inp" style={{width:90}} placeholder="Max $" value={amt.max} onChange={e=>setAmt({...amt,max:e.target.value})} aria-label="Maximum amount"/>
              </span>
            </div>
            <div className="c-pf">
              <button type="button" className="c-lnk" onClick={()=>setAmt({min:'',max:''})}>Clear</button>
              <button type="button" className="c-btn sm" onClick={()=>setMenu(null)}>Done</button>
            </div>
          </div>
        </Popover>}

        <div className="tx-ib" aria-live="polite">
          {exc
            ?<><span><b>{visible.length.toLocaleString('en-US')}</b> EXCLUDED {visible.length===1?'TRANSACTION':'TRANSACTIONS'}</span><span>LEFT OUT OF EVERY TOTAL</span></>
            :<><span><b>{visible.length.toLocaleString('en-US')}</b> TRANSACTIONS</span>
              {totals.exp!==0&&<span>EXPENSES: <b className={totals.exp>0?'c-bad':'c-good'}>{fmt(totals.exp)}</b></span>}
              {totals.inc>0&&<span>INCOME: <b className="c-good">{fmt(totals.inc)}</b></span>}</>}
          {txns.length>=LOAD_LIMIT&&<span className="tx-cap">Showing the latest {LOAD_LIMIT.toLocaleString('en-US')} rows; narrow the dates to see older ones.</span>}
        </div>
        {job&&<div className={`tx-job ${job.status==='done'?'done':job.status==='error'?'err':job.status==='running'&&jobSecs>90?'slow':''}`}>
          {job.status==='running'&&<span className="tx-spin"/>}
          {job.status==='done'&&<span className="c-good">✓</span>}
          {job.status==='error'&&<span className="c-bad">✗</span>}
          <span>
            {job.status==='running'&&`Enriching… ${job.processed}/${job.total||'?'} transactions`}
            {job.status==='done'&&`Enrichment complete: ${job.processed} enriched · ${job.llm_calls} AI calls · ${job.override_hits} from saved rules`}
            {job.status==='error'&&`Enrichment failed: ${job.error||'unknown error'}`}
          </span>
          {job.status==='running'&&jobSecs>90&&<span className="c-warn" style={{fontSize:12}}>Taking longer than usual ({jobSecs}s)</span>}
          <button type="button" className="c-btn ghost sm" onClick={()=>setEnrichJob(null)}>{job.status==='running'?'Hide':'Dismiss'}</button>
        </div>}
        {sel.size>0&&<div className="tx-bb">
          <span className="tx-bn">{sel.size} selected</span>
          <button type="button" className="c-btn pri sm" onClick={()=>setBatch(true)}>✎ Edit selected</button>
          <button type="button" className="c-btn ghost sm" onClick={()=>setSel(new Set())}>✕ Deselect all</button>
        </div>}

        <div className="tx-loading">
          {busy&&<div className="tx-veil"><span className="tx-spin"/></div>}
          {!loaded?null
            :loadError&&!txns.length?<div className="tx-empty">
                <div className="ei c-bad">!</div><span>Couldn't load transactions</span>
                <span className="c-mut" style={{maxWidth:420}}>{loadError}</span>
                <button type="button" className="c-btn" onClick={load}>Retry</button>
              </div>
            :!visible.length?<div className="tx-empty">
                <div className="ei">◎</div><span>No transactions found</span>
                {anyFilter&&<button type="button" className="c-lnk" onClick={clearFilters}>Clear filters</button>}
              </div>
            :<div className="tx-lsx">
              <div className="tx-lst" role="table" aria-label="Transactions" style={{'--gt':LEDGER_COLUMNS}}>
                <div className="tx-tr th" role="row">
                  <div className="td c-chkc"><input type="checkbox" className="rchk" checked={allSel} aria-label="Select all shown"
                    onChange={e=>setSel(e.target.checked?new Set(visible.map(t=>t.id)):new Set())}/></div>
                  {[['date','Date'],['description','Description'],['type','Type'],['category','Category'],['account','Account'],['amount','Amount']].map(([c,l])=>(
                    <div key={c} className={`td ${c==='amount'?'r':''}`}>
                      <button type="button" className={sort.col===c?'on':''} onClick={()=>toggleSort(c)} aria-label={`Sort by ${l}`}>
                        {l}<i>{sort.col===c?(sort.dir==='asc'?'▲':'▼'):'⇅'}</i>
                      </button>
                    </div>
                  ))}
                  <div className="td r"/>
                </div>
                <SizerRow widestType={sizer.type} widestAmount={sizer.amount} chips={sizer.chips}/>
                {shown.map((t,i)=><LedgerRow key={t.id} t={t} zebra={i%2===1} selected={sel.has(t.id)} expanded={exp.has(t.id)} editing={editId===t.id} categories={categories} onAct={onAct}/>)}
              </div>
              {shown.length<visible.length&&<div className="tx-more" ref={sentinel}>
                <button type="button" className="c-btn sm" onClick={()=>setLimit(l=>l+PAGE)}>Show more ({(visible.length-shown.length).toLocaleString('en-US')} left)</button>
              </div>}
            </div>}
        </div>
      </section>

      {openT&&<TxnDetailsWindow t={openT} lists={lists} onSave={saveTxn} toast={toast} onClose={()=>setOpenId(null)}
        onSplit={()=>{setOpenId(null);setSplitTxn(openT);}}
        onRule={()=>{setOpenId(null);setRuleTxn(openT);}}
        onDelete={()=>askDelete(openT)}/>}
      {reviewT&&<TxnReviewWindow t={reviewT} categories={categories} onSave={saveTxn} toast={toast} onClose={()=>setReviewId(null)}/>}
      {ruleTxn&&<TxnRuleWindow t={ruleTxn} categories={categories} toast={toast} onClose={()=>setRuleTxn(null)}
        onCreated={async()=>{await saveTxn(ruleTxn.id,{needs_review:false},null);await load();}}/>}
      {batch&&<TxnBatchWindow count={sel.size} categories={categories} onApply={applyBatch} onClose={()=>setBatch(false)}/>}
      {splitTxn&&<SplitEditorModal txn={splitTxn} categories={categories} onClose={()=>setSplitTxn(null)} onSaved={load} toast={toast}/>}
      {manual&&<ManualTransactionModal accounts={accounts} categories={categories} onClose={()=>setManual(false)} onSaved={load} toast={toast}/>}
      {importing&&<ImportModal accounts={accounts} onClose={()=>setImporting(false)} onImported={load} toast={toast}/>}
      {confirm&&<ConfirmModal {...confirm} onClose={()=>setConfirm(null)}/>}
    </div>
  );
}
