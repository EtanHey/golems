/**
 * ScreenshotScene — displays a screenshot with optional device frame,
 * animated highlights, zoom, and caption.
 */

import * as React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { SPACING, TYPOGRAPHY } from "../../lib/design-tokens";
import { clampedInterpolate, springProgress } from "../../lib/motion";
import type { ScreenshotHighlight, ScreenshotSceneProps } from "../../lib/scenes";
import { DeviceFrame } from "../DeviceFrame";
import { FadeIn } from "../FadeIn";
import { SlideIn } from "../SlideIn";

const Highlight: React.FC<{
  highlight: ScreenshotHighlight;
  brand?: { accent: string };
}> = ({ highlight, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const visible = frame >= highlight.showAtFrame;
  if (!visible) return null;

  const progress = springProgress(frame, fps, "snappy", highlight.showAtFrame);
  const accentColor = brand?.accent ?? "#2563EB";

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: `${highlight.x}%`,
    top: `${highlight.y}%`,
    width: `${highlight.width}%`,
    height: `${highlight.height}%`,
    opacity: progress,
  };

  switch (highlight.style ?? "border") {
    case "glow":
      return (
        <div
          style={{
            ...baseStyle,
            boxShadow: `0 0 ${20 * progress}px ${accentColor}`,
            borderRadius: 8,
          }}
        />
      );
    case "magnify":
      return (
        <div
          style={{
            ...baseStyle,
            transform: `scale(${1 + 0.3 * progress})`,
            transformOrigin: "center",
            borderRadius: 8,
            border: `2px solid ${accentColor}`,
          }}
        />
      );
    case "arrow":
      return (
        <div
          style={{
            ...baseStyle,
            borderBottom: `3px solid ${accentColor}`,
            borderRight: `3px solid ${accentColor}`,
          }}
        />
      );
    default: // "border"
      return (
        <div
          style={{
            ...baseStyle,
            border: `3px solid ${accentColor}`,
            borderRadius: 8,
            transform: `scale(${0.95 + 0.05 * progress})`,
          }}
        />
      );
  }
};

export const ScreenshotScene: React.FC<ScreenshotSceneProps> = ({
  src,
  entrance = { type: "scale", from: 0.9 },
  entranceDelay = 0,
  deviceFrame = "none",
  highlights = [],
  caption,
  zoomRegion,
  brand,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Zoom calculation
  let zoomTransform = "";
  if (zoomRegion && frame >= zoomRegion.startFrame) {
    const zoomProgress = clampedInterpolate(
      frame,
      [zoomRegion.startFrame, zoomRegion.startFrame + zoomRegion.durationFrames],
      [0, 1],
    );
    const scale = 1 + ((zoomRegion.scale ?? 2) - 1) * zoomProgress;
    const cx = zoomRegion.x + zoomRegion.width / 2;
    const cy = zoomRegion.y + zoomRegion.height / 2;
    zoomTransform = `scale(${scale}) translate(${(50 - cx) * zoomProgress}%, ${(50 - cy) * zoomProgress}%)`;
  }

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: SPACING.xl,
      }}
    >
      <SlideIn from="bottom" delay={entranceDelay} distance={100} springPreset="smooth">
        <DeviceFrame variant={deviceFrame}>
          <div style={{ position: "relative", overflow: "hidden", borderRadius: 12 }}>
            <Img
              src={staticFile(src)}
              style={{
                maxWidth: "100%",
                maxHeight: "80%",
                objectFit: "contain",
                transform: zoomTransform || undefined,
                transition: undefined, // NO CSS transitions — zoom is frame-based
              }}
            />
            {highlights.map((h, i) => (
              <Highlight key={i} highlight={h} brand={brand} />
            ))}
          </div>
        </DeviceFrame>
      </SlideIn>

      {caption && (
        <FadeIn delay={entranceDelay + 20}>
          <div
            style={{
              marginTop: SPACING.md,
              fontSize: TYPOGRAPHY.body.fontSize,
              color: brand?.textMuted ?? "#6B7280",
              textAlign: "center",
            }}
          >
            {caption}
          </div>
        </FadeIn>
      )}
    </AbsoluteFill>
  );
};
