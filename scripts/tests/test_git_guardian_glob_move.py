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
    REFUSED_SHAPE,
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
