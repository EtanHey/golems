import { describe, expect, test } from "bun:test";
import { shouldUseRawAggregation } from "../data-source";

describe("cc-usage data source selection", () => {
  test("uses raw aggregation for all-time reports to avoid stale snapshots", () => {
    expect(shouldUseRawAggregation("all", 10)).toBe(true);
  });

  test("uses raw aggregation when no snapshots exist", () => {
    expect(shouldUseRawAggregation("month", 0)).toBe(true);
  });

  test("allows monthly snapshots when they exist", () => {
    expect(shouldUseRawAggregation("month", 10)).toBe(false);
  });
});
