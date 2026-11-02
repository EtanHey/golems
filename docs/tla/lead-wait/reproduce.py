"""Replay an ignored live lead with real sentinel functions and fake external commands."""
import importlib.machinery
import importlib.util
from pathlib import Path
import tempfile

root = Path(__file__).resolve().parents[3]
loader = importlib.machinery.SourceFileLoader('sentinel', str(root / 'scripts/pr-sentinel/pr-sentinel'))
spec = importlib.util.spec_from_loader(loader.name, loader)
sentinel = importlib.util.module_from_spec(spec)
loader.exec_module(sentinel)
url = 'https://github.com/fixture/repo/pull/1'
pr = dict(number=1, url=url, state='OPEN', headRefOid='a' * 40, isDraft=False,
          mergeable='MERGEABLE', mergeStateStatus='CLEAN',
          repository=dict(nameWithOwner='fixture/repo', viewerPermission='ADMIN'),
          comments=dict(nodes=[]), commits=dict(nodes=[dict(commit=dict(
              committedDate='2020-01-01T00:00:00Z', statusCheckRollup=None))]))
thread = dict(threadId='fixture-lead', updatedAt='2020-01-02T00:00:00Z',
              parentThreadId=None, settled=False, pullRequests=[dict(url=url, state='open')])
sends = []
def command(argv, message=None):
    if argv[:3] == ['t3', 'thread', 'show']:
        return dict(thread=thread)
    if argv[:3] == ['t3', 'thread', 'list']:
        return [thread]
    if argv[:3] == ['t3', 'thread', 'send']:
        sends.append(argv[3])
        return ''
    if argv[:3] == ['gh', 'api', 'graphql']:
        if any(arg.startswith('count=') for arg in argv):
            return dict(data=dict(search=dict(nodes=[pr], pageInfo=dict(hasNextPage=False))))
        return dict(data=dict(p0=dict(pullRequest=pr)))
    raise AssertionError(argv)
sentinel.command = command
clock = [100000.0]
sentinel.time.time = lambda: clock[0]
cfg = dict(queries=['fixture'], projects=['/fixture'], escalate_thread='fixture-orc',
           grace_minutes=0, held_stale_hours=72)
parent = root / 'docs.local/verify-lead-wait'
parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='repro-', dir=parent) as folder:
    lead_state, scan_state = {}, {}
    for round_number in range(1, 4):
        sentinel.lead('fixture-lead', Path(folder)/'lead.json', lead_state, False, 0)
        sentinel.scan(cfg, Path(folder)/'scan.json', scan_state, False)
        print(f'round={round_number} destinations={sends}')
        clock[0] += 3 * 3600
