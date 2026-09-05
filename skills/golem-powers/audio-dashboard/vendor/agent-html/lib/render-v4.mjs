import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEMPLATE_DIR = path.join(ROOT, "templates", "v4-story-mode");
const DEFAULT_PROJECT = "default";
const DOMAIN_LABELS = {
  overview: "Overview",
  "brainlayer-baseline": "BrainLayer",
  brainlayer: "BrainLayer",
  "orc-successor": "Orc Successor",
  orc: "Orc Successor",
  "hermes-pi": "Hermes/Pi",
  hermes: "Hermes/Pi",
  "control-layer": "Control Layer",
  "comms-layer": "Comms Layer",
  "happy-camper": "Happy Camper",
  narration: "Narration",
  narrationlayer: "Narration",
  voicebar: "VoiceBar",
  "intent-evolution": "Intent Evolution",
  "open-forks": "Open Forks",
  dashboard: "Dashboard"
};
const DOMAIN_CLASSES = {
  brainlayer: "brainlayer-baseline",
  orc: "orc-successor",
  hermes: "hermes-pi",
  narrationlayer: "narration",
  dashboard: "overview"
};

export const SILENT_AUDIO_DATA_URI = `data:audio/mpeg;base64,${readFileSync(path.join(DEFAULT_TEMPLATE_DIR, "_placeholder.mp3")).toString("base64")}`;

function templateFile(templateDir, fileName) {
  return readFileSync(path.join(templateDir, fileName), "utf8");
}

function replaceAllTokens(html, values) {
  return html.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in values)) {
      throw new Error(`Missing V4 template token: ${key}`);
    }
    return values[key];
  });
}

function jsonForHtml(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// slugify is lossy by design: "foo_bar", "foo-bar", and "Foo Bar" all collapse to
// "foo-bar", and a build with neither storageScope nor id falls back to a title that
// defaults to "Audio Dashboard" — so slug alone would put every untitled dashboard in
// one shared namespace. Appending a short digest of the raw identifier keeps distinct
// dashboards in distinct namespaces while staying stable across rebuilds of the same
// dashboard and keeping the `dbx:<scope>` shape the bridge floor requires.
function storageScopeFor(payload = {}, title = "") {
  const raw = String(payload.storageScope || payload.id || title || "");
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return `${slugify(raw, "dashboard")}-${digest}`;
}

function slugify(value, fallback = "scene") {
  const slug = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 96);
  return slug || fallback;
}

function assertScene(scene, index) {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    throw new Error(`scenes[${index}] must be an object`);
  }
  for (const field of ["title", "script"]) {
    if (typeof scene[field] !== "string" || scene[field].trim() === "") {
      throw new Error(`scenes[${index}].${field} must be a non-empty string`);
    }
  }
}

function estimateDurationSeconds(script) {
  const words = String(script || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(4, Math.round(words / 2.5));
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = String(safe % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function normalizeDomain(domain) {
  const raw = slugify(domain || "overview", "overview");
  return DOMAIN_CLASSES[raw] || raw;
}

function normalizeWords(words) {
  if (!Array.isArray(words) || words.length === 0) return null;
  const out = [];
  for (const w of words) {
    if (!w || typeof w !== "object") continue;
    const word = String(w.word ?? w.text ?? "").trim();
    const start = Number(w.start);
    const end = Number(w.end);
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({ word, start, end });
  }
  return out.length ? out : null;
}

function scriptWords(script) {
  return String(script || "")
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\w]+|[^\w.?!,;:]+$/g, ""))
    .filter(Boolean);
}

