import {classLabel,slotLabel,optionLabel,roleLabel} from '/shared/ui-labels.mjs';
import {motionPreviewChannels,classHasPreviewMotion} from '/shared/motion-policy.mjs';
import {createEightInfluenceSkinning} from '/shared/eight-influence-skinning.mjs';
import {attachForgeTools} from './forge-tools.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const eightInfluenceSkinning=createEightInfluenceSkinning(THREE);
const $=id=>document.getElementById(id), roles=['Sergeant','Rifleman','Comms specialist','Assault','Veteran'];
const QA=new URLSearchParams(location.search).get('inspect')==='1';
if(new URLSearchParams(location.search).has('qa'))history.replaceState(null,'',location.pathname);
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(32,1,.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
$('stage').append(renderer.domElement);
const environment=new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(),.04).texture;
scene.environment=environment;
scene.add(new THREE.HemisphereLight(0xd5e7ff,0x1c2530,2));
const key=new THREE.DirectionalLight(0xf2f5ff,3.3);key.position.set(-3,6,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);scene.add(key);
const rim=new THREE.DirectionalLight(0xb3d0f0,2.5);rim.position.set(2,3,-4);scene.add(rim);
const floor=new THREE.Mesh(new THREE.CircleGeometry(3,80),new THREE.MeshStandardMaterial({color:0x1f2a35,roughness:.68,metalness:.15}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.018;floor.receiveShadow=true;scene.add(floor);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.target.set(0,1.35,0);controls.minDistance=.4;controls.maxDistance=14;
let dirty=true,model=null,meshMap=new Map(),groupMap=new Map(),objectMeshMap=new Map(),catalog=null,classes=[],currentClass=null,category='HELMET',active=0,loadSerial=0,thumbSerial=0;
let mixer=null,walkAction=null,walkPlaying=false,walkRest=[],walkSerial=0,walkData=null,lastFrame=performance.now();
const walkCache=new Map();
const thumbCache=new Map();
let soldiers=roles.map((role,i)=>({id:`IH-${i+1}`,role,classId:'PVE_PVP_SOLDIER',selection:{},paint:{armor:'#171b22',metal:'#b3bdc9',lenses:'#ee291c'}}));
try{const saved=await fetch('/api/roster',{cache:'no-store'}).then(r=>r.json());if(Array.isArray(saved?.soldiers)&&saved.soldiers.length>0&&saved.soldiers.length<=20)soldiers=saved.soldiers}catch{}
const soldier=()=>soldiers[active];
let draftTimer;const persist=()=>{if(QA)return;clearTimeout(draftTimer);draftTimer=setTimeout(()=>fetch('/api/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema:'medusa-draft-roster-v2',soldiers})}).catch(()=>{}),300)};
controls.addEventListener('change',()=>dirty=true);
new ResizeObserver(()=>{const r=$('stage').getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();dirty=true}).observe($('stage'));
renderer.setAnimationLoop(()=>{const now=performance.now(),delta=Math.min((now-lastFrame)/1000,.05);lastFrame=now;if(document.hidden)return;if(walkPlaying&&mixer){mixer.update(delta);updatePhaseLabel();dirty=true}if($('spin').checked&&model){model.rotation.y+=.003;dirty=true}controls.update();if(dirty){renderer.render(scene,camera);dirty=false}});

const thumbRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
thumbRenderer.setSize(168,168);thumbRenderer.outputColorSpace=THREE.SRGBColorSpace;thumbRenderer.toneMapping=THREE.ACESFilmicToneMapping;
const thumbScene=new THREE.Scene();thumbScene.environment=environment;thumbScene.add(new THREE.HemisphereLight(0xe0eaff,0x343c46,2));
const tk=new THREE.DirectionalLight(0xffffff,3);tk.position.set(2,3,4);thumbScene.add(tk);
const tc=new THREE.PerspectiveCamera(34,1,.001,1000);

function setStatus(message){$('status').textContent=message}
function technical(mesh){const name=mesh.userData.sourceName||mesh.name;return /_cdt$|_SIM$|^rb_|^material_|^Icosphere$|_decal$/.test(name)}
function allMeshes(node){const list=[];node.traverse(c=>{if(c.isMesh&&!technical(c))list.push(c)});return list}
function resolve(names){const set=new Set();for(const name of names||[]){const direct=meshMap.get(name);if(direct)set.add(direct);for(const item of groupMap.get(name)||[])set.add(item)}return [...set]}
function optionMeshes(option){if(!currentClass?.isNative&&Array.isArray(option.resolvedObjectIds))return [...new Set(option.resolvedObjectIds.flatMap(id=>objectMeshMap.get(id)||[]))];return resolve(option.meshes)}
function usable(option,slotId=category){if(option.equipmentActorMeshes?.length&&!option.meshes?.length)return false;if(!option.meshes?.length)return true;const meshes=optionMeshes(option);if(!meshes.length)return false;if(slotId==='HELMET')return meshes.some(m=>/helmet|head/.test(m.userData.sourceName||m.name)&&!/lenses|glass|vanity|hair/.test(m.userData.sourceName||m.name));return true}
function selectedOption(slot){return slot.options.find(o=>o.id===soldier().selection[slot.id])}
function currentSlot(){return currentClass?.slots.find(s=>s.id===category)}

function showSoldiers(){
  $('soldiers').replaceChildren(...soldiers.map((s,i)=>{const b=document.createElement('button');b.type='button';b.textContent=roleLabel(s.role);b.setAttribute('aria-pressed',i===active);b.onclick=async()=>{resetWalk();active=i;restoreMotionControls();showSoldiers();await chooseClass(s.classId);await setupWalk()};return b}));
}
async function refreshCatalog(){
  catalog=await fetch('/api/catalog',{cache:'no-store'}).then(r=>r.json());
  const exported=new Map((catalog.manifest.assets||[]).filter(a=>a.transformValidation==='passed').map(a=>[a.asset,a]));
  classes=(catalog.armor.classes||[]).filter(c=>c.available).map(c=>({...c,modelAvailable:exported.has(c.tpl),isNative:false,sourceVersion:exported.get(c.tpl)?.sourceVersion||2,assetRevision:exported.get(c.tpl)?.assetRevision||'',motionAvailable:classHasPreviewMotion(catalog.motionBindings,c.id)}));
  $('body-class').replaceChildren(...classes.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=classLabel(c.id,c.label)+(c.modelAvailable?'':c.tpl==='cc_sm_constructor_engineer'?' · not yet supported':' · model not ready');o.disabled=!c.modelAvailable;return o}));
  $('body-class').disabled=false;
  const total=(catalog.armor.classes||[]).reduce((n,c)=>n+c.slots.reduce((s,slot)=>s+slot.options.length,0),0);
  $('catalog-info').textContent=`Game registry: ${total} equipment variants. Classes with models: ${classes.filter(c=>c.modelAvailable).length}.`;
  return classes;
}

function materialFor(original,meshName){
  const name=original?.name||'';const lower=(name+' '+meshName).toLowerCase();
  let role='armor',color=soldier().paint.armor,metalness=.12,roughness=.48,opacity=1;
  if(/undersuit|rubber/.test(lower)){role='rubber';color='#101215';metalness=0;roughness=.78}
  else if(/tabard|cloth|seal|rope|hair/.test(lower)){role='cloth';color='#51483c';metalness=0;roughness=.85}
  else if(/bag|belt|leather/.test(lower)){role='leather';color='#372e28';metalness=0;roughness=.7}
  else if(/lenses|optic/.test(lower)){role='lenses';color=soldier().paint.lenses;metalness=.1;roughness=.2}
  else if(/glass/.test(lower)){role='glass';color='#18232c';opacity=.18;roughness=.12}
  else if(/preview_steel|soldier_arm_r_02|soldier_hand_l_01/.test(lower)){role='metal';color=soldier().paint.metal;metalness=.85;roughness=.34}
  else if(/head_|skin|eye_/.test(lower)&&!/helmet/.test(lower)){role='skin';color='#a18a79';metalness=0;roughness=.7}
  const mat=new THREE.MeshStandardMaterial({name, color,metalness,roughness,transparent:opacity<1,opacity,depthWrite:opacity===1,side:THREE.FrontSide,vertexColors:false});
  mat.userData.role=role;if(role==='lenses'){mat.emissive.set(color);mat.emissiveIntensity=1.3}return mat;
}
function updatePaint(){
  const paint=soldier().paint;
  model?.traverse(mesh=>{if(!mesh.isMesh)return;for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
    const role=mat.userData.role;if(role==='armor')mat.color.set(paint.armor);if(role==='metal')mat.color.set(paint.metal);if(role==='lenses'){mat.color.set(paint.lenses);mat.emissive.set(paint.lenses)}
  }});
  for(const [id,key]of [['armor-color','armor'],['metal-color','metal'],['lens-color','lenses']])$(id).value=paint[key];
  dirty=true;
}

async function chooseClass(classId){
  const selected=classes.find(c=>c.id===classId&&c.modelAvailable)||classes.find(c=>c.modelAvailable);
  if(!selected){$('loading').hidden=false;$('loading').textContent='The armour library is unavailable. Extract the complete application folder and restart.';setStatus('The included armour library could not be loaded.');return}const requested=classes.find(c=>c.id===classId);if(requested&&!requested.modelAvailable){$('body-class').value=requested.id;$('loading').hidden=false;$('loading').textContent='This model requires additional rig validation or local preparation.';$('walk-play').disabled=true;setStatus('Your saved selection is preserved. Choose an available character while this model is unavailable.');return}currentClass=selected;$('body-class').value=selected.id;soldier().classId=selected.id;
  const serial=++loadSerial;
  const url=selected.isNative?catalog.native.url:`/${selected.sourceVersion>=3?'retail-v'+selected.sourceVersion:'retail'}/${selected.tpl}.glb`;
  const assetKey=(catalog.dataRoot||'')+'|'+(catalog.registryFingerprint||'')+'|'+selected.assetRevision+'|'+url;
  if(model?.userData.assetURL===assetKey){$('loading').hidden=true;ensureSelection(selected);applySelection();updatePaint();showCategories();showOptions();persist();if(!mixer)await setupWalk(serial);return}
  $('loading').hidden=false;$('loading').textContent=`Loading: ${classLabel(selected.id,selected.label)}…`;
  $('part-grid').replaceChildren();
  try{
    // The retail export names DDS resources that are not part of this geometry
    // preview. Keep material names, without requesting hundreds of absent files.
    const loader=new GLTFLoader().register(eightInfluenceSkinning.loaderPlugin).register(parser=>({name:'MEDUSA_PREVIEW_MATERIALS',loadMaterial(index){return Promise.resolve(new THREE.MeshStandardMaterial({name:parser.json.materials?.[index]?.name||''}))}}));
    const gltf=await loader.loadAsync(url,event=>{if(serial===loadSerial&&event.total)$('loading').textContent=`${classLabel(selected.id,selected.label)}: ${Math.round(event.loaded/event.total*100)}%`});
    if(serial!==loadSerial)return;
    if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model);mixer=null;walkAction=null;walkPlaying=false;walkRest=[]}
    if(model){scene.remove(model);model.traverse(o=>{if(o.isMesh){eightInfluenceSkinning.disposeMesh(o);o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})}
    model=gltf.scene;model.updateMatrixWorld(true);meshMap=new Map();groupMap=new Map();objectMeshMap=new Map();thumbCache.clear();
    model.userData.assetURL=assetKey;
    // Canonical V3/V4 keep the game's corrected bind matrices unchanged.
    // Only the older preview fallback needs a rest-pose rebind.
    const skeletons=new Set();model.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton)});
    if(selected.sourceVersion<3)for(const skeleton of skeletons)skeleton.calculateInverses();
    model.traverse(o=>{if(o.isSkinnedMesh){if(selected.sourceVersion<3)o.bind(o.skeleton,o.matrixWorld.clone());if(o.userData.forgeSkinInfluences!==8)o.normalizeSkinWeights();o.frustumCulled=false}});
    model.traverse(node=>{if(node.userData.source_name)node.traverse(c=>{if(c.isMesh)c.userData.sourceName=node.userData.source_name})});
    const sourceMeshes=new Map();
    model.traverse(o=>{if(o.isMesh){const association=gltf.parser.associations.get(o),source=gltf.parser.json.meshes?.[association?.meshes]?.name;const original=o.userData.sourceName||source||o.name;o.userData.sourceName=original;o.material=(Array.isArray(o.material)?o.material:[o.material]).map(m=>materialFor(m,original));if(o.material.length===1)o.material=o.material[0];eightInfluenceSkinning.prepareMesh(o);o.castShadow=true;o.receiveShadow=true;o.visible=false;if(!technical(o)){meshMap.set(original,o);meshMap.set(o.name,o);if(!sourceMeshes.has(original))sourceMeshes.set(original,[]);sourceMeshes.get(original).push(o)}}});
    model.traverse(o=>{if(!o.isMesh){const descendants=allMeshes(o);if(descendants.length)groupMap.set(o.name,descendants)}});
    for(const [name,meshes]of sourceMeshes)groupMap.set(name,meshes);
    if(selected.isNative)for(const part of catalog.native.parts){if(part.parent){const children=resolve([part.id]);if(!groupMap.has(part.parent))groupMap.set(part.parent,[]);groupMap.get(part.parent).push(...children)}}
    else{
      const metadata=await fetch(`/${selected.sourceVersion>=3?'retail-v'+selected.sourceVersion:'retail'}/${selected.tpl}.json`,{cache:'no-store'}).then(r=>r.json());
      if(serial!==loadSerial)return;
      const objects=new Map((metadata.objectMetadata||[]).map(o=>[o.id,o]));
      const objectMeshes=new Map();
      const meshNodes=[];model.traverse(node=>{if(node.isMesh&&!technical(node))meshNodes.push(node)});
      // Assimp flattens the graphics tree. Rebuild the game's ancestry from the
      // source graph instead of treating glTF root children as clothing groups.
      model.traverse(mesh=>{
        if(!mesh.isMesh)return;
        const index=gltf.parser.associations.get(mesh)?.meshes,record=metadata.meshes?.[index];
        if(!record)return;mesh.userData.sourceObjectId=record.objectId;
        if(technical(mesh))return;
        if(!objectMeshes.has(record.objectId))objectMeshes.set(record.objectId,[]);
        objectMeshes.get(record.objectId).push(mesh);
      });
      objectMeshMap=objectMeshes;
      const descendants=new Map();
      for(const [id,meshes]of objectMeshes){let object=objects.get(id);const visited=new Set();while(object&&!visited.has(object.id)){visited.add(object.id);if(!descendants.has(object.id))descendants.set(object.id,new Set());for(const mesh of meshes)descendants.get(object.id).add(mesh);object=objects.get(object.parentId)}}
      for(const object of objects.values()){const found=descendants.get(object.id);if(found?.size)for(const alias of [object.name,object.fullPath,object.readName,object.readOnlyName].filter(Boolean))groupMap.set(alias,[...found])}
    }
    scene.add(model);
    ensureSelection(selected);
    category=selected.slots.some(s=>s.id===category)?category:selected.slots[0].id;
    applySelection();
    // Normalize preview scale and up axis; production data stays untouched.
    let box=visibleBox();const size=box.getSize(new THREE.Vector3());
    if(size.z>size.y*1.5){model.rotation.x=-Math.PI/2;model.updateMatrixWorld(true);box=visibleBox()}
    const height=box.max.y-box.min.y;if(height>0)model.scale.multiplyScalar(2.7/height);
    model.updateMatrixWorld(true);box=visibleBox();const center=box.getCenter(new THREE.Vector3());model.position.x-=center.x;model.position.y-=box.min.y;model.position.z-=center.z;model.updateMatrixWorld(true);
    updatePaint();showCategories();showOptions();fitView();persist();await setupWalk(serial);
    setStatus('Selecting a part updates the model immediately. Materials are previews; game textures and emblems need separate work.');
  }catch(error){console.error(error);setStatus(`Could not open the model: ${error.message}`)}finally{if(serial===loadSerial)$('loading').hidden=true}
}

