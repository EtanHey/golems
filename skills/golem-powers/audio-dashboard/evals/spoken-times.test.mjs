import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { prepareSpeechChannels as baselineChannels, deriveSpeechAliases as baselineAliases } from "../vendor/narrationlayer/text-normalize.ts";
import { loadPronunciationRules } from "../vendor/narrationlayer/pronunciation-config.ts";
import { normalizeWordTimingsForScript } from "../vendor/narrationlayer/word-timing-repair.ts";
import { analyzeTranscriptFidelity } from "../src/transcript-fidelity-gate.mjs";
import { analyzeTeleprompterDrift } from "../src/teleprompter-drift-gate.mjs";
import { renderV4 } from "../vendor/agent-html/lib/render-v4.mjs";
import { designTestCell } from "./design-test-cell.mjs";
import { writeWordTimingArtifacts } from "../src/word-timing-artifacts.mjs";

const cell = designTestCell();
const mediaTools = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

function writeSegment(root, words, rawWords) {
  const segment = path.join(root, "segments/clock");
  mkdirSync(segment, { recursive: true });
  writeWordTimingArtifacts(segment, { rawWords, repairedWords: words });
  copyFileSync(new URL("../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3", import.meta.url), path.join(segment, "clock.mp3"));
  // Synthetic PCM fixture: one second of audible-energy tone, no TTS or ffmpeg.
  const wav = Buffer.alloc(44 + 24000 * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 24000; i++) wav.writeInt16LE(Math.round(16000 * Math.sin(2 * Math.PI * 140 * i / 24000)), 44 + i * 2);
  writeFileSync(path.join(segment, "clock.wav"), wav);
}

function buildDashboard(root, display) {
  const outputPath = path.join(root, "docs.local/dashboards/clock.html");
  const specPath = path.join(root, "job.json");
  writeFileSync(specPath, JSON.stringify({
    id: "spoken-times", type: "cinema", outputPath, series: path.basename(root),
    design: { firstInLineage: { reason: "Isolated spoken-form fixture", approvedBy: "fixture-owner" } },
    scenes: [{ id: "clock", title: "Clock", script: display }],
  }));
  const build = new URL("../scripts/build-dashboard.mjs", import.meta.url).pathname;
  const env = { ...process.env };
  delete env.NARRATIONLAYER_PRONUNCIATION_FILE;
  const result = spawnSync(process.execPath, cell.command(build, ["--spec", specPath, "--job-dir", root, "--first-build", "Isolated fixture"]).slice(1), { encoding: "utf8", env });
  return { result, outputPath };
}

// The first test-only commit exercises the old runtime; no missing-module RED.
const candidate = new URL("../src/spoken-form.mjs", import.meta.url);
const { prepareSpeechChannels, deriveSpeechAliases } = existsSync(candidate) && !process.env.AUDIO_DASHBOARD_SPOKEN_BASELINE
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
  ["Use v2.3. Try ~5.", "Use version two point three. Try about five."],
];
for (const [input, expected] of cases) {
  test(`ENGINE spoken form: ${input}`, () => {
    expect(prepareSpeechChannels(input, rules)).toEqual({ displayText: input, synthInput: expected });
  });
}

for (const authored of ["9pm", "9 p.m."]) (mediaTools ? test : test.skip)(`BUILD preserves authored ${authored} while ENGINE says nine p m`, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spoken-times-build-"));
  try {
    const display = `by ${authored}`;
    const channels = prepareSpeechChannels(display, rules);
    expect(channels.displayText).toBe(display);
    const { synthInput } = channels;
    expect(synthInput).toBe("by nine p m");
    const rawWords = ["by", "nine", "p", "m"].map((word, i) => ({ word, start: i * 0.25, end: (i + 1) * 0.25 }));
    const aliases = deriveSpeechAliases(display, synthInput);
    const aligned = normalizeWordTimingsForScript(display, rawWords, 1, aliases);
    writeSegment(root, aligned.words, rawWords);
    const spokenPath = path.join(root, "segments/clock/clock.wav.spoken.txt");
    writeFileSync(spokenPath, synthInput);
    expect(readFileSync(spokenPath, "utf8")).toBe("by nine p m");
    const displayWords = JSON.parse(readFileSync(path.join(root, "segments/clock/words.json"), "utf8"));
    expect(displayWords.map(w => w.word)).toEqual(display.split(" "));
    expect(displayWords.map(w => w.word).join(" ")).not.toContain("nine");
    expect(displayWords.map(w => w.word).join(" ")).not.toContain("p m");
    expect(displayWords[1].start).toBe(0.25);
    expect(displayWords.at(-1).end).toBe(1);
    const { result, outputPath } = buildDashboard(root, display);
    expect(result.status).toBe(0);
    const html = readFileSync(outputPath, "utf8");
    const tpdata = JSON.parse(html.match(/<script[^>]*id="tpdata"[^>]*>([\s\S]*?)<\/script>/)[1]);
    expect(tpdata.clock.cues[0].text).toBe(display);
    expect(tpdata.clock.cues[0].words.map(w => w.word)).toEqual(display.split(" "));
    expect(tpdata.clock.cues[0].text).not.toContain("nine");
    expect(tpdata.clock.cues[0].text).not.toContain("p m");
    expect(tpdata.clock.cues[0].words).toEqual(displayWords.map(({ word, start, end }) => ({ word, start, end })));
    const build = readFileSync(new URL("../scripts/build-dashboard.mjs", import.meta.url), "utf8");
    const synth = readFileSync(new URL("../scripts/synth-segments.mjs", import.meta.url), "utf8");
    const wrapper = readFileSync(new URL("../scripts/local-tts.mjs", import.meta.url), "utf8");
    expect(build).toContain('from "../src/spoken-form.mjs"');
    expect(synth).toContain('"scripts", "local-tts.mjs"');
    expect(wrapper).toContain("main(prepareSpeechChannels)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
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
  const html = renderV4({ title: "Clock", scenes: [{ id: "clock", title: "Clock", script: display, words: aligned.words, audioUrl: "data:audio/mpeg;base64,ZmFrZQ==" }] });
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
