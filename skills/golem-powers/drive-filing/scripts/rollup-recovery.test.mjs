import { expect, test } from "bun:test";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture, ROLLUP, NOW, uploadPaths } from "./rollup-test-parts/common.mjs";
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
  expect(intents(repo)).toHaveLength(3); // every apply preserves earlier intents
});
test("a destination appearing during recovery is preserved along with the source", () => {
  const repo = fixture({ "2026-01-01-a.md": "a", "2026-01-02-b.md": "b" });
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
  expect(existsSync(intent.handoffFile)).toBe(false);
});
