const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('jarvisAccessToken') || '';
let peer = null;
let microphone = null;
let remoteAudio = null;
let startingVoice = false;
let toastTimer;
const handledCalls = new Set();
let currentGuiRoute = null;
let aiReady = false;
const savedDrafts = {
  playbook: { dirty: false, value: null, serverValue: null },
  preferences: { dirty: false, value: null, serverValue: null },
};
const draftStorageKey = 'jarvis:v5:unsaved-text';
let textDraftGeneration = 0, textDraftStorageReady = true;
const textDraftSensitive = (value, owner = token) => {
  const text = String(value || '');
  return /\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b|\beyJ[\w-]{12,}\.[\w-]{10,}\.[\w-]{10,}\b|PRIVATE KEY|Authorization\s*:\s*Bearer|\b(?:api[_ -]?key|api-nøgle|password|adgangskode|token|secret|cpr|personnummer)\s*[:=]|https?:\/\/[^/\s]+@/i.test(text)
    || Boolean(owner && owner.length >= 6 && text.includes(owner));
};
function textDraftStorageNotice(id) {
  const item = savedDrafts[id];
  if (!item?.dirty) return '';
  if (textDraftSensitive(item.value) || textDraftSensitive(item.serverValue))
    return ' Teksten eller dens gemte grundlag kan indeholde følsomme oplysninger. Kladden findes kun på denne side og gendannes ikke efter genindlæsning.';
  return textDraftStorageReady ? '' : ' Browseren afviser kladdelagring. Behold fanen åben; kladden gendannes ikke sikkert efter genindlæsning.';
}
function persistTextDrafts() {
  const dirty = Object.fromEntries(Object.entries(savedDrafts)
    .filter(([, item]) => token && item.dirty && !textDraftSensitive(item.value) && !textDraftSensitive(item.serverValue))
    .map(([id, item]) => [id, { text: item.value, serverValue: item.serverValue }]));
  try {
    if (Object.keys(dirty).length) sessionStorage.setItem(draftStorageKey, JSON.stringify(dirty));
    else sessionStorage.removeItem(draftStorageKey);
    textDraftStorageReady = true;
  } catch { textDraftStorageReady = false; }
}
function clearTextDrafts() {
  textDraftGeneration++;
  for (const [id, item] of Object.entries(savedDrafts)) {
    Object.assign(item, { dirty: false, value: null, serverValue: null, latestServerValue: null });
    $(id).value = '';
    const status = $(`${id}-draft-status`); status.textContent = ''; status.classList.remove('draft-conflict');
    $(`${id}-review-conflict`)?.remove();
    $(id === 'playbook' ? 'save-playbook' : 'save-preferences').disabled = false;
  }
  try { sessionStorage.removeItem(draftStorageKey); } catch { /* The visible and in-memory values are cleared. */ }
}

try {
  if (token) {
    const recovered = JSON.parse(sessionStorage.getItem(draftStorageKey) || '{}');
    for (const [id, item] of Object.entries(savedDrafts)) {
      const record = recovered[id];
      const recoveredText = typeof record === 'string' ? record : record?.text;
      if (typeof recoveredText === 'string' && recoveredText.length <= (id === 'playbook' ? 30_000 : 10_000) &&
          !textDraftSensitive(recoveredText) && !textDraftSensitive(record?.serverValue)) {
        item.dirty = true;
        item.value = recoveredText;
        item.serverValue = typeof record?.serverValue === 'string' ? record.serverValue : null;
        $(id).value = item.value;
        $(`${id}-draft-status`).textContent = 'Ugemt kladde gendannet fra denne browserfane. Gennemgå før du gemmer.';
      }
    }
  }
  persistTextDrafts();
} catch { textDraftStorageReady = false; /* Malformed session storage cannot prevent login. */ }

function canonicalView(view) {
  return JarvisNavigation.resolve(view).view;
}

function updateDraft(id, value) {
  const draft = savedDrafts[id];
  draft.latestServerValue = value;
  const field = $(id);
  const status = $(`${id}-draft-status`);
  if (draft.dirty) {
    if (draft.serverValue === null) {
      // A user can type while the first state request is still loading.
      // Establish the first observed server basis without replacing the draft.
      draft.serverValue = value;
      persistTextDrafts();
    } else if (draft.serverValue !== value && field.value !== value) {
      status.textContent = 'Ændret et andet sted. Din ikke-gemte tekst er bevaret. Gennemgå forskellen før du gemmer.';
      status.classList.add('draft-conflict');
      showTextDraftReview(id);
    }
    return;
  }
  if (document.activeElement === field && field.value !== value && draft.value !== null) return;
  field.value = value;
  draft.value = value;
  draft.serverValue = value;
  status.textContent = '';
  status.classList.remove('draft-conflict');
}

