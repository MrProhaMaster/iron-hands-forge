/** Portable IHF1 recipe codec, browser + Node; no assets or dependencies.
 * normalizeRecipe(value) -> fresh validated recipe (uppercase paint colors).
 * await encodeRecipe(value) -> IHF1.<base64url(zlib-deflate canonical UTF8 JSON)>.<crc32>.
 * await decodeRecipe(code) -> validated recipe; rejects noncanonical JSON/framing.
 * Limits: complete ASCII code <=64 KiB; uncompressed canonical JSON <=128 KiB.
 * CRC32 detects accidental corruption; it is not authentication.
 * Canonical raw bytes/CRC are deterministic across runtimes. Native compressor
 * versions may produce different valid DEFLATE bytes for the same recipe.
 */
export const MAX_CODE_LENGTH = 64 * 1024;
export const MAX_RAW_BYTES = 128 * 1024;
export class RecipeCodecError extends Error {
  constructor(code, message) { super(message); this.name = 'RecipeCodecError'; this.code = code; }
}
const fail = (code, message) => { throw new RecipeCodecError(code, message); };
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const encoder = new TextEncoder();
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function object(value, required, optional, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_SCHEMA', `${path} must be a plain object`);
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== 'string' || forbidden.has(key) ||
        (!required.includes(key) && !optional.includes(key))) fail('INVALID_SCHEMA', `${path}: forbidden or unknown property`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !own(descriptor, 'value')) fail('INVALID_SCHEMA', `${path}: accessors/nonenumerable properties are unsupported`);
  }
  for (const key of required) if (!own(value, key)) fail('INVALID_SCHEMA', `${path}.${key} is required`);
  return value;
}
function id(value, path) {
  if (typeof value !== 'string' || value.length === 0) fail('INVALID_SCHEMA', `${path} must be a nonempty string`);
  let count = 0;
  for (let i = 0; i < value.length; i++, count++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('INVALID_SCHEMA', `${path}: unpaired surrogate`);
    } else if (c >= 0xdc00 && c <= 0xdfff) fail('INVALID_SCHEMA', `${path}: unpaired surrogate`);
  }
  if (count > 160) fail('INVALID_SCHEMA', `${path} exceeds160 Unicode code points`);
  return value;
}
function color(value, path) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail('INVALID_SCHEMA', `${path} must be #RRGGBB`);
  return value.toUpperCase();
}
function soldier(value, index) {
  const path = `soldiers[${index}]`;
  const v = object(value, ['id','role','classId','selection','paint'], ['motion'], path);
  const s = v.selection;
  if (!s || typeof s !== 'object' || Array.isArray(s) || ![Object.prototype, null].includes(Object.getPrototypeOf(s))) fail('INVALID_SCHEMA', `${path}.selection must be a plain object`);
  const selection = {};
  for (const key of Reflect.ownKeys(s)) {
    if (typeof key !== 'string' || forbidden.has(key)) fail('INVALID_SCHEMA', `${path}.selection: forbidden slot`);
    const descriptor = Object.getOwnPropertyDescriptor(s, key);
    if (!descriptor.enumerable || !own(descriptor, 'value')) fail('INVALID_SCHEMA', `${path}.selection: unsupported property`);
    id(key, `${path}.selection slot`); selection[key] = id(s[key], `${path}.selection.${key}`);
  }
  const p = object(v.paint, ['armor','metal','lenses'], [], `${path}.paint`);
  const result = {id:id(v.id,`${path}.id`), role:id(v.role,`${path}.role`), classId:id(v.classId,`${path}.classId`), selection,
    paint:{armor:color(p.armor,`${path}.paint.armor`),metal:color(p.metal,`${path}.paint.metal`),lenses:color(p.lenses,`${path}.paint.lenses`)}};
  if (own(v,'motion')) {
    const m = object(v.motion, ['gait','stance','speedPct','inPlace'], [], `${path}.motion`);
    if (!['walk','run'].includes(m.gait) || !['unarmed','armed'].includes(m.stance) ||
        !Number.isInteger(m.speedPct) || m.speedPct < 50 || m.speedPct > 200 || m.inPlace !== true) fail('INVALID_SCHEMA', `${path}.motion is invalid`);
    result.motion = {gait:m.gait,stance:m.stance,speedPct:m.speedPct,inPlace:true};
  }
  return result;
}
export function normalizeRecipe(value) {
  const v = object(value, ['schema','version','kind','catalog','soldiers'], [], 'recipe');
  if (v.schema !== 'iron-hands-forge' || v.version !== 1 || !['soldier','roster'].includes(v.kind)) fail('INVALID_SCHEMA', 'Unsupported schema, version or kind');
  const c = object(v.catalog, ['game','build'], ['signature'], 'catalog');
  if (c.game !== 'SM2') fail('INVALID_SCHEMA', 'catalog.game must be SM2');
  const catalog = {game:'SM2',build:id(c.build,'catalog.build')};
  if (own(c,'signature')) catalog.signature=id(c.signature,'catalog.signature');
  if (!Array.isArray(v.soldiers) || Object.getPrototypeOf(v.soldiers) !== Array.prototype ||
      v.soldiers.length < 1 || v.soldiers.length > (v.kind==='soldier'?1:20) ||
      Reflect.ownKeys(v.soldiers).length !== v.soldiers.length+1) fail('INVALID_SCHEMA', 'Invalid soldiers array/count');
  for(let i=0;i<v.soldiers.length;i++){const d=Object.getOwnPropertyDescriptor(v.soldiers,String(i));if(!d || !d.enumerable || !own(d,'value'))fail('INVALID_SCHEMA','Invalid soldiers array element');}
  const soldiers = v.soldiers.map(soldier);
  if (new Set(soldiers.map(s=>s.id)).size !== soldiers.length) fail('INVALID_SCHEMA', 'Soldier ids must be unique');
  return {schema:'iron-hands-forge',version:1,kind:v.kind,catalog,soldiers};
}
// Unicode code-point order agrees with Python sort_keys; integer-looking keys
// must be serialized explicitly because JSON.stringify reorders object indices.
function keyCompare(a,b) {
  const x=Array.from(a),y=Array.from(b);
  for(let i=0;i<Math.min(x.length,y.length);i++) { const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d; }
  return x.length-y.length;
}
function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort(keyCompare).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes) {let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return ((c^0xffffffff)>>>0).toString(16).padStart(8,'0');}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64encode(bytes) {
  let out='';for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);out+=alphabet[n>>>18]+alphabet[(n>>>12)&63];if(i+1<bytes.length)out+=alphabet[(n>>>6)&63];if(i+2<bytes.length)out+=alphabet[n&63];}return out;
}
function b64decode(text) {
  if(!text || !/^[A-Za-z0-9_-]+$/.test(text) || text.length%4===1)fail('MALFORMED_CODE','Invalid base64url');
  const out=new Uint8Array(Math.floor(text.length*6/8));let bits=0,acc=0,index=0;
  for(const c of text){acc=(acc<<6)|alphabet.indexOf(c);bits+=6;if(bits>=8){bits-=8;out[index++]=(acc>>>bits)&255;}}
  if(b64encode(out)!==text)fail('MALFORMED_CODE','Noncanonical base64url');return out;
}
async function readBounded(stream, limit) {
  const reader=stream.getReader(),chunks=[];let total=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();fail('LIMIT_EXCEEDED','Stream exceeds size limit');}chunks.push(value);}}
  finally {reader.releaseLock();}
  const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}

