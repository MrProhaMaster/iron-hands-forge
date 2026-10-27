import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {graftBionicModel} from './bionic-graft.mjs';
const {loadBionicClass}=createRequire(import.meta.url)('./left-bionic.cjs');
const plans=new Map();
const statKey=file=>{const s=fs.statSync(file);return s.size+':'+s.mtimeMs};
function sourceFile(base,relative){
 base=path.resolve(base);const file=path.resolve(base,relative);
 const within=(root,value)=>value===root||value.startsWith(root+path.sep);
 if(!within(base,file)||relative.includes('\0'))throw Object.assign(Error('Forbidden path'),{status:403});
 const realBase=fs.realpathSync(base),real=fs.realpathSync(file);
 if(!within(realBase,real))throw Object.assign(Error('Forbidden link'),{status:403});
 return real;
}
function bodyHeader(file){
 const fd=fs.openSync(file,'r');
 try{
  const h=Buffer.alloc(20);if(fs.readSync(fd,h,0,20,0)!==20||h.readUInt32LE(0)!==0x46546c67||h.readUInt32LE(4)!==2||h.readUInt32LE(8)!==fs.statSync(file).size||h.readUInt32LE(16)!==0x4e4f534a)throw Error('Invalid original model GLB');
  const n=h.readUInt32LE(12);if(n<2||n>64*1024*1024)throw Error('Invalid original model JSON length');
  const j=Buffer.alloc(n),b=Buffer.alloc(8);
  if(fs.readSync(fd,j,0,n,20)!==n||fs.readSync(fd,b,0,8,20+n)!==8||b.readUInt32LE(4)!==0x004e4942||28+n+b.readUInt32LE(0)!==fs.statSync(file).size)throw Error('Truncated original model GLB');
  return{json:JSON.parse(j.toString('utf8').trim()),binLength:b.readUInt32LE(0),binOffset:28+n};
 }finally{fs.closeSync(fd)}
}
export function bionicResourcePlan(dataRoot,asset,extension){
 if(!/^cc_sm_constructor_[a-z0-9_]+$/.test(asset)||!['glb','json'].includes(extension))throw Error('Invalid augmented model request');
 const addon=loadBionicClass({dataRoot,asset});if(!addon)return null;
 const sourceRoot=path.join(dataRoot,'assets/characters/SM2-retail-constructors/source-v5');
 const file=sourceFile(sourceRoot,asset+'.glb'),metadataFile=sourceFile(sourceRoot,asset+'.json');
 const key=path.resolve(file)+'|'+statKey(file)+'|'+statKey(metadataFile)+'|'+addon.optionRecord.revision;
 let plan=plans.get(key);
 if(!plan){
  const original=bodyHeader(file),graft=graftBionicModel(original.json,original.binLength,addon.addonDoc,addon.addonBin,addon.optionRecord);
  let json=Buffer.from(JSON.stringify(graft.json));json=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]);
  const append=graft.appendBinary,padding=Buffer.alloc((-(original.binLength+append.length))&3),binLength=original.binLength+append.length+padding.length;
  const header=Buffer.alloc(20),binHeader=Buffer.alloc(8),length=28+json.length+binLength;
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  binHeader.writeUInt32LE(binLength,0);binHeader.writeUInt32LE(0x004e4942,4);
  plan={glb:{length,type:'model/gltf-binary',segments:[header,json,binHeader,{file,offset:original.binOffset,length:original.binLength},append,padding]},graft,metadataFile};
  if(plans.size>=16)plans.clear();plans.set(key,plan);
 }
 if(extension==='glb')return plan.glb;
 if(!plan.metadata){
  const metadata=JSON.parse(fs.readFileSync(plan.metadataFile,'utf8').replace(/^\uFEFF/,''));
  metadata.meshes.push(...plan.graft.meshRecords);metadata.objectMetadata=[...(metadata.objectMetadata||[]),plan.graft.objectRecord];
  metadata.forgeLeftBionic={version:1,classId:addon.optionRecord.classId,objectId:addon.optionRecord.objectId};
  const bytes=Buffer.from(JSON.stringify(metadata));plan.metadata={length:bytes.length,type:'application/json; charset=utf-8',segments:[bytes]};
 }
 return plan.metadata;
}
export function serveBionicPlan(req,res,plan){
 let start=0,end=plan.length-1,status=200;
 if(req.headers.range){
  const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
  if(match){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end}
  if(!match||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=plan.length){res.writeHead(416,{'Content-Range':'bytes */'+plan.length,'Content-Length':0});res.end();return}
  status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${plan.length}`);
 }
 res.writeHead(status,{'Content-Type':plan.type,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});
 if(req.method==='HEAD')return res.end();
 async function* chunks(){
  let offset=0;
  for(const segment of plan.segments){
   const length=Buffer.isBuffer(segment)?segment.length:segment.length;
   const from=Math.max(start-offset,0),to=Math.min(end-offset,length-1);offset+=length;
   if(from>to||length===0)continue;
   if(Buffer.isBuffer(segment))yield segment.subarray(from,to+1);
   else for await(const chunk of fs.createReadStream(segment.file,{start:segment.offset+from,end:segment.offset+to}))yield chunk;
  }
 }
 const stream=Readable.from(chunks());stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
