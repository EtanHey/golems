#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));

// Dependency-free evaluator for the keywords used by model-roles.schema.json.
// Defaults annotate the contract; they do not mutate the lead-owned config.
export function validate(value, schema, path = '$', errors = []) {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type && !(schema.type === 'integer' ? Number.isInteger(value) : type === schema.type)) {
    errors.push(`${path}: expected ${schema.type}`); return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: invalid enum value`);
  if (type === 'string' && value.length < (schema.minLength ?? 0)) errors.push(`${path}: empty string`);
  if (type === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    if (Object.keys(value).length < (schema.minProperties ?? 0)) errors.push(`${path}: too few properties`);
    for (const [key, child] of Object.entries(value)) {
      const rule = schema.properties?.[key] ?? schema.additionalProperties;
      if (rule === false) errors.push(`${path}.${key}: unexpected property`);
      else if (rule && typeof rule === 'object') validate(child, rule, `${path}.${key}`, errors);
    }
  }
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0)) errors.push(`${path}: too few items`);
    if (schema.items) value.forEach((child, i) => validate(child, schema.items, `${path}[${i}]`, errors));
  }
  return errors;
}
export function loadConfig(root = REPO) {
  const config = readJSON(join(root, 'standards/model-roles.json'));
  const errors = validate(config, readJSON(join(root, 'standards/model-roles.schema.json')));
  if (errors.length) throw new Error(errors.join('\n'));
  return config;
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() && path.endsWith('.md') ? [path] : [];
  });
}
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function lint(root, config, allow) {
  for (const entry of allow) {
    if (!entry.file || !entry.marker?.trim() || !entry.reason?.trim()) throw new Error('allowlist requires file, marker and reason');
  }
  const tokens = [...new Set(Object.values(config.roles).flatMap(role => [role.model, role.alias, role.launcher_tier].filter(Boolean)))];
  const owned = new RegExp(`(?<![\\w.-])(?:${tokens.map(escape).join('|')})(?![\\w-]|\\.\\w)`, 'i');
  const result = { hits: [], exemptions: [], notices: [] };
  const files = [...walk(join(root, 'skills')), ...readdirSync(join(root, 'standards')).filter(n => n.endsWith('.md')).map(n => join(root, 'standards', n))];
  for (const file of files.sort()) {
    const rel = relative(root, file); const lines = readFileSync(file, 'utf8').split('\n');
    const packagedAgent = /\/agents\//.test(rel);
    const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    const front = end > 0 ? lines.slice(1, end) : [];
    const field = key => front.find(line => new RegExp(`^${key}:`).test(line))?.split(':').slice(1).join(':').trim().replace(/^(['"])(.*)\1$/, '$2');
    const role = field('role'); const model = field('model');
    if (packagedAgent && !role) result.notices.push(`${rel}: agent without role; frontmatter migration deferred to PR2-wiring`);
    if (packagedAgent && role && (!config.roles[role]?.alias || model !== config.roles[role].alias)) {
      result.hits.push({ file: rel, line: front.findIndex(l => /^model:/.test(l)) + 2, text: `role/model mismatch: ${role} requires ${config.roles[role]?.alias ?? 'a known role with alias'}, got ${model ?? 'missing'}` });
    }
    let evidenceLevel = null; let fence = null;
    lines.forEach((text, i) => {
      const heading = !fence && text.match(/^ {0,3}(#{1,6})\s+(.+)$/);
      if (heading) {
        if (evidenceLevel !== null && heading[1].length <= evidenceLevel) evidenceLevel = null;
        if (/evidence/i.test(heading[2])) evidenceLevel ??= heading[1].length;
      }
      const delimiter = text.match(/^\s*(`{3,}|~{3,})/);
      if (delimiter) fence = fence === delimiter[1][0] ? null : fence ?? delimiter[1][0];
      if (!owned.test(text)) return;
      const where = `${rel}:${i + 1}`;
      if (packagedAgent && i > 0 && i < end) return; // Checked above, or explicitly noticed as migration.
      const excluded = allow.find(entry => entry.file === rel && text.includes(entry.marker));
      const reason = evidenceLevel !== null ? 'Evidence heading' : /2026-/.test(text) ? 'dated history' : excluded?.reason;
      if (reason) { result.exemptions.push(`${where}: ${reason}`); return; }
      // Commands, routing tables and imperative prose prescribe models. Other mentions
      // are reported for audit rather than silently treated as instructions.
      if (fence || /(?:→|->)/.test(text) || /^\s*model\s*:/.test(text) || /\|/.test(text) || /(?:--model|(?:^|\s|`)-m\s)/.test(text) || /\b(use|uses|using|run|runs|spawn|spawns|launch|launches|route|routes|routing|pick|select|choose|default|defaults|must|should|prefer|pin|pins|set|assign|implement|implements|review|reviews|gather|stays|for)\b/i.test(text)) {
        result.hits.push({ file: rel, line: i + 1, text: text.trim() });
      } else result.notices.push(`${where}: model mention (non-prescriptive): ${text.trim()}`);
    });
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = loadConfig();
    const allow = process.argv.includes('--report-only') ? [] : readJSON(join(REPO, 'scripts/ci/model-role-allowlist.json')).exclusions;
    const result = lint(REPO, config, allow);
    for (const notice of result.notices) console.log(`NOTICE ${notice}`);
    for (const exemption of result.exemptions) console.log(`EXEMPT ${exemption}`);
    for (const hit of result.hits) console.log(`${hit.file}:${hit.line}: ${hit.text}`);
    console.log(`${result.hits.length ? 'FAIL' : 'OK'} ${result.hits.length} model-role drift hits; ${result.exemptions.length} exemptions; ${result.notices.length} notices`);
    process.exitCode = result.hits.length && !process.argv.includes('--report-only') ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
