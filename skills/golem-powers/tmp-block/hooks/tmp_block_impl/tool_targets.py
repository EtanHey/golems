"""Definitions moved byte-faithfully from the executable hook."""
import re
import os

GUARDED_FILE_TOOLS = ("Write", "Edit", "NotebookEdit")

# The apply_patch envelope Codex reports for every file edit. Its own class:
# the target paths live inside the patch body, not in a `file_path` key.
APPLY_PATCH_TOOL = "apply_patch"

# ── Cross-agent tool names (measured 2026-08-19) ─────────────────────────────
#
# This hook is loaded by three harnesses, and each one spells the same tool
# differently. Claude Code sends `Bash`/`Write`/`Edit`/`NotebookEdit`. Cursor
# reads `~/.claude/settings.json` unconditionally (bundle 2026.08.11-e8db854,
# `claudeUserConfigPath`), maps `Bash -> Shell` and `Edit -> Write`, and sends
# `tool_name: "Shell"` with the same `tool_input.command`. Codex reads
# `~/.codex/hooks.json` and sends `Bash` for shell and unified exec, and
# `apply_patch` for every file edit (developers.openai.com/codex/hooks,
# "Tool coverage").
#
# Until this map existed, a Cursor shell call arrived as `Shell`, missed the
# `tool_name != "Bash"` gate in main(), and was ALLOWED silently — the guard
# was loaded into every Cursor session and enforcing nothing on shell. Cursor
# `Write` was already denied, because Cursor spells that one exactly as Claude
# does.
TOOL_ALIASES = {
    "Shell": "Bash",  # Cursor: the shell tool, measured payload {command, cwd, timeout}
}


def canonical_tool(tool_name):
    """Map a host-specific PreToolUse tool name onto this guard's own names.

    Unknown names pass through unchanged and fall out of the dispatch gate in
    main() as "not a guarded tool" — the same allow the guard has always given
    a tool it does not police. Adding an alias here is the whole cost of
    covering a new harness."""
    return TOOL_ALIASES.get(tool_name, tool_name)


# apply_patch envelope headers that CREATE or REWRITE a path. `Delete File` is
# absent on purpose: the contract has never denied a delete.
_APPLY_PATCH_TARGET_RE = re.compile(
    r"^\*\*\*\s+(Add File|Update File|Move to):\s*(.+?)\s*$", re.MULTILINE
)


def find_temp_targets(tool_name, tool_input):
    """Return [(verb, path, segment)] of temp-class write targets for this tool
    call. Raises ValueError on malformed payload shapes (-> fail CLOSED)."""
    if not isinstance(tool_input, dict):
        raise ValueError(f"tool_input for {tool_name} is not a dict")

    if tool_name in GUARDED_FILE_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        if not isinstance(path, str) or not path:
            # A guarded file tool with no path is a schema glitch — falling
            # through as "" would recreate the S04 validation-error-then-
            # allow path (Codex P2 round 7).
            raise ValueError(f"{tool_name} payload missing file_path")
        if in_temp_class(path):
            return [(tool_name, path, 0)]
        return []

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        if not isinstance(command, str):
            raise ValueError("Bash command is not a string")
        targets = []
        for reading in ansi_c_readings(command):
            with ansi_c_reading(reading):
                for branch in evaluate_shell_readings(lambda: _bash_temp_targets(command)):
                    for target in branch:
                        if target not in targets:
                            targets.append(target)
        return targets

    if tool_name == APPLY_PATCH_TOOL:
        return _apply_patch_temp_targets(tool_input)

    return []


def _apply_patch_temp_targets(tool_input, cwd=None):
    """Temp-class targets named inside a Codex apply_patch envelope.

    Codex reports every file edit as `apply_patch` with the envelope in
    `tool_input.command` (developers.openai.com/codex/hooks, "Tool coverage"),
    so the paths this guard has to judge are the `*** Add File:` /
    `*** Update File:` / `*** Move to:` headers rather than a `file_path` key.

    A relative header is joined onto the payload `cwd` when the payload
    supplies a usable absolute one. When it does not, the literal is judged as
    written — which leaves relative-path-from-a-temp-cwd uncaught, the same
    already-documented residual the Bash path has."""
    command = tool_input.get("command")
    if not isinstance(command, str):
        # Same fail-closed reasoning as the Bash and file-tool payload checks:
        # an unreadable envelope must not fall through as "no targets".
        raise ValueError("apply_patch command is not a string")
    if cwd is None:
        cwd = tool_input.get("cwd")
    base = cwd if isinstance(cwd, str) and os.path.isabs(cwd) else None
    hits = []
    for match in _APPLY_PATCH_TARGET_RE.finditer(command):
        verb, path = match.group(1), match.group(2)
        if not path:
            continue
        candidate = path
        if base and not os.path.isabs(os.path.expanduser(candidate)):
            candidate = os.path.join(base, candidate)
        if in_temp_class(candidate):
            hits.append((f"apply_patch {verb}", candidate, 0))
    return hits
