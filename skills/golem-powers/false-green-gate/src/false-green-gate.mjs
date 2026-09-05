// false-green-gate (gen-18 Track 2) — the false-green live-outcome kill-gate.
//
// THE REGRESSION it closes: R-008 merged≠deployed≠running-app (BROKEN-OPEN 6+
// gens, 114× imp-10 north-star) + R-035 self-QA-functional-not-mechanical +
// R-024 pre-merge visual QA. Kills the class where a worker reports
// "done/green/fixed" on build-green | unit-tests-green | PR-merged | a
// screenshot-only check | "give it a play" with NO artifact, while the live
// surface is broken. `deploy-verify` SKILL is the PROSE this mechanizes.
//
// THE GATE: a completion claim is FALSE-GREEN unless the SAME TURN carries the
// live-outcome probe its claim domain requires:
//   render    → ffprobe size>0 AND duration>0 (and a resolved clone voice if a
//               clone/2-voice render is claimed)
//   dashboard → HTTP 200 AND a signed-in click-through
//   deploy    → a build-stamp that POST-DATES the merge AND a live round-trip
//   build     → the operational entrypoint exercised (contract/integration probe)
//   generic   → at least one live round-trip
// A "rigorous manual verification" prose substitute with NO probe is ranked last
// and flagged (the manual fallback that keeps being accepted under live pressure).
//
// Evidence comes ONLY from REAL probe execution — Bash COMMAND strings, probe
// tool NAMES, and tool_result OUTPUTS — never assistant narrative and never an
// incidental marker in a non-probe tool's input (cursor HIGH). DETERMINISTIC:
// same transcript in → same verdict out. The pinned RED/GREEN fixtures are the
// replayable gate (R-003/R-014 pattern).

import { normalizeTranscript, currentTurn, claimSearchText } from "../lib/transcript.mjs";

