#!/usr/bin/env node
/** Classify published clip checks. CLI: JSON {clips, names?} on stdin, JSON on stdout.
 * Each clip has {id, role?, flagged?, takeCheck:{edits, pitchFailed?, firstWordOmitted?}}.
 * Each edit uses {sent:string[], recognised:string[], sentIndex, recognisedIndex, tokenClass?}.
 * Output retains each edit with a reason in real/waived and plain card notice lines.
 * Names are an explicit caller-owned allowlist; no implicit proper-name dictionary.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const normal = word => word.toLowerCase().replace(/’/g, "'").replace(/^[^\p{L}\d']+|[^\p{L}\d']+$/gu, '');
const spellingBase = word => normal(word)
  .replace(/isation$/, 'ization').replace(/our$/, 'or').replace(/ise$/, 'ize')
  .replace(/yse$/, 'yze').replace(/tre$/, 'ter').replace(/ogue$/, 'og');
const small = new Map(('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ')).map((w, i) => [w, i]));
const tens = new Map('twenty thirty forty fifty sixty seventy eighty ninety'.split(' ').map((w, i) => [w, (i + 2) * 10]));
const scales = new Map([['thousand', 1e3], ['million', 1e6], ['billion', 1e9]]);

function numberValue(words) {
  if (!words.length) return null;
  if (words.length === 1 && /^\d+(?:\.\d+)?$/.test(words[0])) return Number(words[0]);
  let total = 0, part = 0, previous = '', scale = Infinity;
  for (const word of words) {
    if (small.has(word)) {
      if (previous === 'small' || (previous === 'tens' && small.get(word) >= 10)) return null;
      part += small.get(word); previous = 'small';
    } else if (tens.has(word)) {
      if (previous === 'small' || previous === 'tens') return null;
      part += tens.get(word); previous = 'tens';
    } else if (word === 'hundred' && part > 0 && part < 10 && previous === 'small') {
      part *= 100; previous = 'scale';
    } else if (scales.has(word) && part > 0 && scales.get(word) < scale) {
      scale = scales.get(word); total += part * scale; part = 0; previous = 'scale';
    } else if (word === 'and' && previous === 'scale') previous = 'and';
    else return null;
  }
  return previous === 'and' ? null : total + part;
}

function numberForm(tokens) {
  let text = tokens.join(' ').toLowerCase().trim().replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '');
  if (/^[+-]/.test(text)) return null;
  let unit = '';
  if (/^\$\s*\d/.test(text)) { unit = 'dollar'; text = text.replace(/^\$\s*/, ''); }
  if (/\d\s*%$/.test(text)) { unit = 'percent'; text = text.replace(/\s*%$/, ''); }
  text = text.replace(/\bper cent\b/g, 'percent');
  const words = text.split(/[\s-]+/).filter(Boolean);
  const tail = words.at(-1);
  if (['dollar', 'dollars', 'cent', 'cents', 'percent'].includes(tail)) {
    if (unit) return null;
    unit = tail.replace(/s$/, ''); words.pop();
  }
  const value = numberValue(words);
  return value === null ? null : { value, unit };
}

// Adjacent edits belong to one phrase only when BOTH alignments are contiguous.
function groups(edits) {
  const result = [];
  for (const edit of [...edits].sort((a, b) => (a.sentIndex ?? 0) - (b.sentIndex ?? 0) || (a.recognisedIndex ?? 0) - (b.recognisedIndex ?? 0))) {
    const group = result.at(-1), last = group?.at(-1);
    if (last && Number.isInteger(last.sentIndex) && Number.isInteger(edit.sentIndex)
      && Number.isInteger(last.recognisedIndex) && Number.isInteger(edit.recognisedIndex)
      && edit.sentIndex === last.sentIndex + last.sent.length
      && edit.recognisedIndex === last.recognisedIndex + last.recognised.length) group.push(edit);
    else result.push([edit]);
  }
  return result;
}

