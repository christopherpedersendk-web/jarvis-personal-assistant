// v4.9 — explicit household facts, editable drafts and reviewed shopping.
// All source text is data; no HTML from recipes, Discord or Nemlig is executed.
let mealLoaded = false;
let mealRefreshPromise = null;
let mealRefreshAgain = false;
let mealFieldSequence = 0;
let mealData = { profile: {}, plans: [], household: { configured: false, days: {} }, recipes: [] };
const mealSelection = new Map();
const mealDirty = new Set();
const mealEl = id => document.getElementById(id);
const mealThemes = [
  ['everyday', 'Hverdag'], ['child_friendly', 'Børnevenlig'], ['vegan', 'Vegansk'],
  ['vegetarian', 'Vegetarisk'], ['date', 'Date'], ['party', 'Fest'], ['quick', 'Hurtig'],
];
const mealDiets = [['omnivore', 'Almindelig'], ['vegetarian', 'Vegetarisk'], ['vegan', 'Vegansk']];
const mealUnits = ['g', 'kg', 'ml', 'l', 'dl', 'cl', 'stk', 'fed', 'tsk', 'spsk', 'pakke'];
const mealWeekdays = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
let mealPantryEditor = null;
let mealHouseholdChildrenEditor = null;
let mealRhythmEditor = null;
let mealInventoryEditor = null;
let mealInventory = { configured: false, revision: 1, items: [] };

function mealNode(tag, value = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = String(value);
  if (className) node.className = className;
  return node;
}

