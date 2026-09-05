/**
 * LinkedIn data card template — 1200x627 landscape.
 * Composes: stat cards row + main chart + brand footer.
 */

import type { ChartTheme } from "../charts/types";
import { DEFAULT_THEME } from "../charts/types";
import { escapeXml, stripSvgWrapper } from "./svg-utils";

export interface LinkedInCardOptions {
  title: string;
  subtitle?: string;
  chartSvg: string;
  statsSvg?: string;
  theme?: ChartTheme;
  brandName?: string;
  brandHandle?: string;
  dateRange?: string;
}

export function renderLinkedInCard(opts: LinkedInCardOptions): string {
  const theme = opts.theme ?? DEFAULT_THEME;
  const W = 1200;
  const H = 627;

  // Header area: title + subtitle
  const header = `
    <text x="40" y="50" fill="${theme.textColor}" font-size="24" font-weight="700" font-family="${theme.headingFont}">${escapeXml(opts.title)}</text>
    ${opts.subtitle ? `<text x="40" y="76" fill="${theme.textMuted}" font-size="14" font-family="${theme.labelFont}">${escapeXml(opts.subtitle)}</text>` : ""}
  `;

  // Stats row (if provided) — embedded as foreign object
  const statsArea = opts.statsSvg
    ? `<g transform="translate(40, 90)">${stripSvgWrapper(opts.statsSvg, 1120, 116)}</g>`
    : "";

  // Main chart — positioned below stats
  const chartY = opts.statsSvg ? 220 : 100;
  const chartH = H - chartY - 50;
  const chart = `<g transform="translate(40, ${chartY})">${stripSvgWrapper(opts.chartSvg, 1120, chartH)}</g>`;

  // Brand footer
  const footer = `
    <line x1="40" y1="${H - 40}" x2="${W - 40}" y2="${H - 40}" stroke="${theme.gridColor}" stroke-width="1"/>
    ${opts.brandName ? `<text x="40" y="${H - 16}" fill="${theme.textMuted}" font-size="12" font-family="${theme.labelFont}">${escapeXml(opts.brandName)}</text>` : ""}
    ${opts.brandHandle ? `<text x="${W - 40}" y="${H - 16}" fill="${theme.textMuted}" font-size="12" font-family="${theme.labelFont}" text-anchor="end">${escapeXml(opts.brandHandle)}</text>` : ""}
    ${opts.dateRange ? `<text x="${W / 2}" y="${H - 16}" fill="${theme.textMuted}" font-size="11" font-family="${theme.labelFont}" text-anchor="middle">${escapeXml(opts.dateRange)}</text>` : ""}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${theme.backgroundColor}" rx="0"/>
  ${header}
  ${statsArea}
  ${chart}
  ${footer}
</svg>`;
}

