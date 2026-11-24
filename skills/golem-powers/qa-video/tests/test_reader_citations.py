"""Run the real batch CLI with offline text fixtures; never calls a provider."""
import json
from pathlib import Path
import subprocess
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/visual-batch.py'


@pytest.mark.parametrize('finding,valid', [
    ('T0: panel visible.', True), ('T12: panel visible.', True),
    ('frame T0: panel visible.', True),
    ('(tiles 0-19, row-major): panel visible.', True),
    ('(tiles 0-19): panel visible.', True),
    ('[19]: panel visible.', True),
    ('T20: panel visible.', False), ('T-1: panel visible.', False),
    ('T0.5: panel visible.', False), ('[364]: panel visible.', False),
    ('tile 20: panel visible.', False), ('Panel visible.', False),
    ('Coverage: 1/1; complete;', False),
    ('tile 0: label "T999" visible.', True),
    ('tile 0: T999: panel visible.', False),
    ('rows 5-14: panel visible.', False),
    ('T0-25: panel visible.', False),
])
def test_reader_citation_cli(tmp_path, finding, valid):
    (tmp_path / 'sheet.png').write_bytes(b'offline image fixture')
    (tmp_path / 'index.tsv').write_text('sheet.png\t0\t2\t20\tsynthetic\n')
    (tmp_path / 'frames.tsv').write_text('sheet_file\ttile\tpts_s\n' + ''.join(
        f'sheet.png\t{i}\t{i}\n' for i in range(20)))
    helper = tmp_path / 'helper.py'
    helper.write_text("print('Coverage: 1/1; complete;')\nprint(" + repr(finding) + ")\n")
    result = subprocess.run([sys.executable, str(SCRIPT), '--helper', str(helper),
                             '--index', str(tmp_path / 'index.tsv'), '--workdir', str(tmp_path),
                             '--question', 'facts'], capture_output=True, text=True, timeout=10)
    summary = json.loads(result.stdout)
    assert (summary['sheets'][0]['state'] == 'READ') == valid, summary
    assert (result.returncode == 0) == valid


def test_timestamp_is_seconds_not_tile_number(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location('batch_time', SCRIPT)
    batch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(batch)
    sheet = tmp_path / 'sheet.png'
    (tmp_path / 'frames.tsv').write_text('sheet_file\ttile\tpts_s\n' + ''.join(
        f'sheet.png\t{i}\t{i / 2}\n' for i in range(20)))
    for text, state in [('T9: visible', 'READ'), ('T12: visible', 'INVALID')]:
        assert batch.validate(dict(sheet=str(sheet), ok=True, finding=text), 20)['state'] == state
    assert batch.validate(dict(sheet=str(sheet), ok=True, finding='[364]: visible'), 400)['state'] == 'READ'
    assert batch.validate(dict(ok=True, finding='T0: visible'), 20)['state'] != 'READ'
