// v5 — explicit household facts, editable drafts and reviewed shopping.
// All source text is data; no HTML from recipes, Discord or Nemlig is executed.
let mealLoaded = false;
let mealRefreshPromise = null;
let mealRefreshAgain = false;
let mealSessionGeneration = 0;
let mealFieldSequence = 0;
let mealData = { profile: {}, plans: [], household: { configured: false, days: {} }, recipes: [] };
const mealSelection = new Map();
const mealDirty = new Set();
const mealDraftKey = 'jarvis:v5:meal-drafts';
const mealDraftControllers = new Map();
const mealServerSignatures = new WeakMap();
let mealDraftStorageAvailable = true;
let mealRecoveredDrafts = {};
let mealHouseholdRevision = null;
let mealProfileRevision = null;
const mealEl = id => document.getElementById(id);
const mealThemes = [
  ['everyday', 'Hverdag'], ['child_friendly', 'Børnevenlig'], ['vegan', 'Vegansk'],
  ['vegetarian', 'Vegetarisk'], ['date', 'Date'], ['party', 'Fest'], ['quick', 'Hurtig'],
];
const mealDiets = [['omnivore', 'Almindelig'], ['vegetarian', 'Vegetarisk'], ['vegan', 'Vegansk']];
const mealUnits = ['g', 'kg', 'ml', 'l', 'dl', 'cl', 'stk', 'fed', 'tsk', 'spsk', 'pakke'];
const mealWeekdays = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const mealOccasions = [['ordinary', 'Almindelig dag'], ['holiday', 'Ferie / fridag'], ['absence', 'Fravær – ingen spiser hjemme']];
let mealPantryEditor = null;
let mealHouseholdChildrenEditor = null;
let mealRhythmEditor = null;
let mealInventoryEditor = null;
let mealInventory = { configured: false, revision: 1, items: [] };
let mealCalendarCache = null;
let mealCalendarReadSequence = 0;
let mealCalendarReading = false;
let mealCalendarRenderSignature = '';

// Tab-scoped recovery never contains credentials or approval intents. The
// original revision travels with a draft, so reload cannot turn a stale edit
// into an approval of unseen newer data. Restoring fields never submits them.
try {
  if (localStorage.getItem('jarvisAccessToken')) {
    const raw = sessionStorage.getItem(mealDraftKey);
    if (raw && raw.length <= 2_000_000) {
      const saved = JSON.parse(raw);
      if (saved?.version === 1 && saved.drafts && typeof saved.drafts === 'object' && !Array.isArray(saved.drafts)) {
        mealRecoveredDrafts = Object.fromEntries(Object.entries(saved.drafts).filter(([key, value]) =>
          /^(?:household|profile|inventory|recipe-capture|calendar-selection|family-day:[\d-]+|(?:plan|recipe|shopping-draft|nemlig-proposal):[\w:-]+)$/.test(key) &&
          value && typeof value === 'object' && value.fields && typeof value.fields === 'object').slice(0, 80));
      }
    }
  } else sessionStorage.removeItem(mealDraftKey);
} catch { mealDraftStorageAvailable = false; }

function mealPersistDrafts() {
  if (!localStorage.getItem('jarvisAccessToken')) return;
  const drafts = { ...mealRecoveredDrafts };
  let capturedAll = true;
  for (const [key, controller] of mealDraftControllers) {
    if (mealDirty.has(key)) {
      try { drafts[key] = { record: controller.record, fields: controller.capture() }; }
      catch { capturedAll = false; }
    } else delete drafts[key];
  }
  try {
    if (Object.keys(drafts).length) {
      const serialized = JSON.stringify({ version: 1, drafts });
      if (serialized.length > 2_000_000) throw new Error('Kladderne er større end browserens lokale grænse.');
      sessionStorage.setItem(mealDraftKey, serialized);
    } else sessionStorage.removeItem(mealDraftKey);
    mealDraftStorageAvailable = capturedAll;
  } catch {
    mealDraftStorageAvailable = false;
    for (const [key, controller] of mealDraftControllers) if (mealDirty.has(key) && controller.status)
      controller.status.textContent = 'Ugemt kladde. Browseren kan ikke sikre den ved genindlæsning; behold fanen åben eller gem.';
  }
}

function mealRegisterDraft(key, record, capture, restore, status) {
  mealDraftControllers.set(key, { record, capture, status });
  const recovered = mealRecoveredDrafts[key];
  if (!recovered) return false;
  delete mealRecoveredDrafts[key];
  try {
    restore(recovered.fields);
    mealDirty.add(key);
    if (status) status.textContent = 'Ugemt kladde gendannet i denne fane. Kontrollér oplysninger og revision, før du gemmer.';
    return true;
  } catch {
    // Keep an un-restorable draft in session storage instead of deleting data.
    mealRecoveredDrafts[key] = recovered;
    if (status) status.textContent = 'En lokal kladde kunne ikke indlæses sikkert. Den er bevaret i denne fanes lager; gem ikke oven i den uden gennemgang.';
    return false;
  }
}

function mealClearDraft(key) {
  mealDirty.delete(key); delete mealRecoveredDrafts[key]; mealDraftControllers.delete(key);
  for (const card of document.querySelectorAll('[data-record-key]')) if (card.dataset.recordKey === key) mealServerSignatures.delete(card);
  mealPersistDrafts();
}

const mealRawText = (value, max = 20000) => typeof value === 'string' ? value.slice(0, max) : '';
const mealRawRows = (value, max = 100) => Array.isArray(value) ? value.slice(0, max).filter(item => item && typeof item === 'object') : [];

function mealNode(tag, value = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = String(value);
  if (className) node.className = className;
  return node;
}

function mealApi(path, method = 'GET', body) {
  return api(path, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
}

function mealSessionCurrent(generation) {
  return generation === mealSessionGeneration && Boolean(localStorage.getItem('jarvisAccessToken'));
}

function mealField(label, control) {
  const wrapper = mealNode('div', '', 'meal-field');
  const caption = mealNode('label', label);
  if (!control.id) control.id = 'meal-field-' + (++mealFieldSequence);
  caption.htmlFor = control.id;
  // Keep option text outside the label. Every field has one exact, stable
  // accessible name, independent of its selected value or catalogue contents.
  wrapper.append(caption, control);
  return wrapper;
}

function mealInput(value = '', type = 'text', attributes = {}) {
  const input = document.createElement('input');
  input.type = type; input.value = value ?? '';
  for (const [name, content] of Object.entries(attributes)) input.setAttribute(name, String(content));
  return input;
}

function mealTextArea(value = '', rows = 3) {
  const field = document.createElement('textarea');
  field.value = value || ''; field.rows = rows;
  return field;
}

function mealSelect(options, value) {
  const select = document.createElement('select');
  for (const [id, label] of options) {
    const option = mealNode('option', label); option.value = id; select.append(option);
  }
  select.value = value ?? '';
  return select;
}

function mealCheck(label, checked) {
  const control = mealInput('', 'checkbox');
  control.checked = Boolean(checked);
  const wrapper = mealNode('label', '', 'inline-check');
  wrapper.append(control, mealNode('span', label));
  return { wrapper, control };
}

function mealLockControls(scope) {
  const controls = scope ? [...scope.querySelectorAll('input, select, textarea, button')] : [];
  const disabled = controls.map(control => control.disabled);
  for (const control of controls) control.disabled = true;
  if (scope) scope.setAttribute('aria-busy', 'true');
  return () => {
    for (let i = 0; i < controls.length; i++) {
      if (controls[i].isConnected && controls[i].dataset.keepDisabled !== 'true') controls[i].disabled = disabled[i];
    }
    if (scope?.isConnected) scope.removeAttribute('aria-busy');
  };
}

function mealAction(label, operation, status, primary = false) {
  const button = mealNode('button', label, primary ? 'primary' : 'secondary');
  button.type = 'button';
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const unlock = mealLockControls(button.closest('.meal-card, .meal-family-day'));
    button.disabled = true;
    try { await operation(); }
    catch (error) {
      if (status) status.textContent = error.message;
      toast(error.message);
    } finally {
      unlock();
      if (button.isConnected && button.dataset.keepDisabled !== 'true') button.disabled = false;
    }
  });
  return button;
}

function mealLocalDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function mealAddDays(value, count) {
  const date = new Date(String(value) + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime())) throw new Error('Vælg en gyldig dato.');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function mealMonday(value = mealLocalDate()) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function mealDayLabel(value) {
  const date = new Date(String(value) + 'T12:00:00Z');
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Copenhagen' }).format(date)
    : String(value);
}

function mealChildrenText(children) {
  return (children || []).map(child => String(child.age) + (child.portion == null ? '' : ':' + child.portion)).join(', ');
}

function mealPortionsText(adults, children = [], adultPortion = 1, guests = {}) {
  if (!Number.isInteger(adults)) return 'Ukendt portionsgrundlag';
  const parts = children.map(child => Number(child.portion ?? (child.age <= 5 ? 0.5 : child.age <= 12 ? 0.75 : 1)));
  const guestParts = (guests.children || []).map(child => Number(child.portion ?? (child.age <= 5 ? 0.5 : child.age <= 12 ? 0.75 : 1)));
  const guestAdults = guests.adults || 0;
  const guestFactor = guests.adultPortion ?? 1;
  const total = Math.round((adults * adultPortion + parts.reduce((sum, part) => sum + part, 0) +
    guestAdults * guestFactor + guestParts.reduce((sum, part) => sum + part, 0)) * 1000) / 1000;
  const format = number => number.toLocaleString('da-DK', { maximumFractionDigits: 3 });
  return `${format(total)} portioner (${adults} voksne à ${format(adultPortion)}${parts.length ? ' + ' + parts.length + ' børn à ' + parts.map(format).join(', ') : ''}` +
    `${guestAdults ? ' + ' + guestAdults + ' voksne gæster à ' + format(guestFactor) : ''}${guestParts.length ? ' + ' + guestParts.length + ' gæstebørn à ' + guestParts.map(format).join(', ') : ''})`;
}

function mealAgeText(ageRecordedAt) {
  if (!ageRecordedAt) return 'Alderens dato er ukendt. Kontrollér den ved behov; alderen opdateres ikke automatisk.';
  const ageDays = (new Date(mealLocalDate() + 'T12:00:00Z') - new Date(ageRecordedAt + 'T12:00:00Z')) / 86400000;
  return 'Alder kontrolleret ' + ageRecordedAt + (ageDays > 365 ? ' · Over ét år gammel – gennemgå alderen.' : '. Ingen automatisk aldring.');
}

function mealReadPortion(field) {
  const value = Number(field.value);
  if (!field.value.trim() || !Number.isFinite(value) || value < 0.25 || value > 3) throw new Error('Angiv en portionsfaktor mellem 0,25 og 3.');
  return Math.round(value * 1000) / 1000;
}

function mealReadChildren(value) {
  if (!String(value).trim()) return [];
  const children = String(value).split(',').map(entry => {
    const pieces = entry.trim().split(':');
    const age = Number(pieces[0]);
    if (!pieces[0] || pieces.length > 2 || !Number.isInteger(age) || age < 0 || age > 17) throw new Error('Skriv børnenes aldre 0–17, adskilt af komma. Fx 4, 10.');
    const child = { age };
    if (pieces.length === 2) {
      const portion = Number(pieces[1]);
      if (!pieces[1] || !Number.isFinite(portion) || portion < 0.25 || portion > 3) throw new Error('Portionsfaktoren skal være 0.25–3. Brug punktum som decimaltegn.');
      child.portion = portion;
    }
    return child;
  });
  if (children.length > 24) throw new Error('Højst 24 personer i en husstand.');
  return children;
}

function mealReadAdults(field) {
  const value = Number(field.value);
  if (field.value === '' || !Number.isInteger(value) || value < 0 || value > 24) throw new Error('Angiv 0–24 voksne; et tomt felt er ukendt, ikke nul.');
  return value;
}

function mealIngredientText(items) {
  return (items || []).map(item => [item.name, item.quantity, item.unit].join(' | ')).join('\n');
}

function mealProductText(value, depth = 0) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).slice(0, 3000);
  if (depth > 2 || typeof value !== 'object') return '';
  return (Array.isArray(value) ? value.slice(0, 20) : Object.values(value).slice(0, 20))
    .map(item => mealProductText(item, depth + 1)).filter(Boolean).join(' · ').slice(0, 3000);
}

function mealReadIngredients(value) {
  return String(value).split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const pieces = line.split('|').map(part => part.trim());
    const quantity = Number((pieces[1] || '').replace(',', '.'));
    if (pieces.length !== 3 || !pieces[0] || !pieces[1] || !Number.isFinite(quantity) || quantity < 0 || !pieces[2]) {
      throw new Error('Skriv hver ingrediens som navn | antal | enhed. Fx ris | 250 | g.');
    }
    return { name: pieces[0], quantity, unit: pieces[2] };
  });
}

function mealStructuredGroup(title, editor) {
  const group = mealNode('fieldset', '', 'meal-structured-group');
  group.append(mealNode('legend', title), editor.element);
  return group;
}

function mealIngredientEditor(initial = [], onChange = () => {},
  { maxRows = 60, maxName = 100, maxQuantity = 1_000_000, allowZero = false } = {}) {
  const element = mealNode('div', '', 'meal-ingredient-editor');
  const rows = mealNode('div', '', 'meal-structured-rows');
  const controls = [];
  const add = mealNode('button', '+ Tilføj vare', 'secondary meal-add-row'); add.type = 'button';
  function appendRow(item = {}) {
    if (controls.length >= maxRows) return;
    const row = mealNode('div', '', 'meal-structured-row');
    const name = mealInput(item.name || '', 'text', { placeholder: 'Ingrediens', maxlength: maxName, 'aria-label': 'Ingrediens' });
    const quantity = mealInput(item.quantity ?? '', 'number', { min: allowZero ? 0 : 0.001, max: maxQuantity, step: 'any', 'aria-label': 'Mængde' });
    const unit = mealSelect(mealUnits.map(value => [value, value]), item.unit || 'g'); unit.setAttribute('aria-label', 'Enhed');
    const remove = mealNode('button', 'Fjern', 'secondary'); remove.type = 'button'; remove.setAttribute('aria-label', 'Fjern ingrediens');
    const entry = { row, name, quantity, unit };
    remove.addEventListener('click', () => { controls.splice(controls.indexOf(entry), 1); row.remove(); onChange(); });
    for (const control of [name, quantity, unit]) control.addEventListener('input', onChange);
    row.append(name, quantity, unit, remove); rows.append(row); controls.push(entry);
  }
  add.addEventListener('click', () => { appendRow(); controls.at(-1)?.name.focus(); onChange(); });
  function setItems(items = []) {
    rows.replaceChildren(); controls.length = 0;
    for (const item of items) appendRow(item);
  }
  function read() {
    return controls.map(({ name, quantity, unit }) => {
      const amount = Number(quantity.value);
      if (!name.value.trim() || name.value.trim().length > maxName || !quantity.value || !Number.isFinite(amount) ||
          amount < (allowZero ? 0 : Number.EPSILON) || amount > maxQuantity || !mealUnits.includes(unit.value)) {
        throw new Error('Udfyld ingrediens, gyldig mængde og enhed for hver vare.');
      }
      return { name: name.value.trim(), quantity: amount, unit: unit.value };
    });
  }
  element.append(rows, add); setItems(initial);
  const snapshot = () => controls.map(({ name, quantity, unit }) => ({ name: name.value, quantity: quantity.value, unit: unit.value }));
  return { element, setItems, read, snapshot, restore: value => setItems(mealRawRows(value, maxRows)) };
}

