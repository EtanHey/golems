"""Public operator mechanics use benign commands; policy specimens stay private."""
import pytest
from test_repo_parent_rm import guardian, workspace

parametrize = pytest.mark.parametrize


@parametrize('operand', ["';'", "'('", '"&"', r'\;', r'\|'])
def test_quoted_and_escaped_operators_remain_operands(operand):
    words = guardian._shell_operator_words('printf %s ' + operand)
    assert any(word in {';', '(', '&', '|'} and not operator
               for word, operator in words)


def test_operator_metadata_distinguishes_fd_duplication_from_separators():
    words = guardian._shell_operator_words('git status 2>&1; printf done & echo harmless')
    separators = [word for word, operator in words if operator and word in {';', '&'}]
    assert separators == [';', '&']
    assert ('>&', True) in words
    assert ('&', False) in guardian._shell_operator_words("echo '&'")


@parametrize('command', [
    "git log --format=';'", "railway status ';'", 'git status 2>&1',
    '2>&1 git status', 'git 2>log status', 'echo $((1 + $(printf 2)))',
    'echo harmless # unclosed " quote\n git status',
])
def test_operator_data_and_ordinary_substitutions_allow(workspace, command):
    _, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo)) is None
