#!/usr/bin/env node
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
const kinds = new Set('report prompt result transcript recording audit plan review frame image notes receipt manifest data archive index dashboard summary eval log'.split(' '));
const identities = new Set('theo etan opus sonnet haiku claude codex gemini gpt fable cursor sol luna terra'.split(' '));
export function lintName(name) {
  const m = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)+)\.([a-z0-9]+(?:\.[a-z0-9]+)*)$/.exec(name);
  if (!m || basename(name) !== name) return ['expected YYYY-MM-DD-project-topic-kind[-by-producer].ext'];
  const date = new Date(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== m[1]) return ['invalid date'];
  const parts = m[2].split('-'), by = parts.indexOf('by');
  if (by !== -1) {
    if (by !== parts.length - 2) return ['by needs exactly one producer token'];
    parts.splice(by);
  }
  if (parts.some(p => identities.has(p))) return ['put person/model attribution in the by-producer slot; keep descriptive project and topic slots'];
  const kind = parts.pop(), project = parts.shift();
  if (!project || !parts.length || !kinds.has(kind)) return ['need project, topic and a documented artifact kind'];
  return [];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), existing = args[0] === '--existing';
  if (existing) args.shift();
  if (!args.length || args.some(a => a.startsWith('--'))) { console.error('usage: lint-name.mjs [--existing] <basename>...'); process.exitCode = 2; }
  else for (const name of args) {
    const issues = lintName(name);
    console.log(`${issues.length ? existing ? 'legacy' : 'invalid' : 'valid'}: ${name}${issues.length ? ': ' + issues.join('; ') : ''}`);
    if (issues.length && !existing) process.exitCode = 1;
  }
}
