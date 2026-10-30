import {excludeNamedParts} from './part-exclusions.mjs';
/** A class-independent view of the packaged, verified geometry catalogue.
 * Original option IDs stay valid. Foreign IDs explicitly retain their source class.
 * This is an authored assembly policy, not a copy of any game/mod executable.
 */
export function augmentCustomizationRegistry(registry){
 const result=structuredClone(registry);
 const classes=(registry.classes||[]).filter(c=>c.available&&c.tpl);
 const slots=new Map();
 for(const c of classes)for(const s of c.slots||[]){
  if(!slots.has(s.id))slots.set(s.id,{...structuredClone(s),options:[]});
 }
 for(const target of result.classes||[]){
  if(!target.available)continue;
  target.initialSelection??={};
  for(const [slotId,definition]of slots){
   let slot=target.slots.find(s=>s.id===slotId);
   if(!slot){
    const empty={id:'forge:none:'+slotId,label:'Нет',meshes:[],resolvedMeshes:[],resolvedObjectIds:[],geometryAvailable:true,geometryComplete:true,resolutionStatus:'empty',forgeEmpty:true};
    slot={...structuredClone(definition),options:[empty],forgeAddedSlot:true};
    target.slots.push(slot);target.initialSelection[slotId]=empty.id;
   }
   // An originally empty/unsupported slot must start empty after foreign options are added.
   if(!target.initialSelection[slotId]){
    const id='forge:none:'+slotId;
    if(!slot.options.some(o=>o.id===id))slot.options.unshift({id,label:'Нет',meshes:[],resolvedMeshes:[],resolvedObjectIds:[],geometryAvailable:true,geometryComplete:true,resolutionStatus:'empty',forgeEmpty:true});
    target.initialSelection[slotId]=id;
   }
   const ids=new Set(slot.options.map(o=>o.id));
   for(const source of classes){
    if(source.id===target.id)continue;
    const donor=source.slots.find(s=>s.id===slotId);if(!donor)continue;
    for(const option of donor.options){
     if(option.forgeCrossClass||option.forgeBionic||option.forgeAstartes||option.forgeEmpty)continue;
     if(ids.has(option.id))continue;
     if(!Array.isArray(option.meshes)||!option.meshes.length||!Array.isArray(option.resolvedObjectIds)||!option.resolvedObjectIds.length||option.geometryAvailable===false||option.geometryComplete===false)continue;
     const id='forge:'+source.id+':'+option.id;if(ids.has(id))continue;
     slot.options.push({...structuredClone(option),id,isInitial:false,isDefault:false,shared:true,sourceClassId:source.id,sourceAsset:source.tpl,sourceOptionId:option.id,sourceLabel:source.label||source.id,forgeCrossClass:{classId:source.id,asset:source.tpl,slotId,optionId:option.id}});
     ids.add(id);
    }
   }
  }
 }
 result.customization={version:1,policy:'cross-class-packaged-geometry',offline:true};
 return excludeNamedParts(result);
}
