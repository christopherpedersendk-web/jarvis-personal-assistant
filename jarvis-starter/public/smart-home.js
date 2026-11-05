// Bruger den eksisterende autentificerede api()-funktion fra app.js.
(function () {
  const el = id => document.getElementById(id);
  const clear = id => el(id).replaceChildren();
  const node = (tag, value, className) => {
    const n = document.createElement(tag);
    n.textContent = value;
    if (className) n.className = className;
    return n;
  };

  async function sendHomeAction(path, payload, control, success) {
    if (control.disabled) return;
    control.disabled = true;
    // Keep the same intent after a lost HTTP response; a second click must not
    // repeat a possibly executed skip/scene command. Nothing auto-retries.
    control.dataset.actionId ||= crypto.randomUUID();
    let feedback = control.parentElement.querySelector('[data-action-feedback]');
    if (!feedback) { feedback = node('p', '', 'small-text'); feedback.dataset.actionFeedback = 'true'; feedback.setAttribute('role', 'status'); control.parentElement.append(feedback); }
    feedback.textContent = 'Handlingen afventer et bekræftet resultat …';
    try {
      await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Action-Id': control.dataset.actionId }, body: JSON.stringify(payload) });
      delete control.dataset.actionId;
      feedback.textContent = success;
      toast(success);
      await refreshHome();
    } catch (error) {
      feedback.textContent = `${error.message} Kontrollér enheden eller handlingsjournalen før en ny handling.`;
      toast(error.message);
    } finally { control.disabled = false; }
  }

  async function refreshHome() {
    const data = await api('/api/smart-home');
    const hueSettings = await api('/api/smart-home/hue/settings');
    clear('smart-home-status'); clear('smart-home-events'); clear('home-smart-home');
    const connectionLabel = status => {
      const label = ({ not_configured: 'Ikke konfigureret', not_verified: 'Konfigureret · endnu ikke kontrolleret', connected: 'Forbundet',
        stale: 'Seneste forbindelse er ikke længere aktuel', expired_login: 'Login udløbet · kræver kontrol', unavailable: 'Midlertidigt utilgængelig' })[status.connectionState] || 'Forbindelse ukendt';
      return label + (status.lastCheckedAt ? ` · kontrolleret ${new Date(status.lastCheckedAt).toLocaleString('da-DK')}` : '');
    };
    for (const [title, subtitle] of [
      ['Sonos', connectionLabel(data.sonos)],
      ['Philips Hue', connectionLabel(hueSettings)],
      ['Nest-dørklokke', data.google.status],
    ]) {
      const card = node('div', '', 'home-device-card');
      card.append(node('strong', title), node('p', subtitle, 'muted small-text'));
      el('smart-home-status').append(card);
    }
    const heading = node('h3', '⌂ Smart hjem');
    const latest = data.events[0];
    const line = node('p', latest ? `${latest.label} · ${new Date(latest.at).toLocaleString('da-DK')}` : 'Ingen hændelser endnu.', 'muted small-text');
    const button = node('button', 'Åbn Hjem', 'secondary');
    button.type = 'button'; button.addEventListener('click', () => selectTab('smart-home'));
    el('home-smart-home').append(heading, line, button);
    if (!data.events.length) el('smart-home-events').append(node('p', 'Ingen hændelser registreret.', 'muted'));
    for (const event of data.events) {
      const card = node('div', '', 'home-event');
      card.append(node('strong', event.label), node('span', `${event.source === 'test' ? 'SIMULERET · ' : ''}${new Date(event.at).toLocaleString('da-DK')}`, 'muted small-text'));
      el('smart-home-events').append(card);
    }
  }

  async function loadHue() {
    clear('smart-home-hue'); clear('smart-home-scenes');
    const data = await api('/api/smart-home/hue/resources');
    const groups = new Map((data.grouped_light || []).map(g => [g.id, g]));
    const rooms = [...(data.room || []), ...(data.zone || [])];
    for (const room of rooms) {
      const grouped = room.services?.find(s => s.rtype === 'grouped_light');
      if (!grouped || !groups.has(grouped.rid)) continue;
      const row = node('div', '', 'home-player');
      row.append(node('strong', room.metadata?.name || 'Ukendt rum'));
      for (const [on, label] of [[true, 'Tænd'], [false, 'Sluk']]) {
        const button = node('button', label, 'secondary'); button.type = 'button';
        button.addEventListener('click', async () => {
          await sendHomeAction('/api/smart-home/hue/control', { kind: 'grouped_light', id: grouped.rid, on }, button, `Hue-kommando bekræftet: ${room.metadata?.name}.`);
        });
        row.append(button);
      }
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '1'; slider.max = '100'; slider.value = String(Math.round(groups.get(grouped.rid).dimming?.brightness || 75));
      slider.setAttribute('aria-label', `Lysstyrke ${room.metadata?.name || 'rum'}`);
      slider.addEventListener('change', async () => {
        await sendHomeAction('/api/smart-home/hue/control', { kind: 'grouped_light', id: grouped.rid, brightness: Number(slider.value), on: true }, slider, 'Lysstyrke opdateret.');
      });
      row.append(slider); el('smart-home-hue').append(row);
    }
    if (!el('smart-home-hue').children.length) el('smart-home-hue').append(node('p', 'Ingen Hue-rum fundet.', 'muted'));
    for (const scene of data.scene || []) {
      const b = node('button', scene.metadata?.name || 'Scene', 'secondary'); b.type = 'button';
      b.addEventListener('click', async () => {
        await sendHomeAction('/api/smart-home/hue/scene', { id: scene.id }, b, 'Hue-scenen er aktiveret.');
      });
      el('smart-home-scenes').append(b);
    }
  }

  async function groups() {
    clear('smart-home-groups');
    const data = await api('/api/smart-home/sonos/groups');
    if (!data.groups.length) el('smart-home-groups').append(node('p', data.message || 'Ingen grupper fundet.', 'muted'));
    for (const group of data.groups) {
      const row = node('div', '', 'home-player');
      row.append(node('strong', group.name));
      for (const [command, label] of [['previous', '⏮'], ['play', '▶'], ['pause', '⏸'], ['skip', '⏭']]) {
        const b = node('button', label, 'secondary');
        b.type = 'button'; b.setAttribute('aria-label', `${label} ${group.name}`);
        b.addEventListener('click', async () => {
          await sendHomeAction('/api/smart-home/sonos/action', { groupId: group.id, command }, b, 'Kommando bekræftet af Sonos.');
        });
        row.append(b);
      }
      el('smart-home-groups').append(row);
    }
  }

  el('smart-home-load-groups').addEventListener('click', () => groups().catch(e => toast(e.message)));
  el('smart-home-load-hue').addEventListener('click', () => loadHue().catch(e => toast(e.message)));
  el('hue-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api('/api/smart-home/hue/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bridgeIp: el('hue-ip').value.trim() }) });
      el('hue-settings-status').textContent = 'Adresse gemt. Tryk nu på Hue Bridges fysiske knap, og par.'; await refreshHome(); }
    catch (e) { el('hue-settings-status').textContent = e.message; }
  });
  el('hue-pair').addEventListener('click', async () => {
    try { await api('/api/smart-home/hue/pair', { method: 'POST' }); el('hue-settings-status').textContent = 'Hue Bridge parret. Certifikat er knyttet til denne Bridge.';
      await refreshHome(); await loadHue(); }
    catch (e) { el('hue-settings-status').textContent = e.message; }
  });
  el('smart-home-test').addEventListener('click', async () => {
    try { await api('/api/smart-home/test-event', { method: 'POST' }); await refreshHome(); toast('Simuleret dørklokke-hændelse registreret.'); }
    catch (error) { toast(error.message); }
  });
  el('home-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api('/api/smart-home/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sonosToken: el('sonos-token').value, sonosHouseholdId: el('sonos-household').value, clearSonosToken: el('sonos-clear').checked }) });
      el('sonos-token').value = ''; el('sonos-clear').checked = false;
      el('home-settings-status').textContent = 'Sonos-indstillinger gemt sikkert på serveren.';
      await refreshHome();
    } catch (error) { el('home-settings-status').textContent = error.message; }
  });
  document.addEventListener('jarvis:refreshed', () => refreshHome().catch(() => {}));
  document.addEventListener('DOMContentLoaded', () => {});
  if (token) {
    api('/api/smart-home/settings').then(s => { el('sonos-household').value = s.sonosHouseholdId || ''; }).catch(() => {});
    api('/api/smart-home/hue/settings').then(s => { el('hue-ip').value = s.bridgeIp || ''; if (s.paired) loadHue().catch(() => {}); }).catch(() => {});
    refreshHome().catch(() => {});
  }
  setInterval(() => { if (token && document.visibilityState === 'visible') refreshHome().catch(() => {}); }, 30_000);
})();
