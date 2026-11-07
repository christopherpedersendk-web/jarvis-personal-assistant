import test from 'node:test';
import assert from 'node:assert/strict';
import {describeSkill,reviewedResearchSkills} from '../skill-capabilities.mjs';
import {createOpenJarvis} from '../openjarvis.mjs';
test('M11 OpenClaw manifest is descriptive, versioned and never marks a live test successful',()=>{
 const skills=reviewedResearchSkills();assert.equal(skills.length,4);assert.equal(new Set(skills.map(s=>s.name+':'+s.version)).size,4);
 for(const skill of skills){
  assert.equal(skill.permissions,'existing-authorized-tools-only');
  const view=describeSkill(skill,{modelConfigured:true});assert.equal(view.source,'openclaw');assert.equal(view.availability.available,false);
  assert.equal(view.availability.tested,false);assert.equal(view.availability.lastTest,null);assert.equal(view.provenance.license,'MIT');
  assert.equal(view.provenance.version,'2026.11.1');
  const env={modelConfigured:true,openJarvis:{enabled:true,gatewayMode:'restricted-v1',connectionStatus:'ready'}};
  assert.equal(describeSkill(skill,env).availability.available,true);
  assert.equal(describeSkill(skill,{...env,stopped:true}).availability.available,false);
  assert.equal(describeSkill(skill,{...env,openJarvis:{...env.openJarvis,gatewayMode:'legacy-unverified'}}).availability.available,false);
 }
});
test('M11 user examples are everyday requests, not internal contract test cases',()=>{
 const card=describeSkill({name:'meal-planning',contract:{examples:[{input:'Syntetisk fixture med credentialtekst'}]}});
 assert.match(card.examples[0],/madplan/);assert.doesNotMatch(card.examples.join(' '),/Syntetisk|fixture|credential/);assert.equal(card.availability.tested,false);
});
test('M11 catalog health checks never invoke research and expose failure without raw provider details',async()=>{
 const paths=[];const adapter=createOpenJarvis({env:{OPENJARVIS_ENABLED:'yes',OPENJARVIS_GATEWAY_MODE:'restricted-v1',OPENJARVIS_GATEWAY_TOKEN:'test-credential',OPENJARVIS_GATEWAY_URL:'http://127.0.0.1:18790'},
  control:{controlled:fn=>fn(new AbortController().signal)},fetcher:async url=>{paths.push(new URL(url).pathname);return new Response('private upstream error',{status:502});}});
 await adapter.inspect();await adapter.inspect();assert.deepEqual(paths,['/health']);
 assert.equal(adapter.status().connectionStatus,'unavailable');assert.ok(!JSON.stringify(adapter.status()).includes('private upstream error'));
 const disabled=createOpenJarvis({env:{},control:{},fetcher:()=>assert.fail('Disabled must not contact gateway')});await disabled.inspect();assert.equal(disabled.status().enabled,false);
});
