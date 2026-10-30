import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3,Quaternion} from '../app/web/vendor/three.module.js';
import {graftAttachedModel} from '../shared/attachment-graft.mjs';
import {readGraftAccessor} from '../shared/cross-class-graft.mjs';
import {fixtureGLB} from './fixtures/astartes-library.mjs';
const bin=f=>f.bytes.subarray(28+f.bytes.readUInt32LE(12));
function world(doc,id){const parent=new Map();doc.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parent.set(c,i)));const local=n=>n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation||[0,0,0]),new Quaternion().fromArray(n.rotation||[0,0,0,1]),new Vector3().fromArray(n.scale||[1,1,1]));let result=local(doc.nodes[id]);for(let p=parent.get(id);p!==undefined;p=parent.get(p))result.premultiply(local(doc.nodes[p]));return result}
function fixture(){
 const base=fixtureGLB('body',1),donor=fixtureGLB('knife_geom',2),follow=base.doc.nodes.length;
 base.doc.nodes.push({name:'powerplant_backpack',translation:[4,5,6],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]});base.doc.nodes[0].children=[follow];
 return{base,donor,follow,graft:()=>graftAttachedModel(base.doc,bin(base).length,donor.doc,bin(donor),{selectedNodes:[1],meshRecords:donor.metadata.meshes,slotId:'ASTARTES_EQUIPMENT',sourceModelId:'astartes_arms',followNodeName:'powerplant_backpack'})};
}
function positionAt(r,baseBin,row=1){
 const doc=r.json,payload=Buffer.concat([baseBin,r.appendBinary]),node=doc.nodes.find(n=>n.extras?.forgeActorAttachment),mesh=doc.meshes[node.mesh],skin=doc.skins[node.skin],p=readGraftAccessor(doc,payload,mesh.primitives[0].attributes.POSITION),ibm=readGraftAccessor(doc,payload,skin.inverseBindMatrices);
 const m=new Matrix4().fromArray(Array.from({length:16},(_,c)=>ibm.read(0,c))).premultiply(world(doc,skin.joints[0]));
 return new Vector3(p.read(row,0),p.read(row,1),p.read(row,2)).applyMatrix4(m).toArray();
}
test('source actor rig follows exact owner position and rotation while preserving original bind and 8 weights',()=>{
 const f=fixture(),before=structuredClone(f.base.doc),r=f.graft(),payload=Buffer.concat([bin(f.base),r.appendBinary]);
 assert.deepEqual(f.base.doc,before);
 const actual=positionAt(r,bin(f.base));assert.ok(actual.every((n,i)=>Math.abs(n-[4,6,6][i])<1e-6));
 const mesh=r.json.meshes.at(-1),weights=readGraftAccessor(r.json,payload,mesh.primitives[0].attributes.WEIGHTS_1);
 assert.equal(weights.read(0,0),.5);assert.equal(r.diagnostics.originalInverseBindMatrices,true);
 assert.equal(r.json.nodes.filter(n=>n.name==='ROOT').length,1,'donor ROOT must not capture body animation');
 r.json.nodes[f.follow].translation=[9,8,7];
 const moved=positionAt(r,bin(f.base));assert.ok(moved.every((n,i)=>Math.abs(n-[9,9,7][i])<1e-6));
});
test('only selected visual mesh is appended; unselected collision geometry is not visible',()=>{
 const f=fixture();f.donor.doc.nodes.push({name:'rb_wpn',mesh:0,skin:0});
 const r=f.graft();assert.equal(r.meshRecords.length,1);assert.equal(r.json.meshes.at(-1).name,'knife_geom');
 assert.equal(r.json.nodes.filter(n=>n.mesh!==undefined).length,2);
 assert.equal(r.json.nodes.some(n=>n.name?.endsWith('/ rb_wpn')),false);
});
test('unskinned source geometry retains source-local placement beneath owner object',()=>{
 const f=fixture();delete f.donor.doc.nodes[1].skin;delete f.donor.doc.meshes[0].primitives[0].attributes.JOINTS_0;delete f.donor.doc.meshes[0].primitives[0].attributes.JOINTS_1;delete f.donor.doc.meshes[0].primitives[0].attributes.WEIGHTS_0;delete f.donor.doc.meshes[0].primitives[0].attributes.WEIGHTS_1;
 f.donor.doc.nodes[1].translation=[1,2,3];const r=f.graft(),node=r.json.nodes.findIndex(n=>n.extras?.forgeActorAttachment);
 const position=new Vector3().applyMatrix4(world(r.json,node)).toArray();assert.ok(position.every((n,i)=>Math.abs(n-[2,6,9][i])<1e-6));
 assert.equal(r.json.nodes[node].skin,undefined);
});
test('missing or ambiguous source follow objects are errors',()=>{
 const f=fixture();f.base.doc.nodes[f.follow].name='other';assert.throws(f.graft,/missing or ambiguous/);
 f.base.doc.nodes[f.follow].name='powerplant_backpack';f.base.doc.nodes.push({name:'powerplant_backpack'});assert.throws(f.graft,/missing or ambiguous/);
});
