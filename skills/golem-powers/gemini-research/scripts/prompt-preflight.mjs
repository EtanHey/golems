#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateGeminiPreflight } from '../../research-lifecycle/scripts/lifecycle-gate.mjs';

export const requiredSections = [
  'Research goal', 'Grounding', 'Owner asks (verbatim)', 'Scope', 'Evidence against',
  'Evidence labels', 'Sources and numbers', 'Desired output', 'Pre-fire checks',
];

// This checks the template's schema, never the truth of English claims or reviews.
export function evaluatePrompt(text) {
  const sections = new Map();
  let current, fence, comment = false;
  for (const line of text.split(/\r?\n/)) {
    if (comment) { if (line.includes('-->')) comment = false; continue; }
    if (line.trimStart().startsWith('<!--')) {
      comment = !line.includes('-->'); continue;
    }
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const header = line.match(/^ {0,3}#\s+(.+?)\s*#*\s*$/);
    if (header) {
      current = header[1].replace(/^Grounding\s+\(.+\)$/, 'Grounding');
      if (!sections.has(current)) sections.set(current, []);
      sections.get(current).push([]);
    } else if (current) sections.get(current).at(-1).push(line);
  }
  const body = name => (sections.get(name)?.[0] || []).join('\n').trim();
  const failures = [];
  const placeholder = value => /<[^>]+>|\b(?:TODO|TBD)\b/.test(value);
  for (const name of requiredSections) {
    if (sections.get(name)?.length !== 1 || !body(name) || placeholder(body(name))) {
      failures.push(`SECTION: ${name} (one nonempty section, no placeholders)`);
    }
  }
  const grounding = body('Grounding');
  const webOnly = grounding.split('\n').includes('None — web-only research');
  if (grounding.split('\n').filter(line => line.startsWith('Verified findings + struck claims:')).length !== 1
    || (webOnly && /^- "/m.test(grounding))) failures.push('GROUNDING_MODE: exactly one project or web-only branch');
  if (webOnly && !/^Reason: \S.*$/m.test(grounding)) failures.push('WEB_ONLY_REASON: quote the owner\'s reason');
  const verified = grounding.match(/^Verified findings \+ struck claims: "([^"\n]+)"$/m);
  if (webOnly ? !/^Verified findings \+ struck claims: N\/A — web-only$/m.test(grounding)
    : !verified || !grounding.split('\n').some(line => line.trim() === `- "${verified[1]}"`)) {
    failures.push('VERIFIED_FINDINGS: name the listed Drive doc, or explicit web-only N/A');
  }
  const reviewers = [];
  for (const number of [1, 2]) {
    const matches = [...body('Pre-fire checks').matchAll(new RegExp(
      `^- \\[x\\] Bias check ${number} \\(([^()\\n]+)\\): (.+)$`, 'gm'))];
    if (matches.length !== 1 || !matches[0][1].trim() || !matches[0][2].trim()) {
      failures.push(`BIAS_CHECK_${number}: completed row with reviewer, findings and disposition`);
    } else reviewers.push(matches[0][1].trim().toLowerCase());
  }
  if (reviewers.length === 2 && reviewers[0] === reviewers[1]) failures.push('BIAS_INDEPENDENCE: distinct reviewers required');
  const groundingResult = evaluateGeminiPreflight(`# Grounding\n${grounding}\n# End\n${text}`);
  // Use the parsed real block for source validation; scan the whole prompt for no-attach.
  const sourceResult = evaluateGeminiPreflight(`# Grounding\n${grounding}`);
  for (const [name, check] of Object.entries(sourceResult.checks)) {
    if (name !== 'NO_ATTACH_INSTRUCTION' && !check.pass) failures.push(name);
  }
  if (!groundingResult.checks.NO_ATTACH_INSTRUCTION.pass) failures.push('NO_ATTACH_INSTRUCTION');
  return { gate: 'research-prompt', pass: failures.length === 0, failures };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('usage: prompt-preflight.mjs <prompt.md | ->');
    const result = evaluatePrompt(readFileSync(process.argv[2] === '-' ? 0 : process.argv[2], 'utf8'));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
