"""ANSI-C quote boundaries. Commands are policy inputs, never executed."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import shell_parse

patterns = shell_parse._impl_module("patterns")

ROOT = Path(__file__).resolve().parents[4]
HOOK = ROOT / 'skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tmp_policy = load('ansi_tmp_policy', HOOK)
guardian = load('ansi_git_policy', ROOT / 'skills/golem-powers/git-guardian/git_safety.py')
PREFIXES = [r"x=$'\'' ", r"x=$'a\'b' ", r"x=$'\\' ", r"x=$'\x27' ", r"x=$'\c\\' "]


@pytest.mark.parametrize('prefix', PREFIXES)
@pytest.mark.parametrize('write', [
    'cat > /private/tmp/ansi-fixture/out',
    'printf data | tee /private/tmp/ansi-fixture/out',
    'echo "$(cat > /private/tmp/ansi-fixture/out)"',
])
def test_following_temp_write_is_visible(prefix, write):
    assert tmp_policy.find_temp_targets('Bash', {'command': prefix + write})


@pytest.mark.parametrize('target', [
    r"$'\x2fprivate/tmp/ansi-fixture/out'",
    r"$'/private/\164mp/ansi-fixture/out'",
    r"$'\u002ftmp/ansi-fixture/out'",
    r"$'/private/tmp/ansi-fixture/out\0ignored'",
])
def test_decoded_temp_targets(target):
    assert tmp_policy.find_temp_targets('Bash', {'command': 'cat > ' + target})


@pytest.mark.parametrize('prefix', PREFIXES)
def test_git_consumer_still_denies(prefix):
    assert guardian.dangerous_shell_reason(prefix + 'git push --force origin master')


@pytest.mark.parametrize('command', [
    r"echo $'a\'b; cat > /private/tmp/ansi-fixture/out'",
    r"echo $'a\'b $(cat > /private/tmp/ansi-fixture/out)'",
    r"echo $'a\'b `cat > /private/tmp/ansi-fixture/out`'",
    r"printf '%s' $'\x3e' /private/tmp/ansi-fixture/read-only",
    r"printf '%s' $'\x3b' /private/tmp/ansi-fixture/read-only",
])
def test_quoted_data_is_inert(command):
    assert tmp_policy.find_temp_targets('Bash', {'command': command}) == []
    assert shell_parse._executable_subcommands(command) == []


def test_quote_boundaries_and_literal_dollar():
    assert shell_parse._shell_tokens(r"x=$'a\'b' cat > docs.local/out") == [
        "x=a'b", 'cat', '>', 'docs.local/out']
    assert shell_parse._shell_tokens(r"echo \$'a\' tail") == ['echo', '$a\\', 'tail']
    assert shell_parse._shell_tokens(r'''echo "$"'literal' ''') == ['echo', '$literal']
    source = r"echo $'a\'b { data }'; f() { cat > docs.local/out; }"
    masked = shell_parse._structure.mask_quoted_braces(source)
    assert '{ data }' not in masked
    assert 'f() { cat > docs.local/out; }' in masked


@pytest.mark.parametrize('tool', ['Bash', 'Shell'])
@pytest.mark.parametrize('command,denied', [
    (r"x=$'a\'b' cat > /private/tmp/ansi-fixture/out", True),
    ("x=$'a\\'b' echo \"$(cat > /private/tmp/ansi-fixture/out)\"", True),
    (r"cat > $'\x2ftmp/ansi-fixture/out'", True),
    (r"x=$'\cß' cat > $'\x2ftmp/ansi-fixture/out'", True),
    (r"echo $'a\'b $(cat > /private/tmp/ansi-fixture/out)'", False),
    (r"x=$'a\'b' cat > docs.local/out", False),
])
def test_real_hook_envelopes(tmp_path, tool, command, denied):
    env = {k: v for k, v in os.environ.items() if not k.startswith(('WEAVE_', 'GIT_'))}
    env.update(HOME=str(tmp_path), TMP_BLOCK_LEDGER=str(tmp_path / 'ledger.jsonl'))
    process = subprocess.run([sys.executable, str(HOOK)],
        input=json.dumps({'tool_name': tool, 'tool_input': {'command': command}, 'cwd': str(tmp_path)}),
        text=True, capture_output=True, env=env, cwd=ROOT, timeout=15)
    assert process.returncode == (2 if denied else 0), process.stdout + process.stderr


def test_ansi_c_case_for_and_alias_views():
    assert patterns.case_pattern_groups(r"case x in $'\x78') : ;; esac") == [['x']]
    assert patterns.literal_for_word_counts(r"for x in $'a\'b'; do :; done") == [1]
    assert patterns.builtin_alias_eligibility(r"x=$'a\'b' builtin echo") == [True]


def test_matching_case_write_is_visible():
    assert tmp_policy.find_temp_targets('Bash', {'command':
        r"case x in $'\x78') cat > /private/tmp/ansi-fixture/out ;; esac"})


def test_control_escape_cannot_consume_the_closing_quote():
    assert shell_parse._shell_tokens(r"x=$'\c\\' cat > docs.local/out") == [
        'x=\x1c\\', 'cat', '>', 'docs.local/out']


def test_quoted_function_syntax_cannot_hide_following_write():
    command = r"echo $'a\'b; f() {'; cat > /private/tmp/ansi-fixture/out; echo '}'"
    assert tmp_policy.find_temp_targets('Bash', {'command': command})


def test_empty_decoded_suffix_does_not_swallow_the_next_argument():
    assert shell_parse._shell_tokens(r"echo $(printf safe)$'\0tail' /private/tmp/read-only")[-2:] == [
        ')$', '/private/tmp/read-only']


@pytest.mark.parametrize('delimiter', [r"$'EOF'", r"$'\x45OF'", r"$'a\'b'"])
def test_ansi_c_heredoc_delimiters_keep_executable_suffix(delimiter):
    closing = "a'b" if 'a' in delimiter else 'EOF'
    head = 'cat <<' + delimiter + '\nquoted data\n' + closing + '\n'
    assert tmp_policy.find_temp_targets('Bash', {'command': head + 'cat > /private/tmp/ansi-fixture/out'})
    assert guardian.dangerous_shell_reason(head + 'git push --force origin master')


def test_data_substitution_collectors_preserve_ansi_quote_boundaries():
    assert shell_parse.dollar_paren_bodies(r"x=$'a\'b' echo \"$(printf safe)\"") == ['printf safe']
    assert shell_parse._backtick_bodies(r"x=$'a\'b' echo \"`printf safe`\"") == ['printf safe']
    assert shell_parse.dollar_paren_bodies(r"echo $'a\'b $(printf inert)'") == []
    assert shell_parse._backtick_bodies(r"echo $'a\'b `printf inert`'") == []


def test_non_ascii_control_escape_is_data_not_a_hook_error():
    command = r"x=$'\cß' cat > $'\x2ftmp/ansi-fixture/out'"
    assert tmp_policy.find_temp_targets('Bash', {'command': command})
