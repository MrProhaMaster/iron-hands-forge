/** Validate existing source-declared decal surfaces; never creates projected replacement geometry. */
const MATERIAL={LEFT_PAULDRON:'default_ch_lpd',RIGHT_PAULDRON:'default_ch_rpd',LEFT_GREAVE:'default_ch_lgd',RIGHT_GREAVE:'default_ch_rgd'};
export function sourceDecalCarriers({slot,option,metadata,document}={}){
 const material=MATERIAL[slot];if(!material)throw Error('Unknown decal source placement: '+slot);
 const ids=new Set(option?.resolvedObjectIds||[]),meshes=metadata?.meshes||[],docMeshes=document?.meshes||[];
 if(docMeshes.length!==meshes.length)throw Error('Decal source mesh identity mismatch');
 const candidates=meshes.flatMap((record,index)=>ids.has(record.objectId)&&record.material===material&&/_decal$/i.test(record.name||'')?[index]:[]);
 const nodeIndices=[],meshIndices=[],objectIds=[],names=[];
 for(const index of candidates){
  const mesh=docMeshes[index];if(mesh.name!==meshes[index].name)throw Error('Decal source mesh name mismatch');
  const nodes=(document.nodes||[]).flatMap((node,i)=>node.mesh===index?[{node,index:i}]:[]);
  if(!nodes.length||nodes.some(({node})=>!Number.isInteger(node.skin)||!document.skins?.[node.skin]?.joints?.length))throw Error('Source decal carrier is missing native skinning');
  if(!mesh.primitives?.length||mesh.primitives.some(p=>['POSITION','TEXCOORD_0','JOINTS_0','WEIGHTS_0'].some(k=>!Number.isInteger(p.attributes?.[k]))))throw Error('Source decal carrier is missing native UV0 or weights');
  meshIndices.push(index);objectIds.push(meshes[index].objectId);names.push(meshes[index].name);nodeIndices.push(...nodes.map(n=>n.index));
 }
 return{supported:meshIndices.length>0,slot,sourceMaterial:material,meshIndices,nodeIndices,objectIds:[...new Set(objectIds)],names:[...new Set(names)],uvSet:0,skinned:meshIndices.length>0};
}
