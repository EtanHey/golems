// qa-verdict-gate (gen-18 Track 2 #6) — the QA verdict-integrity kill-gate.
//
// THE REGRESSION it closes: R-024 LOST→BROKEN-OPEN ("v9 horrible" pre-merge QA)
// + R-035 self-QA-functional-not-mechanical. Kills the class where a QA worker
// emits a FAIL verdict the evidence does not support, OR claims "QA complete"
// with no terminal artifact. Specimens: a false-FAIL emitted when the regression
// path was never actually reached (codex 019ee5ea#1); a truncated QA run with no
// qa-report.md artifact (019ee493#2/#4).
//
// THE GATE: enforce tri-state PASS / FAIL / INCONCLUSIVE.
//   - FAIL is reserved for a CONFIRMED-OBSERVED failure — the same turn must
//     carry observed-failure evidence (a screenshot, a click that reached the
//     surface, an observed error in a tool_result). A FAIL with zero observed
//     evidence that the failing path was exercised → QA_FAIL_WITHOUT_OBSERVATION.
//   - INCONCLUSIVE is REQUIRED when the path could not be reached ("couldn't
//     load", "element not found", "blocked at step 0"). A FAIL/PASS verdict over
//     a transcript that shows the path was unreachable → QA_UNREACHED_NOT_INCONCLUSIVE.
//   - A QA "done/complete" claim with no qa-report.md written (containing all the
//     checklist items) → QA_NO_REPORT_ARTIFACT (terminal-artifact gate: a QA run
//     only counts when the report exists).
//
// Evidence comes ONLY from REAL execution — tool NAMES, Bash COMMAND strings, and
// tool_result OUTPUTS (observed screenshots/clicks/errors) — never assistant
// narrative (study false-green-gate's buildEvidence). DETERMINISTIC: same
// transcript in → same verdict out. The pinned RED/GREEN fixtures are the
// replayable gate (R-003/R-014 pattern).

import { normalizeTranscript, currentTurn, claimSearchText } from "../lib/transcript.mjs";