// ── A completion claim ──────────────────────────────────────────────────────
// Includes the bare `TASK_DONE` sentinel — `\bdone\b` does NOT match it (`_` is a
// word char), and this gate is documented as the check BEFORE emitting TASK_DONE,
// so a bare sentinel must count as a claim (codex P1).
const CLAIM_RE =
  /(\bdone\b|task_done|✅|\bfixed\b|all green|tests? (are )?green|\bverified\b|\bdeployed\b|\bpublished\b|\bshipped\b|\bcomplete[d]?\b|merged and (working|live|deployed|done)|ready to (use|go|play|listen)|now (live|working|running)|give it a (play|listen|spin|whirl|read)|here'?s the (render|mp3|audio)|render (is )?(done|complete))/i;

// Negated/in-progress claims are NOT completion claims ("not done yet", "isn't
// fixed", "almost complete"). Blanked before claim detection.
const NEGATED_CLAIM_RE =
  /\b(not|isn'?t|aren'?t|won'?t|can'?t|cannot|never|almost|nearly|still (not )?)\s+(yet\s+)?\w{0,6}\s*(done|complete[d]?|fixed|verified|deployed|published|shipped|green|ready|live)/gi;

// In-progress language that a bare ✅ must not override.
const IN_PROGRESS_RE =
  /(not done|still (encoding|rendering|building|running|working|compiling|in progress)|in progress|not yet|\bwip\b|halfway|partway|mid-(render|build))/i;

// Quote-stripping (code fences, inline code, attributed relays, paths,
// questions, future/conditional) now lives in lib/transcript.mjs so this gate
// and qa-verdict-gate strip the SAME spans — see claimSearchText there.

// ── Claim domains (a claim can match several) ───────────────────────────────
const DOMAIN_RE = {
  render: /(\brender\b|\.mp3\b|\.wav\b|\baudio\b|podcast|narrat|aftercode|give it a (play|listen)|\btts\b|voice[- ]?over|\bmp3\b)/i,
  dashboard: /(dashboard|\bpanel\b|\.html\b|tailnet|https?:\/\/|web ?page|the site\b|click-?through|\bui\b)/i,
  deploy: /(pr #?\d+ merged|\bmerged\b|merged to (main|master)|\bdeployed\b|\brestarted\b|\.app\b|installed|\bbrew\b|\bcask\b|launchd|daemon|launchctl|service is (live|up|running)|is (now )?live\b)/i,
  build: /(build (is )?green|compiles|cargo (build|test)|swift build|contract|builds clean|tests? (are )?green)/i,
};

// ── Probe-evidence detectors ────────────────────────────────────────────────
// All run over the `ev` evidence object (cmd = Bash commands + tool names,
// out = tool_result outputs, all = both) — never assistant prose.
const FFPROBE_RE = /(ffprobe|ffmpeg -i)/i;
// Nonzero duration, INCLUDING sub-second (duration=0.5); rejects 0 / 0.000000.
const DURATION_OK_RE = /duration[^0-9]{0,12}(\d+\.\d*[1-9]|[1-9][0-9]*)/i;
const SIZE_OK_RE = /(\b[1-9][0-9,]*\s*(bytes|kb|kib|mb|mib)\b|size[^0-9]{0,8}[1-9])/i;

// HTTP-200: the probe is an HTTP call (curl/fetch, in a COMMAND) and a 200 status
// appears in the OUTPUT — or an inline "200 ok" in the output.
const DASHBOARD_200_INLINE_RE = /(\b200 ok\b|→\s*200\b|returns? 200\b|http.?code[\s\S]{0,40}\b200\b)/i;
const HTTP_PROBE_RE = /(http[_ ]?code|status[_ ]?code|\bcurl\b|\bwget\b|\bhttpie\b|http get|\bfetch\b)/i;
const STATUS_200_RE = /(^|[\s:=>"'])200(\b|$)/m;

// A real signed-in INTERACTION — not a bare navigation/screenshot, which is the
// screenshot-only workflow this gate exists to block (codex P1).
const CLICK_THROUGH_OUT_RE =
  /(click-?through|\bclicked\b|signed-?in[\s\S]{0,40}(click|interact)|play\(\)[\s\S]{0,40}currenttime|interact(ed|ion)? (with|as))/i;
const CLICK_THROUGH_CMD_RE = /(browser_click|\.click\(|page\.click|tap\(|press\()/i;

const STAMP_CHECK_RE =
  /(--version\b|cfbundleversion|gitcommit|buildtimeutc|info\.plist|version\.json|defaults read[\s\S]{0,40}(version|gitcommit))/i;
const STAMP_FRESH_RE =
  /(post-?dates|at or after|>=?\s*merge|matches (the )?merge( commit)?|built (from|at) [0-9a-f]{7,}|newer than the merge|after the merge commit)/i;
const STAMP_STALE_RE = /(stale|predates|older than|before the merge)/i;

// A live round-trip exercises the changed path. COMMAND-anchored (an actual
// probe was invoked) OR a SPECIFIC structured output token — NOT loose narrative
// words like "round-trip"/"verified" anywhere (cursor HIGH).
// A live round-trip exercises the RUNTIME. Bare unit tests (cargo/npm/bun/swift
// test) are deliberately NOT here — unit-green is not a live round-trip (codex P1;
// they only count as the operational entrypoint when named, below).
const LIVE_CMD_RE =
  /(\bpgrep\b|launchctl (print|list)|\bcurl\b[\s\S]{0,120}(health|\/health|localhost|127\.0\.0\.1|:\d{2,5}\/)|\/health\b|--dry-run\b|cargo run\b|\bsocket\b|brain_search\b|browser_click|\.\/[\w./-]+)/i;
const LIVE_OUT_RE =
  /(health 200 ok|\b200 ok\b|\.verified\b|\.mov\b|queue_depth[\s\S]{0,20}(drop|0)|round-?trip ok|exit 0|running,? pid)/i;

// The OPERATIONAL ENTRYPOINT for a build/contract claim — stricter than a live
// round-trip: bare unit tests (cargo/npm/bun test) do NOT count; only the wrapper
// dry-run, a named contract/integration/e2e test, or running the built artifact
// exercises the contract (cursor MEDIUM — unit-green ≠ contract-satisfied, R-035).
const ENTRYPOINT_CMD_RE =
  /(--dry-run\b|cargo test --test \w+|(integration|contract|e2e)[_ -]?test|\.\/[\w./-]+|swift test --filter|npm run (e2e|integration|contract)|playwright test)/i;
const ENTRYPOINT_OUT_RE =
  /(manifest valid|contract test result:?\s*ok|integration test (pass|ok|green)|e2e (pass|ok|green)|round-?trip ok|\.verified\b|\.mov\b|exit 0)/i;

const VOICE_REQUIRED_RE =
  /(2-?voice|two-?voice|cloned? voice|--reference|theo-c4|ben-c1|speaker 2)/i;
const VOICE_RESOLVED_RE =
  /((--reference|ref(erence)?[_ ]?audio)[\s\S]{0,40}(theo-c4s?|ben-c1))/i;
const VOICE_FALLBACK_RE =
  /(system tts|neutral reader|silent fallback|fallback to (system )?tts)/i;

const MANUAL_SUBSTITUTE_RE =
  /(rigorous(ly)? (manual )?verif|manually verified|verified (it )?manually|i (carefully|thoroughly) (verified|checked))/i;

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
  let hasBash = false;
  for (const ev of turn) {
    if (ev.role === "tool" && ev.text) out.push(ev.text);
    for (const t of ev.tools ?? []) {
      const name = t.name ?? "";
      cmd.push(name);
      if (baseName(name) === "Bash" && typeof t.input?.command === "string") {
        cmd.push(t.input.command);
        hasBash = true;
      }
    }
  }
  const cmdBlob = cmd.join("\n");
  const outBlob = out.join("\n");
  // hasBash gates OUTPUT-based success tokens: a passive tool's result (e.g. a
  // Read of a log containing "200 OK"/"exit 0") must not clear a probe when no
  // command actually ran in the turn (codex P1 — non-probe outputs).
  return { cmd: cmdBlob, out: outBlob, all: `${cmdBlob}\n${outBlob}`, hasBash };
}

// A browser/automation tool actually drove the page (needed for an output-side
// click-through token to count — not a passive result mentioning "clicked").
const BROWSER_RE = /(playwright|browser_|puppeteer|\bcdp\b|chromedriver|selenium)/i;

const ARTIFACT_PATH_RE = /([\w./-]+\.(?:mp3|wav|m4a|aac|flac|ogg))/gi;
// ffprobe must prove size>0 AND duration>0, AND — if the claim names a specific
// audio artifact — the ffprobe command must target THAT artifact, not some other
// file (codex P1: probing out/old.mp3 must not green a claim about out/new.mp3).
function ffprobeOk(ev, claimText = "") {
  if (!FFPROBE_RE.test(ev.cmd) || !DURATION_OK_RE.test(ev.all) || !SIZE_OK_RE.test(ev.all)) {
    return false;
  }
  const claimed = [...String(claimText).matchAll(ARTIFACT_PATH_RE)].map((m) => m[1]);
  if (claimed.length === 0) return true;
  return claimed.some((p) => ev.cmd.includes(p) || ev.cmd.includes(p.split("/").pop()));
}
function dashboard200(ev) {
  // An HTTP probe must actually have run (a 200 in some passive Read of a log
  // does not count, codex P1).
  return HTTP_PROBE_RE.test(ev.cmd) && (STATUS_200_RE.test(ev.out) || DASHBOARD_200_INLINE_RE.test(ev.out));
}
function clickThrough(ev) {
  // A click-through TOOL (browser_click/.click) in cmd, or a click-through token
  // in OUTPUT but only if a browser actually drove the page this turn.
  return CLICK_THROUGH_CMD_RE.test(ev.cmd) || (BROWSER_RE.test(ev.cmd) && CLICK_THROUGH_OUT_RE.test(ev.out));
}
function stampPostDatesMerge(ev) {
  return STAMP_CHECK_RE.test(ev.cmd) && STAMP_FRESH_RE.test(ev.out) && !STAMP_STALE_RE.test(ev.out);
}
// When the changed path IS the repo's ref state (branch moved, branch deleted,
// checkout switched), reading that state back in the SAME turn IS the live
// round-trip — there is no daemon to curl. Deliberately scoped to the GENERIC
// bucket only: a deploy claim still needs stamp+live, render still needs
// ffprobe, dashboard still needs 200+click-through, so this can never satisfy
// the `live` half of a deploy claim. Read-only plumbing verbs only — no `git
// commit`/`push`, which are the action, not the verification of it.
const GIT_STATE_PROBE_RE =
  /\bgit\s+(?:-C\s+\S+\s+)?(rev-parse|status|log|branch|worktree\s+list|cherry|show-ref|describe)\b/i;
function gitStateProbe(ev) {
  return GIT_STATE_PROBE_RE.test(ev.cmd);
}
function liveRoundTrip(ev) {
  // OUTPUT tokens (exit 0 / running pid / …) only count if a command ran this
  // turn, so a passive Read of a log can't supply them (codex P1).
  return LIVE_CMD_RE.test(ev.cmd) || (ev.hasBash && LIVE_OUT_RE.test(ev.out));
}
function operationalEntrypoint(ev) {
  return ENTRYPOINT_CMD_RE.test(ev.cmd) || (ev.hasBash && ENTRYPOINT_OUT_RE.test(ev.out));
}
function voiceResolved(ev) {
  return VOICE_RESOLVED_RE.test(ev.all) && !VOICE_FALLBACK_RE.test(ev.all);
}

// ── The detector ────────────────────────────────────────────────────────────
// detectFalseGreen(transcript) → {
//   verdict: "PASS" | "FLAG", claim, domains, violations: [{code, evidence}],
// }
export function detectFalseGreen(transcript) {
  const events = normalizeTranscript(transcript);
  const turn = currentTurn(events);
  const ev = buildEvidence(turn);
  // Claim AND evidence are both scoped to the CURRENT turn (cursor MEDIUM): if a
  // later human turn ("thanks") follows an already-probed "done", the current
  // turn has no claim, so we don't reuse the stale claim against an empty blob.
  const claimText = turn
    .filter((e) => e.role === "assistant")
    .map((e) => e.text ?? "")
    .join("\n");

  // No completion claim (after blanking negated/in-progress spans) → N/A. A bare
  // ✅ does NOT override explicit in-progress language (cursor MEDIUM: "✅ not done
  // yet — still encoding" must not FLAG): if the only claim signal is the
  // checkmark and the turn says it's in progress, it is not a completion claim.
  const searchableClaimText = claimSearchText(claimText);
  const declaimed = searchableClaimText.replace(NEGATED_CLAIM_RE, " ");
  if (!CLAIM_RE.test(declaimed)) {
    return { verdict: "PASS", claim: false, domains: [], violations: [] };
  }
  const onlyCheckmark = !CLAIM_RE.test(declaimed.replace(/✅/g, " "));
  if (onlyCheckmark && IN_PROGRESS_RE.test(claimText)) {
    return { verdict: "PASS", claim: false, domains: [], violations: [] };
  }

  // Domains read the SAME quote-stripped text as the claim (line above). Reading
  // raw `claimText` here let a fenced/backticked literal the assistant was merely
  // QUOTING — e.g. a commit subject "repair regressed render pipeline so
  // dashboards can publish" — select the render+dashboard domains and demand
  // ffprobe/HTTP-200/click-through for a pure `git branch` turn. Claim detection
  // was already quote-aware; domain selection was not (2026-08-06 misfire).
  const domains = Object.entries(DOMAIN_RE)
    .filter(([, re]) => re.test(searchableClaimText))
    .map(([d]) => d);

  const violations = [];
  const want = new Set();
  if (domains.includes("render")) want.add("ffprobe");
  if (domains.includes("dashboard")) { want.add("dash200"); want.add("click"); }
  if (domains.includes("deploy")) { want.add("stamp"); want.add("live"); }
  // build/contract ALWAYS requires the operational entrypoint, even when it
  // co-occurs with deploy (cursor HIGH: deploy must not skip the build entrypoint).
  if (domains.includes("build")) want.add("entrypoint");
  // generic done → at least one live probe
  const genericOnly = want.size === 0;
  if (genericOnly) want.add("live");

  if (want.has("ffprobe") && !ffprobeOk(ev, claimText)) {
    violations.push({ code: "FALSE_GREEN_FFPROBE", evidence: "render/audio claim without a same-turn ffprobe proving size>0 AND duration>0 on the claimed path." });
  }
  if (want.has("dash200") && !dashboard200(ev)) {
    violations.push({ code: "FALSE_GREEN_DASHBOARD_200", evidence: "dashboard claim without a same-turn HTTP 200 check on the served URL." });
  }
  if (want.has("click") && !clickThrough(ev)) {
    violations.push({ code: "FALSE_GREEN_CLICK_THROUGH", evidence: "dashboard claim without a same-turn signed-in click-through (HTTP 200 / a screenshot alone is not enough)." });
  }
  if (want.has("stamp") && !stampPostDatesMerge(ev)) {
    violations.push({ code: "FALSE_GREEN_STAMP", evidence: "deploy/merge claim without a same-turn build-stamp proving the served artifact POST-DATES the merge (merged ≠ deployed)." });
  }
  if (want.has("live") && !liveRoundTrip(ev) && !(genericOnly && gitStateProbe(ev))) {
    violations.push({ code: "FALSE_GREEN_LIVE_PROBE", evidence: "completion claim without a same-turn live round-trip exercising the changed path (build-green/unit-green is not contract-satisfied)." });
  }
  if (want.has("entrypoint") && !operationalEntrypoint(ev)) {
    violations.push({ code: "FALSE_GREEN_LIVE_PROBE", evidence: "build/contract claim without exercising the operational entrypoint (wrapper --dry-run / named contract|integration|e2e test / running the artifact) — bare unit tests are not contract-satisfied." });
  }
  // Voice-profile gate: a clone/2-voice render must resolve to a registered clone.
  if (domains.includes("render") && (VOICE_REQUIRED_RE.test(claimText) || VOICE_REQUIRED_RE.test(ev.cmd))) {
    if (!voiceResolved(ev)) {
      violations.push({ code: "FALSE_GREEN_VOICE", evidence: "cloned/2-voice render without --reference resolving to a registered clone (theo-c4/ben-c1) — silent system-TTS fallback is fail-open." });
    }
  }
  // Manual-verification prose substitute with NO probe at all → ranked last.
  const anyProbe =
    ffprobeOk(ev, claimText) || dashboard200(ev) || clickThrough(ev) ||
    stampPostDatesMerge(ev) || liveRoundTrip(ev) || operationalEntrypoint(ev);
  if (MANUAL_SUBSTITUTE_RE.test(claimText) && !anyProbe) {
    violations.push({ code: "MANUAL_SUBSTITUTE", evidence: "a 'rigorous manual verification' claim with no live-outcome probe in the turn — the manual fallback is false-green-permitting; run the automated probe." });
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
      ? `✅ false-green-gate PASS — claim live-probed (domains: ${result.domains.join(", ") || "generic"})`
      : "✅ false-green-gate PASS — no completion claim (N/A)";
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ false-green-gate FLAG — ${codes}\n${result.violations.map((v) => `  • ${v.code}: ${v.evidence}`).join("\n")}`;
}
