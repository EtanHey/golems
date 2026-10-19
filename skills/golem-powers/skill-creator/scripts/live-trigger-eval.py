#!/usr/bin/env python3
"""Live trigger eval: does a fresh headless session load the skill for a phrase?

MANUAL / OPT-IN ONLY. Every case is a real model session and spends real quota
(Claude ~short with --max-turns 2; Codex ~117k input tokens per case). Never wire
this into CI. Offline tests: skill-creator/tests/test_live_trigger_eval.py.

Cases: the 6 BASELINE lead phrases (filtered to --skills) + every row of each
skill's evals/trigger-evals.json. Each case runs in its own fresh session; the
result records which of --skills the session loaded:
  claude: a Skill tool_use naming the skill whose tool_result is not an error
  codex:  a command naming skills/<name>/SKILL.md (brace expansion handled)
          whose output carries that SKILL.md's frontmatter (Codex has no
          Skill tool; a compound command's exit code is not read evidence)

Isolation (eval sessions get "merge it" / "dispatch a worker" and WILL try to
act, so side effects must be impossible, not unlikely):
  scratch   a uniquely named, harness-owned dir (mkdtemp + ownership marker)
            under --scratch-root (default <repo>/.worktrees). work/ is a fresh
            `git init` repo with one commit and NO remote; the run refuses if
            git resolves work/ to any other work tree. Only the dir this run
            created is ever deleted (marker nonce + resolved-path checks,
            symlinked roots refused); --keep-scratch keeps it.
  env       built from an allowlist (PATH, locale, TERM, USER, SHELL): HOME,
            TMPDIR, GH_CONFIG_DIR point into the scratch, so gh is logged out
            and no SSH agent, parent-session socket or token leaks in.
  claude    CLAUDE_CONFIG_DIR=<scratch>/home/.claude (skills/agents/commands
            symlink-mirrored, global CLAUDE.md copied, generated settings.json
            with no hooks/MCP/plugins); auth via CLAUDE_CODE_OAUTH_TOKEN read
            from the login keychain at start (env only, never written);
            --strict-mcp-config, --no-session-persistence, --tools
            Skill,Read,Glob,Grep,Bash, dontAsk with only read-only git/ls Bash
            allowed; an isolation probe proves Skill works and a write is
            denied before any case runs.
  codex     CODEX_HOME=<scratch>/home/.codex holding only read-only inputs:
            skills/ symlink mirror, AGENTS.md copy, auth.json copy (refused if
            a token refresh is due, so the copy never rotates the real login),
            generated config.toml with no MCP servers and apps/plugins/
            multi_agent/memories/hooks off; -s read-only. MCP calls seen in a
            stream are reported (must be 0).

Descriptions in effect: the installed skills (~/.claude/skills, ~/.codex/skills),
or with --candidates DIR the skill dirs under DIR swapped into the mirror. A probe
session (no tools allowed) quotes each catalog description as `<name>: <desc>`;
each must match its own skill or the run aborts before spending more quota.

Every case records status ok|timeout|auth_error|nonzero|incomplete|exception;
only ok cases are scored, the rest are reported as infra-excluded.

usage:
  live-trigger-eval.py --harness claude|codex [--skills a,b] [--sets baseline,positives,negatives]
                       [--candidates DIR] [--out DIR] [--scratch-root DIR] [--model M]
                       [--keep-scratch] [--isolation-only] [--dry-run]
  live-trigger-eval.py --harness claude|codex --reprocess DIR [--skills a,b]
      re-scores DIR/runNN.jsonl with the current detection, writing
      DIR/reprocessed-results.jsonl + DIR/reprocessed-summary.md (originals untouched).
Results: <out>/results.jsonl, summary.md, runNN.jsonl (stream logs), probe.json,
isolation.json. Default out: <repo>/docs.local/live-trigger/<harness>-<stamp>/.
"""
import argparse, glob, json, os, re, secrets, shutil, subprocess, sys, tempfile, time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
SKILLS_DIR = REPO / 'skills' / 'golem-powers'
REAL_HOME = Path.home()
DEFAULT_SKILLS = ['large-plan', 'agent-routing', 'pr-loop']
BASELINE = [
    ('make a plan for the BrainLayer ingest cleanup', 'large-plan'),
    ('plan the next batch of skill PRs', 'large-plan'),
    ('dispatch a worker to fix the flaky test', 'agent-routing'),
    ('hand this to Codex', 'agent-routing'),
    ('open a PR', 'pr-loop'),
    ('CI is red on my PR, fix it', 'pr-loop'),
]
CODEX_MODEL = 'gpt-6.1-sol'
CODEX_EFFORT = 'low'
ND = 'NOT DETERMINED'
MARKER = '.live-trigger-owned'
OK = 'ok'
ENV_KEEP = ('PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME', 'SHELL', 'SSL_CERT_FILE')
CLAUDE_TOOLS = ('Skill', 'Read', 'Glob', 'Grep', 'Bash')
CLAUDE_ALLOW = ['Skill', 'Read', 'Glob', 'Grep', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)',
                'Bash(git show:*)', 'Bash(git branch:*)', 'Bash(git remote:*)', 'Bash(git rev-parse:*)',
                'Bash(ls:*)', 'Bash(pwd)']
