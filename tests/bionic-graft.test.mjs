import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {graftBionicModel} from '../shared/bionic-graft.mjs';

const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
function fixture({helpers=true}={}){
 const chunks=[],views=[],accessors=[];let size=0;
 function add(values,componentType,type,count,{normalized=false,stride}={}){
  const Typed={5121:Uint8Array,5123:Uint16Array,5126:Float32Array}[componentType];
  const raw=Buffer.from(new Typed(values).buffer),pad=Buffer.alloc((-size)&3);chunks.push(pad);size+=pad.length;
  const id=accessors.length,view=views.length;
  views.push({buffer:0,byteOffset:size,byteLength:raw.length,...(stride?{byteStride:stride}:{})});chunks.push(raw);size+=raw.length;
  accessors.push({bufferView:view,componentType,type,count,...(normalized?{normalized:true}:{})});return id;
 }
 const position=add([0,0,0,1,0,0,0,1,0],5126,'VEC3',3);
 const joints=add(Array(3).fill([helpers?3:1,0,0,0]).flat(),5123,'VEC4',3);
 const weights=add(Array(3).fill([.5,0,0,0]).flat(),5126,'VEC4',3);
 const joints1=add(Array(3).fill([1,2,0,0]).flat(),5123,'VEC4',3);
 const weights1=add(Array(3).fill([.25,.25,0,0]).flat(),5126,'VEC4',3);
 const colors=add([10,20,30,255,40,50,60,255,70,80,90,255],5121,'VEC4',3,{normalized:true});
 const indices=add([0,1,2],5123,'SCALAR',3);
 const inverse=add(Array(helpers?4:3).fill(identity).flat(),5126,'MAT4',helpers?4:3);
 const base={asset:{version:'2.0',extras:{retail:'untouched'}},scene:0,scenes:[{nodes:[0],extras:{oldScene:true}}],
  nodes:[{name:'ROOT',children:[1,2,3]},{name:'ARM_L',translation:[1,0,0]},{name:'ARM_R'},
   {name:'native_body',mesh:0,skin:0,extras:{sourceObjectId:42}}],
  meshes:[{name:'native_body',primitives:[{attributes:{POSITION:1,COLOR_0:2},indices:3,material:0}],extras:{retailMesh:true}}],
  skins:[{name:'retail',skeleton:0,joints:[0,1,2],inverseBindMatrices:0,extras:{retailSkin:true}},
   {name:'other_skin',joints:[2],inverseBindMatrices:0}],
  materials:[{name:'retail_material',extras:{nativeMasks:true}}],
  buffers:[{byteLength:256}],bufferViews:[{buffer:0,byteOffset:0,byteLength:256}],
  accessors:[{bufferView:0,componentType:5126,type:'MAT4',count:3},
   {bufferView:0,byteOffset:192,componentType:5126,type:'VEC3',count:3},
   {bufferView:0,byteOffset:228,componentType:5121,type:'VEC4',count:3,normalized:true},
   {bufferView:0,byteOffset:240,componentType:5123,type:'SCALAR',count:3}],
  animations:[{name:'native motion',channels:[{target:{node:2,path:'rotation'},sampler:0}],samplers:[{input:1,output:1}]}],
  extensionsUsed:['RETAIL_extension']};
 const nodes=[{name:'ROOT',children:[1,2],extras:{sourceNativeNodeIndex:0}},
  {name:'ARM_L',translation:[1,0,0],...(helpers?{children:[3]}:{}),extras:{sourceNativeNodeIndex:1}},
  {name:'ARM_R',extras:{sourceNativeNodeIndex:2}}];
 if(helpers)nodes.push({name:'L_forearm_helper',children:[4],translation:[0,.1,0],
   extras:{forgeBionicHelper:true,forgeHelperWeighted:true,forgeParentNativeNodeIndex:1}},
  {name:'L_ring_inner',extras:{forgeBionicHelper:true,forgeHelperWeighted:false,forgeParentHelperName:'L_forearm_helper'}});
 const geomIndex=nodes.length;
 nodes.push({name:'forge_arm_L',mesh:0,skin:0,extras:{forgeBionicMesh:true,sourceObjectId:9000001,sourceRightObjectId:4044}});
 const addon={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,geomIndex]}],nodes,
  skins:[{name:'retail',skeleton:0,joints:helpers?[0,1,2,3]:[0,1,2],inverseBindMatrices:inverse}],
  meshes:[{name:'forge_arm_L',primitives:[{attributes:{POSITION:position,JOINTS_0:joints,WEIGHTS_0:weights,
   JOINTS_1:joints1,WEIGHTS_1:weights1,COLOR_0:colors},indices,material:0}]}],
  materials:[{name:'preview_steel',pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:.85}}],
  buffers:[{byteLength:size}],bufferViews:views,accessors,extensionsUsed:['KHR_mesh_quantization']};
 const bin=Buffer.concat([...chunks,Buffer.alloc((-size)&3)]);
 return {base,addon,bin,record:{objectId:9000001,optionId:'forge_left_bionic_v1',meshNames:['forge_arm_L'],sha256:'addon-sha'},
  ids:{position,joints,weights,joints1,weights1,colors,indices,inverse,geomIndex}};
}
const run=f=>graftBionicModel(f.base,256,f.addon,f.bin,f.record);

