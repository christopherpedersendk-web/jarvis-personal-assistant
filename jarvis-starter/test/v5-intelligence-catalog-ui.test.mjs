import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { SkillsRegistry } from '../skills-registry.mjs';

// Behavioural DOM doubles, not browser/physical-device verification.
const source = await readFile(new URL('../public/intelligence.js', import.meta.url), 'utf8');
const factorySource = source.slice(source.indexOf('function createIntelligenceCatalog('), source.indexOf('\nconst intelligenceCatalog ='));
const later = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.parentNode = null; this.dataset = {}; this.text = ''; this.events = new Map(); this.open = false; this.attributes = {}; }
  classes = new Set();
  classList = { contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name),
    toggle: (name, active) => { if (active) this.classes.add(name); else this.classes.delete(name); } };
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.text = String(value); for (const child of this.children) child.parentNode = null; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = ''; this.append(...children); }
  contains(value) { return value === this || this.children.some(child => child.contains(value)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  async emit(name, detail = {}) { for (const handler of this.events.get(name) || []) await handler({ preventDefault() {}, ...detail }); }
}

function fixture({ beforeRead = async () => {}, trySkill = () => {}, initialView = 'home' } = {}) {
  const nodes = new Map(), document = { hidden: false, activeElement: null, createElement: tag => new Element(tag), getElementById: id => nodes.get(id) };
  for (const id of ['workspace', 'tab-knowledge', 'tab-settings', 'skills-catalog', 'integrations-catalog',
    'skills-catalog-status', 'integrations-catalog-status', 'skills-catalog-refresh', 'integrations-catalog-refresh', 'skills-query', 'skills-source', 'skills-category', 'skills-state', 'skills-filter-status']) nodes.set(id, new Element('div'));
  const versions = ['1.0.0', '2.0.0'].map(version => ({ name: 'daily-briefing', version, description: `Syntetisk v${version}`, triggers: ['overblik'],
    permissions: 'existing-authorized-tools-only', body: `# Syntetisk ${version}\n<script>Dette er tekst, ikke kode.</script>` }));
  let registry = new SkillsRegistry(versions), owner = 'synthetic-owner', now = 1000;
  let integrations = [{ id: 'discord', title: 'Discord', implementation: 'available', status: 'not_configured', capabilities: ['chat'], outboundPolicy: 'owner-opt-in' }];
  const reads = [], opened = [];
  const api = async (path, options) => {
    assert.equal(options?.method, undefined, 'catalogues and procedure details are strictly read-only');
    reads.push(path);
    const response = path === '/api/skills' ? { skills: registry.catalog() } : path === '/api/integrations' ? { integrations: structuredClone(integrations) }
      : { skill: registry.detail(...path.slice('/api/skills/'.length).split('/').map(decodeURIComponent)) };
    await beforeRead(path); return response;
  };
  const context = vm.createContext({ Date, Promise, Map, Set, encodeURIComponent });
  vm.runInContext(factorySource + '\nglobalThis.make = createIntelligenceCatalog;', context);
  const ui = context.make({ document, api, getToken: () => owner, now: () => now, trySkill, openSource: id => opened.push(id) });
  const view = name => { nodes.get('tab-knowledge').classList.toggle('hidden', name !== 'knowledge'); nodes.get('tab-settings').classList.toggle('hidden', name !== 'settings'); };
  view(initialView);
  return { ui, document, nodes, reads, opened, view, versions,
    setRegistry: value => { registry = value; }, setIntegrations: value => { integrations = value; },
    setOwner: value => { owner = value; }, advance: amount => { now += amount; },
    skill: version => nodes.get('skills-catalog').children.find(card => card.dataset.skillVersion === version) };
}

test('J1 catalogues perform no hidden fetch and only read the endpoint for the visible section', async () => {
  const f = fixture(); assert.deepEqual(f.reads, []);
  await f.ui.refresh(); assert.deepEqual(f.reads, []);
  f.view('knowledge'); await f.ui.refresh(); assert.deepEqual(f.reads, ['/api/skills']);
  f.view('settings'); await f.ui.refresh(); assert.deepEqual(f.reads, ['/api/skills', '/api/integrations']);
  f.view('home'); f.advance(60_001); await f.ui.refresh(); assert.equal(f.reads.length, 2);
  f.view('knowledge'); f.document.hidden = true; await f.ui.refresh(); assert.equal(f.reads.length, 2);
  f.document.hidden = false; f.nodes.get('workspace').classList.add('hidden'); await f.ui.refresh(); assert.equal(f.reads.length, 2);
});

test('J1 overlapping catalogue refreshes coalesce and successful metadata is cached for one minute', async () => {
  const hold = later(), f = fixture({ initialView: 'knowledge', beforeRead: async () => hold.promise });
  const first = f.ui.refresh(), duplicate = f.ui.refresh({ force: true });
  assert.deepEqual(f.reads, ['/api/skills']);
  hold.resolve(); await Promise.all([first, duplicate]);
  await f.ui.refresh(); assert.equal(f.reads.length, 1);
  f.advance(60_001); await f.ui.refresh(); assert.equal(f.reads.length, 2);
});

test('H2/R11 an exact version source opens its complete text and hash, never a neighbouring procedure', async () => {
  const f = fixture({ initialView: 'knowledge' });
  await f.ui.refresh({ skillId: 'daily-briefing', skillVersion: '2.0.0' });
  assert.deepEqual(f.reads, ['/api/skills', '/api/skills/daily-briefing/2.0.0']);
  const target = f.skill('2.0.0').catalogParts, other = f.skill('1.0.0').catalogParts;
  assert.equal(target.disclosure.open, true); assert.equal(other.disclosure.open, false);
  assert.equal(target.body.textContent, f.versions[1].body); assert.equal(target.body.children.length, 0, 'procedure is textContent, not executable HTML');
  assert.match(target.message.textContent, /hash [a-f0-9]{64}.*kun læsning/);
  assert.equal(other.body.textContent, '');
  await assert.rejects(f.ui.refresh({ skillId: 'daily-briefing', skillVersion: '9.0.0' }), { code: 'SKILL_NOT_FOUND' });
  assert.equal(other.disclosure.open, false);
});

test('R03 visible catalogue polling preserves exact nodes, focused disclosure and open procedure', async () => {
  const f = fixture({ initialView: 'knowledge' });
  await f.ui.refresh({ skillId: 'daily-briefing', skillVersion: '1.0.0' });
  const original = f.skill('1.0.0'), summary = original.catalogParts.disclosure.children[0];
  f.document.activeElement = summary;
  await f.ui.refresh({ force: true });
  assert.equal(f.skill('1.0.0'), original); assert.equal(f.document.activeElement, summary);
  assert.equal(original.catalogParts.disclosure.open, true); assert.equal(original.contains(summary), true);
  assert.equal(f.reads.filter(path => path.includes('/daily-briefing/')).length, 1, 'metadata polling does not re-fetch an unchanged body');
  f.setRegistry(new SkillsRegistry([f.versions[1]])); await f.ui.refresh({ force: true });
  assert.equal(f.skill('1.0.0'), original); assert.equal(original.dataset.catalogUnavailable, 'true');
  assert.match(original.catalogParts.unavailable.textContent, /ikke længere/);
  await assert.rejects(f.ui.refresh({ skillId: 'daily-briefing', skillVersion: '1.0.0' }), { code: 'SKILL_NOT_FOUND' });
});

test('H2 exact procedure detail requests coalesce across source navigation and disclosure toggling', async () => {
  const hold = later(), f = fixture({ initialView: 'knowledge', beforeRead: async path => { if (path.includes('/daily-briefing/')) await hold.promise; } });
  await f.ui.refresh(); const card = f.skill('1.0.0');
  const sourceRead = f.ui.refresh({ skillId: 'daily-briefing', skillVersion: '1.0.0' });
  await tick(); card.catalogParts.disclosure.open = true; await card.catalogParts.disclosure.emit('toggle');
  assert.equal(f.reads.filter(path => path.includes('/daily-briefing/')).length, 1);
  hold.resolve(); await sourceRead;
  assert.equal(card.catalogParts.body.textContent, f.versions[0].body);
});

test('I5 logout clears catalogue details and rejects delayed responses from an earlier login generation', async () => {
  const hold = later(), f = fixture({ initialView: 'knowledge', beforeRead: async () => hold.promise });
  const pending = f.ui.refresh(); f.setOwner(''); f.ui.reset(); hold.resolve(); await pending;
  assert.equal(f.nodes.get('skills-catalog').children.length, 0); assert.equal(f.nodes.get('skills-catalog-status').textContent, '');
  await f.ui.refresh(); assert.equal(f.reads.length, 1);
  f.setOwner('different-synthetic-owner'); await f.ui.refresh(); assert.equal(f.nodes.get('skills-catalog').children.length, 2);
});

test('J1/R03 failed metadata refresh preserves prior records and leaves a persistent truthful error', async () => {
  let fail = false;
  const f = fixture({ initialView: 'settings', beforeRead: async () => { if (fail) throw new Error('synthetic unavailable'); } });
  await f.ui.refresh(); const original = f.nodes.get('integrations-catalog').children[0];
  fail = true; await assert.rejects(f.ui.refresh({ force: true }), /synthetic unavailable/);
  assert.equal(f.nodes.get('integrations-catalog').children[0], original);
  assert.match(f.nodes.get('integrations-catalog-status').textContent, /Tidligere visning bevares/);
  assert.equal(f.reads.includes('/api/skills'), false);
});

test('I5 an obsolete metadata failure cannot repopulate status after logout', async () => {
  const hold = later(), f = fixture({ initialView: 'knowledge', beforeRead: async () => hold.promise });
  const pending = f.ui.refresh(); f.setOwner(''); f.ui.reset();
  hold.reject(new Error('synthetic old-session read error')); await pending;
  assert.equal(f.nodes.get('skills-catalog-status').textContent, '');
  assert.equal(f.nodes.get('skills-catalog').children.length, 0);
});


test('M11 filters and logout clear the one catalog without executing a request',async()=>{
 const f=fixture({initialView:'knowledge'});await f.ui.refresh();
 f.nodes.get('skills-query').value='missing skill';await f.nodes.get('skills-query').emit('input');
 assert.ok(f.nodes.get('skills-catalog').children.every(card=>card.hidden));
 f.nodes.get('skills-query').value='daily';await f.nodes.get('skills-query').emit('input');
 assert.ok(f.nodes.get('skills-catalog').children.every(card=>!card.hidden));
 assert.deepEqual(f.reads,['/api/skills']);
 f.ui.reset();assert.equal(f.nodes.get('skills-query').value,'');assert.equal(f.nodes.get('skills-filter-status').textContent,'');
});
