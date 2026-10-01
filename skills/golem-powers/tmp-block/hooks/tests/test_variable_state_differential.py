"""Approved builtin cut: compare full state at every segment/token query."""
import ast
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/variable-state-differential.json').read_text())


def load_hook():
    spec = importlib.util.spec_from_file_location('state_differential', Path(__file__).parents[1] / 'tmp-block-pretooluse.py')
    hook = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hook)
    return hook


def reference(hook):
    post = hook._static_shell_variable_state_before
    source = inspect.getsource(post)
    calls = [n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Expr)
             and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name)
             and n.value.func.id == 'invalidate_builtin_targets']
    if calls:
        assert len(calls) == 1
        helper = inspect.getsource(hook.invalidate_builtin_targets).splitlines(keepends=True)
        start = next(i for i, line in enumerate(helper) if line.startswith('    # `read NAME`'))
        block = ''.join('    ' + line if line.strip() else line for line in helper[start:])
        lines = source.splitlines(keepends=True)
        lines[calls[0].lineno - 1:calls[0].end_lineno] = [block]
        source = ''.join(lines)
    assert hashlib.sha256(source.rstrip('\n').encode()).hexdigest() == FIXTURE['precut_function_sha256']
    namespace = dict(post.__globals__)
    exec(compile(source, '<byte-verified-precut-state>', 'exec'), namespace)
    return namespace[post.__name__]


def compare_states(hook):
    before = reference(hook)
    queries = 0
    for row in FIXTURE['commands']:
        command = row['command'].replace('{REPO}', '/fixture/Gits/repo').replace('{HOME}', '/fixture/home')
        variants = (command, hook._mask_quoted_operator_words(hook._mask_function_definition_bodies(command)))
        for variant in dict.fromkeys(variants):
            args = hook._parse_bash(variant)
            for segment in sorted(set(args[2])):
                indices = [None] + [i for i, seg in enumerate(args[2]) if seg == segment]
                for index in indices:
                    expected = before(*args, segment, index)
                    actual = hook._static_shell_variable_state_before(*args, segment, index)
                    assert actual == expected, (row['id'], segment, index, expected, actual)
                    queries += 1
    return queries


def test_pre_and_post_cut_state_are_identical():
    assert compare_states(load_hook()) > len(FIXTURE['commands'])


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
