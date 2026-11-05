// A chat request may have performed tools even if its last model response
// fails. Preserve the draft without automatically repeating the request.
(() => {
  const KEY = 'jarvis:v5:chat-draft';
  const sensitive = text => /\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{16,})\b|\beyJ[\w-]{12,}\.[\w-]{10,}\.[\w-]{10,}\b|PRIVATE KEY|Authorization\s*:\s*Bearer|\b(?:api[_ -]?key|password|adgangskode|token|secret|cpr|personnummer)\s*[:=]|https?:\/\/[^/\s]+@/i.test(text);
  function normalizeContext(value) {
    if (!value || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 160 || /[\r\n\x00-\x1f]/.test(value.label)) return null;
    const sourceId = typeof value.sourceId === 'string' && value.sourceId.length <= 2000 && !/[\r\n\x00-\x1f]/.test(value.sourceId) ? value.sourceId : null;
    if (sensitive(value.label) || (sourceId && sensitive(sourceId))) return null;
    return Object.freeze({ label: value.label, sourceId });
  }
  function compose(text, context) {
    const selected = normalizeContext(context);
    if (!selected) return text;
    return `[Brugervalgt kontekst: ${selected.label}]${selected.sourceId ? `\n[Kilde-ID: ${selected.sourceId}]` : '\n[Sidekontekst; intet enkelt objekt valgt]'}\n\n${text}`;
  }
  function attach({ document, api, refresh, getToken, getStorage = () => globalThis.sessionStorage,
    getContext = () => null, setContext = () => {}, canSend = () => true }) {
    const field = document.getElementById('message'), form = document.getElementById('message-form');
    const send = document.getElementById('send'), logout = document.getElementById('logout');
    const status = document.createElement('p'); status.id = 'chat-draft-status'; status.className = 'muted small-text';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const review = document.createElement('button'); review.type = 'button'; review.className = 'secondary'; review.hidden = true;
    review.textContent = 'Jeg har gennemgået udfaldet – behold kladden';
    form.after(status, review);
    let busy = false, blocked = false, generation = 0, storageFailed = false;
    const message = text => { status.textContent = text; status.hidden = !text; };
    const updateControls = () => { send.disabled = busy || blocked || !canSend(); send.textContent = busy ? 'Tænker …' : 'Send ↗'; review.hidden = !blocked || busy;
      for (const id of ['chat-context-clear', 'chat-attach-context']) { const control = document.getElementById(id); if (control) control.disabled = busy || blocked; }
    };
    function persist() {
      if (!getToken()) return;
      try {
        const storage = getStorage();
        const text = sensitive(field.value) ? '' : field.value.slice(0, 5000);
        const context = normalizeContext(getContext());
        if (text || busy || blocked || context) storage.setItem(KEY, JSON.stringify({ text, context, pending: busy, requiresReview: blocked }));
        else storage.removeItem(KEY);
        storageFailed = false;
      } catch { storageFailed = true; }
    }
    const unknown = () => {
      blocked = true; updateControls(); persist();
      message('Beskedens udfald er ikke bekræftet. Den kan have udført handlinger. Kladden er bevaret; gennemgå historikken og de berørte handlinger, før du vælger en ny anmodning. Der er ikke genforsøgt automatisk.');
    };
    try {
      const saved = getToken() ? JSON.parse(getStorage().getItem(KEY) || 'null') : null;
      if (saved && typeof saved.text === 'string' && saved.text.length <= 5000 && !sensitive(saved.text)) {
        field.value = saved.text;
        setContext(normalizeContext(saved.context));
        if (saved.pending === true || saved.requiresReview === true) unknown();
        else if (saved.text) message('Uafsendt kladde gendannet fra denne browserfane.');
      }
    } catch { /* A blocked or malformed browser store never prevents chatting. */ }
    document.addEventListener('jarvis:chat-context-change', () => { if (!busy && !blocked) persist(); });
    document.addEventListener('jarvis:refreshed', updateControls);
    field.addEventListener('input', () => {
      persist();
      if (blocked) return;
      message(sensitive(field.value) ? 'Denne tekst kan indeholde følsomme oplysninger og gemmes kun i hukommelsen på denne side.'
        : storageFailed ? 'Browseren kunne ikke gemme kladden. Teksten er bevaret på denne side; behold fanen åben.'
          : busy ? 'Den afsendte besked behandles. Nye ændringer i feltet bevares som kladde.' : field.value ? 'Uafsendt kladde – bevares ved navigation og opdatering.' : '');
    });
    review.addEventListener('click', () => {
      if (busy) return;
      blocked = false; persist(); updateControls(); field.focus();
      message('Kladden er bevaret efter din gennemgang. En eventuel ny besked er en ny anmodning, ikke automatisk genudførelse.');
    });
    async function submit(event) {
      event?.preventDefault();
      if (busy || blocked || !getToken()) return;
      if (!canSend()) { message('Samtalen mangler opsætning. Din kladde er bevaret; se System og opdateringer.'); return; }
      const submitted = field.value, text = submitted.trim(), auth = getToken(), epoch = generation;
      // Capture context before awaiting. Route changes and later drafts cannot
      // rebind this request. The existing server owns one shared conversation;
      // context is visible message text, not a fabricated conversation API.
      const selectedContext = normalizeContext(getContext()), outgoing = compose(text, selectedContext);
      if (!text || outgoing.length > 5000) { message('Besked og vedhæftet kontekst må tilsammen fylde højst 5.000 tegn.'); return; }
      const current = () => generation === epoch && getToken() === auth;
      busy = true; updateControls(); persist(); message('Beskeden behandles. Feltet kan bruges til en ny kladde imens.');
      let acknowledged = false;
      try {
        await api('/api/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: outgoing }) });
        if (!current()) return;
        acknowledged = true; busy = false;
        if (field.value === submitted) field.value = '';
        persist(); message(field.value ? 'Den afsendte besked er gennemført. Din nyere kladde er bevaret.' : 'Beskeden er gennemført.');
        try { await refresh(); }
        catch { if (current()) message('Beskeden er gennemført, men historikken kunne ikke opdateres. Kladden er bevaret; opdater visningen uden at gensende.'); }
      } catch (error) {
        if (!current()) return;
        busy = false;
        if ([400, 401, 403, 413, 422].includes(error.status)) {
          persist(); message(`Beskeden blev afvist før behandling: ${error.message}. Din kladde er bevaret.`);
        } else unknown();
      } finally {
        if (current()) { busy = false; updateControls(); if (acknowledged) persist(); }
      }
    }
    form.addEventListener('submit', submit);
    logout?.addEventListener('click', () => {
      generation++; busy = false; blocked = false; field.value = ''; setContext(null); message(''); updateControls();
      try { getStorage().removeItem(KEY); } catch { /* The visible/authenticated draft is still cleared. */ }
    });
    globalThis.addEventListener?.('beforeunload', event => {
      if (busy || blocked || field.value) { event.preventDefault(); event.returnValue = ''; }
    });
    updateControls();
    return { submit };
  }
  globalThis.JarvisChat = Object.freeze({ attach, compose, normalizeContext });
})();
