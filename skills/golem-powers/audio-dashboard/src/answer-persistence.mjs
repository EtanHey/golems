import { readFileSync } from 'node:fs';
import { parse } from 'parse5';

export function dashboardId(value, storageKey = 'dbx:audio-dashboard') {
  return String(value || storageKey.replace(/^dbx:/, '')).trim();
}

export const ANSWER_RUNTIME = readFileSync(new URL('../templates/answer-persistence.js', import.meta.url), 'utf8');
export const ANSWER_ASSETS = `<script data-answer-persistence>${ANSWER_RUNTIME}</script>`;

export function analyzeAnswerPersistence(html) {
  const nodes = [];
  function walk(node) { nodes.push(node); for (const child of node.childNodes || []) walk(child); }
  walk(parse(html));
  const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
  const inputs = nodes.filter(n => n.tagName === 'textarea' || n.tagName === 'input' && !['hidden', 'button', 'submit', 'range'].includes(attr(n, 'type')));
  const scripts = nodes.filter(n => n.tagName === 'script' && !attr(n, 'src') && [undefined, '', 'text/javascript', 'application/javascript', 'module'].includes(attr(n, 'type')));
  const source = node => (node.childNodes || []).map(n => n.value || '').join('');
  const violations = [];
  if (inputs.length) {
    const metas = nodes.filter(n => n.tagName === 'meta' && attr(n, 'name') === 'dashboard-id');
    if (metas.length !== 1 || metas[0].parentNode?.tagName !== 'head' || !attr(metas[0], 'content')?.trim()) violations.push({ metric: 'DASHBOARD_ID_REQUIRED', evidence: 'Declare one stable dashboard-id meta.' });
    if (!scripts.some(n => source(n).trimStart().startsWith(ANSWER_RUNTIME.trimEnd()))) violations.push({ metric: 'ANSWER_BRIDGE_REQUIRED', evidence: 'Embed the shared account answer runtime.' });
    const consumers = scripts.filter(n => attr(n, 'data-answer-consumer') !== undefined);
    const expected = new Set(nodes.filter(n => n.tagName === 'textarea' && attr(n, 'data-note') !== undefined).map(n => (attr(n, 'class') || '').includes('df-free') ? 'decision-flow' : (attr(n, 'class') || '').includes('dbx-free') ? 'decisions' : 'notes'));
    if (!consumers.length || [...expected].some(kind => !consumers.some(n => attr(n, 'data-answer-consumer') === kind)) || consumers.some(n => !source(n).includes('document.defaultView.AudioDashboardAnswers('))) violations.push({ metric: 'ANSWER_WIRING_REQUIRED', evidence: 'Wire answer controls to the shared account answer runtime.' });
  }
  return { verdict: violations.length ? 'REJECTED' : 'PASS', violations, stats: { inputs: inputs.length } };
}
export const ANSWER_RUNBOOK = 'Restore dashboard-id and the shared answer-store wiring; never ship device-only answers.';
