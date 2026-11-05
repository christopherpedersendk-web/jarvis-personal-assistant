import { createHash, randomUUID } from 'node:crypto';
import { createJobTransitions } from './job-state-transition.mjs';

const UNSETTLED = new Set(['queued', 'running', 'unknown', 'partially_completed']);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function retainActionJournal(entries = []) {
  const settled = entries.filter(entry => !UNSETTLED.has(entry.status)).slice(-1000);
  const keep = new Set(settled.map(entry => entry.id));
  // Never discard the only durable evidence of a possibly executed action.
  return entries.filter(entry => UNSETTLED.has(entry.status) || keep.has(entry.id));
}

/** Durable intent and outcome are independent of any following model answer.
 * This is not an atomic transaction with an external provider. Unknown writes
 * are never automatically replayed; the source system must be checked first.
 */
export class ActionJournal {
  constructor({ state, save, transact, now = () => new Date() }) {
    this.state = state; this.save = save; this.transact = transact || createJobTransitions(state); this.now = now;
    state.actionJournal ||= [];
  }

  async invoke({ name, call_id: callId = randomUUID() }, args, handler, channel) {
    if (typeof name !== 'string' || name.length > 100 || typeof callId !== 'string' || !callId || callId.length > 100)
      throw new Error('Ugyldig handlingsreference.');
    const basisHash = createHash('sha256').update(JSON.stringify(canonical(args))).digest('hex');
    const prepared = await this.transact(['actionJournal'], async () => {
      const prior = this.state.actionJournal.find(item => item.callId === callId && item.channel === channel);
      if (prior) {
        if (prior.tool !== name || prior.basisHash !== basisHash) throw new Error('Værktøjskaldets grundlag er ændret. Ingen gentagelse udført.');
        if (prior.status !== 'completed') throw new Error('Et tidligere kald har uafklaret udfald. Kontrollér journalen før en ny handling.');
        return { prior: { alreadyRecorded: true, actionId: prior.id, status: prior.status, resultRefs: prior.resultRefs || [] } };
      }
      if (this.state.actionJournal.filter(item => UNSETTLED.has(item.status)).length >= 100)
        throw new Error('Der er for mange uafklarede handlinger. Gennemgå journalen før nye handlinger.');
      const entry = { id: randomUUID(), tool: name, channel, status: 'running',
        at: this.now().toISOString(), callId, basisHash, basisRevision: this.state.stateRevision || 0 };
      this.state.actionJournal.push(entry);
      await this.save();
      return { id: entry.id };
    });
    if (prepared.prior) return prepared.prior;
    try {
      const outcome = await handler(name, args, { channel });
      try {
        await this.transact(['actionJournal'], async () => {
          const entry = this.state.actionJournal.find(item => item.id === prepared.id);
          if (!entry) throw new Error('Handlingsjournalens kontrolpunkt mangler.');
          entry.status = ['partially_completed', 'unknown'].includes(outcome?.outcome) ? outcome.outcome : 'completed';
          entry.finishedAt = this.now().toISOString();
          entry.resultRefs = Object.entries(outcome || {}).flatMap(([kind, value]) => value?.id
            ? [{ kind, id: value.id, ...(value.revision ? { revision: value.revision } : {}) }] : []);
          await this.save();
        });
      } catch (cause) {
        const error = new Error('Handlingen kan være udført. Kontrollér resultatet, før du prøver igen.', { cause });
        error.unknownOutcome = true;
        throw error;
      }
      return outcome;
    } catch (error) {
      await this.transact(['actionJournal'], async () => {
        const entry = this.state.actionJournal.find(item => item.id === prepared.id);
        if (!entry) return;
        entry.status = error.noActionTaken === true ? 'failed' : 'unknown';
        entry.note = error.noActionTaken === true ? 'Ingen handling udført.' : 'Resultatet kræver kontrol, før handlingen gentages.';
        entry.finishedAt = this.now().toISOString();
        await this.save();
      }).catch(() => {}); // The earlier durable running checkpoint remains if saving also fails.
      if (error.noActionTaken !== true) error.unknownOutcome = true;
      throw error;
    }
  }
}
