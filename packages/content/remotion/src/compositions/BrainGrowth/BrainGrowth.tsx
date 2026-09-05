/**
 * BrainGrowth — animated line chart of knowledge base growth over time.
 * Line draws from left to right, area fills in, dots appear at data points.
 */

import * as React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { SPACING, springProgress, type BrandColors, defaultDark, FONT_FAMILY } from "../../lib";

export interface GrowthPoint {
  label: string;
  value: number;
}

export type BrainGrowthProps = {
  title?: string;
  subtitle?: string;
  brand: BrandColors;
  data: GrowthPoint[];
  yAxisLabel?: string;
  lineColor?: string;
};

export const BrainGrowth: React.FC<BrainGrowthProps> = ({
  title = "Knowledge Base Growth",
  subtitle,
  brand = defaultDark,
  data,
  yAxisLabel = "Chunks",
  lineColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const titleProgress = springProgress(frame, fps, "smooth", 0);
  const color = lineColor ?? brand.accent ?? "#6366F1";

  // Chart area
  const chartLeft = 100;
  const chartRight = width - 60;
  const chartTop = 140;
  const chartBottom = height - 80;
  const chartW = chartRight - chartLeft;
  const chartH = chartBottom - chartTop;

  const values = data.map((d) => d.value);
  const minVal = Math.min(...values) * 0.9;
  const maxVal = Math.max(...values) * 1.05;
  const range = maxVal - minVal || 1;

  // Map data to coordinates
  const points = data.map((d, i) => ({
    x: chartLeft + (i / Math.max(data.length - 1, 1)) * chartW,
    y: chartTop + chartH - ((d.value - minVal) / range) * chartH,
    ...d,
  }));

  // Animation: line draws over time
  const drawProgress = interpolate(frame, [20, 20 + data.length * 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // How many points are visible
  const visibleCount = Math.ceil(drawProgress * points.length);
  const visiblePoints = points.slice(0, visibleCount);

  // Partial last point interpolation
  const fractional = drawProgress * points.length - Math.floor(drawProgress * points.length);
  if (visibleCount > 0 && visibleCount < points.length && fractional > 0) {
    const prev = points[visibleCount - 1];
    const next = points[visibleCount];
    if (next) {
      visiblePoints[visiblePoints.length - 1] = {
        ...prev,
        x: prev.x + (next.x - prev.x) * fractional,
        y: prev.y + (next.y - prev.y) * fractional,
      };
    }
  }

  // Build polyline string
  const lineStr = visiblePoints.map((p) => `${p.x},${p.y}`).join(" ");

  // Area path
  const areaStr = visiblePoints.length >= 2
    ? `M ${visiblePoints[0].x} ${chartBottom} ${visiblePoints.map((p) => `L ${p.x} ${p.y}`).join(" ")} L ${visiblePoints[visiblePoints.length - 1].x} ${chartBottom} Z`
    : "";

  // Grid lines
  const gridCount = 4;

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

      {/* Chart SVG */}
      <svg
        style={{ position: "absolute", top: 0, left: 0 }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Gradient */}
        <defs>
          <linearGradient id="brainAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Grid */}
        {Array.from({ length: gridCount + 1 }).map((_, i) => {
          const y = chartTop + (chartH * i) / gridCount;
          const val = maxVal - (range * i) / gridCount;
          return (
            <g key={i}>
              <line
                x1={chartLeft}
                y1={y}
                x2={chartRight}
                y2={y}
                stroke={brand.surface}
                strokeDasharray="4,4"
                opacity={0.5}
              />
              <text
                x={chartLeft - 10}
                y={y + 4}
                textAnchor="end"
                fill={brand.textMuted}
                fontSize={11}
                fontFamily={FONT_FAMILY}
              >
                {formatNumber(val)}
              </text>
            </g>
          );
        })}

        {/* Y axis label */}
        {yAxisLabel && (
          <text
            x={20}
            y={chartTop + chartH / 2}
            textAnchor="middle"
            fill={brand.textMuted}
            fontSize={12}
            fontFamily={FONT_FAMILY}
            transform={`rotate(-90, 20, ${chartTop + chartH / 2})`}
          >
            {yAxisLabel}
          </text>
        )}

        {/* X axis labels */}
        {points.map((p, i) => {
          if (data.length > 8 && i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) {
            return null;
          }
          return (
            <text
              key={i}
              x={p.x}
              y={chartBottom + 20}
              textAnchor="middle"
              fill={brand.textMuted}
              fontSize={11}
              fontFamily={FONT_FAMILY}
            >
              {p.label}
            </text>
          );
        })}

        {/* Area fill */}
        {areaStr && <path d={areaStr} fill="url(#brainAreaGrad)" />}

        {/* Line */}
        {visiblePoints.length >= 2 && (
          <polyline
            points={lineStr}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Dots (only for fully revealed points) */}
        {points.slice(0, Math.floor(drawProgress * points.length)).map((p, i) => {
          const dotDelay = 20 + i * 3;
          const dotProgress = springProgress(frame, fps, "snappy", dotDelay);
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={4 * dotProgress}
              fill={color}
              stroke={brand.background}
              strokeWidth={2}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return Math.round(n).toString();
}
