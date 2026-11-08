import { expect, test } from "bun:test";
import boundary from "./fixtures/nl34-spoken-form.json";
import parity from "./fixtures/nl33-spoken-form.json";
import { prepareSpeechChannels, deriveSpeechAliases } from "../src/spoken-form.mjs";
import { renderV4 } from "../vendor/agent-html/lib/render-v4.mjs";
import { normalizeWordTimingsForScript } from "../vendor/narrationlayer/word-timing-repair.ts";

for (const [display, spoken] of [...boundary.ordinaryCases, ...parity.cases]) test(`ordinary-text speech: ${display}`, () => {
  expect(prepareSpeechChannels(display)).toEqual({ displayText: display, synthInput: spoken });
  if (display === "%") return; // No lexical display token exists to attach timing.
  const raw = spoken.split(/\s+/).map((word, i) => ({ word, start: i, end: i + 1 }));
  const snapshot = structuredClone(raw);
  const aligned = normalizeWordTimingsForScript(display, raw, raw.length, deriveSpeechAliases(display, spoken));
  expect(aligned.estimated).not.toBe(true);
  const compare = text => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  expect(aligned.words.map(w => compare(w.word))).toEqual(display.split(/\s+/).map(compare));
  const html = renderV4({ title: "Speech", scenes: [{ id: "speech", title: "Speech", script: display, words: aligned.words, audioUrl: "data:audio/mpeg;base64,ZmFrZQ==" }] });
  const cue = JSON.parse(html.match(/<script[^>]*id="tpdata"[^>]*>([\s\S]*?)<\/script>/)[1]).speech.cues[0];
  expect(cue.text).toBe(display);
  expect(cue.words.map(w => [w.start, w.end])).toEqual(aligned.words.map(w => [w.start, w.end]));
  expect(aligned.words[0].start).toBe(0);
  expect(aligned.words.at(-1).end).toBe(raw.length);
  expect(raw).toEqual(snapshot);
});

test("aliases compare punctuation/case once and contain complete independent terms", () => {
  const display = "9pm 5% v2.3 9PM";
  const aliases = deriveSpeechAliases(display, prepareSpeechChannels(display).synthInput);
  expect(aliases).toEqual([
    { term: "9pm", spoken: "nine p m" },
    { term: "5%", spoken: "five percent" },
    { term: "v2.3", spoken: "version two point three" },
  ]);
  expect(deriveSpeechAliases("by 9 p.m.", "by nine p m")).toEqual([{ term: "9 p.m.", spoken: "nine p m" }]);
  expect(deriveSpeechAliases("by 9pm", "by something else")).toEqual([]);
  expect(deriveSpeechAliases("alpha beta", "first second")).toEqual([]);
  expect(deriveSpeechAliases("P R", "pull request")).toEqual([{ term: "P R", spoken: "pull request" }]);
});

test("each changed display token owns only its spoken timing span", () => {
  const display = "Start 9pm 5% v2.3 end";
  const spoken = prepareSpeechChannels(display).synthInput;
  const raw = spoken.split(" ").map((word, i) => ({ word, start: i, end: i + 1 }));
  const aligned = normalizeWordTimingsForScript(display, raw, raw.length, deriveSpeechAliases(display, spoken));
  expect(aligned.words.map(({ word, start, end }) => [word, start, end])).toEqual([
    ["Start", 0, 1], ["9pm", 1, 4], ["5", 4, 6], ["v2.3", 6, 10], ["end", 10, 11],
  ]);
});

const boundaryCases = [...boundary.cases, ...boundary.agreedCases, ...boundary.followupCases, ...boundary.nl35Cases, ...boundary.percentContextCases, ...boundary.knownLimits.map(row => [...row, "known limit"])];
for (const [input, expected, kind = "contract"] of boundaryCases) {
  test(`${kind} speech: ${input}`, () => {
    for (const rules of [[], [{ term: "PR", spoken: "pull request" }]]) {
      expect(prepareSpeechChannels(input, rules)).toEqual({ displayText: input, synthInput: expected });
    }
    if (input === expected) expect(deriveSpeechAliases(input, input)).toEqual([]);
  });
}

test("no fixture output glues percent to its preceding word", () => {
  for (const [input] of boundaryCases) expect(prepareSpeechChannels(input).synthInput).not.toMatch(/[\p{L}\p{N}]percent\b/u);
});
