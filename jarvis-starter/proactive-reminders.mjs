import { randomUUID } from 'node:crypto';
import { createJobTransitions } from './job-state-transition.mjs';

export class ProactiveReminders {
  constructor({ state, organizer, notify, save, transact, enabled = () => true }) {
    Object.assign(this, { state, organizer, notify, save, enabled });
    this.transact = transact || createJobTransitions(state);
    this.state.proactiveReminders ||= [];
    this.state.proactiveReminderRuns ||= [];
    for (const run of this.state.proactiveReminderRuns) if (run.status === 'running') {
      run.status = 'unknown'; run.note = 'Levering afbrudt. Ingen automatisk genlevering.';
    }
    this.busy = false;
  }

  async tick() {
    if (!this.enabled() || this.busy) return [];
    this.busy = true;
    try {
      const runId = randomUUID();
      const pending = [];
      await this.transact(['proactiveReminders', 'proactiveReminderRuns'], async () => {
      const keys = new Set(this.state.proactiveReminders);
      for (const item of this.organizer.upcoming(7)) {
        const prefix = `${item.itemId}:${item.date}:`;
        const stage = item.daysUntil === 0 ? 'today' : item.daysUntil <= 1 ? 'tomorrow' : 'week';
        if (keys.has(prefix + stage)) continue;
        keys.add(prefix + stage);
        if (stage === 'today') { keys.add(prefix + 'tomorrow'); keys.add(prefix + 'week'); }
        if (stage === 'tomorrow') keys.add(prefix + 'week');
        pending.push(item);
      }
      if (pending.length) {
        this.state.proactiveReminders = [...keys].slice(-2500);
        this.state.proactiveReminderRuns.unshift({ id: runId, status: 'running', at: new Date().toISOString(),
          sources: pending.map(item => ({ itemId: item.itemId, date: item.date })) });
        this.state.proactiveReminderRuns = this.state.proactiveReminderRuns.slice(0, 90);
        await this.save();
      }
      });
      if (pending.length) {
        const lines = pending.slice(0, 12).map(item => `${item.title}: ${item.daysUntil === 0 ? 'i dag' : `om ${item.daysUntil} dage`} (${item.date}) · ${item.collectionTitle}`);
        try {
          await this.notify({ title: 'Kommende vigtige datoer', kind: 'reminder', text: lines.join('\n') + (pending.length > 12 ? `\nOg ${pending.length - 12} flere.` : '') });
          await this.transact(['proactiveReminderRuns'], async () => {
            const run = this.state.proactiveReminderRuns.find(item => item.id === runId);
            run.status = 'completed'; run.finishedAt = new Date().toISOString(); await this.save();
          });
        } catch (error) {
          await this.transact(['proactiveReminderRuns'], async () => {
            const run = this.state.proactiveReminderRuns.find(item => item.id === runId);
            run.status = 'unknown'; run.note = 'Leveringen kan være udført. Kontrollér indbakken; ingen blind gentagelse.';
            await this.save();
          }).catch(() => {});
          throw error;
        }
      }
      return pending;
    } finally { this.busy = false; }
  }
}
