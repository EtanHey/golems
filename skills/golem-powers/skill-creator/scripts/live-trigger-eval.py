#!/usr/bin/env python3
"""Live trigger eval: does a fresh headless session load the skill for a phrase?

MANUAL / OPT-IN ONLY. Every case is a real model session and spends real quota
(Claude ~short with --max-turns 2; Codex ~117k input tokens per case). Never wire
this into CI.

Cases: the 6 BASELINE lead phrases (filtered to --skills) + every row of each
skill's evals/trigger-evals.json. Each case runs in its own fresh session; the
result records which of --skills the session loaded:
  claude: a Skill tool_use naming the skill
  codex:  a shell command reading skills/<name>/SKILL.md (Codex has no Skill tool)

Descriptions in effect:
  default            the INSTALLED skills (~/.claude/skills, ~/.codex/skills).
  --candidates DIR   skill dirs under DIR (e.g. a worktree's skills/golem-powers)
                     replace the installed ones, without touching ~/.claude or
                     ~/.codex:
    claude: user skills beat project skills on a name clash, so the run drops
            the user source (--setting-sources project,local), re-adds the user
            settings via --settings ~/.claude/settings.json, and mirrors
            ~/.claude/{skills,agents,commands} into <scratch>/.claude/ with the
            candidates swapped in. Global CLAUDE.md and hooks still load. Not
            mirrored: user-scope MCP servers, claude.ai org skills. Compare
            candidate runs only against a --candidates run of the old text.
    codex:  CODEX_HOME=<scratch>/codex-home, a symlink mirror of ~/.codex with
            skills/<name> swapped (auth.json stays a symlink, never copied).
  Before any case runs, a probe session quotes each candidate's catalog
  description; on mismatch the run aborts before spending more quota.

usage:
  live-trigger-eval.py --harness claude|codex [--skills a,b] [--sets baseline,positives,negatives]
                       [--candidates DIR] [--out DIR] [--scratch DIR] [--dry-run]
Results: <out>/results.jsonl, <out>/summary.md, <out>/runNN.jsonl (stream logs),
<out>/probe.jsonl. Default out: <repo>/docs.local/live-trigger/<harness>-<stamp>/.
"""
import argparse, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
SKILLS_DIR = REPO / 'skills' / 'golem-powers'
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


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--harness', required=True, choices=['claude', 'codex'])
    ap.add_argument('--skills', default=','.join(DEFAULT_SKILLS))
    ap.add_argument('--sets', default='baseline,positives,negatives',
                    help='comma list of baseline, positives, negatives (trigger-evals split by polarity)')
    ap.add_argument('--candidates', type=Path, help='dir holding candidate <skill>/SKILL.md dirs')
    ap.add_argument('--out', type=Path)
    ap.add_argument('--scratch', type=Path, help='session cwd (default <repo>/.worktrees/live-trigger-<harness>)')
    ap.add_argument('--dry-run', action='store_true', help='list cases and exit; spends nothing')
    return ap.parse_args()


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


def mirror(src, dst, swap):
    """Symlink every entry of src into dst (resolving one level), then swap named entries."""
    dst.mkdir(parents=True, exist_ok=True)
    for e in sorted(src.iterdir()) if src.is_dir() else []:
        link = dst / e.name
        if link.is_symlink() or link.exists():
            continue
        link.symlink_to(e.resolve() if e.is_symlink() else e)
    for name, target in swap.items():
        link = dst / name
        if link.is_symlink():
            link.unlink()
        elif link.exists():
            sys.exit(f'refusing to replace non-symlink {link}')
        link.symlink_to(target)


