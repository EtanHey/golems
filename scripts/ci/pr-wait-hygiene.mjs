#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// Offline evidence check only: never changes threads, schedules or watches.
const liveTaskStates = new Set(['preparing', 'queued', 'starting', 'running', 'waiting']);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function rows(object, key) {
  if (object[key] === undefined) return [];
  if (!Array.isArray(object[key]) || object[key].some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error(`${key} must be an array of objects`);
  }
  return object[key];
}

try {
  if (process.argv.length !== 3) throw new Error('usage: node scripts/ci/pr-wait-hygiene.mjs <snapshot.json|->');
  const snapshot = JSON.parse(readFileSync(process.argv[2] === '-' ? 0 : process.argv[2], 'utf8'));
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('expected a snapshot object');
  const threads = snapshot.threadId ? [snapshot] : rows(snapshot, 'threads');
  if (!snapshot.threadId && !Array.isArray(snapshot.threads)) throw new Error('threads array is required');
  const tasks = rows(snapshot, 'tasks');
  const watches = rows(snapshot, 'watches');
  const schedules = rows(snapshot, 'schedules');
  const blocked = rows(snapshot, 'blocked');
  const ids = new Set();
  for (const thread of threads) {
    if (!nonempty(thread.threadId) || !nonempty(thread.status) || ids.has(thread.threadId)) {
      throw new Error('each thread needs a unique threadId and a status');
    }
    ids.add(thread.threadId);
    rows(thread, 'watches');
    rows(thread, 'schedules');
    rows(thread, 'pullRequests');
    rows(thread, 'blocked');
  }
  const now = Date.now();
  const violations = [];
  for (const thread of threads) {
    if (thread.role === 'worker' || nonempty(thread.parentThreadId)) continue;
    const owned = event => event.threadId === thread.threadId;
    const threadSchedules = [...schedules, ...rows(thread, 'schedules')];
    const blockedWake = threadSchedules.some(event => event.boundThreadId === thread.threadId &&
      event.enabled === true && typeof event.nextRunAt === 'string' && Date.parse(event.nextRunAt) > now);
    for (const pr of rows(thread, 'pullRequests')) {
      if (pr.state !== 'open') continue;
      if (!nonempty(pr.url)) throw new Error('each open PR needs a url');
      const isBlocked = [...blocked, ...rows(thread, 'blocked')].some(event => owned(event) &&
        (event.pr === pr.url || (typeof event.pr === 'number' && event.pr === pr.number)) &&
        nonempty(event.reason) && nonempty(event.owner));
      if (pr.watching !== true && !(isBlocked && blockedWake)) {
        violations.push(`${thread.threadId} ${pr.url}: open PR neither watched nor BLOCKED-with-wake`);
      }
    }
    if (thread.status.toLowerCase() !== 'waiting') continue;
    const watch = [...watches, ...rows(thread, 'watches')].some(event =>
      owned(event) && nonempty(event.watchId) && event.status === 'active') ||
      rows(thread, 'pullRequests').some(pr => nonempty(pr.url) && pr.watching === true && pr.state === 'open');
    const schedule = threadSchedules.some(event => {
      if (nonempty(event.scheduledTaskId)) {
        return event.boundThreadId === thread.threadId && event.enabled === true &&
          typeof event.nextRunAt === 'string' && Date.parse(event.nextRunAt) > now;
      }
      return owned(event) && nonempty(event.scheduleId) && event.status === 'scheduled' &&
        typeof event.runAt === 'string' && Date.parse(event.runAt) > now;
    });
    const delegate = tasks.some(task => {
      const parent = task.parentThreadId ?? threads.find(child => child.threadId === task.childThreadId)?.parentThreadId;
      return parent === thread.threadId && nonempty(task.taskId) && liveTaskStates.has(task.status) &&
        task.workState !== 'result_available';
    });
    if (!watch && !schedule && !delegate) {
      violations.push(`${thread.threadId}: WAITING without a live event or scheduled wake`);
    }
  }
  if (violations.length) {
    console.log(violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('PASS: no waiting leads without a wake source or open PRs without watch/BLOCKED-with-wake');
  }
} catch (error) {
  console.error(`pr-wait-hygiene: ${error.message}`);
  process.exitCode = 2;
}
