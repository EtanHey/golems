import { Window } from "happy-dom";
import { renderDecisionFlow } from "../src/decision-flow.mjs";

export function scene(id, words = ["one", "two"]) {
  return {
    id,
    title: id,
    script: words.join(" "),
    duration: 1,
    audioUrl: "data:audio/mpeg;base64,SUQz",
    words: words.map((word, index) => ({ word, start: index * 0.4, end: index * 0.4 + 0.3 })),
  };
}

export const DEFAULT_DECISIONS = [
  { id: "a", title: "A", options: ["Keep", "Change"], sceneIds: ["a1", "a2"] },
  { id: "b", title: "B", options: ["One", "Two"], sceneIds: ["b1"] },
];

export function boot({ decisions = DEFAULT_DECISIONS, scenes = [scene("a1"), scene("a2"), scene("b1")], seed, clipboard, storageError = () => false, touch = false, clock = Date, schedule = setTimeout, runtimeTransform = source => source } = {}) {
  const html = renderDecisionFlow({
    title: "Audio decision dashboard",
    kicker: "Audio decision dashboard",
    heading: "Two calls",
    subtitle: "Listen and decide.",
    storageKey: "dbx:interaction-test",
    cinemaUrl: "./interaction-test-audio.html",
    scenes,
    decisions,
  });
  const window = new Window();
  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = query => query === "(pointer: coarse)" ? { matches: touch } : nativeMatchMedia(query);
  if (seed) window.localStorage.setItem("dbx:interaction-test", JSON.stringify(seed));
  if (clipboard) Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: clipboard });
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
  new Function("document", "localStorage", "navigator", "Date", "setTimeout", runtimeTransform(scripts.at(-1).textContent))(
    window.document,
    { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => { if (storageError()) throw new Error("quota"); window.localStorage.setItem(key, value); } },
    window.navigator, clock, schedule,
  );
  return { window, document: window.document, html };
}

export function selectText(run, first, last = first) {
  const range = run.document.createRange(); range.setStart(first.firstChild, 0); range.setEnd(last.firstChild, last.textContent.length);
  range.getBoundingClientRect = () => ({ left: 80, right: 160, top: 100, bottom: 120 });
  const selection = run.window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  run.document.dispatchEvent(new run.window.Event("selectionchange"));
}

