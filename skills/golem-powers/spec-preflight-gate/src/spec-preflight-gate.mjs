// spec-preflight-gate (gen-18 Track 1 #9) — spawn spec/handoff preflight gate.
//
// Evidence for preflight comes from tool calls and tool_result outputs in the
// CURRENT turn. Assistant prose can create context, but it cannot verify file
// existence, clear identity mismatches, or prove a user-space workaround.

import { normalizeTranscript, currentTurn } from "../lib/transcript.mjs";

const DISPATCH_TOOL_RE = /^(spawn_agent|Task|send_to|send_to_agent|agent|parallel)$/i;
const SPEC_PATH_RE =
  /(?:^|["'`\s(\/])((?:\.{0,2}\/)?(?:docs\/plan\/|docs\.local\/|handoffs?\/|collab\/|plans\/)[A-Za-z0-9_.\/-]*(?:spec|handoff|plan|brief|spawn|preflight|hygiene)?[A-Za-z0-9_.\/-]*\.(?:md|markdown|json|yaml|yml))/gi;
const FILE_CHECK_RE = /\b(test\s+-[fe]\s+|ls\s+(?:-[A-Za-z]+\s+)*|cat\s+|grep\s+|sed\s+-n\s+|head\s+|tail\s+|stat\s+|wc\s+)/i;
const READ_TOOL_RE = /^(Read|read_file)$/i;
const LOAD_BEARING_FILENAME_RE =
  /\b(exactly|must|source of truth|load[- ]?bearing|do not search|only file|the file|load before coding|use .* as the source)\b/i;
const STRUCTURAL_CITATION_RE =
  /\b(grep[- ]?patterns?|ripgrep|rg\s+-n|structural[- ]?invariants?|invariants?|patterns?)\b/i;
const HUMAN_BLOCKER_RE =
  /\b(needs?\s+sudo|can't\s+install|cannot\s+install|blocked,\s*needs?\s+Etan|needs?\s+Etan|human[- ]only|requires?\s+admin|permission denied)\b/i;
const SETUP_RE = /\b(install(?:er)?|setup|configure|bootstrap|prebuild)\b/i;
const USERSPACE_WORKAROUND_RE =
  /(--appdir|~\/Applications|\$HOME|\bHOME=|\bAPP_HOME=|shared\.env|source\s+.*shared\.env|\/Users\/[^ \n]*(?:Applications|\.local|bin|share)|\.local\/|--prefix\s+\$?HOME|--user\b|--no-sudo)/i;
const NEGATED_HUMAN_BLOCKER_RE =
  /\b(?:does\s+not|doesn't|do\s+not|don't|no|not|without)\s+(?:need|needs|require|requires)\s+Etan\b/i;

function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function normIdentity(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/(?:claude|codex|cursor|gemini|worker|lead|agent|seat)$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function collectSpecPaths(text) {
  const paths = new Set();
  for (const match of text.matchAll(SPEC_PATH_RE)) {
    const path = (match[1] ?? "").replace(/^["'`(]+|["'`)]+$/g, "");
    if (path) paths.add(path);
  }
  return [...paths];
}

function pathRegex(path) {
  return new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function preserveDirectJsonlContent(transcript) {
  const wrap = (item) => {
    if (
      item &&
      typeof item === "object" &&
      typeof item.role === "string" &&
      Object.hasOwn(item, "content") &&
      !item.message &&
      !item.type
    ) {
      return { message: item };
    }
    return item;
  };
  if (Array.isArray(transcript)) return transcript.map(wrap);
  return wrap(transcript);
}

function buildTimeline(turn) {
  const items = [];
  let index = 0;
  for (const ev of turn) {
    for (const tool of ev.tools ?? []) {
      const name = baseName(tool.name);
      const input = tool.input ?? {};
      const inputText = textOf(input);
      const command = name === "Bash" && typeof input.command === "string" ? input.command : "";
      items.push({
        index: index++,
        kind: "call",
        name,
        input,
        text: `${name}\n${inputText}\n${command}`,
      });
    }
    if (ev.role === "tool") {
      items.push({
        index: index++,
        kind: "output",
        name: "tool_result",
        input: {},
        text: ev.text ?? "",
      });
    }
  }
  return items;
}

function isDispatch(item) {
  return item.kind === "call" && DISPATCH_TOOL_RE.test(item.name);
}

function verifiedBefore(path, timeline, dispatchIndex) {
  const pathRe = pathRegex(path);
  return timeline.some((item) => {
    if (item.index >= dispatchIndex || item.kind !== "call" || !pathRe.test(item.text)) return false;
    if (READ_TOOL_RE.test(item.name)) return true;
    if (item.name === "Bash" && FILE_CHECK_RE.test(item.text)) return true;
    return false;
  });
}

function identityValues(input, text) {
  const name = input.name ?? input.agent ?? input.agent_name ?? input.label ?? input.seat ?? "";
  const repo = input.repo ?? input.repository ?? input.cwd_repo ?? "";
  const launcher = input.launcher ?? input.launcherName ?? input.launcher_name ?? "";
  const promptIdentity = text.match(/\byou are\s+([A-Za-z0-9_.-]+)/i)?.[1] ?? "";
  return { name, repo, launcher, promptIdentity };
}

function identityDrift(item) {
  const { name, repo, launcher, promptIdentity } = identityValues(item.input, item.text);
  const labeled = [
    ["name", name],
    ["repo", repo],
    ["launcher", launcher],
    ["prompt", promptIdentity],
  ]
    .map(([label, value]) => [label, normIdentity(value)])
    .filter(([, value]) => value);
  if (labeled.length < 2) return false;
  const reference = labeled[0][1];
  return labeled.some(([, value]) => value !== reference);
}

function isShellCall(item) {
  return item.kind === "call" && (item.name === "Bash" || typeof item.input?.command === "string");
}

function isWorkaroundAttempt(item) {
  return isShellCall(item) && USERSPACE_WORKAROUND_RE.test(item.text) && SETUP_RE.test(item.text);
}

function isHumanBlockerOutput(item) {
  if (item.kind !== "output") return false;
  const withoutNegatedPhrases = item.text.replace(NEGATED_HUMAN_BLOCKER_RE, "");
  return HUMAN_BLOCKER_RE.test(withoutNegatedPhrases);
}

export function detectSpecPreflight(transcript) {
  const events = normalizeTranscript(preserveDirectJsonlContent(transcript));
  const turn = currentTurn(events);
  const timeline = buildTimeline(turn);
  const dispatches = timeline.filter(isDispatch);
  const violations = [];

  for (const dispatch of dispatches) {
    const paths = collectSpecPaths(dispatch.text);
    for (const specPath of paths) {
      if (!verifiedBefore(specPath, timeline, dispatch.index)) {
        violations.push({
          code: "SPEC_FILE_UNVERIFIED",
          evidence: `${specPath} was referenced in a dispatch brief before any same-turn Read/cat/ls/test -f check of that path.`,
        });
        break;
      }
    }

    if (
      paths.length > 0 &&
      LOAD_BEARING_FILENAME_RE.test(dispatch.text) &&
      !STRUCTURAL_CITATION_RE.test(dispatch.text)
    ) {
      violations.push({
        code: "BRIEF_CITES_EXACT_FILENAME",
        evidence: "dispatch brief made an exact spec/handoff filename load-bearing without grep-patterns or structural invariants.",
      });
    }

    if (identityDrift(dispatch)) {
      violations.push({
        code: "IDENTITY_DRIFT",
        evidence: "spawned seat identity fields disagree across name/repo/launcher/prompt.",
      });
    }
  }

  const allToolEvidence = timeline.map((item) => item.text).join("\n");
  const setupContext = SETUP_RE.test(allToolEvidence);
  const blockerItems = timeline.filter(isHumanBlockerOutput);
  const blockerIndex = blockerItems.length ? blockerItems[blockerItems.length - 1].index : -1;
  if (setupContext && blockerIndex !== -1) {
    const workaroundBeforeBlocker = timeline.some(
      (item) => item.index < blockerIndex && isWorkaroundAttempt(item),
    );
    if (!workaroundBeforeBlocker) {
      violations.push({
        code: "BLOCKER_NO_WORKAROUND",
        evidence: "setup/install blocker was declared human-only before any visible user-space workaround attempt.",
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const violation of violations) {
    if (seen.has(violation.code)) continue;
    seen.add(violation.code);
    unique.push(violation);
  }

  return {
    verdict: unique.length > 0 ? "FLAG" : "PASS",
    violations: unique,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") return "✅ spec-preflight-gate PASS";
  const codes = result.violations.map((v) => v.code).join(", ");
  return `⛔ spec-preflight-gate FLAG — ${codes}\n${result.violations
    .map((v) => `  • ${v.code}: ${v.evidence}`)
    .join("\n")}`;
}
