// Kildebaseret retrieval, præcise skill-versioner og integrationsrettigheder.
const sourceKinds = Object.freeze({
  organizer: 'knowledge', memory: 'knowledge', claim: 'knowledge', skill: 'knowledge', task: 'plan',
  'personal-task': 'plan', 'follow-up': 'plan', project: 'projects',
  household: 'meals', 'household-day': 'meals', 'household-rhythm': 'meals',
  recipe: 'meals', 'meal-profile': 'meals', 'meal-plan': 'meals', 'shopping-draft': 'meals',
  'google-calendar': 'home', 'nemlig-proposal': 'meals',
});
let sourceNavigationSequence = 0;

function sourceRequestCurrent(sequence, sourceId) {
  return sequence === sourceNavigationSequence && new URL(window.location.href).searchParams.get('source') === sourceId;
}

function sourceStatus(view, message) {
  const route = typeof JarvisNavigation === 'object' ? JarvisNavigation.fromURL(window.location.href) : null;
  const root = document.getElementById(`tab-${route?.view || view}`);
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
  if (typeof sourceId !== 'string' || sourceId.length > (sourceId.startsWith('google-calendar:') ? 2000 : 200)) return;
  const parts = sourceId.split(':');
  const kind = parts[0];
  const view = sourceKinds[kind];
  if (!view) return;
  sourceStatus(view, '');
  if (kind === 'google-calendar') {
    let valid = false;
    try {
      const calendarId = decodeURIComponent(parts[1] || ''), date = parts[2] || '';
      const eventId = decodeURIComponent(parts[3] || ''), fetchedAt = decodeURIComponent(parts[4] || '');
      const instant = new Date(`${date}T12:00:00Z`);
      valid = parts.length === 5 && calendarId.length > 0 && calendarId.length <= 500 && eventId.length > 0 && eventId.length <= 1024
        && !/[\u0000-\u001f\u007f]/.test(calendarId + eventId)
        && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date
        && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(fetchedAt) && Number.isFinite(Date.parse(fetchedAt));
    } catch { /* Malformed URI components are data, never a guessed source. */ }
    if (!valid) {
      sourceStatus(view, 'Kalenderkilden mangler en præcis kalender, gyldig dato, aftale eller cacheversion. Ingen anden kilde er åbnet.');
      return;
    }
    if (typeof window.openRecordedCalendarSource !== 'function') throw new Error('Kalenderkildens lokale visning er ikke tilgængelig.');
    const opened = await window.openRecordedCalendarSource(sourceId, { isCurrent: () => sourceRequestCurrent(sequence, sourceId) });
    if (!sourceRequestCurrent(sequence, sourceId)) return;
    if (opened !== true) {
      sourceStatus(view, 'Den præcise kalenderkilde er ikke længere i den lokale cache. Ingen anden aftale eller ny Google-læsning er brugt.');
      return;
    }
  }
  const householdSource = ['household', 'household-day', 'household-rhythm'].includes(kind);
  const householdDate = householdSource && parts[1] && parts[1] !== 'default' ? parts[1] : null;
  const mealDate = kind === 'meal-plan' && parts[2] ? parts[2] : null;
  if (mealDate) {
    const parsed = new Date(`${mealDate}T12:00:00Z`);
    if (parts.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(mealDate) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== mealDate) {
      sourceStatus(view, 'Kilden har en ugyldig dato. Ingen anden dato er åbnet, og ingen ændringer er foretaget.');
      return;
    }
  }
  if (kind === 'shopping-draft' && (parts.length !== 3 || !parts[1] || !parts[2])) {
    sourceStatus(view, 'Kilden mangler det præcise indkøbsforslag eller linje-ID. Ingen anden vare er åbnet.');
    return;
  }
  if (kind === 'nemlig-proposal' && (parts.length !== 2 || !/^[a-zA-Z0-9_-]{1,100}$/.test(parts[1] || ''))) {
    sourceStatus(view, 'Kilden mangler det præcise kurvforslag. Ingen anden kilde er åbnet.');
    return;
  }
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
    // Price provenance is a local draft read, not product refresh, selection,
    // approval or basket activity. Exact older sources are retained by the
    // bounded domain renderer without discarding another card's draft.
    if (kind === 'nemlig-proposal') await refreshNemlig();
    else if (kind === 'shopping-draft') await refreshShoppingDrafts();
    else await refreshMeals();
    if (!sourceRequestCurrent(sequence, sourceId)) return;
    // Render the requested date after the awaited domain refresh. A synthetic
    // button click could race a second async refresh and replace the highlight.
    // showHousehold reconciles cards in place and preserves drafts on other dates.
    if (householdDate) {
      document.getElementById('meal-family-start').value = householdDate;
      showHousehold(mealData.household);
    }
  } else if (kind === 'skill') {
    if (parts.length !== 3) throw new Error('Kildelinket mangler et præcist skill-ID og versionsnummer.');
    await refreshIntelligenceCatalog({ skillId: parts[1], skillVersion: parts[2] });
  }
  else if (kind === 'organizer') await refreshOrganizer();
  else if (kind === 'memory') {
    const pending = [];
    document.dispatchEvent(new CustomEvent('jarvis:memories-changed', {
      detail: { sourceId, waitUntil: promise => pending.push(Promise.resolve(promise)) },
    }));
    await Promise.allSettled(pending);
  }
  else if (kind === 'claim' || kind === 'personal-task' || kind === 'follow-up') {
    // A source card can be replaced by its async domain refresh. Highlight only
    // after the new revisioned record has rendered, not on a stale DOM node.
    const pending = [];
    document.dispatchEvent(new CustomEvent('jarvis:v5-sources-changed', {
      detail: { sourceId, waitUntil: promise => pending.push(Promise.resolve(promise)) },
    }));
    await Promise.allSettled(pending);
  }
  else if (kind === 'task') {
    await refreshTasks();
    if (sourceRequestCurrent(sequence, sourceId) && typeof currentTaskRecords !== 'undefined' && currentTaskRecords.find(task => task.id === parts[1])?.category === 'monitor') {
      selectTab('watches', { sourceId, replace: true, preserveDestination: true });
      // A previous active/paused filter must not conceal an exact source link.
      if (typeof watches !== 'undefined') watches.open(parts[1]);
    }
  }
  else if (kind === 'project') await refreshProjects();

  const selectors = {
    organizer: `[data-organizer-item-id="${CSS.escape(`${parts[1]}:${parts[2]}`)}"]`,
    memory: `[data-memory-id="${CSS.escape(parts[1] || '')}"]`,
    claim: `[data-claim-id="${CSS.escape(parts[1] || '')}"]`,
    skill: `[data-skill-id="${CSS.escape(parts[1] || '')}"][data-skill-version="${CSS.escape(parts[2] || '')}"]`,
    task: `[data-task-id="${CSS.escape(parts[1] || '')}"]`,
    'personal-task': `[data-personal-task-id="${CSS.escape(parts[1] || '')}"]`,
    'follow-up': `[data-follow-up-id="${CSS.escape(parts[1] || '')}"]`,
    project: `[data-project-id="${CSS.escape(parts[1] || '')}"]`,
    household: householdDate ? `[data-household-date="${CSS.escape(householdDate)}"]` : '#meal-family-form',
    'household-day': `[data-household-date="${CSS.escape(householdDate || '')}"]`,
    'household-rhythm': `[data-household-date="${CSS.escape(householdDate || '')}"]`,
    recipe: `[data-record-key="${CSS.escape(`recipe:${parts[1] || ''}`)}"]`,
    'meal-profile': '#meal-profile-form',
    'meal-plan': `[data-record-key="${CSS.escape(`plan:${parts[1] || ''}`)}"]${mealDate ? ` [data-meal-date="${CSS.escape(mealDate)}"]` : ''}`,
    'shopping-draft': `[data-record-key="${CSS.escape(`shopping-draft:${parts[1] || ''}`)}"] [data-shopping-line-id="${CSS.escape(parts[2] || '')}"]`,
    'google-calendar': `[data-calendar-source-id="${CSS.escape(sourceId)}"]`,
    'nemlig-proposal': `[data-record-key="${CSS.escape(`nemlig-proposal:${parts[1] || ''}`)}"]`,
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
  // Source links open the original editor even when creation/details are folded.
  for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
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
  }
  restoreSearchQuery();
});

