// v4.8 — local meal planning, read-only calendar and reviewed Nemlig basket changes.
// No order or payment endpoint exists. All variable text is inserted with textContent.
let mealLoaded = false;
const mealSelection = new Map();
const mealEl = id => document.getElementById(id);

function mealNode(tag, value = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = String(value);
  if (className) node.className = className;
  return node;
}

function mealApi(path, method = 'GET', body) {
  return api(path, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
}

function mealLocalDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function showMealProfile(profile) {
  mealEl('meal-household').value = profile.householdSize;
  mealEl('meal-diet').value = profile.diet;
  mealEl('meal-budget').value = profile.budgetDkk ?? '';
  mealEl('meal-avoid').value = (profile.avoid || []).join(', ');
  mealEl('meal-pantry').value = (profile.pantry || []).map(x => `${x.name} | ${x.quantity} | ${x.unit}`).join('\n');
  mealEl('meal-profile-status').textContent = profile.source === 'user-entered' ? 'Dine senest gemte præferencer er indlæst.' : 'Standardindstillinger. Angiv dine faktiske præferencer.';
}

function showMealPlans(plans) {
  const root = mealEl('meal-plans'); root.replaceChildren();
  if (!plans.length) return root.append(mealNode('p', 'Ingen madplan endnu. Vælg periode og tryk Lav ny madplan.', 'muted'));
  for (const plan of plans.slice(0, 5)) {
    const card = mealNode('article', '', 'meal-card');
    card.append(mealNode('h3', `${plan.startDate} · ${plan.days} dage · ${plan.servings} personer`));
    const list = mealNode('ul');
    for (const dish of plan.dishes) list.append(mealNode('li', `${dish.date}: ${dish.title} (${dish.minutes} min.)`));
    card.append(list, mealNode('h4', 'Indkøbsliste (fratrukket oplyst lager)'));
    if (plan.calendarAware) card.append(mealNode('p', 'Travle kalenderdage er prioriteret med hurtigere retter; selve aftalerne gemmes ikke i madplanen.', 'muted micro'));
    const shopping = mealNode('ul');
    for (const item of plan.shoppingList) shopping.append(mealNode('li', `${item.name} · ${item.quantity} ${item.unit}`));
    card.append(shopping, mealNode('p', `Budgetmål: ${plan.budgetTargetDkk ?? 'ikke fastsat'} kr. · Priser ukendte indtil butikssøgning.`, 'muted micro'));
    root.append(card);
  }
}

function showNemligSelection() {
  const root = mealEl('meal-nemlig-selection'); root.replaceChildren();
  if (!mealSelection.size) return root.append(mealNode('p', 'Ingen varer valgt.', 'muted micro'));
  root.append(mealNode('h4', 'Valgte varer – endnu ikke sendt til kurven'));
  for (const item of mealSelection.values()) {
    const row = mealNode('div', '', 'meal-product');
    row.append(mealNode('span', `${item.name} · +${item.quantity}`));
    const minus = mealNode('button', 'Fjern', 'secondary'); minus.type = 'button';
    minus.addEventListener('click', () => { mealSelection.delete(item.productId); showNemligSelection(); });
    row.append(minus); root.append(row);
  }
}

function showNemligProducts(products) {
  const root = mealEl('meal-nemlig-results'); root.replaceChildren();
  if (!products.length) return root.append(mealNode('p', 'Ingen produkter fundet.', 'muted'));
  for (const product of products) {
    const id = String(product.Id || '');
    const row = mealNode('div', '', 'meal-product');
    row.append(mealNode('span', `${product.Name || 'Produkt'}${product.Brand ? ` · ${product.Brand}` : ''}${product.Price != null ? ` · oplyst pris: ${product.Price}` : ''}`));
    if (/^\d{1,18}$/.test(id)) {
      const quantity = document.createElement('input'); quantity.type = 'number'; quantity.value = '1';
      quantity.min = '1'; quantity.max = '30'; quantity.setAttribute('aria-label', `Antal ${product.Name || id}`);
      const add = mealNode('button', 'Vælg', 'secondary'); add.type = 'button';
      add.addEventListener('click', () => {
        const amount = Number(quantity.value);
        if (!Number.isInteger(amount) || amount < 1 || amount > 30) return toast('Vælg 1–30 af varen.');
        const existing = mealSelection.get(id)?.quantity || 0;
        if (existing + amount > 30) return toast('Højst 30 stk. pr. vare i et forslag.');
        mealSelection.set(id, { productId: id, name: String(product.Name || id).slice(0, 120), quantity: existing + amount });
        showNemligSelection();
      });
      row.append(quantity, add);
    }
    root.append(row);
  }
}

function showBasket(basket) {
  const root = mealEl('meal-nemlig-basket'); root.replaceChildren();
  root.append(mealNode('h4', 'Kurv – nuværende status'));
  if (!basket.Lines.length) root.append(mealNode('p', 'Kurven er tom.', 'muted'));
  for (const line of basket.Lines) root.append(mealNode('p', `${line.Name || line.Id}: ${line.Quantity} stk.`, 'muted small-text'));
  if (basket.TotalPrice != null) root.append(mealNode('p', `Nemlig oplyser samlet beløb: ${basket.TotalPrice}`, 'muted small-text'));
}

function showNemligProposals(proposals) {
  const root = mealEl('meal-nemlig-proposals'); root.replaceChildren();
  const statusLabels = { pending: 'Afventer godkendelse', applying: 'Behandles', completed: 'Udført', partial: 'Delvist udført', declined: 'Afvist', unknown: 'Uvis status – kontroller Nemlig' };
  if (!proposals.length) return root.append(mealNode('p', 'Ingen forslag.', 'muted micro'));
  for (const proposal of proposals.slice(0, 10)) {
    const card = mealNode('article', '', 'meal-card');
    card.append(mealNode('h4', statusLabels[proposal.status] || proposal.status));
    for (const item of proposal.additions || []) card.append(mealNode('p', `${item.name || item.productId}: ${item.previous} → ${item.target} (+${item.add})`, 'small-text'));
    if (proposal.status === 'pending') {
      card.append(mealNode('p', `Udløber ${new Date(proposal.expiresAt).toLocaleString('da-DK')}. Et klik på Overfør til Nemlig godkender de viste tilføjelser til din rigtige kurv. Eksisterende varer fjernes ikke.`, 'muted micro'));
      const approve = mealNode('button', 'Overfør til Nemlig', 'primary'); approve.type = 'button';
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        try {
          await mealApi(`/api/nemlig/proposals/${proposal.id}/approve`, 'POST', { approved: true });
          await refreshNemlig(); toast('Kurvændring behandlet. Kontrollér resultatet på Nemlig.');
        } catch (error) { toast(error.message); await refreshNemlig(); }
      });
      const decline = mealNode('button', 'Afvis', 'secondary'); decline.type = 'button';
      decline.addEventListener('click', async () => {
        try { await mealApi(`/api/nemlig/proposals/${proposal.id}/decline`, 'POST'); await refreshNemlig(); }
        catch (error) { toast(error.message); }
      });
      card.append(approve, decline);
    }
    if (proposal.result?.message) card.append(mealNode('p', proposal.result.message, 'muted micro'));
    if (proposal.result?.outcomes) card.append(mealNode('p', proposal.result.outcomes.map(x => `${x.productId}: ${x.status}`).join(' · '), 'muted micro'));
    root.append(card);
  }
}

