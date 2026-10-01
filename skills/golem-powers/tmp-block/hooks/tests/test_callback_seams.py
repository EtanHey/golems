"""Live facade callbacks, with shared-origin checks preserved across copies."""
import importlib.util
import shutil
import sys
from pathlib import Path

import pytest


HOOK = Path(__file__).resolve().parents[1] / "tmp-block-pretooluse.py"


@pytest.mark.parametrize("registered", [False, True])
@pytest.mark.parametrize("seam", ["classifier", "prefixes"])
def test_callbacks_remain_live_in_two_copies(tmp_path, registered, seam):
    saved_modules, saved_path = dict(sys.modules), list(sys.path)
    facades = []
    try:
        for label in ("a", "b"):
            powers = tmp_path / label
            for leaf in ("tmp-block", "_shared"):
                shutil.copytree(HOOK.parents[2] / leaf, powers / leaf,
                                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            # Isolation belongs to the test; foreign cached policy still denies
            # in the unchanged harness's four two-copy import specimens.
            for name in ("harness_paths", "shell_parse"):
                sys.modules.pop(name, None)
            spec = importlib.util.spec_from_file_location(
                "callback_" + label, powers / "tmp-block/hooks/tmp-block-pretooluse.py")
            facade = importlib.util.module_from_spec(spec)
            if registered:
                sys.modules[spec.name] = facade
            spec.loader.exec_module(facade)
            facades.append(facade)
        a, b = facades
        if seam == "classifier":
            path = "/durable/w7-probe"
            a.in_temp_class, b.in_temp_class = lambda _: True, lambda _: False
        else:
            path = "/w7-temp/probe"
            a._temp_prefixes, b._temp_prefixes = lambda: {"/w7-temp"}, lambda: set()
        for facade, denied in ((a, True), (b, False), (a, True), (b, False)):
            hits = facade.find_temp_targets("Write", {"file_path": path})
            assert type(hits) is list
            assert hits == ([("Write", path, 0)] if denied else [])
            if hits:
                assert type(hits[0]) is tuple
            verdict = facade._literal_prefix_class(path + "$UNSET", None)
            assert type(verdict) is str
            assert verdict == ("temp" if denied else "outside")
        # Reversing both patches detects readers accidentally bound to one copy.
        if seam == "classifier":
            a.in_temp_class, b.in_temp_class = lambda _: False, lambda _: True
        else:
            a._temp_prefixes, b._temp_prefixes = lambda: set(), lambda: {"/w7-temp"}
        assert a.find_temp_targets("Write", {"file_path": path}) == []
        assert b.find_temp_targets("Write", {"file_path": path}) == [("Write", path, 0)]
        if seam == "classifier":
            a.in_temp_class = lambda _: True
        else:
            a._temp_prefixes = lambda: {"/w7-temp"}
        assert a.find_temp_targets("Write", {"file_path": path}) == [("Write", path, 0)]
        for name in ("harness_paths", "shell_parse"):
            sys.modules.pop(name, None)
        spec = importlib.util.spec_from_file_location("callback_reentrant", a.__file__)
        again = importlib.util.module_from_spec(spec)
        if registered:
            sys.modules[spec.name] = again
        spec.loader.exec_module(again)
        if seam == "classifier":
            again.in_temp_class = lambda _: False
        else:
            again._temp_prefixes = lambda: set()
        assert again.find_temp_targets("Write", {"file_path": path}) == []
        assert b.find_temp_targets("Write", {"file_path": path}) == [("Write", path, 0)]
        assert again._literal_prefix_class(path + "$UNSET", None) == "outside"
        assert b._literal_prefix_class(path + "$UNSET", None) == "temp"
        assert a.find_temp_targets("Write", {"file_path": path}) == [("Write", path, 0)]
        assert a._literal_prefix_class(path + "$UNSET", None) == "temp"
        assert again._policy is not a._policy
        assert again._runtime is not a._runtime
    finally:
        for name in set(sys.modules) - saved_modules.keys():
            if name.startswith(("_golems_", "callback_")) or name in ("harness_paths", "shell_parse"):
                sys.modules.pop(name, None)
        for name in ("harness_paths", "shell_parse"):
            if name in saved_modules:
                sys.modules[name] = saved_modules[name]
        sys.path[:] = saved_path