function restoreSearchQuery() {
  const query = window.history?.state?.knowledgeQuery, url = new URL(window.location.href);
  if ((url.searchParams.get('view') === 'knowledge' || url.searchParams.get('panel') === 'search') && typeof query === 'string' && query.length <= 240) {
    const input = document.getElementById('knowledge-query');
    if (input) { input.value = query; document.getElementById('knowledge-search-form')?.requestSubmit(); }
  }
}

let initialSearchRestored = false;
document.addEventListener('jarvis:refreshed', () => {
  if (!initialSearchRestored) { initialSearchRestored = true; restoreSearchQuery(); }
});

document.getElementById('logout')?.addEventListener('click', () => {
  sourceNavigationSequence++;
  document.querySelectorAll('.source-target').forEach(node => node.classList.remove('source-target'));
});

// A copied source URL must also work on a new page load, after login/refresh.
const initialSource = new URL(window.location.href).searchParams.get('source');
if (initialSource) {
  let opened = false;
  document.addEventListener('jarvis:refreshed', () => {
    if (opened || new URL(window.location.href).searchParams.get('source') !== initialSource) return;
    opened = true;
    const view = sourceKinds[initialSource.split(':')[0]] || 'knowledge';
    selectTab(view, { fromHistory: true, sourceId: initialSource });
    focusRecordedSource(initialSource).catch(error => sourceStatus(view, `Kilden kunne ikke åbnes: ${error.message}`));
  });
}

