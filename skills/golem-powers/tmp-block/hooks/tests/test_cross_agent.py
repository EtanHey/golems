"""tmp-block cross-agent coverage — Cursor and Codex reach the same guard.

Every payload shape and every dialect asserted here was MEASURED or read from a
primary doc on 2026-08-19, not inferred. The record lives in
`docs.local/plan/tmpblock-cross-agent/MEASUREMENTS.md`. In short:

**Cursor** (cursor-agent 2026.08.11-e8db854) loads `~/.claude/settings.json`
unconditionally — the bundle's hook-path table has a literal `claudeUserConfigPath`
pointing at it — and translates Claude's matcher through
`{Bash: "Shell", Edit: "Write", ...}`. So this guard has been loaded into every
Cursor session all along. Its `Write` calls arrive spelled exactly as Claude
spells them and were **already being denied**; a live probe with no local tap
got the verbatim `⛔ TMP-BLOCK` reason back and the file was never created. Its
shell calls arrive as `tool_name: "Shell"`, missed the `tool_name != "Bash"`
gate in `main()`, and were silently **allowed** — `printf x > /tmp/…` returned
exit 0 twice and created the file both times. That one alias is the whole
Cursor gap, and `test_cursor_shell_*` below is what closes it.

**Codex** (codex-cli 0.147.0) reads `~/.codex/hooks.json`, sends `Bash` for
shell and unified exec, and `apply_patch` for every file edit with the patch
envelope in `tool_input.command`
(https://developers.openai.com/codex/hooks, "Tool coverage"). Its deny dialect
is `hookSpecificOutput.permissionDecision`, and it rejects a `deny` whose
`permissionDecisionReason` is empty. It also documents `continue`, `stopReason`
and `suppressOutput` as unsupported for `PreToolUse` — a hook returning one is
marked failed **and the tool call proceeds**, which is the S04 half-fire shape,
so `test_deny_payload_carries_no_codex_unsupported_fields` pins them out.

NOT asserted here, because it could not be measured this session: that a live
Codex pane actually refuses the write. Codex was usage-limited until
2026-08-20 06:32 (`ERROR: You've hit your usage limit`), so the end-to-end
Codex probe is outstanding. These tests pin the payload contract, which is what
a test can pin; they are not evidence of a live Codex deny.
"""

import json

from test_tmp_block import (  # noqa: F401 — shared fixtures/harness
    assert_allowed,
    assert_denied,
    durable_path,
    run_hook,
)


def cursor_shell_payload(command):
    """Measured Cursor `preToolUse` payload for a shell call.

    Verbatim shape from the live tap, including the empty `cwd` and the
    `timeout` Cursor adds and Claude does not."""
    return {
        "tool_name": "Shell",
        "tool_input": {"command": command, "cwd": "", "timeout": 30000},
        "session_id": "cursor-cross-agent-test",
        "hook_event_name": "preToolUse",
    }


def cursor_write_payload(file_path, content="durable-looking notes\n"):
    """Measured Cursor `preToolUse` payload for a file write — identical in
    shape to Claude's, which is why this half was already covered."""
    return {
        "tool_name": "Write",
        "tool_input": {"file_path": file_path, "content": content},
        "session_id": "cursor-cross-agent-test",
        "hook_event_name": "preToolUse",
    }


def codex_apply_patch_payload(body, cwd=None):
    """Codex `apply_patch` payload — the patch envelope in `tool_input.command`."""
    tool_input = {"command": body}
    if cwd is not None:
        tool_input["cwd"] = cwd
    return {
        "tool_name": "apply_patch",
        "tool_input": tool_input,
        "session_id": "codex-cross-agent-test",
        "hook_event_name": "PreToolUse",
    }


def add_file_envelope(path, content="durable notes"):
    return (
        "*** Begin Patch\n"
        f"*** Add File: {path}\n"
        f"+{content}\n"
        "*** End Patch\n"
    )


# ── Cursor: the shell alias (the measured gap) ───────────────────────────────


def test_cursor_shell_redirect_into_temp_is_denied():
    """The exact call the live probe got away with, twice."""
    proc = run_hook(cursor_shell_payload("printf x > /tmp/cursor_probe_tmpblock.txt"))
    assert_denied(proc, must_mention=("TMP-BLOCK", "/tmp"))