// CANONICAL DISPLAY=SCRIPT (regression-fix A, 2026-06-22):
//   The teleprompter MUST display the verbatim narration SCRIPT, never the
//   whisper transcription. Whisper text is garbled ("Claude" -> "clod",
//   "guard" -> "caught by guard") and is for word-TIMING ONLY.
//   This function takes the clean SCRIPT tokens as the display spine and
//   assigns each one a [start,end] by proportionally mapping it onto the
//   whisper timeline. Result: display is ALWAYS clean script; timing is
//   monotonic and spans the full clip regardless of count mismatch.
//   Mirrors the intent of build-replies-readalong.mjs but is deterministic
//   even when whisper word-count != script word-count.
function alignScriptToTiming(script, words) {
  const scriptTokens = scriptWords(script);
  if (!scriptTokens.length || !words || !words.length) return null;
  const W = words.length;
  const S = scriptTokens.length;
  const clipStart = words[0].start;
  const clipEnd = words[W - 1].end;
  // 1:1 PASS-THROUGH (no re-proportional remap): synth-segments already writes
  // script-aligned words.json using the same tokenizer shape. Treat that file as
  // authoritative; a second raw whitespace split/remap creates overlapping spans
  // when punctuation-only tokens such as "--" appear in the script.
  if (W === S) {
    return words.map((word, index) => ({
      word: scriptTokens[index],
      start: Number.isFinite(word.start) ? word.start : clipStart,
      end: Number.isFinite(word.end) && word.end >= word.start ? word.end : Math.max(word.start, clipEnd)
    }));
  }
  const out = [];
  for (let i = 0; i < S; i++) {
    // Map script token i onto the whisper timeline by proportion.
    const wi = Math.min(W - 1, Math.floor((i * W) / S));
    const wiNext = Math.min(W - 1, Math.floor(((i + 1) * W) / S));
    let start = words[wi].start;
    // End = start of the next mapped whisper slot (so highlights flow), clamped.
    let end = wiNext > wi ? words[wiNext].start : words[wi].end;
    if (!Number.isFinite(start)) start = clipStart;
    if (!Number.isFinite(end) || end < start) end = Math.max(start, clipEnd);
    out.push({ word: scriptTokens[i], start, end });
  }
  // Guarantee the last token carries the true clip end so the bar fills.
  if (out.length) out[out.length - 1].end = Math.max(out[out.length - 1].end, clipEnd);
  return out;
}

function normalizeScene(scene, index) {
  assertScene(scene, index);
  const id = slugify(scene.id || scene.title, `scene-${index + 1}`);
  const domain = normalizeDomain(scene.domain || "overview");
  const script = scene.script.trim();
  const words = normalizeWords(scene.words);
  // When real per-word timing is present, the true clip duration is the last word's end.
  const wordDuration = words ? words[words.length - 1].end : null;
  const duration = Number(scene.duration ?? scene.durationSeconds ?? scene.total ?? wordDuration ?? estimateDurationSeconds(script));
  return {
    id,
    domain,
    domainLabel: scene.domainLabel || DOMAIN_LABELS[domain] || DOMAIN_LABELS[scene.domain] || domain,
    title: scene.title.trim(),
    script,
    words,
    audioUrl: typeof scene.audioUrl === "string" && scene.audioUrl.trim() ? scene.audioUrl.trim() : null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : estimateDurationSeconds(script)
  };
}

function renderSection(scene, index) {
  const idx = String(index + 1).padStart(2, "0");
  const audioSrc = scene.audioUrl || SILENT_AUDIO_DATA_URI;
  return `      <section class="sec" id="sec-${escapeHtml(scene.id)}">
        <div class="sec-hd">
          <span class="sec-idx">${idx}</span>
          <span class="dom-chip dom-${escapeHtml(scene.domain)}">${escapeHtml(scene.domainLabel)}</span>
          <h2 class="sec-title">${escapeHtml(scene.title)}</h2>
        </div>
        <div class="aud" data-tp="${escapeHtml(scene.id)}">
          <div class="who"><span class="who-name">#${index + 1} · ${escapeHtml(scene.id)}</span><span class="who-dur">${formatDuration(scene.duration)}</span></div>
          <audio controls preload="none" src="${escapeHtml(audioSrc)}"></audio>
          <details class="tp" open>
            <summary>teleprompter — narration script</summary>
            <div class="cues"></div>
          </details>
        </div>
        <div class="note-block">
          <div class="note-hd"><span class="mic">&#127908;</span> My response <span class="note-hint">(dictate with Wispr / VoiceBar — auto-saves)</span></div>
          <textarea class="note-area" data-note="${escapeHtml(scene.id)}" data-title="${escapeHtml(scene.title)}" data-domain="${escapeHtml(scene.domain)}" placeholder="Speak or type your response to this section…"></textarea>
          <div class="note-foot"><span class="note-saved" data-saved-for="${escapeHtml(scene.id)}"></span></div>
        </div>
      </section>`;
}

