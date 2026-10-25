import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {encodeRecipe,decodeRecipe} from '../shared/recipe-codec.mjs';

// Exercise the actual event handlers without a browser/WebGL dependency.
// Only the absolute browser import needs a file URL for Node.
const codecURL=new URL('../shared/recipe-codec.mjs',import.meta.url).href;
const policyURL=new URL('../shared/motion-policy.mjs',import.meta.url).href;
const motionBindings=JSON.parse(fs.readFileSync(new URL('../shared/motion-bindings.json',import.meta.url),'utf8'));
const source=fs.readFileSync(new URL('../app/web/forge-tools.js',import.meta.url),'utf8')
 .replace("from '/shared/recipe-codec.mjs'",`from '${codecURL}'`)
 .replace("from '/shared/motion-policy.mjs'",`from '${policyURL}'`);
const {attachForgeTools}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const paint={armor:'#171b22',metal:'#b3bdc9',lenses:'#ee291c'};
const tacticalMotion={gait:'run',stance:'unarmed',speedPct:125,inPlace:true};
function fixture(){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,showModal(){},close(){},focus(){},select(){}});return elements.get(id)};
 globalThis.document={getElementById:element,createElement:()=>({innerHTML:''}),body:{append(){}}};
 const ids=['PVE_PVP_SOLDIER','PVE_PVP_RAIDER','PVE_PVP_TANK'];
 const classes=ids.map((id,i)=>({id,available:true,tpl:i===0?'cc_sm_constructor_soldier':i===1?'cc_sm_constructor_raider':'cc_sm_constructor_tank',initialSelection:{HELMET:'helmet_'+i+'_common_01'},slots:[{id:'HELMET',options:[{id:'helmet_'+i+'_common_01',meshes:['helmet_'+i],resolvedObjectIds:[100+i]}]}]}));
 const soldiers=ids.map((classId,i)=>({id:'IH-'+i,role:'Role '+i,classId,selection:{},paint:{...paint}}));
 soldiers[2].motion={gait:'run',stance:'armed',speedPct:200,inPlace:true};
 const catalog={configured:true,armor:{classes},manifest:{assets:classes.map(c=>({asset:c.tpl}))},motionBindings,gameBuild:'fixture',registryFingerprint:'fixture'};
 let active=0,imports=[];
 attachForgeTools({getSoldiers:()=>soldiers,getActive:()=>active,getCatalog:()=>catalog,getMotion:()=>tacticalMotion,async importRecipe(r){imports.push(r)},async reloadCatalog(){}});
 return{element,classes,soldiers,catalog,imports,setActive:i=>{active=i}};
}

test('roster sharing keeps active motion and saved/default motion for every supported class',async()=>{
 const f=fixture();
 await f.element('code-roster').onclick();
 const decoded=await decodeRecipe(f.element('recipe-code').value);
 assert.equal(decoded.kind,'roster');
 assert.deepEqual(decoded.soldiers[0].motion,tacticalMotion);
 assert.deepEqual(decoded.soldiers[1].motion,{gait:'walk',stance:'unarmed',speedPct:100,inPlace:true});
 assert.deepEqual(decoded.soldiers[2].motion,f.soldiers[2].motion);
 decoded.soldiers.forEach((s,i)=>assert.equal(s.selection.HELMET,'helmet_'+i+'_common_01'));
 assert.equal(f.soldiers.every(s=>Object.keys(s.selection).length===0),true,'code completion must not mutate the live roster');
});

test('sharing a selected Raider includes the active supported game preview motion',async()=>{
 const f=fixture();f.setActive(1);
 await f.element('code-soldier').onclick();
 const decoded=await decodeRecipe(f.element('recipe-code').value);
 assert.equal(decoded.kind,'soldier');
 assert.equal(decoded.soldiers[0].classId,'PVE_PVP_RAIDER');
 assert.deepEqual(decoded.soldiers[0].motion,tacticalMotion);
 assert.equal(decoded.soldiers[0].selection.HELMET,'helmet_1_common_01');
});

test('unavailable geometry in a valid share code is rejected before roster import',async()=>{
 const f=fixture();
 f.classes[1].slots[0].options.push({id:'known_but_unresolved',meshes:['missing_mesh'],resolvedObjectIds:[]});
 const recipe={schema:'iron-hands-forge',version:1,kind:'soldier',catalog:{game:'SM2',build:'fixture'},soldiers:[{...f.soldiers[1],selection:{HELMET:'known_but_unresolved'}}]};
 f.element('recipe-code').value=await encodeRecipe(recipe);
 await f.element('import-code').onclick();
 assert.equal(f.imports.length,0);
 assert.match(f.element('recipe-message').textContent,/unavailable/);
});

test('missing verified class model is rejected before roster import',async()=>{
 const f=fixture();f.catalog.manifest.assets=f.catalog.manifest.assets.slice(0,1);
 const recipe={schema:'iron-hands-forge',version:1,kind:'soldier',catalog:{game:'SM2',build:'fixture'},soldiers:[{...f.soldiers[1],selection:{HELMET:'helmet_1_common_01'}}]};
 f.element('recipe-code').value=await encodeRecipe(recipe);
 await f.element('import-code').onclick();
 assert.equal(f.imports.length,0);
 assert.match(f.element('recipe-message').textContent,/verified model.*not connected/);
});

test('opening share dialog regenerates current armour rather than reusing stale code',async()=>{const f=fixture();await f.element('share-build').onclick();const first=f.element('recipe-code').value;f.soldiers[0].paint.armor='#AABBCC';await f.element('share-build').onclick();assert.notEqual(f.element('recipe-code').value,first);assert.equal((await decodeRecipe(f.element('recipe-code').value)).soldiers[0].paint.armor,'#AABBCC')});
test('latest share action wins and manual paste is not overwritten by pending encoding',async()=>{const f=fixture(),a=f.element('code-roster').onclick(),b=f.element('code-soldier').onclick();await Promise.all([a,b]);assert.equal((await decodeRecipe(f.element('recipe-code').value)).kind,'soldier');const pending=f.element('share-build').onclick();f.element('recipe-code').value='manual-input';f.element('recipe-code').oninput();await pending;assert.equal(f.element('recipe-code').value,'manual-input')});