CLAUDE_DENY = ['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task',
               'Bash(gh:*)', 'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(rm:*)', 'Bash(curl:*)']
CODEX_CONFIG = '''# generated by live-trigger-eval.py: no MCP servers, no apps/plugins/subagents
model = "{model}"
model_reasoning_effort = "{effort}"
approval_policy = "never"
sandbox_mode = "read-only"

[features]
apps = false
plugins = false
remote_plugin = false
multi_agent = false
memories = false
hooks = false
browser_use = false
computer_use = false
image_generation = false
skill_mcp_dependency_install = false
tool_suggest = false
chronicle = false
'''
AUTH_RE = re.compile(r'not logged in|please run /login|invalid api key|unauthori[sz]ed|\b401\b|'
                     r'authentication|oauth token|login required|codex login', re.I)


class Refuse(Exception):
    """An isolation or ownership precondition failed; nothing is run or deleted."""


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--harness', required=True, choices=['claude', 'codex'])
    ap.add_argument('--skills', default=','.join(DEFAULT_SKILLS))
    ap.add_argument('--sets', default='baseline,positives,negatives',
                    help='comma list of baseline, positives, negatives (trigger-evals split by polarity)')
    ap.add_argument('--candidates', type=Path, help='dir holding candidate <skill>/SKILL.md dirs')
    ap.add_argument('--out', type=Path)
    ap.add_argument('--scratch-root', type=Path, help='parent of the harness-owned scratch (default <repo>/.worktrees)')
    ap.add_argument('--model', help='claude default: node scripts/model-roles.mjs claude.judgment; codex default: CODEX_MODEL')
    ap.add_argument('--keep-scratch', action='store_true')
    ap.add_argument('--isolation-only', action='store_true',
                    help='build the scratch, write isolation.json (claude: one short skill-probe session), clean up, exit')
    ap.add_argument('--reprocess', type=Path, help='re-score recorded logs in DIR; spends nothing')
    ap.add_argument('--dry-run', action='store_true', help='list cases and exit; spends nothing')
    return ap.parse_args(argv)


def description(skill_md):
    m = re.search(r'^description:\s*"(.*)"\s*$', Path(skill_md).read_text(), re.M)
    return m.group(1).replace('\\"', '"') if m else None


def build_cases(skills, sets):
    cases = []
    if 'baseline' in sets:
        cases += [dict(set='baseline', query=q, skill=s, should_trigger=True) for q, s in BASELINE if s in skills]
    for s in skills:
        for row in json.loads((SKILLS_DIR / s / 'evals' / 'trigger-evals.json').read_text()):
            if ('positives' if row['should_trigger'] else 'negatives') in sets:
                cases.append(dict(set='trigger-evals', query=row['query'], skill=s,
                                  should_trigger=row['should_trigger']))
    return cases


# --- scratch: harness-owned, its own git repo, ownership-checked deletion --------

def base_env(s):
    env = {k: os.environ[k] for k in ENV_KEEP if k in os.environ}
    env.update(HOME=str(s['home']), TMPDIR=str(s['tmp']), GH_CONFIG_DIR=str(s['home'] / '.config' / 'gh'),
               GIT_CEILING_DIRECTORIES=str(s['path']), GIT_CONFIG_NOSYSTEM='1')
    return env


def verify_git_isolation(work, env):
    work = Path(os.path.realpath(work))
    top = subprocess.run(['git', '-C', str(work), 'rev-parse', '--show-toplevel'], env=env,
                         capture_output=True, text=True)
    if top.returncode or Path(os.path.realpath(top.stdout.strip())) != work:
        raise Refuse(f'{work} is not its own git work tree (git resolves {top.stdout.strip() or top.stderr.strip()!r})')
    remotes = subprocess.run(['git', '-C', str(work), 'remote', '-v'], env=env, capture_output=True, text=True)
    if remotes.returncode or remotes.stdout.strip():
        raise Refuse(f'scratch repo {work} has a remote: {remotes.stdout.strip()!r}')
    return remotes.stdout


