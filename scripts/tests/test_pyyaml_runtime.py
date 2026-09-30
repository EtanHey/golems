"""Owned interpreter selection and reproducible bootstrap contracts."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
INSTALL = ROOT / "skills/golem-powers/golem-install/scripts/install-python.sh"
SYNC = ROOT / "scripts/sync/sync-config.sh"
AUDIT = ROOT / "skills/golem-powers/ecosystem-health/scripts/audit.sh"


def run(script, home, *args, env=None, cwd=None):
    return subprocess.run(["bash", str(script), *args], text=True, capture_output=True,
                          cwd=cwd or ROOT, env={**os.environ, "HOME": str(home), **(env or {})})


def config(home):
    repos = home / "repos"
    (repos / "demo").mkdir(parents=True)
    path = home / ".golems/config.yaml"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({"reposPath": str(repos), "mcpServers": {"svc": {"command": "ok"}},
                               "contextProfiles": {"demo": {"mcps": {"allow": ["svc"]}}}}))
    return path


def owned_python(home):
    venv = home / ".golems/venv"
    subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(venv)], check=True)
    # Tiny YAML fixture accepts JSON, which is valid YAML; no dependency/network in tests.
    sites = subprocess.check_output([str(venv / "bin/python3"), "-c",
                                    "import sysconfig; print(sysconfig.get_path('purelib'))"], text=True).strip()
    Path(sites, "yaml.py").write_text(
        'import json\ndef safe_load(data):\n'
        '    return json.loads(data.read() if hasattr(data, "read") else data)\n'
    )
    return venv


def bare_python(home):
    bin_dir = home / "fallback"
    bin_dir.mkdir()
    python = bin_dir / "python3"
    python.write_text(f'#!/bin/bash\nexec "{sys.executable}" -S "$@"\n')
    python.chmod(0o755)
    return {"PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]}


def test_sync_prefers_owned_venv_even_when_path_python_has_no_yaml(tmp_path):
    cfg = config(tmp_path)
    owned_python(tmp_path)
    result = run(SYNC, tmp_path, "--validate", "--config", str(cfg), env=bare_python(tmp_path))
    assert result.returncode == 0, result.stderr
    assert "VALID" in result.stdout.upper()


def test_audit_prefers_owned_yaml_python(tmp_path):
    config(tmp_path)
    owned_python(tmp_path)
    result = run(AUDIT, tmp_path, env=bare_python(tmp_path), cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert "No context profile" in result.stdout


def test_missing_yaml_explains_owned_install_without_traceback(tmp_path):
    cfg = config(tmp_path)
    result = run(SYNC, tmp_path, "--validate", "--config", str(cfg), env=bare_python(tmp_path))
    assert result.returncode == 1
    assert "PyYAML" in result.stderr
    assert "install-python.sh" in result.stderr
    assert "Traceback" not in result.stderr


def test_fallback_current_python_with_yaml(tmp_path):
    cfg = config(tmp_path)
    fallback = owned_python(tmp_path)
    moved = tmp_path / "fallback-venv"
    fallback.rename(moved)
    result = run(SYNC, tmp_path, "--validate", "--config", str(cfg),
                 env={"PATH": str(moved / "bin") + os.pathsep + os.environ["PATH"]})
    assert result.returncode == 0, result.stderr


def test_bootstrap_hash_enforcement_idempotence_and_failures(tmp_path):
    marker = tmp_path / "calls"
    state = tmp_path / "installed"
    venv = tmp_path / ".golems/venv"
    (venv / "bin").mkdir(parents=True)
    python = venv / "bin/python3"
    python.write_text(f'''#!/bin/bash
if [[ "$1" == -c ]]; then [[ -f "{state}" ]]; exit $?; fi
printf '%s\\n' "$*" >> "{marker}"
[[ "${{FAIL_PIP:-}}" == 1 ]] && exit 19
touch "{state}"
''')
    python.chmod(0o755)
    first = run(INSTALL, tmp_path)
    assert first.returncode == 0, first.stderr
    calls = marker.read_text()
    assert "--require-hashes" in calls and "--only-binary=:all:" in calls and "--no-deps" in calls
    assert "python-requirements.txt" in calls
    second = run(INSTALL, tmp_path)
    assert second.returncode == 0, second.stderr
    assert marker.read_text() == calls
    state.unlink()
    failed = run(INSTALL, tmp_path, env={"FAIL_PIP": "1"})
    assert failed.returncode == 19
    assert not state.exists()


def test_copied_audit_remains_self_contained(tmp_path):
    config(tmp_path)
    owned_python(tmp_path)
    copied = tmp_path / 'standalone-audit.sh'
    copied.write_bytes(AUDIT.read_bytes())
    result = run(copied, tmp_path, env=bare_python(tmp_path), cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert 'No context profile' in result.stdout


def test_standard_setup_dry_run_does_not_create_venv(tmp_path):
    shim = tmp_path / 'bin'
    shim.mkdir()
    brew = shim / 'brew'
    brew.write_text('#!/bin/bash\nexit 0\n')
    brew.chmod(0o755)
    result = run(INSTALL.with_name('install-deps.sh'), tmp_path, '--dry-run', '--all',
                 env={'PATH': str(shim) + os.pathsep + os.environ['PATH']})
    assert result.returncode == 0, result.stderr
    assert 'install-python.sh' in result.stdout
    assert not (tmp_path / '.golems/venv').exists()


def missing_owned_yaml_with_working_path_python(home):
    venv = owned_python(home)
    next(venv.glob('lib/python*/site-packages/yaml.py')).unlink()
    fallback_home = home / 'path-python'
    fallback_home.mkdir()
    fallback = owned_python(fallback_home)
    return {'PATH': str(fallback / 'bin') + os.pathsep + os.environ['PATH']}


def test_owned_venv_without_yaml_does_not_fall_back_to_working_path_python(tmp_path):
    cfg = config(tmp_path)
    env = missing_owned_yaml_with_working_path_python(tmp_path)
    result = run(SYNC, tmp_path, '--validate', '--config', str(cfg), env=env)
    assert result.returncode == 1
    assert 'PyYAML' in result.stderr and 'install-python.sh' in result.stderr
    assert 'Traceback' not in result.stderr
    assert 'VALID' not in result.stdout.upper()


def test_audit_preflight_explains_missing_owned_yaml_before_profile_parse(tmp_path):
    config(tmp_path)
    env = missing_owned_yaml_with_working_path_python(tmp_path)
    result = run(AUDIT, tmp_path, env=env, cwd=tmp_path)
    assert result.returncode == 1
    assert 'PyYAML' in result.stderr and 'install-python.sh' in result.stderr
    assert 'Traceback' not in result.stderr
    assert 'No context profile' not in result.stdout


def test_bootstrap_creates_venv_once_across_two_installs(tmp_path):
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    creations = tmp_path / 'venv-creations'
    installed = tmp_path / 'installed'
    template = tmp_path / 'owned-python'
    template.write_text(f'''#!/bin/bash
if [[ "$1" == -c ]]; then [[ -f "{installed}" ]]; exit $?; fi
[[ "$1" == -m && "$2" == pip ]] || exit 41
touch "{installed}"
''')
    template.chmod(0o755)
    bootstrap = bin_dir / 'python3'
    bootstrap.write_text(f'''#!/bin/bash
[[ "$1" == -m && "$2" == venv ]] || exit 42
printf 'create\\n' >> "{creations}"
mkdir -p "$3/bin"
cp "{template}" "$3/bin/python3"
''')
    bootstrap.chmod(0o755)
    env = {'PATH': str(bin_dir) + os.pathsep + os.environ['PATH']}
    first = run(INSTALL, tmp_path, env=env)
    assert first.returncode == 0, first.stderr
    assert creations.read_text().splitlines() == ['create']
    second = run(INSTALL, tmp_path, env=env)
    assert second.returncode == 0, second.stderr
    assert 'already installed' in second.stdout
    assert creations.read_text().splitlines() == ['create']


def test_requirements_pin_reviewed_version_and_all_wheel_hashes():
    import hashlib
    import re
    import shlex

    requirements = INSTALL.with_name('python-requirements.txt').read_bytes()
    tokens = shlex.split(requirements.decode().replace('\\\n', ' '), comments=True)
    assert tokens[0] == 'PyYAML==6.0.3'
    hashes = tokens[1:]
    assert len(hashes) == len(set(hashes)) == 72
    assert all(re.fullmatch(r'--hash=sha256:[0-9a-f]{64}', value) for value in hashes)
    # Reviewed against all 72 published PyPI wheels; updating the pin needs a fresh review.
    assert hashlib.sha256(requirements).hexdigest() == (
        '4abbe2a58660e5b024f1415862f468b939f46a9caa53986a8c053e30ff46657a'
    )


def test_bootstrap_rejects_successful_pip_when_post_install_import_fails(tmp_path):
    venv = tmp_path / '.golems/venv'
    (venv / 'bin').mkdir(parents=True)
    calls = tmp_path / 'python-calls'
    python = venv / 'bin/python3'
    python.write_text(f'''#!/bin/bash
printf '%s\\n' "$*" >> "{calls}"
if [[ "$1" == -c ]]; then exit 31; fi
[[ "$1" == -m && "$2" == pip ]] || exit 43
exit 0
''')
    python.chmod(0o755)
    result = run(INSTALL, tmp_path)
    assert result.returncode == 31
    assert '-m pip install' in calls.read_text()
    assert len([line for line in calls.read_text().splitlines() if line.startswith('-c ')]) == 2
    assert 'installed in' not in result.stdout
