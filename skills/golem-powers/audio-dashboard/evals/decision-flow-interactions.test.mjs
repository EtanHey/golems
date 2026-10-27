import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { scene, boot, selectText, DEFAULT_DECISIONS } from "./decision-flow-harness.mjs";

import { renderDecisionFlow } from "../src/decision-flow.mjs";

test("rendered decision flow uses a hub-compatible route-scoped storage key", () => {
  const html = renderDecisionFlow({
    storageKey: "dbx:storage-contract-test",
    scenes: [scene("only")],
    decisions: [{ id: "only", title: "Only", sceneIds: ["only"] }],
  });
  const assignment = html.match(/\bvar\s+KEY\s*=\s*([^;\n]+)/)?.[1] || "";
  // Mirror the hub's accepted key expression without a cross-repo import.
  expect(assignment).toMatch(/getAttribute\(\s*["']data-storage-key["']\s*\)/);
  const fallback = assignment.match(/\|\|\s*(["'])([^"']*)\1/);
  expect(fallback?.[2] || "").toMatch(/^dbx:[a-z0-9][a-z0-9._-]*$/i);
  expect(html).toContain('data-storage-key="dbx:storage-contract-test"');
});

function noteText(run, text) { run.document.getElementById("df-note-text").value = text; run.document.getElementById("df-note-save").click(); }

const CLEAR_SEED = { vb: "All good", "vb-checks": { 0: true, 1: true, 2: true }, "vb-free": "An answer", "vb-notes": [{ quote: "History row", text: "A note" }], b: "One", "b-free": "Keep this", "b-notes": [{ quote: "B", text: "Also keep this" }], _prefs: { rate: 1.5, view: "list" }, extra: { retained: true } };
test("Clear requires confirmation and removes only its card's picks, checks, free text and notes", () => {
  const run = boot({ decisions: CHECK_DECISIONS, seed: CLEAR_SEED }); const { document, window } = run;
  const card = document.querySelector('[data-decision="vb"]'), clear = card.querySelector(".df-clear");
  clear.click(); expect(card.querySelector(".df-clear-confirm").hidden).toBe(false);
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test"))).toEqual(CLEAR_SEED);
  expect(document.activeElement).toBe(card.querySelector(".df-clear-cancel"));
  card.querySelector(".df-clear-cancel").click(); expect(document.activeElement).toBe(clear);
  expect(card.querySelector('input[type="radio"]').checked).toBe(true);
  clear.click(); card.querySelector(".df-clear-apply").click();
  const expected = { ...CLEAR_SEED }; for (const key of ["vb", "vb-checks", "vb-free", "vb-notes"]) delete expected[key];
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test"))).toEqual(expected);
  expect([...card.querySelectorAll("input")].every(input => !input.checked)).toBe(true);
  expect(card.querySelector(".df-free").value).toBe(""); expect(card.querySelector(".df-note-count").hidden).toBe(true);
  for (const selector of ['[data-index-for="vb"]', '[data-chip-for="vb"]']) expect(document.querySelector(selector + " .df-answer-status").getAttribute("aria-label")).toBe("Awaiting answer");
  expect(document.querySelector('[data-chip-for="b"] .df-answer-status').getAttribute("aria-label")).toBe("Answered");
  expect(card.querySelector(".df-clear-confirm").hidden).toBe(true);
  expect(boot({ decisions: CHECK_DECISIONS, seed: expected }).document.getElementById("df-answered").textContent).toBe("1");
});

test("Escape cancels an inline Clear confirmation inside the story sheet without closing the sheet", () => {
  const { document, window } = storyBoot({ decisions: CHECK_DECISIONS, seed: CLEAR_SEED });
  document.querySelector('[data-decision="vb"] .df-answer-open').click(); const sheet = sheetOf(document, "vb");
  sheet.querySelector(".df-clear").click(); sheet.querySelector(".df-clear").focus(); key(window, "Escape");
  expect(sheet.classList.contains("is-open")).toBe(true); expect(sheet.querySelector(".df-clear-confirm").hidden).toBe(true);
  expect(document.activeElement).toBe(sheet.querySelector(".df-clear"));
  sheet.querySelector(".df-clear").click(); sheet.querySelector(".df-clear-apply").click();
  expect(sheet.classList.contains("is-open")).toBe(true); expect(sheet.querySelector(".df-free").value).toBe("");
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test")).b).toBe("One");
});

test("failed Clear preserves saved answers and visible controls, and permits retry", () => {
  let blocked = true; const { document, window } = boot({ decisions: CHECK_DECISIONS, seed: CLEAR_SEED, storageError: () => blocked });
  const card = document.querySelector('[data-decision="vb"]'); card.querySelector(".df-clear").click(); card.querySelector(".df-clear-apply").click();
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test"))).toEqual(CLEAR_SEED);
  expect(card.querySelector('input[type="radio"]').checked).toBe(true); expect(card.querySelector(".df-free").value).toBe("An answer");
  expect(card.querySelector(".df-clear-error").textContent).toContain("Answers kept"); expect(card.querySelector(".df-clear-confirm").hidden).toBe(false);
  expect(document.querySelector('[data-chip-for="vb"] .df-answer-status').getAttribute("aria-label")).toBe("Answered");
  blocked = false; card.querySelector(".df-clear-apply").click();
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test")).vb).toBeUndefined(); expect(card.querySelector(".df-clear-confirm").hidden).toBe(true);
});


test("review: notes alone do not answer a card, while a completed checklist does", () => {
  const plain = boot({ seed: { "a-notes": [{ quote: "one", text: "A comment" }] } });
  expect(plain.document.getElementById("df-answered").textContent).toBe("0");
  const run = boot({ decisions: CHECK_DECISIONS, seed: { "vb-checks": { 0: true }, "vb-notes": [{ quote: "History row", text: "Check again" }] } });
  const card = run.document.querySelector('[data-decision="vb"]'); expect(card.classList.contains("is-answered")).toBe(false);
  for (const box of card.querySelectorAll(".df-check-input")) if (!box.checked) box.click();
  expect(card.classList.contains("is-answered")).toBe(true);
});

test("a checklist card with a pick and no ticks counts as answered", () => {
  const { document } = boot({ decisions: CHECK_DECISIONS }); const card = document.querySelector('[data-decision="vb"]');
  card.querySelectorAll('input[type="radio"]')[1].click();
  expect(card.querySelectorAll('.df-check-input:checked').length).toBe(0);
  expect(card.classList.contains("is-answered")).toBe(true);
  expect(document.querySelector('[data-chip-for="vb"] .df-answer-status').getAttribute("aria-label")).toBe("Answered");
});

test("review: a cited selection excludes speaker labels", () => {
  const run = boot({ scenes: [{ ...scene("a1"), speaker: "ben", role: "host" }, scene("a2"), scene("b1")] });
  selectText(run, run.document.querySelector(".df-speaker"), run.document.querySelectorAll(".df-word")[1]);
  run.document.getElementById("df-cite").click();
  expect(run.document.getElementById("df-note-quote").textContent.trim()).toBe("one two");
});

test("review: accessible navigation names keep section rank and singular note counts", () => {
  const { document } = boot({ seed: { a: "Keep", "a-notes": [{ quote: "one", text: "A comment" }] } });
  for (const selector of ['[data-index-for="a"]', '[data-chip-for="a"]']) expect(document.querySelector(selector).getAttribute("aria-label")).toBe("Section 1: A. Answered. 1 note");
  expect(document.querySelector(".df-note-count").getAttribute("aria-label")).toBe("1 note");
});

test("review: plain transcript words retain keyboard word seeking", () => {
  const { document, window } = boot(); const transcript = document.querySelector(".df-words");
  expect(document.querySelector(".df-word").tagName).toBe("SPAN");
  transcript.focus(); key(window, "ArrowRight"); key(window, "Enter");
  expect(document.querySelector("audio").currentTime).toBe(0.4);
  expect(document.querySelector("audio").paused).toBe(false);
});

test("SVG answer indicators restore, update and clear across card headers, sidebar and chips", () => {
  const { document } = boot({ decisions: CHECK_DECISIONS, seed: { vb: "All good" } });
  const card = document.querySelector('[data-decision="vb"]');
  const marks = () => [card.querySelector(".df-card-head .df-answer-status"), ...['[data-index-for="vb"]', '[data-chip-for="vb"]'].map(selector => document.querySelector(selector + " .df-answer-status"))];
  function expectMarks(done) {
    for (const mark of marks()) {
      expect(mark).not.toBeNull(); expect(mark.getAttribute("role")).toBe("img");
      expect(mark.getAttribute("aria-label")).toBe(done ? "Answered" : "Awaiting answer");
      expect(mark.dataset.answered).toBe(String(done)); expect(mark.textContent).toBe("");
      expect(mark.querySelector("svg circle")).not.toBeNull(); expect(mark.querySelector("svg path")).not.toBeNull();
      expect(mark.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
    }
  }
  expectMarks(true); card.querySelector(".df-clear").click(); card.querySelector(".df-clear-apply").click(); expectMarks(false);
  for (const checkbox of card.querySelectorAll('input[type="checkbox"]')) checkbox.click(); expectMarks(true);
  expect(card.querySelector(".df-rank").textContent).toBe("1");
});

test("partial checklists restore and update progress rings without overriding an explicit answer", () => {
  const { document } = boot({ decisions: CHECK_DECISIONS, seed: { "vb-checks": { 0: true } } });
  const card = document.querySelector('[data-decision="vb"]'), boxes = card.querySelectorAll('input[type="checkbox"]');
  function status(label, progress) { for (const root of [card.querySelector(".df-card-head"), document.querySelector('[data-index-for="vb"]'), document.querySelector('[data-chip-for="vb"]')]) {
    const mark = root.querySelector(".df-answer-status"); expect(mark.getAttribute("aria-label")).toBe(label); expect(mark.dataset.progress).toBe(String(progress));
  } }
  status("In progress, 1 of 3 checked", true); boxes[1].click(); status("In progress, 2 of 3 checked", true);
  boxes[2].click(); status("Answered", false); boxes[0].click(); status("In progress, 2 of 3 checked", true);
  card.querySelector('input[type="radio"]').click(); status("Answered", false);
  card.querySelector(".df-clear").click(); card.querySelector(".df-clear-apply").click(); status("Awaiting answer", false);
});

test("answer indicators are separate from ranks and follow restored and cleared answers", () => {
  const run = boot({ seed: { a: "Keep" } }); const { document } = run;
  for (const selector of ['[data-index-for="a"]', '[data-chip-for="a"]']) expect(document.querySelector(selector + " .df-answer-status").getAttribute("aria-label")).toBe("Answered");
  expect(document.querySelector('[data-chip-for="b"] .df-answer-status').getAttribute("aria-label")).toBe("Awaiting answer");
  expect(document.querySelector('[data-chip-for="a"] .df-chip-rank').textContent).toBe("1");
  const free = document.querySelector('[data-decision="b"] .df-free'); free.value = "reply"; free.dispatchEvent(new run.window.Event("input"));
  expect(document.querySelector('[data-index-for="b"] .df-answer-status').getAttribute("aria-label")).toBe("Answered");
  free.value = ""; free.dispatchEvent(new run.window.Event("input"));
  expect(document.querySelector('[data-index-for="b"] .df-answer-status').getAttribute("aria-label")).toBe("Awaiting answer");
  const checklist = boot({ decisions: DEFAULT_DECISIONS.map((decision, index) => ({ ...decision, rank: index ? 1 : "✓" })) });
  expect(checklist.document.querySelector(".df-chip-rank").textContent).toBe("QA");
  expect(checklist.document.querySelector(".df-answer-status").getAttribute("aria-label")).toBe("Awaiting answer");
});

test("checklist and card note buttons quote their target, persist and export without checking the item", async () => {
  let copied = ""; const run = boot({ decisions: CHECK_DECISIONS, clipboard: { writeText: text => { copied = text; return Promise.resolve(); } } });
  const { document, window } = run; const card = document.querySelector('[data-decision="vb"]');
  card.querySelector(".df-item-note").click();
  expect(document.getElementById("df-note-dialog").open).toBe(true);
  expect(document.getElementById("df-note-quote").textContent).toBe("History row");
  expect(document.activeElement).toBe(document.getElementById("df-note-text"));
  noteText(run, "<script>plain text</script>\nStill broken");
  expect(card.querySelector(".df-check-input").checked).toBe(false);
  expect(document.getElementById("df-note-dialog").open).toBe(false);
  expect(card.querySelector(".df-note-count").textContent).toBe("1");
  expect(document.querySelector('[data-chip-for="vb"] .df-note-count').textContent).toBe("1");
  const saved = JSON.parse(window.localStorage.getItem("dbx:interaction-test"));
  expect(saved["vb-notes"]).toEqual([{ quote: "History row", text: "<script>plain text</script>\nStill broken" }]);
  expect(boot({ decisions: CHECK_DECISIONS, seed: saved }).document.querySelector('[data-chip-for="vb"] .df-note-count').textContent).toBe("1");
  card.querySelector(".df-card-note").click(); expect(document.getElementById("df-note-quote").textContent).toBe("Check VoiceBar");
  expect(document.querySelector("#df-note-list script")).toBeNull();
  document.getElementById("df-note-cancel").click(); document.getElementById("df-copy").click(); await Promise.resolve();
  expect(copied).toContain("> History row\n\n<script>plain text</script>\nStill broken");
  expect(copied).toContain("    - [ ] History row\n    - [ ] Pauses");
});

test("selecting words offers Cite and suppresses seeking; a collapsed selection still seeks", () => {
  const run = boot(); const { document, window } = run; const words = document.querySelectorAll('[data-decision="a"] .df-word');
  selectText(run, words[0], words[1]);
  const cite = document.getElementById("df-cite"); expect(cite.hidden).toBe(false);
  words[1].click(); expect(document.querySelector('[data-decision="a"] audio').paused).toBe(true);
  cite.click(); expect(document.getElementById("df-note-quote").textContent).toBe("one two");
  noteText(run, "Clearer wording please");
  window.getSelection().removeAllRanges(); document.dispatchEvent(new window.Event("selectionchange"));
  words[1].click(); expect(document.querySelector('[data-decision="a"] audio').currentTime).toBe(0.4);
  selectText(run, words[0], document.querySelector('[data-decision="b"] .df-word'));
  expect(cite.hidden).toBe(true);
});

test("notes nest inside the story answer sheet, return focus, and can be edited or removed", () => {
  const run = storyBoot({ decisions: CHECK_DECISIONS }); const { document, window } = run;
  document.querySelector('[data-decision="vb"] .df-answer-open').click();
  const opener = document.querySelector('[data-decision="vb"] .df-item-note'); opener.focus(); opener.click();
  document.getElementById("df-note-dialog").dispatchEvent(new window.Event("cancel", { cancelable: true }));
  expect(document.activeElement).toBe(opener); expect(sheetOf(document, "vb").classList.contains("is-open")).toBe(true);
  opener.click(); noteText(run, "First note");
  opener.click(); document.querySelector(".df-note-edit").click(); noteText(run, "Revised note");
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test"))["vb-notes"]).toEqual([{ quote: "History row", text: "Revised note" }]);
  opener.click(); document.querySelector(".df-note-edit").click(); document.getElementById("df-note-delete").click();
  expect(document.querySelector('[data-chip-for="vb"] .df-answer-status').getAttribute("aria-label")).toBe("Awaiting answer");
  expect(document.querySelector('[data-chip-for="vb"] .df-note-count').hidden).toBe(true);
});

test("blank notes and unavailable storage keep the draft open with a recovery message", async () => {
  let blocked = false, copied = ""; const run = boot({ storageError: () => blocked, clipboard: { writeText: text => { copied = text; return Promise.resolve(); } } }); const { document } = run;
  document.querySelector(".df-card-note").click(); noteText(run, "  ");
  expect(document.getElementById("df-note-error").textContent).toContain("Write a note");
  blocked = true; noteText(run, "Keep this draft");
  expect(document.getElementById("df-note-dialog").open).toBe(true);
  expect(document.getElementById("df-note-text").value).toBe("Keep this draft");
  expect(document.getElementById("df-note-error").textContent).toContain("Try Save note again");
  expect(document.getElementById("df-answered").textContent).toBe("0");
  document.getElementById("df-note-copy-draft").click(); await Promise.resolve();
  expect(copied).toBe("> A\n\nKeep this draft");
  expect(document.getElementById("df-note-dialog").open).toBe(true);
  blocked = false; document.getElementById("df-note-save").click();
  expect(document.getElementById("df-note-dialog").open).toBe(false);
  document.querySelector(".df-card-note").click(); document.querySelector(".df-note-edit").click();
  blocked = true; document.getElementById("df-note-delete").click();
  expect(document.getElementById("df-note-dialog").open).toBe(true);
  expect(document.getElementById("df-note-error").textContent).toContain("Try Delete note again");
});

test("pause keeps the teleprompter open and resumes at the same position", () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const play = card.querySelector(".df-play");
  const audio = card.querySelector('audio[data-audio-scene="a1"]');
  play.click();
  audio.currentTime = 0.42;
  play.click();

  expect(card.querySelector(".df-teleprompter").hidden).toBe(false);
  expect(play.textContent).toContain("Resume");
  expect(audio.currentTime).toBe(0.42);

  play.click();
  expect(audio.paused).toBe(false);
  expect(audio.currentTime).toBe(0.42);
});

test("clip boundaries clear stale highlights and continue the section", () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const first = card.querySelector('audio[data-audio-scene="a1"]');
  const second = card.querySelector('audio[data-audio-scene="a2"]');
  card.querySelector(".df-play").click();
  first.currentTime = 0.45;
  first.ontimeupdate();
  expect(card.querySelectorAll(".df-word.is-current").length).toBe(1);

  first.onended();
  expect(card.querySelectorAll(".df-word.is-current").length).toBe(0);
  expect(second.paused).toBe(false);
  expect(card.querySelector(".df-teleprompter").hidden).toBe(false);
});

test("word-click seeks and then flows into the next clip", () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const first = card.querySelector('audio[data-audio-scene="a1"]');
  const second = card.querySelector('audio[data-audio-scene="a2"]');
  card.querySelector('.df-word[data-scene="a1"][data-word-index="1"]').click();

  expect(first.currentTime).toBe(0.4);
  expect(first.paused).toBe(false);
  first.onended();
  expect(second.paused).toBe(false);
  expect(card.classList.contains("is-playing")).toBe(true);
  expect(card.querySelector(".df-teleprompter").hidden).toBe(false);
});

test("seeking backward resets later clips and their highlights", () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const first = card.querySelector('audio[data-audio-scene="a1"]');
  const second = card.querySelector('audio[data-audio-scene="a2"]');
  card.querySelector(".df-play").click();
  first.onended();
  second.currentTime = 0.45;
  second.ontimeupdate();
  expect(card.querySelector('.df-word[data-scene="a2"]').classList.contains("is-read")).toBe(true);

  card.querySelector('.df-word[data-scene="a1"][data-word-index="1"]').click();
  expect(second.currentTime).toBe(0);
  expect(card.querySelectorAll('.df-word[data-scene="a2"].is-read, .df-word[data-scene="a2"].is-current').length).toBe(0);
  first.onended();
  expect(second.paused).toBe(false);
  expect(second.currentTime).toBe(0);
});

test("restart affordance resets the section while normal play resumes", () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const first = card.querySelector('audio[data-audio-scene="a1"]');
  card.querySelector(".df-play").click();
  first.currentTime = 0.6;
  first.ontimeupdate();
  expect(card.querySelectorAll(".df-word.is-read").length).toBeGreaterThan(0);
  card.querySelector(".df-play").click();
  card.querySelector(".df-restart").click();

  expect(first.currentTime).toBe(0);
  expect(first.paused).toBe(false);
  expect(card.dataset.audioIndex).toBe("0");
  expect(card.querySelectorAll(".df-word.is-read, .df-word.is-current").length).toBe(0);
});

test("next and skip activate and autoplay the following decision", async () => {
  const nextRun = boot();
  const firstCard = nextRun.document.querySelector('[data-decision="a"]');
  firstCard.querySelector('input[type="radio"]').click();
  firstCard.querySelector(".df-next").click();
  firstCard.querySelector(".df-next").click();
  const nextCard = nextRun.document.querySelector('[data-decision="b"]');
  expect(nextCard.classList.contains("is-active")).toBe(true);
  expect(nextCard.querySelector("audio").paused).toBe(false);

  const skipRun = boot();
  const skipped = skipRun.document.querySelector('[data-decision="a"]');
  skipped.querySelector(".df-skip").click();
  const skippedTo = skipRun.document.querySelector('[data-decision="b"]');
  expect(skipped.querySelector(".df-skip").classList.contains("is-acknowledged")).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 240));
  expect(skippedTo.querySelector("audio").paused).toBe(false);
});

