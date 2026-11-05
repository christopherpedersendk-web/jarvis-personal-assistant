import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the production listeners with a small DOM double. This verifies
// asynchronous ownership and draft contracts, not native browser layout.
const source = await readFile(new URL('../public/meals.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const offset = source.indexOf(start), limit = source.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && limit > offset, `production section: ${start}`);
  return source.slice(offset, limit);
};
const program = source.slice(0, source.indexOf('\nlet calendarSelectionDirty = false;'))
  + section('\nlet calendarSelectionDirty = false;', '\nasync function refreshMeals()')
  + section("mealEl('meal-recipe-form').addEventListener('submit'", "mealEl('meal-recipes-refresh').addEventListener")
  + section("mealEl('meal-google-calendar-form').addEventListener('submit'", "mealEl('meal-google-load').addEventListener")
  + section("mealEl('meal-nemlig-search-form').addEventListener('submit'", "mealEl('meal-nemlig-propose').addEventListener")
  + section("mealEl('meal-nemlig-view-basket').addEventListener('click'", '\nfunction mealRegisterRecipeCaptureDraft()')
  + section('\nfunction mealRegisterRecipeCaptureDraft()', "\nmealEl('meal-start').value")
  + section("mealEl('logout')?.addEventListener('click'", '\nshowNemligSelection();');

function fixture(respond) {
  const nodes = new Map(), saved = new Map(), calls = [], rendered = [], notices = [];
  let owner = 'synthetic-first-owner';
  class Element {
    constructor(id = '') { this.id = id; this.value = ''; this.textContent = ''; this.dataset = {};
      this.disabled = false; this.isConnected = true; this.children = []; this.listeners = new Map(); this.attributes = {}; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    fire(name) { return this.listeners.get(name)?.({ target: this, currentTarget: this, preventDefault() {} }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; this.textContent = ''; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector(selector) { return selector.startsWith('button') ? get(this.id + '-submit') : null; }
    querySelectorAll() { return this.children; }
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); };
  const document = { getElementById: get, activeElement: null, querySelectorAll: () => [], createElement: () => new Element() };
  get('meal-recipe-form').children = [get('meal-recipe-text'), get('meal-recipe-urls'), get('meal-recipe-form-submit')];
  get('meal-google-calendar-form').children = [get('meal-google-calendar-id'), get('meal-google-calendar-form-submit')];
  const context = vm.createContext({ document, Intl, Date, URL, console,
    localStorage: { getItem: () => owner },
    sessionStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    api: async (path, options = {}) => {
      const call = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
      calls.push(call); return respond(call);
    }, toast: message => notices.push(message), rendered,
  });
  vm.runInContext(program + `
    showHouseholdCalendar = () => rendered.push('calendar');
    refreshHouseholdCalendar = async () => rendered.push('calendar-read');
    showMealProfile = showHousehold = showMealInventory = showNemligSelection = () => {};
    refreshRecipes = async () => rendered.push('recipes-read');
    refreshNemlig = async () => rendered.push('nemlig-status-read');
    showNemligProducts = products => rendered.push({ products });
    showBasket = basket => rendered.push({ basket });
    mealRegisterRecipeCaptureDraft(); mealRegisterCalendarDraft();
    globalThis.contract = { refreshGoogle,
      dirty: key => mealDirty.has(key), markDirty: key => mealDirty.add(key), persist: mealPersistDrafts,
      saving: () => calendarSelectionSaving,
    };`, context);
  return { ...context.contract, get, calls, rendered, notices, saved,
    setOwner: value => { owner = value; },
    logout: () => { owner = null; get('logout').fire('click'); },
    typeCalendar: value => { get('meal-google-calendar-id').value = value; get('meal-google-calendar-id').fire('input'); },
    saveCalendar: () => get('meal-google-calendar-form').fire('submit'),
  };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const status = calendarId => ({ configured: true, connected: true, calendarId, lastReadAt: null });

test('GUI-T11 late calendar acknowledgement preserves newer raw input and prevents duplicate submission', async () => {
  const pending = deferred();
  const f = fixture(call => call.path.endsWith('/select') ? pending.promise : status('sent-calendar'));
  f.typeCalendar(' sent-calendar '); const saving = f.saveCalendar();
  assert.equal(f.get('meal-google-calendar-form-submit').disabled, true);
  f.typeCalendar('newer-calendar'); await f.saveCalendar();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.calendarId, 'sent-calendar');
  pending.resolve({ ok: true }); await saving;
  assert.equal(f.get('meal-google-calendar-id').value, 'newer-calendar');
  assert.equal(f.dirty('calendar-selection'), true);
  assert.match(f.get('meal-calendar-draft-status').textContent, /gemt.*nyere ændringer.*ugemt kladde/);
  assert.equal(JSON.parse(f.saved.get('jarvis:v5:meal-drafts')).drafts['calendar-selection'].fields.calendarId, 'newer-calendar');
  assert.equal(f.get('meal-google-calendar-form-submit').disabled, false);
});

test('GUI-T11 failed calendar save preserves the draft without a false saved acknowledgement', async () => {
  const f = fixture(async () => { throw new Error('Syntetisk netværksfejl'); });
  f.typeCalendar('my-calendar'); await f.saveCalendar();
  assert.equal(f.dirty('calendar-selection'), true); assert.equal(f.get('meal-google-calendar-id').value, 'my-calendar');
  assert.match(f.get('meal-calendar-draft-status').textContent, /kunne ikke bekræftes.*kladde er bevaret/);
  assert.equal(f.saving(), false); assert.equal(f.get('meal-google-calendar-form-submit').disabled, false);
});

test('GUI-T11 confirmed calendar save remains confirmed when its subsequent status refresh fails', async () => {
  const f = fixture(async call => { if (call.path.endsWith('/select')) return { ok: true }; throw new Error('Syntetisk læsefejl'); });
  f.typeCalendar('saved-calendar'); await f.saveCalendar();
  assert.equal(f.dirty('calendar-selection'), false);
  assert.match(f.get('meal-calendar-draft-status').textContent, /blev gemt, men status kunne ikke opdateres/);
  assert.equal(f.saved.has('jarvis:v5:meal-drafts'), false);
});

test('GUI-T11 calendar acknowledgement from a logged-out owner cannot clear or unlock a newer save', async () => {
  const first = deferred(), second = deferred(); let writes = 0;
  const f = fixture(call => call.path.endsWith('/select') ? (++writes === 1 ? first.promise : second.promise) : status('second-calendar'));
  f.typeCalendar('first-calendar'); const oldSave = f.saveCalendar(); f.logout();
  f.setOwner('synthetic-second-owner'); f.typeCalendar('second-calendar'); const newSave = f.saveCalendar();
  first.resolve({ ok: true }); await oldSave;
  assert.equal(f.get('meal-google-calendar-id').value, 'second-calendar'); assert.equal(f.dirty('calendar-selection'), true);
  assert.equal(f.saving(), true); assert.equal(f.get('meal-google-calendar-form-submit').disabled, true);
  assert.match(f.get('meal-calendar-draft-status').textContent, /^Gemmer/);
  second.resolve({ ok: true }); await newSave;
  assert.equal(f.get('meal-google-calendar-id').value, 'second-calendar'); assert.equal(f.dirty('calendar-selection'), false);
});

test('GUI-T11 out-of-order calendar reads and old-owner reads do not replace newer state', async () => {
  const first = deferred(), second = deferred(), third = deferred(); let reads = 0;
  const f = fixture(() => [first, second, third][reads++].promise);
  const oldRead = f.refreshGoogle(), newRead = f.refreshGoogle();
  second.resolve(status('new-calendar')); await newRead; first.resolve(status('old-calendar')); await oldRead;
  assert.equal(f.get('meal-google-calendar-id').value, 'new-calendar');
  const beforeLogout = f.refreshGoogle(); f.logout(); f.setOwner('synthetic-next-owner'); f.typeCalendar('private-new-draft');
  third.resolve(status('private-old-calendar')); await beforeLogout;
  assert.equal(f.get('meal-google-calendar-id').value, 'private-new-draft');
  assert.equal(f.get('meal-google-status').textContent, '');
});

test('GUI-T11 late recipe import cannot clear a new-session draft or unlock its pending controls', async () => {
  const first = deferred(), second = deferred(); let imports = 0;
  const f = fixture(() => (++imports === 1 ? first.promise : second.promise));
  f.get('meal-recipe-text').value = 'First source'; const oldImport = f.get('meal-recipe-form').fire('submit');
  assert.equal(f.get('meal-recipe-text').disabled, true); f.logout();
  assert.equal(f.get('meal-recipe-text').disabled, false);
  f.setOwner('synthetic-new-owner'); f.get('meal-recipe-text').value = 'New source'; f.markDirty('recipe-capture');
  const newImport = f.get('meal-recipe-form').fire('submit');
  first.resolve({ ok: true }); await oldImport;
  assert.equal(f.get('meal-recipe-text').value, 'New source'); assert.equal(f.dirty('recipe-capture'), true);
  assert.equal(f.get('meal-recipe-text').disabled, true); assert.deepEqual(f.rendered, []);
  second.resolve({ ok: true }); await newImport;
  assert.equal(f.get('meal-recipe-text').value, ''); assert.equal(f.get('meal-recipe-text').disabled, false);
  assert.deepEqual(f.rendered, ['recipes-read']);
});

for (const kind of ['search', 'basket']) test(`GUI-T11 a late Nemlig ${kind} read cannot render after logout or refresh another owner`, async () => {
  const pending = deferred(); const f = fixture(() => pending.promise);
  const operation = kind === 'search' ? f.get('meal-nemlig-search-form').fire('submit') : f.get('meal-nemlig-view-basket').fire('click');
  f.logout(); f.setOwner('synthetic-new-owner');
  pending.resolve(kind === 'search' ? { products: [{ id: 'private-old-result' }] } : { basket: { id: 'private-old-basket' } });
  await operation; assert.deepEqual(f.rendered, []); assert.deepEqual(f.notices, []);
});