function markDraftDirty(id) {
  savedDrafts[id].dirty = true;
  savedDrafts[id].value = $(id).value;
  persistTextDrafts();
  const status = $(`${id}-draft-status`);
  status.textContent = 'Ikke gemt. Dine ændringer bevares ved navigation.' + textDraftStorageNotice(id);
}

function markDraftSaved(id, submitted) {
  savedDrafts[id].dirty = $(id).value !== submitted;
  savedDrafts[id].value = $(id).value;
  savedDrafts[id].serverValue = submitted;
  savedDrafts[id].latestServerValue = submitted;
  persistTextDrafts();
  const status = $(`${id}-draft-status`);
  status.textContent = (savedDrafts[id].dirty ? 'Den afsendte tekst er gemt. Dine nyere ændringer er stadig en ugemt kladde.' : 'Gemt.') + textDraftStorageNotice(id);
  status.classList.remove('draft-conflict');
  $(`${id}-review-conflict`)?.remove();
}

function showTextDraftReview(id) {
  let review = $(`${id}-review-conflict`);
  if (!review) {
    review = document.createElement('details'); review.id = `${id}-review-conflict`; review.className = 'v5-conflict';
    const heading = document.createElement('summary'); heading.textContent = 'Gennemgå den nyeste gemte tekst';
    const text = document.createElement('pre'); text.className = 'command-result';
    const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'secondary';
    accept.textContent = 'Behold min kladde på dette grundlag';
    accept.addEventListener('click', () => {
      const draft = savedDrafts[id]; draft.serverValue = draft.latestServerValue;
      persistTextDrafts(); review.remove();
      $(`${id}-draft-status`).textContent = 'Nyt grundlag gennemgået. Din kladde er bevaret og endnu ikke gemt.';
      $(`${id}-draft-status`).classList.remove('draft-conflict');
    });
    review.append(heading, text, accept); $(`${id}-draft-status`).insertAdjacentElement('afterend', review);
  }
  review.querySelector('pre').textContent = savedDrafts[id].latestServerValue;
}

async function saveTextDraft(id, path, field) {
  const button = $(id === 'playbook' ? 'save-playbook' : 'save-preferences');
  if (button.disabled) return;
  const draft = savedDrafts[id], submitted = $(id).value;
  const owner = token, epoch = textDraftGeneration;
  const current = () => Boolean(owner && token === owner && textDraftGeneration === epoch);
  if (!current()) return;
  if (draft.serverValue === null) {
    $(`${id}-draft-status`).textContent = 'Hent det aktuelle grundlag før gemning. Din kladde er bevaret.';
    await refresh(); return;
  }
  if (typeof draft.latestServerValue === 'string' && draft.latestServerValue !== draft.serverValue) {
    $(`${id}-draft-status`).textContent = 'Teksten er ændret et andet sted. Gennemgå grundlaget før du gemmer din kladde.';
    showTextDraftReview(id); return;
  }
  button.disabled = true; $(`${id}-draft-status`).textContent = 'Gemmer den afsendte tekst …';
  try {
    await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: submitted, expectedText: draft.serverValue }) });
    if (!current()) return;
    markDraftSaved(id, submitted);
  } catch (error) {
    if (!current()) return;
    $(`${id}-draft-status`).textContent = `Gemning fejlede: ${error.message}. Din tekst er bevaret.` + textDraftStorageNotice(id);
    if (error.status === 409) await refresh();
  } finally { if (current()) button.disabled = false; }
}

for (const id of Object.keys(savedDrafts)) $(id).addEventListener('input', () => markDraftDirty(id));
window.addEventListener('beforeunload', event => {
  if (Object.keys(savedDrafts).some(id => textDraftStorageNotice(id))) { event.preventDefault(); event.returnValue = ''; }
});

// Reparent the existing editors without recreating their fields or controllers.
function initializeDashboard() {
  JarvisShell.mount({ navigate: selectTab, getRoute: () => currentGuiRoute });
}

