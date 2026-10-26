import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createEightInfluenceSkinning,patchEightInfluenceVertexShader} from '../shared/eight-influence-skinning.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vendor=path.join(root,'app/web/vendor');
const available=fs.existsSync(path.join(vendor,'three.module.js'));
const THREE=available?await import(pathToFileURL(path.join(vendor,'three.module.js')).href):null;
const options={skip:!available&&'Run node scripts/vendor-three.mjs to test the pinned renderer'};

function fixtureGLB(){
 const chunks=[],views=[],accessors=[];let size=0;
 function add(values,componentType,type,count,min,max){
  const typed=componentType===5126?new Float32Array(values):new Uint16Array(values);
  const raw=Buffer.from(typed.buffer),padding=Buffer.alloc((-size)&3);chunks.push(padding);size+=padding.length;
  const view=views.length;views.push({buffer:0,byteOffset:size,byteLength:raw.length});chunks.push(raw);size+=raw.length;
  const accessor=accessors.length;accessors.push({bufferView:view,componentType,type,count,...(min?{min}:{}),...(max?{max}:{})});return accessor;
 }
 const attrs={POSITION:add([0,0,0,1,0,0,0,1,0],5126,'VEC3',3,[0,0,0],[1,1,0]),NORMAL:add([0,0,1,0,0,1,0,0,1],5126,'VEC3',3),JOINTS_0:add(Array(3).fill([0,1,2,3]).flat(),5123,'VEC4',3),WEIGHTS_0:add(Array(12).fill(.1),5126,'VEC4',3),JOINTS_1:add(Array(3).fill([4,5,6,7]).flat(),5123,'VEC4',3),WEIGHTS_1:add(Array(3).fill([.1,.1,.1,.3]).flat(),5126,'VEC4',3)};
 const indices=add([0,1,2],5123,'SCALAR',3),inverse=add(Array(8).fill([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]).flat(),5126,'MAT4',8);
 const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1,2,3,4,5,6,7,8]}],nodes:[...Array.from({length:8},(_,i)=>({name:'joint'+i})),{name:'Eight-weight fixture',mesh:0,skin:0}],skins:[{joints:[0,1,2,3,4,5,6,7],inverseBindMatrices:inverse}],meshes:[{primitives:[{attributes:attrs,indices}]}],buffers:[{byteLength:size}],bufferViews:views,accessors};
 const text=Buffer.from(JSON.stringify(json)),j=Buffer.concat([text,Buffer.alloc((-text.length)&3,32)]),bin=Buffer.concat([...chunks,Buffer.alloc((-size)&3)]),header=Buffer.alloc(20),bh=Buffer.alloc(8);
 header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+j.length+bin.length,8);header.writeUInt32LE(j.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,j,bh,bin]);
}
let loaderPromise;
async function loaderClass(){
 if(!loaderPromise)loaderPromise=(async()=>{
  const cache=fs.mkdtempSync(path.join(fs.mkdirSync(path.join(root,'.build'),{recursive:true})||path.join(root,'.build'),'eight-loader-'));
  const threeURL=pathToFileURL(path.join(vendor,'three.module.js')).href;
  for(const name of ['BufferGeometryUtils','SkeletonUtils']){
   const source=fs.readFileSync(path.join(vendor,'addons/utils',name+'.js'),'utf8').replaceAll("from 'three'","from '"+threeURL+"'");fs.writeFileSync(path.join(cache,name+'.mjs'),source);
  }
  const source=fs.readFileSync(path.join(vendor,'addons/loaders/GLTFLoader.js'),'utf8').replaceAll("from 'three'","from '"+threeURL+"'").replace("'../utils/BufferGeometryUtils.js'","'./BufferGeometryUtils.mjs'").replace("'../utils/SkeletonUtils.js'","'./SkeletonUtils.mjs'");
  fs.writeFileSync(path.join(cache,'GLTFLoader.mjs'),source);return (await import(pathToFileURL(path.join(cache,'GLTFLoader.mjs')).href)).GLTFLoader;
 })();return loaderPromise;
}
async function load(adapted=true){const Loader=await loaderClass(),loader=new Loader(),adapter=createEightInfluenceSkinning(THREE);if(adapted)loader.register(adapter.loaderPlugin);const bytes=fixtureGLB(),gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');let mesh;gltf.scene.traverse(o=>{if(o.isSkinnedMesh)mesh=o});return{mesh,gltf,adapter}}

// Shader structure is checked for every lit and shadow path; GPU compile/render is
// additionally exercised by the browser acceptance scene, outside this Node suite.
test('position, normal, tangent and depth shaders include both influence sets',options,()=>{
 for(const name of ['standard','depth','distance','normal']){
  const patched=patchEightInfluenceVertexShader(THREE.ShaderLib[name].vertexShader);
  for(const channel of ['x','y','z','w'])assert.ok(patched.includes('skinWeight1.'+channel));
  assert.ok(patched.includes('attribute vec4 skinIndex1'));assert.ok(!patched.includes('#include <skinning_vertex>'));
  if(THREE.ShaderLib[name].vertexShader.includes('#include <skinnormal_vertex>'))assert.ok(patched.includes('objectTangent='));
 }
 assert.throws(()=>patchEightInfluenceVertexShader('void main(){}'),/Unsupported skinning shader/);
});

test('real GLTFLoader preserves exact primary weights before its four-weight normalization',options,async()=>{
 const stock=await load(false),fixed=await load();
 assert.equal(stock.mesh.geometry.attributes.skinWeight.getX(0),.25,'fixture must exercise the stock loader defect');
 assert.equal(fixed.mesh.geometry.attributes.skinWeight.getX(0),Math.fround(.1));
 assert.equal(fixed.mesh.geometry.attributes.skinWeight1.getW(0),Math.fround(.3));
 assert.equal(fixed.mesh.userData.forgeSkinInfluences,8);
 assert.ok(fixed.mesh.customDepthMaterial);assert.ok(fixed.mesh.customDistanceMaterial);
});

test('eighth bone drives CPU vertex positions, bounds, raycast and direction vectors',options,async()=>{
 const {mesh,gltf}=await load();mesh.skeleton.bones[7].position.x=5;gltf.scene.updateMatrixWorld(true);
 const v=mesh.getVertexPosition(0,new THREE.Vector3());assert.ok(Math.abs(v.x-1.5)<1e-6);
 mesh.computeBoundingBox();assert.ok(Math.abs(mesh.boundingBox.min.x-1.5)<1e-6);assert.ok(Math.abs(mesh.boundingBox.max.x-2.5)<1e-6);
 const normal=mesh.applyBoneTransform(0,new THREE.Vector4(0,0,1,0));assert.ok(Math.abs(normal.x)<1e-6);assert.ok(Math.abs(normal.z-1)<1e-6);
 mesh.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(1.7,.2,3),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObject(mesh).length,1);
});

