import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = await readFile(join(root, 'public/index.html'), 'utf8');

test('Danish v5 navigation and scripted fields are statically linked without duplicate IDs', async () => {
  assert.match(html, /<html lang="da">/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate DOM IDs create ambiguous state and focus');
  for (const view of ['home', 'plan', 'meals', 'knowledge', 'smart-home', 'projects', 'settings'])
    assert.ok(ids.includes(`tab-${view}`), `missing v5 view ${view}`);
  for (const link of ['home','plan','meals','knowledge'])
    assert.match(html, new RegExp(`class="tab-button[^"\\n]*" href="\\?view=${link}"`));
  assert.match(html, /id="more-toggle"/);
  assert.match(html, /href="\?view=settings"/);
  for (const form of ['personal-task-form','capacity-form','follow-up-form','personal-claim-form',
    'meal-family-form','meal-google-calendar-form']) assert.ok(ids.includes(form), `missing editor ${form}`);
  const scripts = [...html.matchAll(/<script src="\/([^"]+)" defer><\/script>/g)].map(x => x[1]);
  for (const script of scripts) assert.ok((await stat(join(root, 'public', script))).isFile(), `missing script ${script}`);
  const planScript = await readFile(join(root, 'public/v5-plan.js'), 'utf8');
  const memoryScript = await readFile(join(root, 'public/memory-v49.js'), 'utf8');
  const memoryIds = [...memoryScript.matchAll(/\.id = '([^']+)'/g)].map(match => match[1]);
  for (const id of new Set([...planScript.matchAll(/byId\('([^']+)'\)/g)].map(x => x[1])))
    assert.ok(ids.includes(id) || memoryIds.includes(id), `new v5 editor refers to absent static or constructed memory ID ${id}`);
});
