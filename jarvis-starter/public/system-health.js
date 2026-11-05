const JarvisHealth = Object.freeze({
  presentation(health) {
    const discord = ({ disabled: 'Slået fra', connecting: 'Forbinder', reconnecting: 'Genopretter forbindelse',
      connected: 'Forbundet', error: 'Forbindelsesfejl' })[health.discord?.status] || 'Ikke verificeret';
    const backupResult = health.backup?.result;
    const knownBackupFailure = ['exit-code', 'timeout', 'signal', 'core-dump', 'failed'].includes(backupResult);
    const backup = backupResult === 'success' && health.backup?.lastFinished
      ? 'Seneste kørsel afsluttet uden fejl' : knownBackupFailure ? 'Seneste observerede kørsel fejlede' : 'Ikke verificeret';
    const warnings = [];
    if (health.storage?.ready === false) warnings.push(health.storage.reason || 'Lageret er ikke klar til at gemme.');
    if (knownBackupFailure) warnings.push('Den seneste observerede backupkørsel fejlede. Se driftsstatus i Indstillinger.');
    if (health.discord?.status === 'error' || health.discord?.dedupeStatus === 'error') warnings.push('Discord kræver kontrol. Se forbindelses- og journalstatus i Indstillinger.');
    if (health.discord?.unknownMessageCount > 0 || health.discord?.ingressGap?.status === 'requires_review')
      warnings.push('Discord har uafklarede beskeder eller et hul i modtagelsen. Ingen automatisk gentagelse; gennemgå journalen.');
    return { discord, backup, storage: health.storage?.ready === true ? 'Klar' : health.storage?.ready === false ? 'Ikke klar' : 'Ikke verificeret', warnings };
  },
  updatePresentation(updates) {
    if (!updates) return { text: 'Opdateringsstatus er endnu ikke verificeret.', canCheck: false, canStage: false, canApprove: false };
    const staged = updates.staged, available = updates.available;
    const validRelease = value => /^v\d+\.\d+\.\d+$/.test(value?.version || '') && /^[0-9a-f]{40}$/.test(value?.sha || '');
    const busy = updates.checkOperation?.status === 'running' || updates.stageOperation?.status === 'running';
    const interrupted = updates.busy && (updates.checkOperation?.status === 'running' && !updates.busy.check
      || updates.stageOperation?.status === 'running' && !updates.busy.stage);
    const uncertain = updates.publicationUnknown === true;
    const storageReady = updates.storage?.ready === true && !uncertain;
    const stageUnknown = updates.stageOperation?.status === 'unknown';
    const tested = validRelease(staged) && staged.testedSha === staged.sha && staged.packageVersion === staged.version.slice(1)
      && Number.isSafeInteger(staged.schemaVersion) && staged.schemaVersion >= 0
      && Number.isSafeInteger(staged.readableFrom) && staged.readableFrom >= 0 && staged.readableFrom <= staged.schemaVersion
      && staged.version === available?.version && staged.sha === available?.sha && !stageUnknown;
    const approved = storageReady && tested && updates.approved?.version === staged.version && updates.approved?.sha === staged.sha
      && updates.approved?.testedSha === staged.sha && updates.approved?.packageVersion === staged.packageVersion;
    const notes = [`Installeret: ${updates.currentVersion || 'ukendt'}`,
      `Tilgængelig: ${validRelease(available) ? `${available.version} (${available.sha})` : 'ingen'}`,
      `Testet: ${tested ? `${staged.version} (${staged.testedSha})` : 'intet aktuelt verificeret grundlag'}`];
    if (uncertain) notes.push('Gemningens udfald er ukendt. Godkendelse kan ikke bekræftes; nye handlinger er låst. Genstart og kontrollér opdateringsjournalen.');
    else if (!storageReady) notes.push('Opdateringslageret er ikke verificeret klar. Nye handlinger er låst.');
    else if (stageUnknown) notes.push('Den afbrudte tests udfald er ukendt. Kontrollér den præcise stagingmappe før en ny test. Ingen automatisk gentagelse.');
    else notes.push(`Godkendt: ${approved ? `${staged.version} (${staged.sha})` : 'ingen for det aktuelle testgrundlag'}`);
    if (interrupted) notes.push('Seneste journalføring er ikke afsluttet. Ingen aktiv kørsel er bekræftet; genstart og kontrollér opdateringsjournalen.');
    else if (busy) notes.push(updates.stageOperation?.status === 'running' ? 'Hentning og isoleret test kører.' : 'Versionskontrol kører.');
    if (!updates.configured) notes.push('GitHub er endnu ikke konfigureret. Se opsætningsguiden for en skrivebeskyttet deploy key.');
    if (updates.error) notes.push(String(updates.error).slice(0, 300));
    const ready = updates.configured === true && storageReady && !busy;
    return { text: notes.join(' · '), canCheck: ready, canStage: ready && validRelease(available) && !stageUnknown,
      canApprove: ready && tested && !approved };
  },
});