function knowledgeElement(tag, text, css) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (css) element.className = css;
  return element;
}

function createIntelligenceCatalog({ document, api, getToken, now = () => Date.now(), openSource = () => {}, trySkill = () => {} }) {
  const node = (tag, text = '', css = '') => { const value = document.createElement(tag); value.textContent = text;
    if (css) value.className = css; return value; };
  const write = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  const byId = id => document.getElementById(id), keyOf = skill => `${skill.name}:${skill.version}`;
  const slots = Object.fromEntries(['skills', 'integrations'].map(kind => [kind,
    { rows: [], cards: new Map(), loaded: false, loadedAt: 0, pending: null, error: '' }]));
  const details = new Map(), detailPending = new Map();
  let owner = '', generation = 0;
  const visible = kind => {
    const target = byId(kind === 'skills' ? 'settings-skills' : 'settings-integrations') || byId(kind === 'skills' ? 'tab-knowledge' : 'tab-settings');
    return !document.hidden && !byId('workspace')?.classList.contains('hidden') && (typeof JarvisShell === 'object' ? JarvisShell.visible(target) : !target?.classList.contains('hidden'));
  };
  const status = (kind, text) => { const target = byId(`${kind}-catalog-status`); if (target) write(target, text); };
  function reset() {
    generation++; owner = ''; details.clear(); detailPending.clear();
    for(const id of ['skills-query','skills-source','skills-category','skills-state']) if(byId(id)) byId(id).value='';
    if(byId('skills-filter-status'))write(byId('skills-filter-status'),'');
    for (const [kind, slot] of Object.entries(slots)) {
      slot.rows = []; slot.cards.clear(); slot.loaded = false; slot.loadedAt = 0; slot.pending = null; slot.error = '';
      byId(`${kind}-catalog`).replaceChildren(); status(kind, '');
    }
  }
  function session() {
    const current = getToken() || '';
    if (owner !== current) { reset(); owner = current; }
    return current;
  }
  const current = (captured, epoch) => captured && captured === getToken() && captured === owner && epoch === generation;

  function skillCard(skill) {
    const card = node('article', '', 'catalog-card');
    card.dataset.skillId = skill.name; card.dataset.skillVersion = skill.version;
    const heading = node('strong'), description = node('p', '', 'muted small-text'), triggers = node('span', '', 'micro muted');
    const binding = node('p', '', 'micro'), unavailable = node('p', '', 'micro v5-conflict');
    unavailable.setAttribute('role','status');
    const disclosure = node('details'), summary = node('summary', 'Læs den præcise procedure');
    const message = node('p', 'Procedureteksten hentes lokalt, når du åbner den.', 'micro'); message.setAttribute('role', 'status');
    const body = node('pre', '', 'skill-procedure');
    const metadata=node('details'), metadataSummary=node('summary','Data, rettigheder og tilgængelighed');
    const metadataBody=node('p','','skill-metadata'), availability=node('p','','micro');
    metadata.append(metadataSummary,metadataBody);
    const trial=node('button','Prøv skill','secondary compact-button'); trial.type='button';
    trial.addEventListener('click',()=>{
      const record=slots.skills.rows.find(item=>keyOf(item)===keyOf(skill));
      if(!session() || !record || record.current!==true || !record.availability?.available)return;
      if(slotExpired()){write(unavailable,'Katalogets status er forældet. Hent kataloget igen, før du vælger eksemplet.');return;}
      try{trySkill(record);write(unavailable,'Eksemplet er åbnet som kladde. Tilpas det og send selv.');}catch(error){write(unavailable,error.message);}
    });
    const link = node('a', 'Åbn denne version som kilde');
    const sourceId = `skill:${skill.name}:${skill.version}`;
    link.href = `?view=knowledge&source=${encodeURIComponent(sourceId)}`;
    link.addEventListener('click', event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); openSource(sourceId);
    });
    disclosure.append(summary, triggers, binding,
      node('span', 'Proceduren giver ingen nye tilladelser, datakilder eller modtagere. Jobbets gennemgåede politik gælder.', 'micro muted'), message, body);
    disclosure.addEventListener('toggle', () => { if (disclosure.open) loadDetail(skill.name, skill.version).catch(() => {}); });
    card.append(heading, description, availability, metadata, trial, disclosure, link, unavailable);
    card.catalogParts = { heading, description, triggers, binding, unavailable, disclosure, message, body, availability, metadataBody, trial };
    return card;
  }
  const slotExpired=()=>!slots.skills.loaded||Boolean(slots.skills.error)||now()-slots.skills.loadedAt>=60_000;
  function filterSkills() {
    const query=(byId('skills-query')?.value||'').trim().toLocaleLowerCase('da-DK');
    let count=0;
    for(const record of slots.skills.rows){
      const card=slots.skills.cards.get(keyOf(record));if(!card)continue;
      const match=(!query||[record.name,record.title,record.description,...(record.examples||[])].join(' ').toLocaleLowerCase('da-DK').includes(query))&&
        ['source','category'].every(field=>!byId(`skills-${field}`)?.value||byId(`skills-${field}`).value===record[field])&&
        (!byId('skills-state')?.value||byId('skills-state').value===record.availability?.status);
      card.hidden=!match;if(match)count++;
    }
    if(byId('skills-filter-status'))write(byId('skills-filter-status'),`${count} af ${slots.skills.rows.length} versioner`);
  }
  function connectorCard(connector) {
    const card = node('article', '', 'catalog-card'); card.dataset.integrationId = connector.id;
    const parts = { heading: node('strong'), state: node('p', '', 'catalog-status'), checked: node('span', '', 'micro muted'),
      error: node('span', '', 'micro muted'), policy: node('span', '', 'micro muted'), capabilities: node('span', '', 'micro muted'),
      unavailable: node('p', '', 'micro v5-conflict') };
    card.append(...Object.values(parts)); card.catalogParts = parts; return card;
  }
  function render(kind) {
    if (!visible(kind)) return;
    const slot = slots[kind], root = byId(`${kind}-catalog`), keep = new Set();
    const labels = { connected: 'Forbundet', configured: 'Konfigureret – endnu ikke verificeret', stale: 'Forældet forbindelsesstatus',
      not_configured: 'Ikke konfigureret', expired: 'Login udløbet', unavailable: 'Midlertidigt utilgængelig', disabled: 'Deaktiveret' };
    const policies = { 'owner-opt-in': 'Notifikationer: kun ejer og opt-in', 'approval-before-write': 'Ændringer: godkendelse påkrævet',
      'explicit-request': 'Styring: kræver konkret anmodning', 'read-only': 'Kun hændelser / læsning' };
    for (const record of slot.rows) {
      const key = kind === 'skills' ? keyOf(record) : record.id; keep.add(key);
      let card = slot.cards.get(key);
      if (!card) { card = kind === 'skills' ? skillCard(record) : connectorCard(record); slot.cards.set(key, card); root.append(card); }
      const parts = card.catalogParts; write(parts.unavailable, ''); delete card.dataset.catalogUnavailable;
      if (kind === 'skills') {
        write(parts.heading, `${record.title||record.name} · version ${record.version}${record.current === true ? ' · Aktuel' : record.current === false ? ' · Historisk' : ''}`); write(parts.description, record.description || '');
        const availability=record.availability;
        write(parts.availability,availability?`${record.source==='openclaw'?'OpenClaw':'Jarvis'} · ${availability.available?'Klar til anmodning':availability.reason} · Liveaccept: ${availability.tested?'Dokumenteret':'Ikke dokumenteret'}`:'Tilgængelighed er ikke dokumenteret.');
        parts.trial.disabled=!record.current||!availability?.available||!record.examples?.length||slotExpired();
        write(parts.metadataBody,[
          `Procedure installeret: ${availability?.installed?'ja':'ukendt'} · Konfigureret: ${availability?.configured?'ja':'nej'} · Aktiveret: ${availability?.enabled?'ja':'nej'}`,
          `Seneste liveprøve: ${availability?.lastTest||'Ingen dokumenteret'} · Forbindelseskontrol: ${availability?.connectionCheckedAt||'Ikke udført'}`,
          `Kanaler: ${(record.channels||[]).join(', ')}`,
          `Datadeling: ${record.dataSharing||'Se procedure'}`,
          `Afhængigheder: ${(record.dependencies||[]).join('; ')}`,
          `Grænser: ${record.limits||'Jobbets gennemgåede politik'}`,
          `Rettigheder: ${record.permissions}`,
          `Oprindelse: ${record.provenance?.product||'Jarvis'} ${record.provenance?.version||''} ${record.provenance?.commit||''}. ${record.provenance?.integration||''}`,
          `Input: ${(record.inputs||[]).join(' ')}`, `Output: ${(record.outputs||[]).join(' ')}`,
          `Eksempler: ${(record.examples||[]).join(' • ')}`].join('\n\n'));
        write(parts.triggers, `Udløsere: ${(record.triggers || []).join(' · ')}`);
        write(parts.binding, `Indholdshash: ${record.contentHash || 'Ikke dokumenteret'}. Sammenlign med jobbets faktiske kørselsgrundlag.`);
        if (details.has(key) && record.contentHash && details.get(key).contentHash !== record.contentHash) {
          details.delete(key); write(parts.message, 'Denne version har et ændret indholdshash. Gennemgå proceduren igen; et job opgraderes ikke automatisk.');
          write(parts.body, '');
          if (parts.disclosure.open) loadDetail(record.name, record.version).catch(() => {});
        }
      } else {
        write(parts.heading, record.title || record.id);
        write(parts.state, record.implementation === 'planned' ? 'Forberedt – ikke implementeret' : labels[record.status] || 'Status ukendt');
        parts.state.classList.toggle('good', record.status === 'connected');
        write(parts.checked, record.lastCheckedAt ? `Senest kontrolleret: ${new Date(record.lastCheckedAt).toLocaleString('da-DK')}` : 'Tidspunkt for forbindelseskontrol: ukendt');
        write(parts.error, record.lastError ? `Seneste fejl: ${record.lastError}` : '');
        write(parts.policy, policies[record.outboundPolicy] || 'Rettigheder afventer');
        write(parts.capabilities, 'Tekniske muligheder – ikke automatisk aktive rettigheder: ' + (record.capabilities || []).join(' · '));
      }
    }
    if(kind==='skills')filterSkills();
    for (const [key, card] of slot.cards) if (!keep.has(key)) {
      if (card.contains(document.activeElement)) {
        card.dataset.catalogUnavailable = 'true';
        write(card.catalogParts.unavailable, 'Denne kilde er ikke længere i det aktuelle katalog. Den fokuserede visning bevares, men må ikke bruges som et nyt godkendelsesgrundlag.');
      } else { card.remove(); slot.cards.delete(key); }
    }
  }
  async function load(kind, force = false) {
    const captured = session(), epoch = generation; if (!captured) return;
    const slot = slots[kind];
    if (slot.pending) return slot.pending;
    if (!force && slot.loaded && now() - slot.loadedAt < 60_000) { render(kind); return; }
    status(kind, 'Henter lokalt katalog …');
    const pending = (async () => {
      try {
        const response = await api(`/api/${kind}`);
        if (!current(captured, epoch)) return;
        if (!Array.isArray(response?.[kind])) throw new Error('Katalogsvaret mangler sine poster.');
        slot.rows = response[kind]; slot.loaded = true; slot.loadedAt = now(); slot.error = '';
        render(kind); status(kind, `${slot.rows.length} ${kind === 'skills' ? 'gennemgåede procedureversioner' : 'forbindelser'} · lokal læsning · ingen aktivering`);
      } catch (error) {
        if (!current(captured, epoch)) return;
        slot.error = String(error.message || 'Ukendt fejl');
        if(kind==='skills')for(const card of slot.cards.values())card.catalogParts.trial.disabled=true;
        status(kind, `Kataloget kunne ikke opdateres: ${slot.error}. Tidligere visning bevares; kontrollér status før brug.`);
        throw error;
      } finally { if (slot.pending === pending) slot.pending = null; }
    })();
    slot.pending = pending; return pending;
  }
  async function loadDetail(id, version, { open = false } = {}) {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(id || '') || typeof version !== 'string' || version.length > 32 || !/^\d+\.\d+\.\d+$/.test(version))
      throw new Error('Kildelinket skal indeholde præcist skill-ID og versionsnummer.');
    const captured = session(), epoch = generation; if (!captured) return;
    const key = `${id}:${version}`, card = slots.skills.cards.get(key);
    if (!slots.skills.rows.some(item => keyOf(item) === key)) {
      const error = new Error('Denne præcise skill-version findes ikke i det aktuelle katalog. Ingen anden version er åbnet.');
      error.code = 'SKILL_NOT_FOUND'; error.status = 404;
      if (card) write(card.catalogParts.message, error.message);
      throw error;
    }
    const show = value => {
      if (!current(captured, epoch)) return;
      const target = slots.skills.cards.get(key);
      if (!target) throw new Error('Denne præcise version er ikke i den aktuelle lokale oversigt.');
      write(target.catalogParts.message, `Præcis version ${value.version} · hash ${value.contentHash} · kun læsning${value.current === false ? ' · Historisk version; eksisterende jobbinding er bevaret.' : value.contract ? ' · Fuld procedurekontrakt med eksempler og testgrundlag.' : ''}`);
      write(target.catalogParts.body, value.body);
      if (open) target.catalogParts.disclosure.open = true;
      return value;
    };
    if (details.has(key)) return show(details.get(key));
    if (detailPending.has(key)) return show(await detailPending.get(key));
    if (card) write(card.catalogParts.message, 'Henter den præcise lokale procedureversion …');
    const pending = (async () => {
      try {
        const { skill } = await api(`/api/skills/${encodeURIComponent(id)}/${encodeURIComponent(version)}`);
        if (!current(captured, epoch)) return;
        if (skill?.name !== id || skill?.version !== version || typeof skill.body !== 'string' || skill.body.length > 8500 ||
            !/^[0-9a-f]{64}$/.test(skill.contentHash || '')) throw new Error('Svaret matcher ikke den præcise procedureversion og dens hash.');
        const listed = slots.skills.rows.find(item => keyOf(item) === key);
        if (listed?.contentHash && listed.contentHash !== skill.contentHash) throw new Error('Indholdshash er ændret. Opdater kataloget og gennemgå versionen igen.');
        details.set(key, skill); return skill;
      } catch (error) {
        if (!current(captured, epoch)) return;
        if (card) write(card.catalogParts.message,
          `Proceduren kunne ikke åbnes: ${error.message}. Ingen anden version er brugt.`);
        throw error;
      } finally { if (detailPending.get(key) === pending) detailPending.delete(key); }
    })();
    detailPending.set(key, pending);
    const detail = await pending; if (detail) return show(detail);
  }
  async function refresh({ skillId, skillVersion, force = false, kind } = {}) {
    if (!session()) return;
    if (skillId || skillVersion) {
      for(const id of ['skills-query','skills-source','skills-category','skills-state'])if(byId(id))byId(id).value='';
      await load('skills', force);
      return loadDetail(skillId, skillVersion, { open: true });
    }
    await Promise.all(Object.keys(slots).filter(name => (!kind || kind === name) && visible(name)).map(name => load(name, force)));
  }
  for (const kind of Object.keys(slots)) byId(`${kind}-catalog-refresh`)?.addEventListener('click', () => refresh({ kind, force: true }).catch(() => {}));
  for(const id of ['skills-query','skills-source','skills-category','skills-state'])byId(id)?.addEventListener('input',filterSkills);
  return Object.freeze({ refresh, reset });
}

