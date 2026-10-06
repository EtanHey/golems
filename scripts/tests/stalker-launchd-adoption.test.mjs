import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "../..");
for (const label of ["com.golems.stream-watcher", "com.golems.stalker-live-guard"]) {
  test(`${label} rendering preserves adopted config except Bun PATH`, () => {
    const dir = mkdtempSync(join(tmpdir(), "stalker-plist-"));
    try {
      const out = join(dir, "rendered.plist");
      const render = Bun.spawnSync(["bash", join(root, "launchd/render-plist.sh"), join(root, "launchd", `${label}.plist`), out], {
        env: { ...process.env, HOME: "/fixture/home", GOLEMS_ROOT: "/fixture/golems" },
      });
      expect(render.exitCode).toBe(0);
      // Synthetic normalized live snapshot; plistlib compares every key/value.
      const compare = Bun.spawnSync(["python3", "-c", `
import plistlib,sys
with open(sys.argv[1]) as f: fixture=f.read()
expected=plistlib.loads(fixture.replace('@HOME@','/fixture/home').replace('@GOLEMS_ROOT@','/fixture/golems').encode())
with open(sys.argv[2], 'rb') as f: actual=plistlib.load(f)
expected['EnvironmentVariables']['PATH']='/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.13/bin:/usr/local/bin:/usr/bin:/bin'
assert actual == expected, (actual, expected)
assert '.bun/bin' not in str(actual)
`, join(import.meta.dir, "fixtures/stalker-launchd", `${label}.plist`), out]);
      expect(compare.exitCode, compare.stderr.toString()).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