test('normalization uses all eight weights and replacement paint materials receive shader support',options,async()=>{
 const {mesh,adapter}=await load(),a=mesh.geometry.attributes;
 for(const attr of [a.skinWeight,a.skinWeight1])for(let i=0;i<attr.count;i++)for(let j=0;j<4;j++)attr.setComponent(i,j,attr.getComponent(i,j)*2);
 mesh.normalizeSkinWeights();assert.ok(Math.abs(a.skinWeight.getX(0)-.1)<1e-7);assert.ok(Math.abs(a.skinWeight1.getW(0)-.3)<1e-7);
 mesh.material=new THREE.MeshStandardMaterial();adapter.prepareMesh(mesh);const shader={vertexShader:THREE.ShaderLib.standard.vertexShader};mesh.material.onBeforeCompile(shader);assert.ok(shader.vertexShader.includes('ihfBone7'));
 const depth={vertexShader:THREE.ShaderLib.depth.vertexShader};mesh.customDepthMaterial.onBeforeCompile(depth);assert.ok(depth.vertexShader.includes('ihfBone7'));
 const distance={vertexShader:THREE.ShaderLib.distance.vertexShader};mesh.customDistanceMaterial.onBeforeCompile(distance);assert.ok(distance.vertexShader.includes('ihfBone7'));
});

test('ordinary four-influence meshes retain stock CPU and materials',options,()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([0,0,0,0],4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0],4));
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial()),original=mesh.applyBoneTransform;
 assert.equal(createEightInfluenceSkinning(THREE).prepareMesh(mesh),false);assert.equal(mesh.applyBoneTransform,original);assert.equal(mesh.customDepthMaterial,undefined);
});

test('malformed secondary skin attributes fail closed',options,async()=>{
 const {mesh}=await load();delete mesh.geometry.attributes.skinWeight1;delete mesh.geometry.attributes.weights_1;
 assert.throws(()=>createEightInfluenceSkinning(THREE).prepareMesh(mesh),/Incomplete secondary/);
});
