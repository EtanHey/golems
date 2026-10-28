# Repeat the guarded Golems install on the M1 Pro

## 0. Scope and authority

Status: **r4s procedure revision** (r4n KNOWN_DRIFT pre-step; r4o §5 formatter; r4p stable protected-state comparator per PHX ruling (c), *_CHANGED diagnostics, pre-snapshot recovery mode and the free-space floor; r4q recovery parent-identity and legacy-lock fixes; r4r LaunchAgents plist byte prefilter; r4s `.brainlayer/logs|queue` as BrainLayer runtime). Offline re-checks: REVIEW-r4p-*, REVIEW-r4q/r4r/r4s in the release-custody lane. Live execution still requires the existing authorization and shipping gates.

Retained B′ contract: The M1 Pro requirements manifest is derived deterministically from the SAME reviewed M4 Max manifest selected by its existing parity config: schema 2, identical canonical roots, exactly reversed identity pins, and no other keys. Both observed identities are checked by the Git-sourced library. The additional reviewed KNOWN_DRIFT unlink has separate durable snapshot/custody and rollback verification; it does not change the parity prerequisite contract. The two exact §2 files and their created-if-absent M1 parent have idempotent creation and snapshot/rollback custody; a new parent is owner-only mode `0700`. This research authorizes no live execution and performed no live writes. Bootstrap still requires PHX's actual go and §1b; all later runs require the full I5 gate and revalidation of shipped bytes. The historical r4j decision/trace is retained below; B′ explicitly revises B's byte-identity contract.

Etan's three rulings, supplied verbatim in BRIEF-M1-PROCEDURE-r2.md:

> brainbar-23b709c5-f4b: "Standing yes, skills only": "after each guarded golems merge, the deploy agent syncs golems main into ~/.claude/skills on the M1 (the M1 Pro user; username elided for the public repo, full quote in BrainLayer brainbar-23b709c5-f4b) and records a receipt. It never touches /Applications, BrainLayer, or LaunchAgents."

> brainbar-ed39050a-c93: "This needs to be done properly, not one shotted but stable to follow the same next time, all 5 skills folder"

> brainbar-60c4e641-8a9: "Whole golems install": the standing M1 Pro sync after each guarded golems merge covers the 5 skills folders, the ~/.golems/bin wrappers, ~/.golems/releases + current, and golems' Claude/Codex client hooks, via ONE written procedure (W10 sync-m1.py → install.sh --from-file + repoint-skills) with a receipt. Never /Applications, BrainLayer or LaunchAgents. Etan 2026-10-18 still covers everything else.

