import test from 'node:test';
import assert from 'node:assert/strict';
import {optionLabel} from '../shared/ui-labels.mjs';
import {optionNameKey,deduplicateOptionsByName} from '../shared/option-list.mjs';
const part=(id,label,extra={})=>({id,label,meshes:[id],resolvedObjectIds:[id.length],...extra});
test('duplicate names collapse even when sources and geometry IDs differ; different names stay',()=>{
 const rows=[part('native','Helmet soldier common 01'),part('astartes:helmet:abcd1234','helmet_soldier_common_01',{resolvedObjectIds:[999]}),part('custom','Helmet soldier common 02',{resolvedObjectIds:[6]})],before=structuredClone(rows);
 assert.deepEqual(deduplicateOptionsByName(rows).map(o=>o.id),['native','custom']);assert.deepEqual(rows,before);
 assert.notEqual(optionNameKey(rows[0]),optionNameKey(rows[2]));
});
test('name normalization handles case, spacing and Unicode presentation without combining numbered parts',()=>{
 assert.equal(optionNameKey(part('a','  ＨＥＬＭＥＴ   soldier_common 01 ')),optionNameKey(part('b','Helmet soldier common 01')));
 assert.notEqual(optionNameKey(part('a','Helmet 01')),optionNameKey(part('b','Helmet 02')));
});
test('numbered placeholders resolve to real part names before grouping and remain distinct across classes',()=>{
 const rows=[part('helmet_soldier_common_01','Вариант 02'),part('foreign','Variant 02',{sourceOptionId:'helmet_sniper_non_set_02'}),part('astartes:helmet_soldier_common_01:abcd1234','Helmet soldier common 01')];
 assert.equal(optionLabel(rows[0]),'Helmet soldier common 01');assert.equal(optionLabel(rows[1]),'Helmet sniper non set 02');assert.equal(deduplicateOptionsByName(rows).length,2);
 assert.equal(optionLabel(part('forge:PVE_PVP_SOLDIER:helmet_soldier_common_01','Shared variant 12')),'Helmet soldier common 01');
 assert.equal(optionLabel({label:'Variant 01'}),'Variant 01');
});
test('an existing selected alias remains the visible representative without changing name order or IDs',()=>{
 const rows=[part('first','Chest common 01'),part('middle','Chest relic 02'),part('last','Chest common 01')];
 const visible=deduplicateOptionsByName(rows,{selectedId:'last'});assert.deepEqual(visible.map(o=>o.id),['last','middle']);assert.equal(visible[0],rows[2]);
});
test('available copies take priority over disabled imports, while disabled-only names keep their reason',()=>{
 const disabled=part('missing','Helmet common 01',{forgeUnavailable:true,reason:'Native source absent'}),available=part('complete','Helmet common 01'),unique=part('only-missing','Helmet rare 02',{forgeUnavailable:true,reason:'Other source absent'});
 assert.deepEqual(deduplicateOptionsByName([disabled,available,unique],{selectedId:disabled.id}),[available,unique]);
 assert.deepEqual(deduplicateOptionsByName([disabled,unique]),[disabled,unique]);
});
test('source and old-ID searches may choose their matching alias when filtering is applied first',()=>{
 const native=part('native','Helmet common 01'),mod=part('astartes:helmet_common_01:abcd1234','Helmet common 01',{forgeAstartes:{}}),rows=[native,mod];
 assert.deepEqual(deduplicateOptionsByName(rows.filter(o=>o.forgeAstartes),{selectedId:'native'}),[mod]);
 assert.deepEqual(deduplicateOptionsByName(rows.filter(o=>o.id===mod.id)),[mod]);
});
test('every armour module uses the same name rule and empty labels remain readable',()=>{
 for(const prefix of ['helmet','chest','left_pauldron','right_gauntlet','backpack','cape','tabard','accessory']){
  const label=prefix.replaceAll('_',' ')+' 01';assert.equal(deduplicateOptionsByName([part(prefix,label),part('copy-'+prefix,label)]).length,1);
 }
 assert.equal(deduplicateOptionsByName([part('a','Нет'),part('b','None')]).length,1);
 assert.equal(optionLabel('Без шлема'),'No helmet');
});
