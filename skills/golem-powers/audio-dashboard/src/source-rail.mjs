// Shared producer/evidence contract. URLs may be long; authored copy stays concise.
export const SOURCE_NOTE_MAX_CHARS = 280;
export const SOURCE_LABEL_MAX_CHARS = 48;
export const SOURCE_VALUE_MAX_CHARS = 160;
export const SOURCE_MAX_ROWS = 12;
export function sourceHref(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : '';
  } catch { return ''; }
}
export function sourceValueFits(value, href = '') {
  const text = String(value ?? '').trim();
  return text.length <= SOURCE_VALUE_MAX_CHARS ||
    (text.length <= 2048 && Boolean(href) && sourceHref(text) === href);
}
export function sourceRowFits(row) {
  const label = String(row?.label ?? '').trim();
  return label.length > 0 && label.length <= SOURCE_LABEL_MAX_CHARS && sourceValueFits(row?.value, sourceHref(row?.href));
}

// Only the renderer's dl > div > dt + dd structure qualifies. No arbitrary prose containers.
export function isSourceRail(node, { attrs, children, text }) {
  const parts = n => children(n).filter(c => c.nodeName !== '#text' || c.value.trim());
  const plain = n => children(n).every(c => c.nodeName === '#text');
  const rows = parts(node);
  if (node.tagName !== 'dl' || !/(?:^|\s)df-rail(?:\s|$)/.test(attrs(node).class || '') || !rows.length || rows.length > SOURCE_MAX_ROWS) return false;
  return rows.every(row => {
    const cells = parts(row), [label, value] = cells;
    if (row.tagName !== 'div' || cells.length !== 2 || label.tagName !== 'dt' || value.tagName !== 'dd' || !plain(label)) return false;
    const contents = parts(value);
    if (plain(value)) return sourceRowFits({ label: text(label), value: text(value) });
    const link = contents[0], a = attrs(link || {});
    const href = sourceHref(a.href);
    if (contents.length !== 1 || link?.tagName !== 'a' || !href || a.target !== '_blank' ||
        !['noopener', 'noreferrer'].every(token => (a.rel || '').split(/\s+/).includes(token))) return false;
    const reference = parts(link).filter(c => c.nodeName !== '#text');
    const github = href.match(/^https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/(?:pull|issues)\/(\d+)(?:[/?#]|$)/);
    if (reference.length > 1 || reference.some(ref => ref.tagName !== 'span' || attrs(ref).class !== 'df-rail-ref' || !plain(ref) ||
        !github || text(ref).trim() !== `${github[1]}#${github[2]}`)) return false;
    const authored = children(link).filter(c => c.nodeName === '#text').map(text).join('').trim();
    return sourceRowFits({ label: text(label), value: authored, href });
  });
}
