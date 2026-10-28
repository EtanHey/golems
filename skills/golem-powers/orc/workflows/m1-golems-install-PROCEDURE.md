# Repeat the guarded Golems install on the M1 Pro

## 0. Scope and authority

Status: **PROCEDURE_READY r4h; execution has not occurred.** r4h = r4g plus one lead edit: §2 reads builder policy `scripts/release/shipped-paths.json` from Git at MERGE_SHA (as §1 does) instead of from the release archive, which does not ship it. The revised §1 offline bootstrap replay passes all 653 release members and the Git-source check. The required archive-read audit finds a different blocker: §2 still reads `scripts/release/shipped-paths.json` from the archive, but that path is also excluded from the recorded release. Its exact local read raises `KeyError`; the requested PROCEDURE_READY r4g status is withheld pending a separate release-custody decision on that dependency. `scripts/ratchet/installed-skills.py` is now separately loaded as source code from `MERGE_SHA`, with its blob ID and SHA256 retained in evidence; it need not be shipped or installed on the M1 Pro. Bootstrap run 1 still requires PHX's explicit go to CI-hygiene and the executable §1b refusal gate. Only PHX gives that go. All later runs use the full I5 gate. Local static/fake-output checks do not establish an M1 Pro install or rollback pass.

Etan's three rulings, supplied verbatim in BRIEF-M1-PROCEDURE-r2.md:

> brainbar-23b709c5-f4b: "Standing yes, skills only": "after each guarded golems merge, the deploy agent syncs golems main into ~/.claude/skills on the M1 (the M1 Pro user; username elided for the public repo, full quote in BrainLayer brainbar-23b709c5-f4b) and records a receipt. It never touches /Applications, BrainLayer, or LaunchAgents."

> brainbar-ed39050a-c93: "This needs to be done properly, not one shotted but stable to follow the same next time, all 5 skills folder"

> brainbar-60c4e641-8a9: "Whole golems install": the standing M1 Pro sync after each guarded golems merge covers the 5 skills folders, the ~/.golems/bin wrappers, ~/.golems/releases + current, and golems' Claude/Codex client hooks, via ONE written procedure (W10 sync-m1.py → install.sh --from-file + repoint-skills) with a receipt. Never /Applications, BrainLayer or LaunchAgents. Etan 2026-10-18 still covers everything else.

