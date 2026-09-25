#!/usr/bin/env python3
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parents[2] / "hooks" / "daemon-gate-precheck.py"


def run(cmd, cwd, **kwargs):
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        **kwargs.pop("env", {}),
    }
    return subprocess.run(cmd, cwd=cwd, env=env, text=True, capture_output=True, check=False, **kwargs)


class DaemonGatePrecheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        run(["git", "init", "-b", "main"], self.repo)
        run(["git", "config", "user.email", "test@example.com"], self.repo)
        run(["git", "config", "user.name", "Test User"], self.repo)
        (self.repo / "README.md").write_text("base\n")
        run(["git", "add", "."], self.repo)
        run(["git", "commit", "-m", "base"], self.repo)
        run(["git", "checkout", "-b", "feature"], self.repo)
        # The gate is scoped to VoiceLayer by its origin remote (is_voicelayer_repo).
        run(["git", "remote", "add", "origin", "https://github.com/example/voicelayer.git"], self.repo)

    def tearDown(self):
        self.tmp.cleanup()

    def invoke(self, command):
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": command},
            "session_id": "test-session",
        }
        return subprocess.run(
            ["python3", str(HOOK)],
            cwd=self.repo,
            env={**os.environ, "CLAUDE_PROJECT_DIR": str(self.repo)},
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=False,
        )

    def commit_file(self, relative_path, body="change\n"):
        path = self.repo / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
        run(["git", "add", relative_path], self.repo)
        run(["git", "commit", "-m", f"touch {relative_path}"], self.repo)

    def test_blocks_admin_merge_when_daemon_change_has_no_runtime_artifact(self):
        self.commit_file("src/paths.ts")

        result = self.invoke("gh pr merge 123 --squash --delete-branch --admin")

        self.assertNotEqual(result.returncode, 0)
        body = json.loads(result.stdout)
        self.assertEqual(body["decision"], "block")
        self.assertIn("NON-NEGOTIABLE DAEMON VERIFICATION GATE", body["reason"])
        self.assertIn("./scripts/voicelayer-verify.sh", body["reason"])

    def test_allows_admin_merge_when_matching_runtime_artifact_exists(self):
        self.commit_file("src/socket-handlers.ts")
        sha = run(["git", "rev-parse", "HEAD"], self.repo).stdout.strip()
        short = run(["git", "rev-parse", "--short", "HEAD"], self.repo).stdout.strip()
        verified = self.repo / ".verified"
        verified.mkdir()
        (verified / f"verified-runtime-feature-{short}.txt").write_text(f"Verified-Runtime: {sha}\n")

        result = self.invoke("gh pr merge 123 --squash --delete-branch --admin")

        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {})

    def test_allows_admin_merge_when_branch_does_not_touch_daemon_files(self):
        self.commit_file("docs/readme.md")

        result = self.invoke("gh pr merge 123 --squash --delete-branch --admin")

        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {})

    def test_ignores_non_admin_merge(self):
        self.commit_file("src/mcp-server.ts")

        result = self.invoke("gh pr merge 123 --squash --delete-branch")

        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {})


    def test_other_repos_are_never_gated(self):
        run(["git", "remote", "set-url", "origin", "https://github.com/example/mcplayer.git"], self.repo)
        self.commit_file("launchd/com.example.bus.plist")

        result = self.invoke("gh pr merge 123 --squash --admin")

        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {})


if __name__ == "__main__":
    unittest.main()
