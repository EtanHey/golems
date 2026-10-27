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

function renderParagraphs(text) {
  return String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function sentenceCase(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function rankLabel(decision, index) {
  return String(decision.rank ?? index + 1);
}

function renderIndex(decisions) {
  return `<ol class="df-index-list">${decisions.map((decision, index) =>
    `<li><a href="#decision-${escapeHtml(decision.id)}" data-index-for="${escapeHtml(decision.id)}"${index === 0 ? ' class="is-active"' : ""}><span class="df-index-rank">${escapeHtml(rankLabel(decision, index))}</span><span class="df-index-title">${escapeHtml(decision.title)}</span></a></li>`,
  ).join("")}</ol>`;
}

export const PLAYBACK_RATES = Object.freeze([0.8, 1, 1.25, 1.5, 1.75, 2]);

function normalizeChecklist(decision) {
  if (decision.checklist === undefined) return [];
  if (!Array.isArray(decision.checklist) || decision.checklist.length === 0) {
    throw new Error(`decision-flow: ${decision.id} checklist must be a non-empty array`);
  }
  let next = 0;
  const item = (label, where) => {
    const text = typeof label === "string" ? label.trim() : "";
    if (!text) throw new Error(`decision-flow: ${decision.id} checklist ${where} needs non-empty text`);
    return { index: next++, label: text };
  };
  return decision.checklist.map((entry, entryIndex) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const title = String(entry.title ?? entry.group ?? "").trim();
      if (!Array.isArray(entry.items) || entry.items.length === 0) {
        throw new Error(`decision-flow: ${decision.id} checklist group ${entryIndex} needs items`);
      }
      return { title, items: entry.items.map((label, itemIndex) => item(label, `group ${entryIndex} item ${itemIndex}`)) };
    }
    return { title: "", items: [item(entry, `item ${entryIndex}`)] };
  });
}

function renderChecklist(decision) {
  const groups = normalizeChecklist(decision);
  if (!groups.length) return "";
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const box = ({ index, label }) =>
    `<label class="df-check"><input type="checkbox" class="df-check-input" data-check-index="${index}"><span>${escapeHtml(label)}</span></label>`;
  const body = groups.map((group) => group.title
    ? `<div class="df-check-group"><p class="df-check-group-title">${escapeHtml(group.title)}</p>${group.items.map(box).join("")}</div>`
    : group.items.map(box).join(""),
  ).join("");
  return `<fieldset class="df-checklist" data-checklist-for="${escapeHtml(decision.id)}" data-check-total="${total}"><legend class="df-sr-only">${escapeHtml(decision.title)} checklist</legend><p class="df-checklist-count" aria-live="polite">0 of ${total} checked</p>${body}</fieldset>`;
}

function renderController(decisions) {
  const chips = decisions.map((decision, index) =>
    `<button type="button" class="df-chip" data-chip-for="${escapeHtml(decision.id)}"${index === 0 ? ' aria-current="true"' : ""}><span class="df-chip-rank">${escapeHtml(rankLabel(decision, index))}</span><span class="df-chip-title">${escapeHtml(decision.title)}</span></button>`,
  ).join("");
  const rates = PLAYBACK_RATES.map((rate) =>
    `<option value="${rate}"${rate === 1 ? " selected" : ""}>${rate}×</option>`,
  ).join("");
  return `<nav class="df-controller" aria-label="Card controller">
      <div class="df-transport">
        <button type="button" class="df-tbtn" id="df-transport-prev" aria-label="Previous card" disabled>⏮</button>
        <button type="button" class="df-tplay" id="df-transport-play" aria-label="Play the current card"><span class="df-tplay-icon" aria-hidden="true">▶</span><span class="df-tplay-text">Play</span></button>
        <button type="button" class="df-tbtn" id="df-transport-next" aria-label="Next card">⏭</button>
        <p class="df-now" id="df-now" aria-live="polite"></p>
        <label class="df-speed"><span class="df-sr-only">Playback speed</span><select id="df-speed">${rates}</select></label>
        <button type="button" class="df-view-toggle" id="df-view-toggle" aria-pressed="false">Story<span class="df-wide-only"> view</span></button>
      </div>
      <div class="df-chips">${chips}</div>
    </nav>`;
}

