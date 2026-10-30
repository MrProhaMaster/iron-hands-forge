import test from 'node:test';
import assert from 'node:assert/strict';
import {SERVO_CHANNELS,applyServoPose,validateServoProfile,loadServoPose} from '../shared/servo-arm.mjs';
const selection={slot:'VANITY_3',option:{id:'vanity_engineer_prestige'}};
function fixture(){
 const profile={schema:'iron-hands-forge-servo-startup-pose',version:1,policy:'native-startup-pose-original-bind',source:{clip:'tacticus_wpn0_idle_mech_arm_intercessor',sha256:'a'.repeat(64),fps:30,frameIndex:0,retimed:false},compatibility:{sourceClassId:'PVE_PVP_ENGINEER',slotId:'VANITY_3',optionIds:['vanity_engineer_prestige']},channels:SERVO_CHANNELS.map((name,i)=>({name,translation:[0,0,0],rotation:i===0?[0,0,Math.SQRT1_2,Math.SQRT1_2]:[0,0,0,1]}))};
 const doc={asset:{version:'2.0'},nodes:[...SERVO_CHANNELS.map(name=>({name,translation:[0,0,0]})),{name:'tube_01_jnt',translation:[.1236,0,0]},{name:'HEAD',translation:[0,2,0]}],skins:[{joints:[0,1,2],inverseBindMatrices:0}],accessors:[{bufferView:0,type:'MAT4',count:3,componentType:5126}],bufferViews:[{buffer:0,byteOffset:0,byteLength:192}],buffers:[{byteLength:192}]};
 return{doc,library:{ready:true,revision:'fixture',profile}};
}
test('startup pose preserves IBM, tube lengths and all body nodes',()=>{
 const {doc,library}=fixture(),before=structuredClone(doc);
 const result=applyServoPose(doc,library,{parts:[selection],targetClassId:'PVE_PVP_ENGINEER'});
 assert.equal(result.applied,true);assert.equal(result.bones.length,29);
 assert.deepEqual(doc,before,'source doc must not mutate');
 for(const key of ['skins','accessors','bufferViews','buffers'])assert.deepEqual(result.json[key],before[key],key+' must not be rebound');
 assert.deepEqual(result.json.nodes[29],before.nodes[29]);assert.deepEqual(result.json.nodes[30],before.nodes[30]);
 assert.deepEqual(result.json.nodes[0].rotation,library.profile.channels[0].rotation);
});
test('unverified servo variants stay unchanged with an explicit diagnostic',()=>{
 const {doc,library}=fixture(),result=applyServoPose(doc,library,{parts:[{slot:'VANITY_3',option:{id:'vanity_engineer_common_01'}}],targetClassId:'PVE_PVP_ENGINEER'});
 assert.equal(result.applied,false);assert.equal(result.reason,'unverified_servo_variant');assert.equal(result.json,doc);
});
test('incompatible helper bind translations cannot be silently overwritten',()=>{
 const {doc,library}=fixture();doc.nodes[0].translation=[1,0,0];
 const result=applyServoPose(doc,library,{parts:[selection],targetClassId:'PVE_PVP_ENGINEER'});
 assert.equal(result.applied,false);assert.equal(result.reason,'servo_rig_bind_translation_mismatch');assert.equal(result.json,doc);
});
test('foreign Engineer prestige helpers use the same verified pose on a target body rig',()=>{
 const {doc,library}=fixture();
 for(const node of doc.nodes.slice(0,29)){const sourceBoneName=node.name;node.name='Forge helper / '+sourceBoneName;node.extras={sourceClassId:'PVE_PVP_ENGINEER',sourceBoneName}}
 const result=applyServoPose(doc,library,{parts:[{slot:'VANITY_3',option:{id:'forge:PVE_PVP_ENGINEER:vanity_engineer_prestige',forgeCrossClass:{classId:'PVE_PVP_ENGINEER',optionId:'vanity_engineer_prestige'}}}],targetClassId:'PVE_PVP_SOLDIER'});
 assert.equal(result.applied,true);assert.equal(result.nodeIndices.length,29);
});
test('missing legacy profile leaves old resource libraries usable',()=>{
 const library=loadServoPose(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
 assert.equal(library.ready,false);
 const {doc}=fixture();assert.equal(applyServoPose(doc,library,{parts:[selection]}).reason,'legacy_data_no_servo_profile');
});
test('profile rejects foreign channels or nonunit rotations',()=>{
 const {library}=fixture();library.profile.channels[0].rotation=[0,0,0,2];assert.throws(()=>validateServoProfile(library.profile),/TRS/);
});
