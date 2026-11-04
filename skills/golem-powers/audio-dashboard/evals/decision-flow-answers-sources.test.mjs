import { expect, test } from "bun:test";
import { boot, scene } from "./decision-flow-harness.mjs";
import * as decisionFlow from "../src/decision-flow.mjs";
import { validateAudioDashboardEvidence } from "../src/audio-dashboard-evidence.mjs";

// Polish rules (Etan, 2026-11-04, 0300 dashboard): real selections only where something is asked, and one closed
// Sources drawer per card. Tests that check a rule fail on the pre-polish renderer (4b2df04f, RED run in the PR
// body); the evidence-guard and audio-preservation tests are invariants that hold on both.
const { findBareReferences, renderDecisionFlow } = decisionFlow;

const scenes = [scene("i1"), scene("s1"), scene("m1"), scene("t1")];
const INFO = { id: "info", title: "Info", body: "One short line.", sceneIds: ["i1"] };
const SINGLE = { id: "single", title: "Single", body: "Pick one.", options: ["Keep", "Change"], sceneIds: ["s1"] };
const MULTI = { id: "multi", title: "Multi", body: "Pick any.", multiple: true, options: ["Alpha", "Beta", "Gamma"], sceneIds: ["m1"] };
const TEXT = { id: "text", title: "Text", body: "Say it.", answer: { type: "text", label: "What should the homepage be?" }, sceneIds: ["t1"] };
const ALL = [INFO, SINGLE, MULTI, TEXT];
const visible = el => Boolean(el) && !el.closest("[hidden]") && !el.closest("details:not([open])");
const card = (document, id) => document.querySelector(`[data-decision="${id}"]`);
const label = (document, id) => document.querySelector(`[data-index-for="${id}"]`).getAttribute("aria-label");

test("info card: no visible answer input, not counted, optional note stays collapsed", () => {
  const { document } = boot({ decisions: ALL, scenes });
  const info = card(document, "info");
  expect([...info.querySelectorAll("input, textarea")].filter(visible)).toHaveLength(0);
  expect(info.querySelector(".df-note-toggle").textContent).toContain("Add a note");
  expect(info.querySelector(".df-skip")).toBeNull();
  expect(info.querySelector(".df-title .df-answer-status")).toBeNull();
  expect(document.querySelector(".df-tally").textContent).toBe("0 of 3 answered, 3 left");
  info.querySelector(".df-note-toggle").click();
  expect(visible(info.querySelector(".df-free"))).toBe(true);
  const free = info.querySelector(".df-free"); free.value = "a thought"; free.dispatchEvent(new document.defaultView.Event("input"));
  expect(document.querySelector(".df-tally").textContent).toBe("0 of 3 answered, 3 left");
  expect(label(document, "info")).toContain("no answer needed");
});

test("single choice: radios answer it; a note never completes the pick", () => {
  const { document, window } = boot({ decisions: ALL, scenes });
  const single = card(document, "single");
  expect([...single.querySelectorAll('input[type="radio"]')].filter(visible)).toHaveLength(2);
  expect(visible(single.querySelector(".df-free"))).toBe(false);
  single.querySelector(".df-note-toggle").click();
  const free = single.querySelector(".df-free"); free.value = "maybe"; free.dispatchEvent(new window.Event("input"));
  expect(label(document, "single")).toContain("Awaiting answer");
  single.querySelector('input[value="Change"]').click();
  expect(label(document, "single")).toContain("Answered");
  expect(document.querySelector(".df-tally").textContent).toBe("1 of 3 answered, 2 left");
});

test("multiple picks: independent checkboxes, stored as a list, exported in order", async () => {
  let copied = "";
  const { document, window } = boot({ decisions: ALL, scenes, clipboard: { writeText: text => { copied = text; return Promise.resolve(); } } });
  const multi = card(document, "multi");
  const boxes = [...multi.querySelectorAll('.df-options input[type="checkbox"].df-pick')];
  expect(boxes).toHaveLength(3);
  expect(multi.querySelector('input[type="radio"]')).toBeNull();
  boxes[2].click(); boxes[0].click();
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test")).multi).toEqual(["Alpha", "Gamma"]);
  expect(label(document, "multi")).toContain("Answered");
  boxes[0].click(); boxes[2].click();
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test")).multi).toBeUndefined();
  expect(label(document, "multi")).toContain("Awaiting answer");
  boxes[1].click();
  document.getElementById("df-copy").click(); await Promise.resolve();
  expect(copied).toContain("### Multi\n- picked: Beta");
});

