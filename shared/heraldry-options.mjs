/** Source-backed fixed heraldry selectors. Existing recipe decal IDs are unchanged. */
export const CHAPTER_SLOT='LEFT_PAULDRON';
export const COMPANY_SLOT='RIGHT_PAULDRON';
const rows=(values)=>Object.freeze(values.map(value=>Object.freeze(value)));
export const IRON_HANDS_CHAPTERS=rows([
 {id:'Left_Pau_Decal_Iron_Hands',label:'Iron Hands'},
 {id:'Left_Pau_Decal_IH_Brazen_Claws',label:'Brazen Claws'},
 {id:'Left_Pau_Decal_IH_Red_Talons',label:'Red Talons'},
 {id:'Left_Pau_Decal_IH_Sons_Of_Medusa',label:'Sons of Medusa'},
 {id:'Left_Pau_Decal_IH_Iron_Lords',label:'Iron Lords'}
]);
// Native catalogue order. Company numbers are deliberately not inferred from that order.
export const IRON_HANDS_COMPANIES=rows([
 {id:'Right_Pau_Decal_Iron_Hands_Clan_Avernii',label:'Clan Avernii'},
 {id:'Right_Pau_Decal_Iron_Hands_Clan_Garrsak',label:'Clan Garrsak'},
 {id:'Right_Pau_Decal_IH_Raukaan',label:'Clan Raukaan'},
 {id:'Right_Pau_Decal_IH_Kaargul',label:'Clan Kaargul'},
 {id:'Right_Pau_Decal_IH_Haarmek',label:'Clan Haarmek'},
 {id:'Right_Pau_Decal_IH_Sorrgol',label:'Clan Sorrgol'},
 {id:'Right_Pau_Decal_IH_Borrgos',label:'Clan Borrgos'},
 {id:'Right_Pau_Decal_IH_Morlaag',label:'Clan Morlaag'},
 {id:'Right_Pau_Decal_IH_Vurgaan',label:'Clan Vurgaan'},
 {id:'Right_Pau_Decal_IH_Dorrvok',label:'Clan Dorrvok'}
]);
export function heraldryOptions(decals=[]){
 if(!Array.isArray(decals))throw TypeError('Heraldry decals must be an array');
 const indexed=new Map();
 for(const decal of decals){if(!decal||typeof decal.id!=='string')continue;if(indexed.has(decal.id))throw Error('Duplicate heraldry decal ID: '+decal.id);indexed.set(decal.id,decal)}
 function group(slot,definitions){
  const options=[],missingIds=[];
  for(const definition of definitions){
   const source=indexed.get(definition.id);
   if(!source||source.section!==slot||!(source.colorsNumber>0)||!source.material||source.material==='default'){missingIds.push(definition.id);continue}
   options.push({...structuredClone(source),label:definition.label});
  }
  return{slot,options,complete:missingIds.length===0,missingIds};
 }
 return{chapter:group(CHAPTER_SLOT,IRON_HANDS_CHAPTERS),company:group(COMPANY_SLOT,IRON_HANDS_COMPANIES)};
}
/** A choice changes only its fixed shoulder; old imported decals elsewhere are retained. */
export function applyHeraldryChoice(appearance={},groupName,decalId,palette={},decals=[]){
 if(!['chapter','company'].includes(groupName))throw Error('Unknown heraldry group: '+groupName);
 const group=heraldryOptions(decals)[groupName],result=structuredClone(appearance??{});
 result.decals??={};
 if(decalId===null||decalId===undefined||decalId===''){delete result.decals[group.slot];return result}
 if(!group.options.some(option=>option.id===decalId))throw Error('Decal is not available for '+groupName+': '+decalId);
 const colors={};
 for(const key of ['color','secondaryColor','tertiaryColor'])if(palette[key]!==undefined){if(typeof palette[key]!=='string'||!/^#[a-f0-9]{6}$/i.test(palette[key]))throw Error('Invalid heraldry color: '+key);colors[key]=palette[key]}
 result.decals[group.slot]={...(result.decals[group.slot]||{}),id:decalId,...colors};return result;
}

/** UI eligibility from the selected source-declared decal meshes; export also validates UV0 and skinning. */
export function heraldryCompatibility(option,groupOrSlot){
 const slot=groupOrSlot==='chapter'?CHAPTER_SLOT:groupOrSlot==='company'?COMPANY_SLOT:groupOrSlot;
 if(![CHAPTER_SLOT,COMPANY_SLOT].includes(slot))throw Error('Unknown heraldry placement: '+groupOrSlot);
 const side=slot===CHAPTER_SLOT?'left':'right',title=slot===CHAPTER_SLOT?'Chapter':'Company';
 // These two source definitions name a left surface but bind default_ch_rpd (right) material.
 // Keep the armour selectable; do not substitute another side's UV/material projection.
 const sourceId=String(option?.sourceOptionId||option?.id||'').replace(/^astartes:/,'').replace(/:[a-f0-9]{8}$/i,'');
 const wrongSourceSide=option?.forgeAstartes&&slot===CHAPTER_SLOT&&['left_pauldron_custom_carcharodons_02','left_pauldron_custom_carcharodons_02_chain'].includes(sourceId);

 const fail=()=>({supported:false,carrierNames:[],reason:'Choose a blank '+side+' pauldron with an emblem area to use '+title+'.'});
 if(!option||option.forgeEmpty||option.forgeUnavailable||option.isAbleToApplyDecals===false||option.explicitlyDisallowed===true)return fail();
 if(wrongSourceSide)return fail();
 if(!option.forgeAstartes&&typeof option.forgeDecalSupport?.supported==='boolean')return option.forgeDecalSupport.supported?{supported:true,carrierNames:[...(option.forgeDecalSupport.carrierNames||[])],reason:''}:fail();
 const parts=option.components?.length?option.components:[option];
 const names=[...new Set(parts.flatMap(part=>[...(part.resolvedMeshes||[]),...(part.meshes||[])]))];
 const marker=slot===CHAPTER_SLOT?/(?:^|_)(?:l|left)(?:_|$)/i:/(?:^|_)(?:r|right)(?:_|$)/i;
 const carrierNames=names.filter(name=>typeof name==='string'&&/(?:shoulder|pauldron).*_decal$/i.test(name)&&marker.test(name));
 return carrierNames.length?{supported:true,carrierNames,reason:''}:fail();
}
