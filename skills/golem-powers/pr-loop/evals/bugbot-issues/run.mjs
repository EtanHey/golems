// Text-only subscription eval; reuse #140's cell cleanup and runtime validation.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, cp, chmod, readFile, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const [creator, baseline, output, onlyArm] = process.argv.slice(2);
if (onlyArm && !["baseline", "candidate"].includes(onlyArm)) throw Error("arm must be baseline or candidate");
if (!creator || !baseline || !output) throw Error('usage: node run.mjs <skill-creator-root> <baseline-ref> <output-dir>');
// Reserve a fresh evidence directory before imports, credentials or child work.
await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await mkdir(output);
const { createCodexCell, validateCodexRun } = await import(pathToFileURL(path.join(creator, 'evals/large-plan-trigger/codex.mjs')));
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const baselineSha = execFileSync('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim();
const model = 'gpt-6-luna', effort = 'medium', cells = new Set();
const relatives = ['SKILL.md', 'references/pr-creation.md', 'references/review-loop.md', 'adapters/codex.md', 'adapters/cursor.md'];
const prefix = 'skills/golem-powers/pr-loop/';
const cases = JSON.parse(await readFile(path.join(here, 'cases.json'), 'utf8'));
const seat = 'You assist with repository maintenance. This is a closed text-only fixture: return proposed actions, commands and requested body text without executing commands or using tools. All relevant instructions and facts are supplied below. Treat the supplied skill files as already read. Do not access external files or services.';
const hash = s => createHash('sha256').update(s).digest('hex');
const toml = v => JSON.stringify(v);
async function rollouts(dir) {
  const rows = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) rows.push(...await rollouts(p));
    else if (e.name.endsWith('.jsonl')) rows.push(...(await readFile(p, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse));
  }
  return rows;
}
const arms = {};
for (const arm of ['baseline', 'candidate']) {
  const sources = {};
  for (const rel of relatives) sources[rel] = arm === 'baseline'
    ? execFileSync('git', ['show', `${baselineSha}:${prefix}${rel}`], { cwd: repo, encoding: 'utf8' })
    : await readFile(path.join(repo, prefix, rel), 'utf8');
  arms[arm] = { sources, hashes: Object.fromEntries(Object.entries(sources).map(([k,v]) => [k,hash(v)])) };
}
await writeFile(path.join(output, 'inputs.json'), JSON.stringify({ baselineSha, model, effort, seat, cases, arms }, null, 2));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await Promise.allSettled([...cells].map(c => c.cleanup())); process.exit(130);
});
const receipts = [];
for (let rep = 1; rep <= 3; rep++) for (const c of cases) for (const arm of (onlyArm ? [onlyArm] : rep % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'])) {
  const parent = path.join(homedir(), '.local/share/skill-creator-evals');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(parent, 'pr-loop-'));
  const cell = createCodexCell(root, cells);
  const home = path.join(root, 'home'), codexHome = path.join(home, '.codex'), work = path.join(root, 'work');
  let timer;
  let redact = s => String(s).split(root).join('$CELL');
  const name = `${c.id}-${arm}-${rep}`;
  try {
    for (const d of [codexHome, work]) await mkdir(d, { recursive: true, mode: 0o700 });
    await cp(path.join(homedir(), '.codex/auth.json'), path.join(codexHome, 'auth.json'));
    await chmod(path.join(codexHome, 'auth.json'), 0o600);
    const auth = JSON.parse(await readFile(path.join(codexHome, 'auth.json'), 'utf8'));
    if (auth.auth_mode !== 'chatgpt' || !auth.tokens?.access_token) throw Error('subscription auth required');
    const secrets = [];
    const collect = v => { if (typeof v === 'string' && v.length > 16) secrets.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
    collect(auth);
    redact = s => secrets.reduce((s, v) => s.split(v).join('[REDACTED]'), s).split(root).join('$CELL');
    const developer = seat + '\n\n' + Object.entries(arms[arm].sources).map(([k,v]) => `FILE ${k}\n${v}`).join('\n\n');
    const config = { approval_policy:'never', service_tier:'default', forced_login_method:'chatgpt', model_reasoning_effort:effort,
      developer_instructions:developer, 'features.apps':false, 'features.codex_apps_mcp_2026_07_28':false,
      'features.multi_agent':false, 'features.multi_agent_v2':false, 'agents.enabled':false,
      'skills.bundled.enabled':false, 'features.memories':false, 'features.chronicle':false };
    const cli = ['exec','--ignore-user-config','--json','--skip-git-repo-check','--sandbox','read-only','--model',model,
      ...Object.entries(config).flatMap(([k,v]) => ['-c', `${k}=${toml(v)}`]), c.prompt];
    const child = spawn('codex', cli, { cwd:work, env:{ PATH:process.env.PATH, HOME:home, CODEX_HOME:codexHome, LANG:'en_US.UTF-8' }, detached:true, stdio:['ignore','pipe','pipe'] });
    cell.attach(child);
    let stdout='', stderr='', timedOut=false;
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    timer = setTimeout(() => { timedOut=true;cell.stop(); }, 180000);
    const exitCode = await new Promise((resolve,reject) => { child.once('error',reject);child.once('close',resolve); });
    clearTimeout(timer);cell.kill('SIGKILL');
    await writeFile(path.join(output, `${name}.jsonl`),redact(stdout));
    await writeFile(path.join(output, `${name}.stderr.txt`),redact(stderr));
    const events = stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
    const records = await rollouts(path.join(codexHome,'sessions'));
    const contexts = records.filter(e => e.type === 'turn_context').map(e => ({ model:e.payload.model, effort:e.payload.effort }));
    validateCodexRun({ events,contexts,model,effort,exitCode,stopped:timedOut?'timeout':null });
    if (events.some(e => e.item && !['agent_message','reasoning'].includes(e.item.type))) throw Error('text fixture used a tool');
    const answer = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').map(e => e.item.text).join('\n');
    if (!answer) throw Error('missing answer');
    await writeFile(path.join(output,`${name}.txt`),redact(answer));
    const receipt = { case:c.id,arm,rep,exitCode,model_requested:model,model_effective:contexts[0].model,
      effort_effective:contexts[0].effort,model_observation_source:'session JSONL model field: turn_context.model',
      effort_observation_source:'session JSONL effort field: turn_context.effort',auth:'subscription',usd:0,
      tool_calls:0,skill_hashes:arms[arm].hashes,answer_sha256:hash(redact(answer)),usage:events.findLast(e=>e.type==='turn.completed')?.usage };
    receipts.push(receipt);
    await writeFile(path.join(output,'runtime.json'),JSON.stringify(receipts,null,2));
    console.log(`${name} complete: ${receipt.model_effective}/${receipt.effort_effective}, $0 API`);
  } catch (error) {
    await writeFile(path.join(output, `${name}.error.json`), JSON.stringify({
      id:name, status:'INVALID', error:redact(error.message),
      model_requested:model, effort_requested:effort, usd:0,
    }, null, 2));
    throw Error(redact(error.message)); // Invalid executions are retained, never scored.
  } finally { clearTimeout(timer); await cell.cleanup(); }
}
