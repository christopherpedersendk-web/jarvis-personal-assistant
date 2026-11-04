import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

// Explicitly allow-listed, non-server-executable targets for the first release.
export const EDITABLE_FILES = ['persona.md', 'public/styles.css', 'public/tasks.css', 'public/index.html', 'public/app.js'];

function digest(text) { return createHash('sha256').update(text).digest('hex'); }

async function checkJavascript(source) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', '--input-type=commonjs'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk.toString().slice(0, 500); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`JavaScript har syntaksfejl: ${errors.slice(0, 350)}`)));
    child.stdin.end(source);
  });
}

export class CodeAgent {
  constructor({ root, backupRoot, state, save, propose }) {
    Object.assign(this, { root, backupRoot, state, save, propose });
    this.state.codeProposals ||= [];
    this.busy = false;
  }

  list() {
    return this.state.codeProposals.map(({ id, file, request, summary, status, createdAt, appliedAt }) => ({ id, file, request, summary, status, createdAt, appliedAt }));
  }

  async create({ file, request }) {
    if (this.busy) throw new Error('Kodeagenten arbejder allerede på et forslag.');
    if (!EDITABLE_FILES.includes(file)) throw new Error('Denne fil kan ikke redigeres af kodeagenten.');
    if (typeof request !== 'string' || !request.trim() || request.length > 2000) throw new Error('Beskriv ændringen med 1–2.000 tegn.');
    if (this.state.codeProposals.filter(x => x.status === 'pending').length >= 5) throw new Error('Godkend eller afvis eksisterende forslag først.');
    this.busy = true;
    try {
      const original = await readFile(join(this.root, file), 'utf8');
      const { summary, content } = await this.propose({ file, request, original });
      if (typeof summary !== 'string' || !summary.trim() || typeof content !== 'string' || !content.trim() || content.length > 80_000) {
        throw new Error('Modellen leverede ikke en gyldig filændring.');
      }
      if (original === content) throw new Error('Modellen foreslog ingen ændring.');
      if (file.endsWith('.js')) await checkJavascript(content);
      const proposal = { id: randomUUID(), file, request: request.trim(), summary: summary.slice(0, 800),
        originalHash: digest(original), original, content, status: 'pending', createdAt: new Date().toISOString() };
      this.state.codeProposals.unshift(proposal);
      this.state.codeProposals = this.state.codeProposals.slice(0, 20);
      await this.save();
      return this.inspect(proposal.id);
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
        const current = await readFile(destination, 'utf8');
        if (digest(current) !== digest(p.content)) throw new Error('Filen er siden blevet ændret. Automatisk tilbagerulning er ikke sikker.');
        const backup = await readFile(join(this.backupRoot, p.id, p.file), 'utf8');
        const temp = `${destination}.${p.id}.rollback.tmp`;
        await writeFile(temp, backup, { mode: 0o600, flag: 'wx' });
        await rename(temp, destination);
        p.status = 'rolledback';
        await this.save();
        return this.inspect(id);
      } finally { this.busy = false; }
    }
    if (p.status !== 'pending') throw new Error('Forslaget kan ikke længere ændres.');
    if (action === 'reject') {
      p.status = 'rejected';
      await this.save();
      return this.inspect(id);
    }
    if (action !== 'apply') throw new Error('Ukendt handling.');
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    this.busy = true;
    try {
      const destination = join(this.root, p.file);
      const actual = await readFile(destination, 'utf8');
      if (digest(actual) !== p.originalHash) throw new Error('Filen er ændret siden forslaget. Opret et nyt forslag.');
      const backupFile = join(this.backupRoot, p.id, p.file);
      await mkdir(dirname(backupFile), { recursive: true, mode: 0o700 });
      await writeFile(backupFile, actual, { mode: 0o600, flag: 'wx' });
      const temp = `${destination}.${p.id}.tmp`;
      await writeFile(temp, p.content, { mode: 0o600, flag: 'wx' });
      await rename(temp, destination);
      p.status = 'applied';
      p.appliedAt = new Date().toISOString();
      await this.save();
      return this.inspect(id);
    } finally { this.busy = false; }
  }
}
