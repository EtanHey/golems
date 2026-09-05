"use strict";

const state = {
  sessions: [],
  activeSessionId: null,
  activeView: null,
};

const els = {
  refresh: document.querySelector("#refresh-button"),
  serverStatus: document.querySelector("#server-status"),
  sessionList: document.querySelector("#session-list"),
  sessionDetail: document.querySelector("#session-detail"),
  sessions: document.querySelector("#sessions"),
  back: document.querySelector("#back-button"),
  detailTitle: document.querySelector("#detail-title"),
  detailAutoCritic: document.querySelector("#detail-auto-critic"),
  detailParticipants: document.querySelector("#detail-participants"),
  detailSessionId: document.querySelector("#detail-session-id"),
  summary: document.querySelector("#session-summary"),
  cards: document.querySelector("#cards"),
  sessionScore: document.querySelector("#session-score"),
  sessionComment: document.querySelector("#session-comment"),
  sessionRowTemplate: document.querySelector("#session-row-template"),
  cardTemplate: document.querySelector("#card-template"),
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function setStatus(text, kind = "") {
  els.serverStatus.textContent = text;
  els.serverStatus.dataset.kind = kind;
}

function shortId(value) {
  if (!value) return "";
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function textForValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function renderParticipantChips(parent, participants) {
  parent.replaceChildren();
  const chips = participants?.chips || [];
  parent.classList.toggle("mixed-participants", Boolean(participants?.mixed));
  if (participants?.mixed) {
    parent.setAttribute("aria-label", "Mixed session: golem, orchestrator, and human participated");
  } else {
    parent.removeAttribute("aria-label");
  }
  for (const chip of chips) {
    const node = document.createElement("span");
    node.className = `participant-chip ${chip.kind || ""}`.trim();
    node.textContent = chip.label;
    parent.append(node);
  }
}

function renderSessions(rows) {
  els.sessions.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No sessions returned.";
    els.sessions.append(empty);
    return;
  }

  for (const row of rows) {
    const node = els.sessionRowTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.sessionId = row.session_id;
    node.querySelector(".session-identity").textContent = row.identity?.display || shortId(row.session_id);
    renderParticipantChips(node.querySelector(".participant-chips"), row.participants);
    node.querySelector(".session-id").textContent = shortId(row.session_id);
    node.querySelector(".session-meta").textContent = [
      formatDate(row.start_time),
      row.trace_count ? `${row.trace_count} traces` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    node.addEventListener("click", () => openSession(row.session_id));
    els.sessions.append(node);
  }
}

function renderDetailHeader(view) {
  els.detailTitle.textContent = view.identity?.display || shortId(view.session_id);
  els.detailSessionId.textContent = view.session_id || "";
  renderParticipantChips(els.detailParticipants, view.participants);
}

async function loadSessions() {
  setStatus("Loading");
  try {
    const payload = await fetchJson("/api/sessions?limit=30");
    state.sessions = payload.sessions || [];
    renderSessions(state.sessions);
    setStatus("Online", "ok");
    const firstSessionId = payload.default_session_id || state.sessions[0]?.session_id;
    if (firstSessionId) {
      await openSession(firstSessionId);
    }
  } catch (error) {
    setStatus("Error", "bad");
    els.sessions.replaceChildren();
    const message = document.createElement("p");
    message.className = "error-state";
    message.textContent = error.message;
    els.sessions.append(message);
  }
}

function metricLabel(key) {
  return key.replaceAll("_", " ");
}

function annotationLabel(annotation) {
  return String(annotation?.label || "").toUpperCase();
}

function annotationExplanation(annotation) {
  return String(annotation?.explanation || "").trim();
}

function renderAutoCriticBadge(annotation) {
  if (!annotation) return null;
  const label = annotationLabel(annotation);
  if (!label) return null;
  const badge = document.createElement("div");
  badge.className = `auto-critic-badge ${label.toLowerCase()}`.trim();
  const prefix = document.createElement("span");
  prefix.textContent = `auto ${label}`;
  badge.append(prefix);
  const explanation = annotationExplanation(annotation);
  if (explanation) {
    const reason = document.createElement("strong");
    reason.textContent = explanation;
    badge.append(reason);
  }
  return badge;
}

function appendAutoCriticFlag(parent, annotation) {
  if (!annotation) return;
  const label = annotationLabel(annotation);
  if (!label) return;
  const flag = document.createElement("div");
  flag.className = `auto-critic-flag ${label.toLowerCase()}`.trim();
  const category = annotation.category ? ` (${annotation.category})` : "";
  const explanation = annotationExplanation(annotation);
  const prefix = label === "BAD" ? "auto: BAD" : `auto: ${label}`;
  flag.textContent = `${prefix}${category}${explanation ? ` — ${explanation}` : ""}`;
  parent.append(flag);
}

function renderSummary(view) {
  els.summary.replaceChildren();
  els.detailAutoCritic.replaceChildren();
  const autoBadge = renderAutoCriticBadge(view.annotations?.auto_critic);
  const toolbarBadge = renderAutoCriticBadge(view.annotations?.auto_critic);
  if (toolbarBadge) {
    toolbarBadge.classList.add("toolbar-auto-critic");
    els.detailAutoCritic.append(toolbarBadge);
  }
  if (autoBadge) {
    autoBadge.classList.add("summary-auto-critic");
    els.summary.append(autoBadge);
  }
  const metaRows = [
    ["Session", view.session_id],
    ["Agent", [view.agent?.name, view.agent?.type, view.agent?.repo].filter(Boolean).join(" · ")],
    ["Source", view.source_path],
  ];
  for (const [label, value] of metaRows) {
    if (!value) continue;
    const item = document.createElement("div");
    item.className = "summary-item";
    item.innerHTML = `<span>${label}</span><strong></strong>`;
    item.querySelector("strong").textContent = value;
    els.summary.append(item);
  }

  for (const [key, value] of Object.entries(view.metrics || {})) {
    const item = document.createElement("div");
    item.className = "summary-item metric";
    item.innerHTML = `<span></span><strong></strong>`;
    item.querySelector("span").textContent = metricLabel(key);
    item.querySelector("strong").textContent = String(value);
    els.summary.append(item);
  }
}

function appendBlock(parent, label, value, className = "") {
  const text = textForValue(value);
  if (!text) return;
  const block = document.createElement("section");
  block.className = `payload-block ${className}`.trim();
  const heading = document.createElement("h4");
  heading.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = text;
  block.append(heading, pre);
  parent.append(block);
}

function appendMetrics(parent, metrics = []) {
  if (!metrics.length) return;
  const row = document.createElement("div");
  row.className = "metric-row";
  for (const metric of metrics) {
    const pill = document.createElement("span");
    pill.className = "metric-pill";
    pill.textContent = `${metric.label}: ${metric.value}`;
    row.append(pill);
  }
  parent.append(row);
}

function renderThinking(parent, thinking = []) {
  for (const text of thinking) {
    appendBlock(parent, "💭 THINKING", text, "thinking-block");
  }
}

function renderToolCall(toolCall) {
  const node = document.createElement("section");
  node.className = "tool-call";
  if (toolCall.is_cmux) node.classList.add("cmux-tool");

  const header = document.createElement("div");
  header.className = "tool-call-header";
  const title = document.createElement("h4");
  title.textContent = `${toolCall.kind_label || "🔧 TOOL CALL"} · ${toolCall.tool_name || "tool"}`;
  header.append(title);
  appendMetrics(header, toolCall.metrics || []);
  node.append(header);
  appendAutoCriticFlag(node, toolCall.annotations?.auto_critic);

  appendBlock(node, toolCall.input_label || "INPUT — args", toolCall.tool_input, "tool-input");
  appendBlock(node, toolCall.output_label || "OUTPUT — result", toolCall.tool_output, "tool-output");
  if (toolCall.cmux_geometry) {
    appendBlock(node, "cmux.geometry", toolCall.cmux_geometry, "geometry-block");
  }
  return node;
}

function renderCard(card) {
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.cardId = card.card_id;
  node.dataset.spanId = card.span_id || "";
  node.dataset.kind = card.kind;
  node.dataset.role = card.role || "";
  if ((card.tool_calls || []).some((toolCall) => toolCall.is_cmux)) node.classList.add("cmux-card");

  node.querySelector(".card-kind").textContent = card.title || card.kind;
  node.querySelector(".card-time").textContent = formatDate(card.timestamp);
  node.querySelector(".card-title").textContent = card.title;

  const body = node.querySelector(".card-body");
  appendAutoCriticFlag(body, card.annotations?.auto_critic);
  appendMetrics(body, card.metrics || []);
  if (card.kind === "assistant") {
    renderThinking(body, card.thinking || []);
    if (card.text) {
      appendBlock(body, "🤖 ASSISTANT (output text)", card.text, "assistant-output");
    }
    for (const toolCall of card.tool_calls || []) {
      body.append(renderToolCall(toolCall));
    }
  } else if (card.kind === "tool") {
    appendBlock(body, "INPUT — args", card.tool_input, "tool-input");
    appendBlock(body, "OUTPUT — result", card.tool_output, "tool-output");
  } else {
    const text = document.createElement("p");
    text.textContent = card.text || "";
    body.append(text);
  }

  const extra = node.querySelector(".card-extra");
  if (card.cmux_geometry) {
    appendBlock(extra, "cmux.geometry", card.cmux_geometry, "geometry-block");
  }

  const wrongToggle = node.querySelector(".wrong-toggle");
  const comment = node.querySelector(".card-comment");
  const save = node.querySelector(".save-card");
  const status = node.querySelector(".save-status");

  wrongToggle.addEventListener("click", () => {
    const active = wrongToggle.getAttribute("aria-pressed") === "true";
    wrongToggle.setAttribute("aria-pressed", String(!active));
    wrongToggle.classList.toggle("mark-wrong", !active);
  });

  save.addEventListener("click", async () => {
    const markedWrong = wrongToggle.getAttribute("aria-pressed") === "true";
    const label = markedWrong ? "bad" : "good";
    const note = comment.value.trim();
    status.textContent = "Saving...";
    try {
      const operations = [
        {
          name: "Phoenix annotation",
          promise: postSpanAnnotation({
            span_id: card.span_id,
            label,
            explanation: note,
            metadata: {
              session_id: state.activeSessionId,
              card_id: card.card_id,
              kind: card.kind,
              event_index: card.event_index,
            },
          }),
        },
      ];
      if (note) {
        operations.push({
          name: "turn note",
          promise: postTurnNote({
            turn_id: card.card_id,
            session: state.activeSessionId,
            note,
          }),
        });
      }
      const results = await Promise.allSettled(operations.map((operation) => operation.promise));
      const failures = results
        .map((result, index) =>
          result.status === "rejected" ? `${operations[index].name}: ${result.reason?.message || result.reason}` : ""
        )
        .filter(Boolean);
      if (failures.length) {
        throw new Error(failures.join(" · "));
      }
      status.textContent = markedWrong ? "Saved BAD" : "Saved GOOD";
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("error");
    }
  });

  return node;
}

function renderCards(cards) {
  els.cards.replaceChildren();
  for (const card of cards || []) {
    els.cards.append(renderCard(card));
  }
}

async function openSession(sessionId) {
  state.activeSessionId = sessionId;
  els.detailTitle.textContent = shortId(sessionId);
  els.detailSessionId.textContent = "";
  els.detailParticipants.replaceChildren();
  document.body.classList.add("detail-open");
  els.sessionList.classList.add("hidden");
  els.sessionDetail.classList.remove("hidden");
  for (const row of els.sessions.querySelectorAll(".session-row")) {
    row.classList.toggle("active", row.dataset.sessionId === sessionId);
  }
  els.cards.replaceChildren();
  els.summary.textContent = "Loading session...";
  els.detailAutoCritic.replaceChildren();
  setStatus("Loading");

  try {
    const view = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
    state.activeView = view;
    renderDetailHeader(view);
    renderSummary(view);
    renderCards(view.cards);
    setStatus("Reviewing", "ok");
    els.sessionDetail.scrollIntoView({ block: "start" });
  } catch (error) {
    els.summary.textContent = error.message;
    setStatus("Error", "bad");
  }
}

async function postSpanAnnotation(payload) {
  if (!payload.span_id) {
    throw new Error("No span id for this card.");
  }
  return fetchJson("/api/annotations/span", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function postTurnNote(payload) {
  return fetchJson("/api/annotations/note", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function postSessionAnnotation(payload) {
  return fetchJson("/api/annotations/session", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function handleSessionScore(event) {
  const button = event.target.closest("[data-session-label]");
  if (!button || !state.activeSessionId) return;
  const label = button.dataset.sessionLabel;
  const original = button.textContent;
  button.textContent = "Saving";
  button.disabled = true;
  try {
    await postSessionAnnotation({
      session_id: state.activeSessionId,
      label,
      explanation: els.sessionComment.value.trim(),
      metadata: { source_view: "detail" },
    });
    button.textContent = label === "good" ? "GOOD saved" : "BAD saved";
  } catch (error) {
    button.textContent = error.message;
  } finally {
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1600);
  }
}

els.refresh.addEventListener("click", loadSessions);
els.back.addEventListener("click", () => {
  document.body.classList.remove("detail-open");
  els.sessionDetail.classList.add("hidden");
  els.sessionList.classList.remove("hidden");
  setStatus("Online", "ok");
});
els.sessionScore.addEventListener("click", handleSessionScore);

loadSessions();
