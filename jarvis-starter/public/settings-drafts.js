// Field-level compare-and-set drafts. Password controls never enter browser
// storage, a GET response, a model prompt or a console message.
const JarvisSettings = (() => {
  const definitions = Object.freeze({
    system: { path: '/api/settings', form: 'settings-form', status: 'settings-draft-status', submit: 'settings-submit', reload: 'settings-reload',
      fields: { maxRunsPerDay: ['max-runs', 'number', 'Daglig kørselsgrænse'], remindersEnabled: ['reminders-enabled', 'checkbox', 'Lokale påmindelser'],
        discordAlertsEnabled: ['discord-alerts-enabled', 'checkbox', 'Discord-advarsler'], httpsUrl: ['https-url', 'text', 'HTTPS-adresse'],
        pushUser: ['push-user', 'secret', 'Pushover User Key'], pushToken: ['push-token', 'secret', 'Pushover App Token'] } },
    discord: { path: '/api/discord/settings', form: 'discord-form', status: 'discord-draft-status', submit: 'discord-submit', reload: 'discord-reload',
      fields: { enabled: ['discord-enabled', 'checkbox', 'Discord aktiv'], userId: ['discord-user-id', 'text', 'Dit Discord User ID'],
        guildId: ['discord-guild-id', 'text', 'Discord Server ID'], token: ['discord-token', 'secret', 'Discord Bot Token'] } },
    proactive: { path: '/api/proactive/settings', readPath: '/api/proactive', snapshotKey: 'settings', form: 'proactive-form',
      status: 'proactive-draft-status', submit: 'proactive-submit', reload: 'proactive-reload',
      fields: { dailyEnabled: ['proactive-daily', 'checkbox', 'Daglig briefing'], weeklyEnabled: ['proactive-weekly', 'checkbox', 'Ugentlig opsamling'],
        discordEnabled: ['proactive-discord', 'checkbox', 'Discord-levering'], dailyTime: ['proactive-daily-time', 'time', 'Dagligt tidspunkt'],
        weeklyTime: ['proactive-weekly-time', 'time', 'Ugentligt tidspunkt'], quietStart: ['proactive-quiet-start', 'time', 'Stilletid fra'],
        quietEnd: ['proactive-quiet-end', 'time', 'Stilletid til'] } },
  });
  const secretPattern = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b|\b(?:api[_ -]?key|password|adgangskode|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*["']?\s*[=:]\s*["']?[^\s,"'}]+/iu;
  const digest = value => value && typeof value === 'object' && typeof value.digest === 'string' ? value.digest : null;
  function sensitive(value, owner = '') {
    const text = String(value);
    if (secretPattern.test(text) || owner.length >= 6 && text.includes(owner)) return true;
    try { const url = new URL(text); return Boolean(url.username || url.password); } catch { return false; }
  }
  function validate(field, raw, type) {
    if (type === 'checkbox') return raw === true;
    if (typeof raw !== 'string') throw new Error('Et indstillingsfelt har et ugyldigt format.');
    const value = raw.trim();
    if (type === 'secret') {
      if (!value || value.length > (field === 'token' ? 300 : 200)) throw new Error('Indtast en gyldig nøgle, eller lad feltet være tomt for at beholde den gemte nøgle.');
      return value;
    }
    if (field === 'maxRunsPerDay') {
      const number = Number(value);
      if (!value || !Number.isInteger(number) || number < 1 || number > 100) throw new Error('Daglig grænse skal være et helt tal mellem 1 og 100.');
      return number;
    }
    if (type === 'time' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Tidspunktet skal være HH:MM i Europe/Copenhagen.');
    if (field === 'httpsUrl' && value) {
      let url;
      try { url = new URL(value); } catch { throw new Error('HTTPS-adressen er ugyldig.'); }
      if (url.protocol !== 'https:' || url.username || url.password || value.length > 500)
        throw new Error('Brug en HTTPS-adresse uden brugernavn, adgangskode eller indlejrede adgangsnøgler.');
    }
    if (['userId', 'guildId'].includes(field) && value && !/^\d{15,22}$/.test(value)) throw new Error('Discord-ID skal være 15–22 cifre.');
    if (value.length > 500 || sensitive(value)) throw new Error('Et almindeligt indstillingsfelt er for langt eller indeholder følsomme oplysninger.');
    return value;
  }

  function attach({ document, api, getToken, storage, confirm = message => globalThis.confirm(message) }) {
    const byId = id => document.getElementById(id);
    let storageAccessible = true;
    if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch { storageAccessible = false; } }
    function group(kind) {
      const config = definitions[kind], form = byId(config.form), status = byId(config.status), submit = byId(config.submit), reload = byId(config.reload);
      const fieldMap = Object.fromEntries(Object.entries(config.fields).map(([name, [id, type, label]]) =>
        [name, { node: byId(id), type, label }]));
      const scopedFields = () => kind === 'system' && typeof form.dataset?.scopeFields === 'string'
        ? form.dataset.scopeFields.split(',').filter(name => Object.hasOwn(fieldMap, name)) : Object.keys(fieldMap);
      const draftKey = `jarvis:v5:settings-draft:${kind}`;
      let owner = getToken(), generation = 0, request = 0, latest = null, loaded = false, saving = false;
      let storageReady = storageAccessible, lastError = '', lastSuccess = '', basis = {}, dirty = new Set(), conflicts = new Set(), deferred = new Set();
      const edits = Object.fromEntries(Object.keys(fieldMap).map(name => [name, 0]));
      const raw = name => fieldMap[name].type === 'checkbox' ? fieldMap[name].node.checked : fieldMap[name].node.value;
      const publicValue = (name, snapshot) => fieldMap[name].type === 'checkbox' ? snapshot[name] === true
        : fieldMap[name].type === 'number' ? String(snapshot[name] ?? '') : String(snapshot[name] ?? '');
      const same = (name, left, right) => fieldMap[name].type === 'checkbox' ? left === right : String(left ?? '').trim() === String(right ?? '').trim();
      const put = (name, value) => { if (fieldMap[name].type === 'checkbox') fieldMap[name].node.checked = value === true; else fieldMap[name].node.value = String(value ?? ''); };
      const nonSecretUnsafe = name => fieldMap[name].type !== 'secret' && sensitive(raw(name), owner || '');
      const safeError = error => {
        let message = String(error?.message || 'Ukendt fejl');
        for (const value of [owner, ...Object.keys(fieldMap).filter(name => fieldMap[name].type === 'secret').map(raw)])
          if (typeof value === 'string' && value.trim()) message = message.split(value.trim()).join('[hemmelighed skjult]');
        return message.replace(new RegExp(secretPattern.source, 'giu'), '[hemmelighed skjult]').slice(0, 700);
      };
      function persist() {
        const values = {}, savedBasis = {};
        for (const name of dirty) if (fieldMap[name].type !== 'secret' && !nonSecretUnsafe(name)) {
          values[name] = raw(name);
          if (basis[name]) savedBasis[name] = { ...basis[name] };
        }
        try {
          if (!owner || !Object.keys(values).length) storage?.removeItem(draftKey);
          else if (storage) storage.setItem(draftKey, JSON.stringify({ values, basis: savedBasis }));
          else throw new Error('Browser storage unavailable');
          storageReady = storageAccessible;
        } catch { storageReady = false; }
      }
      function message(text = '') {
        const scopeFields = scopedFields(), scopeDirty = [...dirty].filter(name => scopeFields.includes(name)), scopeConflicts = [...conflicts].filter(name => scopeFields.includes(name));
        const secrets = scopeFields.filter(name => fieldMap[name].type === 'secret' && String(raw(name)).trim());
        const blocked = scopeFields.some(nonSecretUnsafe);
        const missingBasis = scopeDirty.some(name => typeof basis[name]?.hash !== 'string');
        const conflictText = scopeConflicts.length ? `Ændret et andet sted: ${scopeConflicts.map(name => fieldMap[name].label).join(', ')}. Din kladde er bevaret. Gennemgå de gemte værdier før en ny ændring.` : '';
        const next = [text || lastError || conflictText || lastSuccess || (scopeDirty.length ? 'Ugemte ændringer. Opdateringer og navigation erstatter ikke din kladde.' : 'Ingen ugemte ændringer i denne kategori.'),
          deferred.size ? 'Et fokuseret felt har nye serverværdier. Visningen opdateres, når du forlader feltet, medmindre du redigerer det.' : '',
          !loaded || missingBasis ? 'Hent indstillingerne, før du gemmer. Et manglende grundlag må ikke gættes.' : '',
          secrets.length ? 'Nye nøgler findes kun i hukommelsen i denne fane. De mistes ved genindlæsning og gemmes aldrig som browserkladde.' : '',
          blocked ? 'Følsomme oplysninger i almindelige felter gemmes ikke som browserkladde. Fjern dem før gemning.' : '',
          !storageReady && dirty.size ? 'Browseren afviser kladdelagring. Kopiér almindelig tekst før siden lukkes.' : ''].filter(Boolean).join(' ');
        if (status.textContent !== next) status.textContent = next;
        status.classList.toggle('v5-error', Boolean(lastError || scopeConflicts.length || blocked));
        submit.disabled = saving || !loaded || missingBasis || scopeConflicts.length > 0 || blocked;
        reload.disabled = saving;
      }
      function mark(name) {
        edits[name]++; lastSuccess = '';
        if (fieldMap[name].type === 'secret') {
          if (String(raw(name)).trim()) dirty.add(name); else { dirty.delete(name); conflicts.delete(name); }
        } else if (latest && same(name, raw(name), publicValue(name, latest)) && conflicts.has(name)) {
          dirty.delete(name); conflicts.delete(name); basis[name] = { value: publicValue(name, latest), hash: digest(latest.basis?.[name]) };
        } else if (basis[name] && same(name, raw(name), basis[name].value) && !conflicts.has(name)) dirty.delete(name);
        else dirty.add(name);
        deferred.delete(name); persist(); message();
      }
      function renderStatus(snapshot) {
        if (kind === 'system') byId('settings-status').textContent =
          `Push: ${snapshot.pushConfigured ? 'konfigureret' : 'mangler nøgler'} · npm-installation: ${snapshot.npmInstallEnabled ? 'aktiveret på serveren' : 'låst på serveren'}`;
        else if (kind === 'discord') {
          const names = { disabled: 'Deaktiveret', connecting: 'Forbinder', reconnecting: 'Genopretter forbindelse',
            connected: 'Forbundet', paused: 'Midlertidigt pauset – køen er fuld', error: 'Fejl' };
          byId('discord-status').textContent = [
            `Discord: ${names[snapshot.status] || 'Status ukendt'} · Token: ${snapshot.hasToken ? 'gemt' : 'mangler'}`,
            snapshot.lastError || '', snapshot.dedupeStatus ? `Modtagelsesjournal: ${({ active: 'klar', loading: 'indlæses', error: 'fejlet', inactive: 'inaktiv' })[snapshot.dedupeStatus] || 'ukendt'}` : '',
            snapshot.unknownMessageCount ? `${snapshot.unknownMessageCount} uafklarede beskeder; ingen automatisk gentagelse` : '',
            snapshot.incoming ? `Kø: ${snapshot.incoming.running} arbejder · ${snapshot.incoming.waiting} venter` : '',
            snapshot.ingressGap?.status === 'requires_review' ? 'Muligt leveringshul: kontrollér manglende ønsker og send dem som nye beskeder efter gennemgang.' : '',
          ].filter(Boolean).join(' · ');
        } else byId('proactive-status').textContent = 'Tiderne følger Europe/Copenhagen, også ved sommer-/vintertid. Hver aktivering kræver dit tilvalg og et eksplicit klik på Gem.';
      }
      function apply(snapshot, acknowledged = new Set()) {
        if (!snapshot || typeof snapshot !== 'object' || !snapshot.basis || typeof snapshot.basis !== 'object')
          throw new Error('Serveren mangler et revisionsgrundlag for indstillingerne. Genindlæs en kompatibel kandidat før gemning.');
        latest = snapshot;
        loaded = Object.keys(fieldMap).every(name => Boolean(digest(snapshot.basis[name])));
        renderStatus(snapshot);
        for (const [name, field] of Object.entries(fieldMap)) {
          const next = { hash: digest(snapshot.basis[name]), ...(field.type === 'secret' ? {} : { value: publicValue(name, snapshot) }) };
          if (acknowledged.has(name)) { basis[name] = next; conflicts.delete(name); }
          if (field.type === 'secret') {
            if (dirty.has(name) && basis[name]?.hash && basis[name].hash !== next.hash) conflicts.add(name);
            else if (!dirty.has(name) || !basis[name]) basis[name] = next;
            continue;
          }
          if (dirty.has(name)) {
            if (!basis[name]) basis[name] = next;
            else if (same(name, raw(name), next.value)) { basis[name] = next; dirty.delete(name); conflicts.delete(name); }
            else if (basis[name].hash !== next.hash) conflicts.add(name);
          } else if (document.activeElement === field.node && !same(name, raw(name), next.value) && basis[name]) deferred.add(name);
          else { put(name, next.value); basis[name] = next; conflicts.delete(name); deferred.delete(name); }
        }
        persist(); message();
      }
      function reset() {
        generation++; request++; dirty = new Set(); conflicts = new Set(); deferred = new Set(); basis = {}; latest = null;
        loaded = false; saving = false; lastError = ''; lastSuccess = '';
        for (const [name, field] of Object.entries(fieldMap)) put(name, field.type === 'checkbox' ? false : '');
        try { storage?.removeItem(draftKey); } catch { /* Cleared controls remain private. */ }
        message();
      }
      async function refresh() {
        if (!getToken()) return;
        if (owner !== getToken()) { reset(); owner = getToken(); }
        if (saving) return;
        const read = ++request, scope = generation, currentOwner = getToken();
        try {
          const response = await api(config.readPath || config.path);
          const snapshot = config.snapshotKey ? response?.[config.snapshotKey] : response;
          if (read !== request || scope !== generation || currentOwner !== getToken()) return;
          apply(snapshot);
        } catch (error) { if (read === request && scope === generation && currentOwner === getToken()) {
          lastError = `Indstillingerne kunne ikke hentes: ${safeError(error)} Din kladde er bevaret.`; message();
        } }
      }
      async function save(event) {
        event.preventDefault(); if (saving) return;
        const currentOwner = getToken(), scope = generation;
        const selectedFields = new Set(scopedFields());
        try {
          if (!currentOwner || !loaded) throw new Error('Hent et verificeret indstillingsgrundlag før gemning.');
          // Password managers may fill without an input event. An explicit form
          // submission still compares every control with its original basis.
          for (const [name, field] of Object.entries(fieldMap)) {
            if (!selectedFields.has(name)) continue;
            if (field.type === 'secret') { if (String(raw(name)).trim()) dirty.add(name); else dirty.delete(name); }
            else if (!basis[name] || !same(name, raw(name), basis[name].value)) dirty.add(name);
          }
          if ([...conflicts].some(name => selectedFields.has(name))) throw new Error('Et eller flere felter er ændret et andet sted. Gennemgå de gemte værdier først.');
          const patch = {}, expectedBasis = {}, submitted = {}, versions = {};
          for (const name of dirty) {
            if (!selectedFields.has(name)) continue;
            if (nonSecretUnsafe(name)) throw new Error('Fjern følsomme oplysninger fra almindelige indstillingsfelter.');
            if (!basis[name]?.hash) throw new Error('Et ændret felt mangler revisionsgrundlag. Hent indstillingerne igen.');
            patch[name] = validate(name, raw(name), fieldMap[name].type);
            expectedBasis[name] = { digest: basis[name].hash }; submitted[name] = raw(name); versions[name] = edits[name];
          }
          if (!Object.keys(patch).length) { lastError = ''; lastSuccess = 'Ingen ændrede felter. Ingen indstillinger er skrevet.'; message(); return; }
          saving = true; request++; lastError = ''; lastSuccess = ''; message('Gemmer kun de felter, du har ændret …');
          const result = await api(config.path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patch, expectedBasis }) });
          if (scope !== generation || currentOwner !== getToken()) return;
          if (!result?.ok || !result.settings?.basis) throw new Error('Serverens svar bekræfter ikke de gemte værdier. Hent status før et nyt forsøg.');
          for (const name of Object.keys(patch)) {
            if (versions[name] === edits[name] && raw(name) === submitted[name]) {
              dirty.delete(name); if (fieldMap[name].type === 'secret') put(name, '');
            } else if (fieldMap[name].type !== 'secret' || String(raw(name)).trim()) dirty.add(name);
          }
          lastSuccess = 'De indsendte ændringer er gemt. Nyere indtastning er stadig en kladde.' +
            (Object.values(fieldMap).some(field => field.type === 'secret') ? ' Blanke nøglefelter bevarer de gemte nøgler.' : ' Andre tilvalg er ikke ændret.');
          apply(result.settings, new Set(Object.keys(patch)));
        } catch (error) { if (scope === generation && currentOwner === getToken()) {
          lastError = `Gemning kunne ikke bekræftes: ${safeError(error)} Din kladde er bevaret. Der foretages ingen automatisk gentagelse.`;
          persist(); message();
        } } finally { if (scope === generation && currentOwner === getToken()) { saving = false; message(); } }
      }
      for (const [name, field] of Object.entries(fieldMap)) {
        field.node.addEventListener('input', () => mark(name)); field.node.addEventListener('change', () => mark(name));
        field.node.addEventListener('blur', () => {
          if (deferred.has(name) && !dirty.has(name) && latest) { put(name, publicValue(name, latest)); basis[name] = { value: publicValue(name, latest), hash: digest(latest.basis[name]) }; deferred.delete(name); message(); }
        });
      }
      reload.addEventListener('click', async () => {
        const selected = scopedFields();
        if ((selected.some(name => dirty.has(name)) || selected.some(name => fieldMap[name].type === 'secret' && raw(name))) &&
            !confirm('Kassér denne formulars aktive kategori, inklusive nye nøgleindtastninger, og hent de gemte værdier?')) return;
        if (selected.length === Object.keys(fieldMap).length) reset();
        else {
          request++;
          for (const name of selected) {
            edits[name]++; dirty.delete(name); conflicts.delete(name); deferred.delete(name); delete basis[name];
            put(name, fieldMap[name].type === 'checkbox' ? false : '');
          }
          lastError = ''; lastSuccess = ''; persist(); message();
        }
        owner = getToken(); await refresh();
      });
      document.addEventListener?.('jarvis:view-changed', () => { if (kind === 'system') { lastError = ''; lastSuccess = ''; message(); } });
      byId('logout').addEventListener('click', () => { reset(); owner = ''; });
      globalThis.addEventListener?.('beforeunload', event => {
        if (Object.keys(fieldMap).some(name => fieldMap[name].type === 'secret' && raw(name)) ||
            [...dirty].some(nonSecretUnsafe) || dirty.size && !storageReady) {
          event.preventDefault(); event.returnValue = '';
        }
      });
      try {
        const saved = owner && storage?.getItem(draftKey);
        if (saved && saved.length <= 15_000) {
          const data = JSON.parse(saved);
          if (data?.values && typeof data.values === 'object') for (const [name, value] of Object.entries(data.values)) {
            if (!Object.hasOwn(fieldMap, name) || fieldMap[name].type === 'secret' || sensitive(value, owner || '') ||
                !['boolean', 'string'].includes(typeof value) || String(value).length > 500) continue;
            put(name, value); dirty.add(name);
            const base = data.basis?.[name];
            if (base && typeof base.hash === 'string' && base.hash.length <= 200 && !sensitive(base.value, owner || ''))
              basis[name] = { value: base.value, hash: base.hash };
          }
          if (dirty.size) lastSuccess = 'Ikke-hemmelig indstillingskladde er gendannet. Hent og gennemgå det aktuelle grundlag før gemning.';
        } else if (!owner) storage?.removeItem(draftKey);
      } catch { storageReady = false; }
      message();
      return Object.freeze({ refresh, save, reset, form });
    }
    const system = group('system'), discord = group('discord'), proactive = group('proactive');
    return Object.freeze({ refresh: () => Promise.all([system.refresh(), discord.refresh(), proactive.refresh()]),
      refreshProactive: () => proactive.refresh(), saveProactive: event => proactive.save(event),
      saveSystem: event => system.save(event), saveDiscord: event => discord.save(event) });
  }
  return Object.freeze({ definitions, sensitive, validate, attach });
})();