function mealChildrenEditor(initial = [], onChange = () => {}) {
  const element = mealNode('div', '', 'meal-children-editor');
  const rows = mealNode('div', '', 'meal-structured-rows');
  const controls = [];
  const add = mealNode('button', '+ Tilføj barn', 'secondary meal-add-row'); add.type = 'button';
  function appendRow(child = {}) {
    if (controls.length >= 24) return;
    const row = mealNode('div', '', 'meal-child-row');
    const age = mealInput(child.age ?? '', 'number', { min: 0, max: 17, step: 1, 'aria-label': 'Barnets alder' });
    const portion = mealInput(child.portion ?? '', 'number', { min: 0.25, max: 3, step: 0.05, placeholder: 'Automatisk', 'aria-label': 'Portionsfaktor' });
    const remove = mealNode('button', 'Fjern', 'secondary'); remove.type = 'button'; remove.setAttribute('aria-label', 'Fjern barn');
    const ageStatus = mealNode('span', mealAgeText(child.ageRecordedAt), 'muted micro meal-child-age-status');
    const ageChecked = mealNode('button', 'Alder kontrolleret i dag', 'secondary meal-age-confirm'); ageChecked.type = 'button';
    const entry = { row, age, portion, ageRecordedAt: child.ageRecordedAt || null };
    age.addEventListener('input', () => {
      if (age.value !== '' && Number.isInteger(Number(age.value)) && Number(age.value) >= 0 && Number(age.value) <= 17) {
        entry.ageRecordedAt = mealLocalDate(); ageStatus.textContent = mealAgeText(entry.ageRecordedAt);
      }
    });
    ageChecked.addEventListener('click', () => {
      if (age.value === '' || !Number.isInteger(Number(age.value)) || Number(age.value) < 0 || Number(age.value) > 17) {
        ageStatus.textContent = 'Udfyld en gyldig alder 0–17, før den bekræftes.'; return;
      }
      entry.ageRecordedAt = mealLocalDate(); ageStatus.textContent = mealAgeText(entry.ageRecordedAt); onChange();
    });
    remove.addEventListener('click', () => { controls.splice(controls.indexOf(entry), 1); row.remove(); onChange(); });
    for (const control of [age, portion]) control.addEventListener('input', onChange);
    row.append(age, portion, remove, ageStatus, ageChecked); rows.append(row); controls.push(entry);
  }
  add.addEventListener('click', () => { appendRow(); controls.at(-1)?.age.focus(); onChange(); });
  function setItems(items = []) { rows.replaceChildren(); controls.length = 0; for (const item of items) appendRow(item); }
  function read() {
    return controls.map(({ age, portion, ageRecordedAt }) => {
      const years = Number(age.value);
      if (!age.value || !Number.isInteger(years) || years < 0 || years > 17) throw new Error('Angiv barnets alder mellem 0 og 17.');
      const dating = ageRecordedAt ? { ageRecordedAt } : {};
      if (!portion.value.trim()) return { age: years, ...dating };
      const factor = Number(portion.value);
      if (!Number.isFinite(factor) || factor < 0.25 || factor > 3) throw new Error('Portionsfaktor skal være mellem 0,25 og 3.');
      return { age: years, portion: factor, ...dating };
    });
  }
  element.append(rows, add); setItems(initial);
  const snapshot = () => controls.map(({ age, portion, ageRecordedAt }) => ({ age: age.value, portion: portion.value, ageRecordedAt }));
  return { element, setItems, read, snapshot, restore: value => setItems(mealRawRows(value, 24)) };
}

function mealGuestEditor(initial = {}, onChange = () => {}) {
  const element = mealNode('div', '', 'meal-guests-editor');
  const adults = mealInput(initial.adults ?? 0, 'number', { min: 0, max: 24 });
  const adultPortion = mealInput(initial.adultPortion ?? 1, 'number', { min: 0.25, max: 3, step: 0.05 });
  const children = mealChildrenEditor(initial.children || [], onChange);
  element.append(mealNode('p', 'Gæster lægges til de hjemmeværende. Medtag dem ikke også i husstandens antal.', 'muted micro'),
    mealField('Voksne gæster', adults), mealField('Portionsfaktor for voksne gæster', adultPortion),
    mealStructuredGroup('Gæstebørn – alder og portioner', children));
  for (const field of [adults, adultPortion]) field.addEventListener('input', onChange);
  return { element,
    read: () => ({ adults: mealReadAdults(adults), adultPortion: mealReadPortion(adultPortion), children: children.read() }),
    snapshot: () => ({ adults: adults.value, adultPortion: adultPortion.value, children: children.snapshot() }),
    restore(value = {}) { adults.value = mealRawText(value.adults, 20); adultPortion.value = mealRawText(value.adultPortion, 20); children.restore(value.children); },
  };
}

function mealBuildRhythmEditor(initial = null, onChange = () => {}) {
  const element = mealNode('section', '', 'meal-v5-panel');
  const heading = mealNode('h3', 'Gentagende familierytme');
  const enabled = mealCheck('Brug ugentlig eller flerugers rytme', Boolean(initial));
  const anchor = mealInput(initial?.anchorMonday || mealMonday(), 'date', { 'aria-label': 'Mandag hvor rytmen begynder' });
  const weeksRoot = mealNode('div', '', 'meal-rhythm-weeks');
  const addWeek = mealNode('button', '+ Tilføj uge', 'secondary'); addWeek.type = 'button';
  const removeWeek = mealNode('button', 'Fjern sidste uge', 'secondary'); removeWeek.type = 'button';
  const weekControls = [];
  const actionRow = mealNode('div', '', 'meal-actions'); actionRow.append(addWeek, removeWeek);
  const editor = mealNode('div', '', 'meal-rhythm-editor');
  editor.append(mealField('Startmandag for rytmen', anchor), weeksRoot, actionRow);
  enabled.control.addEventListener('change', () => { editor.hidden = !enabled.control.checked; onChange(); });
  anchor.addEventListener('input', onChange);
  function addWeekBlock(days = {}, draft = false) {
    if (weekControls.length >= 4) return;
    const week = mealNode('details', '', 'meal-rhythm-week');
    week.append(mealNode('summary', 'Uge ' + (weekControls.length + 1)));
    const dayControls = [];
    for (let index = 0; index < 7; index++) {
      const data = days[String(index + 1)] || null;
      const row = mealNode('div', '', 'meal-rhythm-day');
      const active = mealCheck(mealWeekdays[index] + ' – brug særlig husstand', draft ? Boolean(data?.active) : Boolean(data));
      const fields = mealNode('div', '', 'meal-rhythm-day-fields');
      const adults = mealInput(data?.adults ?? 0, 'number', { min: 0, max: 24 });
      const adultPortion = mealInput(data?.adultPortion ?? 1, 'number', { min: 0.25, max: 3, step: 0.05 });
      const children = mealChildrenEditor(data?.children || [], onChange);
      const guests = mealGuestEditor(data?.guests || {}, onChange);
      const occasion = mealSelect(mealOccasions, data?.occasion || 'ordinary');
      const theme = mealSelect(mealThemes, data?.theme || 'everyday');
      const skip = mealCheck('Ingen aftensmad hjemme', data?.skip);
      fields.append(mealField('Voksne hjemme', adults), mealField('Portionsfaktor for voksne', adultPortion),
        mealStructuredGroup('Børn hjemme og portioner', children), mealField('Dagens forhold', occasion),
        mealField('Tema', theme), mealStructuredGroup('Gæster', guests), skip.wrapper);
      fields.hidden = !active.control.checked;
      active.control.addEventListener('change', () => { fields.hidden = !active.control.checked; onChange(); });
      for (const field of [adults, adultPortion, occasion, theme, skip.control]) field.addEventListener('input', onChange);
      row.append(active.wrapper, fields); week.append(row);
      dayControls.push({ active: active.control, adults, adultPortion, children, guests, occasion, theme, skip: skip.control });
    }
    weeksRoot.append(week); weekControls.push({ week, dayControls });
    removeWeek.disabled = weekControls.length <= 1; addWeek.disabled = weekControls.length >= 4;
  }
  function set(value, draft = false) {
    enabled.control.checked = draft ? Boolean(value?.enabled) : Boolean(value); anchor.value = value?.anchorMonday ?? mealMonday();
    weeksRoot.replaceChildren(); weekControls.length = 0;
    for (const week of value?.weeks?.length ? value.weeks.slice(0, 4) : [{}]) addWeekBlock(week, draft);
    editor.hidden = !enabled.control.checked;
  }
  function read() {
    if (!enabled.control.checked) return null;
    const date = new Date(anchor.value + 'T12:00:00Z');
    if (!anchor.value || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor.value || date.getUTCDay() !== 1)
      throw new Error('Familierytmen skal starte på en gyldig mandag.');
    return { anchorMonday: anchor.value, weeks: weekControls.map(({ dayControls }) => Object.fromEntries(dayControls.flatMap((day, index) => {
      if (!day.active.checked) return [];
      const absent = day.occasion.value === 'absence';
      return [[String(index + 1), { adults: absent ? 0 : mealReadAdults(day.adults),
        adultPortion: absent ? 1 : mealReadPortion(day.adultPortion), children: absent ? [] : day.children.read(),
        guests: absent ? { adults: 0, children: [] } : day.guests.read(), occasion: day.occasion.value,
        theme: day.theme.value, skip: absent || day.skip.checked }]];
    }))) };
  }
  addWeek.addEventListener('click', () => { addWeekBlock(); onChange(); });
  removeWeek.addEventListener('click', () => { if (weekControls.length <= 1) return;
    weekControls.pop().week.remove(); removeWeek.disabled = weekControls.length <= 1; addWeek.disabled = false; onChange(); });
  element.append(heading, enabled.wrapper, editor); set(initial);
  const snapshot = () => ({ enabled: enabled.control.checked, anchorMonday: anchor.value,
    weeks: weekControls.map(({ dayControls }) => Object.fromEntries(dayControls.map((day, index) => [String(index + 1), {
      active: day.active.checked, adults: day.adults.value, adultPortion: day.adultPortion.value,
      children: day.children.snapshot(), guests: day.guests.snapshot(), occasion: day.occasion.value,
      theme: day.theme.value, skip: day.skip.checked,
    }]))),
  });
  return { element, set, read, snapshot, restore: value => set(value, true) };
}

function mealEffectiveDay(household, date) {
  const override = household.days?.[date];
  let repeating = null;
  const rhythm = household.rhythm;
  if (!override && rhythm?.weeks?.length && rhythm.anchorMonday) {
    const days = Math.round((new Date(date + 'T12:00:00Z') - new Date(rhythm.anchorMonday + 'T12:00:00Z')) / 86400000);
    const index = ((Math.floor(days / 7) % rhythm.weeks.length) + rhythm.weeks.length) % rhythm.weeks.length;
    const weekday = String(new Date(date + 'T12:00:00Z').getUTCDay() || 7);
    repeating = rhythm.weeks[index]?.[weekday] || null;
  }
  return { id: date, revision: household.revision || 1, adults: household.adults, adultPortion: household.adultPortion ?? 1,
    children: household.children || [], guests: { adults: 0, children: [] }, occasion: 'ordinary', theme: 'everyday', skip: false,
    ...(repeating || {}), ...(override || {}), override: Boolean(override), repeating: Boolean(repeating),
    configured: household.configured || Boolean(override || repeating) };
}

function mealCalendarTimestamp(value) {
  const instant = new Date(value);
  return value && Number.isFinite(instant.getTime()) ? new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', dateStyle: 'short', timeStyle: 'short',
  }).format(instant) : 'ukendt';
}

function mealCalendarObservation(cache, date) {
  const day = cache?.dinnerDays?.find(item => item.date === date);
  const expiresAt = Date.parse(cache?.expiresAt);
  const expired = !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  const reasons = { unknown: 'Ingen læst kalenderperiode', stale: 'Kalenderdata er forældede', unavailable: 'Seneste kalenderlæsning fejlede',
    expired_login: 'Google-login er udløbet', outside_coverage: 'Datoens middagstid ligger uden for den læste periode' };
  if (!cache?.ready || expired || !day || day.status === 'unknown') {
    const reason = expired && cache?.ready ? 'stale' : day?.reason || cache?.cacheState || 'unknown';
    return { state: 'unknown', text: `Ukendt: ${reasons[reason] || 'Kalenderdækningen er ikke bekræftet'}. Det betyder ikke ledig tid.`, events: [] };
  }
  if (day.status === 'busy') return { state: 'busy', text: `${day.eventCount} registrerede tidskonflikter kl. 16–20. Fremmøde afgøres ikke af kalenderen.`, events: day.events || [] };
  if (day.status === 'no_conflict') return { state: 'no_conflict', text: 'Ingen registrerede konflikter kl. 16–20 i den læste kalender. Ikke bevis for fremmøde.', events: [] };
  return { state: 'unknown', text: 'Ukendt kalenderstatus. Ingen ledig tid eller tilstedeværelse antages.', events: [] };
}

function showHouseholdCalendar(household = mealData.household, cache = mealCalendarCache) {
  const root = mealEl('meal-family-calendar-comparison'), status = mealEl('meal-family-calendar-status');
  if (!root || !status) return;
  const start = mealEl('meal-family-start').value || mealLocalDate();
  const dates = Array.from({ length: 7 }, (_, index) => mealAddDays(start, index));
  const signature = JSON.stringify({ days: dates.map(date => mealEffectiveDay(household || {}, date)),
    source: cache && { calendarId: cache.calendarId, ready: cache.ready, cacheState: cache.cacheState, fetchedAt: cache.fetchedAt,
      expiresAt: cache.expiresAt, coverage: cache.coverage, lastReadError: cache.lastReadError, dinnerDays: cache.dinnerDays },
    expired: !Number.isFinite(Date.parse(cache?.expiresAt)) || Date.parse(cache.expiresAt) <= Date.now() });
  if (mealCalendarRenderSignature === signature) return;
  mealCalendarRenderSignature = signature;
  status.textContent = `Valgt kalender: ${cache?.calendarId || 'ikke kendt'}. Kun læsning. Senest hentet: ${mealCalendarTimestamp(cache?.fetchedAt)}.`
    + (cache?.coverage ? ` Dækning: ${mealCalendarTimestamp(cache.coverage.start)} – ${mealCalendarTimestamp(cache.coverage.end)}. Frisk indtil: ${mealCalendarTimestamp(cache.expiresAt)}.`
      : ' Ingen dokumenteret kalenderdækning i denne serverkørsel.')
    + (cache?.lastReadError ? ` Læsefejl: ${cache.lastReadError}. Tidligere observationer bekræfter ikke den aktuelle kapacitet.` : '');
  const table = mealNode('table', '', 'meal-calendar-comparison');
  table.append(mealNode('caption', 'Gemte husstandsoplysninger og læste kalenderkonflikter – to forskellige kilder'));
  const head = mealNode('thead'), headings = mealNode('tr');
  for (const value of ['Dato', 'Husstand – eksplicit oplyst', 'Kalender – kun læst']) { const cell = mealNode('th', value); cell.setAttribute('scope', 'col'); headings.append(cell); }
  head.append(headings); table.append(head);
  const body = mealNode('tbody');
  for (const date of dates) {
    const day = mealEffectiveDay(household || {}, date), observation = mealCalendarObservation(cache, date);
    const row = mealNode('tr'); row.dataset.calendarHouseholdDate = date;
    const heading = mealNode('th', mealDayLabel(date)); heading.setAttribute('scope', 'row');
    const people = mealNode('td');
    people.append(mealNode('p', day.configured ? day.skip ? 'Udtrykkeligt angivet: ingen aftensmad hjemme.'
      : `${day.adults} voksne og ${day.children.length} børn hjemme; ${(day.guests?.adults || 0) + (day.guests?.children?.length || 0)} gæster.`
      : 'Tilstedeværelse er ikke oplyst.'));
    people.append(mealNode('p', `Grundlag: ${day.override ? 'dagsundtagelse' : day.repeating ? 'familierytme' : day.configured ? 'eksplicit standard' : 'ukendt'} · husstandsrevision ${day.revision}.`, 'muted micro'));
    const calendar = mealNode('td', '', observation.state === 'unknown' ? 'meal-calendar-unknown' : '');
    calendar.dataset.calendarState = observation.state; calendar.append(mealNode('p', observation.text));
    if (observation.events.length) {
      const list = mealNode('ul');
      for (const event of observation.events.slice(0, 6)) list.append(mealNode('li', `${event.allDay ? 'Heldagsperiode' : `${mealCalendarTimestamp(event.start)} – ${mealCalendarTimestamp(event.end)}`} · ${event.title || 'Optaget'} · kilde-ID ${event.id || 'ukendt'}`));
      calendar.append(list);
      if (cache.dinnerDays.find(item => item.date === date).eventCount > observation.events.length)
        calendar.append(mealNode('p', 'Flere registrerede konflikter end de viste seks. Brug kalenderen til den fulde gennemgang.', 'micro'));
    }
    row.append(heading, people, calendar); body.append(row);
  }
  table.append(body); root.replaceChildren(table);
}

