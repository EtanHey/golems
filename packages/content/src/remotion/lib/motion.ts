/**
 * Motion helpers — spring presets, duration constants, and utility functions.
 *
 * Every helper wraps Remotion primitives with sensible defaults
 * (extrapolateRight: 'clamp' everywhere, named spring presets).
 */

import { interpolate, spring } from "remotion";
import type { SpringConfig, SpringPresetName } from "./types";

// --- Spring Presets ---

export const SPRING_PRESETS: Record<SpringPresetName, SpringConfig> = {
  snappy: { stiffness: 200, damping: 20, mass: 0.5 },
  smooth: { stiffness: 80, damping: 20, mass: 1.0 },
  bouncy: { stiffness: 120, damping: 10, mass: 0.8 },
  gentle: { stiffness: 40, damping: 15, mass: 1.2 },
  heavy: { stiffness: 60, damping: 25, mass: 2.0 },
};

// --- Duration Constants (frames at 30fps) ---

export const DURATIONS = {
  FADE_IN: 15, // 0.5s
  SLIDE_IN: 20, // 0.67s
  HOLD: 90, // 3s
  SCENE_MIN: 120, // 4s
  SCENE_DEFAULT: 150, // 5s
  TRANSITION: 15, // 0.5s overlap
} as const;

// --- Helper Functions ---

/**
 * Wraps Remotion's interpolate() with extrapolateLeft/Right: 'clamp'.
 * Prevents values from exceeding the output range.
 */
export function clampedInterpolate(
  frame: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
): number {
  return interpolate(frame, inputRange, outputRange, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/**
 * Returns a spring progress value (0 → 1) using a named preset.
 * Useful for driving opacity, scale, or position.
 */
export function springProgress(
  frame: number,
  fps: number,
  preset: SpringPresetName = "smooth",
  delay = 0,
): number {
  const config = SPRING_PRESETS[preset];
  return spring({
    frame: frame - delay,
    fps,
    config,
    durationInFrames: undefined, // let spring settle naturally
  });
}

/**
 * Computes the staggered delay for the Nth item in a sequence.
 * Example: staggerDelay(2, 10, 5) → 10 + 2*5 = 20 frames.
 */
export function staggerDelay(
  index: number,
  baseDelay: number,
  gap = 5,
): number {
  return baseDelay + index * gap;
}
