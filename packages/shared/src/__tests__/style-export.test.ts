/**
 * Tests for Style Export (Portable Style Summary)
 *
 * TDD approach: RED → GREEN → REFACTOR
 *
 * Exports Zikaron's semantic-style-data.json into a human-readable
 * markdown "style card" for use in Claude Chat project instructions.
 */

import { describe, it, expect } from "bun:test";
import {
  exportStyleCard,
  parseStyleData,
  type StyleData,
  type TopicStyle,
} from "@golems/shared/lib/style-export";

const SAMPLE_STYLE_DATA: StyleData = {
  topics: {
    technical: {
      message_count: 100,
      avg_length: 154.99,
      formality: 0.48,
      emoji_rate: 0.05,
      language_mix: { hebrew: 0.37, english: 0.68 },
      common_phrases: ["claude code", "press enter"],
    },
    casual: {
      message_count: 100,
      avg_length: 35.16,
      formality: 0.44,
      emoji_rate: 0.04,
      language_mix: { hebrew: 0.66, english: 0.32 },
      common_phrases: ["i am", "are you"],
    },
    professional: {
      message_count: 100,
      avg_length: 35.18,
      formality: 0.47,
      emoji_rate: 0.007,
      language_mix: { hebrew: 0.82, english: 0.20 },
      common_phrases: ["הכל טוב", "בסדר גמור"],
    },
  },
  insights: ["Writes longest messages in technical context"],
};

describe("parseStyleData", () => {
  it("parses valid JSON string into StyleData", () => {
    const json = JSON.stringify(SAMPLE_STYLE_DATA);
    const result = parseStyleData(json);
    expect(result.topics).toBeDefined();
    expect(Object.keys(result.topics)).toEqual([
      "technical",
      "casual",
      "professional",
    ]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseStyleData("not json")).toThrow();
  });

  it("throws on missing topics key", () => {
    expect(() => parseStyleData('{"insights": []}')).toThrow();
  });
});

describe("exportStyleCard", () => {
  it("returns a markdown string", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    expect(typeof result).toBe("string");
    expect(result).toContain("# Owner Communication Style Card");
  });

  it("includes all topic sections", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    expect(result).toContain("Technical");
    expect(result).toContain("Casual");
    expect(result).toContain("Professional");
  });

  it("includes formality values", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    expect(result).toContain("0.48");
    expect(result).toContain("0.44");
    expect(result).toContain("0.47");
  });

  it("formats language mix as normalized percentages", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    // 0.68 + 0.37 = 1.05, normalized: 65% English, 35% Hebrew
    expect(result).toContain("65%");
    expect(result).toContain("35%");
  });

  it("formats emoji rate as percentage", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    expect(result).toContain("5%"); // technical: 0.05
    expect(result).toContain("0.7%"); // professional: 0.007
  });

  it("includes avg message length", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    expect(result).toContain("155"); // rounded from 154.99
    expect(result).toContain("35"); // rounded from 35.16
  });

  it("includes insights if present", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    expect(result).toContain("longest messages in technical");
  });

  it("includes outreach guidance section", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    expect(result).toContain("Outreach");
  });

  it("includes matching rules", () => {
    const result = exportStyleCard(SAMPLE_STYLE_DATA);
    expect(result).toContain("Rules");
  });

  it("handles data with no insights", () => {
    const data = { ...SAMPLE_STYLE_DATA, insights: [] };
    const result = exportStyleCard(data);
    expect(result).toContain("# Owner Communication Style Card");
  });
});
