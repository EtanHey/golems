// Codex registrations are hooks.json beside config.toml. Leave config.toml
// byte-identical; native hooks are enabled by default. Never manufacture trust.
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const REPAIR = "BLOCKED: Codex policy hook unavailable. Repair with scripts/hooks/install-hooks.sh --host <host> --update --apply, then review /hooks from plain codex with no --profile.";
export const CODEX_TRUST_HINT = "Review /hooks from plain codex with no --profile so trust persists in the base config.toml; repoGolem's per-launch profile is deleted on exit.";

export function codexCommand(python, adapter, gate) {
  // Codex exit 2 requires stderr. This fallback survives missing Python, a
  // missing/broken adapter, and its unexpected exit. No policy lives here.
  // -I -B: no PYTHONPATH/user site, no bytecode writes into hooks-live (see fail-open.py).
  const run = [python, "-I", "-B", adapter, gate].map(quote).join(" ");
  return `/bin/sh -c ${quote(`if output=$(${run} 2>/dev/null); then printf '%s\\n' "$output"; else printf '%s\\n' ${quote(REPAIR)} >&2; exit 2; fi`)}`;
}

function regular(p, directory = false) {
  if (!existsSync(p)) {
    try { if (lstatSync(p).isSymbolicLink()) throw new Error("Refusing dangling Codex symlink"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    return;
  }
  const s = lstatSync(p);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile())) throw new Error("Refusing non-regular Codex destination");
}

// The adapter's gates. Only human-confirm carries an owner anchor pin; like its
// Claude registration it is refused (never registered) while that pin is empty.
const CODEX_GATES = { "tmp-block": undefined, "git-guardian": undefined,
  "human-confirm": "skills/golem-powers/human-confirm-gate/anchor.pins" };

export function planCodexHooks({ manifest, host, live, codexHome, python = "python3", refused = [] }) {
  const listed = manifest.codex_hosts?.[host];
  if (!listed) return null; // Old pins do not claim Codex support.
  for (const list of Object.values(manifest.codex_hosts)) {
    const gates = Array.isArray(list) ? list.map(e => e.gate) : [];
    if (!Array.isArray(list) || new Set(gates).size !== list.length || !gates.includes("tmp-block") ||
        !gates.includes("git-guardian") || list.length > 3) throw new Error("Invalid Codex policy manifest");
    for (const e of list) {
      if (!Object.hasOwn(CODEX_GATES, e.gate) || e.requiresPin !== CODEX_GATES[e.gate] ||
          e.source !== "scripts/hooks/codex-policy-hook.py" ||
          e.matcher !== "^(Bash|apply_patch)$" || e.timeout !== 10) throw new Error("Invalid Codex policy entry");
    }
  }
  const entries = listed.filter(e => !refused.includes(e.gate));
  regular(codexHome, true);
  const config = path.join(codexHome, "config.toml");
  const at = path.join(codexHome, "hooks.json");
  regular(config); regular(at);
  let enabled = true;
  let states = {};
  if (existsSync(config)) {
    const r = spawnSync(python, ["-c", "import json,sys,tomllib; c=tomllib.load(open(sys.argv[1],'rb')); f=c.get('features',{}); print(json.dumps({'enabled':f.get('hooks',f.get('codex_hooks',True)) is not False,'states':c.get('hooks',{}).get('state',{})}))", config], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("Cannot validate Codex config; refusing registration");
    ({ enabled, states } = JSON.parse(r.stdout));
  }
  const old = existsSync(at) ? readFileSync(at, "utf8") : "";
  const current = old ? JSON.parse(old) : {};
  if (!current || typeof current !== "object" || Array.isArray(current) ||
      (current.hooks && (typeof current.hooks !== "object" || Array.isArray(current.hooks)))) throw new Error("Invalid Codex hook configuration");
  const desired = entries.map(e => ({ matcher: e.matcher, hooks: [{ type: "command",
    command: codexCommand(python, path.join(live, e.source), e.gate), timeout: e.timeout }] }));
  const hooks = structuredClone(current.hooks ?? {});
  let matches = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error("Invalid Codex hook groups");
    hooks[event] = groups.map((group, groupIndex) => {
      if (!Array.isArray(group.hooks)) throw new Error("Invalid Codex hook handlers");
      return { ...group, hooks: group.hooks.filter((h, handlerIndex) => {
        if (!String(h.command ?? "").includes("/scripts/hooks/codex-policy-hook.py")) return true;
        matches.push({ event, groupIndex, handlerIndex, group: { matcher: group.matcher, hooks: [h] } });
        return false;
      }) };
    }).filter(group => group.hooks.length);
  }
  hooks.PreToolUse = [...(hooks.PreToolUse ?? []), ...desired];
  const next = `${JSON.stringify({ ...current, hooks }, null, 2)}\n`;
  const registered = matches.length === desired.length && desired.every(want =>
    matches.filter(m => m.event === "PreToolUse" && isDeepStrictEqual(m.group, want)).length === 1);
  const source = entries.every(e => existsSync(path.join(live, e.source)));
  // Native state keys are positional. Presence is evidence of persisted trust,
  // not proof that its hash still matches this definition (use native /hooks).
  const managedStates = matches.map(m => states[`${at}:pre_tool_use:${m.groupIndex}:${m.handlerIndex}`]);
  const trust = !enabled || managedStates.some(s => s?.enabled === false) ? "disabled"
    : !registered || managedStates.some(s => typeof s?.trusted_hash !== "string" || !s.trusted_hash.trim()) ? "missing"
    : "present-unverified";
  const backup = old && old !== next ? `${at}.golems-backup-${createHash("sha256").update(old).digest("hex")}` : null;
  if (backup) {
    regular(backup);
    if (existsSync(backup) && readFileSync(backup, "utf8") !== old) throw new Error("Codex hook backup collision");
  }
  return { at, old, next, enabled, registered, source, trust, refused: listed.filter(e => refused.includes(e.gate)).map(e => e.gate),
    backup,
    mode: old ? lstatSync(at).mode & 0o777 : 0o600 };
}

export function applyCodexHooks(plan) {
  if (!plan) return;
  if (!plan.enabled) throw new Error("Codex hooks are disabled by existing config; review that setting before installation");
  if (!plan.source) throw new Error("Codex policy adapter missing from selected hooks-live pin");
  if (plan.old === plan.next) return;
  if (plan.old) {
    const backup = plan.backup;
    regular(backup);
    if (existsSync(backup)) {
      if (readFileSync(backup, "utf8") !== plan.old) throw new Error("Codex hook backup collision");
    } else { writeFileSync(backup, plan.old, { flag: "wx", mode: plan.mode }); chmodSync(backup, plan.mode); }
  }
  mkdirSync(path.dirname(plan.at), { recursive: true });
  const stage = `${plan.at}.new-${randomUUID()}`;
  try {
    writeFileSync(stage, plan.next, { flag: "wx", mode: plan.mode });
    chmodSync(stage, plan.mode);
    renameSync(stage, plan.at);
  } finally { rmSync(stage, { force: true }); }
}

export function codexStatus(plan) {
  if (!plan) { console.log("codex wiring=absent (selected pin has no Codex manifest)"); return false; }
  const ok = plan.enabled && plan.registered && plan.source;
  console.log(`codex wiring=${ok ? "ok" : "drifted"} enabled=${plan.enabled} registered=${plan.registered} source=${plan.source} trust=${plan.trust} (verify definitions from plain codex with no --profile via /hooks)`);
  return !ok || plan.trust !== "present-unverified";
}