if (typeof document !== 'undefined') (() => {
  const el = id => document.getElementById(id);
  const card = (label, value) => {
    const node = document.createElement('div'); node.className = 'system-health-card';
    const small = document.createElement('small'); small.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = String(value);
    node.append(small, strong); return node;
  };
  const gb = bytes => Number.isFinite(bytes) ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : 'Ukendt';
  let latestUpdates = null, actionPending = false, attempt = null, actionNotice = '', generation = 0, refreshSequence = 0, pending = null;
  let pendingScope = null, refreshQueued = false;
  const session = () => ({ generation, token: typeof token === 'string' ? token : '' });
  let observedToken = session().token;
  const current = captured => captured.generation === generation && captured.token && captured.token === session().token
    && !el('workspace').classList.contains('hidden');
  const blocked = () => { for (const id of ['update-check', 'update-stage', 'update-approve']) el(id).disabled = true; };
  function resetPrivateState() {
    generation++; refreshSequence++; latestUpdates = null; actionPending = false; attempt = null; actionNotice = ''; pending = null;
    pendingScope = null; refreshQueued = false;
    for (const id of ['system-health-details', 'home-system-health', 'home-system-alert']) el(id).replaceChildren();
    el('home-system-alert').classList.toggle('hidden', true); el('update-status').textContent = ''; blocked();
  }
  function synchronizeSession() {
    const next = session().token;
    if (next !== observedToken) { resetPrivateState(); observedToken = next; }
  }
  function renderUpdates() {
    const presentation = JarvisHealth.updatePresentation(latestUpdates);
    el('update-status').textContent = presentation.text + (actionNotice ? ` · ${actionNotice}` : '');
    el('update-check').disabled = actionPending || Boolean(attempt) || !presentation.canCheck;
    el('update-stage').disabled = actionPending || Boolean(attempt) || !presentation.canStage;
    el('update-approve').disabled = actionPending || Boolean(attempt) || !presentation.canApprove;
  }
  function acceptUpdates(updates) {
    latestUpdates = updates;
    if (attempt && updates?.storage?.ready === true && !updates.publicationUnknown) {
      const operation = updates[attempt.name === 'stage' ? 'stageOperation' : 'checkOperation'];
      const approved = updates.approved;
      const confirmed = attempt.name === 'approve'
        ? approved?.version === attempt.version && approved?.sha === attempt.sha && approved?.testedSha === attempt.sha
        : operation?.id && operation.id !== attempt.previousId && ['completed', 'failed'].includes(operation.status)
          && (attempt.name !== 'stage' || operation.version === attempt.version && operation.sha === attempt.sha);
      if (confirmed) { attempt = null; actionNotice = ''; }
    }
    renderUpdates();
  }
  async function refreshSystem() {
    synchronizeSession();
    const captured = session(), sequence = ++refreshSequence;
    if (!current(captured)) return;
    const [health, updates] = await Promise.all([api('/api/system-health'),
      !el('tab-settings').classList.contains('hidden') ? api('/api/updates') : Promise.resolve(null)]);
    if (!current(captured) || sequence !== refreshSequence) return;
    const uptime = Math.floor(health.process.uptimeSeconds / 3600);
    const presentation = JarvisHealth.presentation(health);
    const backup = presentation.backup;
    const pairs = [
      ['JARVIS', `Kører · ${uptime} timer`],
      ['Lager', presentation.storage],
      ['Discord', presentation.discord],
      ['Backup', backup],
      ['Ledig disk', gb(health.host.availableDiskBytes)],
      ['Ledig RAM', gb(health.host.freeMemoryBytes)],
      ['Fejlede opgaver', health.tasks.failed],
    ];
    el('system-health-details').replaceChildren(...pairs.map(([a,b]) => card(a,b)));
    el('home-system-health').replaceChildren();
    const h = document.createElement('h2'); h.textContent = 'Systemtilstand';
    const p = document.createElement('p');
    p.textContent = `JARVIS online · Lager: ${presentation.storage} · Discord: ${presentation.discord} · Backup: ${backup} · Ledig disk: ${gb(health.host.availableDiskBytes)}`;
    el('home-system-health').append(h,p);
    const alert = el('home-system-alert');
    alert.replaceChildren(); alert.classList.toggle('hidden', !presentation.warnings.length);
    if (presentation.warnings.length) {
      const title = document.createElement('strong'); title.textContent = 'Drift kræver opmærksomhed'; alert.append(title);
      for (const message of presentation.warnings) { const line = document.createElement('p'); line.textContent = message; alert.append(line); }
      const link = document.createElement('button'); link.type = 'button'; link.className = 'secondary'; link.textContent = 'Åbn driftsstatus';
      link.addEventListener('click', () => selectTab('settings')); alert.append(link);
    }
    if (!updates) return;
    acceptUpdates(updates);
  }
  async function action(name) {
    synchronizeSession();
    const captured = session(), presentation = JarvisHealth.updatePresentation(latestUpdates);
    if (!current(captured) || actionPending || attempt || !presentation[({ check: 'canCheck', stage: 'canStage', approve: 'canApprove' })[name]]) return;
    const reviewed = name === 'stage' ? latestUpdates.available : latestUpdates.staged;
    if (name === 'approve' && !confirm(`Godkend ${reviewed.version} (${reviewed.sha}) til senere installation? Installation kræver fortsat særskilt godkendelse.`)) return;
    // Bind the actual click to what was displayed, not to a future poll's version.
    attempt = { name, version: reviewed?.version, sha: reviewed?.sha,
      previousId: latestUpdates[name === 'stage' ? 'stageOperation' : 'checkOperation']?.id };
    actionPending = true; actionNotice = 'Behandler opdatering …'; ++refreshSequence; renderUpdates();
    try {
      const result = await api('/api/updates/action', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action: name, ...(name !== 'check' ? { version: reviewed.version, expectedSha: reviewed.sha } : {}) }) });
      if (!current(captured)) return;
      attempt = null; actionNotice = ''; ++refreshSequence; acceptUpdates(result);
      try { await refreshSystem(); }
      catch { if (current(captured)) { actionNotice = 'Seneste status kunne ikke opdateres. Det bekræftede svar ovenfor er bevaret; ingen handling er gentaget.'; } }
    } catch (error) {
      if (!current(captured)) return;
      actionNotice = 'Anmodningens udfald er ukendt. Hent lokal status; gentag ikke handlingen blindt.';
      try {
        // Local journal only: never retry check/stage/approval automatically.
        const observed = await api('/api/updates');
        if (!current(captured)) return;
        acceptUpdates(observed);
        if (attempt && Number.isInteger(error.status) && error.status >= 400 && error.status < 500
            && observed.storage?.ready === true && !observed.publicationUnknown) {
          attempt = null; actionNotice = `Anmodningen blev afvist: ${error.message}`;
        }
      } catch { /* Keep the unknown-outcome lock until an authoritative read succeeds. */ }
    } finally { if (current(captured)) { actionPending = false; renderUpdates(); } }
  }
  blocked();
  el('system-refresh').addEventListener('click', async () => {
    const captured = session();
    try { await refreshSystem(); }
    catch { if (current(captured)) { actionNotice = 'Seneste status kunne ikke opdateres. Ingen handling er udført.'; renderUpdates(); } }
  });
  el('update-check').addEventListener('click', () => action('check'));
  el('update-stage').addEventListener('click', () => action('stage'));
  el('update-approve').addEventListener('click', () => action('approve'));
  const refreshVisible = () => {
    if (el('workspace').classList.contains('hidden') || (el('tab-home').classList.contains('hidden') && el('tab-settings').classList.contains('hidden'))) return;
    synchronizeSession();
    const scope = el('tab-settings').classList.contains('hidden') ? 'home' : 'settings';
    if (pending) { if (scope !== pendingScope) refreshQueued = true; return pending; }
    pendingScope = scope;
    const request = refreshSystem().finally(() => {
      if (pending !== request) return;
      pending = null; pendingScope = null;
      const changed = refreshQueued; refreshQueued = false;
      // A home request has no updater payload. Navigation while it is pending
      // queues one newly relevant read, never repeated hidden-domain polling.
      if (changed && (el('tab-settings').classList.contains('hidden') ? 'home' : 'settings') !== scope) return refreshVisible();
    });
    pending = request;
    return pending;
  };
  document.addEventListener('jarvis:refreshed', () => refreshVisible()?.catch(() => {}));
  document.addEventListener('jarvis:view-changed', () => refreshVisible()?.catch(() => {}));
  el('logout')?.addEventListener('click', () => {
    resetPrivateState(); observedToken = session().token;
  });
  setInterval(() => {
    if (!el('workspace').classList.contains('hidden') && document.visibilityState === 'visible')
      refreshVisible()?.catch(() => {});
  }, 60_000);
})();
