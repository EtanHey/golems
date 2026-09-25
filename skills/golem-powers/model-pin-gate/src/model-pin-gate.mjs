import { recentAssistantModel } from "../lib/transcript.mjs";

const RAW_SPAWN_TOOLS = new Set(["Agent", "Task", "Workflow"]);
const CMUX_SPAWN_TOOLS = new Set(["spawn_agent", "dispatch_to_agent", "new_split"]);
const WORKER_MODEL_RE = /\b(opus|sonnet|haiku)\b/i;
const FABLE_RE = /\bfable\b/i;
const FABLE_MODEL_ARG_RE = /(?:^|\s)-m\s+(?:claude-)?fable\S*|\bclaude-fable-\S*\b/i;
const APEX_SEATS = new Set(["orchestrator", "orc", "orcclaude", "skillcreatorlead"]);

function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function modelText(input) {
  if (!isObject(input)) return "";
  const value =
    input.model ??
    input.model_name ??
    input.modelName ??
    input.target_model ??
    input.targetModel ??
    input.launcher_model ??
    input.launcherModel;
  return stringValue(value);
}

function isFableModel(model) {
  return FABLE_RE.test(String(model ?? ""));
}

function hasNonFableModelPin(input) {
  const model = modelText(input);
  return Boolean(model && !isFableModel(model) && WORKER_MODEL_RE.test(model));
}

const IDENT_CHAR_RE = /[A-Za-z0-9_$]/;

// Skips a string or template literal starting at `start` (the opening quote) and
// returns the index just past its closing quote. Template `${...}` holes are
// skipped as opaque expressions so a backtick or brace inside them cannot end
// the literal early.
function skipStringLiteral(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") { i += 2; continue; }
    if (quote === "`" && ch === "$" && source[i + 1] === "{") {
      i = skipTemplateHole(source, i + 2);
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

function skipTemplateHole(source, start) {
  let i = start;
  let depth = 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipStringLiteral(source, i); continue; }
    if (ch === "{") { depth += 1; i += 1; continue; }
    if (ch === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return source.length;
}

// Skips a regex literal starting at `start` (the opening slash) and returns the index just past
// its closing slash + flags. AIDEV-NOTE 2026-09-05 (W9b, Macroscope 5): without this, `/\//` — which
// ENDS in two slashes — was read as a line comment and swallowed the rest of the line, so
// `const slash = /\//; agent({prompt:'w'})` reported ZERO agent calls and the unpinned spawn passed.
function skipRegexLiteral(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "\n") return start + 1;           // unterminated — not a regex after all
    if (ch === "[") { inClass = true; i += 1; continue; }
    if (ch === "]") { inClass = false; i += 1; continue; }
    if (ch === "/" && !inClass) {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i])) i += 1;  // flags
      return i;
    }
    i += 1;
  }
  return source.length;
}

// A `/` starts a regex literal only where a VALUE may start — never after an operand. Division
// (`total / count`, `f(x) / 2`, `a[0] / 2`) follows an identifier, `)`, `]`, or a literal; a regex
// follows an operator, a bracket that opens a value position, or one of these keywords.
const REGEX_OK_AFTER_CHARS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_OK_AFTER_WORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
function regexCanStart(previousSignificant, previousWord) {
  if (previousWord) return REGEX_OK_AFTER_WORDS.has(previousWord);
  return REGEX_OK_AFTER_CHARS.has(previousSignificant);
}

// Skips whitespace AND comments from `start`. AIDEV-NOTE 2026-09-05 (W9b, Macroscope 3): the
// identifier -> `(` lookahead skipped whitespace only, so `agent/* pin omitted */({prompt:'w'})`
// was not recognized as a call at all and the unpinned spawn passed.
function skipTrivia(source, start) {
  let i = start;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i += 1; continue; }
    if (source[i] === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      i = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    return i;
  }
  return i;
}

