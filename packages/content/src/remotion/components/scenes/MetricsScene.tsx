/**
 * MetricsScene — displays key metrics with animated count-up.
 *
 * Each metric counts from 0 to its target value with spring easing.
 * Supports grid/row layouts and staggered entrance.
 */

import * as React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { SPACING, TYPOGRAPHY } from "../../lib/design-tokens";
import { clampedInterpolate, springProgress, staggerDelay } from "../../lib/motion";
import type { MetricItem, MetricsSceneProps } from "../../lib/scenes";
import { FadeIn } from "../FadeIn";
import { AnimatedText } from "../AnimatedText";

const MetricCard: React.FC<{
  metric: MetricItem;
  index: number;
  baseDelay: number;
  stagger: number;
  brand?: { primary: string; text: string; textMuted: string; surface: string };
}> = ({ metric, index, baseDelay, stagger, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const delay = staggerDelay(index, baseDelay, stagger);
  const startFrame = metric.startFrame ?? delay;
  const countFrames = metric.countUpFrames ?? 45;

  // Spring for the entrance animation (card reveal)
  const entranceProgress = springProgress(frame, fps, metric.springPreset ?? "smooth", startFrame);

  // Linear count-up over countUpFrames for the number animation
  const countProgress = clampedInterpolate(
    frame - startFrame,
    [0, countFrames],
    [0, 1],
  );

  const currentValue = metric.value * countProgress;
  const decimals = metric.decimals ?? 0;
  const formatted = currentValue.toFixed(decimals);

  return (
    <FadeIn delay={delay} springPreset="smooth">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: SPACING.sm,
          padding: SPACING.lg,
          backgroundColor: brand?.surface ?? "rgba(255,255,255,0.1)",
          borderRadius: 16,
          minWidth: 200,
        }}
      >
        {metric.icon && (
          <div style={{ fontSize: 48 }}>{metric.icon}</div>
        )}
        <div
          style={{
            fontSize: TYPOGRAPHY.title.fontSize,
            fontWeight: TYPOGRAPHY.title.fontWeight,
            color: brand?.primary ?? "#6366F1",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {metric.prefix ?? ""}
          {formatted}
          {metric.suffix ?? ""}
        </div>
        <div
          style={{
            fontSize: TYPOGRAPHY.body.fontSize,
            color: brand?.textMuted ?? "#94A3B8",
          }}
        >
          {metric.label}
        </div>
      </div>
    </FadeIn>
  );
};

export const MetricsScene: React.FC<MetricsSceneProps> = ({
  heading,
  metrics,
  layout = "row",
  background,
  staggerDelay: stagger = 8,
  brand,
  durationInFrames,
}) => {
  const bgStyle: React.CSSProperties = background
    ? background.type === "gradient"
      ? { background: background.value }
      : { backgroundColor: background.value }
    : {};

  const gridStyle: React.CSSProperties =
    layout === "grid-2x2"
      ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.lg }
      : layout === "grid-3"
        ? { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: SPACING.lg }
        : { display: "flex", gap: SPACING.xl, justifyContent: "center" };

  return (
    <AbsoluteFill
      style={{
        ...bgStyle,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: SPACING.xl,
        padding: SPACING.xl,
      }}
    >
      {heading && (
        <AnimatedText
          text={heading}
          variant="subtitle"
          from="bottom"
          delay={0}
          color={brand?.text}
        />
      )}
      <div style={gridStyle}>
        {metrics.map((metric, i) => (
          <MetricCard
            key={i}
            metric={metric}
            index={i}
            baseDelay={heading ? 15 : 5}
            stagger={stagger}
            brand={brand}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
