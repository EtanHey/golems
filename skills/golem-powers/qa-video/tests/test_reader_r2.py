"""Round-two reviewer repros. Synthetic data only, no model/credential calls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

S = Path(__file__).parents[1] / 'scripts'


def seed(work, image, run_id='current'):
    (work/'visual').mkdir(exist_ok=True)
    (work/'visual/run.json').write_text(json.dumps({'run_id': run_id, 'started_ns': 1}))
    (work/'visual/cost-admission.json').write_text(json.dumps({
        'run_id': run_id, 'status': 'ADMITTED', 'sheets': [str(image)],
        'image_sha256': {str(image): hashlib.sha256(image.read_bytes()).hexdigest()},
        'price_per_sheet_usd': .1, 'estimated_usd': .1}))


def check(work, session):
    return subprocess.run([sys.executable, str(S/'reader-policy.py'), str(work), str(session)],
                          capture_output=True, text=True)


def native(work, *, error=False, pointer=False):
    directory = work/'must-read' if pointer else work/'dense'
    directory.mkdir()
    image = directory/'frame.png'; image.write_bytes(b'synthetic')
    seed(work, image)
    session = work/'judge.jsonl'
    session.write_text('\n'.join(map(json.dumps, [
        {'type': 'assistant', 'message': {'content': [
            {'type': 'tool_use', 'id': 'read1', 'name': 'Read', 'input': {'file_path': str(image)}}]}},
        {'type': 'user', 'message': {'content': [
            {'type': 'tool_result', 'tool_use_id': 'read1', 'is_error': error,
             'content': 'error opening image' if error else [{'type': 'image', 'source': {}}]}]}}
    ])))
    return image, session


def test_failed_native_read_does_not_admit(tmp_path):
    image, session = native(tmp_path, error=True)
    result = check(tmp_path, session)
    assert result.returncode != 0 and 'no frames were read' in result.stderr


def test_pointer_only_judge_after_gatherer_failures_does_not_admit(tmp_path):
    image, session = native(tmp_path, pointer=True)
    (tmp_path/'visual/summary.json').write_text(json.dumps({
        'run_id': 'current', 'counts': {'READ': 0}, 'sheets': [], 'verdict_allowed': False}))
    result = check(tmp_path, session)
    assert result.returncode != 0 and 'no frames were read' in result.stderr


def test_old_helper_receipt_cannot_satisfy_new_run(tmp_path):
    image = tmp_path/'frame.png'; image.write_bytes(b'same synthetic pixels')
    seed(tmp_path, image, 'new-run')
    receipts = tmp_path/'helper-receipts'; receipts.mkdir()
    (receipts/'old.json').write_text(json.dumps({'run_id': 'old-run', 'exit_code': 0,
        'read_count': 1, 'image_sha256': {str(image): hashlib.sha256(image.read_bytes()).hexdigest()}}))
    session = tmp_path/'judge.jsonl'; session.write_text('')
    result = check(tmp_path, session)
    assert result.returncode != 0 and 'no frames were read' in result.stderr


def test_primary_plan_counts_sixty_sheets_and_holds(tmp_path):
    dense = tmp_path/'dense'; dense.mkdir()
    for i in range(60):
        (dense/f'sheet-{i}.png').write_bytes(b'synthetic')
    (dense/'index.tsv').write_text(''.join(f'sheet-{i}.png\t0\t1\t1\tfixture\n' for i in range(60)))
    result = subprocess.run(['bash', str(S/'default.sh'), 'plan', '/unused.mov', str(tmp_path)],
                            capture_output=True, text=True)
    assert result.returncode != 0
    assert '60 sheets x $0.10 = $6.00' in result.stderr + result.stdout
    admission = json.loads((tmp_path/'visual/cost-admission.json').read_text())
    assert admission['status'] == 'COST_HOLD' and admission['estimated_usd'] == 6


def test_login_command_disables_customizations_and_claude_md(tmp_path):
    spec = importlib.util.spec_from_file_location('helper_r2', S/'claude-image-helper.py')
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    cmd = helper.command('fixture', tmp_path/'settings.json')
    assert '--safe-mode' in cmd
    assert '--bare' not in cmd


def test_new_behavior_eval_cases_exist():
    data = json.loads((S.parent/'evals/evals.json').read_text())
    names = {row['name'] for row in data['evals']}
    assert {'all-readers-fail-stop', 'sixty-sheets-cost-hold'} <= names


def test_successful_nonpointer_result_is_admitted(tmp_path):
    image, session = native(tmp_path)
    assert check(tmp_path, session).returncode == 0


def test_old_summary_cannot_satisfy_new_run(tmp_path):
    image = tmp_path/'frame.png'; image.write_bytes(b'synthetic')
    seed(tmp_path, image, 'new-run')
    (tmp_path/'visual/summary.json').write_text(json.dumps({'run_id': 'old-run', 'sheets': [
        {'sheet': str(image), 'state': 'READ', 'ok': True}]}))
    session = tmp_path/'judge.jsonl'; session.write_text('')
    assert check(tmp_path, session).returncode != 0


def test_gather_cannot_shrink_sixty_sheet_run_to_one_call(tmp_path):
    dense = tmp_path/'dense'; dense.mkdir()
    for i in range(60):
        (dense/f'sheet-{i}.png').write_bytes(b'synthetic')
    (dense/'index.tsv').write_text(''.join(f'sheet-{i}.png\t0\t1\t1\tfixture\n' for i in range(60)))
    result = subprocess.run(['bash', str(S/'default.sh'), 'gather', str(tmp_path), '', 'subset',
        str(dense/'sheet-0.png')], capture_output=True, text=True)
    assert result.returncode != 0
    assert '60 sheets x $0.10 = $6.00' in result.stderr
    assert not (tmp_path/'logs/subset.pid').exists()


def test_replan_same_workdir_ignores_previous_success_then_failed_readers(tmp_path):
    # Use the real fake-CLI fixture: first successful gather, re-plan the same
    # byte-identical image, then a failed provider and pointer-only judge.
    from test_reader_login import fixture, batch
    home, image, env = fixture(tmp_path)
    assert batch(tmp_path, image, env).returncode == 0
    session = tmp_path/'judge.jsonl'; session.write_text('')
    assert check(tmp_path, session).returncode == 0
    first = json.loads((tmp_path/'visual/run.json').read_text())['run_id']
    result = subprocess.run([sys.executable, str(S/'reader-policy.py'), 'plan', str(tmp_path), str(image)],
                            capture_output=True, text=True)
    assert result.returncode == 0
    assert json.loads((tmp_path/'visual/run.json').read_text())['run_id'] != first
    (home/'fail').touch()
    assert batch(tmp_path, image, env).returncode != 0
    blocked = check(tmp_path, session)
    assert blocked.returncode != 0 and 'no frames were read' in blocked.stderr
