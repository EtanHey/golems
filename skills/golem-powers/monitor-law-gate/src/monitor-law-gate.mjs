// monitor-law-gate (gen-18 Track 1 #2) — the monitor-law mechanical gate.
//
// THE REGRESSION it closes: R-002 (BROKEN-OPEN, 22× imp-10) — a lead/orc finishes
// its lane, posts "back to silent" with NO monitor armed (or a monitor armed on
// the WRONG file / keyed to nothing), and work routed to it via the live channel
// is a silent no-op. "leads and orchestrators should all have very, very good
// rules about monitors." Every prior fix was prose; this is the mechanical gate.
//
// THE GATE: over a lead/orc transcript with an active collab channel + in-flight
// work, assert a persistent monitor is armed ON THE ACTIVE CHANNEL and keyed to a
// real heartbeat marker (### / ORC-RECEIPT: / @name / BLOCKED). DETERMINISTIC;
// the pinned RED/GREEN fixtures are the replayable gate (R-003/R-014 pattern).

import { statSync } from "node:fs";
import { normalizeTranscript, joinText, currentTurn } from "../lib/transcript.mjs";

// A collab channel file path (…/collab/<name>.md).
const COLLAB_PATH_RE = /([\w./-]*collab[\w./-]*\.md)/gi;
// A heartbeat marker the monitor pattern MUST key on, or it watches nothing useful.
const HEARTBEAT_MARKER_RE = /(###|ORC-?RECEIPT|@[\w-]|\bBLOCKED\b)/;
// In-flight / sprint markers: the agent is acting as a lead/orc with live work.
const SPRINT_TEXT_RE =
  /(^|\n)\s*> ?CLAIM |ORC-?RECEIPT|spawn(ed|ing)? (a |the )?(worker|agent|lead|codex|cursor)|dispatch(ed|ing)/i;
const NEGATED_INFLIGHT_RE =
  /\b(?:not|no|never|without)\s+(?:actively\s+)?(?:spawn(?:ed|ing)?|dispatch(?:ed|ing)?|running)\b[^.!?\n]*/gi;
const CLAIMED_MONITOR_RE = /\bmonitor\s*=\s*([A-Za-z0-9_.:-]+)/gi;
const NO_MONITOR_RE = /\bmonitor\s*=\s*(none|null|false|off|no)\b/i;
const DONE_STATES = new Set(["done", "complete", "completed", "closed", "harvested", "acked", "stand_down", "stood_down"]);
const DEFAULT_HEARTBEAT_WINDOW_MS = 30_000;

const SPAWN_DISPATCH_TOOLS = new Set([
  "spawn_agent", "spawn_in_workspace", "new_split", "new_worktree_split",
  "dispatch_to_agent", "Task", "send_to_agent", "send_input", "send_command", "send_to",
]);
// Tools/commands that ARM a watch on a file.
const MONITOR_TOOLS = new Set(["Monitor", "CronCreate"]);
const WATCH_CMD_RE = /(tail\s+-f|fswatch|\bMonitor\b|inotifywait)/i;

function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) return n.split("__").pop() || n;
  return n;
}

function toolBlob(t) {
  return `${t.name ?? ""} ${JSON.stringify(t.input ?? {})}`;
}

function collabPaths(text) {
  return [...String(text).matchAll(COLLAB_PATH_RE)].map((m) => m[1]);
}

function isMonitorTool(t) {
  const base = baseName(t.name);
  return MONITOR_TOOLS.has(base) || (base === "Bash" && WATCH_CMD_RE.test(toolBlob(t)));
}

// Pick the active channel = the collab path the agent most refers to in its
// Write/Edit posts and spawn/dispatch briefs — EXCLUDING monitor/watch tools, so
// a monitor armed first (the prescribed order, before any post) doesn't make its
// own path the "active channel" and trivially pass (codex P1). Tie → last-seen.
function inferActiveChannel(events) {
  const counts = new Map();
  for (const ev of events) {
    for (const t of ev.tools ?? []) {
      if (isMonitorTool(t)) continue; // a monitor's own path is not evidence of the active channel
      const base = baseName(t.name);
      const weight = base === "Write" || base === "Edit" ? 2 : 1;
      for (const p of collabPaths(toolBlob(t))) {
        counts.set(p, (counts.get(p) ?? 0) + weight);
      }
    }
  }
  let best = null;
  let bestN = 0;
  for (const [p, n] of counts) {
    if (n >= bestN) { best = p; bestN = n; } // >= → deterministic last-seen-max on a tie
  }
  return best;
}

