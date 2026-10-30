import test from 'node:test';
import assert from 'node:assert/strict';
import {armourSlotGroups,ARMOUR_GROUPS} from '../shared/armour-slots.mjs';
test('game armour order covers every native and imported slot once',()=>{
 const slots=ARMOUR_GROUPS.flatMap(g=>g.slotIds).reverse().map(id=>({id,options:[{id:id+'-sample'}]})),before=structuredClone(slots),groups=armourSlotGroups(slots);
 assert.deepEqual(groups.map(g=>g.label),['Helm','Pauldrons','Breastplate','Wargear','Gauntlets','Greaves','Accessories']);
 const flat=groups.flatMap(g=>g.slots);assert.equal(flat.length,21);assert.equal(new Set(flat.map(s=>s.id)).size,21);assert.deepEqual(slots,before);
 assert.equal(groups.find(g=>g.id==='pauldrons').slots[0],slots.find(s=>s.id==='LEFT_PAULDRON'));
});
test('partial frames omit absent groups and preserve future source slots',()=>{
 const slots=[{id:'NEW_SLOT',options:[]},{id:'CHEST',options:[]}],groups=armourSlotGroups(slots);
 assert.deepEqual(groups.map(g=>g.id),['breastplate','other-equipment']);assert.equal(groups[1].slots[0],slots[0]);assert.deepEqual(armourSlotGroups(),[]);
});
