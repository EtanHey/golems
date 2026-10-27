#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const combined = errors => new AggregateError(errors, errors.map(error => error.message).join('; '), { cause: errors[0] });

export function createLifecycle(selector, { env = process.env, cwd = process.cwd() } = {}) {
  const match = /^(com\.docker\.compose\.project|com\.supabase\.cli\.project)=([a-zA-Z0-9][a-zA-Z0-9_.-]*)$/.exec(selector);
  if (!match || match[0] !== selector || (match[1] === 'com.docker.compose.project' && !/^[a-z0-9][a-z0-9_-]*$/.test(match[2])))
    throw new Error('Selector must be com.docker.compose.project=<lowercase-project> or com.supabase.cli.project=<id>');
  const [, label, project] = match;
  const local = env.CI !== 'true';
  const command = (bin, args, signal) => new Promise((done, reject) => {
    // execFile drops detached; spawn makes cleanup immune to terminal group signals.
    const child = spawn(bin, args, { env, cwd, signal, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    child.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
    child.on('error', error => { failure = error; });
    child.on('close', (code, signal) => {
      if (failure) reject(failure);
      else if (code !== 0) reject(Object.assign(new Error(`Command failed: ${bin} ${args.join(' ')}\n${stderr}`), { code, signal, stderr }));
      else done(stdout);
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
        const missing = error.stderr?.trim().split(/\r?\n/).map(line => /^Error response from daemon: No such container: (\S+)$/.exec(line)?.[1]);
        if (error.code !== 1 || !missing?.length || missing.some(id => !ids.includes(id))) throw error;
        const existing = await containers(true, false, signal);
        // Ignore only confirmed disappearances; retry every remaining ID strictly.
        if (missing.some(id => existing.includes(id))) throw error;
        ids = ids.filter(id => existing.includes(id));
      }
    }
  }
  async function teardown() {
    if (!local) return;
    const errors = [];
    try { await protect(); } catch (error) { errors.push(error); }
    try {
      if (label === 'com.supabase.cli.project') await command('supabase', ['stop', '--project-id', project]);
      else await command('docker', ['compose', '--project-name', project, 'stop']);
    } catch (error) { errors.push(error); }
    try {
      const survivors = await containers(false, true);
      if (survivors.length) throw new Error(`Running containers survived teardown: ${survivors.join(', ')}`);
    } catch (error) { errors.push(error); }
    if (errors.length) throw combined(errors);
  }
  async function preflight(signal) {
    if (local && (await containers(true, false, signal)).length) await teardown();
  }
  async function run(argv) {
    if (!Array.isArray(argv) || !argv.length) throw new Error('run requires a command after --');
    const controller = new AbortController();
    let child, closed, exited = false, timer, inflight, finishing = false, failure, interruption;
    let interrupt;
    const interrupted = new Promise((_, reject) => { interrupt = reject; });
    // A signal during preflight must not create an unhandled rejection.
    interrupted.catch(() => {});
    const stop = signal => {
      interruption ??= Object.assign(new Error(`Interrupted by ${signal}`), { exitCode: 128 + constants.signals[signal] });
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
      try { await teardown(); }
      catch (error) {
        failure = failure ? Object.assign(combined([failure, error]), { exitCode: failure.exitCode ?? 1 }) : error;
      } finally { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); process.off('SIGHUP', onHup); }
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
