// Real jq on raw API pages; wrong gh argv is a fixture failure, not canned green.
import fs from 'node:fs';
import path from 'node:path';
export function ageTree(p) {
  const old = new Date(Date.now() - 13 * 3600000);
  if (fs.lstatSync(p).isDirectory()) for (const n of fs.readdirSync(p)) ageTree(path.join(p, n));
  fs.utimesSync(p, old, old);
}
export function mockGh(bin, data) {
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env python3
import sys, os, subprocess
args=sys.argv[1:]
assert len(args)==5 and args[:2]==['api','--paginate'] and args[2]=='repos/{owner}/{repo}/pulls?state=all&per_page=100' and args[3]=='--jq', args
assert args[4].startswith('.[] | {') and 'headSha' in args[4], args
with open(${JSON.stringify(data)}) as f: raw=f.read()
r=subprocess.run(['jq','-c',args[4]], input=raw, text=True)
sys.exit(r.returncode)
`, { mode: 0o755 });
}
export function rawPR({ number = 1, state = 'closed', merged = true, head = 'worker', base = 'main', headSha }) {
  const repo = { full_name: 'fixture/repo' };
  return { number, state, merged_at: merged ? '2026-01-01T00:00:00Z' : null, head: { ref: head, sha: headSha, repo }, base: { ref: base, repo } };
}
