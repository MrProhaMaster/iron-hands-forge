/** Decide render eligibility from native evidence, never from a SIM suffix alone. */
export const SOURCE_GEOMETRY_SCHEMA='forge-source-geometry-v1';
const sourceName=record=>String(record?.sourceName??record?.name??'');
const materialName=record=>String(record?.material??'').trim();
const utilityMaterial=name=>name==='_'||/^defaultmaterial$/i.test(name)||/^(?:default_)?sc_[a-z]+_\d+$/i.test(name);
const flagsOf=object=>new Set([object?.affixes,object?.readAffixes].flatMap(value=>Array.isArray(value)?value:String(value??'').split(/[\r\n]+/)).map(value=>String(value).trim().toLowerCase()).filter(Boolean));
const renderNames=binding=>(binding?.renderMeshes??binding?.render??[]).map(value=>typeof value==='string'?value:value?.name).filter(value=>typeof value==='string'&&value);
function result(render,kind,reason,evidence,warning){return{schema:SOURCE_GEOMETRY_SCHEMA,render,kind,reason,evidence,...(warning?{warning}:{})}}

/**
 * `sourceObject` is the exact objectMetadata record, not a name-based match.
 * Optional simulation bindings come from the source dummy/actor cloth setup:
 * {simMeshName, renderMeshes:[name], sourcePath?, sourceSha256?}.
 * Unknown helper-like geometry is retained with an explicit warning.
 */
export function classifySourceGeometry(record,{sourceObject,simulationBindings=[]}={}){
 const inherited=record?.forgeSourceGeometry;
 if(inherited?.schema===SOURCE_GEOMETRY_SCHEMA&&typeof inherited.render==='boolean'&&['render','proxy','ambiguous'].includes(inherited.kind))return structuredClone(inherited);
 const name=sourceName(record),lower=name.toLowerCase(),material=materialName(record),flags=flagsOf(sourceObject),evidence=[];
 const sim=/_sim$/i.test(name),bindings=simulationBindings.filter(binding=>String(binding?.simMeshName??binding?.sim??'').toLowerCase()===lower);
 const selfRender=bindings.some(binding=>renderNames(binding).some(value=>value.toLowerCase()===lower));
 const otherRender=bindings.some(binding=>renderNames(binding).some(value=>value.toLowerCase()!==lower));
 const textured=!!material&&!utilityMaterial(material);
 if(selfRender){
  evidence.push('source-binding:simulation-mesh-is-render-mesh');
  if(textured)evidence.push('native-material:textured-surface');
  if(flags.has('cloth_material'))evidence.push('native-affix:cloth_material');
  return result(true,'render','source-declared-render-mesh',evidence,otherRender?'Source bindings use this mesh both for rendering and simulation; the render declaration is preserved.':undefined);
 }
 if(sim&&otherRender)return result(false,'proxy','source-simulation-proxy',['native-name:simulation-mesh','source-binding:separate-render-mesh']);
 if(flags.has('cloth_material')&&textured)return result(true,'render','native-render-cloth',['native-affix:cloth_material','native-material:textured-surface']);
 if(flags.has('cdt_special_mesh'))return result(false,'proxy','native-collision-mesh',['native-affix:cdt_special_mesh']);
 if((/_cdt$/i.test(name)||/^rb_/i.test(name))&&material==='_')return result(false,'proxy','native-collision-helper',['native-name:collision-helper','native-material:empty']);
 if(sim&&utilityMaterial(material)&&flags.has('export_preserve_geometry_for_cpu')&&flags.has('export_preserve_geometry'))return result(false,'proxy','native-cpu-simulation-proxy',['native-name:simulation-mesh','native-affix:export_preserve_geometry_for_cpu','native-affix:export_preserve_geometry','native-material:utility-color']);
 if((/^material_/i.test(name)||/^icosphere$/i.test(name))&&utilityMaterial(material))return result(false,'proxy','native-material-helper',['native-name:material-helper','native-material:utility-color']);
 if(sim||/_cdt$/i.test(name)||/^rb_|^material_|^icosphere$/i.test(name))return result(true,'ambiguous','unconfirmed-helper-retained',[...(sim?['native-name:simulation-mesh']:['native-name:helper-like']),...(textured?['native-material:textured-surface']:[])],`Retained ${name||'unnamed source mesh'}: helper-like naming has no conclusive source evidence that it is non-render geometry.`);
 return result(true,'render','native-render-mesh',['native-name:render-mesh']);
}

/** Build once per metadata document, then classify each mesh record by object ID. */
export function createSourceGeometryClassifier(metadata,{simulationBindings=metadata?.sourceGeometryBindings??[],onWarning}={}){
 const objects=new Map((metadata?.objectMetadata??[]).map(object=>[object.id,object])),warned=new Set();
 return record=>{
  const decision=classifySourceGeometry(record,{sourceObject:objects.get(record?.objectId),simulationBindings});
  if(decision.warning&&onWarning){const key=String(record?.objectId)+'|'+sourceName(record)+'|'+decision.reason;if(!warned.has(key)){warned.add(key);onWarning({name:sourceName(record),objectId:record?.objectId,...decision})}}
  return decision;
 };
}
