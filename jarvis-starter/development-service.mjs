import { dockerTest } from './isolated-test.mjs';
import { projectContentHash } from './project-agent.mjs';

export class DevelopmentService {
  constructor({ projectAgent, testRunner = dockerTest, save, transact, maxFixes = 2 }) {
    Object.assign(this, { projectAgent, testRunner, save, maxFixes });
    this.transact = transact || ((_keys, action) => action());
    this.busy = new Set();
    for (const name of ['test', 'developAndRepair']) {
      const original = this[name].bind(this);
      this[name] = (...args) => this.projectAgent.withLock ? this.projectAgent.withLock(() => original(...args)) : original(...args);
    }
  }

  async boundTest(id) {
    this.projectAgent.assertSettled?.(this.projectAgent.get(id));
    const source = await (this.projectAgent.testSnapshot ? this.projectAgent.testSnapshot(id) : this.projectAgent.inspect(id));
    const revision = source.revision ?? this.projectAgent.get(id).revision;
    const contentHash = source.sourceContentHash || projectContentHash(source.files);
    const testedContentHash = projectContentHash(source.files);
    const report = source.captureComplete === false
      ? { status: 'unavailable', summary: 'Projektet kan ikke kopieres fuldstændigt til den afgrænsede test. Ingen grøn status ud fra et ufuldstændigt kodeudsnit.',
        omittedFiles: source.omittedFiles, reason: 'PROJECT_SNAPSHOT_INCOMPLETE' }
      : await this.testRunner(source.files);
    const current = await (this.projectAgent.sourceSnapshot ? this.projectAgent.sourceSnapshot(id) : this.projectAgent.inspect(id));
    const currentHash = current.sourceContentHash || projectContentHash(current.files);
    const outdated = this.projectAgent.get(id).revision !== revision || currentHash !== contentHash;
    return { ...report, at: new Date().toISOString(), revision, contentHash, testedContentHash,
      sourceHashKind: source.sourceHashKind || 'text-files-v1', sourceScope: source.sourceScope || 'De udleverede projektfiler.',
      testedFileCount: source.files.length, outdated,
      ...(outdated ? { status: 'stale', testedStatus: report.status, summary: 'Projektet blev ændret under testen. Resultatet gælder kun det registrerede indhold.' } : {}) };
  }

  async record(id, report) {
    await this.transact(['projects'], async () => {
      const project = this.projectAgent.get(id);
      project.lastTest = project.revision === report.revision ? report : { ...report, status: 'stale', outdated: true,
        testedStatus: report.testedStatus || report.status, summary: 'Projektets revision blev ændret før testresultatet kunne gemmes.' };
      await this.save();
    });
    return report;
  }

  async test(id) {
    if (this.busy.has(id)) throw new Error('Projektet testes allerede.');
    this.busy.add(id);
    try {
      const report = await this.boundTest(id);
      return await this.record(id, report);
    } finally { this.busy.delete(id); }
  }

  async developAndRepair(id, request) {
    if (this.busy.has(id)) throw new Error('Projektet er allerede i gang.');
    this.busy.add(id);
    const changes = [];
    try {
      const first = await this.projectAgent.develop(id, request);
      changes.push({ revision: first.project.revision, files: first.changedFiles });
      let report = await this.boundTest(id);
      let repairs = 0;
      while (report.status === 'failed' && repairs < this.maxFixes) {
        const message = (report.reports || []).map(r => r.output).join('\n').slice(-3500);
        const repair = await this.projectAgent.develop(id,
          `Ret følgende fejl fundet af de isolerede tests. Bevar andre funktioner og eksisterende data.\n\n${message}`);
        changes.push({ revision: repair.project.revision, files: repair.changedFiles });
        repairs++;
        report = await this.boundTest(id);
      }
      await this.record(id, { ...report, repairsAttempted: repairs });
      return { project: this.projectAgent.list().find(p => p.id === id), test: this.projectAgent.get(id).lastTest, changes };
    } finally { this.busy.delete(id); }
  }
}
