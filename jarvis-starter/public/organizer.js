// Command Center og private lister. Bruger app.js' api() og selectTab().
const collectionNames = { dates: 'Vigtige datoer', gifts: 'Gaveidéer', shopping: 'Indkøb', notes: 'Noter', list: 'Liste' };
const organizerRoot = document.getElementById('collection-list');
let organizerLoadInProgress = false;
let commandLoadInProgress = false;

function make(tag, textValue = '', css = '') {
  const node = document.createElement(tag);
  if (textValue) node.textContent = textValue;
  if (css) node.className = css;
  return node;
}

function dateText(value) {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  return `${d}.${m}.${y}`;
}

function commandPanel(title, css = '') {
  const section = make('section', '', `panel command-panel ${css}`);
  section.append(make('h2', title));
  return section;
}

function commandLink(label, tab) {
  const link = make('button', label, 'secondary compact-button');
  link.type = 'button';
  link.addEventListener('click', () => selectTab(tab));
  return link;
}

function renderPersonalAgenda(agenda, digests = []) {
  const root = document.getElementById('home-intelligence');
  if (!root) return;
  root.replaceChildren();
  const groups = [
    { title: 'I dag', subtitle: 'Aktuelt og snart planlagt', items: agenda.today, tab: 'organizer', empty: 'Ingen registrerede datoer i dag eller opgaver inden for 36 timer.' },
    { title: 'Næste 7 dage', subtitle: 'Datoer fra dine egne lister', items: agenda.week, tab: 'organizer', empty: 'Ingen kommende datoer registreret.' },
    { title: 'Kræver opmærksomhed', subtitle: 'Faktiske ændringer og afventninger', items: agenda.insights, tab: 'secretary', empty: 'Ingen kendte forhold, der kræver opfølgning.' },
  ];
  for (const group of groups) {
    const card = make('section', '', 'intelligence-card');
    card.append(make('span', group.subtitle, 'tiny-label'), make('h2', group.title));
    if (!group.items.length) card.append(make('p', group.empty, 'muted small-text'));
    for (const item of group.items.slice(0, 4)) {
      const entry = make('button', '', 'agenda-item');
      entry.type = 'button'; entry.addEventListener('click', () => selectTab(item.tab || group.tab));
      entry.append(make('span', item.priority === 'high' ? '●' : '·', item.priority === 'high' ? 'agenda-priority high' : 'agenda-priority'));
      const content = make('span', '', 'agenda-content');
      content.append(make('strong', item.title), make('span', item.detail, 'muted micro'));
      entry.append(content); card.append(entry);
    }
    card.append(commandLink('Vis grundlag', group.tab));
    root.append(card);
  }
  if (digests.length) {
    const newest = digests[0];
    const note = make('p', `Seneste faktabaserede ${newest.kind === 'weekly' ? 'uge-' : 'dags'}overblik: ${new Date(newest.at).toLocaleString('da-DK')} · ${newest.itemCount} punkter`, 'agenda-history muted micro');
    root.append(note);
  }
}

function renderCommandCenter(data) {
  if (data.agenda) renderPersonalAgenda(data.agenda, data.recentDigests);
  const root = document.getElementById('home-feed');
  root.replaceChildren();
  const briefing = commandPanel('📰 Seneste morgenrapport', 'feature-panel');
  if (data.briefing) {
    briefing.append(make('p', `${data.briefing.taskTitle} · ${new Date(data.briefing.at).toLocaleString('da-DK')}`, 'muted small-text'));
    const preview = data.briefing.result.slice(0, 380);
    briefing.append(make('p', preview + (data.briefing.result.length > 380 ? ' …' : ''), 'briefing-preview'));
    const details = make('details');
    details.append(make('summary', 'Læs hele rapporten'), make('pre', data.briefing.result, 'command-result'));
    briefing.append(details);
  } else briefing.append(make('p', 'Ingen færdig morgenrapport endnu.', 'muted'));
  briefing.append(commandLink('Åbn opgaver', 'tasks'));
  root.append(briefing);

  const attention = commandPanel('✦ JARVIS foreslår', 'attention-panel');
  if (!data.suggestions.length) attention.append(make('p', 'Ingen aktuelle forhold kræver opmærksomhed ud fra dine gemte data.', 'muted small-text'));
  for (const suggestion of data.suggestions) {
    const block = make('div', '', 'command-entry');
    block.append(make('strong', suggestion.title), make('p', suggestion.detail, 'muted small-text'));
    block.append(commandLink('Se grundlag', suggestion.tab));
    attention.append(block);
  }
  attention.append(make('p', 'Forslagene bygger på gemte datoer, opgavestatus, overvågninger og godkendelser – ikke på antagelser.', 'command-evidence'));
  root.append(attention);

  const dates = commandPanel('🎁 Kommende datoer');
  if (!data.upcoming.length) dates.append(make('p', 'Ingen kommende datoer registreret. Tilføj en fødselsdag eller årsdag.', 'muted small-text'));
  for (const item of data.upcoming.slice(0, 5)) {
    const line = make('div', '', 'command-row');
    line.append(make('strong', item.title), make('span', `${item.daysUntil === 0 ? 'I dag' : `Om ${item.daysUntil} dage`} · ${dateText(item.date)}`));
    dates.append(line);
  }
  dates.append(commandLink('Åbn noter og lister', 'organizer')); root.append(dates);

  const inbox = commandPanel('🔔 Indbakke og godkendelser');
  for (const item of data.unseen.slice(0, 3)) {
    const line = make('div', '', 'command-entry');
    line.append(make('strong', item.title), make('span', `${new Date(item.at).toLocaleString('da-DK')} · Ny besked`, 'micro muted'));
    inbox.append(line);
  }
  for (const item of data.awaiting.slice(0, 3)) inbox.append(make('p', `Afventer godkendelse: ${item.title}`, 'command-warning'));
  if (!data.unseen.length && !data.awaiting.length) inbox.append(make('p', 'Indbakken er ajour.', 'muted small-text'));
  inbox.append(commandLink('Åbn sekretær', 'secretary')); root.append(inbox);

  const monitor = commandPanel('👀 Overvågninger');
  if (data.monitor) {
    monitor.append(make('strong', data.monitor.taskTitle));
    monitor.append(make('p', `${new Date(data.monitor.at).toLocaleString('da-DK')} · seneste registrerede ændring`, 'muted small-text'));
    const detail = make('details'); detail.append(make('summary', 'Se observation'), make('pre', data.monitor.result, 'command-result'));
    monitor.append(detail);
  } else monitor.append(make('p', 'Ingen dokumenterede ændringer i dine afsluttede overvågninger endnu.', 'muted small-text'));
  monitor.append(commandLink('Alle overvågninger', 'tasks')); root.append(monitor);

  const tasks = commandPanel('◷ Næste opgaver');
  for (const task of data.next) tasks.append(make('p', `${task.title} · ${new Date(task.nextRunAt).toLocaleString('da-DK')}`, 'small-text'));
  if (!data.next.length) tasks.append(make('p', 'Ingen opgaver planlagt.', 'muted small-text'));
  tasks.append(commandLink('Administrér opgaver', 'tasks')); root.append(tasks);

  const projects = commandPanel('⌘ Projektstatus');
  for (const project of data.projects) {
    const label = project.lastTest?.status === 'passed' ? 'Test bestået' : project.lastTest?.status === 'failed' ? 'Test fejlet' : 'Ingen nyere test';
    projects.append(make('p', `${project.title} · v${project.revision} · ${label}`, 'small-text'));
  }
  if (!data.projects.length) projects.append(make('p', 'Ingen aktive kodeprojekter.', 'muted small-text'));
  projects.append(commandLink('Åbn projekter', 'projects')); root.append(projects);
}

