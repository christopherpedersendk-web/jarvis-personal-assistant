import { readFile } from 'node:fs/promises';
import { validateReleasePackage } from '../update-manager.mjs';
const tag = process.argv[2];
if (!tag) throw new Error('Angiv det præcise release-tag, fx v5.1.1.');
const version = validateReleasePackage(await readFile(new URL('../package.json', import.meta.url), 'utf8'), tag);
console.log(`Release-metadata verificeret: ${tag} / ${version}`);
