import test from 'node:test';import assert from 'node:assert/strict';
import {filterServoMotionChannels} from '../shared/servo-motion-policy.mjs';
test('legacy body clip remains the same array when no servo startup pose was applied',()=>{
 const channels=[{name:'hand_01_jnt'},{name:'tube_04_jnt'},{name:'HEAD'}];assert.equal(filterServoMotionChannels(channels,false),channels);
});
test('native servo startup pose keeps helper and variant tube channels out of a body gait',()=>{
 const names=['HEAD','HANDR','FOOT1L','hand_jnt','hand_01_jnt','gun_02_jnt','tube_jnt','tube_04_jnt','techtube_02_jnt_jiggle'];
 const channels=names.map(name=>({name,positions:[[1,2,3]]})),before=structuredClone(channels),got=filterServoMotionChannels(channels,true);
 assert.deepEqual(got.map(c=>c.name),['HEAD','HANDR','FOOT1L']);assert.deepEqual(channels,before);assert.equal(got[0],channels[0]);
});
