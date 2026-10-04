#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, REPO } from './ci/check-model-role-drift.mjs';
export function resolveModelRole(name, root = REPO) {
  const role = loadConfig(root).roles[name];
  if (!role || role.status === 'candidate') throw new Error(`unknown or unbenched model role: ${name}`);
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
    if (stable && role.status === 'candidate') throw new Error(`unbenched model role: ${name}`);
    if (role.status === 'candidate') console.error('candidate: bench before use');
    console.log(role[field]);
  } catch (error) { console.error(error.message); process.exitCode = 2; }

}
