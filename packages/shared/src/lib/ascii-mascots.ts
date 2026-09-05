/**
 * Guardian Golem — Canonical ASCII art + ANSI truecolor renderer
 *
 * Source of truth: etanheyman.com GolemMascot.tsx (the 16-line guardian)
 * Color palette: clay (#c4783c), accent (#8b7355), glow (#ffb020)
 *
 * Two variants:
 *   - GUARDIAN_ART_SIMPLE: 16 lines, ~28 chars — canonical from GolemMascot.tsx
 *   - GUARDIAN_ART_FULL: 22 lines, ~38 chars — hand-crafted scaled-up version
 *
 * Template format: ${c1}-${c6} placeholders replaced with ANSI color codes at render time.
 */

// ---------------------------------------------------------------------------
// Guardian Art — Full variant (22 lines, hand-crafted from the 16-line guardian)
// For terminals >= 60 cols
// ---------------------------------------------------------------------------

// AIDEV-NOTE: The template uses ${c1}-${c6} color placeholders.
// These are NOT JS template literals — they're string tokens replaced at render time.
// This is a scaled-up version of GUARDIAN_ART_SIMPLE preserving all design elements:
// rounded head, ▓░░ clay gradients, inscription plate with Hebrew אמת,
// diamond eyes ■◆■, code mouth {··}, shoulder bars ╔══╗.

export const GUARDIAN_ART_FULL = [
  "${c4}         ${c1}▄▄${c4}▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄${c1}▄▄",
  "${c4}       ${c1}▄██${c2}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${c1}██▄",
  "${c4}     ${c1}▄██${c2}▓${c1}░░░░░░░░░░░░░░░░░░░░░░░░${c2}▓${c1}██▄",
  "${c4}    ${c1}███${c2}▓${c1}░░░${c5}┌──────────────────┐${c1}░░░${c2}▓${c1}███",
  "${c4}    ${c1}███${c2}▓${c1}░░░${c5}│${c6}    א   מ   ת     ${c5}│${c1}░░░${c2}▓${c1}███",
  "${c4}    ${c1}███${c2}▓${c1}░░░${c5}└──────────────────┘${c1}░░░${c2}▓${c1}███",
  "${c4}    ${c1}███${c2}▓${c1}░░░░░░░░░░░░░░░░░░░░░░░░░░${c2}▓${c1}███",
  "${c4}   ${c1}████${c2}▓${c1}░░░░${c2}■■■■${c1}░░░░░░░░░░${c2}■■■■${c1}░░░░${c2}▓${c1}████",
  "${c4}   ${c1}████${c2}▓${c1}░░░░${c2}■${c6}◆◆${c2}■${c1}░░░░░░░░░░${c2}■${c6}◆◆${c2}■${c1}░░░░${c2}▓${c1}████",
  "${c4}   ${c1}████${c2}▓${c1}░░░░${c2}■■■■${c1}░░░░░░░░░░${c2}■■■■${c1}░░░░${c2}▓${c1}████",
  "${c4}    ${c1}███${c2}▓${c1}░░░░░░░░░░░░░░░░░░░░░░░░░░${c2}▓${c1}███",
  "${c4}    ${c1}███${c2}▓${c1}░░░░${c5}╔════════════════╗${c1}░░░░${c2}▓${c1}███",
  "${c4}    ${c1}███${c2}▓${c1}░░░░${c5}║${c6}     { ·· }     ${c5}║${c1}░░░░${c2}▓${c1}███",
  "${c4}    ${c1}███${c2}▓${c1}░░░░${c5}╚════════════════╝${c1}░░░░${c2}▓${c1}███",
  "${c4}    ${c1}███${c2}▓${c1}░░░░░░░░░░░░░░░░░░░░░░░░░░${c2}▓${c1}███",
  "${c4}     ${c1}███${c2}▓${c1}░░░░░░░░░░░░░░░░░░░░░░░░${c2}▓${c1}███",
  "${c4}      ${c1}▀██${c2}▓${c1}░░░░░░░░░░░░░░░░░░░░░░${c2}▓${c1}██▀",
  "${c4}       ${c1}▀██${c2}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${c1}██▀",
  "${c4}    ${c5}╔══${c1}▀██████████████████████████▀${c5}══╗",
  "${c4}    ${c5}║${c1}░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${c5}║",
  "${c4}    ${c5}╚════════════════════════════════╝",
  "${c3}                   ◇◇",
];

// ---------------------------------------------------------------------------
// Guardian Art — Simple variant (from GolemMascot.tsx, 16 lines)
// For narrow terminals (< 40 cols)
// ---------------------------------------------------------------------------

