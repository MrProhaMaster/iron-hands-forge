/** Append a native-bound left-arm addon without rewriting the retail model BIN.
 * Existing array indices remain stable. Only skin 0's palette/IBM accessor and
 * native parents' appended child links change; core local transforms never do.
 */
import {Buffer} from 'node:buffer';

const fail=message=>{throw new Error('Bionic graft: '+message)};
const index=(value,length,label)=>{
 if(!Number.isInteger(value)||value<0||value>=length)fail('invalid '+label);
 return value;
};
const array=(doc,key)=>{
 const value=doc[key]??[];
 if(!Array.isArray(value))fail('invalid '+key);
 return value;
};
const finite=(value,label)=>{
 if(!Number.isFinite(value))fail('nonfinite '+label);
 return value;
};
function localMatrix(node){
 if(node.matrix!==undefined){
  if(!Array.isArray(node.matrix)||node.matrix.length!==16)fail('invalid native matrix');
  return node.matrix.map(v=>finite(v,'native matrix'));
 }
 const t=node.translation??[0,0,0],q=node.rotation??[0,0,0,1],s=node.scale??[1,1,1];
 if(t.length!==3||q.length!==4||s.length!==3)fail('invalid native TRS');
 [...t,...q,...s].forEach(v=>finite(v,'native TRS'));
 const [x,y,z,w]=q,[sx,sy,sz]=s;
 return [(1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0,
  2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0,
  2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0,...t,1];
}
function parentsOf(nodes){
 const parents=new Map();
 nodes.forEach((node,parent)=>{
  for(const child of node.children??[]){
   index(child,nodes.length,'child node');
   if(parents.has(child))fail('node has multiple parents');
   parents.set(child,parent);
  }
 });
 for(let node=0;node<nodes.length;node++){
  const seen=new Set([node]);
  for(let p=parents.get(node);p!==undefined;p=parents.get(p)){
   if(seen.has(p))fail('cyclic node hierarchy');
   seen.add(p);
  }
 }
 return parents;
}
function uniqueNames(nodes){
 const names=new Map();
 nodes.forEach((node,id)=>{
  if(typeof node.name!=='string'||!node.name)return;
  const list=names.get(node.name)??[];list.push(id);names.set(node.name,list);
 });
 return names;
}
function singleBuffer(doc,label){
 if(!Array.isArray(doc.buffers)||doc.buffers.length!==1||doc.buffers[0].uri!==undefined||
    !Number.isSafeInteger(doc.buffers[0].byteLength)||doc.buffers[0].byteLength<0)fail(label+' must have one embedded buffer');
 return doc.buffers[0].byteLength;
}
function accessorReader(doc,binary,id){
 const a=array(doc,'accessors')[index(id,array(doc,'accessors').length,'accessor')];
 if(a.sparse)fail('sparse addon accessors are unsupported');
 const view=array(doc,'bufferViews')[index(a.bufferView,array(doc,'bufferViews').length,'accessor bufferView')];
 const sizes={5121:1,5123:2,5125:4,5126:4},components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
 const size=sizes[a.componentType],width=components[a.type];
 if(!size||!width||!Number.isSafeInteger(a.count)||a.count<0)fail('unsupported addon accessor layout');
 const offset=(view.byteOffset??0)+(a.byteOffset??0),stride=view.byteStride??size*width;
 if(stride<size*width||!Number.isSafeInteger(stride)||offset%size||
    offset<0||offset+(a.count?((a.count-1)*stride+size*width):0)>(view.byteOffset??0)+view.byteLength)fail('addon accessor exceeds its bufferView');
 const data=new DataView(binary.buffer,binary.byteOffset,binary.byteLength);
 return {accessor:a,width,read(row,col){
  const off=offset+row*stride+col*size;
  if(a.componentType===5121)return data.getUint8(off);
  if(a.componentType===5123)return data.getUint16(off,true);
  if(a.componentType===5125)return data.getUint32(off,true);
  return data.getFloat32(off,true);
 }};
}
function noMaterialTextures(value){
 if(!value||typeof value!=='object')return;
 for(const [key,item]of Object.entries(value)){
  if(key.endsWith('Texture')&&item&&typeof item==='object'&&'index'in item)fail('addon material textures are unsupported');
  noMaterialTextures(item);
 }
}

export function graftBionicModel(baseDoc,baseBinChunkLength,addonDoc,addonBin,optionRecord){
 if(!baseDoc||!addonDoc||typeof baseDoc!=='object'||typeof addonDoc!=='object')fail('invalid model document');
 const baseLength=singleBuffer(baseDoc,'base'),addonLength=singleBuffer(addonDoc,'addon');
 if(!Number.isSafeInteger(baseBinChunkLength)||baseBinChunkLength<baseLength||baseBinChunkLength-baseLength>3)fail('invalid base BIN chunk length');
 if(!(addonBin instanceof Uint8Array)||addonBin.byteLength<addonLength||addonBin.byteLength-addonLength>3)fail('invalid addon BIN payload');
 if(!Number.isSafeInteger(optionRecord?.objectId)||optionRecord.objectId<=0)fail('invalid custom object ID');
 const baseNodes=array(baseDoc,'nodes'),addonNodes=array(addonDoc,'nodes'),baseMeshes=array(baseDoc,'meshes');
 const baseSkins=array(baseDoc,'skins'),addonSkins=array(addonDoc,'skins');
 if(!baseSkins[0]||addonSkins.length!==1)fail('expected native skin 0 and one addon skin');
 if(array(addonDoc,'animations').length||array(addonDoc,'images').length||array(addonDoc,'textures').length)fail('addon must be static and contain no image resources');
 const baseParents=parentsOf(baseNodes),addonParents=parentsOf(addonNodes),baseNames=uniqueNames(baseNodes),addonNames=uniqueNames(addonNodes);
 const nativeMap=new Map(),roles=new Map(),mappedNative=new Set(),newIds=[];
 for(let i=0;i<addonNodes.length;i++){
  const node=addonNodes[i],extra=node.extras??{};
  const helper=extra.forgeBionicHelper===true||extra.forgeLeftBionicHelper===true;
  const geometry=extra.forgeBionicMesh===true;
  const nativeIndex=extra.sourceNativeNodeIndex??extra.forgeNativeNodeIndex;
  if(extra.sourceNativeNodeIndex!==undefined&&extra.forgeNativeNodeIndex!==undefined&&extra.sourceNativeNodeIndex!==extra.forgeNativeNodeIndex)fail('conflicting native index metadata');
  if(helper||geometry){
   if(helper&&geometry||nativeIndex!==undefined)fail('ambiguous helper/geometry/native node role');
   if(typeof node.name!=='string'||!node.name||baseNames.has(node.name))fail('new node name collides with native node');
   if((addonNames.get(node.name)??[]).length!==1)fail('duplicate new node name');
   if(helper&&node.mesh!==undefined||geometry&&node.mesh===undefined)fail('invalid helper/geometry node');
   roles.set(i,helper?'helper':'geometry');
   nativeMap.set(i,baseNodes.length+newIds.length);newIds.push(i);
   continue;
  }
  let target;
  if(nativeIndex!==undefined){
   target=index(nativeIndex,baseNodes.length,'native source node index');
   if(node.name!==undefined&&node.name!==baseNodes[target].name)fail('native node name/index mismatch');
  }else{
   const matches=baseNames.get(node.name)??[];
   if(matches.length!==1)fail('native node name is missing or ambiguous: '+node.name);
   target=matches[0];
  }
  if(mappedNative.has(target))fail('multiple addon nodes map to the same native node');
  if(node.mesh!==undefined)fail('addon core node unexpectedly owns geometry');
  const am=localMatrix(node),bm=localMatrix(baseNodes[target]);
  if(am.some((v,k)=>Math.abs(v-bm[k])>1e-5))fail('native local bind transform mismatch: '+node.name);
  mappedNative.add(target);nativeMap.set(i,target);roles.set(i,'native');
 }
 const nativeJoints=baseSkins[0].joints,addonJoints=addonSkins[0].joints;
 if(!Array.isArray(nativeJoints)||!Array.isArray(addonJoints)||addonJoints.length<nativeJoints.length)fail('invalid native joint palette');
 const mappedJoints=addonJoints.map(j=>nativeMap.get(index(j,addonNodes.length,'skin joint')));
 if(new Set(mappedJoints).size!==mappedJoints.length)fail('duplicate skin joints');
 for(let i=0;i<nativeJoints.length;i++){
  index(nativeJoints[i],baseNodes.length,'base skin joint');
  if(mappedJoints[i]!==nativeJoints[i])fail('native joint palette prefix mismatch');
 }
 for(const joint of addonJoints.slice(nativeJoints.length)){
  if(roles.get(joint)!=='helper'||addonNodes[joint].extras?.forgeHelperWeighted===false)fail('appended joint is not a weighted new helper');
 }
 for(const id of newIds)if(roles.get(id)==='helper'&&addonNodes[id].extras?.forgeHelperWeighted===true&&!addonJoints.includes(id))fail('weighted helper is missing from skin palette');
 if(addonSkins[0].skeleton!==undefined&&baseSkins[0].skeleton!==undefined&&nativeMap.get(addonSkins[0].skeleton)!==baseSkins[0].skeleton)fail('native skin skeleton mismatch');
 const ibm=accessorReader(addonDoc,addonBin,addonSkins[0].inverseBindMatrices);
 if(ibm.accessor.componentType!==5126||ibm.accessor.type!=='MAT4'||ibm.accessor.count!==mappedJoints.length)fail('IBM accessor does not cover full native/helper palette');
 for(let row=0;row<ibm.accessor.count;row++)for(let col=0;col<16;col++)finite(ibm.read(row,col),'inverse bind matrix');
 const json=structuredClone(baseDoc);
 json.nodes??=[];json.meshes??=[];json.bufferViews??=[];json.accessors??=[];json.materials??=[];
 const viewOffset=json.bufferViews.length,accessorOffset=json.accessors.length,materialOffset=json.materials.length,meshOffset=json.meshes.length;
 const padding=(-baseBinChunkLength)&3,addonStart=baseBinChunkLength+padding;
 for(const v of array(addonDoc,'bufferViews')){
  const start=v.byteOffset??0;
  if((v.buffer??0)!==0||!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(v.byteLength)||v.byteLength<0||start+v.byteLength>addonLength||v.extensions)fail('invalid or compressed addon bufferView');
  json.bufferViews.push({...structuredClone(v),buffer:0,byteOffset:addonStart+start});
 }
 for(const a of array(addonDoc,'accessors')){
  if(a.sparse)fail('sparse addon accessors are unsupported');
  index(a.bufferView,array(addonDoc,'bufferViews').length,'addon accessor bufferView');
  json.accessors.push({...structuredClone(a),bufferView:viewOffset+a.bufferView});
 }
 for(const mat of array(addonDoc,'materials')){noMaterialTextures(mat);json.materials.push(structuredClone(mat))}
 const addonMeshes=array(addonDoc,'meshes'),ownedMeshes=new Set();
 for(const id of newIds)if(roles.get(id)==='geometry'){
  const node=addonNodes[id];ownedMeshes.add(index(node.mesh,addonMeshes.length,'geometry mesh'));
  if((node.skin??0)!==0)fail('geometry uses unsupported addon skin');
 }
 if(!ownedMeshes.size||ownedMeshes.size!==addonMeshes.length)fail('addon has missing or unowned geometry');
 if(optionRecord.meshNames?.length&&
    (optionRecord.meshNames.length!==addonMeshes.length||addonMeshes.some(m=>!optionRecord.meshNames.includes(m.name))))fail('addon mesh names do not match library record');
 const meshRecords=[];
 for(let i=0;i<addonMeshes.length;i++){
  const mesh=structuredClone(addonMeshes[i]);
  if(typeof mesh.name!=='string'||!mesh.name||baseMeshes.some(m=>m.name===mesh.name))fail('new mesh name collides with native mesh');
  if(!Array.isArray(mesh.primitives)||!mesh.primitives.length)fail('addon mesh has no primitives');
  let vertices=0,faces=0;
  for(const p of mesh.primitives){
   if(p.mode!==undefined&&p.mode!==4||p.extensions?.KHR_draco_mesh_compression||p.extensions?.KHR_materials_variants)fail('unsupported addon primitive');
   const attrs=p.attributes??{};
   if(attrs.POSITION===undefined||attrs.JOINTS_0===undefined||attrs.WEIGHTS_0===undefined)fail('addon geometry has incomplete skin attributes');
   const position=accessorReader(addonDoc,addonBin,attrs.POSITION);vertices+=position.accessor.count;
   if(position.accessor.type!=='VEC3')fail('invalid addon POSITION');
   for(const key of Object.keys(attrs)){
    index(attrs[key],array(addonDoc,'accessors').length,'primitive attribute');
    if(/^(?:JOINTS|WEIGHTS)_[2-9]/.test(key))fail('more than eight skin influences are unsupported');
   }
   for(let set=0;set<2;set++){
    const jk='JOINTS_'+set,wk='WEIGHTS_'+set;
    if((attrs[jk]===undefined)!==(attrs[wk]===undefined))fail('incomplete skin influence set');
    if(attrs[jk]===undefined)continue;
    const joints=accessorReader(addonDoc,addonBin,attrs[jk]),weights=accessorReader(addonDoc,addonBin,attrs[wk]);
    if(joints.accessor.type!=='VEC4'||![5121,5123].includes(joints.accessor.componentType)||joints.accessor.normalized||
       weights.accessor.type!=='VEC4'||joints.accessor.count!==position.accessor.count||weights.accessor.count!==position.accessor.count)fail('invalid skin influence layout');
    for(let row=0;row<joints.accessor.count;row++)for(let col=0;col<4;col++){
     index(joints.read(row,col),mappedJoints.length,'geometry joint palette index');
     if(weights.read(row,col)<0||!Number.isFinite(weights.read(row,col)))fail('invalid geometry weight');
    }
   }
   if(p.indices!==undefined){
    const ix=accessorReader(addonDoc,addonBin,p.indices);
    if(ix.accessor.type!=='SCALAR'||![5121,5123,5125].includes(ix.accessor.componentType)||ix.accessor.count%3)fail('invalid triangle indices');
    for(let row=0;row<ix.accessor.count;row++)index(ix.read(row,0),position.accessor.count,'geometry vertex index');
    faces+=ix.accessor.count/3;p.indices+=accessorOffset;
   }else{if(position.accessor.count%3)fail('invalid unindexed triangle count');faces+=position.accessor.count/3}
   p.attributes=Object.fromEntries(Object.entries(attrs).map(([key,value])=>[key,value+accessorOffset]));
   if(p.targets)p.targets=p.targets.map(target=>Object.fromEntries(Object.entries(target).map(([key,value])=>[key,index(value,array(addonDoc,'accessors').length,'morph accessor')+accessorOffset])));
   if(p.material!==undefined)p.material=index(p.material,array(addonDoc,'materials').length,'primitive material')+materialOffset;
  }
  mesh.extras={...mesh.extras,sourceObjectId:optionRecord.objectId,forgeLeftBionic:true};
  json.meshes.push(mesh);
  meshRecords.push({name:mesh.name,objectId:optionRecord.objectId,lod:0,vertices,faces,gltfMeshIndex:meshOffset+i});
 }
 for(const id of newIds){
  const node=structuredClone(addonNodes[id]);delete node.children;
  if(node.camera!==undefined)fail('new addon nodes cannot own cameras');
  if(roles.get(id)==='geometry'){
   node.mesh+=meshOffset;node.skin=0;
   node.extras={...node.extras,sourceObjectId:optionRecord.objectId,source_name:json.meshes[node.mesh].name,forgeLeftBionic:true};
  }else if(node.skin!==undefined)fail('helper node cannot own a skin');
  json.nodes.push(node);
 }
 const rootNodes=[];
 for(let id=0;id<addonNodes.length;id++){
  const role=roles.get(id),node=addonNodes[id],extra=node.extras??{},parent=addonParents.get(id);
  if(role==='native'){
   if(parent!==undefined&&(roles.get(parent)!=='native'||baseParents.get(nativeMap.get(id))!==nativeMap.get(parent)))fail('native node hierarchy mismatch');
   continue;
  }
  let targetParent=parent===undefined?undefined:nativeMap.get(parent);
  if(extra.forgeParentNativeNodeIndex!==undefined){
   const declared=index(extra.forgeParentNativeNodeIndex,baseNodes.length,'helper native parent');
   if(targetParent!==undefined&&targetParent!==declared)fail('helper native parent metadata mismatch');
   targetParent=declared;
  }
  if(extra.forgeParentHelperName!==undefined){
   const names=addonNames.get(extra.forgeParentHelperName)??[];
   if(names.length!==1||roles.get(names[0])!=='helper')fail('helper parent name is missing or ambiguous');
   const declared=nativeMap.get(names[0]);
   if(targetParent!==undefined&&targetParent!==declared)fail('helper parent metadata mismatch');
   targetParent=declared;
  }
  if(targetParent===undefined){if(role==='helper')fail('detached new helper');rootNodes.push(nativeMap.get(id))}
  else{
   if(targetParent===nativeMap.get(id))fail('helper is its own parent');
   const children=json.nodes[targetParent].children??=[];
   if(!children.includes(nativeMap.get(id)))children.push(nativeMap.get(id));
  }
 }
 parentsOf(json.nodes);
 const sceneIndex=json.scene??0;
 if(!json.scenes?.[sceneIndex]||!Array.isArray(json.scenes[sceneIndex].nodes))fail('base has no default scene roots');
 json.scenes[sceneIndex].nodes.push(...rootNodes);
 json.skins[0].joints=mappedJoints;
 json.skins[0].inverseBindMatrices=accessorOffset+addonSkins[0].inverseBindMatrices;
 json.buffers[0].byteLength=addonStart+addonLength;
 for(const key of ['extensionsUsed','extensionsRequired']){
  const combined=[...new Set([...(baseDoc[key]??[]),...(addonDoc[key]??[])])];
  if(combined.length)json[key]=combined;
 }
 json.asset??={version:'2.0'};
 json.asset.extras={...json.asset.extras,forgeLeftBionic:{objectId:optionRecord.objectId,optionId:optionRecord.optionId,sha256:optionRecord.sha256}};
 const trailing=(-json.buffers[0].byteLength)&3;
 const appendBinary=Buffer.concat([Buffer.alloc(padding),Buffer.from(addonBin.buffer,addonBin.byteOffset,addonLength),Buffer.alloc(trailing)]);
 const objectRecord={id:optionRecord.objectId,name:optionRecord.optionId??'forge_left_bionic_v1',parentId:null};
 return {json,appendBinary,meshRecords,objectRecord};
}
