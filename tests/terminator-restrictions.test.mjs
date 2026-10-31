import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import astartes from '../shared/astartes-library.cjs';
import {augmentCustomizationRegistry} from '../shared/customization-catalog.mjs';
import {encodeRecipe,decodeRecipe} from '../shared/recipe-codec.mjs';
import {buildRecipe} from '../tools/build_from_recipe.mjs';
import {createAstartesFixture} from './fixtures/astartes-library.mjs';
const TERM='PVE_PVP_CHARACTER_MOD_1',TACTICAL='PVE_PVP_SOLDIER',BULWARK='PVE_PVP_TANK';
const local=(appearanceUid,team='LOYALIST')=>({team,scope:'local',appearanceUid,sourcePath:'customizationPresets.'+appearanceUid+'.bodySections.CHEST'});
const shared={team:'LOYALIST',scope:'shared',sourcePath:'sharedOutfitParts.outfitParts.CHEST'};
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-terminator-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const f=createAstartesFixture(dir);f.profile.id=TERM;f.profile.label='Terminator';
 f.option.id='astartes:chest_terminator_default';f.option.sourceOptionId='chest_terminator_default';f.option.label='Terminator chest';f.option.sourceDefinitions=[local(TERM),local(TERM,'CHAOS')];
 f.profile.initialSelection.CHEST=f.option.id;f.refreshManifest();
 return{...f,recipe:(classId=TERM,selection={CHEST:f.option.id})=>f.recipe(classId,selection)};
}
function gltf(file){const b=fs.readFileSync(file);return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)))}
function incompatible(error){assert.equal(error.code,'incompatible_body_frame');assert.match(error.message,/only available for the Terminator body frame/);assert.deepEqual(error.allowedClassIds,[TERM]);return true}

