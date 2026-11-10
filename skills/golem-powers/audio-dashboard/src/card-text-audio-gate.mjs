import { parse, parseFragment } from 'parse5';
import { renderCardBody } from './copy-blocks.mjs';

// Ordered coverage: the longest common subsequence cannot reuse repeated words.
// Both directions use this one limit; there is no per-job threshold override.
export const CARD_TEXT_AUDIO_MAX_UNMATCHED = 0.10;
export const AUDIO_SUMMARY_LABEL = 'Audio is a summary of this card';
export const CARD_TEXT_AUDIO_RUNBOOK = 'Match card prose to its owned scene scripts, or declare audioSummary: true (or a nonblank summary) and retain the visible audio summary label.';
export const hasAudioSummary = card => card.audioSummary === true || (typeof card.summary === 'string' && Boolean(card.summary.trim()));

const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
const children = node => node.childNodes || [];
const find = (node, predicate) => predicate(node) ? node : children(node).map(n => find(n, predicate)).find(Boolean);
const text = node => node.nodeName === '#text' ? node.value : children(node).map(text).join(' ');
function prose(node) {
  if (['pre', 'code', 'button', 'script', 'style'].includes(node.tagName) || hasClass(node, 'ad-copy-block')) return '';
  return node.nodeName === '#text' ? node.value : children(node).map(prose).join(' ');
}
export const tokens = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/['’]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
function commonWords(left, right) {
  let prefix = 0;
  while (prefix < left.length && left[prefix] === right[prefix]) prefix++;
  const row = new Uint32Array(right.length - prefix + 1);
  for (let i = prefix; i < left.length; i++) {
    let diagonal = 0;
    for (let j = prefix; j < right.length; j++) {
      const old = row[j - prefix + 1];
      row[j - prefix + 1] = left[i] === right[j] ? diagonal + 1 : Math.max(old, row[j - prefix]);
      diagonal = old;
    }
  }
  return prefix + row.at(-1);
}
function visibleNotice(card) {
  const notice = find(card, n => hasClass(n, 'df-audio-summary'));
  if (!notice || text(notice).trim() !== AUDIO_SUMMARY_LABEL) return false;
  for (let node = notice; node && node !== card; node = node.parentNode) {
    if (attr(node, 'hidden') !== undefined || hasClass(node, 'df-sheet') || hasClass(node, 'df-teleprompter')) return false;
  }
  return true;
}

// Inspect the renderer's prose (rendered summary, renderCardBody(body)), not markdown source or the teleprompter.
// Rail metadata, controls, options, Sources and copyPrompt are not prose bodies.
export function analyzeCardTextAudio({ html, decisions, scenes }) {
  const document = parse(String(html)), sceneById = new Map(scenes.map(s => [s.id, s]));
  const violations = [], stats = [];
  for (const decision of decisions) {
    const card = find(document, n => hasClass(n, 'df-card') && attr(n, 'data-decision') === String(decision.id));
    // The answer sheet no longer renders body prose (it shows the spoken `ask`), so the body is
    // taken from the same renderer output the sheet used to show; the summary stays the rendered one.
    const roots = card ? [find(card, n => hasClass(n, 'df-summary')), parseFragment(renderCardBody(decision.body))].filter(Boolean) : [];
    const visible = tokens(roots.map(prose).join(' '));
    const scripts = tokens(decision.sceneIds.map(id => sceneById.get(id)?.script ?? '').join(' '));
    const matched = commonWords(visible, scripts);
    const cardMissing = visible.length ? (visible.length - matched) / visible.length : 0;
    const audioMissing = scripts.length ? (scripts.length - matched) / scripts.length : 0;
    const summary = hasAudioSummary(decision), labelled = card && visibleNotice(card);
    stats.push({ card: decision.id, cardWords: visible.length, audioWords: scripts.length, matched, cardMissing, audioMissing, summary });
    if (!card || (summary && !labelled) || (!summary && Math.max(cardMissing, audioMissing) > CARD_TEXT_AUDIO_MAX_UNMATCHED)) {
      violations.push({ segment: decision.id, metric: 'CARD_TEXT_AUDIO_MISMATCH',
        value: Math.max(cardMissing, audioMissing), threshold: CARD_TEXT_AUDIO_MAX_UNMATCHED,
        evidence: `cardWords=${visible.length} audioWords=${scripts.length} orderedMatches=${matched} cardUnmatched=${cardMissing.toFixed(4)} audioUnmatched=${audioMissing.toFixed(4)} summary=${summary} visibleLabel=${Boolean(labelled)} cardPresent=${Boolean(card)}` });
    }
  }
  return { verdict: violations.length ? 'REJECTED' : 'PASS', violations, stats,
    thresholds: { maxUnmatched: CARD_TEXT_AUDIO_MAX_UNMATCHED, measure: 'bidirectional ordered word coverage' } };
}
