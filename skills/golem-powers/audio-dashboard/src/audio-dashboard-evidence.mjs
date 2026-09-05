const CANONICAL_GENERATOR_RE =
  /(build-aftercode-tonight\.mjs|render-v4\.mjs|narrationlayer\/src\/dashboard\.ts|narrationlayer\/src\/teleprompter\.ts|scripts\/build-narrated-qa\.ts)/i;
const WRONG_GENERATOR_RE =
  /(golemplaylist-base\.js|build-aftercode-cinema\.mjs|gen16|weave-2026-06-13|cue_for)/i;
const ESTIMATED_RE =
  /(wpm|even[- ]split|estimated|fake timing|line[- ]level|hardcoded\s+dur|duration\s*[\/÷]\s*word|word_count\s*[\/÷]\s*2\.4|realWordTiming["']?\s*:\s*false)/i;
const PLACEHOLDER_RE =
  /(no gist available yet|real theo stream audio for|placeholder|recap pending|TODO recap|lorem ipsum|meta[- ]copy)/i;
const DOCSLOCAL_DASHBOARD_RE = /\/docs\.local\/dashboards\/.+\.html$/i;
const SERVE_TREE_RE = /\/dashboards-serve\/dashboards\//i;
const TAILNET_SYNC_RE =
  /(sync-tailnet-dashboards\.mjs|tailnet\s+sync|launchd\s+sync|launchctl[\s\S]{0,120}tailnet)/i;
const WORD_TIMESTAMP_REF_RE =
  /(dataset\.(ws|start|wordStart)|getAttribute\s*\(\s*["']data-(ws|start|word-start)["']\s*\)|\.closest\s*\(\s*["'][^"']*data-(ws|start|word-start)|\[\s*["'](ws|start|wordStart)["']\s*\])/i;
const SEEK_RE = /(currentTime\s*=|seekTo(?:Time)?\s*\()/i;

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function metadataOnly(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(metadataOnly).filter((item) => item != null);
  if (typeof value !== "object") return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(html|script|transcript|text|recap|summary|body|title)$/i.test(key)) continue;
    if (key === "word") continue;
    out[key] = metadataOnly(child);
  }
  return out;
}

function addViolation(violations, code, evidence) {
  if (violations.some((v) => v.code === code)) return;
  violations.push({ code, evidence });
}

function parseJsonScript(html, id) {
  const re = new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const match = html.match(re);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function flatten(value, inherited = {}) {
  const out = [];
  const visit = (item, parent = inherited) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child, parent);
      return;
    }
    const metadata = { ...parent };
    for (const key of ["realWordTiming", "timing", "script", "transcript", "text"]) {
      if (Object.hasOwn(item, key) && item[key] != null) metadata[key] = item[key];
    }
    if (Array.isArray(item.words)) out.push({ ...metadata, ...item });
    if (item.words && typeof item.words === "object" && Array.isArray(item.words.words)) {
      out.push({
        ...metadata,
        timing: item.words.timing ?? metadata.timing,
        words: item.words.words,
      });
    }
    for (const key of ["segments", "scenes", "cues", "items", "chapters"]) {
      if (Array.isArray(item[key])) visit(item[key], metadata);
    }
  };
  visit(value);
  return out;
}

function wordLooksReal(word) {
  return (
    word &&
    typeof word.word === "string" &&
    word.word.trim().length > 0 &&
    Number.isFinite(Number(word.start)) &&
    Number.isFinite(Number(word.end)) &&
    Number(word.end) > Number(word.start)
  );
}

function wordArrayLooksReal(words) {
  return wordArrayFailure(words) === null;
}

function wordArrayFailure(words) {
  if (!Array.isArray(words) || words.length === 0 || !words.every(wordLooksReal)) return "missing";
  for (let index = 1; index < words.length; index += 1) {
    const prev = words[index - 1];
    const curr = words[index];
    if (Number(curr.start) < Number(prev.end)) return "nonmonotonic";
  }
  return null;
}