export const GUARDIAN_ART_SIMPLE = [
  "         ▄▄████████▄▄",
  "       ▄██▓░░░░░░░░▓██▄",
  "     ▄██▓░░┌──────┐░░▓██▄",
  "    ███▓░░░│ אמת  │░░░▓███",
  "   ███▓░░░░└──────┘░░░░▓███",
  "   ███▓░░░░░░░░░░░░░░░░▓███",
  "  ████▓░░■■■░░░░░░■■■░░▓████",
  "  ████▓░░■◆■░░░░░░■◆■░░▓████",
  "  ████▓░░■■■░░░░░░■■■░░▓████",
  "   ███▓░░░░░░░░░░░░░░░░▓███",
  "   ███▓░░░░╔══════╗░░░░▓███",
  "   ███▓░░░░║ {··} ║░░░░▓███",
  "    ███▓░░░╚══════╝░░░▓███",
  "     ▀██▓░░░░░░░░░░░░▓██▀",
  "    ╔══▀████████████████▀══╗",
  "    ║                      ║",
];

// ---------------------------------------------------------------------------
// Color palettes
// ---------------------------------------------------------------------------

export const GUARDIAN_COLORS = {
  c1: "#c4783c", // Body fill (clay)
  c2: "#a06030", // Detail blocks (dark clay)
  c3: "#8b7355", // Accent features (borders, eyes glow, ══)
  c4: "#6e5530", // Outer edge (dark outline)
  c5: "#8b7355", // Box-drawing (inscription plate)
  c6: "#ffb020", // Hebrew text + code mouth (gold glow)
} as const;

// Simple variant color mapping (character-based, from GolemMascot.tsx colorLine)
const SIMPLE_COLOR_MAP: Record<string, string> = {
  glow: "#ffb020",  // אמת, ◆
  accent: "#8b7355", // ╔╗╚╝║═┌┐└┘─│╠╣
  clay: "#c4783c",   // ▒▓█▄▀░■
  dim: "#777777",    // everything else
};

const GLOW_CHARS = "אמת◆{}·";
const ACCENT_CHARS = "╔╗╚╝║═┌┐└┘─│╠╣";
const CLAY_CHARS = "▒▓█▄▀░■";

// ---------------------------------------------------------------------------
// ANSI rendering
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";

/** Convert hex (#rrggbb) to ANSI truecolor foreground escape */
export function hexToAnsi(hex: string, dim = 1): string {
  const r = Math.min(255, Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * dim)));
  const g = Math.min(255, Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * dim)));
  const b = Math.min(255, Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * dim)));
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Render a ${c1}-${c6} template with ANSI colors.
 * Each line gets color codes substituted and ends with reset.
 */
export function renderTemplate(
  lines: string[],
  colors: Record<string, string>,
  dim = 1,
): string[] {
  const ansiColors: Record<string, string> = {};
  for (const [key, hex] of Object.entries(colors)) {
    ansiColors[key] = hexToAnsi(hex, dim);
  }

  return lines.map((line) => {
    let rendered = line;
    for (const [key, ansi] of Object.entries(ansiColors)) {
      // Replace all occurrences of ${cN} with the ANSI code
      rendered = rendered.replaceAll(`\${${key}}`, ansi);
    }
    return rendered + RESET;
  });
}

/**
 * Render the simple variant with per-character coloring (like GolemMascot.tsx colorLine).
 */
export function renderSimpleAnsi(dim = 1): string[] {
  const glowAnsi = hexToAnsi(SIMPLE_COLOR_MAP.glow, dim);
  const accentAnsi = hexToAnsi(SIMPLE_COLOR_MAP.accent, dim);
  const clayAnsi = hexToAnsi(SIMPLE_COLOR_MAP.clay, dim);
  const dimAnsi = hexToAnsi(SIMPLE_COLOR_MAP.dim, dim);

  return GUARDIAN_ART_SIMPLE.map((line) => {
    let result = "";
    for (const ch of line) {
      if (GLOW_CHARS.includes(ch)) {
        result += glowAnsi + ch;
      } else if (ACCENT_CHARS.includes(ch)) {
        result += accentAnsi + ch;
      } else if (CLAY_CHARS.includes(ch)) {
        result += clayAnsi + ch;
      } else {
        result += dimAnsi + ch;
      }
    }
    return result + RESET;
  });
}

/**
 * Render the guardian golem with ANSI truecolor.
 *
 * @param variant - 'full' (22-line template) or 'simple' (16-line character-based)
 * @param dim - Brightness multiplier 0-1 (1 = full, 0.3 = dim backlight)
 */
