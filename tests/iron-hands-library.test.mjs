import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {DIRECTORY,MANIFEST,resourcePath,loadIronHandsLibrary,augmentIronHandsRegistry,resolveIronHandsDecal}=createRequire(import.meta.url)('../shared/iron-hands-library.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function work(t){
 const parent=path.join(root,'.build');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'iron-hands-test-'));
 t.after(()=>{const relative=path.relative(parent,dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(dir,{recursive:true})});
 return dir;
}
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function glb(){
 let json=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:0}]}));json=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]);
 const h=Buffer.alloc(20),bin=Buffer.alloc(8);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);bin.writeUInt32LE(0x004e4942,4);
 return Buffer.concat([h,json,bin]);
}
function fixture(t){
 const dir=work(t),folder=path.join(dir,...DIRECTORY.split('/'));fs.mkdirSync(folder,{recursive:true});
 const model=DIRECTORY+'/carriers/native.glb',catalogPath=DIRECTORY+'/catalog.json';
 const catalog={schema:'iron-hands-forge-iron-hands-catalog',version:1,sections:['LEFT_PAULDRON','RIGHT_PAULDRON'],textures:{},
 armorTags:{left_pauldron_custom_iron_hands:{label:'Iron Hands left pauldron',chapter:'iron-hands',tags:['iron-hands']}},
 colors:[{id:'White_Scar',rgba:{r:255,g:255,b:255,a:255}}],
 decals:[{id:'Left_Pau_Decal_Iron_Hands',section:'LEFT_PAULDRON',material:'iron_hands_01',classMergedDefaultColoring:{primary:'White_Scar'}},
 {id:'Right_Pau_Decal_Iron_Hands',section:'RIGHT_PAULDRON',material:'iron_hands_01',classMergedDefaultColoring:{primary:'White_Scar'}}],
 materials:[{slot:'LEFT_PAULDRON',materialKey:'iron_hands_01',textures:{},side:'native-left'},{slot:'RIGHT_PAULDRON',materialKey:'iron_hands_01',textures:{},side:'native-right'},
 {slot:'LEFT_PAULDRON',materialKey:'default',textures:{}},{slot:'RIGHT_PAULDRON',materialKey:'default',textures:{}}],
 classes:[{classIds:['PVE_PVP_SOLDIER'],sourceConstructor:'cc_sm_constructor_soldier',carrierGLB:model,
 carriers:[{nativeObjectId:12,nativeName:'native_left',slot:'LEFT_PAULDRON',uvSet:0,skinned:true,glbNodeIndices:[3],glbMeshIndices:[0]},
 {nativeObjectId:13,nativeName:'native_right',slot:'RIGHT_PAULDRON',uvSet:0,skinned:true,glbNodeIndices:[4],glbMeshIndices:[1]}],
 armorOptionBindings:[{classId:'PVE_PVP_SOLDIER',slot:'LEFT_PAULDRON',optionId:'left_ok',carrierObjectIds:[12]},
 {classId:'PVE_PVP_SOLDIER',slot:'RIGHT_PAULDRON',optionId:'right_ok',carrierObjectIds:[13]},
 {classId:'PVE_PVP_SOLDIER',slot:'LEFT_PAULDRON',optionId:'decorated',carrierObjectIds:[12],explicitlyDisallowed:true},
 {classId:'PVE_PVP_SOLDIER',slot:'LEFT_PAULDRON',optionId:'no_native_carrier',carrierObjectIds:[]}]}]};
 const manifest={schema:'iron-hands-forge-customization-library',version:1,catalog:catalogPath,files:[]};
 const manifestFile=path.join(dir,...MANIFEST.split('/'));
 function write(){
  const payloads=new Map([[model,glb()],[catalogPath,Buffer.from(JSON.stringify(catalog))]]);
  manifest.files=[];
  for(const[p,bytes]of payloads){const file=path.join(dir,...p.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);manifest.files.push({path:p,bytes:bytes.length,sha256:digest(bytes)})}
  fs.writeFileSync(manifestFile,JSON.stringify(manifest));
 }
 write();return{dir,folder,catalog,manifest,manifestFile,write};
}
const request={classId:'PVE_PVP_SOLDIER',slot:'LEFT_PAULDRON',armorOptionId:'left_ok',decalId:'Left_Pau_Decal_Iron_Hands'};
test('an absent optional Iron Hands subset leaves legacy data unchanged',t=>{
 const dir=work(t),before={classes:[{slots:[{options:[{id:'original'}]}]}]},lib=loadIronHandsLibrary(dir);
 assert.equal(lib.ready,false);const result=augmentIronHandsRegistry(before,lib);assert.deepEqual(result,before);assert.notEqual(result,before);
});
test('native placement resolves the selected variant and keeps left/right material identity',t=>{
 const f=fixture(t),lib=loadIronHandsLibrary(f.dir),p=resolveIronHandsDecal(lib,request);
 assert.equal(p.uvSet,0);assert.equal(p.skinned,true);assert.equal(p.carrierGLB,DIRECTORY+'/carriers/native.glb');assert.deepEqual(p.carrierObjectIds,[12]);assert.deepEqual(p.carriers[0].glbNodeIndices,[3]);assert.equal(p.material.side,'native-left');
 const r=resolveIronHandsDecal(lib,{...request,slot:'RIGHT_PAULDRON',armorOptionId:'right_ok',decalId:'Right_Pau_Decal_Iron_Hands'});
 assert.equal(r.material.side,'native-right');assert.deepEqual(r.carrierObjectIds,[13]);assert.deepEqual(p.defaultColoring,{primary:'White_Scar'});
});
test('Iron Hands semantic tags rename real native options without touching recipe IDs or selections',t=>{
 const f=fixture(t),registry={classes:[{id:'PVE_PVP_SOLDIER',initialSelection:{LEFT_PAULDRON:'original'},slots:[{id:'LEFT_PAULDRON',options:[{id:'left_pauldron_custom_iron_hands',label:'Shared variant 21',resolvedObjectIds:[57],tags:['existing']},{id:'plain',label:'Original'}]}]}]};
 const before=structuredClone(registry),result=augmentIronHandsRegistry(registry,loadIronHandsLibrary(f.dir)),o=result.classes[0].slots[0].options[0];
 assert.deepEqual(registry,before);assert.equal(o.label,'Iron Hands left pauldron');assert.equal(o.chapter,'iron-hands');assert.deepEqual(o.tags,['existing','iron-hands']);assert.deepEqual(o.resolvedObjectIds,[57]);assert.deepEqual(result.classes[0].initialSelection,before.classes[0].initialSelection);
});
test('native decal restrictions reject unrelated sections and variants before resolving any resource',t=>{
 const f=fixture(t),lib=loadIronHandsLibrary(f.dir);
 for(const [changes,message]of [[{armorOptionId:'decorated'},/explicitly disallows/],[{armorOptionId:'no_native_carrier'},/no native decal carrier/],[{armorOptionId:'invented'},/no native decal binding/],[{decalId:'Right_Pau_Decal_Iron_Hands'},/not LEFT_PAULDRON/],[{classId:'PVE_PVP_MEDIC'},/unambiguous/],[{decalId:'invented'},/Unknown/]]){
  assert.throws(()=>resolveIronHandsDecal(lib,{...request,...changes}),message);
 }
 const cleared=resolveIronHandsDecal(lib,{...request,decalId:null});assert.equal(cleared.clear,true);assert.equal(cleared.material.materialKey,'default');assert.deepEqual(cleared.carrierObjectIds,[12]);
});
test('manifest paths cannot escape DataRoot or use local Windows paths',t=>{
 const f=fixture(t);f.manifest.files[0].path='../outside.glb';fs.writeFileSync(f.manifestFile,JSON.stringify(f.manifest));
 assert.throws(()=>loadIronHandsLibrary(f.dir),/Invalid|Unsafe/);
 for(const p of ['C:/game/data.glb','/tmp/file','assets/../outside','assets\\payload','assets//payload','assets/\0x']){
  assert.throws(()=>resourcePath(f.dir,p),/Unsafe/);
 }
});
test('a present damaged subset fails explicitly instead of disappearing behind a fallback',t=>{
 const f=fixture(t);fs.writeFileSync(f.manifestFile,'not json');assert.throws(()=>loadIronHandsLibrary(f.dir),SyntaxError);
});
test('payload checksum changes are detected even when byte length is unchanged',t=>{
 const f=fixture(t);loadIronHandsLibrary(f.dir);const row=f.manifest.files.find(x=>x.path.endsWith('.glb')),file=resourcePath(f.dir,row.path),bytes=fs.readFileSync(file),old=fs.statSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);fs.utimesSync(file,old.atime,new Date(old.mtimeMs+2000));
 assert.throws(()=>loadIronHandsLibrary(f.dir),/checksum mismatch/);
});
test('native carrier references must retain UV0 and skinning',t=>{
 const f=fixture(t);f.catalog.classes[0].carriers[0].skinned=false;f.write();assert.throws(()=>loadIronHandsLibrary(f.dir),/UV0\/skinning/);
});
test('carrier symlinks cannot escape their prepared library',t=>{
 const f=fixture(t),row=f.manifest.files.find(x=>x.path.endsWith('.glb')),link=resourcePath(f.dir,row.path),outside=path.join(path.dirname(f.dir),'outside-'+path.basename(f.dir)+'.glb');fs.renameSync(link,outside);t.after(()=>fs.rmSync(outside,{force:true}));
 try{fs.symlinkSync(outside,link,'file')}catch(error){if(process.platform==='win32'&&['EPERM','EACCES'].includes(error.code)){t.skip('Windows account cannot create a file symlink');return}throw error}
 assert.throws(()=>loadIronHandsLibrary(f.dir),/link escapes/);
});
