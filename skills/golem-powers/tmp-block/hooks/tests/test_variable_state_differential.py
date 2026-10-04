"""Approved builtin cut: compare ordered state and closure calls to the real pre-cut tree."""
import hashlib
import importlib.util
import inspect
import json
import subprocess
import sys
import tarfile
from io import BytesIO
from pathlib import Path

FIXTURE_PATH = Path(__file__).parent / 'fixtures/variable-state-differential.json'
FIXTURE = json.loads(FIXTURE_PATH.read_text())
PRE_CUT = '8d88b3b13b3c76dbd42afcdf337477af551dd416'
HOOK_REL = 'skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py'


def load_hook(path=None):
    spec = importlib.util.spec_from_file_location('state_differential', path or Path(__file__).parents[1] / 'tmp-block-pretooluse.py')
    hook = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hook)
    return hook


def ordered_states(hook):
    rows = []
    names = {'invalidate', 'invalidate_assignment_target', 'invalidate_all',
             'invalidate_assignment_word', 'track'}
    owner = hook._static_shell_variable_state_before.__code__.co_filename
    events = []

    def trace(frame, event, arg):
        code = frame.f_code
        if event == 'call' and code.co_filename == owner and code.co_name in names:
            events.append((code.co_name, [repr(frame.f_locals[name])
                           for name in code.co_varnames[:code.co_argcount]]))
        return None

    for row in FIXTURE['commands']:
        command = row['command'].replace('{REPO}', '/fixture/Gits/repo').replace('{HOME}', '/fixture/home')
        variants = (command, hook._mask_quoted_operator_words(hook._mask_function_definition_bodies(command)))
        for variant in dict.fromkeys(variants):
            args = hook._parse_bash(variant)
            for segment in sorted(set(args[2])):
                indices = [None] + [i for i, seg in enumerate(args[2]) if seg == segment]
                for index in indices:
                    events.clear()
                    previous = sys.gettrace()
                    sys.settrace(trace)
                    try:
                        state = hook._static_shell_variable_state_before(*args, segment, index)
                    finally:
                        sys.settrace(previous)
                    # repr retains nested list/tuple types; dict item order is explicit.
                    rows.append([row['id'], variant, segment, index,
                                 repr([list(d.items()) for d in state]), list(events)])
    return rows


def compare_states(hook, tmp_path):
    root = Path(__file__).resolve().parents[5]
    archive = subprocess.check_output(['git', 'archive', PRE_CUT, HOOK_REL,
                                       'skills/golem-powers/_shared'], cwd=root)
    with tarfile.open(fileobj=BytesIO(archive)) as tree:
        tree.extractall(tmp_path, filter='data')
    script = tmp_path / 'precut.py'
    script.write_text('import importlib.util, json, sys\n'
                      'spec = importlib.util.spec_from_file_location("check", sys.argv[1])\n'
                      'check = importlib.util.module_from_spec(spec); spec.loader.exec_module(check)\n'
                      'hook = check.load_hook(sys.argv[2])\n'
                      'assert check.hashlib.sha256(check.inspect.getsource(hook._static_shell_variable_state_before).rstrip("\\n").encode()).hexdigest() == check.FIXTURE["precut_function_sha256"]\n'
                      'print(json.dumps(check.ordered_states(hook)))\n')
    result = subprocess.run([sys.executable, '-B', str(script), str(Path(__file__).resolve()),
                             str(tmp_path / HOOK_REL)], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0 and result.stderr == '', result.stderr
    expected = json.loads(result.stdout)
    actual = json.loads(json.dumps(ordered_states(hook)))
    assert actual == expected
    assert any(row[-1] for row in actual), 'closure trace must be exercised'
    return len(actual)


def test_pre_and_post_cut_state_are_identical(tmp_path):
    assert compare_states(load_hook(), tmp_path) > len(FIXTURE['commands'])


def test_builtin_record_keeps_references_and_closure_order():
    hook = load_hook()
    tokens, indices, events = ['-a', 'R', 'X'], [0, 1, 2], []
    reaches = lambda index: True
    word = lambda name: events.append(('word', name))
    target = lambda name: events.append(('target', name))
    scan = hook.BuiltinScan('read', indices, True, tokens, reaches, word, target)
    assert scan.command_args is indices and scan.tokens is tokens
    assert (scan.mutation_reaches_target, scan.invalidate_assignment_word,
            scan.invalidate_assignment_target) == (reaches, word, target)
    tokens[2] = 'Y'
    assert hook.invalidate_builtin_targets(scan) is None
    assert events == [('word', 'R'), ('word', 'Y')]
