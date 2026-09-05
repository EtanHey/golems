"""Regression tests for the tdd-guard PreToolUse hook.

The hook blocks implementation files on the third edit when no matching test
exists. Snapshot/golden/approval artifacts are test data, so they must not be
classified as implementation even when their final extension is an impl suffix.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4


HOOK = Path(
    os.environ.get(
        "TDD_GUARD_HOOK_UNDER_TEST",
        str(Path(__file__).resolve().parent.parent / "tdd-guard.py"),
    )
).expanduser()


def run_hook(file_path: Path | str, home: Path, session_id: str, cwd: Path | None = None):
    payload = {
        "tool_name": "Edit",
        "tool_input": {
            "file_path": str(file_path),
            "old_string": "before",
            "new_string": "after",
        },
        "session_id": session_id,
    }
    env = os.environ.copy()
    env["HOME"] = str(home)
    env.pop("BRAINLAYER_HOOKS_DISABLED", None)
    env.pop("CLAUDE_WORKER", None)
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        cwd=str(cwd) if cwd else None,
        timeout=15,
    )


def run_three_edits(file_path: Path | str, tmp_path: Path, cwd: Path | None = None):
    home = tmp_path / f"home-{uuid4()}"
    home.mkdir()
    session_id = f"tdd-guard-{uuid4()}"
    results = [run_hook(file_path, home, session_id, cwd=cwd) for _ in range(3)]
    return results


def parse_stdout(proc):
    out = (proc.stdout or "").strip()
    return json.loads(out) if out else {}


def assert_allowed(proc):
    assert proc.returncode == 0, (
        f"expected allow, got exit {proc.returncode}; "
        f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
    )
    assert parse_stdout(proc).get("decision") != "block"


def assert_blocked(proc):
    assert proc.returncode == 2, (
        f"expected block on third edit, got exit {proc.returncode}; "
        f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
    )
    body = parse_stdout(proc)
    assert body.get("decision") == "block"
    assert "without a test file" in body.get("reason", "")


def touch_project_file(project: Path, relative: str) -> Path:
    path = project / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("before\n", encoding="utf-8")
    return path


def make_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "package.json").write_text("{}\n", encoding="utf-8")
    return project


def test_snapshot_and_golden_artifacts_are_not_blocked_after_three_edits(tmp_path: Path):
    project = make_project(tmp_path)
    snapshot_files = [
        touch_project_file(project, "src/Foo.test.tsx.snap"),
        touch_project_file(project, "src/__snapshots__/Foo.snap"),
        touch_project_file(project, "src/Quux.snap.ts"),
        touch_project_file(project, "src/Bar.golden.ts"),
        touch_project_file(project, "src/Baz.snapshot.tsx"),
        touch_project_file(project, "src/Widget.approved.py"),
        touch_project_file(project, "src/Widget.received.py"),
    ]

    for file_path in snapshot_files:
        results = run_three_edits(file_path, tmp_path)
        assert_allowed(results[-1])


def test_real_impl_file_without_test_still_blocks_after_three_edits(tmp_path: Path):
    project = make_project(tmp_path)
    service = touch_project_file(project, "src/Service.ts")

    results = run_three_edits(service, tmp_path)

    assert_allowed(results[0])
    assert_allowed(results[1])
    assert_blocked(results[2])


def test_marker_words_inside_real_filenames_are_still_impl_files(tmp_path: Path):
    project = make_project(tmp_path)
    impl_files = [
        touch_project_file(project, "src/golden_retriever.ts"),
        touch_project_file(project, "src/snapshot_service.ts"),
    ]

    for file_path in impl_files:
        results = run_three_edits(file_path, tmp_path)
        assert_blocked(results[-1])


def test_embedded_test_substring_inside_real_filenames_is_still_impl(tmp_path: Path):
    project = make_project(tmp_path)
    impl_files = [
        touch_project_file(project, "src/latest_service.py"),
        touch_project_file(project, "src/contest_runner.ts"),
        touch_project_file(project, "src/attest_client.ts"),
    ]

    for file_path in impl_files:
        results = run_three_edits(file_path, tmp_path)
        assert_blocked(results[-1])


def test_swift_prefix_collision_does_not_count_as_matching_test(tmp_path: Path):
    project = tmp_path / "swift-project"
    foo = touch_project_file(project, "Sources/App/Foo.swift")
    touch_project_file(project, "Tests/AppTests/FoodTests.swift")

    results = run_three_edits(foo, tmp_path)

    assert_blocked(results[-1])


def test_swift_related_suffix_test_still_counts(tmp_path: Path):
    project = tmp_path / "swift-project"
    foo = touch_project_file(project, "Sources/App/Foo.swift")
    touch_project_file(project, "Tests/AppTests/FooBehaviorTests.swift")

    results = run_three_edits(foo, tmp_path)

    assert_allowed(results[-1])


def test_nested_tests_directory_is_searched(tmp_path: Path):
    project = make_project(tmp_path)
    service = touch_project_file(project, "src/service.py")
    touch_project_file(project, "tests/unit/test_service.py")

    results = run_three_edits(service, tmp_path)

    assert_allowed(results[-1])


def test_typescript_test_does_not_satisfy_python_impl(tmp_path: Path):
    project = make_project(tmp_path)
    service = touch_project_file(project, "src/service.py")
    touch_project_file(project, "tests/service.test.ts")

    results = run_three_edits(service, tmp_path)

    assert_blocked(results[-1])


def test_xctest_and_jvm_test_files_are_not_impl_files(tmp_path: Path):
    project = make_project(tmp_path)
    test_files = [
        touch_project_file(project, "Tests/AppTests/FooTests.swift"),
        touch_project_file(project, "src/test/kotlin/FooTest.kt"),
    ]

    for file_path in test_files:
        results = run_three_edits(file_path, tmp_path)
        assert_allowed(results[-1])


def test_kotlin_footest_is_found_next_to_implementation(tmp_path: Path):
    project = make_project(tmp_path)
    foo = touch_project_file(project, "src/Foo.kt")
    touch_project_file(project, "src/FooTest.kt")

    results = run_three_edits(foo, tmp_path)

    assert_allowed(results[-1])


def test_kotlin_src_test_tree_is_searched(tmp_path: Path):
    project = tmp_path / "kotlin-project"
    project.mkdir()
    (project / "build.gradle.kts").write_text("plugins {}\n", encoding="utf-8")
    foo = touch_project_file(project, "src/main/kotlin/Foo.kt")
    touch_project_file(project, "src/test/kotlin/FooTest.kt")

    results = run_three_edits(foo, tmp_path)

    assert_allowed(results[-1])


def test_relative_swift_sources_path_finds_tests_at_package_root(tmp_path: Path):
    project = tmp_path / "swift-project"
    project.mkdir()
    touch_project_file(project, "Package.swift")
    touch_project_file(project, "Sources/App/Foo.swift")
    touch_project_file(project, "Tests/AppTests/FooTests.swift")

    results = run_three_edits("Sources/App/Foo.swift", tmp_path, cwd=project)

    assert_allowed(results[-1])
