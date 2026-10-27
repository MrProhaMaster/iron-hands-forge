import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {bionicResourcePlan,serveBionicPlan} from '../shared/bionic-resources.mjs';
const {loadBionicLibrary,loadBionicClass,augmentBionicRegistry,filterBionicObjectIds}=createRequire(import.meta.url)('../shared/left-bionic.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function workspace(t){
 const parent=path.join(root,'.build');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'bionic-http-'));
 t.after(()=>{const relative=path.relative(parent,dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(dir,{recursive:true})});return dir;
}
const registry=()=>({classes:[{id:'PVE_PVP_SOLDIER',tpl:'cc_sm_constructor_soldier',available:true,initialSelection:{LEFT_GAUNTLET:'original'},slots:[{id:'LEFT_GAUNTLET',options:[{id:'original',resolvedObjectIds:[7,8],meshes:['old_arm']}]}]},{id:'PVE_PVP_MEDIC',available:false,slots:[]}]});
const record=()=>({classId:'PVE_PVP_SOLDIER',asset:'cc_sm_constructor_soldier',objectId:9000001,meshNames:['preview_steel_IH_left_bionic_soldier_00'],connectorObjectIds:[7],connectorMeshNames:['torso_l_gauntlet'],excludeObjectIds:[8]});
function addonLibrary(t){
 const dir=workspace(t),folder=path.join(dir,'assets/characters/SM2-left-bionic/native-v1');fs.mkdirSync(folder,{recursive:true});
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{name:record().meshNames[0],primitives:[{attributes:{POSITION:0},mode:4}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'}]};
 let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]);
 const binary=Buffer.alloc(36),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);binary.writeFloatLE(1,12);binary.writeFloatLE(1,28);
 header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);
 const bytes=Buffer.concat([header,json,binHeader,binary]),file=path.join(folder,'PVE_PVP_SOLDIER.glb');fs.writeFileSync(file,bytes);
 const row={...record(),optionId:'forge_left_bionic_v1',relativePath:'assets/characters/SM2-left-bionic/native-v1/PVE_PVP_SOLDIER.glb',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const manifest=path.join(folder,'manifest.json');fs.writeFileSync(manifest,JSON.stringify({schema:'iron-hands-forge-left-bionic-library',version:1,classes:[row]}));
 return{dir,file,bytes,manifest,row};
}
function symlinkOrSkip(t,target,link){
 try{fs.symlinkSync(target,link,'file');return true}
 catch(error){if(process.platform==='win32'&&['EPERM','EACCES'].includes(error.code)){t.skip('Windows account cannot create file symlinks');return false}throw error}
}
test('addon cache misses reject same-size payload tampering',t=>{
 const fixture=addonLibrary(t),args={dataRoot:fixture.dir,classId:fixture.row.classId};
 assert.equal(loadBionicClass(args).addonDoc.meshes[0].name,fixture.row.meshNames[0]);
 const before=fs.statSync(fixture.file),changed=Buffer.from(fixture.bytes);changed[changed.length-1]^=1;fs.writeFileSync(fixture.file,changed);
 fs.utimesSync(fixture.file,before.atime,new Date(before.mtimeMs+2000));assert.equal(fs.statSync(fixture.file).size,fixture.row.bytes);
 assert.throws(()=>loadBionicClass(args),/checksum mismatch/);
});
test('addon checksum is validated before parsing and after a manifest digest change',t=>{
 const fixture=addonLibrary(t),args={dataRoot:fixture.dir,classId:fixture.row.classId};
 loadBionicClass(args);
 const before=fs.statSync(fixture.manifest),changed={...fixture.row,sha256:'0'.repeat(64)};
 fs.writeFileSync(fixture.manifest,JSON.stringify({schema:'iron-hands-forge-left-bionic-library',version:1,classes:[changed]}));
 fs.utimesSync(fixture.manifest,before.atime,new Date(before.mtimeMs+2000));
 assert.throws(()=>loadBionicClass(args),/checksum mismatch/);
 const damaged=Buffer.from(fixture.bytes);damaged[20]=33;fs.writeFileSync(fixture.file,damaged);
 assert.throws(()=>loadBionicClass(args),/checksum mismatch/);
});
for(const extension of ['glb','json'])test('augmented source '+extension+' cannot follow a symlink outside source-v5',t=>{
 const fixture=addonLibrary(t),sourceRoot=path.join(fixture.dir,'assets/characters/SM2-retail-constructors/source-v5');fs.mkdirSync(sourceRoot,{recursive:true});
 const asset=fixture.row.asset,body=path.join(sourceRoot,asset+'.glb'),metadata=path.join(sourceRoot,asset+'.json');
 fs.writeFileSync(body,fixture.bytes);fs.writeFileSync(metadata,JSON.stringify({meshes:[],objectMetadata:[]}));
 const link=extension==='glb'?body:metadata,outside=path.join(fixture.dir,'outside.'+extension);fs.renameSync(link,outside);
 if(!symlinkOrSkip(t,outside,link))return;
 assert.throws(()=>bionicResourcePlan(fixture.dir,asset,extension),error=>error.status===403&&/Forbidden link/.test(error.message));
});
test('a legacy library without addons retains the original catalogue and choices',t=>{
 const dir=workspace(t),r=registry(),copy=structuredClone(r),library=loadBionicLibrary(dir);
 assert.equal(library.ready,false);assert.deepEqual(augmentBionicRegistry(r,library),copy);assert.deepEqual(r,copy);
});
test('bionic option includes its single native connector without changing original defaults',()=>{
 const r=registry(),before=structuredClone(r),augmented=augmentBionicRegistry(r,{classes:[record()]}),c=augmented.classes[0],option=c.slots[0].options[1];
 assert.deepEqual(r,before);assert.deepEqual(c.initialSelection,before.classes[0].initialSelection);assert.equal(option.id,'forge_left_bionic_v1');assert.deepEqual(option.resolvedObjectIds,[7,9000001]);assert.deepEqual(option.resolvedMeshes,['torso_l_gauntlet','preview_steel_IH_left_bionic_soldier_00']);assert.deepEqual(augmented.classes[1],before.classes[1]);
 assert.throws(()=>augmentBionicRegistry(augmented,{classes:[record()]}),/collides/);
});
test('compatibility filtering suppresses replaced arm pieces only while bionic is selected',()=>{
 const ids=new Set([7,8,42,9000001]);
 assert.deepEqual([...filterBionicObjectIds([{option:{id:'original'}}],ids)],[7,8,42,9000001]);
 const option=augmentBionicRegistry(registry(),{classes:[record()]}).classes[0].slots[0].options[1];
 assert.deepEqual([...filterBionicObjectIds([{option}],ids)],[7,42,9000001]);assert.deepEqual([...ids],[7,8,42,9000001]);
});
test('invalid addon paths fail closed before reading outside the resource library',t=>{
 const dir=workspace(t),folder=path.join(dir,'assets/characters/SM2-left-bionic/native-v1');fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({schema:'iron-hands-forge-left-bionic-library',version:1,classes:[{...record(),optionId:'forge_left_bionic_v1',relativePath:'../outside.glb',bytes:100,sha256:'a'.repeat(64)}]}));
 assert.throws(()=>loadBionicLibrary(dir),/Unsafe/);
});
test('virtual GLB streaming supports full, HEAD and ranges across native and appended bytes',async t=>{
 const dir=workspace(t),file=path.join(dir,'native.bin');fs.writeFileSync(file,'xxNATIVE-DATAyy');
 const segments=[Buffer.from('HEAD'),{file,offset:2,length:11},Buffer.from('ADDON')],expected=Buffer.from('HEADNATIVE-DATAADDON');
 const plan={length:expected.length,type:'model/gltf-binary',segments};
 const server=http.createServer((req,res)=>serveBionicPlan(req,res,plan));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port;
 assert.deepEqual(Buffer.from(await(await fetch(url)).arrayBuffer()),expected);
 for(const [start,end]of [[0,3],[2,8],[11,17],[15,19]]){const response=await fetch(url,{headers:{Range:`bytes=${start}-${end}`}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${expected.length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected.subarray(start,end+1))}
 const head=await fetch(url,{method:'HEAD'});assert.equal(Number(head.headers.get('content-length')),expected.length);assert.equal((await head.arrayBuffer()).byteLength,0);
 for(const range of ['bytes=999-','bytes=4-2','bytes=-8','broken']){const response=await fetch(url,{headers:{Range:range}});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */'+expected.length)}
});
