// approval-comms-gate (gen-18 Track 1 #7) — approval + comms doctrine gate.
//
// THE REGRESSIONS it closes:
// - R-004: visual approval routed to a dead outbox.md append path / scattered
//   markdown instead of the live operator channel.
// - in-policy PR parking: CI-green in-policy PRs get handed back to Etan instead
//   of admin-merged by orc.
// - incident framing-last: operator responses lead with stack/code/log detail
//   instead of the plain-English framing that tells the operator what happened
//   and what to do.
//
// Evidence for channel/probe success comes ONLY from tool calls and tool_result
// outputs in the CURRENT turn. Assistant prose can create the obligation, but it
// cannot satisfy it.

import { normalizeTranscript, currentTurn, joinText } from "../lib/transcript.mjs";

const VISUAL_APPROVAL_RE =
  /(visual|design|screenshot|mock|render|ui|image)[\s\S]{0,80}(approval|approve|sign-?off|gate|eyes)|\b(approval|approve|sign-?off|eyes)\b[\s\S]{0,80}(screenshot|mock|render|visual|design|ui|image)/i;
const VISUAL_ROUTE_RE =
  /\b(re-?send|re-?sent|send|sent|route|routed|deliver|delivered|get|request|ask|clear|cleared|gate|approval needed|needs? approval|before (shipping|closing|merge|release)|for visual approval|for design approval)\b/i;
