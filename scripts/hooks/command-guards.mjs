// /bin/sh guards around registered Claude hook commands. Used by install-hooks.mjs
// (owner) and release-hooks.mjs (client); install-hooks.mjs re-exports them.

// AIDEV-NOTE: a fail-closed policy gate's Claude command runs inside a /bin/sh
// guard. The launcher denies every hook failure itself, but nothing in Python
// runs when the pinned interpreter is gone (exit 127) or the launcher copy
// cannot start (exit 1); Claude treats both as non-blocking, i.e. allow. The
// guard passes the launcher's own 0/2 through and turns any other status into
// the launcher's static denial (byte-identical to fail-open.py _block()).
// Codex has the same shape in codex-hooks-install.mjs.
export const REPAIR_REASON = "Blocked: a golems safety check couldn't run. Ask the lead to reinstall the hooks.";
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
export function failClosedCommand(run, repair = REPAIR_REASON) {
  const deny = JSON.stringify({ decision: "block", reason: repair, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: repair } });
  return `/bin/sh -c ${quote(`out=$(${run}); s=$?; if [ "$s" -eq 0 ] || [ "$s" -eq 2 ]; then [ -z "$out" ] || printf '%s\\n' "$out"; exit "$s"; fi; printf '%s\\n' ${quote(deny)}; exit 2`)}`;
}

// AIDEV-NOTE: a PermissionRequest hook must fail OPEN. Claude treats exit 2 on
// that event as a denial, and `python3 <missing launcher>` exits 2, so a lost
// launcher copy or hook file would refuse every prompt in every session, leads
// included. This /bin/sh guard prints the hook's output only on exit 0 and
// always exits 0, so any failure falls back to Claude's own prompt.
export function permissionGuardCommand(run) {
  return `/bin/sh -c ${quote(`out=$(${run}); s=$?; if [ "$s" -eq 0 ] && [ -n "$out" ]; then printf '%s\\n' "$out"; fi; exit 0`)}`;
}
