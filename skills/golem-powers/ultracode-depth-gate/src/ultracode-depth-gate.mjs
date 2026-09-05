// ultracode-depth-gate (gen-18 Track 1 #8) — workflow topology depth-floor gate.
//
// Evidence for topology adequacy comes from dispatch tool calls and tool_result
// outputs in the CURRENT turn. Assistant prose may describe intent, but it
// cannot count as gatherers, adversarial verifiers, routing, or quality stop.

import { normalizeTranscript, currentTurn, joinText } from "../lib/transcript.mjs";

const ULTRACODE_RE = /\b(ultracode|comprehensive|exhaustive|thorough|audit|fan[- ]?out|workflow topology|architecture audit)\b/i;
const DISPATCH_RE = /\b(fan[- ]?out|dispatch|workflow|agents?|gatherers?|verifiers?|audit)\b/i;
const PERSISTENT_COLLAB_RE = /\bpersistent\b[\s\S]{0,120}\bcollab\b|\bcollab\b[\s\S]{0,120}\bpersistent\b/i;

const GATHERER_RE = /\b(gatherer|gather|researcher|scanner|explorer)\b/i;
const CHEAP_RE = /\b(cheap|cheap-model|low[- ]cost|haiku|mini|small)\b/i;
const VERIFIER_RE = /\b(verifier|verify|critic|adversarial|red[- ]team|challenge)\b/i;
const ADVERSARIAL_RE = /\b(adversarial|red[- ]team|critic|challenge|hostile)\b/i;
const LOOP_QUALITY_RE = /\b(loop[-_ ]until[-_ ]dry|until dry|quality[-_ ]stop|quality[-_ ]not[-_ ]budget|quality gate|no new findings|converge until dry)\b/i;
const BUDGET_STOP_RE = /\b(token cap|token[- ]?cap|budget cap|budget exhausted|max tokens|stop at (the )?(budget|token)|cap stop|timebox(?:ed)?)\b/i;
const FLAT_RE = /\b(flat|single[- ]pass|n[- ]?(?:to|->|→)[- ]?1|one[- ]shot|single gather pass)\b/i;
const DEEP_TOPOLOGY_RE = /\b(not flat|sub[- ]workflows?|workflows build sub[- ]workflows?|hierarchical|multi[- ]stage|adversarial verify stage)\b/i;
const LARGE_PLAN_COLLAB_RE = /\blarge-plan(?::workflows)?:collab\b|\blarge-plan:collab\b/i;
const ONE_SHOT_RE = /\b(one[- ]shot|explorer|Task|spawn_agent)\b/i;

function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

function currentTurnWithPrompt(events) {
  let lastUser = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].role === "user") { lastUser = i; break; }
  }
  return events.slice(lastUser === -1 ? 0 : lastUser);
}

function buildEvidence(turn) {
  const callTexts = [];
  const outputs = [];
  for (const ev of turn) {
    if (ev.role === "tool") outputs.push(ev.text ?? "");
    for (const tool of ev.tools ?? []) {
      const name = baseName(tool.name);
      const input = JSON.stringify(tool.input ?? {});
      const command = name === "Bash" && typeof tool.input?.command === "string" ? tool.input.command : "";
      callTexts.push(`${name}\n${input}\n${command}`);
    }
  }
  return {
    calls: callTexts,
    cmd: callTexts.join("\n"),
    out: outputs.join("\n"),
    all: `${callTexts.join("\n")}\n${outputs.join("\n")}`,
  };
}

function maxNumeric(text, patterns) {
  let max = 0;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  }
  return max;
}

