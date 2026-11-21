"""Opus table rows: synthetic payloads reach the real hook, never a shell."""
import subprocess

import pytest

from test_secret_writes import hook


WRITER_ROWS = [
    ('cp-trailing-force', 'cp safe .env -f'),
    ('cp-trailing-backup', 'cp safe .env --backup'),
    ('cp-trailing-verbose', 'cp safe .env -v'),
    ('cp-relative-trailing-interactive', 'cp safe ./.env -i'),
    ('cp-recursive-trailing-preserve', 'cp -R safe .env -p'),
    ('gcp', 'gcp safe .env'),
    ('gcp-trailing-force', 'gcp safe .env -f'),
    ('gmv', 'gmv safe .env'),
    ('mv-trailing-force', 'mv safe .env -f'),
    ('install', 'install safe .env'),
    ('ginstall', 'ginstall -m 600 safe .env'),
    ('dd', 'dd if=safe of=.env'),
    ('ln-symbolic', 'ln -s safe .env'),
    ('ln-symbolic-force', 'ln -sf safe .env'),
    ('truncate', 'truncate -s0 .env'),
    ('rsync', 'rsync safe .env'),
    ('sponge', 'sponge .env'),
    ('gsed', "gsed -i 's/a/b/' .env"),
    ('gtee', 'gtee .env'),
    ('redirect-glob', 'printf x > .en?'),
    ('sed-glob', "sed -i 's/a/b/' .en*"),
    ('cp-glob', 'cp safe .en?'),
]


@pytest.mark.parametrize('row,command', WRITER_ROWS, ids=[row for row, _ in WRITER_ROWS])
def test_opus_writer_row(tmp_path, row, command):
    assert hook(tmp_path, 'Bash', command=command) == 2, row


COMMENT_ROWS = [
    ('description-token', '# @description=sk_live_SYNTHETIC_fixture_value'),
    ('colon-token', '# token: SYNTHETICfakevalue0123456789abcdef'),
    ('jwt', '# eyJhbGciOiJub25lIn0.eyJhIjoxfQ.c2ln'),
    ('short-key-prefix', '# @description=sk_live_demo'),
    ('hex-run', '# deadbeef0123456789ab'),
    ('base64-run', '# YWJjZGVmZ2hpamtsbW5v'),
    ('type-grammar', '# @type=unsupported'),
    ('sensitive-grammar', '# @sensitive=synthetic'),
    ('description-length', '# @description=' + ('local port ' * 12)),
]


def tracked_schema(tmp_path):
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    path = tmp_path / '.env.schema'
    path.write_text('TOKEN=\n')
    subprocess.run(['git', 'add', '.env.schema'], cwd=tmp_path, check=True)
    return path


@pytest.mark.parametrize('row,comment', COMMENT_ROWS, ids=[row for row, _ in COMMENT_ROWS])
@pytest.mark.parametrize('tool', ['Edit', 'Write'])
def test_opus_comment_row(tmp_path, row, comment, tool):
    path = tracked_schema(tmp_path)
    content = 'TOKEN=\n' + comment + '\n'
    inputs = {'content': content} if tool == 'Write' else {
        'old_string': 'TOKEN=\n', 'new_string': content,
    }
    assert hook(tmp_path, tool, file_path=str(path), **inputs) == 2, row


@pytest.mark.parametrize('value', ['1234567', '1234567890123456'])
def test_opus_public_number_cap(tmp_path, value):
    path = tracked_schema(tmp_path)
    content = '# @public @type=number\nACCOUNT=' + value + '\n'
    assert hook(tmp_path, 'Write', file_path=str(path), content=content) == 2


@pytest.mark.parametrize('command', [
    'gcp .env backup.txt -f', 'cp -- .env backup.txt',
    "gsed -n '1p' .env", 'dd if=.env of=notes.txt',
    'install -m 600 safe notes.txt', 'ln -sf safe notes.txt',
    'truncate -s0 notes.txt', 'rsync safe notes.txt', 'sponge notes.txt',
    "sed -i 's|a*|b|' notes.txt", "perl -pi -e 's|a*|b|' notes.txt",
])
def test_opus_unguarded_writes_and_reads(tmp_path, command):
    assert hook(tmp_path, 'Bash', command=command) == 0


def test_opus_short_public_defaults_and_prose(tmp_path):
    path = tracked_schema(tmp_path)
    content = ('# @description=Local development port.\n'
               '# @public @type=number\nPORT=123456\n\n'
               '# @public @type=boolean\nENABLED=true\n')
    assert hook(tmp_path, 'Write', file_path=str(path), content=content) == 0


def test_opus_nonempty_string_defaults_remain_refused(tmp_path):
    path = tracked_schema(tmp_path)
    assert hook(tmp_path, 'Write', file_path=str(path),
                content='# @public @type=string\nVALUE=short\n') == 2
