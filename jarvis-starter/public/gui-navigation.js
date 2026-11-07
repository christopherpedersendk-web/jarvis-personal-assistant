// GUI routes are a projection of existing domains. Object IDs and unrelated
// query parameters survive the migration; this module never mutates data.
(() => {
  const mainViews = ['home', 'plan', 'smart-home', 'watches', 'shopping', 'development', 'settings'];
  const planSections = ['tasks', 'calendar', 'meals', 'notes', 'web'];
  const taskKinds = ['personal', 'agent', 'projects'];
  const settingsSections = ['profile', 'notifications', 'integrations', 'skills', 'automations', 'system', 'device'];
  const names = { home: 'Overblik', shopping: 'Indkøb', development: 'Udvikling', plan: 'Planlægning', 'smart-home': 'Hjem', watches: 'Overvågninger', settings: 'Indstillinger' };
  const sectionNames = { tasks: 'Opgaver', calendar: 'Kalender', meals: 'Madplan', notes: 'Noter og lister', web: 'Webarbejde',
    profile: 'Om dig og hukommelse', notifications: 'Notifikationer', integrations: 'Integrationer',
    skills: 'Skills', automations: 'Automatiseringer', system: 'System og opdateringer', device: 'Denne enhed' };
  const aliases = {
    tasks: { view: 'plan', section: 'tasks', kind: 'agent' },
    projects: { view: 'plan', section: 'tasks', kind: 'projects' },
    meals: { view: 'plan', section: 'meals' }, organizer: { view: 'plan', section: 'notes' },
    calendar: { view: 'plan', section: 'calendar' }, secretary: { view: 'home', attention: true },
    system: { view: 'settings', section: 'system' }, knowledge: { view: 'home', panel: 'search' },
  };
  function sourceRoute(source) {
    const type = typeof source === 'string' ? source.split(':')[0] : '';
    if (['memory', 'claim'].includes(type)) return { view: 'settings', section: 'profile' };
    if (type === 'skill') return { view: 'settings', section: 'skills' };
    if (type === 'organizer') return { view: 'plan', section: 'notes' };
    if (type === 'project') return { view: 'plan', section: 'tasks', kind: 'projects' };
    if (type === 'task') return { view: 'plan', section: 'tasks', kind: 'agent' };
    if (['personal-task', 'follow-up'].includes(type)) return { view: 'plan', section: 'tasks', kind: 'personal' };
    if (['household', 'household-day', 'household-rhythm', 'recipe', 'meal-profile', 'meal-plan', 'shopping-draft', 'nemlig-proposal'].includes(type)) return { view: 'plan', section: 'meals' };
    if (type === 'google-calendar') return { view: 'plan', section: 'calendar' };
    return null;
  }
  function resolve(view = 'home', options = {}) {
    const alias = aliases[view] || {};
    const sourceId = typeof options.sourceId === 'string' && options.sourceId.length <= (options.sourceId.startsWith('google-calendar:') ? 2000 : 300) ? options.sourceId : null;
    const target = options.preserveDestination ? null : sourceRoute(sourceId);
    const explicit = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
    const candidate = { view, ...alias, ...explicit, ...(target ? { panel: ['search', 'chat'].includes(explicit.panel) ? explicit.panel : null, ...target } : {}) };
    const main = mainViews.includes(candidate.view) ? candidate.view : 'home';
    const section = main === 'plan' ? (planSections.includes(candidate.section) ? candidate.section : 'tasks')
      : main === 'settings' ? (settingsSections.includes(candidate.section) ? candidate.section : 'profile') : null;
    const kind = main === 'plan' && section === 'tasks' ? (taskKinds.includes(candidate.kind) ? candidate.kind : 'personal') : null;
    const panel = ['search', 'chat'].includes(candidate.panel) ? candidate.panel : null;
    let legacyView = main;
    if (main === 'plan' && section === 'meals') legacyView = 'meals';
    if (main === 'plan' && section === 'notes') legacyView = 'organizer';
    if (main === 'plan' && kind === 'projects') legacyView = 'projects';
    if (main === 'settings' && section === 'profile') legacyView = 'knowledge';
    return Object.freeze({ view: main, section, kind, panel, sourceId, legacyView,
      attention: candidate.attention === true,
      title: names[main], label: [names[main], sectionNames[section]].filter(Boolean).join(' · ') });
  }
  function fromURL(value) {
    const url = new URL(value);
    return resolve(url.searchParams.get('view') || 'home', {
      section: url.searchParams.get('section') || undefined,
      kind: url.searchParams.get('kind') || undefined,
      panel: url.searchParams.get('panel') || undefined,
      sourceId: url.searchParams.get('source'),
      attention: url.searchParams.get('attention') === '1' || url.searchParams.get('view') === 'secretary',
      // Monitor sources are resolved after their existing task is read.
      preserveDestination: url.searchParams.get('view') === 'watches',
    });
  }
  function toURL(value, route) {
    const url = new URL(value);
    for (const [key, val] of Object.entries({ view: route.view, section: route.section,
      kind: route.kind, panel: route.panel, source: route.sourceId,
      attention: route.view === 'home' && route.attention ? '1' : null })) {
      if (val) url.searchParams.set(key, val); else url.searchParams.delete(key);
    }
    return url;
  }
  function context(route) {
    return { label: route.label, sourceId: route.sourceId || null,
      view: route.view, section: route.section, kind: route.kind };
  }
  globalThis.JarvisNavigation = Object.freeze({ resolve, fromURL, toURL, sourceRoute, context,
    mainViews: Object.freeze(mainViews), planSections: Object.freeze(planSections), settingsSections: Object.freeze(settingsSections) });
})();