Ruling 3 includes O01–O12 in the M1 write inventory (release-custody's private record). Shared client configuration may change only under its top-level `hooks` key. Section 4 enforces that condition through a recursive JSON diff.

Executor: CI-hygiene's deploy agent, from the **M4 Max**, targeting alias `m1` with its existing configured account on the **M1 Pro**. Use one fresh Bash shell in `$HOME/Gits/orchestrator`. For full runs, only `<UTC_TS>` needs replacement; §1 reads `MERGE_SHA` from current golems master HEAD and verifies the matching published release. For bootstrap run 1, PHX also supplies the existing reviewed go record via `PHX_GO_FILE`, including the live-row lease PR and checkout; §1b validates it before any M1 Pro action. Use a full lowercase 40-character SHA and UTC timestamp `YYYYmmddTHHMMSSffffff`, without `Z`. No scratch checkout, mutable installer URL, alternative installer, manual receipt, deleted evidence, or automatic retry. Manual rollback retry uses the same run identity and a new numbered attempt (§6).

**External preconditions:** CI-hygiene creates `$HOME/.golems/ratchet/m1-sync-authorized.json` OUTSIDE this procedure from Etan's three quoted rulings above (chunk ids `brainbar-23b709c5-f4b`, `brainbar-ed39050a-c93`, `brainbar-60c4e641-8a9`). For bootstrap run 1, PHX creates the go record OUTSIDE this procedure and supplies its exact absolute path through `PHX_GO_FILE`. This procedure only verifies that the required grant and, in bootstrap mode, PHX go record exist and are well-formed; a missing or malformed required record means STOP. It must never create, edit, or delete either file.

`collab/TEMPLATE.md` was read in the original research. This is a static runbook. PR Loop: N/A for this procedure-only research task. TDD: local behavior self-tests/replays below. Syntax/source checks do not establish an install or rollback pass. GitHub source inspected at #918 head `4b6ddf3d24b7426773bf4896a3c39973e9b8b2dc`: sync-m1.py, installed-skills.py, skills-receipt.py, skills-sync-receipt.mjs, lib/skills-sync-receipt.mjs, lib/install-receipt-core.mjs, release/install.sh, and vendor-skills.mjs. Revalidate final merged/shipped bytes below. r4i used strict read-only SSH to inspect M1 config prerequisites; it executed no M1 mutation or deployment.

## 1. Check prerequisites before any M1 Pro action

Run this block first. Any failed prerequisite stops the shell. Do not create a grant, parity config, missing root, runtime, or SSH trust entry to make it pass, except EXACTLY §2's created-if-absent M1 Pro `$HOME/.golems/ratchet` parent (mode `0700`) and reviewed M1 Pro `$HOME/.golems/ratchet/installed-skills.json` four-key template and `$HOME/.golems/ratchet/requirements.json` derived B′ manifest: create either only if absent, mode `0600`, owned by the running user; verify present files without rewriting. The parent `.golems` must already be a real, non-symlink directory owned by the running user. An existing `ratchet` must be a real, non-symlink directory owned by that user and not group/world writable; never chmod it. This exception creates no identity key, skill root, M4 Max parity config/manifest, grant, or trust entry. The separate KNOWN_DRIFT exception in §2 permits only the reviewed post-snapshot unlink of `.gemini/config/skills/tmp-block`, with exact link text, ownership, real-parent and absent-target checks, durable custody and rollback verification. All other missing prerequisites remain separate work. CI-hygiene must have created `$HOME/.golems/ratchet/m1-sync-authorized.json` OUTSIDE this procedure from Etan's quoted rulings (`brainbar-23b709c5-f4b`, `brainbar-ed39050a-c93`, `brainbar-60c4e641-8a9`). PHX must have created bootstrap's go record OUTSIDE this procedure and supplied its exact absolute path in `PHX_GO_FILE`. The procedure only verifies these required files exist and are well-formed (grant in both modes; PHX go in bootstrap mode), STOPs otherwise, and never creates, edits, or deletes either file. The sole exception is bootstrap run 1 under §1b; it uses the frozen reviewed hash and defers only the explicitly listed receipt checks.

```bash
set -Eeuo pipefail
umask 077
export GIT_OPTIONAL_LOCKS=0
MERGE_SHA="$(gh api repos/EtanHey/golems/commits/master --jq .sha)"
export MERGE_SHA
export UTC_TS='<UTC_TS>'
export GOLEMS_ROOT="$HOME/Gits/golems"
# PHX selects bootstrap-run-1 only for its approved first run; otherwise full.
export PROC_MODE="${PROC_MODE:-full}"
case "$PROC_MODE" in full|bootstrap-run-1) ;; *) exit 78 ;; esac
export RUN_LOG="$GOLEMS_ROOT/docs.local/ratchet-runs/m1-procedure-runs.tsv"
if [ "$PROC_MODE" = full ]; then
for pr in 915 916 917 918; do
  if ! pr_state="$(gh pr view "$pr" -R EtanHey/golems --json state --jq .state)"; then
    printf '%s\n' 'precondition: I5 not merged' >&2
    exit 78
  fi
  if [ "$pr_state" != MERGED ]; then
    printf '%s\n' 'precondition: I5 not merged' >&2
    exit 78
  fi
done
fi
python3 -I -B - <<'PY'
import os, re
from datetime import datetime
assert re.fullmatch(r'[0-9a-f]{40}', os.environ['MERGE_SHA']), 'full merge SHA required'
v = os.environ['UTC_TS']
assert re.fullmatch(r'\d{8}T\d{12}', v), 'UTC_TS must be YYYYmmddTHHMMSSffffff'
assert datetime.strptime(v, '%Y%m%dT%H%M%S%f').strftime('%Y%m%dT%H%M%S%f') == v
for key in ('CODEX_HOME', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME', 'RATCHET_SKILL_CONFIG'):
    assert not os.environ.get(key), 'unexpected environment override: ' + key
PY
test "$(git -C "$GOLEMS_ROOT" rev-parse HEAD)" = "$MERGE_SHA"
test "$(git -C "$GOLEMS_ROOT" rev-parse refs/heads/master)" = "$MERGE_SHA"
test "$(gh api repos/EtanHey/golems/commits/master --jq .sha)" = "$MERGE_SHA"
test -z "$(git -C "$GOLEMS_ROOT" status --porcelain --untracked-files=no)"
if [ "$PROC_MODE" = full ]; then
for pr in 915 916 917 918; do
  merged_commit="$(gh pr view "$pr" -R EtanHey/golems --json mergeCommit --jq .mergeCommit.oid)"
  test -n "$merged_commit"
  git -C "$GOLEMS_ROOT" merge-base --is-ancestor "$merged_commit" "$MERGE_SHA"
done
fi
# live-freshness.mjs:39–49 selects the latest guarded first-parent master commit
# and its merged PR separately from the current master release being installed.
LATEST_GUARDED="$(git -C "$GOLEMS_ROOT" log --first-parent -1 --format=%H master -- scripts/hooks/ skills/golem-powers/human-confirm-gate/ skills/golem-powers/git-guardian/ skills/golem-powers/tmp-block/ scripts/repogolem/ scripts/ratchet/)"
export LATEST_GUARDED
python3 -I -B - <<'PY'
import os, re, subprocess

def require_first_parent_ancestor(guarded, head, ancestor_exit, first_parents):
    if ancestor_exit != 0 or not first_parents or first_parents[0] != head or guarded not in first_parents:
        raise ValueError('STOP: latest guarded head is not a first-parent ancestor of master')

def ancestry_self_test():
    head, guarded, older = 'a'*40, 'b'*40, 'c'*40
    for label, candidate, ancestor_exit, parents, allowed in (
        ('guarded head equals master', head, 0, [head, older], True),
        ('non-guarded merges above guarded head', guarded, 0, [head, older, guarded], True),
        ('guarded head not an ancestor', guarded, 1, [head, older], False),
        ('guarded head only through second parent', guarded, 0, [head, older], False),
    ):
        try: require_first_parent_ancestor(candidate, head, ancestor_exit, parents)
        except ValueError:
            assert not allowed, label + ' must pass'
        else:
            assert allowed, label + ' must STOP'
ancestry_self_test()
root, guarded, head = (os.environ[k] for k in ('GOLEMS_ROOT', 'LATEST_GUARDED', 'MERGE_SHA'))
assert re.fullmatch('[0-9a-f]{40}', guarded), 'STOP: no guarded master commit'
ancestor_exit = subprocess.run(['git', '-C', root, 'merge-base', '--is-ancestor', guarded, head]).returncode
first_parents = subprocess.check_output(['git', '-C', root, 'rev-list', '--first-parent', head], text=True).splitlines()
require_first_parent_ancestor(guarded, head, ancestor_exit, first_parents)
print('FIRST_PARENT_ANCESTRY_SELF_TEST_PASS; GUARDED_ANCESTRY_VERIFIED')
PY
MERGED_PR="$(gh api "repos/EtanHey/golems/commits/$LATEST_GUARDED/pulls" --jq '[.[] | select(.merged_at != null and .base.ref == "master" and .merge_commit_sha == env.LATEST_GUARDED)] | if length == 1 then .[0].number else error("one exact guarded merged master PR required") end')"
export MERGED_PR
gh pr checks "$MERGED_PR" -R EtanHey/golems --required
if [ "$PROC_MODE" = full ]; then
for source_path in scripts/ratchet/sync-m1.py scripts/ratchet/installed-skills.py; do
  for flag in StrictHostKeyChecking=yes UpdateHostKeys=no BatchMode=yes; do
    git -C "$GOLEMS_ROOT" show "master:$source_path" | rg --fixed-strings -- "$flag"
  done
done
python3 -I -B - "$GOLEMS_ROOT" <<'PY'
import ast, pathlib, sys
for name, minimum in [('sync-m1.py', 3), ('installed-skills.py', 1)]:
    tree = ast.parse((pathlib.Path(sys.argv[1]) / 'scripts/ratchet' / name).read_text())
    commands = [n for n in ast.walk(tree) if isinstance(n, ast.List) and n.elts
                and isinstance(n.elts[0], ast.Constant) and n.elts[0].value in ('ssh', 'scp')]
    assert len(commands) >= minimum, 'transport shape changed; re-audit ' + name
    for command in commands:
        values = [n.value if isinstance(n, ast.Constant) else None for n in command.elts]
        for flag in ('StrictHostKeyChecking=yes', 'UpdateHostKeys=no', 'BatchMode=yes'):
            assert any(values[i:i+2] == ['-o', flag] for i in range(len(values)-1)), (name, flag)
print('I5_TRANSPORT_FLAGS_PRESENT')
PY
fi
# Bootstrap refusal is checked below, before creating evidence or using SSH.
if [ "$PROC_MODE" = bootstrap-run-1 ]; then
python3 -I -B - "$RUN_LOG" "${PHX_GO_FILE:?PHX go record required}" <<'PY'
import json, os, re, stat, subprocess, sys
from datetime import datetime
from pathlib import Path

def require_bootstrap(states, rows):
    if len(states) != 4 or any(s not in ('OPEN', 'CLOSED', 'MERGED') for s in states):
        raise ValueError('STOP: incomplete I5 states')
    if any(s == 'MERGED' for s in states):
        raise ValueError('STOP: I5 merged; bootstrap disabled')
    for row in rows:
        if (not isinstance(row, list) or len(row) != 5 or
                any(not isinstance(x, str) for x in row) or
                not re.fullmatch('[0-9a-f]{40}', row[1]) or
                row[3] not in ('STOP', 'FAILED', 'BOOTSTRAP', 'LIVE_WITH_FIVE_ROOT_CHECKS')):
            raise ValueError('STOP: malformed or ambiguous run history')
        stamp = datetime.fromisoformat(row[0].replace('Z', '+00:00'))
        if stamp.utcoffset() is None: raise ValueError('STOP: undated run history')
        if row[3] in ('BOOTSTRAP', 'LIVE_WITH_FIVE_ROOT_CHECKS'):
            raise ValueError('STOP: prior success; bootstrap disabled')

def bootstrap_self_test():
    success = ['2026-10-28T00:00:00+00:00', 'a'*40, 'none', 'BOOTSTRAP', 'none']
    for states, rows in [(['MERGED'] + ['OPEN']*3, []), (['OPEN']*4, [success])]:
        try: require_bootstrap(states, rows)
        except ValueError: pass
        else: raise AssertionError('bootstrap refusal self-test failed')
    require_bootstrap(['OPEN']*4, [])
bootstrap_self_test()
log, go_path = Path(sys.argv[1]), Path(sys.argv[2])
if not go_path.is_absolute() or go_path.is_symlink(): raise ValueError('STOP: unsafe PHX go record')
info = go_path.stat()
assert stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077
request = json.loads(go_path.read_text())
assert request['approved_by'] == 'PHX' and request['go'] == 'bootstrap-run-1'
assert request['merge_sha'] == os.environ['MERGE_SHA'] and request['utc_ts'] == os.environ['UTC_TS']
assert request['history_complete'] is True and request['no_prior_success'] is True
assert type(request['lease_pr']) is int and request['lease_pr'] > 0
assert Path(request['lease_repo']).is_absolute() and Path(request['lease_repo']).is_dir()
assert isinstance(request['approval_evidence'], str) and request['approval_evidence'].strip()
assert not log.is_symlink(), 'STOP: symlinked run log'
rows = [[json.loads(field) for field in line.split('\t')] for line in log.read_text().splitlines()] if log.exists() else []
states = [json.loads(subprocess.check_output(['gh', 'pr', 'view', str(pr), '-R', 'EtanHey/golems', '--json', 'state']))['state'] for pr in (915,916,917,918)]
require_bootstrap(states, rows)
# Pin the unmodified public W10 route: no unreviewed helper replacement.
for name in ('sync-m1.py', 'live-rows.sh', 'installed-skills.py'):
    import base64
    path = 'scripts/ratchet/' + name
    reviewed = json.loads(subprocess.check_output(['gh', 'api', 'repos/EtanHey/golems/contents/' + path + '?ref=f168a2d884a4b0c49b0467089eba81ef0c9a0bb4']))
    actual = subprocess.check_output(['git', '-C', os.environ['GOLEMS_ROOT'], 'show', os.environ['MERGE_SHA'] + ':' + path])
    assert actual == base64.b64decode(reviewed['content']), 'STOP: W10 source changed; review first: ' + name
print('BOOTSTRAP_SELF_TEST_PASS; PHX_GO_AND_W10_VERIFIED')
PY
fi
python3 -B "$GOLEMS_ROOT/scripts/ratchet/sync-m1.py" --check-authorization
python3 -B "$GOLEMS_ROOT/scripts/ratchet/installed-skills.py" --check-config
VERSION="$(python3 -I -B - "$GOLEMS_ROOT" "$MERGE_SHA" <<'PY'
from datetime import datetime, timezone
import subprocess, sys
stamp = int(subprocess.check_output(['git', '-C', sys.argv[1], 'show', '-s', '--format=%ct', sys.argv[2]], text=True))
print(datetime.fromtimestamp(stamp, timezone.utc).strftime('%Y.%m.%d') + '-' + sys.argv[2][:7])
PY
)"
export VERSION
export RUN="$GOLEMS_ROOT/docs.local/ratchet-runs/m1-procedure-$MERGE_SHA-$UTC_TS"
test "$(gh api "repos/EtanHey/golems/releases/tags/v$VERSION" --jq .draft)" = false
mkdir -p "$GOLEMS_ROOT/docs.local/ratchet-runs"
mkdir "$RUN"
python3 -I -B - "$RUN" "$VERSION" <<'PYDISK'
import json, os, subprocess, sys
from pathlib import Path
run, version = Path(sys.argv[1]), sys.argv[2]
release = json.loads(subprocess.check_output(['gh', 'api', 'repos/EtanHey/golems/releases/tags/v' + version]))
names = {'golems-' + version + '.tar.gz', 'SHA256SUMS', 'MANIFEST.json'}
assets = [a for a in release['assets'] if a['name'] in names]
assert len(assets) == 3 and {a['name'] for a in assets} == names, 'STOP: missing/duplicate release assets'
assert all(type(a['size']) is int and a['size'] >= 0 for a in assets), 'STOP: invalid release asset size'
margin, reserve, evidence_allowance = 2, 10 * 1024**3, 256 * 1024**2
required = (sum(a['size'] for a in assets) + evidence_allowance) * margin
need_bytes = required + reserve
volume = os.statvfs(run)
free = volume.f_bavail * volume.f_frsize
result = dict(host='M4 Max', assets={a['name']: a['size'] for a in assets},
    evidence_allowance=evidence_allowance, margin=margin, required=required, reserve=reserve, need=need_bytes, free=free)
if free < need_bytes:
    result = dict(verdict='STOP', mode='preflight', disk=result,
        error='STOP: INSUFFICIENT_DISK need=' + str(need_bytes) + ' free=' + str(free) + ' reserve=' + str(reserve))
    destination = run / 'preflight.json'
else:
    result['verdict'] = 'M4_DISK_READY'
    destination = run / 'm4-disk-preassets.json'
with destination.open('x') as output:
    json.dump(result, output, sort_keys=True); output.flush(); os.fsync(output.fileno())
fd = os.open(run, os.O_RDONLY)
try: os.fsync(fd)
finally: os.close(fd)
print(json.dumps(result, sort_keys=True))
if result['verdict'] == 'STOP': raise SystemExit(1)
PYDISK
mkdir "$RUN/release-preflight"
python3 -I -B - "$RUN/target-identity.json" <<'PY'
import json, os, sys
with open(sys.argv[1], 'x') as output:
    json.dump({key: os.environ[key] for key in ('MERGE_SHA', 'LATEST_GUARDED', 'MERGED_PR', 'VERSION')}, output, sort_keys=True)
PY
gh release download "v$VERSION" --repo EtanHey/golems --dir "$RUN/release-preflight" --pattern "golems-$VERSION.tar.gz" --pattern SHA256SUMS --pattern MANIFEST.json
python3 -B - "$GOLEMS_ROOT" "$MERGE_SHA" "$VERSION" "$RUN/release-preflight" <<'PY'
from pathlib import Path
import copy, hashlib, json, os, runpy, subprocess, sys, tarfile
root, head, version, work = Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4])

def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])

def same(actual, expected, label):
    assert actual == expected, 'STOP: ' + label

assert subprocess.run(['git', '-C', str(root), 'cat-file', '-e', head + '^{commit}'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0, 'STOP: M4 Max checkout lacks MERGE_SHA'

# These hashes freeze the transform audit below. Changed builder or policy bytes
# require a fresh audit, even when MERGE_SHA advances for unrelated changes.
for name, digest in (
    ('build-release.mjs', 'fba9fe1d2635ec52f3210e1d65c9421f33c1345156536bc09050896c95d05e7c'),
    ('shipped-paths.json', 'b2f4a95599930e9b6f86ed054d1382e0ac671216840a7d429cb135e236b34def'),
):
    same(hashlib.sha256(git('show', head + ':scripts/release/' + name)).hexdigest(), digest,
         'release transform audit changed: ' + name)
policy = json.loads(git('show', head + ':scripts/release/shipped-paths.json'))
# Use Node for the builder's JavaScript RegExp, field order and JSON.stringify.
# No builder code is executed and no release is built or extracted to disk.
derivation = r"""
const fs = require('node:fs');
const { records, policy, source } = JSON.parse(fs.readFileSync(0, 'utf8'));
const roots = policy.roots, support = new Set(policy.support);
const excludedParts = new Set(policy.excluded_parts), excludedFiles = new RegExp(policy.excluded_files);
function shipped(path) {
  if (!support.has(path) && !roots.some(root => path.startsWith(root))) return false;
  return !path.split('/').some(part => excludedParts.has(part)) && !excludedFiles.test(path);
}
const selected = records.filter(record => shipped(record.path) || record.path === 'package.json')
  .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
for (const file of selected) if (file.type !== 'blob' || !['100644', '100755'].includes(file.mode))
  throw new Error(`unsupported git mode ${file.mode}: ${file.path}`);
const dependencies = Object.fromEntries(['ajv', 'yaml', 'varlock'].map(name => {
  if (!source.dependencies?.[name]) throw new Error(`missing runtime dependency: ${name}`);
  return [name, source.dependencies[name]];
}));
const pkg = JSON.stringify({ name: 'golems-release', private: true, type: 'module', dependencies }, null, 2) + '\n';
process.stdout.write(JSON.stringify({ records: selected, package: pkg }));
"""

def derive(records, source):
    return json.loads(subprocess.check_output(['node', '-e', derivation],
        input=json.dumps(dict(records=records, policy=policy, source=source)).encode(), stderr=subprocess.PIPE))

def json_bytes(value):
    return subprocess.check_output(['node', '-e',
        "process.stdout.write(JSON.stringify(JSON.parse(require('node:fs').readFileSync(0, 'utf8')), null, 2) + '\\n')"],
        input=json.dumps(value).encode())

def inventory(actual, expected):
    same(actual, expected, 'release path selection/order')

def metadata(member, mode):
    same((member.mode, member.uid, member.gid, member.mtime, member.uname, member.gname,
          member.type, member.linkname, member.pax_headers),
         (int(mode, 8), 0, 0, 0, '', '', tarfile.REGTYPE, '', {}), 'release metadata: ' + member.name)

def gzip_header(data):
    same(data[:10], bytes.fromhex('1f8b08000000000002ff'), 'normalized gzip header')

def must_stop(label, check):
    try: check()
    except (AssertionError, subprocess.CalledProcessError): pass
    else: raise AssertionError('self-test did not STOP: ' + label)

source_package = json.loads(git('show', head + ':package.json'))
records = []
for record in git('ls-tree', '-rz', '--full-tree', head).decode().split('\0'):
    if not record: continue
    info, path = record.split('\t')
    mode, kind, oid = info.split(' ')
    records.append(dict(path=path, mode=mode, type=kind, oid=oid))
i5_path = 'scripts/ratchet/installed-skills.py'
i5_records = [r for r in records if r['path'] == i5_path]
assert len(i5_records) == 1 and i5_records[0]['type'] == 'blob' and i5_records[0]['mode'] in ('100644', '100755'), 'STOP: missing/unsafe I5 Git source'
i5_bytes = git('show', head + ':' + i5_path)
same(i5_bytes, git('cat-file', 'blob', i5_records[0]['oid']), 'I5 source/ls-tree blob bytes')
same(subprocess.check_output(['git', '-C', str(root), 'hash-object', '--stdin'], input=i5_bytes).decode().strip(),
     i5_records[0]['oid'], 'I5 source blob ID')
i5_identity = dict(merge_sha=head, path=i5_path, blob_id=i5_records[0]['oid'], sha256=hashlib.sha256(i5_bytes).hexdigest())
derived = derive(records, source_package)
package_bytes = derived['package'].encode()
# Inline transform tests run before checking the downloaded release.
same(package_bytes, json_bytes(dict(name='golems-release', private=True, type='module',
    dependencies={name: source_package['dependencies'][name] for name in ('ajv', 'yaml', 'varlock')})),
    'derived package positive self-test')
for field in ('dependency', 'field'):
    changed = json.loads(package_bytes)
    if field == 'dependency': changed['dependencies']['ajv'] += '-changed'
    else: changed['private'] = False
    must_stop('changed package ' + field, lambda: same(json_bytes(changed), package_bytes, 'derived package'))
fixture_paths = list(policy['support']) + [p + 'kept.txt' for p in policy['roots']] + ['package.json']
omitted = ['README.md'] + [policy['roots'][0] + p + '/x.txt' for p in policy['excluded_parts']]
omitted += [policy['roots'][0] + p for p in ('.env', '.env.local', 'secrets.json', 'x.test.js', 'x.pem', 'x.key', 'x.pyc')]
fixture = [dict(path=p, mode='100644', type='blob', oid='a'*40) for p in fixture_paths + omitted]
selected = [r['path'] for r in derive(fixture, source_package)['records']]
inventory(selected, sorted(fixture_paths, key=lambda p: p.encode()))
for changed in (selected[:-1], sorted(selected + [omitted[0]], key=lambda p: p.encode())):
    must_stop('missing/extra shipped path', lambda: inventory(changed, selected))
for mode, kind in (('120000', 'blob'), ('160000', 'commit')):
    must_stop('unsupported git mode', lambda: derive([dict(path='package.json', mode=mode, type=kind)], source_package))
for mode in ('0644', '0755'):
    member = tarfile.TarInfo('fixture'); member.mode = int(mode, 8)
    metadata(member, mode)
    for attribute, value in (('mode', 0o600), ('uid', 1), ('gid', 1), ('mtime', 1),
                             ('uname', 'changed'), ('gname', 'changed'), ('type', tarfile.SYMTYPE),
                             ('linkname', 'changed'), ('pax_headers', {'path': 'changed'})):
        changed = copy.deepcopy(member); setattr(changed, attribute, value)
        must_stop('changed archive ' + attribute, lambda: metadata(changed, mode))
gzip_header(bytes.fromhex('1f8b08000000000002ff'))
must_stop('changed gzip OS', lambda: gzip_header(bytes.fromhex('1f8b0800000000000203')))
same(b'line\r\n', b'line\r\n', 'raw blob positive self-test')
must_stop('normalized line endings', lambda: same(b'line\n', b'line\r\n', 'raw blob'))
module = runpy.run_path(str(root / 'scripts/ratchet/sync-m1.py'), run_name='procedure_verify')
module['verify'](work, head, version)
expected_data, expected_modes = {}, {}
# Read raw Git blobs, without checkout filters or line-ending conversion.
blobs = subprocess.check_output(['git', '-C', str(root), 'cat-file', '--batch'],
    input=''.join(r['oid'] + '\n' for r in derived['records']).encode())
offset = 0
for record in derived['records']:
    end = blobs.index(b'\n', offset)
    oid, kind, size = blobs[offset:end].decode().split(' ')
    same((oid, kind), (record['oid'], 'blob'), 'Git blob identity')
    length = int(size)
    data = blobs[end + 1:end + 1 + length]; offset = end + 2 + length
    name = record['path']
    expected_data[name] = package_bytes if name == 'package.json' else data
    expected_modes[name] = '0755' if record['mode'] == '100755' else '0644'
same(offset, len(blobs), 'Git batch framing')
assert 'package.json' in expected_data, 'STOP: missing derived package.json'
manifest = dict(version=version, commit=head, files=[dict(path=name,
    sha256=hashlib.sha256(data).hexdigest(), mode=expected_modes[name]) for name, data in expected_data.items()])
manifest_bytes = json_bytes(manifest)
same((work / 'MANIFEST.json').read_bytes(), manifest_bytes, 'derived external MANIFEST.json')
for field in ('version', 'commit', 'sha256', 'mode'):
    changed = copy.deepcopy(manifest)
    if field in ('version', 'commit'): changed[field] = 'changed'
    else: changed['files'][0][field] = 'changed'
    must_stop('changed manifest ' + field, lambda: same(json_bytes(changed), manifest_bytes, 'generated manifest'))
expected_data['MANIFEST.json'], expected_modes['MANIFEST.json'] = manifest_bytes, '0644'
filename = 'golems-' + version + '.tar.gz'
compressed = (work / filename).read_bytes()
gzip_header(compressed)
sums = (hashlib.sha256(compressed).hexdigest() + '  ' + filename + '\n' +
        hashlib.sha256(manifest_bytes).hexdigest() + '  MANIFEST.json\n').encode()
same((work / 'SHA256SUMS').read_bytes(), sums, 'derived SHA256SUMS')
must_stop('changed checksums', lambda: same(b'changed\n' + sums, sums, 'generated SHA256SUMS'))
with tarfile.open(work / filename) as archive:
    inventory([m.name for m in archive.getmembers()], sorted(expected_data, key=lambda p: p.encode()))
    for member in archive.getmembers():
        same(archive.extractfile(member).read(), expected_data[member.name], 'shipped/derived content: ' + member.name)
        metadata(member, expected_modes[member.name])
    print('RELEASE_TRANSFORM_SELF_TEST_PASS; RELEASE_TRANSFORMS_VERIFIED', head, version, len(expected_data))
    required = ('scripts/release/install.sh',)
    if os.environ['PROC_MODE'] == 'full':
        required += ('scripts/skills-sync-receipt.mjs', 'scripts/ratchet/skills-receipt.py')
    for name in required:
        assert name in archive.getnames() and archive.getmember(name).isfile(), 'STOP: missing shipped I5 member: ' + name
with (Path(os.environ['RUN']) / 'i5-source.json').open('x') as output:
    json.dump(i5_identity, output, sort_keys=True)
print('I5_GIT_SOURCE_VERIFIED', i5_identity['blob_id'], i5_identity['sha256'])
print('RELEASE_BYTES_AND_SOURCE_VERIFIED', head, version)
PY
```

Release transform audit at `MERGE_SHA=218a5a50111819cf8efd146890e0ed0b5341d372` (run 1's recorded target). `build-release.mjs` imports only Node built-ins and the shipping policy. Its SHA256 and the policy SHA256 are checked above on every run. Changed bytes STOP for re-audit. The verifier never runs the builder.

| Builder source at that SHA | Transform | Required verification |
| --- | --- | --- |
| `scripts/release/build-release.mjs:12–18,52–57`; `scripts/release/shipped-paths.json:3–6` | Select policy roots and support paths, exclude named parts and file patterns, always include `package.json`; reject symlinks and submodules. All other source paths are omitted. No paths are renamed. | Recompute the exact path set with JavaScript's own predicate and compare the complete ordered archive inventory. Test included, excluded, missing and extra paths, and rejected Git modes. |
| `scripts/release/build-release.mjs:58–66,69–76` | Copy Git blobs verbatim, except `package.json`. Derive its name, private flag, module type and exactly `ajv`, `yaml`, `varlock` in that order from source dependencies. Serialize with `JSON.stringify(obj, null, 2) + "\n"`. | Compare raw blobs byte for byte. Compare `package.json` to the exact derived bytes. Dependency, field and line-ending mutations STOP. No checkout or line-ending filter runs. |
| `scripts/release/build-release.mjs:24–25,49–51,78–80,86` | Derive version from commit time and short SHA. Generate sorted `MANIFEST.json` containing target identity, transformed content hashes and normalized modes; embed the same bytes in the archive. | Existing §1 version derivation and `verify()` check target identity. Recreate canonical manifest bytes from the expected source content and modes; compare external and embedded copies. A changed manifest hash STOPs. |
| `scripts/release/build-release.mjs:28–45,65,80–82` | Normalize Git `100755` to `0755`, otherwise accepted `100644` to `0644`; generated manifest is `0644`. Encode sorted regular USTAR entries, split long names into USTAR prefix/name, zero owner/time metadata, pad blocks and gzip at level 9 with OS byte 255. | Compare every decoded path and mode, regular-file type, zero uid/gid/mtime, empty user/group/link names and absent PAX overrides. USTAR encoding preserves decoded names and content; tar parsing plus release SHA256 checks cover framing/padding. Check the normalized ten-byte gzip header. Mode and metadata mutations and a changed gzip OS STOP. No compressed-byte equivalence across zlib versions is assumed. |
| `scripts/release/build-release.mjs:83–87` | Write `golems-<version>.tar.gz`, external `MANIFEST.json`, and generated `SHA256SUMS`; these last two release assets are not source copies. | Existing `verify()` checks asset hashes, safe unique member inventory and every payload hash (`scripts/ratchet/sync-m1.py:125–142`). Also compare canonical checksum-file bytes derived from the actual compressed bytes and expected manifest. Changed checksums STOP. |

Offline r4f validation used the retained run-1 `release-preflight` assets with this exact target and `PROC_MODE=bootstrap-run-1`. The r4e comparison reproduced `shipped/source mismatch: package.json`; r4f verified all 653 archive members, then STOPPED because its required-member gate incorrectly required `scripts/ratchet/installed-skills.py`. The shipping policy deliberately omits that source file. Release custody's r4g decision separates the shipped payload from this Git source dependency. Section 1 now checks the commit exists locally, loads the source using `git -C "$GOLEMS_ROOT" show "$MERGE_SHA:scripts/ratchet/installed-skills.py"`, verifies its bytes and blob ID against `git ls-tree` at that commit, and records `merge_sha`, `path`, `blob_id`, and `sha256` in `$RUN/i5-source.json`. Each controller invocation repeats the Git-source verification and requires equality with that evidence before executing or sending the source. No working-tree or archive copy supplies `i5_source`. Installer membership remains mandatory in both modes; full mode also requires both receipt members. An offline replay does not rerun §1's live preconditions, contact the M1 Pro, authorize a retry, or change run 1's STOPPED result.

The guarded-path definition and selection command above reuse `scripts/ratchet/live-freshness.mjs:39–43` at master `5fcd6773b7d58d3a823a6a2e9694317e9eebcdf9` (using verified local `master` instead of its `origin/master`); its lines 47–49 resolve the guarded commit's merged master PR. `MERGE_SHA` is current master HEAD, whose matching release is installed. `LATEST_GUARDED` must be its first-parent ancestor, including equality; an unrelated commit or an ancestor reachable only through a second parent STOPs. `MERGED_PR` belongs to `LATEST_GUARDED`, and §3 passes that PR to `live-rows.sh --merged-pr`; non-guarded merges above it do not change the publication target. `$RUN/target-identity.json` records all three identities and the release version in both modes.

The existing owner-only `$HOME/.golems/ratchet/m1-sync-authorized.json` is an external prerequisite, verified by the public helper and never written here. Required-check, grant, API, release, unsafe-member, or source mismatch failures STOP. No M1 Pro action has occurred yet. Keep failed local evidence directories; never reuse them.

## 1b. Reviewed bootstrap exception and frozen I5 hash

Run §1 in both modes. The executable refusal inside §1 runs before evidence creation or any SSH: **any** MERGED I5 PR disables bootstrap, even while other I5 PRs remain OPEN. A successful §8 row also disables it. Unknown API state, incomplete/unreadable/malformed history, missing PHX go, or changed W10 source STOP. PHX alone gives CI-hygiene the run-1 go; a worker cannot issue or manufacture that go. The pre-existing, owner-only `PHX_GO_FILE` contains `approved_by: "PHX"`, `go: "bootstrap-run-1"`, the exact `merge_sha` and `utc_ts`, `history_complete: true`, `no_prior_success: true`, `approval_evidence`, `lease_pr`, and absolute `lease_repo`. These fields record PHX's actual reviewed decision, not a replacement for it. A missing run log is accepted only with PHX's complete-history attestation; failed attempts never authorize automatic retry.

**Reviewed receipt-only EXCEPTION (bootstrap run 1 only):** skip archive membership requirements for exactly `scripts/skills-sync-receipt.mjs` and `scripts/ratchet/skills-receipt.py`; skip the `m1-receipt: LIVE` log requirement, M1 receipt reads/validation in §§3–5, and the finish receipt identity check. Installer membership/bytes/modes, parity source Git identity/bytes, authorization, all five roots, snapshot, hook status, hook-key-only diff, protected state, symlink guards, and rollback remain required. No `install-receipt/v1` is fabricated. Keep NO-RECEIPT until full run 2.

W10 source pinned at `f168a2d884a4b0c49b0467089eba81ef0c9a0bb4`: `scripts/ratchet/live-rows.sh:29` checks `sync-m1.py --check-authorization` before other probes; lines 50–58 invoke the public positional sync. `sync-m1.py:150–177` checks the existing owner-only `~/.golems/ratchet/m1-sync-authorized.json` for Etan #32 (`schema=1`, `item=32`, `scope=m1-skills-install`, nonempty words, valid date). Do not create/edit the grant. Its `after_m1_sync` is the reserved no-op; it writes no M1 receipt and performs no M1 receipt probe. The live-row route issues its normal live evidence and GitHub table; PHX's go covers that existing route. §5's separate parity measurement still runs directly, without repeating live rows.

The frozen assignments/functions below are copied verbatim from I5 [PR #915](https://github.com/EtanHey/golems/pull/915), head `5676f7a7f6638e9024b2bf0b050f59e062851cad`, `scripts/ratchet/installed-skills.py`: constants 15–17, `tree_sha256` 20–41, `object_keys` 100–102, `release_policy` 192–212. They are byte-identical at [PR #916](https://github.com/EtanHey/golems/pull/916), head `93fd751d1c02719cc419b1b2095f5b283be5869e`, at the same lines. Python standard-library imports are the only additional dependencies. This is the I5 algorithm, never the complete-listing digest. Full runs compute shipped AND frozen hashes for every measured root, including run 2; any mismatch STOPs.

Execute this block after §1 for **both** modes. It writes only inside the run's M4 Max evidence directory.

```bash
cat > "$RUN/frozen-i5.py" <<'PYFROZEN'
import hashlib, json, re
from pathlib import Path

IGNORED = {'.pytest_cache'}

RECEIPT_IGNORED = IGNORED | {'.system'}

INSTALLER_MARKERS = {'.golems-source-commit', '.golems-install.json'}

def tree_sha256(root):
    """Receipt tree: sorted relative-name TAB file-digest lines, following links."""
    policy, lines = release_policy(), []

    def walk(item, relative='', ancestors=frozenset()):
        if (item.name in set(policy['excluded_parts']) | RECEIPT_IGNORED or
                re.search(policy['excluded_files'], relative) or item.name == '.DS_Store' or
                (len(Path(relative).parts) <= 2 and item.name in INSTALLER_MARKERS)):
            return
        if item.is_symlink() and not item.exists(): raise ValueError('broken symlink in skills root: ' + str(item))
        resolved = item.resolve(strict=True)
        if resolved in ancestors: raise ValueError('receipt tree symlink cycle')
        if item.is_dir():
            for child in sorted(item.iterdir()):
                walk(child, relative + ('/' if relative else '') + child.name, ancestors | {resolved})
        elif item.is_file():
            if any(c in relative for c in '\t\n\r'): raise ValueError('invalid receipt filename')
            lines.append(relative + '\t' + hashlib.sha256(item.read_bytes()).hexdigest() + '\n')
        else: raise ValueError('unsupported receipt tree entry')

    walk(Path(root))
    return hashlib.sha256(''.join(sorted(lines)).encode()).hexdigest()

def object_keys(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(label + ': malformed object')

def release_policy():
    # Stdin execution on the remote host has no sibling files. The local caller
    # prepends the builder's policy, so neither host relies on the remote checkout.
    policy = globals().get('RELEASE_SHIPPING_POLICY')
    if policy is None:
        policy = json.loads((Path(__file__).resolve().parents[1] /
                             'release/shipped-paths.json').read_text())
    object_keys(policy, ('schema', 'roots', 'support', 'excluded_parts', 'excluded_files'), 'release shipping policy')
    if type(policy['schema']) is not int or policy['schema'] != 1:
        raise ValueError('release shipping policy schema must be 1')
    for field in ('roots', 'support', 'excluded_parts'):
        if not isinstance(policy[field], list) or not policy[field] or any(
                not isinstance(value, str) or not value for value in policy[field]):
            raise ValueError('malformed release shipping policy ' + field)
    if not isinstance(policy['excluded_files'], str):
        raise ValueError('malformed release shipping policy excluded_files')
    try:
        re.compile(policy['excluded_files'])
    except re.error:
        raise ValueError('malformed release shipping policy excluded_files')
    return policy
PYFROZEN
python3 -I -B - "$RUN/frozen-i5.py" <<'PY'
import ast, base64, hashlib, json, os, subprocess, sys
from pathlib import Path
path = Path(sys.argv[1])
assert hashlib.sha256(path.read_bytes()).hexdigest() == '1f3a74455bab12cd1ecc478e8a20cd5e9868f17cbe659b5693597b81772725b3'
names = {'IGNORED','RECEIPT_IGNORED','INSTALLER_MARKERS','tree_sha256','object_keys','release_policy'}
def definitions(source):
    lines = source.splitlines(keepends=True)
    result = {}
    for node in ast.parse(source).body:
        name = node.name if isinstance(node, ast.FunctionDef) else node.targets[0].id if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) else None
        if name in names: result[name] = ''.join(lines[node.lineno-1:node.end_lineno])
    assert result.keys() == names, 'STOP: missing frozen dependency'
    return result
if os.environ['PROC_MODE'] == 'bootstrap-run-1':
    # Use the current PR heads, not only the historical pins: drift refuses bootstrap.
    for pr in (915,916):
        head = json.loads(subprocess.check_output(['gh','pr','view',str(pr),'-R','EtanHey/golems','--json','headRefOid']))['headRefOid']
        obj = json.loads(subprocess.check_output(['gh','api','repos/EtanHey/golems/contents/scripts/ratchet/installed-skills.py?ref=' + head]))
        assert definitions(base64.b64decode(obj['content']).decode()) == definitions(path.read_text()), 'STOP: frozen/reviewed I5 source differs'
print('FROZEN_I5_BYTES_VERIFIED')
PY
if [ "$PROC_MODE" = bootstrap-run-1 ]; then
python3 -I -B - "$RUN" "$PHX_GO_FILE" <<'PY'
import hashlib, json, os, subprocess, sys
from pathlib import Path
run, go = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text())
record = dict(go, mode='bootstrap-run-1', transport_dir='.golems/m1-sync/.transport-' + os.environ['MERGE_SHA'] + '-' + os.environ['UTC_TS'])
with (run / 'bootstrap-config.json').open('x') as f: json.dump(record, f, sort_keys=True)
# Initial trust snapshot precedes even ssh -G. No trust/config file is ever written.
p = Path.home() / '.ssh/known_hosts'
assert not p.is_symlink(), 'STOP: known_hosts is symlinked'
trust = {'exists': p.exists(), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None}
with (run / 'm4-trust-initial.json').open('x') as f: json.dump(trust, f, sort_keys=True)
bin_dir = run / 'bin'; bin_dir.mkdir(mode=0o700)
# Every local live-rows/sync/parity child inherits this PATH. SCP passes its strict
# options to its SSH transport. Every m1 remote command gets an explicit PATH env.
shim = r'''#!/usr/bin/env python3
import os, shlex, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
strict = ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no']
if name == 'ssh' and '-G' not in args:
    i = 0
    while i < len(args) and args[i].startswith('-'):
        if args[i] in ('-o','-i','-p','-l','-F','-J','-S'): i += 2
        else: raise SystemExit('STOP: unreviewed SSH invocation')
    if i >= len(args): raise SystemExit('STOP: missing SSH host')
    if args[i] == 'm1':
        if len(args[i+1:]) != 1: raise SystemExit('STOP: one remote command required')
        stage = os.environ['M1_TRANSPORT_DIR']
        if not stage.startswith('.golems/m1-sync/.transport-') or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./_-' for c in stage):
            raise SystemExit('STOP: unsafe transport directory')
        args[i+1] = '/usr/bin/env PATH="$HOME/' + stage + '/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 ' + args[i+1]
os.execv('/usr/bin/' + name, [name, *strict, *args])
'''
for name in ('ssh','scp'):
    path = bin_dir / name
    with path.open('x') as f: f.write(shim)
    path.chmod(0o700)
PY
export M1_TRANSPORT_DIR="$(python3 -I -B - "$RUN/bootstrap-config.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['transport_dir'])
PY
)"
export PATH="$RUN/bin:$PATH"
test "$(command -v ssh)" = "$RUN/bin/ssh"
test "$(command -v scp)" = "$RUN/bin/scp"
ssh -G m1 > "$RUN/m4-ssh-effective.txt"
fi
```

Both hosts' `ssh -G` output must contain each required option exactly once: `batchmode yes`, `stricthostkeychecking true` (or `yes`), and `updatehostkeys false` (or `no`). These are OpenSSH's serialized safe values, checked by the same parser on the M4 Max and M1 Pro. §2's shared parser rejects wrong, missing, malformed, or duplicate options. The M4 Max proof above is validated before its first connection. Preflight is read-only until the explicit §2 parent/config/requirements pre-step, which proves the M1 peer options with explicit strict flags before parent creation or either active-file write. The controller then creates M1 Pro ssh/scp shims **only** in the run's `.golems/m1-sync/.transport-<SHA>-<UTC>/bin` staging directory, proves `command -v` for both, and runs `ssh -G` through that shim against the host in the M1 Pro's actual parity configuration. The reviewed parent (only if absent), two parity files and staging evidence are the only mutations before that shim proof; no install/snapshot mutation proceeds without it. Every prepare/apply/controller/rollback/parity command receives the explicit M1 Pro PATH through the M4 Max shim; helpers themselves remain unmodified. Every local ssh/scp of `live-rows.sh` and `sync-m1.py` inherits the M4 Max shims. Unknown invocation shape STOPs. The remote shim prepends the same flags and execs `/usr/bin/ssh` or `/usr/bin/scp`.

The M4 Max initial known_hosts digest/absence is checked before and after every controller mode; the M1 Pro preflight digest/absence is checked before and after shim proof, snapshot, post, finish, and recovery. The existing protected-state checks compare it after sync/parity too. Any change means rollback + STOP after snapshot; before snapshot, STOP with retained evidence. Never restore known_hosts. The run-specific remote transport staging survives failures/recovery and stays inside §7 O02; it is not a helper success stage or receipt.

Bootstrap evidence lives only in the M4 Max run directory: mode, master SHA, release version, all five pre/post frozen hashes, both hosts' protected-state digests, hook owner status, actual live parity, and `receipt: "deferred to run 2 (I5)"`. Append BOOTSTRAP only after finish succeeds. The live-row parity evidence and bootstrap record are the run-1 records; status remains NO-RECEIPT. Full run 2 writes the first M1 receipt after all I5 merges. Bootstrap run 1 is excluded from stability: compare the first two **full** runs, run 2 and run 3. Any command/step change between them is a stability failure; revise the procedure before proceeding.

### Free-space floors (PHX r4p addendum)

Both hosts use `os.statvfs()` on the target filesystem and available-to-this-user blocks (`f_bavail * f_frsize`). The hard reserve is **10 GiB on each host**; equality passes, and `free - required >= 10 GiB` is mandatory. A **2x margin** covers tar/PAX framing uncertainty, compression expansion and coexistence during staging/restoration.

On the M1 Pro, `required = 2 * (snapshot_tar_estimate + extracted_release + retained_releases_growth + staging_transport)`. The snapshot estimate recursively sums lstat sizes/512-byte padding plus 2048 bytes per object and a 10240-byte trailer, over exactly the non-following archive path set; created B′ files are excluded using their receipts. Links are never followed. The verified archive supplies member sizes for an extracted staging copy and one full retained-release growth copy. Older retained releases already consume measured free space; they are never deleted or counted as future growth. Staging/transport adds the measured downloaded asset bytes, controller/frozen/I5 source lengths and 64 KiB for transport scaffolding. Components and the resulting explicit byte floor are retained in each returned disk record.

On the M4 Max, §1 reads the selected release's three asset sizes from GitHub metadata before downloading. Its explicit floor is `10 GiB + 2 * (asset bytes + 256 MiB evidence allowance)`. Only the evidence RUN exists at this point. A low-space STOP writes its small `preflight.json` evidence and downloads nothing. The controller then uses actual local asset sizes and the same allowance before preflight, snapshot and presync; `m4-disk` rechecks immediately after remote presync, before the sync command.

M1 preflight checks before capture and again immediately before the B′ pre-step, so an initial low-space STOP makes zero M1 writes and returns parseable STOP JSON for the M4's `preflight.json`. Checks also precede transport creation, snapshot lock creation, tar creation after the second capture, and the end of presync immediately before sync. Below any floor, the exact named error is `STOP: INSUFFICIENT_DISK need=<bytes> free=<bytes> reserve=<bytes>`. No deletion, reserve reduction or install retry is authorized to make the floor pass. Rollback/recovery remain available to restore/remove only their receipt-proven run footprint.

## 2. Define the snapshot, checks, and rollback

This block writes a controller only into the run's **M4 Max evidence directory**. It sends its source through strict SSH. The public helper still supplies the verified release installer.

Require all five roots as existing real directories. This runbook creates **none** of them. The installer can create Claude, Agents, Codex, and vendor-selected Cursor roots; this invocation does not create Gemini. A missing root stops preflight.

Every hashable root gets the exact shipped I5 `tree_sha256()` and a complete listing hash including hidden entries, modes, link text, and resolved content. I5 exclusions such as `.system` do not apply to the complete preservation listing. Dangling/broken root links are recorded with `link_text` and `target_state`, an unavailable I5 hash (`null`) and a named `hash_stop`. Preflight retains all five listings in its STOP JSON before the parity pre-step or snapshot; no install follows an unknown dangling/broken entry. Only an exact KNOWN_DRIFT match may pass the pre-snapshot guard with its I5 hash still null. The archive first preserves that link object without dereference; the reviewed pre-step then records/fsyncs custody, repeats every condition, unlinks that one path and fsyncs its root. Presync tolerates nothing and computes frozen I5 hashes over all five roots. Absent entries and resolving links are recorded no-ops; regular files/directories are hashed normally. Rollback restores and verifies the archived link text, mode and owner, including on retry. Non-following mutable/archive listings preserve link text and metadata without evaluating targets in the extraction staging tree, where relative links may temporarily dangle. The followed root listings in snapshot state retain target state. The snapshot lists every M1-only entry as `owned=false`; `post.json` enumerates those proven unchanged.

KNOWN_DRIFT is deliberately a one-row table; it grants no generic dangling repair:

| Root | Name | Expected link text | Action |
|---|---|---|---|
| `.gemini/config/skills` | `tmp-block` | `../../../.agents/skills/tmp-block` | `remove-dangling-link` |

PHX ruling for this pre-step: the installer-made, contentless link is inside the five reviewed skill roots; remove it only when its text matches exactly, it belongs to the M1 user, its parent is the real root and its resolved target is absent. Otherwise leave resolving/absent/non-link entries alone or STOP on unsafe dangling/broken entries. Record custody and restore the link object on rollback. No live action is authorized by this procedure revision.

```bash
cat > "$RUN/m1-control.py" <<'PY'
import ast, contextlib, fcntl, hashlib, inspect, io, json, os, pwd, re, shlex, shutil, stat, subprocess, sys, tarfile
from datetime import datetime, timezone
from pathlib import Path
ROOTS = ['.claude/skills', '.agents/skills', '.codex/skills', '.cursor/skills', '.gemini/config/skills']
FIXED = ROOTS + ['.golems/bin', '.golems/vendor', '.golems/current', '.golems/release.json',
    '.golems/release-history', '.claude/hooks', '.claude/settings.json', '.codex/hooks.json',
    '.local/state/golems/install-receipts/golems', '.golems/ratchet/installed-skills.json',
    '.golems/ratchet/requirements.json']
KNOWN_DRIFT = [dict(root='.gemini/config/skills', name='tmp-block',
                    link_text='../../../.agents/skills/tmp-block', action='remove-dangling-link')]
PARITY_CONFIG = '.golems/ratchet/installed-skills.json'
PARITY_REQUIREMENTS = '.golems/ratchet/requirements.json'
PARITY_PARENT = '.golems/ratchet'
PATTERNS = ['.claude/settings.json.bak-*', '.claude/settings.json.install-hooks-tmp',
    '.codex/hooks.json.golems-backup-*', '.codex/hooks.json.new-*',
    '.golems/.install-lock', '.golems/.install-*', '.golems/.hooks-rollback-*']
STRICT = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=10']
def need(value, message):
    if not value: raise ValueError(message)
def present(path): return path.exists() or path.is_symlink()
def sha(data): return hashlib.sha256(data).hexdigest()
def utc(): return datetime.now(timezone.utc).isoformat()
def command(args, allowed=(0,)):
    p = subprocess.run(args, capture_output=True, text=True)
    need(p.returncode in allowed, 'command failed: ' + shlex.join(args) + '\n' + p.stderr)
    return p.stdout

def require_strict_ssh_config(output):
    expected = {'stricthostkeychecking': {'true', 'yes'}, 'updatehostkeys': {'false', 'no'}, 'batchmode': {'yes'}}
    observed = {}
    for line in output.splitlines():
        fields = line.split()
        if fields and fields[0] in expected:
            need(len(fields) == 2 and fields[0] not in observed, 'STOP: malformed or duplicate strict SSH option')
            observed[fields[0]] = fields[1]
    need(observed.keys() == expected.keys() and all(observed[k] in allowed for k, allowed in expected.items()),
         'STOP: effective SSH options mismatch')

# Connection-free local capture, embedded verbatim from:
# /usr/bin/ssh -G -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no review.invalid
SSH_G_REAL_LOCAL = r'''host review.invalid
user etanheyman
hostname review.invalid
port 22
addressfamily any
batchmode yes
canonicalizefallbacklocal yes
canonicalizehostname false
checkhostip no
compression no
controlmaster false
enablesshkeysign no
clearallforwardings no
exitonforwardfailure no
fingerprinthash SHA256
forwardx11 no
forwardx11trusted no
gatewayports no
gssapiauthentication no
gssapidelegatecredentials no
hashknownhosts no
hostbasedauthentication no
identitiesonly no
kbdinteractiveauthentication yes
nohostauthenticationforlocalhost no
nohostauthenticationforproxycommand no
passwordauthentication yes
permitlocalcommand no
proxyusefdpass no
pubkeyauthentication true
requesttty auto
sessiontype default
stdinnull no
forkafterauthentication no
streamlocalbindunlink no
stricthostkeychecking true
tcpkeepalive yes
tunnel false
verifyhostkeydns false
visualhostkey no
updatehostkeys false
enableescapecommandline no
warnweakcrypto yes
applemultipath no
canonicalizemaxdots 1
connectionattempts 1
forwardx11timeout 1200
numberofpasswordprompts 3
serveralivecountmax 3
serveraliveinterval 0
requiredrsasize 1024
obscurekeystroketiming yes
loglevel INFO
securitykeyprovider $SSH_SK_PROVIDER
xauthlocation /usr/X11R6/bin/xauth
identityfile ~/.ssh/id_rsa
identityfile ~/.ssh/id_ecdsa
identityfile ~/.ssh/id_ecdsa_sk
identityfile ~/.ssh/id_ed25519
identityfile ~/.ssh/id_ed25519_sk
canonicaldomains none
globalknownhostsfile /etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts2
userknownhostsfile ~/.ssh/known_hosts ~/.ssh/known_hosts2
revokedhostkeys none
logverbose none
channeltimeout none
permitremoteopen any
addkeystoagent false
forwardagent no
connecttimeout none
tunneldevice any:any
canonicalizePermittedcnames none
controlpersist no
escapechar ~
ipqos ef cs0
rekeylimit 0 0
streamlocalbindmask 0177
syslogfacility USER
'''
def strict_ssh_self_test():
    require_strict_ssh_config(SSH_G_REAL_LOCAL)
    for strict in ('true', 'yes'):
        for update in ('false', 'no'):
            require_strict_ssh_config('batchmode yes\nstricthostkeychecking ' + strict + '\nupdatehostkeys ' + update + '\n')
    negatives = []
    # One negative fixture per unsafe value; all other bytes are the real capture.
    for key, good, unsafe in (
        ('stricthostkeychecking', 'true', ('accept-new', 'ask', 'off', 'no', 'false')),
        ('updatehostkeys', 'false', ('yes', 'ask', 'true')),
        ('batchmode', 'yes', ('no', 'false', 'ask', 'true', 'off')),
    ):
        for value in unsafe:
            negatives.append((key + '=' + value, SSH_G_REAL_LOCAL.replace(key + ' ' + good + '\n', key + ' ' + value + '\n')))
        negatives.append((key + ' missing', SSH_G_REAL_LOCAL.replace(key + ' ' + good + '\n', '')))
        negatives.append((key + ' duplicate', SSH_G_REAL_LOCAL + key + ' ' + good + '\n'))
        negatives.append((key + ' malformed', SSH_G_REAL_LOCAL.replace(key + ' ' + good + '\n', key + ' ' + good + ' extra\n')))
    for label, output in negatives:
        try: require_strict_ssh_config(output)
        except ValueError: pass
        else: raise AssertionError('unsafe SSH fixture accepted: ' + label)
strict_ssh_self_test()

def trust_file(home):
    path = home / '.ssh/known_hosts'
    need(not path.is_symlink(), 'STOP: known_hosts is symlinked')
    return {'exists': path.exists(), 'sha256': sha(path.read_bytes()) if path.exists() else None}

def frozen_hashes(ns, params):
    frozen = {'RELEASE_SHIPPING_POLICY': params['policy']}
    exec(compile(params['frozen_source'], 'frozen-i5.py', 'exec'), frozen)
    shipped = ns.get('tree_sha256')
    def measured(root):
        refusal = root_hash_stop(str(root), tree(Path(root), True), params['policy'])
        need(refusal is None, refusal)
        try: value = frozen['tree_sha256'](root)
        except Exception as error:
            raise ValueError('STOP: I5_TREE_HASH ' + type(error).__name__ + ': ' + str(error)) from error
        if not params.get('bootstrap'):
            need(shipped is not None and shipped(root) == value, 'STOP: shipped/frozen tree_sha256 differs: ' + str(root))
        return value
    ns['tree_sha256'] = measured

def link_resolution(path):
    # A link object exists independently of its target. Never lose its raw text.
    row = {'link_text': os.readlink(path)}
    try:
        resolved = path.resolve(strict=True)
        resolved.stat()
    except (FileNotFoundError, NotADirectoryError):
        row['target_state'] = 'dangling'
        return row, None
    except (OSError, RuntimeError) as error:
        row.update(target_state='broken', target_error=type(error).__name__)
        return row, None
    row['target_state'] = 'resolved'
    return row, resolved

def root_hash_stop(relative, listing, policy=None):
    for row in listing['rows']:
        # Match frozen I5 exclusions at every ancestor; complete listings still
        # retain excluded links as data, and rollback retains their exact text.
        if policy is not None:
            parts = Path(row['path']).parts
            prefixes = ['/'.join(parts[:i]) for i in range(1, len(parts) + 1)]
            if (any(part in set(policy['excluded_parts']) | {'.pytest_cache', '.system', '.DS_Store'} for part in parts) or
                    any(re.search(policy['excluded_files'], prefix) for prefix in prefixes) or
                    any(part in {'.golems-source-commit', '.golems-install.json'} for part in parts[:2])):
                continue
        if row.get('target_state') in ('dangling', 'broken'):
            name = relative + ('/' + row['path'] if row['path'] else '')
            return 'STOP: DANGLING_ROOT_LINK ' + name + ' -> ' + row['link_text']
    return None

def known_drift_status(home):
    spec = KNOWN_DRIFT[0]
    root, path = home / spec['root'], home / spec['root'] / spec['name']
    plain_parents(home, [str(path.relative_to(home))])
    need(root.is_dir() and not root.is_symlink() and path.parent == root,
         'STOP: DANGLING_ROOT_LINK unsafe known-drift parent')
    row = dict(spec, removed_by_run=False)
    try: info = path.lstat()
    except FileNotFoundError: return dict(row, status='absent')
    if not stat.S_ISLNK(info.st_mode): return dict(row, status='ordinary')
    link, resolved = link_resolution(path)
    if resolved is not None: return dict(row, status='resolved', observed_link_text=link['link_text'])
    refusal = 'STOP: DANGLING_ROOT_LINK ' + spec['root'] + '/' + spec['name'] + ' -> ' + link['link_text']
    need(info.st_uid == os.getuid() and os.readlink(os.fsencode(path)) == os.fsencode(spec['link_text']) and
         link['target_state'] == 'dangling', refusal)
    # Only actual absence qualifies; ENOTDIR, cycles and inaccessible targets STOP.
    try: path.resolve(strict=False).lstat()
    except FileNotFoundError: pass
    except (OSError, RuntimeError) as error: raise ValueError(refusal) from error
    else: raise ValueError(refusal)
    return dict(row, status='matched', mode=stat.S_IMODE(info.st_mode), uid=info.st_uid,
                gid=info.st_gid, mtime_ns=info.st_mtime_ns, dev=info.st_dev, ino=info.st_ino,
                root_identity=identity(root))

def require_hashable_capture(captured, home=None, policy=None, allow_known_drift=False):
    drift = None
    try:
        if allow_known_drift: drift = known_drift_status(home)
        stops = []
        for relative, row in captured['roots'].items():
            if not row.get('hash_stop'): continue
            refusal = row['hash_stop']
            if drift and drift['status'] == 'matched' and relative == drift['root']:
                listing = dict(row['complete'], rows=[r for r in row['complete']['rows'] if r['path'] != drift['name']])
                refusal = root_hash_stop(relative, listing, policy)
            if refusal: stops.append(refusal)
        if stops: raise ValueError(stops[0])
    except ValueError as error:
        error.details = {'before': captured, 'stops': locals().get('stops', [str(error)]), 'known_drift': drift}
        raise
    return drift

def remove_known_drift(home, saved, expected):
    observed = known_drift_status(home)
    state_equal(observed, expected, 'STOP: known drift changed after snapshot')
    record = dict(observed, removed_by_run=observed['status'] == 'matched')
    evidence(saved / 'known-drift-before.json', record)
    if record['removed_by_run']:
        root = home / record['root']
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            state_equal([info.st_dev, info.st_ino], record['root_identity'], 'STOP: known drift root changed')
            # Repeat all eligibility and identity checks after the durable intent,
            # immediately before unlink; bind the operation to the verified root.
            state_equal(known_drift_status(home), observed, 'STOP: known drift changed before unlink')
            os.unlink(record['name'], dir_fd=fd)
            os.fsync(fd)
        finally: os.close(fd)
        need(not present(root / record['name']), 'STOP: known drift unlink did not leave absence')
    record['complete'] = True
    evidence(saved / 'known-drift-complete.json', record)
    return record

def verify_known_drift_restore(home, saved):
    record = json.loads((saved / 'known-drift-before.json').read_text())
    if record['removed_by_run']:
        path = home / record['root'] / record['name']
        info = path.lstat()
        need(stat.S_ISLNK(info.st_mode) and os.readlink(os.fsencode(path)) == os.fsencode(record['link_text']) and
             stat.S_IMODE(info.st_mode) == record['mode'] and info.st_uid == record['uid'] and info.st_gid == record['gid'],
             'STOP: known drift rollback link text/mode/owner mismatch')
    return dict(record, rollback_verified=True)

def controller_error(error, mode):
    message = str(error)
    if not message.startswith('STOP: '):
        message = 'STOP: CONTROLLER_EXCEPTION ' + type(error).__name__ + ': ' + message
    return dict(verdict='STOP', mode=mode, error=message, **getattr(error, 'details', {}))

def tree(path, follow):
    rows = []
    def walk(p, rel, ancestors):
        s = p.lstat()
        row = {'path': rel, 'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid}
        if stat.S_ISLNK(s.st_mode):
            row.update(kind='symlink', target=os.readlink(p), link_text=os.readlink(p))
            if not follow:
                rows.append(row)
                return
            link, resolved = link_resolution(p)
            row.update(link)
            if resolved is None:
                rows.append(row)
                return
            row['resolved'] = str(resolved)
            target_stat = p.stat()
            row.update(target_mode=stat.S_IMODE(target_stat.st_mode), target_uid=target_stat.st_uid, target_gid=target_stat.st_gid)
        else:
            resolved = p.resolve(strict=True)
            row['kind'] = 'directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else 'special'
        if resolved in ancestors and row['kind'] == 'symlink':
            row.update(target_state='broken', target_error='SymlinkCycle')
            rows.append(row)
            return
        need(resolved not in ancestors, 'STOP: TREE_CYCLE ' + str(p))
        if p.is_dir():
            rows.append(row)
            for child in sorted(p.iterdir()):
                walk(child, (rel + '/' if rel else '') + child.name, ancestors | {resolved})
        elif p.is_file():
            row['sha256'] = sha(p.read_bytes())
            rows.append(row)
        elif not follow and stat.S_ISSOCK(s.st_mode):
            row.update(kind='socket', inode=s.st_ino)
            rows.append(row)
        else: raise ValueError('unsupported entry: ' + str(p))
    if present(path): walk(path, '', frozenset())
    return {'exists': present(path), 'rows': rows,
            'sha256': sha(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode())}

def mutable(home):
    return sorted(set(FIXED + [str(p.relative_to(home)) for pattern in PATTERNS for p in home.glob(pattern)]))
def plain_parents(home, paths):
    for relative in paths:
        p = home / relative
        for parent in [p.parent, *p.parent.parents]:
            if parent == home.parent: break
            need(parent == home or parent.is_relative_to(home), 'path escapes HOME')
            if present(parent): need(parent.is_dir() and not parent.is_symlink(), 'unsafe parent: ' + str(parent))
REAL_DIRS = ROOTS + ['.golems', '.golems/ratchet', '.golems/releases', '.golems/bin', '.golems/vendor',
    '.golems/vendor/design-skills', '.golems/m1-sync', '.golems/m1-procedure.lock', '.claude/hooks',
    '.local/state/golems', '.local/state/golems/install-receipts',
    '.local/state/golems/install-receipts/golems']
def real_directories(home, params):
    parity_parent_needed(home)
    for pattern in PATTERNS[-3:]:
        need(not list(home.glob(pattern)), 'active/stale installer state before snapshot/sync: ' + pattern)
    directories = set(REAL_DIRS)
    release = '.golems/releases/' + params['version']
    directories.add(release)
    for entry in params['manifest']['files']:
        directories.add(str(Path(release, entry['path']).parent))
    for relative in sorted(directories):
        path = home / relative
        plain_parents(home, [relative])
        if present(path):
            need(path.is_dir() and not path.is_symlink(), 'STOP: UNSAFE_FOOTPRINT_DIRECTORY ' + relative)
    vendor = home / '.golems/vendor/design-skills'
    if present(vendor):
        need(vendor.is_dir() and not vendor.is_symlink(), 'unsafe vendor directory')
        # Snapshot/staging trees contain verified regular files, never writable directory links.
        for child in vendor.rglob('*'):
            need(not child.is_symlink(), 'STOP: SYMLINK_IN_VENDOR_WRITE_TREE ' + str(child.relative_to(home)))
            if child.is_dir(): directories.add(str(child.relative_to(home)))
    for relative in sorted(directories):
        path = home / relative
        plain_parents(home, [relative])
        if present(path):
            need(path.is_dir() and not path.is_symlink(), 'STOP: UNSAFE_FOOTPRINT_DIRECTORY ' + relative)

def hooks_config(path):
    if not present(path): return {'exists': False, 'json': {}}
    need(path.is_file() and not path.is_symlink(), 'shared config is not a regular file: ' + str(path))
    data = json.loads(path.read_text())
    need(isinstance(data, dict), 'shared config must be a JSON object')
    return {'exists': True, 'json': data}
def json_diff(a, b, path=()):
    if type(a) != type(b): return [list(path)]
    if isinstance(a, dict):
        return [p for key in sorted(a.keys() | b.keys()) for p in
            (json_diff(a[key], b[key], path + (key,)) if key in a and key in b else [list(path + (key,))])]
    if isinstance(a, list):
        if len(a) != len(b): return [list(path)]
        return [p for index, (x, y) in enumerate(zip(a, b)) for p in json_diff(x, y, path + (index,))]
    return [] if a == b else [list(path)]

def json_diff_self_test():
    pre = json.loads('{"permissions":{"x":[true]}}')
    post = json.loads('{"permissions":{"x":[1]}}')
    changed = json_diff(pre, post)
    need(changed == [['permissions', 'x', 0]], 'JSON diff bool/int array self-test failed')
    need(not all(p and p[0] == 'hooks' for p in changed), 'non-hook mutation was accepted')
    hook_only = json_diff({'hooks': {'x': [True]}, 'permissions': pre['permissions']},
                          {'hooks': {'x': [1]}, 'permissions': pre['permissions']})
    need(hook_only and all(p and p[0] == 'hooks' for p in hook_only), 'hooks-only self-test failed')
    need(json_diff(pre, pre) == [], 'identical JSON self-test failed')
json_diff_self_test()

RUNTIME_ROOTS = ['.local/share/brainlayer', 'Library/Logs/brainlayer', '.brainlayer/logs', '.brainlayer/queue']
# BrainLayer-written subtrees nested in the INSTALLED ~/.brainlayer (live M1 Pro probe, 2026-10-28: drain.log/queue);
# compared like WAL/SHM (owner/mode only when present in both captures), never by content.
RUNTIME_EPHEMERAL_ROOTS = ['.brainlayer/logs', '.brainlayer/queue']
INSTALLED_PATHS = ['/Applications', '/Library/LaunchAgents', '/System/Library/LaunchAgents',
    '/opt/homebrew', '/usr/local/Homebrew', 'Library/LaunchAgents', '.local/lib/brainlayer',
    '.config/brainlayer', '.brainlayer', '.codex/config.toml', '.ssh/known_hosts']
DISCOVERED_SOCKETS = set()
DISCOVERED_INSTALLED = set()

def protected_class(path, home):
    path = Path(os.path.abspath(path))
    if any(path == home / r or path.is_relative_to(home / r) for r in RUNTIME_ROOTS): return 'RUNTIME'
    if path.parent in (Path('/tmp'), Path('/private/tmp')) and re.fullmatch(r'brainbar.*\.sock', path.name): return 'RUNTIME'
    if str(path) in DISCOVERED_SOCKETS: return 'RUNTIME'
    if any(path == home / r or path.is_relative_to(home / r) for r in INSTALLED_PATHS): return 'INSTALLED'
    if any(path == Path(r) or path.is_relative_to(Path(r)) for r in DISCOVERED_INSTALLED): return 'INSTALLED'
    return None

def runtime_identity(path, inode=False):
    try: info = path.lstat()
    except FileNotFoundError: return dict(exists=False)
    kind = ('directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode)
            else 'socket' if stat.S_ISSOCK(info.st_mode) else 'symlink' if stat.S_ISLNK(info.st_mode) else 'special')
    result = dict(exists=True, kind=kind, uid=info.st_uid, gid=info.st_gid, mode=stat.S_IMODE(info.st_mode))
    if inode: result.update(dev=info.st_dev, inode=info.st_ino)
    return result

def protected(home):
    import plistlib
    home = home.absolute()
    paths = {str(home / r) for r in INSTALLED_PATHS}
    labels, sockets = {}, {str(home / '.local/share/brainlayer/supervisor/control.sock')}
    sockets.update(str(p) for p in Path('/tmp').glob('brainbar*.sock'))
    for relative in ('.codex/config.toml', '.ssh/known_hosts'):
        need(not (home / relative).is_symlink(), 'protected file is symlinked; re-audit: ' + relative)
    for directory in ('/Library/LaunchAgents', '/System/Library/LaunchAgents', str(home / 'Library/LaunchAgents')):
        for plist in sorted(Path(directory).glob('*.plist')):
            raw = plist.read_bytes()
            # Byte prefilter (as before r4p): unrelated, possibly malformed plists are never parsed.
            if b'brainlayer' not in raw.lower() and b'brainbar' not in raw.lower(): continue
            try: data = plistlib.loads(raw)
            except Exception as error: raise ValueError('STOP: PROTECTED_PLIST_UNPARSEABLE ' + plist.name + ' ' + type(error).__name__)
            if not re.search('brainlayer|brainbar', json.dumps(data, default=str), re.I): continue
            label = data.get('Label')
            need(isinstance(label, str) and label and '/' not in label, 'STOP: PROTECTED_LABEL_INVALID')
            need(label not in labels, 'STOP: PROTECTED_LABEL_DUPLICATE ' + label)
            labels[label] = data
            def collect(value):
                if isinstance(value, dict):
                    for v in value.values(): collect(v)
                elif isinstance(value, list):
                    for v in value: collect(v)
                elif isinstance(value, str) and value.startswith('/') and value != str(home) and re.search(
                        r'brainlayer|brainbar|\.(db|sqlite|sqlite3|sock)$', value, re.I):
                    if value.endswith('.sock'): sockets.add(value)
                    elif protected_class(value, home) != 'RUNTIME': paths.add(value)
            collect(data)
    domain = 'gui/' + str(os.getuid())
    disabled = command(['/bin/launchctl', 'print-disabled', domain])
    disabled_rows = dict(re.findall(r'"([^"\n]+)"\s*=>\s*(true|false)', disabled))
    jobs = {}
    for label in sorted(labels):
        response = subprocess.run(['/bin/launchctl', 'print', domain + '/' + label], capture_output=True, text=True)
        need(response.returncode in (0, 3, 113), 'STOP: PROTECTED_LAUNCHCTL_QUERY_FAILED ' + label)
        text = response.stdout
        program = re.search(r'^\s*program\s*=\s*(.*?)\s*$', text, re.M)
        arguments = re.search(r'^\s*arguments\s*=\s*\{\n(.*?)^\s*\}', text, re.M | re.S)
        args = [s.strip() for s in arguments[1].splitlines() if s.strip()] if arguments else []
        if response.returncode == 0:
            need(program is not None, 'STOP: PROTECTED_LAUNCHCTL_PROGRAM_UNPARSEABLE ' + label)
        jobs[label] = dict(label=label, loaded=response.returncode == 0,
            running=bool(re.search(r'^\s*state\s*=\s*running\s*$', text, re.M)),
            program=program[1] if program else None, arguments=args)
    agents = home / 'Library/LaunchAgents'
    processes = command(['/bin/ps', '-axo', 'pid=,ppid=,command='])
    commands = []
    for line in processes.splitlines():
        row = line.split(None, 2)
        if len(row) == 3 and row[1] == '1' and re.search(r'brainlayer|brainbar', row[2], re.I):
            commands.append(sha(row[2].encode()))
    database = home / '.local/share/brainlayer/brainlayer.db'
    ephemeral = {str(database) + '-wal', str(database) + '-shm'} | sockets
    # An INSTALLED tree containing a RUNTIME root is captured child by child without that root.
    nested_parents = {}
    def expand(path):
        nested = [home / r for r in RUNTIME_ROOTS if (home / r).is_relative_to(path) and home / r != path]
        if not nested or path.is_symlink() or not path.is_dir(): return [str(path)]
        nested_parents[str(path)] = runtime_identity(path)
        return [e for child in sorted(path.iterdir()) if child not in nested for e in expand(child)]
    paths = {e for p in paths for e in expand(Path(p))}
    ephemeral |= {str(home / r) for r in RUNTIME_EPHEMERAL_ROOTS}
    DISCOVERED_SOCKETS.update(sockets)
    DISCOVERED_INSTALLED.update(paths)
    return dict(paths={p: tree(Path(p), False) for p in sorted(paths)},
        runtime_roots={str(home / r): runtime_identity(home / r) for r in RUNTIME_ROOTS if r not in RUNTIME_EPHEMERAL_ROOTS}, nested_installed_parents=nested_parents,
        database={str(database): runtime_identity(database, inode=True)},
        ephemeral={p: runtime_identity(Path(p)) for p in sorted(ephemeral)},
        brainlayer_processes=sorted(commands), launchctl=jobs,
        disabled={label: disabled_rows.get(label) for label in sorted(labels)},
        launchagents_ls_la=command(['/bin/ls', '-la', str(agents)]),
        launchagents_plist_sha256={str(p): sha(p.read_bytes()) for p in sorted(agents.glob('*.plist'))})

def protected_view(before, after):
    # SQLite deletes WAL/SHM at last disconnect; daemon sockets are recreated on reconnect.
    # Only endpoints present in BOTH captures have comparable historical owner/mode.
    def stable(value): return {k: v for k, v in value.items() if k != 'ephemeral'}
    left, right = stable(before), stable(after)
    a, b = before.get('ephemeral', {}), after.get('ephemeral', {})
    common = {p for p in a.keys() & b.keys() if a[p]['exists'] and b[p]['exists']}
    left['ephemeral'] = {p: {k: a[p][k] for k in ('kind', 'uid', 'gid', 'mode')} for p in sorted(common)}
    right['ephemeral'] = {p: {k: b[p][k] for k in ('kind', 'uid', 'gid', 'mode')} for p in sorted(common)}
    return left, right

def protected_equal(before, after, message):
    left, right = protected_view(before, after)
    state_equal(left, right, message, captures=(before, after))

def capture_equal(before, after, message):
    left, right = dict(before), dict(after)
    left['protected'], right['protected'] = protected_view(before['protected'], after['protected'])
    state_equal(left, right, message, captures=(before, after))

def controller_write_guard(home):
    # Audit hooks cover Python's open/os/shutil/tar mutations, including fd-relative unlink.
    # Subprocesses are the unchanged reviewed installer; this guard is controller-only.
    nofollow = set()
    # Python's chmod/chown audit event omits follow_symlinks. Preserve that
    # explicit caller choice so restoring an in-scope link never writes its target.
    for name in ('chmod', 'chown', 'utime', 'lchmod', 'lchown'):
        original = getattr(os, name, None)
        if original is None: continue
        def wrapped(path, *args, _fn=original, _name=name, **kwargs):
            token = os.fsdecode(path) if not isinstance(path, int) else path
            lexical = _name.startswith('l') or kwargs.get('follow_symlinks') is False
            if lexical: nofollow.add(token)
            try: return _fn(path, *args, **kwargs)
            finally:
                if lexical: nofollow.discard(token)
        setattr(os, name, wrapped)
    def check(path, dir_fd=None, follow=True):
        if isinstance(path, int):
            try:
                if sys.platform == 'darwin':
                    path = fcntl.fcntl(path, getattr(fcntl, 'F_GETPATH', 50), b'\0' * 1024).split(b'\0', 1)[0]
                else: path = os.readlink('/proc/self/fd/' + str(path))
            except OSError as error: raise ValueError('STOP: CONTROLLER_WRITE_FD_UNRESOLVED') from error
        path = Path(os.fsdecode(path))
        if not path.is_absolute():
            if dir_fd is None or dir_fd == -1: path = Path.cwd() / path
            elif sys.platform == 'darwin':
                path = Path(os.fsdecode(fcntl.fcntl(dir_fd, getattr(fcntl, 'F_GETPATH', 50), b'\0' * 1024).split(b'\0', 1)[0])) / path
            else: path = Path(os.readlink('/proc/self/fd/' + str(dir_fd))) / path
        resolved = path.resolve(strict=False) if follow else path.parent.resolve(strict=False) / path.name
        for candidate in (path.absolute(), resolved):
            need(protected_class(candidate, home) is None, 'STOP: CONTROLLER_WRITE_PROTECTED ' + str(candidate))
    def audit(event, args):
        if event == 'open':
            flags = args[2]
            if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND): check(args[0])
        elif event in ('os.remove', 'os.rmdir', 'os.mkdir', 'os.chmod', 'os.chown', 'os.utime', 'os.truncate'):
            index = 1 if event in ('os.remove', 'os.rmdir') else 3 if event in ('os.chown', 'os.utime') else 2
            token = os.fsdecode(args[0]) if not isinstance(args[0], int) else args[0]
            check(args[0], args[index] if len(args) > index else None,
                  follow=event not in ('os.remove', 'os.rmdir') and token not in nofollow)
        elif event in ('os.rename', 'os.link'):
            check(args[0], args[2] if len(args) > 2 else None, follow=False)
            check(args[1], args[3] if len(args) > 3 else None, follow=False)
        elif event == 'os.symlink': check(args[1], args[2] if len(args) > 2 else None, follow=False)
    sys.addaudithook(audit)

DIAGNOSTICS = {'home': None, 'directory': None}
OWNERSHIP = {'path': None, 'data': None}

def leaf_changes(a, b, path=()):
    if isinstance(a, dict) and isinstance(b, dict):
        result = []
        for key in sorted(a.keys() | b.keys()):
            if key in a and key in b: result += leaf_changes(a[key], b[key], path + (key,))
            else:
                value = a.get(key) if key in a else b[key]
                result += leaf_changes(value, None, path + (key,)) if isinstance(value, (dict, list)) and value else [path + (key,)]
        return result
    if isinstance(a, list) and isinstance(b, list):
        return [p for i in range(max(len(a), len(b))) for p in leaf_changes(
            a[i] if i < len(a) else None, b[i] if i < len(b) else None, path + (i,))]
    if isinstance(a, dict) or isinstance(b, dict):
        value = a if isinstance(a, dict) else b
        return [p for k, v in value.items() for p in leaf_changes(v, None, path + (k,))] or [path]
    if isinstance(a, list) or isinstance(b, list):
        value = a if isinstance(a, list) else b
        return [p for i, v in enumerate(value) for p in leaf_changes(v, None, path + (i,))] or [path]
    return [path] if type(a) != type(b) or a != b else []

def ownership_flush():
    path, data = OWNERSHIP['path'], OWNERSHIP['data']
    if path is None: return
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(data, stream, sort_keys=True); stream.flush(); os.fsync(stream.fileno())
    sync_directory(path.parent)

def record_created(path):
    data = OWNERSHIP['data']
    if data is None or path == OWNERSHIP['path']: return
    home = Path(data['home'])
    need(path.is_relative_to(home), 'STOP: RECOVERY_RECORD_OUTSIDE_HOME')
    need(any(path == home / root or path.is_relative_to(home / root) for root in data['roots']),
         'STOP: RECOVERY_RECORD_OUTSIDE_RUN')
    info = runtime_identity(path, inode=True)
    need(info.get('kind') in ('file', 'directory') and info.get('uid') == os.getuid(), 'STOP: RECOVERY_RECORD_UNSAFE')
    if info['kind'] == 'file': info['sha256'] = sha(path.read_bytes())
    data['entries'][str(path.relative_to(home))] = info
    ownership_flush()

def ownership_start(home, stem, custody):
    path = custody / 'recovery-ownership.json'
    need(not present(path), 'STOP: RECOVERY_OWNERSHIP_ALREADY_EXISTS')
    OWNERSHIP.update(path=path, data=dict(schema=1, stem=stem, home=str(home), uid=os.getuid(),
        roots=[str(custody.relative_to(home)), '.golems/m1-sync/' + stem, '.golems/m1-procedure.lock'],
        entries={}, removed=[]))
    for item in [custody, *sorted(custody.iterdir())]: record_created(item)
    ownership_flush()

def ownership_load(custody):
    path = custody / 'recovery-ownership.json'
    if present(path):
        need(path.is_file() and not path.is_symlink(), 'STOP: RECOVERY_OWNERSHIP_UNSAFE')
        OWNERSHIP.update(path=path, data=json.loads(path.read_text()))

def state_need(ok, before, after, message, captures=None):
    if ok: return
    def serial(value):
        if isinstance(value, Path): return str(value)
        if isinstance(value, dict): return {str(k): serial(v) for k, v in value.items()}
        if isinstance(value, (list, tuple, set)): return [serial(v) for v in value]
        return value
    before, after = serial(before), serial(after)
    home, directory = DIAGNOSTICS['home'], DIAGNOSTICS['directory']
    need(directory is not None, 'STOP: STATE_DIAGNOSTICS_CUSTODY_UNSET')
    if not present(directory):
        plain_parents(home, [str(directory.relative_to(home))])
        directory.mkdir(mode=0o700)  # Evidence only, exclusively created for this stopped run.
        sync_directory(directory.parent)
    need(directory.is_dir() and not directory.is_symlink(), 'STOP: STATE_DIAGNOSTICS_CUSTODY_UNSAFE')
    prefix = 'state-change-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '-' + str(os.getpid())
    paths = leaf_changes(before, after)
    values = serial(captures) if captures else (before, after)
    files = [directory / (prefix + '-' + name + '.json') for name in ('before', 'after')]
    for path, value in zip(files, values): evidence(path, value)
    redacted = lambda value: str(value).replace(str(home), '<M1_HOME>')
    error = ValueError(message if message.startswith('STOP: ') else 'STOP: ' + message)
    error.details = dict(state_changed=dict(count=len(paths), paths=[
        [redacted(part) for part in path] for path in paths[:50]],
        captures=[redacted(path) for path in files]))
    raise error

def state_equal(before, after, message, captures=None):
    state_need(before == after, before, after, message, captures)

def recovery(home, params, initial, saved, lock, custody):
    stem = params['head'] + '-' + params['stamp']
    dry = params.get('dry_run', False)
    receipt = dict(verdict='RECOVERY_PLAN' if dry else 'RECOVERY_COMPLETE_NOT_GREEN',
        stem=stem, dry_run=dry, mutated=False, removals=[], plan=[])
    try:
        need(not present(saved), 'STOP: RECOVERY_SNAPSHOT_CUSTODY_PRESENT_USE_ROLLBACK')
        plain_parents(home, [str(p.relative_to(home)) for p in (initial, lock, custody)])
        active = command(['/bin/ps', '-axo', 'pid=,ppid=,command='])
        need(not any(re.search(r'--remote (?:prepare|apply|receipt)\b|sync-m1\.py|/m1-sync/[^ ]*/install\.sh|repoint-skills\.mjs|install-hooks\.mjs.*--apply|skills-sync-receipt\.mjs.*emit', line)
                     for line in active.splitlines()), 'STOP: RECOVERY_WRITER_ACTIVE')
        ownership_load(custody)
        data = OWNERSHIP['data']
        legacy = data is None
        if legacy:
            need(stem == 'dc96fe7a56e5c9b670ef7cf63ac1a3ea7c309eec-20261028T040540580437', 'STOP: RECOVERY_PROVENANCE_MISSING')
            proof = params.get('recovery_evidence', {})
            need(proof.get('snapshot', {}).get('error') == 'STOP: PRE_SNAPSHOT_STATE_CHANGED', 'STOP: RECOVERY_LEGACY_STOP_EVIDENCE_MISSING')
            preflight = proof.get('preflight', {})
            need(preflight.get('verdict') == 'PREFLIGHT_READY', 'STOP: RECOVERY_LEGACY_PREFLIGHT_MISSING')
            need(custody.is_dir() and not custody.is_symlink(), 'STOP: RECOVERY_LEGACY_CUSTODY_MISSING')
            need({p.name for p in custody.iterdir()} == {'before.json', 'requirements-before.json', 'complete.json'},
                 'STOP: RECOVERY_FOREIGN_CUSTODY_ENTRY')
            need(all(p.is_file() and not p.is_symlink() and p.lstat().st_uid == os.getuid() for p in custody.iterdir()),
                 'STOP: RECOVERY_UNSAFE_CUSTODY_ENTRY')
            record = json.loads((custody / 'complete.json').read_text())
            need(record == preflight.get('parity_config'), 'STOP: RECOVERY_LEGACY_RECEIPT_MISMATCH')
            original = json.loads((custody / 'before.json').read_text())
            required = json.loads((custody / 'requirements-before.json').read_text())
            need(all(record.get(k) == v for k, v in original.items()) and
                 all(record['requirements'].get(k) == v for k, v in required.items()), 'STOP: RECOVERY_LEGACY_CUSTODY_MISMATCH')
            expected_before = {k: record[k] for k in ('created_by_run', 'before', 'template', 'parent_created_by_run')}
            expected_required = {k: record['requirements'][k] for k in ('created_by_run', 'before', 'sha256')}
            for name, value in (('before.json', expected_before), ('requirements-before.json', expected_required), ('complete.json', record)):
                need((custody / name).read_bytes() == json.dumps(value, sort_keys=True).encode(),
                     'STOP: RECOVERY_LEGACY_RECEIPT_BYTES_MISMATCH ' + name)
            need(initial.is_dir() and not initial.is_symlink() and not list(initial.iterdir()), 'STOP: RECOVERY_LEGACY_STAGE_NOT_EMPTY')
            need(lock.is_dir() and not lock.is_symlink() and not list(lock.iterdir()), 'STOP: RECOVERY_LEGACY_LOCK_NOT_EMPTY')
            start, end = proof.get('preflight_mtime_ns'), proof.get('snapshot_mtime_ns')
            need(type(start) is int and type(end) is int and start <= end, 'STOP: RECOVERY_LEGACY_TIMING_MISSING')
            need((custody / 'complete.json').stat().st_mtime_ns <= start and
                 all(start <= p.stat().st_mtime_ns <= end for p in (initial, lock)), 'STOP: RECOVERY_LEGACY_TIMING_MISMATCH')
            # Completion must be owned, no-follow evidence for this exact stem and stage type.
            def completed_stage(other, match):
                def checked(path, directory=False):
                    info = path.lstat()
                    need((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) and
                         info.st_uid == os.getuid() and not stat.S_IMODE(info.st_mode) & 0o022,
                         'unsafe completion evidence')
                    return info
                def document(path):
                    before = checked(path)
                    pin = lambda info: (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_size, info.st_mtime_ns)
                    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                    with os.fdopen(fd) as stream:
                        need(pin(os.fstat(stream.fileno())) == pin(before), 'completion evidence replaced')
                        value = json.load(stream)
                    need(pin(path.lstat()) == pin(before) and isinstance(value, dict), 'completion evidence changed')
                    return value
                try:
                    checked(other, True)
                    prefix, other_stem = match.groups()
                    # A STOP, even alongside a completion marker, is ambiguous. Never follow it.
                    for stop in other.iterdir():
                        if re.search(r'stop', stop.name, re.I):
                            document(stop)
                            return False
                    if not prefix:
                        success = document(other / 'success.json')
                        return (success.get('stem') == other_stem and
                                success.get('commit') == other_stem[:40] and
                                success.get('verdict') in ('SYNCED', 'SUCCESS', 'COMPLETE') and not success.get('error'))
                    if prefix == '.parity-config-':
                        controller = other.with_name('.procedure-' + other_stem)
                        controller_match = re.fullmatch(r'(\.procedure-)([0-9a-f]{40}-\d{8}T\d{12})', controller.name)
                        return (document(other / 'complete.json') == document(controller / 'state.json').get('parity_config') and
                                completed_stage(controller, controller_match))
                    if prefix != '.procedure-': return False
                    # A helper success marker is never controller completion evidence.
                    if os.path.lexists(other / 'success.json'): return False
                    markers = [other / name for name in ('procedure-lock-completed', 'procedure-lock-after-rollback')
                               if os.path.lexists(other / name)]
                    if len(markers) != 1: return False
                    marker = markers[0]
                    checked(marker, True)
                    owner = document(marker / 'owner.json')
                    if owner != dict(stem=other_stem, uid=os.getuid()): return False
                    if marker.name == 'procedure-lock-after-rollback':
                        results = sorted(other.glob('rollback-result-attempt-*.json'))
                        if not results: return False
                        for result in results:
                            value = document(result)
                            if (value.get('verdict') != 'ROLLBACK_RESTORED_NOT_GREEN' or
                                value.get('quarantine') != str(other / 'rollback-quarantine')): return False
                    return True
                except (OSError, ValueError, TypeError):
                    return False
            for other in (home / '.golems/m1-sync').iterdir():
                if other in (initial, custody): continue
                name = other.name
                match = re.fullmatch(r'(\.parity-config-|\.procedure-)?([0-9a-f]{40}-\d{8}T\d{12})', name)
                if match:
                    need(completed_stage(other, match), 'STOP: RECOVERY_LOCK_AMBIGUOUS ' + name)
            roots = [initial, lock, custody]
            entries = {str(p.relative_to(home)): runtime_identity(p, inode=True) for p in
                       [initial, lock, custody, *custody.iterdir()]}
            for relative, info in entries.items():
                if info['kind'] == 'file': info['sha256'] = sha((home / relative).read_bytes())
        else:
            need(data.get('schema') == 1 and data.get('stem') == stem and data.get('home') == str(home) and data.get('uid') == os.getuid(),
                 'STOP: RECOVERY_OWNERSHIP_IDENTITY_MISMATCH')
            need(data.get('roots') == [str(custody.relative_to(home)), str(initial.relative_to(home)), str(lock.relative_to(home))],
                 'STOP: RECOVERY_OWNERSHIP_ROOTS_MISMATCH')
            roots, entries = [initial, lock, custody], data['entries']
            record = json.loads((custody / 'complete.json').read_text())
            need(data.get('legacy_recovery') or not present(lock) or (lock / 'owner.json').is_file(), 'STOP: RECOVERY_LOCK_OWNER_MISSING')
            if present(lock) and not data.get('legacy_recovery'):
                need(not (lock / 'owner.json').is_symlink() and json.loads((lock / 'owner.json').read_text()) == dict(stem=stem, uid=os.getuid()),
                     'STOP: RECOVERY_LOCK_OWNER_MISMATCH')
        # Validate the entire plan before the first removal; never recurse through symlinks.
        found = {}
        def enumerate_owned(path):
            need(not path.is_symlink(), 'STOP: RECOVERY_SYMLINK ' + str(path))
            info = runtime_identity(path, inode=True)
            need(info.get('kind') in ('file', 'directory') and info.get('uid') == os.getuid(), 'STOP: RECOVERY_UNSAFE_ENTRY ' + str(path))
            relative = str(path.relative_to(home))
            if not legacy and path == custody / 'recovery-ownership.json':
                need(info['mode'] == 0o600, 'STOP: RECOVERY_OWNERSHIP_MODE')
            else:
                expected = entries.get(relative)
                need(expected is not None, 'STOP: RECOVERY_FOREIGN_ENTRY ' + relative)
                need(all(info[k] == expected[k] for k in info), 'STOP: RECOVERY_ENTRY_IDENTITY_MISMATCH ' + relative)
                if info['kind'] == 'file':
                    need(sha(path.read_bytes()) == expected.get('sha256'), 'STOP: RECOVERY_SHA_MISMATCH ' + relative)
            found[relative] = info
            if info['kind'] == 'directory':
                for child in sorted(path.iterdir()): enumerate_owned(child)
        for root in roots:
            if present(root): enumerate_owned(root)
        for relative in entries:
            need(relative in found or (not legacy and relative in data['removed']), 'STOP: RECOVERY_RECORDED_ENTRY_MISSING ' + relative)
            need(any(home / relative == root or (home / relative).is_relative_to(root) for root in roots), 'STOP: RECOVERY_ENTRY_OUTSIDE_RUN')
        files = []
        for relative, row in ((PARITY_CONFIG, record), (PARITY_REQUIREMENTS, record['requirements'])):
            if not row['created_by_run']: continue
            need(not row['before']['exists'], 'STOP: RECOVERY_CREATED_FILE_WAS_PRESENT')
            path = home / relative
            need(path.is_file() and not path.is_symlink(), 'STOP: RECOVERY_BPRIME_MISSING_OR_UNSAFE ' + relative)
            need(tree(path, False) == row['after'], 'STOP: RECOVERY_BPRIME_SHA_OR_METADATA_MISMATCH ' + relative)
            files.append(path)
        parent = home / PARITY_PARENT
        remove_parent = record['parent_created_by_run']
        parent_identity = None
        if remove_parent:
            need(not record['before']['exists'] and not record['requirements']['before']['exists'], 'STOP: RECOVERY_PARENT_CUSTODY_INVALID')
            parent_identity = runtime_identity(parent, inode=True)  # No-follow plan-time pin, including legacy.
            need(parent_identity.get('kind') == 'directory' and parent_identity.get('uid') == os.getuid() and
                 not parent_identity['mode'] & 0o022, 'STOP: RECOVERY_PARENT_UNSAFE')
            if not legacy:
                expected_parent = data.get('parent_identity') if data.get('legacy_recovery') else record.get('parent_identity')
                need(parent_identity == expected_parent, 'STOP: RECOVERY_PARENT_IDENTITY_MISMATCH')
            need(set(parent.iterdir()) == set(files), 'STOP: RECOVERY_PARENT_NOT_EMPTY_AFTER_PLAN')
        order = files + ([parent] if remove_parent else [])
        # The ownership journal is the last file removed, so partial progress stays durable.
        order += sorted((home / r for r in found if home / r != custody / 'recovery-ownership.json'),
                        key=lambda p: (-len(p.parts), p == custody, str(p)))
        order.remove(custody)
        order += [custody / 'recovery-ownership.json', custody]
        receipt['plan'] = [dict(path=str(p.relative_to(home)), operation='rmdir' if p.is_dir() else 'unlink') for p in order]
        receipt['journal_writes'] = [str((custody / 'recovery-ownership.json').relative_to(home))]
        if params.get('expected_recovery_plan') is not None:
            need(receipt['plan'] == params['expected_recovery_plan'], 'STOP: RECOVERY_DRY_RUN_PLAN_MISMATCH')
        if dry: return receipt
        # Legacy proof is recorded before mutation; future resumes have the same ownership format.
        if legacy:
            OWNERSHIP.update(path=custody / 'recovery-ownership.json', data=dict(schema=1, stem=stem, home=str(home), uid=os.getuid(),
                roots=[str(custody.relative_to(home)), str(initial.relative_to(home)), str(lock.relative_to(home))],
                entries=entries, removed=[], legacy_recovery=True, parent_identity=parent_identity))
            ownership_flush()
        for path in order:
            relative = str(path.relative_to(home))
            plain_parents(home, [relative])
            if path == parent:
                need(runtime_identity(path, inode=True) == parent_identity, 'STOP: RECOVERY_PARENT_REPLACED')
            need(not path.is_symlink(), 'STOP: RECOVERY_SYMLINK ' + relative)
            if path in files:
                row = record if relative == PARITY_CONFIG else record['requirements']
                need(tree(path, False) == row['after'], 'STOP: RECOVERY_BPRIME_SHA_OR_METADATA_MISMATCH ' + relative)
            elif relative in found:
                need(runtime_identity(path, inode=True) == found[relative], 'STOP: RECOVERY_ENTRY_IDENTITY_MISMATCH ' + relative)
                if path.is_file() and path != OWNERSHIP['path']:
                    need(sha(path.read_bytes()) == entries[relative]['sha256'], 'STOP: RECOVERY_SHA_MISMATCH ' + relative)
            if path.is_dir():
                need(not list(path.iterdir()), 'STOP: RECOVERY_DIRECTORY_NOT_EMPTY ' + relative)
                # Residual TOCTOU: a pathname replacement between this final lstat and rmdir remains possible.
                if path == parent:
                    need(runtime_identity(path, inode=True) == parent_identity, 'STOP: RECOVERY_PARENT_REPLACED')
                path.rmdir()
            else: path.unlink()
            receipt['mutated'] = ROLLBACK['mutated'] = True
            sync_directory(path.parent)
            need(not present(path), 'STOP: RECOVERY_REMOVAL_NOT_ABSENT ' + relative)
            receipt['removals'].append(dict(path=relative, absent_verified=True))
            if present(OWNERSHIP['path']):
                OWNERSHIP['data']['removed'].append(relative); ownership_flush()
        OWNERSHIP.update(path=None, data=None)
        return receipt
    except Exception as error:
        error.details = dict(getattr(error, 'details', {}), recovery_receipt=receipt)
        raise

DISK_RESERVE = 10 * 1024**3
DISK_MARGIN = 2  # Tar framing, compression expansion and restore/staging coexistence.
M4_EVIDENCE_ALLOWANCE = 256 * 1024**2

def disk_space(path, components, host):
    required = sum(components.values()) * DISK_MARGIN
    need_bytes = required + DISK_RESERVE
    filesystem = path
    while not filesystem.exists(): filesystem = filesystem.parent
    volume = os.statvfs(filesystem)
    free = volume.f_bavail * volume.f_frsize
    result = dict(host=host, filesystem=str(filesystem), components=components, margin=DISK_MARGIN,
        required=required, reserve=DISK_RESERVE, need=need_bytes, free=free)
    if free < need_bytes:
        error = ValueError('STOP: INSUFFICIENT_DISK need=' + str(need_bytes) + ' free=' + str(free) + ' reserve=' + str(DISK_RESERVE))
        error.details = dict(disk=result)
        raise error
    return result

def archive_estimate(path):
    # Exactly tar's non-following objects; directory/link lstat sizes deliberately
    # overestimate their payload and 2048 bytes/object cover tar/PAX framing.
    if not present(path): return 0
    info = path.lstat()
    size = ((info.st_size + 511) // 512) * 512 + 2048
    if stat.S_ISDIR(info.st_mode):
        size += sum(archive_estimate(child) for child in sorted(path.iterdir()))
    return size

def m1_disk_space(home, params, record=None, paths=None):
    archived = paths if paths is not None else mutable(home)
    excluded = set()
    if record:
        if record['created_by_run']: excluded.add(PARITY_CONFIG)
        if record['requirements']['created_by_run']: excluded.add(PARITY_REQUIREMENTS)
    snapshot = 10240 + sum(archive_estimate(home / p) for p in archived if p not in excluded)
    inputs = params['disk_inputs']
    components = dict(snapshot_tar=snapshot, extracted_release=inputs['extracted_release'],
        retained_releases_growth=inputs['extracted_release'],
        staging_transport=inputs['assets'] + inputs['transport'])
    return disk_space(home / '.golems', components, 'M1 Pro')

def m4_disk_space(run):
    assets = run / 'release-preflight'
    size = sum(p.lstat().st_size for p in assets.iterdir()) if assets.is_dir() else 0
    return disk_space(run, dict(run_assets=size, evidence_allowance=M4_EVIDENCE_ALLOWANCE), 'M4 Max')

# Evidence-only writes do not count as restoration mutations in attempt reports.
ROLLBACK = {'mutated': False, 'phase': 'validation', 'saved': None}
def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
def evidence(path, value):
    with path.open('x') as output:
        json.dump(value, output, sort_keys=True)
        output.flush()
        os.fsync(output.fileno())
    sync_directory(path.parent)
    record_created(path)
def parity_template(home):
    # M1 peer alias/key were inspected read-only; absolute paths use this host's HOME.
    return dict(schema=1, host='macbook-pro', identity=str(home / '.ssh/id_ed25519'),
                requirements=str(home / '.golems/ratchet/requirements.json'))

def parity_parent_needed(home):
    plain_parents(home, [PARITY_PARENT])
    parent = home / '.golems'
    need(parent.is_dir() and not parent.is_symlink() and parent.lstat().st_uid == os.getuid(),
         'STOP: existing .golems parent must be a real directory owned by this uid')
    path = home / PARITY_PARENT
    if not present(path): return True
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_uid == os.getuid()
         and not (info.st_mode & 0o022), 'STOP: parity parent must be real, this uid, not group/world writable')
    return False

def create_parity_parent(home, record_before):
    created = parity_parent_needed(home)
    record_before(created)  # Durable original absence and intent before mkdir.
    if created:
        path = home / PARITY_PARENT
        path.mkdir(mode=0o700)  # Exactly one directory; no parents/exist_ok/chmod.
        sync_directory(path.parent)
        need(not parity_parent_needed(home) and stat.S_IMODE(path.lstat().st_mode) == 0o700,
             'STOP: newly created parity parent must be mode 0700')
    return created

def restore_parity_parent(home, record):
    if not record['parent_created_by_run']: return
    need(not record['before']['exists'] and not record['requirements']['before']['exists'],
         'STOP: created-parent custody requires both files originally absent')
    need(not present(home / PARITY_CONFIG) and not present(home / PARITY_REQUIREMENTS),
         'STOP: restore both parity files to absence before removing created parent')
    if parity_parent_needed(home): return  # Already removed by an interrupted/prior rollback.
    path = home / PARITY_PARENT
    need(not list(path.iterdir()), 'STOP: created parity parent contains unexpected data')
    ROLLBACK['mutated'] = True
    path.rmdir()  # Empty only; racing additions refuse removal. Never recurse.
    sync_directory(path.parent)

def parity_parent_self_test(base):
    base.mkdir(mode=0o700)
    passed = []
    labels = ('absent', 'present-ok', 'symlink', 'group-writable', 'world-writable',
              'missing-golems', 'symlink-golems', 'rollback-created-empty',
              'rollback-created-nonempty', 'rollback-preexisting')
    for label in labels:
        home = base / label; home.mkdir(mode=0o700)
        golems = home / '.golems'; path = home / PARITY_PARENT
        if label == 'symlink-golems':
            target = home / 'target'; target.mkdir(mode=0o700); golems.symlink_to(target)
        elif label != 'missing-golems': golems.mkdir(mode=0o700)
        if label in ('present-ok', 'group-writable', 'world-writable', 'rollback-preexisting'):
            path.mkdir(mode=0o700)
            path.chmod({'group-writable': 0o770, 'world-writable': 0o707}.get(label, 0o750))
        elif label == 'symlink':
            target = home / 'target'; target.mkdir(mode=0o700); path.symlink_to(target)
        before = tree(golems, False); inode = identity(path) if present(path) else None; records = []
        try: created = create_parity_parent(home, records.append)
        except (ValueError, OSError):
            need(label in ('symlink', 'group-writable', 'world-writable', 'missing-golems', 'symlink-golems'),
                 'unexpected parent STOP: ' + label)
            need(tree(golems, False) == before and not records, 'parent refusal changed state/custody')
        else:
            need(label not in ('symlink', 'group-writable', 'world-writable', 'missing-golems', 'symlink-golems'),
                 'unsafe parent accepted: ' + label)
            need(records == [created], 'missing parent creation custody')
            if label in ('present-ok', 'rollback-preexisting'):
                need(not created and tree(golems, False) == before and identity(path) == inode,
                     'pre-existing parent changed')
            else:
                need(created and path.lstat().st_uid == os.getuid() and
                     stat.S_IMODE(path.lstat().st_mode) == 0o700, 'wrong created parent mode/owner/flag')
            if label.startswith('rollback-'):
                record = dict(parent_created_by_run=created, before={'exists': False},
                              requirements={'before': {'exists': False}})
                if label == 'rollback-created-nonempty': (path / 'unexpected').write_text('retain')
                try: restore_parity_parent(home, record)
                except ValueError:
                    need(label == 'rollback-created-nonempty' and (path / 'unexpected').read_text() == 'retain',
                         'wrong nonempty rollback refusal')
                else:
                    need(label != 'rollback-created-nonempty' and present(path) is (not created),
                         'wrong parent rollback result')
                    restore_parity_parent(home, record)  # Retry preserves the same result.
        passed.append(label)
    print('PARITY_PARENT_SELF_TEST_PASS: ' + ', '.join(passed))

def verify_parity_config(path, template):
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not path.is_symlink() and info.st_uid == os.getuid()
         and stat.S_IMODE(info.st_mode) == 0o600, 'STOP: parity config must be this uid, regular, non-symlink, mode 0600')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, 'STOP: duplicate parity config key')
            result[key] = value
        return result
    actual = json.loads(path.read_text(), object_pairs_hook=unique)
    need(isinstance(actual, dict) and set(actual) == set(template) and
         all(type(actual[k]) is type(v) and actual[k] == v for k, v in template.items()),
         'STOP: parity config differs from reviewed template; never overwrite')

def create_parity_config(home, template, record_before):
    path = home / PARITY_CONFIG
    plain_parents(home, [PARITY_CONFIG])
    need(path.parent.is_dir() and not path.parent.is_symlink(), 'STOP: parity config parent missing/unsafe; do not create it')
    before = tree(path, False)
    if present(path):
        verify_parity_config(path, template)
        record = dict(created_by_run=False, before=before, template=template)
        record_before(record)
        return record
    record = dict(created_by_run=True, before=before, template=template)
    record_before(record)  # Durable original absence and intent before the exclusive create.
    raw = (json.dumps(template, sort_keys=True, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(raw); output.flush(); os.fsync(output.fileno())
    sync_directory(path.parent)
    verify_parity_config(path, template)
    return record

def parity_config_self_test(base):
    base.mkdir(mode=0o700)
    passed = []
    for label in ('absent', 'identical', 'different', 'mode0644', 'symlink'):
        home = base / label; (home / '.golems/ratchet').mkdir(parents=True, mode=0o700)
        path = home / PARITY_CONFIG; template = parity_template(home)
        raw = (json.dumps(template, sort_keys=True, indent=2) + '\n').encode()
        if label == 'symlink':
            target = home / 'target'; target.write_bytes(raw); target.chmod(0o600)
            path.symlink_to(target)
        elif label != 'absent':
            values = dict(template, host='wrong-peer') if label == 'different' else template
            path.write_text(json.dumps(values)); path.chmod(0o644 if label == 'mode0644' else 0o600)
        before = tree(path, False); original_id = identity(path) if present(path) else None
        records = []
        try: record = create_parity_config(home, template, records.append)
        except (ValueError, OSError):
            need(label in ('different', 'mode0644', 'symlink'), 'self-test unexpectedly STOPped: ' + label)
            need(tree(path, False) == before and identity(path) == original_id and not records, 'STOP case changed file/evidence')
        else:
            need(label in ('absent', 'identical'), 'self-test must STOP: ' + label)
            need(record['created_by_run'] == (label == 'absent') and record['before'] == before, 'wrong creation custody')
            if label == 'absent': need(path.read_bytes() == raw and path.stat().st_mode & 0o777 == 0o600, 'wrong created bytes/mode')
            else: need(tree(path, False) == before and identity(path) == original_id, 'identical file rewritten')
        passed.append(label)
    print('PARITY_CONFIG_SELF_TEST_PASS: ' + ', '.join(passed))

def unique_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, 'STOP: duplicate requirements key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def derived_requirements(origin, ns, m1, m4):
    need(sha(origin['raw'].encode()) == origin['sha256'], 'STOP: M4 requirements source digest mismatch')
    source = unique_json(origin['raw'])
    ns['validate'](source, required=True)
    need(source['identities'] == [m4, m1], 'STOP: reviewed M4 requirements identity pins differ')
    derived = dict(schema=2, roots=source['roots'], identities=list(reversed(source['identities'])))
    ns['validate'](derived, required=True)
    need(set(derived) == {'schema', 'roots', 'identities'} and
         canonical(derived['roots']) == canonical(source['roots']) and
         derived['identities'] == [m1, m4], 'STOP: derived requirements drift')
    return (json.dumps(derived, sort_keys=True, indent=2) + '\n').encode()

def verify_requirements(path, expected):
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not path.is_symlink() and info.st_uid == os.getuid()
         and stat.S_IMODE(info.st_mode) == 0o600,
         'STOP: requirements must be this uid, regular, non-symlink, mode 0600')
    need(path.read_bytes() == expected, 'STOP: requirements differ from derived bytes; never overwrite')

def create_requirements(home, expected, record_before):
    path = home / PARITY_REQUIREMENTS
    plain_parents(home, [PARITY_REQUIREMENTS])
    need(path.parent.is_dir() and not path.parent.is_symlink(), 'STOP: requirements parent missing/unsafe; do not create it')
    before = tree(path, False)
    if present(path): verify_requirements(path, expected)
    record = dict(created_by_run=not present(path), before=before, sha256=sha(expected))
    record_before(record)
    if record['created_by_run']:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(expected); output.flush(); os.fsync(output.fileno())
        sync_directory(path.parent)
    verify_requirements(path, expected)
    record['after'] = tree(path, False)
    state_need(record['created_by_run'] or record['after'] == before, before, record['after'], 'STOP: existing requirements changed')
    return record

def requirements_self_test(base, ns, required, m1, m4):
    base.mkdir(mode=0o700)
    raw = json.dumps(required)
    origin = dict(raw=raw, sha256=sha(raw.encode()), path='<offline-reviewed-M4-manifest>')
    expected = derived_requirements(origin, ns, m1, m4)
    derived = json.loads(expected)
    need(derived == dict(schema=2, roots=required['roots'], identities=[m1, m4]), 'wrong B-prime derivation')
    for label in ('absent', 'identical', 'different', 'roots-drift', 'mode0644', 'symlink'):
        home = base / label; (home / '.golems/ratchet').mkdir(parents=True, mode=0o700)
        path = home / PARITY_REQUIREMENTS
        if label == 'symlink':
            target = home / 'target'; target.write_bytes(expected); target.chmod(0o600); path.symlink_to(target)
        elif label != 'absent':
            value = json.loads(expected)
            if label == 'different': value['identities'].reverse()
            if label == 'roots-drift': value['roots'][next(iter(value['roots']))]['allow_empty'].append('drift')
            path.write_bytes(expected if label in ('identical', 'mode0644') else (json.dumps(value, sort_keys=True, indent=2)+'\n').encode())
            path.chmod(0o644 if label == 'mode0644' else 0o600)
        before = tree(path, False); inode = identity(path) if present(path) else None; records = []
        try: record = create_requirements(home, expected, records.append)
        except (ValueError, OSError):
            need(label not in ('absent', 'identical'), 'unexpected requirements STOP: ' + label)
            need(tree(path, False) == before and identity(path) == inode and not records, 'refused requirements changed')
        else:
            need(label in ('absent', 'identical'), 'requirements self-test must STOP: ' + label)
            need(record['created_by_run'] == (label == 'absent'), 'wrong requirements custody')
            if label == 'identical': need(tree(path, False) == before and identity(path) == inode, 'requirements rewritten')
            verify_requirements(path, expected)
    print('DERIVED_REQUIREMENTS_SELF_TEST_PASS: exact derivation; absent; identical; different STOP; roots drift STOP; 0644 STOP; symlink STOP')

def root_link_self_test(base):
    base.mkdir(mode=0o700)
    for label, text, mode in (('relative', '../missing', 0o755),
                              ('absolute', str(base / 'missing'), 0o700),
                              ('cycle', 'cycle', 0o755)):
        path = base / label
        path.symlink_to(text)
        if hasattr(os, 'lchmod'): os.lchmod(path, mode)
        before = tree(path, False)
        listing = tree(path, True)
        row = listing['rows'][0]
        need(row['link_text'] == text and row['target_state'] == ('broken' if label == 'cycle' else 'dangling'),
             'link state self-test failed: ' + label)
        need(not owned(path, base), 'broken link must not be classified as owned')
        refusal = root_hash_stop('.gemini/config/skills', listing)
        try: require_hashable_capture({'roots': {'fixture': {'hash_stop': refusal}}})
        except ValueError as error:
            need(controller_error(error, 'preflight')['error'] == refusal, 'lost named root STOP')
        else: raise AssertionError('unhashable root accepted')
        archive_path = base / (label + '.tar')
        with tarfile.open(archive_path, 'x', dereference=False) as archive:
            archive.add(path, arcname=label)
        staging = base / (label + '-restore'); staging.mkdir(mode=0o700)
        with tarfile.open(archive_path) as archive:
            members = archive.getmembers()
            kwargs = {'filter': 'fully_trusted'} if 'filter' in inspect.signature(archive.extractall).parameters else {}
            archive.extractall(staging, members=members, **kwargs)
        restore_member_metadata(staging, members)
        need(tree(staging / label, False) == before and os.readlink(staging / label) == text,
             'link rollback bytes/mode self-test failed: ' + label)
    try: (base / 'missing-regular-file').read_bytes()
    except FileNotFoundError as error:
        result = controller_error(error, 'preflight')
        need(result['verdict'] == 'STOP' and result['error'].startswith('STOP: CONTROLLER_EXCEPTION FileNotFoundError:'),
             'raw exception escaped named controller envelope')
    print('ROOT_LINK_SELF_TEST_PASS: relative dangling; absolute dangling; cycle; exact tar restore/modes; CONTROLLER_EXCEPTION')

def reviewed_parity_schema(source):
    expected = {
        'observed_identity': '12e09aac70400499ee10803ab09db221a7786d02bc42a56c7edca6a073566208',
        'object_keys': 'f38f25167d6beed3401da1b6e3994fcd2a93b5d2880222171b2c9e896fc15219',
        'identity': 'ce2bf76691b913d601100bf59bfa1dcfdf84503c2677b62704f43f17ebbf318a',
        'validate': '6031c875454fc58db75dc8df4600bd1615ab1b5b4f19ca1490ee3a478c149cb5',
        'load_config': '90a798a78b8cb9482a11fd9decfa91b8d2b99888500138842ff60e0b11d6e06f',
    }
    found = {}
    for node in ast.parse(source).body:
        if isinstance(node, ast.FunctionDef) and node.name in expected:
            need(node.name not in found, 'STOP: duplicate parity schema function')
            raw = '\n'.join(source.splitlines()[node.lineno-1:node.end_lineno]) + '\n'
            found[node.name] = sha(raw.encode())
    state_equal(found, expected, 'STOP: parity schema/identity source changed at MERGE_SHA; review template first')

def parity_config_pre_step(home, ns, params, custody):
    reviewed_parity_schema(params['i5_source'])
    template = parity_template(home)
    expected = derived_requirements(params['m4_requirements'], ns, ns['observed_identity'](), params['expected_m4_identity'])
    # Refuse either existing mismatch before any evidence or active-file write.
    plain_parents(home, [PARITY_CONFIG, PARITY_REQUIREMENTS, '.ssh/id_ed25519'])
    parity_parent_needed(home)
    if present(home / PARITY_CONFIG): verify_parity_config(home / PARITY_CONFIG, template)
    if present(home / PARITY_REQUIREMENTS): verify_requirements(home / PARITY_REQUIREMENTS, expected)
    key = Path(template['identity'])
    need(key.is_file() and not key.is_symlink(), 'STOP: reviewed M1 parity identity prerequisite missing/unsafe')
    require_strict_ssh_config(command(['/usr/bin/ssh', *STRICT, '-G', template['host']]))
    need(not present(custody), 'STOP: parity config pre-step already attempted; retain evidence')
    custody.mkdir(mode=0o700, parents=True)
    record = dict(created_by_run=not present(home / PARITY_CONFIG),
                  before=tree(home / PARITY_CONFIG, False), template=template)
    def parent_before(created):
        record['parent_created_by_run'] = created
        evidence(custody / 'before.json', record)
    create_parity_parent(home, parent_before)
    requirements_record = create_requirements(home, expected, lambda row: evidence(custody / 'requirements-before.json', row))
    def config_before(row):
        state_need(all((record[k] == v for k, v in row.items())), {k: record[k] for k in row}, row, 'STOP: parity config changed since parent custody')
    record.update(create_parity_config(home, template, config_before))
    ns['load_config'](str(home / PARITY_CONFIG))
    record['after'] = tree(home / PARITY_CONFIG, False)
    state_need(record['created_by_run'] or record['after'] == record['before'], record['before'], record['after'], 'STOP: existing parity config changed during pre-step')
    record['requirements'] = requirements_record
    record['requirements_source'] = {k: params['m4_requirements'][k] for k in ('path', 'sha256')}
    record['parent_identity'] = runtime_identity(home / PARITY_PARENT, inode=True)
    evidence(custody / 'complete.json', record)
    stem = params['head'] + '-' + params['stamp']
    ownership_start(home, stem, custody)
    return record

def restore_member_metadata(staging, members):
    for member in members:
        restored_path = staging / member.name
        os.chown(restored_path, member.uid, member.gid, follow_symlinks=False)
        if restored_path.is_symlink():
            if hasattr(os, 'lchmod'): os.lchmod(restored_path, member.mode)
            else: need(stat.S_IMODE(restored_path.lstat().st_mode) == member.mode, 'cannot restore symlink mode')
        else: os.chmod(restored_path, member.mode)
        if restored_path.is_file() and not restored_path.is_symlink():
            with restored_path.open('rb') as restored_file: os.fsync(restored_file.fileno())

def move_restore(source, destination):
    ROLLBACK['mutated'] = True  # Conservative if the rename or following fsync is interrupted.
    source.rename(destination)
    sync_directory(source.parent)
    if source.parent != destination.parent: sync_directory(destination.parent)
def checkpoint(saved, journal):
    sequence = max([0] + [int(p.stem.split('-')[-1]) for p in saved.glob('rollback-checkpoint-*.json')]) + 1
    temporary = saved / ('rollback-checkpoint-pending-' + str(sequence) + '-attempt-' + str(ROLLBACK['attempt']))
    evidence(temporary, journal)
    temporary.rename(saved / ('rollback-checkpoint-%06d.json' % sequence))
    sync_directory(saved)
def identity(path):
    info = path.lstat()
    return [info.st_dev, info.st_ino]

def owned(entry, home):
    if not entry.is_symlink(): return False
    _, resolved = link_resolution(entry)
    if resolved is None: return False
    release, vendor = home / '.golems/releases', home / '.golems/vendor/design-skills'
    if resolved.is_relative_to(release):
        parts = resolved.relative_to(release).parts
        return len(parts) == 4 and parts[1:3] == ('skills', 'golem-powers') and parts[3] == entry.name
    if resolved.is_relative_to(vendor):
        parts = resolved.relative_to(vendor).parts
        return len(parts) == 3 and bool(re.fullmatch('[0-9a-f]{64}', parts[0])) and parts[2] == entry.name
    return False

def capture(home, ns):
    roots = {}
    for relative in ROOTS:
        root = home / relative
        need(root.is_dir() and not root.is_symlink(), 'missing or symlinked root: ' + relative)
        entries = {p.name: {'owned': owned(p, home), 'state': tree(p, True)} for p in sorted(root.iterdir())}
        complete = tree(root, True)
        refusal = root_hash_stop(relative, complete, ns['release_policy']())
        roots[relative] = {'tree_sha256': None if refusal else ns['tree_sha256'](root),
                           'hash_stop': refusal, 'complete': complete, 'entries': entries}
    config = home / '.codex/config.toml'
    return {'roots': roots, 'current': os.readlink(home / '.golems/current'),
        'config_sha256': sha(config.read_bytes()) if present(config) else None,
        'configs': {p: hooks_config(home / p) for p in ('.claude/settings.json', '.codex/hooks.json')},
        'mutable': {p: tree(home / p, False) for p in mutable(home)}, 'protected': protected(home)}

def verify_roots(before, after, home, params, restore=False, known_drift=None):
    unchanged = []
    catalog = params['catalog']['roots']
    allowed = {ROOTS[0]: set(catalog['claude']), ROOTS[1]: set(catalog['agents']),
               ROOTS[2]: set(catalog['agents']), ROOTS[3]: set(), ROOTS[4]: set()}
    vendor_roots = {'claude': ROOTS[0], 'codex': ROOTS[2], 'cursor': ROOTS[3], 'gemini': ROOTS[4]}
    vendor = {}
    for provider in params['vendor']['providers']:
        for skill in params['vendor']['skills']:
            if skill.get('providers') and provider not in skill['providers']: continue
            root = vendor_roots[provider]
            allowed[root].add(skill['name'])
            vendor[(root, skill['name'])] = skill['path']
    for root in ROOTS:
        a, b = before['roots'][root], after['roots'][root]
        if restore:
            need(a == b, 'rollback root mismatch: ' + root)
            continue
        state_equal(a['complete']['rows'][0], b['complete']['rows'][0], 'root metadata changed: ' + root)
        need(allowed[root] <= b['entries'].keys(), 'required catalog/vendor entry missing: ' + root)
        for name in sorted(a['entries'].keys() | b['entries'].keys()):
            old, new = a['entries'].get(name), b['entries'].get(name)
            path = home / root / name
            if (known_drift and known_drift['removed_by_run'] and known_drift.get('complete') and
                    root == known_drift['root'] and name == known_drift['name']):
                state_need(old and new is None, old, new, 'STOP: known drift removal changed after pre-step')
                link = old['state']['rows'][0]
                need(link['link_text'] == known_drift['link_text'] and
                     all(link[k] == known_drift[k] for k in ('mode', 'uid', 'gid')), 'STOP: known drift custody mismatch')
                continue
            if old and not old['owned']:
                state_equal(new, old, 'M1-only entry changed: ' + str(path))
                unchanged.append(str(path))
                continue
            if old == new and name not in allowed[root] and root != ROOTS[4]: continue
            if root == ROOTS[4]:
                need(old and new and path.is_symlink(), 'unexpected Gemini mutation: ' + str(path))
                need(old['state']['rows'][0]['link_text'] == new['state']['rows'][0]['link_text'], 'Gemini link repointed')
            elif new is None:
                need(root in ROOTS[:3] and old and old['owned'] and name not in allowed[root], 'unexpected removal')
                continue
            else:
                state_need(name in allowed[root], sorted(allowed[root]), name, 'unrecognized added/changed entry: ' + str(path))
            state_need(path.is_symlink() and owned(path, home), {'kind': 'managed-link'}, new, 'changed entry is not a managed link: ' + str(path))
            target = path.resolve(strict=True)
            if (root, name) in vendor:
                need(target.is_relative_to(home / '.golems/vendor/design-skills'), 'wrong vendor destination')
                prefix = vendor[(root, name)] + '/'
                expected = {k[len(prefix):]: v for k, v in params['vendor']['files'].items() if k.startswith(prefix)}
            else:
                expected_root = (home / '.golems/current/skills/golem-powers' / name).resolve(strict=True)
                state_equal(target, expected_root, 'changed link selects wrong release: ' + str(path))
                prefix = 'skills/golem-powers/' + name + '/'
                expected = {f['path'][len(prefix):]: f['sha256'] for f in params['manifest']['files'] if f['path'].startswith(prefix)}
            actual = {r['path']: r['sha256'] for r in tree(target, True)['rows'] if 'sha256' in r}
            state_need(actual == expected and 'SKILL.md' in actual, expected, actual, 'changed skill bytes mismatch: ' + str(path))
    return unchanged

def remote(params, mode):
    home = Path.home()
    controller_write_guard(home)
    stem = params['head'] + '-' + params['stamp']
    initial = home / '.golems/m1-sync' / stem
    saved = initial.with_name('.procedure-' + stem)
    lock = home / '.golems/m1-procedure.lock'
    config_custody = home / '.golems/m1-sync' / ('.parity-config-' + stem)
    DIAGNOSTICS.update(home=home, directory=saved if saved.is_dir() else initial if initial.is_dir() else config_custody)
    if not present(saved): ownership_load(config_custody)
    for key in ('CODEX_HOME', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME', 'RATCHET_SKILL_CONFIG'):
        need(not os.environ.get(key), 'unexpected remote override: ' + key)
    source = home / '.golems/current'
    ns = {'__name__': 'procedure_i5', '__file__': str(source / 'scripts/ratchet/installed-skills.py'),
          'RELEASE_SHIPPING_POLICY': params['policy']}
    exec(compile(params['i5_source'], ns['__file__'], 'exec'), ns)
    frozen_hashes(ns, params)
    need(ns['observed_identity']() == params['expected_m1_identity'], 'wrong remote machine/hostname/HOME identity')
    # The verified source runs through stdin, including after restoring an older release.
    ns['remote_inventory_script'] = lambda: 'RELEASE_SHIPPING_POLICY = ' + repr(params['policy']) + '\n' + params['i5_source']
    if mode == 'recover' or (mode == 'rollback' and not present(saved)):
        ROLLBACK['phase'] = 'pre-snapshot-recovery'
        result = recovery(home, params, initial, saved, lock, config_custody)
        ROLLBACK['phase'] = 'recovery-complete'
        return result
    if params.get('bootstrap'):
        trust = trust_file(home)
        if mode != 'preflight' and mode != 'rollback':
            state_equal(trust, params['m1_trust_before'], 'STOP: M1 Pro known_hosts changed')
        if mode == 'transport':
            config = ns['load_config'](str(home / '.golems/ratchet/installed-skills.json'))
            stage = home / params['bootstrap']['transport_dir']
            plain_parents(home, [str(stage.relative_to(home)) + '/bin/ssh'])
            need(not present(stage), 'STOP: transport stage already exists')
            m1_disk_space(home, params, json.loads((config_custody / 'complete.json').read_text()))
            stage.mkdir(mode=0o700, parents=True)
            bin_dir = stage / 'bin'; bin_dir.mkdir(mode=0o700)
            for binary in ('ssh', 'scp'):
                script = bin_dir / binary
                with script.open('x') as f:
                    f.write('#!/bin/sh\nexec /usr/bin/' + binary + ' -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no "$@"\n')
                script.chmod(0o700)
                need(shutil.which(binary) == str(script), 'STOP: M1 Pro shim resolution mismatch')
            output = command(['ssh', '-G', config['host']])
            require_strict_ssh_config(output)
            state_equal(trust_file(home), trust, 'STOP: M1 Pro known_hosts changed during transport proof')
            return {'verdict': 'STRICT_M1_TRANSPORT_VERIFIED', 'host': config['host'], 'effective': output, 'known_hosts': trust}
        if mode != 'preflight':
            bin_dir = home / params['bootstrap']['transport_dir'] / 'bin'
            for binary in ('ssh', 'scp'):
                state_equal(shutil.which(binary), str(bin_dir / binary), 'STOP: M1 Pro shim missing or PATH changed')
            config = parity_template(home) if mode == 'rollback' else ns['load_config'](str(home / PARITY_CONFIG))
            require_strict_ssh_config(command(['ssh', '-G', config['host']]))
    stem = params['head'] + '-' + params['stamp']
    initial = home / '.golems/m1-sync' / stem
    saved = initial.with_name('.procedure-' + stem)
    lock = home / '.golems/m1-procedure.lock'
    config_custody = home / '.golems/m1-sync' / ('.parity-config-' + stem)
    plain_parents(home, FIXED + ['.golems/m1-sync/' + stem, '.golems/m1-procedure.lock'])
    need(not present(home / '.golems/m1-sync') or not (home / '.golems/m1-sync').is_symlink(), 'symlinked staging parent')
    if mode in ('preflight', 'snapshot', 'presync'):
        real_directories(home, params)
        entry_record = json.loads((config_custody / 'complete.json').read_text()) if mode != 'preflight' else None
        m1_disk_space(home, params, entry_record)  # Early low-space STOP has zero remote writes.
    if mode == 'preflight':
        for binary in ('python3', 'node', 'bun', 'sh', 'tar', 'shasum'):
            need(shutil.which(binary), 'missing runtime: ' + binary)
        for relative in ('.golems', '.golems/releases', '.claude', '.agents', '.codex', '.cursor', '.gemini/config', '.local/state'):
            parent = home / relative
            need(parent.is_dir() and not parent.is_symlink(), 'required parent missing/unsafe: ' + str(parent))
        need(not present(lock), 'another procedure run needs attention')
        need(not present(initial) and not present(saved), 'run identity already exists')
        for pattern in PATTERNS[-3:]:
            need(not list(home.glob(pattern)), 'active/stale installer state: ' + pattern)
        need((home / '.golems/current').is_symlink(), 'current must be an existing symlink')
        need((home / '.golems/current').resolve(strict=True).is_relative_to(home / '.golems/releases'), 'current is outside retained releases')
        need(not (home / '.golems/release.json').is_symlink(), 'release.json must not be a symlink')
        before = capture(home, ns)
        drift = require_hashable_capture(before, home, params['policy'], allow_known_drift=True)
        disk = m1_disk_space(home, params)  # Immediately before the first remote write.
        # Before any parent/config/custody write; only the exact recorded drift may wait for snapshot.
        config_record = parity_config_pre_step(home, ns, params, config_custody)
        return {'verdict': 'PREFLIGHT_READY', 'disk': disk, 'before': before, 'parity_config': config_record, 'known_drift': drift, 'known_hosts': trust_file(home)}
    if mode == 'snapshot':
        captured = capture(home, ns)
        drift = require_hashable_capture(captured, home, params['policy'], allow_known_drift=True)
        # Before lock/stage/archive creation; every unknown dangling entry still STOPs.
        need(not present(lock) and not present(initial) and not present(saved), 'concurrent/reused run')
        disk = m1_disk_space(home, params, json.loads((config_custody / 'complete.json').read_text()))
        lock.mkdir(mode=0o700)
        record_created(lock)
        evidence(lock / 'owner.json', dict(stem=stem, uid=os.getuid()))
        initial.mkdir(mode=0o700, parents=True)
        record_created(initial)
        DIAGNOSTICS['directory'] = initial
        config_record = json.loads((config_custody / 'complete.json').read_text())
        verify_parity_config(home / PARITY_CONFIG, parity_template(home))
        verify_requirements(home / PARITY_REQUIREMENTS, derived_requirements(params['m4_requirements'], ns,
                            params['expected_m1_identity'], params['expected_m4_identity']))
        capture_equal(captured, capture(home, ns), 'STOP: PRE_SNAPSHOT_STATE_CHANGED')
        state_equal(captured['mutable'][PARITY_CONFIG], config_record['after'], 'STOP: parity config changed after pre-step')
        before = json.loads(json.dumps(captured))
        state_equal(captured['mutable'][PARITY_REQUIREMENTS], config_record['requirements']['after'], 'STOP: requirements changed after pre-step')
        before['mutable'][PARITY_CONFIG] = config_record['before']
        before['mutable'][PARITY_REQUIREMENTS] = config_record['requirements']['before']
        state = {'started': utc(), 'before': before, 'parity_config': config_record, 'known_drift': drift, 'paths': mutable(home),
            'receipt_parents': {p: present(home / p) for p in ('.local/state/golems', '.local/state/golems/install-receipts')},
            'existing_skill_backups': sorted(str(p) for p in (home / '.claude').glob('skills.bak-*'))}
        archive_path = initial / 'pre-snapshot.tgz'
        disk = m1_disk_space(home, params, config_record, state['paths'])
        with tarfile.open(archive_path, 'x:gz', dereference=False) as archive:
            for relative in state['paths']:
                if relative == PARITY_CONFIG and config_record['created_by_run']: continue
                if relative == PARITY_REQUIREMENTS and config_record['requirements']['created_by_run']: continue
                if present(home / relative): archive.add(home / relative, arcname=relative)
        with tarfile.open(archive_path) as archive:
            for member in archive.getmembers():
                need(member.uid == os.getuid() and member.gid in set(os.getgroups()) | {os.getgid()}, 'snapshot ownership cannot be restored without privilege: ' + member.name)
        state['archive_sha256'] = sha(archive_path.read_bytes())
        record_created(archive_path)
        (initial / 'current-target.txt').write_text(before['current'] + '\n')
        (initial / 'pre-snapshot.sha256').write_text(state['archive_sha256'] + '  pre-snapshot.tgz\n')
        record_created(initial / 'current-target.txt')
        record_created(initial / 'pre-snapshot.sha256')
        with archive_path.open('rb') as archive_file: os.fsync(archive_file.fileno())
        evidence(initial / 'state.json', state)
        capture_equal(captured, capture(home, ns), 'STOP: SNAPSHOT_WRITE_STATE_CHANGED')
        # Never impersonate a successful sync attempt with a fabricated success.json.
        initial.rename(saved)
        OWNERSHIP.update(path=None, data=None)  # Complete-snapshot rollback owns custody from here.
        DIAGNOSTICS['directory'] = saved
        sync_directory(saved.parent)
        record = remove_known_drift(home, saved, drift)
        after_removal = capture(home, ns)
        require_hashable_capture(after_removal)  # STRICT after the one reviewed unlink.
        return {'disk': disk, 'snapshot': str(saved / 'pre-snapshot.tgz'), 'original_path': str(archive_path),
                'sha256': state['archive_sha256'], 'before': before, 'parity_config': config_record,
                'known_drift': record, 'root_hashes': {r: v['tree_sha256'] for r, v in after_removal['roots'].items()}}
    need(saved.is_dir() and not saved.is_symlink(), 'complete snapshot custody directory missing')
    state = json.loads((saved / 'state.json').read_text())
    before = state['before']
    if mode in ('presync', 'post'):
        state_equal(tree(home / PARITY_REQUIREMENTS, False), state['parity_config']['requirements']['after'], 'STOP: requirements changed after pre-step')
    if mode == 'presync':
        strict_capture = capture(home, ns)
        require_hashable_capture(strict_capture)
        protected_equal(before['protected'], strict_capture['protected'], 'STOP: PRESYNC_PROTECTED_STATE_CHANGED')
        state_equal(tree(home / PARITY_CONFIG, False), state['parity_config']['after'], 'STOP: parity config changed before sync')
        disk = m1_disk_space(home, params, state['parity_config'], state['paths'])
        return {'verdict': 'REAL_DIRECTORIES_VERIFIED_BEFORE_SYNC', 'disk': disk,
                'known_drift': json.loads((saved / 'known-drift-complete.json').read_text()),
                'root_hashes': {r: v['tree_sha256'] for r, v in strict_capture['roots'].items()}}
    if mode == 'receipt':
        return json.loads((home / '.local/state/golems/install-receipts/golems/latest-skills-sync-release-channel.json').read_text())
    if mode == 'post':
        state_equal(tree(home / PARITY_CONFIG, False), state['parity_config']['after'], 'STOP: parity config changed during sync')
        after = capture(home, ns)
        require_hashable_capture(after)
        protected_equal(before['protected'], after['protected'], 'STOP: POST_PROTECTED_STATE_CHANGED')
        state_equal(after['config_sha256'], before['config_sha256'], 'config.toml changed')
        diffs = {}
        for path, old in before['configs'].items():
            new = after['configs'][path]
            changes = json_diff(old['json'], new['json'])
            need(all(p and p[0] == 'hooks' for p in changes), 'non-hooks JSON change: ' + path + ' ' + repr(changes))
            need(not old['exists'] or new['exists'], 'shared config removed: ' + path)
            diffs[path] = changes
        drift_record = json.loads((saved / 'known-drift-complete.json').read_text())
        unchanged = verify_roots(before, after, home, params, known_drift=drift_record)
        need(after['current'] == 'releases/' + params['version'], 'wrong current target')
        record = json.loads((home / '.golems/release.json').read_text())
        need(record['commit'] == params['head'] and record['version'] == params['version'], 'wrong release identity')
        need(json.loads((source / 'MANIFEST.json').read_text()) == params['manifest'], 'installed/preflight manifest mismatch')
        for entry in params['manifest']['files']:
            path = source / entry['path']
            need(path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == entry['sha256'], 'installed payload mismatch: ' + entry['path'])
            need(stat.S_IMODE(path.stat().st_mode) == int(entry['mode'], 8), 'installed payload mode mismatch: ' + entry['path'])
        for name in ('pr-watch', 'golems-cli'):
            wrapper = home / '.golems/bin' / name
            need(wrapper.is_file() and not wrapper.is_symlink() and os.access(wrapper, os.X_OK), 'invalid wrapper: ' + name)
        need(not list(home.glob('.golems/.install-lock')), 'install lock remains')
        need(not list(home.glob('.golems/.hooks-rollback-*')), 'unfinished hook transaction')
        if params.get('bootstrap'):
            owner = subprocess.run(['node', str(source / 'scripts/hooks/install-hooks.mjs'), '--host', 'client', '--source', str(source), '--status'], capture_output=True, text=True)
            need(owner.returncode == 0, 'STOP: hook owner status failed: ' + owner.stderr)
            need(re.search(r'^release=.* drift=0$', owner.stdout, re.M), 'STOP: missing clean release hook status')
            state_equal(trust_file(home), params['m1_trust_before'], 'STOP: M1 Pro known_hosts changed')
            return {'verdict': 'BOOTSTRAP_WITH_FIVE_ROOT_CHECKS', 'after': after, 'json_diff': diffs,
                'm1_only_unchanged': unchanged, 'receipt_path': 'none', 'receipt_id': None,
                'owner_status': {'exit': owner.returncode, 'stdout': owner.stdout, 'stderr': owner.stderr},
                'receipt': 'deferred to run 2 (I5)'}
        rpath = home / '.local/state/golems/install-receipts/golems/latest-skills-sync-release-channel.json'
        need(rpath.is_file() and not rpath.is_symlink(), 'receipt latest must be a regular file')
        r = json.loads(rpath.read_text())
        need(r['schema'] == 'install-receipt/v1' and r['product'] == 'golems' and r['artifact_kind'] == 'skills-sync', 'wrong receipt kind')
        need(r['host']['alias'] == 'm1-pro' and r['host']['user'] == pwd.getpwuid(os.getuid()).pw_name and r['host']['hostname'] == os.uname().nodename, 'wrong receipt host')
        need(r['verdict'] == 'LIVE', 'receipt is not LIVE')
        need(r['target']['merge_sha'] == r['target']['released_sha'] == r['installed']['embedded_commit'] == params['head'], 'receipt SHA mismatch')
        need(r['target']['version'] == r['installed']['version'] == params['version'] and r['target']['tag'] == 'v' + params['version'], 'receipt version mismatch')
        need(r['install_source']['mode'] == 'release-channel' and r['install_source']['path'] == r['installed']['path'] == str(source), 'receipt source mismatch')
        written = datetime.fromisoformat(r['written_at'].replace('Z', '+00:00'))
        need(datetime.fromisoformat(state['started']) <= written <= datetime.now(timezone.utc), 'stale/future receipt')
        owner, parity = r['install_source']['owner_status'], r['activation']['skill_parity']
        need(owner['exit'] == 0 and owner['drift'] is False and owner['settings_drift'] is False, 'hook owner drift')
        need(parity['measurement'] == 'live' and parity['exit'] == 0 and parity['pass'] is True, 'receipt parity not live/pass')
        need(r['activation']['method'] == 'none' and r['activation']['processes'] == [], 'unexpected activation')
        event = rpath.parent / (r['written_at'] + '-' + params['version'] + '.json')
        need(event.is_file() and not event.is_symlink() and event.read_bytes() == rpath.read_bytes(), 'immutable receipt event mismatch')
        measured = {str(home / p): after['roots'][p]['tree_sha256'] for p in ROOTS}
        measured[str(home / '.golems/bin')] = ns['tree_sha256'](home / '.golems/bin')
        receipt_roots = r['install_source']['roots']
        need(len({x['path'] for x in receipt_roots}) == len(receipt_roots), 'duplicate receipt root')
        required = {str(home / p) for p in ROOTS[:3] + [ROOTS[4], '.golems/bin']}
        need(required <= {x['path'] for x in receipt_roots}, 'missing I5 builder root')
        for row in receipt_roots:
            need(row['path'] in measured and measured[row['path']] == row['tree_sha256'], 'receipt/root digest mismatch')
        digest = sha(''.join(sorted(x['path'] + '\t' + x['tree_sha256'] + '\n' for x in receipt_roots)).encode())
        need(digest == r['installed']['content_sha256'], 'receipt combined digest mismatch')
        return {'verdict': 'LIVE_WITH_FIVE_ROOT_CHECKS', 'after': after, 'json_diff': diffs,
            'm1_only_unchanged': unchanged, 'receipt_path': str(event), 'receipt_sha256': sha(event.read_bytes()), 'receipt_id': r['receipt_id']}
    if mode == 'rollback':
        ROLLBACK['saved'] = saved
        ROLLBACK['attempt'] = params['rollback_attempt']
        # A process-scoped lock releases on exit/disconnect; the evidence file stays.
        with (saved / 'rollback-guard.lock').open('a') as guard:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            active = command(['/bin/ps', '-axo', 'pid=,ppid=,command='])
            writers = [line for line in active.splitlines() if re.search(
                r'--remote (?:prepare|apply|receipt)\b|sync-m1\.py|/m1-sync/[^ ]*/install\.sh|repoint-skills\.mjs|install-hooks\.mjs.*--apply|skills-sync-receipt\.mjs.*emit', line)]
            need(not writers, 'writer still active; no restoration mutation; PIDs=' + repr([line.split()[0] for line in writers]))
            archive_path = saved / 'pre-snapshot.tgz'
            need(sha(archive_path.read_bytes()) == state['archive_sha256'], 'snapshot checksum failed; STOP')
            old_target = (saved / 'current-target.txt').read_text().removesuffix('\n')
            need(old_target == before['current'], 'recorded current target mismatch')
            quarantine = saved / 'rollback-quarantine'
            checkpoints = sorted(saved.glob('rollback-checkpoint-[0-9]*.json'))
            if checkpoints:
                journal = json.loads(checkpoints[-1].read_text())
                need(journal['archive_sha256'] == state['archive_sha256'], 'checkpoint snapshot mismatch')
            else:
                need(not present(quarantine), 'quarantine without a checkpoint plan; STOP for lead review')
                candidates = set(mutable(home)) | set(state['paths'])
                candidates |= {str(p.relative_to(home)) for p in (home / '.claude').glob('skills.bak-*') if str(p) not in state['existing_skill_backups']}
                plain_parents(home, candidates)
                ordered = sorted(candidates)
                need(not any(a != b and Path(b).is_relative_to(Path(a)) for a in ordered for b in ordered), 'overlapping rollback paths')
                journal = {'archive_sha256': state['archive_sha256'], 'quarantine_created': False,
                    'plan': {r: identity(home / r) if present(home / r) else None for r in ordered},
                    'moved': [], 'extracted': None, 'restored': [], 'ancestors': []}
                checkpoint(saved, journal)  # Intent is durable before the first restoration mutation.
            ROLLBACK['phase'] = 'quarantine'
            if not journal['quarantine_created']:
                if not present(quarantine):
                    ROLLBACK['mutated'] = True
                    quarantine.mkdir(mode=0o700)
                    sync_directory(saved)
                need(quarantine.is_dir() and not quarantine.is_symlink(), 'unsafe quarantine')
                journal['quarantine_created'] = True
                checkpoint(saved, journal)
            need(quarantine.is_dir() and not quarantine.is_symlink(), 'quarantine missing/unsafe')
            ROLLBACK['phase'] = 'move'
            for relative, original_id in sorted(journal['plan'].items()):
                if relative in journal['moved']: continue
                path, dest = home / relative, quarantine / relative
                plain_parents(home, [relative])
                plain_parents(home, [str(dest.relative_to(home))])
                if original_id is None:
                    need(not present(path) and not present(dest), 'originally absent move path appeared: ' + relative)
                elif present(path) and not present(dest):
                    state_equal(identity(path), original_id, 'move source changed: ' + relative)
                    dest.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    move_restore(path, dest)
                else:
                    # Covers interruption after rename but before its completed checkpoint.
                    need(not present(path) and present(dest) and identity(dest) == original_id,
                         'ambiguous quarantine move; STOP: ' + relative)
                journal['moved'].append(relative)
                checkpoint(saved, journal)
            ROLLBACK['phase'] = 'extract'
            if journal['extracted'] is None:
                # An interrupted extraction is retained. A new numbered attempt uses a fresh tree.
                staging = saved / ('rollback-extract-attempt-' + str(params['rollback_attempt']))
                staging.mkdir(mode=0o700)
                ROLLBACK['mutated'] = True
                with tarfile.open(archive_path) as archive:
                    members = archive.getmembers()
                    link_names = {m.name for m in members if m.issym()}
                    for member in members:
                        need(not member.name.startswith('/') and '..' not in Path(member.name).parts, 'unsafe snapshot member')
                        need(any(member.name == r or member.name.startswith(r + '/') for r in state['paths']), 'snapshot member outside saved paths')
                        need(member.isdir() or member.isfile() or member.issym() or member.islnk(), 'unsupported snapshot member')
                        need(not any(str(parent) in link_names for parent in Path(member.name).parents), 'archive member below symlink')
                        if member.islnk():
                            need(not member.linkname.startswith('/') and '..' not in Path(member.linkname).parts and
                                 member.linkname in {m.name for m in members if m.isfile()}, 'unsafe archive hard link')
                    kwargs = {'filter': 'fully_trusted'} if 'filter' in inspect.signature(archive.extractall).parameters else {}
                    archive.extractall(staging, members=members, **kwargs)
                restore_member_metadata(staging, members)
                for relative in state['paths']:
                    need(tree(staging / relative, False) == before['mutable'][relative], 'staged extraction mismatch: ' + relative)
                need(os.readlink(staging / '.golems/current') == old_target, 'staged current target mismatch')
                for directory in sorted([p for p in staging.rglob('*') if p.is_dir() and not p.is_symlink()], key=lambda p: -len(p.parts)):
                    sync_directory(directory)
                sync_directory(staging)
                journal['extracted'] = str(staging.relative_to(saved))
                checkpoint(saved, journal)
            staging = saved / journal['extracted']
            need(staging.is_dir() and not staging.is_symlink(), 'extraction checkpoint missing/unsafe')
            ROLLBACK['phase'] = 'restore'
            for relative in state['paths']:
                if relative in journal['restored']: continue
                path, extracted = home / relative, staging / relative
                plain_parents(home, [relative])
                expected = before['mutable'][relative]
                if not expected['exists']:
                    need(not present(path) and not present(extracted), 'absent restore path appeared: ' + relative)
                elif present(extracted):
                    need(not present(path), 'restore destination appeared: ' + relative)
                    state_equal(tree(extracted, False), expected, 'extracted path changed: ' + relative)
                    need(path.parent.is_dir() and not path.parent.is_symlink(), 'restore parent missing/unsafe')
                    move_restore(extracted, path)
                else:
                    # Covers interruption after restoring a path but before its checkpoint.
                    need(tree(path, False) == expected, 'ambiguous restore move; STOP: ' + relative)
                journal['restored'].append(relative)
                checkpoint(saved, journal)
            ROLLBACK['phase'] = 'parity-parent'
            restore_parity_parent(home, state['parity_config'])
            ROLLBACK['phase'] = 'receipt-ancestors'
            for index, relative in enumerate(sorted(state['receipt_parents'], key=lambda p: -len(Path(p).parts))):
                if relative in journal['ancestors']: continue
                parent, dest = home / relative, quarantine / ('new-receipt-ancestor-' + str(index))
                if not state['receipt_parents'][relative] and present(parent):
                    need(parent.is_dir() and not parent.is_symlink() and not list(parent.iterdir()) and not present(dest), 'new receipt ancestor contains unexpected data; STOP')
                    move_restore(parent, dest)
                journal['ancestors'].append(relative)
                checkpoint(saved, journal)
            ROLLBACK['phase'] = 'verify'
            drift_restored = verify_known_drift_restore(home, saved)
            restored = capture(home, ns)
            verify_roots(before, restored, home, params, restore=True)
            need(restored['current'] == old_target, 'rollback current mismatch')
            need(restored['configs'] == before['configs'] and restored['mutable'] == before['mutable'], 'rollback footprint mismatch')
            protected_equal(before['protected'], restored['protected'], 'STOP: ROLLBACK_PROTECTED_STATE_CHANGED')
            owner = subprocess.run(['node', str(source / 'scripts/hooks/install-hooks.mjs'), '--host', 'client', '--source', str(source), '--status'], capture_output=True, text=True)
            out, err, previous_argv = io.StringIO(), io.StringIO(), sys.argv
            try:
                sys.argv = ['installed-skills.py']
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    parity_exit = ns['main']()
            finally: sys.argv = previous_argv
            result = {'verdict': 'ROLLBACK_RESTORED_NOT_GREEN', 'mutated': ROLLBACK['mutated'], 'restored': restored,
                'parity_config': state['parity_config'], 'known_drift': drift_restored,
                'owner_exit': owner.returncode, 'owner_stdout': owner.stdout, 'owner_stderr': owner.stderr,
                'parity_exit': parity_exit, 'parity_stdout': out.getvalue(), 'parity_stderr': err.getvalue(), 'quarantine': str(quarantine)}
            evidence(saved / ('rollback-result-attempt-' + str(params['rollback_attempt']) + '.json'), result)
            if present(lock):
                need(not present(saved / 'procedure-lock-after-rollback'), 'lock evidence already exists; STOP')
                move_restore(lock, saved / 'procedure-lock-after-rollback')
            ROLLBACK['phase'] = 'complete'
            result['mutated'] = ROLLBACK['mutated']
            return result
    if mode == 'finish':
        final_checks = remote(params, 'post')
        if not params.get('bootstrap'):
            state_equal(final_checks['receipt_id'], params['accepted_receipt_id'], 'receipt changed after acceptance')
        need(lock.is_dir() and not lock.is_symlink(), 'procedure lock missing')
        lock.rename(saved / 'procedure-lock-completed')
        return {'verdict': 'COMPLETE', 'snapshot': str(saved / 'pre-snapshot.tgz'), 'final_checks': final_checks}
    raise ValueError('unknown mode')

if 'PARAMS' in globals():
    try:
        result = remote(PARAMS, MODE)
        if MODE == 'rollback' and ROLLBACK['saved'] is not None:
            evidence(ROLLBACK['saved'] / ('rollback-attempt-' + str(PARAMS['rollback_attempt']) + '.json'), result)
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        result = controller_error(error, MODE)
        print(result['error'], file=sys.stderr)
        if MODE == 'rollback':
            result = {'verdict': 'ROLLBACK_PARTIAL_NOT_GREEN', 'mutated': ROLLBACK['mutated'],
                      'phase': ROLLBACK['phase'], 'error': result['error'],
                      **{k: v for k, v in result.items() if k not in ('verdict', 'mutated', 'phase', 'error')}}
            if ROLLBACK['saved'] is not None:
                try: evidence(ROLLBACK['saved'] / ('rollback-attempt-' + str(PARAMS['rollback_attempt']) + '.json'), result)
                except Exception as evidence_error:
                    result['evidence_error'] = controller_error(evidence_error, MODE)['error']
                    print(result['evidence_error'], file=sys.stderr)
        print(json.dumps(result, sort_keys=True))
        sys.exit(1)
else:
    try:
        run = Path(os.environ['RUN'])
        params = {'head': os.environ['MERGE_SHA'], 'stamp': os.environ['UTC_TS'], 'version': os.environ['VERSION']}
        requested_mode = sys.argv[1]
        if requested_mode == 'm4-disk':
            result = m4_disk_space(run)
            evidence(run / 'm4-disk-before-sync.json', result)
            print(json.dumps(result, sort_keys=True)); sys.exit(0)
        if requested_mode in ('preflight', 'snapshot', 'presync'): params['m4_disk'] = m4_disk_space(run)
        params['dry_run'] = '--dry-run' in sys.argv[2:]
        if requested_mode == 'recover':
            need(len(sys.argv) in (3, 4) and sys.argv[2] == params['head'] + '-' + params['stamp'] and
                 (len(sys.argv) == 3 or sys.argv[3] == '--dry-run'), 'STOP: RECOVERY_REQUIRES_EXACT_PAST_STEM')
        params['recovery_evidence'] = {}
        for name in ('preflight', 'snapshot'):
            old = run / (name + '.json')
            if old.is_file():
                params['recovery_evidence'][name] = json.loads(old.read_text())
                params['recovery_evidence'][name + '_mtime_ns'] = old.stat().st_mtime_ns
        DIAGNOSTICS.update(home=Path.home(), directory=run)
        params['frozen_source'] = (run / 'frozen-i5.py').read_text()
        params['bootstrap'] = json.loads((run / 'bootstrap-config.json').read_text()) if (run / 'bootstrap-config.json').exists() else None
        if params['bootstrap']:
            os.environ['M1_TRANSPORT_DIR'] = params['bootstrap']['transport_dir']
            os.environ['PATH'] = str(run / 'bin') + os.pathsep + os.environ['PATH']
            require_strict_ssh_config((run / 'm4-ssh-effective.txt').read_text())
            if sys.argv[1] not in ('rollback', 'recover'):
                state_equal(trust_file(Path.home()), json.loads((run / 'm4-trust-initial.json').read_text()), 'STOP: M4 Max known_hosts changed')
            if sys.argv[1] != 'preflight':
                params['m1_trust_before'] = json.loads((run / 'preflight.json').read_text())['known_hosts']
        release = run / 'release-preflight' / ('golems-' + params['version'] + '.tar.gz')
        with tarfile.open(release) as archive:
            def document(name): return json.loads(archive.extractfile(name).read())
            params.update(catalog=document('skills/catalog.json'), vendor=document('skills/vendor/manifest.json'),
                manifest=document('MANIFEST.json'))
            extracted_bytes = sum(((m.size + 511) // 512) * 512 + 2048 for m in archive.getmembers())
        params['disk_inputs'] = dict(extracted_release=extracted_bytes,
            assets=sum(p.lstat().st_size for p in (run / 'release-preflight').iterdir()),
            transport=len(Path(__file__).read_bytes()) + len(params['frozen_source'].encode()) + 65536)
        git_command = ['git', '-C', os.environ['GOLEMS_ROOT']]
        need(subprocess.run([*git_command, 'cat-file', '-e', params['head'] + '^{commit}'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0, 'STOP: M4 Max checkout lacks MERGE_SHA')
        # shipped-paths.json is builder policy, not a shipped member: read it from Git at MERGE_SHA (as §1 does).
        params['policy'] = json.loads(subprocess.check_output([*git_command, 'show', params['head'] + ':scripts/release/shipped-paths.json']))
        i5_path = 'scripts/ratchet/installed-skills.py'
        entries = subprocess.check_output([*git_command, 'ls-tree', '-z', '--full-tree', params['head'], '--', i5_path]).decode().split('\0')
        need(len(entries) == 2 and not entries[1], 'STOP: missing/ambiguous I5 Git source')
        info, path = entries[0].split('\t')
        mode, kind, oid = info.split(' ')
        need(path == i5_path and kind == 'blob' and mode in ('100644', '100755'), 'STOP: unsafe I5 Git source')
        i5_bytes = subprocess.check_output([*git_command, 'show', params['head'] + ':' + i5_path])
        need(i5_bytes == subprocess.check_output([*git_command, 'cat-file', 'blob', oid]), 'STOP: I5 source/ls-tree blob bytes differ')
        need(subprocess.check_output([*git_command, 'hash-object', '--stdin'], input=i5_bytes).decode().strip() == oid, 'STOP: I5 source blob ID differs')
        i5_identity = dict(merge_sha=params['head'], path=i5_path, blob_id=oid, sha256=sha(i5_bytes))
        need(i5_identity == json.loads((run / 'i5-source.json').read_text()), 'STOP: I5 source identity differs from preflight')
        params['i5_source'] = i5_bytes.decode()
        params['disk_inputs']['transport'] += len(i5_bytes)
        mode = sys.argv[1]
        if mode == 'rollback':
            numbers = [int(p.name.split('-')[2].split('.')[0]) for p in run.glob('rollback-attempt-*.*')]
            params['rollback_attempt'] = max([0] + numbers) + 1
            evidence_stem = 'rollback-attempt-' + str(params['rollback_attempt'])
            # Reserve an attempt before SSH; never overwrite earlier stderr/results.
            (run / (evidence_stem + '.stderr')).open('x').close()
            evidence(run / (evidence_stem + '.json'), {'verdict': 'TRANSPORT_PENDING_OR_INTERRUPTED', 'mutated': None,
                'note': 'Restoration mutation unknown until a complete remote result is received.'})
        else:
            evidence_stem = ('recover-dry-run' if params['dry_run'] else 'recover') if mode == 'recover' else mode
            need(not present(run / (evidence_stem + '.json')) and not present(run / (evidence_stem + '.stderr')), 'mode already attempted; retain its evidence and STOP')
        if mode == 'recover' and not params['dry_run']:
            reviewed_plan = json.loads((run / 'recover-dry-run.json').read_text())
            need(reviewed_plan.get('verdict') == 'RECOVERY_PLAN' and reviewed_plan.get('stem') == params['head'] + '-' + params['stamp'],
                 'STOP: RECOVERY_DRY_RUN_REQUIRED')
            params['expected_recovery_plan'] = reviewed_plan['plan']
        # The M4 Max is also an SSH initiator; retain and compare its trust/config bytes.
        m4_paths = [Path.home() / '.ssh/known_hosts', Path.home() / '.codex/config.toml',
                    Path.home() / '.golems/ratchet/installed-skills.json']
        need(mode in ('rollback', 'recover') or not any(p.is_symlink() for p in m4_paths), 'protected M4 Max file is symlinked; re-audit')
        m4_now = {str(p): tree(p, False) for p in m4_paths}
        m4_file = run / 'm4-protected-before.json'
        if mode == 'preflight':
            with m4_file.open('x') as output: json.dump(m4_now, output, sort_keys=True)
        elif mode not in ('rollback', 'recover'):
            state_equal(m4_now, json.loads(m4_file.read_text()), 'OUTSIDE SCOPE: STOP; M4 Max trust/config changed')
        need(mode in ('preflight', 'transport', 'snapshot', 'presync', 'receipt', 'post', 'rollback', 'recover', 'finish'), 'invalid mode')
        identity_file = run / 'expected-m1-identity.json'
        if mode == 'preflight':
            identity_ns = {'__name__': 'procedure_identity', '__file__': str(release),
                           'RELEASE_SHIPPING_POLICY': params['policy']}
            exec(compile(params['i5_source'], str(release), 'exec'), identity_ns)
            config = identity_ns['load_config'](str(Path.home() / '.golems/ratchet/installed-skills.json'))
            origin_path = Path(config['requirements'])
            need(origin_path.is_absolute() and not origin_path.is_symlink(), 'STOP: unsafe reviewed M4 requirements path')
            raw = origin_path.read_bytes()
            requirements = unique_json(raw)
            evidence(run / 'm4-requirements.json', dict(path=str(origin_path), sha256=sha(raw), raw=raw.decode()))
            identity_ns['validate'](requirements, required=True)
            need(identity_ns['observed_identity']() == requirements['identities'][0], 'wrong M4 Max identity')
            evidence(identity_file, requirements['identities'][1])
            evidence(run / 'expected-m4-identity.json', requirements['identities'][0])
        params['m4_requirements'] = json.loads((run / 'm4-requirements.json').read_text())
        origin = params['m4_requirements']
        origin_path = Path(origin['path'])
        state_need(not origin_path.is_symlink() and origin_path.is_file() and (sha(origin_path.read_bytes()) == origin['sha256']), {'sha256': origin['sha256']}, {'sha256': sha(origin_path.read_bytes()) if origin_path.is_file() else None}, 'STOP: reviewed M4 requirements changed')
        params['expected_m1_identity'] = json.loads(identity_file.read_text())
        params['expected_m4_identity'] = json.loads((run / 'expected-m4-identity.json').read_text())
        if mode == 'finish' and not params['bootstrap']: params['accepted_receipt_id'] = json.loads((run / 'post.json').read_text())['receipt_id']
        payload = 'PARAMS = ' + repr(params) + '\nMODE = ' + repr(mode) + '\n' + Path(__file__).read_text()
        result = subprocess.run(['ssh', *STRICT, 'm1', 'python3 -I -B -'], input=payload, text=True, capture_output=True)
        m4_after = {str(p): tree(p, False) for p in m4_paths}
        if params['bootstrap'] and mode == 'finish': evidence(run / 'm4-protected-after-finish.json', m4_after)
        if mode == 'rollback':
            with (run / (evidence_stem + '.stderr')).open('a') as output: output.write(result.stderr)
            # Keep the initial interrupted/pending marker as evidence; publish the final envelope atomically.
            summary = {'verdict': 'TRANSPORT_FAILED_OR_INCOMPLETE', 'mutated': None,
                'ssh_exit': result.returncode, 'stdout': result.stdout}
            try:
                summary['remote'] = json.loads(result.stdout)
                summary['mutated'] = summary['remote']['mutated']
                summary['verdict'] = summary['remote']['verdict']
            except (ValueError, KeyError, TypeError): pass
            final_path = run / (evidence_stem + '.completed.json')
            evidence(final_path, summary)
            (run / (evidence_stem + '.json')).rename(run / (evidence_stem + '.pending.json'))
            final_path.rename(run / (evidence_stem + '.json'))
            sync_directory(run)
        else:
            (run / (evidence_stem + '.stderr')).write_text(result.stderr)
            try: remote_result = json.loads(result.stdout)
            except ValueError:
                error = ValueError('STOP: CONTROLLER_TRANSPORT exit=' + str(result.returncode))
                error.details = {'stdout': result.stdout, 'stderr': result.stderr}
                remote_result = controller_error(error, mode)
            evidence(run / (evidence_stem + '.json'), remote_result)
        if params['bootstrap']:
            state_equal(trust_file(Path.home()), json.loads((run / 'm4-trust-initial.json').read_text()), 'STOP: M4 Max known_hosts changed')
        state_equal(m4_now if mode == 'recover' else json.loads(m4_file.read_text()), m4_after, 'OUTSIDE SCOPE: STOP; M4 Max trust/config changed')
        need(result.returncode == 0, (remote_result.get('error') if mode != 'rollback' else None) or
             'STOP: CONTROLLER_COMMAND_FAILED ' + mode + '; retain ' + str(run / (evidence_stem + '.stderr')))
        json.loads(result.stdout)
        print(mode + ': recorded ' + str(run / (evidence_stem + '.json')))
    except Exception as error:
        failure = controller_error(error, sys.argv[1] if len(sys.argv) > 1 else 'unknown')
        print(failure['error'], file=sys.stderr)
        # Local source/transport failures must also leave parseable preflight evidence.
        if failure['mode'] == 'preflight' and os.environ.get('RUN'):
            destination = Path(os.environ['RUN']) / 'preflight.json'
            if not present(destination):
                try: evidence(destination, failure)
                except Exception as evidence_error:
                    print(controller_error(evidence_error, failure['mode'])['error'], file=sys.stderr)
        sys.exit(1)
PY
# Offline filesystem self-tests write only under the M4 Max run evidence directory.
python3 -I -B - "$RUN/m1-control.py" "$RUN/parity-config-self-tests" <<'PYCONFIGTEST'
import ast, json, sys
from pathlib import Path
source = Path(sys.argv[1]).read_text(); module = ast.parse(source)
# Load definitions/constants only, so testing cannot enter the controller's SSH path.
module.body = [n for n in module.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.Assign))]
ns = {}; exec(compile(module, sys.argv[1], 'exec'), ns)
ns['parity_config_self_test'](Path(sys.argv[2]))
ns['parity_parent_self_test'](Path(sys.argv[2]) / 'parent-cases')
ns['root_link_self_test'](Path(sys.argv[2]) / 'root-link-cases')
# r4j: test the actual Git-sourced inventory/compare library without entering main.
i5_source = ns['subprocess'].check_output(['git', '-C', ns['os'].environ['GOLEMS_ROOT'],
    'show', ns['os'].environ['MERGE_SHA'] + ':scripts/ratchet/installed-skills.py'], text=True)
i5 = {'__name__': 'procedure_offline_direction_test', '__file__': '<offline-i5>'}
exec(compile(i5_source, '<offline-i5>', 'exec'), i5)
m4 = dict(machine='a'*64, hostname='c'*64, home='d'*64)
m1 = dict(machine='b'*64, hostname='e'*64, home='f'*64)
entry = dict(kind='dir', exists=True, normalized_target='$HOME/example', skill_sha256='0'*64,
    files={'SKILL.md': dict(kind='file', sha256='0'*64, executable=False)}, internal_skills={})
roots = {r: dict(exists=True, entries={'example': entry}) for r in i5['ROOTS']}
required = dict(schema=2, identities=[m4, m1], roots={r: dict(readable=['example'],
    allow_broken=[], allow_empty=[], target_aliases={}) for r in i5['ROOTS']})
left, right = (dict(schema=2, identity=pin, roots=roots) for pin in (m4, m1))
assert i5['compare'](left, right, required)['errors'] == []
ns['requirements_self_test'](Path(sys.argv[2]) / 'derived-requirements', i5, required, m1, m4)
derived = json.loads(ns['derived_requirements'](dict(raw=json.dumps(required),
    sha256=ns['sha'](json.dumps(required).encode())), i5, m1, m4))
assert i5['compare'](right, left, derived)['errors'] == []
reverse = i5['compare'](right, left, required)
assert reverse['host_identity_valid'] is False and len(reverse['errors']) == 2
assert all('unexpected machine/hostname/HOME identity' in e for e in reverse['errors'])
# An absent scratch .golems does not prevent library inventory; no host config is read.
fixture_home = Path(sys.argv[2]) / 'inventory-without-config'; fixture_home.mkdir(mode=0o700)
class FixturePath(type(Path())):
    @classmethod
    def home(cls): return cls(fixture_home)
def forbidden_config(*args): raise AssertionError('inventory must never load parity config')
i5.update(Path=FixturePath, observed_identity=lambda: m1, load_config=forbidden_config,
    RELEASE_SHIPPING_POLICY=dict(schema=1, roots=['skills/golem-powers/'], support=['package.json'],
    excluded_parts=['docs.local'], excluded_files=r'\.pyc$'))
inventory = i5['inventory'](); i5['validate'](inventory)
assert inventory['identity'] == m1 and not (fixture_home / '.golems').exists()
print('PARITY_DIRECTION_SELF_TEST_PASS: M4-first PASS; derived M1-first PASS; swapped-back M1-first identity STOP; inventory needs no config')
PYCONFIGTEST
python3 -I -B "$RUN/m1-control.py" preflight
if [ "$PROC_MODE" = bootstrap-run-1 ]; then
python3 -I -B "$RUN/m1-control.py" transport
fi
```

**Reviewed, idempotent §2 config + B′ requirements pre-step.** The M4 Max reads the SAME reviewed manifest through its existing parity config's `requirements` value at runtime, records that exact absolute path, SHA256 and raw bytes in `$RUN/m4-requirements.json`, and checks the source digest on every controller invocation. No manifest path under a checkout is hard-coded. Its source validator requires exactly `schema`, `roots`, `identities` and schema 2. The derived M1 bytes are deterministic sorted, indented JSON with a final newline: the same roots object (canonical JSON equal), the two identity pins in reverse order, and no other changes. Git-sourced `observed_identity()` at MERGE_SHA must match the M4 pin on the M4 Max and the M1 pin on the M1 Pro. A changed source or pin mismatch STOPs.

The r4i config template remains:

```json
{"schema":1,"host":"macbook-pro","identity":"$M1_HOME/.ssh/id_ed25519","requirements":"$M1_HOME/.golems/ratchet/requirements.json"}
```

The exact source schema/identity function bytes remain checked by `reviewed_parity_schema()`; changed bytes STOP for review. The key and peer trust remain existing read-only prerequisites. On the M1 Pro only, the pre-step creates exactly `.golems/ratchet` if absent, mode `0700`, after checking that `.golems` already exists as a real, non-symlink directory owned by the running user. An existing `ratchet` must be real, non-symlink, owned by that user, and not group/world writable; otherwise STOP. Never chmod an existing directory. Both files are checked before any write: present config must match the exact four keys/types/values (existing whitespace is preserved); present requirements must equal the exact derived bytes. Each must be a regular non-symlink file, running uid, mode `0600`. Any mismatch, roots drift, `0644` or symlink STOPs without rewriting. Absent files are exclusively created as `0600` only after strict peer option proof; identical files retain their bytes and inode. No other manifest, config, key, skill root, grant or trust entry is created. Parent creation follows the existing key and strict peer checks; no missing key or trust entry is provisioned.

Pre-step custody remains `.golems/m1-sync/.parity-config-<MERGE_SHA>-<UTC_TS>/`. `before.json` records `parent_created_by_run` and the config's original state before the exclusive parent `mkdir`; `requirements-before.json` is fsynced before requirements creation, and the config's original state is rechecked before its creation. `complete.json` retains `parent_created_by_run`, both file `created_by_run` flags, original and resulting listings, source path and SHA256. Snapshot state replaces both active pre-step files with their original bytes/absence. Pre-existing files are archived; files created by this run are excluded from tar and rollback moves them into retained quarantine, restoring original absence. Snapshot state retains the parent creation flag separately from the two file paths, avoiding overlapping archive/rollback paths. After restoring both files to absence, rollback removes `.golems/ratchet` only when `parent_created_by_run=true` and it is empty, using `rmdir`; unexpected contents STOP and remain intact. Pre-existing directories remain untouched, and retry accepts an already removed created parent. Snapshot, presync, post and finish check requirements bytes/metadata against the source derivation and custody. Interrupted creation or pre-snapshot failure retains evidence and STOPs. The reviewed r4p recovery below is the only pre-snapshot residue removal; it never authorizes an install retry.

Inline local tests exercise exact derivation, an M1-first parity pass, swapped-back identity errors through the existing compare, roots drift, absent/create, identical/no-op, differing bytes, `0644` and symlink refusal. Parent tests also cover absent → `0700` plus custody flag, existing-safe no-op, symlink/group-writable/world-writable refusal, missing/symlink `.golems` refusal, empty-created rollback and retry, nonempty-created refusal, and pre-existing-directory preservation. These tests run only in the M4 Max run evidence directory. Prior r4i read-only observations and the historical r4j source trace below do not prove current machine prerequisites or live parity.

Before preflight, snapshot, and immediately before sync, `real_directories()` requires every existing footprint directory and its ancestors through HOME to be real directories. This includes `.golems`, `.golems/ratchet` (also owner and writable-mode checks; absence permitted until the pre-step), `vendor`, `vendor/design-skills`, existing vendor descendants, target release parents, bin, client roots/hooks, staging, and receipt parents. Any symlink stops before snapshot/sync mutation.

Protected-state classification (PHX r4p): the same `protected_view()` comparator is used by both snapshot captures, presync, post/finish and rollback. These are read-only observations; never stop BrainLayer or write its runtime/config/installed paths.

| Class / surface | Comparison |
|---|---|
| RUNTIME: `.local/share/brainlayer/**`, `Library/Logs/brainlayer/**` | Each tree root only: existence, kind, uid, gid, mode. No child listing, content, size, mtime or child presence comparison. This includes rows, backups, locks, calendar and supervisor/jobs.json. |
| RUNTIME: `.local/share/brainlayer/brainlayer.db` | Existence, kind, uid, gid, mode, device and inode. Never hash the live database. |
| RUNTIME (ephemeral): `.brainlayer/logs/**`, `.brainlayer/queue/**` | BrainLayer drain writes (live M1 Pro probe 2026-10-28). Owner/mode only when present in both captures, like WAL/SHM; no content, size, mtime or children. The rest of `.brainlayer` stays INSTALLED, captured child by child. |
| RUNTIME: DB `-wal`/`-shm`, `supervisor/control.sock`, `/tmp/brainbar*.sock` and discovered BrainLayer/BrainBar sockets | When present in both captures, compare kind, owner and mode. Existence may flap: SQLite removes WAL/SHM at the last disconnect and daemon sockets are recreated across connections. A one-sided endpoint has no historical owner/mode to compare; its absence/presence alone is not drift. |
| INSTALLED/CONFIG: `/Applications` including BrainBar binaries; `/opt/homebrew`; `/usr/local/Homebrew`; `.local/lib/brainlayer`; `.config/brainlayer`; `.brainlayer` (except its two RUNTIME subtrees above); system/user LaunchAgents; `.codex/config.toml`; `.ssh/known_hosts` | Full non-following content/metadata trees. LaunchAgents additionally retain plist byte hashes and user `ls -la`. Discovered installed program/config paths retain full comparison. |
| launchctl | Only labels found in BrainLayer/BrainBar LaunchAgent plists: label, program, argument vector, loaded and running booleans. `print-disabled` is filtered to those labels. No domain-wide print, PID or service count. |
| Processes | Only launchd-managed BrainLayer/BrainBar commands (`ppid=1`), sorted command SHA256s, preserving multiplicity. No PIDs or client-spawned MCP bridges. |

`controller_write_guard()` installs a Python audit hook before any remote controller mutation. It rejects runtime/installed destinations and resolved aliases, including fd-relative operations; the offline boundary test exercises actual refused writes and all controller mutation families. The installed-file scans can still be slow; read errors and stable-field differences STOP. Do not weaken the installed/config check to obtain a pass.

Every remote changed-state assertion uses `state_equal()`/`state_need()`: exclusive, fsynced before/after captures go into this run's initial stage, complete snapshot custody or parity-config custody. STOP JSON carries the total leaf-difference count, at most 50 field paths and capture paths, with HOME replaced by `<M1_HOME>`. Capture files remain unredacted inside custody. The pre-SSH M4 trust/source guards persist their pairs locally and never initiate SSH after a local trust refusal. M4 result envelopes retain the remote STOP details even on rollback failure.

The full tar includes the five roots, wrappers, vendor tree, hooks, shared hook configs, activation/history files, receipts, hook-config sidecars, and both pre-existing M1 parity files. Each file's `created_by_run=true` instead preserves its original absence in the snapshot; rollback quarantines each new file. Links are stored without dereference. Old release bytes remain retained by `--preserve-releases`. Existing skills backups are immutable; the helper exclusively creates a new archive. The previous `current` target is also recorded as text.

**Snapshot naming conflict:** the helper treats every `<MERGE_SHA>-*` stage as a prior sync attempt requiring its own success.json. The controller first writes the required `~/.golems/m1-sync/<MERGE_SHA>-<UTC_TS>/pre-snapshot.tgz`, records SHA256, then renames that directory to `~/.golems/m1-sync/.procedure-<MERGE_SHA>-<UTC_TS>`. This in-scope custody move preserves the snapshot without inventing a success marker. Rollback uses the recorded `.procedure-...` path. Do not leave a symlink at the original name.

## 3. Run one sync with failure handling

Execute §7c's M4 Max side-effect check definition block now, before this section's commands.

Use one deploy agent. The procedure's exclusive lock does not replace the installer's lock. No other install, sync, or skill/config editor may run concurrently. Pre-existing procedure/installer locks or hook rollback directories STOP; never remove them to proceed.

```bash
export RUN_LOG="$GOLEMS_ROOT/docs.local/ratchet-runs/m1-procedure-runs.tsv"
SNAPSHOT_MAY_EXIST=0
PHASE=snapshot
append_run_log() {
  python3 -I -B - "$RUN_LOG" "$MERGE_SHA" "$1" "$2" "$3" <<'PY'
import json, os, sys
from datetime import datetime, timezone
row = [datetime.now(timezone.utc).isoformat(), *sys.argv[2:]]
line = '\t'.join(json.dumps(x, ensure_ascii=True) for x in row) + '\n'
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
try: os.write(fd, line.encode())
finally: os.close(fd)
PY
}
procedure_failure() {
  failure_code="$1"
  failure_line="$2"
  trap - ERR INT TERM
  set +e
  printf 'STOP phase=%s exit=%s line=%s\n' "$PHASE" "$failure_code" "$failure_line" >&2
  if [ -f "$RUN/m4-live-effects-before.json" ] && [ ! -f "$RUN/m4-live-effects-after.json" ] && [ ! -f "$RUN/m4-live-effects-after-error.json" ]; then
    python3 -I -B "$RUN/m4-live-effects.py" after
  fi
  if [ "$SNAPSHOT_MAY_EXIST" = 1 ]; then
    python3 -I -B "$RUN/m1-control.py" rollback > "$RUN/rollback-command.log" 2>&1
    rollback_exit="$?"
    append_run_log "$RUN/receipt.json" FAILED "phase=$PHASE; exit=$failure_code; line=$failure_line; rollback_exit=$rollback_exit; see $RUN"
  else
    append_run_log none STOP "phase=$PHASE; no sync; exit=$failure_code; line=$failure_line"
  fi
  exit "$failure_code"
}
trap 'procedure_failure "$?" "$LINENO"' ERR
trap 'procedure_failure 130 "$LINENO"' INT
trap 'procedure_failure 143 "$LINENO"' TERM
SNAPSHOT_MAY_EXIST=1
python3 -I -B "$RUN/m1-control.py" snapshot
PHASE=presync
python3 -I -B "$RUN/m1-control.py" presync
python3 -I -B "$RUN/m1-control.py" m4-disk
PHASE=sync
python3 -I -B "$RUN/m4-live-effects.py" before
if [ "$PROC_MODE" = bootstrap-run-1 ]; then
# live-rows selects the hooks-live SHA; prove it selects the same reviewed target.
test "$(git -C "$GOLEMS_ROOT/.worktrees/hooks-live" rev-parse HEAD)" = "$MERGE_SHA"
python3 -I -B - "$RUN/bootstrap-config.json" "$RUN" "$GOLEMS_ROOT" "$MERGED_PR" <<'PY'
import json, os, subprocess, sys
from pathlib import Path
config, run, root, merged = json.load(open(sys.argv[1])), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]
# Its RUN is separate: retain and identify it exactly, never by newest mtime.
parent = root / 'docs.local/ratchet-runs'
before = set(parent.glob('live-pr' + merged + '-*'))
with (run / 'sync.log').open('x') as log:
    result = subprocess.run(['bash', str(root / 'scripts/ratchet/live-rows.sh'), '--merged-pr', merged,
        '--lease-pr', str(config['lease_pr']), '--lease-repo', config['lease_repo'], '--sync-m1'], stdout=log, stderr=subprocess.STDOUT)
after = set(parent.glob('live-pr' + merged + '-*')) - before
with (run / 'live-route-custody.json').open('x') as f: json.dump({'paths': sorted(map(str, after)), 'exit': result.returncode}, f)
assert len(after) == 1, 'STOP: ambiguous live-row evidence directory'
work = next(iter(after))
assert work.is_dir() and not work.is_symlink(), 'STOP: unsafe live-row evidence directory'
# A link in local evidence exposes the helper download to the unchanged cmp checks.
(run / 'm1-sync').symlink_to(work / 'm1-sync', target_is_directory=True)
assert result.returncode == 0, 'STOP: public live-rows sync/ratchet failed'
PY
else
python3 -B "$GOLEMS_ROOT/scripts/ratchet/sync-m1.py" "$MERGE_SHA" "$VERSION" "$RUN/m1-sync" > "$RUN/sync.log" 2>&1
fi
PHASE=m4-live-effects
python3 -I -B "$RUN/m4-live-effects.py" after
PHASE=download-custody
for asset in "golems-$VERSION.tar.gz" SHA256SUMS MANIFEST.json; do
  cmp "$RUN/release-preflight/$asset" "$RUN/m1-sync/$asset"
done
if [ "$PROC_MODE" = full ]; then
PHASE=receipt-log
python3 -I -B - "$RUN/sync.log" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
assert re.findall(r'^m1-receipt: (.+)$', text, re.M) == ['LIVE'], 'missing, duplicate, unavailable, or non-LIVE final receipt verdict'
PY
fi
```

For bootstrap run 1, PHX's approved `live-rows.sh --sync-m1` route above is mandatory. For full runs, the following public positional route applies unchanged. The additional live-row evidence directory remains inside the existing M4 Max `docs.local/ratchet-runs/` footprint.

The public positional command is the only installer entry point. It verifies release assets before its own SSH, checks remote status, makes the built-in backup, SCPs assets, and runs the installer extracted from those verified bytes as `sh install.sh --from-file ARCHIVE --sums SHA256SUMS --preserve-releases`. It invokes repoint-skills.mjs with `--vendor-skills`, first dry-run, then `--apply`. Do not call internal `--remote` modes separately or invent flags.

The additional `.claude/skills.bak-<MERGE_SHA>-<helper UTC>.tgz` uses a helper-generated timestamp, not UTC_TS. Retain its exact path from sync.log and its actual helper stage. Never select a backup by newest mtime. The full snapshot is rollback authority.

Claude and Agents use the release catalog. A real Codex root preserves independent entries and links catalog entries through Agents. Cursor receives manifest-selected vendor skills. Gemini keeps its existing link objects; golems-owned links through Claude or Agents expose release updates indirectly. This is not a five-way catalog mirror. All five roots are measured independently; all M1-only entries must remain identical. Changed intended root behavior requires a reviewed procedure revision before execution.

An already-current invocation still requires the full snapshot and a fresh receipt. The public helper emits a receipt on its verified no-op path. Do not claim a new built-in skills backup or helper install stage on a no-op.

## 4. Require a fresh receipt and five-root checks

I5 currently measures Claude, Agents, Codex, optional Gemini, and bin; it omits Cursor. Do not require a nonexistent Cursor receipt field or call the receipt five-root proof. The separate `post.json` supplies Cursor and the full five-root checks with the shipped I5 hash algorithm. Require both.

```bash
if [ "$PROC_MODE" = full ]; then
PHASE=receipt
python3 -I -B "$RUN/m1-control.py" receipt
node "$GOLEMS_ROOT/scripts/install-receipt.mjs" validate "$RUN/receipt.json" > "$RUN/receipt-validated.json"
fi
PHASE=post
python3 -I -B "$RUN/m1-control.py" post
```

The controller checks schema/kind/host, exact merge/released/embedded SHA, version/tag, current path, LIVE verdict, clean hook owner status, live/pass parity, no activation, immutable-event/latest byte equality, fresh write time, reported root hashes, and combined content hash. Changed installs and no-ops both require a receipt written during this run. Exit 0 never waives receipt checks.

`json_diff()` first runs its inline self-test, then computes the exact recursive pre/post JSON diff through objects and arrays with an explicit type check at every node. The `[true]` → `[1]` non-hook fixture must fail the hook-only gate; a hooks-only change must pass. The gate `all(p and p[0] == 'hooks' for p in changes)` applies to both `~/.claude/settings.json` and `~/.codex/hooks.json`. Config removal also fails. Changed key paths are recorded under `post.json → json_diff`. Any other key change triggers rollback and STOP. `~/.codex/config.toml` is separately compared by byte digest and never written by this procedure.

## 5. Re-run real parity and retain evidence

Run the real two-host ratchet directly from the M4 Max. Do not use fixtures or `live-rows.sh`, whose other rows issue tokens and post to GitHub.

```bash
PHASE=parity
RATCHET_SKILL_CONFIG="$HOME/.golems/ratchet/installed-skills.json" python3 -B "$GOLEMS_ROOT/scripts/ratchet/installed-skills.py" > "$RUN/parity.json" 2> "$RUN/parity.stderr"
if [ "$PROC_MODE" = full ]; then
python3 -I -B - "$RUN/parity.json" "$RUN/post.json" "$RUN/snapshot.json" "$RUN/receipt.json" <<'PY'
import json, sys
parity, post, snapshot, receipt = [json.load(open(p)) for p in sys.argv[1:]]
assert receipt['receipt_id'] == post['receipt_id'], 'receipt changed between capture and post-check'
assert parity['measurement'] == 'live'
assert parity['host_identity_valid'] is True
assert parity['name_content_parity'] is True
assert parity['required_readable_valid'] is True
assert parity['error_count'] == 0
assert post['verdict'] == 'LIVE_WITH_FIVE_ROOT_CHECKS'
assert len(snapshot['before']['roots']) == len(post['after']['roots']) == 5
for root in sorted(post['after']['roots']):
    original = snapshot['before']['roots'][root]
    print(root, 'original=' + (original['tree_sha256'] or 'unavailable(' + str(original.get('hash_stop')) + ')'),
          'pre_sync=' + snapshot['root_hashes'][root],
          'post=' + post['after']['roots'][root]['tree_sha256'])
print('LIVE receipt; five roots verified; real two-host parity PASS')
PY
else
python3 -I -B - "$RUN" <<'PY'
import json, sys
from pathlib import Path
run = Path(sys.argv[1]); parity = json.loads((run / 'parity.json').read_text()); post = json.loads((run / 'post.json').read_text())
assert parity['measurement'] == 'live'
assert all(parity[k] is True for k in ('host_identity_valid','name_content_parity','required_readable_valid'))
assert parity['error_count'] == 0 and post['verdict'] == 'BOOTSTRAP_WITH_FIVE_ROOT_CHECKS'
assert len(post['after']['roots']) == len(json.loads((run / 'snapshot.json').read_text())['before']['roots']) == 5
assert post['owner_status']['exit'] == 0
print('BOOTSTRAP: NO-RECEIPT; five roots verified; real two-host parity PASS')
PY
fi
PHASE=finish
python3 -I -B "$RUN/m1-control.py" finish
RECEIPT_PATH="$(python3 -I -B - "$RUN/post.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))['receipt_path'])
PY
)"
if [ "$PROC_MODE" = bootstrap-run-1 ]; then
python3 -I -B - "$RUN" <<'PY'
import hashlib, json, os, sys
from pathlib import Path
run = Path(sys.argv[1]); snapshot = json.loads((run / 'snapshot.json').read_text()); finish = json.loads((run / 'finish.json').read_text())
post = finish['final_checks']; parity = json.loads((run / 'parity.json').read_text())
def digest(value): return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',',':')).encode()).hexdigest()
before_m4 = json.loads((run / 'm4-protected-before.json').read_text())
# Finish independently revalidated both hosts' protected state; retain its compared digests.
record = {'mode':'bootstrap-run-1', 'master_sha':os.environ['MERGE_SHA'], 'release_version':os.environ['VERSION'],
    'pre_roots': {k:v['tree_sha256'] for k,v in snapshot['before']['roots'].items()},
    'post_roots': {k:v['tree_sha256'] for k,v in post['after']['roots'].items()},
    'protected_state_digests': {'m1_pre':digest(snapshot['before']['protected']), 'm1_post':digest(post['after']['protected']),
        'm4_pre':digest(before_m4), 'm4_post':digest(json.loads((run / 'm4-protected-after-finish.json').read_text()))},
    'hook_owner_status':post['owner_status'], 'parity_result':parity, 'receipt':'deferred to run 2 (I5)'}
with (run / 'bootstrap-evidence.json').open('x') as f: json.dump(record, f, sort_keys=True)
PY
append_run_log "$RUN/bootstrap-evidence.json" BOOTSTRAP none
else
append_run_log "$RECEIPT_PATH" LIVE_WITH_FIVE_ROOT_CHECKS none
fi
trap - ERR INT TERM
printf 'RUN_COMPLETE merge=%s receipt=%s evidence=%s\n' "$MERGE_SHA" "$RECEIPT_PATH" "$RUN"
```

Keep stderr and disclosed-invalid counts, including allowlisted entries. Report receipt event path/UUID/hash, target SHA/version, actual built-in backup/helper stage, full snapshot path/hash, five pre/post hashes, unchanged M1-only list, JSON diff, parity result, and run-log row. The finish command repeats the M1 Pro receipt, five-root, and protected-state checks after parity and rejects a changed receipt identity. No native app, BrainLayer, or mirrored-catalog acceptance is implied. The full preflight release and helper-downloaded assets must be byte-identical; the installed payload and modes are checked against that same preflight manifest.

## 6. Stop and restore on failure

Triggers: **any nonzero step after snapshot starts; any failed post-check; any §7b change; missing/stale/invalid/unavailable/non-LIVE receipt; failed real parity; or any deviation from the written commands.** Before snapshot, stop without installing. If snapshot capture fails, no sync runs. With no complete snapshot custody, the same rollback command enters receipt-based RECOVERY instead of attempting tar restoration; unexpected provenance or residue STOPs in place.

The ERR/INT/TERM handlers invoke the exact controller `rollback` command once. Each invocation reserves `rollback-attempt-<N>.json/.stderr` on the M4 Max and retains a numbered remote result. `mutated=false` means no restoration mutation, including a writer-active refusal; evidence writes are excluded. `mutated=true` conservatively means restoration may have mutated paths. A transport failure without a complete remote result records `mutated=null` (unknown), never false. It verifies snapshot SHA256, refuses an active remote writer, and acquires a process-scoped rollback guard. It persists a move plan before creating quarantine, checkpoints each completed quarantine move, extracts into a fresh numbered staging tree, checkpoints completed extraction, then checkpoints each move from staging to its original path, including the recorded `current` link. Interrupted extractions remain retained; the next attempt uses a fresh staging tree. Rename/checkpoint gaps are reconciled using the planned inode identity or exact restored tree; ambiguous state stops. Original absence is restored: newly introduced root children and sidecars remain quarantined instead of surviving a tar overlay. New receipt events, backups, vendor copies, and failed hook/temp objects are preserved in quarantine. Old/new releases and helper stages remain retained. Complete-snapshot rollback retains the quarantined material. Only the reviewed pre-snapshot RECOVERY below removes receipt-proven run-created residue. The parity config and derived requirements are in the same checkpointed plan: each file created by §2 is removed from its active path into quarantine (`created_by_run=true`); each existing file regains its exact pre-step bytes/mode/uid from the snapshot. Original absence is verified, including on rollback retry.

Rollback rechecks all five complete listings and I5 hashes, shared configs, wrappers/hooks/activation/history/receipt state, and protected state against **pre-state**. It reruns hook status and real parity. Parity uses the verified I5 source sent through stdin, so restoring an older release cannot reintroduce its non-strict SSH argv. Target-release receipt assertions cannot pass after restoring the old release; the failed candidate remains failed. The returned verdict is always `ROLLBACK_RESTORED_NOT_GREEN`; retain hook/parity output and exits, including pre-existing failures.

If a connection/process dies before the handler runs, reopen Bash on the M4 Max and run only the recovery block below. First establish that the prior sync/installer has exited. Never rename a live install's lock/temp tree. No automated kill or restart is authorized. If process exit cannot be established, STOP and return to the lead.

```bash
set -Eeuo pipefail
umask 077
export MERGE_SHA='<MERGE_SHA>'
export UTC_TS='<UTC_TS>'
export GOLEMS_ROOT="$HOME/Gits/golems"
export RUN="$GOLEMS_ROOT/docs.local/ratchet-runs/m1-procedure-$MERGE_SHA-$UTC_TS"
VERSION="$(python3 -I -B - "$RUN/release-preflight/MANIFEST.json" <<'PY'
import json, os, re, sys
r = json.load(open(sys.argv[1]))
assert re.fullmatch(r'[0-9a-f]{40}', os.environ['MERGE_SHA'])
assert re.fullmatch(r'\d{8}T\d{12}', os.environ['UTC_TS'])
assert r['commit'] == os.environ['MERGE_SHA']
print(r['version'])
PY
)"
export VERSION
set +e
python3 -I -B "$RUN/m1-control.py" rollback
recovery_exit="$?"
set -e
python3 -I -B - "$GOLEMS_ROOT/docs.local/ratchet-runs/m1-procedure-runs.tsv" "$RUN" "$MERGE_SHA" "$recovery_exit" <<'PYLOG'
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path
log, run, head, code = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
rows = [[json.loads(field) for field in line.split('\t')] for line in log.read_text().splitlines()] if log.exists() else []
# Preserve an existing failure row. Recovery never upgrades it to LIVE.
if not any(row[1] == head and run in row[4] for row in rows):
    receipt = str(Path(run) / 'receipt.json') if (Path(run) / 'receipt.json').exists() else 'none'
    row = [datetime.now(timezone.utc).isoformat(), head, receipt, 'FAILED', 'crash recovery exit=' + code + '; evidence=' + run]
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try: os.write(fd, ('\t'.join(json.dumps(x) for x in row) + '\n').encode())
    finally: os.close(fd)
PYLOG
exit "$recovery_exit"
```

**Exact retry:** after confirming the prior sync/installer and rollback process have exited, run `python3 -I -B "$RUN/m1-control.py" rollback` again in the recovery shell with the same exports. If that shell has exited, copy the entire recovery block above again with the same `<MERGE_SHA>` and `<UTC_TS>`. Numbering is automatic; never remove or overwrite attempt evidence, quarantine, extraction trees, pending checkpoints, or locks. A no-mutation writer refusal permits retry once the writer exits. A transport interruption permits resumption from the last completed remote checkpoint; retained quarantine is expected. A re-run of an already restored run rechecks it and stays NOT_GREEN. After retry, retain all numbered attempt JSON/stderr, remote checkpoints and extraction trees and report the result to the lead.

Snapshot mismatch, ambiguous checkpoint reconciliation, failed move/extraction, changed external M1-only target bytes, or protected-state differences mean `ROLLBACK_PARTIAL_NOT_GREEN`. Retry only a resolved no-mutation refusal or an interrupted operation whose checkpoint reconciliation succeeds; do not repair, bypass, or edit an integrity failure. Retain quarantine and locks. Never restore §7b from a hash, write config.toml, update known_hosts, stop a daemon, or repair Homebrew as rollback.

### Reviewed pre-snapshot recovery (r4p)

`recover <past-run-stem> --dry-run` returns a plan with zero remote writes. `recover <past-run-stem>` applies that exact receipt-based validation afresh. Local evidence is reserved separately as `recover-dry-run.json/.stderr` and `recover.json/.stderr`; never overwrite the old stopped run. The lead's supplied recovery block copies its prerequisites into a fresh M4 evidence RUN with timestamps preserved, then uses this revision's controller over the existing strict transport.

Recovery first refuses complete snapshot custody and an active installer/sync writer. It checks the entire removal plan before mutation: each created B′ file must retain its recorded after-bytes and metadata, a created ratchet parent must contain exactly those files, and every custody/stage/lock entry must be a recorded regular file/directory with the same identity, owner, mode and file SHA256. Symlinks, foreign entries, nonempty directories, missing provenance or mismatches STOP and remain in place. It removes created B′ files, then uses empty-only `rmdir` for a created parent. Pre-existing B′ files and parents remain intact. It unlinks only individually verified run-created custody files, removes each empty directory and checks absence after every operation. No recursive delete is used. Receipt plans and verified removals return in stdout JSON; a fsynced ownership journal retains partial progress until the last custody removal. Recovery never touches skills, `current` or the Gemini link and never upgrades the failed attempt to green.

New runs record a lock `owner.json` containing the exact stem/uid, and a parity-custody `recovery-ownership.json` enumerates created stage/custody entries with identities and hashes. For only the named legacy retry-4 stem, an empty unmarked lock can be attributed by identical remote/M4 preflight receipts, the PRE_SNAPSHOT_STATE_CHANGED result, original preflight/snapshot evidence times bracketing the lock/stage creation, and no other unfinished stem. The legacy custody must contain exactly its three recorded files and the stage must be empty. Missing or ambiguous evidence STOPs. Dry-run leaves even the journal absent; apply writes a journal inside that same custody, removes it last, and returns its removal receipt to the M4.

## 7. Footprint (all writes, in scope under ruling 3)

M1 Pro paths below are relative to that machine's `Path.home()`. O01–O12 are the same path families as the inventory, all **IN-SCOPE** under ruling 3. O13/O14/O15 retain the reviewed parity prerequisite footprint. O16 is the one reviewed KNOWN_DRIFT unlink after snapshot; no other dangling repair or parity-config/requirements write is authorized.

| ID | Write family | Purpose |
|---|---|---|
| O01 | `.claude/skills.bak-HEAD-UTC.tgz` | Built-in five-root backup. |
| O02 | `.golems/m1-sync/**`, `.golems/m1-procedure.lock` | Stages, snapshot, custody rename, quarantine, numbered rollback attempts/extraction trees/checkpoints, lock owner evidence, changed-state captures, recovery ownership/progress and verified residue removal. |
| O03 | `.golems/{releases,bin,.install-lock,.install-*}/**` and client parents | Installer scaffolding, extraction, intermediates, cleanup. Existing client roots/parents required. |
| O04 | `.golems/releases/VERSION/**` | Verified payload; retain old releases. |
| O05 | `.golems/{current,release.json,release-history}` | Activation, history, restoration. |
| O06 | `.golems/bin/{pr-watch,golems-cli}` | Executable wrappers. |
| O07 | `.golems/.hooks-rollback-UUID/**` | Client-hook transaction. |
| O08 | `.claude/hooks/**` | Managed files/links, client receipt, conflict backups. |
| O09 | `.claude/settings.json`, `.bak-*`, `.install-hooks-tmp` | Only hook registration keys may change in shared JSON. |
| O10 | `.codex/hooks.json`, `.golems-backup-*`, `.new-*` | Only hook registration keys may change in shared JSON. |
| O11 | `.golems/vendor/design-skills/PIN/**` and staging siblings | Verified vendor snapshots. |
| O12 | `.local/state/golems/install-receipts/**` and ancestors | Event/temp/latest files and rollback evidence. |
| O13 | `.golems/ratchet/installed-skills.json` only | §2 reviewed four-key template; create absent file as `0600`/running uid, verify present file without rewrite; snapshot/rollback records `created_by_run` and restores bytes or absence. Existing key stays read-only; parent creation is O15. |
| O14 | `.golems/ratchet/requirements.json` only | §2 B′ deterministic derivation from the reviewed runtime-selected M4 manifest: identical canonical roots, exactly reversed pins, schema 2 only; create absent file as `0600`/running uid, verify exact present bytes without rewrite; snapshot/rollback restores original bytes or absence. |
| O15 | `.golems/ratchet` directory only | M1 Pro §2 creates exactly this absent parent as `0700`, running uid; `.golems` must already be real, non-symlink and user-owned. Existing parent must be real, non-symlink, user-owned and not group/world writable; never chmod. `before.json`/`complete.json` and snapshot state retain `parent_created_by_run`; rollback uses empty-only `rmdir` after both files return to absence, never removes a pre-existing parent. |

| O16 | `.gemini/config/skills/tmp-block` only | After archiving the symlink object without dereference, record/fsync its exact text and lstat mode/uid/gid/mtime plus `removed_by_run`; recheck ownership, real parent, byte-equal text and absent target, unlink only this path and fsync the root. Absent/resolving/non-link entries are no-ops. Full rollback restores and verifies byte-exact text, mode and owner; retry is idempotent. |

Five roots: `.claude/skills`, `.agents/skills`, `.codex/skills`, `.cursor/skills`, `.gemini/config/skills`. M4 Max writes include this run's `docs.local/ratchet-runs/` evidence and run log, plus the standard live-rows producer effects explicitly enumerated in §7c. GitHub reads/downloads and that producer's sticky-comment publication are in scope. Existing authorization, parity configs, identities, signing key/anchor, and SSH trust are read-only prerequisites, except EXACTLY O13/O14/O15 and the O16 single-link pre-step in §2 on the M1 Pro: the reviewed config at `.golems/ratchet/installed-skills.json` and derived requirements at `.golems/ratchet/requirements.json`, both mode `0600`, running uid, and only their absent parent `.golems/ratchet` as `0700`. Every other requirements file, identity key, parity config, and both M4 Max source files remain read-only.

## 7b. OUTSIDE SCOPE: STOP

Never change:

- `/Applications`.
- Any LaunchAgents or launchctl state.
- BrainLayer: DB, daemon, socket, or its launchd jobs.
- brew or its installation.
- `~/.codex/config.toml`.
- `~/.ssh/known_hosts` on either host, including nested parity's initiating host.

Every SSH/SCP uses `StrictHostKeyChecking=yes`, `UpdateHostKeys=no`, and `BatchMode=yes`, including nested M1-to-peer parity. Unknown host keys STOP. No `accept-new`, keyscan, trust update, brew provisioning, app update, daemon load/restart, or launchctl mutation is a workaround. The guard's read-only `launchctl print` and `print-disabled` do not change state.

## 7c. M4 Max-side effects of the standard live-rows producer (bootstrap and every run)

CI-hygiene's standard ratchet live-receipt producer runs routinely after guarded merges. Bootstrap's mandatory `live-rows.sh --sync-m1` route runs **all** `live` rows: master's freshness gate needs an all-PASS live receipt. These existing M4 Max-side ratchet effects are in scope on bootstrap and every producer run; they are not M1 Pro writes. Do not skip the human-confirm row or publisher to make the footprint smaller. The direct full-mode sync in §3 does not itself run the producer; keep its post-check too, expecting no producer effects during that direct invocation. Any separate standard producer invocation gets its own pre/post evidence boundary; §5 still measures parity directly and never repeats live rows.

All source references below are at W10 `f168a2d884a4b0c49b0467089eba81ef0c9a0bb4` in `EtanHey/golems` (GitHub source inspected; none executed by this research worker):

| M4 Max effect | Source and exact path/target |
|---|---|
| Live-run evidence, results and table | `scripts/ratchet/live-rows.sh:39–46,63–69`, `scripts/ratchet/run-rows.mjs:69–70`, and `scripts/ratchet/table.mjs:364–367`: `$GOLEMS_ROOT/docs.local/ratchet-runs/live-pr$MERGED_PR-<timestamp>/{pr-body.md,results.json,table.md}` and the `--sync-m1` download/log footprint already in §3. |
| Live hook-status Git fetch | `scripts/ratchet/rows.json:104–112` selects `scripts/ratchet/live/status.sh`; its lines 6–9 run `git -C "$HOME/Gits/golems" fetch -q origin master`, then hook `--status`. Fetch updates the M4 Max Golems common Git directory (FETCH_HEAD and fetched object/ref/log state; exact storage paths depend on the Git backend). This is part of the existing producer, outside the two policy/collab trees monitored below; it is not an M1 write. |
| Real lead-token issuance | `scripts/ratchet/rows.json:115–123` selects `mac/hc-probe.py`; `scripts/ratchet/mac/hc-probe.py:49–68` feeds the real installed hook and executes `$HOME/Gits/golems/.worktrees/hooks-live/scripts/golems-lead-confirm`. `scripts/golems-lead-confirm:84–98` creates `$HOME/.config/golems/human-confirm/` if absent, writes `<nonce>.json`, and creates `<nonce>.json.sig` using the existing signing key. Signing key `$HOME/.config/golems/lead-signer/lead_ed25519` and anchor `$HOME/.config/golems/human-confirm-anchor/allowed_signers` are read-only (`scripts/golems-lead-confirm:37–44,80–84`; `skills/golem-powers/human-confirm-gate/hooks/tokens.py:32,98–114`). |
| Durable issuer-log append | `scripts/golems-lead-confirm:47–56,101–104`: `$HOME/.config/golems/human-confirm/lead-issued.log` (create if absent, append, fsync); records the nonce and lease repo/PR/head. |
| Durable orchestrator collab append | `scripts/golems-lead-confirm:33,81–83,105–107`: `$HOME/Gits/orchestrator/collab/2026-09-24-oss-consolidation.md`, which must already exist; appends the `GOLEMS_CONFIRM` token record and issuance line. |
| One-use token consumption | `skills/golem-powers/human-confirm-gate/hooks/tokens.py:244–256`: creates/fsyncs permanent `$HOME/.config/golems/human-confirm/<nonce>.spent`; consumes (unlinks) only that token's `<nonce>.json` and `<nonce>.json.sig`. Issuer failure also removes only its own token/signature (`scripts/golems-lead-confirm:110–112`). Successful final state normally retains the spent marker, issuer log and collab append, not the token/signature. Never clean these records or unrelated tokens. |
| GitHub sticky-comment publication | `scripts/ratchet/live-rows.sh:39,65–69` passes `--repo EtanHey/golems --pr "$MERGED_PR" --marker golems-ratchet-live --author "$(gh api user -q .login)"`. `scripts/ratchet/table.mjs:268–277,364–368` PATCHes the oldest matching comment owned by that author, or POSTs a new comment on **EtanHey/golems PR `$MERGED_PR`** (`repos/EtanHey/golems/issues/comments/<id>` or `repos/EtanHey/golems/issues/$MERGED_PR/comments`). This is publication, not reads/downloads only. `$LEASE_PR` is the separate open-PR lease target, never the table-publication target. No push is performed by the probe. |

**Required pre/post check:** execute the definition block below after §2 and before §3. §3 calls it immediately before sync and after it returns, and the failure handler captures a post-state if sync stops. Use the same boundary around every separate standard producer invocation, with a distinct evidence run directory and `M4_EXPECT_PRODUCER=1`; its caller must retain the same `live-route-custody.json` shape as §3 (`paths`: one exact live evidence directory, `exit`: actual producer exit), plus the actual `MERGED_PR`. Missing route custody STOPs. Never re-use a before/after pair. No other process may edit the monitored trees during that boundary. The recursive before/after inventory covers every path under `$HOME/.config/golems` and `$HOME/Gits/orchestrator/collab`, including file byte hashes and metadata. It refuses symlinks/special files rather than missing writes through them, verifies log/collab prefix bytes stayed identical, records every changed path with before/after values, and ties permitted nonce files to new issuer-log records. Any other path or metadata change is reported in `unexpected` and STOPs acceptance. Existing append targets must retain mode, uid, gid, file flags and file kind; only append-only size growth and mtime/ctime changes are permitted. New issuer logs and spent markers must be regular files with mode `0600`, this uid, the containing directory's gid (macOS creation inheritance), and zero file flags: W10 `scripts/golems-lead-confirm:49` and `skills/golem-powers/human-confirm-gate/hooks/tokens.py:248–250` create them with `os.open(..., 0o600)`, without chown or flag changes, under §1's `umask 077`. The collab must already exist (`scripts/golems-lead-confirm:81–83`). Keep the diff even on failure (an unreadable/unsupported inventory instead retains `m4-live-effects-<mode>-error.json` and STOPs); do not undo policy/collab/publication effects as M1 rollback.

```bash
cat > "$RUN/m4-live-effects.py" <<'PYEFFECTS'
import hashlib, json, os, re, stat, subprocess, sys
from pathlib import Path
run, home = Path(os.environ['RUN']), Path.home()
roots = [home / '.config/golems', home / 'Gits/orchestrator/collab']
issuer = home / '.config/golems/human-confirm/lead-issued.log'
collab = home / 'Gits/orchestrator/collab/2026-09-24-oss-consolidation.md'
cap = issuer.parent

def digest(raw): return hashlib.sha256(raw).hexdigest()
def append_metadata_ok(old, new, create_gid=None):
    keys = ('mode', 'uid', 'gid', 'flags', 'kind')
    if old is not None:
        return old['kind'] == 'file' and new is not None and all(old[k] == new[k] for k in keys)
    if new is None: return True
    if create_gid is None: return False
    expected = dict(mode=0o600, uid=os.getuid(), gid=create_gid, flags=0, kind='file')
    return all(new[k] == expected[k] for k in keys)

def effects_self_test():
    prefix = b'existing\n'; raw = prefix + b'append\n'
    old = dict(mode=0o600, uid=os.getuid(), gid=os.getgid(), flags=0, kind='file',
               size=len(prefix), sha256=digest(prefix), mtime_ns=1, ctime_ns=1)
    grown = dict(old, size=len(raw), sha256=digest(raw), mtime_ns=2, ctime_ns=2)
    assert len(raw) > old['size'] and digest(raw[:old['size']]) == old['sha256']
    assert append_metadata_ok(old, grown), 'append growth, unchanged metadata must PASS'
    for label in ('issuer log 0600→0666', 'collab 0600→0666'):
        assert not append_metadata_ok(old, dict(grown, mode=0o666)), label + ' must STOP'
    assert append_metadata_ok(None, old, old['gid']), 'new private file must PASS'
    assert not append_metadata_ok(None, dict(old, mode=0o666), old['gid']), 'new public file must STOP'
effects_self_test()

def inventory():
    rows = {}
    def visit(p):
        if not p.exists() and not p.is_symlink(): return
        info = p.lstat()
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError('STOP: unsupported monitored path: ' + str(p))
        row = dict(mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid,
                   flags=getattr(info, 'st_flags', 0), kind='dir' if p.is_dir() else 'file')
        if p.is_file(): row.update(size=info.st_size, sha256=digest(p.read_bytes()), mtime_ns=info.st_mtime_ns, ctime_ns=info.st_ctime_ns)
        rows[str(p)] = row
        if p.is_dir():
            for child in sorted(p.iterdir()): visit(child)
    for root in roots:
        for parent in [root, *root.parents]:
            if parent.is_symlink(): raise ValueError('STOP: symlinked monitored parent: ' + str(parent))
        visit(root)
    return rows

def save(name, data):
    with (run / name).open('x') as f: json.dump(data, f, sort_keys=True)
mode = sys.argv[1]
def captured_inventory():
    try: return inventory()
    except (OSError, ValueError) as error:
        save('m4-live-effects-' + mode + '-error.json', {'error': str(error)})
        raise
if mode == 'before':
    save('m4-live-effects-before.json', captured_inventory())
    raise SystemExit(0)
assert mode == 'after'
before = json.loads((run / 'm4-live-effects-before.json').read_text())
after = captured_inventory()
changed = {p: {'before': before.get(p), 'after': after.get(p)} for p in sorted(before.keys() | after.keys()) if before.get(p) != after.get(p)}
errors, appended = [], {}
for path in (issuer, collab):
    old = before.get(str(path)); raw = path.read_bytes() if path.exists() else b''
    create_gid = after.get(str(cap), {}).get('gid') if path == issuer else None
    if not append_metadata_ok(old, after.get(str(path)), create_gid):
        errors.append('append-target metadata changed or invalid: ' + str(path))
    size = old['size'] if old else 0
    if len(raw) < size or digest(raw[:size]) != (old['sha256'] if old else digest(b'')):
        errors.append('not append-only: ' + str(path))
    appended[str(path)] = raw[size:]
records = []
try:
    records = [json.loads(line) for line in appended[str(issuer)].splitlines()]
    assert all(isinstance(r, dict) and isinstance(r.get('nonce'), str) and re.fullmatch('[0-9a-f]{32}', r['nonce'])
               and isinstance(r.get('session'), str) and r['session'].startswith('ratchet-hc-') for r in records)
except (ValueError, KeyError, TypeError, AssertionError): errors.append('malformed producer issuer append')
nonces = {r['nonce'] for r in records if isinstance(r, dict) and isinstance(r.get('nonce'), str)}
expect = os.environ.get('M4_EXPECT_PRODUCER') == '1'
if expect and len(records) != 1: errors.append('expected exactly one producer issuance')
if not expect and changed: errors.append('direct sync unexpectedly changed monitored M4 paths')
allowed = {str(issuer), str(collab)} | {str(cap / (n + suffix)) for n in nonces for suffix in ('.json', '.json.sig', '.spent')}
unexpected = [p for p in changed if p not in allowed and not (p == str(cap) and p not in before and after[p]['kind'] == 'dir')]
for n in nonces:
    spent = str(cap / (n + '.spent'))
    if spent in before or after.get(spent, {}).get('size') != 0: errors.append('missing fresh spent marker: ' + n)
    if not append_metadata_ok(None, after.get(spent), after.get(str(cap), {}).get('gid')):
        errors.append('invalid new spent metadata: ' + n)
    if ('"nonce":"' + n + '"').encode() not in appended[str(collab)]: errors.append('missing collab token append: ' + n)
publication = None
if expect:
    try:
        route = json.loads((run / 'live-route-custody.json').read_text())
        assert route['exit'] == 0 and len(route['paths']) == 1
        body = (Path(route['paths'][0]) / 'table.md').read_text().rstrip('\n')
        author = subprocess.check_output(['gh', 'api', 'user', '--jq', '.login'], text=True).strip()
        pages = json.loads(subprocess.check_output(['gh', 'api', '--paginate', '--slurp', 'repos/EtanHey/golems/issues/' + os.environ['MERGED_PR'] + '/comments'], text=True))
        matches = [c for page in pages for c in page if c['user']['login'] == author and c['body'].splitlines()[0:1] == ['<!-- ratchet-table: golems-ratchet-live -->']]
        assert matches and matches[0]['body'].rstrip('\n') == body
        publication = dict(repo='EtanHey/golems', pr=os.environ['MERGED_PR'], id=matches[0]['id'], url=matches[0]['html_url'], body_sha256=digest(body.encode()))
    except (OSError, ValueError, KeyError, IndexError, AssertionError, subprocess.SubprocessError) as e:
        errors.append('publication proof failed: ' + type(e).__name__)
save('m4-live-effects-after.json', after)
save('m4-live-effects-diff.json', dict(changed=changed, unexpected=unexpected, errors=errors,
    append_bytes={p: len(raw) for p, raw in appended.items()}, nonces=sorted(nonces), publication=publication))
if unexpected or errors: raise SystemExit('STOP: M4 Max side-effect diff failed; report m4-live-effects-diff.json')
print('M4_LIVE_EFFECTS_ENUMERATED_PATHS_ONLY')
PYEFFECTS
# Bootstrap runs the producer inside §3; full mode uses the direct sync there.
export M4_EXPECT_PRODUCER=0
if [ "$PROC_MODE" = bootstrap-run-1 ]; then export M4_EXPECT_PRODUCER=1; fi
```

Review `m4-live-effects-diff.json` together with the live-run `results.json` and `table.md`; all selected live rows must PASS at the exact target SHA. The publication check reads back the author's oldest marker comment on the merged PR and requires byte-equivalent table text (ignoring only final newlines), retaining its ID/URL/hash. The log and collab checks report append byte counts, with prefix-hash comparisons proving earlier bytes unchanged. Pre/post inventories prove retained differences only: transient token/signature creation and consumption are established by the cited source and live human-confirm result, not by an empty final token listing. A failed/interrupted producer may retain its own token/signature or partial appends; report that failed run and diff without cleanup or retry. §7b is unchanged and still applies to both hosts.

## 8. Run log and repeatability

Append one UTF-8 TSV line per actual run to `$GOLEMS_ROOT/docs.local/ratchet-runs/m1-procedure-runs.tsv`. Fields are JSON-escaped strings: UTC, MERGE_SHA, receipt path or `none`, verdict, deviation. `append_run_log` above is the exact writer. Failed prerequisites before evidence-directory creation are reported as stopped preconditions, not install runs.

Any deviation means STOP and fix the procedure first. Never patch the running shell to continue. Preserve the stopped run; use a distinct future run only after reviewing the correction. Run 1 is BOOTSTRAP and excluded from stability. After I5 merges, run 2 is the first full run and run 3 is the next full guarded merge. Compare the actual commands/steps of run 2 against run 3: any change is a stability failure requiring a procedure revision first. Keep both full run-log rows/evidence paths and the excluded bootstrap row. This research task claims no run 1/run 2/run 3, live install, or rollback exercise.

Research validation (r3): all six Bash blocks pass `bash -n`; all eleven extracted Python heredocs pass `python3 -m py_compile` under `docs.local/scratch/m1proc-r3/`. The inline JSON self-test and seven additional JSON type/nesting/hooks cases pass. An in-memory directory model rejects each of 30 tested directory/ancestor symlink positions and permits absent vendor directories. Four in-memory protected-state cases detect unrelated launchctl service changes, disabled overrides, user LaunchAgents listing changes, and plist-byte changes. An in-memory model of the extracted rollback branch passes 58 injected interruption/resume cases, writer-refusal retry, and an already-restored retry. These models mock filesystem/SSH/process/parity operations; they do not establish real tar/filesystem/launchctl behavior or an M1 Pro restore. The controller contains no deletion calls; command blocks contain no literal user HOME paths. Prior r2 five-root and namespace checks remain historical.

Research validation (r4): all six extracted Bash blocks pass `bash -n`; all eleven Python heredocs and the new standalone SSH-config parser pass `py_compile` under `docs.local/scratch/m1proc-r4/`. The parser accepts two valid configurations and rejects twelve wrong/missing/duplicate/malformed flag cases. A shell function simulating `ssh -G m1` with `updatehostkeys true` exits nonzero before the next-step sentinel; the strict-output control reaches that sentinel. No SSH binary, installer, or remote controller mode was executed. The public-boundary scan finds no private absolute HOME path or private orchestrator evidence path outside quoted rulings. Reversing only the listed r4 edits reproduces r3 byte-for-byte, including all three quoted rulings. These are static and fake-output checks only. Bootstrap execution remains blocked by the source dependencies in §1b.

Research validation (r4b): seven extracted Bash blocks pass `bash -n`; nineteen Python heredocs and the generated M4 Max shim pass `py_compile` under `docs.local/scratch/m1proc-r4b/`. The inline bootstrap self-test and seven additional refusal cases pass. Fake `ssh -G` checks for each host accept the valid control and reject wrong batch/strict/update, duplicate, and missing options before the next-step sentinel. All six frozen definitions compare byte-for-byte with both cited I5 PR heads; a local tree gives equal shipped/frozen hashes and a deliberately differing shipped hash STOPs. Six intercepted M4 Max shim argv cases retain all strict flags and give every M1 command its explicit PATH. Two scratch-HOME M1 transport cases validate the actual helper-target host, generated shell shim syntax, and refusal on a wrong flag. No system SSH/SCP binary, installer, real controller mode against a host, or M1 Pro action was executed. Reversing only the recorded bootstrap/PHX edits reconstructs r4 byte-for-byte; §§6–7b and all three quoted rulings remain byte-identical. These local checks supersede r4's unresolved bootstrap-source blockers, without proving an install, successful run, repeatability, or rollback.

Research validation (r4c): eight extracted Bash blocks pass `bash -n`; twenty Python heredocs and the generated M4 Max shim pass `py_compile`. The embedded positive fixture is byte-identical to this worker's connection-free `/usr/bin/ssh -G -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no review.invalid` capture. For each host's shared parser, the real fixture and all four safe serialization combinations pass; all 22 negative fixtures STOP (13 unsafe-value cases plus 3 missing, 3 duplicate and 3 malformed cases). Across both host paths: 10 positive passes and 44 negative STOPs. Ten scratch-HOME side-effect cases pass their expected verdicts: direct/no-change and the enumerated producer control PASS; eight cases STOP for unexpected config/collab paths, existing config byte/mode changes, collab overwrite, wrong publication, effects during direct sync, or a symlink. GitHub replies are mocked in those tests; no comment was published. The initial extraction caught an escaped-newline syntax error in the new post-check; it was corrected and the failed extraction is retained separately from the passing round. Evidence: `docs.local/scratch/m1proc-r4c/` (real capture, r4b baseline, extracted copies, validation harness and JSON). The restricted diff check confirms all other r4b bytes unchanged, including §6, §7b and all three quoted rulings. Only the dummy-host `ssh -G` was executed; no connection, producer, real policy/collab write, M1 Pro action, installer or rollback was run. PROCEDURE_READY r4c remains written-procedure readiness only.

Research validation (r4g): eight Bash blocks pass `bash -n`; twenty-two Python heredocs and the generated M4 Max shim pass `py_compile`. The five existing inline self-tests pass (ancestry, bootstrap refusal, strict SSH configuration, recursive JSON diff, and side-effect metadata). The frozen source hash remains unchanged; bootstrap hashing, full-mode equal hashes, and refusal on differing full-mode hashes pass their local cases. The retained run-1 asset hashes are unchanged. At `218a5a50111819cf8efd146890e0ed0b5341d372`, bootstrap's §1 offline replay exits 0 after the transform self-tests, exact derived `package.json`, transform audit, and all 653 archive members. Its I5 source blob is `d4ccdc422de57a05b870ecff6c398b4da3d9dfe8`, SHA256 `99fb600db0a10738f8ce7f097ab188d6a714f9286ec8e1d35ab8f83636b250be`. The extracted controller source-loader passes the real Git-source control and STOPs on a missing commit, altered `git show` bytes, or altered preflight evidence. The historical full-mode replay correctly STOPs on missing `scripts/skills-sync-receipt.mjs`; neither receipt script ships in that pre-I5 release. The complete three-site `extractfile(`/`getmember(` audit finds an additional unconditional non-shipped dependency: §2's `document('scripts/release/shipped-paths.json')`. Replaying only those exact archive-read statements locally raises `KeyError: "filename 'scripts/release/shipped-paths.json' not found"` before any controller mode or SSH. The installer, catalog, and vendor manifest are shipped; `MANIFEST.json` is generated and verified. Evidence and the validation harness are under `docs.local/scratch/m1proc-r4g/`, with the completed report in `round-2/validation.json`. The first audit harness incorrectly assumed every intended member was shipped; its failed round is retained, and round 2 records the actual policy result. Boundary greps remain empty. Sections 3–8's prior content, the frozen functions, all three quoted rulings, and all unrelated r4f bytes are unchanged. No M1 contact, live-row/producer, installer, or rollback run occurred. A separate decision on the policy source is required before readiness; run 1 remains STOPPED.

Research validation (r4i): all eight extracted Bash blocks pass `bash -n`; all twenty-three Python heredocs and the original generated M4 Max shim pass `py_compile`. The five new filesystem cases pass: absent creates exact template bytes/mode `0600`; identical preserves bytes/inode; one-field mismatch, `0644`, and symlink each STOP without rewriting. The five prior inline self-tests also pass. Two full offline replays through §§1–2 exit 0, with recorded GitHub-response stubs, the retained run-1 assets at `218a5a50111819cf8efd146890e0ed0b5341d372`, all 653 release members, actual Git source/blob verification, and SSH stub execution in a scratch M1 HOME. Each replay then executes the extracted snapshot, presync, rollback and second rollback: the new-config case restores original absence; the existing-config case restores exact whitespace/bytes/mode after a simulated failed-sync config overwrite. Protected-system inventories, runtime/peer observations, hook status and identity pins are fixtures; parity failures remain recorded as NOT_GREEN. These tests prove the local controller paths, not actual M1 rollback, live parity or installation. A separate missing-requirements scratch case reproduces the next live prerequisite failure before config/custody writes. Read-only strict SSH confirmed the M1 key/peer alias, absent config/parent and absent requirements in the inspected Golems/Orchestrator locations; no remote mutation occurred. All three quoted rulings and frozen I5 source remain byte-identical; boundary greps for private HOME paths, private evidence paths, email-shaped hostnames and the private M1 username are empty. Evidence: `docs.local/scratch/m1proc-r4i/validate.py`, `round-4/results.json` (original absence), `round-5/results.json` (prior bytes), and each round's `next-blocker.txt`. The separate generated-shim extraction initially selected the wrong heredoc and stopped with `StopIteration`; selecting the heredoc containing the shim corrected the harness, and original shim compilation passed. The live run remains STOPPED; the missing schema-2 M1 requirements file is not created under the config-only exception.

## Historical r4j decision: superseded by the explicit B′ contract in r4k

**STOP — no option was silently substituted.** The preferred A is technically valid for inventory alone: at current master `218a5a50111819cf8efd146890e0ed0b5341d372`, `scripts/ratchet/installed-skills.py:226–264` builds an inventory without a requirements manifest, and `main:372–373` dispatches `--inventory` before config loading at `:375`. The verified source can therefore be executed as a library and its `inventory()`, `observed_identity()` and frozen/shipped tree hashes called without `main()` or `load_config()`. This would remove the controller's M1 parity config dependency. It does **not** remove every M1 comparison in the unchanged procedure.

The decisive counterexample is full §3. Both the previously reviewed #918 head `4b6ddf3d24b7426773bf4896a3c39973e9b8b2dc` and its current OPEN head `c86484fbd59104bb0308f1454a09ce5456ebc45b` retain this call chain:

| Source at current #918 head | M1 Pro call and dependency |
| --- | --- |
| `scripts/ratchet/sync-m1.py:162–173,232–240` | Full sync's successful install **and** already-current path call `after_m1_sync()`. It uses strict SSH to run `--remote receipt` on the M1 Pro. |
| `scripts/ratchet/sync-m1.py:50–59` | Remote receipt runs the installed `scripts/skills-sync-receipt.mjs emit release-channel` on the M1 Pro. |
| `scripts/skills-sync-receipt.mjs:8–12`; `scripts/lib/skills-sync-receipt.mjs:69–82` | `emitSkillsReceipt()` spawns `python3 -B scripts/ratchet/installed-skills.py` **without `--inventory`** at library line 75. It requires live/pass parity for the receipt subsequently accepted in §4. |
| `scripts/ratchet/installed-skills.py:388–407,417–423` | That M1 process calls `main()` → `load_config()` at line 400 → M1 requirements read/validation → SSH peer inventory → `compare(local M1, remote M4, requirements)` at line 423. Its config missing-file failure is now line 369 (master's historical line 344). |

The retained r4i controller's exact M1 config-loader sites are baseline lines 965 (`parity_config_pre_step`), 1079 (`transport`), 1099 (non-preflight bootstrap guard except rollback), and 1363 (rollback `ns['main']()` → master line 375). Each reaches master's `load_config:339–360` if its prerequisites permit, with a missing config raising at line 344. Baseline line 1463 is the **M4 Max** identity/config preflight, not another M1 caller. The schema-source hash check merely inspects `load_config` bytes and never calls it. Since neither whole-procedure option holds, those M1 sites remain explicitly blocked; none is claimed removed.

Thus A cannot cover the full run without a Golems receipt/helper change. This worker is not authorized to change Golems code or replace its receipt route. Bootstrap's frozen W10 `after_m1_sync()` is a no-op, but bootstrap-only success cannot qualify A for all later runs. No controller-only edit is presented as removing that independent M1 comparison.

**B also cannot pass as specified.** The existing M4 Max requirements are ordered `[M4 Max, M1 Pro]`, as checked by the controller's local `observed_identity() == requirements['identities'][0]` preflight and its pinning of the M1 to index 1. Master's `installed-skills.py:296–300` and current #918 `:320–325` compare local then remote against those ordered pins. A byte-identical mirror on the M1 would therefore compare `[M1 Pro, M4 Max]` to `[M4 Max, M1 Pro]` and fail **both** identities. The current r4i `parity_config_pre_step()` also explicitly requires `[M1 Pro, M4 Max]`, rejecting the mirrored document before config creation. Reversing the pins would be a different manifest and would violate B's byte-identical requirement. No manifest, config, key, or parent directory has been provisioned.

The inline offline tests now prove three relevant behaviors using actual Git-sourced library functions: an M4-first comparison passes; the identical requirements with reversed hosts reports exactly two identity errors; inventory with an absent scratch `.golems` and a trap on `load_config()` succeeds without creating it. The existing five config filesystem cases and five earlier self-tests remain applicable to the retained, blocked r4i code. Their success cannot resolve either decision-rule contradiction.

### Static §3–§6 M1 dependency trace

The §3–§6 calls remain unchanged in r4k. B′ supplies the two config/requirements dependencies explicitly; it does not remove config loading. This retained trace lists no further unaccounted M1-side file dependency: the existing key, peer trust, roots, runtime and installed receipt/policy/library inputs remain prerequisites and shipping gates, not new files synthesized by this pre-step.

| Section | M1-side reads/calls and required files |
| --- | --- |
| §3 bootstrap | Frozen W10 helper `sync-m1.py:50–122` reads existing `.golems/release.json`, retained releases and attempt `success.json` markers; prepare reads all existing roots and `.codex/config.toml`, then its own stage `before.json`; apply reads verified archive/SHA256SUMS/MANIFEST and extracts their installer, followed by installed Bun `repoint-skills.mjs`. No installed-skills config is loaded by this frozen helper. Live-rows' parity row is initiated on the M4 Max. |
| §3 full | The same install inputs plus the independently initiated M1 receipt/parity chain above. M1 needs its owner-only `.golems/ratchet/installed-skills.json`, that config's existing private key, its schema-2 requirements with **M1-first** pins, and existing SSH trust for its peer. These are required even on the helper's no-op path. |
| §4 receipt/post | Controller `receipt` reads the installed latest receipt; `post` reads snapshot state, existing M1 parity config, shared hook configs, release/current manifest and payload, wrappers, immutable receipt event/latest, all five roots and protected state. Hashing is library-only, but r4i's remote bootstrap guard calls `load_config()` before entering these modes. Full receipt dependencies additionally include `scripts/ratchet/skills-receipt.py:8–13,26–52` importing sibling installed-skills/sync-m1 source, reading builder policy, roots/bin and release.json; `scripts/lib/skills-sync-receipt.mjs:21–24,60–65` also needs the receipt CLI, hooks status and receipt libraries/schema. |
| §5 | The direct two-host parity command runs on the M4 Max. Its M1 child is `python3 - --inventory`, dispatched before config loading; it reads M1 roots, release.json when present, machine UUID/hostname/HOME, and receives source + policy through stdin. No M1 parity config, requirements or M1-to-M4 key is needed **for that child**. Finish repeats the controller's post dependencies. |
| §6 | Controller rollback reads snapshot archive/state/checkpoints and retained old release, restores only the recorded footprint, then runs old hook status. The current `ns['main']()` call with no arguments initiates parity on the M1 and reaches master's `load_config:339–360`, including its missing-file failure at line 344; the retained bootstrap rollback guard uses a template only for SSH option proof. Moving this comparison to the M4 Max is possible for the controller, but cannot repair §3 full's independent receipt call. |

Current #918's `scripts/release/shipped-paths.json:4` now explicitly ships installed-skills.py, sync-m1.py, skills-receipt.py, builder policy, receipt CLI/library/schema and generated validator support. Therefore the older archive-omission finding is **not** asserted against that PR head. Its shipping-policy bytes differ from the frozen §1 audit: the procedure's existing transform hash gate requires re-audit at a future changed MERGE_SHA before a full run, as designed. A current source file being present is not proof its future released bytes or dependencies pass.

### r4j local validation and stop state

The full offline replay through §§1–2 uses the retained run-1 assets at `218a5a50111819cf8efd146890e0ed0b5341d372`, recorded GitHub-response stubs, actual Git-source/blob verification, and stubbed SSH executing the controller in a scratch M1 HOME with **no requirements manifest**. §1 and §1b exit 0, validating all 653 archive members. §2 exits 1 with `reviewed M1 parity requirements prerequisite missing/unsafe`, before config or pre-step custody creation. This is the next failure, preserved rather than filled with a fabricated manifest. Protected-system scans, runtime/peer observations and identity pins are fixtures; no actual SSH connection, M1 write, producer, installer, or rollback was executed.

Evidence is under `docs.local/scratch/m1proc-r4j/`: the byte-preserved r4i baseline, `validate.py`, `replay-final/results.json`, `replay-final/next-blocker.txt` (with the earlier `replay-1` STOP also retained), GitHub source captures and `static-source-trace.json`. The replay intentionally records §2's nonzero result; the harness's successful assertion of that STOP is not a successful procedure replay. All eight Bash blocks pass `bash -n`; all twenty-three Python heredocs and the generated M4 Max SSH/SCP shims pass `py_compile`. The five existing config filesystem cases, five prior inline self-tests, and new directionality/inventory checks pass. Boundary scans for private HOME/evidence paths, email-shaped strings and the private M1 username are empty. The three verbatim rulings and frozen I5 definitions remain byte-identical. See `final-validation.json` for these checks and the final procedure SHA256. These checks do not upgrade the intentionally failing §2 replay to READY.

Historical r4j verdict: PROCEDURE_BLOCKED: A requires changing full-mode Golems receipt parity; B's byte-identical M4 manifest reverses the identities required on the M1. The retained r4i replay stops on the missing M1 requirements file before writing config. Lead resolution must choose a Golems change for A or explicitly revise B's manifest contract; this worker makes neither decision.


## Historical r4k B′ validation and readiness

B′ is the lead's explicit resolution of r4j: it permits a DERIVED manifest, not a byte-identical mirror. The retained §3–§6 trace still accounts for the M1 receipt writer's independent parity invocation. Both it and controller rollback read the same r4i config and the M1-first requirements now provisioned by §2. The existing key/peer trust, root trees, release metadata/payload, hook status, installed receipt CLI/libraries/schema and builder policy remain required; no further unaccounted M1-side file dependency was found in that retained trace. This is a static dependency conclusion at the captured heads, not a promise about a future release. The source/schema and release transform/shipping gates remain active.

Research validation (r4k): eight extracted Bash blocks pass `bash -n`; twenty-three extracted Python heredocs and the generated M4 Max transport shims pass `py_compile`; generated M1 transport shims pass `sh -n`. The five config filesystem cases and five earlier inline self-tests pass. B′ checks pass for exact derivation and M1-first compare; swapping the pins back produces the existing compare's two identity errors. Six requirements filesystem cases pass their expected outcomes: absent/create, identical/no-op, differing bytes STOP, roots drift STOP, `0644` STOP and symlink STOP. Refusals preserve prior bytes/inode and write no creation custody.

Two final offline replays through §§1–2 exit 0: one starts with both files absent, the other with both present. Both create or preserve the exact derived requirements and config as appropriate, retain source path/SHA256 evidence, and execute a passing M1-side Git-sourced inventory/compare with a fixture peer. Each then exercises snapshot, presync, a simulated failed-sync overwrite of both files, rollback and second rollback. Original absence or exact prior bytes/mode are restored for BOTH files; post-restore parity unavailability remains `ROLLBACK_RESTORED_NOT_GREEN`. Recorded GitHub stubs, protected-system/runtime/peer/identity observations and scratch HOME/config pointer substitutions are fixtures. The reviewed roots in the scratch source manifest come from the real runtime-selected M4 manifest; only its M1 identity pin is fixture-specific. Neither that fixture comparison nor these rollback exercises establish live parity or actual M1 restoration.

Evidence: `docs.local/scratch/m1proc-r4k/validate.py`, `round-3/results.json` (absent), `round-4/results.json` (present), their `m1-side-derived-parity.json` files, and `final-validation.json`. Earlier successful rounds remain retained; final rounds include the additional M4 config-preservation guard. The historical r4j STOP and its evidence are retained. The three verbatim rulings, frozen I5 definitions, and §§3–§6 command blocks remain unchanged. Boundary scans for private HOME/evidence paths, email-shaped strings and the private M1 username are empty. Only the procedure and its designated local scratch evidence were written. No SSH connection, live M1 action, live producer, installer, key/root creation or deployment occurred. At r4k the missing ratchet parent remained an explicit STOP prerequisite; r4l below supersedes that parent-only restriction.

## Historical r4l parent-directory validation and readiness

The M1-only §2 exception now includes exactly the absent `.golems/ratchet` parent, created as `0700` after checking its existing real, user-owned `.golems` parent and the read-only key/peer prerequisites. Existing `ratchet` directories are never chmodded and must be real, user-owned and not group/world writable. `before.json`, `complete.json` and snapshot custody retain `parent_created_by_run`. Rollback first restores both files, then uses empty-only `rmdir` for a created parent; it preserves pre-existing parents, refuses unexpected contents and accepts an already completed removal on retry. O15 records this footprint, and `real_directories()` enforces parent safety before preflight, snapshot and sync.

Offline validation: both replays through §§1–2 exit 0. `round-1` starts with `.golems` present and no `ratchet`, creates the parent as `0700` with custody flags, then restores both files and parent to absence in rollback and retry. `round-2` starts with a safe existing `0750` parent and both files present, preserves the parent mode/inode and restores exact file bytes/modes in both rollback attempts. Each fixture M1-side comparison has zero errors. All ten parent cases, five config cases, six requirements cases, earlier inline rejection checks and identity-direction checks pass. Eight Bash blocks and twenty-three Python heredocs pass syntax checks; original M4 transport shim compilation and generated M1 shim syntax checks pass. All Bash blocks outside §2, the frozen I5 definitions and three verbatim rulings remain unchanged. Boundary scans for private HOME/evidence paths, email-shaped strings and the private M1 username are empty.

Evidence: `docs.local/scratch/m1proc-r4l/validate.py`, `round-1/results.json`, `round-2/results.json`, each round's custody/snapshot/rollback records and `m1-side-derived-parity.json`, plus `final-check.py` and `final-validation.json`. Fixture protected-state/runtime/peer observations remain offline substitutes; rollback parity unavailability remains `ROLLBACK_RESTORED_NOT_GREEN`. No M1 contact, live installation, producer, deployment or real-machine rollback occurred. Only this procedure and the designated r4l scratch directory were edited; existing run evidence remains untouched.

## Historical r4m real-listing trace and blocked state (superseded by r4n only for KNOWN_DRIFT)

The retained depth-1 listing covers all five roots and records one dangling link: `.gemini/config/skills/tmp-block -> ../../../.agents/skills/tmp-block`; `.agents/skills/tmp-block` is absent. The listing is evidence of names, object types, link text and modes, not of unlisted target contents, runtime availability, trust, requirements readability or protected-state stability. The replay substitutes HOME only in absolute link text and supplies explicitly synthetic target/file bytes and host observations. It does not repair the dangling link.

### Resolution and preservation code paths

All references below are to this procedure, whose controller is embedded in §2:

| Procedure file:line | Role and dangling-link behavior |
| --- | --- |
| `m1-skills-sync-PROCEDURE.md:716` | `link_resolution()` retains `link_text`, returns `target_state=dangling` for missing/non-directory targets or `broken` for resolution errors; `owned():1269` returns false for either. |
| `m1-skills-sync-PROCEDURE.md:761` | `tree()` follows targets only for complete/content listings; dangling/broken/cyclic links are rows, not exceptions. Non-following archive/mutable listings retain raw link text and lstat metadata without resolving a staging-relative target. Its canonical JSON digest includes those rows. |
| `m1-skills-sync-PROCEDURE.md:1282` | `capture()` retains all five complete listings and per-entry ownership. An unhashable root has `tree_sha256=null` plus `hash_stop`; optional FIXED absence remains `{exists:false, rows:[]}`. |
| `m1-skills-sync-PROCEDURE.md:731` | `root_hash_stop()` follows frozen I5 exclusions; `require_hashable_capture():748` preserves listings in the named STOP. `frozen_hashes():701` guards every direct hash call, including bin, and names other frozen failures. Frozen `tree_sha256():417` remains byte-identical. |
| `m1-skills-sync-PROCEDURE.md:815` | `real_directories()` permits absent optional directories, rejects existing symlink write destinations through `STOP: UNSAFE_FOOTPRINT_DIRECTORY`, and names vendor-tree symlinks. It never dereferences a root child to decide whether a footprint directory is safe. |
| `m1-skills-sync-PROCEDURE.md:1411` | Preflight requires hashability before parity parent/config/custody writes. Snapshot repeats the guard at `:1416` before lock/stage creation, archives without dereference at `:1434`, and records full pre-state. Presync repeats the guard at `:1459`. |
| `m1-skills-sync-PROCEDURE.md:1468` | Post/finish guard a fresh capture before acceptance; `verify_roots():1298` preserves M1-only state and checks changed Gemini link text before any strict destination resolution. Broken changed roots stop by name. |
| `m1-skills-sync-PROCEDURE.md:1606` | Rollback extracts link objects without dereference; `restore_member_metadata():1243` restores link uid/gid/mode without following a missing target. Staged non-following equality at `:1609` and restored full capture at `:1648` verify the same text, metadata, absence and content. No repair is added. |
| `m1-skills-sync-PROCEDURE.md:1680` | The M1 entry catches unexpected exceptions as `STOP: CONTROLLER_EXCEPTION <type>: <msg>` and prints JSON even outside rollback. Local capture at `:1802` also writes a JSON transport failure for invalid/empty remote output; local preflight-loader errors receive the same envelope. |

### §2–§6 trace against the recorded M1 listing

1. §2 roots contain respectively 50 Claude, 50 Agents, 53 Codex, 6 Cursor and 38 Gemini entries; all five root directories exist. Equality across provider catalogs is neither required nor fabricated.
2. §2 records the Gemini dangling link and STOPs before the reviewed parity pre-step, transport staging, snapshot or install; its listing is retained in `preflight.json`, not an empty file.
3. §2 absent receipt leaf and ratchet/config/requirements are optional pre-state. The latter three can be created only by the existing reviewed O13–O15 pre-step, which this STOP never reaches.
4. §2 accepts both `lrwx------` and `lrwxr-xr-x` as observed metadata; it imposes no invented uniform link mode. Snapshot/rollback preserve each, including during extraction where relative targets temporarily dangle.
5. §3 pinned `install.sh:295–337` updates Claude/Agents/Codex only; Agents catalog has no `tmp-block`. It cannot heal the missing Agents target. Existing noncatalog real directories and unrelated link objects are retained.
6. §3 `sync-m1.py:104–106` calls repoint twice with `--vendor-skills`; `repoint-skills.mjs:130–132` takes the vendor-only early return, bypassing the general dangling repair/prune walk. The pinned vendor manifest selects Claude/Codex/Cursor, so Gemini is not rewritten or pruned.
7. §3 preserves absolute Claude skill links through `current`, relative `current -> releases/...` text, and relative Gemini links as objects. Catalog, vendor and indirect-content changes remain subject to owned-link and manifest-byte checks; no manual repair/deletion is introduced.
8. §3 existing `.claude/hooks/tmp-block` points into retained release `2026.10.27-0abede3`; this is an expected release-pinned client hook, separate from the broken skill link. Installer hook reinstallation may update managed hooks; `--preserve-releases` retains the old target for rollback. Actual hook-receipt validity still needs live checking.
9. §4/finish frozen I5 rejects remaining Gemini `tmp-block` with `ValueError: broken symlink in skills root`; the controller therefore stops in §2. Hashes are never substituted with the complete-listing digest. Cursor's six vendor entries have a separate five-root check, not a nonexistent receipt field.
10. §5 pinned parity inventories Claude/Agents/Codex, compares names/content between HOSTS per root, and validates the runtime requirements; cross-provider extras are not errors by themselves. The listing alone cannot prove supporting bytes/readability or two-host parity. No real parity ran.
11. §6 archive/link restoration retains exact link text and modes, including dangling links as data, and remains NOT_GREEN. On this fixture no snapshot exists, so rollback is not entered. Successful earlier fixture rollbacks cannot upgrade this preflight STOP.
12. Full mode at this pre-I5 merge remains ineligible under §1's existing receipt/shipping gates. No future source/receipt acceptance is inferred from this bootstrap replay.

Offline r4m validation: all eight Bash blocks and twenty-three Python heredocs pass syntax checks. The ten parent, five config and six requirements cases, identity-direction/inventory checks and prior inline self-tests remain green. The added relative/absolute dangling and cyclic-link cases preserve exact archive-restored text/modes and produce named errors. The frozen I5 source and all command blocks outside §2 remain unchanged. Two earlier-shape replay controls (absent parent/files and pre-existing parent/files) pass §§1–2, snapshot, presync, rollback and retry; their unavailable parity remains `ROLLBACK_RESTORED_NOT_GREEN`. The real-listing replay passes §§1/1b and deliberately exits 1 in §2 with the exact named dangling STOP, with all five listings and an unchanged fixture HOME. An injected raw M1 `FileNotFoundError` crosses the stubbed SSH boundary and leaves parseable `preflight.json` containing `STOP: CONTROLLER_EXCEPTION`; local source-loader failure does likewise. These are offline proofs only. No M1 contact, live installer/producer, or live rollback occurred. All source/replay artifacts and the detailed report are under `docs.local/scratch/m1proc-r4m/`.

Proposed ruling only, not an executable procedure step: replace the existing `.gemini/config/skills/tmp-block` symlink's text `../../../.agents/skills/tmp-block` with `../../../.claude/skills/tmp-block`, leaving its mode/owner intact. Claude's catalog contains `tmp-block`; Agents' catalog does not. Creating an Agents link instead would invite the installer's noncatalog release-link pruning. Replacing this pre-existing Gemini object requires a separate ruling and separately authorized implementation; do not execute it from this procedure. After such a ruling, revalidate real listing, frozen hashes, preservation and parity before any retry.

BLOCKED-NEEDS-RULING: replace ~/.gemini/config/skills/tmp-block link text ../../../.agents/skills/tmp-block with ../../../.claude/skills/tmp-block, preserving link mode/owner.


## r4n reviewed single-link pre-step and offline validation

The one-row KNOWN_DRIFT exception supersedes r4m's proposed link-repoint ruling and its known-link preflight STOP only. No link is repointed and no missing Agents entry is created. Snapshot preserves the original symlink object, text, mode and owner before the single guarded unlink; post-sync preservation permits exactly that custody-backed removal. Unknown dangling/broken entries still STOP with `DANGLING_ROOT_LINK`, retaining their detailed target state in the five-root listing. Strict presync rejects even a reintroduced exact known link. The preflight, snapshot, presync and rollback JSON retain known-drift results; the durable intent additionally records lstat mtime and object identity.

Offline real-listing replay through §§1/1b/2, snapshot/removal and presync exits 0 with frozen I5 hashes over all five roots. The snapshot tar retains the original Gemini link; two full rollback attempts restore its byte-exact text, mode `0755`, uid and gid. The absent/present parity prerequisite controls, raw-failure reproduction, exception envelopes, parent/config/requirements cases, syntax and immutable frozen-source/Bash contracts remain required checks in the r4n report. The restored fixture parity remains `ROLLBACK_RESTORED_NOT_GREEN`; these offline results establish no M1 install, runtime parity, producer or native acceptance. §7b and §7c are unchanged: the O16 unlink changes no protected path or M4 producer footprint.

Evidence is under `docs.local/scratch/m1proc-r4n/`, including the retained failed first harness replay (its extra inventory rejects synthetic release metadata), corrected required replay, exact-link behavior cases and final verification. No M1 contact or live execution occurred. Only this procedure and that scratch directory were edited.

## r4p protected-state, recovery and free-space validation

The PHX r4p rulings supersede the historical full-content runtime scan and unavailable pre-snapshot recovery. Runtime identities and stable launchd fields use the classification table above in snapshot, presync, post/finish and rollback; installed/config bytes remain fully compared. Changed-state STOPs retain exclusive/fsynced capture pairs and bounded field diffs. Receipt-based recovery removes only proven run-created residue; full-snapshot restoration retains its existing NOT_GREEN semantics. The addendum's measured disk budgets apply a 2x margin above a hard 10 GiB reserve on each host, with pre-mutation and pre-snapshot/pre-sync rechecks.

Offline evidence is under `docs.local/scratch/m1proc-r4p/`. `verified-replay/results.json` records the real-listing fixture replay through §2 and the §3 failure handler, a separate simulated daemon writer, six planted protected-state changes, recovery with newly created and pre-existing parity prerequisites, legacy retry-4 dry-run/apply, low-space refusals and just-above-floor controls. The snapshot passes normal runtime writes; planted plist/DB mode/DB owner/DB absence/daemon-running/binary changes STOP with saved captures and diffs. Recovery preserves skills/current/Gemini and permits a fresh preflight. Full rollback remains ROLLBACK_RESTORED_NOT_GREEN because fixture peer parity is deliberately unavailable. The final legacy-specific replay additionally verifies exact reconstructed r4o custody bytes and refuses a tampered receipt before mutation.

`verified-refusals/results.json` records nine zero-write refusals plus a zero-write dry-run. `final-artifact-checks/results.json` records eight Bash blocks, twenty-four Python heredocs, unchanged frozen I5 SHA256 `1f3a74455bab12cd1ecc478e8a20cd5e9868f17cbe659b5693597b81772725b3`, prior inline/formatter/exception regressions, empty boundary scans, seventeen refused protected-write attempts and the 80-count/50-path diagnostic bound. Earlier failed source/fixture rounds remain retained. The initial guard's rejection of symlink-object metadata restoration was corrected and verified with the guard enabled.

Lead-only deliverables: `live-probe.py` (stdin-piped; 10-second and 200-second intervals), `live-probe-command.sh`, and `live-recover-retry-4.sh` (strict transport; copied evidence preserves the original timestamps). The probe's offline schedule check uses a simulated clock; no actual M1 comparator stability or runtime is claimed. The live probe and recovery are both UNRUN by this implementer. No M1 contact, installer, producer, daemon stop or live residue deletion occurred. PROCEDURE_READY means written-procedure/offline readiness only.
