import { describe, expect, test } from "bun:test";
import {
  CURSOR_LOWER_BOUND_VALUE_NOTE,
  API_RATE_VALUE_NOTE,
  hasLowerBoundProviderCost,
  hasLowerBoundSourceCost,
  valueNoteForProvider,
  valuePrefixForProvider,
} from "../display-semantics";

describe("cc-usage display semantics", () => {
  test("marks Cursor values as lower bounds", () => {
    expect(valuePrefixForProvider("cursor")).toBe(">=");
    expect(valueNoteForProvider("cursor")).toBe(CURSOR_LOWER_BOUND_VALUE_NOTE);
  });

  test("keeps non-Cursor providers as exact API-rate values", () => {
    expect(valuePrefixForProvider("anthropic")).toBe("");
    expect(valueNoteForProvider("anthropic")).toBe(API_RATE_VALUE_NOTE);
  });

  test("detects when a total contains Cursor lower-bound value", () => {
    expect(
      hasLowerBoundProviderCost([
        { provider: "anthropic", cost: 10 },
        { provider: "cursor", cost: 0.01 },
      ]),
    ).toBe(true);

    expect(
      hasLowerBoundProviderCost([
        { provider: "anthropic", cost: 10 },
        { provider: "cursor", cost: 0 },
      ]),
    ).toBe(false);
  });

  test("detects lower-bound costs from Cursor usage sources", () => {
    expect(
      hasLowerBoundSourceCost([
        { source: "claude-code", cost: 12 },
        { source: "cursor-cli", cost: 1 },
      ]),
    ).toBe(true);

    expect(
      hasLowerBoundSourceCost([
        { source: "cursor-cli", cost: 0 },
        { source: "codex-cli", cost: 1 },
      ]),
    ).toBe(false);
  });
});
