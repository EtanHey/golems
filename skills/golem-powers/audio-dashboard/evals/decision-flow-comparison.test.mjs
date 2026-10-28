import { expect, test } from "bun:test";
import { renderDecisionFlow } from "../src/decision-flow.mjs";
import { boot, scene } from "./decision-flow-harness.mjs";

// AD-15 (Etan, 2026-10-28 dashboard feedback): a comparison that never loads must not sit on "Loading…".
const decisions = [
  { id: "a", title: "Voices", options: ["Keep", "Change"], sceneIds: ["a1"], comparison: { url: "visuals/a.html", label: "View comparison" } },
  { id: "b", title: "Plain", options: ["One", "Two"], sceneIds: ["b1"] },
];

const PAGE = "https://dash.test/d/index.html";
const TARGET = "https://dash.test/d/visuals/a.html";

// engine "chromium" reports navigation responseStatus; "webkit" (Safari) has no such property.
function setup(renderOptions, cards = decisions, { ownLoads = true, engine = "chromium", url = PAGE } = {}) {
  const timers = [];
  const run = boot({
    decisions: cards,
    scenes: [scene("a1"), scene("b1")],
    renderOptions,
    url,
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  });
  const d = run.document;
  run.window.PerformanceResourceTiming = engine === "chromium" ? class { get responseStatus() { return 0; } } : class {};
  // happy-dom fails every iframe load itself (page loading is off); the tests own each load outcome instead.
  if (ownLoads) d.addEventListener("error", event => { if (event.target.tagName === "IFRAME" && !event.fromTest) event.stopImmediatePropagation(); }, true);
  const parts = {
    dialog: d.getElementById("df-compare"),
    opener: d.querySelector("#decision-a .df-compare-open"),
    frame: () => d.querySelector("#df-compare iframe"),
    message: () => d.getElementById("df-compare-message").textContent,
    retry: d.getElementById("df-compare-retry"),
    state: () => d.getElementById("df-compare").dataset.state,
  };
  const fire = (frame, type) => { const event = new run.window.Event(type); event.fromTest = true; frame.dispatchEvent(event); };
  // A load with explicit evidence: the child window the runtime may read, or a cross-origin one that throws.
  const loadWith = (frame, { status = 200, entries, visual = true, readable = true } = {}) => {
    const child = readable ? {
      location: { href: frame.src },
      performance: { getEntriesByType: () => entries ?? [{ responseStatus: status }] },
      document: { querySelector: () => (visual ? {} : null) },
    } : { get location() { throw new run.window.DOMException("Blocked a frame", "SecurityError"); } };
    Object.defineProperty(frame, "contentWindow", { configurable: true, value: child });
    fire(frame, "load");
  };
  return { ...run, timers, fire, loadWith, ...parts };
}

test("a card with a comparison renders an explicit opener and one shared dialog", () => {
  const run = setup();
  expect(run.opener).not.toBeNull();
  expect(run.opener.dataset.compareUrl).toBe("visuals/a.html");
  expect(run.opener.dataset.compareTimeout).toBe("10000");
  expect(run.opener.getAttribute("aria-controls")).toBe("df-compare");
  expect(run.document.querySelector("#decision-b .df-compare-open")).toBeNull();
  expect(run.document.querySelectorAll("#df-compare").length).toBe(1);
  run.window.close();
});

test("dashboards without comparisons carry no comparison dialog", () => {
  const html = renderDecisionFlow({ scenes: [scene("b1")], decisions: [decisions[1]] });
  expect(html).not.toContain('id="df-compare"');
  expect(html).not.toContain('class="df-compare-open"');
});

