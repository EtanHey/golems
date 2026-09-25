// Deterministic replay gate for model-pin-gate.
// Pinned RED/GREEN fixtures cover the fleet model policy: Fable seats may spawn
// workers only with explicit cheaper/top-worker model pins; model inheritance is
// forbidden and Fable may not be pinned below apex seats.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { detectModelPin, weeklyResetPassed } from "../src/model-pin-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const redDir = path.join(here, "fixtures", "red");
const greenDir = path.join(here, "fixtures", "green");

function loadFixtures(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

const reds = loadFixtures(redDir);
const greens = loadFixtures(greenDir);

test("fixture coverage: required green and red specimens are present", () => {
  expect(greens.map((fx) => fx.specimen)).toContain("deliberate-sonnet-pick-from-fable-seat");
  expect(greens.map((fx) => fx.specimen)).toContain("deliberate-opus-pick");
  expect(greens.map((fx) => fx.specimen)).toContain("apex-seat-may-spawn-a-fable-pane-seat");
  expect(greens.map((fx) => fx.specimen)).toContain("orcclaude-seat-is-apex-and-may-spawn-a-fable-pane-seat");
  expect(reds.map((fx) => fx.specimen)).toContain("apex-fable-subagent-after-weekly-reset");
  expect(reds.map((fx) => fx.specimen)).toContain("fable-in-workflow-during-amnesty");
  expect(reds.map((fx) => fx.specimen)).toContain("fable-in-workflow-after-weekly-reset");
  expect(greens.map((fx) => fx.specimen)).toContain("non-spawn-tool");
  expect(greens.map((fx) => fx.specimen)).toContain("malformed-payload-fails-open");
  expect(greens.map((fx) => fx.specimen)).toContain("undetectable-seat-fails-open");
  expect(greens.map((fx) => fx.specimen)).toContain("latency-realistic-spawn");
  expect(reds.map((fx) => fx.specimen)).toContain("unpinned-spawn-from-fable-seat");
  expect(reds.map((fx) => fx.specimen)).toContain("explicit-fable-pin-from-non-apex-seat");
  expect(reds.map((fx) => fx.specimen)).toContain("cmux-spawn-carries-fable-target-from-non-apex-seat");
  expect(reds.map((fx) => fx.specimen)).toContain("workflow-unrelated-model-property-masks-unpinned-agent");
  expect(greens.map((fx) => fx.specimen)).toContain("workflow-every-agent-call-pins-its-own-model");
  expect(greens.map((fx) => fx.specimen)).toContain("workflow-computed-model-key-is-a-pin");
  expect(greens.map((fx) => fx.specimen)).toContain("workflow-escaped-quoted-model-key-is-a-pin");
  expect(reds.map((fx) => fx.specimen)).toContain("workflow-comment-between-agent-and-its-paren-is-still-a-call");
  expect(reds.map((fx) => fx.specimen)).toContain("workflow-model-key-in-a-nested-call-does-not-pin-the-outer-agent");
  expect(reds.map((fx) => fx.specimen)).toContain("workflow-regex-literal-with-escaped-slash-does-not-swallow-the-call");
  expect(greens.map((fx) => fx.specimen)).toContain("workflow-line-comment-in-regex-position-is-not-an-empty-regex");
  expect(greens.map((fx) => fx.specimen)).toContain("workflow-line-continuation-in-a-quoted-model-key-is-a-pin");
  expect(greens.map((fx) => fx.specimen)).toContain("workflow-computed-model-key-with-comments-and-long-whitespace-is-a-pin");
});

test("a Fable-seat Agent call without model is blocked", () => {
  const result = detectModelPin({
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Agent",
    tool_input: { prompt: "survey the repo" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_AGENT_UNPINNED");
});

test("a non-Fable seat may call Agent without a model pin", () => {
  const result = detectModelPin({
    transcript: [{ type: "assistant", message: { model: "claude-opus-4-8" } }],
    tool_name: "Agent",
    tool_input: { prompt: "survey the repo" },
  });
  expect(result.verdict).toBe("PASS");
});

test("a Workflow with unpinned agent() calls is advisory before the weekly reset", () => {
  const result = detectModelPin({
    now: "2026-09-05T20:00:00Z",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Workflow",
    tool_input: { script: "agent({prompt:'a'}); agent({prompt:'b'}); agent({prompt:'c'});" },
  });
  expect(result.verdict).toBe("ADVISORY");
  expect(result.advisories.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_MODEL_ADVISORY");
  expect(result.violations.length).toBe(0);
});

test("a Workflow with unpinned agent() calls blocks after the weekly reset (8A)", () => {
  const result = detectModelPin({
    now: "2026-09-06T03:00:00Z",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Workflow",
    tool_input: { script: "agent({prompt:'a'}); agent({prompt:'b'}); agent({prompt:'c'});" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
});

test("an unrelated model: property does not pin an agent() call (W9)", () => {
  const result = detectModelPin({
    now: "2026-09-06T03:00:00Z",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Workflow",
    tool_input: { script: "const defaults = { model: 'opus' };\nagent({ prompt: 'work' });" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
});

test("a model: pin binds to the innermost enclosing agent() call (W9)", () => {
  // The inner agent() carries the pin; the outer one does not and must still be caught.
  const result = detectModelPin({
    now: "2026-09-06T03:00:00Z",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Workflow",
    tool_input: { script: "agent(`outer ${x}`, { after: () => agent('inner', { model: 'opus' }) });" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
});

test("model: inside a comment or a string does not pin an agent() call (W9)", () => {
  const result = detectModelPin({
    now: "2026-09-06T03:00:00Z",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Workflow",
    tool_input: { script: "agent({ prompt: 'remember to set model: opus' }); // model: 'opus'" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
});

test("a quoted \"model\" key inside the call's own options pins it (W9)", () => {
  const result = detectModelPin({
    now: "2026-09-06T03:00:00Z",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Workflow",
    tool_input: { script: "agent('work', { \"model\": 'sonnet' });" },
  });
  expect(result.verdict).toBe("PASS");
});

function workflowVerdict(script) {
  return detectModelPin({
    now: "2026-09-06T03:00:00Z",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Workflow",
    tool_input: { script },
  });
}

test("a model key in the call's own args pins it in any value form (W9 lead round 1)", () => {
  // Lead ruling on #52: this rule BLOCKS from 02:05Z (~05:05 IDT), so a variable- or shorthand-pinned
  // script must not be false-blocked. The pin is the KEY inside the call's own args;
  // the gate does not judge the value form.
  expect(workflowVerdict("agent('a', { model: 'opus' });").verdict).toBe("PASS");
  expect(workflowVerdict("agent('a', { model: someVar });").verdict).toBe("PASS");
  expect(workflowVerdict("const model = 'opus'; agent('a', { ...defaults, model });").verdict).toBe("PASS");
  expect(workflowVerdict("agent('a', { model });").verdict).toBe("PASS");
});

test("a spread alone is not a pin (W9 lead round 1)", () => {
  // `...defaults` may or may not carry a model; the gate cannot see it, so it stays unpinned.
  const result = workflowVerdict("const defaults = { model: 'opus' }; agent('a', { ...defaults });");
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
});

test("model used as a VALUE is not a pin (W9 lead round 1)", () => {
  // `{ label: model }` is the variable in value position, not a model key.
  const result = workflowVerdict("agent('a', { label: model });");
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
});

test("a model key OUTSIDE the call still does not pin it (W9)", () => {
  const result = workflowVerdict("const defaults = { model: 'opus' };\nagent({ prompt: 'work' });");
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
});

test("a computed model key pins the call (W9b, Macroscope 1)", () => {
  expect(workflowVerdict("agent('w', { ['model']: 'opus' });").verdict).toBe("PASS");
  expect(workflowVerdict('agent("w", { ["model"]: "opus" });').verdict).toBe("PASS");
  // A computed key that is not `model`, and a computed key outside the call, still do not pin.
  expect(workflowVerdict("agent('w', { ['label']: 'opus' });").verdict).toBe("FLAG");
  expect(workflowVerdict("const d = { ['model']: 'opus' }; agent('w', {});").verdict).toBe("FLAG");
});

test("an escaped quoted model key pins the call (W9b, Macroscope 2)", () => {
  // `"\model"` and `"\u006dodel"` both decode to the key `model` in real JS.
  expect(workflowVerdict("agent('w', { \"\\model\": 'opus' });").verdict).toBe("PASS");
  expect(workflowVerdict("agent('w', { '\\u006dodel': 'opus' });").verdict).toBe("PASS");
  expect(workflowVerdict("agent('w', { '\\x6dodel': 'opus' });").verdict).toBe("PASS");
  expect(workflowVerdict("agent('w', { '\\models': 'opus' });").verdict).toBe("FLAG");
});

test("a comment between agent and its paren is still a call (W9b, Macroscope 3)", () => {
  const block = workflowVerdict("agent/* pin omitted */({ prompt: 'w' });");
  expect(block.verdict).toBe("FLAG");
  expect(block.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
  expect(workflowVerdict("agent // pin omitted\n({ prompt: 'w' });").verdict).toBe("FLAG");
  // Still a call, and still pinnable through the comment.
  expect(workflowVerdict("agent/* pinned */({ prompt: 'w', model: 'opus' });").verdict).toBe("PASS");
});

test("a model key inside a nested call does not pin the outer agent (W9b, Macroscope 4)", () => {
  // The pin must sit in the agent call's OWN top-level options object.
  const nestedCall = workflowVerdict("agent({ prompt: buildPrompt({ model: 'opus' }) });");
  expect(nestedCall.verdict).toBe("FLAG");
  expect(nestedCall.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
  // A nested object literal (a schema property named `model`) is not a pin either.
  expect(workflowVerdict("agent('w', { schema: { model: { type: 'string' } } });").verdict).toBe("FLAG");
  // The top-level options object still pins, alongside a nested call.
  expect(workflowVerdict("agent(buildPrompt({ x: 1 }), { model: 'opus' });").verdict).toBe("PASS");
});

test("a regex literal does not swallow the rest of the source (W9b, Macroscope 5)", () => {
  // `/\//` ends with two slashes; read as a line comment it swallowed the agent() call after it.
  const swallowed = workflowVerdict("const slash = /\\//; agent({ prompt: 'w' });");
  expect(swallowed.verdict).toBe("FLAG");
  expect(swallowed.violations.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_UNPINNED");
  expect(workflowVerdict("const re = /[/]/; agent({ prompt: 'w' });").verdict).toBe("FLAG");
  // Division must not be mistaken for a regex literal.
  expect(workflowVerdict("const r = total / count; agent('a', { model: 'opus' });").verdict).toBe("PASS");
  expect(workflowVerdict("const r = (a) / 2 / 3; agent('a', { model: 'opus' });").verdict).toBe("PASS");
});

test("comments are skipped before the regex probe (W9b r1, Macroscope 234)", () => {
  // A `//` in a regex-eligible position was read as an empty regex literal, so the COMMENT BODY was
  // parsed as code — `agent(...)` inside a comment became a real unpinned call and blocked a properly
  // pinned script. A false BLOCK on a blocking rule.
  expect(workflowVerdict("agent('a', { model: 'opus' });\n// agent({ prompt: 'x' })\n").verdict).toBe("PASS");
  expect(workflowVerdict("const xs = [1,\n// agent({ prompt: 'x' })\n2]; agent('a', { model: 'opus' });").verdict).toBe("PASS");
  expect(workflowVerdict("const a = 1; /* agent({ prompt: 'x' }) */ agent('a', { model: 'opus' });").verdict).toBe("PASS");
  // The regex fix from the first round must survive the reorder.
  expect(workflowVerdict("const slash = /\\//; agent({ prompt: 'w' });").verdict).toBe("FLAG");
});

test("a line-continuation escape in a quoted key still reads as `model` (W9b r1, Macroscope 174)", () => {
  // `"mo\<newline>del"` is the key `model` in real JS; treating the escape as a literal newline left
  // a pinned call unpinned and blocked it. CRLF too.
  expect(workflowVerdict('agent({ "mo\\\ndel": "opus" });').verdict).toBe("PASS");
  expect(workflowVerdict('agent({ "mo\\\r\ndel": "opus" });').verdict).toBe("PASS");
  // A real \n escape is still a newline, so this key is NOT `model`.
  expect(workflowVerdict('agent({ "mo\\ndel": "opus" });').verdict).toBe("FLAG");
});

test("a computed key is parsed with trivia-skipping, not a fixed slice (W9b r1, Macroscope 262)", () => {
  const long = "a very long comment a very long comment a very long comment a very long comment a very long comment a very long comment ";
  expect(workflowVerdict(`agent('w', { [ /* ${long} */ 'model' ]: 'opus' });`).verdict).toBe("PASS");
  expect(workflowVerdict(`agent('w', { [${" ".repeat(70)}'model' ]: 'opus' });`).verdict).toBe("PASS");
  expect(workflowVerdict("agent('w', { ['model'] /* c */ : 'sonnet' });").verdict).toBe("PASS");
  // Still not a pin: a different computed key, and a bracket that is not a key at all.
  expect(workflowVerdict("agent('w', { [ /* c */ 'label' ]: 'opus' });").verdict).toBe("FLAG");
  expect(workflowVerdict("agent('w', { x: ['model'] });").verdict).toBe("FLAG");
});

test("weeklyResetPassed keys on payload.now and falls back to the clock", () => {
  expect(weeklyResetPassed({ now: "2026-09-05T23:59:59Z" })).toBe(false);
  expect(weeklyResetPassed({ now: "2026-09-06T02:05:00Z" })).toBe(true);
  expect(weeklyResetPassed({ now: "not-a-date" })).toBe(false);
  expect(typeof weeklyResetPassed({})).toBe("boolean");
});

test("a Fable model pin on a Task-style subagent spawn from a Fable seat blocks after the reset", () => {
  // No seat_id + Fable transcript = apex by inference; the 07-18 law still blocks Fable as a SUBAGENT.
  const result = detectModelPin({
    now: "2026-09-06T03:00:00Z",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Task",
    tool_input: { model: "claude-fable-5", prompt: "code survey" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_FABLE_SUBAGENT");
});

test("a Fable model pin on a Task-style subagent spawn from a non-apex seat blocks regardless of the reset", () => {
  const result = detectModelPin({
    now: "2026-09-05T20:00:00Z",
    seat_id: "skillcreatorWorker",
    transcript: [{ type: "assistant", message: { model: "claude-opus-4-8" } }],
    tool_name: "Task",
    tool_input: { model: "claude-fable-5", prompt: "non-apex code survey" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_FABLE_BELOW_APEX");
});

test("an apex seat pinning a Fable Agent spawn is advisory during the amnesty, blocked after", () => {
  const base = {
    seat_id: "skillcreatorLead",
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Agent",
    tool_input: { model: "claude-fable-5", prompt: "approved apex eval" },
  };
  const during = detectModelPin({ ...base, now: "2026-09-05T20:00:00Z" });
  expect(during.verdict).toBe("ADVISORY");
  expect(during.advisories.map((v) => v.code)).toContain("MODELPIN_FABLE_SUBAGENT");
  expect(during.advisories[0].evidence).toContain("2026-09-06T02:05:00Z");
  const after = detectModelPin({ ...base, now: "2026-09-06T03:00:00Z" });
  expect(after.verdict).toBe("FLAG");
  expect(after.violations.map((v) => v.code)).toContain("MODELPIN_FABLE_SUBAGENT");
});

test("a cmux new_split Fable launcher from a non-apex seat is blocked", () => {
  const result = detectModelPin({
    seat_id: "skillcreatorWorker",
    transcript: [{ type: "assistant", message: { model: "claude-opus-4-8" } }],
    tool_name: "mcp__cmuxlayer__new_split",
    tool_input: {
      command: "skillCreatorClaude -m claude-fable-5 -s",
    },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_CMUX_FABLE_TARGET");
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) -> ${fx.expect}`, () => {
    const result = detectModelPin(fx.payload);
    if (fx.expect === "FLAG") {
      expect(result.verdict).toBe("FLAG");
      expect(result.violations.map((v) => v.code)).toContain(fx.violation);
      expect(result.violations.map((v) => v.action).join(" ")).not.toMatch(/\b(never|don't|do not)\b/i);
    } else if (fx.expect === "ADVISORY") {
      expect(result.verdict).toBe("ADVISORY");
      expect(result.advisories.map((v) => v.code)).toContain(fx.violation);
      expect(result.violations.length).toBe(0);
    } else {
      throw new Error(`unexpected RED expectation ${fx.expect}`);
    }
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) -> PASS`, () => {
    const started = performance.now();
    const result = detectModelPin(fx.payload);
    const elapsedMs = performance.now() - started;
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
    if (fx.assert_latency_under_ms) {
      expect(elapsedMs).toBeLessThan(fx.assert_latency_under_ms);
    }
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectModelPin(fx.payload))).toBe(JSON.stringify(detectModelPin(fx.payload)));
  }
});
