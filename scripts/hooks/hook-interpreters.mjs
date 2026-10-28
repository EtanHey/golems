// Host interpreter resolution and the persisted owner hook Node choice.
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// AIDEV-NOTE: every hook command carries an ABSOLUTE interpreter, never a bare
// `python3`: launchd and minimal-PATH environments resolve that to macOS
// /usr/bin/python3 (3.9). The floor is 3.11: this installer's Codex config check
// needs tomllib, git-guardian's policy module needs 3.10+, and CI runs the hooks
// on 3.11. Homebrew first (its bin/python3 link survives `brew upgrade`), then
// the PATH python3; resolved on the machine at install time, so hosts may differ.
export const MIN_HOOK_PYTHON = [3, 11];
export const HOOK_PYTHON_CANDIDATES = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"];
// Hook commands are unquoted strings: an interpreter path needs no shell quoting.
const PLAIN_PATH = /^\/[A-Za-z0-9._+\/-]+$/;
const pythonVersions = new Map();
export function pythonVersion(python) {
  if (!PLAIN_PATH.test(python) || !existsSync(python)) return null;
  if (!pythonVersions.has(python)) {
    const r = spawnSync(python, ["-I", "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"],
      { encoding: "utf8", timeout: 10_000 });
    const m = r.status === 0 ? /^(\d+)\.(\d+)\.(\d+)$/.exec(r.stdout.trim()) : null;
    pythonVersions.set(python, m ? m.slice(1).map(Number) : null);
  }
  return pythonVersions.get(python);
}
const [MIN_MAJOR, MIN_MINOR] = MIN_HOOK_PYTHON;
const pythonOk = (v) => Boolean(v) && (v[0] > MIN_MAJOR || (v[0] === MIN_MAJOR && v[1] >= MIN_MINOR));
export function resolveHookPython({ override, candidates = HOOK_PYTHON_CANDIDATES, pathPython } = {}) {
  for (const python of override ? [override] : [...candidates, ...(pathPython ? [pathPython] : [])]) {
    const version = pythonVersion(python);
    if (pythonOk(version)) return { python, version: version.join(".") };
  }
  return null;
}
export function pathPython() {
  const r = spawnSync("sh", ["-c", "command -v python3"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}
// Why a registered interpreter is unacceptable, or null when it is fine.
export function pythonProblem(python) {
  if (!path.isAbsolute(python)) return "not an absolute path";
  if (!PLAIN_PATH.test(python)) return "path needs shell quoting";
  if (!existsSync(python)) return "missing";
  const v = pythonVersion(python);
  if (!v) return "version unknown";
  return pythonOk(v) ? null : `${v.join(".")} is below ${MIN_HOOK_PYTHON.join(".")}`;
}

// Retain the stable PATH spelling (e.g. ~/.local/bin/node), not process.execPath's
// versioned realpath. Once installed, PATH never selects the hook runtime again.
export function resolveHookNode(entries, hooksDir, settingsPath, status, override) {
  const managed = entries.filter(e => e.command?.includes("{node}"));
  if (!managed.length && !override) return null;
  const recordPath = path.join(hooksDir, "golems-hook-node.json");
  let recorded;
  if (!override && existsSync(recordPath)) {
    try {
      recorded = JSON.parse(readFileSync(recordPath, "utf8"));
      if (!recorded || typeof recorded.path !== "string" || typeof recorded.version !== "string" || !/^v\d+\.\d+\.\d+$/.test(recorded.version)) throw new Error();
    } catch { return { problem: `invalid Node record ${recordPath}` }; }
  }
  let node = override ?? recorded?.path;
  if (!override && !recorded) {
    // Migrate an existing install without changing its registered runtime.
    const hooks = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")).hooks ?? {} : {};
    const commands = Object.values(hooks).flatMap(g => Array.isArray(g) ? g : [])
      .flatMap(g => Array.isArray(g?.hooks) ? g.hooks : []).map(h => String(h?.command ?? ""));
    const registered = new Set(commands.filter(cmd => managed.some(e => cmd.includes(e.match)))
      .map(cmd => cmd.trim().split(/\s+/)[0])
      .filter(first => PLAIN_PATH.test(first) && /^node(?:js|(?:-v?)?\d+(?:\.\d+)*)?$/.test(path.basename(first))));
    if (registered.size > 1) return { problem: "conflicting registered Node paths; inspect settings.json" };
    node = [...registered][0];
    // Bare commands and shell wrappers never pinned a Node runtime. Resolve
    // PATH only if no absolute Node registration can be adopted.
    if (!node && !status) {
      const found = spawnSync("sh", ["-c", "command -v node"], { encoding: "utf8" });
      node = found.status === 0 ? found.stdout.trim() : "";
    }
  }
  const result = { path: node ?? "", recordPath, legacy: !recorded };
  if (!node || !PLAIN_PATH.test(node)) return { ...result, problem: "no absolute shell-safe registered Node path" };
  try { accessSync(node, constants.X_OK); }
  catch { return { ...result, problem: `${node} missing or not executable` }; }
  const probe = spawnSync(node, ["--version"], { encoding: "utf8", timeout: 10_000 });
  const version = probe.status === 0 ? probe.stdout.trim() : "";
  if (!/^v\d+\.\d+\.\d+$/.test(version)) return { ...result, problem: `${node} version unknown` };
  if (status && recorded && version !== recorded.version) {
    return { ...result, problem: `${node} version changed: recorded ${recorded.version}, actual ${version} (re-run --apply to acknowledge)` };
  }
  return { ...result, version };
}

export function recordHookNode(node) {
  if (!node) return;
  const tmp = `${node.recordPath}.install-hooks-tmp`;
  writeFileSync(tmp, `${JSON.stringify({ path: node.path, version: node.version }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, node.recordPath);
}