// Decodes JS string escapes in a quoted KEY so `"\model"` and `"model"` — both of which a real
// JS parser reads as the key `model` — are recognized. AIDEV-NOTE 2026-09-05 (W9b, Macroscope 2).
const SINGLE_ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
function decodeStringEscapes(raw) {
  if (!raw.includes("\\")) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== "\\") { out += raw[i]; i += 1; continue; }
    const next = raw[i + 1];
    if (next === "u" && raw[i + 2] === "{") {
      const close = raw.indexOf("}", i + 3);
      const hex = close === -1 ? "" : raw.slice(i + 3, close);
      if (/^[0-9a-f]+$/i.test(hex)) {
        out += String.fromCodePoint(parseInt(hex, 16));
        i = close + 1;
        continue;
      }
    }
    if (next === "u" && /^[0-9a-f]{4}$/i.test(raw.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
      i += 6;
      continue;
    }
    if (next === "x" && /^[0-9a-f]{2}$/i.test(raw.slice(i + 2, i + 4))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 4), 16));
      i += 4;
      continue;
    }
    // A `\`-newline is a LINE CONTINUATION: it contributes nothing, so `"mo\<newline>del"` is the
    // key `model`. AIDEV-NOTE 2026-09-05 (W9b round 1, Macroscope 174): emitting a literal newline
    // here left such a key unpinned and false-BLOCKED the call. CRLF and the Unicode line
    // separators count too.
    if (next === "\n" || next === "\u2028" || next === "\u2029") { i += 2; continue; }
    if (next === "\r") { i += raw[i + 2] === "\n" ? 3 : 2; continue; }
    // Any other escape is the character itself — `\m` is `m`, which is what made `"\model"` a key.
    out += Object.prototype.hasOwnProperty.call(SINGLE_ESCAPES, next) ? SINGLE_ESCAPES[next] : next;
    i += 2;
  }
  return out;
}

// A computed key written as `['model']:` / `["model"]:`. AIDEV-NOTE 2026-09-05 (W9b, Macroscope 1).
// AIDEV-NOTE 2026-09-05 (W9b round 1, Macroscope 262): this was a regex over a fixed 64-char slice,
// which missed keys padded with long whitespace or a comment and false-BLOCKED them. It now walks
// the real tokens with skipTrivia, so comments and any amount of whitespace are handled and the
// scan stays linear. `start` is the index of the `[`; returns true when the bracket is exactly a
// computed `model` key followed by its colon.
function isComputedModelKey(source, start) {
  const openQuote = skipTrivia(source, start + 1);
  const quote = source[openQuote];
  if (quote !== '"' && quote !== "'") return false;
  const afterString = skipStringLiteral(source, openQuote);
  if (decodeStringEscapes(source.slice(openQuote + 1, afterString - 1)) !== "model") return false;
  const closeBracket = skipTrivia(source, afterString);
  if (source[closeBracket] !== "]") return false;
  return source[skipTrivia(source, closeBracket + 1)] === ":";
}

// Is this `model` identifier a KEY in an object literal, rather than a value or an argument?
// `model:` in any form is a key. Bare shorthand (`{ ...defaults, model }`) is a key only when the
// innermost bracket is an object literal AND `model` sits where a key can start (right after `{`
// or a `,`) and ends where a key/value pair can end (a `,` or the closing `}`). That excludes
// `{ label: model }` (value position, previous char is `:`) and `f(a, model, b)` (innermost
// bracket is a call paren, not an object literal).
function isModelKey(previousSignificant, nextSignificant) {
  if (nextSignificant === ":") return true;
  if (previousSignificant !== "{" && previousSignificant !== ",") return false;
  return nextSignificant === "," || nextSignificant === "}";
}

// A pin counts only when it sits in the agent call's OWN top-level options object: the key's
// immediately-enclosing bracket is an object literal `{` whose parent is that agent call's `(`.
// AIDEV-NOTE 2026-09-05 (W9b, Macroscope 4): pinning the nearest ENCLOSING agent frame at any depth
// let `agent({ prompt: buildPrompt({ model: 'opus' }) })` count as pinned — the key belonged to
// buildPrompt's argument, not to the spawn. A nested object (`{ schema: { model: {...} } }`) is
// likewise not a pin.
function pinOwningAgentCall(brackets, calls) {
  const innermost = brackets[brackets.length - 1];
  if (!innermost || innermost.char !== "{") return;
  const parent = brackets[brackets.length - 2];
  if (!parent || parent.callIndex == null) return;
  calls[parent.callIndex].pinned = true;
}

