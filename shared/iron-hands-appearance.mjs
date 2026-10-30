/** Native Iron Hands decal PNG preparation for portable GLB/Blender exports.
 * Uses only Node built-ins. No game path, Pillow, canvas, SDK or network required.
 */
import fs from 'node:fs';
import {inflateSync,deflateSync} from 'node:zlib';
import {createRequire} from 'node:module';
const {resourcePath,resolveIronHandsDecal}=createRequire(import.meta.url)('./iron-hands-library.cjs');
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const TABLE=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;TABLE[n]=c>>>0}
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=TABLE[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function chunk(type,data){const t=Buffer.from(type),h=Buffer.alloc(8),crc=Buffer.alloc(4);h.writeUInt32BE(data.length);t.copy(h,4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([h,data,crc])}
function paeth(a,b,c){const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c}
export function decodePNG(bytes){
 if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
 if(bytes.length<33||!bytes.subarray(0,8).equals(SIGNATURE))throw Error('Invalid decal PNG signature');
 let at=8,header=null,palette=null,transparency=null,ended=false;const idat=[];
 while(at+12<=bytes.length){
  const length=bytes.readUInt32BE(at),end=at+12+length;
  if(end>bytes.length||length>128*1024*1024)throw Error('Truncated decal PNG chunk');
  const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+length);
  if(bytes.readUInt32BE(at+8+length)!==crc32(bytes.subarray(at+4,at+8+length)))throw Error('Decal PNG chunk CRC mismatch');
  if(!header&&type!=='IHDR')throw Error('Decal PNG header must be first');
  if(type==='IHDR'){
   if(header||length!==13)throw Error('Invalid decal PNG header');
   header={width:data.readUInt32BE(0),height:data.readUInt32BE(4),depth:data[8],type:data[9],compression:data[10],filter:data[11],interlace:data[12]};
  }else if(type==='PLTE')palette=data;
  else if(type==='tRNS')transparency=data;
  else if(type==='IDAT')idat.push(data);
  else if(type==='IEND'){if(length!==0)throw Error('Invalid decal PNG end');ended=true;at=end;break}
  at=end;
 }
 if(!ended||at!==bytes.length||!header||!idat.length)throw Error('Incomplete decal PNG');
 const {width,height,depth,type,compression,filter,interlace}=header;
 if(!width||!height||width>8192||height>8192||width*height>16777216||depth!==8||compression!==0||filter!==0||interlace!==0)throw Error('Unsupported decal PNG layout: expected non-interlaced native 8-bit PNG');
 const channels=({0:1,2:3,3:1,4:2,6:4})[type];
 if(!channels)throw Error('Unsupported decal PNG color type');
 if(type===3&&(!palette||palette.length%3||palette.length>768))throw Error('Invalid decal PNG palette');
 const stride=width*channels,expected=(stride+1)*height;
 const packed=inflateSync(Buffer.concat(idat),{maxOutputLength:expected});
 if(packed.length!==expected)throw Error('Decal PNG scanline size mismatch');
 const raw=Buffer.alloc(stride*height);
 for(let y=0;y<height;y++){
  const f=packed[y*(stride+1)],start=y*stride;
  if(f>4)throw Error('Invalid decal PNG row filter');
  for(let x=0;x<stride;x++){
   const a=x>=channels?raw[start+x-channels]:0,b=y?raw[start-stride+x]:0,c=y&&x>=channels?raw[start-stride+x-channels]:0;
   const predict=f===0?0:f===1?a:f===2?b:f===3?Math.floor((a+b)/2):paeth(a,b,c);
   raw[start+x]=(packed[y*(stride+1)+1+x]+predict)&255;
  }
 }
 const rgba=Buffer.alloc(width*height*4);
 for(let i=0;i<width*height;i++){
  const s=i*channels,d=i*4;
  if(type===6){rgba[d]=raw[s];rgba[d+1]=raw[s+1];rgba[d+2]=raw[s+2];rgba[d+3]=raw[s+3]}
  else if(type===2){rgba[d]=raw[s];rgba[d+1]=raw[s+1];rgba[d+2]=raw[s+2];rgba[d+3]=transparency&&transparency.length>=6&&raw[s]===transparency.readUInt16BE(0)&&raw[s+1]===transparency.readUInt16BE(2)&&raw[s+2]===transparency.readUInt16BE(4)?0:255}
  else if(type===0||type===4){rgba[d]=rgba[d+1]=rgba[d+2]=raw[s];rgba[d+3]=type===4?raw[s+1]:transparency&&transparency.length>=2&&raw[s]===transparency.readUInt16BE(0)?0:255}
  else {const index=raw[s];if(index*3+2>=palette.length)throw Error('Invalid decal PNG palette index');rgba[d]=palette[index*3];rgba[d+1]=palette[index*3+1];rgba[d+2]=palette[index*3+2];rgba[d+3]=transparency&&index<transparency.length?transparency[index]:255}
 }
 return{width,height,rgba};
}
export function encodePNG({width,height,rgba}){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>16777216||rgba.length!==width*height*4)throw Error('Invalid rendered decal pixels');
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const scan=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++){scan[y*(width*4+1)]=0;Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(scan,y*(width*4+1)+1)}
 return Buffer.concat([SIGNATURE,chunk('IHDR',header),chunk('IDAT',deflateSync(scan,{level:6})),chunk('IEND',Buffer.alloc(0))]);
}
const LINEAR=new Float64Array(256);
for(let i=0;i<256;i++){const x=i/255;LINEAR[i]=x<=.04045?x/12.92:((x+.055)/1.055)**2.4}
function srgb(x){x=Math.min(1,Math.max(0,x));return Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055))}
function colorRGBA(value,library){
 if(typeof value!=='string')throw Error('Decal color must be #RRGGBB or a native palette ID');
 if(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)){const c=[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));c.push(value.length===9?parseInt(value.slice(7,9),16):255);return c}
 const match=library.colors?.find(x=>x.id===value),c=match?.rgba;
 if(!c||!['r','g','b','a'].every(k=>Number.isInteger(c[k])&&c[k]>=0&&c[k]<=255))throw Error('Unknown or incomplete native decal palette color: '+value);
 return[c.r,c.g,c.b,c.a];
}
/** Authored Blender adapter math: sequential linear RGB masks and normalized alpha. */
export function composeDecalRGBA(base,mask,colors){
 if(base.width!==mask.width||base.height!==mask.height||base.rgba.length!==mask.rgba.length)throw Error('Native decal base and color-mask dimensions differ');
 const result=Buffer.alloc(base.rgba.length),linear=colors.map(c=>[LINEAR[c[0]],LINEAR[c[1]],LINEAR[c[2]],c[3]/255]);
 let visiblePixels=0,transparentPixels=0,changedColorPixels=0;
 for(let i=0;i<result.length;i+=4){
  const r=mask.rgba[i]/255,g=mask.rgba[i+1]/255,b=mask.rgba[i+2]/255,total=r+g+b;
  for(let channel=0;channel<3;channel++){
   let color=LINEAR[base.rgba[i+channel]];
   color=color*(1-r)+linear[0][channel]*r;color=color*(1-g)+linear[1][channel]*g;color=color*(1-b)+linear[2][channel]*b;
   result[i+channel]=srgb(color);
  }
  result[i+3]=Math.round(base.rgba[i+3]*(r*linear[0][3]+g*linear[1][3]+b*linear[2][3])/Math.max(total,1e-6));
  if(result[i+3]>0)visiblePixels++;else transparentPixels++;
  if(result[i]!==base.rgba[i]||result[i+1]!==base.rgba[i+1]||result[i+2]!==base.rgba[i+2])changedColorPixels++;
 }
 return{width:base.width,height:base.height,rgba:result,diagnostics:{visiblePixels,transparentPixels,changedColorPixels}};
}
function renderPlacementTexture(dataRoot,library,request,placement){
 if(placement.clear)return{png:encodePNG({width:1,height:1,rgba:Buffer.alloc(4)}),width:1,height:1,mimeType:'image/png',diagnostics:{clear:true,nativeCarrierObjectIds:placement.carrierObjectIds}};
 const textures=placement.material.textures||{},baseRef=library.textures[textures.base],maskRef=library.textures[textures.colorMask];
 if(!baseRef||!maskRef)throw Error('Selected native decal requires a base image and RGB color mask');
 const base=decodePNG(fs.readFileSync(resourcePath(dataRoot,baseRef.path))),mask=decodePNG(fs.readFileSync(resourcePath(dataRoot,maskRef.path)));
 const primary=request.color??'#FFFFFF',chosen=[primary,request.secondaryColor??primary,request.tertiaryColor??primary];
 const colors=chosen.map(c=>colorRGBA(c,library)),result=composeDecalRGBA(base,mask,colors);
 const png=encodePNG(result);
 return{png,width:result.width,height:result.height,mimeType:'image/png',diagnostics:{...result.diagnostics,
  nativeDecalId:placement.decalId,sourceBase:baseRef.path,sourceMask:maskRef.path,nativeCarrierObjectIds:placement.carrierObjectIds,colors:chosen,
  colorMath:'Sequential RGB-mask mix in linear color; normalized mask-weighted alpha times native base alpha; source UVs and axes unchanged.',
  shaderParity:'Authored portable preview/export adapter; original Saber GLT shader equivalence is unverified.'}};
}

