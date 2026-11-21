"""Quoted-program redirects are inspected within one word, never across words."""
import pytest

from test_secret_writes import hook


@pytest.mark.parametrize('command', [
    "awk '{print > \".env\"}' safe",
    "awk '{print >> \".env\"}' safe",
    "gawk '{print > \".env\"}' safe",
    "perl -e 'open(F, \">.env\"); print F \"x\"'",
])
def test_quoted_program_redirect_stays_guarded(tmp_path, command):
    assert hook(tmp_path, 'Bash', command=command) == 2


def test_separate_quoted_operator_and_name_are_data(tmp_path):
    assert hook(tmp_path, 'Bash', command="echo '>' .env") == 0
