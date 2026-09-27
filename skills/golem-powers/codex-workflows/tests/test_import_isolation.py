"""Different installed/worktree copies must resolve their own implementation."""

import shutil
import sys
from pathlib import Path

import pytest

from test_split_contract import load_module


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def test_two_copies_use_their_own_implementation_and_error_class(tmp_path):
    copies = [tmp_path / name for name in ("a", "b")]
    for copy in copies:
        shutil.copytree(SCRIPTS, copy, ignore=shutil.ignore_patterns("__pycache__"))
    second_cli = copies[1] / "codex_workflows_impl" / "cli.py"
    original = "Headless Codex worktree orchestration primitives."
    edited = "Second copy's isolated implementation."
    source = second_cli.read_text()
    assert original in source
    second_cli.write_text(source.replace(original, edited))

    original_path = sys.path[:]
    first, second = [load_module(copy / "codex_workflows.py") for copy in copies]
    assert sys.path == original_path
    for module, copy in zip((first, second), copies):
        assert Path(module._cli.__file__).resolve() == copy / "codex_workflows_impl" / "cli.py"
    assert first.build_parser().description == original
    assert second.build_parser().description == edited
    assert first.CodexWorkflowError is not second.CodexWorkflowError
    for module in (first, second):
        with pytest.raises(module.CodexWorkflowError):
            module.validate_worker_name("invalid/name")
