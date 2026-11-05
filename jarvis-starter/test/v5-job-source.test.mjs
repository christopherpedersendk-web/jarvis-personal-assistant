import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('H2/R11 skill source navigation waits for its exact ID/version record, never a nearby version', async () => {
  const script = await readFile(new URL('../public/intelligence.js', import.meta.url), 'utf8');
  let complete, refreshes = 0;
  const ready = new Promise(resolve => { complete = resolve; });
  const highlighted = [], targets = new Map();
  for (const version of ['1.0.0', '2.0.0']) {
    const selector = `[data-skill-id="daily-briefing"][data-skill-version="${version}"]`;
    targets.set(selector, { classList: { add: () => highlighted.push(version) }, scrollIntoView() {} });
  }
  const status = { textContent: '', classList: { toggle() {} } };
  const document = { getElementById: () => ({ querySelector: () => status }), querySelector: selector => targets.get(selector),
    querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({ URL, Date, Promise, document, CSS: { escape: value => value },
    window: { location: { href: 'https://synthetic.invalid/?view=knowledge&source=skill%3Adaily-briefing%3A2.0.0' } },
    refreshIntelligenceCatalog: async () => { refreshes++; await ready; }, setTimeout: callback => callback() });
  vm.runInContext(script.slice(0, script.indexOf('\nfunction knowledgeElement(')) + '\nglobalThis.openSource = focusRecordedSource;', context);
  const navigation = context.openSource('skill:daily-briefing:2.0.0');
  assert.equal(refreshes, 1);
  assert.deepEqual(highlighted, []);
  complete(); await navigation;
  assert.deepEqual(highlighted, ['2.0.0']);
  assert.match(script, /card\.dataset\.skillId = skill\.name; card\.dataset\.skillVersion = skill\.version/);
});