test("autoplay rejection returns a truthful resume label", async () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  card.querySelector("audio").play = () => Promise.reject(new Error("blocked"));
  card.querySelector(".df-play").click();
  await Promise.resolve();
  await Promise.resolve();
  expect(card.querySelector(".df-play").textContent).toContain("Resume");
  expect(card.classList.contains("is-playing")).toBe(false);
});

test("rapid Play double-click ignores AbortError and stays honestly paused", async () => {
  const { document, window } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const audio = card.querySelector("audio");
  audio.play = function playThenAbort() {
    this.__paused = false;
    return Promise.reject(new window.DOMException("interrupted", "AbortError"));
  };
  const play = card.querySelector(".df-play");
  play.click();
  play.click();
  await Promise.resolve();
  await Promise.resolve();

  expect(play.textContent).toContain("Resume");
  expect(card.querySelector(".df-player-state").textContent).toContain("Paused");
  expect(card.querySelector(".df-player-state").textContent).not.toContain("allow audio");
});

test("cross-card interruption collapses only the interrupted teleprompter", () => {
  const { document } = boot();
  const first = document.querySelector('[data-decision="a"]');
  const second = document.querySelector('[data-decision="b"]');
  const firstAudio = first.querySelector("audio");
  first.querySelector(".df-play").click();
  firstAudio.currentTime = 0.42;
  second.querySelector(".df-play").click();

  expect(first.querySelector(".df-teleprompter").hidden).toBe(true);
  expect(first.querySelector(".df-play").textContent).toContain("Resume");
  expect(firstAudio.currentTime).toBe(0.42);
  expect(second.querySelector(".df-teleprompter").hidden).toBe(false);
});