// Structural DEFLATE walk checks the exact zlib stream boundary and output size.
// Browser DecompressionStream does not expose consumed-input counts. We never
// inflate here: native DecompressionStream validates actual data and Adler32.
function zlibBoundary(bytes) {
  if(bytes.length<6 || (bytes[0]&15)!==8 || (bytes[0]>>>4)>7 || ((bytes[0]<<8)|bytes[1])%31 || (bytes[1]&32))fail('INVALID_COMPRESSION','Invalid/unsupported zlib header');
  const end=(bytes.length-4)*8;let pos=16,produced=0;
  const bits=n=>{if(pos+n>end)fail('INVALID_COMPRESSION','Truncated DEFLATE');let v=0;for(let i=0;i<n;i++,pos++)v|=((bytes[pos>>>3]>>>(pos&7))&1)<<i;return v;};
  const add=n=>{produced+=n;if(produced>MAX_RAW_BYTES)fail('LIMIT_EXCEEDED','Decompressed recipe exceeds128 KiB');};
  function tree(lengths) {
    const counts=Array(16).fill(0),next=Array(16).fill(0),maps=Array.from({length:16},()=>new Map());
    for(const n of lengths){if(n<0||n>15)fail('INVALID_COMPRESSION','Invalid Huffman length');counts[n]++;}
    let left=1,code=0;for(let n=1;n<=15;n++){left=left*2-counts[n];if(left<0)fail('INVALID_COMPRESSION','Oversubscribed Huffman tree');code=(code+(n===1?0:counts[n-1]))*2;next[n]=code;}
    lengths.forEach((n,s)=>{if(n)maps[n].set(next[n]++,s);});
    return ()=>{let code=0;for(let n=1;n<=15;n++){code=(code<<1)|bits(1);if(maps[n].has(code))return maps[n].get(code);}fail('INVALID_COMPRESSION','Invalid Huffman code');};
  }
  const lb=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const le=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const db=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const de=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  let final=0,fixedLit,fixedDist;
  do {
    final=bits(1);const type=bits(2);
    if(type===0){pos=(pos+7)&~7;const n=bits(16),inv=bits(16);if((n^65535)!==inv)fail('INVALID_COMPRESSION','Invalid stored block');if(pos+n*8>end)fail('INVALID_COMPRESSION','Truncated stored block');pos+=n*8;add(n);continue;}
    if(type===3)fail('INVALID_COMPRESSION','Reserved DEFLATE block');
    let lit,dist;
    if(type===1){fixedLit??=tree(Array.from({length:288},(_,i)=>i<144?8:i<256?9:i<280?7:8));fixedDist??=tree(Array(32).fill(5));lit=fixedLit;dist=fixedDist;}
    else {
      const nl=bits(5)+257,nd=bits(5)+1,nc=bits(4)+4;if(nl>286)fail('INVALID_COMPRESSION','Invalid HLIT');
      const order=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],cl=Array(19).fill(0);for(let i=0;i<nc;i++)cl[order[i]]=bits(3);
      const decode=tree(cl),lengths=[];
      while(lengths.length<nl+nd){const s=decode();if(s<16)lengths.push(s);else{let n,v=0;if(s===16){if(!lengths.length)fail('INVALID_COMPRESSION','Invalid repeat');n=bits(2)+3;v=lengths.at(-1);}else if(s===17)n=bits(3)+3;else if(s===18)n=bits(7)+11;else fail('INVALID_COMPRESSION','Invalid repeat symbol');if(lengths.length+n>nl+nd)fail('INVALID_COMPRESSION','Huffman repeat overflow');while(n--)lengths.push(v);}}
      if(!lengths[256])fail('INVALID_COMPRESSION','Missing end-of-block code');lit=tree(lengths.slice(0,nl));dist=tree(lengths.slice(nl));
    }
    for(;;){const s=lit();if(s<256){add(1);continue;}if(s===256)break;if(s>285)fail('INVALID_COMPRESSION','Reserved length code');const n=lb[s-257]+bits(le[s-257]),d=dist();if(d>29)fail('INVALID_COMPRESSION','Reserved distance code');const distance=db[d]+bits(de[d]);if(distance>produced || distance>(1<<((bytes[0]>>>4)+8)))fail('INVALID_COMPRESSION','Invalid back reference');add(n);}
  }while(!final);
  if(Math.ceil(pos/8)!==bytes.length-4)fail('INVALID_COMPRESSION','Trailing compressed bytes');
  return produced;
}
export async function encodeRecipe(value) {
  const recipe=normalizeRecipe(value),raw=encoder.encode(canonical(recipe));
  if(raw.length>MAX_RAW_BYTES)fail('LIMIT_EXCEEDED','Recipe exceeds128 KiB');
  let compressed;try{compressed=await readBounded(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate')),MAX_CODE_LENGTH);}catch(e){if(e instanceof RecipeCodecError)throw e;fail('INVALID_COMPRESSION','Compression unavailable/failed');}
  const code=`IHF1.${b64encode(compressed)}.${crc32(raw)}`;
  if(code.length>MAX_CODE_LENGTH)fail('LIMIT_EXCEEDED','Encoded recipe exceeds64 KiB');return code;
}
export async function decodeRecipe(code) {
  if(typeof code!=='string' || code.length>MAX_CODE_LENGTH)fail('LIMIT_EXCEEDED','Invalid code type or size');
  const match=/^IHF1\.([A-Za-z0-9_-]+)\.([0-9a-f]{8})$/.exec(code);if(!match)fail('MALFORMED_CODE','Invalid IHF1 framing');
  const compressed=b64decode(match[1]),expectedLength=zlibBoundary(compressed);let raw;
  try{raw=await readBounded(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')),MAX_RAW_BYTES);}catch(e){if(e instanceof RecipeCodecError)throw e;fail('INVALID_COMPRESSION','Invalid zlib stream');}
  if(raw.length!==expectedLength)fail('INVALID_COMPRESSION','DEFLATE size mismatch');
  if(crc32(raw)!==match[2])fail('CHECKSUM_MISMATCH','Recipe CRC32 mismatch');
  let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));}catch{fail('INVALID_SCHEMA','Recipe is not valid UTF8 JSON');}
  const recipe=normalizeRecipe(parsed),again=encoder.encode(canonical(recipe));
  if(raw.length!==again.length || raw.some((b,i)=>b!==again[i]))fail('NON_CANONICAL_JSON','Recipe JSON is not canonical');return recipe;
}