function ensureSelection(selected){
  for(const slot of selected.slots){let id=soldier().selection[slot.id];if(slot.options.some(o=>o.id===id))continue;if(!slot.options.some(o=>o.id===id&&usable(o,slot.id))){const preferred=slot.options.find(o=>o.id===selected.initialSelection?.[slot.id]&&usable(o,slot.id));const fallback=slot.options.find(o=>usable(o,slot.id));id=(preferred||fallback)?.id;if(slot.id==='HELMET'){const closed=slot.options.find(o=>/helmet_.*common_01$/.test(o.id)&&usable(o,slot.id));if(closed)id=closed.id}if(id)soldier().selection[slot.id]=id}}
}

async function setupWalk(serial=loadSerial){
  const request=++walkSerial;
  $('walk-play').disabled=true;$('walk-reset').disabled=true;$('walk-phase').disabled=true;
  if(!model||!currentClass?.motionAvailable){$('walk-play').textContent='Motion unavailable';return}
  const style=$('walk-style').value,gait=$('motion-gait').value,key=(catalog.dataRoot||'')+'|'+(catalog.motionRevision||'')+'|'+currentClass.id+'|'+gait+':'+style;
  try{
    let data=walkCache.get(key);if(!data){const response=await fetch(`/api/motion?classId=${encodeURIComponent(currentClass.id)}&gait=${gait}&style=${style}`,{cache:'no-store'});if(!response.ok)throw Error('The motion clip is not available yet');data=await response.json();walkCache.set(key,data)}
    if(serial!==loadSerial||request!==walkSerial)return;
    const nodes=new Map();model.traverse(n=>{if(!nodes.has(n.name)||n.isBone)nodes.set(n.name,n)});
    const tracks=[];walkRest=[];walkData=data;
    for(const channel of motionPreviewChannels(data,data.binding)){const target=nodes.get(channel.name)||nodes.get(THREE.PropertyBinding.sanitizeNodeName(channel.name));if(!target)continue;
      const positions=channel.positions.flat(),rotations=channel.rotations.flat();if(!positions.every(Number.isFinite)||!rotations.every(Number.isFinite))throw Error('Invalid motion keyframes');
      tracks.push(new THREE.VectorKeyframeTrack(target.uuid+'.position',data.times,positions));tracks.push(new THREE.QuaternionKeyframeTrack(target.uuid+'.quaternion',data.times,rotations));
      walkRest.push({node:target,position:target.position.clone(),quaternion:target.quaternion.clone(),scale:target.scale.clone()});
    }
    if(tracks.length<100)throw Error('The skeleton does not match the motion clip');
    if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model)}
    mixer=new THREE.AnimationMixer(model);mixer.timeScale=Number($('walk-speed').value);
    const clip=new THREE.AnimationClip(data.clip,data.duration,tracks);walkAction=mixer.clipAction(clip);walkAction.setLoop(THREE.LoopRepeat,Infinity);walkPlaying=false;
    $('walk-play').disabled=false;$('walk-play').textContent=$('motion-gait').value==='run'?'Play run':'Play walk';$('walk-reset').disabled=false;$('walk-phase').disabled=false;$('walk-phase').max=data.frameCount-1;
    model.userData.walkEvidence={clip:data.clip,sourceSha256:data.sourceSha256,bones:walkRest.length,fps:data.fps,frames:data.frameCount};
  }catch(error){$('walk-play').textContent='Motion unavailable';setStatus(error.message)}
}
function resetWalk(){if(mixer)mixer.stopAllAction();walkPlaying=false;for(const rest of walkRest){rest.node.position.copy(rest.position);rest.node.quaternion.copy(rest.quaternion);rest.node.scale.copy(rest.scale)}model?.updateMatrixWorld(true);$('walk-phase').value=0;$('walk-phase-label').value='—';$('walk-play').textContent=$('motion-gait').value==='run'?'Play run':'Play walk';dirty=true}

