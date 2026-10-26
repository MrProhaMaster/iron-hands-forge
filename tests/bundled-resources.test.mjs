import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {bundleResources,verifyBundle,safeRelative,sanitizeJSON} from '../scripts/bundle-resources.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MODEL='assets/characters/SM2-retail-constructors/source-v5';
const bindings=JSON.parse(fs.readFileSync(path.join(ROOT,'shared/motion-bindings.json'),'utf8'));
const writeJSON=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value))};
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(){
  fs.mkdirSync(path.join(ROOT,'.build'),{recursive:true});
  const base=fs.mkdtempSync(path.join(ROOT,'.build/resource-bundle-test-')),source=path.join(base,'source'),out=path.join(base,'bundle');
  const classes=Object.entries(bindings.classes).filter(([,item])=>item.status==='validated').map(([id,item])=>({id,tpl:item.asset,available:true,constructorSource:'E:\\SteamLibrary\\steamapps\\common\\Space Marine 2\\client_pc\\root\\paks\\client\\default\\default_other.pak',slots:[{id:'HELMET',options:[{id:'helmet_common_01',meshes:['Helmet'],resolvedObjectIds:[42]}]}]}));
  const assets=[];
  for(const item of classes){
    const gltf={asset:{version:'2.0'},meshes:[{name:'Helmet',primitives:[]}],buffers:[{byteLength:0}]};
    const json=Buffer.from(JSON.stringify(gltf)),payload=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]),header=Buffer.alloc(20),bin=Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+payload.length,8);header.writeUInt32LE(payload.length,12);header.writeUInt32LE(0x4e4f534a,16);bin.writeUInt32LE(0x004e4942,4);
    const file=path.join(source,MODEL,item.tpl+'.glb');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.concat([header,payload,bin]));
    const metadata={asset:item.tpl,file,sourceNativeV5:'C:\\Users\\private-person\\private-model.glb',objectMetadata:[{id:42,parentId:null,name:'Helmet',fullPath:'CENTRE/Helmet'}],meshes:[{name:'Helmet',objectId:42,lod:0}]};
    writeJSON(path.join(source,MODEL,item.tpl+'.json'),metadata);
    assets.push({asset:item.tpl,raw:file,metadata:path.join(source,MODEL,item.tpl+'.json'),transformValidation:'passed',restSkinValidation:'passed',weightPackingValidation:'passed',skinProfileWeldValidation:'passed'});
  }
  writeJSON(path.join(source,'production/roster/armor-options.json'),{gameBuild:'test-build',classes});
  writeJSON(path.join(source,'production/roster/armor-paints.json'),{schema:'paints',colors:[{id:'IronHandsBlack',rgbTint:[14,17,20]}],sourceArchive:'/home/private-person/game.pak'});
  writeJSON(path.join(source,MODEL,'manifest.json'),{schemaVersion:5,sourceVersion:5,selected:9,exported:9,output:path.join(source,MODEL),assets:[...assets,{asset:'cc_sm_constructor_medic',raw:'C:\\private\\unused.glb'}]});
  writeJSON(path.join(source,'assets/animations/motion-manifest.json'),{completed:true,sourceArchive:'E:\\SteamLibrary\\steamapps\\common\\Space Marine 2\\animations.pak'});
  for(const clip of Object.values(bindings.clips))writeJSON(path.join(source,'assets/animations',clip.output),{times:[0,1],channels:[{name:'HEAD',positions:[[0,0,0],[0,0,0]],rotations:[[0,0,0,1],[0,0,0,1]]}]});
  writeJSON(path.join(source,'production/roster/draft-roster.json'),{private:'saved user squad'});
  fs.writeFileSync(path.join(source,'private-game.pak'),'not runtime data');
  return {base,source,out,classes};
}

function removeFixture(base){const resolved=path.resolve(base),expected=path.join(ROOT,'.build')+path.sep;if(!resolved.startsWith(expected))throw Error('Unsafe test cleanup');fs.rmSync(resolved,{recursive:true,force:true})}

test('bundle contains complete offline runtime data with source-identical geometry and portable metadata',()=>{
  const f=fixture();try{
    const before=digest(path.join(f.source,MODEL,f.classes[0].tpl+'.glb')),result=bundleResources(f.source,f.out),manifest=readJSON(path.join(f.out,'bundle-manifest.json'));
    assert.equal(result.ok,true);assert.equal(result.classes,7);assert.equal(result.files,22);assert.equal(result.armorOptions,7);assert.equal(manifest.classIds.length,7);
    assert.equal(digest(path.join(f.out,MODEL,f.classes[0].tpl+'.glb')),before);
    assert.equal(digest(path.join(f.source,MODEL,f.classes[0].tpl+'.glb')),before);
    assert.equal(fs.existsSync(path.join(f.out,'private-game.pak')),false);assert.equal(fs.existsSync(path.join(f.out,'production/roster/draft-roster.json')),false);
    const source=readJSON(path.join(f.out,MODEL,'manifest.json'));assert.equal(source.assets.length,7);assert.equal(source.selected,7);assert.equal(source.exported,7);
    const metadata=readJSON(path.join(f.out,MODEL,f.classes[0].tpl+'.json'));assert.deepEqual(metadata.objectMetadata,[{id:42,parentId:null,name:'Helmet',fullPath:'CENTRE/Helmet'}]);assert.equal(metadata.meshes[0].objectId,42);assert.equal(metadata.file,MODEL+'/'+f.classes[0].tpl+'.glb');assert.equal(metadata.sourceNativeV5,'source-input/private-model.glb');
    const registry=readJSON(path.join(f.out,'production/roster/armor-options.json'));assert.equal(registry.classes[0].constructorSource,'source-game/client_pc/root/paks/client/default/default_other.pak');
    assert.equal(readJSON(path.join(f.out,'production/roster/armor-paints.json')).sourceArchive,'source-input/game.pak');
    assert.deepEqual(verifyBundle(f.out),result);
  }finally{removeFixture(f.base)}
});