test("explicit text answer: labelled, always visible, completes the card", () => {
  const { document, window } = boot({ decisions: ALL, scenes });
  const text = card(document, "text"), area = text.querySelector("textarea.df-ask");
  expect(visible(area)).toBe(true);
  expect(text.querySelector(`label[for="${area.id}"]`).textContent).toBe("What should the homepage be?");
  expect(text.querySelector(".df-note-toggle")).toBeNull();
  area.value = "etanheyman.com"; area.dispatchEvent(new window.Event("input"));
  expect(label(document, "text")).toContain("Answered");
});

test("populated legacy note on an info card stays visible and stored, and does not count", async () => {
  let copied = "";
  const seed = { "info-free": "Legacy note", single: "Keep", "single-free": "Legacy single note" };
  const { document, window } = boot({ decisions: ALL, scenes, seed, clipboard: { writeText: text => { copied = text; return Promise.resolve(); } } });
  const info = card(document, "info");
  expect(visible(info.querySelector(".df-free"))).toBe(true);
  expect(info.querySelector(".df-free").value).toBe("Legacy note");
  expect(info.querySelector(".df-note-toggle").hidden).toBe(true);
  expect(document.querySelector(".df-tally").textContent).toBe("1 of 3 answered, 2 left");
  expect(JSON.parse(window.localStorage.getItem("dbx:interaction-test"))["info-free"]).toBe("Legacy note");
  document.getElementById("df-copy").click(); await Promise.resolve();
  expect(copied).toContain("### Info\n- note: Legacy note");
  expect(copied).toContain("### Single\n- picked: Keep\n- note: Legacy single note");
});

const one = [{ label: "Repo", value: "golems", href: "https://github.com/EtanHey/golems" }];
const many = [...one, { label: "PR", value: "#39", href: "https://github.com/EtanHey/golems/pull/39" }, { label: "Files", value: "10,155" }];
const render = decisions => renderDecisionFlow({ scenes: scenes.filter(item => decisions.some(decision => decision.sceneIds.includes(item.id))), decisions });