// The WATCH pattern a monitor actually keys on — input.pattern, or the grep
// argument of a Bash watch. The heartbeat check runs on THIS, not the whole tool
// call (cursor HIGH: a marker in the path/command must not satisfy it).
function extractPattern(t) {
  const inp = t.input ?? {};
  if (typeof inp.pattern === "string") return inp.pattern;
  if (typeof inp.grep === "string") return inp.grep;
  const cmd = typeof inp.command === "string" ? inp.command : "";
  // grep '<pat>' / grep -E "<pat>" / grep --line-buffered -E '<pat>'
  const m = cmd.match(/grep\b[^'"\n]*(['"])([^'"]+)\1/);
  if (m) return m[2];
  return ""; // no discernible pattern
}

// Is this monitor durable (persistent / not one-shot)? A native Monitor must set
// persistent:true; a Bash watch wrapped in `timeout N` is short-lived (cursor
// MEDIUM / codex P2).
function isPersistent(t) {
  const base = baseName(t.name);
  const inp = t.input ?? {};
  if (base === "Monitor") return inp.persistent === true;
  if (base === "CronCreate") return true; // recurring by nature
  if (base === "Bash") {
    const cmd = typeof inp.command === "string" ? inp.command : "";
    return !/\btimeout\s+\d/.test(cmd); // tail -f is durable unless timeout-wrapped
  }
  return false;
}

// Extract armed monitors: [{ path, pattern, persistent }].
function extractMonitors(events) {
  const monitors = [];
  for (const ev of events) {
    for (const t of ev.tools ?? []) {
      if (!isMonitorTool(t)) continue;
      const inp = t.input ?? {};
      monitors.push({
        id: inp.id ?? inp.monitorId ?? inp.monitor_id ?? null,
        path: collabPaths(toolBlob(t))[0] ?? null,
        pattern: extractPattern(t),
        persistent: isPersistent(t),
      });
    }
  }
  return monitors;
}

function sameChannel(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Compare by basename so absolute vs relative paths still match.
  return a.split("/").pop() === b.split("/").pop();
}

function sourceObject(transcript) {
  return transcript && typeof transcript === "object" && !Array.isArray(transcript) ? transcript : {};
}

function monitorRegistry(transcript, opts) {
  const src = sourceObject(transcript);
  return opts.monitorRegistry ?? src.monitorRegistry ?? src.registry ?? null;
}

function seatRole(transcript, opts, registry) {
  const src = sourceObject(transcript);
  return String(opts.seatRole ?? src.seatRole ?? registry?.seatRole ?? "").toLowerCase();
}

function isDoneState(state) {
  return DONE_STATES.has(String(state ?? "").toLowerCase());
}

function activeWorkers(registry) {
  const workers = Array.isArray(registry?.workers)
    ? registry.workers
    : Array.isArray(registry?.agents)
      ? registry.agents
      : [];
  return workers.filter((w) => !isDoneState(w?.state ?? w?.status));
}

function isStoodDown(registry) {
  if (!registry) return false;
  return registry.standDownAcked === true &&
    registry.activeSprint === false &&
    activeWorkers(registry).length === 0;
}

function registryInFlight(registry) {
  if (!registry || isStoodDown(registry)) return false;
  return registry.activeSprint === true || activeWorkers(registry).length > 0;
}

function registryMonitors(registry) {
  if (!registry) return [];
  if (Array.isArray(registry.monitors)) return registry.monitors;
  if (registry.monitors && typeof registry.monitors === "object") {
    return Object.entries(registry.monitors).map(([id, value]) => ({ id, ...value }));
  }
  return [];
}

