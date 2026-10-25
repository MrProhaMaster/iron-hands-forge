import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {deflateSync,deflateRawSync,gzipSync,inflateSync,constants} from 'node:zlib';
import {createHash} from 'node:crypto';
import {normalizeRecipe,encodeRecipe,decodeRecipe,RecipeCodecError,MAX_RAW_BYTES,MAX_CODE_LENGTH} from '../shared/recipe-codec.mjs';

const fixture=JSON.parse(readFileSync(new URL('./recipe-codec-golden.json',import.meta.url),'utf8'));
const sample=()=>structuredClone(fixture.recipe);
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return ((c^0xffffffff)>>>0).toString(16).padStart(8,'0');}
const wrap=(raw,compressed=deflateSync(raw))=>`IHF1.${compressed.toString('base64url')}.${crc(raw)}`;
const rawCode=code=>inflateSync(Buffer.from(code.split('.')[1],'base64url'));
function py(op,value){
  const run=spawnSync(process.env.FORGE_PYTHON||'python',[fileURLToPath(new URL('./recipe_codec_test.py',import.meta.url)),'--worker'],{input:JSON.stringify({op,value}),encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
}
const rejects=async(code,expected)=>assert.rejects(decodeRecipe(code),error=>error instanceof RecipeCodecError&&(!expected||error.code===expected));

test('golden fixture, checksum, deterministic local encoding',async()=>{
  assert.deepEqual(await decodeRecipe(fixture.code),fixture.recipe);
  const code=await encodeRecipe(sample());assert.deepEqual(await decodeRecipe(code),fixture.recipe);
  assert.equal(code,await encodeRecipe(sample()));assert.equal(crc(rawCode(code)),code.split('.')[2]);
});
test('JavaScript → Python and Python → JavaScript',async()=>{
  const r=sample();r.soldiers[0].paint.armor='#aabbcc';
  assert.deepEqual(py('decode',await encodeRecipe(r)).result,normalizeRecipe(r));
  const code=py('encode',r);assert.equal(code.ok,true);assert.deepEqual(await decodeRecipe(code.result),normalizeRecipe(r));
});
test('canonical UTF8 agrees for numeric and astral/BMP keys',async()=>{
  const r=sample();r.catalog.build='Медуза😀';r.soldiers[0].selection={'2':'два','10':'десять','😀':'astral','\ue000':'BMP'};
  const js=await encodeRecipe(r),python=py('encode',r);assert.equal(python.ok,true);
  assert.deepEqual(rawCode(js),rawCode(python.result));assert.equal(js.split('.')[2],python.result.split('.')[2]);
  const raw=rawCode(js).toString('utf8');assert.ok(raw.indexOf('"10"')<raw.indexOf('"2"'));assert.ok(raw.indexOf('"\ue000"')<raw.indexOf('"😀"'));
});
test('stored, fixed, dynamic and alternate valid zlib streams',async()=>{
  const raw=rawCode(fixture.code);
  for(const options of [{level:0},{level:1},{level:9},{strategy:constants.Z_FIXED},{strategy:constants.Z_HUFFMAN_ONLY},{strategy:constants.Z_RLE}]){
    assert.deepEqual(await decodeRecipe(wrap(raw,deflateSync(raw,options))),fixture.recipe);
  }
});
test('optional motion/signature, roster bounds, color normalization and fresh data',async()=>{
  const r=sample();delete r.catalog.signature;delete r.soldiers[0].motion;r.soldiers[0].paint.metal='#abcdef';
  const n=normalizeRecipe(r);assert.equal(n.soldiers[0].paint.metal,'#ABCDEF');n.soldiers[0].selection.helmet='changed';assert.notEqual(r.soldiers[0].selection.helmet,'changed');
  r.kind='roster';r.soldiers=Array.from({length:20},(_,i)=>({...structuredClone(r.soldiers[0]),id:`IH-${i}`}));
  assert.equal((await decodeRecipe(await encodeRecipe(r))).soldiers.length,20);
  r.soldiers.push({...r.soldiers[0],id:'twenty-first'});assert.throws(()=>normalizeRecipe(r),RecipeCodecError);
});
test('strict keys at every fixed object and selection prototype keys',()=>{
  const mutators=[r=>r.extra=1,r=>r.catalog.extra=1,r=>r.soldiers[0].objectId=4240,r=>r.soldiers[0].paint.extra=1,r=>r.soldiers[0].motion.extra=1];
  for(const fn of mutators){const r=sample();fn(r);assert.throws(()=>normalizeRecipe(r),RecipeCodecError);}
  for(const key of ['__proto__','constructor','prototype']){const r=sample();r.soldiers[0].selection=JSON.parse(`{"${key}":"bad"}`);assert.throws(()=>normalizeRecipe(r),RecipeCodecError);}
  assert.equal({}.polluted,undefined);
});
test('invalid counts, numbers, identifiers, prototypes and accessor arrays',()=>{
  for(const speed of [49,201,NaN,Infinity,100.5,true,'100']){const r=sample();r.soldiers[0].motion.speedPct=speed;assert.throws(()=>normalizeRecipe(r),RecipeCodecError);}
  for(const speed of [50,150,200]){const r=sample();r.soldiers[0].motion.speedPct=speed;assert.equal(normalizeRecipe(r).soldiers[0].motion.speedPct,speed);}
  for(const id of ['', '😀'.repeat(161),'\ud800']){const r=sample();r.soldiers[0].id=id;assert.throws(()=>normalizeRecipe(r),RecipeCodecError);}
  const good=sample();good.soldiers[0].id='😀'.repeat(160);assert.equal(Array.from(normalizeRecipe(good).soldiers[0].id).length,160);
  const r=sample();Object.defineProperty(r.soldiers,'0',{get(){throw new Error('Getter must not execute');},enumerable:true});assert.throws(()=>normalizeRecipe(r),RecipeCodecError);
  const custom=Object.create({});Object.assign(custom,sample());assert.throws(()=>normalizeRecipe(custom),RecipeCodecError);
});
test('CRC and canonical base64url/framing corruption',async()=>{
  const code=fixture.code;await rejects(code.slice(0,-1)+(code.at(-1)==='0'?'1':'0'),'CHECKSUM_MISMATCH');
  for(const bad of ['IHF1.Zh.00000000','IHF1.Zg==.00000000','IHF1.a.00000000',code+'\n',' '+code,code.toUpperCase()])await rejects(bad);
});
test('trailing bytes, concatenated streams, Adler corruption, raw/gzip and truncation',async()=>{
  const raw=rawCode(fixture.code),compressed=deflateSync(raw);
  for(const bytes of [Buffer.concat([compressed,Buffer.from('tail')]),Buffer.concat([compressed,compressed]),compressed.subarray(0,-1),deflateRawSync(raw),gzipSync(raw)])await rejects(wrap(raw,bytes),'INVALID_COMPRESSION');
  const corrupt=Buffer.from(compressed);corrupt[corrupt.length-1]^=1;await rejects(wrap(raw,corrupt),'INVALID_COMPRESSION');
});
test('invalid schemas and noncanonical duplicate/whitespace/UTF8 JSON',async()=>{
  const raw=rawCode(fixture.code),text=raw.toString('utf8');
  for(const bytes of [Buffer.from(' '+text),Buffer.from(text.replace('"version":1','"version":1,"version":1')),Buffer.from(text.replace('"version":1','"version":1.0')),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),raw])])await rejects(wrap(bytes));
  const r=sample();r.catalog.game='OTHER';await rejects(wrap(Buffer.from(JSON.stringify(r))),'INVALID_SCHEMA');
  const proto=text.replace('"selection":{','"selection":{"__proto__":"x",');await rejects(wrap(Buffer.from(proto)),'INVALID_SCHEMA');
});
test('decompression bomb and both transport/input limits',async()=>{
  await rejects(wrap(Buffer.alloc(MAX_RAW_BYTES+1,65)),'LIMIT_EXCEEDED');await rejects('A'.repeat(MAX_CODE_LENGTH+1),'LIMIT_EXCEEDED');
  const r=sample();r.soldiers[0].selection=Object.fromEntries(Array.from({length:900},(_,i)=>[`slot${i}`,'A'.repeat(160)]));await assert.rejects(encodeRecipe(r),error=>error.code==='LIMIT_EXCEEDED');
  const random=sample();random.soldiers[0].selection=Object.fromEntries(Array.from({length:700},(_,i)=>[`slot${i}`,Array.from({length:3},(_,j)=>createHash('sha256').update(`${i}:${j}`).digest('hex')).join('').slice(0,160)]));
  await assert.rejects(encodeRecipe(random),error=>error.code==='LIMIT_EXCEEDED');
});
