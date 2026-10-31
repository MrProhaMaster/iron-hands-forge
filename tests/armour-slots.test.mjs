import test from 'node:test';
import assert from 'node:assert/strict';
import {armourSlotGroups} from '../shared/armour-slots.mjs';
const sourceSlots=['HELMET','BACKPACK','CHEST','LEFT_PAULDRON','RIGHT_PAULDRON','LEFT_GAUNTLET','RIGHT_GAUNTLET','LEFT_GREAVE','RIGHT_GREAVE','CLOTH','COAT','HALO','ANTENNA','VANITY','VANITY_2','VANITY_3','MODDED_SLOT_1','MODDED_SLOT_2','MODDED_SLOT_3','MODDED_SLOT_4','ASTARTES_EQUIPMENT'];
test('Astartes menu rows cover all existing slots once without changing records',()=>{
 const slots=sourceSlots.map(id=>({id,options:[{id:id+'-sample'}]})),before=structuredClone(slots),groups=armourSlotGroups(slots);
 assert.deepEqual(groups.map(g=>g.label),['Helm','Accessories','Pauldrons','Breastplate','Cloak','Wargear','Head','Gauntlets','Greaves','Tabard']);
 const flat=groups.flatMap(g=>g.slots);assert.equal(flat.length,21);assert.deepEqual(new Set(flat.map(s=>s.id)),new Set(sourceSlots));assert.deepEqual(slots,before);
 assert.equal(groups.find(g=>g.id==='pauldrons').slots[0],slots.find(s=>s.id==='RIGHT_PAULDRON'));
});
test('source bodySections place each mod slot and Wargear paginator in its actual section',()=>{
 const groups=armourSlotGroups(sourceSlots.map(id=>({id}))),group=id=>groups.find(g=>g.id===id).slots.map(s=>s.id);
 assert.deepEqual(group('accessories'),['MODDED_SLOT_1']);assert.deepEqual(group('cloak'),['MODDED_SLOT_2']);assert.deepEqual(group('head'),['MODDED_SLOT_3']);assert.deepEqual(group('tabard'),['MODDED_SLOT_4']);
 assert.deepEqual(group('breastplate'),['CHEST','BACKPACK']);
 assert.deepEqual(group('pauldrons'),['RIGHT_PAULDRON','LEFT_PAULDRON']);assert.deepEqual(group('gauntlets'),['RIGHT_GAUNTLET','LEFT_GAUNTLET']);assert.deepEqual(group('greaves'),['RIGHT_GREAVE','LEFT_GREAVE']);
 assert.deepEqual(group('wargear'),['VANITY','VANITY_2','VANITY_3','CLOTH','COAT','HALO','ANTENNA','ASTARTES_EQUIPMENT']);
});
test('partial frames omit absent groups and preserve future source slots',()=>{
 const slots=[{id:'NEW_SLOT',options:[]},{id:'CHEST',options:[]}],groups=armourSlotGroups(slots);
 assert.deepEqual(groups.map(g=>g.id),['breastplate','other-equipment']);assert.equal(groups[1].slots[0],slots[0]);assert.deepEqual(armourSlotGroups(),[]);
});
