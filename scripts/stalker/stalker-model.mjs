import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, REPO } from '../ci/check-model-role-drift.mjs';

export function resolveStalkerModel(provider = 'codex') {
  const route = {
    codex: ['STALKER_CODEX_MODEL', 'codex.implement', 'model'],
    agy: ['STALKER_AGY_MODEL', 'gemini.gather.text', 'model'],
  }[provider];
  if (!route) throw new Error(`Stalker: unknown model provider ${provider}`);
  const [override, role, field] = route;
  let model = process.env[override];
  if (!model) {
    try {
      model = execFileSync(process.execPath, [fileURLToPath(new URL('../model-roles.mjs', import.meta.url)), role, '--field', field], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      throw new Error(`Stalker: cannot resolve ${role}.${field}: ${error.stderr || error.message}`);
    }
  }
  if (!model.trim() || /^gpt-5\.6-/i.test(model.trim())) throw new Error(`Stalker: forbidden or empty model for ${override}: ${model}`);
  if (provider === 'codex') {
    let roles;
    try { roles = loadConfig(process.env.GOLEMS_MODEL_ROLES_ROOT ?? REPO).roles; }
    catch (error) { throw new Error(`Stalker: cannot load Codex model allowlist: ${error.message}`); }
    const allowed = new Set(Object.entries(roles).filter(([name]) => name.startsWith('codex.')).map(([, role]) => role.model));
    if (!allowed.has(model)) throw new Error(`Stalker: forbidden model for ${override}: ${model}`);
  }
  return model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(resolveStalkerModel(process.argv[2])); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
