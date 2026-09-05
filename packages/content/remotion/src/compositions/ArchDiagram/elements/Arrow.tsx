/**
 * Arrow — animated SVG path connecting two diagram boxes.
 *
 * Draws itself from start to end using path trimming.
 * Optional animated data flow dots along the path.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clampedInterpolate, springProgress, type BrandColors } from "../../../lib";

export type ArrowProps = {
  /** Start position (center of source box) */
  fromX: number;
  fromY: number;
  /** End position (center of target box) */
  toX: number;
  toY: number;
  /** Brand colors */
  brand: BrandColors;
  /** Frame to start drawing */
  entranceDelay?: number;
  /** Duration of draw animation in frames */
  drawDuration?: number;
  /** Show animated data flow dots */
  showDataFlow?: boolean;
  /** Arrow color override */
  color?: string;
  /** Optional label on the arrow */
  label?: string;
  /** Curve amount (0 = straight, positive = curve right) */
  curve?: number;
};

/**
 * Calculate a quadratic bezier path between two points with optional curve.
 */
function getPath(
  fromX: number, fromY: number,
  toX: number, toY: number,
  curve: number,
): string {
  if (curve === 0) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;

  // Perpendicular offset for curve
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len;
  const ny = dx / len;

  const cx = midX + nx * curve;
  const cy = midY + ny * curve;

  return `M ${fromX} ${fromY} Q ${cx} ${cy} ${toX} ${toY}`;
}

export const Arrow: React.FC<ArrowProps> = ({
  fromX,
  fromY,
  toX,
  toY,
  brand,
  entranceDelay = 0,
  drawDuration = 20,
  showDataFlow = false,
  color,
  label,
  curve = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drawProgress = clampedInterpolate(
    frame - entranceDelay,
    [0, drawDuration],
    [0, 1],
  );

  const pathColor = color ?? `${brand.primary}AA`;
  const pathD = getPath(fromX, fromY, toX, toY, curve);

  // Arrowhead angle
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const arrowLen = 12;
  const arrowAngle = Math.PI / 6;
  const arrowProgress = springProgress(frame, fps, "snappy", entranceDelay + drawDuration);

  // Data flow dot position (loops along path)
  const dotCycle = showDataFlow ? ((frame - entranceDelay - drawDuration) % 60) / 60 : 0;

  // Label position
  const labelX = (fromX + toX) / 2;
  const labelY = (fromY + toY) / 2 + (curve || -20);
  const labelProgress = springProgress(frame, fps, "gentle", entranceDelay + drawDuration + 5);

  return (
    <g>
      {/* Arrow path */}
      <path
        d={pathD}
        fill="none"
        stroke={pathColor}
        strokeWidth={2.5}
        strokeDasharray="1000"
        strokeDashoffset={1000 * (1 - drawProgress)}
        strokeLinecap="round"
      />

      {/* Arrowhead */}
      {drawProgress >= 1 && (
        <g opacity={arrowProgress}>
          <line
            x1={toX}
            y1={toY}
            x2={toX - arrowLen * Math.cos(angle - arrowAngle)}
            y2={toY - arrowLen * Math.sin(angle - arrowAngle)}
            stroke={pathColor}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <line
            x1={toX}
            y1={toY}
            x2={toX - arrowLen * Math.cos(angle + arrowAngle)}
            y2={toY - arrowLen * Math.sin(angle + arrowAngle)}
            stroke={pathColor}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Data flow dot */}
      {showDataFlow && drawProgress >= 1 && (
        <circle
          cx={fromX + (toX - fromX) * dotCycle}
          cy={fromY + (toY - fromY) * dotCycle}
          r={4}
          fill={brand.accent}
          opacity={0.8}
        />
      )}

      {/* Label */}
      {label && (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          fill={brand.textMuted}
          fontSize={14}
          fontFamily="Inter, system-ui, sans-serif"
          opacity={labelProgress}
        >
          {label}
        </text>
      )}
    </g>
  );
};