def prepare(args, skills):
    """Return (extra argv, env) for the harness, building the candidate mirror if asked."""
    env = dict(os.environ)
    if not args.candidates:
        return [], env
    swap = {}
    for s in skills:
        cand = (args.candidates / s).resolve()
        if not description(cand / 'SKILL.md'):
            sys.exit(f'no quoted description in {cand}/SKILL.md')
        swap[s] = cand
    home = Path.home()
    if args.harness == 'claude':
        dot = args.scratch / '.claude'
        if dot.exists():
            shutil.rmtree(dot)
        mirror(home / '.claude' / 'skills', dot / 'skills', swap)
        mirror(home / '.claude' / 'agents', dot / 'agents', {})
        mirror(home / '.claude' / 'commands', dot / 'commands', {})
        return ['--setting-sources', 'project,local', '--settings', str(home / '.claude' / 'settings.json')], env
    ch = args.scratch / 'codex-home'
    if ch.exists():
        shutil.rmtree(ch)
    ch.mkdir(parents=True)
    for e in sorted((home / '.codex').iterdir()):
        if e.name != 'skills':
            (ch / e.name).symlink_to(e)
    mirror(home / '.codex' / 'skills', ch / 'skills', swap)
    env['CODEX_HOME'] = str(ch)
    return [], env


def events(text):
    for line in text.splitlines():
        try:
            yield json.loads(line)
        except ValueError:
            continue


def run_claude(q, log, extra, env, cwd, max_turns='2'):
    cmd = ['claude', '-p', *extra, '--output-format', 'stream-json', '--verbose', '--max-turns', max_turns, q]
    p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=300,
                       stdin=subprocess.DEVNULL)
    log.write_text(p.stdout)
    loaded, model, texts = [], None, []
    for o in events(p.stdout):
        if o.get('type') == 'system' and o.get('subtype') == 'init':
            model = o.get('model')
        if o.get('type') == 'assistant':
            for c in o['message'].get('content', []):
                if c.get('type') == 'tool_use' and c.get('name') == 'Skill':
                    loaded.append(str(c.get('input', {}).get('skill', '')).split(':')[-1])
                if c.get('type') == 'text':
                    texts.append(c['text'])
    return loaded, model, '\n'.join(texts)


def run_codex(q, log, extra, env, cwd, skill_re=None):
    cmd = ['codex', 'exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only',
           '-m', CODEX_MODEL, '-c', 'model_reasoning_effort="low"', '-C', str(cwd), q]
    try:
        p = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL)
        out = p.stdout
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'').decode() if isinstance(e.stdout, bytes) else (e.stdout or '')
    log.write_text(out)
    loaded, texts = [], []
    for o in events(out):
        item = o.get('item') or o.get('msg') or {}
        if item.get('type') == 'agent_message':
            texts.append(item.get('text', ''))
        if skill_re and item.get('type') == 'command_execution':
            loaded += [m.group(1) for m in skill_re.finditer(item.get('command', ''))]
    return list(dict.fromkeys(loaded)), f'{CODEX_MODEL} (requested; see log)', '\n'.join(texts)


def norm(s):
    return re.sub(r'\s+', ' ', s.replace('\\"', '"').replace('“', '"').replace('”', '"')).strip()


def probe(args, skills, extra, env):
    """One session quotes each candidate's catalog description; abort on mismatch."""
    q = ('Without using any tools and without loading any skill: for each of these skill names - '
         + ', '.join(skills) + ' - quote its description from your available skills list verbatim, '
         'one per line, as `<name>: <description>`.')
    log = args.out / 'probe.jsonl'
    if args.harness == 'claude':
        _, model, text = run_claude(q, log, extra, env, args.scratch, max_turns='1')
    else:
        _, model, text = run_codex(q, log, extra, env, args.scratch)
    rows = {}
    for s in skills:
        want = description(args.candidates / s / 'SKILL.md')
        rows[s] = dict(expected=want, in_effect=norm(want) in norm(text))
    (args.out / 'probe.json').write_text(json.dumps(dict(model=model, response=text, skills=rows), indent=2))
    bad = [s for s, r in rows.items() if not r['in_effect']]
    if bad:
        sys.exit(f'PROBE MISMATCH: candidate description not in effect for {bad}; see {log}')
    return model


