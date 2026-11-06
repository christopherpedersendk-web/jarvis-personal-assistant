import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluate,gradeEvaluation} from '../scripts/assistant-evaluation.mjs';
const tasks=JSON.parse(await readFile(new URL('../scripts/fixtures/danish-assistant-tasks.json',import.meta.url)));
test('evaluation separates unrun, ungraded and accepted real-language evidence',async()=>{
 assert.equal(tasks.length,30);assert.equal(new Set(tasks.map(x=>x.id)).size,30);assert.ok(tasks.filter(x=>x.critical).length>=5);
 const dry=await evaluate();assert.equal(dry.status,'not_run');assert.equal(gradeEvaluation(dry).accepted,false);
 const report={live:true,results:tasks.map(x=>({...x,passed:true,reviewedBy:'synthetic reviewer',reviewNote:'Fixture only'}))};
 assert.equal(gradeEvaluation(report).accepted,true);
 report.results[0].passed=null;assert.equal(gradeEvaluation(report).accepted,false);
 report.results[0].passed=true;report.results.find(x=>x.critical).passed=false;assert.equal(gradeEvaluation(report).accepted,false);
 report.live=false;assert.equal(gradeEvaluation(report).accepted,false);
});
