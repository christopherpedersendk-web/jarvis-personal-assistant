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

function renderCommandCenter(data) {
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

async function refreshCommandCenter() {
  if (commandLoadInProgress) return;
  commandLoadInProgress = true;
  try { renderCommandCenter(await api('/api/dashboard')); }
  catch (error) { console.warn('Command Center:', error.message); }
  finally { commandLoadInProgress = false; }
}

async function refreshOrganizer() {
  if (organizerLoadInProgress) return;
  organizerLoadInProgress = true;
  try {
    const data = await api('/api/organizer');
    organizerRoot.replaceChildren();
    if (!data.collections.length) organizerRoot.append(make('p', 'Du har endnu ingen noter eller lister. Opret fx Familiens fødselsdage, Gaveidéer eller Indkøb.', 'muted'));
    for (const collection of data.collections) renderCollection(collection);
  } catch (error) { console.warn('Lister:', error.message); }
  finally { organizerLoadInProgress = false; }
}

async function organizerMutation(path, options) {
  const result = await api(path, options);
  await refreshOrganizer();
  await refreshCommandCenter();
  return result;
}

function renderCollection(collection) {
  const card = make('section', '', 'panel collection-card');
  const head = make('div', '', 'collection-heading');
  const heading = make('h2', collection.title);
  const type = make('span', collectionNames[collection.type] || collection.type, 'tiny-label');
  head.append(heading, type); card.append(head);
  const buttons = make('div', '', 'collection-actions');
  const rename = make('button', 'Omdøb', 'secondary compact-button'); rename.type = 'button';
  rename.addEventListener('click', async () => {
    const title = prompt('Nyt listenavn:', collection.title);
    if (title === null || !title.trim()) return;
    try { await organizerMutation(`/api/organizer/${collection.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }); toast('Listen er omdøbt.'); }
    catch (error) { toast(error.message); }
  });
  const remove = make('button', 'Arkivér liste', 'danger-button compact-button'); remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (!confirm(`Arkivér hele listen "${collection.title}" med ${collection.items.length} punkter?`)) return;
    try { await organizerMutation(`/api/organizer/${collection.id}`, { method: 'DELETE' }); toast('Listen er arkiveret i datafilen.'); }
    catch (error) { toast(error.message); }
  });
  buttons.append(rename, remove); card.append(buttons);

  const entries = make('div', '', 'collection-items');
  if (!collection.items.length) entries.append(make('p', 'Ingen punkter endnu.', 'muted small-text'));
  for (const item of collection.items) {
    const row = make('div', '', `collection-item ${item.done ? 'is-done' : ''}`);
    const line = make('div', '', 'collection-item-main');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = Boolean(item.done); checkbox.title = 'Markér som færdig';
    checkbox.addEventListener('change', async () => {
      try { await organizerMutation(`/api/organizer/${collection.id}/items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: checkbox.checked, updatedAt: item.updatedAt }) }); }
      catch (error) { toast(error.message); checkbox.checked = !checkbox.checked; }
    });
    const content = make('div', '', 'collection-item-text');
    content.append(make('strong', item.text));
    if (item.notes) content.append(make('p', item.notes, 'muted small-text'));
    if (item.date) content.append(make('span', `📅 ${dateText(item.date)}${item.annual ? ' · årligt' : ''}`, 'micro'));
    line.append(checkbox, content); row.append(line);

    const edit = make('details', '', 'collection-edit');
    edit.append(make('summary', 'Redigér / slet'));
    const form = make('form', '', 'collection-edit-form');
    const titleLabel = make('label', 'Titel'); const titleInput = document.createElement('input'); titleInput.value = item.text; titleInput.required = true; titleInput.maxLength = 350;
    const notesLabel = make('label', 'Beskrivelse / note'); const notesInput = document.createElement('textarea'); notesInput.rows = 2; notesInput.maxLength = 2500; notesInput.value = item.notes || '';
    const dateLabel = make('label', 'Dato (valgfri)'); const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.value = item.date || '';
    const annualLabel = make('label', '', 'inline-check'); const annual = document.createElement('input'); annual.type = 'checkbox'; annual.checked = Boolean(item.annual); annualLabel.append(annual, document.createTextNode(' Gentag hvert år'));
    const save = make('button', 'Gem ændring', 'primary compact-button'); save.type = 'submit';
    form.append(titleLabel, titleInput, notesLabel, notesInput, dateLabel, dateInput, annualLabel, save);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try { await organizerMutation(`/api/organizer/${collection.id}/items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        text: titleInput.value, notes: notesInput.value, date: dateInput.value, annual: annual.checked, updatedAt: item.updatedAt,
      }) }); toast('Punktet er gemt.'); }
      catch (error) { toast(error.message); }
    });
    const erase = make('button', 'Slet punkt', 'danger-button compact-button'); erase.type = 'button';
    erase.addEventListener('click', async () => {
      if (!confirm(`Slet punktet "${item.text}"?`)) return;
      try { await organizerMutation(`/api/organizer/${collection.id}/items/${item.id}`, { method: 'DELETE' }); toast('Punktet er slettet.'); }
      catch (error) { toast(error.message); }
    });
    edit.append(form, erase); row.append(edit); entries.append(row);
  }
  card.append(entries);

  const form = make('form', '', 'collection-add-form');
  const input = document.createElement('input'); input.required = true; input.maxLength = 350;
  input.placeholder = collection.type === 'dates' ? 'Fx Mors fødselsdag' : collection.type === 'shopping' ? 'Fx Havremælk' : 'Nyt punkt / idé …';
  const note = document.createElement('textarea'); note.maxLength = 2500; note.rows = 2; note.placeholder = 'Valgfri note, gaveønske, butik, link eller anden kontekst';
  const date = document.createElement('input'); date.type = 'date';
  const dateGroup = make('div', '', 'collection-date-row');
  const dateLabel = make('label', 'Dato (valgfri)');
  const annualLabel = make('label', '', 'inline-check'); const annual = document.createElement('input'); annual.type = 'checkbox';
  annualLabel.append(annual, document.createTextNode(' Gentag årligt'));
  dateGroup.append(dateLabel, date, annualLabel);
  const submit = make('button', '+ Tilføj punkt', 'secondary'); submit.type = 'submit';
  form.append(input, note, dateGroup, submit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try { await organizerMutation(`/api/organizer/${collection.id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      text: input.value, notes: note.value, date: date.value, annual: annual.checked,
    }) }); toast('Punktet er tilføjet.'); }
    catch (error) { toast(error.message); }
  });
  card.append(form); organizerRoot.append(card);
}

