import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,symlink} from 'node:fs/promises';
import {evaluate,gradeEvaluation,coreSourceFingerprint} from '../scripts/assistant-evaluation.mjs';
const tasks=JSON.parse(await readFile(new URL('../scripts/fixtures/danish-assistant-tasks.json',import.meta.url)));
test('evaluation separates unrun, ungraded and accepted real-language evidence',async()=>{
 assert.equal(tasks.length,30);assert.equal(new Set(tasks.map(x=>x.id)).size,30);assert.ok(tasks.filter(x=>x.critical).length>=5);
 const dry=await evaluate();assert.equal(dry.status,'not_run');assert.equal(gradeEvaluation(dry).accepted,false);
 const report={...dry,live:true,model:'synthetic-model',results:tasks.map(x=>({...x,status:'awaiting_human_review',answers:x.turns.map(()=>({status:200,body:{answer:'Synthetic answer'}})),passed:true,reviewedBy:'synthetic reviewer',reviewNote:'Fixture only'}))};
 assert.equal(gradeEvaluation(report).accepted,true);
 const critical=report.results.find(x=>x.critical);critical.status='execution_failed';critical.critical=false;
 assert.equal(gradeEvaluation(report).accepted,false,'removing a critical flag cannot hide failed execution');
 critical.status='awaiting_human_review';
 const originalId=critical.id;critical.id='invented';assert.equal(gradeEvaluation(report).accepted,false);critical.id=originalId;
 const originalHash=report.datasetSha256;report.datasetSha256='changed';assert.equal(gradeEvaluation(report).accepted,false);report.datasetSha256=originalHash;
 critical.answers[0].status=500;assert.equal(gradeEvaluation(report).accepted,false);critical.answers[0].status=200;
 report.results[0].passed=null;assert.equal(gradeEvaluation(report).accepted,false);
 report.results[0].passed=true;critical.passed=false;assert.equal(gradeEvaluation(report).accepted,false);
 report.live=false;assert.equal(gradeEvaluation(report).accepted,false);
});

test('instruction fingerprints bind persona and exact historical skill content, rejecting symlinks',async()=>{
 const root=await mkdtemp('/tmp/eval-provenance-');await mkdir(root+'/scripts/fixtures',{recursive:true});await mkdir(root+'/skills/demo/versions/1.0.0',{recursive:true});
 for(const file of ['core.mjs','package.json','persona.md','scripts/assistant-evaluation.mjs','scripts/fixtures/danish-assistant-tasks.json','skills/demo/versions/1.0.0/SKILL.md'])await writeFile(root+'/'+file,'fixture source');
 const original=await coreSourceFingerprint(root);await writeFile(root+'/persona.md','changed persona');assert.notEqual(await coreSourceFingerprint(root),original);
 await writeFile(root+'/persona.md','fixture source');await writeFile(root+'/skills/demo/versions/1.0.0/SKILL.md','changed old skill');assert.notEqual(await coreSourceFingerprint(root),original);
 await symlink('/etc/passwd',root+'/skills/secret.md');await assert.rejects(coreSourceFingerprint(root),/symlink/);
});
test('focused real-language regressions preserve dataset and cannot masquerade as full acceptance',async()=>{
 const report=await evaluate({taskIds:['DA10','DA11']});assert.deepEqual(report.selectedTaskIds,['DA10','DA11']);assert.equal(report.plannedTasks,2);assert.equal(gradeEvaluation(report).accepted,false);assert.equal(report.fingerprintVersion,2);
 await assert.rejects(evaluate({taskIds:['invented']}));await assert.rejects(evaluate({taskIds:['DA10','DA10']}));
 const legacy={...report,fingerprintVersion:1,live:true};assert.equal(gradeEvaluation(legacy).accepted,false);
});
