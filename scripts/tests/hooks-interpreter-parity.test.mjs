// The installer pins an absolute Python >= MIN_HOOK_PYTHON (3.11) into every hook
// command, but a command installed before the pin is a bare `python3`, and on a
// minimal PATH that is macOS /usr/bin/python3 3.9. There sys.flags.safe_path does
// not exist: a launcher that reads it crashes before the hook runs, and a Claude
// seat treats that crash as a non-blocking error, so every guard fails open.
// Run exactly as the manifest registers them (-I -B launcher), the hooks below
// must decide identically under an old (< 3.11) and the current interpreter.
// git-guardian imports a 3.10+ module, so under 3.9 it may only be STRICTER
// (its import-failure denial), never more permissive.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

setDefaultTimeout(60_000);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const launcher = path.join(repo, "scripts/hooks/fail-open.py");
const adapter = path.join(repo, "scripts/hooks/codex-policy-hook.py");
const manifest = JSON.parse(readFileSync(path.join(repo, "scripts/hooks/manifest.json"), "utf8"));
// Not under tmpdir(): tmp-block denies writes there, which would hide the allow cases.
const scratch = path.join(repo, "docs.local/interpreter-parity-fixtures");
mkdirSync(scratch, { recursive: true });
const root = realpathSync(mkdtempSync(path.join(scratch, "parity-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function version(py) {
  const r = spawnSync(py, ["-I", "-c", "import sys; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split(".").map(Number) : null;
}

// CI installs 3.9 beside its default (golem-powers-skill-tests.yml); macOS ships it as /usr/bin/python3.
const OLD = [process.env.GOLEMS_OLD_PYTHON, "/usr/bin/python3", "python3.9", "python3.10"]
  .filter(Boolean).find((py) => { const v = version(py); return v && v[0] === 3 && v[1] >= 9 && v[1] < 11; });
const CURRENT = "python3";
const PYTHONS = [OLD, CURRENT];

test("an old (< 3.11) interpreter is available, so the parity cases below are not vacuous", () => {
  expect(OLD).toBeDefined();
  const current = version(CURRENT);
  expect(current && (current[0] > 3 || current[1] >= 11)).toBe(true);
});

const source = (id) => {
  const e = manifest.hosts.mbp.find((x) => x.id === id);
  const after = e.command.split("golems-fail-open.py ")[1].replace(`{hooks}/${e.link}`, "");
  return path.join(repo, e.source.endsWith(".py") ? e.source : `${e.source}${after}`);
};

// Synthetic, TLD-less fixtures: a deny and an allow per policy hook.
const CASES = [
  ["tmp-block", "deny", { tool_name: "Write", tool_input: { file_path: "/tmp/parity-probe.txt", content: "x" } }, 2],
  ["tmp-block", "allow", { tool_name: "Write", tool_input: { file_path: "WORK/notes.txt", content: "x" } }, 0],
  ["pre_tool_use", "deny", { tool_name: "Bash", tool_input: { command: "git push -f origin main" } }, 2],
  ["pre_tool_use", "allow", { tool_name: "Bash", tool_input: { command: "git status" } }, 0],
  ["block-dangerous-commands", "deny", { tool_name: "Bash", tool_input: { command: "open -a \"Google Chrome\"" } }, 2],
  ["block-dangerous-commands", "allow", { tool_name: "Bash", tool_input: { command: "ls" } }, 0],
  ["human-confirm-gate", "deny", { tool_name: "Bash", tool_input: { command: "git push -f origin main" } }, 2],
  ["human-confirm-gate", "allow", { tool_name: "Bash", tool_input: { command: "ls" } }, 0],
];

function work(name) {
  const cwd = path.join(root, name, "work");
  const home = path.join(root, name, "home");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main", cwd]);
  return { cwd, home };
}

function decide(py, argv, payload, name) {
  const { cwd, home } = work(name);
  const event = JSON.parse(JSON.stringify({ session_id: "parity", cwd, hook_event_name: "PreToolUse", ...payload })
    .replaceAll("WORK/", `${cwd}/`));
  const r = spawnSync(py, argv, { cwd, encoding: "utf8", input: JSON.stringify(event),
    env: { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: cwd,
      TMP_BLOCK_LEDGER: path.join(home, "ledger.jsonl") } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, decision: decision(r) };
}

// Claude blocks on exit 2; Codex (and Claude) also read a JSON deny on stdout.
function decision(r) {
  if (r.status === 2) return "deny";
  let out = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch { return `unparsed exit ${r.status}`; }
  if (out.decision === "block" || out.hookSpecificOutput?.permissionDecision === "deny") return "deny";
  return r.status === 0 ? "allow" : `exit ${r.status}`;
}

// The old interpreter must decide exactly as the current one, except that
// git-guardian (3.10+ policy module) may deny where the current one allows.
function expectParity(label, guardian, [old, current], expected) {
  expect([label, current.decision]).toEqual([label, expected]);
  if (guardian && old.decision === "deny") return;
  expect([label, old.decision, old.stdout]).toEqual([label, current.decision, current.stdout]);
}

for (const [id, kind, payload, expected] of CASES) {
  test(`${id} ${kind}: identical decision under the old and current interpreter, through the launcher`, () => {
    const seen = PYTHONS.map((py, i) => {
      const r = decide(py, ["-I", "-B", launcher, source(id)], payload, `${id}-${kind}-${i}`);
      // A launcher crash or a fail-open line means the hook never decided.
      expect([id, kind, py, /Traceback|golems-fail-open:/.test(r.stderr) && r.stderr]).toEqual([id, kind, py, false]);
      return r;
    });
    expectParity(`${id} ${kind}`, id === "pre_tool_use", seen, expected === 2 ? "deny" : "allow");
  });
}

for (const [gate, kind, payload, denied] of [
  ["tmp-block", "deny", { tool_name: "Bash", tool_input: { command: "echo x > /tmp/parity-probe.txt" } }, true],
  ["tmp-block", "allow", { tool_name: "Bash", tool_input: { command: "ls" } }, false],
  ["git-guardian", "deny", { tool_name: "Bash", tool_input: { command: "git push -f origin main" } }, true],
  ["git-guardian", "allow", { tool_name: "Bash", tool_input: { command: "git status" } }, false],
]) {
  test(`codex ${gate} ${kind}: the adapter decides identically under the old and current interpreter`, () => {
    const seen = PYTHONS.map((py, i) => decide(py, ["-I", "-B", adapter, gate], payload, `codex-${gate}-${kind}-${i}`));
    expectParity(`codex ${gate} ${kind}`, gate === "git-guardian", seen, denied ? "deny" : "allow");
  });
}

test("under every interpreter: the hook dir joins LAST, the launcher's dir never appears, stdlib order is kept", () => {
  const d = path.join(root, "syspath");
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "policy.py"), "REASON = 'sibling'\n");
  writeFileSync(path.join(d, "gate.py"), "import json, sys\nfrom policy import REASON\nprint(json.dumps([REASON, sys.path]))\n");
  for (const py of PYTHONS) {
    const isolated = JSON.parse(spawnSync(py, ["-I", "-c", "import sys, json; print(json.dumps(sys.path))"], { encoding: "utf8" }).stdout);
    for (const flags of [["-I", "-B"], []]) {
      const r = spawnSync(py, [...flags, launcher, path.join(d, "gate.py")], { encoding: "utf8", input: "{}" });
      expect([py, flags.join(" "), r.status, r.stderr]).toEqual([py, flags.join(" "), 0, ""]);
      const [reason, seen] = JSON.parse(r.stdout);
      expect(reason).toBe("sibling");
      expect([py, seen.at(-1), seen.indexOf(d)]).toEqual([py, d, seen.length - 1]);
      expect(seen).not.toContain(path.dirname(realpathSync(launcher)));
      if (flags.length) expect([py, seen.slice(0, -1)]).toEqual([py, isolated]);
    }
  }
});