test("Sources: none, one or many entries in one closed native drawer, never an inline rail", () => {
  const html = render([{ ...INFO, rail: many, sourceNote: "Owner report, 2026-11-04." }, { ...SINGLE, rail: one }, MULTI]);
  const { document } = boot({ decisions: [{ ...INFO, rail: many, sourceNote: "Owner report, 2026-11-04." }, { ...SINGLE, rail: one }, MULTI], scenes: scenes.slice(0, 3) });
  const drawers = [...document.querySelectorAll("details.df-sources")];
  expect(drawers).toHaveLength(2);
  expect(drawers.every(drawer => !drawer.open)).toBe(true);
  expect([...document.querySelectorAll(".df-rail")].every(rail => rail.closest("details.df-sources"))).toBe(true);
  expect(drawers[0].querySelector("summary").textContent).toBe("Sources3");
  expect(drawers[0].querySelector("summary").getAttribute("aria-label")).toBe("Sources, 3 entries");
  expect(drawers[0].querySelector(".df-source-note").textContent).toBe("Owner report, 2026-11-04.");
  expect(drawers[1].querySelector("summary").textContent).toBe("Source");
  expect(card(document, "multi").querySelector(".df-sources")).toBeNull();
  const anchors = [...html.matchAll(/<a class="df-rail-link"[^>]*>/g)].map(match => match[0]);
  expect(anchors).toHaveLength(3);
  expect(anchors.every(tag => tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"'))).toBe(true);
  expect(findBareReferences([{ ...INFO, rail: one, sourceNote: "See #41." }])).toEqual([{ decision: "info", field: "sourceNote", ref: "#41" }]);
});

test("malformed and unsafe source URLs stay plain text", () => {
  const rail = [
    { label: "Script", value: "x", href: "javascript:alert(1)" },
    { label: "Data", value: "y", href: "data:text/html,<b>z</b>" },
    { label: "Broken", value: "not a url", href: "not a url" },
    { label: "Ftp", value: "ftp", href: "ftp://example.com/file" },
    { label: "Ok", value: "fine", href: "https://example.com/ok" },
  ];
  const html = render([{ ...INFO, rail }]);
  const drawer = html.match(/<details class="df-sources"[\s\S]*?<\/details>/)[0];
  expect((drawer.match(/<a /g) || []).length).toBe(1);
  expect(drawer).not.toContain("javascript:");
  expect(drawer).not.toContain("data:text");
  expect(drawer).toContain("<dd>not a url</dd>");
  expect(() => render([{ ...INFO, sourceNote: "x".repeat(281) }])).toThrow(/sourceNote/);
});


test("answer-kind specs fail closed on ambiguous asks", () => {
  expect(() => render([{ ...SINGLE, answer: { type: "text", label: "Why?" } }])).toThrow(/cannot combine/);
  expect(() => render([{ ...INFO, answer: { type: "text" } }])).toThrow(/label/);
  expect(() => render([{ ...INFO, answer: { type: "number" } }])).toThrow(/answer must be/);
  expect(() => render([{ ...INFO, multiple: true, options: ["Only"] }])).toThrow(/at least two/);
});

test("text-only card keeps the Sources drawer; repeated prose in a drawer still fails the evidence gate", () => {
  const codes = html => validateAudioDashboardEvidence({ html }).violations.map(v => v.code);
  expect(codes(render([{ ...INFO, rail: many, sourceNote: "Owner report." }]))).not.toContain("TEXT_ONLY_VIEW_DETAILS");
  const abuse = '<article class="df-card" data-title="Abuse"><details class="df-sources"><summary>Sources</summary><div class="df-sources-body"><p>The whole card text repeated here.</p><p>Again.</p><p>And again.</p></div></details></article>';
  expect(codes(abuse)).toContain("TEXT_ONLY_VIEW_DETAILS");
  const long = `<article class="df-card"><details class="df-sources"><summary>Sources</summary><div class="df-sources-body"><p class="df-source-note">${"x".repeat(281)}</p></div></details></article>`;
  expect(codes(long)).toContain("TEXT_ONLY_VIEW_DETAILS");
  const plain = '<article class="df-card"><details><summary>View details</summary><p>Repeat.</p></details></article>';
  expect(codes(plain)).toContain("TEXT_ONLY_VIEW_DETAILS");
});

test("full audio preserved: card polish changes no timing, transcript or scene ownership", () => {
  const tp = html => html.match(/<script id="tpdata" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const words = html => [...html.matchAll(/<span class="df-word"[^>]*>[^<]*<\/span>/g)].map(m => m[0]).join("");
  const plain = render(ALL.map(({ id, title, sceneIds }) => ({ id, title, sceneIds, options: ["A", "B"] })));
  const polished = render([{ ...INFO, rail: many, sourceNote: "Owner report." }, SINGLE, MULTI, TEXT]);
  expect(tp(polished)).toBe(tp(plain));
  expect(words(polished)).toBe(words(plain));
  expect((polished.match(/data-audio-scene="/g) || []).length).toBe(4);
});


test("Sources reject essays at producer input and structurally forged rails in evidence", () => {
  expect(() => render([{ ...INFO, rail: [{ label: "Evidence", value: "Essay ".repeat(900) }] }])).toThrow(/rail/);
  expect(() => render([{ ...INFO, rail: [{ label: "x".repeat(49), value: "short" }] }])).toThrow(/rail/);
  const valid = render([{ ...INFO, rail: one }]);
  for (const content of [
    '<p>Essay inside a rail.</p>',
    '<div><dt>Evidence</dt><dd>' + "Essay ".repeat(900) + '</dd></div>',
    '<div><dt>Evidence</dt><dd><div>Nested prose</div></dd></div>',
    '<div><dt><b>Nested label</b></dt><dd>short</dd></div>',
  ]) {
    const html = valid.replace(/<dl class="df-rail">[\s\S]*?<\/dl>/, '<dl class="df-rail">' + content + '</dl>');
    expect(validateAudioDashboardEvidence({ html }).violations.map(v => v.code)).toContain("TEXT_ONLY_VIEW_DETAILS");
  }
  const url = 'https://example.com/source?query=' + 'a'.repeat(300);
  const linked = render([{ ...INFO, rail: [{ label: "Source", value: url, href: url }], sourceNote: "Owner attribution." }]);
  expect(linked).toContain(url);
  expect(validateAudioDashboardEvidence({ html: linked }).violations.map(v => v.code)).not.toContain("TEXT_ONLY_VIEW_DETAILS");
});
