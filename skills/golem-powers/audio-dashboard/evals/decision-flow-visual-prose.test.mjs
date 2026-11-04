import { expect, test } from "bun:test";
import { boot, scene } from "./decision-flow-harness.mjs";
import * as decisionFlow from "../src/decision-flow.mjs";

// Polish rules (Etan, 2026-11-04, 0300 dashboard): explanations belong in the audio (one or two short lines per
// card), and a formal model shows as two short labelled code panels. Every test here fails on the renderer before
// this layer (RED run in the PR body). The namespace import lets this same file run there: a renderer without the
// prose contract accepts every card.
const { renderDecisionFlow } = decisionFlow;
const analyzeCardProse = decisionFlow.analyzeCardProse ?? (() => ({ verdict: "PASS", violations: [] }));
const CARD_PROSE_MAX_CHARS = decisionFlow.CARD_PROSE_MAX_CHARS ?? 110;

const scenes = [scene("i1"), scene("s1"), scene("t1")];
const INFO = { id: "info", title: "Info", body: "One short line.", sceneIds: ["i1"] };
const SINGLE = { id: "single", title: "Single", body: "Pick one.", options: ["Keep", "Change"], sceneIds: ["s1"] };
const TEXT = { id: "text", title: "Text", body: "Say it.", answer: { type: "text", label: "What should the homepage be?" }, sceneIds: ["t1"] };
const render = decisions => renderDecisionFlow({ scenes: scenes.filter(item => decisions.some(decision => decision.sceneIds.includes(item.id))), decisions });

const TRACE = 'phase = "locked"\nmutex = TRUE';
const RULE = 'P ~> (gate.kind = "OPEN" /\\ available)';
const VISUAL = { type: "code-pair", label: "Trace beside rule", panels: [{ title: "Saved trace", caption: "Stays locked.", language: "tla", code: TRACE }, { title: "Progress rule", caption: "Excerpt.", language: "tla", code: RULE }] };

test("code-pair visual: two labelled panels with highlighted TLA+, bounded caption and length", () => {
  const { document } = boot({ decisions: [{ ...INFO, visual: VISUAL }], scenes: [scene("i1")] });
  const figure = document.querySelector(".df-card figure.df-codepair");
  const panels = [...figure.querySelectorAll(".df-code-panel")];
  expect(panels.map(panel => panel.querySelector("figcaption b").textContent)).toEqual(["Saved trace", "Progress rule"]);
  expect(panels[1].querySelector("pre.df-code").getAttribute("tabindex")).toBe("0");
  expect(panels[1].querySelector(".df-tok-op").textContent).toBe("~>");
  expect(panels[0].querySelector(".df-tok-lit").textContent).toBe("TRUE");
  expect(panels[0].querySelector("pre").textContent).toBe(TRACE);
  expect(() => render([{ ...INFO, visual: { ...VISUAL, panels: [VISUAL.panels[0]] } }])).toThrow(/two panels/);
  expect(() => render([{ ...INFO, visual: { ...VISUAL, panels: [{ ...VISUAL.panels[0], caption: "x".repeat(141) }, VISUAL.panels[1]] } }])).toThrow(/caption/);
  expect(() => render([{ ...INFO, visual: { ...VISUAL, panels: [{ ...VISUAL.panels[0], code: "a\n".repeat(17) }, VISUAL.panels[1]] } }])).toThrow(/16 lines/);
  expect(() => render([{ ...INFO, visual: { ...VISUAL, panels: [{ ...VISUAL.panels[0], language: "x<y" }, VISUAL.panels[1]] } }])).toThrow(/language/);
});

test("card-prose BUILD contract rejects an essay card and accepts one or two short lines", () => {
  const essay = { ...INFO, body: "**What it is.** ".concat("A long explanation that belongs in the narration. ".repeat(6)) };
  const result = analyzeCardProse([essay, SINGLE]);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations).toEqual([expect.objectContaining({ segment: "info", metric: "CARD_PROSE_BUDGET", threshold: CARD_PROSE_MAX_CHARS })]);
  const fenced = { ...SINGLE, body: "Run it.\n\n```bash\nbun scripts/build-dashboard.mjs --spec job.json --job-dir ./a-very-long-directory-name\n```" };
  expect(analyzeCardProse([INFO, fenced, { ...TEXT, summary: "Short." }]).verdict).toBe("PASS");
});


test("full audio preserved: a code-pair visual changes no timing or transcript", () => {
  const tp = html => html.match(/<script id="tpdata" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const words = html => [...html.matchAll(/<span class="df-word"[^>]*>[^<]*<\/span>/g)].map(m => m[0]).join("");
  const plain = render([{ ...INFO }]), polished = render([{ ...INFO, visual: VISUAL }]);
  expect(tp(polished)).toBe(tp(plain));
  expect(words(polished)).toBe(words(plain));
});
