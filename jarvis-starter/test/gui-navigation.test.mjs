import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../public/gui-navigation.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(code, context);
const navigation = context.JarvisNavigation;
const plain = value => JSON.parse(JSON.stringify(value));

test('GUI-T02 legacy destinations retain their domains without adding primary tabs', () => {
  const expected = {
    home: ['home', null, null], plan: ['plan', 'tasks', 'personal'], tasks: ['plan', 'tasks', 'agent'],
    meals: ['plan', 'meals', null], organizer: ['plan', 'notes', null],
    projects: ['plan', 'tasks', 'projects'], 'smart-home': ['smart-home', null, null],
    system: ['settings', 'system', null], secretary: ['home', null, null],
  };
  for (const [legacy, destination] of Object.entries(expected)) {
    const route = navigation.resolve(legacy);
    assert.deepEqual([route.view, route.section, route.kind], destination, legacy);
  }
  assert.deepEqual(plain(navigation.mainViews), ['home', 'plan', 'smart-home', 'watches', 'settings']);
  const search = navigation.resolve('knowledge');
  assert.equal(search.view, 'home'); assert.equal(search.panel, 'search');
});

test('GUI-T01/T02 precise old source links open the original domain rather than an overlaid search', () => {
  const expected = {
    'memory:one': ['settings', 'profile', null], 'claim:one': ['settings', 'profile', null],
    'skill:daily-briefing:1.0.0': ['settings', 'automations', null],
    'organizer:list:item': ['plan', 'notes', null], 'project:one': ['plan', 'tasks', 'projects'],
    'task:one': ['plan', 'tasks', 'agent'], 'personal-task:one': ['plan', 'tasks', 'personal'],
    'follow-up:one': ['plan', 'tasks', 'personal'], 'recipe:one': ['plan', 'meals', null],
    'household:2026-11-05': ['plan', 'meals', null], 'meal-plan:one': ['plan', 'meals', null],
    'shopping-draft:one': ['plan', 'meals', null], 'nemlig-proposal:one': ['plan', 'meals', null],
    'google-calendar:primary:2026-11-05:event:2026-11-05T09%3A14%3A00.000Z': ['plan', 'calendar', null],
  };
  for (const [sourceId, destination] of Object.entries(expected)) {
    const route = navigation.fromURL(`https://synthetic.invalid/?view=knowledge&source=${encodeURIComponent(sourceId)}`);
    assert.deepEqual([route.view, route.section, route.kind], destination, sourceId);
    assert.equal(route.sourceId, sourceId, 'the exact object identity survives');
    assert.equal(route.panel, null, `${sourceId}: old knowledge alias cannot conceal the selected source`);
  }
});

test('GUI-T02 canonical URL roundtrip preserves source, unrelated parameters and fragment', () => {
  const original = 'https://synthetic.invalid/?view=meals&source=household%3A2026-11-05&filter=mine#day';
  const route = navigation.fromURL(original);
  const url = navigation.toURL(original, route);
  assert.equal(url.searchParams.get('view'), 'plan'); assert.equal(url.searchParams.get('section'), 'meals');
  assert.equal(url.searchParams.get('source'), 'household:2026-11-05');
  assert.equal(url.searchParams.get('filter'), 'mine'); assert.equal(url.hash, '#day');
  assert.deepEqual(plain(navigation.fromURL(url.href)), plain(route));
});

test('GUI-T02 explicit search history keeps its underlying destination and valid local section', () => {
  const route = navigation.fromURL('https://synthetic.invalid/?view=plan&section=notes&panel=search');
  assert.equal(route.view, 'plan'); assert.equal(route.section, 'notes'); assert.equal(route.panel, 'search');
  const url = navigation.toURL('https://synthetic.invalid/?filter=mine', route);
  assert.deepEqual(plain(navigation.fromURL(url.href)), plain(route));
});

test('GUI-T02 unsupported routes and incompatible subviews cannot expose a phantom destination', () => {
  assert.equal(navigation.resolve('does-not-exist').view, 'home');
  const plan = navigation.resolve('plan', { section: 'system', kind: 'alien', panel: 'popup' });
  assert.deepEqual([plan.section, plan.kind, plan.panel], ['tasks', 'personal', null]);
  const settings = navigation.resolve('settings', { section: 'calendar', kind: 'projects' });
  assert.deepEqual([settings.section, settings.kind], ['profile', null]);
  assert.equal(navigation.resolve('plan', { section: 'meals', kind: 'projects' }).kind, null);
});

test('GUI-T02 an explicitly opened overlay survives an exact-source reload and roundtrip', () => {
  for (const panel of ['search', 'chat']) {
    const route = navigation.fromURL(`https://synthetic.invalid/?view=plan&section=notes&source=organizer%3Alist%3Aitem&panel=${panel}`);
    assert.equal(route.sourceId, 'organizer:list:item'); assert.equal(route.section, 'notes'); assert.equal(route.panel, panel);
    assert.deepEqual(plain(navigation.fromURL(navigation.toURL('https://synthetic.invalid/', route).href)), plain(route));
  }
});

test('GUI-T02 the legacy secretary destination retains its attention disclosure on canonical reload', () => {
  const route = navigation.fromURL('https://synthetic.invalid/?view=secretary');
  assert.equal(route.view, 'home'); assert.equal(route.attention, true);
  const url = navigation.toURL('https://synthetic.invalid/', route);
  assert.equal(url.searchParams.get('attention'), '1');
  assert.deepEqual(plain(navigation.fromURL(url.href)), plain(route));
});

test('GUI-T07 a resolved monitor source remains on Overvågninger after reloading its canonical URL', () => {
  const route = navigation.fromURL('https://synthetic.invalid/?view=watches&source=task%3Amonitor-id');
  assert.equal(route.view, 'watches'); assert.equal(route.sourceId, 'task:monitor-id');
  assert.equal(navigation.fromURL(navigation.toURL('https://synthetic.invalid/', route).href).view, 'watches');
});

test('GUI-T10 route context uses the exact source identity and never manufactures a conversation ID', () => {
  const value = navigation.context(navigation.resolve('knowledge', { sourceId: 'organizer:list:item' }));
  assert.equal(value.sourceId, 'organizer:list:item'); assert.match(value.label, /Noter og lister/);
  assert.equal('conversationId' in value, false);
});
