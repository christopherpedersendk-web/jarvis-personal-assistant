import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PersonalKnowledge } from '../personal-knowledge.mjs';
const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function instructions('), end = source.indexOf('\nfunction outputText', start);
test('long report instructions use bounded memory lookup without truncating the job prompt', async () => {
  const knowledge = new PersonalKnowledge({ state: {} }); let query;
  const build = vm.runInNewContext(source.slice(start, end) + '\ninstructions;', {
    persona: '', state: {}, skills: { context: () => '' }, organizer: { summary: () => [] },
    knowledge: { contextAsync: async q => { query = q; return knowledge.contextAsync(q); } },
  });
  const prompt = 'Find og sammenfat aktuelle nyheder om AI og cybersikkerhed. '.repeat(20);
  await build(prompt); assert.equal(query.length, 240); assert.ok(prompt.length > 240);
  await build('   ');
  await assert.rejects(knowledge.retrieve(prompt), /240/, 'explicit search validation remains intact');
});
test('local briefing preparation failure is not classified as unknown provider execution', async () => {
  let calls = 0;
  const begin = source.indexOf('async function backgroundResearch('), finish = source.indexOf('\nconst taskEngine', begin);
  const fn = vm.runInNewContext(source.slice(begin, finish) + '\nbackgroundResearch;', {
    validApiKey: true, instructions: async () => { throw new Error('Synthetic local lookup failure'); },
    openaiJson: async () => { calls++; },
  });
  await assert.rejects(fn({ prompt: 'Research', runs: [] }, async () => {}), e => e.permanent === true && e.noActionTaken === true && !e.unknownOutcome);
  assert.equal(calls, 0);
});
