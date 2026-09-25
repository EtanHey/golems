"""block-dangerous-commands.py (GO-5 E2): the style rules are gone, the safety rules stay.

hooks-audit: `^npm (install|run|…)` blocked `npm run smoke:gate`, which
skill-creator/AGENTS.md instructs; `python`/`-uall` were style, not safety.
Kept: git push/commit on main/master, Supabase DDL via execute_sql, the
Chrome/Brave browser law, and the Kilo directory block.
"""

import json
import os
import subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parents[2] / ".claude" / "hooks" / "block-dangerous-commands.py"


def _repo(tmp_path, branch):
    repo = tmp_path / "repo"
    repo.mkdir()
    env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}
    subprocess.run(["git", "init", "-q", "-b", branch], cwd=repo, env=env, check=True)
    return repo


def _run(repo, tool_name, tool_input):
    env = {k: v for k, v in os.environ.items() if k not in ("AUTONOMOUS", "CLAUDE_WORKER")}
    return subprocess.run(
        ["python3", str(HOOK)],
        input=json.dumps({"tool_name": tool_name, "tool_input": tool_input}),
        capture_output=True, text=True, cwd=repo, env=env, check=False,
    )


def test_style_rules_no_longer_block(tmp_path):
    repo = _repo(tmp_path, "feature")
    for command in ("npm run smoke:gate", "npm install", "python script.py", "python", "git status -uall"):
        result = _run(repo, "Bash", {"command": command})
        assert result.returncode == 0, (command, result.stdout)


def test_safety_rules_still_block(tmp_path):
    main = _repo(tmp_path, "main")
    for tool_name, tool_input in (
        ("Bash", {"command": "git push origin main"}),
        ("Bash", {"command": "git commit -m x"}),
        ("Bash", {"command": "open -a 'Google Chrome' https://example.com"}),
        ("mcp__supabase__execute_sql", {"sql": "ALTER TABLE t ADD COLUMN c int"}),
    ):
        result = _run(main, tool_name, tool_input)
        assert result.returncode == 2, (tool_input, result.stdout)
        assert json.loads(result.stdout)["decision"] == "block"


def test_feature_branch_push_is_allowed(tmp_path):
    repo = _repo(tmp_path, "feature")
    assert _run(repo, "Bash", {"command": "git push origin feature"}).returncode == 0
