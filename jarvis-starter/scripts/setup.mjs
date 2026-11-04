import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const path = join(process.cwd(), '.env');
try {
  await access(path);
  console.log('Der findes allerede en .env-fil. Den er ikke blevet overskrevet.');
  process.exit(0);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const token = randomBytes(24).toString('hex');
const content = [
  '# Behold denne fil privat. Del aldrig nøgler i en chat.',
  'OPENAI_API_KEY=REPLACE_WITH_YOUR_OWN_KEY',
  `JARVIS_ACCESS_TOKEN=${token}`,
  'OPENAI_TEXT_MODEL=gpt-6.1-sol',
  'OPENAI_VOICE_MODEL=gpt-realtime-2.1',
  'JARVIS_PORT=8787',
  'JARVIS_HOST=127.0.0.1',
  '',
].join('\n');
await writeFile(path, content, { flag: 'wx', mode: 0o600 });
console.log('Oprettet .env med en tilfældig adgangskode.');
console.log('1. Åbn .env i Notesblok og erstat REPLACE_WITH_YOUR_OWN_KEY med din OpenAI API-nøgle.');
console.log('2. Start med npm start.');
console.log('3. Indsæt JARVIS_ACCESS_TOKEN fra .env i webappens loginfelt.');
