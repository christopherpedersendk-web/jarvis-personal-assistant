// v4.9 — owner-controlled personal memory. Source text is always inert data.
// Refreshes never replace an unsaved correction or confirm a proposed fact.
(() => {
  const root = document.getElementById('memory-workbench-content');
  if (!root) return;

  const categories = {
    fact: 'Faktum', preference: 'Præference', household: 'Husstand', food: 'Mad', project: 'Projekt',
  };
  const sources = { user: 'Oplyst af dig', assistant: 'Forslag fra JARVIS', legacy: 'Tidligere gemt' };
  const channels = { manual: 'brugerfladen', text: 'chat', discord: 'Discord', voice: 'stemme', legacy: 'tidligere version' };
  let loaded = false;
  let loading = false;
  let generation = 0;
  let counter = 0;
  const cards = new Map();
  const dirtyIds = new Set();
  const busyIds = new Set();

  function element(tag, text = '', css = '') {
    const node = document.createElement(tag);
    node.textContent = String(text);
    if (css) node.className = css;
    return node;
  }
  function button(text, css = 'secondary') {
    const node = element('button', text, css);
    node.type = 'button';
    return node;
  }
  function field(labelText, input, id) {
    const wrapper = element('div', '', 'memory-v49-field');
    input.id = id;
    const label = element('label', labelText);
    label.htmlFor = id;
    wrapper.append(label, input);
    return wrapper;
  }
  function categorySelect(value = 'fact') {
    const select = document.createElement('select');
    for (const [key, label] of Object.entries(categories)) {
      const option = element('option', label); option.value = key; select.append(option);
    }
    select.value = Object.hasOwn(categories, value) ? value : 'fact';
    return select;
  }
  function localDateTime(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return '';
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function displayDate(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? date.toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' }) : 'Tidspunkt ikke registreret';
  }
  function request(path, method, body) {
    return api(path, { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) });
  }

  const toolbar = element('div', '', 'memory-v49-toolbar');
  const refreshButton = button('Opdater hukommelsen');
  const count = element('span', '', 'muted micro');
  toolbar.append(refreshButton, count);
  const feedback = element('p', '', 'memory-v49-feedback muted small-text');
  feedback.id = 'memory-workbench-status'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  const createForm = element('form', '', 'memory-v49-create');
  createForm.id = 'memory-workbench-form';
  const newText = document.createElement('textarea');
  newText.rows = 2; newText.maxLength = 1200; newText.required = true;
  newText.placeholder = 'Fx: Husk, at jeg foretrækker hurtige retter på hverdage.';
  const newCategory = categorySelect();
  const createButton = element('button', 'Gem i min hukommelse', 'primary'); createButton.type = 'submit';
  createForm.append(field('Hvad skal JARVIS huske?', newText, 'memory-workbench-text'),
    field('Kategori', newCategory, 'memory-workbench-category'), createButton);
  const list = element('div', '', 'memory-v49-list'); list.id = 'memory-workbench-list';
  const empty = element('p', 'Ingen aktive hukommelsespunkter endnu. Gem kun oplysninger, du ønsker brugt på tværs af samtaler.', 'muted small-text');
  const privacy = element('p', 'Arkivering fjerner punktet fra den aktive hukommelse og søgning. Tidligere samtaler og sikkerhedskopier ændres ikke.', 'muted micro');
  root.append(toolbar, feedback, createForm, empty, list, privacy);

  const creationDirty = () => Boolean(newText.value.trim()) || newCategory.value !== 'fact';
  const hasDirty = () => creationDirty() || dirtyIds.size > 0;
  function updateCount() {
    count.textContent = `${cards.size} hukommelsespunkt${cards.size === 1 ? '' : 'er'}`;
    empty.hidden = cards.size > 0;
  }
  function notify(message, withToast = false) {
    feedback.textContent = message;
    if (withToast) toast(message);
  }

  function renderCard(item) {
    const card = element('article', '', 'memory-v49-card');
    card.dataset.memoryId = String(item.id);
    const revision = Number.isInteger(item.revision) ? item.revision : 1;
    const isProposed = item.status === 'proposed';
    const expiry = item.expiresAt ? Date.parse(item.expiresAt) : NaN;
    const expired = Number.isFinite(expiry) && expiry <= Date.now();
    const heading = element('div', '', 'memory-v49-card-heading');
    const state = element('span', expired ? 'Udløbet · bruges ikke' : isProposed ? 'Forslag · afventer dig' : 'Bekræftet',
      `memory-v49-state ${expired ? 'expired' : isProposed ? 'proposed' : 'confirmed'}`);
    heading.append(element('span', categories[item.category] || 'Faktum', 'micro'), state);
    const summary = element('p', item.text || '', 'memory-v49-text');
    const source = item.source && typeof item.source === 'object' ? item.source : { kind: 'legacy', channel: 'legacy' };
    const provenance = `${sources[source.kind] || 'Kilde ikke angivet'} · ${channels[source.channel] || 'kanal ikke angivet'}`;
    const metadata = element('p', `${provenance} · Opdateret ${displayDate(item.updatedAt || item.createdAt)} · Revision ${revision}`, 'muted micro');
    card.append(heading, summary, metadata);
    if (item.expiresAt) card.append(element('p', `Udløb: ${displayDate(item.expiresAt)}`, 'muted micro'));
    if (isProposed) card.append(element('p', 'Dette er et forslag og bruges ikke som et bekræftet faktum, før du godkender det.', 'muted small-text'));

    const details = document.createElement('details'); details.className = 'memory-v49-editor';
    details.append(element('summary', 'Ret hukommelsen'));
    const form = element('form', '', 'memory-v49-edit-form');
    const input = document.createElement('textarea'); input.rows = 3; input.maxLength = 1200; input.required = true; input.value = String(item.text || '');
    const category = categorySelect(item.category);
    const expires = document.createElement('input'); expires.type = 'datetime-local'; expires.step = '60'; expires.value = localDateTime(item.expiresAt);
    const original = { text: input.value, category: category.value, expires: expires.value };
    const uid = `memory-v49-${++counter}`;
    const saveButton = element('button', 'Gem rettelse', 'primary'); saveButton.type = 'submit'; saveButton.disabled = true;
    const cancel = button('Fortryd rettelse'); cancel.disabled = true;
    const actions = element('div', '', 'memory-v49-actions'); actions.append(saveButton, cancel);
    const editStatus = element('p', '', 'muted micro'); editStatus.setAttribute('role', 'status');
    form.append(field('Hukommelsespunkt', input, `${uid}-text`),
      field('Kategori', category, `${uid}-category`),
      field('Udløb i din enheds lokale tid (valgfrit)', expires, `${uid}-expires`),
      actions, editStatus);
    details.append(form);
    card.append(details);

    const footer = element('div', '', 'memory-v49-actions');
    const confirmButton = isProposed ? button('Bekræft hukommelsen', 'primary') : null;
    const archive = button('Arkivér fra aktiv hukommelse', 'quiet');
    if (confirmButton) { confirmButton.disabled = expired; footer.append(confirmButton); }
    footer.append(archive); card.append(footer);

    function checkDirty() {
      const changed = input.value !== original.text || category.value !== original.category || expires.value !== original.expires;
      if (changed) dirtyIds.add(item.id); else dirtyIds.delete(item.id);
      saveButton.disabled = !changed || busyIds.has(item.id);
      cancel.disabled = !changed || busyIds.has(item.id);
      if (confirmButton) confirmButton.disabled = changed || expired || busyIds.has(item.id);
      editStatus.textContent = changed ? 'Ikke gemt. Gem rettelsen, før du bekræfter eller opdaterer listen.' : '';
    }
    form.addEventListener('input', checkDirty);
    form.addEventListener('change', checkDirty);
    cancel.addEventListener('click', () => {
      input.value = original.text; category.value = original.category; expires.value = original.expires;
      checkDirty();
    });
    async function mutate(action, operation, success) {
      if (busyIds.has(item.id)) return;
      generation++; busyIds.add(item.id);
      input.disabled = true; category.disabled = true; expires.disabled = true;
      saveButton.disabled = true; cancel.disabled = true; archive.disabled = true;
      if (confirmButton) confirmButton.disabled = true;
      editStatus.textContent = action;
      try {
        const result = await operation();
        dirtyIds.delete(item.id);
        if (result.memory?.archived) { card.remove(); cards.delete(item.id); }
        else if (result.memory?.id) replaceCard(result.memory);
        else throw new Error('Serveren returnerede ikke et gyldigt hukommelsespunkt.');
        updateCount(); notify(success, true);
      } catch (error) {
        editStatus.textContent = error.message;
        notify(`Ændringen er ikke gemt: ${error.message}`);
      } finally {
        busyIds.delete(item.id);
        input.disabled = false; category.disabled = false; expires.disabled = false; archive.disabled = false;
        // The old card may already have been replaced. Preserve errors and edits
        // if the current one remains in the document after a failed mutation.
        if (card.isConnected) {
          const failure = editStatus.textContent;
          checkDirty();
          if (failure && failure !== action) editStatus.textContent = failure;
        }
      }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!dirtyIds.has(item.id) || !form.reportValidity()) return;
      let expiresAt = expires.value === original.expires ? (item.expiresAt || null) : null;
      if (expires.value && expires.value !== original.expires) {
        const parsed = new Date(expires.value);
        if (!Number.isFinite(parsed.getTime())) { editStatus.textContent = 'Angiv et gyldigt udløbstidspunkt.'; return; }
        expiresAt = parsed.toISOString();
      }
      await mutate('Gemmer rettelsen …', () => request(`/api/memories/${encodeURIComponent(item.id)}`, 'PUT', {
        expectedRevision: revision, text: input.value.trim(), category: category.value, expiresAt,
      }), isProposed ? 'Forslaget er rettet. Det afventer stadig din bekræftelse.' : 'Hukommelsespunktet er rettet.');
    });
    confirmButton?.addEventListener('click', async () => {
      if (dirtyIds.has(item.id) || expired) return;
      await mutate('Bekræfter hukommelsen …', () => request(`/api/memories/${encodeURIComponent(item.id)}/confirm`, 'POST', {
        expectedRevision: revision,
      }), 'Hukommelsen er bekræftet og kan bruges af JARVIS.');
    });
    archive.addEventListener('click', async () => {
      await mutate('Arkiverer hukommelsen …', () => request(`/api/memories/${encodeURIComponent(item.id)}/archive`, 'POST', {
        expectedRevision: revision,
      }), 'Punktet er fjernet fra aktiv hukommelse og søgning.');
    });
    return card;
  }

  function replaceCard(item) {
    const old = cards.get(item.id);
    const next = renderCard(item);
    cards.set(item.id, next);
    if (old?.isConnected) old.replaceWith(next); else list.prepend(next);
  }
  async function refreshMemories({ userRequested = false } = {}) {
    if (hasDirty() || busyIds.size) {
      if (userRequested) notify('Du har en ikke-gemt rettelse. Gem eller fortryd den først; dine felter er bevaret.');
      return;
    }
    if (loading) return;
    const requestGeneration = ++generation;
    loading = true; refreshButton.disabled = true; notify('Henter din hukommelse …');
    try {
      const data = await api('/api/memories');
      if (requestGeneration !== generation || hasDirty() || busyIds.size) {
        notify('Dine ikke-gemte felter er bevaret. Opdater listen, når du er færdig.');
        return;
      }
      if (!Array.isArray(data.memories)) throw new Error('Hukommelsen kunne ikke læses.');
      list.replaceChildren(); cards.clear(); dirtyIds.clear();
      // Preserve the server's order while inserting inert, bounded records.
      for (const item of data.memories.filter(entry => entry && !entry.archived).slice(0, 250)) {
        if (!item || typeof item.id !== 'string' || typeof item.text !== 'string') continue;
        const card = renderCard(item); cards.set(item.id, card); list.append(card);
      }
      loaded = true; updateCount();
      notify('Kun bekræftede, ikke-udløbne punkter bruges som aktiv hukommelse.');
    } catch (error) { notify(error.message); }
    finally { loading = false; refreshButton.disabled = false; }
  }
  refreshButton.addEventListener('click', () => refreshMemories({ userRequested: true }));
  createForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (busyIds.has('new') || !createForm.reportValidity()) return;
    generation++; busyIds.add('new'); createButton.disabled = true; newText.disabled = true; newCategory.disabled = true;
    try {
      const result = await request('/api/memories', 'POST', { text: newText.value.trim(), category: newCategory.value });
      if (!result.memory?.id) throw new Error('Serveren returnerede ikke et gyldigt hukommelsespunkt.');
      newText.value = ''; newCategory.value = 'fact';
      // Exact-duplicate creation may return an existing record. Never discard
      // a correction already being edited on that record.
      if (!dirtyIds.has(result.memory.id)) replaceCard(result.memory);
      updateCount(); notify('Dit hukommelsespunkt er gemt.', true);
    } catch (error) { notify(error.message); }
    finally { busyIds.delete('new'); createButton.disabled = false; newText.disabled = false; newCategory.disabled = false; }
  });
  document.addEventListener('jarvis:refreshed', () => { if (!loaded) refreshMemories(); });
  document.querySelector('[data-tab="knowledge"]')?.addEventListener('click', () => refreshMemories());
  document.addEventListener('jarvis:memories-changed', () => refreshMemories());
  window.addEventListener('beforeunload', event => {
    if (!hasDirty()) return;
    event.preventDefault(); event.returnValue = '';
  });
  if (!document.getElementById('workspace')?.classList.contains('hidden')) refreshMemories();
})();
