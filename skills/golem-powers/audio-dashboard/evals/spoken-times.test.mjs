import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { prepareSpeechChannels as baselineChannels, deriveSpeechAliases as baselineAliases } from "../vendor/narrationlayer/text-normalize.ts";
import { loadPronunciationRules } from "../vendor/narrationlayer/pronunciation-config.ts";
import { normalizeWordTimingsForScript } from "../vendor/narrationlayer/word-timing-repair.ts";
import { analyzeTranscriptFidelity } from "../src/transcript-fidelity-gate.mjs";
import { analyzeTeleprompterDrift } from "../src/teleprompter-drift-gate.mjs";
import { renderV4 } from "../vendor/agent-html/lib/render-v4.mjs";

// The first test-only commit exercises the old runtime; no missing-module RED.
const candidate = new URL("../src/spoken-form.mjs", import.meta.url);
const { prepareSpeechChannels, deriveSpeechAliases } = existsSync(candidate)
  ? await import(candidate.href)
  : { prepareSpeechChannels: baselineChannels, deriveSpeechAliases: baselineAliases };
const rules = loadPronunciationRules({ env: {} });
const cases = [
  ["9pm", "nine p m"], ["9 pm", "nine p m"], ["9 p.m.", "nine p m"],
  ["9PM", "nine p m"], ["11:30am", "eleven thirty a m"],
  ["11:30 a.m.", "eleven thirty a m"], ["21:00", "nine p m"],
  ["21:15", "nine fifteen p m"], ["9:05pm", "nine oh five p m"],
  ["00:00", "twelve a m"], ["12:00", "twelve p m"],
  ["PR #123", "pull request one twenty-three"],
  ["PR 123", "pull request one twenty-three"], ["#123", "pull request one twenty-three"],
  ["e.g.", "for example"], ["i.e.", "that is"], ["vs.", "versus"],
  ["vs", "versus"], ["approx.", "approximately"], ["~5", "about five"],
  ["5%", "five percent"], ["%", "percent"], ["x2", "two times"],
  ["2x", "two times"], ["v2.3", "version two point three"],
];
for (const [input, expected] of cases) {
  test(`ENGINE spoken form: ${input}`, () => {
    expect(prepareSpeechChannels(input, rules)).toEqual({ displayText: input, synthInput: expected });
  });
}
for (const input of [
  "PM spoke with AM about the plan.", "13pm 24:00 9:65pm", "v2beta",
  "`9pm v2.3 PR #123 e.g. foo_bar`", "``v2.3 `9pm` ``",
  "```js\nconst version = 'v2.3'; // 9pm\n```",
  "~~~js\nconst version = 'v2.3';\n~~~",
  "https://example.com/v2.3?at=9pm#123", "http://example.com/~5/2x",
]) test(`unchanged control: ${input}`, () => {
  expect(prepareSpeechChannels(input, rules).synthInput).toBe(input);
});

test("Etan case verbatim never sends p dot to the engine", () => {
  expect(prepareSpeechChannels("by 9 p.m.", rules).synthInput).toBe("by nine p m");
});

test("raw by nine p m maps to original by 9pm and passes both BUILD gates", () => {
  const display = "by 9pm";
  const rawWords = ["by", "nine", "p", "m"].map((word, i) => ({ word, start: i * 0.25, end: (i + 1) * 0.25 }));
  const snapshot = structuredClone(rawWords);
  const { synthInput } = prepareSpeechChannels(display, rules);
  const aliases = deriveSpeechAliases(display, synthInput);
  const aligned = normalizeWordTimingsForScript(display, rawWords, 1, aliases);
  expect(aligned.estimated).toBe(false);
  expect(aligned.words.map(({ word, start, end }) => ({ word, start, end }))).toEqual([
    { word: "by", start: 0, end: 0.25 }, { word: "9pm", start: 0.25, end: 1 },
  ]);
  expect(rawWords).toEqual(snapshot);
  expect(analyzeTranscriptFidelity({ segments: [{ id: "clock", script: synthInput, rawWords }] }).verdict).toBe("PASS");
  expect(analyzeTeleprompterDrift({ segments: [{ id: "clock", transcript: display, sourceWords: rawWords, renderedWords: aligned.words, aliases }] }).verdict).toBe("PASS");
  const html = renderV4({ title: "Clock", scenes: [{ id: "clock", script: display, words: aligned.words, audioUrl: "data:audio/mpeg;base64,ZmFrZQ==" }] });
  const tpdata = JSON.parse(html.match(/<script[^>]*id="tpdata"[^>]*>([\s\S]*?)<\/script>/)[1]);
  expect(tpdata.clock.cues[0].text).toBe(display);
  expect(tpdata.clock.cues[0].words.map(w => w.word)).toEqual(["by", "9pm"]);
  expect(analyzeTranscriptFidelity({ segments: [{ id: "clock", script: synthInput, rawWords: rawWords.slice(0, 2) }] }).verdict).toBe("REJECTED");
});

for (const display of ["21:15", "11:30 a.m.", "PR #123", "5%", "v2.3"]) {
  test(`expanded aliases preserve real timing: ${display}`, () => {
    const { synthInput } = prepareSpeechChannels(display, rules);
    const rawWords = synthInput.split(/\s+/).map((word, i) => ({ word, start: i * 0.2, end: (i + 1) * 0.2 }));
    const aliases = deriveSpeechAliases(display, synthInput);
    const aligned = normalizeWordTimingsForScript(display, rawWords, rawWords.at(-1).end, aliases);
    expect(aligned.estimated).toBe(false);
    expect(analyzeTeleprompterDrift({ segments: [{ id: "expanded", transcript: display, sourceWords: rawWords, renderedWords: aligned.words, aliases }] }).verdict).toBe("PASS");
    expect(aligned.words[0].start).toBe(0);
    expect(aligned.words.at(-1).end).toBeCloseTo(rawWords.at(-1).end, 3);
  });
}
