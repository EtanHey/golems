import { test, expect, setDefaultTimeout } from "bun:test";
// Each test runs the real CLI many times; a loaded Mac needs more than bun's 5 s default.
setDefaultTimeout(60_000);
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const cli = resolve(import.meta.dir, "../pr-sentinel/pr-sentinel");
const head = "a".repeat(40), old = "2020-01-01T00:00:00Z", newer = "2020-01-02T00:00:00Z";
const url = n => `https://github.com/fixture/repo/pull/${n}`;
const pr = (number, changes = {}) => ({ number, url: url(number), state: "OPEN", headRefOid: head, isDraft: false,
  mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", repository: { nameWithOwner: "fixture/repo", viewerPermission: "ADMIN" },
  author: { login: "fixture" }, comments: { nodes: [] }, commits: { nodes: [{ commit: {
    committedDate: old, statusCheckRollup: { contexts: { pageInfo: {}, nodes: [] } },
  } }] }, ...changes });
const check = (p, nodes) => { p.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = nodes; return p; };
const thread = (id, numbers, changes = {}) => ({ threadId: id, updatedAt: newer, parentThreadId: null,
  settled: false, pullRequests: numbers.map(n => ({ url: url(n), state: "open" })), ...changes });
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "pr-sentinel-")), bin = join(root, "bin"); mkdirSync(bin);
  const files = Object.fromEntries(["prs", "threads", "show", "sends", "state", "config", "calls"].map(k => [k, join(root, k + ".json")]));
  for (const name of ["gh", "t3"]) writeFileSync(join(bin, name), `#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
r=Path(os.environ['FIXTURE'])
with (r/'calls.json').open('a') as f: f.write(json.dumps(sys.argv)+'\\n')
if (r/'fail-${name}').exists(): sys.exit(1)
if '${name}'=='gh' and sys.argv[1]=='pr':
 if (r/'fail-update').exists(): sys.exit(1)
 print('updated'); sys.exit(0)
if '${name}'=='gh' and not any(a.startswith('count=') for a in sys.argv):
 import re
 q=next(a.split('=',1)[1] for a in sys.argv if a.startswith('query='))
 nodes={p['url'].lower(): p for p in json.loads((r/'prs.json').read_text())}
 data={}
 for alias,owner,name,num in re.findall(r'(p\\d+): repository\\(owner: "([^"]+)", name: "([^"]+)"\\) \\{ pullRequest\\(number: (\\d+)\\)',q):
  u=f'https://github.com/{owner}/{name}/pull/{num}'.lower()
  data[alias]={'pullRequest':nodes.get(u)}
 print(json.dumps({'data':data})); sys.exit(0)
if '${name}'=='gh':
 nodes=json.loads((r/'prs.json').read_text())
 count=int(next(a.split('=',1)[1] for a in sys.argv if a.startswith('count='))); start=int(next((a.split('=',1)[1] for a in sys.argv if a.startswith('cursor=')),0))
 print(json.dumps({'data':{'search':{'nodes':nodes[start:start+count],'pageInfo':{'hasNextPage':start+count<len(nodes),'endCursor':str(start+count)}}}}))
elif sys.argv[2]=='list': print((r/'threads.json').read_text())
elif sys.argv[2]=='show': print((r/'show.json').read_text())
else:
 with (r/'sends.json').open('a') as f: f.write(json.dumps({'target':sys.argv[3],'message':sys.stdin.read()})+'\\n')
`, { mode: 0o755 });
  const write = (key, data) => writeFileSync(files[key], JSON.stringify(data));
  write("prs", []); write("threads", []); write("config", { queries: ["fixture"], projects: ["/fixture"], escalate_thread: "orc", grace_minutes: 45, held_stale_hours: 72 }); chmodSync(files.config, 0o600);
  const run = (...extra) => Bun.spawnSync([cli, "scan", "--config", files.config, "--state", files.state, ...extra], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE: root } });
  const age = seconds => { const s = JSON.parse(readFileSync(files.state)); for (const row of Object.values(s)) row.since -= seconds; write("state", s); };
  const lead = (...extra) => Bun.spawnSync([cli, "lead", "--thread", "lead-1", "--state", files.state, ...extra], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE: root } });
  const calls = () => existsSync(files.calls) ? readFileSync(files.calls, "utf8") : "";
  const sends = () => existsSync(files.sends) ? readFileSync(files.sends, "utf8").trim().split("\n").map(JSON.parse) : [];
  try { fn({ root, files, write, run, lead, calls, age, sends }); } finally { rmSync(root, { recursive: true, force: true }); }
}
test("classes, held freshness, cancelled success, owner selection and batching", () => fixture(({ write, run, age, sends }) => {
  const failure = { name: "build\ninjected", status: "COMPLETED", conclusion: "FAILURE", completedAt: old };
  const red = n => check(pr(n), [failure]);
  write("prs", [pr(1, { isDraft: true }), pr(2, { mergeable: "CONFLICTING" }), red(3), check(pr(4), [{ name: "build", status: "QUEUED" }]), pr(5), pr(6, { mergeStateStatus: "BLOCKED" }),
    pr(7, { comments: { nodes: [{ body: "<!-- pr-sentinel:held -->", createdAt: newer }] } }),
    red(8), check(pr(9), [{ ...failure, conclusion: "CANCELLED" }, { ...failure, conclusion: "SUCCESS", completedAt: newer }]),
    pr(10, { comments: { nodes: [{ body: "**Held on purpose** because...", createdAt: newer }] } }),
    pr(11, { comments: { nodes: [{ body: "<!-- pr-sentinel:held -->", createdAt: "2019-01-01T00:00:00Z" }] } })]);
  write("threads", [thread("old-owner", [2], { updatedAt: old }), thread("live", [2, 5, 9], { status: "completed" }), thread("settled", [3], { settled: true }), thread("child", [8], { parentThreadId: "parent" }), thread("archived", [11], { archivedAt: newer })]);
  const first = run(); expect(first.exitCode, first.stderr.toString()).toBe(0);
  for (const text of ["#1 UNLINKED HELD", "#2 LIVE CONFLICT", "#3 ORPHAN RED", "#4 UNLINKED PENDING", "#5 LIVE GREEN", "#6 UNLINKED OTHER", "#7 UNLINKED HELD", "#8 ORPHAN RED", "#9 LIVE GREEN", "#10 UNLINKED HELD", "#11 ORPHAN GREEN"]) expect(first.stdout.toString()).toContain(text);
  expect(sends()).toHaveLength(0); age(46 * 60); expect(run().exitCode).toBe(0);
  // Live owners run their own `lead` check; the sweep messages orc about the rest only.
  expect(sends().map(s => s.target)).toEqual(["orc"]); expect(sends()[0].message.trim().split("\n")).toHaveLength(3);
  expect(sends().find(s => s.target === "orc").message).toContain("Previously linked thread: settled");
  run(); expect(sends()).toHaveLength(1);
}));
test("failure recovery, dry-run immutability, head/class dedupe and stale holds", () => fixture(({ root, files, write, run, age, sends }) => {
  write("prs", [pr(1)]); run(); age(3600);
  const before = readFileSync(files.state, "utf8"); const dry = run("--dry-run"); expect(dry.stdout.toString()).toContain("WOULD SEND to orc"); expect(readFileSync(files.state, "utf8")).toBe(before); expect(sends()).toHaveLength(0);
  writeFileSync(join(root, "fail-t3"), ""); expect(run().exitCode).toBe(0); expect(readFileSync(files.state, "utf8")).toBe(before);
  rmSync(join(root, "fail-t3")); run(); expect(sends()).toHaveLength(1); run(); expect(sends()).toHaveLength(1);
  write("prs", [pr(1, { isDraft: true })]); run(); age(73 * 3600); run(); expect(sends().at(-1).message).toContain("stale hold"); run(); expect(sends()).toHaveLength(2);
  write("prs", [pr(1)]); run(); age(3600); run(); expect(sends()).toHaveLength(2);
  write("prs", [pr(1, { headRefOid: "b".repeat(40) })]); run(); age(3600);
  writeFileSync(join(root, "fail-gh"), ""); expect(run().exitCode).toBe(0); expect(sends()).toHaveLength(2); rmSync(join(root, "fail-gh")); run(); expect(sends()).toHaveLength(3);
}));
test("send failures retry, zero-grace unlinked delivery, invalid config and fresh dry-run", () => fixture(({ root, files, write, run, sends }) => {
  const cfg = JSON.parse(readFileSync(files.config)); cfg.grace_minutes = 0; write("config", cfg);
  write("prs", [pr(1), pr(2)]); run("--dry-run"); expect(existsSync(files.state)).toBe(false);
  // List succeeds; send alone fails, so the pending batch must survive.
  const t3 = join(root, "bin/t3"); writeFileSync(t3, readFileSync(t3, "utf8").replace("else:\n with", "else:\n if (r/'fail-send').exists(): sys.exit(1)\n with"));
  writeFileSync(join(root, "fail-send"), ""); expect(run().exitCode).toBe(0); expect(sends()).toHaveLength(0); rmSync(join(root, "fail-send")); run(); expect(sends()).toHaveLength(1); expect(sends()[0].message).toContain("No thread links it"); run(); expect(sends()).toHaveLength(1);
  chmodSync(files.config, 0o644); expect(run().exitCode).toBe(1);
}));
test("search pagination, dedupe across queries and 300-result cap", () => fixture(({ files, write, run, sends }) => {
  const cfg = JSON.parse(readFileSync(files.config)); cfg.queries = ["one", "two"]; write("config", cfg);
  write("prs", Array.from({ length: 26 }, (_, i) => pr(i + 1))); expect(run().exitCode).toBe(0);
  expect(Object.keys(JSON.parse(readFileSync(files.state)))).toHaveLength(26);
  write("prs", Array.from({ length: 301 }, (_, i) => pr(i + 1))); const capped = run(); expect(capped.exitCode).toBe(0); expect(capped.stderr.toString()).toContain("truncated at 300");
  expect(Object.keys(JSON.parse(readFileSync(files.state)))).toHaveLength(300); expect(sends()).toHaveLength(0);
}));
test("all red conclusions and cancellation-only are red; later success clears failure", () => fixture(({ write, run }) => {
  const fail = (n, conclusion) => check(pr(n), [{ name: "build", status: "COMPLETED", conclusion, completedAt: old }]);
  write("prs", ["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "CANCELLED"].map((c, i) => fail(i + 1, c)).concat([check(pr(7), [{ name: "build", status: "COMPLETED", conclusion: "FAILURE", completedAt: old }, { name: "build", status: "COMPLETED", conclusion: "SUCCESS", completedAt: newer }])]));
  const out = run().stdout.toString(); for (let n = 1; n <= 6; n++) expect(out).toContain(`#${n} UNLINKED RED`); expect(out).toContain("#7 UNLINKED GREEN");
}));
test("lock excludes overlapping scans before any CLI calls", () => fixture(({ files }) => {
  const code = "import fcntl,subprocess,sys; f=open(sys.argv[1],'w'); fcntl.flock(f,fcntl.LOCK_EX); r=subprocess.run(sys.argv[2:],capture_output=True,text=True); print(r.stderr); sys.exit(r.returncode)";
  const r = Bun.spawnSync(["python3", "-c", code, files.state.replace(/\.json$/, ".lock"), cli, "scan", "--config", files.config, "--state", files.state]);
  expect(r.exitCode).toBe(0); expect(r.stdout.toString()).toContain("another scan is running"); expect(existsSync(files.calls)).toBe(false);
}));

test("a green PR we cannot merge (upstream) is not actionable", () => fixture(({ write, run, age, sends }) => {
  write("prs", [pr(1, { repository: { nameWithOwner: "upstream/repo", viewerPermission: "READ" } }),
    pr(2, { repository: { nameWithOwner: "upstream/repo" } }), pr(3)]);
  write("threads", []);
  const out = run().stdout.toString();
  expect(out).toContain("#1 UNLINKED OTHER"); expect(out).toContain("waiting on the maintainers");
  expect(out).toContain("#2 UNLINKED OTHER"); expect(out).toContain("#3 UNLINKED GREEN");
  age(46 * 60); run(); expect(sends()).toHaveLength(1);
  expect(sends()[0].message).toContain("#3"); expect(sends()[0].message).not.toContain("upstream/repo");
}));

test("lead check: updates BEHIND branches silently, messages the lead only for decisions", () => fixture(({ write, lead, calls, age, sends }) => {
  const failure = { name: "build", status: "COMPLETED", conclusion: "FAILURE", completedAt: old };
  write("show", { thread: { threadId: "lead-1", pullRequests: [1, 2, 3, 4, 5, 6, 7].map(n => ({ url: url(n), state: "open" })).concat([{ url: url(8), state: "merged" }]) } });
  write("prs", [check(pr(1), [failure]), pr(2), pr(3, { mergeStateStatus: "BEHIND", viewerCanUpdateBranch: true }),
    pr(4, { reviewDecision: "CHANGES_REQUESTED" }), pr(5, { isDraft: true }), pr(6, { viewerCanUpdateBranch: true }),
    pr(7, { state: "MERGED" }), pr(8), pr(9)]);
  const dry = lead("--dry-run"); expect(dry.exitCode, dry.stderr.toString()).toBe(0); expect(calls()).not.toContain("update-branch");
  const first = lead(); expect(first.exitCode, first.stderr.toString()).toBe(0);
  expect(calls()).toContain(`update-branch", "${url(3)}`); expect(calls()).not.toContain(url(6) + '"]');
  expect(sends()).toHaveLength(0); age(11 * 60); lead();
  expect(sends()).toHaveLength(1); const m = sends()[0];
  expect(m.target).toBe("lead-1");
  for (const text of ["#1 is RED", "#2 is GREEN", "merge it under your lane", "#4 is REVIEW", "#6 is GREEN"]) expect(m.message).toContain(text);
  for (const text of ["#3 ", "#5 ", "#7 ", "#8 ", "#9 "]) expect(m.message).not.toContain(text);
  lead(); expect(sends()).toHaveLength(1);
  write("show", { thread: { threadId: "lead-1", pullRequests: [] } }); expect(lead().stdout.toString()).toContain("no open PRs");
}));

test("lead check: a rejected update-branch never holds back the other PRs; empty list prunes state", () => fixture(({ root, files, write, lead, sends }) => {
  write("show", { thread: { threadId: "lead-1", pullRequests: [1, 2].map(n => ({ url: url(n), state: "open" })) } });
  write("prs", [pr(1, { mergeStateStatus: "BEHIND", viewerCanUpdateBranch: true }), pr(2)]);
  writeFileSync(join(root, "fail-update"), "");
  const out = lead("--grace-minutes", "0"); expect(out.exitCode).toBe(0); expect(out.stderr.toString()).toContain("update-branch failed");
  expect(sends()).toHaveLength(1); expect(sends()[0].message).toContain("#2 is GREEN"); expect(sends()[0].message).not.toContain("#1 ");
  expect(Object.keys(JSON.parse(readFileSync(files.state)))).toHaveLength(1);
  write("show", { thread: { threadId: "lead-1", pullRequests: [] } }); lead();
  expect(JSON.parse(readFileSync(files.state))).toEqual({});
}));
test("lead check fetches its PRs by number, so a capped repo search cannot hide one", () => fixture(({ write, lead, calls, sends }) => {
  write("show", { thread: { threadId: "lead-1", pullRequests: [{ url: url(500), state: "open" }] } });
  write("prs", Array.from({ length: 500 }, (_, i) => pr(i + 1)));
  const out = lead("--grace-minutes", "0"); expect(out.exitCode, out.stderr.toString()).toBe(0);
  expect(sends()).toHaveLength(1); expect(sends()[0].message).toContain("#500 is GREEN");
  expect(calls()).not.toContain("count=");
}));