async function refreshNemlig() {
  const status = await mealApi('/api/nemlig/status');
  mealEl('meal-nemlig-status').textContent = status.configured
    ? 'MCP tilgængelig. Søgning og forslag ændrer ikke kurven. Kun knappen Overfør til Nemlig kan godkende tilføjelser; ingen bestillinger.'
    : 'MCP ikke tilsluttet. Konfiguration kræver serveradministrator. Ingen adgang til Nemlig-kontoen endnu.';
  mealEl('meal-nemlig-search-form').querySelector('button').disabled = !status.configured;
  mealEl('meal-nemlig-propose').disabled = !status.configured;
  mealEl('meal-nemlig-view-basket').disabled = !status.configured;
  showNemligProposals(status.proposals || []);
}

async function refreshGoogle() {
  const state = await mealApi('/api/google/calendar/status');
  mealEl('meal-google-status').textContent = !state.configured
    ? 'OAuth er ikke konfigureret. Kalenderforbindelsen kræver Google OAuth-klient i serverens miljø.'
    : state.connected ? 'Google Kalender er forbundet med read-only adgang.' : 'Klar til at forbinde med Google.';
  mealEl('meal-google-connect').disabled = !state.configured;
  mealEl('meal-google-load').disabled = !state.connected;
  mealEl('meal-google-disconnect').disabled = !state.connected;
  mealEl('meal-use-calendar').disabled = !state.connected;
  if (!state.connected) mealEl('meal-use-calendar').checked = false;
}