// AIDEV-NOTE 2026-09-05 (W9, Macroscope finding on skill-creator #51): this used to compare the raw
// count of `model:` occurrences to the raw count of `agent(` occurrences, so ANY pin anywhere in the
// script covered for an unpinned call — `const defaults = { model: 'opus' }; agent({prompt:'work'})`
// scored 1 call / 1 pin and passed, and after WEEKLY_RESET_AT that false negative lets an unpinned
// spawn through a BLOCKING rule. Pins are now attributed to the innermost enclosing agent() call, so
// only a `model` key inside a call's own argument list pins that call. String- and comment-aware, so
// `// model: 'opus'` and 'set model: opus' in a prompt no longer pin anything. No dependencies.
// Return shape ({ agentCalls, modelPins }) is unchanged for the caller.
// AIDEV-NOTE 2026-09-05 (lead review round 1 on #52): the pin is the KEY, not the value form. This
// rule BLOCKS from WEEKLY_RESET_AT, so judging the value would false-block a legitimately pinned
// script — `model: 'opus'`, `model: someVar` and shorthand `{ ...defaults, model }` all count. A
// spread alone stays uncounted: the gate cannot see what `...defaults` carries.
function workflowCounts(script) {
  const source = typeof script === "string" ? script : "";
  const brackets = [];          // open (, {, [ — each carries its char and the agent() call it opened
  const calls = [];             // one entry per agent( call, in source order
  let lastString = null;        // last completed simple string, for quoted `"model":` keys
  let lastStringEnd = -1;
  let lastSignificant = "";     // previous non-whitespace char, to tell a shorthand key from a value
  let lastWord = "";            // previous identifier, to tell `return /re/` from `a / b`
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    // AIDEV-NOTE 2026-09-05 (W9b round 1, Macroscope 234): comments MUST be recognized before the
    // regex probe. `//` in a regex-eligible position parses as a valid empty regex literal, so the
    // probe consumed the two slashes and the COMMENT BODY was then read as code — `agent(...)`
    // inside a comment became a real unpinned call and BLOCKED a properly pinned script. A regex
    // literal never begins `//` or `/*`, so checking comments first costs nothing.
    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      i = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === "/" && regexCanStart(lastSignificant, lastWord)) {
      const end = skipRegexLiteral(source, i);
      if (end > i + 1) {
        lastSignificant = "/";
        lastWord = "";
        i = end;
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipStringLiteral(source, i);
      lastString = ch === "`" ? null : decodeStringEscapes(source.slice(i + 1, end - 1));
      lastStringEnd = end;
      lastSignificant = ch;
      lastWord = "";
      i = end;
      continue;
    }
    if (ch === "[") {
      if (isComputedModelKey(source, i)) {
        pinOwningAgentCall(brackets, calls);
      }
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      brackets.push({ char: ch, callIndex: null });
      lastSignificant = ch;
      lastWord = "";
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      brackets.pop();
      lastSignificant = ch;
      lastWord = "";
      i += 1;
      continue;
    }
    if (ch === ":") {
      // quoted key: "model": / 'model':
      if (lastString === "model" && !source.slice(lastStringEnd, i).trim()) {
        pinOwningAgentCall(brackets, calls);
      }
      lastSignificant = ch;
      lastWord = "";
      i += 1;
      continue;
    }
    if (IDENT_CHAR_RE.test(ch)) {
      let end = i;
      while (end < source.length && IDENT_CHAR_RE.test(source[end])) end += 1;
      const word = source.slice(i, end);
      const previous = i > 0 ? source[i - 1] : "";
      const after = skipTrivia(source, end);
      if (word === "agent" && !IDENT_CHAR_RE.test(previous) && source[after] === "(") {
        calls.push({ pinned: false });
        brackets.push({ char: "(", callIndex: calls.length - 1 });
        lastSignificant = "(";
        i = after + 1;
        continue;
      }
      if (word === "model" && isModelKey(lastSignificant, source[after])) {
        pinOwningAgentCall(brackets, calls);
      }
      lastSignificant = source[end - 1];
      lastWord = word;
      i = end;
      continue;
    }
    if (!/\s/.test(ch)) { lastSignificant = ch; lastWord = ""; }
    i += 1;
  }

  return {
    agentCalls: calls.length,
    modelPins: calls.filter((call) => call.pinned).length,
  };
}

function normalizedSeatId(value) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isApexSeatId(value) {
  const normalized = normalizedSeatId(value);
  return APEX_SEATS.has(normalized);
}

function payloadSeatId(payload, input) {
  const candidates = [
    payload.seat_id,
    payload.seatId,
    payload.seat,
    payload.agent_id,
    payload.agentId,
    payload.agent_name,
    payload.agentName,
    payload.launcher_name,
    payload.launcherName,
    payload.session_name,
    payload.sessionName,
    input?.seat_id,
    input?.seatId,
    input?.parent_agent_id,
    input?.parentAgentId,
    input?.launcher_name,
    input?.launcherName,
  ];
  for (const candidate of candidates) {
    const value = stringValue(candidate);
    if (value) return value;
  }
  return "";
}