async function refreshHouseholdCalendar() {
  const generation = mealSessionGeneration, request = ++mealCalendarReadSequence;
  const startDate = mealEl('meal-family-start').value || mealLocalDate();
  try {
    const cache = await mealApi(`/api/google/calendar/cache?startDate=${encodeURIComponent(startDate)}&days=7`);
    if (!mealSessionCurrent(generation) || request !== mealCalendarReadSequence || startDate !== (mealEl('meal-family-start').value || mealLocalDate())) return;
    mealCalendarCache = cache;
    mealEl('meal-family-calendar-load').disabled = mealCalendarReading || !['connected', 'not_verified', 'unavailable'].includes(cache.connectionState);
    showHouseholdCalendar();
  } catch (error) {
    if (!mealSessionCurrent(generation) || request !== mealCalendarReadSequence) return;
    mealCalendarCache = { ...mealCalendarCache, ready: false, cacheState: 'unavailable', dinnerDays: [], lastReadError: error.message };
    showHouseholdCalendar();
  }
}

function mealEnhanceStaticUI() {
  const familyForm = mealEl('meal-family-form');
  const adultPortion = mealInput(1, 'number', { min: 0.25, max: 3, step: 0.05 }); adultPortion.id = 'meal-adult-portion';
  familyForm.insertBefore(mealField('Portionsfaktor for voksne', adultPortion), mealEl('meal-family-status'));
  const legacyChildren = mealEl('meal-children');
  legacyChildren.hidden = true;
  familyForm.querySelector('label[for="meal-children"]')?.remove();
  familyForm.querySelector('p code')?.closest('p')?.remove();
  mealHouseholdChildrenEditor = mealChildrenEditor([], () => {
    mealDirty.add('household'); mealEl('meal-family-status').textContent = 'Husstanden har ugemte ændringer.';
  });
  familyForm.insertBefore(mealStructuredGroup('Børn – alder og portionsfaktor', mealHouseholdChildrenEditor), mealEl('meal-family-status'));
  mealRhythmEditor = mealBuildRhythmEditor(null, () => {
    mealDirty.add('household'); mealEl('meal-family-status').textContent = 'Familierytmen har ugemte ændringer.';
  });
  mealRhythmEditor.element.append(mealNode('p',
    'Brug dagstilpasninger ved ferie, gæster eller fravær. En bestemt dato går altid forud for familierytmen, som går forud for standardhusstanden.',
    'muted micro'));
  familyForm.after(mealRhythmEditor.element);
  familyForm.append(mealAction('Kassér husstandskladde og hent gemte oplysninger', async () => {
    mealClearDraft('household'); await refreshMeals();
  }, mealEl('meal-family-status')));

  const profileForm = mealEl('meal-profile-form');
  const legacyPantry = mealEl('meal-pantry');
  legacyPantry.hidden = true;
  profileForm.querySelector('label[for="meal-pantry"]')?.remove();
  mealPantryEditor = mealIngredientEditor([], () => { mealDirty.add('profile'); }, { allowZero: true });
  profileForm.insertBefore(mealStructuredGroup('Tidligere oplyst lager – ingrediens, antal og enhed', mealPantryEditor), mealEl('meal-profile-status'));
  profileForm.append(mealAction('Kassér præferencekladde og hent gemte oplysninger', async () => {
    mealClearDraft('profile'); await refreshMeals();
  }, mealEl('meal-profile-status')));

  const stock = mealNode('section', '', 'meal-v5-panel'); stock.id = 'meal-inventory-panel';
  stock.append(mealNode('h3', 'Bekræftet lager og reserverede varer'),
    mealNode('p', 'Registrér kun varer, du faktisk har hjemme. Planer reserverer mængder, men registrerer ikke forbrug, køb eller levering.', 'muted micro'));
  const status = mealNode('p', '', 'muted micro'); status.id = 'meal-inventory-status'; status.setAttribute('aria-live', 'polite');
  mealInventoryEditor = mealBuildInventoryEditor([], () => {
    mealDirty.add('inventory'); status.textContent = 'Lagerændringer er ikke gemt.';
  });
  const save = mealAction('Gem bekræftet lager', async () => {
    const items = mealInventoryEditor.read();
    const unlock = mealLockControls(stock);
    try {
      const result = await mealApi('/api/meals/inventory', 'PUT', { expectedRevision: mealInventory.revision || 1, items });
      mealClearDraft('inventory'); mealInventory = result.inventory || result;
      await refreshMeals(); toast('Lageret er gemt. Berørte indkøbslister skal gennemgås.');
    } finally { unlock(); }
  }, status, true);
  save.id = 'meal-inventory-save';
  stock.append(mealInventoryEditor.element, status, save, mealAction('Kassér lagerkladde og hent gemte oplysninger', async () => {
    mealClearDraft('inventory'); await refreshMeals();
  }, status));
  profileForm.after(stock);
}

function mealBuildInventoryEditor(initial = [], onChange = () => {}) {
  const element = mealNode('div', '', 'meal-inventory-editor');
  const rows = mealNode('div', '', 'meal-structured-rows');
  const controls = [];
  const add = mealNode('button', '+ Registrér lagervare', 'secondary meal-add-row'); add.type = 'button';
  function appendRow(item = {}) {
    if (controls.length >= 100) return;
    const row = mealNode('div', '', 'meal-inventory-row');
    const name = mealInput(item.name || '', 'text', { placeholder: 'Vare', maxlength: 100, 'aria-label': 'Lagervare' });
    const quantity = mealInput(item.quantity ?? '', 'number', { min: 0, max: 1000000, step: 'any', 'aria-label': 'Registreret mængde' });
    const unit = mealSelect(mealUnits.map(value => [value, value]), item.unit || 'g'); unit.setAttribute('aria-label', 'Enhed');
    const expiry = mealInput(item.expiresAt || '', 'date', { 'aria-label': 'Sidste holdbarhedsdato' });
    const remove = mealNode('button', 'Fjern', 'secondary'); remove.type = 'button';
    const entry = { row, name, quantity, unit, expiry, original: item };
    remove.addEventListener('click', () => { controls.splice(controls.indexOf(entry), 1); row.remove(); onChange(); });
    for (const field of [name, quantity, unit, expiry]) field.addEventListener('input', onChange);
    row.append(name, quantity, unit, expiry, remove);
    if (item.lastConfirmedAt) row.append(mealNode('span', 'Bekræftet: ' + item.lastConfirmedAt.slice(0, 10) +
      ' · Reserveret: ' + (item.reservedQuantity ?? 0) + ' · Ledigt: ' + (item.availableQuantity ?? item.quantity) +
      (item.expired ? ' · Udløbet' : ''), 'muted micro meal-inventory-meta'));
    rows.append(row); controls.push(entry);
  }
  add.addEventListener('click', () => { appendRow(); controls.at(-1)?.name.focus(); onChange(); });
  function set(items = []) { rows.replaceChildren(); controls.length = 0; for (const item of items) appendRow(item); }
  function read() {
    return controls.map(({ name, quantity, unit, expiry, original }) => {
      const amount = Number(quantity.value);
      if (!name.value.trim() || quantity.value === '' || !Number.isFinite(amount) || amount < 0) throw new Error('Registrér navn og en gyldig lagermængde.');
      const unchanged = original.name === name.value.trim() && Number(original.quantity) === amount && original.unit === unit.value;
      return { name: name.value.trim(), quantity: amount, unit: unit.value, expiresAt: expiry.value || null,
        ...(unchanged && original.lastConfirmedAt ? { lastConfirmedAt: original.lastConfirmedAt } : {}) };
    });
  }
  element.append(rows, add); set(initial);
  const snapshot = () => controls.map(({ name, quantity, unit, expiry, original }) => ({
    name: name.value, quantity: quantity.value, unit: unit.value, expiresAt: expiry.value,
    ...(original.lastConfirmedAt ? { lastConfirmedAt: original.lastConfirmedAt } : {}),
  }));
  return { element, set, read, snapshot, restore: value => set(mealRawRows(value, 100)) };
}

// Preserve unsaved fields even when another section or Discord refreshes data.
function mealSyncCards(root, records, prefix, render, emptyText) {
  const previous = new Map([...root.children].filter(node => node.dataset.recordKey).map(node => [node.dataset.recordKey, node]));
  const desired = [];
  const protectedCards = new Set();
  const used = new Set();
  for (const record of records) {
    const key = prefix + ':' + record.id;
    let card = previous.get(key);
    // A background refresh must not replace the input currently holding focus,
    // even before its first change event. Buttons are intentionally excluded so
    // a successful save can replace the completed editor with fresh server data.
    // Clearing a draft is an explicit successful acknowledgement or discard;
    // it removes this signature so the requested refresh can also replace the
    // previously focused editor. Ordinary polls never remove the signature.
    const focusedEditor = card && mealServerSignatures.has(card) && card.contains(document.activeElement) &&
      document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    const signature = JSON.stringify(record);
    if (!card || (!mealDirty.has(key) && !focusedEditor && mealServerSignatures.get(card) !== signature)) {
      const recovered = mealRecoveredDrafts[key];
      const baseline = recovered?.record?.id === record.id ? recovered.record : record;
      card = render(baseline, key);
      card.dataset.recordKey = key;
      card.dataset.revision = String(baseline.revision || 1);
      mealServerSignatures.set(card, JSON.stringify(baseline));
    }
    if (mealDirty.has(key) || focusedEditor) protectedCards.add(card);
    if (card.dataset.revision !== String(record.revision || 1) ||
        (protectedCards.has(card) && mealServerSignatures.get(card) !== signature)) {
      const message = card.querySelector('[data-edit-status]');
      if (message) message.textContent = 'Oplysningerne er ændret et andet sted. Dine felter er bevaret; genindlæs før du gemmer.';
    }
    used.add(key); desired.push(card);
  }
  for (const [key, card] of previous) {
    if (!used.has(key) && mealDirty.has(key)) {
      const message = card.querySelector('[data-edit-status]');
      if (message) message.textContent = 'Dette udkast findes ikke længere i den seneste oversigt. Genindlæs for at kassere dine lokale ændringer.';
      desired.push(card); protectedCards.add(card);
    }
  }
  // A draft for a deleted/archived record must remain inspectable after reload.
  for (const [key, draft] of Object.entries(mealRecoveredDrafts)) if (key.startsWith(prefix + ':') && !used.has(key) && draft.record?.id) {
    const card = render(draft.record, key); card.dataset.recordKey = key;
    card.dataset.revision = String(draft.record.revision || 1);
    const message = card.querySelector('[data-edit-status]');
    if (message) message.textContent = 'Kilden findes ikke i den aktuelle oversigt. Din ugemte kladde er bevaret; kontrollér kilden eller kassér kladden eksplicit.';
    desired.push(card); protectedCards.add(card);
  }
  if (!desired.length) desired.push(mealNode('p', emptyText, 'muted small-text'));
  const keep = new Set(desired);
  for (const child of [...root.children]) if (!keep.has(child)) child.remove();
  // Moving a live input through a fragment loses focus/selection even when the
  // same node is appended again. Never detach the dirty/focused cards. Move
  // clean siblings around them instead, preserving active edits and caret.
  let anchor = null;
  for (const card of desired.slice().reverse()) {
    if (card.parentNode !== root || (!protectedCards.has(card) && card.nextSibling !== anchor)) root.insertBefore(card, anchor);
    anchor = card;
  }
  mealPersistDrafts();
}

function showMealProfile(profile, { initial = false } = {}) {
  const status = mealEl('meal-profile-status');
  if (mealDirty.has('profile') || (!mealEl('meal-profile-form').hasAttribute('aria-busy') && mealEl('meal-profile-form').contains(document.activeElement) &&
    document.activeElement?.matches('input, textarea, select'))) {
    if (mealProfileRevision !== null && mealProfileRevision !== (profile.revision || 1))
      status.textContent = 'Madpræferencerne er ændret et andet sted. Dine felter er bevaret; genindlæs før du gemmer.';
    return;
  }
  const baseline = mealRecoveredDrafts.profile?.record || profile;
  mealProfileRevision = baseline.revision || 1;
  mealEl('meal-household').value = baseline.householdSize;
  mealEl('meal-diet').value = baseline.diet;
  mealEl('meal-budget').value = baseline.budgetDkk ?? '';
  mealEl('meal-avoid').value = (baseline.avoid || []).join(', ');
  mealEl('meal-pantry').value = mealIngredientText(baseline.pantry);
  mealPantryEditor?.setItems(baseline.pantry || []);
  status.textContent = baseline.source === 'user-entered'
    ? 'Dine senest gemte præferencer er indlæst.' : 'Standardindstillinger. Angiv dine faktiske præferencer.';
  mealRegisterDraft('profile', baseline, () => ({ householdSize: mealEl('meal-household').value,
    diet: mealEl('meal-diet').value, budget: mealEl('meal-budget').value, avoid: mealEl('meal-avoid').value,
    pantry: mealPantryEditor.snapshot() }), fields => {
    mealEl('meal-household').value = mealRawText(fields.householdSize, 20); mealEl('meal-diet').value = mealRawText(fields.diet, 30);
    mealEl('meal-budget').value = mealRawText(fields.budget, 20); mealEl('meal-avoid').value = mealRawText(fields.avoid, 5000);
    mealPantryEditor.restore(fields.pantry);
  }, status);
  if (!initial && mealProfileRevision !== (profile.revision || 1)) status.textContent = 'En ugemt kladde er gendannet, men madpræferencerne er ændret et andet sted. Dine felter er bevaret.';
}

function showMealInventory(inventory = {}, { initial = false } = {}) {
  const status = mealEl('meal-inventory-status');
  const focused = mealInventoryEditor?.element.contains(document.activeElement) &&
    document.activeElement?.matches('input, textarea, select');
  if (mealDirty.has('inventory') || focused) {
    if (mealInventory.revision !== inventory.revision) status.textContent = 'Lageret er ændret et andet sted. Dine felter er bevaret; genindlæs før du gemmer.';
    return;
  }
  const baseline = mealRecoveredDrafts.inventory?.record || inventory;
  mealInventory = baseline;
  mealInventoryEditor?.set(baseline.items || []);
  status.textContent = baseline.configured
    ? 'Senest bekræftede lagerrevision: ' + (baseline.revision || 1) + '. Reserveret og ledigt vises ved hver vare.'
    : 'Intet særskilt lager er bekræftet. Oplyst lager under madpræferencer bruges indtil da.';
  mealRegisterDraft('inventory', baseline, () => ({ items: mealInventoryEditor.snapshot() }),
    fields => mealInventoryEditor.restore(fields.items), status);
  if (!initial && mealInventory.revision !== inventory.revision) status.textContent = 'En ugemt lagerkladde er gendannet, men lageret er ændret et andet sted. Dine felter er bevaret.';
}

