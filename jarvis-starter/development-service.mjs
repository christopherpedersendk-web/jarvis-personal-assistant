import { dockerTest } from './isolated-test.mjs';

export class DevelopmentService {
  constructor({ projectAgent, testRunner = dockerTest, save, maxFixes = 2 }) {
    Object.assign(this, { projectAgent, testRunner, save, maxFixes });
    this.busy = new Set();
  }

  async test(id) {
    if (this.busy.has(id)) throw new Error('Projektet testes allerede.');
    this.busy.add(id);
    try {
      const report = await this.testRunner((await this.projectAgent.inspect(id)).files);
      const project = this.projectAgent.get(id);
      project.lastTest = { ...report, at: new Date().toISOString(), revision: project.revision };
      await this.save();
      return project.lastTest;
    } finally { this.busy.delete(id); }
  }

  async developAndRepair(id, request) {
    if (this.busy.has(id)) throw new Error('Projektet er allerede i gang.');
    this.busy.add(id);
    const changes = [];
    try {
      const first = await this.projectAgent.develop(id, request);
      changes.push({ revision: first.project.revision, files: first.changedFiles });
      let report = await this.testRunner((await this.projectAgent.inspect(id)).files);
      let repairs = 0;
      while (report.status === 'failed' && repairs < this.maxFixes) {
        const message = (report.reports || []).map(r => r.output).join('\n').slice(-3500);
        const repair = await this.projectAgent.develop(id,
          `Ret følgende fejl fundet af de isolerede tests. Bevar andre funktioner og eksisterende data.\n\n${message}`);
        changes.push({ revision: repair.project.revision, files: repair.changedFiles });
        repairs++;
        report = await this.testRunner((await this.projectAgent.inspect(id)).files);
      }
      const project = this.projectAgent.get(id);
      project.lastTest = { ...report, at: new Date().toISOString(), revision: project.revision, repairsAttempted: repairs };
      await this.save();
      return { project: this.projectAgent.list().find(p => p.id === id), test: project.lastTest, changes };
    } finally { this.busy.delete(id); }
  }
}