function visibleBox(){const box=new THREE.Box3();model?.traverse(o=>{if(o.isMesh&&o.visible)box.union(new THREE.Box3().setFromObject(o))});return box}
function fitView(){controls.target.set(0,1.35,0);camera.position.set(3.2,2.55,6.4);controls.update();dirty=true}
function applySelection(){
  const visible=new Set(resolve(currentClass.baseMeshes||[]));
  for(const slot of currentClass.slots){const option=selectedOption(slot);if(option)for(const mesh of optionMeshes(option))visible.add(mesh)}
  // Aliases may collide across material primitives. Visit every mesh so a
  // primitive cannot disappear merely because another one shares its name.
  model.traverse(mesh=>{if(mesh.isMesh)mesh.visible=visible.has(mesh)});
  model.updateMatrixWorld(true);dirty=true;
  const slot=currentSlot(),option=slot&&selectedOption(slot);$('selection').textContent=option?`${slotLabel(slot.id,slot.label)}: ${optionLabel(option)}`:'';
}
function showCategories(){
  $('categories').replaceChildren(...currentClass.slots.map(slot=>{const b=document.createElement('button');b.type='button';b.textContent=slotLabel(slot.id,slot.label);b.setAttribute('aria-pressed',slot.id===category);b.onclick=()=>{category=slot.id;$('part-search').value='';showCategories();showOptions();applySelection()};return b}));
}
function thumbnail(option){
  const key=currentClass.id+'/'+category+'/'+option.id;if(thumbCache.has(key))return thumbCache.get(key);
  const meshes=optionMeshes(option);if(!meshes.length)return null;
  const group=new THREE.Group();
  for(const mesh of meshes){
    // A static preview snapshot of the exact selected geometry.
    let geometry=mesh.geometry;
    if(mesh.isSkinnedMesh){geometry=geometry.clone();const attribute=geometry.getAttribute('position'),v=new THREE.Vector3();for(let i=0;i<attribute.count;i++){mesh.getVertexPosition(i,v);attribute.setXYZ(i,v.x,v.y,v.z)}geometry.computeVertexNormals();geometry.userData.previewClone=true}
    const copy=new THREE.Mesh(geometry,mesh.material);copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);group.add(copy);
  }
  thumbScene.add(group);group.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const radius=Math.max(size.x,size.y,size.z,.05);tc.position.copy(center).add(new THREE.Vector3(radius*.7,radius*.35,radius*2.15));tc.near=radius/1000;tc.far=radius*100;tc.updateProjectionMatrix();tc.lookAt(center);
  thumbRenderer.render(thumbScene,tc);const image=thumbRenderer.domElement.toDataURL('image/webp',.82);
  thumbScene.remove(group);group.traverse(o=>{if(o.isMesh&&o.geometry.userData.previewClone)o.geometry.dispose()});thumbCache.set(key,image);return image;
}
async function showOptions(){
  const serial=++thumbSerial,slot=currentSlot();if(!slot)return;
  $('part-heading').textContent=slotLabel(slot.id,slot.label);
  const query=$('part-search').value.trim().toLowerCase();
  const options=slot.options.filter(o=>!query||optionLabel(o).toLowerCase().includes(query)||o.id.toLowerCase().includes(query)).sort((a,b)=>Number(usable(b))-Number(usable(a)));
  const available=slot.options.filter(o=>usable(o)).length;$('part-count').textContent=`${available} / ${slot.options.length}`;
  $('part-help').textContent=available<slot.options.length?'This is the game registry. External equipment and variants without geometry are listed but unavailable for preview.':'All listed variants are available for preview.';
  const cards=options.map(option=>{
    const button=document.createElement('button');button.type='button';button.className='part-card';button.setAttribute('aria-pressed',soldier().selection[slot.id]===option.id);button.disabled=!usable(option);
    const image=document.createElement('div');image.className='thumb-empty';image.textContent=option.equipmentActorMeshes?.length&&!option.meshes?.length?'Separate equipment model':!usable(option)?'Geometry unavailable':!option.meshes?.length?'None':'Preview…';button.append(image);
    const label=document.createElement('span');label.className='label';label.textContent=optionLabel(option);
    if(option.shared){const small=document.createElement('small');small.textContent='Shared equipment';label.append(small)}button.append(label);
    button.onclick=()=>{soldier().selection[slot.id]=option.id;applySelection();persist();for(const card of $('part-grid').children)card.setAttribute('aria-pressed',card===button);setStatus(`${slotLabel(slot.id,slot.label)}: ${optionLabel(option)}. Model updated.`)};
    return {button,image,option};
  });
  $('part-grid').replaceChildren(...cards.map(c=>c.button));
  for(let i=0;i<cards.length;i++){
    if(serial!==thumbSerial)return;const {button,image,option}=cards[i];
    if(usable(option)&&option.meshes?.length){const src=thumbnail(option);if(src){const img=document.createElement('img');img.src=src;img.alt=`${slotLabel(slot.id,slot.label)}: ${optionLabel(option)}`;image.replaceWith(img)}}
    if(i%2===1)await new Promise(requestAnimationFrame);
  }
}

