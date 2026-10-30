/** Source actor attachment: preserve its local rig beneath the exact owner object.
 * No bone-name remapping or rest-pose conversion is allowed for these mini rigs.
 */
import {Buffer} from 'node:buffer';
const fail=message=>{throw Error('Actor attachment: '+message)};
export function graftAttachedModel(baseDoc,baseBinLength,donorDoc,donorBin,{selectedNodes,meshRecords=[],slotId,sourceModelId,followNodeName,position=[0,0,0],rotation=[0,0,0,1],objectIdBase=1400000000}={}){
 if(!Array.isArray(selectedNodes)||!selectedNodes.length)fail('no selected visual geometry');
 if(typeof followNodeName!=='string'||!followNodeName)fail('no source follow object');
 if(!Array.isArray(position)||position.length!==3||!Array.isArray(rotation)||rotation.length!==4||[...position,...rotation].some(x=>typeof x!=='number'||!Number.isFinite(x))||Math.abs(Math.hypot(...rotation)-1)>1e-5)fail('invalid source offset');
 const json=structuredClone(baseDoc);
 for(const key of ['nodes','meshes','materials','bufferViews','accessors','skins'])json[key]??=[];
 const follows=json.nodes.flatMap((n,i)=>n.name===followNodeName?[i]:[]);
 if(follows.length!==1)fail('source follow object is missing or ambiguous: '+followNodeName);
 const follow=follows[0],parents=new Map(),needed=new Set();
 for(let i=0;i<(donorDoc.nodes||[]).length;i++)for(const child of donorDoc.nodes[i].children||[]){
  if(!Number.isInteger(child)||!donorDoc.nodes[child]||parents.has(child))fail('invalid donor hierarchy');parents.set(child,i);
 }
 const include=id=>{
  const chain=new Set();
  for(let at=id;at!==undefined;at=parents.get(at)){
   if(!Number.isInteger(at)||!donorDoc.nodes[at]||chain.has(at))fail('invalid or cyclic donor ancestry');
   chain.add(at);needed.add(at);
  }
 };
 const sourceSkins=new Set();
 for(const id of selectedNodes){
  const node=donorDoc.nodes[id];if(node?.mesh===undefined||!donorDoc.meshes?.[node.mesh])fail('selected visual node has no mesh');
  include(id);
  if(node.skin!==undefined){
   const skin=donorDoc.skins?.[node.skin];if(!skin?.joints?.length||skin.inverseBindMatrices===undefined)fail('invalid source skin');
   sourceSkins.add(node.skin);for(const joint of skin.joints)include(joint);if(skin.skeleton!==undefined)include(skin.skeleton);
  }
 }
 const prefix='Forge attachment / '+sourceModelId+' / ',rootIndex=json.nodes.length;
 json.nodes.push({name:prefix+'Follow',translation:[...position],rotation:[...rotation],children:[],extras:{forgeAttachmentRoot:true,forgeSlot:slotId,followNodeName,sourceModelId}});
 (json.nodes[follow].children??=[]).push(rootIndex);
 const nodeMap=new Map(),ordered=[...needed].sort((a,b)=>a-b);
 for(const id of ordered){
  const node=structuredClone(donorDoc.nodes[id]);delete node.mesh;delete node.skin;delete node.weights;delete node.children;delete node.camera;
  node.name=prefix+(donorDoc.nodes[id].name||id);node.extras={...node.extras,forgeAttachmentNode:true,sourceNode:id,sourceBoneName:donorDoc.nodes[id].name,sourceModelId,forgeSlot:slotId};
  nodeMap.set(id,json.nodes.length);json.nodes.push(node);
 }
 for(const id of ordered){
  const node=json.nodes[nodeMap.get(id)],children=(donorDoc.nodes[id].children||[]).filter(x=>nodeMap.has(x)).map(x=>nodeMap.get(x));
  if(children.length)node.children=children;
  if(!nodeMap.has(parents.get(id)))json.nodes[rootIndex].children.push(nodeMap.get(id));
 }
 const chunks=[],viewCopies=new Map(),accessorCopies=new Map(),skinCopies=new Map(),materialCopies=new Map();
 let length=baseBinLength;
 const bytes=(data,target)=>{
  const pad=(-length)&3;if(pad){chunks.push(Buffer.alloc(pad));length+=pad}
  const id=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length,...(target?{target}:{})});chunks.push(data);length+=data.length;return id;
 };
 const copyView=id=>{
  if(viewCopies.has(id))return viewCopies.get(id);const v=donorDoc.bufferViews?.[id];
  if(!v||v.buffer!==undefined&&v.buffer!==0||!Number.isInteger(v.byteLength)||v.byteLength<0)fail('invalid donor BIN view');
  const at=v.byteOffset||0;if(at<0||at+v.byteLength>donorBin.length)fail('donor BIN view exceeds payload');
  const next=bytes(donorBin.subarray(at,at+v.byteLength),v.target);if(v.byteStride)json.bufferViews[next].byteStride=v.byteStride;viewCopies.set(id,next);return next;
 };
 const copyAccessor=id=>{
  if(accessorCopies.has(id))return accessorCopies.get(id);const a=structuredClone(donorDoc.accessors?.[id]);
  if(!a||a.sparse||a.bufferView===undefined)fail('missing or sparse donor accessor');a.bufferView=copyView(a.bufferView);
  const next=json.accessors.length;json.accessors.push(a);accessorCopies.set(id,next);return next;
 };
 for(const id of sourceSkins){
  const skin=structuredClone(donorDoc.skins[id]);skin.name=prefix+(skin.name||'Skin '+id);skin.joints=skin.joints.map(x=>nodeMap.get(x));
  if(skin.skeleton!==undefined)skin.skeleton=nodeMap.get(skin.skeleton);skin.inverseBindMatrices=copyAccessor(skin.inverseBindMatrices);
  skinCopies.set(id,json.skins.length);json.skins.push(skin);
 }
 const records=[],objectRecords=[];
 for(const [selectedIndex,id]of selectedNodes.entries()){
  const originalNode=donorDoc.nodes[id],mesh=structuredClone(donorDoc.meshes[originalNode.mesh]),objectId=objectIdBase+selectedIndex;
  mesh.extras={...mesh.extras,forgeSlot:slotId,forgeActorAttachment:{sourceModelId,followNodeName,sourceNode:id}};
  for(const p of mesh.primitives){
   if(Object.keys(p.attributes).some(k=>/^(JOINTS|WEIGHTS)_[2-9]/.test(k)))fail('more than eight influences');
   p.attributes=Object.fromEntries(Object.entries(p.attributes).map(([k,a])=>[k,copyAccessor(a)]));
   if(p.indices!==undefined)p.indices=copyAccessor(p.indices);
   if(p.targets)p.targets=p.targets.map(t=>Object.fromEntries(Object.entries(t).map(([k,a])=>[k,copyAccessor(a)])));
   if(p.material!==undefined){
    if(!materialCopies.has(p.material)){materialCopies.set(p.material,json.materials.length);json.materials.push(structuredClone(donorDoc.materials[p.material]))}
    p.material=materialCopies.get(p.material);
   }
  }
  const meshIndex=json.meshes.length;json.meshes.push(mesh);
  const node=json.nodes[nodeMap.get(id)];node.mesh=meshIndex;if(originalNode.skin!==undefined)node.skin=skinCopies.get(originalNode.skin);
  if(originalNode.weights)node.weights=structuredClone(originalNode.weights);
  node.extras={...node.extras,forgeActorAttachment:true,forgeSlot:slotId,sourceObjectId:meshRecords[originalNode.mesh]?.objectId};
  const record=meshRecords[originalNode.mesh]||{};
  records.push({...record,name:mesh.name,objectId,sourceObjectId:record.objectId,forgeSlot:slotId,forgeActorAttachment:true});
  objectRecords.push({id:objectId,name:node.name,parentId:null,followNodeName,sourceModelId});
 }
 json.buffers??=[{byteLength:0}];json.buffers[0].byteLength=length;
 return{json,appendBinary:Buffer.concat(chunks),meshRecords:records,objectRecords,objectIds:records.map(r=>r.objectId),diagnostics:{sourceModelId,slotId,followNodeName,selectedMeshes:records.length,addedHelpers:ordered.length+1,preservedInfluenceSets:2,restPoseConverted:false,sourceActorFollow:true,originalInverseBindMatrices:true,position:[...position],rotation:[...rotation]}};
}
