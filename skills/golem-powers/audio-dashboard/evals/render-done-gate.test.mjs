// Deterministic replay gate for render-done-gate (gen-18 Track 2 #3).
// Pinned RED (render false-green) + GREEN (composite-probed / N-A) transcript
// fixtures ARE the replayable gate — same fixtures in → same pass/fail out
// (R-003/R-014 pattern, T6 smoke-spec shape). Runs under `bun test` and
// `node --test`.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectRenderDone, REGISTERED_CLONES } from "../src/render-done-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const redDir = path.join(here, "fixtures", "render-done-gate", "red");
const greenDir = path.join(here, "fixtures", "render-done-gate", "green");

function loadFixtures(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

const reds = loadFixtures(redDir);
const greens = loadFixtures(greenDir);

test("fixture coverage: the 4 specimen REDs + evasion REDs + GREEN references present", () => {
  // 4 brief RED specimens (give-it-a-play-no-mp3, system-TTS speaker2,
  // ffprobe-wrong-file, script-relayed) + ≥3 evasion REDs (one per code).
  expect(reds.length).toBeGreaterThanOrEqual(7);
  expect(greens.length).toBeGreaterThanOrEqual(3);
  // Every render-done violation code is exercised by at least one RED fixture.
  const codes = new Set(reds.map((r) => r.violation));
  expect(codes.has("RENDER_NO_FFPROBE")).toBe(true);
  expect(codes.has("RENDER_WRONG_OR_MISSING_VOICE")).toBe(true);
  expect(codes.has("RENDER_SURFACE_UNREACHABLE")).toBe(true);
  expect(codes.has("RENDER_SCRIPT_NOT_AUDIO")).toBe(true);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const result = detectRenderDone(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const result = detectRenderDone(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectRenderDone(fx))).toBe(JSON.stringify(detectRenderDone(fx)));
  }
});

test("a narration render-done with NO probe of any kind is always a FLAG", () => {
  const bare = {
    events: [
      { role: "user", text: "Render the AfterCode segment." },
      { role: "assistant", text: "Render complete 🎧 — give it a play." },
    ],
  };
  const r = detectRenderDone(bare);
  expect(r.verdict).toBe("FLAG");
  expect(r.violations.map((v) => v.code)).toContain("RENDER_NO_FFPROBE");
});

test("voice gate fails CLOSED on a missing profile (never a silent fallback)", () => {
  const missing = {
    events: [
      { role: "user", text: "Render the 2-voice intro to out/intro.mp3." },
      {
        role: "assistant",
        text: "Probing.",
        tools: [
          { name: "Bash", input: { command: "ls -l out/intro.mp3" } },
          { name: "Bash", input: { command: "ffprobe -show_entries format=size,duration out/intro.mp3" } },
        ],
      },
      { role: "tool", text: "-rw-r--r-- 1 user staff 24112 out/intro.mp3" },
      { role: "tool", text: "size=24112\nduration=132.4\nWARNING: voice profile not found for speaker2" },
      { role: "assistant", text: "Render done ✅ — out/intro.mp3 (24112 bytes, 132.4s). Give it a play." },
    ],
  };
  const r = detectRenderDone(missing);
  expect(r.verdict).toBe("FLAG");
  expect(r.violations.map((v) => v.code)).toContain("RENDER_WRONG_OR_MISSING_VOICE");
});

test("a non-render completion claim is N/A (the generic false-green-gate covers it)", () => {
  const nonRender = {
    events: [
      { role: "user", text: "Fix the lint error." },
      { role: "assistant", text: "Done ✅ — the lint passes now." },
    ],
  };
  expect(detectRenderDone(nonRender).claim).toBe(false);
  expect(detectRenderDone(nonRender).verdict).toBe("PASS");
});

test("theo-c4s is a registered clone (same family as theo-c4)", () => {
  expect(REGISTERED_CLONES).toContain("theo-c4s");
  expect(REGISTERED_CLONES).toContain("theo-c4");
  expect(REGISTERED_CLONES).toContain("ben-c1");
});
