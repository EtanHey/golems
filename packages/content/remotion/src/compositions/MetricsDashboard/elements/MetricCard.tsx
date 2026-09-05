/**
 * MetricCard — individual metric with count-up, trend indicator, and sparkline.
 *
 * Enhanced version of the MetricsScene card for standalone dashboard use.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SPACING, clampedInterpolate, springProgress, staggerDelay, type BrandColors } from "../../../lib";
import { SparkLine } from "./SparkLine";

export type TrendDirection = "up" | "down" | "flat";

export type MetricCardData = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  icon?: string;
  trend?: TrendDirection;
  trendValue?: string;
  sparkData?: number[];
};

export type MetricCardProps = {
  metric: MetricCardData;
  index: number;
  baseDelay: number;
  stagger: number;
  brand: BrandColors;
  /** Card style variant */
  variant?: "filled" | "outlined" | "glass";
};

function getTrendColor(trend: TrendDirection, brand: BrandColors): string {
  switch (trend) {
    case "up": return "#22C55E";
    case "down": return "#EF4444";
    case "flat": return brand.textMuted;
  }
}

function getTrendArrow(trend: TrendDirection): string {
  switch (trend) {
    case "up": return "\u2191";
    case "down": return "\u2193";
    case "flat": return "\u2192";
  }
}

export const MetricCard: React.FC<MetricCardProps> = ({
  metric,
  index,
  baseDelay,
  stagger,
  brand,
  variant = "filled",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const delay = staggerDelay(index, baseDelay, stagger);
  const entrance = springProgress(frame, fps, "bouncy", delay);
  const countFrames = 45;
  const countProgress = clampedInterpolate(frame - delay, [0, countFrames], [0, 1]);

  const currentValue = metric.value * countProgress;
  const formatted = currentValue.toFixed(metric.decimals ?? 0);

  const trendDelay = delay + countFrames;
  const trendProgress = springProgress(frame, fps, "snappy", trendDelay);

  const cardStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    padding: SPACING.lg,
    borderRadius: 20,
    gap: SPACING.sm,
    opacity: entrance,
    transform: `translateY(${(1 - entrance) * 30}px) scale(${0.9 + entrance * 0.1})`,
    minWidth: 240,
    ...(variant === "filled"
      ? { backgroundColor: brand.surface }
      : variant === "outlined"
        ? { backgroundColor: "transparent", border: `2px solid ${brand.primary}44` }
        : { backgroundColor: `${brand.surface}80`, backdropFilter: "blur(10px)" }),
  };

  return (
    <div style={cardStyle}>
      {/* Header: icon + label */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {metric.icon && <span style={{ fontSize: 24 }}>{metric.icon}</span>}
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: brand.textMuted,
            fontFamily: "Inter, system-ui, sans-serif",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {metric.label}
        </span>
      </div>

      {/* Value */}
      <div
        style={{
          fontSize: 52,
          fontWeight: 700,
          color: brand.text,
          fontFamily: "Inter, system-ui, sans-serif",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {metric.prefix ?? ""}{formatted}{metric.suffix ?? ""}
      </div>

      {/* Trend + Sparkline row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm }}>
        {metric.trend && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              opacity: trendProgress,
              transform: `translateX(${(1 - trendProgress) * -10}px)`,
            }}
          >
            <span
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: getTrendColor(metric.trend, brand),
              }}
            >
              {getTrendArrow(metric.trend)}
            </span>
            {metric.trendValue && (
              <span
                style={{
                  fontSize: 16,
                  color: getTrendColor(metric.trend, brand),
                  fontFamily: "Inter, system-ui, sans-serif",
                }}
              >
                {metric.trendValue}
              </span>
            )}
          </div>
        )}

        {metric.sparkData && metric.sparkData.length > 1 && (
          <SparkLine
            data={metric.sparkData}
            color={brand.accent}
            fillColor={brand.accent}
            startFrame={delay + 10}
            width={120}
            height={36}
          />
        )}
      </div>
    </div>
  );
};
