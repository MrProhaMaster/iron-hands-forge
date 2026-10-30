'use strict';
/** Portable Iron Hands cosmetics. Reads only DataRoot; no game lookup or network. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const DIRECTORY='assets/customization/iron-hands-v1';
const MANIFEST=DIRECTORY+'/manifest.json';
const cache=new Map(),verified=new Map();
function resourcePath(dataRoot,relativePath){
 if(typeof relativePath!=='string'||!relativePath||relativePath.includes('\\')||relativePath.includes(':')||relativePath.includes('\0')||path.posix.isAbsolute(relativePath)||relativePath.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe Iron Hands resource path');
 const root=path.resolve(dataRoot),file=path.resolve(root,relativePath);
 if(!file.startsWith(root+path.sep))throw Error('Iron Hands resource escapes its library');
 const rootReal=fs.realpathSync(root),real=fs.realpathSync(file);
 if(!real.startsWith(rootReal+path.sep))throw Error('Iron Hands resource link escapes its library');
 return file;
}
function stamp(file){const s=fs.statSync(file);if(!s.isFile()||s.size<=0)throw Error('Iron Hands resource is missing or empty');return s.size+':'+s.mtimeMs}
function unique(rows,key,message){if(new Set(rows.map(key)).size!==rows.length)throw Error(message)}
function loadIronHandsLibrary(dataRoot){
 dataRoot=path.resolve(dataRoot);
 const candidate=path.join(dataRoot,...MANIFEST.split('/'));
 if(!fs.existsSync(candidate)&&fs.existsSync(path.join(dataRoot,...DIRECTORY.split('/'))))throw Error('The Iron Hands library manifest is missing from its prepared directory');
 if(!fs.existsSync(candidate))return{ready:false,classes:[],decals:[],materials:[],colors:[],textures:{},armorTags:{},revision:'absent',manifestPath:MANIFEST};
 const file=resourcePath(dataRoot,MANIFEST),manifestStamp=stamp(file);
 const raw=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 if(raw.schema!=='iron-hands-forge-customization-library'||raw.version!==1||!Array.isArray(raw.files)||!raw.files.length)throw Error('Unsupported Iron Hands resource library');
 unique(raw.files,x=>x.path,'Duplicate Iron Hands resource path');
 for(const record of raw.files){
  if(!record||typeof record.path!=='string'||!record.path.startsWith(DIRECTORY+'/')||!Number.isSafeInteger(record.bytes)||record.bytes<=0||!/^[a-f0-9]{64}$/.test(record.sha256||''))throw Error('Invalid Iron Hands file record');
  const resource=resourcePath(dataRoot,record.path),revision=stamp(resource);
  if(fs.statSync(resource).size!==record.bytes)throw Error('Iron Hands resource size mismatch: '+record.path);
  const key=resource+'|'+revision+'|'+record.sha256;
  if(!verified.has(key)){
   const bytes=fs.readFileSync(resource);
   if(crypto.createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('Iron Hands resource checksum mismatch: '+record.path);
   if(record.path.endsWith('.glb')&&(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length))throw Error('Invalid Iron Hands carrier GLB');
   if(record.path.endsWith('.png')&&(bytes.length<29||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))throw Error('Invalid Iron Hands decal PNG');
   verified.set(key,true);if(verified.size>1024)verified.clear();
  }
 }
 if(!raw.files.some(x=>x.path===raw.catalog))throw Error('Iron Hands catalog is not in the file manifest');
 const catalogPath=resourcePath(dataRoot,raw.catalog),revision=manifestStamp+'|'+raw.files.map(x=>x.path+':'+stamp(resourcePath(dataRoot,x.path))+':'+x.sha256).join('|');
 const prior=cache.get(file);if(prior?.revision===revision)return prior.value;
 const value=JSON.parse(fs.readFileSync(catalogPath,'utf8').replace(/^\uFEFF/,''));
 if(value.schema!=='iron-hands-forge-iron-hands-catalog'||value.version!==1||!Array.isArray(value.classes)||!Array.isArray(value.decals)||!Array.isArray(value.materials)||!Array.isArray(value.colors)||!value.textures||!value.armorTags)throw Error('Invalid Iron Hands catalog');
 unique(value.decals,x=>x.id,'Duplicate Iron Hands decal ID');unique(value.colors,x=>x.id,'Duplicate Iron Hands palette ID');
 unique(value.materials,x=>x.slot+'|'+x.materialKey,'Duplicate Iron Hands section/material');
 const listed=new Set(raw.files.map(x=>x.path));
 for(const c of value.classes){
  if(!Array.isArray(c.classIds)||!c.classIds.length||!listed.has(c.carrierGLB)||!c.carrierGLB.endsWith('.glb')||!Array.isArray(c.carriers)||!Array.isArray(c.armorOptionBindings))throw Error('Invalid Iron Hands class carriers');
  unique(c.carriers,x=>x.nativeObjectId,'Duplicate native Iron Hands carrier ID');
  unique(c.armorOptionBindings,x=>x.classId+'|'+x.slot+'|'+x.optionId,'Duplicate Iron Hands armor binding');
  for(const cr of c.carriers){
   if(!Number.isSafeInteger(cr.nativeObjectId)||cr.uvSet!==0||cr.skinned!==true||!Array.isArray(cr.glbNodeIndices)||!cr.glbNodeIndices.length||cr.glbNodeIndices.some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Native Iron Hands carrier UV0/skinning reference is invalid');
  }
 }
 for(const tex of Object.values(value.textures)){
  if(!tex||!listed.has(tex.path)||!tex.path.endsWith('.png')||!Number.isSafeInteger(tex.width)||tex.width<1||!Number.isSafeInteger(tex.height)||tex.height<1)throw Error('Invalid Iron Hands texture reference');
 }
 const materialKeys=new Set(value.materials.map(x=>x.slot+'|'+x.materialKey));
 for(const d of value.decals)if(!materialKeys.has(d.section+'|'+d.material))throw Error('Iron Hands decal material is missing');
 for(const m of value.materials)for(const t of Object.values(m.textures||{}))if(t&&!Object.hasOwn(value.textures,t))throw Error('Iron Hands material texture is missing');
 const result={...value,ready:true,revision:crypto.createHash('sha256').update(revision).digest('hex'),manifestPath:MANIFEST,files:raw.files};
 cache.set(file,{revision,value:result});if(cache.size>16)cache.clear();
 return result;
}
function augmentIronHandsRegistry(registry,library){
 const result=structuredClone(registry);
 if(!library?.ready)return result;
 for(const c of result.classes||[]){
  const sources=library.classes.filter(source=>source.classIds.includes(c.id)),source=sources.length===1?sources[0]:null;
  const bindings=new Map((source?.armorOptionBindings||[]).filter(binding=>binding.classId===c.id).map(binding=>[binding.slot+'|'+binding.optionId,binding]));
  for(const slot of c.slots||[])for(const o of slot.options||[]){
   const binding=bindings.get(slot.id+'|'+o.id);
   if(binding){
    const carriers=(binding.carrierObjectIds||[]).map(id=>source.carriers.find(carrier=>carrier.nativeObjectId===id&&carrier.slot===slot.id));
    const supported=binding.explicitlyDisallowed!==true&&binding.isAbleToApplyDecals!==false&&carriers.length>0&&carriers.every(Boolean);
    o.forgeDecalSupport={supported,source:'native-armor-binding',carrierNames:supported?carriers.map(carrier=>carrier.nativeName):[]};
   }
   const tag=library.armorTags[o.id];if(!tag)continue;
   o.label=tag.label;o.chapter='iron-hands';o.tags=[...new Set([...(Array.isArray(o.tags)?o.tags:[]),'iron-hands'])];
  }
 }
 return result;
}
function resolveIronHandsDecal(library,{classId,slot,armorOptionId,decalId}={}){
 if(!library?.ready)throw Error('Iron Hands cosmetic library is unavailable');
 const source=library.classes.filter(c=>c.classIds.includes(classId));
 if(source.length!==1)throw Error('No unambiguous Iron Hands native carrier class: '+classId);
 const c=source[0],rows=c.armorOptionBindings.filter(x=>x.classId===classId&&x.slot===slot&&x.optionId===armorOptionId);
 if(rows.length!==1)throw Error('Selected armor variant has no native decal binding: '+armorOptionId);
 const binding=rows[0];
 if(binding.explicitlyDisallowed===true||binding.isAbleToApplyDecals===false)throw Error('Selected armor variant explicitly disallows decals: '+armorOptionId);
 const ids=[...new Set(binding.carrierObjectIds||[])];
 if(!ids.length)throw Error('Selected armor variant has no native decal carrier: '+armorOptionId);
 const carriers=ids.map(id=>c.carriers.find(x=>x.nativeObjectId===id));
 if(carriers.some(x=>!x||x.slot!==slot))throw Error('Selected native decal carrier slot is unresolved');
 const clear=decalId===null||decalId===undefined||decalId==='';
 const decal=clear?null:library.decals.find(x=>x.id===decalId);
 if(!clear&&!decal)throw Error('Unknown Iron Hands decal: '+decalId);
 if(decal&&decal.section!==slot)throw Error('Decal belongs to '+decal.section+', not '+slot);
 const material=library.materials.find(x=>x.slot===slot&&x.materialKey===(decal?.material||'default'));
 if(!material)throw Error('Native Iron Hands decal material is unresolved');
 return{classId,slot,armorOptionId,decalId:decal?.id||null,clear:clear||decal.material==='default',decal,material,
  carrierGLB:c.carrierGLB,sourceConstructor:c.sourceConstructor,carrierObjectIds:ids,carrierNames:carriers.map(x=>x.nativeName),
  carriers,uvSet:0,skinned:true,defaultColoring:decal?.classMergedDefaultColoring||{}};
}
module.exports={DIRECTORY,MANIFEST,resourcePath,loadIronHandsLibrary,augmentIronHandsRegistry,resolveIronHandsDecal};
