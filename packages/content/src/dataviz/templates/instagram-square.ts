/**
 * Instagram square template — 1080x1080.
 * Composes: title header + main chart + stat row + brand footer.
 */

import type { ChartTheme } from "../charts/types";
import { DEFAULT_THEME } from "../charts/types";
import { escapeXml, stripSvgWrapper } from "./svg-utils";

export interface InstagramSquareOptions {
  title: string;
  subtitle?: string;
  chartSvg: string;
  statsSvg?: string;
  theme?: ChartTheme;
  brandName?: string;
  brandHandle?: string;
  dateRange?: string;
}

export function renderInstagramSquare(opts: InstagramSquareOptions): string {
  const theme = opts.theme ?? DEFAULT_THEME;
  const S = 1080;

  // Header
  const header = `
    <text x="${S / 2}" y="60" fill="${theme.textColor}" font-size="28" font-weight="700" font-family="${theme.headingFont}" text-anchor="middle">${escapeXml(opts.title)}</text>
    ${opts.subtitle ? `<text x="${S / 2}" y="90" fill="${theme.textMuted}" font-size="16" font-family="${theme.labelFont}" text-anchor="middle">${escapeXml(opts.subtitle)}</text>` : ""}
  `;

  // Main chart
  const chartY = 120;
  const chartH = opts.statsSvg ? 580 : 840;
  const chart = `<g transform="translate(40, ${chartY})">${stripSvgWrapper(opts.chartSvg, S - 80, chartH)}</g>`;

  // Stats row below chart
  const statsArea = opts.statsSvg
    ? `<g transform="translate(40, 720)">${stripSvgWrapper(opts.statsSvg, S - 80, 116)}</g>`
    : "";

  // Brand footer
  const footer = `
    <rect x="0" y="${S - 60}" width="${S}" height="60" fill="${theme.gridColor}" rx="0"/>
    ${opts.brandName ? `<text x="40" y="${S - 26}" fill="${theme.textMuted}" font-size="14" font-family="${theme.labelFont}">${escapeXml(opts.brandName)}</text>` : ""}
    ${opts.brandHandle ? `<text x="${S - 40}" y="${S - 26}" fill="${theme.textMuted}" font-size="14" font-family="${theme.labelFont}" text-anchor="end">${escapeXml(opts.brandHandle)}</text>` : ""}
    ${opts.dateRange ? `<text x="${S / 2}" y="${S - 26}" fill="${theme.textMuted}" font-size="12" font-family="${theme.labelFont}" text-anchor="middle">${escapeXml(opts.dateRange)}</text>` : ""}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <rect width="${S}" height="${S}" fill="${theme.backgroundColor}"/>
  ${header}
  ${chart}
  ${statsArea}
  ${footer}
</svg>`;
}

