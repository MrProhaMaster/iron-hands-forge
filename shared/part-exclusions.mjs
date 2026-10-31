/** User-curated part names. Source files remain intact; excluded choices are not selectable. */
import {optionLabel} from './ui-labels.mjs';
const EXCLUDED_NAME=/guardsman|astropath|com+issar/iu;
// The source labels this hidden-rarity item without a trailing "hidden" word.
const EXCLUDED_EXACT_NAMES=new Set(['chest custom carcharodons','chest custom carcharodons hidden','chest custom charcaradons hidden']);
export function partNameExclusion(option){
 const name=optionLabel(option).normalize('NFKC');
 const match=EXCLUDED_NAME.exec(name);
 if(match)return{name,matchedText:match[0].toLowerCase()};
 const normalized=name.trim().replace(/\s+/gu,' ').toLowerCase();
 return EXCLUDED_EXACT_NAMES.has(normalized)?{name,matchedText:normalized}:null;
}

/** Applied after all native, mod and cross-class choices have been assembled. */
export function excludeNamedParts(registry){
 for(const frame of registry.classes||[]){
  for(const slot of frame.slots||[]){
   const oldDefault=frame.initialSelection?.[slot.id];
   const removedDefault=slot.options.some(option=>option.id===oldDefault&&partNameExclusion(option));
   slot.options=slot.options.filter(option=>!partNameExclusion(option));
   if(removedDefault||!slot.options.length){
    const id='forge:none:'+slot.id;
    if(!slot.options.some(option=>option.id===id))slot.options.unshift({id,label:'Нет',meshes:[],resolvedMeshes:[],resolvedObjectIds:[],geometryAvailable:true,geometryComplete:true,resolutionStatus:'empty',forgeEmpty:true,isInitial:true,isDefault:true});
    (frame.initialSelection??={})[slot.id]=id;
    for(const option of slot.options)option.isInitial=option.id===id;
   }
  }
 }
 return registry;
}

/** Exact old source IDs still explain why an archived selection is rejected by export. */
export function excludedPartSelection(sourceRegistry,classId,slotId,optionId){
 if(typeof optionId!=='string')return null;
 const foreign=/^forge:([^:]+):(.+)$/u.exec(optionId);
 const sourceClassId=foreign?.[1]||classId,sourceId=foreign?.[2]||optionId;
 const frame=sourceRegistry.classes?.find(frame=>frame.id===sourceClassId);
 const option=frame?.slots?.find(slot=>slot.id===slotId)?.options.find(option=>option.id===sourceId);
 return option?partNameExclusion(option):null;
}