// Existing lists are deliberately reconciled in place: a poll is not an edit.
// Each editor retains its captured updatedAt until an explicit reload or its own
// acknowledged write. A newer server record never silently rebases a local draft.
const organizerDraftKey = 'jarvis:v5:organizer-drafts';
const organizerCards = new Map();
let organizerReadPromise = null;
let organizerReadVersion = 0;
let organizerSession = 0;
let organizerOwner = localStorage.getItem('jarvisAccessToken') || '';
let organizerStorageAvailable = true;
let organizerSecretDraft = false;
let organizerRestored = { collections: {}, items: {} };
const organizerCreate = { form: document.getElementById('collection-form'), busy: false, uncertain: false };
const organizerSearch = document.getElementById('organizer-search');
const organizerTitle = document.getElementById('collection-title');
const organizerType = document.getElementById('collection-type');
const organizerQuery = document.getElementById('organizer-query');

function organizerVisible(view) {
  const root = document.getElementById('tab-' + view);
  return Boolean(root && !root.hidden && !root.classList.contains('hidden'));
}
function organizerAuthenticated() { return Boolean(localStorage.getItem('jarvisAccessToken')); }
function organizerStatus(parent, id = '') {
  const status = make('p', '', 'organizer-record-status muted small-text');
  if (id) status.id = id;
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  parent.append(status); return status;
}
const organizerStatusLine = organizerStatus(organizerRoot.parentNode, 'organizer-status');
const organizerDraftStatus = organizerStatus(organizerCreate.form.parentNode, 'organizer-draft-status');
organizerCreate.status = organizerStatus(organizerCreate.form, 'organizer-create-status');
const organizerSearchStatus = organizerStatus(organizerSearch, 'organizer-search-status');
function organizerReport(view, message, error = false) {
  view.status.textContent = message;
  view.status.classList.toggle('v5-conflict', error);
  view.error = error;
}
function organizerButton(label, action, css = 'secondary compact-button') {
  const button = make('button', label, css); button.type = 'button';
  button.addEventListener('click', action); return button;
}
function organizerInput(parent, label, name, value = '', type = 'text', prefix = '') {
  const title = make('label', label), input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  input.id = 'organizer-' + prefix + '-' + name; input.name = name;
  title.htmlFor = input.id;
  if (type !== 'textarea') input.type = type;
  else { input.rows = 2; input.maxLength = 2500; }
  if (type === 'checkbox') input.checked = Boolean(value); else input.value = value || '';
  if (type === 'text') input.maxLength = name === 'title' ? 100 : 350;
  if (type === 'checkbox') {
    title.textContent = ''; title.className = 'inline-check';
    title.append(input, document.createTextNode(' ' + label)); parent.append(title);
  } else parent.append(title, input);
  return input;
}
function organizerFields(form, prefix, initial = {}) {
  return {
    text: organizerInput(form, 'Titel', 'text', initial.text, 'text', prefix),
    notes: organizerInput(form, 'Beskrivelse / note', 'notes', initial.notes, 'textarea', prefix),
    date: organizerInput(form, 'Dato (valgfri)', 'date', initial.date, 'date', prefix),
    annual: organizerInput(form, 'Gentag hvert år', 'annual', initial.annual, 'checkbox', prefix),
  };
}
function organizerReadFields(fields) {
  return { text: fields.text.value, notes: fields.notes.value, date: fields.date.value, annual: fields.annual.checked };
}
function organizerWriteFields(fields, value = {}) {
  fields.text.value = value.text || ''; fields.notes.value = value.notes || '';
  fields.date.value = value.date || ''; fields.annual.checked = Boolean(value.annual);
}
function organizerEditable(item = {}) {
  return { text: item.text || '', notes: item.notes || '', date: item.date || '', annual: Boolean(item.annual) };
}
function organizerEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function organizerItemDirty(view) { return !organizerEqual(organizerReadFields(view.fields), organizerEditable(view.base)); }
function organizerAddDirty(view) { return !organizerEqual(organizerReadFields(view.add.fields), organizerEditable()); }
function organizerRenameDirty(view) { return view.rename.input.value !== view.rename.base.title; }
function organizerKeepItem(view) {
  return organizerItemDirty(view) || view.edit.open || view.busy || view.uncertain || view.conflict || view.row.contains(document.activeElement);
}
function organizerKeepCollection(view) {
  return organizerRenameDirty(view) || organizerAddDirty(view) || view.rename.details.open || view.busy || view.add.busy ||
    view.uncertain || view.add.uncertain || view.card.contains(document.activeElement) || [...view.items.values()].some(organizerKeepItem);
}
// Browser draft storage is not a credential store. This conservative screen is
// intentionally independent of network calls; the server enforces its own shared
// privacy boundary. No auth token or settings object is ever serialized here.
function organizerHasSecret(value) {
  return /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:Authorization\s*:\s*Bearer|api[_ -]?key|api-nøgle|password|passwd|adgangskode|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*["']?\s*(?:[=:]|\s)\s*\S+/iu.test(JSON.stringify(value));
}
function organizerStorageNotice() {
  organizerDraftStatus.textContent = !organizerStorageAvailable
    ? 'Fanens kladde kan ikke gemmes lokalt. Lad siden være åben, indtil dine ændringer er gemt eller kopieret.'
    : organizerSecretDraft
      ? 'En kladde ligner en adgangskode eller nøgle og gemmes derfor ikke i browserlageret. Fjern hemmeligheden før genindlæsning.'
      : '';
  organizerDraftStatus.classList.toggle('v5-conflict', !organizerStorageAvailable || organizerSecretDraft);
}
function organizerPersist() {
  if (!organizerAuthenticated() || organizerOwner !== localStorage.getItem('jarvisAccessToken')) return;
  organizerSecretDraft = false;
  const safe = value => { if (organizerHasSecret(value)) { organizerSecretDraft = true; return null; } return value; };
  // An input may arrive before the first GET completes. Do not erase restored
  // drafts that have not yet been reconciled into their editor nodes.
  const snapshot = { version: 1, collections: { ...organizerRestored.collections }, items: { ...organizerRestored.items } };
  if (organizerTitle.value || organizerType.value !== 'dates' || organizerCreate.uncertain)
    snapshot.create = safe({ title: organizerTitle.value, type: organizerType.value, uncertain: organizerCreate.uncertain });
  if (organizerQuery.value) snapshot.query = safe(organizerQuery.value);
  for (const view of organizerCards.values()) {
    if (organizerKeepCollection(view)) {
      snapshot.collections[view.id] = safe({ id: view.id, title: view.latest.title, type: view.latest.type,
        updatedAt: view.latest.updatedAt, missing: view.missing, rename: { title: view.rename.input.value,
          base: view.rename.base, open: view.rename.details.open, uncertain: view.uncertain },
        add: { fields: organizerReadFields(view.add.fields), uncertain: view.add.uncertain } });
    }
    for (const item of view.items.values()) if (organizerKeepItem(item))
      snapshot.items[view.id + ':' + item.id] = safe({ id: item.id, collectionId: view.id,
        base: item.base, fields: organizerReadFields(item.fields), open: item.edit.open, uncertain: item.uncertain });
  }
  try {
    const text = JSON.stringify(snapshot);
    if (text.length > 1_000_000) throw new Error('Kladderne fylder for meget i browserlageret.');
    sessionStorage.setItem(organizerDraftKey, text); organizerStorageAvailable = true;
  } catch { organizerStorageAvailable = false; }
  organizerStorageNotice();
}
function organizerDraftChanged(view) {
  if (!view.error && !view.conflict && !view.uncertain)
    organizerReport(view, 'Ugemte ændringer. Kladden bevares i denne fane.');
  organizerPersist();
}
function organizerUnknown(error) {
  return !Number.isInteger(error?.status) || error.status >= 500 ||
    /ukendt|kan være udført|kan være gemt|lagerets seneste udfald|runtime-konfigurationen/iu.test(error.message || '');
}
function organizerControls(view) {
  const blocked = view.busy || view.missing || view.conflict || view.uncertain;
  for (const control of view.actions || []) control.disabled = Boolean(blocked);
  if (view.review) view.review.hidden = !view.uncertain;
  if (view.reload) { view.reload.hidden = !view.conflict && !view.missing && !view.error; view.reload.disabled = Boolean(view.busy); }
}
async function organizerReviewUnknown(view) {
  if (view.busy || !view.uncertain) return;
  try {
    await refreshOrganizer();
    if (!confirm('Gennemgå først den opdaterede liste. Er du sikker på, at ændringen ikke allerede er gemt? Et nyt forsøg kan ellers oprette en dublet.')) return;
    view.uncertain = false; organizerControls(view);
    organizerReport(view, 'Du har kontrolleret resultatet. Kladden er bevaret; et nyt forsøg sker kun, hvis du vælger Gem eller Tilføj.');
    organizerPersist();
  } catch (error) { organizerReport(view, 'Resultatet kan ikke kontrolleres endnu: ' + error.message, true); }
}
async function organizerWrite(view, path, method, body, accept, success) {
  if (!organizerAuthenticated() || view.busy || view.missing || view.conflict || view.uncertain) return;
  const owner = organizerOwner, session = organizerSession;
  view.busy = true; organizerControls(view); organizerReport(view, 'Gemmer …');
  organizerReadVersion++;
  try {
    const result = await api(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (session !== organizerSession || owner !== localStorage.getItem('jarvisAccessToken')) return;
    // Also invalidate GETs started *during* this write. They may have captured
    // the old record before the response acknowledged the new revision.
    organizerReadVersion++;
    accept(result);
    organizerReport(view, typeof success === 'function' ? success() : success); organizerPersist();
    if (organizerReadPromise) await organizerReadPromise.catch(() => {});
    try { await refreshOrganizer(); }
    catch (error) { organizerStatusLine.textContent = 'Ændringen er gemt, men oversigten kunne ikke opdateres: ' + error.message + '. Intet er sendt igen.'; }
    if (organizerVisible('home')) refreshCommandCenter();
  } catch (error) {
    if (session !== organizerSession || owner !== localStorage.getItem('jarvisAccessToken')) return;
    organizerReadVersion++;
    view.uncertain = organizerUnknown(error);
    organizerReport(view, (view.uncertain ? 'Gemningens udfald er ikke bekræftet. Kontrollér listen før et nyt forsøg. ' : 'Ikke gemt: ') +
      error.message + ' Kladden er bevaret.', true);
    organizerPersist();
  } finally {
    if (session === organizerSession) { view.busy = false; organizerControls(view); organizerPersist(); }
  }
}

async function refreshCommandCenter() {
  if (commandLoadInProgress || !organizerAuthenticated()) return;
  commandLoadInProgress = true;
  const session = organizerSession, owner = localStorage.getItem('jarvisAccessToken');
  try {
    const data = await api('/api/dashboard');
    if (session === organizerSession && owner === localStorage.getItem('jarvisAccessToken')) renderCommandCenter(data);
  } catch (error) {
    const root = document.getElementById('home-feed');
    if (root && session === organizerSession) {
      let status = root.querySelector('[data-command-read-error]');
      if (!status) { status = make('p', '', 'v5-conflict'); status.dataset.commandReadError = 'true'; root.append(status); }
      status.textContent = 'Overblikket kunne ikke opdateres: ' + error.message + '. Tidligere viste oplysninger kan være forældede.';
    }
  } finally { commandLoadInProgress = false; }
}

function organizerApplyItem(view, item, { force = false } = {}) {
  view.latest = { ...item }; view.missing = false;
  const changed = item.updatedAt !== view.base.updatedAt || !organizerEqual(organizerEditable(item), organizerEditable(view.base));
  if (force || (!organizerKeepItem(view) && changed)) {
    view.base = { ...item }; organizerWriteFields(view.fields, item); view.conflict = false;
  } else if (changed) {
    view.conflict = true;
    organizerReport(view, 'Ændret et andet sted. Din kladde og dens oprindelige version er bevaret. Hent nyeste punkt før du gemmer.', true);
  }
  view.row.classList.toggle('is-done', Boolean(item.done));
  if (!view.busy) view.checkbox.checked = Boolean(item.done);
  if (view.displaySignature !== JSON.stringify(item)) {
    view.content.replaceChildren(make('strong', item.text));
    if (item.notes) view.content.append(make('p', item.notes, 'muted small-text'));
    if (item.date) view.content.append(make('span', '📅 ' + dateText(item.date) + (item.annual ? ' · årligt' : ''), 'micro'));
    view.displaySignature = JSON.stringify(item);
  }
  organizerControls(view);
}
function organizerRemoveLocalItem(collection, view) {
  collection.items.delete(view.id); view.row.remove(); organizerPersist();
}
function organizerRenderItem(collection, item, draft = null) {
  const view = { id: item.id, base: { ...item }, latest: { ...item }, busy: false, conflict: false, uncertain: false, missing: false };
  view.row = make('div', '', 'collection-item'); view.row.dataset.organizerItemId = collection.id + ':' + item.id;
  const line = make('div', '', 'collection-item-main');
  view.checkbox = document.createElement('input'); view.checkbox.type = 'checkbox';
  view.checkbox.setAttribute('aria-label', 'Markér ' + item.text + ' som færdig');
  view.content = make('div', '', 'collection-item-text'); line.append(view.checkbox, view.content); view.row.append(line);
  view.edit = make('details', '', 'collection-edit'); view.edit.append(make('summary', 'Redigér / slet'));
  view.form = make('form', '', 'collection-edit-form'); view.form.dataset.organizerRole = 'item-editor';
  view.fields = organizerFields(view.form, collection.id + '-' + item.id, item); view.fields.text.required = true;
  const submit = make('button', 'Gem ændring', 'primary compact-button'); submit.type = 'submit'; view.form.append(submit);
  view.status = organizerStatus(view.form);
  view.reload = organizerButton('Hent nyeste punkt og kassér kladde', async () => {
    if (view.busy) return;
    try {
      await refreshOrganizer();
      if (!confirm('Kassér denne lokale kladde og brug det seneste gemte punkt?')) return;
      if (view.missing || collection.missing) { organizerRemoveLocalItem(collection, view); return; }
      organizerApplyItem(view, view.latest, { force: true }); view.uncertain = false;
      organizerReport(view, 'Nyeste gemte version er indlæst.'); organizerControls(view); organizerPersist();
    } catch (error) { organizerReport(view, 'Kunne ikke hente nyeste version: ' + error.message + '. Kladden er bevaret.', true); }
  });
  view.review = organizerButton('Kontrollér resultat før nyt forsøg', () => organizerReviewUnknown(view));
  const erase = organizerButton('Slet punkt', async () => {
    if (view.busy || view.conflict || view.missing || view.uncertain) return;
    if (!confirm('Slet punktet "' + view.latest.text + '"?' + (organizerItemDirty(view) ? ' Den lokale kladde til dette punkt bliver også fjernet.' : ''))) return;
    await organizerWrite(view, '/api/organizer/' + collection.id + '/items/' + view.id, 'DELETE', { updatedAt: view.base.updatedAt },
      () => organizerRemoveLocalItem(collection, view), 'Punktet er slettet.');
  }, 'danger-button compact-button');
  view.actions = [submit, erase, view.checkbox];
  view.edit.append(view.form, view.reload, view.review, erase); view.row.append(view.edit);
  view.form.addEventListener('submit', async event => {
    event.preventDefault();
    const submitted = organizerReadFields(view.fields);
    await organizerWrite(view, '/api/organizer/' + collection.id + '/items/' + view.id, 'PATCH',
      { ...submitted, updatedAt: view.base.updatedAt }, result => {
        if (!result.item?.updatedAt) throw new Error('Serveren kvitterede ikke med punktets gemte version.');
        const unchanged = organizerEqual(organizerReadFields(view.fields), submitted);
        view.base = { ...result.item }; view.latest = { ...result.item }; view.conflict = false;
        if (unchanged) organizerWriteFields(view.fields, result.item);
        organizerApplyItem(view, result.item);
      }, () => organizerItemDirty(view) ? 'Punktet er gemt. Nye ændringer i formularen er endnu ikke gemt.' : 'Punktet er gemt.');
  });
  view.checkbox.addEventListener('change', async () => {
    const requested = view.checkbox.checked;
    await organizerWrite(view, '/api/organizer/' + collection.id + '/items/' + view.id, 'PATCH',
      { done: requested, updatedAt: view.base.updatedAt }, result => {
        if (!result.item?.updatedAt) throw new Error('Serveren kvitterede ikke med punktets gemte version.');
        view.base = { ...result.item }; view.latest = { ...result.item }; view.conflict = false;
        organizerApplyItem(view, result.item);
      }, () => organizerItemDirty(view) ? 'Markeringen er gemt. Beskrivelsens kladde er endnu ikke gemt.' : 'Markeringen er gemt.');
    if (!view.busy) view.checkbox.checked = Boolean(view.latest.done);
  });
  for (const type of ['input', 'change']) view.form.addEventListener(type, () => organizerDraftChanged(view));
  view.edit.addEventListener('toggle', organizerPersist);
  if (draft) {
    view.base = { ...draft.base }; organizerWriteFields(view.fields, draft.fields);
    view.edit.open = Boolean(draft.open); view.uncertain = Boolean(draft.uncertain);
    organizerReport(view, view.uncertain ? 'Tidligere gemnings udfald er ikke bekræftet. Kontrollér før nyt forsøg.'
      : 'Kladde gendannet i denne fane. Gennemgå før gemning.', view.uncertain);
  }
  collection.items.set(item.id, view); collection.entries.append(view.row);
  organizerApplyItem(view, item); return view;
}

function renderCollection(collection, saved = null) {
  const view = { id: collection.id, latest: { ...collection }, items: new Map(), busy: false, uncertain: false,
    conflict: false, missing: false };
  view.card = make('section', '', 'panel collection-card'); view.card.dataset.collectionId = String(collection.id);
  const head = make('div', '', 'collection-heading');
  view.heading = make('h2', collection.title); view.type = make('span', collectionNames[collection.type] || collection.type, 'tiny-label');
  head.append(view.heading, view.type); view.card.append(head);
  const buttons = make('div', '', 'collection-actions');
  view.rename = { base: { title: collection.title, updatedAt: collection.updatedAt }, details: make('details', '', 'collection-rename') };
  view.rename.details.append(make('summary', 'Omdøb liste'));
  view.rename.form = make('form', '', 'collection-edit-form'); view.rename.form.dataset.organizerRole = 'rename';
  view.rename.input = organizerInput(view.rename.form, 'Listenavn', 'title', collection.title, 'text', collection.id);
  view.rename.input.required = true;
  const renameSave = make('button', 'Gem listenavn', 'secondary compact-button'); renameSave.type = 'submit';
  view.rename.form.append(renameSave); view.rename.details.append(view.rename.form);
  const rename = organizerButton('Omdøb', () => { view.rename.details.open = true; view.rename.input.focus(); });
  const archive = organizerButton('Arkivér liste', async () => {
    if (view.busy || view.conflict || view.missing || view.uncertain) return;
    if (!confirm('Arkivér listen "' + view.latest.title + '" med alle punkter?' +
      (organizerKeepCollection(view) ? ' Lokale kladder i listen fjernes også. Arkivet bevares i datafilen.' : ' Arkivet bevares i datafilen.'))) return;
    await organizerWrite(view, '/api/organizer/' + view.id, 'DELETE', { updatedAt: view.latest.updatedAt },
      () => { organizerCards.delete(view.id); view.card.remove(); }, 'Listen er arkiveret i datafilen.');
  }, 'danger-button compact-button');
  buttons.append(rename, archive); view.card.append(buttons, view.rename.details);
  view.status = organizerStatus(view.card);
  view.reload = organizerButton('Hent nyeste listenavn og kassér navnekladde', async () => {
    if (view.busy) return;
    try {
      await refreshOrganizer();
      if (!confirm(view.missing ? 'Listen findes ikke længere i den aktive oversigt. Kassér dens lokale kladder og fjern visningen?'
        : 'Kassér navnekladden og indlæs det seneste listenavn? Kladder til punkter bevares.')) return;
      if (view.missing) { organizerCards.delete(view.id); view.card.remove(); }
      else { view.rename.base = { title: view.latest.title, updatedAt: view.latest.updatedAt };
        view.rename.input.value = view.latest.title; view.conflict = false; view.uncertain = false;
        organizerReport(view, 'Nyeste listenavn er indlæst. Punktkladder er bevaret.'); organizerControls(view); }
      organizerPersist();
    } catch (error) { organizerReport(view, 'Listen kunne ikke opdateres: ' + error.message, true); }
  });
  view.review = organizerButton('Kontrollér resultat før nyt forsøg', () => organizerReviewUnknown(view));
  view.actions = [renameSave, archive]; view.card.append(view.reload, view.review);
  view.entries = make('div', '', 'collection-items'); view.card.append(view.entries);
  view.add = { form: make('form', '', 'collection-add-form'), busy: false, missing: false, uncertain: false };
  view.add.form.dataset.organizerRole = 'add';
  view.add.fields = organizerFields(view.add.form, collection.id + '-add'); view.add.fields.text.required = true;
  view.add.fields.text.placeholder = collection.type === 'dates' ? 'Fx Mors fødselsdag' : collection.type === 'shopping' ? 'Fx Havremælk' : 'Nyt punkt / idé …';
  const addButton = make('button', '+ Tilføj punkt', 'secondary'); addButton.type = 'submit'; view.add.form.append(addButton);
  view.add.status = organizerStatus(view.add.form);
  view.add.review = organizerButton('Kontrollér resultat før nyt forsøg', () => organizerReviewUnknown(view.add));
  view.add.form.append(view.add.review); view.add.actions = [addButton]; view.card.append(view.add.form);
  view.rename.form.addEventListener('submit', async event => {
    event.preventDefault(); const title = view.rename.input.value;
    await organizerWrite(view, '/api/organizer/' + view.id, 'PUT', { title, updatedAt: view.rename.base.updatedAt }, result => {
      if (!result.collection?.updatedAt) throw new Error('Serveren kvitterede ikke med listens gemte version.');
      if (view.rename.input.value === title) view.rename.input.value = result.collection.title;
      view.rename.base = { title: result.collection.title, updatedAt: result.collection.updatedAt };
      view.latest = { ...result.collection }; view.conflict = false;
    }, () => organizerRenameDirty(view) ? 'Listenavnet er gemt. Nye navneændringer er endnu ikke gemt.' : 'Listenavnet er gemt.');
  });
  view.add.form.addEventListener('submit', async event => {
    event.preventDefault(); const submitted = organizerReadFields(view.add.fields);
    await organizerWrite(view.add, '/api/organizer/' + view.id + '/items', 'POST', submitted, result => {
      if (!result.item?.id) throw new Error('Serveren kvitterede ikke med det nye punkt.');
      if (organizerEqual(organizerReadFields(view.add.fields), submitted)) organizerWriteFields(view.add.fields);
      if (!view.items.has(result.item.id)) organizerRenderItem(view, result.item);
    }, () => organizerAddDirty(view) ? 'Punktet er tilføjet. Den nye tilføjelseskladde er endnu ikke gemt.' : 'Punktet er tilføjet.');
  });
  for (const type of ['input', 'change']) {
    view.rename.form.addEventListener(type, () => organizerDraftChanged(view));
    view.add.form.addEventListener(type, () => organizerDraftChanged(view.add));
  }
  view.rename.details.addEventListener('toggle', organizerPersist);
  if (saved) {
    if (saved.rename) {
      view.rename.base = { ...saved.rename.base }; view.rename.input.value = saved.rename.title;
      view.rename.details.open = Boolean(saved.rename.open); view.uncertain = Boolean(saved.rename.uncertain);
    }
    if (saved.add) { organizerWriteFields(view.add.fields, saved.add.fields); view.add.uncertain = Boolean(saved.add.uncertain);
      organizerReport(view.add, view.add.uncertain ? 'Tidligere tilføjelse har uafklaret udfald. Kontrollér listen før nyt forsøg.' : 'Tilføjelseskladde gendannet.', view.add.uncertain); }
  }
  organizerCards.set(view.id, view); organizerRoot.append(view.card);
  organizerSyncCollection(view, collection); return view;
}

function organizerSyncCollection(view, collection) {
  view.latest = { ...collection }; view.missing = false; view.add.missing = false;
  view.heading.textContent = collection.title;
  const renamed = collection.updatedAt !== view.rename.base.updatedAt || collection.title !== view.rename.base.title;
  if (renamed) {
    if (organizerRenameDirty(view) || view.rename.details.open || view.rename.form.contains(document.activeElement) || view.busy || view.uncertain) {
      view.conflict = true; organizerReport(view, 'Listen er ændret et andet sted. Navnekladden og dens version er bevaret; hent nyeste listenavn før gemning.', true);
    } else {
      view.rename.base = { title: collection.title, updatedAt: collection.updatedAt }; view.rename.input.value = collection.title; view.conflict = false;
    }
  }
  const incoming = new Set(collection.items.map(item => item.id));
  for (const item of collection.items) {
    let editor = view.items.get(item.id);
    if (editor) organizerApplyItem(editor, item);
    else editor = organizerRenderItem(view, item, organizerRestored.items[view.id + ':' + item.id]);
  }
  for (const [key, draft] of Object.entries(organizerRestored.items)) {
    if (draft?.collectionId !== view.id || incoming.has(draft.id) || view.items.has(draft.id)) continue;
    organizerRenderItem(view, { ...draft.base, id: draft.id }, draft);
  }
  for (const editor of [...view.items.values()]) if (!incoming.has(editor.id)) {
    if (organizerKeepItem(editor)) {
      editor.missing = true; organizerReport(editor, 'Punktet findes ikke længere i den aktive liste. Din lokale kladde er bevaret; ingen ny post oprettes automatisk.', true); organizerControls(editor);
    } else organizerRemoveLocalItem(view, editor);
  }
  organizerControls(view); organizerControls(view.add);
}
async function refreshOrganizer() {
  const owner = localStorage.getItem('jarvisAccessToken');
  if (!owner) return;
  if (organizerOwner !== owner) {
    organizerClear(); organizerOwner = owner;
    // An earlier owner's in-flight read must neither populate this session nor
    // satisfy its first explicit refresh with an ignored old response.
    if (organizerReadPromise) await organizerReadPromise.catch(() => {});
  }
  if (organizerReadPromise) return organizerReadPromise;
  const session = organizerSession, version = organizerReadVersion;
  organizerLoadInProgress = true;
  organizerReadPromise = (async () => {
    try {
      const data = await api('/api/organizer');
      if (session !== organizerSession || owner !== localStorage.getItem('jarvisAccessToken') || version !== organizerReadVersion) return;
      const ids = new Set(data.collections.map(collection => collection.id));
      for (const collection of data.collections) {
        const view = organizerCards.get(collection.id);
        if (view) organizerSyncCollection(view, collection);
        else renderCollection(collection, organizerRestored.collections[collection.id]);
      }
      for (const saved of Object.values(organizerRestored.collections)) if (saved && !ids.has(saved.id) && !organizerCards.has(saved.id))
        renderCollection({ id: saved.id, title: saved.title, type: saved.type, updatedAt: saved.updatedAt, items: [] }, saved);
      for (const view of [...organizerCards.values()]) if (!ids.has(view.id)) {
        if (organizerKeepCollection(view)) {
          view.missing = true; view.add.missing = true;
          organizerReport(view, 'Listen findes ikke længere i den aktive oversigt. Lokale kladder er bevaret; de er ikke gemt som en ny liste.', true);
          organizerControls(view); organizerControls(view.add);
          for (const item of view.items.values()) { item.missing = true; organizerControls(item); }
        } else { organizerCards.delete(view.id); view.card.remove(); }
      }
      organizerRestored = { collections: {}, items: {} };
      const empty = organizerRoot.querySelector('[data-organizer-empty]');
      if (!organizerCards.size && !empty) { const note = make('p', 'Du har endnu ingen noter eller lister. Opret fx Familiens fødselsdage, Gaveidéer eller Indkøb.', 'muted'); note.dataset.organizerEmpty = 'true'; organizerRoot.append(note); }
      else if (organizerCards.size && empty) empty.remove();
      organizerStatusLine.textContent = '';
      organizerPersist();
      return data;
    } catch (error) {
      if (session === organizerSession && owner === localStorage.getItem('jarvisAccessToken'))
        organizerStatusLine.textContent = 'Listerne kunne ikke opdateres: ' + error.message + '. Tidligere oplysninger kan være forældede. Kladder er bevaret.';
      throw error;
    } finally { organizerLoadInProgress = false; organizerReadPromise = null; }
  })();
  return organizerReadPromise;
}
async function organizerMutation(path, options) {
  const result = await api(path, options);
  organizerReadVersion++;
  if (organizerReadPromise) await organizerReadPromise.catch(() => {});
  await refreshOrganizer();
  if (organizerVisible('home')) await refreshCommandCenter();
  return result;
}

organizerCreate.actions = [organizerCreate.form.querySelector('[type="submit"]')];
organizerCreate.review = organizerButton('Kontrollér resultat før nyt forsøg', () => organizerReviewUnknown(organizerCreate));
organizerCreate.form.append(organizerCreate.review); organizerControls(organizerCreate);
organizerCreate.form.addEventListener('submit', async event => {
  event.preventDefault(); const submitted = { title: organizerTitle.value, type: organizerType.value };
  await organizerWrite(organizerCreate, '/api/organizer', 'POST', submitted, result => {
    if (!result.collection?.id) throw new Error('Serveren kvitterede ikke med den nye liste.');
    if (organizerTitle.value === submitted.title && organizerType.value === submitted.type) organizerTitle.value = '';
    if (!organizerCards.has(result.collection.id)) renderCollection(result.collection);
  }, () => organizerTitle.value ? 'Din nye liste er oprettet. Den nye listekladde er endnu ikke gemt.' : 'Din nye liste er oprettet.');
});
for (const type of ['input', 'change']) {
  organizerCreate.form.addEventListener(type, () => organizerDraftChanged(organizerCreate));
  organizerSearch.addEventListener(type, organizerPersist);
}
organizerSearch.addEventListener('submit', async event => {
  event.preventDefault(); const query = organizerQuery.value.trim();
  if (!query) { organizerSearchStatus.textContent = 'Skriv et søgeord.'; return; }
  const owner = organizerOwner, session = organizerSession;
  try {
    const { matches } = await api('/api/organizer/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    if (session !== organizerSession || owner !== localStorage.getItem('jarvisAccessToken') || organizerQuery.value.trim() !== query) return;
    const root = document.getElementById('organizer-search-results'); root.replaceChildren();
    root.append(make('strong', matches.length + ' fund' + (matches.length === 50 ? ' (maksimum)' : '')));
    for (const match of matches) {
      const row = make('div', '', 'search-entry');
      row.append(make('strong', match.text), make('p', match.collectionTitle +
        (match.date ? ' · ' + dateText(match.date) : '') + (match.notes ? ' · ' + match.notes : ''), 'muted small-text'));
      row.append(organizerButton('Åbn præcist punkt', () => selectTab('knowledge', { sourceId: 'organizer:' + match.collectionId + ':' + match.id })));
      root.append(row);
    }
    organizerSearchStatus.textContent = '';
  } catch (error) { organizerSearchStatus.textContent = 'Søgningen mislykkedes: ' + error.message + '. Søgeteksten er bevaret.'; }
});

function organizerClear() {
  organizerSession++; organizerReadVersion++;
  organizerOwner = '';
  organizerCards.clear(); organizerRoot.replaceChildren(); organizerRestored = { collections: {}, items: {} };
  organizerTitle.value = ''; organizerType.value = 'dates'; organizerQuery.value = '';
  organizerCreate.busy = false; organizerCreate.uncertain = false; organizerControls(organizerCreate);
  for (const status of [organizerStatusLine, organizerDraftStatus, organizerCreate.status, organizerSearchStatus]) status.textContent = '';
  document.getElementById('organizer-search-results').replaceChildren();
  try { sessionStorage.removeItem(organizerDraftKey); } catch { /* Signed-out contents remain cleared. */ }
}
document.getElementById('logout').addEventListener('click', organizerClear);
window.addEventListener('beforeunload', event => {
  if ((!organizerStorageAvailable || organizerSecretDraft) && (organizerTitle.value || [...organizerCards.values()].some(organizerKeepCollection))) {
    event.preventDefault(); event.returnValue = '';
  }
});
try {
  if (organizerOwner) {
    const raw = sessionStorage.getItem(organizerDraftKey);
    if (raw && raw.length <= 1_000_000) {
      const saved = JSON.parse(raw), id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
      const fields = value => value && typeof value.text === 'string' && value.text.length <= 350 &&
        typeof value.notes === 'string' && value.notes.length <= 2500 && typeof value.date === 'string' && value.date.length <= 10;
      const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
      if (saved.version === 1) {
        if (saved.create && typeof saved.create.title === 'string' && saved.create.title.length <= 100 && Object.hasOwn(collectionNames, saved.create.type) && !organizerHasSecret(saved.create)) {
          organizerTitle.value = saved.create.title; organizerType.value = saved.create.type; organizerCreate.uncertain = Boolean(saved.create.uncertain);
          organizerReport(organizerCreate, organizerCreate.uncertain ? 'Tidligere oprettelse har uafklaret udfald. Kontrollér listen før nyt forsøg.' : 'Listekladde gendannet i denne fane.', organizerCreate.uncertain);
          organizerControls(organizerCreate);
        }
        if (typeof saved.query === 'string' && saved.query.length <= 120 && !organizerHasSecret(saved.query)) organizerQuery.value = saved.query;
        for (const [key, draft] of Object.entries(saved.collections || {}).slice(0, 80)) {
          if (!draft || !id(key) || draft.id !== key || typeof draft.title !== 'string' || draft.title.length > 100 ||
              !Object.hasOwn(collectionNames, draft.type) || !timestamp(draft.updatedAt) || organizerHasSecret(draft) ||
              !draft.rename?.base || !timestamp(draft.rename.base.updatedAt) ||
              typeof draft.rename.title !== 'string' || draft.rename.title.length > 100 || !fields(draft.add?.fields)) continue;
          organizerRestored.collections[key] = draft;
        }
        for (const [key, draft] of Object.entries(saved.items || {}).slice(0, 16_000)) {
          if (!draft || !id(draft.id) || !id(draft.collectionId) || key !== draft.collectionId + ':' + draft.id ||
              !draft.base || !timestamp(draft.base.updatedAt) || !fields(draft.fields) || organizerHasSecret(draft)) continue;
          organizerRestored.items[key] = draft;
        }
      }
    }
  } else sessionStorage.removeItem(organizerDraftKey);
} catch { organizerStorageAvailable = false; organizerStorageNotice(); }

async function handleOrganizerVoice(name, args) {
  const json = value => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  let data;
  if (name === 'list_collections') {
    const full = await api('/api/organizer');
    data = { collections: full.collections.map(({ id, title, type, items }) => ({ id, title, type, itemCount: items.length, recentItems: items.slice(-8).map(({ id, text, done, date }) => ({ id, text, done, date })) })) };
  }
  else if (name === 'get_collection') data = await api(`/api/organizer/${args.collectionId}`);
  else if (name === 'search_collection_items') data = await api('/api/organizer/search', { method: 'POST', ...json(args) });
  else if (name === 'create_collection') data = await api('/api/organizer', { method: 'POST', ...json(args) });
  else if (name === 'add_collection_item') data = await api(`/api/organizer/${args.collectionId}/items`, { method: 'POST', ...json(args) });
  else if (name === 'update_collection_item') data = await api(`/api/organizer/${args.collectionId}/items/${args.itemId}`, { method: 'PATCH', ...json(args) });
  else if (name === 'remove_collection_item') data = await api(`/api/organizer/${args.collectionId}/items/${args.itemId}`, { method: 'DELETE' });
  else throw new Error('Ukendt listehandling.');
  organizerReadVersion++;
  if (organizerReadPromise) await organizerReadPromise.catch(() => {});
  await refreshOrganizer();
  if (organizerVisible('home')) await refreshCommandCenter();
  return { ok: true, ...data };
}

function refreshVisibleOrganizer() {
  if (!organizerAuthenticated() || document.visibilityState === 'hidden') return;
  if (organizerVisible('home')) refreshCommandCenter();
  if (organizerVisible('knowledge')) refreshOrganizer().catch(() => {});
}
document.addEventListener('jarvis:refreshed', refreshVisibleOrganizer);
document.addEventListener('jarvis:view-changed', refreshVisibleOrganizer);
document.addEventListener('DOMContentLoaded', () => {
  refreshVisibleOrganizer();
});

setInterval(refreshVisibleOrganizer, 60_000);
