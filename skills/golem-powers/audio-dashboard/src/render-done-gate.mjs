// render-done-gate (gen-18 Track 2 #3) — the narration/AfterCode render-done
// kill-gate. The NARRATION-SPECIALIZED, stricter sibling of false-green-gate.
//
// THE REGRESSIONS it closes: R-035 UNPROVEN/S10 (self-QA functional-not-
// mechanical) + R-024 LOST (pre-merge audio QA never run). The generic
// false-green-gate render path already blocks a render "done" without a
// same-turn ffprobe; THIS gate adds the AUDIO-specific composite probe a
// narration "give it a play" actually requires:
//
//   (a) `ls` + `ffprobe` proving size>0 AND duration>0 of the CLAIMED .mp3 path
//       (not some other file) — sub-second durations allowed;
//   (b) a REACHABLE-SURFACE check — the artifact is where it is claimed / is
//       embedded-clickable in the dashboard the listener is pointed at;
//   (c) a VOICE-PROFILE gate — the resolved `--reference` is a REGISTERED clone
//       (theo-c4 / theo-c4s / ben-c1), FAIL-CLOSED on a missing profile and on a
//       silent system-TTS / neutral-reader fallback (never fail-open);
//   (d) an AUDIO-not-SCRIPT contract — relaying the script TEXT ("here's the
//       script") in place of the rendered audio artifact is not a render-done.
//
// Specimens: narrationlayer e3a91210#1 ("give it a play", no mp3),
// 9bfa306b#9/#10 (neutral-reader / system-TTS for speaker 2).
//
// Evidence comes ONLY from REAL probe execution — Bash COMMAND strings, probe
// tool NAMES, and tool_result OUTPUTS — never assistant narrative and never an
// incidental marker in a non-probe tool's input. DETERMINISTIC: same transcript
// in → same verdict out. The pinned RED/GREEN fixtures are the replayable gate
// (R-003/R-014 pattern). This gate COMPOSES with / specializes the render path
// of `/false-green-gate` (the generic FALSE_GREEN_FFPROBE / FALSE_GREEN_VOICE).

import { normalizeTranscript, currentTurn } from "../lib/transcript.mjs";