test("last-card skip acknowledges without promising an impossible move", () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="b"]');
  const skip = card.querySelector(".df-skip");
  skip.click();
  expect(skip.textContent).toBe("Skipped");
  expect(skip.hasAttribute("aria-pressed")).toBe(false);
});

test("last-card Next becomes a terminal Copy answers affordance", () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="b"]');
  const next = card.querySelector(".df-next");
  const copy = document.getElementById("df-copy");
  next.click();

  expect(next.textContent).toBe("All decisions reviewed → Copy answers");
  expect(next.classList.contains("is-acknowledged")).toBe(true);
  expect(copy.__scrolledIntoView).toBe(true);
  expect(document.activeElement).toBe(copy);
});

test("page identifies the type, links cinema mode, and scopes answers per dashboard", () => {
  const { document } = boot();
  expect(document.body.dataset.storageKey).toBe("dbx:interaction-test");
  expect(document.querySelector(".df-mode-label").textContent).toContain("Audio decision dashboard");
  expect(document.querySelector(".df-cinema-link").getAttribute("href")).toBe("./interaction-test-audio.html");
  expect(document.querySelector(".df-cinema-link").textContent).toContain("Cinema");
});

test("cinema mode rejects executable URL schemes", () => {
  const html = renderDecisionFlow({
    storageKey: "dbx:safe-link",
    cinemaUrl: "javascript:alert(1)",
    scenes: [scene("only")],
    decisions: [{ id: "only", title: "Only", sceneIds: ["only"] }],
  });
  expect(html).not.toContain("javascript:alert(1)");
  expect(html).not.toContain('<a class="df-cinema-link"');
});

