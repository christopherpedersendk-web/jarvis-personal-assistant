// Personlige opgaver, kapacitet, opfølgning og kildebaserede oplysninger.
// Formularer får lov at beholde deres lokale kladder under al polling.
(() => {
  const byId = id => document.getElementById(id);
  const node = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  };
  const dateText = value => value ? new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium',
    timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(value)) : 'Ikke angivet';
  const localInstant = id => byId(id).value ? new Date(byId(id).value).toISOString() : null;
  const errorStatus = (id, message, failed = false) => {
    const target = byId(id);
    target.textContent = message;
    target.classList.toggle('v5-error', failed);
  };
  const label = (parent, text, value) => {
    const item = node('p', 'v5-record-detail');
    item.append(node('strong', '', `${text}: `), document.createTextNode(value));
    parent.append(item);
  };
  const button = (text, handler, destructive = false, statusId = 'personal-task-status') => {
    const control = node('button', destructive ? 'secondary' : 'primary', text);
    control.type = 'button';
    control.addEventListener('click', async () => {
      control.disabled = true;
      try { await handler(); }
      catch (error) { errorStatus(statusId, error.message, true); }
      finally { control.disabled = false; }
    });
    return control;
  };

  async function refreshPersonalTasks() {
    const { tasks } = await api('/api/personal-tasks');
    const target = byId('personal-task-list');
    target.replaceChildren();
    for (const task of tasks.filter(item => item.status !== 'archived')) {
      const card = node('article', 'v5-record-card');
      card.dataset.personalTaskId = task.id;
      card.append(node('h3', '', task.title));
      label(card, 'Status', ({ pending: 'Afventer', in_progress: 'I gang', blocked: 'Blokeret',
        completed: 'Afsluttet' })[task.status] || task.status);
      label(card, 'Formål', task.purpose);
      label(card, 'Tid', `${task.durationMinutes} min. · deadline ${dateText(task.deadline)}`);
      if (task.dependencies.length) label(card, 'Afhængigheder', task.dependencies.join(', '));
      const actions = node('div', 'v5-record-actions');
      if (task.status !== 'completed') actions.append(button('Markér afsluttet', async () => {
        await api(`/api/personal-tasks/${task.id}/complete`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: task.revision }) });
        errorStatus('personal-task-status', 'Opgaven er markeret afsluttet.');
        await refreshPersonalTasks();
      }));
      actions.append(button('Arkivér', async () => {
        await api(`/api/personal-tasks/${task.id}/archive`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: task.revision }) });
        errorStatus('personal-task-status', 'Opgaven er arkiveret.');
        await refreshPersonalTasks();
      }, true));
      card.append(actions);
      target.append(card);
    }
    if (!target.children.length) target.append(node('p', 'muted', 'Ingen personlige opgaver endnu.'));
  }

  async function refreshFollowUps() {
    const result = await api('/api/follow-ups');
    const target = byId('follow-up-list');
    target.replaceChildren();
    for (const record of result.cases.filter(item => item.status === 'open')) {
      const card = node('article', 'v5-record-card');
      card.dataset.followUpId = record.id;
      card.append(node('h3', '', record.awaiting));
      label(card, 'Næste tjek', dateText(record.nextCheckAt));
      label(card, 'Stopbetingelse', record.stopCondition);
      label(card, 'Observationer', `${record.observations.length}`);
      const actions = node('div', 'v5-record-actions');
      actions.append(button('Afslut sag', async () => {
        await api(`/api/follow-ups/${record.id}`, { method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: record.revision, action: 'complete' }) });
        errorStatus('follow-up-status', 'Sagen er afsluttet.');
        await refreshFollowUps();
      }, false, 'follow-up-status'));
      card.append(actions);
      target.append(card);
    }
    if (!target.children.length) target.append(node('p', 'muted', 'Ingen åbne opfølgningssager.'));
  }

  async function refreshClaims() {
    const result = await api('/api/personal-claims');
    const target = byId('claim-list');
    target.replaceChildren();
    for (const conflict of result.conflicts) {
      target.append(node('p', 'v5-conflict', `Konflikt om ${conflict.subject}: ${conflict.claims.map(x => x.value).join(' / ')}. Gennemgå oplysningerne.`));
    }
    for (const claim of result.claims.filter(item => item.status !== 'archived').slice(-50).reverse()) {
      const card = node('article', 'v5-record-card');
      card.dataset.claimId = claim.id;
      card.append(node('h3', '', claim.subject));
      label(card, 'Indhold', claim.value);
      label(card, 'Status', ({ proposed: 'Forslag (ikke bekræftet)', confirmed: 'Bekræftet af dig',
        superseded: 'Erstattet' })[claim.status] || claim.status);
      label(card, 'Kilde', `${claim.source.kind} · ${claim.source.channel}`);
      if (claim.expiresAt) label(card, 'Gyldig til', dateText(claim.expiresAt));
      const actions = node('div', 'v5-record-actions');
      if (claim.status === 'proposed') actions.append(button('Bekræft oplysning', async () => {
        await decideClaim(claim, 'confirm');
      }, false, 'claim-status'));
      actions.append(button('Arkivér', async () => decideClaim(claim, 'archive'), true, 'claim-status'));
      card.append(actions);
      target.append(card);
    }
    if (!target.children.length) target.append(node('p', 'muted', 'Ingen oplysninger oprettet.'));
  }

  async function decideClaim(claim, decision) {
    await api(`/api/personal-claims/${claim.id}/${decision}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: claim.revision }) });
    errorStatus('claim-status', decision === 'confirm' ? 'Oplysningen er bekræftet.' : 'Oplysningen er arkiveret.');
    await refreshClaims();
  }

  byId('personal-task-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/personal-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: byId('personal-task-title').value, purpose: byId('personal-task-purpose').value,
          durationMinutes: Number(byId('personal-task-duration').value), deadline: localInstant('personal-task-deadline') }) });
      form.reset();
      byId('personal-task-duration').value = '30';
      errorStatus('personal-task-status', 'Opgaven er gemt.');
      await refreshPersonalTasks();
    } catch (error) { errorStatus('personal-task-status', `Ikke gemt: ${error.message}`, true); }
    finally { submit.disabled = false; }
  });

  byId('follow-up-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/follow-ups', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ awaiting: byId('follow-up-awaiting').value, nextCheckAt: localInstant('follow-up-check'),
          stopCondition: byId('follow-up-stop').value, source: { kind: 'user', id: 'manual' } }) });
      form.reset();
      errorStatus('follow-up-status', 'Opfølgningen er gemt.');
      await refreshFollowUps();
    } catch (error) { errorStatus('follow-up-status', `Ikke gemt: ${error.message}`, true); }
    finally { submit.disabled = false; }
  });

  byId('personal-claim-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/personal-claims', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: byId('claim-subject').value, value: byId('claim-value').value,
          category: byId('claim-category').value }) });
      form.reset();
      errorStatus('claim-status', 'Forslaget er gemt. Bekræft det efter gennemgang.');
      await refreshClaims();
    } catch (error) { errorStatus('claim-status', `Ikke gemt: ${error.message}`, true); }
    finally { submit.disabled = false; }
  });

  byId('capacity-form').addEventListener('submit', async event => {
    event.preventDefault();
    const start = localInstant('capacity-start');
    const end = localInstant('capacity-end');
    const reviewed = byId('capacity-reviewed').checked;
    if (!start || !end || end <= start) {
      errorStatus('capacity-status', 'Sluttid skal være efter starttid.', true); return;
    }
    try {
      const { plan } = await api('/api/planning/simulate', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone: 'Europe/Copenhagen',
          workWindows: [{ start, end }], calendarEvents: [],
          calendarCoverage: reviewed ? { status: 'ready', start, end } : { status: 'unknown' } }) });
      const target = byId('capacity-results');
      target.replaceChildren();
      errorStatus('capacity-status', plan.feasible ? 'Forslaget kan placeres inden for de angivne rammer. Ingen aftaler er oprettet.'
        : 'Der mangler oplysninger, eller tidsrammerne kan ikke overholdes.', !plan.feasible);
      for (const proposal of plan.proposals) {
        const card = node('article', 'v5-record-card');
        card.append(node('h3', '', proposal.title), node('p', '', `${dateText(proposal.start)} – ${dateText(proposal.end)}`));
        target.append(card);
      }
      for (const conflict of plan.conflicts) target.append(node('p', 'v5-conflict', conflict.explanation || conflict.code));
    } catch (error) { errorStatus('capacity-status', error.message, true); }
  });

  const refresh = async () => {
    if (!localStorage.getItem('jarvisAccessToken')) return;
    await Promise.allSettled([refreshPersonalTasks(), refreshFollowUps(), refreshClaims()]);
  };
  document.addEventListener('jarvis:refreshed', refresh);
  document.addEventListener('jarvis:v5-sources-changed', refresh);
  if (localStorage.getItem('jarvisAccessToken')) refresh();
})();
