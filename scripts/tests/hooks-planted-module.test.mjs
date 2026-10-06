// Every golems Python hook, run exactly as the manifest registers it, must ignore
// a gitignored bytecode module planted beside its sources: the stdlib always wins,
// so a planted module never runs and a deny stays a deny.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

setDefaultTimeout(60_000);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(path.join(repo, "scripts/hooks/manifest.json"), "utf8"));
const root = mkdtempSync(path.join(tmpdir(), "planted-module-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Stdlib modules hooks import at top level or lazily (runpy, parsers, helpers).
const SHADOWED = ["json", "re", "ast", "fnmatch", "hashlib", "shlex", "subprocess", "datetime", "pathlib", "glob",
  "signal", "tempfile", "uuid", "traceback", "dataclasses", "argparse", "socket", "contextlib", "io", "typing",
  "functools", "collections", "pkgutil", "warnings", "stat", "time", "base64", "urllib", "importlib", "textwrap"];

// Deny inputs where the hook has one; otherwise an ordinary event (the planted code must still never run).
const PAYLOADS = {
  "human-confirm-gate": { tool_name: "Bash", tool_input: { command: "git push -f origin main" }, deny: true },
  "block-dangerous-commands": { tool_name: "Bash", tool_input: { command: "open -a \"Google Chrome\"" }, deny: true },
  "tmp-block": { tool_name: "Write", tool_input: { file_path: "/tmp/planted-module-probe.txt", content: "x" }, deny: true },
  "pre_tool_use": { tool_name: "Bash", tool_input: { command: "git push origin main" }, deny: true, cwdOnMain: true },
  "collab-guard": { tool_name: "Write", tool_input: { content: "short\n" }, deny: true, collab: true },
  "tdd-guard": { tool_name: "Write", tool_input: { file_path: "src/feature.ts", content: "export const x = 1;\n" } },
  "stamp-lint": { tool_name: "Write", tool_input: { file_path: "notes.md", content: "hello\n" }, hook_event_name: "PostToolUse" },
  "frustration-capture": { hook_event_name: "UserPromptSubmit", prompt: "no, that's wrong, I told you already" },
  "daemon-gate-precheck": { tool_name: "Bash", tool_input: { command: "ls" } },
};

const entries = new Map();
for (const hooks of Object.values(manifest.hosts)) {
  for (const e of hooks) if (e.kind === "golems" && e.command?.includes("golems-fail-open.py")) entries.set(e.id, e);
}

function compile(targets) {
  const src = path.join(root, "planted.py");
  writeFileSync(src, "import os\nopen(os.environ['PLANT_MARKER'], 'a').write(__name__ + '\\n')\nos._exit(0)\n");
  const r = spawnSync("python3", ["-c", "import py_compile, sys\nfor t in sys.argv[2:]: py_compile.compile(sys.argv[1], cfile=t, doraise=True)", src, ...targets]);
  expect(r.status).toBe(0);
}

function pyDirs(dir) {
  const out = new Set();
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) { if (!["__pycache__", "node_modules", "evals", "research"].includes(name)) walk(p); }
      else if (name.endsWith(".py")) out.add(d);
    }
  };
  walk(dir);
  return [...out];
}

function setup(id, e) {
  const tree = path.join(root, id);
  const copy = (rel) => cpSync(path.join(repo, rel), path.join(tree, rel), { recursive: true,
    filter: (s) => !s.includes("__pycache__") });
  copy("skills/golem-powers/_shared");
  const source = e.source;
  const isFile = source.endsWith(".py");
  copy(isFile ? path.dirname(source) : source);
  copy("scripts/hooks/fail-open.py");
  const rest = e.command.split("golems-fail-open.py ")[1];
  const closed = rest.startsWith("--fail-closed ");  // policy gates: mirror the registered mode
  const after = closed ? rest.slice("--fail-closed ".length) : rest;
  const entry = isFile ? path.join(tree, source) : path.join(tree, source, after.replace(`{hooks}/${e.link}/`, ""));
  const flags = e.command.split(" ").slice(1, e.command.split(" ").findIndex((w) => w.includes("golems-fail-open.py")));
  const home = path.join(tree, "home");
  mkdirSync(home, { recursive: true });
  return { tree, entry, flags, home, closed, launcher: path.join(tree, "scripts/hooks/fail-open.py"),
    dirs: [...new Set([...pyDirs(path.join(tree, isFile ? path.dirname(source) : source)), ...pyDirs(path.join(tree, "skills/golem-powers/_shared"))])] };
}

