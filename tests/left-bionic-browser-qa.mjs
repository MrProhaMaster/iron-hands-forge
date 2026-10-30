// Local, isolated browser acceptance. No existing browser profile is opened.
// Run only after the server/resource library is ready:
// node tests/left-bionic-browser-qa.mjs --url http://127.0.0.1:PORT --out E:/.../qa
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {decodeRecipe} from '../shared/recipe-codec.mjs';
import {optionLabel} from '../shared/ui-labels.mjs';

const argv=process.argv.slice(2),options={};
for(let i=0;i<argv.length;i+=2){
 if(!['--url','--out'].includes(argv[i])||!argv[i+1])throw Error('Usage: --url LOOPBACK_URL --out ABSOLUTE_QA_DIRECTORY');
 options[argv[i]]=argv[i+1];
}
if(!options['--url']||!options['--out'])throw Error('Usage: --url LOOPBACK_URL --out ABSOLUTE_QA_DIRECTORY');
const base=new URL(options['--url']);
assert.equal(base.hostname,'127.0.0.1','Acceptance runs against the local application only');
assert.equal(base.protocol,'http:');
assert.ok(path.isAbsolute(options['--out']),'Use an absolute QA output directory (RUNNER_TEMP in Linux CI)');
const out=path.resolve(options['--out']);
if(process.platform==='win32')assert.match(out,/^E:[\\/]/i,'QA artifacts and the clean browser profile must stay on E:');
fs.mkdirSync(out,{recursive:true});
// Chromium's POSIX SingletonSocket lives under TMPDIR and is limited by
// sockaddr_un.sun_path. Keep Linux browser state independent of long QA paths.
const shortBrowserRoot=process.platform==='linux'?fs.mkdtempSync('/tmp/ihf-'):null;
const profile=shortBrowserRoot?path.join(shortBrowserRoot,'p'):fs.mkdtempSync(path.join(out,'browser-profile-'));
const temp=shortBrowserRoot?path.join(shortBrowserRoot,'t'):path.join(profile,'temp');
fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(temp,{recursive:true});
if(process.platform==='linux')assert.ok(Buffer.byteLength(path.join(temp,'com.google.Chrome.XXXXXX','SingletonSocket'))<100,'Chrome temporary socket path must fit sockaddr_un');
process.env.TEMP=temp;process.env.TMP=temp;process.env.TMPDIR=temp;
const require=createRequire(import.meta.url);
if(process.platform!=='win32')assert.ok(process.env.FORGE_PLAYWRIGHT&&process.env.FORGE_BROWSER,'Set FORGE_PLAYWRIGHT and FORGE_BROWSER for Linux acceptance');
const playwright=require(process.env.FORGE_PLAYWRIGHT||'playwright');
const executable=process.env.FORGE_BROWSER||[
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(file=>fs.existsSync(file));
function absoluteArtifact(file){assert.ok(path.isAbsolute(file),'Server output must be an absolute path');if(process.platform==='win32')assert.match(file,/^E:[\\/]/i);return file}
const expectedClasses=new Map([
 ['PVE_PVP_SOLDIER',9000001],['PVE_PVP_SNIPER',9000002],['PVE_PVP_SUPPORT',9000003],
 ['PVE_PVP_RAIDER',9000004],['PVE_PVP_TANK',9000005],['PVE_PVP_BERSERK',9000006],['PVE_PVP_ENGINEER',9000007]
]);
const requestedClassIds=process.env.FORGE_QA_CLASSES?.split(',').map(value=>value.trim()).filter(Boolean);
if(requestedClassIds)for(const id of requestedClassIds)assert.ok(expectedClasses.has(id),'Unknown scoped QA class: '+id);
const report={schema:'iron-hands-forge-left-bionic-browser-qa-v1',passed:false,base:base.origin,
 startedAt:new Date().toISOString(),profile,temp,shortBrowserRoot,executable:executable??'Playwright bundled Chromium',
 initialRosterOverride:'A page-init fetch hook supplies only /api/roster and /api/workspace/single for one initial class. Assembled preview GLB requests use unmodified fetch with no Playwright request interception. Explicit Save marine is exercised in the designated QA server state.',
 requestedClassIds:requestedClassIds??[...expectedClasses.keys()],
 classes:[],browserErrors:[],pageErrors:[],consoleErrors:[],httpFailures:[],requestFailures:[],completedByteStreamCancellations:[],cancelledOnPageClose:[],blockedRequests:[],externalRequests:[],networkLifecycle:[]};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let context,currentPage;
const closingPages=new WeakSet();
async function jsonGET(relative){
 const response=await fetch(new URL(relative,base));assert.ok(response.ok,relative+': HTTP '+response.status);return response.json();
}
async function renderSettled(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function ready(page,classId){
 await page.waitForFunction(id=>document.querySelector('#body-class')?.value===id&&document.querySelector('#loading')?.hidden&&
  document.querySelector('#walk-play')&&!document.querySelector('#walk-play').disabled&&document.querySelector('#inspect-pose'),classId,{timeout:240000});
}
async function inspect(page){
 await page.locator('#inspect-pose').click();
 return JSON.parse(await page.locator('#inspect-result').textContent());
}
function finitePose(pose,label){
 assert.ok(pose.meshes>0&&pose.vertices>500,label+': visible geometry required');
 assert.ok(Array.isArray(pose.entries)&&pose.entries.length===pose.meshes);
 for(const entry of pose.entries){
  assert.ok(entry.vertices>0,label+': empty mesh '+entry.source);
  for(const key of ['min','max'])assert.ok(entry[key]?.length===3&&entry[key].every(Number.isFinite),label+': nonfinite bounds '+entry.source);
  for(let axis=0;axis<3;axis++){
   assert.ok(entry.min[axis]<=entry.max[axis],label+': inverted bounds');
   assert.ok(Math.abs(entry.min[axis])<12&&Math.abs(entry.max[axis])<12,label+': unbounded geometry '+entry.source);
  }
 }
}
function checkBionicPose(pose,row,label){
 finitePose(pose,label);
 assert.equal(pose.selected.LEFT_GAUNTLET,'forge_left_bionic_v1',label+': wrong selected left option');
 const visible=new Set(pose.visibleObjectIds);
 assert.ok(visible.has(row.customObjectId),label+': bionic object missing');
 for(const id of row.connectorObjectIds)assert.ok(visible.has(id),label+': native connector '+id+' missing');
 const unexpected=row.excludeObjectIds.filter(id=>visible.has(id));
 assert.deepEqual(unexpected,[],label+': incompatible native left geometry remains visible');
 const missing=(pose.missingRequiredNames??[]).filter(name=>!row.intentionallyExcludedMeshNames.includes(name));
 assert.deepEqual(missing,[],label+': missing selected parts');
 const entries=pose.entries.filter(entry=>entry.objectId===row.customObjectId);
 assert.equal(entries.length,row.meshNames.length,label+': missing bionic mesh part');
 for(const name of row.meshNames)assert.ok(entries.some(entry=>entry.source===name),label+': missing '+name);
}
function movement(rest,mid,objectId){
 const entries=rest.entries.filter(entry=>entry.objectId===objectId);
 let maxCoordinateDelta=0,maxExtent=0;
 for(const first of entries){
  const second=mid.entries.find(entry=>entry.objectId===objectId&&entry.source===first.source);
  assert.ok(second,'Animated bionic mesh missing: '+first.source);
  for(let axis=0;axis<3;axis++){
   maxCoordinateDelta=Math.max(maxCoordinateDelta,Math.abs(first.min[axis]-second.min[axis]),Math.abs(first.max[axis]-second.max[axis]));
   maxExtent=Math.max(maxExtent,second.max[axis]-second.min[axis]);
  }
 }
 assert.ok(Number.isFinite(maxCoordinateDelta)&&maxCoordinateDelta>1e-6,'Bionic arm did not move at the selected mid-pose');
 assert.ok(maxCoordinateDelta<3&&maxExtent<4,'Bionic deformation escaped bounded movement');
 return {maxCoordinateDelta,maxExtent};
}
async function selectPart(page,slotOption){
 await page.locator('#part-search').fill(slotOption.id);
 const buttons=page.locator('#part-grid button:not([disabled])');
 await buttons.first().waitFor();
 const labels=await buttons.evaluateAll(nodes=>nodes.map((node,i)=>({i,label:node.querySelector('.label')?.childNodes[0]?.textContent?.trim()})));
 const matches=labels.filter(item=>item.label===optionLabel(slotOption));
 assert.equal(matches.length,1,'Part card is missing or ambiguous: '+slotOption.id);
 const preview=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/preview'&&response.request().method()==='POST');
 await buttons.nth(matches[0].i).click();
 const response=await preview;assert.ok(response.ok(),'Selected part preview must build successfully');
 const record=await response.json();assert.match(record.url,/^\/previews\/[^/]+\/[^/]+\.glb$/);
 await ready(page,await page.locator('#body-class').inputValue());await renderSettled(page);return record;
}
async function screenshot(page,file){
 await renderSettled(page);const target=path.join(out,file);await page.locator('#stage').screenshot({path:target});return target;
}
async function mode(page,gait,stance,classId){
 if(await page.locator('#motion-gait').inputValue()!==gait){await page.selectOption('#motion-gait',gait);await ready(page,classId)}
 if(await page.locator('#walk-style').inputValue()!==stance){await page.selectOption('#walk-style',stance);await ready(page,classId)}
 await page.locator('#walk-reset').click();
}
async function observeModelNetwork(page,row){
 const session=await context.newCDPSession(page),requests=new Map();await session.send('Network.enable');
 session.on('Network.requestWillBeSent',event=>{
  if(!/\/previews\/[^/]+\/[^/]+\.glb(?:\?|$)/.test(event.request.url))return;
  const entry={classId:row.classId,requestId:event.requestId,url:event.request.url,frameId:event.frameId,
   loaderId:event.loaderId,type:event.type,method:event.request.method,phase:row.phase??'loading',
   startedTimestamp:event.timestamp,wallTime:event.wallTime,initiator:event.initiator,receivedDataLength:0,receivedEncodedDataLength:0};
  requests.set(event.requestId,entry);report.networkLifecycle.push(entry);
 });
 session.on('Network.responseReceived',event=>{
  const entry=requests.get(event.requestId);if(!entry)return;
  entry.response={timestamp:event.timestamp,status:event.response.status,headers:event.response.headers,
   fromDiskCache:event.response.fromDiskCache,fromServiceWorker:event.response.fromServiceWorker};
 });
 session.on('Network.dataReceived',event=>{const entry=requests.get(event.requestId);if(entry){entry.receivedDataLength+=event.dataLength;entry.receivedEncodedDataLength+=event.encodedDataLength}});
 session.on('Network.loadingFinished',event=>{const entry=requests.get(event.requestId);if(entry)entry.finished={timestamp:event.timestamp,encodedDataLength:event.encodedDataLength,phase:row.phase??'active'}});
 session.on('Network.loadingFailed',event=>{const entry=requests.get(event.requestId);if(entry)entry.failed={timestamp:event.timestamp,errorText:event.errorText,canceled:event.canceled,blockedReason:event.blockedReason,phase:row.phase??'active'}});
}

try{
 const health=await jsonGET('/api/health');assert.equal(health.resourcesReady,true);
 if(process.env.FORGE_REQUIRE_BUNDLED==='1')assert.equal(health.dataSource,'bundled','Acceptance must use the included resource library');
 report.health=health;
 const catalog=await jsonGET('/api/catalog');
 const availableClasses=catalog.armor.classes.filter(c=>c.available&&expectedClasses.has(c.id));
 assert.deepEqual([...availableClasses.map(c=>c.id)].sort(),[...expectedClasses.keys()].sort(),'All seven native classes must be available');
 const classes=availableClasses.filter(c=>!requestedClassIds||requestedClassIds.includes(c.id));
 context=await playwright.chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1500,height:1050},
  executablePath:executable,timeout:60000,args:['--enable-unsafe-swiftshader','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check']});
 for(const cls of classes){
  const slot=cls.slots.find(s=>s.id==='LEFT_GAUNTLET'),option=slot?.options.find(o=>o.id==='forge_left_bionic_v1');
  assert.ok(option,cls.id+': bionic option missing from real catalogue');
  const customObjectId=expectedClasses.get(cls.id),connectorObjectIds=option.resolvedObjectIds.filter(id=>id!==customObjectId);
  assert.ok(option.resolvedObjectIds.includes(customObjectId));
  assert.ok(connectorObjectIds.length>0,cls.id+': expected native connector missing from option');
  const excludeObjectIds=option.forgeBionic?.excludeObjectIds??[];
  assert.ok(excludeObjectIds.length>0,cls.id+': no native-left compatibility exclusions');
  const metadata=await jsonGET('/retail-v5/'+cls.tpl+'.json');
  const row={classId:cls.id,asset:cls.tpl,customObjectId,connectorObjectIds,excludeObjectIds,
   meshNames:metadata.meshes.filter(m=>m.objectId===customObjectId).map(m=>m.name),
   intentionallyExcludedMeshNames:metadata.meshes.filter(m=>excludeObjectIds.includes(m.objectId)).map(m=>m.name),motions:[]};
  assert.ok(row.meshNames.length>0);report.classes.push(row);
  const page=currentPage=await context.newPage();page.setDefaultTimeout(180000);
  row.phase='loading';await observeModelNetwork(page,row);
  page.on('pageerror',error=>{report.pageErrors.push({classId:cls.id,message:error.message});report.browserErrors.push({classId:cls.id,type:'pageerror',message:error.message})});
  page.on('crash',()=>report.browserErrors.push({classId:cls.id,type:'crash',message:'Renderer process crashed'}));
  page.on('console',msg=>{if(msg.type()==='error'){report.consoleErrors.push({classId:cls.id,message:msg.text()});report.browserErrors.push({classId:cls.id,type:'console',message:msg.text()})}});
  page.on('response',response=>{if(response.status()>=400)report.httpFailures.push({classId:cls.id,url:response.url(),status:response.status()})});
  page.on('request',request=>{const url=new URL(request.url());if(url.origin!==base.origin&&!['data:','blob:'].includes(url.protocol))report.externalRequests.push({classId:cls.id,url:url.href})});
  page.on('requestfailed',request=>{
   const item={classId:cls.id,url:request.url(),error:request.failure()?.errorText,phase:row.phase??'active',time:new Date().toISOString(),timing:request.timing()};
   if(closingPages.has(page)&&item.error==='net::ERR_ABORTED')report.cancelledOnPageClose.push(item);
   else if(!page.isClosed())report.requestFailures.push(item);
  });
  await page.addInitScript(({roster,origin})=>{
   const nativeFetch=window.fetch.bind(window);window.__forgeQaBlockedRequests=[];
   window.__forgeQaBodyReceipts=[];window.__forgeQaAbortCalls=[];window.__forgeQaObserverErrors=[];
   const streams=new WeakMap(),readers=new WeakMap();
   const getReader=ReadableStream.prototype.getReader,read=ReadableStreamDefaultReader.prototype.read;
   const cancelReader=ReadableStreamDefaultReader.prototype.cancel,cancelStream=ReadableStream.prototype.cancel,abort=AbortController.prototype.abort;
   ReadableStream.prototype.getReader=function(...args){const reader=Reflect.apply(getReader,this,args),state=streams.get(this);if(state)readers.set(reader,state);return reader};
   ReadableStreamDefaultReader.prototype.read=function(...args){
    const promise=Reflect.apply(read,this,args),state=readers.get(this);
    if(state)promise.then(({done,value})=>{
     try{
      const receipt=state.receipt;receipt.readCalls++;
      if(done){
       receipt.cleanEOF=true;receipt.eofAt=Date.now();
       if(state.headerBytes===20){const h=new DataView(state.header.buffer);receipt.magic=h.getUint32(0,true);receipt.version=h.getUint32(4,true);receipt.declaredGLBLength=h.getUint32(8,true);receipt.jsonChunkLength=h.getUint32(12,true);receipt.jsonChunkType=h.getUint32(16,true)}
       if(state.binHeaderBytes===8){const h=new DataView(state.binHeader.buffer);receipt.binChunkLength=h.getUint32(0,true);receipt.binChunkType=h.getUint32(4,true)}
       return;
      }
      const start=receipt.receivedBytes,length=value.byteLength;receipt.receivedBytes+=length;
      if(start<20){const n=Math.min(20-start,length);state.header.set(value.subarray(0,n),start);state.headerBytes+=n}
      if(state.headerBytes===20){
       const binOffset=20+new DataView(state.header.buffer).getUint32(12,true),from=Math.max(start,binOffset),to=Math.min(start+length,binOffset+8);
       if(to>from){state.binHeader.set(value.subarray(from-start,to-start),from-binOffset);state.binHeaderBytes+=to-from}
      }
     }catch(error){window.__forgeQaObserverErrors.push(error.message)}
    },error=>{state.receipt.readerError=error.message});
    return promise;
   };
   ReadableStreamDefaultReader.prototype.cancel=function(...args){const state=readers.get(this);if(state)state.receipt.readerCancel={at:Date.now(),reason:String(args[0])};return Reflect.apply(cancelReader,this,args)};
   ReadableStream.prototype.cancel=function(...args){const state=streams.get(this);if(state)state.receipt.streamCancel={at:Date.now(),reason:String(args[0])};return Reflect.apply(cancelStream,this,args)};
   AbortController.prototype.abort=function(...args){window.__forgeQaAbortCalls.push({at:Date.now(),reason:String(args[0]),stack:new Error().stack});return Reflect.apply(abort,this,args)};
   window.fetch=(resource,init)=>{
    const url=new URL(typeof resource==='string'||resource instanceof URL?String(resource):resource.url,location.href);
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){
     window.__forgeQaBlockedRequests.push(url.href);return Promise.reject(new Error('QA blocked external fetch: '+url.href));
    }
    if(url.origin===origin&&['/api/roster','/api/workspace/single'].includes(url.pathname))return Promise.resolve(new Response(JSON.stringify(roster),{status:200,headers:{'Content-Type':'application/json'}}));
    const startedAt=Date.now(),promise=nativeFetch(resource,init);
    if(/\/previews\/[^/]+\/[^/]+\.glb$/.test(url.pathname))promise.then(response=>{
     const receipt={url:url.href,fetchStartedAt:startedAt,responseAt:Date.now(),status:response.status,
      contentLength:Number(response.headers.get('Content-Length')),receivedBytes:0,readCalls:0,cleanEOF:false,signalAborted:false};
     window.__forgeQaBodyReceipts.push(receipt);
     if(response.body)streams.set(response.body,{receipt,header:new Uint8Array(20),headerBytes:0,binHeader:new Uint8Array(8),binHeaderBytes:0});
     const signal=typeof resource==='object'&&resource.signal||init?.signal;
     if(signal){receipt.signalAborted=signal.aborted;signal.addEventListener('abort',()=>{receipt.signalAborted=true;receipt.signalAbortAt=Date.now()},{once:true})}
    },()=>{});
    return promise;
   };
   document.addEventListener('DOMContentLoaded',()=>{const icon=document.createElement('link');icon.rel='icon';icon.href='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';document.head.append(icon)},{once:true});
  },{origin:base.origin,roster:{soldiers:[{id:'qa_'+cls.id,role:'QA',classId:cls.id,selection:{},paint:{armor:'#171B22',metal:'#B3BDC9',lenses:'#EE291C'}}]}});
  await page.goto(new URL('/?inspect=1',base).href,{waitUntil:'domcontentloaded',timeout:240000});await ready(page,cls.id);
  const classIds=await page.locator('#body-class option').evaluateAll(nodes=>nodes.filter(n=>!n.disabled).map(n=>n.value));
  assert.equal(classIds.length,10);assert.ok([...expectedClasses.keys()].every(id=>classIds.includes(id)),'All seven native frames remain available alongside imported frames');
  if(await page.locator('#spin').isChecked())await page.locator('#spin').uncheck();
  const original=await inspect(page);finitePose(original,cls.id+' original');
  row.originalLeftOptionId=original.selected.LEFT_GAUNTLET;
  const originalOption=slot.options.find(o=>o.id===row.originalLeftOptionId);assert.ok(originalOption);
  assert.notEqual(originalOption.id,option.id,'Fresh class must start with an original left option');
  await page.locator('#categories button[data-group-id="gauntlets"]').click();await page.locator('#slot-subnav button[data-slot-id="LEFT_GAUNTLET"]').click();
  const bionicPreview=await selectPart(page,option);
  row.bionicPreview={...bionicPreview,url:new URL(bionicPreview.url,base).href};
  row.phase='bionic-selected';
  let selected=await inspect(page);checkBionicPose(selected,row,cls.id+' selected');row.selectedRest=selected;
  await page.locator('#focus').click();row.gripRestPNG=await screenshot(page,cls.id.toLowerCase()+'-grip-rest-detail.png');await page.locator('#fit').click();
  for(const gait of ['walk','run'])for(const stance of ['unarmed','armed']){
   row.phase='motion-'+gait+'-'+stance;
   await mode(page,gait,stance,cls.id);
   const rest=await inspect(page);checkBionicPose(rest,row,cls.id+' '+gait+'/'+stance+' rest');
   const prefix=cls.id.toLowerCase()+'-'+gait+'-'+stance;
   const restPNG=await screenshot(page,prefix+'-rest.png');
   await page.locator('#walk-play').click();
   await page.waitForFunction(()=>Number(document.querySelector('#walk-phase').value)>0,null,{timeout:60000});
   assert.equal(await page.locator('#walk-play').textContent(),'Pause','Preview must actually play');
   await page.locator('#walk-play').click();
   const frame=await page.locator('#walk-phase').evaluate(input=>{const f=Math.max(1,Math.floor(Number(input.max)*.5));input.value=String(f);input.dispatchEvent(new Event('input',{bubbles:true}));return f});
   const mid=await inspect(page);checkBionicPose(mid,row,cls.id+' '+gait+'/'+stance+' mid');
   assert.ok(Number.isFinite(mid.frame)&&mid.frame>0,'Mid-pose must have a nonzero animation time');
   const metrics=movement(rest,mid,customObjectId),midPNG=await screenshot(page,prefix+'-mid.png');
   row.motions.push({gait,stance,frame,metrics,restPNG,midPNG,rest,mid});
   if(gait==='run'&&stance==='armed'){await page.locator('#focus').click();row.gripArmedPNG=await screenshot(page,cls.id.toLowerCase()+'-grip-armed-detail.png');await page.locator('#fit').click()}
  }
  await page.locator('#walk-reset').click();
  row.phase='restore-native-left';
  await selectPart(page,originalOption);
  const restored=await inspect(page);finitePose(restored,cls.id+' restored original');
  assert.equal(restored.selected.LEFT_GAUNTLET,originalOption.id);assert.ok(!restored.visibleObjectIds.includes(customObjectId));
  if(originalOption.resolvedObjectIds?.length)assert.ok(originalOption.resolvedObjectIds.some(id=>restored.visibleObjectIds.includes(id)),'Original native left geometry must return');
  row.originalRestored={pose:restored,png:await screenshot(page,cls.id.toLowerCase()+'-original-restored.png')};
  await selectPart(page,option);selected=await inspect(page);checkBionicPose(selected,row,cls.id+' switch back');
  row.phase='metal-paint';
  const beforePNG=await screenshot(page,cls.id.toLowerCase()+'-metal-before.png'),metal='#3972c6';
  await page.locator('#metal-color').evaluate((input,color)=>{input.value=color;input.dispatchEvent(new Event('input',{bubbles:true}))},metal);
  const afterPNG=await screenshot(page,cls.id.toLowerCase()+'-metal-after.png');
  const beforeSHA256=hash(fs.readFileSync(beforePNG)),afterSHA256=hash(fs.readFileSync(afterPNG));
  assert.notEqual(beforeSHA256,afterSHA256,'Metal colour must change the rendered image');
  row.paint={metal:metal.toUpperCase(),beforePNG,afterPNG,beforeSHA256,afterSHA256};
  row.phase='share-code';
  await page.locator('#share-build').click();await page.waitForFunction(()=>document.querySelector('#recipe-code').value.startsWith('IHF1.'));
  const code=await page.locator('#recipe-code').inputValue(),recipe=await decodeRecipe(code);
  assert.equal(recipe.soldiers[0].classId,cls.id);assert.equal(recipe.soldiers[0].selection.LEFT_GAUNTLET,option.id);
  assert.equal(recipe.soldiers[0].paint.metal,metal.toUpperCase());
  assert.equal(recipe.soldiers[0].motion.gait,'run');assert.equal(recipe.soldiers[0].motion.stance,'armed');
  await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();
  row.phase='import-roundtrip';
  await selectPart(page,originalOption);assert.ok(!(await inspect(page)).visibleObjectIds.includes(customObjectId));
  await page.locator('#share-build').click();await page.waitForFunction(()=>document.querySelector('#recipe-code').value.startsWith('IHF1.'));
  await page.locator('#recipe-code').fill(code);await page.locator('#import-code').click();
  await page.waitForFunction(()=>document.querySelector('#recipe-message').textContent.startsWith('Build restored.'),null,{timeout:240000});
  await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();await ready(page,cls.id);
  const imported=await inspect(page);checkBionicPose(imported,row,cls.id+' IHF1 round trip');
  assert.equal((await page.locator('#metal-color').inputValue()).toLowerCase(),metal);
  row.shareRoundTrip={codeLength:code.length,codeSHA256:hash(Buffer.from(code)),recipe,imported};
  row.phase='save-squad';
  await page.locator('#save-roster').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Marine saved.'));
  const persisted=await jsonGET('/api/roster'),savedSoldier=persisted.soldiers.find(s=>s.classId===cls.id);
  assert.ok(savedSoldier,'Saved squad must contain the active class');
  assert.equal(savedSoldier.selection.LEFT_GAUNTLET,option.id);assert.equal(savedSoldier.paint.metal.toUpperCase(),metal.toUpperCase());
  row.savedSquad={classId:savedSoldier.classId,leftOption:savedSoldier.selection.LEFT_GAUNTLET,metal:savedSoldier.paint.metal};
  row.phase='export-json-glb';
  await page.locator('#share-build').click();await page.waitForFunction(()=>document.querySelector('#recipe-code').value.startsWith('IHF1.'));
  await page.locator('#export-json').click();
  await page.waitForFunction(()=>document.querySelector('#recipe-message').textContent.startsWith('JSON saved:'));
  const recipeFile=(await page.locator('#recipe-message').textContent()).slice('JSON saved: '.length);
  absoluteArtifact(recipeFile);const savedRecipe=JSON.parse(fs.readFileSync(recipeFile,'utf8'));
  assert.equal(savedRecipe.soldiers[0].selection.LEFT_GAUNTLET,option.id);assert.equal(savedRecipe.soldiers[0].paint.metal,metal.toUpperCase());
  await page.locator('#build-model').click();
  await page.waitForFunction(()=>/^(GLB build ready:|Could not build the model:)/.test(document.querySelector('#recipe-message').textContent),null,{timeout:300000});
  const buildMessage=await page.locator('#recipe-message').textContent();assert.ok(buildMessage.startsWith('GLB build ready:'),buildMessage);
  const buildDirectory=buildMessage.slice('GLB build ready: '.length),jobId=path.basename(buildDirectory),job=await jsonGET('/api/jobs/'+jobId);
  assert.equal(job.status,'complete');assert.equal(job.result.files.length,1);
  const builtFile=absoluteArtifact(path.join(buildDirectory,job.result.files[0].file));
  const built=fs.readFileSync(builtFile);assert.equal(hash(built),job.result.files[0].sha256);assert.equal(built.readUInt32LE(0),0x46546c67);assert.equal(built.readUInt32LE(8),built.length);
  const gltf=JSON.parse(built.subarray(20,20+built.readUInt32LE(12))),visibleNodes=gltf.nodes.filter(n=>n.mesh!==undefined);
  assert.ok(visibleNodes.some(n=>n.extras?.sourceObjectId===customObjectId));
  assert.deepEqual(visibleNodes.filter(n=>excludeObjectIds.includes(n.extras?.sourceObjectId)).map(n=>n.extras.sourceObjectId),[]);
  for(const name of row.meshNames)assert.ok(gltf.meshes.some(mesh=>mesh.name===name),'Export missing '+name);
  const helperCount=gltf.nodes.filter(n=>n.extras?.forgeBionicHelper||n.extras?.forgeLeftBionicHelper).length;
  assert.equal(helperCount,cls.id==='PVE_PVP_TANK'?0:18,'Export must preserve weighted and unweighted helper nodes');
  assert.equal(gltf.accessors[gltf.skins[0].inverseBindMatrices].count,gltf.skins[0].joints.length);
  assert.ok(gltf.animations?.length>0);assert.match(gltf.animations[0].name,/run armed/);
  row.backendExport={recipeFile,builtFile,bytes:built.length,sha256:hash(built),helperCount,skinJoints:gltf.skins[0].joints.length,meshes:gltf.meshes.length,animations:gltf.animations.length};
  await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();
  row.phase='network-idle';await page.waitForLoadState('networkidle',{timeout:60000});
  report.blockedRequests.push(...await page.evaluate(()=>window.__forgeQaBlockedRequests??[]));
  row.bodyReadProof=await page.evaluate(()=>({receipts:window.__forgeQaBodyReceipts,abortCalls:window.__forgeQaAbortCalls,observerErrors:window.__forgeQaObserverErrors}));
  assert.deepEqual(row.bodyReadProof.observerErrors,[]);
  row.passed=true;console.log('LEFT_BIONIC_BROWSER_CLASS',cls.id,'motions',row.motions.length,'meshes',selected.meshes);
  row.phase='closing';closingPages.add(page);
  await page.close();currentPage=null;
 }
 assert.equal(report.classes.length,classes.length);assert.ok(report.classes.every(c=>c.passed&&c.motions.length===4));
 const cdpContentLength=entry=>Number(Object.entries(entry.response?.headers??{}).find(([key])=>key.toLowerCase()==='content-length')?.[1]);
 function completeConsumerProof(row,entry){
  // The same cached preview is fetched again when switching back to a part.
  // Require a unique mutual timestamp match, rather than conflating those bodies.
  const sameStart=(wallTime,fetchStartedAt)=>Number.isFinite(wallTime)&&Number.isFinite(fetchStartedAt)&&Math.abs(wallTime*1000-fetchStartedAt)<=25;
  const candidates=row.bodyReadProof.receipts.filter(receipt=>receipt.url===entry.url&&sameStart(entry.wallTime,receipt.fetchStartedAt));
  if(candidates.length!==1)return null;
  const receipt=candidates[0],length=cdpContentLength(entry);
  const requests=report.networkLifecycle.filter(other=>other.classId===row.classId&&other.url===entry.url&&sameStart(other.wallTime,receipt.fetchStartedAt));
  if(requests.length!==1||requests[0]!==entry)return null;
  if(receipt.status!==200||entry.response?.status!==200||!receipt.cleanEOF||receipt.readerError||receipt.readerCancel||receipt.streamCancel||receipt.signalAborted||row.bodyReadProof.abortCalls.length)return null;
  if(!Number.isSafeInteger(length)||length<=0||entry.receivedDataLength!==length||receipt.receivedBytes!==length||receipt.contentLength!==length||receipt.declaredGLBLength!==length)return null;
  if(receipt.magic!==0x46546c67||receipt.version!==2||receipt.jsonChunkType!==0x4e4f534a||receipt.binChunkType!==0x004e4942||28+receipt.jsonChunkLength+receipt.binChunkLength!==length)return null;
  return receipt;
 }
 report.requestFailures=report.requestFailures.filter(item=>{
  const row=report.classes.find(c=>c.classId===item.classId),entries=report.networkLifecycle.filter(entry=>entry.classId===item.classId&&entry.url===item.url&&entry.failed&&Number.isFinite(item.timing?.startTime)&&Math.abs(entry.wallTime*1000-item.timing.startTime)<=25);
  if(item.error==='net::ERR_ABORTED'&&entries.length===1&&entries[0].failed.canceled===true){
   const receipt=completeConsumerProof(row,entries[0]);
   if(receipt){report.completedByteStreamCancellations.push({event:item,requestId:entries[0].requestId,frameId:entries[0].frameId,receipt,
    reason:'The assembled preview body reader reached clean EOF, all declared bytes and both GLB chunk headers are complete, and no abort/cancel/signal call occurred. CDP cancellation is retained as transport bookkeeping; unknown/incomplete transfers still fail.'});return false}
  }
  return true;
 });
 for(const row of report.classes){
  const transfers=report.networkLifecycle.filter(entry=>entry.classId===row.classId&&entry.url===row.bionicPreview.url);
  const complete=transfers.filter(entry=>{
   const length=cdpContentLength(entry),consumer=completeConsumerProof(row,entry);
   return entry.response?.status===200&&Number.isSafeInteger(length)&&length>0&&entry.receivedDataLength===length&&
    (entry.finished&&!entry.failed||consumer&&entry.failed?.canceled&&entry.failed.errorText==='net::ERR_ABORTED');
  });
  assert.ok(complete.length>0,row.classId+': exact selected bionic preview GLB must finish with all declared bytes received');
  row.assembledTransferProof=complete.map(entry=>({requestId:entry.requestId,url:entry.url,frameId:entry.frameId,
   declaredBytes:cdpContentLength(entry),receivedBytes:entry.receivedDataLength,finishedTimestamp:entry.finished?.timestamp,
   consumerEOF:!!completeConsumerProof(row,entry),completion:entry.finished?'CDP-loadingFinished':'consumer-clean-EOF-with-CDP-cancel'}));
 }
 assert.deepEqual(report.browserErrors,[]);assert.deepEqual(report.httpFailures,[]);assert.deepEqual(report.requestFailures,[]);assert.deepEqual(report.blockedRequests,[]);assert.deepEqual(report.externalRequests,[]);
 report.passed=true;
}catch(error){
 report.failure={message:error.message,stack:error.stack};process.exitCode=1;
 if(currentPage&&!currentPage.isClosed())try{await currentPage.screenshot({path:path.join(out,'failure.png')})}catch{}
 console.error('LEFT_BIONIC_BROWSER_QA_FAILED',error.message);
}finally{
 report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 if(context)await context.close();
}
console.log(JSON.stringify({passed:report.passed,classes:report.classes.filter(c=>c.passed).length,
 motions:report.classes.reduce((n,c)=>n+c.motions.length,0),browserErrors:report.browserErrors.length,
 httpFailures:report.httpFailures.length,completedByteStreamCancellations:report.completedByteStreamCancellations.length,report:path.join(out,'report.json'),failure:report.failure?.message}));