const intelligenceCatalog = createIntelligenceCatalog({ document, api, getToken: () => token,
  trySkill: record => {
    const field=document.getElementById('message');
    if(!token||document.getElementById('send').disabled)throw new Error('Samtalen er optaget, stoppet eller afventer gennemgang. Din kladde er bevaret.');
    if(field.value.trim())throw new Error('Du har allerede en kladde i samtalen. Send eller ryd den, før du vælger et eksempel.');
    const example=record.examples?.[0];if(typeof example!=='string'||example.length>1500)throw new Error('Intet gyldigt eksempel.');
    JarvisShell.setContext(null);selectTab('home');
    field.value=`Brug ${record.name} version ${record.version}: ${example}`;
    field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();
  },
  openSource: sourceId => { selectTab('knowledge', { sourceId });
    focusRecordedSource(sourceId).catch(error => sourceStatus('knowledge', `Kilden kunne ikke åbnes: ${error.message}`)); } });
async function refreshIntelligenceCatalog(options) { return intelligenceCatalog.refresh(options); }

let knowledgeSearchSequence = 0;
document.getElementById('knowledge-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const query = document.getElementById('knowledge-query').value.trim();
  const sequence = ++knowledgeSearchSequence, owner = token;
  const current = () => owner && owner === token && sequence === knowledgeSearchSequence;
  const status = document.getElementById('knowledge-search-status');
  const results = document.getElementById('knowledge-results');
  history.replaceState({ ...(history.state || {}), knowledgeQuery: query }, '', window.location.href);
  status.textContent = 'Søger lokalt …';
  try {
    const data = await api('/api/knowledge/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    if (!current()) return;
    results.replaceChildren();
    if (!data.matches.length) results.append(knowledgeElement('p', 'Ingen direkte træffere i dine gemte kilder.', 'muted small-text'));
    for (const match of data.matches) {
      const entry = knowledgeElement('article', '', 'knowledge-result');
      const typeLabel = ({ memory: 'Hukommelse', claim: 'Oplysning', organizer: 'Note eller liste', task: 'Agentopgave', 'personal-task': 'Opgave', 'follow-up': 'Opfølgning', project: 'Kodeprojekt', skill: 'Arbejdsgang', recipe: 'Opskrift', 'meal-plan': 'Madplan', household: 'Husstand' })[match.type] || 'Gemt kilde';
      entry.append(knowledgeElement('span', `${match.label} · ${typeLabel}${Number.isFinite(Date.parse(match.updatedAt)) ? ` · ${new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium', timeZone: 'Europe/Copenhagen' }).format(new Date(match.updatedAt))}` : ''}`, 'tiny-label'));
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
  } catch (error) { if (current()) status.textContent = `Søgningen mislykkedes: ${error.message}${results.children.length ? '. Tidligere viste resultater er ikke opdateret for denne søgning.' : ''}`; }
});

async function refreshProactiveSettings() {
  return settingsDrafts.refreshProactive();
}

document.getElementById('proactive-form').addEventListener('submit', event => settingsDrafts.saveProactive(event));

document.addEventListener('jarvis:refreshed', () => {
  refreshIntelligenceCatalog().catch(() => {});
});
document.addEventListener('jarvis:view-changed', () => refreshIntelligenceCatalog().catch(() => {}));
document.getElementById('logout').addEventListener('click', () => {
  sourceNavigationSequence++; knowledgeSearchSequence++; intelligenceCatalog.reset();
  document.getElementById('knowledge-query').value = '';
  document.getElementById('knowledge-results').replaceChildren();
  document.getElementById('knowledge-search-status').textContent = '';
  history.replaceState({ ...(history.state || {}), knowledgeQuery: null }, '', window.location.href);
});
setInterval(() => refreshIntelligenceCatalog().catch(() => {}), 60_000);
