import { test, expect, describe } from "bun:test";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import hostOnlyCommute from "./fixtures/voice-role/commute-host-only.json";
import { renderDecisionFlow } from "../src/decision-flow.mjs";

// These fixtures use the neutral expert; the gates capture env at import time.
const gate = await (async () => {
  const original = process.env.GOLEMS_EXPERT_VOICE;
  try {
    delete process.env.GOLEMS_EXPERT_VOICE;
    return await import("../src/voice-role-gate.mjs");
  } finally {
    if (original === undefined) delete process.env.GOLEMS_EXPERT_VOICE;
    else process.env.GOLEMS_EXPERT_VOICE = original;
  }
})();
const {
  HOST_VOICE,
  EXPERT_VOICE,
  VOICE_PERSON_BY_ROLE,
  analyzeVoiceRoles,
  expertVoiceFromEnv,
  voicePersonFromProfile,
  formatVoiceRoleReport,
} = gate;

describe("Etan's ruling is encoded as constants, not prose", () => {
  test("Ben is the HOST, the stream author is the EXPERT", () => {
    expect(HOST_VOICE).toBe("ben");
    expect(EXPERT_VOICE).toBe("examplechannel");
    expect(VOICE_PERSON_BY_ROLE.host).toBe("ben");
    expect(VOICE_PERSON_BY_ROLE.expert).toBe("examplechannel");
  });
});

describe("expertVoiceFromEnv", () => {
  test("the stream author comes from config; the repo only ships a neutral placeholder", () => {
    expect(expertVoiceFromEnv(undefined)).toBe("examplechannel");
    expect(expertVoiceFromEnv("  ")).toBe("examplechannel");
    expect(expertVoiceFromEnv(" SomeAuthor ")).toBe("someauthor");
  });

  test("rejects a value that is not a single <person> segment", () => {
    expect(() => expertVoiceFromEnv("some-author")).toThrow("GOLEMS_EXPERT_VOICE");
    expect(() => expertVoiceFromEnv("a b")).toThrow("GOLEMS_EXPERT_VOICE");
  });
});

describe("voicePersonFromProfile", () => {
  test("reads the person segment from a registered profile id", () => {
    expect(voicePersonFromProfile("examplechannel-c4s")).toBe("examplechannel");
    expect(voicePersonFromProfile("examplechannel-c4")).toBe("examplechannel");
    expect(voicePersonFromProfile("ben-c1")).toBe("ben");
    expect(voicePersonFromProfile("Examplechannel-N4A")).toBe("examplechannel");
  });

  test("refuses to guess a person from a BYO .wav clip or empty input", () => {
    expect(voicePersonFromProfile("/tmp/ben-sounding-clip.wav")).toBe("");
    expect(voicePersonFromProfile("")).toBe("");
    expect(voicePersonFromProfile(undefined)).toBe("");
  });
});

describe("the gate", () => {
  test("PASSES the correct assignment: host=ben asks, expert=examplechannel explains", () => {
    const result = analyzeVoiceRoles([
      { id: "s1q", role: "host", reference: "ben-c1" },
      { id: "s1a", role: "expert", reference: "examplechannel-c4s" },
    ]);
    expect(result.verdict).toBe("PASS");
    expect(result.violations).toEqual([]);
    expect(result.checked).toHaveLength(2);
  });

  test("REJECTS the inversion — this is the defect that shipped twice", () => {
    const result = analyzeVoiceRoles([
      { id: "s1q", role: "host", reference: "examplechannel-c4s" },
      { id: "s1a", role: "expert", reference: "ben-c1" },
    ]);
    expect(result.verdict).toBe("REJECT");
    expect(result.violations).toHaveLength(2);
    expect(result.violations.every((v) => v.metric === "voice-role-inverted")).toBe(true);
    expect(result.violations[0]).toMatchObject({
      segment: "s1q",
      role: "host",
      expectedVoice: "ben",
      actualVoice: "examplechannel",
    });
  });

  test("ignores scenes whose role is not host/expert", () => {
    const result = analyzeVoiceRoles([
      { id: "s1", role: "default", reference: "examplechannel-c4s" },
      { id: "s2", reference: "ben-c1" },
    ]);
    expect(result.verdict).toBe("PASS");
    expect(result.checked).toHaveLength(0);
  });

  test("ignores BYO scenes that declare no voice at all", () => {
    const result = analyzeVoiceRoles([
      { id: "s1q", role: "host", audioWav: "/tmp/s1q.wav" },
      { id: "s1a", role: "expert" },
    ]);
    expect(result.verdict).toBe("PASS");
    expect(result.checked).toHaveLength(0);
  });

  test("fails CLOSED on a role-bearing scene with an unrecognized voice", () => {
    const result = analyzeVoiceRoles([{ id: "s1q", role: "host", reference: "macos-samantha" }]);
    expect(result.verdict).toBe("REJECT");
    expect(result.violations[0].metric).toBe("voice-unverified");
  });

  test("reads scene.profile when scene.reference is absent", () => {
    const result = analyzeVoiceRoles([{ id: "s1a", role: "expert", profile: "ben-c1" }]);
    expect(result.verdict).toBe("REJECT");
    expect(result.violations[0].metric).toBe("voice-role-inverted");
  });
});

