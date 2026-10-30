'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
/** Keep the previous squad as an immutable backup before adopting one active marine. */
function migrateSingleWorkspace(stateRoot){
 const choices=['draft-roster.json','selected-roster.json'].map(n=>path.join(stateRoot,n)).filter(fs.existsSync).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
 if(!choices.length)return null;
 const source=choices[0],bytes=fs.readFileSync(source),saved=JSON.parse(bytes);
 if(!Array.isArray(saved.soldiers)||saved.soldiers.length<=1)return saved;
 const digest=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16),dir=path.join(stateRoot,'backups');
 fs.mkdirSync(dir,{recursive:true});const backup=path.join(dir,'squad-before-single-'+digest+'.json');
 try{fs.writeFileSync(backup,bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;if(!fs.readFileSync(backup).equals(bytes))throw Error('The saved squad backup is damaged. Your original workspace was preserved.');}
 const next={schema:'medusa-draft-roster-v2',soldiers:[saved.soldiers[0]],savedAt:new Date().toISOString(),workspace:{mode:'single',previousCount:saved.soldiers.length,backup:path.relative(stateRoot,backup).replaceAll('\\','/')}};
 const target=path.join(stateRoot,'draft-roster.json'),temp=target+'.single.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n');fs.renameSync(temp,target);return next;
}
module.exports={migrateSingleWorkspace};
