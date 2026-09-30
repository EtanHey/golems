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
