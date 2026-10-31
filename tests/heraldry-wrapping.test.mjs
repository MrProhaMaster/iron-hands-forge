import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DECAL_SAMPLER} from '../shared/iron-hands-appearance.mjs';
// WebGL address behavior for a 2x2 transparent-border/opaque-ink fixture.
const alpha=[0,0,0,255];
function sample(u,v,sampler){
 const address=(coordinate,mode)=>mode===10497?coordinate-Math.floor(coordinate):Math.max(0,Math.min(1,coordinate));
 const x=Math.min(1,Math.floor(address(u,sampler.wrapS)*2)),y=Math.min(1,Math.floor(address(v,sampler.wrapT)*2));
 return alpha[y*2+x];
}
test('right pauldron native negative-V coordinates reach decal ink rather than a transparent clamped border',()=>{
 assert.equal(sample(.75,-.25,NATIVE_DECAL_SAMPLER),255);
 assert.equal(sample(.75,-.25,{...NATIVE_DECAL_SAMPLER,wrapT:33071}),0);
});
test('left pauldron native coordinates inside the primary tile keep their existing image sample',()=>{
 for(const [u,v]of[[.75,.75],[.25,.25],[.25,.75],[.75,.25]])assert.equal(sample(u,v,NATIVE_DECAL_SAMPLER),sample(u,v,{wrapS:33071,wrapT:33071}));
});
test('source UVs in neighboring horizontal and vertical tiles preserve the same periodic decal image',()=>{
 assert.equal(sample(-.25,-.25,NATIVE_DECAL_SAMPLER),255);
 assert.equal(sample(1.75,1.75,NATIVE_DECAL_SAMPLER),255);
 assert(Object.isFrozen(NATIVE_DECAL_SAMPLER));
});
