import {hasPartGeometry} from '/shared/part-geometry.mjs';
import {deduplicateOptionsByName} from '/shared/option-list.mjs';
import {bodyFrameTemplate} from '/shared/body-frame-template.mjs';
import {armourSlotGroups} from '/shared/armour-slots.mjs';
import {heraldryOptions,heraldryCompatibility,applyHeraldryChoice} from '/shared/heraldry-options.mjs';
import {classLabel,slotLabel,optionLabel} from '/shared/ui-labels.mjs';
import {motionPreviewChannels,classHasPreviewMotion} from '/shared/motion-policy.mjs';
import {createEightInfluenceSkinning} from '/shared/eight-influence-skinning.mjs';
import {resolveAppearance,classifyMaterialRole} from '/shared/appearance.mjs';
import {attachForgeTools} from './forge-tools.js';
import {filterServoMotionChannels} from '/shared/servo-motion-policy.mjs';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
const $=id=>document.getElementById(id),QA=new URLSearchParams(location.search).get('inspect')==='1';
const eightInfluenceSkinning=createEightInfluenceSkinning(THREE);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;$('stage').append(renderer.domElement);
const environment=new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(),.04).texture;scene.environment=environment;
scene.add(new THREE.HemisphereLight(0xd5e7ff,0x1c2530,2));const key=new THREE.DirectionalLight(0xf2f5ff,3.3);key.position.set(-3,6,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);scene.add(key);const rim=new THREE.DirectionalLight(0xb3d0f0,2.5);rim.position.set(2,3,-4);scene.add(rim);
const floor=new THREE.Mesh(new THREE.CircleGeometry(3,80),new THREE.MeshStandardMaterial({color:0x182127,roughness:.76,metalness:.08}));floor.rotation.x=-Math.PI/2;floor.position.y=-.018;floor.receiveShadow=true;scene.add(floor);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,1.35,0);controls.minDistance=.4;controls.maxDistance=14;
let dirty=true,model=null,catalog=null,classes=[],currentClass=null,category='HELMET',loadSerial=0,thumbSerial=0,page=0;
let mixer=null,walkAction=null,walkPlaying=false,walkRest=[],walkData=null,walkSerial=0,lastFrame=performance.now(),previewTimer;
const calibrations=new Map(),walkCache=new Map(),thumbCache=new Map();let thumbChain=Promise.resolve(),libraryContext='';
let soldiers=[{id:'IH-1',role:'Iron Hands marine',classId:'PVE_PVP_SOLDIER',selection:{},paint:{armor:'#171B22',metal:'#B3BDC9',lenses:'#EE291C'},appearance:{colors:{trim:'#B3BDC9',cloth:'#51483C',beard:'#51483C'},finish:{metallic:false,roughness:.55},parts:{},decals:{}}}];
const soldier=()=>soldiers[0];
const setStatus=t=>$('status').textContent=t;
async function post(url,value){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error||'The action failed.'),{status:r.status});return v}
function appearance(){return soldier().appearance??={}}
function usable(o){return !o.forgeUnavailable&&!(o.equipmentActorMeshes?.length&&!o.meshes?.length)&&(!o.meshes?.length||!!o.resolvedObjectIds?.length||!!o.forgeCrossClass||!!o.forgeBionic||!!o.forgeAstartes)}
function currentSlot(){return currentClass?.slots.find(s=>s.id===category)}
function selectedOption(slot){return slot?.options.find(o=>o.id===soldier().selection[slot.id])}
function roleFor(mesh,mat){return mesh.userData.forgeRole||mat.userData?.forgeRole||classifyMaterialRole(mat.userData?.sourceMaterial||mat.name,mesh.userData.sourceName||mesh.name)}
function recipe(){return{schema:'iron-hands-forge',version:1,kind:'soldier',catalog:{game:'SM2',build:String(catalog.gameBuild||'unknown')},soldiers:[structuredClone(soldier())]}}
let draftTimer;function persist(){if(QA)return;clearTimeout(draftTimer);draftTimer=setTimeout(()=>post('/api/draft',{soldiers}).catch(e=>setStatus(e.message)),350)}
function showSoldiers(){$('soldiers').replaceChildren();const b=document.createElement('button');b.type='button';b.textContent='SINGLE MARINE WORKSPACE';b.setAttribute('aria-pressed','true');$('soldiers').append(b);$('unit-name').value=soldier().role}
function ensureSelection(){
 const next={};for(const slot of currentClass.slots){
  const selectedId=soldier().selection[slot.id],sameFrameAlias=typeof selectedId==='string'&&selectedId.startsWith('forge:'+currentClass.id+':')?selectedId.slice(('forge:'+currentClass.id+':').length):null;
  const prior=slot.options.find(o=>(o.id===selectedId||o.id===sameFrameAlias)&&usable(o));
  let fallback=slot.options.find(o=>o.id===currentClass.initialSelection?.[slot.id]&&usable(o))||slot.options.find(usable);
  if(!prior&&!currentClass.forgeBodyFrame&&slot.id==='HELMET')fallback=slot.options.find(o=>!o.forgeCrossClass&&/helmet_.*common_01$/.test(o.id)&&usable(o))||fallback;
  if(prior||fallback)next[slot.id]=(prior||fallback).id;
 }
 soldier().selection=next;
}
async function refreshCatalog(){
 const r=await fetch('/api/catalog',{cache:'no-store'});if(!r.ok)throw Error('The local armour catalogue is unavailable.');catalog=await r.json();
 const context=JSON.stringify([catalog.dataRoot,catalog.registryFingerprint,catalog.cosmeticsRevision,catalog.motionRevision,(catalog.manifest.assets||[]).map(a=>[a.asset,a.assetRevision])]);if(context!==libraryContext){libraryContext=context;calibrations.clear();walkCache.clear();thumbCache.clear();++loadSerial;++walkSerial;++thumbSerial;}
 const available=new Set((catalog.manifest.assets||[]).filter(a=>a.transformValidation==='passed').map(a=>a.asset));
 classes=(catalog.armor.classes||[]).filter(c=>c.available&&available.has(c.tpl));
 $('body-class').replaceChildren(...classes.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=classLabel(c.id,c.label);return o}));$('body-class').disabled=!classes.length;
 const unique=new Set(classes.flatMap(c=>c.slots.flatMap(s=>s.options.map(o=>o.forgeCrossClass?.classId+':'+o.forgeCrossClass?.optionId||o.id))));
 $('catalog-info').textContent=classes.length+' body frames | '+(catalog.astartes?.ready?'Astartes accessories included | ':'')+'Iron Hands library '+(catalog.cosmetics?.ready?'included':'not connected');
 return classes;
}
function loader(){return new GLTFLoader().register(eightInfluenceSkinning.loaderPlugin)}
function dispose(root){root?.traverse(o=>{if(o.isMesh){eightInfluenceSkinning.disposeMesh(o);o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const k of ['map','normalMap','roughnessMap','metalnessMap'])m[k]?.dispose();m.dispose()}}})}
function allMeshes(root){const rows=[];root?.traverse(o=>{if(o.isMesh)rows.push(o)});return rows}
function visibleBox(){const box=new THREE.Box3();for(const mesh of allMeshes(model))if(mesh.visible)box.union(new THREE.Box3().setFromObject(mesh));return box}
function fitView(){controls.target.set(0,1.35,0);camera.position.set(3.2,2.55,6.4);controls.update();dirty=true}
function focusPart(){const box=new THREE.Box3();for(const m of allMeshes(model))if(m.userData.forgeSlot===category&&m.visible)box.union(new THREE.Box3().setFromObject(m));if(box.isEmpty())return;const center=box.getCenter(new THREE.Vector3()),radius=Math.max(box.getSize(new THREE.Vector3()).length(),.25);controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(radius*.4,radius*.2,radius*1.8));controls.update();dirty=true}
function updateVisibility(){for(const m of allMeshes(model))m.visible=!$('isolate').checked||m.userData.forgeSlot===category;dirty=true}
function updatePaint(){
 for(const mesh of allMeshes(model))for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
  if(mat.userData.forgeDecal||mesh.userData.forgeDecal||mat.userData.forgeInvisibleDecal)continue;
  const role=roleFor(mesh,mat),look=resolveAppearance(soldier(),mesh.userData.forgeSlot||'',role);
  mat.color.set(look.color);mat.metalness=look.metallic;mat.roughness=look.roughness;mat.opacity=look.opacity;mat.transparent=look.opacity<1;mat.depthWrite=look.opacity===1;mat.wireframe=$('wireframe').checked;
  if(look.emissive){mat.emissive.set(look.emissive);mat.emissiveIntensity=1}
 }
 for(const [id,k]of [['armor-color','armor'],['metal-color','metal'],['lens-color','lenses']])$(id).value=soldier().paint[k];
 for(const [id,k]of [['trim-color','trim'],['cloth-color','cloth'],['beard-color','beard']])$(id).value=resolveAppearance(soldier(),'',k).color;
 $('finish-metallic').checked=!!soldier().appearance?.finish?.metallic;$('finish-roughness').value=soldier().appearance?.finish?.roughness??.48;$('finish-roughness-value').value=Number($('finish-roughness').value).toFixed(2);
 const part=soldier().appearance?.parts?.[category];$('part-color').value=part?.armor||part?.cloth||soldier().paint.armor;$('part-trim-color').value=part?.trim||resolveAppearance(soldier(),'', 'trim').color;$('part-metallic').checked=part?.metallic??$('finish-metallic').checked;$('part-paint-state').textContent=part?'Custom paint for '+slotLabel(category):'Using global paint';dirty=true;
}
async function chooseClass(classId,{resetCamera=false,applyTemplate=false}={}){
 currentClass=classes.find(c=>c.id===classId)||classes[0];if(!currentClass)throw Error('The included armour library is unavailable. Extract the full application folder.');
 if(applyTemplate)Object.assign(soldier(),bodyFrameTemplate(currentClass,soldier()));
 soldier().classId=currentClass.id;$('body-class').value=currentClass.id;$('body-label').textContent=classLabel(currentClass.id,currentClass.label);ensureSelection();
 if(!currentClass.slots.some(s=>s.id===category))category=currentClass.slots[0].id;
 showCategories();showOptions();syncHeraldry();await loadModel({resetCamera});persist();
}
async function loadModel({resetCamera=false}={}){
 const serial=++loadSerial,context=libraryContext;$('loading').hidden=false;$('loading').textContent='Assembling selected armour locally...';$('walk-play').disabled=true;
 const wasPlaying=walkPlaying,phase=walkAction?.time||0;
 try{
  const preview=await post('/api/preview',{recipe:recipe()});if(serial!==loadSerial||context!==libraryContext)return;
  const gltf=await loader().loadAsync(preview.url);if(serial!==loadSerial||context!==libraryContext){dispose(gltf.scene);return}
  const next=gltf.scene;next.userData.servoPoseApplied=(gltf.parser.json.nodes||[]).some(n=>n.extras?.forgeServoStartupPose===true);next.updateMatrixWorld(true);
  next.traverse(o=>{if(o.isSkinnedMesh){o.frustumCulled=false;eightInfluenceSkinning.prepareMesh(o)}if(o.isMesh){o.userData.forgeSlot=o.userData.forgeSlot||gltf.parser.json.meshes?.[gltf.parser.associations.get(o)?.meshes]?.extras?.forgeSlot||'';o.userData.sourceName=o.userData.source_name||o.name;o.castShadow=true;o.receiveShadow=true;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.userData.sourceMaterial=m.userData.sourceMaterial||m.name;m.userData.forgeDecal=!!m.map||!!m.userData.forgeDecal}}});
  if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model);mixer=null}walkAction=null;walkRest=[];walkPlaying=false;if(model){scene.remove(model);dispose(model)}model=next;scene.add(model);
  let calibration=calibrations.get(currentClass.id);
  if(calibration){model.rotation.x=calibration.rotation;model.scale.setScalar(calibration.scale);model.position.copy(calibration.position)}
  else{
   let box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),rotation=size.z>size.y*1.5?-Math.PI/2:0;model.rotation.x=rotation;model.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(model);const height=box.max.y-box.min.y,scale=height>0?2.7*(currentClass.forgeBodyFrame?.sourceActorScale??1)/height:1;model.scale.setScalar(scale);model.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(model);const center=box.getCenter(new THREE.Vector3());model.position.set(-center.x,-box.min.y,-center.z);calibrations.set(currentClass.id,{rotation,scale,position:model.position.clone()});
  }
  model.updateMatrixWorld(true);updateVisibility();updatePaint();if(resetCamera||serial===1)fitView();
  await setupWalk(serial);if(serial!==loadSerial||context!==libraryContext)return;if(wasPlaying&&walkAction){walkAction.play();mixer.setTime(phase);walkPlaying=true;$('walk-play').textContent='Pause'}
  setStatus('Armour assembled from the local library. Preview and GLB use the same selected geometry.');updateSelectionText();dirty=true;
 }catch(e){if(context!==libraryContext||serial!==loadSerial)return;console.error(e);setStatus('Could not assemble this combination: '+e.message);throw e}
 finally{if(serial===loadSerial)$('loading').hidden=true}
}
function schedulePreview(){clearTimeout(previewTimer);previewTimer=setTimeout(()=>loadModel().catch(()=>{}),280)}
function updateSelectionText(){const option=selectedOption(currentSlot());$('selection').textContent=option?slotLabel(category)+': '+optionLabel(option):''}
const rememberedGroupSlots=new Map();
function chooseCategory(slotId){
 category=slotId;page=0;$('part-search').value='';showCategories();showOptions();updateVisibility();updatePaint();updateSelectionText();
}
function showCategories(){
 const groups=armourSlotGroups(currentClass.slots),active=groups.find(g=>g.slots.some(s=>s.id===category));
 if(active)rememberedGroupSlots.set(active.id,category);
 $('categories').replaceChildren(...groups.map(group=>{const b=document.createElement('button');b.type='button';b.textContent=group.label;b.dataset.groupId=group.id;b.setAttribute('aria-pressed',String(group===active));b.onclick=()=>{const prior=rememberedGroupSlots.get(group.id),slot=group.slots.find(s=>s.id===prior)||group.slots[0];chooseCategory(slot.id)};return b}));
 const host=$('slot-subnav');host.hidden=!active||active.slots.length<2;host.setAttribute('aria-label',(active?.label||'Armour')+' slots');
 host.replaceChildren(...(active?.slots||[]).map(slot=>{const b=document.createElement('button');b.type='button';b.textContent=slotLabel(slot.id,slot.label);b.dataset.slotId=slot.id;b.setAttribute('aria-pressed',String(slot.id===category));b.onclick=()=>chooseCategory(slot.id);return b}));
}

const thumbRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});thumbRenderer.setSize(170,150);thumbRenderer.outputColorSpace=THREE.SRGBColorSpace;thumbRenderer.toneMapping=THREE.ACESFilmicToneMapping;
const thumbScene=new THREE.Scene();thumbScene.environment=environment;thumbScene.add(new THREE.HemisphereLight(0xe0eaff,0x343c46,2));const tk=new THREE.DirectionalLight(0xffffff,3);tk.position.set(2,3,4);thumbScene.add(tk);const tc=new THREE.PerspectiveCamera(34,170/150,.001,1000);
async function makeThumbnail(slot,option){
 const context=libraryContext,cacheKey=context+'|'+currentClass.id+'|'+slot+'|'+option.id;if(thumbCache.has(cacheKey))return thumbCache.get(cacheKey);
 const sourceClass=currentClass.id,record=await post('/api/part-preview',{classId:sourceClass,slotId:slot,optionId:option.id});if(record.empty||context!==libraryContext)return null;
 const gltf=await loader().loadAsync(record.url),group=gltf.scene;if(context!==libraryContext){dispose(group);return null}group.traverse(o=>{if(o.isMesh)eightInfluenceSkinning.prepareMesh(o)});group.updateMatrixWorld(true);
 const rotation=calibrations.get(sourceClass)?.rotation??-Math.PI/2;group.rotation.x=rotation;group.updateMatrixWorld(true);thumbScene.add(group);
 try{const box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z,.05);tc.position.copy(center).add(new THREE.Vector3(radius*.65,radius*.25,radius*2.1));tc.near=radius/1000;tc.far=radius*100;tc.updateProjectionMatrix();tc.lookAt(center);thumbRenderer.render(thumbScene,tc);const src=thumbRenderer.domElement.toDataURL('image/webp',.8);thumbCache.set(cacheKey,src);return src}
 finally{thumbScene.remove(group);dispose(group)}
}
let observer;
function showOptions(){
 const slot=currentSlot();if(!slot)return;const serial=++thumbSerial;observer?.disconnect();
 const query=$('part-search').value.trim().toLowerCase(),source=$('part-source').value;
 const filtered=slot.options.filter(o=>(usable(o)||o.forgeUnavailable)&&(!query||(optionLabel(o)+' '+(o.forgeAstartes?' Astartes ':' ')+o.id+' '+classLabel(o.sourceClassId||o.forgeCrossClass?.classId||currentClass.id)).toLowerCase().includes(query))&&(source==='all'||source==='astartes'&&!!o.forgeAstartes||source==='iron-hands'&&(o.tags?.includes('iron-hands')||/iron_hands|bionic/i.test(o.id))||source==='native'&&!o.forgeCrossClass));
 const rows=deduplicateOptionsByName(filtered,{selectedId:soldier().selection[slot.id]});
 const pageSize=12,totalPages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(page,totalPages-1);
 $('part-heading').textContent=slotLabel(slot.id,slot.label);$('part-count').textContent=rows.length+' variants';$('parts-page').textContent=(page+1)+' / '+totalPages;$('parts-prev').disabled=page===0;$('parts-next').disabled=page+1===totalPages;
 const cards=rows.slice(page*pageSize,(page+1)*pageSize).map(option=>{
  const b=document.createElement('button');b.type='button';b.className='part-card';b.setAttribute('aria-pressed',String(soldier().selection[slot.id]===option.id));b.dataset.optionId=option.id;const unavailable=!!option.forgeUnavailable;b.disabled=unavailable;if(unavailable)b.title=[option.unavailableReason||option.reason||'The source model is unavailable.',...(option.missingSelectors||[])].join('\n');
  const empty=!hasPartGeometry(option);const image=document.createElement('div');image.className='thumb-empty';image.textContent=unavailable?'Unavailable':empty?'NONE':'Load preview';b.append(image);
  const label=document.createElement('span');label.className='label';label.textContent=optionLabel(option);b.append(label);
  const origin=document.createElement('small');origin.textContent=(option.tags?.includes('iron-hands')?'IRON HANDS | ':'')+(option.forgeAstartes?'ASTARTES':classLabel(option.sourceClassId||option.forgeCrossClass?.classId||currentClass.id));if(unavailable){const note=document.createElement('small');note.textContent='Unavailable in source';b.append(note);}b.append(origin);
  b.onclick=async()=>{const previous=soldier().selection[slot.id],beforeAppearance=structuredClone(soldier().appearance);let cleared=false;soldier().selection[slot.id]=option.id;if(['LEFT_PAULDRON','RIGHT_PAULDRON'].includes(slot.id)&&soldier().appearance?.decals?.[slot.id]&&!heraldryCompatibility(option,slot.id).supported){delete soldier().appearance.decals[slot.id];cleared=true}for(const c of $('part-grid').children)c.setAttribute('aria-pressed',String(c===b));updateSelectionText();syncHeraldry();try{await loadModel();if(cleared)setStatus('The selected pauldron has no editable emblem area. Its painted emblem was cleared.');persist()}catch{soldier().selection[slot.id]=previous;soldier().appearance=beforeAppearance;showOptions();syncHeraldry()}};
  return{b,image,option,empty,unavailable};
 });
 $('part-grid').replaceChildren(...cards.map(c=>c.b));$('part-help').textContent=rows.length?'Independent left and right slots. Donor armour is adapted to the selected body frame.':'No matching armour. Try another source or clear the search.';
 observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const card=cards.find(c=>c.b===entry.target);if(!card||card.empty||card.unavailable)continue;thumbChain=thumbChain.then(async()=>{if(serial!==thumbSerial)return;try{card.image.textContent='Preparing...';const src=await makeThumbnail(slot.id,card.option);if(src&&serial===thumbSerial){const img=document.createElement('img');img.src=src;img.alt=optionLabel(card.option);card.image.replaceWith(img)}}catch{if(serial===thumbSerial)card.image.textContent='Select to inspect'}})}},{root:$('part-grid'),rootMargin:'30px'});for(const c of cards)observer.observe(c.b);
}
const heraldryGroups=['chapter','company'];
function syncHeraldry(){
 const available=heraldryOptions(catalog?.cosmetics?.decals||[]),messages=[];
 for(const name of heraldryGroups){
  const group=available[name],chosen=soldier().appearance?.decals?.[group.slot],slot=currentClass?.slots.find(s=>s.id===group.slot),compatibility=heraldryCompatibility(selectedOption(slot),name);
  const choices=[{id:'',label:'No emblem'},...group.options];
  if(chosen?.id&&!choices.some(d=>d.id===chosen.id)){const source=catalog?.cosmetics?.decals.find(d=>d.id===chosen.id);choices.push({id:chosen.id,label:'Existing emblem — '+(source?.label||chosen.id)})}
  $(name+'-choice').replaceChildren(...choices.map(d=>{const option=document.createElement('option');option.value=d.id;option.textContent=d.label;option.disabled=!!d.id&&!compatibility.supported&&d.id!==chosen?.id;return option}));
  $(name+'-choice').value=chosen?.id||'';$(name+'-choice').disabled=!catalog?.cosmetics?.ready||(!compatibility.supported&&!chosen);
  for(const [suffix,key]of[['color','color'],['secondary','secondaryColor'],['tertiary','tertiaryColor']]){const input=$(name+'-'+suffix);input.value=chosen?.[key]||chosen?.color||'#FFFFFF';input.disabled=!catalog?.cosmetics?.ready||!compatibility.supported}
  $(name+'-placement').textContent=(name==='chapter'?'Left pauldron':'Right pauldron · Iron Hands clan companies')+(compatibility.supported?'':' · '+compatibility.reason);
  if(!group.complete&&catalog?.cosmetics?.ready)messages.push('Some '+name+' emblems are missing from the selected library.');
 }
 $('decal-help').textContent=!catalog?.cosmetics?.ready?'Connect the included Iron Hands heraldry library.':messages.join(' ')||'Chapter stays on the left pauldron; Company stays on the right. Each emblem has independent colours.';
}
function changeHeraldry(name){
 const slot=name==='chapter'?'LEFT_PAULDRON':'RIGHT_PAULDRON',id=$(name+'-choice').value,existing=soldier().appearance?.decals?.[slot];
 const palette={color:$(name+'-color').value,secondaryColor:$(name+'-secondary').value,tertiaryColor:$(name+'-tertiary').value};
 try{
  const choices=heraldryOptions(catalog?.cosmetics?.decals||[])[name].options;
  if(id&&existing?.id===id&&!choices.some(d=>d.id===id)){appearance().decals[slot]={...existing,...palette}}
  else soldier().appearance=applyHeraldryChoice(soldier().appearance,name,id,palette,catalog?.cosmetics?.decals||[]);
  syncHeraldry();persist();schedulePreview();
 }catch(e){setStatus(e.message);syncHeraldry()}
}

