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
  let stagedVersion = null;
  async function refreshSystem() {
    const [health, updates] = await Promise.all([api('/api/system-health'),
      !el('tab-settings').classList.contains('hidden') ? api('/api/updates') : Promise.resolve(null)]);
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
    stagedVersion = updates.staged?.version || null;
    const text = updates.configured
      ? `Installeret: ${updates.currentVersion} · Tilgængelig: ${updates.available?.version || 'ingen'} · Testet: ${stagedVersion || 'ingen'} · Godkendt: ${updates.approved?.version || 'ingen'}${updates.error ? ' · ' + updates.error : ''}`
      : 'GitHub er endnu ikke konfigureret. Se opsætningsguiden for en skrivebeskyttet deploy key.';
    el('update-status').textContent = text;
    el('update-stage').disabled = !updates.available;
    el('update-approve').disabled = !stagedVersion || updates.approved?.version === stagedVersion;
  }
  async function action(name) {
    try {
      if (name === 'approve' && !confirm(`Godkend ${stagedVersion} til senere installation?`)) return;
      el('update-status').textContent = 'Behandler opdatering …';
      await api('/api/updates/action', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({action:name, version:stagedVersion}) });
      await refreshSystem();
    } catch (error) { el('update-status').textContent = error.message; }
  }
  el('system-refresh').addEventListener('click', () => refreshSystem().catch(console.error));
  el('update-check').addEventListener('click', () => action('check'));
  el('update-stage').addEventListener('click', () => action('stage'));
  el('update-approve').addEventListener('click', () => action('approve'));
  let pending = null;
  const refreshVisible = () => {
    if (el('workspace').classList.contains('hidden') || (el('tab-home').classList.contains('hidden') && el('tab-settings').classList.contains('hidden'))) return;
    if (!pending) pending = refreshSystem().finally(() => { pending = null; });
    return pending;
  };
  document.addEventListener('jarvis:refreshed', () => refreshVisible()?.catch(() => {}));
  document.addEventListener('jarvis:view-changed', () => refreshVisible()?.catch(() => {}));
  setInterval(() => {
    if (!el('workspace').classList.contains('hidden') && document.visibilityState === 'visible')
      refreshVisible()?.catch(() => {});
  }, 60_000);
})();
