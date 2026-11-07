import {mkdir,readFile,writeFile,lstat,realpath,open,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {offlineSnapshot} from './offline-snapshot.mjs';
import {verifyRestoredData,dataManifest} from './verify-restored-data.mjs';
const role=/^[a-z][a-z0-9-]{0,39}$/;
function roots(value){
 const selectedValid=r=>Array.isArray(r.selectedFiles)&&r.selectedFiles.length>0&&r.selectedFiles.length<=30&&r.directory===undefined&&new Set(r.selectedFiles.map(x=>x?.name)).size===r.selectedFiles.length&&r.selectedFiles.every(x=>x&&typeof x.source==='string'&&isAbsolute(x.source)&&resolve(x.source)===x.source&&typeof x.name==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(x.name)&&!['.','..'].includes(x.name));
 if(!Array.isArray(value)||!value.length||value.length>20||new Set(value.map(r=>r?.id)).size!==value.length||value.some(r=>!r||!role.test(r.id)||!(typeof r.directory==='string'&&r.selectedFiles===undefined||selectedValid(r))||!Array.isArray(r.required)||r.required.some(p=>typeof p!=='string'||p.startsWith('/')||p.split('/').some(x=>x==='..'||x==='.'))))throw new Error('Ugyldigt backupkort. Angiv id, directory eller selectedFiles og required for hver rod.');
 for(const id of ['data','configuration'])if(!value.some(r=>r.id===id))throw new Error('Backupkortet skal omfatte data og configuration. Tilføj alle eksterne projektmapper særskilt.');
 return value;
}
async function selectedSnapshot(item,target){
 await mkdir(target,{mode:0o700});
 for(const entry of item.selectedFiles){
  if(await realpath(entry.source)!==entry.source)throw new Error('Symlink i valgt konfigurationsfil.');
  const handle=await open(entry.source,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>2000000)throw new Error('Kun afgrænsede regulære konfigurationsfiler.');bytes=await handle.readFile();const after=await handle.stat(),pathStat=await lstat(entry.source);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||pathStat.ino!==stat.ino||pathStat.isSymbolicLink())throw new Error('Konfigurationsfilen ændrede sig under backup.');const to=join(target,entry.name);await writeFile(to,bytes,{flag:'wx',mode:stat.mode&0o700});await chmod(to,stat.mode&0o700);
  }finally{bytes?.fill(0);await handle.close();}
 }
 const files=await dataManifest(target);if(item.required.some(name=>!files.some(f=>f.path===name)))throw new Error('En krævet valgt konfigurationsfil mangler.');
}

export async function createBackupBundle(mapping,destination,{quiescent=false}={}){
 if(!quiescent)throw new Error('Stop service og alle skrivere først.');
 const input=roots(mapping.roots);destination=resolve(destination);
 if(await realpath(dirname(destination))!==dirname(destination))throw new Error('Symlink i destinationen.');
 await mkdir(destination,{mode:0o700});
 const report={format:1,at:new Date().toISOString(),quiescence:'operator_asserted',complete:false,roots:[]};
 for(const item of input){const target=join(destination,item.id);
  if(item.selectedFiles)await selectedSnapshot(item,target);else await offlineSnapshot(resolve(item.directory),target,{quiescent:true,required:item.required});
  report.roots.push({id:item.id,...(item.selectedFiles?{originalFiles:item.selectedFiles}:{originalDirectory:resolve(item.directory)}),required:item.required,files:await dataManifest(target)});
 }
 report.complete=true;await writeFile(join(destination,'manifest.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});return {complete:true,roots:report.roots.map(x=>x.id),scope:'Offline named roots, including settings and explicit project/config directories. No service start or encryption.'};
}
export async function restoreBackupBundle(source,destination,{quiescent=false}={}){
 if(!quiescent)throw new Error('Restore skal udføres isoleret uden skrivere.');
 source=resolve(source);destination=resolve(destination);
 if(await realpath(source)!==source||await realpath(dirname(destination))!==dirname(destination))throw new Error('Symlink i restorestien.');
 const manifestPath=join(source,'manifest.json');if((await lstat(manifestPath)).isSymbolicLink())throw new Error('Ugyldigt manifest.');
 const manifest=JSON.parse(await readFile(manifestPath));
 if(manifest.format!==1||manifest.complete!==true)throw new Error('Backup er ikke komplet.');
 const mapped=roots(manifest.roots.map(r=>({...r,directory:join(source,r.id)})));
 for(const item of mapped)if(!Array.isArray(item.files)||JSON.stringify(await dataManifest(item.directory))!==JSON.stringify(item.files))throw new Error('Backuphash eller filrettigheder matcher ikke manifestet.');
 await mkdir(destination,{mode:0o700});
 const reports=[];
 for(const item of mapped){const target=join(destination,item.id);await offlineSnapshot(item.directory,target,{quiescent:true,required:item.required});reports.push({id:item.id,...await verifyRestoredData(item.directory,target,{required:item.required})});}
 return {ok:reports.every(r=>r.ok),reports,scope:'Restored named roots to a new directory. Original absolute project paths and service environment require review in an isolated host before startup.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const [action,source,target,flag]=process.argv.slice(2);if(!source||!target||flag!=='--service-stopped'||!['backup','restore'].includes(action))throw new Error('Angiv backup/restore, kilde, nyt mål og --service-stopped.');
 const report=action==='backup'?await createBackupBundle(JSON.parse(await readFile(source)),target,{quiescent:true}):await restoreBackupBundle(source,target,{quiescent:true});console.log(JSON.stringify(report,null,2));}
 catch{console.error('Backup/restore afbrudt. Kontrollér mapping, rettigheder, quiescence og nye adskilte målmapper. Eksisterende mål overskrives ikke.');process.exitCode=1;}
}
