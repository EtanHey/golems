import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = path.join(ROOT, "templates", "decision-flow");
const NOTE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 11V4H4v16l4-4h7M8 8h8M8 12h4M19 14v8m-4-4h8"/></svg>';
const COMPARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="7.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="7.5" height="14" rx="1.5"/></svg>';
const ANSWER_MARK = '<span class="df-answer-status" role="img" aria-label="Awaiting answer" title="Awaiting answer" data-answered="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle class="df-answer-progress" cx="12" cy="12" r="9" pathLength="1"/><path d="m7.5 12 3 3 6-6"/></svg></span>';

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
    `<span class="df-word" data-scene="${escapeHtml(scene.id)}" data-word-index="${index}" data-word-start="${word.start}">${escapeHtml(word.word)}</span>`,
  ).join(" ");
}

// A bare "#39" names no repository; only an explicit repository-qualified href may link it.
// Reference rule: a "#N" in authored text is an issue/PR reference unless it sits inside a `code span`
// or directly follows a colour word ("color #123", "background: #123456", "fill=#333"), where it is a CSS
// colour. Other 3- and 6-digit numbers stay references, so a real "#123" is never hidden.
const BARE_REFERENCE = /(?<![\w&#/])#(\d+)\b/g;
const COLOUR_CONTEXT = /\b(?:colou?rs?|background(?:-colou?r)?|fill|stroke|border(?:-colou?r)?|outline(?:-colou?r)?|hex)\s*[:=]?\s*["']?$/i;

function referenceTokens(text) {
  const source = String(text ?? "");
  const prose = source.replace(/`[^`\n]*`/g, (span) => " ".repeat(span.length));
  return [...prose.matchAll(BARE_REFERENCE)].filter((match) => !COLOUR_CONTEXT.test(prose.slice(0, match.index)));
}
const GITHUB_REFERENCE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)(?:[/?#]|$)/;

function safeHref(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return "";
  }
  return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.href : "";
}

function renderRailValue(row) {
  const value = String(row.value ?? "").trim();
  const href = safeHref(row.href);
  if (!href) return escapeHtml(row.value);
  const reference = href.match(GITHUB_REFERENCE);
  if (!reference) return `<a class="df-rail-link" href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(value || href)}</a>`;
  const [, owner, repo, kind, number] = reference;
  const stated = referenceTokens(value).map((match) => match[1]);
  if (stated.some((statedNumber) => statedNumber !== number)) {
    throw new Error(`decision-flow: rail "${row.label}" says ${value} but links ${owner}/${repo}#${number}`);
  }
  const label = `${repo}#${number}`;
  const text = !value || /^#\d+$/.test(value) ? escapeHtml(label) : `${escapeHtml(value)} <span class="df-rail-ref">${escapeHtml(label)}</span>`;
  return `<a class="df-rail-link" href="${escapeHtml(href)}" rel="noopener noreferrer" title="${kind === "pull" ? "Pull request" : "Issue"} ${escapeHtml(`${owner}/${repo}#${number}`)}">${text}</a>`;
}

function renderRail(rows = []) {
  if (!rows.length) return "";
  return `<dl class="df-rail">${rows.map((row) =>
    `<div><dt>${escapeHtml(row.label)}</dt><dd>${renderRailValue(row)}</dd></div>`,
  ).join("")}</dl>`;
}

// Producer check: every "#N" a card shows must be linked on that card by a repository-qualified href.
export function findBareReferences(decisions = []) {
  const found = [];
  for (const decision of decisions) {
    const rail = Array.isArray(decision.rail) ? decision.rail : [];
    const linked = new Set(rail.map((row) => safeHref(row.href).match(GITHUB_REFERENCE)?.[4]).filter(Boolean));
    // A rail value that carries its own href must link the PR/issue it names; a generic URL labelled "#39" does not.
    for (const row of rail) {
      const href = safeHref(row.href);
      if (!href) continue;
      const number = href.match(GITHUB_REFERENCE)?.[4];
      for (const match of referenceTokens(row.value)) {
        if (match[1] !== number) found.push({ decision: decision.id, field: `rail ${row.label}`, ref: match[0] });
      }
    }
    const fields = [
      ["title", decision.title],
      ["summary", decision.summary],
      ["body", decision.body],
      ...(decision.options || []).flatMap((option, index) => typeof option === "string"
        ? [[`option ${index}`, option]]
        : [[`option ${index}`, option?.label ?? option?.title], [`option ${index} summary`, option?.summary]]),
      ...rail.filter((row) => !safeHref(row.href)).map((row) => [`rail ${row.label}`, row.value]),
    ];
    for (const [field, text] of fields) {
      for (const match of referenceTokens(text)) {
        if (!linked.has(match[1])) found.push({ decision: decision.id, field, ref: match[0] });
      }
    }
  }
  return found;
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
  return String(decision.rank === "✓" ? "QA" : (decision.rank ?? index + 1));
}

function renderIndex(decisions) {
  return `<ol class="df-index-list">${decisions.map((decision, index) =>
    `<li><a href="#decision-${escapeHtml(decision.id)}" data-index-for="${escapeHtml(decision.id)}"${index === 0 ? ' class="is-active"' : ""}><span class="df-index-rank">${escapeHtml(rankLabel(decision, index))}</span>${ANSWER_MARK}<span class="df-index-title">${escapeHtml(decision.title)}</span></a></li>`,
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
    `<div class="df-check-row"><label class="df-check"><input type="checkbox" class="df-check-input" data-check-index="${index}"><span>${escapeHtml(label)}</span></label><button type="button" class="df-item-note" data-check-note="${index}" aria-label="Add note about ${escapeHtml(label)}" title="Add note">${NOTE_ICON}</button></div>`;
  const body = groups.map((group) => group.title
    ? `<div class="df-check-group"><p class="df-check-group-title">${escapeHtml(group.title)}</p>${group.items.map(box).join("")}</div>`
    : group.items.map(box).join(""),
  ).join("");
  return `<fieldset class="df-checklist" data-checklist-for="${escapeHtml(decision.id)}" data-check-total="${total}"><legend class="df-sr-only">${escapeHtml(decision.title)} checklist</legend><p class="df-checklist-count" aria-live="polite">0 of ${total} checked</p>${body}</fieldset>`;
}

function renderController(decisions) {
  const chips = decisions.map((decision, index) =>
    `<button type="button" class="df-chip" data-chip-for="${escapeHtml(decision.id)}"${index === 0 ? ' aria-current="true"' : ""}><span class="df-chip-rank">${escapeHtml(rankLabel(decision, index))}</span>${ANSWER_MARK}<span class="df-chip-title">${escapeHtml(decision.title)}</span><span class="df-note-count" hidden></span></button>`,
  ).join("");
  const rates = PLAYBACK_RATES.map((rate) =>
    `<option value="${rate}"${rate === 1 ? " selected" : ""}>${rate}×</option>`,
  ).join("");
  return `<nav class="df-controller" aria-label="Card controller">
      <div class="df-transport">
        <button type="button" class="df-tbtn" id="df-transport-prev" aria-label="Previous card" disabled>⏮</button>
        <button type="button" class="df-tplay" id="df-transport-play" aria-label="Play the current card"><span class="df-tplay-icon" aria-hidden="true">▶</span><span class="df-tplay-text">Play</span></button>
        <button type="button" class="df-tbtn" id="df-transport-next" aria-label="Next card">⏭</button>
        <button type="button" class="df-tbtn" id="df-controller-cite" hidden aria-label="Cite selected text" aria-haspopup="dialog" aria-controls="df-note-dialog" title="Cite selected text">❞</button>
        <button type="button" class="df-tbtn df-tstop" id="df-transport-stop" aria-label="Stop and return to the start of the card">■</button>
        <p class="df-now" id="df-now" aria-live="polite"></p>
        <label class="df-speed"><span class="df-sr-only">Playback speed</span><select id="df-speed">${rates}</select></label>
        <button type="button" class="df-view-toggle" id="df-view-toggle" aria-pressed="false">Story<span class="df-wide-only"> view</span></button>
      </div>
      <span class="df-progress" aria-hidden="true"><i id="df-progress-fill"></i></span>
      <div class="df-chips">${chips}</div>
    </nav>`;
}

// Two-voice cards read like the cinema Q/A: the host asks, the expert explains.
function speakerLabel(scene, role) {
  const name = String(scene.speaker || "").trim();
  if (!name) return "";
  const verb = role === "host" ? " asks" : role === "expert" ? " explains" : "";
  return name.charAt(0).toUpperCase() + name.slice(1) + verb;
}

export const DEFAULT_COMPARISON_TIMEOUT_MS = 10000;

function comparisonTimeout(value, where) {
  if (!Number.isInteger(value) || value < 1000 || value > 120000) {
    throw new Error(`decision-flow: ${where} must be an integer from 1000 to 120000`);
  }
  return value;
}

// Judge the URL the browser will load, not the raw string: the WHATWG parser drops tab/LF/CR and resolves
// "../" and "%2e%2e/", so "java\nscript:" and directory escapes only show up after parsing.
const COMPARISON_BASE = new URL("https://dashboard.invalid/dashboard/index.html");
const COMPARISON_DIR = new URL("./", COMPARISON_BASE);

function comparisonUrl(value, decisionId) {
  const raw = String(value ?? "");
  let url = null;
  try {
    // A leading "/" or "\\" leaves the directory; a leading "#" or "?" points back at the dashboard itself.
    url = /^\s*[\\/#?]|[\u0000-\u001f\u007f]/.test(raw) || !raw.trim() ? null : new URL(raw, COMPARISON_BASE);
  } catch {
    url = null;
  }
  const relative = url && url.origin === COMPARISON_BASE.origin && url.pathname.startsWith(COMPARISON_DIR.pathname) && !/%2f|%5c/i.test(url.pathname)
    ? url.pathname.slice(COMPARISON_DIR.pathname.length) + url.search + url.hash
    : "";
  if (!relative) {
    throw new Error(`decision-flow: ${decisionId} comparison.url must be a relative URL inside the dashboard directory`);
  }
  return relative;
}

// An explicit comparison target: a page inside the dashboard directory, opened in the shared dialog.
function normalizeComparison(decision, timeoutMs) {
  if (decision.comparison === undefined) return null;
  const spec = typeof decision.comparison === "string" ? { url: decision.comparison } : decision.comparison || {};
  return {
    url: comparisonUrl(spec.url, decision.id),
    label: String(spec.label ?? "").trim() || "View comparison",
    title: String(spec.title ?? "").trim() || `Comparison · ${decision.title}`,
    timeoutMs: spec.timeoutMs === undefined ? timeoutMs : comparisonTimeout(spec.timeoutMs, `${decision.id} comparison.timeoutMs`),
  };
}

// A comparison page declares itself ready with this marker. An error or 404 page never carries it, so where the
// browser reports no navigation status (WebKit) the marker is the success evidence.
export const COMPARISON_READY_META = '<meta name="adash-comparison" content="ready">';
// Canonical-form contract (the build accepts nothing else). The leading bytes of the page must be: optional
// doctype, the <html> start tag, then either data-adash-comparison="ready" on that tag, or the <head> start
// tag followed (whitespace only) by exactly <meta name="adash-comparison" content="ready">. A meta that is the
// first child of an explicit <head> is in document.head in every browser, so build-accept implies the runtime
// check accepts. Valid but non-canonical pages are rejected on purpose: producers use markComparisonReady.
const ci = (word) => [...word].map((letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`).join("");
// Quote-aware start-tag attributes, so a ">" inside a quoted value cannot end the tag early.
const TAG_ATTRIBUTES = String.raw`(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>` + "`" + String.raw`]+))?)*\s*/?`;
const CANONICAL_PREFIX = new RegExp(String.raw`^﻿?\s*(?:<!${ci("doctype")}(?:\s[^>]*)?>\s*)?<${ci("html")}(${TAG_ATTRIBUTES})>(\s*<${ci("head")}${TAG_ATTRIBUTES}>)?(\s*<meta name="adash-comparison" content="ready"\s*/?>)?`);
const ATTRIBUTE = /\s+([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const SCAN_LIMIT = 16384;

function canonicalMarker(page) {
  const match = page.slice(0, SCAN_LIMIT).match(CANONICAL_PREFIX);
  if (!match) return { html: null, head: null, ready: false };
  // The browser keeps the first of duplicate attributes.
  const attribute = [...match[1].matchAll(ATTRIBUTE)].find((found) => found[1].toLowerCase() === "data-adash-comparison");
  const htmlReady = Boolean(attribute) && (attribute[2] ?? attribute[3] ?? attribute[4]) === "ready";
  return { html: match[0].length - (match[2]?.length ?? 0) - (match[3]?.length ?? 0), head: match[2] ? match[0].length - (match[3]?.length ?? 0) : null, ready: htmlReady || Boolean(match[2] && match[3]) };
}

export function hasComparisonReadyMarker(html) {
  return canonicalMarker(String(html ?? "")).ready;
}

// For producers: return the page with the canonical marker, never removing a tag. It goes right after the
// leading <head> start tag; a missing <head> (or <html>) is created in front of the existing content.
export function markComparisonReady(html) {
  const page = String(html ?? "");
  const { html: htmlEnd, head: headEnd, ready } = canonicalMarker(page);
  if (ready) return page;
  if (headEnd !== null) return page.slice(0, headEnd) + COMPARISON_READY_META + page.slice(headEnd);
  if (htmlEnd !== null) return `${page.slice(0, htmlEnd)}<head>${COMPARISON_READY_META}</head>${page.slice(htmlEnd)}`;
  const doctype = page.match(new RegExp(String.raw`^﻿?\s*(?:<!${ci("doctype")}(?:\s[^>]*)?>)?`))[0];
  return `${doctype}<html><head>${COMPARISON_READY_META}</head>${page.slice(doctype.length)}`;
}

// Each card's comparison target, as the dashboard-relative URL the renderer emits.
export function comparisonPages(decisions = []) {
  return decisions.filter((decision) => decision.comparison !== undefined)
    .map((decision) => ({ decision: decision.id, url: normalizeComparison(decision, DEFAULT_COMPARISON_TIMEOUT_MS).url }));
}

function renderComparisonOpener(comparison) {
  if (!comparison) return "";
  return `<button type="button" class="df-compare-open" aria-haspopup="dialog" aria-controls="df-compare" data-compare-url="${escapeHtml(comparison.url)}" data-compare-title="${escapeHtml(comparison.title)}" data-compare-timeout="${comparison.timeoutMs}">${COMPARE_ICON}<span>${escapeHtml(comparison.label)}</span></button>`;
}

// One shared dialog: loading -> loaded | failed (error or timeout) -> loading on Retry; Back closes.
const COMPARE_DIALOG = `<dialog class="df-compare" id="df-compare" aria-labelledby="df-compare-title" aria-modal="true" data-state="idle">
    <div class="df-compare-head"><button type="button" class="df-compare-back" id="df-compare-back"><span aria-hidden="true">←</span> Back</button><h2 id="df-compare-title"></h2></div>
    <div class="df-compare-stage" id="df-compare-stage"></div>
    <div class="df-compare-status" role="status" aria-live="polite"><span class="df-compare-spinner" aria-hidden="true"></span><p id="df-compare-message"></p><div class="df-compare-actions"><button type="button" id="df-compare-retry" hidden>Retry</button><button type="button" id="df-compare-close" hidden>Back to the card</button></div></div>
  </dialog>`;

function renderCard(decision, index, sceneById, comparisonTimeoutMs) {
  const options = (decision.options || []).map(normalizeOption);
  const comparison = normalizeComparison(decision, comparisonTimeoutMs);
  const audio = decision.sceneIds.map((sceneId) => {
    const scene = sceneById.get(sceneId);
    return `<audio preload="metadata" data-audio-scene="${escapeHtml(scene.id)}" src="${escapeHtml(scene.audioUrl)}"></audio>`;
  }).join("");
  const transcript = decision.sceneIds.map((sceneId) => {
    const scene = sceneById.get(sceneId);
    const role = scene.role === "host" || scene.role === "expert" ? scene.role : "";
    const label = speakerLabel(scene, role);
    const speaker = label ? `<span class="df-speaker"${role ? ` data-role="${role}"` : ""}>${escapeHtml(label)}</span>` : "";
    const title = String(scene.title || "").trim().toLowerCase() === label.toLowerCase() ? "" : `<span class="df-scene-title">${escapeHtml(scene.title)}</span>`;
    return `<section class="df-transcript-scene" data-transcript-scene="${escapeHtml(scene.id)}"${role ? ` data-role="${role}"` : ""}><p class="df-scene-label">${speaker}${title}</p><p class="df-words" tabindex="0" role="group" aria-label="Transcript: ${escapeHtml(scene.title)}" aria-describedby="df-seek-help">${renderWords(scene)}</p></section>`;
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
      <div class="df-title">${ANSWER_MARK}<h2>${escapeHtml(decision.title)}</h2></div>
      <span class="df-status" data-status="${escapeHtml(status.toLowerCase())}">${escapeHtml(sentenceCase(status))}</span>
      <button type="button" class="df-card-note" aria-label="Add or review notes for ${escapeHtml(decision.title)}" title="Cite &amp; note">${NOTE_ICON}<span class="df-note-count" hidden></span></button>
    </header>
    <div class="df-player">
      <button type="button" class="df-play" aria-label="Play this decision's full audio">▶ Play full section</button><button type="button" class="df-restart" aria-label="Restart this decision's audio">↻ Restart</button>
      <span class="df-player-state" aria-live="polite">Ready · ${clips} clip${clips === 1 ? "" : "s"}, ${listenTime}</span>
      ${audio}
    </div>
    <div class="df-teleprompter" hidden aria-live="off">${transcript}</div>
    <button type="button" class="df-answer-open" aria-haspopup="dialog" aria-controls="sheet-${escapeHtml(decision.id)}"><span class="df-ao-todo">Answer this card</span><span class="df-ao-offer">Your turn: answer this card</span><span class="df-ao-done">Answered, review</span></button>
    ${renderComparisonOpener(comparison)}
    <div class="df-sheet" id="sheet-${escapeHtml(decision.id)}">
    <div class="df-sheet-head"><h3 class="df-sheet-title" id="sheet-title-${escapeHtml(decision.id)}">${escapeHtml(decision.title)}</h3><button type="button" class="df-sheet-done">Done</button></div>
    ${decision.summary ? `<p class="df-summary">${escapeHtml(decision.summary)}</p>` : ""}
    <div class="df-question">${renderParagraphs(decision.body)}</div>
    ${renderRail(decision.rail)}
    <div class="df-answer">
      ${renderChecklist(decision)}
      ${optionBlocks ? `<fieldset class="df-options"><legend class="df-sr-only">${escapeHtml(decision.title)} options</legend>${optionBlocks}</fieldset>` : ""}
      <textarea class="note-area df-free" data-note="${escapeHtml(decision.id)}-free" data-title="${escapeHtml(decision.title)}" placeholder="${optionBlocks ? "Or write it in your own words" : "Anything to add? Write it here"}"></textarea>
      <div class="df-card-actions"><button type="button" class="df-clear" aria-label="Clear answers for ${escapeHtml(decision.title)}" aria-expanded="false" aria-controls="clear-${escapeHtml(decision.id)}"><span aria-hidden="true">⌫</span> Clear</button><button type="button" class="df-skip">Skip for now</button><button type="button" class="df-next">Next decision →</button></div>
      <div class="df-clear-confirm" id="clear-${escapeHtml(decision.id)}" role="group" aria-label="Confirm clearing ${escapeHtml(decision.title)}" hidden><p>Clear this card’s picks, checklist, answer and notes?</p><div><button type="button" class="df-clear-cancel">Keep answers</button><button type="button" class="df-clear-apply">Clear this card</button></div><p class="df-clear-error" role="alert"></p></div>
    </div>
    </div>
  </article>`;
}

export function renderDecisionFlow({ title, kicker, heading, subtitle, scenes, decisions, storageKey, cinemaUrl, comparisonTimeoutMs = DEFAULT_COMPARISON_TIMEOUT_MS }) {
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("decision-flow: scenes must be non-empty");
  if (!Array.isArray(decisions) || decisions.length === 0) throw new Error("decision-flow: decisions must be non-empty");
  assertSceneOwnership(decisions, scenes);
  const timeoutMs = comparisonTimeout(comparisonTimeoutMs, "comparisonTimeoutMs");

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const tpdata = Object.fromEntries(scenes.map((scene) => [scene.id, {
    cues: [{ start: scene.words[0]?.start ?? 0, end: scene.words.at(-1)?.end ?? 0, text: scene.script, words: scene.words }],
    total: scene.duration,
    realWordTiming: true,
  }]));
  const shell = readFileSync(path.join(TEMPLATE_ROOT, "shell.html"), "utf8");
  const styles = readFileSync(path.join(TEMPLATE_ROOT, "decision-flow.css"), "utf8");
  const script = readFileSync(path.join(TEMPLATE_ROOT, "decision-flow.js"), "utf8");
  const cards = decisions.map((decision, index) => renderCard(decision, index, sceneById, timeoutMs)).join("\n");
  const safeModeUrl = safeCinemaUrl(cinemaUrl);

  return [
    ["{{TITLE}}", escapeHtml(title || "Decision flow")],
    ["{{KICKER}}", escapeHtml(kicker || "Decision flow")],
    ["{{HEADING}}", escapeHtml(heading || title || "Decisions")],
    ["{{CONTEXT}}", `<details class="df-context"><summary>Details</summary>${subtitle ? `<p class="df-subtitle">${escapeHtml(subtitle)}</p>` : ""}<p class="df-scope">Answers save only for this dashboard on this device.</p></details>`],
    ["{{DECISION_COUNT}}", decisions.length],
    ["{{SCENE_COUNT}}", scenes.length],
    ["{{STORAGE_KEY}}", escapeHtml(storageKey || "dbx:decision-flow")],
    ["{{MODE_SWITCH}}", safeModeUrl ? `<p class="df-mode-label">Audio decision dashboard · <a class="df-cinema-link" href="${escapeHtml(safeModeUrl)}">Open Cinema listening mode</a></p>` : `<p class="df-mode-label">Audio decision dashboard</p>`],
    ["{{STYLES}}", styles],
    ["{{CONTROLLER}}", renderController(decisions)],
    ["{{CARDS}}", cards],
    ["{{COMPARE_DIALOG}}", decisions.some((decision) => decision.comparison !== undefined) ? COMPARE_DIALOG : ""],
    ["{{INDEX}}", renderIndex(decisions)],
    ["{{TPDATA}}", safeJson(tpdata)],
    ["{{SCRIPT}}", script],
  ].reduce((html, [token, value]) => replaceToken(html, token, value), shell);
}