function mtimeFromPath(path) {
  if (typeof path !== "string" || !path) return null;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function heartbeatMtime(monitor) {
  for (const key of ["heartbeatMtimeMs", "heartbeat_mtime_ms", "lastHeartbeatMs", "lastHeartbeatAtMs"]) {
    if (Number.isFinite(monitor?.[key])) return Number(monitor[key]);
  }
  return mtimeFromPath(monitor?.heartbeatPath ?? monitor?.heartbeat_path);
}

function monitorHeartbeatFresh(monitor, registry) {
  if (monitor?.alive === false || monitor?.state === "dead") return false;
  const mtime = heartbeatMtime(monitor);
  if (!Number.isFinite(mtime)) return false;
  const now = Number.isFinite(registry?.nowMs) ? Number(registry.nowMs) : Date.now();
  const windowMs = Number.isFinite(monitor?.heartbeatWindowMs)
    ? Number(monitor.heartbeatWindowMs)
    : Number.isFinite(registry?.heartbeatWindowMs)
      ? Number(registry.heartbeatWindowMs)
      : DEFAULT_HEARTBEAT_WINDOW_MS;
  return now - mtime <= windowMs;
}

function claimedMonitorIds(text) {
  const ids = [];
  for (const match of String(text ?? "").matchAll(CLAIMED_MONITOR_RE)) {
    const id = match[1].replace(/[.,;!?]+$/g, "");
    if (!/^(none|null|false|off|no)$/i.test(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

function authoredText(events) {
  return joinText(events.filter((e) => e.role === "assistant" || e.role === "user"));
}

function currentTurnWithUser(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].role === "user") return events.slice(i);
  }
  return events;
}

function latestSessionMonitorId(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.role === "tool") continue;
    if (NO_MONITOR_RE.test(ev.text)) return null;
    const textIds = claimedMonitorIds(ev.text);
    if (textIds.length > 0) return textIds[textIds.length - 1];

    const tools = [...(ev.tools ?? [])].reverse();
    for (const t of tools) {
      if (!isMonitorTool(t)) continue;
      const inp = t.input ?? {};
      const id = inp.id ?? inp.monitorId ?? inp.monitor_id ?? null;
      if (id) return id;
    }
  }
  return null;
}

function registryMonitorById(registry, id) {
  return registryMonitors(registry).find((m) => String(m.id ?? "") === String(id));
}

function registryMonitorChannel(monitor) {
  return monitor?.path ?? monitor?.channel ?? monitor?.activeChannel;
}

function sameMonitor(toolMonitor, registryMonitor) {
  if (!toolMonitor || !registryMonitor) return false;
  if (toolMonitor.id && registryMonitor.id && String(toolMonitor.id) === String(registryMonitor.id)) return true;
  return sameChannel(toolMonitor.path, registryMonitorChannel(registryMonitor));
}

function enrichMonitorsWithRegistry(monitors, registry) {
  const registered = registryMonitors(registry);
  if (!registry) return monitors;
  return monitors.map((m) => {
    const reg = registered.find((r) => sameMonitor(m, r));
    return reg ? { ...m, registry: reg, heartbeatFresh: monitorHeartbeatFresh(reg, registry) } : m;
  });
}

function freshClaimedSessionMonitor(events, registry, activeChannel, turnText) {
  if (!registry || NO_MONITOR_RE.test(turnText)) return null;
  const id = latestSessionMonitorId(events);
  if (!id) return null;

  const reg = registryMonitorById(registry, id);
  if (!reg) return null;
  const channel = registryMonitorChannel(reg);
  if (activeChannel && !sameChannel(channel, activeChannel)) return null;
  if (!monitorHeartbeatFresh(reg, registry)) return null;
  if (reg.pattern && !HEARTBEAT_MARKER_RE.test(reg.pattern)) return null;

  return {
    id,
    path: channel ?? null,
    pattern: reg.pattern ?? "",
    persistent: reg.persistent !== false,
    registry: reg,
    heartbeatFresh: true,
    sessionEvidence: true,
  };
}

