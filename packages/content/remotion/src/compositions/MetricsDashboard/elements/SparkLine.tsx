/**
 * SparkLine — mini chart that draws from left to right.
 *
 * Uses SVG path with animated stroke-dashoffset for the drawing effect.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clampedInterpolate } from "../../../lib";

export type SparkLineProps = {
  /** Data points (normalized 0-1) */
  data: number[];
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Line color */
  color: string;
  /** Fill color (gradient under line) */
  fillColor?: string;
  /** Frame to start drawing */
  startFrame?: number;
  /** Duration of draw animation in frames */
  drawDuration?: number;
  /** Line width */
  strokeWidth?: number;
};

export const SparkLine: React.FC<SparkLineProps> = ({
  data,
  width = 160,
  height = 40,
  color,
  fillColor,
  startFrame = 0,
  drawDuration = 30,
  strokeWidth = 2.5,
}) => {
  const frame = useCurrentFrame();

  const drawProgress = clampedInterpolate(
    frame - startFrame,
    [0, drawDuration],
    [0, 1],
  );

  if (data.length < 2) return null;

  const padding = 4;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  // Build path
  const points = data.map((v, i) => ({
    x: padding + (i / (data.length - 1)) * innerW,
    y: padding + (1 - v) * innerH,
  }));

  const linePath = points.map((p, i) =>
    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`,
  ).join(" ");

  // Area fill path (line + close to bottom)
  const areaPath = linePath + ` L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  // Estimate total path length for dash animation
  let pathLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    pathLength += Math.sqrt(dx * dx + dy * dy);
  }

  const gradientId = `spark-fill-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fillColor && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity={0.3} />
            <stop offset="100%" stopColor={fillColor} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}

      {/* Area fill */}
      {fillColor && (
        <path
          d={areaPath}
          fill={`url(#${gradientId})`}
          opacity={drawProgress}
        />
      )}

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={pathLength}
        strokeDashoffset={pathLength * (1 - drawProgress)}
      />

      {/* Dot at current position */}
      {drawProgress > 0 && (
        <circle
          cx={points[Math.min(Math.floor(drawProgress * (points.length - 1)), points.length - 1)].x}
          cy={points[Math.min(Math.floor(drawProgress * (points.length - 1)), points.length - 1)].y}
          r={4}
          fill={color}
          opacity={drawProgress}
        />
      )}
    </svg>
  );
};
