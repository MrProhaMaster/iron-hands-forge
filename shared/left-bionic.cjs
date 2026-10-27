'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const DIRECTORY='assets/characters/SM2-left-bionic/native-v1';
const MANIFEST=DIRECTORY+'/manifest.json';
const OPTION_ID='forge_left_bionic_v1';
const manifests=new Map(),models=new Map();
function contained(root,relative){
 if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.includes(':')||relative.includes('\0')||path.posix.isAbsolute(relative)||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe left-bionic resource path');
 const file=path.resolve(root,relative),base=path.resolve(root);
 if(!file.startsWith(base+path.sep))throw Error('Left-bionic resource escapes its library');
 return file;
}
function info(file){try{const s=fs.statSync(file);return s.isFile()&&s.size>0?{bytes:s.size,revision:s.size+':'+s.mtimeMs}:null}catch{return null}}
function validateRecord(value,dataRoot){
 if(!value||!/^PVE_PVP_[A-Z_]+$/.test(value.classId||'')||!/^cc_sm_constructor_[a-z0-9_]+$/.test(value.asset||'')||value.optionId!==OPTION_ID||!Number.isSafeInteger(value.objectId)||value.objectId<9000000||!Number.isSafeInteger(value.bytes)||value.bytes<=28||!/^[a-f0-9]{64}$/.test(value.sha256||''))throw Error('Invalid left-bionic class record');
 if(!Array.isArray(value.meshNames)||!value.meshNames.length||value.meshNames.some(x=>typeof x!=='string'||!x||x.includes('\0')))throw Error('Missing left-bionic mesh names');
 for(const key of ['connectorObjectIds','excludeObjectIds'])if(value[key]!==undefined&&(!Array.isArray(value[key])||value[key].some(x=>!Number.isSafeInteger(x))))throw Error('Invalid left-bionic compatibility IDs');
 const file=contained(dataRoot,value.relativePath),stat=info(file);
 if(!value.relativePath.startsWith(DIRECTORY+'/')||!value.relativePath.endsWith('.glb')||!stat||stat.bytes!==value.bytes)throw Error('Left-bionic resource is missing or incomplete: '+value.classId);
 const rootReal=fs.realpathSync(dataRoot),fileReal=fs.realpathSync(file);
 if(!fileReal.startsWith(rootReal+path.sep))throw Error('Left-bionic resource link escapes its library');
 return {...value,connectorObjectIds:[...new Set(value.connectorObjectIds||[])],connectorMeshNames:[...new Set(value.connectorMeshNames||[])],excludeObjectIds:[...new Set(value.excludeObjectIds||[])],revision:stat.revision};
}
function loadBionicLibrary(dataRoot){
 dataRoot=path.resolve(dataRoot);const file=contained(dataRoot,MANIFEST),stat=info(file);
 if(!stat)return{ready:false,classes:[],revision:'absent',manifestPath:MANIFEST};
 const prior=manifests.get(file);
 const raw=prior?.revision===stat.revision?prior.raw:JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 if(raw.schema!=='iron-hands-forge-left-bionic-library'||raw.version!==1||!Array.isArray(raw.classes))throw Error('Unsupported left-bionic resource library');
 const classes=raw.classes.map(value=>validateRecord(value,dataRoot));
 if(new Set(classes.map(x=>x.classId)).size!==classes.length||new Set(classes.map(x=>x.objectId)).size!==classes.length)throw Error('Duplicate left-bionic class or object ID');
 manifests.set(file,{revision:stat.revision,raw});
 return{ready:classes.length>0,classes,revision:stat.revision+'|'+classes.map(x=>x.classId+':'+x.revision).join('|'),manifestPath:MANIFEST};
}
function loadBionicClass({dataRoot,classId,asset}){
 const library=loadBionicLibrary(dataRoot),record=library.classes.find(x=>(classId===undefined||x.classId===classId)&&(asset===undefined||x.asset===asset));
 if(!record)return null;
 const file=contained(dataRoot,record.relativePath),cached=models.get(file);
 if(cached?.revision===record.revision&&cached.sha256===record.sha256)return{...cached.value,optionRecord:record};
 const bytes=fs.readFileSync(file);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('Left-bionic resource checksum mismatch: '+record.classId);
 if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('Invalid left-bionic GLB');
 const length=bytes.readUInt32LE(12),at=20+length;
 if(length<2||at+8>bytes.length||bytes.readUInt32LE(at+4)!==0x004e4942)throw Error('Invalid left-bionic GLB chunks');
 const binLength=bytes.readUInt32LE(at);if(at+8+binLength!==bytes.length)throw Error('Truncated left-bionic GLB');
 const value={optionRecord:record,addonDoc:JSON.parse(bytes.subarray(20,at).toString('utf8').trim()),addonBin:bytes.subarray(at+8)};
 models.set(file,{revision:record.revision,sha256:record.sha256,value});return value;
}
function augmentBionicRegistry(registry,library){
 const result=structuredClone(registry);
 for(const c of result.classes||[]){
  const record=library?.classes?.find(x=>x.classId===c.id&&x.asset===c.tpl);
  if(!c.available||!record)continue;
  const slot=c.slots?.find(x=>x.id==='LEFT_GAUNTLET');if(!slot)continue;
  if(slot.options.some(x=>x.id===OPTION_ID))throw Error('Left-bionic option collides with the original catalogue');
  slot.options.push({id:OPTION_ID,label:'Bionic left arm',meshes:[...record.connectorMeshNames,...record.meshNames],resolvedMeshes:[...record.connectorMeshNames,...record.meshNames],resolvedObjectIds:[...record.connectorObjectIds,record.objectId],geometryAvailable:true,geometryComplete:true,resolutionStatus:'complete',sourceType:'ForgeMirroredBionic',isDefault:false,isInitial:false,shared:false,allowedAppearanceUids:[c.id],forgeBionic:{classId:c.id,excludeObjectIds:record.excludeObjectIds}});
 }
 return result;
}
function filterBionicObjectIds(parts,objectIds){
 const excluded=new Set(parts.flatMap(p=>p.option?.forgeBionic?.excludeObjectIds||[]));
 return new Set([...objectIds].filter(id=>!excluded.has(id)));
}
module.exports={DIRECTORY,MANIFEST,OPTION_ID,loadBionicLibrary,loadBionicClass,augmentBionicRegistry,filterBionicObjectIds};
