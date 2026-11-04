const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('jarvisAccessToken') || '';
let peer = null;
let microphone = null;
let remoteAudio = null;
let startingVoice = false;
let toastTimer;
const handledCalls = new Set();

// Flyt eksisterende, gennemtestede funktioner ind i faner uden at genskabe formularer.
function initializeDashboard() {
  const destinations = {
    home: ['.hero-panel', '.chat-panel'],
    tasks: ['.tasks-panel'],
    projects: ['.projects-panel', '.code-panel'],
    secretary: ['.secretary-panel'],
    settings: ['.notes-panel', '.capabilities', '#logout'],
  };
  for (const [tab, selectors] of Object.entries(destinations)) {
    for (const selector of selectors) {
      const element = document.querySelector(`#legacy-layout ${selector}`);
      if (element) $(`tab-${tab}`).append(element);
    }
  }
  const hero = document.querySelector('#tab-home .hero-panel');
  if (hero) $('tab-home').prepend(hero);
  const chat = document.querySelector('#tab-home .chat-panel');
  if (chat) $('tab-home').insertBefore(chat, $('home-overview'));
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
}

function selectTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.tab-view').forEach(view => view.classList.toggle('hidden', view.id !== `tab-${tab}`));
  sessionStorage.setItem('jarvisTab', tab);
}

function renderOverview(state) {
  const inbox = (state.inbox || []).filter(x => !x.read).length;
  const approvals = (state.approvals || []).filter(x => x.status === 'pending').length;
  const running = (state.tasks || []).filter(x => x.status === 'running').length;
  const scheduled = (state.tasks || []).filter(x => x.status === 'scheduled').length;
  const latest = (state.tasks || []).flatMap(t => (t.runs || []).map(r => ({ title: t.title, ...r })))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const root = $('home-overview');
  root.replaceChildren();
  for (const [title, value, tab] of [['Nye beskeder', inbox, 'secretary'], ['Afventer godkendelse', approvals, 'secretary'], ['Aktive opgaver', `${running} kører · ${scheduled} planlagt`, 'tasks'], ['Kodeprojekter', (state.projects || []).length, 'projects']]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'overview-card';
    const label = document.createElement('span'); label.textContent = title;
    const amount = document.createElement('strong'); amount.textContent = value;
    button.append(label, amount); button.addEventListener('click', () => selectTab(tab)); root.append(button);
  }
  if (latest) {
    const note = document.createElement('p'); note.className = 'overview-latest';
    note.textContent = `Seneste opgave: ${latest.title} · ${latest.status === 'completed' ? 'Bestået' : 'Fejlet'} · ${taskDate(latest.at)}`;
    root.append(note);
  }
}

initializeDashboard();
selectTab(sessionStorage.getItem('jarvisTab') || 'home');

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
    throw new Error(detail || `HTTP ${response.status}`);
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

