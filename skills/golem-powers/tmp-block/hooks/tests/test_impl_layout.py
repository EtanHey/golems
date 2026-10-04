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


@pytest.mark.parametrize("damaged", ["__init__.py", "policy.py", "runtime.py", "scope.py", "shell_words.py", "chain_status.py", "wiring", "words.py", "prefixes.py", "variable_builtins.py", "variables.py", "assignments.py", "compounds.py", "anchors.py", "resolution.py", "tool_targets.py", "bypass.py", "worktree_args.py", "worktrees.py", "write_targets.py", "shell_targets.py", "syntax", "runtime-error", "foreign"])
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
assert hook._WORKTREE_VALUE_FLAGS is hook._worktree_args._WORKTREE_VALUE_FLAGS
for name in ('DEFAULT_LEDGER', 'HATCH_TMP', 'HATCH_WT'):
    assert getattr(hook, name) is getattr(hook._bypass, name), name
for name in ('GUARDED_FILE_TOOLS', 'APPLY_PATCH_TOOL', 'TOOL_ALIASES', '_APPLY_PATCH_TARGET_RE'):
    assert getattr(hook, name) is getattr(hook._tool_targets, name), name
assert hook._POSITIONAL_PARAM_RE is hook._prefixes._POSITIONAL_PARAM_RE
assert hook._SIMPLE_VAR_RE is hook._words._SIMPLE_VAR_RE
assert hook._MAX_STATIC_VALUES is hook._words._MAX_STATIC_VALUES
assert type(hook._MAX_STATIC_VALUES) is int and hook._MAX_STATIC_VALUES == 256
for module_name in ('scope', 'shell_words', 'chain_status', 'words', 'prefixes', 'variable_builtins', 'variables', 'assignments', 'compounds', 'anchors', 'resolution', 'tool_targets', 'bypass', 'worktree_args', 'worktrees', 'write_targets', 'shell_targets'):
    module = getattr(hook, '_' + module_name)
    for name, value in vars(module).items():
        if callable(value) and getattr(value, '__module__', None) == module.__name__:
            assert getattr(hook, name) is value, (module_name, name)
assert sys.dont_write_bytecode is (sys.argv[2] == 'True')
""")
    env = {k: v for k, v in os.environ.items() if k != "PYTHONDONTWRITEBYTECODE"}
    result = subprocess.run([sys.executable, *(["-B"] if bytecode else []), str(probe), str(HOOK), str(bytecode)],
                            capture_output=True, text=True, timeout=20, env=env)
    assert (result.returncode, result.stdout, result.stderr) == (0, "", ""), result.stderr


def test_split_module_names_are_resolved_and_used(tmp_path):
    probe = tmp_path / "module_names.py"
    probe.write_text("""import ast, builtins, importlib.util, symtable, sys, types
from pathlib import Path
spec = importlib.util.spec_from_file_location('unregistered', sys.argv[1])
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
errors = []
external = {(n.value.id, n.attr) for n in ast.walk(ast.parse(Path(sys.argv[1]).read_text())) if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)}
for file in sorted((Path(sys.argv[1]).parent / 'tmp_block_impl').glob('*.py')):
    module = getattr(hook, '_' + file.stem, None)
    if module is None:
        assert file.name == '__init__.py', file
        continue
    text = file.read_text(); refs = set(); imports = set(); definitions = set()
    def collect(table):
        refs.update(s.get_name() for s in table.get_symbols() if s.is_global() and s.is_referenced())
        for child in table.get_children(): collect(child)
    collect(symtable.symtable(text, str(file), 'exec'))
    for node in ast.parse(text).body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imports.update(a.asname or a.name.split('.')[0] for a in node.names)
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)): definitions.add(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            definitions.update(n.id for t in (node.targets if isinstance(node, ast.Assign) else [node.target]) for n in ast.walk(t) if isinstance(n, ast.Name))
    namespace = vars(module)
    missing = refs - namespace.keys() - vars(builtins).keys()
    unused = imports - refs
    unused.update(n for n,v in namespace.items() if not n.startswith('__') and n not in refs and n not in imports and getattr(hook, n, object()) is not v and ('_'+file.stem,n) not in external)
    implicit = {n for n in refs if n in namespace and isinstance(namespace[n], types.ModuleType) and namespace[n].__name__ in sys.stdlib_module_names and n not in imports}
    errors.append((file.name, sorted(missing), sorted(unused), sorted(implicit)))
assert not any(missing or unused or implicit for _,missing,unused,implicit in errors), errors
""")
    result = subprocess.run([sys.executable, "-B", str(probe), str(HOOK)],
                            capture_output=True, text=True, timeout=20)
    assert (result.returncode, result.stdout, result.stderr) == (0, "", ""), result.stderr


def test_shell_scan_shares_references_in_original_pass_order(tmp_path):
    probe = tmp_path / "scan.py"
    probe.write_text("""import importlib.util, sys
spec = importlib.util.spec_from_file_location('unregistered', sys.argv[1])
hook = importlib.util.module_from_spec(spec); spec.loader.exec_module(hook)
namespace = hook._bash_temp_targets.__globals__
seen = []
for name in ('scan_redirect_targets', 'scan_tee_targets', 'scan_worktree_targets'):
    original = namespace[name]
    def witness(scan, name=name, original=original):
        seen.append((name, scan, scan.budget[0]))
        original(scan)
    namespace[name] = witness
command = 'echo x > /outside/stable'
hits = hook._bash_temp_targets(command)
assert [name for name, _, _ in seen] == ['scan_redirect_targets', 'scan_tee_targets', 'scan_worktree_targets']
assert len({id(scan) for _, scan, _ in seen}) == 1
scan = seen[0][1]
assert scan.command is command and scan.hits is hits
assert [budget for _, _, budget in seen] == [max(65536, len(command)*32)-len(command)]*3
assert scan.budget[0] == seen[0][2]
assert scan.tokens and len(scan.tokens) == len(scan.cmd_pos) == len(scan.seg_of) == len(scan.scope_of)
""")
    result = subprocess.run([sys.executable, "-B", str(probe), str(HOOK)],
                            capture_output=True, text=True, timeout=20)
    assert (result.returncode, result.stdout, result.stderr) == (0, "", ""), result.stderr
