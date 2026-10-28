#!/usr/bin/env python3
"""SEC1 pre-write policy. Only paths enter decisions; file contents are never read."""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != _HERE] + [_HERE]

from contextlib import redirect_stderr, redirect_stdout
from fnmatch import fnmatchcase
import importlib.util
from io import StringIO
import json
from pathlib import Path
import shutil
import subprocess

RULE = "secrets go outside repos, e.g. ~/.config/<tool>/, or to a gitignored path; never committed"
PATTERNS = (".env*", "*.pem", "*.key", "*credentials*", "*secret*", "id_rsa*", "*.p12")


class UnguardedPath(Exception):
    """Only this exception may carry a target path into the refusal."""


def secret_like(path):
    name = Path(path).name.lower()
    return name not in (".env.example", ".env.sample") and any(fnmatchcase(name, p) for p in PATTERNS)


def check_target(raw, cwd):
    if not isinstance(raw, str) or not raw or "\x00" in raw:
        raise ValueError("invalid path")
    target = Path(raw).expanduser()
    if not target.is_absolute():
        target = cwd / target
    try:
        target = target.resolve(strict=True)
    except FileNotFoundError:
        target = target.resolve()  # Permit missing leaves and dangling symlinks only.
    if not (secret_like(raw) or secret_like(target)):
        return
    git = shutil.which("git")
    if git is None:
        raise ValueError("git unavailable")
    # Discover by physical ancestors, so an ordinary non-repo is distinguishable
    # from a failed rev-parse. Never interpret arbitrary Git stderr as "outside".
    parent = target.parent
    while True:
        try:
            parent.stat()
            break
        except FileNotFoundError:
            parent = parent.parent
    for ancestor in (parent, *parent.parents):
        try:
            (ancestor / ".git").lstat()
        except FileNotFoundError:
            continue
        break
    else:
        return
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    args = [git, "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", str(parent)]
    root = subprocess.run([*args, "rev-parse", "--show-toplevel"], env=env,
                          capture_output=True, text=True, timeout=1)
    if root.returncode:
        raise ValueError("git discovery failed")
    repo = Path(root.stdout.rstrip("\n")).resolve()
    relative = target.relative_to(repo)
    ignored = subprocess.run([git, "--no-optional-locks", "-c", "core.fsmonitor=false",
                              "-C", str(repo), "check-ignore", "-q", "--", str(relative)],
                             env=env, capture_output=True, timeout=1)
    if ignored.returncode != 0:
        raise UnguardedPath(str(target))


def shell_targets(parser, command, cwd, budget):
    """Use tmp-block's shared parser, cwd/variable resolver and executable bodies."""
    budget[0] -= len(command) + 1
    if budget[0] < 0 or parser._UNRESOLVED_EVAL_MARKER in command:
        raise ValueError("shell analysis exhausted")
    from shell_parse import shell_code_reading
    with shell_code_reading(command):
        direct = parser._mask_function_definition_bodies(command)
        tokens, positions, segments, scopes = parser._parse_bash(parser._mask_quoted_operator_words(direct))

        def anchor(index):
            variables = parser._static_shell_variables_before(tokens, positions, segments, scopes, segments[index])
            environment = [os.environ.get(m.group(1) or m.group(2), "")
                           for token in tokens for m in parser._SIMPLE_VAR_RE.finditer(token)]
            # cd -P and symlinks make lexical parent traversal unsafe to guess.
            if any(".." in value.split("/") for value in [*tokens, *environment, *(v for v in variables.values() if v)]):
                raise ValueError("parent traversal needs a literal physical path")
            base = parser._shell_anchor_before(tokens, positions, segments, scopes,
                                                segments[index], scopes[index], str(cwd), variables)
            return base, variables

        indices = []
        for i, token in enumerate(tokens):
            if token in (">", ">>"):
                j = i + 1
                if j >= len(tokens):
                    raise ValueError("missing redirect target")
                if tokens[j] == "&":
                    j += 1
                    if j >= len(tokens):
                        raise ValueError("missing redirect target")
                    if tokens[j].isdigit() or tokens[j] == "-":
                        continue
                if tokens[j] in ("<", ">", "("):
                    continue  # Process substitution's inner command owns its file.
                indices.append(j)
            if positions[i] and Path(token).name == "tee":
                options = True
                for j in range(i + 1, len(tokens)):
                    if scopes[j] != scopes[i]:
                        continue
                    if tokens[j] in (";", "|", "&", ">", ">>", "(", ")"):
                        break
                    if options and tokens[j] == "--":
                        options = False
                    elif not options or not tokens[j].startswith("-"):
                        indices.append(j)
        for i in dict.fromkeys(indices):
            base, variables = anchor(i)
            values = parser._bounded_compound_value_sets_before(tokens, positions, segments, scopes, i, variables)
            for target in parser._bounded_word_values(tokens[i], variables, values):
                check_target(target, Path(base))
        bodies = [(body, seg) for body, seg, *_ in parser._executable_subcommands(parser._strip_heredoc_bodies(direct))]
        bodies += [(body, seg) for body, seg, *_ in parser._shell_command_payloads(tokens, positions, segments)]
        bodies += [(body, seg) for body, seg, *_ in parser._invoked_alias_bodies(command)]
        for body, seg in bodies:
            base, _ = anchor(segments.index(seg))
            shell_targets(parser, body, Path(base), budget)


def main():
    # Loading the existing tmp-block facade also loads and origin-checks
    # _shared/shell_parse.py. Capture dependency output, even on import failure.
    hook = Path(__file__).resolve().parents[2] / "tmp-block/hooks/tmp-block-pretooluse.py"
    with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
        spec = importlib.util.spec_from_file_location("sec1_shell_helpers", hook)
        parser = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(parser)
    raw = sys.stdin.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("payload too large")
    payload = json.loads(raw)
    tool, ti = payload["tool_name"], payload["tool_input"]
    cwd = Path(payload.get("cwd", os.getcwd())).resolve(strict=True)
    if not cwd.is_dir() or not isinstance(ti, dict) or not isinstance(tool, str) or not tool:
        raise ValueError("invalid envelope")
    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        check_target(ti.get("file_path") or ti.get("notebook_path"), cwd)
    elif tool == "apply_patch":
        command = ti["command"]
        for match in parser._APPLY_PATCH_TARGET_RE.finditer(command):
            check_target(match.group(2), cwd)
    elif tool in ("Bash", "Shell"):
        command = ti["command"]
        if parser.policy_command_size_reason(command):
            raise ValueError("command too large")
        with parser.policy_evaluation_deadline():
            for reading in parser.ansi_c_readings(command):
                with parser.ansi_c_reading(reading):
                    parser.evaluate_shell_readings(lambda: shell_targets(parser, command, cwd, [65536]))


if __name__ == "__main__":
    try:
        main()
        result, code = {}, 0
    except BaseException as exc:
        # Only intentional path refusals contain variable data. Exception text
        # may carry command contents or subprocess stderr and is never emitted.
        path = str(exc) if isinstance(exc, UnguardedPath) else "unresolved target/policy error"
        reason = f"SECRET-WRITE-GUARD: {path}: {RULE} (gitignored BEFORE the write, fail closed)."
        result, code = {"decision": "block", "reason": reason, "hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}, 2
    print(json.dumps(result))
    sys.exit(code)