async function refreshMeals() {
  const data = await mealApi('/api/meals');
  showMealProfile(data.profile); showMealPlans(data.plans);
  await Promise.all([refreshNemlig(), refreshGoogle()]);
  mealLoaded = true;
}

mealEl('meal-profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const pantry = mealEl('meal-pantry').value.trim().split('\n').filter(Boolean).map(line => {
    const [name, number, unit] = line.split('|').map(x => x?.trim());
    return { name, quantity: Number(number), unit };
  });
  try {
    const { profile } = await mealApi('/api/meals/profile', 'PUT', {
      householdSize: Number(mealEl('meal-household').value), diet: mealEl('meal-diet').value,
      budgetDkk: mealEl('meal-budget').value || null,
      avoid: mealEl('meal-avoid').value.split(',').map(x => x.trim()).filter(Boolean), pantry,
    });
    showMealProfile(profile); toast('Madpræferencer gemt.');
  } catch (error) { mealEl('meal-profile-status').textContent = error.message; }
});

mealEl('meal-plan-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await mealApi('/api/meals/plans', 'POST', { startDate: mealEl('meal-start').value, days: Number(mealEl('meal-days').value), useCalendar: mealEl('meal-use-calendar').checked });
    const data = await mealApi('/api/meals'); showMealPlans(data.plans); toast('Madplan og indkøbsliste oprettet.');
  } catch (error) { toast(error.message); }
});

mealEl('meal-google-connect').addEventListener('click', async () => {
  try { const { url } = await mealApi('/api/google/calendar/connect', 'POST'); window.location.assign(url); }
  catch (error) { toast(error.message); }
});
mealEl('meal-google-load').addEventListener('click', async () => {
  const root = mealEl('meal-google-events'); root.replaceChildren();
  try {
    const { events } = await mealApi('/api/google/calendar/events?days=7');
    if (!events.length) root.append(mealNode('p', 'Ingen aftaler i denne periode.', 'muted'));
    for (const event of events) root.append(mealNode('p', `${event.start.slice(0, 16)} · ${event.title}`, 'meal-event'));
  } catch (error) { root.append(mealNode('p', error.message, 'muted')); }
});
mealEl('meal-google-disconnect').addEventListener('click', async () => {
  try { await mealApi('/api/google/calendar/disconnect', 'POST'); await refreshGoogle(); mealEl('meal-google-events').replaceChildren(); }
  catch (error) { toast(error.message); }
});

mealEl('meal-nemlig-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { const { products } = await mealApi('/api/nemlig/search', 'POST', { query: mealEl('meal-nemlig-search').value }); showNemligProducts(products); }
  catch (error) { toast(error.message); }
});
mealEl('meal-nemlig-propose').addEventListener('click', async () => {
  if (!mealSelection.size) return toast('Vælg først mindst én vare.');
  try {
    await mealApi('/api/nemlig/proposals', 'POST', { items: [...mealSelection.values()].map(x => ({ productId: x.productId, quantity: x.quantity })) });
    mealSelection.clear(); showNemligSelection(); await refreshNemlig(); toast('Kurvforslag gemt. Nemlig-kurven er ikke ændret.');
  } catch (error) { toast(error.message); }
});
mealEl('meal-nemlig-view-basket').addEventListener('click', async () => {
  try { const { basket } = await mealApi('/api/nemlig/basket'); showBasket(basket); }
  catch (error) { toast(error.message); }
});

mealEl('meal-start').value = mealLocalDate();
showNemligSelection();
document.addEventListener('jarvis:refreshed', () => {
  if (!mealLoaded) refreshMeals().catch(error => console.warn('Madplan-status:', error.message));
});
