// Local planning always uses the declared Danish time zone, including when the
// browser is travelling. These pure helpers are also exercised without a DOM.
const JarvisPlan = (() => {
  const timeZone = 'Europe/Copenhagen';
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = instant => Object.fromEntries(formatter.formatToParts(new Date(instant))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const civilTime = (fields, millis = 0) => {
    const date = new Date(0);
    date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
    date.setUTCHours(fields.hour, fields.minute, fields.second || 0, millis);
    return date.getTime();
  };
  const same = (left, right) => ['year', 'month', 'day', 'hour', 'minute', 'second']
    .every(key => left[key] === right[key]);
  function toInstant(value, repeatedTime = 'reject') {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
    if (!match || !['reject', 'earlier', 'later'].includes(repeatedTime)) throw new Error('Angiv en gyldig dato og tid i Europe/Copenhagen.');
    const [, year, month, day, hour, minute, second = '0', fraction = ''] = match;
    const fields = { year: Number(year), month: Number(month), day: Number(day),
      hour: Number(hour), minute: Number(minute), second: Number(second) };
    const millis = Number(fraction.padEnd(3, '0'));
    const civil = civilTime(fields, millis), check = new Date(civil);
    if (!Number.isFinite(civil) || fields.year < 1 || check.getUTCFullYear() !== fields.year ||
        check.getUTCMonth() + 1 !== fields.month || check.getUTCDate() !== fields.day ||
        check.getUTCHours() !== fields.hour || check.getUTCMinutes() !== fields.minute ||
        check.getUTCSeconds() !== fields.second) throw new Error('Datoen eller klokkeslættet findes ikke.');
    const offsets = new Set();
    for (let hours = -36; hours <= 36; hours += 12) {
      const sample = civil + hours * 3_600_000;
      offsets.add(civilTime(parts(sample), new Date(sample).getUTCMilliseconds()) - sample);
    }
    const candidates = [...offsets].map(offset => civil - offset).filter(instant => same(parts(instant), fields))
      .sort((left, right) => left - right);
    if (!candidates.length) throw new Error('Klokkeslættet findes ikke i Europe/Copenhagen på grund af skift til sommertid. Vælg en anden tid.');
    if (candidates.length > 1 && repeatedTime === 'reject')
      throw new Error('Klokkeslættet forekommer to gange ved skift til vintertid. Vælg første eller anden forekomst i tidszonefeltet.');
    return new Date(repeatedTime === 'later' ? candidates.at(-1) : candidates[0]).toISOString();
  }
  function fromInstant(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Det gemte tidspunkt er ugyldigt.');
    const p = parts(date), pad = number => String(number).padStart(2, '0');
    const seconds = p.second || date.getUTCMilliseconds() ? `:${pad(p.second)}` : '';
    const fraction = date.getUTCMilliseconds() ? `.${String(date.getUTCMilliseconds()).padStart(3, '0')}` : '';
    return `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}${seconds}${fraction}`;
  }

  // Updating a neighbouring record never detaches a focused node. A changed or
  // removed focused card keeps its old revision, visibly stale, until focus
  // leaves or the owner explicitly completes a revision-bound action.
  function syncCards(target, records, { render, emptyText, forceId = null }) {
    const doc = target.ownerDocument, old = new Map([...target.children]
      .filter(card => card.dataset.planKey).map(card => [card.dataset.planKey, card]));
    const wanted = new Set(records.map(record => record.id));
    const stale = (card, message) => {
      let notice = card.querySelector('[data-plan-stale]');
      if (!notice) { notice = doc.createElement('p'); notice.dataset.planStale = '';
        notice.className = 'v5-conflict'; notice.setAttribute('role', 'status'); card.append(notice); }
      notice.textContent = message;
    };
    for (const [id, card] of old) if (!wanted.has(id)) {
      if (card.contains(doc.activeElement) && forceId !== id) stale(card, 'Posten er ændret eller fjernet. Den gamle revision er bevaret, mens du har fokus her.');
      else { card.remove(); old.delete(id); }
    }
    for (const child of [...target.children]) if (!child.dataset.planKey) child.remove();
    let anchor = target.firstElementChild;
    for (const record of records) {
      let card = old.get(record.id);
      const signature = JSON.stringify(record);
      if (card && card.planSignature !== signature) {
        if (card.contains(doc.activeElement) && forceId !== record.id) {
          stale(card, 'Ændret et andet sted. Fokus og den viste revision er bevaret; genindlæs før en ny ændring.');
        } else {
          const replacement = render(record);
          if (card.classList.contains('source-target')) replacement.classList.add('source-target');
          target.insertBefore(replacement, card);
          if (anchor === card) anchor = replacement;
          card.remove(); card = replacement;
        }
      } else if (!card) { card = render(record); target.insertBefore(card, anchor); }
      if (!card.dataset.planKey) { card.dataset.planKey = record.id; card.planSignature = signature; }
      if (card !== anchor && !target.contains(doc.activeElement)) target.insertBefore(card, anchor);
      anchor = card.nextElementSibling;
    }
    if (!target.children.length) { const empty = doc.createElement('p'); empty.className = 'muted';
      empty.textContent = emptyText; target.append(empty); }
  }
  return Object.freeze({ timeZone, toInstant, fromInstant, syncCards });
})();

// The single structured-memory editor has its own revisioned draft. It is
// independent of tasks, meals, calendar and model requests.
const JarvisClaims = (() => {
  const draftKey = 'jarvis:v5:memory-claim-draft';
  const categories = { fact: 'Faktum', preference: 'Præference', temporary: 'Midlertidigt', planned: 'Planlagt', completed: 'Afsluttet' };
  const sources = { user: 'Oplyst af dig', assistant: 'Forslag fra JARVIS', legacy: 'Tidligere gemt' };
  const channels = { manual: 'brugerfladen', text: 'chat', discord: 'Discord', voice: 'stemme', legacy: 'tidligere version' };
  const secret = /\bsk-[\w-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|-----BEGIN .*PRIVATE KEY-----|\b(?:password|adgangskode|api[_ -]?key|token|secret)\s*[:=]\s*\S{6,}|\bAuthorization\s*:\s*Bearer\s+\S+|\b(?:cpr|personnummer)\s*:?\s*\d{6}[- ]?\d{4}/i;
  function attach({ document, api, storage, getOwner, confirm, onSource = () => {} }) {
    const byId = id => document.getElementById(id), form = byId('personal-claim-form');
    const list = byId('claim-list'), status = byId('claim-status'), submit = form.querySelector('[type="submit"]');
    const element = (tag, text = '', css = '') => { const node = document.createElement(tag); node.textContent = text; node.className = css; return node; };
    const inputField = (parent, id, title, type = 'text') => {
      const input = document.createElement(type === 'select' ? 'select' : 'input'); input.id = id;
      if (type !== 'select') input.type = type;
      if (type === 'datetime-local') input.step = '0.001';
      const label = element('label', title); label.htmlFor = id; parent.append(label, input); return input;
    };
    const option = (select, value, text) => { const node = element('option', text); node.value = value; select.append(node); };
    const button = (text, handler) => { const control = element('button', text, 'secondary'); control.type = 'button';
      control.addEventListener('click', async () => { if (control.disabled) return; try { await handler(); } catch (error) { report(error.message, true); } }); return control; };
    const report = (message, error = false) => { status.textContent = message; status.classList.toggle('v5-error', error); };
    const timeText = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('da-DK', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(value)) : 'Ikke angivet';
    const details = element('details'); details.style.gridColumn = '1 / -1'; details.style.minWidth = '0';
    details.append(element('summary', 'Kilde, gyldighed og rettelser'));
    const extra = element('div', '', 'v5-fields'); details.append(extra); form.insertBefore(details, submit);
    const sourceId = inputField(extra, 'claim-source-id', 'Kildereference (valgfri, fx en note eller et kilde-ID)'); sourceId.maxLength = 120;
    const validFrom = inputField(extra, 'claim-valid-from', 'Gyldig fra (Europe/Copenhagen)', 'datetime-local');
    const expiresAt = inputField(extra, 'claim-expires-at', 'Gyldig til (Europe/Copenhagen)', 'datetime-local');
    const fold = inputField(extra, 'claim-repeated-time', 'Ved to ens klokkeslæt under skift til vintertid', 'select');
    option(fold, 'reject', 'Spørg mig — ingen automatisk antagelse'); option(fold, 'earlier', 'Første forekomst (sommertid)'); option(fold, 'later', 'Anden forekomst (vintertid)');
    const privacy = element('p', 'Kilden hentes ikke automatisk. Indhold og gyldighed gemmes som forslag; en rettelse af et bekræftet punkt ændrer først originalen, når du vælger og bekræfter erstatningen.', 'muted micro');
    privacy.style.gridColumn = '1 / -1'; extra.append(privacy);
    const draftStatus = element('p', '', 'muted small-text'); draftStatus.id = 'claim-draft-status';
    draftStatus.style.gridColumn = '1 / -1'; draftStatus.setAttribute('role', 'status'); draftStatus.setAttribute('aria-live', 'polite');
    let owner = getOwner(), records = [], edit = null, dirty = false, busy = false, pending = null;
    const sensitive = text => secret.test(text) || Boolean(getOwner()?.length >= 6 && text.includes(getOwner()));
    let sequence = 0, epoch = 0, readableAfterFailure = false, storageReady = true, pinId = null;
    const reviews = new Map();
    const values = () => ({ subject: byId('claim-subject').value, value: byId('claim-value').value,
      category: byId('claim-category').value || 'fact', sourceId: sourceId.value,
      validFrom: { value: validFrom.value, originalLocal: validFrom.dataset.originalLocal || '', originalInstant: validFrom.dataset.originalInstant || '' },
      expiresAt: { value: expiresAt.value, originalLocal: expiresAt.dataset.originalLocal || '', originalInstant: expiresAt.dataset.originalInstant || '' },
      repeatedTime: fold.value });
    const snapshot = () => JSON.stringify({ fields: values(), edit });
    const setTime = (field, value) => { field.value = JarvisPlan.fromInstant(value); field.dataset.originalLocal = field.value; field.dataset.originalInstant = value || ''; };
    const instant = field => field.value && field.value === field.dataset.originalLocal && field.dataset.originalInstant
      ? field.dataset.originalInstant : JarvisPlan.toInstant(field.value, fold.value);
    const storedEdit = value => value && ['edit', 'correct'].includes(value.mode) &&
      typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) && Number.isInteger(value.revision) && value.revision > 0
      ? { id: value.id, revision: value.revision, mode: value.mode, subject: String(value.subject || '').slice(0, 100) } : null;
    function persist() {
      const data = { version: 2, fields: values(), edit, dirty, pending,
        reviews: [...reviews.entries()].slice(0, 200), showHistory: showHistory.checked };
      try {
        if (!getOwner()) { storage.removeItem(draftKey); return; }
        if (sensitive(JSON.stringify(data))) { storage.removeItem(draftKey); storageReady = false; return; }
        if (dirty || edit || pending || reviews.size) storage.setItem(draftKey, JSON.stringify(data));
        else storage.removeItem(draftKey);
        storageReady = true;
      } catch { storageReady = false; }
    }
    function conflict() {
      if (!edit) return '';
      const current = records.find(item => item.id === edit.id);
      if (!current) return 'Grundlaget er ikke tilgængeligt. Hent den nyeste oversigt; kladden er bevaret.';
      if (current.revision !== edit.revision || current.status !== (edit.mode === 'edit' ? 'proposed' : 'confirmed'))
        return `Ændret et andet sted. Kladden bruger revision ${edit.revision}; gennemgå den nyeste revision før gemning.`;
      return '';
    }
    function controls() {
      const problem = conflict();
      form.setAttribute('aria-busy', String(busy));
      submit.disabled = busy || Boolean(pending) || Boolean(problem);
      submit.textContent = edit?.mode === 'edit' ? 'Gem ændringer i forslag' : edit?.mode === 'correct' ? 'Opret rettelsesforslag' : 'Opret forslag';
      byId('claim-subject').readOnly = Boolean(edit);
      cancel.hidden = !(dirty || edit); cancel.disabled = busy || Boolean(pending);
      reload.hidden = !edit; reload.disabled = busy || Boolean(pending);
      inspect.hidden = !pending; inspect.disabled = busy;
      resolve.hidden = !pending; resolve.disabled = busy || !readableAfterFailure;
      const base = edit ? `${edit.mode === 'correct' ? 'Retter bekræftet oplysning' : 'Redigerer forslag'} · basisrevision ${edit.revision}. ` : '';
      draftStatus.textContent = pending ? 'Gemningens udfald er ikke afklaret. Ingen automatisk gentagelse. Hent status og gennemgå oplysningerne før du fortsætter.'
        : `${base}${problem || (dirty ? 'Ugemt kladde er bevaret i denne fane.' : '')}${!storageReady ? ' Browseren kan ikke gendanne denne kladde efter lukning; behold fanen åben.' : ''}`;
      draftStatus.classList.toggle('v5-conflict', Boolean(problem || pending));
    }
    function resetEditor() {
      epoch++; edit = null; dirty = false; form.reset();
      for (const field of [validFrom, expiresAt]) { delete field.dataset.originalLocal; delete field.dataset.originalInstant; }
      fold.value = 'reject'; controls();
    }
    function showEditor() {
      const mode = byId('memory-editor-mode');
      if (mode) { mode.value = 'claim'; form.classList.remove('hidden'); byId('memory-workbench-form')?.classList.add('hidden');
        try { storage.setItem('jarvis:v5:memory-mode', 'claim'); } catch { storageReady = false; } }
      details.open = true;
    }
    function editRecord(record, discard = false) {
      if (busy || pending) throw new Error('Afklar den igangværende gemning først; kladden er bevaret.');
      if (!['proposed', 'confirmed'].includes(record.status)) throw new Error('Historiske eller ugyldige oplysninger kan ikke ændres. Opret et nyt forslag.');
      if ((dirty || edit) && !discard && !confirm('Kassér den nuværende ugemte kladde og åbn denne oplysning?')) return;
      epoch++; edit = { id: record.id, revision: record.revision, subject: record.subject, mode: record.status === 'proposed' ? 'edit' : 'correct' };
      byId('claim-subject').value = record.subject; byId('claim-value').value = record.value;
      byId('claim-category').value = record.category; sourceId.value = record.source?.id || '';
      setTime(validFrom, record.validFrom); setTime(expiresAt, record.expiresAt); fold.value = 'reject'; dirty = false;
      showEditor(); persist(); controls(); byId('claim-value').focus();
      report(record.status === 'confirmed' ? 'Originalen er stadig bekræftet. Gem en rettelse som et nyt forslag, og gennemgå derefter det udtrykkelige erstatningsvalg.' : 'Forslaget er åbnet med sin præcise revision. Ændringer bekræfter det ikke.');
    }
    const cancel = button('Kassér oplysningskladde', () => {
      if ((dirty || edit) && !confirm('Kassér den ugemte oplysningskladde?')) return;
      resetEditor(); persist(); byId('claim-subject').focus();
    });
    const reload = button('Hent nyeste oplysning og kassér kladde', async () => {
      if (!edit || !confirm('Kassér kladden og åbn den nyeste gemte revision?')) return;
      const id = edit.id; await refresh(); const current = records.find(item => item.id === id);
      if (!current) throw new Error('Oplysningen findes ikke længere. Kladden er bevaret.');
      editRecord(current, true);
    });
    const inspect = button('Hent status efter usikkert udfald', async () => {
      await refresh(); readableAfterFailure = true; controls();
      report('Oversigten er hentet. Sammenlign indhold, kilde, gyldighed og revision med kladden. Læsningen alene afgør ikke, om dit tidligere klik blev gemt.');
    });
    const resolve = button('Bekræft gennemgået gemningsudfald', () => {
      if (!pending || !readableAfterFailure || !confirm('Har du gennemgået den aktuelle oversigt og afklaret det tidligere gemningsudfald? Dette gentager ingen handling og bekræfter ingen personlig oplysning. En gammel basisrevision kræver stadig særskilt genindlæsning.')) return;
      pending = null; readableAfterFailure = false; persist(); controls();
      report('Du har markeret udfaldet som gennemgået. Kladden er bevaret; ingen handling er gentaget eller oplysning bekræftet.');
    });
    form.append(cancel, reload, inspect, resolve, draftStatus);
    const historyBox = element('div', '', 'v5-fields');
    const showHistory = inputField(historyBox, 'claim-show-history', 'Vis arkiverede, erstattede og ugyldige oplysninger', 'checkbox');
    showHistory.style.width = 'auto'; list.parentNode.insertBefore(historyBox, list);
    showHistory.addEventListener('change', () => { render(); persist(); });
    function statusText(record) {
      if (record.status !== 'confirmed') return ({ proposed: 'Forslag — ikke bekræftet', invalid: 'Ugyldig — bruges ikke',
        archived: 'Arkiveret — bruges ikke', superseded: 'Erstattet — kun historik' })[record.status] || 'Ukendt status — gennemgå';
      if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return 'Udløbet — bruges ikke som aktuelt faktum';
      if (record.validFrom && Date.parse(record.validFrom) > Date.now()) return 'Bekræftet til fremtiden — endnu ikke gældende';
      return 'Bekræftet af dig';
    }
    const label = (parent, title, value) => { const row = element('p', '', 'v5-record-detail'); row.append(element('strong', `${title}: `), element('span', value)); parent.append(row); };
    function render(forceId = null) {
      const moveFocus = forceId && [...list.children].some(card => card.dataset.claimId === forceId && card.contains(document.activeElement));
      const active = records.filter(record => record.status === 'confirmed' && (!record.validFrom || Date.parse(record.validFrom) <= Date.now()) && (!record.expiresAt || Date.parse(record.expiresAt) > Date.now()));
      const normalized = value => String(value).normalize('NFKC').toLocaleLowerCase('da-DK').trim();
      const conflicting = new Set(active.filter(item => active.some(other => other.id !== item.id && other.subject === item.subject && normalized(other.value) !== normalized(item.value))).map(item => item.subject));
      const shown = records.filter(record => showHistory.checked || record.id === pinId || !['invalid', 'archived', 'superseded'].includes(record.status));
      const bounded = shown.slice(-250).reverse().map(record => ({ ...record, conflict: conflicting.has(record.subject),
        alternatives: record.status === 'proposed' ? records.filter(other => other.status === 'confirmed' && other.subject === record.subject && other.id !== record.id)
          .map(other => ({ id: other.id, revision: other.revision, value: other.value })) : [] }));
      if (pinId && !bounded.some(record => record.id === pinId)) { const pinned = records.find(record => record.id === pinId); if (pinned) bounded.unshift({ ...pinned, alternatives: [] }); }
      JarvisPlan.syncCards(list, bounded, { forceId, emptyText: 'Ingen oplysninger i denne visning.', render: record => {
        const card = element('article', '', 'v5-record-card'); card.dataset.claimId = record.id;
        card.append(element('h3', record.subject)); label(card, 'Indhold', record.value);
        label(card, 'Type', categories[record.category] || 'Ukendt'); label(card, 'Status', statusText(record));
        label(card, 'Kilde', `${sources[record.source?.kind] || 'Ukendt kilde'} · ${channels[record.source?.channel] || 'ukendt kanal'}${record.source?.id ? ` · ${record.source.id}` : ''}`);
        label(card, 'Revision', String(record.revision)); label(card, 'Gyldig fra', timeText(record.validFrom)); label(card, 'Gyldig til', timeText(record.expiresAt));
        if (record.correctsId) label(card, 'Rettelsesforslag til', `${record.correctsId} · revision ${record.correctsRevision}`);
        if (record.supersedesId) label(card, 'Erstatter', record.supersedesId);
        if (record.conflict) card.append(element('p', 'Modstridende bekræftede oplysninger om samme emne. De bruges ikke som et entydigt faktum. Gennemgå de viste kilder; ret, ugyldiggør eller arkivér udtrykkeligt.', 'v5-conflict'));
        const actions = element('div', '', 'v5-record-actions');
        if (/^(?:claim|memory|organizer|recipe|household(?:-day|-rhythm)?|personal-task|follow-up):[\w:-]{1,150}$/.test(record.source?.id || ''))
          actions.append(button('Åbn oprindelig kilde', () => onSource(record.source.id)));
        if (['proposed', 'confirmed'].includes(record.status)) actions.append(button(record.status === 'proposed' ? 'Redigér forslag' : 'Ret oplysning', () => editRecord(record)));
        if (record.status === 'proposed') {
          const review = element('div', '', 'v5-fields');
          const select = inputField(review, `claim-replaces-${record.id}`, 'Ved bekræftelse: hvilken tidligere oplysning erstattes?', 'select');
          option(select, '', 'Ingen erstatning — behold øvrige oplysninger');
          for (const old of record.alternatives.filter(old => !record.correctsId || old.id === record.correctsId))
            option(select, old.id, `${old.value} · revision ${old.revision}`);
          const reviewed = reviews.get(record.id);
          if (reviewed && !record.alternatives.some(old => old.id === reviewed.id)) option(select, reviewed.id, 'Tidligere valgt oplysning er ikke længere tilgængelig');
          if (reviewed) select.value = reviewed.id;
          const reviewStatus = element('p', '', 'muted micro'); reviewStatus.style.gridColumn = '1 / -1'; review.append(reviewStatus);
          let confirmButton;
          const updateReview = () => {
            const choice = reviews.get(record.id), current = choice && records.find(item => item.id === choice.id);
            const stale = Boolean(choice && (current?.revision !== choice.revision || current?.status !== 'confirmed'));
            const wrongCorrection = Boolean(record.correctsId && (!choice || choice.id !== record.correctsId || choice.revision !== record.correctsRevision));
            reviewStatus.textContent = choice ? current?.revision === choice.revision && current.status === 'confirmed'
              ? `Du har valgt at erstatte revision ${choice.revision}. Originalen bevares indtil dit bekræftelsesklik.`
              : 'Den valgte original er ændret. Vælg og gennemgå den nyeste revision igen før bekræftelse.'
              : 'Ingen original ændres uden et udtrykkeligt erstatningsvalg. Flere forskellige bekræftede værdier vises som en konflikt.';
            if (record.correctsId && wrongCorrection) reviewStatus.textContent = 'Dette rettelsesforslag kræver dit udtrykkelige valg af den oprindeligt gennemgåede oplysning og revision. Hvis originalen er ændret, skal du oprette en ny rettelse fra den nyeste original.';
            if (confirmButton) { confirmButton.dataset.claimBlocked = stale || wrongCorrection ? 'true' : 'false';
              confirmButton.disabled = busy || Boolean(pending) || stale || wrongCorrection; }
          };
          select.addEventListener('change', () => { const old = record.alternatives.find(item => item.id === select.value);
            if (old) reviews.set(record.id, { id: old.id, revision: old.revision }); else reviews.delete(record.id);
            updateReview(); persist(); });
          confirmButton = button('Bekræft oplysning', () => decide(record, 'confirm'));
          updateReview(); card.append(review); actions.append(confirmButton);
        }
        if (record.status === 'confirmed') actions.append(button('Markér ugyldig', () => {
          if (confirm('Markér denne oplysning som ugyldig? Den bevares i historikken, men bruges ikke som et aktuelt faktum.')) return decide(record, 'invalidate');
        }));
        if (record.status !== 'archived') actions.append(button('Arkivér', () => decide(record, 'archive')));
        card.append(actions); return card;
      } });
      for (const control of list.querySelectorAll('button')) control.disabled = busy || Boolean(pending) || control.dataset.claimBlocked === 'true';
      if (moveFocus) { const target = [...list.children].find(card => card.dataset.claimId === forceId) || status;
        target.tabIndex = -1; target.focus(); }
    }
    async function refresh(forceId = null) {
      const currentOwner = getOwner(); if (!currentOwner) return;
      if (owner !== currentOwner) { clear(); owner = currentOwner; }
      const request = ++sequence, result = await api('/api/personal-claims');
      if (request !== sequence || currentOwner !== getOwner()) return;
      if (!Array.isArray(result.claims)) throw new Error('Oplysningerne kunne ikke læses.');
      records = result.claims; render(forceId); controls();
    }
    async function mutate(path, method, payload, operation, after) {
      if (busy || pending || !getOwner()) return;
      const currentOwner = getOwner(); busy = true; pending = operation; readableAfterFailure = false;
      persist(); controls(); render(); let saved = false;
      try {
        const result = await api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (currentOwner !== getOwner()) return;
        if (!result.claim?.id || !Number.isInteger(result.claim.revision)) throw new Error('Serveren returnerede ikke en identificerbar gemt oplysning.');
        saved = true; pending = null; await after(result.claim); persist();
        report(operation.kind === 'confirm' ? 'Oplysningen er bekræftet efter din gennemgang.'
          : operation.kind === 'invalidate' ? 'Oplysningen er ugyldig og udelukket fra aktuelle fakta.'
            : operation.kind === 'archive' ? 'Oplysningen er arkiveret; historikken er bevaret.'
              : 'Forslaget er gemt, men ikke bekræftet. Gennemgå kilden og et eventuelt erstatningsvalg.');
        await refresh(result.claim.id);
      } catch (error) {
        if (currentOwner !== getOwner()) return;
        if (!saved && error.status >= 400 && error.status < 500 && !/ukendt|kan være gemt|kan være udført|lagerets seneste udfald/i.test(error.message || '')) pending = null;
        report(saved ? `Ændringen er gemt, men oversigten kunne ikke opdateres: ${error.message}`
          : `Gemning er ikke bekræftet: ${error.message}. Kladden og den oprindelige revision er bevaret.`, true);
        if (!saved) { try { await refresh(); } catch { /* no blind retry, preserve the original error */ } }
      } finally {
        if (currentOwner === getOwner()) { busy = false; persist(); controls(); render(); }
      }
    }
    async function decide(record, action) {
      if (busy || pending) return;
      const current = records.find(item => item.id === record.id);
      if (!current || current.revision !== record.revision) throw new Error('Oplysningen er ændret. Gennemgå den nyeste revision før beslutningen.');
      const payload = { expectedRevision: record.revision }, replacement = action === 'confirm' && reviews.get(record.id);
      if (action === 'confirm' && record.correctsId && (!replacement || replacement.id !== record.correctsId || replacement.revision !== record.correctsRevision))
        throw new Error('Vælg udtrykkeligt den oprindeligt gennemgåede oplysning og revision før rettelsen bekræftes.');
      if (replacement) {
        const original = records.find(item => item.id === replacement.id);
        if (original?.status !== 'confirmed' || original.revision !== replacement.revision) throw new Error('Den valgte original er ændret. Vælg og gennemgå den nyeste revision igen.');
        payload.supersedesId = replacement.id; payload.supersedesRevision = replacement.revision;
      }
      await mutate(`/api/personal-claims/${encodeURIComponent(record.id)}/${action}`, 'POST', payload,
        { kind: action, id: record.id, revision: record.revision }, () => { reviews.delete(record.id); });
    }
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || pending || conflict()) return;
      try {
        const from = instant(validFrom), until = instant(expiresAt);
        if (from && until && from >= until) throw new Error('Gyldig til skal være efter gyldig fra.');
        const fields = values(), captured = snapshot(), capturedEpoch = epoch;
        const payload = { value: fields.value, category: fields.category, sourceId: fields.sourceId.trim(), validFrom: from, expiresAt: until };
        const editing = edit?.mode === 'edit';
        if (editing) payload.expectedRevision = edit.revision;
        else { payload.subject = fields.subject; if (edit) { payload.correctsId = edit.id; payload.correctsRevision = edit.revision; } }
        await mutate(editing ? `/api/personal-claims/${encodeURIComponent(edit.id)}` : '/api/personal-claims', editing ? 'PATCH' : 'POST', payload,
          { kind: editing ? 'update' : edit ? 'correct' : 'create', id: edit?.id || null, revision: edit?.revision || null }, record => {
            if (capturedEpoch === epoch && snapshot() === captured) resetEditor();
            else if (capturedEpoch === epoch) {
              // A new subject typed while creation was in flight is a separate
              // draft; never overwrite it with the submitted subject.
              edit = byId('claim-subject').value === record.subject && record.status === 'proposed'
                ? { id: record.id, revision: record.revision, subject: record.subject, mode: 'edit' } : null;
              dirty = true;
            }
          });
      } catch (error) { report(`${error.message} Kladden er bevaret.`, true); }
    });
    for (const type of ['input', 'change']) form.addEventListener(type, () => { dirty = true; persist(); controls(); });
    function clear() {
      sequence++; records = []; reviews.clear(); pending = null; busy = false; readableAfterFailure = false; pinId = null;
      owner = ''; resetEditor(); list.replaceChildren(); report('');
      try { storage.removeItem(draftKey); } catch { /* private fields are already cleared */ }
    }
    try {
      const raw = owner && storage.getItem(draftKey);
      if (raw && raw.length <= 100_000 && !sensitive(raw)) {
        const saved = JSON.parse(raw), fields = saved.version === 2 ? saved.fields : saved;
        if (fields && typeof fields.subject === 'string' && fields.subject.length <= 100 &&
            typeof fields.value === 'string' && fields.value.length <= 1200) {
          byId('claim-subject').value = fields.subject; byId('claim-value').value = fields.value;
          if (Object.hasOwn(categories, fields.category)) byId('claim-category').value = fields.category;
          sourceId.value = typeof fields.sourceId === 'string' ? fields.sourceId.slice(0, 120) : '';
          for (const [name, target] of [['validFrom', validFrom], ['expiresAt', expiresAt]]) {
            const data = fields[name]; if (data && typeof data.value === 'string' && data.value.length <= 40) {
              target.value = data.value; target.dataset.originalLocal = String(data.originalLocal || '').slice(0, 40);
              target.dataset.originalInstant = String(data.originalInstant || '').slice(0, 40);
            }
          }
          fold.value = ['reject', 'earlier', 'later'].includes(fields.repeatedTime) ? fields.repeatedTime : 'reject';
          edit = storedEdit(saved.edit); dirty = saved.dirty === true || Boolean(fields.subject || fields.value);
          if (saved.pending && ['create', 'update', 'correct', 'confirm', 'archive', 'invalidate'].includes(saved.pending.kind)) pending = saved.pending;
          for (const [id, review] of Array.isArray(saved.reviews) ? saved.reviews.slice(0, 200) : [])
            if (typeof id === 'string' && typeof review?.id === 'string' && Number.isInteger(review.revision)) reviews.set(id, { id: review.id, revision: review.revision });
          showHistory.checked = saved.showHistory === true; if (edit) details.open = true;
          report('Oplysningskladde gendannet i denne fane med sin oprindelige revision. Gennemgå før gemning.');
        }
      } else if (!owner || raw) storage.removeItem(draftKey);
    } catch { storageReady = false; }
    controls();
    return { refresh, clear, pin: id => { pinId = id; }, hasUnrecoverableDraft: () => !storageReady && (dirty || Boolean(edit) || Boolean(pending)) };
  }
  return Object.freeze({ attach });
})();