function motionState(){return{gait:$('motion-gait').value,stance:$('walk-style').value,speedPct:Math.round(Number($('walk-speed').value)*100),inPlace:true}}
function restoreMotionControls(){const m=soldier().motion||{gait:'walk',stance:'unarmed',speedPct:100};$('motion-gait').value=m.gait;$('walk-style').value=m.stance;$('walk-speed').value=m.speedPct/100;$('walk-speed-label').value=m.speedPct/100+'x'}
async function setupWalk(serial=loadSerial){
 const request=++walkSerial;$('walk-play').disabled=true;$('walk-reset').disabled=true;$('walk-phase').disabled=true;
 if(!model||!classHasPreviewMotion(catalog.motionBindings,currentClass.id)){$('walk-play').textContent='Motion unavailable';return}
 const context=libraryContext,m=motionState(),cacheKey=context+'|'+currentClass.id+'|'+m.gait+'|'+m.stance+'|'+catalog.motionRevision;
 try{
  let data=walkCache.get(cacheKey);if(!data){const r=await fetch('/api/motion?'+new URLSearchParams({classId:currentClass.id,gait:m.gait,style:m.stance}));if(!r.ok)throw Error('The local motion clip is unavailable.');data=await r.json();if(context!==libraryContext)return;walkCache.set(cacheKey,data)}
  if(serial!==loadSerial||request!==walkSerial)return;
  const nodes=new Map();model.traverse(n=>{if(!nodes.has(n.name)||n.isBone)nodes.set(n.name,n)});const tracks=[];walkRest=[];walkData=data;
  for(const ch of filterServoMotionChannels(motionPreviewChannels(data,data.binding),model.userData.servoPoseApplied)){const target=nodes.get(ch.name)||nodes.get(THREE.PropertyBinding.sanitizeNodeName(ch.name));if(!target)continue;const p=ch.positions.flat(),q=ch.rotations.flat();if(!p.every(Number.isFinite)||!q.every(Number.isFinite))throw Error('Invalid motion keyframes');tracks.push(new THREE.VectorKeyframeTrack(target.uuid+'.position',data.times,p),new THREE.QuaternionKeyframeTrack(target.uuid+'.quaternion',data.times,q));walkRest.push({node:target,position:target.position.clone(),quaternion:target.quaternion.clone(),scale:target.scale.clone()})}
  if(tracks.length<100)throw Error('The skeleton does not match the motion clip.');if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model)}
  mixer=new THREE.AnimationMixer(model);mixer.timeScale=m.speedPct/100;walkAction=mixer.clipAction(new THREE.AnimationClip(data.clip,data.duration,tracks));walkAction.setLoop(THREE.LoopRepeat,Infinity);walkPlaying=false;
  $('walk-play').disabled=false;$('walk-reset').disabled=false;$('walk-phase').disabled=false;$('walk-phase').max=data.frameCount-1;$('walk-play').textContent=m.gait==='run'?'Play run':'Play walk';model.userData.walkEvidence={clip:data.clip,frames:data.frameCount,fps:data.fps,bones:walkRest.length};
 }catch(e){if(context!==libraryContext||request!==walkSerial)return;$('walk-play').textContent='Motion unavailable';setStatus(e.message)}
}
function resetWalk(){if(mixer)mixer.stopAllAction();walkPlaying=false;for(const r of walkRest){r.node.position.copy(r.position);r.node.quaternion.copy(r.quaternion);r.node.scale.copy(r.scale)}model?.updateMatrixWorld(true);$('walk-phase').value=0;$('walk-phase-label').value='-';$('walk-play').textContent=$('motion-gait').value==='run'?'Play run':'Play walk';dirty=true}
function updatePhaseLabel(){if(!walkAction||!walkData)return;const f=Math.round(walkAction.time/walkData.duration*(walkData.frameCount-1));$('walk-phase').value=f;$('walk-phase-label').value=f+'/'+(walkData.frameCount-1)}
controls.addEventListener('change',()=>dirty=true);new ResizeObserver(()=>{const r=$('stage').getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();dirty=true}).observe($('stage'));
renderer.setAnimationLoop(()=>{const now=performance.now(),delta=Math.min((now-lastFrame)/1000,.05);lastFrame=now;if(document.hidden)return;if(walkPlaying&&mixer){mixer.update(delta);updatePhaseLabel();dirty=true}if($('spin').checked&&model){model.rotation.y+=.003;dirty=true}controls.update();if(dirty){renderer.render(scene,camera);dirty=false}});
$('front').onclick=()=>{camera.position.set(0,1.5,6.7);controls.target.set(0,1.35,0);controls.update();dirty=true};$('back').onclick=()=>{camera.position.set(0,1.5,-6.7);controls.target.set(0,1.35,0);controls.update();dirty=true};$('fit').onclick=fitView;$('focus').onclick=focusPart;$('isolate').onchange=updateVisibility;$('wireframe').onchange=updatePaint;$('body-class').onchange=()=>{page=0;$('part-search').value='';resetWalk();chooseClass($('body-class').value,{resetCamera:true,applyTemplate:true}).catch(e=>setStatus(e.message))};
$('part-search').oninput=()=>{page=0;showOptions()};$('part-source').onchange=()=>{page=0;showOptions()};$('parts-prev').onclick=()=>{page--;showOptions()};$('parts-next').onclick=()=>{page++;showOptions()};
$('unit-name').onchange=()=>{soldier().role=$('unit-name').value.trim()||'Iron Hands marine';persist()};
$('walk-play').onclick=()=>{if(!walkAction)return;walkPlaying=!walkPlaying;if(walkPlaying){walkAction.play();walkAction.paused=false}else walkAction.paused=true;$('walk-play').textContent=walkPlaying?'Pause':$('motion-gait').value==='run'?'Play run':'Play walk';soldier().motion=motionState();persist()};
$('walk-reset').onclick=resetWalk;for(const id of ['motion-gait','walk-style'])$(id).onchange=async()=>{resetWalk();soldier().motion=motionState();await setupWalk();persist()};$('walk-speed').oninput=()=>{if(mixer)mixer.timeScale=Number($('walk-speed').value);$('walk-speed-label').value=$('walk-speed').value+'x';soldier().motion=motionState();persist()};
$('walk-phase').oninput=()=>{if(!walkAction||!mixer)return;walkPlaying=false;walkAction.play();walkAction.paused=false;mixer.setTime(Number($('walk-phase').value)/walkData.fps/Math.max(mixer.timeScale,.01));walkAction.paused=true;$('walk-phase-label').value=$('walk-phase').value+'/'+(walkData.frameCount-1);dirty=true};
for(const[id,k]of[['armor-color','armor'],['metal-color','metal'],['lens-color','lenses']])$(id).oninput=()=>{soldier().paint[k]=$(id).value;updatePaint();persist()};
for(const[id,k]of[['trim-color','trim'],['cloth-color','cloth'],['beard-color','beard']])$(id).oninput=()=>{(appearance().colors??={})[k]=$(id).value;updatePaint();persist()};
$('finish-metallic').onchange=()=>{(appearance().finish??={}).metallic=$('finish-metallic').checked;updatePaint();persist()};$('finish-roughness').oninput=()=>{(appearance().finish??={}).roughness=Number($('finish-roughness').value);updatePaint();persist()};
for(const id of ['part-color','part-trim-color','part-metallic'])$(id).oninput=()=>{const p=(appearance().parts??={})[category]??={};if(id==='part-color'){p.armor=$(id).value;p.cloth=$(id).value}else if(id==='part-trim-color')p.trim=$(id).value;else p.metallic=$(id).checked;updatePaint();persist()};
$('part-paint-reset').onclick=()=>{if(appearance().parts)delete appearance().parts[category];updatePaint();persist()};
for(const name of heraldryGroups)for(const suffix of ['choice','color','secondary','tertiary'])$(name+'-'+suffix).onchange=()=>changeHeraldry(name);
$('save-roster').onclick=async()=>{try{soldier().motion=motionState();await post('/api/save',{soldiers});setStatus('Marine saved. Transfer build preserves armour, paint, emblems and motion.')}catch(e){setStatus(e.message)}};$('refresh-catalog').onclick=async()=>{try{await refreshCatalog();await chooseClass(soldier().classId)}catch(e){setStatus(e.message)}};
attachForgeTools({getSoldiers:()=>soldiers,getActive:()=>0,getCatalog:()=>catalog||{armor:{classes:[]},manifest:{assets:[]},configured:false},getMotion:motionState,singleWorkspace:true,async reloadCatalog(){await refreshCatalog();await chooseClass(soldier().classId)},async importRecipe(r){soldiers=[structuredClone(r.soldiers[0])];restoreMotionControls();showSoldiers();resetWalk();await chooseClass(soldier().classId,{resetCamera:true});persist();if(r.soldiers.length>1)setStatus('The first marine was opened from the legacy squad code. The original code is unchanged.')}});
if(QA){const controlsHost=document.createElement('div');controlsHost.id='qa-inspector';controlsHost.innerHTML='<button id="inspect-pose">Inspect pose</button><pre id="inspect-result"></pre>';$('stage').after(controlsHost);$('inspect-pose').onclick=()=>{
 model?.updateMatrixWorld(true);
 const rows=allMeshes(model).filter(m=>m.visible).map(m=>{m.skeleton?.update();if(m.isSkinnedMesh)m.computeBoundingBox();const box=new THREE.Box3().setFromObject(m);let source=m;while(source.parent&&!Number.isSafeInteger(source.userData.sourceObjectId))source=source.parent;return{name:m.name,source:source.userData.source_name||source.userData.sourceName||m.name,objectId:source.userData.sourceObjectId,slot:m.userData.forgeSlot||source.userData.forgeSlot,vertices:m.geometry.attributes.position.count,bounds:box.getSize(new THREE.Vector3()).toArray(),min:box.min.toArray(),max:box.max.toArray(),influences:m.geometry.attributes.skinIndex1?8:4}});
 $('inspect-result').textContent=JSON.stringify({classId:currentClass?.id,selected:soldier().selection,appearance:soldier().appearance,visibleObjectIds:[...new Set(rows.map(r=>r.objectId).filter(Number.isSafeInteger))],meshes:rows.length,vertices:rows.reduce((n,m)=>n+m.vertices,0),sourceVersion:5,entries:rows,frame:walkAction&&walkData?Math.round(walkAction.time*walkData.fps):0,walk:model?.userData.walkEvidence});
};}
try{const saved=await post('/api/workspace/single',{});if(saved?.soldiers?.length)soldiers=[saved.soldiers[0]];showSoldiers();restoreMotionControls();await refreshCatalog();await chooseClass(soldier().classId,{resetCamera:true})}catch(e){console.error(e);$('loading').textContent=e.message;setStatus(e.message)}
