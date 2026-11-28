#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function defaultRoot() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', cwd: path.dirname(fileURLToPath(import.meta.url)) }).trim();
  return path.resolve(common, '..', 'docs.local/ratchet-runs');
}
function checkedRoot(root) {
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) throw new Error('symlink root refused');
  if (!fs.statSync(root).isDirectory()) throw new Error('root must be a directory');
  return root;
}
// Inspect all descendants: writes to an existing log need not update the run directory.
// Only read-only size measurement permits links; lstat counts the link, never its target.
export function inspectTree(target, { allowSymlinks = false } = {}) {
  const st = fs.lstatSync(target);
  if (st.isSymbolicLink() && !allowSymlinks) throw new Error(`symlink refused: ${target}`);
  let bytes = st.blocks * 512, modified = st.mtimeMs;
  if (st.isDirectory()) for (const name of fs.readdirSync(target)) {
    const child = inspectTree(path.join(target, name), { allowSymlinks });
    bytes += child.bytes; modified = Math.max(modified, child.modified);
  }
  return { bytes, modified, dev: st.dev, ino: st.ino };
}
function nonPrLane(lane) {
  return lane === 'm1-procedure'; // Explicit writer allowlist; aliases stay unknown.
}
function procedureLocked() {
  try { fs.lstatSync(path.join(os.homedir(), '.golems/m1-procedure.lock')); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function planRuns(root, { keep = 3, citations, states = {}, nonPrEvidenceComplete = false, now = Date.now() } = {}) {
  root = checkedRoot(root);
  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error('keep must be a positive integer');
  if (typeof citations !== 'string') throw new Error('PR citations required');
  const hashes = citations.match(/\b[0-9a-f]{7,40}\b/gi) ?? [];
  const rows = fs.readdirSync(root).sort().map(name => {
    const target = path.join(root, name);
    const measured = inspectTree(target);
    const match = /^(.+)-([0-9a-f]{7,40})-([0-9]{8}T[0-9]{6,12})(?:Z)?$/.exec(name);
    const row = { name, ...measured, action: 'keep', reason: 'unparseable name' };
    if (!fs.statSync(target).isDirectory() || !match) return row;
    Object.assign(row, { lane: match[1], sha: match[2], timestamp: match[3] });
    const prMatch = /^pr([1-9][0-9]*)$/.exec(row.lane);
    row.pr = prMatch ? Number(prMatch[1]) : null;
    row.nonPr = row.pr === null && nonPrLane(row.lane);
    row.state = row.nonPr ? 'NON_PR' : states[row.pr]?.state ?? 'UNKNOWN';
    const t = row.timestamp;
    // Writers use local `date`; an explicit Z suffix is UTC.
    const utc = name.endsWith('Z') || row.lane === 'm1-procedure';
    const iso = `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(9,11)}:${t.slice(11,13)}:${t.slice(13,15)}.${(t.slice(15) || '0').padEnd(3,'0').slice(0,3)}${utc ? 'Z' : ''}`;
    row.time = Date.parse(iso);
    const parsed = new Date(row.time);
    const get = field => parsed[`${utc ? 'getUTC' : 'get'}${field}`]();
    if (get('FullYear') !== Number(t.slice(0,4)) || get('Month') + 1 !== Number(t.slice(4,6)) ||
        get('Date') !== Number(t.slice(6,8)) || get('Hours') !== Number(t.slice(9,11)) ||
        get('Minutes') !== Number(t.slice(11,13)) || get('Seconds') !== Number(t.slice(13,15))) row.time = NaN;
    row.age = (now - row.time) / 86400000;
    if (citations.includes(name) || hashes.some(h => h.toLowerCase().startsWith(row.sha) || row.sha.startsWith(h.toLowerCase()))) row.reason = 'PR citation';
    else if (row.nonPr && (!nonPrEvidenceComplete || procedureLocked())) row.reason = 'incomplete citations or active procedure';
    else if (now - measured.modified < 2 * 3600000) row.reason = 'modified within two hours';
    else if (!Number.isFinite(row.time) || row.time > now) row.reason = 'invalid or future timestamp';
    else if (!row.nonPr && !['OPEN', 'MERGED', 'CLOSED'].includes(row.state)) row.reason = 'unknown PR state';
    else { row.action = 'delete'; row.reason = 'outside retention'; }
    return row;
  });
  for (const pr of new Set(rows.filter(r => r.pr !== null && r.pr !== undefined).map(r => r.pr))) {
    const state = states[pr];
    const runs = rows.filter(r => r.pr === pr && Number.isFinite(r.time) && r.time <= now)
      .sort((a,b) => b.time - a.time || b.name.localeCompare(a.name));
    let count = keep;
    if (state?.state !== 'OPEN') {
      const closed = Date.parse(state?.closedAt);
      if (!['CLOSED','MERGED'].includes(state?.state) || !Number.isFinite(closed) || closed > now) {
        for (const row of runs) { row.action = 'keep'; row.reason = 'unknown closure metadata'; }
        continue;
      }
      count = now - closed <= 14 * 86400000 ? 1 : 0;
    }
    for (const row of runs.slice(0,count)) {
      if (row.action === 'delete') { row.action = 'keep'; row.reason = 'newest PR runs'; }
    }
  }
  for (const lane of new Set(rows.filter(r => r.nonPr).map(r => r.lane))) {
    const runs = rows.filter(r => r.nonPr && r.lane === lane && Number.isFinite(r.time) && r.time <= now)
      .sort((a,b) => b.time - a.time || b.name.localeCompare(a.name));
    for (const row of runs.slice(0,3)) {
      if (row.action === 'delete') { row.action = 'keep'; row.reason = 'newest non-PR lane runs'; }
    }
  }
  return rows;
}
export function applyPlan(root, plan) {
  root = checkedRoot(root);
  const candidates = plan.filter(r => r.action === 'delete');
  const validate = row => {
    if (path.basename(row.name) !== row.name || row.name === '.' || row.name === '..') throw new Error('not a direct child');
    if (row.nonPr && procedureLocked()) throw new Error('active procedure');
    const target = path.join(root, row.name);
    const current = inspectTree(target);
    if (fs.realpathSync(target) !== target || current.dev !== row.dev || current.ino !== row.ino || current.modified !== row.modified || current.bytes !== row.bytes) throw new Error(`run changed: ${row.name}`);
    if (Date.now() - current.modified < 2 * 3600000) throw new Error(`recent run: ${row.name}`);
    return target;
  };
  candidates.forEach(validate);
  for (const row of candidates) fs.rmSync(validate(row), { recursive: true });
}
export function evidenceFromGitHub(root) {
  const api = endpoint => {
    const pages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    if (!Array.isArray(pages) || pages.some(p => !Array.isArray(p))) throw new Error('invalid API pages');
    return pages.flat();
  };
  // Closed PRs still own sticky receipts. Any lookup error aborts before apply.
  const prs = api('repos/EtanHey/golems/pulls?state=all&per_page=100');
  const text = [], states = {};
  const hasNonPrRuns = root && fs.readdirSync(root, {withFileTypes:true}).some(entry => {
    const match = /^(.+)-[0-9a-f]{7,40}-[0-9]{8}T[0-9]{6,12}Z?$/.exec(entry.name);
    return entry.isDirectory() && match && nonPrLane(match[1]);
  });
  if (hasNonPrRuns) {
    const result = {citations:'', states:{}, nonPrEvidenceComplete:false};
    if (!prs.length) return result;
    // Independent GraphQL total + identities detect short REST lists and missing Link pages.
    // Each connection is bounded at 100 entries/page; incomplete inner reviews fail closed.
    const query = `query($endCursor:String){repository(owner:"EtanHey",name:"golems"){
      pullRequests(first:100,after:$endCursor){totalCount pageInfo{hasNextPage endCursor}
        nodes{number reviews(first:100){totalCount nodes{body} pageInfo{hasNextPage}}}}}}`;
    const pages = JSON.parse(execFileSync('gh', ['api','graphql','--paginate','--slurp','-f',`query=${query}`],
      {encoding:'utf8',maxBuffer:64*1024*1024}));
    if (!Array.isArray(pages) || !pages.length) return result;
    const ids = new Set(), reviews = [];
    let total;
    for (let i=0; i<pages.length; i++) {
      const connection = pages[i]?.data?.repository?.pullRequests;
      if (pages[i]?.errors || !connection || !Number.isSafeInteger(connection.totalCount) ||
          !Array.isArray(connection.nodes) || connection.pageInfo?.hasNextPage !== (i < pages.length-1)) return result;
      if (total !== undefined && total !== connection.totalCount) return result;
      total = connection.totalCount;
      for (const pr of connection.nodes) {
        if (!Number.isSafeInteger(pr.number) || ids.has(pr.number) ||
            pr.reviews?.pageInfo?.hasNextPage !== false || !Array.isArray(pr.reviews.nodes) ||
            pr.reviews.nodes.length !== pr.reviews.totalCount) return result;
        ids.add(pr.number);
        for (const review of pr.reviews.nodes) {
          if (typeof review.body !== 'string') return result;
          reviews.push(review.body);
        }
      }
    }
    const restIds = new Set(prs.map(pr=>pr.number));
    const corpusIds = fs.readdirSync(root).map(n=>/^(?:live-)?pr([1-9][0-9]*)-/.exec(n)?.[1]).filter(Boolean).map(Number);
    if (!total || ids.size !== total || restIds.size !== total || prs.length !== total ||
        [...restIds].some(n=>!ids.has(n)) || corpusIds.some(n=>!ids.has(n))) return result;
    const bodies = [];
    for (const pr of prs) {
      if (typeof pr.body !== 'string' && pr.body !== null) return result;
      result.states[pr.number] = {state:pr.state==='open'?'OPEN':pr.state==='closed'?(pr.merged_at?'MERGED':'CLOSED'):'UNKNOWN',closedAt:pr.closed_at};
      bodies.push(pr.body ?? '');
    }
    for (const endpoint of ['issues/comments','pulls/comments']) {
      for (const comment of api(`repos/EtanHey/golems/${endpoint}?per_page=100`)) {
        if (typeof comment.body !== 'string') throw new Error('invalid comment');
        bodies.push(comment.body);
      }
    }
    return {citations:[...bodies,...reviews].join('\n'),states:result.states,nonPrEvidenceComplete:true};
  }
  const relevant = root && !hasNonPrRuns ? new Set(fs.readdirSync(root).map(n => /^(?:live-)?pr([1-9][0-9]*)-/.exec(n)?.[1]).filter(Boolean).map(Number)) : null;
  for (const pr of prs) {
    if (relevant && pr.state !== 'open' && !relevant.has(pr.number)) continue;
    if (!Number.isSafeInteger(pr.number) || typeof pr.body !== 'string' && pr.body !== null) throw new Error('invalid PR');
    states[pr.number] = {state: pr.state === 'open' ? 'OPEN' : pr.state === 'closed' ? (pr.merged_at ? 'MERGED' : 'CLOSED') : 'UNKNOWN', closedAt: pr.closed_at};
    text.push(pr.body ?? '');
    for (const type of [`issues/${pr.number}/comments`, `pulls/${pr.number}/comments`, `pulls/${pr.number}/reviews`]) {
      for (const comment of api(`repos/EtanHey/golems/${type}?per_page=100`)) {
        if (typeof comment.body !== 'string') throw new Error('invalid comment');
        text.push(comment.body);
      }
    }
  }
  return {citations:text.join('\n'), states};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (Object.hasOwn(process.env, 'GOLEMS_RATCHET_RUNS_KEEP')) console.error('warning: GOLEMS_RATCHET_RUNS_KEEP is ignored; PR retention uses the fixed 3/1 policy');
    if (args.some(a => !['--dry-run', '--apply'].includes(a)) || args.length > 1) throw new Error('usage: prune-runs.mjs [--dry-run|--apply]');
    const root = defaultRoot();
    if (!fs.existsSync(root)) { console.log(`No run root: ${root}`); process.exit(0); }
    const plan = planRuns(root, evidenceFromGitHub(root));
    for (const row of plan) console.log(`${path.join(root,row.name)}\t${row.pr ?? '?'}\t${row.state ?? 'UNKNOWN'}\t${row.age ?? '?'}\t${row.bytes}\t${row.reason}\t${row.action.toUpperCase()}`);
    const removed = plan.filter(r => r.action === 'delete');
    console.log(`${args[0] === '--apply' ? 'Apply' : 'Dry-run'}: ${removed.length}/${plan.length} entries, ${(removed.reduce((sum, r) => sum + r.bytes, 0) / 1e9).toFixed(3)} GB reclaimable`);
    if (args[0] === '--apply') applyPlan(root, plan);
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