test('graft is pure and preserves every existing node, mesh, attribute and body binding',()=>{
 const f=fixture(),base=structuredClone(f.base),addon=structuredClone(f.addon),binary=Buffer.from(f.bin);
 freeze(f.base);freeze(f.addon);freeze(f.record);
 const result=run(f);
 assert.deepEqual(f.base,base);assert.deepEqual(f.addon,addon);assert.deepEqual(f.bin,binary);
 assert.notStrictEqual(result.json.nodes[0],f.base.nodes[0]);
 assert.deepEqual(result.json.nodes[0],base.nodes[0]);
 assert.deepEqual(result.json.nodes[1],{...base.nodes[1],children:[4]});
 assert.deepEqual(result.json.nodes.slice(2,4),base.nodes.slice(2,4));
 assert.deepEqual(result.json.meshes[0],base.meshes[0]);
 assert.deepEqual(result.json.accessors.slice(0,base.accessors.length),base.accessors);
 assert.deepEqual(result.json.bufferViews[0],base.bufferViews[0]);
 assert.deepEqual(result.json.materials[0],base.materials[0]);
 assert.deepEqual(result.json.animations,base.animations);
 assert.deepEqual(result.json.skins[1],base.skins[1]);
 assert.deepEqual(result.json.nodes[4].children,[5]);
 assert.deepEqual(result.json.scenes[0].nodes,[0,6]);
 assert.deepEqual(result.json.skins[0].joints,[0,1,2,4]);
 assert.equal(result.json.skins[0].skeleton,0);
 assert.equal(result.json.skins[0].inverseBindMatrices,base.accessors.length+f.ids.inverse);
});

