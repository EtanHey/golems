import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderV4 } from "../vendor/agent-html/lib/render-v4.mjs";
import { normalizeForSpeech } from "../vendor/narrationlayer/text-normalize.ts";
import { normalizeWordTimingsForScript } from "../vendor/narrationlayer/word-timing-repair.ts";
import { analyzeTeleprompterDrift } from "../src/teleprompter-drift-gate.mjs";
import { analyzeTranscriptFidelity } from "../src/transcript-fidelity-gate.mjs";
import {
  loadPronunciationRules,
  parsePronunciationYaml,
} from "../vendor/narrationlayer/pronunciation-config.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.join(here, "fixtures", "spoken-form-pronunciation.json"), "utf8"),
);
const runnerSource = readFileSync(
  path.join(here, "..", "vendor", "narrationlayer", "local-tts-runner.ts"),
  "utf8",
);
const synthSegmentsSource = readFileSync(path.join(here, "..", "scripts", "synth-segments.mjs"), "utf8");
const buildDashboardSource = readFileSync(path.join(here, "..", "scripts", "build-dashboard.mjs"), "utf8");
const skillText = readFileSync(path.join(here, "..", "SKILL.md"), "utf8");
const evalRegistry = JSON.parse(readFileSync(path.join(here, "evals.json"), "utf8"));

function timedScriptWords(script) {
  return script
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .map((word, index) => ({
      word,
      start: index * 0.1,
      end: (index + 1) * 0.1,
    }));
}

