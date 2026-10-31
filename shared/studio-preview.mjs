import {hasPartGeometry} from './part-geometry.mjs';
/** Local, selected-geometry-only preview service. Uses the exact export builder. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {normalizeRecipe} from './recipe-codec.mjs';
import {buildRecipe} from '../tools/build_from_recipe.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const safeId=v=>typeof v==='string'&&v.length<=160&&!['__proto__','constructor','prototype'].includes(v);
export function createStudioPreview({getCatalog,getDataRoot,stateRoot}){
 const cacheRoot=path.resolve(stateRoot,'previews');fs.mkdirSync(cacheRoot,{recursive:true});
 let running=false;const queue=[],pending=new Map();
 async function drain(){if(running)return;running=true;try{while(queue.length){const work=queue.shift();try{work.resolve(await work.run())}catch(e){work.reject(e)}}}finally{running=false}}
 async function prepare(data,{partOnly=false}={}){
  const dataRoot=getDataRoot(),catalog=await getCatalog(),registry=catalog.armor;let recipe;
  if(partOnly){
   const c=registry.classes.find(c=>c.id===data.classId&&c.available);if(!c)throw Error('This body frame is unavailable.');
   if(!safeId(data.slotId)||!safeId(data.optionId))throw Error('Invalid part selection.');
   const slot=c.slots.find(s=>s.id===data.slotId),option=slot?.options.find(o=>o.id===data.optionId);
   if(!option)throw Error('This part is not in the local library.');
   if(option.forgeUnavailable)throw Error(option.reason||'Source geometry is unavailable.');
   if(!hasPartGeometry(option))return {empty:true};
   const selection={};
   for(const section of c.slots){
    const valid=o=>!o.forgeUnavailable&&!(o.equipmentActorMeshes?.length&&!o.meshes?.length)&&(!o.meshes?.length||o.resolvedObjectIds?.length||o.forgeCrossClass||o.forgeBionic||o.forgeAstartes);
    const chosen=section.options.find(o=>o.id===c.initialSelection?.[section.id]&&valid(o))||section.options.find(valid);
    if(chosen)selection[section.id]=chosen.id;
   }
   selection[data.slotId]=data.optionId;
   recipe=normalizeRecipe({schema:'iron-hands-forge',version:1,kind:'soldier',catalog:{game:'SM2',build:String(catalog.gameBuild||'unknown')},soldiers:[{id:'FORGE-PREVIEW',role:'Armour preview',classId:c.id,selection,paint:{armor:'#49515A',metal:'#B3BDC9',lenses:'#EF382E'}}]});
  }else{
   recipe=normalizeRecipe(data.recipe||data);
   if(recipe.soldiers.length!==1)throw Error('The studio previews one Space Marine at a time.');
   recipe.soldiers[0]={...recipe.soldiers[0]};delete recipe.soldiers[0].motion;
  }
  const onlySlots=partOnly?[data.slotId]:undefined;
  const fingerprint='forge-studio-0.5.0-heraldry-native-wrap-r2|'+String(catalog.registryFingerprint||'')+'|'+String(catalog.cosmeticsRevision||'')+'|'+JSON.stringify((catalog.manifest?.assets||[]).map(a=>[a.asset,a.assetRevision]));
  const key=crypto.createHash('sha256').update(JSON.stringify({recipe,onlySlots,dataRoot,fingerprint})).digest('hex').slice(0,32);
  const out=path.join(cacheRoot,key),manifest=path.join(out,'build-manifest.json');
  function result(){
   const built=read(manifest),record=built.files?.[0];
   if(!record?.file||path.basename(record.file)!==record.file||!fs.statSync(path.join(out,record.file)).isFile())throw Error('Preview is incomplete.');
   return {key,url:'/previews/'+key+'/'+encodeURIComponent(record.file),file:record.file,meshes:record.meshes,vertices:record.vertices,partOnly,slot:partOnly?data.slotId:null};
  }
  if(fs.existsSync(manifest)){try{return result()}catch{}}
  if(pending.has(key))return pending.get(key);
  if(queue.length>=12)throw Object.assign(Error('The preview queue is busy. Try again in a moment.'),{status:429});
  const task=new Promise((resolve,reject)=>{
   const work={resolve,reject,run:async()=>{fs.mkdirSync(out,{recursive:true});await buildRecipe(recipe,{dataRoot,out,...(onlySlots?{onlySlots}:{})});return result()}};
   if(partOnly)queue.push(work);else queue.unshift(work);
  });
  pending.set(key,task);void drain();
  try{return await task}finally{pending.delete(key)}
 }
 return {prepare,cacheRoot};
}
