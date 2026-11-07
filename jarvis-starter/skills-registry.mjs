import { reviewedResearchSkills } from './skill-capabilities.mjs';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Kun versionsstyrede, gennemgåede procedurer; ikke eksterne eller brugerskrevne filer.
const BUILTIN_SKILLS = ['daily-briefing', 'personal-follow-up', 'gift-planning', 'meal-planning'];
const CURRENT_VERSION = '1.1.0';
const CONTRACT_FIELDS = ['schemaVersion', 'purpose', 'inputs', 'outputs', 'sources', 'tools', 'budget', 'unknownPolicy', 'examples', 'tests'];
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value, max = 1500) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const list = (value, maxItems = 12) => Array.isArray(value) && value.length > 0 && value.length <= maxItems && value.every(item => text(item, 500));
function immutable(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested);
    Object.freeze(value);
  }
  return value;
}

function parseContract(body, expectedName) {
  const fail = () => { throw new Error(`Ugyldig hash-bundet procedurekontrakt: ${expectedName}`); };
  const blocks = [...body.matchAll(/^## Kontrakt\n\n```json\n([\s\S]*?)\n```(?:\n|$)/gm)];
  if (blocks.length !== 1) fail();
  let contract; try { contract = JSON.parse(blocks[0][1]); } catch { fail(); }
  if (!plain(contract) || Object.keys(contract).length !== CONTRACT_FIELDS.length || CONTRACT_FIELDS.some(key => !Object.hasOwn(contract, key)) ||
      contract.schemaVersion !== 1 || !text(contract.purpose) || !list(contract.inputs) || !list(contract.outputs) ||
      !list(contract.sources) || !list(contract.tools) || !text(contract.unknownPolicy) ||
      !Array.isArray(contract.examples) || contract.examples.length < 2 || contract.examples.length > 6 ||
      contract.examples.some(example => !plain(example) || Object.keys(example).sort().join() !== 'expected,input' || !text(example.input) || !text(example.expected)) ||
      !list(contract.tests) || contract.tests.some(path => !/^test\/[a-z0-9-]+\.test\.mjs$/.test(path))) fail();
  const budget = contract.budget;
  if (!plain(budget) || Object.keys(budget).sort().join() !== 'authority,defaults,maxResults' || budget.authority !== 'reviewed-job-policy' ||
      !plain(budget.defaults) || Object.keys(budget.defaults).sort().join() !== 'maxOutputTokens,maxRunsPerDay' ||
      !Number.isInteger(budget.defaults.maxRunsPerDay) || budget.defaults.maxRunsPerDay < 1 || budget.defaults.maxRunsPerDay > 100 ||
      !Number.isInteger(budget.defaults.maxOutputTokens) || budget.defaults.maxOutputTokens < 256 || budget.defaults.maxOutputTokens > 12000 ||
      !Number.isInteger(budget.maxResults) || budget.maxResults < 1 || budget.maxResults > 20) fail();
  return contract;
}

function parseSkill(text, expectedName) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match || text.length > 12000) throw new Error(`Ugyldigt SKILL.md: ${expectedName}`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const field = /^([a-z]+):\s*(.+)$/.exec(line);
    if (!field || Object.hasOwn(meta, field[1])) throw new Error(`Ugyldige skill-metadata: ${expectedName}`);
    meta[field[1]] = field[2].trim();
  }
  if (meta.name !== expectedName || !meta.description || !meta.triggers || !match[2].trim() || match[2].trim().length > 8500 ||
      !/^\d+\.\d+\.\d+$/.test(meta.version || '')) throw new Error(`Manglende skill-felter: ${expectedName}`);
  const triggers = meta.triggers.split(',').map(value => value.trim().toLocaleLowerCase('da-DK')).filter(Boolean);
  if (!triggers.length || triggers.length > 20 || meta.description.length > 250) throw new Error(`Ugyldige skill-felter: ${expectedName}`);
  const body = match[2].trim();
  if (meta.contract !== undefined && meta.contract !== '1') throw new Error(`Ukendt procedurekontrakt: ${expectedName}`);
  const contract = meta.contract === '1' ? parseContract(body, expectedName) : undefined;
  return { name: meta.name, version: meta.version, description: meta.description, triggers,
    // Bundled procedures are descriptive guidance only; registry metadata
    // cannot grant tool, network, data source or recipient permissions.
    permissions: 'existing-authorized-tools-only',
    body, ...(contract ? { contract } : {}) };
}

// Keep this serialization stable: persisted job approvals already use it.
// A displayed procedure and a running job must bind the same complete body.
export function skillContentHash(skill) {
  return createHash('sha256').update(JSON.stringify({ name: skill.name, version: skill.version,
    permissions: skill.permissions, body: skill.body })).digest('hex');
}

