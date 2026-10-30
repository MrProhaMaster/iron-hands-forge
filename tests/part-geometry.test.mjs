import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
import{hasPartGeometry}from'../shared/part-geometry.mjs';import{createStudioPreview}from'../shared/studio-preview.mjs';
test('source None choices remain empty despite Astartes or cross-class provenance',()=>{
 assert.equal(hasPartGeometry({id:'astartes:helmet_none:2105964f',meshes:[],resolvedObjectIds:[],forgeAstartes:{modelId:'astartes_cc_sm_constructor_soldier'}}),false);
 assert.equal(hasPartGeometry({meshes:[],resolvedObjectIds:[],forgeCrossClass:{classId:'PVE_PVP_SOLDIER'}}),false);
});
test('real secondary components and bionic library geometry are not classified as empty',()=>{
 assert.equal(hasPartGeometry({meshes:[],resolvedObjectIds:[],components:[{resolvedObjectIds:[42]}]}),true);
 assert.equal(hasPartGeometry({forgeBionic:{revision:'prepared'}}),true);
});
test('part preview returns empty for source None and rejects unavailable source choices',async t=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','.build');fs.mkdirSync(root,{recursive:true});const state=fs.mkdtempSync(path.join(root,'empty-part-test-'));
 t.after(()=>{assert.ok(path.resolve(state).startsWith(root+path.sep));fs.rmSync(state,{recursive:true,force:true})});
 const options=[{id:'none',meshes:[],resolvedObjectIds:[],forgeAstartes:{modelId:'source'}},{id:'missing',meshes:[],resolvedObjectIds:[],forgeAstartes:{unavailable:true},forgeUnavailable:true,reason:'missing source selector engineer'}];
 const service=createStudioPreview({stateRoot:state,getDataRoot:()=>state,getCatalog:async()=>({armor:{classes:[{id:'frame',available:true,slots:[{id:'HELMET',options}]}]}})});
 assert.deepEqual(await service.prepare({classId:'frame',slotId:'HELMET',optionId:'none'},{partOnly:true}),{empty:true});
 await assert.rejects(service.prepare({classId:'frame',slotId:'HELMET',optionId:'missing'},{partOnly:true}),/missing source selector/);
});
