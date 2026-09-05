/**
 * Story format template — 1080x1920 vertical.
 * Composes: large title + hero stat + chart + supporting stats + brand.
 */

import type { ChartTheme } from "../charts/types";
import { DEFAULT_THEME } from "../charts/types";
import { escapeXml, stripSvgWrapper } from "./svg-utils";

export interface StoryFormatOptions {
  title: string;
  subtitle?: string;
  heroValue?: string;
  heroLabel?: string;
  chartSvg: string;
  statsSvg?: string;
  theme?: ChartTheme;
  brandName?: string;
  brandHandle?: string;
}

export function renderStoryFormat(opts: StoryFormatOptions): string {
  const theme = opts.theme ?? DEFAULT_THEME;
  const W = 1080;
  const H = 1920;

  // Title area
  const header = `
    <text x="${W / 2}" y="120" fill="${theme.textColor}" font-size="36" font-weight="700" font-family="${theme.headingFont}" text-anchor="middle">${escapeXml(opts.title)}</text>
    ${opts.subtitle ? `<text x="${W / 2}" y="160" fill="${theme.textMuted}" font-size="18" font-family="${theme.labelFont}" text-anchor="middle">${escapeXml(opts.subtitle)}</text>` : ""}
  `;

  // Hero stat (big number)
  let heroArea = "";
  let chartY = 200;
  if (opts.heroValue) {
    heroArea = `
      <text x="${W / 2}" y="280" fill="${theme.colors[0]}" font-size="72" font-weight="800" font-family="${theme.headingFont}" text-anchor="middle">${escapeXml(opts.heroValue)}</text>
      ${opts.heroLabel ? `<text x="${W / 2}" y="320" fill="${theme.textMuted}" font-size="18" font-family="${theme.labelFont}" text-anchor="middle">${escapeXml(opts.heroLabel)}</text>` : ""}
    `;
    chartY = 380;
  }

  // Main chart
  const chartH = opts.statsSvg ? 700 : 900;
  const chart = `<g transform="translate(40, ${chartY})">${stripSvgWrapper(opts.chartSvg, W - 80, chartH)}</g>`;

  // Supporting stats
  const statsArea = opts.statsSvg
    ? `<g transform="translate(40, ${chartY + chartH + 40})">${stripSvgWrapper(opts.statsSvg, W - 80, 220)}</g>`
    : "";

  // Brand footer
  const footer = `
    <rect x="0" y="${H - 80}" width="${W}" height="80" fill="${theme.gridColor}"/>
    ${opts.brandName ? `<text x="${W / 2}" y="${H - 40}" fill="${theme.textMuted}" font-size="16" font-weight="600" font-family="${theme.headingFont}" text-anchor="middle">${escapeXml(opts.brandName)}</text>` : ""}
    ${opts.brandHandle ? `<text x="${W / 2}" y="${H - 18}" fill="${theme.textMuted}" font-size="13" font-family="${theme.labelFont}" text-anchor="middle">${escapeXml(opts.brandHandle)}</text>` : ""}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${theme.backgroundColor}"/>
  ${header}
  ${heroArea}
  ${chart}
  ${statsArea}
  ${footer}
</svg>`;
}

