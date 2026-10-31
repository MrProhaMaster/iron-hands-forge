import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {decodeRecipe} from '../shared/recipe-codec.mjs';
import {armourSlotGroups} from '../shared/armour-slots.mjs';
import {IRON_HANDS_COMPANIES,heraldryCompatibility} from '../shared/heraldry-options.mjs';
const args={};for(let i=2;i<process.argv.length;i+=2){assert(['--url','--out'].includes(process.argv[i]));args[process.argv[i]]=process.argv[i+1]}
assert(args['--url']&&args['--out'],'Use --url LOOPBACK_URL --out QA_DIRECTORY');
const base=new URL(args['--url']);assert.equal(base.hostname,'127.0.0.1');assert.equal(base.protocol,'http:');
const out=path.resolve(args['--out']);fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),{chromium}=require(process.env.FORGE_PLAYWRIGHT||'playwright');
const report={schema:'forge-release-browser-qa-v1',passed:false,classes:[],companies:[],groups:[],searchChecks:0,blockedRequests:[],httpFailures:[],pageErrors:[],consoleErrors:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
let context,shortBrowserRoot;
try{
 const health=await fetch(new URL('/api/health',base)).then(r=>r.json());assert.equal(health.version,'0.5.0');assert.equal(health.resourcesReady,true);report.health=health;
 if(process.env.FORGE_REQUIRE_BUNDLED==='1')assert.equal(health.dataSource,'bundled');
 const catalog=await fetch(new URL('/api/catalog',base)).then(r=>r.json());const frames=catalog.armor.classes.filter(c=>c.available&&catalog.manifest.assets.some(a=>a.asset===c.tpl));assert.equal(frames.length,10);
 // Chromium's Unix socket must fit sockaddr_un even under long CI output paths.
 shortBrowserRoot=process.platform==='linux'?fs.mkdtempSync('/tmp/ihfr-'):null;
 const profile=shortBrowserRoot?path.join(shortBrowserRoot,'p'):path.join(out,'browser-profile'),temp=shortBrowserRoot?path.join(shortBrowserRoot,'t'):path.join(profile,'temp');fs.mkdirSync(temp,{recursive:true});
 const browserOptions={headless:true,viewport:{width:1440,height:1050},timeout:60000,env:{...process.env,TEMP:temp,TMP:temp,TMPDIR:temp},args:['--enable-unsafe-swiftshader','--disable-background-networking','--disk-cache-dir='+path.join(profile,'cache')]};
 if(process.env.FORGE_BROWSER)browserOptions.executablePath=process.env.FORGE_BROWSER;
 context=await chromium.launchPersistentContext(profile,browserOptions);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base.origin&&!['data:','blob:'].includes(url.protocol)){report.blockedRequests.push(url.href);return route.abort()}return route.continue()});
 const page=await context.newPage();page.setDefaultTimeout(240000);
 await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const link=document.createElement('link');link.rel='icon';link.href='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';document.head.append(link);const style=document.createElement('style');style.textContent='#qa-inspector{display:none!important}';document.head.append(style)},{once:true}));
 page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text())});
 page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))report.httpFailures.push({status:r.status(),url:r.url()})});
 async function pose(){return page.evaluate(()=>{document.querySelector('#inspect-pose').click();return JSON.parse(document.querySelector('#inspect-result').textContent)})}
 async function ready(id){await page.waitForFunction(expected=>document.querySelector('#inspect-pose')&&document.querySelector('#loading')?.hidden&&(!expected||document.querySelector('#body-class').value===expected),id||null,{timeout:240000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const value=await pose();assert(value.meshes>0&&value.vertices>500);assert(value.entries.every(e=>e.bounds.length===3&&e.bounds.every(Number.isFinite)));return value}
 async function chooseFrame(id){const waiting=page.waitForResponse(r=>r.url()===new URL('/api/preview',base).href&&r.request().method()==='POST');await page.selectOption('#body-class',id);await waiting;return ready(id)}
 async function chooseEmblem(group,id){const waiting=page.waitForResponse(r=>r.url()===new URL('/api/preview',base).href&&r.request().method()==='POST');await page.selectOption('#'+group+'-choice',id);const response=await waiting;assert.equal(response.status(),200);const result=await response.json();await ready();const data=Buffer.from(await fetch(new URL(result.url,base)).then(r=>r.arrayBuffer()));assert.equal(data.readUInt32LE(0),0x46546c67);return JSON.parse(data.subarray(20,20+data.readUInt32LE(12)))}
 await page.goto(new URL('/?inspect=1',base).href,{waitUntil:'domcontentloaded'});await ready();assert.equal(await page.locator('#soldiers button').count(),1);
 assert.equal(await page.locator('#decal-slot').count(),0);assert.equal(await page.locator('#decal-choice').count(),0);
 const labels=await page.locator('#categories button').allTextContents();assert.deepEqual(labels,['Helm','Accessories','Pauldrons','Breastplate','Cloak','Wargear','Head','Gauntlets','Greaves','Tabard']);report.groups=labels;
 const companyIds=await page.locator('#company-choice option').evaluateAll(xs=>xs.map(x=>x.value).filter(Boolean));assert.deepEqual(companyIds,IRON_HANDS_COMPANIES.map(c=>c.id));assert.equal(companyIds.length,10);
 const chapterIds=await page.locator('#chapter-choice option').evaluateAll(xs=>xs.map(x=>x.value).filter(Boolean));assert.equal(chapterIds.length,5);
 const order=await page.locator('.heraldry .field>select').evaluateAll(xs=>xs.map(x=>x.id));assert.deepEqual(order,['chapter-choice','company-choice']);
 for(const frame of frames){
  const value=await chooseFrame(frame.id);assert.equal(value.classId,frame.id);
  for(const [slot,id]of Object.entries(value.selected)){const option=frame.slots.find(s=>s.id===slot)?.options.find(o=>o.id===id);assert(option&&!option.forgeUnavailable);assert(!/guardsman|astropath|com+issar/i.test(option.label||option.sourceOptionId||option.id))}
  const groups=armourSlotGroups(frame.slots).map(g=>({id:g.id,slots:g.slots.map(s=>s.id)}));
  const checks=await page.evaluate(({groups,terms})=>{let count=0;for(const group of groups)for(const slot of group.slots){document.querySelector('#categories button[data-group-id="'+group.id+'"]').click();const nav=document.querySelector('#slot-subnav');if(!nav.hidden)nav.querySelector('button[data-slot-id="'+slot+'"]').click();for(const term of terms){const input=document.querySelector('#part-search');input.value=term;input.dispatchEvent(new Event('input',{bubbles:true}));if(document.querySelectorAll('#part-grid button').length)throw Error('Excluded cards in '+slot+': '+term);count++}}return count},{groups,terms:['guardsman','astropath','comissar','commissar']});report.searchChecks+=checks;
  for(const [group,slot]of[['chapter','LEFT_PAULDRON'],['company','RIGHT_PAULDRON']]){const option=frame.slots.find(s=>s.id===slot).options.find(o=>o.id===value.selected[slot]);assert.equal(await page.locator('#'+group+'-choice').isEnabled(),heraldryCompatibility(option,group).supported)}
  report.classes.push({classId:frame.id,meshes:value.meshes,vertices:value.vertices,finite:true,searchChecks:checks});
  if(['PVE_PVP_SOLDIER','PVE_PVP_CHARACTER_MOD_1','PVE_PVP_CHARACTER_MOD_2'].includes(frame.id))await page.screenshot({path:path.join(out,'frame-'+frame.id+'.png'),fullPage:true});console.log('RELEASE_FRAME',frame.id,value.meshes);
 }
 await chooseFrame('PVE_PVP_SOLDIER');await page.locator('#part-search').fill('');
 await chooseEmblem('chapter','Left_Pau_Decal_Iron_Hands');
 const chapter=(await pose()).appearance.decals.LEFT_PAULDRON;
 for(const company of IRON_HANDS_COMPANIES){const gltf=await chooseEmblem('company',company.id),value=await pose();assert.deepEqual(value.appearance.decals.LEFT_PAULDRON,chapter);assert.equal(value.appearance.decals.RIGHT_PAULDRON.id,company.id);const materials=gltf.materials.filter(m=>m.extras?.forgeDecal);assert(materials.some(m=>m.extras.sourceDecal===chapter.id&&m.extras.forgeSlot==='LEFT_PAULDRON'));assert(materials.some(m=>m.extras.sourceDecal===company.id&&m.extras.forgeSlot==='RIGHT_PAULDRON'));report.companies.push({id:company.id,rendered:true,fixedSide:'RIGHT_PAULDRON',chapterRetained:true});console.log('RELEASE_COMPANY',company.label)}
 await page.screenshot({path:path.join(out,'chapter-company.png'),fullPage:true});
 await page.click('#save-roster');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Marine saved'));
 const saved=JSON.parse(fs.readFileSync(path.join(health.stateRoot,'selected-roster.json'),'utf8'));assert.equal(saved.soldiers[0].appearance.decals.LEFT_PAULDRON.id,chapter.id);assert.equal(saved.soldiers[0].appearance.decals.RIGHT_PAULDRON.id,IRON_HANDS_COMPANIES.at(-1).id);
 await page.click('#share-build');await page.waitForFunction(()=>document.querySelector('#recipe-code')?.value.startsWith('IHF1.'));const code=await page.inputValue('#recipe-code'),recipe=await decodeRecipe(code);assert.equal(recipe.soldiers[0].appearance.decals.LEFT_PAULDRON.id,chapter.id);assert.equal(recipe.soldiers[0].appearance.decals.RIGHT_PAULDRON.id,IRON_HANDS_COMPANIES.at(-1).id);
 const buildResponse=page.waitForResponse(r=>r.url()===new URL('/api/build',base).href&&r.request().method()==='POST');await page.click('#build-model');const response=await buildResponse;assert.equal(response.status(),202);const jobStart=await response.json();let job;const deadline=Date.now()+240000;
 do{await new Promise(resolve=>setTimeout(resolve,300));job=await fetch(new URL('/api/jobs/'+jobStart.id,base)).then(r=>r.json())}while(job.status==='running'&&Date.now()<deadline);
 assert.equal(job.status,'complete',job.error);const file=path.join(job.out,job.result.files[0].file),bytes=fs.readFileSync(file);assert.equal(bytes.readUInt32LE(8),bytes.length);const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));assert.equal(gltf.asset.generator,'Iron Hands Forge 0.5.0');assert(gltf.images.length>=2&&gltf.images.every(i=>i.bufferView!==undefined&&!i.uri));
 report.build={bytes:bytes.length,meshes:gltf.meshes.length,images:gltf.images.length,generator:gltf.asset.generator,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),codeLength:code.length};
 await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
 assert.equal(report.companies.length,10);assert.equal(report.searchChecks,840);assert.deepEqual(report.blockedRequests,[]);assert.deepEqual(report.httpFailures,[]);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);report.passed=true;
}catch(e){report.error={message:e.message,stack:e.stack};process.exitCode=1;console.error(e)}finally{await context?.close();if(shortBrowserRoot)fs.rmSync(shortBrowserRoot,{recursive:true,force:true});save()}
console.log(JSON.stringify({passed:report.passed,classes:report.classes.length,companies:report.companies.length,searchChecks:report.searchChecks,build:report.build,report:path.join(out,'report.json')}));