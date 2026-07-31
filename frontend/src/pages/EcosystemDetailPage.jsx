import {useState,useEffect,useCallback,useMemo} from 'react';
import {ChallengeCard} from '../components/ChallengeCard';
import {SearchCreateSelect} from '../components/SearchCreateSelect';
import {apiFetch} from '../lib/api';
import {fmt} from '../lib/format';

export function EcosystemDetailPage({ecoId,ecoName,initPeriod,initYear,onBack,onSelectAccount,toast}){
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(true);
  const[period,setPeriod]=useState(initPeriod||'qtd');
  const[year,setYear]=useState(initYear||new Date().getFullYear());
  const years=useMemo(()=>{const y=new Date().getFullYear();return[y,y-1,y-2];},[]);
  const ecoColor=useMemo(()=>{
    const n=(ecoName||'').toLowerCase();
    if(n==='cash back')return'#d97706';
    if(n.includes('chase')||n.includes('ultimate'))return'#1a56db';
    if(n.includes('amex')||n.includes('membership'))return'#059669';
    if(n.includes('hilton'))return'#7c3aed';
    if(n.includes('citi'))return'#0891b2';
    if(n.includes('marriott')||n.includes('bonvoy'))return'#b45309';
    if(n.includes('delta')||n.includes('skymiles'))return'#1e40af';
    if(n.includes('hyatt'))return'#9f1239';
    if(n.includes('united')||n.includes('mileageplus'))return'#374151';
    if(n.includes('capital one'))return'#dc2626';
    if(n.includes('alaska'))return'#065f46';
    if(n.includes('southwest'))return'#b45309';
    if(n.includes('jetblue'))return'#0369a1';
    if(n.includes('discover'))return'#ea580c';
    if(n.includes('bilt'))return'#15803d';
    return'var(--blue)';
  },[ecoName]);

  const isCashBack=ecoId==='cash-back';
  const load=useCallback(async(p,y)=>{
    setLoading(true);
    try{
      const url=isCashBack
        ?`/ecosystems/cash-back/earn-detail?period=${p}&year=${y}`
        :`/ecosystems/${ecoId}/earn-detail?period=${p}&year=${y}`;
      setData(await apiFetch(url));
    }
    catch(e){toast('Failed to load ecosystem data','error');}
    finally{setLoading(false);}
  },[ecoId,isCashBack]);

  /* ── Balance snapshots — "Starting Balance" is the earliest one (editable,
       with its date); any later ones are "Corrections". The most recent one
       is still what current_balance anchors off of server-side (unchanged) —
       these are just two different labels over the same list, chronologically. */
  const emptyBalanceForm={balance:'',snapshot_date:'',notes:'',person:''};
  const[showBalanceModal,setShowBalanceModal]=useState(false);
  const[editingSnapshotId,setEditingSnapshotId]=useState(null);
  const[balanceForm,setBalanceForm]=useState(emptyBalanceForm);
  const[balanceSaving,setBalanceSaving]=useState(false);
  const[snapshots,setSnapshots]=useState([]);
  const loadSnapshots=()=>{
    if(isCashBack)return;
    apiFetch(`/ecosystems/${ecoId}/balance-snapshots`).then(setSnapshots).catch(()=>{});
  };
  useEffect(()=>{loadSnapshots();},[ecoId]);
  // People known for this ecosystem — Omer/Daniella baseline plus anyone
  // else already tagged somewhere in this ecosystem's ledger (server-computed
  // so it's the single source of truth for who has a bucket at all).
  const people=useMemo(()=>data?.known_people||['Omer','Daniella'],[data]);
  // Snapshots grouped by person (untagged/'' folds into 'Shared') — within
  // each group, sorted newest-first by the server, so the oldest (last in
  // the group) is that person's Starting Balance and the rest are Corrections.
  const snapsByPerson=useMemo(()=>{
    const groups={};
    for(const s of snapshots){
      const key=s.person||'Shared';
      (groups[key]=groups[key]||[]).push(s);
    }
    return groups;
  },[snapshots]);
  const startingSnapFor=person=>{
    const list=snapsByPerson[person]||[];
    return list.length?list[list.length-1]:null;
  };
  const correctionSnapsFor=person=>{
    const list=snapsByPerson[person]||[];
    return list.length>1?list.slice(0,-1):[];
  };
  const openBalanceModal=(snap,forPerson)=>{
    if(snap){
      setEditingSnapshotId(snap.id);
      setBalanceForm({balance:snap.balance,snapshot_date:snap.snapshot_date,notes:snap.notes||'',person:snap.person||''});
    }else{
      const today=new Date().toISOString().slice(0,10);
      setEditingSnapshotId(null);
      const bucket=forPerson&&forPerson!=='Shared'?data?.balance_by_person?.[forPerson]:null;
      setBalanceForm({balance:bucket?.current_balance??'',snapshot_date:today,notes:'',person:forPerson&&forPerson!=='Shared'?forPerson:''});
    }
    setShowBalanceModal(true);
  };
  const saveBalanceSnapshot=async()=>{
    if(balanceForm.balance===''||!balanceForm.snapshot_date){toast('Balance and date are required','error');return;}
    setBalanceSaving(true);
    try{
      const body={
        balance:parseFloat(balanceForm.balance),
        snapshot_date:balanceForm.snapshot_date,
        notes:balanceForm.notes||null,
        person:balanceForm.person||null,
      };
      if(editingSnapshotId) await apiFetch(`/balance-snapshots/${editingSnapshotId}`,{method:'PATCH',body:JSON.stringify(body)});
      else await apiFetch(`/ecosystems/${ecoId}/balance-snapshots`,{method:'POST',body:JSON.stringify(body)});
      setShowBalanceModal(false);
      load(period,year);
      loadSnapshots();
      toast(editingSnapshotId?'Balance entry updated':'Balance updated');
    }catch(e){toast('Save failed: '+(e?.message||''),'error');}
    finally{setBalanceSaving(false);}
  };
  const deleteBalanceSnapshot=async(id)=>{
    if(!window.confirm('Delete this balance entry?'))return;
    try{
      await apiFetch(`/balance-snapshots/${id}`,{method:'DELETE'});
      load(period,year);
      loadSnapshots();
      toast('Deleted');
    }catch(e){toast('Delete failed: '+(e?.message||''),'error');}
  };

  /* ── Redemptions ──────────────────────────────────────────────────────── */
  const[ecosystems,setEcosystems]=useState([]);
  useEffect(()=>{apiFetch('/ecosystems').then(setEcosystems).catch(()=>{});},[]);

  const emptyRedemptionForm={points_redeemed:'',redemption_date:'',description:'',cash_value_usd:'',notes:'',person:''};
  const[showRedemptionModal,setShowRedemptionModal]=useState(false);
  const[editingRedemptionId,setEditingRedemptionId]=useState(null);
  const[redemptionForm,setRedemptionForm]=useState(emptyRedemptionForm);
  const[redemptionSaving,setRedemptionSaving]=useState(false);

  const openNewRedemption=()=>{setEditingRedemptionId(null);setRedemptionForm(emptyRedemptionForm);setShowRedemptionModal(true);};
  const openEditRedemption=(r)=>{
    setEditingRedemptionId(r.id);
    setRedemptionForm({points_redeemed:r.points_redeemed,
      redemption_date:r.redemption_date,description:r.description,cash_value_usd:r.cash_value_usd,notes:r.notes||'',person:r.person||''});
    setShowRedemptionModal(true);
  };
  const saveRedemption=async()=>{
    if(!redemptionForm.description.trim()){toast('Description required','error');return;}
    if(!redemptionForm.points_redeemed||!redemptionForm.cash_value_usd||!redemptionForm.redemption_date){
      toast('Points redeemed, cash value, and redemption date are required','error');return;
    }
    setRedemptionSaving(true);
    try{
      const body={
        ecosystem_id:Number(ecoId),
        points_redeemed:parseFloat(redemptionForm.points_redeemed),
        redemption_date:redemptionForm.redemption_date,
        description:redemptionForm.description,
        person:redemptionForm.person||null,
        cash_value_usd:parseFloat(redemptionForm.cash_value_usd),
        notes:redemptionForm.notes||null,
      };
      if(editingRedemptionId) await apiFetch(`/redemptions/${editingRedemptionId}`,{method:'PATCH',body:JSON.stringify(body)});
      else await apiFetch('/redemptions',{method:'POST',body:JSON.stringify(body)});
      setShowRedemptionModal(false);
      load(period,year);
      toast(editingRedemptionId?'Redemption updated':'Redemption added');
    }catch(e){toast('Save failed: '+(e?.message||''),'error');}
    finally{setRedemptionSaving(false);}
  };

  /* ── Transfers (value-neutral point movement, separate from Redemptions) ── */
  const emptyTransferForm={direction:'out',otherEcosystemId:'',points_sent:'',base_ratio_used:'',bonus_pct:'',transfer_date:'',notes:'',person:'',to_person:''};
  const[showTransferModal,setShowTransferModal]=useState(false);
  const[editingTransferId,setEditingTransferId]=useState(null);
  const[transferForm,setTransferForm]=useState(emptyTransferForm);
  const[transferSaving,setTransferSaving]=useState(false);
  const[transferRatios,setTransferRatios]=useState([]);
  useEffect(()=>{apiFetch('/transfer-ratios').then(setTransferRatios).catch(()=>{});},[]);

  const currentRatioFor=(otherId,direction)=>{
    const sourceId=direction==='out'?Number(ecoId):Number(otherId);
    const destId=direction==='out'?Number(otherId):Number(ecoId);
    return transferRatios.find(r=>r.source_ecosystem_id===sourceId&&r.destination_ecosystem_id===destId);
  };
  const openNewTransfer=(direction)=>{
    setEditingTransferId(null);
    setTransferForm({...emptyTransferForm,direction});
    setShowTransferModal(true);
  };
  useEffect(()=>{
    if(!transferForm.otherEcosystemId||editingTransferId)return;
    const ratio=currentRatioFor(transferForm.otherEcosystemId,transferForm.direction);
    if(ratio)setTransferForm(f=>({...f,base_ratio_used:ratio.base_ratio}));
    // eslint-disable-next-line
  },[transferForm.otherEcosystemId,transferForm.direction]);
  const saveTransfer=async()=>{
    if(!transferForm.otherEcosystemId||!transferForm.points_sent||!transferForm.base_ratio_used||!transferForm.transfer_date){
      toast('Other ecosystem, points sent, ratio, and date are required','error');return;
    }
    setTransferSaving(true);
    try{
      const sourceId=transferForm.direction==='out'?Number(ecoId):Number(transferForm.otherEcosystemId);
      const destId=transferForm.direction==='out'?Number(transferForm.otherEcosystemId):Number(ecoId);
      const pointsSent=parseFloat(transferForm.points_sent);
      const ratio=parseFloat(transferForm.base_ratio_used);
      const bonusPct=transferForm.bonus_pct?parseFloat(transferForm.bonus_pct)/100:0;

      // If this ratio is new or differs from what's on file for the pair,
      // save it as the new standing ratio too — one step instead of a
      // separate settings screen.
      const existingRatio=currentRatioFor(transferForm.otherEcosystemId,transferForm.direction);
      if(!existingRatio||existingRatio.base_ratio!==ratio){
        await apiFetch('/transfer-ratios',{method:'POST',body:JSON.stringify({
          source_ecosystem_id:sourceId,destination_ecosystem_id:destId,
          base_ratio:ratio,effective_from:transferForm.transfer_date,
        })});
        apiFetch('/transfer-ratios').then(setTransferRatios).catch(()=>{});
      }

      const body={
        source_ecosystem_id:sourceId,
        destination_ecosystem_id:destId,
        points_sent:pointsSent,
        base_ratio_used:ratio,
        bonus_pct:bonusPct||null,
        points_received:pointsSent*ratio*(1+bonusPct),
        transfer_date:transferForm.transfer_date,
        notes:transferForm.notes||null,
        person:transferForm.person||null,
        to_person:transferForm.to_person||null,
      };
      if(editingTransferId) await apiFetch(`/transfers/${editingTransferId}`,{method:'PATCH',body:JSON.stringify(body)});
      else await apiFetch('/transfers',{method:'POST',body:JSON.stringify(body)});
      setShowTransferModal(false);
      load(period,year);
      toast(editingTransferId?'Transfer updated':'Transfer added');
    }catch(e){toast('Save failed: '+(e?.message||''),'error');}
    finally{setTransferSaving(false);}
  };
  const deleteTransfer=async(id)=>{
    if(!window.confirm('Delete this transfer?'))return;
    try{
      await apiFetch(`/transfers/${id}`,{method:'DELETE'});
      load(period,year);
      toast('Transfer deleted');
    }catch(e){toast('Delete failed: '+(e?.message||''),'error');}
  };
  const deleteRedemption=async(id)=>{
    if(!window.confirm('Delete this redemption?'))return;
    try{
      await apiFetch(`/redemptions/${id}`,{method:'DELETE'});
      load(period,year);
      toast('Redemption deleted');
    }catch(e){toast('Delete failed: '+(e?.message||''),'error');}
  };

  /* ── Adjustments — manual, dated +/- corrections for small unexplained
       drift, without erasing/resetting history the way a balance snapshot does ── */
  const emptyAdjustmentForm={points_delta:'',adjustment_date:'',description:'',notes:'',person:''};
  const[showAdjustmentModal,setShowAdjustmentModal]=useState(false);
  const[editingAdjustmentId,setEditingAdjustmentId]=useState(null);
  const[adjustmentForm,setAdjustmentForm]=useState(emptyAdjustmentForm);
  const[adjustmentSaving,setAdjustmentSaving]=useState(false);
  const openNewAdjustment=()=>{setEditingAdjustmentId(null);setAdjustmentForm(emptyAdjustmentForm);setShowAdjustmentModal(true);};
  const openEditAdjustment=(a)=>{
    setEditingAdjustmentId(a.id);
    setAdjustmentForm({points_delta:a.points_delta,adjustment_date:a.adjustment_date,description:a.description,notes:a.notes||'',person:a.person||''});
    setShowAdjustmentModal(true);
  };
  const saveAdjustment=async()=>{
    if(!adjustmentForm.description.trim()){toast('Description required','error');return;}
    if(adjustmentForm.points_delta===''||!adjustmentForm.adjustment_date){toast('Amount and date are required','error');return;}
    setAdjustmentSaving(true);
    try{
      const body={
        points_delta:parseFloat(adjustmentForm.points_delta),
        adjustment_date:adjustmentForm.adjustment_date,
        description:adjustmentForm.description,
        notes:adjustmentForm.notes||null,
        person:adjustmentForm.person||null,
      };
      if(editingAdjustmentId) await apiFetch(`/points-adjustments/${editingAdjustmentId}`,{method:'PATCH',body:JSON.stringify(body)});
      else await apiFetch(`/ecosystems/${ecoId}/points-adjustments`,{method:'POST',body:JSON.stringify(body)});
      setShowAdjustmentModal(false);
      load(period,year);
      toast(editingAdjustmentId?'Adjustment updated':'Adjustment added');
    }catch(e){toast('Save failed: '+(e?.message||''),'error');}
    finally{setAdjustmentSaving(false);}
  };
  const deleteAdjustment=async(id)=>{
    if(!window.confirm('Delete this adjustment?'))return;
    try{
      await apiFetch(`/points-adjustments/${id}`,{method:'DELETE'});
      load(period,year);
      toast('Adjustment deleted');
    }catch(e){toast('Delete failed: '+(e?.message||''),'error');}
  };

  /* ── Person-to-person transfers — same currency, same ecosystem, just
       moving which of our two buckets the points count against (e.g. Omer
       sends 20,000 Chase UR to Daniella). Distinct from the cross-currency
       Transfer above. ── */
  const emptyPersonTransferForm={from_person:'',to_person:'',points:'',transfer_date:'',notes:''};
  const[showPersonTransferModal,setShowPersonTransferModal]=useState(false);
  const[editingPersonTransferId,setEditingPersonTransferId]=useState(null);
  const[personTransferForm,setPersonTransferForm]=useState(emptyPersonTransferForm);
  const[personTransferSaving,setPersonTransferSaving]=useState(false);
  const openNewPersonTransfer=()=>{
    setEditingPersonTransferId(null);
    const today=new Date().toISOString().slice(0,10);
    setPersonTransferForm({...emptyPersonTransferForm,transfer_date:today,
      from_person:people[0]||'',to_person:people[1]||''});
    setShowPersonTransferModal(true);
  };
  const openEditPersonTransfer=(pt)=>{
    setEditingPersonTransferId(pt.id);
    setPersonTransferForm({from_person:pt.from_person,to_person:pt.to_person,points:pt.points,transfer_date:pt.transfer_date,notes:pt.notes||''});
    setShowPersonTransferModal(true);
  };
  const savePersonTransfer=async()=>{
    if(!personTransferForm.from_person||!personTransferForm.to_person){toast('Both people are required','error');return;}
    if(personTransferForm.from_person===personTransferForm.to_person){toast('From and To must be different people','error');return;}
    if(!personTransferForm.points||!personTransferForm.transfer_date){toast('Points and date are required','error');return;}
    setPersonTransferSaving(true);
    try{
      const body={
        from_person:personTransferForm.from_person,
        to_person:personTransferForm.to_person,
        points:parseFloat(personTransferForm.points),
        transfer_date:personTransferForm.transfer_date,
        notes:personTransferForm.notes||null,
      };
      if(editingPersonTransferId) await apiFetch(`/person-transfers/${editingPersonTransferId}`,{method:'PATCH',body:JSON.stringify(body)});
      else await apiFetch(`/ecosystems/${ecoId}/person-transfers`,{method:'POST',body:JSON.stringify(body)});
      setShowPersonTransferModal(false);
      load(period,year);
      toast(editingPersonTransferId?'Transfer updated':'Transfer added');
    }catch(e){toast('Save failed: '+(e?.message||''),'error');}
    finally{setPersonTransferSaving(false);}
  };
  const deletePersonTransfer=async(id)=>{
    if(!window.confirm('Delete this transfer?'))return;
    try{
      await apiFetch(`/person-transfers/${id}`,{method:'DELETE'});
      load(period,year);
      toast('Transfer deleted');
    }catch(e){toast('Delete failed: '+(e?.message||''),'error');}
  };

  useEffect(()=>{load(period,year);},[period,year]);

  const maxCatPts=useMemo(()=>data?.by_category?.[0]?.points||1,[data]);

  const ecoGradient=useMemo(()=>{
    const n=(ecoName||'').toLowerCase();
    if(n==='cash back')return'linear-gradient(135deg,#b45309,#d97706)';
    if(n.includes('chase')||n.includes('ultimate'))return'linear-gradient(135deg,#1e40af,var(--blue-primary))';
    if(n.includes('amex')||n.includes('membership'))return'linear-gradient(135deg,#047857,#10b981)';
    if(n.includes('hilton'))return'linear-gradient(135deg,#5b21b6,#8b5cf6)';
    if(n.includes('citi'))return'linear-gradient(135deg,#155e75,#06b6d4)';
    if(n.includes('marriott')||n.includes('bonvoy'))return'linear-gradient(135deg,#92400e,#d97706)';
    if(n.includes('delta')||n.includes('skymiles'))return'linear-gradient(135deg,#1e3a5f,var(--blue-primary))';
    if(n.includes('hyatt'))return'linear-gradient(135deg,#7f1d1d,#dc2626)';
    if(n.includes('united')||n.includes('mileageplus'))return'linear-gradient(135deg,#374151,#6b7280)';
    if(n.includes('capital one'))return'linear-gradient(135deg,#991b1b,#ef4444)';
    if(n.includes('alaska'))return'linear-gradient(135deg,#065f46,#34d399)';
    if(n.includes('southwest'))return'linear-gradient(135deg,#92400e,#f59e0b)';
    if(n.includes('jetblue'))return'linear-gradient(135deg,#0c4a6e,#38bdf8)';
    if(n.includes('discover'))return'linear-gradient(135deg,#9a3412,#fb923c)';
    if(n.includes('bilt'))return'linear-gradient(135deg,#14532d,#22c55e)';
    return'linear-gradient(135deg,var(--blue-primary),#60a5fa)';
  },[ecoName]);

  const ecoImg=useMemo(()=>{
    const n=(ecoName||'').toLowerCase();
    if(n.includes('chase')||n.includes('ultimate'))return'/static/ecosystems/chase_ur.png';
    if(n.includes('amex')||n.includes('membership'))return'/static/ecosystems/amex_mr.png';
    if(n.includes('hilton'))return'/static/ecosystems/hilton_honors.png';
    if(n.includes('citi'))return'/static/ecosystems/citi_thankyou.png';
    if(n.includes('marriott')||n.includes('bonvoy'))return'/static/ecosystems/marriott_bonvoy.png';
    if(n.includes('delta')||n.includes('skymiles'))return'/static/ecosystems/delta_skymiles.png';
    if(n.includes('hyatt'))return'/static/ecosystems/hyatt.png';
    if(n.includes('united')||n.includes('mileageplus'))return'/static/ecosystems/united_mileageplus.png';
    if(n.includes('capital one'))return'/static/ecosystems/capital_one_miles.png';
    if(n.includes('ihg'))return'/static/ecosystems/ihg_rewards.png';
    if(n.includes('aadvantage')||n.includes('aa '))return'/static/ecosystems/aa_aadvantage.png';
    if(n.includes('southwest'))return'/static/ecosystems/southwest_rr.png';
    if(n.includes('jetblue'))return'/static/ecosystems/jetblue_trueblue.png';
    if(n.includes('alaska'))return'/static/ecosystems/alaska_mileage_plan.png';
    if(n.includes('atmos'))return'/static/ecosystems/atmos_rewards.png';
    if(n.includes('discover'))return'/static/ecosystems/discover_cashback.png';
    return null;
  },[ecoName]);

  // Keys must match CardProduct.product_key exactly (e.g. 'chase_freedom_flex',
  // not 'freedom_flex') — a naming mismatch here silently drops both the
  // gradient AND the /static/cards/{key}.png lookup below to the default
  // gray fallback. Found and fixed 2026-07-24 while wiring in new card art:
  // most of these were short/unprefixed and never actually matched anything.
  const cardGrads={
    chase_freedom_flex:'linear-gradient(135deg,#0d9488,#115e59)',chase_sapphire_preferred:'linear-gradient(135deg,#1e3a5f,var(--blue-primary))',
    chase_sapphire_reserve:'linear-gradient(135deg,#0f172a,#1e3a5f)',chase_freedom_unlimited:'linear-gradient(135deg,#0ea5e9,#0369a1)',
    chase_freedom:'linear-gradient(135deg,#0369a1,#0ea5e9)',amex_gold:'linear-gradient(135deg,#b45309,#f59e0b)',
    amex_platinum:'linear-gradient(135deg,#78716c,#d6d3d1)',amex_blue_business_plus:'linear-gradient(135deg,#1e40af,#60a5fa)',
    hilton_aspire:'linear-gradient(135deg,#5b21b6,#a78bfa)',
    united_quest:'linear-gradient(135deg,#374151,#9ca3af)',united_explorer:'linear-gradient(135deg,#1f2937,#6b7280)',
    delta_gold:'linear-gradient(135deg,#92400e,#d97706)',citi_custom_cash:'linear-gradient(135deg,#155e75,#06b6d4)',
    citi_double_cash:'linear-gradient(135deg,#0e7490,#22d3ee)',citi_strata:'linear-gradient(135deg,#164e63,#0891b2)',
    citi_strata_premier:'linear-gradient(135deg,#0c4a6e,#0284c7)',citi_strata_elite:'linear-gradient(135deg,#1e1b4b,#4c1d95)',
    marriott_bonvoy_brilliant:'linear-gradient(135deg,#7f1d1d,#dc2626)',marriott_bonvoy_boundless:'linear-gradient(135deg,#78350f,#d97706)',
    hyatt_personal:'linear-gradient(135deg,#9f1239,#f43e5c)',us_bank_cash_plus:'linear-gradient(135deg,#1e3a5f,var(--blue-primary))',
    atmos_ascent:'linear-gradient(135deg,#065f46,#34d399)',capital_one_venture:'linear-gradient(135deg,#991b1b,#dc2626)',
    capital_one_venture_x:'linear-gradient(135deg,#450a0a,#7f1d1d)',
  };

  return(
    <div>
      {/* Back button */}
      <button type="button" onClick={onBack}
        style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:13,fontWeight:400,color:'var(--blue-primary)',
          cursor:'pointer',marginBottom:16,border:'none',background:'none',fontFamily:'Plus Jakarta Sans, sans-serif',
          padding:0,transition:'opacity 0.2s'}}
        onMouseEnter={e=>e.currentTarget.style.opacity='0.7'}
        onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
        ← Portfolio
      </button>

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:48,height:34,borderRadius:10,background:ecoGradient,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
            {ecoImg&&<img src={ecoImg} alt="" style={{width:30,height:30,objectFit:'contain',filter:'brightness(0) invert(1)',opacity:0.9}} onError={e=>{e.target.style.display='none'}}/>}
          </div>
          <div>
            <div style={{fontSize:20,fontWeight:400,color:'var(--text-primary)',letterSpacing:'-0.3px'}}>{ecoName}</div>
            {data&&!isCashBack&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:2,fontWeight:300}}>{data.currency_name}</div>}
            {data&&isCashBack&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:2,fontWeight:300}}>All cash-back cards</div>}
          </div>
        </div>
        {/* Period selector */}
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <div style={{display:'flex',gap:16}}>
            {['mtd','qtd','ytd'].map(p=>(
              <button type="button" key={p} onClick={()=>setPeriod(p)}
                style={{padding:'4px 0',border:'none',borderBottom:period===p?'2px solid var(--blue-primary)':'2px solid transparent',cursor:'pointer',fontSize:11,fontWeight:period===p?500:400,letterSpacing:'0.5px',
                  background:'transparent',color:period===p?'var(--blue-primary)':'var(--text-muted)',
                  transition:'all 0.15s',textTransform:'uppercase'}}>
                {p}
              </button>
            ))}
          </div>
          <select value={year} onChange={e=>setYear(Number(e.target.value))}
            style={{fontSize:11,fontWeight:400,border:'1px solid var(--border)',borderRadius:8,padding:'6px 12px',background:'var(--elevated)',color:'var(--text-primary)'}}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading?<div style={{padding:60,textAlign:'center'}}><div className="spinner"/></div>:data&&(
        <>
          {/* Hero stat */}
          <div style={{textAlign:'center',padding:'28px 24px 32px',marginBottom:20,borderRadius:14,
            background:'var(--surface)',border:'1px solid var(--border)',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:-40,right:-30,width:180,height:180,borderRadius:'50%',background:'var(--blue-primary)',opacity:0.06}}/>
            <div style={{position:'absolute',bottom:-30,left:-20,width:120,height:120,borderRadius:'50%',background:'var(--blue-primary)',opacity:0.06}}/>
            <div style={{fontSize:42,fontWeight:300,fontFamily:'Plus Jakarta Sans',color:isCashBack?'var(--green)':'var(--blue-primary)',lineHeight:1,letterSpacing:'-2px',position:'relative'}}>
              {isCashBack?`$${data.est_value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:data.total_points.toLocaleString()}
            </div>
            <div style={{fontSize:13,fontWeight:300,color:'var(--text-secondary)',marginTop:4,position:'relative'}}>{isCashBack?'Cash back earned':data.currency_name}</div>
          </div>

          {/* Balance Ledger — per-person (Omer/Daniella) balance tracking
              with a "Shared" column. "Shared" is ALWAYS a computed sum of
              every named person's bucket (plus any legacy untagged activity
              folded in transparently) — it is never its own independently-
              settable bucket, unlike Omer/Daniella below which each have
              their own Starting Balance. Each person's own earliest
              snapshot is their Starting Balance; Earned/Redeemed/
              Transferred/Adjusted/Sent-Received layer on top to their
              Current Balance. A "Sent to other"/"Received from other" pair
              nets to zero in the Shared column since it never creates or
              destroys points, just moves them between our two buckets. */}
          {!isCashBack&&data.balance_by_person&&<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Balance Ledger</div>
              {people.length>1&&<button type="button" className="btn btn-ghost btn-sm" onClick={openNewPersonTransfer}>+ Transfer between us</button>}
            </div>

            {(()=>{
              const b=data.balance_by_person;
              // Only named people get their own column — legacy untagged
              // ("Shared" in the API response) is never rendered as its own
              // column, only folded into the computed Shared-sum column below.
              const cols=[...people];
              const allBuckets=Object.keys(b);
              const fmt=v=>Math.round(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
              const rows=[
                {label:'+ Earned',get:p=>b[p].earned_since_baseline,color:'var(--green)'},
              ];
              // Points sit "pending" (earned but not yet posted to the
              // loyalty account — this app's rule: statement close day + 1)
              // until the day after the card's statement closes. Shown as a
              // subtraction from Earned so Current Balance reconciles to
              // posted-only; only surfaced when it's actually nonzero
              // somewhere, same convention as the Adjusted/Sent-Received
              // rows below.
              if(allBuckets.some(p=>(b[p].pending_since_baseline||0)!==0))
                rows.push({label:'− Pending (not yet posted)',get:p=>-(b[p].pending_since_baseline||0),color:'var(--amber)'});
              rows.push(
                {label:'− Redeemed',get:p=>-b[p].redeemed_since_baseline,color:'var(--red)'},
                {label:'− Transferred Out',get:p=>-b[p].transferred_out_since_baseline,color:'var(--red)'},
                {label:'+ Transferred In',get:p=>b[p].transferred_in_since_baseline,color:'var(--green)'},
              );
              if(allBuckets.some(p=>b[p].adjusted_since_baseline!==0))
                rows.push({label:'± Adjusted',get:p=>b[p].adjusted_since_baseline,color:null});
              if(allBuckets.some(p=>(b[p].person_transfer_out_since_baseline||0)!==0||(b[p].person_transfer_in_since_baseline||0)!==0)){
                rows.push({label:'− Sent to other',get:p=>-(b[p].person_transfer_out_since_baseline||0),color:'var(--red)'});
                rows.push({label:'+ Received from other',get:p=>(b[p].person_transfer_in_since_baseline||0),color:'var(--green)'});
              }
              const sharedFor=fn=>allBuckets.reduce((s,p)=>s+fn(p),0);
              return(
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
                    <thead>
                      <tr>
                        <th style={{textAlign:'left',padding:'0 8px 8px 0'}}></th>
                        {cols.map(p=><th key={p} style={{textAlign:'right',padding:'0 8px 8px',color:'var(--text-secondary)',fontWeight:500,minWidth:92,whiteSpace:'nowrap'}}>{p}</th>)}
                        <th style={{textAlign:'right',padding:'0 0 8px 8px',color:'var(--text-primary)',fontWeight:600,minWidth:92,whiteSpace:'nowrap'}}>Shared</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{padding:'8px 8px 8px 0',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)',fontWeight:400}}>Starting Balance</td>
                        {cols.map(p=>(
                          <td key={p} style={{textAlign:'right',padding:'8px',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)'}}>
                            <div style={{fontFamily:'Plus Jakarta Sans'}}>{fmt(b[p].starting_balance)}</div>
                            <div style={{fontSize:10,color:'var(--text-muted)'}}>{b[p].balance_as_of?`as of ${b[p].balance_as_of}`:'not set'}</div>
                          </td>
                        ))}
                        <td style={{textAlign:'right',padding:'8px 0 8px 8px',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)',fontFamily:'Plus Jakarta Sans',fontWeight:600}}>{fmt(sharedFor(p=>b[p].starting_balance))}</td>
                      </tr>
                      {rows.map(r=>(
                        <tr key={r.label}>
                          <td style={{padding:'5px 8px 5px 0',color:'var(--text-muted)'}}>{r.label}</td>
                          {cols.map(p=>{
                            const v=r.get(p);
                            const color=r.color||(v>=0?'var(--green)':'var(--red)');
                            return <td key={p} style={{textAlign:'right',padding:'5px 8px',fontFamily:'Plus Jakarta Sans',color}}>{fmt(v)}</td>;
                          })}
                          <td style={{textAlign:'right',padding:'5px 0 5px 8px',fontFamily:'Plus Jakarta Sans',color:'var(--text-muted)'}}>{fmt(sharedFor(r.get))}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{padding:'10px 8px 0 0',borderTop:'1px solid var(--border)',fontWeight:500}}>Current Balance</td>
                        {cols.map(p=>(
                          <td key={p} style={{textAlign:'right',padding:'10px 8px 0',borderTop:'1px solid var(--border)',fontFamily:'Plus Jakarta Sans',fontWeight:500,color:'var(--blue-primary)'}}>{fmt(b[p].current_balance)}</td>
                        ))}
                        <td style={{textAlign:'right',padding:'10px 0 0 8px',borderTop:'1px solid var(--border)',fontFamily:'Plus Jakarta Sans',fontWeight:700,color:'var(--blue-primary)',fontSize:14}}>{fmt(sharedFor(p=>b[p].current_balance))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Per-person balance management — set/edit each named person's
                own starting balance and later corrections independently.
                "Shared" has no management block here — it's always a
                computed sum (see the table above), never its own
                settable bucket. */}
            <div style={{marginTop:18,paddingTop:14,borderTop:'1px solid var(--border)',display:'flex',flexDirection:'column',gap:14}}>
              {people.map(person=>{
                const startSnap=startingSnapFor(person);
                const corrections=correctionSnapsFor(person);
                return(
                  <div key={person}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:6}}>
                      <div style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)'}}>{person}</div>
                      <div style={{display:'flex',gap:8}}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openBalanceModal(startSnap,person)}>{startSnap?'Edit Starting Balance':'Set Starting Balance'}</button>
                        {startSnap&&<button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deleteBalanceSnapshot(startSnap.id)}>Remove</button>}
                      </div>
                    </div>
                    {corrections.length>0&&<div style={{marginTop:6,paddingLeft:4}}>
                      {corrections.map(s=>(
                        <div key={s.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',fontSize:12}}>
                          <div style={{flex:1,minWidth:0,color:'var(--text-muted)'}}>
                            Correction: {s.balance.toLocaleString()} pts as of {s.snapshot_date}{s.notes?` — ${s.notes}`:''}
                          </div>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openBalanceModal(s,person)}>Edit</button>
                          <button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deleteBalanceSnapshot(s.id)}>Delete</button>
                        </div>
                      ))}
                    </div>}
                    {startSnap&&<button type="button" className="btn btn-ghost btn-sm" style={{marginTop:4}} onClick={()=>openBalanceModal(null,person)}>+ Add Correction</button>}
                  </div>
                );
              })}

              {/* Legacy untagged balance entries (person=NULL), from before
                  per-person tracking existed. Edit/delete only — no "Set
                  Starting Balance" or "+ Add Correction" affordance, since
                  new untagged entries can no longer be created; the Shared
                  column is now always a derived sum, never a bucket you set
                  directly. Only rendered at all if one already exists. */}
              {data.balance_by_person.Shared&&(()=>{
                const legacySnap=startingSnapFor('Shared');
                const legacyCorrections=correctionSnapsFor('Shared');
                if(!legacySnap&&legacyCorrections.length===0)return null;
                return(
                  <div>
                    <div style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)'}}>Unattributed (legacy)</div>
                    <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2,marginBottom:6}}>
                      Old entries with no person tag, folded into the Shared column above — edit or delete them here, or retag the underlying redemption/adjustment/transfer to Omer or Daniella.
                    </div>
                    {legacySnap&&<div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',fontSize:12}}>
                      <div style={{flex:1,minWidth:0,color:'var(--text-muted)'}}>
                        Starting balance: {legacySnap.balance.toLocaleString()} pts as of {legacySnap.snapshot_date}{legacySnap.notes?` — ${legacySnap.notes}`:''}
                      </div>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openBalanceModal(legacySnap,'Shared')}>Edit</button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deleteBalanceSnapshot(legacySnap.id)}>Delete</button>
                    </div>}
                    {legacyCorrections.map(s=>(
                      <div key={s.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',fontSize:12}}>
                        <div style={{flex:1,minWidth:0,color:'var(--text-muted)'}}>
                          Correction: {s.balance.toLocaleString()} pts as of {s.snapshot_date}{s.notes?` — ${s.notes}`:''}
                        </div>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openBalanceModal(s,'Shared')}>Edit</button>
                        <button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deleteBalanceSnapshot(s.id)}>Delete</button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Person-to-person transfer history */}
            {data.person_transfers&&data.person_transfers.length>0&&<div style={{marginTop:18,paddingTop:14,borderTop:'1px solid var(--border)'}}>
              <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:8}}>Transfers Between Us</div>
              {data.person_transfers.map(pt=>(
                <div key={pt.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0'}}>
                  <div style={{flex:1,minWidth:0,fontSize:12}}>
                    {pt.from_person} → {pt.to_person}: {pt.points.toLocaleString()} pts · {new Date(pt.transfer_date).toLocaleDateString()}
                    {pt.notes&&<span style={{color:'var(--text-muted)'}}> — {pt.notes}</span>}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openEditPersonTransfer(pt)}>Edit</button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deletePersonTransfer(pt.id)}>Delete</button>
                </div>
              ))}
            </div>}
          </div>}

          {/* Points by category */}
          {data.by_category.length>0&&<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:16}}>{isCashBack?'Cash Back by Category':'Points by Category'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {data.by_category.map(cat=>(
                <div key={cat.category} style={{display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontSize:13,fontWeight:300,color:'var(--text-primary)',width:90,flexShrink:0}}>{cat.category||'Other'}</span>
                  <div style={{flex:1,height:6,borderRadius:3,background:'var(--elevated)',overflow:'hidden'}}>
                    <div style={{height:'100%',borderRadius:3,width:`${Math.round(cat.points/maxCatPts*100)}%`,
                      background:'var(--accent-gradient)',transition:'width 0.4s ease'}}/>
                  </div>
                  <span style={{fontSize:12,fontWeight:400,color:'var(--text-primary)',width:60,textAlign:'right',flexShrink:0}}>{isCashBack?`$${(cat.points*0.01).toFixed(2)}`:cat.points.toLocaleString()}</span>
                  <span style={{fontSize:11,fontWeight:300,color:'var(--text-muted)',width:40,textAlign:'right',flexShrink:0}}>{cat.pct}%</span>
                </div>
              ))}
            </div>
          </div>}

          {/* Cards */}
          {data.by_card.length>0&&<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:12}}>Your Cards</div>
            <div>
              {data.by_card.map((c,i)=>{
                const pk=c.product_key||'';
                const grad=cardGrads[pk]||'linear-gradient(135deg,#374151,#6b7280)';
                return(
                  <div key={c.account_id}
                    style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',
                      borderBottom:i<data.by_card.length-1?'1px solid var(--border)':'none',
                      cursor:'pointer',transition:'all 0.15s'}}
                    onClick={()=>onSelectAccount(c.account_id)}
                    onMouseEnter={e=>{e.currentTarget.style.background='var(--surface-hover)';e.currentTarget.style.margin='0 -8px';e.currentTarget.style.padding='10px 8px';e.currentTarget.style.borderRadius='8px';}}
                    onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.margin='0';e.currentTarget.style.padding='10px 0';e.currentTarget.style.borderRadius='0';}}>
                    <div style={{width:40,height:26,borderRadius:6,background:grad,flexShrink:0,overflow:'hidden',position:'relative'}}>
                      <img src={`/static/cards/${pk}.png`} alt="" style={{width:'100%',height:'100%',objectFit:'cover',opacity:0.4}} onError={e=>{e.target.style.display='none'}}/>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:400,color:'var(--text-primary)'}}>{c.account_name}</div>
                      {c.mask&&<div style={{fontSize:11,fontWeight:300,color:'var(--text-muted)'}}>···{c.mask}</div>}
                    </div>
                    <span style={{fontSize:14,fontWeight:300,color:isCashBack?'var(--green)':'var(--blue-primary)',flexShrink:0}}>{isCashBack?`$${(c.points*0.01).toFixed(2)}`:c.points.toLocaleString()}</span>
                    <span style={{color:'var(--text-muted)',fontSize:14,marginLeft:4,opacity:0.4}}>›</span>
                  </div>
                );
              })}
            </div>
          </div>}

          {/* Active challenges */}
          {data.active_challenges.length>0&&<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:12}}>Active Challenges</div>
            <div className="grid-auto-sm">
              {data.active_challenges.map(ch=><ChallengeCard key={ch.id} ch={ch}/>)}
            </div>
          </div>}

          {/* Redemptions */}
          {!isCashBack&&<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Redemptions</div>
              <button type="button" className="btn btn-primary btn-sm" onClick={openNewRedemption}>+ Add Redemption</button>
            </div>
            {data.total_points_redeemed>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
              <div style={{padding:'12px 14px',background:'var(--elevated)',borderRadius:10}}>
                <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:4}}>Realized cpp</div>
                <div style={{fontSize:18,fontWeight:400,color:'var(--blue-primary)'}}>{data.realized_cpp.toFixed(2)}¢</div>
              </div>
              <div style={{padding:'12px 14px',background:'var(--elevated)',borderRadius:10}}>
                <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:4}}>Points Redeemed</div>
                <div style={{fontSize:18,fontWeight:400,color:'var(--text-primary)'}}>{data.total_points_redeemed.toLocaleString()}</div>
              </div>
              <div style={{padding:'12px 14px',background:'var(--elevated)',borderRadius:10}}>
                <div style={{fontSize:10,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:4}}>Cash Value Realized</div>
                <div style={{fontSize:18,fontWeight:400,color:'var(--text-primary)'}}>${data.total_cash_value_usd.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              </div>
            </div>}
            {data.redemptions.length===0?
              <div style={{fontSize:13,color:'var(--text-muted)',padding:'8px 0'}}>No redemptions logged for {ecoName} yet.</div>:
              <div>
                {data.redemptions.map((r,i)=>(
                  <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',
                    borderBottom:i<data.redemptions.length-1?'1px solid var(--border)':'none'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:400,color:'var(--text-primary)'}}>{r.description}</div>
                      <div style={{fontSize:11,fontWeight:300,color:'var(--text-muted)'}}>
                        {r.points_redeemed.toLocaleString()} pts · ${r.cash_value_usd.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} · {r.realized_cpp.toFixed(2)}¢/pt · {new Date(r.redemption_date).toLocaleDateString()}
                      </div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openEditRedemption(r)}>Edit</button>
                    <button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deleteRedemption(r.id)}>Delete</button>
                  </div>
                ))}
              </div>
            }
          </div>}

          {/* Transfers — value-neutral point movement, kept separate from Redemptions */}
          {!isCashBack&&<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Transfers</div>
              <div style={{display:'flex',gap:8}}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openNewTransfer('out')}>+ Transfer out</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={()=>openNewTransfer('in')}>+ Transfer in</button>
              </div>
            </div>
            {(data.transfers_out.length===0&&data.transfers_in.length===0)?
              <div style={{fontSize:13,color:'var(--text-muted)',padding:'8px 0'}}>No transfers logged for {ecoName} yet.</div>:
              <div>
                {data.transfers_out.map((t)=>(
                  <div key={`out-${t.id}`} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',
                    borderBottom:'1px solid var(--border)'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:400,color:'var(--text-primary)'}}>→ {t.destination_ecosystem_name}{t.person&&t.to_person&&t.person!==t.to_person?` (${t.person} → ${t.to_person})`:t.person?` (${t.person})`:''}</div>
                      <div style={{fontSize:11,fontWeight:300,color:'var(--text-muted)'}}>
                        {t.points_sent.toLocaleString()} sent · {t.points_received.toLocaleString()} received · ratio {t.base_ratio_used}{t.bonus_pct?` +${(t.bonus_pct*100).toFixed(0)}% bonus`:''} · {new Date(t.transfer_date).toLocaleDateString()}
                      </div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deleteTransfer(t.id)}>Delete</button>
                  </div>
                ))}
                {data.transfers_in.map((t)=>(
                  <div key={`in-${t.id}`} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',
                    borderBottom:'1px solid var(--border)'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:400,color:'var(--text-primary)'}}>← {t.source_ecosystem_name}{t.person&&t.to_person&&t.person!==t.to_person?` (${t.person} → ${t.to_person})`:t.to_person?` (${t.to_person})`:''}</div>
                      <div style={{fontSize:11,fontWeight:300,color:'var(--text-muted)'}}>
                        {t.points_sent.toLocaleString()} sent · {t.points_received.toLocaleString()} received · ratio {t.base_ratio_used}{t.bonus_pct?` +${(t.bonus_pct*100).toFixed(0)}% bonus`:''} · {new Date(t.transfer_date).toLocaleDateString()}
                      </div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deleteTransfer(t.id)}>Delete</button>
                  </div>
                ))}
              </div>
            }
          </div>}

          {/* Adjustments — manual +/- corrections, separate from Redemptions/
              Transfers (which represent real events) and from a balance
              snapshot (which resets the baseline). For small drift you don't
              want to spend time tracing to a specific cause. */}
          {!isCashBack&&<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Adjustments</div>
              <button type="button" className="btn btn-primary btn-sm" onClick={openNewAdjustment}>+ Add Adjustment</button>
            </div>
            {data.adjustments.length===0?
              <div style={{fontSize:13,color:'var(--text-muted)',padding:'8px 0'}}>No adjustments logged for {ecoName} yet.</div>:
              <div>
                {data.adjustments.map((a,i)=>(
                  <div key={a.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',
                    borderBottom:i<data.adjustments.length-1?'1px solid var(--border)':'none'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:400,color:'var(--text-primary)'}}>{a.description}</div>
                      <div style={{fontSize:11,fontWeight:300,color:'var(--text-muted)'}}>
                        {new Date(a.adjustment_date).toLocaleDateString()}{a.notes?` · ${a.notes}`:''}
                      </div>
                    </div>
                    <div style={{fontSize:14,fontFamily:'Plus Jakarta Sans',color:a.points_delta>=0?'var(--green)':'var(--red)'}}>
                      {a.points_delta>=0?'+':''}{a.points_delta.toLocaleString()}
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openEditAdjustment(a)}>Edit</button>
                    <button type="button" className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>deleteAdjustment(a.id)}>Delete</button>
                  </div>
                ))}
              </div>
            }
          </div>}
        </>
      )}

      {showRedemptionModal&&(
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth:440}}>
            <div className="modal-header">
              <div className="modal-title">{editingRedemptionId?'Edit Redemption':'Add Redemption'} — {ecoName}</div>
              <button type="button" className="modal-close" onClick={()=>setShowRedemptionModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12,maxHeight:'60vh',overflowY:'auto'}}>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Description</label>
                <input className="search-input" value={redemptionForm.description} onChange={e=>setRedemptionForm(f=>({...f,description:e.target.value}))}
                  placeholder="2 nights Conrad Maldives"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Points Redeemed</label>
                  <input className="search-input" type="number" value={redemptionForm.points_redeemed} onChange={e=>setRedemptionForm(f=>({...f,points_redeemed:e.target.value}))}
                    placeholder="250000"/>
                </div>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Cash Value Received ($)</label>
                  <input className="search-input" type="number" value={redemptionForm.cash_value_usd} onChange={e=>setRedemptionForm(f=>({...f,cash_value_usd:e.target.value}))}
                    placeholder="1800.00"/>
                </div>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Redemption Date</label>
                <input className="date-input" type="date" style={{width:'100%'}} value={redemptionForm.redemption_date} onChange={e=>setRedemptionForm(f=>({...f,redemption_date:e.target.value}))}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Whose points <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <SearchCreateSelect value={redemptionForm.person} options={people} placeholder="Unattributed"
                  emptyLabel="Unattributed" onChange={v=>setRedemptionForm(f=>({...f,person:v}))}/>
              </div>
              {(()=>{
                const wanted=parseFloat(redemptionForm.points_redeemed)||0;
                if(!wanted)return null;
                const available=redemptionForm.person
                  ?(data.balance_by_person?.[redemptionForm.person]?.current_balance)
                  :data.current_balance;
                if(available==null||wanted<=available)return null;
                const gap=Math.round(wanted-available);
                return(
                  <div style={{fontSize:12,color:'var(--amber)',background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.3)',borderRadius:8,padding:'8px 12px'}}>
                    ⚠ This exceeds {redemptionForm.person||'the'} posted balance ({available.toLocaleString()} pts) by {gap.toLocaleString()} pts — some points may still be pending, or you may need to buy points to cover the gap. This won't block saving.
                  </div>
                );
              })()}
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Notes <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <textarea className="search-input" value={redemptionForm.notes} onChange={e=>setRedemptionForm(f=>({...f,notes:e.target.value}))}
                  rows={2} style={{resize:'vertical'}}/>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={()=>setShowRedemptionModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveRedemption} disabled={redemptionSaving}>
                {redemptionSaving?'Saving…':editingRedemptionId?'Save Changes':'Add Redemption'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransferModal&&(
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth:440}}>
            <div className="modal-header">
              <div className="modal-title">{transferForm.direction==='out'?`Transfer out of ${ecoName}`:`Transfer into ${ecoName}`}</div>
              <button type="button" className="modal-close" onClick={()=>setShowTransferModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12,maxHeight:'60vh',overflowY:'auto'}}>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>{transferForm.direction==='out'?'Transfer to':'Transfer from'}</label>
                <select className="filter-select" style={{width:'100%'}} value={transferForm.otherEcosystemId} onChange={e=>setTransferForm(f=>({...f,otherEcosystemId:e.target.value}))}>
                  <option value="">— select —</option>
                  {ecosystems.filter(e=>String(e.id)!==String(ecoId)).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Points Sent</label>
                  <input className="search-input" type="number" value={transferForm.points_sent} onChange={e=>setTransferForm(f=>({...f,points_sent:e.target.value}))}
                    placeholder="100000"/>
                </div>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Ratio (received per 1 sent)</label>
                  <input className="search-input" type="number" step="0.01" value={transferForm.base_ratio_used} onChange={e=>setTransferForm(f=>({...f,base_ratio_used:e.target.value}))}
                    placeholder="e.g. 2.0"/>
                  <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Pre-filled from the current ratio on file — override for this transfer if needed.</div>
                </div>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Transfer Bonus % <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <input className="search-input" type="number" step="1" value={transferForm.bonus_pct} onChange={e=>setTransferForm(f=>({...f,bonus_pct:e.target.value}))}
                  placeholder="e.g. 40 for a 40% promo bonus"/>
              </div>
              {transferForm.points_sent&&transferForm.base_ratio_used&&
                <div style={{fontSize:12,color:'var(--text-secondary)',background:'var(--elevated)',borderRadius:8,padding:'8px 12px'}}>
                  Points received: <b>{Math.round(parseFloat(transferForm.points_sent)*parseFloat(transferForm.base_ratio_used)*(1+(transferForm.bonus_pct?parseFloat(transferForm.bonus_pct)/100:0))).toLocaleString()}</b>
                </div>
              }
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Transfer Date</label>
                <input className="date-input" type="date" style={{width:'100%'}} value={transferForm.transfer_date} onChange={e=>setTransferForm(f=>({...f,transfer_date:e.target.value}))}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Whose points — sending <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                  <SearchCreateSelect value={transferForm.person} options={people} placeholder="Unattributed"
                    emptyLabel="Unattributed" onChange={v=>setTransferForm(f=>({...f,person:v}))}/>
                </div>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Whose points — receiving <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                  <SearchCreateSelect value={transferForm.to_person} options={people} placeholder="Same as sending"
                    emptyLabel="Same as sending" onChange={v=>setTransferForm(f=>({...f,to_person:v}))}/>
                </div>
              </div>
              {transferForm.person&&transferForm.to_person&&transferForm.person!==transferForm.to_person&&
                <div style={{fontSize:11,color:'var(--text-muted)'}}>Cross-person transfer: {transferForm.person} → {transferForm.to_person}.</div>
              }
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Notes <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <textarea className="search-input" value={transferForm.notes} onChange={e=>setTransferForm(f=>({...f,notes:e.target.value}))}
                  rows={2} style={{resize:'vertical'}}/>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={()=>setShowTransferModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveTransfer} disabled={transferSaving}>
                {transferSaving?'Saving…':'Add Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBalanceModal&&(
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth:400}}>
            <div className="modal-header">
              <div className="modal-title">{editingSnapshotId?'Edit':balanceForm.person?`Set Starting Balance — ${balanceForm.person}`:'Set Starting Balance'} — {ecoName}</div>
              <button type="button" className="modal-close" onClick={()=>setShowBalanceModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{fontSize:12,color:'var(--text-muted)'}}>
                Enter the balance shown in your {ecoName} account as of the date below. Everything before this date is
                assumed folded into this number — earn/redeem/transfer/adjustment activity after it is added on top.
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Whose balance <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <SearchCreateSelect value={balanceForm.person} options={people} placeholder="Unattributed"
                  emptyLabel="Unattributed" onChange={v=>setBalanceForm(f=>({...f,person:v}))}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Balance</label>
                <input className="search-input" type="number" value={balanceForm.balance} onChange={e=>setBalanceForm(f=>({...f,balance:e.target.value}))}
                  placeholder="40320"/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>As of</label>
                <input className="date-input" type="date" style={{width:'100%'}} value={balanceForm.snapshot_date} onChange={e=>setBalanceForm(f=>({...f,snapshot_date:e.target.value}))}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Notes <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <textarea className="search-input" value={balanceForm.notes} onChange={e=>setBalanceForm(f=>({...f,notes:e.target.value}))}
                  rows={2} style={{resize:'vertical'}}/>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={()=>setShowBalanceModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveBalanceSnapshot} disabled={balanceSaving}>
                {balanceSaving?'Saving…':editingSnapshotId?'Save Changes':'Save Balance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdjustmentModal&&(
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth:400}}>
            <div className="modal-header">
              <div className="modal-title">{editingAdjustmentId?'Edit Adjustment':'Add Adjustment'} — {ecoName}</div>
              <button type="button" className="modal-close" onClick={()=>setShowAdjustmentModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{fontSize:12,color:'var(--text-muted)'}}>
                A manual +/- nudge to the running balance — for small drift you don't want to spend time tracing
                to a specific transaction, transfer, or redemption. Positive adds points, negative removes them.
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Description</label>
                <input className="search-input" value={adjustmentForm.description} onChange={e=>setAdjustmentForm(f=>({...f,description:e.target.value}))}
                  placeholder="Unexplained drift vs. Amex app"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Points (+/-)</label>
                  <input className="search-input" type="number" value={adjustmentForm.points_delta} onChange={e=>setAdjustmentForm(f=>({...f,points_delta:e.target.value}))}
                    placeholder="-230"/>
                </div>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Date</label>
                  <input className="date-input" type="date" style={{width:'100%'}} value={adjustmentForm.adjustment_date} onChange={e=>setAdjustmentForm(f=>({...f,adjustment_date:e.target.value}))}/>
                </div>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Whose points <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <SearchCreateSelect value={adjustmentForm.person} options={people} placeholder="Unattributed"
                  emptyLabel="Unattributed" onChange={v=>setAdjustmentForm(f=>({...f,person:v}))}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Notes <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <textarea className="search-input" value={adjustmentForm.notes} onChange={e=>setAdjustmentForm(f=>({...f,notes:e.target.value}))}
                  rows={2} style={{resize:'vertical'}}/>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={()=>setShowAdjustmentModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveAdjustment} disabled={adjustmentSaving}>
                {adjustmentSaving?'Saving…':editingAdjustmentId?'Save Changes':'Add Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPersonTransferModal&&(
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth:400}}>
            <div className="modal-header">
              <div className="modal-title">{editingPersonTransferId?'Edit Transfer Between Us':'Transfer Between Us'} — {ecoName}</div>
              <button type="button" className="modal-close" onClick={()=>setShowPersonTransferModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{fontSize:12,color:'var(--text-muted)'}}>
                Moves points from one person's {ecoName} balance to the other's — no ratio or bonus, since it's the
                same currency. Whether {ecoName} actually allows this between accounts is on you to confirm.
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>From</label>
                  <SearchCreateSelect value={personTransferForm.from_person} options={people} placeholder="Who's sending"
                    onChange={v=>setPersonTransferForm(f=>({...f,from_person:v}))}/>
                </div>
                <div>
                  <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>To</label>
                  <SearchCreateSelect value={personTransferForm.to_person} options={people} placeholder="Who's receiving"
                    onChange={v=>setPersonTransferForm(f=>({...f,to_person:v}))}/>
                </div>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Points</label>
                <input className="search-input" type="number" value={personTransferForm.points} onChange={e=>setPersonTransferForm(f=>({...f,points:e.target.value}))}
                  placeholder="20000"/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Date</label>
                <input className="date-input" type="date" style={{width:'100%'}} value={personTransferForm.transfer_date} onChange={e=>setPersonTransferForm(f=>({...f,transfer_date:e.target.value}))}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',display:'block',marginBottom:4}}>Notes <span style={{fontWeight:400,color:'var(--text-muted)'}}>optional</span></label>
                <textarea className="search-input" value={personTransferForm.notes} onChange={e=>setPersonTransferForm(f=>({...f,notes:e.target.value}))}
                  rows={2} style={{resize:'vertical'}}/>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={()=>setShowPersonTransferModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={savePersonTransfer} disabled={personTransferSaving}>
                {personTransferSaving?'Saving…':editingPersonTransferId?'Save Changes':'Add Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