function nearName(a, b) {
  // Bounded Levenshtein distance; split recogniser words may spell one explicit name.
  if (!a || !b || Math.max(a.length, b.length) > 256) return false;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length] <= Math.floor(Math.max(a.length, b.length) * 0.25);
}

function classify(edits, names) {
  const sent = edits.flatMap(e => e.sent), recognised = edits.flatMap(e => e.recognised);
  const item = { sent, recognised, edits };
  // Apostrophe/possessive differences and final-s differences are never spelling waivers.
  const s = sent.map(normal).join(''), h = recognised.map(normal).join('');
  if (s.includes("'") || h.includes("'")) return { ...item, reason: 'word-mismatch' };
  if ((s.length > 3 && s === `${h}s`) || (h.length > 3 && h === `${s}s`)) return { ...item, reason: 'word-mismatch' };
  const sn = numberForm(sent), hn = numberForm(recognised);
  if (recognised.some(w => /\d/.test(w)) && sn && hn && sn.value === hn.value && sn.unit === hn.unit) return { ...item, reason: 'digits' };
  if (sent.length && sent.length === recognised.length
    && sent.every((w, i) => spellingBase(w) === spellingBase(recognised[i]))
    && sent.some((w, i) => normal(w) !== normal(recognised[i]))) return { ...item, reason: 'spelling' };
  if ((names.has(s) || (sent.length === 1 && edits.some(e => e.tokenClass === 'jargon'))) && nearName(s, h)) return { ...item, reason: 'name' };
  return { ...item, reason: 'word-mismatch' };
}

/** Classify one clip, preserving real failures even alongside waived edits. */
export function classifyClip(clip, { names = [] } = {}) {
  if (!clip.takeCheck || !Array.isArray(clip.takeCheck.edits)) throw new TypeError('clip.takeCheck.edits must be an array');
  for (const e of clip.takeCheck.edits) {
    if (!Array.isArray(e.sent) || !Array.isArray(e.recognised) || ![...e.sent, ...e.recognised].every(w => typeof w === 'string')) throw new TypeError('edit tokens must be string arrays');
  }
  const real = [], waived = [], notices = [];
  const label = clip.role === 'host' ? 'question' : 'answer';
  const prefix = `This ${label} clip`;
  if (clip.takeCheck.pitchFailed) real.push({ reason: 'pitch', detail: "the voice's pitch ran away" });
  if (clip.takeCheck.firstWordOmitted) real.push({ reason: 'first-word', detail: 'the first word was not spoken' });
  const nameSet = new Set(names.map(name => name.split(/\s+/).map(normal).join('')));
  for (const group of groups(clip.takeCheck.edits)) {
    const phrase = classify(group, nameSet);
    // Only numbers and explicit names may need several alignment edits together.
    const items = ['digits', 'name'].includes(phrase.reason) ? [phrase] : group.map(edit => classify([edit], nameSet));
    for (const item of items) (item.reason === 'word-mismatch' ? real : waived).push(item);
  }
  if (clip.flagged && !real.length && !waived.length) real.push({ reason: 'unexplained-failure', detail: 'the check reported an unexplained failure' });
  const describe = item => item.detail ?? `heard "${item.recognised.join(' ') || '[blank]'}" for "${item.sent.join(' ') || '[blank]'}"`;
  for (const item of real) notices.push(`${prefix} failed its check: ${describe(item)}.`);
  if (waived.length) notices.push(`${prefix} ${real.length ? 'also has a waived spelling difference' : 'passed its check only as a spelling difference'}: ${waived.map(describe).join('; ')}.`);
  return { id: clip.id, status: real.length ? 'failed' : waived.length ? 'waived' : 'passed', real, waived, notices };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    if (!Array.isArray(input.clips)) throw new TypeError('clips must be an array');
    console.log(JSON.stringify({ clips: input.clips.map(clip => classifyClip(clip, { names: input.names })) }, null, 2));
  } catch (error) {
    console.error(`classify-takes: ${error.message}`); process.exitCode = 1;
  }
}
