"""Parser-level tests for _shared/shell_parse.py (GO-5 S13 test split).

Moved from tmp-block/hooks/tests/test_tmp_block.py: these pin the tokenizer
itself, not tmp-block policy, so they live next to the parser.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import shell_parse  # noqa: E402


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
