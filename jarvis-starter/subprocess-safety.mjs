import { spawn } from 'node:child_process';

// Untrusted source is only parsed on the host. In particular, a configured
// NODE_OPTIONS preload must not turn `node --check` into another execution path.
const SYSTEM_ENV = ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP'];
const DOCKER_CONFIG_ENV = ['HOME', 'USERPROFILE', 'DOCKER_CONFIG'];

function selectedEnv(environment, names) {
  const result = {};
  for (const name of names) if (typeof environment[name] === 'string' && !environment[name].includes('\0')) result[name] = environment[name];
  return result;
}

export function cleanProcessEnvironment(environment = process.env) {
  return { ...selectedEnv(environment, SYSTEM_ENV), LANG: 'C.UTF-8' };
}

// These paths are for the trusted Docker CLI's *local* configuration only.
// They are never passed into a test container. Endpoint overrides are consumed
// and validated separately, then an exact --host argument pins every command.
export function dockerProcessEnvironment(environment = process.env) {
  return { ...cleanProcessEnvironment(environment), ...selectedEnv(environment, DOCKER_CONFIG_ENV) };
}

export function runBoundedProcess(binary, args, { environment, cwd, input,
  timeoutMs = 35_000, maxOutputBytes = 9000, spawnProcess = spawn } = {}) {
  if (!environment || typeof environment !== 'object' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1_048_576)
    throw new Error('Underprocessen mangler et afgrænset miljø eller gyldige grænser.');
  return new Promise(resolve => {
    let child; let timer; let finished = false; let timedOut = false; let inputFailed = false; let output = Buffer.alloc(0);
    const result = (code, extra = {}) => ({ ok: code === 0 && !timedOut && !inputFailed, code,
      timedOut, inputFailed, output: output.toString('utf8'), ...extra });
    const finish = value => { if (finished) return; finished = true; clearTimeout(timer); resolve(value); };
    try {
      child = spawnProcess(binary, args, { ...(cwd ? { cwd } : {}), env: environment,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    } catch (error) { finish(result(null, { unavailable: error.code === 'ENOENT', errorCode: error.code || 'SPAWN_FAILED' })); return; }
    const collect = chunk => {
      if (finished) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      output = Buffer.concat([output, bytes.subarray(Math.max(0, bytes.length - maxOutputBytes))]).subarray(-maxOutputBytes);
    };
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', collect);
    child.once('error', error => finish(result(null, { unavailable: error.code === 'ENOENT', errorCode: error.code || 'SPAWN_FAILED' })));
    child.once('close', (code, signal) => finish(result(code, { signal })));
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    if (input !== undefined) {
      child.stdin?.on('error', () => { inputFailed = true; });
      child.stdin?.end(input);
    }
  });
}

export async function checkJavaScriptSyntax(source, { inputType = 'module', environment = process.env,
  spawnProcess = spawn, timeoutMs = 8000 } = {}) {
  if (!['commonjs', 'module'].includes(inputType) || typeof source !== 'string' || Buffer.byteLength(source) > 1_048_576)
    throw new Error('Ugyldigt grundlag for JavaScript-syntakskontrol.');
  const result = await runBoundedProcess(process.execPath, ['--check', `--input-type=${inputType}`], {
    environment: cleanProcessEnvironment(environment), input: source, timeoutMs, maxOutputBytes: 4096, spawnProcess,
  });
  if (!result.ok) throw new Error(result.timedOut ? 'JavaScript-syntakskontrollen overskred tidsgrænsen.'
    : result.unavailable || result.errorCode ? 'JavaScript-syntakskontrollen kunne ikke startes.'
      : `JavaScript har syntaksfejl: ${result.output.slice(0, 350)}`);
}

export function isLocalDockerEndpoint(value) {
  // Reject TCP/SSH, credentials, query options and relative/ambiguous socket
  // names. Docker Desktop's local named pipe remains supported on Windows.
  return typeof value === 'string' && value.length <= 1000 && !/[\s\0?#]/.test(value) &&
    (/^unix:\/\/\/(?!\/)[^\0]+$/.test(value) || /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(value));
}

export async function localDockerEndpoint(runner, { environment = process.env } = {}) {
  const context = environment.DOCKER_CONTEXT;
  if (context !== undefined && context !== '' && (typeof context !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(context)))
    return { ok: false, reason: 'Docker-konteksten kunne ikke verificeres lokalt.' };
  // A named context takes precedence over DOCKER_HOST, as in Docker's CLI.
  if (!context && environment.DOCKER_HOST) return isLocalDockerEndpoint(environment.DOCKER_HOST)
    ? { ok: true, host: environment.DOCKER_HOST }
    : { ok: false, reason: 'Docker peger ikke på et verificeret lokalt endpoint. Ingen projektkode blev kørt.' };
  const result = await runner('docker', ['context', 'inspect', ...(context ? [context] : []), '--format', '{{json .Endpoints.docker.Host}}'], 12_000);
  let host;
  try { host = JSON.parse(result.output); } catch { /* Fail closed on unknown CLI output. */ }
  if (!result.ok || !isLocalDockerEndpoint(host)) return { ok: false,
    reason: 'Docker mangler, eller den valgte kontekst har ikke et verificeret lokalt endpoint. Ingen projektkode blev kørt.' };
  return { ok: true, host };
}