test('addon BIN is appended with stable offsets and both skin sets/masks stay byte exact',()=>{
 const f=fixture(),r=run(f),mesh=r.json.meshes[1],offset=f.base.accessors.length;
 assert.deepEqual(r.appendBinary,f.bin);
 assert.equal(r.json.buffers[0].byteLength,256+f.addon.buffers[0].byteLength);
 f.addon.bufferViews.forEach((view,i)=>assert.deepEqual(r.json.bufferViews[i+1],{...view,byteOffset:256+(view.byteOffset??0)}));
 for(const [key,value]of Object.entries(f.addon.meshes[0].primitives[0].attributes))assert.equal(mesh.primitives[0].attributes[key],offset+value);
 assert.equal(r.json.accessors[offset+f.ids.colors].normalized,true);
 assert.equal(r.json.accessors[offset+f.ids.joints].componentType,5123);
 assert.equal(r.json.nodes.at(-1).extras.sourceObjectId,f.record.objectId);
 assert.equal(r.json.nodes.at(-1).extras.sourceRightObjectId,4044);
 assert.deepEqual(r.meshRecords,[{name:'forge_arm_L',objectId:9000001,lod:0,vertices:3,faces:1,gltfMeshIndex:1}]);
 assert.deepEqual(r.objectRecord,{id:9000001,name:'forge_left_bionic_v1',parentId:null});
 assert.deepEqual(r.json.extensionsUsed,['RETAIL_extension','KHR_mesh_quantization']);
 const native=Buffer.alloc(256,0xa5),combined=Buffer.concat([native,r.appendBinary]);
 assert.deepEqual(combined.subarray(0,256),native);
});

test('zero-helper native-left binding and unique exact-name core fallback are supported',()=>{
 const f=fixture({helpers:false});
 for(const node of f.addon.nodes.slice(0,3))delete node.extras.sourceNativeNodeIndex;
 const r=run(f);
 assert.equal(r.json.nodes.length,f.base.nodes.length+1);
 assert.deepEqual(r.json.skins[0].joints,f.base.skins[0].joints);
 assert.deepEqual(r.json.nodes.slice(0,4),f.base.nodes);
});

test('two geometry parts share one custom object ID without merging meshes or weights',()=>{
 const f=fixture(),second=structuredClone(f.addon.meshes[0]);second.name='forge_arm_L_equipment';f.addon.meshes.push(second);
 f.addon.nodes.push({name:second.name,mesh:1,skin:0,extras:{forgeBionicMesh:true}});
 f.addon.scenes[0].nodes.push(f.addon.nodes.length-1);f.record.meshNames.push(second.name);
 const r=run(f);
 assert.equal(r.meshRecords.length,2);assert.deepEqual(r.meshRecords.map(m=>m.objectId),[9000001,9000001]);
 assert.equal(r.json.meshes.length,3);assert.equal(r.json.nodes.at(-1).mesh,2);
});

test('actual base BIN padding, including a nonaligned caller offset, is included in addon views',()=>{
 const f=fixture();f.base.buffers[0].byteLength=255;
 const r=graftBionicModel(f.base,257,f.addon,f.bin,f.record);
 assert.equal(r.json.bufferViews[1].byteOffset,260);
 assert.deepEqual(r.appendBinary.subarray(0,3),Buffer.alloc(3));
 assert.deepEqual(r.appendBinary.subarray(3,3+f.addon.buffers[0].byteLength),f.bin.subarray(0,f.addon.buffers[0].byteLength));
});

test('wrong class/native identity, changed local bind and ambiguous fallback names fail closed',()=>{
 let f=fixture();f.addon.nodes[1].extras.sourceNativeNodeIndex=2;assert.throws(()=>run(f),/name\/index mismatch/);
 f=fixture();f.addon.nodes[1].translation[0]=2;assert.throws(()=>run(f),/local bind transform mismatch/);
 f=fixture();delete f.addon.nodes[1].extras.sourceNativeNodeIndex;f.base.nodes.push({name:'ARM_L'});assert.throws(()=>run(f),/missing or ambiguous/);
 f=fixture();f.addon.nodes[2].extras.sourceNativeNodeIndex=1;f.addon.nodes[2].name='ARM_L';assert.throws(()=>run(f),/same native node/);
 f=fixture();f.addon.nodes[1].extras.forgeNativeNodeIndex=2;assert.throws(()=>run(f),/conflicting native index metadata/);
});

