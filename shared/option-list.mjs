/** Name-based presentation only. Every original option stays valid for recipes and export. */
import {optionLabel} from './ui-labels.mjs';
export function optionNameKey(option){
 return optionLabel(option).normalize('NFKC').trim().replace(/[_\s]+/gu,' ').toLowerCase();
}
/** Call after eligibility/search/source filtering and before pagination. */
export function deduplicateOptionsByName(options,{selectedId}={}){
 const groups=new Map();
 for(const option of options){
  const name=optionNameKey(option),key=name||'unnamed:'+option.id;
  const current=groups.get(key);
  if(!current){groups.set(key,option);continue;}
  // Prefer a usable selected alias. A disabled import must not replace an available part.
  const available=!option.forgeUnavailable,wasAvailable=!current.forgeUnavailable;
  if(available&&!wasAvailable||available===wasAvailable&&option.id===selectedId&&current.id!==selectedId)groups.set(key,option);
 }
 return [...groups.values()];
}
