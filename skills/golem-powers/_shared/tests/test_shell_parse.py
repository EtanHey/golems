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