document.getElementById('collection-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await organizerMutation('/api/organizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      title: document.getElementById('collection-title').value, type: document.getElementById('collection-type').value,
    }) });
    document.getElementById('collection-title').value = '';
    toast('Din nye liste er oprettet.');
  } catch (error) { toast(error.message); }
});

document.getElementById('organizer-search').addEventListener('submit', async event => {
  event.preventDefault();
  const query = document.getElementById('organizer-query').value.trim();
  if (!query) return toast('Skriv et søgeord.');
  try {
    const { matches } = await api('/api/organizer/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    const root = document.getElementById('organizer-search-results'); root.replaceChildren();
    root.append(make('strong', `${matches.length} fund${matches.length === 50 ? ' (maksimum)' : ''}`));
    for (const match of matches) {
      const row = make('div', '', 'search-entry');
      row.append(make('strong', match.text), make('p', `${match.collectionTitle}${match.date ? ` · ${dateText(match.date)}` : ''}${match.notes ? ` · ${match.notes}` : ''}`, 'muted small-text'));
      root.append(row);
    }
  } catch (error) { toast(error.message); }
});

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
  await refreshOrganizer(); await refreshCommandCenter();
  return { ok: true, ...data };
}

document.addEventListener('jarvis:refreshed', () => { refreshCommandCenter(); refreshOrganizer(); });
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('jarvisAccessToken')) { refreshCommandCenter(); refreshOrganizer(); }
});

setInterval(() => {
  if (localStorage.getItem('jarvisAccessToken') && document.visibilityState === 'visible') refreshCommandCenter();
}, 60_000);
