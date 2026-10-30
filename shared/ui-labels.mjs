/** English display labels. Stored choices, canonical IDs and custom names stay unchanged. */
const classes=Object.freeze({PVE_PVP_SOLDIER:'Tactical',PVE_PVP_SNIPER:'Sniper',PVE_PVP_SUPPORT:'Heavy',PVE_PVP_RAIDER:'Assault',PVE_PVP_TANK:'Bulwark',PVE_PVP_BERSERK:'Vanguard',PVE_PVP_ENGINEER:'Techmarine',PVE_PVP_MEDIC:'Medic',PVE_PVP_CHARACTER_MOD_1:'Terminator',PVE_PVP_CHARACTER_MOD_2:'Chaplain',PVE_PVP_CHARACTER_MOD_3:'Apothecary'});
const slots=Object.freeze({HELMET:'Helmet',BACKPACK:'Backpack',CHEST:'Chest',LEFT_PAULDRON:'Left pauldron',RIGHT_PAULDRON:'Right pauldron',LEFT_GAUNTLET:'Left gauntlet',RIGHT_GAUNTLET:'Right gauntlet',LEFT_GREAVE:'Left greave',RIGHT_GREAVE:'Right greave',CLOTH:'Cloth',COAT:'Coat',HALO:'Halo',ANTENNA:'Antenna',VANITY:'Accessory',VANITY_2:'Accessory 2',VANITY_3:'Servo-arm',MODDED_SLOT_1:'Accessories',MODDED_SLOT_2:'Capes',MODDED_SLOT_3:'Heads',MODDED_SLOT_4:'Tabards & cloth',ASTARTES_EQUIPMENT:'Class equipment'});
const defaultRoles=Object.freeze({'Сержант':'Sergeant','Стрелок':'Rifleman','Связист':'Comms specialist','Штурмовик':'Assault','Ветеран':'Veteran'});
export function classLabel(id,fallback=''){return Object.hasOwn(classes,id)?classes[id]:fallback||id}
export function slotLabel(id,fallback=''){return Object.hasOwn(slots,id)?slots[id]:fallback||id}
export function roleLabel(value){return Object.hasOwn(defaultRoles,value)?defaultRoles[value]:value}
export function optionLabel(option){
 let value=typeof option==='string'?option:option?.label??option?.id??'';
 // Numbered import placeholders are not names: different parts can share the number.
 if(typeof option==='object'&&option&&/^(?:(?:Shared variant|Variant)|(?:Общий вариант|Вариант))\s+\d+$/iu.test(value.trim())){
  const source=option.sourceOptionId||option.forgeCrossClass?.optionId||option.id;
  if(typeof source==='string'&&source){
   const name=source.replace(/^astartes:/,'').replace(/:[a-f0-9]{8}$/i,'').replace(/^forge:[^:]+:/,'').replaceAll('_',' ').trim();
   if(name)value=name.charAt(0).toUpperCase()+name.slice(1);
  }
 }
 if(value==='Без шлема')return 'No helmet';
 if(value==='Без детали')return 'None';
 if(value==='Нет')return 'None';
 return value.replace(/^Общий вариант(?=\s|$)/u,'Shared variant').replace(/^Вариант(?=\s|$)/u,'Variant');
}
