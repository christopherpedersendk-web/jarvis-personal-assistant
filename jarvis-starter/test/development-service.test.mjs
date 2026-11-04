import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentService } from '../development-service.mjs';

test('uses isolated test feedback for at most two autonomous repairs', async () => {
  let version = 0;
  const project = { id: 'project1', revision: 0 };
  const developRequests = [];
  const agent = {
    get: () => project,
    list: () => [project],
    inspect: async () => ({ files: [{ path: 'app.js', content: `version=${version}` }] }),
    develop: async (_, request) => {
      developRequests.push(request);
      project.revision = ++version;
      return { project, changedFiles: ['app.js'] };
    },
  };
  let tests = 0;
  const service = new DevelopmentService({ projectAgent: agent, save: async () => {},
    testRunner: async () => ++tests < 3
      ? { status: 'failed', summary: 'broken', reports: [{ output: 'Expected true but got false' }] }
      : { status: 'passed', summary: 'ok' },
  });
  const result = await service.developAndRepair('project1', 'Implementér noget');
  assert.equal(result.test.status, 'passed');
  assert.equal(result.test.repairsAttempted, 2);
  assert.equal(developRequests.length, 3);
  assert.match(developRequests[1], /Expected true but got false/);
});

test('does not repair without sandbox availability', async () => {
  const project = { id: 'p', revision: 0 };
  let calls = 0;
  const agent = {
    get: () => project, list: () => [project],
    inspect: async () => ({ files: [{ path: 'app.js', content: 'const x=1;' }] }),
    develop: async () => { calls++; project.revision++; return { project, changedFiles: ['app.js'] }; },
  };
  const service = new DevelopmentService({ projectAgent: agent, save: async () => {},
    testRunner: async () => ({ status: 'unavailable', summary: 'Docker missing' }) });
  const result = await service.developAndRepair('p', 'Byg en app');
  assert.equal(calls, 1);
  assert.equal(result.test.status, 'unavailable');
});