function inputCommandText(input) {
  if (!isObject(input)) return "";
  return [
    input.command,
    input.cmd,
    input.shell_command,
    input.shellCommand,
  ].map(stringValue).filter(Boolean).join(" ");
}

function workflowFablePin(input) {
  const script = stringValue(input?.script);
  if (!script) return "";
  const match = /\bmodel\s*:\s*["'`]([^"'`]*fable[^"'`]*)["'`]/i.exec(script);
  return match?.[1] ?? "";
}

function cmuxFableTarget(tool, input) {
  if (!CMUX_SPAWN_TOOLS.has(tool)) return "";
  const directModel = modelText(input);
  if (isFableModel(directModel)) return directModel;
  if (tool !== "new_split") return "";
  const command = inputCommandText(input);
  return FABLE_MODEL_ARG_RE.test(command) ? "new_split command targets Fable" : "";
}

function emptyResult(verdict = "PASS") {
  return {
    verdict,
    seatModel: "",
    seatId: "",
    tool: "",
    violations: [],
    advisories: [],
  };
}

// AIDEV-NOTE 2026-09-05 (Etan, relayed by orc, amended same day): "rn we are using them in workflows if
// needed, since we have too much usage to burn, but yeah usually true." The 07-18 Fable blocks and the
// unpinned-agent() Workflow rule are ADVISORY until the weekly usage reset, then they block again. Keyed on
// the clock so nobody has to flip it at 05:05 IDT; `payload.now` (ISO string) overrides the clock for replay.
export const WEEKLY_RESET_AT = "2026-09-06T02:05:00Z"; // ~05:05 IDT 2026-09-06

export function weeklyResetPassed(payload, resetAt = WEEKLY_RESET_AT) {
  const raw = payload?.now;
  const now = raw == null ? Date.now() : Date.parse(String(raw));
  const at = Date.parse(resetAt);
  if (!Number.isFinite(now) || !Number.isFinite(at)) return false;
  return now >= at;
}

