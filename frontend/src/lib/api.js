import {PAGES} from './constants';

export const API='/api';

export async function apiFetch(path,opts={}){
  const res=await fetch(API+path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});
  if(!res.ok){const text=await res.text();let msg=text;try{const j=JSON.parse(text);if(j.detail)msg=j.detail;}catch{}throw new Error(msg);}
  return res.json();
}

export function parseHash(){
  const raw=window.location.hash.slice(1)||'';
  const qi=raw.indexOf('?');
  const path=qi>=0?raw.slice(0,qi):raw;
  const search=qi>=0?raw.slice(qi+1):'';
  return{page:PAGES.includes(path)?path:'dashboard',params:new URLSearchParams(search)};
}

export function syncHashParams(newParams){
  const{page}=parseHash();
  const qs=new URLSearchParams(
    Object.fromEntries(Object.entries(newParams).filter(([,v])=>v!=null&&String(v)!==''))
  ).toString();
  window.history.replaceState(null,'','#'+page+(qs?'?'+qs:''));
}
