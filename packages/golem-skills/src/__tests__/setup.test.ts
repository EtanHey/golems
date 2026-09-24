import { describe, test, expect } from "bun:test";
import { validateConfig } from "../setup";

// Moved from packages/golems-cli (folded into this CLI). Its routing cases
// (help/version/unknown) are cli.test.ts's; `setup --check` dispatch is
// golems-bin.test.ts's.
describe("validateConfig", () => {
  test("valid config passes", () => {
    const result = validateConfig({
      reposPath: "~/Gits",
      tools: { bun: "/opt/homebrew/bin/bun" },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing reposPath fails", () => {
    const result = validateConfig({
      tools: { bun: "/opt/homebrew/bin/bun" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("reposPath");
  });

  test("empty tools is valid", () => {
    const result = validateConfig({
      reposPath: "~/Gits",
      tools: {},
    });
    expect(result.valid).toBe(true);
  });

  test("missing tools object fails", () => {
    const result = validateConfig({
      reposPath: "~/Gits",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("tools"))).toBe(true);
  });

  test("non-string reposPath fails", () => {
    const result = validateConfig({
      reposPath: 42,
      tools: {},
    });
    expect(result.valid).toBe(false);
  });

  test("array tools fails", () => {
    const result = validateConfig({
      reposPath: "~/Gits",
      tools: ["bun"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("tools"))).toBe(true);
  });

  test("null config fails", () => {
    const result = validateConfig(null);
    expect(result.valid).toBe(false);
  });

  test("undefined config fails", () => {
    const result = validateConfig(undefined);
    expect(result.valid).toBe(false);
  });
});
