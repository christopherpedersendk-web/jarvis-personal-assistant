// V4.7: Transparens for retrieval, skills og integrationsrettigheder.
let intelligenceCatalogLoaded = false;
const sourceKinds = Object.freeze({
  organizer: 'knowledge', memory: 'knowledge', claim: 'knowledge', task: 'plan',
  'personal-task': 'plan', 'follow-up': 'plan', project: 'projects',
  household: 'meals', recipe: 'meals', 'meal-profile': 'meals', 'meal-plan': 'meals',
});

function sourceStatus(view, message) {
  const root = document.getElementById(`tab-${view}`);
  if (!root) return;
  let status = root.querySelector(':scope > .source-open-status');
  if (!status) {
    status = document.createElement('p'); status.className = 'source-open-status';
    status.setAttribute('role', 'status'); root.prepend(status);
  }
  status.textContent = message;
  status.classList.toggle('hidden', !message);
}

async function focusRecordedSource(sourceId) {
  if (typeof sourceId !== 'string' || sourceId.length > 200) return;
  const parts = sourceId.split(':');
  const kind = parts[0];
  const view = sourceKinds[kind];
  if (!view) return;
  sourceStatus(view, '');
  if (view === 'meals') {
    if (kind === 'household' && parts[1] && parts[1] !== 'default') {
      document.getElementById('meal-family-start').value = parts[1];
    }
    await refreshMeals();
    if (kind === 'household' && parts[1] !== 'default') document.getElementById('meal-family-show').click();
  } else if (kind === 'organizer') await refreshOrganizer();
  else if (kind === 'memory') document.dispatchEvent(new CustomEvent('jarvis:memories-changed'));
  else if (kind === 'claim' || kind === 'personal-task' || kind === 'follow-up')
    document.dispatchEvent(new CustomEvent('jarvis:v5-sources-changed'));
  else if (kind === 'task') await refreshTasks();
  else if (kind === 'project') await refreshProjects();

  const selectors = {
    organizer: `[data-organizer-item-id="${CSS.escape(`${parts[1]}:${parts[2]}`)}"]`,
    memory: `[data-memory-id="${CSS.escape(parts[1] || '')}"]`,
    claim: `[data-claim-id="${CSS.escape(parts[1] || '')}"]`,
    task: `[data-task-id="${CSS.escape(parts[1] || '')}"]`,
    'personal-task': `[data-personal-task-id="${CSS.escape(parts[1] || '')}"]`,
    'follow-up': `[data-follow-up-id="${CSS.escape(parts[1] || '')}"]`,
    project: `[data-project-id="${CSS.escape(parts[1] || '')}"]`,
    household: parts[1] === 'default' ? '#meal-family-form' : `[data-record-key="${CSS.escape(`family-day:${parts[1] || ''}`)}"]`,
    recipe: `[data-record-key="${CSS.escape(`recipe:${parts[1] || ''}`)}"]`,
    'meal-profile': '#meal-profile-form',
    'meal-plan': `[data-record-key="${CSS.escape(`plan:${parts[1] || ''}`)}"]`,
  };
  // The reviewed-memory editor finishes its own guarded refresh asynchronously.
  let target;
  for (let attempt = 0; attempt < (['memory','claim','personal-task','follow-up'].includes(kind) ? 12 : 2); attempt++) {
    target = document.querySelector(selectors[kind]);
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  document.querySelectorAll('.source-target').forEach(node => node.classList.remove('source-target'));
  if (!target) {
    sourceStatus(view, 'Kilden kan ikke åbnes i den aktuelle oversigt. Den kan være arkiveret, slettet eller utilgængelig. Ingen ændringer er foretaget.');
    return;
  }
  target.classList.add('source-target');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.addEventListener('jarvis:source-route', event => {
  if (event.detail?.id) {
    const view = sourceKinds[event.detail.id.split(':')[0]] || 'knowledge';
    focusRecordedSource(event.detail.id).catch(error => sourceStatus(view, `Kilden kunne ikke åbnes: ${error.message}`));
  }
});

// A copied source URL must also work on a new page load, after login/refresh.
const initialSource = new URL(window.location.href).searchParams.get('source');
if (initialSource) {
  let opened = false;
  document.addEventListener('jarvis:refreshed', () => {
    if (opened) return;
    opened = true;
    const view = sourceKinds[initialSource.split(':')[0]] || 'knowledge';
    selectTab(view, { fromHistory: true });
    focusRecordedSource(initialSource).catch(error => sourceStatus(view, `Kilden kunne ikke åbnes: ${error.message}`));
  });
}

function knowledgeElement(tag, text, css) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (css) element.className = css;
  return element;
}

async function refreshIntelligenceCatalog() {
  const [skillsData, integrationsData] = await Promise.all([api('/api/skills'), api('/api/integrations')]);
  const skillsRoot = document.getElementById('skills-catalog');
  const integrationRoot = document.getElementById('integrations-catalog');
  skillsRoot.replaceChildren();
  integrationRoot.replaceChildren();
  for (const skill of skillsData.skills) {
    const card = knowledgeElement('article', '', 'catalog-card');
    card.append(knowledgeElement('strong', skill.name), knowledgeElement('p', skill.description, 'muted small-text'),
      knowledgeElement('span', `Udløsere: ${skill.triggers.join(' · ')}`, 'micro muted'));
    skillsRoot.append(card);
  }
  const labels = { connected: 'Forbundet', configured: 'Konfigureret – endnu ikke verificeret',
    not_configured: 'Ikke forbundet', expired: 'Login udløbet', unavailable: 'Midlertidigt utilgængelig' };
  const policies = { 'owner-opt-in': 'Notifikationer: kun ejer og opt-in', 'approval-before-write': 'Ændringer: godkendelse påkrævet',
    'explicit-request': 'Styring: kræver konkret anmodning', 'read-only': 'Kun hændelser / læsning' };
  for (const connector of integrationsData.integrations) {
    const card = knowledgeElement('article', '', 'catalog-card');
    card.append(knowledgeElement('strong', connector.title));
    const state = connector.implementation === 'planned' ? 'Forberedt – ikke implementeret' : labels[connector.status];
    card.append(knowledgeElement('p', state, connector.status === 'connected' ? 'catalog-status good' : 'catalog-status'));
    if (connector.lastCheckedAt) card.append(knowledgeElement('span', `Senest kontrolleret: ${new Date(connector.lastCheckedAt).toLocaleString('da-DK')}`, 'micro muted'));
    if (connector.lastError) card.append(knowledgeElement('span', `Seneste fejl: ${connector.lastError}`, 'micro muted'));
    card.append(knowledgeElement('span', policies[connector.outboundPolicy] || 'Rettigheder afventer', 'micro muted'));
    card.append(knowledgeElement('span', connector.capabilities.join(' · '), 'micro muted'));
    integrationRoot.append(card);
  }
  intelligenceCatalogLoaded = true;
}

document.getElementById('knowledge-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const query = document.getElementById('knowledge-query').value.trim();
  const status = document.getElementById('knowledge-search-status');
  const results = document.getElementById('knowledge-results');
  status.textContent = 'Søger lokalt …';
  try {
    const data = await api('/api/knowledge/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    results.replaceChildren();
    if (!data.matches.length) results.append(knowledgeElement('p', 'Ingen direkte træffere i dine gemte kilder.', 'muted small-text'));
    for (const match of data.matches) {
      const entry = knowledgeElement('article', '', 'knowledge-result');
      entry.append(knowledgeElement('span', `${match.label} · ${match.type}${match.updatedAt ? ` · ${match.updatedAt.slice(0, 10)}` : ''}`, 'tiny-label'));
      entry.append(knowledgeElement('p', match.text));
      const button = knowledgeElement('button', 'Åbn kilde', 'secondary compact-button');
      button.type = 'button';
      button.addEventListener('click', () => {
        const view = sourceKinds[match.id.split(':')[0]] || 'knowledge';
        selectTab(view, { sourceId: match.id });
        focusRecordedSource(match.id).catch(error => sourceStatus(view, `Kilden kunne ikke åbnes: ${error.message}`));
      });
      entry.append(button);
      results.append(entry);
    }
    status.textContent = `${data.matches.length} træffer · lokal søgning · ingen eksterne modelkald`;
  } catch (error) { status.textContent = error.message; }
});

async function refreshProactiveSettings() {
  const { settings } = await api('/api/proactive');
  document.getElementById('proactive-daily').checked = settings.dailyEnabled;
  document.getElementById('proactive-weekly').checked = settings.weeklyEnabled;
  document.getElementById('proactive-discord').checked = settings.discordEnabled;
  document.getElementById('proactive-daily-time').value = settings.dailyTime;
  document.getElementById('proactive-weekly-time').value = settings.weeklyTime;
  document.getElementById('proactive-quiet-start').value = settings.quietStart;
  document.getElementById('proactive-quiet-end').value = settings.quietEnd;
  document.getElementById('proactive-status').textContent = 'Tiderne følger Europe/Copenhagen, også ved sommer-/vintertid.';
}

document.getElementById('proactive-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/proactive/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      dailyEnabled: document.getElementById('proactive-daily').checked,
      weeklyEnabled: document.getElementById('proactive-weekly').checked,
      discordEnabled: document.getElementById('proactive-discord').checked,
      dailyTime: document.getElementById('proactive-daily-time').value,
      weeklyTime: document.getElementById('proactive-weekly-time').value,
      quietStart: document.getElementById('proactive-quiet-start').value,
      quietEnd: document.getElementById('proactive-quiet-end').value,
    }) });
    document.getElementById('proactive-status').textContent = 'Indstillingerne er gemt.';
    toast('Proaktive briefinger er opdateret.');
    await refreshCommandCenter();
  } catch (error) { document.getElementById('proactive-status').textContent = error.message; }
});

document.addEventListener('jarvis:refreshed', () => {
  if (!intelligenceCatalogLoaded) refreshIntelligenceCatalog().catch(error => console.warn('Integrationskatalog:', error.message));
  if (!document.getElementById('proactive-daily-time').value) refreshProactiveSettings().catch(error => console.warn('Proaktiv status:', error.message));
});
setInterval(() => {
  if (intelligenceCatalogLoaded && !document.getElementById('tab-settings').classList.contains('hidden'))
    refreshIntelligenceCatalog().catch(error => console.warn('Integrationsstatus:', error.message));
}, 60_000);
