/**
 * CodeBlock — syntax-highlighted code with staggered line-by-line entrance.
 *
 * Uses a simple token-based highlighter (no heavy deps like Shiki/Prism).
 * Lines appear one by one with spring physics.
 * Active line gets a brand-colored glow.
 */

import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { springProgress, staggerDelay, type BrandColors } from "../../../lib";

// Simple token types for code highlighting
type TokenType = "keyword" | "string" | "comment" | "number" | "function" | "operator" | "punctuation" | "plain";

type Token = {
  text: string;
  type: TokenType;
};

// TypeScript/JavaScript keywords
const KEYWORDS = new Set([
  "import", "export", "from", "const", "let", "var", "function", "return",
  "if", "else", "for", "while", "class", "extends", "new", "this",
  "type", "interface", "async", "await", "default", "typeof", "as",
  "true", "false", "null", "undefined", "void", "readonly",
]);

/**
 * Simple tokenizer — good enough for demo videos.
 * Not a real parser — just visual highlighting.
 */
function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Whitespace
    if (/\s/.test(line[i])) {
      let start = i;
      while (i < line.length && /\s/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), type: "plain" });
      continue;
    }

    // Comment
    if (line.slice(i, i + 2) === "//") {
      tokens.push({ text: line.slice(i), type: "comment" });
      break;
    }

    // String (double or single quotes, backticks)
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j++;
        j++;
      }
      tokens.push({ text: line.slice(i, j + 1), type: "string" });
      i = j + 1;
      continue;
    }

    // Number
    if (/\d/.test(line[i])) {
      let start = i;
      while (i < line.length && /[\d.]/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), type: "number" });
      continue;
    }

    // Word (keyword or identifier)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let start = i;
      while (i < line.length && /[a-zA-Z_$0-9]/.test(line[i])) i++;
      const word = line.slice(start, i);
      // Check if next non-space char is ( for function calls
      const restTrimmed = line.slice(i).trimStart();
      if (KEYWORDS.has(word)) {
        tokens.push({ text: word, type: "keyword" });
      } else if (restTrimmed.startsWith("(")) {
        tokens.push({ text: word, type: "function" });
      } else {
        tokens.push({ text: word, type: "plain" });
      }
      continue;
    }

    // Operators and punctuation
    if (/[=<>!+\-*/%&|^~?:]/.test(line[i])) {
      let start = i;
      while (i < line.length && /[=<>!+\-*/%&|^~?:]/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), type: "operator" });
      continue;
    }

    // Punctuation
    tokens.push({ text: line[i], type: "punctuation" });
    i++;
  }

  return tokens;
}

function getTokenColor(type: TokenType, brand: BrandColors): string {
  switch (type) {
    case "keyword": return brand.accent;
    case "string": return "#A8DB8A";
    case "comment": return brand.textMuted;
    case "number": return "#F0A8D0";
    case "function": return "#7DD3FC";
    case "operator": return brand.textMuted;
    case "punctuation": return brand.textMuted;
    case "plain": return brand.text;
  }
}

export type CodeBlockProps = {
  code: string;
  brand: BrandColors;
  fontSize?: number;
  lineHeight?: number;
  /** Frame offset to start entrance */
  entranceDelay?: number;
  /** Frames between each line appearing */
  lineStagger?: number;
  /** Line numbers to highlight with glow effect */
  highlightLines?: number[];
  /** Frame when highlight appears */
  highlightAtFrame?: number;
  /** Show line numbers */
  showLineNumbers?: boolean;
};

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  brand,
  fontSize = 26,
  lineHeight = 1.6,
  entranceDelay = 10,
  lineStagger = 4,
  highlightLines = [],
  highlightAtFrame = 60,
  showLineNumbers = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = code.split("\n");

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize,
        lineHeight,
        padding: "32px 40px",
        width: "100%",
      }}
    >
      {lines.map((line, i) => {
        const delay = staggerDelay(i, entranceDelay, lineStagger);
        const lineProgress = springProgress(frame, fps, "snappy", delay);

        const isHighlighted = highlightLines.includes(i + 1);
        const highlightProgress = isHighlighted
          ? springProgress(frame, fps, "smooth", highlightAtFrame)
          : 0;

        const tokens = tokenize(line);

        return (
          <div
            key={i}
            style={{
              display: "flex",
              opacity: lineProgress,
              transform: `translateX(${(1 - lineProgress) * 30}px)`,
              backgroundColor: isHighlighted
                ? `${brand.accent}${Math.round(highlightProgress * 0.15 * 255).toString(16).padStart(2, "0")}`
                : "transparent",
              borderLeft: isHighlighted
                ? `3px solid ${brand.accent}`
                : "3px solid transparent",
              paddingLeft: 12,
              marginLeft: -15,
              borderRadius: 2,
              transition: "background-color 0.3s",
            }}
          >
            {showLineNumbers && (
              <span
                style={{
                  color: brand.textMuted,
                  opacity: 0.4,
                  minWidth: "3em",
                  textAlign: "right",
                  paddingRight: 20,
                  userSelect: "none",
                  fontSize: fontSize * 0.85,
                }}
              >
                {i + 1}
              </span>
            )}
            <span style={{ whiteSpace: "pre" }}>
              {tokens.map((token, j) => (
                <span key={j} style={{ color: getTokenColor(token.type, brand) }}>
                  {token.text}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
};
