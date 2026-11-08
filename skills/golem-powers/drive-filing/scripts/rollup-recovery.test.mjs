import { expect, test } from "bun:test";
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture, ROLLUP, NOW, uploadPaths, listFiles, rollup } from "./rollup-test-parts/common.mjs";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const intents = (repo) => {
  const dir = join(repo, "docs.local/_drive-filing");
  return existsSync(dir) ? readdirSync(dir).filter((n) => /^rollup-plan-.*\.json$/.test(n)).map((n) => join(dir, n)) : [];
};
const apply = (repo, ...nodeArgs) => spawnSync("node", [
  ...nodeArgs, ROLLUP, "--repo", repo, "--keep-months", "2", "--now", NOW, "--apply", "--json",
], { encoding: "utf8" });
// Exit the real CLI after rename, before its journal write.
function interrupt(repo, after) {
  writeFileSync(join(repo, "interrupt.mjs"), `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.renameSync;
    let moves = 0;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (String(from).includes('/docs.local/') && !String(from).includes('/_drive-filing/') && ++moves === ${after}) process.exit(86);
    };
    syncBuiltinESMExports();
  `);
  return apply(repo, "--import", join(repo, "interrupt.mjs"));
}
test.each([1, 2])("recovers a real interruption after %i moves without duplicating the handoff", (after) => {
  const repo = fixture({ "2026-01-01-a/a.md": "a", "2026-01-02-b.md": "bb", "2026-01/existing.md": "ccc" });
  expect(interrupt(repo, after).status).toBe(86);
  const saved = intents(repo);
  expect(saved).toHaveLength(1);
  const original = readFileSync(saved[0], "utf8");
  const intent = JSON.parse(original);
  const progress = read(intent.progressFile);
  expect(progress.complete).toBe(false);
  expect(existsSync(intent.handoffFile)).toBe(false);
  for (const [i, move] of intent.moves.entries()) {
    const location = i < after ? move.to : move.from;
    expect(readFileSync(join(repo, location + (i === 0 ? "/a.md" : "")), "utf8")).toBe(i === 0 ? "a" : "bb");
    expect(progress.moves[i].locations).toContain(location);
  }
  const resumed = apply(repo);
  expect(resumed.status).toBe(0);
  const handoff = JSON.parse(resumed.stdout);
  expect(read(handoff.planFile)).toEqual(handoff);
  expect(uploadPaths(handoff).sort()).toEqual([
    "docs.local/2026-01/2026-01-01-a/a.md",
    "docs.local/2026-01/2026-01-02-b.md",
    "docs.local/2026-01/existing.md",
  ]);
  expect(read(intent.progressFile)).toMatchObject({
    complete: true,
    moves: intent.moves.map((m) => ({ locations: [m.to], state: "moved" })),
  });
  expect(JSON.parse(apply(repo).stdout).upload).toEqual(handoff.upload);
  expect(readFileSync(saved[0], "utf8")).toBe(original);
  expect(intents(repo)).toHaveLength(after === 1 ? 2 : 1); // no new intent without new moves
});
test("a newly held pending source closes as not moved and allows a correct handoff", () => {
  const repo = fixture({ "2026-01-01-a.md": "a", "2026-01-02-b.md": "b", "2026-02-01-c.md": "c" });
  expect(interrupt(repo, 1).status).toBe(86);
  const intent = read(intents(repo)[0]);
  const credential = join(repo, "docs.local/2026-01-03-x.env.local");
  writeFileSync(credential, "PRIVATE=fixture");
  const resumed = apply(repo);
  expect(resumed.status).toBe(0);
  const handoff = JSON.parse(resumed.stdout);
  expect(uploadPaths(handoff)).toEqual(["docs.local/2026-02/2026-02-01-c.md"]);
  expect(readFileSync(credential, "utf8")).toBe("PRIVATE=fixture");
  expect(readFileSync(join(repo, "docs.local/2026-01-02-b.md"), "utf8")).toBe("b");
  expect(read(intent.progressFile)).toMatchObject({ complete: true, moves: [
    { state: "moved" },
    { state: "not-moved", locations: ["docs.local/2026-01-02-b.md"], reason: expect.stringContaining("no longer eligible") },
    { state: "moved" },
  ] });
  const before = listFiles(repo);
  expect(JSON.parse(apply(repo).stdout).upload).toEqual(handoff.upload);
  expect(listFiles(repo)).toEqual(before);
});
test("a handoff after two interruptions names every reconciled intent", () => {
  const repo = fixture({ "2026-01-01-a.md": "a", "2026-01-02-b.md": "b" });
  expect(interrupt(repo, 1).status).toBe(86);
  expect(interrupt(repo, 1).status).toBe(86);
  const saved = intents(repo).sort();
  expect(saved).toHaveLength(2);
  const resumed = apply(repo);
  expect(resumed.status).toBe(0);
  const handoff = JSON.parse(resumed.stdout);
  expect(handoff.reconciledIntents.map((p) => p.planFile).sort()).toEqual(saved);
  expect(uploadPaths(handoff)).toHaveLength(2);
  for (const path of saved) expect(read(read(path).progressFile).complete).toBe(true);
});
test("five no-op applies write nothing, including with an existing upload month", () => {
  const repo = fixture({ "2026-01/already-rolled.md": "a" });
  const before = listFiles(repo);
  for (let i = 0; i < 5; i++) expect(apply(repo).status).toBe(0);
  expect(listFiles(repo)).toEqual(before);
});
test.each([false, true])("completed intents are not parsed on later applies (legacy=%s)", (legacy) => {
  const repo = fixture({ "2026-01-01-a.md": "a" });
  expect(apply(repo).status).toBe(0);
  if (legacy) unlinkSync(intents(repo)[0].replace("rollup-plan-", "rollup-complete-"));
  writeFileSync(intents(repo)[0], "truncated completed intent");
  const before = listFiles(repo);
  expect(apply(repo).status).toBe(0);
  expect(listFiles(repo)).toEqual(before);
});
test("malformed open intent errors name the path before moving any file", () => {
  const repo = fixture({ "2026-01-01-a.md": "a", "2026-01-02-b.md": "b" });
  expect(interrupt(repo, 1).status).toBe(86);
  const path = intents(repo)[0];
  writeFileSync(path, '{"phase":');
  const result = apply(repo);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(path);
  expect(existsSync(join(repo, "docs.local/2026-01-02-b.md"))).toBe(true);
});
test("human output names its saved handoff before the final summary", () => {
  const result = rollup(fixture({ "2026-01-01-a.md": "a" }), "--apply");
  expect(result.status).toBe(0);
  expect(result.lines.at(-2)).toMatch(/^handoff: .*rollup-handoff-.*\.json$/);
  expect(result.lines.at(-1)).toMatch(/^drive-filing rollup:/);
});
test("an interruption after handoff creation still reconciles progress on rerun", () => {
  const repo = fixture({ "2026-01-01-a.md": "a" });
  const preload = join(repo, "handoff-interrupt.mjs");
  writeFileSync(preload, `
    import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const write = fs.writeFileSync;
    fs.writeFileSync = (path, ...args) => {
      write(path, ...args);
      if (String(path).includes('/rollup-handoff-')) process.exit(86);
    };
    syncBuiltinESMExports();
  `);
  expect(apply(repo, "--import", preload).status).toBe(86);
  const intent = read(intents(repo)[0]);
  expect(read(intent.progressFile).complete).toBe(false);
  expect(apply(repo).status).toBe(0);
  expect(read(intent.progressFile).complete).toBe(true);
  const before = listFiles(repo);
  expect(apply(repo).status).toBe(0);
  expect(listFiles(repo)).toEqual(before);
});
test("a destination appearing during recovery is preserved along with the source", () => {
  const repo = fixture({ "2026-01-01-a.md": "a", "2026-01-02-b.md": "b", "2026-02-01-c.md": "c" });
  expect(interrupt(repo, 1).status).toBe(86);
  const intent = read(intents(repo)[0]);
  const pending = intent.moves[1];
  writeFileSync(join(repo, pending.to), "other content");
  const resumed = apply(repo);
  expect(resumed.status).not.toBe(0);
  expect(resumed.stderr).toContain("recovery conflict");
  expect(readFileSync(join(repo, pending.from), "utf8")).toBe("b");
  expect(readFileSync(join(repo, pending.to), "utf8")).toBe("other content");
  expect(read(intent.progressFile).moves[1].locations).toEqual([pending.from, pending.to]);
  expect(readFileSync(join(repo, "docs.local/2026-02-01-c.md"), "utf8")).toBe("c");
  expect(existsSync(intent.handoffFile)).toBe(false);
});