function selectTab(tab, { fromHistory = false, replace = false, sourceId = null, section, kind, panel, attention, preserveDestination = false } = {}) {
  const route = fromHistory ? JarvisNavigation.fromURL(window.location.href)
    : JarvisNavigation.resolve(tab, { sourceId, section, kind, panel, attention, preserveDestination });
  currentGuiRoute = route;
  if (!fromHistory) {
    const url = JarvisNavigation.toURL(window.location.href, route);
    const method = replace ? 'replaceState' : 'pushState';
    if (url.href !== window.location.href) history[method]({ ...(replace ? history.state : {}), view: route.view, sourceId: route.sourceId }, '', url);
  }
  JarvisShell.apply(route);
  document.title = `JARVIS · ${route.label}`;
  try { sessionStorage.setItem('jarvisTab', route.view); } catch { /* In-memory navigation still works. */ }
  document.dispatchEvent(new CustomEvent('jarvis:view-changed', { detail: { ...route, primaryView: route.view, view: route.legacyView } }));
}

function renderOverview(state) {
  const summary = state.summary || {};
  const inbox = summary.inboxCount ?? (state.inbox || []).filter(x => !x.read).length;
  const approvals = summary.approvalCount ?? (state.approvals || []).filter(x => x.status === 'pending').length;
  const running = summary.runningCount ?? (state.tasks || []).filter(x => x.status === 'running').length;
  const scheduled = summary.scheduledCount ?? (state.tasks || []).filter(x => x.status === 'scheduled').length;
  const latest = summary.latestTask ?? (state.tasks || []).flatMap(t => (t.runs || []).map(r => ({ title: t.title, ...r })))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const root = $('home-overview');
  root.replaceChildren();
  for (const [title, value, tab] of [['Nye beskeder', inbox, 'secretary'], ['Afventer godkendelse', approvals, 'secretary'], ['Aktive opgaver', `${running} kører · ${scheduled} planlagt`, 'tasks'], ['Kodeprojekter', summary.projectCount ?? (state.projects || []).length, 'projects']]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'overview-card';
    const label = document.createElement('span'); label.textContent = title;
    const amount = document.createElement('strong'); amount.textContent = value;
    button.append(label, amount); button.addEventListener('click', () => selectTab(tab)); root.append(button);
  }
  if (latest) {
    const note = document.createElement('p'); note.className = 'overview-latest';
    const label = ({ completed: 'Færdig', partially_completed: 'Delvist udført', unknown: 'Ukendt udfald', failed: 'Fejlet', running: 'Arbejder', queued: 'I kø' })[latest.status] || 'Uafklaret status';
    note.textContent = `Seneste opgave: ${latest.title} · ${label} · ${taskDate(latest.at)}`;
    root.append(note);
  }
}

initializeDashboard();
const initialRoute = new URL(window.location.href);
selectTab(initialRoute.searchParams.get('view') || sessionStorage.getItem('jarvisTab') || 'home',
  { replace: true, sourceId: initialRoute.searchParams.get('source'),
    attention: initialRoute.searchParams.get('attention') === '1' || initialRoute.searchParams.get('view') === 'secretary',
    section: initialRoute.searchParams.get('section') || undefined, kind: initialRoute.searchParams.get('kind') || undefined,
    panel: initialRoute.searchParams.get('panel') || undefined, preserveDestination: initialRoute.searchParams.get('view') === 'watches' });
window.addEventListener('popstate', () => {
  const url = new URL(window.location.href);
  selectTab(url.searchParams.get('view') || 'home', { fromHistory: true });
  document.dispatchEvent(new CustomEvent('jarvis:source-route', { detail: { id: url.searchParams.get('source') } }));
});

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    cache: 'no-store',
  });
  if (!response.ok) {
    let detail;
    try { detail = (await response.json()).error; } catch { detail = `HTTP ${response.status}`; }
    if (response.status === 401) showLogin();
    const error = new Error(detail || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.headers.get('Content-Type')?.includes('application/json')) return response.json();
  return response.text();
}

function showLogin() {
  $('login').classList.remove('hidden');
  $('workspace').classList.add('hidden');
  $('connection').textContent = 'Ikke forbundet';
}

function showWorkspace() {
  $('login').classList.add('hidden');
  $('workspace').classList.remove('hidden');
  $('connection').textContent = '● Privat forbindelse';
}