// ── A render-done completion claim ──────────────────────────────────────────
// The narration-flavoured completion phrasings: "render done/complete", "give
// it a play/listen", "here's the mp3/audio". Bare `done`/`✅` count ONLY when
// the turn is also about render/audio (RENDER_DOMAIN_RE below) — this gate is
// scoped to the narration render class, not generic completion.
const CLAIM_RE =
  /(render (is )?(done|complete|ready|finished)|narration (is )?(done|complete|ready)|give it a (play|listen|spin|whirl|read)|ready to (play|listen)|here'?s the (render|mp3|audio|narration)|the (mp3|audio|narration|render) is (ready|done|live)|\bdone\b|✅|\bcomplete[d]?\b|\bfinished\b|\bshipped\b)/i;

// Negated/in-progress claims are NOT completion claims ("not done yet", "still
// rendering", "almost complete"). Blanked before claim detection.
const NEGATED_CLAIM_RE =
  /\b(not|isn'?t|aren'?t|won'?t|can'?t|cannot|never|almost|nearly|still (not )?)\s+(yet\s+)?\w{0,6}\s*(done|complete[d]?|finished|rendered|ready|live|shipped)/gi;

// In-progress language that a bare ✅ must not override.
const IN_PROGRESS_RE =
  /(not done|still (encoding|rendering|building|mixing|mastering|in progress)|in progress|not yet|\bwip\b|halfway|partway|mid-(render|encode|mix))/i;

// ── This is a NARRATION/AUDIO render turn ───────────────────────────────────
// The gate only engages on audio/narration claims; a non-render "done" is N/A
// here (the generic false-green-gate covers those).
const RENDER_DOMAIN_RE =
  /(\brender\b|\.mp3\b|\.wav\b|\.m4a\b|\baudio\b|narrat|aftercode|podcast|voice[- ]?over|\btts\b|give it a (play|listen)|the (mp3|audio|narration))/i;

// ── ffprobe / ls composite-probe detectors ──────────────────────────────────
const FFPROBE_RE = /(ffprobe|ffmpeg -i)/i;
const LS_RE = /(\bls\b|\bstat\b|\bdu\b|test -s\b|\[ -s )/i;
// Nonzero duration, INCLUDING sub-second (duration=0.5); rejects 0 / 0.000000.
const DURATION_OK_RE = /duration[^0-9]{0,12}(\d+\.\d*[1-9]|[1-9][0-9]*)/i;
const SIZE_OK_RE = /(\b[1-9][0-9,]*\s*(bytes|kb|kib|mb|mib)\b|size[^0-9]{0,8}[1-9])/i;

// ── Reachable-surface detectors ─────────────────────────────────────────────
// The artifact must be verified reachable where it is claimed: either the ls/
// ffprobe proved the file EXISTS at the claimed path (file-on-disk reachable),
// or it is embedded-clickable in a dashboard the listener was pointed at (an
// HTTP 200 on the served audio URL, or a dashboard embed of the mp3 with a
// click/play interaction). A bare "give it a play" with no located surface is
// unreachable.
const SURFACE_HTTP_PROBE_RE = /(http[_ ]?code|status[_ ]?code|\bcurl\b|\bwget\b|\bhttpie\b|http get|\bfetch\b)/i;
const SURFACE_STATUS_200_RE = /(^|[\s:=>"'])200(\b|$)/m;
const SURFACE_200_INLINE_RE = /(\b200 ok\b|→\s*200\b|returns? 200\b|http.?code[\s\S]{0,40}\b200\b)/i;
const SURFACE_EMBED_RE =
  /(embed(ded)?[\s\S]{0,30}(audio|mp3|player)|<audio[\s\S]{0,40}src|audio player[\s\S]{0,30}(loaded|playable)|clickable[\s\S]{0,20}(audio|mp3|play))/i;
const BROWSER_RE = /(playwright|browser_|puppeteer|\bcdp\b|chromedriver|selenium)/i;
const SURFACE_CLICK_RE = /(browser_click|\.click\(|page\.click|\bclicked\b[\s\S]{0,30}(play|audio|mp3))/i;
// The CLAIM points the listener at a SERVED surface (a dashboard / URL the
// listener is expected to OPEN), not the local file. When it does, a local
// file-on-disk probe is NOT enough — the served surface itself must be verified
// reachable (HTTP-200 / an embedded-clickable player a browser drove). Scoped to
// genuine served-surface signals: a URL, a dashboard/hub/panel, or "on/in the
// site/page/dashboard". Bare "embedded"/"audio player" are EXCLUDED — innocuous
// completion prose ("embedded in the bundle") must not force served-only
// verification and false-FLAG a valid local-file claim (cursor MEDIUM).
const SURFACE_CLAIM_RE =
  /(https?:\/\/|tailnet|\bdashboard\b|\bhub\b|\bpanel\b|on the (site|page|dashboard|hub|panel)|in the (dashboard|hub|panel|site|page))/i;

// ── Voice-profile gate (fail-closed) ────────────────────────────────────────
// The registered clones. theo-c4s is the same clone family as theo-c4.
const REGISTERED_CLONES = ["theo-c4s", "theo-c4", "ben-c1"];
// A clone/2-voice render is REQUIRED to resolve a registered --reference.
const VOICE_REQUIRED_RE =
  /(2-?voice|two-?voice|cloned? voice|clone[ds]?\b|--reference|theo-c4s?|ben-c1|speaker ?[12]|narrator|voice[- ]?profile)/i;
// The resolved reference names a registered clone (in a command or in a probe
// output that reports the RESOLVED reference).
const VOICE_RESOLVED_RE =
  /((--reference|ref(erence)?[_ ]?audio|resolved[\s\S]{0,20}reference|voice[- ]?profile)[\s\S]{0,40}(theo-c4s?|ben-c1))/i;
// The fail-open shapes this gate exists to fail CLOSED on: a silent system-TTS
// or neutral-reader fallback, or a missing/unregistered profile.
const VOICE_FALLBACK_RE =
  /(system[- ]?tts|neutral[- ]?reader|silent fallback|fall(ing|s|back)?\s*back to (system )?tts|default voice|built-?in voice|missing (voice )?profile|unregistered (voice|clone|reference)|profile not found|no (such )?(voice )?profile)/i;

// ── AUDIO-not-SCRIPT contract ───────────────────────────────────────────────
// "here's the script" relayed in place of the audio artifact is not a render-
// done. The claim relays the SCRIPT TEXT instead of pointing at the .mp3.
const SCRIPT_RELAY_RE =
  /(here'?s the script|the script (is )?(below|here|ready)|paste(d|ing)? the script|script text:|read the (following|script) (aloud|below)|full transcript below|here is the narration script)/i;

// Normalize an MCP tool name to its base (`mcp__cmuxlayer__send_to_agent` → `send_to_agent`).
function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

// Build the same-turn evidence from REAL execution only:
//   cmd = tool NAMES + Bash COMMAND strings (the executed probes)
//   out = tool_result OUTPUTS (what probes returned)
// Assistant narrative and non-Bash tool input bodies (file_path, url, …) are
// excluded, so neither prose nor an incidental marker can fake a probe.
function buildEvidence(turn) {
  const cmd = [];
  const out = [];
  // bashCmds = the INDIVIDUAL Bash command strings (not joined), so a probe can
  // be tied to the specific command that ran it — an ffprobe of the claimed path
  // and an ls of the claimed path must each be their OWN command, not merely
  // co-occur in the same blob as a `narrate -o <path>` write (cursor HIGH).
  const bashCmds = [];
  let hasBash = false;
  for (const ev of turn) {
    if (ev.role === "tool" && ev.text) out.push(ev.text);
    for (const t of ev.tools ?? []) {
      const name = t.name ?? "";
      cmd.push(name);
      if (baseName(name) === "Bash" && typeof t.input?.command === "string") {
        cmd.push(t.input.command);
        bashCmds.push(t.input.command);
        hasBash = true;
      }
    }
  }
  const cmdBlob = cmd.join("\n");
  const outBlob = out.join("\n");
  // hasBash gates OUTPUT-based success tokens: a passive tool's result (e.g. a
  // Read of a log containing "size=19245") must not clear a probe when no
  // command actually ran in the turn (codex P1 — non-probe outputs).
  return { cmd: cmdBlob, out: outBlob, all: `${cmdBlob}\n${outBlob}`, hasBash, bashCmds };
}

const ARTIFACT_PATH_RE = /([\w./-]+\.(?:mp3|wav|m4a|aac|flac|ogg))/gi;

function claimedArtifacts(claimText) {
  return [...String(claimText).matchAll(ARTIFACT_PATH_RE)].map((m) => m[1]);
}

// A command string references a specific artifact path (full path or basename).
function cmdReferencesArtifact(command, artifactPath) {
  return command.includes(artifactPath) || command.includes(artifactPath.split("/").pop());
}

// The ffprobe (size>0 AND duration>0) AND an ls/stat of the file must BOTH have
// run, and — if the claim names a specific .mp3 — the ffprobe command AND the
// ls command must EACH target THAT artifact, not some other file (R-024:
// probing out/old.mp3 must not green a claim about out/new.mp3). The path-tie is
// checked against the ffprobe/ls COMMANDS specifically — NOT the whole cmd blob,
// so a same-turn `narrate -o <path>` write cannot supply the path match while
// the probes ran on a different file (cursor HIGH).
function lsFfprobeOk(ev, claimText = "") {
  // Must have size>0 AND duration>0 evidence somewhere in the turn.
  if (!DURATION_OK_RE.test(ev.all) || !SIZE_OK_RE.test(ev.all)) return false;
  const claimed = claimedArtifacts(claimText);
  if (claimed.length === 0) {
    // No specific path claimed: an ffprobe and an ls each ran this turn.
    return ev.bashCmds.some((c) => FFPROBE_RE.test(c)) && ev.bashCmds.some((c) => LS_RE.test(c));
  }
  // A specific path is claimed: the SAME claimed artifact must be the target of
  // both an ffprobe command AND an ls/stat command.
  return claimed.some(
    (p) =>
      ev.bashCmds.some((c) => FFPROBE_RE.test(c) && cmdReferencesArtifact(c, p)) &&
      ev.bashCmds.some((c) => LS_RE.test(c) && cmdReferencesArtifact(c, p)),
  );
}

// A served surface was verified: HTTP-200 on the served audio URL OR an
// embedded-clickable dashboard player a browser actually drove this turn.
function servedSurfaceVerified(ev) {
  if (
    SURFACE_HTTP_PROBE_RE.test(ev.cmd) &&
    (SURFACE_STATUS_200_RE.test(ev.out) || SURFACE_200_INLINE_RE.test(ev.out))
  ) {
    return true;
  }
  if (BROWSER_RE.test(ev.cmd) && (SURFACE_EMBED_RE.test(ev.all) || SURFACE_CLICK_RE.test(ev.all))) {
    return true;
  }
  return false;
}

// Reachable surface: the artifact is verified reachable WHERE IT IS CLAIMED.
//   - If the claim points the listener at a SERVED surface (dashboard / URL),
//     a local file-on-disk probe is NOT enough — the served surface itself must
//     be verified (HTTP-200 / embedded-clickable player a browser drove).
//   - Otherwise (claim points at the local file), the same ls+ffprobe composite
//     probe that located the file at the claimed path is the reachable surface.
function surfaceReachable(ev, claimText = "") {
  if (SURFACE_CLAIM_RE.test(claimText)) {
    return servedSurfaceVerified(ev);
  }
  // File-on-disk reachable: the composite probe located the file at the claimed
  // path; a served-surface verification also counts.
  return lsFfprobeOk(ev, claimText) || servedSurfaceVerified(ev);
}

// Voice fail-closed: a clone/2-voice render must resolve a registered clone AND
// must NOT show any fallback/missing-profile token. A missing profile or a
// system-TTS/neutral-reader fallback fails CLOSED.
function voiceResolvedFailClosed(ev) {
  if (VOICE_FALLBACK_RE.test(ev.all)) return false;
  return VOICE_RESOLVED_RE.test(ev.all);
}

// ── The detector ────────────────────────────────────────────────────────────
// detectRenderDone(transcript) → {
//   verdict: "PASS" | "FLAG", claim, domains, violations: [{code, evidence}],
// }
export function detectRenderDone(transcript) {
  const events = normalizeTranscript(transcript);
  const turn = currentTurn(events);
  const ev = buildEvidence(turn);
  // Claim AND evidence are both scoped to the CURRENT turn: if a later human
  // turn ("thanks") follows an already-probed render-done, the current turn has
  // no claim, so we don't reuse the stale claim against an empty blob.
  const claimText = turn
    .filter((e) => e.role === "assistant")
    .map((e) => e.text ?? "")
    .join("\n");

  // No completion claim (after blanking negated/in-progress spans) → N/A.
  const declaimed = claimText.replace(NEGATED_CLAIM_RE, " ");
  if (!CLAIM_RE.test(declaimed)) {
    return { verdict: "PASS", claim: false, domains: [], violations: [] };
  }
  // A bare ✅ does NOT override explicit in-progress language.
  const onlyCheckmark = !CLAIM_RE.test(declaimed.replace(/✅/g, " "));
  if (onlyCheckmark && IN_PROGRESS_RE.test(claimText)) {
    return { verdict: "PASS", claim: false, domains: [], violations: [] };
  }

  // This gate is scoped to the narration/audio render class. A completion claim
  // that is NOT about render/audio is N/A here (generic false-green-gate covers
  // it). The render domain may surface either in the claim text or in the probe
  // commands (e.g. an ffprobe/narrate invocation).
  const isRenderTurn =
    RENDER_DOMAIN_RE.test(claimText) || RENDER_DOMAIN_RE.test(ev.cmd);
  if (!isRenderTurn) {
    return { verdict: "PASS", claim: false, domains: [], violations: [] };
  }

  const domains = ["render"];
  const violations = [];

  // (d) AUDIO-not-SCRIPT contract — checked first: relaying the script text in
  // place of the audio artifact is the most direct render-done evasion. Only a
  // genuine substitution (script relayed, no claimed .mp3 path, no ffprobe of an
  // audio file in the turn) trips this; an audio render that merely mentions
  // "the script" does not.
  if (
    SCRIPT_RELAY_RE.test(claimText) &&
    claimedArtifacts(claimText).length === 0 &&
    !FFPROBE_RE.test(ev.cmd)
  ) {
    violations.push({
      code: "RENDER_SCRIPT_NOT_AUDIO",
      evidence:
        "render-done relayed the SCRIPT TEXT instead of the rendered audio artifact — no .mp3 path and no ffprobe of an audio file in the turn.",
    });
  }

  // (a) ls + ffprobe (size>0 AND duration>0) of the CLAIMED path.
  if (!lsFfprobeOk(ev, claimText)) {
    violations.push({
      code: "RENDER_NO_FFPROBE",
      evidence:
        "render-done without a same-turn `ls`+`ffprobe` proving size>0 AND duration>0 of the CLAIMED .mp3 path (a probe of a different file does not count).",
    });
  }

  // (b) reachable-surface check.
  if (!surfaceReachable(ev, claimText)) {
    violations.push({
      code: "RENDER_SURFACE_UNREACHABLE",
      evidence:
        "render-done without verifying the artifact is reachable where it is claimed (file located on disk at the claimed path / HTTP-200 served audio / an embedded-clickable dashboard player a browser drove).",
    });
  }

  // (c) voice-profile gate, FAIL-CLOSED. Engages when the turn is a clone/2-
  // voice render (claim OR command), and on any explicit fallback/missing-
  // profile token.
  const voiceRequired =
    VOICE_REQUIRED_RE.test(claimText) ||
    VOICE_REQUIRED_RE.test(ev.cmd) ||
    VOICE_FALLBACK_RE.test(ev.all);
  if (voiceRequired && !voiceResolvedFailClosed(ev)) {
    violations.push({
      code: "RENDER_WRONG_OR_MISSING_VOICE",
      evidence:
        "cloned/2-voice render without `--reference` resolving to a REGISTERED clone (theo-c4 / theo-c4s / ben-c1) — a system-TTS/neutral-reader fallback or a missing profile fails CLOSED, never a silent fallback.",
    });
  }

  return {
    verdict: violations.length > 0 ? "FLAG" : "PASS",
    claim: true,
    domains,
    violations,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") {
    return result.claim
      ? "✅ render-done-gate PASS — narration render-done composite-probed (ls+ffprobe+surface+voice)"
      : "✅ render-done-gate PASS — no narration render-done claim (N/A)";
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ render-done-gate FLAG — ${codes}\n${result.violations.map((v) => `  • ${v.code}: ${v.evidence}`).join("\n")}`;
}

// Expose the registered-clone list for callers/tests.
export { REGISTERED_CLONES };
