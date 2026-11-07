// The shell moves the original editors; their values, listeners, revisions and
// draft controllers retain identity across all destinations.
(() => {
  let navigate, routeNow, attachedContext = null, activeOverlay = null, returnFocus = null;
  let historyLayoutFrame = 0;
  const byId = id => document.getElementById(id);
  const node = (tag, text, css) => { const el = document.createElement(tag); if (text) el.textContent = text; if (css) el.className = css; return el; };
  const move = (selector, id) => { const el = document.querySelector(selector), target = byId(id); if (el && target && el !== target && !el.contains(target)) target.append(el); return el; };
  const visible = el => Boolean(el && !el.hidden && !el.closest?.('.hidden,[hidden]'));
  function scheduleHistoryLayout() {
    if (historyLayoutFrame) return;
    historyLayoutFrame = requestAnimationFrame(() => {
      historyLayoutFrame = 0;
      const host = byId('home-chat-host'), messages = byId('messages');
      const chat = messages?.closest('.chat-panel');
      if (!visible(host) || !messages || !chat || !host.contains(chat)) return;
      const log = messages.getBoundingClientRect(), panel = chat.getBoundingClientRect();
      const viewportHeight = Math.min(window.innerHeight, globalThis.visualViewport?.height || window.innerHeight);
      const navigation = window.innerWidth < 768 ? document.querySelector('.tab-nav')?.getBoundingClientRect().height || 0 : 0;
      // Budget only the scrollable history. Keep fields, feedback and Send at
      // their natural size, including wrapped text and the actual bottom bar.
      // Document coordinates prevent page scrolling from expanding the log.
      const remaining = viewportHeight - (log.top + window.scrollY) - Math.max(0, panel.bottom - log.bottom) - navigation - 16;
      const value = `${Math.max(64, Math.min(360, Math.floor(remaining)))}px`;
      if (host.style.getPropertyValue('--gui-home-history-max') !== value) host.style.setProperty('--gui-home-history-max', value);
    });
  }
  function section(id, title, parent) {
    const el = node('section', '', 'panel gui-settings-group'); el.id = id;
    if (title) el.append(node('h2', title)); byId(parent)?.append(el); return el;
  }
  function settingsGroups() {
    for (const [selector, target] of [
      ['#memory-workbench', 'settings-profile'], ['.notes-panel', 'settings-profile'],
      ['#skills-catalog', 'settings-skills'], ['#integrations-catalog', 'settings-integrations'],
      ['#proactive-form', 'settings-notifications'], ['#tab-system', 'settings-system'],
    ]) {
      const item = document.querySelector(selector);
      const el = selector.endsWith('-catalog') || selector === '#proactive-form' ? item?.closest('.panel') : item;
      if (el) byId(target)?.append(el);
    }
    for (const id of ['discord', 'sonos', 'hue', 'nest']) move(`#settings-${id}-${id === 'nest' ? 'info' : 'controls'}`, 'settings-integrations');
    move('.capabilities', 'settings-integrations');
    move('#logout', 'settings-device');
    const playbook = byId('playbook')?.closest('details'); if (playbook) byId('settings-automations')?.append(playbook);
    const push = byId('push-test')?.parentElement; if (push) byId('settings-notifications')?.append(push);
    const templates = byId('briefing-template')?.parentElement; if (templates) byId('settings-automations')?.append(templates);

    const form = byId('settings-form');
    if (!form) return;
    form.noValidate = true;
    const mapping = { automations: ['max-runs'], notifications: ['reminders-enabled', 'discord-alerts-enabled', 'push-user', 'push-token'], system: ['https-url'] };
    for (const [category, ids] of Object.entries(mapping)) {
      const group = section(`settings-fields-${category}`, ({ automations: 'Baggrundsarbejde', notifications: 'Levering og påmindelser', system: 'Serveradresse' })[category], `settings-${category}`);
      for (const id of ids) {
        const input = byId(id); if (!input) continue;
        const label = document.querySelector(`label[for="${id}"]`) || input.closest('label');
        input.setAttribute('form', 'settings-form');
        if (label) group.append(label);
        if (!label?.contains(input)) group.append(input);
      }
    }
    const actions = node('div', '', 'panel gui-save-actions'); actions.id = 'settings-common-actions';
    for (const id of ['settings-status', 'settings-draft-status', 'settings-submit', 'settings-reload']) {
      const el = byId(id); if (!el) continue;
      if (el.tagName === 'BUTTON') el.setAttribute('form', 'settings-form'); actions.append(el);
    }
    byId('settings-notifications')?.append(actions);
    form.hidden = true; // Form-associated controls keep the original submit contract.
    const original = byId('settings-general-controls'); if (original) original.classList.add('hidden');
    document.querySelector('#tab-settings > .settings-panel')?.classList.add('hidden');
  }
  function splitCalendar() {
    const form = byId('meal-google-calendar-form');
    const original = form?.closest('.panel');
    if (!original) return;
    const integration = section('calendar-integration', 'Google Kalender', 'settings-integrations');
    const info = node('p', 'Forbindelsen bruger kun læseadgang. Kalenderaftaler ændres ikke af JARVIS.', 'muted small-text');
    integration.append(info, form);
    for (const id of ['meal-google-status', 'meal-google-connect', 'meal-google-disconnect']) { const el = byId(id); if (el) integration.append(el); }
    byId('plan-calendar')?.prepend(original);
    const hint = node('p', '', 'muted small-text'), link = node('a', 'Kalenderforbindelse og valgt kalender');
    link.href = '?view=settings&section=integrations'; link.dataset.tab = 'settings'; link.dataset.settingsTab = 'integrations';
    hint.append(link); original.append(hint);
  }
  function mount(options) {
    navigate = options.navigate; routeNow = options.getRoute;
    // Native WebKit focus scrolling can place an input behind fixed mobile
    // navigation, even when scroll-margin and available page padding are set.
    // Keep a focused field in the unobscured part of the viewport.
    document.addEventListener('focusin', event => {
      const target = event.target, nav = document.querySelector('.tab-nav');
      if (!target?.matches?.('input, textarea, select, button, [tabindex]') ||
          !target.closest?.('.workspace') || target.closest('.tab-nav, .gui-overlay') ||
          !nav || getComputedStyle(nav).position !== 'fixed') return;
      const field = target.getBoundingClientRect(), bar = nav.getBoundingClientRect();
      const overlap = field.bottom + 16 - bar.top;
      if (overlap > 0 && field.top < bar.bottom) window.scrollBy(0, overlap);
    }, true);
    const home = byId('tab-home'), host = node('div'); host.id = 'home-chat-host'; home.prepend(host);
    for (const css of ['.hero-panel', '.chat-panel']) move(`#legacy-layout ${css}`, 'home-chat-host');
    for (const [css, dest] of [['.tasks-panel','plan-agent'],['.projects-panel','tab-projects'],['.code-panel','settings-system']]) move(`#legacy-layout ${css}`, dest);
    // Code proposals edit JARVIS' own files; independent user projects remain in Planning.
    const taskShell = byId('task-editor-shell'); if (taskShell) byId('tasks-editor-host')?.append(taskShell);
    move('#tab-organizer', 'plan-notes');
    const oldMeal = byId('tab-meals'); if (oldMeal && oldMeal.parentElement !== byId('tab-plan')) byId('tab-plan')?.append(oldMeal);
    settingsGroups(); splitCalendar();
    // Secondary meal tools stay available without extending the daily overview.
    for (const section of [...(byId('tab-meals')?.children || [])].slice(1)) {
      if (!section.classList.contains('panel')) continue;
      const disclosure = node('details', '', 'gui-disclosure meal-secondary-section');
      disclosure.append(node('summary', section.querySelector('h2')?.textContent || 'Flere madværktøjer'));
      section.replaceWith(disclosure); disclosure.append(section);
    }
    const approvals = node('details', '', 'gui-disclosure home-approvals'); approvals.id = 'home-approvals';
    approvals.append(node('summary', 'Indbakke og godkendelser'));
    const secretary = document.querySelector('#legacy-layout .secretary-panel');
    if (secretary) { approvals.append(secretary); home.append(approvals); }
    // Technical metrics are accessible in System, not a second home dashboard.
    for (const id of ['home-system-health','home-overview']) move(`#${id}`, 'settings-system');
    move('#home-smart-home', 'tab-smart-home');
    const date = byId('today-date'); if (date) date.textContent = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Copenhagen' }).format(new Date());
    const chat = document.querySelector('.chat-panel'); if (chat) chat.classList.add('chat-empty');
    if (chat && !byId('chat-readiness')) { const readiness = node('p', '', 'source-open-status hidden'); readiness.id = 'chat-readiness'; readiness.setAttribute('role', 'status'); chat.prepend(readiness); }

    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[data-tab],a[data-plan-tab],button[data-plan-tab],a[data-task-filter],button[data-task-filter],a[data-settings-tab],button[data-settings-tab]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      if (link.dataset.planTab) navigate('plan', { section: link.dataset.planTab });
      else if (link.dataset.taskFilter) navigate('plan', { section: 'tasks', kind: link.dataset.taskFilter });
      else if (link.dataset.settingsTab) navigate('settings', { section: link.dataset.settingsTab });
      else navigate(link.dataset.tab);
    });
    byId('global-search-open')?.addEventListener('click', () => open('search'));
    byId('global-chat-open')?.addEventListener('click', () => {
      if (routeNow()?.view === 'home') { byId('message')?.focus(); return; } open('chat');
    });
    byId('global-search-close')?.addEventListener('click', close);
    byId('global-chat-close')?.addEventListener('click', close);
    byId('chat-attach-context')?.addEventListener('click', () => {
      setContext(JarvisNavigation.context(routeNow())); document.dispatchEvent(new CustomEvent('jarvis:chat-context-change'));
    });
    byId('chat-context-clear')?.addEventListener('click', () => {
      setContext(null); document.dispatchEvent(new CustomEvent('jarvis:chat-context-change'));
    });
    document.addEventListener('keydown', event => {
      if (!activeOverlay) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const candidates = [...activeOverlay.querySelectorAll('a[href],button,input,textarea,select,[tabindex="0"]')].filter(el => !el.disabled && visible(el) && el.getClientRects().length);
      if (!candidates.length) { event.preventDefault(); activeOverlay.focus(); return; }
      const first = candidates[0], last = candidates[candidates.length - 1];
      if (event.shiftKey && (document.activeElement === first || !activeOverlay.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !activeOverlay.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    byId('logout')?.addEventListener('click', () => { overlay(null); setContext(null); });
    globalThis.visualViewport?.addEventListener('resize', () => {
      document.documentElement.style.setProperty('--gui-viewport-height', `${globalThis.visualViewport.height}px`);
      scheduleHistoryLayout();
    });
    window.addEventListener('resize', scheduleHistoryLayout);
    document.addEventListener('jarvis:refreshed', scheduleHistoryLayout);
    if (globalThis.ResizeObserver) {
      const historyResize = new ResizeObserver(scheduleHistoryLayout);
      historyResize.observe(home);
      historyResize.observe(host);
      if (chat) historyResize.observe(chat);
    }
    scheduleHistoryLayout();
  }
  function open(panel) {
    const route = routeNow(); navigate(route.view, { ...route, panel, preserveDestination: true });
  }
  function close() {
    const route = routeNow(); navigate(route.view, { ...route, panel: null, replace: true, preserveDestination: true });
  }
  function overlay(panel) {
    const next = panel === 'search' ? byId('tab-knowledge') : panel === 'chat' ? byId('global-chat-panel') : null;
    if (next === activeOverlay) return;
    const previous = activeOverlay;
    if (!previous && next) returnFocus = document.activeElement;
    previous?.classList.add('hidden');
    if (previous?.id === 'global-chat-panel') move('#global-chat-content .chat-panel', 'home-chat-host');
    activeOverlay = next;
    document.body.classList.toggle('gui-overlay-open', Boolean(next));
    if (next) {
      if (panel === 'chat') move('#home-chat-host .chat-panel', 'global-chat-content');
      next.classList.remove('hidden'); next.tabIndex = -1;
      setTimeout(() => { if (activeOverlay === next) (byId(panel === 'search' ? 'knowledge-query' : 'message') || next).focus(); }, 0);
    } else if (returnFocus?.isConnected && visible(returnFocus)) returnFocus.focus();
  }
  function apply(route) {
    for (const view of JarvisNavigation.mainViews) byId(`tab-${view}`)?.classList.toggle('hidden', view !== route.view);
    for (const [section, id] of Object.entries({ tasks: 'plan-tasks', calendar: 'plan-calendar', meals: 'tab-meals', notes: 'plan-notes', web: 'plan-web' }))
      byId(id)?.classList.toggle('hidden', route.view !== 'plan' || section !== route.section);
    for (const [kind, id] of Object.entries({ personal: 'plan-personal', agent: 'plan-agent', projects: 'tab-projects' }))
      byId(id)?.classList.toggle('hidden', route.view !== 'plan' || route.section !== 'tasks' || route.kind !== kind);
    for (const section of JarvisNavigation.settingsSections) byId(`settings-${section}`)?.classList.toggle('hidden', route.view !== 'settings' || route.section !== section);
    const active = (selector, chosen) => document.querySelectorAll(selector).forEach(el => {
      const yes = chosen(el); el.classList.toggle('active', yes);
      if (yes) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(yes));
    });
    active('.tab-nav [data-tab],.settings-nav-link,[data-main-settings]', el => el.dataset.tab === route.view);
    active('[data-plan-tab]', el => route.view === 'plan' && el.dataset.planTab === route.section);
    active('[data-task-filter]', el => route.view === 'plan' && route.section === 'tasks' && el.dataset.taskFilter === route.kind);
    active('[data-settings-tab]', el => route.view === 'settings' && el.dataset.settingsTab === route.section);
    const scopes = { automations: 'maxRunsPerDay', notifications: 'remindersEnabled,discordAlertsEnabled,pushUser,pushToken', system: 'httpsUrl' };
    if (route.view === 'settings' && scopes[route.section]) {
      byId('settings-form').dataset.scopeFields = scopes[route.section];
      move('#settings-common-actions', `settings-${route.section}`);
      byId('settings-submit').textContent = `Gem ${route.section === 'automations' ? 'kørselsgrænse' : route.section === 'system' ? 'serveradresse' : 'leveringsindstillinger'}`;
    }
    if (route.attention) { const details = byId('home-approvals'); if (details) details.open = true; }
    overlay(route.panel);
    scheduleHistoryLayout();
    const attach = byId('chat-attach-context'); if (attach) attach.title = `Vedhæft ${route.label}${route.sourceId ? ' · ' + route.sourceId : ''}`;
  }
  function setContext(value) {
    attachedContext = JarvisChat.normalizeContext(value);
    byId('chat-context-strip')?.classList.toggle('hidden', !attachedContext);
    const label = byId('chat-context-label'); if (label) label.textContent = attachedContext
      ? `${attachedContext.label}${attachedContext.sourceId ? ` · ${attachedContext.sourceId}` : ' · hele siden'}` : 'Ingen vedhæftet kontekst';
    const clear = byId('chat-context-clear'); if (clear) clear.hidden = !attachedContext;
    scheduleHistoryLayout();
  }
  function openJobEditor(category) {
    navigate(category === 'monitor' ? 'watches' : 'plan', { section: 'tasks', kind: 'agent' });
    move('#task-editor-shell', category === 'monitor' ? 'watches-editor-host' : 'tasks-editor-host');
    const shell = byId('task-editor-shell'); if (shell) shell.open = true;
    if (byId('task-editor-summary')) byId('task-editor-summary').textContent = category === 'monitor' ? 'Overvågningens instruktion og kørsel' : 'Agentopgavens instruktion og kørsel';
  }
  globalThis.JarvisShell = Object.freeze({ mount, apply, open, close, visible, openJobEditor,
    getContext: () => attachedContext, setContext });
})();
