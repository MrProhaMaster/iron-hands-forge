import test from 'node:test';
import assert from 'node:assert/strict';
import {partNameExclusion,excludedPartSelection} from '../shared/part-exclusions.mjs';
import {augmentCustomizationRegistry} from '../shared/customization-catalog.mjs';
const part=(id,label,extra={})=>({id,label,meshes:[id],resolvedObjectIds:[id.length],geometryAvailable:true,geometryComplete:true,...extra});
const frame=(id,slots,initialSelection={})=>({id,tpl:'template_'+id,available:true,slots,initialSelection});
test('part-name policy matches requested fragments, casing and both commissar spellings',()=>{
 for(const name of ['Helmet GUARDSMAN 01','Head Astropath','Accessory comissar bionic','Helmet commissar','Backpack guardsmanlike 01','Ｈｅｌｍｅｔ ＧＵＡＲＤＳＭＡＮ 01'])assert.ok(partNameExclusion({id:'irrelevant',label:name}),name);
 for(const name of ['Helmet guard 01','Backpack tactical','Custom STL helmet','Comms accessory','Apothecary lens'])assert.equal(partNameExclusion({label:name}),null,name);
});
test('same visible name rules resolve numbered placeholders and foreign aliases',()=>{
 assert.ok(partNameExclusion({id:'helmet_guardsman_01',label:'Вариант 01'}));
 assert.ok(partNameExclusion({id:'astartes:unknown:abcd1234',label:'Shared variant 02',sourceOptionId:'accessory_astropath_hood'}));
 assert.ok(partNameExclusion({id:'forge:A:helmet_commissar',label:'Shared variant 03'}));
 assert.equal(partNameExclusion({id:'unrelated_guardsman_internal_id',label:'Tactical helmet'}),null,'a genuinely different display name is not filtered by a hidden ID alone');
});
test('all modules, unavailable imports and cross-class aliases are pruned without mutating sources',()=>{
 const safe=part('safe','Helmet tactical common 01');
 const input={classes:[frame('A',[{id:'HELMET',options:[safe,part('forbidden','Helmet guardsman 01'),part('missing','Helmet commissar',{forgeUnavailable:true,meshes:[],resolvedObjectIds:[]})]},{id:'BACKPACK',options:[part('astropath-pack','Astropath pack')]}],{HELMET:'safe',BACKPACK:'astropath-pack'}),frame('B',[{id:'HELMET',options:[part('native-b','Helmet sniper common 01'),part('alias','Helmet guardsman 01',{forgeCrossClass:{classId:'A',optionId:'forbidden'}})]}],{HELMET:'native-b'})]};
 const before=structuredClone(input),result=augmentCustomizationRegistry(input);
 assert.deepEqual(input,before);
 for(const c of result.classes)for(const slot of c.slots)assert(slot.options.every(option=>!partNameExclusion(option)));
 assert.equal(result.classes[0].initialSelection.HELMET,'safe');
 assert(result.classes[1].slots.find(s=>s.id==='HELMET').options.some(o=>o.id==='forge:A:safe'),'valid foreign parts remain');
 assert.equal(result.classes[0].initialSelection.BACKPACK,'forge:none:BACKPACK');
 assert(result.classes[0].slots.find(s=>s.id==='BACKPACK').options.find(o=>o.id==='forge:none:BACKPACK').forgeEmpty);
});
test('an excluded default becomes an explicit empty choice instead of a guessed replacement',()=>{
 const input={classes:[frame('A',[{id:'HELMET',options:[part('old','Helmet guardsman'),part('other','Helmet relic')]}],{HELMET:'old'})]};
 const result=augmentCustomizationRegistry(input),a=result.classes[0],none=a.slots[0].options.find(o=>o.id===a.initialSelection.HELMET);
 assert.equal(none.id,'forge:none:HELMET');assert.deepEqual(none.resolvedObjectIds,[]);assert.equal(none.isInitial,true);assert.equal(a.slots[0].options.find(o=>o.id==='other').isInitial,false);
});
test('safe default selections and nonmatching part records remain exact',()=>{
 const input={classes:[frame('A',[{id:'CHEST',options:[part('standard','Chest tactical'),part('old','Chest guardsman')]}],{CHEST:'standard'})]},before=structuredClone(input.classes[0].slots[0].options[0]);
 const result=augmentCustomizationRegistry(input);assert.deepEqual(result.classes[0].initialSelection,input.classes[0].initialSelection);assert.deepEqual(result.classes[0].slots[0].options,[before]);
});
test('old native, Astartes and cross-class removed selections retain an explicit rejection reason',()=>{
 const source={classes:[frame('A',[{id:'HELMET',options:[part('old','Helmet guardsman'),part('astartes:old:abcd1234','Helmet commissar'),part('safe','Tactical helmet')]}])]};
 assert.equal(excludedPartSelection(source,'A','HELMET','old').name,'Helmet guardsman');
 assert.equal(excludedPartSelection(source,'B','HELMET','forge:A:old').name,'Helmet guardsman');
 assert.equal(excludedPartSelection(source,'A','HELMET','astartes:old:abcd1234').name,'Helmet commissar');
 for(const [id,slot]of [['safe','HELMET'],['unknown_guardsman','HELMET'],['forge:missing:old','HELMET'],['old','CHEST']])assert.equal(excludedPartSelection(source,'A',slot,id),null);
});
test('the user-curated hidden Carcharodons chest is removed by its exact visible name',()=>{
 for(const label of ['Chest custom carcharodons','Chest custom carcharodons hidden','Chest custom charcaradons hidden',' CHEST  custom  Carcharodons '])assert.ok(partNameExclusion({label}),label);
 for(const label of ['Chest custom carcharodons relic','Left pauldron custom carcharodons','Helmet custom carcharodons'])assert.equal(partNameExclusion({label}),null,label);
 const source={classes:[frame('A',[{id:'CHEST',options:[part('astartes:chest_custom_carcharodons:2f3e8b2e','Chest custom carcharodons'),part('chest-standard','Chest common')]}],{CHEST:'chest-standard'})]};
 const result=augmentCustomizationRegistry(source);assert.deepEqual(result.classes[0].slots[0].options.map(o=>o.id),['chest-standard']);
 assert.equal(excludedPartSelection(source,'A','CHEST','astartes:chest_custom_carcharodons:2f3e8b2e').name,'Chest custom carcharodons');
});
