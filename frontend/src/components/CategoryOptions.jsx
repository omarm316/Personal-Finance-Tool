import {groupCats,topLevelOf} from '../lib/categories';

/* <option>s for a category <select>, grouped by top level. A top level with
   sub-categories becomes a group whose first option is the top level itself. */
export function CategoryOptions({categories}){
  return groupCats(categories).map(({top,children})=>children.length
    ?<optgroup key={top.id} label={top.name}>
      <option value={top.name}>{top.name}</option>
      {children.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
    </optgroup>
    :<option key={top.id} value={top.name}>{top.name}</option>);
}

/* A category name with its top level in front, muted: "Travel › Airlines" */
export function CatName({name}){
  const top=topLevelOf(name);
  return top&&top!==name?<><span style={{opacity:0.6}}>{top} › </span>{name}</>:<>{name}</>;
}