test('palette reordering, truncated IBMs and native nodes in the helper tail are rejected',()=>{
 let f=fixture();f.addon.skins[0].joints=[0,2,1,3];assert.throws(()=>run(f),/palette prefix mismatch/);
 f=fixture();f.addon.accessors[f.ids.inverse].count=3;assert.throws(()=>run(f),/IBM accessor/);
 f=fixture();f.addon.skins[0].joints=[0,1,2,0];assert.throws(()=>run(f),/duplicate skin joints/);
 f=fixture();f.addon.nodes[3].extras.forgeHelperWeighted=false;assert.throws(()=>run(f),/not a weighted new helper/);
 f=fixture();f.addon.skins[0].joints=[0,1,2];assert.throws(()=>run(f),/weighted helper is missing/);
});

test('joint palette overflows and malformed ranges cannot produce an exported graft',()=>{
 let f=fixture(),acc=f.addon.accessors[f.ids.joints],view=f.addon.bufferViews[acc.bufferView];
 f.bin.writeUInt16LE(65535,view.byteOffset);assert.throws(()=>run(f),/geometry joint palette index/);
 f=fixture();f.addon.bufferViews[0].byteLength=10**9;assert.throws(()=>run(f),/addon bufferView/);
 f=fixture();f.addon.accessors[f.ids.position].sparse={count:1};assert.throws(()=>run(f),/sparse addon/);
 f=fixture();f.addon.accessors[f.ids.inverse].bufferView=999;assert.throws(()=>run(f),/accessor bufferView/);
});

test('detached/cyclic helper attachments, native hierarchy rewrites and texture references fail closed',()=>{
 let f=fixture();delete f.addon.nodes[1].children;delete f.addon.nodes[3].extras.forgeParentNativeNodeIndex;assert.throws(()=>run(f),/detached new helper/);
 f=fixture();f.addon.nodes[1].children.push(2);f.addon.nodes[0].children=[1];assert.throws(()=>run(f),/native node hierarchy mismatch/);
 f=fixture();delete f.addon.nodes[1].children;delete f.addon.nodes[3].children;delete f.addon.nodes[3].extras.forgeParentNativeNodeIndex;
 f.addon.nodes[3].extras.forgeParentHelperName='L_ring_inner';assert.throws(()=>run(f),/cyclic node hierarchy/);
 f=fixture();f.addon.materials[0].normalTexture={index:0};assert.throws(()=>run(f),/material textures/);
});

test('a graft cannot be applied twice or alias its appended binary back to the source',()=>{
 const f=fixture(),r=run(f),before=Buffer.from(f.bin);
 r.appendBinary[0]^=255;assert.deepEqual(f.bin,before);
 assert.throws(()=>graftBionicModel(r.json,256+r.appendBinary.length,f.addon,f.bin,f.record),/collides|palette/);
});

