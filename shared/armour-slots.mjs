/** Astartes Full 15.2 armour-menu order, read across each source UI row.
 * Source: ssl/ui/assets/armor_customization/prefabs/ui_armor_slots.sso,
 * headers, UiGridSlot coordinates and bodySections (not a part-name heuristic).
 * Navigation only: recipe slot IDs, options and selections remain unchanged.
 */
export const ARMOUR_GROUPS=Object.freeze([
 {id:'helm',label:'Helm',slotIds:['HELMET']},
 {id:'accessories',label:'Accessories',slotIds:['MODDED_SLOT_1']},
 {id:'pauldrons',label:'Pauldrons',slotIds:['RIGHT_PAULDRON','LEFT_PAULDRON']},
 {id:'breastplate',label:'Breastplate',slotIds:['CHEST','BACKPACK']},
 {id:'cloak',label:'Cloak',slotIds:['MODDED_SLOT_2']},
 {id:'wargear',label:'Wargear',slotIds:['VANITY','VANITY_2','VANITY_3','CLOTH','COAT','HALO','ANTENNA','ASTARTES_EQUIPMENT']},
 {id:'head',label:'Head',slotIds:['MODDED_SLOT_3']},
 {id:'gauntlets',label:'Gauntlets',slotIds:['RIGHT_GAUNTLET','LEFT_GAUNTLET']},
 {id:'greaves',label:'Greaves',slotIds:['RIGHT_GREAVE','LEFT_GREAVE']},
 {id:'tabard',label:'Tabard',slotIds:['MODDED_SLOT_4']}
].map(g=>Object.freeze({...g,slotIds:Object.freeze(g.slotIds)})));
export function armourSlotGroups(slots=[]){
 const byId=new Map(slots.map(s=>[s.id,s])),used=new Set();
 const groups=ARMOUR_GROUPS.map(g=>({...g,slots:g.slotIds.filter(id=>byId.has(id)).map(id=>{used.add(id);return byId.get(id)})})).filter(g=>g.slots.length);
 const extra=slots.filter(s=>!used.has(s.id));if(extra.length)groups.push({id:'other-equipment',label:'Other equipment',slotIds:extra.map(s=>s.id),slots:extra});
 return groups;
}