export function renderDecalTexture(dataRoot,library,request){return renderPlacementTexture(dataRoot,library,request,resolveIronHandsDecal(library,request));}
/** Reuse a verified selected mod carrier with the same native section material/UV0. */
export function renderSourceDecalTexture(dataRoot,library,request,{carrierObjectIds=[]}={}){
 if(!library?.ready)throw Error('Iron Hands cosmetic library is unavailable');
 if(!Array.isArray(carrierObjectIds)||!carrierObjectIds.length||carrierObjectIds.some(id=>!Number.isSafeInteger(id)||id<0))throw Error('No verified source decal carrier IDs');
 const clear=request.decalId===null||request.decalId===undefined||request.decalId==='';
 const decal=clear?null:library.decals.find(d=>d.id===request.decalId);
 if(!clear&&!decal)throw Error('Unknown Iron Hands decal: '+request.decalId);
 if(decal&&decal.section!==request.slot)throw Error('Decal belongs to '+decal.section+', not '+request.slot);
 const material=library.materials.find(m=>m.slot===request.slot&&m.materialKey===(decal?.material||'default'));
 if(!material)throw Error('Native Iron Hands decal material is unresolved');
 return renderPlacementTexture(dataRoot,library,request,{clear:clear||material.materialKey==='default',decalId:decal?.id||null,decal,material,carrierObjectIds});
}
