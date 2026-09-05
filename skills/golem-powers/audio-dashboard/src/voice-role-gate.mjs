/**
 * VOICE-ROLE BUILD gate.
 *
 * ETAN'S RULING (2026-08-04), verbatim:
 *   "Ben is the HOST. Theo is the EXPERT. Ben asks, Theo explains. ~90% of the
 *    time, treat as always unless a job explicitly overrides."
 *
 * WHY THIS EXISTS — the blind spot it covers
 * ------------------------------------------
 * The build path already threads `role: "host" | "expert"` per scene, but NOTHING
 * mapped a role to a voice. The voice is chosen entirely by `scene.reference`
 * (or `scene.profile`), and `local-tts-runner.ts:151` documents `--role` as
 * "Informational; passed by AfterCode. No engine effect." So `role` was decorative:
 * the two fields could disagree indefinitely and every gate downstream would still
 * pass, because every existing gate measures the WAV or the transcript, and both
 * are perfectly consistent with the WRONG voice saying the right words.
 *
 * The convention held for months by habit. The first agent to build a dashboard
 * without having absorbed it inverted the roles, and it shipped twice
 * (2026-08-03-since-the-weave, 2026-08-04-night-of-aug-3): every `role: host`
 * scene rendered in `theo-c4s` and every `role: expert` scene in `ben-c1`.
 * Etan caught it by ear. This gate exists so that never has to happen again.
 *
 * FAIL-CLOSED. A role/voice contradiction REJECTs the build; it does not warn.
 */

/**
 * The ruling, as the only two constants in the build path that encode it.
 * These are PERSONS, not profile ids — a person owns many profiles over time
 * (theo-c4, theo-c4s, theo-n4a, ...), and pinning a profile id would rot on the
 * next cadence experiment while the ruling itself would not have changed.
 */
export const HOST_VOICE = "ben";
export const EXPERT_VOICE = "theo";

/** Derived: person -> the one role that person is allowed to speak. */
export const ROLE_BY_VOICE_PERSON = Object.freeze({
  [HOST_VOICE]: "host",
  [EXPERT_VOICE]: "expert",
});

/** Derived: role -> the one person allowed to speak it. */
export const VOICE_PERSON_BY_ROLE = Object.freeze({
  host: HOST_VOICE,
  expert: EXPERT_VOICE,
});

/** Only these roles carry a voice-identity claim; "default" and friends do not. */
const GATED_ROLES = Object.freeze(["host", "expert"]);

/**
 * Voice profile ids are `<person>-<variant>` by convention (theo-c4s, ben-c1).
 * Returns the lowercased person segment, or "" when there is nothing to read.
 */
export function voicePersonFromProfile(reference) {
  const raw = String(reference ?? "").trim().toLowerCase();
  if (!raw) return "";
  // A direct .wav reference is a BYO clip, not a registered profile — the
  // basename is not a person and must not be guessed at.
  if (/\.wav$/i.test(raw)) return "";
  const [person] = raw.split("-");
  return person || "";
}

/**
 * Resolve the override for a scene, if any. An override MUST be stated in the
 * job file — it is never inferred from the voice, the script, or scene order.
 * Accepts a scene-level `voiceRoleOverride` or a job-level `voiceRoleOverrides`
 * map keyed by scene id. The value must be a non-empty reason string, so that
 * the receipt records WHY, not merely THAT, the ruling was set aside.
 */
export function resolveVoiceRoleOverride(scene, jobOverrides = {}) {
  const sceneLevel = scene?.voiceRoleOverride;
  const jobLevel = jobOverrides?.[scene?.id];
  const chosen = sceneLevel ?? jobLevel;
  if (chosen === undefined || chosen === null) return null;
  const reason = String(chosen).trim();
  if (!reason) return null;
  return { scene: scene?.id, reason, source: sceneLevel != null ? "scene" : "job" };
}

/**
 * Analyze role/voice agreement across scenes.
 *
 * A scene is gated only when it BOTH declares a gated role AND declares a voice.
 * A scene with no reference/profile is BYO audio: there is no voice choice
 * recorded in the job, so there is nothing to contradict and nothing to verify.
 */
export function analyzeVoiceRoles(scenes = [], { overrides = {} } = {}) {
  const violations = [];
  const checked = [];
  const overridden = [];

  for (const scene of scenes) {
    const role = String(scene?.role ?? "").trim().toLowerCase();
    if (!GATED_ROLES.includes(role)) continue;

    const reference = scene?.reference ?? scene?.profile ?? "";
    if (!String(reference).trim()) continue;

    const override = resolveVoiceRoleOverride(scene, overrides);
    const person = voicePersonFromProfile(reference);
    const expectedPerson = VOICE_PERSON_BY_ROLE[role];

    if (override) {
      overridden.push({ segment: scene?.id, role, reference, reason: override.reason, source: override.source });
      continue;
    }

    if (!person || !(person in ROLE_BY_VOICE_PERSON)) {
      // Fail-closed: an unrecognized voice on a role-bearing scene is an
      // unverifiable voice claim, not a safe default.
      violations.push({
        segment: scene?.id,
        role,
        metric: "voice-unverified",
        reference: String(reference),
        expectedVoice: expectedPerson,
        actualVoice: person || "(unresolved)",
        detail: `role=${role} expects ${expectedPerson}, but "${reference}" does not resolve to a known voice person`,
      });
      continue;
    }

    const actualRole = ROLE_BY_VOICE_PERSON[person];
    if (actualRole !== role) {
      violations.push({
        segment: scene?.id,
        role,
        metric: "voice-role-inverted",
        reference: String(reference),
        expectedVoice: expectedPerson,
        actualVoice: person,
        detail: `role=${role} must speak in ${expectedPerson}, but "${reference}" is ${person} (the ${actualRole} voice)`,
      });
      continue;
    }

    checked.push({ segment: scene?.id, role, voice: person });
  }

  return {
    verdict: violations.length === 0 ? "PASS" : "REJECT",
    violations,
    checked,
    overridden,
    thresholds: { hostVoice: HOST_VOICE, expertVoice: EXPERT_VOICE, gatedRoles: [...GATED_ROLES] },
  };
}

export function voiceRoleRunbook(result) {
  if (result.verdict === "PASS") return "";
  const inverted = result.violations.filter((v) => v.metric === "voice-role-inverted");
  const lines = [
    `VOICE_ROLE: ${HOST_VOICE} is the HOST (asks), ${EXPERT_VOICE} is the EXPERT (explains).`,
  ];
  if (inverted.length) {
    lines.push(
      `Swap the reference/profile on ${inverted.length} scene(s): host scenes -> a ${HOST_VOICE}-* profile, expert scenes -> a ${EXPERT_VOICE}-* profile.`,
    );
  }
  lines.push(
    `If this job genuinely needs the other voice, state it in the job file: set scene.voiceRoleOverride ` +
      `(or job.voiceRoleOverrides["<sceneId>"]) to a reason string. It is never inferred.`,
  );
  return lines.join("\n");
}

export function formatVoiceRoleReport(result) {
  const header = `voice-role gate ${result.verdict}`;
  if (result.verdict === "PASS") {
    return `${header} (${result.checked.length} role-bearing scene(s) verified, ${result.overridden.length} overridden)`;
  }
  const body = result.violations
    .map((v) => `- segment=${v.segment} role=${v.role} metric=${v.metric} reference=${v.reference} ${v.detail}`)
    .join("\n");
  return `${header}\n${body}\n\n${voiceRoleRunbook(result)}`;
}
