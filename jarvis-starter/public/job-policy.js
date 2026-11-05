// Versioned background-job policy. This editor only saves paused jobs; starting
// the reviewed revision is a separate, visible owner action on its job card.
const JarvisJobs = (() => {
  // This release's reviewed default, never an unbound "latest" alias. The
  // registry contract test keeps the bundled default and new templates aligned.
  const currentSkillVersion = '1.1.0';
  const defaults = Object.freeze({ 'task-category': 'research', 'task-title': '', 'task-prompt': '',
    'task-skill': '', 'task-parameters': '{}', 'task-when': 'now', 'task-run-at': '', 'task-repeat': '0',
    'task-daily-time': '07:30', 'task-time-zone': 'Europe/Copenhagen', 'task-budget-runs': '10',
    'task-budget-tokens': '3500', 'task-retry-count': '1', 'task-retry-delay': '5', 'task-missed-mode': 'coalesce',
    'task-missed-late': '120', 'task-quiet-start': '22:00', 'task-quiet-end': '07:00', 'task-deduplicate': 'true' });
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const secret = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b|\b(?:api[_ -]?key|password|adgangskode|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*["']?\s*[=:]\s*["']?[^\s,"'}]+/iu;
  const sensitive = (value, ownerToken = '') => secret.test(value) || ownerToken.length >= 6 && value.includes(ownerToken);
  const integer = (value, min, max, name) => {
    const parsed = Number(value);
    if (!String(value ?? '').trim() || !Number.isInteger(parsed) || parsed < min || parsed > max)
      throw new Error(`${name} skal være et helt tal mellem ${min} og ${max}.`);
    return parsed;
  };
  function parameters(text) {
    if (String(text).length > 4000) throw new Error('Parametrene må højst fylde 4.000 tegn.');
    let result;
    try { result = JSON.parse(text || '{}'); } catch { throw new Error('Parametrene skal være et gyldigt JSON-objekt. Din tekst er bevaret.'); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length > 20)
      throw new Error('Brug højst 20 navngivne parametre.');
    const scalar = value => value === null || typeof value === 'boolean' ||
      typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 1000;
    for (const [key, value] of Object.entries(result)) if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) ||
      ['constructor', 'prototype', '__proto__'].includes(key) ||
      !(scalar(value) || Array.isArray(value) && value.length <= 20 && value.every(scalar)))
      throw new Error('Parametre må kun indeholde enkle værdier og korte lister – ikke indlejrede objekter eller tilladelser.');
    return result;
  }
  function payload(values) {
    const value = { ...defaults, ...values }, title = value['task-title'].trim(), prompt = value['task-prompt'].trim();
    if (!title || title.length > 120) throw new Error('Skriv en titel på højst 120 tegn.');
    if (!prompt || prompt.length > 3500) throw new Error('Skriv en instruktion på højst 3.500 tegn.');
    if (sensitive(JSON.stringify(value))) throw new Error('Fjern adgangskoder, tokens og API-nøgler fra jobkladden.');
    if (!['research', 'briefing', 'monitor'].includes(value['task-category'])) throw new Error('Vælg en understøttet læsebaseret jobtype.');
    const zone = value['task-time-zone'];
    if (typeof zone !== 'string' || zone.length > 80) throw new Error('Vælg en gyldig IANA-tidszone.');
    try { new Intl.DateTimeFormat('da-DK', { timeZone: zone }); } catch { throw new Error('Vælg en gyldig IANA-tidszone.'); }
    const daily = value['task-repeat'] === 'daily';
    const intervalMinutes = daily ? 0 : integer(value['task-repeat'], 0, 43200, 'Gentagelse');
    if (intervalMinutes && intervalMinutes < 60) throw new Error('Gentagelser skal være mindst hver time.');
    if (daily && !clock.test(value['task-daily-time'])) throw new Error('Vælg det daglige klokkeslæt.');
    if (!clock.test(value['task-quiet-start']) || !clock.test(value['task-quiet-end']) || value['task-quiet-start'] === value['task-quiet-end'])
      throw new Error('Stilleperioden skal have to forskellige, gyldige klokkeslæt.');
    if (!['coalesce', 'skip', 'pause'].includes(value['task-missed-mode']) || !['true', 'false'].includes(value['task-deduplicate']))
      throw new Error('Vælg en gyldig politik for manglende kørsler og gentagelser.');
    const result = { title, prompt, category: value['task-category'], activation: 'paused', intervalMinutes,
      dailyTime: daily ? value['task-daily-time'] : null, runAt: null, timeZone: zone, parameters: parameters(value['task-parameters']),
      permissions: ['web.search'], budget: { maxRunsPerDay: integer(value['task-budget-runs'], 1, 100, 'Modelkørsler pr. døgn'),
        maxOutputTokens: integer(value['task-budget-tokens'], 256, 12000, 'Outputtokens') },
      retryPolicy: { maxRetries: integer(value['task-retry-count'], 0, 3, 'Genforsøg'),
        delayMinutes: integer(value['task-retry-delay'], 1, 180, 'Ventetid') },
      missedRunPolicy: { mode: value['task-missed-mode'], maxLatenessMinutes: integer(value['task-missed-late'], 1, 43200, 'Forsinkelse') },
      deliveryPolicy: { channel: 'inbox', quietStart: value['task-quiet-start'], quietEnd: value['task-quiet-end'], deduplicate: value['task-deduplicate'] === 'true' } };
    if (value['task-skill']) {
      const match = /^([a-z][a-z0-9-]{1,79})@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(value['task-skill']);
      if (!match) throw new Error('Proceduren skal have et præcist procedure-ID og versionsnummer.');
      [, result.skillId, result.skillVersion] = match;
    }
    if (!daily && value['task-when'] === 'later') {
      const instant = value['task-run-at'].trim();
      const match = /^(\d{4}-\d{2}-\d{2})T([0-2]\d):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(instant);
      if (!match || Number(match[2]) > 23 || !Number.isFinite(Date.parse(instant)) ||
          new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1])
        throw new Error('Angiv et gyldigt, entydigt tidspunkt med Z eller UTC-forskydning, fx 2026-11-06T09:00+01:00.');
      result.runAt = new Date(instant).toISOString();
    }
    return result;
  }
  function valuesFromTask(task) {
    return { ...defaults, 'task-title': task.title, 'task-prompt': task.prompt, 'task-category': task.category || 'research',
      'task-skill': task.skillId ? `${task.skillId}@${task.skillVersion}` : '', 'task-parameters': JSON.stringify(task.parameters || {}, null, 2),
      'task-repeat': task.dailyTime ? 'daily' : String(task.intervalMinutes || 0), 'task-daily-time': task.dailyTime || '07:30',
      'task-when': task.nextRunAt && !task.dailyTime && !task.startOnActivation ? 'later' : 'now', 'task-run-at': task.nextRunAt || '',
      'task-time-zone': task.timeZone || 'Europe/Copenhagen', 'task-budget-runs': String(task.budget?.maxRunsPerDay ?? 10),
      'task-budget-tokens': String(task.budget?.maxOutputTokens ?? 3500), 'task-retry-count': String(task.retryPolicy?.maxRetries ?? 1),
      'task-retry-delay': String(task.retryPolicy?.delayMinutes ?? 5), 'task-missed-mode': task.missedRunPolicy?.mode || 'coalesce',
      'task-missed-late': String(task.missedRunPolicy?.maxLatenessMinutes ?? 120), 'task-quiet-start': task.deliveryPolicy?.quietStart || '22:00',
      'task-quiet-end': task.deliveryPolicy?.quietEnd || '07:00', 'task-deduplicate': String(task.deliveryPolicy?.deduplicate ?? true) };
  }
  function policyLines(task) {
    const value = valuesFromTask(task);
    return [task.dailyTime ? `Dagligt kl. ${task.dailyTime} i ${value['task-time-zone']}`
      : task.intervalMinutes ? `Gentages hver ${task.intervalMinutes} minutter` : 'Én læsebaseret kørsel',
    `Budget: højst ${value['task-budget-runs']} nye modelkørsler pr. UTC-døgn og ${value['task-budget-tokens']} outputtokens pr. kørsel. Den fælles dagsgrænse gælder også; dette er ikke et kronebudget.`,
    `Midlertidige læsefejl: højst ${value['task-retry-count']} genforsøg med ${value['task-retry-delay']} minutters mellemrum. Uafklarede handlinger eller leveringer gentages aldrig blindt.`,
    `Mere end ${value['task-missed-late']} minutter forsinket: ${({ coalesce: 'saml op én gang', skip: 'spring over', pause: 'pause og afvent beslutning' })[value['task-missed-mode']]}.`,
    `Levering: JARVIS-indbakken. Stilleperiode ${value['task-quiet-start']}–${value['task-quiet-end']} (${value['task-time-zone']}); nyere ventende resultater samles. ${value['task-deduplicate'] === 'true' ? 'Ens observationer meddeles ikke igen.' : 'Hvert nyt kørselsresultat kan meddeles.'} Eventuelle eksterne notifikationer følger kun allerede valgte integrationsindstillinger.`,
    'Tilladelse: web.search – kun læsning. Ingen Nemlig-overførsel, køb, kalenderændring, nye datakilder eller nye modtagere.'];
  }
  function statusLabel(task) {
    if (task.status === 'scheduled' && task.retryAttempt) return `Genforsøg planlagt · ${task.retryAttempt}/${task.retryPolicy?.maxRetries ?? 1}`;
    if (['paused', 'interrupted'].includes(task.status) && (task.lastErrorKind === 'unknown' || task.lastRunStatus === 'unknown')) return 'Uafklaret udfald · pauset';
    if (['paused', 'failed'].includes(task.status) && task.lastErrorKind === 'permanent') return 'Permanent fejl · kræver gennemgang';
    return ({ scheduled: 'Planlagt', queued: 'Venter i kø', running: 'Arbejder …', completed: 'Gennemført',
      partially_completed: 'Delvist gennemført', unknown: 'Uafklaret udfald', failed: 'Fejlet', paused: 'Pauset',
      interrupted: 'Afbrudt · kræver gennemgang', archived: 'Arkiveret' })[task.status] || 'Ukendt status';
  }

  function attach({ document, api, getToken, refresh, navigateSkill, onOpen = () => {}, confirm = message => globalThis.confirm(message), storage }) {
    if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch { storage = null; } }
    const byId = id => document.getElementById(id), form = byId('task-form'), fields = Object.fromEntries(Object.keys(defaults).map(id => [id, byId(id)]));
    const key = 'jarvis:v5:job-policy-draft', status = byId('task-draft-status'), submit = byId('task-submit');
    let records = new Map(), skills = [], catalogPromise = null, catalogLoaded = false, catalogEpoch = 0;
    let editId = null, baseRevision = null, dirty = false, epoch = 0, identity = 0, saving = false, saveSequence = 0, errorMessage = '', conflict = '', storageReady = true;
    let owner = getToken();
    const node = (tag, text, className) => { const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
    const raw = () => Object.fromEntries(Object.entries(fields).map(([id, field]) => [id, field.value]));
    let lastFieldSnapshot = JSON.stringify(raw());
    const hasSecrets = () => sensitive(JSON.stringify(raw()), owner || '');
    function persist() {
      try {
        if (!owner || hasSecrets() || !dirty && !editId) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify({ values: raw(), editId, baseRevision, dirty }));
        storageReady = true;
      } catch { storageReady = false; }
    }
    function stateMessage(message = '') {
      const sensitiveMessage = hasSecrets() ? 'Følsomme oplysninger gemmes ikke i browserkladden. Fjern dem før gemning.' : '';
      const statusText = [message || errorMessage || conflict || (dirty ? 'Ugemt kladde. Polling og navigation ændrer ikke dine felter.'
        : editId ? `Jobrevision ${baseRevision} er gemt pauset. Start kræver et særskilt klik på jobkortet.` : 'Nye jobs gemmes altid pausede.'),
        sensitiveMessage, !storageReady ? 'Browseren afviser kladdelagring. Kopiér teksten før siden lukkes.' : ''].filter(Boolean).join(' ');
      if (status.textContent !== statusText) status.textContent = statusText;
      status.classList.toggle('v5-error', Boolean(errorMessage || conflict || sensitiveMessage));
      submit.disabled = saving || Boolean(conflict || sensitiveMessage);
      const submitLabel = saving ? 'Gemmer pauset job …' : editId ? 'Gem revideret job – fortsat pauset' : 'Gem pauset job';
      if (submit.textContent !== submitLabel) submit.textContent = submitLabel;
      byId('task-reload').hidden = !editId;
      byId('task-copy-draft').hidden = !editId;
    }
    function preview() {
      const daily = fields['task-repeat'].value === 'daily';
      byId('daily-wrap').classList.toggle('hidden', !daily);
      fields['task-when'].disabled = daily;
      byId('later-wrap').classList.toggle('hidden', daily || fields['task-when'].value !== 'later');
      const target = byId('task-policy-preview');
      target.replaceChildren(node('h3', 'Gennemgå før aktivering'));
      try {
        const values = { ...raw(), 'task-title': fields['task-title'].value || '(Titel mangler)', 'task-prompt': fields['task-prompt'].value || '(Instruktion mangler)' };
        const draft = payload(values);
        for (const text of policyLines(draft)) target.append(node('p', text, 'muted small-text'));
        if (draft.runAt) target.append(node('p', `Ønsket første start: ${draft.runAt} (UTC). En pauset kladde kører ikke.`, 'small-text'));
        if (draft.skillId) target.append(node('p', `Procedure: ${draft.skillId} · version ${draft.skillVersion}`, 'small-text'));
      } catch (error) { target.append(node('p', error.message, 'v5-conflict')); }
    }
    function changed(event) {
      const next = JSON.stringify(raw());
      // WebKit dispatches change on blur during a click. A duplicate value
      // must not replace submit text or preview nodes before click arrives.
      if (event && next === lastFieldSnapshot) return;
      lastFieldSnapshot = next;
      dirty = true; epoch++; persist(); stateMessage(); preview();
    }
    function ensureOption(field, value, text = value) {
      if (![...field.options].some(option => option.value === value)) { const option = node('option', text); option.value = value; field.append(option); }
    }
    function fill(values) {
      for (const [id, field] of Object.entries(fields)) {
        const value = String(values[id] ?? defaults[id]);
        if (field.tagName === 'SELECT') ensureOption(field, value);
        field.value = value;
      }
      lastFieldSnapshot = JSON.stringify(raw());
      preview();
    }
    function reset() {
      identity++; epoch++; editId = null; baseRevision = null; dirty = false; conflict = ''; errorMessage = '';
      fill(defaults); persist(); stateMessage();
    }
    function show({ focus = true } = {}) {
      onOpen({ category: fields['task-category'].value, id: editId });
      const shell = byId('task-editor-shell');
      if (shell) shell.open = true;
      if (focus) { fields['task-title'].focus(); form.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }
    }
    function edit(task, { discard = false } = {}) {
      if (dirty && !discard && !confirm('Erstat den uafsluttede jobkladde med den valgte gemte revision?')) return false;
      if (!['paused', 'interrupted'].includes(task.status)) throw new Error('Pause jobbet, før du redigerer det.');
      identity++; epoch++; editId = task.id; baseRevision = task.revision || 1; dirty = false; conflict = ''; errorMessage = '';
      fill(valuesFromTask(task)); persist(); stateMessage(); show();
      return true;
    }
    async function loadSkills() {
      if (!getToken() || catalogLoaded || catalogPromise) return catalogPromise;
      const requestedOwner = getToken(), request = ++catalogEpoch;
      catalogPromise = (async () => {
        try {
          const result = await api('/api/skills');
          if (requestedOwner !== getToken() || request !== catalogEpoch) return;
          skills = result.skills || [];
          for (const skill of skills) {
            const label = `${skill.name} · version ${skill.version}${skill.current === true ? ' (aktuel)' : skill.current === false ? ' (historisk)' : ''}`;
            ensureOption(fields['task-skill'], `${skill.name}@${skill.version}`, label);
            const option = [...fields['task-skill'].options].find(item => item.value === `${skill.name}@${skill.version}`);
            if (option) option.textContent = label;
          }
          catalogLoaded = true;
          byId('task-skill-status').textContent = 'Aktuelle og historiske versioner vises særskilt. En valgt version eller gemt job opgraderes aldrig automatisk. Kilde og indholdshash vises på jobbet.';
        } catch (error) { if (requestedOwner === getToken() && request === catalogEpoch)
          byId('task-skill-status').textContent = `Procedurekataloget er utilgængeligt: ${error.message}. En allerede valgt version bevares.`; }
      })().finally(() => { if (request === catalogEpoch) catalogPromise = null; });
      return catalogPromise;
    }
    function observe(tasks) {
      if (owner !== getToken()) { saving = false; saveSequence++; reset(); owner = getToken(); skills = []; catalogLoaded = false; catalogPromise = null; catalogEpoch++; }
      records = new Map(tasks.map(task => [task.id, task]));
      if (editId) {
        const current = records.get(editId);
        conflict = !current ? 'Det redigerede job er fjernet eller ikke længere tilgængeligt. Kladden er bevaret og kan gemmes som et nyt pauset job.'
          : (current.revision || 1) !== baseRevision ? 'Jobbet er ændret et andet sted. Din kladde og basisrevision er bevaret; hent og gennemgå den aktuelle revision før en ny gemning.'
            : !['paused', 'interrupted'].includes(current.status) ? 'Jobbet er ikke længere pauset. Kladden er bevaret; pause jobbet før gemning.' : '';
      }
      stateMessage();
      if (!byId('tab-plan').classList.contains('hidden') || byId('tab-watches') && !byId('tab-watches').classList.contains('hidden')) void loadSkills();
    }
    const post = (path, method, data) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    async function save(event) {
      event.preventDefault();
      if (saving) return;
      const startedEpoch = epoch, startedIdentity = identity, startedOwner = getToken(), startedId = editId, saveId = ++saveSequence;
      try {
        if (!startedOwner) throw new Error('Log ind, før du gemmer et job.');
        if (conflict) throw new Error(conflict);
        if (hasSecrets()) throw new Error('Fjern adgangskoder, tokens og API-nøgler fra jobkladden.');
        const data = payload(raw());
        if (startedId) { data.expectedRevision = baseRevision; if (!data.skillId) { data.skillId = null; data.skillVersion = null; } }
        saving = true; errorMessage = ''; stateMessage();
        const result = await post(startedId ? `/api/tasks/${startedId}` : '/api/tasks', startedId ? 'PATCH' : 'POST', data);
        if (startedOwner !== getToken()) return;
        records.set(result.task.id, result.task);
        if (startedIdentity === identity) {
          editId = result.task.id; baseRevision = result.task.revision || 1; conflict = '';
          dirty = startedEpoch !== epoch;
          persist();
          stateMessage(dirty ? 'Den indsendte revision er gemt pauset. Dine nyere ændringer er bevaret som uafsluttet kladde.' : 'Jobbet er gemt pauset. Ingen modelkørsel eller ekstern læsning er startet.');
        }
        await refresh();
      } catch (error) {
        if (startedOwner === getToken() && startedIdentity === identity) {
          errorMessage = `Ikke gemt: ${error.message} Din kladde er bevaret.`; persist(); stateMessage();
        }
      } finally { if (saveId === saveSequence && startedOwner === getToken()) { saving = false; stateMessage(); } }
    }
    function actionButton(card, task, action, text, after) {
      const button = node('button', text); button.type = 'button'; button.dataset.taskAction = action;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        const note = card.querySelector('[data-job-action-status]'), requestedOwner = getToken();
        if (!requestedOwner) { note.textContent = 'Log ind, før du ændrer jobbet.'; return; }
        if (['run', 'resume'].includes(action) && editId === task.id && dirty) {
          note.textContent = 'Gem eller kassér dine ændringer før aktivering. Det er den gemte revision, der køres.';
          stateMessage(note.textContent); return;
        }
        if (['run', 'resume'].includes(action) && ['unknown', 'partially_completed'].includes(task.lastRunStatus) &&
          !confirm('Det tidligere udfald er uafklaret eller delvist. Har du gennemgået resultatet og vil nu starte den viste læsebaserede revision?')) return;
        if (action === 'archive' && !confirm(`Arkivér jobbet "${task.title}"? Historikken bevares.`)) return;
        button.disabled = true; note.classList.remove('v5-error');
        note.textContent = 'Afventer bekræftelse …';
        let confirmed = false;
        try {
          const { task: updated } = await post(`/api/tasks/${task.id}/action`, 'POST', { action, expectedRevision: task.revision || 1 });
          if (requestedOwner !== getToken()) return;
          confirmed = true; records.set(updated.id, updated);
          const message = action === 'archive' ? 'Jobbet er arkiveret; historikken er bevaret.'
            : action === 'pause' ? 'Jobbet er pauset. En allerede igangsat ekstern handling antages ikke fortrudt.' : 'Den gennemgåede revision er aktiveret.';
          note.textContent = message;
          if (after) after(updated, { action, message });
          await refresh();
        } catch (error) { if (requestedOwner === getToken()) {
          note.textContent = confirmed ? `Handlingen er bekræftet, men oversigten kunne ikke opdateres: ${error.message}` : error.message;
          note.classList.add('v5-error');
        } } finally { button.disabled = false; }
      });
      return button;
    }
    function actionsFor(record, { compact = false, after } = {}) {
      // Actions retain the exact displayed revision, including when the same
      // controller supplies the dedicated monitoring view.
      const task = JSON.parse(JSON.stringify(record));
      const actions = node('div', undefined, compact ? 'task-actions watch-actions' : 'task-actions');
      const note = node('p', '', 'small-text'); note.dataset.jobActionStatus = ''; note.setAttribute('role', 'status');
      actions.append(note);
      let extra = actions;
      if (compact) { extra = node('details'); extra.dataset.jobSection = 'more-actions'; extra.append(node('summary', 'Flere handlinger')); }
      if (task.status !== 'running') {
        if (task.status !== 'queued') {
          extra.append(actionButton(actions, task, 'run', task.responseId ? 'Genoptag eksisterende læsning' : 'Kør den viste revision nu', after));
          if (['paused', 'interrupted', 'failed', 'completed'].includes(task.status) && (task.dailyTime || task.intervalMinutes))
            actions.append(actionButton(actions, task, 'resume', compact ? 'Genoptag' : 'Aktivér den viste tidsplan', after));
        }
        if (['paused', 'interrupted'].includes(task.status)) {
          const editButton = node('button', compact ? 'Redigér' : 'Redigér pauset job'); editButton.type = 'button'; editButton.dataset.taskAction = 'edit';
          editButton.disabled = Boolean(task.responseId);
          editButton.addEventListener('click', () => { try { edit(task); } catch (error) { note.textContent = error.message; } });
          actions.append(editButton);
        } else actions.append(actionButton(actions, task, 'pause', task.status === 'queued' ? 'Annullér ventende kørsel'
          : compact && task.status === 'scheduled' ? 'Pause' : 'Pause før redigering', after));
        extra.append(actionButton(actions, task, 'archive', 'Arkivér job', after));
        if (compact) actions.append(extra);
      } else note.textContent = 'Arbejdet er startet. En ekstern virkning kan ikke annulleres eller antages rullet tilbage.';
      return actions;
    }
    function cardFor(record, { actions = true, identify = true } = {}) {
      // Every button is bound to the exact displayed snapshot, even if an
      // in-process caller later mutates the object used to render the card.
      const task = JSON.parse(JSON.stringify(record));
      const card = node('article', undefined, 'task-card');
      if (identify) { card.dataset.taskId = task.id; card.dataset.jobKey = task.id; }
      card.jobSignature = JSON.stringify(task);
      const top = node('div', undefined, 'task-top'); top.append(node('h3', task.title), node('span', statusLabel(task), `task-pill ${task.status}`));
      card.append(top, node('p', `Jobrevision ${task.revision || 1} · ${task.nextRunAt ? `Ønsket næste start: ${task.nextRunAt} (UTC)` : 'Ingen næste start fastsat'}`, 'task-schedule'), node('p', task.prompt));
      if (task.interruptionReason) card.append(node('p', task.interruptionReason, 'v5-conflict'));
      if (task.responseId) card.append(node('p', 'En kendt, eksisterende modellæsning skal afklares. Den genstartes ikke med nye parametre.', 'v5-conflict'));
      const policy = node('details'); policy.dataset.jobSection = 'policy';
      policy.append(node('summary', 'Gennemgå tidsplan, version, parametre og tilladelser'));
      for (const line of policyLines(task)) policy.append(node('p', line, 'small-text'));
      policy.append(node('pre', JSON.stringify(task.parameters || {}, null, 2)));
      if (task.skillId) {
        const link = node('a', `Åbn procedure ${task.skillId} · version ${task.skillVersion}`);
        const source = `skill:${task.skillId}:${task.skillVersion}`;
        link.href = `?view=knowledge&source=${encodeURIComponent(source)}`;
        link.addEventListener('click', event => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); navigateSkill(source); });
        policy.append(link, node('p', `Indholdshash: ${task.skillContentHash || 'Ikke dokumenteret; ny gennemgang kræves før versionsbundet ændring.'}`, 'micro'));
      } else policy.append(node('p', 'Ingen særskilt procedureversion; den viste jobinstruktion er grundlaget.', 'small-text'));
      card.append(policy);
      for (const [index, run] of (task.runs || []).slice(0, 3).entries()) {
        const detail = node('details', undefined, 'task-result'); detail.dataset.jobSection = `run:${run.id || index}`;
        detail.append(node('summary', `${index ? 'Tidligere' : 'Seneste'} kørsel · ${statusLabel(run)} · ${run.at || run.endedAt || ''}`), node('pre', run.result || 'Intet bekræftet tekstresultat.'));
        if (run.observation) detail.append(node('p', `Observation: ${({ changed: 'ændret', unchanged: 'uændret', unknown: 'ukendt' })[run.observation.status] || 'ukendt'} · kilde ${run.observation.source || 'mangler'}`, 'small-text'));
        if (run.delivery) detail.append(node('p', `Levering: ${({ pending: 'venter', sending: 'afsendelse påbegyndt', delivered: 'bekræftet', not_delivered: 'ikke leveret', unknown: 'uafklaret – gentages ikke', skipped: 'udeladt efter politik' })[run.delivery.status] || 'ukendt'}${run.delivery.note ? ` · ${run.delivery.note}` : ''}`, 'small-text'));
        if (run.binding) detail.append(node('p', `Faktisk kørselsgrundlag: ${run.binding.skillId || 'jobinstruktion'}${run.binding.skillVersion ? ` v${run.binding.skillVersion}` : ''} · ${run.binding.timeZone || 'tidszone ukendt'} · ${run.binding.bindingHash || 'hash ikke tilgængelig'}`, 'micro'));
        card.append(detail);
      }
      if (actions) card.append(actionsFor(task));
      return card;
    }
    function render(tasks, usage = {}, { filter = () => true } = {}) {
      observe(tasks);
      const visible = tasks.filter(filter), visibleIds = new Set(visible.map(task => task.id));
      byId('usage').textContent = `${usage.started || 0}/${usage.maxRunsPerDay || 10} NYE KØRSLER · UTC-DØGN`;
      const target = byId('tasks'), old = new Map([...target.children].filter(card => card.dataset.jobKey).map(card => [card.dataset.jobKey, card]));
      const stale = card => { let note = card.querySelector('[data-job-stale]');
        if (!note) { note = node('p', '', 'v5-conflict'); note.dataset.jobStale = ''; note.setAttribute('role', 'status'); card.append(note); }
        note.textContent = 'Jobbet er ændret et andet sted. Fokus og den viste revision er bevaret; genindlæs før en ændring.'; };
      for (const [id, card] of old) if (!visibleIds.has(id)) { if (card.contains(document.activeElement)) stale(card); else card.remove(); }
      for (const child of [...target.children]) if (!child.dataset.jobKey) child.remove();
      for (const task of visible) {
        const current = old.get(task.id);
        if (current?.jobSignature === JSON.stringify(task)) continue;
        if (current?.contains(document.activeElement)) { stale(current); continue; }
        const replacement = cardFor(task);
        if (current) {
          const open = new Set([...current.querySelectorAll('details')].filter(item => item.open).map(item => item.dataset.jobSection));
          for (const details of replacement.querySelectorAll('details')) details.open = open.has(details.dataset.jobSection);
          if (current.classList.contains('source-target')) replacement.classList.add('source-target');
          target.insertBefore(replacement, current); current.remove();
        } else target.append(replacement);
      }
      if (!target.children.length) target.append(node('p', 'Ingen JARVIS-job endnu. Gem en pauset kladde og gennemgå den før start.', 'task-empty'));
    }
    form.addEventListener('input', changed); form.addEventListener('change', changed);
    fields['task-skill'].addEventListener('focus', () => void loadSkills());
    byId('task-new-draft').addEventListener('click', () => { if (!dirty || confirm('Kassér den uafsluttede jobkladde og begynd forfra?')) reset(); });
    byId('task-reload').addEventListener('click', () => { const task = records.get(editId);
      if (!task) { errorMessage = 'Jobbet er ikke længere tilgængeligt. Kladden kan gemmes som et nyt pauset job.'; stateMessage(); return; }
      try { edit(task); } catch (error) { errorMessage = error.message; stateMessage(); } });
    byId('task-copy-draft').addEventListener('click', () => { identity++; editId = null; baseRevision = null; conflict = ''; errorMessage = ''; changed(); });
    byId('logout').addEventListener('click', () => { saving = false; saveSequence++; reset(); owner = ''; records.clear(); byId('tasks').replaceChildren();
      skills = []; catalogLoaded = false; catalogPromise = null; catalogEpoch++; try { storage.removeItem(key); } catch { /* Cleared in-memory state remains private. */ } });
    globalThis.addEventListener?.('beforeunload', event => { if (dirty && (!storageReady || hasSecrets())) { event.preventDefault(); event.returnValue = ''; } });
    try {
      if (owner) {
        const saved = JSON.parse(storage.getItem(key) || 'null');
        if (saved?.values && JSON.stringify(saved).length <= 20_000 && Object.keys(saved.values).every(id => Object.hasOwn(defaults, id)) &&
            Object.values(saved.values).every(value => typeof value === 'string' && value.length <= 4000) && !sensitive(JSON.stringify(saved.values), owner)) {
          editId = typeof saved.editId === 'string' && /^[0-9a-f-]{36}$/.test(saved.editId) ? saved.editId : null;
          baseRevision = Number.isSafeInteger(saved.baseRevision) ? saved.baseRevision : null;
          dirty = Boolean(saved.dirty); fill(saved.values); stateMessage('Jobkladde gendannet. Gennemgå revision og politik før gemning eller aktivering.');
        } else { fill(defaults); stateMessage(); }
      } else { storage.removeItem(key); fill(defaults); stateMessage(); }
    } catch { storageReady = false; fill(defaults); stateMessage(); }
    return Object.freeze({ render, save, edit, show, cardFor, actionsFor, loadSkills, changed,
      template(values, { skillId } = {}) { if (dirty && !confirm('Erstat den uafsluttede jobkladde med denne skabelon?')) return false;
        const skill = skillId && skills.find(item => item.name === skillId && item.current === true);
        const version = skill?.version || currentSkillVersion;
        const selected = skillId ? { 'task-skill': `${skillId}@${version}`,
          'task-budget-runs': String(skill?.budgetDefaults?.maxRunsPerDay ?? 1),
          'task-budget-tokens': String(skill?.budgetDefaults?.maxOutputTokens ?? (skillId === 'personal-follow-up' ? 2500 : 3500)) } : {};
        reset(); fill({ ...defaults, ...selected, ...values }); changed(); show(); void loadSkills(); return true; } });
  }
  return Object.freeze({ currentSkillVersion, defaults, parameters, payload, valuesFromTask, policyLines, statusLabel, sensitive, attach });
})();
