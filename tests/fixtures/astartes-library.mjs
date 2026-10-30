import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const DIRECTORY='assets/customization/astartes-v1';
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n')};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function fixtureGLB(meshName='fixture_chest',objectId=17,{helper=false}={}){
 const views=[],accessors=[],chunks=[];let length=0;
 function a(values,type,width,componentType=5126){
  const pad=(-length)&3;if(pad){chunks.push(Buffer.alloc(pad));length+=pad}
  const size=componentType===5123?2:4,b=Buffer.alloc(values.length*size);
  values.forEach((x,i)=>componentType===5123?b.writeUInt16LE(x,i*size):b.writeFloatLE(x,i*size));
  const view=views.length;views.push({buffer:0,byteOffset:length,byteLength:b.length});chunks.push(b);length+=b.length;
  const id=accessors.length;accessors.push({bufferView:view,componentType,type,count:values.length/width});return id;
 }
 const attrs={POSITION:a([0,0,0,1,0,0,0,1,0],'VEC3',3),NORMAL:a([0,0,1,0,0,1,0,0,1],'VEC3',3),JOINTS_0:a(Array(12).fill(0),'VEC4',4,5123),WEIGHTS_0:a([.5,0,0,0,.5,0,0,0,.5,0,0,0],'VEC4',4),JOINTS_1:a(Array(12).fill(0),'VEC4',4,5123),WEIGHTS_1:a([.5,0,0,0,.5,0,0,0,.5,0,0,0],'VEC4',4)};
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],ibm=a(helper?[...identity,...identity]:identity,'MAT4',16);
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{name:'ROOT',...(helper?{children:[2]}:{})},{name:meshName+'_node',mesh:0,skin:0},...(helper?[{name:'mod_distinctive_helper',translation:[0,.2,0]}]:[])],skins:[{joints:helper?[0,2]:[0],skeleton:0,inverseBindMatrices:ibm}],meshes:[{name:meshName,primitives:[{attributes:attrs,material:0}]}],materials:[{name:'fixture_armour'}],buffers:[{byteLength:length}],bufferViews:views,accessors};
 const bin=Buffer.concat(chunks),raw=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([raw,Buffer.alloc((-raw.length)&3,32)]),body=Buffer.concat([bin,Buffer.alloc((-bin.length)&3)]),header=Buffer.alloc(20),bh=Buffer.alloc(8);
 header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+body.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(body.length,0);bh.writeUInt32LE(0x004e4942,4);
 return{bytes:Buffer.concat([header,json,bh,body]),doc,metadata:{meshes:[{name:meshName,objectId}],objectMetadata:[{objectId,name:meshName}]}};
}
export function createAstartesFixture(dataRoot){
 const baseId='PVE_PVP_SOLDIER',asset='cc_sm_constructor_soldier',modelId='astartes_cc_sm_constructor_soldier',optionId='astartes:chest_chaplain',profileId='PVE_PVP_CHARACTER_MOD_2';
 const sourceRoot=path.join(dataRoot,'assets/characters/SM2-retail-constructors/source-v5');
 const native=fixtureGLB('native_chest',17),custom=fixtureGLB('chaplain_chest',99,{helper:true});
 fs.mkdirSync(sourceRoot,{recursive:true});fs.writeFileSync(path.join(sourceRoot,asset+'.glb'),native.bytes);write(path.join(sourceRoot,asset+'.json'),native.metadata);
 write(path.join(sourceRoot,'manifest.json'),{assets:[{asset,transformValidation:'passed',restSkinValidation:'passed',weightPackingValidation:'passed',skinProfileWeldValidation:'passed'}]});
 const nativeOption={id:'chest_soldier_common_01',label:'Native',meshes:['native_chest'],resolvedMeshes:['native_chest'],resolvedObjectIds:[17],geometryAvailable:true,geometryComplete:true};
 const registry={classes:[{id:baseId,label:'Tactical',tpl:asset,available:true,slots:[{id:'CHEST',label:'Chest',options:[nativeOption]}],initialSelection:{CHEST:nativeOption.id}}]};
 write(path.join(dataRoot,'production/roster/armor-options.json'),registry);
 const model={id:modelId,sourceTemplate:asset,sourceClassId:baseId,glb:DIRECTORY+'/models/soldier.glb',metadata:DIRECTORY+'/models/soldier.json',validation:{transform:'passed',restSkin:'passed',weightPacking:'passed',skinProfileWeld:'passed'}};
 const option={id:optionId,sourceOptionId:'chest_chaplain',slotId:'CHEST',label:'Chaplain chest',sourceAsset:modelId,meshes:['chaplain_chest'],resolvedMeshes:['chaplain_chest'],resolvedObjectIds:[99],geometryAvailable:true,geometryComplete:true};
 const profile={id:profileId,label:'Chaplain',baseClassId:baseId,sourceTemplateId:asset,modelId,initialSelection:{CHEST:'chest_chaplain'},initialPaint:{armor:'#171717',metal:'#9a9a9a',lenses:'#ff0000'},sourcePreset:'PREDEFINED_PRESET_1'};
 const catalog={schema:'iron-hands-forge-astartes-catalog-v1',version:1,models:[model],options:[option],profiles:[profile]};
 fs.mkdirSync(path.dirname(path.join(dataRoot,model.glb)),{recursive:true});fs.writeFileSync(path.join(dataRoot,model.glb),custom.bytes);write(path.join(dataRoot,model.metadata),custom.metadata);
 const catalogPath=DIRECTORY+'/catalog.json',manifestPath=DIRECTORY+'/manifest.json';
 function refreshManifest(){
  write(path.join(dataRoot,catalogPath),catalog);
  const files=[...new Set([catalogPath,...catalog.models.flatMap(m=>[m.glb,m.metadata])])].map(file=>{const b=fs.readFileSync(path.join(dataRoot,file));return{path:file,bytes:b.length,sha256:sha(b)}});
  const manifest={schema:'iron-hands-forge-astartes-library-v1',version:1,catalog:catalogPath,files};write(path.join(dataRoot,manifestPath),manifest);return manifest;
 }
 const manifest=refreshManifest();
 function recipe(classId=profileId,selection={CHEST:optionId}){return{schema:'iron-hands-forge',version:1,kind:'soldier',catalog:{game:'SM2',build:'fixture'},soldiers:[{id:'soldier-01',role:'Marine',classId,selection,paint:profile.initialPaint}]}}
 return{dataRoot,registry,catalog,manifest,refreshManifest,model,option,profile,sourceRoot,recipe};
}
