"""Synthetic inputs sent through the real hook; commands are never executed."""
import json
import os
from pathlib import Path
import subprocess

import pytest

HOOK = Path(os.environ.get('GUARD_TEST_HOOK', Path(__file__).resolve().parents[1] / 'pre_tool_use.py'))


def hook(cwd, tool, **inputs):
    env = {k: v for k, v in os.environ.items() if k not in ('CLAUDE_WORKER', 'GIT_GUARDIAN_LIB')}
    result = subprocess.run(['python3', str(HOOK)], input=json.dumps({
        'cwd': str(cwd), 'tool_name': tool, 'tool_input': inputs,
    }), text=True, capture_output=True, env=env, cwd=cwd)
    assert result.returncode in (0, 2), result.stderr
    return result.returncode


SCHEMA = '# @defaultSensitive=false\n\n# @type=number\nPORT=3000\n\n# @sensitive @type=string\nAPI_TOKEN=\n'


def test_row1_tracked_schema_edit(tmp_path):
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    schema = tmp_path / '.env.schema'
    schema.write_text(SCHEMA)
    subprocess.run(['git', 'add', '.env.schema'], cwd=tmp_path, check=True)
    assert hook(tmp_path, 'Edit', file_path=str(schema), old_string='3000', new_string='4000') == 0


@pytest.mark.parametrize('content', [SCHEMA + 'PASSWORD=synthetic-private-value\n', 'TOKEN=synthetic-private-value\n'])
def test_row1_secret_schema_kept_refused(tmp_path, content):
    schema = tmp_path / '.env.schema'
    schema.write_text(content)
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    subprocess.run(['git', 'add', '.env.schema'], cwd=tmp_path, check=True)
    assert hook(tmp_path, 'Edit', file_path=str(schema), old_string='value', new_string='other') == 2


def test_row1_inserting_value_stays_refused(tmp_path):
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    schema = tmp_path / '.env.schema'
    schema.write_text(SCHEMA)
    subprocess.run(['git', 'add', '.env.schema'], cwd=tmp_path, check=True)
    assert hook(tmp_path, 'Edit', file_path=str(schema), old_string='API_TOKEN=', new_string='API_TOKEN=synthetic-private-value') == 2
    assert hook(tmp_path, 'Write', file_path=str(schema), content='TOKEN=synthetic-private-value\n') == 2


@pytest.mark.parametrize('command', [
    "sed -i 's/a/b/' .env", "sed -i '' 's/a/b/' '.env.local'",
    "printf x > .env", "printf x >> '.env.local'", "printf x | tee .env",
    "tee -a config/secrets.yaml", "perl -pi -e 's/a/b/' credentials.json",
    'cp safe .env', 'mv safe credentials.json', 'cp -t config .env',
    "node -e 'console.log(1)' > .env", 'cat safe 1>.env',
    "sed --in-place=.bak 's/a/b/' config/secrets.yaml",
    "env LANG=C sed -i 's/a/b/' .env", 'sh -c "tee .env"',
])
def test_row2_shell_writes(tmp_path, command):
    assert hook(tmp_path, 'Bash', command=command) == 2


@pytest.mark.parametrize('command', [
    'cat .env', "sed -n '1p' .env", "perl -ne 'print' credentials.json",
    'cp .env backup.txt', 'cat < .env', "echo 'tee .env'", 'cat .env | tee notes.txt',
    'cat tee .env', 'echo tee .env', "echo '>' .env",
])
def test_row2_reads_kept_allowed(tmp_path, command):
    assert hook(tmp_path, 'Bash', command=command) == 0


def test_secret_edit_kept_refused(tmp_path):
    assert hook(tmp_path, 'Edit', file_path=str(tmp_path / '.env'), old_string='a', new_string='b') == 2


def test_sensitive_numeric_default_stays_refused(tmp_path):
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    schema = tmp_path / '.env.schema'
    schema.write_text('# @type=number\nPIN=1234\n')
    subprocess.run(['git', 'add', '.env.schema'], cwd=tmp_path, check=True)
    assert hook(tmp_path, 'Edit', file_path=str(schema), old_string='1234', new_string='5678') == 2


def test_copy_into_directory_resolves_destination(tmp_path):
    (tmp_path / 'config').mkdir()
    assert hook(tmp_path, 'Bash', command='cp .env config') == 2
    assert hook(tmp_path, 'Bash', command='cp safe.txt config') == 0


@pytest.mark.parametrize('tool', ['Edit', 'Write'])
@pytest.mark.parametrize('existing', [False, True])
@pytest.mark.parametrize('comment', ['# API_TOKEN=synthetic-private-value\n', '# @API_TOKEN=synthetic-private-value\n'])
def test_r1_schema_comment_values_stay_guarded(tmp_path, tool, existing, comment):
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    schema = tmp_path / '.env.schema'
    safe = '# Configure the application\nTOKEN=\n'
    schema.write_text(safe + (comment if existing else ''))
    subprocess.run(['git', 'add', '.env.schema'], cwd=tmp_path, check=True)
    inputs = {'file_path': str(schema)}
    if tool == 'Write':
        inputs['content'] = safe.replace('Configure', 'Configure safely') + comment
    else:
        inputs.update(old_string='# Configure the application',
                      new_string='# Configure safely' + ('' if existing else '\n' + comment))
    assert hook(tmp_path, tool, **inputs) == 2


def test_r1_schema_documentation_and_annotations_remain_allowed(tmp_path):
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    schema = tmp_path / '.env.schema'
    schema.write_text(SCHEMA)
    subprocess.run(['git', 'add', '.env.schema'], cwd=tmp_path, check=True)
    content = '# Configure the application\n# @required\n' + SCHEMA
    assert hook(tmp_path, 'Write', file_path=str(schema), content=content) == 0


@pytest.mark.parametrize('command', ['F=".env"; cp safe "$F"', 'F=".env"; mv safe "$F"'])
def test_r1_variable_destinations_stay_guarded(tmp_path, command):
    assert hook(tmp_path, 'Bash', command=command) == 2


def test_r1_variable_source_read_remains_allowed(tmp_path):
    assert hook(tmp_path, 'Bash', command='F=".env"; cp "$F" backup.txt') == 0


@pytest.mark.parametrize('name', ['.envfoo', '.env_schema'])
@pytest.mark.parametrize('tool', ['Bash', 'Edit'])
def test_r1_env_prefixed_paths_stay_guarded(tmp_path, name, tool):
    inputs = ({'command': 'printf x > ' + name} if tool == 'Bash' else
              {'file_path': str(tmp_path / name), 'old_string': 'a', 'new_string': 'b'})
    assert hook(tmp_path, tool, **inputs) == 2