describe("override — stated in the job file, never inferred", () => {
  test("a scene-level override with a reason allows the swap", () => {
    const result = analyzeVoiceRoles([
      { id: "s1q", role: "host", reference: "examplechannel-c4s", voiceRoleOverride: "cold open: the stream author asks the framing question" },
      { id: "s1a", role: "expert", reference: "ben-c1", voiceRoleOverride: "guest answer" },
    ]);
    expect(result.verdict).toBe("PASS");
    expect(result.overridden).toHaveLength(2);
    expect(result.overridden[0].reason).toContain("cold open");
  });

  test("a job-level override keyed by scene id allows the swap", () => {
    const result = analyzeVoiceRoles([{ id: "s1q", role: "host", reference: "examplechannel-c4s" }], {
      overrides: { s1q: "guest-hosted episode" },
      voiceRoles: { single: { reason: "deliberate single-narrator listening piece" } },
    });
    expect(result.verdict).toBe("PASS");
    expect(result.overridden.every(row => row.source === "job")).toBe(true);
  });

  test("an empty or whitespace override is NOT an override — it still rejects", () => {
    const blank = analyzeVoiceRoles([{ id: "s1q", role: "host", reference: "examplechannel-c4s", voiceRoleOverride: "   " }]);
    expect(blank.verdict).toBe("REJECT");
    const missing = analyzeVoiceRoles([{ id: "s1q", role: "host", reference: "examplechannel-c4s", voiceRoleOverride: null }]);
    expect(missing.verdict).toBe("REJECT");
  });

  test("an override on one scene does not excuse an inversion on another", () => {
    const result = analyzeVoiceRoles([
      { id: "s1q", role: "host", reference: "examplechannel-c4s", voiceRoleOverride: "deliberate" },
      { id: "s2q", role: "host", reference: "examplechannel-c4s" },
    ]);
    expect(result.verdict).toBe("REJECT");
    expect(result.violations.filter(v => v.metric === "voice-role-inverted")).toHaveLength(1);
    expect(result.violations.find(v => v.metric === "voice-role-inverted").segment).toBe("s2q");
  });
});

/**
 * KNOWN-ANSWER CONTROL, per the ruling: "RED first, and it exists in the wild."
 * These are the two REAL published job specs. A gate that has never gone red
 * proves nothing, so this asserts REJECT against artifacts on disk rather than
 * against a hand-built fixture.
 *
 * Skipped (not failed) when the orchestrator repo is not checked out beside
 * golems, so the suite stays portable — but when the files ARE present, they
 * must reject.
 */