def test_cursor_shell_append_into_temp_is_denied():
    proc = run_hook(cursor_shell_payload("echo note >> /private/tmp/leak.md"))
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_cursor_shell_tee_into_temp_is_denied():
    proc = run_hook(cursor_shell_payload("printf x | tee /tmp/leak.txt"))
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_cursor_shell_heredoc_into_temp_is_denied():
    proc = run_hook(
        cursor_shell_payload("cat > /tmp/notes.md <<'EOF'\ndurable\nEOF")
    )
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_cursor_shell_worktree_convention_is_enforced(durable_path):
    """Rule 2 reaches Cursor too — it keys off the same canonical name."""
    proc = run_hook(
        cursor_shell_payload(f"git worktree add {durable_path}/sibling.wt/x HEAD"),
        cwd=str(durable_path),
    )
    assert_denied(proc, must_mention=("WORKTREE-CONVENTION",))


def test_cursor_shell_read_is_not_denied(durable_path):
    """Reads were never denied and must not start being denied now."""
    assert_allowed(run_hook(cursor_shell_payload("ls -l /tmp"), cwd=str(durable_path)))


def test_cursor_shell_durable_write_is_allowed(durable_path):
    assert_allowed(
        run_hook(
            cursor_shell_payload(f"printf x > {durable_path}/notes.md"),
            cwd=str(durable_path),
        )
    )


def test_cursor_shell_scratchpad_allowlist_still_applies(durable_path):
    """The one sanctioned temp location works through the alias as well."""
    scratch = (
        "/private/tmp/claude-501/-Users-e-Gits-golems/"
        "ab0d5636-9b77-4605-a926-bf9aa94faf13/scratchpad/probe.txt"
    )
    assert_allowed(
        run_hook(cursor_shell_payload(f"printf x > {scratch}"), cwd=str(durable_path))
    )


def test_cursor_write_into_temp_is_denied():
    """Pins the half that was ALREADY working, so a refactor of the alias map
    cannot quietly take it away."""
    proc = run_hook(cursor_write_payload("/tmp/cursor_probe_write.md"))
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_unknown_host_tool_name_is_still_allowed(durable_path):
    """An alias map must not become a deny-by-default for tools this guard does
    not police — `Grep` and friends have always fallen straight through."""
    payload = {
        "tool_name": "Grep",
        "tool_input": {"pattern": "x", "path": "/tmp"},
        "session_id": "cross-agent-test",
    }
    assert_allowed(run_hook(payload, cwd=str(durable_path)))


# ── Codex: apply_patch ───────────────────────────────────────────────────────


def test_codex_apply_patch_add_file_into_temp_is_denied():
    proc = run_hook(codex_apply_patch_payload(add_file_envelope("/tmp/leak.md")))
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_codex_apply_patch_update_file_into_temp_is_denied():
    body = (
        "*** Begin Patch\n"
        "*** Update File: /private/tmp/notes.md\n"
        "@@\n-old\n+new\n"
        "*** End Patch\n"
    )
    proc = run_hook(codex_apply_patch_payload(body))
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_codex_apply_patch_move_into_temp_is_denied(durable_path):
    body = (
        "*** Begin Patch\n"
        f"*** Update File: {durable_path}/notes.md\n"
        "*** Move to: /tmp/notes.md\n"
        "*** End Patch\n"
    )
    proc = run_hook(codex_apply_patch_payload(body), cwd=str(durable_path))
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_codex_apply_patch_delete_is_not_denied(durable_path):
    """Deletes have never been denied — `*** Delete File:` is left out of the
    header regex on purpose, and this pins that it stays out."""
    body = "*** Begin Patch\n*** Delete File: /tmp/stale.md\n*** End Patch\n"
    assert_allowed(
        run_hook(codex_apply_patch_payload(body), cwd=str(durable_path))
    )


