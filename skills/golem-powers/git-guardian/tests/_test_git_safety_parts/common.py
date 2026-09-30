from pathlib import Path as _PartsPath
__file__ = str(_PartsPath(__file__).resolve().parent.parent / 'test_git_safety.py')

"""RED→GREEN replay fixtures for git-guardian's mechanical checks (gen-18 Track 6 D6).

Each RED case is a footgun the rule must catch; each GREEN case is a safe operation the
rule must NOT block (the false-positive gate). Pure functions → fully deterministic.
"""


import importlib.util


import inspect


import os


import shlex


import shutil


import subprocess


import sys


from pathlib import Path


MODULE = Path(__file__).resolve().parent.parent / "git_safety.py"


spec = importlib.util.spec_from_file_location("git_safety", MODULE)


git_safety = importlib.util.module_from_spec(spec)


sys.modules["git_safety"] = git_safety


spec.loader.exec_module(git_safety)


def _copied_guardian(tmp_path, name):
    copied = tmp_path / name / "git-guardian"
    shutil.copytree(MODULE.parent, copied, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(MODULE.parent.parent / "_shared", copied.parent / "_shared")
    return copied


def _load_at(name, path):
    loaded_spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(loaded_spec)
    loaded_spec.loader.exec_module(module)
    return module


# ── W16: nested repo roots + unexpanded-variable targets ──────────────────────────
# RED specimens from backlog/golems.md #17 (3rd recurrence) and the W13 lane. Each was
# a FALSE BLOCK: a safe scratch delete the guard refused, which is how agents learn to
# route around the guard entirely.


def _nested_scratch_repo(tmp_path):
    """outer repo → .worktrees/<wt> (gitfile) → scratch/ (its own .git dir).

    Mirrors the W13 shape: a throwaway fixture repo the agent created several levels
    down inside a worktree of the repo it is working in.
    """
    outer = tmp_path / "outer"
    (outer / ".git").mkdir(parents=True)
    worktree = outer / ".worktrees" / "w13-docs-local-burndown"
    worktree.mkdir(parents=True)
    (worktree / ".git").write_text("gitdir: ../../.git/worktrees/w13\n")
    scratch = worktree / ".rmcached-proof"
    (scratch / ".git").mkdir(parents=True)
    (scratch / "docs.local").mkdir()
    return outer, worktree, scratch


# ── GO-5 PR-4: text-grep false positives → parse ───────────────────────────────
# pre_tool_use.py runs its SQL and credential regexes over
# shell_text_without_heredoc_bodies(), so these pin what that text keeps.

def _harness_scratchpad(tmp_path, monkeypatch):
    # The harness scratchpad shape directly under a temp root; TMPDIR makes
    # tmp_path a temp root for the structural check.
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    pad = tmp_path / "claude-501" / "-Users-x-Gits-golems" / "f5dda6e0-2c6f-4cc9-8394-e7752be953e5" / "scratchpad"
    pad.mkdir(parents=True)
    return pad


# ── GO-5 guard gaps (r7 on #222): forms that execute text, never blocked on master ──
# Each is a TIGHTENING, so every rule has a false-positive guard next to it.

GAP_MUST_BLOCK = (
    'echo "done: $(rm -rf ~)"',                      # $() inside double quotes runs
    'git commit -m "wip $(rm -rf ~)"',
    "eval 'rm -rf ~'",
    'eval "rm -rf ~"',
    "echo 'rm -rf ~' | sh",                          # data piped into a shell runs
    "printf 'rm -rf ~\\n' | bash",
    "sh <(echo 'rm -rf ~')",                         # a process substitution as the script
    "bash <(printf 'git push --force origin main')",
    "git -c alias.x='!rm -rf ~' x",                  # a `!` alias is a shell command
    "python3 - <<'PY' | sh\nprint('rm -rf ~')\nPY",  # interpreter output piped into a shell
)


GAP_MUST_ALLOW = (
    "echo 'rm -rf ~ is dangerous' >> notes.md",
    'echo "today: $(date)"',
    'eval "$(ssh-agent -s)"',
    "echo 'ls -la' | sh",
    "git -c alias.st=status st",
    "git -c core.editor=vim commit",
    "sh <(echo 'ls')",
    "python3 - <<'PY'\nprint('rm -rf ~')\nPY",
    "echo 'rm -rf ~' | grep rm",
    "echo 'rm -rf ~' | wc -l",                        # a non-shell reader with only flags
    "grep -n '$(rm -rf ~)' notes.md",                # single quotes stop $() (and grep is not data)
    "eval",
)


def _home_env():
    return {"HOME": os.path.expanduser("~")}


def _nested_wrapper(kind, depth, tail):
    if kind in {"sudo", "nice", "xargs"}:
        return f"{kind} " * depth + tail
    if kind == "env":
        return "env A=1 " * depth + tail
    if kind == "env-unset":
        return "env -u X " * depth + tail
    if kind == "time-posix":
        return "time -p " * depth + tail
    if kind in {"command", "exec", "nohup", "builtin"}:
        return f"{kind} " * depth + tail
    if kind == "env-split":
        return "env -S " * depth + tail
    if kind == "find-exec":
        return "find . -exec " * depth + tail + " {} +" * depth
    if kind == "mixed":
        prefixes = ("sudo ", "nice ", "xargs ", "find . -exec ")
        command = "".join(prefixes[index % len(prefixes)] for index in range(depth)) + tail
        return command + " {} +" * sum(index % len(prefixes) == 3 for index in range(depth))
    raise AssertionError(kind)


# GO-5 (r7 on #233): markdown code spans in a PR body / commit recipe written
# as "$(cat <<'EOF' … EOF)" are prose. The quoted heredoc inside the $() runs
# nothing, so its backticks must not be read as command substitutions.
def _body_recipe(span, quoted=True):
    delim = "'EOF'" if quoted else "EOF"
    return f'gh pr create --title t --body "$(cat <<{delim}\nNever run `{span}` here.\nEOF\n)"'


__all__ = [name for name in globals() if not name.startswith("__") and name != "_PartsPath"]