def make_scratch(root, harness):
    root = Path(os.path.abspath(root))
    if os.path.lexists(root) and os.path.realpath(root) != str(root):
        raise Refuse(f'scratch root {root} resolves through a symlink to {os.path.realpath(root)}; pass the real path')
    root.mkdir(parents=True, exist_ok=True)
    if os.path.realpath(root) != str(root):
        raise Refuse(f'scratch root {root} resolves through a symlink to {os.path.realpath(root)}; pass the real path')
    path = Path(tempfile.mkdtemp(prefix=f'live-trigger-{harness}-', dir=root))
    nonce = secrets.token_hex(16)
    (path / MARKER).write_text(json.dumps(dict(nonce=nonce, pid=os.getpid(), created=iso_now(), harness=harness)))
    s = dict(path=path, nonce=nonce, work=path / 'work', home=path / 'home', tmp=path / 'tmp')
    for k in ('work', 'home', 'tmp'):
        s[k].mkdir()
    env = base_env(s)
    git = ['git', '-c', 'user.name=live-trigger', '-c', 'user.email=live-trigger@invalid', '-c', 'commit.gpgsign=false']
    subprocess.run(['git', 'init', '-q', str(s['work'])], env=env, check=True, capture_output=True)
    (s['work'] / 'README.md').write_text('live-trigger-eval scratch repo (no remote).\n')
    subprocess.run([*git, '-C', str(s['work']), 'add', 'README.md'], env=env, check=True, capture_output=True)
    subprocess.run([*git, '-C', str(s['work']), 'commit', '-q', '-m', 'scratch'], env=env, check=True, capture_output=True)
    verify_git_isolation(s['work'], env)
    return s


def remove_owned(path, nonce):
    """Delete only a dir this run created: real path, not a link, marker nonce matches."""
    p = os.path.abspath(path)
    if os.path.islink(p) or not os.path.isdir(p):
        raise Refuse(f'refusing to delete {p}: not a real directory')
    if os.path.realpath(p) != p:
        raise Refuse(f'refusing to delete {p}: an ancestor is a symlink (resolves to {os.path.realpath(p)})')
    marker = os.path.join(p, MARKER)
    if os.path.islink(marker) or not os.path.isfile(marker):
        raise Refuse(f'refusing to delete {p}: no harness ownership marker')
    try:
        owned = json.loads(Path(marker).read_text()).get('nonce') == nonce
    except ValueError:
        owned = False
    if not owned:
        raise Refuse(f'refusing to delete {p}: ownership marker belongs to another run')
    shutil.rmtree(p)  # never follows nested symlinks (rmtree.avoids_symlink_attacks)


# --- per-harness runtime homes -----------------------------------------------------

def mirror(src, dst, swap):
    """Symlink every entry of src into a new dst (resolving one level), then swap named entries."""
    dst.mkdir(parents=True)
    for e in sorted(src.iterdir()) if src.is_dir() else []:
        (dst / e.name).symlink_to(e.resolve() if e.is_symlink() else e)
    for name, target in swap.items():
        link = dst / name
        if link.is_symlink():
            link.unlink()
        elif link.exists():
            raise Refuse(f'refusing to replace non-symlink {link}')
        link.symlink_to(target)


def claude_oauth_token():
    if os.environ.get('CLAUDE_CODE_OAUTH_TOKEN'):
        return os.environ['CLAUDE_CODE_OAUTH_TOKEN']
    p = subprocess.run(['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w'],
                       capture_output=True, text=True, timeout=30)
    if p.returncode:
        raise Refuse('no Claude login in the keychain; set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)')
    o = json.loads(p.stdout).get('claudeAiOauth') or {}
    if o.get('expiresAt', 0) / 1000 - time.time() < 45 * 60:
        raise Refuse('Claude access token expires within 45 min; run any claude command to refresh, then retry')
    return o['accessToken']


def check_codex_auth(auth):
    """The copy must never refresh: a refresh inside it would rotate the real login's refresh token."""
    if not auth.is_file():
        raise Refuse(f'no Codex auth at {auth}; run codex login')
    d = json.loads(auth.read_text())
    if d.get('auth_mode') == 'chatgpt':
        last = d.get('last_refresh')
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(last.replace('Z', '+00:00'))).days if last else 99
        if age >= 7:
            raise Refuse(f'Codex token last refreshed {age} days ago; run plain `codex` once to refresh, then retry')


def resolve_model(harness, model):
    if model:
        return model
    if harness == 'codex':
        return CODEX_MODEL
    p = subprocess.run(['node', str(REPO / 'scripts' / 'model-roles.mjs'), 'claude.judgment'],
                       capture_output=True, text=True)
    if p.returncode or not p.stdout.strip():
        raise Refuse(f'could not resolve claude.judgment: {p.stderr.strip()}; pass --model')
    return p.stdout.strip()


def provenance(harness, model, effort):
    return dict(model_requested=model, effort_requested=effort or ND,
                model_source='stream-json system/init `model` field' if harness == 'claude'
                else 'CODEX_HOME rollout turn_context `model` field',
                effort_source=ND if harness == 'claude' else 'CODEX_HOME rollout turn_context `effort` field')