// detectMonitorLaw(transcript, opts?) → {
//   verdict, violations:[{code,evidence}], activeChannel, inFlight, monitors,
// }
// opts.activeChannel forces the channel when the live caller (/orc) knows it.
export function detectMonitorLaw(transcript, opts = {}) {
  const registry = monitorRegistry(transcript, opts);
  const events = normalizeTranscript(transcript);
  // Evaluate the CURRENT turn (cursor HIGH: a full-transcript scan skews the
  // active-channel inference across turns) — consistent with the peer spine gates.
  const turn = currentTurn(events);
  const tools = turn.flatMap((e) => e.tools ?? []);

  const role = seatRole(transcript, opts, registry);
  const spawnDispatch = tools.some((t) => SPAWN_DISPATCH_TOOLS.has(baseName(t.name)));
  const turnText = authoredText(turn);
  const inFlightText = authoredText(currentTurnWithUser(events)).replace(NEGATED_INFLIGHT_RE, " ");
  const leadSeat = role !== "worker" && role !== "ic";
  const inFlight = leadSeat && !isStoodDown(registry) && (registryInFlight(registry) || spawnDispatch || SPRINT_TEXT_RE.test(inFlightText));

  const activeChannel = opts.activeChannel ?? registry?.activeChannel ?? inferActiveChannel(turn);
  const monitors = enrichMonitorsWithRegistry(extractMonitors(turn), registry);
  const sessionMonitor = freshClaimedSessionMonitor(events, registry, activeChannel, turnText);
  const effectiveMonitors = sessionMonitor && !monitors.some((m) => sameMonitor(m, sessionMonitor.registry))
    ? [...monitors, sessionMonitor]
    : monitors;

  const violations = [];

  // Only PERSISTENT monitors count as armed — a one-shot Monitor (persistent:false)
  // or a `timeout N tail` does not satisfy "go-silent-but-stay-watching" (R-002).
  const persistent = effectiveMonitors.filter((m) => m.persistent);
  const claimedIds = claimedMonitorIds(turnText);

  // Enforce whenever there IS live lead/orc work. A persistent monitor is required
  // even when no collab channel is inferable (cursor MEDIUM: missing channel must
  // not skip enforcement) — a lead that spawns and goes silent with NO monitor at
  // all is the core R-002 no-op.
  if (inFlight) {
    if (persistent.length === 0) {
      const why = NO_MONITOR_RE.test(turnText)
        ? "lead/orc explicitly reports monitor=none while dispatched workers or an active sprint remain"
        : effectiveMonitors.length > 0
        ? "only a non-persistent / one-shot watch is armed (persistent:true or an unbounded tail -f is required)"
        : "no persistent monitor/watch armed — work routed here is a silent no-op";
      violations.push({
        code: effectiveMonitors.length > 0 ? "MONITOR_NOT_PERSISTENT" : "MONITOR_ABSENT",
        evidence: `in-flight lead/orc work${activeChannel ? ` with an active channel (${activeChannel})` : ""} but ${why}.`,
      });
    } else if (activeChannel) {
      const onActive = persistent.filter((m) => sameChannel(m.path, activeChannel));
      if (onActive.length === 0) {
        violations.push({
          code: "MONITOR_WRONG_CHANNEL",
          evidence: `monitor armed on ${persistent.map((m) => m.path).join(", ")} but the active channel is ${activeChannel} — armed on the wrong file, the live channel is unwatched.`,
        });
      } else if (!onActive.some((m) => HEARTBEAT_MARKER_RE.test(m.pattern))) {
        violations.push({
          code: "MONITOR_NO_MARKER",
          evidence: `monitor watches ${activeChannel} but its grep/pattern keys on no heartbeat marker (### / ORC-RECEIPT: / @name / BLOCKED) — it will never fire on new posts.`,
        });
      } else {
        for (const id of claimedIds) {
          const reg = registryMonitorById(registry, id);
          if (!reg) {
            violations.push({
              code: "MONITOR_STALE_HEARTBEAT",
              evidence: `claim says monitor=${id}, but that monitor id is absent from the heartbeat/registry ground truth.`,
            });
            continue;
          }
          const regChannel = reg.path ?? reg.channel ?? reg.activeChannel;
          if (!sameChannel(regChannel, activeChannel)) {
            violations.push({
              code: "MONITOR_WRONG_CHANNEL",
              evidence: `claim says monitor=${id}, but registry ground truth places it on ${regChannel ?? "unknown"} while the active channel is ${activeChannel}.`,
            });
            continue;
          }
          if (!monitorHeartbeatFresh(reg, registry)) {
            violations.push({
              code: "MONITOR_STALE_HEARTBEAT",
              evidence: `claim says monitor=${id}, but its heartbeat is stale or missing within the freshness window.`,
            });
          }
        }
        for (const m of onActive) {
          if (registry && !m.registry) {
            violations.push({
              code: "MONITOR_STALE_HEARTBEAT",
              evidence: `monitor ${m.id ?? m.path ?? "unknown"} is armed on ${activeChannel}, but it is absent from the heartbeat/registry ground truth.`,
            });
          } else if (m.registry && m.heartbeatFresh === false) {
            violations.push({
              code: "MONITOR_STALE_HEARTBEAT",
              evidence: `monitor ${m.id ?? m.path ?? "unknown"} is armed on ${activeChannel}, but heartbeat ground truth is stale or missing within the freshness window.`,
            });
          }
        }
      }
    }
  }

  return {
    verdict: violations.length > 0 ? "FLAG" : "PASS",
    violations,
    activeChannel,
    inFlight,
    monitors: effectiveMonitors,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") {
    return `✅ monitor-law-gate PASS — activeChannel=${result.activeChannel ?? "none"}, monitors=${result.monitors.length}, inFlight=${result.inFlight}`;
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ monitor-law-gate FLAG — ${codes}\n${result.violations.map((v) => `  • ${v.code}: ${v.evidence}`).join("\n")}`;
}
