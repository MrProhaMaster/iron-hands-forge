import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {loadBionicLibrary,MANIFEST:LEFT_BIONIC_MANIFEST}=createRequire(import.meta.url)('../shared/left-bionic.cjs');
const {loadIronHandsLibrary,MANIFEST:IRON_HANDS_MANIFEST,DIRECTORY:IRON_HANDS_DIRECTORY}=createRequire(import.meta.url)('../shared/iron-hands-library.cjs');

const {loadAstartesLibrary,DIRECTORY:ASTARTES_DIRECTORY,MANIFEST:ASTARTES_MANIFEST}=createRequire(import.meta.url)('../shared/astartes-library.cjs');
const {inspectServoLibrary,SERVO_DIRECTORY,SERVO_MANIFEST}=createRequire(import.meta.url)('../shared/resource-library.cjs');

const APP_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MODEL_ROOT='assets/characters/SM2-retail-constructors/source-v5';
const BUNDLE_FILE='bundle-manifest.json';
export const BUNDLE_SCHEMA='iron-hands-forge-resource-bundle';
const PROOF=['transformValidation','restSkinValidation','weightPackingValidation','skinProfileWeldValidation'];
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hashFile=file=>{
  const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(4*1024*1024),fd=fs.openSync(file,'r');
  try{let length;while((length=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,length))}finally{fs.closeSync(fd)}
  return hash.digest('hex');
};
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');

export function safeRelative(value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.includes('\0')||path.posix.isAbsolute(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe bundle path: '+String(value));
  return value;
}

function within(root,file){return file===root||file.startsWith(root+path.sep)}
function regularFile(root,relative){
  const file=path.join(root,safeRelative(relative));
  if(!within(root,file)||!fs.statSync(file).isFile())throw Error('Missing runtime file: '+relative);
  if(!within(fs.realpathSync(root),fs.realpathSync(file)))throw Error('Runtime file escapes its data folder: '+relative);
  let current=file;
  while(current!==root){if(fs.lstatSync(current).isSymbolicLink())throw Error('Links are not allowed in resource bundles: '+relative);current=path.dirname(current)}
  return file;
}

function absoluteValue(value){return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value)}
function portablePath(value,dataRoot){
  const normalized=value.replace(/^\\\\\?\\/,'').replaceAll('\\','/');
  const sourceRoot=dataRoot.replaceAll('\\','/').replace(/\/$/,'');
  if(normalized.toLowerCase()===sourceRoot.toLowerCase())return 'bundled-data';
  if(normalized.toLowerCase().startsWith(sourceRoot.toLowerCase()+'/'))return normalized.slice(sourceRoot.length+1);
  const game=normalized.match(/(?:^|\/)steamapps\/common\/space marine 2\/(.+)$/i);
  if(game)return 'source-game/'+game[1];
  return 'source-input/'+(normalized.split('/').filter(Boolean).at(-1)||'external-resource');
}

