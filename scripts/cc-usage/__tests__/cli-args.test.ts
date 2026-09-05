import { describe, expect, test } from "bun:test";
import { parseUsageArgs } from "../cli-args";

describe("cc-usage CLI args", () => {
  test("maps positional daily to today's daily view", () => {
    const opts = parseUsageArgs(["daily"]);

    expect(opts.period).toBe("today");
    expect(opts.daily).toBe(true);
  });

  test("maps positional week and month to matching periods", () => {
    expect(parseUsageArgs(["week"]).period).toBe("week");
    expect(parseUsageArgs(["month"]).period).toBe("month");
  });

  test("--period overrides positional period alias", () => {
    const opts = parseUsageArgs(["daily", "--period=week"]);

    expect(opts.period).toBe("week");
    expect(opts.daily).toBe(true);
  });

  test("preserves equals signs inside flag values", () => {
    const opts = parseUsageArgs(["--export=reports/week=2026-06.csv"]);

    expect(opts.exportFormat).toBe("reports/week=2026-06.csv");
  });

  test("falls back to default cache ratio for invalid values", () => {
    const defaultRatio = parseUsageArgs([]).cacheRatio;

    expect(parseUsageArgs(["--cache-ratio=abc"]).cacheRatio).toBe(defaultRatio);
    expect(parseUsageArgs(["--cache-ratio=-0.1"]).cacheRatio).toBe(defaultRatio);
    expect(parseUsageArgs(["--cache-ratio=1.5"]).cacheRatio).toBe(defaultRatio);
  });
});