let historySnapshot = { items: [], revision: null, total: 0, nextCursor: null };
function renderHistory(history) {
  const list = $('messages');
  document.querySelector('.chat-panel')?.classList.toggle('chat-empty', !history.length);
  list.replaceChildren();
  $('history-count').textContent = historySnapshot.total > history.length ? `${history.length} af ${historySnapshot.total} beskeder` : `${history.length} beskeder`;
  $('history-older').classList.toggle('hidden', !historySnapshot.nextCursor);
  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Spørg mig om noget – eller start en stemmesamtale ovenfor.';
    list.append(empty);
    return;
  }
  history.forEach(item => {
    const bubble = document.createElement('div');
    bubble.className = `bubble ${item.role === 'user' ? 'user' : 'assistant'}`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${item.role === 'user' ? 'DIG' : 'JARVIS'} · ${item.channel === 'voice' ? 'TALE' : 'TEKST'}`;
    const content = document.createElement('span');
    content.textContent = item.text;
    bubble.append(meta, content);
    list.append(bubble);
  });
  list.scrollTop = list.scrollHeight;
}

function acceptHistoryPage(page, { older = false } = {}) {
  if (!older && page.revision && page.revision === historySnapshot.revision) return;
  historySnapshot = { ...page, items: older ? [...page.items, ...historySnapshot.items] : [...page.items] };
  renderHistory(historySnapshot.items);
}
$('history-older').addEventListener('click', async () => {
  if (!historySnapshot.nextCursor || $('history-older').disabled) return;
  const original = historySnapshot;
  const list = $('messages'), oldHeight = list.scrollHeight, oldTop = list.scrollTop;
  $('history-older').disabled = true; $('history-status').textContent = 'Henter ældre beskeder …';
  try {
    const page = await api(`/api/history?cursor=${encodeURIComponent(original.nextCursor)}`);
    if (historySnapshot !== original) { $('history-status').textContent = 'Historikken blev opdateret imens. Prøv den aktuelle oversigt.'; return; }
    acceptHistoryPage(page, { older: true });
    list.scrollTop = oldTop + list.scrollHeight - oldHeight;
    $('history-status').textContent = page.nextCursor ? 'Ældre beskeder indlæst.' : 'Alle gemte beskeder er vist.';
  } catch (error) { $('history-status').textContent = error.message; }
  finally { $('history-older').disabled = false; }
});
$('logout').addEventListener('click', () => {
  historySnapshot = { items: [], revision: null, total: 0, nextCursor: null };
  renderHistory([]); $('history-status').textContent = '';
});

async function refreshActiveCore() {
  const route = currentGuiRoute || JarvisNavigation.fromURL(window.location.href);
  if (route.view === 'home') await refreshSecretary();
  else if (route.view === 'watches' || (route.view === 'plan' && route.kind === 'agent')) await refreshTasks();
  else if (route.view === 'plan' && route.kind === 'projects') await refreshProjects();
  else if (route.view === 'settings') {
    await refreshSettings();
    if (route.section === 'system') await refreshCode();
  }
}
document.addEventListener('jarvis:view-changed', () => {
  if (token && !$('workspace').classList.contains('hidden')) refreshActiveCore().catch(error => toast(error.message));
});

function openAiSetup(event) {
  if (event && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
  event?.preventDefault();
  selectTab('settings', { section: 'system' });
  const url = new URL(window.location.href); url.hash = 'ai-setup';
  history.replaceState(history.state, '', url);
  const target = $('ai-setup');
  target?.focus({ preventScroll: true }); target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderAiReadiness() {
  const readiness = $('chat-readiness'); if (!readiness) return;
  readiness.classList.toggle('hidden', aiReady);
  if (aiReady) { readiness.replaceChildren(); return; }
  if (readiness.querySelector('[data-ai-setup]')) return;
  const copy = document.createElement('span'); copy.textContent = 'Samtalen er ikke klar. Serverens OpenAI API-nøgle mangler. ';
  const link = document.createElement('a'); link.href = '?view=settings&section=system#ai-setup';
  link.dataset.aiSetup = ''; link.textContent = 'Se AI-opsætning'; link.addEventListener('click', openAiSetup);
  readiness.replaceChildren(copy, link);
}

async function refresh() {
  const sessionToken = token;
  const state = await api('/api/state?scope=bootstrap');
  if (!sessionToken || sessionToken !== token) return;
  localStorage.setItem('jarvisAccessToken', sessionToken);
  showWorkspace();
  aiReady = state.configured === true;
  $('connection').textContent = aiReady ? 'Privat forbindelse' : 'Forbundet · AI mangler opsætning';
  if (!peer && !startingVoice) $('voice-status').textContent = aiReady ? 'Start en stemmesamtale, når du er klar.' : 'AI mangler en API-nøgle på serveren. Se System og opdateringer.';
  acceptHistoryPage({ items: state.history || [], ...(state.historyPagination || {}) });
  updateDraft('playbook', state.playbook || '');
  $('push-status').textContent = state.pushEnabled ? 'Push: opsat' : 'Push: ikke opsat';
  renderOverview(state);
  document.dispatchEvent(new CustomEvent('jarvis:refreshed'));
  updateDraft('preferences', state.preferences || '');
  renderAiReadiness();
  await refreshActiveCore();
}

const taskStatus = {
  scheduled: 'Planlagt', running: 'Arbejder …', completed: 'Færdig',
  failed: 'Fejl', paused: 'Pauset', archived: 'Arkiveret',
};

function taskDate(value) {
  if (!value) return '';
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return 'Tidspunkt ukendt';
  return new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone: 'Europe/Copenhagen' }).format(date);
}

const jobPolicyEditor = JarvisJobs.attach({ document, api, getToken: () => token, refresh: () => refreshTasks(),
  onOpen: ({ category }) => JarvisShell.openJobEditor(category),
  navigateSkill: sourceId => { selectTab('knowledge', { sourceId });
    focusRecordedSource(sourceId).catch(error => sourceStatus('knowledge', error.message)); } });

const watches = JarvisWatches.attach({ document, editor: jobPolicyEditor, navigate: selectTab, getToken: () => token });
let currentTaskRecords = [];
function renderTasks(tasks, usage = {}) { currentTaskRecords = tasks; jobPolicyEditor.render(tasks, usage, { filter: task => task.category !== 'monitor' }); watches.render(tasks); }

let taskRefreshSequence = 0;
async function refreshTasks() {
  const request = ++taskRefreshSequence, owner = token;
  if (currentGuiRoute?.view === 'watches') watches.loading();
  try {
    const result = await api('/api/tasks');
    if (request !== taskRefreshSequence || owner !== token) return;
    renderTasks(result.tasks, result.usage);
  } catch (error) { if (request === taskRefreshSequence && owner === token) watches.error(error.message); throw error; }
}

let secretaryReadSequence = 0;
function clearSecretary() {
  secretaryReadSequence++;
  for (const id of ['secretary-inbox', 'approvals']) $(id).replaceChildren();
  $('secretary-count').textContent = ''; $('push-status').textContent = '';
}
function renderSecretary(data) {
  if (!token) return;
  updateDraft('playbook', data.playbook || '');
  $('push-status').textContent = data.pushEnabled ? 'Push: opsat' : 'Push: ikke opsat';
  $('secretary-count').textContent = `${(data.inbox || []).filter(x => !x.read).length} NYE`;
  const inboxRoot = $('secretary-inbox'); inboxRoot.replaceChildren();
  for (const item of (data.inbox || []).slice(0, 20)) {
    const box = document.createElement('div'); box.className = `secretary-item ${item.read ? '' : 'unread'}`;
    const title = document.createElement('h4'); title.textContent = item.title;
    const detail = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = `${new Date(item.at).toLocaleString('da-DK')} · Se resultat`;
    const text = document.createElement('p'); text.textContent = item.text;
    detail.append(summary, text);
    const mark = document.createElement('button'); mark.type = 'button'; mark.textContent = item.read ? 'Læst' : 'Markér læst';
    mark.disabled = item.read;
    mark.addEventListener('click', async () => {
      try { await api(`/api/inbox/${item.id}/read`, { method: 'POST' }); await refreshSecretary(); }
      catch (error) { toast(error.message); }
    });
    box.append(title, detail, mark); inboxRoot.append(box);
  }
  const approvalsRoot = $('approvals'); approvalsRoot.replaceChildren();
  for (const item of (data.approvals || []).slice(0, 20)) {
    const box = document.createElement('div'); box.className = 'secretary-item';
    const title = document.createElement('h4'); title.textContent = `${item.title} · ${item.status}`;
    const p = document.createElement('p'); p.textContent = item.description;
    box.append(title, p);
    if (item.url) { const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Åbn link manuelt'; box.append(link); }
    if (item.status === 'pending') {
      const note = document.createElement('p'); note.className = 'secretary-note'; note.textContent = 'Beslutningen registreres, men udfører intet køb eller booking.';
      box.append(note);
      for (const [decision, label] of [['approve', 'Godkend forslag'], ['reject', 'Afvis']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', async () => {
          if (decision === 'approve' && !confirm('Godkend forslaget? Dette gennemfører IKKE den eksterne handling.')) return;
          try { await api(`/api/approvals/${item.id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) }); await refreshSecretary(); }
          catch (error) { toast(error.message); }
        });
        box.append(button);
      }
    }
    approvalsRoot.append(box);
  }
}