def prepare(s, harness, skills, candidates, model):
    """Build the isolated runtime home; return (argv, env, provenance)."""
    swap = {}
    if candidates:
        for sk in skills:
            cand = (Path(candidates) / sk).resolve()
            if not description(cand / 'SKILL.md'):
                raise Refuse(f'no quoted description in {cand}/SKILL.md')
            swap[sk] = cand
    env = base_env(s)
    if harness == 'claude':
        cfg = s['home'] / '.claude'
        src = REAL_HOME / '.claude'
        mirror(src / 'skills', cfg / 'skills', swap)
        mirror(src / 'agents', cfg / 'agents', {})
        mirror(src / 'commands', cfg / 'commands', {})
        if (src / 'CLAUDE.md').is_file():
            shutil.copyfile(src / 'CLAUDE.md', cfg / 'CLAUDE.md')
        user = json.loads((src / 'settings.json').read_text()) if (src / 'settings.json').is_file() else {}
        settings = dict(permissions=dict(defaultMode='dontAsk', allow=CLAUDE_ALLOW, deny=CLAUDE_DENY),
                        autoMemoryEnabled=False, cleanupPeriodDays=1)
        for k in ('modelSettings', 'alwaysThinkingEnabled'):
            if k in user:
                settings[k] = user[k]
        (cfg / 'settings.json').write_text(json.dumps(settings, indent=2))
        (cfg / '.claude.json').write_text(json.dumps(dict(hasCompletedOnboarding=True)))
        env.update(CLAUDE_CONFIG_DIR=str(cfg), CLAUDE_CODE_OAUTH_TOKEN=claude_oauth_token(),
                   ENABLE_CLAUDEAI_MCP_SERVERS='false', DISABLE_AUTOUPDATER='1')
        effort = (settings.get('modelSettings', {}).get(model) or {}).get('effortLevel')
        argv = ['--model', model, '--setting-sources', 'user', '--strict-mcp-config', '--no-session-persistence',
                '--tools', ','.join(CLAUDE_TOOLS), '--permission-mode', 'dontAsk', '--permission-prompts', 'none']
        return argv, env, provenance('claude', model, f'{effort} (settings modelSettings)' if effort else None)
    ch = s['home'] / '.codex'
    src = REAL_HOME / '.codex'
    mirror(src / 'skills', ch / 'skills', swap)
    if (src / 'AGENTS.md').is_file():
        shutil.copyfile(src / 'AGENTS.md', ch / 'AGENTS.md')
    check_codex_auth(src / 'auth.json')
    shutil.copyfile(src / 'auth.json', ch / 'auth.json')
    os.chmod(ch / 'auth.json', 0o600)
    (ch / 'config.toml').write_text(CODEX_CONFIG.format(model=model, effort=CODEX_EFFORT))
    env['CODEX_HOME'] = str(ch)
    argv = ['--skip-git-repo-check', '-s', 'read-only', '-m', model, '-c', f'model_reasoning_effort="{CODEX_EFFORT}"']
    return argv, env, provenance('codex', model, CODEX_EFFORT)


# --- running and parsing sessions ---------------------------------------------------

def events(text):
    for line in (text or '').splitlines():
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if isinstance(o, dict):
            yield o


def _text(x):
    return x.decode(errors='replace') if isinstance(x, bytes) else (x or '')


def _run(cmd, log, env, cwd, timeout):
    try:
        p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL)
        out, err, rc, timed_out = p.stdout, p.stderr, p.returncode, False
    except subprocess.TimeoutExpired as e:
        out, err, rc, timed_out = _text(e.stdout), _text(e.stderr), None, True
    log.write_text(out)
    if err:
        log.with_suffix('.stderr.txt').write_text(err)
    return out, err, rc, timed_out


def parse_claude(out, err, rc, timed_out):
    init, result, texts, uses, results = {}, None, [], {}, {}
    for o in events(out):
        if o.get('type') == 'system' and o.get('subtype') == 'init':
            init = o
        elif o.get('type') == 'result':
            result = o
        elif o.get('type') in ('assistant', 'user'):
            for c in (o.get('message') or {}).get('content') or []:
                if not isinstance(c, dict):
                    continue
                if c.get('type') == 'tool_use':
                    uses[c.get('id')] = c
                elif c.get('type') == 'tool_result':
                    results[c.get('tool_use_id')] = c
                elif c.get('type') == 'text' and o['type'] == 'assistant':
                    texts.append(c.get('text', ''))
    blob = ' '.join([err or '', str((result or {}).get('result', ''))])
    if timed_out:
        status = 'timeout'
    elif AUTH_RE.search(blob) and (result is None or result.get('is_error')):
        status = 'auth_error'
    elif result is None:
        status = 'nonzero' if rc else 'incomplete'
    elif result.get('subtype') == 'error_max_turns' or (result.get('subtype') == 'success' and not result.get('is_error')):
        status = OK
    else:
        status = 'nonzero'
    loaded = []
    for uid, u in uses.items():
        r = results.get(uid)
        if u.get('name') == 'Skill' and r is not None and not r.get('is_error'):
            loaded.append(str((u.get('input') or {}).get('skill', '')).split(':')[-1])
    return dict(status=status, loaded=list(dict.fromkeys(loaded)), model=init.get('model'), init=init,
                text='\n'.join(texts), tool_uses=[u.get('name') for u in uses.values()],
                tool_calls=[dict(name=u.get('name'), input=u.get('input'),
                                 is_error=(results.get(uid) or {}).get('is_error'),
                                 result=str((results.get(uid) or {}).get('content', ''))[:300])
                            for uid, u in uses.items()],
                mcp_calls=[u.get('name') for u in uses.values() if str(u.get('name', '')).startswith('mcp__')])


