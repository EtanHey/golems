#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, REPO } from './ci/check-model-role-drift.mjs';
// Etan 2026-10-04, via orc: mechanical internal children use the mechanical role.
// This exception covers Codex-internal mechanical children only, not workers.
export function resolveModelRole(name, root = REPO, { use } = {}) {
  const roles = loadConfig(root).roles;
  const role = Object.hasOwn(roles, name) ? roles[name] : undefined;
  const internal = name === 'codex.subagent.mechanical' && use === 'codex-internal-subagent';
  if (!role || typeof role.model !== 'string' || (role.status === 'candidate' && !internal)) throw new Error(`unknown or unbenched model role: ${name}`);
  return role.model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const stable = argv.at(-1) === '--stable';
  if (stable) argv.pop();
  const [name, flag, requested, ...extra] = argv;
  const fields = ['model', 'alias', 'launcher_tier'];
  const field = flag === '--field' ? requested : 'model';
  try {
    if (!name || (flag && flag !== '--field') || !fields.includes(field) || extra.length) throw new Error('usage: model-roles.mjs <role> [--field model|alias|launcher_tier] [--stable]');
    const role = loadConfig(process.env.GOLEMS_MODEL_ROLES_ROOT ?? REPO).roles[name];
    if (!role || !Object.hasOwn(role, field)) throw new Error(`unknown role or unavailable field: ${name}.${field}`);
    if (role.status === 'candidate') throw new Error(`unbenched model role: ${name}`);
    console.log(role[field]);
  } catch (error) { console.error(error.message); process.exitCode = 2; }

}
