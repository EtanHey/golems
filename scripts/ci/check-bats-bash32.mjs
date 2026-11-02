#!/usr/bin/env node
// Heuristic for conventional Bats blocks and split test/helper functions. Their
// closing brace is at column zero. Checks multiline assertions and commands
// after semicolons. && lists are excluded: conditional predicates cannot be
// distinguished from assertions without a shell parser. Quoted/evaluated snippets can
// produce false positives; complex heredocs and generated shell are out of scope.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function assertions(source) {
  const lines = source.split('\n');
  const findings = [];
  let inTest = false;
  let heredoc = null;
  for (let i = 0; i < lines.length; i++) {
    if (heredoc) {
      if (lines[i].trim() === heredoc) heredoc = null;
      continue;
    }
    const delimiter = lines[i].match(/(?<!<)<<(?!<)-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (delimiter) { heredoc = delimiter[1]; continue; }
    if (/^(?:@test\b.*|(?:function\s+)?[a-zA-Z_][a-zA-Z0-9_]*\s*\(\))\s*\{\s*$/.test(lines[i])) inTest = true;
    if (/^}\s*$/.test(lines[i])) inTest = false;
    if (!inTest) continue;
    const start = i;
    let command = lines[i];
    if (!/(?:^|;|&&)\s*\[\[\s/.test(command)) continue;
    while ((!command.includes(']]') || /(?:\\|&&)\s*$/.test(command)) && i + 1 < lines.length) command += '\n' + lines[++i];
    const next = lines.slice(i + 1).find(line => !/^\s*(?:#.*)?$/.test(line));
    for (const match of command.matchAll(/(?:^|;|&&)\s*\[\[\s[\s\S]*?\]\]/g)) {
      const suffix = command.slice(match.index + match[0].length).trim();
      if (suffix.startsWith('||') || /^\\?\s*&&/.test(suffix)) continue;
      const trailing = suffix.replace(/^;\s*/, '').replace(/#.*$/, '').trim();
      if (trailing || (next && !/^}\s*$/.test(next))) findings.push(start + 1);
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0')
    .filter(path => path.endsWith('.bats') || /-parts\/.*\.bash$/.test(path));
  const findings = files.flatMap(path => assertions(readFileSync(path, 'utf8'))
    .map(line => `${path}:${line}: non-final [[ ]] needs || false on Bash 3.2`));
  if (findings.length) {
    console.error(findings.join('\n'));
    process.exitCode = 1;
  }
}
