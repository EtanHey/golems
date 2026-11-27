"""Classify real-hook payloads only; never execute deletion commands.

Neon round 1: every removed mktemp-admission attack retains the base denial.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import pytest

ROOT = Path(__file__).resolve().parents[5]
GUARD = ROOT / 'skills/golem-powers/git-guardian/hooks/pre_tool_use.py'
TMP = ROOT / 'skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py'


def run(command, hook=GUARD, env=None):
    env = dict(os.environ, TMPDIR=os.environ.get('TMPDIR') or '/tmp') if env is None else env
    result = subprocess.run([sys.executable, '-I', '-B', str(hook)], text=True,
        input=json.dumps({'tool_name': 'Bash', 'cwd': str(ROOT),
                         'tool_input': {'command': command, 'cwd': str(ROOT)},
                         'session_id': 'temp-root-proof'}), capture_output=True, timeout=15, env=env)
    assert not result.stderr, result.stderr
    assert result.returncode in (0, 2), result.stdout
    return result.returncode, result.stdout


NEON_CASES = [
    pytest.param('s=$(mktemp -d); s+=/../../../../etc; rm -r "$s"', id='append-assign-review-etc'),
    pytest.param('s=~/Gits; (s=$(mktemp -d)); rm -r "$s"', id='subshell-mktemp-keeps-outer-s'),
    pytest.param('(s=$(mktemp -d)); rm -r "$s"', id='subshell-mktemp-inherited-s'),
    pytest.param('s=$(mktemp -d); { s=~/Gits; }; rm -r "$s"', id='brace-group-reassign'),
    pytest.param('s=$(mktemp -d); s+=/../../../../etc; rm -r "$s"', id='append-assign-traversal'),
    pytest.param('s=$(mktemp -d); s[0]=~/Gits; rm -r "$s"', id='array-index-0-reassign'),
    pytest.param('s=$(mktemp -d); for s in ~/Gits; do rm -r "$s"; done', id='for-loop-reassign'),
    pytest.param('s=$(mktemp -d); readarray -t s <<< ~/Gits; rm -r "$s"', id='readarray-reassign'),
    pytest.param('s=$(mktemp -d); mapfile -t s <<< ~/Gits; rm -r "$s"', id='mapfile-reassign'),
    pytest.param('s=$(mktemp -d); builtin read -r s <<< ~/Gits; rm -r "$s"', id='builtin-read-reassign'),
    pytest.param('s=$(mktemp -d); printf \'-v\' s %s ~/Gits; rm -r "$s"', id='printf-quoted-v-reassign'),
    pytest.param('s=$(mktemp -d); printf -vs %s ~/Gits; rm -r "$s"', id='printf-attached-v-reassign'),
    pytest.param('a\'l\'ias mktemp=\'echo /etc\'; s=$(mktemp -d); rm -r "$s"', id='quoted-alias-mktemp'),
    pytest.param('s=$(mktemp -d); \'eval\' \'s=~/Gits\'; rm -r "$s"', id='quoted-eval-reassign'),
    pytest.param('s=~/Gits; false && s=$(mktemp -d) && true; rm -r "$s"', id='and-chain-false-conditional'),
    pytest.param('s=$(mktemp -d) || s=/; rm -r "$s"', id='or-fallback-reassign'),
    pytest.param('s="$(mktemp -t a>&2;cd;pwd)"; rm -r "$s"', id='quoted-cmdsub-semicolon-home'),
    pytest.param('s="$(mktemp -t a>&2;pwd)"; rm -r "$s"', id='quoted-cmdsub-semicolon-cwd'),
    pytest.param('s="$(mktemp -t a>&2\ncd\npwd)"; rm -r "$s"', id='quoted-cmdsub-newline-home'),
    pytest.param('s="$(mktemp -t a|cat)"; rm -r "$s"', id='quoted-cmdsub-pipe'),
    pytest.param('s="$(mktemp -d --suffix=a>&2;cd;pwd)"; rm -r "$s"', id='quoted-cmdsub-suffix-semicolon'),
    pytest.param("s=$(mktemp -d -t ' .. '); rm -r $s", id='unquoted-s-space-dotdot'),
    pytest.param("s=$(mktemp -d -t ' -f .. '); rm -r $s", id='unquoted-s-space-flag-dotdot'),
    pytest.param("s=$(mktemp -d -t ' * '); rm -r $s", id='unquoted-s-space-glob'),
    pytest.param('IFS=/; s=$(mktemp -d); rm -r $s', id='unquoted-s-ifs-slash'),
    pytest.param('s=$(mktemp -u "$TMPDIR"); rm -r "$s"', id='mktemp-u-tmpdir-root'),
    pytest.param('s=$(mktemp -u /tmp/); rm -r "$s"', id='mktemp-u-tmp-slash-root'),
    pytest.param('s=$(mktemp -u "$TMPDIR/."); rm -r "$s"', id='mktemp-u-tmpdir-dot'),
    pytest.param('s=$(mktemp -d -t foo bar.XXXXXX); rm -r "$s"', id='mktemp-bsd-t-plus-rel-template'),
    pytest.param('s=$(mktemp -d ~/x.XXXXXX); rm -r "$s"', id='mktemp-dir-outside-temp'),
    pytest.param('s=$(mktemp -p ~ -d); rm -r "$s"', id='mktemp-p-home'),
    pytest.param('s=$(mktemp -d); cd "$s"; rm -rf .', id='cd-fresh-rm-rf-dot'),
    pytest.param('s=$(mktemp); cd "$s"; rm -r .', id='cd-fresh-file-rm-r-dot'),
    pytest.param('s=$(mktemp); cd "$s"; rm -rf .', id='cd-fresh-file-rm-rf-dot'),
    pytest.param('s=$(mktemp -d); cd "$s"; rm -r ..', id='cd-fresh-rm-r-dotdot'),
    pytest.param('s=$(mktemp -d); cd "$s"; cd ..; rm -r .', id='cd-fresh-cd-dotdot-rm-r-dot'),
    pytest.param('s=$(mktemp -d); cd "$s"; cd ../..; rm -r .', id='cd-fresh-cd-dotdot2-rm-r-dot'),
    pytest.param('s=$(mktemp -d); mv ~/Gits "$s"', id='mv-important-to-fresh'),
    pytest.param('s=$(mktemp -d); mv -t "$s" ~/Gits', id='mv-t-fresh-important'),
    pytest.param('s=$(mktemp -d); find -L "$s" -delete', id='find-L-fresh-delete'),
    pytest.param('s=$(mktemp -d); find "$s" -L -delete', id='find-fresh-L-delete'),
    pytest.param('s=$(mktemp -d); rm -r "$s" ~/x', id='fresh-plus-extra-operand'),
    pytest.param('s=$(mktemp -d); rm -r "${s}/.."', id='fresh-braced-dotdot'),
    pytest.param('s=$(mktemp -d); rm -r "$s"*', id='fresh-glob-star'),
    pytest.param('s=$(mktemp -d); rm -r "$s" ~/Gits', id='extra-op-gits'),
    pytest.param('s=$(mktemp -d); rm -r "$s" ~/Desktop', id='extra-op-desktop'),
    pytest.param('s=$(mktemp -d); cd "$s"; rm -rf ./sub', id='cd-fresh-dir-rm-rf-sub'),
    pytest.param('s=$(mktemp -d); find "$s" -exec rm -rf {} +', id='find-exec-rm-rf-fresh'),
    pytest.param('s=$(mktemp -d); command rm -rf "$s"', id='command-rm-rf-fresh'),
    pytest.param('s=$(mktemp -d); env s=~/Gits bash -c \'rm -r "$s"\'', id='env-bash-c-fresh'),
    pytest.param('s=$(mktemp -d); sh -c \'s=~/Gits; rm -r "$s"\'', id='sh-c-reassign-fresh'),
    pytest.param('s=$(mktemp -d); bash -c \'rm -rf "$s"\'', id='bash-c-fresh-rm-rf'),
    pytest.param('s=$(mktemp -d); d="$s"; rm -rf "$d"', id='copy-var-rm-rf'),
    pytest.param('s=$(mktemp -d); d="$s"; rm -r "$d"', id='copy-var-rm-r'),
    pytest.param('export s=$(mktemp -d); rm -r "$s"', id='export-fresh-rm-r'),
    pytest.param('s=$(mktemp -d); rm -r "$s" -f', id='rm-r-s-trailing-f'),
]


@pytest.mark.parametrize('command', NEON_CASES)
def test_neon_removed_admission_stays_denied(command):
    assert run(command)[0] == 2


@pytest.mark.parametrize('command', [
    'rm -r "$TMPDIR"', 'rm -r "${TMPDIR}"', 'rm -r "$TMPDIR/"', 'rm -r "$TMPDIR/."',
    'rm -r /tmp', 'rm -r /private/tmp', 'rm -r /var/tmp', 'rm -r /private/var/tmp',
    'rm -r /private/var/folders/ab/synthetic/T', 'rm -r /var/folders/ab/synthetic/T',
    'rm -r /private/var/folders/ab/synthetic/t', 'rm -r /var/folders/ab/synthetic/t',
    'cd "$TMPDIR"; rm -r .', 'mv "$TMPDIR" ./docs.local/moved',
    'rmdir "$TMPDIR"', 'find "$TMPDIR" -delete',
])
def test_temp_root_refused(command):
    assert run(command)[0] == 2


def test_physical_case_and_symlink_alias(tmp_path):
    root = os.environ.get('TMPDIR') or '/tmp'
    alias = tmp_path / 'temp-alias'
    alias.symlink_to(root, target_is_directory=True)
    assert run(f'rm -r "{alias}"')[0] == 2
    assert run(f'rm -r "{os.path.realpath(root).swapcase()}"')[0] == 2


@pytest.mark.parametrize('command', ['rm -r "$TMPDIR/normal-child"',
    'scratch="$TMPDIR/normal-child"; rm -r "$scratch"',
    'rmdir "$TMPDIR/normal-child"'])
def test_literal_child_unchanged(command):
    assert run(command)[0] == 0


def test_unresolved_hint():
    code, output = run('rm -r "$unresolved_scratch"')
    assert code == 2
    reason = json.loads(output)['reason']
    assert 'Name the path literally, e.g. rm -r "$TMPDIR/<dir>".' in reason
    assert 'assign it from mktemp' not in reason


@pytest.mark.parametrize('command', ['echo durable > "$TMPDIR/unlisted-proof.md"',
    'scratch=$(mktemp -d); echo durable > "$scratch/report.md"'])
def test_writes_still_denied(command):
    assert run(command, TMP)[0] == 2


@pytest.mark.parametrize('command,denied', [
    ('scratch=$(mktemp -d); rm -r "$scratch"', True),
    ('rm -r "$TMPDIR"', True), ('rm -r "$missing_scratch"', True),
    ('rm -r "$TMPDIR/normal-child"', False),
    ('s="$(mktemp -t a>&2;cd;pwd)"; rm -r "$s"', True)])
def test_codex_transport(command, denied):
    result = subprocess.run([sys.executable, '-I', '-B', str(ROOT / 'scripts/hooks/codex-policy-hook.py'),
                             'git-guardian'], text=True, capture_output=True, timeout=15,
        env=dict(os.environ, TMPDIR=os.environ.get('TMPDIR') or '/tmp'),
        input=json.dumps({'tool_name': 'Bash', 'cwd': str(ROOT), 'tool_input': {'command': command}}))
    assert result.returncode == 0 and not result.stderr, result.stdout + result.stderr
    decision = json.loads(result.stdout).get('hookSpecificOutput', {}).get('permissionDecision')
    assert (decision == 'deny') == denied
