import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceDecalCarriers} from '../shared/source-decal-carriers.mjs';
import {heraldryCompatibility} from '../shared/heraldry-options.mjs';
function fixture(){return{slot:'RIGHT_PAULDRON',option:{resolvedObjectIds:[41,42]},metadata:{meshes:[{name:'terminator_shoulder_R_01',objectId:41,material:'armor'},{name:'terminator_shoulder_R_01_decal',objectId:42,material:'default_ch_rpd'}]},document:{meshes:[{name:'terminator_shoulder_R_01',primitives:[{attributes:{POSITION:0}}]},{name:'terminator_shoulder_R_01_decal',primitives:[{attributes:{POSITION:1,TEXCOORD_0:2,JOINTS_0:3,WEIGHTS_0:4}}]}],nodes:[{name:'armor',mesh:0,skin:0},{name:'decal',mesh:1,skin:0}],skins:[{joints:[2]}]}};}
test('actual selected source decal surface is reused and its native side/material/UV0/skinning remain authoritative',()=>{
 const f=fixture(),before=structuredClone(f),p=sourceDecalCarriers(f);assert.equal(p.supported,true);assert.deepEqual(p.meshIndices,[1]);assert.deepEqual(p.objectIds,[42]);assert.deepEqual(p.nodeIndices,[1]);assert.equal(p.uvSet,0);assert.equal(p.skinned,true);assert.deepEqual(f,before);
});
test('a raised shoulder without a source decal surface is unavailable rather than receiving a projected replacement',()=>{
 const f=fixture();f.option.resolvedObjectIds=[41];assert.equal(sourceDecalCarriers(f).supported,false);assert.equal(heraldryCompatibility({meshes:['terminator_shoulder_L_01']},'chapter').supported,false);
 assert.equal(heraldryCompatibility({meshes:['terminator_shoulder_R_01','terminator_shoulder_R_01_decal']},'company').supported,true);
 assert.equal(heraldryCompatibility({meshes:['terminator_shoulder_R_01_decal']},'chapter').supported,false);
});
test('wrong-side material or a coincidentally similar mesh name cannot become a decal surface',()=>{
 const f=fixture();f.metadata.meshes[1].material='default_ch_lpd';assert.equal(sourceDecalCarriers(f).supported,false);
 const g=fixture();g.metadata.meshes[1].name=g.document.meshes[1].name='raised_emblem';assert.equal(sourceDecalCarriers(g).supported,false);
});
test('decal surfaces with missing native UV0 or skinning fail before export',()=>{
 const f=fixture();delete f.document.meshes[1].primitives[0].attributes.TEXCOORD_0;assert.throws(()=>sourceDecalCarriers(f),/UV0/);
 const g=fixture();delete g.document.nodes[1].skin;assert.throws(()=>sourceDecalCarriers(g),/skinning/);
});

test('a native source restriction overrides an existing decal mesh; native implicit surfaces remain selectable',()=>{
 assert.equal(heraldryCompatibility({meshes:['engineer_shoulder_L_01_decal'],forgeDecalSupport:{supported:false}},'chapter').supported,false);
 assert.equal(heraldryCompatibility({meshes:['source_armor_group'],forgeDecalSupport:{supported:true,carrierNames:['native_implicit_decal']}},'company').supported,true);
});

test('two source-backed Carcharodons left armour exceptions cannot use the source right-side decal material',()=>{
 for(const sourceOptionId of ['left_pauldron_custom_carcharodons_02','left_pauldron_custom_carcharodons_02_chain'])assert.equal(heraldryCompatibility({sourceOptionId,forgeAstartes:{},meshes:['shoulder_L_carcharadron_02_decal']},'chapter').supported,false);
});