function mealApi(path, method = 'GET', body) {
  return api(path, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
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

function mealPortionsText(adults, children = []) {
  if (!Number.isInteger(adults)) return 'Ukendt portionsgrundlag';
  const parts = children.map(child => Number(child.portion ?? (child.age <= 5 ? 0.5 : child.age <= 12 ? 0.75 : 1)));
  const total = adults + parts.reduce((sum, part) => sum + part, 0);
  const format = number => number.toLocaleString('da-DK', { maximumFractionDigits: 2 });
  return `${format(total)} portioner (${adults} voksne à 1${parts.length ? ' + ' + parts.length + ' børn à ' + parts.map(format).join(', ') : ''})`;
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
  return { element, setItems, read };
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
    const entry = { row, age, portion };
    remove.addEventListener('click', () => { controls.splice(controls.indexOf(entry), 1); row.remove(); onChange(); });
    for (const control of [age, portion]) control.addEventListener('input', onChange);
    row.append(age, portion, remove); rows.append(row); controls.push(entry);
  }
  add.addEventListener('click', () => { appendRow(); controls.at(-1)?.age.focus(); onChange(); });
  function setItems(items = []) { rows.replaceChildren(); controls.length = 0; for (const item of items) appendRow(item); }
  function read() {
    return controls.map(({ age, portion }) => {
      const years = Number(age.value);
      if (!age.value || !Number.isInteger(years) || years < 0 || years > 17) throw new Error('Angiv barnets alder mellem 0 og 17.');
      if (!portion.value.trim()) return { age: years };
      const factor = Number(portion.value);
      if (!Number.isFinite(factor) || factor < 0.25 || factor > 3) throw new Error('Portionsfaktor skal være mellem 0,25 og 3.');
      return { age: years, portion: factor };
    });
  }
  element.append(rows, add); setItems(initial);
  return { element, setItems, read };
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
  function addWeekBlock(days = {}) {
    if (weekControls.length >= 4) return;
    const week = mealNode('details', '', 'meal-rhythm-week');
    week.append(mealNode('summary', 'Uge ' + (weekControls.length + 1)));
    const dayControls = [];
    for (let index = 0; index < 7; index++) {
      const data = days[String(index + 1)] || null;
      const row = mealNode('div', '', 'meal-rhythm-day');
      const active = mealCheck(mealWeekdays[index] + ' – brug særlig husstand', Boolean(data));
      const fields = mealNode('div', '', 'meal-rhythm-day-fields');
      const adults = mealInput(data?.adults ?? 0, 'number', { min: 0, max: 24 });
      const children = mealChildrenEditor(data?.children || [], onChange);
      const theme = mealSelect(mealThemes, data?.theme || 'everyday');
      const skip = mealCheck('Ingen aftensmad hjemme', data?.skip);
      fields.append(mealField('Voksne', adults), mealStructuredGroup('Børn og portioner', children),
        mealField('Tema', theme), skip.wrapper);
      fields.hidden = !active.control.checked;
      active.control.addEventListener('change', () => { fields.hidden = !active.control.checked; onChange(); });
      for (const field of [adults, theme, skip.control]) field.addEventListener('input', onChange);
      row.append(active.wrapper, fields); week.append(row);
      dayControls.push({ active: active.control, adults, children, theme, skip: skip.control });
    }
    weeksRoot.append(week); weekControls.push({ week, dayControls });
    removeWeek.disabled = weekControls.length <= 1; addWeek.disabled = weekControls.length >= 4;
  }
  function set(value) {
    enabled.control.checked = Boolean(value); anchor.value = value?.anchorMonday || mealMonday();
    weeksRoot.replaceChildren(); weekControls.length = 0;
    for (const week of value?.weeks?.length ? value.weeks : [{}]) addWeekBlock(week);
    editor.hidden = !enabled.control.checked;
  }
  function read() {
    if (!enabled.control.checked) return null;
    const date = new Date(anchor.value + 'T12:00:00Z');
    if (!anchor.value || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor.value || date.getUTCDay() !== 1)
      throw new Error('Familierytmen skal starte på en gyldig mandag.');
    return { anchorMonday: anchor.value, weeks: weekControls.map(({ dayControls }) => Object.fromEntries(dayControls.flatMap((day, index) => {
      if (!day.active.checked) return [];
      return [[String(index + 1), { adults: mealReadAdults(day.adults), children: day.children.read(),
        theme: day.theme.value, skip: day.skip.checked }]];
    }))) };
  }
  addWeek.addEventListener('click', () => { addWeekBlock(); onChange(); });
  removeWeek.addEventListener('click', () => { if (weekControls.length <= 1) return;
    weekControls.pop().week.remove(); removeWeek.disabled = weekControls.length <= 1; addWeek.disabled = false; onChange(); });
  element.append(heading, enabled.wrapper, editor); set(initial);
  return { element, set, read };
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
  return { id: date, adults: household.adults, children: household.children || [], theme: 'everyday', skip: false,
    ...(repeating || {}), ...(override || {}), override: Boolean(override), repeating: Boolean(repeating),
    configured: household.configured || Boolean(override || repeating) };
}

function mealEnhanceStaticUI() {
  const familyForm = mealEl('meal-family-form');
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

  const profileForm = mealEl('meal-profile-form');
  const legacyPantry = mealEl('meal-pantry');
  legacyPantry.hidden = true;
  profileForm.querySelector('label[for="meal-pantry"]')?.remove();
  mealPantryEditor = mealIngredientEditor([], () => { mealDirty.add('profile'); }, { allowZero: true });
  profileForm.insertBefore(mealStructuredGroup('Tidligere oplyst lager – ingrediens, antal og enhed', mealPantryEditor), mealEl('meal-profile-status'));

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
      mealDirty.delete('inventory'); mealInventory = result.inventory || result;
      await refreshMeals(); toast('Lageret er gemt. Berørte indkøbslister skal gennemgås.');
    } finally { unlock(); }
  }, status, true);
  save.id = 'meal-inventory-save';
  stock.append(mealInventoryEditor.element, status, save);
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
  return { element, set, read };
}