export function renderGuardianAnsi(opts?: {
  variant?: "full" | "simple";
  dim?: number;
}): string[] {
  const variant = opts?.variant ?? "full";
  const dim = opts?.dim ?? 1;

  if (variant === "simple") {
    return renderSimpleAnsi(dim);
  }

  return renderTemplate(GUARDIAN_ART_FULL, GUARDIAN_COLORS, dim);
}

/**
 * Render the guardian in the top-right corner of the terminal.
 * Uses cursor save/restore + absolute positioning.
 *
 * @param dim - Brightness 0-1 (default 0.4 for subtle backlight)
 * @param padding - Right margin in columns (default 2)
 */
export function renderGuardianTopRight(opts?: {
  dim?: number;
  padding?: number;
}): string {
  const dim = opts?.dim ?? 0.4;
  const padding = opts?.padding ?? 2;
  const cols = process.stdout.columns || 80;

  // Pick variant based on terminal width
  const useSimple = cols < 50;
  const lines = renderGuardianAnsi({
    variant: useSimple ? "simple" : "full",
    dim,
  });

  // Calculate art width (strip ANSI codes to measure visible characters)
  const rawLines = useSimple ? GUARDIAN_ART_SIMPLE : GUARDIAN_ART_FULL;
  const maxVisibleWidth = Math.max(
    ...rawLines.map((l) => l.replace(/\$\{c[1-6]\}/g, "").length),
  );

  const startCol = Math.max(1, cols - maxVisibleWidth - padding);

  // Build output: save cursor, position each line, restore cursor
  let output = "\x1b[s"; // save cursor
  for (let i = 0; i < lines.length; i++) {
    output += `\x1b[${i + 1};${startCol}H${lines[i]}`;
  }
  output += "\x1b[u"; // restore cursor

  return output;
}

/**
 * Render the guardian as a backlight — dim art at the right side of the
 * terminal, composed on the SAME lines as text content.
 *
 * Each output line = text (left) + cursor-jump-to-column + art (right).
 * No cursor save/restore or movement — single-pass, no scroll issues.
 *
 * @param dim - Brightness 0-1 (default 0.25 for subtle backlight)
 * @param padding - Right margin in columns (default 2)
 * @param textLines - Text to place on the left side (title, path, etc.)
 */
export function renderGuardianBacklight(opts?: {
  dim?: number;
  padding?: number;
  textLines?: string[];
}): string {
  const dim = opts?.dim ?? 0.25;
  const padding = opts?.padding ?? 2;
  const cols = process.stdout.columns || 80;

  const useSimple = cols < 50;
  const artLines = renderGuardianAnsi({
    variant: useSimple ? "simple" : "full",
    dim,
  });

  const rawLines = useSimple ? GUARDIAN_ART_SIMPLE : GUARDIAN_ART_FULL;
  const maxVisibleWidth = Math.max(
    ...rawLines.map((l) => l.replace(/\$\{c[1-6]\}/g, "").length),
  );

  const startCol = Math.max(1, cols - maxVisibleWidth - padding);
  const textArr = opts?.textLines ?? [];

  // Compose each line: text at left + art at right column
  let output = "";
  for (let i = 0; i < artLines.length; i++) {
    const text = textArr[i] ?? "";
    output += `${text}\x1b[${startCol}G${artLines[i]}\n`;
  }

  return output;
}

// ---------------------------------------------------------------------------
// Display helpers (kept from original)
// ---------------------------------------------------------------------------

export function centerText(text: string, width: number): string {
  if (text.length >= width) return text;
  const padding = Math.floor((width - text.length) / 2);
  return " ".repeat(padding) + text;
}

export function formatSplash(): string {
  const lines: string[] = [];
  const artLines = renderGuardianAnsi({ dim: 1 });
  lines.push(artLines.join("\n"));
  lines.push("");
  lines.push(centerText("~ Guardian Golem ~", 30));
  lines.push(centerText("Protector of the developer ecosystem", 40));
  return lines.join("\n");
}

/**
 * Get plain-text (no ANSI) guardian art.
 */
export function getGuardianPlain(variant: "full" | "simple" = "full"): string {
  if (variant === "simple") {
    return GUARDIAN_ART_SIMPLE.join("\n");
  }
  // Strip ${cN} placeholders from full variant
  return GUARDIAN_ART_FULL.map((line) =>
    line.replace(/\$\{c[1-6]\}/g, ""),
  ).join("\n");
}
