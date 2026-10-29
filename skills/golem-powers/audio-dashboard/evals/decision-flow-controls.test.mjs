import { expect, test } from "bun:test";
import { boot, scene, selectText } from "./decision-flow-harness.mjs";

const decisions = ["a", "b", "c"].map(id => ({ id, title: id.toUpperCase(), body: "A briefing to cite.", options: ["Keep", "Change"], sceneIds: [id + "1", id + "2"], checklist: [{ title: "Check", items: ["First", "Second"] }] }));
function setup(touch = false, runtimeTransform) {
  let now = 0;
  const timers = [], run = boot({ decisions, scenes: decisions.flatMap(d => d.sceneIds.map(id => scene(id))), touch, runtimeTransform, clock: { now: () => now }, schedule: fn => timers.push(fn) });
  run.document.querySelector(".df-dock").getBoundingClientRect = () => ({ top: 744, bottom: 768 });
  return { ...run, timers, settle: () => { now += 6000; } };
}
function key(run, value) { run.document.dispatchEvent(new run.window.KeyboardEvent("keydown", { key: value, bubbles: true })); }

test("touch Cite survives selection dismissal during a tap, opens its quote, and returns focus", () => {
  const run = setup(true), d = run.document, controller = d.querySelector(".df-controller"), button = d.getElementById("df-controller-cite");
  expect(button).not.toBeNull();
  selectText(run, d.querySelector(".df-question p"));
  expect(button.hidden).toBe(false); expect(d.getElementById("df-cite").hidden).toBe(true);
  expect(button.previousElementSibling.id).toBe("df-transport-next");
  button.dispatchEvent(new run.window.PointerEvent("pointerdown", { bubbles: true }));
  run.window.getSelection().removeAllRanges(); d.dispatchEvent(new run.window.Event("selectionchange")); button.click();
  expect(d.getElementById("df-note-dialog").open).toBe(true); expect(d.getElementById("df-note-quote").textContent).toBe("A briefing to cite.");
  key(run, "Escape");
  d.getElementById("df-view-toggle").click(); d.querySelector(".df-card.is-active .df-answer-open").click();
  selectText(run, d.querySelector(".df-sheet.is-open .df-question p"));
  expect(controller.hasAttribute("inert")).toBe(true); expect(button.closest(".df-sheet-head")).not.toBeNull();
  button.click(); key(run, "Escape"); expect(d.activeElement.classList.contains("df-sheet-done")).toBe(true);
  d.querySelector(".df-sheet.is-open .df-sheet-done").click(); expect(controller.contains(button)).toBe(true);
  run.window.close();
});

test("a delayed Skip cannot override a newer navigation or restart audio after Stop", () => {
  const run = setup(), d = run.document;
  d.querySelector(".df-skip").click(); d.getElementById("df-transport-prev").click();
  d.getElementById("df-view-toggle").click(); d.getElementById("df-transport-stop").click(); run.timers.shift()?.();
  expect(d.querySelector(".df-card.is-active").dataset.decision).toBe("a");
  expect([...d.querySelectorAll("audio")].every(a => a.paused)).toBe(true); run.window.close();
});

