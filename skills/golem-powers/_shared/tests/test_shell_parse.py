"""Parser-level tests for _shared/shell_parse.py (GO-5 S13 test split).

Moved from tmp-block/hooks/tests/test_tmp_block.py: these pin the tokenizer
itself, not tmp-block policy, so they live next to the parser.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import shell_parse  # noqa: E402


def test_executable_shell_structure_masks_data_but_keeps_process_substitutions():
    command = (
        "bash <(echo safe); echo 'source <(quoted)' ; "
        "x=$(bash <(echo nested)); cat <<'EOF'\nsource <(heredoc)\nEOF\n"
    )

    structural = shell_parse.executable_shell_structure(command)

    assert "bash <(echo safe)" in structural
    assert "source <(quoted)" not in structural
    assert "bash <(echo nested)" not in structural
    assert "source <(heredoc)" not in structural
    assert len(structural) == len(command)


def test_process_substitution_parser_stops_at_the_matched_span():
    command = "bash <(printf '%s' ')') ; echo 'later odd ` data'"
    start = command.index("<(")

    body, end = shell_parse.process_substitution_at(command, start)

    assert body == "printf '%s' ')'"
    assert command[start:end] == "<(printf '%s' ')')"


# Golden token streams: what master's tokenizers produced for each input before
# the py/redos fix, pasted as data (the vulnerable patterns stay out of the tree).
# Each row is (source, _RAW_SHELL_TOKEN_RE tokens, _RAW_FOR_WORD_RE tokens).
@pytest.mark.parametrize(
    ("source", "expected_shell", "expected_words"),
    [
        (
            'case x in "a\\\nb") echo;; esac',
            ['case', 'x', 'in', '"a\\\nb"', ')', 'echo', ';;', 'esac'],
            ['case', 'x', 'in', '"a\\\nb"', ')', 'echo;;', 'esac'],
        ),
        (
            'x "p\\\n q" y',
            ['x', '"p\\\n q"', 'y'],
            ['x', '"p\\\n q"', 'y'],
        ),
        (
            'for w in "a\\\nb" c; do echo "$w"; done',
            ['for', 'w', 'in', '"a\\\nb"', 'c', ';', 'do', 'echo', '"$w"', ';', 'done'],
            ['for', 'w', 'in', '"a\\\nb"', 'c;', 'do', 'echo', '"$w"', ';', 'done'],
        ),
        (
            'echo "abc\\"',
            ['echo', '"abc\\"'],
            ['echo', '"abc\\"'],
        ),
        (
            'echo "a\\\\" b',
            ['echo', '"a\\\\"', 'b'],
            ['echo', '"a\\\\"', 'b'],
        ),
        (
            'case $1 in "x y"|z) true;; *) false;; esac',
            ['case', '$1', 'in', '"x y"', '|', 'z', ')', 'true', ';;', '*', ')', 'false', ';;', 'esac'],
            ['case', '$1', 'in', '"x y"', '|z)', 'true;;', '*)', 'false;;', 'esac'],
        ),
        (
            'for x in \'a b\' "c d" e; do :; done',
            ['for', 'x', 'in', "'a b'", '"c d"', 'e', ';', 'do', ':', ';', 'done'],
            ['for', 'x', 'in', "'a b'", '"c d"', 'e;', 'do', ':;', 'done'],
        ),
    ],
)
def test_bounded_tokenizers_keep_masters_token_stream(source, expected_shell, expected_words):
    assert shell_parse._RAW_SHELL_TOKEN_RE.findall(source) == expected_shell
    assert shell_parse._RAW_FOR_WORD_RE.findall(source) == expected_words


def test_quoted_backslash_newline_stays_one_token():
    tokens = shell_parse._RAW_SHELL_TOKEN_RE.findall('case x in "a\\\nb") echo;; esac')
    assert '"a\\\nb"' in tokens


def test_data_dollar_paren_scanner_keeps_closing_parens_inside_quotes_opaque():
    command = "echo $(printf '%s' ')'; echo tail)"
    assert shell_parse.dollar_paren_bodies(command) == ["printf '%s' ')'; echo tail"]
    assert shell_parse.without_dollar_paren_bodies(command) == "echo $()"


def test_data_dollar_paren_scanner_handles_nested_and_mixed_quotes():
    command = '''echo $(printf "%s" ")"; echo $(printf '%s' ')'); echo `printf "%s" ")"`)'''
    assert shell_parse.dollar_paren_bodies(command) == [
        '''printf "%s" ")"; echo $(printf '%s' ')'); echo `printf "%s" ")"`'''
    ]
    assert shell_parse.without_dollar_paren_bodies(command) == "echo $()"


@pytest.mark.parametrize(
    "command",
    (
        "$(printf %s $'a\\')'; echo tail)",
        '$(: "${x:-")"}"; echo tail)',
        "$(case x in x) echo tail;; esac)",
        "$(: ${x:-)}; echo tail)",
        "$(true # )\necho tail)",
    ),
)
def test_data_dollar_paren_scanner_keeps_shell_delimiters_inside_nested_syntax(command):
    assert shell_parse.dollar_paren_bodies(command) == [command[2:-1]]


def test_deep_nested_substitution_is_a_complete_valid_parse():
    command = 'echo "$(echo "$(echo "$(echo /tmp/deep)")")"'
    assert shell_parse.shell_text_without_heredoc_bodies(command) == command


def test_data_argument_masking_keeps_only_executable_nested_content():
    command = "git commit -m \"$(cat <<'EOF'\nfix: don't (break) `things`\nEOF\n)\""
    reduced = shell_parse.shell_text_without_heredoc_bodies(command)
    assert reduced.startswith('git commit -m "$(')
    assert "don't" not in reduced and "`things`" not in reduced


def test_data_backtick_scanner_does_not_treat_backslash_as_escape_in_single_quotes():
    assert shell_parse._backtick_bodies("echo 'a\\' `printf safe`") == ["printf safe"]


def test_data_backtick_scanner_handles_double_and_single_quoted_regions():
    command = '''echo "`printf double`" '`printf literal`' `printf '%s' "mixed"`'''
    assert shell_parse._backtick_bodies(command) == [
        "printf double",
        '''printf '%s' "mixed"''',
    ]


@pytest.mark.parametrize(
    "command",
    (
        "echo $(printf '%s' ')'; echo tail",
        'echo $(printf "%s" ")"; echo tail',
        "echo `printf safe",
    ),
)
def test_data_substitution_scanners_reject_unterminated_bodies(command):
    scanner = (
        shell_parse._backtick_bodies
        if "`" in command
        else shell_parse.dollar_paren_bodies
    )
    with pytest.raises(ValueError, match="unterminated command substitution"):
        scanner(command)
