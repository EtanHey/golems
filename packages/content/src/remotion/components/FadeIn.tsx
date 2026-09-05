/**
 * FadeIn — generic opacity wrapper with spring or linear animation.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { DURATIONS, clampedInterpolate, springProgress } from "../lib/motion";
import type { SpringPresetName } from "../lib/types";

export type FadeInProps = {
  delay?: number;
  duration?: number;
  springPreset?: SpringPresetName;
  children: React.ReactNode;
};

export const FadeIn: React.FC<FadeInProps> = ({
  delay = 0,
  duration = DURATIONS.FADE_IN,
  springPreset,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = springPreset
    ? springProgress(frame, fps, springPreset, delay)
    : clampedInterpolate(frame - delay, [0, duration], [0, 1]);

  return <div style={{ opacity }}>{children}</div>;
};
