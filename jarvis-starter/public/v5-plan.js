// Local planning always uses the declared Danish time zone, including when the
// browser is travelling. These pure helpers are also exercised without a DOM.
const JarvisPlan = (() => {
  const timeZone = 'Europe/Copenhagen';
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = instant => Object.fromEntries(formatter.formatToParts(new Date(instant))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const civilTime = (fields, millis = 0) => {
    const date = new Date(0);
    date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
    date.setUTCHours(fields.hour, fields.minute, fields.second || 0, millis);
    return date.getTime();
  };
  const same = (left, right) => ['year', 'month', 'day', 'hour', 'minute', 'second']
    .every(key => left[key] === right[key]);
  function toInstant(value, repeatedTime = 'reject') {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
    if (!match || !['reject', 'earlier', 'later'].includes(repeatedTime)) throw new Error('Angiv en gyldig dato og tid i Europe/Copenhagen.');
    const [, year, month, day, hour, minute, second = '0', fraction = ''] = match;
    const fields = { year: Number(year), month: Number(month), day: Number(day),
      hour: Number(hour), minute: Number(minute), second: Number(second) };
    const millis = Number(fraction.padEnd(3, '0'));
    const civil = civilTime(fields, millis), check = new Date(civil);
    if (!Number.isFinite(civil) || fields.year < 1 || check.getUTCFullYear() !== fields.year ||
        check.getUTCMonth() + 1 !== fields.month || check.getUTCDate() !== fields.day ||
        check.getUTCHours() !== fields.hour || check.getUTCMinutes() !== fields.minute ||
        check.getUTCSeconds() !== fields.second) throw new Error('Datoen eller klokkeslættet findes ikke.');
    const offsets = new Set();
    for (let hours = -36; hours <= 36; hours += 12) {
      const sample = civil + hours * 3_600_000;
      offsets.add(civilTime(parts(sample), new Date(sample).getUTCMilliseconds()) - sample);
    }
    const candidates = [...offsets].map(offset => civil - offset).filter(instant => same(parts(instant), fields))
      .sort((left, right) => left - right);
    if (!candidates.length) throw new Error('Klokkeslættet findes ikke i Europe/Copenhagen på grund af skift til sommertid. Vælg en anden tid.');
    if (candidates.length > 1 && repeatedTime === 'reject')
      throw new Error('Klokkeslættet forekommer to gange ved skift til vintertid. Vælg første eller anden forekomst i tidszonefeltet.');
    return new Date(repeatedTime === 'later' ? candidates.at(-1) : candidates[0]).toISOString();
  }
  function fromInstant(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Det gemte tidspunkt er ugyldigt.');
    const p = parts(date), pad = number => String(number).padStart(2, '0');
    const seconds = p.second || date.getUTCMilliseconds() ? `:${pad(p.second)}` : '';
    const fraction = date.getUTCMilliseconds() ? `.${String(date.getUTCMilliseconds()).padStart(3, '0')}` : '';
    return `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}${seconds}${fraction}`;
  }

  // Updating a neighbouring record never detaches a focused node. A changed or
  // removed focused card keeps its old revision, visibly stale, until focus
  // leaves or the owner explicitly completes a revision-bound action.
  function syncCards(target, records, { render, emptyText, forceId = null }) {
    const doc = target.ownerDocument, old = new Map([...target.children]
      .filter(card => card.dataset.planKey).map(card => [card.dataset.planKey, card]));
    const wanted = new Set(records.map(record => record.id));
    const stale = (card, message) => {
      let notice = card.querySelector('[data-plan-stale]');
      if (!notice) { notice = doc.createElement('p'); notice.dataset.planStale = '';
        notice.className = 'v5-conflict'; notice.setAttribute('role', 'status'); card.append(notice); }
      notice.textContent = message;
    };
    for (const [id, card] of old) if (!wanted.has(id)) {
      if (card.contains(doc.activeElement) && forceId !== id) stale(card, 'Posten er ændret eller fjernet. Den gamle revision er bevaret, mens du har fokus her.');
      else { card.remove(); old.delete(id); }
    }
    for (const child of [...target.children]) if (!child.dataset.planKey) child.remove();
    let anchor = target.firstElementChild;
    for (const record of records) {
      let card = old.get(record.id);
      const signature = JSON.stringify(record);
      if (card && card.planSignature !== signature) {
        if (card.contains(doc.activeElement) && forceId !== record.id) {
          stale(card, 'Ændret et andet sted. Fokus og den viste revision er bevaret; genindlæs før en ny ændring.');
        } else {
          const replacement = render(record);
          if (card.classList.contains('source-target')) replacement.classList.add('source-target');
          target.insertBefore(replacement, card);
          if (anchor === card) anchor = replacement;
          card.remove(); card = replacement;
        }
      } else if (!card) { card = render(record); target.insertBefore(card, anchor); }
      if (!card.dataset.planKey) { card.dataset.planKey = record.id; card.planSignature = signature; }
      if (card !== anchor && !target.contains(doc.activeElement)) target.insertBefore(card, anchor);
      anchor = card.nextElementSibling;
    }
    if (!target.children.length) { const empty = doc.createElement('p'); empty.className = 'muted';
      empty.textContent = emptyText; target.append(empty); }
  }
  return Object.freeze({ timeZone, toInstant, fromInstant, syncCards });
})();

// Personlige opgaver, kapacitet, opfølgning og kildebaserede oplysninger.
// Formularer og deres basisrevisioner bevares under polling, navigation og reload.
if (typeof document !== 'undefined') (() => {
  const byId = id => document.getElementById(id);
  const node = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  };
  const dateText = value => value ? new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium',
    timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(value)) : 'Ikke angivet';
  let repeatedTime;
  const localInstant = field => {
    if (typeof field === 'string') field = byId(field);
    // An untouched saved value must keep its original seconds and DST offset.
    if (field.value && field.value === field.dataset.originalLocal && field.dataset.originalInstant)
      return field.dataset.originalInstant;
    return JarvisPlan.toInstant(field.value, repeatedTime.value);
  };
  const setInstant = (field, value) => {
    field.value = JarvisPlan.fromInstant(value);
    field.dataset.originalLocal = field.value;
    field.dataset.originalInstant = value || '';
  };
  const errorStatus = (id, message, failed = false) => {
    const target = byId(id);
    target.textContent = message;
    target.classList.toggle('v5-error', failed);
  };
  const label = (parent, text, value) => {
    const item = node('p', 'v5-record-detail');
    item.append(node('strong', '', `${text}: `), document.createTextNode(value));
    parent.append(item);
  };
  const button = (text, handler, destructive = false, statusId = 'personal-task-status') => {
    const control = node('button', destructive ? 'secondary' : 'primary', text);
    control.type = 'button';
    control.addEventListener('click', async () => {
      control.disabled = true;
      try { await handler(); }
      catch (error) { errorStatus(statusId, error.message, true); }
      finally { control.disabled = false; }
    });
    return control;
  };

  const post = (url, method, payload) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const taskForm = byId('personal-task-form'), followForm = byId('follow-up-form'), capacityForm = byId('capacity-form');
  const taskSubmit = taskForm.querySelector('[type="submit"]'), followSubmit = followForm.querySelector('[type="submit"]');
  const taskFields = {}, followFields = {}, capacityFields = {};
  const field = (parent, registry, name, title, type = 'text', attributes = {}) => {
    const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
    input.id = name; if (input.tagName === 'INPUT') input.type = type;
    if (type === 'datetime-local') input.step = '0.001';
    if (type === 'checkbox') { input.style.width = 'auto'; input.style.justifySelf = 'start'; }
    Object.assign(input, attributes);
    const caption = node('label', '', title); caption.htmlFor = input.id;
    parent.append(caption, input); registry[name] = input; return input;
  };
  const option = (select, value, title) => { const element = node('option', '', title); element.value = value; select.append(element); };
  const fullWidth = element => { element.style.gridColumn = '1 / -1'; element.style.minWidth = '0'; element.style.maxWidth = '100%'; return element; };
  const advanced = (form, title) => {
    const details = fullWidth(node('details')); details.append(node('summary', '', title));
    const fields = node('div', 'v5-fields'); details.append(fields);
    form.insertBefore(details, form.querySelector('[type="submit"]')); return { details, fields };
  };
  const zoneBox = node('div', 'v5-fields'); zoneBox.append(fullWidth(node('p', 'muted small-text',
    'Alle tidspunkter i Plan bruger Europe/Copenhagen, også når enheden er i en anden tidszone. Uændrede gemte tidspunkter bevarer deres oprindelige offset.')));
  repeatedTime = field(zoneBox, {}, 'plan-repeated-time', 'Når et klokkeslæt forekommer to gange ved skift til vintertid', 'select');
  option(repeatedTime, 'reject', 'Spørg mig — ingen automatisk antagelse');
  option(repeatedTime, 'earlier', 'Første forekomst (sommertid)'); option(repeatedTime, 'later', 'Anden forekomst (vintertid)');
  byId('tab-plan').insertBefore(zoneBox, byId('tab-plan').querySelector('section'));

  let taskRecords = [], followRecords = [], taskEdit = null, followEdit = null, taskEpoch = 0, followEpoch = 0;
  let taskDirty = false, followDirty = false, capacityDirty = false, storageReady = true;
  let previousProposals = [], ownerToken = localStorage.getItem('jarvisAccessToken') || '';
  let capacityVersion = 0, simulationSequence = 0;
  let taskConflict = '', followConflict = '';
  const sequence = { tasks: 0, follow: 0, claims: 0 };
  const draftKey = 'jarvis:v5:plan-drafts';
  const taskDraftStatus = fullWidth(node('p', 'muted small-text'));
  const followDraftStatus = fullWidth(node('p', 'muted small-text'));
  for (const element of [taskDraftStatus, followDraftStatus]) { element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite'); }

  const taskAdvanced = advanced(taskForm, 'Tid, afhængigheder og låste valg');
  field(taskAdvanced.fields, taskFields, 'personal-task-outcome', 'Forventet resultat', 'textarea', { maxLength: 1000 });
  field(taskAdvanced.fields, taskFields, 'personal-task-uncertainty', 'Usikkerhed ud over varigheden (minutter)', 'number', { min: 0, max: 1440, value: '0' });
  field(taskAdvanced.fields, taskFields, 'personal-task-priority', 'Prioritet (0–5, 5 er højest)', 'number', { min: 0, max: 5, value: '2' });
  field(taskAdvanced.fields, taskFields, 'personal-task-earliest', 'Tidligste start', 'datetime-local');
  field(taskAdvanced.fields, taskFields, 'personal-task-planned', 'Mit valgte starttidspunkt (lokalt)', 'datetime-local');
  field(taskAdvanced.fields, taskFields, 'personal-task-locked', 'Lås det valgte starttidspunkt', 'checkbox');
  field(taskAdvanced.fields, taskFields, 'personal-task-next-check', 'Næste opfølgning på opgaven', 'datetime-local');
  field(taskAdvanced.fields, taskFields, 'personal-task-project', 'Projekt-ID (valgfrit)', 'text', { maxLength: 120 });
  const dependencyField = field(taskAdvanced.fields, taskFields, 'personal-task-dependencies', 'Opgaver der skal afsluttes først', 'select', { multiple: true, size: 4 });
  field(taskAdvanced.fields, taskFields, 'personal-task-state', 'Opgavestatus', 'select');
  for (const [value, title] of [['pending', 'Afventer'], ['in_progress', 'I gang'], ['blocked', 'Blokeret']])
    option(taskFields['personal-task-state'], value, title);

  let windowCounter = 0;
  const windowEditor = (parent, title, statusId, onChange) => {
    const box = fullWidth(node('fieldset')), legend = node('legend', '', title);
    legend.style.maxWidth = '100%'; legend.style.overflowWrap = 'anywhere'; box.append(legend);
    const rows = node('div'); box.append(rows);
    const add = raw => {
      if (rows.children.length >= 30) throw new Error('Højst 30 tidsvinduer i denne editor.');
      const row = node('div', 'v5-fields'), inputs = {}, prefix = `plan-window-${++windowCounter}`;
      const start = field(row, inputs, `${prefix}-start`, 'Fra', 'datetime-local');
      const end = field(row, inputs, `${prefix}-end`, 'Til', 'datetime-local');
      row.windowInputs = { start, end };
      if (raw?.start?.value !== undefined) restoreFields([start, end], { [start.id]: raw.start, [end.id]: raw.end });
      else if (raw) { setInstant(start, raw.start); setInstant(end, raw.end); }
      row.append(button('Fjern tidsvindue', () => { row.remove(); onChange(); }, true, statusId));
      rows.append(row);
    };
    box.append(button('Tilføj tidsvindue', () => { add(); onChange(); }, false, statusId));
    parent.append(box);
    return { set: values => { rows.replaceChildren(); for (const value of values || []) add(value); },
      raw: () => [...rows.children].map(row => ({ start: captureField(row.windowInputs.start), end: captureField(row.windowInputs.end) })),
      read: () => [...rows.children].map(row => {
        const start = localInstant(row.windowInputs.start), end = localInstant(row.windowInputs.end);
        if (!start || !end || end <= start) throw new Error(`${title}: begge tider skal udfyldes, og sluttid skal være efter starttid.`);
        return { start, end };
      }) };
  };
  const markTaskDirty = () => { taskDirty = true; taskEditControls(); persistDrafts(); draftStatus(); };
  const markFollowDirty = () => { followDirty = true; followEditControls(); persistDrafts(); draftStatus(); };
  const markCapacityDirty = event => {
    capacityDirty = true; capacityVersion++;
    if (!event || ![manualReview, capacityFields['capacity-buffer']].includes(event.target)) manualReview.checked = false;
    for (const control of byId('capacity-results').querySelectorAll('button')) control.disabled = true;
    if (previousProposals.length) errorStatus('capacity-status', 'Rammerne er ændret. Tidligere forslag er forældede; gennemgå kapaciteten og beregn igen før gemning.');
    persistDrafts();
  };
  const allowedWindows = windowEditor(taskAdvanced.fields, 'Tilladte tidsvinduer for opgaven (tom = ingen ekstra begrænsning)', 'personal-task-status', markTaskDirty);
  const taskCancel = button('Annullér redigering', () => {
    if (taskDirty && !window.confirm('Kassér den ugemte opgavekladde?')) return;
    resetTask(); persistDrafts(); byId('personal-task-title').focus();
  });
  const taskReload = button('Hent nyeste opgave og kassér kladde', async () => {
    if (!taskEdit || !window.confirm('Kassér kladden og åbn den nyeste gemte revision?')) return;
    await refreshPersonalTasks(); const record = taskRecords.find(item => item.id === taskEdit.id);
    if (!record || ['completed', 'archived'].includes(record.status)) throw new Error('Opgaven kan ikke længere redigeres. Kladden er stadig bevaret.');
    editTask(record, true);
  }, true);
  taskCancel.hidden = true; taskReload.hidden = true;
  taskForm.append(taskCancel, taskReload, taskDraftStatus);

  const followAdvanced = advanced(followForm, 'Registrér en observation eller udsæt næste tjek');
  const observationStatus = field(followAdvanced.fields, followFields, 'follow-observation-status', 'Observation', 'select');
  for (const [value, title] of [['', 'Ingen observation — flyt kun næste tjek'], ['changed', 'Ændret'], ['unchanged', 'Uændret'], ['unknown', 'Ukendt / kilden kunne ikke læses']]) option(observationStatus, value, title);
  field(followAdvanced.fields, followFields, 'follow-observation-subject', 'Observeret emne', 'text', { maxLength: 240 });
  field(followAdvanced.fields, followFields, 'follow-observation-source', 'Kilde til observationen', 'text', { maxLength: 1000 });
  field(followAdvanced.fields, followFields, 'follow-observation-value', 'Observationens værdi (valgfri)', 'text', { maxLength: 240 });
  followAdvanced.fields.append(fullWidth(node('p', 'muted small-text', 'En fejlet læsning er ukendt — aldrig uændret. Observationer opretter ingen job eller beskeder til andre.')));
  const followCancel = button('Annullér redigering', () => {
    if (followDirty && !window.confirm('Kassér den ugemte opfølgningskladde?')) return;
    resetFollow(); persistDrafts(); byId('follow-up-awaiting').focus();
  }, false, 'follow-up-status');
  const followReload = button('Hent nyeste sag og kassér kladde', async () => {
    if (!followEdit || !window.confirm('Kassér kladden og åbn den nyeste gemte revision?')) return;
    await refreshFollowUps(); const record = followRecords.find(item => item.id === followEdit.id && item.status === 'open');
    if (!record) throw new Error('Sagen er lukket eller utilgængelig. Kladden er stadig bevaret.');
    editFollow(record, true);
  }, true, 'follow-up-status');
  followForm.append(followCancel, followReload, followDraftStatus);

  const capacityAdvanced = advanced(capacityForm, 'Flere tidsrum, kendte aftaler og buffer');
  field(capacityAdvanced.fields, capacityFields, 'capacity-buffer', 'Buffer mellem opgaver og aftaler (minutter)', 'number', { min: 0, max: 180, value: '0' });
  const extraWindows = windowEditor(capacityAdvanced.fields, 'Yderligere mulige arbejdstidsrum', 'capacity-status', markCapacityDirty);
  const busyWindows = windowEditor(capacityAdvanced.fields, 'Aftaler og optaget tid, jeg har gennemgået manuelt', 'capacity-status', markCapacityDirty);
  const manualReview = field(capacityAdvanced.fields, capacityFields, 'capacity-manual-review', 'Jeg har selv gennemgået alle tidsrum og indtastet den kendte optagede tid ovenfor', 'checkbox');
  capacityAdvanced.fields.append(fullWidth(node('p', 'muted small-text', 'Vælg enten læsning af Google Kalender eller din egen manuelle gennemgang. Uden et af disse grundlag er kapaciteten ukendt.')));
  byId('capacity-reviewed').addEventListener('change', () => { if (byId('capacity-reviewed').checked) manualReview.checked = false; });
  manualReview.addEventListener('change', () => { if (manualReview.checked) byId('capacity-reviewed').checked = false; });

  const taskInputs = () => [byId('personal-task-title'), byId('personal-task-purpose'), byId('personal-task-duration'), byId('personal-task-deadline'), ...Object.values(taskFields)];
  const followInputs = () => [byId('follow-up-awaiting'), byId('follow-up-check'), byId('follow-up-stop'), ...Object.values(followFields)];
  const capacityInputs = () => [byId('capacity-start'), byId('capacity-end'), byId('capacity-reviewed'), ...Object.values(capacityFields), repeatedTime];
  function captureField(input) {
    return { value: input.multiple ? [...input.selectedOptions].map(item => item.value) : input.value,
      ...(input.type === 'checkbox' ? { checked: input.checked } : {}),
      ...(input.dataset.originalInstant ? { originalInstant: input.dataset.originalInstant, originalLocal: input.dataset.originalLocal } : {}) };
  }
  const captureFields = fields => Object.fromEntries(fields.map(input => [input.id, captureField(input)]));
  function restoreFields(fields, values) {
    for (const input of fields) {
      const saved = values?.[input.id]; if (!saved || typeof saved !== 'object') continue;
      if (input.multiple && Array.isArray(saved.value)) {
        const selected = saved.value.filter(value => typeof value === 'string' && value.length <= 100).slice(0, 30);
        for (const id of selected) if (![...input.options].some(item => item.value === id)) option(input, id, `Gemt afhængighed: ${id}`);
        for (const item of input.options) item.selected = selected.includes(item.value);
      } else if (typeof saved.value === 'string' && saved.value.length <= 4000) input.value = saved.value;
      if (input.type === 'checkbox') input.checked = saved.checked === true;
      if (typeof saved.originalInstant === 'string' && saved.originalInstant.length <= 40 &&
          typeof saved.originalLocal === 'string' && saved.originalLocal.length <= 30) {
        input.dataset.originalInstant = saved.originalInstant; input.dataset.originalLocal = saved.originalLocal;
      }
    }
  }
  function draftStatus() {
    taskDraftStatus.textContent = [taskEdit ? `Redigerer revision ${taskEdit.revision}.` : '', taskDirty ? 'Ugemt opgavekladde bevaret.' : '', taskConflict,
      (taskDirty || taskEdit) && !storageReady ? 'Browseren afviser kladdelagring; kopiér teksten før siden lukkes.' : ''].filter(Boolean).join(' ');
    followDraftStatus.textContent = [followEdit ? `Redigerer revision ${followEdit.revision}.` : '', followDirty ? 'Ugemt opfølgningskladde bevaret.' : '', followConflict,
      (followDirty || followEdit) && !storageReady ? 'Browseren afviser kladdelagring; kopiér teksten før siden lukkes.' : ''].filter(Boolean).join(' ');
    taskDraftStatus.classList.toggle('v5-conflict', Boolean(taskConflict)); followDraftStatus.classList.toggle('v5-conflict', Boolean(followConflict));
  }
  function persistDrafts() {
    if (!localStorage.getItem('jarvisAccessToken')) return;
    const saved = { version: 1,
      task: taskEdit || taskDirty ? { edit: taskEdit, dirty: taskDirty, fields: captureFields(taskInputs()), windows: allowedWindows.raw() } : null,
      follow: followEdit || followDirty ? { edit: followEdit, dirty: followDirty, fields: captureFields(followInputs()) } : null,
      capacity: { fields: captureFields(capacityInputs()), extra: extraWindows.raw(), busy: busyWindows.raw(), previousProposals } };
    try {
      const serialized = JSON.stringify(saved); if (serialized.length > 150_000) throw new Error('Kladden er for stor.');
      sessionStorage.setItem(draftKey, serialized); storageReady = true;
    } catch { storageReady = false; }
  }
  function taskEditControls() {
    taskSubmit.textContent = taskEdit ? 'Gem ændringer' : 'Opret personlig opgave';
    taskCancel.hidden = !taskEdit && !taskDirty; taskReload.hidden = !taskEdit;
    taskFields['personal-task-state'].disabled = !taskEdit;
  }
  function followEditControls() {
    followSubmit.textContent = followEdit ? 'Gem opfølgning' : 'Opret opfølgning';
    byId('follow-up-awaiting').readOnly = Boolean(followEdit); byId('follow-up-stop').readOnly = Boolean(followEdit);
    followAdvanced.details.hidden = !followEdit; followCancel.hidden = !followEdit && !followDirty; followReload.hidden = !followEdit;
    for (const input of Object.values(followFields)) input.disabled = !followEdit;
  }
  function resetTask() {
    taskForm.reset(); taskEdit = null; taskDirty = false; taskConflict = ''; taskEpoch++;
    for (const input of taskInputs()) { delete input.dataset.originalInstant; delete input.dataset.originalLocal; }
    byId('personal-task-duration').value = '30'; taskFields['personal-task-uncertainty'].value = '0'; taskFields['personal-task-priority'].value = '2';
    allowedWindows.set([]); taskEditControls(); draftStatus();
  }
  function resetFollow() {
    followForm.reset(); followEdit = null; followDirty = false; followConflict = ''; followEpoch++;
    for (const input of followInputs()) { delete input.dataset.originalInstant; delete input.dataset.originalLocal; }
    followEditControls(); draftStatus();
  }
  function updateDependencies(selected = [...dependencyField.selectedOptions].map(item => item.value)) {
    if (document.activeElement === dependencyField) return;
    dependencyField.replaceChildren();
    for (const record of taskRecords.filter(item => item.id !== taskEdit?.id && item.status !== 'archived'))
      option(dependencyField, record.id, `${record.title}${record.status === 'completed' ? ' (afsluttet)' : ''}`);
    for (const id of selected) if (![...dependencyField.options].some(item => item.value === id)) option(dependencyField, id, `Utilgængelig afhængighed: ${id}`);
    for (const item of dependencyField.options) item.selected = selected.includes(item.value);
  }
  function editTask(record, discard = false) {
    if (taskDirty && !discard && !window.confirm('Kassér den nuværende ugemte opgavekladde?')) return;
    resetTask(); taskEdit = { id: record.id, revision: record.revision };
    byId('personal-task-title').value = record.title; byId('personal-task-purpose').value = record.purpose;
    byId('personal-task-duration').value = record.durationMinutes; setInstant(byId('personal-task-deadline'), record.deadline);
    const values = { 'personal-task-outcome': record.expectedOutcome || '', 'personal-task-uncertainty': record.durationUncertaintyMinutes || 0,
      'personal-task-priority': record.priority, 'personal-task-project': record.projectId || '', 'personal-task-state': record.status };
    for (const [id, value] of Object.entries(values)) taskFields[id].value = value;
    setInstant(taskFields['personal-task-earliest'], record.earliestStart);
    setInstant(taskFields['personal-task-planned'], record.lockedStart || record.plannedStart);
    setInstant(taskFields['personal-task-next-check'], record.nextFollowUpAt);
    taskFields['personal-task-locked'].checked = Boolean(record.lockedStart);
    updateDependencies(record.dependencies || []); allowedWindows.set(record.allowedWindows || []);
    taskAdvanced.details.open = true; taskEditControls(); draftStatus(); persistDrafts(); byId('personal-task-title').focus();
  }
  function editFollow(record, discard = false) {
    if (followDirty && !discard && !window.confirm('Kassér den nuværende ugemte opfølgningskladde?')) return;
    resetFollow(); followEdit = { id: record.id, revision: record.revision };
    byId('follow-up-awaiting').value = record.awaiting; byId('follow-up-stop').value = record.stopCondition;
    setInstant(byId('follow-up-check'), record.nextCheckAt); followFields['follow-observation-subject'].value = record.awaiting.slice(0, 240);
    followAdvanced.details.open = true; followEditControls(); draftStatus(); persistDrafts(); byId('follow-up-check').focus();
  }

  const focusCard = (target, id) => {
    const card = [...target.children].find(item => item.dataset.planKey === id) || target;
    card.tabIndex = -1; card.focus({ preventScroll: true });
  };
  async function refreshPersonalTasks(forceId = null) {
    const request = ++sequence.tasks, owner = ownerToken;
    const { tasks } = await api('/api/personal-tasks');
    if (request !== sequence.tasks || owner !== localStorage.getItem('jarvisAccessToken')) return;
    taskRecords = tasks;
    updateDependencies();
    if (taskEdit) {
      const latest = tasks.find(item => item.id === taskEdit.id);
      taskConflict = !latest || ['completed', 'archived'].includes(latest.status) ? 'Opgaven er afsluttet, arkiveret eller utilgængelig. Kladden er bevaret og bliver ikke en ny opgave.'
        : latest.revision !== taskEdit.revision ? 'Ændret et andet sted. Kladden bruger stadig sin oprindelige revision; gennemgå og hent nyeste før gemning.' : '';
    }
    draftStatus();
    const target = byId('personal-task-list');
    JarvisPlan.syncCards(target, tasks.filter(item => item.status !== 'archived'), { forceId,
      emptyText: 'Ingen personlige opgaver endnu.', render: task => {
      const card = node('article', 'v5-record-card');
      card.dataset.personalTaskId = task.id;
      card.append(node('h3', '', task.title));
      label(card, 'Status', ({ pending: 'Afventer', in_progress: 'I gang', blocked: 'Blokeret',
        completed: 'Afsluttet' })[task.status] || task.status);
      label(card, 'Formål', task.purpose);
      if (task.expectedOutcome) label(card, 'Forventet resultat', task.expectedOutcome);
      label(card, 'Tid', `${task.durationMinutes} min. + ${task.durationUncertaintyMinutes || 0} min. usikkerhed · deadline ${dateText(task.deadline)}`);
      if (task.lockedStart || task.plannedStart) label(card, task.lockedStart ? 'Låst lokal placering' : 'Valgt lokal placering', dateText(task.lockedStart || task.plannedStart));
      if (task.earliestStart) label(card, 'Tidligste start', dateText(task.earliestStart));
      if (task.dependencies.length) label(card, 'Afhængigheder', task.dependencies.map(id => taskRecords.find(item => item.id === id)?.title || id).join(', '));
      if (task.allowedWindows?.length) label(card, 'Tilladte tidsvinduer', task.allowedWindows.map(item => `${dateText(item.start)} – ${dateText(item.end)}`).join(' · '));
      if (task.nextFollowUpAt) label(card, 'Næste opfølgning', dateText(task.nextFollowUpAt));
      label(card, 'Grundlag', `${task.source?.kind || 'user'} · revision ${task.revision}. En plan er ikke bevis på udførelse.`);
      const actions = node('div', 'v5-record-actions');
      if (task.status !== 'completed') actions.append(button('Redigér opgave', () => editTask(task)), button('Markér afsluttet', async () => {
        await post(`/api/personal-tasks/${task.id}/complete`, 'POST', { expectedRevision: task.revision });
        errorStatus('personal-task-status', 'Opgaven er markeret afsluttet.');
        await refreshPersonalTasks(task.id);
      }));
      actions.append(button('Arkivér', async () => {
        await post(`/api/personal-tasks/${task.id}/archive`, 'POST', { expectedRevision: task.revision });
        errorStatus('personal-task-status', 'Opgaven er arkiveret.');
        await refreshPersonalTasks(task.id);
      }, true));
      card.append(actions);
      return card;
    } });
    if (forceId) focusCard(target, forceId);
  }

  async function refreshFollowUps(forceId = null) {
    const request = ++sequence.follow, owner = ownerToken;
    const result = await api('/api/follow-ups');
    if (request !== sequence.follow || owner !== localStorage.getItem('jarvisAccessToken')) return;
    followRecords = result.cases;
    if (followEdit) {
      const latest = followRecords.find(item => item.id === followEdit.id);
      followConflict = !latest || latest.status !== 'open' ? 'Sagen er lukket eller utilgængelig. Kladden er bevaret og opretter ikke en ny sag.'
        : latest.revision !== followEdit.revision ? 'Ændret et andet sted. Kladden bruger stadig sin oprindelige revision; gennemgå og hent nyeste før gemning.' : '';
    }
    draftStatus();
    const target = byId('follow-up-list');
    JarvisPlan.syncCards(target, followRecords.filter(item => item.status === 'open'), { forceId,
      emptyText: 'Ingen åbne opfølgningssager.', render: record => {
      const card = node('article', 'v5-record-card');
      card.dataset.followUpId = record.id;
      card.append(node('h3', '', record.awaiting));
      label(card, 'Næste tjek', dateText(record.nextCheckAt));
      label(card, 'Stopbetingelse', record.stopCondition);
      label(card, 'Observationer', `${record.observations.length}`);
      label(card, 'Kilde', `${record.source.kind} · ${record.source.id} · revision ${record.revision}`);
      for (const observation of record.observations.slice(0, 3)) label(card,
        ({ changed: 'Ændret', unchanged: 'Uændret', unknown: 'Ukendt' })[observation.status],
        `${observation.subject}: ${observation.value ?? 'ingen sikker værdi'} · ${observation.source} · ${dateText(observation.observedAt)}`);
      const actions = node('div', 'v5-record-actions');
      actions.append(button('Udskyd / registrér observation', () => editFollow(record), false, 'follow-up-status'));
      actions.append(button('Afslut sag', async () => {
        await post(`/api/follow-ups/${record.id}`, 'PATCH', { expectedRevision: record.revision, action: 'complete' });
        errorStatus('follow-up-status', 'Sagen er afsluttet.');
        await refreshFollowUps(record.id);
      }, false, 'follow-up-status'));
      actions.append(button('Annullér sag', async () => {
        await post(`/api/follow-ups/${record.id}`, 'PATCH', { expectedRevision: record.revision, action: 'cancel' });
        errorStatus('follow-up-status', 'Sagen er annulleret. Historikken er bevaret.');
        await refreshFollowUps(record.id);
      }, true, 'follow-up-status'));
      card.append(actions);
      return card;
    } });
    if (forceId) focusCard(target, forceId);
  }

  async function refreshClaims(forceId = null) {
    const request = ++sequence.claims, owner = ownerToken;
    const result = await api('/api/personal-claims');
    if (request !== sequence.claims || owner !== localStorage.getItem('jarvisAccessToken')) return;
    const target = byId('claim-list');
    const records = [...result.conflicts.map((conflict, index) => ({ ...conflict, id: `conflict-${index}`, conflict: true })),
      ...result.claims.filter(item => item.status !== 'archived').slice(-50).reverse()];
    JarvisPlan.syncCards(target, records, { forceId, emptyText: 'Ingen oplysninger oprettet.', render: claim => {
      if (claim.conflict) return node('p', 'v5-conflict', `Konflikt om ${claim.subject}: ${claim.claims.map(x => x.value).join(' / ')}. Gennemgå oplysningerne.`);
      const card = node('article', 'v5-record-card');
      card.dataset.claimId = claim.id;
      card.append(node('h3', '', claim.subject));
      label(card, 'Indhold', claim.value);
      label(card, 'Status', ({ proposed: 'Forslag (ikke bekræftet)', confirmed: 'Bekræftet af dig',
        superseded: 'Erstattet' })[claim.status] || claim.status);
      label(card, 'Kilde', `${claim.source.kind} · ${claim.source.channel}`);
      if (claim.expiresAt) label(card, 'Gyldig til', dateText(claim.expiresAt));
      const actions = node('div', 'v5-record-actions');
      if (claim.status === 'proposed') actions.append(button('Bekræft oplysning', async () => {
        await decideClaim(claim, 'confirm');
      }, false, 'claim-status'));
      actions.append(button('Arkivér', async () => decideClaim(claim, 'archive'), true, 'claim-status'));
      card.append(actions);
      return card;
    } });
    if (forceId) focusCard(target, forceId);
  }

  async function decideClaim(claim, decision) {
    await api(`/api/personal-claims/${claim.id}/${decision}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: claim.revision }) });
    errorStatus('claim-status', decision === 'confirm' ? 'Oplysningen er bekræftet.' : 'Oplysningen er arkiveret.');
    await refreshClaims(claim.id);
  }

  byId('personal-task-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    let saved = false;
    const epoch = taskEpoch, owner = ownerToken;
    const snapshot = () => JSON.stringify({ fields: captureFields(taskInputs()), windows: allowedWindows.raw() });
    const submitted = snapshot();
    try {
      const plannedStart = localInstant(taskFields['personal-task-planned']);
      if (taskFields['personal-task-locked'].checked && !plannedStart) throw new Error('Angiv et starttidspunkt, før opgaven låses.');
      const payload = { title: byId('personal-task-title').value, purpose: byId('personal-task-purpose').value,
        durationMinutes: Number(byId('personal-task-duration').value), deadline: localInstant('personal-task-deadline'),
        expectedOutcome: taskFields['personal-task-outcome'].value,
        durationUncertaintyMinutes: Number(taskFields['personal-task-uncertainty'].value), priority: Number(taskFields['personal-task-priority'].value),
        earliestStart: localInstant(taskFields['personal-task-earliest']), plannedStart,
        lockedStart: taskFields['personal-task-locked'].checked ? plannedStart : null,
        nextFollowUpAt: localInstant(taskFields['personal-task-next-check']), projectId: taskFields['personal-task-project'].value || null,
        dependencies: [...dependencyField.selectedOptions].map(item => item.value), allowedWindows: allowedWindows.read(),
        ...(taskEdit ? { expectedRevision: taskEdit.revision, status: taskFields['personal-task-state'].value } : {}) };
      const result = await post(taskEdit ? `/api/personal-tasks/${taskEdit.id}` : '/api/personal-tasks', taskEdit ? 'PATCH' : 'POST', payload);
      saved = true;
      if (owner !== localStorage.getItem('jarvisAccessToken')) return;
      if (epoch === taskEpoch) {
        if (submitted === snapshot()) resetTask();
        else { taskEdit = { id: result.task.id, revision: result.task.revision }; taskDirty = true; taskEditControls(); }
      }
      persistDrafts(); draftStatus();
      errorStatus('personal-task-status', 'Opgaven er gemt lokalt. Ingen kalenderaftale er oprettet.');
      await refreshPersonalTasks();
    } catch (error) { errorStatus('personal-task-status', saved ? `Opgaven er gemt, men oversigten kunne ikke opdateres: ${error.message}`
      : `Gemning er ikke bekræftet: ${error.message}. Kladden er bevaret. Kontrollér oversigten før et nyt forsøg.`, true); }
    finally { submit.disabled = false; }
  });

  byId('follow-up-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    let saved = false;
    const epoch = followEpoch, owner = ownerToken;
    const submitted = JSON.stringify(captureFields(followInputs()));
    try {
      const nextCheckAt = localInstant('follow-up-check');
      let payload;
      if (followEdit) {
        const status = observationStatus.value;
        payload = { expectedRevision: followEdit.revision, action: status ? 'observe' : 'snooze', nextCheckAt };
        if (status) {
          const subject = followFields['follow-observation-subject'].value.trim(), source = followFields['follow-observation-source'].value.trim();
          if (!subject || !source) throw new Error('Observationen kræver både emne og kilde.');
          payload.observation = { status, subject, source, value: followFields['follow-observation-value'].value || null };
        }
      } else payload = { awaiting: byId('follow-up-awaiting').value, nextCheckAt,
        stopCondition: byId('follow-up-stop').value, source: { kind: 'user', id: 'manual' } };
      const result = await post(followEdit ? `/api/follow-ups/${followEdit.id}` : '/api/follow-ups', followEdit ? 'PATCH' : 'POST', payload);
      saved = true;
      if (owner !== localStorage.getItem('jarvisAccessToken')) return;
      if (epoch === followEpoch) {
        if (submitted === JSON.stringify(captureFields(followInputs()))) resetFollow();
        else { followEdit = { id: result.case.id, revision: result.case.revision }; followDirty = true; followEditControls(); }
      }
      persistDrafts(); draftStatus();
      errorStatus('follow-up-status', 'Opfølgningen er gemt. Ingen job eller besked til andre er aktiveret.');
      await refreshFollowUps();
    } catch (error) { errorStatus('follow-up-status', saved ? `Opfølgningen er gemt, men oversigten kunne ikke opdateres: ${error.message}`
      : `Gemning er ikke bekræftet: ${error.message}. Kladden er bevaret. Kontrollér oversigten før et nyt forsøg.`, true); }
    finally { submit.disabled = false; }
  });

  byId('personal-claim-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/personal-claims', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: byId('claim-subject').value, value: byId('claim-value').value,
          category: byId('claim-category').value }) });
      form.reset();
      errorStatus('claim-status', 'Forslaget er gemt. Bekræft det efter gennemgang.');
      await refreshClaims();
    } catch (error) { errorStatus('claim-status', `Ikke gemt: ${error.message}`, true); }
    finally { submit.disabled = false; }
  });

  byId('capacity-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
    const owner = ownerToken, version = capacityVersion, request = ++simulationSequence;
    for (const control of byId('capacity-results').querySelectorAll('button')) control.disabled = true;
    try {
      const start = localInstant('capacity-start'), end = localInstant('capacity-end');
      if (!start || !end || end <= start) throw new Error('Sluttid skal være efter starttid.');
      const useCalendar = byId('capacity-reviewed').checked;
      const workWindows = [{ start, end }, ...extraWindows.read()];
      const calendarEvents = busyWindows.read().map((window, index) => ({ ...window, source: { kind: 'user-reviewed', id: `manual-${index + 1}` } }));
      if (useCalendar && calendarEvents.length) throw new Error('Vælg manuel gennemgang for de indtastede aftaler, eller fjern dem før Google Kalender bruges. Ingen indtastede aftaler ignoreres lydløst.');
      const starts = workWindows.map(window => window.start).sort(), ends = workWindows.map(window => window.end).sort();
      const calendarCoverage = !useCalendar && manualReview.checked
        ? { status: 'ready', start: starts[0], end: ends.at(-1), source: 'explicit-owner-review' } : { status: 'unknown' };
      const { plan, basis } = await post('/api/planning/simulate', 'POST', { timeZone: JarvisPlan.timeZone, useCalendar,
        workWindows, calendarEvents, calendarCoverage, bufferMinutes: Number(capacityFields['capacity-buffer'].value), previousProposals });
      if (owner !== localStorage.getItem('jarvisAccessToken')) return;
      const choices = new Map(previousProposals.map(proposal => [proposal.taskId, proposal]));
      for (const { taskId, start, end } of plan.proposals) choices.set(taskId, { taskId, start, end });
      previousProposals = [...choices.values()].slice(-250);
      const stale = capacityVersion !== version;
      if (!stale) capacityDirty = false;
      persistDrafts();
      const target = byId('capacity-results');
      target.replaceChildren();
      errorStatus('capacity-status', stale ? 'Rammerne blev ændret under beregningen. Resultatet er forældet og kan ikke gemmes; gennemgå og beregn igen.'
        : plan.feasible ? 'Forslaget kan placeres inden for de angivne rammer. Ingen aftaler er oprettet.'
        : 'Der mangler oplysninger, eller tidsrammerne kan ikke overholdes.', !plan.feasible);
      if (basis) target.append(node('p', 'muted small-text', `Grundlag: ${basis}.`));
      for (const proposal of plan.proposals) {
        const card = node('article', 'v5-record-card');
        card.dataset.proposedTaskId = proposal.taskId;
        card.append(node('h3', '', proposal.title), node('p', '', `${dateText(proposal.start)} – ${dateText(proposal.end)}`));
        label(card, 'Placering', ({ locked: 'Låst valg bevaret', preserved: 'Tidligere valg bevaret', moved: 'Berørt valg flyttet', new: 'Nyt forslag' })[proposal.placement] || 'Forslag');
        if (proposal.previousStart && proposal.previousStart !== proposal.start) label(card, 'Tidligere', dateText(proposal.previousStart));
        if (proposal.reservedUntil && proposal.reservedUntil !== proposal.end) label(card, 'Reserveret til', `${dateText(proposal.reservedUntil)} (inklusive usikkerhed og buffer)`);
        card.append(node('p', 'small-text', proposal.explanation));
        const actions = node('div', 'v5-record-actions');
        const savePlacement = async lock => {
          if (capacityVersion !== version || simulationSequence !== request) throw new Error('Planforslaget er forældet. Gennemgå kapaciteten og beregn igen.');
          if (!proposal.source || proposal.source.kind !== 'personal-task' || !Number.isInteger(proposal.source.revision))
            throw new Error('Forslaget mangler en opgaverevision. Beregn et nyt forslag.');
          if (taskEdit?.id === proposal.taskId) throw new Error('Afslut redigeringen af denne opgave før et planforslag gemmes. Din kladde er bevaret.');
          await post(`/api/personal-tasks/${proposal.taskId}`, 'PATCH', { expectedRevision: proposal.source.revision,
            plannedStart: proposal.start, ...(lock ? { lockedStart: proposal.start } : {}) });
          for (const control of actions.querySelectorAll('button')) control.disabled = true;
          actions.replaceChildren(node('p', 'muted', lock ? 'Placeringen er gemt og låst lokalt.' : 'Placeringen er gemt lokalt.'));
          errorStatus('capacity-status', 'Dit valg er gemt lokalt. Ingen kalenderaftale er oprettet. Beregn igen ved ændrede rammer.');
          await refreshPersonalTasks();
        };
        actions.append(button('Gem placering lokalt', () => savePlacement(false), false, 'capacity-status'));
        if (!proposal.locked) actions.append(button('Gem og lås placering', () => savePlacement(true), false, 'capacity-status'));
        if (stale) for (const control of actions.querySelectorAll('button')) control.disabled = true;
        card.append(actions);
        target.append(card);
      }
      for (const conflict of plan.conflicts) target.append(node('p', 'v5-conflict', conflict.explanation || conflict.code));
      for (const alternative of plan.alternatives || []) target.append(node('p', 'muted small-text', `Mulighed: ${alternative}`));
    } catch (error) { errorStatus('capacity-status', `${error.message} Tidligere viste forslag kan være forældede; beregn igen før gemning.`, true); }
    finally { submit.disabled = false; }
  });

  function clearLocalPlanning() {
    for (const key of Object.keys(sequence)) sequence[key]++;
    resetTask(); resetFollow(); capacityForm.reset();
    capacityFields['capacity-buffer'].value = '0'; extraWindows.set([]); busyWindows.set([]);
    for (const input of capacityInputs()) { delete input.dataset.originalInstant; delete input.dataset.originalLocal; }
    previousProposals = []; taskRecords = []; followRecords = []; capacityDirty = false; capacityVersion++; simulationSequence++;
    dependencyField.replaceChildren(); ownerToken = '';
    for (const id of ['personal-task-list', 'follow-up-list', 'capacity-results', 'claim-list']) byId(id).replaceChildren();
    for (const id of ['personal-task-status', 'follow-up-status', 'capacity-status', 'claim-status']) errorStatus(id, '');
    try { sessionStorage.removeItem(draftKey); } catch { /* The signed-out page does not display saved drafts. */ }
  }
  const refresh = async () => {
    const current = localStorage.getItem('jarvisAccessToken');
    if (!current) return;
    if (ownerToken !== current) { clearLocalPlanning(); ownerToken = current; }
    await Promise.allSettled([
      refreshPersonalTasks().catch(error => errorStatus('personal-task-status', `Oversigten kunne ikke opdateres: ${error.message}. Kladden er bevaret.`, true)),
      refreshFollowUps().catch(error => errorStatus('follow-up-status', `Oversigten kunne ikke opdateres: ${error.message}. Kladden er bevaret.`, true)),
      refreshClaims().catch(error => errorStatus('claim-status', `Oversigten kunne ikke opdateres: ${error.message}`, true)),
    ]);
  };
  for (const type of ['input', 'change']) {
    taskForm.addEventListener(type, markTaskDirty); followForm.addEventListener(type, markFollowDirty);
    capacityForm.addEventListener(type, markCapacityDirty);
  }
  repeatedTime.addEventListener('change', event => { markCapacityDirty(event); draftStatus(); });
  byId('logout').addEventListener('click', clearLocalPlanning);
  window.addEventListener('beforeunload', event => {
    if (!storageReady && (taskDirty || followDirty || capacityDirty)) { event.preventDefault(); event.returnValue = ''; }
  });
  taskEditControls(); followEditControls();
  try {
    if (ownerToken) {
      const raw = sessionStorage.getItem(draftKey);
      if (raw && raw.length <= 150_000) {
        const saved = JSON.parse(raw);
        const edit = value => value && typeof value.id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value.id) &&
          Number.isInteger(value.revision) && value.revision > 0 ? { id: value.id, revision: value.revision } : null;
        if (saved.version === 1) {
          if (saved.task) {
            taskEdit = edit(saved.task.edit); taskDirty = saved.task.dirty === true; restoreFields(taskInputs(), saved.task.fields);
            allowedWindows.set(Array.isArray(saved.task.windows) ? saved.task.windows.slice(0, 30) : []);
            taskAdvanced.details.open = Boolean(taskEdit); taskEditControls();
            errorStatus('personal-task-status', 'Opgavekladde gendannet i denne fane. Gennemgå før gemning.');
          }
          if (saved.follow) {
            followEdit = edit(saved.follow.edit); followDirty = saved.follow.dirty === true; restoreFields(followInputs(), saved.follow.fields);
            followAdvanced.details.open = Boolean(followEdit); followEditControls();
            errorStatus('follow-up-status', 'Opfølgningskladde gendannet i denne fane. Gennemgå før gemning.');
          }
          if (saved.capacity) {
            restoreFields(capacityInputs(), saved.capacity.fields);
            extraWindows.set(Array.isArray(saved.capacity.extra) ? saved.capacity.extra.slice(0, 30) : []);
            busyWindows.set(Array.isArray(saved.capacity.busy) ? saved.capacity.busy.slice(0, 30) : []);
            previousProposals = Array.isArray(saved.capacity.previousProposals) ? saved.capacity.previousProposals.slice(0, 250)
              .filter(value => typeof value?.taskId === 'string' && value.taskId.length <= 100 &&
                typeof value.start === 'string' && value.start.length <= 40 && typeof value.end === 'string' && value.end.length <= 40)
              .map(({ taskId, start, end }) => ({ taskId, start, end })) : [];
            // A prior manual review is not a fresh statement about capacity.
            manualReview.checked = false;
            if (byId('capacity-start').value) errorStatus('capacity-status', 'Tidsrum gendannet. Gennemgå kapaciteten igen og beregn et nyt forslag; ingen ændringer er gemt automatisk.');
          }
          draftStatus();
        }
      }
    } else sessionStorage.removeItem(draftKey);
  } catch { storageReady = false; draftStatus(); }
  document.addEventListener('jarvis:refreshed', refresh);
  document.addEventListener('jarvis:v5-sources-changed', event => {
    const pending = refresh();
    if (typeof event.detail?.waitUntil === 'function') event.detail.waitUntil(pending);
  });
  if (localStorage.getItem('jarvisAccessToken')) refresh();
})();
