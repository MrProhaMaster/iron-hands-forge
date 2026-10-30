/** Prepare only the verified native servo startup pose into a portable DataRoot.
 * Does not copy animation archives, source paths, game executables or a whole clip.
 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {SERVO_DIRECTORY,SERVO_CHANNELS,validateServoProfile} from '../shared/servo-arm.mjs';
import {readGraftAccessor} from '../shared/cross-class-graft.mjs';
const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){const key=args[i];if(!['--clip','--data-root'].includes(key)||!args[i+1])throw Error('Usage: --clip FILE --data-root DIR');options[key]=args[++i]}
if(!options['--clip']||!options['--data-root'])throw Error('Usage: --clip FILE --data-root DIR');
const source=JSON.parse(fs.readFileSync(options['--clip'],'utf8').replace(/^\uFEFF/,''));
if(source.schema!=='SM2-SANI-TRS-1'||source.clip!=='tacticus_wpn0_idle_mech_arm_intercessor'||source.frameCount!==363||source.fps!==30||source.validation?.finite!==true)throw Error('Need the decoded, validated native servo idle reference');
const channels=SERVO_CHANNELS.map(name=>{const c=source.channels.find(c=>c.name===name);if(!c?.positions?.[0]||!c?.rotations?.[0])throw Error('Missing native startup channel: '+name);return{name,translation:c.positions[0],rotation:c.rotations[0]}});
const dataRoot=path.resolve(options['--data-root']),core=path.join(dataRoot,'assets/characters/SM2-retail-constructors/source-v5'),registry=JSON.parse(fs.readFileSync(path.join(dataRoot,'production/roster/armor-options.json'),'utf8')),engineer=registry.classes.find(c=>c.id==='PVE_PVP_ENGINEER'&&c.tpl==='cc_sm_constructor_engineer');
if(!engineer)throw Error('Prepared Engineer catalogue is required for servo compatibility proof');
const sourceBytes=fs.readFileSync(path.join(core,engineer.tpl+'.glb')),jsonLength=sourceBytes.readUInt32LE(12),doc=JSON.parse(sourceBytes.subarray(20,20+jsonLength)),bin=sourceBytes.subarray(28+jsonLength),meta=JSON.parse(fs.readFileSync(path.join(core,engineer.tpl+'.json'),'utf8'));
if(doc.meshes.length!==meta.meshes.length||doc.meshes.some((m,i)=>m.name!==meta.meshes[i].name))throw Error('Engineer source identity mismatch');
const originalNamed=new Map(doc.nodes.map(n=>[n.name,n]));
const bindErrors=channels.map(c=>{const n=originalNamed.get(c.name);if(!n)throw Error('Source rig misses '+c.name);const t=n.matrix?n.matrix.slice(12,15):n.translation||[0,0,0];return Math.hypot(...t.map((v,i)=>v-c.translation[i]))});
if(Math.max(...bindErrors)>.00012)throw Error('Native startup profile does not match prepared Engineer bind translations');
const variantProof=[];
for(const option of engineer.slots.find(s=>s.id==='VANITY_3').options){
 if(!option.geometryAvailable||!option.geometryComplete||!option.resolvedObjectIds?.length)continue;
 const objectIds=new Set(option.resolvedObjectIds),nodes=doc.nodes.filter(n=>n.mesh!==undefined&&objectIds.has(meta.meshes[n.mesh].objectId)),weighted=new Set();
 for(const node of nodes){
  const skin=doc.skins[node.skin];if(!skin)continue;
  for(const prim of doc.meshes[node.mesh].primitives){
   for(let set=0;set<2;set++){
    const ja=prim.attributes['JOINTS_'+set],wa=prim.attributes['WEIGHTS_'+set];if(ja===undefined||wa===undefined)continue;
    const joints=readGraftAccessor(doc,bin,ja),weights=readGraftAccessor(doc,bin,wa);
    for(let row=0;row<joints.accessor.count;row++)for(let k=0;k<4;k++)if(weights.read(row,k)>0){const name=doc.nodes[skin.joints[joints.read(row,k)]]?.name;if(SERVO_CHANNELS.includes(name))weighted.add(name)}
   }
  }
 }
 if(weighted.size)variantProof.push({optionId:option.id,renderMeshes:nodes.length,weightedServoBones:[...weighted].sort()});
}
if(!variantProof.length)throw Error('No prepared servo variants actually use the verified helper bones');
const compatibility={sourceClassId:'PVE_PVP_ENGINEER',asset:'cc_sm_constructor_engineer',slotId:'VANITY_3',optionIds:variantProof.map(x=>x.optionId),maxLocalTranslationDifference:.00012,verifiedBindTranslationMax:Math.max(...bindErrors),sourceGLBSHA256:crypto.createHash('sha256').update(sourceBytes).digest('hex'),variants:variantProof};
const profile=validateServoProfile({schema:'iron-hands-forge-servo-startup-pose',version:1,policy:'native-startup-pose-original-bind',source:{clip:source.clip,sha256:source.sourceSha256,fps:source.fps,frameIndex:0,retimed:false},compatibility,channels,tubePolicy:{excludedChannelPrefix:'tube_',targetPrestigeBindLengthsRetained:true},referenceApplication:{profiles:['ASTARTES_GROUNDED_V001','ASTARTES_II_MOTION_V001'],adaptation:'Native unretimed startup pose only; existing target body walk/run contacts, timing and channels remain untouched. No authored angles, firing or secondary physics.',evidence:'Previously reviewed native hand/gun helper overlay; generic tube translations are incompatible with Prestige lengths.'}});
const dir=path.join(dataRoot,SERVO_DIRECTORY);fs.mkdirSync(dir,{recursive:true});
const payload=Buffer.from(JSON.stringify(profile,null,2)+'\n'),relative=SERVO_DIRECTORY+'/default-pose.json',record={path:relative,bytes:payload.length,sha256:crypto.createHash('sha256').update(payload).digest('hex')};
fs.writeFileSync(path.join(dataRoot,relative),payload);
const manifest={schema:'iron-hands-forge-servo-library',version:1,profile:relative,files:[record]};
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({ready:true,channels:channels.length,compatibleOptions:compatibility.optionIds,profile:relative,bytes:payload.length,sha256:record.sha256}));
