import { test, expect, describe } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  HOST_VOICE,
  EXPERT_VOICE,
  VOICE_PERSON_BY_ROLE,
  analyzeVoiceRoles,
  expertVoiceFromEnv,
  voicePersonFromProfile,
  formatVoiceRoleReport,
} from "../src/voice-role-gate.mjs";

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
    ]);
    expect(result.verdict).toBe("PASS");
    expect(result.overridden).toHaveLength(1);
    expect(result.overridden[0].reason).toContain("cold open");
  });

  test("a job-level override keyed by scene id allows the swap", () => {
    const result = analyzeVoiceRoles([{ id: "s1q", role: "host", reference: "examplechannel-c4s" }], {
      overrides: { s1q: "guest-hosted episode" },
    });
    expect(result.verdict).toBe("PASS");
    expect(result.overridden[0].source).toBe("job");
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
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].segment).toBe("s2q");
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
