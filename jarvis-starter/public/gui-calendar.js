// A week view of the existing read-only Google cache. Moving between weeks is
// a local read; only the explicit refresh button requests provider events.
(() => {
  if (typeof document === 'undefined') return;
  const byId = id => document.getElementById(id), root = byId('meal-google-events');
  if (!root) return;
  const make = (tag, text, css) => { const el = document.createElement(tag); if (text) el.textContent = text; if (css) el.className = css; return el; };
  const day = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const dateLabel = value => new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(`${value}T12:00:00Z`));
  const timeLabel = value => new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen', hourCycle: 'h23' }).format(new Date(value));
  const shift = (value, days) => new Date(Date.parse(`${value}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const toolbar = make('div', '', 'gui-calendar-toolbar');
  const previous = make('button', 'Forrige uge', 'secondary'), next = make('button', 'Næste uge', 'secondary'), today = make('button', 'I dag', 'secondary');
  for (const button of [previous, next, today]) button.type = 'button';
  const label = make('label', 'Uge fra'), input = make('input'); input.type = 'date'; input.id = 'gui-calendar-start'; label.htmlFor = input.id;
  const initial = new URL(location.href).searchParams.get('date'); input.value = /^\d{4}-\d{2}-\d{2}$/.test(initial || '') && Number.isFinite(Date.parse(initial)) ? initial : day(new Date());
  const status = make('p', '', 'muted small-text'); status.id = 'calendar-read-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  toolbar.append(label, input, previous, today, next); root.before(toolbar, status);
  const link = make('a', 'Se i Google Kalender'); link.href = 'https://calendar.google.com/calendar/u/0/r'; link.target = '_blank'; link.rel = 'noopener noreferrer'; root.after(link);
  let sequence = 0, sessionEpoch = 0, providerBusy = false;
  function range() {
    const first = input.value || day(new Date()), last = shift(first, 7);
    return { first, last, start: JarvisToday.dayRange(`${first}T12:00:00Z`).start, end: JarvisToday.dayRange(`${last}T12:00:00Z`).start };
  }
  async function refresh() {
    const owner = localStorage.getItem('jarvisAccessToken'); if (!owner) return;
    const request = ++sequence, selected = range(); status.textContent = 'Henter den gemte kalenderoversigt …';
    try {
      const cache = await api(`/api/google/calendar/cache?start=${encodeURIComponent(selected.start)}&end=${encodeURIComponent(selected.end)}&startDate=${selected.first}&days=7`);
      if (request !== sequence || owner !== localStorage.getItem('jarvisAccessToken')) return;
      root.replaceChildren();
      const connected = !['not_configured', 'not_connected'].includes(cache.connectionState);
      const ready = cache.ready === true && cache.coverage && Date.parse(cache.coverage.start) <= Date.parse(selected.start) && Date.parse(cache.coverage.end) >= Date.parse(selected.end);
      status.textContent = !connected ? 'Kalenderen er ikke tilsluttet. Opsæt forbindelsen under Integrationer.'
        : cache.connectionState === 'expired_login' ? 'Kalenderlogin er udløbet. Forbind igen under Integrationer.'
        : ready ? `Kun læsning · ${dateLabel(selected.first)} – ${dateLabel(shift(selected.first, 6))}`
        : cache.cacheState === 'stale' ? 'Kalenderdata er forældede. Opdater fra Google for at kontrollere de kommende aftaler.'
        : 'Den valgte uge er ikke dækket af en aktuel læsning. Ingen tomme dage kan bekræftes.';
      if (cache.fetchedAt && Number.isFinite(Date.parse(cache.fetchedAt))) status.textContent += ` · Senest læst ${new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(cache.fetchedAt))}`;
      for (let i = 0; i < 7; i++) {
        const date = shift(selected.first, i), box = make('section', '', 'gui-calendar-day'); box.dataset.calendarDate = date;
        box.append(make('h3', dateLabel(date)));
        const events = JarvisToday.calendarSummary(cache, `${date}T12:00:00Z`).events;
        if (!events.length) box.append(make('p', ready ? 'Ingen aftaler' : 'Dækning ukendt', 'muted small-text'));
        for (const event of events) {
          const entry = make('p', `${event.allDay ? 'Hele dagen' : timeLabel(event.start)} · ${event.title || 'Optaget'}${ready ? '' : ' · senest kendte observation'}`, 'meal-event');
          entry.dataset.calendarEventId = event.id; box.append(entry);
        }
        root.append(box);
      }
    } catch (error) { if (request === sequence && owner === localStorage.getItem('jarvisAccessToken')) status.textContent = `Kalenderen kunne ikke hentes: ${error.message}. Tidligere viste data er ikke en aktuel kontrol.`; }
  }
  async function load() {
    if (providerBusy) return; providerBusy = true; byId('meal-google-load').disabled = true;
    status.textContent = 'Læser kommende aftaler fra Google …';
    const owner = localStorage.getItem('jarvisAccessToken'), epoch = sessionEpoch;
    try {
      await api('/api/google/calendar/events?days=14');
      if (epoch !== sessionEpoch || owner !== localStorage.getItem('jarvisAccessToken')) return;
      await Promise.all([refresh(), refreshGoogle(), refreshHouseholdCalendar()]);
      JarvisToday.refresh();
    } catch (error) { if (epoch === sessionEpoch && owner === localStorage.getItem('jarvisAccessToken')) status.textContent = `Kalenderlæsningen fejlede: ${error.message}. Ingen aftaler er ændret.`; }
    finally { if (epoch === sessionEpoch) { providerBusy = false; if (owner === localStorage.getItem('jarvisAccessToken')) await refreshGoogle().catch(() => {}); } }
  }
  function change(date) {
    input.value = date; const url = new URL(location.href); url.searchParams.set('date', date);
    history.replaceState(history.state, '', url); refresh();
  }
  previous.addEventListener('click', () => change(shift(input.value || day(new Date()), -7))); next.addEventListener('click', () => change(shift(input.value || day(new Date()), 7)));
  today.addEventListener('click', () => change(day(new Date()))); input.addEventListener('change', () => { if (input.value) change(input.value); });
  byId('meal-google-load').textContent = 'Opdater kommende aftaler fra Google';
  byId('logout')?.addEventListener('click', () => { sequence++; sessionEpoch++; providerBusy = false; root.replaceChildren(); status.textContent = ''; });
  const visible = () => JarvisShell.visible(byId('plan-calendar'));
  for (const type of ['jarvis:refreshed','jarvis:view-changed']) document.addEventListener(type, () => { if (visible()) { refresh(); refreshGoogle().catch(error => { status.textContent = error.message; }); } });
  globalThis.JarvisCalendar = Object.freeze({ refresh, load });
})();
