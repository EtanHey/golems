#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const TOOLS = 'Read,Grep,Glob,WebSearch,WebFetch';
const fail = code => { const error = new Error(code); error.verifierCode = code; throw error; };
const decoded = text => text.replace(/\\u([a-f\d]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const hasKey = (text, key) => String(text).includes(key) || decoded(String(text)).includes(key);
function redact(value, key) {
  if (typeof value === 'string') {
    if (value.includes(key)) return value.split(key).join('[REDACTED_API_KEY]');
    return hasKey(value, key) ? '[REDACTED_API_KEY]' : value;
  }
  if (Array.isArray(value)) return value.map(v => redact(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k, key), redact(v, key)]));
  return value;
}
// Never open links, devices or FIFOs. Unreadable/unscannable cell contents fail closed.
async function scan(dir, key) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (hasKey(file, key)) fail('CELL_SECRET_LEAK');
    if (entry.isDirectory()) await scan(file, key);
    else {
      if (!entry.isFile()) fail('UNSCANNABLE_CELL');
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (!(await handle.stat()).isFile() || hasKey(await handle.readFile('utf8'), key)) fail('CELL_SECRET_LEAK');
      } finally { await handle.close(); }
    }
  }
}
async function verifySection({ promptFile, out, role, budgetUsd, timeoutMs = 900000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) fail('API_KEY_MISSING');
  if (![promptFile, out, role].every(v => typeof v === 'string' && v && !hasKey(v, key))) fail('INVALID_ARGUMENTS');
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) fail('BUDGET_REQUIRED');
  let resolveModelRole;
  try { ({ resolveModelRole } = await import('../../../../scripts/model-roles.mjs')); }
  catch { fail('GOLEMS_CHECKOUT_REQUIRED'); }
  const model = resolveModelRole(role);
  if (!model.startsWith('claude-')) fail('CLAUDE_ROLE_REQUIRED');
  const prompt = await readFile(promptFile, 'utf8');
  if (hasKey(prompt, key)) fail('PROMPT_SECRET_LEAK');
  const parent = path.join(homedir(), '.local', 'share', 'research-verifier-cells');
  if (hasKey(parent, key)) fail('INVALID_HOME');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const cell = await mkdtemp(path.join(parent, 'cell-'));
  let failure, record;
  try {
    const settings = path.join(cell, 'settings.json');
    const protectedPaths = ['.config', '.ssh', '.codex', '.claude'].flatMap(dir => [path.join(homedir(), dir), path.join(homedir(), dir, '**')]);
    protectedPaths.push(path.join(homedir(), '.claude.json'), path.join(homedir(), '.config/golems/anthropic-api.env'), cell, path.join(cell, '**'));
    const deny = ['Read', 'Grep', 'Glob'].flatMap(tool => protectedPaths.map(file => `${tool}(/${file})`));
    await writeFile(settings, JSON.stringify({ disableAllHooks: true, permissions: { deny } }), { mode: 0o600 });
    const env = { HOME: cell, CLAUDE_CONFIG_DIR: path.join(cell, '.claude'), PATH: process.env.PATH,
      LANG: 'en_US.UTF-8', ANTHROPIC_API_KEY: key, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
    const args = ['--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--settings', settings, '--disable-slash-commands', '--tools', TOOLS, '--allowedTools', TOOLS,
      '--permission-mode', 'dontAsk', '--model', model, '--effort', 'high',
      '--max-budget-usd', String(budgetUsd), '--output-format', 'json', '--verbose', '-p', prompt];
    const raw = await new Promise((resolve, reject) => {
      const child = execFile('claude', args, { env, cwd: cell, detached: true,
        timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') return reject(new Error('CHILD_REAP_FAILED')); }
        if (error) return reject(new Error('CHILD_FAILED'));
        resolve(stdout);
      });
    });
    const events = JSON.parse(raw);
    if (!Array.isArray(events)) fail('INIT_REQUIRED');
    const inits = events.filter(e => e?.type === 'system' && e.subtype === 'init');
    if (inits.length !== 1 || inits[0].apiKeySource !== 'ANTHROPIC_API_KEY') fail('API_KEY_SOURCE_MISMATCH');
    if (inits[0].fast_mode_state !== 'off') fail('FAST_MODE_REFUSED');
    const result = events.findLast(e => e?.type === 'result');
    if (!result || result.is_error || result.subtype !== 'success') fail('RESULT_FAILED');
    // WebFetch may bill a pinned mechanical helper in addition to the primary.
    const allowedModels = new Set([model, resolveModelRole('claude.subagent.mechanical')]);
    const primaryModels = events.filter(e => e?.type === 'assistant').map(e => e.message?.model);
    const billedModels = Object.keys(result.modelUsage ?? {});
    if (inits[0].model !== model || !primaryModels.length || primaryModels.some(m => m !== model) ||
      !billedModels.includes(model) || billedModels.some(m => !allowedModels.has(m))) fail('MODEL_MISMATCH');
    await scan(cell, key);
    record = redact({ auth: 'api-key', apiKeySource: inits[0].apiKeySource, model, effort_requested: 'high',
      tool_calls: events.filter(e => e?.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c.type === 'tool_use')),
      tool_results: events.filter(e => e?.type === 'user').flatMap(e => (Array.isArray(e.message?.content) ? e.message.content : []).filter(c => c.type === 'tool_result')), result }, key);
    if (hasKey(JSON.stringify(record), key)) fail('OUTPUT_SECRET_LEAK');
  } catch (error) { failure = error; }
  try { await rm(cell, { recursive: true, force: true }); } catch { failure = new Error('CELL_CLEANUP_FAILED'); }
  if (failure) throw failure;
  // Raw output and credentials never enter the report tree. Replace only with sanitized JSON.
  const destination = path.resolve(out);
  await mkdir(path.dirname(destination), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(destination), '.verify-output-'));
  try {
    await writeFile(path.join(stage, 'result.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    await rename(path.join(stage, 'result.json'), destination);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  try {
    const flags = new Map();
    for (let i = 2; i < process.argv.length; i += 2) {
      const flag = process.argv[i], value = process.argv[i + 1];
      if (!['--prompt-file', '--out', '--role', '--budget-usd'].includes(flag) || !value || flags.has(flag)) fail('INVALID_ARGUMENTS');
      flags.set(flag, value);
    }
    await verifySection({ promptFile: flags.get('--prompt-file'), out: flags.get('--out'), role: flags.get('--role'), budgetUsd: Number(flags.get('--budget-usd')) });
  } catch (error) {
    // No child stderr, exception paths, command arguments or raw output cross this boundary.
    console.error('research verifier failed: ' + (error.verifierCode ?? 'EXECUTION_OR_CLEANUP'));
    process.exitCode = 1;
  }
}
