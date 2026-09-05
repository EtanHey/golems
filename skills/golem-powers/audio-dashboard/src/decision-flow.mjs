import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = path.join(ROOT, "templates", "decision-flow");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function replaceToken(html, token, value) {
  return html.replaceAll(token, () => String(value));
}

function safeCinemaUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) && !/^https?:/i.test(url)) return "";
  return url;
}

function normalizeOption(option, index) {
  if (typeof option === "string") return { value: option, label: option, summary: "" };
  const label = String(option?.label ?? option?.title ?? option?.value ?? "").trim();
  if (!label) throw new Error(`decision-flow: option ${index} needs a label`);
  return {
    value: String(option.value ?? option.id ?? label),
    label,
    summary: String(option.summary ?? ""),
  };
}

function assertSceneOwnership(decisions, scenes) {
  const sceneIds = new Set();
  for (const scene of scenes) {
    if (sceneIds.has(scene.id)) {
      throw new Error(`decision-flow scene ownership: duplicate scene id: ${scene.id}`);
    }
    sceneIds.add(scene.id);
  }
  const owners = new Map();
  const decisionIds = new Set();
  for (const [decisionIndex, decision] of decisions.entries()) {
    const decisionId = String(decision.id || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(decisionId)) {
      throw new Error(`decision-flow: decision ${decisionIndex} needs a slug-safe id`);
    }
    if (decisionIds.has(decisionId)) {
      throw new Error(`decision-flow scene ownership: duplicate decision id: ${decisionId}`);
    }
    decisionIds.add(decisionId);
    if (!Array.isArray(decision.sceneIds) || decision.sceneIds.length === 0) {
      throw new Error(`decision-flow scene ownership: ${decision.id} needs at least one sceneId`);
    }
    for (const sceneId of decision.sceneIds) {
      if (!sceneIds.has(sceneId)) {
        throw new Error(`decision-flow scene ownership: ${decision.id} references unknown scene ${sceneId}`);
      }
      if (owners.has(sceneId)) {
        throw new Error(`decision-flow scene ownership: ${sceneId} is assigned to both ${owners.get(sceneId)} and ${decision.id}`);
      }
      owners.set(sceneId, decision.id);
    }
  }
  const missing = scenes.map((scene) => scene.id).filter((sceneId) => !owners.has(sceneId));
  if (missing.length) {
    throw new Error(`decision-flow scene ownership: unassigned scenes: ${missing.join(", ")}`);
  }
}

function renderWords(scene) {
  return scene.words.map((word, index) =>
    `<button type="button" class="df-word" data-scene="${escapeHtml(scene.id)}" data-word-index="${index}" data-word-start="${word.start}" aria-label="Seek to ${escapeHtml(word.word)}">${escapeHtml(word.word)}</button>`,
  ).join(" ");
}

function renderRail(rows = []) {
  if (!rows.length) return "";
  return `<dl class="df-rail">${rows.map((row) =>
    `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`,
  ).join("")}</dl>`;
}

