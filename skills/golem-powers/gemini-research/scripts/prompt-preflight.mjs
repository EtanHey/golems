#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateGeminiPreflight } from '../../research-lifecycle/scripts/lifecycle-gate.mjs';

export const requiredSections = [
  'Research goal', 'Grounding', 'Owner asks (verbatim)', 'Scope', 'Evidence against',
  'Evidence labels', 'Sources and numbers', 'Desired output', 'Pre-fire checks',
];

function parsePrompt(text) {
  const sections = new Map();
  const lines = text.split(/\r?\n/);
  let prepStart, prepEnd;
  let current, fence, comment = false;
  for (const [index, line] of lines.entries()) {
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
      if (current === 'Pre-fire checks') prepEnd = index;
      current = header[1].replace(/^Grounding\s+\(.+\)$/, 'Grounding');
      if (current === 'Pre-fire checks') prepStart = index;
      if (!sections.has(current)) sections.set(current, []);
      sections.get(current).push([]);
    } else if (current) sections.get(current).at(-1).push(line);
  }
  return { sections, lines, prepStart, prepEnd: prepEnd ?? lines.length };
}

export function researcherPrompt(text) {
  const { lines, prepStart, prepEnd } = parsePrompt(text);
  return lines.filter((_, index) => prepStart === undefined || index < prepStart || index >= prepEnd).join('\n').trim() + '\n';
}

// Strict Markdown tables: exact cells after trimming outer whitespace; no fuzzy answers.
function tableRows(text, header) {
  const lines = text.split(/\r?\n/);
  const cells = line => line.trim().split('|').slice(1, -1).map(cell => cell.trim());
  const starts = lines.flatMap((line, i) => JSON.stringify(cells(line)) === JSON.stringify(header) ? [i] : []);
  if (starts.length !== 1 || !/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[starts[0] + 1] || '')) return null;
  const rows = [];
  for (let i = starts[0] + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const row = cells(lines[i]);
    if (row.length !== header.length || row.some(cell => !cell)) return null;
    rows.push(row);
  }
  return rows.length ? rows : null;
}

function admissionKey(text) {
  const { sections } = parsePrompt(text);
  const grounding = (sections.get('Grounding')?.[0] || []).join('\n');
  const webOnly = grounding.split('\n').includes('None — web-only research');
  const { lines, prepStart, prepEnd } = parsePrompt(text);
  const prep = lines.slice(prepStart ?? lines.length, prepEnd).join('\n');
  const blocks = [...prep.matchAll(/^```admission-key\r?\n([\s\S]*?)^```\s*$/gm)];
  if (webOnly && blocks.length === 0) return { key: [], failures: [] };
  try {
    if (blocks.length !== 1) throw new Error();
    const key = JSON.parse(blocks[0][1]);
    const questions = tableRows(grounding, ['document', 'question']);
    const docs = [...grounding.matchAll(/^- "([^"\n]+)"$/gm)].map(match => match[1]);
    const identity = row => JSON.stringify([row.document, row.question]);
    if (webOnly || !questions || !docs.length || !Array.isArray(key) || !key.length
      || key.some(row => !row || ['document', 'question', 'answer', 'first_line'].some(field =>
        typeof row[field] !== 'string' || !row[field].trim() || row[field] !== row[field].trim()))
      || new Set(key.map(identity)).size !== key.length
      || new Set(questions.map(row => JSON.stringify(row))).size !== questions.length
      || key.length !== questions.length
      || questions.some(row => !docs.includes(row[0]) || !key.some(k => identity(k) === JSON.stringify(row)))
      || docs.some(doc => !key.some(row => row.document === doc))) throw new Error();
    const emitted = researcherPrompt(text);
    return { key, failures: key.some(row => emitted.includes(row.answer)) ? ['ADMISSION_KEY_LEAK'] : [] };
  } catch {
    return { key: [], failures: ['ADMISSION_KEY: one author-only JSON key covering every document/question is required'] };
  }
}

export function evaluateHarvest(table, authorRecord) {
  const { key, failures } = admissionKey(authorRecord);
  const rows = tableRows(table, ['document', 'question', 'readable (yes/no)', 'first heading or line read', 'answer']);
  if (!key.length || !rows || rows.length !== key.length || key.some(expected => {
    const matches = rows.filter(row => row[0] === expected.document && row[1] === expected.question);
    return matches.length !== 1 || matches[0][2] !== 'yes'
      || matches[0][3] !== expected.first_line || matches[0][4] !== expected.answer;
  })) failures.push('FABRICATED_READ: discard entire result; admission answers/first lines do not match the author key');
  return { gate: 'research-admission-harvest', pass: failures.length === 0, failures };
}

// Check required instruction terms, never the truth of English claims or reviews.
export function evaluatePrompt(text) {
  const { sections } = parsePrompt(text);
  const body = name => (sections.get(name)?.[0] || []).join('\n').trim();
  const failures = [];
  const placeholder = value => /(?<![\w>])<[A-Za-z][^<>\n]*>|\b(?:TODO|TBD)\b/.test(value);
  for (const name of requiredSections) {
    if (sections.get(name)?.length !== 1 || body(name).split(/\s+/).length < 2 || placeholder(body(name))) {
      failures.push(`SECTION: ${name} (one section with a phrase, no placeholders)`);
    }
  }
  const requiredWords = {
    'Evidence against': ['against'],
    'Evidence labels': ['DOCUMENTED', 'OBSERVED', 'CLAIMED', 'PROPOSED'],
    'Sources and numbers': ['primary', 'hardware', 'dataset', 'method', 'units', 'TARGET', 'Recompute'],
    'Desired output': ['DOCUMENTED', 'OBSERVED', 'CLAIMED', 'PROPOSED', 'TARGET'],
    'Pre-fire checks': ['independent', 'findings', 'resolved'],
  };
  for (const [name, words] of Object.entries(requiredWords)) {
    for (const word of words) {
      if (!new RegExp(`\\b${word}\\b`, 'i').test(body(name))) failures.push(`CONTENT: ${name} requires ${word}`);
    }
  }
  if (!/"[^"\r\n]+"|“[^”\r\n]+”/.test(body('Owner asks (verbatim)'))) failures.push('OWNER_QUOTE: include an exact quoted ask');
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
      `^- \\[[xX]\\] Bias check ${number} \\(([^()\\n]+)\\): (.+)$`, 'gm'))];
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
  failures.push(...admissionKey(text).failures);
  return { gate: 'research-prompt', pass: failures.length === 0, failures };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--harvest-check') {
      if (args.length !== 3) throw new Error('usage: prompt-preflight.mjs --harvest-check <admission.md> <author-record.md>');
      const result = evaluateHarvest(readFileSync(args[1], 'utf8'), readFileSync(args[2], 'utf8'));
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.pass ? 0 : 1);
    }
    const emit = args[0] === '--emit';
    if (emit) args.shift();
    if (args.length !== 1) throw new Error('usage: prompt-preflight.mjs [--emit] <prompt.md | ->');
    const text = readFileSync(args[0] === '-' ? 0 : args[0], 'utf8');
    const result = evaluatePrompt(text);
    if (emit && result.pass) process.stdout.write(researcherPrompt(text));
    else (emit ? console.error : console.log)(JSON.stringify(result, null, 2));
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
