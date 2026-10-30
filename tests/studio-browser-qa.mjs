import {armourSlotGroups} from '../shared/armour-slots.mjs';
// Real local browser acceptance; isolated profile, no installed game or external requests.
// Run after the QA server is stable: node tests/studio-browser-qa.mjs --url http://127.0.0.1:8878 --out E:/.../browser-full
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {decodeRecipe,normalizeRecipe} from '../shared/recipe-codec.mjs';
import {resolveAppearance} from '../shared/appearance.mjs';
const argv=process.argv.slice(2),args={};
for(let i=0;i<argv.length;i+=2){if(!['--url','--out'].includes(argv[i])||!argv[i+1])throw Error('Use --url LOOPBACK_URL --out ABSOLUTE_DIRECTORY');args[argv[i]]=argv[i+1];}
const base=new URL(args['--url']||'http://127.0.0.1:8878');
assert.equal(base.hostname,'127.0.0.1');assert.equal(base.protocol,'http:');
assert.ok(args['--out']&&path.isAbsolute(args['--out']));
const out=path.resolve(args['--out']);if(process.platform==='win32')assert.match(out,/^E:[\\/]/i);
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'browser-profile-')),temp=path.join(profile,'temp');fs.mkdirSync(temp,{recursive:true});
Object.assign(process.env,{TEMP:temp,TMP:temp,TMPDIR:temp,NODE_DISABLE_COMPILE_CACHE:'1'});
const require=createRequire(import.meta.url),{chromium}=require(process.env.FORGE_PLAYWRIGHT||'playwright');
const {loadIronHandsLibrary,resolveIronHandsDecal}=require('../shared/iron-hands-library.cjs');
const executable=process.env.FORGE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const report={schema:'iron-hands-forge-studio-browser-qa-v1',passed:false,startedAt:new Date().toISOString(),base:base.origin,profile,temp,
 pageErrors:[],consoleErrors:[],httpFailures:[],externalRequests:[],requestFailures:[],cancelledRequests:[],frames:[],artifacts:[],
 instrumentation:'Read-only snapshot appended in the test response for configurator.js. Normal URL, unchanged UI files/events; real autosave is enabled.'};
