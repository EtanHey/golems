#!/usr/bin/env python3
"""
TDD Guard - PreToolUse hook for Write/Edit.

Enforces test-driven development by tracking implementation file modifications
per session and blocking after 3+ modifications without a corresponding test file.

Behavior:
  - ALLOW + WARN: New file (doesn't exist yet) without a test
  - ALLOW + WARN: Existing file modified 1-2 times without a test
  - BLOCK: Existing file modified 3+ times without a test file
  - ALLOW silently: Test files, config, docs, generated, skills, hooks, scripts
"""

import json
import os
import sys
from pathlib import Path

# --- State tracking ---
STATE_DIR = os.path.expanduser("~/.claude/tdd-guard-state")

# --- Implementation file extensions ---
IMPL_EXTENSIONS = {".ts", ".tsx", ".kt", ".swift", ".py"}

# --- Path segments that skip TDD checking ---
SKIP_PATH_SEGMENTS = {
    "node_modules", "dist", "build", ".next", ".expo", "__pycache__",
    ".git", ".claude", "skills", "hooks", "scripts",
    "collab", "docs", "docs.local", "designs", "roadmap",
    "standards", ".github", "migrations", "fixtures",
    "evals", "generated", "vendor", "__mocks__", "__snapshots__",
}

SNAPSHOT_FILE_MARKERS = (
    ".snap.",
    ".golden.",
    ".snapshot.",
    ".approved.",
    ".received.",
)

# --- Config/boilerplate files that don't need tests ---
SKIP_NAMES = {
    "index.ts", "index.tsx", "index.py",
    "types.ts", "types.tsx",
    "constants.ts", "constants.py",
    "env.ts", "env.py",
    "setup.py", "setup.cfg",
    "conftest.py", "__init__.py",
    "convex.config.ts", "tailwind.config.ts",
    "next.config.ts", "next.config.js",
    "vite.config.ts", "app.config.ts", "app.config.js",
    "metro.config.js", "babel.config.js",
    "jest.config.ts", "jest.config.js", "vitest.config.ts",
}


def is_test_file(filename: str) -> bool:
    name = Path(filename).name
    lower = name.lower()
    return (
        name.endswith("Tests.swift")
        or name.endswith("Test.kt")
        or lower.startswith("test_")
        or any(pat in lower for pat in [".test.", ".spec.", "_test."])
    )


def is_skip_path(file_path: str) -> bool:
    parts = Path(file_path).parts
    return any(part in SKIP_PATH_SEGMENTS for part in parts)