describe("RED control — the two dashboards that shipped inverted", () => {
  const JOBS_DIR = path.join(os.tmpdir(), "audio-dashboard-test-jobs");
  const CASES = ["2026-08-03-since-the-weave.json", "2026-08-04-night-of-aug-3.json"];

  for (const file of CASES) {
    const specPath = path.join(JOBS_DIR, file);
    const present = existsSync(specPath);

    test.skipIf(!present)(`${file} REJECTS with every host/expert scene inverted`, () => {
      const spec = JSON.parse(readFileSync(specPath, "utf8"));
      const result = analyzeVoiceRoles(spec.scenes ?? [], { overrides: spec.voiceRoleOverrides ?? {} });

      expect(result.verdict).toBe("REJECT");
      expect(result.violations.length).toBeGreaterThan(0);
      // Every violation is the inversion, not an unverified-voice fluke.
      expect(result.violations.every((v) => v.metric === "voice-role-inverted")).toBe(true);
      // Specifically: hosts rendered as examplechannel, experts rendered as ben.
      const hosts = result.violations.filter((v) => v.role === "host");
      const experts = result.violations.filter((v) => v.role === "expert");
      expect(hosts.length).toBeGreaterThan(0);
      expect(experts.length).toBeGreaterThan(0);
      expect(hosts.every((v) => v.actualVoice === "examplechannel")).toBe(true);
      expect(experts.every((v) => v.actualVoice === "ben")).toBe(true);
      expect(formatVoiceRoleReport(result)).toContain("voice-role gate REJECT");
    });
  }
});

// SYNTHETIC shape-only regression, never acoustic or private-job evidence.
test("7 Nov commute shape: rejects 26 host-only cards and omits misleading labels", () => {
  expect(hostOnlyCommute.scenes).toHaveLength(26);
  expect(hostOnlyCommute.decisions).toHaveLength(26);
  const result = analyzeVoiceRoles(hostOnlyCommute.scenes);
  expect(result.verdict).toBe("REJECT");
  expect(result.violations.map(v => v.metric)).toContain("SINGLE_VOICE_BUILD");
  const html = renderDecisionFlow({ ...hostOnlyCommute, scenes: hostOnlyCommute.scenes.map(scene => ({
    ...scene, speaker: "ben", words: [], duration: 0, audioUrl: "synthetic.mp3",
  })) });
  expect(html).not.toContain(">Ben asks</span>");
});

const PAIR = [
  { id: "q", role: "host", reference: "ben-c1", script: "What changed?" },
  { id: "a", role: "expert", reference: "examplechannel-c4s", script: "The agent asks for approval before publishing." },
];
const SINGLE = { single: { reason: "deliberate single-narrator listening piece" } };

test("two-voice defaults pass, including ordinary prose with asks", () => {
  for (const script of [PAIR[1].script, "The host says hello.", "The expert explains the decision.", "This answer asks for a choice."]) {
    expect(analyzeVoiceRoles([PAIR[0], { ...PAIR[1], script }]).verdict).toBe("PASS");
  }
});

test("single narration requires a job-level nonblank string reason, retained in config", () => {
  const scenes = hostOnlyCommute.scenes;
  const result = analyzeVoiceRoles(scenes, { voiceRoles: SINGLE });
  expect(result.verdict).toBe("PASS");
  expect(result.thresholds.singleVoiceOverrideReason).toBe(SINGLE.single.reason);
  for (const reason of ["", "   ", null, true, 42, {}]) {
    expect(analyzeVoiceRoles(scenes, { voiceRoles: { single: { reason } } }).verdict).toBe("REJECT");
  }
  expect(analyzeVoiceRoles(scenes, { overrides: { s1: "deliberate" } }).verdict).toBe("REJECT");
});

test("role overrides cannot disguise one voice person as two roles", () => {
  const scenes = [PAIR[0], { ...PAIR[1], reference: "ben-c2", voiceRoleOverride: "deliberate" }];
  expect(analyzeVoiceRoles(scenes).violations.map(v => v.metric)).toEqual(["SINGLE_VOICE_BUILD"]);
});

for (const script of ["Ben asks: what changed?", "Ben says yes.", "Examplechannel explains the change.",
  "Alex answers: yes.", "Intro.\nHost: question", "Expert: answer", "Q: question", "A: answer"]) {
  test(`rejects spoken role announcement: ${script}`, () => {
    const result = analyzeVoiceRoles([{ ...PAIR[0], script }, PAIR[1]]);
    expect(result.violations.map(v => v.metric)).toEqual(["ROLE_LABEL_SPOKEN"]);
  });
}

test("single override never excuses spoken announcements or inverted voices", () => {
  const result = analyzeVoiceRoles([{ ...PAIR[0], reference: "examplechannel-c4s", script: "Ben asks: why?" }], { voiceRoles: SINGLE });
  expect(result.violations.map(v => v.metric)).toEqual(["voice-role-inverted", "ROLE_LABEL_SPOKEN"]);
});