const save=(name,value)=>{const file=path.join(out,name);fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');return file;};
const hook="\n;globalThis.__forgeStudioQA=Object.freeze({snapshot(){\n if(!model)return null;model.updateMatrixWorld(true);\n const entries=allMeshes(model).filter(m=>m.visible).map(mesh=>{\n  mesh.skeleton?.update();const count=mesh.geometry.attributes.position.count;\n  const samples=[0,Math.floor(count/2),count-1].map(i=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).toArray());\n  return{name:mesh.name,slot:mesh.userData.forgeSlot,vertices:count,bounds:new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).toArray(),samples,\n   materials:(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(mat=>({name:mat.name,role:roleFor(mesh,mat),color:'#'+mat.color.getHexString().toUpperCase(),metallic:mat.metalness,roughness:mat.roughness,opacity:mat.opacity,emissive:mat.emissive?'#'+mat.emissive.getHexString().toUpperCase():null,emissiveIntensity:mat.emissiveIntensity,extra:mat.userData,decal:!!(mat.userData.forgeDecal||mesh.userData.forgeDecal),hidden:!!(mat.userData.forgeHiddenNativeDecal||mesh.userData.forgeHiddenNativeDecal)}))};\n });\n const helperNodes=[];model.traverse(node=>{if(/^(?:hand_|gun_|tube_|techtube_)/i.test(node.name)||node.userData?.forgeServoStartupPose)helperNodes.push({name:node.name,sourceBone:node.userData?.forgeServoSourceBone,startup:!!node.userData?.forgeServoStartupPose,position:node.position.toArray(),rotation:node.quaternion.toArray(),scale:node.scale.toArray()});});\n return{servoPoseApplied:!!model.userData.servoPoseApplied,helperNodes,classId:currentClass?.id,soldier:structuredClone(soldier()),entries,meshes:entries.length,vertices:entries.reduce((n,m)=>n+m.vertices,0),walk:model.userData.walkEvidence,phase:Number(document.getElementById('walk-phase').value),playing:walkPlaying,loading:!document.getElementById('loading').hidden};\n}})";

const hookFile=path.join(out,'readonly-browser-hook.txt');fs.writeFileSync(hookFile,hook);report.artifacts.push(hookFile);
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,viewport:{width:1440,height:1000},env:{...process.env},timeout:60000,args:['--enable-unsafe-swiftshader','--disable-background-networking','--disk-cache-dir='+path.join(profile,'cache'),'--crash-dumps-dir='+path.join(profile,'crashes')]});
let page,catalog,health,lastBuildJob,activeClassId;
function finitePose(pose,label){
 assert.ok(pose?.meshes>0&&pose.vertices>500,label+': visible geometry required');
 for(const e of pose.entries)for(const values of [e.bounds,...e.samples])assert.ok(values.length===3&&values.every(v=>typeof v==='number'&&Number.isFinite(v)),label+': nonfinite skinned coordinates in '+e.name);
}
async function snapshot(label){const v=await page.evaluate(()=>globalThis.__forgeStudioQA?.snapshot());finitePose(v,label);return v;}
async function ready(classId){
 await page.waitForFunction(id=>globalThis.__forgeStudioQA&&document.querySelector('#loading')?.hidden&&globalThis.__forgeStudioQA.snapshot()?.meshes>0&&(!id||document.querySelector('#body-class')?.value===id),classId||null,{timeout:240000});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function screenshot(name){const file=path.join(out,name);await page.screenshot({path:file,fullPage:true});report.artifacts.push(file);console.log('QA_SCREENSHOT',name);return file;}
async function changeColor(id,color){await page.locator('#'+id).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},color);}
async function chooseCategory(slot){const c=catalog.armor.classes.find(c=>c.id===activeClassId),group=armourSlotGroups(c.slots).find(g=>g.slots.some(s=>s.id===slot));assert.ok(group,'Absent slot '+slot);await page.locator('#categories button[data-group-id="'+group.id+'"]').click();const leaf=page.locator('#slot-subnav button[data-slot-id="'+slot+'"]');if(await leaf.isVisible())await leaf.click();}
async function chooseClass(id){activeClassId=id;await page.selectOption('#body-class',id);await ready(id);}
async function choosePart(slot,id){
 await chooseCategory(slot);await page.selectOption('#part-source','all');await page.fill('#part-search',id);assert.match(id,/^[A-Za-z0-9_:.\-]+$/);
 const card=page.locator('#part-grid button[data-option-id="'+id+'"]');await card.waitFor({state:'visible'});await card.click();await ready(activeClassId);
 await page.waitForFunction(({slot,id})=>globalThis.__forgeStudioQA.snapshot()?.soldier.selection[slot]===id,{slot,id},{timeout:240000});
 const pose=await snapshot(slot+' '+id);assert.equal(pose.soldier.selection[slot],id);return pose;
}
async function getCode(){
 await page.click('#share-build');await page.waitForFunction(()=>document.querySelector('#recipe-code')?.value.startsWith('IHF1.'),null,{timeout:30000});
 const code=await page.inputValue('#recipe-code'),recipe=await decodeRecipe(code);await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();return{code,recipe};
}
function inspectMaterials(pose){
 let tested=0;const roles={};
 for(const mesh of pose.entries)for(const mat of mesh.materials){
  if(mat.decal||mat.hidden||mat.opacity===0)continue;const expected=resolveAppearance(pose.soldier,mesh.slot||'',mat.role);
  assert.equal(mat.color.toUpperCase(),expected.color.toUpperCase(),'Preview color differs: '+mesh.name+'/'+mat.role);
  for(const key of ['metallic','roughness','opacity'])assert.ok(Math.abs(mat[key]-expected[key])<1e-6,'Preview '+key+' differs: '+mesh.name+'/'+mat.role);
  roles[mat.role]=(roles[mat.role]||0)+1;tested++;
 }
 assert.ok(tested>0);return{tested,roles};
}
try{
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['blob:','data:'].includes(url.protocol)&&url.origin!==base.origin){report.externalRequests.push(url.href);await route.abort();return}
  if(url.origin===base.origin&&url.pathname==='/web/configurator.js'){const response=await route.fetch();await route.fulfill({response,body:await response.text()+hook});return}
  await route.continue();
 });
 page=await context.newPage();page.setDefaultTimeout(240000);
 await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const icon=document.createElement('link');icon.rel='icon';icon.href='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';document.head.append(icon)},{once:true}));
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 page.on('response',r=>{if(r.status()>=400&&!/favicon\.ico(?:\?|$)/.test(r.url()))report.httpFailures.push({url:r.url(),status:r.status()});});
 page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text())});
 page.on('requestfailed',r=>{if(/favicon\.ico(?:\?|$)/.test(r.url()))return;const item={url:r.url(),error:r.failure()?.errorText};(item.error==='net::ERR_ABORTED'?report.cancelledRequests:report.requestFailures).push(item);});
 page.on('response',async r=>{if(r.url()===base.origin+'/api/build'&&r.request().method()==='POST'&&r.status()===202){try{lastBuildJob=await r.json()}catch{}}});
 let lastHealthError;for(let attempt=0;attempt<30;attempt++){try{const response=await fetch(new URL('/api/health',base));if(!response.ok)throw Error('HTTP'+response.status);health=await response.json();break}catch(error){lastHealthError=error;await new Promise(r=>setTimeout(r,500));}}if(!health)throw lastHealthError;catalog=await fetch(new URL('/api/catalog',base)).then(r=>r.json());report.health=health;
 await page.goto(base.href,{waitUntil:'domcontentloaded'});await ready();report.initial=await snapshot('initial');activeClassId=report.initial.classId;
 assert.equal(await page.locator('#soldiers button').count(),1);assert.equal(await page.locator('#apply-iron-hands').count(),0,'Separate Iron Hands apply button is forbidden');
 const classIds=await page.locator('#body-class option').evaluateAll(nodes=>nodes.map(n=>n.value));assert.equal(classIds.length,7+(catalog.astartes?.profileIds?.length||0));if(catalog.astartes?.ready)for(const id of ['PVE_PVP_CHARACTER_MOD_2','PVE_PVP_CHARACTER_MOD_3'])assert.ok(classIds.includes(id),'Astartes body frame missing '+id);await screenshot('01-initial-1440.png');
 const lastCategory=page.locator('#categories button').last();await lastCategory.scrollIntoViewIfNeeded();await lastCategory.click();
 report.lastCategoryAccess={label:await lastCategory.textContent(),box:await lastCategory.boundingBox(),viewport:page.viewportSize()};
 assert.ok(report.lastCategoryAccess.label?.length,'Final category needs a display label');assert.ok(report.lastCategoryAccess.box.y>=0&&report.lastCategoryAccess.box.y+report.lastCategoryAccess.box.height<=page.viewportSize().height+1,'Last Servo-arm category must be reachable inside desktop viewport');

 for(const id of classIds){await chooseClass(id);const pose=await snapshot(id);report.frames.push({classId:id,meshes:pose.meshes,vertices:pose.vertices,motion:pose.walk,materials:inspectMaterials(pose)});console.log('QA_FRAME_PASS',id,pose.meshes,pose.vertices);
  const profile=catalog.armor.classes.find(c=>c.id===id);
  if(profile.forgeBodyFrame){
   for(const [slot,selected]of Object.entries(profile.initialSelection))assert.equal(pose.soldier.selection[slot],selected,'Source template selection '+id+' '+slot);
   for(const [key,value]of Object.entries(profile.initialPaint||{}))assert.equal(pose.soldier.paint[key],value,'Source template preview paint '+id+' '+key);
   await screenshot('frame-'+id+'.png');
   await page.selectOption('#motion-gait','walk');await page.waitForFunction(()=>!document.querySelector('#walk-play').disabled,null,{timeout:60000});await page.click('#walk-play');
   await page.waitForFunction(()=>Number(document.querySelector('#walk-phase').value)>0,null,{timeout:60000});await page.click('#walk-play');
   finitePose(await snapshot(id+' walking'),id+' walking');await screenshot('frame-'+id+'-walk.png');await page.click('#walk-reset');
  }
 }
 if(catalog.astartes?.ready){
  await chooseClass('PVE_PVP_SOLDIER');const target=catalog.armor.classes.find(c=>c.id==='PVE_PVP_SOLDIER'),helmet=target.slots.find(s=>s.id==='HELMET').options.find(o=>o.id==='helmet_soldier_common_01');
  if(helmet)await choosePart('HELMET',helmet.id);
  const slot=target.slots.find(s=>s.id==='MODDED_SLOT_1');assert.ok(slot,'Accessories category required');
  await chooseCategory(slot.id);await page.selectOption('#part-source','astartes');
  assert.ok(await page.locator('#part-grid button').count()>0,'Astartes source filter should show imported options');
  const options=slot.options.filter(o=>o.forgeAstartes&&o.meshes?.length),chosen=[];
  for(const pattern of [/accessory_laurels_skull_vanity/i,/accessory_tank_hood/i,/accessory_tank_faceplate_01/i]){
   const option=options.find(o=>!chosen.includes(o.id)&&pattern.test(o.id+' '+o.meshes.join(' ')))||options.find(o=>!chosen.includes(o.id));assert.ok(option,'Need varied accessory choices');
   const pose=await choosePart(slot.id,option.id);assert.ok(pose.entries.some(e=>e.slot===slot.id),'Accessory geometry missing from assembled preview');chosen.push(option.id);await screenshot('accessory-'+chosen.length+'.png');await page.click('#focus');await screenshot('accessory-'+chosen.length+'-close.png');await page.click('#fit');
  }
  report.astartesAccessories={available:options.length,samples:chosen};
  const unavailable=slot.options.find(o=>o.forgeUnavailable);
  if(unavailable){
   await chooseCategory(slot.id);await page.selectOption('#part-source','astartes');await page.fill('#part-search',unavailable.id);
   const card=page.locator('#part-grid button[data-option-id="'+unavailable.id+'"]');await card.waitFor({state:'visible'});
   assert.equal(await card.isDisabled(),true,'An unavailable source choice must be clearly disabled');
   assert.match(await card.textContent(),/Unavailable/);report.unavailableAccessory={id:unavailable.id,reason:unavailable.unavailableReason||unavailable.reason,missingSelectors:unavailable.missingSelectors};
   await screenshot('accessory-unavailable-source.png');
  }

  const none=slot.options.find(o=>!o.meshes?.length&&!o.forgeCrossClass&&!o.forgeUnavailable);if(none)await choosePart(slot.id,none.id);
  await chooseClass('PVE_PVP_TANK');const bulwark=catalog.armor.classes.find(c=>c.id==='PVE_PVP_TANK'),shieldSlot=bulwark.slots.find(s=>s.id==='VANITY');
  const shield=shieldSlot?.options.find(o=>o.forgeAstartes&&o.sourceOptionId==='vanity_tank_common_01'&&o.attachment?.followNodeName==='shield_pos');assert.ok(shield,'Native-source shield equipment must be imported');
  const shieldPose=await choosePart(shieldSlot.id,shield.id);assert.ok(shieldPose.entries.some(e=>e.slot===shieldSlot.id),'Shield geometry missing');report.astartesShield={id:shield.id,attachment:shield.attachment};await screenshot('equipment-shield.png');
  const noShield=shieldSlot.options.find(o=>!o.meshes?.length&&!o.equipmentActorMeshes?.length&&!o.forgeUnavailable&&!o.forgeCrossClass);if(noShield)await choosePart(shieldSlot.id,noShield.id);
 }


 await chooseClass('PVE_PVP_ENGINEER');const engineer=catalog.armor.classes.find(c=>c.id==='PVE_PVP_ENGINEER'),servoSlot=engineer.slots.find(s=>s.id==='VANITY_3');
 assert.ok(servoSlot,'Engineer must expose native Servo-arm');
 const servoOption=servoSlot.options.find(o=>o.id==='vanity_engineer_common_01');assert.ok(servoOption,'Native common servo arm must exist');
 report.engineerServoRest=await choosePart('VANITY_3',servoOption.id);assert.equal(report.engineerServoRest.servoPoseApplied,true,'Native startup fold must be applied');
 const servoProfile=JSON.parse(fs.readFileSync(path.join(health.dataRoot,'assets/customization/servo-arm-v1/default-pose.json'),'utf8'));
 const posed=report.engineerServoRest.helperNodes.filter(n=>n.startup);assert.equal(posed.length,29,'All29 native startup helper channels required');
 let maxNativePositionError=0,maxNativeRotationError=0;
 for(const channel of servoProfile.channels){
  const node=posed.find(n=>(n.sourceBone||n.name)===channel.name);assert.ok(node,'Missing native servo helper '+channel.name);
  maxNativePositionError=Math.max(maxNativePositionError,...node.position.map((v,i)=>Math.abs(v-channel.translation[i])));
  const a=Math.hypot(...node.rotation.map((v,i)=>v-channel.rotation[i])),b=Math.hypot(...node.rotation.map((v,i)=>v+channel.rotation[i]));maxNativeRotationError=Math.max(maxNativeRotationError,Math.min(a,b));
 }
 assert.ok(maxNativePositionError<1e-5&&maxNativeRotationError<1e-5,'Folded servo pose must match native frame0');
 await screenshot('01b-engineer-native-servo.png');
 await page.selectOption('#motion-gait','walk');await page.selectOption('#walk-style','armed');await page.waitForFunction(()=>!document.querySelector('#walk-play').disabled,null,{timeout:60000});
 await page.click('#walk-play');await page.waitForFunction(()=>Number(document.querySelector('#walk-phase').value)>0,null,{timeout:60000});await page.click('#walk-play');
 await page.locator('#walk-phase').evaluate(el=>{el.value=String(Math.max(1,Math.floor(Number(el.max)/2)));el.dispatchEvent(new Event('input',{bubbles:true}))});
 report.engineerServoWalking=await snapshot('Engineer folded servo while walking');assert.equal(report.engineerServoWalking.servoPoseApplied,true);
 let maxHelperLocalError=0;for(const before of report.engineerServoRest.helperNodes){const after=report.engineerServoWalking.helperNodes.find(n=>n.name===before.name);assert.ok(after,'Servo helper disappeared during walk '+before.name);for(const key of ['position','rotation','scale'])maxHelperLocalError=Math.max(maxHelperLocalError,...before[key].map((v,i)=>Math.abs(v-after[key][i])));}
 assert.ok(maxHelperLocalError<1e-5,'Body gait overwrote servo/tube native local pose');report.engineerServoProof={channels:posed.length,maxNativePositionError,maxNativeRotationError,helperNodesChecked:report.engineerServoRest.helperNodes.length,maxHelperLocalError};
 await screenshot('01c-engineer-servo-walking.png');await page.click('#walk-reset');
 await chooseClass('PVE_PVP_SOLDIER');const tactical=catalog.armor.classes.find(c=>c.id==='PVE_PVP_SOLDIER');
 const ihSlot=tactical.slots.find(s=>s.options.some(o=>o.tags?.includes('iron-hands')&&!o.forgeCrossClass&&o.meshes?.length));assert.ok(ihSlot);
 await chooseCategory(ihSlot.id);await page.selectOption('#part-source','iron-hands');
 const ids=await page.locator('#part-grid button[data-option-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.optionId));assert.ok(ids.length>0);assert.ok(ids.every(id=>ihSlot.options.find(o=>o.id===id)?.tags?.includes('iron-hands')||/iron_hands|bionic/i.test(id)));
 report.ironHandsFilter={slot:ihSlot.id,ids};await screenshot('02-iron-hands-filter.png');
 const arm=tactical.slots.find(s=>s.id==='RIGHT_GAUNTLET')||ihSlot,ihArm=arm.options.find(o=>o.tags?.includes('iron-hands')&&!o.forgeCrossClass&&o.meshes?.length);
 if(ihArm){await choosePart(arm.id,ihArm.id);report.selectedIronHandsPart={slot:arm.id,id:ihArm.id};}
 const helmet=tactical.slots.find(s=>s.id==='HELMET'),foreign=helmet.options.find(o=>o.forgeCrossClass?.classId==='PVE_PVP_SNIPER'&&/helmet_sniper_common_01$/.test(o.forgeCrossClass.optionId))||helmet.options.find(o=>o.forgeCrossClass?.classId==='PVE_PVP_SNIPER'&&o.meshes?.length);
 assert.ok(foreign,'A verified Sniper helmet must be offered on Tactical');report.crossClassHelmet={id:foreign.id,source:foreign.forgeCrossClass};
 report.crossRest=await choosePart('HELMET',foreign.id);inspectMaterials(report.crossRest);await screenshot('03-cross-class-helmet.png');
 await page.selectOption('#motion-gait','walk');await page.selectOption('#walk-style','armed');await page.waitForFunction(()=>!document.querySelector('#walk-play').disabled,null,{timeout:60000});
 await page.click('#walk-play');await page.waitForFunction(()=>Number(document.querySelector('#walk-phase').value)>0,null,{timeout:60000});await page.click('#walk-play');
 const frame=await page.locator('#walk-phase').evaluate(el=>{const value=Math.max(1,Math.floor(Number(el.max)/2));el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));return value;});
 report.crossMotion=await snapshot('mixed helmet animated pose');report.crossMotion.requestedFrame=frame;assert.ok(report.crossMotion.phase>0);await screenshot('04-mixed-motion.png');await page.click('#walk-reset');
 for(const [id,color]of [['armor-color','#24313f'],['metal-color','#5796d6'],['trim-color','#ddbf73'],['cloth-color','#614b31'],['beard-color','#444444']])await changeColor(id,color);
 await page.locator('#finish-metallic').uncheck();await page.locator('#finish-roughness').evaluate(el=>{el.value='0.47';el.dispatchEvent(new Event('input',{bubbles:true}))});
 await chooseCategory('HELMET');const partDetails=page.locator('details').filter({has:page.locator('#part-metallic')});if(!await partDetails.evaluate(el=>el.open))await partDetails.locator('summary').click();await changeColor('part-color','#136579');await changeColor('part-trim-color','#c4b998');await page.locator('#part-metallic').check();
 report.painted=await snapshot('global/per-part painted');report.paintMaterialCheck=inspectMaterials(report.painted);
 const transfer=await getCode(),marine=transfer.recipe.soldiers[0];assert.equal(transfer.recipe.soldiers.length,1);assert.equal(marine.paint.metal,'#5796D6');assert.equal(marine.appearance.colors.trim,'#DDBF73');assert.equal(marine.appearance.parts.HELMET.armor,'#136579');assert.equal(marine.appearance.parts.HELMET.trim,'#C4B998');assert.equal(marine.appearance.parts.HELMET.metallic,true);
 const nativeLibrary=loadIronHandsLibrary(health.dataRoot),left=tactical.slots.find(s=>s.id==='LEFT_PAULDRON'),decal=(catalog.cosmetics?.decals||[]).find(d=>d.section==='LEFT_PAULDRON'&&d.material==='iron_hands_01'&&d.colorsNumber>0);assert.ok(decal);
 const candidates=left.options.filter(o=>!o.forgeCrossClass&&!o.forgeBionic&&o.meshes?.length).sort((a,b)=>(/common_01$/.test(b.id)?1:0)-(/common_01$/.test(a.id)?1:0));
 const carrierOption=candidates.find(o=>{try{return!resolveIronHandsDecal(nativeLibrary,{classId:tactical.id,slot:'LEFT_PAULDRON',armorOptionId:o.id,decalId:decal.id}).clear}catch{return false}});
 assert.ok(carrierOption);assert.match(carrierOption.id,/common/,'Use an ordinary common pauldron');
 await choosePart('LEFT_PAULDRON',carrierOption.id);await page.selectOption('#chapter-choice',decal.id);
 for(const id of ['decal-color','decal-secondary','decal-tertiary'])await changeColor(id,'#e0eefc');
 await page.waitForTimeout(700);await ready(tactical.id);report.heraldry=await snapshot('native Iron Hands emblem');assert.ok(report.heraldry.entries.some(m=>m.materials.some(x=>x.decal)),'A native emblem texture must be in the rendered selected geometry');
 report.selectedDecal={slot:'LEFT_PAULDRON',armorOptionId:carrierOption.id,id:decal.id};await screenshot('05-native-iron-hands-emblem.png');
 await page.click('#save-roster');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Marine saved'),null,{timeout:30000});
 const beforeReload=await getCode();await page.reload({waitUntil:'domcontentloaded'});await ready(tactical.id);const afterReload=await getCode();assert.deepEqual(afterReload.recipe.soldiers[0],beforeReload.recipe.soldiers[0]);
 await page.click('#share-build');await page.waitForFunction(()=>document.querySelector('#recipe-code').value.startsWith('IHF1.'));await page.fill('#recipe-code',beforeReload.code);await page.click('#import-code');
 await page.waitForFunction(()=>document.querySelector('#recipe-message').textContent.startsWith('Build restored'),null,{timeout:240000});await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();await ready(tactical.id);
 report.imported=await snapshot('IHF1 restored');assert.deepEqual(normalizeRecipe({...beforeReload.recipe,soldiers:[report.imported.soldier]}),beforeReload.recipe);report.importedMaterialCheck=inspectMaterials(report.imported);
 const final=await getCode();report.finalRecipeFile=save('accepted-recipe.ihf.json',final.recipe);report.finalCodeFile=path.join(out,'accepted-build.ihf.txt');fs.writeFileSync(report.finalCodeFile,final.code+'\n');
 await page.click('#share-build');await page.waitForFunction(()=>document.querySelector('#recipe-code').value.startsWith('IHF1.'));await page.click('#build-model');
 await page.waitForFunction(()=>document.querySelector('#recipe-message').textContent.startsWith('GLB build ready:'),null,{timeout:240000});assert.ok(lastBuildJob?.id);
 const built=await fetch(new URL('/api/jobs/'+lastBuildJob.id,base)).then(r=>r.json());assert.equal(built.status,'complete');assert.equal(built.result.files.length,1);assert.deepEqual(built.result.recipe.soldiers,final.recipe.soldiers);report.buildJob=built;
 const glb=path.join(built.out,built.result.files[0].file);assert.ok(fs.statSync(glb).size>0);report.preparedGLB=glb;save('accepted-build-job.json',built);
 await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(100);report.desktopScreenshot=await screenshot('06-final-desktop.png');
 await page.setViewportSize({width:375,height:950});await page.waitForTimeout(200);report.narrowLayout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}));
 assert.ok(report.narrowLayout.documentWidth<=report.narrowLayout.width+1,'375px layout has horizontal overflow');report.narrowScreenshot=await screenshot('07-final-narrow-375.png');
 for(const key of ['pageErrors','externalRequests','httpFailures','requestFailures','consoleErrors'])assert.deepEqual(report[key],[],key+' must stay empty');report.passed=true;
}catch(error){report.exception=error.stack;try{if(page){report.failureStatus=await page.locator('#status').textContent();report.failureRecipeMessage=await page.locator('#recipe-message').textContent();await screenshot('failure.png');}}catch{}}
finally{await context.close();report.passed=report.passed&&['pageErrors','externalRequests','httpFailures','requestFailures','consoleErrors'].every(k=>report[k].length===0);report.finishedAt=new Date().toISOString();save('report.json',report);console.log(JSON.stringify({passed:report.passed,frames:report.frames.length,preparedGLB:report.preparedGLB,pageErrors:report.pageErrors,httpFailures:report.httpFailures,externalRequests:report.externalRequests,consoleErrors:report.consoleErrors,exception:report.exception,report:path.join(out,'report.json')}));}
if(!report.passed)process.exitCode=1;
