/**
 * FloatLoop — gentle ambient floating animation using sine wave.
 *
 * Perfect for decorative elements: magnifying glass, bubbles, pins.
 * Uses Math.sin() on frame count — fully deterministic, no CSS animations.
 */

import * as React from "react";
import { useCurrentFrame } from "remotion";
import type { FloatDirection } from "../lib/types";

export type FloatLoopProps = {
  amplitude?: number;
  speed?: number;
  direction?: FloatDirection;
  children: React.ReactNode;
};

export const FloatLoop: React.FC<FloatLoopProps> = ({
  amplitude = 10,
  speed = 0.03,
  direction = "vertical",
  children,
}) => {
  const frame = useCurrentFrame();

  const sin = Math.sin(frame * speed);
  const cos = Math.cos(frame * speed);

  let x = 0;
  let y = 0;

  switch (direction) {
    case "vertical":
      y = sin * amplitude;
      break;
    case "horizontal":
      x = sin * amplitude;
      break;
    case "circular":
      x = cos * amplitude;
      y = sin * amplitude;
      break;
  }

  return (
    <div style={{ transform: `translate(${x}px, ${y}px)` }}>{children}</div>
  );
};
