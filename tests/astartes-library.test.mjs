import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import astartes from '../shared/astartes-library.cjs';
import {augmentCustomizationRegistry} from '../shared/customization-catalog.mjs';
import {buildRecipe} from '../tools/build_from_recipe.mjs';
import {createAstartesFixture,fixtureGLB} from './fixtures/astartes-library.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-astartes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return createAstartesFixture(dir)}
function gltf(file){const b=fs.readFileSync(file);return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)))}
test('Astartes subset is optional, while partial prepared directories are errors',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-astartes-absent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.equal(astartes.loadAstartesLibrary(dir).ready,false);fs.mkdirSync(path.join(dir,astartes.DIRECTORY),{recursive:true});assert.throws(()=>astartes.loadAstartesLibrary(dir),/manifest is missing/);
});
test('Astartes manifest verifies payload hashes and refuses unvalidated geometry',t=>{
 const f=fixture(t),lib=astartes.loadAstartesLibrary(f.dataRoot);assert.equal(lib.ready,true);assert.equal(lib.profiles[0].id,f.profile.id);
 f.catalog.models[0].validation.restSkin='pending';f.refreshManifest();assert.throws(()=>astartes.loadAstartesLibrary(f.dataRoot),/validation has not passed/);
 f.catalog.models[0].validation.restSkin='passed';f.refreshManifest();fs.appendFileSync(path.join(f.dataRoot,f.model.glb),'x');assert.throws(()=>astartes.loadAstartesLibrary(f.dataRoot),/size mismatch/);
});
test('body frames preserve native IDs, use real geometry defaults and never mutate input',t=>{
 const f=fixture(t),before=structuredClone(f.registry),lib=astartes.loadAstartesLibrary(f.dataRoot),registry=augmentCustomizationRegistry(astartes.augmentAstartesRegistry(f.registry,lib));
 assert.deepEqual(f.registry,before);
 const native=registry.classes[0],frame=registry.classes.find(c=>c.id===f.profile.id);
 assert.equal(native.slots[0].options[0].id,'chest_soldier_common_01');
 assert.equal(frame.forgeBodyFrame.sourceModel,f.model.id);assert.equal(frame.tpl,native.tpl);
 assert.equal(frame.initialSelection.CHEST,f.option.id);assert.deepEqual(frame.initialPaint,f.profile.initialPaint);
 assert.equal(frame.slots[0].options[0].forgeCrossClass.classId,native.id);
 assert.equal(native.slots[0].options.filter(o=>o.forgeAstartes).length,1);
 assert.equal(frame.slots[0].options.filter(o=>o.forgeAstartes).length,1,'cross class union must not repeat globally shared Astartes options');
});
test('unresolved defaults cannot expose a renamed native body as a completed frame',t=>{
 const f=fixture(t),lib=astartes.loadAstartesLibrary(f.dataRoot);
 lib.profiles[0].initialSelection.CHEST='missing_source_geometry';
 assert.throws(()=>astartes.augmentAstartesRegistry(f.registry,lib),/default geometry is unavailable/);
});
test('frame export uses real source skeleton and selected geometry, with 8 weights preserved',async t=>{
 const f=fixture(t),r=await buildRecipe(f.recipe(),{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'out')}),doc=gltf(path.join(f.dataRoot,'out',r.files[0].file));
 assert.equal(doc.asset.extras.forgeBodyFrame.profileId,f.profile.id);
 assert.deepEqual(doc.meshes.map(m=>m.name),['chaplain_chest']);assert.equal(doc.meshes[0].extras.forgeSlot,'CHEST');
 assert.ok(doc.nodes.some(n=>n.name==='mod_distinctive_helper'),'target model rig must come from the actual mod constructor');
 assert.notEqual(doc.meshes[0].primitives[0].attributes.WEIGHTS_1,undefined);
});
test('native parts selected on a mod frame graft from retail source instead of reusing colliding IDs',async t=>{
 const f=fixture(t),r=await buildRecipe(f.recipe(f.profile.id,{CHEST:'chest_soldier_common_01'}),{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'out-native')}),doc=gltf(path.join(f.dataRoot,'out-native',r.files[0].file));
 assert.deepEqual(doc.meshes.map(m=>m.name),['native_chest']);assert.ok(doc.nodes.some(n=>n.name==='mod_distinctive_helper'));
});
test('Astartes parts on native frames use the same composer as part previews',async t=>{
 const f=fixture(t),r=await buildRecipe(f.recipe('PVE_PVP_SOLDIER'),{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'out-shared'),onlySlots:['CHEST']}),doc=gltf(path.join(f.dataRoot,'out-shared',r.files[0].file));
 assert.deepEqual(doc.meshes.map(m=>m.name),['chaplain_chest']);assert.equal(doc.nodes.find(n=>n.mesh!==undefined).extras.forgeSlot,'CHEST');
});

