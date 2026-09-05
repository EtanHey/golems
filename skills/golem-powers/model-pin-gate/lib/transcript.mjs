const TEXT_KEYS = ["text", "content", "message", "result", "response"];

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

export function normalizeTranscript(transcript) {
  if (Array.isArray(transcript)) return transcript;
  if (!transcript || typeof transcript !== "object") return [];
  if (Array.isArray(transcript.events)) return transcript.events;
  if (Array.isArray(transcript.messages)) return transcript.messages;
  if (Array.isArray(transcript.transcript)) return transcript.transcript;
  return [transcript];
}

export function textFrom(value, depth = 0) {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => textFrom(item, depth + 1)).filter(Boolean).join(" ");
  if (typeof value !== "object") return "";

  const parts = [];
  for (const key of TEXT_KEYS) {
    if (value[key] != null) parts.push(textFrom(value[key], depth + 1));
  }
  if (value.type === "text" && typeof value.text === "string") parts.push(value.text);
  return parts.filter(Boolean).join(" ");
}

export function modelFromEvent(event) {
  if (!event || typeof event !== "object") return "";
  const direct =
    event.model ??
    event.model_name ??
    event.modelName ??
    event?.message?.model ??
    event?.message?.model_name ??
    event?.message?.modelName ??
    event?.attrs?.model ??
    event?.attributes?.model;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  for (const child of arrayFrom(event.content ?? event.message?.content)) {
    if (child && typeof child === "object") {
      const nested = child.model ?? child.model_name ?? child.modelName;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }
  return "";
}

export function recentAssistantModel(transcript) {
  const events = normalizeTranscript(transcript);
  for (let idx = events.length - 1; idx >= 0; idx -= 1) {
    const event = events[idx];
    if (!event || typeof event !== "object") continue;
    const role = String(event.role ?? event?.message?.role ?? event.type ?? "").toLowerCase();
    const model = modelFromEvent(event);
    if (!model) continue;
    if (!role || role.includes("assistant")) return model;
  }
  return "";
}
