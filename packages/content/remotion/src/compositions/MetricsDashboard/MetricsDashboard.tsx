/**
 * MetricsDashboard — standalone animated metrics composition.
 *
 * Displays a grid of metric cards with count-up animations,
 * trend indicators, sparklines, and staggered entrances.
 * Perfect for social media stats, project dashboards, and KPI showcases.
 */

import * as React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { SPACING, springProgress, type BrandColors } from "../../lib";
import { MetricCard, type MetricCardData } from "./elements/MetricCard";

export type MetricsDashboardProps = {
  /** Dashboard title */
  title?: string;
  /** Subtitle */
  subtitle?: string;
  /** Metrics to display */
  metrics: MetricCardData[];
  /** Brand colors */
  brand: BrandColors;
  /** Layout */
  layout?: "row" | "grid-2x2" | "grid-3";
  /** Card style */
  cardVariant?: "filled" | "outlined" | "glass";
  /** Stagger between cards (frames) */
  stagger?: number;
};

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({
  title,
  subtitle,
  metrics,
  brand,
  layout = "row",
  cardVariant = "filled",
  stagger = 8,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const titleProgress = title ? springProgress(frame, fps, "smooth", 0) : 0;

  const gridStyle: React.CSSProperties =
    layout === "grid-2x2"
      ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.lg }
      : layout === "grid-3"
        ? { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: SPACING.lg }
        : {
            display: "flex",
            gap: SPACING.lg,
            justifyContent: "center",
            flexWrap: "wrap",
          };

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: SPACING.xl,
        gap: SPACING.xl,
      }}
    >
      {/* Header */}
      {title && (
        <div
          style={{
            textAlign: "center",
            opacity: titleProgress,
            transform: `translateY(${(1 - titleProgress) * -20}px)`,
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: brand.text,
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: 24,
                color: brand.textMuted,
                fontFamily: "Inter, system-ui, sans-serif",
                marginTop: 8,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}

      {/* Metrics grid */}
      <div style={gridStyle}>
        {metrics.map((metric, i) => (
          <MetricCard
            key={i}
            metric={metric}
            index={i}
            baseDelay={title ? 15 : 5}
            stagger={stagger}
            brand={brand}
            variant={cardVariant}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
