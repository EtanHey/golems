#!/usr/bin/env node
import { loadConfig } from './ci/check-model-role-drift.mjs';
const [name, flag, requested, ...extra] = process.argv.slice(2);
const fields = ['model', 'alias', 'effort', 'launcher_tier'];
const field = flag === '--field' ? requested : 'model';
try {
  if (!name || (flag && flag !== '--field') || !fields.includes(field) || extra.length) throw new Error('usage: model-roles.mjs <role> [--field model|alias|effort|launcher_tier]');
  const role = loadConfig().roles[name];
  if (!role || !Object.hasOwn(role, field)) throw new Error(`unknown role or unavailable field: ${name}.${field}`);
  if (role.status === 'candidate') console.error('candidate: bench before use');
  console.log(role[field]);
} catch (error) { console.error(error.message); process.exitCode = 2; }
