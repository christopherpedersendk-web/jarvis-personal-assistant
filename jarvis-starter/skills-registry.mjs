import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

// Kun versionsstyrede, gennemgåede procedurer; ikke eksterne eller brugerskrevne filer.
const BUILTIN_SKILLS = ['daily-briefing', 'personal-follow-up', 'gift-planning'];

function parseSkill(text, expectedName) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match || text.length > 12000) throw new Error(`Ugyldigt SKILL.md: ${expectedName}`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const field = /^([a-z]+):\s*(.+)$/.exec(line);
    if (!field || Object.hasOwn(meta, field[1])) throw new Error(`Ugyldige skill-metadata: ${expectedName}`);
    meta[field[1]] = field[2].trim();
  }
  if (meta.name !== expectedName || !meta.description || !meta.triggers || !match[2].trim()) throw new Error(`Manglende skill-felter: ${expectedName}`);
  const triggers = meta.triggers.split(',').map(value => value.trim().toLocaleLowerCase('da-DK')).filter(Boolean);
  if (!triggers.length || triggers.length > 20 || meta.description.length > 250) throw new Error(`Ugyldige skill-felter: ${expectedName}`);
  return { name: meta.name, description: meta.description, triggers, body: match[2].trim().slice(0, 8500) };
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
  catalog() { return this.skills.map(({ name, description, triggers }) => ({ name, description, triggers })); }
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
