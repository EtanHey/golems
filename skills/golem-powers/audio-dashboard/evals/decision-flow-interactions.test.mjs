import { expect, test } from "bun:test";
import { Window } from "happy-dom";

import { renderDecisionFlow } from "../src/decision-flow.mjs";

function scene(id, words = ["one", "two"]) {
  return {
    id,
    title: id,
    script: words.join(" "),
    duration: 1,
    audioUrl: "data:audio/mpeg;base64,SUQz",
    words: words.map((word, index) => ({ word, start: index * 0.4, end: index * 0.4 + 0.3 })),
  };
}

function boot() {
  const html = renderDecisionFlow({
    title: "Audio decision dashboard",
    kicker: "Audio decision dashboard",
    heading: "Two calls",
    subtitle: "Listen and decide.",
    storageKey: "dbx:interaction-test",
    cinemaUrl: "./interaction-test-audio.html",
    scenes: [scene("a1"), scene("a2"), scene("b1")],
    decisions: [
      { id: "a", title: "A", options: ["Keep", "Change"], sceneIds: ["a1", "a2"] },
      { id: "b", title: "B", options: ["One", "Two"], sceneIds: ["b1"] },
    ],
  });
  const window = new Window();
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.__scrolledIntoView = true; };
  Object.defineProperty(window.HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get() { return this.__paused ?? true; },
  });
  window.HTMLMediaElement.prototype.play = function play() {
    this.__paused = false;
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function pause() { this.__paused = true; };
  window.document.write(html);
  const scripts = [...window.document.querySelectorAll("script")];
  new Function("document", "localStorage", "navigator", scripts.at(-1).textContent)(
    window.document,
    window.localStorage,
    window.navigator,
  );
  return { window, document: window.document };
}

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
  const order = [...card.children].map((child) => child.className.split(" ")[0]);
  expect(order.indexOf("df-player")).toBeLessThan(order.indexOf("df-question"));
  expect(order.indexOf("df-teleprompter")).toBeLessThan(order.indexOf("df-question"));
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
