// Projekter og kodeforslag: lokale kladder er ikke godkendelser eller handlinger.
// Controlleren opdaterer kort i deres eksisterende DOM-position, så polling ikke
// løsner fokuserede felter, åbne filer eller testlogge fra dokumentet.
const JarvisProjects = (() => {
  const storageKey = 'jarvis:v5:project-drafts';
  const unsettled = new Set(['queued', 'running', 'unknown', 'partially_completed']);
  const proposalNames = { pending: 'Afventer godkendelse', applying: 'Anvender ændring …',
    applied: 'Anvendt lokalt', rollingback: 'Ruller tilbage …', rolledback: 'Rullet tilbage',
    rejected: 'Afvist', failed: 'Fejlet', unknown: 'Ukendt udfald – kræver gennemgang' };
  const operationNames = { create: 'Oprettelse', develop: 'Udvikling', archive: 'Arkivering',
    restore: 'Gendannelse', rollback: 'Tilbagerulning', install: 'Pakkeinstallation', test: 'Test' };
  const outcomeNames = { queued: 'I kø', running: 'Arbejder …', completed: 'Afsluttet',
    failed: 'Fejlet', blocked: 'Blokeret – ingen projektpakker publiceret', unknown: 'Ukendt udfald', partially_completed: 'Delvist gennemført' };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
  const basis = project => ({ revision: project.revision,
    ...(project.contentHash ? { contentHash: project.contentHash } : {}) });
  const expected = value => ({ expectedRevision: value.revision,
    ...(value.contentHash ? { expectedContentHash: value.contentHash } : {}) });
  const blocked = project => unsettled.has(project.operation?.status) || unsettled.has(project.packageInstallAttempt?.status)
    || project.operation?.kind === 'create' && project.operation.status !== 'completed';
  const matchingOutcome = entry => {
    const attempt = entry.attempt, project = entry.current, original = attempt?.basis;
    if (!attempt || !original?.contentHash || !Number.isSafeInteger(original.revision) || blocked(project)) return null;
    if (attempt.kind === 'install') {
      const result = project.packageInstallAttempt;
      if (!result?.id || result.id === attempt.operationId || !['completed', 'blocked'].includes(result.status) || result.revision !== original.revision
        || result.contentHash !== original.contentHash || !Array.isArray(attempt.approvedPackages)
        || !same([...(result.packages || [])].sort(), [...attempt.approvedPackages].sort())) return null;
      if ((result.status === 'blocked' || attempt.manifestHash || attempt.lockHash) && (!attempt.manifestHash || !attempt.lockHash ||
          result.dependencyReview?.manifestHash !== attempt.manifestHash || result.dependencyReview?.lockHash !== attempt.lockHash)) return null;
      return { id: result.id, kind: 'install', status: result.status, revision: result.revision, contentHash: result.contentHash };
    }
    const result = project.operation;
    if (!result?.id || result.id === attempt.operationId || result.kind !== attempt.kind || !['completed', 'failed'].includes(result.status)
      || result.revision !== original.revision + (attempt.kind === 'develop' ? 1 : 0) || result.beforeHash !== original.contentHash) return null;
    return { id: result.id, kind: result.kind, status: result.status, revision: result.revision, contentHash: result.beforeHash };
  };
  const testDescription = project => {
    const report = project.lastTest;
    if (!report) return { status: 'unknown', text: 'Ingen registreret test for det aktuelle projektindhold.' };
    const stale = report.outdated || report.status === 'stale' || report.revision !== project.revision
      || Boolean(project.contentHash && report.contentHash && report.contentHash !== project.contentHash);
    const status = stale ? 'stale' : report.status;
    const names = { passed: 'Bestået', failed: 'Fejlet', unavailable: 'Ikke tilgængelig', skipped: 'Ikke udført',
      stale: 'Forældet – gælder ikke det aktuelle indhold', unknown: 'Ukendt udfald', running: 'Kører …' };
    return { status, text: `Seneste test (revision ${report.revision ?? 'ukendt'}): ${names[status] || 'Ukendt teststatus'}`
      + `${report.summary ? ` · ${report.summary}` : ''}`
      + (report.contentHash ? ` · Testgrundlag: ${report.contentHash}` : ' · Intet indholdshash registreret; resultatet bekræfter ikke aktuelle filer.') };
  };

  function attach({ document, storage, isAuthenticated, api, confirm, refreshProjects, refreshCode }) {
    const byId = id => document.getElementById(id);
    const projectCards = new Map(), codeCards = new Map(), archiveCards = new Map();
    const recoveredProjects = new Map(), recoveredActions = new Map(), forms = new Map();
    let generation = 0, storageReady = true, restoredForms = {};
    const node = (tag, content = '', css = '') => {
      const element = document.createElement(tag); if (content) element.textContent = content;
      if (css) element.className = css; return element;
    };
    const status = css => { const element = node('p', '', css); element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite'); return element; };
    const button = (label, action) => { const element = node('button', label); element.type = 'button';
      element.addEventListener('click', action); return element; };
    const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const currentGeneration = value => value === generation && isAuthenticated();
    const storageWarning = () => storageReady ? '' : ' Browseren kan ikke sikre kladden ved genindlæsning. Kopiér teksten før du forlader siden.';
    const recordForRecovery = entry => ({ id: entry.current.id, title: entry.current.title, slug: entry.current.slug,
      description: text(entry.current.description, 1500), ...basis(entry.current) });
    try {
      if (!isAuthenticated()) storage.removeItem(storageKey);
      else {
        const raw = storage.getItem(storageKey);
        const saved = raw && raw.length < 600_000 ? JSON.parse(raw) : null;
        if (saved?.version === 1) {
          for (const [id, value] of Object.entries(saved.projects || {}).slice(0, 80)) {
            if (/^[a-zA-Z0-9_-]{1,100}$/.test(id) && value?.record?.id === id && typeof value.request === 'string'
              && value.request.length <= 3000 && Number.isSafeInteger(value.basis?.revision)) recoveredProjects.set(id, value);
          }
          for (const [id, value] of Object.entries(saved.codeActions || {}).slice(0, 80))
            if (/^[a-zA-Z0-9_-]{1,100}$/.test(id) && (value?.attempt || typeof value?.message === 'string')) recoveredActions.set(id, value);
          restoredForms = saved.forms || {};
        }
      }
    } catch { storageReady = false; }

    function persist() {
      if (!isAuthenticated()) return;
      const projects = Object.fromEntries([...recoveredProjects, ...[...projectCards].filter(([, entry]) => entry.dirty || entry.attempt || entry.message)
        .slice(0, 80).map(([id, entry]) => [id, { record: recordForRecovery(entry), request: entry.request.value,
          basis: entry.basis, dirty: entry.dirty, attempt: entry.attempt, message: text(entry.message) }])]);
      const codeActions = Object.fromEntries([...recoveredActions, ...[...codeCards].filter(([, entry]) => entry.attempt || entry.message)
        .map(([id, entry]) => [id, { attempt: entry.attempt, message: text(entry.message) }])]);
      const formValues = Object.fromEntries([...forms].filter(([, entry]) => entry.dirty || entry.attempt || entry.message)
        .map(([id, entry]) => [id, { values: entry.read(), dirty: entry.dirty, attempt: entry.attempt, message: text(entry.message) }]));
      try {
        const saved = JSON.stringify({ version: 1, projects, codeActions, forms: formValues });
        if (saved.length > 600_000) throw new Error('Kladder fylder for meget');
        if (Object.keys(projects).length || Object.keys(codeActions).length || Object.keys(formValues).length) storage.setItem(storageKey, saved);
        else storage.removeItem(storageKey);
        storageReady = true;
      } catch { storageReady = false; }
    }

    function projectBasis(entry) {
      const current = entry.current;
      return entry.observed && entry.observed.revision === current.revision && entry.observed.listedHash === current.contentHash
        ? { revision: current.revision, contentHash: entry.observed.hash } : basis(current);
    }
    function installationReview(entry) {
      const review = entry.dependencyReview, latest = projectBasis(entry), packages = entry.current.pendingPackages || [];
      const current = Boolean(review && entry.dependencyBasis && same(entry.dependencyBasis, latest) &&
        latest.contentHash && latest.contentHash === entry.current.contentHash &&
        same(entry.dependencyAttempt, { id: entry.current.packageInstallAttempt?.id || null, status: entry.current.packageInstallAttempt?.status || null }) &&
        Array.isArray(review.directPackages) && same([...review.directPackages].sort(), [...packages].sort()));
      const ready = current && review.status === 'ready' && review.mode === 'reviewed-lockfile-ci' &&
        /^[a-f0-9]{64}$/.test(review.manifestHash || '') && /^[a-f0-9]{64}$/.test(review.lockHash || '');
      return { review, current, ready };
    }
    function updateProject(entry, project, missing = false) {
      entry.current = project; entry.missing = missing;
      entry.card.dataset.revision = String(project.revision);
      entry.title.textContent = project.title;
      const latest = projectBasis(entry);
      entry.location.textContent = `JARVIS-Projects/${project.slug} · Revision ${project.revision}`
        + (latest.contentHash ? ` · Indhold: ${latest.contentHash}` : ' · Indholdshash endnu ikke registreret');
      entry.description.textContent = project.lastSummary || project.description || '';
      if (!entry.dirty && !entry.busy && !entry.attempt) entry.basis = latest;
      const conflict = !same(entry.basis, latest);
      entry.draftStatus.classList.toggle('draft-conflict', conflict || missing);
      entry.draftStatus.textContent = (missing ? 'Projektet er ikke længere på den aktive liste. Din kladde er bevaret; ingen handling kan udføres.'
        : conflict ? `Projektets grundlag er ændret. Kladden fra revision ${entry.basis.revision} er bevaret. Hent og gennemgå de seneste filer før en ny handling.`
          : entry.dirty ? `Ugemt udviklingskladde for revision ${entry.basis.revision}. Bevares ved polling og navigation.` : '') + storageWarning();
      const operation = project.operation;
      const install = project.packageInstallAttempt;
      const notes = [];
      if (operation) notes.push(`${operationNames[operation.kind] || 'Projekthandling'}: ${outcomeNames[operation.status] || 'Ukendt status'}${operation.note ? ` · ${operation.note}` : ''}`);
      if (install) notes.push(`Pakkeinstallation, revision ${install.revision}: ${outcomeNames[install.status] || 'Ukendt status'}`
        + ` · Gennemgået sæt: ${(install.packages || []).join(', ') || 'ikke registreret'}${install.note ? ` · ${install.note}` : ''}`);
      if (blocked(project)) notes.push('Nye ændringer og gentagelser er låst. Kontrollér den registrerede handling, manifestet og filerne; udfaldet er ikke en afvisning.');
      if (entry.attempt) notes.push(entry.busy ? 'Anmodningen behandles. Ingen gentagelse er mulig imens.'
        : 'Anmodningens udfald er ikke bekræftet. Hent seneste status; gentag ikke handlingen blindt.');
      entry.operationStatus.textContent = notes.join(' ');
      entry.result.textContent = entry.message || '';
      const report = testDescription({ ...project, ...latest });
      entry.testStatus.className = `project-test-status ${report.status}`; entry.testStatus.textContent = report.text;
      const reports = project.lastTest?.reports || [];
      entry.testLog.hidden = !reports.length;
      const log = reports.map(item => `${item.image || ''}\n${item.output || ''}`).join('\n\n').slice(-9000);
      if (entry.log.textContent !== log) entry.log.textContent = log;
      entry.packages.textContent = project.pendingPackages?.length
        ? `Afventer særskilt installationsgodkendelse for revision ${project.revision}: ${project.pendingPackages.join(', ')}. Pakkenavne og versionsangivelser er det præcise foreslåede sæt; ingen pakker er godkendt af denne visning.` : '';
      const dependency = installationReview(entry);
      entry.dependencyStatus.hidden = !project.pendingPackages?.length;
      const dependencyNotes = !dependency.review ? ['Pakkegrundlaget er endnu ikke gennemgået. Vælg Se projektfiler for at kontrollere package.json og den komplette låste afhængighedsplan.']
        : !dependency.current ? ['Det læste pakkegrundlag gælder ikke længere de aktuelle pakker, revision eller kildefiler. Hent filerne igen; en ændret faktisk kildehash kræver en ny gennemgået projektrevision.']
          : dependency.ready ? ['Pakkegrundlaget er klar til din særskilte godkendelse: package.json og offentlig v3-lås med SHA-512 for de låste pakker.']
            : ['Installation er blokeret, indtil afhængighedsgrundlaget er gennemgået og rettet.'];
      if (dependency.review) {
        for (const reason of (Array.isArray(dependency.review.reasons) ? dependency.review.reasons : []).slice(0, 20))
          dependencyNotes.push(`${text(reason.code, 100) || 'Gennemgang kræves'}: ${text(reason.message, 800) || 'Detaljer mangler.'}`);
        if (dependency.review.manifestHash) dependencyNotes.push(`package.json-hash: ${dependency.review.manifestHash}`);
        if (dependency.review.lockHash) dependencyNotes.push(`Låsefilhash: ${dependency.review.lockHash}`);
        if (Number.isSafeInteger(dependency.review.dependencyCount)) dependencyNotes.push(`Låste afhængigheder: ${dependency.review.dependencyCount}.`);
      }
      dependencyNotes.push('npm ci klargør i en privat mappe uden livscyklusscripts. Kun node_modules publiceres; tidligere node_modules bevares til kontrolleret gendannelse. Læsning alene godkender intet.');
      const dependencyText = dependencyNotes.join(' ');
      if (entry.dependencyStatus.textContent !== dependencyText) entry.dependencyStatus.textContent = dependencyText;
      const writeBlocked = missing || entry.busy || Boolean(entry.attempt) || blocked(project);
      entry.build.disabled = writeBlocked || conflict;
      const buildLabel = entry.busy && entry.attempt?.kind === 'develop' ? 'JARVIS skriver kode …' : project.revision ? 'Videreudvikl' : 'Byg projekt';
      if (entry.build.textContent !== buildLabel) entry.build.textContent = buildLabel;
      entry.test.disabled = writeBlocked; entry.test.hidden = !project.revision;
      entry.rollback.disabled = writeBlocked; entry.rollback.hidden = !project.lastRollbackableRevision;
      entry.archive.disabled = writeBlocked;
      entry.install.hidden = !project.pendingPackages?.length;
      entry.install.disabled = writeBlocked || !dependency.ready || install?.revision === project.revision && install.status !== 'blocked';
      entry.review.hidden = !conflict || missing;
      const candidate = matchingOutcome(entry);
      entry.resolve.hidden = !entry.attempt || !candidate || entry.busy || missing;
      entry.resolve.disabled = !entry.viewBasis || !same(entry.viewBasis, latest);
      entry.discard.hidden = !entry.dirty; entry.discard.disabled = entry.busy;
      entry.view.disabled = entry.reading || missing;
      entry.recheck.disabled = entry.reading || entry.busy;
      entry.card.setAttribute('aria-busy', String(Boolean(entry.busy)));
      if (entry.viewBasis) entry.filesStatus.textContent = `Viste filer fra revision ${entry.viewBasis.revision} · ${entry.viewBasis.contentHash || 'ukendt indholdshash'}`
        + (!same(entry.viewBasis, latest) ? ' · Forældet visning; hent filer igen før gennemgang.' : '') + (entry.omitted ? ` · ${entry.omitted} filer er udeladt fra denne afgrænsede visning.` : '');
    }

    async function recheckProject(entry) {
      const epoch = generation; entry.reading = true; updateProject(entry, entry.current, entry.missing);
      try {
        await refreshProjects();
        if (!currentGeneration(epoch)) return;
        const attempt = entry.attempt;
        const candidate = matchingOutcome(entry);
        if (attempt && candidate) entry.message = `Et registreret udfald matcher handlingstype, revision og indhold: ${candidate.id}. `
          + 'Dette er ikke alene en kvittering for din afbrudte anmodning. Hent filerne, kontrollér handlingen/manifestet og bekræft din afklaring særskilt.';
        else if (attempt) entry.message = 'Status er hentet, men intet afsluttet udfald matcher handlingstype, revision og indhold. Ingen automatisk gentagelse; manuel afklaring er nødvendig.';
      } catch (error) { if (currentGeneration(epoch)) entry.message = `Status kunne ikke hentes: ${error.message}`; }
      finally { if (currentGeneration(epoch)) { entry.reading = false; persist(); updateProject(entry, entry.current, entry.missing); } }
    }

    async function actProject(entry, kind) {
      if (entry.busy || entry.attempt || blocked(entry.current) || entry.missing) return;
      const current = entry.current, latest = projectBasis(entry);
      const request = entry.request.value;
      if (kind === 'develop' && !same(entry.basis, latest)) { entry.message = 'Gennemgå først den nye projektrevision. Kladden er bevaret.'; updateProject(entry, current); return; }
      if (kind === 'develop' && request.trim().length < 4) { entry.message = 'Beskriv udviklingsopgaven med mindst fire tegn.'; updateProject(entry, current); return; }
      const dependency = installationReview(entry);
      if (kind === 'install' && (!current.pendingPackages?.length || !dependency.ready ||
          current.packageInstallAttempt?.revision === current.revision && current.packageInstallAttempt.status !== 'blocked')) return;
      const approvals = { rollback: 'Gendan filerne fra før den seneste udviklingsrunde? Nyere manuelle rettelser må ikke overskrives.',
        archive: `Arkivér "${current.title}"? Projektmappen bevares i det lokale arkiv. En ugemt kladde slettes ikke.`,
        install: `Godkend præcis dette npm-sæt for revision ${current.revision}?\n${(current.pendingPackages || []).join('\n')}\n\nKildehash: ${latest.contentHash}\npackage.json-hash: ${dependency.review?.manifestHash}\nLåsefilhash: ${dependency.review?.lockHash}\n\nnpm ci kan hente de offentlige, låste pakker til privat klargøring uden livscyklusscripts. Kun node_modules publiceres efter kontrol; eksisterende node_modules bevares i en recoverymappe til kontrolleret gendannelse. Intet er installeret alene ved at læse denne gennemgang. Godkend kun efter at have gennemgået filerne og den eksakte låsefil.` };
      if (approvals[kind] && !confirm(approvals[kind])) return;
      const epoch = generation, sentBasis = kind === 'develop' ? { ...entry.basis } : latest;
      entry.attempt = { kind, basis: sentBasis, operationId: kind === 'install' ? current.packageInstallAttempt?.id : current.operation?.id };
      if (kind === 'install') {
        entry.attempt.approvedPackages = [...current.pendingPackages];
        entry.attempt.manifestHash = dependency.review.manifestHash; entry.attempt.lockHash = dependency.review.lockHash;
        entry.dependencyReview = null; entry.dependencyBasis = null;
      }
      entry.busy = true; entry.message = ''; persist(); updateProject(entry, current);
      try {
        const path = `/api/projects/${encodeURIComponent(current.id)}` + (kind === 'archive' ? '' : `/${kind}`);
        const response = await api(path, json({ ...expected(sentBasis), ...(kind === 'develop' ? { request } : {}),
          ...(kind === 'install' ? { packages: [...current.pendingPackages] } : {}) }, kind === 'archive' ? 'DELETE' : 'POST'));
        if (!currentGeneration(epoch)) return;
        if (kind === 'install') {
          if (response.project) entry.current = response.project;
          if (matchingOutcome(entry)?.status !== 'completed')
            throw new Error('Serveren bekræftede ikke en afsluttet installation for det gennemgåede pakkesæt, revision og indhold. Hent status og afklar udfaldet før en ny handling.');
        }
        entry.attempt = null;
        if (kind === 'develop' && entry.request.value === request) {
          entry.request.value = ''; entry.dirty = false;
        }
        if (response.project) entry.current = response.project;
        if (kind === 'test' && response.test) entry.current = { ...entry.current, lastTest: response.test };
        entry.message = kind === 'develop' ? `${response.changedFiles?.length ?? 0} filer skrevet. ${testDescription({ ...entry.current, lastTest: response.test || entry.current.lastTest }).text}`
          : kind === 'test' ? testDescription(entry.current).text : kind === 'install' ? 'Det præcist godkendte pakkesæts node_modules er registreret publiceret. Test skal udføres igen.'
            : kind === 'archive' ? 'Projektet er arkiveret. En eventuel lokal kladde er bevaret.' : 'Tilbagerulningen er registreret gennemført. Kontrollér den nye revision.';
        persist();
        try { await refreshProjects(); } catch (error) { if (currentGeneration(epoch)) entry.message += ` Oversigten kunne ikke opdateres: ${error.message}`; }
      } catch (error) {
        if (!currentGeneration(epoch)) return;
        entry.message = `Handlingen blev ikke bekræftet: ${error.message}. Kladden er bevaret.`;
        // A completed 4xx response is a rejection, but the handler can have
        // recorded a partial/unknown outcome. Refresh before enabling anything.
        if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && error.status !== 408) {
          try {
            await refreshProjects();
            if (currentGeneration(epoch) && !blocked(entry.current)) entry.attempt = null;
          } catch { /* Unknown state remains blocked rather than blindly retrying. */ }
        }
      } finally { if (currentGeneration(epoch)) { entry.busy = false; persist(); updateProject(entry, entry.current, entry.missing); } }
    }

    function createProject(project) {
      const saved = recoveredProjects.get(project.id); recoveredProjects.delete(project.id);
      const entry = { current: project, basis: saved?.basis || basis(project), dirty: Boolean(saved?.dirty), busy: false,
        attempt: saved?.attempt || null, message: saved?.message || '', observed: null, missing: false };
      entry.card = node('article', '', 'project-card'); entry.card.dataset.projectId = project.id;
      entry.title = node('h3'); entry.location = node('div', '', 'project-meta'); entry.description = node('p');
      entry.operationStatus = status('project-operation-status'); entry.result = status('project-result draft-status');
      entry.testStatus = node('p'); entry.testLog = node('details', '', 'project-test-log project-files');
      entry.log = node('pre'); entry.testLog.append(node('summary', 'Se testlog'), entry.log);
      entry.request = node('textarea'); entry.request.rows = 3; entry.request.maxLength = 3000;
      entry.request.id = `project-request-${project.id}`; entry.request.setAttribute('aria-label', `Udviklingsønske til ${project.title}`);
      entry.request.placeholder = project.revision ? 'Hvad skal JARVIS forbedre?' : 'Byg den første version af projektet …';
      entry.request.value = saved ? saved.request : project.revision ? '' : project.description || '';
      const label = node('label', 'Udviklingsønske'); label.setAttribute('for', entry.request.id);
      entry.draftStatus = status('project-draft-status draft-status');
      entry.request.addEventListener('input', () => {
        if (!entry.dirty) entry.basis = projectBasis(entry);
        entry.dirty = true; persist(); updateProject(entry, entry.current, entry.missing);
      });
      entry.packages = node('p', '', 'project-warning');
      entry.dependencyStatus = status('project-dependency-status project-meta');
      entry.build = button('Videreudvikl', () => actProject(entry, 'develop'));
      entry.test = button('Test isoleret', () => actProject(entry, 'test'));
      entry.rollback = button('Fortryd seneste kodeændring', () => actProject(entry, 'rollback'));
      entry.install = button('Godkend npm-installation', () => actProject(entry, 'install'));
      entry.archive = button('Arkivér projekt', () => actProject(entry, 'archive')); entry.archive.className = 'danger-button';
      entry.recheck = button('Hent seneste projektstatus', () => recheckProject(entry));
      entry.view = button('Se projektfiler', async () => {
        if (entry.reading || entry.missing) return;
        const epoch = generation; entry.reading = true; updateProject(entry, entry.current);
        try {
          const response = await api(`/api/projects/${encodeURIComponent(entry.current.id)}`);
          if (!currentGeneration(epoch)) return;
          const current = response.project;
          const viewed = { revision: current.revision, contentHash: current.sourceContentHash || current.contentHash };
          if (entry.current.revision === current.revision) entry.observed = { revision: current.revision, listedHash: entry.current.contentHash, hash: viewed.contentHash };
          entry.viewBasis = viewed; entry.omitted = current.omittedFiles?.length || 0;
          entry.dependencyReview = current.dependencyReview || null; entry.dependencyBasis = { ...viewed };
          entry.dependencyAttempt = { id: current.packageInstallAttempt?.id || null, status: current.packageInstallAttempt?.status || null };
          const openPaths = new Set([...entry.fileNodes].filter(([, item]) => item.open).map(([path]) => path));
          const nextPaths = new Set();
          for (const file of current.files || []) {
            nextPaths.add(file.path); let detail = entry.fileNodes.get(file.path);
            if (!detail) { detail = node('details'); detail.append(node('summary', file.path), node('pre')); entry.fileNodes.set(file.path, detail); entry.files.append(detail); }
            const pre = detail.querySelector('pre'); if (pre.textContent !== file.content) pre.textContent = file.content;
            if (openPaths.has(file.path)) detail.open = true;
          }
          for (const [path, detail] of entry.fileNodes) if (!nextPaths.has(path)) { detail.remove(); entry.fileNodes.delete(path); }
          entry.files.hidden = false; entry.filesStatus.hidden = false;
          if (!(current.files || []).length) entry.filesStatus.textContent = 'Ingen filer i den udleverede visning.';
        } catch (error) { if (currentGeneration(epoch)) entry.message = `Projektfiler kunne ikke hentes: ${error.message}`; }
        finally { if (currentGeneration(epoch)) { entry.reading = false; persist(); updateProject(entry, entry.current, entry.missing); } }
      });
      entry.review = button('Brug gennemgået revision og bevar kladde', () => {
        const latest = projectBasis(entry);
        if (!entry.viewBasis || !same(entry.viewBasis, latest)) { entry.message = 'Hent først de seneste projektfiler og gennemgå forskellene.'; updateProject(entry, entry.current); return; }
        if (!confirm(`Har du gennemgået filerne for revision ${latest.revision}? Din tekst bevares, men næste udvikling bindes til dette nye grundlag.`)) return;
        entry.basis = latest; entry.message = 'Nyt grundlag valgt efter din gennemgang. Ingen udvikling er startet.';
        persist(); updateProject(entry, entry.current, entry.missing);
      });
      entry.resolve = button('Bekræft gennemgået handlingsudfald', () => {
        const candidate = matchingOutcome(entry), latest = projectBasis(entry);
        if (!candidate || entry.busy || entry.missing || !entry.viewBasis || !same(entry.viewBasis, latest)) return;
        if (!confirm(`Registreret ${operationNames[candidate.kind] || 'handling'}: ${outcomeNames[candidate.status]}\nID: ${candidate.id}\nRevision: ${candidate.revision}\nGrundlag: ${candidate.contentHash}\n\nDette match beviser ikke alene, at det er din afbrudte anmodning. Har du manuelt kontrolleret manifestet, udfaldet og de aktuelle filer og vil du ophæve den lokale afklaringslås? Ingen handling gentages ved dette valg.`)) return;
        entry.attempt = null; entry.message = 'Du har bekræftet gennemgangen af det registrerede udfald. Ingen handling er gentaget; en eventuel gammel kladde skal stadig revideres.';
        persist(); updateProject(entry, entry.current, entry.missing);
      });
      entry.discard = button('Kassér udviklingskladde', () => {
        if (entry.busy || !confirm('Kassér den lokale udviklingskladde? Dette ændrer ikke projektfiler eller registrerede handlingsudfald.')) return;
        entry.request.value = ''; entry.dirty = false; entry.basis = projectBasis(entry);
        entry.message = 'Den lokale kladde er kasseret. Projektfilerne er uændrede.'; persist(); updateProject(entry, entry.current, entry.missing);
      });
      const controls = node('div', '', 'project-actions'); controls.append(entry.build, entry.view, entry.test, entry.rollback, entry.install, entry.archive);
      const draftControls = node('div', '', 'project-actions'); draftControls.append(entry.review, entry.discard, entry.recheck, entry.resolve);
      entry.files = node('div', '', 'project-source-files project-files'); entry.files.hidden = true; entry.fileNodes = new Map();
      entry.filesStatus = node('p', '', 'project-files-status project-meta'); entry.filesStatus.hidden = true;
      entry.card.append(entry.title, entry.location, entry.description, entry.operationStatus, entry.testStatus, entry.testLog,
        label, entry.request, entry.draftStatus, entry.result, entry.packages, entry.dependencyStatus, controls, draftControls, entry.filesStatus, entry.files);
      projectCards.set(project.id, entry); return entry;
    }

    function renderProjects(projects = []) {
      if (!isAuthenticated()) return;
      const root = byId('projects'); if (!root) return;
      const ids = new Set(projects.map(project => project.id));
      for (const project of projects) {
        const entry = projectCards.get(project.id) || createProject(project);
        if (!entry.card.parentNode) root.append(entry.card);
        updateProject(entry, project);
      }
      for (const [id, saved] of recoveredProjects) if (!ids.has(id)) {
        const entry = createProject(saved.record); root.append(entry.card); updateProject(entry, entry.current, true);
      }
      for (const [id, entry] of projectCards) if (!ids.has(id)) {
        if (entry.dirty || entry.attempt || entry.busy || entry.card.contains(document.activeElement)) updateProject(entry, entry.current, true);
        else { entry.card.remove(); projectCards.delete(id); }
      }
      let empty = root.querySelector('.projects-empty');
      if (!projectCards.size && !empty) { empty = node('p', 'Ingen projekter endnu. Opret dit første projekt ovenfor.', 'projects-empty muted small-text'); root.append(empty); }
      if (projectCards.size && empty) empty.remove();
    }

    function updateCode(entry, proposal) {
      entry.current = proposal; entry.card.dataset.proposalStatus = proposal.status;
      entry.title.textContent = `${proposal.file} · ${proposalNames[proposal.status] || 'Ukendt status – kræver gennemgang'}`;
      entry.summary.textContent = proposal.summary || '';
      const safe = !entry.busy && !entry.attempt;
      entry.apply.hidden = proposal.status !== 'pending'; entry.apply.disabled = !safe || !entry.reviewed;
      entry.reject.hidden = proposal.status !== 'pending'; entry.reject.disabled = !safe;
      entry.rollback.hidden = proposal.status !== 'applied'; entry.rollback.disabled = !safe;
      entry.preview.disabled = entry.reading; entry.recheck.disabled = entry.reading || entry.busy;
      entry.result.textContent = (entry.message || '') + (entry.attempt ? entry.busy ? ' Handlingen behandles; ingen gentagelse imens.'
        : ' Udfaldet er ikke bekræftet; hent status før videre handling.' : '');
      entry.warning.textContent = ['applying', 'rollingback', 'unknown'].includes(proposal.status)
        ? 'Handlingen er ikke afvist. Nye ændringer og gentagelser er låst, indtil udfaldet er afklaret. Gennemse filerne og den registrerede handling.'
        : 'Gennemgå præcis dette forslag før godkendelse. Visning, polling og navigation ændrer ingen filer.';
      entry.card.setAttribute('aria-busy', String(Boolean(entry.busy)));
    }

    async function actCode(entry, action) {
      const proposal = entry.current;
      if (entry.busy || entry.attempt || (action === 'rollback' ? proposal.status !== 'applied' : proposal.status !== 'pending')) return;
      if (action === 'apply' && !entry.reviewed) return;
      if (action !== 'reject' && !confirm(action === 'apply' ? `Anvend præcis det gennemgåede forslag til ${proposal.file}? Der oprettes backup.`
        : `Gendan den kontrollerede backup af ${proposal.file}? Nyere ændringer må ikke overskrives.`)) return;
      const epoch = generation;
      entry.attempt = { action, status: proposal.status }; entry.busy = true; entry.message = ''; persist(); updateCode(entry, proposal);
      try {
        const response = await api(`/api/code/${encodeURIComponent(proposal.id)}/action`, json({ action }));
        if (!currentGeneration(epoch)) return;
        entry.attempt = null; if (response.proposal) entry.current = response.proposal;
        entry.message = action === 'apply' ? 'Ændringen er anvendt lokalt. Genindlæsning eller servergenstart kan være nødvendig; ingen release er udgivet.'
          : action === 'rollback' ? 'Backup er registreret gendannet.' : 'Forslaget er afvist; ingen fil er ændret.';
        persist();
        try { await refreshCode(); } catch (error) { if (currentGeneration(epoch)) entry.message += ` Statusopdatering fejlede: ${error.message}`; }
      } catch (error) {
        if (!currentGeneration(epoch)) return;
        entry.message = `Handlingen blev ikke bekræftet: ${error.message}`;
        if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && error.status !== 408) {
          try { await refreshCode(); if (currentGeneration(epoch) && ['pending', 'applied', 'rejected', 'rolledback'].includes(entry.current.status)) entry.attempt = null; } catch { /* preserve unknown */ }
        }
      } finally { if (currentGeneration(epoch)) { entry.busy = false; persist(); updateCode(entry, entry.current); } }
    }

    function createCode(proposal) {
      const saved = recoveredActions.get(proposal.id); recoveredActions.delete(proposal.id);
      const entry = { current: proposal, attempt: saved?.attempt || null, message: saved?.message || '', busy: false, reviewed: false };
      entry.card = node('article', '', 'code-proposal'); entry.card.dataset.codeProposalId = proposal.id;
      entry.title = node('h3'); entry.summary = node('p'); entry.warning = node('p', '', 'warning'); entry.result = status('code-result draft-status');
      entry.box = node('details', '', 'code-preview'); entry.box.hidden = true; entry.box.append(node('summary', 'Gennemgået filforslag'));
      entry.original = node('pre'); entry.proposed = node('pre'); entry.box.append(node('strong', 'NUVÆRENDE GRUNDLAG'), entry.original, node('strong', 'FORESLÅET FIL'), entry.proposed);
      entry.preview = button('Gennemse filændring', async () => {
        if (entry.reading) return;
        const epoch = generation; entry.reading = true; updateCode(entry, entry.current);
        try {
          const { proposal: full } = await api(`/api/code/${encodeURIComponent(proposal.id)}`);
          if (!currentGeneration(epoch)) return;
          entry.original.textContent = full.original || ''; entry.proposed.textContent = full.content || '';
          entry.box.hidden = false; entry.box.open = true;
          entry.reviewed = full.id === entry.current.id && full.file === entry.current.file && full.status === 'pending';
          entry.current = full;
        } catch (error) { if (currentGeneration(epoch)) entry.message = `Forslaget kunne ikke hentes: ${error.message}`; }
        finally { if (currentGeneration(epoch)) { entry.reading = false; persist(); updateCode(entry, entry.current); } }
      });
      entry.apply = button('Godkend og installér', () => actCode(entry, 'apply'));
      entry.reject = button('Afvis', () => actCode(entry, 'reject'));
      entry.rollback = button('Fortryd installation', () => actCode(entry, 'rollback'));
      entry.recheck = button('Hent seneste forslagsstatus', async () => {
        const epoch = generation;
        try {
          await refreshCode(); if (!currentGeneration(epoch)) return;
          if (entry.attempt && ['applied', 'rolledback', 'rejected'].includes(entry.current.status) && entry.current.status !== entry.attempt.status) {
            entry.attempt = null; entry.message = 'Et afsluttet udfald er registreret. Gennemgå status og filerne.';
          } else if (entry.attempt) entry.message = 'Der er endnu ikke et bekræftet afsluttet udfald. Handlingen gentages ikke.';
        } catch (error) { if (currentGeneration(epoch)) entry.message = `Status kunne ikke hentes: ${error.message}`; }
        finally { if (currentGeneration(epoch)) { persist(); updateCode(entry, entry.current); } }
      });
      const controls = node('div', '', 'code-controls'); controls.append(entry.preview, entry.apply, entry.reject, entry.rollback, entry.recheck);
      entry.card.append(entry.title, entry.summary, entry.warning, controls, entry.result, entry.box);
      codeCards.set(proposal.id, entry); return entry;
    }

    function renderCode(proposals = []) {
      if (!isAuthenticated()) return;
      const root = byId('code-proposals'); if (!root) return;
      const ids = new Set(proposals.map(proposal => proposal.id));
      for (const proposal of proposals) {
        const entry = codeCards.get(proposal.id) || createCode(proposal);
        if (entry.current.file !== proposal.file || entry.current.summary !== proposal.summary || entry.current.request !== proposal.request) entry.reviewed = false;
        if (!entry.card.parentNode) root.append(entry.card);
        updateCode(entry, proposal);
      }
      for (const [id, entry] of codeCards) if (!ids.has(id) && !entry.busy && !entry.attempt) { entry.card.remove(); codeCards.delete(id); }
    }

    function renderArchived(archived = []) {
      if (!isAuthenticated()) return;
      const root = byId('archived-projects'); if (!root) return;
      const ids = new Set(archived.map(item => item.id));
      for (const project of archived) {
        let entry = archiveCards.get(project.id);
        if (!entry) {
          entry = { current: project, busy: false, uncertain: false };
          entry.card = node('div', '', 'archived-entry'); entry.title = node('span'); entry.result = status('draft-status');
          entry.restore = button('Gendan', async () => {
            if (entry.busy || entry.uncertain || unsettled.has(entry.current.operation?.status)) return;
            const epoch = generation; entry.busy = true; entry.restore.disabled = true;
            try { await api(`/api/projects/${encodeURIComponent(entry.current.id)}/restore`, json(expected(basis(entry.current))));
              if (!currentGeneration(epoch)) return; entry.result.textContent = 'Projektet er registreret gendannet.'; await refreshProjects(); }
            catch (error) { if (currentGeneration(epoch)) { entry.result.textContent = `Gendannelse blev ikke bekræftet: ${error.message}. Kontrollér status før et nyt forsøg.`; entry.uncertain = true; } }
            finally { if (currentGeneration(epoch)) { entry.busy = false; entry.restore.disabled = entry.uncertain || unsettled.has(entry.current.operation?.status); } }
          });
          entry.card.append(entry.title, entry.restore, entry.result); archiveCards.set(project.id, entry); root.append(entry.card);
        }
        entry.current = project; entry.title.textContent = `${project.title} · Revision ${project.revision ?? 'ukendt'}`
          + (project.operation ? ` · ${outcomeNames[project.operation.status] || 'Ukendt status'}` : '');
        entry.restore.disabled = entry.busy || entry.uncertain || unsettled.has(project.operation?.status);
      }
      for (const [id, entry] of archiveCards) if (!ids.has(id) && !entry.busy) { entry.card.remove(); archiveCards.delete(id); }
    }

    function attachForm(kind, fieldIds, limit, endpoint, submitId) {
      const form = byId(`${kind}-form`); if (!form) return;
      const fields = fieldIds.map(byId), submit = byId(submitId);
      const original = fields.map(field => field.value);
      const entry = { read: () => Object.fromEntries(fieldIds.map((id, i) => [id, fields[i].value])), fields, original,
        dirty: false, attempt: null, busy: false, message: '', form, submit };
      entry.status = status(`${kind}-request-status draft-status`); entry.status.id = `${kind}-request-status`; form.append(entry.status);
      const repaint = () => { entry.status.textContent = (entry.attempt ? entry.busy ? 'Anmodningen behandles. Nye indtastninger bevares som en separat kladde.'
        : 'Ukendt udfald for den seneste anmodning. Kontrollér projekt-/forslagslisten; send ikke igen uden afklaring.' : entry.message || (entry.dirty ? 'Ugemt kladde. Bevares ved polling, navigation og genindlæsning i denne fane.' : '')) + storageWarning();
        submit.disabled = entry.busy || Boolean(entry.attempt); entry.discard.disabled = entry.busy;
        form.setAttribute('aria-busy', String(entry.busy)); };
      entry.repaint = repaint;
      entry.discard = button('Kassér formularens kladde', () => {
        if (entry.busy || !confirm('Kassér den lokale formularkladde? En eventuel ukendt anmodning forbliver låst, indtil udfaldet er afklaret.')) return;
        fields.forEach((field, i) => { field.value = original[i]; }); entry.dirty = false;
        entry.message = 'Den lokale kladde er kasseret.'; persist(); repaint();
      });
      form.append(entry.discard);
      const recovered = restoredForms[kind];
      if (recovered?.values && fieldIds.every((id, i) => typeof recovered.values[id] === 'string' && recovered.values[id].length <= limit[i])) {
        fields.forEach((field, i) => { if (field.tagName !== 'SELECT' || [...field.options].some(option => option.value === recovered.values[fieldIds[i]])) field.value = recovered.values[fieldIds[i]]; });
        entry.dirty = Boolean(recovered.dirty); entry.attempt = recovered.attempt || null; entry.message = text(recovered.message);
      }
      forms.set(kind, entry);
      for (const field of fields) for (const event of ['input', 'change']) field.addEventListener(event, () => { entry.dirty = true; persist(); repaint(); });
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (entry.busy || entry.attempt) return;
        const sent = entry.read(), epoch = generation;
        entry.busy = true; entry.attempt = { kind, at: new Date().toISOString() }; entry.message = ''; persist(); repaint();
        try {
          const payload = kind === 'project' ? { title: sent['project-title'], description: sent['project-description'] }
            : { file: sent['code-file'], request: sent['code-request'] };
          await api(endpoint, json(payload)); if (!currentGeneration(epoch)) return;
          entry.attempt = null;
          if (same(entry.read(), sent)) { fields.forEach((field, i) => { if (field.tagName !== 'SELECT') field.value = original[i]; }); entry.dirty = false; }
          entry.message = kind === 'project' ? 'Projektmappen er oprettet. Ingen kode er genereret. Nye indtastninger er bevaret.'
            : 'Kodeforslaget er klar til gennemgang. Ingen foreslået ændring er anvendt. Nye indtastninger er bevaret.';
          persist();
          try { await (kind === 'project' ? refreshProjects() : refreshCode()); }
          catch (error) { if (currentGeneration(epoch)) entry.message += ` Oversigten kunne ikke opdateres: ${error.message}`; }
        } catch (error) {
          if (!currentGeneration(epoch)) return;
          entry.message = `Anmodningen blev ikke bekræftet: ${error.message}. Kladden er bevaret.`;
          if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && error.status !== 408) entry.attempt = null;
        } finally { if (currentGeneration(epoch)) { entry.busy = false; persist(); repaint(); } }
      });
      repaint();
    }

    function reset() {
      generation++;
      projectCards.clear(); codeCards.clear(); archiveCards.clear(); recoveredProjects.clear(); recoveredActions.clear(); restoredForms = {};
      for (const id of ['projects', 'code-proposals', 'archived-projects']) byId(id)?.replaceChildren();
      for (const entry of forms.values()) { entry.fields.forEach((field, i) => { field.value = entry.original[i]; });
        entry.dirty = false; entry.attempt = null; entry.busy = false; entry.message = ''; entry.repaint(); }
      try { storage.removeItem(storageKey); } catch { /* In-memory private drafts are still cleared. */ }
    }
    attachForm('project', ['project-title', 'project-description'], [80, 1500], '/api/projects', 'project-create');
    attachForm('code', ['code-file', 'code-request'], [200, 2000], '/api/code', 'code-submit');
    byId('logout')?.addEventListener('click', reset);
    document.defaultView?.addEventListener('beforeunload', event => {
      if (![...projectCards.values(), ...forms.values()].some(entry => entry.dirty || entry.attempt)) return;
      persist();
      if (!storageReady) { event.preventDefault(); event.returnValue = ''; }
    });
    return { renderProjects, renderCode, renderArchived, reset, generation: () => generation };
  }
  return { attach, testDescription, blocked, proposalNames, matchingOutcome };
})();
