/**
 * SVG donut chart generator — segments with labels and center text.
 */

import { DEFAULT_THEME, type ChartTheme, type DataPoint } from "./types";

export interface DonutChartOptions {
  title?: string;
  data: DataPoint[];
  theme?: ChartTheme;
  width?: number;
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  innerRadiusRatio?: number;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

export function renderDonutChart(opts: DonutChartOptions): string {
  const theme = opts.theme ?? DEFAULT_THEME;
  const width = opts.width ?? 600;
  const height = opts.height ?? 400;
  const innerRatio = opts.innerRadiusRatio ?? 0.55;

  const cx = width * 0.38;
  const cy = height / 2;
  const outerR = Math.min(cx - 30, cy - 50);
  const innerR = outerR * innerRatio;

  const total = opts.data.reduce((s, d) => s + d.value, 0) || 1;
  let currentAngle = -Math.PI / 2; // Start at top

  let segments = "";
  let legendItems = "";

  for (let i = 0; i < opts.data.length; i++) {
    const d = opts.data[i];
    const pct = d.value / total;
    const sliceAngle = pct * Math.PI * 2;
    const color = d.color ?? theme.colors[i % theme.colors.length];

    if (sliceAngle > 0.01) {
      // Donut segment (two arcs + two lines)
      const outerStart = polarToCartesian(cx, cy, outerR, currentAngle);
      const outerEnd = polarToCartesian(cx, cy, outerR, currentAngle + sliceAngle);
      const innerStart = polarToCartesian(cx, cy, innerR, currentAngle + sliceAngle);
      const innerEnd = polarToCartesian(cx, cy, innerR, currentAngle);
      const largeArc = sliceAngle > Math.PI ? 1 : 0;

      const path = [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerStart.x} ${innerStart.y}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
        "Z",
      ].join(" ");

      segments += `<path d="${path}" fill="${color}" stroke="${theme.backgroundColor}" stroke-width="2"/>`;
    }

    currentAngle += sliceAngle;

    // Legend item (right side)
    const legendX = width * 0.7;
    const legendY = 50 + i * 28;
    if (legendY < height - 20) {
      legendItems += `<rect x="${legendX}" y="${legendY}" width="14" height="14" fill="${color}" rx="3"/>`;
      legendItems += `<text x="${legendX + 22}" y="${legendY + 12}" fill="${theme.textColor}" font-size="12" font-family="${theme.labelFont}">${escapeXml(d.label)}</text>`;
      legendItems += `<text x="${width - 20}" y="${legendY + 12}" fill="${theme.textMuted}" font-size="11" font-family="${theme.labelFont}" text-anchor="end">${d.value} (${Math.round(pct * 100)}%)</text>`;
    }
  }

  // Center text
  let centerText = "";
  if (opts.centerValue) {
    centerText += `<text x="${cx}" y="${cy - 4}" fill="${theme.textColor}" font-size="28" font-weight="700" font-family="${theme.headingFont}" text-anchor="middle">${escapeXml(opts.centerValue)}</text>`;
  }
  if (opts.centerLabel) {
    centerText += `<text x="${cx}" y="${cy + 18}" fill="${theme.textMuted}" font-size="12" font-family="${theme.labelFont}" text-anchor="middle">${escapeXml(opts.centerLabel)}</text>`;
  }

  const title = opts.title
    ? `<text x="${width / 2}" y="28" fill="${theme.textColor}" font-size="16" font-weight="600" font-family="${theme.headingFont}" text-anchor="middle">${escapeXml(opts.title)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${theme.backgroundColor}" rx="12"/>
  ${title}
  ${segments}
  ${centerText}
  ${legendItems}
</svg>`;
}