export async function loadBundledSkills(root) {
  const result = [];
  for (const name of BUILTIN_SKILLS) {
    // The original 1.0.0 path remains byte-for-byte historical. New procedures
    // are separate, allowlisted files; no filesystem scan may load new skills.
    for (const version of ['1.0.0', CURRENT_VERSION]) {
      const segments = version === '1.0.0' ? [] : ['versions', version];
      const path = join(root, 'skills', name, ...segments, 'SKILL.md');
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 12000) throw new Error(`Skill-fil må kun være almindelig fil: ${name}`);
      const skill = parseSkill(await readFile(path, 'utf8'), name);
      if (skill.version !== version || version === CURRENT_VERSION && !skill.contract) throw new Error(`Skill-versionen matcher ikke det gennemgåede manifest: ${name}`);
      result.push(immutable(skill));
    }
  }
  return new SkillsRegistry([...result, ...reviewedResearchSkills().map(immutable)]);
}

export class SkillsRegistry {
  constructor(skills = []) { this.skills = skills; }
  catalog() { return this.skills.map(skill => ({ name: skill.name, version: skill.version,
    description: skill.description, triggers: [...(skill.triggers || [])], permissions: skill.permissions,
    current: this.current(skill.name).version === skill.version, contentHash: skillContentHash(skill),
    ...(skill.contract ? { contractVersion: skill.contract.schemaVersion, budgetDefaults: { ...skill.contract.budget.defaults } } : {}) }))
    .sort((left, right) => left.name.localeCompare(right.name) || Number(right.current) - Number(left.current)); }
  detail(id, version) {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(id) || typeof version !== 'string' ||
        version.length > 32 || !/^\d+\.\d+\.\d+$/.test(version)) {
      const error = new Error('Angiv det præcise skill-ID og versionsnummer.'); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
    }
    const matches = this.skills.filter(item => item.name === id && item.version === version);
    if (matches.length !== 1) {
      const error = new Error(matches.length ? 'Skill-versionen er tvetydig og kan ikke gennemgås.'
        : 'Denne præcise skill-version findes ikke i det gennemgåede katalog. Ingen anden version er åbnet.');
      error.status = matches.length ? 409 : 404; error.code = matches.length ? 'SKILL_VERSION_CONFLICT' : 'SKILL_NOT_FOUND'; throw error;
    }
    const skill = matches[0];
    return { name: skill.name, version: skill.version, description: skill.description,
      triggers: [...(skill.triggers || [])], permissions: skill.permissions, body: skill.body,
      current: this.current(skill.name).version === skill.version,
      ...(skill.contract ? { contract: structuredClone(skill.contract) } : {}),
      contentHash: skillContentHash(skill), sourceId: `skill:${skill.name}:${skill.version}` };
  }
  resolve(id, version) {
    const matches = this.skills.filter(item => item.name === id && item.version === version);
    if (!matches.length) throw new Error('Skill eller version findes ikke i det gennemgåede katalog.');
    if (matches.length !== 1) throw new Error('Skill-versionen er tvetydig; ingen procedure kan bindes til jobbet.');
    return matches[0];
  }
  current(id) {
    const versions = this.skills.filter(skill => skill.name === id);
    if (!versions.length) throw new Error('Proceduren findes ikke i det gennemgåede katalog.');
    const compare = (left, right) => {
      const a = left.version.split('.').map(BigInt), b = right.version.split('.').map(BigInt);
      for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] < b[index] ? 1 : -1;
      return 0;
    };
    return this.resolve(id, versions.sort(compare)[0].version);
  }
  relevant(query, limit = 2) {
    const explicit = /^Brug ([a-z][a-z0-9-]{0,79}) version (\d+\.\d+\.\d+):(?:\s|$)/i.exec(String(query||''));
    if(explicit)return [this.resolve(explicit[1].toLowerCase(),explicit[2])];
    const normalized = String(query || '').normalize('NFKC').toLocaleLowerCase('da-DK');
    const words = normalized.match(/[\p{L}\p{N}-]+/gu) || [];
    const matches = trigger => {
      const phrase = trigger.normalize('NFKC').toLocaleLowerCase('da-DK').match(/[\p{L}\p{N}-]+/gu) || [];
      return phrase.length && words.some((_,i)=>phrase.every((word,j)=>words[i+j] === word ||
        (j === phrase.length-1 && ['en','et','er','ne','ene'].some(suffix=>words[i+j] === word+suffix))));
    };
    return [...new Set(this.skills.map(skill => skill.name))].map(id => this.current(id))
      .map(skill => ({ skill, score: words.includes(skill.name) ? 100 : (skill.triggers || []).filter(matches).length }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, Math.min(3, limit))).map(({ skill }) => skill);
  }
  context(query) {
    let context = '';
    for (const skill of this.relevant(query)) {
      const entry = `## Procedure: ${skill.name} · version ${skill.version}\n${skill.body}`;
      if ((context + '\n\n' + entry).length <= 12000) context += (context ? '\n\n' : '') + entry;
    }
    return context;
  }
  selectionGuide() {
    const current=[...new Set(this.skills.map(s=>s.name))].map(id=>this.current(id));
    return 'Vælg arbejdsprocedure ud fra brugerens danske hensigt og formål, ikke kun et nøgleord. Hvis mål, sted, dato eller ønsket gemning er tvetydig og afgørende, stil ét kort afklarende spørgsmål før handling. Kataloget giver ingen nye rettigheder og aktiverer ingen integration. Brug søgeværktøjet til aktuelle fakta; hævd ikke liveadgang uden et resultat.\n'+current.map(s=>`${s.name} v${s.version}: ${s.description}`).join('\n');
  }
}
