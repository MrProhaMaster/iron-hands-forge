// Run against an extracted release, never a developer data-root override.
// FORGE_PLAYWRIGHT can point to an installed Playwright package for release QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2)options[args[i]]=args[i+1];
if(!options['--url']||!options['--out'])throw Error('Usage: --url LOOPBACK_URL --out QA_DIRECTORY');
const base=new URL(options['--url']);
assert.equal(base.hostname,'127.0.0.1');
const out=path.resolve(options['--out']);fs.mkdirSync(out,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.FORGE_PLAYWRIGHT||'playwright');
const launch={headless:true,viewport:{width:1500,height:1050},args:['--enable-unsafe-swiftshader','--disable-background-networking'],timeout:60000};
if(process.env.FORGE_BROWSER)launch.executablePath=process.env.FORGE_BROWSER;
const context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),launch);
const report={passed:false,base:base.origin,classes:[],blockedRequests:[],httpFailures:[],pageErrors:[]};
try{
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==base.origin&&!['data:','blob:'].includes(url.protocol)){report.blockedRequests.push(url.href);return route.abort()}
  return route.continue();
 });
 const page=await context.newPage();page.setDefaultTimeout(180000);
 page.on('pageerror',error=>report.pageErrors.push(error.message));
 page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))report.httpFailures.push({url:response.url(),status:response.status()})});
 const health=await fetch(new URL('/api/health',base)).then(r=>r.json());
 assert.equal(health.resourcesReady,true);assert.equal(health.dataSource,'bundled');
 report.health=health;
 await page.goto(new URL('/?inspect=1',base).href,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#loading')?.hidden&&!document.querySelector('#walk-play')?.disabled);
 const classIds=await page.locator('#body-class option').evaluateAll(nodes=>nodes.filter(n=>!n.disabled).map(n=>n.value));
 assert.equal(classIds.length,7);
 for(const classId of classIds){
  await page.selectOption('#body-class',classId);
  await page.waitForFunction(id=>document.querySelector('#body-class').value===id&&document.querySelector('#loading').hidden&&!document.querySelector('#walk-play').disabled,classId);
  await page.click('#walk-reset');
  await page.click('#inspect-pose');
  const pose=JSON.parse(await page.locator('#inspect-result').textContent());
  assert.ok(pose.meshes>0&&pose.vertices>500,classId+' must show geometry');
  assert.deepEqual(pose.missingRequiredNames,[],classId+' missing selected parts');
  assert.ok(await page.locator('#part-grid button:not([disabled])').count()>0);
  await page.click('#share-build');
  await page.waitForFunction(()=>document.querySelector('#recipe-code').value.startsWith('IHF1.'));
  assert.match(await page.locator('#recipe-code').inputValue(),/^IHF1\./);
  await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();
  report.classes.push({classId,meshes:pose.meshes,vertices:pose.vertices,missingRequiredNames:pose.missingRequiredNames});
  console.log('BROWSER_CLASS',classId,pose.meshes,pose.vertices);
 }
 await page.selectOption('#body-class',classIds[0]);
 await page.waitForFunction(()=>document.querySelector('#loading').hidden&&!document.querySelector('#walk-play').disabled);
 await page.click('#walk-reset');
 await page.click('#inspect-pose');
 const before=JSON.parse(await page.locator('#inspect-result').textContent());
 const card=page.locator('#part-grid button:not([disabled])[aria-pressed="false"]').first();
 await card.click();await page.click('#inspect-pose');
 const after=JSON.parse(await page.locator('#inspect-result').textContent());
 assert.notDeepEqual(after.selected,before.selected,'changing an armour part must change the build');
 assert.notDeepEqual(after.visibleObjectIds,before.visibleObjectIds,'changing an armour part must replace visible geometry');
 await page.screenshot({path:path.join(out,'before-paint.png')});
 await page.locator('#armor-color').evaluate(input=>{input.value='#B22035';input.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.waitForTimeout(400);
 await page.screenshot({path:path.join(out,'after-paint.png')});
 const beforeHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,'before-paint.png'))).digest('hex');
 const afterHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,'after-paint.png'))).digest('hex');
 assert.notEqual(afterHash,beforeHash,'the rendered colour must change');
 await page.selectOption('#motion-gait','run');await page.selectOption('#walk-style','armed');
 await page.waitForFunction(()=>!document.querySelector('#walk-play').disabled);
 await page.locator('#walk-speed').evaluate(input=>{input.value='2';input.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.click('#share-build');
 await page.waitForFunction(()=>document.querySelector('#recipe-code').value.startsWith('IHF1.'));
 const code=await page.locator('#recipe-code').inputValue();assert.match(code,/^IHF1\./);
 await page.click('#export-json');
 await page.waitForFunction(()=>document.querySelector('#recipe-message').textContent.startsWith('JSON saved:'));
 const jsonPath=(await page.locator('#recipe-message').textContent()).slice('JSON saved: '.length);
 const recipe=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
 assert.equal(recipe.soldiers[0].paint.armor,'#B22035');
 assert.equal(recipe.soldiers[0].motion.speedPct,200);
 const built=await fetch(new URL('/api/build',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
 assert.equal(built.status,202);const job=await built.json();let result;
 const deadline=Date.now()+180000;
 do{await new Promise(r=>setTimeout(r,300));result=await fetch(new URL('/api/jobs/'+job.id,base)).then(r=>r.json())}while(result.status==='running'&&Date.now()<deadline);
 assert.equal(result.status,'complete',result.error);assert.equal(result.result.files.length,1);
 const glb=fs.readFileSync(path.join(result.out,result.result.files[0].file));
 assert.ok(glb.length>10000);assert.equal(glb.readUInt32LE(0),0x46546c67);assert.equal(glb.readUInt32LE(8),glb.length);
 const gltf=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString().trim());
 assert.ok(gltf.meshes.length>0);assert.ok(gltf.animations.length>0);
 report.build={bytes:glb.length,meshes:gltf.meshes.length,animations:gltf.animations.length,codeLength:code.length};
 await page.locator('#recipe-dialog button[aria-label="Close build code"]').click();
 await page.click('#settings-open');await page.waitForFunction(()=>document.querySelector('#settings-message').textContent.includes('Included armour library is ready'));
 await page.click('#use-bundled');await page.waitForFunction(()=>!document.querySelector('#settings-dialog').open);
 assert.equal((await fetch(new URL('/api/health',base)).then(r=>r.json())).dataSource,'bundled');
 assert.deepEqual(report.blockedRequests,[],'the application must not attempt external requests');
 assert.deepEqual(report.httpFailures,[]);assert.deepEqual(report.pageErrors,[]);
 report.passed=true;
}finally{
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 await context.close();
}
console.log(JSON.stringify({passed:report.passed,classes:report.classes.length,build:report.build,report:path.join(out,'report.json')}));