// Preserve unsaved fields even when another section or Discord refreshes data.
function mealSyncCards(root, records, prefix, render, emptyText) {
  const previous = new Map([...root.children].filter(node => node.dataset.recordKey).map(node => [node.dataset.recordKey, node]));
  const fragment = document.createDocumentFragment();
  const used = new Set();
  for (const record of records) {
    const key = prefix + ':' + record.id;
    let card = previous.get(key);
    // A background refresh must not replace the input currently holding focus,
    // even before its first change event. Buttons are intentionally excluded so
    // a successful save can replace the completed editor with fresh server data.
    const focusedEditor = card?.contains(document.activeElement) &&
      document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    if (!card || (!mealDirty.has(key) && !focusedEditor)) {
      card = render(record, key);
      card.dataset.recordKey = key;
      card.dataset.revision = String(record.revision || 1);
    } else if (card.dataset.revision !== String(record.revision || 1)) {
      const message = card.querySelector('[data-edit-status]');
      if (message) message.textContent = 'Oplysningerne er ændret et andet sted. Dine felter er bevaret; genindlæs før du gemmer.';
    }
    used.add(key); fragment.append(card);
  }
  for (const [key, card] of previous) {
    if (!used.has(key) && mealDirty.has(key)) {
      const message = card.querySelector('[data-edit-status]');
      if (message) message.textContent = 'Dette udkast findes ikke længere i den seneste oversigt. Genindlæs for at kassere dine lokale ændringer.';
      fragment.append(card);
    }
  }
  if (!fragment.childNodes.length) fragment.append(mealNode('p', emptyText, 'muted small-text'));
  root.replaceChildren(fragment);
}

function showMealProfile(profile) {
  if (mealDirty.has('profile') || (mealEl('meal-profile-form').contains(document.activeElement) &&
    document.activeElement?.matches('input, textarea, select'))) return;
  mealEl('meal-household').value = profile.householdSize;
  mealEl('meal-diet').value = profile.diet;
  mealEl('meal-budget').value = profile.budgetDkk ?? '';
  mealEl('meal-avoid').value = (profile.avoid || []).join(', ');
  mealEl('meal-pantry').value = mealIngredientText(profile.pantry);
  mealPantryEditor?.setItems(profile.pantry || []);
  mealEl('meal-profile-status').textContent = profile.source === 'user-entered'
    ? 'Dine senest gemte præferencer er indlæst.' : 'Standardindstillinger. Angiv dine faktiske præferencer.';
}

function showMealInventory(inventory = {}) {
  const status = mealEl('meal-inventory-status');
  const focused = mealInventoryEditor?.element.contains(document.activeElement) &&
    document.activeElement?.matches('input, textarea, select');
  if (mealDirty.has('inventory') || focused) {
    if (mealInventory.revision !== inventory.revision) status.textContent = 'Lageret er ændret et andet sted. Dine felter er bevaret; genindlæs før du gemmer.';
    return;
  }
  mealInventory = inventory;
  mealInventoryEditor?.set(inventory.items || []);
  status.textContent = inventory.configured
    ? 'Senest bekræftede lagerrevision: ' + (inventory.revision || 1) + '. Reserveret og ledigt vises ved hver vare.'
    : 'Intet særskilt lager er bekræftet. Oplyst lager under madpræferencer bruges indtil da.';
}

