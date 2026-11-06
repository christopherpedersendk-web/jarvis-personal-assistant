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
