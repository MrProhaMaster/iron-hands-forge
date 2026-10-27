import {resolveMotionBinding,motionPreviewChannels} from '../shared/motion-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {normalizeRecipe,decodeRecipe} from '../shared/recipe-codec.mjs';
import leftBionic from '../shared/left-bionic.cjs';
import {graftBionicModel} from '../shared/bionic-graft.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const VERSION=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceProxies=n=>/_cdt$|_SIM$|^rb_|^material_|^Icosphere$/.test(n);
const linear=h=>[1,3,5].map(i=>{const v=parseInt(h.slice(i,i+2),16)/255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)});
function prototypeMaterial(original,name,paint){const lower=((original?.name||'')+' '+name).toLowerCase();let color=paint.armor,metallic=.12,rough=.48,alpha=1,emissive;
 if(/undersuit|rubber/.test(lower)){color='#101215';metallic=0;rough=.78}
 else if(/tabard|cloth|seal|rope|hair/.test(lower)){color='#51483c';metallic=0;rough=.85}
 else if(/bag|belt|leather/.test(lower)){color='#372e28';metallic=0;rough=.7}
 else if(/lenses|optic/.test(lower)){color=paint.lenses;metallic=.1;rough=.2;emissive=linear(color)}
 else if(/glass/.test(lower)){color='#18232c';alpha=.18;rough=.12}
 else if(/preview_steel|forge_left_bionic|ch_cato_hand_lod|ch_tech_marine_mecharm|soldier_arm_r_02|soldier_hand_l_01/.test(lower)){color=paint.metal;metallic=.85;rough=.34}
 else if(/head_|skin|eye_/.test(lower)&&!/helmet/.test(lower)){color='#a18a79';metallic=0;rough=.7}
 if(/_decal$/.test(name))alpha=0;
 return{name:'Forge preview / '+(original?.name||name),pbrMetallicRoughness:{baseColorFactor:[...linear(color),alpha],metallicFactor:metallic,roughnessFactor:rough},...(alpha<1?{alphaMode:'BLEND',doubleSided:true}:{}),...(emissive?{emissiveFactor:emissive}:{}),extras:{sourceMaterial:original?.name,previewMaterial:true}};
}
function loadGLB(file){const b=fs.readFileSync(file);if(b.length<28||b.readUInt32LE(0)!==0x46546c67||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length)throw Error('Invalid GLB: '+file);const len=b.readUInt32LE(12);if(28+len>b.length||b.readUInt32LE(16)!==0x4e4f534a||b.readUInt32LE(24+len)!==0x004e4942||b.readUInt32LE(20+len)!==b.length-28-len)throw Error('Invalid GLB chunks: '+file);const json=JSON.parse(b.subarray(20,20+len)),bin=b.subarray(28+len);return{bytes:b,json,bin}}
export async function buildRecipe(input,{dataRoot,out}){
 const recipe=normalizeRecipe(input),motionConfig=read(path.join(ROOT,'shared/motion-bindings.json'));dataRoot=path.resolve(dataRoot);out=path.resolve(out);fs.mkdirSync(out,{recursive:true});
 const library=leftBionic.loadBionicLibrary(dataRoot),registry=leftBionic.augmentBionicRegistry(read(path.join(dataRoot,'production/roster/armor-options.json')),library),sourceRoot=path.join(dataRoot,'assets/characters/SM2-retail-constructors/source-v5'),sourceManifest=read(path.join(sourceRoot,'manifest.json'));
 const {Matrix4,Vector3,Quaternion}=await import(pathToFileURL(path.join(ROOT,'app/web/vendor/three.module.js')).href);
 const plans=recipe.soldiers.map(s=>{const c=registry.classes.find(c=>c.id===s.classId&&c.available);if(!c)throw Error('Unsupported class: '+s.classId);if(!/^[A-Za-z0-9_]+$/.test(c.tpl))throw Error('Unsafe template name');const record=sourceManifest.assets.find(a=>a.asset===c.tpl&&a.transformValidation==='passed'&&a.restSkinValidation==='passed'&&a.weightPackingValidation==='passed'&&a.skinProfileWeldValidation==='passed');if(!record)throw Error('No verified V5 model: '+s.classId);const parts=[];for(const slot of c.slots){const id=s.selection[slot.id];if(!id){if(slot.options.every(o=>o.equipmentActorMeshes?.length&&!o.meshes?.length))continue;throw Error('Missing armour selection '+slot.id)}const option=slot.options.find(o=>o.id===id);if(!option)throw Error('Unknown armour option '+slot.id+': '+id);if(option.equipmentActorMeshes?.length&&!option.meshes?.length)throw Error('External equipment is not connected: '+id);if(!Array.isArray(option.resolvedObjectIds))throw Error('Unresolved local catalogue: '+id);if(option.meshes?.length&&!option.resolvedObjectIds.length)throw Error('Geometry unavailable: '+id);parts.push({slot:slot.id,option})}for(const key of Object.keys(s.selection))if(!c.slots.some(x=>x.id===key))throw Error('Unknown armour slot: '+key);return{s,c,parts}});
 const files=[];
 for(let index=0;index<plans.length;index++){
  const {s,c,parts}=plans[index],file=path.join(sourceRoot,c.tpl+'.glb'),source=loadGLB(file),bytes=source.bytes,meta=read(path.join(sourceRoot,c.tpl+'.json'));
  let old=source.json,bin=source.bin;
  if(old.meshes.length!==meta.meshes.length||old.meshes.some((m,i)=>m.name!==meta.meshes[i].name))throw Error('Source mesh identity check failed');
  const addon=parts.some(p=>p.option.forgeBionic)?leftBionic.loadBionicClass({dataRoot,classId:s.classId,asset:c.tpl}):null;
  if(addon){const graft=graftBionicModel(old,bin.length,addon.addonDoc,addon.addonBin,addon.optionRecord);old=graft.json;bin=Buffer.concat([bin,graft.appendBinary]);meta.meshes.push(...graft.meshRecords);meta.objectMetadata??=[];meta.objectMetadata.push(graft.objectRecord)}
  let objectIds=new Set(parts.flatMap(p=>p.option.resolvedObjectIds));
  if(typeof leftBionic.filterBionicObjectIds==='function')objectIds=new Set(leftBionic.filterBionicObjectIds(parts,objectIds));
  else if(addon&&objectIds.has(addon.optionRecord.objectId))for(const id of addon.optionRecord.excludeObjectIds??[])objectIds.delete(id);
  const selectedNodes=new Set(old.nodes.flatMap((n,i)=>n.mesh!==undefined&&objectIds.has(meta.meshes[n.mesh].objectId)&&!sourceProxies(old.meshes[n.mesh].name)?[i]:[]));
  if(!selectedNodes.size)throw Error('Recipe contains no geometry');
  const sourceOwners=new Set([...selectedNodes].map(i=>meta.meshes[old.nodes[i].mesh].objectId));
  for(const id of objectIds)if(!sourceOwners.has(id)&&meta.meshes.some(m=>m.objectId===id&&!sourceProxies(m.name)))throw Error('Missing requested source object '+id);
  const motion=s.motion||null;
  const binding=motion?resolveMotionBinding(motionConfig,s.classId,motion.gait,motion.stance):null;if(binding&&binding.asset!==c.tpl)throw Error('Motion and body template do not match');
  const clipPath=binding?path.join(dataRoot,'assets/animations',binding.output):null;
  if(clipPath&&!fs.existsSync(clipPath))throw Error('The selected motion clip is not prepared locally');
  const clip=clipPath?read(clipPath):null,previewChannels=clip?motionPreviewChannels(clip,binding):[];
  const byName=new Map(old.nodes.map((n,i)=>[n.name,i])),parent=new Map();old.nodes.forEach((n,i)=>(n.children||[]).forEach(ch=>parent.set(ch,i)));
  const matched=clip?previewChannels.filter(ch=>byName.has(ch.name)):[],missing=clip?previewChannels.filter(ch=>!byName.has(ch.name)).map(c=>c.name):[];
  const helpers=old.nodes.flatMap((n,i)=>n.extras?.forgeBionicHelper||n.extras?.forgeLeftBionicHelper?[i]:[]);
  const keep=new Set([...selectedNodes,...old.skins.flatMap(s=>s.joints),...helpers,...matched.map(ch=>byName.get(ch.name))]);for(const id of [...keep])for(let p=parent.get(id);p!==undefined;p=parent.get(p))keep.add(p);
  const nodeIds=[...keep].sort((a,b)=>a-b),nodeMap=new Map(nodeIds.map((id,i)=>[id,i])),meshIds=[...new Set([...selectedNodes].map(i=>old.nodes[i].mesh))].sort((a,b)=>a-b),meshMap=new Map(meshIds.map((id,i)=>[id,i]));
  const g={asset:{version:'2.0',generator:'Iron Hands Forge '+VERSION,extras:{recipe:s,catalog:recipe.catalog,sourceVersion:5,sourceAsset:c.tpl,sourceSHA256:hash(bytes),prototypeMaterials:true}},scene:0,scenes:[{name:s.role,nodes:old.scenes[old.scene||0].nodes.filter(n=>nodeMap.has(n)).map(n=>nodeMap.get(n))}],nodes:nodeIds.map(id=>{const n=structuredClone(old.nodes[id]);if(n.mesh!==undefined){if(selectedNodes.has(id)){const mi=n.mesh;n.mesh=meshMap.get(mi);n.extras={...n.extras,source_name:old.meshes[mi].name,sourceObjectId:meta.meshes[mi].objectId}}else{delete n.mesh;delete n.skin}}if(n.children)n.children=n.children.filter(n=>nodeMap.has(n)).map(n=>nodeMap.get(n));delete n.camera;return n}),skins:old.skins.map(s=>({...structuredClone(s),joints:s.joints.map(n=>nodeMap.get(n)),...(s.skeleton===undefined?{}:{skeleton:nodeMap.get(s.skeleton)})})),meshes:meshIds.map(id=>structuredClone(old.meshes[id])),materials:[],animations:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};
  const chunks=[],views=new Map(),accessors=new Map();let length=0;
  function addView(data,target){const pad=(-length)&3;if(pad){chunks.push(Buffer.alloc(pad));length+=pad}const id=g.bufferViews.length;g.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length,...(target?{target}:{})});chunks.push(data);length+=data.length;return id}
  function view(id){if(views.has(id))return views.get(id);const v=old.bufferViews[id],n=addView(bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength),v.target);if(v.byteStride)g.bufferViews[n].byteStride=v.byteStride;views.set(id,n);return n}
  function acc(id){if(accessors.has(id))return accessors.get(id);const a=structuredClone(old.accessors[id]);if(a.sparse)throw Error('Sparse accessors not supported');a.bufferView=view(a.bufferView);const n=g.accessors.length;g.accessors.push(a);accessors.set(id,n);return n}
  function floats(values,type,count,min,max){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>{if(!Number.isFinite(v))throw Error('Nonfinite animation value');b.writeFloatLE(v,i*4)});const id=g.accessors.length;g.accessors.push({bufferView:addView(b),componentType:5126,count,type,...(min?{min}:{}),...(max?{max}:{})});return id}
  const materials=new Map();for(const mesh of g.meshes)for(const p of mesh.primitives){p.indices=acc(p.indices);p.attributes=Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k.startsWith('COLOR_')?'_SM2_'+k:k,acc(v)]));if(p.targets)p.targets=p.targets.map(t=>Object.fromEntries(Object.entries(t).map(([k,v])=>[k,acc(v)])));const key=p.material+'|'+mesh.name;if(!materials.has(key)){materials.set(key,g.materials.length);g.materials.push(prototypeMaterial(old.materials[p.material],mesh.extras?.forgeLeftBionic?'preview_steel '+mesh.name:mesh.name,s.paint))}p.material=materials.get(key)}
  for(const skin of g.skins)skin.inverseBindMatrices=acc(skin.inverseBindMatrices);
  if(clip){const times=clip.times.map(t=>t*100/motion.speedPct),timeAcc=floats(times,'SCALAR',clip.frameCount,[0],[times.at(-1)]),animation={name:'SM2 '+motion.gait+' '+motion.stance,samplers:[],channels:[],extras:{sourceSHA256:clip.sourceSha256,sourceFPS:clip.fps,sourceFrames:clip.frameCount,speedPct:motion.speedPct,inPlace:true,bindingPolicy:binding.bindingPolicy,preservedLocalBindChannels:binding.inheritedOnlyChannels,missingControls:missing}};
   for(const channel of matched){const node=g.nodes[nodeMap.get(byName.get(channel.name))];if(node.matrix){const m=new Matrix4().fromArray(node.matrix),p=new Vector3(),q=new Quaternion(),scale=new Vector3();m.decompose(p,q,scale);const restored=new Matrix4().compose(p,q,scale);if(Math.max(...m.elements.map((x,i)=>Math.abs(x-restored.elements[i])))>1e-5)throw Error('Bone matrix cannot be represented as TRS');node.translation=p.toArray();node.rotation=q.toArray();node.scale=scale.toArray();delete node.matrix}for(const [prop,type,values]of [['translation','VEC3',channel.positions],['rotation','VEC4',channel.rotations]]){const sampler=animation.samplers.length;animation.samplers.push({input:timeAcc,output:floats(values.flat(),type,clip.frameCount),interpolation:'LINEAR'});animation.channels.push({sampler,target:{node:nodeMap.get(byName.get(channel.name)),path:prop}})}}g.animations.push(animation)}
  if(!clip)delete g.animations;g.buffers[0].byteLength=length;
  if(g.meshes.some(m=>m.primitives.some(p=>p.extensions?.FB_ngon_encoding)))g.extensionsUsed=['FB_ngon_encoding'];
  const json=Buffer.from(JSON.stringify(g)),jp=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]),payload=Buffer.concat([...chunks,Buffer.alloc((-length)&3)]),h=Buffer.alloc(20),bh=Buffer.alloc(8),total=28+jp.length+payload.length;
  h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(total,8);h.writeUInt32LE(jp.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(payload.length,0);bh.writeUInt32LE(0x004e4942,4);
  const name='soldier-'+String(index+1).padStart(2,'0')+'-'+hash(JSON.stringify(s)).slice(0,12)+'.glb',target=path.join(out,name),output=Buffer.concat([h,jp,bh,payload]);fs.writeFileSync(target,output);
  files.push({id:s.id,role:s.role,file:name,sha256:hash(output),classId:s.classId,source:c.tpl,sourceVersion:5,sourceObjectIds:[...objectIds],meshes:g.meshes.length,vertices:g.meshes.reduce((n,m)=>n+m.primitives.reduce((n,p)=>n+g.accessors[p.attributes.POSITION].count,0),0),motion:clip?motion:null,sourceClipSHA256:clip?.sourceSha256});
 }
 const result={schema:'iron-hands-forge-build-v1',recipe,files,materialStatus:'Preview materials; game PBR and secondary physics are separate',createdAt:new Date().toISOString()};fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i++){if(!['--recipe','--code','--data-root','--out'].includes(args[i]))throw Error('Unknown argument '+args[i]);o[args[i].slice(2)]=args[++i]}if(!o['data-root']||!o.out||!o.recipe&&!o.code)throw Error('Usage: --recipe FILE or --code IHF1... --data-root FOLDER --out FOLDER');const recipe=o.code?await decodeRecipe(o.code):normalizeRecipe(read(o.recipe));const result=await buildRecipe(recipe,{dataRoot:o['data-root'],out:o.out});console.log(JSON.stringify({ok:true,files:result.files.map(f=>f.file),out:path.resolve(o.out)}))}catch(e){console.error(e.message);process.exitCode=1}}