test('Terminator restriction follows exclusive Loyalist source ownership, not label or Tank constructor',()=>{
 const disguised={id:'astartes:left_gauntlet_mark8_deathwatch:79d01e81',label:'Mark8 Deathwatch',sourceAsset:'astartes_cc_sm_constructor_tank',sourceDefinitions:[local(TERM)]};
 assert.equal(astartes.isTerminatorOnlyOption(disguised),true);
 assert.equal(astartes.isTerminatorOnlyOption({...disguised,label:'Terminator',sourceDefinitions:[local(BULWARK)]}),false);
 assert.equal(astartes.isTerminatorOnlyOption({label:'Terminator',sourceAsset:disguised.sourceAsset}),false);
 assert.equal(astartes.isTerminatorOnlyOption({...disguised,sourceDefinitions:[local(TERM,'CHAOS')]}),false);
});
test('shared owners and explicit Loyalist shared definitions keep generic equipment global',()=>{
 const generic={sourceAsset:'astartes_cc_sm_constructor_tank',sourceDefinitions:[local(TERM),local(BULWARK)]};
 assert.equal(astartes.isTerminatorOnlyOption(generic),false);
 assert.equal(astartes.isTerminatorOnlyOption({...generic,sourceDefinitions:[local(TERM),shared]}),false);
 assert.equal(astartes.isTerminatorOnlyOption({...generic,sourceDefinitions:[shared]}),false);
});
test('registry filters exclusive parts before stripping provenance and preserves all identities/defaults without mutation',t=>{
 const f=fixture(t),lib=astartes.loadAstartesLibrary(f.dataRoot),beforeRegistry=structuredClone(f.registry),beforeLibrary=structuredClone(lib);
 const registry=augmentCustomizationRegistry(astartes.augmentAstartesRegistry(f.registry,lib));
 assert.deepEqual(f.registry,beforeRegistry);assert.deepEqual(lib,beforeLibrary);
 const frame=registry.classes.find(c=>c.id===TERM),native=registry.classes.find(c=>c.id===TACTICAL);
 assert.equal(frame.initialSelection.CHEST,f.option.id);assert.equal(frame.slots[0].options.find(o=>o.id===f.option.id).sourceDefinition,undefined);
 assert.equal(frame.slots[0].options.find(o=>o.id===f.option.id).sourceDefinitions,undefined);
 assert.deepEqual(frame.slots[0].options.find(o=>o.id===f.option.id).targetClassIds,[TERM]);
 assert.equal(native.slots[0].options.some(o=>o.id===f.option.id||o.forgeAstartes?.optionId===f.option.id),false);
 assert.equal(native.slots[0].options.some(o=>o.id==='chest_soldier_common_01'),true);
});
test('generic shared Tank-source equipment remains available on native and Terminator frames',t=>{
 const f=fixture(t);f.option.sourceDefinitions.push(local(BULWARK));f.refreshManifest();
 const registry=astartes.augmentAstartesRegistry(f.registry,astartes.loadAstartesLibrary(f.dataRoot));
 for(const id of [TACTICAL,TERM])assert.ok(registry.classes.find(c=>c.id===id).slots[0].options.some(o=>o.id===f.option.id));
});
test('unavailable Terminator choices retain their reason only on the Terminator frame',async t=>{
 const f=fixture(t),missing={id:'astartes:terminator_all_hidden',sourceOptionId:'terminator_all_hidden',slotId:'CHEST',label:'Unavailable source',geometryAvailable:false,geometryComplete:false,reason:'Unresolved original selector',missingSelectors:['missing_mesh'],sourceDefinitions:[local(TERM)]};
 f.catalog.unavailableOptions=[missing];f.refreshManifest();
 const lib=astartes.loadAstartesLibrary(f.dataRoot),registry=astartes.augmentAstartesRegistry(f.registry,lib),frame=registry.classes.find(c=>c.id===TERM),option=frame.slots[0].options.find(o=>o.id===missing.id);
 assert.equal(option.forgeUnavailable,true);assert.equal(option.reason,missing.reason);assert.deepEqual(option.targetClassIds,[TERM]);assert.equal(option.sourceDefinitions,undefined);
 assert.equal(registry.classes.find(c=>c.id===TACTICAL).slots[0].options.some(o=>o.id===missing.id),false);
 await assert.rejects(()=>buildRecipe(f.recipe(TERM,{CHEST:missing.id}),{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'unavailable')}),/source geometry is unavailable/);
});
test('empty source-defined Terminator backpack remains a valid exact default',t=>{
 const f=fixture(t),empty={...f.option,id:'astartes:backpack_terminator_default',sourceOptionId:'backpack_terminator_default',slotId:'BACKPACK',label:'Terminator backpack',meshes:[],resolvedMeshes:[],resolvedObjectIds:[]};
 f.catalog.options.push(empty);f.profile.initialSelection.BACKPACK=empty.id;f.refreshManifest();
 const registry=astartes.augmentAstartesRegistry(f.registry,astartes.loadAstartesLibrary(f.dataRoot)),frame=registry.classes.find(c=>c.id===TERM);
 assert.equal(frame.initialSelection.BACKPACK,empty.id);assert.equal(frame.slots.find(s=>s.id==='BACKPACK').options.find(o=>o.id===empty.id).forgeEmpty,true);
 assert.equal(registry.classes.find(c=>c.id===TACTICAL).slots.some(s=>s.options.some(o=>o.id===empty.id)),false);
});
test('archived source lookup diagnoses exact IDs and forge aliases without matching labels or unscoped guesses',t=>{
 const f=fixture(t),lib=astartes.loadAstartesLibrary(f.dataRoot),before=structuredClone(lib);
 assert.equal(astartes.restrictedPartSelection(lib,TERM,'CHEST',f.option.id),null);
 for(const id of [f.option.id,'forge:'+TERM+':'+f.option.id])assert.equal(astartes.restrictedPartSelection(lib,TACTICAL,'CHEST',id).id,f.option.id);
 for(const id of [f.option.sourceOptionId,'astartes:chest_terminator_default:badbadba'])assert.equal(astartes.restrictedPartSelection(lib,TACTICAL,'CHEST',id),null);
 assert.equal(astartes.restrictedPartSelection(lib,TACTICAL,'HELMET',f.option.id),null);assert.deepEqual(lib,before);
});
test('Terminator source outfit exports with its exact frame ID and verified geometry',async t=>{
 const f=fixture(t),out=path.join(f.dataRoot,'term-export'),r=await buildRecipe(f.recipe(),{dataRoot:f.dataRoot,out}),doc=gltf(path.join(out,r.files[0].file));
 assert.equal(doc.asset.extras.forgeBodyFrame.profileId,TERM);assert.deepEqual(doc.meshes.map(m=>m.name),['chaplain_chest']);assert.equal(r.recipe.soldiers[0].selection.CHEST,f.option.id);
});
test('native generic armour remains exportable on the Terminator frame',async t=>{
 const f=fixture(t),out=path.join(f.dataRoot,'term-native-export'),r=await buildRecipe(f.recipe(TERM,{CHEST:'chest_soldier_common_01'}),{dataRoot:f.dataRoot,out}),doc=gltf(path.join(out,r.files[0].file));
 assert.equal(doc.asset.extras.forgeBodyFrame.profileId,TERM);assert.deepEqual(doc.meshes.map(m=>m.name),['native_chest']);
});
test('archived IHF recipes cannot export exclusive Terminator armour on a native frame or silently replace it',async t=>{
 const f=fixture(t),archived=await decodeRecipe(await encodeRecipe(f.recipe(TACTICAL))),before=structuredClone(archived),out=path.join(f.dataRoot,'blocked-export');
 await assert.rejects(()=>buildRecipe(archived,{dataRoot:f.dataRoot,out}),incompatible);
 assert.deepEqual(archived,before);assert.deepEqual(fs.readdirSync(out),[]);assert.equal(archived.soldiers[0].selection.CHEST,f.option.id);
});
test('old forge aliases receive the same explicit export rejection on non-Terminator frames',async t=>{
 const f=fixture(t),selection={CHEST:'forge:'+TERM+':'+f.option.id};
 await assert.rejects(()=>buildRecipe(f.recipe(TACTICAL,selection),{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'alias-export')}),incompatible);
 assert.equal(selection.CHEST,'forge:'+TERM+':'+f.option.id);
});
test('restricted extra slots are rejected before unknown-slot fallback or partial preview filtering',async t=>{
 const f=fixture(t),extra={...f.option,id:'astartes:terminator_tabard',sourceOptionId:'terminator_tabard',slotId:'MODDED_SLOT_4'};f.catalog.options.push(extra);f.refreshManifest();
 const recipe=f.recipe(TACTICAL,{CHEST:'chest_soldier_common_01',MODDED_SLOT_4:extra.id});
 await assert.rejects(()=>buildRecipe(recipe,{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'extra-export'),onlySlots:['CHEST']}),incompatible);
});