function renderHistory(history) {
  const list = $('messages');
  list.replaceChildren();
  $('history-count').textContent = `${history.length} beskeder`;
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

async function refresh() {
  const state = await api('/api/state');
  showWorkspace();
  renderHistory(state.history || []);
  renderTasks(state.tasks || [], state.usage);
  renderCodeProposals(state.codeProposals || []);
  renderProjects(state.projects || []);
  renderSecretary(state);
  renderOverview(state);
  document.dispatchEvent(new CustomEvent('jarvis:refreshed'));
  if (document.activeElement !== $('preferences')) $('preferences').value = state.preferences || '';
  if (!state.configured) toast('API-nøglen mangler i .env. Se installationsguiden.');
}

const taskStatus = {
  scheduled: 'Planlagt', running: 'Arbejder …', completed: 'Færdig',
  failed: 'Fejl', paused: 'Pauset', archived: 'Arkiveret',
};

function taskDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function renderTasks(tasks, usage = {}) {
  $('usage').textContent = `${usage.started || 0}/${usage.maxRunsPerDay || 10} I DAG`;
  const root = $('tasks');
  root.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'task-empty';
    empty.textContent = 'Ingen opgaver endnu. Prøv en engangsundersøgelse.';
    root.append(empty);
    return;
  }
  for (const task of tasks) {
    const card = document.createElement('article');
    card.className = 'task-card';
    const top = document.createElement('div');
    top.className = 'task-top';
    const title = document.createElement('h3');
    title.textContent = task.title;
    const status = document.createElement('span');
    status.className = `task-pill ${task.status}`;
    status.textContent = taskStatus[task.status] || task.status;
    top.append(title, status);
    const schedule = document.createElement('div');
    schedule.className = 'task-schedule';
    schedule.textContent = [task.nextRunAt ? `Næste: ${taskDate(task.nextRunAt)}` : '',
      task.dailyTime ? `Dagligt kl. ${task.dailyTime} dansk tid` : task.intervalMinutes ? `Gentages hver ${task.intervalMinutes / 60} time(r)` : 'Engangsopgave']
      .filter(Boolean).join(' · ');
    const description = document.createElement('p');
    description.textContent = task.prompt;
    card.append(top, schedule, description);
    if (task.runs?.length) {
      const detail = document.createElement('details');
      detail.className = 'task-result';
      const summary = document.createElement('summary');
      summary.textContent = task.runs[0].status === 'completed' ? 'Se seneste resultat' : 'Se seneste fejl';
      const pre = document.createElement('pre');
      pre.textContent = task.runs[0].result;
      detail.append(summary, pre);
      card.append(detail);
    }
    const actions = document.createElement('div');
    actions.className = 'task-actions';
    const controls = task.status === 'running' ? [] : [
      ['run', 'Kør nu'],
      [task.status === 'paused' ? 'resume' : 'pause', task.status === 'paused' ? 'Genoptag' : 'Pause'],
      ['archive', 'Arkivér'],
    ];
    for (const [action, label] of controls) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', async () => {
        if (action === 'archive' && !confirm(`Arkivér opgaven "${task.title}"?`)) return;
        button.disabled = true;
        try {
          await api(`/api/tasks/${task.id}/action`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          });
          await refreshTasks();
        } catch (error) { toast(error.message); button.disabled = false; }
      });
      actions.append(button);
    }
    if (task.status !== 'running') {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'danger-button'; remove.textContent = 'Slet opgave';
      remove.addEventListener('click', async () => {
        if (!confirm(`Fjern opgaven "${task.title}" fra listen? Historikken arkiveres.`)) return;
        try { await api(`/api/tasks/${task.id}`, { method: 'DELETE' }); await refresh(); toast('Opgaven er fjernet fra listen.'); }
        catch (error) { toast(error.message); }
      });
      actions.append(remove);
    }
    card.append(actions);
    root.append(card);
  }
}

async function refreshTasks() {
  const result = await api('/api/tasks');
  renderTasks(result.tasks, result.usage);
}

