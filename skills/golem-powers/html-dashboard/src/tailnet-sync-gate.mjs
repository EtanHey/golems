// tailnet-sync-gate (gen-18 Track 2 #5) — the post-Write tailnet sync kill-gate.
//
// THE REGRESSION it closes: R-004 "why didn.t you publish the dashboard"
// (BROKEN-OPEN since gen-7). A worker Writes a dashboard to a local
// docs.local/*.html and claims "published / live / here's the dashboard" while
// the file never reaches the canonical tailnet hub — it orphans the dashboard
// where the user cannot find it. The standing law (global CLAUDE.md): every
// dashboard MUST land on the tailnet hub configured in TAILNET_HUB_HOST, by
// mirroring the HTML into
// $DASHBOARD_PUBLISH_ROOT/dashboards/<topic>/<name>.html
// (it auto-syncs) or running scripts/sync-tailnet-dashboards.mjs — AND an
// HTTP-200 check against the served URL before any "done/published/live" claim.
//
// THE GATE: if the CURRENT TURN contains (1) a dashboard Write — a Write tool
// whose file_path ends in .html under a docs/docs.local/dashboards path — AND
// (2) a publish/done/live claim, then the SAME TURN must ALSO carry:
//   (a) a MIRROR to the dashboards-serve path — a Write/cp/rsync targeting
//       dashboards-serve/dashboards/, or a run of sync-tailnet-dashboards.mjs;
//       missing → DASHBOARD_NOT_MIRRORED
//   (b) an HTTP-200 check against TAILNET_HUB_HOST — a curl/wget HTTP probe
//       (e.g. curl -w '%{http_code}') in a COMMAND whose OUTPUT shows 200;
//       missing → DASHBOARD_NOT_200
//
// Evidence comes ONLY from REAL tool execution — Bash COMMAND strings, tool
// NAMES, and tool_result OUTPUTS — never assistant narrative (the false-green-
// gate lesson: prose like "mirrored to the hub ✅" must NOT clear the gate; bots
// WILL flag a prose-bypass). DETERMINISTIC: same transcript in → same verdict
// out. No dashboard Write / no publish claim → PASS (N/A). The pinned RED/GREEN
// fixtures are the replayable gate (R-003/R-014 pattern).

import { normalizeTranscript, currentTurn } from "../lib/transcript.mjs";