// Personlige opgaver, kapacitet, opfølgning og kildebaserede oplysninger.
// Formularer og deres basisrevisioner bevares under polling, navigation og reload.
if (typeof document !== 'undefined') (() => {
  const byId = id => document.getElementById(id);
  const node = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  };
  const dateText = value => value ? new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium',
    timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(value)) : 'Ikke angivet';
  let repeatedTime;
  const localInstant = field => {
    if (typeof field === 'string') field = byId(field);
    // An untouched saved value must keep its original seconds and DST offset.
    if (field.value && field.value === field.dataset.originalLocal && field.dataset.originalInstant)
      return field.dataset.originalInstant;
    return JarvisPlan.toInstant(field.value, repeatedTime.value);
  };
  const setInstant = (field, value) => {
    field.value = JarvisPlan.fromInstant(value);
    field.dataset.originalLocal = field.value;
    field.dataset.originalInstant = value || '';
  };
  const errorStatus = (id, message, failed = false) => {
    const target = byId(id);
    target.textContent = message;
    target.classList.toggle('v5-error', failed);
  };
  const label = (parent, text, value) => {
    const item = node('p', 'v5-record-detail');
    item.append(node('strong', '', `${text}: `), document.createTextNode(value));
    parent.append(item);
  };
  const button = (text, handler, destructive = false, statusId = 'personal-task-status') => {
    const control = node('button', destructive ? 'secondary' : 'primary', text);
    control.type = 'button';
    control.addEventListener('click', async () => {
      control.disabled = true;
      try { await handler(); }
      catch (error) { errorStatus(statusId, error.message, true); }
      finally { control.disabled = false; }
    });
    return control;
  };

  const post = (url, method, payload) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const claimsUi = JarvisClaims.attach({ document, api, storage: sessionStorage,
    getOwner: () => localStorage.getItem('jarvisAccessToken'), confirm: message => window.confirm(message),
    onSource: sourceId => { if (typeof selectTab === 'function') selectTab(typeof sourceKinds === 'object'
      ? sourceKinds[sourceId.split(':')[0]] || 'knowledge' : 'knowledge', { sourceId }); } });
  const taskForm = byId('personal-task-form'), followForm = byId('follow-up-form'), capacityForm = byId('capacity-form');
  const taskSubmit = taskForm.querySelector('[type="submit"]'), followSubmit = followForm.querySelector('[type="submit"]');
  const taskFields = {}, followFields = {}, capacityFields = {};
  const field = (parent, registry, name, title, type = 'text', attributes = {}) => {
    const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
    input.id = name; if (input.tagName === 'INPUT') input.type = type;
    if (type === 'datetime-local') input.step = '0.001';
    if (type === 'checkbox') { input.style.width = 'auto'; input.style.justifySelf = 'start'; }
    Object.assign(input, attributes);
    const caption = node('label', '', title); caption.htmlFor = input.id;
    parent.append(caption, input); registry[name] = input; return input;
  };
  const option = (select, value, title) => { const element = node('option', '', title); element.value = value; select.append(element); };
  const fullWidth = element => { element.style.gridColumn = '1 / -1'; element.style.minWidth = '0'; element.style.maxWidth = '100%'; return element; };
  const advanced = (form, title) => {
    const details = fullWidth(node('details')); details.append(node('summary', '', title));
    const fields = node('div', 'v5-fields'); details.append(fields);
    form.insertBefore(details, form.querySelector('[type="submit"]')); return { details, fields };
  };
  const zoneBox = node('div', 'v5-fields'); zoneBox.append(fullWidth(node('p', 'muted small-text',
    'Alle tidspunkter i Plan bruger Europe/Copenhagen, også når enheden er i en anden tidszone. Uændrede gemte tidspunkter bevarer deres oprindelige offset.')));
  repeatedTime = field(zoneBox, {}, 'plan-repeated-time', 'Når et klokkeslæt forekommer to gange ved skift til vintertid', 'select');
  option(repeatedTime, 'reject', 'Spørg mig — ingen automatisk antagelse');
  option(repeatedTime, 'earlier', 'Første forekomst (sommertid)'); option(repeatedTime, 'later', 'Anden forekomst (vintertid)');
  const zoneDetails = node('details', 'gui-disclosure');
  zoneDetails.append(node('summary', '', 'Avancerede tidsvalg'), zoneBox);
  byId('tab-plan').append(zoneDetails);

  let taskRecords = [], followRecords = [], taskEdit = null, followEdit = null, taskEpoch = 0, followEpoch = 0;
  let taskDirty = false, followDirty = false, capacityDirty = false, storageReady = true;
  let previousProposals = [], ownerToken = localStorage.getItem('jarvisAccessToken') || '';
  let capacityVersion = 0, simulationSequence = 0;
  let taskConflict = '', followConflict = '';
  const sequence = { tasks: 0, follow: 0, claims: 0 };
  const draftKey = 'jarvis:v5:plan-drafts';
  const taskDraftStatus = fullWidth(node('p', 'muted small-text'));
  const followDraftStatus = fullWidth(node('p', 'muted small-text'));
  for (const element of [taskDraftStatus, followDraftStatus]) { element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite'); }

  const taskAdvanced = advanced(taskForm, 'Tid, afhængigheder og låste valg');
  field(taskAdvanced.fields, taskFields, 'personal-task-outcome', 'Forventet resultat', 'textarea', { maxLength: 1000 });
  field(taskAdvanced.fields, taskFields, 'personal-task-uncertainty', 'Usikkerhed ud over varigheden (minutter)', 'number', { min: 0, max: 1440, value: '0' });
  field(taskAdvanced.fields, taskFields, 'personal-task-priority', 'Prioritet (0–5, 5 er højest)', 'number', { min: 0, max: 5, value: '2' });
  field(taskAdvanced.fields, taskFields, 'personal-task-earliest', 'Tidligste start', 'datetime-local');
  field(taskAdvanced.fields, taskFields, 'personal-task-planned', 'Mit valgte starttidspunkt (lokalt)', 'datetime-local');
  field(taskAdvanced.fields, taskFields, 'personal-task-locked', 'Lås det valgte starttidspunkt', 'checkbox');
  field(taskAdvanced.fields, taskFields, 'personal-task-next-check', 'Næste opfølgning på opgaven', 'datetime-local');
  field(taskAdvanced.fields, taskFields, 'personal-task-project', 'Projekt-ID (valgfrit)', 'text', { maxLength: 120 });
  const dependencyField = field(taskAdvanced.fields, taskFields, 'personal-task-dependencies', 'Opgaver der skal afsluttes først', 'select', { multiple: true, size: 4 });
  field(taskAdvanced.fields, taskFields, 'personal-task-state', 'Opgavestatus', 'select');
  for (const [value, title] of [['pending', 'Afventer'], ['in_progress', 'I gang'], ['blocked', 'Blokeret']])
    option(taskFields['personal-task-state'], value, title);

  let windowCounter = 0;
  const windowEditor = (parent, title, statusId, onChange) => {
    const box = fullWidth(node('fieldset')), legend = node('legend', '', title);
    legend.style.maxWidth = '100%'; legend.style.overflowWrap = 'anywhere'; box.append(legend);
    const rows = node('div'); box.append(rows);
    const add = raw => {
      if (rows.children.length >= 30) throw new Error('Højst 30 tidsvinduer i denne editor.');
      const row = node('div', 'v5-fields'), inputs = {}, prefix = `plan-window-${++windowCounter}`;
      const start = field(row, inputs, `${prefix}-start`, 'Fra', 'datetime-local');
      const end = field(row, inputs, `${prefix}-end`, 'Til', 'datetime-local');
      row.windowInputs = { start, end };
      if (raw?.start?.value !== undefined) restoreFields([start, end], { [start.id]: raw.start, [end.id]: raw.end });
      else if (raw) { setInstant(start, raw.start); setInstant(end, raw.end); }
      row.append(button('Fjern tidsvindue', () => { row.remove(); onChange(); }, true, statusId));
      rows.append(row);
    };
    box.append(button('Tilføj tidsvindue', () => { add(); onChange(); }, false, statusId));
    parent.append(box);
    return { set: values => { rows.replaceChildren(); for (const value of values || []) add(value); },
      raw: () => [...rows.children].map(row => ({ start: captureField(row.windowInputs.start), end: captureField(row.windowInputs.end) })),
      read: () => [...rows.children].map(row => {
        const start = localInstant(row.windowInputs.start), end = localInstant(row.windowInputs.end);
        if (!start || !end || end <= start) throw new Error(`${title}: begge tider skal udfyldes, og sluttid skal være efter starttid.`);
        return { start, end };
      }) };
  };
  // A blur/change event can fire between pointerdown and click on a submit
  // button. Replacing that button's text at that point cancels click in WebKit.
  // Update the edit controls only when dirty mode first becomes active.
  const markTaskDirty = () => { const changed = !taskDirty; taskDirty = true; if (changed) taskEditControls(); persistDrafts(); draftStatus(); };
  const markFollowDirty = () => { const changed = !followDirty; followDirty = true; if (changed) followEditControls(); persistDrafts(); draftStatus(); };
  const markCapacityDirty = event => {
    capacityDirty = true; capacityVersion++;
    if (!event || ![manualReview, capacityFields['capacity-buffer']].includes(event.target)) manualReview.checked = false;
    for (const control of byId('capacity-results').querySelectorAll('button')) control.disabled = true;
    if (previousProposals.length) errorStatus('capacity-status', 'Rammerne er ændret. Tidligere forslag er forældede; gennemgå kapaciteten og beregn igen før gemning.');
    persistDrafts();
  };
  const allowedWindows = windowEditor(taskAdvanced.fields, 'Tilladte tidsvinduer for opgaven (tom = ingen ekstra begrænsning)', 'personal-task-status', markTaskDirty);
  const taskCancel = button('Annullér redigering', () => {
    if (taskDirty && !window.confirm('Kassér den ugemte opgavekladde?')) return;
    resetTask(); persistDrafts(); byId('personal-task-title').focus();
  });
  const taskReload = button('Hent nyeste opgave og kassér kladde', async () => {
    if (!taskEdit || !window.confirm('Kassér kladden og åbn den nyeste gemte revision?')) return;
    await refreshPersonalTasks(); const record = taskRecords.find(item => item.id === taskEdit.id);
    if (!record || ['completed', 'archived'].includes(record.status)) throw new Error('Opgaven kan ikke længere redigeres. Kladden er stadig bevaret.');
    editTask(record, true);
  }, true);
  taskCancel.hidden = true; taskReload.hidden = true;
  taskForm.append(taskCancel, taskReload, taskDraftStatus);

  const followAdvanced = advanced(followForm, 'Registrér en observation eller udsæt næste tjek');
  const observationStatus = field(followAdvanced.fields, followFields, 'follow-observation-status', 'Observation', 'select');
  for (const [value, title] of [['', 'Ingen observation — flyt kun næste tjek'], ['changed', 'Ændret'], ['unchanged', 'Uændret'], ['unknown', 'Ukendt / kilden kunne ikke læses']]) option(observationStatus, value, title);
  field(followAdvanced.fields, followFields, 'follow-observation-subject', 'Observeret emne', 'text', { maxLength: 240 });
  field(followAdvanced.fields, followFields, 'follow-observation-source', 'Kilde til observationen', 'text', { maxLength: 1000 });
  field(followAdvanced.fields, followFields, 'follow-observation-value', 'Observationens værdi (valgfri)', 'text', { maxLength: 240 });
  followAdvanced.fields.append(fullWidth(node('p', 'muted small-text', 'En fejlet læsning er ukendt — aldrig uændret. Observationer opretter ingen job eller beskeder til andre.')));
  const followCancel = button('Annullér redigering', () => {
    if (followDirty && !window.confirm('Kassér den ugemte opfølgningskladde?')) return;
    resetFollow(); persistDrafts(); byId('follow-up-awaiting').focus();
  }, false, 'follow-up-status');
  const followReload = button('Hent nyeste sag og kassér kladde', async () => {
    if (!followEdit || !window.confirm('Kassér kladden og åbn den nyeste gemte revision?')) return;
    await refreshFollowUps(); const record = followRecords.find(item => item.id === followEdit.id && item.status === 'open');
    if (!record) throw new Error('Sagen er lukket eller utilgængelig. Kladden er stadig bevaret.');
    editFollow(record, true);
  }, true, 'follow-up-status');
  followForm.append(followCancel, followReload, followDraftStatus);

  const capacityAdvanced = advanced(capacityForm, 'Flere tidsrum, kendte aftaler og buffer');
  field(capacityAdvanced.fields, capacityFields, 'capacity-buffer', 'Buffer mellem opgaver og aftaler (minutter)', 'number', { min: 0, max: 180, value: '0' });
  const extraWindows = windowEditor(capacityAdvanced.fields, 'Yderligere mulige arbejdstidsrum', 'capacity-status', markCapacityDirty);
  const busyWindows = windowEditor(capacityAdvanced.fields, 'Aftaler og optaget tid, jeg har gennemgået manuelt', 'capacity-status', markCapacityDirty);
  const manualReview = field(capacityAdvanced.fields, capacityFields, 'capacity-manual-review', 'Jeg har selv gennemgået alle tidsrum og indtastet den kendte optagede tid ovenfor', 'checkbox');
  capacityAdvanced.fields.append(fullWidth(node('p', 'muted small-text', 'Vælg enten læsning af Google Kalender eller din egen manuelle gennemgang. Uden et af disse grundlag er kapaciteten ukendt.')));
  byId('capacity-reviewed').addEventListener('change', () => { if (byId('capacity-reviewed').checked) manualReview.checked = false; });
  manualReview.addEventListener('change', () => { if (manualReview.checked) byId('capacity-reviewed').checked = false; });

  const taskInputs = () => [byId('personal-task-title'), byId('personal-task-purpose'), byId('personal-task-duration'), byId('personal-task-deadline'), ...Object.values(taskFields)];
  const followInputs = () => [byId('follow-up-awaiting'), byId('follow-up-check'), byId('follow-up-stop'), ...Object.values(followFields)];
  const capacityInputs = () => [byId('capacity-start'), byId('capacity-end'), byId('capacity-reviewed'), ...Object.values(capacityFields), repeatedTime];
  function captureField(input) {
    return { value: input.multiple ? [...input.selectedOptions].map(item => item.value) : input.value,
      ...(input.type === 'checkbox' ? { checked: input.checked } : {}),
      ...(input.dataset.originalInstant ? { originalInstant: input.dataset.originalInstant, originalLocal: input.dataset.originalLocal } : {}) };
  }
  const captureFields = fields => Object.fromEntries(fields.map(input => [input.id, captureField(input)]));
  function restoreFields(fields, values) {
    for (const input of fields) {
      const saved = values?.[input.id]; if (!saved || typeof saved !== 'object') continue;
      if (input.multiple && Array.isArray(saved.value)) {
        const selected = saved.value.filter(value => typeof value === 'string' && value.length <= 100).slice(0, 30);
        for (const id of selected) if (![...input.options].some(item => item.value === id)) option(input, id, `Gemt afhængighed: ${id}`);
        for (const item of input.options) item.selected = selected.includes(item.value);
      } else if (typeof saved.value === 'string' && saved.value.length <= 4000) input.value = saved.value;
      if (input.type === 'checkbox') input.checked = saved.checked === true;
      if (typeof saved.originalInstant === 'string' && saved.originalInstant.length <= 40 &&
          typeof saved.originalLocal === 'string' && saved.originalLocal.length <= 30) {
        input.dataset.originalInstant = saved.originalInstant; input.dataset.originalLocal = saved.originalLocal;
      }
    }
  }
  function draftStatus() {
    taskDraftStatus.textContent = [taskEdit ? `Redigerer revision ${taskEdit.revision}.` : '', taskDirty ? 'Ugemt opgavekladde bevaret.' : '', taskConflict,
      (taskDirty || taskEdit) && !storageReady ? 'Browseren afviser kladdelagring; kopiér teksten før siden lukkes.' : ''].filter(Boolean).join(' ');
    followDraftStatus.textContent = [followEdit ? `Redigerer revision ${followEdit.revision}.` : '', followDirty ? 'Ugemt opfølgningskladde bevaret.' : '', followConflict,
      (followDirty || followEdit) && !storageReady ? 'Browseren afviser kladdelagring; kopiér teksten før siden lukkes.' : ''].filter(Boolean).join(' ');
    taskDraftStatus.classList.toggle('v5-conflict', Boolean(taskConflict)); followDraftStatus.classList.toggle('v5-conflict', Boolean(followConflict));
  }
  function persistDrafts() {
    if (!localStorage.getItem('jarvisAccessToken')) return;
    const saved = { version: 1,
      task: taskEdit || taskDirty ? { edit: taskEdit, dirty: taskDirty, fields: captureFields(taskInputs()), windows: allowedWindows.raw() } : null,
      follow: followEdit || followDirty ? { edit: followEdit, dirty: followDirty, fields: captureFields(followInputs()) } : null,
      capacity: { fields: captureFields(capacityInputs()), extra: extraWindows.raw(), busy: busyWindows.raw(), previousProposals } };
    try {
      const serialized = JSON.stringify(saved); if (serialized.length > 150_000) throw new Error('Kladden er for stor.');
      sessionStorage.setItem(draftKey, serialized); storageReady = true;
    } catch { storageReady = false; }
  }
  function taskEditControls() {
    if ((taskEdit || taskDirty) && byId('personal-task-create')) byId('personal-task-create').open = true;
    const label = taskEdit ? 'Gem ændringer' : 'Opret personlig opgave';
    if (taskSubmit.textContent !== label) taskSubmit.textContent = label;
    taskCancel.hidden = !taskEdit && !taskDirty; taskReload.hidden = !taskEdit;
    taskFields['personal-task-state'].disabled = !taskEdit;
  }
  function followEditControls() {
    if ((followEdit || followDirty) && byId('follow-up-create')) byId('follow-up-create').open = true;
    const label = followEdit ? 'Gem opfølgning' : 'Opret opfølgning';
    if (followSubmit.textContent !== label) followSubmit.textContent = label;
    byId('follow-up-awaiting').readOnly = Boolean(followEdit); byId('follow-up-stop').readOnly = Boolean(followEdit);
    followAdvanced.details.hidden = !followEdit; followCancel.hidden = !followEdit && !followDirty; followReload.hidden = !followEdit;
    for (const input of Object.values(followFields)) input.disabled = !followEdit;
  }
  function resetTask() {
    taskForm.reset(); taskEdit = null; taskDirty = false; taskConflict = ''; taskEpoch++;
    for (const input of taskInputs()) { delete input.dataset.originalInstant; delete input.dataset.originalLocal; }
    byId('personal-task-duration').value = '30'; taskFields['personal-task-uncertainty'].value = '0'; taskFields['personal-task-priority'].value = '2';
    allowedWindows.set([]); taskEditControls(); draftStatus();
  }
  function resetFollow() {
    followForm.reset(); followEdit = null; followDirty = false; followConflict = ''; followEpoch++;
    for (const input of followInputs()) { delete input.dataset.originalInstant; delete input.dataset.originalLocal; }
    followEditControls(); draftStatus();
  }
  function updateDependencies(selected = [...dependencyField.selectedOptions].map(item => item.value)) {
    if (document.activeElement === dependencyField) return;
    dependencyField.replaceChildren();
    for (const record of taskRecords.filter(item => item.id !== taskEdit?.id && item.status !== 'archived'))
      option(dependencyField, record.id, `${record.title}${record.status === 'completed' ? ' (afsluttet)' : ''}`);
    for (const id of selected) if (![...dependencyField.options].some(item => item.value === id)) option(dependencyField, id, `Utilgængelig afhængighed: ${id}`);
    for (const item of dependencyField.options) item.selected = selected.includes(item.value);
  }
  function editTask(record, discard = false) {
    if (taskDirty && !discard && !window.confirm('Kassér den nuværende ugemte opgavekladde?')) return;
    resetTask(); taskEdit = { id: record.id, revision: record.revision };
    byId('personal-task-title').value = record.title; byId('personal-task-purpose').value = record.purpose;
    byId('personal-task-duration').value = record.durationMinutes; setInstant(byId('personal-task-deadline'), record.deadline);
    const values = { 'personal-task-outcome': record.expectedOutcome || '', 'personal-task-uncertainty': record.durationUncertaintyMinutes || 0,
      'personal-task-priority': record.priority, 'personal-task-project': record.projectId || '', 'personal-task-state': record.status };
    for (const [id, value] of Object.entries(values)) taskFields[id].value = value;
    setInstant(taskFields['personal-task-earliest'], record.earliestStart);
    setInstant(taskFields['personal-task-planned'], record.lockedStart || record.plannedStart);
    setInstant(taskFields['personal-task-next-check'], record.nextFollowUpAt);
    taskFields['personal-task-locked'].checked = Boolean(record.lockedStart);
    updateDependencies(record.dependencies || []); allowedWindows.set(record.allowedWindows || []);
    taskAdvanced.details.open = true; taskEditControls(); draftStatus(); persistDrafts(); byId('personal-task-title').focus();
  }
  function editFollow(record, discard = false) {
    if (followDirty && !discard && !window.confirm('Kassér den nuværende ugemte opfølgningskladde?')) return;
    resetFollow(); followEdit = { id: record.id, revision: record.revision };
    byId('follow-up-awaiting').value = record.awaiting; byId('follow-up-stop').value = record.stopCondition;
    setInstant(byId('follow-up-check'), record.nextCheckAt); followFields['follow-observation-subject'].value = record.awaiting.slice(0, 240);
    followAdvanced.details.open = true; followEditControls(); draftStatus(); persistDrafts(); byId('follow-up-check').focus();
  }

  const focusCard = (target, id) => {
    const card = [...target.children].find(item => item.dataset.planKey === id) || target;
    card.tabIndex = -1; card.focus({ preventScroll: true });
  };
  async function refreshPersonalTasks(forceId = null) {
    const request = ++sequence.tasks, owner = ownerToken;
    const { tasks } = await api('/api/personal-tasks');
    if (request !== sequence.tasks || owner !== localStorage.getItem('jarvisAccessToken')) return;
    taskRecords = tasks;
    updateDependencies();
    if (taskEdit) {
      const latest = tasks.find(item => item.id === taskEdit.id);
      taskConflict = !latest || ['completed', 'archived'].includes(latest.status) ? 'Opgaven er afsluttet, arkiveret eller utilgængelig. Kladden er bevaret og bliver ikke en ny opgave.'
        : latest.revision !== taskEdit.revision ? 'Ændret et andet sted. Kladden bruger stadig sin oprindelige revision; gennemgå og hent nyeste før gemning.' : '';
    }
    draftStatus();
    const target = byId('personal-task-list');
    JarvisPlan.syncCards(target, tasks.filter(item => item.status !== 'archived'), { forceId,
      emptyText: 'Ingen personlige opgaver endnu.', render: task => {
      const card = node('article', 'v5-record-card');
      card.dataset.personalTaskId = task.id;
      card.append(node('h3', '', task.title));
      label(card, 'Status', ({ pending: 'Afventer', in_progress: 'I gang', blocked: 'Blokeret',
        completed: 'Afsluttet' })[task.status] || task.status);
      label(card, 'Formål', task.purpose);
      if (task.expectedOutcome) label(card, 'Forventet resultat', task.expectedOutcome);
      label(card, 'Tid', `${task.durationMinutes} min. + ${task.durationUncertaintyMinutes || 0} min. usikkerhed · deadline ${dateText(task.deadline)}`);
      if (task.lockedStart || task.plannedStart) label(card, task.lockedStart ? 'Låst lokal placering' : 'Valgt lokal placering', dateText(task.lockedStart || task.plannedStart));
      if (task.earliestStart) label(card, 'Tidligste start', dateText(task.earliestStart));
      if (task.dependencies.length) label(card, 'Afhængigheder', task.dependencies.map(id => taskRecords.find(item => item.id === id)?.title || id).join(', '));
      if (task.allowedWindows?.length) label(card, 'Tilladte tidsvinduer', task.allowedWindows.map(item => `${dateText(item.start)} – ${dateText(item.end)}`).join(' · '));
      if (task.nextFollowUpAt) label(card, 'Næste opfølgning', dateText(task.nextFollowUpAt));
      label(card, 'Grundlag', `${task.source?.kind || 'user'} · revision ${task.revision}. En plan er ikke bevis på udførelse.`);
      const actions = node('div', 'v5-record-actions');
      if (task.status !== 'completed') actions.append(button('Redigér opgave', () => editTask(task)), button('Markér afsluttet', async () => {
        await post(`/api/personal-tasks/${task.id}/complete`, 'POST', { expectedRevision: task.revision });
        errorStatus('personal-task-status', 'Opgaven er markeret afsluttet.');
        await refreshPersonalTasks(task.id);
      }));
      actions.append(button('Arkivér', async () => {
        await post(`/api/personal-tasks/${task.id}/archive`, 'POST', { expectedRevision: task.revision });
        errorStatus('personal-task-status', 'Opgaven er arkiveret.');
        await refreshPersonalTasks(task.id);
      }, true));
      card.append(actions);
      return card;
    } });
    if (forceId) focusCard(target, forceId);
  }

  async function refreshFollowUps(forceId = null) {
    const request = ++sequence.follow, owner = ownerToken;
    const result = await api('/api/follow-ups');
    if (request !== sequence.follow || owner !== localStorage.getItem('jarvisAccessToken')) return;
    followRecords = result.cases;
    if (followEdit) {
      const latest = followRecords.find(item => item.id === followEdit.id);
      followConflict = !latest || latest.status !== 'open' ? 'Sagen er lukket eller utilgængelig. Kladden er bevaret og opretter ikke en ny sag.'
        : latest.revision !== followEdit.revision ? 'Ændret et andet sted. Kladden bruger stadig sin oprindelige revision; gennemgå og hent nyeste før gemning.' : '';
    }
    draftStatus();
    const target = byId('follow-up-list');
    JarvisPlan.syncCards(target, followRecords.filter(item => item.status === 'open'), { forceId,
      emptyText: 'Ingen åbne opfølgningssager.', render: record => {
      const card = node('article', 'v5-record-card');
      card.dataset.followUpId = record.id;
      card.append(node('h3', '', record.awaiting));
      label(card, 'Næste tjek', dateText(record.nextCheckAt));
      label(card, 'Stopbetingelse', record.stopCondition);
      label(card, 'Observationer', `${record.observations.length}`);
      label(card, 'Kilde', `${record.source.kind} · ${record.source.id} · revision ${record.revision}`);
      for (const observation of record.observations.slice(0, 3)) label(card,
        ({ changed: 'Ændret', unchanged: 'Uændret', unknown: 'Ukendt' })[observation.status],
        `${observation.subject}: ${observation.value ?? 'ingen sikker værdi'} · ${observation.source} · ${dateText(observation.observedAt)}`);
      const actions = node('div', 'v5-record-actions');
      actions.append(button('Udskyd / registrér observation', () => editFollow(record), false, 'follow-up-status'));
      actions.append(button('Afslut sag', async () => {
        await post(`/api/follow-ups/${record.id}`, 'PATCH', { expectedRevision: record.revision, action: 'complete' });
        errorStatus('follow-up-status', 'Sagen er afsluttet.');
        await refreshFollowUps(record.id);
      }, false, 'follow-up-status'));
      actions.append(button('Annullér sag', async () => {
        await post(`/api/follow-ups/${record.id}`, 'PATCH', { expectedRevision: record.revision, action: 'cancel' });
        errorStatus('follow-up-status', 'Sagen er annulleret. Historikken er bevaret.');
        await refreshFollowUps(record.id);
      }, true, 'follow-up-status'));
      card.append(actions);
      return card;
    } });
    if (forceId) focusCard(target, forceId);
  }

  async function refreshClaims(forceId = null) {
    if (forceId) claimsUi.pin(forceId);
    await claimsUi.refresh();
  }

  byId('personal-task-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    let saved = false;
    const epoch = taskEpoch, owner = ownerToken;
    const snapshot = () => JSON.stringify({ fields: captureFields(taskInputs()), windows: allowedWindows.raw() });
    const submitted = snapshot();
    try {
      const plannedStart = localInstant(taskFields['personal-task-planned']);
      if (taskFields['personal-task-locked'].checked && !plannedStart) throw new Error('Angiv et starttidspunkt, før opgaven låses.');
      const payload = { title: byId('personal-task-title').value, purpose: byId('personal-task-purpose').value,
        durationMinutes: Number(byId('personal-task-duration').value), deadline: localInstant('personal-task-deadline'),
        expectedOutcome: taskFields['personal-task-outcome'].value,
        durationUncertaintyMinutes: Number(taskFields['personal-task-uncertainty'].value), priority: Number(taskFields['personal-task-priority'].value),
        earliestStart: localInstant(taskFields['personal-task-earliest']), plannedStart,
        lockedStart: taskFields['personal-task-locked'].checked ? plannedStart : null,
        nextFollowUpAt: localInstant(taskFields['personal-task-next-check']), projectId: taskFields['personal-task-project'].value || null,
        dependencies: [...dependencyField.selectedOptions].map(item => item.value), allowedWindows: allowedWindows.read(),
        ...(taskEdit ? { expectedRevision: taskEdit.revision, status: taskFields['personal-task-state'].value } : {}) };
      const result = await post(taskEdit ? `/api/personal-tasks/${taskEdit.id}` : '/api/personal-tasks', taskEdit ? 'PATCH' : 'POST', payload);
      saved = true;
      if (owner !== localStorage.getItem('jarvisAccessToken')) return;
      if (epoch === taskEpoch) {
        if (submitted === snapshot()) resetTask();
        else { taskEdit = { id: result.task.id, revision: result.task.revision }; taskDirty = true; taskEditControls(); }
      }
      persistDrafts(); draftStatus();
      errorStatus('personal-task-status', 'Opgaven er gemt lokalt. Ingen kalenderaftale er oprettet.');
      await refreshPersonalTasks();
    } catch (error) { errorStatus('personal-task-status', saved ? `Opgaven er gemt, men oversigten kunne ikke opdateres: ${error.message}`
      : `Gemning er ikke bekræftet: ${error.message}. Kladden er bevaret. Kontrollér oversigten før et nyt forsøg.`, true); }
    finally { submit.disabled = false; }
  });

  byId('follow-up-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    let saved = false;
    const epoch = followEpoch, owner = ownerToken;
    const submitted = JSON.stringify(captureFields(followInputs()));
    try {
      const nextCheckAt = localInstant('follow-up-check');
      let payload;
      if (followEdit) {
        const status = observationStatus.value;
        payload = { expectedRevision: followEdit.revision, action: status ? 'observe' : 'snooze', nextCheckAt };
        if (status) {
          const subject = followFields['follow-observation-subject'].value.trim(), source = followFields['follow-observation-source'].value.trim();
          if (!subject || !source) throw new Error('Observationen kræver både emne og kilde.');
          payload.observation = { status, subject, source, value: followFields['follow-observation-value'].value || null };
        }
      } else payload = { awaiting: byId('follow-up-awaiting').value, nextCheckAt,
        stopCondition: byId('follow-up-stop').value, source: { kind: 'user', id: 'manual' } };
      const result = await post(followEdit ? `/api/follow-ups/${followEdit.id}` : '/api/follow-ups', followEdit ? 'PATCH' : 'POST', payload);
      saved = true;
      if (owner !== localStorage.getItem('jarvisAccessToken')) return;
      if (epoch === followEpoch) {
        if (submitted === JSON.stringify(captureFields(followInputs()))) resetFollow();
        else { followEdit = { id: result.case.id, revision: result.case.revision }; followDirty = true; followEditControls(); }
      }
      persistDrafts(); draftStatus();
      errorStatus('follow-up-status', 'Opfølgningen er gemt. Ingen job eller besked til andre er aktiveret.');
      await refreshFollowUps();
    } catch (error) { errorStatus('follow-up-status', saved ? `Opfølgningen er gemt, men oversigten kunne ikke opdateres: ${error.message}`
      : `Gemning er ikke bekræftet: ${error.message}. Kladden er bevaret. Kontrollér oversigten før et nyt forsøg.`, true); }
    finally { submit.disabled = false; }
  });

  byId('capacity-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
    const owner = ownerToken, version = capacityVersion, request = ++simulationSequence;
    for (const control of byId('capacity-results').querySelectorAll('button')) control.disabled = true;
    try {
      const start = localInstant('capacity-start'), end = localInstant('capacity-end');
      if (!start || !end || end <= start) throw new Error('Sluttid skal være efter starttid.');
      const useCalendar = byId('capacity-reviewed').checked;
      const workWindows = [{ start, end }, ...extraWindows.read()];
      const calendarEvents = busyWindows.read().map((window, index) => ({ ...window, source: { kind: 'user-reviewed', id: `manual-${index + 1}` } }));
      if (useCalendar && calendarEvents.length) throw new Error('Vælg manuel gennemgang for de indtastede aftaler, eller fjern dem før Google Kalender bruges. Ingen indtastede aftaler ignoreres lydløst.');
      const starts = workWindows.map(window => window.start).sort(), ends = workWindows.map(window => window.end).sort();
      const calendarCoverage = !useCalendar && manualReview.checked
        ? { status: 'ready', start: starts[0], end: ends.at(-1), source: 'explicit-owner-review' } : { status: 'unknown' };
      const { plan, basis } = await post('/api/planning/simulate', 'POST', { timeZone: JarvisPlan.timeZone, useCalendar,
        workWindows, calendarEvents, calendarCoverage, bufferMinutes: Number(capacityFields['capacity-buffer'].value), previousProposals });
      if (owner !== localStorage.getItem('jarvisAccessToken')) return;
      const choices = new Map(previousProposals.map(proposal => [proposal.taskId, proposal]));
      for (const { taskId, start, end } of plan.proposals) choices.set(taskId, { taskId, start, end });
      previousProposals = [...choices.values()].slice(-250);
      const stale = capacityVersion !== version;
      if (!stale) capacityDirty = false;
      persistDrafts();
      const target = byId('capacity-results');
      target.replaceChildren();
      errorStatus('capacity-status', stale ? 'Rammerne blev ændret under beregningen. Resultatet er forældet og kan ikke gemmes; gennemgå og beregn igen.'
        : plan.feasible ? 'Forslaget kan placeres inden for de angivne rammer. Ingen aftaler er oprettet.'
        : 'Der mangler oplysninger, eller tidsrammerne kan ikke overholdes.', !plan.feasible);
      if (basis) target.append(node('p', 'muted small-text', `Grundlag: ${basis}.`));
      for (const proposal of plan.proposals) {
        const card = node('article', 'v5-record-card');
        card.dataset.proposedTaskId = proposal.taskId;
        card.append(node('h3', '', proposal.title), node('p', '', `${dateText(proposal.start)} – ${dateText(proposal.end)}`));
        label(card, 'Placering', ({ locked: 'Låst valg bevaret', preserved: 'Tidligere valg bevaret', moved: 'Berørt valg flyttet', new: 'Nyt forslag' })[proposal.placement] || 'Forslag');
        if (proposal.previousStart && proposal.previousStart !== proposal.start) label(card, 'Tidligere', dateText(proposal.previousStart));
        if (proposal.reservedUntil && proposal.reservedUntil !== proposal.end) label(card, 'Reserveret til', `${dateText(proposal.reservedUntil)} (inklusive usikkerhed og buffer)`);
        card.append(node('p', 'small-text', proposal.explanation));
        const actions = node('div', 'v5-record-actions');
        const savePlacement = async lock => {
          if (capacityVersion !== version || simulationSequence !== request) throw new Error('Planforslaget er forældet. Gennemgå kapaciteten og beregn igen.');
          if (!proposal.source || proposal.source.kind !== 'personal-task' || !Number.isInteger(proposal.source.revision))
            throw new Error('Forslaget mangler en opgaverevision. Beregn et nyt forslag.');
          if (taskEdit?.id === proposal.taskId) throw new Error('Afslut redigeringen af denne opgave før et planforslag gemmes. Din kladde er bevaret.');
          await post(`/api/personal-tasks/${proposal.taskId}`, 'PATCH', { expectedRevision: proposal.source.revision,
            plannedStart: proposal.start, ...(lock ? { lockedStart: proposal.start } : {}) });
          for (const control of actions.querySelectorAll('button')) control.disabled = true;
          actions.replaceChildren(node('p', 'muted', lock ? 'Placeringen er gemt og låst lokalt.' : 'Placeringen er gemt lokalt.'));
          errorStatus('capacity-status', 'Dit valg er gemt lokalt. Ingen kalenderaftale er oprettet. Beregn igen ved ændrede rammer.');
          await refreshPersonalTasks();
        };
        actions.append(button('Gem placering lokalt', () => savePlacement(false), false, 'capacity-status'));
        if (!proposal.locked) actions.append(button('Gem og lås placering', () => savePlacement(true), false, 'capacity-status'));
        if (stale) for (const control of actions.querySelectorAll('button')) control.disabled = true;
        card.append(actions);
        target.append(card);
      }
      for (const conflict of plan.conflicts) target.append(node('p', 'v5-conflict', conflict.explanation || conflict.code));
      for (const alternative of plan.alternatives || []) target.append(node('p', 'muted small-text', `Mulighed: ${alternative}`));
    } catch (error) { errorStatus('capacity-status', `${error.message} Tidligere viste forslag kan være forældede; beregn igen før gemning.`, true); }
    finally { submit.disabled = false; }
  });

  const backgroundReads = new Map();
  function clearLocalPlanning() {
    backgroundReads.clear();
    claimsUi.clear();
    for (const key of Object.keys(sequence)) sequence[key]++;
    resetTask(); resetFollow(); capacityForm.reset();
    capacityFields['capacity-buffer'].value = '0'; extraWindows.set([]); busyWindows.set([]);
    for (const input of capacityInputs()) { delete input.dataset.originalInstant; delete input.dataset.originalLocal; }
    previousProposals = []; taskRecords = []; followRecords = []; capacityDirty = false; capacityVersion++; simulationSequence++;
    dependencyField.replaceChildren(); ownerToken = '';
    for (const id of ['personal-task-list', 'follow-up-list', 'capacity-results', 'claim-list']) byId(id).replaceChildren();
    for (const id of ['personal-task-status', 'follow-up-status', 'capacity-status', 'claim-status']) errorStatus(id, '');
    try { sessionStorage.removeItem(draftKey); } catch { /* The signed-out page does not display saved drafts. */ }
  }
  const viewVisible = view => {
    const root = view === 'knowledge' ? (byId('settings-profile') || byId('tab-knowledge'))
      : view === 'plan' && byId('plan-personal') ? (typeof JarvisShell === 'object' && JarvisShell.visible(byId('plan-calendar')) ? byId('plan-calendar') : byId('plan-personal')) : byId(`tab-${view}`);
    if (typeof JarvisShell === 'object') return JarvisShell.visible(root);
    return Boolean(root && !root.hidden && !root.classList.contains('hidden'));
  };
  const refresh = async ({ forceKinds = [] } = {}) => {
    const current = localStorage.getItem('jarvisAccessToken');
    if (!current) return;
    if (ownerToken !== current) { clearLocalPlanning(); ownerToken = current; }
    if (!forceKinds.length && document.visibilityState === 'hidden') return;
    const plan = viewVisible('plan'), knowledge = viewVisible('knowledge');
    const reads = [
      ['personal-task', forceKinds.includes('personal-task') || (!forceKinds.length && plan), refreshPersonalTasks, 'personal-task-status'],
      ['follow-up', forceKinds.includes('follow-up') || (!forceKinds.length && plan), refreshFollowUps, 'follow-up-status'],
      ['claim', forceKinds.includes('claim') || (!forceKinds.length && knowledge), refreshClaims, 'claim-status'],
    ].filter(([, enabled]) => enabled);
    await Promise.allSettled(reads.map(([kind, , read, status]) => {
      if (backgroundReads.has(kind)) return backgroundReads.get(kind);
      const pending = read().catch(error => {
        if (ownerToken === current && localStorage.getItem('jarvisAccessToken') === current)
          errorStatus(status, `Oversigten kunne ikke opdateres: ${error.message}. Kladden er bevaret.`, true);
      })
        .finally(() => { if (backgroundReads.get(kind) === pending) backgroundReads.delete(kind); });
      backgroundReads.set(kind, pending); return pending;
    }));
  };
  for (const type of ['input', 'change']) {
    taskForm.addEventListener(type, markTaskDirty); followForm.addEventListener(type, markFollowDirty);
    capacityForm.addEventListener(type, markCapacityDirty);
  }
  repeatedTime.addEventListener('change', event => { markCapacityDirty(event); draftStatus(); });
  byId('logout').addEventListener('click', clearLocalPlanning);
  window.addEventListener('beforeunload', event => {
    if ((!storageReady && (taskDirty || followDirty || capacityDirty)) || claimsUi.hasUnrecoverableDraft()) { event.preventDefault(); event.returnValue = ''; }
  });
  taskEditControls(); followEditControls();
  try {
    if (ownerToken) {
      const raw = sessionStorage.getItem(draftKey);
      if (raw && raw.length <= 150_000) {
        const saved = JSON.parse(raw);
        const edit = value => value && typeof value.id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value.id) &&
          Number.isInteger(value.revision) && value.revision > 0 ? { id: value.id, revision: value.revision } : null;
        if (saved.version === 1) {
          if (saved.task) {
            taskEdit = edit(saved.task.edit); taskDirty = saved.task.dirty === true; restoreFields(taskInputs(), saved.task.fields);
            allowedWindows.set(Array.isArray(saved.task.windows) ? saved.task.windows.slice(0, 30) : []);
            taskAdvanced.details.open = Boolean(taskEdit); taskEditControls();
            errorStatus('personal-task-status', 'Opgavekladde gendannet i denne fane. Gennemgå før gemning.');
          }
          if (saved.follow) {
            followEdit = edit(saved.follow.edit); followDirty = saved.follow.dirty === true; restoreFields(followInputs(), saved.follow.fields);
            followAdvanced.details.open = Boolean(followEdit); followEditControls();
            errorStatus('follow-up-status', 'Opfølgningskladde gendannet i denne fane. Gennemgå før gemning.');
          }
          if (saved.capacity) {
            restoreFields(capacityInputs(), saved.capacity.fields);
            extraWindows.set(Array.isArray(saved.capacity.extra) ? saved.capacity.extra.slice(0, 30) : []);
            busyWindows.set(Array.isArray(saved.capacity.busy) ? saved.capacity.busy.slice(0, 30) : []);
            previousProposals = Array.isArray(saved.capacity.previousProposals) ? saved.capacity.previousProposals.slice(0, 250)
              .filter(value => typeof value?.taskId === 'string' && value.taskId.length <= 100 &&
                typeof value.start === 'string' && value.start.length <= 40 && typeof value.end === 'string' && value.end.length <= 40)
              .map(({ taskId, start, end }) => ({ taskId, start, end })) : [];
            // A prior manual review is not a fresh statement about capacity.
            manualReview.checked = false;
            if (byId('capacity-start').value) errorStatus('capacity-status', 'Tidsrum gendannet. Gennemgå kapaciteten igen og beregn et nyt forslag; ingen ændringer er gemt automatisk.');
          }
          draftStatus();
        }
      }
    } else sessionStorage.removeItem(draftKey);
  } catch { storageReady = false; draftStatus(); }
  document.addEventListener('jarvis:refreshed', refresh);
  document.addEventListener('jarvis:view-changed', refresh);
  document.addEventListener('jarvis:v5-sources-changed', event => {
    const kind = event.detail?.sourceId?.split(':')[0];
    if (kind === 'claim') claimsUi.pin(event.detail.sourceId.split(':')[1]);
    // A source open is an explicit read, including when the originating view
    // has already changed. Older dispatchers without an ID retain their forced
    // refresh contract, but normal polling never fetches hidden domains.
    const pending = refresh({ forceKinds: ['claim', 'personal-task', 'follow-up'].includes(kind)
      ? [kind] : ['claim', 'personal-task', 'follow-up'] });
    if (typeof event.detail?.waitUntil === 'function') event.detail.waitUntil(pending);
  });
  if (localStorage.getItem('jarvisAccessToken')) refresh();
})();