test("setlist index links every card and tracks answered and active state", () => {
  const { document } = boot();
  const links = [...document.querySelectorAll(".df-index-list a[data-index-for]")];
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["#decision-a", "#decision-b"]);
  expect(document.getElementById("decision-a").dataset.decision).toBe("a");
  expect(links[0].classList.contains("is-active")).toBe(true);

  const card = document.querySelector('[data-decision="a"]');
  card.querySelector('input[type="radio"]').click();
  expect(card.classList.contains("is-answered")).toBe(true);
  expect(links[0].classList.contains("is-answered")).toBe(true);
  expect(document.getElementById("df-meter-fill").style.width).toBe("50%");
  expect(document.getElementById("df-answered").textContent).toBe("1");

  document.querySelector('[data-decision="b"] .df-play').click();
  expect(links[1].classList.contains("is-active")).toBe(true);
  expect(links[1].classList.contains("is-playing")).toBe(true);
  expect(links[0].classList.contains("is-active")).toBe(false);
});

test("card keeps line breaks, shows listening time, and omits empty option sets", () => {
  const html = renderDecisionFlow({
    scenes: [scene("brief"), scene("pick")],
    decisions: [
      { id: "brief", title: "Brief", status: "INFO", body: "Done: one.\nOpen: two.", sceneIds: ["brief"] },
      { id: "pick", title: "Pick", options: ["Yes", "No"], sceneIds: ["pick"] },
    ],
  });
  const window = new Window();
  window.document.write(html);
  const brief = window.document.querySelector('[data-decision="brief"]');
  expect([...brief.querySelectorAll(".df-question p")].map((p) => p.textContent)).toEqual(["Done: one.", "Open: two."]);
  expect(brief.querySelector(".df-status").textContent).toBe("Info");
  expect(brief.querySelector(".df-player-state").textContent).toBe("Ready · 1 clip, 0:01");
  expect(brief.querySelector(".df-options")).toBeNull();
  expect(brief.querySelector(".note-area")).not.toBeNull();
  expect(window.document.querySelector('[data-decision="pick"] .df-options')).not.toBeNull();
});

