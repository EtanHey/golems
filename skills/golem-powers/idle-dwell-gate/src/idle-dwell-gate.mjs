// idle-dwell-gate (gen-18 Track 1) — the Fix-2 outcome/idle-dwell gate.
//
// THE REGRESSION it closes: R-001 passivity/active-drive (BROKEN-OPEN 6+ gens,
// the registry's worst family) + R-011 snowball-continuation + R-036
// resume-not-respawn. Every prior fix was PROSE and broke in the very next run.
// This is the mechanical detector the prose kept failing to replace.
//
// THE GATE: over an agent transcript, decide whether the agent's CURRENT TURN is
// an autonomous DRIVE (worker dispatch / resume / self-driving the authorized
// work / a genuine hard-gate pause) or an idle-dwell VIOLATION (no-input
// decision, idle seat with an open queue, deferral-after-authorization, backlog
// handed to the user as a work-queue, or a fresh spawn over a resumable crashed
// lead).
//
// It is DETERMINISTIC: same transcript in → same verdict out. The pinned
// RED/GREEN fixtures in evals/fixtures/ are the replayable gate (R-003/R-014
// proven pattern), consumed in the T6 smoke-spec shape.

import { normalizeTranscript, joinText } from "../lib/transcript.mjs";

// ── Marker sets (anchored on phrasing that appears in the real specimens) ──────

