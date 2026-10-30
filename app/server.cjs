'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {inspectResourceLibrary,resolveDataRoot}=require('../shared/resource-library.cjs');
const {loadBionicLibrary,loadBionicClass,augmentBionicRegistry}=require('../shared/left-bionic.cjs');
const {loadIronHandsLibrary,augmentIronHandsRegistry}=require('../shared/iron-hands-library.cjs');
const {migrateSingleWorkspace}=require('../shared/single-workspace.cjs');
const {loadAstartesLibrary,augmentAstartesRegistry}=require('../shared/astartes-library.cjs');
const APP_ROOT=path.resolve(__dirname,'..'),UI=__dirname,VERSION=JSON.parse(fs.readFileSync(path.join(APP_ROOT,'package.json'))).version;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.dds':'image/vnd-ms.dds'};
const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}};
function within(base,file){return file===base||file.startsWith(base+path.sep)}
function safeFile(base,relative){base=path.resolve(base);const file=path.resolve(base,relative);if(!within(base,file)||relative.includes('\0'))throw Object.assign(Error('Forbidden path'),{status:403});const realBase=fs.realpathSync(base),real=fs.realpathSync(file);if(!within(realBase,real))throw Object.assign(Error('Forbidden link'),{status:403});return real}
function atomicJSON(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n');fs.renameSync(temp,file)}
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>131072)throw Object.assign(Error('Request too large'),{status:413});chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
let motionPolicyPromise;const motionPolicy=()=>motionPolicyPromise??=import(pathToFileURL(path.join(APP_ROOT,'shared/motion-policy.mjs')).href);
let codecPromise;const codec=()=>codecPromise??=import(pathToFileURL(path.join(APP_ROOT,'shared/recipe-codec.mjs')).href);
let bionicResourcesPromise;const bionicResources=()=>bionicResourcesPromise??=import(pathToFileURL(path.join(APP_ROOT,'shared/bionic-resources.mjs')).href);
let servoPolicyPromise;const servoPolicy=()=>servoPolicyPromise??=import(pathToFileURL(path.join(APP_ROOT,'shared/servo-arm.mjs')).href);
let customizationPromise;const customizationCatalog=()=>customizationPromise??=import(pathToFileURL(path.join(APP_ROOT,'shared/customization-catalog.mjs')).href);
function createForgeServer(options={}){
 const stateRoot=path.resolve(APP_ROOT,options.stateRoot||'state');fs.mkdirSync(stateRoot,{recursive:true});
 const motionBindings=read(path.join(APP_ROOT,'shared/motion-bindings.json'));
 const bundledDataRoot=path.join(APP_ROOT,'data');
 let dataRoot=resolveDataRoot({appRoot:APP_ROOT,stateRoot,dataRoot:options.dataRoot,motionBindings});
 const resources=()=>inspectResourceLibrary(dataRoot,motionBindings);
 const dataSource=()=>dataRoot===bundledDataRoot?'bundled':'custom';
 const jobs=new Map(),children=new Set(),buildTool=options.buildTool||path.join(APP_ROOT,'tools/build_from_recipe.mjs');let activeJob=null;
 async function catalog(){const {augmentCustomizationRegistry}=await customizationCatalog(),{loadServoPose}=await servoPolicy();const servo=loadServoPose(dataRoot);const library=resources(),bionic=loadBionicLibrary(dataRoot),iron=loadIronHandsLibrary(dataRoot),astartes=loadAstartesLibrary(dataRoot),armor=augmentCustomizationRegistry(augmentAstartesRegistry(augmentIronHandsRegistry(augmentBionicRegistry(library.armor,bionic),iron),astartes)),m=library.manifest,assets=library.assets.map(a=>({...a,raw:undefined,metadata:undefined,sourceVersion:5,assetRevision:(()=>{try{const s=fs.statSync(path.join(dataRoot,'assets/characters/SM2-retail-constructors/source-v5',a.asset+'.glb'));return s.size+':'+s.mtimeMs+'|'+(bionic.classes.find(c=>c.asset===a.asset)?.revision||'native')}catch{return 'missing'}})()}));const semantic=(armor.classes||[]).map(c=>({id:c.id,slots:c.slots.map(s=>({id:s.id,options:s.options.map(o=>o.id).sort()})).sort((a,b)=>a.id.localeCompare(b.id))})).sort((a,b)=>a.id.localeCompare(b.id));return{native:{parts:[]},armor,manifest:{...m,game:undefined,output:undefined,assets},configured:library.configured,dataRoot,dataSource:dataSource(),resourceStatus:{ready:library.resourcesReady,bundled:library.bundled,missingFiles:library.missingFiles,issues:library.issues},motionBindings,motionRevision:(()=>{try{return String(fs.statSync(path.join(dataRoot,'assets/animations/motion-manifest.json')).mtimeMs)}catch{return 'legacy'}})(),registryFingerprint:crypto.createHash('sha256').update(JSON.stringify(semantic)).digest('hex'),gameBuild:String(m.gameBuild||armor.gameBuild||'unknown'),customization:{version:1,enabled:true,crossClass:true,singleWorkspace:true},cosmeticsRevision:iron.revision+'|'+servo.revision+'|'+astartes.revision,astartes:{ready:astartes.ready,revision:astartes.revision,profileIds:astartes.profiles.map(p=>p.id),optionCount:astartes.options.length,unavailableCount:astartes.unavailableOptions?.length||0,modelCount:astartes.models.length},servoPose:{ready:servo.ready,revision:servo.revision},cosmetics:{ready:iron.ready,decals:iron.decals,colors:iron.colors,armorTags:iron.armorTags}}}
 let previewServicePromise;const previews=()=>previewServicePromise??=import(pathToFileURL(path.join(APP_ROOT,'shared/studio-preview.mjs')).href).then(m=>m.createStudioPreview({getCatalog:catalog,getDataRoot:()=>dataRoot,stateRoot}));
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Iron-Hands-Forge',VERSION);
  const port=server.address()?.port||options.port||8767,host=(req.headers.host||'').toLowerCase();
  if(!['127.0.0.1:'+port,'localhost:'+port,'[::1]:'+port].includes(host))return send(res,403,{error:'Localhost access only'});
  if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port,'http://[::1]:'+port].includes(req.headers.origin))return send(res,403,{error:'Cross-origin requests are not accepted'});
  try{
   const url=new URL(req.url,'http://127.0.0.1:'+port),p=url.pathname;
   if(p==='/api/health'&&req.method==='GET')return send(res,200,{appId:'iron-hands-forge',version:VERSION,appRoot:APP_ROOT,dataRoot,stateRoot,port,ready:true,resourcesReady:resources().resourcesReady,dataSource:dataSource()});
   if(p==='/api/catalog'&&req.method==='GET')return send(res,200,await catalog());
   if((p==='/api/preview'||p==='/api/part-preview')&&req.method==='POST'){const data=await body(req),service=await previews();return send(res,200,await service.prepare(data,{partOnly:p==='/api/part-preview'}));}
   if(p==='/api/workspace/single'&&req.method==='POST'){await body(req);return send(res,200,migrateSingleWorkspace(stateRoot));}
   if(p==='/api/settings'&&req.method==='GET')return send(res,200,{dataRoot,stateRoot,configured:resources().configured,bundledDataRoot,bundledAvailable:inspectResourceLibrary(bundledDataRoot,motionBindings).resourcesReady,dataSource:dataSource()});
   if(p==='/api/settings'&&req.method==='POST'){
    const data=await body(req);let folder;
    if(data.useBundled===true){folder=bundledDataRoot;if(!inspectResourceLibrary(folder,motionBindings).resourcesReady)throw Error('The included armour library is incomplete. Extract the complete application archive again.');}
    else {if(typeof data.dataRoot!=='string'||!data.dataRoot.trim()||data.dataRoot.length>4096||data.dataRoot.includes('\0'))throw Error('Enter the folder containing prepared resources.');folder=path.resolve(APP_ROOT,data.dataRoot);const library=inspectResourceLibrary(folder,motionBindings);if(!library.configured||library.bundled&&!library.resourcesReady)throw Error('The selected library is incomplete. It needs a valid catalogue, paint data and verified GLB models with metadata.');}
    dataRoot=folder;const relative=path.relative(APP_ROOT,folder),portable=relative&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?relative:folder;
    atomicJSON(path.join(stateRoot,'settings.json'),{dataRoot:portable});return send(res,200,{saved:true,dataRoot,dataSource:dataSource()});
   }
   if(p==='/api/roster'&&req.method==='GET'){const choices=['draft-roster.json','selected-roster.json'].map(f=>path.join(stateRoot,f)).filter(fs.existsSync).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);return send(res,200,choices.length?read(choices[0],null):null)}
   if((p==='/api/draft'||p==='/api/save')&&req.method==='POST'){const data=await body(req),{normalizeRecipe}=await codec();const recipe=normalizeRecipe({schema:'iron-hands-forge',version:1,kind:'roster',catalog:{game:'SM2',build:'unknown'},soldiers:data.soldiers});atomicJSON(path.join(stateRoot,p==='/api/save'?'selected-roster.json':'draft-roster.json'),{schema:'medusa-draft-roster-v2',soldiers:recipe.soldiers,savedAt:new Date().toISOString()});return send(res,200,{saved:true})}
   if(p==='/api/recipes/export'&&req.method==='POST'){const data=await body(req),{normalizeRecipe,encodeRecipe}=await codec(),recipe=normalizeRecipe(data.recipe||data),text=JSON.stringify(recipe,null,2)+'\n',hash=crypto.createHash('sha256').update(text).digest('hex').slice(0,16),name='forge-'+hash+'.ihf.json';atomicJSON(path.join(stateRoot,'exports',name),recipe);return send(res,200,{saved:true,file:path.join(stateRoot,'exports',name),url:'/exports/'+name,code:await encodeRecipe(recipe)})}
   if(p==='/api/build'&&req.method==='POST'){if(activeJob)return send(res,409,{error:'A build is already in progress.'});const data=await body(req),{normalizeRecipe,decodeRecipe}=await codec(),recipe=data.code?await decodeRecipe(data.code):normalizeRecipe(data.recipe||data);if(activeJob)return send(res,409,{error:'A build is already in progress.'});const id=crypto.randomBytes(8).toString('hex'),out=path.join(stateRoot,'builds',id),input=path.join(out,'recipe.ihf.json');atomicJSON(input,recipe);const job={id,status:'running',startedAt:new Date().toISOString(),out};jobs.set(id,job);activeJob=id;const child=spawn(process.execPath,[buildTool,'--recipe',input,'--data-root',dataRoot,'--out',out],{cwd:APP_ROOT,windowsHide:true,env:{...process.env,TEMP:path.join(stateRoot,'cache'),TMP:path.join(stateRoot,'cache'),NODE_DISABLE_COMPILE_CACHE:'1'},stdio:['ignore','pipe','pipe']});children.add(child);let log='';child.stdout.on('data',b=>{log=(log+b).slice(-16000)});child.stderr.on('data',b=>{log=(log+b).slice(-16000)});child.on('error',e=>{job.status='failed';job.error=e.message;if(activeJob===id)activeJob=null});child.on('close',code=>{children.delete(child);job.status=code===0?'complete':'failed';job.finishedAt=new Date().toISOString();job.result=read(path.join(out,'build-manifest.json'),null);if(code!==0)job.error=log.slice(-4000);if(activeJob===id)activeJob=null;atomicJSON(path.join(out,'job.json'),job)});return send(res,202,{id,status:'running'})}
   if(/^\/api\/jobs\/[a-f0-9]{16}$/.test(p)&&req.method==='GET'){const job=jobs.get(p.split('/').at(-1));return send(res,job?200:404,job||{error:'Unknown job'})}
   const augmented=/^\/retail-v5\/(cc_sm_constructor_[a-z0-9_]+)\.(glb|json)$/.exec(p);
   if(augmented&&['GET','HEAD'].includes(req.method)&&loadBionicClass({dataRoot,asset:augmented[1]})){
    const {bionicResourcePlan,serveBionicPlan}=await bionicResources(),plan=bionicResourcePlan(dataRoot,augmented[1],augmented[2]);
    if(plan)return serveBionicPlan(req,res,plan);
   }
   let base,relative;
   if((p==='/api/walk'||p==='/api/motion')&&req.method==='GET'){const gait=p==='/api/walk'?'walk':url.searchParams.get('gait')||'walk',style=url.searchParams.get('style')||'unarmed',classId=url.searchParams.get('classId')||'PVE_PVP_SOLDIER';const {resolveMotionBinding}=await motionPolicy(),binding=resolveMotionBinding(read(path.join(APP_ROOT,'shared/motion-bindings.json')),classId,gait,style);const file=safeFile(path.join(dataRoot,'assets/animations'),binding.output);return send(res,200,{...read(file),binding})}
   else if(p==='/api/paints'){base=path.join(dataRoot,'production/roster');relative='armor-paints.json'}
   else if(p==='/'||p==='/index.html'||p==='/iron-hands-variants-preview.html'){base=UI;relative='index.html'}
   else if(p.startsWith('/web/')){base=path.join(UI,'web');relative=decodeURIComponent(p.slice(5))}
   else if(p.startsWith('/shared/')){base=path.join(APP_ROOT,'shared');relative=decodeURIComponent(p.slice(8))}
   else if(p.startsWith('/retail-v5/')){base=path.join(dataRoot,'assets/characters/SM2-retail-constructors/source-v5');relative=decodeURIComponent(p.slice(11))}
   else if(p.startsWith('/customization/')){base=path.join(dataRoot,'assets/customization');relative=decodeURIComponent(p.slice(15))}
   else if(p.startsWith('/previews/')){base=path.join(stateRoot,'previews');relative=decodeURIComponent(p.slice(10))}
   else if(p.startsWith('/exports/')){base=path.join(stateRoot,'exports');relative=decodeURIComponent(p.slice(9))}
   else return send(res,404,{error:'Not found'});
   if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'Method not allowed'});
   const file=safeFile(base,relative),stat=fs.statSync(file);if(!stat.isFile())return send(res,404,{error:'Not a file'});let start=0,end=stat.size-1,status=200;
   if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m)return send(res,416,{error:'Invalid range'});start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;if(!Number.isSafeInteger(start)||start>end){res.setHeader('Content-Range','bytes */'+stat.size);return send(res,416,{error:'Range out of bounds'})}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`)}
   res.writeHead(status,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Content-Length':Math.max(0,end-start+1),'Accept-Ranges':'bytes'});if(req.method==='HEAD'||stat.size===0)return res.end();const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch(e){const status=e.status||(['ENOENT','ENOTDIR'].includes(e.code)?404:400);if(!res.headersSent)send(res,status,{error:status===404?'Resource not found. Check the connected data folder.':e.message});else res.destroy()}
 });
 server.on('close',()=>{for(const child of children)child.kill()});
 return server;
}
module.exports={createForgeServer,safeFile};
if(require.main===module){const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){if(args[i]==='--port')options.port=Number(args[++i]);else if(args[i]==='--data-root')options.dataRoot=args[++i];else if(args[i]==='--state-root')options.stateRoot=args[++i];else throw Error('Unknown option '+args[i])}const server=createForgeServer(options);server.on('error',e=>{console.error(e.message);process.exitCode=1});server.listen(options.port??8767,'127.0.0.1',()=>console.log(JSON.stringify({appId:'iron-hands-forge',url:'http://127.0.0.1:'+server.address().port,version:VERSION})));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)))}