const OUTBOX_OR_MD_RE =
  /(outbox\.md|\.golems-zikaron\/outbox|approval[^"\n]*\.md|screenshot[^"\n]*\.md|design[^"\n]*\.md|docs\.local\/.*\.(md|markdown))/i;
const SEND_USER_FILE_RE = /(^|__)SendUserFile$/i;
const SEND_USER_FILE_OK_RE =
  /SendUserFile[^\n]{0,120}\b(delivered|sent|uploaded|attached|success)\b|\b(delivered|sent|uploaded|attached|success)\b[^\n]{0,120}SendUserFile/i;
const SEND_USER_FILE_FAIL_RE = /SendUserFile[^\n]{0,120}\b(fail|failed|error|enoent|missing|denied|not found)\b/i;
const TELEGRAM_CMD_RE =
  /(send-message\.sh|api\.telegram\.org\/bot|notify-server|\/notify\b|send(Photo|Document|Message))/i;
const TELEGRAM_OK_RE = /"ok"\s*:\s*true/i;
const TELEGRAM_FAIL_RE = /("ok"\s*:\s*false|\bfail(?:ed|ure)?\b|\berror\b|\bdenied\b|\btimeout\b)/i;

const IN_POLICY_PR_RE =
  /(pr\s*#?\d+|pull request\s*#?\d+)[\s\S]{0,160}(ci[- ]?green|checks? (pass|green|success)|mergeStateStatus["=: ]+CLEAN|in[- ]?policy)|\bin[- ]?policy\b[\s\S]{0,160}(pr\s*#?\d+|pull request\s*#?\d+)/i;
const PARKED_RE =
  /(awaiting|waiting for|pending)\s+(etan'?s?\s+)?(merge|approval|go-?ahead)|want me to merge|should i merge|would you like me to merge|ready for etan to merge|etan merge/i;
const ADMIN_MERGE_RE = /gh\s+pr\s+merge\s+\d+[\s\S]{0,120}--admin|--admin[\s\S]{0,120}gh\s+pr\s+merge\s+\d+/i;
const MERGE_OK_RE = /(merged pull request|successfully merged|squash(?:ed)? and (delete|merged)|deleted branch)/i;

const INCIDENT_RE =
  /\b(incident|operator|outage|failure|failed|broke|broken|regression|not delivered|silent no-?op|alert|emergency)\b/i;
const FRAMING_FIRST_RE =
  /^\s*(plain[- ]english framing|operator framing|framing|what happened|bottom line|operator answer|operator summary)\s*:/i;
const TECH_FIRST_RE =
  /^\s*(stack|stack trace|code path|logs?|traceback|exception|error|tail -\d+|file|function|src\/|scripts\/|[A-Za-z0-9_.\/-]+\.(ts|js|mjs|py|sh|swift):\d*)(?!\w)/i;
const LATE_FRAMING_RE = /\n[\s\S]*\b(plain[- ]english framing|operator framing|framing)\s*:/i;
const INCIDENT_NOT_CLEARING_VISUAL_RE = /(not delivered|still closed|gate is still closed|next action is to resend|use the live bot api)/i;

function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

function buildEvidence(turn) {
  const cmd = [];
  const out = [];
  const calls = [];
  const outputs = [];
  for (const ev of turn) {
    if (ev.role === "tool") {
      const text = ev.text ?? "";
      if (text) out.push(text);
      outputs.push(text);
    }
    for (const t of ev.tools ?? []) {
      const name = t.name ?? "";
      const inputText = JSON.stringify(t.input ?? {});
      const commandText = baseName(name) === "Bash" && typeof t.input?.command === "string" ? t.input.command : "";
      cmd.push(name);
      cmd.push(inputText);
      if (commandText) cmd.push(commandText);
      calls.push({ name, text: `${name}\n${inputText}\n${commandText}` });
    }
  }
  const cmdBlob = cmd.join("\n");
  const outBlob = out.join("\n");
  return { cmd: cmdBlob, out: outBlob, all: `${cmdBlob}\n${outBlob}`, calls, outputs };
}

function currentTurnWithPrompt(events) {
  let lastUser = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].role === "user") { lastUser = i; break; }
  }
  return events.slice(lastUser === -1 ? 0 : lastUser);
}

function visualGateOk(turn, ev) {
  const fileDelivered = ev.calls.some((call, i) => {
    const out = ev.outputs[i] ?? "";
    return SEND_USER_FILE_RE.test(baseName(call.name)) && SEND_USER_FILE_OK_RE.test(out) && !SEND_USER_FILE_FAIL_RE.test(out);
  });
  const telegramConfirmed = ev.calls.some((call, i) => {
    const out = ev.outputs[i] ?? "";
    return TELEGRAM_CMD_RE.test(call.text) && TELEGRAM_OK_RE.test(out) && !TELEGRAM_FAIL_RE.test(out);
  });
  return fileDelivered && telegramConfirmed;
}

function adminMergeOk(ev) {
  return ADMIN_MERGE_RE.test(ev.cmd) && MERGE_OK_RE.test(ev.out);
}

function firstAssistantText(turn) {
  const assistant = turn.find((e) => e.role === "assistant" && (e.text ?? "").trim());
  return assistant?.text ?? "";
}

function incidentFramingLast(assistantTexts) {
  return assistantTexts.some((text) => TECH_FIRST_RE.test(text) && LATE_FRAMING_RE.test(text) && !FRAMING_FIRST_RE.test(text));
}

export function detectApprovalComms(transcript) {
  const events = normalizeTranscript(transcript);
  const turn = currentTurn(events);
  const bounded = currentTurnWithPrompt(events);
  const ev = buildEvidence(turn);
  const text = joinText(bounded);
  const assistantMessages = turn.filter((e) => e.role === "assistant").map((e) => e.text ?? "").filter((t) => t.trim());
  const assistantText = assistantMessages.join("\n");
  const firstText = firstAssistantText(turn);

  const violations = [];

  const visualWrongChannel = OUTBOX_OR_MD_RE.test(ev.cmd) || OUTBOX_OR_MD_RE.test(ev.out);
  const incidentFramingNotClearingVisual =
    INCIDENT_RE.test(text) && FRAMING_FIRST_RE.test(firstText) && INCIDENT_NOT_CLEARING_VISUAL_RE.test(firstText);
  if (VISUAL_APPROVAL_RE.test(text) && VISUAL_ROUTE_RE.test(text) && (!incidentFramingNotClearingVisual || visualWrongChannel) && !visualGateOk(turn, ev)) {
    violations.push({
      code: "VISUAL_GATE_WRONG_CHANNEL",
      evidence: visualWrongChannel
        ? "visual/design approval was routed through outbox.md or markdown instead of SendUserFile plus Telegram ok=true."
        : "visual/design approval lacks same-turn SendUserFile plus live Telegram bot/API ok=true confirmation.",
    });
  }

  if (IN_POLICY_PR_RE.test(text) && PARKED_RE.test(assistantText) && !adminMergeOk(ev)) {
    violations.push({
      code: "INPOLICY_PR_PARKED",
      evidence: "CI-green in-policy PR was parked for Etan/permission instead of same-turn gh pr merge --admin.",
    });
  }

  if (INCIDENT_RE.test(text) && incidentFramingLast(assistantMessages)) {
    violations.push({
      code: "INCIDENT_FRAMING_LAST",
      evidence: "incident/operator response led with stack/code/log detail and only gave plain-English framing later.",
    });
  }

  return {
    verdict: violations.length > 0 ? "FLAG" : "PASS",
    violations,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") return "✅ approval-comms-gate PASS";
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ approval-comms-gate FLAG — ${codes}\n${result.violations
    .map((v) => `  • ${v.code}: ${v.evidence}`)
    .join("\n")}`;
}
