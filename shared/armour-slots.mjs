/** Game armour-menu order, with existing Astartes slots retained beneath it.
 * Primary reference: https://community.focus-entmt.com/focus-entertainment/space-marine-2/blogs/65-everything-you-need-to-know-about-the-customisation
 * This only groups navigation; recipe slot IDs and selections do not change.
 */
export const ARMOUR_GROUPS=Object.freeze([
 {id:'helm',label:'Helm',slotIds:['HELMET','MODDED_SLOT_3']},
 {id:'pauldrons',label:'Pauldrons',slotIds:['LEFT_PAULDRON','RIGHT_PAULDRON']},
 {id:'breastplate',label:'Breastplate',slotIds:['CHEST']},
 {id:'wargear',label:'Wargear',slotIds:['BACKPACK','VANITY','VANITY_2','VANITY_3','ASTARTES_EQUIPMENT']},
 {id:'gauntlets',label:'Gauntlets',slotIds:['LEFT_GAUNTLET','RIGHT_GAUNTLET']},
 {id:'greaves',label:'Greaves',slotIds:['LEFT_GREAVE','RIGHT_GREAVE']},
 {id:'accessories',label:'Accessories',slotIds:['MODDED_SLOT_1','MODDED_SLOT_2','MODDED_SLOT_4','CLOTH','COAT','HALO','ANTENNA']}
].map(g=>Object.freeze({...g,slotIds:Object.freeze(g.slotIds)})));
export function armourSlotGroups(slots=[]){
 const byId=new Map(slots.map(s=>[s.id,s])),used=new Set();
 const groups=ARMOUR_GROUPS.map(g=>({...g,slots:g.slotIds.filter(id=>byId.has(id)).map(id=>{used.add(id);return byId.get(id)})})).filter(g=>g.slots.length);
 const extra=slots.filter(s=>!used.has(s.id));if(extra.length)groups.push({id:'other-equipment',label:'Other equipment',slotIds:extra.map(s=>s.id),slots:extra});
 return groups;
}
