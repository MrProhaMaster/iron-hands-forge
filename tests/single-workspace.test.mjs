import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {normalizeRecipe,encodeRecipe,decodeRecipe} from '../shared/recipe-codec.mjs';
const require=createRequire(import.meta.url);
const {migrateSingleWorkspace}=require('../shared/single-workspace.cjs');
const {createForgeServer}=require('../app/server.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stateRoot=path.join(root,'state');fs.mkdirSync(stateRoot,{recursive:true});
const appearance=()=>({colors:{trim:'#AABBCC',cloth:'#123456',beard:'#654321',skin:'#BCA987'},finish:{metallic:false,roughness:.61},parts:{LEFT_SHOULDER:{armor:'#20242A',trim:'#FAFAFA',metallic:true,roughness:.28}},decals:{LEFT_SHOULDER:{id:'ih.clan.avernii',color:'#EEEEEE',secondaryColor:'#AA0011',tertiaryColor:'#030405'}}});
const marine=(id='marine-1')=>({id,role:'Iron Hands',classId:'PVE_PVP_SOLDIER',selection:{HELMET:'local.helmet'},paint:{armor:'#171B22',metal:'#B3BDC9',lenses:'#EE291C'},motion:{gait:'walk',stance:'armed',speedPct:100,inPlace:true},appearance:appearance()});
const squad=(count=5)=>({schema:'medusa-draft-roster-v2',soldiers:Array.from({length:count},(_,i)=>marine('marine-'+i)),savedAt:'2026-10-29T09:00:00.000Z',legacyNote:'preserve original bytes'});
function directory(){return fs.mkdtempSync(path.join(stateRoot,'single-workspace-test-'));}
function cleanup(dir){const safe=path.resolve(dir);assert.ok(safe.startsWith(path.resolve(stateRoot)+path.sep));fs.rmSync(safe,{recursive:true,force:true});}
function withWorkspace(fn){const dir=directory();try{return fn(dir)}finally{cleanup(dir)}}
function write(dir,name,value,seconds=10){const bytes=Buffer.from(JSON.stringify(value,null,3)+'\n\n');const file=path.join(dir,name);fs.writeFileSync(file,bytes);fs.utimesSync(file,seconds,seconds);return bytes;}
const backupName=bytes=>'squad-before-single-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.json';

test('single workspace migration has no side effects when no saved marine exists',()=>withWorkspace(dir=>{
 assert.equal(migrateSingleWorkspace(dir),null);assert.deepEqual(fs.readdirSync(dir),[]);
}));
test('one-marine save stays byte-identical and does not create a backup or rewrite timestamp',()=>withWorkspace(dir=>{
 const saved=squad(1),bytes=write(dir,'selected-roster.json',saved);const result=migrateSingleWorkspace(dir);
 assert.deepEqual(result,saved);assert.deepEqual(fs.readFileSync(path.join(dir,'selected-roster.json')),bytes);assert.deepEqual(fs.readdirSync(dir),['selected-roster.json']);
}));
test('newest legacy squad is backed up before replacement; first complete marine retains appearance',()=>withWorkspace(dir=>{
 const selected=squad(5),selectedBytes=write(dir,'selected-roster.json',selected,20),oldDraft=squad(2),draftBytes=write(dir,'draft-roster.json',oldDraft,10);
 const originalRename=fs.renameSync;let renameChecked=false;
 fs.renameSync=function(source,target){
  if(target===path.join(dir,'draft-roster.json')){
   const backup=path.join(dir,'backups',backupName(selectedBytes));
   assert.deepEqual(fs.readFileSync(backup),selectedBytes,'the entire newest squad must exist before draft replacement');
   assert.deepEqual(fs.readFileSync(path.join(dir,'draft-roster.json')),draftBytes,'old draft must still exist until atomic rename');
   renameChecked=true;
  }
  return originalRename.apply(this,arguments);
 };
 let result;try{result=migrateSingleWorkspace(dir)}finally{fs.renameSync=originalRename}
 assert.equal(renameChecked,true);assert.equal(result.soldiers.length,1);assert.deepEqual(result.soldiers[0],selected.soldiers[0]);
 assert.deepEqual(fs.readFileSync(path.join(dir,'selected-roster.json')),selectedBytes,'legacy explicit save is not deleted');
 assert.deepEqual(fs.readFileSync(path.join(dir,result.workspace.backup)),selectedBytes);
 assert.equal(result.workspace.previousCount,5);assert.equal(result.workspace.mode,'single');assert.ok(!fs.existsSync(path.join(dir,'draft-roster.json.single.tmp')));
}));
test('newest draft is preserved byte-for-byte and repeat migration is idempotent',()=>withWorkspace(dir=>{
 write(dir,'selected-roster.json',squad(3),10);const latest=squad(5);latest.soldiers[0].appearance.finish.roughness=.003;
 const bytes=write(dir,'draft-roster.json',latest,20),result=migrateSingleWorkspace(dir);
 assert.deepEqual(fs.readFileSync(path.join(dir,result.workspace.backup)),bytes);
 const draft=fs.readFileSync(path.join(dir,'draft-roster.json')),again=migrateSingleWorkspace(dir);
 assert.deepEqual(again,result);assert.deepEqual(fs.readFileSync(path.join(dir,'draft-roster.json')),draft);
 assert.equal(fs.readdirSync(path.join(dir,'backups')).length,1);
}));
test('backup creation failure leaves the complete legacy squad untouched',()=>withWorkspace(dir=>{
 const bytes=write(dir,'draft-roster.json',squad());fs.writeFileSync(path.join(dir,'backups'),'path blocked');
 assert.throws(()=>migrateSingleWorkspace(dir));assert.deepEqual(fs.readFileSync(path.join(dir,'draft-roster.json')),bytes);
 assert.ok(!fs.existsSync(path.join(dir,'draft-roster.json.single.tmp')));
}));
test('an existing matching immutable backup can be reused',()=>withWorkspace(dir=>{
 const bytes=write(dir,'draft-roster.json',squad());const folder=path.join(dir,'backups');fs.mkdirSync(folder);
 const backup=path.join(folder,backupName(bytes));fs.writeFileSync(backup,bytes);const before=fs.statSync(backup).mtimeMs;
 const result=migrateSingleWorkspace(dir);assert.equal(result.soldiers.length,1);
 assert.deepEqual(fs.readFileSync(backup),bytes);assert.equal(fs.statSync(backup).mtimeMs,before);
}));
test('conflicting or corrupted pre-existing backup aborts before rewriting the legacy squad',()=>withWorkspace(dir=>{
 const bytes=write(dir,'draft-roster.json',squad());const folder=path.join(dir,'backups');fs.mkdirSync(folder);
 const backup=path.join(folder,backupName(bytes)),corrupt=Buffer.from('{"truncated":true}');fs.writeFileSync(backup,corrupt);
 assert.throws(()=>migrateSingleWorkspace(dir));assert.deepEqual(fs.readFileSync(path.join(dir,'draft-roster.json')),bytes);
 assert.deepEqual(fs.readFileSync(backup),corrupt);assert.ok(!fs.existsSync(path.join(dir,'draft-roster.json.single.tmp')));
}));
test('migration preserves appearance through server draft/save, recipe JSON export and IHF1 transfer',async()=>{
 const dir=directory();const source=squad();const selectedBytes=write(dir,'selected-roster.json',source);
 const server=createForgeServer({dataRoot:path.join(dir,'empty-data'),stateRoot:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(route,value)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
 try{
  const migrated=await post('/api/workspace/single',{});assert.equal(migrated.soldiers.length,1);
  assert.deepEqual(migrated.soldiers[0].appearance,source.soldiers[0].appearance);
  const originalBackup=fs.readFileSync(path.join(dir,migrated.workspace.backup));assert.deepEqual(originalBackup,selectedBytes);
  const edited=structuredClone(migrated.soldiers[0]);edited.appearance.parts.RIGHT_GREAVE={armor:'#ab19cd',roughness:.000001};edited.appearance.colors.trim='#abcdef';
  await post('/api/draft',{soldiers:[edited]});
  const draft=JSON.parse(fs.readFileSync(path.join(dir,'draft-roster.json'),'utf8'));
  assert.equal(draft.soldiers[0].appearance.colors.trim,'#ABCDEF');assert.equal(draft.soldiers[0].appearance.parts.RIGHT_GREAVE.armor,'#AB19CD');
  await post('/api/save',{soldiers:[edited]});
  const recipe=normalizeRecipe({schema:'iron-hands-forge',version:1,kind:'soldier',catalog:{game:'SM2',build:'offline'},soldiers:[edited]});
  const exported=await post('/api/recipes/export',{recipe});
  const fetched=await fetch(base+exported.url).then(r=>r.json());assert.deepEqual(fetched,recipe);
  assert.deepEqual(await decodeRecipe(exported.code),recipe);assert.deepEqual(await decodeRecipe(await encodeRecipe(fetched)),recipe);
  assert.deepEqual(fs.readFileSync(path.join(dir,migrated.workspace.backup)),selectedBytes,'saving the current single marine must never rewrite the legacy squad backup');
 }finally{await new Promise(r=>server.close(r));cleanup(dir)}
});


test('actual single-workspace transfer handlers preserve appearance and expose only one-marine creation',async()=>{
 const codecURL=new URL('../shared/recipe-codec.mjs',import.meta.url).href;
 const policyURL=new URL('../shared/motion-policy.mjs',import.meta.url).href;
 const source=fs.readFileSync(new URL('../app/web/forge-tools.js',import.meta.url),'utf8')
  .replace("from '/shared/recipe-codec.mjs'","from '"+codecURL+"'")
  .replace("from '/shared/motion-policy.mjs'","from '"+policyURL+"'");
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,showModal(){},close(){},focus(){},select(){}});return elements.get(id)};
 const previousDocument=globalThis.document;globalThis.document={getElementById:element,createElement:()=>({innerHTML:''}),body:{append(){}}};
 try{
  const {attachForgeTools}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const motionBindings=JSON.parse(fs.readFileSync(new URL('../shared/motion-bindings.json',import.meta.url),'utf8'));
  let current=marine('active'),imports=[];
  const cls={id:current.classId,available:true,tpl:'cc_sm_constructor_soldier',initialSelection:{HELMET:'local.helmet'},slots:[{id:'HELMET',options:[{id:'local.helmet',meshes:['helmet'],resolvedObjectIds:[1]}]}]};
  const catalog={configured:true,armor:{classes:[cls]},manifest:{assets:[{asset:cls.tpl}]},gameBuild:'offline',registryFingerprint:'fixture',motionBindings};
  attachForgeTools({getSoldiers:()=>[current],getActive:()=>0,getCatalog:()=>catalog,getMotion:()=>current.motion,singleWorkspace:true,
   async reloadCatalog(){},async importRecipe(r){imports.push(structuredClone(r));current=structuredClone(r.soldiers[0])}});
  assert.equal(element('code-roster').hidden,true);
  await element('share-build').onclick();
  const outgoing=await decodeRecipe(element('recipe-code').value);
  assert.equal(outgoing.kind,'soldier');assert.deepEqual(outgoing.soldiers[0].appearance,current.appearance);
  current.appearance.parts.LEFT_SHOULDER.armor='#FA137A';
  await element('share-build').onclick();
  const latest=await decodeRecipe(element('recipe-code').value);assert.equal(latest.soldiers[0].appearance.parts.LEFT_SHOULDER.armor,'#FA137A');
  const incoming={schema:'iron-hands-forge',version:1,kind:'roster',catalog:{game:'SM2',build:'offline'},soldiers:[marine('legacy-first'),marine('legacy-second')]};
  incoming.soldiers[0].appearance.parts.RIGHT_GREAVE={armor:'#AA0199'};
  const original=await encodeRecipe(incoming);element('recipe-code').value=original;
  await element('import-code').onclick();
  assert.equal(imports.length,1);assert.deepEqual(current.appearance,incoming.soldiers[0].appearance);
  const activeCode=await decodeRecipe(element('recipe-code').value);assert.equal(activeCode.kind,'soldier');assert.equal(activeCode.soldiers.length,1);assert.deepEqual(activeCode.soldiers[0].appearance,current.appearance);
  assert.equal((await decodeRecipe(original)).soldiers.length,2,'the original squad code is still valid and unmodified');
 }finally{globalThis.document=previousDocument}
});
