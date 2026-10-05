"""Transport parity against the existing, shared pristine command corpus."""
import json
from unittest import mock
import io
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "scripts/hooks/codex-policy-hook.py"
LAUNCHER = ROOT / "scripts/hooks/fail-open.py"
TARGETS = {
    "tmp-block": "skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py",
    "git-guardian": "skills/golem-powers/git-guardian/hooks/pre_tool_use.py",
}


def clean_env():
    env = os.environ.copy()
    for key in ("CLAUDE_WORKER", "GIT_GUARDIAN_LIB", "WEAVE_ALLOW_TMP",
                "WEAVE_ALLOW_WT_MIGRATION", "TMP_BLOCK_LEDGER"):
        env.pop(key, None)
    env["TMP_BLOCK_LEDGER"] = str(ROOT / "docs.local/codex-hooks-port/test-ledger.jsonl")
    return env


def run(gate, payload, adapter=ADAPTER, cwd=ROOT, env=None, python=sys.executable):
    data = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run([python, str(adapter), gate], input=data,
                          capture_output=True, text=True, cwd=cwd,
                          env=env or clean_env(), timeout=12)


def payload(command, tool="Bash"):
    return {"tool_name": tool, "tool_input": {"command": command},
            "cwd": str(ROOT), "hook_event_name": "PreToolUse"}


def desynced_patch_cases(target):
    """Synthetic review classes; callers choose only fixture-owned targets."""
    cases = {
        'escaped_space_value': "X=$'\\'' Y=a\\ b apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'escaped_space_hash': "X=$'\\'' Y=\\ #z apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'brace_space_value': "X=$'\\'' Y=${z:-a b} apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'backtick_space_value': "X=$'\\'' Y=`echo a b` apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'line_continuation': "X=$'\\'' \\\napply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'ansic_newline': "X=$'\\'\n' apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'sq_newline_value': "X=$'\\'' Y='\n' apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'assign_prefixed_cd': "X=$'\\'' cd sub && apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'cd_then_assign_cd': "Y=1 cd sub && X=$'\\'' apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'redirect_before_name': "X=$'\\'' 2>/dev/null apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'locale_string': 'X=$"\\"" apply_patch <<\'EOF\'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF',
        'locale_plus_ansic': 'X=$"\'" X=$\'\\\'\' apply_patch <<\'EOF\'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF',
        'nested_dq_in_ansic': 'X=$\'"\\\'\' apply_patch <<\'EOF\'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF',
        'escaped_quote_bare': "X=\\' X=$'\\'' apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'unbalanced_paren_escaped': "X=$'\\'' Y=\\( apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'delim_with_paren': "Y=\\( X=$'\\'' apply_patch <<E\\)F\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nE)F",
        'hash_in_value': "X=$'\\'' Y=a#b apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'here_string_like': "X=$'\\'' Y=<<<a apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'array_index_assign': "X[$'\\'']=1 apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'array_nested': "X=(a $'\\'' (b)) apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'dq_cmdsub_quote': 'X="$(echo \\")" X=$\'\\\'\' apply_patch <<\'EOF\'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF',
        'two_desync': "X=$'\\'' X=(a) apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'tab_sep': "X=$'\\''\tapply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'cd_quoted_dir': "cd 'sub' && X=$'\\'' apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'cd_dq_space': 'cd "s b" && X=$\'\\\'\' apply_patch <<\'EOF\'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF',
        'delim_unquoted': "X=$'\\'' apply_patch <<EOF\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'delim_dash': "X=$'\\'' apply_patch <<-'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'dollar_sq_delim': "X=$'\\'' apply_patch <<$'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'value_with_semicolon_quoted': "X=$'\\'' Y=a';'b apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'crlf': "X=$'\\'' apply_patch <<'EOF'\r\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'leading_blank_line': "\nX=$'\\'' apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'leading_space': "   X=$'\\'' apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'cd_ansic_dir': "cd $'\\'' && apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'ansic_dq_mix': 'X=$\'a\'"$\'\\\'\'" apply_patch <<\'EOF\'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF',
        'backslash_newline_in_value': "X=$'\\''a\\\nb apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'process_sub_value': "X=$'\\'' Y=<(true) apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'bare_paren_value': "X=$'\\'' Y=a(b) apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'extglob_value': "X=$'\\'' Y=@(a|b) apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF",
        'quoted-delimiter-space': "X=$'\\'' apply_patch <<'E F'\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nE F",
        'concatenated-delimiter': 'X=$\'\\\'\' apply_patch <<E"O"F\n*** Begin Patch\n*** Add File: __TARGET__\n+x\n*** End Patch\nEOF',
    }
    return {name: command.replace("__TARGET__", target) for name, command in cases.items()}


class CodexPolicyHookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # These fixtures must also work in a fresh checkout with no ignored
        # docs.local scaffolding, including individually selected N1 probes.
        (ROOT / "docs.local/codex-hooks-port").mkdir(parents=True, exist_ok=True)

    def check(self, proc, deny):
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        output = result.get("hookSpecificOutput", {})
        self.assertEqual(output.get("permissionDecision") == "deny", deny)
        if deny:
            self.assertEqual(output["hookEventName"], "PreToolUse")
            self.assertTrue(output["permissionDecisionReason"])
        self.assertFalse(proc.stderr)
        return result

    def test_core_denials_and_allowed_commands(self):
        for gate, command, deny in [
            ("tmp-block", "printf x > /tmp/codex-policy-test.md", True),
            ("git-guardian", "git push --force origin main", True),
            ("tmp-block", "printf x > docs.local/result.md", False),
            ("git-guardian", "git status --short", False),
        ]:
            with self.subTest(gate=gate, command=command):
                self.check(run(gate, payload(command)), deny)

    def test_shared_corpus_parity(self):
        corpus = json.loads((ROOT / "scripts/tests/fixtures/pristine-harness/corpus.json").read_text())
        spec = importlib.util.spec_from_file_location("pristine_materializer", ROOT / "scripts/ci/pristine-harness.py")
        harness = importlib.util.module_from_spec(spec); spec.loader.exec_module(harness)
        counts = {}
        scratch = ROOT / "docs.local/codex-hooks-port/parity-fixture"
        shutil.rmtree(scratch, ignore_errors=True); scratch.mkdir(parents=True)
        harness.make_fixture(scratch)
        for gate, target in TARGETS.items():
            rows = []
            for x in corpus:
                if x["target"] != gate:
                    continue
                try:
                    p = json.loads(x["input"])
                except json.JSONDecodeError:
                    continue  # malformed transport is covered separately
                if isinstance(p, dict) and p.get("tool_name") == "Bash" and isinstance(p.get("tool_input", {}).get("command"), str):
                    rows.append(x)
            counts[gate] = len(rows)
            for row in rows:
                with self.subTest(gate=gate, case=row["id"]):
                    data = harness.materialize(row["input"], scratch)
                    cwd = harness.fixture_cwd(scratch, row["cwd"]) if row.get("cwd") else ROOT
                    p = json.loads(data); p["cwd"] = str(cwd); data = json.dumps(p)
                    env = clean_env(); env.update(harness.materialize(row.get("env", {}), scratch))
                    env["TMP_BLOCK_LEDGER"] = str(scratch / "ledger.jsonl")
                    original = subprocess.run([sys.executable, str(ROOT / target)],
                        input=data, capture_output=True, text=True,
                        env=env, cwd=cwd, timeout=8)
                    self.assertIn(original.returncode, (0, 2))
                    self.check(run(gate, data, cwd=cwd, env=env), original.returncode == 2)
        self.assertGreaterEqual(sum(counts.values()), 100)
        print("Codex parity corpus:", counts)

    def test_invalid_payloads_fail_closed_without_values(self):
        for value in ["bad-PRIVATE-VALUE", "[]", "{}", "null",
                      json.dumps(payload(123)), json.dumps(payload("x", "unknown"))]:
            with self.subTest(value=value):
                result = self.check(run("tmp-block", value), True)
                self.assertNotIn("PRIVATE-VALUE", json.dumps(result))

    def test_patch_projection_uses_existing_file_policy(self):
        for gate, path, deny in [
            ("tmp-block", "/tmp/codex-test.md", True),
            ("tmp-block", "docs.local/result.md", False),
            ("git-guardian", "credentials.json", True),
            ("git-guardian", "docs.local/result.md", False),
        ]:
            patch = f"*** Begin Patch\n*** Add File: {path}\n+x\n*** End Patch\n"
            self.check(run(gate, payload(patch, "apply_patch")), deny)
        for gate, path, deny in [("git-guardian", ".env", True), ("tmp-block", "/tmp/to-delete.txt", False)]:
            patch = f"*** Begin Patch\n*** Delete File: {path}\n*** End Patch\n"
            self.check(run(gate, payload(patch, "apply_patch")), deny)

    def test_bash_patch_envelopes_use_both_existing_policies(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            env = clean_env(); env["TMPDIR"] = scratch
            for gate, path in [("tmp-block", scratch + "/leak.md"), ("git-guardian", ".env")]:
                for alias in ("apply_patch", "applypatch"):
                    for indent in ("", "\t"):
                        patch = f"*** Begin Patch\n{indent}*** Add File: {path}\n+x\n*** End Patch"
                        forms = [f"{alias} <<'EOF'\n{patch}\nEOF\n",
                                 f"{alias} <<< '{patch}'",
                                 f"printf '%s\\n' '{patch}' | {alias}"]
                        for command in forms:
                            with self.subTest(gate=gate, command=command):
                                self.check(run(gate, payload(command), env=env), True)
            for target in (scratch, os.path.relpath(scratch, ROOT)):
                command = f"cd '{target}' && apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: relative.md\n+x\n*** End Patch\nEOF"
                self.check(run("tmp-block", payload(command), env=env), True)
            ordinary = "*** Begin Patch\n*** Add File: docs.local/ordinary.md\n+don't reinterpret this prose\n*** End Patch"
            for command in [f"apply_patch <<'EOF'\n{ordinary}\nEOF",
                            f"cd '{ROOT}' && apply_patch <<'EOF'\n{ordinary}\nEOF",
                            f'applypatch <<< "{ordinary}"',
                            f'printf "%s\\n" "{ordinary}" | apply_patch']:
                for gate in TARGETS:
                    self.check(run(gate, payload(command), env=env), False)
            p = payload(f"apply_patch <<'EOF'\n{ordinary}\nEOF"); del p["cwd"]
            for gate in TARGETS:
                self.check(run(gate, p, env=env), False)
            # Deletion keeps tmp-block's established allowance; guardian still
            # judges a sensitive delete using its existing Write projection.
            for gate, target, deny in [("tmp-block", scratch + "/old.md", False),
                                       ("git-guardian", ".env", True)]:
                command = f"apply_patch <<'EOF'\n*** Begin Patch\n*** Delete File: {target}\n*** End Patch\nEOF"
                self.check(run(gate, payload(command), env=env), deny)

    def test_opaque_bash_patch_transport_fails_closed_without_values(self):
        ordinary = "*** Begin Patch\n*** Add File: docs.local/ordinary.md\n+x\n*** End Patch"
        commands = [
            "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: .env\n+x\nEOF",
            "apply_patch <<< '*** Begin Patch\\n*** Add File: .env\\n+x\\n*** End Patch'",
            "printf '%b' '*** Begin P\\x61tch\\n*** Add File: .env\\n+x\\n*** End Patch' | apply_patch",
            "apply_patch <<< $'*** Begin P\\x61tch\\n*** Add File: .env\\n+x\\n*** End Patch'",
            f"cd $PRIVATE_VALUE && apply_patch <<'EOF'\n{ordinary}\nEOF",
            f"cd $(printf PRIVATE_VALUE) && apply_patch <<'EOF'\n{ordinary}\nEOF",
            f"printf x; cd docs.local && apply_patch <<'EOF'\n{ordinary}\nEOF",
            f"# PRIVATE_VALUE\ncd docs.local && apply_patch <<EOF\n{ordinary}\nEOF",
            f"command apply_patch <<'EOF'\n{ordinary}\nEOF",
            f"apply\\_patch <<'EOF'\n{ordinary}\nEOF",
            f"apply_patch <<EOF\n{ordinary}\nEOF\nprintf PRIVATE_VALUE",
            "printf '*** Begin Patch\n*** Add File: %s\n+x\n*** End Patch' .env | apply_patch",
            "apply_patch <<< '*** Begin Patch\n*** Add File: $PRIVATE_VALUE\n+x\n*** End Patch'",
            f"apply_patch <<'EOF'\n{ordinary}\nEOF\napplypatch <<'EOF'\n{ordinary}\nEOF",
        ]
        for gate in TARGETS:
            for command in commands:
                with self.subTest(gate=gate, command=command):
                    result = self.check(run(gate, payload(command)), True)
                    self.assertNotIn("PRIVATE_VALUE", json.dumps(result))

    def test_patch_mentions_in_data_remain_allowed(self):
        for alias in ("apply_patch", "applypatch"):
            commands = [
                f"cat > notes.md <<'EOF'\nExample for {alias}:\n*** Begin Patch\n*** Add File: a.md\n+a\n*** End Patch\nEOF",
                f"{alias} <<'EOF'\n*** Begin Patch\n*** Update File: docs.local/doc.md\n@@\n-old\n+mention {alias} here\n*** End Patch\nEOF",
                f"git commit -m 'docs: explain {alias} and *** Begin Patch markers'",
                f"python3 - <<'EOF'\nprint('{alias}')\nprint('*** Begin Patch')\nEOF",
            ]
            for gate in TARGETS:
                for command in commands:
                    with self.subTest(gate=gate, command=command):
                        self.check(run(gate, payload(command)), False)

    def test_bash_patch_prefix_parser_desync_is_refused(self):
        prefixes = {"ansi-c-escaped-quote": "X=$'\\'' ", "array-assignment": "X=(one) ",
                    "ansi-c-long-value": "X=$'prefix\\'suffix' ",
                    "array-spaces": "X=(one two) ", "array-append": "X+=(one) "}
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            env = clean_env(); env["TMPDIR"] = scratch
            for gate, target in (("tmp-block", str(Path(scratch) / "hidden.md")),
                                 ("git-guardian", ".env")):
                for name, prefix in prefixes.items():
                    for alias in ("apply_patch", "applypatch"):
                        for cd in ("", f"cd '{ROOT}' && "):
                            command = f"{cd}{prefix}{alias} <<'EOF'\n*** Begin Patch\n*** Add File: {target}\n+x\n*** End Patch\nEOF"
                            with self.subTest(gate=gate, prefix=name, alias=alias, cd=bool(cd)):
                                result = self.check(run(gate, payload(command), env=env), True)
                                reason = result["hookSpecificOutput"]["permissionDecisionReason"]
                                self.assertIn("native apply_patch", reason)
                                self.assertNotIn("unavailable", reason)

    def test_patch_head_mentions_in_first_line_data_remain_allowed(self):
        for alias in ("apply_patch", "applypatch"):
            commands = [
                f"git commit -m 'docs: {alias} <<EOF and *** Begin Patch markers'",
                f"printf '%s' '{alias} <<EOF' <<'DOC'\n*** Begin Patch\nDOC",
                f"X='{alias} <<EOF' cat <<'DOC'\n*** Begin Patch\nDOC",
                f"X=(one) printf '%s' '{alias} <<EOF' <<'DOC'\n*** Begin Patch\nDOC",
                f"cat <<'DOC' # explain {alias} <<EOF\n*** Begin Patch\nDOC",
                f"X=(one) echo {alias} <<'DOC'\n*** Begin Patch\nDOC",
                f"X=$'\\'' printf '%s' '{alias} <<EOF' <<'DOC'\n*** Begin Patch\nDOC",
            ]
            for gate in TARGETS:
                for command in commands:
                    with self.subTest(gate=gate, alias=alias, command=command):
                        self.check(run(gate, payload(command)), False)

    def test_escaped_cd_data_prefix_stays_allowed_within_budget(self):
        # A non-intercepted docs command must not exhaust the adapter deadline
        # while rejecting an unsupported cd shape with many escaped characters.
        command = "cd\t" + "\\!" * 28 + "; X=(one) echo apply_patch <<'DOC'\n*** Begin Patch\nDOC"
        for gate in TARGETS:
            with self.subTest(gate=gate):
                started = time.monotonic()
                self.check(run(gate, payload(command)), False)
                self.assertLess(time.monotonic() - started, 3)

    def test_composed_desync_patch_shapes_are_refused(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            cwd = Path(scratch) / "workspace"; cwd.mkdir()
            (cwd / "sub").mkdir(); (cwd / "s b").mkdir()
            tempdir = Path(scratch) / "temp-class"; tempdir.mkdir()
            env = clean_env(); env["TMPDIR"] = str(tempdir)
            for gate, target in (("tmp-block", str(tempdir / "hidden.md")),
                                 ("git-guardian", str(cwd / ".env"))):
                for name, command in desynced_patch_cases(target).items():
                    for alias in ("apply_patch", "applypatch"):
                        with self.subTest(gate=gate, shape=name, alias=alias):
                            p = payload(command.replace("apply_patch", alias)); p["cwd"] = str(cwd)
                            result = self.check(run(gate, p, env=env), True)
                            reason = result["hookSpecificOutput"]["permissionDecisionReason"]
                            self.assertIn("native apply_patch", reason)
                            self.assertNotIn("unavailable", reason)

    def test_desync_scan_reuses_parser_size_bound(self):
        command = "X=" + "(" * 100000 + "x" + ")" * 100000 + " apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: docs.local/note.md\n+x\n*** End Patch\nEOF"
        for gate in TARGETS:
            with self.subTest(gate=gate):
                started = time.monotonic()
                result = self.check(run(gate, payload(command)), True)
                self.assertLess(time.monotonic() - started, 3)
                self.assertIn("too large", result["hookSpecificOutput"]["permissionDecisionReason"])

    def test_complete_patch_data_cost_and_controls(self):
        patch = "*** Begin Patch\n*** Add File: docs.local/note.md\n+x\n*** End Patch"
        for alias in ("apply_patch", "applypatch"):
            for gate in TARGETS:
                for label, command, deny in [
                    ("head-mention-complete-body", f"printf '%s' '{alias}' <<'DOC'\n{patch}\nDOC", True),
                    ("complete-body-no-head-mention", f"cat <<'DOC'\n{patch}\nDOC", False),
                    ("body-mention-only", f"cat <<'DOC'\n{patch.replace('+x', '+' + alias)}\nDOC", False),
                    ("complete-patch-after-prose", f"printf '%s' '{alias}' <<'DOC'\nExample text\n{patch}\nDOC", False),
                ]:
                    with self.subTest(gate=gate, alias=alias, shape=label):
                        result = self.check(run(gate, payload(command)), deny)
                        if deny: self.assertIn("native apply_patch", result["hookSpecificOutput"]["permissionDecisionReason"])

    def test_lenient_patch_body_framing_is_refused(self):
        patch = "*** Begin Patch\n*** Add File: docs.local/example.md\n+x\n*** End Patch"
        # Safe data heads exercise the accepted-cost boundary without publishing
        # a working tokenizer-desync spelling. Live cases stay in private fixtures.
        for opener in ("<<EOF", "<<'EOF'", '<<"EOF"'):
            for closer in ("EOF", "suffixEOF"):
                for padding in ("", " \t"):
                    body = f"{padding}{opener}\n{patch}\n{closer}{padding}"
                    for alias in ("apply_patch", "applypatch"):
                        command = f"printf '%s' '{alias}' <<'DOC'\n{body}\nDOC"
                        for gate in TARGETS:
                            with self.subTest(opener=opener, closer=closer, padding=padding, alias=alias, gate=gate):
                                result = self.check(run(gate, payload(command)), True)
                                self.assertIn("native apply_patch", result["hookSpecificOutput"]["permissionDecisionReason"])
        for body in (f"<<OTHER\n{patch}\nEOF", f"<<EOF\n{patch}\nOTHER",
                     f"<<EOF\n\n{patch}\nEOF", f"<<EOF\n{patch}\n\nEOF",
                     f"Example text\n{patch}\nEOF"):
            for gate in TARGETS:
                self.check(run(gate, payload(f"printf '%s' 'apply_patch' <<'DOC'\n{body}\nDOC")), False)
        for gate in TARGETS:
            self.check(run(gate, payload(f"cat <<'DOC'\n<<EOF\n{patch}\nEOF\nDOC")), False)

    def test_invalid_lenient_wrapper_opening_stays_allowed(self):
        patch = "*** Begin Patch\n*** Add File: docs.local/example.md\n+x\n*** End Patch"
        for alias in ("apply_patch", "applypatch"):
            for gate in TARGETS:
                with self.subTest(alias=alias, gate=gate):
                    command = f"printf '%s' '{alias}' <<'DOC'\n<<EOF \n{patch}\nEOF\nDOC"
                    self.check(run(gate, payload(command)), False)

    def test_transport_refusal_and_adapter_failure_have_distinct_reasons(self):
        patch = "*** Begin Patch\n*** Add File: docs.local/ordinary.md\n+x\n*** End Patch"
        for gate in TARGETS:
            for command in ("apply_patch <<'EOF'\n*** Begin Patch\nEOF",
                            f"cd $PRIVATE_VALUE && apply_patch <<'EOF'\n{patch}\nEOF"):
                result = self.check(run(gate, payload(command)), True)
                reason = result["hookSpecificOutput"]["permissionDecisionReason"]
                self.assertIn("native apply_patch", reason)
                self.assertNotIn("unavailable", reason)
                self.assertNotIn("install-hooks.sh", reason)
                self.assertNotIn("PRIVATE_VALUE", reason)
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            adapter = Path(scratch) / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter); shutil.copyfile(LAUNCHER, adapter.with_name("fail-open.py"))
            # An actual missing parser is an installation/runtime failure.
            result = self.check(run("tmp-block", payload(f"apply_patch <<'EOF'\n{patch}\nEOF"), adapter), True)
            reason = result["hookSpecificOutput"]["permissionDecisionReason"]
            self.assertIn("unavailable", reason)
            self.assertIn("install-hooks.sh", reason)

    def test_missing_broken_malformed_and_timed_out_gate_fail_closed(self):
        (ROOT / "docs.local").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch)
            adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True)
            shutil.copyfile(ADAPTER, adapter); shutil.copyfile(LAUNCHER, adapter.with_name("fail-open.py"))
            hook = base / TARGETS["tmp-block"]
            hook.parent.mkdir(parents=True)
            bodies = [None, "broken syntax PRIVATE-VALUE", "raise RuntimeError('PRIVATE-VALUE')",
                      "print('{}'); raise SystemExit(1)", "print('{}'); raise SystemExit(3)",
                      "print('PRIVATE-VALUE')", "print('null')", "print('{}'); raise SystemExit(2)",
                      "print(''); raise SystemExit(0)", "import time; time.sleep(10)",
                      "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time; time.sleep(10)']); time.sleep(10)"]
            for body in bodies:
                with self.subTest(body=body):
                    if body is not None:
                        hook.write_text(body)
                    result = self.check(run("tmp-block", payload("pwd"), adapter), True)
                self.assertNotIn("PRIVATE-VALUE", json.dumps(result))

    def test_indented_patch_headers_use_shared_policy(self):
        for prefix in ("", "  ", "\t", " \t ", "\u2003", "\r"):
            for verb in ("Add File", "Update File", "Move to", "Delete File"):
                for gate, path in [("tmp-block", "/tmp/indent.md"), ("git-guardian", ".env")]:
                    with self.subTest(prefix=prefix, verb=verb, gate=gate):
                        patch = f"*** Begin Patch\n{prefix}*** {verb}: {path}  \n+x\n*** End Patch\n"
                        p = payload(patch, "apply_patch")
                        deny = gate == "git-guardian" or verb != "Delete File"
                        self.check(run(gate, p), deny)
                        if gate == "tmp-block":
                            original = subprocess.run([sys.executable, str(ROOT / TARGETS[gate])],
                                input=json.dumps(p), capture_output=True, text=True, env=clean_env())
                            self.assertEqual(original.returncode == 2, deny)
                allowed = f"*** Begin Patch\n{prefix}*** {verb}: docs.local/ok.md\n+x\n*** End Patch\n"
                for gate in TARGETS:
                    self.check(run(gate, payload(allowed, "apply_patch")), False)

    def test_guardian_library_override_cannot_replace_pinned_policy(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            lib = Path(scratch)
            (lib / "git_safety.py").write_text(
                "from contextlib import nullcontext\n"
                "class PolicyEvaluationDeadlineExceeded(Exception): pass\n"
                "policy_evaluation_deadline = nullcontext\n"
                "cancel_policy_evaluation_deadline = lambda: None\n"
                "dangerous_shell_reason = lambda text: None\n"
                "policy_command_size_reason = lambda text: None\n"
                "shell_text_without_heredoc_bodies = lambda text: text\n")
            env = clean_env(); env["GIT_GUARDIAN_LIB"] = str(lib)
            p = payload("git push --force origin main")
            original = subprocess.run([sys.executable, str(ROOT / TARGETS["git-guardian"])],
                input=json.dumps(p), capture_output=True, text=True, env=env)
            self.assertEqual(original.returncode, 0, "permissive override control was invalid")
            self.check(run("git-guardian", p, env=env), True)

    def test_payload_temp_cwd_overrides_process_cwd(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            env = clean_env(); env["TMPDIR"] = scratch
            p = payload("printf x > relative.md"); p["cwd"] = scratch
            self.check(run("tmp-block", p, cwd=ROOT, env=env), True)
            p["cwd"] = str(ROOT)
            self.check(run("tmp-block", p, cwd=ROOT, env=env), False)

    def test_gate_stderr_on_allow_is_static_denial(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch); adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter); shutil.copyfile(LAUNCHER, adapter.with_name("fail-open.py"))
            hook = base / TARGETS["tmp-block"]; hook.parent.mkdir(parents=True)
            hook.write_text("import sys; print('{}'); print('PRIVATE-VALUE', file=sys.stderr)")
            result = self.check(run("tmp-block", payload("pwd"), adapter), True)
            self.assertNotIn("PRIVATE-VALUE", json.dumps(result))

    def test_large_patch_and_last_sensitive_target(self):
        patch = "*** Begin Patch\n" + "".join(
            f"*** Add File: docs.local/allowed-{i}.md\n+x\n" for i in range(64)) + "*** End Patch\n"
        self.check(run("git-guardian", payload(patch, "apply_patch")), False)
        self.check(run("git-guardian", payload(patch.replace("allowed-63.md", "../../../.env"), "apply_patch")), True)
        too_many = patch.replace("*** End Patch", "*** Add File: docs.local/allowed-64.md\n+x\n*** End Patch")
        result = self.check(run("git-guardian", payload(too_many, "apply_patch")), True)
        self.assertIn("split the patch", result["hookSpecificOutput"]["permissionDecisionReason"])
        repeated = "*** Begin Patch\n" + "*** Update File: docs.local/ok.md\n+x\n" * 128 + "*** End Patch\n"
        self.check(run("git-guardian", payload(repeated, "apply_patch")), False)

    def test_timeout_has_split_hint_without_reinstall(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch); adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter); shutil.copyfile(LAUNCHER, adapter.with_name("fail-open.py"))
            hook = base / TARGETS["tmp-block"]; hook.parent.mkdir(parents=True)
            hook.write_text("import time; time.sleep(20)")
            result = self.check(run("tmp-block", payload("pwd"), adapter), True)
            reason = result["hookSpecificOutput"]["permissionDecisionReason"]
            self.assertIn("split the patch", reason)
            self.assertNotIn("reinstall", reason.lower())

    def test_guardian_batch_preserves_worker_and_symlink_cwd(self):
        patch = "*** Begin Patch\n*** Add File: .env\n+x\n*** End Patch\n"
        env = clean_env(); env["CLAUDE_WORKER"] = "1"
        self.check(run("git-guardian", payload(patch, "apply_patch"), env=env), False)
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            link = Path(scratch) / "cwd"; link.symlink_to(ROOT, target_is_directory=True)
            p = payload(patch, "apply_patch"); p["cwd"] = str(link)
            self.check(run("git-guardian", p), True)
            p["tool_input"]["command"] = patch.replace(".env", "docs.local/allowed.md")
            self.check(run("git-guardian", p), False)

    def test_guardian_batch_accepts_case_variant_cwd(self):
        variant = str(ROOT).swapcase()
        if not os.path.isdir(variant) or not os.path.samefile(variant, ROOT):
            self.skipTest("fixture requires a case-insensitive filesystem")
        patch = "*** Begin Patch\n*** Add File: docs.local/allowed.md\n+x\n*** End Patch\n"
        for wrapped in (False, True):
            command = f"cd '{variant}' && apply_patch <<'EOF'\n{patch}EOF" if wrapped else patch
            p = payload(command, "Bash" if wrapped else "apply_patch")
            p["cwd"] = variant
            with self.subTest(wrapped=wrapped):
                self.check(run("git-guardian", p), False)
                p["tool_input"]["command"] = command.replace("docs.local/allowed.md", ".env")
                self.check(run("git-guardian", p), True)

    def test_guardian_batch_rejects_different_cwd_identity(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            for cwd in (scratch, str(Path(scratch) / "missing")):
                item = {"tool_name": "Write", "cwd": cwd,
                        "tool_input": {"file_path": "docs.local/allowed.md"}}
                with self.subTest(cwd=cwd):
                    result = self.check(run("--guardian-batch", [item]), True)
                    self.assertIn("unavailable", result["hookSpecificOutput"]["permissionDecisionReason"])

    def test_patch_policy_process_count_is_bounded(self):
        patch = "*** Begin Patch\n" + "".join(
            f"*** Add File: docs.local/allowed-{i}.md\n+x\n" for i in range(64)) + "*** End Patch\n"
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch)
            counter = base / "python-starts.txt"
            # Policy children run -I (PYTHONPATH ignored), so count starts with a
            # sitecustomize in a throwaway venv's site-packages, which -I keeps.
            venv = base / "venv"
            subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(venv)], check=True)
            python = str(venv / "bin/python3")
            purelib = subprocess.run([python, "-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"],
                                     capture_output=True, text=True, check=True).stdout.strip()
            (Path(purelib) / "sitecustomize.py").write_text(
                "import os,time\n"
                "with open(os.environ['CODEX_TEST_START_COUNTER'], 'a') as starts:\n"
                "    starts.write(str(os.getpid()) + '\\n')\n"
                "time.sleep(0.11)\n")
            env = clean_env()
            env["CODEX_TEST_START_COUNTER"] = str(counter)
            for gate in TARGETS:
                for wrapped in (False, True):
                    for sensitive in (False, True):
                        body = patch.replace("allowed-63.md", "../../../.env") if sensitive else patch
                        command = f"apply_patch <<'EOF'\n{body}EOF" if wrapped else body
                        counter.write_text("")
                        started = time.monotonic()
                        proc = run(gate, payload(command, "Bash" if wrapped else "apply_patch"), env=env, python=python)
                        starts = counter.read_text().splitlines()
                        elapsed = time.monotonic() - started
                        with self.subTest(gate=gate, wrapped=wrapped, sensitive=sensitive):
                            self.check(proc, sensitive and gate == "git-guardian")
                            # Count the adapter itself and every Python descendant.
                            self.assertEqual(len(starts), 3 if wrapped else 2)
                            self.assertEqual(len(set(starts)), len(starts))
                            print("Delayed Python starts:", gate, wrapped, sensitive,
                                  len(starts), round(elapsed, 3))

    def test_guardian_batch_runtime_failures_fail_closed(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch); adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter); shutil.copyfile(LAUNCHER, adapter.with_name("fail-open.py"))
            relative = "skills/golem-powers/tmp-block/hooks/tmp_block_impl/tool_targets.py"
            parser = base / relative; parser.parent.mkdir(parents=True)
            shutil.copyfile(ROOT / relative, parser)
            hook = base / TARGETS["git-guardian"]; hook.parent.mkdir(parents=True)
            bodies = ["print('{}'); raise SystemExit(1)",
                      "print('{}'); print('PRIVATE-VALUE', file=sys.stderr); raise SystemExit(0)",
                      "print('{}')", "raise RuntimeError('PRIVATE-VALUE')", "time.sleep(10)"]
            patch = "*** Begin Patch\n*** Add File: docs.local/allowed.md\n+x\n*** End Patch\n"
            for body in bodies:
                with self.subTest(body=body):
                    hook.write_text("import sys,time\ndef main():\n    " + body + "\n")
                    result = self.check(run("git-guardian", payload(patch, "apply_patch"), adapter), True)
                    self.assertNotIn("PRIVATE-VALUE", json.dumps(result))
                    reason = result["hookSpecificOutput"]["permissionDecisionReason"]
                    self.assertIn("split the patch" if body == "time.sleep(10)" else "unavailable", reason)
                    self.assertNotIn("native apply_patch", reason)

    def test_payload_cwd_reaches_both_policies(self):
        p = payload("git worktree add /workspace/sibling/x HEAD")
        self.check(run("tmp-block", p), True)
        p["cwd"] = "/missing-PRIVATE-VALUE/cwd"
        result = self.check(run("tmp-block", p), True)
        self.assertNotIn("PRIVATE-VALUE", json.dumps(result))

    def test_timeout_stops_descendant_effects(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch)
            adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter); shutil.copyfile(LAUNCHER, adapter.with_name("fail-open.py"))
            marker = base / "late-effect.txt"
            child = f"import time; from pathlib import Path; time.sleep(8); Path({str(marker)!r}).write_text('late')"
            hook = base / TARGETS["tmp-block"]; hook.parent.mkdir(parents=True)
            hook.write_text(f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child!r}]); time.sleep(10)")
            self.check(run("tmp-block", payload("pwd"), adapter), True)
            # Past the descendant's eight-second effect even with the child's
            # six-second deadline; a kill-parent-only mutation must be caught.
            time.sleep(2.5)
            self.assertFalse(marker.exists(), "timed-out gate descendant survived")

    def test_corrupt_patch_parser_cannot_contaminate_denial(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch); adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter); shutil.copyfile(LAUNCHER, adapter.with_name("fail-open.py"))
            module = base / "skills/golem-powers/tmp-block/hooks/tmp_block_impl/tool_targets.py"
            module.parent.mkdir(parents=True)
            module.write_text("print('PRIVATE-VALUE'); raise RuntimeError('PRIVATE-VALUE')")
            result = self.check(run("git-guardian", payload("*** Begin Patch\n*** End Patch", "apply_patch"), adapter), True)
            self.assertNotIn("PRIVATE-VALUE", json.dumps(result))