function normalizeDeferredScene(row, index) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`deferredScenes[${index}] must be an object`);
  }
  for (const field of ["id", "status", "reason", "ruling"]) {
    if (typeof row[field] !== "string") {
      throw new Error(`deferredScenes[${index}].${field} must be a string`);
    }
  }
  const id = row.id.trim();
  const status = row.status.trim();
  const reason = row.reason.trim();
  const ruling = row.ruling.trim();
  if (!id || status !== "DEFERRED" || !reason || !ruling) {
    throw new Error(`deferredScenes[${index}] requires id, status=DEFERRED, reason, and ruling`);
  }
  return { id, status, reason, ruling };
}

function renderDeferredScenes(rows) {
  if (!rows.length) return "";
  return `  <div class="note-block ruled-deferrals" role="note" aria-label="Ruled scene deferrals">
    <div class="note-hd"><span aria-hidden="true">⚖</span> Ruled scene deferral</div>
    ${rows.map((row) => `<div class="note-hint" data-deferred-scene="${escapeHtml(row.id)}"><b>${escapeHtml(row.id)} · ${escapeHtml(row.status)}</b> — ${escapeHtml(row.reason)} Ruling: ${escapeHtml(row.ruling)}.</div>`).join("\n    ")}
  </div>`;
}

function runtimeLabel(scenes) {
  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes > 0 ? `${minutes} min · ` : ""}${scenes.length} scenes`;
}

export function normalizeV4Payload(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("renderV4 payload must be an object");
  }
  if (!Array.isArray(payload.scenes) || payload.scenes.length === 0) {
    throw new Error("scenes must be a non-empty array");
  }
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Story-Mode Dashboard";
  const storageKey = String(payload.storageKey || `dbx:${slugify(title, "audio-dashboard")}`).trim();
  if (!/^dbx:[a-z0-9][a-z0-9._-]*$/i.test(storageKey)) {
    throw new Error("storageKey must be route-scoped as dbx:<route-id>");
  }
  const scenes = payload.scenes.map(normalizeScene);
  if (payload.deferredScenes !== undefined && !Array.isArray(payload.deferredScenes)) {
    throw new Error("deferredScenes must be an array");
  }
  const deferredScenes = (payload.deferredScenes ?? []).map(normalizeDeferredScene);
  const seenSceneIds = new Set();
  for (const scene of scenes) {
    if (seenSceneIds.has(scene.id)) {
      throw new Error(`duplicate scene id: ${scene.id}`);
    }
    seenSceneIds.add(scene.id);
  }
  return {
    schemaVersion: 1,
    type: "v4-story-mode",
    title,
    kicker: payload.kicker || "Story Mode · V4",
    heading: payload.heading || title,
    subtitle: payload.subtitle || "Press Play All to watch the narrated arc one scene at a time. Use the classic list for per-section notes.",
    railLabel: payload.railLabel || "story arc — tap any node to fly there",
    visibility: payload.visibility,
    project: payload.project,
    // Route-scoped storage namespace required by the tailnet hub bridge floor
    // (dashboard-contracts.mjs isRouteScopedStorage): every localStorage key
    // must be `dbx:<scope>...`, so one dashboard does not read another's answers.
    storageScope: storageScopeFor(payload, title),
    notesStorageKey: `${storageKey}.notes`,
    rateStorageKey: `${storageKey}.rate`,
    scenes,
    deferredScenes
  };
}

export function renderV4(payload, options = {}) {
  const templateDir = options.templateDir || DEFAULT_TEMPLATE_DIR;
  const normalized = normalizeV4Payload(payload);
  const shell = templateFile(templateDir, "shell.html");
  const cinemaCss = templateFile(templateDir, "cinema.css");
  const cinemaJs = templateFile(templateDir, "cinema.js");
  const cinemaStage = templateFile(templateDir, "cinema-stage.html");
  const first = normalized.scenes[0];
  const audioCount = normalized.scenes.filter((scene) => scene.audioUrl).length;
  const pendingCount = normalized.scenes.length - audioCount;
  const totalSeconds = normalized.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const tpdata = {};
  for (const scene of normalized.scenes) {
    // CANONICAL: display words come from the SCRIPT (clean), timing from whisper.
    const displayWords = scene.words && scene.words.length
      ? alignScriptToTiming(scene.script, scene.words)
      : null;
    if (displayWords && displayWords.length) {
      // REAL per-word timing from words.json, but the DISPLAYED word for each
      // slot is the verbatim SCRIPT token (never the whisper transcription).
      // Both the base teleprompter (shell Block 2) and the cinema (cinema.js)
      // read these per-word times for highlight + click-to-seek.
      const last = displayWords[displayWords.length - 1].end;
      tpdata[scene.id] = {
        cues: [{
          start: displayWords[0].start,
          end: last,
          text: scene.script,
          words: displayWords.map((w) => ({ word: w.word, start: w.start, end: w.end }))
        }],
        total: last,
        realWordTiming: true
      };
    } else {
      tpdata[scene.id] = {
        cues: [{ start: 0, end: scene.duration, text: scene.script }],
        total: scene.duration
      };
    }
  }

  const stage = replaceAllTokens(cinemaStage
    .replace(/id="cx-scene-total">\d+/, `id="cx-scene-total">{{SCENE_COUNT}}`)
    .replace(/id="cx-runtime">[^<]*/, `id="cx-runtime">{{RUNTIME_LABEL}}`)
    .replace(/<span class="cx-kicker" id="cx-kicker">[^<]*/, `<span class="cx-kicker" id="cx-kicker">{{KICKER}}`)
    .replace(/<span class="cx-domain" id="cx-domain-chip">[^<]*/, `<span class="cx-domain" id="cx-domain-chip">{{FIRST_DOMAIN_LABEL}}`)
    .replace(/<div class="cx-domain-big" id="cx-domain-big">[^<]*/, `<div class="cx-domain-big" id="cx-domain-big">{{FIRST_DOMAIN_LABEL}}`)
    .replace(/<h2 class="cx-title" id="cx-title">[^<]*/, `<h2 class="cx-title" id="cx-title">{{FIRST_SCENE_TITLE}}`)
    .replace(/<div class="cx-raillabel">[^<]*/, `<div class="cx-raillabel">{{RAIL_LABEL}}`), {
    SCENE_COUNT: String(normalized.scenes.length),
    RUNTIME_LABEL: escapeHtml(runtimeLabel(normalized.scenes)),
    KICKER: escapeHtml(normalized.kicker),
    FIRST_DOMAIN_LABEL: escapeHtml(first.domainLabel),
    FIRST_SCENE_TITLE: escapeHtml(first.title),
    RAIL_LABEL: escapeHtml(normalized.railLabel)
  });

  return replaceAllTokens(shell, {
    TITLE: escapeHtml(normalized.title),
    STORAGE_SCOPE: normalized.storageScope,
    CINEMA_CSS: cinemaCss,
    CINEMA_STAGE: stage,
    KICKER: escapeHtml(normalized.kicker),
    HEADING: escapeHtml(normalized.heading),
    SUBTITLE: escapeHtml(normalized.subtitle),
    SCENE_COUNT: String(normalized.scenes.length),
    AUDIO_COUNT: String(audioCount),
    PENDING_COUNT: String(pendingCount),
    RUNTIME_MIN: String(Math.round(totalSeconds / 60)),
    DISCLOSURE_HTML: renderDeferredScenes(normalized.deferredScenes),
    SECTIONS_HTML: normalized.scenes.map(renderSection).join("\n"),
    TPDATA_JSON: jsonForHtml(tpdata),
    NOTES_STORAGE_KEY_JSON: jsonForHtml(normalized.notesStorageKey),
    RATE_STORAGE_KEY_JSON: jsonForHtml(normalized.rateStorageKey),
    CINEMA_JS: cinemaJs,
    RUNTIME_LABEL: escapeHtml(runtimeLabel(normalized.scenes)),
    FIRST_DOMAIN_LABEL: escapeHtml(first.domainLabel),
    FIRST_SCENE_TITLE: escapeHtml(first.title),
    RAIL_LABEL: escapeHtml(normalized.railLabel)
  });
}

function htmlPageDir(root, project, slug) {
  return project && project !== DEFAULT_PROJECT ? path.join(root, "htmls", project, slug) : path.join(root, "htmls", slug);
}

export async function regenerateV4Dashboard(options = {}) {
  const hostRepoPath = path.resolve(options.hostRepoPath || ROOT);
  const slug = options.slug || options.dashboard;
  if (!slug) {
    throw new Error("slug is required");
  }
  const project = options.project || DEFAULT_PROJECT;
  const pageRoot = htmlPageDir(hostRepoPath, project, slug);
  const scenesPath = path.join(pageRoot, "scenes.json");
  const raw = await readFile(scenesPath, "utf8");
  const payload = JSON.parse(raw);
  const html = renderV4(payload, { templateDir: options.templateDir });
  const outputPath = path.join(pageRoot, "index.html");
  await writeFile(outputPath, html);
  return {
    slug,
    project,
    title: payload.title || "Story-Mode Dashboard",
    sceneCount: payload.scenes.length,
    scenesPath,
    outputPath
  };
}

export async function writeV4DashboardSource(options = {}) {
  const hostRepoPath = path.resolve(options.hostRepoPath || ROOT);
  const slug = options.slug;
  if (!slug) throw new Error("slug is required");
  const project = options.project || DEFAULT_PROJECT;
  const pageRoot = htmlPageDir(hostRepoPath, project, slug);
  const normalized = normalizeV4Payload(options);
  await mkdir(pageRoot, { recursive: true });
  await writeFile(path.join(pageRoot, "scenes.json"), `${JSON.stringify(normalized, null, 2)}\n`);
  await writeFile(path.join(pageRoot, "page.json"), `${JSON.stringify({
    title: normalized.title,
    visibility: options.visibility || "auth-required",
    project,
    allowedEmails: options.allowedEmails || [],
    allowedDomains: options.allowedDomains || [],
    allowedUserIds: options.allowedUserIds || [],
    shareTokens: options.shareTokens || []
  }, null, 2)}\n`);
  const html = renderV4(normalized, options);
  await writeFile(path.join(pageRoot, "index.html"), html);
  return { pageRoot, normalized };
}

export async function copyLocalSceneAudio({ scenes, outputAudioDir }) {
  await mkdir(outputAudioDir, { recursive: true });
  const copied = [];
  for (const scene of scenes) {
    if (!scene.audioUrl || /^https?:\/\//i.test(scene.audioUrl) || scene.audioUrl.startsWith("data:")) {
      continue;
    }
    const source = path.resolve(scene.audioUrl);
    if (!existsSync(source)) {
      continue;
    }
    const target = path.join(outputAudioDir, path.basename(source));
    await copyFile(source, target);
    copied.push({ source, target });
  }
  return copied;
}
