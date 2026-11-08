import { parseFragment } from 'parse5';
// Salvaged native-disclosure shape from 8435a635; bounded content follows ed104c30.
const BASE = new URL('https://dashboard.invalid/dashboard/index.html');
export function sourceUrl(value) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) throw Error('sources: invalid URL');
  let url;
  try { url = new URL(value, BASE); } catch { throw Error('sources: invalid URL'); }
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || /^\//.test(value) ||
      (!absolute && (url.origin !== BASE.origin || !url.pathname.startsWith('/dashboard/') || /%2f|%5c/i.test(url.pathname)))) {
    throw Error('sources: use https or a relative URL inside the dashboard directory');
  }
  return value;
}
function label(value, max = 160) { return typeof value === 'string' && Boolean(value.trim()) && value.length <= max; }
export function validateSources(decision) {
  const sources = decision.sources === undefined ? [] : decision.sources;
  if (!Array.isArray(sources) || sources.length > 12) throw Error('sources: expected at most 12 links');
  for (const source of sources) {
    if (!label(source?.label)) throw Error('sources: each link needs a label of at most 160 characters');
    sourceUrl(source.url);
  }
  const prompt = decision.copyPrompt;
  if (prompt !== undefined && (!label(prompt?.label, 80) || typeof prompt.text !== 'string' || !prompt.text.trim() ||
      (prompt.notes !== undefined && (typeof prompt.notes !== 'string' || prompt.notes.length > 280)))) {
    throw Error('sources: copyPrompt needs label, exact non-empty text and optional notes (at most 280 characters)');
  }
}

// The evidence gate exempts only this renderer's bounded link list and functional prompt control.
// A class name alone never exempts arbitrary prose, another disclosure, or narration.
export function isSourcesDrawer(node, { attrs, text }) {
  const decoded = value => parseFragment(`<span>${String(value).replaceAll('<', '&lt;')}</span>`).childNodes[0].childNodes.map(n => n.value || '').join('');
  const parts = n => (n.childNodes || []).filter(c => c.nodeName !== '#text' || c.value.trim());
  const plain = n => (n.childNodes || []).every(c => c.nodeName === '#text');
  const cls = (n, name) => (attrs(n).class || '').split(/\s+/).includes(name);
  if (node.tagName !== 'details' || !cls(node, 'df-sources')) return false;
  const [summary, body, extra] = parts(node);
  if (extra || summary?.tagName !== 'summary' || !plain(summary) || text(summary) !== 'Sources' || body?.tagName !== 'div' || !cls(body, 'df-sources-body')) return false;
  const blocks = parts(body);
  if (!blocks.length || blocks.length > 2) return false;
  let lists = 0, prompts = 0;
  return blocks.every(block => {
    if (block.tagName === 'ul' && cls(block, 'df-source-links') && ++lists === 1) {
      const rows = parts(block);
      return rows.length > 0 && rows.length <= 12 && rows.every(row => {
        const [a, extra] = parts(row), at = a && attrs(a);
        if (row.tagName !== 'li' || extra || a?.tagName !== 'a' || !plain(a) || !label(decoded(text(a))) || at.target !== '_blank' || at.rel !== 'noopener noreferrer') return false;
        try { sourceUrl(decoded(at.href)); return true; } catch { return false; }
      });
    }
    if (block.tagName !== 'div' || !cls(block, 'df-copy-prompt') || ++prompts !== 1) return false;
    const nodes = parts(block), note = nodes[0]?.tagName === 'p' ? nodes.shift() : null;
    const [button, status, manual, extra] = nodes;
    if (note && (!cls(note, 'df-source-note') || !plain(note) || decoded(text(note)).length > 280)) return false;
    if (extra || button?.tagName !== 'button' || attrs(button).type !== 'button' || !plain(button) || !label(decoded(text(button)), 80) ||
        status?.tagName !== 'span' || attrs(status).role !== 'status' || !plain(status) || text(status) ||
        manual?.tagName !== 'pre' || !cls(manual, 'df-prompt-manual') || !Object.hasOwn(attrs(manual), 'hidden') || !plain(manual) || text(manual)) return false;
    try {
      // Bun HTMLRewriter exposes raw entities; decode once before validating the JSON payload.
      const payload = decoded(attrs(button)['data-copy-prompt']);
      validateSources({ copyPrompt: { label: decoded(text(button)), text: JSON.parse(payload), ...(note ? { notes: decoded(text(note)) } : {}) } }); return true;
    } catch { return false; }
  });
}