export function sanitizeJSON(value,dataRoot){
  if(Array.isArray(value))return value.map(item=>sanitizeJSON(item,dataRoot));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitizeJSON(item,dataRoot)]));
  if(typeof value!=='string')return value;
  if(absoluteValue(value))return portablePath(value,dataRoot);
  return value
    .replace(/(?:[a-z]:[\\/]|\\\\)[^\r\n"<>]*/gi,match=>portablePath(match,dataRoot))
    .replace(/(^|[\s(])(\/(?:Users|home|mnt|media|Volumes|tmp|private|var|root|usr|opt)\/[^\r\n"<>]*)/g,(_,prefix,match)=>prefix+portablePath(match,dataRoot));
}

function assertPortableJSON(value,label){
  if(typeof value==='string'){
    if(absoluteValue(value)||/(?:[a-z]:[\\/]|\\\\)/i.test(value)||/(?:^|[\s(])\/(?:Users|home|mnt|media|Volumes|tmp|private|var|root|usr|opt)\//.test(value))throw Error('Absolute host path in '+label);
  }else if(Array.isArray(value)){for(const item of value)assertPortableJSON(item,label)}
  else if(value&&typeof value==='object'){for(const item of Object.values(value))assertPortableJSON(item,label)}
}

function glbSummary(file){
  const fd=fs.openSync(file,'r');
  try{
    const header=Buffer.alloc(20);if(fs.readSync(fd,header,0,20,0)!==20||header.readUInt32LE(0)!==0x46546c67||header.readUInt32LE(4)!==2||header.readUInt32LE(8)!==fs.statSync(file).size||header.readUInt32LE(16)!==0x4e4f534a)throw Error('Invalid GLB header: '+path.basename(file));
    const length=header.readUInt32LE(12);if(length<2||length>64*1024*1024||length+20>fs.statSync(file).size)throw Error('Invalid GLB JSON length: '+path.basename(file));
    const bytes=Buffer.alloc(length);if(fs.readSync(fd,bytes,0,length,20)!==length)throw Error('Truncated GLB JSON: '+path.basename(file));
    const gltf=JSON.parse(bytes.toString('utf8').trim());
    if(gltf.asset?.version!=='2.0'||!Array.isArray(gltf.meshes)||!gltf.meshes.length)throw Error('GLB has no usable meshes: '+path.basename(file));
    return gltf;
  }finally{fs.closeSync(fd)}
}

function astartesSummary(library){return{ready:library.ready,profiles:library.profiles.length,options:library.options.length,models:library.models.length,unavailable:library.unavailableOptions?.length||0}}
function ironHandsSummary(library){return{ready:library.ready,decals:library.decals.filter(d=>d.material!=='default').length,textures:Object.keys(library.textures).length,carrierLibraries:library.classes.length,nativeCarriers:library.classes.reduce((sum,c)=>sum+c.carriers.length,0)}}

function inspectData(dataRoot){
  const root=path.resolve(dataRoot),bindings=readJSON(path.join(APP_ROOT,'shared/motion-bindings.json'));
  const registry=readJSON(regularFile(root,'production/roster/armor-options.json'));
  const paints=readJSON(regularFile(root,'production/roster/armor-paints.json'));
  const source=readJSON(regularFile(root,MODEL_ROOT+'/manifest.json'));
  const motion=readJSON(regularFile(root,'assets/animations/motion-manifest.json'));
  if(!Array.isArray(registry.classes)||!Array.isArray(source.assets))throw Error('Invalid armour catalogue or model manifest');
  const classes=registry.classes.filter(item=>item.available);
  const bionics=loadBionicLibrary(root),ironHands=loadIronHandsLibrary(root),servo=inspectServoLibrary(root),astartes=loadAstartesLibrary(root);
  if(bionics.ready&&(bionics.classes.length!==classes.length||classes.some(c=>!bionics.classes.some(b=>b.classId===c.id&&b.asset===c.tpl))))throw Error('The left-bionic library must cover every supported class');
  const expected=Object.entries(bindings.classes).filter(([,binding])=>binding.status==='validated').map(([id])=>id).sort();
  if(!classes.length||new Set(classes.map(item=>item.id)).size!==classes.length||JSON.stringify(classes.map(item=>item.id).sort())!==JSON.stringify(expected))throw Error('The complete supported class catalogue is required');
  const files=new Set(['production/roster/armor-options.json','production/roster/armor-paints.json',MODEL_ROOT+'/manifest.json','assets/animations/motion-manifest.json']);
  if(bionics.ready){files.add(LEFT_BIONIC_MANIFEST);for(const record of bionics.classes)files.add(safeRelative(record.relativePath))}
  if(ironHands.ready){files.add(IRON_HANDS_MANIFEST);for(const record of ironHands.files)files.add(safeRelative(record.path))}
  if(servo.ready){files.add(servo.manifestPath);for(const record of servo.files)files.add(safeRelative(record.path))}
  if(astartes.ready){files.add(ASTARTES_MANIFEST);for(const record of astartes.files)files.add(safeRelative(record.path));for(const model of astartes.models)assertPortableJSON(glbSummary(regularFile(root,model.glb)),model.id);}
  const assets=[],summaries=[];
  for(const entry of classes){
    if(!/^cc_sm_constructor_[a-z0-9_]+$/.test(entry.tpl)||bindings.classes[entry.id].asset!==entry.tpl)throw Error('Invalid class/model binding: '+entry.id);
    if(!Array.isArray(entry.slots)||!entry.slots.length||entry.slots.some(slot=>!Array.isArray(slot.options))||!entry.slots.some(slot=>slot.options.length))throw Error('Incomplete armour options: '+entry.id);
    const asset=source.assets.find(item=>item.asset===entry.tpl);
    if(!asset||PROOF.some(key=>asset[key]!=='passed'))throw Error('Model has not passed source validation: '+entry.tpl);
    const geometry=regularFile(root,MODEL_ROOT+'/'+entry.tpl+'.glb'),metadata=readJSON(regularFile(root,MODEL_ROOT+'/'+entry.tpl+'.json'));
    const gltf=glbSummary(geometry);
    assertPortableJSON(gltf,entry.tpl+'.glb JSON chunk');
    if(!Array.isArray(metadata.meshes)||metadata.meshes.length!==gltf.meshes.length||!Array.isArray(metadata.objectMetadata)||!metadata.objectMetadata.length)throw Error('Incomplete source metadata: '+entry.tpl);
    if(metadata.asset!==entry.tpl||metadata.meshes.some((mesh,index)=>mesh.name!==gltf.meshes[index].name))throw Error('Source mesh identity mismatch: '+entry.tpl);
    assets.push(asset);summaries.push({id:entry.id,asset:entry.tpl,slotCount:entry.slots.length,optionCount:entry.slots.reduce((sum,slot)=>sum+slot.options.length,0)+(bionics.classes.some(b=>b.classId===entry.id)?1:0)});
    files.add(MODEL_ROOT+'/'+entry.tpl+'.glb');files.add(MODEL_ROOT+'/'+entry.tpl+'.json');
  }
  for(const clip of Object.values(bindings.clips)){
    const relative='assets/animations/'+safeRelative(clip.output),clipData=readJSON(regularFile(root,relative));
    if(!Array.isArray(clipData.times)||!clipData.times.length||!Array.isArray(clipData.channels)||!clipData.channels.length)throw Error('Invalid motion clip: '+relative);
    files.add(relative);
  }
  return {root,registry,paints,source,motion,assets,ironHands,servo,astartes,classes:summaries,files:[...files].sort()};
}

function listFiles(root){
  const files=[];
  function visit(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,item.name);if(item.isSymbolicLink())throw Error('Links are not allowed in resource bundles');if(item.isDirectory())visit(full);else if(item.isFile())files.push(path.relative(root,full).split(path.sep).join('/'));else throw Error('Unexpected resource file type')}}
  visit(root);return files.sort();
}

function writeAtomic(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,bytes);fs.renameSync(temp,file)}

export function bundleResources(dataRoot,outputRoot){
  const data=inspectData(dataRoot),out=path.resolve(outputRoot);
  if(out===data.root||within(out,data.root)||[path.join(data.root,'assets'),path.join(data.root,'production')].some(input=>within(input,out)))throw Error('Choose a separate output folder outside the source assets and production folders');
  if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Output folder is not empty; choose a fresh staging folder');
  const source=sanitizeJSON(data.source,data.root);
  source.assets=data.assets.map(asset=>({...sanitizeJSON(asset,data.root),raw:MODEL_ROOT+'/'+asset.asset+'.glb',metadata:MODEL_ROOT+'/'+asset.asset+'.json'}));
  source.output=MODEL_ROOT;source.expectedAssets=data.classes.map(item=>item.asset);source.selected=source.exported=data.classes.length;source.failed=0;
  const jsonFiles=new Map([
    ['production/roster/armor-options.json',sanitizeJSON(data.registry,data.root)],
    ['production/roster/armor-paints.json',sanitizeJSON(data.paints,data.root)],
    [MODEL_ROOT+'/manifest.json',source],
    ['assets/animations/motion-manifest.json',sanitizeJSON(data.motion,data.root)]
  ]);
  const entries=[];
  for(const relative of data.files){
    const input=regularFile(data.root,relative),target=path.join(out,relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if(relative.endsWith('.json')){
      const preserveCustomization=[IRON_HANDS_DIRECTORY,SERVO_DIRECTORY,ASTARTES_DIRECTORY].some(dir=>relative.startsWith(dir+'/'));
      const value=preserveCustomization?readJSON(input):jsonFiles.get(relative)??sanitizeJSON(readJSON(input),data.root);assertPortableJSON(value,relative);
      // The optional subset has its own hashes. Preserve its already-portable JSON bytes.
      if(preserveCustomization)fs.copyFileSync(input,target,fs.constants.COPYFILE_EXCL);else writeAtomic(target,jsonBytes(value));
    }else fs.copyFileSync(input,target,fs.constants.COPYFILE_EXCL);
    entries.push({path:relative,bytes:fs.statSync(target).size,sha256:hashFile(target)});
  }
  const manifest={schema:BUNDLE_SCHEMA,version:1,appVersion:readJSON(path.join(APP_ROOT,'package.json')).version,sourceGame:'Space Marine 2',gameBuild:String(data.registry.gameBuild||data.source.gameBuild||'unknown'),classIds:data.classes.map(item=>item.id),classes:data.classes,counts:{classes:data.classes.length,armorOptions:data.classes.reduce((sum,item)=>sum+item.optionCount,0),files:entries.length},files:entries,customization:{astartes:astartesSummary(data.astartes),ironHands:ironHandsSummary(data.ironHands),servoPose:{ready:data.servo.ready,channels:data.servo.profile?.channels.length||0}},materialMode:'forge-preview-colours',createdAt:new Date().toISOString()};
  writeAtomic(path.join(out,BUNDLE_FILE),jsonBytes(manifest));
  return verifyBundle(out);
}

export function verifyBundle(bundleRoot){
  const root=path.resolve(bundleRoot),manifest=readJSON(regularFile(root,BUNDLE_FILE));
  if(manifest.schema!==BUNDLE_SCHEMA||manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Unsupported resource bundle manifest');
  const paths=manifest.files.map(item=>safeRelative(item.path));
  if(new Set(paths).size!==paths.length||paths.includes(BUNDLE_FILE))throw Error('Duplicate or recursive bundle manifest entry');
  const actual=listFiles(root),expected=[BUNDLE_FILE,...paths].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Unexpected or missing resource files; only the declared runtime payload is permitted');
  for(const item of manifest.files){
    if(!Number.isSafeInteger(item.bytes)||item.bytes<=0||!/^([a-f0-9]{64})$/.test(item.sha256))throw Error('Invalid file integrity record: '+item.path);
    const file=regularFile(root,item.path);
    if(fs.statSync(file).size!==item.bytes||hashFile(file)!==item.sha256)throw Error('Resource checksum mismatch: '+item.path);
    if(item.path.endsWith('.json'))assertPortableJSON(readJSON(file),item.path);
  }
  assertPortableJSON(manifest,BUNDLE_FILE);
  const data=inspectData(root);
  if((data.astartes.ready||manifest.customization?.astartes!==undefined)&&JSON.stringify(manifest.customization?.astartes)!==JSON.stringify(astartesSummary(data.astartes)))throw Error('Resource bundle Astartes inventory does not match its runtime catalogue');
  if((data.servo.ready||manifest.customization?.servoPose!==undefined)&&JSON.stringify(manifest.customization?.servoPose)!==JSON.stringify({ready:data.servo.ready,channels:data.servo.profile?.channels.length||0}))throw Error('Resource bundle servo inventory does not match its runtime profile');
  if((data.ironHands.ready||manifest.customization?.ironHands!==undefined)&&JSON.stringify(manifest.customization?.ironHands)!==JSON.stringify(ironHandsSummary(data.ironHands)))throw Error('Resource bundle Iron Hands inventory does not match its runtime catalogue');
  if(JSON.stringify(paths.slice().sort())!==JSON.stringify(data.files)||JSON.stringify(manifest.classIds)!==JSON.stringify(data.classes.map(item=>item.id))||JSON.stringify(manifest.classes)!==JSON.stringify(data.classes)||manifest.counts?.classes!==data.classes.length||manifest.counts?.armorOptions!==data.classes.reduce((sum,item)=>sum+item.optionCount,0)||manifest.counts?.files!==paths.length)throw Error('Resource bundle inventory does not match its runtime catalogue');
  return {ok:true,schema:manifest.schema,version:manifest.version,appVersion:manifest.appVersion,root,classIds:manifest.classIds,classes:manifest.counts.classes,armorOptions:manifest.counts.armorOptions,files:paths.length,astartes:astartesSummary(data.astartes),ironHands:ironHandsSummary(data.ironHands),servoPose:{ready:data.servo.ready,channels:data.servo.profile?.channels.length||0},bytes:manifest.files.reduce((sum,item)=>sum+item.bytes,0)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args[0]==='--verify'&&args.length===2)console.log(JSON.stringify(verifyBundle(args[1])));
    else{
      const options={};for(let index=0;index<args.length;index+=2){if(!['--data-root','--out'].includes(args[index])||!args[index+1]||options[args[index]])throw Error('Usage: --data-root PATH --out OUTPUT_DATA, or --verify OUTPUT_DATA');options[args[index]]=args[index+1]}
      if(!options['--data-root']||!options['--out'])throw Error('Usage: --data-root PATH --out OUTPUT_DATA, or --verify OUTPUT_DATA');
      console.log(JSON.stringify(bundleResources(options['--data-root'],options['--out'])));
    }
  }catch(error){console.error(error.message);process.exitCode=1}
}
