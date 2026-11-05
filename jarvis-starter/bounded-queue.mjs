import { randomUUID } from 'node:crypto';

// In-process bounded queue for explicitly requested, read-only assistant work.
// Waiting jobs can be cancelled; running network operations are not presumed
// rolled back. Restart drops waiting work rather than replaying it blindly.
export class BoundedJobQueue {
  constructor({ concurrency = 1, maxWaiting = 4, now = () => new Date() } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
        !Number.isInteger(maxWaiting) || maxWaiting < 0 || maxWaiting > 50)
      throw new Error('Ugyldige grænser for arbejdskø.');
    this.concurrency = concurrency;
    this.maxWaiting = maxWaiting;
    this.now = now;
    this.running = 0;
    this.waiting = [];
    this.records = [];
  }

  snapshot() {
    return this.records.slice(-100).map(({ id, label, state, enqueuedAt, startedAt, endedAt, error }) =>
      ({ id, label, state, enqueuedAt, startedAt, endedAt,
        queuedMs: startedAt || endedAt ? Math.max(0, Date.parse(startedAt || endedAt) - Date.parse(enqueuedAt)) : null,
        runMs: startedAt && endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : null,
        ...(error ? { error } : {}) }));
  }

  enqueue(label, run) {
    if (typeof run !== 'function' || typeof label !== 'string' || label.length > 80)
      throw new Error('Ugyldigt arbejde.');
    if (this.running >= this.concurrency && this.waiting.length >= this.maxWaiting) {
      const error = new Error('JARVIS har for mange ventende opgaver. Prøv igen senere.');
      error.code = 'JOB_QUEUE_FULL';
      throw error;
    }
    const record = { id: randomUUID(), label, state: 'queued', enqueuedAt: this.now().toISOString(),
      startedAt: null, endedAt: null, error: null };
    this.records.push(record);
    // A long-running job must remain visible while short concurrent jobs finish.
    if (this.records.length > 100) {
      const terminal = this.records.findIndex(item => !['queued', 'running'].includes(item.state));
      if (terminal >= 0) this.records.splice(terminal, 1);
    }
    const promise = new Promise((resolve, reject) => {
      this.waiting.push({ record, run, resolve, reject });
      this.#drain();
    });
    return { id: record.id, promise };
  }

  cancel(id) {
    const index = this.waiting.findIndex(entry => entry.record.id === id);
    if (index < 0) throw new Error('Kun ventende opgaver kan annulleres. En igangværende handling kan have virkning.');
    const [entry] = this.waiting.splice(index, 1);
    entry.record.state = 'cancelled';
    entry.record.endedAt = this.now().toISOString();
    const error = new Error('Den ventende opgave blev annulleret.');
    error.code = 'JOB_CANCELLED';
    entry.reject(error);
    return { ...entry.record };
  }

  #drain() {
    while (this.running < this.concurrency && this.waiting.length) {
      const entry = this.waiting.shift();
      this.running++;
      entry.record.state = 'running';
      entry.record.startedAt = this.now().toISOString();
      const finish = () => {
        entry.record.endedAt = this.now().toISOString();
        this.running--;
        this.#drain();
      };
      Promise.resolve().then(entry.run).then(value => {
        entry.record.state = value?.outcome === 'partially_completed' ? 'partially_completed'
          : value?.outcome === 'unknown' ? 'unknown' : 'completed';
        finish();
        entry.resolve(value);
      }, error => {
        entry.record.state = error?.unknownOutcome === true || error?.statePublished === true || error?.checkpointPending === true
          ? 'unknown' : error?.partialOutcome === true ? 'partially_completed' : 'failed';
        entry.record.error = error?.checkpointPending ? 'Resultat afventer et varigt lokalt kontrolpunkt.'
          : entry.record.state === 'unknown' ? 'Udfaldet er uafklaret; handlingen gentages ikke automatisk.'
            : 'Arbejdet kunne ikke gennemføres. Se den relevante opgave for detaljer.';
        finish();
        entry.reject(error);
      });
    }
  }
}