test("rendered role labels require an expert answer on the same card, not elsewhere", () => {
  const decisions = [{ id: "host", sceneIds: ["q"] }, { id: "expert", sceneIds: ["a"] }];
  const renderedHtml = '<article data-decision="host"><span class="df-speaker" data-role="host">Ben asks</span></article>';
  expect(analyzeVoiceRoles(PAIR, { decisions, renderedHtml }).violations.map(v => v.metric)).toEqual(["ROLE_LABEL_MISMATCH"]);
  expect(analyzeVoiceRoles(PAIR, { decisions: [{ id: "host", sceneIds: ["q", "a"] }], renderedHtml }).verdict).toBe("PASS");
  expect(analyzeVoiceRoles(hostOnlyCommute.scenes, { voiceRoles: SINGLE, decisions: [{ id: "host", sceneIds: ["s1"] }], renderedHtml }).verdict).toBe("REJECT");
});

for (const [label, job, verdict] of [
  ["host-only", hostOnlyCommute, "REJECT"],
  ["blank override", { ...hostOnlyCommute, voiceRoles: { single: { reason: "   " } } }, "REJECT"],
  ["deliberate single", { ...hostOnlyCommute, voiceRoles: SINGLE }, "PASS"],
  ["two voices", { ...hostOnlyCommute, scenes: PAIR }, "PASS"],
]) test(`BUILD CLI ${label}: persists voice-role ${verdict} before media work`, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "voice-role-build-"));
  try {
    const specPath = path.join(root, "job.json"), outPath = path.join(root, "dashboard.html");
    writeFileSync(outPath, "stale HTML");
    writeFileSync(specPath, JSON.stringify(job));
    const run = spawnSync(process.execPath, [path.resolve(import.meta.dir, "../scripts/build-dashboard.mjs"),
      "--spec", specPath, "--out", outPath], { encoding: "utf8", env: { ...process.env, GOLEMS_EXPERT_VOICE: "examplechannel" } });
    expect(run.status).toBe(1);
    if (verdict === "REJECT") expect(run.stderr).toContain("SINGLE_VOICE_BUILD");
    expect(existsSync(outPath)).toBe(false);
    const receipts = JSON.parse(readFileSync(path.join(root, "dashboard.receipts.json"), "utf8"));
    expect(receipts.gates[0]).toMatchObject({ gate: "voice-role", verdict });
    if (verdict === "REJECT") {
      expect(receipts.gates).toHaveLength(1);
      expect(receipts.gates[0].violations[0].metric).toBe("SINGLE_VOICE_BUILD");
    } else {
      // No media supplied: voice PASS is scoped; the next BUILD gate rejects.
      expect(receipts.gates[1].verdict).toBe("REJECT");
      if (job.voiceRoles) expect(receipts.gates[0].config.singleVoiceOverrideReason).toBe(SINGLE.single.reason);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("authored role title cannot reintroduce a misleading label on a host-only card", () => {
  const scenes = [{ ...PAIR[0], title: "Ben asks", words: [], speaker: "ben" }];
  const decisions = [{ id: "only", title: "Synthetic", sceneIds: ["q"] }];
  const renderedHtml = renderDecisionFlow({ scenes, decisions });
  const result = analyzeVoiceRoles(scenes, { voiceRoles: SINGLE, decisions, renderedHtml });
  expect(result.violations.map(v => v.metric)).toEqual(["ROLE_LABEL_MISMATCH"]);
});

test("ordinary rendered title ending in asks is not a role label", () => {
  const scenes = [{ ...PAIR[0], title: "What the agent asks", words: [], speaker: "ben" }];
  const decisions = [{ id: "only", title: "Synthetic", sceneIds: ["q"] }];
  expect(analyzeVoiceRoles(scenes, { voiceRoles: SINGLE, decisions,
    renderedHtml: renderDecisionFlow({ scenes, decisions }) }).verdict).toBe("PASS");
});

test("mixed declared host and undeclared BYO expert does not infer a single voice", () => {
  const scenes = [PAIR[0], { id: "a", role: "expert", audioWav: "synthetic.wav" }];
  expect(analyzeVoiceRoles(scenes).verdict).toBe("PASS");
});
