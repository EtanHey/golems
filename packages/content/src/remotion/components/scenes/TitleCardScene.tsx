/**
 * TitleCardScene — full-screen title card with logo, title, and subtitle.
 *
 * Used as intro/outro for product videos.
 * Supports RTL for Hebrew text.
 */

import * as React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { SPACING } from "../../lib/design-tokens";
import { clampedInterpolate } from "../../lib/motion";
import type { TitleCardProps } from "../../lib/scenes";
import type { ElementAnimation } from "../../lib/types";
import { AnimatedText } from "../AnimatedText";
import { FadeIn } from "../FadeIn";
import { ScaleReveal } from "../ScaleReveal";
import { SlideIn } from "../SlideIn";

/**
 * Render text with the appropriate entrance animation based on ElementAnimation type.
 */
const EntrancedText: React.FC<{
  entrance: ElementAnimation;
  delay: number;
  children: React.ReactNode;
}> = ({ entrance, delay, children }) => {
  switch (entrance.type) {
    case "fade":
      return <FadeIn delay={delay}>{children}</FadeIn>;
    case "scale":
      return (
        <ScaleReveal delay={delay} springPreset={entrance.springPreset ?? "bouncy"}>
          {children}
        </ScaleReveal>
      );
    case "slide":
      return (
        <SlideIn from={entrance.from} delay={delay} springPreset="smooth">
          {children}
        </SlideIn>
      );
    default:
      // bounce, float, pulse — fall back to FadeIn
      return <FadeIn delay={delay}>{children}</FadeIn>;
  }
};

export const TitleCardScene: React.FC<TitleCardProps> = ({
  title,
  subtitle,
  logoSrc,
  logoWidth = 120,
  logoHeight,
  background,
  titleEntrance = { type: "slide", from: "bottom" },
  subtitleEntrance = { type: "fade" },
  subtitleDelay = 15,
  rtl,
  brand,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  const bgValue = background.value;
  const bgStyle: React.CSSProperties =
    background.type === "gradient"
      ? { background: bgValue }
      : background.type === "image"
        ? { backgroundImage: `url(${bgValue})`, backgroundSize: "cover" }
        : { backgroundColor: bgValue };

  // Fade out in last 15 frames
  const fadeOut = clampedInterpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
  );

  const logoDelay = logoSrc ? 10 : 0;

  return (
    <AbsoluteFill
      style={{
        ...bgStyle,
        opacity: fadeOut,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: SPACING.lg,
        direction: rtl ? "rtl" : "ltr",
      }}
    >
      {logoSrc && (
        <ScaleReveal delay={0} springPreset="bouncy">
          <Img
            src={staticFile(logoSrc)}
            width={logoWidth}
            height={logoHeight}
            style={{ objectFit: "contain" }}
          />
        </ScaleReveal>
      )}

      <EntrancedText entrance={titleEntrance} delay={logoDelay}>
        <AnimatedText
          text={title}
          variant="title"
          from={titleEntrance.type === "slide" ? titleEntrance.from : "bottom"}
          delay={titleEntrance.type === "slide" ? logoDelay : 0}
          color={brand?.text}
          springPreset="smooth"
        />
      </EntrancedText>

      {subtitle && (
        <EntrancedText entrance={subtitleEntrance} delay={subtitleDelay + logoDelay}>
          <AnimatedText
            text={subtitle}
            variant="subtitle"
            from={subtitleEntrance.type === "slide" ? subtitleEntrance.from : "bottom"}
            delay={subtitleEntrance.type === "slide" ? subtitleDelay + logoDelay : 0}
            color={brand?.textMuted}
            springPreset="gentle"
          />
        </EntrancedText>
      )}
    </AbsoluteFill>
  );
};