def run_claude(q, log, argv, env, cwd, max_turns='2', timeout=300):
    cmd = ['claude', '-p', *argv, '--output-format', 'stream-json', '--verbose', '--max-turns', max_turns, q]
    return parse_claude(*_run(cmd, log, env, cwd, timeout))


def expand_braces(s):
    """Shell-style {a,b} expansion (nested ok, no ranges)."""
    depth, start = 0, None
    for i, ch in enumerate(s):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}' and depth:
            depth -= 1
            if depth == 0:
                inner, parts, d, last = s[start + 1:i], [], 0, 0
                for j, c in enumerate(inner):
                    d += c == '{'
                    d -= c == '}'
                    if c == ',' and d == 0:
                        parts.append(inner[last:j])
                        last = j + 1
                parts.append(inner[last:])
                if len(parts) < 2:
                    continue
                return [x for p in parts for x in expand_braces(s[:start] + p + s[i + 1:])]
    return [s]


def frontmatter_shown(output, skill):
    return re.search(r'^\s*(?:\d+[:\t]\s*)?name:\s*["\']?' + re.escape(skill) + r'["\']?\s*$\n'
                     r'^\s*(?:\d+[:\t]\s*)?description:', output, re.M) is not None


def codex_reads(item, skills):
    """Skills whose SKILL.md this command read: the command names the path (braces expanded) AND its
    output shows that file's frontmatter. The exit code is not the test: `cat SKILL.md; rg x` exits
    1 from the rg after a successful read, while a failed read or an echo never shows the body."""
    cmd = ' '.join(expand_braces(item.get('command', '')))
    out = item.get('aggregated_output') or ''
    hits = {s: m.start() for s in skills
            if (m := re.search(r'(?:^|[/\s\'"])' + re.escape(s) + r'/SKILL\.md', cmd)) and frontmatter_shown(out, s)}
    return sorted(hits, key=hits.get)  # in read order


def parse_codex(out, err, rc, timed_out, skills):
    loaded, texts, tool_uses, mcp_calls, completed, errors = [], [], [], [], False, []
    for o in events(out):
        t = o.get('type')
        if t == 'turn.completed':
            completed = True
        elif t in ('error', 'turn.failed'):
            errors.append(str(o.get('message') or o.get('error') or o))
        item = o.get('item') or o.get('msg') or {}
        if t not in ('item.completed', None) and not o.get('msg'):
            continue
        it = item.get('type')
        if it == 'agent_message':
            texts.append(item.get('text', ''))
        elif it == 'command_execution':
            tool_uses.append('command_execution')
            loaded += codex_reads(item, skills)
        elif it == 'mcp_tool_call':
            tool_uses.append('mcp_tool_call')
            mcp_calls.append(f"{item.get('server')}.{item.get('tool')}")
        elif it and it not in ('reasoning', 'todo_list'):
            tool_uses.append(it)
    if timed_out:
        status = 'timeout'
    elif AUTH_RE.search(' '.join([err or '', *errors])):
        status = 'auth_error'
    elif completed and not errors:
        status = OK
    else:
        status = 'nonzero' if rc or errors else 'incomplete'
    return dict(status=status, loaded=list(dict.fromkeys(loaded)), model=None, text='\n'.join(texts),
                tool_uses=tool_uses, mcp_calls=mcp_calls)


def codex_rollout(codex_home, since):
    """(model, effort) from the newest rollout turn_context written since `since`, else (None, None)."""
    files = [f for f in glob.glob(str(Path(codex_home) / 'sessions' / '**' / 'rollout-*.jsonl'), recursive=True)
             if os.path.getmtime(f) >= since - 1]
    for f in sorted(files, key=os.path.getmtime, reverse=True):
        for o in events(Path(f).read_text()):
            if o.get('type') == 'turn_context':
                p = o.get('payload') or {}
                return p.get('model'), p.get('effort') or p.get('reasoning_effort')
    return None, None


