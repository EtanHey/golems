import { expect, test } from "bun:test";
import { prepareSpeechChannels, deriveSpeechAliases } from "../src/spoken-form.mjs";
import { normalizeWordTimingsForScript } from "../vendor/narrationlayer/word-timing-repair.ts";

export const cases = [
  ["Fix the #1 priority", "Fix the number one priority"],
  ["See issue #12", "See issue number twelve"],
  ["Runs on x86", "Runs on x86"],
  ["The video is 12:34 long", "The video is twelve thirty-four long"],
  ["10:30 meeting", "ten thirty meeting"],
  ["2.5x", "two point five times"],
  ["x2", "x2"], ["2x", "two times"],
  ["at 21:00", "at nine p m"], ["by 00:00", "by twelve a m"],
  ["until 12:00", "until twelve p m"], ["from 09:05", "from nine oh five a m"],
  ["21:00", "twenty-one zero"], ["#123", "number one twenty-three"],
  ["pull request #123", "pull request one twenty-three"],
  ["9pm", "nine p m"], ["9 p.m.", "nine p m"],
  ["11:30am", "eleven thirty a m"], ["PR #123", "pull request one twenty-three"],
  ["e.g.", "for example"], ["vs.", "versus"], ["5%", "five percent"],
  ["v2.3", "version two point three"],
];
for (const [display, spoken] of cases) test(`ordinary-text speech: ${display}`, () => {
  expect(prepareSpeechChannels(display)).toEqual({ displayText: display, synthInput: spoken });
  const raw = spoken.split(/\s+/).map((word, i) => ({ word, start: i, end: i + 1 }));
  const snapshot = structuredClone(raw);
  const aligned = normalizeWordTimingsForScript(display, raw, raw.length, deriveSpeechAliases(display, spoken));
  expect(aligned.estimated).toBe(false);
  expect(aligned.words.map(w => w.word)).toEqual(display.split(/\s+/));
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
});

test("each changed display token owns only its spoken timing span", () => {
  const display = "Start 9pm 5% v2.3 end";
  const spoken = prepareSpeechChannels(display).synthInput;
  const raw = spoken.split(" ").map((word, i) => ({ word, start: i, end: i + 1 }));
  const aligned = normalizeWordTimingsForScript(display, raw, raw.length, deriveSpeechAliases(display, spoken));
  expect(aligned.words.map(({ word, start, end }) => [word, start, end])).toEqual([
    ["Start", 0, 1], ["9pm", 1, 4], ["5%", 4, 6], ["v2.3", 6, 10], ["end", 10, 11],
  ]);
});