function showHousehold(household = {}) {
  const focused = mealEl('meal-family-form').contains(document.activeElement) ||
    mealRhythmEditor.element.contains(document.activeElement);
  if (!mealDirty.has('household') && !(focused && document.activeElement?.matches('input, textarea, select'))) {
    mealEl('meal-adults').value = household.configured ? household.adults : '';
    mealEl('meal-children').value = mealChildrenText(household.children);
    mealHouseholdChildrenEditor?.setItems(household.children || []);
    mealRhythmEditor?.set(household.rhythm || null);
    mealEl('meal-family-status').textContent = household.configured
      ? 'Husstanden er gemt. Dagsundtagelser har forrang over rytme og standard.'
      : 'Husstanden er ikke udfyldt. Ingen voksnes eller børns tilstedeværelse er bekræftet.';
  }
  const start = mealEl('meal-family-start').value || mealLocalDate();
  const records = Array.from({ length: 7 }, (_, index) => mealEffectiveDay(household, mealAddDays(start, index)));
  mealSyncCards(mealEl('meal-family-days'), records, 'family-day', (day, key) => {
    const card = mealNode('article', '', 'meal-family-day');
    card.append(mealNode('h3', mealDayLabel(day.id)), mealNode('span', day.override ? 'Dagsundtagelse' : day.repeating ? 'Familierytme' : day.configured ? 'Standardhusstand' : 'Ikke udfyldt', 'meal-status'));
    card.append(mealNode('p', day.skip ? 'Ingen aftensmad hjemme' : day.configured
      ? day.adults + ' voksne · ' + (day.children || []).length + ' børn · ' + (mealThemes.find(([id]) => id === day.theme)?.[1] || 'Hverdag')
      : 'Antal spisende er ikke bekræftet.', 'muted micro'));
    if (day.configured && !day.skip) card.append(mealNode('p', mealPortionsText(day.adults, day.children), 'muted micro'));
    const editor = document.createElement('details'); editor.className = 'meal-details meal-family-editor';
    editor.append(mealNode('summary', 'Tilpas dagen'));
    const adults = mealInput(day.configured ? day.adults : '', 'number', { min: 0, max: 24 });
    const status = mealNode('p', '', 'muted micro'); status.dataset.editStatus = '';
    const markDirty = () => { mealDirty.add(key); status.textContent = 'Ændringer er ikke gemt endnu.'; };
    const children = mealChildrenEditor(day.children, markDirty);
    const theme = mealSelect(mealThemes, day.theme || 'everyday');
    const skip = mealCheck('Ingen aftensmad hjemme', day.skip);
    editor.append(mealField('Voksne', adults), mealStructuredGroup('Børn – alder og portioner', children), mealField('Dagens tema', theme), skip.wrapper);
    const actions = mealNode('div', '', 'meal-actions');
    actions.append(mealAction('Gem dag', async () => {
      await mealApi('/api/meals/household/days/' + day.id, 'PUT', {
        adults: mealReadAdults(adults), children: children.read(), theme: theme.value, skip: skip.control.checked,
      });
      mealDirty.delete(key); await refreshMeals(); toast('Dagen er gemt. Berørte madplaner skal gennemgås igen.');
    }, status, true));
    actions.append(mealAction(day.override ? 'Fjern dagsundtagelsen' : 'Nulstil felter', async () => {
      if (day.override) await mealApi('/api/meals/household/days/' + day.id, 'DELETE');
      mealDirty.delete(key); await refreshMeals();
    }, status));
    for (const field of [adults, theme, skip.control]) field.addEventListener('input', markDirty);
    editor.append(status, actions); card.append(editor); return card;
  }, 'Vælg en dato for at se familiens uge.');
}

function mealRecipeChoices(dish) {
  const options = (mealData.recipes || []).map(recipe => [String(recipe.id), recipe.title]);
  if (!options.some(([id]) => id === String(dish.recipeId))) options.unshift([String(dish.recipeId || ''), dish.title || 'Tilpasset ret']);
  return options;
}

