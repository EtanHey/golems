/**
 * ArchDiagram — animated architecture diagram composition.
 *
 * Boxes spring in, arrows draw themselves, labels fade in.
 * Fully data-driven via JSON props for any system architecture.
 */

import * as React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { SPACING, springProgress, type BrandColors } from "../../lib";
import { Arrow, type ArrowProps } from "./elements/Arrow";
import { DiagramBox, type BoxStyle, type DiagramBoxProps } from "./elements/DiagramBox";

export type DiagramNode = {
  id: string;
  label: string;
  icon?: string;
  subtitle?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  variant?: BoxStyle;
  entranceDelay?: number;
};

export type DiagramEdge = {
  /** Source node id */
  from: string;
  /** Target node id */
  to: string;
  /** Label on the arrow */
  label?: string;
  /** Curve amount */
  curve?: number;
  /** Show animated data flow dots */
  showDataFlow?: boolean;
  /** Color override */
  color?: string;
  /** Entrance delay (auto-calculated if not set) */
  entranceDelay?: number;
};

export type ArchDiagramProps = {
  /** Diagram title */
  title?: string;
  /** Subtitle/description */
  subtitle?: string;
  /** Nodes (boxes) in the diagram */
  nodes: DiagramNode[];
  /** Edges (arrows) connecting nodes */
  edges: DiagramEdge[];
  /** Brand colors */
  brand: BrandColors;
  /** Base delay before boxes start appearing */
  baseDelay?: number;
};

export const ArchDiagram: React.FC<ArchDiagramProps> = ({
  title,
  subtitle,
  nodes,
  edges,
  brand,
  baseDelay = 5,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Build node lookup for arrow positioning
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Calculate max box entrance delay for arrow timing
  const maxBoxDelay = Math.max(...nodes.map((n) => n.entranceDelay ?? baseDelay));
  const arrowBaseDelay = maxBoxDelay + 20;

  // Title entrance
  const titleProgress = title ? springProgress(frame, fps, "smooth", 0) : 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.background,
        padding: SPACING.lg,
      }}
    >
      {/* Title */}
      {title && (
        <div
          style={{
            position: "absolute",
            top: SPACING.lg,
            left: 0,
            right: 0,
            textAlign: "center",
            opacity: titleProgress,
            transform: `translateY(${(1 - titleProgress) * -15}px)`,
          }}
        >
          <div
            style={{
              fontSize: 42,
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
                fontSize: 22,
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

      {/* SVG layer for arrows (behind boxes) */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        {edges.map((edge, i) => {
          const fromNode = nodeMap.get(edge.from);
          const toNode = nodeMap.get(edge.to);
          if (!fromNode || !toNode) return null;

          const delay = edge.entranceDelay ?? arrowBaseDelay + i * 8;

          return (
            <Arrow
              key={`${edge.from}-${edge.to}`}
              fromX={fromNode.x}
              fromY={fromNode.y}
              toX={toNode.x}
              toY={toNode.y}
              brand={brand}
              entranceDelay={delay}
              label={edge.label}
              curve={edge.curve ?? 0}
              showDataFlow={edge.showDataFlow}
              color={edge.color}
            />
          );
        })}
      </svg>

      {/* Boxes layer */}
      {nodes.map((node) => (
        <DiagramBox
          key={node.id}
          label={node.label}
          icon={node.icon}
          subtitle={node.subtitle}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          variant={node.variant}
          entranceDelay={node.entranceDelay ?? baseDelay}
          brand={brand}
        />
      ))}
    </AbsoluteFill>
  );
};
