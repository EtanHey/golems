/**
 * MonthlyFinance — animated donut chart of LLM costs by model.
 * Segments grow from 0° to their final arc with spring physics.
 * Center shows total cost with count-up animation.
 */

import * as React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { SPACING, springProgress, type BrandColors, defaultDark, FONT_FAMILY } from "../../lib";

export interface CostEntry {
  label: string;
  value: number;
  color?: string;
}

export type MonthlyFinanceProps = {
  title?: string;
  subtitle?: string;
  brand: BrandColors;
  costs: CostEntry[];
  centerLabel?: string;
  stagger?: number;
};

const DONUT_COLORS = [
  "#6366F1", "#EC4899", "#06B6D4", "#10B981",
  "#F59E0B", "#8B5CF6", "#EF4444", "#A78BFA",
];

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.cos(angle - Math.PI / 2),
    y: cy + r * Math.sin(angle - Math.PI / 2),
  };
}

export const MonthlyFinance: React.FC<MonthlyFinanceProps> = ({
  title = "LLM Costs This Month",
  subtitle,
  brand = defaultDark,
  costs,
  centerLabel = "Total",
  stagger = 5,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const total = costs.reduce((s, c) => s + c.value, 0) || 1;
  const titleProgress = springProgress(frame, fps, "smooth", 0);

  // Donut dimensions
  const cx = width * 0.38;
  const cy = height * 0.52;
  const outerR = Math.min(cx - 80, (height - 200) / 2);
  const innerR = outerR * 0.55;

  // Center count-up
  const countProgress = springProgress(frame, fps, "smooth", 20);
  const displayTotal = (total * countProgress).toFixed(2);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.background,
        padding: SPACING.xl,
        fontFamily: FONT_FAMILY,
      }}
    >
      {/* Title */}
      {title && (
        <div
          style={{
            opacity: titleProgress,
            transform: `translateY(${interpolate(titleProgress, [0, 1], [20, 0])}px)`,
            fontSize: 36,
            fontWeight: 700,
            color: brand.text,
            marginBottom: 4,
          }}
        >
          {title}
        </div>
      )}
      {subtitle && (
        <div style={{ opacity: titleProgress, fontSize: 16, color: brand.textMuted }}>
          {subtitle}
        </div>
      )}

      {/* Donut chart as SVG overlay */}
      <svg
        style={{ position: "absolute", top: 0, left: 0 }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {costs.map((entry, i) => {
          const delay = 15 + i * stagger;
          const progress = springProgress(frame, fps, "smooth", delay);

          // Calculate start and end angles
          let startAngle = 0;
          for (let j = 0; j < i; j++) {
            startAngle += (costs[j].value / total) * Math.PI * 2;
          }
          const sliceAngle = (entry.value / total) * Math.PI * 2 * progress;
          const color = entry.color ?? DONUT_COLORS[i % DONUT_COLORS.length];

          if (sliceAngle < 0.01) return null;

          const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
          const outerEnd = polarToCartesian(cx, cy, outerR, startAngle + sliceAngle);
          const innerStart = polarToCartesian(cx, cy, innerR, startAngle + sliceAngle);
          const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);
          const largeArc = sliceAngle > Math.PI ? 1 : 0;

          const d = [
            `M ${outerStart.x} ${outerStart.y}`,
            `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
            `L ${innerStart.x} ${innerStart.y}`,
            `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
            "Z",
          ].join(" ");

          return (
            <path
              key={entry.label}
              d={d}
              fill={color}
              stroke={brand.background}
              strokeWidth={3}
              opacity={interpolate(progress, [0, 0.3], [0, 1], { extrapolateRight: "clamp" })}
            />
          );
        })}

        {/* Center text */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fill={brand.text}
          fontSize={32}
          fontWeight={700}
          fontFamily={FONT_FAMILY}
          opacity={countProgress}
        >
          ${displayTotal}
        </text>
        <text
          x={cx}
          y={cy + 22}
          textAnchor="middle"
          fill={brand.textMuted}
          fontSize={14}
          fontFamily={FONT_FAMILY}
          opacity={countProgress}
        >
          {centerLabel}
        </text>
      </svg>

      {/* Legend (right side) */}
      <div
        style={{
          position: "absolute",
          right: SPACING.xl + 20,
          top: 160,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {costs.map((entry, i) => {
          const delay = 15 + i * stagger;
          const progress = springProgress(frame, fps, "snappy", delay);
          const color = entry.color ?? DONUT_COLORS[i % DONUT_COLORS.length];
          const pct = ((entry.value / total) * 100).toFixed(1);

          return (
            <div
              key={entry.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                opacity: interpolate(progress, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }),
                transform: `translateX(${interpolate(progress, [0, 1], [30, 0])}px)`,
              }}
            >
              <div style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: color }} />
              <div style={{ fontSize: 14, color: brand.text, fontWeight: 500 }}>{entry.label}</div>
              <div style={{ fontSize: 12, color: brand.textMuted }}>{pct}%</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