function showHousehold(household = {}, { initial = false } = {}) {
  const focused = !mealEl('meal-family-form').hasAttribute('aria-busy') &&
    (mealEl('meal-family-form').contains(document.activeElement) || mealRhythmEditor.element.contains(document.activeElement));
  const familyStatus = mealEl('meal-family-status');
  if (!mealDirty.has('household') && !(focused && document.activeElement?.matches('input, textarea, select'))) {
    const baseline = mealRecoveredDrafts.household?.record || household;
    mealHouseholdRevision = baseline.revision || 1;
    mealEl('meal-adults').value = baseline.configured ? baseline.adults : '';
    mealEl('meal-adult-portion').value = baseline.adultPortion ?? 1;
    mealEl('meal-children').value = mealChildrenText(baseline.children);
    mealHouseholdChildrenEditor?.setItems(baseline.children || []);
    mealRhythmEditor?.set(baseline.rhythm || null);
    familyStatus.textContent = baseline.configured
      ? 'Husstanden er gemt. Dagsundtagelser har forrang over rytme og standard.'
      : 'Husstanden er ikke udfyldt. Ingen voksnes eller børns tilstedeværelse er bekræftet.';
    mealRegisterDraft('household', baseline, () => ({ adults: mealEl('meal-adults').value,
      adultPortion: mealEl('meal-adult-portion').value, children: mealHouseholdChildrenEditor.snapshot(), rhythm: mealRhythmEditor.snapshot() }), fields => {
      mealEl('meal-adults').value = mealRawText(fields.adults, 20); mealEl('meal-adult-portion').value = mealRawText(fields.adultPortion, 20);
      mealHouseholdChildrenEditor.restore(fields.children); mealRhythmEditor.restore(fields.rhythm);
    }, familyStatus);
  }
  if (initial) return;
  if (mealDirty.has('household') && mealHouseholdRevision !== null && mealHouseholdRevision !== (household.revision || 1))
    familyStatus.textContent = 'Husstanden er ændret et andet sted. Dine felter og den oprindelige revision er bevaret; genindlæs før du gemmer.';
  const start = mealEl('meal-family-start').value || mealLocalDate();
  const records = Array.from({ length: 7 }, (_, index) => mealEffectiveDay(household, mealAddDays(start, index)));
  mealSyncCards(mealEl('meal-family-days'), records, 'family-day', (day, key) => {
    const card = mealNode('article', '', 'meal-family-day');
    card.dataset.householdDate = day.id;
    card.append(mealNode('h3', mealDayLabel(day.id)), mealNode('span', day.override ? 'Dagsundtagelse' : day.repeating ? 'Familierytme' : day.configured ? 'Standardhusstand' : 'Ikke udfyldt', 'meal-status'));
    card.append(mealNode('p', day.skip ? 'Ingen aftensmad hjemme' : day.configured
      ? day.adults + ' voksne hjemme · ' + (day.children || []).length + ' børn hjemme' +
        ((day.guests?.adults || day.guests?.children?.length) ? ' · ' + (day.guests.adults + day.guests.children.length) + ' gæster' : '') +
        ' · ' + (mealThemes.find(([id]) => id === day.theme)?.[1] || 'Hverdag')
      : 'Antal spisende er ikke bekræftet.', 'muted micro'));
    if (day.occasion && day.occasion !== 'ordinary') card.append(mealNode('p', mealOccasions.find(([id]) => id === day.occasion)?.[1] || 'Særlig dag', 'muted micro'));
    if (day.configured && !day.skip) card.append(mealNode('p', mealPortionsText(day.adults, day.children, day.adultPortion ?? 1, day.guests), 'muted micro'));
    const editor = document.createElement('details'); editor.className = 'meal-details meal-family-editor';
    editor.append(mealNode('summary', 'Tilpas dagen'));
    const adults = mealInput(day.configured ? day.adults : '', 'number', { min: 0, max: 24 });
    const adultPortion = mealInput(day.adultPortion ?? 1, 'number', { min: 0.25, max: 3, step: 0.05 });
    const status = mealNode('p', '', 'muted micro'); status.dataset.editStatus = ''; status.setAttribute('aria-live', 'polite');
    const portionPreview = mealNode('p', '', 'muted micro meal-portions-preview');
    const markDirty = () => { mealDirty.add(key); status.textContent = 'Ændringer er ikke gemt endnu.'; showPortions(); };
    const children = mealChildrenEditor(day.children, markDirty);
    const guests = mealGuestEditor(day.guests || {}, markDirty);
    const occasion = mealSelect(mealOccasions, day.occasion || 'ordinary');
    const theme = mealSelect(mealThemes, day.theme || 'everyday');
    const skip = mealCheck('Ingen aftensmad hjemme', day.skip);
    function showPortions() {
      if (occasion.value === 'absence' || skip.control.checked) { portionPreview.textContent = '0 portioner – ingen aftensmad planlægges hjemme.'; return; }
      try { portionPreview.textContent = mealPortionsText(mealReadAdults(adults), children.read(), mealReadPortion(adultPortion), guests.read()); }
      catch { portionPreview.textContent = 'Udfyld antal, alder og portionsfaktorer for at se beregningen.'; }
    }
    editor.append(mealNode('p', 'Angiv kun de personer, der spiser hjemme. Ved delvist fravær sættes antal og børn til de hjemmeværende. Ferie ændrer ikke fremmøde automatisk.', 'muted micro'),
      mealField('Voksne hjemme', adults), mealField('Portionsfaktor for voksne', adultPortion),
      mealStructuredGroup('Børn hjemme – alder og portioner', children), mealField('Dagens forhold', occasion),
      mealStructuredGroup('Gæster ud over husstanden', guests), mealField('Dagens tema', theme), skip.wrapper, portionPreview);
    const actions = mealNode('div', '', 'meal-actions');
    actions.append(mealAction('Gem dag', async () => {
      const absent = occasion.value === 'absence';
      await mealApi('/api/meals/household/days/' + day.id, 'PUT', {
        expectedRevision: day.revision || 1,
        adults: absent ? 0 : mealReadAdults(adults), adultPortion: absent ? 1 : mealReadPortion(adultPortion),
        children: absent ? [] : children.read(), guests: absent ? { adults: 0, children: [] } : guests.read(),
        occasion: occasion.value, theme: theme.value, skip: absent || skip.control.checked,
      });
      mealClearDraft(key); await refreshMeals(); toast('Dagen er gemt. Kun berørte madplaner skal gennemgås igen.');
    }, status, true));
    actions.append(mealAction(day.override ? 'Fjern dagsundtagelsen' : 'Nulstil felter', async () => {
      if (day.override) await mealApi('/api/meals/household/days/' + day.id, 'DELETE', { expectedRevision: day.revision || 1 });
      mealClearDraft(key); mealServerSignatures.delete(card); await refreshMeals();
    }, status));
    if (day.override) actions.append(mealAction('Kassér lokale rettelser', async () => {
      // Discarding a stale draft must not delete a newer saved date exception.
      mealClearDraft(key); await refreshMeals();
    }, status));
    for (const field of [adults, adultPortion, occasion, theme, skip.control]) field.addEventListener('input', markDirty);
    editor.append(status, actions); card.append(editor);
    mealRegisterDraft(key, day, () => ({ adults: adults.value, adultPortion: adultPortion.value,
      children: children.snapshot(), guests: guests.snapshot(), occasion: occasion.value, theme: theme.value,
      skip: skip.control.checked, open: editor.open }), fields => {
      adults.value = mealRawText(fields.adults, 20); adultPortion.value = mealRawText(fields.adultPortion, 20);
      children.restore(fields.children); guests.restore(fields.guests);
      occasion.value = mealRawText(fields.occasion, 30); theme.value = mealRawText(fields.theme, 30);
      skip.control.checked = fields.skip === true; editor.open = true;
    }, status);
    showPortions(); return card;
  }, 'Vælg en dato for at se familiens uge.');
  showHouseholdCalendar(household);
}

function mealRecipeChoices(dish) {
  const options = (mealData.recipes || []).map(recipe => [String(recipe.id), recipe.title]);
  if (!options.some(([id]) => id === String(dish.recipeId))) options.unshift([String(dish.recipeId || ''), dish.title || 'Tilpasset ret']);
  return options;
}

function mealRecordSourceLink(sourceId, label) {
  const link = mealNode('a', label);
  link.href = '?view=meals&source=' + encodeURIComponent(sourceId);
  link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault(); mealPersistDrafts();
    selectTab('meals', { sourceId });
    document.dispatchEvent(new CustomEvent('jarvis:source-route', { detail: { id: sourceId } }));
  });
  return link;
}

function mealPriceSummary(plan) {
  const section = mealNode('section', '', 'meal-price-summary');
  const estimate = plan.priceEstimate;
  const money = value => typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('da-DK', { style: 'currency', currency: 'DKK' }) : 'ukendt';
  section.append(mealNode('h4', 'Lokalt prisoverslag for ugeplanens listevalg'));
  if (!estimate || estimate.status === 'stale-basis') {
    section.append(mealNode('p', 'Samlet pris er ukendt. Gennemgå planens aktuelle grundlag, før et nyt overslag bruges.', 'muted small-text'));
    return section;
  }
  if (plan.pricingStale) section.append(mealNode('p',
    'Prisgrundlaget er ændret eller forældet siden planen blev gemt. Se det aktuelle lokale overslag nedenfor; retter og varevalg er ikke ændret automatisk.', 'meal-warning'));
  if (estimate.requiresShoppingReview) section.append(mealNode('p',
    'Overslaget følger dine bevarede listevalg, men deres beregningsgrundlag skal gennemgås før varesøgning eller et nyt kurvforslag.', 'meal-warning'));
  const total = estimate.estimatedProductsDkk;
  section.append(mealNode('p', total == null
    ? 'Samlet pris: ukendt · ' + ((estimate.lines || []).length ? 'kendt del af overslaget: ' + money(estimate.knownProductsDkk) : 'ingen dokumenterede priser dækker behovene.')
    : 'Observeret skøn for ekstra ingredienspakker: ' + money(total), 'small-text'));
  if (estimate.status === 'no-extra-ingredients') section.append(mealNode('p',
    'Der er ingen positive mængder i det lokale prisgrundlag. Det kan skyldes registreret lager eller eksplicitte udeladelser; ikke bevis på lager, den rigtige kurvs værdi eller gennemførte køb.', 'muted micro'));
  if (estimate.budgetStatus === 'over') section.append(mealNode('p',
    'Den kendte del er allerede over budgetmålet på ' + money(estimate.budgetTargetDkk) + '.', 'meal-warning'));
  else if (estimate.budgetStatus === 'unknown') section.append(mealNode('p',
    'Budgetstatus er ukendt, fordi priser eller grundlag mangler. Ukendte varer er ikke gratis.', 'muted micro'));
  else if (estimate.budgetStatus === 'within') section.append(mealNode('p',
    'Det observerede lokale overslag er inden for budgetmålet på ' + money(estimate.budgetTargetDkk) + ' — ikke en fremtidig prisgaranti.', 'muted micro'));
  section.append(mealNode('p', 'Kun prisobservationer højst ' + (estimate.maxObservationAgeHours || 24) +
    ' timer gamle bruges. Dokumenterede priseksempler sammenlignes; dine varevalg er ikke ændret. Overslaget erstatter ikke det gennemgåede kurvforslags pris.', 'muted micro'));
  const unknown = (estimate.unknownIngredients || []).map(item => item.name).filter(Boolean);
  if (unknown.length) section.append(mealNode('p', 'Pris mangler: ' + unknown.join(', ') + '.', 'meal-warning'));
  if ((estimate.lines || []).length) {
    const details = mealNode('details', '', 'meal-details meal-price-sources');
    details.append(mealNode('summary', 'Se dokumenterede priser, pakninger og kilder'));
    const list = mealNode('ul');
    for (const line of estimate.lines) {
      const row = mealNode('li');
      row.append(mealNode('p', line.name + ': behov ' + line.quantity + ' ' + line.unit + ' · ' + line.packages +
        ' pakning(er) à ' + line.packageQuantity + ' ' + line.unit + ' til ' + money(line.unitPriceDkk) +
        ' · skøn ' + money(line.estimatedProductsDkk) + ' · pakkeoverskud ' + line.surplusQuantity + ' ' + line.unit + ' (ikke registreret lager).', 'small-text'));
      if (line.requiresProductReview) row.append(mealNode('p', 'Vareoplysninger og kosthensyn kræver din gennemgang.', 'meal-warning'));
      const source = line.source;
      if (source?.id && source.lineId) row.append(mealRecordSourceLink('shopping-draft:' + source.id + ':' + source.lineId,
        'Åbn kildelinjen til prisobservationen: vare ' + source.productId + ' · forslag version ' + source.revision + ' · ' + source.observedAt));
      list.append(row);
    }
    details.append(list); section.append(details);
  }
  section.append(mealNode('p', estimate.note || 'Ikke levering, pant, poser, hel kurv eller prisgaranti.', 'muted micro'));
  return section;
}

function mealLeftoversEditor(plan, onChange = () => {}) {
  const element = mealNode('details', '', 'meal-details meal-leftovers-editor');
  element.append(mealNode('summary', 'Planlæg rester mellem ugens dage'));
  element.append(mealNode('p',
    'Vælg en tidligere tilberedningsdag og hele måldagens portioner. Der planlægges ekstra ingredienser på kildedagen, ikke et nyt lager. Dette er ikke bevis på tilberedning, holdbarhed eller indtag. Ingen kæder af rester.', 'muted micro'));
  element.append(mealNode('p',
    'Din oprindelige ret på måldagen bevares som et lokalt øjebliksbillede og gendannes, hvis fordelingen fjernes og gemmes. Retter og portioner på de forbundne dage ændres først efter eksplicit fjernelse af fordelingen.', 'muted micro'));
  const stale = Boolean(plan.householdStale || plan.profileStale || plan.recipeStale);
  if (stale) element.append(mealNode('p', 'Grundlaget er ændret. Fjern de gemte fordelinger eksplicit, gennemgå planen, og opret derefter eventuelle nye fordelinger.', 'meal-warning'));
  const fields = mealNode('fieldset', '', 'meal-leftovers-fields meal-structured-group');
  fields.append(mealNode('legend', 'Restefordelinger'));
  const rows = mealNode('div', '', 'meal-structured-rows'), controls = [];
  const dates = (plan.dishes || []).map(dish => [dish.date, mealDayLabel(dish.date) + (dish.skip ? ' (sprunget over)' : '')]);
  const add = mealNode('button', 'Tilføj planlagte rester', 'secondary'); add.type = 'button';
  const choices = [['', 'Vælg dag'], ...dates];
  const updateAdd = () => { add.disabled = stale || controls.length >= 6 || dates.length < 2; };
  function appendRow(value = {}) {
    if (controls.length >= 6) return;
      const row = mealNode('div', '', 'meal-leftovers-row meal-rhythm-day-fields');
    const fromDate = mealSelect(choices, value.fromDate || ''), toDate = mealSelect(choices, value.toDate || '');
    const servings = mealInput(value.servings ?? '', 'number', { min: 0.001, max: 72, step: 'any' });
    const minutes = mealInput(value.minutes ?? '', 'number', { min: 1, max: 720, step: 1 });
    for (const [name, field] of Object.entries({ fromDate, toDate, servings, minutes })) {
      field.dataset.leftoverField = name; field.disabled = stale; field.addEventListener('input', onChange);
    }
    const remove = mealNode('button', 'Fjern fordeling', 'secondary'); remove.type = 'button';
    const entry = { row, fromDate, toDate, servings, minutes };
    remove.addEventListener('click', () => { if (remove.disabled) return; controls.splice(controls.indexOf(entry), 1); row.remove(); updateAdd(); onChange(); });
    row.append(mealField('Tilberedningsdag', fromDate), mealField('Dag med planlagte rester', toDate),
      mealField('Hele måldagens portioner', servings), mealField('Tid på måldagen (minutter, dit skøn)', minutes), remove);
    rows.append(row); controls.push(entry); updateAdd();
  }
  add.addEventListener('click', () => {
    if (add.disabled) return;
    const source = (plan.dishes || []).find(dish => !dish.skip);
    const target = (plan.dishes || []).find(dish => !dish.skip && dish.date > source?.date &&
      !controls.some(row => row.toDate.value === dish.date));
    appendRow({ fromDate: source?.date || '', toDate: target?.date || '', servings: target?.servings ?? '', minutes: '' });
    element.open = true; controls.at(-1)?.minutes.focus(); onChange();
  });
  function set(values = []) {
    rows.replaceChildren(); controls.length = 0;
    for (const row of values) appendRow(row);
    updateAdd();
  }
  fields.append(rows, add); element.append(fields); set(plan.plannedLeftovers || []);
  element.open = Boolean(plan.plannedLeftovers?.length);
  return { element, fields, count: () => controls.length,
    snapshot: () => ({ open: element.open, rows: controls.map(({ fromDate, toDate, servings, minutes }) =>
      ({ fromDate: fromDate.value, toDate: toDate.value, servings: servings.value, minutes: minutes.value })) }),
    restore(value = {}) { set(mealRawRows(value.rows, 6).map(row => ({ fromDate: mealRawText(row.fromDate, 10), toDate: mealRawText(row.toDate, 10),
      servings: mealRawText(row.servings, 20), minutes: mealRawText(row.minutes, 20) }))); element.open = value.open === true || controls.length > 0; },
    read() {
      return controls.map(({ fromDate, toDate, servings, minutes }) => {
        const count = Number(servings.value), time = Number(minutes.value);
        if (!fromDate.value || !toDate.value || fromDate.value >= toDate.value || !servings.value.trim() || !Number.isFinite(count) || count <= 0 || count > 72 ||
          !minutes.value.trim() || !Number.isInteger(time) || time < 1 || time > 720)
          throw new Error('Udfyld en tidligere kildedag, en senere måldag, positive portioner og dit eget tidsestimat på 1–720 minutter.');
        return { fromDate: fromDate.value, toDate: toDate.value, servings: count, minutes: time };
      });
    },
  };
}

