#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const combined = errors => new AggregateError(errors, errors.map(error => error.message).join('; '), { cause: errors[0] });
const MAX_TEARDOWN_TIMEOUT_MS = 60000, TERM_GRACE_MS = 250;
const signalError = signal => Object.assign(new Error(`Interrupted by ${signal}`), { exitCode: 128 + constants.signals[signal] });

export function createLifecycle(selector, { env = process.env, cwd = process.cwd() } = {}) {
  const match = /^(com\.docker\.compose\.project|com\.supabase\.cli\.project)=([a-zA-Z0-9][a-zA-Z0-9_.-]*)$/.exec(selector);
  if (!match || match[0] !== selector || (match[1] === 'com.docker.compose.project' && !/^[a-z0-9][a-z0-9_-]*$/.test(match[2])))
    throw new Error('Selector must be com.docker.compose.project=<lowercase-project> or com.supabase.cli.project=<id>');
  const [, label, project] = match;
  const local = env.CI !== 'true';
  const timeout = Number(env.GOLEMS_DOCKER_TEARDOWN_TIMEOUT_MS || MAX_TEARDOWN_TIMEOUT_MS);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TEARDOWN_TIMEOUT_MS)
    throw new Error(`Teardown timeout must be an integer from 1 to ${MAX_TEARDOWN_TIMEOUT_MS} ms`);
  let cleanupState, inRun = false, cleanupAbort, firstRunSignal;
  const command = (bin, args, signal) => new Promise((done, reject) => {
    const cleanup = cleanupState, description = `${bin} ${args.join(' ')}`;
    if (cleanup?.aborted) { reject(new Error(`Teardown FAILED: ${description}: ${cleanup.aborted.message}`)); return; }
    // execFile drops detached; spawn makes cleanup immune to terminal group signals.
    const child = spawn(bin, args, { env, cwd, signal, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure, closed = false, code, exitSignal, deadline, killTimer;
    const killGroup = signal => {
      if (!child.pid) return;
      try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') failure = combined([failure, error].filter(Boolean)); }
    };
    const finish = () => {
      if (!closed || killTimer) return;
      clearTimeout(deadline); cleanup?.active.delete(cancel);
      if (failure) reject(failure);
      else if (code !== 0) reject(Object.assign(new Error(`Command failed: ${description}\n${stderr}`), { code, signal: exitSignal, stderr }));
      else done(stdout);
    };
    const cancel = (reason, immediate = false) => {
      failure = new Error(`Teardown FAILED: ${description}: ${reason}`);
      clearTimeout(deadline); clearTimeout(killTimer); killTimer = undefined;
      killGroup(immediate ? 'SIGKILL' : 'SIGTERM');
      if (immediate) finish();
      else killTimer = setTimeout(() => { killTimer = undefined; killGroup('SIGKILL'); finish(); }, TERM_GRACE_MS);
    };
    if (cleanup) {
      cleanup.active.add(cancel);
      deadline = setTimeout(() => cancel(`timed out after ${timeout} ms`), timeout);
    }
    child.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
    child.on('error', error => { failure = error; });
    child.on('close', (value, signal) => {
      closed = true; code = value; exitSignal = signal; clearTimeout(deadline); finish();
    });
  });
  const containers = async (all, names = false, signal) => (await command('docker', [
    'ps', ...(all ? ['--all'] : []), '--filter', `label=${selector}`, '--format', names ? '{{.Names}}' : '{{.ID}}',
  ], signal)).trim().split(/\s+/).filter(Boolean);
  async function protect(signal) {
    if (!local) return;
    let ids = await containers(true, false, signal);
    while (ids.length) {
      try { await command('docker', ['update', '--restart=no', ...ids], signal); return; }
      catch (error) {
        const skipped = error.stderr?.trim().split(/\r?\n/).map(line => {
          const missing = /^Error response from daemon: No such container: (\S+)$/.exec(line)?.[1];
          if (missing && ids.includes(missing)) return { id: missing, missing: true };
          const removing = /^Error response from daemon: Cannot update container ([0-9a-f]{64}): container is marked for removal and cannot be "update"$/.exec(line)?.[1];
          const matches = removing ? ids.filter(id => removing.startsWith(id)) : [];
          if (matches.length === 1) return { id: matches[0], missing: false };
        });
        if (error.code !== 1 || !skipped?.length || skipped.some(value => !value)) throw error;
        const missing = skipped.filter(value => value.missing);
        if (missing.length) {
          const existing = await containers(true, false, signal);
          if (missing.some(value => existing.includes(value.id))) throw error;
        }
        // Removing/dead IDs cannot restart; every remaining ID is retried strictly.
        ids = ids.filter(id => !skipped.some(value => value.id === id));
      }
    }
  }
  async function teardown(priorInterruption) {
    if (!local) return;
    const errors = [];
    const previous = cleanupState;
    const cleanup = cleanupState = { active: new Set(), aborted: inRun ? cleanupAbort : undefined };
    let interruption = priorInterruption ?? (inRun ? firstRunSignal : undefined);
    const stop = signal => {
      if (!interruption) {
        interruption = signalError(signal);
        if (inRun) firstRunSignal = interruption;
        return;
      }
      cleanup.aborted = new Error(`second signal ${signal} during teardown`);
      if (inRun) cleanupAbort = cleanup.aborted;
      for (const cancel of cleanup.active) cancel(cleanup.aborted.message, true);
    };
    const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => stop(signal)]);
    for (const [signal, handler] of handlers) process.on(signal, handler);
    try {
      try { await protect(); } catch (error) { errors.push(error); }
      try {
        if (label === 'com.supabase.cli.project') await command('supabase', ['stop', '--project-id', project]);
        else await command('docker', ['compose', '--project-name', project, 'stop']);
      } catch (error) { errors.push(error); }
      try {
        const survivors = await containers(false, true);
        if (survivors.length) throw new Error(`Running containers survived teardown: ${survivors.join(', ')}`);
      } catch (error) { errors.push(error); }
    } finally {
      cleanupState = previous;
      for (const [signal, handler] of handlers) process.off(signal, handler);
    }
    if (interruption && interruption !== priorInterruption) errors.unshift(interruption);
    if (errors.length) throw Object.assign(combined(errors), { exitCode: interruption?.exitCode ?? 1 });
  }
  async function preflight(signal) {
    if (local && (await containers(true, false, signal)).length) await teardown();
  }
  async function run(argv) {
    if (!Array.isArray(argv) || !argv.length) throw new Error('run requires a command after --');
    inRun = true; cleanupAbort = undefined; firstRunSignal = undefined;
    const controller = new AbortController();
    let child, closed, exited = false, timer, inflight, finishing = false, failure, interruption;
    let interrupt;
    const interrupted = new Promise((_, reject) => { interrupt = reject; });
    // A signal during preflight must not create an unhandled rejection.
    interrupted.catch(() => {});
    const stop = signal => {
      if (cleanupState) return; // Teardown owns signal escalation while its commands run.
      interruption ??= signalError(signal);
      controller.abort(interruption);
      if (child && !exited) child.kill(signal);
      interrupt(interruption);
    };
    const onInt = () => stop('SIGINT'), onTerm = () => stop('SIGTERM'), onHup = () => stop('SIGHUP');
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm); process.on('SIGHUP', onHup);
    try {
      await preflight(controller.signal);
      controller.signal.throwIfAborted();
      child = spawn(argv[0], argv.slice(1), { env, cwd, stdio: 'inherit' });
      closed = new Promise((done, reject) => {
        let spawnError;
        child.on('error', error => { spawnError = error; });
        child.on('close', (code, signal) => {
          exited = true;
          if (spawnError) reject(spawnError);
          else if (code !== 0) reject(Object.assign(new Error(`Wrapped command failed (${code ?? signal})`), {
            exitCode: code ?? 128 + constants.signals[signal],
          }));
          else done();
        });
      });
      const poll = () => {
        inflight = protect(controller.signal).catch(error => { if (!finishing) interrupt(error); });
        inflight.then(() => { if (!finishing) timer = setTimeout(poll, 250); });
      };
      if (local) poll();
      await Promise.race([closed, interrupted]);
    } catch (error) { failure = interruption ?? error; }
    finally {
      finishing = true;
      clearTimeout(timer);
      controller.abort();
      if (child && !exited) {
        if (!interruption) child.kill('SIGTERM');
        let deadline;
        try {
          await Promise.race([closed.catch(() => {}), new Promise(done => { deadline = setTimeout(done, 1500); })]);
        } finally { clearTimeout(deadline); }
        if (!exited) child.kill('SIGKILL');
      }
      await inflight;
      try { await teardown(interruption); }
      catch (error) {
        failure = failure ? Object.assign(combined([failure, error]), { exitCode: failure.exitCode ?? 1 }) : error;
      } finally { inRun = false; process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); process.off('SIGHUP', onHup); }
    }
    if (failure || interruption) throw failure ?? interruption;
  }
  return { preflight, protect, teardown, run };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [action, selector, separator, ...argv] = process.argv.slice(2);
    if (!['run', 'preflight', 'protect', 'teardown'].includes(action) ||
      (action === 'run' ? separator !== '--' : separator !== undefined))
      throw new Error('Usage: container-teardown.mjs <run|preflight|protect|teardown> <selector> [-- command args...]');
    const lifecycle = createLifecycle(selector);
    await lifecycle[action](...(action === 'run' ? [argv] : []));
  } catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1; }
}
