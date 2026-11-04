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
      ({ id, label, state, enqueuedAt, startedAt, endedAt, ...(error ? { error } : {}) }));
  }

  enqueue(label, run) {
    if (typeof run !== 'function' || typeof label !== 'string' || label.length > 80)
      throw new Error('Ugyldigt arbejde.');
    if (this.running >= this.concurrency && this.waiting.length >= this.maxWaiting)
      throw new Error('JARVIS har for mange ventende opgaver. Prøv igen senere.');
    const record = { id: randomUUID(), label, state: 'queued', enqueuedAt: this.now().toISOString(),
      startedAt: null, endedAt: null, error: null };
    this.records.push(record);
    if (this.records.length > 100) this.records.shift();
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
    entry.reject(new Error('Den ventende opgave blev annulleret.'));
    return { ...entry.record };
  }

  #drain() {
    while (this.running < this.concurrency && this.waiting.length) {
      const entry = this.waiting.shift();
      this.running++;
      entry.record.state = 'running';
      entry.record.startedAt = this.now().toISOString();
      Promise.resolve().then(entry.run).then(value => {
        entry.record.state = 'completed'; entry.resolve(value);
      }, error => {
        entry.record.state = 'failed';
        entry.record.error = String(error.message || error).slice(0, 240);
        entry.reject(error);
      }).finally(() => {
        entry.record.endedAt = this.now().toISOString();
        this.running--;
        this.#drain();
      });
    }
  }
}
