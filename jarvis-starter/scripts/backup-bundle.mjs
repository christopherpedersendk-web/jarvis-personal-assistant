import {mkdir,readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {offlineSnapshot} from './offline-snapshot.mjs';
import {verifyRestoredData,dataManifest} from './verify-restored-data.mjs';
const role=/^[a-z][a-z0-9-]{0,39}$/;
function roots(value){
 if(!Array.isArray(value)||!value.length||value.length>20||new Set(value.map(r=>r.id)).size!==value.length||value.some(r=>!role.test(r.id)||typeof r.directory!=='string'||!Array.isArray(r.required)||r.required.some(p=>typeof p!=='string'||p.startsWith('/')||p.split('/').some(x=>x==='..'||x==='.'))))throw new Error('Ugyldigt backupkort. Angiv id, directory og required for hver rod.');
 for(const id of ['data','configuration'])if(!value.some(r=>r.id===id))throw new Error('Backupkortet skal omfatte data og configuration. Tilføj alle eksterne projektmapper særskilt.');
 return value;
}
export async function createBackupBundle(mapping,destination,{quiescent=false}={}){
 if(!quiescent)throw new Error('Stop service og alle skrivere først.');
 const input=roots(mapping.roots);destination=resolve(destination);
 if(await realpath(dirname(destination))!==dirname(destination))throw new Error('Symlink i destinationen.');
 await mkdir(destination,{mode:0o700});
 const report={format:1,at:new Date().toISOString(),quiescence:'operator_asserted',complete:false,roots:[]};
 for(const item of input){const source=resolve(item.directory),target=join(destination,item.id);
  await offlineSnapshot(source,target,{quiescent:true,required:item.required});
  report.roots.push({id:item.id,originalDirectory:source,required:item.required,files:await dataManifest(target)});
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