function tpdataFromHtml(html) {
  const match = html.match(/<script[^>]*id=["']tpdata["'][^>]*>([\s\S]*?)<\/script>/i);
  expect(match).toBeTruthy();
  return JSON.parse(match[1].trim());
}

const shippedRules = loadPronunciationRules({ env: {} });

test("pronunciation config parses the VoiceLayer-compatible two-level mapping", () => {
  expect(parsePronunciationYaml(`# compatible comment
acronyms:
  PR: "pull request"
  QA: 'quality assurance' # trailing comment
heteronyms:
  live streams: "lyve streams"
`, "fixture.yaml")).toEqual([
    { term: "live streams", spoken: "lyve streams" },
    { term: "PR", spoken: "pull request" },
    { term: "QA", spoken: "quality assurance" },
  ]);

  expect(() => parsePronunciationYaml("PR: pull request\n", "broken.yaml"))
    .toThrow("broken.yaml:1");
});

test("per-install pronunciation overlays override case-insensitively and fail loudly", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "audio-dashboard-pronunciation-"));
  const shipped = path.join(root, "shipped.yaml");
  const local = path.join(root, "local.yaml");
  writeFileSync(shipped, "acronyms:\n  PR: \"pull request\"\n  QA: \"quality assurance\"\n");
  writeFileSync(local, "local:\n  pr: \"peer review\"\n  long phrase: \"long override\"\n");

  try {
    const rules = loadPronunciationRules({
      defaultPath: shipped,
      env: { NARRATIONLAYER_PRONUNCIATION_FILE: local },
    });
    expect(rules).toEqual([
      { term: "long phrase", spoken: "long override" },
      { term: "pr", spoken: "peer review" },
      { term: "QA", spoken: "quality assurance" },
    ]);
    expect(() => loadPronunciationRules({
      defaultPath: shipped,
      env: { NARRATIONLAYER_PRONUNCIATION_FILE: path.join(root, "missing.yaml") },
    })).toThrow("pronunciation config not found");
    expect(() => loadPronunciationRules({
      defaultPath: shipped,
      env: { NARRATIONLAYER_PRONUNCIATION_FILE: ` ${path.delimiter} ` },
    })).toThrow("must contain at least one path");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("configured terms use phrase precedence and token boundaries", () => {
  const rules = [
    { term: "alpha", spoken: "short" },
    { term: "alpha beta", spoken: "long" },
    ...shippedRules,
  ];
  expect(normalizeForSpeech("alpha beta alpha; APRIL PR.", rules))
    .toBe("long short; APRIL pull request.");
});

test("configured replacement output is not reprocessed by a later rule", () => {
  const rules = [
    { term: "alpha", spoken: "beta" },
    { term: "beta", spoken: "gamma" },
  ];
  expect(normalizeForSpeech("alpha beta", rules)).toBe("beta gamma");
});

test("two-channel preprocessing exposes the original display and isolated synth input", async () => {
  const module = await import("../vendor/narrationlayer/text-normalize.ts");
  expect(module.prepareSpeechChannels).toBeFunction();
  if (typeof module.prepareSpeechChannels !== "function") return;

  const channels = module.prepareSpeechChannels(fixture.spokenForm.script, shippedRules);
  expect(channels.displayText).toBe(fixture.spokenForm.script);
  expect(channels.synthInput).toContain("ratification pull request");
});

test("approved synth/display aliases keep real STT timing on expanded display tokens", async () => {
  const module = await import("../vendor/narrationlayer/text-normalize.ts");
  expect(module.deriveSpeechAliases).toBeFunction();
  if (typeof module.deriveSpeechAliases !== "function") return;

  const aliases = module.deriveSpeechAliases("P R", "pull request");
  expect(aliases).toEqual([{ term: "P R", spoken: "pull request" }]);
  const rawWords = [
    { word: "pull", start: 0.1, end: 0.4 },
    { word: "request", start: 0.4, end: 0.9 },
  ];
  const aligned = normalizeWordTimingsForScript("P R", rawWords, 0.9, aliases);

  expect(aligned.estimated).toBe(false);
  expect(aligned.rawWords).toEqual(rawWords);
  expect(aligned.words.map(({ word, start, end }) => ({ word, start, end }))).toEqual([
    { word: "P", start: 0.1, end: 0.4 },
    { word: "R", start: 0.4, end: 0.9 },
  ]);
  expect(analyzeTeleprompterDrift({
    segments: [{
      id: "expanded-initialism",
      transcript: "P R",
      sourceWords: rawWords,
      renderedWords: aligned.words,
      aliases,
    }],
  }).verdict).toBe("PASS");
  expect(analyzeTranscriptFidelity({
    segments: [{ id: "expanded-initialism", script: "pull request", rawWords }],
  }).verdict).toBe("PASS");

  const unrelatedRaw = [
    { word: "peer", start: 0.1, end: 0.4 },
    { word: "review", start: 0.4, end: 0.9 },
  ];
  expect(normalizeWordTimingsForScript("P R", unrelatedRaw, 0.9, aliases).estimated).toBe(true);
  expect(analyzeTeleprompterDrift({
    segments: [{
      id: "unapproved-substitution",
      transcript: "P R",
      sourceWords: unrelatedRaw,
      renderedWords: aligned.words,
      aliases,
    }],
  }).verdict).toBe("REJECTED");
});

test("local TTS runtime loads config and sends only synthInput into the engine path", () => {
  const mainSource = runnerSource.slice(runnerSource.indexOf("async function main"));
  expect(runnerSource).toContain("loadPronunciationRules");
  expect(runnerSource).toContain("prepareSpeechChannels");
  expect(runnerSource).toMatch(/const pronunciationRules = loadPronunciationRules\(\)/);
  expect(runnerSource).toMatch(
    /const \{ synthInput: spokenText \} = prepareSpeechChannels\(args\.text, pronunciationRules\)/,
  );
  expect(runnerSource).not.toContain("normalizeForSpeech(args.text)");
  expect(mainSource).not.toMatch(/args\.text\s*=/);
  expect(runnerSource).toContain("await writeFile(`${output}.spoken.txt`, spokenText, \"utf8\")");
  expect(synthSegmentsSource).toContain("deriveSpeechAliases");
  expect(synthSegmentsSource).toMatch(
    /normalizeWordTimingsForScript\(sceneForRun\.script, stt\.words, duration, speechAliases\)/,
  );
  expect(buildDashboardSource).toContain("synthScript: spokenText || s.script");
  expect(buildDashboardSource).toContain("aliases: artifact.speechAliases");
  expect(buildDashboardSource).toContain("required synth-input sidecar is missing");
  expect(buildDashboardSource).toContain("synth-input sidecar is empty");
});

test("local TTS runtime commits synth provenance only after the selected WAV is validated", () => {
  const sidecarWrite = "await writeFile(`${output}.spoken.txt`, spokenText, \"utf8\")";
  const writeIndexes = [...runnerSource.matchAll(new RegExp(sidecarWrite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))]
    .map((match) => match.index);
  const cacheHitValidation = runnerSource.indexOf("if (!hitInfo || hitInfo.size === 0)");
  const cacheHitReceipt = runnerSource.indexOf("await writeTakeCacheReceipt(output, cacheKey", cacheHitValidation);
  const synthesizedValidation = runnerSource.indexOf("if (!info || info.size === 0)");
  const synthesizedReceipt = runnerSource.indexOf("await writeTakeCacheReceipt(output, cacheKey", synthesizedValidation);

  expect(writeIndexes).toHaveLength(2);
  expect(writeIndexes[0]).toBeGreaterThan(cacheHitValidation);
  expect(writeIndexes[0]).toBeLessThan(cacheHitReceipt);
  expect(writeIndexes[1]).toBeGreaterThan(synthesizedValidation);
  expect(writeIndexes[1]).toBeLessThan(synthesizedReceipt);
});

test("skill documents the install overlay, phrase limitation, and two-channel law", () => {
  expect(skillText).toContain("NARRATIONLAYER_PRONUNCIATION_FILE");
  expect(skillText).toContain("path-delimited");
  expect(skillText).toContain("later files override earlier entries");
  expect(skillText).toContain("ENGINE channel only");
  expect(skillText).toContain("exact context phrases");
  expect(skillText).toContain("~/.voicelayer/pronunciation.yaml");
  expect(skillText).toContain("B8");
  expect(skillText).toContain("PR: \"pull request\"");
});

test("eval registry names the B13/B11 engine-channel guarantee", () => {
  const evalCase = evalRegistry.evals.find((entry) => entry.name === "engine-channel-spoken-form-and-respell");
  expect(evalCase).toBeDefined();
  expect(evalCase.description).toContain("B13");
  expect(evalCase.description).toContain("B11");
  expect(evalCase.assertions.map((assertion) => assertion.name)).toEqual([
    "expands-spaced-capitals-on-synth-input",
    "supports-install-pronunciation-overlay",
    "respells-contextual-heteronym-on-synth-input",
    "preserves-real-timing-through-approved-aliases",
    "preserves-original-display-text",
  ]);
});

test("B13 frame_0616 expands the synth input while the display stays verbatim", () => {
  const displayText = fixture.spokenForm.script;
  const synthInput = normalizeForSpeech(displayText, shippedRules);
  const displayWordInput = timedScriptWords(displayText);

  expect(synthInput).toBe(
    "Next item one of five — the ratification pull request stays the critical path: both Fables finish the specs pull request, and your red-pen pass on it is your next touchpoint. Everything implementation-shaped waits behind it. Keep it as priority one, or push back?",
  );

  const html = renderV4({
    title: "B13 two-channel fixture",
    scenes: [{
      id: "frame-0616",
      title: "Frame 0616",
      script: displayText,
      words: displayWordInput,
      audioUrl: "data:audio/mpeg;base64,ZmFrZQ==",
    }],
  });
  const cue = tpdataFromHtml(html)["frame-0616"].cues[0];

  expect(cue.text).toBe(displayText);
  expect(cue.text).toContain("ratification P R");
  expect(cue.text).toContain("specs P R");
  expect(cue.text).not.toContain("pull request");
  expect(cue.text).not.toContain("lyve");
  expect(cue.words).toEqual(displayWordInput);
  const displayWords = cue.words.map((entry) => entry.word);
  expect(displayWords.filter((word) => word === "P")).toHaveLength(2);
  expect(displayWords.filter((word) => word === "R" || word === "R,")).toHaveLength(2);
  expect(displayWords).not.toContain("pull");
  expect(displayWords).not.toContain("request");
  expect(displayWords).not.toContain("lyve");
});

test("B13 config terms and general spaced capitals normalize only the synth input", () => {
  expect(normalizeForSpeech("your voice Q A list", shippedRules)).toBe("your voice quality assurance list");
  expect(normalizeForSpeech("Route A B C through M C P.", shippedRules)).toBe("Route ABC through MCP.");
  expect(normalizeForSpeech("Keep A\nB on separate lines.", shippedRules)).toBe("Keep A\nB on separate lines.");
});

test("B11 real s9q broadcast contexts respell live without changing the /lɪv/ sense", async () => {
  const displayText = fixture.heteronym.script;
  const synthInput = normalizeForSpeech(displayText, shippedRules);
  const aliases = (await import("../vendor/narrationlayer/text-normalize.ts"))
    .deriveSpeechAliases(displayText, synthInput);

  expect(synthInput).toContain("watches for lyve streams");
  expect(synthInput).toContain("lyve for three minutes");
  expect(synthInput.match(/lyve again/g)).toHaveLength(2);
  expect(displayText).not.toContain("lyve");
  expect(aliases).toContainEqual({ term: "live", spoken: "lyve" });
  expect(normalizeForSpeech("I live in Rehovot.", shippedRules)).toBe("I live in Rehovot.");
});
