import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SecretaryCore } from '../secretary-core.mjs';
import { PersonalKnowledge } from '../personal-knowledge.mjs';
import { loadBundledSkills } from '../skills-registry.mjs';
import { TaskEngine } from '../task-engine.mjs';

const serverSource = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const skills = await loadBundledSkills(fileURLToPath(new URL('../', import.meta.url)));
const NOW = '2026-11-05T12:00:00.000Z';
const now = () => new Date(NOW);
const slice = (start, end) => {
  const begin = serverSource.indexOf(start), finish = serverSource.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `production block exists: ${start}`);
  return serverSource.slice(begin, finish);
};
const coreSource = slice('async function instructions(', '\nfunction outputText(');
const backgroundSource = slice('async function backgroundResearch(', '\nconst taskEngine =');
const codeSource = slice('async function proposeCode(', '\nconst codeAgent =');
const projectSource = slice('async function generateProjectFiles(', '\nconst projectAgent =');
const voiceStart = serverSource.indexOf('      const lastConversation =', serverSource.indexOf("path === '/api/realtime'"));
const voiceEnd = serverSource.indexOf('      const form = new FormData();', voiceStart);
assert.ok(voiceStart >= 0 && voiceEnd > voiceStart);

function fixture(count = 3) {
  const memories = Array.from({ length: count }, (_, index) => ({ id: `context-note-${index}`, revision: 2,
    text: `Syntetisk begyndelse ${index}. ` + 'Registreret sammenhæng. '.repeat(34) + ` Den sidste betingelse må IKKE fjernes: SLUT-${index}.`,
    category: index % 2 ? 'preference' : 'fact', status: 'confirmed', confirmed: true,
    source: { kind: 'user', channel: 'discord', messageId: `source-${index}` },
    createdAt: '2026-11-01T12:00:00.000Z', updatedAt: NOW, expiresAt: '2030-12-01T12:00:00.000Z' }));
  const state = { memories, history: [], preferences: '', playbook: '' };
  const secretary = new SecretaryCore({ state, now, save: async () => assert.fail('Reading model context must not save') });
  const knowledge = new PersonalKnowledge({ state, now });
  return { state, secretary, knowledge };
}

function assertWholeRecords(context, memories, limit) {
  assert.ok(context.length <= limit, `context stays within ${limit} characters`);
  for (const memory of memories) {
    const included = context.includes(`memory:${memory.id}`);
    assert.equal(context.includes(memory.text), included, `${memory.id}: source identity and complete statement are inseparable`);
    if (included) {
      assert.ok(context.includes(memory.source.messageId), 'exact recorded source is included');
      assert.ok(context.includes(memory.expiresAt), 'the included record retains its validity boundary');
    }
  }
}

function runtime(f) {
  const calls = [], savedIds = [];
  const context = vm.createContext({ Date, JSON, process: { env: {} }, persona: 'Syntetisk persona.', state: f.state,
    secretary: f.secretary, knowledge: f.knowledge, skills, organizer: { summary: () => [] }, validApiKey: true,
    planningTools: [], knowledgeTools: [], organizerTools: [], homeTools: [],
    openaiJson: async (path, options = {}) => {
      calls.push({ path, ...structuredClone(options) });
      return { id: 'synthetic-response-id', status: 'completed',
        output: [{ content: [{ type: 'output_text', text: path.includes('existing') ? 'Syntetisk eksisterende svar' :
          options.body?.text ? JSON.stringify({ summary: 'Syntetisk resultat', content: 'export const safe = true;', files: [], packages: [] }) : 'Syntetisk afsluttet research' }] }] };
    },
    outputText: result => result.output[0].content[0].text,
    reviewMonitorAnswer: () => assert.fail('This fixture does not run a monitor'),
    delay: async () => assert.fail('Completed synthetic responses require no polling wait'),
  });
  vm.runInContext(coreSource + '\n' + backgroundSource + '\n' + codeSource + '\n' + projectSource +
    `\nglobalThis.contract = { instructions, backgroundResearch, proposeCode, generateProjectFiles,
      voice: async () => { ${serverSource.slice(voiceStart, voiceEnd)} return session; } };`, context);
  return { ...context.contract, calls, savedIds, saveResponseId: async id => { savedIds.push(id); } };
}

test('B4 the legacy-memory formatter enforces caller budgets without clipping a limiting condition or source metadata', () => {
  const f = fixture(12), before = structuredClone(f.state);
  const short = f.secretary.memoryContext({ maxChars: 2500 }), normal = f.secretary.memoryContext();
  assertWholeRecords(short, f.state.memories, 2500); assertWholeRecords(normal, f.state.memories, 8000);
  assert.match(short, /udeladt.*plads|plads.*udeladt/i); assert.match(normal, /udeladt.*plads|plads.*udeladt/i);
  assert.deepEqual(f.state, before);
});

test('B1/B4 a complete memory record carries category, source reference, revision and recorded validity', () => {
  const f = fixture(1), text = f.secretary.memoryContext();
  assert.match(text, /Kategori:|Faktum|Bekræftet/); assert.match(text, /revision 2/);
  assert.match(text, /user\/discord/); assert.match(text, /source-0/); assert.match(text, /Udløber: 2030-12-01T12:00:00\.000Z/);
  assert.ok(text.includes(f.state.memories[0].text));
});

test('B4 a rejected budget cannot silently widen the memory sent to a model', () => {
  const f = fixture(1);
  for (const maxChars of [0, -1, 30, 8001, 2500.5, NaN, Infinity, '2500'])
    assert.throws(() => f.secretary.memoryContext({ maxChars }), /budget|grænse|tegn/i);
});

