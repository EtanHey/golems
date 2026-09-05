/**
 * DiagramBox — rounded rectangle with icon and label for architecture diagrams.
 *
 * Springs in from rest position with brand-colored styling.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { springProgress, type BrandColors } from "../../../lib";

export type BoxStyle = "primary" | "secondary" | "accent" | "muted";

export type DiagramBoxProps = {
  /** Label text */
  label: string;
  /** Emoji or text icon */
  icon?: string;
  /** Position (absolute, in pixels) */
  x: number;
  y: number;
  /** Dimensions */
  width?: number;
  height?: number;
  /** Visual style variant */
  variant?: BoxStyle;
  /** Frame to start entrance */
  entranceDelay?: number;
  /** Brand colors */
  brand: BrandColors;
  /** Optional subtitle */
  subtitle?: string;
};

function getBoxColors(variant: BoxStyle, brand: BrandColors) {
  switch (variant) {
    case "primary":
      return { bg: brand.primary, text: "#FFFFFF", border: brand.primaryDark };
    case "accent":
      return { bg: brand.accent, text: "#FFFFFF", border: brand.primary };
    case "muted":
      return { bg: brand.surface, text: brand.textMuted, border: `${brand.textMuted}44` };
    case "secondary":
    default:
      return { bg: brand.surface, text: brand.text, border: `${brand.primary}44` };
  }
}

export const DiagramBox: React.FC<DiagramBoxProps> = ({
  label,
  icon,
  x,
  y,
  width = 200,
  height = 80,
  variant = "secondary",
  entranceDelay = 0,
  brand,
  subtitle,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = springProgress(frame, fps, "bouncy", entranceDelay);
  const colors = getBoxColors(variant, brand);

  return (
    <div
      style={{
        position: "absolute",
        left: x - width / 2,
        top: y - height / 2,
        width,
        height: subtitle ? height + 20 : height,
        opacity: progress,
        transform: `scale(${0.5 + progress * 0.5})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        backgroundColor: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: 16,
        boxShadow: `0 4px 24px ${colors.bg}40`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon && <span style={{ fontSize: 22 }}>{icon}</span>}
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: colors.text,
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {label}
        </span>
      </div>
      {subtitle && (
        <span
          style={{
            fontSize: 13,
            color: `${colors.text}99`,
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {subtitle}
        </span>
      )}
    </div>
  );
};
