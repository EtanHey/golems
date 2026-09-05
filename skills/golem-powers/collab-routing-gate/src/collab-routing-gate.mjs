// collab-routing-gate (gen-18 Track 1 #4) — the collab-first decision-routing gate.
//
// THE REGRESSION it closes: R-002 substrate — gen-16 ROOT-1 "why don't you just
// update the shared coordination log once for everyone". Coordination must flow
// through the append-only collab file + event-driven waits, NOT through send_input
// cross-lead chatter, AskUserQuestion pickers, or sleep-poll loops on a worker's
// progress tick. Every prior fix was prose; this is the mechanical gate.
//
// THE GATE (over a lead/orc transcript):
//   - SLEEP_POLL_TICK: a sleep-loop polling an AGENT's progress (read_screen/
//     get_agent_state/list_agents) instead of wait_for/Monitor.
//   - COORD_VIA_SEND_INPUT: send_input/send_key carrying cross-lead COORDINATION
//     prose (status pings/@mentions) instead of a collab append.
//   - DECISION_WITHOUT_RECOMMENDATION: an async decision posted to collab that
//     asks without offering a recommendation.
// DETERMINISTIC; the pinned RED/GREEN fixtures are the replayable gate.

import { normalizeTranscript, currentTurn } from "../lib/transcript.mjs";

function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) return n.split("__").pop() || n;
  return n;
}

// A sleep-loop polling an AGENT's progress tick (NOT generic CI/gh polling —
// that legitimately needs polling; the rule is about worker progress ticks).
const POLL_AGENT_RE =
  /\b(while|for|until)\b[\s\S]{0,180}\bsleep\b[\s\S]{0,180}(read_screen|get_agent_state|list_agents|my_agents|wait_for_idle)/i;
const POLL_AGENT_SIMPLE_RE =
  /\bsleep\s+\d+[\s\S]{0,80}(read_screen|get_agent_state|list_agents|my_agents)/i;

// Cross-lead COORDINATION prose (a status ping / chat). A bare @mention does NOT
// count (a worker-boot brief may @-tag the seat) — an actual status/ping phrase is
// required (cursor MEDIUM).
const COORD_PROSE_RE =
  /(what'?s your (status|progress)|are you (done|stuck|blocked|there|making progress)|can you (update|confirm|ping|give me (a |an )?(status|update))|any (update|progress)\??|^\s*status\??\s*$|\bping\b\s*\??|how'?s it going|where are you (at|on))/im;
// A worker BOOT prompt (a task brief) — never coordination, even with an @mention.
const BOOT_PROMPT_RE =
  /(\bread\b[\s\S]{0,40}(and )?(execute|run|implement)|run the (full )?pr.?loop|\bexecute\b|implement|your (task|brief|deliverable)|docs?\/plan|branch from|drive (it|the|this) to merged)/i;

const COLLAB_PATH_RE = /[\w./-]*collab[\w./-]*\.md/i;
const DECISION_Q_RE =
  /(should we\b|which (option|one|approach|socket|path)\b|options?:|decision needed|what do you (think|want|prefer)|\bA or B\b|\?\s*$)/im;
const RECOMMENDATION_RE =
  /(recommend|i suggest|my (call|rec\b|recommendation)|proposed?\b|→ ?go with|i'?d go with|leaning toward|suggest(ed|ion)?:|i'?d pick|my pick)/i;

const SEND_INPUT_TOOLS = new Set(["send_input", "send_key", "interact"]);

function toolText(t) {
  // The human-facing payload of a send tool (message/text/input).
  const inp = t.input ?? {};
  return [inp.message, inp.text, inp.input, inp.content, inp.command]
    .filter((x) => typeof x === "string")
    .join("\n");
}

// detectCollabRouting(transcript) → { verdict, violations:[{code,evidence}] }
export function detectCollabRouting(transcript) {
  const events = normalizeTranscript(transcript);
  // Evaluate only the CURRENT turn, like the peer spine gates (cursor HIGH) — an
  // earlier-turn poll/send_input must not FLAG a compliant current turn.
  const turn = currentTurn(events);
  const tools = turn.flatMap((e) => e.tools ?? []);
  const violations = [];

  // 1. SLEEP_POLL_TICK — a Bash loop polling agent progress, with no wait_for/Monitor used.
  const usedEventWait = tools.some((t) => {
    const b = baseName(t.name);
    return b === "wait_for" || b === "Monitor" || b === "wait_for_all";
  });
  const sleepPollInBash = tools.some((t) => {
    if (baseName(t.name) !== "Bash") return false;
    const cmd = typeof t.input?.command === "string" ? t.input.command : "";
    return POLL_AGENT_RE.test(cmd) || POLL_AGENT_SIMPLE_RE.test(cmd);
  });
  // Interleaved pattern: an agent-state READ, then a Bash SLEEP, then another READ
  // — in that ORDER (cursor MEDIUM: an unrelated sleep + two reads must not FLAG).
  // Build an ordered token string over the turn's tools (R=read, S=sleep) and look
  // for R…S…R.
  const seq = tools
    .map((t) => {
      const b = baseName(t.name);
      if (["read_screen", "get_agent_state", "list_agents", "my_agents"].includes(b)) return "R";
      if (b === "Bash" && /\bsleep\s+\d/.test(t.input?.command ?? "")) return "S";
      return "";
    })
    .join("");
  const interleavedPoll = /R[^R]*S[^R]*R/.test(seq) || /R.*S.*R/.test(seq);
  const sleepPoll = sleepPollInBash || interleavedPoll;
  if (sleepPoll && !usedEventWait) {
    violations.push({
      code: "SLEEP_POLL_TICK",
      evidence: "a sleep-loop polls a worker's progress tick (read_screen/get_agent_state) instead of an event-driven wait_for(agent_id) / Monitor.",
    });
  }

  // 2. COORD_VIA_SEND_INPUT — send_input/send_key carrying coordination prose.
  for (const t of tools) {
    if (!SEND_INPUT_TOOLS.has(baseName(t.name))) continue;
    const text = toolText(t);
    // A worker boot prompt (a task brief) is GREEN even if it @-tags the seat.
    if (BOOT_PROMPT_RE.test(text)) continue;
    if (COORD_PROSE_RE.test(text)) {
      violations.push({
        code: "COORD_VIA_SEND_INPUT",
        evidence: "cross-lead coordination (status ping / @mention) sent via send_input instead of an append-only collab post — collab is the message bus, send_input is not.",
      });
      break;
    }
  }

  // 3. DECISION_WITHOUT_RECOMMENDATION — a collab decision-question with no recommendation.
  for (const t of tools) {
    const b = baseName(t.name);
    if (b !== "Write" && b !== "Edit") continue;
    const fp = t.input?.file_path ?? "";
    if (!COLLAB_PATH_RE.test(String(fp))) continue;
    const content = [t.input?.content, t.input?.new_string].filter((x) => typeof x === "string").join("\n");
    if (DECISION_Q_RE.test(content) && !RECOMMENDATION_RE.test(content)) {
      violations.push({
        code: "DECISION_WITHOUT_RECOMMENDATION",
        evidence: "an async decision posted to collab asks a question without a recommendation — route the decision WITH a recommendation, never a bare open question.",
      });
      break;
    }
  }

  return { verdict: violations.length > 0 ? "FLAG" : "PASS", violations };
}

export function formatReport(result) {
  if (result.verdict === "PASS") return "✅ collab-routing-gate PASS";
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ collab-routing-gate FLAG — ${codes}\n${result.violations.map((v) => `  • ${v.code}: ${v.evidence}`).join("\n")}`;
}
