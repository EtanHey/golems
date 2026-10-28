#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const fail = (receipt, reason) => ({ ...receipt, ok: false, status: 'ERROR', reason });

/** Read-only, local Git verification. Input and receipts are JSON, never shell fragments. */
export function preflight(input) {
  const receipt = { originalRoot: input?.root, cwd: input?.cwd ?? process.cwd(), baseRef: input?.baseRef ?? null,
    startFromOrigin: input?.startFromOrigin ?? false, remoteFreshness: 'NOT_CHECKED' };
  if (typeof input?.root !== 'string' || !input.root || typeof receipt.cwd !== 'string' ||
      (input.baseRef !== undefined && (typeof input.baseRef !== 'string' || !input.baseRef || /[\x00-\x20\x7f]/.test(input.baseRef))) ||
      typeof receipt.startFromOrigin !== 'boolean') return fail(receipt, 'INVALID_INPUT');
  // Drop inherited Git overrides (including injected config); never invoke a credential/fsmonitor helper or lazy fetch.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' });
  let root;
  try { root = realpathSync(resolve(receipt.cwd, input.root)); } catch { return fail(receipt, 'NOT_GIT_ROOT'); }
  receipt.root = root;
  const git = (...args) => {
    const r = spawnSync('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-C', root, ...args], { env, encoding: 'utf8', timeout: 5000 });
    if (r.error || r.status !== 0 || r.stderr?.trim()) return null;
    return r.stdout.trim();
  };
  const top = git('rev-parse', '--show-toplevel');
  try { if (!top || realpathSync(top) !== root) return fail(receipt, 'NOT_GIT_ROOT'); }
  catch { return fail(receipt, 'NOT_GIT_ROOT'); }
  if (!git('symbolic-ref', '-q', 'HEAD')) return fail(receipt, 'DETACHED_HEAD');
  const ref = input.baseRef ?? git('symbolic-ref', '-q', 'refs/remotes/origin/HEAD');
  if (!ref || (input.baseRef === undefined && !ref.startsWith('refs/remotes/origin/'))) return fail(receipt, 'NO_ORIGIN_HEAD');
  receipt.resolvedRef = ref;
  const commit = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
  if (!commit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return fail(receipt, 'REF_NOT_FOUND_OR_AMBIGUOUS');
  receipt.commit = commit;
  if (receipt.startFromOrigin) return fail(receipt, 'REMOTE_FRESHNESS_UNVERIFIED');
  return { ...receipt, ok: true, status: 'VERIFIED_LOCAL' };
}

export function unwrap(value) {
  if (value?.isError) throw new Error();
  if (value?.structuredContent) return value.structuredContent;
  if (Array.isArray(value?.content)) {
    const blocks = value.content.filter(x => x.type === 'text');
    if (blocks.length !== 1) throw new Error();
    return JSON.parse(blocks[0].text);
  }
  return value;
}

/** Interpret only durable state and this run's server workspace-preparation command, never message bodies. */
export function preparation(result, context) {
  const receipt = { threadId: context?.threadId ?? null, runId: context?.runId ?? null,
    baseRef: context?.baseRef ?? null, root: context?.root ?? null };
  let data;
  try { data = unwrap(result); } catch { return fail(receipt, 'INVALID_THREAD_READ'); }
  if (typeof receipt.threadId !== 'string' || !receipt.threadId || !data?.thread || data.thread.threadId !== receipt.threadId ||
      !Array.isArray(data.recentRuns) || !data.recentRuns.every(r => r && typeof r.runId === 'string' && typeof r.status === 'string') ||
      !Array.isArray(data.items) || !data.items.every(i => i && typeof i.type === 'string'))
    return fail(receipt, 'INVALID_THREAD_READ');
  receipt.runId ??= data.thread.latestRunId ?? null;
  const run = data.recentRuns.find(r => r.runId === receipt.runId);
  const workspace = data.items.filter(i => i.sourceThreadId === receipt.threadId && i.runId === receipt.runId &&
    i.type === 'command_execution' && /:workspace-preparation(?:%3A|:)/i.test(i.itemId ?? ''));
  const broken = workspace.find(i => i.status === 'failed' || /ref_not_found|Workspace preparation failed/i.test(`${i.title ?? ''}\n${i.text ?? ''}`));
  if (broken) return fail(receipt, /ref_not_found/i.test(broken.text ?? '') ? 'REF_NOT_FOUND' : 'WORKSPACE_PREPARATION_FAILED');
  const terminal = ['failed', 'cancelled', 'interrupted', 'rolled_back'];
  if (terminal.includes(run?.status) || (data.thread.latestRunId === receipt.runId && terminal.includes(data.thread.status)))
    return fail(receipt, 'RUN_OR_WORKSPACE_FAILED');
  if (run && ['running', 'waiting', 'completed'].includes(run.status)) return { ...receipt, ok: true, status: 'READY', reason: 'PREPARATION_PASSED' };
  if (!run || ['preparing', 'queued', 'starting', 'idle'].includes(run.status))
    return { ...receipt, ok: false, status: 'PENDING', reason: 'PREPARATION_NOT_CONFIRMED' };
  return fail(receipt, 'UNKNOWN_RUN_STATE');
}

/** One API read, including on PENDING or transport failure; no polling or retry. */
export async function checkPreparationOnce(readThread, context) {
  try {
    return preparation(await readThread({ threadId: context.threadId, view: 'activity', runLimit: 1, limit: 10, maxCharsPerItem: 1000 }), context);
  } catch { return { ...preparation(null, context), reason: 'THREAD_READ_FAILED' }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let result;
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    result = process.argv[2] === 'preflight' ? preflight(input) : process.argv[2] === 'preparation'
      ? preparation(input.result, input.context) : fail({}, 'USAGE_PREFLIGHT_OR_PREPARATION');
  } catch { result = fail({}, 'INVALID_INPUT'); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : result.status === 'PENDING' ? 2 : 1;
}
