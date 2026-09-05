/**
 * Shared types for chart rendering.
 */

export interface ChartTheme {
  colors: string[];
  backgroundColor: string;
  textColor: string;
  textMuted: string;
  gridColor: string;
  labelFont: string;
  headingFont: string;
}

export interface ChartDimensions {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface DataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface StatCardData {
  label: string;
  value: string | number;
  delta?: number;
  deltaLabel?: string;
  icon?: string;
}

/** Default chart theme matching golems-showcase brand */
export const DEFAULT_THEME: ChartTheme = {
  colors: [
    "#6366F1", "#8B5CF6", "#A78BFA", "#C4B5FD",
    "#EC4899", "#F472B6", "#06B6D4", "#22D3EE",
    "#10B981", "#34D399", "#F59E0B", "#FBBF24",
  ],
  backgroundColor: "#0F172A",
  textColor: "#F8FAFC",
  textMuted: "#94A3B8",
  gridColor: "#1E293B",
  labelFont: "Inter, system-ui, sans-serif",
  headingFont: "Inter, system-ui, sans-serif",
};

export const DEFAULT_DIMENSIONS: ChartDimensions = {
  width: 800,
  height: 400,
  padding: { top: 40, right: 20, bottom: 60, left: 60 },
};

/** Build a ChartTheme from BrandConfig template overrides */
export function themeFromBrand(brand: {
  colors?: { primary: string; secondary: string; accent: string; background: string; surface: string; text: { primary: string; secondary: string } };
  templates?: { dataViz?: { chartColors?: string[]; gridColor?: string; labelFont?: string } };
  typography?: { body: { family: string }; heading: { family: string } };
}): ChartTheme {
  const dv = brand.templates?.dataViz;
  return {
    colors: dv?.chartColors ?? [
      brand.colors?.primary ?? DEFAULT_THEME.colors[0],
      brand.colors?.secondary ?? DEFAULT_THEME.colors[1],
      brand.colors?.accent ?? DEFAULT_THEME.colors[2],
      ...DEFAULT_THEME.colors.slice(3),
    ],
    backgroundColor: brand.colors?.background ?? DEFAULT_THEME.backgroundColor,
    textColor: brand.colors?.text?.primary ?? DEFAULT_THEME.textColor,
    textMuted: brand.colors?.text?.secondary ?? DEFAULT_THEME.textMuted,
    gridColor: dv?.gridColor ?? brand.colors?.surface ?? DEFAULT_THEME.gridColor,
    labelFont: dv?.labelFont ?? brand.typography?.body?.family ?? DEFAULT_THEME.labelFont,
    headingFont: brand.typography?.heading?.family ?? DEFAULT_THEME.headingFont,
  };
}
