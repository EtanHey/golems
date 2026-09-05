/**
 * CodeShowcase — animated code walkthrough composition.
 *
 * Shows syntax-highlighted code with line-by-line entrance,
 * highlighted focus lines, and optional terminal output.
 * Perfect for technical demos, blog thumbnails, and feature previews.
 */

import * as React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { SPACING, clampedInterpolate, springProgress, type BrandColors } from "../../lib";
import { CodeBlock } from "./elements/CodeBlock";
import { Terminal, type TerminalLine } from "./elements/Terminal";

export type CodeShowcaseProps = {
  /** The code to display */
  code: string;
  /** Brand colors for theming */
  brand: BrandColors;
  /** Composition title (shown in header) */
  title?: string;
  /** Language label (e.g., "TypeScript") */
  language?: string;
  /** Lines to highlight with glow effect (1-indexed) */
  highlightLines?: number[];
  /** Frame when highlights appear */
  highlightAtFrame?: number;
  /** Terminal output lines (shown below/beside code) */
  terminalLines?: TerminalLine[];
  /** Frame when terminal starts typing */
  terminalStartFrame?: number;
  /** Layout mode */
  layout?: "stacked" | "side-by-side";
  /** Code font size */
  fontSize?: number;
  /** Show file tab header */
  showFileTab?: boolean;
  /** Filename in the tab */
  filename?: string;
};

export const CodeShowcase: React.FC<CodeShowcaseProps> = ({
  code,
  brand,
  title,
  language = "TypeScript",
  highlightLines = [],
  highlightAtFrame = 60,
  terminalLines,
  terminalStartFrame = 90,
  layout = "stacked",
  fontSize = 24,
  showFileTab = true,
  filename = "index.ts",
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const hasTerminal = terminalLines && terminalLines.length > 0;
  const isSideBySide = layout === "side-by-side" && hasTerminal;

  // Title entrance
  const titleProgress = title ? springProgress(frame, fps, "smooth", 0) : 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.background,
        display: "flex",
        flexDirection: "column",
        padding: SPACING.lg,
      }}
    >
      {/* Title */}
      {title && (
        <div
          style={{
            opacity: titleProgress,
            transform: `translateY(${(1 - titleProgress) * -20}px)`,
            marginBottom: SPACING.md,
            display: "flex",
            alignItems: "center",
            gap: SPACING.sm,
          }}
        >
          <span
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: brand.text,
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: 18,
              color: brand.accent,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "4px 12px",
              backgroundColor: `${brand.accent}20`,
              borderRadius: 6,
            }}
          >
            {language}
          </span>
        </div>
      )}

      {/* Content area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: isSideBySide ? "row" : "column",
          gap: SPACING.md,
          overflow: "hidden",
        }}
      >
        {/* Code panel */}
        <div
          style={{
            flex: isSideBySide ? 1 : undefined,
            backgroundColor: brand.surface,
            borderRadius: 16,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* File tab */}
          {showFileTab && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 16px",
                borderBottom: `1px solid ${brand.textMuted}22`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 14px",
                  backgroundColor: brand.background,
                  borderRadius: "8px 8px 0 0",
                  borderBottom: `2px solid ${brand.accent}`,
                }}
              >
                <span style={{ fontSize: 13, color: brand.textMuted }}>
                  {filename}
                </span>
              </div>
            </div>
          )}

          {/* Code content */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <CodeBlock
              code={code}
              brand={brand}
              fontSize={fontSize}
              entranceDelay={title ? 15 : 5}
              highlightLines={highlightLines}
              highlightAtFrame={highlightAtFrame}
            />
          </div>
        </div>

        {/* Terminal panel */}
        {hasTerminal && (
          <div style={{ flex: isSideBySide ? 0.7 : undefined }}>
            <Terminal
              lines={terminalLines}
              brand={brand}
              startFrame={terminalStartFrame}
              title="Output"
            />
          </div>
        )}
      </div>

      {/* Subtle watermark / branding */}
      <div
        style={{
          position: "absolute",
          bottom: SPACING.md,
          right: SPACING.lg,
          opacity: 0.3,
          fontSize: 14,
          color: brand.textMuted,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        Powered by Remotion
      </div>
    </AbsoluteFill>
  );
};
