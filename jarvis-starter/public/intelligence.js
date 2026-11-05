// V4.7: Transparens for retrieval, skills og integrationsrettigheder.
let intelligenceCatalogLoaded = false;
const sourceKinds = Object.freeze({
  organizer: 'knowledge', memory: 'knowledge', claim: 'knowledge', task: 'plan',
  'personal-task': 'plan', 'follow-up': 'plan', project: 'projects',
  household: 'meals', 'household-day': 'meals', 'household-rhythm': 'meals',
  recipe: 'meals', 'meal-profile': 'meals', 'meal-plan': 'meals',
});
let sourceNavigationSequence = 0;

function sourceRequestCurrent(sequence, sourceId) {
  return sequence === sourceNavigationSequence && new URL(window.location.href).searchParams.get('source') === sourceId;
}

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
  const sequence = ++sourceNavigationSequence;
  if (typeof sourceId !== 'string' || sourceId.length > 200) return;
  const parts = sourceId.split(':');
  const kind = parts[0];
  const view = sourceKinds[kind];
  if (!view) return;
  sourceStatus(view, '');
  const householdSource = ['household', 'household-day', 'household-rhythm'].includes(kind);
  const householdDate = householdSource && parts[1] && parts[1] !== 'default' ? parts[1] : null;
  if (view === 'meals') {
    if (householdDate) {
      const parsedDate = new Date(`${householdDate}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(householdDate) || !Number.isFinite(parsedDate.getTime()) ||
          parsedDate.toISOString().slice(0, 10) !== householdDate) {
        sourceStatus(view, 'Kilden har en ugyldig dato. Ingen anden dato er åbnet, og ingen ændringer er foretaget.');
        return;
      }
      document.getElementById('meal-family-start').value = householdDate;
    }
    await refreshMeals();
    if (!sourceRequestCurrent(sequence, sourceId)) return;
    // Render the requested date after the awaited domain refresh. A synthetic
    // button click could race a second async refresh and replace the highlight.
    // showHousehold reconciles cards in place and preserves drafts on other dates.
    if (householdDate) {
      document.getElementById('meal-family-start').value = householdDate;
      showHousehold(mealData.household);
    }
  } else if (kind === 'organizer') await refreshOrganizer();
  else if (kind === 'memory') document.dispatchEvent(new CustomEvent('jarvis:memories-changed'));
  else if (kind === 'claim' || kind === 'personal-task' || kind === 'follow-up') {
    // A source card can be replaced by its async domain refresh. Highlight only
    // after the new revisioned record has rendered, not on a stale DOM node.
    const pending = [];
    document.dispatchEvent(new CustomEvent('jarvis:v5-sources-changed', {
      detail: { waitUntil: promise => pending.push(Promise.resolve(promise)) },
    }));
    await Promise.allSettled(pending);
  }
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
    household: householdDate ? `[data-household-date="${CSS.escape(householdDate)}"]` : '#meal-family-form',
    'household-day': `[data-household-date="${CSS.escape(householdDate || '')}"]`,
    'household-rhythm': `[data-household-date="${CSS.escape(householdDate || '')}"]`,
    recipe: `[data-record-key="${CSS.escape(`recipe:${parts[1] || ''}`)}"]`,
    'meal-profile': '#meal-profile-form',
    'meal-plan': `[data-record-key="${CSS.escape(`plan:${parts[1] || ''}`)}"]`,
  };
  // The reviewed-memory editor finishes its own guarded refresh asynchronously.
  let target;
  for (let attempt = 0; attempt < (['memory','claim','personal-task','follow-up'].includes(kind) ? 12 : 2); attempt++) {
    if (!sourceRequestCurrent(sequence, sourceId)) return;
    target = document.querySelector(selectors[kind]);
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  if (!sourceRequestCurrent(sequence, sourceId)) return;
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
  } else {
    sourceNavigationSequence++;
    document.querySelectorAll('.source-target').forEach(node => node.classList.remove('source-target'));
    const query = window.history?.state?.knowledgeQuery;
    if (new URL(window.location.href).searchParams.get('view') === 'knowledge' && typeof query === 'string' && query.length <= 240) {
      const input = document.getElementById('knowledge-query');
      if (input) {
        input.value = query;
        // Returning after a source-page reload restores the original local
        // search as well as the URL. This performs a read, never an editor save.
        document.getElementById('knowledge-search-form')?.requestSubmit();
      }
    }
  }
});

// A copied source URL must also work on a new page load, after login/refresh.
const initialSource = new URL(window.location.href).searchParams.get('source');
if (initialSource) {
  let opened = false;
  document.addEventListener('jarvis:refreshed', () => {
    if (opened || new URL(window.location.href).searchParams.get('source') !== initialSource) return;
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
  const labels = { connected: 'Forbundet', configured: 'Konfigureret – endnu ikke verificeret', stale: 'Forældet forbindelsesstatus',
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
    card.append(knowledgeElement('span', 'Tekniske muligheder – ikke automatisk aktive rettigheder: ' + connector.capabilities.join(' · '), 'micro muted'));
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
        history.replaceState({ ...(history.state || {}), knowledgeQuery: query }, '', window.location.href);
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