test("player sits above the written briefing so listening comes first", () => {
  const { document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const before = (first, second) => Boolean(card.querySelector(first).compareDocumentPosition(card.querySelector(second)) & 4);
  expect(before(".df-player", ".df-question")).toBe(true);
  expect(before(".df-teleprompter", ".df-question")).toBe(true);
});

test("phone layout keeps focused controls clear of the fixed bottom dock", () => {
  const html = renderDecisionFlow({ scenes: [scene("only")], decisions: [{ id: "only", title: "Only", sceneIds: ["only"] }] });
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const dockHeight = Number(css.match(/--dock-clearance:\s*(\d+)px/)?.[1]);
  expect(dockHeight).toBeGreaterThanOrEqual(80);
  expect(css).toMatch(/\bhtml\{[^}]*scroll-padding-bottom:calc\(var\(--dock-clearance\) \+ env\(safe-area-inset-bottom\)\)/);
  expect(css).toMatch(/\bbody\{[^}]*padding-bottom:calc\(var\(--dock-clearance\) \+ 24px \+ env\(safe-area-inset-bottom\)\)/);
  const desktop = css.slice(css.indexOf("@media(min-width:1040px)"));
  expect(desktop).toMatch(/\bhtml\{scroll-padding-bottom:0\}/);
});

test("focusing a card control under the fixed dock scrolls it clear", () => {
  const { window, document } = boot();
  const dock = document.querySelector(".df-dock");
  const free = document.querySelector('[data-decision="a"] .note-area');
  window.getComputedStyle = ((original) => (element) => element === dock ? { position: "fixed" } : original(element))(window.getComputedStyle.bind(window));
  dock.getBoundingClientRect = () => ({ top: 773, bottom: 844 });
  free.getBoundingClientRect = () => ({ top: 718, bottom: 814 });
  free.__scrolledIntoView = false;
  free.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
  expect(free.__scrolledIntoView).toBe(true);

  const clear = document.querySelector('[data-decision="a"] .df-next');
  clear.getBoundingClientRect = () => ({ top: 600, bottom: 648 });
  clear.__scrolledIntoView = false;
  clear.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
  expect(clear.__scrolledIntoView).toBe(false);
});

// ---- round 2: speed, controller, story view, checklist ----

function speedSelect(document) { return document.getElementById("df-speed"); }
function change(window, element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("speed selector offers the fixed rates, applies to every card's audio and persists per dashboard", () => {
  const { window, document } = boot();
  const select = speedSelect(document);
  expect([...select.options].map((option) => option.value)).toEqual(["0.8", "1", "1.25", "1.5", "1.75", "2"]);
  expect(select.value).toBe("1");
  change(window, select, "1.5");
  for (const audio of document.querySelectorAll("audio")) {
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.defaultPlaybackRate).toBe(1.5);
  }
  const saved = JSON.parse(window.localStorage.getItem("dbx:interaction-test"));
  expect(saved._prefs.rate).toBe(1.5);

  const again = boot({ seed: saved });
  expect(speedSelect(again.document).value).toBe("1.5");
  expect([...again.document.querySelectorAll("audio")].every((audio) => audio.playbackRate === 1.5)).toBe(true);
});

test("an unknown persisted rate falls back to 1x", () => {
  const { document } = boot({ seed: { _prefs: { rate: 9 } } });
  expect(speedSelect(document).value).toBe("1");
  expect(document.querySelector("audio").playbackRate).toBe(1);
});

test("word highlight follows media time exactly at 2x", () => {
  const { window, document } = boot();
  change(window, speedSelect(document), "2");
  const card = document.querySelector('[data-decision="a"]');
  const audio = card.querySelector('audio[data-audio-scene="a1"]');
  card.querySelector(".df-play").click();
  expect(audio.playbackRate).toBe(2);
  audio.currentTime = 0.4; // word 1 starts at 0.4s of media time, regardless of rate
  audio.dispatchEvent(new window.Event("timeupdate"));
  expect(card.querySelector('.df-word[data-scene="a1"][data-word-index="1"]').classList.contains("is-current")).toBe(true);
  expect(card.querySelectorAll(".df-word.is-current").length).toBe(1);
});

test("controller has one chip per card and tapping a chip flies to that card", () => {
  const { document } = boot();
  const chips = [...document.querySelectorAll(".df-chip[data-chip-for]")];
  expect(chips.map((chip) => chip.dataset.chipFor)).toEqual(["a", "b"]);
  expect(chips[0].getAttribute("aria-current")).toBe("true");
  chips[1].click();
  const b = document.querySelector('[data-decision="b"]');
  expect(b.classList.contains("is-active")).toBe(true);
  expect(b.__scrolledIntoView).toBe(true);
  expect(chips[1].getAttribute("aria-current")).toBe("true");
  expect(chips[0].hasAttribute("aria-current")).toBe(false);
  expect(b.querySelector("audio").paused).toBe(true); // nothing was playing, so navigation stays silent
});

test("chips show playing and answered states", () => {
  const { document } = boot();
  const [chipA, chipB] = document.querySelectorAll(".df-chip");
  document.querySelector('[data-decision="b"] .df-play').click();
  expect(chipB.classList.contains("is-playing")).toBe(true);
  document.querySelector('[data-decision="a"] input[type="radio"]').click();
  expect(chipA.classList.contains("is-answered")).toBe(true);
});

test("transport play/pause drives only the current card's scenes", () => {
  const { document } = boot();
  const toggle = document.getElementById("df-transport-play");
  const a = document.querySelector('[data-decision="a"]');
  const b = document.querySelector('[data-decision="b"]');
  toggle.click();
  expect(a.querySelector('audio[data-audio-scene="a1"]').paused).toBe(false);
  expect(b.querySelector("audio").paused).toBe(true);
  expect(toggle.textContent).toContain("Pause");
  toggle.click();
  expect(a.querySelector('audio[data-audio-scene="a1"]').paused).toBe(true);
  expect(a.querySelector(".df-teleprompter").hidden).toBe(false);
  expect(toggle.textContent).toContain("Resume");
});

test("transport previous/next move the current card, keep playing when audio was playing, and stop at the ends", () => {
  const { document } = boot();
  const prev = document.getElementById("df-transport-prev");
  const next = document.getElementById("df-transport-next");
  const a = document.querySelector('[data-decision="a"]');
  const b = document.querySelector('[data-decision="b"]');
  expect(prev.disabled).toBe(true);
  next.click();
  expect(b.classList.contains("is-active")).toBe(true);
  expect(b.querySelector("audio").paused).toBe(true);
  expect(next.disabled).toBe(true);
  expect(prev.disabled).toBe(false);

  prev.click();
  document.getElementById("df-transport-play").click();
  expect(a.querySelector('audio[data-audio-scene="a1"]').paused).toBe(false);
  next.click();
  expect(b.querySelector("audio").paused).toBe(false);
  expect(a.querySelector('audio[data-audio-scene="a1"]').paused).toBe(true);
});

test("transport follows a card that starts playing from its own button", () => {
  const { document } = boot();
  document.querySelector('[data-decision="b"] .df-play').click();
  expect(document.getElementById("df-transport-play").textContent).toContain("Pause");
  expect(document.getElementById("df-transport-next").disabled).toBe(true);
});

test("story view toggle shows one card at a time and persists", () => {
  const { window, document } = boot();
  const toggle = document.getElementById("df-view-toggle");
  expect(document.body.dataset.view).toBe("list");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  toggle.click();
  expect(document.body.dataset.view).toBe("story");
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  const saved = JSON.parse(window.localStorage.getItem("dbx:interaction-test"));
  expect(saved._prefs.view).toBe("story");
  expect(boot({ seed: saved }).document.body.dataset.view).toBe("story");
  toggle.click();
  expect(document.body.dataset.view).toBe("list");
});

test("controller adds no global Play-All surface", () => {
  const { html } = boot();
  expect(html).not.toContain('id="cinema"');
  expect(html).not.toContain('id="pa-bar"');
  expect(html).not.toContain('data-transport="single"');
  expect(html.toLowerCase()).not.toContain("play all");
});

const CHECK_DECISIONS = [
  {
    id: "vb", title: "Check VoiceBar", options: ["All good", "Found a problem"], sceneIds: ["a1", "a2"],
    checklist: [{ title: "Fixed", items: ["History row", "Pauses"] }, "Tooltips"],
  },
  { id: "b", title: "B", options: ["One", "Two"], sceneIds: ["b1"] },
];

test("checklist renders grouped checkboxes that persist under the dashboard key", () => {
  const { window, document } = boot({ decisions: CHECK_DECISIONS });
  const card = document.querySelector('[data-decision="vb"]');
  const boxes = [...card.querySelectorAll('.df-checklist input[type="checkbox"]')];
  expect(boxes.length).toBe(3);
  expect([...card.querySelectorAll(".df-check-group-title")].map((node) => node.textContent)).toEqual(["Fixed"]);
  expect(card.querySelector(".df-checklist-count").textContent).toBe("0 of 3 checked");
  boxes[1].click();
  expect(card.querySelector(".df-checklist-count").textContent).toBe("1 of 3 checked");
  const saved = JSON.parse(window.localStorage.getItem("dbx:interaction-test"));
  expect(saved["vb-checks"]).toEqual({ 1: true });
  const again = boot({ decisions: CHECK_DECISIONS, seed: saved });
  const restored = [...again.document.querySelectorAll('[data-decision="vb"] .df-checklist input')];
  expect(restored.map((box) => box.checked)).toEqual([false, true, false]);
});

test("a fully checked checklist counts as answered; a partial one does not", () => {
  const { document } = boot({ decisions: CHECK_DECISIONS });
  const card = document.querySelector('[data-decision="vb"]');
  const boxes = [...card.querySelectorAll(".df-checklist input")];
  boxes[0].click();
  boxes[1].click();
  expect(card.classList.contains("is-answered")).toBe(false);
  expect(document.getElementById("df-answered").textContent).toBe("0");
  boxes[2].click();
  expect(card.classList.contains("is-answered")).toBe(true);
  expect(document.getElementById("df-answered").textContent).toBe("1");
  expect(document.querySelector('.df-chip[data-chip-for="vb"]').classList.contains("is-answered")).toBe(true);
});

test("Copy answers exports checklist items as [x] and [ ] lines", async () => {
  let copiedText = "";
  const { document } = boot({ decisions: CHECK_DECISIONS, clipboard: { writeText: (text) => { copiedText = text; return Promise.resolve(); } } });
  const boxes = [...document.querySelectorAll('[data-decision="vb"] .df-checklist input')];
  boxes[0].click();
  boxes[2].click();
  document.getElementById("df-copy").click();
  await Promise.resolve();
  expect(copiedText).toContain("- checklist: 2 of 3 checked");
  expect(copiedText).toContain("  - Fixed\n    - [x] History row\n    - [ ] Pauses");
  expect(copiedText).toContain("  - [x] Tooltips");
});

test("checklist items must be non-empty text", () => {
  expect(() => renderDecisionFlow({
    scenes: [scene("only")],
    decisions: [{ id: "only", title: "Only", sceneIds: ["only"], checklist: ["ok", ""] }],
  })).toThrow(/checklist/);
});

test("desktop setlist links set the current card like chips do", () => {
  const { window, document } = boot();
  const link = document.querySelector('.df-index-list a[data-index-for="b"]');
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(document.querySelector('[data-decision="b"]').classList.contains("is-active")).toBe(true);
  expect(document.getElementById("df-transport-next").disabled).toBe(true);
});

function placeCards(document, tops) {
  document.querySelector(".df-dock").getBoundingClientRect = () => ({ top: document.defaultView.innerHeight - 88 });
  [...document.querySelectorAll(".df-card")].forEach((card, index) => {
    card.getBoundingClientRect = () => ({ top: tops[index], bottom: tops[index] + 400 });
  });
}

test("in list view the current card follows scrolling while nothing plays", () => {
  const { window, document } = boot();
  placeCards(document, [-500, 140]);
  window.dispatchEvent(new window.Event("scroll"));
  expect(document.querySelector('[data-decision="b"]').classList.contains("is-active")).toBe(true);
  expect(document.querySelector('.df-chip[data-chip-for="b"]').getAttribute("aria-current")).toBe("true");
});

test("scroll-follow never steals the current card from playing audio or a fresh jump", () => {
  const playing = boot();
  playing.document.getElementById("df-transport-play").click();
  placeCards(playing.document, [-500, 140]);
  playing.window.dispatchEvent(new playing.window.Event("scroll"));
  expect(playing.document.querySelector('[data-decision="a"]').classList.contains("is-active")).toBe(true);

  const jumped = boot();
  jumped.document.querySelector('.df-chip[data-chip-for="a"]').click();
  placeCards(jumped.document, [-500, 140]);
  jumped.window.dispatchEvent(new jumped.window.Event("scroll"));
  expect(jumped.document.querySelector('[data-decision="a"]').classList.contains("is-active")).toBe(true);
});

test("scroll-follow picks the largest visible card below the reading line", () => {
  const { window, document } = boot(); placeCards(document, [0, 200]);
  document.querySelector('[data-decision="a"]').getBoundingClientRect = () => ({ top: 0, bottom: 200 });
  document.querySelector(".df-controller").getBoundingClientRect = () => ({ bottom: 100 });
  document.querySelector(".df-dock").getBoundingClientRect = () => ({ top: 700 });
  window.dispatchEvent(new window.Event("scroll"));
  expect(document.querySelector(".df-card.is-active").dataset.decision).toBe("b");
});

test("two-voice cards label each part of the read-along with its speaker", () => {
  const ask = { ...scene("a1"), role: "host", speaker: "ben" };
  const answer = { ...scene("a2"), role: "expert", speaker: "theo" };
  const plain = scene("b1");
  const { document } = boot({ scenes: [ask, answer, plain] });
  const labels = [...document.querySelectorAll('[data-decision="a"] .df-speaker')];
  expect(labels.map((label) => [label.dataset.role, label.textContent])).toEqual([["host", "Ben asks"], ["expert", "Theo explains"]]);
  expect(document.querySelector('[data-decision="a"] [data-transcript-scene="a1"]').dataset.role).toBe("host");
  expect(document.querySelector('[data-decision="b"] .df-speaker')).toBeNull();
});

test("a scene title that repeats the speaker label is not shown twice", () => {
  const ask = { ...scene("a1"), title: "Ben asks", role: "host", speaker: "ben" };
  const answer = { ...scene("a2"), title: "The trade-off", role: "expert", speaker: "theo" };
  const { document } = boot({ scenes: [ask, answer, scene("b1")] });
  const [first, second] = document.querySelectorAll('[data-decision="a"] .df-scene-label');
  expect(first.textContent).toBe("Ben asks");
  expect(second.textContent).toBe("Theo explainsThe trade-off");
});

// ---- round 3: cinema-grade story view + answer sheet ----

function storyBoot(options) {
  const run = boot(options);
  run.document.getElementById("df-view-toggle").click();
  return run;
}
function key(window, name, extra = {}) {
  const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra });
  (window.document.activeElement || window.document.body).dispatchEvent(event);
  return event;
}
const sheetOf = (document, id) => document.querySelector(`[data-decision="${id}"] .df-sheet`);