// Two-voice cards read like the cinema Q/A: the host asks, the expert explains.
function renderSpeaker(scene, role) {
  const name = String(scene.speaker || "").trim();
  if (!name) return "";
  const person = name.charAt(0).toUpperCase() + name.slice(1);
  const verb = role === "host" ? " asks" : role === "expert" ? " explains" : "";
  return `<span class="df-speaker"${role ? ` data-role="${role}"` : ""}>${escapeHtml(person + verb)}</span>`;
}

function renderCard(decision, index, sceneById) {
  const options = (decision.options || []).map(normalizeOption);
  const audio = decision.sceneIds.map((sceneId) => {
    const scene = sceneById.get(sceneId);
    return `<audio preload="metadata" data-audio-scene="${escapeHtml(scene.id)}" src="${escapeHtml(scene.audioUrl)}"></audio>`;
  }).join("");
  const transcript = decision.sceneIds.map((sceneId) => {
    const scene = sceneById.get(sceneId);
    const role = scene.role === "host" || scene.role === "expert" ? scene.role : "";
    const speaker = renderSpeaker(scene, role);
    const spoken = speaker.replace(/<[^>]+>/g, "").trim().toLowerCase();
    const title = String(scene.title || "").trim().toLowerCase() === spoken ? "" : `<span class="df-scene-title">${escapeHtml(scene.title)}</span>`;
    return `<section class="df-transcript-scene" data-transcript-scene="${escapeHtml(scene.id)}"${role ? ` data-role="${role}"` : ""}><p class="df-scene-label">${speaker}${title}</p><p class="df-words">${renderWords(scene)}</p></section>`;
  }).join("");
  const optionBlocks = options.map((option) =>
    `<label class="df-option"><input type="radio" name="${escapeHtml(decision.id)}" value="${escapeHtml(option.value)}"><span><b>${escapeHtml(option.label)}</b>${option.summary ? `<small>${escapeHtml(option.summary)}</small>` : ""}</span></label>`,
  ).join("");
  const status = String(decision.status || "OPEN");
  const clips = decision.sceneIds.length;
  const listenTime = formatDuration(decision.sceneIds.reduce((sum, sceneId) => sum + (Number(sceneById.get(sceneId).duration) || 0), 0));

  return `<article class="df-card${index === 0 ? " is-active" : ""}" id="decision-${escapeHtml(decision.id)}" data-decision="${escapeHtml(decision.id)}" data-title="${escapeHtml(decision.title)}" data-index="${index}">
    <header class="df-card-head">
      <span class="df-rank" aria-hidden="true">${escapeHtml(rankLabel(decision, index))}</span>
      <h2>${escapeHtml(decision.title)}</h2>
      <span class="df-status" data-status="${escapeHtml(status.toLowerCase())}">${escapeHtml(sentenceCase(status))}</span>
    </header>
    <div class="df-player">
      <button type="button" class="df-play" aria-label="Play this decision's full audio">▶ Play full section</button><button type="button" class="df-restart" aria-label="Restart this decision's audio">↻ Restart</button>
      <span class="df-player-state" aria-live="polite">Ready · ${clips} clip${clips === 1 ? "" : "s"}, ${listenTime}</span>
      ${audio}
    </div>
    <div class="df-teleprompter" hidden aria-live="off">${transcript}</div>
    ${decision.summary ? `<p class="df-summary">${escapeHtml(decision.summary)}</p>` : ""}
    <div class="df-question">${renderParagraphs(decision.body)}</div>
    ${renderRail(decision.rail)}
    <div class="df-answer">
      ${renderChecklist(decision)}
      ${optionBlocks ? `<fieldset class="df-options"><legend class="df-sr-only">${escapeHtml(decision.title)} options</legend>${optionBlocks}</fieldset>` : ""}
      <textarea class="note-area df-free" data-note="${escapeHtml(decision.id)}-free" data-title="${escapeHtml(decision.title)}" placeholder="${optionBlocks ? "Or write it in your own words" : "Anything to add? Write it here"}"></textarea>
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
    ["{{CONTROLLER}}", renderController(decisions)],
    ["{{CARDS}}", cards],
    ["{{INDEX}}", renderIndex(decisions)],
    ["{{TPDATA}}", safeJson(tpdata)],
    ["{{SCRIPT}}", script],
  ].reduce((html, [token, value]) => replaceToken(html, token, value), shell);
}
