/**
 * ScaleReveal — scales from 0 (or custom) to 1 with spring physics.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clampedInterpolate, springProgress } from "../lib/motion";
import type { SpringPresetName } from "../lib/types";

export type ScaleRevealProps = {
  delay?: number;
  from?: number;
  springPreset?: SpringPresetName;
  origin?: string;
  children: React.ReactNode;
};

export const ScaleReveal: React.FC<ScaleRevealProps> = ({
  delay = 0,
  from = 0,
  springPreset = "bouncy" as const,
  origin = "center",
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = springProgress(frame, fps, springPreset, delay);
  const scale = clampedInterpolate(progress, [0, 1], [from, 1]);
  const opacity = clampedInterpolate(progress, [0, 0.3], [0, 1]);

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: origin,
      }}
    >
      {children}
    </div>
  );
};
