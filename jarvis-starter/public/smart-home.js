// Provider readiness is separate from a saved configuration. Reads of these
// snapshots never connect a new service or control an actual device.
const JarvisHome = Object.freeze({
  connection(status = {}) {
    const labels = { not_configured: 'Ikke sat op', not_verified: 'Opsat · forbindelse endnu ikke kontrolleret', connected: 'Forbundet',
      stale: 'Forbindelsesstatus er forældet', expired_login: 'Login eller tilladelse kræver kontrol', unavailable: 'Midlertidigt utilgængelig' };
    return { label: labels[status.connectionState] || 'Forbindelse ukendt',
      checkedAt: status.lastCheckedAt || null, successfulAt: status.lastSuccessfulAt || null, error: status.lastError || '' };
  },
  confirmed(result) { return result?.ok === true && (!result.outcome || result.outcome === 'completed') && (!result.status || result.status === 'completed')
    || result?.alreadyRecorded === true && result?.status === 'completed'; },
});

if (typeof document !== 'undefined') (() => {
  const el = id => document.getElementById(id);
  const node = (tag, value, className) => { const item = document.createElement(tag); item.textContent = value;
    if (className) item.className = className; return item; };
  const date = value => value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value))
    : 'Tidspunkt ukendt';
  let homeSequence = 0, settingsLoaded = false, pendingRefresh = null, pendingOwner = null, hueLoading = false, sonosLoading = false;
  let hueAvailable = false, sonosAvailable = false, hueKey = null, sonosKey = null, hueReadState = 'idle', sonosReadState = 'idle';
  const isOwner = owner => owner && owner === token;
  function resourceNote(id, text, failed = false) {
    const target = el(id); let note = target.querySelector('[data-home-resource-status]');
    if (!note) { note = node('p', '', 'small-text'); note.dataset.homeResourceStatus = ''; note.setAttribute('role', 'status'); target.prepend(note); }
    note.textContent = text; note.classList.toggle('v5-error', failed); return note;
  }
  function setAvailability() {
    el('smart-home-load-hue').disabled = hueLoading || !hueAvailable;
    el('smart-home-load-groups').disabled = sonosLoading || !sonosAvailable;
    for (const control of document.querySelectorAll('[data-home-service]'))
      control.disabled = control.dataset.pending === 'true' || !(control.dataset.homeService === 'hue' ? hueAvailable : sonosAvailable);
  }
  function openSetup(id) {
    selectTab('settings', { section: 'integrations' });
    const target = el(id); if (!target) return;
    for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    if (!target.matches('input,select,textarea,button,a,[tabindex]')) target.tabIndex = -1;
    target.focus(); target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }
  function connectionRow(id, title, status, setupId, extra = '') {
    const target = el('smart-home-status'); let row = [...target.children].find(item => item.dataset.homeIntegration === id);
    if (!row) {
      row = node('div', '', 'home-device-card'); row.dataset.homeIntegration = id;
      const heading = node('strong', title), label = node('p', '', 'small-text'), timing = node('p', '', 'muted small-text'), error = node('p', '', 'small-text');
      label.dataset.homeConnection = ''; timing.dataset.homeChecked = ''; error.dataset.homeError = '';
      row.append(heading, label, timing, error);
      const button = node('button', 'Se opsætning', 'secondary'); button.type = 'button'; button.addEventListener('click', () => openSetup(setupId)); row.append(button); target.append(row);
    }
    const view = JarvisHome.connection(status);
    row.querySelector('[data-home-connection]').textContent = id === 'nest' ? 'Under forberedelse · ikke implementeret' : view.label;
    row.querySelector('[data-home-checked]').textContent = id === 'nest' ? extra
      : `Seneste forsøg: ${date(view.checkedAt)} · Seneste succes: ${date(view.successfulAt)} (dansk tid)`;
    const error = row.querySelector('[data-home-error]'); error.textContent = id === 'nest' ? '' : [view.error, extra].filter(Boolean).join(' ');
    error.classList.toggle('v5-error', Boolean(view.error));
  }
  function renderEvents(events) {
    const target = el('smart-home-events'), old = new Map([...target.children].filter(row => row.dataset.homeEvent).map(row => [row.dataset.homeEvent, row]));
    const ids = new Set(events.map(event => event.id));
    for (const child of [...target.children]) if (!child.dataset.homeEvent || !ids.has(child.dataset.homeEvent)) child.remove();
    for (const event of events) {
      if (old.has(event.id)) continue;
      const row = node('div', '', 'home-event'); row.dataset.homeEvent = event.id;
      row.append(node('strong', event.label), node('span', `${event.source === 'test' ? 'Simuleret test · ' : ''}${date(event.at)} (dansk tid)`, 'muted small-text'));
      if (event.detail) { const detail = node('details', ''); detail.append(node('summary', 'Hændelsesdetaljer'), node('p', event.detail, 'small-text')); row.append(detail); }
      target.append(row);
    }
    // Reorder existing nodes only when needed, preserving open details.
    let anchor = target.firstElementChild;
    for (const event of events) { const row = [...target.children].find(item => item.dataset.homeEvent === event.id);
      if (row !== anchor) target.insertBefore(row, anchor); anchor = row.nextElementSibling; }
    if (!events.length) target.append(node('p', 'Ingen registrerede hændelser.', 'muted'));
  }
  async function refreshHome() {
    if (!token) return;
    const owner = token, request = ++homeSequence;
    const [home, hue, sonos] = await Promise.allSettled([api('/api/smart-home'), api('/api/smart-home/hue/settings'), api('/api/smart-home/settings')]);
    if (!isOwner(owner) || request !== homeSequence) return;
    const data = home.status === 'fulfilled' ? home.value : null;
    const hueSettings = hue.status === 'fulfilled' ? hue.value : null, sonosSettings = sonos.status === 'fulfilled' ? sonos.value : null;
    const nextHueKey = hueSettings ? `${hueSettings.bridgeIp || ''}:${Boolean(hueSettings.paired)}` : hueKey;
    const nextSonosKey = sonosSettings ? `${sonosSettings.sonosHouseholdId || ''}:${Boolean(sonosSettings.hasSonosToken)}` : sonosKey;
    if (hueKey !== null && hueKey !== nextHueKey) { hueReadState = 'idle'; el('smart-home-hue').replaceChildren(); el('smart-home-scenes').replaceChildren(); }
    if (sonosKey !== null && sonosKey !== nextSonosKey) { sonosReadState = 'idle'; el('smart-home-groups').replaceChildren(); }
    hueKey = nextHueKey; sonosKey = nextSonosKey;
    hueAvailable = Boolean(hueSettings?.paired && hueSettings?.configured !== false);
    sonosAvailable = Boolean(sonosSettings?.hasSonosToken && sonosSettings?.sonosHouseholdId);
    const unavailable = error => ({ connectionState: 'unavailable', lastError: `Status kunne ikke hentes: ${error?.message || 'Ukendt fejl'}` });
    connectionRow('hue', 'Philips Hue', hueSettings || unavailable(hue.reason), 'hue-ip',
      hueSettings && !hueAvailable ? 'Opsæt og par Hue Bridge under Integrationer.' : '');
    connectionRow('sonos', 'Sonos', data?.sonos || unavailable(home.reason || new Error('Forbindelsesstatus mangler')), 'sonos-household',
      sonos.status !== 'fulfilled' ? `Opsætningens status kunne ikke hentes: ${sonos.reason.message}`
        : !sonosAvailable ? 'Forbind Sonos og gem Household ID under Integrationer.' : '');
    connectionRow('nest', 'Google Nest', {}, 'settings-nest-info', data?.google?.status || 'Live-hændelser er endnu ikke understøttet.');
    if (!hueAvailable) resourceNote('smart-home-hue', hueSettings ? 'Hue er ikke klar til at hente rum. Se opsætning under Integrationer.' : 'Hue-status kunne ikke hentes. Prøv at åbne Hjem igen.', !hueSettings);
    else if (hueReadState === 'idle' && !el('smart-home-hue').querySelector('[data-home-room]')) resourceNote('smart-home-hue', 'Vælg Opdater Hue-lys for at læse rum og lys fra den opsatte Bridge.');
    if (!sonosAvailable) resourceNote('smart-home-groups', sonosSettings ? 'Sonos mangler opsætning. Ingen aktuelle rum er indlæst.' : 'Sonos-opsætningens status kunne ikke hentes.', !sonosSettings);
    else if (sonosReadState === 'idle' && !el('smart-home-groups').querySelector('[data-home-group]')) resourceNote('smart-home-groups', 'Vælg Opdater Sonos-rum for at læse de tilgængelige grupper.');
    if (data) {
      const events = Array.isArray(data.events) ? data.events : [];
      renderEvents(events);
      const summary = el('home-smart-home'); let line = summary.querySelector('[data-home-summary]');
      if (!line) {
        line = node('p', '', 'muted small-text'); line.dataset.homeSummary = '';
        const button = node('button', 'Åbn Hjem', 'secondary'); button.type = 'button'; button.addEventListener('click', () => selectTab('smart-home'));
        summary.append(node('h3', 'Hjem'), line, button);
      }
      line.textContent = events[0] ? `${events[0].source === 'test' ? 'Simuleret test · ' : ''}${events[0].label} · ${date(events[0].at)}` : 'Ingen registrerede hændelser.';
    } else resourceNote('smart-home-events', `Hændelser kunne ikke hentes: ${home.reason.message}. Tidligere viste hændelser er ikke opdateret.`, true);
    if (!settingsLoaded && !el('tab-settings').classList.contains('hidden')) {
      if (sonosSettings && !el('sonos-household').dataset.dirty) el('sonos-household').value = sonosSettings.sonosHouseholdId || '';
      if (hueSettings && !el('hue-ip').dataset.dirty) el('hue-ip').value = hueSettings.bridgeIp || '';
      settingsLoaded = Boolean(sonosSettings && hueSettings);
    }
    if (el('sonos-connect')) el('sonos-connect').disabled = !sonosSettings?.oauthConfigured;
    if (el('sonos-oauth-status')) el('sonos-oauth-status').textContent = sonosSettings?.automaticRefresh
      ? 'Sonos-login gemt. Token fornyes automatisk ved brug.' : sonosSettings?.oauthConfigured
        ? 'Sonos-login er klar. Vælg Forbind med Sonos.' : 'Sonos-login kræver client ID, client secret og redirect-URL på serveren.';
    setAvailability();
  }

  async function sendHomeAction(path, payload, control, success) {
    if (control.disabled || !token) return;
    const owner = token; control.disabled = true; control.dataset.pending = 'true';
    // Reusing the same intent after a lost response cannot repeat a possibly
    // executed skip or scene. The server journal rejects changed arguments.
    control.dataset.actionId ||= crypto.randomUUID();
    const feedbackHost = control.closest?.('.home-player') || control.parentElement;
    let feedback = feedbackHost.querySelector('[data-action-feedback]');
    if (!feedback) { feedback = node('p', '', 'small-text'); feedback.dataset.actionFeedback = ''; feedback.setAttribute('role', 'status'); feedbackHost.append(feedback); }
    feedback.classList.remove('v5-error'); feedback.textContent = 'Handlingen afventer et bekræftet resultat …'; control.dataset.actionState = 'pending';
    try {
      const result = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Action-Id': control.dataset.actionId }, body: JSON.stringify(payload) });
      if (!isOwner(owner)) return;
      if (!JarvisHome.confirmed(result)) throw new Error('Svar uden bekræftet succes. Kontrollér enheden eller handlingsjournalen.');
      delete control.dataset.actionId; control.dataset.actionState = 'completed'; feedback.textContent = success; toast(success);
    } catch (error) { if (isOwner(owner)) {
      control.dataset.actionState = 'unknown'; feedback.classList.add('v5-error');
      feedback.textContent = `Handlingen blev ikke bekræftet: ${error.message} Kontrollér enheden eller handlingsjournalen før en ny handling.`;
      toast(error.message);
    } } finally { delete control.dataset.pending; if (isOwner(owner)) {
      setAvailability(); await refreshHome().catch(() => {});
    } }
  }
  const actionControl = (label, service, handler) => {
    const button = node('button', label, 'secondary'); button.type = 'button'; button.dataset.homeService = service;
    button.addEventListener('click', () => handler(button)); return button;
  };
  async function loadHue() {
    if (hueLoading || !hueAvailable || !token) return;
    const owner = token; hueLoading = true; hueReadState = 'loading'; setAvailability(); resourceNote('smart-home-hue', 'Henter Hue-rum og lys …');
    try {
      const data = await api('/api/smart-home/hue/resources'); if (!isOwner(owner)) return;
      hueReadState = 'loaded'; el('smart-home-hue').replaceChildren(); el('smart-home-scenes').replaceChildren();
      const groups = new Map((data.grouped_light || []).map(group => [group.id, group]));
      for (const room of [...(data.room || []), ...(data.zone || [])]) {
        const service = room.services?.find(item => item.rtype === 'grouped_light'), group = service && groups.get(service.rid);
        if (!group) continue;
        const name = room.metadata?.name || 'Navn mangler', row = node('div', '', 'home-player'); row.dataset.homeRoom = room.id || service.rid;
        row.append(node('strong', name), node('span', `Senest læst: ${typeof group.on?.on === 'boolean' ? group.on.on ? 'tændt' : 'slukket' : 'lysstatus ukendt'}`, 'muted small-text'));
        for (const [on, label] of [[true, 'Tænd'], [false, 'Sluk']]) row.append(actionControl(label, 'hue', button =>
          sendHomeAction('/api/smart-home/hue/control', { kind: 'grouped_light', id: service.rid, on }, button, `Hue-kommando bekræftet: ${name}.`)));
        if (Number.isFinite(group.dimming?.brightness)) {
          const label = node('label', 'Ønsket lysstyrke', 'small-text');
          const slider = document.createElement('input'); slider.type = 'range'; slider.min = '1'; slider.max = '100'; slider.value = String(Math.max(1, Math.round(group.dimming.brightness)));
          slider.dataset.homeService = 'hue'; slider.setAttribute('aria-label', `Ønsket lysstyrke i ${name}`);
          slider.addEventListener('change', () => sendHomeAction('/api/smart-home/hue/control', { kind: 'grouped_light', id: service.rid, brightness: Number(slider.value), on: true }, slider, `Kommando om lysstyrke bekræftet: ${name}.`));
          label.append(slider); row.append(label);
        }
        el('smart-home-hue').append(row);
      }
      if (!el('smart-home-hue').children.length) resourceNote('smart-home-hue', 'Ingen understøttede Hue-rum blev fundet i svaret.');
      for (const scene of data.scene || []) {
        const row = node('div', '', 'home-player'); row.append(actionControl(scene.metadata?.name || 'Scene uden navn', 'hue', button =>
          sendHomeAction('/api/smart-home/hue/scene', { id: scene.id }, button, 'Kommando om Hue-scenen er bekræftet.'))); el('smart-home-scenes').append(row);
      }
      if (!el('smart-home-scenes').children.length) resourceNote('smart-home-scenes', 'Ingen scener fundet i svaret.');
    } catch (error) { if (isOwner(owner)) { hueReadState = 'error'; resourceNote('smart-home-hue', `Kunne ikke hente Hue-rum: ${error.message}. Eventuelle tidligere værdier er ikke opdateret.`, true); } }
    finally { if (isOwner(owner)) { hueLoading = false; await refreshHome(); setAvailability(); } }
  }
  async function groups() {
    if (sonosLoading || !sonosAvailable || !token) return;
    const owner = token; sonosLoading = true; sonosReadState = 'loading'; setAvailability(); resourceNote('smart-home-groups', 'Henter Sonos-rum …');
    try {
      const data = await api('/api/smart-home/sonos/groups'); if (!isOwner(owner)) return;
      sonosReadState = 'loaded'; el('smart-home-groups').replaceChildren();
      for (const group of data.groups || []) {
        const row = node('div', '', 'home-player'); row.dataset.homeGroup = group.id; row.append(node('strong', group.name));
        for (const [command, label] of [['previous', 'Forrige'], ['play', 'Afspil'], ['pause', 'Pause'], ['skip', 'Næste']]) {
          const button = actionControl(label, 'sonos', control => sendHomeAction('/api/smart-home/sonos/action', { groupId: group.id, command }, control, 'Kommando bekræftet af Sonos.'));
          button.setAttribute('aria-label', `${label} · ${group.name}`); row.append(button);
        }
        el('smart-home-groups').append(row);
      }
      if (!el('smart-home-groups').children.length) resourceNote('smart-home-groups', data.message || 'Ingen Sonos-grupper fundet i svaret.');
    } catch (error) { if (isOwner(owner)) { sonosReadState = 'error'; resourceNote('smart-home-groups', `Kunne ikke hente Sonos-rum: ${error.message}. Tidligere rum er ikke opdateret.`, true); } }
    finally { if (isOwner(owner)) { sonosLoading = false; await refreshHome(); setAvailability(); } }
  }

  el('smart-home-load-groups').addEventListener('click', () => groups().catch(error => resourceNote('smart-home-groups', error.message, true)));
  el('smart-home-load-hue').addEventListener('click', () => loadHue().catch(error => resourceNote('smart-home-hue', error.message, true)));
  el('hue-settings-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = el('hue-settings-form'), button = form.querySelector('[type="submit"]');
    if (button.disabled || !token) return;
    const owner = token, bridgeIp = el('hue-ip').value.trim(); button.disabled = true; el('hue-settings-status').textContent = 'Gemmer Bridge-adressen …';
    try {
      await api('/api/smart-home/hue/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bridgeIp }) });
      if (!isOwner(owner)) return;
      const changed = el('hue-ip').value.trim() !== bridgeIp;
      if (!changed) delete el('hue-ip').dataset.dirty;
      el('hue-settings-status').textContent = changed ? 'Den indsendte adresse er gemt. Din nyere ændring er bevaret som kladde.' : 'Adresse gemt. Parring er en separat handling med Hue Bridges fysiske knap.';
      await refreshHome();
    } catch (error) { if (isOwner(owner)) el('hue-settings-status').textContent = `Kunne ikke fuldføre gemningen: ${error.message}. Din tekst er bevaret.`; }
    finally { if (isOwner(owner)) button.disabled = false; }
  });
  el('hue-pair').addEventListener('click', async () => {
    const button = el('hue-pair'), owner = token; if (button.disabled || !owner) return;
    if (el('hue-ip').dataset.dirty) { el('hue-settings-status').textContent = 'Gem først den ændrede Bridge-adresse. Parring bruger den gemte adresse.'; return; }
    button.disabled = true; el('hue-settings-status').textContent = 'Afventer bekræftet parring …';
    try { await api('/api/smart-home/hue/pair', { method: 'POST' }); if (!isOwner(owner)) return;
      el('hue-settings-status').textContent = 'Hue Bridge parret. Certifikatet er knyttet til denne Bridge.'; await refreshHome(); await loadHue(); }
    catch (error) { if (isOwner(owner)) el('hue-settings-status').textContent = `Parring blev ikke bekræftet: ${error.message}`; }
    finally { if (isOwner(owner)) button.disabled = false; }
  });
  el('smart-home-test').addEventListener('click', async () => {
    const button = el('smart-home-test'), owner = token; if (button.disabled || !owner) return; button.disabled = true;
    try { await api('/api/smart-home/test-event', { method: 'POST' }); if (!isOwner(owner)) return; await refreshHome(); toast('Simuleret dørklokke-hændelse registreret.'); }
    catch (error) { if (isOwner(owner)) resourceNote('smart-home-events', `Testhændelsen blev ikke bekræftet: ${error.message}`, true); }
    finally { if (isOwner(owner)) button.disabled = false; }
  });
  el('home-settings-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = el('home-settings-form').querySelector('[type="submit"]'); if (button.disabled || !token) return;
    const owner = token, values = { sonosToken: el('sonos-token').value, sonosHouseholdId: el('sonos-household').value, clearSonosToken: el('sonos-clear').checked };
    button.disabled = true; el('home-settings-status').textContent = 'Gemmer Sonos-indstillinger …';
    try {
      await api('/api/smart-home/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      if (!isOwner(owner)) return;
      const changed = el('sonos-token').value !== values.sonosToken || el('sonos-household').value !== values.sonosHouseholdId || el('sonos-clear').checked !== values.clearSonosToken;
      if (el('sonos-token').value === values.sonosToken) el('sonos-token').value = '';
      if (el('sonos-clear').checked === values.clearSonosToken) el('sonos-clear').checked = false;
      if (el('sonos-household').value === values.sonosHouseholdId) delete el('sonos-household').dataset.dirty;
      el('home-settings-status').textContent = changed ? 'De indsendte indstillinger er gemt. Nyere ændringer er bevaret som kladde.' : 'Sonos-indstillinger gemt. Forbindelsen kontrolleres ved en særskilt læsning fra Hjem.';
      await refreshHome();
    } catch (error) { if (isOwner(owner)) el('home-settings-status').textContent = `Kunne ikke fuldføre gemningen: ${error.message}. Dine felter er bevaret.`; }
    finally { if (isOwner(owner)) button.disabled = false; }
  });
  el('sonos-connect')?.addEventListener('click', async () => {
    const button = el('sonos-connect'), owner = token;
    if (!owner || button.disabled) return;
    if (el('sonos-token').value || el('sonos-clear').checked || el('sonos-household').dataset.dirty) {
      el('home-settings-status').textContent = 'Gem dine Sonos-ændringer før login.'; return;
    }
    button.disabled = true;
    try {
      const result = await api('/api/smart-home/sonos/connect', { method: 'POST' });
      if (isOwner(owner)) location.assign(result.url);
    } catch (error) { if (isOwner(owner)) { el('home-settings-status').textContent = error.message; button.disabled = false; } }
  });
  const sonosOutcome = new URLSearchParams(location.search).get('sonos');
  if (sonosOutcome && el('home-settings-status')) el('home-settings-status').textContent = sonosOutcome === 'connected'
    ? 'Sonos-login gennemført. Gem Household ID og hent rum fra Hjem for at kontrollere forbindelsen.' : 'Sonos-login kunne ikke gennemføres. Start igen fra Indstillinger.';
  const relevant = () => !el('tab-smart-home').classList.contains('hidden') || !el('tab-settings').classList.contains('hidden') ||
    (!el('tab-home').classList.contains('hidden') && el('home-more-details').open);
  for (const id of ['sonos-household', 'hue-ip']) el(id).addEventListener('input', () => { el(id).dataset.dirty = 'true'; });
  const refreshVisible = () => {
    if (!token || el('workspace').classList.contains('hidden') || !relevant()) return Promise.resolve();
    if (!pendingRefresh || pendingOwner !== token) {
      pendingOwner = token; const operation = refreshHome().finally(() => { if (pendingRefresh === operation) pendingRefresh = null; }); pendingRefresh = operation;
    }
    return pendingRefresh;
  };
  document.addEventListener('jarvis:refreshed', () => refreshVisible().catch(() => {}));
  document.addEventListener('jarvis:view-changed', () => refreshVisible().catch(() => {}));
  el('home-more-details').addEventListener('toggle', () => refreshVisible().catch(() => {}));
  globalThis.addEventListener?.('beforeunload', event => {
    if (el('sonos-token').value || el('sonos-clear').checked || ['sonos-household', 'hue-ip'].some(id => el(id).dataset.dirty)) { event.preventDefault(); event.returnValue = ''; }
  });
  el('logout').addEventListener('click', () => { homeSequence++; pendingRefresh = null; pendingOwner = null; settingsLoaded = false; hueLoading = false; sonosLoading = false; hueAvailable = false; sonosAvailable = false; hueKey = null; sonosKey = null; hueReadState = 'idle'; sonosReadState = 'idle';
    for (const id of ['sonos-household', 'hue-ip', 'sonos-token']) { el(id).value = ''; delete el(id).dataset.dirty; }
    el('sonos-clear').checked = false;
    for (const id of ['hue-pair', 'smart-home-test']) el(id).disabled = false;
    for (const id of ['hue-settings-form', 'home-settings-form']) el(id).querySelector('[type="submit"]').disabled = false;
    for (const id of ['smart-home-status', 'smart-home-events', 'smart-home-hue', 'smart-home-scenes', 'smart-home-groups', 'home-smart-home']) el(id).replaceChildren();
    el('home-settings-status').textContent = ''; el('hue-settings-status').textContent = ''; setAvailability(); });
  setAvailability();
  setInterval(() => { if (document.visibilityState === 'visible') refreshVisible().catch(() => {}); }, 30000);
})();
