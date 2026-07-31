import {useState,useEffect,useMemo,useRef} from 'react';
import {SearchCreateSelect} from '../components/SearchCreateSelect';
import {SkeletonTable} from '../components/SkeletonTable';
import {apiFetch} from '../lib/api';
import {TXN_TYPES} from '../lib/constants';
import {fmt,fmtDate} from '../lib/format';

export function AccountCardDetailPage({accountId,onBack,toast,initialChallengeFilter}){
  const[d,setD]=useState(null);
  const[loading,setLoading]=useState(true);
  const[spendPeriod,setSpendPeriod]=useState('qtd');
  // Challenges
  const[challenges,setChallenges]=useState([]);
  const[challengesLoading,setChallengesLoading]=useState(false);
  const[pointsCategories,setPointsCategories]=useState([]);
  const[allCards,setAllCards]=useState([]);
  const[showChallengeModal,setShowChallengeModal]=useState(false);
  const[editingChallenge,setEditingChallenge]=useState(null);
  const[challengeVals,setChallengeVals]=useState({});
  const[confirmDeleteId,setConfirmDeleteId]=useState(null);
  const[suggestions,setSuggestions]=useState([]);
  const[spendRefreshing,setSpendRefreshing]=useState(false);
  // Recent Transactions — independent month/year/quarter filter
  const _now=new Date();
  const[txnView,setTxnView]=useState('monthly');   // 'monthly' | 'qtd' | 'ytd' | 'custom'
  const[txnYear,setTxnYear]=useState(_now.getFullYear());
  const[txnMonth,setTxnMonth]=useState(_now.getMonth()+1);
  const[txnQuarter,setTxnQuarter]=useState(Math.ceil((_now.getMonth()+1)/3));
  const[customStart,setCustomStart]=useState('');
  const[customEnd,setCustomEnd]=useState('');
  const[challengeFilterName,setChallengeFilterName]=useState(null);   // set when a challenge card drove the custom range
  const[txns,setTxns]=useState([]);
  const[txnSummary,setTxnSummary]=useState(null);
  const[availCscs,setAvailCscs]=useState([]);
  const[cscFilter,setCscFilter]=useState('');   // '' = all, '__none__' = no CSC, or a category name
  const[catFilter,setCatFilter]=useState('');   // general category filter (category_manual/category_auto), independent of CSC — e.g. 'Fees & Interest' for the annual-fee-vs-credits drill-down
  const[descFilter,setDescFilter]=useState('');  // free-text description/merchant search
  const[sortCol,setSortCol]=useState('date');    // 'date'|'description'|'amount'|'csc'|'pts'
  const[sortDir,setSortDir]=useState('desc');    // 'asc'|'desc'
  const[txnsLoading,setTxnsLoading]=useState(false);
  // Inline CSC editing state
  const[editingCscId,setEditingCscId]=useState(null);
  const[editingCscVal,setEditingCscVal]=useState('');
  // Inline Action-type editing state
  const[editingActionId,setEditingActionId]=useState(null);
  const[editingActionVal,setEditingActionVal]=useState('');
  // Inline points-earn manual override state (see compute_points_earn in main.py)
  const[editingPtsOverrideId,setEditingPtsOverrideId]=useState(null);
  const[editingPtsOverrideVal,setEditingPtsOverrideVal]=useState('');
  const[excludingId,setExcludingId]=useState(null);   // txn id currently being toggled (disables the button mid-request)
  const[allCscs,setAllCscs]=useState([]);  // full list of categories for editing
  // Inline Spender editing + bulk-select/tag state (who made the purchase —
  // manual only, Plaid gives no cardholder signal on shared/employee-card accounts)
  const[spenders,setSpenders]=useState([]);
  const[editingSpenderId,setEditingSpenderId]=useState(null);
  const[selectedTxnIds,setSelectedTxnIds]=useState(()=>new Set());
  const[bulkTagging,setBulkTagging]=useState(false);
  // Teach-merchant prompt (shown after inline CSC save when merchant_name is available)
  const[teachPrompt,setTeachPrompt]=useState(null);  // {merchantName, csc} | null
  const[teachLoading,setTeachLoading]=useState(false);
  // Unclassified merchants grouped view (shown when cscFilter==='__none__')
  const[unclassified,setUnclassified]=useState([]);
  const[unclassifiedLoading,setUnclassifiedLoading]=useState(false);
  const[assigningMerchant,setAssigningMerchant]=useState(null);
  const[assignCscVal,setAssignCscVal]=useState('');
  const[assignLoading,setAssignLoading]=useState(false);
  // Benefits state
  const[cardBenefits,setCardBenefits]=useState([]);
  const[benefitsLoading,setBenefitsLoading]=useState(false);
  const[showBenefitModal,setShowBenefitModal]=useState(false);
  const[editingBenefitId,setEditingBenefitId]=useState(null);
  const[benefitForm,setBenefitForm]=useState({benefit_name:'',amount:'',reset_frequency:'annual',tracking_type:'periodic',trigger_category:'',notes:''});
  const[logUsageFor,setLogUsageFor]=useState(null);   // benefit id currently being logged
  const[logUsageAmt,setLogUsageAmt]=useState('');
  const[logUsageNotes,setLogUsageNotes]=useState('');
  const[benefitSaving,setBenefitSaving]=useState(false);
  const[togglingCycle,setTogglingCycle]=useState(null);   // benefit id currently mid-toggle (disables its grid)
  // Card product change + history state
  const[allCardProducts,setAllCardProducts]=useState([]);
  const[productHistory,setProductHistory]=useState([]);
  const[showHistory,setShowHistory]=useState(false);
  const[showChangeProductModal,setShowChangeProductModal]=useState(false);
  const[changeProductForm,setChangeProductForm]=useState({product_id:'',effective_date:new Date().toISOString().slice(0,10)});
  const[changingProduct,setChangingProduct]=useState(false);
  const txnSectionRef=useRef(null);   // Transactions card — scrolled into view when a challenge sets the custom filter
  const loadTxns=async(yr,mo,view,qtr,csc,cStart,cEnd,silent,cat)=>{
    // silent=true skips the loading flag — used for post-edit refreshes so the
    // table doesn't unmount to a spinner and cause the page to jump; the full
    // loading state stays for real period/filter changes (initial load feel).
    if(!silent)setTxnsLoading(true);
    try{
      const y=yr??txnYear; const m=mo??txnMonth; const v=view||txnView; const q=qtr??txnQuarter;
      const c=csc!==undefined?csc:cscFilter;
      const cat2=cat!==undefined?cat:catFilter;
      const cs=cStart!==undefined?cStart:customStart; const ce=cEnd!==undefined?cEnd:customEnd;
      let qs;
      if(v==='custom'&&cs&&ce) qs=`start_date=${cs}&end_date=${ce}&action=Expense`;
      else if(v==='ytd') qs=`year=${y}&action=Expense`;
      else if(v==='qtd') qs=`year=${y}&quarter=${q}&action=Expense`;
      else qs=`year=${y}&month=${m}&action=Expense`;
      if(c) qs+=`&csc=${encodeURIComponent(c)}`;
      if(cat2) qs+=`&category=${encodeURIComponent(cat2)}`;
      const r=await apiFetch(`/accounts/${accountId}/transactions?${qs}`);
      setTxns(r.transactions||[]);
      setTxnSummary(r.summary||null);
      setAvailCscs(r.available_cscs||[]);
    }catch(e){}
    finally{if(!silent)setTxnsLoading(false);}
  };
  // Fetch full CSC list once for inline editing dropdown
  useEffect(()=>{
    apiFetch('/points-categories').then(r=>{setAllCscs((r||[]).filter(c=>c.is_active));}).catch(()=>{});
  },[]);
  // Fetch known spender names once for the tagging combobox
  const loadSpenders=()=>{apiFetch('/transactions/spenders').then(setSpenders).catch(()=>{});};
  useEffect(()=>{loadSpenders();},[]);
  const saveSpenderEdit=async(txnId,newVal)=>{
    try{
      await apiFetch(`/transactions/${txnId}`,{method:'PATCH',body:JSON.stringify({spender:newVal||''})});
      setEditingSpenderId(null);
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
      loadSpenders();
    }catch(e){toast('Failed to save spender: '+(e?.message||''),'error');}
  };
  const toggleTxnSelected=(id)=>{
    setSelectedTxnIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  };
  const bulkTagSpender=async(val)=>{
    if(!val||selectedTxnIds.size===0)return;
    setBulkTagging(true);
    try{
      await apiFetch('/transactions/batch-update',{method:'POST',body:JSON.stringify({
        ids:[...selectedTxnIds], updates:{spender:val},
      })});
      toast(`Tagged ${selectedTxnIds.size} transaction${selectedTxnIds.size!==1?'s':''} as ${val}`,'success');
      setSelectedTxnIds(new Set());
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
      loadSpenders();
    }catch(e){toast('Bulk tag failed: '+(e?.message||''),'error');}
    finally{setBulkTagging(false);}
  };
  const saveCscEdit=async(txnId,newVal)=>{
    try{
      await apiFetch(`/transactions/${txnId}`,{method:'PATCH',body:JSON.stringify({points_category:newVal||null})});
      // Find the transaction before updating state so we have merchant_name
      const txn=txns.find(t=>t.id===txnId);
      setEditingCscId(null);
      // Silently reload txns so earn_rate updates to reflect the new CSC
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
      // Offer to teach this merchant for all past + future transactions
      if(newVal&&txn?.merchant_name){
        setTeachPrompt({merchantName:txn.merchant_name,csc:newVal});
      }
    }catch(e){toast('Failed to save CSC: '+(e?.message||''),'error');}
  };
  const saveActionEdit=async(txnId,newVal)=>{
    try{
      await apiFetch(`/transactions/${txnId}`,{method:'PATCH',body:JSON.stringify({action:newVal})});
      setEditingActionId(null);
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
    }catch(e){toast('Failed to save type: '+(e?.message||''),'error');}
  };
  const toggleExcludeTxn=async(txn)=>{
    setExcludingId(txn.id);
    try{
      await apiFetch(`/transactions/${txn.id}`,{method:'PATCH',body:JSON.stringify({is_excluded:!txn.is_excluded})});
      toast(txn.is_excluded?'Included — earns points again':'Excluded — no points, no SUB spend credit','success');
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
    }catch(e){toast('Failed to update: '+(e?.message||''),'error');}
    finally{setExcludingId(null);}
  };
  const savePtsOverride=async(txnId,val)=>{
    if(val===''||isNaN(Number(val)))return;
    try{
      await apiFetch(`/transactions/${txnId}`,{method:'PATCH',body:JSON.stringify({points_earn_override:Number(val)})});
      toast('Points override saved','success');
      setEditingPtsOverrideId(null);
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
    }catch(e){toast('Failed to save override: '+(e?.message||''),'error');}
  };
  const resetPtsOverride=async(txnId)=>{
    try{
      await apiFetch(`/transactions/${txnId}`,{method:'PATCH',body:JSON.stringify({clear_points_earn_override:true})});
      toast('Reset to auto-classification','success');
      setEditingPtsOverrideId(null);
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
    }catch(e){toast('Failed to reset: '+(e?.message||''),'error');}
  };
  const teachMerchant=async(merchantName,csc)=>{
    setTeachLoading(true);
    try{
      const r=await apiFetch('/merchant-csc',{method:'POST',body:JSON.stringify({
        merchant_pattern:merchantName,
        points_category:csc,
        apply_to_existing:true,
      })});
      toast(`✓ Saved — ${r.transactions_updated} past transaction${r.transactions_updated!==1?'s':''} updated`,'success');
      setTeachPrompt(null);
      // Reload txns so backfilled rows reflect the change
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
      if(cscFilter==='__none__') loadUnclassified();
    }catch(e){toast('Failed: '+(e?.message||''),'error');}
    finally{setTeachLoading(false);}
  };
  const loadUnclassified=()=>{
    setUnclassifiedLoading(true);
    apiFetch(`/transactions/unclassified-merchants?account_id=${accountId}&limit=50`)
      .then(r=>{setUnclassified(r.unclassified||[]);})
      .catch(()=>{})
      .finally(()=>setUnclassifiedLoading(false));
  };
  const assignMerchantCsc=async(merchantName,csc)=>{
    setAssignLoading(true);
    try{
      const r=await apiFetch('/merchant-csc',{method:'POST',body:JSON.stringify({
        merchant_pattern:merchantName,
        points_category:csc,
        apply_to_existing:true,
      })});
      toast(`✓ ${r.transactions_updated} transaction${r.transactions_updated!==1?'s':''} updated`,'success');
      setAssigningMerchant(null);
      setAssignCscVal('');
      loadUnclassified();
      loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,undefined,undefined,true);
    }catch(e){toast('Failed: '+(e?.message||''),'error');}
    finally{setAssignLoading(false);}
  };
  // Sort helper — toggles dir if same col, resets to sensible default for new col
  const handleSort=(col)=>{
    if(sortCol===col){setSortDir(d=>d==='asc'?'desc':'asc');}
    else{setSortCol(col);setSortDir(col==='amount'||col==='pts'?'desc':'asc');}
  };
  const sortArrow=(col)=>sortCol===col?(sortDir==='asc'?' ▲':' ▼'):'';
  // Client-side filter + sort applied on top of API-loaded txns
  const displayTxns=useMemo(()=>{
    let r=txns;
    if(descFilter.trim()){
      const needle=descFilter.toLowerCase();
      r=r.filter(t=>(t.description||'').toLowerCase().includes(needle)||(t.merchant_name||'').toLowerCase().includes(needle));
    }
    return [...r].sort((a,b)=>{
      let av,bv;
      if(sortCol==='date'){av=a.date;bv=b.date;}
      else if(sortCol==='description'){av=(a.description||'').toLowerCase();bv=(b.description||'').toLowerCase();}
      else if(sortCol==='amount'){av=Math.abs(a.amount||0);bv=Math.abs(b.amount||0);}
      else if(sortCol==='csc'){av=a.points_category||'';bv=b.points_category||'';}
      else if(sortCol==='pts'){av=a.points_earn||0;bv=b.points_earn||0;}
      else return 0;
      if(av<bv)return sortDir==='asc'?-1:1;
      if(av>bv)return sortDir==='asc'?1:-1;
      return 0;
    });
  },[txns,descFilter,sortCol,sortDir]);
  const txnMonthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const prevTxnMonth=()=>{
    if(txnMonth===1){setTxnYear(y=>y-1);setTxnMonth(12);}else{setTxnMonth(m=>m-1);}
  };
  const nextTxnMonth=()=>{
    const _n=new Date();
    if(txnYear===_n.getFullYear()&&txnMonth===_n.getMonth()+1)return;
    if(txnMonth===12){setTxnYear(y=>y+1);setTxnMonth(1);}else{setTxnMonth(m=>m+1);}
  };
  const prevTxnQuarter=()=>{
    if(txnQuarter===1){setTxnYear(y=>y-1);setTxnQuarter(4);}else{setTxnQuarter(q=>q-1);}
  };
  const nextTxnQuarter=()=>{
    const _n=new Date();
    const curQ=Math.ceil((_n.getMonth()+1)/3);
    if(txnYear===_n.getFullYear()&&txnQuarter>=curQ)return;
    if(txnQuarter===4){setTxnYear(y=>y+1);setTxnQuarter(1);}else{setTxnQuarter(q=>q+1);}
  };
  // Clicking a Spend Challenge card auto-filters the Transactions table to its
  // date range — still fully editable afterward via the Custom date inputs.
  const filterTxnsToChallenge=(ch)=>{
    const start=(ch.start_date||'').slice(0,10);
    const end=(ch.end_date||'').slice(0,10);
    if(!start||!end)return;
    setTxnView('custom');
    setCustomStart(start);
    setCustomEnd(end);
    setChallengeFilterName(ch.name);
    txnSectionRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  // Clicking the Annual Fee tile filters Transactions to the 'Fees & Interest'
  // category for the current fee cycle (anniversary-anchored on the backend —
  // see _annual_fee_cycle_window) — same drill-down pattern as challenges,
  // but keyed on the general category field instead of the CSC/points-category.
  const filterTxnsToFeesInterest=()=>{
    if(!d?.annual_fee_summary)return;
    const{cycle_start,cycle_end}=d.annual_fee_summary;
    setTxnView('custom');
    setCustomStart(cycle_start);
    setCustomEnd(cycle_end);
    setCatFilter('Fees & Interest');
    setChallengeFilterName('Fees & Interest — this cycle');
    txnSectionRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  // Same as filterTxnsToChallenge, but for a challenge clicked from the
  // Portfolio page (before this component has its own `challenges` list
  // loaded) — the Portfolio-level challenge object already carries
  // start_date/end_date/name, so this applies on mount without waiting.
  useEffect(()=>{
    if(initialChallengeFilter?.start&&initialChallengeFilter?.end){
      setTxnView('custom');
      setCustomStart(initialChallengeFilter.start);
      setCustomEnd(initialChallengeFilter.end);
      setChallengeFilterName(initialChallengeFilter.name||null);
    }
    // eslint-disable-next-line
  },[]);
  // txnSectionRef isn't attached to the DOM yet during the initial
  // loading-skeleton render (see `if(loading)return<SkeletonTable.../>`
  // below), so the scroll-into-view has to wait for that to clear —
  // can't just do it in the mount effect above. initialScrollDone guards
  // against re-scrolling on later loading flips (e.g. changing spendPeriod).
  const initialScrollDone=useRef(false);
  useEffect(()=>{
    if(!loading&&initialChallengeFilter?.start&&!initialScrollDone.current){
      initialScrollDone.current=true;
      // loadChallenges/loadBenefits/loadTxns all fire around this same
      // loading→false transition and reflow the page shortly after (unlike
      // filterTxnsToChallenge's same-page click above, which has no
      // competing loads) — that concurrent reflow was starving a 'smooth'
      // scrollIntoView's animation frames, leaving it stuck a few px in.
      // 'auto' (instant) sidesteps that; deferred one tick so the ref's
      // position reflects the post-reflow layout, not a stale one.
      setTimeout(()=>{txnSectionRef.current?.scrollIntoView({behavior:'auto',block:'start'});},150);
    }
    // eslint-disable-next-line
  },[loading]);
  const load=async(p,silent)=>{
    if(silent){setSpendRefreshing(true);}else{setLoading(true);}
    try{setD(await apiFetch(`/accounts/${accountId}/card-detail?period=${p||spendPeriod}`));}
    catch(e){if(!silent)toast('Failed to load card detail','error');}
    finally{if(silent){setSpendRefreshing(false);}else{setLoading(false);}}
  };
  const loadChallenges=async(cardId)=>{
    if(!cardId)return;
    setChallengesLoading(true);
    try{
      const[ch,cardsAll]=await Promise.all([
        apiFetch(`/challenges?card_id=${cardId}`),
        apiFetch('/cards'),
      ]);
      setChallenges(ch);
      setAllCards(cardsAll.filter(c=>c.is_active&&c.id!==cardId));
    }catch(e){toast('Failed to load challenges','error');}
    finally{setChallengesLoading(false);}
  };
  // Load points categories independently — needed for the challenge modal
  // even when there's no card row linked
  useEffect(()=>{
    apiFetch('/points-categories').then(cats=>setPointsCategories(cats)).catch(()=>{});
  },[]);

  const loadBenefits=async(cardId)=>{
    if(!cardId)return;
    setBenefitsLoading(true);
    try{const r=await apiFetch(`/cards/${cardId}/benefits`);setCardBenefits(r);}
    catch(e){toast('Failed to load benefits','error');}
    finally{setBenefitsLoading(false);}
  };
  // Card product change + history — lets a card's linked product be swapped
  // (e.g. issuer product-changes Bonvoy Boundless → Ritz-Carlton) while
  // keeping the same account/card and all its transaction history. Past
  // transactions' points stay locked to whatever product was active when
  // they posted (see _lock_points_for_transaction in main.py) — changing
  // the product here only affects new/edited transactions going forward.
  const loadProductHistory=async(cardId)=>{
    if(!cardId)return;
    try{setProductHistory(await apiFetch(`/cards/${cardId}/product-history`));}
    catch(e){/* non-fatal — history is a display-only nicety */}
  };
  const openChangeProductModal=()=>{
    setChangeProductForm({product_id:'',effective_date:new Date().toISOString().slice(0,10)});
    setShowChangeProductModal(true);
  };
  const saveChangeProduct=async()=>{
    if(!d?.card?.id){toast('No card linked to this account yet','error');return;}
    if(!changeProductForm.product_id){toast('Choose a product','error');return;}
    setChangingProduct(true);
    try{
      const r=await apiFetch(`/cards/${d.card.id}/change-product`,{method:'POST',body:JSON.stringify({
        product_id:parseInt(changeProductForm.product_id,10),
        effective_date:changeProductForm.effective_date,
      })});
      toast(`Changed to ${r.new_product_name}`);
      setShowChangeProductModal(false);
      await load();
      loadProductHistory(d.card.id);
    }catch(e){toast('Change failed: '+(e?.message||''),'error');}
    finally{setChangingProduct(false);}
  };
  const saveBenefit=async()=>{
    if(!benefitForm.benefit_name.trim()){toast('Benefit name required','error');return;}
    if(!d?.product?.id){toast('No product linked to this card','error');return;}
    setBenefitSaving(true);
    try{
      if(editingBenefitId){
        await apiFetch(`/benefits/${editingBenefitId}`,{method:'PATCH',body:JSON.stringify({...benefitForm,amount:parseFloat(benefitForm.amount)||0})});
      }else{
        await apiFetch(`/card-products/${d.product.id}/benefits`,{method:'POST',body:JSON.stringify({...benefitForm,amount:parseFloat(benefitForm.amount)||0})});
      }
      setShowBenefitModal(false);
      loadBenefits(d.card.id);
    }catch(e){toast('Save failed: '+(e?.message||''),'error');}
    finally{setBenefitSaving(false);}
  };
  const deleteBenefit=async(id,name)=>{
    if(!window.confirm(`Delete benefit "${name}"?`))return;
    try{
      await apiFetch(`/benefits/${id}`,{method:'DELETE'});
      setCardBenefits(prev=>prev.filter(b=>b.id!==id));
    }catch(e){toast('Delete failed: '+(e?.message||''),'error');}
  };
  const logUsage=async(benefitId,amtStr,notes)=>{
    const amt=parseFloat(amtStr);
    if(isNaN(amt)||amt<0){toast('Enter a valid amount','error');return;}
    setBenefitSaving(true);
    try{
      await apiFetch(`/benefits/${benefitId}/usage`,{method:'PUT',body:JSON.stringify({
        card_id:d.card.id, amount_used:amt, confirmed:true, notes:notes||null,
      })});
      setLogUsageFor(null);setLogUsageAmt('');setLogUsageNotes('');
      loadBenefits(d.card.id);
    }catch(e){toast('Failed: '+(e?.message||''),'error');}
    finally{setBenefitSaving(false);}
  };
  const clearUsage=async(usageId,benefitId)=>{
    if(!window.confirm('Clear usage for this benefit?'))return;
    try{
      await apiFetch(`/benefit-usage/${usageId}`,{method:'DELETE'});
      loadBenefits(d.card.id);
    }catch(e){toast('Failed: '+(e?.message||''),'error');}
  };
  // One-click toggle for a single period in a periodic benefit's usage grid —
  // marks the full amount used, or un-marks by deleting the usage row.
  const toggleBenefitCycle=async(b,cy)=>{
    setTogglingCycle(`${b.id}`);
    try{
      if(cy.used&&cy.usage_id){
        await apiFetch(`/benefit-usage/${cy.usage_id}`,{method:'DELETE'});
      }else{
        await apiFetch(`/benefits/${b.id}/usage`,{method:'PUT',body:JSON.stringify({
          card_id:d.card.id, cycle:cy.cycle, amount_used:b.amount, confirmed:true,
        })});
      }
      loadBenefits(d.card.id);
    }catch(e){toast('Failed: '+(e?.message||''),'error');}
    finally{setTogglingCycle(null);}
  };
  const nextResetLabel=(freq)=>{
    const now=new Date();const y=now.getFullYear();const mo=now.getMonth()+1;
    const mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if(freq==='monthly'){const ld=new Date(y,mo,0).getDate();return`${mn[mo-1]} ${ld}`;}
    if(freq==='quarterly'){const qe=Math.ceil(mo/3)*3;const ld=new Date(y,qe,0).getDate();return`${mn[qe-1]} ${ld}`;}
    if(freq==='semi-annual'){return mo<=6?`Jun 30`:`Dec 31`;}
    return`Dec 31, ${y}`;
  };
  const annualValue=(b)=>{
    if(!b.amount)return 0;
    const f=b.reset_frequency;
    return f==='monthly'?b.amount*12:f==='quarterly'?b.amount*4:f==='semi-annual'?b.amount*2:b.amount;
  };

  useEffect(()=>{load();},[accountId]);
  useEffect(()=>{if(d)load(spendPeriod,true);},[spendPeriod]);
  // When card detail loads, load challenges + benefits for this card
  useEffect(()=>{
    if(d?.card?.id){loadChallenges(d.card.id);loadBenefits(d.card.id);loadProductHistory(d.card.id);}
  },[d?.card?.id]);
  // Full product catalog, for the Change Product picker
  useEffect(()=>{
    apiFetch('/card-products').then(setAllCardProducts).catch(()=>{});
  },[]);
  // Transactions filter — reload when year/month/quarter/view/cscFilter changes
  useEffect(()=>{loadTxns(txnYear,txnMonth,txnView,txnQuarter,cscFilter,customStart,customEnd,false,catFilter);setSelectedTxnIds(new Set());},[accountId,txnYear,txnMonth,txnView,txnQuarter,cscFilter,customStart,customEnd,catFilter]);
  // Load grouped unclassified merchants when filter='__none__'
  useEffect(()=>{if(cscFilter==='__none__')loadUnclassified();},[accountId,cscFilter]);

  if(loading)return<SkeletonTable rows={8}/>;
  if(!d)return<div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Account not found</div>;

  const acct=d.account;
  const c=d.card;
  const p=d.product;
  const eco=d.ecosystem;
  const issuerGradient={
    'chase':'linear-gradient(135deg,#003087 0%,#0060c7 100%)',
    'amex':'linear-gradient(135deg,#006FCF 0%,#00A5E5 100%)',
    'american express':'linear-gradient(135deg,#006FCF 0%,#00A5E5 100%)',
    'citi':'linear-gradient(135deg,#003B70 0%,#005DAA 100%)',
    'discover':'linear-gradient(135deg,#FF6600 0%,#FF8C00 100%)',
    'capital one':'linear-gradient(135deg,#004879 0%,#0072B5 100%)',
    'fidelity':'linear-gradient(135deg,#4A8C2A 0%,#6DB33F 100%)',
    'hilton':'linear-gradient(135deg,#104C97 0%,#2E7BD5 100%)',
    'hyatt':'linear-gradient(135deg,#8B6914 0%,#C49B1A 100%)',
    'marriott':'linear-gradient(135deg,#8C1D40 0%,#BE2A5A 100%)',
    'best buy':'linear-gradient(135deg,#003B64 0%,#0058A3 100%)',
    'amazon':'linear-gradient(135deg,#232F3E 0%,#37475A 100%)',
  };
  const nameLower=(acct.name||'').toLowerCase();
  const grad=Object.entries(issuerGradient).find(([k])=>nameLower.includes(k))?.[1]
    ||(c?issuerGradient[(c.issuer||'').toLowerCase()]:null)
    ||'linear-gradient(135deg,#374151 0%,#6B7280 100%)';
  // Card image: /static/images/cards/{product_key}.png (or .jpg / .webp)
  // Falls back silently to gradient if file not present
  const cardImgSrc=p?.product_key?`/static/images/cards/${p.product_key}.png`:null;
  const displayName=p?p.card_name:(c?c.card_name:acct.name);
  const bal=acct.balance;
  const utilPct=d.utilization;
  const topCats=(d.spending_by_category||[]).slice(0,6);
  const maxSpend=topCats.length?Math.max(...topCats.map(s=>s.amount)):1;

  // Challenge helpers
  const toggleArr=(arr,val)=>arr.includes(val)?arr.filter(x=>x!==val):[...arr,val];
  const setV=(k,v)=>setChallengeVals(prev=>({...prev,[k]:v}));
  const defaultVals=()=>({
    card_id:c?.id||'',name:'',challenge_type:'sub',
    start_date:'',end_date:'',activation_date:'',
    bonus_type:'flat',bonus_amount:'',
    spend_cap:'',spend_threshold:'',spender_filter:'',max_occurrences:'',
    category_names:[],additional_card_ids:[],
    is_active:true,notes:'',
  });
  const openNew=()=>{setChallengeVals(defaultVals());setEditingChallenge(null);setShowChallengeModal(true);};
  const openEdit=(ch)=>{
    setChallengeVals({
      card_id:ch.card_id,name:ch.name,challenge_type:ch.challenge_type,
      start_date:ch.start_date,end_date:ch.end_date,activation_date:ch.activation_date||'',
      bonus_type:ch.bonus_type,bonus_amount:ch.bonus_amount,
      spend_cap:ch.spend_cap||'',spend_threshold:ch.spend_threshold||'',spender_filter:ch.spender_filter||'',max_occurrences:ch.max_occurrences||'',
      category_names:ch.category_names||[],additional_card_ids:ch.additional_card_ids||[],
      is_active:ch.is_active,notes:ch.notes||'',
    });
    setEditingChallenge(ch.id);setShowChallengeModal(true);
  };
  const openFromTemplate=(tmpl)=>{
    const yr=new Date().getFullYear();
    setChallengeVals({
      card_id:c?.id||'',name:tmpl.name,challenge_type:tmpl.challenge_type,
      start_date:tmpl.start_date||`${yr}-01-01`,
      end_date:tmpl.end_date||`${yr}-12-31`,
      activation_date:'',
      bonus_type:tmpl.bonus_type,bonus_amount:tmpl.bonus_amount,
      spend_cap:tmpl.spend_cap||'',spend_threshold:tmpl.spend_threshold||'',spender_filter:'',max_occurrences:'',
      category_names:tmpl.category_names||[],additional_card_ids:[],
      is_active:true,notes:tmpl.notes||'',
    });
    setEditingChallenge(null);setShowChallengeModal(true);
  };
  const saveChallenge=async()=>{
    const v=challengeVals;
    if(!v.name||!v.challenge_type||!v.start_date||!v.end_date||!v.bonus_amount){
      toast('Please fill in all required fields','error');return;
    }
    try{
      const body={
        card_id:v.card_id||c?.id,
        name:v.name,challenge_type:v.challenge_type,
        start_date:v.start_date,end_date:v.end_date,
        activation_date:v.activation_date||null,
        bonus_type:v.bonus_type,bonus_amount:parseFloat(v.bonus_amount),
        spend_cap:v.spend_cap?parseFloat(v.spend_cap):null,
        spend_threshold:v.spend_threshold?parseFloat(v.spend_threshold):null,
        spender_filter:v.spender_filter||null,
        max_occurrences:v.max_occurrences?parseInt(v.max_occurrences,10):null,
        category_names:v.category_names||[],
        additional_card_ids:(v.additional_card_ids||[]).map(Number),
        is_active:v.is_active,notes:v.notes||null,
      };
      if(editingChallenge){
        await apiFetch(`/challenges/${editingChallenge}`,{method:'PATCH',body:JSON.stringify(body)});
      }else{
        await apiFetch('/challenges',{method:'POST',body:JSON.stringify(body)});
      }
      setShowChallengeModal(false);
      await loadChallenges(c.id);
      toast(editingChallenge?'Challenge updated':'Challenge created');
    }catch(e){
      // Show actual server error so we can diagnose — truncate if very long
      const msg=e?.message||'Unknown error';
      toast('Save failed: '+(msg.length>120?msg.slice(0,120)+'…':msg),'error');
    }
  };
  const doDelete=async()=>{
    if(!confirmDeleteId)return;
    try{
      await apiFetch(`/challenges/${confirmDeleteId}`,{method:'DELETE'});
      setConfirmDeleteId(null);
      await loadChallenges(c.id);
      toast('Challenge deleted');
    }catch(e){toast('Failed to delete','error');}
  };

  // Challenge modal
  const ChallengeModal=showChallengeModal&&(()=>{
    const v=challengeVals;
    const showSpendCap=['rate_cap','category_rate_cap'].includes(v.challenge_type);
    const showThreshold=['threshold_bonus','sub','annual_threshold'].includes(v.challenge_type);
    const showCategory=true; // categories are optional for all challenge types
    return(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div className="card" style={{width:540,maxHeight:'90vh',overflowY:'auto',padding:0}}>
          <div style={{padding:'20px 24px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontSize:16,fontWeight:400}}>{editingChallenge?'Edit Challenge':'New Challenge'}</div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setShowChallengeModal(false)}>&#x2715;</button>
          </div>
          <div style={{padding:'20px 24px',display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Challenge Name *</label>
              <input value={v.name} onChange={e=>setV('name',e.target.value)}
                placeholder="e.g. Signup Bonus, Q1 5x Groceries..."
                style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Challenge Type *</label>
              <select value={v.challenge_type} onChange={e=>{
                const t=e.target.value;
                setV('challenge_type',t);
                setV('bonus_type',['sub','annual_threshold'].includes(t)?'flat':'per_dollar');
              }} style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg)',color:'var(--text-primary)'}}>
                <option value="sub">SUB (Sign-Up Bonus)</option>
                <option value="rate_cap">Rate Cap (e.g. 5x up to $1,500)</option>
                <option value="threshold_bonus">Threshold Bonus (spend $X, earn Y&#xD7;)</option>
                <option value="category_rate_cap">Category Rate Cap (rotating category)</option>
                <option value="annual_threshold">Annual Threshold (e.g. free night cert)</option>
              </select>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
              <div>
                <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Start Date *</label>
                <input type="date" value={v.start_date} onChange={e=>setV('start_date',e.target.value)}
                  style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>End Date *</label>
                <input type="date" value={v.end_date} onChange={e=>setV('end_date',e.target.value)}
                  style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4,display:'flex',alignItems:'center',gap:4}}>
                  Activation Date
                  <span style={{fontSize:10,fontWeight:400,color:'var(--text-muted)',cursor:'help'}} title="Spend tracking starts at max(start_date, activation_date). Set this if you got the card after the challenge period started.">&#9432;</span>
                </label>
                <input type="date" value={v.activation_date} onChange={e=>setV('activation_date',e.target.value)}
                  style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
              </div>
            </div>
            <div style={{display:'flex',gap:12}}>
              <div style={{flex:1}}>
                <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Bonus Type</label>
                <select value={v.bonus_type} onChange={e=>setV('bonus_type',e.target.value)}
                  style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg)',color:'var(--text-primary)'}}>
                  <option value="flat">Flat (total points)</option>
                  <option value="per_dollar">Per Dollar (pts/$)</option>
                  <option value="statement_credit">Statement Credit ($)</option>
                  <option value="benefit">Benefit (free night, status, etc.)</option>
                </select>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>
                  {v.bonus_type==='flat'?'Bonus Points *':v.bonus_type==='statement_credit'?'Credit Amount ($) *':v.bonus_type==='benefit'?'# of Rewards *':'Pts per Dollar *'}
                </label>
                <input type="number" step="any" value={v.bonus_amount} onChange={e=>setV('bonus_amount',e.target.value)}
                  placeholder={v.bonus_type==='flat'?'e.g. 60000':v.bonus_type==='statement_credit'?'e.g. 325':v.bonus_type==='benefit'?'e.g. 1':'e.g. 5'}
                  style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
              </div>
            </div>
            {showSpendCap&&<div>
              <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Spend Cap ($)</label>
              <input type="number" step="any" value={v.spend_cap} onChange={e=>setV('spend_cap',e.target.value)}
                placeholder="e.g. 1500"
                style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
            </div>}
            {showThreshold&&<div style={{display:'flex',gap:12}}>
              <div style={{flex:1}}>
                <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Spend Threshold ($)</label>
                <input type="number" step="any" value={v.spend_threshold} onChange={e=>setV('spend_threshold',e.target.value)}
                  placeholder="e.g. 4000"
                  style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Repeat Up To <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <input type="number" step="1" min="1" value={v.max_occurrences} onChange={e=>setV('max_occurrences',e.target.value)}
                  placeholder="e.g. 3 times"
                  style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
              </div>
            </div>}
            {showCategory&&<div>
              <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:6}}>Limit to Categories <span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional — leave blank to count all spend)</span></label>
              <div style={{border:'1px solid var(--border)',borderRadius:6,maxHeight:160,overflowY:'auto',padding:'6px 10px',display:'flex',flexDirection:'column',gap:4}}>
                {pointsCategories.map(pc=>(
                  <label key={pc.id} style={{fontSize:12,display:'flex',alignItems:'center',gap:6,cursor:'pointer',paddingLeft:pc.parent_key?14:0}}>
                    <input type="checkbox"
                      checked={(v.category_names||[]).includes(pc.name)}
                      onChange={e=>setV('category_names',e.target.checked?[...(v.category_names||[]),pc.name]:(v.category_names||[]).filter(n=>n!==pc.name))}/>
                    {pc.name}
                    {pc.parent_key&&<span style={{fontSize:10,color:'var(--text-muted)'}}>({pc.parent_key})</span>}
                  </label>
                ))}
              </div>
            </div>}
            {allCards.length>0&&<div>
              <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:6}}>Apply to Additional Cards</label>
              <div style={{border:'1px solid var(--border)',borderRadius:6,maxHeight:120,overflowY:'auto',padding:'6px 10px',display:'flex',flexDirection:'column',gap:4}}>
                {allCards.map(ac=>(
                  <label key={ac.id} style={{fontSize:12,display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                    <input type="checkbox"
                      checked={(v.additional_card_ids||[]).map(Number).includes(ac.id)}
                      onChange={()=>setV('additional_card_ids',toggleArr((v.additional_card_ids||[]).map(Number),ac.id))}/>
                    {ac.card_name||`Card #${ac.id}`}{ac.last_four?` ···${ac.last_four}`:''}
                  </label>
                ))}
              </div>
            </div>}
            <div>
              <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Spender Filter <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional — for shared/employee-card accounts</span></label>
              <SearchCreateSelect value={v.spender_filter||''} options={spenders} placeholder="Anyone (no filter)"
                emptyLabel="Anyone (no filter)" onChange={val=>setV('spender_filter',val)}/>
              <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>
                {v.spender_filter?`Only counts spend tagged "${v.spender_filter}" toward this challenge's threshold.`:'Counts spend from anyone on the linked card(s) — the default.'}
              </div>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Notes</label>
              <input value={v.notes} onChange={e=>setV('notes',e.target.value)}
                style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
            </div>
            <label style={{fontSize:13,display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <input type="checkbox" checked={v.is_active} onChange={e=>setV('is_active',e.target.checked)}/> Active
            </label>
          </div>
          <div style={{padding:'12px 24px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)'}}>
            <button type="button" className="btn btn-ghost" onClick={()=>setShowChallengeModal(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={saveChallenge}>{editingChallenge?'Save Changes':'Create Challenge'}</button>
          </div>
        </div>
      </div>
    );
  })();

  const DeleteConfirm=confirmDeleteId&&(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="card" style={{width:360,padding:0}}>
        <div style={{padding:'20px 24px 16px',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:16,fontWeight:400}}>Delete Challenge?</div>
        </div>
        <div style={{padding:'20px 24px',fontSize:14,color:'var(--text-secondary)'}}>
          This will permanently delete the challenge and all its progress data.
        </div>
        <div style={{padding:'12px 24px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)'}}>
          <button type="button" className="btn btn-ghost" onClick={()=>setConfirmDeleteId(null)}>Cancel</button>
          <button type="button" className="btn btn-primary" style={{background:'var(--red)',borderColor:'var(--red)'}} onClick={doDelete}>Delete</button>
        </div>
      </div>
    </div>
  );

  const BenefitModal=showBenefitModal&&(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="card" style={{width:440,maxWidth:'94vw',padding:0}}>
        <div style={{padding:'18px 24px 14px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:16,fontWeight:400}}>{editingBenefitId?'Edit Benefit':'Add Benefit'}</div>
          <button type="button" onClick={()=>setShowBenefitModal(false)} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'var(--text-muted)'}}>×</button>
        </div>
        <div style={{padding:'18px 24px',display:'flex',flexDirection:'column',gap:12}}>
          {[
            {label:'Benefit Name *',key:'benefit_name',type:'text',placeholder:'e.g. Airline Credit'},
            {label:'Amount ($)',key:'amount',type:'number',placeholder:'0 for non-monetary perks'},
          ].map(({label,key,type,placeholder})=>(
            <div key={key}>
              <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>{label}</label>
              <input type={type} value={benefitForm[key]} onChange={e=>setBenefitForm(f=>({...f,[key]:e.target.value}))}
                placeholder={placeholder}
                style={{width:'100%',fontSize:13,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',boxSizing:'border-box'}}/>
            </div>
          ))}
          <div>
            <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Reset Frequency</label>
            <select value={benefitForm.reset_frequency} onChange={e=>setBenefitForm(f=>({...f,reset_frequency:e.target.value}))}
              style={{width:'100%',fontSize:13,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)'}}>
              <option value='annual'>Annual (Jan 1 – Dec 31)</option>
              <option value='calendar_year'>Calendar Year (same as annual)</option>
              <option value='semi-annual'>Semi-Annual (Jan–Jun / Jul–Dec)</option>
              <option value='quarterly'>Quarterly</option>
              <option value='monthly'>Monthly</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Tracking Type</label>
            <select value={benefitForm.tracking_type} onChange={e=>setBenefitForm(f=>({...f,tracking_type:e.target.value}))}
              style={{width:'100%',fontSize:13,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)'}}>
              <option value='periodic'>Periodic — use-it-or-lose-it each cycle (gets a usage tracker)</option>
              <option value='by_use'>By Use — doesn't expire on a cadence (e.g. Global Entry, per-stay credit)</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Trigger Category <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
            <select value={benefitForm.trigger_category} onChange={e=>setBenefitForm(f=>({...f,trigger_category:e.target.value}))}
              style={{width:'100%',fontSize:13,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)'}}>
              <option value=''>None — any spend / manual</option>
              {allCscs.map(c=><option key={c.name||c} value={c.name||c}>{c.name||c}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Notes <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
            <textarea value={benefitForm.notes} onChange={e=>setBenefitForm(f=>({...f,notes:e.target.value}))}
              rows={2} placeholder='e.g. Book via Amex Travel portal'
              style={{width:'100%',fontSize:13,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',resize:'vertical',boxSizing:'border-box'}}/>
          </div>
        </div>
        <div style={{padding:'12px 24px 18px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)'}}>
          <button type="button" className="btn btn-ghost" onClick={()=>setShowBenefitModal(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={saveBenefit} disabled={benefitSaving}>
            {benefitSaving?'Saving…':editingBenefitId?'Save Changes':'Add Benefit'}
          </button>
        </div>
      </div>
    </div>
  );

  const ChangeProductModal=showChangeProductModal&&(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="card" style={{width:440,maxWidth:'94vw',padding:0}}>
        <div style={{padding:'18px 24px 14px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:16,fontWeight:400}}>{p?'Change Card Product':'Link Card Product'}</div>
          <button type="button" onClick={()=>setShowChangeProductModal(false)} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'var(--text-muted)'}}>×</button>
        </div>
        <div style={{padding:'18px 24px',display:'flex',flexDirection:'column',gap:12}}>
          {p&&<div style={{fontSize:12.5,color:'var(--text-muted)'}}>
            Currently <strong style={{color:'var(--text-primary)'}}>{p.card_name}</strong>. Past transactions keep earning at {p.card_name}'s rates — only new spend (and the date below onward) uses the new product.
          </div>}
          <div>
            <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>New Product *</label>
            <select value={changeProductForm.product_id} onChange={e=>setChangeProductForm(f=>({...f,product_id:e.target.value}))}
              style={{width:'100%',fontSize:13,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)'}}>
              <option value=''>Select a product…</option>
              {[...allCardProducts].sort((a,b)=>(a.card_name||'').localeCompare(b.card_name||'')).map(cp=>(
                <option key={cp.id} value={cp.id}>{cp.card_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:500,display:'block',marginBottom:4}}>Effective Date</label>
            <input type='date' value={changeProductForm.effective_date}
              onChange={e=>setChangeProductForm(f=>({...f,effective_date:e.target.value}))}
              style={{width:'100%',fontSize:13,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',boxSizing:'border-box'}}/>
          </div>
        </div>
        <div style={{padding:'12px 24px 18px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)'}}>
          <button type="button" className="btn btn-ghost" onClick={()=>setShowChangeProductModal(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={saveChangeProduct} disabled={changingProduct}>
            {changingProduct?'Saving…':p?'Change Product':'Link Product'}
          </button>
        </div>
      </div>
    </div>
  );

  return(
    <div style={{width:'100%'}}>
      {ChallengeModal}
      {BenefitModal}
      {ChangeProductModal}
      {DeleteConfirm}
      {/* Hero */}
      <div style={{background:grad,borderRadius:16,padding:'28px 32px',color:'#fff',marginBottom:24,position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:0,right:0,bottom:0,width:'40%',opacity:0.07,background:'radial-gradient(circle at 70% 30%, #fff 0%, transparent 70%)'}}/>
        {/* Card artwork — floated in the bottom-right corner of the hero */}
        {cardImgSrc&&<img src={cardImgSrc} alt="" onError={e=>{e.target.style.display='none';}}
          style={{position:'absolute',bottom:16,right:24,height:90,borderRadius:6,boxShadow:'0 4px 20px rgba(0,0,0,0.35)',opacity:0.92,pointerEvents:'none'}}/>}
        <button type="button" onClick={onBack} style={{background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',color:'#fff',borderRadius:8,padding:'6px 14px',cursor:'pointer',fontSize:13,marginBottom:16,backdropFilter:'blur(4px)'}}>&#8592; Back</button>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:28,fontWeight:400,letterSpacing:'-0.5px',lineHeight:1.2}}>{displayName}</div>
            <div style={{fontSize:14,opacity:0.8,marginTop:4}}>{acct.name}{acct.mask?` \u00B7 \u00B7\u00B7\u00B7${acct.mask}`:''}</div>
            <div style={{display:'flex',gap:10,marginTop:14}}>
              {eco&&<span style={{background:'rgba(255,255,255,0.2)',borderRadius:6,padding:'3px 10px',fontSize:12,fontWeight:500,backdropFilter:'blur(4px)'}}>{eco.currency_name}</span>}
              {c&&c.network&&<span style={{background:'rgba(255,255,255,0.2)',borderRadius:6,padding:'3px 10px',fontSize:12,fontWeight:500,backdropFilter:'blur(4px)'}}>{c.network}</span>}
              {p&&<span style={{background:'rgba(255,255,255,0.2)',borderRadius:6,padding:'3px 10px',fontSize:12,fontWeight:500,backdropFilter:'blur(4px)'}}>{p.status}</span>}
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            {bal!=null&&<>
              <div style={{fontSize:11,opacity:0.7,textTransform:'uppercase',fontWeight:500}}>Current Balance</div>
              <div style={{fontSize:32,fontWeight:400,fontFamily:'Plus Jakarta Sans',letterSpacing:'-1px'}}>{bal<0?'-':''}${Math.abs(bal).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            </>}
          </div>
        </div>
        {utilPct!=null&&c&&c.credit_limit&&<div style={{marginTop:18}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,opacity:0.8,marginBottom:4}}>
            <span>Utilization</span>
            <span>{utilPct}% of ${c.credit_limit.toLocaleString()}</span>
          </div>
          <div style={{height:6,background:'rgba(255,255,255,0.2)',borderRadius:3,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${Math.min(utilPct,100)}%`,background:utilPct>80?'#ef4444':utilPct>50?'#f59e0b':'#22c55e',borderRadius:3,transition:'width 0.5s ease'}}/>
          </div>
        </div>}
      </div>

      {c&&<div className="card" style={{marginBottom:24,padding:'14px 20px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Card Product</div>
            <div style={{fontSize:15,fontWeight:400,marginTop:2}}>{p?p.card_name:'Not linked'}</div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {productHistory.length>1&&
              <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setShowHistory(s=>!s)}>{showHistory?'Hide History':'Product History'}</button>}
            <button type="button" className="btn btn-secondary btn-sm" onClick={openChangeProductModal}>{p?'Change Product':'Link Product'}</button>
          </div>
        </div>
        {showHistory&&productHistory.length>0&&<div style={{marginTop:12,borderTop:'1px solid var(--border)',paddingTop:10}}>
          {productHistory.map(h=>(
            <div key={h.id} style={{display:'flex',justifyContent:'space-between',fontSize:12.5,padding:'4px 0',color:h.is_current?'var(--text-primary)':'var(--text-muted)'}}>
              <span>{h.product_name||'(unknown product)'}</span>
              <span>{fmtDate(h.effective_from)} &ndash; {h.is_current?'present':fmtDate(h.effective_to)}</span>
            </div>
          ))}
        </div>}
      </div>}

      {!p&&<div className="card" style={{marginBottom:24,padding:20,border:'2px solid var(--amber)',background:'rgba(251,191,36,0.1)'}}>
        <div style={{fontSize:14,fontWeight:500,color:'var(--amber)',marginBottom:4}}>No Card Product Linked</div>
        <div style={{fontSize:13,color:'var(--amber)'}}>Link this account to a card product to see earning rates, benefits, and point valuations. Use the "Link Product" button above, or go back and use the product dropdown.</div>
      </div>}

      {(c||p)&&<div className="grid-4" style={{marginBottom:24}}>
        {/* Annual Fee — nets against 'Fees & Interest'-categorized credits for the
            current anniversary-anchored cycle (see _annual_fee_cycle_window in
            main.py), so it's not just displaying the sticker fee but answering
            "is this fee worth it." Clickable when there's fee-cycle activity to
            drill into; falls back to the plain sticker-fee display otherwise. */}
        {(()=>{
          const afs=d.annual_fee_summary;
          const hasActivity=afs&&(afs.fee_charged>0||afs.credits_received>0);
          return(
            <div className="card" onClick={hasActivity?filterTxnsToFeesInterest:undefined}
              title={hasActivity?`Click to view this cycle's Fees & Interest transactions (${fmtDate(afs.cycle_start)} – ${fmtDate(afs.cycle_end)})`:undefined}
              style={{padding:'14px 16px',textAlign:'center',cursor:hasActivity?'pointer':'default'}}>
              <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Annual Fee</div>
              {hasActivity?(
                <>
                  <div style={{fontSize:20,fontWeight:400,fontFamily:'Plus Jakarta Sans',marginTop:4,color:afs.net_cost>0?'var(--red)':'var(--green)'}}>
                    ${afs.net_cost.toFixed(0)} net
                  </div>
                  <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>
                    ${afs.fee_charged.toFixed(0)} fee &middot; ${afs.credits_received.toFixed(0)} credits
                  </div>
                </>
              ):(
                <div style={{fontSize:20,fontWeight:400,fontFamily:'Plus Jakarta Sans',marginTop:4,color:c&&c.annual_fee?'var(--red)':'var(--green)'}}>
                  {c&&c.annual_fee?`$${c.annual_fee}`:(p&&p.notes&&p.notes.includes('$')?p.notes.replace('Annual fee: ',''):'$0')}
                </div>
              )}
            </div>
          );
        })()}
        {[
          {label:'Credit Limit',value:c&&c.credit_limit?`$${c.credit_limit.toLocaleString()}`:'--'},
          {label:'Stmt Close',value:c&&c.statement_close_day?`Day ${c.statement_close_day}`:'--'},
          {label:'Payment Due',value:c&&c.payment_due_day?`Day ${c.payment_due_day}`:'--'},
        ].map((s,i)=>(
          <div key={i} className="card" style={{padding:'14px 16px',textAlign:'center'}}>
            <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>{s.label}</div>
            <div style={{fontSize:20,fontWeight:400,fontFamily:'Plus Jakarta Sans',marginTop:4,color:s.color||'var(--text-primary)'}}>{s.value}</div>
          </div>
        ))}
      </div>}

      {p&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:24}}>
        <div className="card" style={{padding:20}}>
          <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:14}}>
            <div style={{fontSize:15,fontWeight:500}}>Earning Structure</div>
            {eco&&<div style={{fontSize:11,color:'var(--text-muted)'}}>{eco.currency_name}{eco.is_cash_back?' · Cash Back':''}</div>}
          </div>
          <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',display:'grid',gridTemplateColumns:'1fr 50px',gap:'0 8px',paddingBottom:6,borderBottom:'1px solid var(--border)',marginBottom:2}}>
            <span>Category</span>
            <span style={{textAlign:'center'}}>Rate</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 50px',gap:'0 8px',padding:'7px 0',borderBottom:'1px solid var(--border)',background:'var(--elevated)'}}>
            <span style={{fontSize:12,fontWeight:500,paddingLeft:4}}>All Purchases (Base)</span>
            <span style={{textAlign:'center',fontSize:13,fontWeight:400,color:'var(--blue)',fontFamily:'Plus Jakarta Sans'}}>{d.base_rate}x</span>
          </div>
          <div style={{maxHeight:320,overflowY:'auto'}}>
            {(d.earning_structure||[]).filter(e=>e.bonus>0).map((e,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 50px',gap:'0 8px',padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                <span style={{fontSize:12,paddingLeft:4}}>{e.category}</span>
                <span style={{textAlign:'center',fontSize:13,fontWeight:400,color:'var(--green)',fontFamily:'Plus Jakarta Sans'}}>{e.total}x</span>
              </div>
            ))}
          </div>
        </div>

        {/* Earn Summary */}
        <div className="card" style={{padding:20}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
            <div style={{fontSize:15,fontWeight:500}}>Earn Summary 🏆</div>
            <div style={{display:'flex',gap:2,background:'var(--border)',borderRadius:6,padding:2}}>
              {['mtd','qtd','ytd'].map(p=>(
                <button type="button" key={p} onClick={()=>setSpendPeriod(p)}
                  style={{padding:'3px 10px',borderRadius:4,border:'none',cursor:'pointer',fontSize:11,fontWeight:spendPeriod===p?700:400,
                    background:spendPeriod===p?'var(--bg)':'transparent',
                    color:spendPeriod===p?'var(--text-primary)':'var(--text-muted)',
                    boxShadow:spendPeriod===p?'0 1px 2px rgba(0,0,0,0.08)':'none',textTransform:'uppercase'}}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:14,opacity:spendRefreshing?0.5:1,transition:'opacity 0.2s'}}>
            {spendPeriod==='mtd'?'Month to date':spendPeriod==='qtd'?'Quarter to date':'Year to date'} · points earned by category
          </div>
          {topCats.length===0
            ?<div style={{padding:30,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>No spending data yet.</div>
            :<div style={{display:'flex',flexDirection:'column',gap:8,opacity:spendRefreshing?0.5:1,transition:'opacity 0.2s'}}>
              {topCats.map((s,i)=>{
                const catLabel=s.category==='Other'?'General (Non-Category)':s.category;
                const pts=Math.round(s.points_earned);
                return(
                  <div key={i}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                      <span style={{fontWeight:500}}>{catLabel} <span style={{fontWeight:400,color:'var(--blue)'}}>{s.earn_rate}x</span></span>
                      <span style={{fontFamily:'Plus Jakarta Sans',fontWeight:500,color:'var(--green)'}}>{pts.toLocaleString()} pts</span>
                    </div>
                    <div style={{height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${(s.amount/maxSpend*100)}%`,background:'var(--blue)',borderRadius:3,transition:'width 0.4s ease'}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          }
          {/* Base points total */}
          {d.points_earned&&d.points_earned.total>0&&<div style={{marginTop:16,padding:'12px 14px',background:'rgba(52,211,153,0.1)',borderRadius:10,border:'1px solid rgba(52,211,153,0.3)',opacity:spendRefreshing?0.5:1,transition:'opacity 0.2s'}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--green)',textTransform:'uppercase'}}>
              Base {eco?.currency_name||'Points'} Earned · {spendPeriod.toUpperCase()}
            </div>
            <div style={{fontSize:24,fontWeight:400,fontFamily:'Plus Jakarta Sans',color:'var(--green)',marginTop:4}}>
              {Math.round(d.points_earned.total).toLocaleString()}
            </div>
          </div>}
          {/* Challenge bonus points */}
          {(d.challenge_points||[]).length>0&&<div style={{marginTop:12,padding:'12px 14px',background:'var(--violet-soft)',borderRadius:10,border:'1px solid var(--violet-border)',opacity:spendRefreshing?0.5:1,transition:'opacity 0.2s'}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--violet)',textTransform:'uppercase',marginBottom:8}}>
              ⚡ Bonus from Challenges
            </div>
            {d.challenge_points.map(ch=>{
              const earned=Math.round(ch.bonus_pts);
              const locked=['flat','statement_credit','benefit'].includes(ch.bonus_type)&&!ch.threshold_met;
              const isUsd=ch.bonus_currency==='usd';
              const isBenefit=ch.bonus_currency==='benefit';
              const handleDeleteChallenge=async(e)=>{
                e.stopPropagation();
                if(!window.confirm(`Delete challenge "${ch.name}"?`)) return;
                try{
                  await apiFetch(`/challenges/${ch.id}`,{method:'DELETE'});
                  toast('Challenge deleted','success');
                  load();
                }catch(err){toast('Delete failed: '+(err?.message||''),'error');}
              };
              const chFullName=ch.name&&ch.name.length>40?ch.name:ch.name;
              return(
                <div key={ch.id} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',fontSize:12,marginBottom:6,paddingBottom:6,borderBottom:'1px solid var(--violet-border)',gap:6}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:1}}>
                      <div style={{fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}} title={ch.name}>{ch.name}</div>
                      <button type="button" onClick={()=>openEdit(ch)} title="Edit"
                        style={{flexShrink:0,padding:'1px 5px',borderRadius:3,border:'1px solid var(--violet-border)',background:'none',color:'var(--violet)',fontSize:10,cursor:'pointer',lineHeight:1.4}}>✎</button>
                      <button type="button" onClick={handleDeleteChallenge} title="Delete"
                        style={{flexShrink:0,padding:'1px 5px',borderRadius:3,border:'1px solid rgba(248,113,113,0.3)',background:'none',color:'var(--red)',fontSize:10,cursor:'pointer',lineHeight:1.4}}>×</button>
                    </div>
                    {ch.category_names&&ch.category_names.length>0&&<div style={{fontSize:10,color:'var(--violet)',opacity:0.8}}>{ch.category_names.join(', ')}</div>}
                    {ch.spend_cap&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>
                      ${(ch.current_spend||0).toLocaleString(undefined,{maximumFractionDigits:0})} / ${ch.spend_cap.toLocaleString()} spent
                      {ch.progress_pct!=null&&<span style={{marginLeft:6,color:ch.progress_pct>=100?'#059669':'var(--text-muted)'}}>{ch.progress_pct}%</span>}
                    </div>}
                    {ch.spend_threshold&&!ch.spend_cap&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>
                      ${(ch.lap_spend??ch.current_spend??0).toLocaleString(undefined,{maximumFractionDigits:0})} / ${ch.spend_threshold.toLocaleString()} threshold
                      {ch.progress_pct!=null&&<span style={{marginLeft:6,color:ch.progress_pct>=100?'#059669':'var(--text-muted)'}}>{ch.progress_pct}%</span>}
                    </div>}
                    {locked&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>Threshold not yet met</div>}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0,marginLeft:4}}>
                    {isBenefit
                      ?<div style={{fontSize:11,color:ch.threshold_met?'var(--violet)':'var(--text-muted)'}}>{ch.threshold_met?'Unlocked!':locked?'Locked':'—'}</div>
                      :earned>0
                        ?<div style={{fontFamily:'Plus Jakarta Sans',fontWeight:400,color:'var(--violet)',fontSize:14}}>{isUsd?'+$':'+'}{earned.toLocaleString()}</div>
                        :<div style={{fontSize:11,color:'var(--text-muted)'}}>{locked?'Locked':'—'}</div>}
                    {ch.bonus_type==='per_dollar'&&<div style={{fontSize:10,color:'var(--violet)',opacity:0.7}}>+{ch.bonus_amount}x bonus</div>}
                    {ch.max_occurrences&&<div style={{fontSize:10,color:'var(--violet)',opacity:0.7}}>{ch.occurrences_earned||0} of {ch.max_occurrences}</div>}
                  </div>
                </div>
              );
            })}
            {d.challenge_pts_total>0&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginTop:4,paddingTop:4}}>
              <div style={{fontSize:11,color:'var(--violet)',fontWeight:500}}>Total Challenge Bonus</div>
              <div style={{fontSize:18,fontWeight:400,fontFamily:'Plus Jakarta Sans',color:'var(--violet)'}}>{Math.round(d.challenge_pts_total).toLocaleString()}</div>
            </div>}
            {d.challenge_credit_total>0&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginTop:4,paddingTop:4}}>
              <div style={{fontSize:11,color:'var(--violet)',fontWeight:500}}>Total Statement Credits</div>
              <div style={{fontSize:18,fontWeight:400,fontFamily:'Plus Jakarta Sans',color:'var(--violet)'}}>${d.challenge_credit_total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            </div>}
          </div>}
        </div>
      </div>}

      {/* Benefits & Credits — dollar-value credits and certificates only.
           Earn-rate bonuses (e.g. "5x Rotating") and items with no dollar value
           are excluded here; they belong in Spend Challenges instead. */}
      <div className="card" style={{padding:20,marginBottom:24}}>
        {(()=>{
          // Filter to actual dollar credits: must have a $1+ amount and must not
          // look like an earn-rate multiplier (e.g. "5x", "3x on Dining").
          const isCreditBenefit=b=>(b.amount||0)>=1&&!/^\d+(\.\d+)?x\b/i.test(b.benefit_name||'');
          const creditBenefits=cardBenefits.filter(isCreditBenefit);
          return(<>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <div>
            <div style={{fontSize:15,fontWeight:500}}>Benefits &amp; Credits</div>
            {creditBenefits.length>0&&(()=>{
              const totalAnnual=creditBenefits.reduce((s,b)=>s+annualValue(b),0);
              const totalUsed=creditBenefits.reduce((s,b)=>s+(b.amount_used||0),0);
              const totalRemaining=creditBenefits.reduce((s,b)=>s+(b.remaining>0?b.remaining:0),0);
              return<div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                ${totalAnnual.toLocaleString()} annual value · <span style={{color:'var(--green)',fontWeight:500}}>${totalUsed.toLocaleString(undefined,{maximumFractionDigits:0})} used</span> · ${totalRemaining.toLocaleString(undefined,{maximumFractionDigits:0})} remaining
              </div>;
            })()}
          </div>
          {d?.product?.id&&<button type="button" className="btn btn-ghost" style={{fontSize:12}}
            onClick={()=>{setEditingBenefitId(null);setBenefitForm({benefit_name:'',amount:'',reset_frequency:'annual',tracking_type:'periodic',trigger_category:'',notes:''});setShowBenefitModal(true);}}>
            + Add Benefit
          </button>}
        </div>
        {benefitsLoading
          ?<div style={{padding:20,textAlign:'center'}}><div className="spinner"/></div>
          :creditBenefits.length===0
            ?<div style={{padding:'12px 0',color:'var(--text-muted)',fontSize:13,textAlign:'center'}}>
                No benefits configured.{d?.product?.id&&<span> Click <strong>+ Add Benefit</strong> to add one.</span>}
              </div>
            :<div style={{display:'flex',flexDirection:'column',gap:10}}>
              {creditBenefits.map(b=>{
                const isLogging=logUsageFor===b.id;
                const fullyUsed=b.amount>0&&b.amount_used>=b.amount;
                const hasUsage=b.amount_used>0;
                const statusColor=fullyUsed?'#15803d':hasUsage?'#b45309':'var(--text-muted)';
                const statusIcon=fullyUsed?'✅':hasUsage?'🟡':'⬜';
                const freqLabel={annual:'/ year',calendar_year:'/ year','semi-annual':'/ half-year',quarterly:'/ quarter',monthly:'/ month'}[b.reset_frequency]||'/ year';
                return(
                  <div key={b.id} style={{border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px',background:fullyUsed?'rgba(52,211,153,0.06)':'var(--surface)'}}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                          <span style={{fontWeight:500,fontSize:14}}>{b.benefit_name}</span>
                          {b.amount>0&&<span style={{fontSize:13,fontFamily:'Plus Jakarta Sans',color:'var(--green)',fontWeight:400}}>${b.amount.toLocaleString()}</span>}
                          <span style={{fontSize:11,color:'var(--text-muted)'}}>{freqLabel}</span>
                          {b.trigger_category&&<span style={{fontSize:10,padding:'1px 6px',background:'var(--violet-soft)',color:'var(--violet)',borderRadius:4}}>{b.trigger_category}</span>}
                        </div>
                        {b.notes&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{b.notes}</div>}
                      </div>
                      <div style={{display:'flex',gap:4,flexShrink:0}}>
                        <button type="button" onClick={()=>{setEditingBenefitId(b.id);setBenefitForm({benefit_name:b.benefit_name,amount:String(b.amount),reset_frequency:b.reset_frequency,tracking_type:b.tracking_type||'periodic',trigger_category:b.trigger_category||'',notes:b.notes||''});setShowBenefitModal(true);}}
                          style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✎</button>
                        <button type="button" onClick={()=>deleteBenefit(b.id,b.benefit_name)}
                          style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid rgba(248,113,113,0.3)',background:'none',color:'var(--red)',cursor:'pointer'}}>×</button>
                      </div>
                    </div>
                    {b.amount>0&&b.cycles&&(()=>{
                      const cycleLabels=b.reset_frequency==='monthly'
                        ?['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                        :b.reset_frequency==='quarterly'?['Q1','Q2','Q3','Q4']:['H1','H2'];
                      const usedCount=b.cycles.filter(c=>c.used).length;
                      const isToggling=togglingCycle===`${b.id}`;
                      return(
                        <div style={{marginBottom:8}}>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:5}}>
                            <span style={{color:'var(--text-muted)',fontWeight:500}}>{usedCount} of {b.cycles.length} used this year</span>
                          </div>
                          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                            {b.cycles.map((cy,i)=>(
                              <button key={cy.cycle} type="button" disabled={isToggling}
                                onClick={()=>toggleBenefitCycle(b,cy)}
                                title={cy.used?`Used — click to un-mark`:`Click to mark used ($${b.amount})`}
                                style={{fontSize:10,fontWeight:500,padding:'4px 0',width:32,borderRadius:5,cursor:isToggling?'wait':'pointer',
                                  border:cy.used?'1px solid #16a34a':'1px solid var(--border)',
                                  background:cy.used?'rgba(52,211,153,0.15)':'var(--bg)',
                                  color:cy.used?'#15803d':'var(--text-muted)'}}>
                                {cy.used?'✓':cycleLabels[i]}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {b.amount>0&&!b.cycles&&(
                      <div style={{marginBottom:8}}>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                          <span style={{color:statusColor,fontWeight:500}}>{statusIcon} {hasUsage?`$${b.amount_used.toLocaleString(undefined,{maximumFractionDigits:0})} used`:'Unused'}</span>
                          {b.tracking_type!=='by_use'&&<span style={{color:'var(--text-muted)'}}>Resets {nextResetLabel(b.reset_frequency)}</span>}
                        </div>
                        <div style={{height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                          <div style={{height:'100%',width:`${Math.min(100,b.pct_used)}%`,background:fullyUsed?'#16a34a':'var(--blue-primary)',borderRadius:3,transition:'width 0.4s ease'}}/>
                        </div>
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2,textAlign:'right'}}>
                          {b.pct_used}% of ${b.amount.toLocaleString()} · {b.remaining>0?`$${b.remaining.toLocaleString(undefined,{maximumFractionDigits:0})} remaining`:'Fully used 🎉'}
                        </div>
                      </div>
                    )}
                    {!b.cycles&&(isLogging?(
                      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:4}}>
                        <span style={{fontSize:12,color:'var(--text-muted)'}}>$</span>
                        <input autoFocus type="number" min="0" step="0.01" value={logUsageAmt} onChange={e=>setLogUsageAmt(e.target.value)}
                          placeholder="Amount used" style={{fontSize:12,padding:'4px 8px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',width:110}}/>
                        <input type="text" value={logUsageNotes} onChange={e=>setLogUsageNotes(e.target.value)}
                          placeholder="Notes (optional)" style={{fontSize:12,padding:'4px 8px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',flex:1,minWidth:120}}/>
                        <button type="button" onClick={()=>logUsage(b.id,logUsageAmt,logUsageNotes)} disabled={benefitSaving}
                          style={{fontSize:12,padding:'4px 10px',borderRadius:5,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:500}}>
                          {benefitSaving?'…':'Save'}
                        </button>
                        <button type="button" onClick={()=>{setLogUsageFor(null);setLogUsageAmt('');setLogUsageNotes('');}}
                          style={{fontSize:12,padding:'4px 8px',borderRadius:5,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>Cancel</button>
                      </div>
                    ):(
                      <div style={{display:'flex',gap:6,marginTop:4}}>
                        <button type="button" onClick={()=>{setLogUsageFor(b.id);setLogUsageAmt(b.amount>0?String(b.amount_used||''):'');setLogUsageNotes('');}}
                          style={{fontSize:11,padding:'3px 10px',borderRadius:5,border:'1px solid var(--border)',background:'none',color:'var(--text-primary)',cursor:'pointer',fontWeight:500}}>
                          {hasUsage?'Update Usage':'Log Usage'}
                        </button>
                        {b.usage_id&&<button type="button" onClick={()=>clearUsage(b.usage_id,b.id)}
                          style={{fontSize:11,padding:'3px 10px',borderRadius:5,border:'1px solid rgba(248,113,113,0.3)',background:'none',color:'var(--red)',cursor:'pointer'}}>
                          Clear
                        </button>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
        }
          </>);
        })()}
      </div>

      {/* Spend Challenges */}
      {c&&<div className="card" style={{padding:20,marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div>
            <div style={{fontSize:15,fontWeight:500}}>Spend Challenges</div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>SUBs, rotating categories, annual thresholds</div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" style={{fontSize:12,padding:'5px 14px'}} onClick={openNew}>+ New</button>
        </div>
        {suggestions.length>0&&<div style={{marginBottom:16,padding:'12px 14px',background:'rgba(96,165,250,0.08)',borderRadius:10,border:'1px solid rgba(96,165,250,0.25)'}}>
          <div style={{fontSize:12,fontWeight:500,color:'var(--blue)',marginBottom:8}}>&#128161; Suggested for this card</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {suggestions.map((s,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:12}}>
                <div>
                  <span style={{fontWeight:500}}>{s.name}</span>
                  <span style={{color:'var(--text-muted)',marginLeft:8}}>{s.spend_threshold?`$${s.spend_threshold.toLocaleString()} spend \u2192`:''} {s.bonus_type==='flat'?`${s.bonus_amount?.toLocaleString()} pts`:`${s.bonus_amount}x/$`}</span>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" style={{fontSize:11,padding:'3px 12px'}} onClick={()=>openFromTemplate(s)}>Add</button>
              </div>
            ))}
          </div>
        </div>}
        {challengesLoading
          ?<div style={{padding:20,textAlign:'center'}}><div className="spinner"/></div>
          :challenges.length===0
            ?<div style={{padding:'20px 0',textAlign:'center',color:'var(--text-muted)',fontSize:13}}>No challenges yet. Click + New to add one.</div>
            :challenges.map(ch=>{
              const statusColor={upcoming:'var(--text-muted)',active:'var(--blue-primary)',unlocked:'var(--green)',expired:'var(--text-muted)'}[ch.status]||'var(--text-muted)';
              const barColor={upcoming:'var(--border)',active:'var(--blue-primary)',unlocked:'var(--green)',expired:'var(--border)'}[ch.status]||'var(--border)';
              const estVal=null; // valuation display removed per design decision
              return(
                <div key={ch.id} onClick={()=>filterTxnsToChallenge(ch)} title="Click to filter Transactions to this challenge's date range"
                  style={{padding:'14px 0',borderBottom:'1px solid var(--border)',opacity:ch.is_active?1:0.55,cursor:'pointer'}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontSize:14,fontWeight:400}}>{ch.name}</span>
                        <span style={{fontSize:11,padding:'2px 7px',borderRadius:10,background:barColor+'22',color:statusColor,fontWeight:500,textTransform:'uppercase'}}>{ch.status}</span>
                        <span style={{fontSize:11,padding:'2px 7px',borderRadius:10,background:'var(--border)',color:'var(--text-muted)'}}>{ch.challenge_type.replace(/_/g,' ')}</span>
                        {ch.max_occurrences&&<span style={{fontSize:11,padding:'2px 7px',borderRadius:10,background:'rgba(var(--blue-primary-rgb), 0.12)',color:'var(--blue-primary)',fontWeight:500}}>{ch.occurrences_earned||0} of {ch.max_occurrences} earned</span>}
                        {ch.spender_filter&&<span style={{fontSize:11,padding:'2px 7px',borderRadius:10,background:'var(--violet-soft)',color:'var(--violet)',fontWeight:500}}>{ch.spender_filter} only</span>}
                        {ch.category_names&&ch.category_names.length>0&&<span style={{fontSize:11,color:'var(--text-muted)'}}>&#183; {ch.category_names.join(', ')}</span>}
                      </div>
                      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                        {ch.start_date} &#8212; {ch.end_date}
                        {ch.activation_date&&<span style={{marginLeft:8,color:'var(--blue)'}}>activated {ch.activation_date}</span>}
                        {ch.additional_card_ids&&ch.additional_card_ids.length>0&&<span style={{marginLeft:8}}>+{ch.additional_card_ids.length} more card{ch.additional_card_ids.length>1?'s':''}</span>}
                      </div>
                    </div>
                    <div style={{display:'flex',gap:6,flexShrink:0,marginLeft:12}}>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={e=>{e.stopPropagation();openEdit(ch);}}>Edit</button>
                      <button type="button" className="btn btn-sm btn-ghost" style={{color:'var(--red)'}} onClick={e=>{e.stopPropagation();setConfirmDeleteId(ch.id);}}>Delete</button>
                    </div>
                  </div>
                  {ch.progress_target!=null&&<div style={{marginBottom:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                      <span style={{color:'var(--text-muted)'}}>Progress{ch.max_occurrences?` (lap ${Math.min((ch.occurrences_earned||0)+1,ch.max_occurrences)} of ${ch.max_occurrences})`:''}</span>
                      <span style={{fontWeight:500,fontFamily:'Plus Jakarta Sans'}}>${(ch.lap_spend??ch.current_spend).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} / ${ch.progress_target.toLocaleString()}</span>
                    </div>
                    <div style={{height:7,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${ch.progress_pct||0}%`,background:barColor,borderRadius:3,transition:'width 0.4s'}}/>
                    </div>
                    {ch.remaining_spend>0&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>${ch.remaining_spend.toLocaleString()} more to {ch.spend_cap?'hit cap':ch.max_occurrences?'unlock next':'unlock'}</div>}
                  </div>}
                  <div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:12}}>
                    <span>
                      <span style={{color:'var(--text-muted)'}}>Bonus: </span>
                      <span style={{fontWeight:400,color:ch.bonus_pts_earned>0?'#059669':'var(--text-muted)'}}>
                        {ch.bonus_currency==='benefit'
                          ?(ch.bonus_unlocked?'Unlocked!':ch.status==='unlocked'?'Unlocked!':'Not yet earned')
                          :ch.bonus_pts_earned>0?`${ch.bonus_currency==='usd'?'$':''}${ch.bonus_pts_earned.toLocaleString()}${ch.bonus_currency==='usd'?'':' '+(ch.currency||'pts')}`:ch.status==='unlocked'?'Unlocked!':'Not yet earned'}
                      </span>
                    </span>
                    {estVal&&parseFloat(estVal)>0&&<span>
                      <span style={{color:'var(--text-muted)'}}>Est. value: </span>
                      <span style={{fontWeight:500,color:'var(--green)'}}>${estVal}</span>
                    </span>}
                    <span>
                      <span style={{color:'var(--text-muted)'}}>Rate: </span>
                      <span style={{fontFamily:'Plus Jakarta Sans'}}>
                        {ch.bonus_type==='statement_credit'?`$${ch.bonus_amount?.toLocaleString()} credit flat`
                          :ch.bonus_type==='benefit'?`${ch.bonus_amount?.toLocaleString()} reward${ch.bonus_amount===1?'':'s'}`
                          :ch.bonus_type==='flat'?`${ch.bonus_amount?.toLocaleString()} pts flat`
                          :`${ch.bonus_amount}x per $`}
                        {ch.max_occurrences?`, up to ${ch.max_occurrences}x`:''}
                        {ch.spend_cap?` (up to $${ch.spend_cap.toLocaleString()})`:ch.spend_threshold?` after $${ch.spend_threshold.toLocaleString()}`:''}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })
        }
      </div>}

      {/* Recent Transactions */}
      <div className="card" style={{padding:20}} ref={txnSectionRef}>
        {/* Header row: title + Monthly/QTD/YTD/Custom toggle + period nav */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
          <div style={{fontSize:15,fontWeight:500}}>Transactions</div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            {/* Monthly / QTD / YTD / Custom toggle */}
            <div style={{display:'flex',gap:2,background:'var(--border)',borderRadius:6,padding:2}}>
              {[['monthly','Monthly'],['qtd','QTD'],['ytd','YTD'],['custom','Custom']].map(([v,label])=>(
                <button type="button" key={v} onClick={()=>{setTxnView(v);if(v!=='custom'){setChallengeFilterName(null);setCatFilter('');}}}
                  style={{padding:'3px 10px',borderRadius:4,border:'none',cursor:'pointer',fontSize:11,fontWeight:txnView===v?700:400,
                    background:txnView===v?'var(--bg)':'transparent',
                    color:txnView===v?'var(--text-primary)':'var(--text-muted)',
                    boxShadow:txnView===v?'0 1px 2px rgba(0,0,0,0.08)':'none'}}>
                  {label}
                </button>
              ))}
            </div>
            {/* Month nav */}
            {txnView==='monthly'&&<div style={{display:'flex',alignItems:'center',gap:4}}>
              <button type="button" onClick={prevTxnMonth} style={{background:'none',border:'1px solid var(--border)',borderRadius:4,padding:'2px 7px',cursor:'pointer',fontSize:13,color:'var(--text-muted)'}}>&#8249;</button>
              <span style={{fontSize:12,fontWeight:500,minWidth:72,textAlign:'center'}}>{txnMonthNames[txnMonth-1]} {txnYear}</span>
              <button type="button" onClick={nextTxnMonth} style={{background:'none',border:'1px solid var(--border)',borderRadius:4,padding:'2px 7px',cursor:'pointer',fontSize:13,color:'var(--text-muted)'}}>&#8250;</button>
            </div>}
            {/* Quarter nav */}
            {txnView==='qtd'&&<div style={{display:'flex',alignItems:'center',gap:4}}>
              <button type="button" onClick={prevTxnQuarter} style={{background:'none',border:'1px solid var(--border)',borderRadius:4,padding:'2px 7px',cursor:'pointer',fontSize:13,color:'var(--text-muted)'}}>&#8249;</button>
              <span style={{fontSize:12,fontWeight:500,minWidth:64,textAlign:'center'}}>Q{txnQuarter} {txnYear}</span>
              <button type="button" onClick={nextTxnQuarter} style={{background:'none',border:'1px solid var(--border)',borderRadius:4,padding:'2px 7px',cursor:'pointer',fontSize:13,color:'var(--text-muted)'}}>&#8250;</button>
            </div>}
            {/* Year nav */}
            {txnView==='ytd'&&<div style={{display:'flex',alignItems:'center',gap:4}}>
              <button type="button" onClick={()=>setTxnYear(y=>y-1)} style={{background:'none',border:'1px solid var(--border)',borderRadius:4,padding:'2px 7px',cursor:'pointer',fontSize:13,color:'var(--text-muted)'}}>&#8249;</button>
              <span style={{fontSize:12,fontWeight:500,minWidth:40,textAlign:'center'}}>{txnYear}</span>
              <button type="button" onClick={()=>setTxnYear(y=>Math.min(y+1,new Date().getFullYear()))} style={{background:'none',border:'1px solid var(--border)',borderRadius:4,padding:'2px 7px',cursor:'pointer',fontSize:13,color:'var(--text-muted)'}}>&#8250;</button>
            </div>}
            {/* Custom range */}
            {txnView==='custom'&&<div style={{display:'flex',alignItems:'center',gap:4}}>
              <input type="date" value={customStart} onChange={e=>{setChallengeFilterName(null);setCatFilter('');setCustomStart(e.target.value);}}
                style={{fontSize:12,padding:'3px 6px',borderRadius:4,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)'}}/>
              <span style={{fontSize:12,color:'var(--text-muted)'}}>&#8212;</span>
              <input type="date" value={customEnd} onChange={e=>{setChallengeFilterName(null);setCatFilter('');setCustomEnd(e.target.value);}}
                style={{fontSize:12,padding:'3px 6px',borderRadius:4,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)'}}/>
            </div>}
          </div>
        </div>
        {/* Custom-filter chip — set by clicking a challenge card or the Annual Fee tile */}
        {challengeFilterName&&txnView==='custom'&&(
          <div style={{marginBottom:10}}>
            <span style={{fontSize:11,padding:'3px 10px',borderRadius:12,background:'var(--violet-soft)',color:'var(--violet)',display:'inline-flex',alignItems:'center',gap:6}}>
              Filtered: {challengeFilterName}
              <button type="button" onClick={()=>{setChallengeFilterName(null);setCatFilter('');setTxnView('monthly');}}
                style={{background:'none',border:'none',cursor:'pointer',color:'inherit',fontSize:12,padding:0,lineHeight:1}}>&#10005;</button>
            </span>
          </div>
        )}
        {/* Filter row */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:500,textTransform:'uppercase',letterSpacing:'0.4px'}}>Filter:</span>
          <input value={descFilter} onChange={e=>setDescFilter(e.target.value)} placeholder="Search description…"
            style={{fontSize:12,padding:'3px 10px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',width:190,outline:'none'}}/>
          <select value={cscFilter} onChange={e=>setCscFilter(e.target.value)}
            style={{fontSize:12,padding:'3px 8px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',cursor:'pointer'}}>
            <option value=''>All categories</option>
            <option value='__none__'>⚠ No CSC assigned</option>
            {availCscs.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          {(cscFilter||descFilter)&&<button type="button" onClick={()=>{setCscFilter('');setDescFilter('');}}
            style={{fontSize:11,padding:'2px 8px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕ Clear all</button>}
        </div>
        {/* Points summary bar */}
        {txnSummary&&txnSummary.total_spend>0&&(
          <div style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap',padding:'8px 12px',background:'var(--border)',borderRadius:8,marginBottom:12,fontSize:12}}>
            <span><span style={{color:'var(--text-muted)'}}>Total spend: </span><strong>{fmt(txnSummary.total_spend)}</strong></span>
            <span><span style={{color:'var(--text-muted)'}}>Est. points: </span><strong style={{color:'var(--green)'}}>{(txnSummary.total_pts||0).toLocaleString()}</strong></span>
            {cscFilter&&cscFilter!=='__none__'&&txnSummary.by_csc[cscFilter]&&(
              <span style={{color:'var(--text-muted)',fontSize:11}}>{txnSummary.by_csc[cscFilter].count} txns</span>
            )}
            {cscFilter==='__none__'&&txnSummary.by_csc['__none__']&&(
              <span style={{color:'var(--amber)',fontSize:11}}>⚠ {txnSummary.by_csc['__none__'].count} txns with no CSC — {fmt(txnSummary.by_csc['__none__'].spend)} unoptimized</span>
            )}
          </div>
        )}
        {/* Teach-merchant prompt — shown after inline CSC save */}
        {teachPrompt&&(
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,
            padding:'10px 14px',marginBottom:10,background:'rgba(96,165,250,0.08)',border:'1px solid rgba(96,165,250,0.25)',borderRadius:8,fontSize:13}}>
            <span>📌 Apply <strong>{teachPrompt.csc}</strong> to all past &amp; future transactions from <strong>{teachPrompt.merchantName}</strong>?</span>
            <div style={{display:'flex',gap:6}}>
              <button type="button" onClick={()=>teachMerchant(teachPrompt.merchantName,teachPrompt.csc)} disabled={teachLoading}
                style={{padding:'4px 12px',borderRadius:5,border:'none',background:'var(--blue)',color:'#fff',fontSize:12,fontWeight:500,cursor:'pointer'}}>
                {teachLoading?'Saving…':'Yes, apply to all'}
              </button>
              <button type="button" onClick={()=>setTeachPrompt(null)}
                style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',fontSize:12,cursor:'pointer'}}>
                Just this one
              </button>
            </div>
          </div>
        )}
        {/* Grouped merchant view — shown when filter=__none__ */}
        {cscFilter==='__none__'&&(
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:500,color:'var(--amber)',marginBottom:8}}>
              🎓 Teach merchants — assign a CSC to fix all past &amp; future transactions at once
            </div>
            {unclassifiedLoading
              ?<div style={{padding:16,textAlign:'center'}}><div className="spinner"/></div>
              :unclassified.length===0
                ?<div style={{fontSize:12,color:'var(--text-muted)',padding:'8px 0'}}>No unclassified merchants for this account.</div>
                :<div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{borderBottom:'2px solid var(--border)'}}>
                        <th style={{padding:'5px 8px',textAlign:'left',color:'var(--text-muted)',fontWeight:500,textTransform:'uppercase',letterSpacing:'0.4px',fontSize:10}}>Merchant</th>
                        <th style={{padding:'5px 8px',textAlign:'right',color:'var(--text-muted)',fontWeight:500,textTransform:'uppercase',letterSpacing:'0.4px',fontSize:10}}>Spend</th>
                        <th style={{padding:'5px 8px',textAlign:'right',color:'var(--text-muted)',fontWeight:500,textTransform:'uppercase',letterSpacing:'0.4px',fontSize:10}}>Txns</th>
                        <th style={{padding:'5px 8px',textAlign:'left',color:'var(--text-muted)',fontWeight:500,textTransform:'uppercase',letterSpacing:'0.4px',fontSize:10}}>Assign CSC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unclassified.map(u=>(
                        <tr key={u.merchant} style={{borderBottom:'1px solid var(--border)'}}>
                          <td style={{padding:'6px 8px',fontWeight:500}}>{u.merchant}</td>
                          <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Plus Jakarta Sans',color:'var(--red)',fontWeight:500}}>{fmt(u.total_spend)}</td>
                          <td style={{padding:'6px 8px',textAlign:'right',color:'var(--text-muted)'}}>{u.count}</td>
                          <td style={{padding:'6px 8px'}}>
                            {assigningMerchant===u.merchant?(
                              <div style={{display:'flex',gap:4,alignItems:'center'}}>
                                <select autoFocus value={assignCscVal} onChange={e=>setAssignCscVal(e.target.value)}
                                  style={{fontSize:11,padding:'2px 5px',borderRadius:4,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)'}}>
                                  <option value=''>— select —</option>
                                  {allCscs.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
                                </select>
                                <button type="button" onClick={()=>assignCscVal&&assignMerchantCsc(u.merchant,assignCscVal)} disabled={!assignCscVal||assignLoading}
                                  style={{padding:'2px 8px',borderRadius:4,border:'none',background:'var(--green)',color:'#fff',fontSize:11,cursor:'pointer',fontWeight:500}}>
                                  {assignLoading?'…':'✓'}
                                </button>
                                <button type="button" onClick={()=>setAssigningMerchant(null)}
                                  style={{padding:'2px 7px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',fontSize:11,cursor:'pointer'}}>✕</button>
                              </div>
                            ):(
                              <button type="button" onClick={()=>{setAssigningMerchant(u.merchant);setAssignCscVal('');}}
                                style={{padding:'2px 10px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-primary)',fontSize:11,cursor:'pointer',fontWeight:500}}>
                                Assign →
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
            <div style={{borderTop:'1px solid var(--border)',marginTop:12,paddingTop:10,fontSize:11,color:'var(--text-muted)',fontStyle:'italic'}}>
              ↓ Individual unclassified transactions:
            </div>
          </div>
        )}
        {txnsLoading
          ?<div style={{padding:30,textAlign:'center'}}><div className="spinner"/></div>
          :txns.length===0
            ?<div style={{padding:20,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>No transactions for this period.</div>
            :<div style={{overflowX:'auto'}}>
              {selectedTxnIds.size>0&&(
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',marginBottom:8,background:'var(--violet-soft)',borderRadius:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,color:'var(--violet)',fontWeight:500}}>{selectedTxnIds.size} selected</span>
                  <span style={{fontSize:12,color:'var(--text-muted)'}}>Tag as:</span>
                  <div style={{width:160}}>
                    <SearchCreateSelect value='' options={spenders} placeholder="Who spent this?"
                      onChange={v=>bulkTagSpender(v)}/>
                  </div>
                  {bulkTagging&&<span style={{fontSize:12,color:'var(--text-muted)'}}>Saving…</span>}
                  <button type="button" onClick={()=>setSelectedTxnIds(new Set())}
                    style={{fontSize:11,padding:'3px 9px',borderRadius:5,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer',marginLeft:'auto'}}>
                    Clear selection
                  </button>
                </div>
              )}
              {displayTxns.length===0&&<div style={{padding:'10px 0 6px',fontSize:12,color:'var(--text-muted)',textAlign:'center'}}>No matches for "{descFilter}".</div>}
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  {(()=>{
                    const _th=(col,label,align='left',extra={})=>{
                      const active=sortCol===col;
                      return(
                        <th key={col} onClick={()=>handleSort(col)}
                          style={{padding:'6px 10px 8px',textAlign:align,fontSize:11,fontWeight:500,
                            color:active?'var(--text-primary)':'var(--text-muted)',
                            textTransform:'uppercase',letterSpacing:'0.4px',whiteSpace:'nowrap',
                            cursor:'pointer',userSelect:'none',...extra}}>
                          {label}{sortArrow(col)}
                        </th>
                      );
                    };
                    const allSelected=displayTxns.length>0&&displayTxns.every(t=>selectedTxnIds.has(t.id));
                    return(
                      <tr style={{borderBottom:'2px solid var(--border)'}}>
                        <th style={{padding:'6px 6px 8px',textAlign:'center'}}>
                          <input type="checkbox" checked={allSelected}
                            onChange={()=>setSelectedTxnIds(allSelected?new Set():new Set(displayTxns.map(t=>t.id)))}/>
                        </th>
                        {_th('date','Date')}
                        {_th('description','Description','left',{})}
                        {_th('csc','CSC')}
                        <th style={{padding:'6px 10px 8px',textAlign:'left',fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.4px',whiteSpace:'nowrap'}}>Spender</th>
                        <th style={{padding:'6px 10px 8px',textAlign:'left',fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.4px',whiteSpace:'nowrap'}}>Type</th>
                        {_th('amount','Amount','right')}
                        {_th('pts','Est. Pts','right')}
                        <th style={{padding:'6px 10px 8px',textAlign:'center',fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.4px',whiteSpace:'nowrap'}}>Exclude</th>
                      </tr>
                    );
                  })()}
                </thead>
                <tbody>
                  {displayTxns.map(t=>{
                    const mm=t.date.slice(5,7).replace(/^0/,'');
                    const dd=t.date.slice(8,10).replace(/^0/,'');
                    const isEditing=editingCscId===t.id;
                    const isEditingAction=editingActionId===t.id;
                    const ptsClass={earn:'var(--green)',clawback:'var(--red)',manual_override:'var(--amber)',excluded:'var(--text-muted)'}[t.points_earn_classification]||'var(--text-muted)';
                    const isEditingSpender=editingSpenderId===t.id;
                    return(
                      <tr key={t.id} className={t.is_excluded?'row-excluded':''}
                        style={{borderBottom:'1px solid var(--border)',background:!t.is_excluded&&!t.points_category&&t.amount<0?'rgba(234,179,8,0.04)':''}}>
                        <td style={{padding:'8px 6px',textAlign:'center'}}>
                          <input type="checkbox" checked={selectedTxnIds.has(t.id)} onChange={()=>toggleTxnSelected(t.id)}/>
                        </td>
                        <td style={{padding:'8px 10px',fontSize:12,color:'var(--text-muted)',fontFamily:'Plus Jakarta Sans',whiteSpace:'nowrap'}}>{mm}/{dd}</td>
                        <td style={{padding:'8px 10px',fontSize:13,maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.description}</td>
                        <td style={{padding:'8px 10px',minWidth:140}}>
                          {isEditing?(
                            <div style={{display:'flex',gap:4,alignItems:'center'}}>
                              <select autoFocus value={editingCscVal}
                                onChange={e=>setEditingCscVal(e.target.value)}
                                style={{fontSize:11,padding:'2px 5px',borderRadius:4,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',maxWidth:130}}>
                                <option value=''>— none —</option>
                                {allCscs.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
                              </select>
                              <button type="button" onClick={()=>saveCscEdit(t.id,editingCscVal)}
                                style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid rgba(16,185,129,0.4)',background:'var(--green)',color:'#fff',cursor:'pointer'}}>✓</button>
                              <button type="button" onClick={()=>setEditingCscId(null)}
                                style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
                            </div>
                          ):(
                            <div style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}
                              onClick={()=>{setEditingCscId(t.id);setEditingCscVal(t.points_category||'');}}>
                              {t.points_category
                                ?<span style={{fontSize:11,padding:'2px 7px',background:'rgba(52,211,153,0.15)',color:'var(--green)',borderRadius:4,whiteSpace:'nowrap'}}>{t.points_category}</span>
                                :<span style={{fontSize:11,padding:'2px 7px',background:'rgba(251,191,36,0.12)',color:'var(--amber)',borderRadius:4,whiteSpace:'nowrap',fontStyle:'italic'}}>⚠ unset</span>}
                              <span style={{fontSize:10,color:'var(--text-muted)',opacity:0.5}}>✏</span>
                            </div>
                          )}
                        </td>
                        <td style={{padding:'8px 10px',minWidth:110}}>
                          {isEditingSpender?(
                            <div style={{display:'flex',gap:4,alignItems:'flex-start',minWidth:120}}>
                              <div style={{flex:1}}>
                                <SearchCreateSelect autoFocus value={t.spender||''} options={spenders}
                                  placeholder="Who spent this?" emptyLabel="— unset —"
                                  onChange={v=>saveSpenderEdit(t.id,v)}/>
                              </div>
                              <button type="button" onClick={()=>setEditingSpenderId(null)}
                                style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
                            </div>
                          ):(
                            <div style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}
                              onClick={()=>setEditingSpenderId(t.id)}>
                              {t.spender
                                ?<span style={{fontSize:11,padding:'2px 7px',background:'var(--violet-soft)',color:'var(--violet)',borderRadius:4,whiteSpace:'nowrap'}}>{t.spender}</span>
                                :<span style={{fontSize:11,color:'var(--text-muted)',fontStyle:'italic'}}>— unset —</span>}
                              <span style={{fontSize:10,color:'var(--text-muted)',opacity:0.5}}>✏</span>
                            </div>
                          )}
                        </td>
                        <td style={{padding:'8px 10px',minWidth:110}}>
                          {isEditingAction?(
                            <div style={{display:'flex',gap:4,alignItems:'center'}}>
                              <select autoFocus value={editingActionVal}
                                onChange={e=>setEditingActionVal(e.target.value)}
                                style={{fontSize:11,padding:'2px 5px',borderRadius:4,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)',maxWidth:120}}>
                                {TXN_TYPES.map(a=><option key={a} value={a}>{a}</option>)}
                              </select>
                              <button type="button" onClick={()=>saveActionEdit(t.id,editingActionVal)}
                                style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid rgba(16,185,129,0.4)',background:'var(--green)',color:'#fff',cursor:'pointer'}}>✓</button>
                              <button type="button" onClick={()=>setEditingActionId(null)}
                                style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
                            </div>
                          ):(
                            <div style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}
                              onClick={()=>{setEditingActionId(t.id);setEditingActionVal(t.action||'Expense');}}>
                              <span className={`badge badge-${t.action==='Income'?'income':t.action==='Transfer'?'transfer':'expense'}`}>{t.action}</span>
                              <span style={{fontSize:10,color:'var(--text-muted)',opacity:0.5}}>✏</span>
                            </div>
                          )}
                        </td>
                        <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:500,color:t.amount<0?'var(--red)':'var(--green)',whiteSpace:'nowrap'}}>{t.amount<0?'-':'+'}{fmt(Math.abs(t.amount))}</td>
                        <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'Plus Jakarta Sans',fontSize:12,color:ptsClass,whiteSpace:'nowrap'}}>
                          {editingPtsOverrideId===t.id?(
                            <div style={{display:'flex',gap:4,alignItems:'center',justifyContent:'flex-end'}}>
                              <input type="number" step="1" autoFocus value={editingPtsOverrideVal}
                                onChange={e=>setEditingPtsOverrideVal(e.target.value)}
                                placeholder="Points" style={{width:70,fontSize:11,padding:'2px 5px',borderRadius:4,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text-primary)'}}/>
                              <button type="button" onClick={()=>savePtsOverride(t.id,editingPtsOverrideVal)}
                                style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid rgba(16,185,129,0.4)',background:'var(--green)',color:'#fff',cursor:'pointer'}}>✓</button>
                              <button type="button" onClick={()=>setEditingPtsOverrideId(null)}
                                style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
                              {t.points_earn_classification==='manual_override'&&
                                <button type="button" onClick={()=>resetPtsOverride(t.id)}
                                  style={{fontSize:10,padding:'2px 5px',borderRadius:4,border:'1px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>Reset</button>}
                            </div>
                          ):(
                            <span style={{cursor:'pointer'}}
                              onClick={()=>{setEditingPtsOverrideId(t.id);setEditingPtsOverrideVal(t.points_earn_classification==='manual_override'?String(t.points_earn):'');}}
                              title="Click to manually override this transaction's points">
                              {t.points_earn?`${t.points_earn>0?'':'−'}${Math.abs(t.points_earn).toLocaleString()}${t.earn_rate?` (${t.earn_rate}x)`:''}`:t.points_earn_classification==='excluded'?'excluded':'—'}
                              {' '}<span style={{fontSize:10,color:'var(--text-muted)',opacity:0.5}}>✏</span>
                            </span>
                          )}
                        </td>
                        <td style={{padding:'8px 10px',textAlign:'center'}}>
                          <button type="button" onClick={()=>toggleExcludeTxn(t)} disabled={excludingId===t.id}
                            title={t.is_excluded?'Include — resume earning points and SUB spend credit':'Exclude — zero points, no SUB spend credit'}
                            style={{fontSize:11,padding:'3px 9px',borderRadius:5,border:'1px solid '+(t.is_excluded?'var(--green)':'var(--border)'),
                              background:t.is_excluded?'rgba(52,211,153,0.1)':'none',color:t.is_excluded?'var(--green)':'var(--text-muted)',
                              cursor:excludingId===t.id?'default':'pointer',opacity:excludingId===t.id?0.5:1,fontWeight:500}}>
                            {excludingId===t.id?'…':t.is_excluded?'↩ Include':'⊘ Exclude'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        }
      </div>

      {/* Monthly Spending — moved to bottom as context/reference */}
      {(d.monthly_spend||[]).length>1&&<div className="card" style={{padding:20,marginBottom:24}}>
        <div style={{fontSize:15,fontWeight:500,marginBottom:12}}>Monthly Spending</div>
        <div style={{display:'flex',alignItems:'flex-end',gap:6,height:120}}>
          {(()=>{const mx=Math.max(...d.monthly_spend.map(m=>m.amount),1);return d.monthly_spend.map((m,i)=>(
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
              <span style={{fontSize:11,fontFamily:'Plus Jakarta Sans',color:'var(--text-muted)'}}>{fmt(m.amount)}</span>
              <div style={{width:'100%',maxWidth:60,height:`${(m.amount/mx*80)}px`,background:'var(--blue)',borderRadius:'4px 4px 0 0',minHeight:4,transition:'height 0.4s ease'}}/>
              <span style={{fontSize:10,color:'var(--text-muted)'}}>{m.month.slice(5)}/{m.month.slice(2,4)}</span>
            </div>
          ));})()}
        </div>
      </div>}
    </div>
  );
}