export function detectModelPin(payload) {
  const result = emptyResult();
  if (!isObject(payload)) return result;

  const tool = baseName(payload.tool_name ?? payload.toolName);
  result.tool = tool;
  if (!RAW_SPAWN_TOOLS.has(tool) && !CMUX_SPAWN_TOOLS.has(tool)) return result;

  const input = payload.tool_input ?? payload.toolInput;
  if (!isObject(input)) return result;

  const seatModel = recentAssistantModel(payload.transcript);
  const seatId = payloadSeatId(payload, input);
  // AIDEV-NOTE: Etan order 2026-07-16 ("break through that model pin gate") + recovered voice transcript
  // ("I'm totally fine with using Fable for this... if you need, just open a[ gate exception]"):
  // sessions don't always carry seat_id; by fleet economics ONLY apex seats (orc, skillcreatorLead)
  // run Fable at all, so a seat ALREADY RUNNING Fable with no seat_id is apex by inference.
  // Non-Fable unknown seats remain blocked from pinning Fable (the original protection).
  const apexSeat = isApexSeatId(seatId) || (!seatId && isFableModel(recentAssistantModel(payload.transcript)));
  result.seatModel = seatModel;
  result.seatId = seatId;

  const pinnedModel = modelText(input);
  const cmuxTarget = cmuxFableTarget(tool, input);
  const workflowTarget = tool === "Workflow" ? workflowFablePin(input) : "";
  const fableTarget = cmuxTarget || workflowTarget || (isFableModel(pinnedModel) ? pinnedModel : "");

  // Original protection, no amnesty: a non-apex seat may not target Fable at all.
  if (fableTarget && !apexSeat) {
    return {
      ...result,
      verdict: "FLAG",
      violations: [
        {
          code: CMUX_SPAWN_TOOLS.has(tool)
            ? "MODELPIN_CMUX_FABLE_TARGET"
            : "MODELPIN_FABLE_BELOW_APEX",
          evidence: `${tool} targets ${fableTarget} from non-apex seat ${seatId || "(unknown-seat)"}`,
          action: "pin this spawn to model:'sonnet' for bulk work, model:'opus' for reasoning/review, or use Fable only from orchestrator/skillcreatorLead",
        },
      ],
    };
  }

  // Sources:
  // docs.local/sprint/weave-2026-07-06-drift/sources/etan-dashboard-answers.md:D1
  // docs.local/agent-registry.json:60
  // AIDEV-NOTE 2026-07-18 (Etan law, hard — after Fable reviewer seats ran Fable-filled workflows
  // and drained the weekly budget; enabled by the earlier fable-seat-infers-apex patch):
  // WORKFLOWS ARE OPUS-ONLY FOR EVERYONE. A fable pin inside a Workflow script is BLOCKED
  // regardless of seat — apex included. Fable = seat-class only (driver/leads/reviewers as SEATS).
  // AIDEV-NOTE 2026-07-18 THIRD BURN, FINAL FORM (Etan): the fable-seat-infers-apex inference let a
  // Fable REVIEWER pin fable Agent/Task subagents (workflow block alone was insufficient — burned the
  // 5h window again). LAW, literal: FABLE IS NEVER A SUBAGENT TARGET from ANY seat. Agent/Task/Workflow
  // fable pins are ALL blocked. Fable enters the fleet ONLY as a pane SEAT (cmux spawn / Etan's manual flip).
  // AIDEV-NOTE 2026-09-05: until skill-creator captured this file (#50) both blocks above set a flag
  // nothing read and pushed onto an array the result never had, so they THREW and the hook's catch-all
  // allowed the spawn. They had been failing open since they landed. From this patch they are real
  // verdicts: ADVISORY until WEEKLY_RESET_AT (Etan 2026-09-05 amnesty), FLAG after.
  if (workflowTarget || (fableTarget && !cmuxTarget)) {
    const finding = workflowTarget
      ? {
          code: "MODELPIN_FABLE_IN_WORKFLOW",
          evidence: `Workflow script pins ${workflowTarget} — workflows are opus-only for ALL seats (Etan law 2026-07-18; a Fable workflow burned the 5h window in 31min on 07-17, and Fable-reviewer workflows drained the weekly budget on 07-18)`,
          action: "pin every Workflow agent() to model:'opus' (or 'sonnet' for bulk); run Fable only as a pane SEAT",
        }
      : {
          code: "MODELPIN_FABLE_SUBAGENT",
          evidence: `${tool} pins ${fableTarget} as a SUBAGENT — fable is seat-class only (3rd budget burn 2026-07-18; no apex exception exists anymore)`,
          action: "pin model:'opus' (reasoning/review) or model:'sonnet' (bulk); run Fable only as a pane seat",
        };
    if (!weeklyResetPassed(payload)) {
      return {
        ...result,
        verdict: "ADVISORY",
        advisories: [
          {
            ...finding,
            evidence: `${finding.evidence}. ADVISORY until the weekly reset ${WEEKLY_RESET_AT} (Etan 2026-09-05: "rn we are using them in workflows if needed"); blocks again after`,
          },
        ],
      };
    }
    return { ...result, verdict: "FLAG", violations: [finding] };
  }

  // cmux Fable seat spawn from an apex seat: Fable entering as a SEAT is the one allowed path.
  if (fableTarget && apexSeat) return result;

  if (!seatModel || !isFableModel(seatModel)) return result;

  if ((tool === "Agent" || tool === "Task") && !pinnedModel) {
    return {
      ...result,
      verdict: "FLAG",
      violations: [
        {
          code: "MODELPIN_AGENT_UNPINNED",
          evidence: `${tool} call from Fable seat ${seatModel} has no tool_input.model`,
          action: "pin this spawn to model:'sonnet' for bulk work, model:'opus' for reasoning/review, or use an explicit Fable pin only from orchestrator/skillcreatorLead",
        },
      ],
    };
  }

  if ((tool === "Agent" || tool === "Task") && hasNonFableModelPin(input)) {
    return result;
  }

  if (tool === "Workflow") {
    const { agentCalls, modelPins } = workflowCounts(input.script);
    if (agentCalls > modelPins) {
      const evidence = `Workflow script has ${agentCalls} agent() calls, ${modelPins} of which carry a model: pin inside their own argument list (${agentCalls - modelPins} unpinned)`;
      const action = "ensure every agent() call carries model:'opus'|'sonnet'|'haiku'";
      // AIDEV-NOTE 2026-09-05 (Etan ruling 8A via orc): unpinned agent() calls from a Fable seat BLOCK
      // once the weekly reset passes, so the next 7-day window runs under the new set. Advisory until then.
      if (weeklyResetPassed(payload)) {
        return {
          ...result,
          verdict: "FLAG",
          violations: [{ code: "MODELPIN_WORKFLOW_AGENT_UNPINNED", evidence, action }],
        };
      }
      return {
        ...result,
        verdict: "ADVISORY",
        advisories: [{ code: "MODELPIN_WORKFLOW_AGENT_MODEL_ADVISORY", evidence, action }],
      };
    }
  }

  return result;
}
