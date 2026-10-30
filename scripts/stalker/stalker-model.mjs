import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, validate, REPO } from '../ci/check-model-role-drift.mjs';

export function resolveStalkerModel(provider = 'codex') {
  const route = {
    codex: ['STALKER_CODEX_MODEL', 'codex.implement', 'model'],
    agy: ['STALKER_AGY_MODEL', 'gemini.gather.text', 'model'],
  }[provider];
  if (!route) throw new Error(`Stalker: unknown model provider ${provider}`);
  const [override, role, field] = route;
  let roles;
  try {
    const root = process.env.GOLEMS_MODEL_ROLES_ROOT ?? REPO;
    const config = readJSON(join(root, 'standards/model-roles.json'));
    const schema = readJSON(join(root, 'standards/model-roles.schema.json'));
    // Codex policy depends on every Codex row; agy needs only its selected role.
    // Global validation remains in the owning lint, independent of CLI availability.
    roles = config.roles;
    if (roles && typeof roles === 'object' && !Array.isArray(roles)) {
      roles = Object.fromEntries(Object.entries(roles).filter(([name]) => provider === 'codex' ? name.startsWith('codex.') : name === role));
    }
    const errors = validate({ ...config, roles }, schema);
    if (errors.length) throw new Error(errors.join('\n'));
    if (!Object.hasOwn(roles, role)) throw new Error(`unknown role: ${role}`);
    if (roles[role].status === 'candidate') throw new Error(`unbenched model role: ${role}`);
    for (const [name, row] of Object.entries(roles)) {
      if (!row.model.trim() || /^gpt-5\.6-/i.test(row.model.trim())) throw new Error(`forbidden or empty model for ${name}: ${row.model}`);
    }
  } catch (error) {
    throw new Error(`Stalker: cannot resolve ${role}.${field} (${provider}): ${error.message}`);
  }
  const model = process.env[override] || roles[role][field];
  if (!model.trim() || /^gpt-5\.6-/i.test(model.trim())) throw new Error(`Stalker: forbidden or empty model for ${role} (${override}): ${model}`);
  if (provider === 'codex') {
    const allowed = new Set(Object.values(roles).map(row => row.model));
    if (!allowed.has(model)) throw new Error(`Stalker: forbidden model for ${role} (${override}): ${model}`);
  }
  return model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(resolveStalkerModel(process.argv[2])); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
