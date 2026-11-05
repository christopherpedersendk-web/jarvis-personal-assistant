(() => {
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
    const [health, updates] = await Promise.all([api('/api/system-health'), api('/api/updates')]);
    const uptime = Math.floor(health.process.uptimeSeconds / 3600);
    const backup = health.backup.result === 'success' ? 'Sidst bestået' : health.backup.result || 'Ukendt';
    const pairs = [
      ['JARVIS', `Kører · ${uptime} timer`],
      ['Discord', health.discord.status === 'connected' ? 'Forbundet' : health.discord.status],
      ['Backup', backup],
      ['Ledig disk', gb(health.host.availableDiskBytes)],
      ['Ledig RAM', gb(health.host.freeMemoryBytes)],
      ['Fejlede opgaver', health.tasks.failed],
    ];
    el('system-health-details').replaceChildren(...pairs.map(([a,b]) => card(a,b)));
    el('home-system-health').replaceChildren();
    const h = document.createElement('h2'); h.textContent = 'Systemtilstand';
    const p = document.createElement('p');
    p.textContent = `JARVIS online · Discord: ${pairs[1][1]} · Backup: ${backup} · Ledig disk: ${pairs[3][1]}`;
    el('home-system-health').append(h,p);
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
  document.addEventListener('jarvis:refreshed', () => refreshSystem().catch(() => {}));
  setInterval(() => {
    if (!el('workspace').classList.contains('hidden') && document.visibilityState === 'visible')
      refreshSystem().catch(() => {});
  }, 60_000);
})();
