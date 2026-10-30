import test from 'node:test';
import assert from 'node:assert/strict';
import{classifySourceGeometry,createSourceGeometryClassifier}from'../shared/source-geometry.mjs';
const cpu='DQSKIN\ncdt_off_all\nexport_preserve_geometry\nexport_preserve_geometry_for_cpu\nrender_preserve_uv_data\n';
const seal={name:'Seal_Shoulder_01_SIM',objectId:409,vertices:23,faces:20,material:'default_ch_purity_seals_01'};
test('native render cloth retains the actual twenty-triangle shoulder seal',()=>{
 const decision=classifySourceGeometry(seal,{sourceObject:{affixes:cpu+'cloth_material\n'}});
 assert.equal(decision.render,true);assert.equal(decision.kind,'render');assert.equal(decision.reason,'native-render-cloth');
 assert.ok(decision.evidence.includes('native-affix:cloth_material'));
});
test('source renderMeshes may refer to the simulation mesh itself',()=>{
 const decision=classifySourceGeometry(seal,{sourceObject:{affixes:cpu},simulationBindings:[{simMeshName:seal.name,renderMeshes:[seal.name]}]});
 assert.equal(decision.render,true);assert.equal(decision.reason,'source-declared-render-mesh');
});
test('source physics with a separate render surface is excluded even with a colored material',()=>{
 const decision=classifySourceGeometry({name:'ch_sniper_cloak_02_SIM',material:'default_sc_green_11'},{sourceObject:{affixes:cpu},simulationBindings:[{simMeshName:'ch_sniper_cloak_02_SIM',renderMeshes:['ch_sniper_cloak_02_REND']}]});
 assert.equal(decision.render,false);assert.equal(decision.reason,'source-simulation-proxy');
});
test('SIM with native CPU-export flags and utility color remains excluded',()=>{
 const decision=classifySourceGeometry({name:'soldier_tabard_02_SIM',material:'default_sc_grey_90'},{sourceObject:{affixes:cpu}});
 assert.equal(decision.render,false);assert.equal(decision.reason,'native-cpu-simulation-proxy');
});
test('collision certification uses native flags; cdt_off_all never declares a collision mesh',()=>{
 assert.equal(classifySourceGeometry({name:'HEAD_cdt',material:'_'},{sourceObject:{affixes:'cdt_special_mesh\ncollision_type\n0'}}).render,false);
 assert.equal(classifySourceGeometry({name:'cloth',material:'default_ch_purity_seals_01'},{sourceObject:{affixes:'cdt_off_all\n'}}).render,true);
 assert.equal(classifySourceGeometry({name:'rb_wpn',material:'_'}).render,false);
});
test('unknown SIM and helper-like meshes are retained with warnings',()=>{
 for(const record of[{name:'real_cloth_SIM',material:'default_ch_cloth_01'},{name:'ambiguous_SIM',material:'default_sc_grey_90'},{name:'Icosphere',material:'default_ch_skull_01'},{name:'shield_cdt',material:'default_ch_shield_01'}]){
  const decision=classifySourceGeometry(record);assert.equal(decision.render,true);assert.equal(decision.kind,'ambiguous');assert.ok(decision.warning);
 }
});
test('material utility colors do not remove ordinary render meshes',()=>{
 assert.equal(classifySourceGeometry({name:'armor_shell',material:'default_sc_grey_90'}).render,true);
 assert.equal(classifySourceGeometry({name:'material_swatch',material:'default_sc_grey_90'}).render,false);
});
test('factory resolves object identity, reports ambiguous decisions once and preserves grafted evidence',()=>{
 const warnings=[],classify=createSourceGeometryClassifier({objectMetadata:[{id:409,affixes:cpu+'cloth_material\n'},{id:23,affixes:cpu}]},{onWarning:warning=>warnings.push(warning)});
 const decision=classify(seal);assert.equal(decision.render,true);
 const grafted={...seal,name:'source:Seal_Shoulder_01_SIM',objectId:1200000409,forgeSourceGeometry:decision};assert.deepEqual(classifySourceGeometry(grafted),decision);
 const unknown={name:'unclassified_SIM',objectId:24,material:'default_ch_cloth_01'};classify(unknown);classify(unknown);assert.equal(warnings.length,1);
 assert.equal(classify({...unknown,name:'grey_SIM',objectId:23,material:'default_sc_grey_90'}).render,false);
});
test('conflicting source simulation bindings preserve the declared render mesh with a warning',()=>{
 const decision=classifySourceGeometry(seal,{simulationBindings:[{simMeshName:seal.name,renderMeshes:[seal.name]},{simMeshName:seal.name,renderMeshes:['other_REND']}]});
 assert.equal(decision.render,true);assert.ok(decision.warning);
});

test('explicit self-render declaration also preserves a grey simulation surface',()=>{
 const decision=classifySourceGeometry({name:'ch_raider_tabard_01_SIM',material:'default_sc_grey_80'},{sourceObject:{affixes:cpu},simulationBindings:[{simMeshName:'ch_raider_tabard_01_SIM',renderMeshes:['ch_raider_tabard_01_SIM']}]});
 assert.equal(decision.render,true);assert.equal(decision.reason,'source-declared-render-mesh');
});

test('native separate-render binding overrides the cloth_material export flag',()=>{
 const decision=classifySourceGeometry({name:'Tabard_02_support_01_SIM',material:'default_ch_support_cloth_01'},{sourceObject:{affixes:cpu+'cloth_material\n'},simulationBindings:[{simMeshName:'Tabard_02_support_01_SIM',renderMeshes:['Tabard_02_support_01_REND']}]});
 assert.equal(decision.render,false);assert.equal(decision.reason,'source-simulation-proxy');
});
test('native and mod source bindings keep distinct meanings for the same mesh name',()=>{
 const record={name:'ch_raider_tabard_01_SIM',objectId:1132,material:'default_sc_grey_80'},objectMetadata=[{id:1132,affixes:cpu}];
 const native=createSourceGeometryClassifier({objectMetadata,sourceGeometryBindings:[{simMeshName:record.name,renderMeshes:['ch_raider_tabard_01_REND']}]});
 const mod=createSourceGeometryClassifier({objectMetadata,sourceGeometryBindings:[{simMeshName:record.name,renderMeshes:[record.name]}]});
 assert.equal(native(record).render,false);assert.equal(mod(record).render,true);
});
