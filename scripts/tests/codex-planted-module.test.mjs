// The Codex transport must run each policy with the same import hardening as
// the Claude launcher: a gitignored bytecode module planted beside the adapter
// or a policy, named after a stdlib module, never runs and a deny stays a deny.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexCommand } from "../hooks/codex-hooks-install.mjs";

setDefaultTimeout(60_000);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = mkdtempSync(path.join(tmpdir(), "codex-planted-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const SHADOWED = ["json", "re", "ast", "fnmatch", "hashlib", "shlex", "subprocess", "datetime", "pathlib", "glob",
  "signal", "tempfile", "uuid", "traceback", "dataclasses", "argparse", "socket", "contextlib", "io", "typing",
  "functools", "collections", "pkgutil", "warnings", "stat", "time", "base64", "importlib", "textwrap", "string"];
const CASES = {
  "tmp-block": "printf x > /tmp/codex-planted-probe.md",
  "git-guardian": "git push --force origin main",
};

function tree(gate) {
  const t = path.join(root, gate);
  for (const rel of ["scripts/hooks/codex-policy-hook.py", "scripts/hooks/fail-open.py", "skills/golem-powers/_shared",
    "skills/golem-powers/tmp-block", "skills/golem-powers/git-guardian"]) {
    cpSync(path.join(repo, rel), path.join(t, rel), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  }
  return t;
}

function pyDirs(dir) {
  const out = new Set();
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) { if (!["__pycache__", "evals", "research", "tests"].includes(name)) walk(p); }
      else if (name.endsWith(".py")) out.add(d);
    }
  };
  walk(dir);
  return [...out];
}

function decide(t, gate, marker, direct = false) {
  const work = path.join(t, "work");
  mkdirSync(work, { recursive: true });
  if (!existsSync(path.join(work, ".git"))) spawnSync("git", ["init", "-q", "-b", "main", work]);
  const cmd = codexCommand("python3", path.join(t, "scripts/hooks/codex-policy-hook.py"), gate);
  const event = { session_id: "planted", cwd: work, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: CASES[gate] } };
  // direct: the adapter alone, no registration wrapper and no -I (its own sys.path block must hold).
  const [bin, argv] = direct ? ["python3", [path.join(t, "scripts/hooks/codex-policy-hook.py"), gate]] : ["/bin/sh", ["-c", cmd]];
  const r = spawnSync(bin, argv, { cwd: work, encoding: "utf8", input: JSON.stringify(event),
    env: { PATH: process.env.PATH, HOME: path.join(t, "home"), PLANT_MARKER: marker,
      TMP_BLOCK_LEDGER: path.join(t, "ledger.jsonl") } });
  let decision = "unparseable";
  try { decision = JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision ?? "allow"; } catch {}
  return [r.status, decision];
}

test("the Codex registration runs the adapter isolated and without bytecode writes", () => {
  const cmd = codexCommand("python3", "/live/scripts/hooks/codex-policy-hook.py", "tmp-block");
  expect(cmd).toContain("python3'\\'' '\\''-I'\\'' '\\''-B'\\'' '\\''/live/scripts/hooks/codex-policy-hook.py");
});

function plant(t) {
  const src = path.join(t, "planted.py");
  writeFileSync(src, "import os\nopen(os.environ['PLANT_MARKER'], 'a').write(__name__ + '\\n')\nos._exit(0)\n");
  const targets = [...pyDirs(path.join(t, "scripts/hooks")), ...pyDirs(path.join(t, "skills/golem-powers"))]
    .flatMap((d) => SHADOWED.map((m) => path.join(d, `${m}.pyc`)));
  const c = spawnSync("python3", ["-c", "import py_compile, sys\nfor t in sys.argv[2:]: py_compile.compile(sys.argv[1], cfile=t, doraise=True)", src, ...targets]);
  expect(c.status).toBe(0);
}

for (const gate of Object.keys(CASES)) {
  test(`${gate}, adapter run directly (no -I): a planted module beside the adapter never runs`, () => {
    const t = tree(`${gate}-direct`);
    mkdirSync(path.join(t, "home"), { recursive: true });
    expect([gate, decide(t, `${gate}`, path.join(t, "clean.marker"), true)]).toEqual([gate, [0, "deny"]]);
    plant(t);
    const marker = path.join(t, "planted.marker");
    const planted = decide(t, gate, marker, true);
    expect([gate, existsSync(marker) ? readFileSync(marker, "utf8").trim() : "never ran"]).toEqual([gate, "never ran"]);
    expect([gate, planted]).toEqual([gate, [0, "deny"]]);
  });

  test(`${gate} via the Codex adapter: a planted stdlib-named bytecode module never runs and a deny stays a deny`, () => {
    const t = tree(gate);
    mkdirSync(path.join(t, "home"), { recursive: true });
    expect([gate, decide(t, gate, path.join(t, "clean.marker"))]).toEqual([gate, [0, "deny"]]);
    const src = path.join(t, "planted.py");
    writeFileSync(src, "import os\nopen(os.environ['PLANT_MARKER'], 'a').write(__name__ + '\\n')\nos._exit(0)\n");
    const targets = [...pyDirs(path.join(t, "scripts/hooks")), ...pyDirs(path.join(t, "skills/golem-powers"))]
      .flatMap((d) => SHADOWED.map((m) => path.join(d, `${m}.pyc`)));
    const c = spawnSync("python3", ["-c", "import py_compile, sys\nfor t in sys.argv[2:]: py_compile.compile(sys.argv[1], cfile=t, doraise=True)", src, ...targets]);
    expect(c.status).toBe(0);
    const marker = path.join(t, "planted.marker");
    const planted = decide(t, gate, marker);
    expect([gate, existsSync(marker) ? readFileSync(marker, "utf8").trim() : "never ran"]).toEqual([gate, "never ran"]);
    expect([gate, planted]).toEqual([gate, [0, "deny"]]);
  });
}
