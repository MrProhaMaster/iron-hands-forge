import test from 'node:test';
import assert from 'node:assert/strict';
import {graftCrossClassModel,readGraftAccessor} from '../shared/cross-class-graft.mjs';
import {augmentCustomizationRegistry} from '../shared/customization-catalog.mjs';
function fixture(){
 const chunks=[],views=[],accessors=[];let length=0;
 function a(values,type,width,componentType=5126){const size=componentType===5123?2:4,b=Buffer.alloc(values.length*size);values.forEach((x,i)=>componentType===5123?b.writeUInt16LE(x,i*size):b.writeFloatLE(x,i*size));const v=views.length;views.push({buffer:0,byteOffset:length,byteLength:b.length});chunks.push(b);length+=b.length;const id=accessors.length;accessors.push({bufferView:v,componentType,type,count:values.length/width});return id}
 const attrs={POSITION:a([1,0,0,1,1,0,1,0,1],'VEC3',3),NORMAL:a([0,1,0,0,1,0,0,1,0],'VEC3',3),JOINTS_0:a([0,0,0,0,0,0,0,0,0,0,0,0],'VEC4',4,5123),WEIGHTS_0:a([.5,0,0,0,.5,0,0,0,.5,0,0,0],'VEC4',4),JOINTS_1:a([1,0,0,0,1,0,0,0,1,0,0,0],'VEC4',4,5123),WEIGHTS_1:a([.5,0,0,0,.5,0,0,0,.5,0,0,0],'VEC4',4)};
 const donor={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,3]}],nodes:[{name:'root',children:[1]},{name:'bone',translation:[1,0,0],children:[2]},{name:'helper',translation:[1,0,0]},{name:'armour',mesh:0,skin:0}],skins:[{joints:[0,1,2],skeleton:0}],meshes:[{name:'helmet',primitives:[{attributes:attrs}]}],materials:[],buffers:[{byteLength:length}],bufferViews:views,accessors};
 const target={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'root',children:[1]},{name:'bone',translation:[3,0,0]}],skins:[{joints:[0,1],skeleton:0}],meshes:[],materials:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};
 return{donor,target,bin:Buffer.concat(chunks)};
}
test('cross-class rest conversion includes secondary influences and retains original target',()=>{
 const f=fixture(),original=structuredClone(f.target);
 const result=graftCrossClassModel(f.target,0,f.donor,f.bin,{selectedNodes:[3],slotId:'HELMET',sourceClassId:'DONOR',meshRecords:[{objectId:17,name:'helmet'}]});
 assert.deepEqual(f.target,original);
 const prim=result.json.meshes[0].primitives[0],p=readGraftAccessor(result.json,result.appendBinary,prim.attributes.POSITION);
 assert.equal(p.read(0,0),2);assert.equal(p.read(0,1),0);
 const w1=readGraftAccessor(result.json,result.appendBinary,prim.attributes.WEIGHTS_1);
 assert.equal(w1.read(0,0),.5);
 assert.equal(result.json.meshes[0].extras.forgeSlot,'HELMET');
 assert.equal(result.json.nodes.at(-1).extras.forgeSlot,'HELMET');
 const helper=result.json.nodes.find(n=>n.extras?.sourceBoneName==='helper');
 assert.deepEqual(helper.translation,[1,0,0]);
 assert.equal(result.diagnostics.restPoseConverted,true);
});
test('invalid secondary palette indices fail rather than dropping influences',()=>{
 const f=fixture(),a=f.donor.accessors[f.donor.meshes[0].primitives[0].attributes.JOINTS_1],v=f.donor.bufferViews[a.bufferView];
 f.bin.writeUInt16LE(77,v.byteOffset);
 assert.throws(()=>graftCrossClassModel(f.target,0,f.donor,f.bin,{selectedNodes:[3],slotId:'HELMET',sourceClassId:'DONOR'}),/palette index/);
});
test('catalogue preserves native IDs, adds real foreign geometry, and supplies absent optional slots',()=>{
 const option=(id,objectId)=>({id,meshes:[id],resolvedObjectIds:[objectId],geometryAvailable:true,geometryComplete:true});
 const input={classes:[{id:'A',tpl:'a',available:true,slots:[{id:'HELMET',options:[option('ahelmet',1)]}],initialSelection:{HELMET:'ahelmet'}},{id:'B',tpl:'b',available:true,slots:[{id:'HELMET',options:[option('bhelmet',2),{id:'external',meshes:[],resolvedObjectIds:[],equipmentActorMeshes:['notready']}]},{id:'COAT',options:[option('cape',3)]}]}]};
 const before=structuredClone(input),out=augmentCustomizationRegistry(input);
 assert.deepEqual(input,before);
 const a=out.classes[0],helmet=a.slots.find(s=>s.id==='HELMET');
 assert.equal(helmet.options[0].id,'ahelmet');
 assert.deepEqual(helmet.options.find(o=>o.id==='forge:B:bhelmet').forgeCrossClass,{classId:'B',asset:'b',slotId:'HELMET',optionId:'bhelmet'});
 assert(!helmet.options.some(o=>o.id.includes('external')));
 assert.equal(a.initialSelection.COAT,'forge:none:COAT');
});


test('morph deltas are directions and keep their magnitude under translated rest poses',()=>{
 const f=fixture(),source=f.donor.meshes[0].primitives[0].attributes.NORMAL;
 f.donor.meshes[0].primitives[0].targets=[{POSITION:source}];
 const result=graftCrossClassModel(f.target,0,f.donor,f.bin,{selectedNodes:[3],slotId:'HELMET',sourceClassId:'DONOR'});
 const morph=result.json.meshes[0].primitives[0].targets[0].POSITION,a=readGraftAccessor(result.json,result.appendBinary,morph);
 assert.equal(a.read(0,0),0);assert.equal(a.read(0,1),1);assert.equal(a.read(0,2),0);
});
test('repeated same-class grafts reuse compatible helper chains without mutating their rest transforms',()=>{
 const f=fixture(),first=graftCrossClassModel(f.target,0,f.donor,f.bin,{selectedNodes:[3],slotId:'HELMET',sourceClassId:'DONOR'});
 const second=graftCrossClassModel(first.json,first.appendBinary.length,f.donor,f.bin,{selectedNodes:[3],slotId:'COAT',sourceClassId:'DONOR',objectIdBase:1000100000});
 assert.equal(first.diagnostics.addedHelpers,1);assert.equal(second.diagnostics.addedHelpers,0);
 assert.equal(second.json.nodes.filter(n=>n.extras?.forgeCrossClassHelper).length,1);
});
