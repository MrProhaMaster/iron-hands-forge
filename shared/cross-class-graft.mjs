/** Selected-mesh donor graft with rest-pose conversion and up to eight influences.
 * Common joints follow the target rig. Missing helper chains retain their donor
 * local transforms below the nearest common joint. Donor bind geometry is
 * converted by weighted targetRest * inverse(donorRest), never just reindexed.
 */
import {Buffer} from 'node:buffer';
import {Matrix4,Vector3,Quaternion} from '../app/web/vendor/three.module.js';
const WIDTH={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const SIZE={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const fail=m=>{throw Error('Cross-class graft: '+m)};
function hierarchy(doc){
 const parent=new Map(),world=new Map();
 doc.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>{if(parent.has(c))fail('multiple node parents');parent.set(c,i)}));
 function local(n){if(n.matrix)return new Matrix4().fromArray(n.matrix);return new Matrix4().compose(new Vector3().fromArray(n.translation||[0,0,0]),new Quaternion().fromArray(n.rotation||[0,0,0,1]),new Vector3().fromArray(n.scale||[1,1,1]))}
 function get(i,trail=new Set()){if(world.has(i))return world.get(i);if(trail.has(i))fail('cyclic hierarchy');trail.add(i);const p=parent.get(i),m=local(doc.nodes[i]);if(p!==undefined)m.premultiply(get(p,trail));trail.delete(i);world.set(i,m);return m}
 return{parent,get};
}
export function readGraftAccessor(doc,bin,id){
 const a=doc.accessors?.[id];if(!a||a.sparse||a.bufferView===undefined)fail('missing or sparse accessor');
 const v=doc.bufferViews[a.bufferView],width=WIDTH[a.type],size=SIZE[a.componentType],stride=v.byteStride||width*size,at=(v.byteOffset||0)+(a.byteOffset||0);
 if(!width||!size||at+(a.count?((a.count-1)*stride+width*size):0)>bin.length)fail('accessor exceeds BIN');
 const view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const getters={5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'};
 return{accessor:a,width,read(row,col){let value=view[getters[a.componentType]](at+row*stride+col*size,true);
  if(a.normalized&&a.componentType!==5126){const max={5120:127,5121:255,5122:32767,5123:65535,5125:4294967295}[a.componentType];value=a.componentType===5120||a.componentType===5122?Math.max(-1,value/max):value/max}return value}};
}
export function graftCrossClassModel(baseDoc,baseBinLength,donorDoc,donorBin,{selectedNodes,meshRecords=[],slotId,sourceClassId,objectIdBase=1000000000,forceVisible=false}={}){
 if(!Array.isArray(selectedNodes)||!selectedNodes.length)fail('no selected donor geometry');
 const json=structuredClone(baseDoc);json.nodes??=[];json.meshes??=[];json.materials??=[];json.bufferViews??=[];json.accessors??=[];json.skins??=[];
 const donorH=hierarchy(donorDoc),targetH=hierarchy(json),targetJointIds=new Set(json.skins.flatMap(s=>s.joints||[]));
 // Only skeletal names may alias: a source mesh sharing a group name is never a bone.
 for(const i of [...targetJointIds])for(let p=targetH.parent.get(i);p!==undefined;p=targetH.parent.get(p))targetJointIds.add(p);
 const targetByName=new Map(),existingHelpers=new Map();
 for(let i=0;i<json.nodes.length;i++){const n=json.nodes[i];if(n.extras?.forgeCrossClassHelper&&n.extras.sourceClassId===sourceClassId)existingHelpers.set(n.extras.sourceBoneName,i)}
 for(const i of targetJointIds){const name=json.nodes[i]?.name;if(name&&!targetByName.has(name))targetByName.set(name,i)}
 const mapped=new Map(),helpers=[],chunks=[],newMeshRecords=[],objectRecords=[],donorMeshCopies=new Map(),materialCopies=new Map(),viewCopies=new Map(),accessorCopies=new Map(),skinCopies=new Map();
 let length=baseBinLength;
 function bytes(data,target){const pad=(-length)&3;if(pad){chunks.push(Buffer.alloc(pad));length+=pad}const i=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length,...(target?{target}:{})});chunks.push(data);length+=data.length;return i}
 function floats(values,type,count,min,max){
  const b=Buffer.alloc(values.length*4);for(let i=0;i<values.length;i++){if(!Number.isFinite(values[i]))fail('nonfinite converted vertex');b.writeFloatLE(values[i],i*4)}
  const id=json.accessors.length;json.accessors.push({bufferView:bytes(b),componentType:5126,count,type,...(min?{min}:{}),...(max?{max}:{})});return id;
 }
 function copyView(id){if(viewCopies.has(id))return viewCopies.get(id);const v=donorDoc.bufferViews[id],offset=v.byteOffset||0,ni=bytes(donorBin.subarray(offset,offset+v.byteLength),v.target);if(v.byteStride)json.bufferViews[ni].byteStride=v.byteStride;viewCopies.set(id,ni);return ni}
 function copyAccessor(id){if(accessorCopies.has(id))return accessorCopies.get(id);const a=structuredClone(donorDoc.accessors[id]);if(a.sparse)fail('sparse donor accessor');a.bufferView=copyView(a.bufferView);const ni=json.accessors.length;json.accessors.push(a);accessorCopies.set(id,ni);return ni}
 function mapJoint(id){
  if(mapped.has(id))return mapped.get(id);
  const node=donorDoc.nodes[id];if(!node)fail('invalid donor joint');
  const common=targetByName.get(node.name)??existingHelpers.get(node.name);
  if(common!==undefined){mapped.set(id,common);return common}
  const dp=donorH.parent.get(id),tp=dp===undefined?undefined:mapJoint(dp),ni=json.nodes.length;
  const added=structuredClone(node);delete added.mesh;delete added.skin;delete added.camera;delete added.children;
  added.name='Forge helper / '+sourceClassId+' / '+(node.name||id);
  added.extras={...added.extras,forgeCrossClassHelper:true,sourceClassId,sourceNode:id,sourceBoneName:node.name};
  json.nodes.push(added);mapped.set(id,ni);helpers.push(ni);
  if(tp!==undefined)(json.nodes[tp].children??=[]).push(ni);
  else for(const scene of json.scenes||[])(scene.nodes??=[]).push(ni);
  // The hierarchy's cache predates new helpers. Their world is target parent * donor local.
  targetH.parent.set(ni,tp);return ni;
 }
 function skinInfo(id){
  if(skinCopies.has(id))return skinCopies.get(id);
  const ds=donorDoc.skins?.[id];if(!ds?.joints?.length)fail('selected mesh has no donor skin');
  const joints=ds.joints.map(mapJoint),ibm=[],deltas=[];
  for(let j=0;j<joints.length;j++){
   const targetWorld=targetH.get(joints[j]),sourceWorld=donorH.get(ds.joints[j]);
   ibm.push(...targetWorld.clone().invert().elements);deltas.push(targetWorld.clone().multiply(sourceWorld.clone().invert()));
  }
  const newId=json.skins.length;
  json.skins.push({name:'Forge / '+sourceClassId+' / '+slotId,joints,inverseBindMatrices:floats(ibm,'MAT4',joints.length),...(ds.skeleton===undefined?{}:{skeleton:mapJoint(ds.skeleton)})});
  const info={index:newId,deltas,joints};skinCopies.set(id,info);return info;
 }
 function transformedAttribute(primitive,key,meshWorld,skin,morphAccessor){
  const src=readGraftAccessor(donorDoc,donorBin,morphAccessor??primitive.attributes[key]),isPosition=key==='POSITION'&&morphAccessor===undefined,isDelta=morphAccessor!==undefined,out=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  const attrs=primitive.attributes,sets=[];
  for(let set=0;set<2;set++){
   const ja=attrs['JOINTS_'+set],wa=attrs['WEIGHTS_'+set];
   if((ja===undefined)!==(wa===undefined))fail('incomplete influence set');
   if(ja!==undefined)sets.push([readGraftAccessor(donorDoc,donorBin,ja),readGraftAccessor(donorDoc,donorBin,wa)]);
  }
  if(!sets.length)fail('selected part has no skin weights');
  for(let row=0;row<src.accessor.count;row++){
   const point=new Vector3(src.read(row,0),src.read(row,1),src.read(row,2));
   if(isPosition)point.applyMatrix4(meshWorld);else if(isDelta){const e=meshWorld.elements,x=point.x,y=point.y,z=point.z;point.set(e[0]*x+e[4]*y+e[8]*z,e[1]*x+e[5]*y+e[9]*z,e[2]*x+e[6]*y+e[10]*z)}else point.transformDirection(meshWorld);
   const result=new Vector3();let sum=0;
   for(const [joints,weights]of sets)for(let col=0;col<4;col++){
    const w=weights.read(row,col);if(!Number.isFinite(w)||w<0)fail('invalid weight');if(!w)continue;
    const ji=joints.read(row,col);if(!Number.isInteger(ji)||ji<0||ji>=skin.deltas.length)fail('invalid joint palette index');
    const transformed=point.clone();if(isPosition)transformed.applyMatrix4(skin.deltas[ji]);else{
     // Match the skinning shader's linear normal/tangent transform; translation is excluded.
     const e=skin.deltas[ji].elements,x=point.x,y=point.y,z=point.z;
     transformed.set(e[0]*x+e[4]*y+e[8]*z,e[1]*x+e[5]*y+e[9]*z,e[2]*x+e[6]*y+e[10]*z);
    }
    result.addScaledVector(transformed,w);sum+=w;
   }
   if(sum<=1e-8)fail('zero-weight vertex');
   if(isPosition||isDelta)result.multiplyScalar(1/sum);else result.normalize();
   out.push(result.x,result.y,result.z);if(src.width===4)out.push(src.read(row,3));
   if(isPosition)for(let c=0;c<3;c++){const value=result.getComponent(c);min[c]=Math.min(min[c],value);max[c]=Math.max(max[c],value)}
  }
  return floats(out,src.accessor.type,src.accessor.count,isPosition?min:undefined,isPosition?max:undefined);
 }
 for(const [selectedIndex,nodeId]of selectedNodes.entries()){
  const node=donorDoc.nodes[nodeId];if(node?.mesh===undefined)fail('selected node has no mesh');if(node.skin===undefined)fail('unskinned donor geometry is unsupported');
  const skin=skinInfo(node.skin),meshWorld=donorH.get(nodeId),sourceMesh=donorDoc.meshes[node.mesh],mesh=structuredClone(sourceMesh);
  const objectId=objectIdBase+selectedIndex;
  mesh.name=forceVisible?(sourceMesh.name+' / Forge visible decal'):sourceMesh.name;
  mesh.extras={...mesh.extras,forgeSlot:slotId,forgeCrossClass:{sourceClassId,sourceNode:nodeId,sourceMesh:node.mesh},...(forceVisible?{forgeDecalCarrier:true}:{})};
  for(const primitive of mesh.primitives){
   const sourcePrimitive=structuredClone(primitive);
   if(Object.keys(primitive.attributes).some(k=>/^(JOINTS|WEIGHTS)_[2-9]/.test(k)))fail('more than eight influences');
   primitive.attributes=Object.fromEntries(Object.entries(primitive.attributes).map(([key,id])=>[key,['POSITION','NORMAL','TANGENT'].includes(key)?transformedAttribute(sourcePrimitive,key,meshWorld,skin):copyAccessor(id)]));
   if(primitive.indices!==undefined)primitive.indices=copyAccessor(primitive.indices);
   if(sourcePrimitive.targets)primitive.targets=sourcePrimitive.targets.map(target=>Object.fromEntries(Object.entries(target).map(([key,id])=>[key,transformedAttribute(sourcePrimitive,key,meshWorld,skin,id)])));
   if(primitive.material!==undefined){
    const sourceMaterial=primitive.material;if(!materialCopies.has(sourceMaterial)){materialCopies.set(sourceMaterial,json.materials.length);json.materials.push(structuredClone(donorDoc.materials[sourceMaterial]))}primitive.material=materialCopies.get(sourceMaterial);
   }
  }
  const mi=json.meshes.length;json.meshes.push(mesh);
  const ni=json.nodes.length;json.nodes.push({name:node.name||mesh.name,mesh:mi,skin:skin.index,...(node.weights?{weights:structuredClone(node.weights)}:{}),extras:{...node.extras,forgeSlot:slotId,forgeCrossClassMesh:true,sourceClassId,sourceNode:nodeId,...(forceVisible?{forgeDecalCarrier:true}:{})}});
  for(const scene of json.scenes||[])(scene.nodes??=[]).push(ni);
  const original=meshRecords[node.mesh]||{};
  newMeshRecords.push({...original,name:mesh.name,objectId,forgeSlot:slotId,sourceClassId,sourceObjectId:original.objectId});
  objectRecords.push({id:objectId,name:node.name||mesh.name,parentId:null});
 }
 json.buffers[0].byteLength=length;
 return{json,appendBinary:Buffer.concat(chunks),meshRecords:newMeshRecords,objectRecords,objectIds:newMeshRecords.map(m=>m.objectId),diagnostics:{sourceClassId,slotId,selectedMeshes:newMeshRecords.length,addedHelpers:helpers.length,preservedInfluenceSets:2,restPoseConverted:true},helperNodes:helpers};
}
