"""Implementation modules and path-scoped shared helpers for git_safety."""

import importlib.util
import sys
from pathlib import Path


def _shared(name):
    source = Path(__file__).resolve().parents[2] / "_shared" / f"{name}.py"
    existing = sys.modules.get(name)
    if existing is not None and Path(getattr(existing, "__file__", "") or "").resolve() == source:
        return existing
    qualified = f"{__name__}._shared_{name}"
    spec = importlib.util.spec_from_file_location(qualified, source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[qualified] = module
    bare_absent = name not in sys.modules
    if bare_absent:
        sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        if sys.modules.get(qualified) is module:
            del sys.modules[qualified]
        if bare_absent and sys.modules.get(name) is module:
            del sys.modules[name]
        raise
    return module


harness_paths = _shared("harness_paths")
shell_parse = _shared("shell_parse")