function mealDishEditor(dish, markDirty) {
  const fieldset = document.createElement('fieldset'); fieldset.className = 'meal-day-editor';
  fieldset.dataset.mealDate = dish.date;
  fieldset.append(mealNode('legend', mealDayLabel(dish.date)));
  const household = dish.adults == null ? 'Antal voksne/børn er ikke bekræftet.'
    : mealPortionsText(dish.adults, dish.children, dish.adultPortion ?? 1, dish.guests);
  fieldset.append(mealNode('p', household, 'muted micro'));
  if (dish.manualServings) fieldset.append(mealNode('p', 'Portionsantallet nedenfor er dit manuelle valg; det kan afvige fra husstandsberegningen.', 'muted micro'));
  const main = mealNode('div', '', 'meal-dish-fields');
  const recipe = mealSelect(mealRecipeChoices(dish), String(dish.recipeId || ''));
  const servings = mealInput(dish.servings ?? 0, 'number', { min: 0, max: 72, step: 0.25 });
  const theme = mealSelect(mealThemes, dish.theme || 'everyday');
  const skip = mealCheck('Spring denne dag over', dish.skip);
  const locked = mealCheck('Lås denne ret ved nye forslag', Boolean(dish.locked));
  main.append(mealField('Ret', recipe), mealField('Portioner', servings), mealField('Tema', theme), skip.wrapper, locked.wrapper);
  fieldset.append(main);
  const details = document.createElement('details'); details.className = 'meal-details';
  details.append(mealNode('summary', 'Ret titel, tid og ingredienser'));
  const title = mealInput(dish.title || '', 'text', { maxlength: 160 });
  const minutes = mealInput(dish.minutes ?? '', 'number', { min: 1, max: 720 });
  const diet = mealSelect(mealDiets, dish.diet || 'omnivore');
  const changed = new Set();
  let previewBasis = dish.ingredients || [];
  let previewServings = Number(dish.servings) || 1;
  let previewValid = true;
  const ingredients = mealIngredientEditor(dish.ingredients || [], () => {
    changed.add('ingredients');
    try { previewBasis = ingredients.read(); previewServings = Number(servings.value) || 1; previewValid = true; }
    catch { previewValid = false; /* Incomplete input remains visible, including during portion changes. */ }
    markDirty();
  });
  details.append(mealField('Titel', title), mealField('Minutter', minutes), mealField('Rettens kosttype (kontrollér ved ændringer)', diet),
    mealStructuredGroup('Ingredienser til de viste portioner', ingredients));
  fieldset.append(details);
  const reasons = Array.isArray(dish.reasons) ? dish.reasons : [];
  if (reasons.length) fieldset.append(mealNode('p', reasons.join(' · '), 'muted micro'));
  if (dish.leftoverFromDate || dish.leftoverTargets?.length) {
    fieldset.append(mealNode('p', dish.leftoverNote || 'Denne dag indgår i planlagte rester.', 'muted small-text'),
      mealNode('p', 'Fjern den berørte restefordeling og gem, før ret, portioner eller ingredienser ændres. Låsevalget kan stadig ændres.', 'muted micro'));
    // A link binds both food snapshots. Changing a visible source's portion
    // field must not silently under- or over-allocate its planned target meal.
    for (const field of fieldset.querySelectorAll('input, select, textarea, button')) if (field !== locked.control) field.disabled = true;
  }
  function updateIngredientPreview() {
    const count = Number(servings.value);
    if (!previewValid || !servings.value || !Number.isFinite(count) || count <= 0) return;
    ingredients.setItems(previewBasis.map(item => ({
      ...item, quantity: Math.round(item.quantity * count / previewServings * 100) / 100,
    })));
  }
  for (const [name, field] of Object.entries({ title, minutes, diet })) field.addEventListener('input', () => { changed.add(name); markDirty(); });
  servings.addEventListener('input', updateIngredientPreview);
  for (const field of [servings, theme, skip.control, locked.control]) field.addEventListener('input', markDirty);
  recipe.addEventListener('change', () => {
    const selected = (mealData.recipes || []).find(item => String(item.id) === recipe.value);
    if (selected) {
      title.value = selected.title; minutes.value = selected.minutes; diet.value = selected.diet;
      previewBasis = selected.ingredients || [];
      previewServings = Number(selected.servings) || 1;
      previewValid = true;
      updateIngredientPreview();
      changed.clear();
    }
    markDirty();
  });
  return {
    element: fieldset,
    snapshot: () => ({ date: dish.date, recipeId: recipe.value, servings: servings.value, theme: theme.value,
      skip: skip.control.checked, locked: locked.control.checked, title: title.value, minutes: minutes.value, diet: diet.value,
      ingredients: ingredients.snapshot(), changed: [...changed], previewBasis, previewServings, previewValid, open: details.open }),
    restore(fields = {}) {
      recipe.value = mealRawText(fields.recipeId, 160); servings.value = mealRawText(fields.servings, 20);
      theme.value = mealRawText(fields.theme, 30); skip.control.checked = fields.skip === true; locked.control.checked = fields.locked === true;
      title.value = mealRawText(fields.title, 160); minutes.value = mealRawText(fields.minutes, 20); diet.value = mealRawText(fields.diet, 30);
      ingredients.restore(fields.ingredients); changed.clear();
      for (const name of Array.isArray(fields.changed) ? fields.changed : []) if (['title', 'minutes', 'diet', 'ingredients'].includes(name)) changed.add(name);
      previewBasis = mealRawRows(fields.previewBasis, 60); previewServings = Number(fields.previewServings) || 1; previewValid = fields.previewValid === true;
      details.open = fields.open === true || changed.size > 0;
    },
    collect() {
      const value = { date: dish.date, servings: Number(servings.value), theme: theme.value,
        skip: skip.control.checked, locked: locked.control.checked };
      // Existing owner-created meals have IDs such as custom:YYYY-MM-DD and
      // are not catalogue entries. Only submit a recipe ID when the owner
      // selects a different catalogue recipe; the server retains custom meals.
      if (recipe.value !== String(dish.recipeId || '')) value.recipeId = recipe.value || null;
      if (changed.has('title')) value.title = title.value;
      if (changed.has('minutes')) value.minutes = Number(minutes.value);
      if (changed.has('ingredients')) value.ingredients = ingredients.read();
      if (changed.has('ingredients') || changed.has('diet')) value.diet = diet.value;
      return value;
    },
  };
}

function showMealPlans(plans) {
  const source = new URL(window.location.href).searchParams.get('source');
  const selected = source?.startsWith('meal-plan:') ? (plans || []).find(plan => source.split(':')[1] === plan.id) : null;
  const visible = selected ? [selected, ...(plans || []).filter(plan => plan !== selected)].slice(0, 5) : (plans || []).slice(0, 5);
  mealSyncCards(mealEl('meal-plans'), visible, 'plan', (plan, key) => {
    const card = mealNode('article', '', 'meal-card meal-plan-card');
    const ready = plan.status === 'shopping_ready';
    card.append(mealNode('h3', plan.startDate + ' · ' + plan.days + ' dage'),
      mealNode('span', ready ? plan.shoppingNeedsReview ? 'Indkøbsliste kræver gennemgang' : 'Indkøbsliste klar' : 'Madplansforslag', 'meal-status'));
    card.append(mealNode('p', 'Version ' + (plan.revision || 1) + ' · ' + (ready
      ? 'Listen er beregnet fra den gemte plan. Retter du planen, skal listen laves igen.'
      : 'Ret forslaget, gem dine ændringer, og opret derefter indkøbslisten.'), 'muted small-text'));
    if (plan.calendarAware) card.append(mealNode('p', 'Kalenderen påvirker forslag til tilberedningstid — ikke hvem der er hjemme.', 'muted micro'));
    if (plan.householdStale || plan.profileStale || plan.recipeStale) card.append(mealNode('p',
      plan.staleReason || 'Grundlaget er ændret. Opdatér husstand eller gennemgå og gem planen igen før indkøb.', 'meal-warning'));
    let dishDirty = false; let listDirty = false; let leftoversDirty = false;
    const status = mealNode('p', '', 'muted micro'); status.dataset.editStatus = '';
    const actions = mealNode('div', '', 'meal-actions');
    let savePlan, buildList, findProducts, saveList, regenerate, swap, saveLeftovers;
    const resetShoppingChoices = [];
    const listFields = document.createElement('fieldset'); listFields.className = 'meal-list-editor';
    const shoppingEditor = mealIngredientEditor(plan.shoppingList || [], () => {
      listDirty = true; mealDirty.add(key);
      status.textContent = 'Listerettelser er ikke gemt. Gem eller genindlæs før du ændrer madplanen.';
      flags();
    }, { allowZero: true });
    function flags() {
      const basisStale = Boolean(plan.householdStale || plan.profileStale || plan.recipeStale);
      savePlan.disabled = (!dishDirty && !plan.profileStale && !plan.recipeStale) || listDirty || leftoversDirty || Boolean(plan.householdStale);
      buildList.disabled = dishDirty || listDirty || leftoversDirty || basisStale;
      findProducts.disabled = !ready || plan.shoppingNeedsReview || !(plan.shoppingList || []).length || dishDirty || listDirty || leftoversDirty;
      if (saveList) saveList.disabled = !(listDirty || plan.shoppingNeedsReview) || dishDirty || leftoversDirty;
      for (const button of resetShoppingChoices) button.disabled = dishDirty || listDirty || leftoversDirty;
      listFields.disabled = dishDirty || leftoversDirty;
      for (const editor of editors) editor.element.disabled = listDirty || leftoversDirty;
      if (regenerate) regenerate.disabled = dishDirty || listDirty || leftoversDirty || basisStale;
      if (swap) swap.disabled = dishDirty || listDirty || leftoversDirty || basisStale;
      if (saveLeftovers) saveLeftovers.disabled = !leftoversDirty || dishDirty || listDirty || basisStale && leftovers.count() > 0;
      leftovers.fields.disabled = dishDirty || listDirty;
    }
    function dirtyDishes() {
      dishDirty = true; mealDirty.add(key);
      status.textContent = 'Madplansændringer er ikke gemt. Indkøb venter, til du har gemt.';
      flags();
    }
    const editors = (plan.dishes || []).map(dish => mealDishEditor(dish, dirtyDishes));
    const leftovers = mealLeftoversEditor(plan, () => {
      leftoversDirty = true; mealDirty.add(key); status.textContent = 'Restefordelingen er ikke gemt. Gennemgå dage, portioner og tid, og gem før andre planændringer.'; flags();
    });
    const dayGrid = mealNode('div', '', 'meal-dishes');
    dayGrid.append(...editors.map(editor => editor.element)); card.append(dayGrid);
    for (const [index, dish] of (plan.dishes || []).entries()) if (dish.leftoverFromDate) editors[index].element.append(
      mealRecordSourceLink('meal-plan:' + plan.id + ':' + dish.leftoverFromDate, 'Åbn den præcise tilberedningsdag ' + dish.leftoverFromDate));
    savePlan = mealAction('Gem ændringer i madplanen', async () => {
      await mealApi('/api/meals/plans/' + plan.id, 'PUT', { expectedRevision: plan.revision || 1, dishes: editors.map(editor => editor.collect()) });
      mealClearDraft(key); await refreshMeals(); toast('Madplanen er gemt. Indkøbslisten skal beregnes fra den nye version.');
    }, status, true);
    buildList = mealAction(ready ? 'Genberegn indkøbsliste' : 'Opret indkøbsliste', async () => {
      await mealApi('/api/meals/plans/' + plan.id + '/shopping-list', 'POST', { expectedRevision: plan.revision || 1 });
      await refreshMeals(); toast('Indkøbslisten er oprettet. Nemlig-kurven er ikke ændret.');
    }, status);
    regenerate = mealAction('Foreslå nye retter til ulåste dage', async () => {
      if (mealDirty.has(key)) throw new Error('Gem eller kassér dine lokale ændringer før nye retter foreslås.');
      await mealApi('/api/meals/plans/' + plan.id + '/regenerate', 'POST', { expectedRevision: plan.revision || 1 });
      await refreshMeals(); toast('Ulåste forslag er opdateret. Låste og manuelt valgte retter, restefordelinger og manuelle ekstravarer er bevaret.');
    }, status);
    findProducts = mealAction('Find varer på Nemlig', async () => {
      status.textContent = 'Finder konkrete varer og pakningsantal. Din Nemlig-kurv ændres ikke …';
      await mealApi('/api/meals/plans/' + plan.id + '/nemlig-draft', 'POST', { expectedRevision: plan.revision || 1 });
      await refreshShoppingDrafts();
      status.textContent = 'Indkøbsforslaget er klar til din gennemgang længere nede.';
      mealEl('meal-shopping-drafts').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, status);
    actions.append(savePlan, buildList, regenerate);
    const swapDetails = mealNode('details', '', 'meal-details meal-swap');
    swapDetails.append(mealNode('summary', 'Flyt eller byt to retter'));
    const choices = (plan.dishes || []).map(dish => [dish.date, mealDayLabel(dish.date) + (dish.locked ? ' (låst)' : '')]);
    const firstSwap = mealSelect(choices, choices[0]?.[0]);
    const secondSwap = mealSelect(choices, choices[1]?.[0] || choices[0]?.[0]);
    swap = mealAction('Byt retter mellem dagene', async () => {
      if (mealDirty.has(key)) throw new Error('Gem eller kassér lokale ændringer før retter flyttes.');
      await mealApi('/api/meals/plans/' + plan.id + '/swap', 'POST', {
        expectedRevision: plan.revision || 1, firstDate: firstSwap.value, secondDate: secondSwap.value });
      await refreshMeals(); toast('Retterne er byttet. Portioner følger stadig den enkelte dag.');
    }, status);
    swapDetails.append(mealField('Fra dag', firstSwap), mealField('Til dag', secondSwap), swap);
    if (plan.householdStale) actions.append(mealAction('Opdatér husstand og grundlag', async () => {
      if (mealDirty.has(key)) throw new Error('Gem eller genindlæs dine lokale ændringer først.');
      await mealApi('/api/meals/plans/' + plan.id, 'PUT', { expectedRevision: plan.revision || 1, refreshHousehold: true });
      await refreshMeals();
    }, status));
    actions.append(mealAction('Genindlæs / kassér lokale rettelser', async () => {
      mealClearDraft(key); await refreshMeals();
    }, status));
    saveLeftovers = mealAction('Gem planlagte rester', async () => {
      const generation = mealSessionGeneration;
      await mealApi('/api/meals/plans/' + plan.id + '/leftovers', 'POST', { expectedRevision: plan.revision || 1, links: leftovers.read() });
      if (!mealSessionCurrent(generation)) return;
      mealClearDraft(key); saveLeftovers.dataset.keepDisabled = 'true'; saveLeftovers.disabled = true;
      status.textContent = 'Restefordelingen er gemt. Indkøbslisten skal beregnes fra den nye version.';
      try { await refreshMeals(); if (mealSessionCurrent(generation)) toast('Restefordelingen er gemt. Ingen tilberedning, forbrug, lager eller Nemlig-kurv er registreret.'); }
      catch (error) { if (mealSessionCurrent(generation)) status.textContent = 'Restefordelingen er gemt, men visningen kunne ikke opdateres: ' + error.message + ' Hent den aktuelle plan før næste ændring.'; }
    }, status, true);
    leftovers.element.append(saveLeftovers);
    card.append(actions, swapDetails, leftovers.element, mealPriceSummary(plan));
    if (ready) {
      const list = mealNode('ul', '', 'meal-shopping-list');
      for (const item of plan.shoppingList || []) list.append(mealNode('li', item.name + ' · ' + item.quantity + ' ' + item.unit));
      card.append(mealNode('h4', 'Indkøbsliste — oplyst lager er fratrukket'));
      if (!(plan.shoppingList || []).length) card.append(mealNode('p', plan.shoppingReview?.rows?.some(row => row.excluded)
        ? 'Ingen valgte varer. Du har udeladt varer; det er ikke dokumentation for, at ingredienserne er på lager.'
        : 'Ingen manglende ingredienser i den beregnede liste.', 'muted'));
      card.append(list);
      const review = mealNode('section', '', 'meal-shopping-review');
      review.append(mealNode('h4', 'Beregnet behov og dine listevalg'));
      if (plan.shoppingNeedsReview) review.append(mealNode('p', 'Grundlaget for gemte valg er ændret eller ukendt. Gennemgå mængderne nedenfor, ret listen eller gem de viste valg igen. Varesøgning venter på gennemgangen.', 'meal-warning'));
      for (const row of plan.shoppingReview?.rows || []) {
        const choice = mealNode('div', '', 'meal-shopping-choice'); choice.dataset.shoppingChoice = row.name + '|' + row.unit;
        choice.append(mealNode('p', row.name + ' · dit valg: ' + row.selectedQuantity + ' ' + row.unit +
          ' · beregnet at tilføje: ' + row.computedQuantity + ' ' + row.unit, 'small-text'),
        mealNode('p', 'Planens ingrediensbehov: ' + row.requiredQuantity + ' ' + row.unit + ' · bekræftet lager anvendt: ' + row.pantryUsed + ' ' + row.unit +
          (row.excluded ? ' · eksplicit udeladt' : '') + (row.removedFromPlan ? ' · ikke længere et opskriftsbehov' : ''), 'muted micro'),
        mealNode('p', row.reason || 'Dit manuelle valg er bevaret.', row.needsReview ? 'meal-warning' : 'muted micro'));
        if (row.source) choice.append(mealNode('p', 'Listevalg registreret ved planrevision ' + (row.source.revision ?? 'ukendt') +
          (row.source.at ? ' · ' + row.source.at : ' · tidspunkt ukendt') + '. Oprindeligt beregnet behov: ' +
          (row.previousBasis ? row.previousBasis.quantity + ' ' + row.unit : 'ukendt') + '.', 'muted micro'));
        for (const basis of row.currentBasis?.sources || []) if (basis.date) choice.append(
          mealRecordSourceLink('meal-plan:' + plan.id + ':' + basis.date, 'Åbn behovets måltid den ' + basis.date));
        const reset = mealAction('Brug beregnet mængde for ' + row.name + ' (' + row.unit + ')', async () => {
          if (mealDirty.has(key)) throw new Error('Gem eller kassér lokale rettelser, før et gemt listevalg nulstilles.');
          await publishShoppingList(plan.shoppingList || [], [{ name: row.name, unit: row.unit }], reset);
        }, status);
        reset.dataset.shoppingReset = row.name + '|' + row.unit;
        resetShoppingChoices.push(reset); choice.append(reset); review.append(choice);
      }
      if (!(plan.shoppingReview?.rows || []).length) review.append(mealNode('p', 'Der er ingen gemte manuelle mængdevalg. Uændrede beregnede varer tilpasses ved næste genberegning.', 'muted micro'));
      review.append(mealNode('p', 'Nul eller Fjern gemmer en eksplicit udeladelse. Manuelle mængder bevares ved genberegning; køb, forbrug og lager registreres ikke.', 'muted micro'));
      card.append(review);
      const edit = document.createElement('details'); edit.className = 'meal-details';
      edit.open = Boolean(plan.shoppingNeedsReview);
      edit.append(mealNode('summary', 'Ret selve indkøbslisten'));
      listFields.append(mealStructuredGroup('Varer og antal', shoppingEditor));
      async function publishShoppingList(items, useComputed, initiator) {
        const generation = mealSessionGeneration;
        await mealApi('/api/meals/plans/' + plan.id + '/shopping-list', 'PUT', {
          expectedRevision: plan.revision || 1, items, ...(useComputed.length ? { useComputed } : {}) });
        if (!mealSessionCurrent(generation)) return;
        mealClearDraft(key); initiator.dataset.keepDisabled = 'true'; initiator.disabled = true;
        status.textContent = 'Listen og din gennemgang er gemt. Ingen Nemlig-kurv er ændret.';
        try { await refreshMeals(); if (mealSessionCurrent(generation)) toast('Listevalgene er gemt. Tidligere vare- og kurvforslag skal laves igen.'); }
        catch (error) { if (mealSessionCurrent(generation)) status.textContent = 'Listen er gemt, men visningen kunne ikke opdateres: ' + error.message + ' Genindlæs den aktuelle plan før næste ændring.'; }
      }
      saveList = mealAction('Gem rettelser til listen', async () => {
        await publishShoppingList(shoppingEditor.read(), [], saveList);
      }, status);
      listFields.append(saveList); edit.append(listFields); card.append(edit, findProducts);
    }
    card.append(mealNode('p', 'Budgetmål: ' + (plan.budgetTargetDkk ?? 'ikke fastsat') + ' kr. · Ikke en prisgaranti.', 'muted micro'), status);
    mealRegisterDraft(key, plan, () => ({ dishes: editors.map(editor => editor.snapshot()),
      shoppingList: shoppingEditor.snapshot(), leftovers: leftovers.snapshot(), dishDirty, listDirty, leftoversDirty }), fields => {
      const byDate = new Map(mealRawRows(fields.dishes, 7).map(dish => [dish.date, dish]));
      for (const [index, dish] of (plan.dishes || []).entries()) if (byDate.has(dish.date)) editors[index].restore(byDate.get(dish.date));
      shoppingEditor.restore(fields.shoppingList); dishDirty = fields.dishDirty === true; listDirty = fields.listDirty === true;
      if (fields.leftovers) leftovers.restore(fields.leftovers);
      leftoversDirty = fields.leftoversDirty === true;
      for (const details of card.querySelectorAll('details')) if (listDirty && details.contains(shoppingEditor.element)) details.open = true;
    }, status);
    flags(); return card;
  }, 'Ingen madplan endnu. Vælg periode, og bed om et forslag.');
}

function mealSourceLink(url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return mealNode('span', label);
    const link = mealNode('a', label || parsed.hostname);
    link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
  } catch { return mealNode('span', label || 'Ukendt kilde'); }
}

