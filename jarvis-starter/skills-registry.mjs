import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Kun versionsstyrede, gennemgåede procedurer; ikke eksterne eller brugerskrevne filer.
const BUILTIN_SKILLS = ['daily-briefing', 'personal-follow-up', 'gift-planning', 'meal-planning'];

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
  return { name: meta.name, version: meta.version, description: meta.description, triggers,
    // Bundled procedures are descriptive guidance only; registry metadata
    // cannot grant tool, network, data source or recipient permissions.
    permissions: 'existing-authorized-tools-only',
    body: match[2].trim() };
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
    const path = join(root, 'skills', name, 'SKILL.md');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 12000) throw new Error(`Skill-fil må kun være almindelig fil: ${name}`);
    result.push(parseSkill(await readFile(path, 'utf8'), name));
  }
  return new SkillsRegistry(result);
}

export class SkillsRegistry {
  constructor(skills = []) { this.skills = skills; }
  catalog() { return this.skills.map(skill => ({ name: skill.name, version: skill.version,
    description: skill.description, triggers: [...(skill.triggers || [])], permissions: skill.permissions,
    contentHash: skillContentHash(skill) })); }
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
      contentHash: skillContentHash(skill), sourceId: `skill:${skill.name}:${skill.version}` };
  }
  resolve(id, version) {
    const matches = this.skills.filter(item => item.name === id && item.version === version);
    if (!matches.length) throw new Error('Skill eller version findes ikke i det gennemgåede katalog.');
    if (matches.length !== 1) throw new Error('Skill-versionen er tvetydig; ingen procedure kan bindes til jobbet.');
    return matches[0];
  }
  relevant(query, limit = 2) {
    const normalized = String(query || '').toLocaleLowerCase('da-DK');
    return this.skills.map(skill => ({ skill, score: skill.triggers.filter(trigger => normalized.includes(trigger)).length }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, Math.min(3, limit))).map(({ skill }) => skill);
  }
  context(query) {
    return this.relevant(query).map(x => `## Procedure: ${x.name}\n${x.body}`).join('\n\n').slice(0, 12000);
  }
}
