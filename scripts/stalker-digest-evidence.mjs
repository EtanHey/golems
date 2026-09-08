const evidenceProperties = {
  timestamp: { type: "string", pattern: "^[0-9]+:[0-9]{2}$" },
  excerpt: { type: "string", minLength: 1, maxLength: 240, description: "Exact case-sensitive contiguous substring copied from the cited segment text." },
  uncertain: { type: "boolean" },
};
function itemSchema(contentField) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["timestamp", contentField, "excerpt", "uncertain"],
    properties: { ...evidenceProperties, [contentField]: { type: "string", minLength: 1, maxLength: 400 } },
  };
}
const describedItemSchema = {
  ...itemSchema("summary"),
  required: ["timestamp", "title", "summary", "excerpt", "uncertain"],
  properties: { ...itemSchema("summary").properties, title: { type: "string", minLength: 1, maxLength: 100 } },
};
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topics", "highlights", "claims"],
  properties: {
    topics: { type: "array", minItems: 1, items: describedItemSchema },
    highlights: { type: "array", minItems: 5, maxItems: 10, items: describedItemSchema },
    claims: { type: "array", items: itemSchema("claim") },
  },
};
const mapTopicSchema = {
  ...describedItemSchema,
  required: [...describedItemSchema.required, "coveredTimestamps"],
  properties: {
    ...describedItemSchema.properties,
    coveredTimestamps: { type: "array", items: evidenceProperties.timestamp },
  },
};
const mapHighlightSchema = {
  ...describedItemSchema,
  required: [...describedItemSchema.required, "importance"],
  properties: { ...describedItemSchema.properties, importance: { type: "integer", minimum: 1, maximum: 10 } },
};
export const MAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topics", "highlights", "claims", "unusableTimestamps"],
  properties: {
    topics: { type: "array", items: mapTopicSchema },
    highlights: { type: "array", maxItems: 5, items: mapHighlightSchema },
    claims: { type: "array", items: itemSchema("claim") },
    unusableTimestamps: { type: "array", items: evidenceProperties.timestamp },
  },
};
function normalizeSpeech(value) {
  return value.replace(/\s+/g, " ").trim();
}
function isDiagnosticLine(line) {
  return /^(?:load_backend:|ggml_[a-z0-9_]+:|whisper_[a-z0-9_]+:|read_audio_data:|system_info:|main: processing\s)/i.test(line.trim());
}
function repetitiveOnly(text) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < 6) return false;
  return new Set(words).size <= Math.max(2, Math.floor(words.length * 0.2));
}
export function cleanTranscript(markdown) {
  const headings = [...markdown.matchAll(/^## \[([0-9]+:[0-9]{2})\] Segment ([0-9]+) \(([0-9]+)s\)\s*$/gm)];
  if (headings.length === 0) throw new Error("transcript.md has no timestamped segments");
  return headings.map((heading, index) => {
    const block = markdown.slice(
      heading.index + heading[0].length,
      headings[index + 1]?.index ?? markdown.length,
    );
    const lines = block.split("\n");
    const processingIndex = lines.findIndex((line) => /^main: processing\s/i.test(line.trim()));
    const afterStart = processingIndex >= 0 ? lines.slice(processingIndex + 1) : lines;
    const timingIndex = afterStart.findIndex((line) => /^whisper_print_timings:/i.test(line.trim()));
    const speechLines = (timingIndex >= 0 ? afterStart.slice(0, timingIndex) : afterStart)
      .filter((line) => !isDiagnosticLine(line));
    const text = normalizeSpeech(speechLines.join(" "));
    const unavailable = text.length === 0 || /^\[transcription unavailable(?:;[^\]]*)?\]$/i.test(text);
    return {
      timestamp: heading[1],
      segment: Number(heading[2]),
      durationSeconds: Number(heading[3]),
      text,
      uncertain: unavailable || repetitiveOnly(text),
      usable: !unavailable,
    };
  });
}
export function assertText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string of at most ${maxLength} characters`);
  }
}
export function validateSummary(summary, segments, { requireTopics = true, minHighlights = 5, maxHighlights = 10 } = {}) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new Error("generated digest must be a JSON object");
  }
  const keys = Object.keys(summary).sort();
  if (keys.join(",") !== "claims,highlights,topics") {
    throw new Error("generated digest must contain exactly topics, highlights, and claims");
  }
  if (!Array.isArray(summary.topics) || (requireTopics && summary.topics.length === 0)) {
    throw new Error("generated digest topics must be an array with usable coverage");
  }
  if (!Array.isArray(summary.highlights) || summary.highlights.length < minHighlights || summary.highlights.length > maxHighlights) {
    throw new Error(`generated digest highlights must contain ${minHighlights} to ${maxHighlights} items`);
  }
  if (!Array.isArray(summary.claims)) throw new Error("generated digest claims must be an array");
  const segmentByTimestamp = new Map(segments.map((segment, index) => [segment.timestamp, { ...segment, index }]));
  const highlightEvidence = new Set();
  let lastTopicIndex = -1;
  for (const [collection, items] of Object.entries(summary)) {
    items.forEach((item, index) => {
      const label = `${collection}[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label} must be an object`);
      const expected = collection === "claims"
        ? ["claim", "excerpt", "timestamp", "uncertain"]
        : ["excerpt", "summary", "timestamp", "title", "uncertain"];
      if (Object.keys(item).sort().join(",") !== expected.join(",")) throw new Error(`${label} has invalid fields`);
      assertText(item.timestamp, `${label}.timestamp`, 16);
      assertText(item.excerpt, `${label}.excerpt`, 240);
      if (collection === "claims") assertText(item.claim, `${label}.claim`, 400);
      else {
        assertText(item.title, `${label}.title`, 100);
        assertText(item.summary, `${label}.summary`, 400);
      }
      if (typeof item.uncertain !== "boolean") throw new Error(`${label}.uncertain must be boolean`);
      const segment = segmentByTimestamp.get(item.timestamp);
      if (segment && !segment.usable) throw new Error(`${label}.excerpt cannot use unavailable transcription`);
      if (segment && !segment.text.includes(item.excerpt)) {
        const offset = segment.text.toLocaleLowerCase().indexOf(item.excerpt.toLocaleLowerCase());
        if (offset >= 0) item.excerpt = segment.text.slice(offset, offset + item.excerpt.length);
      }
      if (!segment || !segment.text.includes(item.excerpt)) {
        throw new Error(`${label}.excerpt is not grounded in transcript segment ${item.timestamp}`);
      }
      if (segment.uncertain && !item.uncertain) throw new Error(`${label} must preserve source uncertainty`);
      if (collection === "highlights") {
        const evidenceKey = item.excerpt.trim().toLowerCase();
        if (highlightEvidence.has(evidenceKey)) throw new Error("generated digest highlights must use unique evidence");
        highlightEvidence.add(evidenceKey);
      }
      if (collection === "topics") {
        if (segment.index < lastTopicIndex) throw new Error("generated digest topics must be chronological");
        lastTopicIndex = segment.index;
      }
    });
  }
  return summary;
}