test('bundle rejects incomplete class data or failed canonical validation before writing output',()=>{
  const f=fixture();try{
    const file=path.join(f.source,MODEL,'manifest.json'),manifest=readJSON(file);manifest.assets[0].skinProfileWeldValidation='failed';writeJSON(file,manifest);
    assert.throws(()=>bundleResources(f.source,f.out),/has not passed source validation/);assert.equal(fs.existsSync(f.out),false);
    manifest.assets[0].skinProfileWeldValidation='passed';writeJSON(file,manifest);fs.unlinkSync(path.join(f.source,MODEL,f.classes[1].tpl+'.glb'));
    assert.throws(()=>bundleResources(f.source,f.out));assert.equal(fs.existsSync(f.out),false);
  }finally{removeFixture(f.base)}
});

test('bundle retains valid empty equipment categories from the game registry',()=>{
  const f=fixture();try{
    const file=path.join(f.source,'production/roster/armor-options.json'),registry=readJSON(file);registry.classes[0].slots.push({id:'EMPTY_OPTIONAL_SLOT',options:[]});writeJSON(file,registry);
    const result=bundleResources(f.source,f.out);assert.equal(result.ok,true);assert.equal(result.armorOptions,7);
    const output=readJSON(path.join(f.out,'production/roster/armor-options.json'));assert.deepEqual(output.classes[0].slots[1],{id:'EMPTY_OPTIONAL_SLOT',options:[]});
  }finally{removeFixture(f.base)}
});

test('verify detects geometry changes and undeclared private or raw source files',()=>{
  const f=fixture();try{
    bundleResources(f.source,f.out);const file=path.join(f.out,MODEL,f.classes[0].tpl+'.glb'),bytes=fs.readFileSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);assert.throws(()=>verifyBundle(f.out),/checksum mismatch/);
    fs.copyFileSync(path.join(f.source,MODEL,f.classes[0].tpl+'.glb'),file);assert.equal(verifyBundle(f.out).ok,true);
    fs.writeFileSync(path.join(f.out,'game.pak'),'private source');assert.throws(()=>verifyBundle(f.out),/Unexpected or missing resource files/);
  }finally{removeFixture(f.base)}
});

test('verify rejects traversal, duplicate manifest entries, and missing declared files',()=>{
  const f=fixture();try{
    bundleResources(f.source,f.out);const file=path.join(f.out,'bundle-manifest.json'),manifest=readJSON(file),original=structuredClone(manifest);
    manifest.files[0].path='../outside.json';writeJSON(file,manifest);assert.throws(()=>verifyBundle(f.out),/Unsafe bundle path/);
    manifest.files=original.files.concat(original.files[0]);writeJSON(file,manifest);assert.throws(()=>verifyBundle(f.out),/Duplicate/);
    writeJSON(file,original);fs.unlinkSync(path.join(f.out,original.files[0].path));assert.throws(()=>verifyBundle(f.out),/Unexpected or missing resource files/);
  }finally{removeFixture(f.base)}
});

test('bundle refuses overwriting input, existing output, or source asset directories',()=>{
  const f=fixture();try{
    assert.throws(()=>bundleResources(f.source,f.source),/separate output/);
    assert.throws(()=>bundleResources(f.source,path.join(f.source,'assets/new')),/separate output/);
    bundleResources(f.source,f.out);assert.throws(()=>bundleResources(f.source,f.out),/not empty/);
  }finally{removeFixture(f.base)}
});

test('portable paths reject platform-specific absolute paths, URL schemes and traversal',()=>{
  for(const value of ['../x','x/../y','/tmp/x','C:/private/x','C:\\private\\x','\\\\host\\share\\x','https://example.com/x','nested/C:/private/x','x//y','x/./y','x\0y'])assert.throws(()=>safeRelative(value),/Unsafe/);
  assert.equal(safeRelative(MODEL+'/example.glb'),MODEL+'/example.glb');
  assert.deepEqual(sanitizeJSON({source:'E:\\Data\\assets\\x.glb',external:'See C:\\Users\\person\\x.glb',posix:'/home/person/game.pak'},'E:/Data'),{source:'assets/x.glb',external:'See source-input/x.glb',posix:'source-input/game.pak'});
});