function normalizeTokens(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hasTranscriptOverlap(scriptTexts, words) {
  const scriptTokens = new Set(normalizeTokens(scriptTexts.join(" ")));
  if (scriptTokens.size === 0) return false;
  const wordTokens = normalizeTokens(words.map((w) => w.word).join(" "));
  if (wordTokens.length === 0) return false;
  const matches = wordTokens.filter((w) => scriptTokens.has(w)).length;
  return matches >= Math.min(2, wordTokens.length);
}

function clickHandlerBodies(html) {
  const bodies = [];
  const patterns = [
    /addEventListener\s*\(\s*["']click["']\s*,\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{([\s\S]*?)\}\s*\)/gi,
    /addEventListener\s*\(\s*["']click["']\s*,\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\)/gi,
    /onclick\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      bodies.push(match[1]);
    }
  }
  return bodies;
}

function detectsWordClickSeek(html) {
  if (clickHandlerBodies(html).some((body) => SEEK_RE.test(body) && WORD_TIMESTAMP_REF_RE.test(body))) return true;
  const decisionWordBinding = /querySelectorAll\s*\(\s*["']\.df-word["']\s*\)[\s\S]{0,240}addEventListener\s*\(\s*["']click["']/i;
  return decisionWordBinding.test(html) && SEEK_RE.test(html) && WORD_TIMESTAMP_REF_RE.test(html);
}

function completedSyncStatus(value) {
  return /^(ran|complete|completed|synced|launchd|launchd-waited)$/i.test(String(value ?? ""));
}

function detectsTailnetSync(evidence) {
  if (evidence.tailnetSync === true || evidence.publish?.tailnetSync === true) return true;
  if (completedSyncStatus(evidence.tailnetSync?.status) || completedSyncStatus(evidence.publish?.tailnetSync?.status)) {
    return true;
  }
  const publishEvidence = [
    evidence.tailnetSync,
    evidence.publish,
    evidence.publishCommand,
    evidence.syncCommand,
    evidence.publishLog,
    evidence.syncLog,
    evidence.commands,
    evidence.publishSteps,
    evidence.steps,
    evidence.plan,
  ]
    .map(textOf)
    .join("\n");
  return TAILNET_SYNC_RE.test(publishEvidence);
}

function collectTimingRecords(evidence, html) {
  const tpdata = parseJsonScript(html, "tpdata");
  const dashboardData = parseJsonScript(html, "dashboard-data");
  const fromEvidence = evidence.timingData ?? evidence.tpdata ?? evidence.dashboardData ?? null;
  return flatten([tpdata, dashboardData, fromEvidence]);
}

export function validateAudioDashboardEvidence(evidence = {}) {
  const html = textOf(evidence.html);
  const generator = textOf(evidence.generator);
  const outputPath = textOf(evidence.outputPath);
  const wordsJson = Array.isArray(evidence.wordsJson) ? evidence.wordsJson : [];
  const violations = [];

  if (WRONG_GENERATOR_RE.test(generator)) {
    addViolation(
      violations,
      "OLD_GOLEMPLAYLIST_V1",
      "dashboard evidence references old GolemPlaylist V1, gen16, build-aftercode-cinema.mjs, or cue_for WPM timing",
    );
  }

  if (!generator || !CANONICAL_GENERATOR_RE.test(generator)) {
    addViolation(
      violations,
      "NON_CANONICAL_GENERATOR",
      "generator must be narrationlayer dashboard/teleprompter or agent-html build-aftercode-tonight.mjs/render-v4",
    );
  }

  if (!outputPath || SERVE_TREE_RE.test(outputPath) || !DOCSLOCAL_DASHBOARD_RE.test(outputPath)) {
    addViolation(
      violations,
      "WRONG_PUBLISH_TARGET",
      "dashboard output must be written to a repo docs.local/dashboards source path, not dashboards-serve",
    );
  }

  const tailnetSync = detectsTailnetSync(evidence);
  if (!tailnetSync) {
    addViolation(
      violations,
      "MISSING_TAILNET_SYNC",
      "publish evidence must show sync-tailnet-dashboards.mjs ran or launchd tailnet sync was explicitly awaited",
    );
  }

  const wordsJsonFailure = wordArrayFailure(wordsJson);
  if (wordsJsonFailure === "missing") {
    addViolation(
      violations,
      "MISSING_REAL_WORDS_JSON",
      "words.json must contain monotonic {word,start,end} entries from STT-after-TTS alignment",
    );
  } else if (wordsJsonFailure === "nonmonotonic") {
    addViolation(
      violations,
      "NON_MONOTONIC_WORD_TIMING",
      "words.json entries must be monotonic and non-overlapping; a word cannot start before the prior word ends",
    );
  }

  const timingRecords = collectTimingRecords(evidence, html);
  const timingWords = timingRecords.flatMap((record) => (Array.isArray(record.words) ? record.words : []));
  const timingMetadataBlob = [
    generator,
    textOf(metadataOnly(evidence.timing)),
    textOf(metadataOnly(evidence.timingData)),
    textOf(metadataOnly(evidence.tpdata)),
    textOf(metadataOnly(evidence.dashboardData)),
    textOf(metadataOnly(timingRecords)),
  ].join("\n");
  if (timingRecords.some((record) => wordArrayFailure(record.words) === "nonmonotonic")) {
    addViolation(
      violations,
      "NON_MONOTONIC_WORD_TIMING",
      "dashboard timing words must be monotonic and non-overlapping",
    );
  }
  const realWordTiming =
    timingRecords.length > 0 &&
    timingRecords.every(
      (record) =>
        record.realWordTiming === true ||
        record.timing?.source === "whisper-cli" ||
        record.timing?.status === "available",
    ) &&
    timingRecords.every((record) => wordArrayLooksReal(record.words));

  if (!realWordTiming || ESTIMATED_RE.test(timingMetadataBlob)) {
    addViolation(
      violations,
      "ESTIMATED_OR_WPM_TIMING",
      "dashboard must use STT-after-TTS real word timings; WPM, estimated, fake, hardcoded duration, and realWordTiming:false paths are rejected",
    );
  }

  const scriptTexts = timingRecords
    .map((record) => textOf(record.script ?? record.transcript ?? record.text))
    .filter(Boolean);
  const transcriptBlob = `${scriptTexts.join("\n")}\n${html}`;
  const placeholderMetadata = PLACEHOLDER_RE.test(timingMetadataBlob);
  const realTranscript =
    !placeholderMetadata &&
    hasTranscriptOverlap(scriptTexts.length ? scriptTexts : [html], wordsJson.length ? wordsJson : timingWords);

  if (!realTranscript) {
    addViolation(
      violations,
      placeholderMetadata ? "PLACEHOLDER_TRANSCRIPT" : "MISSING_REAL_TRANSCRIPT",
      "dashboard transcript must be the real script/transcript bound to the words, not placeholder or meta recap text",
    );
  }

  const wordClickSeek = detectsWordClickSeek(html);
  if (!wordClickSeek) {
    addViolation(
      violations,
      "MISSING_WORD_CLICK_SEEK",
      "dashboard must bind clicked word spans to audio.currentTime/seekTo using the word start timestamp",
    );
  }

  return {
    verdict: violations.length > 0 ? "REJECTED" : "PASS",
    violations,
    realWordTiming,
    realTranscript,
    wordClickSeek,
    tailnetSync,
  };
}

export function formatReport(result) {
  if (result.verdict === "PASS") {
    return "audio-dashboard evidence PASS: real words.json, real transcript, word-click seek, canonical generator, docs.local publish source, tailnet sync";
  }
  const codes = result.violations.map((v) => v.code).join(", ");
  return `audio-dashboard evidence REJECTED: ${codes}\n${result.violations
    .map((v) => `- ${v.code}: ${v.evidence}`)
    .join("\n")}`;
}
