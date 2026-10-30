import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePNG,encodePNG,composeDecalRGBA} from '../shared/iron-hands-appearance.mjs';
const image=(rgba,width=1)=>({width,height:rgba.length/4/width,rgba:Buffer.from(rgba)});
const white=[255,255,255,255],clear=[255,255,255,0];
test('PNG encoding preserves exact native-size RGBA including partial alpha',()=>{
 const before=image([0,1,255,0,255,20,13,255,85,192,30,127,255,255,255,254],2);
 const encoded=encodePNG(before),after=decodePNG(encoded);assert.equal(after.width,2);assert.equal(after.height,2);assert.deepEqual(after.rgba,before.rgba);
 const damaged=Buffer.from(encoded);damaged[damaged.length-1]^=1;assert.throws(()=>decodePNG(damaged),/CRC/);
 assert.throws(()=>decodePNG(encoded.subarray(0,encoded.length-1)),/Incomplete|Truncated/);
});
test('RGB-mask recoloring mixes linear light rather than sRGB bytes',()=>{
 const result=composeDecalRGBA(image([0,0,0,255]),image([128,0,0,255]),[white,white,white]);
 for(const x of result.rgba.subarray(0,3))assert.ok(x>=187&&x<=189);
 assert.equal(result.rgba[3],255,'partial mask coverage must not leave translucent gray decal background');
});
test('transparent native palette regions use normalized mask weights multiplied by base alpha',()=>{
 const base=image([60,60,60,128,60,60,60,128,60,60,60,128,60,60,60,128]);
 const mask=image([255,0,0,255,0,255,0,255,128,128,0,255,0,0,0,255]);
 const result=composeDecalRGBA(base,mask,[clear,white,white]);
 assert.deepEqual([...result.rgba].filter((_,i)=>i%4===3),[0,128,64,0]);
 assert.equal(result.diagnostics.transparentPixels,2);assert.equal(result.diagnostics.visiblePixels,2);
});
test('R G B regions retain independent palette colors and exact source dimensions',()=>{
 const base=image([40,40,40,255,40,40,40,255,40,40,40,255]);
 const mask=image([255,0,0,255,0,255,0,255,0,0,255,255]);
 const result=composeDecalRGBA(base,mask,[[255,0,0,255],[0,255,0,255],[0,0,255,255]]);
 assert.deepEqual([...result.rgba],[255,0,0,255,0,255,0,255,0,0,255,255]);assert.equal(result.width,1);assert.equal(result.height,3);
 assert.throws(()=>composeDecalRGBA(base,image([1,2,3,4]),[white,white,white]),/dimensions differ/);
});
test('PNG decoder rejects oversized metadata before inflate allocation',()=>{
 assert.throws(()=>encodePNG({width:99999,height:99999,rgba:Buffer.alloc(4)}),/Invalid rendered/);
});