$('body-class').onchange=()=>{soldier().selection={};chooseClass($('body-class').value)};
$('part-search').oninput=showOptions;
$('front').onclick=()=>{camera.position.set(0,1.5,6.8);controls.target.set(0,1.35,0);controls.update();dirty=true};
$('back').onclick=()=>{camera.position.set(0,1.6,-6.8);controls.target.set(0,1.35,0);controls.update();dirty=true};
$('fit').onclick=fitView;
$('walk-play').onclick=()=>{if(!walkAction)return;if(walkPlaying){walkAction.paused=true;walkPlaying=false;$('walk-play').textContent='Resume'}else{if(!walkAction.isRunning()&&!walkAction.paused)walkAction.reset().play();walkAction.paused=false;walkPlaying=true;$('walk-play').textContent='Pause';setStatus('Game animation preview: '+($('motion-gait').value==='run'?'run':'walk')+' in place. You can change armour while it moves.')}dirty=true};
$('walk-reset').onclick=resetWalk;

function updatePhaseLabel(){if(!walkAction||!walkData)return;const frame=Math.round(walkAction.time/walkData.duration*(walkData.frameCount-1));$('walk-phase').value=frame;$('walk-phase-label').value=frame+'/'+(walkData.frameCount-1)}
$('walk-phase').oninput=()=>{if(!walkAction||!walkData)return;const frame=Number($('walk-phase').value);walkAction.reset().play();walkAction.paused=true;walkAction.time=walkData.times[frame];mixer.update(0);walkPlaying=false;model.updateMatrixWorld(true);$('walk-play').textContent='Resume';updatePhaseLabel();dirty=true};
if(QA){
 const inspectButton=document.createElement('button'),inspectOutput=document.createElement('pre');
 inspectButton.textContent='Inspect current pose';inspectButton.id='inspect-pose';inspectOutput.id='inspect-result';inspectOutput.style.cssText='max-height:180px;overflow:auto;font-size:10px;white-space:pre-wrap';
 document.querySelector('.studio').append(inspectButton,inspectOutput);
 inspectButton.onclick=()=>{
  model.updateMatrixWorld(true);model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update()});
  const inverseRoot=model.matrixWorld.clone().invert(),expected=new Set(resolve(currentClass.baseMeshes||[]).map(o=>o.userData.sourceName));
  for(const slot of currentClass.slots){const option=selectedOption(slot);if(option)for(const name of option.resolvedMeshes||option.meshes||[])expected.add(name)}
  const entries=[],visibleSources=new Set(),visibleIds=new Set(),skipped=new Set();let total=0;
  model.traverse(mesh=>{if(!mesh.isMesh)return;const source=mesh.userData.sourceName||mesh.name;if(!mesh.visible){if(expected.has(source)&&technical(mesh))skipped.add(source);return}visibleSources.add(source);visibleIds.add(mesh.userData.sourceObjectId);
   const bounds=new THREE.Box3(),v=new THREE.Vector3(),count=mesh.geometry.getAttribute('position').count;
   for(let i=0;i<count;i++){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);bounds.expandByPoint(v)}total+=count;
   entries.push({node:mesh.name,source,objectId:mesh.userData.sourceObjectId,skin:mesh.isSkinnedMesh,vertices:count,min:bounds.min.toArray(),max:bounds.max.toArray()});
  });
  const missing=[...expected].filter(n=>!visibleSources.has(n)&&!skipped.has(n));
  inspectOutput.textContent=JSON.stringify({sourceVersion:currentClass.sourceVersion,clip:walkData?.clip,frame:walkAction&&walkData?walkAction.time*walkData.fps:null,selected:soldier().selection,vertices:total,meshes:entries.length,visibleObjectIds:[...visibleIds],missingRequiredNames:missing,excludedDecalsOrProxies:[...skipped],entries},null,2);
 };
}