async function refreshRecipes() {
  const generation = mealSessionGeneration;
  const data = await mealApi('/api/recipes');
  if (!mealSessionCurrent(generation)) return;
  showRecipes(data.recipes || []);
}

function showRecipes(recipes) {
  const activeRecipes = recipes.filter(recipe => recipe.status !== 'archived');
  const source = new URL(window.location.href).searchParams.get('source');
  const selected = source?.startsWith('recipe:') ? activeRecipes.find(recipe => `recipe:${recipe.id}` === source) : null;
  // The normal overview is bounded, but a precise source link must still open
  // an older returned record rather than silently showing the first recipe.
  const visibleRecipes = selected ? [selected, ...activeRecipes.filter(recipe => recipe !== selected)].slice(0, 30)
    : activeRecipes.slice(0, 30);
  mealSyncCards(mealEl('meal-recipes'), visibleRecipes, 'recipe', (recipe, key) => {
    const card = mealNode('article', '', 'meal-card');
    const recipeState = { received: 'Modtaget', processing: 'Behandles', review_required: 'Kræver gennemgang',
      ready: 'Klar til brug', error: 'Behandling fejlede' };
    card.append(mealNode('h3', recipe.title || 'Ny opskrift'), mealNode('span',
      recipeState[recipe.processingStatus] || (recipe.status === 'confirmed' ? 'Godkendt til madplaner' : 'Indbakke · gennemgå opskriften'), 'meal-status'));
    const source = recipe.source || {};
    card.append(mealNode('p', 'Kilde: ' + (source.channel || 'ukendt') + ' · ' + String(recipe.createdAt || '').slice(0, 10), 'muted micro'));
    for (const message of recipe.extraction?.messages || []) card.append(mealNode('p', message, 'muted micro'));
    for (const link of recipe.links || []) {
      const row = mealNode('p', '', 'muted micro');
      row.append(mealSourceLink(link.url, 'Åbn opskriftskilde'), mealNode('span', ' · ' + ({ extracted: 'indhold fundet', bookmark: 'gemt link', blocked: 'ikke hentet', unavailable: 'indhold utilgængeligt' }[link.status] || 'gemt')));
      card.append(row);
    }
    const status = mealNode('p', '', 'muted micro'); status.dataset.editStatus = '';
    for (const media of recipe.media || []) {
      card.append(mealAction('Vis gemt billede: ' + (media.filename || 'opskrift'), async () => {
        const existing = [...card.querySelectorAll('img[data-media-id]')].find(image => image.dataset.mediaId === media.id);
        if (existing) { existing.hidden = !existing.hidden; return; }
        const data = await mealApi('/api/recipes/' + recipe.id + '/media/' + media.id);
        if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(data.dataUrl || '')) throw new Error('Billedformatet kunne ikke vises sikkert.');
        const image = document.createElement('img'); image.src = data.dataUrl;
        image.alt = 'Gemt opskriftsbillede: ' + (media.filename || recipe.title || '');
        image.className = 'meal-recipe-image'; image.dataset.mediaId = media.id; card.append(image);
      }, status));
    }
    const details = document.createElement('details'); details.className = 'meal-details'; details.open = recipe.status !== 'confirmed';
    details.append(mealNode('summary', recipe.status === 'confirmed' ? 'Se og ret opskriften' : 'Gennemgå oplysninger'));
    const title = mealInput(recipe.title || '', 'text', { maxlength: 120 });
    const diet = mealSelect([['unknown', 'Ikke afklaret'], ...mealDiets], recipe.diet || 'unknown');
    const minutes = mealInput(recipe.minutes ?? '', 'number', { min: 1, max: 720 });
    const servings = mealInput(recipe.servings ?? '', 'number', { min: 0.25, max: 50, step: 0.25 });
    const markDirty = () => { mealDirty.add(key); status.textContent = 'Opskriftsrettelser er ikke gemt.'; };
    const ingredients = mealIngredientEditor(recipe.ingredients || [], markDirty, { maxRows: 50, maxName: 80, maxQuantity: 100000 });
    const instructions = mealTextArea(recipe.instructions || '', 5);
    const favorite = mealCheck('Favorit – prioriter i madplaner', Boolean(recipe.feedback?.favorite));
    const doNotSuggest = mealCheck('Foreslå ikke automatisk igen', Boolean(recipe.feedback?.doNotSuggest));
    details.append(mealField('Titel', title), mealField('Kosttype — skal være kontrolleret', diet),
      mealField('Tilberedningstid i minutter', minutes), mealField('Opskriftens portioner', servings),
      mealStructuredGroup('Ingredienser og mængder', ingredients), mealField('Tilberedningstrin', instructions),
      favorite.wrapper, doNotSuggest.wrapper);
    const themes = mealNode('fieldset', '', 'meal-theme-options'); themes.append(mealNode('legend', 'Passer til disse temaer'));
    const themeInputs = mealThemes.map(([value, label]) => {
      const check = mealCheck(label, (recipe.themes || []).includes(value)); check.control.value = value; themes.append(check.wrapper); return check.control;
    });
    details.append(themes);
    if ((recipe.ingredientLines || []).length || recipe.text || recipe.instructions) {
      const original = document.createElement('details'); original.className = 'meal-details';
      original.append(mealNode('summary', 'Se gemt kildetekst'));
      if (recipe.text) original.append(mealNode('p', recipe.text, 'meal-original-text'));
      for (const line of recipe.ingredientLines || []) original.append(mealNode('p', line, 'muted small-text'));
      if (recipe.instructions) original.append(mealNode('p', Array.isArray(recipe.instructions) ? recipe.instructions.join('\n') : recipe.instructions, 'meal-original-text'));
      details.append(original);
    }
    const collect = confirmed => ({ expectedRevision: recipe.revision || 1, title: title.value, diet: diet.value,
      minutes: minutes.value === '' ? null : Number(minutes.value), servings: servings.value === '' ? null : Number(servings.value),
      themes: themeInputs.filter(input => input.checked).map(input => input.value), ingredients: ingredients.read(),
      instructions: instructions.value, favorite: favorite.control.checked, doNotSuggest: doNotSuggest.control.checked, confirmed });
    const actions = mealNode('div', '', 'meal-actions');
    if (!recipe.confirmed && ['error', 'received', 'processing'].includes(recipe.processingStatus)) {
      actions.append(mealAction('Genoptag udtræk', async () => {
        if (mealDirty.has(key)) throw new Error('Dine lokale rettelser er bevaret. Gem eller kassér dem, før du genoptager udtrækket af den gemte kilde.');
        await mealApi('/api/recipes/' + recipe.id + '/resume', 'POST', { expectedRevision: recipe.revision || 1 });
        await refreshRecipes(); toast('Udtrækket er genoptaget fra den gemte kilde. Resultatet skal stadig gennemgås af dig.');
      }, status));
    }
    actions.append(mealAction('Gem som udkast', async () => {
      await mealApi('/api/recipes/' + recipe.id, 'PUT', collect(false));
      mealClearDraft(key); await refreshMeals(); toast('Opskriften er gemt som udkast, ikke som bekræftet opskrift.');
    }, status));
    actions.append(mealAction('Godkend opskrift til madplaner', async () => {
      await mealApi('/api/recipes/' + recipe.id, 'PUT', collect(true));
      mealClearDraft(key); await refreshMeals(); toast('Opskriften kan nu bruges som inspiration i madplaner.');
    }, status, true));
    actions.append(mealAction('Arkivér opskrift', async () => {
      await mealApi('/api/recipes/' + recipe.id + '/archive', 'POST', { expectedRevision: recipe.revision || 1 });
      mealClearDraft(key); await refreshMeals();
    }, status));
    actions.append(mealAction('Genindlæs / kassér lokale rettelser', async () => {
      mealClearDraft(key); await refreshRecipes();
    }, status));
    if (recipe.status === 'confirmed' && recipe.instructions) actions.append(mealAction('Vis bekræftede tilberedningstrin', async () => {
      const data = await mealApi('/api/recipes/' + recipe.id + '/instructions');
      const verified = data.instructions;
      const steps = typeof verified === 'string' ? verified : verified?.instructions;
      if (typeof steps !== 'string') throw new Error('Opskriftens tilberedningstrin kunne ikke indlæses.');
      const text = mealNode('p', steps, 'meal-original-text');
      const previous = card.querySelector('[data-recipe-steps]');
      if (previous) previous.replaceWith(text); else details.append(text);
      text.dataset.recipeSteps = '';
    }, status));
    for (const field of [title, diet, minutes, servings, instructions, favorite.control, doNotSuggest.control, ...themeInputs]) field.addEventListener('input', () => {
      mealDirty.add(key); status.textContent = 'Rettelserne er ikke gemt endnu. Kosttype og mængder skal gennemgås af dig.';
    });
    details.append(actions); card.append(details, status);
    mealRegisterDraft(key, recipe, () => ({ title: title.value, diet: diet.value, minutes: minutes.value, servings: servings.value,
      ingredients: ingredients.snapshot(), instructions: instructions.value, favorite: favorite.control.checked,
      doNotSuggest: doNotSuggest.control.checked, themes: themeInputs.filter(field => field.checked).map(field => field.value) }), fields => {
      title.value = mealRawText(fields.title, 120); diet.value = mealRawText(fields.diet, 30);
      minutes.value = mealRawText(fields.minutes, 20); servings.value = mealRawText(fields.servings, 20);
      ingredients.restore(fields.ingredients); instructions.value = mealRawText(fields.instructions);
      favorite.control.checked = fields.favorite === true; doNotSuggest.control.checked = fields.doNotSuggest === true;
      for (const field of themeInputs) field.checked = Array.isArray(fields.themes) && fields.themes.includes(field.value);
      details.open = true;
    }, status);
    return card;
  }, 'Opskriftsindbakken er tom. Gem en opskrift her eller send den via Discord.');
}