function renderCard(decision, index, sceneById) {
  const options = (decision.options || []).map(normalizeOption);
  const audio = decision.sceneIds.map((sceneId) => {
    const scene = sceneById.get(sceneId);
    return `<audio preload="metadata" data-audio-scene="${escapeHtml(scene.id)}" src="${escapeHtml(scene.audioUrl)}"></audio>`;
  }).join("");
  const transcript = decision.sceneIds.map((sceneId) => {
    const scene = sceneById.get(sceneId);
    return `<section class="df-transcript-scene" data-transcript-scene="${escapeHtml(scene.id)}"><p class="df-scene-label">${escapeHtml(scene.title)}</p><p class="df-words">${renderWords(scene)}</p></section>`;
  }).join("");
  const optionBlocks = options.map((option) =>
    `<label class="df-option"><input type="radio" name="${escapeHtml(decision.id)}" value="${escapeHtml(option.value)}"><span><b>${escapeHtml(option.label)}</b>${option.summary ? `<small>${escapeHtml(option.summary)}</small>` : ""}</span></label>`,
  ).join("");
  const status = String(decision.status || "OPEN");

  return `<article class="df-card${index === 0 ? " is-active" : ""}" data-decision="${escapeHtml(decision.id)}" data-title="${escapeHtml(decision.title)}" data-index="${index}">
    <header class="df-card-head">
      <div class="df-identity"><span class="df-rank">#${escapeHtml(decision.rank ?? index + 1)}</span><span class="df-kind">decision</span><h2>${escapeHtml(decision.title)}</h2><span class="df-status">${escapeHtml(status)}</span></div>
      ${renderRail(decision.rail)}
    </header>
    ${decision.summary ? `<p class="df-summary">${escapeHtml(decision.summary)}</p>` : ""}
    <p class="df-question">${escapeHtml(decision.body || "")}</p>
    <div class="df-player">
      <button type="button" class="df-play" aria-label="Play this decision's full audio">▶ Play full section</button><button type="button" class="df-restart" aria-label="Restart this decision's audio">↻ Restart</button>
      <span class="df-player-state" aria-live="polite">Ready · ${decision.sceneIds.length} clip${decision.sceneIds.length === 1 ? "" : "s"}</span>
      ${audio}
    </div>
    <div class="df-teleprompter" hidden aria-live="off">${transcript}</div>
    <div class="df-answer">
      <fieldset class="df-options"><legend class="df-sr-only">${escapeHtml(decision.title)} options</legend>${optionBlocks}</fieldset>
      <textarea class="note-area df-free" data-note="${escapeHtml(decision.id)}-free" data-title="${escapeHtml(decision.title)}" placeholder="Or write it in your own words..."></textarea>
      <div class="df-card-actions"><button type="button" class="df-skip">Skip for now</button><button type="button" class="df-next">Next decision →</button></div>
    </div>
  </article>`;
}

export function renderDecisionFlow({ title, kicker, heading, subtitle, scenes, decisions, storageKey, cinemaUrl }) {
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("decision-flow: scenes must be non-empty");
  if (!Array.isArray(decisions) || decisions.length === 0) throw new Error("decision-flow: decisions must be non-empty");
  assertSceneOwnership(decisions, scenes);

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const tpdata = Object.fromEntries(scenes.map((scene) => [scene.id, {
    cues: [{ start: scene.words[0]?.start ?? 0, end: scene.words.at(-1)?.end ?? 0, text: scene.script, words: scene.words }],
    total: scene.duration,
    realWordTiming: true,
  }]));
  const shell = readFileSync(path.join(TEMPLATE_ROOT, "shell.html"), "utf8");
  const styles = readFileSync(path.join(TEMPLATE_ROOT, "decision-flow.css"), "utf8");
  const script = readFileSync(path.join(TEMPLATE_ROOT, "decision-flow.js"), "utf8");
  const cards = decisions.map((decision, index) => renderCard(decision, index, sceneById)).join("\n");
  const safeModeUrl = safeCinemaUrl(cinemaUrl);

  return [
    ["{{TITLE}}", escapeHtml(title || "Decision flow")],
    ["{{KICKER}}", escapeHtml(kicker || "Decision flow")],
    ["{{HEADING}}", escapeHtml(heading || title || "Decisions")],
    ["{{SUBTITLE}}", escapeHtml(subtitle || "Listen, decide, and keep moving.")],
    ["{{DECISION_COUNT}}", decisions.length],
    ["{{SCENE_COUNT}}", scenes.length],
    ["{{STORAGE_KEY}}", escapeHtml(storageKey || "dbx:decision-flow")],
    ["{{MODE_SWITCH}}", safeModeUrl ? `<p class="df-mode-label">Audio decision dashboard · <a class="df-cinema-link" href="${escapeHtml(safeModeUrl)}">Open Cinema listening mode</a></p>` : `<p class="df-mode-label">Audio decision dashboard</p>`],
    ["{{STYLES}}", styles],
    ["{{CARDS}}", cards],
    ["{{TPDATA}}", safeJson(tpdata)],
    ["{{SCRIPT}}", script],
  ].reduce((html, [token, value]) => replaceToken(html, token, value), shell);
}
