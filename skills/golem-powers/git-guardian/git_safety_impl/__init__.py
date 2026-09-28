"""Implementation modules and path-scoped shared helpers for git_safety."""

import importlib.util
import sys
from pathlib import Path


def _shared(name):
    source = Path(__file__).resolve().parents[2] / "_shared" / f"{name}.py"
    qualified = f"{__name__}._shared_{name}"
    spec = importlib.util.spec_from_file_location(qualified, source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[qualified] = module
    spec.loader.exec_module(module)
    return module


harness_paths = _shared("harness_paths")
shell_parse = _shared("shell_parse")