test('recipe export resolves the library option and preserves weighted plus unweighted helpers',async()=>{
 const {buildRecipe}=await import('../tools/build_from_recipe.mjs');
 const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tempRoot=path.join(product,'.build');
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'bionic-builder-'));
 const write=(relative,value)=>{const file=path.join(dir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));return file};
 function glb(doc,bin){
  const text=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([text,Buffer.alloc((-text.length)&3,32)]),payload=Buffer.concat([bin,Buffer.alloc((-bin.length)&3)]),h=Buffer.alloc(20),bh=Buffer.alloc(8);
  h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+payload.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(payload.length,0);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,json,bh,payload]);
 }
 function parse(bytes){const n=bytes.readUInt32LE(12);return{doc:JSON.parse(bytes.subarray(20,20+n)),bin:bytes.subarray(28+n)}}
 function accessorBytes(model,id){const a=model.doc.accessors[id],v=model.doc.bufferViews[a.bufferView],sizes={5121:1,5123:2,5126:4},counts={SCALAR:1,VEC3:3,VEC4:4,MAT4:16};const start=(v.byteOffset??0)+(a.byteOffset??0);return model.bin.subarray(start,start+a.count*sizes[a.componentType]*counts[a.type])}
 try{
  const f=fixture(),asset='cc_sm_constructor_soldier',classId='PVE_PVP_SOLDIER';
  delete f.base.nodes[3].skin;
  const baseBin=Buffer.alloc(256);identity.forEach((n,i)=>{for(let joint=0;joint<3;joint++)baseBin.writeFloatLE(n,joint*64+i*4)});
  [0,0,0,1,0,0,0,1,0].forEach((n,i)=>baseBin.writeFloatLE(n,192+i*4));[0,1,2].forEach((n,i)=>baseBin.writeUInt16LE(n,240+i*2));
  const source=glb(f.base,baseBin),sourcePath=write('assets/characters/SM2-retail-constructors/source-v5/'+asset+'.glb',source);
  write('assets/characters/SM2-retail-constructors/source-v5/'+asset+'.json',{meshes:[{name:'native_body',objectId:42}],objectMetadata:[{id:42,name:'native_body',parentId:null}]});
  write('assets/characters/SM2-retail-constructors/source-v5/manifest.json',{assets:[{asset,transformValidation:'passed',restSkinValidation:'passed',weightPackingValidation:'passed',skinProfileWeldValidation:'passed'}]});
  write('production/roster/armor-options.json',{classes:[{id:classId,tpl:asset,available:true,slots:[
   {id:'BODY',options:[{id:'body_default',meshes:['native_body'],resolvedObjectIds:[42]}]},
   {id:'LEFT_GAUNTLET',options:[{id:'left_default',meshes:[],resolvedObjectIds:[]}]}]}]});
  const addon=glb(f.addon,f.bin),relativePath='assets/characters/SM2-left-bionic/native-v1/soldier.glb';
  write(relativePath,addon);write('assets/characters/SM2-left-bionic/native-v1/manifest.json',{
   schema:'iron-hands-forge-left-bionic-library',version:1,classes:[{...f.record,classId,asset,relativePath,
    bytes:addon.length,sha256:crypto.createHash('sha256').update(addon).digest('hex'),connectorObjectIds:[],excludeObjectIds:[]}]
  });
  const recipe={schema:'iron-hands-forge',version:1,kind:'soldier',catalog:{game:'SM2',build:'test'},soldiers:[{
   id:'test_soldier',role:'test',classId,selection:{BODY:'body_default',LEFT_GAUNTLET:'forge_left_bionic_v1'},
   paint:{armor:'#101215',metal:'#A0A0A0',lenses:'#FFFFFF'}}]};
  const result=await buildRecipe(recipe,{dataRoot:dir,out:path.join(dir,'out')}),output=parse(fs.readFileSync(path.join(dir,'out',result.files[0].file)));
  assert.equal(output.doc.nodes.filter(n=>n.extras?.forgeBionicHelper).length,2,'unweighted RingInner must survive export');
  assert.ok(output.doc.nodes.some(n=>n.name==='L_ring_inner'));
  assert.equal(output.doc.skins[0].joints.length,4);
  const mesh=output.doc.meshes.find(m=>m.name==='forge_arm_L'),p=mesh.primitives[0];
  for(const key of ['JOINTS_0','WEIGHTS_0','JOINTS_1','WEIGHTS_1']){
   assert.deepEqual(accessorBytes(output,p.attributes[key]),accessorBytes({doc:f.addon,bin:f.bin},f.addon.meshes[0].primitives[0].attributes[key]),key+' must be byte exact');
  }
  assert.ok(p.attributes._SM2_COLOR_0!==undefined,'native game masks remain custom attributes');
  assert.equal(output.doc.materials[p.material].pbrMetallicRoughness.metallicFactor,.85);
  assert.deepEqual(fs.readFileSync(sourcePath),source,'source retail GLB must not change');
 }finally{
  assert.ok(path.resolve(dir).startsWith(path.resolve(tempRoot)+path.sep));fs.rmSync(dir,{recursive:true,force:true});
 }
});