async function refreshSecretary() {
  const owner = token, epoch = textDraftGeneration, request = ++secretaryReadSequence;
  const current = () => Boolean(owner && token === owner && epoch === textDraftGeneration && request === secretaryReadSequence);
  if (!current()) return;
  try {
    const data = await api('/api/secretary');
    if (current()) renderSecretary(data);
  } catch (error) { if (current()) throw error; }
}

$('save-playbook').addEventListener('click', async () => {
  await saveTextDraft('playbook', '/api/playbook', 'content');
});
$('import-playbook').addEventListener('click', () => $('playbook-file').click());
$('playbook-file').addEventListener('change', async () => {
  const file = $('playbook-file').files?.[0];
  if (!file) return;
  if (file.size > 15_000) return toast('Skills-dokumentet må højst fylde 15 KB.');
  $('playbook').value = await file.text();
  markDraftDirty('playbook');
  toast('Markdown indlæst. Tryk Gem arbejdsinstruktioner for at gemme det.');
  $('playbook-file').value = '';
});
$('export-playbook').addEventListener('click', () => {
  const blob = new Blob([$('playbook').value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'JARVIS_Secretary_Skills.md'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
});

$('push-test').addEventListener('click', async () => {
  try { await api('/api/notifications/test', { method: 'POST' }); toast('Testbesked sendt til Pushover.'); }
  catch (error) { toast(error.message); }
});

function applyTaskTemplate(category) {
  const accepted = jobPolicyEditor.template({ 'task-category': category,
    'task-title': category === 'briefing' ? 'Morgenrapport – AI og cybersikkerhed' : 'Prisovervågning',
    'task-prompt': category === 'briefing'
      ? 'Lav en kort morgenrapport om AI, cybersikkerhed, DORA, NIS2 og IT-revision i Danmark/Norden. Medtag kildelinks, datoer og hvad der faktisk er nyt siden sidst.'
      : 'Overvåg følgende præcise produkt, variant og forhandler: [INDSÆT PRODUKT OG LINK]. Registrér pris i DKK, lagerstatus, tidspunkt og kilde som strukturerede observationer. Skeln mellem ændret, uændret og ukendt; en fejlet læsning er ukendt.',
    'task-repeat': 'daily', 'task-daily-time': category === 'briefing' ? '07:30' : '08:00' },
    category === 'briefing' ? { skillId: 'daily-briefing' } : {});
  if (!accepted) return;
  $('task-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('briefing-template').addEventListener('click', () => applyTaskTemplate('briefing'));
$('monitor-template').addEventListener('click', () => applyTaskTemplate('monitor'));
$('gift-template').addEventListener('click', () => {
  jobPolicyEditor.template({ 'task-category': 'monitor', 'task-title': 'Gaveidéer og tilbud',
    'task-prompt': 'Find 3 nye gaveidéer til [PERSON, ALDER, INTERESSER] under [BUDGET] kr. i danske butikker. Medtag pris, levering, links og sammenlign med tidligere forslag. Registrér struktureret observation: ændret, uændret eller ukendt. En fejlet kilde er ikke bevis for uændret.',
    'task-repeat': '10080' }, { skillId: 'gift-planning' });
});

const projectUi = JarvisProjects.attach({
  document, storage: sessionStorage, isAuthenticated: () => Boolean(token), api,
  confirm: message => confirm(message), refreshProjects: () => refreshProjects(), refreshCode: () => refreshCode(),
});

function renderCodeProposals(proposals) { projectUi.renderCode(proposals); }
function renderProjects(projects) { projectUi.renderProjects(projects); }

async function refreshCode() {
  const epoch = projectUi.generation();
  const result = await api('/api/code');
  if (epoch === projectUi.generation() && token) renderCodeProposals(result.proposals);
}

async function refreshProjects() {
  const epoch = projectUi.generation();
  const result = await api('/api/projects');
  if (epoch !== projectUi.generation() || !token) return;
  renderProjects(result.projects);
  projectUi.renderArchived(result.archived);
}

const archivePanel = document.createElement('section');
archivePanel.className = 'panel archive-panel';
archivePanel.innerHTML = '<h2>Arkiverede projekter</h2><p class="muted small-text">Projektmapper bevares lokalt og kan gendannes.</p><div id="archived-projects"></div>';
$('tab-projects').append(archivePanel);

const settingsDrafts = JarvisSettings.attach({ document, api, getToken: () => token });
async function refreshSettings() { await settingsDrafts.refresh(); }
$('discord-form').addEventListener('submit', event => settingsDrafts.saveDiscord(event));
$('settings-form').addEventListener('submit', event => settingsDrafts.saveSystem(event));

$('task-form').addEventListener('submit', event => jobPolicyEditor.save(event));

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  token = $('token').value.trim();
  try {
    await refresh();
    $('token').value = '';
  } catch (error) { toast(error.message); }
});

JarvisChat.attach({ document, api, refresh, getToken: () => token,
  getContext: JarvisShell.getContext, setContext: JarvisShell.setContext, canSend: () => aiReady });

$('save-preferences').addEventListener('click', async () => {
  await saveTextDraft('preferences', '/api/preferences', 'text');
});

$('refresh').addEventListener('click', () => refresh().catch(error => toast(error.message)));
$('logout').addEventListener('click', () => {
  stopVoice();
  localStorage.removeItem('jarvisAccessToken');
  clearTextDrafts();
  clearSecretary();
  try {
    for (const key of ['jarvis:v5:memory-note-draft', 'jarvis:v5:memory-claim-draft', 'jarvis:v5:memory-mode'])
      sessionStorage.removeItem(key);
  } catch { /* ignore blocked storage */ }
  token = '';
  showLogin();
});

async function recordTranscript(role, text, eventId) {
  if (!text?.trim()) return;
  try {
    await api('/api/transcript', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, text, eventId }),
    });
    await refresh();
  } catch (error) { toast(`Transkript kunne ikke gemmes: ${error.message}`); }
}

