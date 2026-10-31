import {resolveMotionBinding,motionPreviewChannels} from '../shared/motion-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {normalizeRecipe,decodeRecipe} from '../shared/recipe-codec.mjs';
import leftBionic from '../shared/left-bionic.cjs';
import {graftBionicModel} from '../shared/bionic-graft.mjs';
import {augmentCustomizationRegistry} from '../shared/customization-catalog.mjs';
import {excludedPartSelection} from '../shared/part-exclusions.mjs';
import {graftCrossClassModel} from '../shared/cross-class-graft.mjs';
import {graftAttachedModel} from '../shared/attachment-graft.mjs';
import {applyBodyFrameScale} from '../shared/body-frame-scale.mjs';
import {createSourceGeometryClassifier,classifySourceGeometry} from '../shared/source-geometry.mjs';
import {resolveAppearance,classifyMaterialRole} from '../shared/appearance.mjs';
import ironHands from '../shared/iron-hands-library.cjs';
import astartes from '../shared/astartes-library.cjs';
import {renderDecalTexture,renderSourceDecalTexture,NATIVE_DECAL_SAMPLER} from '../shared/iron-hands-appearance.mjs';
import {sourceDecalCarriers} from '../shared/source-decal-carriers.mjs';
import {loadServoPose,applyServoPose} from '../shared/servo-arm.mjs';
import {filterServoMotionChannels} from '../shared/servo-motion-policy.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const VERSION=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceRender=record=>classifySourceGeometry(record).render;
function readMetadata(file){const meta=read(file),classify=createSourceGeometryClassifier(meta);meta.meshes=meta.meshes.map(record=>({...record,forgeSourceGeometry:classify(record)}));return meta;}
const linear=h=>[1,3,5].map(i=>{const v=parseInt(h.slice(i,i+2),16)/255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)});
function prototypeMaterial(original,name,paint,soldier,slot){const lower=((original?.name||'')+' '+name).toLowerCase();let color=paint.armor,metallic=.12,rough=.48,alpha=1,emissive;
 if(/undersuit|rubber/.test(lower)){color='#101215';metallic=0;rough=.78}
 else if(/tabard|cloth|seal|rope|hair/.test(lower)){color='#51483c';metallic=0;rough=.85}
 else if(/bag|belt|leather/.test(lower)){color='#372e28';metallic=0;rough=.7}
 else if(/lenses|optic/.test(lower)){color=paint.lenses;metallic=.1;rough=.2;emissive=linear(color)}
 else if(/glass/.test(lower)){color='#18232c';alpha=.18;rough=.12}
 else if(/preview_steel|forge_left_bionic|ch_cato_hand_lod|ch_tech_marine_mecharm|soldier_arm_r_02|soldier_hand_l_01/.test(lower)){color=paint.metal;metallic=.85;rough=.34}
 else if(/head_|skin|eye_/.test(lower)&&!/helmet/.test(lower)){color='#a18a79';metallic=0;rough=.7}
 {const role=classifyMaterialRole(original?.name||'',name),value=resolveAppearance(soldier,slot,role);color=value.color;metallic=value.metallic;rough=value.roughness;alpha=value.opacity;emissive=value.emissive?linear(value.emissive):undefined}
 if(/_decal$/.test(name))alpha=0;
 return{name:'Forge preview / '+(original?.name||name),pbrMetallicRoughness:{baseColorFactor:[...linear(color),alpha],metallicFactor:metallic,roughnessFactor:rough},...(alpha<1?{alphaMode:'BLEND',doubleSided:true}:{}),...(emissive?{emissiveFactor:emissive}:{}),extras:{sourceMaterial:original?.name,previewMaterial:true,...(/_decal$/.test(name)?{forgeInvisibleDecal:true}:{})}};
}
function loadGLB(file){const b=fs.readFileSync(file);if(b.length<28||b.readUInt32LE(0)!==0x46546c67||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length)throw Error('Invalid GLB: '+file);const len=b.readUInt32LE(12);if(28+len>b.length||b.readUInt32LE(16)!==0x4e4f534a||b.readUInt32LE(24+len)!==0x004e4942||b.readUInt32LE(20+len)!==b.length-28-len)throw Error('Invalid GLB chunks: '+file);const json=JSON.parse(b.subarray(20,20+len)),bin=b.subarray(28+len);return{bytes:b,json,bin}}
export async function buildRecipe(input,{dataRoot,out,onlySlots}={}){
 if(onlySlots!==undefined&&(!Array.isArray(onlySlots)||onlySlots.some(x=>typeof x!=='string')))throw Error('onlySlots must be slot IDs');
 const recipe=normalizeRecipe(input),motionConfig=read(path.join(ROOT,'shared/motion-bindings.json'));dataRoot=path.resolve(dataRoot);out=path.resolve(out);fs.mkdirSync(out,{recursive:true});
 const servoLibrary=loadServoPose(dataRoot),library=leftBionic.loadBionicLibrary(dataRoot),ironHandsLibrary=ironHands.loadIronHandsLibrary(dataRoot),astartesLibrary=astartes.loadAstartesLibrary(dataRoot),nativeRegistry=astartes.augmentAstartesRegistry(ironHands.augmentIronHandsRegistry(leftBionic.augmentBionicRegistry(read(path.join(dataRoot,'production/roster/armor-options.json')),library),ironHandsLibrary),astartesLibrary),registry=augmentCustomizationRegistry(nativeRegistry),sourceRoot=path.join(dataRoot,'assets/characters/SM2-retail-constructors/source-v5'),sourceManifest=read(path.join(sourceRoot,'manifest.json'));
 const {Matrix4,Vector3,Quaternion}=await import(pathToFileURL(path.join(ROOT,'app/web/vendor/three.module.js')).href);
 const plans=recipe.soldiers.map(s=>{const c=registry.classes.find(c=>c.id===s.classId&&c.available);if(!c)throw Error('Unsupported class: '+s.classId);if(!/^[A-Za-z0-9_]+$/.test(c.tpl))throw Error('Unsafe template name');const record=sourceManifest.assets.find(a=>a.asset===c.tpl&&a.transformValidation==='passed'&&a.restSkinValidation==='passed'&&a.weightPackingValidation==='passed'&&a.skinProfileWeldValidation==='passed');if(!record)throw Error('No verified V5 model: '+s.classId);const parts=[];for(const [slotId,optionId]of Object.entries(s.selection)){const restricted=astartes.restrictedPartSelection(astartesLibrary,s.classId,slotId,optionId);if(restricted){const error=Error('This armour part is only available for the Terminator body frame: '+restricted.name+' ('+optionId+')');error.code='incompatible_body_frame';error.optionId=restricted.id;error.allowedClassIds=restricted.allowedClassIds;throw error}}for(const slot of c.slots){const id=s.selection[slot.id];if(!id){if(slot.forgeAddedSlot)continue;if(slot.options.every(o=>o.equipmentActorMeshes?.length&&!o.meshes?.length))continue;throw Error('Missing armour selection '+slot.id)}const option=slot.options.find(o=>o.id===id);if(!option){const excluded=excludedPartSelection(nativeRegistry,s.classId,slot.id,id);if(excluded)throw Error('This armour part was removed from the Forge registry: '+excluded.name+' ('+id+')');throw Error('Unknown armour option '+slot.id+': '+id)}if(option.forgeUnavailable)throw Error('Astartes source geometry is unavailable: '+id);if(option.equipmentActorMeshes?.length&&!option.meshes?.length)throw Error('External equipment is not connected: '+id);if(!Array.isArray(option.resolvedObjectIds))throw Error('Unresolved local catalogue: '+id);if(option.meshes?.length&&!option.resolvedObjectIds.length)throw Error('Geometry unavailable: '+id);if(!onlySlots||onlySlots.includes(slot.id))parts.push({slot:slot.id,option})}for(const key of Object.keys(s.selection))if(!c.slots.some(x=>x.id===key))throw Error('Unknown armour slot: '+key);return{s,c,parts}});
 const files=[],astartesDonors=new Map();
 for(let index=0;index<plans.length;index++){
  const {s,c,parts:sourceParts}=plans[index],parts=sourceParts.flatMap(p=>p.option.forgeAstartes&&p.option.components?p.option.components.map((component,componentIndex)=>({slot:p.slot,option:{...p.option,...component,attachment:component.attachment,components:undefined,forgeAstartes:{...p.option.forgeAstartes,modelId:component.sourceAsset,componentIndex}}})):[p]),frameModel=c.forgeBodyFrame?astartes.resolveAstartesModel(astartesLibrary,c):null,file=frameModel?astartes.resourcePath(dataRoot,frameModel.glb):path.join(sourceRoot,c.tpl+'.glb'),source=loadGLB(file),bytes=source.bytes,meta=readMetadata(frameModel?astartes.resourcePath(dataRoot,frameModel.metadata):path.join(sourceRoot,c.tpl+'.json'));
  let old=source.json,bin=source.bin;
  if(old.meshes.length!==meta.meshes.length||old.meshes.some((m,i)=>m.name!==meta.meshes[i].name))throw Error('Source mesh identity check failed');
  const directAstartes=p=>!p.option.attachment&&p.option.forgeAstartes?.modelId===frameModel?.id&&!!frameModel;
  const nativeParts=parts.filter(p=>directAstartes(p)||!p.option.forgeCrossClass&&!p.option.forgeAstartes),foreignParts=parts.filter(p=>p.option.forgeCrossClass&&!p.option.forgeAstartes&&p.option.meshes.length),astartesParts=parts.filter(p=>p.option.forgeAstartes&&!directAstartes(p)&&p.option.meshes.length);
  const addon=nativeParts.some(p=>p.option.forgeBionic)?leftBionic.loadBionicClass({dataRoot,classId:s.classId,asset:c.tpl}):null;
  if(addon){const graft=graftBionicModel(old,bin.length,addon.addonDoc,addon.addonBin,addon.optionRecord);old=graft.json;bin=Buffer.concat([bin,graft.appendBinary]);meta.meshes.push(...graft.meshRecords);meta.objectMetadata??=[];meta.objectMetadata.push(graft.objectRecord)}
  let objectIds=new Set(nativeParts.flatMap(p=>p.option.resolvedObjectIds));
  if(typeof leftBionic.filterBionicObjectIds==='function')objectIds=new Set(leftBionic.filterBionicObjectIds(nativeParts,objectIds));
  else if(addon&&objectIds.has(addon.optionRecord.objectId))for(const id of addon.optionRecord.excludeObjectIds??[])objectIds.delete(id);
  const importedSourceObjects=new Set(),graftDiagnostics=[],slotByObjectId=new Map(nativeParts.flatMap(p=>p.option.resolvedObjectIds.map(id=>[id,p.slot])));
  for(let donorIndex=0;donorIndex<foreignParts.length;donorIndex++){
   const part=foreignParts[donorIndex],ref=part.option.forgeCrossClass,donorClass=nativeRegistry.classes.find(x=>x.available&&x.id===ref.classId&&x.tpl===ref.asset);
   if(!donorClass)throw Error('Foreign armour source is not in the packaged catalogue: '+ref.classId);
   const donorOption=donorClass.slots.find(x=>x.id===ref.slotId)?.options.find(x=>x.id===ref.optionId);
   if(!donorOption||JSON.stringify(donorOption.resolvedObjectIds)!==JSON.stringify(part.option.resolvedObjectIds))throw Error('Foreign armour catalogue identity mismatch');
   const verified=sourceManifest.assets.find(a=>a.asset===ref.asset&&a.transformValidation==='passed'&&a.restSkinValidation==='passed'&&a.weightPackingValidation==='passed'&&a.skinProfileWeldValidation==='passed');
   if(!verified)throw Error('Foreign armour source has not passed source validation');
   const donor=loadGLB(path.join(sourceRoot,ref.asset+'.glb')),donorMeta=readMetadata(path.join(sourceRoot,ref.asset+'.json')),ids=new Set(donorOption.resolvedObjectIds);
   if(donorOption.forgeBionic){const bionic=leftBionic.loadBionicClass({dataRoot,classId:ref.classId,asset:ref.asset}),prepared=graftBionicModel(donor.json,donor.bin.length,bionic.addonDoc,bionic.addonBin,bionic.optionRecord);donor.json=prepared.json;donor.bin=Buffer.concat([donor.bin,prepared.appendBinary]);donorMeta.meshes.push(...prepared.meshRecords);donorMeta.objectMetadata??=[];donorMeta.objectMetadata.push(prepared.objectRecord)}
   const selected=donor.json.nodes.flatMap((n,i)=>n.mesh!==undefined&&ids.has(donorMeta.meshes[n.mesh].objectId)&&!importedSourceObjects.has('native:'+ref.asset+':'+donorMeta.meshes[n.mesh].objectId)&&sourceRender(donorMeta.meshes[n.mesh])?[i]:[]);
   if(!selected.length){if(donor.json.nodes.some(n=>n.mesh!==undefined&&ids.has(donorMeta.meshes[n.mesh].objectId)&&sourceRender(donorMeta.meshes[n.mesh])))continue;throw Error('Selected foreign armour has no render geometry')}
   for(const node of selected)importedSourceObjects.add('native:'+ref.asset+':'+donorMeta.meshes[donor.json.nodes[node].mesh].objectId);
   const graft=graftCrossClassModel(old,bin.length,donor.json,donor.bin,{selectedNodes:selected,meshRecords:donorMeta.meshes,slotId:part.slot,sourceClassId:ref.classId,objectIdBase:1000000000+donorIndex*100000});
   old=graft.json;bin=Buffer.concat([bin,graft.appendBinary]);meta.meshes.push(...graft.meshRecords);meta.objectMetadata??=[];meta.objectMetadata.push(...graft.objectRecords);
   for(const id of graft.objectIds){objectIds.add(id);slotByObjectId.set(id,part.slot)}
   graftDiagnostics.push(graft.diagnostics);
  }
  for(let donorIndex=0;donorIndex<astartesParts.length;donorIndex++){
   const part=astartesParts[donorIndex],ref=part.option.forgeAstartes,model=astartes.resolveAstartesModel(astartesLibrary,ref.modelId);
   const sourceOption=astartesLibrary.options.find(o=>o.id===ref.optionId&&o.slotId===ref.slotId),record=ref.componentIndex===undefined?sourceOption:sourceOption?.components?.[ref.componentIndex];
   if(!record||record.sourceAsset!==ref.modelId||JSON.stringify(record.resolvedObjectIds)!==JSON.stringify(part.option.resolvedObjectIds))throw Error('Astartes option catalogue identity mismatch');
   let cached=astartesDonors.get(model.id);if(!cached){cached={donor:loadGLB(astartes.resourcePath(dataRoot,model.glb)),donorMeta:readMetadata(astartes.resourcePath(dataRoot,model.metadata))};astartesDonors.set(model.id,cached)}
   const {donor,donorMeta}=cached,ids=new Set(record.resolvedObjectIds);
   if(donor.json.meshes.length!==donorMeta.meshes.length||donor.json.meshes.some((m,i)=>m.name!==donorMeta.meshes[i].name))throw Error('Astartes source mesh identity check failed');
   const selected=donor.json.nodes.flatMap((n,i)=>n.mesh!==undefined&&ids.has(donorMeta.meshes[n.mesh].objectId)&&!importedSourceObjects.has('astartes:'+model.id+':'+donorMeta.meshes[n.mesh].objectId)&&sourceRender(donorMeta.meshes[n.mesh])?[i]:[]);
   if(!selected.length){if(donor.json.nodes.some(n=>n.mesh!==undefined&&ids.has(donorMeta.meshes[n.mesh].objectId)&&sourceRender(donorMeta.meshes[n.mesh])))continue;throw Error('Selected Astartes armour has no render geometry')}
   for(const node of selected)importedSourceObjects.add('astartes:'+model.id+':'+donorMeta.meshes[donor.json.nodes[node].mesh].objectId);
   const graft=record.attachment?graftAttachedModel(old,bin.length,donor.json,donor.bin,{selectedNodes:selected,meshRecords:donorMeta.meshes,slotId:part.slot,sourceModelId:model.id,...record.attachment,objectIdBase:1200000000+donorIndex*100000}):graftCrossClassModel(old,bin.length,donor.json,donor.bin,{selectedNodes:selected,meshRecords:donorMeta.meshes,slotId:part.slot,sourceClassId:model.sourceClassId,objectIdBase:1200000000+donorIndex*100000});
   old=graft.json;bin=Buffer.concat([bin,graft.appendBinary]);meta.meshes.push(...graft.meshRecords.map((record,i)=>({...record,forgeAstartesModel:model.id,forgeAstartesSourceMesh:donor.json.nodes[selected[i]].mesh})));meta.objectMetadata??=[];meta.objectMetadata.push(...graft.objectRecords);
   for(const id of graft.objectIds){objectIds.add(id);slotByObjectId.set(id,part.slot)}
   graftDiagnostics.push({...graft.diagnostics,astartesModel:model.id,astartesOption:sourceOption.sourceOptionId,...(ref.componentIndex!==undefined?{componentIndex:ref.componentIndex}:{})});
  }
  const decalByObjectId=new Map();
  for(const [decalSlot,appearance]of Object.entries(s.appearance?.decals||{})){
   if(onlySlots&&!onlySlots.includes(decalSlot))continue;
   const part=parts.find(p=>p.slot===decalSlot);if(!part)throw Error('Decal has no selected armour slot: '+decalSlot);
   if(part.option.forgeAstartes){
    const sourceCarrierIds=[],targetCarrierIds=[];
    for(const component of parts.filter(p=>p.slot===decalSlot&&p.option.forgeAstartes)){
     const ref=component.option.forgeAstartes,model=astartes.resolveAstartesModel(astartesLibrary,ref.modelId);
     let cached=astartesDonors.get(model.id);if(!cached){cached={donor:loadGLB(astartes.resourcePath(dataRoot,model.glb)),donorMeta:readMetadata(astartes.resourcePath(dataRoot,model.metadata))};astartesDonors.set(model.id,cached)}
     const carriers=sourceDecalCarriers({slot:decalSlot,option:component.option,metadata:cached.donorMeta,document:cached.donor.json});
     if(!carriers.supported)continue;
     const indices=new Set(carriers.meshIndices);
     const targets=meta.meshes.filter((record,i)=>objectIds.has(record.objectId)&&slotByObjectId.get(record.objectId)===decalSlot&&((frameModel?.id===model.id&&!record.forgeAstartesModel&&indices.has(i))||(record.forgeAstartesModel===model.id&&indices.has(record.forgeAstartesSourceMesh))));
     if(!targets.length)throw Error('Selected source decal surface was not included in the assembled pauldron');
     sourceCarrierIds.push(...carriers.objectIds);targetCarrierIds.push(...targets.map(record=>record.objectId));
    }
    if(!targetCarrierIds.length)throw Error('This pauldron has no emblem area. Choose a blank pauldron to apply this emblem.');
    const request={slot:decalSlot,decalId:appearance.id,color:appearance.color,secondaryColor:appearance.secondaryColor,tertiaryColor:appearance.tertiaryColor};
    const rendered=renderSourceDecalTexture(dataRoot,ironHandsLibrary,request,{carrierObjectIds:[...new Set(sourceCarrierIds)]});
    for(const id of new Set(targetCarrierIds))decalByObjectId.set(id,{...rendered,decalId:appearance.id,slot:decalSlot});
    graftDiagnostics.push({astartesDecal:appearance.id,slotId:decalSlot,sourceCarrierReused:true,sourceCarrierObjectIds:[...new Set(sourceCarrierIds)],targetCarrierObjectIds:[...new Set(targetCarrierIds)],nativeUV0:true});
    continue;
   }
   const ref=part.option.forgeCrossClass;
   const request={classId:ref?.classId||s.classId,slot:decalSlot,armorOptionId:ref?.optionId||part.option.id,decalId:appearance.id,color:appearance.color,secondaryColor:appearance.secondaryColor,tertiaryColor:appearance.tertiaryColor};
   const plan=ironHands.resolveIronHandsDecal(ironHandsLibrary,request);if(plan.clear)continue;
   const rendered=renderDecalTexture(dataRoot,ironHandsLibrary,request),donor=loadGLB(ironHands.resourcePath(dataRoot,plan.carrierGLB));
   const selected=[...new Set(plan.carriers.flatMap(x=>x.glbNodeIndices))];
   const carrierMeta=donor.json.meshes.map((mesh,mi)=>({name:mesh.name,objectId:plan.carriers.find(x=>x.glbMeshIndices.includes(mi))?.nativeObjectId}));
   const graft=graftCrossClassModel(old,bin.length,donor.json,donor.bin,{selectedNodes:selected,meshRecords:carrierMeta,slotId:decalSlot,sourceClassId:request.classId,objectIdBase:1500000000+decalByObjectId.size*10000,forceVisible:true});
   old=graft.json;bin=Buffer.concat([bin,graft.appendBinary]);meta.meshes.push(...graft.meshRecords);meta.objectMetadata??=[];meta.objectMetadata.push(...graft.objectRecords);
   for(const id of graft.objectIds){objectIds.add(id);slotByObjectId.set(id,decalSlot);decalByObjectId.set(id,{...rendered,decalId:appearance.id,slot:decalSlot})}
   graftDiagnostics.push({...graft.diagnostics,nativeDecal:appearance.id});
  }
  const servoPose=applyServoPose(old,servoLibrary,{parts,targetClassId:s.classId});old=servoPose.json;
  const servoSummary={applied:servoPose.applied,reason:servoPose.reason,policy:servoPose.policy,revision:servoPose.revision,bones:servoPose.bones,originalInverseBindMatrices:servoPose.originalInverseBindMatrices,tubeBindPreserved:servoPose.tubeBindPreserved,source:servoPose.source};
  const selectedNodes=new Set(old.nodes.flatMap((n,i)=>n.mesh!==undefined&&objectIds.has(meta.meshes[n.mesh].objectId)&&sourceRender(meta.meshes[n.mesh])?[i]:[]));
  if(!selectedNodes.size){const error=Error('Recipe contains no geometry');error.code='no_geometry';throw error}
  const sourceOwners=new Set([...selectedNodes].map(i=>meta.meshes[old.nodes[i].mesh].objectId));
  for(const id of objectIds)if(!sourceOwners.has(id)&&meta.meshes.some(m=>m.objectId===id&&sourceRender(m)))throw Error('Missing requested source object '+id);
  const motion=s.motion||null;
  const binding=motion?resolveMotionBinding(motionConfig,s.classId,motion.gait,motion.stance):null;if(binding&&binding.asset!==c.tpl)throw Error('Motion and body template do not match');
  const clipPath=binding?path.join(dataRoot,'assets/animations',binding.output):null;
  if(clipPath&&!fs.existsSync(clipPath))throw Error('The selected motion clip is not prepared locally');
  const clip=clipPath?read(clipPath):null,previewChannels=clip?filterServoMotionChannels(motionPreviewChannels(clip,binding),servoPose.applied):[];
  const byName=new Map(old.nodes.map((n,i)=>[n.name,i])),parent=new Map();old.nodes.forEach((n,i)=>(n.children||[]).forEach(ch=>parent.set(ch,i)));
  const matched=clip?previewChannels.filter(ch=>byName.has(ch.name)):[],missing=clip?previewChannels.filter(ch=>!byName.has(ch.name)).map(c=>c.name):[];
  const helpers=old.nodes.flatMap((n,i)=>n.extras?.forgeBionicHelper||n.extras?.forgeLeftBionicHelper||n.extras?.forgeCrossClassHelper?[i]:[]);
  const keep=new Set([...selectedNodes,...old.skins.flatMap(s=>s.joints),...helpers,...matched.map(ch=>byName.get(ch.name))]);for(const id of [...keep])for(let p=parent.get(id);p!==undefined;p=parent.get(p))keep.add(p);
  const nodeIds=[...keep].sort((a,b)=>a-b),nodeMap=new Map(nodeIds.map((id,i)=>[id,i])),meshIds=[...new Set([...selectedNodes].map(i=>old.nodes[i].mesh))].sort((a,b)=>a-b),meshMap=new Map(meshIds.map((id,i)=>[id,i]));
  const g={asset:{version:'2.0',generator:'Iron Hands Forge '+VERSION,extras:{recipe:s,catalog:recipe.catalog,sourceVersion:5,sourceAsset:c.tpl,sourceSHA256:hash(bytes),...(c.forgeBodyFrame?{forgeBodyFrame:c.forgeBodyFrame}:{}),prototypeMaterials:true,servoStartupPose:servoSummary,forgeServoPose:servoSummary}},scene:0,scenes:[{name:s.role,nodes:old.scenes[old.scene||0].nodes.filter(n=>nodeMap.has(n)).map(n=>nodeMap.get(n))}],nodes:nodeIds.map(id=>{const n=structuredClone(old.nodes[id]);if(n.mesh!==undefined){if(selectedNodes.has(id)){const mi=n.mesh;n.mesh=meshMap.get(mi);n.extras={...n.extras,source_name:old.meshes[mi].name,sourceObjectId:meta.meshes[mi].objectId,forgeSlot:slotByObjectId.get(meta.meshes[mi].objectId)||n.extras?.forgeSlot}}else{delete n.mesh;delete n.skin}}if(n.children)n.children=n.children.filter(n=>nodeMap.has(n)).map(n=>nodeMap.get(n));delete n.camera;return n}),skins:old.skins.map(s=>({...structuredClone(s),joints:s.joints.map(n=>nodeMap.get(n)),...(s.skeleton===undefined?{}:{skeleton:nodeMap.get(s.skeleton)})})),meshes:meshIds.map(id=>{const mesh=structuredClone(old.meshes[id]);mesh.extras={...mesh.extras,forgeSlot:slotByObjectId.get(meta.meshes[id].objectId)||mesh.extras?.forgeSlot};return mesh}),materials:[],animations:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};
  const chunks=[],views=new Map(),accessors=new Map();let length=0;
  function addView(data,target){const pad=(-length)&3;if(pad){chunks.push(Buffer.alloc(pad));length+=pad}const id=g.bufferViews.length;g.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length,...(target?{target}:{})});chunks.push(data);length+=data.length;return id}
  function view(id){if(views.has(id))return views.get(id);const v=old.bufferViews[id],n=addView(bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength),v.target);if(v.byteStride)g.bufferViews[n].byteStride=v.byteStride;views.set(id,n);return n}
  function acc(id){if(accessors.has(id))return accessors.get(id);const a=structuredClone(old.accessors[id]);if(a.sparse)throw Error('Sparse accessors not supported');a.bufferView=view(a.bufferView);const n=g.accessors.length;g.accessors.push(a);accessors.set(id,n);return n}
  function floats(values,type,count,min,max){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>{if(!Number.isFinite(v))throw Error('Nonfinite animation value');b.writeFloatLE(v,i*4)});const id=g.accessors.length;g.accessors.push({bufferView:addView(b),componentType:5126,count,type,...(min?{min}:{}),...(max?{max}:{})});return id}
  const materials=new Map(),decalTextures=new Map();
  for(let mi=0;mi<g.meshes.length;mi++){
   const mesh=g.meshes[mi],sourceObjectId=meta.meshes[meshIds[mi]].objectId,decal=decalByObjectId.get(sourceObjectId);
   for(const p of mesh.primitives){
    if(p.indices!==undefined)p.indices=acc(p.indices);
    p.attributes=Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k.startsWith('COLOR_')?'_SM2_'+k:k,acc(v)]));
    if(p.targets)p.targets=p.targets.map(t=>Object.fromEntries(Object.entries(t).map(([k,v])=>[k,acc(v)])));
    const key=(decal?'decal|'+decal.slot+'|'+decal.decalId:p.material+'|'+mesh.name);
    if(!materials.has(key)){
     materials.set(key,g.materials.length);
     if(decal){
      let texture=decalTextures.get(decal);
      if(texture===undefined){g.images??=[];g.textures??=[];g.samplers??=[{...NATIVE_DECAL_SAMPLER}];const image=g.images.length;g.images.push({name:decal.decalId,bufferView:addView(decal.png),mimeType:'image/png'});texture=g.textures.length;g.textures.push({source:image,sampler:0});decalTextures.set(decal,texture)}
      g.materials.push({name:'Iron Hands / '+decal.decalId,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],baseColorTexture:{index:texture,texCoord:0},metallicFactor:0,roughnessFactor:.65},alphaMode:'BLEND',doubleSided:false,extras:{forgeDecal:true,forgeSlot:decal.slot,nativeUV0:true,sourceDecal:decal.decalId,diagnostics:decal.diagnostics}});
     }else g.materials.push(prototypeMaterial(old.materials[p.material],mesh.extras?.forgeLeftBionic?'preview_steel '+mesh.name:mesh.name,s.paint,s,mesh.extras?.forgeSlot));
    }
    p.material=materials.get(key);
   }
  }

  for(const skin of g.skins)skin.inverseBindMatrices=acc(skin.inverseBindMatrices);
  if(clip){const times=clip.times.map(t=>t*100/motion.speedPct),timeAcc=floats(times,'SCALAR',clip.frameCount,[0],[times.at(-1)]),animation={name:'SM2 '+motion.gait+' '+motion.stance,samplers:[],channels:[],extras:{sourceSHA256:clip.sourceSha256,sourceFPS:clip.fps,sourceFrames:clip.frameCount,speedPct:motion.speedPct,inPlace:true,bindingPolicy:binding.bindingPolicy,preservedLocalBindChannels:binding.inheritedOnlyChannels,missingControls:missing}};
   for(const channel of matched){const node=g.nodes[nodeMap.get(byName.get(channel.name))];if(node.matrix){const m=new Matrix4().fromArray(node.matrix),p=new Vector3(),q=new Quaternion(),scale=new Vector3();m.decompose(p,q,scale);const restored=new Matrix4().compose(p,q,scale);if(Math.max(...m.elements.map((x,i)=>Math.abs(x-restored.elements[i])))>1e-5)throw Error('Bone matrix cannot be represented as TRS');node.translation=p.toArray();node.rotation=q.toArray();node.scale=scale.toArray();delete node.matrix}for(const [prop,type,values]of [['translation','VEC3',channel.positions],['rotation','VEC4',channel.rotations]]){const sampler=animation.samplers.length;animation.samplers.push({input:timeAcc,output:floats(values.flat(),type,clip.frameCount),interpolation:'LINEAR'});animation.channels.push({sampler,target:{node:nodeMap.get(byName.get(channel.name)),path:prop}})}}g.animations.push(animation)}
  if(!clip)delete g.animations;g.buffers[0].byteLength=length;
  applyBodyFrameScale(g,c.forgeBodyFrame);
  if(g.meshes.some(m=>m.primitives.some(p=>p.extensions?.FB_ngon_encoding)))g.extensionsUsed=['FB_ngon_encoding'];
  const json=Buffer.from(JSON.stringify(g)),jp=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]),payload=Buffer.concat([...chunks,Buffer.alloc((-length)&3)]),h=Buffer.alloc(20),bh=Buffer.alloc(8),total=28+jp.length+payload.length;
  h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(total,8);h.writeUInt32LE(jp.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(payload.length,0);bh.writeUInt32LE(0x004e4942,4);
  const name='soldier-'+String(index+1).padStart(2,'0')+'-'+hash(JSON.stringify(s)).slice(0,12)+'.glb',target=path.join(out,name),output=Buffer.concat([h,jp,bh,payload]);fs.writeFileSync(target,output);
  files.push({id:s.id,role:s.role,file:name,sha256:hash(output),classId:s.classId,source:c.tpl,sourceVersion:5,crossClassGrafts:graftDiagnostics,servoStartupPose:servoSummary,sourceObjectIds:[...objectIds],meshes:g.meshes.length,vertices:g.meshes.reduce((n,m)=>n+m.primitives.reduce((n,p)=>n+g.accessors[p.attributes.POSITION].count,0),0),motion:clip?motion:null,sourceClipSHA256:clip?.sourceSha256});
 }
 const result={schema:'iron-hands-forge-build-v1',recipe,files,materialStatus:'Preview armour materials; native-UV Iron Hands decals are locally baked and embedded; game PBR and secondary physics remain separate',createdAt:new Date().toISOString()};fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i++){if(!['--recipe','--code','--data-root','--out'].includes(args[i]))throw Error('Unknown argument '+args[i]);o[args[i].slice(2)]=args[++i]}if(!o['data-root']||!o.out||!o.recipe&&!o.code)throw Error('Usage: --recipe FILE or --code IHF1... --data-root FOLDER --out FOLDER');const recipe=o.code?await decodeRecipe(o.code):normalizeRecipe(read(o.recipe));const result=await buildRecipe(recipe,{dataRoot:o['data-root'],out:o.out});console.log(JSON.stringify({ok:true,files:result.files.map(f=>f.file),out:path.resolve(o.out)}))}catch(e){console.error(e.message);process.exitCode=1}}