def run_codex(q, log, argv, env, cwd, skills, timeout=240):
    cmd = ['codex', 'exec', '--json', *argv, '-C', str(cwd), q]
    t = time.time()
    r = parse_codex(*_run(cmd, log, env, cwd, timeout), skills)
    r['model'], r['effort'] = codex_rollout(env['CODEX_HOME'], t) if env.get('CODEX_HOME') else (None, None)
    return r


def run_session(harness, q, log, argv, env, cwd, skills, max_turns='2'):
    if harness == 'claude':
        return run_claude(q, log, argv, env, cwd, max_turns=max_turns)
    return run_codex(q, log, argv, env, cwd, skills)


# --- probes ------------------------------------------------------------------------------

def norm(s):
    return re.sub(r'\s+', ' ', s.replace('\\"', '"').replace('“', '"').replace('”', '"')).strip()


def check_probe(parsed, expected):
    """Pass only for a completed, tool-free session quoting each description on its own skill's line."""
    reasons = []
    if parsed['status'] != OK:
        reasons.append(f"probe session status {parsed['status']}")
    if parsed['tool_uses']:
        reasons.append(f"probe used tools {parsed['tool_uses']} (no tools allowed)")
    lines = parsed['text'].splitlines()
    rows = {}
    for s, want in expected.items():
        pat = re.compile(r'^[\s>*\-`#\d.]*' + re.escape(s) + r'[`*]*\s*:\s*(.*)$')
        got = [m.group(1) for m in map(pat.match, lines) if m]
        rows[s] = dict(expected=want, quoted=got, in_effect=any(norm(want) in norm(g) for g in got))
        if not rows[s]['in_effect']:
            reasons.append(f'{s}: its description is not quoted on its own line')
    return not reasons, rows, reasons


def probe(out, harness, skills, argv, env, cwd, expected):
    q = ('Do not use any tools and do not load any skill: from your available skills list, quote the '
         'description of each of these skills verbatim, one per line, as `<name>: <description>`: '
         + ', '.join(skills) + '. Answer from the list you already have; quote its description exactly.')
    parsed = run_session(harness, q, out / 'probe.jsonl', argv, env, cwd, skills, max_turns='1')
    ok, rows, reasons = check_probe(parsed, expected)
    (out / 'probe.json').write_text(json.dumps(dict(model=parsed['model'], status=parsed['status'],
                                                    tool_uses=parsed['tool_uses'], response=parsed['text'],
                                                    skills=rows, ok=ok, reasons=reasons), indent=2))
    if not ok:
        raise Refuse(f'PROBE FAILED: {reasons}; see {out / "probe.jsonl"}')
    return parsed['model']


def isolation_checks(s, env, harness):
    """Offline proofs: scratch git has no remote, gh is logged out, Codex sees no MCP server."""
    rep = dict(scratch=str(s['path']), work=str(s['work']), home=str(s['home']), reasons=[])
    rep['git_remote'] = verify_git_isolation(s['work'], env)
    rep['git_toplevel'] = subprocess.run(['git', '-C', str(s['work']), 'rev-parse', '--show-toplevel'],
                                         env=env, capture_output=True, text=True).stdout.strip()
    gh = shutil.which('gh', path=env.get('PATH'))
    if gh:
        p = subprocess.run([gh, 'auth', 'status'], env=env, cwd=s['work'], capture_output=True, text=True, timeout=30)
        rep['gh_auth_status'] = dict(rc=p.returncode, output=(p.stdout + p.stderr).strip()[:300])
        if p.returncode == 0:
            rep['reasons'].append('gh is authenticated inside the scratch env')
    else:
        rep['gh_auth_status'] = 'gh not on PATH'
    rep['env_keys'] = sorted(env)
    if harness == 'codex':
        p = subprocess.run(['codex', 'mcp', 'list', '--json'], env=env, cwd=s['work'], capture_output=True,
                           text=True, timeout=60)
        rep['codex_mcp_list'] = dict(rc=p.returncode, output=p.stdout.strip()[:500])
        try:
            servers = json.loads(p.stdout or 'null')
        except ValueError:
            servers = None
        if p.returncode or servers != []:
            rep['reasons'].append(f'codex mcp list is not empty: {p.stdout.strip()[:200]!r}')
        p = subprocess.run(['codex', 'features', 'list'], env=env, cwd=s['work'], capture_output=True, text=True,
                           timeout=60)
        feats = dict(re.findall(r'^(\S+)\s+.*?\s(true|false)\s*$', p.stdout, re.M))
        rep['codex_features'] = {k: feats.get(k, ND) for k in ('apps', 'plugins', 'multi_agent', 'memories', 'hooks')}
        on = [k for k, v in rep['codex_features'].items() if v == 'true']
        if on:
            rep['reasons'].append(f'codex features still on: {on}')
    rep['ok'] = not rep['reasons']
    return rep


