#!/usr/bin/env node
/**
 * Usage: node scripts/pr-chain-span.mjs [owner/repo] --since ISO --until ISO [--input prs.json]
 * Default repo: EtanHey/golems. JSON output; hours; root-open cohort [since, until).
 * Fetch ALL PRs before cohort selection to preserve links across window boundaries.
 * Rules: connected components of same-repo explicit follow-up/fixes/supersedes references
 * in title/body; stacked base matching an earlier head; closed-unmerged same-head reopen.
 * Branch identity includes source repository; reused merged heads are not reopen links.
 * Reuses WEAVE 2026-10 data/cls.json fixes_or_supersedes component computation and
 * floor(p*(n-1)) percentiles (r1-q1q2-stats.txt). Root = earliest-open member.
 * Exclude dependabot before linking; exclude components with an unmerged root.
 * Span = earliest open to latest observed merge, even if other descendants remain open.
 * Precision limits: WEAVE rework links were 66% strict / 86% lenient (n=35);
 * stack/supersede links were not sampled. This deterministic extractor is not calibrated.
 * GitHub retargeting/deleted heads can hide stacks; branch reuse and prose can mislink.
 * No file-overlap inference. Bare references to issues may collide with PR numbers.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const hours = (a, b) => (b - a) / 3600000;
const date = value => { const n = Date.parse(value); if (!Number.isFinite(n)) throw new Error(`Invalid date: ${value}`); return n; };
const stats = xs => { const s = [...xs].sort((a, b) => a - b); return { n: s.length, p50: s.length ? s[Math.floor(.5 * (s.length - 1))] : null, p90: s.length ? s[Math.floor(.9 * (s.length - 1))] : null }; };
export function measure(input, since, until) {
  const start = date(since), end = date(until);
  if (start >= end) throw new Error('since must precede until');
  const bot = p => /^dependabot(?:\[bot\])?$/.test(p.author?.login ?? p.user?.login ?? '') || /^dependabot\//.test(p.head?.ref ?? p.headRefName ?? '');
  const prs = input.filter(p => !bot(p)).map(p => ({ ...p, opened: date(p.created_at ?? p.createdAt), merged: (p.merged_at ?? p.mergedAt) ? date(p.merged_at ?? p.mergedAt) : null }));
  prs.sort((a, b) => a.opened - b.opened || a.number - b.number);
  const byNumber = new Map(prs.map(p => [p.number, p])), parent = new Map(prs.map(p => [p.number, p.number])), links = [];
  if (byNumber.size !== prs.length) throw new Error('Duplicate PR number');
  const root = n => { while (parent.get(n) !== n) n = parent.get(n); return n; };
  const link = (a, b, rule) => { if (!a || a.number === b.number || a.opened > b.opened) return; parent.set(root(b.number), root(a.number)); links.push({ from: a.number, to: b.number, rule }); };
  const head = p => p.head?.ref ?? p.headRefName;
  const source = p => p.head?.repo?.full_name ?? p.headRepository?.nameWithOwner ?? null;
  for (const p of prs) {
    for (const m of `${p.title ?? ''}\n${p.body ?? ''}`.matchAll(/\b(follow[- ]up(?:\s+(?:of|to|on))?|fix(?:es|ed)?|supersed(?:es|ed))\s+#(\d+)\b/gi)) link(byNumber.get(Number(m[2])), p, m[1].toLowerCase().startsWith('follow') ? 'follow-up' : m[1].toLowerCase().startsWith('supersed') ? 'supersedes' : 'fixes');
    const base = p.base?.ref ?? p.baseRefName;
    const baseRepo = p.base?.repo?.full_name ?? null;
    const earlier = prs.filter(a => a.number !== p.number && a.opened <= p.opened);
    link(earlier.findLast(a => head(a) && head(a) === base && source(a) === baseRepo), p, 'stack');
    link(earlier.findLast(a => head(a) && head(a) === head(p) && source(a) === source(p) && a.merged === null && (a.closed_at ?? a.closedAt) && date(a.closed_at ?? a.closedAt) <= p.opened), p, 'same-branch-reopen');
  }
  const groups = new Map();
  for (const p of prs) { const r = root(p.number); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
  const row = p => ({ number: p.number, openedAt: new Date(p.opened).toISOString(), mergedAt: p.merged === null ? null : new Date(p.merged).toISOString(), openToMergeHours: p.merged === null ? null : hours(p.opened, p.merged) });
  const cohort = p => p.opened >= start && p.opened < end;
  const chains = [], excludedRoots = [];
  for (const members of groups.values()) {
    const first = members[0];
    if (members.length < 2 || !cohort(first)) continue;
    if (first.merged === null) { excludedRoots.push(first.number); continue; }
    const last = Math.max(...members.filter(p => p.merged !== null).map(p => p.merged));
    const numbers = new Set(members.map(p => p.number));
    chains.push({ root: first.number, spanHours: hours(first.opened, last), firstOpenedAt: new Date(first.opened).toISOString(), lastMergedAt: new Date(last).toISOString(), pendingPrs: members.filter(p => p.merged === null).map(p => p.number), prs: members.map(row), links: links.filter(l => numbers.has(l.from) && numbers.has(l.to)) });
  }
  const perPr = prs.filter(p => cohort(p) && p.merged !== null).map(row);
  return { window: { since, until, cohort: 'root opened in [since, until); all descendants retained' }, precisionLimits: 'WEAVE rework: 66% strict / 86% lenient, n=35; stack/supersede unsampled; this extractor uncalibrated; current branch metadata only', excludedDependabot: input.length - prs.length, excludedRoots, chains, perPr, chainSpanHours: stats(chains.map(c => c.spanHours)), perPrHours: stats(perPr.map(p => p.openToMergeHours)) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = {}; let repo = 'EtanHey/golems';
    if (args[0] && !args[0].startsWith('--')) repo = args.shift();
    while (args.length) { const key = args.shift(), value = args.shift(); if (!['--since', '--until', '--input'].includes(key) || !value || value.startsWith('--')) throw new Error('Expected [owner/repo] --since ISO --until ISO [--input prs.json]'); options[key] = value; }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Expected owner/repo');
    if (date(options['--since']) >= date(options['--until'])) throw new Error('since must precede until');
    const prs = options['--input'] ? JSON.parse(readFileSync(options['--input'], 'utf8')) : JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/pulls?state=all&per_page=100`], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })).flat();
    console.log(JSON.stringify({ repo, ...measure(prs, options['--since'], options['--until']) }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