const AUTH_RE =
  /\b(approved|authoriz\w+|in-?policy|you own (them|it|this|the)|drive (it|the|this)|run the full pr.?loop|don'?t idle|execute (all|the (full )?queue|the queue)|finish the (sprint )?queue|remaining (tasks|items|phases|work|queue)|still (in|on) the queue|phase \d|no progress|why are you (just )?resting)\b/i;

const QUEUE_EMPTY_RE =
  /\b(queue is empty|nothing (else )?(is )?(authorized|queued|pending|left)|all (three |the )?(queued )?(tasks|items|phases|work|prs?) (are|is) merged|everything (is )?merged|no (more )?(pending|queued|authorized) work)\b/i;

const HARD_GATE_RE =
  /\b(visual sign-?off|design approval|can'?t self-?approve|cannot self-?approve|your eyes on|needs? (your )?(eyes|review) (on )?the (render|design|screenshot)|physically|in person|credentials? (needed|missing|required)|secret (needed|missing)|api is down|service is down|true blocker|hard gate)\b/i;

const BACKLOG_HANDOFF_RE =
  /\b(for you to (triage|decide|prioriti[sz]e|pick)|you'?ll need to|you should (review|pick|decide)|backlog for you|which (of these )?(do )?you want me to start|let me know which)\b/i;
const DEFERRAL_RE =
  /\b(ready when you are|should i wait|wait until you|before i (start|begin)[, ].*would you like|let me know (if|when) (you'?d like|you want)|i'?ll (wait|hold|stand by) (for|until)|pending your (approval|review|go-?ahead)|awaiting (your )?(approval|sign-?off|go-?ahead))\b/i;
const COORD_QUESTION_RE =
  /\b(should i (merge|open|proceed|push|continue|start)|want me to|would you like me to|shall i|do you want me to|how would you like me to proceed)\b/i;
const DISCUSSION_RE =
  /\b(discuss|discussion|design discussion|doctrine discussion|rule discussion|should be detected|how .* should)\b/i;

// Tools that CREATE a fresh agent (spawn). A spawn over a resumable crashed lead
// is the R-036 violation; a spawn when nothing is resumable is legit dispatch.
const FRESH_SPAWN_TOOLS = new Set([
  "spawn_agent", "spawn_in_workspace", "new_split", "new_worktree_split",
  "new_surface", "dispatch_to_agent", "Task",
]);
// Tools that talk to / drive an EXISTING agent (dispatch, not spawn).
const DISPATCH_TOOLS = new Set([
  "send_to_agent", "send_input", "send_command", "send_to", "send_key", "interact",
]);
// Tools that MATERIALLY advance the work in-seat (self-drive). PASSIVE tools
// (Read/Grep/Glob/TodoWrite/list_agents/brain_search/read_screen/...) are NOT
// here: gathering/reading/state-updating is not driving (codex P1 — a final
// "how would you like me to proceed?" with a TodoWrite must still FLAG).
const SELF_DRIVE_TOOLS = new Set([
  "Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch",
]);
// A Bash command that ACTS (advances the work) vs one that merely reads.
const ACTION_BASH_RE =
  /(git (push|commit|merge|rebase|cherry-pick|tag)|gh (pr (create|merge|ready|comment)|release)|cargo (build|run|test|publish)|swift build|xcodebuild|npm (run|publish|test)|pnpm |bun (run|test|x|build)|make\b|\.\/[\w./-]+|chmod |mkdir |mv |cp |tee |railway (up|redeploy|restart)|brew (install|upgrade)|docker (build|run))/i;

const RESUME_RE = /(--resume\b|\brepo ?golem --resume|resume the (original )?session)/i;
const RESUMABLE_RE =
  /(resumable\s*=?\s*true|state\s*=?\s*error[\s\S]*session[_ ]?id|crashed[\s\S]*resumable|session[_ ]?id\s*=?\s*[0-9a-f-]{6,}[\s\S]*resumable)/i;

// Normalize an MCP tool name to its base (`mcp__cmuxlayer__spawn_agent` → `spawn_agent`,
// codex P1) so the cmux-prefixed live spelling is recognized.
function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

function eventsTools(events) {
  return events.flatMap((e) => e.tools ?? []);
}

// Does any tool materially self-drive (action file-edit, or a Bash that acts)?
function hasSelfDrive(tools) {
  return tools.some((t) => {
    const b = baseName(t.name);
    if (SELF_DRIVE_TOOLS.has(b)) return true;
    if (b === "Bash") {
      const cmd = t.input && typeof t.input.command === "string" ? t.input.command : "";
      return ACTION_BASH_RE.test(cmd);
    }
    return false;
  });
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function durableStateFrom(transcript, opts) {
  if (opts?.state && typeof opts.state === "object") return opts.state;
  if (transcript && typeof transcript === "object" && !Array.isArray(transcript) && transcript.state) {
    return transcript.state;
  }
  return {};
}

function activeWatchCount(state) {
  return [
    ...arrayFrom(state.watches),
    ...arrayFrom(state.monitors),
    ...arrayFrom(state.crons),
    ...arrayFrom(state.loops),
  ].filter((watch) => {
    if (!watch || typeof watch !== "object") return false;
    const status = String(watch.status ?? watch.state ?? "");
    if (/^(done|complete|completed|disabled|inactive|stopped|deleted|failed)$/i.test(status)) return false;
    return watch.active !== false && watch.enabled !== false;
  }).length;
}

function isActionableQueueItem(item) {
  if (!item || typeof item !== "object") return false;
  const status = String(item.status ?? item.state ?? "");
  if (/^(done|complete|completed|merged|closed|cancelled|canceled)$/i.test(status)) return false;
  if (item.requiresUserInput === true || item.etanOnly === true || item.humanOnly === true) return false;
  if (item.blockedOn || item.externalBlocker || item.externalEvent) return false;
  return item.approved === true || /^(approved|ready|queued|pending|unstarted|todo)$/i.test(status);
}

function isUnstarted(item) {
  if (!item || typeof item !== "object") return false;
  const status = String(item.status ?? item.state ?? "");
  return (
    item.started === false ||
    item.state === "unstarted" ||
    item.status === "unstarted" ||
    /^(approved|ready|queued|pending|todo)$/i.test(status)
  );
}

function queueItems(state) {
  return [
    ...arrayFrom(state.queue),
    ...arrayFrom(state.queueItems),
    ...arrayFrom(state.queue_items),
    ...arrayFrom(state.backlog),
    ...arrayFrom(state.tasks),
  ];
}

function workerRecords(state) {
  return [
    ...arrayFrom(state.workers),
    ...arrayFrom(state.agents),
    ...arrayFrom(state.panes),
    ...arrayFrom(state.seats),
  ];
}

function itemId(item, fallback) {
  return String(item?.id ?? item?.name ?? item?.title ?? item?.queueItem ?? fallback);
}

function workerId(worker, fallback) {
  return String(worker?.id ?? worker?.name ?? worker?.paneId ?? worker?.surface ?? fallback);
}

function hasStateQueue(state) {
  return queueItems(state).length > 0;
}

function hasActionableStateQueue(state) {
  return queueItems(state).some(isActionableQueueItem);
}

function addViolation(violations, code, evidence, fields = {}) {
  const hookDecision =
    code === "DONE_WORKER_UNHARVESTED" ||
    code === "APPROVED_ITEM_UNSTARTED_ZERO_WATCHES"
      ? "block"
      : "advisory";
  violations.push({ code, hookDecision, evidence, ...fields });
}

function stateViolations(state, { isWorkerSeat = false } = {}) {
  const violations = [];
  if (isWorkerSeat) return violations;

  const workers = workerRecords(state);
  for (const [idx, worker] of workers.entries()) {
    const stateText = String(worker.state ?? worker.status ?? "").toLowerCase();
    const id = workerId(worker, `worker-${idx + 1}`);
    const paneOpen = worker.paneOpen === true || worker.pane_open === true || worker.open === true;
    const harvested = worker.harvested === true || worker.reportHarvested === true;
    const doneMinutes = Number(worker.doneMinutes ?? worker.done_minutes ?? worker.minutesDone ?? 0);
    if (stateText === "done" && paneOpen && !harvested && doneMinutes >= 5) {
      addViolation(
        violations,
        "DONE_WORKER_UNHARVESTED",
        `worker ${id} is registry state=done, pane open, unharvested for ${doneMinutes} minutes.`,
        { id },
      );
    } else if (stateText === "done" && paneOpen && harvested) {
      addViolation(
        violations,
        "IDLE_DONE_WORKER_PANE_OPEN",
        `worker ${id} is DONE and harvested, but its pane is still open and reads as active.`,
        { id },
      );
    }

    const composer =
      worker.composer ?? worker.composerText ?? worker.composer_text ?? worker.input ?? "";
    const toolCalls = Number(worker.toolCallsSinceSpawn ?? worker.tool_calls_since_spawn ?? 0);
    if (
      /^(boot_failed|boot-failed|failed_boot|spawn_failed|error)$/i.test(stateText) &&
      paneOpen &&
      String(composer).trim() &&
      toolCalls === 0
    ) {
      addViolation(
        violations,
        "BOOT_FAILED_WORKER_STALL",
        `worker ${id} is boot-failed with a non-empty composer and zero tool calls since spawn.`,
        { id },
      );
    }
  }

  const activeWatches = activeWatchCount(state);
  for (const [idx, item] of queueItems(state).entries()) {
    if (isActionableQueueItem(item) && isUnstarted(item) && activeWatches === 0) {
      const id = itemId(item, `queue-${idx + 1}`);
      addViolation(
        violations,
        "APPROVED_ITEM_UNSTARTED_ZERO_WATCHES",
        `queue item ${id} is approved, needs no user input, is unstarted, and has zero watches armed.`,
        { id },
      );
    }
  }
  return violations;
}

// ── The detector ───────────────────────────────────────────────────────────────

// detectIdleDwell(transcript, opts?) → {
//   verdict, violations: [{code, evidence}], queueOpen, isDriving, isHardGate,
//   terminalAction: "dispatch"|"resume"|"self-drive"|"spawn"|"ask-user"|"stop",
// }
// opts.queueOpen forces the queue state when the live caller (/orc) knows it
// authoritatively; otherwise it is inferred from the CURRENT turn.
export function detectIdleDwell(transcript, opts = {}) {
  const events = normalizeTranscript(transcript);
  const state = durableStateFrom(transcript, opts);

  // Bound the CURRENT turn: from the last genuine human message onward. The
  // agent may split tool_use and closing text across several assistant messages
  // in one turn (cursor HIGH) — evaluate the whole turn, not just the last event.
  let lastHuman = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].role === "user") { lastHuman = i; break; }
  }
  const fromHuman = events.slice(lastHuman === -1 ? 0 : lastHuman); // human prompt + turn
  const turnEvents = events.slice(lastHuman + 1); // the agent's actions this turn
  const turnAssistants = turnEvents.filter((e) => e.role === "assistant");
  const terminal = turnAssistants[turnAssistants.length - 1] ?? { text: "", tools: [] };

  const terminalText = (terminal.text ?? "").toLowerCase();
  const turnAssistantText = joinText(turnAssistants).toLowerCase();
  const turnTools = eventsTools(turnEvents);
  const turnToolBlob = turnTools
    .map((t) => `${t.name ?? ""} ${JSON.stringify(t.input ?? {})}`)
    .join("\n");
  const allText = joinText(events).toLowerCase();
  const stateHasQueue = hasStateQueue(state);
  const stateQueueOpen = hasActionableStateQueue(state);
  const seatRole = String(state.seatRole ?? state.role ?? "").toLowerCase();
  const isWorkerSeat = /worker/.test(seatRole);

  const turnBaseNames = turnTools.map((t) => baseName(t.name));
  const hasAskUser = turnBaseNames.includes("AskUserQuestion");
  const freshSpawn = turnBaseNames.some((n) => FRESH_SPAWN_TOOLS.has(n));
  const dispatched = turnBaseNames.some((n) => DISPATCH_TOOLS.has(n));
  const selfDrove = hasSelfDrive(turnTools);
  const isResume = RESUME_RE.test(turnAssistantText) || RESUME_RE.test(turnToolBlob);
  const resumableExists = RESUMABLE_RE.test(allText);

  // Queue state scoped to the CURRENT turn (cursor MEDIUM): authorization must be
  // visible in the bounding human prompt or this turn, and the agent must not
  // have declared the queue empty THIS turn.
  const inferredQueueOpen =
    AUTH_RE.test(joinText(fromHuman).toLowerCase()) && !QUEUE_EMPTY_RE.test(turnAssistantText);
  const queueOpen =
    typeof opts.queueOpen === "boolean"
      ? opts.queueOpen
      : stateHasQueue
        ? stateQueueOpen
        : inferredQueueOpen;

  const isHardGate = HARD_GATE_RE.test(terminalText);
  const isDiscussion = DISCUSSION_RE.test(joinText(fromHuman).toLowerCase()) && !stateHasQueue;

  // Driving = resuming, dispatching to an existing agent, self-doing the work,
  // or spawning fresh when nothing is resumable. Passive tools do NOT drive.
  const isDriving =
    isResume || dispatched || selfDrove || (freshSpawn && !resumableExists);

  const violations = stateViolations(state, { isWorkerSeat });

  // R-036: spawning a NEW lead over a resumable crashed one — always wrong,
  // independent of queue state (discards live context, e.g. ~386K tokens).
  if (freshSpawn && resumableExists && !isResume) {
    addViolation(
      violations,
      "SPAWN_OVER_RESUMABLE",
      "terminal action spawns a fresh agent while the transcript shows a resumable crashed session — resume it (repoGolem --resume <session-id>), do not duplicate-spawn.",
    );
  }

  // The no-input / idle family applies when there IS authorized open work and the
  // agent is at neither a drive nor a genuine hard gate. An AskUserQuestion for
  // coordination is a no-input decision regardless of any passive tools present.
  if (queueOpen && !isHardGate && !isDiscussion && !isWorkerSeat) {
    if (hasAskUser) {
      addViolation(
        violations,
        "NO_INPUT_DECISION",
        "terminal action is an AskUserQuestion for coordination while authorized work is queued — dispatch/resume/do the work, do not ask.",
      );
    } else if (!isDriving) {
      let code;
      if (BACKLOG_HANDOFF_RE.test(terminalText)) code = "BACKLOG_HANDED_TO_USER";
      else if (DEFERRAL_RE.test(terminalText)) code = "DEFERRAL_AFTER_AUTHORIZATION";
      else if (COORD_QUESTION_RE.test(terminalText)) code = "NO_INPUT_DECISION";
      else code = "IDLE_SEAT_OPEN_QUEUE";
      addViolation(
        violations,
        code,
        "the turn parks with an open authorized queue and no worker dispatch, resume, or self-driving action.",
      );
    }
  }

  let terminalAction = "stop";
  if (isResume) terminalAction = "resume";
  else if (dispatched) terminalAction = "dispatch";
  else if (freshSpawn) terminalAction = "spawn";
  else if (selfDrove) terminalAction = "self-drive";
  else if (hasAskUser) terminalAction = "ask-user";

  const hookDecision = violations.some((v) => v.hookDecision === "block")
    ? "block"
    : violations.length > 0
      ? "advisory"
      : "allow";

  return {
    verdict: violations.length > 0 ? "FLAG" : "PASS",
    violations,
    queueOpen,
    isDriving,
    isHardGate,
    resumableExists,
    terminalAction,
    hookDecision,
  };
}

export function hookPayloadFor(result) {
  if (!result || result.verdict !== "FLAG" || !Array.isArray(result.violations) || result.violations.length === 0) {
    return {};
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  const details = result.violations
    .map((v) => {
      const subject = v.id ? ` subject=${v.id}.` : "";
      return `${v.code}: ${v.evidence}${subject}`;
    })
    .join(" ");
  if (result.violations.some((v) => v.hookDecision === "block")) {
    return {
      decision: "block",
      reason: `IDLE-DWELL-GATE blocked unambiguous idle dwell (${codes}). ${details}`,
    };
  }
  return {
    systemMessage: `IDLE-DWELL-GATE advisory (${codes}): ${details}`,
  };
}

// Human/CLI-facing one-line report.
export function formatReport(result) {
  if (result.verdict === "PASS") {
    return `✅ idle-dwell-gate PASS — terminalAction=${result.terminalAction}, queueOpen=${result.queueOpen}`;
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ idle-dwell-gate FLAG/${result.hookDecision} — ${codes}\n${result.violations
    .map((v) => `  • ${v.code} [${v.hookDecision}]: ${v.evidence}`)
    .join("\n")}`;
}