async function refreshShoppingDrafts() {
  const generation = mealSessionGeneration;
  const { drafts = [] } = await mealApi('/api/shopping-drafts');
  if (!mealSessionCurrent(generation)) return;
  const source = new URL(window.location.href).searchParams.get('source');
  const selected = source?.startsWith('shopping-draft:') ? drafts.find(draft => source.split(':')[1] === draft.id) : null;
  const visible = selected ? [selected, ...drafts.filter(draft => draft !== selected)].slice(0, 8) : drafts.slice(0, 8);
  mealSyncCards(mealEl('meal-shopping-drafts'), visible, 'shopping-draft', (draft, key) => {
    const card = mealNode('article', '', 'meal-card');
    const editable = draft.status === 'draft';
    card.append(mealNode('h4', 'Vareforslag fra madplanen'), mealNode('span', editable ? 'Gennemgå produkt og antal' : ({ proposed: 'Kurvforslag oprettet', invalidated: 'Grundlaget er ændret', stale: 'Grundlaget er ændret' }[draft.status] || draft.status), 'meal-status'));
    card.append(mealNode('p', 'Planversion ' + draft.planRevision + ' · Ingen overførsel til Nemlig endnu. Pakningsantal og erstatningsvarer skal kontrolleres.', 'muted micro'));
    card.append(mealNode('p', draft.estimatedProductsDkk == null ? 'Prisoverslag: endnu ikke afklaret for alle varer.'
      : 'Anslået pris for ekstra varer: ' + Number(draft.estimatedProductsDkk).toLocaleString('da-DK', { style: 'currency', currency: 'DKK' })
      + (draft.overBudget ? ' · over dit budgetmål' : ''), draft.overBudget ? 'meal-warning' : 'muted small-text'));
    if (draft.priceNote) card.append(mealNode('p', draft.priceNote, 'muted micro'));
    for (const warning of draft.warnings || []) card.append(mealNode('p', warning, 'meal-warning'));
    const status = mealNode('p', '', 'muted micro'); status.dataset.editStatus = '';
    let changed = false;
    let saveButton, proposeButton;
    const fields = (draft.items || []).map(item => {
      const row = mealNode('div', '', 'meal-shopping-match');
      row.dataset.shoppingLineId = item.lineId;
      row.append(mealNode('strong', item.ingredient + ' · ' + item.neededQuantity + ' ' + item.unit));
      const options = [['', 'Ingen vare valgt']];
      for (const candidate of item.candidates || []) options.push([String(candidate.Id), String(candidate.Name || candidate.Id)
        + (candidate.Unit ? ' · ' + mealProductText(candidate.Unit) : '')
        + (candidate.Price != null ? ' · oplyst pris: ' + mealProductText(candidate.Price) : '')]);
      const product = mealSelect(options, String(item.productId || ''));
      const quantity = mealInput(item.quantity ?? 0, 'number', { min: 0, max: 30, step: 1 });
      product.disabled = !editable; quantity.disabled = !editable;
      row.append(mealField('Vare fra Nemlig', product), mealField('Pakninger der skal tilføjes (0 = udelad)', quantity));
      const details = document.createElement('details'); details.className = 'meal-details meal-product-details';
      details.append(mealNode('summary', 'Se pakning og oplysninger fra Nemlig'));
      const evidence = mealNode('div'); details.append(evidence);
      function showProductEvidence() {
        evidence.replaceChildren();
        const selected = (item.candidates || []).find(candidate => String(candidate.Id) === product.value);
        if (!selected) return evidence.append(mealNode('p', 'Vælg en vare for at se tilgængelige oplysninger.', 'muted micro'));
        const observation = item.productObservations?.[String(selected.Id)];
        evidence.append(mealNode('p', observation?.observedAt
          ? 'Denne vares oplysninger blev observeret: ' + observation.observedAt + '. Et andet produkts opdatering fornyer ikke denne observation.'
          : 'Der er ingen separat tidsstemplet prisobservation for denne vare. En gammel kladde er ikke bevis på en aktuel pris.', 'muted micro'));
        for (const [property, label] of [['Brand', 'Mærke'], ['Unit', 'Pakning'], ['Ingredients', 'Ingredienser'], ['Allergens', 'Allergener'], ['Description', 'Beskrivelse']]) {
          const value = mealProductText(selected[property]);
          if (value) evidence.append(mealNode('p', label + ': ' + value, 'muted micro'));
        }
        if (!selected.Ingredients || !selected.Allergens) evidence.append(mealNode('p',
          'Ingrediens- eller allergenoplysninger mangler i de viste data. Fravær af oplysninger er ikke en sikkerhedsgaranti; kontrollér varens mærkning hos Nemlig.', 'meal-warning'));
      }
      showProductEvidence(); product.addEventListener('change', showProductEvidence); row.append(details);
      const recorded = (item.candidates || []).filter(candidate => item.productObservations?.[String(candidate.Id)]).slice(0, 10);
      if (recorded.length) {
        const observations = mealNode('details', '', 'meal-details meal-product-details meal-product-observations');
        observations.append(mealNode('summary', 'Se gemte prisobservationer for denne kildelinje'),
          mealNode('p', 'Læsning af disse observationer ændrer ikke dit valgte produkt. En observation er ikke en garanti for den aktuelle pris eller tilgængelighed.', 'muted micro'));
        for (const candidate of recorded) {
          const observation = item.productObservations[String(candidate.Id)];
          const price = candidate.Price ?? candidate.ItemPrice;
          observations.append(mealNode('p', 'Vare ' + candidate.Id + ' · ' + (candidate.Name || 'Ukendt navn') +
            ' · ' + mealProductText(candidate.Unit || 'Ukendt pakning') + ' · oplyst pris ' +
            (typeof price === 'number' && Number.isFinite(price) ? price.toLocaleString('da-DK', { style: 'currency', currency: 'DKK' }) : 'ukendt') +
            ' · observeret ' + observation.observedAt + ' · ' + (!observation.availabilityKnown ? 'tilgængelighed ukendt'
              : observation.available ? 'var tilgængelig' : 'var ikke tilgængelig'), 'muted micro'));
        }
        row.append(observations);
      }
      if (item.reason) row.append(mealNode('p', item.reason, 'muted micro'));
      if (item.needsReview) row.append(mealNode('p', 'Gennemgå match, pakningsstørrelse, kostønsker og antal. Gem varevalgene for at bekræfte din gennemgang.', 'meal-warning'));
      for (const field of [product, quantity]) field.addEventListener('input', () => {
        changed = true; mealDirty.add(key); saveButton.disabled = false; proposeButton.disabled = true;
        status.textContent = 'Gem dine varevalg, før du opretter det endelige kurvforslag.';
      });
      card.append(row);
      return { lineId: item.lineId, product, quantity, showProductEvidence };
    });
    if (editable) {
      const actions = mealNode('div', '', 'meal-actions');
      saveButton = mealAction('Gem varevalg og antal', async () => {
        await mealApi('/api/shopping-drafts/' + draft.id, 'PUT', { expectedRevision: draft.revision || 1,
          items: fields.map(field => ({ lineId: field.lineId, productId: field.product.value || null, quantity: Number(field.quantity.value) })) });
        mealClearDraft(key); await refreshShoppingDrafts();
      }, status);
      saveButton.disabled = !changed && !(draft.items || []).some(item => item.needsReview);
      proposeButton = mealAction('Gennemgået — opret kurvforslag', async () => {
        await mealApi('/api/shopping-drafts/' + draft.id + '/propose', 'POST', { expectedRevision: draft.revision || 1 });
        await Promise.all([refreshShoppingDrafts(), refreshNemlig()]);
        toast('Kurvforslaget er klar. Først Overfør til Nemlig ændrer den rigtige kurv.');
        mealEl('meal-nemlig-proposals').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, status, true);
      const requiresReview = (draft.items || []).some(item => item.needsReview);
      const hasSelectedItems = (draft.items || []).some(item => item.productId && item.quantity > 0);
      proposeButton.disabled = requiresReview || !hasSelectedItems;
      if (requiresReview) status.textContent = 'Gennemgå vareoplysningerne, og vælg Gem varevalg og antal, før du fortsætter.';
      else if (!hasSelectedItems) status.textContent = 'Der er ingen ekstra varer valgt. Ret og gem varevalgene, hvis du vil fortsætte.';
      actions.append(saveButton, proposeButton, mealAction('Genindlæs / kassér lokale rettelser', async () => {
        mealClearDraft(key); await refreshShoppingDrafts();
      }, status));
      card.append(actions);
    }
    card.append(status);
    mealRegisterDraft(key, draft, () => ({ items: fields.map(field => ({ lineId: field.lineId, productId: field.product.value, quantity: field.quantity.value })) }), saved => {
      const byId = new Map(mealRawRows(saved.items, 60).map(item => [item.lineId, item]));
      for (const field of fields) if (byId.has(field.lineId)) {
        field.product.value = mealRawText(byId.get(field.lineId).productId, 30);
        field.quantity.value = mealRawText(byId.get(field.lineId).quantity, 20); field.showProductEvidence();
      }
      changed = true;
      if (saveButton) saveButton.disabled = !editable;
      if (proposeButton) proposeButton.disabled = true;
    }, status);
    return card;
  }, 'Ingen indkøbsforslag endnu. Opret en indkøbsliste fra en gennemgået madplan først.');
}

function showNemligSelection() {
  const root = mealEl('meal-nemlig-selection'); root.replaceChildren();
  if (!mealSelection.size) return root.append(mealNode('p', 'Ingen varer valgt.', 'muted micro'));
  root.append(mealNode('h4', 'Valgte varer — endnu ikke sendt til kurven'));
  for (const item of mealSelection.values()) {
    const row = mealNode('div', '', 'meal-product');
    const quantity = mealInput(item.quantity, 'number', { min: 1, max: 30, step: 1, 'aria-label': 'Antal ' + item.name });
    quantity.addEventListener('change', () => {
      const value = Number(quantity.value);
      if (!Number.isInteger(value) || value < 1 || value > 30) { quantity.value = item.quantity; return toast('Vælg 1–30 pakninger.'); }
      item.quantity = value;
    });
    row.append(mealNode('span', item.name), quantity, mealAction('Fjern', async () => { mealSelection.delete(item.productId); showNemligSelection(); }));
    root.append(row);
  }
}

function showNemligProducts(products) {
  const root = mealEl('meal-nemlig-results'); root.replaceChildren();
  if (!products.length) return root.append(mealNode('p', 'Ingen produkter fundet.', 'muted'));
  for (const product of products) {
    const id = String(product.Id || '');
    const row = mealNode('div', '', 'meal-product');
    row.append(mealNode('span', (product.Name || 'Produkt') + (product.Brand ? ' · ' + product.Brand : '')
      + (product.Price != null ? ' · oplyst pris: ' + product.Price : '')));
    if (/^\d{1,18}$/.test(id)) {
      const quantity = mealInput(1, 'number', { min: 1, max: 30, step: 1, 'aria-label': 'Antal ' + (product.Name || id) });
      row.append(quantity, mealAction('Vælg', async () => {
        const amount = Number(quantity.value);
        if (!Number.isInteger(amount) || amount < 1 || amount > 30) throw new Error('Vælg 1–30 af varen.');
        const existing = mealSelection.get(id)?.quantity || 0;
        if (existing + amount > 30) throw new Error('Højst 30 stk. pr. vare i et forslag.');
        mealSelection.set(id, { productId: id, name: String(product.Name || id).slice(0, 120), quantity: existing + amount });
        showNemligSelection();
      }));
    }
    root.append(row);
  }
}

function showBasket(basket) {
  const root = mealEl('meal-nemlig-basket'); root.replaceChildren();
  root.append(mealNode('h4', 'Kurv — nuværende status'));
  if (!basket.Lines.length) root.append(mealNode('p', 'Kurven er tom.', 'muted'));
  for (const line of basket.Lines) root.append(mealNode('p', (line.Name || line.Id) + ': ' + line.Quantity + ' stk.', 'muted small-text'));
  if (basket.TotalPrice != null) root.append(mealNode('p', 'Nemlig oplyser samlet beløb: ' + basket.TotalPrice, 'muted small-text'));
}

function showNemligProposals(proposals) {
  const labels = { pending: 'Afventer dit klik', applying: 'Behandles', completed: 'Udført', partial: 'Delvist udført',
    declined: 'Afvist', unknown: 'Uvis status — kontroller Nemlig', invalidated: 'Ugyldigt efter ændring', superseded: 'Erstattet af nyt forslag' };
  mealSyncCards(mealEl('meal-nemlig-proposals'), proposals.slice(0, 10), 'nemlig-proposal', (proposal, key) => {
    const card = mealNode('article', '', 'meal-card');
    card.append(mealNode('h4', labels[proposal.status] || proposal.status));
    for (const item of proposal.additions || []) card.append(mealNode('p', (item.name || item.productId)
      + ': ' + item.previous + ' → ' + item.target + ' (+' + item.add + ')', 'small-text'));
    const status = mealNode('p', '', 'muted micro'); status.dataset.editStatus = '';
    if (proposal.status === 'pending') {
      const expired = !Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= Date.now();
      card.append(mealNode('p', expired ? 'Forslaget er udløbet. Opret et nyt, så kurven kontrolleres igen.'
        : 'Udløber ' + new Date(proposal.expiresAt).toLocaleString('da-DK') + '. Klikket godkender kun de viste tilføjelser. Eksisterende varer fjernes ikke.', 'muted micro'));
      const details = document.createElement('details'); details.className = 'meal-details';
      details.append(mealNode('summary', 'Ret antal eller fjern varer fra forslaget'));
      let dirty = false;
      let approve, save;
      const fields = (proposal.additions || []).map(item => {
        const input = mealInput(item.add, 'number', { min: 0, max: 30, step: 1 });
        details.append(mealField((item.name || item.productId) + ' — tilføj (0 = udelad)', input));
        input.addEventListener('input', () => {
          dirty = true; mealDirty.add(key); approve.disabled = true; save.disabled = expired;
          status.textContent = 'Gem rettelserne, og gennemgå de nye mængder før overførsel.';
        });
        return { input, productId: item.productId };
      });
      save = mealAction('Gem rettet kurvforslag', async () => {
        const items = fields.map(field => ({ productId: field.productId, quantity: Number(field.input.value) })).filter(item => item.quantity !== 0);
        if (!items.length) throw new Error('Brug Afvis, hvis du vil fjerne hele forslaget.');
        await mealApi('/api/nemlig/proposals/' + proposal.id, 'PUT', { expectedRevision: proposal.revision || 1, items });
        mealClearDraft(key); await refreshNemlig();
      }, status);
      save.disabled = true; details.append(save); card.append(details);
      approve = mealAction('Overfør til Nemlig', async () => {
        if (dirty) throw new Error('Gem det rettede forslag først.');
        approve.dataset.keepDisabled = 'true';
        try {
          const intent = await mealApi('/api/nemlig/proposals/' + proposal.id + '/transfer-intent', 'POST', {
            expectedRevision: proposal.revision || 1,
          });
          await mealApi('/api/nemlig/proposals/' + proposal.id + '/approve', 'POST', {
            approved: true, expectedRevision: proposal.revision || 1, intentToken: intent.intentToken,
          });
        } catch (error) {
          try { await refreshNemlig(); } catch { /* Keep the transfer button disabled until status can be checked. */ }
          throw error;
        }
        mealClearDraft(key); await refreshNemlig(); toast('Kurvændring behandlet. Kontrollér resultatet på Nemlig.');
      }, status, true);
      approve.disabled = expired;
      const actions = mealNode('div', '', 'meal-actions');
      actions.append(approve, mealAction('Afvis', async () => {
        await mealApi('/api/nemlig/proposals/' + proposal.id + '/decline', 'POST');
        mealClearDraft(key); await refreshNemlig();
      }, status), mealAction('Genindlæs / kassér lokale rettelser', async () => {
        mealClearDraft(key); await refreshNemlig();
      }, status));
      card.append(actions);
      mealRegisterDraft(key, proposal, () => ({ items: fields.map(field => ({ productId: field.productId, quantity: field.input.value })) }), saved => {
        const byId = new Map(mealRawRows(saved.items, 60).map(item => [item.productId, item.quantity]));
        for (const field of fields) if (byId.has(field.productId)) field.input.value = mealRawText(byId.get(field.productId), 20);
        dirty = true; approve.disabled = true; save.disabled = expired; details.open = true;
      }, status);
    }
    if (proposal.result?.message) card.append(mealNode('p', proposal.result.message, 'meal-warning'));
    if (proposal.result?.outcomes) card.append(mealNode('p', proposal.result.outcomes.map(item => item.productId + ': ' + item.status).join(' · '), 'muted micro'));
    card.append(status); return card;
  }, 'Ingen kurvforslag. Din rigtige kurv ændres kun via Overfør til Nemlig.');
}

async function refreshNemlig() {
  const generation = mealSessionGeneration;
  let status;
  try { status = await mealApi('/api/nemlig/status'); }
  catch (error) {
    if (mealSessionCurrent(generation)) mealEl('meal-nemlig-status').textContent =
      'Den gemte Nemlig-status kunne ikke hentes fra JARVIS. Aktuel forbindelse er ukendt; dette er ikke en overførselskvittering.';
    throw error;
  }
  if (!mealSessionCurrent(generation)) return;
  const labels = { not_configured: 'Nemlig er ikke konfigureret. Madplaner og opskrifter fungerer lokalt.',
    not_verified: 'Nemlig er konfigureret, men forbindelsen er ikke verificeret.',
    connected: 'Forbindelsen til Nemlig blev bekræftet ved seneste forespørgsel.',
    stale: 'Seneste bekræftelse af Nemlig-forbindelsen er forældet; aktuel forbindelse er ukendt.',
    expired_login: 'Nemlig-login eller tilladelse er udløbet. Kontrollér opsætningen manuelt.',
    unavailable: 'Nemlig er utilgængelig efter seneste forespørgsel; ingen aktuel forbindelse er bekræftet.' };
  const timestamp = status.lastCheckedAt && Number.isFinite(Date.parse(status.lastCheckedAt))
    ? ' Senest kontrolleret: ' + new Date(status.lastCheckedAt).toLocaleString('da-DK') + '.' : ' Kontroltidspunkt: ukendt.';
  mealEl('meal-nemlig-status').textContent = (labels[status.connectionState] || labels[status.configured ? 'not_verified' : 'not_configured'])
    + timestamp + ' Forslag er lokale. Kun Overfør til Nemlig ændrer kurven; ingen bestillinger eller betalinger. Forbindelsesstatus er ikke en overførselskvittering.';
  for (const button of [mealEl('meal-nemlig-search-form').querySelector('button'), mealEl('meal-nemlig-propose'), mealEl('meal-nemlig-view-basket')]) button.disabled = !status.configured;
  showNemligProposals(status.proposals || []);
}

let calendarSelectionDirty = false;
mealEl('meal-google-calendar-id').addEventListener('input', () => { calendarSelectionDirty = true; mealDirty.add('calendar-selection'); });
async function refreshGoogle() {
  const generation = mealSessionGeneration;
  const data = await mealApi('/api/google/calendar/status');
  if (!mealSessionCurrent(generation)) return;
  const calendarInput = mealEl('meal-google-calendar-id');
  if (!calendarSelectionDirty && document.activeElement !== calendarInput) calendarInput.value = data.calendarId || 'primary';
  mealEl('meal-google-status').textContent = !data.configured
    ? 'OAuth er ikke konfigureret. Kalenderforbindelsen kræver Google OAuth-klient i serverens miljø.'
    : data.connectionState === 'expired_login' ? 'Google-login er udløbet. Forbind igen. Dine lokale planer er bevaret.'
    : data.connectionState === 'unavailable' ? `Kalenderen er midlertidigt utilgængelig: ${data.lastReadError}`
    : data.connectionState === 'not_verified' ? 'Login er gemt, men kalenderens dækning er endnu ikke kontrolleret.'
    : data.connected ? `Google Kalender er forbundet med read-only adgang. Senest læst: ${data.lastReadAt || 'ikke læst'}.` : 'Klar til at forbinde med Google.';
  mealEl('meal-google-connect').disabled = !data.configured;
  mealEl('meal-google-load').disabled = !data.connected;
  mealEl('meal-google-disconnect').disabled = !data.connected;
  mealEl('meal-use-calendar').disabled = !data.connected;
  if (!data.connected) mealEl('meal-use-calendar').checked = false;
}

async function refreshMeals() {
  if (mealRefreshPromise) { mealRefreshAgain = true; return mealRefreshPromise; }
  const generation = mealSessionGeneration;
  mealRefreshPromise = (async () => {
    do {
      mealRefreshAgain = false;
      const data = await mealApi('/api/meals');
      if (!mealSessionCurrent(generation)) return;
      mealData = data;
      showMealProfile(mealData.profile); showHousehold(mealData.household); showMealPlans(mealData.plans);
      try { const stockResponse = mealData.inventory || await mealApi('/api/meals/inventory');
        showMealInventory(stockResponse?.inventory || stockResponse || {}); }
      catch (error) { mealEl('meal-inventory-status').textContent = 'Lagerstatus kunne ikke hentes: ' + error.message; }
      await Promise.all([refreshNemlig(), refreshGoogle(), refreshRecipes(), refreshShoppingDrafts(), refreshHouseholdCalendar()]);
      if (!mealSessionCurrent(generation)) return;
      mealLoaded = true;
    } while (mealRefreshAgain);
  })();
  try { return await mealRefreshPromise; }
  finally { mealRefreshPromise = null; mealPersistDrafts(); }
}

mealEnhanceStaticUI();
mealEl('meal-family-form').addEventListener('input', () => { mealDirty.add('household'); mealEl('meal-family-status').textContent = 'Normal husstand har ugemte ændringer.'; });
mealEl('meal-family-form').addEventListener('submit', async event => {
  event.preventDefault();
  const unlock = mealLockControls(event.currentTarget);
  const unlockRhythm = mealLockControls(mealRhythmEditor.element);
  mealDirty.add('household');
  try {
    await mealApi('/api/meals/household', 'PUT', { expectedRevision: mealHouseholdRevision,
      adults: mealReadAdults(mealEl('meal-adults')), adultPortion: mealReadPortion(mealEl('meal-adult-portion')),
      children: mealHouseholdChildrenEditor.read(), rhythm: mealRhythmEditor.read() });
    mealClearDraft('household'); await refreshMeals(); toast('Husstanden er gemt. Kun planer med ændret grundlag skal gennemgås igen.');
  } catch (error) { mealEl('meal-family-status').textContent = error.message; }
  finally { unlockRhythm(); unlock(); }
});
mealEl('meal-family-show').addEventListener('click', async () => {
  mealPersistDrafts();
  try { showHousehold(mealData.household); await refreshHouseholdCalendar(); } catch (error) { toast(error.message); }
});
mealEl('meal-family-calendar-load').addEventListener('click', async () => {
  if (mealCalendarReading || mealEl('meal-family-calendar-load').disabled) return;
  const generation = mealSessionGeneration;
  mealCalendarReading = true; mealEl('meal-family-calendar-load').disabled = true;
  mealEl('meal-family-calendar-read-status').textContent = 'Læser næste 14 dage fra den valgte kalender. Husstand og madplaner ændres ikke.';
  try {
    await mealApi('/api/google/calendar/events?days=14');
    if (!mealSessionCurrent(generation)) return;
    mealEl('meal-family-calendar-read-status').textContent = 'Kalenderperioden er læst. Ingen aftaler, invitationer eller husstandsoplysninger er ændret.';
  } catch (error) {
    if (mealSessionCurrent(generation)) mealEl('meal-family-calendar-read-status').textContent = `Kalenderen kunne ikke læses: ${error.message}. Dækningen er ukendt; dine valg er bevaret.`;
  } finally {
    if (mealSessionCurrent(generation)) { mealCalendarReading = false; await Promise.all([refreshGoogle(), refreshHouseholdCalendar()]); }
  }
});

mealEl('meal-profile-form').addEventListener('input', () => { mealDirty.add('profile'); mealEl('meal-profile-status').textContent = 'Madpræferencerne har ugemte ændringer.'; });
mealEl('meal-profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const unlock = mealLockControls(event.currentTarget);
  mealDirty.add('profile');
  try {
    await mealApi('/api/meals/profile', 'PUT', {
      expectedRevision: mealProfileRevision,
      householdSize: Number(mealEl('meal-household').value), diet: mealEl('meal-diet').value,
      budgetDkk: mealEl('meal-budget').value || null,
      avoid: mealEl('meal-avoid').value.split(',').map(value => value.trim()).filter(Boolean),
      pantry: mealPantryEditor.read(),
    });
    mealClearDraft('profile'); await refreshMeals(); toast('Madpræferencer gemt.');
  } catch (error) { mealEl('meal-profile-status').textContent = error.message; }
  finally { unlock(); }
});

