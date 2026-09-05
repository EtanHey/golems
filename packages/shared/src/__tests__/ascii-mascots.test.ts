import { describe, test, expect } from "bun:test";
import {
  GUARDIAN_ART_FULL,
  GUARDIAN_ART_SIMPLE,
  GUARDIAN_COLORS,
  hexToAnsi,
  renderTemplate,
  renderSimpleAnsi,
  renderGuardianAnsi,
  renderGuardianTopRight,
  renderGuardianBacklight,
  centerText,
  formatSplash,
  getGuardianPlain,
} from "@golems/shared/lib/ascii-mascots";

// ---------------------------------------------------------------------------
// Guardian art definitions
// ---------------------------------------------------------------------------

describe("guardian art", () => {
  test("full art has 22 lines", () => {
    expect(GUARDIAN_ART_FULL.length).toBe(22);
  });

  test("simple art has 16 lines", () => {
    expect(GUARDIAN_ART_SIMPLE.length).toBe(16);
  });

  test("full template contains Hebrew אמת", () => {
    const joined = GUARDIAN_ART_FULL.join("\n");
    expect(joined).toContain("א");
    expect(joined).toContain("מ");
    expect(joined).toContain("ת");
  });

  test("simple art contains Hebrew אמת", () => {
    const joined = GUARDIAN_ART_SIMPLE.join("\n");
    expect(joined).toContain("אמת");
  });

  test("full template contains code mouth {··}", () => {
    const joined = GUARDIAN_ART_FULL.join("\n");
    expect(joined).toContain("{");
    expect(joined).toContain("}");
  });

  test("full template uses ${c1}-${c6} placeholders", () => {
    const joined = GUARDIAN_ART_FULL.join("\n");
    expect(joined).toContain("${c1}");
    expect(joined).toContain("${c2}");
    expect(joined).toContain("${c3}");
    expect(joined).toContain("${c4}");
    expect(joined).toContain("${c5}");
    expect(joined).toContain("${c6}");
  });

  test("simple art does NOT use template placeholders", () => {
    const joined = GUARDIAN_ART_SIMPLE.join("\n");
    expect(joined).not.toContain("${c");
  });
});

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