async function handleVoiceTool(channel, call) {
  if (!call.call_id || handledCalls.has(call.call_id)) return;
  handledCalls.add(call.call_id);
  let output;
  try {
    const args = JSON.parse(call.arguments || '{}');
    if (call.name === 'create_research_task') {
      const data = await api('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...args, activation: 'paused' }),
      });
      output = { ok: true, id: data.task.id, title: data.task.title, status: data.task.status, nextRunAt: data.task.nextRunAt,
        note: 'Gemt som pauset forslag. Ejeren skal gennemgå politikken og aktivere i Planlægning; intet baggrundsarbejde er startet.' };
      await refreshTasks();
    } else if (call.name === 'list_research_tasks') {
      const data = await api('/api/tasks');
      output = { tasks: data.tasks.slice(0, 15).map(({ title, status, nextRunAt, runs }) => ({ title, status, nextRunAt, lastResult: runs?.[0]?.result?.slice(0, 500) })) };
    } else if (call.name === 'create_code_project') {
      const data = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      output = { ok: true, project: data.project };
      await refreshProjects();
    } else if (call.name === 'list_code_projects') {
      const data = await api('/api/projects');
      output = { projects: data.projects };
    } else if (call.name === 'develop_code_project') {
      const data = await api(`/api/projects/${args.id}/develop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: args.request }) });
      output = { ok: true, summary: data.project.lastSummary, changedFiles: data.changedFiles, packagesAwaitingApproval: data.packagesAwaitingApproval };
      await refreshProjects();
    } else if (call.name === 'remember_preference') {
      const data = await api('/api/planning/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'remember_personal_fact', args }) });
      output = { ok: true, ...data };
      await refreshSecretary();
    } else if (call.name === 'prepare_action') {
      const data = await api('/api/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      output = { ok: true, status: data.action.status, note: 'Kun forberedt. Ingen booking, køb eller besked er gennemført.' };
      await refreshSecretary();
    } else if (call.name === 'search_personal_knowledge') {
      output = await api('/api/knowledge/search', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    } else if (call.name === 'get_household_day') {
      output = await api('/api/knowledge/household/' + encodeURIComponent(args.date));
    } else if (['list_collections', 'get_collection', 'search_collection_items', 'create_collection', 'add_collection_item', 'update_collection_item', 'remove_collection_item'].includes(call.name)) {
      output = await handleOrganizerVoice(call.name, args);
    } else if (call.name === 'list_hue_devices') {
      output = await api('/api/smart-home/hue/resources');
    } else if (call.name === 'set_hue_light') {
      output = await api('/api/smart-home/hue/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    } else if (call.name === 'activate_hue_scene') {
      output = await api('/api/smart-home/hue/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    } else {
      // The authenticated server, not a model-chosen URL, dispatches the fixed
      // planning allowlist. Approval/checkout names are never permitted here.
      output = await api('/api/planning/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: call.name, args }) });
    }
  } catch (error) { output = { error: error.message }; }
  if (channel.readyState !== 'open') return;
  channel.send(JSON.stringify({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) },
  }));
  // Lad modellen foretage et nødvendigt næste skridt, fx opret liste -> tilføj punkt.
  channel.send(JSON.stringify({ type: 'response.create' }));
}

function stopVoice() {
  peer?.close();
  peer = null;
  microphone?.getTracks().forEach(track => track.stop());
  microphone = null;
  if (remoteAudio) { remoteAudio.pause(); remoteAudio.srcObject = null; remoteAudio = null; }
  $('voice-orb').classList.remove('listening');
  $('voice-toggle').textContent = '🎙️ Start stemmesamtale';
  $('voice-status').textContent = aiReady ? 'Start en stemmesamtale, når du er klar.' : 'AI mangler opsætning på serveren.';
}

async function startVoice() {
  if (startingVoice) return;
  if (!aiReady) { toast('AI mangler opsætning. Se OpenAI-forbindelsen på serveren.'); openAiSetup(); return; }
  startingVoice = true;
  $('voice-toggle').disabled = true;
  $('voice-status').textContent = 'Opretter sikker stemmeforbindelse …';
  try {
    if (!window.isSecureContext) throw new Error('Mikrofonen kræver HTTPS eller localhost.');
    microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
    peer = new RTCPeerConnection();
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
    peer.ontrack = event => {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(() => {});
    };
    microphone.getTracks().forEach(track => peer.addTrack(track, microphone));
    const channel = peer.createDataChannel('oai-events');
    channel.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'conversation.item.input_audio_transcription.completed') {
        recordTranscript('user', message.transcript, message.event_id);
      } else if (message.type === 'response.output_audio_transcript.done') {
        recordTranscript('assistant', message.transcript, message.event_id);
      } else if (message.type === 'response.output_item.done' && message.item?.type === 'function_call') {
        handleVoiceTool(channel, message.item).catch(error => toast(error.message));
      } else if (message.type === 'error') {
        toast(`Stemmefejl: ${message.error?.message || 'Ukendt fejl'}`);
      }
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const sdp = await api('/api/realtime', {
      method: 'POST', headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    await peer.setRemoteDescription({ type: 'answer', sdp });
    $('voice-orb').classList.add('listening');
    $('voice-toggle').textContent = '■ Afslut stemmesamtale';
    $('voice-status').textContent = 'Du kan tale nu. Samtalen gemmes som tekst, når transskription er tilgængelig.';
    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer?.connectionState)) stopVoice();
    };
  } catch (error) {
    stopVoice();
    toast(error.message);
  } finally {
    startingVoice = false;
    $('voice-toggle').disabled = false;
  }
}

$('voice-toggle').addEventListener('click', () => peer ? stopVoice() : startVoice());
window.addEventListener('pagehide', stopVoice);

if (token) refresh().catch(() => showLogin());
else showLogin();

setInterval(() => {
  if (token && !$('workspace').classList.contains('hidden') && document.visibilityState === 'visible') {
    const route = currentGuiRoute || JarvisNavigation.fromURL(window.location.href);
    if (route.view === 'watches' || (route.view === 'plan' && route.kind === 'agent')) {
      refreshTasks().catch(() => {});
    }
    if (route.view === 'home') { api('/api/overview').then(renderOverview).catch(() => {}); refreshSecretary().catch(() => {}); }
  }
}, 20_000);