mealEl('meal-plan-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (mealDirty.has('profile') || mealDirty.has('household') || mealDirty.has('inventory') ||
      [...mealDirty].some(key => key.startsWith('family-day:'))) return toast('Gem dine præferencer, lager og husstandsdage før et nyt forslag.');
  const unlock = mealLockControls(event.currentTarget);
  try {
    await mealApi('/api/meals/plans', 'POST', { startDate: mealEl('meal-start').value, days: Number(mealEl('meal-days').value), useCalendar: mealEl('meal-use-calendar').checked });
    await refreshMeals(); toast('Madplansforslag oprettet. Gennemgå det, før du laver indkøbslisten.');
  } catch (error) { toast(error.message); }
  finally { unlock(); }
});

mealEl('meal-recipe-form').addEventListener('submit', async event => {
  event.preventDefault();
  const unlock = mealLockControls(event.currentTarget);
  mealEl('meal-recipe-status').textContent = 'Gemmer kilden i din private opskriftsindbakke …';
  try {
    await mealApi('/api/recipes', 'POST', { text: mealEl('meal-recipe-text').value,
      urls: mealEl('meal-recipe-urls').value.split('\n').map(value => value.trim()).filter(Boolean), source: { channel: 'web' } });
    mealEl('meal-recipe-text').value = ''; mealEl('meal-recipe-urls').value = '';
    mealClearDraft('recipe-capture'); mealRegisterRecipeCaptureDraft();
    mealEl('meal-recipe-status').textContent = 'Gemt som udkast. Gennemgå opskriften nedenfor, før du godkender den til madplaner.';
    await refreshRecipes();
  } catch (error) { mealEl('meal-recipe-status').textContent = error.message; }
  finally { unlock(); }
});
mealEl('meal-recipes-refresh').addEventListener('click', () => refreshRecipes().catch(error => toast(error.message)));

mealEl('meal-google-connect').addEventListener('click', async () => {
  try { const { url } = await mealApi('/api/google/calendar/connect', 'POST'); window.location.assign(url); }
  catch (error) { toast(error.message); }
});
mealEl('meal-google-calendar-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await mealApi('/api/google/calendar/select', 'POST', { calendarId: mealEl('meal-google-calendar-id').value.trim() });
    calendarSelectionDirty = false;
    mealClearDraft('calendar-selection'); mealRegisterCalendarDraft();
    mealCalendarCache = null; showHouseholdCalendar();
    await Promise.all([refreshGoogle(), refreshHouseholdCalendar()]);
    mealEl('meal-google-events').replaceChildren();
  } catch (error) { mealEl('meal-google-status').textContent = `Kalendervalget blev ikke gemt: ${error.message}`; }
});
mealEl('meal-google-load').addEventListener('click', async () => {
  if (typeof JarvisCalendar === 'object') { await JarvisCalendar.load(); return; }
  const root = mealEl('meal-google-events'); root.replaceChildren();
  try {
    const { events } = await mealApi('/api/google/calendar/events?days=7');
    await refreshHouseholdCalendar();
    if (!events.length) root.append(mealNode('p', 'Ingen aftaler i denne periode.', 'muted'));
    for (const event of events) root.append(mealNode('p', event.start.slice(0, 16) + ' · ' + event.title, 'meal-event'));
  } catch (error) { root.append(mealNode('p', error.message, 'muted')); }
});
mealEl('meal-google-disconnect').addEventListener('click', async () => {
  try { await mealApi('/api/google/calendar/disconnect', 'POST'); mealCalendarCache = null; showHouseholdCalendar();
    await Promise.all([refreshGoogle(), refreshHouseholdCalendar()]); mealEl('meal-google-events').replaceChildren(); }
  catch (error) { toast(error.message); }
});
mealEl('meal-nemlig-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { const { products } = await mealApi('/api/nemlig/search', 'POST', { query: mealEl('meal-nemlig-search').value }); showNemligProducts(products); }
  catch (error) { toast(error.message); }
  finally { await refreshNemlig().catch(() => {}); } // Local observation only, never a new retailer probe.
});
mealEl('meal-nemlig-propose').addEventListener('click', async () => {
  if (!mealSelection.size) return toast('Vælg først mindst én vare.');
  try {
    await mealApi('/api/nemlig/proposals', 'POST', { items: [...mealSelection.values()].map(item => ({ productId: item.productId, quantity: item.quantity })) });
    mealSelection.clear(); showNemligSelection(); toast('Kurvforslag gemt. Nemlig-kurven er ikke ændret.');
  } catch (error) { toast(error.message); }
  finally { await refreshNemlig().catch(() => {}); }
});
mealEl('meal-nemlig-view-basket').addEventListener('click', async () => {
  try { const { basket } = await mealApi('/api/nemlig/basket'); showBasket(basket); }
  catch (error) { toast(error.message); }
  finally { await refreshNemlig().catch(() => {}); }
});

function mealRegisterRecipeCaptureDraft() {
  mealRegisterDraft('recipe-capture', {}, () => ({ text: mealEl('meal-recipe-text').value, urls: mealEl('meal-recipe-urls').value }), fields => {
    mealEl('meal-recipe-text').value = mealRawText(fields.text, 50000); mealEl('meal-recipe-urls').value = mealRawText(fields.urls, 10000);
  }, mealEl('meal-recipe-status'));
}

function mealRegisterCalendarDraft() {
  let status = mealEl('meal-calendar-draft-status');
  if (!status) {
    status = mealNode('p', '', 'muted micro'); status.id = 'meal-calendar-draft-status'; status.setAttribute('aria-live', 'polite');
    mealEl('meal-google-calendar-form').append(status);
  }
  mealRegisterDraft('calendar-selection', {}, () => ({ calendarId: mealEl('meal-google-calendar-id').value }), fields => {
    mealEl('meal-google-calendar-id').value = mealRawText(fields.calendarId, 500); calendarSelectionDirty = true;
  }, status);
}

mealEl('meal-start').value = mealLocalDate();
mealEl('meal-family-start').value = mealLocalDate();
showMealProfile({ householdSize: 2, diet: 'omnivore', avoid: [], pantry: [], budgetDkk: null }, { initial: true });
showHousehold({ configured: false, adults: null, children: [], days: {}, rhythm: null, revision: 1 }, { initial: true });
showMealInventory({ configured: false, revision: 1, items: [] }, { initial: true });
mealRegisterRecipeCaptureDraft(); mealRegisterCalendarDraft();
for (const id of ['meal-recipe-text', 'meal-recipe-urls']) mealEl(id).addEventListener('input', () => {
  mealDirty.add('recipe-capture'); mealEl('meal-recipe-status').textContent = 'Opskriftskilden er en ugemt kladde. Intet er importeret endnu.';
});
mealEl('meal-recipe-form').append(mealAction('Kassér ugemt opskriftskilde', async () => {
  mealEl('meal-recipe-text').value = ''; mealEl('meal-recipe-urls').value = '';
  mealClearDraft('recipe-capture'); mealRegisterRecipeCaptureDraft();
  mealEl('meal-recipe-status').textContent = 'Den lokale kladde er kasseret. Allerede gemte opskrifter er uændrede.';
}, mealEl('meal-recipe-status')));
for (const eventName of ['input', 'change', 'click']) document.addEventListener(eventName, event => {
  if (event.target?.closest?.('.meals-panel, .meal-card, .meal-family-day, .meal-v5-panel')) mealPersistDrafts();
});
mealEl('logout')?.addEventListener('click', () => {
  mealSessionGeneration++; mealLoaded = false; mealDirty.clear(); mealRecoveredDrafts = {}; mealDraftControllers.clear(); mealSelection.clear();
  mealCalendarCache = null; mealCalendarReadSequence++; mealCalendarReading = false; mealCalendarRenderSignature = '';
  mealEl('meal-family-calendar-comparison').replaceChildren();
  mealEl('meal-family-calendar-status').textContent = 'Ingen kalenderdækning er læst i denne session.';
  mealEl('meal-family-calendar-read-status').textContent = ''; mealEl('meal-family-calendar-load').disabled = true;
  try { sessionStorage.removeItem(mealDraftKey); } catch { /* Already hidden by the app's logout handler. */ }
  mealData = { profile: {}, plans: [], household: { configured: false, days: {} }, recipes: [] };
  for (const id of ['meal-plans', 'meal-family-days', 'meal-recipes', 'meal-shopping-drafts', 'meal-nemlig-proposals', 'meal-nemlig-results', 'meal-nemlig-basket', 'meal-google-events']) mealEl(id).replaceChildren();
  for (const id of ['meal-recipe-text', 'meal-recipe-urls', 'meal-nemlig-search']) mealEl(id).value = '';
  mealEl('meal-google-calendar-id').value = 'primary'; calendarSelectionDirty = false;
  showMealProfile({ householdSize: 2, diet: 'omnivore', avoid: [], pantry: [], budgetDkk: null }, { initial: true });
  showHousehold({ configured: false, adults: null, children: [], days: {}, rhythm: null, revision: 1 }, { initial: true });
  showMealInventory({ configured: false, revision: 1, items: [] }, { initial: true });
  mealRegisterRecipeCaptureDraft(); mealRegisterCalendarDraft(); showNemligSelection();
});
showNemligSelection();
document.addEventListener('jarvis:refreshed', () => {
  if (!mealEl('tab-meals').classList.contains('hidden')) refreshMeals().catch(error => console.warn('Madplan-status:', error.message));
});
document.addEventListener('jarvis:view-changed', event => {
  if (event.detail?.view === 'meals' && localStorage.getItem('jarvisAccessToken')) refreshMeals().catch(error => toast(error.message));
  else if (event.detail?.primaryView === 'settings' && event.detail?.section === 'integrations' && localStorage.getItem('jarvisAccessToken')) refreshGoogle().catch(error => toast(error.message));
});
window.addEventListener('beforeunload', event => {
  if (!mealDirty.size && !mealEl('meal-recipe-text').value.trim() && !mealEl('meal-recipe-urls').value.trim()) return;
  mealPersistDrafts();
  if (mealDraftStorageAvailable && [...mealDirty].every(key => mealDraftControllers.has(key))) return;
  event.preventDefault(); event.returnValue = '';
});
