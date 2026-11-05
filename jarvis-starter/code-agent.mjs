import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicStateWrite, durableExclusiveBackup, readPrivateStateText } from './state-schema.mjs';
import { createJobTransitions } from './job-state-transition.mjs';
import { checkJavaScriptSyntax } from './subprocess-safety.mjs';

// Explicitly allow-listed, non-server-executable targets for the first release.
export const EDITABLE_FILES = ['persona.md', 'public/styles.css', 'public/tasks.css', 'public/index.html', 'public/app.js'];

function digest(text) { return createHash('sha256').update(text).digest('hex'); }

async function checkJavascript(source) {
  await checkJavaScriptSyntax(source, { inputType: 'commonjs' });
}

export class CodeAgent {
  constructor({ root, backupRoot, state, save, transact, propose,
    backupWriter = durableExclusiveBackup, publish = atomicStateWrite }) {
    Object.assign(this, { root, backupRoot, state, save, propose, backupWriter, publish });
    this.transact = transact || createJobTransitions(state);
    this.state.codeProposals ||= [];
    for (const proposal of this.state.codeProposals) if (['applying', 'rollingback'].includes(proposal.status)) proposal.status = 'unknown';
    this.busy = false;
  }

  checkpoint(id, change) {
    return this.transact(['codeProposals'], async () => {
      const proposal = this.state.codeProposals.find(item => item.id === id);
      if (!proposal) throw new Error('Forslaget findes ikke.');
      change(proposal); await this.save(); return this.inspect(id);
    });
  }

  list() {
    return this.state.codeProposals.map(({ id, file, request, summary, status, createdAt, appliedAt }) => ({ id, file, request, summary, status, createdAt, appliedAt }));
  }

  async create({ file, request }) {
    if (this.busy) throw new Error('Kodeagenten arbejder allerede på et forslag.');
    if (!EDITABLE_FILES.includes(file)) throw new Error('Denne fil kan ikke redigeres af kodeagenten.');
    if (typeof request !== 'string' || !request.trim() || request.length > 2000) throw new Error('Beskriv ændringen med 1–2.000 tegn.');
    if (this.state.codeProposals.filter(x => x.status === 'pending').length >= 5) throw new Error('Godkend eller afvis eksisterende forslag først.');
    if (this.state.codeProposals.filter(x => ['pending', 'applying', 'rollingback', 'unknown'].includes(x.status)).length >= 20)
      throw new Error('For mange uafklarede kodehandlinger. Gennemgå udfaldene, før du opretter flere forslag.');
    this.busy = true;
    try {
      const original = await readPrivateStateText(join(this.root, file));
      const { summary, content } = await this.propose({ file, request, original });
      if (typeof summary !== 'string' || !summary.trim() || typeof content !== 'string' || !content.trim() || content.length > 80_000) {
        throw new Error('Modellen leverede ikke en gyldig filændring.');
      }
      if (original === content) throw new Error('Modellen foreslog ingen ændring.');
      if (file.endsWith('.js')) await checkJavascript(content);
      const proposal = { id: randomUUID(), file, request: request.trim(), summary: summary.slice(0, 800),
        originalHash: digest(original), original, content, status: 'pending', createdAt: new Date().toISOString() };
      return await this.transact(['codeProposals'], async () => {
        this.state.codeProposals.unshift(proposal);
        const unsettled = new Set(['pending', 'applying', 'rollingback', 'unknown']);
        let settled = 0;
        this.state.codeProposals = this.state.codeProposals.filter(item => unsettled.has(item.status) || ++settled <= 20);
        await this.save(); return this.inspect(proposal.id);
      });
    } finally { this.busy = false; }
  }

  inspect(id) {
    const p = this.state.codeProposals.find(x => x.id === id);
    if (!p) throw new Error('Forslaget findes ikke.');
    return { ...p, originalHash: undefined };
  }

  async action(id, action) {
    const p = this.state.codeProposals.find(x => x.id === id);
    if (!p) throw new Error('Forslaget findes ikke.');
    if (action === 'rollback') {
      if (p.status !== 'applied') throw new Error('Kun installerede forslag kan rulles tilbage.');
      if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
      this.busy = true;
      try {
        const destination = join(this.root, p.file);
        const current = await readPrivateStateText(destination);
        if (digest(current) !== digest(p.content)) throw new Error('Filen er siden blevet ændret. Automatisk tilbagerulning er ikke sikker.');
        const backup = await readPrivateStateText(join(this.backupRoot, p.id, p.file));
        if (digest(backup) !== p.originalHash) throw new Error('Backup matcher ikke det gennemgåede originalindhold.');
        await this.checkpoint(id, item => { item.status = 'rollingback'; });
        if (digest(await readPrivateStateText(destination)) !== digest(p.content)) {
          await this.checkpoint(id, item => { item.status = 'unknown'; });
          throw new Error('Filen blev ændret inden tilbagerulning. Ingen nyere ændringer overskrevet; gennemgå filen igen.');
        }
        try { await this.publish(destination, backup); }
        catch (error) { await this.checkpoint(id, item => { item.status = error.statePublished ? 'unknown' : 'applied'; }).catch(() => {}); throw error; }
        return await this.checkpoint(id, item => { item.status = 'rolledback'; });
      } finally { this.busy = false; }
    }
    if (p.status !== 'pending') throw new Error('Forslaget kan ikke længere ændres.');
    if (action === 'reject') {
      if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
      return this.checkpoint(id, item => { if (item.status !== 'pending') throw new Error('Forslaget er ændret.'); item.status = 'rejected'; });
    }
    if (action !== 'apply') throw new Error('Ukendt handling.');
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    this.busy = true;
    try {
      const destination = join(this.root, p.file);
      const actual = await readPrivateStateText(destination);
      if (digest(actual) !== p.originalHash) throw new Error('Filen er ændret siden forslaget. Opret et nyt forslag.');
      const backupFile = join(this.backupRoot, p.id, p.file);
      await mkdir(dirname(backupFile), { recursive: true, mode: 0o700 });
      await this.backupWriter(backupFile, actual);
      await this.checkpoint(id, item => { if (item.status !== 'pending') throw new Error('Forslaget er ændret.'); item.status = 'applying'; });
      if (digest(await readPrivateStateText(destination)) !== p.originalHash) {
        await this.checkpoint(id, item => { item.status = 'unknown'; });
        throw new Error('Filen blev ændret inden publicering. Ingen ændring udført; gennemgå filen igen.');
      }
      try { await this.publish(destination, p.content); }
      catch (error) { await this.checkpoint(id, item => { item.status = error.statePublished ? 'unknown' : 'pending'; }).catch(() => {}); throw error; }
      return await this.checkpoint(id, item => { item.status = 'applied'; item.appliedAt = new Date().toISOString(); });
    } finally { this.busy = false; }
  }
}