function invoke(fx, payload, marker, direct = false) {
  const cwd = path.join(fx.tree, "work");
  mkdirSync(cwd, { recursive: true });
  const event = { session_id: "planted", cwd, hook_event_name: "PreToolUse", ...payload };
  delete event.deny; delete event.collab; delete event.cwdOnMain;
  if (payload.collab) {
    const collab = path.join(cwd, "collab/x.md");
    mkdirSync(path.dirname(collab), { recursive: true });
    writeFileSync(collab, "line\n".repeat(40));
    event.tool_input = { ...payload.tool_input, file_path: collab };
  }
  if (payload.cwdOnMain && !existsSync(path.join(cwd, ".git"))) {
    spawnSync("git", ["init", "-q", "-b", "main", cwd]);
  }
  const argv = direct ? [fx.entry]  // direct: no launcher, no -I
    : [...fx.flags, fx.launcher, ...(fx.closed ? ["--fail-closed"] : []), fx.entry];
  const r = spawnSync("python3", argv, { cwd, encoding: "utf8", input: JSON.stringify(event),
    env: { PATH: process.env.PATH, HOME: fx.home, PLANT_MARKER: marker, CLAUDE_PROJECT_DIR: cwd } });
  return r.status;
}

test("the manifest registers every golems Python hook through the launcher as python3 -I -B", () => {
  expect([...entries.keys()].sort()).toEqual(Object.keys(PAYLOADS).sort());
  for (const [id, e] of entries) expect([id, e.command.startsWith("{python} -I -B {hooks}/golems-fail-open.py ")]).toEqual([id, true]);
});

for (const id of Object.keys(PAYLOADS)) {
  test(`${id}: a planted stdlib-named bytecode module never runs and never turns a deny into an allow`, () => {
    const e = entries.get(id);
    expect(e).toBeDefined();
    const fx = setup(id, e);
    const payload = PAYLOADS[id];
    const clean = invoke(fx, payload, path.join(fx.tree, "clean.marker"));
    expect([id, clean]).toEqual([id, payload.deny ? 2 : 0]);
    compile(fx.dirs.flatMap((d) => SHADOWED.map((m) => path.join(d, `${m}.pyc`))));
    const marker = path.join(fx.tree, "planted.marker");
    const planted = invoke(fx, payload, marker);
    expect([id, existsSync(marker) ? readFileSync(marker, "utf8").trim() : "never ran"]).toEqual([id, "never ran"]);
    if (payload.deny) expect([id, planted]).toEqual([id, 2]);
    else expect([id, planted]).toEqual([id, clean]);
  });
}

for (const id of Object.keys(PAYLOADS)) {
  test(`${id}: run directly (launcher bypassed), a planted stdlib-named module still never runs`, () => {
    const fx = setup(`${id}-direct`, entries.get(id));
    const payload = PAYLOADS[id];
    const clean = invoke(fx, payload, path.join(fx.tree, "clean.marker"), true);
    compile(fx.dirs.flatMap((d) => SHADOWED.map((m) => path.join(d, `${m}.pyc`))));
    const marker = path.join(fx.tree, "planted.marker");
    const planted = invoke(fx, payload, marker, true);
    expect([id, existsSync(marker) ? readFileSync(marker, "utf8").trim() : "never ran"]).toEqual([id, "never ran"]);
    expect([id, planted]).toEqual([id, clean]);
  });
}