function mealDishEditor(dish, markDirty) {
  const fieldset = document.createElement('fieldset'); fieldset.className = 'meal-day-editor';
  fieldset.append(mealNode('legend', mealDayLabel(dish.date)));
  const household = dish.adults == null ? 'Antal voksne/børn er ikke bekræftet.'
    : dish.adults + ' voksne · ' + (dish.children || []).length + ' børn';
  fieldset.append(mealNode('p', household, 'muted micro'));
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
  const ingredients = mealIngredientEditor(dish.ingredients || [], () => {
    changed.add('ingredients');
    try { previewBasis = ingredients.read(); previewServings = Number(servings.value) || 1; }
    catch { /* Incomplete input remains in the visible draft until save. */ }
    markDirty();
  });
  details.append(mealField('Titel', title), mealField('Minutter', minutes), mealField('Rettens kosttype (kontrollér ved ændringer)', diet),
    mealStructuredGroup('Ingredienser til de viste portioner', ingredients));
  fieldset.append(details);
  const reasons = Array.isArray(dish.reasons) ? dish.reasons : [];
  if (reasons.length) fieldset.append(mealNode('p', reasons.join(' · '), 'muted micro'));
  function updateIngredientPreview() {
    const count = Number(servings.value);
    if (!servings.value || !Number.isFinite(count) || count <= 0) return;
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
      updateIngredientPreview();
      changed.clear();
    }
    markDirty();
  });
  return {
    element: fieldset,
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
  mealSyncCards(mealEl('meal-plans'), (plans || []).slice(0, 5), 'plan', (plan, key) => {
    const card = mealNode('article', '', 'meal-card meal-plan-card');
    const ready = plan.status === 'shopping_ready';
    card.append(mealNode('h3', plan.startDate + ' · ' + plan.days + ' dage'),
      mealNode('span', ready ? 'Indkøbsliste klar' : 'Madplansforslag', 'meal-status'));
    card.append(mealNode('p', 'Version ' + (plan.revision || 1) + ' · ' + (ready
      ? 'Listen er beregnet fra den gemte plan. Retter du planen, skal listen laves igen.'
      : 'Ret forslaget, gem dine ændringer, og opret derefter indkøbslisten.'), 'muted small-text'));
    if (plan.calendarAware) card.append(mealNode('p', 'Kalenderen påvirker forslag til tilberedningstid — ikke hvem der er hjemme.', 'muted micro'));
    if (plan.householdStale || plan.profileStale || plan.recipeStale) card.append(mealNode('p',
      plan.staleReason || 'Grundlaget er ændret. Opdatér husstand eller gennemgå og gem planen igen før indkøb.', 'meal-warning'));
    let dishDirty = false; let listDirty = false;
    const status = mealNode('p', '', 'muted micro'); status.dataset.editStatus = '';
    const actions = mealNode('div', '', 'meal-actions');
    let savePlan, buildList, findProducts, saveList, regenerate, swap;
    const listFields = document.createElement('fieldset'); listFields.className = 'meal-list-editor';
    const shoppingEditor = mealIngredientEditor(plan.shoppingList || [], () => {
      listDirty = true; mealDirty.add(key);
      status.textContent = 'Listerettelser er ikke gemt. Gem eller genindlæs før du ændrer madplanen.';
      flags();
    });
    function flags() {
      savePlan.disabled = (!dishDirty && !plan.profileStale && !plan.recipeStale) || listDirty || Boolean(plan.householdStale);
      buildList.disabled = dishDirty || listDirty || Boolean(plan.householdStale || plan.profileStale || plan.recipeStale);
      findProducts.disabled = !ready || !(plan.shoppingList || []).length || dishDirty || listDirty;
      if (saveList) saveList.disabled = !listDirty || dishDirty;
      listFields.disabled = dishDirty;
      for (const editor of editors) editor.element.disabled = listDirty;
      if (regenerate) regenerate.disabled = dishDirty || listDirty || Boolean(plan.householdStale || plan.profileStale || plan.recipeStale);
      if (swap) swap.disabled = dishDirty || listDirty || Boolean(plan.householdStale || plan.profileStale || plan.recipeStale);
    }
    function dirtyDishes() {
      dishDirty = true; mealDirty.add(key);
      status.textContent = 'Madplansændringer er ikke gemt. Indkøb venter, til du har gemt.';
      flags();
    }
    const editors = (plan.dishes || []).map(dish => mealDishEditor(dish, dirtyDishes));
    const dayGrid = mealNode('div', '', 'meal-dishes');
    dayGrid.append(...editors.map(editor => editor.element)); card.append(dayGrid);
    savePlan = mealAction('Gem ændringer i madplanen', async () => {
      await mealApi('/api/meals/plans/' + plan.id, 'PUT', { expectedRevision: plan.revision || 1, dishes: editors.map(editor => editor.collect()) });
      mealDirty.delete(key); await refreshMeals(); toast('Madplanen er gemt. Indkøbslisten skal beregnes fra den nye version.');
    }, status, true);
    buildList = mealAction(ready ? 'Genberegn indkøbsliste' : 'Opret indkøbsliste', async () => {
      await mealApi('/api/meals/plans/' + plan.id + '/shopping-list', 'POST', { expectedRevision: plan.revision || 1 });
      await refreshMeals(); toast('Indkøbslisten er oprettet. Nemlig-kurven er ikke ændret.');
    }, status);
    regenerate = mealAction('Foreslå nye retter til ulåste dage', async () => {
      if (mealDirty.has(key)) throw new Error('Gem eller kassér dine lokale ændringer før nye retter foreslås.');
      await mealApi('/api/meals/plans/' + plan.id + '/regenerate', 'POST', { expectedRevision: plan.revision || 1 });
      await refreshMeals(); toast('Ulåste dage er opdateret. Låste retter og manuelle ekstravarer er bevaret.');
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
      mealDirty.delete(key); await refreshMeals();
    }, status));
    card.append(actions, swapDetails);
    if (ready) {
      const list = mealNode('ul', '', 'meal-shopping-list');
      for (const item of plan.shoppingList || []) list.append(mealNode('li', item.name + ' · ' + item.quantity + ' ' + item.unit));
      card.append(mealNode('h4', 'Indkøbsliste — oplyst lager er fratrukket'));
      if (!(plan.shoppingList || []).length) card.append(mealNode('p', 'Ingen manglende ingredienser i den beregnede liste.', 'muted'));
      card.append(list);
      const edit = document.createElement('details'); edit.className = 'meal-details';
      edit.append(mealNode('summary', 'Ret selve indkøbslisten'));
      listFields.append(mealStructuredGroup('Varer og antal', shoppingEditor));
      saveList = mealAction('Gem rettelser til listen', async () => {
        await mealApi('/api/meals/plans/' + plan.id + '/shopping-list', 'PUT', { expectedRevision: plan.revision || 1, items: shoppingEditor.read() });
        mealDirty.delete(key); await refreshMeals(); toast('Listen er rettet. Tidligere kurvforslag fra listen skal laves igen.');
      }, status);
      listFields.append(saveList); edit.append(listFields); card.append(edit, findProducts);
    }
    card.append(mealNode('p', 'Budgetmål: ' + (plan.budgetTargetDkk ?? 'ikke fastsat') + ' kr. · Ikke en prisgaranti.', 'muted micro'), status);
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
  const data = await mealApi('/api/recipes');
  showRecipes(data.recipes || []);
}

function showRecipes(recipes) {
  mealSyncCards(mealEl('meal-recipes'), recipes.filter(recipe => recipe.status !== 'archived').slice(0, 30), 'recipe', (recipe, key) => {
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
    actions.append(mealAction('Gem som udkast', async () => {
      await mealApi('/api/recipes/' + recipe.id, 'PUT', collect(false));
      mealDirty.delete(key); await refreshMeals(); toast('Opskriften er gemt som udkast, ikke som bekræftet opskrift.');
    }, status));
    actions.append(mealAction('Godkend opskrift til madplaner', async () => {
      await mealApi('/api/recipes/' + recipe.id, 'PUT', collect(true));
      mealDirty.delete(key); await refreshMeals(); toast('Opskriften kan nu bruges som inspiration i madplaner.');
    }, status, true));
    actions.append(mealAction('Arkivér opskrift', async () => {
      await mealApi('/api/recipes/' + recipe.id + '/archive', 'POST', { expectedRevision: recipe.revision || 1 });
      mealDirty.delete(key); await refreshMeals();
    }, status));
    actions.append(mealAction('Genindlæs / kassér lokale rettelser', async () => {
      mealDirty.delete(key); await refreshRecipes();
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
    details.append(actions); card.append(details, status); return card;
  }, 'Opskriftsindbakken er tom. Gem en opskrift her eller send den via Discord.');
}

async function refreshShoppingDrafts() {
  const { drafts = [] } = await mealApi('/api/shopping-drafts');
  mealSyncCards(mealEl('meal-shopping-drafts'), drafts.slice(0, 8), 'shopping-draft', (draft, key) => {
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
        for (const [property, label] of [['Brand', 'Mærke'], ['Unit', 'Pakning'], ['Ingredients', 'Ingredienser'], ['Allergens', 'Allergener'], ['Description', 'Beskrivelse']]) {
          const value = mealProductText(selected[property]);
          if (value) evidence.append(mealNode('p', label + ': ' + value, 'muted micro'));
        }
        if (!selected.Ingredients || !selected.Allergens) evidence.append(mealNode('p',
          'Ingrediens- eller allergenoplysninger mangler i de viste data. Fravær af oplysninger er ikke en sikkerhedsgaranti; kontrollér varens mærkning hos Nemlig.', 'meal-warning'));
      }
      showProductEvidence(); product.addEventListener('change', showProductEvidence); row.append(details);
      if (item.reason) row.append(mealNode('p', item.reason, 'muted micro'));
      if (item.needsReview) row.append(mealNode('p', 'Gennemgå match, pakningsstørrelse, kostønsker og antal. Gem varevalgene for at bekræfte din gennemgang.', 'meal-warning'));
      for (const field of [product, quantity]) field.addEventListener('input', () => {
        changed = true; mealDirty.add(key); saveButton.disabled = false; proposeButton.disabled = true;
        status.textContent = 'Gem dine varevalg, før du opretter det endelige kurvforslag.';
      });
      card.append(row);
      return { lineId: item.lineId, product, quantity };
    });
    if (editable) {
      const actions = mealNode('div', '', 'meal-actions');
      saveButton = mealAction('Gem varevalg og antal', async () => {
        await mealApi('/api/shopping-drafts/' + draft.id, 'PUT', { expectedRevision: draft.revision || 1,
          items: fields.map(field => ({ lineId: field.lineId, productId: field.product.value || null, quantity: Number(field.quantity.value) })) });
        mealDirty.delete(key); await refreshShoppingDrafts();
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
        mealDirty.delete(key); await refreshShoppingDrafts();
      }, status));
      card.append(actions);
    }
    card.append(status); return card;
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
        mealDirty.delete(key); await refreshNemlig();
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
        mealDirty.delete(key); await refreshNemlig(); toast('Kurvændring behandlet. Kontrollér resultatet på Nemlig.');
      }, status, true);
      approve.disabled = expired;
      const actions = mealNode('div', '', 'meal-actions');
      actions.append(approve, mealAction('Afvis', async () => {
        await mealApi('/api/nemlig/proposals/' + proposal.id + '/decline', 'POST');
        mealDirty.delete(key); await refreshNemlig();
      }, status), mealAction('Genindlæs / kassér lokale rettelser', async () => {
        mealDirty.delete(key); await refreshNemlig();
      }, status));
      card.append(actions);
    }
    if (proposal.result?.message) card.append(mealNode('p', proposal.result.message, 'meal-warning'));
    if (proposal.result?.outcomes) card.append(mealNode('p', proposal.result.outcomes.map(item => item.productId + ': ' + item.status).join(' · '), 'muted micro'));
    card.append(status); return card;
  }, 'Ingen kurvforslag. Din rigtige kurv ændres kun via Overfør til Nemlig.');
}

