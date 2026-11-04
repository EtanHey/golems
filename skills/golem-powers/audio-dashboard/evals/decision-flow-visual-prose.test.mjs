import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

test("literal summary fences count; rendered body copy blocks alone are exempt", () => {
  const literal = { ...INFO, summary: '```text\n' + 'Essay '.repeat(900) + '\n```', body: '' };
  expect(analyzeCardProse([literal]).verdict).toBe('REJECTED');
  expect(analyzeCardProse([{ ...INFO, summary: '', body: '```text\n' + 'payload '.repeat(900) + '\n```' }]).verdict).toBe('PASS');
});

test("four rendered paragraphs cannot pass the two-line contract", () => {
  const paragraphs = { ...INFO, body: 'One short line.\n\nTwo short lines.\n\nThree short lines.\n\nFour short lines.' };
  expect(analyzeCardProse([paragraphs]).verdict).toBe('REJECTED');
});

test("real rendered prose at 390 and 1280: max length, paragraphs and long tokens", async () => {
  const cases = [
    { ...INFO, body: 'i '.repeat(54) + 'ii', want: 'PASS' },
    { ...INFO, summary: 'i'.repeat(55), body: 'i'.repeat(55), want: 'PASS' },
    { ...INFO, body: 'W'.repeat(110), want: 'REJECTED' },
    { ...INFO, body: 'word '.repeat(22).trim(), want: 'REJECTED' },
    { ...INFO, body: 'One short line.\n\nTwo short lines.\n\nThree short lines.\n\nFour short lines.', want: 'REJECTED' },
  ];
  for (const decision of cases) {
    const result = await decisionFlow.analyzeCardProseLayout(render([decision]));
    expect(result.verdict).toBe(decision.want);
    expect(result.stats.map(row => row.width)).toEqual([390, 1280]);
    if (result.verdict === 'PASS') expect(result.stats.every(row => row.lines <= 2 && row.blocks.every(b => b.readable && !b.overflow))).toBe(true);
    else expect(result.violations.some(v => v.metric === 'CARD_PROSE_LAYOUT')).toBe(true);
  }
}, 15000);


test("real BUILD withholds stale HTML and writes typed prose rejects", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prose-build-'));
  const out = path.join(dir, 'index.html'), specPath = path.join(dir, 'job.json');
  // This fixture's committed MP3 is exactly 1s. Keep the real BUILD independent of host ffprobe
  // installation, as the existing BUILD fixtures do; no prose/audio gate is mocked or bypassed.
  const bin = path.join(dir, 'bin'); mkdirSync(bin);
  writeFileSync(path.join(bin, 'ffprobe'), "#!/bin/sh\nprintf '1.000000\\n'\n", { mode: 0o755 });
  const segment = path.join(dir, 'segments/i1'); mkdirSync(segment, { recursive: true });
  copyFileSync(new URL('./fixtures/design-preservation/hardening-tone.wav', import.meta.url), path.join(segment, 'i1.wav'));
  copyFileSync(new URL('../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3', import.meta.url), path.join(segment, 'i1.mp3'));
  for (const name of ['words.json', 'words.raw.json']) writeFileSync(path.join(segment, name), JSON.stringify(scene('i1').words));
  for (const [body, summary, metric] of [
    ['', '```text\n' + 'Essay '.repeat(900) + '\n```', 'CARD_PROSE_BUDGET'],
    ['One.\n\nTwo.\n\nThree.\n\nFour.', '', 'CARD_PROSE_BLOCKS'],
    ['W'.repeat(110), '', 'CARD_PROSE_LAYOUT'],
  ]) {
    writeFileSync(out, 'STALE');
    writeFileSync(path.join(dir, 'index.receipts.json'), '{"stale":"PASS"}');
    writeFileSync(specPath, JSON.stringify({ type: 'decision-flow', id: 'prose-build', series: 'prose-build', outputPath: out,
      scenes: [{ id: 'i1', script: 'one two', audioWav: path.join(dir, 'segments/i1/i1.wav') }], decisions: [{ ...INFO, body, summary }] }));
    const run = spawnSync(process.execPath, [path.resolve(import.meta.dir, '../scripts/build-dashboard.mjs'), '--spec', specPath, '--job-dir', dir],
      { encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + (process.env.PATH || '') } });
    const diagnostic = JSON.stringify({ metric, status: run.status, signal: run.signal, error: run.error?.message, stdout: run.stdout, stderr: run.stderr });
    expect(run.error, diagnostic).toBeUndefined();
    expect(run.signal, diagnostic).toBeNull();
    expect(run.status, diagnostic).toBe(1);
    expect(existsSync(out), diagnostic).toBe(false);
    const receiptsPath = path.join(dir, 'index.receipts.json');
    expect(existsSync(receiptsPath), diagnostic).toBe(true);
    const row = JSON.parse(readFileSync(receiptsPath, 'utf8')).gates.find(g => g.gate === 'card-prose');
    expect(row, diagnostic).toBeDefined();
    expect(row.verdict).toBe('REJECT');
    expect(row.violations.some(v => v.metric === metric)).toBe(true);
    expect(row.runbook).toContain('scene scripts');
  }
}, 15000);
