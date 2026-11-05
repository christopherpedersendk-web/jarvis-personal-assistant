// Daily summaries are read-only projections. Cached calendar reads never call
// Google, and shopping links open the original meal-plan object.
(() => {
  const zone = 'Europe/Copenhagen';
  const localDate = value => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const dateOf = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : value && Number.isFinite(Date.parse(value)) ? localDate(value) : null;
  function midnight(day) {
    const wanted = Date.parse(`${day}T00:00:00Z`); let instant = wanted;
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
      const projected = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
      if (projected === wanted) break; instant += wanted - projected;
    }
    return new Date(instant).toISOString();
  }
  function dayRange(value = new Date()) {
    const date = localDate(value), next = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    return { date, start: midnight(date), end: midnight(next) };
  }
  function calendarSummary(cache, value = new Date()) {
    const range = dayRange(value);
    if (!cache) return { state: 'error', label: 'Kalenderen kunne ikke hentes', events: [] };
    if (['not_configured', 'not_connected'].includes(cache.connectionState)) return { state: 'disconnected', label: 'Kalenderen er ikke tilsluttet', events: [] };
    const covered = cache.coverage && Date.parse(cache.coverage.start) <= Date.parse(range.start) && Date.parse(cache.coverage.end) >= Date.parse(range.end);
    const events = (cache.events || []).filter(event => event.allDay
      ? event.start <= range.date && event.end > range.date
      : (() => {
        const start = Date.parse(event.start), end = Date.parse(event.end || event.start);
        // Calendar intervals have an exclusive end. A point event belongs to
        // the day containing its start, including one exactly at midnight.
        return start < Date.parse(range.end) && (end > Date.parse(range.start) || (end === start && start >= Date.parse(range.start)));
      })())
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const fresh = cache.ready === true && covered && (!cache.expiresAt || Date.parse(cache.expiresAt) > new Date(value).getTime());
    return { state: fresh ? (events.length ? 'ready' : 'empty') : 'unknown', events,
      label: fresh ? (events.length ? 'Aftaler i dag' : 'Ingen aftaler i dag')
        : cache.cacheState === 'stale' ? 'Kalenderens data er forældede' : cache.connectionState === 'expired_login' ? 'Kalenderlogin er udløbet' : 'Kalenderens dækning er ukendt',
      fetchedAt: cache.fetchedAt || null };
  }
  function agendaSource(item) {
    const source = item?.source;
    if (source?.kind === 'organizer' && source.collectionId && source.itemId) return `organizer:${source.collectionId}:${source.itemId}`;
    if (source?.kind && source.id) return `${source.kind}:${source.id}`;
    return null;
  }
  globalThis.JarvisToday = { dayRange, calendarSummary, dateOf, agendaSource };
  if (typeof document === 'undefined') return;
  const byId = id => document.getElementById(id);
  const make = (tag, text, css) => { const el = document.createElement(tag); if (text) el.textContent = text; if (css) el.className = css; return el; };
  const timestamp = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone: zone }).format(new Date(value)) : 'Tidspunkt ukendt';
  let meals, generation = 0, pending = null, readError = '';
  function shoppingLinks() {
    const parent = byId('plan-notes'); if (!parent) return;
    let root = byId('meal-shopping-links');
    if (!root) { root = make('section', '', 'panel'); root.id = 'meal-shopping-links'; parent.prepend(root); }
    // Keep a focused link stable while the shared source is refreshed.
    if (root.contains(document.activeElement)) return;
    root.replaceChildren(make('h2', 'Indkøb fra madplaner'));
    const plans = (meals?.plans || []).filter(plan => !plan.archived && plan.status === 'shopping_ready');
    if (meals === undefined) root.append(make('p', readError || 'Henter gemte indkøbslister …', 'muted small-text'));
    else if (!plans.length) root.append(make('p', 'Ingen beregnede indkøbslister fra madplaner endnu.', 'muted small-text'));
    for (const plan of plans.slice(0, 10)) {
      const button = make('button', `Åbn indkøbslisten fra ${plan.startDate}`, 'secondary compact-button'); button.type = 'button';
      const sourceId = `meal-plan:${plan.id}`;
      button.dataset.mealPlanId = plan.id;
      button.addEventListener('click', () => {
        selectTab('meals', { sourceId });
        focusRecordedSource(sourceId).catch(error => toast(error.message));
      });
      root.append(button);
    }
    root.append(make('p', 'Listen åbner i den oprindelige madplan. Rettelser gemmes på samme liste.', 'muted micro'));
  }
  async function refreshShoppingLinks() {
    const owner = localStorage.getItem('jarvisAccessToken');
    if (!owner || document.hidden || !JarvisShell.visible(byId('plan-notes'))) return;
    if (pending) return pending;
    const epoch = generation; shoppingLinks();
    const operation = (async () => {
      try {
        const value = await api('/api/meals');
        if (owner !== localStorage.getItem('jarvisAccessToken') || epoch !== generation) return;
        meals = value; readError = '';
      } catch {
        if (owner !== localStorage.getItem('jarvisAccessToken') || epoch !== generation) return;
        meals = undefined; readError = 'Indkøbslisterne kunne ikke hentes. Prøv at opdatere.';
      }
      shoppingLinks();
    })().finally(() => { if (pending === operation) pending = null; });
    pending = operation; return operation;
  }
  Object.assign(globalThis.JarvisToday, { refresh() {
    // Use the existing v5 daily read-model, including its source-bound records,
    // stable focus, factual priority ordering and read-only calendar coverage.
    if (JarvisShell.visible(byId('tab-home'))) return refreshCommandCenter();
    return refreshShoppingLinks();
  } });
  for (const event of ['jarvis:refreshed','jarvis:view-changed']) document.addEventListener(event, refreshShoppingLinks);
  byId('logout')?.addEventListener('click', () => { generation++; pending = null; meals = undefined; readError = ''; byId('meal-shopping-links')?.remove(); });
  setInterval(refreshShoppingLinks, 60_000);
})();