describe("colors", () => {
  test("GUARDIAN_COLORS has all 6 color slots", () => {
    expect(GUARDIAN_COLORS.c1).toBeTruthy();
    expect(GUARDIAN_COLORS.c2).toBeTruthy();
    expect(GUARDIAN_COLORS.c3).toBeTruthy();
    expect(GUARDIAN_COLORS.c4).toBeTruthy();
    expect(GUARDIAN_COLORS.c5).toBeTruthy();
    expect(GUARDIAN_COLORS.c6).toBeTruthy();
  });

  test("all colors are valid hex", () => {
    for (const color of Object.values(GUARDIAN_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test("c6 is glow (gold)", () => {
    expect(GUARDIAN_COLORS.c6).toBe("#ffb020");
  });

  test("c1 is clay", () => {
    expect(GUARDIAN_COLORS.c1).toBe("#c4783c");
  });
});

// ---------------------------------------------------------------------------
// ANSI rendering
// ---------------------------------------------------------------------------

describe("hexToAnsi", () => {
  test("converts hex to truecolor escape", () => {
    const result = hexToAnsi("#ff0000");
    expect(result).toBe("\x1b[38;2;255;0;0m");
  });

  test("converts with dim factor", () => {
    const result = hexToAnsi("#ff0000", 0.5);
    expect(result).toBe("\x1b[38;2;128;0;0m");
  });

  test("dim=0 produces black", () => {
    const result = hexToAnsi("#ffffff", 0);
    expect(result).toBe("\x1b[38;2;0;0;0m");
  });
});

describe("renderTemplate", () => {
  test("substitutes color placeholders", () => {
    const lines = ["${c1}Hello${c2}World"];
    const colors = { c1: "#ff0000", c2: "#00ff00" };
    const result = renderTemplate(lines, colors);
    expect(result[0]).toContain("\x1b[38;2;255;0;0m");
    expect(result[0]).toContain("\x1b[38;2;0;255;0m");
    expect(result[0]).toContain("Hello");
    expect(result[0]).toContain("World");
  });

  test("each line ends with reset", () => {
    const lines = ["${c1}test"];
    const colors = { c1: "#ff0000" };
    const result = renderTemplate(lines, colors);
    expect(result[0]).toEndWith("\x1b[0m");
  });

  test("supports dim factor", () => {
    const lines = ["${c1}x"];
    const colors = { c1: "#ff0000" };
    const full = renderTemplate(lines, colors, 1);
    const dimmed = renderTemplate(lines, colors, 0.5);
    expect(full[0]).toContain("255;0;0");
    expect(dimmed[0]).toContain("128;0;0");
  });
});

describe("renderSimpleAnsi", () => {
  test("returns 16 colored lines", () => {
    const result = renderSimpleAnsi();
    expect(result.length).toBe(16);
  });

  test("lines contain ANSI escape codes", () => {
    const result = renderSimpleAnsi();
    expect(result[0]).toContain("\x1b[38;2;");
  });

  test("lines end with reset", () => {
    const result = renderSimpleAnsi();
    for (const line of result) {
      expect(line).toEndWith("\x1b[0m");
    }
  });
});

describe("renderGuardianAnsi", () => {
  test("defaults to full variant (22 lines)", () => {
    const result = renderGuardianAnsi();
    expect(result.length).toBe(22);
  });

  test("simple variant returns 16 lines", () => {
    const result = renderGuardianAnsi({ variant: "simple" });
    expect(result.length).toBe(16);
  });

  test("no template placeholders remain in output", () => {
    const result = renderGuardianAnsi();
    const joined = result.join("\n");
    expect(joined).not.toContain("${c");
  });

  test("dim parameter reduces brightness", () => {
    const full = renderGuardianAnsi({ dim: 1 });
    const dimmed = renderGuardianAnsi({ dim: 0.3 });
    // Full brightness c1 (#c4783c) = 196;120;60
    // Dimmed at 0.3 = 59;36;18
    expect(full.join("")).toContain("196;120;60");
    expect(dimmed.join("")).not.toContain("196;120;60");
  });
});

describe("renderGuardianTopRight", () => {
  test("includes cursor save and restore", () => {
    const result = renderGuardianTopRight();
    expect(result).toStartWith("\x1b[s");
    expect(result).toEndWith("\x1b[u");
  });

  test("includes cursor positioning sequences", () => {
    const result = renderGuardianTopRight();
    // Should contain \x1b[row;colH patterns
    expect(result).toMatch(/\x1b\[\d+;\d+H/);
  });

  test("respects dim parameter", () => {
    const bright = renderGuardianTopRight({ dim: 1 });
    const dim = renderGuardianTopRight({ dim: 0.2 });
    expect(bright).not.toBe(dim);
  });
});

describe("renderGuardianBacklight", () => {
  test("returns string output", () => {
    const result = renderGuardianBacklight();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("output contains column positioning", () => {
    const result = renderGuardianBacklight();
    // Should contain \x1b[colG patterns (column positioning)
    expect(result).toMatch(/\x1b\[\d+G/);
  });

  test("includes text lines when provided", () => {
    const result = renderGuardianBacklight({ textLines: ["Hello", "World"] });
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  test("respects dim parameter", () => {
    const bright = renderGuardianBacklight({ dim: 1 });
    const dimmed = renderGuardianBacklight({ dim: 0.1 });
    expect(bright).not.toBe(dimmed);
  });
});

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

describe("display helpers", () => {
  test("centerText centers text in width", () => {
    const result = centerText("Hello", 20);
    expect(result.trim()).toBe("Hello");
    expect(result.startsWith("       ")).toBe(true);
    expect(result.length).toBe(12);
  });

  test("centerText returns text if wider than width", () => {
    const result = centerText("Hello World", 5);
    expect(result).toBe("Hello World");
  });

  test("formatSplash includes colored art and name", () => {
    const output = formatSplash();
    expect(output.length).toBeGreaterThan(100);
    expect(output).toContain("Guardian Golem");
    expect(output).toContain("Protector");
    // Should contain ANSI codes
    expect(output).toContain("\x1b[38;2;");
  });

  test("getGuardianPlain returns clean text (full)", () => {
    const plain = getGuardianPlain("full");
    expect(plain).not.toContain("${c");
    expect(plain).not.toContain("\x1b[");
    expect(plain).toContain("א");
  });

  test("getGuardianPlain returns simple variant", () => {
    const plain = getGuardianPlain("simple");
    expect(plain).toContain("אמת");
    expect(plain.split("\n").length).toBe(16);
  });
});