function restoreMotionControls(){const m=soldier().motion||{gait:'walk',stance:'unarmed',speedPct:100};$('motion-gait').value=m.gait;$('walk-style').value=m.stance;$('walk-speed').value=m.speedPct/100;$('walk-speed-label').value=(m.speedPct/100)+'×'}
const motionState=()=>({gait:$('motion-gait').value,stance:$('walk-style').value,speedPct:Math.round(Number($('walk-speed').value)*100),inPlace:true});
const changeMotion=async()=>{resetWalk();soldier().motion=motionState();persist();await setupWalk()};
$('walk-style').onchange=changeMotion;$('motion-gait').onchange=changeMotion;
$('walk-speed').oninput=()=>{const speed=Number($('walk-speed').value);$('walk-speed-label').value=speed.toFixed(1).replace('.0','')+'×';if(mixer)mixer.timeScale=speed;soldier().motion=motionState();persist()};
$('focus').onclick=()=>{const option=selectedOption(currentSlot());const meshes=option?optionMeshes(option):[];if(!meshes.length)return;const box=new THREE.Box3();for(const mesh of meshes)box.union(new THREE.Box3().setFromObject(mesh));const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),distance=Math.max(size.x,size.y,size.z)*2.4;controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(distance*.3,distance*.15,distance));controls.update();dirty=true};
for(const [id,key]of [['armor-color','armor'],['metal-color','metal'],['lens-color','lenses']])$(id).oninput=()=>{soldier().paint[key]=$(id).value;updatePaint();persist()};
$('refresh-catalog').onclick=async()=>{await refreshCatalog();await chooseClass(soldier().classId)};
$('save-roster').onclick=async()=>{try{const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema:'medusa-selected-roster-v2',soldiers})});if(!response.ok)throw Error('Could not save the squad');setStatus('Squad saved. The build code is ready to transfer into Blender.')}catch(e){setStatus(e.message)}};


attachForgeTools({getSoldiers:()=>soldiers,getActive:()=>active,getCatalog:()=>catalog||{armor:{classes:[]},manifest:{assets:[]},configured:false},getMotion:motionState,async reloadCatalog(){await refreshCatalog();await chooseClass(soldier().classId)},async importRecipe(recipe){if(recipe.kind==='soldier'){const next=[...soldiers];next[active]={...recipe.soldiers[0],id:soldier().id};soldiers=next}else{soldiers=recipe.soldiers;active=0}const m=soldier().motion||{gait:'walk',stance:'unarmed',speedPct:100};$('motion-gait').value=m.gait;$('walk-style').value=m.stance;$('walk-speed').value=m.speedPct/100;$('walk-speed-label').value=(m.speedPct/100)+'×';resetWalk();showSoldiers();await chooseClass(soldier().classId);await setupWalk();persist()}});

restoreMotionControls();showSoldiers();try{await refreshCatalog();await chooseClass(soldier().classId)}catch(error){setStatus(error.message);$('loading').textContent='The armour library could not be loaded. Extract the complete application folder and restart.'}
