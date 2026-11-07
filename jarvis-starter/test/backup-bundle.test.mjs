import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBackupBundle,restoreBackupBundle} from '../scripts/backup-bundle.mjs';
test('offline bundle keeps separate data, settings, external projects and service configuration',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-bundle-'));t.after(()=>rm(dir,{recursive:true,force:true}));const roots=[];
 for(const id of ['data','configuration','projects']){const directory=join(dir,id);await mkdir(directory);await writeFile(join(directory,'fixture.txt'),id,{mode:0o600});roots.push({id,directory,required:['fixture.txt']});}
 const backup=join(dir,'backup'),restored=join(dir,'restored');
 await assert.rejects(createBackupBundle({roots},backup));
 assert.equal((await createBackupBundle({roots},backup,{quiescent:true})).complete,true);
 assert.equal((await restoreBackupBundle(backup,restored,{quiescent:true})).ok,true);
 for(const id of roots.map(r=>r.id))assert.equal(await readFile(join(restored,id,'fixture.txt'),'utf8'),id);
 await assert.rejects(restoreBackupBundle(backup,restored,{quiescent:true}));
 await writeFile(join(backup,'projects','fixture.txt'),'changed');
 await assert.rejects(restoreBackupBundle(backup,join(dir,'corrupt'),{quiescent:true}),/Backuphash/);
 const manifest=JSON.parse(await readFile(join(backup,'manifest.json')));manifest.roots[0].id='../escape';await writeFile(join(backup,'manifest.json'),JSON.stringify(manifest));
 await assert.rejects(restoreBackupBundle(backup,join(dir,'unsafe'),{quiescent:true}));
});

test('selected configuration files restore privately without collecting unrelated directory secrets',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-selected-bundle-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(dir+'/data');await mkdir(dir+'/configuration');
 await writeFile(dir+'/data/state.json','synthetic state',{mode:0o600});await writeFile(dir+'/configuration/research.env','synthetic research secret',{mode:0o600});await writeFile(dir+'/configuration/unrelated.env','must not be collected',{mode:0o600});
 const mapping={roots:[{id:'data',directory:dir+'/data',required:['state.json']},{id:'configuration',selectedFiles:[{source:dir+'/configuration/research.env',name:'research.env'}],required:['research.env']}]};
 await assert.rejects(createBackupBundle(mapping,dir+'/not-quiescent'));
 assert.equal((await createBackupBundle(mapping,dir+'/backup',{quiescent:true})).complete,true);assert.equal((await restoreBackupBundle(dir+'/backup',dir+'/restore',{quiescent:true})).ok,true);
 assert.equal(await readFile(dir+'/restore/configuration/research.env','utf8'),'synthetic research secret');const {readdir,stat}=await import('node:fs/promises');assert.deepEqual(await readdir(dir+'/backup/configuration'),['research.env']);assert.equal((await stat(dir+'/restore/configuration/research.env')).mode&0o077,0);assert.equal((await stat(dir+'/backup')).mode&0o077,0);
});
test('selected backup mappings reject broad mixed roots, traversal names and duplicate destinations',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-selected-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(dir+'/data');await writeFile(dir+'/secret','fixture');const data={id:'data',directory:dir+'/data',required:[]},base={id:'configuration',selectedFiles:[{source:dir+'/secret',name:'secret'}],required:['secret']};
 for(const [i,root]of [{...base,directory:dir},{...base,selectedFiles:[{source:dir+'/secret',name:'../escape'}]},{...base,selectedFiles:[{source:dir+'/secret',name:'secret'},{source:dir+'/secret',name:'secret'}]}].entries())await assert.rejects(createBackupBundle({roots:[data,root]},dir+'/invalid-'+i,{quiescent:true}),/backupkort/);
});
test('selected symlink or missing required configuration cannot produce a complete backup',async t=>{
 const {symlink}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'jarvis-selected-symlink-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(dir+'/data');await writeFile(dir+'/secret','fixture');await symlink(dir+'/secret',dir+'/link');const data={id:'data',directory:dir+'/data',required:[]};
 await assert.rejects(createBackupBundle({roots:[data,{id:'configuration',selectedFiles:[{source:dir+'/link',name:'secret'}],required:['secret']}]},dir+'/symlink',{quiescent:true}),/Symlink/);
 await assert.rejects(createBackupBundle({roots:[data,{id:'configuration',selectedFiles:[{source:dir+'/secret',name:'secret'}],required:['missing']}]},dir+'/missing',{quiescent:true}),/krævet/);
});
