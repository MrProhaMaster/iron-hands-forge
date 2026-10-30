import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {normalizeRecipe,encodeRecipe,decodeRecipe,RecipeCodecError} from '../shared/recipe-codec.mjs';
import {normalizeAppearance,validateAppearance,resolveAppearance,classifyMaterialRole,AppearanceError} from '../shared/appearance.mjs';
const fixture=JSON.parse(readFileSync(new URL('./recipe-codec-golden.json',import.meta.url),'utf8'));
const sample=()=>structuredClone(fixture.recipe);
const raw=code=>inflateSync(Buffer.from(code.split('.')[1],'base64url'));
const root=fileURLToPath(new URL('../tools/',import.meta.url));
const worker=String.raw`import sys,json
sys.dont_write_bytecode=True
sys.path.insert(0,sys.argv[1])
from recipe_codec import *
request=json.load(sys.stdin)
try:
 op=request['op'];v=request['value']
 if op=='encodeFloat':v['soldiers'][0]['appearance']['finish']['roughness']=float(v['soldiers'][0]['appearance']['finish']['roughness'])
 fn={'encode':encode_recipe,'encodeFloat':encode_recipe,'decode':decode_recipe,'normalize':normalize_recipe,'appearance':normalize_appearance,'resolve':lambda x:resolve_appearance(*x),'classify':lambda x:classify_material_role(*x)}[op]
 print(json.dumps({'ok':True,'result':fn(v)},ensure_ascii=True))
except Exception as e:print(json.dumps({'ok':False,'code':getattr(e,'code','ERROR'),'error':str(e)}))
`;
function py(op,value){
 const r=spawnSync(process.env.FORGE_PYTHON||'python',['-c',worker,root],{input:JSON.stringify({op,value}),encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
const appearance=()=>({colors:{trim:'#aabbcc',cloth:'#123456',beard:'#654321',skin:'#bca987'},finish:{metallic:false,roughness:.61},parts:{LEFT_SHOULDER:{armor:'#20242a',trim:'#fafafa',cloth:'#493821',metallic:true,roughness:.28}},decals:{LEFT_SHOULDER:{id:'ih.clan.avernii',color:'#eeeeee',secondaryColor:'#aa0011',tertiaryColor:'#030405'}}});

test('legacy canonical IHF1 bytes/CRC remain unchanged, absent appearance stays absent',async()=>{
 const n=normalizeRecipe(sample());assert.equal(Object.hasOwn(n.soldiers[0],'appearance'),false);
 assert.deepEqual(raw(await encodeRecipe(n)),raw(fixture.code));
 assert.deepEqual(raw(py('encode',n).result),raw(fixture.code));
 assert.deepEqual(await decodeRecipe(fixture.code),fixture.recipe);
});
test('optional appearance normalizes fresh colors without filling omitted options',async()=>{
 const r=sample();r.soldiers[0].appearance=appearance();
 const n=normalizeRecipe(r);assert.equal(n.soldiers[0].appearance.colors.trim,'#AABBCC');assert.equal(n.soldiers[0].appearance.parts.LEFT_SHOULDER.armor,'#20242A');
 n.soldiers[0].appearance.colors.trim='#000000';assert.equal(r.soldiers[0].appearance.colors.trim,'#aabbcc');
 const empty=sample();empty.soldiers[0].appearance={};
 assert.deepEqual((await decodeRecipe(await encodeRecipe(empty))).soldiers[0].appearance,{});
 const decal=normalizeAppearance({decals:{LEFT_SHOULDER:{id:'iron-hand',color:'#ffffff'}}});
 assert.deepEqual(Object.keys(decal.decals.LEFT_SHOULDER),['id','color']);assert.equal(validateAppearance({}),true);
});
test('JS/Python appearance roundtrip, canonical byte identity and decimal spellings',async()=>{
 for(const roughness of [0,-0,1,.5,.61,.3333333333333333,1e-6,1e-7,1e-20,0.00010000000000000002,.9999999999999999]){
  const r=sample();r.soldiers[0].appearance=appearance();r.soldiers[0].appearance.finish.roughness=roughness;
  const normalized=normalizeRecipe(r),js=await encodeRecipe(r),python=py('encodeFloat',r);assert.equal(python.ok,true,python.error);
  assert.deepEqual(py('decode',js).result,normalized);
  assert.deepEqual(await decodeRecipe(python.result),normalized);
  assert.deepEqual(raw(js),raw(python.result),'canonical mismatch at'+roughness);
 }
});
test('appearance rejects unknown fields and wrong scalar types in both runtimes',()=>{
 const bad=[null,[],true,{other:1},{colors:{armor:'#ffffff'}},{colors:{trim:'#fff'}},{finish:{metallic:1}},{finish:{roughness:true}},{finish:{roughness:'0.4'}},{finish:{roughness:-.001}},{finish:{roughness:1.001}},{finish:{alien:1}},
 {parts:{LEFT_ARM:{color:'#112233'}}},{parts:{LEFT_ARM:{armor:null}}},{parts:{LEFT_ARM:{metallic:0}}},{decals:{LEFT_SHOULDER:{id:'a'}}},{decals:{LEFT_SHOULDER:{id:'',color:'#000000'}}},{decals:{LEFT_SHOULDER:{id:'a',color:'White_Scar'}}},{decals:{LEFT_SHOULDER:{id:'a',color:'#11223344'}}},{decals:{LEFT_SHOULDER:{id:'a',color:'#112233',opacity:.2}}}];
 for(const value of bad){
  assert.throws(()=>normalizeAppearance(value),AppearanceError,JSON.stringify(value));
  assert.equal(py('appearance',value).ok,false,JSON.stringify(value));
  const r=sample();r.soldiers[0].appearance=value;assert.throws(()=>normalizeRecipe(r),RecipeCodecError);
 }
 for(const roughness of [NaN,Infinity,-Infinity])assert.throws(()=>normalizeAppearance({finish:{roughness}}),AppearanceError);
});
test('appearance object/prototype/accessor/forbidden keys are rejected without invoking getters',()=>{
 for(const key of ['__proto__','prototype','constructor']){
  for(const value of [JSON.parse('{"'+key+'":{}}'),{parts:JSON.parse('{"'+key+'":{}}')},{decals:JSON.parse('{"'+key+'":{"id":"x","color":"#000000"}}')}]){
   assert.throws(()=>normalizeAppearance(value),AppearanceError);assert.equal(py('appearance',value).ok,false);
  }
 }
 let calls=0;
 for(const value of [Object.create({}),{colors:Object.create({})},{finish:Object.create({})},{parts:{S:Object.create({})}},{decals:{S:Object.create({})}}])assert.throws(()=>normalizeAppearance(value),AppearanceError);
 for(const path of ['colors','finish','parts','decals']){
  const a={};Object.defineProperty(a,path,{enumerable:true,get(){calls++;return {}}});assert.throws(()=>normalizeAppearance(a),AppearanceError);
 }
 const nested={parts:{}};Object.defineProperty(nested.parts,'S',{enumerable:true,get(){calls++;return {}}});assert.throws(()=>normalizeAppearance(nested),AppearanceError);
 assert.equal(calls,0);assert.equal({}.polluted,undefined);
 assert.throws(()=>normalizeAppearance({[Symbol('x')]:1}),AppearanceError);
});
test('bounded slots/maps and Unicode lengths agree in JS/Python',()=>{
 const good={parts:Object.fromEntries(Array.from({length:48},(_,i)=>['slot'+i,{}])),decals:Object.fromEntries(Array.from({length:16},(_,i)=>['slot'+i,{id:'decal'+i,color:'#123456'}]))};
 assert.deepEqual(py('appearance',good).result,normalizeAppearance(good));
 for(const v of [{parts:{...good.parts,overflow:{}}},{decals:{...good.decals,overflow:{id:'x',color:'#000000'}}},{parts:{['😀'.repeat(161)]:{}}},{parts:{'':{}}},{decals:{S:{id:'😀'.repeat(161),color:'#000000'}}}]){
  assert.throws(()=>normalizeAppearance(v),AppearanceError);assert.equal(py('appearance',v).ok,false);
 }
 assert.equal(Object.keys(normalizeAppearance({parts:{['😀'.repeat(160)]:{}}}).parts).length,1);
 assert.throws(()=>normalizeAppearance({parts:{['\ud800']:{}}}),AppearanceError);
});
test('appearance material role precedence and legacy defaults match Python',()=>{
 const s=sample().soldiers[0];
 const cases=[['armor','.48'],['trim','.34'],['metal','.34'],['lenses','.2'],['cloth','.85'],['beard','.85'],['skin','.7'],['leather','.7'],['rubber','.78'],['glass','.12']];
 for(const [role,roughness]of cases){const out=resolveAppearance(s,'LEFT_SHOULDER',role);assert.equal(out.roughness,Number(roughness));assert.deepEqual(py('resolve',[s,'LEFT_SHOULDER',role]).result,out);}
 s.appearance=normalizeAppearance(appearance());
 assert.deepEqual(resolveAppearance(s,'LEFT_SHOULDER','armor'),{color:'#20242A',metallic:1,roughness:.28,opacity:1});
 assert.equal(resolveAppearance(s,'RIGHT_SHOULDER','armor').metallic,0);
 assert.equal(resolveAppearance(s,'LEFT_SHOULDER','trim').color,'#FAFAFA');
 assert.equal(resolveAppearance(s,'LEFT_SHOULDER','metal').color,s.paint.metal,'bionics remain independent of global and part trim');
 assert.equal(resolveAppearance(s,'RIGHT_SHOULDER','trim').color,'#AABBCC');
 assert.equal(resolveAppearance(s,'RIGHT_SHOULDER','metal').metallic,.85,'global armour finish must not demetallize raw bionics');
 assert.equal(resolveAppearance(s,'RIGHT_SHOULDER','metal').roughness,.34);
 assert.equal(resolveAppearance(s,'RIGHT_SHOULDER','trim').metallic,.85,'global armour finish must not demetallize trim');
 assert.equal(resolveAppearance(s,'LEFT_SHOULDER','metal').metallic,1,'explicit local metallic override remains supported');
 assert.equal(resolveAppearance(s,'RIGHT_SHOULDER','cloth').color,'#123456');
 assert.equal(resolveAppearance(s,'LEFT_SHOULDER','cloth').color,'#493821');
 assert.equal(resolveAppearance(s,'LEFT_SHOULDER','cloth').metallic,0);
 assert.equal(resolveAppearance(s,'LEFT_SHOULDER','lenses').emissive,s.paint.lenses);
 for(const [role]of cases)assert.deepEqual(py('resolve',[s,'LEFT_SHOULDER',role]).result,resolveAppearance(s,'LEFT_SHOULDER',role));
});
test('shared material classifier preserves special-case priority and separates beards/trim',()=>{
 for(const [name,mesh,role]of [
 ['undersuit','','rubber'],['iron_beard_hair','','beard'],['cape_cloth','','cloth'],['belt_leather','','leather'],
 ['optic_lenses','','lenses'],['glass','','glass'],['','forge_left_bionic_01','metal'],['head_skin','','skin'],
 ['skin','helmet','armor'],['ornament_silver','','trim'],['armor','','armor'],['optic_lenses','gold_trim','lenses'],['preview_armor','soldier_torso_decorated_gold','armor'],['preview_base','gold_trim','armor']
 ]){
  assert.equal(classifyMaterialRole(name,mesh),role);
  assert.equal(py('classify',[name,mesh]).result,role);
 }
});
