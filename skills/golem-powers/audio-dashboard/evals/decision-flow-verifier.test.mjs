import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { renderDecisionFlow } from "../src/decision-flow.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function scene(id) {
  return {
    id, title: id, script: "one two", duration: 1, audioUrl: "data:audio/mpeg;base64,SUQz",
    words: [{ word: "one", start: 0, end: 0.3 }, { word: "two", start: 0.4, end: 0.7 }],
  };
}

function render() {
  return renderDecisionFlow({
    storageKey: "dbx:verifier-test",
    scenes: [scene("a1"), scene("b1")],
    decisions: [
      { id: "a", title: "A", options: ["Yes"], sceneIds: ["a1"], checklist: [{ title: "Fixed", items: ["one", "two"] }, "three"] },
      { id: "b", title: "B", options: ["No"], sceneIds: ["b1"] },
    ],
  });
}

function verify(html) {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-decision-flow-"));
  const file = path.join(dir, "dashboard.html");
  writeFileSync(file, html);
  const run = spawnSync("bun", ["vendor/qa/verify-decision-flow.mjs", file], { cwd: skillRoot, encoding: "utf8" });
  return { status: run.status, report: JSON.parse(run.stdout) };
}

test("verifier passes the controller, speed, story toggle and checklist markup", () => {
  const { status, report } = verify(render());
  expect(status).toBe(0);
  expect(report.pass).toBe(true);
  expect(report.controllerChips).toBe(2);
  expect(report.chipsMatchCards).toBe(true);
  expect(report.speedSelector).toBe(true);
  expect(report.viewToggle).toBe(true);
  expect(report.cardTransport).toBe(true);
  expect(report.checklistItems).toBe(3);
  expect(report.checklistsOwnedByCards).toBe(true);
  expect(report.checklistPersistence).toBe(true);
});

test("verifier fails when the controller chips are missing", () => {
  const html = render().replace(/<div class="df-chips">[\s\S]*?<\/div>/, '<div class="df-chips"></div>');
  const { status, report } = verify(html);
  expect(status).toBe(1);
  expect(report.chipsMatchCards).toBe(false);
});

test("verifier fails when a chip points at no card", () => {
  const html = render().replace('data-chip-for="b"', 'data-chip-for="ghost"');
  const { report } = verify(html);
  expect(report.pass).toBe(false);
  expect(report.chipsMatchCards).toBe(false);
});

test("verifier fails when a checklist claims a different card or loses persistence", () => {
  expect(verify(render().replace('data-checklist-for="a"', 'data-checklist-for="b"')).report.checklistsOwnedByCards).toBe(false);
  const noPersist = verify(render().replaceAll('"-checks"', '"-gone"'));
  expect(noPersist.report.checklistPersistence).toBe(false);
  expect(noPersist.report.pass).toBe(false);
});

test("verifier fails when the speed selector is missing", () => {
  const { report } = verify(render().replace('id="df-speed"', 'id="df-other"'));
  expect(report.speedSelector).toBe(false);
  expect(report.pass).toBe(false);
});
