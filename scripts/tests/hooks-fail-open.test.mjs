import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wrapper = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks", "fail-open.py");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function scratch() {
  const d = mkdtempSync(path.join(tmpdir(), "fail-open-"));
  dirs.push(d);
  return d;
}

function wrap(target, { closed = false, launcher = wrapper } = {}) {
  const r = spawnSync("python3", [launcher, ...(closed ? ["--fail-closed"] : []), ...(target ? [target] : [])], { encoding: "utf8", input: "{}" });
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

const closedBlock = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "BLOCKED: policy hook unavailable; reinstall: bash scripts/hooks/install-hooks.sh --host <host> --apply",
  },
};

for (const failure of ["missing-arg", "missing", "syntax", "dangling", "unreadable", "crash", "imports", "bad-exit"]) {
  test(`fail-closed copy gives one static value-free block: ${failure}`, () => {
    const d = scratch();
    const launcher = path.join(d, "golems-fail-open.py");
    copyFileSync(wrapper, launcher);
    const missing = path.join(d, "sensitive-missing.py");
    const syntax = path.join(d, "sensitive-syntax.py");
    writeFileSync(syntax, "def sensitive_bad(:\n");
    const dangling = path.join(d, "sensitive-hook.py");
    symlinkSync(path.join(d, "missing-hooks-live", "policy.py"), dangling);
    const unreadable = path.join(d, "sensitive-unreadable.py");
    writeFileSync(unreadable, "raise RuntimeError('sensitive-value')\n");
    chmodSync(unreadable, 0o000);
    const crash = path.join(d, "sensitive-crash.py");
    writeFileSync(crash, "import sys\nprint('sensitive-output')\nprint('sensitive-error', file=sys.stderr)\nraise RuntimeError('sensitive-value')\n");
    const imports = path.join(d, "sensitive-import.py");
    writeFileSync(imports, "import missing_sensitive_module\n");
    const badExit = path.join(d, "sensitive-exit.py");
    writeFileSync(badExit, "import sys\nprint('sensitive-output')\nsys.exit('sensitive-value')\n");
    const target = { missing, syntax, dangling, unreadable, crash, imports, "bad-exit": badExit }[failure];
    const r = wrap(target, { closed: true, launcher });
    expect(r.status, target).toBe(2);
    expect(r.stderr, target).toBe("");
    expect(r.stdout, target).toBe(`${JSON.stringify(closedBlock)}\n`);
  });
}

test("fail-closed preserves legitimate allow and deliberate deny with real sibling imports and argv", () => {
  const d = scratch();
  const real = path.join(d, "real");
  mkdirSync(real);
  writeFileSync(path.join(real, "policy.py"), "VALUE = 'policy'\n");
  const target = path.join(real, "gate.py");
  const link = path.join(d, "gate.py");
  symlinkSync(target, link);
  for (const code of [undefined, 0, 2]) {
    writeFileSync(target, `import json,sys\nfrom policy import VALUE\nsys.stdin.read()\nprint(json.dumps({'value': VALUE, 'argv': sys.argv[1:]}))\n${code === undefined ? "" : `sys.exit(${code})\n`}`);
    const r = spawnSync("python3", [wrapper, "--fail-closed", link, "argument"], { encoding: "utf8", input: "{}" });
    expect(r.status).toBe(code ?? 0);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({ value: "policy", argv: ["argument"] });
  }
});

for (const [gate, input] of [
  ["git-guardian/hooks/pre_tool_use.py", { command: "rm -rf /" }],
  ["tmp-block/hooks/tmp-block-pretooluse.py", { file_path: "/tmp/policy-fixture.txt" }],
]) {
  test(`real policy hook preserves allow/deny through copied fail-closed launcher: ${gate}`, () => {
    const d = scratch();
    const launcher = path.join(d, "golems-fail-open.py");
    copyFileSync(wrapper, launcher);
    const env = { ...process.env, HOME: d, TMPDIR: "" };
    for (const key of ["WEAVE_ALLOW_TMP", "WEAVE_ALLOW_WT_MIGRATION", "GIT_GUARDIAN_LIB", "AUTONOMOUS"]) delete env[key];
    for (const [tool, toolInput, code] of [["Bash", { command: "echo policy-fixture" }, 0],
      [input.command ? "Bash" : "Write", input, 2]]) {
      const payload = { tool_name: tool, tool_input: toolInput, cwd: repo, session_id: "synthetic-policy" };
      const r = spawnSync("python3", [launcher, "--fail-closed", path.join(repo, "skills/golem-powers", gate)],
        { env, encoding: "utf8", input: JSON.stringify(payload) });
      expect(r.status).toBe(code);
      expect(r.stderr).toBe("");
      expect(() => JSON.parse(r.stdout)).not.toThrow();
      if (code === 2) expect(r.stdout).not.toContain("policy hook unavailable");
    }
  });
}

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
