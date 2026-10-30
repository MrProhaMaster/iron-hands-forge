import test from 'node:test';import assert from 'node:assert/strict';
import {bodyFrameTemplate} from '../shared/body-frame-template.mjs';
import {augmentCustomizationRegistry} from '../shared/customization-catalog.mjs';
const option=(id,ids=[])=>({id,meshes:ids.length?[id]:[],resolvedObjectIds:ids});
const previous={classId:'Apothecary',selection:{HELMET:'foreign-helmet',BACKPACK:'medical-arms',COAT:'old-cape'},paint:{armor:'#171b22',metal:'#aabbcc',lenses:'#ff0000'},appearance:{colors:{cloth:'#bb2233'},finish:{roughness:.55,metallic:false},parts:{HELMET:{armor:'#ffffff'}},decals:{LEFT_PAULDRON:{id:'old-carrier'}}}};
const native={id:'Tactical',initialSelection:{HELMET:'no-helmet',BACKPACK:'tactical-pack',COAT:'none'},slots:[{id:'HELMET',options:[option('no-helmet'),option('foreign-helmet',[9])]},{id:'BACKPACK',options:[option('tactical-pack',[1]),option('medical-arms',[5])]},{id:'COAT',options:[option('none'),option('old-cape',[7])]}]};
test('native class selection uses all own defaults even while old cross-class choices remain valid',()=>{
 const before=structuredClone(previous),frame=structuredClone(native),next=bodyFrameTemplate(native,previous);
 assert.deepEqual(next.selection,native.initialSelection);assert.equal(next.selection.HELMET,'no-helmet');assert.equal(next.selection.COAT,'none');assert.deepEqual(next.paint,previous.paint);assert.deepEqual(next.appearance.colors,previous.appearance.colors);assert.deepEqual(next.appearance.finish,previous.appearance.finish);assert.deepEqual(next.appearance.parts,{});assert.deepEqual(next.appearance.decals,{});assert.deepEqual(previous,before);assert.deepEqual(native,frame);
 next.selection.HELMET='mutated';assert.equal(native.initialSelection.HELMET,'no-helmet');
});
test('mod profiles retain their exact preset paint, appearance and distinctive equipment',()=>{
 const frame={...native,forgeBodyFrame:{profileId:'Apothecary'},initialSelection:{HELMET:'foreign-helmet',BACKPACK:'medical-arms',COAT:'old-cape'},initialPaint:{armor:'#ffffff'},initialAppearance:{colors:{cloth:'#cc0000'}}};
 const next=bodyFrameTemplate(frame,previous);assert.deepEqual(next.selection,frame.initialSelection);assert.equal(next.paint.armor,'#ffffff');assert.equal(next.paint.metal,previous.paint.metal);assert.deepEqual(next.appearance,frame.initialAppearance);next.appearance.colors.cloth='#111111';assert.equal(frame.initialAppearance.colors.cloth,'#cc0000');
});
test('missing native slot defaults get a neutral option rather than the first imported backpack',()=>{
 const input={classes:[{id:'Heavy',tpl:'heavy',available:true,initialSelection:{},slots:[{id:'BACKPACK',options:[{...option('astartes:raider-pack',[123]),forgeAstartes:{}}]}]},{id:'Raider',tpl:'raider',available:true,initialSelection:{BACKPACK:'raider-pack'},slots:[{id:'BACKPACK',options:[option('raider-pack',[222])]}]}]};
 const snapshot=structuredClone(input),registry=augmentCustomizationRegistry(input),heavy=registry.classes[0],selection=bodyFrameTemplate(heavy,previous).selection;
 assert.equal(selection.BACKPACK,'forge:none:BACKPACK');assert.equal(heavy.slots[0].options.find(o=>o.id===selection.BACKPACK).meshes.length,0);assert.ok(heavy.slots[0].options.some(o=>o.id==='astartes:raider-pack'),'manual cross-class choices still available');assert.deepEqual(input,snapshot);
});
test('invalid declared defaults fail explicitly instead of silently carrying the previous part',()=>{
 assert.throws(()=>bodyFrameTemplate({...native,initialSelection:{...native.initialSelection,HELMET:'missing'}},previous),/starting outfit is unavailable/);
 const blocked=structuredClone(native);blocked.slots[0].options[0].forgeUnavailable=true;assert.throws(()=>bodyFrameTemplate(blocked,previous),/starting outfit is unavailable/);
});