def is_snapshot_file(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith(".snap") or any(marker in lower for marker in SNAPSHOT_FILE_MARKERS)


def is_impl_file(file_path: str) -> bool:
    p = Path(file_path)
    if p.suffix not in IMPL_EXTENSIONS:
        return False
    if is_snapshot_file(p.name):
        return False
    if is_test_file(p.name):
        return False
    if p.name.endswith(".d.ts"):
        return False
    if is_skip_path(file_path):
        return False
    if p.name in ("CLAUDE.md", "AGENTS.md", "MEMORY.md"):
        return False
    return p.name not in SKIP_NAMES


def find_project_root(file_path: str) -> str:
    current = Path(file_path).parent
    while current != current.parent:
        if any((current / m).exists() for m in [
            "package.json",
            "pyproject.toml",
            "build.gradle",
            "build.gradle.kts",
            "settings.gradle",
            "settings.gradle.kts",
            "Package.swift",
            ".git",
        ]):
            return str(current)
        current = current.parent
    return str(Path(file_path).parent)


def expected_test_names(stem: str, ext: str) -> list[str]:
    expected = {
        f"{stem}.test{ext}",
        f"{stem}.spec{ext}",
        f"{stem}_test{ext}",
        f"test_{stem}{ext}",
    }
    if ext in (".ts", ".tsx"):
        expected.update({
            f"{stem}.test.ts",
            f"{stem}.test.tsx",
            f"{stem}.spec.ts",
            f"{stem}.spec.tsx",
        })
    if ext == ".kt":
        expected.add(f"{stem}Test{ext}")
    if ext == ".swift":
        expected.add(f"{stem}Tests{ext}")
    return list(expected)


def is_related_swift_test(stem: str, candidate_stem: str) -> bool:
    if not candidate_stem.startswith(stem) or not candidate_stem.endswith("Tests"):
        return False
    middle = candidate_stem[len(stem):-len("Tests")]
    return middle == "" or middle[0].isupper() or middle.startswith("_")


def find_test_file(file_path: str) -> tuple:
    p = Path(file_path)
    stem = p.stem
    ext = p.suffix
    file_dir = p.parent
    project_root = Path(find_project_root(file_path))

    # SwiftPM/XCTest convention: <pkg>/Sources/<Module>/Foo.swift has tests
    # named FooTests.swift (or Foo*Tests.swift) under <pkg>/Tests/<AnyModule>/.
    # Added 2026-06-06 (voicelayerClaude-SETTINGS-DESIGN): the guard previously
    # could not see ANY Swift XCTest file, so every 3rd+ edit to a Swift impl
    # file was blocked even mid-TDD ("Write-hook over-block" backlog item).
    if ext == ".swift" and "Sources" in p.parts:
        src_idx = p.parts.index("Sources")
        pkg_root = Path(*p.parts[:src_idx]) if src_idx > 0 else Path(".")
        tests_root = pkg_root / "Tests"
        if tests_root and tests_root.is_dir():
            for module_dir in tests_root.iterdir():
                if not module_dir.is_dir():
                    continue
                exact = module_dir / f"{stem}Tests{ext}"
                if exact.exists():
                    return True, str(exact)
                for candidate in module_dir.glob(f"{stem}*Tests{ext}"):
                    if is_related_swift_test(stem, candidate.stem):
                        return True, str(candidate)

    expected_names = expected_test_names(stem, ext)

    search_dirs = [
        file_dir,
        file_dir / "__tests__",
        project_root / "tests",
        project_root / "test",
        project_root / "__tests__",
        project_root / "src" / "test",
        project_root / "src" / "__tests__",
    ]

    for search_dir in search_dirs:
        if not search_dir.is_dir():
            continue
        for name in expected_names:
            if (search_dir / name).exists():
                return True, str(search_dir / name)
            for candidate in search_dir.rglob(name):
                return True, str(candidate)

    if ext == ".py":
        expected = f"test_{stem}{ext}"
    elif ext == ".kt":
        expected = f"{stem}Test{ext}"
    elif ext == ".swift":
        expected = f"{stem}Tests{ext}"
    else:
        expected = f"{stem}.test{ext}"

    tests_dir = project_root / "tests"
    if tests_dir.is_dir():
        expected_path = str(tests_dir / expected)
    elif (file_dir / "__tests__").is_dir():
        expected_path = str(file_dir / "__tests__" / expected)
    else:
        expected_path = str(file_dir / expected)

    return False, expected_path


def increment_modification_count(session_id: str, file_path: str) -> int:
    os.makedirs(STATE_DIR, exist_ok=True)
    state_file = os.path.join(STATE_DIR, f"{session_id}.json")

    try:
        with open(state_file, "r") as f:
            state = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        state = {}

    count = state.get(file_path, 0) + 1
    state[file_path] = count

    try:
        with open(state_file, "w") as f:
            json.dump(state, f)
    except OSError:
        pass

    return count


def main():
    if os.environ.get("BRAINLAYER_HOOKS_DISABLED") == "1":
        json.dump({}, sys.stdout)
        sys.exit(0)

    if os.environ.get("CLAUDE_WORKER"):
        json.dump({}, sys.stdout)
        sys.exit(0)

    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError:
        json.dump({}, sys.stdout)
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})
    session_id = hook_input.get("session_id", "unknown")

    if tool_name not in ("Write", "Edit"):
        json.dump({}, sys.stdout)
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not file_path:
        json.dump({}, sys.stdout)
        sys.exit(0)

    if not is_impl_file(file_path):
        json.dump({}, sys.stdout)
        sys.exit(0)

    test_found, expected_test_path = find_test_file(file_path)

    if test_found:
        increment_modification_count(session_id, file_path)
        json.dump({}, sys.stdout)
        sys.exit(0)

    file_exists = os.path.isfile(file_path)

    if not file_exists:
        result = {
            "systemMessage": (
                f"TDD NOTICE: Creating {os.path.basename(file_path)} without a test file. "
                f"Consider writing {os.path.basename(expected_test_path)} first (Red-Green-Refactor)."
            ),
        }
        increment_modification_count(session_id, file_path)
        json.dump(result, sys.stdout)
        sys.exit(0)

    count = increment_modification_count(session_id, file_path)

    if count >= 3:
        basename = os.path.basename(file_path)
        result = {
            "decision": "block",
            "reason": (
                f"TDD violation: {basename} has been modified {count} times this session "
                f"without a test file. Create {expected_test_path} first. "
                f"Red-Green-Refactor: write a failing test, then make it pass."
            ),
        }
        json.dump(result, sys.stdout)
        sys.exit(2)

    remaining = 3 - count
    basename = os.path.basename(file_path)
    result = {
        "systemMessage": (
            f"TDD WARNING: {basename} modified {count}x without a test file. "
            f"{remaining} more edit(s) before this is blocked. "
            f"Expected: {os.path.basename(expected_test_path)}"
        ),
    }
    json.dump(result, sys.stdout)
    sys.exit(0)


if __name__ == "__main__":
    main()
