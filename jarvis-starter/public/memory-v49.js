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
  let loading = null;
  let loadingArchived = false, loadingGeneration = -1, pinnedMemoryId = null;
  let generation = 0;
  let counter = 0;
  let owner = localStorage.getItem('jarvisAccessToken') || '';
  let authEpoch = 0;
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
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date)
      .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const pad = number => String(number).padStart(2, '0');
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  }
  function displayDate(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? date.toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }) : 'Tidspunkt ikke registreret';
  }
  function request(path, method, body) {
    return api(path, { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) });
  }

  const toolbar = element('div', '', 'memory-v49-toolbar');
  const refreshButton = button('Opdater hukommelsen');
  const showArchived = document.createElement('input'); showArchived.type = 'checkbox'; showArchived.id = 'memory-show-archived';
  const archiveLabel = element('label'); archiveLabel.htmlFor = showArchived.id;
  archiveLabel.append(showArchived, element('span', 'Vis arkiverede noter'));
  const count = element('span', '', 'muted micro');
  toolbar.append(refreshButton, archiveLabel, count);
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
  const editorMode = document.getElementById('memory-editor-mode');
  const claimForm = document.getElementById('personal-claim-form');
  const claimStatus = document.getElementById('claim-status');
  const noteDraftKey = 'jarvis:v5:memory-note-draft';
  const editDraftKey = 'jarvis:v5:memory-note-edits';
  const modeKey = 'jarvis:v5:memory-mode';
  const archiveKey = 'jarvis:v5:memory-archived-visible';
  let draftStorageAvailable = true;
  let editStorageAvailable = true, newUncertain = false;
  const restored = new Map();
  const unsafeDraft = value => /\bsk-[\w-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|-----BEGIN .*PRIVATE KEY-----|\b(?:password|adgangskode|api[_ -]?key|token|secret)\s*[:=]\s*\S{6,}|\bAuthorization\s*:\s*Bearer\s+\S+|\b(?:cpr|personnummer)\s*:?\s*\d{6}[- ]?\d{4}/i.test(value) ||
    Boolean(owner.length >= 6 && value.includes(owner));
  const unknownOutcome = error => !Number.isInteger(error.status) || error.status >= 500 || /ukendt|kan være gemt|kan være udført|lagerets seneste udfald/i.test(error.message || '');
  root.append(toolbar, feedback, createForm, claimForm, claimStatus, empty, list, privacy);
  function setEditorMode() {
    const structured = editorMode.value === 'claim';
    createForm.classList.toggle('hidden', structured);
    claimForm.classList.toggle('hidden', !structured);
    try { sessionStorage.setItem(modeKey, editorMode.value); } catch { draftStorageAvailable = false; }
  }
  try {
    if (owner) {
      const saved = JSON.parse(sessionStorage.getItem(noteDraftKey) || 'null');
      if (saved && typeof saved.text === 'string' && saved.text.length <= 1200 && !unsafeDraft(JSON.stringify(saved))) {
        newText.value = saved.text;
        if (Object.hasOwn(categories, saved.category)) newCategory.value = saved.category;
        newUncertain = saved.uncertain === true;
        if (newText.value) feedback.textContent = 'Ugemt hukommelseskladde er gendannet fra denne browserfane.';
      } else if (saved) sessionStorage.removeItem(noteDraftKey);
      editorMode.value = sessionStorage.getItem(modeKey) === 'claim' ? 'claim' : 'note';
      showArchived.checked = sessionStorage.getItem(archiveKey) === 'yes';
      const raw = sessionStorage.getItem(editDraftKey);
      if (raw && raw.length <= 650_000) {
        const edits = JSON.parse(raw);
        for (const saved of Array.isArray(edits) ? edits.slice(0, 250) : []) {
          if (saved?.base && typeof saved.base.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(saved.base.id) &&
              Number.isInteger(saved.base.revision) && saved.base.revision > 0 && typeof saved.base.text === 'string' && saved.base.text.length <= 1200 &&
              typeof saved.fields?.text === 'string' && saved.fields.text.length <= 1200 && Object.hasOwn(categories, saved.fields.category) &&
              typeof saved.fields.expires === 'string' && saved.fields.expires.length <= 40 && !unsafeDraft(JSON.stringify(saved))) restored.set(saved.base.id, saved);
        }
      }
    } else { for (const key of [noteDraftKey, editDraftKey, modeKey, archiveKey]) sessionStorage.removeItem(key); }
  } catch { /* invalid or unavailable tab storage must never prevent editing */ }
  function saveNoteDraft() {
    try {
      const data = JSON.stringify({ text: newText.value, category: newCategory.value, uncertain: newUncertain });
      if (unsafeDraft(data)) { sessionStorage.removeItem(noteDraftKey); draftStorageAvailable = false;
        feedback.textContent = 'Denne kladde ligner en hemmelighed og gemmes ikke i browserlageret. Fjern følsomme oplysninger; behold fanen åben indtil da.'; return; }
      if (!owner) sessionStorage.removeItem(noteDraftKey);
      else if (newText.value || newCategory.value !== 'fact' || newUncertain) sessionStorage.setItem(noteDraftKey, data);
      else sessionStorage.removeItem(noteDraftKey);
      draftStorageAvailable = true;
    } catch { draftStorageAvailable = false; feedback.textContent = 'Browseren kan ikke gendanne notekladden efter lukning. Behold fanen åben; dine felter er bevaret.'; }
  }
  function saveEditDrafts() {
    const saved = new Map(restored);
    for (const [id, card] of cards) {
      const view = card.memoryView;
      if (view.keep()) saved.set(id, view.snapshot()); else saved.delete(id);
    }
    try {
      const items = [...saved.values()].filter(value => !unsafeDraft(JSON.stringify(value)));
      editStorageAvailable = items.length === saved.size;
      const text = JSON.stringify(items);
      if (text.length > 650_000) throw new Error('Browserkladden er for stor.');
      if (owner && items.length) sessionStorage.setItem(editDraftKey, text); else sessionStorage.removeItem(editDraftKey);
    } catch { editStorageAvailable = false; }
  }
  editorMode.addEventListener('change', setEditorMode);
  newText.addEventListener('input', saveNoteDraft);
  newCategory.addEventListener('change', saveNoteDraft);
  // v5-plan owns the structured editor, including its captured revision,
  // source and validity draft. A second three-field writer would lose those
  // fields on every input. Notes continue to use their own draft above.
  setEditorMode();

  const creationDirty = () => Boolean(newText.value.trim()) || newCategory.value !== 'fact';
  const hasDirty = () => creationDirty() || dirtyIds.size > 0 || newUncertain ||
    [...cards.values()].some(card => card.memoryView?.uncertain);
  function updateCount() {
    count.textContent = `${cards.size} hukommelsespunkt${cards.size === 1 ? '' : 'er'}`;
    empty.hidden = cards.size > 0;
  }
  function notify(message, withToast = false) {
    feedback.textContent = message;
    if (withToast) toast(message);
  }
  function currentSummary(record) {
    const { revisionHistory, ...current } = record;
    return { ...current, historyCount: record.historyCount ?? (Array.isArray(revisionHistory) ? revisionHistory.length : 0) };
  }

  function renderCard(item, saved = null) {
    const card = element('article', '', 'memory-v49-card');
    card.dataset.memoryId = String(item.id);
    const view = { base: currentSummary(item), latest: currentSummary(item), missing: false,
      uncertain: saved?.uncertain === true, message: saved?.message || '', failed: saved?.failed === true };
    const heading = element('div', '', 'memory-v49-card-heading');
    const categoryLabel = element('span', '', 'micro'), state = element('span', '', 'memory-v49-state');
    heading.append(categoryLabel, state);
    const summary = element('p', '', 'memory-v49-text'), metadata = element('p', '', 'muted micro');
    const expiryText = element('p', '', 'muted micro');
    card.append(heading, summary, metadata, expiryText);
    const details = document.createElement('details'); details.className = 'memory-v49-editor';
    details.append(element('summary', 'Ret hukommelsen'));
    const form = element('form', '', 'memory-v49-edit-form');
    const input = document.createElement('textarea'); input.rows = 3; input.maxLength = 1200; input.required = true;
    const category = categorySelect(item.category);
    const expires = document.createElement('input'); expires.type = 'datetime-local'; expires.step = '60';
    const fold = document.createElement('select');
    for (const [value, title] of [['reject', 'Spørg mig — ingen automatisk antagelse'],
      ['earlier', 'Første forekomst (sommertid)'], ['later', 'Anden forekomst (vintertid)']]) {
      const option = element('option', title); option.value = value; fold.append(option);
    }
    const uid = 'memory-v49-' + (++counter);
    const saveButton = element('button', 'Gem rettelse', 'primary'); saveButton.type = 'submit';
    const cancel = button('Fortryd rettelse'), reload = button('Hent nyeste note og kassér kladde');
    const review = button('Kontrollér notens gemningsudfald');
    const actions = element('div', '', 'memory-v49-actions'); actions.append(saveButton, cancel, reload, review);
    const editStatus = element('p', '', 'muted micro'); editStatus.setAttribute('role', 'status'); editStatus.setAttribute('aria-live', 'polite');
    form.append(field('Hukommelsespunkt', input, uid + '-text'), field('Kategori', category, uid + '-category'),
      field('Udløb i Europe/Copenhagen (valgfrit)', expires, uid + '-expires'),
      field('Ved to ens klokkeslæt under skift til vintertid', fold, uid + '-repeated-time'), actions, editStatus);
    details.append(form); card.append(details);
    const footer = element('div', '', 'memory-v49-actions');
    const confirmButton = button('Bekræft hukommelsen', 'primary'), archive = button('Arkivér fra aktiv hukommelse', 'quiet');
    footer.append(confirmButton, archive); card.append(footer);
    const historyDetails = element('details', '', 'memory-v49-history');
    const historySummary = element('summary', 'Tidligere revisioner'); historyDetails.append(historySummary);
    const historyStatus = element('p', 'Historik hentes kun, når du vælger det. Tidligere indhold bliver ikke aktuelle fakta.', 'muted micro');
    historyStatus.setAttribute('role', 'status');
    const historyBody = element('div'), historyRead = button('Hent tidligere revisioner');
    historyDetails.append(historyStatus, historyRead, historyBody); card.append(historyDetails);
    let historyRevision = null, historyLoading = false, historyError = '';
    function historyNotice() {
      const latest = view.latest || view.base;
      historySummary.textContent = 'Tidligere revisioner (' + (latest.historyCount || 0) + ')';
      historyStatus.textContent = historyError || (historyLoading ? 'Henter tidligere revisioner …'
        : historyRevision === null ? 'Historik hentes kun, når du vælger det. Tidligere indhold bliver ikke aktuelle fakta.'
          : historyRevision !== latest.revision ? 'Den viste historik gælder revision ' + historyRevision +
            '; noten har siden ændret sig. Hent historikken igen for at gennemgå den nyeste version.'
            : 'Historik til og med notens revision ' + historyRevision + '. Tidligere indhold bruges ikke i søgning eller modelkontekst.');
      historyRead.disabled = historyLoading;
    }
    historyRead.addEventListener('click', async () => {
      if (historyLoading || !owner || owner !== localStorage.getItem('jarvisAccessToken')) return;
      const currentOwner = owner, session = authEpoch; historyLoading = true; historyError = ''; historyNotice();
      try {
        const data = await api('/api/memories/' + encodeURIComponent(item.id) + '/history');
        if (session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
        if (data.id !== item.id || !Number.isInteger(data.revision) || !Array.isArray(data.history) || data.history.length > 101)
          throw new Error('Serveren returnerede ikke notens identificerbare revisionshistorik.');
        const entries = [];
        if (data.earlierRevisionsUnavailable) entries.push(element('p', 'Revisioner før ' + data.firstCapturedRevision +
          ' er ikke registreret. Der er ikke rekonstrueret en ukendt fortid.', 'muted small-text'));
        if (!data.history.length) entries.push(element('p', 'Ingen tidligere revisioner er registreret for denne note.', 'muted'));
        for (const entry of [...data.history].reverse()) {
          const row = element('section', '', 'memory-v49-history-entry'); row.dataset.memoryRevision = String(entry.revision);
          row.append(element('h4', 'Revision ' + entry.revision + ' · historik'), element('p', entry.text || '', 'memory-v49-text'));
          if (entry.redacted) row.append(element('p', 'Følsomt ældre indhold er skjult i denne læsevisning; ingen ny personlig oplysning er oprettet.', 'muted micro'));
          else {
            const provenance = entry.source || {};
            row.append(element('p', (categories[entry.category] || 'Ukendt kategori') + ' · ' +
              (entry.status === 'proposed' ? 'Tidligere forslag — ikke bekræftet' : entry.status === 'confirmed'
                ? 'Tidligere bekræftet — ikke aktuel' : 'Historisk status: ' + (entry.status || 'ukendt')), 'muted micro'));
            row.append(element('p', (sources[provenance.kind] || 'Ukendt kilde') + ' · ' +
              (channels[provenance.channel] || 'ukendt kanal') + (provenance.messageId ? ' · ' + provenance.messageId : ''), 'muted micro'));
            if (entry.expiresAt) row.append(element('p', Number.isFinite(Date.parse(entry.expiresAt))
              ? 'Datidens udløb: ' + displayDate(entry.expiresAt) : 'Den historiske revision havde et ugyldigt udløbstidspunkt.', 'muted micro'));
          }
          row.append(element('p', ({ update: 'Rettet', confirm: 'Bekræftet', archive: 'Arkiveret' })[entry.change] +
            ' ' + displayDate(entry.replacedAt), 'muted micro')); entries.push(row);
        }
        historyBody.replaceChildren(...entries); historyRevision = data.revision;
      } catch (error) { if (session === authEpoch && currentOwner === localStorage.getItem('jarvisAccessToken'))
        historyError = 'Historikken kunne ikke hentes: ' + error.message + '. En tidligere visning er ikke opdateret.'; }
      finally { if (session === authEpoch && currentOwner === localStorage.getItem('jarvisAccessToken')) { historyLoading = false; historyNotice(); } }
    });
    const fields = () => ({ text: input.value, category: category.value, expires: expires.value, fold: fold.value });
    const baseFields = () => ({ text: view.base.text || '', category: view.base.category || 'fact',
      expires: localDateTime(view.base.expiresAt), fold: 'reject' });
    const dirty = () => JSON.stringify(fields()) !== JSON.stringify(baseFields());
    view.keep = () => dirty() || view.uncertain || busyIds.has(item.id) || details.open || historyDetails.open || card.contains(document.activeElement);
    view.snapshot = () => ({ base: currentSummary(view.base), fields: fields(), open: details.open, uncertain: view.uncertain,
      message: view.message, failed: view.failed, historyOpen: historyDetails.open });
    const changed = () => view.missing || view.latest?.revision !== view.base.revision;
    function renderSummary() {
      const record = view.base, expiry = record.expiresAt ? Date.parse(record.expiresAt) : NaN;
      const expired = Number.isFinite(expiry) && expiry <= Date.now();
      categoryLabel.textContent = categories[record.category] || 'Faktum';
      state.textContent = view.missing ? 'Arkiveret eller utilgængelig · kladden er bevaret'
        : record.archived || view.latest?.archived ? 'Arkiveret · kun læsning · bruges ikke'
        : expired ? 'Udløbet · bruges ikke' : record.status === 'proposed' ? 'Forslag · afventer dig' : 'Bekræftet';
      state.className = 'memory-v49-state ' + (expired || view.missing || record.archived || view.latest?.archived ? 'expired' : record.status === 'proposed' ? 'proposed' : 'confirmed');
      summary.textContent = record.text || '';
      const provenance = record.source || { kind: 'legacy', channel: 'legacy' };
      metadata.textContent = (sources[provenance.kind] || 'Kilde ikke angivet') + ' · ' +
        (channels[provenance.channel] || 'kanal ikke angivet') + (provenance.messageId || provenance.id ? ' · ' + (provenance.messageId || provenance.id) : '') +
        ' · Opdateret ' + displayDate(record.updatedAt || record.createdAt) + ' · Revision ' + record.revision;
      expiryText.hidden = !record.expiresAt; expiryText.textContent = record.expiresAt ? 'Udløb: ' + displayDate(record.expiresAt) : '';
      confirmButton.hidden = record.status !== 'proposed';
      historyNotice();
    }
    function controls() {
      const isDirty = dirty(), busy = busyIds.has(item.id), readOnly = view.base.archived || view.latest?.archived;
      const blocked = busy || view.uncertain || changed() || readOnly;
      const historyFull = view.base.historyCount >= 100;
      if (isDirty) dirtyIds.add(item.id); else dirtyIds.delete(item.id);
      card.setAttribute('aria-busy', String(busy));
      saveButton.disabled = !isDirty || blocked || historyFull; cancel.disabled = !isDirty || busy || view.uncertain;
      confirmButton.disabled = blocked || isDirty || historyFull || Boolean(view.base.expiresAt && Date.parse(view.base.expiresAt) <= Date.now());
      archive.disabled = blocked || isDirty;
      details.hidden = Boolean(view.base.archived && !isDirty);
      footer.hidden = Boolean(readOnly);
      for (const control of [input, category, expires, fold]) control.disabled = Boolean(view.base.archived);
      reload.hidden = !changed(); reload.disabled = busy || view.uncertain;
      review.hidden = !view.uncertain; review.disabled = busy;
      editStatus.textContent = [
        view.uncertain ? 'Gemningens udfald er ikke afklaret. Kontrollér noten før et nyt forsøg; ingen automatisk gentagelse.' : '',
        changed() ? 'Ændret et andet sted. Kladden bruger revision ' + view.base.revision +
          (view.missing ? '; noten er arkiveret eller utilgængelig.' : '; gennemgå den nyeste revision.') : '',
        view.message,
        readOnly ? 'Noten er arkiveret. Den kan kun læses; visningen hverken genaktiverer eller ændrer den.' : '',
        historyFull ? '100 historiske revisioner er bevaret. Opret en ny note eller arkivér denne; ingen historik slettes automatisk.' : '',
        isDirty ? 'Ugemt rettelse er bevaret i denne fane.' : '',
        !editStorageAvailable && isDirty ? 'Browseren kan ikke gendanne kladden efter lukning; behold fanen åben.' : '',
      ].filter(Boolean).join(' ');
      editStatus.classList.toggle('v5-error', Boolean(view.failed || changed() || view.uncertain));
    }
    function put(value) {
      input.value = value.text; category.value = value.category; expires.value = value.expires;
      fold.value = ['reject', 'earlier', 'later'].includes(value.fold) ? value.fold : 'reject';
    }
    function apply(record, preserveFields = false) {
      view.base = currentSummary(record); view.latest = currentSummary(record); view.missing = false;
      if (!preserveFields) put(baseFields());
      renderSummary(); controls();
    }
    view.observe = record => {
      view.latest = record ? currentSummary(record) : null; view.missing = !record;
      if (record && !view.keep() && record.revision !== view.base.revision) apply(record);
      else { renderSummary(); controls(); }
    };
    view.controls = controls;
    card.memoryView = view;
    put(saved?.fields || baseFields()); details.open = saved?.open === true || dirty(); historyDetails.open = saved?.historyOpen === true;
    renderSummary(); controls();
    for (const type of ['input', 'change']) form.addEventListener(type, () => { saveEditDrafts(); controls(); });
    details.addEventListener('toggle', saveEditDrafts);
    historyDetails.addEventListener('toggle', saveEditDrafts);
    cancel.addEventListener('click', () => {
      if (cancel.disabled) return;
      put(baseFields()); view.message = 'Den lokale rettelse er kasseret. Ingen serverændring.'; view.failed = false;
      saveEditDrafts(); controls();
    });
    reload.addEventListener('click', async () => {
      if (reload.disabled) return;
      const currentOwner = owner, session = authEpoch;
      try {
        await refreshMemories();
        if (session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
        if (!window.confirm('Kassér denne lokale notekladde og brug den nyeste gemte revision?')) return;
        if (view.missing) { card.remove(); cards.delete(item.id); dirtyIds.delete(item.id); restored.delete(item.id); updateCount(); }
        else { apply(view.latest); view.message = 'Nyeste gemte revision er indlæst.'; view.failed = false; controls(); }
        saveEditDrafts();
      } catch (error) { view.message = error.message; view.failed = true; controls(); }
    });
    review.addEventListener('click', async () => {
      if (review.disabled) return;
      const currentOwner = owner, session = authEpoch;
      try {
        await refreshMemories();
        if (session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
        if (!window.confirm('Har du gennemgået notens seneste indhold og revision og afklaret gemningsudfaldet? Dette gentager ingen handling; en gammel kladderevision kræver stadig særskilt genindlæsning.')) return;
        view.uncertain = false; view.message = 'Gemningsudfaldet er markeret som gennemgået. Ingen handling er gentaget.'; view.failed = false;
        saveEditDrafts(); controls();
      } catch (error) { view.message = error.message; view.failed = true; controls(); }
    });
    async function mutate(operation, success) {
      if (busyIds.has(item.id) || view.uncertain || changed() || view.base.archived || view.latest?.archived || !owner || owner !== localStorage.getItem('jarvisAccessToken')) return;
      const currentOwner = owner, session = authEpoch, submitted = JSON.stringify(fields());
      generation++; busyIds.add(item.id); view.uncertain = true; view.message = 'Gemmer …'; view.failed = false;
      saveEditDrafts(); controls();
      try {
        const result = await operation();
        if (session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
        if (!result.memory?.id || !Number.isInteger(result.memory.revision)) throw new Error('Serveren returnerede ikke et identificerbart gemt hukommelsespunkt.');
        view.uncertain = false;
        const newerDraft = JSON.stringify(fields()) !== submitted;
        if (result.memory.archived && !newerDraft && !showArchived.checked && pinnedMemoryId !== item.id) {
          const wasFocused = card.contains(document.activeElement);
          card.remove(); cards.delete(item.id); dirtyIds.delete(item.id); restored.delete(item.id);
          if (wasFocused) { feedback.tabIndex = -1; feedback.focus(); }
        } else {
          const hidConfirmation = document.activeElement === confirmButton && result.memory.status !== 'proposed';
          apply(result.memory, newerDraft);
          view.message = success + (newerDraft ? ' Ny tekst indtastet under gemningen er stadig en ugemt kladde.' : ''); view.failed = false;
          if (hidConfirmation) { card.tabIndex = -1; card.focus(); }
        }
        updateCount(); notify(success, true);
      } catch (error) {
        if (session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
        view.uncertain = unknownOutcome(error);
        view.message = 'Gemning er ikke bekræftet: ' + error.message + '. Kladden er bevaret.'; view.failed = true; notify(view.message);
        try { await refreshMemories(); } catch { /* Preserve original failure and never repeat the mutation. */ }
      } finally {
        if (session === authEpoch && currentOwner === localStorage.getItem('jarvisAccessToken')) {
          busyIds.delete(item.id); saveEditDrafts(); controls();
        }
      }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saveButton.disabled || !form.reportValidity()) return;
      try {
        let expiresAt = view.base.expiresAt || null;
        if (expires.value !== localDateTime(view.base.expiresAt)) {
          if (typeof JarvisPlan !== 'object') throw new Error('Tidsvalideringen er ikke klar. Genindlæs før du ændrer udløbet.');
          expiresAt = JarvisPlan.toInstant(expires.value, fold.value);
        }
        const payload = { expectedRevision: view.base.revision, text: input.value.trim(), category: category.value, expiresAt };
        await mutate(() => request('/api/memories/' + encodeURIComponent(item.id), 'PUT', payload),
          view.base.status === 'proposed' ? 'Forslaget er rettet. Det afventer stadig din bekræftelse.' : 'Hukommelsespunktet er rettet.');
      } catch (error) { view.message = error.message; view.failed = true; controls(); }
    });
    confirmButton.addEventListener('click', async () => {
      if (confirmButton.disabled || confirmButton.hidden) return;
      const payload = { expectedRevision: view.base.revision };
      await mutate(() => request('/api/memories/' + encodeURIComponent(item.id) + '/confirm', 'POST', payload),
        'Hukommelsen er bekræftet og kan bruges af JARVIS.');
    });
    archive.addEventListener('click', async () => {
      if (archive.disabled) return;
      const payload = { expectedRevision: view.base.revision };
      await mutate(() => request('/api/memories/' + encodeURIComponent(item.id) + '/archive', 'POST', payload),
        'Punktet er fjernet fra aktiv hukommelse og søgning.');
    });
    return card;
  }

  function replaceCard(item) {
    const old = cards.get(item.id);
    if (old) { old.memoryView.observe(item); return old; }
    const next = renderCard(item, restored.get(item.id));
    restored.delete(item.id); cards.set(item.id, next); list.prepend(next); return next;
  }
  function refreshMemories({ userRequested = false, sourceId } = {}) {
    const current = localStorage.getItem('jarvisAccessToken');
    if (!current) return Promise.resolve();
    if (owner !== current) { clearNotes(); owner = current; }
    if (typeof sourceId === 'string' && /^memory:[a-zA-Z0-9_-]{1,100}$/.test(sourceId)) pinnedMemoryId = sourceId.slice(7);
    const includeArchived = showArchived.checked || Boolean(pinnedMemoryId);
    if (loading) return loadingArchived === includeArchived && loadingGeneration === generation ? loading
      : loading.catch(() => {}).then(() => refreshMemories({ userRequested }));
    const requestGeneration = generation, session = authEpoch, currentOwner = owner;
    refreshButton.disabled = true;
    const pending = (async () => {
      try {
        const data = await api('/api/memories' + (includeArchived ? '?includeArchived=yes' : ''));
        if (requestGeneration !== generation || session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
        if (!Array.isArray(data.memories)) throw new Error('Hukommelsen kunne ikke læses.');
        const available = data.memories.filter(item => item && (!item.archived || showArchived.checked || item.id === pinnedMemoryId) &&
          typeof item.id === 'string' && typeof item.text === 'string');
        const pinned = available.find(item => item.id === pinnedMemoryId);
        const records = [...(pinned ? [pinned] : []), ...available.filter(item => item !== pinned)].slice(0, 250);
        const ids = new Set(records.map(item => item.id));
        for (const item of records) replaceCard(item);
        for (const [id, card] of cards) if (!ids.has(id)) {
          if (card.memoryView.keep()) card.memoryView.observe(null);
          else { card.remove(); cards.delete(id); dirtyIds.delete(id); restored.delete(id); }
        }
        updateCount(); saveEditDrafts();
        if (userRequested) notify('Hukommelsen er opdateret. Lokale kladder og deres oprindelige revisioner er bevaret.');
        else if (!feedback.textContent) notify('Kun bekræftede, ikke-udløbne punkter bruges som aktiv hukommelse.');
      } catch (error) {
        if (session === authEpoch && currentOwner === localStorage.getItem('jarvisAccessToken')) notify('Oversigten kunne ikke hentes: ' + error.message + '. Kladden er bevaret.');
        throw error;
      } finally {
        if (loading === pending) loading = null;
        if (session === authEpoch) refreshButton.disabled = false;
      }
    })();
    loadingArchived = includeArchived; loadingGeneration = requestGeneration; loading = pending; return pending;
  }
  refreshButton.addEventListener('click', () => refreshMemories({ userRequested: true }).catch(() => {}));
  showArchived.addEventListener('change', () => {
    pinnedMemoryId = null; generation++;
    try { if (owner && showArchived.checked) sessionStorage.setItem(archiveKey, 'yes'); else sessionStorage.removeItem(archiveKey); } catch { /* The visible choice still works without browser storage. */ }
    return refreshMemories({ userRequested: true }).catch(() => {});
  });
  const newReview = button('Kontrollér ny notes gemningsudfald');
  createForm.append(newReview);
  function newControls() {
    createButton.disabled = busyIds.has('new') || newUncertain; newReview.hidden = !newUncertain; newReview.disabled = busyIds.has('new');
    createForm.setAttribute('aria-busy', String(busyIds.has('new')));
  }
  newReview.addEventListener('click', async () => {
    if (newReview.disabled || !newUncertain) return;
    const currentOwner = owner, session = authEpoch;
    try {
      await refreshMemories();
      if (session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
      if (!window.confirm('Har du gennemgået hukommelsen og afklaret, om noten allerede er gemt? Et nyt klik kan ellers oprette en dublet. Intet gentages automatisk.')) return;
      newUncertain = false; saveNoteDraft(); newControls();
      notify('Gemningsudfaldet er markeret som gennemgået. Kladden er bevaret; ingen note er oprettet eller bekræftet ved denne kontrol.');
    } catch (error) { notify('Gemningsudfaldet kunne ikke kontrolleres: ' + error.message); }
  });
  createForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!owner || owner !== localStorage.getItem('jarvisAccessToken') || busyIds.has('new') || newUncertain || !createForm.reportValidity()) return;
    const currentOwner = owner, session = authEpoch, submitted = JSON.stringify({ text: newText.value, category: newCategory.value });
    const payload = { text: newText.value.trim(), category: newCategory.value };
    generation++; busyIds.add('new'); newUncertain = true; saveNoteDraft(); newControls();
    try {
      const result = await request('/api/memories', 'POST', payload);
      if (session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
      if (!result.memory?.id || !Number.isInteger(result.memory.revision)) throw new Error('Serveren returnerede ikke et identificerbart gemt hukommelsespunkt.');
      newUncertain = false;
      if (JSON.stringify({ text: newText.value, category: newCategory.value }) === submitted) { newText.value = ''; newCategory.value = 'fact'; }
      saveNoteDraft(); replaceCard(result.memory); updateCount(); saveEditDrafts();
      notify('Dit hukommelsespunkt er gemt.' + (creationDirty() ? ' Ny tekst indtastet under gemningen er stadig en ugemt kladde.' : ''), true);
    } catch (error) {
      if (session !== authEpoch || currentOwner !== localStorage.getItem('jarvisAccessToken')) return;
      newUncertain = unknownOutcome(error);
      notify('Gemning er ikke bekræftet: ' + error.message + '. Kladden er bevaret.');
    } finally {
      if (session === authEpoch && currentOwner === localStorage.getItem('jarvisAccessToken')) {
        busyIds.delete('new'); saveNoteDraft(); newControls();
      }
    }
  });
  function clearNotes() {
    authEpoch++; generation++; owner = ''; loading = null;
    pinnedMemoryId = null; showArchived.checked = false;
    cards.clear(); dirtyIds.clear(); busyIds.clear(); restored.clear(); list.replaceChildren();
    newText.value = ''; newCategory.value = 'fact'; newUncertain = false; notify(''); updateCount(); newControls();
    editorMode.value = 'note'; createForm.classList.remove('hidden'); claimForm.classList.add('hidden');
    try { for (const key of [noteDraftKey, editDraftKey, modeKey, archiveKey]) sessionStorage.removeItem(key); } catch { /* DOM is cleared even when storage is unavailable. */ }
  }
  const knowledgeVisible = () => typeof JarvisShell === 'object' ? JarvisShell.visible(document.getElementById('settings-profile')) : !document.getElementById('tab-knowledge')?.classList.contains('hidden');
  document.addEventListener('jarvis:refreshed', () => { if (knowledgeVisible()) return refreshMemories().catch(() => {}); });
  document.addEventListener('jarvis:view-changed', event => { if (event.detail?.view === 'knowledge') return refreshMemories().catch(() => {}); });
  document.addEventListener('jarvis:memories-changed', event => {
    const pending = refreshMemories({ sourceId: event.detail?.sourceId }); event.detail?.waitUntil?.(pending); return pending.catch(() => {});
  });
  document.getElementById('logout')?.addEventListener('click', clearNotes);
  window.addEventListener('beforeunload', event => {
    if ((draftStorageAvailable && editStorageAvailable) || !hasDirty()) return;
    event.preventDefault(); event.returnValue = '';
  });
  for (const saved of restored.values()) {
    const card = renderCard(saved.base, saved); cards.set(saved.base.id, card); list.append(card); card.memoryView.observe(null);
  }
  restored.clear(); updateCount(); newControls();
  if (newUncertain) notify('Gemningsudfaldet for en ny note er uafklaret. Gennemgå hukommelsen før et nyt forsøg; intet er sendt automatisk.');
  if (!document.getElementById('workspace')?.classList.contains('hidden') && knowledgeVisible()) refreshMemories().catch(() => {});
})();
