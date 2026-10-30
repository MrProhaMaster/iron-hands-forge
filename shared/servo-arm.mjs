/** Native servo startup POSE policy. Extracted TRS values live only in prepared data.
 * This is not a bind-pose edit: all source IBM accessors remain unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const SERVO_DIRECTORY='assets/customization/servo-arm-v1';
export const SERVO_MANIFEST=SERVO_DIRECTORY+'/manifest.json';
export const SERVO_CHANNELS=['gun_01_jnt','gun_01_jnt_jiggle','gun_02_jnt','gun_jnt','hand_01_jnt','hand_01_jnt_jiggle','hand_02_jnt','hand_02_jnt_jiggle','hand_03_jnt','hand_03_jnt_jiggle','hand_04_jnt','hand_04_jnt_jiggle','hand_05_jnt','hand_05_jnt_jiggle','hand_06_jnt','hand_06_jnt_jiggle','hand_claw_01_jnt','hand_claw_01_jnt_jiggle','hand_claw_02_jnt','hand_claw_jnt','hand_drill_jnt','hand_index_01_jnt','hand_index_jnt','hand_jnt','hand_jnt_jiggle','hand_pinky_01_jnt','hand_pinky_jnt','hand_thumb_01_jnt','hand_thumb_jnt'];
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function contained(root,relative){
 if(typeof relative!=='string'||relative.includes('\\')||relative.includes(':')||path.posix.isAbsolute(relative)||relative.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Unsafe servo profile resource path');
 const base=path.resolve(root),file=path.resolve(base,relative);
 if(!file.startsWith(base+path.sep))throw Error('Servo profile escapes DataRoot');
 const realRoot=fs.realpathSync(base),realFile=fs.realpathSync(file);if(!realFile.startsWith(realRoot+path.sep))throw Error('Servo resource symlink escapes DataRoot');
 return file;
}
export function validateServoProfile(profile){
 if(profile?.schema!=='iron-hands-forge-servo-startup-pose'||profile.version!==1||profile.policy!=='native-startup-pose-original-bind'||profile.source?.clip!=='tacticus_wpn0_idle_mech_arm_intercessor'||!/^[a-f0-9]{64}$/.test(profile.source?.sha256||'')||profile.source.frameIndex!==0||profile.source.retimed!==false)throw Error('Unsupported native servo startup profile');
 if(!Array.isArray(profile.channels)||profile.channels.length!==29||new Set(profile.channels.map(c=>c.name)).size!==29||SERVO_CHANNELS.some(n=>!profile.channels.some(c=>c.name===n)))throw Error('Servo profile must contain the verified 29 channels');
 for(const c of profile.channels){
  if(!Array.isArray(c.translation)||c.translation.length!==3||!Array.isArray(c.rotation)||c.rotation.length!==4||[...c.translation,...c.rotation].some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(Math.hypot(...c.rotation)-1)>1e-5)throw Error('Invalid servo TRS: '+c.name);
 }
 if(profile.compatibility?.sourceClassId!=='PVE_PVP_ENGINEER'||profile.compatibility.slotId!=='VANITY_3'||(!Array.isArray(profile.compatibility.optionIds)||!profile.compatibility.optionIds.length||profile.compatibility.optionIds.some(id=>!['vanity_engineer_common_01','vanity_engineer_mastercrafted_01','vanity_engineer_artificer_01','vanity_engineer_artificer_02','vanity_engineer_relic_01','vanity_engineer_relic_02','vanity_engineer_prestige','vanity_engineer_champion_iron_hands'].includes(id))))throw Error('Unverified servo variant policy');
 return profile;
}
export function loadServoPose(dataRoot){
 const root=path.resolve(dataRoot),manifest=path.join(root,SERVO_MANIFEST);
 if(!fs.existsSync(manifest)){if(fs.existsSync(path.join(root,SERVO_DIRECTORY)))throw Error('Servo library is incomplete: manifest is missing');return{ready:false,revision:'absent',profile:null,manifestPath:SERVO_MANIFEST,files:[]}}
 const bytes=fs.readFileSync(contained(root,SERVO_MANIFEST)),m=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
 if(m.schema!=='iron-hands-forge-servo-library'||m.version!==1||m.profile!==SERVO_DIRECTORY+'/default-pose.json'||!Array.isArray(m.files)||m.files.length!==1)throw Error('Invalid servo resource manifest');
 const record=m.files[0];if(record.path!==m.profile||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>131072||!/^[a-f0-9]{64}$/.test(record.sha256||''))throw Error('Invalid servo profile manifest record');
 const payload=fs.readFileSync(contained(root,record.path));if(payload.length!==record.bytes||digest(payload)!==record.sha256)throw Error('Servo profile checksum mismatch');
 const profile=validateServoProfile(JSON.parse(payload.toString('utf8').replace(/^\uFEFF/,'')));
 return{ready:true,revision:digest(Buffer.concat([bytes,payload])),profile,manifestPath:SERVO_MANIFEST,files:m.files};
}
function localTRS(node){
 if(node.matrix){
  const m=node.matrix;if(!Array.isArray(m)||m.length!==16||m.some(v=>!Number.isFinite(v)))throw Error('Invalid servo matrix');
  const det=m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);
  return{translation:m.slice(12,15),scale:[Math.hypot(m[0],m[1],m[2])*(det<0?-1:1),Math.hypot(m[4],m[5],m[6]),Math.hypot(m[8],m[9],m[10])]};
 }
 return{translation:node.translation||[0,0,0],scale:node.scale||[1,1,1]};
}

export function applyServoPose(doc,library,{parts=[],targetClassId}={}){
 const no=(reason,extra={})=>({json:doc,applied:false,reason,bones:[],revision:library?.revision||'absent',policy:'native-startup-pose-original-bind',...extra});
 if(!library?.ready)return no('legacy_data_no_servo_profile');
 const profile=validateServoProfile(library.profile),matching=parts.filter(p=>p.slot===profile.compatibility.slotId);
 if(!matching.length)return no('servo_slot_not_selected');
 const selected=matching.find(p=>{
  const ref=p.option?.forgeCrossClass;
  return (ref?.classId||targetClassId)===profile.compatibility.sourceClassId&&profile.compatibility.optionIds.includes(ref?.optionId||p.option?.id);
 });
 if(!selected)return no('unverified_servo_variant',{selectedOptionIds:matching.map(p=>p.option?.id)});
 const matches=new Map();
 for(let i=0;i<doc.nodes.length;i++){
  const n=doc.nodes[i],name=SERVO_CHANNELS.includes(n.name)?n.name:n.extras?.sourceClassId===profile.compatibility.sourceClassId?n.extras?.sourceBoneName:null;
  if(name&&SERVO_CHANNELS.includes(name)){const list=matches.get(name)||[];list.push(i);matches.set(name,list)}
 }
 if(SERVO_CHANNELS.some(n=>!matches.has(n)))return no('servo_rig_missing_verified_channels',{missing:SERVO_CHANNELS.filter(n=>!matches.has(n))});
 const selectedNodes=[],bad=[];
 for(const channel of profile.channels){
  const rows=matches.get(channel.name).map(i=>({i,trs:localTRS(doc.nodes[i])}));
  const suitable=rows.filter(r=>Math.hypot(...r.trs.translation.map((v,j)=>v-channel.translation[j]))<=.00012);
  if(!suitable.length){bad.push(channel.name);continue}
  for(const row of suitable)selectedNodes.push({...row,channel});
 }
 if(bad.length)return no('servo_rig_bind_translation_mismatch',{incompatibleBones:bad});
 const json=structuredClone(doc);
 for(const {i,trs,channel}of selectedNodes){
  const node=json.nodes[i];delete node.matrix;node.translation=[...channel.translation];node.rotation=[...channel.rotation];node.scale=[...trs.scale];
  node.extras={...node.extras,forgeServoStartupPose:true,forgeServoSourceBone:channel.name};
 }
 json.asset??={version:'2.0'};json.asset.extras={...json.asset.extras,forgeServoPose:{sourceClip:profile.source.clip,sourceSHA256:profile.source.sha256,nativeFrame:0,originalInverseBindMatrices:true,tubeBindPreserved:true}};
 return{json,applied:true,reason:'native_startup_pose',bones:[...SERVO_CHANNELS],nodeIndices:selectedNodes.map(r=>r.i),revision:library.revision,policy:profile.policy,originalInverseBindMatrices:true,tubeBindPreserved:true,source:profile.source};
}