test("story view shows its own chrome: position, exit and an Answer button per card", () => {
  const { document } = storyBoot();
  expect(document.body.dataset.view).toBe("story");
  expect(document.getElementById("df-story-count").textContent).toBe("1 / 2");
  expect(document.querySelectorAll(".df-card .df-answer-open").length).toBe(2);
  expect(sheetOf(document, "a").getAttribute("role")).toBeNull();
  document.getElementById("df-transport-next").click();
  expect(document.getElementById("df-story-count").textContent).toBe("2 / 2");
  document.getElementById("df-story-exit").click();
  expect(document.body.dataset.view).toBe("list");
});

test("Answer opens an accessible modal sheet and Esc closes it, returning focus", () => {
  const { window, document } = storyBoot();
  const opener = document.querySelector('[data-decision="a"] .df-answer-open');
  opener.focus();
  opener.click();
  const sheet = sheetOf(document, "a");
  expect(sheet.classList.contains("is-open")).toBe(true);
  expect(sheet.getAttribute("role")).toBe("dialog");
  expect(sheet.getAttribute("aria-modal")).toBe("true");
  expect(document.getElementById(sheet.getAttribute("aria-labelledby")).textContent).toBe("A");
  expect(sheet.contains(document.activeElement)).toBe(true);
  expect(document.querySelector(".df-controller").hasAttribute("inert")).toBe(true);
  expect(document.getElementById("df-sheet-backdrop").hidden).toBe(false);

  const escape = key(window, "Escape");
  expect(escape.defaultPrevented).toBe(true);
  expect(sheet.classList.contains("is-open")).toBe(false);
  expect(sheet.getAttribute("role")).toBeNull();
  expect(document.querySelector(".df-controller").hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(opener);
});

test("the sheet traps Tab focus in both directions", () => {
  const { window, document } = storyBoot();
  document.querySelector('[data-decision="a"] .df-answer-open').click();
  const sheet = sheetOf(document, "a");
  const focusable = [...sheet.querySelectorAll("button, input, textarea, select, a[href]")].filter((node) => !node.disabled && !node.closest("[hidden]"));
  focusable.at(-1).focus();
  expect(key(window, "Tab").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(focusable[0]);
  expect(key(window, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(focusable.at(-1));
});

test("Done and the backdrop both close the sheet", () => {
  const { document } = storyBoot();
  document.querySelector('[data-decision="a"] .df-answer-open').click();
  sheetOf(document, "a").querySelector(".df-sheet-done").click();
  expect(sheetOf(document, "a").classList.contains("is-open")).toBe(false);
  document.querySelector('[data-decision="a"] .df-answer-open').click();
  document.getElementById("df-sheet-backdrop").click();
  expect(sheetOf(document, "a").classList.contains("is-open")).toBe(false);
});

test("answers made in the sheet persist and show in list view, and the reverse", () => {
  const { window, document } = storyBoot({ decisions: CHECK_DECISIONS });
  document.querySelector('[data-decision="vb"] .df-answer-open').click();
  const sheet = sheetOf(document, "vb");
  sheet.querySelector('input[type="radio"]').click();
  sheet.querySelectorAll(".df-check-input")[0].click();
  sheet.querySelector(".df-sheet-done").click();
  const saved = JSON.parse(window.localStorage.getItem("dbx:interaction-test"));
  expect(saved.vb).toBe("All good");
  expect(saved["vb-checks"]).toEqual({ 0: true });
  document.getElementById("df-story-exit").click();
  const card = document.querySelector('[data-decision="vb"]');
  expect(card.querySelector('input[type="radio"]').checked).toBe(true);
  expect(card.classList.contains("is-answered")).toBe(true);
  card.querySelector(".df-free").value = "typed in list";
  card.querySelector(".df-free").dispatchEvent(new window.Event("input", { bubbles: true }));
  document.getElementById("df-view-toggle").click();
  document.querySelector('[data-decision="vb"] .df-answer-open').click();
  expect(sheetOf(document, "vb").querySelector(".df-free").value).toBe("typed in list");
});

test("Next inside the sheet closes it and moves the story to the next card, playing", () => {
  const { document } = storyBoot();
  document.querySelector('[data-decision="a"] .df-answer-open').click();
  sheetOf(document, "a").querySelector(".df-next").click();
  expect(sheetOf(document, "a").classList.contains("is-open")).toBe(false);
  const b = document.querySelector('[data-decision="b"]');
  expect(b.classList.contains("is-active")).toBe(true);
  expect(b.querySelector("audio").paused).toBe(false);
});

test("moving to another card or back to list view closes an open sheet", () => {
  const { document } = storyBoot();
  document.querySelector('[data-decision="a"] .df-answer-open').click();
  document.getElementById("df-story-exit").click();
  expect(sheetOf(document, "a").classList.contains("is-open")).toBe(false);
  expect(document.getElementById("df-sheet-backdrop").hidden).toBe(true);
});

test("the Answer button only opens the sheet in story view", () => {
  const { document } = boot();
  document.querySelector('[data-decision="a"] .df-answer-open').click();
  expect(sheetOf(document, "a").classList.contains("is-open")).toBe(false);
});

test("Stop ends the current card's audio and returns it to the start", () => {
  const { window, document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const audio = card.querySelector('audio[data-audio-scene="a1"]');
  document.getElementById("df-transport-play").click();
  audio.currentTime = 0.5;
  audio.dispatchEvent(new window.Event("timeupdate"));
  document.getElementById("df-transport-stop").click();
  expect(audio.paused).toBe(true);
  expect(audio.currentTime).toBe(0);
  expect(card.querySelectorAll(".df-word.is-current, .df-word.is-read").length).toBe(0);
  expect(document.getElementById("df-transport-play").textContent).toContain("Play");
  expect(card.classList.contains("is-paused")).toBe(false);
});

test("story progress tracks the current card's place across its clips", () => {
  const { window, document } = storyBoot();
  const card = document.querySelector('[data-decision="a"]');
  document.getElementById("df-transport-play").click();
  const first = card.querySelector('audio[data-audio-scene="a1"]');
  first.currentTime = 0.5;
  first.dispatchEvent(new window.Event("timeupdate"));
  expect(document.getElementById("df-progress-fill").style.width).toBe("25%");
  first.dispatchEvent(new window.Event("ended"));
  const second = card.querySelector('audio[data-audio-scene="a2"]');
  second.currentTime = 0.5;
  second.dispatchEvent(new window.Event("timeupdate"));
  expect(document.getElementById("df-progress-fill").style.width).toBe("75%");
});

test("when an unanswered story card finishes, its Answer button invites an answer", () => {
  const { window, document } = storyBoot();
  const card = document.querySelector('[data-decision="b"]');
  document.getElementById("df-transport-next").click();
  document.getElementById("df-transport-play").click();
  card.querySelector("audio").dispatchEvent(new window.Event("ended"));
  expect(card.querySelector(".df-answer-open").classList.contains("is-offer")).toBe(true);
  expect(card.querySelector(".df-sheet").classList.contains("is-open")).toBe(false);
});

test("a paused clip rewinding to 0 does not re-light its first word", () => {
  const { window, document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  const first = card.querySelector('audio[data-audio-scene="a1"]');
  card.querySelector(".df-play").click();
  first.dispatchEvent(new window.Event("ended"));
  // Real browsers fire timeupdate when playAt rewinds the finished clip to 0.
  first.currentTime = 0;
  first.dispatchEvent(new window.Event("timeupdate"));
  expect(card.querySelectorAll('.df-word[data-scene="a1"].is-current').length).toBe(0);
  // A finished clip reads as fully read, last word included.
  expect([...card.querySelectorAll('.df-word[data-scene="a1"]')].every((word) => word.classList.contains("is-read"))).toBe(true);
});

test("Next on the final card in story view closes the sheet and lands on the visible Copy answers", () => {
  const { document } = storyBoot();
  document.getElementById("df-transport-next").click();
  document.querySelector('[data-decision="b"] .df-answer-open').click();
  const next = sheetOf(document, "b").querySelector(".df-next");
  next.click();
  expect(sheetOf(document, "b").classList.contains("is-open")).toBe(false);
  expect(document.querySelectorAll("[inert]").length).toBe(0);
  expect(document.activeElement).toBe(document.querySelector(".df-story-copy"));
  expect(next.classList.contains("is-acknowledged")).toBe(true);
  expect(document.querySelector(".df-story-copy").classList.contains("is-ready")).toBe(true);
});

test("when a card's final clip ends, every word of the card reads as read", () => {
  const { window, document } = boot();
  const card = document.querySelector('[data-decision="a"]');
  card.querySelector(".df-play").click();
  card.querySelector('audio[data-audio-scene="a1"]').dispatchEvent(new window.Event("ended"));
  card.querySelector('audio[data-audio-scene="a2"]').dispatchEvent(new window.Event("ended"));
  const words = [...card.querySelectorAll(".df-word")];
  expect(words.every((word) => word.classList.contains("is-read") && !word.classList.contains("is-current"))).toBe(true);
  expect(card.querySelector(".df-play").textContent).toContain("Play again");
});
