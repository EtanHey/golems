"""Glob mv sources: policy inputs only.

No specimen command is executed; scratch repository markers supply protected
root identity to the real guard and hook subprocess.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SKILL = Path(__file__).resolve().parents[2] / 'skills/golem-powers/git-guardian'
spec = importlib.util.spec_from_file_location('guardian_glob_move', SKILL / 'git_safety.py')
guardian = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guardian)


def hook(command, cwd, home):
    env = {k: v for k, v in os.environ.items()
           if k not in {'GIT_GUARDIAN_LIB', 'AUTONOMOUS', 'CLAUDE_WORKER'} and not k.startswith('GIT_')}
    env['HOME'] = str(home)
    result = subprocess.run([sys.executable, str(SKILL / 'hooks/pre_tool_use.py')], cwd=cwd,
                            env=env, text=True, capture_output=True,
                            input=json.dumps({'tool_name': 'Bash', 'cwd': str(cwd),
                                              'tool_input': {'command': command}}))
    assert result.stderr == ''
    return result.returncode, json.loads(result.stdout)


# ── 1. glob sources of `mv` ────────────────────────────────────────────────

# A generic copy of a refused call: a python heredoc that edits a file, then a
# `mkdir -p`, then a `mv` of literal files and globs into the new folder.
REFUSED_SHAPE = """cd ~/Gits/project/captures; python3 - <<'EOF'
p='capture.py';t=open(p).read()
t=t.replace("sleep(.05)","sleep(.1)")
t=t.replace("def run():","def probe(pid):return [x for x in tree(pid) if 'Button' in x]\\ndef run():")
open(p,'w').write(t)
EOF
mkdir -p .work/superseded; mv .work/overview-copy-still-*.png .work/case-before.png .work/zz-* .work/superseded/ ; python3 capture.py run 2>&1 | grep -v "^/Users" | tail; grep "case" MANIFEST.md | tail -1"""

@pytest.fixture
def captures(tmp_path, monkeypatch):
    home = tmp_path / 'owner'
    monkeypatch.setenv('HOME', str(home))  # the protected-root rules read the process HOME
    project = home / 'Gits' / 'project'
    (project / '.git').mkdir(parents=True)
    work = project / 'captures' / '.work'
    work.mkdir(parents=True)
    for name in ('overview-copy-still-1.png', 'overview-copy-still-2.png',
                 'case-before.png', 'zz-a.txt', 'zz-b.txt', '.zz-hidden'):
        (work / name).write_text('x')
    for name in ('project', 'site-a', 'site-b'):
        (home / 'Gits' / name / '.git' / 'refs').mkdir(parents=True, exist_ok=True)
        (home / 'Gits' / name / '.git' / 'HEAD').write_text('ref: refs/heads/main\n')
    (home / '.config' / 'tool').mkdir(parents=True)
    return home, project

@pytest.mark.parametrize('command', [
    'cd captures && mv .work/overview-copy-still-*.png .work/superseded/',
    'cd captures && mv .work/zz-? .work/zz-?.txt elsewhere/',
    'cd captures && mv -t .work/superseded .work/zz-*',
    'cd captures && mv .work/no-match-* .work/superseded/',
    'cd captures && mv .work/* .work/superseded/',
])
def test_glob_move_of_ordinary_files_is_allowed(captures, command):
    home, project = captures
    assert guardian.dangerous_shell_reason(command, cwd=str(project), env={'HOME': str(home)}) is None
    code, decision = hook(command, project, home)
    assert (code, decision) == (0, {})

@pytest.mark.parametrize('command', [
    'mv ~/Gits/* ~/elsewhere/',
    'mv ~/Gits/site-* ~/elsewhere/',
    'mv ~/Gi*s ~/elsewhere',
    'mv ~/.conf*/tool ~/elsewhere/',
    'mv .gi* ~/elsewhere/',
    'mv .git/* ~/elsewhere/',
    'cd ~/Gits && mv */.git ~/elsewhere/',
    'cd captures && mv .work/zz-[ab].txt elsewhere/',
    'cd captures && mv .work/zz-{a,b}.txt elsewhere/',
    'cd captures && mv .work/$X* elsewhere/',
    'cd captures && ln -s ~/Gits/site-a .work/zz-link && mv .work/zz-* elsewhere/',
    'cd captures && cd "$UNKNOWN" && mv .work/zz-* elsewhere/',
])
def test_glob_move_that_may_reach_a_protected_root_stays_denied(captures, command):
    home, project = captures
    assert guardian.dangerous_shell_reason(command, cwd=str(project), env={'HOME': str(home)})
    code, decision = hook(command, project, home)
    assert code == 2 and decision['decision'] == 'block'


def test_glob_expansion_is_bounded(captures):
    home, project = captures
    crowd = project / 'captures' / 'crowd'
    crowd.mkdir()
    for index in range(1100):
        (crowd / f'f{index}').write_text('')
    reason = guardian.dangerous_shell_reason('mv crowd/* elsewhere/', cwd=str(project / 'captures'),
                                             env={'HOME': str(home)})
    assert reason


@pytest.mark.parametrize('source', ['link0*/', './link0*//', 'link?/', './link?//'])
def test_trailing_slash_glob_preserves_symlink_traversal(captures, source):
    home, project = captures
    (project / 'captures' / 'link0').symlink_to(home / 'Gits' / 'site-a')
    code, decision = hook(f'mv {source} ~/elsewhere/', project / 'captures', home)
    assert code == 2 and decision['decision'] == 'block'


def test_refusal_names_protected_root_rule(captures):
    home, project = captures
    code, decision = hook('mv ~/Gits/site-* ~/elsewhere/', project, home)
    assert code == 2
    assert 'protected root' in decision['reason']
    assert 'git command' not in decision['reason']

@pytest.mark.parametrize('command', [
    'SRC=~/Gits/site-a; mv "$SRC" elsewhere/',
    'mv "$UNKNOWN" elsewhere/',
    'SRC=~/Gits/site-a; mv $SRC* elsewhere/',
    'OPT=-t; mv "$OPT" elsewhere ~/Gits/site-*',
    "cat <<EOF\nprose\\\ncontinued\nEOF\nmv ~/Gits/site-* elsewhere/",
])
def test_expansions_and_heredoc_do_not_hide_risky_moves(captures, command):
    home, project = captures
    code, decision = hook(command, project, home)
    assert code == 2 and decision['decision'] == 'block'


def test_glob_match_cannot_inject_mv_options(captures):
    home, project = captures
    work = project / 'captures'
    (work / '-t').write_text('')
    (work / 'elsewhere').mkdir()
    code, decision = hook('mv * ~/Gits/site-a', work, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('name', ['.env', '.env.local', 'credentials.json', 'secret.yaml', 'client.pem', 'client.key'])
def test_source_glob_retains_secret_file_hold(captures, name):
    home, project = captures
    (project / 'captures' / '.work' / name).write_text('synthetic fixture')
    code, decision = hook('cd captures && mv .work/* elsewhere/', project, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    'cd captures && mv .work/zz-* .env',
    'cd captures && mv .work/zz-* "$UNKNOWN"',
    'cd captures && mv -t .env .work/zz-*',
    'cd captures && mv .work/zz-* elsewhere/*',
    'cd captures && mv .work/zz-* elsewhere/; printf x > .env',
])
def test_source_glob_does_not_waive_other_secret_writes(captures, command):
    home, project = captures
    code, decision = hook(command, project, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.fixture
def redteam_workspace(captures):
    home, project = captures
    root = project / 'captures'
    (root / 'sec').mkdir()
    (root / 'out').mkdir()
    (root / 'keys').mkdir()
    for name in ('server.key', 'credentials.json', 'secrets.yaml'):
        (root / 'keys' / name).write_text('synthetic fixture')
    for name in ('.env', 'id.pem', 'zz-a.txt', 'zz-.env'):
        (root / 'sec' / name).write_text('synthetic fixture')
    for name in ('a1.png', 'a2.png'):
        (root / '.work' / name).write_text('synthetic fixture')
    return home, root


@pytest.mark.parametrize('command', [
    'touch .work/.env; mv .work/* sec/',
    'touch .work/.env; mv .work/.e* sec/',
    'touch .work/server.key; mv .work/* keys/',
    'curl -so .work/.env http://127.0.0.1/; mv .work/* sec/',
    'tar -xf x.tar -C .work; mv .work/* sec/',
    'unzip -o x.zip -d .work; mv .work/* sec/',
    'python3 -c "open(\'.work/.env\', \'w\').write(\'synthetic\')"; mv .work/* sec/',
    'mkdir .work/.env; mv .work/* sec/',
])
def test_redteam_earlier_writers_hold(redteam_workspace, command):
    home, root = redteam_workspace
    code, decision = hook(command, root, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    'cd; cd Gits/project/captures/keys; mv * ../out/',
    'cd .work; cd; cd Gits/project/captures/keys; mv * ../out/',
    'cd .work; CDPATH=..; cd keys; mv * ../out/',
    'export CDPATH=$HOME/Gits/project/captures; cd .work; cd keys; mv * ../out/',
])
def test_redteam_unknown_cwd_holds(redteam_workspace, command):
    home, root = redteam_workspace
    code, decision = hook(command, root, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    'mv missing/* out/',
    'mv walk*/missing/* out/',
    'cd -; cd ~/Gits/project/captures; mv .work/* out/',
    'CDPATH=; mv .work/* out/',
    'export CDPATH; mv .work/* out/',
])
def test_glob_admission_requires_known_existing_directory(redteam_workspace, command):
    home, root = redteam_workspace
    (root / 'walk1').mkdir()
    code, decision = hook(command, root, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    'mv .work/zz-* out/',
    'mv .work/a?.png out/',
    'mv -t out .work/zz-*',
    'mv .work/* out/',
    'mv sec/zz-* out/',
    'mv sec/zz-.e* out/',
    'mv -- .work/zz-* out/',
    'mv -f .work/zz-* out/',
    'mv ~/Gits/project/captures/.work/zz-* out/',
])
def test_redteam_nine_intended_allows(redteam_workspace, command):
    home, root = redteam_workspace
    assert hook(command, root, home) == (0, {})


@pytest.mark.parametrize('prefix', ['echo ready; ', 'mkdir -p other; ', 'cd .work; cd ..; '])
def test_known_nonwriting_prefixes_allow(redteam_workspace, prefix):
    home, root = redteam_workspace
    assert hook(prefix + 'mv .work/zz-* out/', root, home) == (0, {})


def test_interpreter_before_original_glob_move_now_holds(captures):
    home, project = captures
    code, decision = hook(REFUSED_SHAPE, project, home)
    assert code == 2 and decision['decision'] == 'block'


def test_earlier_mkdir_case_alias_cannot_refresh_glob(redteam_workspace):
    home, root = redteam_workspace
    if not (root / '.WORK').is_dir():
        pytest.skip('case-insensitive filesystem required for this alias')
    code, decision = hook('mkdir .WORK/.env; mv .work/* sec/', root, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    'cd ordinary | mv * ../out/',
    'cd ordinary & mv * ../out/',
    'cd ordinary || mv * ../out/',
    '(cd ordinary); mv * ../out/',
])
def test_non_parent_cd_contexts_hold(redteam_workspace, command):
    home, root = redteam_workspace
    keys = root / 'keys'
    (keys / 'ordinary').mkdir()
    (keys / 'ordinary' / 'a.txt').write_text('synthetic fixture')
    code, decision = hook(command, keys, home)
    assert code == 2 and decision['decision'] == 'block'


def test_failed_cd_cannot_admit_wrong_directory_snapshot(redteam_workspace):
    home, root = redteam_workspace
    keys = root / 'keys'
    ordinary = keys / 'ordinary'
    ordinary.mkdir()
    (ordinary / 'a.txt').write_text('synthetic fixture')
    ordinary.chmod(0o600)
    try:
        if os.access(ordinary, os.X_OK):
            pytest.skip('requires a non-searchable directory')
        code, decision = hook('cd ordinary; mv * ../out/', keys, home)
        assert code == 2 and decision['decision'] == 'block'
    finally:
        ordinary.chmod(0o700)


def test_quoted_cd_tilde_cannot_admit_wrong_directory_snapshot(redteam_workspace):
    home, root = redteam_workspace
    ordinary = home / 'ordinary'
    ordinary.mkdir()
    (ordinary / 'a.txt').write_text('synthetic fixture')
    code, decision = hook("cd '~/ordinary'; mv * ../out/", root / 'keys', home)
    assert code == 2 and decision['decision'] == 'block'


def test_assignment_context_does_not_gain_glob_admission(redteam_workspace):
    home, root = redteam_workspace
    code, decision = hook('PATH=/other/bin; mv .work/* out/', root, home)
    assert code == 2 and decision['decision'] == 'block'


def test_quoted_source_tilde_cannot_select_a_different_directory(redteam_workspace):
    home, root = redteam_workspace
    (home / 'ordinary').mkdir()
    (home / 'ordinary' / 'a.txt').write_text('synthetic fixture')
    literal = root / 'keys' / '~' / 'ordinary'
    literal.mkdir(parents=True)
    (literal / 'server.key').write_text('synthetic fixture')
    code, decision = hook("mv '~/ordinary/'* ../out/", root / 'keys', home)
    assert code == 2 and decision['decision'] == 'block'


def test_parameterized_mkdir_is_not_a_literal_nonwriting_prefix(redteam_workspace, monkeypatch):
    home, root = redteam_workspace
    (root / '~').mkdir()
    (root / '~' / 'folder').symlink_to(root / '.work')
    monkeypatch.setenv('MUTATION_TARGET', '~/folder/.env')
    code, decision = hook('mkdir -p "$MUTATION_TARGET"; mv .work/* sec/', root, home)
    assert code == 2 and decision['decision'] == 'block'


def test_non_plain_source_expansion_stays_unsure(redteam_workspace):
    home, root = redteam_workspace
    (root / '=program').mkdir()
    (root / '=program' / 'a.txt').write_text('synthetic fixture')
    code, decision = hook('mv =program/* out/', root, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    'false && cd ordinary && echo ready; mv * ../out/',
    'if false; then echo ready; cd ordinary; fi; mv * ../out/',
    '(echo ready; cd ordinary; echo done); mv * ../out/',
])
def test_cd_cannot_be_skipped_or_hidden_inside_control_flow(redteam_workspace, command):
    home, root = redteam_workspace
    keys = root / 'keys'
    (keys / 'ordinary').mkdir()
    (keys / 'ordinary' / 'a.txt').write_text('synthetic fixture')
    code, decision = hook(command, keys, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('source', ['walk*/fixed.txt', '.work/zz-*/fixed.txt'])
def test_missing_leaf_or_nondirectory_parent_is_unsure(redteam_workspace, source):
    home, root = redteam_workspace
    (root / 'walk1').mkdir()
    code, decision = hook(f'mv {source} out/', root, home)
    assert code == 2 and decision['decision'] == 'block'
