import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function overviewSummary(state, tasks = state.tasks || [], projects = state.projects || []) {
  let latest = null;
  for (const task of tasks) for (const run of task.runs || []) {
    if (run.at && (!latest || run.at > latest.at)) latest = { title: task.title, status: run.status, at: run.at };
  }
  return {
    inboxCount: (state.inbox || []).filter(item => !item.read).length,
    approvalCount: (state.approvals || []).filter(item => item.status === 'pending').length,
    runningCount: tasks.filter(item => ['running', 'queued'].includes(item.status)).length,
    scheduledCount: tasks.filter(item => ['scheduled', 'retrying'].includes(item.status)).length,
    projectCount: projects.length, latestTask: latest,
  };
}

export function historyPage(history = [], { cursor, limit = 20 } = {}) {
  limit = Number(limit);
  const bad = message => { const error = new Error(message); error.status = 400; throw error; };
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) bad('Historiksiden skal indeholde 1–50 beskeder.');
  const revision = digest(history);
  let end = history.length;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    if (typeof cursor !== 'string' || cursor.length > 240 || !/^[A-Za-z0-9_-]+$/.test(cursor)) bad('Ugyldig historikmarkør.');
    let decoded;
    try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
    catch { bad('Ugyldig historikmarkør.'); }
    if (!decoded || !Number.isSafeInteger(decoded.before) || decoded.before < 0 || decoded.before > history.length ||
        typeof decoded.revision !== 'string' || !/^[0-9a-f]{64}$/.test(decoded.revision)) bad('Ugyldig historikmarkør.');
    if (decoded.revision !== revision) {
      const error = new Error('Samtalehistorikken er ændret. Opdatér oversigten før du henter ældre beskeder; din kladde er bevaret.');
      error.status = 409; error.code = 'HISTORY_CHANGED'; throw error;
    }
    end = decoded.before;
  }
  const start = Math.max(0, end - limit);
  return { items: history.slice(start, end), total: history.length, revision,
    nextCursor: start ? Buffer.from(JSON.stringify({ before: start, revision })).toString('base64url') : null };
}

export function uiBootstrap(state, { tasks, projects, configured, pushEnabled, voiceModel } = {}) {
  const page = historyPage(state.history);
  return { schemaVersion: state.schemaVersion, stateRevision: state.stateRevision,
    preferences: state.preferences || '', playbook: state.playbook || '', history: page.items,
    historyPagination: { total: page.total, revision: page.revision, nextCursor: page.nextCursor },
    summary: overviewSummary(state, tasks, projects), configured: configured === true,
    pushEnabled: pushEnabled === true, voiceModel };
}
