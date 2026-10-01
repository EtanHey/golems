"""The policy package is part of the copied hook's fail-closed boundary."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
HOOK = ROOT / "skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py"


def copied_hook(root):
    for leaf in ("tmp-block", "_shared"):
        shutil.copytree(HOOK.parents[2] / leaf, root / leaf,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return root / "tmp-block/hooks/tmp-block-pretooluse.py"


def invoke(hook, cwd):
    payload = cwd / "request.json"
    payload.write_text(json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls"}}))
    env = {k: v for k, v in os.environ.items() if k not in (
        "WEAVE_ALLOW_TMP", "GOLEM_ROLE", "GOLEM_EFFORT", "PYTHONDONTWRITEBYTECODE")}
    with payload.open() as stream:
        return subprocess.run([sys.executable, str(ROOT / "scripts/hooks/fail-open.py"), str(hook)],
                              stdin=stream, capture_output=True, text=True, cwd=cwd, env=env, timeout=20)


@pytest.mark.parametrize("layout", ["copy", "directory-link", "file-link"])
def test_real_path_layout_and_bytecode(tmp_path, layout):
    hook = copied_hook(tmp_path / "source")
    if layout == "directory-link":
        (tmp_path / "linked").symlink_to(hook.parent, target_is_directory=True)
        hook = tmp_path / "linked" / hook.name
    elif layout == "file-link":
        (tmp_path / "linked.py").symlink_to(hook)
        hook = tmp_path / "linked.py"
    result = invoke(hook, tmp_path)
    assert (result.returncode, result.stdout, result.stderr) == (0, "{}", "")
    package = hook.resolve().parent / "tmp_block_impl"
    assert not list(package.rglob("*.pyc"))
    assert not list(package.rglob("__pycache__"))


@pytest.mark.parametrize("damaged", ["__init__.py", "policy.py", "runtime.py", "scope.py", "shell_words.py", "chain_status.py", "wiring", "syntax", "runtime-error", "foreign"])
def test_missing_or_corrupt_package_denies_through_launcher(tmp_path, damaged):
    hook = copied_hook(tmp_path / "source")
    package = hook.parent / "tmp_block_impl"
    package.mkdir(exist_ok=True)
    if damaged == "foreign":
        shutil.copy2(package / "policy.py", package.parent / "foreign.py")
        (package / "__init__.py").write_text("""import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location(__name__ + '.policy', Path(__file__).parent.parent / 'foreign.py')
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
""")
    elif damaged == "wiring":
        module = package / "chain_status.py"
        module.write_text(module.read_text() + """
import sys, types
class WiringFailure(types.ModuleType):
    def __setattr__(self, name, value):
        if name == '_is_separator':
            print('must stay hidden')
            raise RuntimeError('wiring unavailable')
        super().__setattr__(name, value)
sys.modules[__name__].__class__ = WiringFailure
""")
    elif damaged in ("syntax", "runtime-error"):
        error = "this is invalid syntax !" if damaged == "syntax" else "raise RuntimeError('unavailable')"
        (package / "policy.py").write_text("print('must stay hidden')\n" + error + "\n")
    else:
        (package / damaged).unlink(missing_ok=True)
    result = invoke(hook, tmp_path)
    decision = json.loads(result.stdout)
    assert result.returncode == 2 and result.stderr == ""
    assert decision["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "security policy unavailable" in decision["reason"]


@pytest.mark.parametrize("bytecode", [False, True])
def test_policy_exports_are_defining_objects(tmp_path, bytecode):
    probe = tmp_path / "identity.py"
    probe.write_text("""import importlib.util, sys
spec = importlib.util.spec_from_file_location('unregistered', sys.argv[1])
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
for name in ('Unresolvable', '_has_temp_hint', 'in_temp_class', 'on_convention',
             '_TMPDIR_TOKEN_RE', '_TEMP_HINT_RE', '_TEMP_PATH_TOKEN_RE',
             'WORKTREE_DIR_NAME', '_CWD_CHANGING_CMDS'):
    assert getattr(hook, name) is getattr(hook._policy, name), name
assert hook._policy.is_harness_scratchpad is hook.is_harness_scratchpad
for module_name in ('scope', 'shell_words', 'chain_status'):
    module = getattr(hook, '_' + module_name)
    for name, value in vars(module).items():
        if callable(value) and getattr(value, '__module__', None) == module.__name__:
            assert getattr(hook, name) is value, (module_name, name)
assert sys.dont_write_bytecode is (sys.argv[2] == 'True')
""")
    env = {k: v for k, v in os.environ.items() if k != "PYTHONDONTWRITEBYTECODE"}
    result = subprocess.run([sys.executable, *(["-B"] if bytecode else []), str(probe), str(HOOK), str(bytecode)],
                            capture_output=True, text=True, timeout=20, env=env)
    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")
