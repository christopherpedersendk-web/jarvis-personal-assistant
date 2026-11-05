// A chat request may have performed tools even if its last model response
// fails. Preserve the draft without automatically repeating the request.
(() => {
  const KEY = 'jarvis:v5:chat-draft';
  const sensitive = text => /\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{16,})\b|\beyJ[\w-]{12,}\.[\w-]{10,}\.[\w-]{10,}\b|PRIVATE KEY|Authorization\s*:\s*Bearer|\b(?:api[_ -]?key|password|adgangskode|token|secret|cpr|personnummer)\s*[:=]|https?:\/\/[^/\s]+@/i.test(text);
  function attach({ document, api, refresh, getToken, getStorage = () => globalThis.sessionStorage }) {
    const field = document.getElementById('message'), form = document.getElementById('message-form');
    const send = document.getElementById('send'), logout = document.getElementById('logout');
    const status = document.createElement('p'); status.id = 'chat-draft-status'; status.className = 'muted small-text';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const review = document.createElement('button'); review.type = 'button'; review.className = 'secondary'; review.hidden = true;
    review.textContent = 'Jeg har gennemgået udfaldet – behold kladden';
    form.after(status, review);
    let busy = false, blocked = false, generation = 0, storageFailed = false;
    const message = text => { status.textContent = text; status.hidden = !text; };
    const updateControls = () => { send.disabled = busy || blocked; send.textContent = busy ? 'Tænker …' : 'Send ↗'; review.hidden = !blocked || busy; };
    function persist() {
      if (!getToken()) return;
      try {
        const storage = getStorage();
        const text = sensitive(field.value) ? '' : field.value.slice(0, 5000);
        if (text || busy || blocked) storage.setItem(KEY, JSON.stringify({ text, pending: busy, requiresReview: blocked }));
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
        if (saved.pending === true || saved.requiresReview === true) unknown();
        else if (saved.text) message('Uafsendt kladde gendannet fra denne browserfane.');
      }
    } catch { /* A blocked or malformed browser store never prevents chatting. */ }
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
      const submitted = field.value, text = submitted.trim(), auth = getToken(), epoch = generation;
      if (!text || text.length > 5000) { message('Skriv mellem 1 og 5.000 tegn.'); return; }
      const current = () => generation === epoch && getToken() === auth;
      busy = true; updateControls(); persist(); message('Beskeden behandles. Feltet kan bruges til en ny kladde imens.');
      let acknowledged = false;
      try {
        await api('/api/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
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
      generation++; busy = false; blocked = false; field.value = ''; message(''); updateControls();
      try { getStorage().removeItem(KEY); } catch { /* The visible/authenticated draft is still cleared. */ }
    });
    globalThis.addEventListener?.('beforeunload', event => {
      if (busy || blocked || field.value) { event.preventDefault(); event.returnValue = ''; }
    });
    updateControls();
    return { submit };
  }
  globalThis.JarvisChat = Object.freeze({ attach });
})();
