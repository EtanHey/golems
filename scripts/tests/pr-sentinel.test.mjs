import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const cli = resolve(import.meta.dir, "../pr-sentinel/pr-sentinel");
const head = "a".repeat(40), old = "2020-01-01T00:00:00Z", newer = "2020-01-02T00:00:00Z";
const url = n => `https://github.com/fixture/repo/pull/${n}`;
const pr = (number, changes = {}) => ({ number, url: url(number), headRefOid: head, isDraft: false,
  mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", repository: { nameWithOwner: "fixture/repo" },
  author: { login: "fixture" }, comments: { nodes: [] }, commits: { nodes: [{ commit: {
    committedDate: old, statusCheckRollup: { contexts: { pageInfo: {}, nodes: [] } },
  } }] }, ...changes });
const check = (p, nodes) => { p.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = nodes; return p; };
const thread = (id, numbers, changes = {}) => ({ threadId: id, updatedAt: newer, parentThreadId: null,
  settled: false, pullRequests: numbers.map(n => ({ url: url(n), state: "open" })), ...changes });
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "pr-sentinel-")), bin = join(root, "bin"); mkdirSync(bin);
  const files = Object.fromEntries(["prs", "threads", "sends", "state", "config", "calls"].map(k => [k, join(root, k + ".json")]));
  for (const name of ["gh", "t3"]) writeFileSync(join(bin, name), `#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
r=Path(os.environ['FIXTURE'])
with (r/'calls.json').open('a') as f: f.write(json.dumps(sys.argv)+'\\n')
if (r/'fail-${name}').exists(): sys.exit(1)
if '${name}'=='gh':
 nodes=json.loads((r/'prs.json').read_text())
 count=int(next(a.split('=',1)[1] for a in sys.argv if a.startswith('count='))); start=int(next((a.split('=',1)[1] for a in sys.argv if a.startswith('cursor=')),0))
 print(json.dumps({'data':{'search':{'nodes':nodes[start:start+count],'pageInfo':{'hasNextPage':start+count<len(nodes),'endCursor':str(start+count)}}}}))
elif sys.argv[2]=='list': print((r/'threads.json').read_text())
else:
 with (r/'sends.json').open('a') as f: f.write(json.dumps({'target':sys.argv[3],'message':sys.stdin.read()})+'\\n')
`, { mode: 0o755 });
  const write = (key, data) => writeFileSync(files[key], JSON.stringify(data));
  write("prs", []); write("threads", []); write("config", { queries: ["fixture"], projects: ["/fixture"], escalate_thread: "orc", grace_minutes: 45, escalate_minutes: 120, held_stale_hours: 72 }); chmodSync(files.config, 0o600);
  const run = (...extra) => Bun.spawnSync([cli, "scan", "--config", files.config, "--state", files.state, ...extra], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE: root } });
  const age = seconds => { const s = JSON.parse(readFileSync(files.state)); for (const row of Object.values(s)) row.since -= seconds; write("state", s); };
  const sends = () => existsSync(files.sends) ? readFileSync(files.sends, "utf8").trim().split("\n").map(JSON.parse) : [];
  try { fn({ root, files, write, run, age, sends }); } finally { rmSync(root, { recursive: true, force: true }); }
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
  expect(sends().map(s => s.target).sort()).toEqual(["live", "orc"]);
  expect(sends().find(s => s.target === "live").message.split("— pr-sentinel")).toHaveLength(4); expect(sends().find(s => s.target === "orc").message.trim().split("\n")).toHaveLength(3);
  expect(sends().find(s => s.target === "orc").message).toContain("Previously linked thread: settled");
  run(); expect(sends()).toHaveLength(2);
}));
test("escalation, failure recovery, dry-run immutability, head/class dedupe and stale holds", () => fixture(({ root, files, write, run, age, sends }) => {
  write("prs", [pr(1)]); write("threads", [thread("live", [1])]); run(); age(3600);
  const before = readFileSync(files.state, "utf8"); const dry = run("--dry-run"); expect(dry.stdout.toString()).toContain("WOULD SEND to live"); expect(readFileSync(files.state, "utf8")).toBe(before); expect(sends()).toHaveLength(0);
  writeFileSync(join(root, "fail-t3"), ""); expect(run().exitCode).toBe(0); expect(readFileSync(files.state, "utf8")).toBe(before);
  rmSync(join(root, "fail-t3")); run(); expect(sends()).toHaveLength(1);
  const s = JSON.parse(readFileSync(files.state)); s[url(1)]["sent"][head + ":GREEN"]["1"] -= 121 * 60; write("state", s); run(); expect(sends().at(-1).target).toBe("orc");
  write("prs", [pr(1, { isDraft: true })]); run(); age(73 * 3600); run(); expect(sends().at(-1).message).toContain("stale hold"); run(); expect(sends()).toHaveLength(3);
  write("prs", [pr(1)]); run(); age(3600); run(); expect(sends()).toHaveLength(3);
  write("prs", [pr(1, { headRefOid: "b".repeat(40) })]); run(); age(3600);
  writeFileSync(join(root, "fail-gh"), ""); expect(run().exitCode).toBe(0); expect(sends()).toHaveLength(3); rmSync(join(root, "fail-gh")); run(); expect(sends()).toHaveLength(4);
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