Ruling 3 includes O01–O12 in the M1 write inventory (release-custody's private record). Shared client configuration may change only under its top-level `hooks` key. Section 4 enforces that condition through a recursive JSON diff.

Executor: CI-hygiene's deploy agent, from the **M4 Max**, targeting alias `m1` with its existing configured account on the **M1 Pro**. Use one fresh Bash shell in `$HOME/Gits/orchestrator`. For full runs, only `<UTC_TS>` needs replacement; §1 reads `MERGE_SHA` from current golems master HEAD and verifies the matching published release. For bootstrap run 1, PHX also supplies the existing reviewed go record via `PHX_GO_FILE`, including the live-row lease PR and checkout; §1b validates it before any M1 Pro action. Use a full lowercase 40-character SHA and UTC timestamp `YYYYmmddTHHMMSSffffff`, without `Z`. No scratch checkout, mutable installer URL, alternative installer, manual receipt, deleted evidence, or automatic retry. Manual rollback retry uses the same run identity and a new numbered attempt (§6).

**External preconditions:** CI-hygiene creates `$HOME/.golems/ratchet/m1-sync-authorized.json` OUTSIDE this procedure from Etan's three quoted rulings above (chunk ids `brainbar-23b709c5-f4b`, `brainbar-ed39050a-c93`, `brainbar-60c4e641-8a9`). For bootstrap run 1, PHX creates the go record OUTSIDE this procedure and supplies its exact absolute path through `PHX_GO_FILE`. This procedure only verifies that the required grant and, in bootstrap mode, PHX go record exist and are well-formed; a missing or malformed required record means STOP. It must never create, edit, or delete either file.

`collab/TEMPLATE.md` was read. This is a static runbook. PR Loop: N/A for this two-file research task. TDD: N/A for documentation. Syntax/source checks do not establish an install or rollback pass. GitHub source inspected at #918 head `4b6ddf3d24b7426773bf4896a3c39973e9b8b2dc`: sync-m1.py, installed-skills.py, skills-receipt.py, skills-sync-receipt.mjs, lib/skills-sync-receipt.mjs, lib/install-receipt-core.mjs, release/install.sh, and vendor-skills.mjs. Revalidate final merged/shipped bytes below. The research worker executed no M1 Pro action or deployment.

## 1. Check prerequisites before any M1 Pro action

Run this block first. Any failed prerequisite stops the shell. Do not create a grant, parity config, missing root, runtime, or SSH trust entry to make it pass. Those are separate work. CI-hygiene must have created `$HOME/.golems/ratchet/m1-sync-authorized.json` OUTSIDE this procedure from Etan's quoted rulings (`brainbar-23b709c5-f4b`, `brainbar-ed39050a-c93`, `brainbar-60c4e641-8a9`). PHX must have created bootstrap's go record OUTSIDE this procedure and supplied its exact absolute path in `PHX_GO_FILE`. The procedure only verifies these required files exist and are well-formed (grant in both modes; PHX go in bootstrap mode), STOPs otherwise, and never creates, edits, or deletes either file. The sole exception is bootstrap run 1 under §1b; it uses the frozen reviewed hash and defers only the explicitly listed receipt checks.

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

Both hosts' `ssh -G` output must contain each required option exactly once: `batchmode yes`, `stricthostkeychecking true` (or `yes`), and `updatehostkeys false` (or `no`). These are OpenSSH's serialized safe values, checked by the same parser on the M4 Max and M1 Pro. §2's shared parser rejects wrong, missing, malformed, or duplicate options. The M4 Max proof above is validated before its first connection. After read-only preflight, the controller creates M1 Pro ssh/scp shims **only** in the run's `.golems/m1-sync/.transport-<SHA>-<UTC>/bin` staging directory, proves `command -v` for both, and runs `ssh -G` through that shim against the host in the M1 Pro's actual parity configuration. Staging evidence is the only mutation before that proof; no install/snapshot mutation proceeds without it. Every prepare/apply/controller/rollback/parity command receives the explicit M1 Pro PATH through the M4 Max shim; helpers themselves remain unmodified. Every local ssh/scp of `live-rows.sh` and `sync-m1.py` inherits the M4 Max shims. Unknown invocation shape STOPs. The remote shim prepends the same flags and execs `/usr/bin/ssh` or `/usr/bin/scp`.

The M4 Max initial known_hosts digest/absence is checked before and after every controller mode; the M1 Pro preflight digest/absence is checked before and after shim proof, snapshot, post, finish, and recovery. The existing protected-state checks compare it after sync/parity too. Any change means rollback + STOP after snapshot; before snapshot, STOP with retained evidence. Never restore known_hosts. The run-specific remote transport staging survives failures/recovery and stays inside §7 O02; it is not a helper success stage or receipt.

Bootstrap evidence lives only in the M4 Max run directory: mode, master SHA, release version, all five pre/post frozen hashes, both hosts' protected-state digests, hook owner status, actual live parity, and `receipt: "deferred to run 2 (I5)"`. Append BOOTSTRAP only after finish succeeds. The live-row parity evidence and bootstrap record are the run-1 records; status remains NO-RECEIPT. Full run 2 writes the first M1 receipt after all I5 merges. Bootstrap run 1 is excluded from stability: compare the first two **full** runs, run 2 and run 3. Any command/step change between them is a stability failure; revise the procedure before proceeding.

## 2. Define the snapshot, checks, and rollback

This block writes a controller only into the run's **M4 Max evidence directory**. It sends its source through strict SSH. The public helper still supplies the verified release installer.

Require all five roots as existing real directories. This runbook creates **none** of them. The installer can create Claude, Agents, Codex, and vendor-selected Cursor roots; this invocation does not create Gemini. A missing root stops preflight.

Every root gets the exact shipped I5 `tree_sha256()` and a complete listing hash including hidden entries, modes, link text, and resolved content. I5 exclusions such as `.system` do not apply to the complete preservation listing. The snapshot lists every M1-only entry as `owned=false`; `post.json` enumerates those proven unchanged.

```bash
cat > "$RUN/m1-control.py" <<'PY'
import contextlib, fcntl, hashlib, inspect, io, json, os, pwd, re, shlex, shutil, stat, subprocess, sys, tarfile
from datetime import datetime, timezone
from pathlib import Path
ROOTS = ['.claude/skills', '.agents/skills', '.codex/skills', '.cursor/skills', '.gemini/config/skills']
FIXED = ROOTS + ['.golems/bin', '.golems/vendor', '.golems/current', '.golems/release.json',
    '.golems/release-history', '.claude/hooks', '.claude/settings.json', '.codex/hooks.json',
    '.local/state/golems/install-receipts/golems']
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
        value = frozen['tree_sha256'](root)
        if not params.get('bootstrap'):
            need(shipped is not None and shipped(root) == value, 'STOP: shipped/frozen tree_sha256 differs: ' + str(root))
        return value
    ns['tree_sha256'] = measured

def tree(path, follow):
    rows = []
    def walk(p, rel, ancestors):
        s = p.lstat()
        row = {'path': rel, 'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid}
        if stat.S_ISLNK(s.st_mode):
            row.update(kind='symlink', target=os.readlink(p))
            if not follow:
                rows.append(row)
                return
            resolved = p.resolve(strict=True)
            row['resolved'] = str(resolved)
            target_stat = p.stat()
            row.update(target_mode=stat.S_IMODE(target_stat.st_mode), target_uid=target_stat.st_uid, target_gid=target_stat.st_gid)
        else:
            resolved = p.resolve(strict=True)
            row['kind'] = 'directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else 'special'
        need(resolved not in ancestors, 'symlink cycle: ' + str(p))
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
REAL_DIRS = ROOTS + ['.golems', '.golems/releases', '.golems/bin', '.golems/vendor',
    '.golems/vendor/design-skills', '.golems/m1-sync', '.golems/m1-procedure.lock', '.claude/hooks',
    '.local/state/golems', '.local/state/golems/install-receipts',
    '.local/state/golems/install-receipts/golems']
def real_directories(home, params):
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
            need(path.is_dir() and not path.is_symlink(), 'unsafe footprint directory: ' + str(path))
    vendor = home / '.golems/vendor/design-skills'
    if present(vendor):
        need(vendor.is_dir() and not vendor.is_symlink(), 'unsafe vendor directory')
        # Snapshot/staging trees contain verified regular files, never writable directory links.
        for child in vendor.rglob('*'):
            need(not child.is_symlink(), 'symlink in vendor write tree: ' + str(child))
            if child.is_dir(): directories.add(str(child.relative_to(home)))
    for relative in sorted(directories):
        path = home / relative
        plain_parents(home, [relative])
        if present(path):
            need(path.is_dir() and not path.is_symlink(), 'unsafe footprint directory: ' + str(path))

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

def protected(home):
    for relative in ('.codex/config.toml', '.ssh/known_hosts'):
        p = home / relative
        need(not p.is_symlink(), 'protected file is symlinked; re-audit: ' + str(p))
    paths = ['/Applications', '/Library/LaunchAgents', '/System/Library/LaunchAgents',
        '/opt/homebrew', '/usr/local/Homebrew', str(home / 'Library/LaunchAgents'),
        str(home / '.local/share/brainlayer'), str(home / '.brainlayer'),
        str(home / '.config/brainlayer'), str(home / '.codex/config.toml'), str(home / '.ssh/known_hosts')]
    import plistlib
    for directory in ('/Library/LaunchAgents', '/System/Library/LaunchAgents', str(home / 'Library/LaunchAgents')):
        root = Path(directory)
        if not root.exists(): continue
        for plist in sorted(root.glob('*.plist')):
            raw = plist.read_bytes()
            if b'brainlayer' not in raw.lower() and b'brainbar' not in raw.lower(): continue
            def collect(value):
                if isinstance(value, dict):
                    for v in value.values(): collect(v)
                elif isinstance(value, list):
                    for v in value: collect(v)
                elif isinstance(value, str) and value.startswith('/') and value != str(home) and (
                        re.search(r'brainlayer|brainbar|\.(db|sqlite|sqlite3|sock)$', value, re.I)):
                    paths.append(value)
            collect(plistlib.loads(raw))
    domain = 'gui/' + str(os.getuid())
    launchctl_state = {'domain': domain,
        'print': command(['/bin/launchctl', 'print', domain]),
        'print_disabled': command(['/bin/launchctl', 'print-disabled', domain])}
    agents = home / 'Library/LaunchAgents'
    agent_listing = command(['/bin/ls', '-la', str(agents)])
    agent_hashes = {str(p): sha(p.read_bytes()) for p in sorted(agents.glob('*.plist'))}

    processes = command(['/bin/ps', '-axo', 'pid=,ppid=,command='])
    selected_raw = [line.split(None, 2) for line in processes.splitlines() if re.search(r'brainlayer|brainbar', line, re.I)]
    selected = sorted([{'pid': row[0], 'ppid': row[1], 'command_sha256': sha(row[2].encode())} for row in selected_raw], key=lambda row: int(row['pid']))
    pids = [row['pid'] for row in selected]
    sockets = command(['/usr/sbin/lsof', '-nP', '-a', '-p', ','.join(pids), '-U', '-Fpn'], (0, 1)) if pids else ''
    for line in sockets.splitlines():
        if line.startswith('n/'): paths.append(line[1:])
    return {'paths': {p: tree(Path(p), False) for p in sorted(set(paths))},
        'brainlayer_processes': selected,
        'launchctl': launchctl_state, 'launchagents_ls_la': agent_listing, 'launchagents_plist_sha256': agent_hashes,
        'brainlayer_sockets': sorted(sockets.splitlines())}

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
    resolved = entry.resolve(strict=True)
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
        roots[relative] = {'tree_sha256': ns['tree_sha256'](root), 'complete': tree(root, True), 'entries': entries}
    config = home / '.codex/config.toml'
    return {'roots': roots, 'current': os.readlink(home / '.golems/current'),
        'config_sha256': sha(config.read_bytes()) if present(config) else None,
        'configs': {p: hooks_config(home / p) for p in ('.claude/settings.json', '.codex/hooks.json')},
        'mutable': {p: tree(home / p, False) for p in mutable(home)}, 'protected': protected(home)}

def verify_roots(before, after, home, params, restore=False):
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
        need(a['complete']['rows'][0] == b['complete']['rows'][0], 'root metadata changed: ' + root)
        need(allowed[root] <= b['entries'].keys(), 'required catalog/vendor entry missing: ' + root)
        for name in sorted(a['entries'].keys() | b['entries'].keys()):
            old, new = a['entries'].get(name), b['entries'].get(name)
            path = home / root / name
            if old and not old['owned']:
                need(new == old, 'M1-only entry changed: ' + str(path))
                unchanged.append(str(path))
                continue
            if old == new and name not in allowed[root] and root != ROOTS[4]: continue
            if root == ROOTS[4]:
                need(old and new and path.is_symlink(), 'unexpected Gemini mutation: ' + str(path))
                need(old['state']['rows'][0]['target'] == new['state']['rows'][0]['target'], 'Gemini link repointed')
            elif new is None:
                need(root in ROOTS[:3] and old and old['owned'] and name not in allowed[root], 'unexpected removal')
                continue
            else:
                need(name in allowed[root], 'unrecognized added/changed entry: ' + str(path))
            need(path.is_symlink() and owned(path, home), 'changed entry is not a managed link: ' + str(path))
            target = path.resolve(strict=True)
            if (root, name) in vendor:
                need(target.is_relative_to(home / '.golems/vendor/design-skills'), 'wrong vendor destination')
                prefix = vendor[(root, name)] + '/'
                expected = {k[len(prefix):]: v for k, v in params['vendor']['files'].items() if k.startswith(prefix)}
            else:
                expected_root = (home / '.golems/current/skills/golem-powers' / name).resolve(strict=True)
                need(target == expected_root, 'changed link selects wrong release: ' + str(path))
                prefix = 'skills/golem-powers/' + name + '/'
                expected = {f['path'][len(prefix):]: f['sha256'] for f in params['manifest']['files'] if f['path'].startswith(prefix)}
            actual = {r['path']: r['sha256'] for r in tree(target, True)['rows'] if 'sha256' in r}
            need(actual == expected and 'SKILL.md' in actual, 'changed skill bytes mismatch: ' + str(path))
    return unchanged

def remote(params, mode):
    home = Path.home()
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
    if params.get('bootstrap'):
        trust = trust_file(home)
        if mode != 'preflight' and mode != 'rollback':
            need(trust == params['m1_trust_before'], 'STOP: M1 Pro known_hosts changed')
        if mode == 'transport':
            config = ns['load_config'](str(home / '.golems/ratchet/installed-skills.json'))
            stage = home / params['bootstrap']['transport_dir']
            plain_parents(home, [str(stage.relative_to(home)) + '/bin/ssh'])
            need(not present(stage), 'STOP: transport stage already exists')
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
            need(trust_file(home) == trust, 'STOP: M1 Pro known_hosts changed during transport proof')
            return {'verdict': 'STRICT_M1_TRANSPORT_VERIFIED', 'host': config['host'], 'effective': output, 'known_hosts': trust}
        if mode != 'preflight':
            bin_dir = home / params['bootstrap']['transport_dir'] / 'bin'
            for binary in ('ssh', 'scp'):
                need(shutil.which(binary) == str(bin_dir / binary), 'STOP: M1 Pro shim missing or PATH changed')
            config = ns['load_config'](str(home / '.golems/ratchet/installed-skills.json'))
            require_strict_ssh_config(command(['ssh', '-G', config['host']]))
    stem = params['head'] + '-' + params['stamp']
    initial = home / '.golems/m1-sync' / stem
    saved = initial.with_name('.procedure-' + stem)
    lock = home / '.golems/m1-procedure.lock'
    plain_parents(home, FIXED + ['.golems/m1-sync/' + stem, '.golems/m1-procedure.lock'])
    need(not present(home / '.golems/m1-sync') or not (home / '.golems/m1-sync').is_symlink(), 'symlinked staging parent')
    if mode in ('preflight', 'snapshot', 'presync'):
        real_directories(home, params)
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
        config = ns['load_config'](str(home / '.golems/ratchet/installed-skills.json'))
        ns['validate'](json.loads(Path(config['requirements']).read_text()), required=True)
        return {'verdict': 'PREFLIGHT_READY', 'before': capture(home, ns), 'known_hosts': trust_file(home)}
    if mode == 'snapshot':
        need(not present(lock) and not present(initial) and not present(saved), 'concurrent/reused run')
        lock.mkdir(mode=0o700)
        initial.mkdir(mode=0o700, parents=True)
        before = capture(home, ns)
        state = {'started': utc(), 'before': before, 'paths': mutable(home),
            'receipt_parents': {p: present(home / p) for p in ('.local/state/golems', '.local/state/golems/install-receipts')},
            'existing_skill_backups': sorted(str(p) for p in (home / '.claude').glob('skills.bak-*'))}
        archive_path = initial / 'pre-snapshot.tgz'
        with tarfile.open(archive_path, 'x:gz', dereference=False) as archive:
            for relative in state['paths']:
                if present(home / relative): archive.add(home / relative, arcname=relative)
        with tarfile.open(archive_path) as archive:
            for member in archive.getmembers():
                need(member.uid == os.getuid() and member.gid in set(os.getgroups()) | {os.getgid()}, 'snapshot ownership cannot be restored without privilege: ' + member.name)
        state['archive_sha256'] = sha(archive_path.read_bytes())
        (initial / 'current-target.txt').write_text(before['current'] + '\n')
        (initial / 'pre-snapshot.sha256').write_text(state['archive_sha256'] + '  pre-snapshot.tgz\n')
        (initial / 'state.json').write_text(json.dumps(state, sort_keys=True))
        need(capture(home, ns) == before, 'pre-state changed while snapshot was written')
        # Never impersonate a successful sync attempt with a fabricated success.json.
        initial.rename(saved)
        return {'snapshot': str(saved / 'pre-snapshot.tgz'), 'original_path': str(archive_path),
                'sha256': state['archive_sha256'], 'before': before}
    need(saved.is_dir() and not saved.is_symlink(), 'complete snapshot custody directory missing')
    state = json.loads((saved / 'state.json').read_text())
    before = state['before']
    if mode == 'presync':
        return {'verdict': 'REAL_DIRECTORIES_VERIFIED_BEFORE_SYNC'}
    if mode == 'receipt':
        return json.loads((home / '.local/state/golems/install-receipts/golems/latest-skills-sync-release-channel.json').read_text())
    if mode == 'post':
        after = capture(home, ns)
        need(after['protected'] == before['protected'], 'OUTSIDE SCOPE: STOP; protected state changed')
        need(after['config_sha256'] == before['config_sha256'], 'config.toml changed')
        diffs = {}
        for path, old in before['configs'].items():
            new = after['configs'][path]
            changes = json_diff(old['json'], new['json'])
            need(all(p and p[0] == 'hooks' for p in changes), 'non-hooks JSON change: ' + path + ' ' + repr(changes))
            need(not old['exists'] or new['exists'], 'shared config removed: ' + path)
            diffs[path] = changes
        unchanged = verify_roots(before, after, home, params)
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
            need(trust_file(home) == params['m1_trust_before'], 'STOP: M1 Pro known_hosts changed')
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
                    need(identity(path) == original_id, 'move source changed: ' + relative)
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
                for member in members:
                    restored_path = staging / member.name
                    os.chown(restored_path, member.uid, member.gid, follow_symlinks=False)
                    if restored_path.is_symlink():
                        if hasattr(os, 'lchmod'): os.lchmod(restored_path, member.mode)
                        else: need(stat.S_IMODE(restored_path.lstat().st_mode) == member.mode, 'cannot restore symlink mode')
                    else: os.chmod(restored_path, member.mode)
                    if restored_path.is_file() and not restored_path.is_symlink():
                        with restored_path.open('rb') as restored_file: os.fsync(restored_file.fileno())
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
                    need(tree(extracted, False) == expected, 'extracted path changed: ' + relative)
                    need(path.parent.is_dir() and not path.parent.is_symlink(), 'restore parent missing/unsafe')
                    move_restore(extracted, path)
                else:
                    # Covers interruption after restoring a path but before its checkpoint.
                    need(tree(path, False) == expected, 'ambiguous restore move; STOP: ' + relative)
                journal['restored'].append(relative)
                checkpoint(saved, journal)
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
            restored = capture(home, ns)
            verify_roots(before, restored, home, params, restore=True)
            need(restored['current'] == old_target, 'rollback current mismatch')
            need(restored['configs'] == before['configs'] and restored['mutable'] == before['mutable'], 'rollback footprint mismatch')
            need(restored['protected'] == before['protected'], 'OUTSIDE SCOPE: STOP; rollback cannot repair protected state')
            owner = subprocess.run(['node', str(source / 'scripts/hooks/install-hooks.mjs'), '--host', 'client', '--source', str(source), '--status'], capture_output=True, text=True)
            out, err, previous_argv = io.StringIO(), io.StringIO(), sys.argv
            try:
                sys.argv = ['installed-skills.py']
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    parity_exit = ns['main']()
            finally: sys.argv = previous_argv
            result = {'verdict': 'ROLLBACK_RESTORED_NOT_GREEN', 'mutated': ROLLBACK['mutated'], 'restored': restored,
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
            need(final_checks['receipt_id'] == params['accepted_receipt_id'], 'receipt changed after acceptance')
        need(lock.is_dir() and not lock.is_symlink(), 'procedure lock missing')
        lock.rename(saved / 'procedure-lock-completed')
        return {'verdict': 'COMPLETE', 'snapshot': str(saved / 'pre-snapshot.tgz'), 'final_checks': final_checks}
    raise ValueError('unknown mode')

if 'PARAMS' in globals():
    try:
        result = remote(PARAMS, MODE)
        if MODE == 'rollback':
            evidence(ROLLBACK['saved'] / ('rollback-attempt-' + str(PARAMS['rollback_attempt']) + '.json'), result)
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        if MODE == 'rollback':
            result = {'verdict': 'ROLLBACK_PARTIAL_NOT_GREEN', 'mutated': ROLLBACK['mutated'],
                      'phase': ROLLBACK['phase'], 'error': type(error).__name__ + ': ' + str(error)}
            if ROLLBACK['saved'] is not None:
                evidence(ROLLBACK['saved'] / ('rollback-attempt-' + str(PARAMS['rollback_attempt']) + '.json'), result)
            print(json.dumps(result, sort_keys=True))
        sys.exit(1)
else:
    try:
        run = Path(os.environ['RUN'])
        params = {'head': os.environ['MERGE_SHA'], 'stamp': os.environ['UTC_TS'], 'version': os.environ['VERSION']}
        params['frozen_source'] = (run / 'frozen-i5.py').read_text()
        params['bootstrap'] = json.loads((run / 'bootstrap-config.json').read_text()) if (run / 'bootstrap-config.json').exists() else None
        if params['bootstrap']:
            os.environ['M1_TRANSPORT_DIR'] = params['bootstrap']['transport_dir']
            os.environ['PATH'] = str(run / 'bin') + os.pathsep + os.environ['PATH']
            require_strict_ssh_config((run / 'm4-ssh-effective.txt').read_text())
            if sys.argv[1] != 'rollback':
                need(trust_file(Path.home()) == json.loads((run / 'm4-trust-initial.json').read_text()), 'STOP: M4 Max known_hosts changed')
            if sys.argv[1] != 'preflight':
                params['m1_trust_before'] = json.loads((run / 'preflight.json').read_text())['known_hosts']
        release = run / 'release-preflight' / ('golems-' + params['version'] + '.tar.gz')
        with tarfile.open(release) as archive:
            def document(name): return json.loads(archive.extractfile(name).read())
            params.update(catalog=document('skills/catalog.json'), vendor=document('skills/vendor/manifest.json'),
                manifest=document('MANIFEST.json'))
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
            evidence_stem = mode
            need(not present(run / (mode + '.json')) and not present(run / (mode + '.stderr')), 'mode already attempted; retain its evidence and STOP')
        # The M4 Max is also an SSH initiator; retain and compare its trust/config bytes.
        m4_paths = [Path.home() / '.ssh/known_hosts', Path.home() / '.codex/config.toml']
        need(mode == 'rollback' or not any(p.is_symlink() for p in m4_paths), 'protected M4 Max file is symlinked; re-audit')
        m4_now = {str(p): tree(p, False) for p in m4_paths}
        m4_file = run / 'm4-protected-before.json'
        if mode == 'preflight':
            with m4_file.open('x') as output: json.dump(m4_now, output, sort_keys=True)
        elif mode != 'rollback':
            need(m4_now == json.loads(m4_file.read_text()), 'OUTSIDE SCOPE: STOP; M4 Max trust/config changed')
        need(mode in ('preflight', 'transport', 'snapshot', 'presync', 'receipt', 'post', 'rollback', 'finish'), 'invalid mode')
        identity_file = run / 'expected-m1-identity.json'
        if mode == 'preflight':
            identity_ns = {'__name__': 'procedure_identity', '__file__': str(release),
                           'RELEASE_SHIPPING_POLICY': params['policy']}
            exec(compile(params['i5_source'], str(release), 'exec'), identity_ns)
            config = identity_ns['load_config'](str(Path.home() / '.golems/ratchet/installed-skills.json'))
            requirements = json.loads(Path(config['requirements']).read_text())
            identity_ns['validate'](requirements, required=True)
            need(identity_ns['observed_identity']() == requirements['identities'][0], 'wrong M4 Max identity')
            evidence(identity_file, requirements['identities'][1])
        params['expected_m1_identity'] = json.loads(identity_file.read_text())
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
            (run / (mode + '.stderr')).write_text(result.stderr)
            with (run / (mode + '.json')).open('x') as output: output.write(result.stdout)
        if params['bootstrap']:
            need(trust_file(Path.home()) == json.loads((run / 'm4-trust-initial.json').read_text()), 'STOP: M4 Max known_hosts changed')
        need(m4_after == json.loads(m4_file.read_text()), 'OUTSIDE SCOPE: STOP; M4 Max trust/config changed')
        need(result.returncode == 0, mode + ' failed; retain ' + str(run / (evidence_stem + '.stderr')))
        json.loads(result.stdout)
        print(mode + ': recorded ' + str(run / (evidence_stem + '.json')))
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(1)
PY
python3 -I -B "$RUN/m1-control.py" preflight
if [ "$PROC_MODE" = bootstrap-run-1 ]; then
python3 -I -B "$RUN/m1-control.py" transport
fi
```

Preflight pins the M1 Pro machine/hostname/HOME identity from the M4 Max's existing private parity requirements, checks the M4 Max identity, and verifies that pinned M1 Pro identity before every remote mode, including recovery. It validates the existing on-M1 Pro parity configuration and requirements without creating them. Prior research found the default M1 Pro config absent; that remains a prerequisite failure unless separately resolved.

Before preflight, snapshot, and immediately before sync, `real_directories()` requires every existing footprint directory and its ancestors through HOME to be real directories. This includes `.golems`, `vendor`, `vendor/design-skills`, existing vendor descendants, target release parents, bin, client roots/hooks, staging, and receipt parents. Any symlink stops before snapshot/sync mutation.

The protected scan reads full file contents under `/Applications`, LaunchAgents, Homebrew, and known/discovered BrainLayer paths. It also records the complete `launchctl print gui/$(id -u)` output (including the full service list), `launchctl print-disabled gui/$(id -u)`, `ls -la "$HOME/Library/LaunchAgents"`, SHA256 of each user plist, and BrainLayer process/socket state. These outputs are compared exactly before/after, including finish and rollback; ANY difference triggers rollback and STOP, including a non-BrainLayer job or disabled override. No changing fields are normalized away. Read errors, unsupported entries, or concurrent changes STOP. These scans can be slow. Do not truncate them, exclude a changing DB/log, or stop a daemon to obtain a pass. The scan cannot attribute a difference to this install; even an unrelated change conservatively stops acceptance.

The full tar includes the five roots, wrappers, vendor tree, hooks, shared hook configs, activation/history files, receipts, and hook-config sidecars. Links are stored without dereference. Old release bytes remain retained by `--preserve-releases`. Existing skills backups are immutable; the helper exclusively creates a new archive. The previous `current` target is also recorded as text.

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
    print(root, 'pre=' + snapshot['before']['roots'][root]['tree_sha256'],
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

Triggers: **any nonzero step after snapshot starts; any failed post-check; any §7b change; missing/stale/invalid/unavailable/non-LIVE receipt; failed real parity; or any deviation from the written commands.** Before snapshot, stop without installing. If snapshot capture fails, no sync runs; retain partial snapshot/lock and report unavailable complete rollback custody.

The ERR/INT/TERM handlers invoke the exact controller `rollback` command once. Each invocation reserves `rollback-attempt-<N>.json/.stderr` on the M4 Max and retains a numbered remote result. `mutated=false` means no restoration mutation, including a writer-active refusal; evidence writes are excluded. `mutated=true` conservatively means restoration may have mutated paths. A transport failure without a complete remote result records `mutated=null` (unknown), never false. It verifies snapshot SHA256, refuses an active remote writer, and acquires a process-scoped rollback guard. It persists a move plan before creating quarantine, checkpoints each completed quarantine move, extracts into a fresh numbered staging tree, checkpoints completed extraction, then checkpoints each move from staging to its original path, including the recorded `current` link. Interrupted extractions remain retained; the next attempt uses a fresh staging tree. Rename/checkpoint gaps are reconciled using the planned inode identity or exact restored tree; ambiguous state stops. Original absence is restored: newly introduced root children and sidecars remain quarantined instead of surviving a tar overlay. New receipt events, backups, vendor copies, and failed hook/temp objects are preserved in quarantine. Old/new releases and helper stages remain retained. Nothing is deleted by the rollback commands.

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

## 7. Footprint (all writes, in scope under ruling 3)

M1 Pro paths below are relative to that machine's `Path.home()`. O01–O12 are the same path families as the inventory, all **IN-SCOPE** under ruling 3.

| ID | Write family | Purpose |
|---|---|---|
| O01 | `.claude/skills.bak-HEAD-UTC.tgz` | Built-in five-root backup. |
| O02 | `.golems/m1-sync/**`, `.golems/m1-procedure.lock` | Stages, snapshot, custody rename, quarantine, numbered rollback attempts/extraction trees/checkpoints, and lock evidence. |
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

Five roots: `.claude/skills`, `.agents/skills`, `.codex/skills`, `.cursor/skills`, `.gemini/config/skills`. M4 Max writes include this run's `docs.local/ratchet-runs/` evidence and run log, plus the standard live-rows producer effects explicitly enumerated in §7c. GitHub reads/downloads and that producer's sticky-comment publication are in scope. Existing authorization, parity configs, identities, signing key/anchor, and SSH trust are read-only prerequisites.

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

PROCEDURE_READY r4h (pending the Codex delta re-check)
