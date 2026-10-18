#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, REPO } from './ci/check-model-role-drift.mjs';
// Etan 2026-10-04, via orc: mechanical internal children use the mechanical role.
// This exception covers Codex-internal mechanical children only, not workers.
// Etan 2026-10-18 23:25, via orc collab: "Watching: anything that must sit and watch (a PR, CI, a file)
// uses a cheap gpt-6-luna sub-agent". Callers opt in per purpose with --use / { use }.
const CANDIDATE_USES = { 'codex.subagent.mechanical': ['codex-internal-subagent', 'watcher'] };
const authorised = (name, use) => Object.hasOwn(CANDIDATE_USES, name) && CANDIDATE_USES[name].includes(use);
export function resolveModelRole(name, root = REPO, { use } = {}) {
  const roles = loadConfig(root).roles;
  const role = Object.hasOwn(roles, name) ? roles[name] : undefined;
  if (!role || typeof role.model !== 'string' || (role.status === 'candidate' && !authorised(name, use))) throw new Error(`unknown or unbenched model role: ${name}`);
  return role.model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const stable = argv.at(-1) === '--stable';
  if (stable) argv.pop();
  const usage = 'usage: model-roles.mjs <role> [--field model|alias|launcher_tier] [--use <purpose>] [--stable]';
  const fields = ['model', 'alias', 'launcher_tier'];
  const [name, ...rest] = argv;
  const opts = {};
  try {
    if (!name || name.startsWith('--')) throw new Error(usage);
    while (rest.length) {
      const flag = rest.shift();
      const key = flag === '--field' ? 'field' : flag === '--use' ? 'use' : undefined;
      const value = rest.shift();
      if (!key || Object.hasOwn(opts, key) || !value || value.startsWith('--')) throw new Error(usage);
      opts[key] = value;
    }
    const field = opts.field ?? 'model';
    if (!fields.includes(field)) throw new Error(usage);
    const role = loadConfig(process.env.GOLEMS_MODEL_ROLES_ROOT ?? REPO).roles[name];
    if (!role || !Object.hasOwn(role, field)) throw new Error(`unknown role or unavailable field: ${name}.${field}`);
    if (role.status === 'candidate' && !authorised(name, opts.use)) throw new Error(`unbenched model role: ${name}`);
    console.log(role[field]);
  } catch (error) { console.error(error.message); process.exitCode = 2; }

}
