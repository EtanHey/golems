/**
 * Design tokens — brand-agnostic color presets, typography, and spacing.
 *
 * All values are plain data (JSON-serializable).
 * Font loading happens in components via @remotion/google-fonts.
 */

import type { BrandColors } from "./types";

// --- Brand Color Presets ---

export const defaultDark: BrandColors = {
  primary: "#6366F1", // indigo-500
  primaryDark: "#4338CA", // indigo-700
  background: "#0F172A", // slate-900
  surface: "#1E293B", // slate-800
  text: "#F8FAFC", // slate-50
  textMuted: "#94A3B8", // slate-400
  accent: "#818CF8", // indigo-400
};

export const brandPresets = { defaultDark } as const;

// --- Typography ---

export const FONT_FAMILY = {
  hebrew: "Heebo",
  english: "Inter",
  mono: "JetBrains Mono",
} as const;

export const TYPOGRAPHY = {
  title: { fontSize: 72, fontWeight: 700, lineHeight: 1.1 },
  subtitle: { fontSize: 48, fontWeight: 600, lineHeight: 1.2 },
  body: { fontSize: 32, fontWeight: 400, lineHeight: 1.4 },
  code: { fontSize: 28, fontWeight: 400, lineHeight: 1.5 },
  caption: { fontSize: 24, fontWeight: 400, lineHeight: 1.3 },
} as const;

// --- Spacing (px) ---

export const SPACING = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 48,
  xl: 80,
  "2xl": 120,
} as const;

// --- Canvas Sizes ---

export const CANVAS = {
  youtube: { width: 1920, height: 1080 },
  linkedin: { width: 1080, height: 1080 },
  hero: { width: 1920, height: 700 },
} as const;