def test_codex_apply_patch_durable_target_is_allowed(durable_path):
    proc = run_hook(
        codex_apply_patch_payload(add_file_envelope(f"{durable_path}/notes.md")),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


def test_codex_apply_patch_relative_path_resolves_against_payload_cwd():
    """A relative header under a temp `cwd` is joined and denied. Codex sends
    `cwd` on every hook payload (documented common input field)."""
    proc = run_hook(
        codex_apply_patch_payload(add_file_envelope("notes.md"), cwd="/private/tmp")
    )
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_codex_apply_patch_relative_path_under_durable_cwd_is_allowed(durable_path):
    proc = run_hook(
        codex_apply_patch_payload(
            add_file_envelope("notes.md"), cwd=str(durable_path)
        ),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


def test_codex_apply_patch_non_string_command_fails_closed(durable_path):
    """S04 was a validation error that ALLOWED. An unreadable envelope denies."""
    payload = codex_apply_patch_payload("")
    payload["tool_input"]["command"] = {"not": "a string"}
    proc = run_hook(payload, cwd=str(durable_path))
    assert_denied(proc, must_mention=("FAIL-CLOSED",))


# ── The refusal dialect all three harnesses have to read ─────────────────────


def _deny_payload():
    proc = run_hook(
        {
            "tool_name": "Bash",
            "tool_input": {"command": "printf x > /tmp/dialect.txt"},
            "session_id": "cross-agent-test",
        }
    )
    assert proc.returncode == 2, proc.stdout
    return json.loads(proc.stdout)


def test_deny_payload_carries_the_codex_dialect():
    """Codex reads `hookSpecificOutput.permissionDecision`, not `decision`."""
    payload = _deny_payload()
    specific = payload["hookSpecificOutput"]
    assert specific["hookEventName"] == "PreToolUse"
    assert specific["permissionDecision"] == "deny"


def test_deny_payload_reason_is_non_empty_for_codex():
    """Codex refuses a `deny` whose reason is empty — binary string:
    `PreToolUse hook returned permissionDecision:deny without a non-empty
    permissionDecisionReason`."""
    payload = _deny_payload()
    reason = payload["hookSpecificOutput"]["permissionDecisionReason"]
    assert isinstance(reason, str) and reason.strip()
    assert reason == payload["reason"], "both dialects must carry the same reason"


def test_deny_payload_keeps_the_legacy_dialect_for_cursor():
    """Measured: Cursor honours `{"decision": "block"}` + exit 2 — it echoed the
    payload back as `Rejected: {...}` and the write never happened. Dropping
    this half would silently unguard every Cursor pane."""
    payload = _deny_payload()
    assert payload["decision"] == "block"


def test_deny_payload_carries_no_codex_unsupported_fields():
    """`continue` / `stopReason` / `suppressOutput` are unsupported for
    PreToolUse in Codex; returning one marks the hook FAILED and lets the tool
    call proceed — a refusal that turns into an allow, which is exactly S04."""
    payload = _deny_payload()
    for field in ("continue", "stopReason", "suppressOutput"):
        assert field not in payload, f"{field} would make Codex ignore the deny"


def test_deny_payload_never_asks():
    """The two-valued contract, asserted on the new dialect too."""
    payload = _deny_payload()
    assert payload["hookSpecificOutput"]["permissionDecision"] != "ask"


def test_allow_payload_stays_bare(durable_path):
    """Codex treats exit 0 with no output as success; the allow must not start
    carrying a decision object that a harness might misread."""
    proc = run_hook(
        cursor_shell_payload(f"printf x > {durable_path}/ok.md"),
        cwd=str(durable_path),
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout or "{}") == {}


# ── The ledger has to name the pane that bypassed ────────────────────────────


def test_ledger_records_the_host_tool_name(tmp_path, durable_path):
    """A bypass audit that reports every pane as `Bash` cannot tell a Cursor
    route-around from a Claude one."""
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        cursor_shell_payload("printf x > /tmp/hatched.txt"),
        env_extra={"WEAVE_ALLOW_TMP": "1", "TMP_BLOCK_LEDGER": str(ledger)},
        cwd=str(durable_path),
    )
    assert proc.returncode == 0, proc.stdout
    entry = json.loads(ledger.read_text().strip().splitlines()[-1])
    assert entry["tool"] == "Shell", entry
    assert "/tmp/hatched.txt" in entry["command"], entry


def test_ledger_records_apply_patch_envelope(tmp_path, durable_path):
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        codex_apply_patch_payload(add_file_envelope("/tmp/hatched.md")),
        env_extra={"WEAVE_ALLOW_TMP": "1", "TMP_BLOCK_LEDGER": str(ledger)},
        cwd=str(durable_path),
    )
    assert proc.returncode == 0, proc.stdout
    entry = json.loads(ledger.read_text().strip().splitlines()[-1])
    assert entry["tool"] == "apply_patch", entry
    assert "/tmp/hatched.md" in entry["command"], entry
