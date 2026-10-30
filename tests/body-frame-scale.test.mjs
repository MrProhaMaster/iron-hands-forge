import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyBodyFrameScale} from '../shared/body-frame-scale.mjs';
import {buildRecipe} from '../tools/build_from_recipe.mjs';
import astartes from '../shared/astartes-library.cjs';
import {createAstartesFixture} from './fixtures/astartes-library.mjs';
import {resolveMotionBinding} from '../shared/motion-policy.mjs';
const config=JSON.parse(fs.readFileSync(new URL('../shared/motion-bindings.json',import.meta.url),'utf8'));
test('Terminator alias keeps the actual Tank rig and the native clip timing',()=>{
 for(const gait of ['walk','run'])for(const stance of ['unarmed','armed']){
  const binding=resolveMotionBinding(config,'PVE_PVP_CHARACTER_MOD_1',gait,stance),base=resolveMotionBinding(config,'PVE_PVP_TANK',gait,stance);
  assert.equal(binding.output,base.output);assert.equal(binding.asset,'cc_sm_constructor_tank');assert.equal(binding.bodyFrameAlias.sourceModel,'astartes_cc_sm_constructor_tank');assert.equal(binding.bodyFrameAlias.preserveSourceTiming,true);
 }
});
test('source actor scale wraps all roots together, preserving skeleton, bind matrices, and animation targets',()=>{
 const doc={nodes:[{name:'ROOT',translation:[0,0,2]},{name:'visual',mesh:0,skin:0}],scenes:[{nodes:[0,1]}],skins:[{joints:[0],inverseBindMatrices:0}],animations:[{channels:[{target:{node:0,path:'translation'}}]}]},snapshot=structuredClone(doc);
 applyBodyFrameScale(doc,{profileId:'Terminator',sourceActorScale:1.15});
 assert.deepEqual(doc.nodes.slice(0,2),snapshot.nodes);assert.deepEqual(doc.skins,snapshot.skins);assert.deepEqual(doc.animations,snapshot.animations);
 assert.deepEqual(doc.scenes[0].nodes,[2]);assert.deepEqual(doc.nodes[2].children,[0,1]);assert.deepEqual(doc.nodes[2].scale,[1.15,1.15,1.15]);assert.throws(()=>applyBodyFrameScale(doc,{sourceActorScale:1.15}),/already applied/);
 for(const value of [0,-1,NaN,Infinity,'1.15',11])assert.throws(()=>applyBodyFrameScale({nodes:[],scenes:[]},{sourceActorScale:value}),/Invalid/);
});
test('profile scale is signed, validated and reaches the exported GLB without modifying source accessors',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-scale-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const f=createAstartesFixture(dir);f.profile.sourceActorScale=1.15;f.refreshManifest();
 const lib=astartes.loadAstartesLibrary(dir),reg=astartes.augmentAstartesRegistry(f.registry,lib);assert.equal(reg.classes.find(c=>c.id===f.profile.id).forgeBodyFrame.sourceActorScale,1.15);
 const out=path.join(dir,'scaled'),result=await buildRecipe(f.recipe(),{dataRoot:dir,out}),bytes=fs.readFileSync(path.join(out,result.files[0].file)),doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
 const roots=doc.scenes[0].nodes;assert.equal(roots.length,1);assert.deepEqual(doc.nodes[roots[0]].scale,[1.15,1.15,1.15]);assert.ok(doc.nodes[roots[0]].children.length>=2);assert.equal(doc.asset.extras.forgeBodyFrame.sourceActorScale,1.15);
 f.profile.sourceActorScale=-1;f.refreshManifest();assert.throws(()=>astartes.loadAstartesLibrary(dir),/source actor scale/);
});