// An independent oracle: one playback state per card; orthogonal view, modal, selection and Clear states.
const initial = touch => ({ current: 0, playback: ["idle", "idle", "idle"], clip: [0, 0, 0], rate: 1, view: "list", sheet: false, note: false, selection: false, armed: false, clear: false, touch });
const quiet = m => !m.note && !m.sheet && !m.clear && !m.armed;
const play = (m, target = m.current) => { m.playback = m.playback.map((p, i) => i === target ? "playing" : p === "playing" ? "paused" : p); if (m.clip[target] === 2) m.clip[target] = 0; m.current = target; };
const move = (m, target) => { const playing = m.playback.includes("playing"); m.sheet = false; m.current = target; if (playing) play(m); };
const citeNote = m => { const selected = m.armed || m.selection; m.note = true; m.noteQuote = selected.quote; m.selection = false; m.armed = false; if (m.playback[selected.card] === "playing") m.playback[selected.card] = "paused"; };
const transitions = [
  ["play", m => quiet(m) && m.playback[m.current] === "idle", m => play(m)],
  ["pause", m => quiet(m) && m.playback[m.current] === "playing", m => { m.playback[m.current] = "paused"; }],
  ["resume", m => quiet(m) && m.playback[m.current] === "paused", m => play(m)],
  ["replay", m => quiet(m) && m.playback[m.current] === "complete", m => play(m)],
  ["restart", m => quiet(m) && m.view === "list", m => { m.clip[m.current] = 0; play(m); }],
  ["stop", m => quiet(m) && m.view === "story", m => { m.playback[m.current] = "idle"; m.clip[m.current] = 0; }],
  ["ended", m => quiet(m) && m.playback[m.current] === "playing", m => { if (++m.clip[m.current] === 2) m.playback[m.current] = "complete"; }],
  ["next", m => quiet(m) && m.current < 2, m => move(m, m.current + 1)],
  ["prev", m => quiet(m) && m.current > 0, m => move(m, m.current - 1)],
  ["jump", quiet, (m, n) => move(m, n % 3)],
  ["cardNext", m => !m.note && !m.clear && !m.armed && m.current < 2, m => { m.sheet = false; play(m, m.current + 1); }],
  ["skip", m => !m.note && !m.clear && !m.armed && m.current < 2, m => { m.sheet = false; play(m, m.current + 1); }],
  ["timer", quiet, () => {}],
  ["speed", quiet, (m, n) => { m.rate = [0.8, 1, 1.25, 1.5, 1.75, 2][n % 6]; }],
  ["view", quiet, m => { m.view = m.view === "list" ? "story" : "list"; }],
  ["answer", m => quiet(m) && m.view === "story", m => { m.sheet = true; }],
  ["done", m => m.sheet && !m.note && !m.clear && !m.armed, m => { m.sheet = false; }],
  ["note", m => !m.note && !m.clear && !m.armed && (m.view === "list" || m.sheet), m => { m.note = true; m.noteQuote = "First"; m.selection = false; if (m.playback[m.current] === "playing") m.playback[m.current] = "paused"; }],
  ["select", m => !m.note && !m.clear && !m.armed, m => { m.selection = { card: m.current, valid: true, quote: m.view === "story" && !m.sheet ? "one" : "A briefing to cite." }; }],
  ["crossSelect", m => quiet(m) && m.view === "list" && m.current < 2, m => { m.selection = { card: m.current, valid: false }; }],
  ["deselect", m => !m.note && m.selection, m => { m.selection = false; }],
  ["word", m => quiet(m) && m.selection && (m.view === "story" || ["playing", "paused"].includes(m.playback[m.current])), () => {}],
  ["cite", m => !m.note && !m.armed && m.selection?.valid, citeNote],
  ["armCite", m => !m.note && !m.armed && m.selection?.valid, m => { m.armed = { ...m.selection }; }],
  ["armedClick", m => m.armed && !m.selection, citeNote],
  ["cancelArm", m => m.armed, m => { m.armed = false; }],
  ["outsideDown", m => m.armed, m => { m.armed = false; }],
  ["modalSelection", m => m.note, () => {}],
  ["blank", m => m.note, () => {}],
  ["save", m => m.note, m => { m.note = false; }],
  ["cancel", m => m.note, m => { m.note = false; }],
  ["clear", m => !m.note && !m.clear && !m.armed && (m.view === "list" || m.sheet), m => { m.clear = true; }],
  ["keep", m => m.clear, m => { m.clear = false; }],
  ["clearApply", m => m.clear, m => { m.clear = false; }],
  ["scroll", m => quiet(m) && m.view === "list" && !m.playback.includes("playing"), (m, n) => { m.current = n % 3; }],
];
function drive(run, before, event, n) {
  const d = run.document, card = d.querySelectorAll(".df-card")[before.current], click = selector => d.querySelector(selector).click(), selection = run.window.getSelection();
  const cite = d.getElementById(before.touch ? "df-controller-cite" : "df-cite");
  const transport = { play: "play", pause: "play", resume: "play", replay: "play", next: "next", prev: "prev", stop: "stop" };
  if (transport[event]) return click("#df-transport-" + transport[event]);
  if (["restart", "cardNext", "skip", "answer", "note", "clear", "keep", "clearApply"].includes(event)) return card.querySelector({ restart: ".df-restart", cardNext: ".df-next", skip: ".df-skip", answer: ".df-answer-open", note: ".df-item-note", clear: ".df-clear", keep: ".df-clear-cancel", clearApply: ".df-clear-apply" }[event]).click();
  if (event === "jump") return click('[data-chip-for="' + decisions[n % 3].id + '"]');
  if (event === "timer") { run.timers.shift()?.(); return; }
  if (event === "ended") { card.querySelectorAll("audio")[before.clip[before.current]].onended(); return; }
  if (event === "speed") { const speed = d.getElementById("df-speed"); speed.value = String([0.8, 1, 1.25, 1.5, 1.75, 2][n % 6]); speed.dispatchEvent(new run.window.Event("change")); return; }
  if (event === "view") return click("#df-view-toggle");
  if (event === "done") return card.querySelector(".df-sheet-done").click();
  if (event === "select" || event === "crossSelect") { const selector = before.view === "list" || before.sheet ? ".df-question p" : ".df-word"; selectText(run, card.querySelector(selector), (event === "crossSelect" ? d.querySelectorAll(".df-card")[before.current + 1] : card).querySelector(selector)); return; }
  if (event === "deselect") { selection.removeAllRanges(); d.dispatchEvent(new run.window.Event("selectionchange")); return; }
  if (event === "word") return card.querySelectorAll(".df-word")[1].click();
  if (event === "cite" || event === "armedClick") return cite.click();
  if (event === "armCite" || event === "cancelArm") return cite.dispatchEvent(new run.window.PointerEvent(event === "armCite" ? "pointerdown" : "pointercancel", { bubbles: true, pointerType: before.touch ? "touch" : "mouse" }));
  if (event === "outsideDown") return d.body.dispatchEvent(new run.window.PointerEvent("pointerdown", { bubbles: true }));
  if (event === "modalSelection") {
    // Probe a transient browser-restored background range while the dialog owns the UI.
    selectText(run, card.querySelector(".df-question p")); assertCitationState(run, before);
    selection.removeAllRanges(); d.dispatchEvent(new run.window.Event("selectionchange")); return;
  }
  if (event === "blank" || event === "save") { d.getElementById("df-note-text").value = event === "blank" ? "" : "A generated note"; return click("#df-note-save"); }
  if (event === "cancel") return key(run, "Escape");
  if (event === "scroll") { run.settle(); d.querySelectorAll(".df-card").forEach((c, i) => { c.getBoundingClientRect = () => ({ top: i === n % 3 ? 100 : 2000, bottom: i === n % 3 ? 700 : 2200 }); }); run.window.dispatchEvent(new run.window.Event("scroll")); }
}
function assertCitationState(run, model) {
  const d = run.document, offered = Boolean((model.armed || model.selection?.valid) && !model.note), touch = d.getElementById("df-controller-cite");
  try {
    expect(d.getElementById("df-cite").hidden).toBe(!offered || model.touch);
    expect(touch.hidden).toBe(!offered || !model.touch);
    expect(touch.parentElement).toBe(model.sheet ? d.querySelector(".df-sheet.is-open .df-sheet-head") : d.querySelector(".df-transport"));
  } catch (error) { throw new Error("Citation model mismatch: " + error.message); }
}
function assertState(run, model, event, previousTimes) {
  assertCitationState(run, model);
  const d = run.document, cards = [...d.querySelectorAll(".df-card")], id = decisions[model.current].id;
  expect(cards.filter(c => c.classList.contains("is-active")).map(c => c.dataset.decision)).toEqual([id]);
  expect([...d.querySelectorAll(".df-chip[aria-current]")].map(c => c.dataset.chipFor)).toEqual([id]);
  expect([...d.querySelectorAll("[data-index-for].is-active")].map(c => c.dataset.indexFor)).toEqual([id]);
  expect(d.getElementById("df-now").textContent.endsWith(decisions[model.current].title)).toBe(true);
  cards.forEach((card, i) => { expect(card.classList.contains("is-playing")).toBe(model.playback[i] === "playing"); expect(Number(card.dataset.audioIndex || 0)).toBe(model.clip[i]); expect([...card.querySelectorAll("audio")].some(a => !a.paused)).toBe(model.playback[i] === "playing"); });
  expect(d.body.dataset.view).toBe(model.view); expect(d.querySelectorAll(".df-sheet.is-open").length).toBe(Number(model.sheet)); expect(d.getElementById("df-note-dialog").open).toBe(model.note);
  if (model.note) expect(d.getElementById("df-note-quote").textContent).toBe(model.noteQuote);
  expect(cards[model.current].querySelector(".df-clear-confirm").hidden).toBe(!model.clear);
  expect([...d.querySelectorAll("audio")].every(a => a.playbackRate === model.rate)).toBe(true);
  if (event === "word") expect([...d.querySelectorAll("audio")].map(a => a.currentTime)).toEqual(previousTimes);
  if (event === "stop") expect([...d.querySelectorAll("audio")].every(a => a.paused)).toBe(true);
}

