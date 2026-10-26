/** Lossless glTF eight-influence support for the pinned Three.js WebGL renderer.
 * No vendor files are modified. Models with one influence set retain stock behavior.
 */
const VERSION='ihf-eight-influences-v1';
const DECLARATIONS=`#include <skinning_pars_vertex>
#ifdef USE_SKINNING
attribute vec4 skinIndex1;
attribute vec4 skinWeight1;
#endif`;
const BASE=`#include <skinbase_vertex>
#ifdef USE_SKINNING
mat4 ihfBone4=getBoneMatrix(skinIndex1.x);
mat4 ihfBone5=getBoneMatrix(skinIndex1.y);
mat4 ihfBone6=getBoneMatrix(skinIndex1.z);
mat4 ihfBone7=getBoneMatrix(skinIndex1.w);
#endif`;
const POSITION=`#ifdef USE_SKINNING
vec4 skinVertex=bindMatrix*vec4(transformed,1.0);
vec4 skinned=boneMatX*skinVertex*skinWeight.x
 +boneMatY*skinVertex*skinWeight.y
 +boneMatZ*skinVertex*skinWeight.z
 +boneMatW*skinVertex*skinWeight.w
 +ihfBone4*skinVertex*skinWeight1.x
 +ihfBone5*skinVertex*skinWeight1.y
 +ihfBone6*skinVertex*skinWeight1.z
 +ihfBone7*skinVertex*skinWeight1.w;
transformed=(bindMatrixInverse*skinned).xyz;
#endif`;
const NORMAL=`#ifdef USE_SKINNING
mat4 skinMatrix=skinWeight.x*boneMatX+skinWeight.y*boneMatY
 +skinWeight.z*boneMatZ+skinWeight.w*boneMatW
 +skinWeight1.x*ihfBone4+skinWeight1.y*ihfBone5
 +skinWeight1.z*ihfBone6+skinWeight1.w*ihfBone7;
skinMatrix=bindMatrixInverse*skinMatrix*bindMatrix;
objectNormal=(skinMatrix*vec4(objectNormal,0.0)).xyz;
#ifdef USE_TANGENT
objectTangent=(skinMatrix*vec4(objectTangent,0.0)).xyz;
#endif
#endif`;

export function patchEightInfluenceVertexShader(source){
 for(const marker of ['skinning_pars_vertex','skinbase_vertex','skinning_vertex']){
  if(!source.includes('#include <'+marker+'>'))throw Error('Unsupported skinning shader: '+marker+' is missing');
 }
 return source.replace('#include <skinning_pars_vertex>',DECLARATIONS)
  .replace('#include <skinbase_vertex>',BASE)
  .replace('#include <skinning_vertex>',POSITION)
  .replace('#include <skinnormal_vertex>',NORMAL);
}

