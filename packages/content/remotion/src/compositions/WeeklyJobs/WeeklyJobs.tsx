/**
 * WeeklyJobs — animated horizontal bar chart of top job tags/skills.
 * Bars animate in sequentially with spring physics. Each bar grows from 0 to its final width.
 */

import * as React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { SPACING, springProgress, type BrandColors, defaultDark, FONT_FAMILY } from "../../lib";

export interface JobTagEntry {
  tag: string;
  count: number;
  color?: string;
}

export type WeeklyJobsProps = {
  title?: string;
  subtitle?: string;
  brand: BrandColors;
  tags: JobTagEntry[];
  maxBars?: number;
  stagger?: number;
};

const BAR_COLORS = [
  "#6366F1", "#8B5CF6", "#EC4899", "#06B6D4",
  "#10B981", "#F59E0B", "#EF4444", "#A78BFA",
  "#F472B6", "#22D3EE", "#34D399", "#FBBF24",
];

export const WeeklyJobs: React.FC<WeeklyJobsProps> = ({
  title = "Top Job Skills This Week",
  subtitle,
  brand = defaultDark,
  tags,
  maxBars = 8,
  stagger = 6,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const data = tags.slice(0, maxBars);
  const maxVal = Math.max(...data.map((d) => d.count), 1);

  const titleProgress = springProgress(frame, fps, "smooth", 0);

  const barAreaTop = 140;
  const barAreaBottom = height - 60;
  const barHeight = Math.min(48, (barAreaBottom - barAreaTop - data.length * 8) / data.length);
  const gap = 8;
  const labelWidth = 200;
  const barMaxWidth = width - labelWidth - 160;

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
        <div
          style={{
            opacity: titleProgress,
            fontSize: 16,
            color: brand.textMuted,
          }}
        >
          {subtitle}
        </div>
      )}

      {/* Bars */}
      <div style={{ position: "absolute", top: barAreaTop, left: SPACING.xl, right: SPACING.xl }}>
        {data.map((entry, i) => {
          const delay = 15 + i * stagger;
          const progress = springProgress(frame, fps, "snappy", delay);
          const barWidth = (entry.count / maxVal) * barMaxWidth * progress;
          const color = entry.color ?? BAR_COLORS[i % BAR_COLORS.length];

          return (
            <div
              key={entry.tag}
              style={{
                display: "flex",
                alignItems: "center",
                height: barHeight,
                marginBottom: gap,
                opacity: interpolate(progress, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }),
              }}
            >
              {/* Label */}
              <div
                style={{
                  width: labelWidth,
                  textAlign: "right",
                  paddingRight: 16,
                  fontSize: 15,
                  fontWeight: 500,
                  color: brand.text,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {entry.tag}
              </div>

              {/* Bar */}
              <div
                style={{
                  height: barHeight - 4,
                  width: Math.max(barWidth, 2),
                  backgroundColor: color,
                  borderRadius: 6,
                  transition: "none",
                }}
              />

              {/* Count */}
              <div
                style={{
                  marginLeft: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  color: brand.textMuted,
                  opacity: interpolate(progress, [0.5, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                }}
              >
                {Math.round(entry.count * progress)}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