class ChildIsolation(unittest.TestCase):
    def launched(self, gate, data):
        spec = importlib.util.spec_from_file_location("codex_adapter_under_test", ADAPTER)
        adapter = importlib.util.module_from_spec(spec); spec.loader.exec_module(adapter)
        launched = []

        class Recorder:
            def __init__(self, argv, **kwargs):
                launched.append(argv); self.args = argv; self.pid = os.getpid(); self.returncode = 0
            def communicate(self, data, timeout=None):
                return '{}', ''
            def wait(self):
                return 0
        with mock.patch.object(adapter.subprocess, "Popen", Recorder), \
             mock.patch.object(adapter.os, "killpg"), \
             mock.patch.object(adapter.sys, "argv", ["adapter", gate]), \
             mock.patch.object(adapter.sys, "stdin", io.StringIO(json.dumps(data))):
            adapter.evaluate()
        return launched

    def test_policy_children_run_through_the_launcher_isolated(self):
        """Each policy child gets the launcher's hardening: -I -B, preload, hook dir last."""
        launcher = str(ROOT / "scripts/hooks/fail-open.py")
        for gate in TARGETS:
            launched = self.launched(gate, payload("ls"))
            self.assertTrue(launched)
            for argv in launched:
                self.assertEqual(argv[1:4], ["-I", "-B", launcher])

    def test_guardian_batch_self_call_is_isolated(self):
        """apply_patch under git-guardian re-enters the adapter: that child is -I -B too."""
        patch = "*** Begin Patch\n*** Add File: docs.local/allowed.md\n+x\n*** End Patch\n"
        launched = self.launched("git-guardian", payload(patch, "apply_patch"))
        batch = [argv for argv in launched if argv[-1] == "--guardian-batch"]
        self.assertEqual(len(batch), 1)
        self.assertEqual(batch[0][1:], ["-I", "-B", str(ADAPTER.resolve()), "--guardian-batch"])


if __name__ == "__main__":
    unittest.main()
