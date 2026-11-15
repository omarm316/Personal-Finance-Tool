// Checks the Budgets page's arithmetic (frontend/src/lib/budgetData.js) with
// made-up figures: totals, the Other row and the write rule. No database.
// Run: node docs/budget_model_check.mjs
import assert from 'node:assert/strict';
import {applyCells,buildModel,unitsFor,totalsFor,sx,heatBg} from '../frontend/src/lib/budgetData.js';

const cats=[
  {name:'Work',category_type:'income'},
  {name:'Groceries',category_type:'expense'},
  {name:'Housing',category_type:'expense'},
  {name:'Utilities',parent_category:'Housing',category_type:'expense'},
  {name:'Home Maintenance',parent_category:'Housing',category_type:'expense'},
  {name:'HOA',parent_category:'Housing',category_type:'expense'},
  {name:'Shopping',category_type:'expense'},
  {name:'Clothing',parent_category:'Shopping',category_type:'expense'},
  {name:'Other',category_type:'expense'},
  {name:'Sales',parent_category:'Other',category_type:'both'},
  {name:'Transfer',category_type:'both'},
  {name:'Unclassified',category_type:'both'},
];
const t=(o)=>Object.fromEntries(Object.entries(o).map(([c,v])=>[c,{10:{amount:v}}]));
let targets=t({Work:13800,Groceries:1200,Housing:1100,Utilities:400,'Home Maintenance':450,Clothing:200});
const actuals={Work:{10:28675},Groceries:{10:6720},Housing:{10:100},Utilities:{10:380},HOA:{10:250},Clothing:{10:90},Unclassified:{10:40},Transfer:{10:5000}};
let pass=0;const ok=(name,f)=>{f();pass++;console.log('ok  '+name);};

let M=buildModel(cats,targets,actuals);
ok('a top level reads its total; its own budget is Other',()=>{
  assert.equal(M.bOf('g:Housing',10),1950);
  assert.equal(M.bOf('o:Housing',10),1100);
  assert.equal(M.bOf('g:Shopping',10),200);
  assert.equal(M.bOf('o:Shopping',10),0);
});
ok('Other spends what is booked on the top level and in categories with no budget',()=>{
  assert.equal(M.aOf('o:Housing',10),350);   // Housing 100 + HOA 250 (no budget)
  assert.equal(M.aOf('g:Housing',10),730);   // everything once
});
ok('Unclassified counts as Other; Transfer is left out',()=>{
  assert.equal(M.aOf('g:Other',10),40);
  assert.ok(!M.tops(false).includes('Transfer'));
  assert.ok(!M.tops(false).includes('Unclassified'));
});
ok('the top level called Other gets an Other row too',()=>{
  const u=unitsFor(M,false,[10],'spend').find(x=>x.cat==='Other');
  assert.ok(u.isG&&u.kids[0].oth);
});
ok('Month order: most spent first, Other last, the Other row first in a group',()=>{
  const u=unitsFor(M,false,[10],'spend');
  assert.equal(u[0].cat,'Groceries');assert.equal(u[u.length-1].cat,'Other');
  const h=u.find(x=>x.cat==='Housing');assert.equal(h.kids[0].key,'o:Housing');assert.equal(h.kids[1].cat,'Utilities');
});
ok('totals add each top level once',()=>{
  const T=totalsFor(M,[10]);
  assert.equal(T.ib,13800);assert.equal(T.eb,1200+1950+200);assert.equal(T.ea,6720+730+90+40);
});
ok('typing a total sets Other to the total minus the categories',()=>{
  const r=applyCells(M,targets,[{k:'g:Housing',m:10,n:1000}]);
  assert.deepEqual(r.writes,[{category:'Housing',month:10,amount:150}]);
});
ok('a total below its categories leaves Other at zero (the total rises)',()=>{
  const r=applyCells(M,targets,[{k:'g:Housing',m:10,n:500}]);
  assert.equal(r.targets.Housing[10].amount,0);
  assert.equal(buildModel(cats,r.targets,actuals).bOf('g:Housing',10),850);
});
ok('changing a category takes from Other; the total stays',()=>{
  const r=applyCells(M,targets,[{k:'Utilities',m:10,n:600}]);
  assert.equal(r.targets.Housing[10].amount,900);
  assert.equal(buildModel(cats,r.targets,actuals).bOf('g:Housing',10),1950);
});
ok('past zero the total rises and Other stays at zero',()=>{
  const r=applyCells(M,targets,[{k:'Clothing',m:10,n:300}]);
  assert.equal(r.targets.Shopping?.[10]?.amount||0,0);
  assert.equal(buildModel(cats,r.targets,actuals).bOf('g:Shopping',10),300);
  assert.equal(r.writes.length,1);
});
ok('lowering a category gives the difference to Other',()=>{
  const r=applyCells(M,targets,[{k:'Clothing',m:10,n:50}]);
  assert.equal(r.targets.Shopping[10].amount,150);
});
ok('pasted cells apply in order',()=>{
  const r=applyCells(M,targets,[{k:'g:Housing',m:10,n:2000},{k:'Utilities',m:10,n:500}]);
  assert.equal(r.targets.Housing[10].amount,1050);  // 2000-850=1150, then 100 more to Utilities
  assert.equal(buildModel(cats,r.targets,actuals).bOf('g:Housing',10),2000);
});
ok('Other rows are never written',()=>{
  assert.equal(applyCells(M,targets,[{k:'o:Housing',m:10,n:5}]).writes.length,0);
});
ok('sheet numbers',()=>{
  assert.equal(sx(1200),'1,200');assert.equal(sx(-3303,{credit:true}),'+3,303');
  assert.equal(sx(0),'');assert.equal(sx(0,{zero:true}),'0');assert.equal(sx(-50,{signed:true}),'−50');
});
ok('heat colors: white on budget, red over, green under, red with no budget',()=>{
  assert.equal(heatBg(100,100,false),null);
  assert.match(heatBg(100,160,false),/--hr\) 80%/);
  assert.match(heatBg(100,70,false),/--hg\) 40%/);
  assert.match(heatBg(0,50,false),/--hr/);
  assert.match(heatBg(100,130,true),/--hg/);
});
console.log(`\n${pass} checks passed`);
