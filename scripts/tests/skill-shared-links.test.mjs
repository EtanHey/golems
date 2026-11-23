import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const prefix = 'skills/golem-powers/';
const tracked = execFileSync('git', ['ls-files', '-z', '--', prefix], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
const skills = new Set(tracked.filter(file => /^skills\/golem-powers\/[^/]+\/SKILL\.md$/.test(file)).map(file => file.split('/')[2]));
const catalog = JSON.parse(readFileSync(resolve(repo, 'skills/catalog.json'), 'utf8')).roots;
const exceptions = JSON.parse(readFileSync(resolve(import.meta.dirname, 'skill-link-allowlist.json'), 'utf8'));

// Markdown destinations outside fenced examples, including reference definitions.
function destinations(text) {
  let fence;
  const links = [];
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    for (const match of line.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)) links.push(match[1].replace(/^<|>$/g, ''));
    const definition = line.match(/^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/);
    if (definition) links.push(definition[1].replace(/^<|>$/g, ''));
  }
  return links;
}

function violations() {
  const result = new Set();
  for (const file of tracked) {
    const relative = file.slice(prefix.length);
    const [skill, ...parts] = relative.split('/');
    if (!skills.has(skill) || !parts.length || parts.includes('evals')) continue;
    const text = readFileSync(resolve(repo, file), 'utf8');
    if (text.includes('\0')) continue;
    for (const destination of destinations(text)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(destination)) continue;
      const target = decodeURIComponent(destination.split(/[?#]/)[0]);
      if (!target) continue;
      // Resolve lexically: filesystem realpath would hide the installed-symlink bug.
      const installed = posix.resolve('/installed', relative);
      const resolved = posix.resolve(posix.dirname(installed), target);
      if (resolved.startsWith(`/installed/${skill}/`) || resolved === `/installed/${skill}`) continue;
      const sibling = posix.relative('/installed', resolved).split('/')[0];
      const clients = Object.values(catalog).filter(names => names.includes(skill));
      if (resolved.startsWith('/installed/') && clients.length && clients.every(names => names.includes(sibling))) continue;
      result.add(`${relative} -> ${destination}`);
    }
  }
  return [...result].sort();
}

test('Markdown destinations exclude fenced examples but include reference definitions', () => {
  assert.deepEqual(destinations('[a](../live)\n```md\n[b](../example)\n```\n~~~\n[c](../example)\n~~~\n[d]: ../reference'), ['../live', '../reference']);
});

test('installed Markdown links stay inside a skill or an installed sibling', () => {
  assert.deepEqual(violations(), [...exceptions.links].sort());
});

test('legacy link allowlist may only shrink once checked in', () => {
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/master'], { cwd: repo, encoding: 'utf8' }).trim();
  const baseline = `${base}:scripts/tests/skill-link-allowlist.json`;
  // Absence is expected only for the PR introducing this baseline; malformed JSON fails.
  try {
    execFileSync('git', ['cat-file', '-e', baseline], { cwd: repo, stdio: 'ignore' });
  } catch { return; }
  const previous = JSON.parse(execFileSync('git', ['show', baseline], { cwd: repo, encoding: 'utf8' }));
  assert.deepEqual(exceptions.links.filter(link => !previous.links.includes(link)), []);
});
