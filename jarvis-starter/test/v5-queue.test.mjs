import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedJobQueue } from '../bounded-queue.mjs';

test('bounded queue keeps local reads responsive, rejects overflow and cancels only waiting work', async () => {
  const queue = new BoundedJobQueue({ concurrency: 1, maxWaiting: 2 });
  let finish;
  const running = queue.enqueue('Langsyntetisk søgning', () => new Promise(resolve => { finish = resolve; }));
  const waitingA = queue.enqueue('Vent A', () => 'A');
  const waitingB = queue.enqueue('Vent B', () => 'B');
  assert.throws(() => queue.enqueue('Overfyldt', () => 'never'), /for mange/);
  assert.equal(queue.snapshot().length, 3);
  assert.deepEqual(queue.snapshot().map(job => job.state), ['running', 'queued', 'queued']);
  const cancelled = queue.cancel(waitingA.id);
  assert.equal(cancelled.state, 'cancelled');
  await assert.rejects(waitingA.promise, /annulleret/);
  assert.throws(() => queue.cancel(running.id), /Kun ventende/);
  await Promise.resolve();
  finish('completed');
  assert.equal(await running.promise, 'completed');
  assert.equal(await waitingB.promise, 'B');
  assert.deepEqual(queue.snapshot().map(job => job.state), ['completed', 'cancelled', 'completed']);
});

test('failed queued task is visible and never poisons the next task', async () => {
  const queue = new BoundedJobQueue({ concurrency: 1, maxWaiting: 1 });
  const bad = queue.enqueue('Fejl', () => { throw new Error('syntetisk kildefejl'); });
  const good = queue.enqueue('Næste opgave', () => 42);
  await assert.rejects(bad.promise, /syntetisk/);
  assert.equal(await good.promise, 42);
  assert.equal(queue.snapshot()[0].state, 'failed');
  assert.equal(queue.snapshot()[1].state, 'completed');
});
