'use strict';
/** Prepared Astartes geometry and source-backed body frames. Offline DataRoot only. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const DIRECTORY='assets/customization/astartes-v1',MANIFEST=DIRECTORY+'/manifest.json';
const verified=new Map(),cache=new Map();
const SCHEMA='iron-hands-forge-astartes-library-v1',CATALOG_SCHEMA='iron-hands-forge-astartes-catalog-v1';
function resourcePath(root,relative){
 if(typeof relative!=='string'||!relative.startsWith(DIRECTORY+'/')||relative.includes('\\')||relative.includes(':')||relative.includes('\0')||relative.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Unsafe Astartes resource path');
 root=path.resolve(root);const file=path.resolve(root,relative),real=fs.realpathSync(file),base=fs.realpathSync(root);
 if(!real.startsWith(base+path.sep))throw Error('Astartes resource link escapes DataRoot');return file;
}
function stamp(file){const s=fs.statSync(file);if(!s.isFile()||s.size<1)throw Error('Astartes resource is missing or empty');return s.size+':'+s.mtimeMs+':'+s.ctimeMs}
function read(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))}
function unique(rows,key,message){if(new Set(rows.map(key)).size!==rows.length)throw Error(message)}
function streamedHash(file){
 const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),chunk=Buffer.allocUnsafe(4*1024*1024);
 try{let size;while((size=fs.readSync(fd,chunk,0,chunk.length,null))>0)h.update(chunk.subarray(0,size));return h.digest('hex')}finally{fs.closeSync(fd)}
}
function loadAstartesLibrary(root){
 root=path.resolve(root);const candidate=path.join(root,MANIFEST);
 if(!fs.existsSync(candidate)){if(fs.existsSync(path.join(root,DIRECTORY)))throw Error('Astartes library manifest is missing from its prepared directory');return{ready:false,revision:'absent',files:[],catalogPath:null,models:[],options:[],profiles:[],unavailableOptions:[],manifestPath:MANIFEST}}
 const manifestPath=resourcePath(root,MANIFEST),manifest=read(manifestPath);
 if(manifest.schema!==SCHEMA||manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Unsupported Astartes resource library');
 unique(manifest.files,x=>x.path,'Duplicate Astartes resource path');
 const versions=[];
 for(const r of manifest.files){
  if(!r||!Number.isSafeInteger(r.bytes)||r.bytes<1||!/^[a-f0-9]{64}$/.test(r.sha256||''))throw Error('Invalid Astartes resource record');
  const file=resourcePath(root,r.path),revision=stamp(file);
  if(fs.statSync(file).size!==r.bytes)throw Error('Astartes resource size mismatch: '+r.path);
  const key=file+'|'+revision+'|'+r.sha256;
  if(!verified.has(key)){if(streamedHash(file)!==r.sha256)throw Error('Astartes resource checksum mismatch: '+r.path);verified.set(key,true)}
  versions.push(r.path+':'+revision+':'+r.sha256);
 }
 const listed=new Set(manifest.files.map(x=>x.path));
 if(!listed.has(manifest.catalog))throw Error('Astartes catalog is not in its file manifest');
 const revision=crypto.createHash('sha256').update(stamp(manifestPath)+'|'+versions.join('|')).digest('hex');
 if(cache.get(manifestPath)?.revision===revision)return cache.get(manifestPath);
 const value=read(resourcePath(root,manifest.catalog));
 if(value.schema!==CATALOG_SCHEMA||value.version!==1||!Array.isArray(value.models)||!Array.isArray(value.options)||!Array.isArray(value.profiles))throw Error('Invalid Astartes catalog');
 unique(value.models,x=>x.id,'Duplicate Astartes model ID');
 const unavailable=value.unavailableOptions??[];
 if(!Array.isArray(unavailable))throw Error('Invalid Astartes unavailable source inventory');
 unique([...value.options,...unavailable],x=>x.slotId+'|'+x.id,'Duplicate Astartes option ID');
 for(const o of unavailable){
  if(!o||typeof o.id!=='string'||o.id.length>160||typeof o.sourceOptionId!=='string'||!o.sourceOptionId||!(o.id==='astartes:'+o.sourceOptionId||/^:[a-f0-9]{8}$/.test(o.id.slice(('astartes:'+o.sourceOptionId).length))&&o.id.startsWith('astartes:'+o.sourceOptionId))||typeof o.slotId!=='string'||!o.slotId||o.geometryAvailable!==false||o.geometryComplete!==false||typeof o.reason!=='string'||!o.reason||!Array.isArray(o.missingSelectors)||o.missingSelectors.some(x=>typeof x!=='string'))throw Error('Invalid Astartes unavailable source entry');
 }
 unique(value.profiles,x=>x.id,'Duplicate Astartes body frame ID');
 for(const m of value.models){
  if(!m.id||!m.sourceTemplate||!m.sourceClassId||!listed.has(m.glb)||!m.glb.endsWith('.glb')||!listed.has(m.metadata)||!m.metadata.endsWith('.json'))throw Error('Invalid Astartes model descriptor');
  for(const key of ['transform','restSkin','weightPacking','skinProfileWeld'])if(m.validation?.[key]!=='passed')throw Error('Astartes model validation has not passed: '+m.id+' '+key);
 }
 const models=new Set(value.models.map(x=>x.id));
 for(const o of value.options){
  if(typeof o.id!=='string'||o.id.length>160||typeof o.sourceOptionId!=='string'||!o.sourceOptionId||!(o.id==='astartes:'+o.sourceOptionId||/^:[a-f0-9]{8}$/.test(o.id.slice(('astartes:'+o.sourceOptionId).length))&&o.id.startsWith('astartes:'+o.sourceOptionId))||!o.slotId||!Array.isArray(o.meshes)||!Array.isArray(o.resolvedObjectIds)||o.resolvedObjectIds.some(x=>!Number.isSafeInteger(x))||o.geometryAvailable!==true||o.geometryComplete!==true)throw Error('Invalid or unresolved Astartes option: '+o.id);
  if(o.meshes.length&&(!models.has(o.sourceAsset)||!o.resolvedObjectIds.length))throw Error('Astartes option has no verified model: '+o.id);
  if(!o.meshes.length&&o.resolvedObjectIds.length)throw Error('Empty Astartes option owns geometry: '+o.id);
  const components=o.components??[o];
  if(!Array.isArray(components)||!components.length)throw Error('Invalid Astartes component list: '+o.id);
  for(const component of components){
   if(!component||!Array.isArray(component.meshes)||!Array.isArray(component.resolvedObjectIds)||component.resolvedObjectIds.some(x=>!Number.isSafeInteger(x))||component.meshes.length&&(!models.has(component.sourceAsset)||!component.resolvedObjectIds.length)||!component.meshes.length&&component.resolvedObjectIds.length)throw Error('Invalid Astartes geometry component: '+o.id);
   if(component.attachment){
    const a=component.attachment;
    if(!component.meshes.length||typeof a.followNodeName!=='string'||!a.followNodeName||typeof a.sourceNode!=='string'||!a.sourceNode||!Array.isArray(a.position)||a.position.length!==3||!Array.isArray(a.rotation)||a.rotation.length!==4||[...a.position,...a.rotation].some(x=>typeof x!=='number'||!Number.isFinite(x))||Math.abs(Math.hypot(...a.rotation)-1)>1e-5)throw Error('Invalid Astartes source actor mount: '+o.id);
   }
  }
  if(o.components&&(o.sourceAsset!==components[0].sourceAsset||JSON.stringify(o.meshes)!==JSON.stringify(components[0].meshes)||JSON.stringify(o.resolvedObjectIds)!==JSON.stringify(components[0].resolvedObjectIds)))throw Error('Astartes primary component does not match its option: '+o.id);
 }
 for(const p of value.profiles){
  if(!p.id||!p.label||!p.baseClassId||!p.sourceTemplateId||!models.has(p.modelId)||!p.initialSelection||typeof p.initialSelection!=='object'||Array.isArray(p.initialSelection)||!Object.keys(p.initialSelection).length)throw Error('Invalid Astartes body frame profile');
  if(p.sourceActorScale!==undefined&&(typeof p.sourceActorScale!=='number'||!Number.isFinite(p.sourceActorScale)||p.sourceActorScale<=0||p.sourceActorScale>10))throw Error('Invalid Astartes source actor scale');
  if(!p.initialPaint||!['armor','metal','lenses'].every(k=>/^#[a-f0-9]{6}$/i.test(p.initialPaint[k]||'')))throw Error('Invalid Astartes body frame paint');
 }
 const result={...value,unavailableOptions:unavailable,ready:true,revision,files:manifest.files,catalogPath:manifest.catalog,manifestPath:MANIFEST};
 cache.set(manifestPath,result);if(cache.size>16)cache.clear();if(verified.size>4096)verified.clear();return result;
}
function optionForRegistry(o,library){
 const model=library.models.find(m=>m.id===o.sourceAsset);
 const {sourceDefinition,sourceDefinitions,sourceResolution,...runtime}=o;
 return{...structuredClone(runtime),isInitial:false,isDefault:false,shared:true,sourceLabel:o.sourceLabel||'Astartes',sourceClassId:model?.sourceClassId,sourceOptionId:o.sourceOptionId,chapter:o.chapter,
  tags:[...new Set([...(o.tags||[]),'astartes'])],...(!o.meshes.length?{forgeEmpty:true}:{}),
  forgeAstartes:{modelId:o.sourceAsset,slotId:o.slotId,optionId:o.id}};
}
function augmentAstartesRegistry(registry,library){
 const result=structuredClone(registry);if(!library?.ready)return result;
 const originals=new Map(result.classes.filter(c=>c.available).map(c=>[c.id,structuredClone(c)]));
 for(const p of library.profiles){
  if(result.classes.some(c=>c.id===p.id))throw Error('Astartes frame collides with an existing class: '+p.id);
  const base=originals.get(p.baseClassId);if(!base||base.tpl!==p.sourceTemplateId)throw Error('Astartes frame base template does not match: '+p.id);
  const c=structuredClone(base);c.id=p.id;c.label=p.label;c.sourceTeam='LOYALIST';c.masteryTypes=p.masteryTypes||[];
  c.forgeBodyFrame={version:1,profileId:p.id,sourceClassId:p.id,baseClassId:p.baseClassId,sourceTemplateId:p.sourceTemplateId,sourceModel:p.modelId,sourcePreset:p.sourcePreset||'PREDEFINED_PRESET_1',...(p.sourceActorScale!==undefined?{sourceActorScale:p.sourceActorScale}:{})};
  c.initialPaint=structuredClone(p.initialPaint);if(p.initialAppearance)c.initialAppearance=structuredClone(p.initialAppearance);
  c.defaultArmorPreset=p.sourcePreset||'PREDEFINED_PRESET_1';c.initialArmorPreset=c.defaultArmorPreset;
  for(const s of c.slots)for(const o of s.options)o.forgeCrossClass={classId:base.id,asset:base.tpl,slotId:s.id,optionId:o.id};
  result.classes.push(c);
 }
 for(const c of result.classes.filter(c=>c.available)){
  for(const o of [...library.options,...(library.unavailableOptions||[])]){
   if(o.targetClassIds&&!o.targetClassIds.includes(c.id))continue;
   let slot=c.slots.find(s=>s.id===o.slotId);
   if(!slot){
    const id='forge:none:'+o.slotId,empty={id,label:'Нет',meshes:[],resolvedMeshes:[],resolvedObjectIds:[],geometryAvailable:true,geometryComplete:true,resolutionStatus:'empty',forgeEmpty:true};
    slot={id:o.slotId,label:o.slotLabel||o.slotId,options:[empty],forgeAddedSlot:true};c.slots.push(slot);c.initialSelection[o.slotId]=id;
   }
   if(slot.options.some(x=>x.id===o.id))throw Error('Astartes option collides with a native ID');
   if(o.geometryAvailable===false){
    const {sourceDefinition,sourceDefinitions,sourceResolution,...runtime}=o;
    slot.options.push({...structuredClone(runtime),meshes:[],resolvedMeshes:[],resolvedObjectIds:[],isInitial:false,isDefault:false,shared:true,sourceLabel:'Astartes',tags:[...new Set([...(o.tags||[]),'astartes'])],forgeUnavailable:true,forgeAstartes:{unavailable:true,slotId:o.slotId,optionId:o.id}});
   }else slot.options.push(optionForRegistry(o,library));
  }
 }
 for(const p of library.profiles){
  const c=result.classes.find(x=>x.id===p.id);
  for(const [slotId,sourceId]of Object.entries(p.initialSelection)){
   const slot=c.slots.find(x=>x.id===slotId);if(!slot)throw Error('Astartes default slot is unavailable: '+slotId);
   const candidates=slot.options.filter(x=>x.forgeAstartes&&x.sourceOptionId===sourceId);
   if(!sourceId.startsWith('astartes:')&&candidates.length>1)throw Error('Ambiguous Astartes default; use its exact scoped ID: '+p.id+' '+slotId+' '+sourceId);
   const option=sourceId.startsWith('astartes:')?slot.options.find(x=>x.id===sourceId):candidates[0]||slot.options.find(x=>x.id===sourceId);
   if(!option||option.geometryAvailable===false||option.geometryComplete===false)throw Error('Astartes default geometry is unavailable: '+p.id+' '+slotId+' '+sourceId);
   c.initialSelection[slotId]=option.id;
  }
  if(!Object.values(c.initialSelection).some(id=>library.options.some(o=>o.id===id&&o.meshes.length)))throw Error('Astartes body frame has no distinctive source geometry: '+p.id);
  for(const s of c.slots)for(const o of s.options)o.isInitial=c.initialSelection[s.id]===o.id;
 }
 result.astartes={version:1,revision:library.revision,offline:true,profiles:library.profiles.map(p=>p.id),models:library.models.length,options:library.options.length,unavailableOptions:library.unavailableOptions?.length||0};return result;
}
function resolveAstartesModel(library,modelId){
 if(!library?.ready)throw Error('Astartes library is unavailable');
 const id=typeof modelId==='object'?modelId.forgeAstartes?.modelId||modelId.forgeBodyFrame?.sourceModel:modelId;
 const model=library.models.find(x=>x.id===id);if(!model)throw Error('Unknown Astartes source model: '+id);return model;
}
module.exports={DIRECTORY,MANIFEST,resourcePath,loadAstartesLibrary,augmentAstartesRegistry,resolveAstartesModel};
