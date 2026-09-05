/**
 * Responsive layout hook for multi-platform rendering.
 *
 * Detects current canvas dimensions and provides scaling factors
 * for adapting layouts across YouTube (16:9), LinkedIn (1:1), and GIF (small).
 */

import { useVideoConfig } from "remotion";

export type ResponsiveInfo = {
  /** True for 16:9 aspect ratios */
  isWide: boolean;
  /** True for 1:1 aspect ratios */
  isSquare: boolean;
  /** True for small canvases (GIF size) */
  isCompact: boolean;
  /** Scale factor relative to 1920px full HD */
  scale: number;
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
  /** Aspect ratio */
  aspect: number;
};

export function useResponsive(): ResponsiveInfo {
  const { width, height } = useVideoConfig();
  const aspect = width / height;

  return {
    isWide: aspect > 1.5,
    isSquare: aspect < 1.2 && aspect > 0.8,
    isCompact: width < 1000,
    scale: width / 1920,
    width,
    height,
    aspect,
  };
}

/**
 * Platform-safe font size — scales down for compact canvases,
 * ensures minimum readability.
 */
export function responsiveFontSize(basePx: number, info: ResponsiveInfo): number {
  const scaled = basePx * info.scale;
  const min = info.isCompact ? 14 : 18;
  return Math.max(min, Math.round(scaled));
}
