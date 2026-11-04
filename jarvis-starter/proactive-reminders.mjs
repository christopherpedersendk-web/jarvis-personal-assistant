export class ProactiveReminders {
  constructor({ state, organizer, notify, save, enabled = () => true }) {
    Object.assign(this, { state, organizer, notify, save, enabled });
    this.state.proactiveReminders ||= [];
    this.busy = false;
  }

  async tick() {
    if (!this.enabled() || this.busy) return [];
    this.busy = true;
    try {
      const keys = new Set(this.state.proactiveReminders);
      const pending = [];
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
        await this.save();
        const lines = pending.slice(0, 12).map(item => `${item.title}: ${item.daysUntil === 0 ? 'i dag' : `om ${item.daysUntil} dage`} (${item.date}) · ${item.collectionTitle}`);
        await this.notify({ title: 'Kommende vigtige datoer', kind: 'reminder', text: lines.join('\n') + (pending.length > 12 ? `\nOg ${pending.length - 12} flere.` : '') });
      }
      return pending;
    } finally { this.busy = false; }
  }
}
