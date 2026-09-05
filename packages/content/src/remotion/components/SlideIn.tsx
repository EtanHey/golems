/**
 * SlideIn — slides element from offscreen with spring physics.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { springProgress } from "../lib/motion";
import type { SlideDirection, SpringPresetName } from "../lib/types";

export type SlideInProps = {
  from?: SlideDirection;
  delay?: number;
  distance?: number;
  springPreset?: SpringPresetName;
  children: React.ReactNode;
};

export const SlideIn: React.FC<SlideInProps> = ({
  from = "left",
  delay = 0,
  distance = 200,
  springPreset = "smooth",
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = springProgress(frame, fps, springPreset, delay);

  const offsets: Record<SlideDirection, { x: number; y: number }> = {
    left: { x: -distance * (1 - progress), y: 0 },
    right: { x: distance * (1 - progress), y: 0 },
    top: { x: 0, y: -distance * (1 - progress) },
    bottom: { x: 0, y: distance * (1 - progress) },
  };

  const { x, y } = offsets[from];
  const opacity = progress;

  return (
    <div
      style={{
        opacity,
        transform: `translate(${x}px, ${y}px)`,
      }}
    >
      {children}
    </div>
  );
};
