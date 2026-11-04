// V4.7: Transparens for retrieval, skills og integrationsrettigheder.
let intelligenceCatalogLoaded = false;

function knowledgeElement(tag, text, css) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (css) element.className = css;
  return element;
}

async function refreshIntelligenceCatalog() {
  if (intelligenceCatalogLoaded) return;
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
  const labels = { connected: 'Forbundet', configured: 'Konfigureret', not_configured: 'Ikke forbundet' };
  const policies = { 'owner-opt-in': 'Notifikationer: kun ejer og opt-in', 'approval-before-write': 'Ændringer: godkendelse påkrævet',
    'explicit-request': 'Styring: kræver konkret anmodning', 'read-only': 'Kun hændelser / læsning' };
  for (const connector of integrationsData.integrations) {
    const card = knowledgeElement('article', '', 'catalog-card');
    card.append(knowledgeElement('strong', connector.title));
    const state = connector.implementation === 'planned' ? 'Forberedt – ikke implementeret' : labels[connector.status];
    card.append(knowledgeElement('p', state, connector.status === 'connected' ? 'catalog-status good' : 'catalog-status'));
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
      button.addEventListener('click', () => selectTab(({ organizer: 'organizer', memory: 'secretary', task: 'tasks', project: 'projects', 'meal-profile': 'meals', 'meal-plan': 'meals' })[match.type] || 'secretary'));
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
