#!/usr/bin/env node
// Schedule-only alert policy. The raw table and all merge-gating events keep their verdict.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baseRowsAt, evaluate, parseRows } from './table.mjs';

const MARKER = '<!-- golems-ratchet-schedule -->';
const LABEL = 'ratchet-red';

export function decideSchedule({ event, guardedHead, failingRows, runUrl, previous }) {
  const rows = [...new Set(failingRows)].sort();
  if (event !== 'schedule') return { exitCode: rows.length ? 1 : 0, action: 'none' };
  if (!rows.length) return { exitCode: 0, action: previous ? 'close' : 'none', state: previous && { ...previous, active: false } };
  if (!/^[0-9a-f]{40}$/.test(guardedHead)) throw new Error('no guarded master commit');
  const causeKey = JSON.stringify([guardedHead, rows]);
  const repeat = previous?.active === true && previous.causeKey === causeKey;
  const state = { schema: 1, active: true, causeKey, firstRunUrl: repeat ? previous.firstRunUrl : runUrl };
  return {
    exitCode: repeat ? 0 : 1,
    action: previous ? 'update' : 'open', state,
    warning: repeat ? `master still RED: ${rows.join(', ')}, unchanged since ${state.firstRunUrl}` : undefined,
  };
}

function command(binary, args, input) {
  const result = spawnSync(binary, args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${binary} ${args[0]} failed: ${result.stderr || result.error || result.signal}`);
  return result.stdout.trim();
}

function github(args, input) {
  return command('gh', args, input);
}

export function trackSchedule({ event, tableStatus, evaluation, guardedHead, repo, runUrl }, gh = github) {
  if (![0, 1, 2].includes(tableStatus)) throw new Error('invalid table exit code');
  // Even a direct CLI invocation on a PR cannot access or mutate the scheduled incident.
  if (event !== 'schedule' || tableStatus === 2) return { exitCode: tableStatus, action: 'none' };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid repository');
  const validRun = url => typeof url === 'string' && url.startsWith(`https://github.com/${repo}/actions/runs/`)
    && /^\d+$/.test(url.slice(`https://github.com/${repo}/actions/runs/`.length));
  if (!validRun(runUrl)) throw new Error('invalid run URL');
  if (!evaluation?.rows?.length || evaluation.stale || evaluation.loosened.some(row => !row.ruled)
    || evaluation.ok !== (tableStatus === 0)) throw new Error('table is invalid or disagrees with evaluation');
  const failingRows = evaluation.rows.filter(row => row.status === 'FAIL' || row.status === 'MISSING').map(row => row.id);
  const api = path => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/${path}`])).flat();
  const incidents = api(`issues?state=all&labels=${LABEL}&per_page=100`)
    .filter(issue => !issue.pull_request && issue.user?.login === 'github-actions[bot]' && issue.body?.split('\n')[0] === MARKER);
  if (incidents.length > 1) throw new Error('multiple scheduled ratchet incidents');
  const issue = incidents[0];
  let previous;
  if (issue) {
    previous = JSON.parse(issue.body.split('\n')[1]);
    if (previous?.schema !== 1 || typeof previous.active !== 'boolean' || typeof previous.causeKey !== 'string'
      || !validRun(previous.firstRunUrl)) throw new Error('malformed incident state');
    if (issue.state === 'closed') previous.active = false;
  }
  const decision = decideSchedule({ event, guardedHead, failingRows, runUrl, previous });
  const message = decision.warning ?? (failingRows.length
    ? `master RED: ${failingRows.sort().join(', ')}; new cause at ${runUrl}`
    : `master recovered at ${runUrl}`);
  decision.summary = message;
  if (decision.action === 'none' || (decision.action === 'close' && issue.state === 'closed')) return decision;
  const body = `${MARKER}\n${JSON.stringify(decision.state)}\n\n${message}\n\nLatest scheduled run: ${runUrl}\n\nScheduled repeats may pass with a warning while master remains RED. Push and PR gates are unchanged.\n`;
  const payload = { body };
  if (issue) {
    // Body edits do not create comments/mentions or subscription notifications. Change state only
    // on recovery/reopening, so an unchanged hourly cause does not trigger issue notifications.
    if (decision.action === 'close') payload.state = 'closed';
    else if (issue.state === 'closed') payload.state = 'open';
    gh(['api', '--method', 'PATCH', `repos/${repo}/issues/${issue.number}`, '--input', '-'], JSON.stringify(payload));
  } else {
    if (!api('labels?per_page=100').some(label => label.name === LABEL)) {
      gh(['api', '--method', 'POST', `repos/${repo}/labels`, '--input', '-'], JSON.stringify({ name: LABEL, color: 'b60205', description: 'Scheduled ratchet: master remains red' }));
    }
    gh(['api', '--method', 'POST', `repos/${repo}/issues`, '--input', '-'], JSON.stringify({ ...payload, title: 'Ratchet: master is RED (scheduled tracking)', labels: [LABEL] }));
  }
  return decision;
}

export function main(argv, env = process.env) {
  try {
    const tableStatus = Number(argv[0]);
    if (![0, 1, 2].includes(tableStatus) || argv[0] === undefined) throw new Error('table exit code required');
    if (env.GITHUB_EVENT_NAME !== 'schedule' || tableStatus === 2) return tableStatus;
    const rows = parseRows(JSON.parse(readFileSync('scripts/ratchet/rows.json', 'utf8')));
    const baseRows = baseRowsAt('scripts/ratchet/rows.json', env.GITHUB_SHA);
    const evaluation = evaluate({ rows, baseRows, bootstrap: baseRows === null, head: env.GITHUB_SHA,
      results: JSON.parse(readFileSync(argv[1], 'utf8')), runner: 'ci' });
    // Same first-parent guarded path set as live-freshness.mjs; this only identifies the cause.
    const guardedHead = command('git', ['log', '--first-parent', '-1', '--format=%H', 'origin/master', '--',
      'scripts/hooks/', 'skills/golem-powers/human-confirm-gate/', 'skills/golem-powers/git-guardian/',
      'skills/golem-powers/tmp-block/', 'scripts/repogolem/', 'scripts/ratchet/']);
    const decision = trackSchedule({ event: env.GITHUB_EVENT_NAME, tableStatus, evaluation, guardedHead,
      repo: env.GITHUB_REPOSITORY, runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` });
    console.log(decision.warning ? `::warning::${decision.warning}` : decision.summary);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n${decision.summary}\n`);
    return decision.exitCode;
  } catch (error) {
    console.error(`scheduled ratchet FAIL: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