test('scoped source variants require an exact profile ID rather than selecting the first definition',t=>{
 const f=fixture(t),second=structuredClone(f.option);second.id=f.option.id+':1234abcd';
 f.catalog.options.push(second);f.refreshManifest();
 const lib=astartes.loadAstartesLibrary(f.dataRoot);
 assert.throws(()=>astartes.augmentAstartesRegistry(f.registry,lib),/Ambiguous Astartes default/);
 lib.profiles[0].initialSelection.CHEST=second.id;
 const registry=astartes.augmentAstartesRegistry(f.registry,lib);
 assert.equal(registry.classes.find(c=>c.id===f.profile.id).initialSelection.CHEST,second.id);
});
test('malformed scoped suffixes cannot masquerade as source variants',t=>{
 const f=fixture(t);f.catalog.options[0].id+=':notahash';f.refreshManifest();
 assert.throws(()=>astartes.loadAstartesLibrary(f.dataRoot),/Invalid or unresolved Astartes option/);
});
test('body frame actor equipment uses source-follow mounting in the export composer',async t=>{
 const f=fixture(t);f.option.attachment={followNodeName:'ROOT',sourceNode:'SetFollow_fixture',position:[0,0,0],rotation:[0,0,0,1]};f.refreshManifest();
 const r=await buildRecipe(f.recipe(),{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'out-attachment')});
 const doc=gltf(path.join(f.dataRoot,'out-attachment',r.files[0].file));
 assert.ok(doc.nodes.some(n=>n.extras?.forgeAttachmentRoot&&n.extras.followNodeName==='ROOT'));
 assert.ok(r.files[0].crossClassGrafts.some(d=>d.sourceActorFollow===true&&d.originalInverseBindMatrices===true));
 assert.equal(doc.nodes.filter(n=>n.name==='ROOT').length,1);
});

test('a logical Astartes option composes all source components, including attached actor geometry',async t=>{
 const f=fixture(t),secondary=fixtureGLB('secondary_trim',1001),model={...f.model,id:'astartes_fixture_equipment',glb:'assets/customization/astartes-v1/models/equipment.glb',metadata:'assets/customization/astartes-v1/models/equipment.json'};
 fs.writeFileSync(path.join(f.dataRoot,model.glb),secondary.bytes);fs.writeFileSync(path.join(f.dataRoot,model.metadata),JSON.stringify(secondary.metadata));
 f.catalog.models.push(model);
 f.option.components=[{sourceAsset:f.option.sourceAsset,meshes:f.option.meshes,resolvedMeshes:f.option.resolvedMeshes,resolvedObjectIds:f.option.resolvedObjectIds},{sourceAsset:model.id,meshes:['secondary_trim'],resolvedMeshes:['secondary_trim'],resolvedObjectIds:[1001],attachment:{followNodeName:'ROOT',sourceNode:'SetFollow_fixture_equipment',position:[.25,0,0],rotation:[0,0,0,1]}}];
 f.refreshManifest();
 const r=await buildRecipe(f.recipe(),{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'out-components')}),doc=gltf(path.join(f.dataRoot,'out-components',r.files[0].file));
 assert.deepEqual(doc.meshes.map(m=>m.name),['chaplain_chest','secondary_trim']);
 assert.ok(r.files[0].crossClassGrafts.some(d=>d.componentIndex===1&&d.sourceActorFollow===true));
 assert.equal(doc.meshes.every(m=>m.primitives[0].attributes.WEIGHTS_1!==undefined),true);
});
test('mismatched primary component is rejected instead of dropping geometry',t=>{
 const f=fixture(t);f.option.components=[{sourceAsset:f.option.sourceAsset,meshes:f.option.meshes,resolvedObjectIds:[999]}];f.refreshManifest();
 assert.throws(()=>astartes.loadAstartesLibrary(f.dataRoot),/primary component does not match/);
});

test('unavailable upstream choices stay auditable in the registry and cannot silently export as empty',async t=>{
 const f=fixture(t),entry={id:'astartes:engineer',sourceOptionId:'engineer',slotId:'MODDED_SLOT_1',label:'Upstream missing option',geometryAvailable:false,geometryComplete:false,reason:'Source selector has no matching geometry',missingSelectors:['engineer'],sourceDefinition:{raw:'kept in signed catalog'}};
 f.catalog.unavailableOptions=[entry];f.option.sourceDefinition={raw:'full audit'};f.refreshManifest();
 const lib=astartes.loadAstartesLibrary(f.dataRoot),reg=astartes.augmentAstartesRegistry(f.registry,lib),c=reg.classes.find(c=>c.id===f.profile.id),option=c.slots.find(s=>s.id===entry.slotId).options.find(o=>o.id===entry.id);
 assert.equal(lib.unavailableOptions.length,1);assert.equal(option.forgeUnavailable,true);assert.equal(option.reason,entry.reason);
 assert.equal(option.sourceDefinition,undefined);assert.equal(c.slots[0].options.find(o=>o.id===f.option.id).sourceDefinition,undefined);
 assert.ok(lib.options[0].sourceDefinition);
 await assert.rejects(()=>buildRecipe(f.recipe(f.profile.id,{CHEST:f.option.id,MODDED_SLOT_1:entry.id}),{dataRoot:f.dataRoot,out:path.join(f.dataRoot,'out-unavailable')}),/source geometry is unavailable/);
});
