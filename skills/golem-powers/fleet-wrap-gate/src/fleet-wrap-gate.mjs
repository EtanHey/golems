// fleet-wrap-gate (gen-18 Track 1 #6) — the fleet-wrap terminal-state cron-count gate.
//
// THE VIOLATION it closes: the fleet-wrap law (`/fleet-wrap` SKILL) — "when the
// fleet wraps: ZERO polling crons, ONE final dashboard + ONE message, then
// SILENT." The RED specimen is the gen-10 dawn incident (verbatim, red-team
// verified): Etan at dawn — "Why were you just listing my messages in WhatsApp
// the whole night? Why didn't you stop?" A status/health-watch cron was left
// firing all night after the fleet had effectively wrapped. MEMORY pins this as
// two imp-10 ledger rows (health-watch cron left firing all night).
//
// THE GATE: once a transcript reaches a TERMINAL / stand-down state (fleet wrap,
// sprint close, "back to silent", "only an Etan decision pending", "all work
// merged"), cron-count MUST == 0. There must be NO live CronCreate / `/loop` /
// background health-watch / `sleep`-poll loop left armed for this fleet. If a
// cron/loop/monitor is still armed at terminal state AND it was not cleared
// (CronDelete / "cleared all crons" / cron-count=0), that is `FLEET_WRAP_CRON_NONZERO`.
//
// THE ONE ALLOWED EXCEPTION (monitor-law): a SINGLE persistent INBOUND collab
// monitor the agent keeps for "standing by" (waiting for Etan / an inbound
// message) is allowed. What is banned is health-watch / status-poll crons,
// `/loop` poll timers, and redundant fleet-monitor loops at terminal state.
//
// Evidence comes ONLY from REAL execution — tool_use NAMES (CronCreate /
// CronDelete) and Bash COMMAND strings (`sleep`, `/loop`, poll loops) — plus the
// agent's own explicit "cleared all crons / cron-count=0" attestation. The
// terminal-state markers come from assistant narrative (that IS the stand-down
// signal). DETERMINISTIC: same transcript in → same verdict out. The pinned
// RED/GREEN fixtures are the replayable gate (R-003/R-014 pattern).
//
// COMPLEMENTS — NOT duplicates — Track 6 D4 (PR #523) frustration-capture
// Stage-A `_FLEET_TICK_OPENER` / orchestrator-monitor `_HARNESS_MARKERS`, which
// filter INBOUND scheduled_task_fire/cron PROMPTS by sender-identity so a cron
// tick is not misread as an Etan correction. That gate is about reading cron
// prompts; THIS gate is about whether a cron is still ARMED at fleet-wrap.

import { eligibleReportPath } from "../lib/report-reader.mjs";
import { isGhPrMerge, parseShell, writeTargets, writtenText } from "../lib/shell-commands.mjs";
import { normalizeTranscript, currentTurn } from "../lib/transcript.mjs";
import { isReadOnlyEventWatch } from "../lib/event-watch.mjs";

// ── Terminal / stand-down state ─────────────────────────────────────────────
// The markers that say "the fleet has wrapped / is standing down / the work is
// done and only an Etan decision remains." Drawn verbatim from /fleet-wrap and
// the brief's terminal-state list.
const TERMINAL_RE =
  /(fleet[- ]?wrap(ped|ping)?|stand(ing)?[- ]?down|back to silent|going silent|sprint clos(e|ed|ing)|sprint is (closed|done|wrapped)|wrap(ping)? (the )?fleet|all work (is )?merged|work (is )?complete|work (is )?done|\bDONE\b|all crons cleared|only an etan decision (is )?(pending|remains)|nothing (is )?(left )?queued|the channel goes quiet)/i;

// FP guard: talking about the rule/gate/docctrine is not the same as actually
// declaring a terminal state for this seat.
const DISCUSSION_RE =
  /\b(discuss|discussion|design|doctrine|rule|gate|skill|fixture|test|eval|should|would|proposal|contract)\b/i;
const WORKER_SEAT_RE =
  /\b(worker|lane|seat|W\d+|assigned file|assigned task|reporting to the lead)\b/i;
const NEGATED_TERMINAL_RE =
  /\bnot (a )?(fleet[- ]?wrap|wrap|stand[- ]?down|terminal|sprint close)|not .{0,200}?(fleet[- ]?wrap|stand[- ]?down)/i;

// Explicitly NON-terminal: a mid-sprint turn is N/A even if it arms a cron.
// "still working", "mid-sprint", "more work queued", "kicking off" etc.
const NON_TERMINAL_RE =
  /(mid-?sprint|still (working|running|in progress|driving|encoding|building)|more work (is )?queued|work remains|kicking off|just getting started|sprint (is )?(open|underway|in progress)|next up|continuing to)/i;

// ── Cron / loop ARMING (a still-live poller) ────────────────────────────────
// Tool NAMES that arm a recurring cron/schedule.
const CRON_CREATE_TOOL_RE =
  /(croncreate|cron_create|schedulecreate|schedule_create|createcron|tasksschedule|scheduletask|schedule_task|scheduled_task_create|schedulewakeup|schedule_wakeup)/i;