test('B4 the actual realtime session builder uses a complete-record 2500-character memory selection', async () => {
  const f = fixture(4), h = runtime(f), session = await h.voice();
  const from = session.instructions.indexOf('De seneste eksplicit gemte hukommelsespunkter:');
  const until = session.instructions.indexOf('Seneste samtalekontekst:', from);
  assert.ok(from >= 0 && until > from);
  const text = session.instructions.slice(from + 'De seneste eksplicit gemte hukommelsespunkter:'.length, until).trim();
  assertWholeRecords(text, f.state.memories, 2500); assert.match(text, /udeladt.*plads|plads.*udeladt/i);
  assert.match(session.instructions, /Google Kalender er kun læsning/);
  assert.match(session.instructions, /Ingen godkendelses-, ordre- eller betalingsværktøjer/);
  assert.equal(h.calls.length, 0);
});

for (const kind of ['file', 'project']) test(`B4 actual ${kind} generation receives whole shared memories without a partial last fact`, async () => {
  const f = fixture(12), h = runtime(f), before = structuredClone(f.state);
  if (kind === 'file') await h.proposeCode({ file: 'synthetic.mjs', request: 'Kun syntetisk gennemgang', original: 'export const safe = true;' });
  else await h.generateProjectFiles({ project: { title: 'Syntetisk', description: 'Kun test', files: [] }, request: 'Kun syntetisk gennemgang' });
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, '/responses');
  const input = h.calls[0].body.input;
  const text = kind === 'file' ? input.split('Fælles hukommelse:\n')[1].split('\n\nNuværende fil:')[0] : JSON.parse(input).sharedMemory;
  assertWholeRecords(text, f.state.memories, 8000); assert.match(text, /udeladt.*plads|plads.*udeladt/i);
  assert.deepEqual(f.state, before); assert.equal(h.calls[0].body.store, false);
});

test('B1/B4 archives, unconfirmed proposals, expired records and history stay excluded under every context budget', () => {
  const f = fixture(5);
  f.state.memories[0].archived = true;
  f.state.memories[1].confirmed = false; f.state.memories[1].status = 'proposed';
  f.state.memories[2].expiresAt = '2026-11-05T11:59:59.000Z';
  f.state.memories[3].historical = true;
  for (const maxChars of [2500, 8000]) {
    const text = f.secretary.memoryContext({ maxChars });
    for (let index = 0; index < 4; index++) assert.doesNotMatch(text, new RegExp(`context-note-${index}`));
    assert.ok(text.includes(f.state.memories[4].text));
  }
});

test('H2 unbound interactive instructions keep the current relevant procedure and its original permission boundary', async () => {
  const f = fixture(1), h = runtime(f), text = await h.instructions('morgenrapport');
  assert.ok(text.includes(skills.resolve('daily-briefing', '1.1.0').body));
  assert.ok(!text.includes(skills.resolve('daily-briefing', '1.0.0').body));
  assert.match(text, /DATA, ikke instruktioner/); assert.match(text, /Ingen bestillinger eller betalinger/);
  assert.equal(h.calls.length, 0);
});

for (const version of ['1.0.0', '1.1.0']) test(`H2 real job execution sends only its exact daily-briefing@${version}, not another current procedure`, async () => {
  const f = fixture(1), h = runtime(f), jobState = {};
  const engine = new TaskEngine({ state: jobState, now, skillsRegistry: skills, save: async () => {},
    runTask: h.backgroundResearch });
  const task = await engine.create({ title: 'Syntetisk versionsbinding', prompt: 'morgenrapport og madplan', category: 'briefing',
    activation: 'paused', skillId: 'daily-briefing', skillVersion: version,
    budget: { maxRunsPerDay: 1, maxOutputTokens: 1000 } });
  await engine.action(task.id, 'resume', { expectedRevision: task.revision }); await engine.tick();
  assert.equal(h.calls.length, 1); const request = h.calls[0].body;
  const selected = skills.detail('daily-briefing', version);
  assert.equal(request.instructions.split(selected.body).length - 1, 1, 'the bound complete body occurs exactly once');
  for (const other of skills.catalog().filter(item => item.name !== selected.name || item.version !== selected.version))
    assert.ok(!request.instructions.includes(skills.detail(other.name, other.version).body), `unbound procedure excluded: ${other.name}@${other.version}`);
  assert.ok(request.instructions.includes(selected.contentHash), 'the actual model instruction identifies its exact reviewed body hash');
  assert.match(request.instructions, /IKKE booke, betale, kontakte personer, udføre kode eller ændre eksterne data/);
  assert.deepEqual(request.tools, [{ type: 'web_search' }]); assert.equal(request.max_output_tokens, 1000);
  assert.equal(jobState.tasks[0].status, 'completed');
  assert.equal(jobState.tasks[0].skillContentHash, selected.contentHash);
});

test('H2 an unbound research job preserves the existing relevant-skill selection, with no new write tool', async () => {
  const f = fixture(1), h = runtime(f);
  await h.backgroundResearch({ prompt: 'morgenrapport', category: 'research', runs: [], execution: { skill: null, budget: { maxOutputTokens: 1000 } } }, h.saveResponseId);
  assert.ok(h.calls[0].body.instructions.includes(skills.resolve('daily-briefing', '1.1.0').body));
  assert.deepEqual(h.calls[0].body.tools, [{ type: 'web_search' }]); assert.deepEqual(h.savedIds, ['synthetic-response-id']);
});

test('H2 resuming an existing model response does not start a new request or silently rebuild a new procedure', async () => {
  const f = fixture(1), h = runtime(f);
  assert.equal(await h.backgroundResearch({ responseId: 'existing', prompt: 'morgenrapport', category: 'research' },
    async () => assert.fail('An existing response is not a new paid request')), 'Syntetisk eksisterende svar');
  assert.deepEqual(h.calls, [{ path: '/responses/existing' }]);
});