async function refreshNemlig() {
  const status = await mealApi('/api/nemlig/status');
  mealEl('meal-nemlig-status').textContent = status.configured
    ? 'MCP tilgængelig. Forslag er lokale. Kun Overfør til Nemlig ændrer kurven; ingen bestillinger eller betalinger.'
    : 'MCP er ikke tilsluttet. Madplaner og opskrifter fungerer lokalt; Nemlig kræver særskilt opsætning.';
  for (const button of [mealEl('meal-nemlig-search-form').querySelector('button'), mealEl('meal-nemlig-propose'), mealEl('meal-nemlig-view-basket')]) button.disabled = !status.configured;
  showNemligProposals(status.proposals || []);
}

let calendarSelectionDirty = false;
mealEl('meal-google-calendar-id').addEventListener('input', () => { calendarSelectionDirty = true; });
async function refreshGoogle() {
  const data = await mealApi('/api/google/calendar/status');
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
  mealRefreshPromise = (async () => {
    do {
      mealRefreshAgain = false;
      mealData = await mealApi('/api/meals');
      showMealProfile(mealData.profile); showHousehold(mealData.household); showMealPlans(mealData.plans);
      try { const stockResponse = mealData.inventory || await mealApi('/api/meals/inventory');
        showMealInventory(stockResponse?.inventory || stockResponse || {}); }
      catch (error) { mealEl('meal-inventory-status').textContent = 'Lagerstatus kunne ikke hentes: ' + error.message; }
      await Promise.all([refreshNemlig(), refreshGoogle(), refreshRecipes(), refreshShoppingDrafts()]);
      mealLoaded = true;
    } while (mealRefreshAgain);
  })();
  try { return await mealRefreshPromise; }
  finally { mealRefreshPromise = null; }
}

