import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wrapper = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks", "fail-open.py");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function scratch() {
  const d = mkdtempSync(path.join(tmpdir(), "fail-open-"));
  dirs.push(d);
  return d;
}

function wrap(target) {
  const r = spawnSync("python3", [wrapper, target], { encoding: "utf8", input: "{}" });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}

test("missing target and import error exit 0 with exactly one stderr line", () => {
  const d = scratch();
  let r = wrap(path.join(d, "gone.py"));
  expect(r.status).toBe(0);
  expect(r.stderr.trim().split("\n").length).toBe(1);
  expect(r.stderr).toContain("gone.py");

  const broken = path.join(d, "broken.py");
  writeFileSync(broken, "import no_such_module_go5\n");
  r = wrap(broken);
  expect(r.status).toBe(0);
  expect(r.stderr.trim().split("\n").length).toBe(1);
  expect(r.stderr).toContain("ModuleNotFoundError");
});

test("a deliberate block (exit 2 + stdout) passes through; sibling imports resolve through a FILE symlink", () => {
  const d = scratch();
  const real = path.join(d, "real");
  mkdirSync(real);
  writeFileSync(path.join(real, "policy.py"), "REASON = 'deny'\n");
  writeFileSync(path.join(real, "gate.py"),
    "import sys\nfrom policy import REASON\nsys.stdin.read()\nprint(REASON)\nsys.exit(2)\n");
  symlinkSync(path.join(real, "gate.py"), path.join(d, "gate.py"));
  const r = wrap(path.join(d, "gate.py"));
  expect(r.status).toBe(2);
  expect(r.stdout.trim()).toBe("deny");
});

test("a runtime error and a syntax error in the hook also fail open with one stderr line", () => {
  // r7 on #215: an `except ImportError`-only wrapper survived the import-error test.
  const d = scratch();
  for (const [name, body, errorName] of [
    ["crash.py", "import sys\nsys.stdin.read()\nraise RuntimeError('boom')\n", "RuntimeError"],
    ["typo.py", "def broken(:\n    pass\n", "SyntaxError"],
  ]) {
    const target = path.join(d, name);
    writeFileSync(target, body);
    const r = wrap(target);
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n").length).toBe(1);
    expect(r.stderr).toContain(errorName);
  }
});
