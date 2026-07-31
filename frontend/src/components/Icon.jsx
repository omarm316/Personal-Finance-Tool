import {ICON_PATHS} from '../lib/constants';

export function Icon({name,size=16,style}){
  const p=ICON_PATHS[name]||'';
  return<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style} dangerouslySetInnerHTML={{__html:p}}/>;
}
