/**
 * Terminal — macOS-style terminal window with typing animation.
 *
 * Shows command output appearing character by character.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clampedInterpolate, springProgress, type BrandColors } from "../../../lib";

export type TerminalLine = {
  /** Text content */
  text: string;
  /** Whether this is a command (prefixed with $) or output */
  isCommand?: boolean;
  /** Color override */
  color?: string;
};

export type TerminalProps = {
  lines: TerminalLine[];
  brand: BrandColors;
  /** Frame to start typing */
  startFrame?: number;
  /** Characters per frame typing speed */
  charsPerFrame?: number;
  /** Show window chrome (title bar, buttons) */
  showChrome?: boolean;
  /** Terminal title */
  title?: string;
  /** Width as percentage of parent */
  width?: string;
};

export const Terminal: React.FC<TerminalProps> = ({
  lines,
  brand,
  startFrame = 0,
  charsPerFrame = 1.5,
  showChrome = true,
  title = "Terminal",
  width = "100%",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate total characters for timing
  let totalChars = 0;
  const lineCharOffsets = lines.map((line) => {
    const offset = totalChars;
    totalChars += line.text.length + 5; // +5 for pause between lines
    return offset;
  });

  const typedChars = Math.max(0, (frame - startFrame) * charsPerFrame);

  const entranceProgress = springProgress(frame, fps, "smooth", startFrame);

  return (
    <div
      style={{
        width,
        opacity: entranceProgress,
        transform: `translateY(${(1 - entranceProgress) * 20}px)`,
      }}
    >
      {/* Window chrome */}
      {showChrome && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            backgroundColor: brand.surface,
            borderRadius: "12px 12px 0 0",
            borderBottom: `1px solid ${brand.textMuted}33`,
          }}
        >
          {/* Traffic lights */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#FF5F57" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#FEBC2E" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#28C840" }} />
          </div>
          <span
            style={{
              flex: 1,
              textAlign: "center",
              color: brand.textMuted,
              fontSize: 13,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {title}
          </span>
          <div style={{ width: 52 }} />
        </div>
      )}

      {/* Terminal body */}
      <div
        style={{
          backgroundColor: `${brand.background}F0`,
          padding: "20px 24px",
          borderRadius: showChrome ? "0 0 12px 12px" : 12,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 22,
          lineHeight: 1.7,
        }}
      >
        {lines.map((line, i) => {
          const lineStart = lineCharOffsets[i];
          const visibleChars = Math.max(0, typedChars - lineStart);

          if (visibleChars <= 0) return null;

          const displayText = line.text.slice(0, Math.floor(visibleChars));
          const isTyping = visibleChars < line.text.length && visibleChars > 0;

          return (
            <div key={i} style={{ display: "flex" }}>
              {line.isCommand && (
                <span style={{ color: brand.accent, marginRight: 8 }}>$</span>
              )}
              <span style={{ color: line.color ?? (line.isCommand ? brand.text : brand.textMuted) }}>
                {displayText}
              </span>
              {isTyping && line.isCommand && (
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: "1.2em",
                    backgroundColor: brand.accent,
                    opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                    marginLeft: 2,
                  }}
                />
              )}
            </div>
          );
        })}

        {/* Blinking cursor at end */}
        {typedChars >= totalChars && (
          <div style={{ display: "flex" }}>
            <span style={{ color: brand.accent, marginRight: 8 }}>$</span>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: "1.2em",
                backgroundColor: brand.accent,
                opacity: Math.sin(frame * 0.2) > 0 ? 1 : 0,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
