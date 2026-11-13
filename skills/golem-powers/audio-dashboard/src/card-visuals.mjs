// Bounded, data-only card visuals. No authored markup or executable SVG attributes.
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fail = message => { throw Error('card visuals: ' + message); };
const text = (value, max = 160) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
const list = (value, max) => Array.isArray(value) && value.length > 0 && value.length <= max;
const states = { works: 'ready', fixed: 'ready', pass: 'ready', bug: 'error', fail: 'error', open: 'wait' };
const scalar = value => text(value, 500) || (typeof value === 'number' && Number.isFinite(value));
export function validateCardVisuals(card) {
  if (card.tables !== undefined) {
    if (!list(card.tables, 4)) fail('tables must contain 1–4 tables');
    for (const t of card.tables) {
      if (!object(t, ['caption', 'columns', 'rows', 'align']) || !text(t.caption) || !list(t.columns, 12) || !t.columns.every(c => text(c)) || !list(t.rows, 100)) fail('invalid table');
      if (t.align !== undefined && (!Array.isArray(t.align) || t.align.length !== t.columns.length || !t.align.every(a => ['left', 'center', 'right'].includes(a)))) fail('invalid alignment');
      for (const row of t.rows) if (!Array.isArray(row) || row.length !== t.columns.length || !row.every(c => scalar(c) || (object(c, ['status']) && Object.hasOwn(states, c.status)))) fail('invalid table row or status');
    }
  }
  if (card.charts !== undefined) {
    if (!list(card.charts, 4)) fail('charts must contain 1–4 charts');
    for (const c of card.charts) {
      if (!object(c, ['type', 'title', 'series', 'unit']) || !['bar', 'line'].includes(c.type) || !text(c.title) || !text(c.unit, 40) || !list(c.series, 4)) fail('invalid chart');
      for (const s of c.series) {
        if (!object(s, ['name', 'values']) || !text(s.name, 80) || !list(s.values, 30) || !s.values.every(p => object(p, ['label', 'value']) && text(p.label, 80) && typeof p.value === 'number' && Number.isFinite(p.value) && Math.abs(p.value) <= 1e12)) fail('invalid chart series');
        const labels = s.values.map(p => p.label);
        if (new Set(labels).size !== labels.length || JSON.stringify(labels) !== JSON.stringify(c.series[0].values.map(p => p.label))) fail('series must share unique ordered labels');
      }
    }
  }
  // Existing rails keep their historical rendering. Opting into the new field is strict.
  for (const row of card.rail || []) if (row.newTab !== undefined) {
    if (!object(row, ['label', 'value', 'href', 'newTab']) || typeof row.newTab !== 'boolean' || !text(row.label) || !text(row.value, 500) || typeof row.href !== 'string' || /[\s\\]/.test(row.href)) fail('invalid newTab rail');
    let url; try { url = new URL(row.href); } catch { fail('invalid rail URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) fail('unsafe rail URL');
  }
}
export function cardVisualBytes(decisions = []) {
  let bytes = 0;
  for (const card of decisions) {
    validateCardVisuals(card);
    for (const key of ['tables', 'charts']) if (card[key] !== undefined) bytes += Buffer.byteLength(JSON.stringify(card[key]));
    for (const row of card.rail || []) if (row.newTab !== undefined) bytes += Buffer.byteLength(JSON.stringify(row));
  }
  if (bytes > 256 * 1024) fail('visual payload exceeds 256 KiB');
  return bytes;
}
export function renderTables(tables = []) {
  return tables.map(t => `<div class="df-table-scroll" tabindex="0" role="region" aria-label="${esc(t.caption)}"><table class="df-data-table"><caption>${esc(t.caption)}</caption><thead><tr>${t.columns.map((c, i) => `<th scope="col" style="text-align:${t.align?.[i] || 'left'}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(row => `<tr>${row.map((c, i) => `<td style="text-align:${t.align?.[i] || 'left'}">${typeof c === 'object' ? `<span class="df-v-pill df-v-${states[c.status]}">${esc(c.status)}</span>` : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
}
export function renderCharts(charts = []) {
  return charts.map(c => {
    const values = c.series.flatMap(s => s.values.map(p => p.value));
    const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1;
    const y = v => 180 - (v - low) / span * 150;
    const count = c.series[0].values.length, chartWidth = Math.max(540, 80 + count * 80);
    const step = (chartWidth - 80) / count, x = i => 60 + step * (i + .5);
    const baseline = y(0), width = Math.min(40, step * .7 / c.series.length);
    const summary = c.series.map(s => `${s.name}: ${s.values.map(p => `${p.label}: ${p.value} ${c.unit}`).join('; ')}`).join('. ');
    const marks = c.series.map((s, si) => {
      const points = s.values.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
      const line = c.type === 'line' ? `<polyline fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="${si ? `${si * 3} 3` : 'none'}" points="${points}"/>` : '';
      return `<g class="df-chart-series df-series-${si}">${line}${s.values.map((p, i) => {
        const title = `<title>${esc(`${s.name}, ${p.label}: ${p.value} ${c.unit}`)}</title>`;
        return c.type === 'line' ? `<circle cx="${x(i)}" cy="${y(p.value)}" r="4">${title}</circle>` : `<rect x="${x(i) + (si - c.series.length / 2) * width}" y="${Math.min(baseline, y(p.value))}" width="${width}" height="${Math.abs(y(p.value) - baseline)}">${title}</rect>`;
      }).join('')}</g>`;
    }).join('');
    const ticks = [low, high].map(v => `<text x="48" y="${y(v) + 4}" text-anchor="end">${esc(Number(v.toPrecision(3)))}</text>`).join('');
    const labels = c.series[0].values.map((p, i) => `<text x="${x(i)}" y="205" text-anchor="middle">${esc(p.label.length > 10 ? p.label.slice(0, 9) + '…' : p.label)}</text>`).join('');
    const legend = c.series.map((s, i) => `<span class="df-chart-series df-series-${i}">${esc(s.name)}</span>`).join(' · ');
    return `<figure class="df-chart"><figcaption>${esc(c.title)} (${esc(c.unit)})</figcaption><div class="df-chart-scroll" tabindex="0" role="region" aria-label="${esc(c.title)} chart"><svg viewBox="0 0 ${chartWidth} 220" style="min-width:${chartWidth}px" role="img" aria-label="${esc(c.title + '. ' + summary)}"><path d="M55 ${baseline}H${chartWidth - 15}" stroke="currentColor" opacity=".5"/>${ticks}${marks}${labels}</svg></div><p class="df-chart-legend">${legend}</p><details class="df-chart-data"><summary>Chart data</summary><p>${esc(summary)}</p></details></figure>`;
  }).join('');
}
