// Design gallery spec for the Budgets page, desktop.
// Content comes from the data file; this file holds no personal figures.
// The look (Cloud, brand blue, Outfit + Plus Jakarta, hairline panels, top bar,
// underlined controls) was decided on the Cards pages, and the budget bars
// (24px, label inside, blue/amber/red at fill 0.5) on the Dashboard. Locked here.
(function(){
const NAV=['Dashboard','Transactions','Budgets','Net Worth','Daily Balances','Cash Flow','Loans','GCB','Cards','Accounts','Settings'];
const light=(bg,s,r,l,t,t2,t3)=>({'--bg':bg,'--surface':s,'--raised':r,'--line':l,'--tx':t,'--tx2':t2,'--tx3':t3,'--ac':'var(--ac-l)','--ac-fg':'#fff','--ac-soft':'color-mix(in srgb,var(--ac-l) 10%,transparent)','--ac-solid':'color-mix(in srgb,var(--ac-l) 9%,'+s+')','--good':'#047857','--warn':'#B45309','--bad':'#B91C1C'});
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
const ALL12=[1,2,3,4,5,6,7,8,9,10,11,12];
const TODAY={y:2026,m:11,d:7};
const YEARS=[2025,2026,2027];
// Preview state that survives re-renders. OV holds budgets changed in the preview; nothing is saved anywhere.
const S={y:2026,m:10,view:'month',editing:false,edits:{},inline:null,detail:null,open:{},yearEdit:false,yedits:{},rowEd:null,paste:null,menu:false,toast:'',blank:{},focus:null};
// PEND holds changes waiting for Save when cells don't save one by one.
const OV={},PEND={};
let LAST=null,M0=null,TT=0;

const pad=n=>String(n).padStart(2,'0');
const lastDay=(y,m)=>new Date(y,m,0).getDate();
const m2=n=>(n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const m0=n=>(Math.round(n)<0?'-':'')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US');
const k1=n=>{const a=Math.abs(n),s=n<0?'-':'';return s+(a>=1e4?'$'+Math.round(a/1e3)+'k':a>=1e3?'$'+(a/1e3).toFixed(1)+'k':'$'+Math.round(a))};
const sg=(n,f)=>(Math.round(n)>0?'+':Math.round(n)<0?'−':'')+f(Math.abs(n));
const ncat=c=>(!c||c==='Unclassified')?'Other':c;
const esc=s=>LAST.h.esc(s);
const isCur=(y,m)=>y===TODAY.y&&m===TODAY.m;
const isFuture=(y,m)=>y>TODAY.y||(y===TODAY.y&&m>TODAY.m);
const shift=(y,m,k)=>{const d=new Date(y,m-1+k,1);return[d.getFullYear(),d.getMonth()+1]};
const mlab=(y,m)=>`${MONL[m-1]} ${y}`;
const r2=n=>Math.round(n*100)/100;
const fv=n=>n?String(r2(n)):'';

/* ── Model: categories, budgets, actuals ─────────────────── */
function init(d){
  if(M0&&M0.d===d)return M0;
  const par={},type={},ord={},kids={};
  d.cats.forEach((c,i)=>{par[c.n]=c.p||null;type[c.n]=c.t;ord[c.n]=i;if(c.p)(kids[c.p]=kids[c.p]||[]).push(c.n)});
  // Unclassified counts as Other, as on the Dashboard.
  const A={};
  Object.entries(d.actuals).forEach(([y,cs])=>{const o=A[y]={};Object.entries(cs).forEach(([c,ms])=>{const t=o[ncat(c)]=o[ncat(c)]||{};Object.entries(ms).forEach(([m,v])=>{t[m]=r2((t[m]||0)+v)})})});
  const lines=d.lines.map(([dt,c,v,n,a])=>({d:dt,c:ncat(c),v,n,a}));
  return M0={d,par,type,ord,kids,A,lines};
}
const topOf=c=>M0.par[c]||c;
const isInc=c=>M0.type[c]==='income';
const ordOf=c=>M0.ord[c]===undefined?999:M0.ord[c];
function getB(y,c,m){const q=PEND[y]&&PEND[y][c];if(q&&q[m]!=null)return q[m];const o=OV[y]&&OV[y][c];if(o&&o[m]!=null)return o[m];const t=(M0.d.targets[y]||{})[c];return(t&&t[m])||0}
function getA(y,c,m){const t=(M0.A[y]||{})[c];return(t&&t[m])||0}
function setB(y,c,m,v){const o=OV[y]=OV[y]||{};(o[c]=o[c]||{})[m]=v}
function setPend(y,c,m,v){const o=PEND[y]=PEND[y]||{};(o[c]=o[c]||{})[m]=v}
const isPend=(y,c,m)=>!!(PEND[y]&&PEND[y][c]&&PEND[y][c][m]!=null);
const pendCount=()=>Object.values(PEND).reduce((s,cs)=>s+Object.values(cs).reduce((t,ms)=>t+Object.keys(ms).length,0),0);
const clearPend=()=>Object.keys(PEND).forEach(k=>delete PEND[k]);
function savePend(){Object.entries(PEND).forEach(([y,cs])=>Object.entries(cs).forEach(([c,ms])=>Object.entries(ms).forEach(([m,v])=>setB(y,c,Number(m),v))));clearPend()}
function treeCmp(a,b){const ta=topOf(a),tb=topOf(b);if(ta!==tb)return ordOf(ta)-ordOf(tb)||ta.localeCompare(tb);if(a===ta)return -1;if(b===tb)return 1;return ordOf(a)-ordOf(b)||a.localeCompare(b)}
function names(y,inc,all){
  const s=new Set(),add=c=>{if(c!=='Transfer'&&c!=='Unclassified'&&isInc(c)===inc)s.add(c)};
  Object.keys(M0.d.targets[y]||{}).forEach(add);Object.keys(OV[y]||{}).forEach(add);Object.keys(PEND[y]||{}).forEach(add);Object.keys(M0.A[y]||{}).forEach(add);
  if(all)M0.d.cats.forEach(c=>{if(!M0.kids[c.n])add(c.n)});
  return[...s].sort(treeCmp);
}
function members(t,y){
  const s=new Set([t,...(M0.kids[t]||[])]);
  [M0.d.targets[y]||{},OV[y]||{},M0.A[y]||{}].forEach(o=>Object.keys(o).forEach(c=>{if(topOf(c)===t)s.add(c)}));
  return[...s];
}
// A key is a category name, or "g:" + a top level for the top level with everything in it.
function budgetOf(k,y,m){return k.startsWith('g:')?members(k.slice(2),y).reduce((s,c)=>s+getB(y,c,m),0):getB(y,k,m)}
function actOf(k,y,m){return k.startsWith('g:')?members(k.slice(2),y).reduce((s,c)=>s+getA(y,c,m),0):getA(y,k,m)}
// Top-level-only budgets: the amount sits on the top level and its categories go to zero.
function setKey(k,y,m,v){if(k.startsWith('g:')){const t=k.slice(2);members(t,y).forEach(c=>setB(y,c,m,c===t?v:0))}else setB(y,k,m,v)}
function hints(k){let s=0;for(let i=1;i<=3;i++){const[y,m]=shift(S.y,S.m,-i);s+=actOf(k,y,m)}const[py,pm]=shift(S.y,S.m,-1);return{last:actOf(k,py,pm),avg:Math.round(s/3)}}
// Which top levels show their categories: what the viewer toggled, else the starting rule.
function isOpen(g,p){if(S.open[g.cat]!==undefined)return S.open[g.cat];if(p.foldStart==='open')return true;if(p.foldStart==='over')return !!(g.over||(g.kids||[]).some(k=>k.over));return false}
const hasData=y=>!!S.blank[y]||names(y,false,false).length>0||names(y,true,false).length>0;

function flags(r){
  r.hasB=r.budget>0;r.credit=!r.inc&&r.actual<0;r.pct=r.hasB?r.actual/r.budget:0;
  r.over=!r.inc&&r.hasB&&!r.credit&&r.pct>=1;r.near=!r.inc&&r.hasB&&!r.over&&!r.credit&&r.pct>=.8;
  r.noB=!r.hasB&&r.actual>0;r.v=r.inc?r.actual-r.budget:r.budget-r.actual;return r;
}
function rowsFor(y,ms,inc,all){
  return names(y,inc,all).map(c=>flags({cat:c,top:topOf(c),inc,budget:ms.reduce((s,m)=>s+getB(y,c,m),0),actual:r2(ms.reduce((s,m)=>s+getA(y,c,m),0))}))
    .filter(r=>all||Math.abs(r.budget)>.004||Math.abs(r.actual)>.004);
}
function groupsOf(rows,p){
  const m=new Map();
  rows.forEach(r=>{let g=m.get(r.top);if(!g){g={cat:r.top,top:r.top,inc:r.inc,budget:0,actual:0,kids:[],isG:true};m.set(r.top,g)}g.budget+=r.budget;g.actual+=r.actual;g.kids.push(r)});
  return[...m.values()].map(g=>{g.actual=r2(g.actual);flags(g);g.solo=g.kids.length===1&&g.kids[0].cat===g.cat;
    if(p.budgetLevel==='top'){const others=g.kids.some(k=>k.cat!==g.cat);g.kids=g.kids.filter(k=>k.cat!==g.cat||(others&&Math.abs(k.actual)>.004)).map(k=>flags({...k,budget:0,covered:true}))}
    return g});
}
function sortList(list,o){
  if(o==='tree')return list.slice().sort((a,b)=>treeCmp(a.cat,b.cat));
  return list.slice().sort((a,b)=>{const ao=a.cat==='Other',bo=b.cat==='Other';if(ao!==bo)return ao?1:-1;
    if(o==='spend')return b.actual-a.actual;
    if(a.hasB!==b.hasB)return a.hasB?-1:1;if(!a.hasB)return b.actual-a.actual;return b.pct-a.pct});
}
// One unit per line: a category, or a top level holding its categories. ek is the key its budget field edits.
function unitsFor(rows,p,G=p.grouping,o=p.order){
  const top=p.budgetLevel==='top';
  if(G==='flat'){
    if(top)return sortList(groupsOf(rows,p).map(g=>({...g,kids:[],key:'g:'+g.cat,ek:'g:'+g.cat,flatTop:true})),o);
    return sortList(rows.map(r=>({...r,key:r.cat,ek:r.cat})),o);
  }
  return sortList(groupsOf(rows,p),o).map(g=>{
    if(g.solo&&!top){const r=g.kids[0];return{...r,key:r.cat,ek:r.cat}}
    g.key='g:'+g.cat;g.ek=top?'g:'+g.cat:null;
    g.kids=sortList(g.kids,o).map(k=>({...k,key:k.cat,ek:k.covered?null:k.cat}));
    return g});
}
const uKey=u=>u.isG||u.flatTop?'g:'+u.cat:u.cat;
const uB=(u,m)=>u.covered?0:budgetOf(uKey(u),S.y,m);
const uA=(u,m)=>actOf(uKey(u),S.y,m);

/* ── Shared cells ─────────────────────────────────────────── */
const catLabel=c=>{const t=topOf(c);return t!==c?`<span class="pre">${esc(t)} › </span>${esc(c)}`:esc(c)};
function amt(u){
  const a=u.actual;
  if(u.isNet)return `<span class="${a>=0?'good':'bad'}">${sg(a,m0)}</span>`;
  if(Math.abs(a)<.005)return '<span class="mut0">—</span>';
  if(u.inc)return `<span class="good">${m0(a)}</span>`;
  if(u.credit)return `<span class="good">+${m0(-a)}</span>`;
  return `<span class="${u.over?'bad':''}">${m0(a)}</span>`;
}
function pctCell(u){if(!u.hasB||u.isNet||u.covered)return '<span class="mut0">—</span>';return `<span class="${u.over?'bad':u.near?'warn':''}">${Math.round(u.pct*100)}%</span>`}
function varCell(u,p,st=p.varStyle){
  if(u.covered)return '';
  if(u.isNet){const d=u.actual-u.budget;if(st==='pct')return '';return `<span class="${d>=0?'good':'bad'}">${st==='words'?(d>=0?m0(d)+' ahead':m0(-d)+' behind'):sg(d,m0)}</span>`}
  if(st==='pct')return pctCell(u);
  if(!u.hasB&&!u.inc){if(st==='words')return u.actual>0?'<span class="mut">no budget</span>':'<span class="mut0">—</span>';return Math.abs(u.v)<.5?'<span class="mut0">—</span>':`<span class="${u.v>0?'good':'bad'}">${sg(u.v,m0)}</span>`}
  if(Math.abs(u.v)<.5)return '<span class="mut0">—</span>';
  if(st==='words'){if(u.inc)return u.v>=0?`<span class="good">${m0(u.v)} above plan</span>`:`<span class="bad">${m0(-u.v)} short</span>`;
    return u.v>=0?`<span class="good">${m0(u.v)} left</span>`:`<span class="bad">${m0(-u.v)} over</span>`}
  return `<span class="${u.v>0?'good':'bad'}">${sg(u.v,m0)}</span>`;
}
// The 24px bar with the label inside (decided 2026-07-27).
function bar(u,p){
  if(u.isNet||u.covered)return '<span></span>';
  const w=u.hasB&&!u.credit?Math.min(u.pct*100,100):0,cls=u.inc?'inc':u.over?'over':u.near?'near':'ok';
  const lab=u.hasB&&!u.credit?`<span class="${u.over?'bad':''}">${Math.round(u.pct*100)}%</span>`:u.noB?'<span class="mut">no budget set</span>':u.credit?'<span class="mut">net credit</span>':'';
  const td=p.todayMark&&S.view==='month'&&isCur(S.y,S.m)&&u.hasB?`<s class="td" style="left:${(TODAY.d/lastDay(S.y,S.m)*100).toFixed(1)}%" title="Even pace for today"></s>`:'';
  return `<div class="bt ${cls}">${w>0?`<i style="width:${w}%"></i>`:''}${u.credit?'':'<s style="left:25%"></s><s style="left:50%"></s><s style="left:75%"></s>'}${td}${lab}</div>`;
}
const miniBar=(u,p)=>`<span class="mb"><i class="${u.inc?'inc':u.over?'over':''}" style="width:${Math.min(Math.max(u.pct,0),1)*100}%"></i>${p&&p.todayMark&&S.view==='month'&&isCur(S.y,S.m)?`<s style="left:${(TODAY.d/lastDay(S.y,S.m)*100).toFixed(1)}%" title="Even pace for today"></s>`:''}</span>`;
// A budget cell that edits like a spreadsheet: it shows whole dollars, and the plain number while it has focus.
// col and row drive the keys: Tab and Shift+Tab walk the cells in order, Enter and the arrows move by column and row.
function sheetCell(k,m,o){
  return `<input class="sc ${o.cls||''} ${isPend(S.y,k,m)?'pend':''}" data-g="${o.g}" data-sk="${esc(k)}" data-sm="${m}" data-col="${o.col}" data-row="${esc(o.row)}" data-show="${esc(o.show)}" data-raw="${o.raw}" value="${esc(o.show)}" placeholder="–" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${esc(o.label)}" title="${esc(o.label)}">`;
}
// Heat map color: white on budget, green under and red over, by how far this cell is from its own budget.
function heatBg(b,a,inc,p,m){
  const y=S.y;if(m&&isFuture(y,m))return '';
  if(!(b>0)){if(inc||a<=.5)return '';return p.heatNoBudget==='red'?'background:color-mix(in srgb,var(--hr) 80%,var(--surface))':p.heatNoBudget==='grey'?'background:var(--hgrey)':''}
  let r=a/b;if(m&&isCur(y,m)&&p.heatNow==='pace')r=a/(b*TODAY.d/lastDay(y,m));
  const dev=inc?r-1:1-r;let t=Math.min(Math.abs(dev)/(p.heatFull/100),1);
  if(p.heatScale==='steps')t=t<.15?0:t<.5?.4:t<1?.7:1;
  return t<.02?'':`background:color-mix(in srgb,var(${dev>=0?'--hg':'--hr'}) ${Math.round(t*80)}%,var(--surface))`;
}
const editingCtl=p=>S.view==='month'&&((S.editing&&p.editMonth==='column')||p.editMonth==='click');
function budgetCtl(u,p){
  if(u.isNet)return sg(u.budget,m0);
  const k=u.ek,v=u.budget;
  if(!k||u.isTot)return v?m0(v):'<span class="mut0">—</span>';
  if(S.view==='month'&&S.editing&&p.editMonth==='column'){
    const h=p.hints!=='none'?hints(k):null,val=S.edits[k]!=null?S.edits[k]:fv(v);
    const chips=p.hints==='chips'?`<span class="chips"><button type="button" class="chip" data-chip="${esc(k)}" data-v="${Math.max(0,Math.round(h.last))}">Last mo ${m0(Math.max(0,h.last))}</button><button type="button" class="chip" data-chip="${esc(k)}" data-v="${Math.max(0,h.avg)}">3-mo ${m0(Math.max(0,h.avg))}</button></span>`:'';
    return `<input class="fld" type="number" min="0" step="1" data-ek="${esc(k)}" ${u.inc?'data-inc':''} value="${val}" placeholder="${p.hints==='faint'?Math.max(0,h.avg):'0'}" aria-label="${esc(u.cat)} budget">${chips}`;
  }
  if(S.view==='month'&&p.editMonth==='click')return sheetCell(k,S.m,{show:v?m0(v):'',raw:fv(v),label:`${u.cat}, ${MON[S.m-1]} budget`,g:'month',col:0,row:k});
  return v?m0(v):'<span class="mut0">—</span>';
}
function nameCell(u,p,it){
  if(it.t==='tot'||it.t==='net')return `<span class="nm"><span class="tx">${u.isNet?'NET':esc(u.cat)}</span></span>`;
  const flat=p.grouping==='flat'&&!u.flatTop&&!u.isG;
  const fold=it.grp&&p.grouping==='fold',open=isOpen(u,p)||(S.editing&&p.editMonth==='column'&&S.view==='month');
  const caret=fold?`<button type="button" class="car ${open?'on':''}" data-fold="${esc(u.cat)}" aria-label="${open?'Hide':'Show'} the categories in ${esc(u.cat)}" aria-expanded="${open}">▸</button>`:'';
  const cnt=fold&&!open?`<span class="cnt">${u.kids.length}</span>`:'';
  const self=it.lvl&&u.cat===u.top&&p.selfName==='general';
  return `<span class="nm">${caret}<span class="tx">${self?'General':flat?catLabel(u.cat):esc(u.cat)}</span>${cnt}</span>`;
}

/* ── Month view ───────────────────────────────────────────── */
function monthItems(p){
  const y=S.y,m=S.m,ed=S.editing&&p.editMonth==='column',all=ed||p.showEmpty||!!S.blank[y];
  const inc=rowsFor(y,[m],true,all),exp=rowsFor(y,[m],false,all);
  const T=(rs,i)=>flags({cat:i?'Total Income':'Total Expenses',inc:i,isTot:true,budget:rs.reduce((s,r)=>s+r.budget,0),actual:r2(rs.reduce((s,r)=>s+r.actual,0))});
  const ti=T(inc,true),te=T(exp,false),net={cat:'NET',isNet:true,budget:ti.budget-te.budget,actual:ti.actual-te.actual};
  const units=unitsFor(exp,p,p.grouping==='tiles'?'sections':p.grouping);
  const det=k=>S.detail===k&&p.detail==='below'?[{t:'det',key:k}]:[];
  const X=[{t:'sec',label:'Expenses'}];
  const add=list=>list.forEach(u=>{
    const grp=!!(u.isG&&u.kids.length);
    X.push({t:'row',u,lvl:0,grp},...det(u.key));
    if(grp&&(p.grouping!=='fold'||isOpen(u,p)||ed))u.kids.forEach(k=>X.push({t:'row',u:k,lvl:1},...det(k.key)));
  });
  if(p.noBudget==='apart'){const a=units.filter(u=>u.hasB),b=units.filter(u=>!u.hasB);add(a);if(b.length){X.push({t:'sub',label:'No budget'});add(b)}}
  else add(units);
  X.push({t:'tot',u:te});
  const I=[{t:'sec',label:'Income'}];inc.forEach(r=>I.push({t:'row',u:{...r,key:r.cat,ek:r.cat},lvl:0},...det(r.cat)));I.push({t:'tot',u:ti});
  const N={t:'net',u:net};
  const items=p.incomePlace==='top'?[...I,...X,N]:p.incomePlace==='bottom'?[...X,...I,N]:X;
  return{items,ti,te,net,units};
}
function colsOf(p){
  const bf=p.colOrder==='budget',ba=bf?['budget','actual']:['actual','budget'];
  if(p.rowStyle==='table')return bf?['budget','actbar','var']:['actbar','budget','var'];
  if(p.rowStyle==='bars')return p.varStyle==='pct'?['bar',...ba]:['bar',...ba,'var'];
  return[...ba,'var','pct'];
}
// Column widths are CSS variables so a narrow card (drawer or plan panel open) can shrink them.
const W={budget:'var(--wb)',actbar:'var(--wab)',actual:'var(--wa)',var:'var(--wv)',pct:'var(--wp)',bar:'minmax(var(--wbar),1.6fr)'};
const tpl=p=>`minmax(var(--wn),1.15fr) ${colsOf(p).map(c=>W[c]).join(' ')}`;
function headLabel(c,p){
  if(c==='budget')return `${MON[S.m-1]} budget`;
  if(c==='var')return p.rowStyle==='ledger'?'Difference':p.varStyle==='words'?'Left':p.varStyle==='pct'?'% used':'Variance';
  return{actual:'Actual',actbar:'Actual',pct:'% used',bar:'Progress'}[c];
}
function cell(c,u,p){
  if(c==='budget')return budgetCtl(u,p);
  if(c==='actual')return amt(u);
  if(c==='actbar')return `<span class="ab">${amt(u)}${u.hasB&&!u.isNet&&!u.covered?miniBar(u,p):'<i class="mb-sp"></i>'}</span>`;
  if(c==='var')return varCell(u,p,p.rowStyle==='ledger'&&p.varStyle==='pct'?'signed':p.varStyle);
  if(c==='pct')return u.isNet?'':pctCell(u);
  return bar(u,p);
}
const clickable=(p,it)=>p.detail!=='none'&&it.t==='row';
const detAttr=k=>`data-det="${esc(k)}" role="button" tabindex="0"`;
function rowHtml(it,p,cols){
  const u=it.u,ck=clickable(p,it);
  return `<div class="r gr ${it.t} ${it.lvl?'kid':''} ${it.grp?'grp':''} ${S.detail===u.key&&p.detail!=='link'?'on':''} ${ck?'click':''}" style="grid-template-columns:${tpl(p)}" ${ck?detAttr(u.key):''}>${nameCell(u,p,it)}${cols.map(c=>`<span class="c c-${c}">${cell(c,u,p)}</span>`).join('')}</div>`;
}
const detInline=(k,p)=>`<div class="det-inline" data-region="sheet">${detailHtml(k,p,'below')}</div>`;
function tableHtml(p,mi){
  const cols=colsOf(p);
  const head=`<div class="r head" style="grid-template-columns:${tpl(p)}"><span>Category</span>${cols.map(c=>`<span class="c c-${c}">${headLabel(c,p)}</span>`).join('')}</div>`;
  return `<div class="lst">${head}${mi.items.map(it=>it.t==='sec'||it.t==='sub'?`<div class="sec ${it.t}">${it.label}</div>`:it.t==='det'?detInline(it.key,p):rowHtml(it,p,cols)).join('')}</div>`;
}
function figure(u,p){
  if(u.covered||!u.hasB||u.credit||p.varStyle==='pct')return `<span class="ba">${amt(u)}</span>`;
  return `<span class="ba">${varCell(u,p)}</span>`;
}
function subLine(u,p){
  if(u.covered)return `counted in ${esc(u.top)}`;
  if(u.hasB||(u.ek&&editingCtl(p)))return `${Math.abs(u.actual)<.005?'$0':amt(u)} of ${budgetCtl(u,p)}`;
  return u.credit?'net credit':'no budget set';
}
function twoList(p,mi){
  return `<div class="tl-list">${mi.items.map(it=>{
    if(it.t==='sec'||it.t==='sub')return `<div class="sec ${it.t}">${it.label}</div>`;
    if(it.t==='det')return detInline(it.key,p);
    const u=it.u,ck=clickable(p,it);
    const fig=u.isNet?`<span class="ba">${amt(u)}</span>`:figure(u,p);
    const sub=u.isNet?`planned ${sg(u.budget,m0)}`:u.isTot?`${amt(u)} of ${u.budget?m0(u.budget):'—'}`:subLine(u,p);
    return `<div class="tl ${it.t} ${it.lvl?'kid':''} ${it.grp?'grp':''} ${S.detail===u.key&&p.detail!=='link'?'on':''} ${ck?'click':''}" ${ck?detAttr(u.key):''}><div class="tl-h">${nameCell(u,p,it)}${fig}</div>${u.isNet?'':bar(u,p)}<span class="mut sl">${sub}</span></div>`;
  }).join('')}</div>`;
}
function kidRow(k,p){
  const ck=p.detail!=='none',w=k.hasB&&!k.credit?Math.min(k.pct*100,100):0;
  const sm=k.covered?'':(k.hasB||(k.ek&&editingCtl(p)))?`of ${budgetCtl(k,p)}`:k.credit?'net credit':'no budget';
  return `<div class="bk2 ${S.detail===k.key&&p.detail!=='link'?'on':''} ${k.ek&&editingCtl(p)?'ed':''}" ${ck?detAttr(k.key):''}><span>${esc(k.cat)}</span><b>${amt(k)}</b><small>${sm}</small>${k.covered?'':`<i class="bk2-t ${k.over?'over':k.near?'near':''}"><em style="width:${w}%"></em></i>`}</div>`;
}
function tilesHtml(p,mi){
  const has=(u,k)=>u.key===k||(u.kids||[]).some(x=>x.key===k);
  const tile=u=>{const ck=p.detail!=='none',grp=u.isG&&u.kids.length;
    return `<div class="bti ${S.detail===u.key&&p.detail!=='link'?'on':''}" ${ck?detAttr(u.key):''}><div class="bti-h"><b>${esc(u.cat)}</b>${figure(u,p)}</div>${bar(u,p)}<span class="mut sl">${subLine(u,p)}</span>${grp?`<div class="bk2s">${u.kids.map(k=>kidRow(k,p)).join('')}</div>`:''}</div>`
      +(p.detail==='below'&&S.detail&&has(u,S.detail)?detInline(S.detail,p):'')};
  const units=mi.units,apart=p.noBudget==='apart';
  const a=apart?units.filter(u=>u.hasB):units,b=apart?units.filter(u=>!u.hasB):[];
  const grid=l=>`<div class="btiles">${l.map(tile).join('')}</div>`;
  const tot=`<div class="btot"><span>Total spent</span><b class="val">${m2(mi.te.actual)}</b><span class="mut">of ${m2(mi.te.budget)} budgeted</span></div>`;
  const inc=p.incomePlace==='summary'?'':`<div class="inc-s"><span>Income</span><b class="good">${m2(mi.ti.actual)}</b><span class="mut">of ${m2(mi.ti.budget)} planned</span><i></i><span>Net</span><b class="${mi.net.actual>=0?'good':'bad'}">${sg(mi.net.actual,m2)}</b><span class="mut">planned ${sg(mi.net.budget,m2)}</span></div>`;
  const body=grid(a)+(b.length?'<div class="sec sub">No budget</div>'+grid(b):'');
  return p.incomePlace==='bottom'?tot+body+inc:inc+tot+body;
}

/* ── Clicking a category ──────────────────────────────────── */
function miniChart(k){
  const y=S.y,W=320,H=118,P={t:10,b:20,l:4,r:4},cw=W-P.l-P.r,ch=H-P.t-P.b,sl=cw/12;
  const v=ALL12.map(m=>({m,a:actOf(k,y,m),b:budgetOf(k,y,m)})),mx=Math.max(...v.map(x=>Math.max(x.a,x.b)),1)*1.08,Y=x=>P.t+ch-Math.max(x,0)/mx*ch;
  const g=v.map((x,i)=>{const cx=P.l+(i+.5)*sl,bw=sl*.56,top=Y(x.a),sel=S.view==='month'&&x.m===S.m,over=x.b>0&&x.a>x.b;
    return `${isFuture(y,x.m)?'':`<rect class="mcb ${over?'over':''} ${sel?'on':''}" x="${(cx-bw/2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(P.t+ch-top,0).toFixed(1)}" rx="2"><title>${MON[x.m-1]}: ${m2(x.a)}${x.b?' of '+m2(x.b):''}</title></rect>`}${x.b>0?`<line class="mct" x1="${(cx-bw/2-3).toFixed(1)}" x2="${(cx+bw/2+3).toFixed(1)}" y1="${Y(x.b).toFixed(1)}" y2="${Y(x.b).toFixed(1)}"/>`:''}<text class="mcx ${sel?'on':''}" x="${cx.toFixed(1)}" y="${H-5}" text-anchor="middle">${MON[x.m-1][0]}</text>`}).join('');
  return `<div class="mc-w"><div class="mc-l"><span>${y} by month</span><span><i class="lk-b"></i>spent<i class="lk-t"></i>budget</span></div><svg class="mc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${y} spending by month">${g}</svg></div>`;
}
const dRow=(l,grp)=>{const x=new Date(l.d+'T12:00:00');return `<div class="dr"><span class="rd">${MON[x.getMonth()]} ${x.getDate()}</span><div class="rn"><b>${esc(l.n)}</b><span>${esc(grp?l.c+' · '+l.a:l.a)}</span></div><b class="amt ${l.v<0?'good':''}">${l.v<0?'+'+m2(-l.v):m2(l.v)}</b></div>`};
function detailHtml(k,p,mode){
  const grp=k.startsWith('g:'),name=grp?k.slice(2):k,y=S.y,yr=S.view==='annual',ms=yr?ALL12:[S.m];
  const r=flags({budget:ms.reduce((s,m)=>s+budgetOf(k,y,m),0),actual:r2(ms.reduce((s,m)=>s+actOf(k,y,m),0)),inc:isInc(name)}),a=r.actual,b=r.budget;
  const lo=`${y}-${pad(ms[0])}-01`,hi=`${y}-${pad(ms[ms.length-1])}-31`,inCat=l=>grp?topOf(l.c)===name:l.c===name;
  const rows=M0.lines.filter(l=>inCat(l)&&l.d>=lo&&l.d<=hi).sort((x,z)=>x.d<z.d?1:x.d>z.d?-1:z.v-x.v),show=rows.slice(0,mode==='drawer'?20:12);
  const st=r.inc?'':r.hasB?(r.over?`<span class="bad">${m2(a-b)} over</span>`:`<span class="good">${m2(b-a)} left</span>`):r.credit?'<span class="good">net credit</span>':'<span class="mut">no budget set</span>';
  const head=`<div class="det-h"><div><b>${esc(name)}</b><span class="val">${r.credit?'+'+m2(-a):m2(a)}</span><span class="mut">${r.hasB?'of '+m2(b)+' · ':''}${yr?y:mlab(y,S.m)}</span>${st}</div><button type="button" class="x" data-act="dclose" aria-label="Close ${esc(name)}">✕</button></div>`;
  let kids='';
  if(grp){const ks=rowsFor(y,ms,false,false).filter(x=>x.top===name);
    if(ks.length>1||(ks[0]&&ks[0].cat!==name))kids=`<div class="det-k">${ks.map(x=>`<span><b>${esc(x.cat)}</b> <em class="${x.over?'bad':x.credit?'good':''}">${x.credit?'+'+m2(-x.actual):m2(x.actual)}</em>${x.hasB?' of '+m2(x.budget):' · no budget'}</span>`).join('')}</div>`}
  const none=r.inc?'Income rows aren\'t in this preview.':hi<'2026-08-01'?'Transactions before August 2026 aren\'t in this preview.':'No transactions in this period.';
  const more=rows.length>show.length?`<button type="button" class="link more" data-act="tolink">${rows.length-show.length} more in Transactions →</button>`:'';
  const note=yr&&show.length&&lo<'2026-08-01'?'<p class="mut pad sm">The preview has rows from August 2026 on.</p>':'';
  const bud=mode==='drawer'&&p.drawerEdit?(grp?`<div class="db"><p class="mut">This total adds up the budgets inside ${esc(name)}. Open one of them to set its months.</p></div>`
    :`<div class="db"><div class="mc-l"><span>Budget by month, ${y}</span><span>${m0(ALL12.reduce((s,m)=>s+getB(y,name,m),0))} for the year</span></div>${[0,1,2].map(h=>`<div class="db-r gr">${ALL12.slice(h*4,h*4+4).map(m=>{const b=getB(y,name,m);return `<label class="db-c ${isCur(y,m)?'cur':''}"><span>${MON[m-1]}</span>${sheetCell(name,m,{show:b?m0(b):'',raw:fv(b),label:`${name}, ${MON[m-1]} budget`,g:'drawer',col:(m-1)%4,row:'abc'[h]})}</label>`}).join('')}</div>`).join('')}</div>`):'';
  return head+kids+(mode==='drawer'?miniChart(k)+bud:'')+`<div class="det-l">${show.length?show.map(l=>dRow(l,grp)).join(''):`<p class="mut pad">${none}</p>`}${more}${note}</div>`;
}

/* ── Plan panel (editing a month beside the list) ─────────── */
function editPanel(p){
  const y=S.y,m=S.m,H=p.hints,top=p.budgetLevel==='top';
  const line=(label,k,inc,cls='')=>{const h=hints(k),val=S.edits[k]!=null?S.edits[k]:fv(budgetOf(k,y,m));
    const hv=v=>H==='chips'?`<button type="button" class="chip" data-chip="${esc(k)}" data-v="${Math.max(0,Math.round(v))}">${m0(v)}</button>`:`<span class="hv">${m0(v)}</span>`;
    return `<div class="ep-r ${cls} ${H==='none'?'nh':''}"><span class="ep-n">${label}</span>${H==='none'?'':hv(h.last)+hv(h.avg)}<input class="fld" type="number" min="0" step="1" data-ek="${esc(k)}" ${inc?'data-inc':''} value="${val}" placeholder="${H==='faint'?Math.max(0,h.avg):'0'}" aria-label="${esc(k.replace(/^g:/,''))} budget"></div>`};
  const out=['<div class="ep-g">Income</div>'];
  rowsFor(y,[m],true,true).forEach(r=>out.push(line(esc(r.cat),r.cat,true)));
  out.push('<div class="ep-g">Expenses</div>');
  const exp=rowsFor(y,[m],false,true);
  if(top)groupsOf(exp,p).sort((a,b)=>treeCmp(a.cat,b.cat)).forEach(g=>out.push(line(esc(g.cat),'g:'+g.cat,false)));
  else{let last=null;exp.forEach(r=>{
    if(p.grouping!=='flat'&&r.top!==last){if(exp.some(x=>x.top===r.top&&x.cat!==r.top))out.push(`<div class="ep-t">${esc(r.top)}</div>`);last=r.top}
    out.push(line(p.grouping==='flat'?catLabel(r.cat):esc(r.cat),r.cat,false,p.grouping!=='flat'&&r.top!==r.cat?'kid':''))})}
  const hd=H==='none'?'':`<div class="ep-r hd"><span>Category</span><span>Last mo</span><span>3-mo avg</span><span>Budget</span></div>`;
  return `<aside class="ep sf" data-region="sheet"><div class="ep-h"><b>Plan ${mlab(y,m)}</b><span class="mut">${H==='none'?'Every category, with its budget field.':H==='chips'?'Click last month or the 3-month average to use it.':'Last month\'s spending and the 3-month average beside each field.'}</span></div>${hd}<div class="ep-l">${out.join('')}</div><div class="ep-f"><div class="ep-tot"></div><div class="acts"><button type="button" class="btn ghost" data-act="cancel">Cancel</button><button type="button" class="btn pri" data-act="save">Save</button></div></div></aside>`;
}

/* ── Year view ────────────────────────────────────────────── */
function yearEntries(p,inc){
  const st=p.yearStyle,top=p.budgetLevel==='top',out=[];
  const units=unitsFor(rowsFor(S.y,ALL12,inc,false),p,p.grouping==='tiles'?'sections':p.grouping,'tree');
  const det=k=>{if(S.detail===k&&p.detail==='below')out.push({t:'det',key:k})};
  units.forEach(u=>{
    let kids=u.isG?u.kids:[];
    if(st==='targets'){if(u.budget<=0)return;kids=kids.filter(k=>!k.covered&&k.budget>0)}
    if(u.isG&&!top&&kids.length===1&&kids[0].cat===u.cat){u=kids[0];kids=[]}
    const grp=kids.length>0;
    out.push({t:'row',u,lvl:0,grp});det(u.key);if(u.ek&&S.rowEd===u.ek)out.push({t:'rowed',u});
    if(grp&&(p.grouping!=='fold'||isOpen(u,p)))kids.forEach(k=>{out.push({t:'row',u:k,lvl:1});det(k.key);if(k.ek&&S.rowEd===k.ek)out.push({t:'rowed',u:k})});
  });
  return out;
}
function yCell(u,p,m){
  const st=p.yearStyle,y=S.y,b=uB(u,m),a=uA(u,m),fut=isFuture(y,m),cur=isCur(y,m),k=u.ek;
  if(st==='heat'){
    const bg=heatBg(b,a,u.inc,p,m),cr=!u.inc&&a<0,tip=`${MON[m-1]}: ${m2(a)} spent${b?' of '+m2(b):', no budget'}`;
    const show=fut?(p.heatFuture==='grey'&&b?m0(b):''):Math.abs(a)>=.5?(cr?'+'+m0(-a):m0(a)):b?'$0':'';
    if(p.heatEdit==='edit'&&k)return `<span class="yc hm ${cur?'cur':''} ${fut?'fut':''}" ${bg?`style="${bg}"`:''}>${sheetCell(k,m,{show,raw:fv(b),label:`${u.cat}, ${MON[m-1]} budget (${tip})`,g:'year',col:m,row:k,cls:'hc'})}<em class="cap">${MON[m-1]} budget</em></span>`;
    const pn=p.heatEdit==='panel';
    return `<span class="yc hm ${cur?'cur':''} ${fut?'fut':''} ${pn?'ed':''}" ${pn?`data-hcell="${esc(u.key)}" data-m="${m}" role="button" tabindex="0"`:''} ${bg?`style="${bg}"`:''} title="${tip}">${show||'<span class="mut0">—</span>'}</span>`;
  }
  if(k&&S.inline&&S.inline.w==='y'&&S.inline.k===k&&S.inline.m===m)return `<span class="yc ${cur?'cur':''}"><input class="fld yi" type="number" min="0" step="1" data-inl="${esc(k)}" data-m="${m}" data-af value="${fv(b)}" aria-label="${esc(u.cat)} ${MON[m-1]} budget"></span>`;
  const at=k?`data-cell="${esc(k)}" data-m="${m}" role="button" tabindex="0" title="Change the ${MON[m-1]} budget"`:'';
  let inner,cls='',style='';
  if(st==='targets')inner=b?m0(b):k?'<span class="plus">+</span>':'<span class="mut0">—</span>';
  else if(fut){cls='fut';inner=b?(st==='heat'?`<small>${k1(b)}</small>`:`<span>${m0(b)}</span><small>budget</small>`):'<span class="mut0">—</span>'}
  else{const r=flags({budget:b,actual:a,inc:u.inc}),has=Math.abs(a)>=.5,av=r.credit?'+'+(st==='heat'?k1(-a):m0(-a)):(st==='heat'?k1(a):m0(a));
    if(st==='both')inner=`<b class="${r.over?'bad':r.credit||u.inc?'good':''}">${has?av:'—'}</b><small>${b?'of '+m0(b):'no budget'}</small>`;
    else{cls='heat';
      if(r.hasB&&!r.credit){const col=u.inc?'var(--good)':r.over?'var(--b-over)':r.near?'var(--b-near)':'var(--b-ok)';style=`background:color-mix(in srgb,${col} ${Math.round(8+Math.min(r.pct,1.5)/1.5*40)}%,var(--surface))`}
      else if(r.noB)style='background:repeating-linear-gradient(135deg,var(--raised) 0 4px,var(--surface) 4px 8px)';
      inner=has?`<b>${av}</b>${r.hasB&&!u.inc&&!r.credit?`<small>${Math.round(r.pct*100)}%</small>`:''}`:b?`<small>of ${k1(b)}</small>`:'<span class="mut0">—</span>'}}
  return `<span class="yc ${cur?'cur':''} ${cls} ${k?'ed':''}" ${at} ${style?`style="${style}"`:''}>${inner}</span>`;
}
const pen=(u,p,always)=>u.ek&&(p.editYear==='rowfill'||always)?`<button type="button" class="pen" data-rowed="${esc(u.ek)}" aria-label="Set every month of ${esc(u.cat)}">✎</button>`:'';
function yRow(it,p){
  const u=it.u,ck=clickable(p,it),hm=p.yearStyle==='heat',tb=ALL12.reduce((s,m)=>s+uB(u,m),0),ta=ALL12.reduce((s,m)=>s+uA(u,m),0);
  let tot,ts='';
  // Heat map total: spending so far against the budget for the months so far.
  if(hm){const n=S.y===TODAY.y?TODAY.m:S.y<TODAY.y?12:0,bY=ALL12.filter(m=>m<=n).reduce((s,m)=>s+uB(u,m),0);ts=heatBg(bY,ta,u.inc,p,0);tot=Math.abs(ta)>=.5?(!u.inc&&ta<0?'+'+m0(-ta):m0(ta)):'<span class="mut0">—</span>'}
  else tot=p.yearStyle==='targets'?(tb?m0(tb):'<span class="mut0">—</span>'):`<b>${u.credit||ta<0?'+'+m0(-ta):m0(ta)}</b><small>of ${m0(tb)}</small>`;
  return `<div class="yr gr ${it.lvl?'kid':''} ${it.grp?'grp':''} ${S.detail===u.key&&p.detail!=='link'?'on':''}"><span class="yn ${ck?'click':''}" ${ck?detAttr(u.key):''}>${nameCell(u,p,it)}</span>${ALL12.map(m=>yCell(u,p,m)).join('')}<span class="ytot ${hm?'hm':''}" ${ts?`style="${ts}"`:''}>${tot}${pen(u,p)}</span></div>`;
}
function monthTot(inc,m){return names(S.y,inc,false).reduce((o,c)=>{o.b+=getB(S.y,c,m);o.a+=getA(S.y,c,m);return o},{b:0,a:0})}
function yTot(label,inc,p){
  const st=p.yearStyle;let TB=0,TA=0,BY=0;
  const cells=ALL12.map(m=>{const t=monthTot(inc,m),fut=isFuture(S.y,m);TB+=t.b;TA+=t.a;if(!fut)BY+=t.b;
    if(st==='heat'){const bg=heatBg(t.b,t.a,inc,p,m);return `<span class="yc hm ${isCur(S.y,m)?'cur':''} ${fut?'fut':''}" ${bg?`style="${bg}"`:''}>${fut?(p.heatFuture==='grey'&&t.b?m0(t.b):''):m0(t.a)}</span>`}
    return `<span class="${isCur(S.y,m)?'cur':''} ${fut&&st!=='targets'?'fut':''}">${st==='targets'||fut?(t.b?m0(t.b):'—'):`<b>${m0(t.a)}</b><small>of ${m0(t.b)}</small>`}</span>`}).join('');
  if(st==='heat'){const bg=heatBg(BY,TA,inc,p,0);return `<div class="yr tot"><span class="yn">Total ${label}</span>${cells}<span class="ytot hm" ${bg?`style="${bg}"`:''}>${m0(TA)}</span></div>`}
  return `<div class="yr tot"><span class="yn">Total ${label}</span>${cells}<span class="ytot">${st==='targets'?m0(TB):`<b>${m0(TA)}</b><small>of ${m0(TB)}</small>`}</span></div>`;
}
function yNet(p){
  const st=p.yearStyle;let NB=0,NA=0;
  const cells=ALL12.map(m=>{const i=monthTot(true,m),e=monthTot(false,m),nb=i.b-e.b,na=i.a-e.a,fut=isFuture(S.y,m),act=st!=='targets'&&!fut;NB+=nb;NA+=na;const v=act?na:nb;
    if(st==='heat')return `<span class="yc hm ${isCur(S.y,m)?'cur':''} ${fut?'fut':''}">${fut?(p.heatFuture==='grey'&&Math.abs(nb)>=.5?sg(nb,m0):''):`<b class="${na>=0?'good':'bad'}">${sg(na,m0)}</b>`}</span>`;
    return `<span class="${isCur(S.y,m)?'cur':''} ${st!=='targets'&&fut?'fut':''}">${Math.abs(v)<.5?'<span class="mut0">—</span>':`<b class="${v>=0?'good':'bad'}">${sg(v,m0)}</b>`}${act?`<small>plan ${sg(nb,m0)}</small>`:''}</span>`}).join('');
  const tv=st==='targets'?NB:NA;
  if(st==='heat')return `<div class="yr net"><span class="yn">NET</span>${cells}<span class="ytot"><b class="${NA>=0?'good':'bad'}">${sg(NA,m0)}</b></span></div>`;
  return `<div class="yr net"><span class="yn">${st==='targets'?'NET P&amp;L':'NET'}</span>${cells}<span class="ytot"><b class="${tv>=0?'good':'bad'}">${sg(tv,m0)}</b>${st==='targets'?'':`<small>plan ${sg(NB,m0)}</small>`}</span></div>`;
}
function rowEditor(u){
  const y=S.y,from=y===TODAY.y?TODAY.m:1;
  return `<div class="rowed" data-rowedbox="${esc(u.ek)}"><div class="rf-top"><b>${esc(u.cat)}, ${y}</b><label>Every month <input class="fld" type="number" min="0" step="1" data-rfall placeholder="0"></label><button type="button" class="btn" data-fill="all">Fill all 12</button>${from>1?`<button type="button" class="btn" data-fill="rest">Fill ${MON[from-1]} – Dec</button>`:''}</div>
    <div class="rf-ms">${ALL12.map(m=>`<label><span>${MON[m-1]}</span><input class="fld" type="number" min="0" step="1" data-rf="${m}" value="${fv(uB(u,m))}"></label>`).join('')}</div>
    <div class="rf-f"><button type="button" class="btn ghost" data-act="rfcancel">Cancel</button><button type="button" class="btn pri" data-act="rfsave">Save</button></div></div>`;
}
function yearGrid(p){
  const head=`<div class="yr head"><span class="yn">Category</span>${MON.map((l,i)=>`<span class="${isCur(S.y,i+1)?'cur':''}">${l}</span>`).join('')}<span class="ytot">Total</span></div>`;
  const sect=(label,inc)=>`<div class="sec">${label}</div>`+yearEntries(p,inc).map(it=>it.t==='det'?detInline(it.key,p):it.t==='rowed'?rowEditor(it.u):yRow(it,p)).join('')+yTot(label,inc,p);
  const I=sect('Income',true),X=sect('Expenses',false),N=yNet(p);
  return `<div class="yscroll"><div class="yg">${head}${p.incomePlace==='top'?I+X+N:p.incomePlace==='bottom'?X+I+N:X}</div></div>`;
}
function ytdHtml(p){
  const M=S.m,t=`minmax(170px,1.2fr) 108px 108px ${p.varStyle==='words'?156:118}px minmax(120px,1fr) 112px 150px`;
  const rng=`Jan${M>1?' – '+MON[M-1]:''}`;
  const marks=u=>`<span class="marks">${ALL12.map(m=>{if(m>M||isFuture(S.y,m))return '<i class="fut"></i>';const r=flags({budget:uB(u,m),actual:uA(u,m),inc:u.inc});
    return `<i class="${u.inc?(r.actual>0?'ok':''):r.over?'over':r.near?'near':r.hasB?(r.credit?'':'ok'):r.noB?'none':''}" title="${MON[m-1]}: ${m2(r.actual)}${r.hasB?' of '+m2(r.budget):''}"></i>`}).join('')}</span>`;
  const row=it=>{const u=it.u,ck=clickable(p,it),bY=ALL12.filter(m=>m<=M).reduce((s,m)=>s+uB(u,m),0),aY=ALL12.filter(m=>m<=M).reduce((s,m)=>s+uA(u,m),0),full=ALL12.reduce((s,m)=>s+uB(u,m),0);
    const r=flags({...u,budget:bY,actual:r2(aY)});
    return `<div class="r ${it.lvl?'kid':''} ${it.grp?'grp':''} ${S.detail===u.key&&p.detail!=='link'?'on':''} ${ck?'click':''}" style="grid-template-columns:${t}" ${ck?detAttr(u.key):''}>${nameCell(u,p,it)}<span class="c">${u.covered?'':bY?m0(bY):'<span class="mut0">—</span>'}</span><span class="c">${amt(r)}</span><span class="c">${varCell(r,p,p.varStyle==='pct'?'signed':p.varStyle)}</span><span class="c c-bar">${bar(r,p)}</span><span class="c">${u.covered?'':full?m0(full):'<span class="mut0">—</span>'}${pen(u,p,true)}</span><span class="c">${marks(u)}</span></div>`};
  const tot=(label,inc)=>{let b=0,a=0,f=0;ALL12.forEach(m=>{const x=monthTot(inc,m);if(m<=M){b+=x.b;a+=x.a}f+=x.b});const r=flags({cat:label,inc,isTot:true,budget:b,actual:r2(a)});
    return `<div class="r tot" style="grid-template-columns:${t}"><span class="nm"><span class="tx">Total ${label}</span></span><span class="c">${m0(b)}</span><span class="c">${amt(r)}</span><span class="c">${varCell(r,p,p.varStyle==='pct'?'signed':p.varStyle)}</span><span class="c c-bar">${bar(r,p)}</span><span class="c">${m0(f)}</span><span></span></div>`};
  const sect=(label,inc)=>`<div class="sec">${label}</div>`+yearEntries(p,inc).map(it=>it.t==='det'?detInline(it.key,p):it.t==='rowed'?rowEditor(it.u):row(it)).join('')+tot(label,inc);
  const head=`<div class="r head" style="grid-template-columns:${t}"><span>Category</span><span class="c">Budget ${rng}</span><span class="c">Spent ${rng}</span><span class="c">${p.varStyle==='words'?'Left':'Variance'}</span><span class="c c-bar">Progress</span><span class="c">Full-year budget</span><span class="c">By month</span></div>`;
  const I=sect('Income',true),X=sect('Expenses',false);
  return `<div class="yscroll"><div class="lst ytd">${head}${p.incomePlace==='bottom'?X+I:p.incomePlace==='summary'?X:I+X}</div></div>`;
}
function editYearGrid(p){
  const y=S.y,act=p.gridActual;
  const head=`<div class="yr head"><span class="yn">Category</span>${MON.map((l,i)=>`<span class="${isCur(y,i+1)?'cur':''}">${l}</span>`).join('')}<span class="ytot">Total</span></div>`;
  const row=(label,k,cls='')=>{let tot=0;
    const cells=ALL12.map(m=>{const b=getB(y,k,m),a=getA(y,k,m);tot+=b;
      return `<span class="scw ${isCur(y,m)?'cur':''}">${sheetCell(k,m,{show:b?m0(b):'',raw:fv(b),label:`${k}, ${MON[m-1]} budget`,g:'grid',col:m,row:k})}${act?`<small class="act" title="Spent in ${MON[m-1]}">${Math.abs(a)>=.5?(a<0?'+'+m0(-a):m0(a)):'&nbsp;'}</small>`:''}</span>`}).join('');
    return `<div class="yr sh gr ${cls}"><span class="yn">${label}</span>${cells}<span class="ytot">${tot?m0(tot):'<span class="mut0">—</span>'}</span></div>`};
  // Top-level and total rows add up the cells under them and change as you type.
  const sum=(label,cs,cls)=>{let T=0;const cells=ALL12.map(m=>{const v=cs.reduce((s,c)=>s+getB(y,c,m),0);T+=v;return `<span class="${isCur(y,m)?'cur':''}">${v?m0(v):'<span class="mut0">—</span>'}</span>`}).join('');
    return `<div class="yr shs ${cls}"><span class="yn">${label}</span>${cells}<span class="ytot">${m0(T)}</span></div>`};
  const sect=(label,inc)=>{const rows=rowsFor(y,ALL12,inc,true),out=[`<div class="sec">${label}</div>`];
    [...new Set(rows.map(r=>r.top))].forEach(t=>{const rs=rows.filter(r=>r.top===t);
      if(rs.length===1&&rs[0].cat===t){out.push(row(esc(t),t));return}
      out.push(sum(esc(t),rs.map(r=>r.cat),'grp'));
      rs.forEach(r=>out.push(row(r.cat===t&&p.selfName==='general'?'General':esc(r.cat),r.cat,'kid')))});
    out.push(sum(`Total ${label.toLowerCase()}`,rows.map(r=>r.cat),'tot'));
    return out.join('')};
  return `<div class="yscroll"><div class="yg">${head}${sect('Income',true)}${sect('Expenses',false)}</div></div>`;
}
/* ── New year, paste, empty states ────────────────────────── */
function avgPlan(y,n){const o={};Object.entries(M0.A[y]||{}).forEach(([c,ms])=>{if(c==='Transfer')return;let s=0;for(let m=1;m<=n;m++)s+=ms[m]||0;const v=Math.round(s/n/10)*10;if(v>0)o[c]=v});return o}
const fullMonths=y=>y===TODAY.y?TODAY.m-1:12;
function startPanel(){
  const prev=S.y-1,pt=M0.d.targets[prev]||{};let eb=0,nc=0;
  Object.entries(pt).forEach(([c,ms])=>{const s=Object.values(ms).reduce((a,v)=>a+v,0);if(s>0)nc++;if(!isInc(c))eb+=s});
  const n=fullMonths(prev),avg=avgPlan(prev,n),at=Object.entries(avg).reduce((s,[c,v])=>isInc(c)?s:s+v,0);
  return `<div class="start" data-region="sheet"><div><h3>Plan ${S.y}</h3><p class="mut">Pick a starting point. Every budget can be changed afterwards.</p></div><div class="start-g">
    <button type="button" class="sopt" data-start="copy"><b>Copy ${prev}'s budgets</b><span>Every category, month by month, including planned income.</span><em>${m0(eb/12)} a month in spending budgets · ${nc} categories</em></button>
    <button type="button" class="sopt" data-start="avg"><b>Start from ${prev}'s spending</b><span>Each category's average month, Jan – ${MON[n-1]} ${prev}, rounded to $10. Credits are left out.</span><em>${m0(at)} a month · ${Object.keys(avg).length} categories</em></button>
    <button type="button" class="sopt" data-start="empty"><b>Start empty</b><span>Every category at $0, set one by one.</span><em>Then use Edit</em></button></div></div>`;
}
function emptyYear(p){
  if(p.newYear==='start'&&Object.keys(M0.d.targets[S.y-1]||{}).length)return startPanel();
  return `<div class="empty">No budget data for ${S.y}</div>`;
}
function parsePaste(text){
  const all=[...names(S.y,true,true),...names(S.y,false,true)],rows=[],errs=[],norm=s=>s.toLowerCase().replace(/[^a-z]/g,'');
  const lines=(text||'').trim().split('\n').filter(l=>l.trim());if(!lines.length)return{rows,errs};
  const f=lines[0].split('\t'),st=f[0].trim().toLowerCase()==='category'||MON.map(x=>x.toLowerCase()).includes((f[1]||'').trim().toLowerCase())?1:0;
  for(let i=st;i<lines.length;i++){const c=lines[i].split('\t').map(s=>s.trim());if(!c[0])continue;
    const hit=all.find(x=>x.toLowerCase()===c[0].toLowerCase())||all.find(x=>norm(x)===norm(c[0]));
    if(!hit){errs.push(`Unknown: "${c[0]}"`);continue}
    const v=[];for(let j=0;j<12;j++){const raw=(c[j+1]||'').replace(/[$,\s]/g,'');if(!raw||raw==='-'||raw==='—'){v.push(null);continue}const n=parseFloat(raw);v.push(isNaN(n)?null:Math.abs(n))}
    rows.push({cat:hit,v})}
  return{rows,errs};
}
function pastePrev(){
  const{rows,errs}=parsePaste(S.paste.text),n=rows.reduce((s,r)=>s+r.v.filter(x=>x!=null).length,0);
  const er=errs.length?`<div class="perr">${errs.map(e=>`<div>⚠ ${esc(e)}</div>`).join('')}</div>`:'';
  if(!rows.length)return er+(S.paste.text.trim()?'<p class="mut">No valid rows found. Check that category names match exactly.</p>':'');
  return er+`<b class="pc">Preview: ${rows.length} ${rows.length===1?'category':'categories'}, ${n} targets</b><div class="yscroll"><div class="pt"><div class="ptr hd"><span>Category</span>${MON.map(m=>`<span>${m}</span>`).join('')}</div>${rows.map(r=>`<div class="ptr"><span>${esc(r.cat)}</span>${r.v.map(x=>`<span>${x==null?'—':m0(x)}</span>`).join('')}</div>`).join('')}</div></div>`;
}
function pasteModal(){
  if(!S.paste)return '';
  // House rule: windows close only with their own buttons, never on a backdrop click or Escape.
  return `<div class="ov"><div class="modal sf" role="dialog" aria-modal="true" aria-label="Paste budget from Excel"><div class="mh"><h3>Paste budget from Excel</h3><button type="button" class="x" data-act="pclose" aria-label="Close">✕</button></div>
    <p class="mut">Copy from Excel or Sheets and paste below: the category in column A, then a column for each month, Jan to Dec.</p>
    <textarea class="fld ta" data-paste rows="6" placeholder="Category&#9;Jan&#9;Feb&#9;Mar…&#10;Groceries&#9;1200&#9;1200&#9;1300…">${esc(S.paste.text)}</textarea>
    <div class="pm-prev">${pastePrev()}</div><div class="mf"><button type="button" class="btn ghost" data-act="pclose">Cancel</button><button type="button" class="btn pri" data-act="psave">Save targets</button></div></div></div>`;
}

/* ── Summary figures ──────────────────────────────────────── */
function totals(ms){
  const s=(rs,k)=>rs.reduce((a,r)=>a+r[k],0),inc=rowsFor(S.y,ms,true,false),exp=rowsFor(S.y,ms,false,false);
  return{ib:s(inc,'budget'),ia:s(inc,'actual'),eb:s(exp,'budget'),ea:s(exp,'actual')};
}
function summary(p){
  const st=p.kpiStyle;if(st==='none'||!hasData(S.y))return '';
  const yr=S.view==='annual',T=totals(yr?ALL12:[S.m]),nb=T.ib-T.eb,na=T.ia-T.ea,L=MON[S.m-1];
  const used=T.eb>0?Math.round(T.ea/T.eb*100):0,uc=used>=100?'bad':used>=80?'warn':'good';
  const live=!yr&&isCur(S.y,S.m),days=lastDay(S.y,S.m),pace=live&&p.kpiPace?T.ea/(TODAY.d/days):null;
  const paceTxt=pace===null?'':`On pace for ${m2(pace)} by ${L} ${days}${T.eb>0?(pace>T.eb?`, ${m2(pace-T.eb)} over`:`, ${m2(T.eb-pace)} under`):''}`;
  const kv=(label,val,sub,vc='',extra='')=>`<div class="kv ${extra}"><span class="kl">${label}</span><b class="kn val ${vc}">${val}</b><span class="ksub">${sub}</span></div>`;
  if(st==='cards'){
    const c=yr?[kv('Annual Income',m2(T.ib),`Actual: ${m2(T.ia)}`,'good'),kv('Annual Expenses',m2(T.eb),`Actual: ${m2(T.ea)}`),kv('Budget Used',`${used}%`,`<span class="${uc}">${m2(T.ea)} of ${m2(T.eb)}</span>`,uc),kv('Annual Net',sg(nb,m2),'',nb>=0?'acc':'bad')]
      :[kv(`Income — ${L}`,m2(T.ib),`Actual: ${m2(T.ia)}`,'good'),kv(`Expenses — ${L}`,m2(T.eb),`Actual: ${m2(T.ea)}${paceTxt?'<br>'+paceTxt:''}`),kv('Budget Used',`${used}%`,`<span class="${uc}">${m2(T.ea)} of ${m2(T.eb)}</span>`,uc),kv(`Net — ${L}`,sg(nb,m2),`Actual: ${sg(na,m2)}`,nb>=0?'acc':'bad')];
    return `<section class="kpis" data-region="round1">${c.map(x=>`<div class="sf cell">${x}</div>`).join('')}</section>`;
  }
  const over=T.ea>T.eb,lo=over?`${m2(T.ea-T.eb)} over`:`${m2(T.eb-T.ea)} left`,per=yr?`budgeted for ${S.y}`:'budgeted';
  if(st==='valfirst'){
    const c=[kv('Spent',m2(T.ea),`of ${m2(T.eb)} ${per}${paceTxt?'<br>'+paceTxt:''}`),kv(over?'Over budget':'Left to spend',m2(Math.abs(T.eb-T.ea)),`${used}% of the budget used`,over?'bad':''),kv('Income',m2(T.ia),`of ${m2(T.ib)} planned`,'good'),kv('Net',sg(na,m2),`planned ${sg(nb,m2)}`,na>=0?'good':'bad')];
    return `<section class="kpis vf" data-region="round1">${c.map(x=>`<div class="sf cell">${x}</div>`).join('')}</section>`;
  }
  if(st==='bar'){
    const r=flags({budget:T.eb,actual:T.ea,inc:false});
    return `<section class="sf sbar" data-region="round1"><div class="sb-l"><div class="big"><b class="val">${m2(T.ea)}</b><span>spent of ${m2(T.eb)} ${per}</span></div>${bar(r,p)}<span class="mut"><span class="${over?'bad':'good'}">${lo}</span>${paceTxt?' · '+paceTxt:''}</span></div>
      <div class="sb-r">${kv('Income',m2(T.ia),`of ${m2(T.ib)} planned`,'good','vf1')}${kv('Net',sg(na,m2),`planned ${sg(nb,m2)}`,na>=0?'good':'bad','vf1')}</div></section>`;
  }
  const open=yr?`In ${S.y} so far`:live?`So far in ${mlab(S.y,S.m)} (day ${TODAY.d} of ${days})`:`In ${mlab(S.y,S.m)}`;
  return `<section class="sf sent" data-region="round1"><p>${open}, <b>${m2(T.ia)}</b> came in against ${m2(T.ib)} planned, and <b>${m2(T.ea)}</b> went out against ${m2(T.eb)} ${per}: <b class="${over?'bad':'good'}">${lo}</b>. Net <b class="${na>=0?'good':'bad'}">${sg(na,m2)}</b>.${paceTxt?` ${paceTxt}.`:''}</p></section>`;
}

/* ── Header, period, buttons ──────────────────────────────── */
function viewTabs(p){
  const T=[['month','Month'],['annual','Annual']];if(p.editYear==='grid'&&p.yearBudget!=='switch')T.push(['edit','Edit Year']);
  const cur=S.view==='annual'&&S.yearEdit?'edit':S.view;
  return `<div class="und" role="group" aria-label="View">${T.map(([v,l])=>`<button type="button" data-view="${v}" class="${cur===v?'on':''}">${l}</button>`).join('')}</div>`;
}
const yearTabs=()=>`<div class="und yrs" role="group" aria-label="Year">${YEARS.map(y=>`<button type="button" data-year="${y}" class="${S.y===y?'on':''}">${y}</button>`).join('')}</div>`;
function stepBtns(dir){const yr=S.view==='annual';
  const dis=yr?(dir<0?S.y<=YEARS[0]:S.y>=YEARS[2]):(dir<0?S.y===YEARS[0]&&S.m===1:S.y===YEARS[2]&&S.m===12);
  return `<button type="button" ${yr?'data-ystep':'data-step'}="${dir}" aria-label="${dir<0?'Previous':'Next'} ${yr?'year':'month'}" ${dis?'disabled':''}>${dir<0?'‹':'›'}</button>`}
function picker(p){
  const yr=S.view==='annual';
  if(p.picker==='stepper')return `<div class="step">${stepBtns(-1)}<b>${yr?S.y:mlab(S.y,S.m)}</b>${stepBtns(1)}</div>`;
  if(p.picker==='dropdowns')return `<div class="dd"><select data-ysel aria-label="Year">${YEARS.map(y=>`<option value="${y}" ${y===S.y?'selected':''}>${y}</option>`).join('')}</select>${yr?'':`<select data-msel aria-label="Month">${MONL.map((l,i)=>`<option value="${i+1}" ${i+1===S.m?'selected':''}>${l}</option>`).join('')}</select>`}</div>`;
  return yr?'':`<div class="strip" role="group" aria-label="Month">${MON.map((l,i)=>`<button type="button" data-month="${i+1}" class="${i+1===S.m?'on':''}">${l}</button>`).join('')}</div>`;
}
function menuBtn(where,p){
  const it=[`<button type="button" data-act="copy">Copy budgets from ${S.y-1}</button>`,'<button type="button" data-act="paste">Paste from Excel</button>'];
  if(p.editYear==='grid'&&!(where==='year'&&S.yearEdit))it.push('<button type="button" data-act="yedit">Edit the whole year</button>');
  return `<div class="mw"><button type="button" class="btn icon" data-act="menu" data-where="${where}" aria-label="More budget actions" aria-expanded="${S.menu===where}">⋯</button>${S.menu===where?`<div class="menu" role="menu">${it.join('')}</div>`:''}</div>`;
}
function actionBtns(p,where){
  if(where==='month'){
    if(S.editing)return p.editMonth==='panel'?`<span class="note">Planning ${MON[S.m-1]} in the panel</span>`:`<button type="button" class="btn ghost" data-act="cancel">Cancel</button><button type="button" class="btn ok" data-act="save">Save</button>`;
    const edit=p.editMonth==='click'||!hasData(S.y)?'':`<button type="button" class="btn pri" data-act="edit">Edit ${MON[S.m-1]}</button>`;
    if(p.actions==='menu')return edit+menuBtn('month',p);
    return `<button type="button" class="btn" data-act="copy">Copy from ${S.y-1}</button>${edit}`;
  }
  if(S.yearEdit)return `<button type="button" class="btn ghost" data-act="ycancel">Cancel</button><button type="button" class="btn ok" data-act="ysave">Save Year</button>`;
  if(p.actions==='menu')return menuBtn('year',p);
  return `${hasData(S.y)?'':`<button type="button" class="btn" data-act="copy">Copy from ${S.y-1}</button>`}<button type="button" class="btn" data-act="paste">Paste from Excel</button>${p.editYear==='grid'?'<button type="button" class="btn" data-act="yedit">Edit Year</button>':''}`;
}
function pendBtns(label){const n=pendCount();return n?`<span class="note pn"><b>${n}</b> unsaved ${n===1?'change':'changes'}</span><button type="button" class="btn ghost" data-act="bcancel">Cancel</button><button type="button" class="btn ok" data-act="bsave">${label}</button>`:''}
function toolbar(p,where){
  const L=[],R=[],one=p.views==='one',batch=p.saveMode==='batch',grid=where==='year'&&S.yearEdit;
  const keys=`${where==='month'?'Tab moves down the column':'Tab moves right, then to the start of the next row'} · Enter ${p.enterKey==='down'?'moves down':'saves'}`;
  if(where==='month'){
    if(p.header==='current')L.push(picker(p));
    if(p.editMonth==='click')L.push(`<span class="note">Click a budget and type · ${keys}</span>`);
    else if(S.editing&&p.editMonth==='column')L.push(`<span class="note">Editing ${mlab(S.y,S.m)}</span>`);
  }else{
    if(p.yearBudget==='switch'&&p.editYear==='grid')L.push(`<div class="und sw" role="group" aria-label="Show in the grid"><button type="button" data-ymode="spent" class="${S.yearEdit?'':'on'}">Spent</button><button type="button" data-ymode="budget" class="${S.yearEdit?'on':''}">Budgets</button></div>`);
    if(grid)L.push(`<span class="note">${S.y} budgets${p.gridActual?' (grey: spent that month)':''} · ${keys}${batch?'':' · each cell saves as you leave it'}</span>`);
    else if(p.yearStyle==='heat')L.push(`<span class="note">${p.heatEdit==='edit'?'Click a month to change its budget · ':p.heatEdit==='panel'?'Click a month to open the category · ':''}White is on budget, green under, red over</span>`);
    else if(p.yearStyle==='ytd')L.push(`<span class="note">Through ${mlab(S.y,S.m)}</span>`);
    else L.push('<span class="note">Click any cell to edit inline · Enter to save</span>');
  }
  if(p.actions==='toolbar'||(where==='year'&&one)){
    const paste=p.pasteMode!=='cells'?'<button type="button" class="btn" data-act="paste">Paste from Excel</button>':'';
    if(batch)R.push(pendBtns(grid&&p.yearBudget==='tab'?'Save Year':'Save'));
    if(where==='month'){
      if(!(batch&&pendCount()))R.push(`<button type="button" class="btn" data-act="copy">Copy from ${S.y-1}</button>`);
      if(p.editMonth!=='click'&&hasData(S.y))R.push(S.editing?(p.editMonth==='panel'?'':'<button type="button" class="btn ghost" data-act="cancel">Cancel</button><button type="button" class="btn ok" data-act="save">Save</button>'):`<button type="button" class="btn pri" data-act="edit">Edit ${MON[S.m-1]}</button>`);
    }else if(grid){R.push(paste);if(p.yearBudget==='tab'&&!(batch&&pendCount()))R.push('<button type="button" class="btn pri" data-act="ydone">Done</button>')}
    else{if(!hasData(S.y))R.push(`<button type="button" class="btn" data-act="copy">Copy from ${S.y-1}</button>`);R.push(paste);if(p.editYear==='grid'&&p.yearBudget==='tab')R.push('<button type="button" class="btn" data-act="yedit">Edit Year</button>')}
  }
  if(!L.join('')&&!R.join(''))return '';
  return `<div class="tbar" data-region="${where==='year'?'year':'month'}"><div class="tl-l">${L.join('')}</div><div class="acts" data-region="sheet">${R.join('')}</div></div>`;
}
function header(p){
  const hw=S.view==='annual'&&p.views!=='one'?'year':'month';
  const acts=p.actions!=='toolbar'?`<div class="acts">${actionBtns(p,hw)}</div>`:'';
  const tabs=p.views==='one'?'':viewTabs(p),yt=p.header==='current'||p.picker==='strip'?yearTabs():'';
  if(p.header==='current')return `<header class="hdr sf cur" data-region="round1">${yt}<div class="hdr-r">${tabs}${acts}</div></header>`;
  const pk=picker(p);
  if(p.header==='bar')return `<header class="hdr sf" data-region="round1"><h1 class="sm">Budgets</h1><div class="hdr-r">${tabs}${p.picker==='strip'?yt:''}${pk}${acts}</div></header>`;
  const yr=S.view==='annual',st=p.picker==='stepper',h1=`<h1 class="mo">${yr?S.y:mlab(S.y,S.m)}</h1>`;
  let sub='No budgets set yet.';
  if(hasData(S.y)){const T=totals(yr?ALL12:[S.m]),over=T.ea>T.eb;sub=`${m2(T.ea)} spent${yr?' so far':''} of ${m2(T.eb)} budgeted${yr?' for the year':''} · <b class="${over?'bad':'good'}">${over?m2(T.ea-T.eb)+' over':m2(T.eb-T.ea)+' left'}</b>`}
  return `<header class="hdr open" data-region="round1"><div><p class="eyebrow">Budgets</p>${st?`<div class="step big">${stepBtns(-1)}${h1}${stepBtns(1)}</div>`:h1}<p class="sub">${sub}</p></div><div class="hdr-r">${tabs}${p.picker==='strip'?yt:''}${st?'':pk}${acts}</div></header>`;
}

/* ── Page ─────────────────────────────────────────────────── */
function monthCard(p){
  const one=p.views==='one',ed=S.editing&&p.editMonth==='column';
  const hint=ed&&p.hints!=='none'?`<div class="ehint"><i></i>${p.hints==='faint'?'Hint values are 3-month trailing averages. Leave blank or enter 0 to clear.':'The buttons under each field fill in last month\'s spending or the 3-month average.'}</div>`:'';
  let body;
  if(!hasData(S.y))body=emptyYear(p);
  else{const mi=monthItems(p);body=p.grouping==='tiles'?tilesHtml(p,mi):p.rowStyle==='twoline'?twoList(p,mi):tableHtml(p,mi)}
  return `<section class="sf card" data-region="month">${one?`<div class="card-h"><h2>${mlab(S.y,S.m)}</h2></div>`:''}${toolbar(p,'month')}${hint}${body}</section>`;
}
function yearCard(p){
  const one=p.views==='one',tb=toolbar(p,'year'),h=one?`<div class="card-h"><h2>${S.y}, month by month</h2></div>`:'';
  if(S.yearEdit&&p.editYear==='grid')return `<section class="sf card" data-region="sheet">${h}${tb}${editYearGrid(p)}</section>`;
  if(!hasData(S.y))return `<section class="sf card" data-region="year">${h}${tb}${one?'':emptyYear(p)}</section>`;
  const foot=p.yearStyle==='targets'?'<div class="foot">Actuals &amp; progress tracking are on the Dashboard.</div>':'';
  return `<section class="sf card" data-region="year">${h}${tb}${p.yearStyle==='ytd'?ytdHtml(p):yearGrid(p)}${foot}</section>`;
}
function side(main,p){
  const s=S.editing&&p.editMonth==='panel'&&S.view==='month'&&hasData(S.y)?editPanel(p):p.detail==='drawer'&&S.detail?`<aside class="drawer sf" data-region="sheet">${detailHtml(S.detail,p,'drawer')}</aside>`:'';
  return s?`<div class="withside">${main}${s}</div>`:main;
}
const nav=()=>`<nav class="appnav" data-region="decided"><div class="brand"><i>M</i><span>Moresheth</span></div><div class="nv">${NAV.map(l=>`<button type="button" tabindex="-1" class="${l==='Budgets'?'on':''}">${l}</button>`).join('')}</div></nav>`;
function page(p){
  if(p.views==='one')S.view='month';
  if(p.editYear!=='grid')S.yearEdit=false;
  if(p.editMonth==='click')S.editing=false;
  if(p.detail==='none'||p.detail==='link')S.detail=null;
  const main=p.views==='one'?side(monthCard(p),p)+yearCard(p):S.view==='annual'?side(yearCard(p),p):side(monthCard(p),p);
  return `<div class="app">${nav()}<div class="main">${header(p)}${summary(p)}${main}${S.toast?`<div class="toast" role="status">${esc(S.toast)}</div>`:''}</div>${pasteModal()}</div>`;
}

/* ── Actions on preview state ─────────────────────────────── */
function copyPrev(){
  const prev=S.y-1,pt=M0.d.targets[prev]||{};let n=0;
  Object.entries(pt).forEach(([c,ms])=>Object.entries(ms).forEach(([m,v])=>{if(v>0){setB(S.y,c,Number(m),v);n++}}));
  return n?`Copied from ${prev}`:`No targets found in ${prev}`;
}
function start(kind){
  const y=S.y,prev=y-1;
  if(kind==='copy')S.toast=copyPrev();
  else if(kind==='avg'){Object.entries(avgPlan(prev,fullMonths(prev))).forEach(([c,v])=>ALL12.forEach(m=>setB(y,c,m,v)));S.toast=`Budgets set from ${prev}'s average month`}
  else{S.blank[y]=true;S.toast=`${y} started empty`}
}

Gallery.define({
  id:'budgets-r2',
  name:'Budgets, round 2',
  fonts:['https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap'],
  groups:[
   {id:'year',label:'Year view: the heat map',open:true,controls:[
    {id:'heatScale',label:'Color scale',type:'choice',options:[
      {id:'smooth',label:'Smooth red, white, green',hint:'White on budget; deeper green the further under, deeper red the further over. Whole dollars, no percent.'},
      {id:'steps',label:'Four steps',hint:'White when close to budget, then light, medium and full color.'},
    ]},
    {id:'heatFull',label:'Full color at this far from budget',type:'slider',min:25,max:100,step:5,default:50,unit:'%'},
    {id:'heatNoBudget',label:'Spending with no budget',type:'choice',options:[
      {id:'none',label:'No color'},
      {id:'grey',label:'Grey'},
      {id:'red',label:'Red, like over budget'},
    ]},
    {id:'heatNow',label:'The current month',type:'choice',options:[
      {id:'full',label:'Against the whole month\'s budget',hint:'Early in a month most cells show green.'},
      {id:'pace',label:'Against the share of the month gone',hint:'On day 7 of 30, spending 23% of a budget shows white.'},
    ]},
    {id:'heatFuture',label:'Months to come',type:'choice',options:[
      {id:'grey',label:'Their budget, in grey'},
      {id:'blank',label:'Blank'},
    ]},
    {id:'heatEdit',label:'Clicking a month in the heat map',type:'choice',options:[
      {id:'edit',label:'Changes that month\'s budget in the cell',hint:'The cell shows the budget while you type, then goes back to the amount spent.'},
      {id:'panel',label:'Opens the category\'s side panel'},
      {id:'none',label:'Nothing; budgets change in Edit Year'},
    ]},
   ]},
   {id:'sheet',label:'Editing like a spreadsheet',open:true,controls:[
    {id:'cellLook',label:'How budget cells look',type:'choice',options:[
      {id:'plain',label:'Like the cells around them',hint:'An outline on hover; the selected cell gets a blue box.'},
      {id:'grid',label:'Faint gridlines around each one'},
      {id:'tint',label:'A light blue tint'},
    ]},
    {id:'enterKey',label:'Enter',type:'choice',options:[
      {id:'down',label:'Saves and moves down, like Excel'},
      {id:'stay',label:'Saves and stays'},
    ]},
    {id:'saveMode',label:'Saving',type:'choice',options:[
      {id:'cell',label:'Each cell saves as you leave it'},
      {id:'batch',label:'Save and Cancel for all changes; changed cells marked'},
    ]},
    {id:'pasteMode',label:'Pasting from Excel',type:'choice',options:[
      {id:'both',label:'Paste window, and straight into the cells'},
      {id:'cells',label:'Straight into the cells only',hint:'Copy a block in Excel, click the first cell, paste. The Paste from Excel button goes away.'},
      {id:'window',label:'Paste window only, as today'},
    ]},
    {id:'yearBudget',label:'Where the year\'s budgets are edited',type:'choice',options:[
      {id:'tab',label:'Edit Year tab, as picked'},
      {id:'switch',label:'Annual view switches between Spent and Budgets',hint:'No separate tab: the switch sits above the grid.'},
    ]},
    {id:'gridActual',label:'Each month\'s spending under its budget cell (Edit Year)',type:'toggle',default:true},
    {id:'drawerEdit',label:'The category\'s 12 monthly budgets in the side panel',type:'toggle',default:false},
   ]},
   {id:'month',label:'Month view',open:true,controls:[
    {id:'foldStart',label:'Top levels start',type:'choice',options:[
      {id:'closed',label:'Closed'},
      {id:'over',label:'Open when something inside is over budget'},
      {id:'open',label:'Open'},
    ]},
    {id:'selfName',label:'A top level\'s own budget row',type:'choice',options:[
      {id:'same',label:'Its own name again',hint:'Housing ▸ Housing, Utilities, HOA…'},
      {id:'general',label:'Called "General"',hint:'Housing ▸ General, Utilities, HOA…'},
    ]},
   ]},
   {id:'round1',label:'Decided in round 1',open:false,controls:[
    {id:'header',label:'Header',type:'choice',locked:true,options:[{id:'bar',label:'Slim bar, like the Dashboard'}]},
    {id:'views',label:'Month and year',type:'choice',locked:true,options:[{id:'tabs',label:'Separate Month and Annual views'}]},
    {id:'picker',label:'Picking the month',type:'choice',locked:true,options:[{id:'strip',label:'Row of months'}]},
    {id:'actions',label:'Copy, Edit, Paste from Excel, Edit Year',type:'choice',locked:true,options:[{id:'toolbar',label:'Buttons above the table'}]},
    {id:'kpiStyle',label:'Figures above the list',type:'choice',locked:true,options:[{id:'cards',label:'Four cards: the budget first, actual under it'}]},
    {id:'kpiPace',label:'"On pace for…" in the current month',type:'toggle',locked:true,default:false},
    {id:'grouping',label:'Top-level categories',type:'choice',locked:true,options:[{id:'fold',label:'One row per top level that opens'}]},
    {id:'rowStyle',label:'Row layout',type:'choice',locked:true,options:[{id:'table',label:'Table: actual with a small bar, budget, variance'}]},
    {id:'colOrder',label:'Column order',type:'choice',locked:true,options:[{id:'actual',label:'Actual, then budget'}]},
    {id:'varStyle',label:'Difference from budget',type:'choice',locked:true,options:[{id:'signed',label:'Signed: +$262 or −$4,970, green when good'}]},
    {id:'order',label:'Row order',type:'choice',locked:true,options:[{id:'spend',label:'Most spent first'}]},
    {id:'noBudget',label:'Spending with no budget',type:'choice',locked:true,options:[{id:'inline',label:'In its place in the list'}]},
    {id:'incomePlace',label:'Income and net',type:'choice',locked:true,options:[{id:'top',label:'Income first, then expenses, then net'}]},
    {id:'showEmpty',label:'Show categories with nothing this month',type:'toggle',locked:true,default:true},
    {id:'todayMark',label:"Today's mark on the bars (current month)",type:'toggle',locked:true,default:true},
    {id:'detail',label:'What a click opens',type:'choice',locked:true,options:[{id:'drawer',label:'Side panel: the year by month, then its transactions'}]},
    {id:'yearStyle',label:'Year grid',type:'choice',locked:true,options:[{id:'heat',label:'Heat map, simplified per your note'}]},
    {id:'editMonth',label:'Editing a month',type:'choice',locked:true,options:[{id:'click',label:'Click any budget to change it'}]},
    {id:'hints',label:'Hints while editing',type:'choice',locked:true,options:[{id:'none',label:'No hints'}]},
    {id:'editYear',label:'Editing the whole year',type:'choice',locked:true,options:[{id:'grid',label:'Edit Year grid, plus clicking a cell'}]},
    {id:'budgetLevel',label:'Where budgets are set',type:'choice',locked:true,options:[{id:'any',label:'On any category, as today'}]},
    {id:'newYear',label:'Starting 2027',type:'choice',locked:true,options:[{id:'copy',label:'Copy from 2026 button'}]},
   ]},
   {id:'decided',label:'Decided on earlier pages',open:false,controls:[
    {id:'scheme',label:'Color scheme',type:'choice',locked:true,options:[{id:'cloud',label:'Cloud',swatches:['#EEF2F7','#FFFFFF','#2563EB'],tokens:light('#EEF2F7','#FFFFFF','#F5F8FB','rgba(15,23,42,.1)','#0F172A','#475569','#6B7A8F')}]},
    {id:'accent',label:'Accent',type:'choice',locked:true,options:[{id:'blue',label:'Brand blue',tokens:{'--ac-l':'#2563EB'}}]},
    {id:'font',label:'Typeface',type:'choice',locked:true,options:[{id:'outfit',label:'Outfit + Plus Jakarta',tokens:{'--f-h':"'Outfit',system-ui,sans-serif",'--f-b':"'Plus Jakarta Sans',system-ui,sans-serif"}}]},
    {id:'surface',label:'Panels',type:'choice',locked:true,options:[{id:'hairline',label:'Hairline'}]},
    {id:'nav',label:'App navigation',type:'choice',locked:true,options:[{id:'top',label:'Top bar'}]},
    {id:'controls',label:'Period and view controls',type:'choice',locked:true,options:[{id:'underline',label:'Underlined text'}]},
    {id:'bars',label:'Budget bars',type:'choice',locked:true,options:[{id:'thick',label:'24px, label inside (decided 2026-07-27)'}]},
    {id:'barPalette',label:'Bar colors (Dashboard)',type:'choice',locked:true,options:[{id:'blue',label:'Blue, amber, red',swatches:['#2563EB','#F59E0B','#EF4444']}]},
    {id:'fill',label:'Fill strength (Dashboard)',type:'slider',locked:true,min:.2,max:1,step:.05,default:.5},
    {id:'radius',label:'Corner roundness',type:'slider',locked:true,min:4,max:22,step:1,default:13,unit:'px'},
    {id:'density',label:'Spacing',type:'slider',locked:true,min:.75,max:1.35,step:.05,default:1.25},
   ]},
  ],
  render(picks,d,h){init(d);LAST={d,h,picks};return page(picks)},
  after(root,picks){
    const app=root.querySelector('.app');if(!app)return;
    const stage=document.getElementById('stage'),p=picks;
    const rr=()=>{const top=stage?stage.scrollTop:0;root.innerHTML=Gallery.spec.render(picks,LAST.d,LAST.h);Gallery.spec.after(root,picks);if(stage)stage.scrollTop=top};
    const toast=t=>{S.toast=t;rr()};
    const setPeriod=(y,m)=>{if(y<YEARS[0]||y>YEARS[2])return;if(y!==S.y){S.editing=false;S.yearEdit=false}S.y=y;S.m=m;S.edits={};S.detail=null;S.inline=null;S.rowEd=null;rr()};
    const commit=i=>{const k=i.dataset.inl,m=Number(i.dataset.m);if(!S.inline||S.inline.k!==k||S.inline.m!==m)return;S.inline=null;const n=parseFloat(i.value);if(!isNaN(n)&&n>=0)setKey(k,S.y,m,n);rr()};
    const updPanel=()=>{const box=app.querySelector('.ep-tot');if(!box)return;let e=0,i=0;app.querySelectorAll('.ep input[data-ek]').forEach(x=>{const n=parseFloat(x.value)||0;if('inc' in x.dataset)i+=n;else e+=n});
      box.innerHTML=`<span>Spending budgets <b>${m2(e)}</b></span><span>Income planned <b>${m2(i)}</b></span><span>Leaves <b class="${i-e>=0?'good':'bad'}">${sg(i-e,m2)}</b></span>`};
    const act=(a,t)=>{
      if(a==='menu'){S.menu=S.menu===t.dataset.where?false:t.dataset.where;return rr()}
      S.menu=false;
      if(a==='edit'){S.editing=true;S.edits={};S.inline=null;if(p.editMonth==='panel'&&p.detail==='drawer')S.detail=null;return rr()}
      if(a==='cancel'){S.editing=false;S.edits={};return rr()}
      if(a==='save'){Object.entries(S.edits).forEach(([k,v])=>{const n=parseFloat(v);if(!isNaN(n)&&n>=0)setKey(k,S.y,S.m,n)});S.edits={};S.editing=false;return toast('Targets saved')}
      if(a==='copy')return toast(copyPrev());
      if(a==='paste'){S.paste={text:''};return rr()}
      if(a==='pclose'){S.paste=null;return rr()}
      if(a==='psave'){const{rows}=parsePaste(S.paste.text);let n=0;rows.forEach(r=>r.v.forEach((v,i)=>{if(v!=null){setB(S.y,r.cat,i+1,v);n++}}));S.paste=null;return toast(n?`Imported ${n} targets`:'Nothing to import')}
      if(a==='yedit'){if(p.views!=='one')S.view='annual';S.yearEdit=true;S.yedits={};S.detail=null;return rr()}
      if(a==='ycancel'){S.yearEdit=false;S.yedits={};return rr()}
      if(a==='ysave'){Object.entries(S.yedits).forEach(([km,v])=>{const i=km.lastIndexOf('|'),n=parseFloat(v);if(!isNaN(n)&&n>=0)setKey(km.slice(0,i),S.y,Number(km.slice(i+1)),n)});S.yedits={};S.yearEdit=false;return toast('Annual targets saved')}
      if(a==='dclose'){S.detail=null;return rr()}
      if(a==='rfcancel'){S.rowEd=null;return rr()}
      if(a==='rfsave'){const box=t.closest('.rowed'),k=box.dataset.rowedbox;box.querySelectorAll('[data-rf]').forEach(i=>{const n=parseFloat(i.value);if(!isNaN(n)&&n>=0)setKey(k,S.y,Number(i.dataset.rf),n)});S.rowEd=null;return toast('Saved')}
      if(a==='tolink')return toast('Would open Transactions with this category and period.');
      if(a==='bsave'){const n=pendCount();savePend();if(S.yearEdit&&p.yearBudget==='tab')S.yearEdit=false;return toast(`Saved ${n} ${n===1?'budget':'budgets'}`)}
      if(a==='bcancel'){clearPend();return toast('Changes discarded')}
      if(a==='ydone'){S.yearEdit=false;return rr()}
    };
    app.addEventListener('click',e=>{
      if(e.target.closest('input,select,textarea,label'))return;
      const t=e.target.closest('button,[data-det],[data-cell],[data-hcell]');
      if(S.menu&&!(t&&t.closest('.mw'))){S.menu=false;e.stopPropagation();return rr()}
      if(!t||t.disabled)return;
      e.stopPropagation();
      const D=t.dataset;
      if(D.view){S.detail=null;S.inline=null;S.rowEd=null;S.editing=false;if(D.view==='edit'){S.view='annual';S.yearEdit=true;S.yedits={}}else{S.view=D.view;S.yearEdit=false}return rr()}
      if(D.year)return setPeriod(Number(D.year),S.m);
      if(D.month)return setPeriod(S.y,Number(D.month));
      if(D.step){const[y,m]=shift(S.y,S.m,Number(D.step));return setPeriod(y,m)}
      if(D.ystep)return setPeriod(S.y+Number(D.ystep),S.m);
      if(D.fold){S.open[D.fold]=!t.classList.contains('on');return rr()}
      if(D.ymode){S.view='annual';S.yearEdit=D.ymode==='budget';S.detail=null;return rr()}
      if(D.hcell){S.detail=S.detail===D.hcell?null:D.hcell;return rr()}
      if(D.binl){S.inline={k:D.binl,m:S.m,w:'m'};return rr()}
      if(D.cell){S.inline={k:D.cell,m:Number(D.m),w:'y'};return rr()}
      if(D.rowed){S.rowEd=S.rowEd===D.rowed?null:D.rowed;S.inline=null;return rr()}
      if(D.chip){app.querySelectorAll('input[data-ek]').forEach(i=>{if(i.dataset.ek===D.chip){i.value=D.v;S.edits[D.chip]=D.v}});return updPanel()}
      if(D.fill){const box=t.closest('.rowed'),v=box.querySelector('[data-rfall]').value,from=D.fill==='all'?1:TODAY.m;box.querySelectorAll('[data-rf]').forEach(i=>{if(Number(i.dataset.rf)>=from)i.value=v});return}
      if(D.start){start(D.start);return rr()}
      if(D.det){
        const k=D.det,g=k.startsWith('g:'),n=g?k.slice(2):k;
        if(p.detail==='link')return toast(`Would open Transactions filtered to ${n}${g?' and its categories':''}, ${S.view==='annual'?S.y:mlab(S.y,S.m)}.`);
        if(p.detail==='none')return;
        S.detail=S.detail===k?null:k;if(S.detail&&p.detail==='drawer'&&p.editMonth==='panel')S.editing=false;return rr();
      }
      if(D.act)return act(D.act,t);
    });
    // ── Spreadsheet cells ──
    let moving=false;
    const kOf=i=>({g:i.dataset.g,k:i.dataset.sk,m:i.dataset.sm});
    const cellsIn=g=>[...app.querySelectorAll('input.sc')].filter(x=>x.dataset.g===g);
    const save=(k,m,n)=>(p.saveMode==='batch'?setPend:setB)(S.y,k,m,n);
    const commitCell=i=>{const raw=i.dataset.raw,v=i.value.trim();if(v===raw)return false;
      const t=v.replace(/[$,\s]/g,''),n=t===''?0:Number(t);
      if(!isFinite(n)||n<0){i.value=raw;return false}
      if(Math.abs(n-(parseFloat(raw)||0))<.005)return false;
      save(i.dataset.sk,Number(i.dataset.sm),n);return true};
    // Commit the cell being left, then select the next one (re-drawing first when totals changed).
    const go=(from,to)=>{
      if(commitCell(from)){S.focus=kOf(to||from);moving=true;rr();return}
      moving=true;if(to){from.classList.remove('on');from.value=from.dataset.show;to.focus()}else from.select();moving=false;
    };
    app.addEventListener('mousedown',e=>{const i=e.target;if(i.classList&&i.classList.contains('sc')&&document.activeElement!==i){e.preventDefault();i.focus()}});
    app.addEventListener('focusin',e=>{const i=e.target;if(!i.classList||!i.classList.contains('sc'))return;if(!i.classList.contains('on')){i.classList.add('on');i.value=i.dataset.raw}i.select()});
    app.addEventListener('paste',e=>{const i=e.target;if(!i.classList||!i.classList.contains('sc')||p.pasteMode==='window')return;
      const txt=(e.clipboardData||window.clipboardData).getData('text')||'';if(!/[\t\n]/.test(txt.trim()))return;
      e.preventDefault();
      const rows=[];cellsIn(i.dataset.g).forEach(c=>{if(!rows.length||rows[rows.length-1].k!==c.dataset.row)rows.push({k:c.dataset.row,c:[]});rows[rows.length-1].c.push(c)});
      const ri=rows.findIndex(r=>r.k===i.dataset.row),ci=rows[ri].c.indexOf(i);let n=0;
      txt.replace(/\r/g,'').replace(/\n+$/,'').split('\n').forEach((line,a)=>{const row=rows[ri+a];if(!row)return;
        line.split('\t').forEach((v,b)=>{const c=row.c[ci+b],t=v.replace(/[$,\s]/g,'');if(!c||t===''||t==='-'||t==='—')return;const x=Number(t);if(!isFinite(x))return;save(c.dataset.sk,Number(c.dataset.sm),Math.abs(x));n++})});
      S.focus=kOf(i);S.toast=n?`Pasted ${n} ${n===1?'cell':'cells'}`:'Nothing to paste';moving=true;rr();
    });
    app.addEventListener('keydown',e=>{
      const i=e.target;
      if(i.classList&&i.classList.contains('sc')){
        const L=cellsIn(i.dataset.g),ix=L.indexOf(i);
        const col=d=>{for(let j=ix+d;j>=0&&j<L.length;j+=d)if(L[j].dataset.col===i.dataset.col)return L[j];return null};
        const nb=d=>{const n=L[ix+d];return n&&n.dataset.row===i.dataset.row?n:null};
        if(e.key==='Tab'){e.preventDefault();return go(i,L[ix+(e.shiftKey?-1:1)]||null)}
        if(e.key==='Enter'){e.preventDefault();return go(i,p.enterKey==='down'?col(e.shiftKey?-1:1):null)}
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();return go(i,col(e.key==='ArrowDown'?1:-1))}
        const all=i.selectionStart===0&&i.selectionEnd===i.value.length;
        if(e.key==='ArrowRight'&&(all||i.selectionStart===i.value.length)){const n=nb(1);if(n){e.preventDefault();return go(i,n)}}
        if(e.key==='ArrowLeft'&&(all||i.selectionEnd===0)){const n=nb(-1);if(n){e.preventDefault();return go(i,n)}}
        if(e.key==='Escape'){e.preventDefault();i.value=i.dataset.raw;i.select()}
        return;
      }
      if(i.dataset&&i.dataset.inl!=null){if(e.key==='Enter'){e.preventDefault();commit(i)}else if(e.key==='Escape'){e.preventDefault();S.inline=null;rr()}return}
      if((e.key==='Enter'||e.key===' ')&&i.matches&&i.matches('[data-det],[data-cell],[data-hcell]')){e.preventDefault();i.click()}
    });
    app.addEventListener('focusout',e=>{const i=e.target;
      if(i.dataset&&i.dataset.inl!=null)return commit(i);
      if(moving||!i.classList||!i.classList.contains('sc')||!i.isConnected)return;
      const to=e.relatedTarget&&e.relatedTarget.classList&&e.relatedTarget.classList.contains('sc')?e.relatedTarget:null;
      i.classList.remove('on');
      if(!commitCell(i)){i.value=i.dataset.show;return}
      if(to){S.focus=kOf(to);moving=true;return rr()}
      // Left for something else (a button, the page): show the new figure now and redraw totals once the click is done.
      const b=getB(S.y,i.dataset.sk,Number(i.dataset.sm));i.dataset.raw=fv(b);if(!i.classList.contains('hc'))i.dataset.show=b?m0(b):'';i.value=i.dataset.show;i.classList.toggle('pend',p.saveMode==='batch');
      setTimeout(()=>{if(root.contains(i))rr()},250);
    });
    app.addEventListener('input',e=>{const i=e.target,D=i.dataset;
      if(D.ek!=null){S.edits[D.ek]=i.value;return updPanel()}
      if(D.yek!=null){S.yedits[D.yek+'|'+D.m]=i.value;return}
      if('paste' in D){S.paste.text=i.value;const b=app.querySelector('.pm-prev');if(b)b.innerHTML=pastePrev()}
    });
    app.addEventListener('change',e=>{const i=e.target,D=i.dataset;
      if('ysel' in D)return setPeriod(Number(i.value),S.m);
      if('msel' in D)return setPeriod(S.y,Number(i.value));
    });
    updPanel();
    const af=app.querySelector('[data-af]');if(af&&document.activeElement!==af){af.focus();try{af.select()}catch(_){}}
    clearTimeout(TT);if(S.toast)TT=setTimeout(()=>{S.toast='';rr()},2600);
    if(S.focus){const f=S.focus;S.focus=null;const t=[...app.querySelectorAll('input.sc')].find(x=>x.dataset.g===f.g&&x.dataset.sk===f.k&&x.dataset.sm===f.m);if(t)t.focus()}
  },
  css:`
#pv{--c-radius:13px;--c-density:1.25;--c-fill:.5;background:var(--bg);color:var(--tx);font-family:var(--f-b);font-size:14px;--p:calc(16px*var(--c-density));--gap:calc(12px*var(--c-density));--b-ok:var(--ac);--b-near:#F59E0B;--b-over:#EF4444}
#pv *{box-sizing:border-box}
#pv .sf{border-radius:var(--c-radius);background:var(--surface);border:1px solid var(--line)}
#pv button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
#pv button:disabled{opacity:.35;cursor:default}
#pv button:focus-visible,#pv select:focus-visible,#pv [role=button]:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#pv h1,#pv h2,#pv h3,#pv .val{font-family:var(--f-h)}
#pv h2{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);margin:0}
#pv h3{margin:0;font-size:18px;font-weight:600}
#pv .val{font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#pv .good{color:var(--good)}#pv .bad{color:var(--bad)}#pv .warn{color:var(--warn)}#pv .acc{color:var(--ac)}
#pv .mut{color:var(--tx3);font-size:11.5px}#pv .mut0{color:var(--tx3);opacity:.6}
#pv .link{color:var(--ac);font-size:12.5px;font-weight:500}
#pv .link:hover{text-decoration:underline}
#pv .app{display:flex;flex-direction:column;min-height:100vh;min-width:0;position:relative}
#pv .main{flex:1;min-width:0;width:100%;padding:calc(22px*var(--c-density)) calc(26px*var(--c-density));display:grid;gap:calc(18px*var(--c-density));align-content:start}
#pv section{min-width:0}
/* Top bar (decided) */
#pv .appnav{display:flex;align-items:center;gap:14px;background:var(--surface);border-bottom:1px solid var(--line);padding:8px 16px;min-width:0}
#pv .brand{display:flex;align-items:center;gap:9px;font-family:var(--f-h);font-weight:600;padding:0 5px;flex:none}
#pv .brand i{font-style:normal;width:30px;height:30px;border-radius:8px;background:var(--ac);color:var(--ac-fg);display:grid;place-items:center}
#pv .nv{display:flex;gap:2px;overflow-x:auto;min-width:0;scrollbar-width:none}
#pv .nv button{padding:7px 10px;border-radius:8px;color:var(--tx2);font-size:13.5px;white-space:nowrap}
#pv .nv button.on{background:var(--ac-soft);color:var(--ac);font-weight:600}
/* Header */
#pv .hdr{display:flex;justify-content:space-between;align-items:center;gap:12px 20px;flex-wrap:wrap}
#pv .hdr.sf{padding:10px 18px}
#pv .hdr.cur{padding:12px 22px}
#pv .hdr h1{margin:0;font-size:26px;font-weight:600;letter-spacing:-.4px}
#pv .hdr h1.sm{font-size:16px;font-weight:600;letter-spacing:0}
#pv .hdr h1.mo{font-size:30px}
#pv .hdr .sub{margin:4px 0 0;font-size:13.5px;color:var(--tx2)}
#pv .hdr .sub b{font-weight:600}
#pv .eyebrow{margin:0 0 2px;font-size:12.5px;color:var(--tx3)}
#pv .hdr.open{padding:2px 2px 0}
#pv .hdr-r{display:flex;align-items:center;gap:10px 18px;flex-wrap:wrap}
#pv .und{display:flex;gap:16px}
#pv .und button{padding:6px 0;border-bottom:2px solid transparent;color:var(--tx3);font-size:12.5px}
#pv .und button.on{color:var(--ac);border-color:var(--ac);font-weight:600}
#pv .hdr.cur .yrs button{font-size:14px;font-family:var(--f-h);font-weight:500}
#pv .hdr.cur .yrs button.on{font-weight:700}
#pv .dd{display:flex;gap:6px}
#pv .dd select{font:inherit;font-size:12.5px;padding:5px 8px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--tx)}
#pv .step{display:flex;align-items:center;gap:4px}
#pv .step b{font-family:var(--f-h);font-weight:500;font-size:14px;min-width:118px;text-align:center}
#pv .step button{width:28px;height:28px;border-radius:7px;border:1px solid var(--line);font-size:16px;line-height:1;color:var(--tx2)}
#pv .step button:not(:disabled):hover{border-color:var(--ac);color:var(--ac)}
#pv .step.big{gap:10px}#pv .step.big button{width:32px;height:32px;font-size:18px}
#pv .strip{display:flex;align-items:center;gap:2px;flex-wrap:wrap}
#pv .strip button{padding:6px 9px;min-width:40px;border-bottom:2px solid transparent;color:var(--tx3);font-size:13px;font-family:var(--f-h);font-weight:500}
#pv .strip button.on{color:var(--ac);border-color:var(--ac);font-weight:700}
#pv .hdr .strip button{padding:6px 5px;min-width:0;font-size:12.5px}
/* Buttons and menus */
#pv .acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#pv .btn{padding:6px 12px;border-radius:7px;border:1px solid var(--line);background:var(--surface);font-size:12.5px;font-weight:500;color:var(--tx);white-space:nowrap}
#pv .btn:hover{border-color:color-mix(in srgb,var(--ac) 45%,var(--line))}
#pv .btn.pri{background:var(--ac);border-color:var(--ac);color:var(--ac-fg)}
#pv .btn.ok{background:var(--good);border-color:var(--good);color:#fff}
#pv .btn.ghost{border-color:transparent;background:none;color:var(--tx2)}
#pv .btn.icon{padding:5px 11px;font-size:15px;line-height:1.1}
#pv .mw{position:relative}
#pv .menu{position:absolute;right:0;top:calc(100% + 6px);z-index:20;min-width:230px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.12);padding:6px;display:grid}
#pv .menu button{text-align:left;padding:8px 10px;border-radius:7px;font-size:13px}
#pv .menu button:hover{background:var(--raised)}
#pv .note{font-size:12px;color:var(--tx3);font-weight:500}
/* Summary figures */
#pv .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--gap)}
#pv .cell{padding:var(--p)}
#pv .kv{display:flex;flex-direction:column;gap:5px;min-width:0}
#pv .kl{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);order:0}
#pv .kn{font-size:22px;order:1;white-space:nowrap}
#pv .ksub{order:2;font-size:12px;color:var(--tx2);line-height:1.45}
#pv .kpis.vf .kl,#pv .vf1 .kl{order:2;font-weight:500;letter-spacing:.06em}
#pv .kpis.vf .ksub,#pv .vf1 .ksub{order:3}
#pv .kpis.vf .kn{font-size:24px;font-weight:600}
#pv .sbar{padding:var(--p) calc(var(--p)*1.2);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 44px;align-items:center}
#pv .sb-l{display:grid;gap:9px;min-width:0}
#pv .sbar .big{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
#pv .sbar .big .val{font-size:30px;font-weight:600}
#pv .sbar .big span{color:var(--tx2);font-size:13.5px}
#pv .sb-r{display:flex;gap:34px}
#pv .sb-r .kn{font-size:20px;font-weight:600}
#pv .sent{padding:var(--p) calc(var(--p)*1.2)}
#pv .sent p{margin:0;font-family:var(--f-h);font-size:17px;line-height:1.55;color:var(--tx2)}
#pv .sent b{color:var(--tx);font-weight:600}#pv .sent b.good{color:var(--good)}#pv .sent b.bad{color:var(--bad)}
@container pv (max-width:900px){#pv .sbar{grid-template-columns:minmax(0,1fr)}}
/* Cards and toolbars */
#pv .card{padding:0;overflow:hidden;container-type:inline-size}
#pv .card-h{padding:14px calc(var(--p)*1.1) 0}
#pv .tbar{display:flex;justify-content:space-between;align-items:center;gap:10px 16px;flex-wrap:wrap;padding:12px calc(var(--p)*1.1);border-bottom:1px solid var(--line);background:var(--raised)}
#pv .tl-l{display:flex;gap:10px 18px;align-items:center;flex-wrap:wrap;min-width:0}
#pv .ehint{display:flex;gap:8px;align-items:center;padding:10px calc(var(--p)*1.1);font-size:12px;color:var(--tx3);border-bottom:1px solid var(--line)}
#pv .ehint i{width:8px;height:8px;border-radius:50%;background:var(--ac);flex:none}
#pv .foot{padding:12px calc(var(--p)*1.1);font-size:12px;font-weight:500;color:var(--tx3);border-top:1px solid var(--line);background:var(--raised)}
#pv .empty{padding:60px;text-align:center;color:var(--tx3);font-size:15px}
/* Month list */
#pv .lst,#pv .tl-list{display:grid;min-width:0;--wn:150px;--wb:118px;--wab:196px;--wa:108px;--wv:118px;--wp:72px;--wbar:140px}
#pv[data-varStyle=words] .lst{--wv:156px}
@container (max-width:780px){#pv .lst{--wn:110px;--wb:100px;--wab:150px;--wa:92px;--wv:104px;--wp:60px;--wbar:90px}#pv[data-varStyle=words] .lst{--wv:132px}#pv .mb,#pv .mb-sp{width:48px}#pv .r{gap:9px}#pv .r .c{font-size:13px}}
#pv .r{display:grid;align-items:center;gap:12px;padding:calc(8px*var(--c-density)) calc(var(--p)*1.1);border-bottom:1px solid var(--line);min-width:0}
#pv .r.head{padding-top:10px;padding-bottom:10px;border-bottom-color:color-mix(in srgb,var(--tx) 16%,transparent)}
#pv .r.head>span{font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);font-family:var(--f-h)}
#pv .r .c{text-align:right;font-variant-numeric:tabular-nums;font-size:13.5px;min-width:0;font-weight:500}
#pv .r .c-bar{text-align:left}
#pv .r .c-budget{color:var(--tx2);font-weight:400}
#pv .r.click,#pv .tl.click,#pv .bti[data-det],#pv .bk2[data-det],#pv .yn.click{cursor:pointer}
#pv .r.click:hover,#pv .tl.click:hover{background:var(--raised)}
#pv .r.on,#pv .tl.on{background:var(--ac-soft)}
#pv .r.grp{background:var(--raised)}
#pv .r.grp .nm .tx,#pv .tl.grp .nm .tx{font-family:var(--f-h);font-weight:600;font-size:14.5px}
#pv .r.grp.on{background:var(--ac-soft)}
#pv .r.kid .nm{padding-left:24px}
#pv .r.kid .nm .tx{font-weight:400;color:var(--tx2)}
#pv .r.tot{background:var(--raised)}
#pv .r.tot .nm .tx,#pv .r.tot .c{font-weight:600}
#pv .r.net{border-top:3px solid var(--ac);background:var(--ac-soft);border-bottom:0}
#pv .r.net .nm .tx{font-weight:600}
#pv .nm{display:flex;align-items:center;gap:6px;min-width:0;font-size:14px;font-weight:500}
#pv .nm .tx{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .nm .pre{color:var(--tx3);font-weight:400}
#pv .car{width:20px;height:20px;border-radius:5px;color:var(--tx3);font-size:11px;transition:transform .15s;flex:none}
#pv .car:hover{background:var(--surface);color:var(--ac)}
#pv .car.on{transform:rotate(90deg)}
#pv .cnt{font-size:10.5px;color:var(--tx3);border:1px solid var(--line);border-radius:9px;padding:0 6px;font-family:var(--f-b);font-weight:500}
#pv .sec{padding:12px calc(var(--p)*1.1) 6px;font-size:10.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);border-bottom:1px solid var(--line);background:var(--surface)}
#pv .sec.sub{letter-spacing:.08em;color:var(--tx2);padding-top:18px}
#pv .ab{display:flex;align-items:center;justify-content:flex-end;gap:12px}
#pv .mb{width:80px;height:6px;border-radius:3px;background:var(--line);overflow:hidden;flex:none;display:block}
#pv .mb i{display:block;height:100%;background:var(--ac);border-radius:3px}
#pv .mb i.over{background:var(--bad)}#pv .mb i.inc{background:var(--good)}
#pv .mb-sp{width:80px;flex:none;display:block}
/* Budget bar (decided) */
#pv .bt{position:relative;height:24px;border-radius:6px;overflow:hidden;background:var(--line);border:1px solid var(--line);display:flex;align-items:center;justify-content:flex-end;padding:0 8px;min-width:0}
#pv .bt i{position:absolute;left:0;top:0;bottom:0;opacity:var(--c-fill);background:var(--b-ok)}
#pv .bt.near i{background:var(--b-near);opacity:min(1,calc(var(--c-fill) + .08))}
#pv .bt.over i{background:var(--b-over);opacity:min(1,calc(var(--c-fill) + .12))}
#pv .bt.inc i{background:var(--good);opacity:calc(var(--c-fill) - .1)}
#pv .bt s{position:absolute;top:0;bottom:0;width:1px;background:rgba(15,23,42,.16)}
#pv .bt s.td{width:2px;background:var(--tx);opacity:.75}
#pv .bt>span{position:relative;font-size:10.5px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums;white-space:nowrap}
#pv .bt>span.bad{color:var(--bad)}
#pv .bt>span.mut{font-weight:500;font-size:9.5px}
/* Fields */
#pv .fld{width:100%;max-width:112px;margin-left:auto;display:block;font:inherit;font-size:13px;padding:5px 8px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--tx);text-align:right;font-variant-numeric:tabular-nums}
#pv .fld:focus{outline:2px solid var(--ac);outline-offset:0;border-color:var(--ac)}
#pv .fld::placeholder{color:var(--tx3);opacity:.75}
#pv .chips{display:flex;gap:4px;justify-content:flex-end;margin-top:4px;flex-wrap:wrap}
#pv .chip{font-size:10.5px;padding:2px 7px;border-radius:9px;border:1px solid var(--line);color:var(--tx2);white-space:nowrap;font-variant-numeric:tabular-nums;background:var(--surface)}
#pv .chip:hover{border-color:var(--ac);color:var(--ac)}
#pv .bbtn{padding:3px 7px;margin:-3px -7px;border-radius:6px;font-variant-numeric:tabular-nums;border:1px dashed transparent}
#pv .bbtn:hover{background:var(--ac-soft);color:var(--ac);border-color:color-mix(in srgb,var(--ac) 40%,transparent)}
#pv .bbtn.empty{color:var(--tx3);font-size:12px}
/* Two-line rows */
#pv .tl-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));column-gap:30px;padding:0 calc(var(--p)*1.1) 10px}
#pv .tl-list>.sec,#pv .tl-list>.tl.grp,#pv .tl-list>.tl.tot,#pv .tl-list>.tl.net,#pv .tl-list>.det-inline{grid-column:1/-1}
#pv .tl-list>.sec{padding-left:0;padding-right:0;background:none}
#pv .tl{display:grid;gap:6px;padding:12px 4px;border-bottom:1px solid var(--line);min-width:0}
#pv .tl-h{display:flex;justify-content:space-between;gap:10px;align-items:center;min-width:0}
#pv .tl .ba{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;font-size:13.5px}
#pv .tl .sl{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
#pv .tl .sl .fld,#pv .bti .sl .fld{display:inline-block;margin:0;max-width:96px;padding:2px 7px;font-size:12px}
#pv .tl.kid .nm .tx{font-weight:500}
#pv .tl.tot,#pv .tl.net{background:var(--raised);padding:12px;margin:8px 0 0;border-radius:calc(var(--c-radius)*.6);border:0}
#pv .tl.net{background:var(--ac-soft);margin-top:6px}
/* Tiles (Dashboard) */
#pv .btot{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:var(--p) calc(var(--p)*1.1) 4px}
#pv .btot span:first-child{font-size:12.5px;color:var(--tx2)}
#pv .btot .val{font-size:22px}
#pv .inc-s{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:12px calc(var(--p)*1.1);border-bottom:1px solid var(--line);background:var(--raised);font-size:13px}
#pv .inc-s b{font-weight:600;font-variant-numeric:tabular-nums}
#pv .inc-s i{width:1px;height:14px;background:var(--line);margin:0 10px;align-self:center}
#pv .btiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:var(--gap);padding:var(--gap) calc(var(--p)*1.1) calc(var(--p)*1.1);align-items:start}
#pv .bti{padding:12px;border:1px solid var(--line);border-radius:calc(var(--c-radius)*.75);display:grid;gap:7px;background:var(--surface);min-width:0}
#pv .bti[data-det]:hover{border-color:color-mix(in srgb,var(--ac) 40%,var(--line))}
#pv .bti.on{border-color:var(--ac);background:var(--ac-soft)}
#pv .bti-h{display:flex;justify-content:space-between;gap:8px}
#pv .bti-h b{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .bti .ba{font-weight:600;font-size:13.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
#pv .bti .sl{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
#pv .btiles .det-inline{grid-column:1/-1;border:1px solid var(--line);border-radius:calc(var(--c-radius)*.75);overflow:hidden}
#pv .bk2s{display:grid;gap:2px;margin-top:4px;padding-top:8px;border-top:1px solid var(--line)}
#pv .bk2{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:2px 8px;align-items:center;padding:5px 6px;margin:0 -6px;border-radius:7px;font-size:12px}
#pv .bk2[data-det]:hover{background:var(--raised)}
#pv .bk2.on{background:var(--ac-soft)}
#pv .bk2>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tx2)}
#pv .bk2>b{font-weight:600;font-variant-numeric:tabular-nums}
#pv .bk2 small{font-size:10.5px;color:var(--tx3);white-space:nowrap;display:flex;gap:4px;align-items:center}
#pv .bk2 small .fld{max-width:76px;padding:1px 6px;font-size:11.5px;margin:0}
#pv .bk2.ed{grid-template-columns:minmax(0,1fr) auto}
#pv .bk2.ed small{grid-column:1/-1;justify-content:flex-end;flex-wrap:wrap}
#pv .bk2 .chips{margin:0}
#pv .bk2 small .bbtn{font-size:11px}
#pv .bk2-t{grid-column:1/-1;height:4px;border-radius:2px;background:var(--line);overflow:hidden;display:block}
#pv .bk2-t em{display:block;height:100%;background:var(--b-ok);opacity:calc(var(--c-fill) + .25)}
#pv .bk2-t.near em{background:var(--b-near)}#pv .bk2-t.over em{background:var(--b-over)}
/* Category detail */
#pv .det-h{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px calc(var(--p)*1.1);border-bottom:1px solid var(--line)}
#pv .det-h>div{display:flex;align-items:baseline;gap:6px 10px;flex-wrap:wrap;min-width:0}
#pv .det-h b{font-size:15px;font-weight:600}
#pv .det-h .val{font-size:15px;font-weight:600}
#pv .det-h>div>span:last-child{font-size:12px;font-weight:600}
#pv .x{width:28px;height:28px;border-radius:7px;color:var(--tx2);flex:none}
#pv .x:hover{background:var(--raised)}
#pv .det-k{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px calc(var(--p)*1.1);border-bottom:1px solid var(--line);font-size:12px;color:var(--tx3);background:var(--raised)}
#pv .det-k b{color:var(--tx);font-weight:600}
#pv .det-k em{font-style:normal;font-weight:600;color:var(--tx2);font-variant-numeric:tabular-nums}
#pv .det-k em.bad{color:var(--bad)}#pv .det-k em.good{color:var(--good)}
#pv .det-l{max-height:420px;overflow-y:auto}
#pv .dr{display:grid;grid-template-columns:50px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px calc(var(--p)*1.1);border-bottom:1px solid var(--line)}
#pv .rd{color:var(--tx3);font-size:12.5px;white-space:nowrap}
#pv .rn{min-width:0;display:grid;gap:2px}
#pv .rn b{font-weight:500;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .rn span{font-size:11.5px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pv .amt{font-weight:600;font-size:13.5px;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
#pv .more{padding:11px calc(var(--p)*1.1)}
#pv .pad{padding:16px calc(var(--p)*1.1);margin:0}#pv .pad.sm{padding-top:8px}
#pv .det-inline{background:var(--raised);border-bottom:1px solid var(--line);box-shadow:inset 3px 0 0 var(--ac);cursor:default}
#pv .withside{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,370px);gap:var(--gap);align-items:start}
#pv .withside:has(>.ep){grid-template-columns:minmax(0,1fr) minmax(340px,420px)}
#pv .drawer{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow-y:auto;cursor:default}
#pv .drawer .det-l{max-height:none}
#pv .drawer .dr{grid-template-columns:44px minmax(0,1fr) auto}
#pv .mc-w{padding:12px calc(var(--p)*1.1) 4px;border-bottom:1px solid var(--line)}
#pv .mc-l{display:flex;justify-content:space-between;font-size:11px;color:var(--tx3);margin-bottom:4px}
#pv .mc-l i{display:inline-block;width:10px;height:8px;border-radius:2px;background:color-mix(in srgb,var(--ac) 45%,transparent);margin:0 4px 0 10px}
#pv .mc-l i.lk-t{height:0;border-top:2px solid var(--tx);border-radius:0}
#pv .mc{display:block;width:100%;height:auto}
#pv .mcb{fill:color-mix(in srgb,var(--ac) 38%,transparent)}#pv .mcb.on{fill:var(--ac)}
#pv .mcb.over{fill:color-mix(in srgb,var(--b-over) 45%,transparent)}#pv .mcb.over.on{fill:var(--b-over)}
#pv .mct{stroke:var(--tx);stroke-width:1.6}
#pv .mcx{font-size:10px;fill:var(--tx3)}#pv .mcx.on{fill:var(--ac);font-weight:700}
@container pv (max-width:980px){#pv .withside{grid-template-columns:minmax(0,1fr)}#pv .drawer,#pv .ep{position:static;max-height:none}}
/* Plan panel */
#pv .ep{position:sticky;top:12px;display:flex;flex-direction:column;max-height:calc(100vh - 24px);overflow:hidden;cursor:default}
#pv .ep-h{padding:14px 16px 10px;display:grid;gap:3px;border-bottom:1px solid var(--line)}
#pv .ep-h b{font-family:var(--f-h);font-size:15px;font-weight:600}
#pv .ep-l{overflow-y:auto;flex:1;min-height:0}
#pv .ep-r{display:grid;grid-template-columns:minmax(0,1fr) 58px 58px 86px;gap:8px;align-items:center;padding:6px 16px;border-bottom:1px solid var(--line);font-size:12.5px}
#pv .ep-r.nh{grid-template-columns:minmax(0,1fr) 100px}
#pv .ep-r.hd{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);background:var(--raised)}
#pv .ep-r.hd span:not(:first-child),#pv .ep-r .hv{text-align:right}
#pv .ep-r .hv{color:var(--tx3);font-variant-numeric:tabular-nums;font-size:11.5px}
#pv .ep-r .chip{justify-self:end}
#pv .ep-r.kid .ep-n{padding-left:14px;color:var(--tx2)}
#pv .ep-n{line-height:1.3;overflow-wrap:anywhere}
#pv .ep-r .fld{padding:3px 7px;font-size:12.5px}
#pv .ep-g{padding:10px 16px 4px;font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--tx3)}
#pv .ep-t{padding:8px 16px 2px;font-family:var(--f-h);font-weight:600;font-size:13px}
#pv .ep-f{padding:12px 16px;border-top:1px solid var(--line);display:grid;gap:10px;background:var(--raised)}
#pv .ep-tot{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--tx2)}
#pv .ep-tot b{color:var(--tx);font-variant-numeric:tabular-nums}
#pv .ep-f .acts{justify-content:flex-end}
/* Year grid */
#pv .yscroll{overflow-x:auto}
#pv .yg{min-width:1120px}
#pv .yr{display:grid;grid-template-columns:minmax(170px,1.3fr) repeat(12,minmax(62px,1fr)) 96px;border-bottom:1px solid var(--line)}
#pv .yr>span{padding:9px 7px;text-align:right;font-variant-numeric:tabular-nums;font-size:12.5px;min-width:0;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:1px}
#pv .yr>.yn{text-align:left;align-items:stretch;position:sticky;left:0;background:var(--surface);z-index:1;padding-left:calc(var(--p)*1.1)}
#pv .yr .cur{background:color-mix(in srgb,var(--ac) 5%,transparent)}
#pv .yr .ytot{border-left:1px solid color-mix(in srgb,var(--tx) 14%,transparent);background:var(--raised);font-weight:600;flex-direction:row;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap}
#pv .yr .ytot small{flex-basis:100%;text-align:right}
#pv .yr.head>span{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);font-family:var(--f-h)}
#pv .yr.head .cur{color:var(--ac)}
#pv .yr small{font-size:10px;color:var(--tx3);font-weight:400}
#pv .yr b{font-weight:600}
#pv .yr.grp,#pv .yr.grp>.yn{background:var(--raised)}
#pv .yr.grp .nm .tx{font-family:var(--f-h);font-weight:600}
#pv .yr.kid .nm{padding-left:22px}#pv .yr.kid .nm .tx{font-weight:400;color:var(--tx2)}
#pv .yr.on,#pv .yr.on>.yn{background:var(--ac-solid)}
#pv .yr.tot,#pv .yr.tot>.yn{background:var(--raised);font-weight:600}
#pv .yr.net{border-top:2px solid color-mix(in srgb,var(--tx) 16%,transparent);background:var(--ac-soft)}
#pv .yr.net>.yn{background:var(--ac-solid);font-weight:700;font-family:var(--f-h)}
#pv .yc.ed{cursor:pointer}
#pv .yc.ed:hover{outline:1px solid color-mix(in srgb,var(--ac) 45%,transparent);outline-offset:-3px;border-radius:6px}
#pv .yc .plus{color:var(--tx3);opacity:.45;font-size:11px}
#pv .yc.fut{color:var(--tx3)}
#pv .yc.heat{border-radius:5px;margin:2px}
#pv .yc.heat b{font-size:12px}
#pv .yi{max-width:none;padding:4px 5px;font-size:11.5px}
#pv .act{font-size:9px;opacity:.85}
#pv .yr.edr>span{padding:4px 3px}
#pv .yr.edr.kid .yn{padding-left:calc(var(--p)*1.1 + 16px);color:var(--tx2)}
#pv .yr.edr .yn{font-size:12.5px;justify-content:center}
#pv .ysub{padding:9px calc(var(--p)*1.1) 3px;font-family:var(--f-h);font-weight:600;font-size:13px;border-bottom:1px solid var(--line);position:sticky;left:0}
#pv .pen{width:22px;height:22px;border-radius:6px;color:var(--tx3);font-size:12px}
#pv .pen:hover{background:var(--surface);color:var(--ac)}
#pv .rowed{padding:12px calc(var(--p)*1.1);background:var(--raised);border-bottom:1px solid var(--line);box-shadow:inset 3px 0 0 var(--ac);display:grid;gap:10px;position:sticky;left:0;max-width:100%}
#pv .rf-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#pv .rf-top label{display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--tx2)}
#pv .rf-top .fld{width:96px}
#pv .rf-ms{display:grid;grid-template-columns:repeat(12,minmax(58px,1fr));gap:6px}
#pv .rf-ms label{display:grid;gap:2px;font-size:10.5px;color:var(--tx3);text-align:right}
#pv .rf-ms .fld{max-width:none;padding:4px 6px;font-size:12px}
#pv .rf-f{display:flex;gap:8px;justify-content:flex-end}
/* Year to date */
#pv .ytd{min-width:980px}
#pv .ytd .r .c:last-child{text-align:left}
#pv .ytd .pen{margin-left:6px;vertical-align:middle}
#pv .marks{display:grid;grid-template-columns:repeat(12,1fr);gap:3px}
#pv .marks i{height:12px;border-radius:3px;background:var(--line)}
#pv .marks i.ok{background:color-mix(in srgb,var(--b-ok) 55%,transparent)}
#pv .marks i.near{background:var(--b-near)}#pv .marks i.over{background:var(--b-over)}
#pv .marks i.none{background:repeating-linear-gradient(135deg,var(--tx3) 0 2px,transparent 2px 4px);opacity:.5}
#pv .marks i.fut{background:none;border:1px dashed var(--line)}
/* New year */
#pv .start{padding:calc(var(--p)*1.4);display:grid;gap:16px}
#pv .start p{margin:4px 0 0;font-size:13px}
#pv .start-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--gap)}
#pv .sopt{text-align:left;padding:16px;border:1px solid var(--line);border-radius:calc(var(--c-radius)*.8);display:grid;gap:6px;align-content:start;background:var(--surface)}
#pv .sopt:hover{border-color:var(--ac);background:var(--ac-soft)}
#pv .sopt b{font-family:var(--f-h);font-size:15px;font-weight:600}
#pv .sopt span{font-size:12.5px;color:var(--tx2);line-height:1.45}
#pv .sopt em{font-style:normal;font-size:12px;color:var(--ac);font-weight:600;margin-top:4px}
/* Paste window, toast */
#pv .ov{position:absolute;inset:0;z-index:50;background:rgba(15,23,42,.32);display:flex;justify-content:center;align-items:flex-start;padding:70px 20px}
#pv .modal{position:sticky;top:40px;width:min(820px,100%);padding:20px 22px;display:grid;gap:12px;box-shadow:0 20px 60px rgba(15,23,42,.25)}
#pv .mh{display:flex;justify-content:space-between;align-items:center}
#pv .modal p{margin:0;font-size:13px}
#pv .ta{max-width:none;text-align:left;font-size:12.5px;resize:vertical;min-height:110px}
#pv .perr{padding:10px 14px;border:1px solid var(--bad);border-radius:10px;color:var(--bad);font-size:12.5px;background:color-mix(in srgb,var(--bad) 5%,transparent)}
#pv .pc{font-family:var(--f-h);font-size:13.5px}
#pv .pt{min-width:760px;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:6px}
#pv .ptr{display:grid;grid-template-columns:minmax(120px,1.4fr) repeat(12,minmax(44px,1fr));border-top:1px solid var(--line);font-size:11.5px}
#pv .ptr:first-child{border-top:0}
#pv .ptr span{padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums}
#pv .ptr span:first-child{text-align:left;font-weight:600}
#pv .ptr.hd{background:var(--raised);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3)}
#pv .mf{display:flex;justify-content:flex-end;gap:10px;margin-top:4px}
/* Round 2: spreadsheet cells */
#pv{--hr:#F8696B;--hg:#63BE7B;--hgrey:color-mix(in srgb,var(--tx3) 16%,var(--surface))}
#pv input.sc{display:block;width:100%;min-width:0;font:inherit;font-size:13px;font-variant-numeric:tabular-nums;text-align:right;color:var(--tx2);background:transparent;border:1px solid transparent;border-radius:4px;padding:3px 6px;margin:0;cursor:cell;caret-color:var(--ac)}
#pv input.sc::placeholder{color:var(--tx3);opacity:.55}
#pv input.sc:hover{border-color:color-mix(in srgb,var(--ac) 40%,transparent)}
#pv input.sc:focus{outline:2px solid var(--ac);outline-offset:-1px;border-color:transparent;background:var(--surface);color:var(--tx);cursor:text;box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 14%,transparent)}
#pv input.sc.pend{background:color-mix(in srgb,#F59E0B 13%,var(--surface));background-image:linear-gradient(225deg,#F59E0B 6px,transparent 6px)}
#pv[data-cellLook=grid] input.sc{border-color:color-mix(in srgb,var(--tx) 13%,transparent);border-radius:2px}
#pv[data-cellLook=tint] input.sc{background:color-mix(in srgb,var(--ac) 6%,transparent)}
#pv .r .c-budget input.sc{max-width:118px;margin-left:auto}
#pv .note.pn b{color:#B45309}
/* Round 2: heat map */
#pv .yr>span.yc.hm{margin:1px;border-radius:4px;padding:8px 6px;font-weight:500;color:var(--tx);justify-content:center;position:relative}
#pv .yr>span.yc.hm.fut{color:var(--tx3);font-weight:400;font-style:italic}
#pv .yr>span.yc.hm.cur{box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--ac) 55%,transparent)}
#pv .yr>span.yc.hm.ed{cursor:pointer}#pv .yr>span.yc.hm.ed:hover{box-shadow:inset 0 0 0 1.5px var(--ac)}
#pv .yr>span.ytot.hm{margin:1px;border-radius:4px;font-weight:600}
#pv .yc.hm input.sc.hc{color:inherit;font-weight:500;padding:2px 2px;font-size:12.5px}
#pv .yc.hm input.sc.hc:focus{font-weight:600}
#pv .yc.hm .cap{display:none;position:absolute;left:50%;bottom:calc(100% - 2px);transform:translateX(-50%);font-style:normal;font-size:10px;font-weight:600;background:var(--ac);color:#fff;padding:1px 6px;border-radius:4px;white-space:nowrap;z-index:3}
#pv .yc.hm:focus-within .cap{display:block}
#pv .yr.net>span.yc.hm b{font-weight:600}
#pv .und.sw{margin-right:6px}
/* Round 2: budget grid */
#pv .yr.sh>span.scw{padding:3px 3px;align-items:stretch}
#pv .yr.sh .act{font-size:10px;color:var(--tx3);text-align:right;padding-right:7px;white-space:nowrap;line-height:1.2}
#pv[data-cellLook=grid] .yr.sh>span.scw{padding:0}
#pv[data-cellLook=grid] .yr.sh input.sc{height:100%;min-height:30px}
#pv .yr.sh.kid .yn{padding-left:calc(var(--p)*1.1 + 16px);color:var(--tx2)}
#pv .yr.sh .yn,#pv .yr.shs .yn{font-size:13px;justify-content:center}
#pv .yr.shs{background:var(--raised)}#pv .yr.shs>.yn{background:var(--raised);font-family:var(--f-h);font-weight:600}
#pv .yr.shs>span{color:var(--tx2);font-weight:600}
#pv .yr.shs.tot{border-top:1px solid color-mix(in srgb,var(--tx) 16%,transparent)}
#pv .yr.sh .ytot,#pv .yr.shs .ytot{font-weight:600;color:var(--tx)}
/* Round 2: side panel budget row */
#pv .db{padding:10px calc(var(--p)*1.1) 12px;border-bottom:1px solid var(--line);display:grid;gap:6px}
#pv .db p{margin:0}
#pv .db-r{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px 6px}
#pv .db-c{display:grid;gap:1px;font-size:10px;color:var(--tx3);text-align:right}
#pv .db-c span{padding-right:7px}
#pv .db-c.cur span{color:var(--ac);font-weight:700}
#pv .db-c input.sc{font-size:12.5px;padding:3px 6px}
#pv[data-cellLook=plain] .db-c input.sc{border-color:var(--line)}
#pv .mb{position:relative;overflow:visible}
#pv .mb s{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:var(--tx);opacity:.7}
#pv .toast{position:sticky;bottom:18px;justify-self:center;background:var(--tx);color:var(--surface);padding:9px 16px;border-radius:9px;font-size:13px;z-index:60;max-width:90%;box-shadow:0 8px 24px rgba(15,23,42,.2)}
`
});
})();
