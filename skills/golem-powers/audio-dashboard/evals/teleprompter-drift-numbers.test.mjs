import { expect, test } from "bun:test";
import { normalizeWordTimingsForScript } from "../vendor/narrationlayer/word-timing-repair.ts";
import { analyzeTeleprompterDrift } from "../src/teleprompter-drift-gate.mjs";

// The page drift gate compares raw Whisper words (words.raw.json) with the repaired
// display words BUILD writes into tpdata. A spoken number and its written form are one
// block there, judged by the vendored NarrationLayer parser, never by a second one.

function timed(words, start = 0, step = 0.3) {
  return words.map((word, i) => ({ word, start: start + i * step, end: start + (i + 1) * step }));
}

function gate(id, display, rawWords) {
  const repaired = normalizeWordTimingsForScript(display, rawWords, rawWords.at(-1).end, []);
  expect(repaired.estimated).toBe(false);
  return {
    repaired,
    result: analyzeTeleprompterDrift({ segments: [{ id, transcript: display, sourceWords: rawWords, renderedWords: repaired.words }] }),
  };
}

// w128 on the M1 (revendor-proof-m1/job/segments/number/words.raw.json), verbatim.
const W128_RAW = [
  { word: "The", start: 0.16, end: 0.27 },
  { word: "sample", start: 0.27, end: 0.81 },
  { word: "budget", start: 0.81, end: 1.11 },
  { word: "is", start: 1.4, end: 1.53 },
  { word: "$400", start: 1.53, end: 2.27 },
];

test("w128: 'four hundred dollars' heard as '$400' passes, and the number keeps the raw span", () => {
  const { repaired, result } = gate("number", "The sample budget is four hundred dollars.", W128_RAW);
  expect(result.violations).toEqual([]);
  expect(result.verdict).toBe("PASS");
  expect(result.stats[0].unalignedTokenRatio).toBe(0);
  expect(result.stats[0].maxOverallDelta).toBeLessThan(0.001);
  // Words before the number keep their raw timing (the M1 bug moved them).
  expect(repaired.words.slice(0, 4).map(({ start, end }) => [start, end])).toEqual([[0.16, 0.27], [0.27, 0.81], [0.81, 1.11], [1.4, 1.53]]);
  expect(repaired.words[4].start).toBe(1.53);
  expect(repaired.words.at(-1).end).toBe(2.27);
});

for (const [kind, display, heard] of [
  ["plain number", "We shipped ninety-six builds this week.", ["We", "shipped", "96", "builds", "this", "week."]],
  ["percent", "Coverage rose to forty percent today.", ["Coverage", "rose", "to", "40%", "today."]],
  ["year", "The launch moves to twenty twenty-six.", ["The", "launch", "moves", "to", "2026."]],
]) {
  test(`${kind}: '${display}' heard as '${heard.join(" ")}' passes as one block`, () => {
    const { result } = gate(kind, display, timed(heard));
    expect(result.violations).toEqual([]);
    expect(result.verdict).toBe("PASS");
    expect(result.stats[0].unalignedTokenRatio).toBe(0);
  });
}

test("a real mismatch still refuses: 'four hundred dollars' heard as '$500'", () => {
  const raw = W128_RAW.map(word => (word.word === "$400" ? { ...word, word: "$500" } : word));
  const { result } = gate("number", "The sample budget is four hundred dollars.", raw);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map(v => v.code)).toEqual(["WORD_SEQUENCE_MISMATCH"]);
  expect(result.violations[0].threshold).toBe(0.2);
});

test("the gate alone: a number block never borrows a neighbour, and units must agree", () => {
  const rendered = timed(["Budget", "four", "hundred", "dollars."], 0, 0.2);
  const pass = analyzeTeleprompterDrift({ segments: [{ id: "n", sourceWords: [rendered[0], { word: "$400", start: 0.2, end: 0.8 }], renderedWords: rendered }] });
  expect(pass.verdict).toBe("PASS");
  for (const heard of ["400%", "$500", "four"]) {
    const result = analyzeTeleprompterDrift({ segments: [{ id: "n", sourceWords: [rendered[0], { word: heard, start: 0.2, end: 0.8 }], renderedWords: rendered }] });
    expect(result.verdict).toBe("REJECTED");
  }
});

test("in the lexical fallback a number span counts as aligned, not three misses", () => {
  // One real miss ("colour" vs "color") forces the lexical path; the number must not add three more.
  const display = "Our colour budget for the whole spring launch is four hundred dollars in total.";
  const heard = ["Our", "color", "budget", "for", "the", "whole", "spring", "launch", "is", "$400", "in", "total."];
  const rawWords = timed(heard);
  const rendered = timed(["Our", "colour", "budget", "for", "the", "whole", "spring", "launch", "is", "four", "hundred", "dollars", "in", "total."]);
  rendered.splice(9, 3, { word: "four", start: 2.7, end: 2.8 }, { word: "hundred", start: 2.8, end: 2.9 }, { word: "dollars", start: 2.9, end: 3.0 });
  rendered.slice(12).forEach((word, i) => { word.start = 3.0 + i * 0.3; word.end = 3.3 + i * 0.3; });
  const result = analyzeTeleprompterDrift({ segments: [{ id: "mixed", transcript: display, sourceWords: rawWords, renderedWords: rendered }] });
  expect(result.stats[0].tokenMismatches).toBe(1);
  expect(result.verdict).toBe("PASS");
});

test("the exact aligner rejects a missing zero before a bare unit", () => {
  const result = analyzeTeleprompterDrift({ segments: [{
    id: "missing-zero-exact",
    sourceWords: [{ word: "dollars", start: 0, end: 1 }],
    renderedWords: [{ word: "zero", start: 0, end: 0.5 }, { word: "dollars", start: 0.5, end: 1 }],
  }] });
  expect(result.verdict).toBe("REJECTED");
  expect(result.stats[0].tokenMismatches).toBe(1);
  expect(result.stats[0].unalignedTokenRatio).toBe(0.5);
  expect(result.violations.map(v => v.code)).toContain("WORD_SEQUENCE_MISMATCH");
});

test("the lexical fallback rejects a missing zero beside a spelling mismatch", () => {
  const sourceWords = timed(["Our", "color", "budget", "is", "dollars", "today."], 0, 1);
  const renderedWords = [
    ...sourceWords.slice(0, 4).map(word => word.word === "color" ? { ...word, word: "colour" } : word),
    { word: "zero", start: 4, end: 4.5 }, { word: "dollars", start: 4.5, end: 5 }, sourceWords[5],
  ];
  const result = analyzeTeleprompterDrift({ segments: [{ id: "missing-zero-lexical", sourceWords, renderedWords }] });
  expect(result.verdict).toBe("REJECTED");
  expect(result.stats[0].tokenMismatches).toBe(2);
  expect(result.stats[0].unalignedTokenRatio).toBeCloseTo(2 / 7, 3);
  expect(result.violations.map(v => v.code)).toContain("WORD_SEQUENCE_MISMATCH");
});
