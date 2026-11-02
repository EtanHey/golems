import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const scratch = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

for (const [line, rc, drift, status] of [
  ["drift=0", 0, "0", 0],
  ["drift=0 behind=3", 0, "0", 0],
  ["drift=2 behind=5", 0, "2", 1],
  ["drift=1", 0, "1", 1],
  ["drift=? behind=3", 0, "unknown", 1],
  ["drift=0 behind=?", 0, "0", 0],
  ["drift=0 behind=oops", 0, "unknown", 1],
  ["drift=0 behind=3 trailing", 0, "unknown", 1],
  ["drift=0 behind=3", 1, "0", 1],
]) {
  test(`live status ${line}, installer exit ${rc}`, () => {
    const path = mkdtempSync(resolve(".build.noindex/live-status-"));
    scratch.push(path);
    const bin = join(path, "bin");
    const hooks = join(path, "Gits/golems/scripts/hooks");
    mkdirSync(bin);
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(bin, "git"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(hooks, "install-hooks.sh"),
      `#!/usr/bin/env bash\nprintf '%s\\n' 'hooks-live=abc master=def ${line}'\nexit ${rc}\n`, { mode: 0o755 });
    const result = spawnSync("bash", [resolve("scripts/ratchet/live/status.sh")], {
      encoding: "utf8", env: { ...process.env, HOME: path, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.ok(result.stdout.includes(`status exit=${rc} drift=${drift}\n`));
    assert.equal(result.status, status);
  });
}
