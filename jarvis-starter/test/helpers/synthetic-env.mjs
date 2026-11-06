import { isAbsolute, join } from 'node:path';

// Test servers get explicit disposable paths and a small OS-runtime whitelist.
// Do not inherit credentials, Node preload hooks, home configuration, proxies,
// Git helpers or live integration flags from the test runner's environment.
const RUNTIME_ENV = ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP'];
export function syntheticServerEnv({ dataDir, accessToken, port, timeZone = 'Europe/Copenhagen',
  browserResearch = false, modelKey = 'REPLACE_WITH_YOUR_OWN_KEY' }, inherited = process.env) {
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) throw new Error('Synthetic dataDir must be an absolute temporary path.');
  if (typeof accessToken !== 'string' || accessToken.length < 24) throw new Error('A synthetic access token is required.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('An explicit local test port is required.');
  if (modelKey !== 'REPLACE_WITH_YOUR_OWN_KEY' && !/^sk-synthetic-[A-Za-z0-9-]+$/.test(modelKey))
    throw new Error('Only a clearly synthetic model key is allowed in this fixture.');
  return {
    ...Object.fromEntries(RUNTIME_ENV.filter(name => typeof inherited[name] === 'string' && inherited[name])
      .map(name => [name, inherited[name]])),
    JARVIS_BROWSER_RESEARCH: browserResearch === true ? 'yes' : 'no',
    TZ: timeZone, JARVIS_HOST: '127.0.0.1', JARVIS_PORT: String(port), JARVIS_ACCESS_TOKEN: accessToken,
    JARVIS_DATA_DIR: dataDir, JARVIS_PROJECT_ROOT: join(dataDir, 'projects'), JARVIS_UPDATE_STAGING: join(dataDir, 'update-staging'),
    JARVIS_UPDATE_REPO: '', JARVIS_ALLOW_NPM_INSTALL: 'no', JARVIS_MAX_RUNS_PER_DAY: '10',
    OPENAI_API_KEY: modelKey, JARVIS_LOCAL_SEMANTIC: 'no', JARVIS_LOCAL_EMBEDDING_DIR: '',
    NEMLIG_ENABLE_LIVE: 'no', NEMLIG_MCP_DIR: '', NEMLIG_MCP_UV: '', NEMLIG_USER: '', NEMLIG_PASS: '',
    GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', GOOGLE_OAUTH_REDIRECT_URI: '',
    PUSHOVER_APP_TOKEN: '', PUSHOVER_USER_KEY: '', DISCORD_BOT_TOKEN: '',
  };
}