test("comparison targets must be relative URLs inside the dashboard, with a sane timeout", () => {
  const render = (comparison, extra = {}) => () => renderDecisionFlow({ scenes: [scene("a1")], decisions: [{ ...decisions[0], comparison }], ...extra });
  const unsafe = [
    "javascript:alert(1)", "data:text/html,x", "https://example.com/x.html", "//example.com/x", "/abs/x.html", "\\x.html", "",
    // The browser strips tab/LF/CR, so these parse as javascript: (observed executing in Chromium in review r1).
    "java\nscript:alert(1)", "java\tscript:alert(1)", "java\rscript:alert(1)", "\u0000javascript:alert(1)", " \tjavascript:alert(1)",
    "JaVaScRiPt:alert(1)", "../outside.html", "visuals/../../outside.html", "%2e%2e/outside.html", "visuals/%2E%2E/%2e%2e/x.html",
    "visuals/..%2fx.html", "https://other.example/visuals/a.html", "visuals/a\n.html", "#a", "?a",
  ];
  for (const url of unsafe) expect(render({ url })).toThrow(/comparison/);
  expect(render({ url: "visuals/a.html", timeoutMs: 0 })).toThrow(/timeoutMs/i);
  expect(render({ url: "visuals/a.html" }, { comparisonTimeoutMs: "soon" })).toThrow(/timeoutMs/i);
  expect(render({ url: "visuals/a.html#chart" })).not.toThrow();
  expect(renderDecisionFlow({ scenes: [scene("a1")], decisions: [{ ...decisions[0], comparison: { url: "./visuals/x/../a.html?v=2#chart" } }] }))
    .toContain('data-compare-url="visuals/a.html?v=2#chart"');
});

test("an iframe error settles Loading into a clear failure with Retry and Back", () => {
  const run = setup(), d = run.document;
  run.opener.click();
  expect(run.dialog.open).toBe(true);
  expect(run.state()).toBe("loading");
  expect(run.message()).toBe("Loading comparison…");
  expect(run.frame().src).toBe(TARGET);
  expect(d.activeElement.id).toBe("df-compare-back");
  run.fire(run.frame(), "error");
  expect(run.state()).toBe("failed");
  expect(run.message()).toContain("couldn't load");
  expect(run.retry.hidden).toBe(false);
  expect(d.getElementById("df-compare-close").hidden).toBe(false);
  expect(d.activeElement).toBe(run.retry);
  run.window.close();
});

test("an error the frame raises while it is inserted still settles the dialog", () => {
  const run = setup(undefined, decisions, { ownLoads: false });
  run.opener.click();
  expect(run.state()).toBe("failed");
  expect(run.retry.hidden).toBe(false);
  run.window.close();
});

test("a stalled load times out after the bound instead of loading forever", () => {
  const run = setup();
  run.opener.click();
  const timer = run.timers.at(-1);
  expect(timer.ms).toBe(10000);
  expect(run.state()).toBe("loading");
  timer.fn();
  expect(run.state()).toBe("failed");
  expect(run.message()).toContain("10 seconds");
  expect(run.retry.hidden).toBe(false);
  run.window.close();
});

test("the timeout is configurable per dashboard and per comparison", () => {
  const dashboard = setup({ comparisonTimeoutMs: 4000 });
  dashboard.opener.click();
  expect(dashboard.timers.at(-1).ms).toBe(4000);
  dashboard.window.close();
  const card = setup({ comparisonTimeoutMs: 4000 }, [{ ...decisions[0], comparison: { url: "visuals/a.html", timeoutMs: 2500 } }, decisions[1]]);
  card.opener.click();
  expect(card.timers.at(-1).ms).toBe(2500);
  card.timers.at(-1).fn();
  expect(card.message()).toContain("2.5 seconds");
  card.window.close();
});

test("Retry re-attempts with a fresh frame, and stale events from the old attempt are ignored", () => {
  const run = setup();
  run.opener.click();
  const first = run.frame(), firstTimer = run.timers.at(-1);
  firstTimer.fn();
  expect(run.state()).toBe("failed");
  run.retry.click();
  const second = run.frame();
  expect(second).not.toBe(first);
  expect(second.src).toBe(TARGET);
  expect(run.state()).toBe("loading");
  expect(run.message()).toBe("Loading comparison…");
  expect(run.retry.hidden).toBe(true);
  run.fire(first, "error");
  expect(run.state()).toBe("loading");
  run.loadWith(second);
  expect(run.state()).toBe("loaded");
  expect(run.message()).toBe("");
  run.timers.at(-1).fn();
  firstTimer.fn();
  expect(run.state()).toBe("loaded");
  run.window.close();
});

