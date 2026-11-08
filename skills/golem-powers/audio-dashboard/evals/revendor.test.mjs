import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { computeContentHashKey } from "../vendor/narrationlayer/local-tts-runner.ts";
import { prepareSpeechChannels } from "../src/spoken-form.mjs";
import { classifyVendorDrift, observeVendorState } from "../src/narration-vendor-drift.mjs";

test("profile identity, version and model independently invalidate frozen takes", () => {
  const input = { spokenText: "hello", referenceClip: "clip.wav", referenceText: "hello", params: {} };
  const original = computeContentHashKey(input);
  const keys = ["profileId", "profileVersion", "model"].map(field => computeContentHashKey({ ...input, [field]: "changed" }));
  expect(new Set([original, ...keys]).size).toBe(4);
});

test("the callback applies spoken forms once, before overlay replacements", () => {
  expect(prepareSpeechChannels("alpha", [{ term: "alpha", spoken: "5%" }])).toEqual({
    displayText: "alpha", synthInput: "5%",
  });
});

test("the real wrapper selects an accepted alias and frozen take with profile identity and install overlay", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "revendor-cache-"));
  try {
    const clip = path.join(root, "reference.wav");
    const token = path.join(root, "fixture-token");
    const overlay = path.join(root, "pronunciation.yaml");
    const output = path.join(root, "take.wav");
    const cache = path.join(root, "cache");
    writeFileSync(clip, "synthetic reference; no live TTS");
    writeFileSync(token, "synthetic-token");
    writeFileSync(overlay, 'acronyms:\n  alpha: "5%"\n');
    writeFileSync(path.join(root, "profiles.local.yaml"), `profiles:
  - id: fixture-v2
    speaker: fixture
    profile_version: v2
    accepted: true
    renderer: voicelayer-qwen3
    render:
      model: fixture-model
      reference_clip: ${clip}
      reference_text: reference
      auth_token_file: ${token}
      daemon_url: http://127.0.0.1:1
`);
    const text = "P R by 21:00 alpha";
    const spokenText = "pull request by nine p m 5%";
    const cacheKey = computeContentHashKey({ spokenText, referenceClip: clip, referenceText: "reference",
      profileId: "fixture-v2", profileVersion: "v2", model: "fixture-model", params: {} });
    mkdirSync(cache);
    writeFileSync(path.join(cache, `${cacheKey}.wav`), "synthetic frozen take; nonempty fixture");
    const env = { ...process.env, NARRATIONLAYER_ROOT: root, NARRATIONLAYER_PROFILES_FILE: "",
      NARRATIONLAYER_PRONUNCIATION_FILE: overlay };
    const wrapper = new URL("../scripts/local-tts.mjs", import.meta.url).pathname;
    const result = spawnSync(process.execPath, [wrapper, "--text", text, "--output", output,
      "--reference", "fixture", "--cache-dir", cache], { encoding: "utf8", env, timeout: 10000 });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`cache HIT key=${cacheKey}`);
    expect(readFileSync(`${output}.spoken.txt`, "utf8")).toBe(spokenText);
    expect(JSON.parse(readFileSync(`${output}.cache.json`, "utf8"))).toEqual({ version: 1, cacheKey, cacheEnabled: true });
    expect(readFileSync(output, "utf8")).toBe("synthetic frozen take; nonempty fixture");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every pending vendor rejection maps to a named open debt", async () => {
  const skillRoot = new URL("../", import.meta.url).pathname;
  const stamp = JSON.parse(readFileSync(new URL("../vendor/narrationlayer/VENDOR-VERSION", import.meta.url), "utf8"));
  const observed = await observeVendorState({ skillRoot, stamp });
  const result = classifyVendorDrift(stamp, observed, { upstreamAvailable: false });
  const debts = [...stamp.vendorSideFirst, ...stamp.upstreamSideFirst].filter(debt => debt.status === "open");
  for (const row of result.records.filter(row => row.verdict === "REJECTED")) {
    expect(debts.some(debt => debt.pairId === row.pairId && row.evidence.includes(debt.id))).toBe(true);
  }
});
