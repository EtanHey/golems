/**
 * Brand Bridge — converts Phase 1 BrandConfig to Remotion's BrandColors.
 *
 * This bridges the content pipeline's brand.json schema (rich, multi-purpose)
 * to the leaner BrandColors type that Remotion compositions consume.
 */

import type { BrandConfig, ColorPalette } from "../../brand/schema";
import type { BrandColors } from "./types";

/**
 * Convert a BrandConfig's colors to Remotion BrandColors.
 *
 * Mapping:
 *   BrandConfig.colors.primary     → BrandColors.primary
 *   BrandConfig.colors.secondary   → BrandColors.primaryDark
 *   BrandConfig.colors.accent      → BrandColors.accent
 *   BrandConfig.colors.background  → BrandColors.background
 *   BrandConfig.colors.surface     → BrandColors.surface
 *   BrandConfig.colors.text.primary   → BrandColors.text
 *   BrandConfig.colors.text.secondary → BrandColors.textMuted
 */
export function toBrandColors(colors: ColorPalette): BrandColors {
  return {
    primary: colors.primary,
    primaryDark: colors.secondary,
    background: colors.background,
    surface: colors.surface,
    text: colors.text.primary,
    textMuted: colors.text.secondary,
    accent: colors.accent,
  };
}

/**
 * Convert a full BrandConfig to BrandColors.
 * Convenience wrapper around toBrandColors.
 */
export function brandConfigToColors(config: BrandConfig): BrandColors {
  return toBrandColors(config.colors);
}

/**
 * Font info extracted from BrandConfig for Remotion compositions.
 */
export type BrandFonts = {
  heading: { family: string; weights: Record<string, number> };
  body: { family: string; weights: Record<string, number> };
  code: { family: string; weights: Record<string, number> };
  baseFontSize: number;
};

/**
 * Extract font configuration from BrandConfig.
 */
export function toBrandFonts(config: BrandConfig): BrandFonts {
  return {
    heading: {
      family: config.typography.heading.family,
      weights: config.typography.heading.weights,
    },
    body: {
      family: config.typography.body.family,
      weights: config.typography.body.weights,
    },
    code: {
      family: config.typography.code.family,
      weights: config.typography.code.weights,
    },
    baseFontSize: config.typography.baseFontSize,
  };
}

/**
 * Get animation defaults from BrandConfig template overrides.
 * Falls back to standard defaults if not specified.
 */
export function getAnimationDefaults(config: BrandConfig) {
  const anim = config.templates?.animation;
  return {
    fps: anim?.fps ?? 30,
    width: anim?.width ?? 1920,
    height: anim?.height ?? 1080,
    durationFrames: anim?.durationFrames ?? 150,
    defaultTransition: anim?.defaultTransition ?? "crossfade",
  };
}