def frac(rows):
    return f"{sum(r['correct'] for r in rows)}/{len(rows)}"


def main():
    args = parse_args()
    skills = [s.strip() for s in args.skills.split(',') if s.strip()]
    sets = {s.strip() for s in args.sets.split(',')}
    cases = build_cases(skills, sets)
    stamp = time.strftime('%Y%m%d-%H%M')
    args.out = args.out or REPO / 'docs.local' / 'live-trigger' / f'{args.harness}-{stamp}'
    args.scratch = args.scratch or REPO / '.worktrees' / f'live-trigger-{args.harness}'
    if args.dry_run:
        for i, c in enumerate(cases, 1):
            print(f"{i:02d} {c['set']:13} {c['skill']:13} {str(c['should_trigger']):5} {c['query']}")
        print(f'{len(cases)} cases; harness={args.harness}; candidates={args.candidates or "installed"}')
        return
    args.out.mkdir(parents=True, exist_ok=True)
    args.scratch.mkdir(parents=True, exist_ok=True)
    extra, env = prepare(args, skills)
    probe_model = probe(args, skills, extra, env) if args.candidates else None
    skill_re = re.compile(r'skills/(' + '|'.join(map(re.escape, skills)) + r')/SKILL\.md')
    results = []
    for i, c in enumerate(cases, 1):
        log = args.out / f'run{i:02d}.jsonl'
        t = time.time()
        try:
            if args.harness == 'claude':
                loaded, model, _ = run_claude(c['query'], log, extra, env, args.scratch)
            else:
                loaded, model, _ = run_codex(c['query'], log, extra, env, args.scratch, skill_re)
        except Exception as e:  # record, never hide
            loaded, model = [], f'ERROR {e}'
        hit = c['skill'] in loaded
        c.update(run=i, loaded=loaded, model=model, secs=round(time.time() - t),
                 correct=(hit == c['should_trigger']))
        results.append(c)
        with open(args.out / 'results.jsonl', 'a') as f:
            f.write(json.dumps(c) + '\n')

    base = [r for r in results if r['set'] == 'baseline']
    te = [r for r in results if r['set'] == 'trigger-evals']
    lines = [f'# Live trigger eval — {args.harness} — {time.strftime("%Y-%m-%d %H:%M")}',
             f'baseline planning {frac([r for r in base if r["skill"] == "large-plan"])}; '
             f'baseline dispatch+PR {frac([r for r in base if r["skill"] != "large-plan"])}',
             f'trigger-evals {frac(te)} (positives {frac([r for r in te if r["should_trigger"]])}, '
             f'negatives {frac([r for r in te if not r["should_trigger"]])})',
             'per skill (trigger-evals positives): ' + '; '.join(
                 f"{s} {frac([r for r in te if r['skill'] == s and r['should_trigger']])}" for s in skills),
             f'descriptions in effect: {"candidates from " + str(args.candidates) + " (probe verified, see probe.json)" if args.candidates else "installed"}',
             '', '| # | set | skill | should | loaded | correct | query |', '|---|---|---|---|---|---|---|']
    lines += [f"| {r['run']} | {r['set']} | {r['skill']} | {r['should_trigger']} | {','.join(r['loaded']) or '—'} | "
              f"{'✓' if r['correct'] else '✗'} | {r['query']} |" for r in results]
    models = sorted({str(r['model']) for r in results} | ({str(probe_model)} if probe_model else set()))
    lines += ['', f'model_effective observed: {models} (model_observation_source: session JSONL init `model` field)',
              'effort_effective: NOT DETERMINED (effort_observation_source: NOT DETERMINED — headless stream '
              'carries no effort field) → NON_COMPARABLE; n=1 per query; counts only, no score/delta claim.']
    (args.out / 'summary.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines[:5]))


if __name__ == '__main__':
    main()
