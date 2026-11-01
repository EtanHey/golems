"""Exercise real CLI/worktree/process/file boundaries with a local Codex fixture."""
import json
import os
from pathlib import Path
import subprocess


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def test_cli_launch_watch_harvest_cleanup(tmp_path):
    # Only the model transport is substituted. Git, nohup, process identity,
    # manifests, shell entry point and artifact harvesting are production code.
    source, origin, repo = (tmp_path / name for name in ("source", "origin.git", "repo"))
    env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

    # Worktree lifecycle coverage must not depend on the host's free disk.
    env["GOLEMS_WORKTREE_MIN_FREE_GB"] = "0"

    def git(*args, cwd=None):
        return subprocess.run(["git", *map(str, args)], cwd=cwd, env=env,
                              capture_output=True, text=True, check=True, timeout=10)

    git("init", "--initial-branch=fixture-main", source)
    git("config", "user.email", "eval@example.com", cwd=source)
    git("config", "user.name", "Fixture", cwd=source)
    (source / "README.md").write_text("fixture\n")
    (source / ".gitignore").write_text(".worktrees/\n")
    git("add", "README.md", ".gitignore", cwd=source)
    git("commit", "-m", "fixture", cwd=source)
    git("clone", "--bare", source, origin)
    git("clone", origin, repo)
    fixture = tmp_path / "fixture-codex"
    fixture.write_text('''#!/usr/bin/env python3
import json
from pathlib import Path
import sys
assert sys.argv[1:4] == ['exec', '--approve-for-me', '--json']
assert sys.argv[sys.argv.index('--model') + 1] == __import__('os').environ['EXPECTED_MODEL']
assert 'model_reasoning_effort="xhigh"' in sys.argv
Path('result.md').write_text('fixture artifact\\n')
print(json.dumps({'type': 'thread.started', 'thread_id': 'fixture'}))
print(json.dumps({'type': 'item.completed', 'item': {'id': 'a', 'type': 'agent_message', 'text': 'fixture complete\\nTASK_DONE'}}))
print(json.dumps({'type': 'turn.completed', 'usage': {'output_tokens': 7}}))
''')
    fixture.chmod(0o755)
    env["CODEX_BIN"] = str(fixture)
    env["EXPECTED_MODEL"] = subprocess.run(["node", str(Path(__file__).resolve().parents[4] / "scripts/model-roles.mjs"), "codex.implement"], capture_output=True, text=True, check=True).stdout.strip()
    brief = tmp_path / "brief.md"
    brief.write_text("fixture only\n")
    manifest = repo / ".worktrees" / "fixture-run" / "manifest.json"

    def cli(*args):
        return subprocess.run([str(SCRIPTS / "codex-workflows.sh"), *map(str, args)],
                              cwd=tmp_path, env=env, capture_output=True, text=True, timeout=15)

    launch = cli("agent", "--repo", repo, "--name", "worker", "--brief", brief,
                 "--lead", "fixture-lead", "--manifest", manifest,
                 "--artifact", "result.md", "--launch-timeout", "0.5")
    assert launch.returncode == 0, launch.stdout + launch.stderr
    assert json.loads(launch.stdout)["ok"] is True
    watched = cli("watch", "--manifest", manifest, "--timeout", "5", "--interval", "0.05")
    assert watched.returncode == 0, watched.stdout + watched.stderr
    worker = json.loads(manifest.read_text())["workers"]["worker"]
    assert worker["status"] == "completed"
    assert worker["output_tokens"] == 7
    assert worker["default_branch"] == "fixture-main"
    assert worker["assistant_result"] == "fixture complete\nTASK_DONE"
    harvest = cli("harvest", "--manifest", manifest)
    assert harvest.returncode == 0, harvest.stdout + harvest.stderr
    artifact = manifest.parent / "harvest" / "worker" / "artifacts" / "result.md"
    assert artifact.read_bytes() == b"fixture artifact\n"
    cleanup = cli("cleanup", "--manifest", manifest, "--delete-branches")
    assert cleanup.returncode != 0 and "worktree retained" in cleanup.stderr
    assert Path(worker["worktree"]).exists()
    assert git("branch", "--list", worker["branch"], cwd=repo).stdout.strip()
    worker = json.loads(manifest.read_text())["workers"]["worker"]
    assert worker["retirement_disposition"] == "RETAINED"
    assert artifact.read_bytes() == b"fixture artifact\n"