// Bash / command markers that arm a poll loop or a recurring timer.
//   - `/loop` slash command (a recurring tick)
//   - `sleep N` inside a `while`/`until`/`for ... seq` poll loop, or `sleep && <recheck>`
//   - a backgrounded `sleep`-poll heartbeat (nohup ... sleep)
// The `for … in $(seq` arm matches ANY loop variable, not just `i` (codex P2:
// `for attempt in $(seq 1 200)` must also be caught).
const LOOP_CMD_RE =
  /(\/loop\b|while\s+true|until\s+\[|for\s+[A-Za-z_][\w]*\s+in\s+\$\(seq|watch\s+-n|\bsleep\s+\d+\b[\s\S]{0,40}(curl|gh api|brain_search|status|health|&&|;)|nohup[\s\S]{0,40}sleep)/i;
// Unambiguous loop admissions in NARRATIVE prose — a `/loop`, a `while true`/
// `until [` loop, or "poll(ing) loop running/armed/alive" admitted in text but
// not visible as a tool/Bash command (cursor MEDIUM: narrative slash-loop). Kept
// narrow so ordinary prose ("sleep on it", "loop back later") does not match.
const NARRATIVE_LOOP_RE =
  /(\/loop\b|while\s+true|until\s+\[|poll(?:ing)? (?:loop|timer)s?\s+(?:still\s+)?(?:running|armed|alive|active|up)|(?:still\s+)?(?:running|armed|alive)\s+poll(?:ing)? (?:loop|timer)s?)/i;
// Health-watch / status-poll / heartbeat phrasings that name a still-armed loop.
const HEALTH_WATCH_RE =
  /(health[- ]?watch|status[- ]?poll|heartbeat (cron|loop|timer)|fleet[- ]?monitor (cron|loop|tick|timer)|monitor(ing)? cron|all[- ]?night (health|status|watch)|polling (cron|loop|timer)|keep[- ]?alive (poll|loop))/i;

// ── Cron CLEARING (the pass condition) ──────────────────────────────────────
// Tool NAMES that delete/stop a cron, and the agent's explicit attestation that
// every cron is cleared (cron-count == 0).
const CRON_DELETE_TOOL_RE =
  /(crondelete|cron_delete|scheduledelete|schedule_delete|deletecron|cancelcron|taskstop|task_stop|stop_agent|stopagent|crondisable|cron_disable)/i;
const CLEARED_RE =
  /(cleared (all )?(the )?crons|all crons cleared|cron[- ]?count\s*[=:]?\s*0|no (live |active |polling )?crons (left|remain|armed|running)|no (polling |status )?crons\b|zero (polling )?crons|killed (all )?(the )?(crons|monitors)|stopped (all )?(my )?(crons|monitors|loops)|deleted (all )?(the )?crons|no crons remain|all monitors stopped|crons?\s*[=:]\s*0)/i;
// Global variant for blanking ALL clearing-phrase spans before the terminal test
// (so "cleared old crons … more work queued" doesn't read as a stand-down).
const CLEARED_RE_G = new RegExp(CLEARED_RE.source, "gi");

// A NEGATED cron/loop/health-watch mention is an attestation of absence, NOT an
// arming — "no polling crons", "zero health-watch", "without a status poll". It
// must be blanked before the arming detector runs so a "No polling crons left"
// disclaimer does not read as a still-armed poller (the inverse of the disguised-
// monitor evasion). Only blanks the NEGATED span; a live "health-watch" elsewhere
// in the same turn still arms.
const NEGATED_CRON_RE =
  /\b(no|zero|without|never|aren'?t|isn'?t|won'?t|stopped|killed|cleared|deleted|cancell?ed|disabled)\s+(any\s+|the\s+|all\s+|a\s+|my\s+)?(more\s+)?(live\s+|active\s+|polling\s+|status\s+|background\s+)?(health[- ]?watch|status[- ]?poll|polling (?:cron|loop|timer)s?|heartbeat (?:cron|loop|timer)s?|monitor(?:ing)? crons?|fleet[- ]?monitor (?:cron|loop|tick|timer)s?|crons?|loops?|poll(?:ing|ers?)?)/gi;

// ── The ONE allowed inbound monitor (monitor-law exception) ─────────────────
// A single persistent INBOUND collab/standby monitor is allowed. It is
// recognized by inbound/standby phrasing — NOT by health/status/poll phrasing.
const INBOUND_MONITOR_RE =
  /(inbound (collab )?monitor|standing by (for|on)|await(ing)? (an? )?(inbound|etan|reply|message|approval|decision)|one (inbound|collab) monitor|listen(ing)? for (an? )?(inbound|reply|etan)|watch(ing)? the inbox|inbound[- ]?only monitor|relay (any )?(an? )?(etan|inbound) (message|reply))/i;

// A GENERIC recurring-job payload — a CronCreate whose payload names work that is
// NOT a standby inbound listener (digest / driver / poll / scrape / report / sync
// / sweep / refresh / tick / check / build). If the prose claims "one inbound
// monitor" but the cron payload is one of these, the claim/payload mismatch is
// not excused by the monitor-law (cursor HIGH: "Inbound monitor excuse ignores
// payload").
const GENERIC_JOB_PAYLOAD_RE =
  /(digest|driver|drive (the )?queue|scrape|scraper|report|sync|sweep|refresh|\btick\b|\bcheck\b|\bbuild\b|\bdeploy\b|\bpoll\b|status|health|heartbeat|fleet[- ]?monitor|recurring|every \d|cron job|scheduled (job|task|run))/i;

const ACTIVE_STATUS_RE =
  /^(active|alive|armed|enabled|in[-_ ]?progress|pending|running|scheduled|started|up)$/i;
const INACTIVE_STATUS_RE =
  /^(cancelled|canceled|complete|completed|deleted|disabled|done|failed|finished|inactive|stopped|success)$/i;

// Normalize an MCP tool name to its base (`mcp__cmuxlayer__CronCreate` → `CronCreate`).
function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

// The CronCreate input fields that can carry the job's intent (prompt / schedule
// / command). A health-watch armed as `CronCreate({prompt:"health watch poll"})`
// hides its nature in the payload, not the narrative — so the payload is scanned
// for poller markers too (cursor MEDIUM: "Poll prompt bypasses inbound excuse").
const CRON_PAYLOAD_KEYS = ["prompt", "command", "cmd", "schedule", "task", "name", "title", "message"];

function cronPayloadText(input) {
  if (!input || typeof input !== "object") return "";
  return CRON_PAYLOAD_KEYS.map((k) => (typeof input[k] === "string" ? input[k] : ""))
    .filter(Boolean)
    .join(" ");
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function recordText(record) {
  if (!record || typeof record !== "object") return "";
  const parts = [];
  for (const key of [
    "id",
    "kind",
    "type",
    "name",
    "title",
    "subject",
    "description",
    "activeForm",
    "prompt",
    "message",
    "command",
    "cmd",
    "schedule",
    "status",
  ]) {
    if (typeof record[key] === "string") parts.push(record[key]);
  }
  return parts.join(" ");
}

function recordId(record, fallback) {
  if (!record || typeof record !== "object") return fallback;
  return String(record.id ?? record.task_id ?? record.taskId ?? record.name ?? fallback);
}

function isActiveRecord(record) {
  const status = String(record?.status ?? record?.state ?? "");
  if (!status) return record?.active !== false && record?.enabled !== false;
  if (INACTIVE_STATUS_RE.test(status)) return false;
  if (ACTIVE_STATUS_RE.test(status)) return true;
  return record?.active === true || record?.enabled === true;
}

function isInboundRecord(record) {
  const text = recordText(record);
  const kind = String(record?.kind ?? record?.type ?? "");
  return (
    /inbound[_ -]?monitor|collab[_ -]?monitor/i.test(kind) ||
    (INBOUND_MONITOR_RE.test(text) && !HEALTH_WATCH_RE.test(text) && !LOOP_CMD_RE.test(text))
  );
}

function isLoopRecord(record) {
  const text = recordText(record);
  const kind = String(record?.kind ?? record?.type ?? "");
  return /loop|poller|timer/i.test(kind) || LOOP_CMD_RE.test(text) || NARRATIVE_LOOP_RE.test(text);
}

function isCronRecord(record, source) {
  const text = recordText(record);
  const kind = String(record?.kind ?? record?.type ?? "");
  if (source === "tasks") {
    return (
      /cron|schedule|scheduled_task|periodic|recurring/i.test(kind) ||
      typeof record?.schedule === "string" ||
      record?.cron === true ||
      record?.recurring === true
    );
  }
  return (
    /cron|schedule|scheduled_task|periodic|recurring/i.test(kind) ||
    typeof record?.schedule === "string" ||
    HEALTH_WATCH_RE.test(text) ||
    GENERIC_JOB_PAYLOAD_RE.test(text)
  );
}

function durableStateFrom(transcript, options) {
  if (options?.state && typeof options.state === "object") return options.state;
  if (transcript && typeof transcript === "object" && !Array.isArray(transcript) && transcript.state) {
    return transcript.state;
  }
  return null;
}

function liveStateEntries(state, sessionId) {
  const liveCrons = [];
  const liveLoops = [];
  const inboundMonitors = [];

  const ingest = (records, source) => {
    for (const [idx, record] of records.entries()) {
      if (!record || typeof record !== "object" || !isActiveRecord(record)) continue;
      const ownerSession = record.session_id ?? record.sessionId ?? record.owner_session ?? record.ownerSession;
      if (
        sessionId &&
        (record.owned_by_current_session === false ||
          (typeof ownerSession === "string" && ownerSession && ownerSession !== sessionId))
      ) {
        continue;
      }
      const entry = {
        id: recordId(record, `${source}-${idx + 1}`),
        source,
        text: recordText(record),
        record,
      };
      // A task registry can retain the actual Bash input. Only that complete
      // execution shape can establish the exemption, never a description.
      if (source === "tasks" && !isCronRecord(record, source) && isReadOnlyEventWatch(record)) continue;
      if (isInboundRecord(record)) {
        inboundMonitors.push(entry);
        continue;
      }
      if (source === "loops" || isLoopRecord(record)) {
        liveLoops.push(entry);
        continue;
      }
      if (source === "crons" || isCronRecord(record, source)) {
        liveCrons.push(entry);
      }
    }
  };

  ingest(arrayFrom(state?.crons ?? state?.cronRegistry ?? state?.cron_registry), "crons");
  ingest(arrayFrom(state?.loops ?? state?.loopRegistry ?? state?.loop_registry), "loops");
  ingest(arrayFrom(state?.monitors ?? state?.inboundMonitors ?? state?.inbound_monitors), "monitors");
  ingest(arrayFrom(state?.tasks ?? state?.scheduledTasks ?? state?.scheduled_tasks), "tasks");

  return { liveCrons, liveLoops, inboundMonitors };
}

function cleanupList(prefix, ids) {
  return ids.map((id) => `${prefix} ${id}`).join("; ");
}

function cronViolation(ids, evidence) {
  return {
    code: "FLEETWRAP_CRON_ALIVE",
    ids,
    action: cleanupList("delete cron", ids),
    evidence,
  };
}

function loopViolation(ids, evidence) {
  return {
    code: "FLEETWRAP_LOOP_ALIVE",
    ids,
    action: cleanupList("TaskStop", ids),
    evidence,
  };
}

// Build the same-turn arming/clearing evidence from REAL execution only:
//   armedTools  = tool NAMES that armed a cron (CronCreate)
//   armedCount  = how many cron-arming tools ran (the monitor-law allows ONE)
//   cronPayload = CronCreate input payloads (prompt/schedule/command) — a poller
//                 hidden in the payload is still a poller
//   clearTools  = tool NAMES that deleted a cron (CronDelete/TaskStop)
//   cmdBlob     = Bash COMMANDs that armed a loop (`sleep`/`/loop`/poll loop)
//   text        = assistant narrative + tool_result outputs since the last human
//                 turn (terminal markers + cron-count=0 attestations live here)
// Non-Bash, non-cron tool input bodies (file_path, url, …) are excluded so an
// incidental "sleep" in a filename or a "/loop" in some unrelated doc path cannot
// fake an armed cron.
function buildEvidence(turn) {
  const armedTools = [];
  const clearTools = [];
  const armedCmds = [];
  const cronPayloads = [];
  const narrative = [];
  let armedCount = 0;
  for (const ev of turn) {
    if (ev.role === "assistant" && ev.text) narrative.push(ev.text);
    if (ev.role === "tool" && ev.text) narrative.push(ev.text);
    for (const t of ev.tools ?? []) {
      const name = baseName(t.name ?? "");
      if (CRON_CREATE_TOOL_RE.test(name) && !(/^schedule_?wakeup$/i.test(name) && t.input?.stop === true)) {
        armedTools.push(name);
        armedCount += 1;
        const payload = cronPayloadText(t.input);
        if (payload) cronPayloads.push(payload);
      }
      if (CRON_DELETE_TOOL_RE.test(name)) clearTools.push(name);
      if (name === "Bash" && typeof t.input?.command === "string" && !isReadOnlyEventWatch(t.input)) {
        armedCmds.push(t.input.command);
      }
    }
  }
  return {
    armedToolBlob: armedTools.join("\n"),
    armedCount,
    cronPayload: cronPayloads.join("\n"),
    clearToolBlob: clearTools.join("\n"),
    cmdBlob: armedCmds.join("\n"),
    text: narrative.join("\n"),
  };
}

// Classify the arming signals present in the turn. Returns the discrete flags so
// the decision can reason about WHAT is armed (a banned poller vs a generic cron)
// and never collapse "armed" + "cleared" into a single masking boolean (cursor
// HIGH / codex P1: a same-turn delete-old + create-new must NOT PASS).
//
//   bannedPoller = a health-watch / status-poll / `/loop` / sleep-poll loop —
//     ALWAYS forbidden at a terminal state; the inbound-monitor exception can
//     NEVER excuse it.
//   cronTool     = a generic CronCreate/schedule_task tool ran — forbidden UNLESS
//     it is the one allowed inbound/standby monitor.
//   toolArmed    = any real arming TOOL/CMD ran (CronCreate or a poll cmd); a
//     prose "cron-count=0" disclaimer cannot clear THIS — only a real tool can.
function classifyArming(ev) {
  // Blank NEGATED cron/health-watch spans ("no polling crons", "stopped the
  // health-watch") before the narrative tests — a disclaimer of absence is not
  // an arming. Tool/command evidence is NOT subject to this — you cannot negate a
  // tool you actually invoked. The cron PAYLOAD (CronCreate prompt/schedule/
  // command) is scanned too: a health-watch hidden in the payload is a poller
  // even when the narrative says "inbound" (cursor MEDIUM).
  const liveText = ev.text.replace(NEGATED_CRON_RE, " ");
  const bannedPoller =
    LOOP_CMD_RE.test(ev.cmdBlob) ||
    HEALTH_WATCH_RE.test(liveText) ||
    NARRATIVE_LOOP_RE.test(liveText) ||
    HEALTH_WATCH_RE.test(ev.cronPayload) ||
    LOOP_CMD_RE.test(ev.cronPayload);
  const cronTool = CRON_CREATE_TOOL_RE.test(ev.armedToolBlob);
  const toolArmed = cronTool || LOOP_CMD_RE.test(ev.cmdBlob);
  return { bannedPoller, cronTool, toolArmed };
}

// A same-turn CLEAR — used ONLY to excuse the generic-cron route (a banned
// poller is never cleared; it FLAGs unconditionally). "Cleared" means the turn
// removed crons and armed NOTHING new:
//   - a real CronDelete/TaskStop tool ran, AND no new cron was armed this turn
//     (a CronDelete of cron A does NOT clear a freshly-created cron B — codex P1:
//     delete-old + create-new generic cron is still cron-count>0), OR
//   - a prose "cron-count=0 / cleared all crons" attestation, AND no arming
//     TOOL/CMD ran (you cannot narrate away a cron you just invoked).
function hasClear(ev, arming) {
  if (arming.toolArmed) return false; // a freshly-armed cron is not "cleared"
  if (CRON_DELETE_TOOL_RE.test(ev.clearToolBlob)) return true;
  return CLEARED_RE.test(ev.text);
}

// The arming is excused by the monitor-law ONLY if ALL hold:
//   - the narrative frames it as the inbound/standby monitor, AND
//   - there is NO banned poller (a health-watch is never the inbound monitor —
//     including a poller hidden in the cron payload), AND
//   - at most ONE cron-arming tool ran. The law is "ONE inbound monitor"; arming
//     five CronCreates and calling them "one inbound monitor" is not excused
//     (cursor MEDIUM: "Inbound excuse ignores create count"), AND
//   - if the armed CronCreate carries a payload, that payload is ITSELF
//     inbound/standby work — not a generic scheduled job. A "nightly digest" or
//     "fleet driver" CronCreate framed in prose as "one inbound monitor" is NOT
//     excused: the prose claim must match the payload (cursor HIGH: "Inbound
//     monitor excuse ignores payload"). An empty/benign payload (no recurring-job
//     markers) is allowed — the monitor-law is about a standby listener, and many
//     inbound monitors carry no descriptive payload.
function inboundMonitorExcused(ev, arming) {
  if (!INBOUND_MONITOR_RE.test(ev.text)) return false;
  if (arming.bannedPoller) return false;
  if (ev.armedCount > 1) return false;
  // If the cron has a payload, it must read as inbound/standby work, or at least
  // not as a generic recurring job. A payload that names a generic scheduled job
  // (digest / driver / poll / scrape / report / sync / sweep / refresh / …) while
  // the prose claims "inbound monitor" is the payload/claim mismatch — not excused.
  if (ev.cronPayload) {
    if (INBOUND_MONITOR_RE.test(ev.cronPayload)) return true;
    if (GENERIC_JOB_PAYLOAD_RE.test(ev.cronPayload)) return false;
  }
  return true;
}

// ── Cleanup receipt (cleanliness standard Mechanism 1) ──────────────────────
// Cleanup is part of done: a lane DONE report ends with a CLEANUP RECEIPT
// (worktree / branch / files outside src+tests / docs.local; `/pr-loop`
// references/merge-and-verification.md § Cleanup Receipt). A lane DONE is:
//   - a `gh pr merge` the turn EXECUTED (parsed shell, so `echo gh pr merge`
//     is an echo), or a narrated "PR #N merged" / "handed PR #N to the lead"
//     claim (negated/conditional talk excluded),
//   - a DONE_<ID> marker written this turn (Write/Edit content, an echo/printf
//     redirect, a here-document into a file, or a line of its own in the
//     narrative), or
//   - a line carrying both a DONE status token and a PR URL.
// Fenced code blocks and `>` blockquotes are examples, not reports: they are
// blanked before any DONE signal is read (a receipt inside one still counts).
// The receipt may sit in the turn's narrative, a tool input it wrote (report
// file, PR comment), or a report file the turn cites
// (a fixture's `reports` map, else `options.readReport(path)`). Advisory only,
// like every code here (GO-5 E2). A turn with no lane DONE is N/A, so
// discussion about receipts and mid-sprint pushes never fire.
const PR_REF = String.raw`(?:PR\s*#\d+|#\d+|github\.com/[^\s/]+/[^\s/]+/pull/\d+)`;
const MERGED_CLAIM_RE = new RegExp(
  String.raw`${PR_REF}[^\n.;]{0,40}?\bmerged\b|\bmerged\b[^\n.;]{0,20}?${PR_REF}`,
  "i",
);
const PR_REF_RE = new RegExp(PR_REF, "i");
const HANDOFF_PHRASE_RE =
  /\bhand(?:ed|ing)?\b[^\n.;]{0,30}?\b(?:off|to (?:the |its |my |your )?lead)\b/i;
// A claim span containing these is talk about a merge, not a report of one.
const NOT_A_CLAIM_RE =
  /\b(not|never|unless|until|once|if|when|before|awaits?|awaiting|should|would|will|can|could|pending)\b|n't/i;
const PR_URL_RE = /github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/i;
const DONE_TOKEN_RE = /(^|[\s*#>|(-])(TASK_)?DONE\b/;
const DONE_MARKER_LINE_RE = /^\s*DONE_[A-Z0-9][A-Z0-9_]*\s*$/m;
// The receipt block: its heading followed by at least the worktree and branch
// lines. "CLEANUP RECEIPT: n/a" or a prose mention of a receipt is not one.
const RECEIPT_RE = /CLEANUP RECEIPT[\s\S]{0,400}?\bworktree:[\s\S]{0,600}?\bbranch:/i;
// The path body is capped and '=' cannot extend a candidate: it begins a new
// candidate, so allowing it in the greedy body makes repeated '=/' quadratic.
const REPORT_PATH_RE = /(?:^|[\s`'"(=])((?:~|\/)[^\s`'"()<>|;&=]{1,1024}\.(?:md|txt))\b/g;
const MAX_REPORT_READS = 4;
const MAX_RECEIPT_SCAN_WORK = 4_000_000;
const MAX_RECEIPT_SCAN_MS = 350;
// Advisory-only in the Stop hook AND the CLI: it never changes the CLI's exit
// code, which stays reserved for the cron/loop FLAGs (cx9 R1 finding 1).
export const CLEANUP_RECEIPT_CODE = "FLEETWRAP_CLEANUP_RECEIPT_MISSING";
const WRITTEN_INPUT_KEYS = ["content", "new_string", "body", "message", "text"];
const LEXER_ABORTED = Symbol("lexer work bound reached");

function receiptBudget(options) {
  const maxWork = options.receiptOptions?.maxWork ?? MAX_RECEIPT_SCAN_WORK;
  const maxMs = options.receiptOptions?.maxMs ?? MAX_RECEIPT_SCAN_MS;
  const deadline = performance.now() + maxMs;
  let work = 0;
  return (amount = 1) => {
    work += amount;
    if (work > maxWork || performance.now() > deadline) throw LEXER_ABORTED;
  };
}

function writtenInputText(tool) {
  const input = tool?.input;
  if (!input || typeof input !== "object") return "";
  const parts = WRITTEN_INPUT_KEYS.map((k) => (typeof input[k] === "string" ? input[k] : ""));
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (typeof edit?.new_string === "string") parts.push(edit.new_string);
    }
  }
  return parts.filter(Boolean).join("\n");
}

// Fenced blocks (``` / ~~~, an unclosed fence runs to the end) and `>`
// blockquote lines are examples or quotations, never this turn's report.
function stripExamples(text, charge) {
  charge(text.length);
  const out = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

function receiptEvidence(turn, lexerOptions, charge) {
  const narrative = [];
  const written = [];
  const commands = [];
  const filePaths = [];
  const writeTargetPaths = [];
  let merged = false;
  for (const ev of turn) {
    if (ev.role === "assistant" && ev.text) {
      charge(ev.text.length);
      narrative.push(ev.text);
    }
    for (const t of ev.tools ?? []) {
      const text = writtenInputText(t);
      charge(text.length);
      if (text) written.push(text);
      if (typeof t.input?.file_path === "string") filePaths.push(t.input.file_path);
      if (typeof t.input?.command !== "string") continue;
      charge(t.input.command.length);
      commands.push(t.input.command);
      const parsed = parseShell(t.input.command, {
        ...lexerOptions,
        maxWork: Math.min(lexerOptions?.maxWork ?? MAX_RECEIPT_SCAN_WORK, MAX_RECEIPT_SCAN_WORK),
        maxMs: Math.min(lexerOptions?.maxMs ?? MAX_RECEIPT_SCAN_MS, MAX_RECEIPT_SCAN_MS),
      });
      if (parsed === null) return null;
      for (const cmd of parsed) {
        charge();
        if (isGhPrMerge(cmd)) merged = true;
        const wrote = writtenText(cmd);
        if (wrote) written.push(wrote);
        for (const target of writeTargets(cmd)) writeTargetPaths.push(target);
      }
    }
  }
  return {
    narrative: narrative.join("\n"),
    written: written.join("\n"),
    commands: commands.join("\n"),
    filePaths,
    writeTargetPaths,
    merged,
  };
}

function hasClaim(text, re, charge) {
  charge(text.length);
  const global = new RegExp(re.source, `${re.flags.replace("g", "")}g`);
  const separators = text.matchAll(/\n|\. |; /g);
  const blockers = text.matchAll(new RegExp(NOT_A_CLAIM_RE.source, "gi"));
  let separator = separators.next().value;
  let blocker = blockers.next().value;
  let start = -1;
  for (const match of text.matchAll(global)) {
    charge();
    // Read the claim's own sentence up to the match: "Once PR #88 is merged"
    // and "PR #88 is not merged" are talk about a merge, not a report of one.
    while (separator && separator.index <= match.index) {
      start = separator.index;
      separator = separators.next().value;
    }
    while (blocker && blocker.index <= start) blocker = blockers.next().value;
    if (!blocker || blocker.index >= match.index + match[0].length) return true;
  }
  return false;
}

function doneSignals(ev, charge) {
  const signals = [];
  const narrative = stripExamples(ev.narrative, charge);
  const written = stripExamples(ev.written, charge);
  if (ev.merged) signals.push("gh pr merge ran this turn");
  if (hasClaim(narrative, MERGED_CLAIM_RE, charge)) signals.push("a PR reported merged");
  charge(narrative.length);
  if (narrative.split("\n").some((line) => PR_REF_RE.test(line) && hasClaim(line, HANDOFF_PHRASE_RE, charge))) {
    signals.push("a PR handed off to the lead");
  }
  if (DONE_MARKER_LINE_RE.test(narrative) || DONE_MARKER_LINE_RE.test(written)) {
    signals.push("a DONE_<ID> marker written");
  }
  charge(narrative.length + written.length);
  if (`${narrative}\n${written}`.split("\n").some((line) => DONE_TOKEN_RE.test(line) && PR_URL_RE.test(line))) {
    signals.push("a DONE line with a PR URL");
  }
  return signals;
}

// Explicitly cited paths (the narrative) come first, then paths the turn's
// shell wrote to or named, then files written by tool; ineligible paths
// (relative, `..`, not .md/.txt) are dropped BEFORE the cap, so scratch notes
// or junk cannot crowd out the cited report.
function citedReportPaths(ev, charge) {
  const paths = [];
  charge(ev.narrative.length);
  for (const match of ev.narrative.matchAll(REPORT_PATH_RE)) { charge(); paths.push(match[1]); }
  for (const path of ev.writeTargetPaths) paths.push(path);
  charge(ev.commands.length);
  for (const match of ev.commands.matchAll(REPORT_PATH_RE)) { charge(); paths.push(match[1]); }
  for (const path of ev.filePaths) paths.push(path);
  return [...new Set(paths)].filter((p) => eligibleReportPath(p) !== null).slice(0, MAX_REPORT_READS);
}

// A fixture's `reports` map (path -> text) stands in for files on disk; the
// Stop hook injects a bounded disk reader as `options.readReport`.
function reportReader(transcript, options) {
  const reports = transcript && typeof transcript === "object" && !Array.isArray(transcript)
    ? transcript.reports
    : null;
  const injected = typeof options?.readReport === "function" ? options.readReport : null;
  return (p) => {
    if (reports && typeof reports === "object" && typeof reports[p] === "string") return reports[p];
    return injected ? injected(p) : null;
  };
}

function detectCleanupReceipt(transcript, turn, options) {
  const charge = receiptBudget(options);
  const ev = receiptEvidence(turn, options.lexerOptions, charge);
  if (ev === null) return LEXER_ABORTED;
  const signals = doneSignals(ev, charge);
  if (signals.length === 0) return null;
  // Tool RESULTS are not the turn's output: a lead that reads a worker's
  // receipt has not written its own.
  if ([ev.narrative, ev.written, ev.commands].some((t) => { charge(t.length); return RECEIPT_RE.test(t); })) return null;
  const read = reportReader(transcript, options);
  const cited = citedReportPaths(ev, charge);
  for (const p of cited) {
    let text = null;
    try {
      text = read(p);
    } catch {
      text = null;
    }
    if (typeof text === "string") {
      charge(text.length);
      if (RECEIPT_RE.test(text)) return null;
    }
  }
  const where = cited.length ? ` or in the cited report(s) [${cited.join(", ")}]` : "";
  return {
    code: CLEANUP_RECEIPT_CODE,
    ids: signals,
    action:
      "append a CLEANUP RECEIPT (worktree / branch / files outside src+tests / docs.local this lane created) to the DONE report or merge comment",
    evidence: `lane DONE report (${signals.join("; ")}) with no CLEANUP RECEIPT in this turn's output${where}.`,
  };
}

// ── The detector ────────────────────────────────────────────────────────────
// detectFleetWrap(transcript) → {
//   verdict: "PASS" | "FLAG", terminal: bool, violations: [{code, evidence}],
// }
export function detectFleetWrap(transcript, options = {}) {
  const events = normalizeTranscript(transcript);
  const turn = currentTurn(events);
  const result = detectCronState(transcript, turn, options);
  let receipt;
  try {
    receipt = detectCleanupReceipt(transcript, turn, options);
  } catch (error) {
    if (error !== LEXER_ABORTED) throw error;
    receipt = LEXER_ABORTED;
  }
  if (receipt === LEXER_ABORTED) return result;
  if (!receipt) return result;
  return { verdict: "FLAG", terminal: result.terminal, violations: [...result.violations, receipt] };
}

function detectCronState(transcript, turn, options) {
  const ev = buildEvidence(turn);
  const durableState = durableStateFrom(transcript, options);
  const sessionId = options.sessionId ?? durableState?.session_id ?? durableState?.sessionId;

  // The terminal-state signal comes from the assistant narrative of the current
  // turn (the stand-down message). A NON-terminal marker without a terminal one
  // → mid-sprint → N/A (the gate only fires at a wrap/stand-down state).
  // Inbound/standby phrasing ("standing by for Etan", "awaiting an Etan decision")
  // is ALSO a terminal posture — otherwise a worker could "stand by" + leave a
  // health-watch armed and dodge the gate by avoiding the word "wrap"/"down"
  // (the disguised-monitor evasion). The monitor-law exception still excuses a
  // bare inbound monitor below; only a health-watch/poll under standby FLAGs.
  // "all crons cleared" is a CLEARING phrase, not a stand-down declaration — it
  // must not, on its own, make a mid-sprint turn read as terminal (cursor MEDIUM:
  // "kicking off … cleared old crons … more work queued" + CronCreate is legit
  // sprint work, N/A). So the terminal test reads the text with clearing phrases
  // blanked; a real wrap still matches on "fleet wrap"/"stand down"/etc.
  const terminalText = ev.text.replace(CLEARED_RE_G, " ");
  let isTerminal =
    TERMINAL_RE.test(terminalText) || INBOUND_MONITOR_RE.test(ev.text);
  const isNonTerminal = NON_TERMINAL_RE.test(ev.text);
  const discussionOnly =
    DISCUSSION_RE.test(ev.text) &&
    !/(wrapped|standing[- ]?down|going silent|back to silent|only an etan decision|work (is )?(complete|done)|\bDONE\b)/i.test(ev.text);
  if (discussionOnly) isTerminal = false;
  if (WORKER_SEAT_RE.test(ev.text) && NEGATED_TERMINAL_RE.test(ev.text)) isTerminal = false;

  const arming = classifyArming(ev);
  const cleared = hasClear(ev, arming);

  // Not a terminal/stand-down turn at all → N/A.
  if (!isTerminal) {
    return { verdict: "PASS", terminal: false, violations: [] };
  }
  // The mid-sprint N/A escape: a turn that carries genuine mid-sprint language
  // ("more work queued", "kicking off", "still working") is legitimate
  // sprint-driving work — UNLESS it also has a STRONG explicit wrap marker
  // (TERMINAL_RE: fleet wrap / stand down / sprint close / …) AND arms a cron.
  // A real "fleet wrap" that also says "more work queued" while arming a
  // CronCreate is a contradictory wrap-plus-drive turn and must be EVALUATED, not
  // escaped (cursor MEDIUM: "wrap plus queued excuses cron"). So the escape
  // requires: mid-sprint language, NO banned poller, and EITHER no armed cron OR
  // no strong wrap marker. (A banned poller always falls through to the gate —
  // RED 06: "the health-watch loop is still running" describes the poller, not
  // the agent.)
  const strongWrap = TERMINAL_RE.test(terminalText);
  const armedAny = arming.bannedPoller || arming.cronTool;
  if (isNonTerminal && !arming.bannedPoller && !(strongWrap && armedAny)) {
    return { verdict: "PASS", terminal: false, violations: [] };
  }

  const violations = [];

  if (durableState) {
    const { liveCrons, liveLoops } = liveStateEntries(durableState, sessionId);
    if (liveLoops.length > 0) {
      const ids = liveLoops.map((entry) => entry.id);
      violations.push(loopViolation(
        ids,
        `terminal/stand-down state with live loop ids [${ids.join(", ")}] in durable state. Exact cleanup action: ${cleanupList("TaskStop", ids)}.`,
      ));
    }
    if (liveCrons.length > 0) {
      const ids = liveCrons.map((entry) => entry.id);
      violations.push(cronViolation(
        ids,
        `terminal/stand-down state with live cron ids [${ids.join(", ")}] in durable state. Exact cleanup action: ${cleanupList("delete cron", ids)}.`,
      ));
    }
  }

  // At a terminal/stand-down state, assert cron-count == 0. Two independent
  // routes to a violation:
  //   1. a banned poller (health-watch / `/loop` / sleep-poll) is ARMED → FLAG
  //      unconditionally. A same-turn CronDelete of some OTHER cron does NOT
  //      excuse a freshly-armed poller (cursor HIGH / codex P1: delete-old-PR-poll
  //      + create-new-health-watch must FLAG). The ONLY way a poller does not fire
  //      is when its mention is negated/cleared in prose — and NEGATED_CRON_RE in
  //      classifyArming already prevents "stopped the health-watch" from ever
  //      setting `bannedPoller`. (`cleared` is therefore irrelevant to route 1.)
  //   2. a generic CronCreate/schedule_task is armed, NOT cleared this turn, and
  //      NOT the single allowed inbound/standby monitor.
  if (arming.bannedPoller) {
    const isLoop = LOOP_CMD_RE.test(ev.cmdBlob) || LOOP_CMD_RE.test(ev.cronPayload) || NARRATIVE_LOOP_RE.test(ev.text);
    violations.push(isLoop
      ? loopViolation(
        ["unknown-loop"],
        "terminal/stand-down state with a still-armed `/loop` / sleep-poll loop in same-turn evidence. Exact cleanup action: TaskStop unknown-loop.",
      )
      : cronViolation(
        ["unknown-cron"],
        "terminal/stand-down state with a still-armed health-watch/status-poll cron in same-turn evidence. Exact cleanup action: delete cron unknown-cron.",
      ));
  } else if (arming.cronTool && !cleared && !inboundMonitorExcused(ev, arming)) {
    violations.push(cronViolation(
      ["unknown-cron"],
      "terminal/stand-down state with a still-armed CronCreate/schedule_task in same-turn evidence. Exact cleanup action: delete cron unknown-cron.",
    ));
  }

  return {
    verdict: violations.length > 0 ? "FLAG" : "PASS",
    terminal: true,
    violations,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") {
    return result.terminal
      ? "✅ fleet-wrap-gate PASS — terminal state with cron-count=0 (crons cleared, or only an inbound standby monitor)"
      : "✅ fleet-wrap-gate PASS — not a terminal/stand-down state (N/A)";
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ fleet-wrap-gate FLAG — ${codes}\n${result.violations.map((v) => `  • ${v.code}: ${v.evidence}`).join("\n")}`;
}
