// Transcript normalizer — turns any of the transcript shapes the spine gates
// see into ONE uniform event stream, so the detectors read ground-truth, not an
// invented schema. (Vendored per-skill for self-containment; identical to the
// copy in idle-dwell-gate.) Shapes handled:
//
//   1. A spine fixture object: { events: [{ role, text, tools }] } — already
//      normalized; passed through (tools default []).
//   2. Raw Claude Code JSONL: an array of line-objects
//      { type, message: { role, content: [ blocks ] } } where a block is
//      { type: "text"|"thinking"|"tool_use"|"tool_result", name, input, ... }.
//   3. A `claude -p --output-format json` result: { result: "<text>" } or a
//      bare string — one assistant event (matches the T6 harness transcriptText
//      fallback so hand-authored fixtures stay simple).
//
// Output: [{ role: "user"|"assistant"|"tool", text: string, tools: [{name,input}] }]
//   - role "tool" = a tool_result (carries the OBSERVED output — what a live probe
//     actually returned; the false-green gate reads these for ffprobe/curl/stamp
//     evidence).
//   - role "user" = a genuine human turn (used to bound "the current turn").

const TEXT_BLOCK_TYPES = new Set(["text", "thinking"]);

function blockText(block) {
  if (block == null) return "";
  if (typeof block === "string") return block;
  if (typeof block.text === "string") return block.text;
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(blockText).join("\n");
  return "";
}

function isToolResultMessage(content) {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every(
    (b) => b && typeof b === "object" && b.type === "tool_result",
  );
}

function eventsFromJsonlLine(line) {
  if (line == null || typeof line !== "object") return [];
  const message = line.message ?? line;
  const role = message.role ?? line.type;
  const content = message.content;

  if (typeof content === "string") {
    return [{ role: role === "assistant" ? "assistant" : "user", text: content, tools: [] }];
  }
  if (!Array.isArray(content)) return [];

  if (role === "user" && isToolResultMessage(content)) {
    return content.map((b) => ({ role: "tool", text: blockText(b), tools: [] }));
  }

  const text = content
    .filter((b) => b && TEXT_BLOCK_TYPES.has(b.type))
    .map(blockText)
    .join("\n");
  const tools = content
    .filter((b) => b && b.type === "tool_use")
    .map((b) => ({ name: b.name ?? "", input: b.input ?? {} }));

  if (!text && tools.length === 0) return [];
  return [{ role: role === "assistant" ? "assistant" : "user", text, tools }];
}

export function normalizeTranscript(transcript) {
  if (transcript == null) return [];

  if (typeof transcript === "string") {
    return [{ role: "assistant", text: transcript, tools: [] }];
  }
  if (typeof transcript === "object" && !Array.isArray(transcript)) {
    if (Array.isArray(transcript.events)) {
      return transcript.events.map((e) => ({
        role: e.role ?? "assistant",
        text: typeof e.text === "string" ? e.text : "",
        tools: Array.isArray(e.tools) ? e.tools.map((t) => ({ name: t.name ?? "", input: t.input ?? {} })) : [],
      }));
    }
    if (typeof transcript.result === "string") {
      return [{ role: "assistant", text: transcript.result, tools: [] }];
    }
    if (transcript.type || transcript.message) return eventsFromJsonlLine(transcript);
    return [];
  }

  return transcript.flatMap((item) => {
    if (item && typeof item === "object" && typeof item.role === "string" && !item.message && !item.type) {
      return [{
        role: item.role,
        text: typeof item.text === "string" ? item.text : "",
        tools: Array.isArray(item.tools) ? item.tools.map((t) => ({ name: t.name ?? "", input: t.input ?? {} })) : [],
      }];
    }
    return eventsFromJsonlLine(item);
  });
}

export function allTools(events) {
  return events.flatMap((e) => e.tools ?? []);
}

// The slice of events forming the CURRENT turn: everything after the last
// genuine human (`role: "user"`) message. Tool results and assistant turns
// since the last human prompt are "this turn" — what the agent did before its
// terminal claim. If there is no human turn, the whole transcript is the turn.
export function currentTurn(events) {
  let lastUser = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].role === "user") { lastUser = i; break; }
  }
  return events.slice(lastUser + 1);
}

export function terminalAssistant(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].role === "assistant") return events[i];
  }
  return null;
}

export function joinText(events) {
  return events.map((e) => e.text ?? "").filter(Boolean).join("\n");
}

// ── Quote-awareness (shared by false-green-gate and qa-verdict-gate) ─────────
// Text that can contain claim words without being the assistant's OWN claim:
// code/path literals, questions, future/conditional planning, and quoted relays
// from another agent. Both gates must strip the SAME spans before matching —
// qa-verdict-gate previously matched raw text and fired on backticked commit
// subjects the assistant was merely quoting (2026-08-06 misfire).
const CLAIM_WORDS = "done|fixed|green|verified|deployed|published|shipped|complete|live";
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const ATTRIBUTED_QUOTE_RE = new RegExp(
  `\\b(?:worker|agent|lead|reviewer|codex|cursor|claude|they|he|she)\\s+(?:wrote|said|reported|claimed|commented):\\s*"[^"\\n]*(?:${CLAIM_WORDS})[^"\\n]*"`,
  "gi",
);
const PATH_WITH_CLAIM_WORD_RE = new RegExp(`\\b[\\w.-]*\\/[\\w./-]*(?:${CLAIM_WORDS})[\\w./-]*\\b`, "gi");
const QUESTION_SENTENCE_RE = new RegExp(`(^|[.!?\\n]\\s*)([^.!?\\n]*\\b(?:${CLAIM_WORDS})\\b[^.!?\\n]*\\?)`, "gi");
const FUTURE_OR_CONDITIONAL_RE = new RegExp(
  `\\b(?:(?:once|when|after|if)\\b[^.!?\\n]{0,120}\\b(?:will|would|can|could)\\s+be\\s+(?:${CLAIM_WORDS})|(?:will|would|can|could)\\s+be\\s+(?:${CLAIM_WORDS}))\\b`,
  "gi",
);
const MARK_COMPLETE_RE = new RegExp(
  `\\b(?:before\\s+i\\s+can\\s+|need\\s+.+?\\s+before\\s+i\\s+can\\s+)?mark\\s+(?:it|this|the\\s+\\w+)\\s+(?:${CLAIM_WORDS})\\b`,
  "gi",
);
const NOT_CALLING_COMPLETE_RE = new RegExp(
  `\\bnot\\s+(?:calling|marking|reporting|claiming)\\s+(?:it|this|the\\s+\\w+)?\\s*(?:${CLAIM_WORDS})(?:\\s+yet)?\\b`,
  "gi",
);

export function claimSearchText(text) {
  return String(text ?? "")
    .replace(CODE_FENCE_RE, " ")
    .replace(INLINE_CODE_RE, " ")
    .replace(ATTRIBUTED_QUOTE_RE, " ")
    .replace(PATH_WITH_CLAIM_WORD_RE, " ")
    .replace(QUESTION_SENTENCE_RE, "$1 ")
    .replace(FUTURE_OR_CONDITIONAL_RE, " ")
    .replace(MARK_COMPLETE_RE, " ")
    .replace(NOT_CALLING_COMPLETE_RE, " ");
}
