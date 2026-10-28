import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// XM-SKILLS (2026-10-28): the cross-machine delegation text lives once, in
// agent-routing/references/cross-machine.md; dispatching skills only point to it.
const here = path.dirname(fileURLToPath(import.meta.url));
const gp = path.join(here, "..", "..", "skills", "golem-powers");
const read = (...p) => readFileSync(path.join(gp, ...p), "utf8");
const ref = read("agent-routing", "references", "cross-machine.md");

test("reference carries the proven facts", () => {
  // 1. short/read-only via delegate_task + environmentId; no worktree isolation
  expect(ref).toContain("delegate_task");
  expect(ref).toContain("target.environmentId");
  expect(ref).toContain("remoteChild.threadId");
  expect(ref).toContain("REFUSED");
  expect(ref).toContain("NEVER use this route for code writes");
  // 2. code writes via t3_thread_launch worktree, report back, owner settles
  expect(ref).toContain("t3_thread_launch(environmentId");
  expect(ref).toContain("does NOT wake the launcher");
  expect(ref).toContain("t3_thread_send(environmentId=<origin env>");
  expect(ref).toContain("settle");
  // 3. project ids differ
  expect(ref).toContain("t3_project_list(environmentId)");
  // 4. PR watch caveat
  expect(ref).toContain("Unverified; test on the first real remote PR");
  // 5. admission
  for (const s of ["≤3 heavy lanes", "≥10 GiB", "sync window", "PHX admission", "admission ledger"]) {
    expect(ref).toContain(s);
  }
});

test("reference restates no model names", () => {
  expect(ref).not.toMatch(/gpt-|claude-|sonnet|opus|codex-worker/i);
});

test("pointer skills link the reference", () => {
  for (const f of [
    ["agent-routing", "SKILL.md"],
    ["agent-routing", "references", "t3-native.md"],
    ["large-plan", "SKILL.md"],
    ["pr-loop", "SKILL.md"],
    ["qa-video", "SKILL.md"],
    ["cmux-agents", "SKILL.md"],
    ["orc", "SKILL.md"],
    ["collab-monitor", "SKILL.md"],
  ]) {
    expect(read(...f)).toContain("cross-machine.md");
  }
});
