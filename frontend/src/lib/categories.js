/* Omer's personal categories: a two-level tree (top level › sub-category).
   Rows store one name, the most specific one picked; the top level comes from
   the category list. App loads /api/categories and registers it here, so any
   component can label a name without the list being passed down. */
let _parents={};

export const setCategoryTree=cats=>{_parents=Object.fromEntries((cats||[]).map(c=>[c.name,c.parent_category||null]));};

export const topLevelOf=name=>(name&&_parents[name])||name;

/* "Travel › Airlines" for a sub-category, the name itself for a top level */
export const catLabel=name=>{const p=name&&_parents[name];return p?`${p} › ${name}`:(name||'');};

/* [{top, children}] in display order (the API already sorts by it) */
export const groupCats=cats=>{
  const groups=[],byTop={};
  (cats||[]).forEach(c=>{if(!c.parent_category){const g={top:c,children:[]};groups.push(g);byTop[c.name]=g;}});
  (cats||[]).forEach(c=>{if(c.parent_category){const g=byTop[c.parent_category];if(g)g.children.push(c);else groups.push({top:c,children:[]});}});
  return groups;
};
