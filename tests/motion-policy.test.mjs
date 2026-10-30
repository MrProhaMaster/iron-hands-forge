import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveMotionBinding,motionPreviewChannels,classHasPreviewMotion} from '../shared/motion-policy.mjs';

// Public binding configuration only. No decoded game animation or model is loaded.
const config=JSON.parse(fs.readFileSync(new URL('../shared/motion-bindings.json',import.meta.url),'utf8'));
const classes={PVE_PVP_SOLDIER:'soldier',PVE_PVP_SNIPER:'sniper',PVE_PVP_SUPPORT:'support',PVE_PVP_RAIDER:'raider',PVE_PVP_TANK:'tank',PVE_PVP_BERSERK:'berserk',PVE_PVP_ENGINEER:'engineer'};

test('all seven verified classes resolve four shared preview bindings',()=>{
 for(const [classId,asset]of Object.entries(classes)){
  assert.equal(classHasPreviewMotion(config,classId),true);
  for(const gait of ['walk','run'])for(const stance of ['unarmed','armed']){
   const binding=resolveMotionBinding(config,classId,gait,stance);
   assert.equal(binding.asset,'cc_sm_constructor_'+asset);
   assert.equal(binding.classId,classId);
   assert.equal(binding.gait,gait);assert.equal(binding.stance,stance);
   assert.equal(binding.bindingPolicy,'shared-preview-validated');
   assert.equal(binding.canonicalGameFacialController,false);
   assert.match(binding.output,/^SM2-(?:walk|run)\/.*\.animation\.json$/);
   assert.equal(binding.inheritedOnlyChannels.length,83);
  }
 }
});

test('unverified classes and prototype names cannot request movement',()=>{
 for(const classId of ['PVE_PVP_MEDIC','constructor','__proto__','missing']){
  assert.equal(classHasPreviewMotion(config,classId),false);
  assert.throws(()=>resolveMotionBinding(config,classId,'walk','unarmed'),/not verified/);
 }
 const pending=structuredClone(config);pending.classes.PVE_PVP_RAIDER.status='pending';
 assert.equal(classHasPreviewMotion(pending,'PVE_PVP_RAIDER'),false);
});

test('binding resolution rejects unsafe output paths',()=>{
 for(const output of ['../secret','SM2-walk/../secret','/absolute','C:/secret','folder\\secret','http://example.invalid/file','', 'folder\0file']){
  const broken=structuredClone(config),id=broken.classes.PVE_PVP_SOLDIER.clipIds.walk.unarmed;
  broken.clips[id].output=output;
  assert.throws(()=>resolveMotionBinding(broken,'PVE_PVP_SOLDIER','walk','unarmed'),/Unsafe motion path/,JSON.stringify(output));
 }
});

test('only the83 listed fully fixed facial channels inherit bind pose',()=>{
 assert.equal(new Set(config.inheritedOnlyChannels).size,83);
 const fixed=config.inheritedOnlyChannels.map(name=>({name,positionMode:'fixed',rotationMode:'fixed'}));
 const animatedPosition={name:fixed[0].name,positionMode:'animated',rotationMode:'fixed'};
 const animatedRotation={name:fixed[1].name,positionMode:'fixed',rotationMode:'animated'};
 const unlistedFixed={name:'HEAD',positionMode:'fixed',rotationMode:'fixed'};
 const data={channels:[...fixed,animatedPosition,animatedRotation,unlistedFixed]};
 const snapshot=structuredClone(data);
 assert.deepEqual(motionPreviewChannels(data,{inheritedOnlyChannels:config.inheritedOnlyChannels}),[animatedPosition,animatedRotation,unlistedFixed]);
 assert.deepEqual(data,snapshot,'source channels must remain unchanged');
 assert.equal(motionPreviewChannels(data,{}).length,86);
});

test('schema/request mismatch fails and returned policy cannot mutate source config',()=>{
 assert.throws(()=>resolveMotionBinding({...config,version:99},'PVE_PVP_SOLDIER','walk','unarmed'),/Unsupported/);
 assert.throws(()=>resolveMotionBinding(config,'PVE_PVP_SOLDIER','fly','unarmed'),/Unknown motion/);
 const broken=structuredClone(config),id=broken.classes.PVE_PVP_SOLDIER.clipIds.walk.unarmed;
 broken.clips[id].gait='run';
 assert.throws(()=>resolveMotionBinding(broken,'PVE_PVP_SOLDIER','walk','unarmed'),/does not match/);
 const binding=resolveMotionBinding(config,'PVE_PVP_SOLDIER','walk','unarmed'),length=config.inheritedOnlyChannels.length;
 binding.inheritedOnlyChannels.push('DO_NOT_MUTATE');
 assert.equal(config.inheritedOnlyChannels.length,length);
});

test('prepared Chaplain and Apothecary aliases retain exact native clips and original class identity',()=>{
 for(const classId of ['PVE_PVP_CHARACTER_MOD_2','PVE_PVP_CHARACTER_MOD_3']){
  assert.equal(classHasPreviewMotion(config,classId),true);
  for(const gait of ['walk','run'])for(const stance of ['unarmed','armed']){
   const a=resolveMotionBinding(config,classId,gait,stance),native=resolveMotionBinding(config,'PVE_PVP_SOLDIER',gait,stance);
   assert.equal(a.classId,classId);assert.equal(a.asset,native.asset);assert.equal(a.output,native.output);assert.equal(a.clipId,native.clipId);
   assert.equal(a.bodyFrameAlias.preserveSourceTiming,true);assert.equal(a.bodyFrameAlias.sourceModel,'astartes_cc_sm_constructor_soldier');
  }
 }
});
test('profile aliases cannot substitute an unverified rig or recurse through aliases',()=>{
 const id='PVE_PVP_CHARACTER_MOD_2';
 for(const mutation of [{status:'pending'},{asset:'different'},{baseClassId:'PVE_PVP_CHARACTER_MOD_3'},{profileId:'other'}]){
  const broken=structuredClone(config);Object.assign(broken.aliases[id],mutation);
  assert.equal(classHasPreviewMotion(broken,id),false);
 }
});
