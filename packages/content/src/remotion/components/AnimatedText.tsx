/**
 * AnimatedText — RTL-aware text with spring entrance animation.
 *
 * Detects Hebrew characters automatically and sets dir="rtl".
 * Uses @remotion/google-fonts for Heebo (Hebrew) + Inter (English).
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { TYPOGRAPHY } from "../lib/design-tokens";
import { LOADED_FONTS } from "../lib/fonts";
import { clampedInterpolate, springProgress } from "../lib/motion";
import type { SlideDirection, SpringPresetName, TextVariant } from "../lib/types";

const HEBREW_RE = /[\u0590-\u05FF]/;

export type AnimatedTextProps = {
  text: string;
  delay?: number;
  variant?: TextVariant;
  /** Direction text slides FROM. "bottom" = text appears to move up. */
  from?: SlideDirection;
  color?: string;
  fontFamily?: string;
  springPreset?: SpringPresetName;
};

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  delay = 0,
  variant = "body" as TextVariant,
  from = "bottom" as SlideDirection,
  color,
  fontFamily,
  springPreset = "smooth" as SpringPresetName,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const isHebrew = HEBREW_RE.test(text);
  const resolvedFont = fontFamily ?? (isHebrew ? LOADED_FONTS.hebrew : LOADED_FONTS.english);
  const style = TYPOGRAPHY[variant];

  const progress = springProgress(frame, fps, springPreset, delay);
  const opacity = clampedInterpolate(progress, [0, 1], [0, 1]);

  const slideDistance = 40;
  const translateMap: Record<SlideDirection, { x: number; y: number }> = {
    top: { x: 0, y: -slideDistance * (1 - progress) },
    bottom: { x: 0, y: slideDistance * (1 - progress) },
    left: { x: -slideDistance * (1 - progress), y: 0 },
    right: { x: slideDistance * (1 - progress), y: 0 },
  };

  const translate = translateMap[from];

  return (
    <div
      dir={isHebrew ? "rtl" : undefined}
      style={{
        opacity,
        transform: `translate(${translate.x}px, ${translate.y}px)`,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        fontFamily: resolvedFont,
        color: color ?? "inherit",
        textAlign: isHebrew ? "right" : "left",
      }}
    >
      {text}
    </div>
  );
};
