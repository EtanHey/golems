/**
 * SVG bar chart generator — horizontal bars with labels and values.
 */

import { DEFAULT_DIMENSIONS, DEFAULT_THEME, type ChartDimensions, type ChartTheme, type DataPoint } from "./types";

export interface BarChartOptions {
  title?: string;
  data: DataPoint[];
  theme?: ChartTheme;
  dimensions?: ChartDimensions;
  showValues?: boolean;
  maxBars?: number;
  horizontal?: boolean;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderBarChart(opts: BarChartOptions): string {
  const theme = opts.theme ?? DEFAULT_THEME;
  const dim = opts.dimensions ?? DEFAULT_DIMENSIONS;
  const data = opts.data.slice(0, opts.maxBars ?? 12);
  const showValues = opts.showValues ?? true;
  const horizontal = opts.horizontal ?? true;

  const { width, height, padding } = dim;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  let bars = "";
  let labels = "";
  let gridLines = "";

  if (horizontal) {
    const barHeight = Math.min(32, (chartH - data.length * 4) / data.length);
    const gap = 4;

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const x = padding.left + (chartW * i) / 4;
      const val = Math.round((maxVal * i) / 4);
      gridLines += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="${theme.gridColor}" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${x}" y="${height - padding.bottom + 16}" fill="${theme.textMuted}" font-size="11" font-family="${theme.labelFont}" text-anchor="middle">${val}</text>`;
    }

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const y = padding.top + i * (barHeight + gap);
      const barW = (d.value / maxVal) * chartW;
      const color = d.color ?? theme.colors[i % theme.colors.length];

      // Label
      labels += `<text x="${padding.left - 8}" y="${y + barHeight / 2 + 4}" fill="${theme.textColor}" font-size="12" font-family="${theme.labelFont}" text-anchor="end">${escapeXml(d.label)}</text>`;

      // Bar with rounded end
      bars += `<rect x="${padding.left}" y="${y}" width="${Math.max(barW, 2)}" height="${barHeight}" fill="${color}" rx="4"/>`;

      // Value label
      if (showValues) {
        bars += `<text x="${padding.left + barW + 6}" y="${y + barHeight / 2 + 4}" fill="${theme.textMuted}" font-size="11" font-family="${theme.labelFont}">${d.value}</text>`;
      }
    }
  } else {
    // Vertical bars
    const barWidth = Math.min(48, (chartW - data.length * 4) / data.length);
    const gap = 4;
    const totalBarSpace = data.length * (barWidth + gap) - gap;
    const startX = padding.left + (chartW - totalBarSpace) / 2;

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = height - padding.bottom - (chartH * i) / 4;
      const val = Math.round((maxVal * i) / 4);
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${theme.gridColor}" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${padding.left - 8}" y="${y + 4}" fill="${theme.textMuted}" font-size="11" font-family="${theme.labelFont}" text-anchor="end">${val}</text>`;
    }

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const x = startX + i * (barWidth + gap);
      const barH = (d.value / maxVal) * chartH;
      const color = d.color ?? theme.colors[i % theme.colors.length];

      bars += `<rect x="${x}" y="${height - padding.bottom - barH}" width="${barWidth}" height="${Math.max(barH, 2)}" fill="${color}" rx="4"/>`;

      // Label (rotated)
      labels += `<text x="${x + barWidth / 2}" y="${height - padding.bottom + 16}" fill="${theme.textMuted}" font-size="10" font-family="${theme.labelFont}" text-anchor="end" transform="rotate(-45, ${x + barWidth / 2}, ${height - padding.bottom + 16})">${escapeXml(d.label)}</text>`;

      if (showValues) {
        bars += `<text x="${x + barWidth / 2}" y="${height - padding.bottom - barH - 6}" fill="${theme.textColor}" font-size="11" font-family="${theme.labelFont}" text-anchor="middle">${d.value}</text>`;
      }
    }
  }

  const title = opts.title
    ? `<text x="${width / 2}" y="${padding.top - 12}" fill="${theme.textColor}" font-size="16" font-weight="600" font-family="${theme.headingFont}" text-anchor="middle">${escapeXml(opts.title)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${theme.backgroundColor}" rx="12"/>
  ${title}
  ${gridLines}
  ${bars}
  ${labels}
</svg>`;
}