def skill_probe_claude(out, skill, argv, env, cwd):
    """Live proof: Skill works under the restrictions, a write is denied, no MCP server is loaded."""
    target = 'probe-write.txt'
    q = (f'This is a harness isolation check. Step 1: call the Skill tool with skill "{skill}". '
         f'Step 2: run exactly this Bash command: touch {target} . Then reply DONE.')
    parsed = run_claude(q, out / 'skill-probe.jsonl', argv, env, cwd, max_turns='4')
    init = parsed['init']
    calls = parsed['tool_calls']
    skill_ok = any(c['name'] == 'Skill' and not c['is_error'] for c in calls) and skill in parsed['loaded']
    bash = [c for c in calls if c['name'] == 'Bash']
    write_denied = bool(bash) and all(c['is_error'] for c in bash) and not (Path(cwd) / target).exists()
    tools = set(init.get('tools') or [])
    rep = dict(status=parsed['status'], model=parsed['model'], init_tools=sorted(tools),
               init_mcp_servers=init.get('mcp_servers'), skill_ok=skill_ok, write_denied=write_denied,
               calls=calls, permission_mode=init.get('permissionMode'))
    reasons = []
    if parsed['status'] != OK:
        reasons.append(f"skill probe status {parsed['status']}")
    if not skill_ok:
        reasons.append('Skill tool did not load the skill under the restrictions')
    if not write_denied:
        reasons.append('Bash write was not attempted-and-denied')
    if init.get('mcp_servers'):
        reasons.append(f"MCP servers loaded: {init.get('mcp_servers')}")
    if tools - set(CLAUDE_TOOLS):
        reasons.append(f'extra tools available: {sorted(tools - set(CLAUDE_TOOLS))}')
    rep.update(ok=not reasons, reasons=reasons)
    return rep


# --- scoring and summaries ---------------------------------------------------------

def score(r):
    if r.get('status', OK) != OK:
        return None
    return (r['skill'] in r['loaded']) == r['should_trigger']


def frac(rows):
    ok = [r for r in rows if r.get('correct') is not None]
    return f"{sum(r['correct'] for r in ok)}/{len(ok)}"


def observed(values):
    vals = sorted({str(v) for v in values if v})
    return vals or None


def summarize(results, harness, skills, prov, label):
    base = [r for r in results if r['set'] == 'baseline']
    te = [r for r in results if r['set'] == 'trigger-evals']
    infra = [r for r in results if r.get('correct') is None]
    mcp = sum(len(r.get('mcp_calls') or []) for r in results)
    models, efforts = observed(r.get('model_effective') for r in results), observed(r.get('effort_effective') for r in results)
    lines = [f'# Live trigger eval — {harness} — {time.strftime("%Y-%m-%d %H:%M")}',
             f'baseline planning {frac([r for r in base if r["skill"] == "large-plan"])}; '
             f'baseline dispatch+PR {frac([r for r in base if r["skill"] != "large-plan"])}',
             f'trigger-evals {frac(te)} (positives {frac([r for r in te if r["should_trigger"]])}, '
             f'negatives {frac([r for r in te if not r["should_trigger"]])})',
             'per skill (trigger-evals positives): ' + '; '.join(
                 f"{s} {frac([r for r in te if r['skill'] == s and r['should_trigger']])}" for s in skills),
             f'infra-excluded: {len(infra)}' + (' (' + ', '.join(f"run{r['run']:02d} {r.get('status')}" for r in infra) + ')' if infra else ''),
             f'MCP tool calls across all cases: {mcp}',
             f'descriptions in effect: {label}',
             '', '| # | set | skill | should | status | loaded | correct | query |', '|---|---|---|---|---|---|---|---|']
    lines += [f"| {r['run']} | {r['set']} | {r['skill']} | {r['should_trigger']} | {r.get('status', OK)} | "
              f"{','.join(r['loaded']) or '—'} | {'—' if r['correct'] is None else '✓' if r['correct'] else '✗'} | {r['query']} |"
              for r in results]
    lines += ['',
              f"model_requested: {prov['model_requested']}",
              f"model_effective: {models} (model_observation_source: {prov['model_source']})" if models
              else f'model_effective: {ND} (model_observation_source: {ND})',
              f"effort_requested: {prov['effort_requested']}",
              f"effort_effective: {efforts} (effort_observation_source: {prov['effort_source']})" if efforts
              else f'effort_effective: {ND} (effort_observation_source: {ND})',
              '→ NON_COMPARABLE; n=1 per query; counts only, no score/delta claim.']
    return lines