mealEnhanceStaticUI();
mealEl('meal-family-form').addEventListener('input', () => { mealDirty.add('household'); mealEl('meal-family-status').textContent = 'Normal husstand har ugemte ændringer.'; });
mealEl('meal-family-form').addEventListener('submit', async event => {
  event.preventDefault();
  const unlock = mealLockControls(event.currentTarget);
  const unlockRhythm = mealLockControls(mealRhythmEditor.element);
  try {
    await mealApi('/api/meals/household', 'PUT', { adults: mealReadAdults(mealEl('meal-adults')),
      children: mealHouseholdChildrenEditor.read(), rhythm: mealRhythmEditor.read() });
    mealDirty.delete('household'); await refreshMeals(); toast('Husstanden er gemt. Tidligere madplaner skal gennemgås igen.');
  } catch (error) { mealEl('meal-family-status').textContent = error.message; }
  finally { unlockRhythm(); unlock(); }
});
mealEl('meal-family-show').addEventListener('click', () => {
  if ([...mealDirty].some(key => key.startsWith('family-day:'))) return toast('Gem eller nulstil dine dagstilpasninger, før du skifter uge.');
  try { showHousehold(mealData.household); } catch (error) { toast(error.message); }
});

mealEl('meal-profile-form').addEventListener('input', () => { mealDirty.add('profile'); });
mealEl('meal-profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const unlock = mealLockControls(event.currentTarget);
  try {
    await mealApi('/api/meals/profile', 'PUT', {
      householdSize: Number(mealEl('meal-household').value), diet: mealEl('meal-diet').value,
      budgetDkk: mealEl('meal-budget').value || null,
      avoid: mealEl('meal-avoid').value.split(',').map(value => value.trim()).filter(Boolean),
      pantry: mealPantryEditor.read(),
    });
    mealDirty.delete('profile'); await refreshMeals(); toast('Madpræferencer gemt.');
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
    await refreshGoogle();
    mealEl('meal-google-events').replaceChildren();
  } catch (error) { mealEl('meal-google-status').textContent = `Kalendervalget blev ikke gemt: ${error.message}`; }
});
mealEl('meal-google-load').addEventListener('click', async () => {
  const root = mealEl('meal-google-events'); root.replaceChildren();
  try {
    const { events } = await mealApi('/api/google/calendar/events?days=7');
    if (!events.length) root.append(mealNode('p', 'Ingen aftaler i denne periode.', 'muted'));
    for (const event of events) root.append(mealNode('p', event.start.slice(0, 16) + ' · ' + event.title, 'meal-event'));
  } catch (error) { root.append(mealNode('p', error.message, 'muted')); }
});
mealEl('meal-google-disconnect').addEventListener('click', async () => {
  try { await mealApi('/api/google/calendar/disconnect', 'POST'); await refreshGoogle(); mealEl('meal-google-events').replaceChildren(); }
  catch (error) { toast(error.message); }
});
mealEl('meal-nemlig-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { const { products } = await mealApi('/api/nemlig/search', 'POST', { query: mealEl('meal-nemlig-search').value }); showNemligProducts(products); }
  catch (error) { toast(error.message); }
});
mealEl('meal-nemlig-propose').addEventListener('click', async () => {
  if (!mealSelection.size) return toast('Vælg først mindst én vare.');
  try {
    await mealApi('/api/nemlig/proposals', 'POST', { items: [...mealSelection.values()].map(item => ({ productId: item.productId, quantity: item.quantity })) });
    mealSelection.clear(); showNemligSelection(); await refreshNemlig(); toast('Kurvforslag gemt. Nemlig-kurven er ikke ændret.');
  } catch (error) { toast(error.message); }
});
mealEl('meal-nemlig-view-basket').addEventListener('click', async () => {
  try { const { basket } = await mealApi('/api/nemlig/basket'); showBasket(basket); }
  catch (error) { toast(error.message); }
});

mealEl('meal-start').value = mealLocalDate();
mealEl('meal-family-start').value = mealLocalDate();
showNemligSelection();
document.addEventListener('jarvis:refreshed', () => {
  if (!mealLoaded) refreshMeals().catch(error => console.warn('Madplan-status:', error.message));
});
document.querySelector('[data-tab="meals"]')?.addEventListener('click', () => {
  if (mealLoaded) refreshMeals().catch(error => toast(error.message));
});
window.addEventListener('beforeunload', event => {
  if (!mealDirty.size && !mealEl('meal-recipe-text').value.trim() && !mealEl('meal-recipe-urls').value.trim()) return;
  event.preventDefault(); event.returnValue = '';
});