function occurrenceCount(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function countGatherers(ev) {
  const blob = ev.all;
  const declared = maxNumeric(blob, [
    /\bgatherers?\b\s*[:=]\s*(\d+)/gi,
    /(\d+)\s+(?:cheap[- ]model\s+|cheap\s+|low[- ]cost\s+)?gatherers?\b/gi,
    /gatherers?\s*=\s*(\d+)/gi,
    /"gatherers?"\s*:\s*(\d+)/gi,
  ]);
  const byCalls = ev.calls.filter((call) => GATHERER_RE.test(call) && (CHEAP_RE.test(call) || /spawn_agent|Task|agent\(/i.test(call))).length;
  const byRoles = occurrenceCount(blob, /"role"\s*:\s*"gatherer"/gi) + occurrenceCount(blob, /"subagent_type"\s*:\s*"gatherer"/gi);
  return Math.max(declared, byCalls, byRoles);
}

function countVerifiers(ev) {
  const blob = ev.all;
  const declared = maxNumeric(blob, [
    /\b(?:adversarial\s+)?verifiers?\b\s*[:=]\s*(\d+)/gi,
    /(\d+)\s+adversarial\s+verifiers?\b/gi,
    /adversarial_verifiers?\s*=\s*(\d+)/gi,
    /"verifiers?"\s*:\s*(\d+)/gi,
  ]);
  const byCalls = ev.calls.filter((call) => VERIFIER_RE.test(call) && ADVERSARIAL_RE.test(call)).length;
  const byRoles = occurrenceCount(blob, /"role"\s*:\s*"adversarial[-_ ]?verifier"/gi);
  return Math.max(declared, byCalls, byRoles);
}

function isUltracodeFanout(text, ev) {
  const combined = `${text}\n${ev.all}`;
  return ULTRACODE_RE.test(combined) && DISPATCH_RE.test(combined);
}

function persistentRouteWrong(text, ev) {
  const combined = `${text}\n${ev.all}`;
  return PERSISTENT_COLLAB_RE.test(combined) && !LARGE_PLAN_COLLAB_RE.test(ev.cmd) && ONE_SHOT_RE.test(ev.cmd);
}

export function detectUltracodeDepth(transcript) {
  const events = normalizeTranscript(transcript);
  const turn = currentTurn(events);
  const bounded = currentTurnWithPrompt(events);
  const text = joinText(bounded.filter((e) => e.role !== "tool"));
  const ev = buildEvidence(turn);
  const violations = [];

  const ultracode = isUltracodeFanout(text, ev);
  const persistentWrong = persistentRouteWrong(text, ev);
  if (!ultracode && !persistentWrong) return { verdict: "PASS", violations };

  const gatherers = countGatherers(ev);
  const verifiers = countVerifiers(ev);
  const hasLoopQuality = LOOP_QUALITY_RE.test(ev.all);
  const hasBudgetStop = BUDGET_STOP_RE.test(ev.all);
  const flatSinglePass = ultracode && gatherers > 0 && !DEEP_TOPOLOGY_RE.test(ev.all) && (FLAT_RE.test(ev.all) || (verifiers === 0 && !hasLoopQuality));

  if (flatSinglePass) {
    violations.push({
      code: "FLAT_SINGLE_PASS",
      evidence: "ultracode fan-out used a flat gather pass without adversarial verification and loop-until-dry.",
    });
  }
  if (ultracode && gatherers < 17) {
    violations.push({
      code: "DEPTH_FLOOR_GATHERERS",
      evidence: `ultracode fan-out declared ${gatherers} gatherers; required >=17 cheap-model gatherers.`,
    });
  }
  if (ultracode && verifiers < 3) {
    violations.push({
      code: "DEPTH_FLOOR_VERIFIERS",
      evidence: `ultracode fan-out declared ${verifiers} adversarial verifiers; required >=3.`,
    });
  }
  if (ultracode && hasBudgetStop && !hasLoopQuality) {
    violations.push({
      code: "BUDGET_NOT_QUALITY_STOP",
      evidence: "ultracode workflow stopped on budget/token cap instead of loop-until-dry quality stop.",
    });
  }
  if (persistentWrong) {
    violations.push({
      code: "PERSISTENT_ROUTE_WRONG",
      evidence: "persistent collab work was routed to one-shot explorers instead of large-plan:collab.",
    });
  }

  return {
    verdict: violations.length > 0 ? "FLAG" : "PASS",
    violations,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") return "✅ ultracode-depth-gate PASS";
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ ultracode-depth-gate FLAG — ${codes}\n${result.violations
    .map((v) => `  • ${v.code}: ${v.evidence}`)
    .join("\n")}`;
}