test("Back and Escape close the comparison, drop the frame, and return focus to the opener", () => {
  const run = setup(), d = run.document;
  run.opener.click();
  run.fire(run.frame(), "error");
  d.getElementById("df-compare-close").click();
  expect(run.dialog.open).toBe(false);
  expect(run.frame()).toBeNull();
  expect(d.activeElement).toBe(run.opener);
  run.opener.click();
  d.dispatchEvent(new run.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(run.dialog.open).toBe(false);
  expect(d.activeElement).toBe(run.opener);
  run.timers.at(-1).fn();
  expect(run.state()).toBe("idle");
  run.opener.click();
  d.getElementById("df-compare-back").click();
  expect(run.dialog.open).toBe(false);
  run.window.close();
});

test("opening a comparison pauses the card's narration", () => {
  const run = setup(), d = run.document;
  d.querySelector("#decision-a .df-play").click();
  expect(d.querySelector('audio[data-audio-scene="a1"]').paused).toBe(false);
  run.opener.click();
  expect(d.querySelector('audio[data-audio-scene="a1"]').paused).toBe(true);
  run.window.close();
});

test("a tampered target is re-checked at click time and never reaches a frame", () => {
  for (const url of ["java\nscript:parent.document.title='x'", "../outside.html", "%2e%2e/outside.html", "https://other.example/x.html", "/d/visuals/a.html"]) {
    const run = setup();
    run.opener.dataset.compareUrl = url;
    run.opener.click();
    expect(run.state()).toBe("failed");
    expect(run.message()).toContain("outside the dashboard");
    expect(run.frame()).toBeNull();
    expect(run.retry.hidden).toBe(true);
    expect(run.document.activeElement.id).toBe("df-compare-close");
    run.window.close();
  }
});

test("Chromium-style success needs a readable frame and a numeric 2xx/3xx navigation status", () => {
  const cases = [
    [{ status: 200 }, "loaded"],
    [{ status: 304 }, "loaded"],
    [{ status: 404 }, "failed"],
    [{ status: 500 }, "failed"],
    [{ entries: [] }, "failed"],
    [{ entries: [{}] }, "failed"],
    [{ entries: [{ responseStatus: "200" }] }, "failed"],
    [{ status: 0 }, "failed"],
    [{ readable: false }, "failed"],
  ];
  for (const [evidence, expected] of cases) {
    const run = setup();
    run.opener.click();
    run.loadWith(run.frame(), evidence);
    expect([JSON.stringify(evidence), run.state()]).toEqual([JSON.stringify(evidence), expected]);
    run.window.close();
  }
});

test("a frame with no window, or still on about:blank, is not a success", () => {
  for (const child of [null, { location: { href: "about:blank" } }]) {
    const run = setup();
    run.opener.click();
    Object.defineProperty(run.frame(), "contentWindow", { configurable: true, value: child });
    run.fire(run.frame(), "load");
    expect(run.state()).toBe("failed");
    run.window.close();
  }
});

test("without responseStatus (WebKit), success needs a visual in the readable page", () => {
  for (const [evidence, expected] of [[{ visual: true }, "loaded"], [{ visual: false }, "failed"], [{ readable: false }, "failed"]]) {
    const run = setup(undefined, decisions, { engine: "webkit" });
    run.opener.click();
    run.loadWith(run.frame(), evidence);
    expect(run.state()).toBe(expected);
    run.window.close();
  }
});

test("a file: dashboard cannot verify its comparison and says how to fix that", () => {
  const run = setup(undefined, decisions, { url: "file:///srv/dash/index.html" });
  run.opener.click();
  expect(run.frame().src).toBe("file:///srv/dash/visuals/a.html");
  run.loadWith(run.frame(), { readable: false });
  expect(run.state()).toBe("failed");
  expect(run.message()).toContain("over http(s)");
  expect(run.retry.hidden).toBe(false);
  run.window.close();
});
