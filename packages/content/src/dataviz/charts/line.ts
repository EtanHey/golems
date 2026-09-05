/**
 * SVG line/area chart generator — time series with gradient fill.
 */

import { DEFAULT_DIMENSIONS, DEFAULT_THEME, type ChartDimensions, type ChartTheme, type TimeSeriesPoint } from "./types";

export interface LineChartOptions {
  title?: string;
  data: TimeSeriesPoint[];
  theme?: ChartTheme;
  dimensions?: ChartDimensions;
  showArea?: boolean;
  showDots?: boolean;
  lineColor?: string;
  yAxisLabel?: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderLineChart(opts: LineChartOptions): string {
  const theme = opts.theme ?? DEFAULT_THEME;
  const dim = opts.dimensions ?? DEFAULT_DIMENSIONS;
  const showArea = opts.showArea ?? true;
  const showDots = opts.showDots ?? true;
  const color = opts.lineColor ?? theme.colors[0];

  const { width, height, padding } = dim;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  if (opts.data.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${theme.backgroundColor}" rx="12"/>
  <text x="${width / 2}" y="${height / 2}" fill="${theme.textMuted}" font-size="14" font-family="${theme.labelFont}" text-anchor="middle">No data</text>
</svg>`;
  }

  const values = opts.data.map((d) => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Map data to coordinates
  const points = opts.data.map((d, i) => ({
    x: padding.left + (i / Math.max(opts.data.length - 1, 1)) * chartW,
    y: padding.top + chartH - ((d.value - minVal) / range) * chartH,
    ...d,
  }));

  // Polyline
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Area path (closes to bottom)
  const areaPath = showArea
    ? `<path d="M ${points[0].x} ${points[0].y} ${points.map((p) => `L ${p.x} ${p.y}`).join(" ")} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z" fill="url(#areaGrad)" opacity="0.3"/>`
    : "";

  // Gradient definition
  const gradientDef = showArea
    ? `<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    : "";

  // Dots
  let dots = "";
  if (showDots) {
    for (const p of points) {
      dots += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}" stroke="${theme.backgroundColor}" stroke-width="2"/>`;
    }
  }

  // Grid lines + Y axis labels
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH * i) / 4;
    const val = maxVal - (range * i) / 4;
    grid += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${theme.gridColor}" stroke-dasharray="4,4"/>`;
    grid += `<text x="${padding.left - 8}" y="${y + 4}" fill="${theme.textMuted}" font-size="10" font-family="${theme.labelFont}" text-anchor="end">${formatNumber(val)}</text>`;
  }

  // X axis labels (show ~6 evenly spaced)
  let xLabels = "";
  const step = Math.max(1, Math.floor(opts.data.length / 6));
  for (let i = 0; i < opts.data.length; i += step) {
    const p = points[i];
    xLabels += `<text x="${p.x}" y="${height - padding.bottom + 16}" fill="${theme.textMuted}" font-size="10" font-family="${theme.labelFont}" text-anchor="middle">${escapeXml(p.date)}</text>`;
  }
  // Always show last point
  if (opts.data.length > 1) {
    const last = points[points.length - 1];
    xLabels += `<text x="${last.x}" y="${height - padding.bottom + 16}" fill="${theme.textMuted}" font-size="10" font-family="${theme.labelFont}" text-anchor="end">${escapeXml(last.date)}</text>`;
  }

  const title = opts.title
    ? `<text x="${width / 2}" y="${padding.top - 12}" fill="${theme.textColor}" font-size="16" font-weight="600" font-family="${theme.headingFont}" text-anchor="middle">${escapeXml(opts.title)}</text>`
    : "";

  const yLabel = opts.yAxisLabel
    ? `<text x="14" y="${height / 2}" fill="${theme.textMuted}" font-size="11" font-family="${theme.labelFont}" text-anchor="middle" transform="rotate(-90, 14, ${height / 2})">${escapeXml(opts.yAxisLabel)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${gradientDef}
  <rect width="${width}" height="${height}" fill="${theme.backgroundColor}" rx="12"/>
  ${title}
  ${yLabel}
  ${grid}
  ${areaPath}
  <polyline points="${linePoints}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${xLabels}
</svg>`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toString();
}
