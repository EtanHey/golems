import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveStalkerModel(provider = 'codex') {
  const route = {
    codex: ['STALKER_CODEX_MODEL', 'codex.implement', 'model'],
    agy: ['STALKER_AGY_MODEL', 'gemini.gather.text', 'launcher_tier'],
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
  return model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(resolveStalkerModel(process.argv[2])); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