// ── A QA verdict in the turn ────────────────────────────────────────────────
// The agent's stated verdict. We read the explicit tri-state token first, then
// fall back to pass/fail language. INCONCLUSIVE includes its synonyms.
const VERDICT_FAIL_RE =
  /(\bverdict[:\s-]*fail\b|\bqa[:\s-]*fail\b|\bfail(ed|ing|s)?\b|❌|🔴|does ?n'?t work|is broken|regression (confirmed|found|present)|bug confirmed|this is broken)/i;
const VERDICT_PASS_RE =
  /(\bverdict[:\s-]*pass\b|\bqa[:\s-]*pass\b|\bpass(ed|es|ing)?\b|✅|🟢|works as expected|no (issues|regressions?|bugs?) found|all (checks?|items?) (pass|green)|looks good)/i;
const VERDICT_INCONCLUSIVE_RE =
  /(inconclusive|could ?n'?t (verify|reach|test|reproduce|confirm)|unable to (verify|reach|test|reproduce|confirm)|cannot (verify|reach|test|reproduce|confirm)|not (verifiable|reproducible|reachable)|\bblocked\b|unknown verdict|can'?t determine|undetermined)/i;

// A QA "done/complete" claim — triggers the terminal-artifact gate. Scoped to
// QA-completion phrasing (cursor MEDIUM, L260): a bare "done"/"step 1 done" or a
// lone "verdict" word must NOT count, or an in-progress reply would default
// qaVerdict to PASS and falsely trip QA_NO_REPORT_ARTIFACT. A settled verdict is
// recognized separately via the labeled-verdict / pass-fail-inconclusive
// detectors below — this regex only catches the "QA is complete" family.
// Did the USER actually ask for a QA run? One half of the qa-context guard below
// (the other half is: QA/browser tooling actually ran this turn).
const QA_REQUEST_RE =
  /\b(qa|smoke[- ]?test|test the (flow|app|page|ui|site)|check the (flow|app|page|ui|site)|checklist|walk through the (flow|app|ui)|regression (pass|test|run))\b/i;

const QA_DONE_RE =
  /(qa (is )?(done|complete[d]?|finished|wrapped)|(the )?qa round (is )?(done|complete[d]?|finished)|finished (the )?qa|all (the )?(checklist )?items? (are )?(checked|verified|covered|complete[d]?))/i;

// Etan decision-feeding answers ("is 17 mergeable?", "ready to ship?") need the
// visual evidence reference in the same terminal answer, so he can answer from
// that surface without chasing a separate dashboard/report.
const DECISION_PROMPT_RE =
  /\b(is|are|should|can|may|ok(?:ay)? to)\b.{0,80}\b(merge|mergeable|ship|shippable|release|ready|done|complete|pass|qa|verdict|decision)\b|\bwhat do i (answer|decide)\b|\bcan i (merge|ship|release)\b/i;
const DECISION_CLAIM_RE =
  /\b(mergeable|ready to (merge|ship|release|go|use)|ok(?:ay)? to (merge|ship|release)|ship(pable)?|release (ready|approved)|feeds? (an )?etan decision)\b/i;
const EMBEDDED_VISUAL_REF_RE =
  /\b(screenshot|screen ?shot|capture|image|\.png\b|\.jpe?g\b|qa[- ]?dashboard|dashboard row|visual evidence|rendered (page|screen|state|surface)|browser evidence)\b/i;

// A user-facing ready/PASS claim needs rendered state evidence, not merge/plumbing
// state. Keep the trigger explicit so ordinary code-only QA fixtures do not
// inherit a visual gate they did not claim.
const USER_VISIBLE_SURFACE_RE =
  /\b(user-facing|users?|dashboard|page|site|browser|ui|front[ -]?end|surface|screen|app|web|rendered|live view)\b/i;
const USER_VISIBLE_READY_RE =
  /\b(ready|done|complete[d]?|finished|pass(?:ed|es)?|works|looks good|no issues|mergeable|shippable|release ready)\b/i;
const RENDERED_PROBE_CMD_RE =
  /\b(curl|wget|httpie|browser_(take_)?screenshot|browser_snapshot|screencapture|page\.screenshot|\.screenshot\(|browser_click|browser_type|browser_press|browser_fill|page\.click|page\.fill|page\.type|page\.press|\.click\(|\.type\(|\.fill\()\b/i;
const RENDERED_PROBE_OUT_RE =
  /(screenshot (captured|saved|taken)|snapshot of the (page|screen)|\.png\b|\.jpe?g\b|rendered \d+ (cards?|elements?|rows?)|element (found|visible|clicked|typed)|\bHTTP\/\d(?:\.\d)?\s+2\d\d\b|\bstatus[:\s]+2\d\d\b|\b200 OK\b|page loaded|document ready|rendered (page|screen|state|surface))/i;

// An EXPLICIT labeled verdict line ("Verdict: INCONCLUSIVE", "verdict is FAIL") is
// AUTHORITATIVE — it overrides loose pass/fail words elsewhere in the prose (e.g.
// "neither PASS nor FAIL can be asserted" must not be read as a FAIL). Captures the
// labeled token; the surrounding "no issues found" narrative is ignored.
const LABELED_VERDICT_RE =
  /verdict\s*(?:is|:|-|—|=)?\s*\**\s*(inconclusive|fail(?:ed|ing|s)?|pass(?:ed|es|ing)?)/i;

function labeledVerdict(text) {
  const m = LABELED_VERDICT_RE.exec(String(text));
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v.startsWith("incon")) return "INCONCLUSIVE";
  if (v.startsWith("fail")) return "FAIL";
  if (v.startsWith("pass")) return "PASS";
  return null;
}

// Negated/in-progress — not a settled verdict/claim (blanked before detection).
const NEGATED_RE =
  /\b(not|isn'?t|aren'?t|won'?t|can'?t|cannot|never|almost|nearly|still (not )?)\s+(yet\s+)?\w{0,8}\s*(done|complete[d]?|finished|verified|pass(ed|es)?|fail(ed)?)/gi;
const IN_PROGRESS_RE =
  /(not done|still (running|testing|loading|clicking|navigating|in progress)|in progress|not yet|\bwip\b|halfway|partway|mid-(qa|test)|let me (keep|continue))/i;

// ── Unreachability signals (the path could not be exercised) ────────────────
// These appear in tool_result OUTPUTS (observed) — "the page never loaded", an
// element was not found, navigation was blocked at the first step. When the turn
// shows unreachability, the only honest verdict is INCONCLUSIVE.
const UNREACHED_OUT_RE =
  /(could ?n'?t load|couldn't load|failed to load|page (did ?n'?t|never) (load|render)|element not found|no such element|selector .* not found|timed? ?out (waiting|navigating|loading)?|navigation (failed|timeout|blocked)|blocked at step 0|err_(connection|name_not_resolved|aborted)|net::err|connection refused|502 bad gateway|503 service|404 not found|white ?screen|blank page|nothing rendered|0 elements|did ?n'?t reach|never reached|unable to navigate|stuck (on|at) (login|the )?(loading|spinner|step))/i;
// Same signal expressed in the assistant's OWN words — used ONLY to detect that
// the agent itself acknowledged unreachability, never as the FAIL-clearing
// observed-failure evidence (that must come from OUTPUTS).
const UNREACHED_PROSE_RE =
  /(could ?n'?t (load|reach|get to|open|render)|couldn't (load|reach|get to|open)|page never loaded|element (was )?not found|blocked at step 0|never (got|made it) (to|past)|stuck (on|at) (login|the )?(loading|loader|spinner)|did ?n'?t reach (the )?(page|screen|feature)|the (app|page|site) would ?n'?t (load|open))/i;

// ── Observed-failure evidence (what makes a FAIL legitimate) ────────────────
// A FAIL is only earned when the SAME TURN carries OBSERVED evidence that the
// failing path was actually EXERCISED: a real screenshot was captured, a click
// reached the surface, or an error was observed in a tool_result OUTPUT. These
// run over evidence (cmd = tool names + Bash commands, out = tool_result text),
// never over assistant prose.
//
// NOTE (cursor MEDIUM, L195): bare `browser_navigate`/`page.goto` is NOT here —
// merely OPENING a page does not exercise the failing flow, so a FAIL after only
// navigating must still be flagged. The failing-path probe is a SCREENSHOT
// capture or an INTERACTION (click/type/press), not a navigation.
const SCREENSHOT_CMD_RE =
  /(browser_(take_)?screenshot|browser_snapshot|screencapture\b|page\.screenshot|\.screenshot\(|take_screenshot|browser_click|browser_type|browser_press|browser_fill|page\.click|page\.fill|page\.type|page\.press|\.click\(|\.type\(|\.fill\(|tap\()/i;
const SCREENSHOT_OUT_RE =
  /(screenshot (captured|saved|taken)|snapshot of the (page|screen)|\.png\b|\.jpe?g\b|image captured|rendered \d+ (cards?|elements?|rows?)|element (found|visible|clicked|typed))/i;
// An OBSERVED error in a tool_result — the failing behavior the agent SAW.
const OBSERVED_ERROR_OUT_RE =
  /(error[:\s]|exception[:\s]|traceback|uncaught|throw(n|s)?\b|assert(ion)? (failed|error)|expected .* (but|got)|❌|test (failed|fail)|\bfailed\b|\bnull\b|undefined is not|cannot read (property|properties)|\bnan\b|status (4\d\d|5\d\d)\b|wrong (value|result|count)|mismatch|did not match|got \d+ expected \d+|button (does ?n'?t|did ?n'?t) (respond|work|fire))/i;
// A browser/automation tool actually drove the page — needed for an OUTPUT-side
// observed token to count (a passive Read mentioning "screenshot" is not a probe).
const BROWSER_RE = /(playwright|browser_|puppeteer|\bcdp\b|chromedriver|selenium|screencapture)/i;

// ── Terminal artifact: qa-report.md with all checklist items ────────────────
// The report must be WRITTEN this turn (a Write/Edit tool whose path is a
// qa-report.md, or a Bash command writing one) AND the written content must show
// the checklist items (multiple checked/unchecked items). An assistant merely
// SAYING "I wrote the report" is not enough — the tool call must carry it.
const REPORT_PATH_RE = /qa[-_]?report(\.[\w]+)?\.md\b/i;
const CHECKLIST_ITEM_RE = /(\[[ xX✓✗]\]|^\s*[-*]\s+\S|\bitem \d+\b|✅|❌|✔|✗)/gim;

// Normalize an MCP tool name to its base (mcp__cmuxlayer__send_to_agent → send_to_agent).
function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

// Build the same-turn evidence from REAL execution only:
//   cmd        = tool NAMES + Bash COMMAND strings (executed probes)
//   out        = tool_result OUTPUTS (what the probes observed)
//   reportText = the bodies of Write/Edit tool calls whose path is a qa-report.md
//                (+ Bash heredocs/redirects writing one) — the terminal artifact
//   hasBrowser = a browser/automation tool actually drove a surface this turn
// Assistant narrative is excluded, so prose can never fake a probe or an artifact.
function buildEvidence(turn) {
  const cmd = [];
  const out = [];
  const reportPieces = [];
  let hasBash = false;
  let hasBrowser = false;
  let wroteReport = false;

  for (const ev of turn) {
    if (ev.role === "tool" && ev.text) out.push(ev.text);
    for (const t of ev.tools ?? []) {
      const name = t.name ?? "";
      const base = baseName(name);
      cmd.push(name);
      if (BROWSER_RE.test(name)) hasBrowser = true;

      if (base === "Bash" && typeof t.input?.command === "string") {
        const command = t.input.command;
        cmd.push(command);
        hasBash = true;
        // A Bash command writing a qa-report.md (heredoc / redirect / tee).
        if (REPORT_PATH_RE.test(command) && /(>>?|tee|cat\s*<<|printf|echo)/i.test(command)) {
          wroteReport = true;
          reportPieces.push(command);
        }
      }

      // Write/Edit/MultiEdit whose target path is a qa-report.md.
      if (
        (base === "Write" || base === "Edit" || base === "MultiEdit") &&
        typeof t.input?.file_path === "string" &&
        REPORT_PATH_RE.test(t.input.file_path)
      ) {
        wroteReport = true;
        const body =
          (typeof t.input.content === "string" && t.input.content) ||
          (typeof t.input.new_string === "string" && t.input.new_string) ||
          "";
        if (body) reportPieces.push(body);
      }
    }
  }

  const cmdBlob = cmd.join("\n");
  const outBlob = out.join("\n");
  const reportText = reportPieces.join("\n");
  return {
    cmd: cmdBlob,
    out: outBlob,
    all: `${cmdBlob}\n${outBlob}`,
    reportText,
    hasBash,
    hasBrowser,
    wroteReport,
  };
}

// A real screenshot/click that reached the surface — a screenshot/browser TOOL in
// cmd, OR an output token confirming a render/click but only if a browser drove
// the page this turn (a passive Read mentioning "screenshot" does not count).
function reachedSurface(ev) {
  return (
    SCREENSHOT_CMD_RE.test(ev.cmd) ||
    (ev.hasBrowser && SCREENSHOT_OUT_RE.test(ev.out))
  );
}
// An error the agent actually OBSERVED in a tool_result (not prose). Gated on a
// command having run this turn, so a passive Read of an old log can't supply it.
function observedError(ev) {
  return ev.hasBash || ev.hasBrowser ? OBSERVED_ERROR_OUT_RE.test(ev.out) : false;
}
// A FAIL is legitimate only with observed evidence the failing path was reached:
// either the surface was reached (screenshot/click) OR an error was observed.
function failObserved(ev) {
  return reachedSurface(ev) || observedError(ev);
}
// The transcript shows the path could not be reached: an unreachability token in
// a tool_result OUTPUT, OR the agent itself acknowledged unreachability in prose.
function pathUnreached(ev, claimText) {
  return UNREACHED_OUT_RE.test(ev.out) || UNREACHED_PROSE_RE.test(String(claimText));
}
// The terminal artifact exists: a qa-report.md was actually WRITTEN this turn AND
// its content carries the checklist (≥2 items — a stub with a single line is not
// a real report).
function reportArtifactOk(ev) {
  if (!ev.wroteReport) return false;
  const items = String(ev.reportText).match(CHECKLIST_ITEM_RE) || [];
  return items.length >= 2;
}

function lastUserText(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].role === "user") return events[i].text ?? "";
  }
  return "";
}

function terminalAssistantText(turn) {
  for (let i = turn.length - 1; i >= 0; i--) {
    if (turn[i].role === "assistant") return turn[i].text ?? "";
  }
  return "";
}

function hasRenderedUserVisibleEvidence(ev) {
  return (
    reachedSurface(ev) ||
    (RENDERED_PROBE_CMD_RE.test(ev.cmd) && RENDERED_PROBE_OUT_RE.test(ev.out))
  );
}

// ── The detector ────────────────────────────────────────────────────────────
// detectQaVerdict(transcript) → {
//   verdict: "PASS" | "FLAG", claim, qaVerdict, violations: [{code, evidence}],
// }
// (verdict = the GATE's pass/flag; qaVerdict = the AGENT's stated QA verdict.)
export function detectQaVerdict(transcript) {
  const events = normalizeTranscript(transcript);
  const turn = currentTurn(events);
  const ev = buildEvidence(turn);

  const claimText = turn
    .filter((e) => e.role === "assistant")
    .map((e) => e.text ?? "")
    .join("\n");
  const terminalClaim = terminalAssistantText(turn);
  const lastUser = lastUserText(events);
  const decisionContext = `${lastUser}\n${terminalClaim}`;

  // Blank quoted/code/question spans, THEN negated/in-progress spans, before any
  // verdict/claim detection. Without the quote-strip this gate read backticked
  // and fenced text as the assistant's own QA verdict — a quoted commit subject
  // was enough to demand a qa-report.md (2026-08-06 misfire). false-green-gate
  // already stripped these spans; this gate did not.
  const declaimed = claimSearchText(claimText).replace(NEGATED_RE, " ");

  // The agent's stated QA verdict (tri-state). INCONCLUSIVE is detected
  // independently so "couldn't verify, calling it FAIL" reads as the
  // contradiction the unreached branch catches.
  const saysInconclusive = VERDICT_INCONCLUSIVE_RE.test(declaimed);
  const saysFail = VERDICT_FAIL_RE.test(declaimed);
  const saysPass = VERDICT_PASS_RE.test(declaimed);
  // An explicit "Verdict: X" line is authoritative when present.
  const labeled = labeledVerdict(declaimed);

  // Is there any QA completion claim at all (settled verdict OR "qa done")?
  const onlyCheckmark = !QA_DONE_RE.test(declaimed.replace(/✅/g, " ")) && /✅/.test(declaimed);
  // The LOOSE verdict words (bare `pass`, `blocked`, `looks good`, ✅) only count
  // as a QA verdict inside an actual QA CONTEXT. Without this, ordinary prose
  // reporting on non-QA work — "the hook blocked it", "39 pass / 0 fail" — set
  // saysInconclusive/saysPass and demanded a qa-report.md from a turn that never
  // ran QA (2026-08-06 misfire). EXPLICIT signals ("Verdict: X", "QA is done")
  // stay unconditional: those are unambiguous regardless of context.
  const qaContext =
    ev.hasBrowser || QA_REQUEST_RE.test(lastUser) || QA_DONE_RE.test(declaimed) || labeled != null;
  let qaDone =
    QA_DONE_RE.test(declaimed) ||
    labeled != null ||
    (qaContext && (saysFail || saysPass || saysInconclusive));
  if (onlyCheckmark && IN_PROGRESS_RE.test(claimText)) qaDone = false;
  if (IN_PROGRESS_RE.test(claimText) && !saysFail && !saysPass && !saysInconclusive && labeled == null) {
    qaDone = false;
  }

  if (!qaDone) {
    return { verdict: "PASS", claim: false, qaVerdict: null, violations: [] };
  }

  // Settle the stated verdict. An explicit labeled verdict wins; otherwise fall
  // back to the loose pass/fail/inconclusive language. FAIL and PASS are
  // "settled"; INCONCLUSIVE is the honest middle.
  let qaVerdict;
  if (labeled != null) {
    qaVerdict = labeled;
  } else if (saysFail && !saysInconclusive) qaVerdict = "FAIL";
  else if (saysInconclusive && !saysFail && !saysPass) qaVerdict = "INCONCLUSIVE";
  else if (saysFail && saysInconclusive) qaVerdict = "FAIL"; // contradiction → caught below
  else if (saysPass) qaVerdict = "PASS";
  else qaVerdict = "PASS";

  const violations = [];
  const unreached = pathUnreached(ev, claimText);

  // 1. QA_UNREACHED_NOT_INCONCLUSIVE — the path couldn't be reached but the
  //    verdict is FAIL or PASS instead of INCONCLUSIVE. (Highest priority: an
  //    unreachable path can't be honestly PASS or FAIL.)
  if (unreached && (qaVerdict === "FAIL" || qaVerdict === "PASS")) {
    violations.push({
      code: "QA_UNREACHED_NOT_INCONCLUSIVE",
      evidence:
        "the transcript shows the regression path could not be reached (couldn't load / element not found / blocked at step 0), but the verdict is " +
        qaVerdict +
        " — an unreached path must be INCONCLUSIVE, not a confirmed verdict.",
    });
  }

  // 2. QA_FAIL_WITHOUT_OBSERVATION — a FAIL with no same-turn observed evidence
  //    the failing path was actually exercised (no screenshot/click/observed
  //    error). Only raised when the path was NOT already flagged as unreached
  //    (that case is covered by #1; this one is the reach-but-no-evidence false
  //    FAIL, codex 019ee5ea#1).
  if (qaVerdict === "FAIL" && !unreached && !failObserved(ev)) {
    violations.push({
      code: "QA_FAIL_WITHOUT_OBSERVATION",
      evidence:
        "a FAIL verdict with no same-turn observed-failure evidence (no screenshot, no click that reached the surface, no observed error in a tool_result) — the failing path was not shown to be exercised, so this should be INCONCLUSIVE.",
    });
  }

  // 3. QA_NO_REPORT_ARTIFACT — a QA done/complete claim with no qa-report.md
  //    written carrying the checklist items (terminal-artifact gate, 019ee493#2/#4).
  if (!reportArtifactOk(ev)) {
    violations.push({
      code: "QA_NO_REPORT_ARTIFACT",
      evidence:
        "a QA 'done/complete' claim with no qa-report.md written this turn containing the checklist items — a QA run only counts when the terminal report artifact exists.",
    });
  }

  // 4. QA_DECISION_CLAIM_NO_VISUAL_EVIDENCE — if the terminal answer feeds an
  //    Etan merge/ship/QA decision, it must carry the visual evidence reference
  //    in that same answer, not only somewhere earlier in the transcript.
  if (
    (DECISION_PROMPT_RE.test(lastUser) || DECISION_CLAIM_RE.test(terminalClaim)) &&
    (qaVerdict === "PASS" || qaVerdict === "FAIL" || qaVerdict === "INCONCLUSIVE") &&
    !EMBEDDED_VISUAL_REF_RE.test(terminalClaim)
  ) {
    violations.push({
      code: "QA_DECISION_CLAIM_NO_VISUAL_EVIDENCE",
      evidence:
        "the terminal QA/completion answer feeds an Etan decision but does not embed a screenshot/dashboard/rendered-state reference in the same claim.",
    });
  }

  // 5. QA_USER_VISIBLE_WITHOUT_RENDERED_EVIDENCE — a ready/PASS claim about a
  //    user-facing surface cannot be earned by merge/plumbing state alone.
  if (
    qaVerdict === "PASS" &&
    USER_VISIBLE_SURFACE_RE.test(decisionContext) &&
    USER_VISIBLE_READY_RE.test(terminalClaim) &&
    !hasRenderedUserVisibleEvidence(ev)
  ) {
    violations.push({
      code: "QA_USER_VISIBLE_WITHOUT_RENDERED_EVIDENCE",
      evidence:
        "a ready/PASS verdict about a user-facing surface has no same-turn rendered page, screenshot, click, or HTTP 2xx probe evidence; merge/plumbing state is not user-visible reality.",
    });
  }

  return {
    verdict: violations.length > 0 ? "FLAG" : "PASS",
    claim: true,
    qaVerdict,
    violations,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") {
    return result.claim
      ? `✅ qa-verdict-gate PASS — verdict matches the observed evidence and the qa-report.md artifact exists (verdict: ${result.qaVerdict})`
      : "✅ qa-verdict-gate PASS — no settled QA verdict/claim (N/A)";
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ qa-verdict-gate FLAG — ${codes}\n${result.violations.map((v) => `  • ${v.code}: ${v.evidence}`).join("\n")}`;
}