function renderSecretary(data) {
  if (document.activeElement !== $('playbook')) $('playbook').value = data.playbook || '';
  $('push-status').textContent = data.pushEnabled ? 'Push: opsat' : 'Push: ikke opsat';
  $('secretary-count').textContent = `${(data.inbox || []).filter(x => !x.read).length} NYE`;
  const memoryRoot = $('memories');
  memoryRoot.replaceChildren();
  for (const item of (data.memories || []).filter(x => !x.archived).slice(0, 30)) {
    const box = document.createElement('div'); box.className = 'secretary-item';
    const p = document.createElement('p'); p.textContent = item.text;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Glem';
    button.addEventListener('click', async () => {
      if (!confirm('Fjern dette hukommelsespunkt?')) return;
      try { await api(`/api/memories/${item.id}/archive`, { method: 'POST' }); await refreshSecretary(); }
      catch (error) { toast(error.message); }
    });
    box.append(p, button); memoryRoot.append(box);
  }
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

async function refreshSecretary() { renderSecretary(await api('/api/secretary')); }

$('save-playbook').addEventListener('click', async () => {
  try { await api('/api/playbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: $('playbook').value }) }); toast('Skills-dokumentet er gemt.'); }
  catch (error) { toast(error.message); }
});
$('import-playbook').addEventListener('click', () => $('playbook-file').click());
$('playbook-file').addEventListener('change', async () => {
  const file = $('playbook-file').files?.[0];
  if (!file) return;
  if (file.size > 15_000) return toast('Skills-dokumentet må højst fylde 15 KB.');
  $('playbook').value = await file.text();
  toast('Markdown indlæst. Tryk Gem skills-dokument for at aktivere det.');
  $('playbook-file').value = '';
});
$('export-playbook').addEventListener('click', () => {
  const blob = new Blob([$('playbook').value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'JARVIS_Secretary_Skills.md'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
});

$('memory-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: $('memory-text').value }) });
    $('memory-text').value = ''; await refreshSecretary(); toast('JARVIS husker nu dette på tværs af samtaler og projekter.');
  } catch (error) { toast(error.message); }
});

$('push-test').addEventListener('click', async () => {
  try { await api('/api/notifications/test', { method: 'POST' }); toast('Testbesked sendt til Pushover.'); }
  catch (error) { toast(error.message); }
});

function applyTaskTemplate(category) {
  selectTab('tasks');
  $('task-category').value = category;
  $('task-title').value = category === 'briefing' ? 'Morgenrapport – AI og cybersikkerhed' : 'Prisovervågning';
  $('task-prompt').value = category === 'briefing'
    ? 'Lav en kort morgenrapport om de vigtigste nyheder inden for AI, cybersikkerhed, DORA, NIS2 og IT-revision i Danmark/Norden. Følg mit skills-dokument. Medtag kildelinks, datoer og hvad der er nyt siden sidst.'
    : 'Overvåg følgende præcise produkt, variant og forhandler: [INDSÆT PRODUKT OG LINK]. Registrér pris i DKK, lagerstatus, tidspunkt og kilde. Sammenlign med forrige observation og markér CHANGE eller NO_CHANGE.';
  $('task-repeat').value = 'daily';
  $('daily-wrap').classList.remove('hidden');
  $('task-when').value = 'now'; $('later-wrap').classList.add('hidden');
  $('task-daily-time').value = category === 'briefing' ? '07:30' : '08:00';
  $('task-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('briefing-template').addEventListener('click', () => applyTaskTemplate('briefing'));
$('monitor-template').addEventListener('click', () => applyTaskTemplate('monitor'));
$('gift-template').addEventListener('click', () => {
  applyTaskTemplate('monitor');
  $('task-title').value = 'Gaveidéer og tilbud';
  $('task-prompt').value = 'Find 3 nye gaveidéer til [PERSON, ALDER, INTERESSER] under [BUDGET] kr. i danske butikker. Medtag pris, levering, links og sammenlign med tidligere forslag. Markér CHANGE ved reelt nye relevante fund, NO_CHANGE hvis intet nyt.';
  $('task-repeat').value = '10080';
  $('daily-wrap').classList.add('hidden');
});
$('task-repeat').addEventListener('change', () => $('daily-wrap').classList.toggle('hidden', $('task-repeat').value !== 'daily'));

function renderCodeProposals(proposals) {
  const root = $('code-proposals');
  root.replaceChildren();
  for (const proposal of proposals) {
    const card = document.createElement('article');
    card.className = 'code-proposal';
    const title = document.createElement('h3');
    title.textContent = `${proposal.file} · ${proposal.status === 'pending' ? 'Afventer godkendelse' : proposal.status === 'applied' ? 'Installeret' : proposal.status === 'rolledback' ? 'Rullet tilbage' : 'Afvist'}`;
    const summary = document.createElement('p');
    summary.textContent = proposal.summary;
    card.append(title, summary);
    if (proposal.status === 'applied') {
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = 'Fortryd installation';
      undo.addEventListener('click', async () => {
        if (!confirm(`Gendan backup af ${proposal.file}?`)) return;
        undo.disabled = true;
        try {
          await api(`/api/code/${proposal.id}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rollback' }) });
          toast('Backup gendannet. Genindlæs siden om nødvendigt.');
          await refreshCode();
        } catch (error) { toast(error.message); undo.disabled = false; }
      });
      card.append(undo);
    }
    if (proposal.status === 'pending') {
      const controls = document.createElement('div');
      controls.className = 'code-controls';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.textContent = 'Gennemse filændring';
      preview.addEventListener('click', async () => {
        preview.disabled = true;
        try {
          const { proposal: full } = await api(`/api/code/${proposal.id}`);
          const box = document.createElement('div');
          box.className = 'code-preview';
          for (const [label, content] of [['NUVÆRENDE FIL', full.original], ['FORESLÅET FIL', full.content]]) {
            const wrap = document.createElement('div');
            const caption = document.createElement('strong');
            caption.textContent = label;
            const pre = document.createElement('pre');
            pre.textContent = content;
            wrap.append(caption, pre);
            box.append(wrap);
          }
          card.querySelector('.code-preview')?.remove();
          card.append(box);
        } catch (error) { toast(error.message); }
        finally { preview.disabled = false; }
      });
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.textContent = 'Godkend og installér';
      approve.addEventListener('click', async () => {
        if (!card.querySelector('.code-preview')) return toast('Gennemse filerne, før du godkender.');
        if (!confirm(`Installér den foreslåede ændring i ${proposal.file}? Der oprettes backup.`)) return;
        approve.disabled = true;
        try {
          await api(`/api/code/${proposal.id}/action`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply' }),
          });
          toast('Ændringen er installeret. Genindlæs siden; persona kræver servergenstart.');
          await refreshCode();
        } catch (error) { toast(error.message); approve.disabled = false; }
      });
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = 'Afvis';
      reject.addEventListener('click', async () => {
        try {
          await api(`/api/code/${proposal.id}/action`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject' }),
          });
          await refreshCode();
        } catch (error) { toast(error.message); }
      });
      const warning = document.createElement('p');
      warning.className = 'warning';
      warning.textContent = 'Modelforslag kan indeholde fejl. Kontrollér ændringen, før du installerer.';
      controls.append(preview, approve, reject);
      card.append(warning, controls);
    }
    root.append(card);
  }
}

async function refreshCode() {
  const result = await api('/api/code');
  renderCodeProposals(result.proposals);
}

function renderProjects(projects) {
  const root = $('projects');
  root.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'muted small-text';
    empty.textContent = 'Ingen projekter endnu. Opret dit første projekt ovenfor.';
    root.append(empty);
    return;
  }
  for (const project of projects) {
    const card = document.createElement('article');
    card.className = 'project-card';
    const title = document.createElement('h3');
    title.textContent = project.title;
    const location = document.createElement('div');
    location.className = 'project-meta';
    location.textContent = `JARVIS-Projects/${project.slug} · Version ${project.revision}`;
    const description = document.createElement('p');
    description.textContent = project.lastSummary || project.description;
    card.append(title, location, description);
    if (project.lastTest) {
      const label = document.createElement('p');
      const statusNames = { passed: 'Bestået', failed: 'Fejlet', unavailable: 'Docker mangler', skipped: 'Kun statisk indhold' };
      label.className = `project-test-status ${project.lastTest.status}`;
      label.textContent = `Seneste test (version ${project.lastTest.revision}): ${statusNames[project.lastTest.status] || project.lastTest.status} · ${project.lastTest.summary}`;
      card.append(label);
      if (project.lastTest.reports?.length) {
        const report = document.createElement('details');
        report.className = 'project-files';
        const summary = document.createElement('summary');
        summary.textContent = 'Se testlog';
        const pre = document.createElement('pre');
        pre.textContent = project.lastTest.reports.map(r => `${r.image}\n${r.output}`).join('\n\n').slice(-9000);
        report.append(summary, pre);
        card.append(report);
      }
    }
    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.maxLength = 3000;
    textarea.placeholder = project.revision ? 'Hvad skal JARVIS forbedre?' : 'Byg den første version af projektet …';
    textarea.value = project.revision ? '' : project.description;
    card.append(textarea);
    const controls = document.createElement('div');
    controls.className = 'project-actions';
    const build = document.createElement('button');
    build.type = 'button';
    build.textContent = project.revision ? 'Videreudvikl' : 'Byg projekt';
    build.addEventListener('click', async () => {
      if (!textarea.value.trim()) return toast('Beskriv, hvad der skal bygges.');
      build.disabled = true;
      build.textContent = 'JARVIS skriver kode …';
      try {
        const result = await api(`/api/projects/${project.id}/develop`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: textarea.value }),
        });
        toast(`${result.changedFiles.length} fil(er) skrevet. Test: ${result.test.status}.`);
        await refreshProjects();
      } catch (error) { toast(error.message); }
      finally { build.disabled = false; build.textContent = 'Videreudvikl'; }
    });
    const view = document.createElement('button');
    view.type = 'button';
    view.textContent = 'Se projektfiler';
    view.addEventListener('click', async () => {
      view.disabled = true;
      try {
        const data = await api(`/api/projects/${project.id}`);
        const list = document.createElement('div');
        list.className = 'project-files';
        for (const file of data.project.files) {
          const detail = document.createElement('details');
          const name = document.createElement('summary');
          name.textContent = file.path;
          const pre = document.createElement('pre');
          pre.textContent = file.content;
          detail.append(name, pre);
          list.append(detail);
        }
        if (!data.project.files.length) list.textContent = 'Ingen filer endnu.';
        card.querySelector('.project-files')?.remove();
        card.append(list);
      } catch (error) { toast(error.message); }
      finally { view.disabled = false; }
    });
    controls.append(build, view);
    if (project.revision) {
      const test = document.createElement('button');
      test.type = 'button';
      test.textContent = 'Test isoleret';
      test.addEventListener('click', async () => {
        test.disabled = true;
        test.textContent = 'Tester …';
        try {
          const result = await api(`/api/projects/${project.id}/test`, { method: 'POST' });
          toast(`Teststatus: ${result.test.status}`);
          await refreshProjects();
        } catch (error) { toast(error.message); }
        finally { test.disabled = false; test.textContent = 'Test isoleret'; }
      });
      controls.append(test);
    }
    if (project.lastRollbackableRevision) {
      const rollback = document.createElement('button');
      rollback.type = 'button';
      rollback.textContent = 'Fortryd seneste kodeændring';
      rollback.addEventListener('click', async () => {
        if (!confirm('Gendan filerne fra før den seneste udviklingsrunde?')) return;
        rollback.disabled = true;
        try {
          await api(`/api/projects/${project.id}/rollback`, { method: 'POST' });
          toast('Projektfilerne er gendannet.');
          await refreshProjects();
        } catch (error) { toast(error.message); rollback.disabled = false; }
      });
      controls.append(rollback);
    }
    if (project.pendingPackages?.length) {
      const warning = document.createElement('p');
      warning.className = 'project-warning';
      warning.textContent = `Afventer installationsgodkendelse: ${project.pendingPackages.join(', ')}. Kontroller pakkenavne før du godkender.`;
      const install = document.createElement('button');
      install.type = 'button';
      install.textContent = 'Godkend npm-installation';
      install.addEventListener('click', async () => {
        if (!confirm(`Installér følgende npm-pakker i projektmappen?\n${project.pendingPackages.join('\n')}\n\nPakker kan indeholde ukendt kode. Installation kræver særskilt aktivering i .env.`)) return;
        install.disabled = true;
        try {
          await api(`/api/projects/${project.id}/install`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packages: project.pendingPackages }),
          });
          toast('npm-pakker installeret i projektmappen.');
          await refreshProjects();
        } catch (error) { toast(error.message); install.disabled = false; }
      });
      card.append(warning);
      controls.append(install);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'danger-button'; remove.textContent = 'Arkivér projekt';
    remove.addEventListener('click', async () => {
      if (!confirm(`Arkivér "${project.title}"? Projektmappen flyttes til et sikkert lokalt arkiv og kan gendannes.`)) return;
      try { await api(`/api/projects/${project.id}`, { method: 'DELETE' }); await refreshProjects(); toast('Projektet er arkiveret.'); }
      catch (error) { toast(error.message); }
    });
    controls.append(remove);
    card.append(controls);
    root.append(card);
  }
}

async function refreshProjects() {
  const data = await api('/api/projects');
  renderProjects(data.projects);
  const root = $('archived-projects');
  if (root) {
    root.replaceChildren();
    for (const entry of data.archived || []) {
      const line = document.createElement('div'); line.className = 'archived-entry';
      const title = document.createElement('span'); title.textContent = entry.title;
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'secondary'; restore.textContent = 'Gendan';
      restore.addEventListener('click', async () => {
        try { await api(`/api/projects/${entry.id}/restore`, { method: 'POST' }); await refreshProjects(); toast('Projektet er gendannet.'); }
        catch (error) { toast(error.message); }
      });
      line.append(title, restore); root.append(line);
    }
  }
}

const archivePanel = document.createElement('section');
archivePanel.className = 'panel archive-panel';
archivePanel.innerHTML = '<h2>Arkiverede projekter</h2><p class="muted small-text">Projektmapper bevares lokalt og kan gendannes.</p><div id="archived-projects"></div>';
$('tab-projects').append(archivePanel);

async function refreshSettings() {
  const settings = await api('/api/settings');
  $('max-runs').value = settings.maxRunsPerDay;
  $('reminders-enabled').checked = settings.remindersEnabled;
  $('discord-alerts-enabled').checked = settings.discordAlertsEnabled;
  $('https-url').value = settings.httpsUrl;
  $('settings-status').textContent = `Push: ${settings.pushConfigured ? 'konfigureret' : 'mangler nøgler'} · npm-installation: ${settings.npmInstallEnabled ? 'aktiveret' : 'låst på serveren'}`;
  const discord = await api('/api/discord/settings');
  $('discord-enabled').checked = discord.enabled;
  $('discord-user-id').value = discord.userId || '';
  $('discord-guild-id').value = discord.guildId || '';
  const names = { disabled: 'Deaktiveret', connecting: 'Forbinder', reconnecting: 'Genopretter forbindelse', connected: 'Forbundet', error: 'Fejl' };
  $('discord-status').textContent = `Discord: ${names[discord.status] || discord.status} · Token: ${discord.hasToken ? 'gemt' : 'mangler'}${discord.lastError ? ` · ${discord.lastError}` : ''}`;
}
$('discord-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/discord/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      enabled: $('discord-enabled').checked,
      token: $('discord-token').value,
      userId: $('discord-user-id').value,
      guildId: $('discord-guild-id').value,
    }) });
    $('discord-token').value = '';
    await refreshSettings();
    toast('Discord-indstillinger gemt.');
  } catch (error) { toast(error.message); }
});
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      maxRunsPerDay: Number($('max-runs').value), httpsUrl: $('https-url').value,
      remindersEnabled: $('reminders-enabled').checked,
      discordAlertsEnabled: $('discord-alerts-enabled').checked,
      pushUser: $('push-user').value, pushToken: $('push-token').value,
    }) });
    $('push-user').value = ''; $('push-token').value = '';
    await refreshSettings(); toast('Indstillinger gemt.');
  } catch (error) { toast(error.message); }
});

$('project-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('project-create').disabled = true;
  try {
    await api('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('project-title').value, description: $('project-description').value }),
    });
    $('project-title').value = '';
    $('project-description').value = '';
    toast('Projektmappen er oprettet. Tryk Byg projekt for at generere kode.');
    await refreshProjects();
  } catch (error) { toast(error.message); }
  finally { $('project-create').disabled = false; }
});

$('code-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('code-submit').disabled = true;
  $('code-submit').textContent = 'Udarbejder forslag …';
  try {
    await api('/api/code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: $('code-file').value, request: $('code-request').value }),
    });
    $('code-request').value = '';
    toast('Kodeforslaget er klar til gennemgang.');
    await refreshCode();
  } catch (error) { toast(error.message); }
  finally { $('code-submit').disabled = false; $('code-submit').textContent = 'Foreslå kodeændring'; }
});

$('task-when').addEventListener('change', () => {
  $('later-wrap').classList.toggle('hidden', $('task-when').value !== 'later');
});

$('task-form').addEventListener('submit', async event => {
  event.preventDefault();
  let runAt;
  if ($('task-when').value === 'later') {
    if (!$('task-run-at').value) return toast('Vælg et tidspunkt.');
    runAt = new Date($('task-run-at').value).toISOString();
  }
  $('task-submit').disabled = true;
  try {
    await api('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: $('task-title').value, prompt: $('task-prompt').value,
        category: $('task-category').value,
        intervalMinutes: $('task-repeat').value === 'daily' ? 0 : Number($('task-repeat').value),
        ...($('task-repeat').value === 'daily' ? { dailyTime: $('task-daily-time').value } : {}),
        ...(runAt ? { runAt } : {}),
      }),
    });
    $('task-title').value = '';
    $('task-prompt').value = '';
    toast('Opgaven er oprettet.');
    await refreshTasks();
  } catch (error) { toast(error.message); }
  finally { $('task-submit').disabled = false; }
});

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  token = $('token').value.trim();
  try {
    await refresh();
    await refreshProjects();
    await refreshSettings();
    localStorage.setItem('jarvisAccessToken', token);
    $('token').value = '';
  } catch (error) { toast(error.message); }
});

$('message-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('message').value.trim();
  if (!message) return;
  $('send').disabled = true;
  $('send').textContent = 'Tænker …';
  try {
    await api('/api/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    $('message').value = '';
    await refresh();
  } catch (error) { toast(error.message); }
  finally { $('send').disabled = false; $('send').textContent = 'Send ↗'; }
});

$('save-preferences').addEventListener('click', async () => {
  try {
    await api('/api/preferences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: $('preferences').value }),
    });
    toast('Dine noter er gemt.');
  } catch (error) { toast(error.message); }
});

$('refresh').addEventListener('click', () => refresh().catch(error => toast(error.message)));
$('logout').addEventListener('click', () => {
  stopVoice();
  localStorage.removeItem('jarvisAccessToken');
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
      });
      output = { ok: true, id: data.task.id, title: data.task.title, status: data.task.status, nextRunAt: data.task.nextRunAt };
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
  $('voice-status').textContent = 'Klar til at lytte, når du starter en samtale.';
}

async function startVoice() {
  if (startingVoice) return;
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

if (token) Promise.all([refresh(), refreshProjects(), refreshSettings()]).catch(() => showLogin());
else showLogin();

setInterval(() => {
  if (token && !$('workspace').classList.contains('hidden') && document.visibilityState === 'visible') {
    refreshTasks().catch(() => {});
    refreshSecretary().catch(() => {});
    api('/api/state').then(renderOverview).catch(() => {});
  }
}, 20_000);