// ── A publish / done / live claim ───────────────────────────────────────────
// The terminal-claim class this gate guards: "published / live / done / here's
// the dashboard / on the hub". Bare ✅ counts only alongside dashboard language
// (gated by the dashboard-Write requirement, so a stray ✅ elsewhere is inert).
const CLAIM_RE =
  /(\bpublished\b|\bdone\b|✅|\blive\b|now (live|up|available|on the hub)|on the (tailnet )?hub|here'?s the (dashboard|digest|status|report)|dashboard is (ready|live|up|published)|view it at|available at|you can (see|view|find) it (at|here)|posted to the hub)/i;

// Negated / in-progress claims are NOT completion claims ("not published yet",
// "isn't live", "still mirroring"). Blanked before claim detection.
const NEGATED_CLAIM_RE =
  /\b(not|isn'?t|aren'?t|won'?t|can'?t|cannot|never|almost|nearly|still|yet to|about to|going to|will)\s+(yet\s+)?\w{0,8}\s*(publish(ed|ing)?|live|done|up|available|on the hub|mirror(ed|ing)?)/gi;

// In-progress language a bare ✅ must not override.
const IN_PROGRESS_RE =
  /(not (yet )?(published|live|done|mirrored)|still (mirroring|syncing|publishing|writing|rendering)|in progress|not yet|\bwip\b|about to (mirror|publish|sync))/i;

// ── A dashboard Write ───────────────────────────────────────────────────────
// A Write tool whose file_path ends in .html AND lives under a
// docs/docs.local/dashboards path. We anchor on the Write tool input path, NOT
// prose, so "I wrote a dashboard" without a real Write does not arm the gate.
const DASHBOARD_PATH_RE = /(docs(\.local)?\/.*dashboard|dashboards[\w./-]*)[\w./-]*\.html$/i;
const HTML_PATH_RE = /\.html$/i;
const DASHBOARD_HINT_RE = /(dashboard|docs\.local|\/docs\/)/i;

// ── Mirror evidence ─────────────────────────────────────────────────────────
// A mirror to the canonical serve path: a Write/cp/rsync/sync TARGETING
// dashboards-serve/dashboards/, OR a run of sync-tailnet-dashboards.mjs.
const SERVE_PATH_RE = /dashboards-serve\/dashboards\//i;
const SYNC_SCRIPT_RE = /sync-tailnet-dashboards\.mjs/i;
const COPY_CMD_RE = /\b(cp|rsync|install|mv)\b/i;
const PUBLISH_TOOL_RE = /(publish_dashboard|publish_html|publish_modules)/i;

// ── HTTP-200 evidence ───────────────────────────────────────────────────────
// The tailnet host is deployment-specific and must come from gitignored env.
// A missing value fails closed: no probe can satisfy the gate accidentally.
function configuredTailnetHostRegex() {
  const host = process.env.TAILNET_HUB_HOST?.trim();
  if (!host) return null;
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|https?://)${escaped}([/:]|$)`, "i");
}
const TAILNET_HOST_ENV_RE = /\$TAILNET_HUB_HOST\b|\$\{TAILNET_HUB_HOST\}/;
const HTTP_PROBE_RE = /(http[_ ]?code|status[_ ]?code|\bcurl\b|\bwget\b|\bhttpie\b|http get|\bfetch\b)/i;
// A 200 status as a standalone token in OUTPUT, or an inline "→ 200 / returns 200".
const STATUS_200_RE = /(^|[\s:=>"'])200(\b|$)/m;
const STATUS_200_INLINE_RE = /(\b200 ok\b|→\s*200\b|returns? 200\b|http.?code[\s\S]{0,40}\b200\b|status[\s\S]{0,20}\b200\b)/i;

// Normalize an MCP tool name to its base
// (`mcp__agent-html-publisher__publish_dashboard` → `publish_dashboard`).
function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

function pathFromWrite(input) {
  if (!input || typeof input !== "object") return "";
  return String(input.file_path ?? input.path ?? input.filePath ?? "");
}

// Build the same-turn evidence from REAL execution only:
//   cmd  = tool NAMES + Bash COMMAND strings + Write target paths (executed
//          probes/mirrors)
//   out  = tool_result OUTPUTS (what probes returned)
//   writePaths = file_path of every Write tool this turn (mirror-target detection)
//   httpCmds = HTTP-probe COMMAND strings (so a 200 in the OUTPUT can only clear
//              the gate if the curl actually targeted the tailnet host)
// Assistant narrative is EXCLUDED, so prose cannot fake a mirror or a 200.
function buildEvidence(turn) {
  const cmd = [];
  const out = [];
  const toolNames = [];
  const writePaths = [];
  const httpCmds = [];
  let hasBash = false;
  for (const ev of turn) {
    if (ev.role === "tool" && ev.text) out.push(ev.text);
    for (const t of ev.tools ?? []) {
      const name = t.name ?? "";
      const base = baseName(name);
      toolNames.push(base);
      cmd.push(name);
      if (base === "Bash" && typeof t.input?.command === "string") {
        const c = t.input.command;
        cmd.push(c);
        hasBash = true;
        if (HTTP_PROBE_RE.test(c)) httpCmds.push(c);
      }
      if (base === "Write" || base === "MultiEdit" || base === "Edit") {
        const p = pathFromWrite(t.input);
        if (p) {
          writePaths.push(p);
          cmd.push(p); // the serve-path mirror may be a second Write
        }
      }
    }
  }
  const cmdBlob = cmd.join("\n");
  const outBlob = out.join("\n");
  return {
    cmd: cmdBlob,
    out: outBlob,
    all: `${cmdBlob}\n${outBlob}`,
    hasBash,
    toolNames,
    writePaths,
    httpCmds: httpCmds.join("\n"),
  };
}

// Did the turn perform a real dashboard Write? (Write/Edit tool → .html under a
// dashboard path.) Returns the matched path, or "".
function dashboardWritePath(ev) {
  for (const p of ev.writePaths) {
    if (DASHBOARD_PATH_RE.test(p)) return p;
    if (HTML_PATH_RE.test(p) && DASHBOARD_HINT_RE.test(p)) return p;
  }
  return "";
}

// Was the .html mirrored to the canonical serve path THIS turn?
//   - a Write whose file_path lands UNDER dashboards-serve/dashboards/, OR
//   - a cp/rsync/mv command whose text mentions the serve path, OR
//   - a run of sync-tailnet-dashboards.mjs, OR
//   - an agent-html-publisher publish_* tool (the MCP mirror path).
function mirrored(ev) {
  if (SYNC_SCRIPT_RE.test(ev.cmd)) return true;
  if (ev.toolNames.some((n) => PUBLISH_TOOL_RE.test(n))) return true;
  if (COPY_CMD_RE.test(ev.cmd) && SERVE_PATH_RE.test(ev.cmd)) return true;
  if (ev.writePaths.some((p) => SERVE_PATH_RE.test(p))) return true;
  return false;
}

// Did a real HTTP-200 check against the tailnet host run THIS turn? An HTTP probe
// COMMAND must (a) actually be a curl/wget/http call, (b) target the tailnet
// host, and (c) its OUTPUT must show a 200 status. A 200 in some passive Read,
// or a 200 with no host in the command, does NOT clear the gate.
function checked200(ev) {
  const hostRegex = configuredTailnetHostRegex();
  const probeHitsHost =
    Boolean(hostRegex && ev.httpCmds) &&
    (hostRegex.test(ev.httpCmds) || TAILNET_HOST_ENV_RE.test(ev.httpCmds));
  if (!probeHitsHost) return false;
  return STATUS_200_RE.test(ev.out) || STATUS_200_INLINE_RE.test(ev.out);
}

// ── The detector ────────────────────────────────────────────────────────────
// detectTailnetSync(transcript) → {
//   verdict: "PASS" | "FLAG", claim, dashboardWrite, violations: [{code,evidence}],
// }
export function detectTailnetSync(transcript) {
  const events = normalizeTranscript(transcript);
  const turn = currentTurn(events);
  const ev = buildEvidence(turn);

  // Did this turn actually Write a dashboard? No dashboard Write → N/A, PASS
  // (this gate only governs the post-Write sync; a non-dashboard turn is inert).
  const writePath = dashboardWritePath(ev);
  if (!writePath) {
    return { verdict: "PASS", claim: false, dashboardWrite: false, violations: [] };
  }

  // Is there a publish/done/live claim in the CURRENT turn (claim AND evidence
  // both scoped to the turn, so a later "thanks" turn doesn't reuse a stale
  // claim against an empty blob)?
  const claimText = turn
    .filter((e) => e.role === "assistant")
    .map((e) => e.text ?? "")
    .join("\n");
  const declaimed = claimText.replace(NEGATED_CLAIM_RE, " ");
  if (!CLAIM_RE.test(declaimed)) {
    return { verdict: "PASS", claim: false, dashboardWrite: true, violations: [] };
  }
  // A bare ✅ does NOT override explicit in-progress language ("✅ still mirroring").
  const onlyCheckmark = !CLAIM_RE.test(declaimed.replace(/✅/g, " "));
  if (onlyCheckmark && IN_PROGRESS_RE.test(claimText)) {
    return { verdict: "PASS", claim: false, dashboardWrite: true, violations: [] };
  }

  const violations = [];
  if (!mirrored(ev)) {
    violations.push({
      code: "DASHBOARD_NOT_MIRRORED",
      evidence:
        "dashboard Write + publish claim without a same-turn mirror to the canonical serve path (a Write/cp/rsync to dashboards-serve/dashboards/, a publish_dashboard tool, or a run of sync-tailnet-dashboards.mjs) — a local docs.local/*.html that never reaches the hub orphans the dashboard.",
    });
  }
  if (!checked200(ev)) {
    violations.push({
      code: "DASHBOARD_NOT_200",
      evidence:
        "dashboard Write + publish claim without a same-turn HTTP-200 check against the TAILNET_HUB_HOST deployment value (curl/wget '%{http_code}' returning 200 in the tool OUTPUT) — prose like 'live on the hub' is not evidence the served URL answers.",
    });
  }

  return {
    verdict: violations.length > 0 ? "FLAG" : "PASS",
    claim: true,
    dashboardWrite: true,
    violations,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") {
    if (!result.dashboardWrite) return "✅ tailnet-sync-gate PASS — no dashboard Write (N/A)";
    if (!result.claim) return "✅ tailnet-sync-gate PASS — dashboard Write, no publish claim (N/A)";
    return "✅ tailnet-sync-gate PASS — dashboard mirrored to the hub AND HTTP-200 verified";
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ tailnet-sync-gate FLAG — ${codes}\n${result.violations.map((v) => `  • ${v.code}: ${v.evidence}`).join("\n")}`;
}