function generatedPaths(runtimeTransform) {
  const coverage = [new Set(), new Set()];
  for (let seed = 1; seed <= 12; seed++) {
    const touch = seed % 2 === 0, covered = coverage[Number(touch)], run = setup(touch, runtimeTransform), model = initial(touch), trace = []; let rng = seed;
    try { for (let step = 0; step < 100; step++) {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      const enabled = transitions.filter(([, guard]) => guard(model)), fresh = enabled.filter(([event]) => !covered.has(event)), pool = fresh.length ? fresh : enabled;
      const [event, , reduce] = pool[rng % pool.length], before = structuredClone(model), times = [...run.document.querySelectorAll("audio")].map(a => a.currentTime);
      trace.push(event + ":" + rng); drive(run, before, event, rng); reduce(model, rng); assertState(run, model, event, times); covered.add(event);
    } } catch (error) { throw new Error(`seed=${seed} touch=${touch} path=${trace.join(" → ")}\n${error.stack}`); } finally { run.window.close(); }
  }
  for (const covered of coverage) expect([...covered].sort()).toEqual(transitions.map(([event]) => event).sort());
}
test("generated control paths satisfy playback, navigation, modal and selection invariants", () => generatedPaths(), 30000);

const citationMutants = [
  ["touch Cite never shown", "touchCite.hidden=!selected||noteDialog.open||!touch", "touchCite.hidden=true"],
  ["floating Cite never shown", "cite.hidden=!selected||noteDialog.open||touch", "cite.hidden=true"],
  ["armed quote ignored", "var selected=armedCitation||selectionQuote();", "var selected=selectionQuote();"],
  ["Cite visible while dialog open", "||noteDialog.open", ""],
];
for (const [name, from, to] of citationMutants) test("generated citation model kills mutant: " + name, () => {
  expect(() => generatedPaths(source => { expect(source).toContain(from); return source.replaceAll(from, to); })).toThrow("Citation model mismatch");
}, 30000);
