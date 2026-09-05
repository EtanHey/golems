/**
 * SVG stat card — big number with label and optional delta indicator.
 */

import { DEFAULT_THEME, type ChartTheme, type StatCardData } from "./types";

export interface StatCardOptions {
  stats: StatCardData[];
  theme?: ChartTheme;
  width?: number;
  height?: number;
  columns?: number;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderStatCards(opts: StatCardOptions): string {
  const theme = opts.theme ?? DEFAULT_THEME;
  const width = opts.width ?? 800;
  const cols = opts.columns ?? Math.min(opts.stats.length, 4);
  const cardW = (width - (cols + 1) * 16) / cols;
  const cardH = 100;
  const height = opts.height ?? Math.ceil(opts.stats.length / cols) * (cardH + 16) + 16;

  let cards = "";
  for (let i = 0; i < opts.stats.length; i++) {
    const s = opts.stats[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 16 + col * (cardW + 16);
    const y = 16 + row * (cardH + 16);
    const color = theme.colors[i % theme.colors.length];

    // Card background
    cards += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" fill="${theme.gridColor}" rx="8"/>`;

    // Accent bar
    cards += `<rect x="${x}" y="${y}" width="4" height="${cardH}" fill="${color}" rx="2"/>`;

    // Value
    const valueStr = typeof s.value === "number" ? formatNumber(s.value) : s.value;
    cards += `<text x="${x + 20}" y="${y + 40}" fill="${theme.textColor}" font-size="28" font-weight="700" font-family="${theme.headingFont}">${escapeXml(String(valueStr))}</text>`;

    // Label
    cards += `<text x="${x + 20}" y="${y + 62}" fill="${theme.textMuted}" font-size="12" font-family="${theme.labelFont}">${escapeXml(s.label)}</text>`;

    // Delta
    if (s.delta != null) {
      const isPositive = s.delta >= 0;
      const deltaColor = isPositive ? "#10B981" : "#EF4444";
      const arrow = isPositive ? "\u25B2" : "\u25BC";
      const deltaText = `${arrow} ${Math.abs(s.delta)}%`;
      cards += `<text x="${x + cardW - 12}" y="${y + 38}" fill="${deltaColor}" font-size="13" font-weight="600" font-family="${theme.labelFont}" text-anchor="end">${deltaText}</text>`;
      if (s.deltaLabel) {
        cards += `<text x="${x + cardW - 12}" y="${y + 54}" fill="${theme.textMuted}" font-size="10" font-family="${theme.labelFont}" text-anchor="end">${escapeXml(s.deltaLabel)}</text>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${theme.backgroundColor}" rx="12"/>
  ${cards}
</svg>`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toLocaleString();
}
