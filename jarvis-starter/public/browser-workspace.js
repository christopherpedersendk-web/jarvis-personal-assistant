(() => {
  const el = id => document.getElementById(id);
  if (!el('plan-web')) return;
  let snapshot = null, preview = null, editor = null, busy = false, generation = 0;
  const node = (tag, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
  const button = (label, action) => { const n = node('button', label); n.type = 'button'; n.className = 'secondary'; n.addEventListener('click', action); return n; };
  const post = (path, body) => api('/api/browser/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const current = (g, owner) => g === generation && owner && owner === token && !el('workspace').classList.contains('hidden');
  const link = url => { const a = node('a', 'Åbn selv kilden'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; return a; };
  function invalidatePreview() { preview = null; el('web-preview').classList.add('hidden'); }
  function closeEditor() { editor = null; el('web-draft-form').reset(); el('web-draft-form').classList.add('hidden'); }
  function edit(value, draft = false) {
    if (busy) return;
    if (editor && (el('web-draft-title').value || el('web-draft-details').value)) {
      el('web-status').textContent = 'Gem eller luk den åbne redigering, før du vælger en anden kladde.'; return;
    }
    editor = draft ? { id: value.id, expectedRevision: value.revision } : { readId: value.id, contentHash: value.page.contentHash };
    el('web-draft-title').value = draft ? value.title : '';
    el('web-draft-details').value = draft ? value.details : '';
    el('web-draft-source').textContent = (draft ? value.source.url : value.page.url) + ' · Gemmes kun hos Jarvis. Ikke sendt.';
    el('web-draft-form').classList.remove('hidden'); el('web-draft-title').focus();
  }
  function render(data) {
    if (data.isPreview) {
      if (el('web-url').value !== data.enteredUrl || Boolean(data.javascript) !== el('web-javascript').checked) { el('web-status').textContent = 'Linket blev ændret. Gennemgå det nye link.'; return; }
      el('web-url').value = data.url;
      preview = data; el('web-preview-url').textContent = data.url;
      el('web-preview-effect').textContent = `${data.effect} Bekræft senest ${new Date(data.expiresAt).toLocaleTimeString('da-DK')}.`;
      el('web-preview').classList.remove('hidden'); el('web-status').textContent = 'Gennemgå linket før hentning.';
      return;
    }
    snapshot = data;
    el('web-javascript').disabled = !data.capabilities?.javascript;
    if(!data.capabilities?.javascript) el('web-javascript').checked = false;
    el('web-status').textContent = `${data.stopped ? 'Stoppet' : 'Klar'} · ${data.readsToday}/${data.limits.readsPerDay} læsninger i dag · ${data.origins.length} godkendte websites.`;
    el('web-sites').replaceChildren(...data.origins.map(site => {
      const li = node('li', site + ' ');
      li.append(button('Fjern website', () => run(async () => {
        const next = await post('sites', { origins: snapshot.origins.filter(s => s !== site), expectedRevision: snapshot.revision });
        invalidatePreview(); return next;
      }))); return li;
    }));
    const statusNames = { reading: 'Læser …', completed: 'Læst', cancelled: 'Stoppet', failed: 'Kunne ikke læses', unknown: 'Udfald ukendt — ingen genforsøg' };
    el('web-reads').replaceChildren(...data.reads.slice(0, 10).map(read => {
      const article = node('article'); article.append(node('h3', read.page?.title || 'Weblæsning'), node('p', `${statusNames[read.status] || read.status} · ${read.url}`));
      if (read.status === 'reading') article.append(button('Stop læsning', () => run(async () => { await post('cancel', { id: read.id }); return api('/api/browser'); })));
      if (read.page) {
        const detail = node('details'); detail.append(node('summary', 'Se kildeuddrag'));
        const excerpt = node('p', read.page.text); excerpt.className = 'web-excerpt';
        detail.append(node('p', `${read.page.notice} Læst ${new Date(read.completedAt).toLocaleString('da-DK')}.${read.page.truncated ? ' Uddraget er forkortet.' : ''}`), excerpt);
        article.append(detail, button('Forbered lokal kladde', () => edit(read)), link(read.page.url));
        if (read.page.links?.length) {
          const navigation = node('details'); navigation.append(node('summary', 'Undersider på samme website'));
          navigation.append(node('p', 'Vælg et link, og gennemgå det før en ny læsning. Intet hentes ved valg.'));
          for (const url of read.page.links) navigation.append(button(url, () => {
            if (busy) return;
            invalidatePreview(); el('web-url').value = url; el('web-url').focus();
            el('web-status').textContent = 'Link valgt. Vælg Gennemgå link før hentning.';
          }));
          article.append(navigation);
        }
      } else if (read.status === 'completed') article.append(node('p', 'Uddraget er udløbet eller ryddet. Læs siden igen for at oprette en kladde.'));
      return article;
    }));
    el('web-drafts').replaceChildren(...data.drafts.map(draft => {
      const article = node('article'), details = node('p', draft.details); details.className = 'web-details';
      article.append(node('h3', draft.title), node('p', 'Ikke sendt' + (draft.sourceExpired ? ' · Kilden er over et døgn gammel.' : '')), details,
        node('p', `Kilde: ${draft.source.url}`), button('Redigér', () => edit(draft, true)),
        button('Slet lokal kladde', () => run(async () => { await post('delete-draft', { id: draft.id, expectedRevision: draft.revision }); return api('/api/browser'); })), link(draft.source.url));
      return article;
    }));
  }
  async function run(work, after) {
    if (busy || !token) return;
    busy = true; const g = generation, owner = token;
    el('web-status').textContent = 'Arbejder …';
    // Stop remains usable during a read via the separate cancel button below.
    el('plan-web').querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const data = await work();
      if (!current(g, owner)) return;
      if (data) render(data); after?.();
    } catch (error) {
      if (current(g, owner)) el('web-status').textContent = `${error.message} Hent status før en ny anmodning. Ingen automatisk gentagelse; din kladdetekst er bevaret.`;
    } finally {
      if (g === generation) { busy = false; el('plan-web').querySelectorAll('button').forEach(b => { b.disabled = false; }); }
    }
  }
  el('web-refresh').addEventListener('click', () => run(() => api('/api/browser')));
  el('web-site-form').addEventListener('submit', event => {
    event.preventDefault(); if (!snapshot) { el('web-status').textContent = 'Hent status først.'; return; }
    const value = el('web-site').value;
    run(() => post('sites', { origins: [...snapshot.origins, value], expectedRevision: snapshot.revision }), () => { if (el('web-site').value === value) el('web-site-form').reset(); invalidatePreview(); });
  });
  el('web-url').addEventListener('input', invalidatePreview);
  el('web-javascript').addEventListener('change', invalidatePreview);
  el('web-read-form').addEventListener('submit', event => {
    event.preventDefault(); invalidatePreview(); const url = el('web-url').value;
    run(async () => {
      const result = await post('preview', { url, javascript: el('web-javascript').checked });
      return { ...result, isPreview: true, enteredUrl: url };
    });
  });
  el('web-read-confirm').addEventListener('click', () => {
    if (!preview || busy) return;
    const intentId = preview.intentId; invalidatePreview();
    const cancel = button('Stop denne læsning', async () => {
      const g = generation, owner = token; cancel.disabled = true;
      try { await post('cancel', { id: intentId }); if (current(g, owner)) el('web-status').textContent = 'Stop er anmodet. Afventer udfald.'; }
      catch { if (current(g, owner)) el('web-status').textContent = 'Læsningen er muligvis afsluttet. Hent status for udfaldet.'; }
    });
    const operation = run(async () => { await post('read', { intentId }); return api('/api/browser'); });
    el('web-reads').prepend(cancel);
    operation.finally(() => cancel.remove());
  });
  el('web-draft-form').addEventListener('submit', event => {
    event.preventDefault(); if (!editor) return;
    const submitted = { ...editor, title: el('web-draft-title').value, details: el('web-draft-details').value };
    run(async () => { await post('draft', submitted); return api('/api/browser'); }, () => {
      // Keep edits made during an outstanding save; force the next save to use
      // the newly persisted revision instead of silently replacing those edits.
      if (el('web-draft-title').value === submitted.title && el('web-draft-details').value === submitted.details) closeEditor();
      else { const saved = snapshot.drafts.find(d => d.id === submitted.id || (!submitted.id && d.source.readId === submitted.readId && d.title === submitted.title && d.details === submitted.details));
        if (saved) editor = { id: saved.id, expectedRevision: saved.revision }; }
    });
  });
  el('web-draft-cancel').addEventListener('click', () => { if (!busy) closeEditor(); });
  document.addEventListener('jarvis:view-changed', event => {
    if (event.detail.primaryView === 'plan' && event.detail.section === 'web' && !snapshot) run(() => api('/api/browser'));
  });
  el('logout')?.addEventListener('click', () => {
    generation++; busy = false; snapshot = null; invalidatePreview(); closeEditor();
    for (const id of ['web-sites', 'web-reads', 'web-drafts']) el(id).replaceChildren();
    el('web-site-form').reset(); el('web-read-form').reset(); el('web-preview-url').textContent = el('web-preview-effect').textContent = el('web-draft-source').textContent = '';
    el('web-status').textContent = 'Hent status for at begynde.';
    el('plan-web').querySelectorAll('button').forEach(b => { b.disabled = false; });
  });
})();
