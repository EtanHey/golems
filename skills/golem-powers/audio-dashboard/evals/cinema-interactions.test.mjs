import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Window } from "happy-dom";

const here = path.dirname(fileURLToPath(import.meta.url));
const cinemaScript = readFileSync(
  path.join(here, "..", "vendor", "agent-html", "templates", "v4-story-mode", "cinema.js"),
  "utf8",
);

function bootCinema() {
  const window = new Window();
  const { document } = window;
  window.matchMedia = () => ({ matches: false });
  window.GolemPlaylist = {
    getRate: () => 0.8,
    jumpTo: () => {},
    pause: () => {},
    play: () => {},
    setRate: () => {},
    stop: () => {},
  };

  document.body.innerHTML = `
    <script id="tpdata" type="application/json">{
      "first":{"cues":[{"start":0,"end":1,"text":"first scene words"}],"total":1},
      "second":{"cues":[{"start":0,"end":1,"text":"second scene words"}],"total":1}
    }</script>
    <div id="cinema">
      <span id="cx-scene-n">1</span><span id="cx-scene-total"></span>
      <span id="cx-domain-chip"></span><span id="cx-domain-big"></span>
      <span id="cx-runtime"></span><h2 id="cx-title"></h2>
      <div id="cx-tele"><p id="cx-idle">idle prompt</p></div>
      <div id="cx-prog"><div id="cx-prog-fill"></div></div>
      <div id="cx-rail"></div>
      <button id="cx-prev"></button><button id="cx-play"></button>
      <button id="cx-next"></button><button id="cx-stop"></button>
      <select id="cx-speed"><option value="0.8">0.8</option></select>
      <button id="cx-exit"></button><button id="cx-resume"></button>
    </div>
    <div id="golem-playall-bar"><button id="pa-stop"></button></div>
    <section class="sec">
      <span class="dom-chip dom-overview">Overview</span><h2 class="sec-title">First</h2>
      <div class="aud" data-tp="first"><span class="who-dur">0:01</span><audio></audio></div>
    </section>
    <section class="sec">
      <span class="dom-chip dom-verdict">Verdict</span><h2 class="sec-title">Second</h2>
      <div class="aud" data-tp="second"><span class="who-dur">0:01</span><audio></audio></div>
    </section>
  `;

  const run = new Function(
    "window",
    "document",
    "CustomEvent",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    cinemaScript,
  );
  run(window, document, window.CustomEvent, () => 1, () => {});
  return { document, window };
}

test("cold-load and inactive audio cues cannot replace the visible scene teleprompter", () => {
  const { document, window } = bootCinema();
  const teleprompter = document.getElementById("cx-tele");

  document.dispatchEvent(new window.CustomEvent("golem:cue", {
    detail: { key: "second", cueIndex: 0, wordIndex: 0 },
  }));
  expect(teleprompter.textContent).toContain("idle prompt");
  expect(teleprompter.textContent).not.toContain("second scene words");

  document.dispatchEvent(new window.CustomEvent("golem:active", {
    detail: { key: "first", index: 0, state: "playing" },
  }));
  expect(document.getElementById("cx-title").textContent).toBe("First");
  expect(teleprompter.textContent).toContain("first scene words");

  document.dispatchEvent(new window.CustomEvent("golem:cue", {
    detail: { key: "second", cueIndex: 0, wordIndex: 0 },
  }));
  expect(teleprompter.textContent).toContain("first scene words");
  expect(teleprompter.textContent).not.toContain("second scene words");

  document.dispatchEvent(new window.CustomEvent("golem:active", {
    detail: { key: "second", index: 1, state: "playing" },
  }));
  expect(document.getElementById("cx-title").textContent).toBe("Second");

  document.dispatchEvent(new window.CustomEvent("golem:active", {
    detail: { key: null, index: -1, state: "stopped" },
  }));
  expect(document.getElementById("cx-scene-n").textContent).toBe("1");
  expect(document.getElementById("cx-title").textContent).toBe("First");
  expect(teleprompter.textContent).toContain("idle prompt");
});