export function createEightInfluenceSkinning(THREE){
 const patchedMaterials=new WeakSet(),preparedGeometry=new WeakSet(),ownedShadows=new WeakSet(),preparedMeshes=new WeakSet();
 function patchMaterial(material){
  if(!material||patchedMaterials.has(material))return;
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){previous.call(this,shader,renderer);shader.vertexShader=patchEightInfluenceVertexShader(shader.vertexShader)};
  material.customProgramCacheKey=function(){return previousKey.call(this)+'|'+VERSION};
  material.needsUpdate=true;patchedMaterials.add(material);
 }
 function attributes(mesh){
  const a=mesh.geometry.attributes;
  return [a.skinIndex,a.skinWeight,a.skinIndex1||a.joints_1,a.skinWeight1||a.weights_1];
 }
 function validate(mesh){
  const sets=attributes(mesh),count=mesh.geometry.attributes.position.count;
  if(sets.some(a=>!a||a.itemSize!==4||a.count!==count))throw Error('Incomplete eight-influence skin attributes');
  for(let i=0;i<count;i++){
   let total=0;
   for(let set=0;set<2;set++)for(let j=0;j<4;j++){
    const joint=sets[set*2].getComponent(i,j),weight=sets[set*2+1].getComponent(i,j);
    if(!Number.isFinite(weight)||weight<0||!Number.isInteger(joint)||joint<0||joint>=mesh.skeleton.bones.length)throw Error('Invalid eight-influence bone weight');
    total+=weight;
   }
   if(!Number.isFinite(total)||Math.abs(total-1)>1e-5)throw Error('Eight-influence weights must sum to one');
  }
 }
 function prepareMesh(mesh){
  if(!mesh.isSkinnedMesh)return false;
  const a=mesh.geometry.attributes,secondary=a.skinWeight1||a.weights_1,secondaryJoints=a.skinIndex1||a.joints_1;
  if(!secondary&&!secondaryJoints)return false;
  if(!secondary||!secondaryJoints)throw Error('Incomplete secondary skin influence set');
  if(!preparedGeometry.has(mesh.geometry)){
   mesh.geometry.setAttribute('skinIndex1',secondaryJoints);
   mesh.geometry.setAttribute('skinWeight1',secondary);
   preparedGeometry.add(mesh.geometry);
  }
  if(!preparedMeshes.has(mesh)){
   validate(mesh);
   const base=new THREE.Vector4(),value=new THREE.Vector4(),matrix=new THREE.Matrix4();
   mesh.applyBoneTransform=function(index,target){
    const sets=attributes(this),skeleton=this.skeleton,isDirection=target.isVector4;
    if(isDirection){base.copy(target);target.set(0,0,0,0)}else{base.set(target.x,target.y,target.z,1);target.set(0,0,0)}
    base.applyMatrix4(this.bindMatrix);
    for(let set=0;set<2;set++)for(let j=0;j<4;j++){
     const weight=sets[set*2+1].getComponent(index,j);if(weight===0)continue;
     const joint=sets[set*2].getComponent(index,j);
     matrix.multiplyMatrices(skeleton.bones[joint].matrixWorld,skeleton.boneInverses[joint]);
     target.addScaledVector(value.copy(base).applyMatrix4(matrix),weight);
    }
    if(isDirection)target.w=base.w;
    return target.applyMatrix4(this.bindMatrixInverse);
   };
   // Stock Three normalizes just WEIGHTS_0. Keep both sets together instead.
   mesh.normalizeSkinWeights=function(){
    const sets=attributes(this);
    for(let i=0;i<sets[0].count;i++){
     let sum=0;for(let set=0;set<2;set++)for(let j=0;j<4;j++)sum+=sets[set*2+1].getComponent(i,j);
     if(!Number.isFinite(sum)||sum<=0)throw Error('Invalid eight-influence weight sum');
     for(let set=0;set<2;set++)for(let j=0;j<4;j++)sets[set*2+1].setComponent(i,j,sets[set*2+1].getComponent(i,j)/sum);
    }
    sets[1].needsUpdate=true;sets[3].needsUpdate=true;
   };
   mesh.userData.forgeSkinInfluences=8;mesh.boundingBox=null;mesh.boundingSphere=null;
   if(!mesh.customDepthMaterial){mesh.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});ownedShadows.add(mesh.customDepthMaterial)}
   if(!mesh.customDistanceMaterial){mesh.customDistanceMaterial=new THREE.MeshDistanceMaterial();ownedShadows.add(mesh.customDistanceMaterial)}
   preparedMeshes.add(mesh);
  }
  for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])patchMaterial(material);
  patchMaterial(mesh.customDepthMaterial);patchMaterial(mesh.customDistanceMaterial);
  return true;
 }
 function loaderPlugin(parser){
  const profiles=new Map();
  return {name:'IHF_EIGHT_INFLUENCE_SKINNING',
   async beforeRoot(){
    const indices=new Set();
    for(const mesh of parser.json.meshes||[])for(const primitive of mesh.primitives||[]){
     const a=primitive.attributes||{},hasJoints=Object.hasOwn(a,'JOINTS_1'),hasWeights=Object.hasOwn(a,'WEIGHTS_1');
     if(hasJoints!==hasWeights)throw Error('Incomplete glTF secondary influence set');
     if(hasJoints){if(!Object.hasOwn(a,'WEIGHTS_0')||!Object.hasOwn(a,'JOINTS_0'))throw Error('Missing primary influence set');indices.add(a.WEIGHTS_0);indices.add(a.WEIGHTS_1)}
     if(Object.keys(a).some(key=>/^(?:WEIGHTS|JOINTS)_[2-9]/.test(key)))throw Error('More than eight skin influences are not supported');
    }
    await Promise.all([...indices].map(async index=>{profiles.set(index,(await parser.getDependency('accessor',index)).clone())}));
   },
   afterRoot(result){
    const visited=new WeakSet();
    for(const root of result.scenes||[result.scene])root?.traverse(mesh=>{
     if(!mesh.isSkinnedMesh)return;
     const association=parser.associations.get(mesh),primitive=parser.json.meshes?.[association?.meshes]?.primitives?.[association?.primitives];
     const a=primitive?.attributes;if(!a||!Object.hasOwn(a,'WEIGHTS_1'))return;
     if(!visited.has(mesh.geometry)){
      // Restore before the configurator or CPU bounds see loader-normalized WEIGHTS_0.
      mesh.geometry.setAttribute('skinWeight',profiles.get(a.WEIGHTS_0).clone());
      mesh.geometry.setAttribute('weights_1',profiles.get(a.WEIGHTS_1).clone());
      visited.add(mesh.geometry);
     }
     prepareMesh(mesh);
    });
   }
  };
 }
 function disposeMesh(mesh){for(const key of ['customDepthMaterial','customDistanceMaterial'])if(ownedShadows.has(mesh[key])){mesh[key].dispose();delete mesh[key]}}
 return {loaderPlugin,prepareMesh,disposeMesh};
}
