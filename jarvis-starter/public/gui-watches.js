// A view of existing monitor jobs. It neither creates a new monitoring backend
// nor infers product matches from free text or an unsuccessful observation.
const JarvisWatches = (() => {
  const active = new Set(['scheduled', 'queued', 'running']);
  const paused = new Set(['paused', 'interrupted']);
  const currencies = new Set(['DKK', 'EUR', 'NOK', 'SEK', 'USD', 'GBP']);
  const instant = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  function sourceUrl(value) {
    if (typeof value !== 'string' || !/^https:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(value)) return null;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  }
  function knownObservation(run) {
    const item = run?.observation;
    return Boolean(item && !run.errorKind && run.status !== 'failed' && sourceUrl(item.source) &&
      typeof item.subject === 'string' && item.subject.trim() &&
      (typeof item.value === 'number' && Number.isFinite(item.value) || typeof item.value === 'string' && item.value.trim()));
  }
  function formatTime(value, timeZone = 'Europe/Copenhagen') {
    if (instant(value) === null) return 'Tidspunkt ukendt';
    try { return new Intl.DateTimeFormat('da-DK', { timeZone, dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value)); }
    catch { return new Intl.DateTimeFormat('da-DK', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value)) + ' UTC'; }
  }
  const localParts = (formatter, date) => Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  // Find the next local-date occurrence, following the existing engine's daily
  // schedule. Offset candidates handle DST gaps without assuming 24-hour days.
  function nextDailyCheck(after, clock, timeZone) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock || '')) return null;
    try {
      const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const p = localParts(formatter, new Date(after));
      const [hour, minute] = clock.split(':').map(Number);
      for (let day = 1; day <= 3; day++) {
        const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + day, hour, minute);
        const wanted = new Date(wall), candidates = new Set();
        for (let hours = -24; hours <= 24; hours += 6) {
          const probe = wall + hours * 3600000, part = localParts(formatter, new Date(probe));
          const offset = Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute)) - probe;
          const candidate = wall - offset, actual = localParts(formatter, new Date(candidate));
          if (Number(actual.year) === wanted.getUTCFullYear() && Number(actual.month) === wanted.getUTCMonth() + 1 &&
              Number(actual.day) === wanted.getUTCDate() && Number(actual.hour) === hour && Number(actual.minute) === minute && candidate > after)
            candidates.add(candidate);
        }
        if (candidates.size) return Math.min(...candidates);
      }
    } catch { /* An unknown schedule cannot establish freshness. */ }
    return null;
  }
  const parameterKey = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
  function presentation(task, now = Date.now()) {
    const runs = Array.isArray(task.runs) ? task.runs : [], latest = runs[0] || null;
    const known = runs.find(knownObservation) || null, observation = known?.observation || null;
    const group = active.has(task.status) ? 'active' : paused.has(task.status) ? 'paused' : 'other';
    const operationLabel = ({ scheduled: 'Aktiv', queued: 'Aktiv · venter i kø', running: 'Aktiv · kontrollerer',
      paused: 'Pauset', interrupted: 'Afbrudt · kræver gennemgang', completed: 'Afsluttet', failed: 'Stoppet efter fejl', archived: 'Arkiveret' })[task.status] || 'Tilstand ukendt';
    let check = 'untried', checkLabel = 'Endnu ikke kontrolleret';
    if (latest?.errorKind || latest?.status === 'failed' || !latest && task.lastRunStatus === 'failed') {
      check = latest?.errorKind === 'unknown' ? 'unknown' : 'failed';
      checkLabel = check === 'unknown' ? 'Kontrollens udfald er uafklaret' : 'Kontrol mislykkedes';
    } else if (latest) {
      check = knownObservation(latest) ? 'success' : 'unknown';
      checkLabel = check === 'success' ? latest.observation.status === 'unknown'
        ? 'Kontrol gennemført · ændring endnu ikke afgjort' : 'Kontrol gennemført' : 'Ingen brugbar observation fra seneste kontrol';
    } else if (task.lastRunStatus) { check = 'unknown'; checkLabel = 'Kontrolhistorik ikke tilgængelig'; }
    const observedAt = instant(observation?.observedAt) === null ? null : observation.observedAt;
    const lastSuccessAt = instant(known?.at) === null ? null : known.at;
    const attempted = task.status === 'running' && task.activeRun?.startedAt || latest?.startedAt || latest?.at;
    const lastAttemptAt = instant(attempted) === null ? null : attempted;
    const timeZone = task.timeZone || 'Europe/Copenhagen';
    const changedCriteria = Boolean(known?.binding &&
      (typeof known.binding.prompt === 'string' && known.binding.prompt !== task.prompt ||
        known.binding.parameters && parameterKey(known.binding.parameters) !== parameterKey(task.parameters)));
    const measured = instant(observedAt), nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.parse(now);
    let expires = null, freshness = 'unknown', freshnessLabel = 'Aktualitet ukendt';
    if (measured !== null && measured <= nowMs && !changedCriteria) {
      if (task.dailyTime) expires = nextDailyCheck(measured, task.dailyTime, timeZone);
      else if (Number.isFinite(Number(task.intervalMinutes)) && Number(task.intervalMinutes) > 0)
        expires = measured + Number(task.intervalMinutes) * 60000;
      if (expires !== null) {
        freshness = nowMs >= expires ? 'stale' : known === latest && check === 'success' ? 'fresh' : 'unknown';
        freshnessLabel = freshness === 'stale' ? 'Forældet i forhold til kontrolplanen'
          : freshness === 'fresh' ? 'Inden for kontrolplanens interval' : 'Aktualitet ukendt efter seneste kontrol';
      }
    }
    if (changedCriteria) freshnessLabel = 'Aktualitet ukendt · kriterierne er ændret siden målingen';
    const unit = typeof observation?.unit === 'string' ? observation.unit : '', price = currencies.has(unit.toUpperCase());
    let value = observation ? String(observation.value) : null;
    if (observation && typeof observation.value === 'number') value = price
      ? new Intl.NumberFormat('da-DK', { style: 'currency', currency: unit.toUpperCase() }).format(observation.value)
      : new Intl.NumberFormat('da-DK').format(observation.value) + (unit ? ` ${unit}` : '');
    else if (observation && unit) value += ` ${unit}`;
    const nextRunAt = group === 'active' && task.status !== 'running' && instant(task.nextRunAt) !== null ? task.nextRunAt : null;
    return { group, operation: task.status, operationLabel, check, checkLabel, freshness, freshnessLabel,
      criteria: String(task.prompt || ''), changedCriteria, observation, value, valueLabel: price ? 'Senest kendte pris' : 'Senest kendte måling',
      source: sourceUrl(observation?.source), observedAt, lastAttemptAt, lastSuccessAt, nextRunAt,
      nextRunLabel: instant(nextRunAt) !== null && instant(nextRunAt) > nowMs ? 'Næste kontrol' : 'Planlagt kontrol', timeZone,
      schedule: task.dailyTime ? `Dagligt kl. ${task.dailyTime}` : task.intervalMinutes ? `Hver ${task.intervalMinutes} minutter` : 'En enkelt kontrol' };
  }

  function attach({ document, editor, navigate = () => {}, getToken = () => '' }) {
    const byId = id => document.getElementById(id), list = byId('watches-list'), status = byId('watches-status');
    const node = (tag, text, className) => { const item = document.createElement(tag);
      if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
    const filterButtons = [...document.querySelectorAll('[data-watch-filter]')];
    let records = new Map(), filter = 'all', owner = getToken(), hasLoaded = false, lastError = '';
    const report = message => { status.textContent = message; status.classList.toggle('v5-error', Boolean(lastError)); };
    function updated(task, { action, message }) {
      const previous = [...list.children].find(row => row.dataset.watchId === task.id);
      const hadFocus = previous?.contains(document.activeElement);
      if (task.archived || task.status === 'archived') records.delete(task.id); else records.set(task.id, task);
      draw({ forceId: task.id }); report(message);
      if (hadFocus) {
        const row = [...list.children].find(item => item.dataset.watchId === task.id);
        if (row) row.focus(); else filterButtons.find(button => button.dataset.watchFilter === filter)?.focus();
      }
    }
    function rowFor(task) {
      const item = presentation(task), row = node('article', undefined, 'watch-card');
      row.dataset.watchId = task.id; row.dataset.taskId = task.id; row.dataset.watchOperation = item.operation; row.dataset.watchFreshness = item.freshness;
      row.watchSignature = JSON.stringify(task); row.tabIndex = -1;
      const heading = node('div', undefined, 'watch-heading');
      heading.append(node('h3', task.title), node('span', item.operationLabel, 'task-pill'));
      row.append(heading, node('p', item.criteria.length > 180 ? item.criteria.slice(0, 180) + '…' : item.criteria, 'watch-criteria'));
      row.append(node('p', item.checkLabel, item.check === 'failed' || item.check === 'unknown' ? 'watch-check v5-error' : 'watch-check'));
      if (item.observation) {
        row.append(node('p', `${item.valueLabel}: ${item.value}`, 'watch-result'), node('p', item.freshnessLabel, 'watch-meta muted'));
        const source = node('p', `Målt: ${formatTime(item.observedAt, item.timeZone)} · `, 'watch-meta muted');
        const link = node('a', 'Åbn målingens kilde'); link.href = item.source; link.target = '_blank'; link.rel = 'noopener noreferrer'; source.append(link); row.append(source);
      } else row.append(node('p', 'Ingen brugbar observation i den tilgængelige historik. Aktualitet ukendt.', 'watch-meta muted'));
      const zone = item.timeZone === 'Europe/Copenhagen' ? 'dansk tid' : item.timeZone;
      const times = [`Seneste forsøg: ${formatTime(item.lastAttemptAt, item.timeZone)}`, `Seneste succes: ${formatTime(item.lastSuccessAt, item.timeZone)}`];
      if (item.nextRunAt) times.push(`${item.nextRunLabel}: ${formatTime(item.nextRunAt, item.timeZone)}`);
      row.append(node('p', times.join(' · ') + ` (${zone})`, 'watch-meta muted'));
      const details = node('details', undefined, 'watch-details'); details.dataset.watchSection = 'details';
      details.append(node('summary', 'Kriterier, tidsplan og historik'),
        node('p', 'Værdierne er rapporteret af assistenten. Kildelinket er ikke en uafhængig bekræftelse af, at kilden er læst. Ændringer sammenlignes kun ved samme kilde, emne, variant, enhed og værditype.', 'watch-meta muted'),
        editor.cardFor(task, { actions: false, identify: false }));
      row.append(editor.actionsFor(task, { compact: true, after: updated }), details);
      return row;
    }
    function stale(row, text) {
      let note = row.querySelector('[data-watch-stale]');
      if (!note) { note = node('p', '', 'v5-conflict'); note.dataset.watchStale = ''; note.setAttribute('role', 'status'); row.append(note); }
      note.textContent = text;
    }
    function draw({ forceId = null } = {}) {
      const values = [...records.values()].filter(task => filter === 'all' || presentation(task).group === filter);
      const wanted = new Set(values.map(task => task.id));
      const old = new Map([...list.children].filter(row => row.dataset.watchId).map(row => [row.dataset.watchId, row]));
      for (const child of [...list.children]) if (!child.dataset.watchId) child.remove();
      for (const [id, row] of old) if (!wanted.has(id)) {
        if (id !== forceId && row.contains(document.activeElement)) stale(row, 'Denne overvågning er ændret eller fjernet. Den viste revision er bevaret, mens du har fokus her.');
        else row.remove();
      }
      for (const task of values) {
        const previous = old.get(task.id), item = presentation(task);
        if (previous?.watchSignature === JSON.stringify(task) && previous.dataset.watchFreshness === item.freshness && task.id !== forceId) continue;
        if (previous?.contains(document.activeElement) && task.id !== forceId) { stale(previous, 'Overvågningen er ændret. Den viste revision og dit fokus er bevaret. Opdater før en ændring.'); continue; }
        const replacement = rowFor(task);
        if (previous?.parentNode === list) {
          const open = new Set([...previous.querySelectorAll('details')].filter(detail => detail.open).map(detail => detail.dataset.watchSection || detail.dataset.jobSection));
          for (const detail of replacement.querySelectorAll('details')) detail.open = open.has(detail.dataset.watchSection || detail.dataset.jobSection);
          if (previous.classList.contains('source-target')) replacement.classList.add('source-target');
          list.insertBefore(replacement, previous); previous.remove();
        } else list.append(replacement);
      }
      if (!list.children.length && hasLoaded) list.append(node('p', records.size ? `Ingen ${filter === 'active' ? 'aktive' : 'pausede'} overvågninger.` : 'Ingen overvågninger endnu. Opret en pauset kladde, og gennemgå den før start.', 'task-empty'));
      for (const button of filterButtons) { button.setAttribute('aria-pressed', String(button.dataset.watchFilter === filter)); button.classList.toggle('active', button.dataset.watchFilter === filter); }
    }
    function render(tasks) {
      if (owner !== getToken()) { list.replaceChildren(); records.clear(); owner = getToken(); }
      records = new Map(tasks.filter(task => task.category === 'monitor' && !task.archived).map(task => [task.id, task]));
      hasLoaded = true; lastError = ''; list.setAttribute('aria-busy', 'false'); draw();
      report(records.size ? `${records.size} ${records.size === 1 ? 'overvågning' : 'overvågninger'}. Resultaterne følger deres egne kilder og måletidspunkter.` : 'Overvågninger er hentet.');
    }
    function loading() { list.setAttribute('aria-busy', 'true'); report(hasLoaded ? 'Opdaterer overvågninger …' : 'Henter overvågninger …'); }
    function error(message) {
      lastError = String(message || 'Ukendt fejl'); list.setAttribute('aria-busy', 'false');
      report(`Kunne ikke hente overvågninger: ${lastError}${hasLoaded ? ' Tidligere indlæste oplysninger kan være forældede.' : ''}`);
    }
    function open(id) {
      if (!records.has(id)) return false;
      filter = 'all'; draw(); navigate('watches', { sourceId: `task:${id}`, preserveDestination: true });
      const row = [...list.children].find(item => item.dataset.watchId === id);
      if (!row) return false;
      const details = row.querySelector('[data-watch-section="details"]'); if (details) details.open = true;
      row.classList.add('source-target'); row.focus(); row.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); return true;
    }
    for (const button of filterButtons) button.addEventListener('click', () => { filter = button.dataset.watchFilter; draw(); });
    byId('watches-new').addEventListener('click', () => editor.template({ 'task-category': 'monitor' }));
    byId('logout').addEventListener('click', () => { records.clear(); list.replaceChildren(); owner = ''; hasLoaded = false; lastError = ''; report(''); });
    for (const button of filterButtons) button.setAttribute('aria-pressed', String(button.dataset.watchFilter === filter));
    return Object.freeze({ render, loading, error, open });
  }
  return Object.freeze({ presentation, formatTime, attach });
})();