def reprocess(d, harness, skills):
    d = Path(d)
    rows = [json.loads(l) for l in (d / 'results.jsonl').read_text().splitlines() if l.strip()]
    skills = list(dict.fromkeys([*skills, *(r['skill'] for r in rows)]))
    out = []
    for r in rows:
        log = d / f"run{r['run']:02d}.jsonl"
        text = log.read_text() if log.exists() else ''
        parsed = parse_claude(text, '', None, False) if harness == 'claude' else parse_codex(text, '', None, False, skills)
        n = dict(r, recorded_loaded=r.get('loaded'), recorded_correct=r.get('correct'), status=parsed['status'],
                 loaded=parsed['loaded'], mcp_calls=parsed['mcp_calls'],
                 model_effective=parsed['model'], effort_effective=None)
        n.pop('model', None)
        n['correct'] = score(n)
        out.append(n)
    (d / 'reprocessed-results.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in out))
    prov = provenance(harness, rows[0].get('model', ND) if harness == 'claude' else CODEX_MODEL, None)
    prov['model_requested'] = f'{ND} (reprocessed from recorded logs)' if harness == 'claude' else f'{CODEX_MODEL} (recorded run)'
    lines = summarize(out, harness, skills, prov, f'as recorded in {d} (reprocessed)')
    changed = [r for r in out if r['correct'] != r['recorded_correct']]
    lines += ['', f'changed vs recorded: {len(changed)}'] + [
        f"- run{r['run']:02d} {r['skill']} {r['query']!r}: recorded loaded={r['recorded_loaded']} correct={r['recorded_correct']}"
        f" → loaded={r['loaded']} status={r['status']} correct={r['correct']}" for r in changed]
    (d / 'reprocessed-summary.md').write_text('\n'.join(lines) + '\n')
    return out


# --- main --------------------------------------------------------------------------------

def run(args, skills, cases):
    model = resolve_model(args.harness, args.model)
    root = args.scratch_root or REPO / '.worktrees'
    s = make_scratch(root, args.harness)
    try:
        argv, env, prov = prepare(s, args.harness, skills, args.candidates, model)
        iso = isolation_checks(s, env, args.harness)
        if args.harness == 'claude' and iso['ok']:
            iso['skill_probe'] = skill_probe_claude(args.out, skills[0], argv, env, s['work'])
            iso['ok'] = iso['skill_probe']['ok']
            iso['reasons'] += iso['skill_probe']['reasons']
        (args.out / 'isolation.json').write_text(json.dumps(iso, indent=2))
        if not iso['ok']:
            raise Refuse(f"ISOLATION FAILED: {iso['reasons']}; see {args.out / 'isolation.json'}")
        if args.isolation_only:
            print(f"isolation ok; see {args.out / 'isolation.json'}")
            return
        src = Path(args.candidates) if args.candidates else REAL_HOME / f'.{args.harness}' / 'skills'
        expected = {sk: description(src / sk / 'SKILL.md') for sk in skills}
        probe(args.out, args.harness, skills, argv, env, s['work'], expected)
        results = []
        for i, c in enumerate(cases, 1):
            t = time.time()
            try:
                p = run_session(args.harness, c['query'], args.out / f'run{i:02d}.jsonl', argv, env, s['work'], skills)
            except Exception as e:  # record, never hide
                p = dict(status='exception', loaded=[], model=None, mcp_calls=[], error=repr(e))
            c.update(run=i, status=p['status'], loaded=p['loaded'], mcp_calls=p.get('mcp_calls', []),
                     model_effective=p.get('model'), effort_effective=p.get('effort'), secs=round(time.time() - t))
            c['correct'] = score(c)
            results.append(c)
            with open(args.out / 'results.jsonl', 'a') as f:
                f.write(json.dumps(c) + '\n')
        label = (f'candidates from {args.candidates}' if args.candidates else 'installed') + ' (probe verified, see probe.json)'
        lines = summarize(results, args.harness, skills, prov, label)
        (args.out / 'summary.md').write_text('\n'.join(lines) + '\n')
        print('\n'.join(lines[:7]))
    finally:
        if args.keep_scratch:
            print(f'scratch kept: {s["path"]}')
        else:
            remove_owned(s['path'], s['nonce'])


def main(argv=None):
    args = parse_args(argv)
    skills = [s.strip() for s in args.skills.split(',') if s.strip()]
    try:
        if args.reprocess:
            res = reprocess(args.reprocess, args.harness, skills)
            print((args.reprocess / 'reprocessed-summary.md').read_text().split('\n\n')[0])
            return res
        cases = build_cases(skills, {s.strip() for s in args.sets.split(',')})
        if args.dry_run:
            for i, c in enumerate(cases, 1):
                print(f"{i:02d} {c['set']:13} {c['skill']:13} {str(c['should_trigger']):5} {c['query']}")
            print(f'{len(cases)} cases; harness={args.harness}; candidates={args.candidates or "installed"}')
            return None
        args.out = args.out or REPO / 'docs.local' / 'live-trigger' / f'{args.harness}-{time.strftime("%Y%m%d-%H%M")}'
        args.out.mkdir(parents=True, exist_ok=True)
        run(args, skills, cases)
    except Refuse as e:
        sys.exit(f'REFUSED: {e}')


if __name__ == '__main__':
    main()
