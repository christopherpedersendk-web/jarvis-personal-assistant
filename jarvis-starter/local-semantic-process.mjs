import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// A native inference abort must not terminate the HTTP process. Worker threads
// share its address space; a child is a crash boundary, not an OS sandbox.
// Only bounded text batches and the explicit model directory cross private IPC.
export class LocalSemanticProcess extends EventEmitter {
  constructor({ directory, forkProcess = fork, module = new URL('./local-semantic-worker.mjs', import.meta.url) }) {
    super();
    if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('Den lokale modelsti skal være absolut.');
    const environment = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']
      .filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]));
    this.child = forkProcess(module, [], {
      cwd: dirname(fileURLToPath(import.meta.url)), env: environment,
      execArgv: ['--max-old-space-size=512'], serialization: 'json',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    this.stdout = this.child.stdout; this.stderr = this.child.stderr;
    this.closed = false;
    this.exit = new Promise(resolve => this.child.once('close', () => { this.closed = true; resolve(); }));
    this.child.on('message', message => this.emit('message', message));
    this.child.on('error', () => this.emit('error', Object.assign(new Error('Lokal modelproces er utilgængelig.'), { code: 'SEMANTIC_PROCESS_FAILED' })));
    this.child.on('exit', (code, signal) => this.emit('exit', code, signal));
    this.child.once('spawn', () => {
      try { this.postMessage({ type: 'initialize', directory }); }
      catch { this.emit('error', Object.assign(new Error('Lokal modelproces kunne ikke initialiseres.'), { code: 'SEMANTIC_PROCESS_FAILED' })); }
    });
  }

  postMessage(message) {
    if (this.closed || !this.child.connected) throw new Error('Lokal modelproces er ikke tilsluttet.');
    this.child.send(message, error => {
      if (error && !this.closed) this.emit('error', Object.assign(new Error('Forbindelsen til den lokale modelproces blev afbrudt.'), { code: 'SEMANTIC_PROCESS_FAILED' }));
    });
  }

  async terminate() {
    // Pure local reads: cancellation stops only this owned process immediately.
    // No PID supplied by a user and no mutable model files or external effects.
    if (!this.closed) this.child.kill('SIGKILL');
    await this.exit;
  }
}
