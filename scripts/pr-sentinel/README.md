# PR sentinel

A no-model safety net for PRs whose lead stopped acting or no longer owns a watch.
T3 watch delivery remains the immediate signal; the sentinel nudges only after a grace period.
Copy `config.example.json` to `~/.config/golems/pr-sentinel.json`, fill in project paths and
an escalation thread, and `chmod 600` it. Keep real configuration outside this public repo.

Run `scripts/pr-sentinel/pr-sentinel scan --dry-run` to inspect inventory and proposed batches;
`status` prints recorded state. Both accept `--state PATH`; scan also accepts `--config PATH`.
Dry-run creates only the coordination lock, never delivery state or messages. First observation
starts the grace clock. Pending sends retry on the next scheduled scan. New heads/classes reset
that clock; sent receipts prevent repeats even if a class returns. HELD reminders are once per head.
The 300-result search cap and 100-check-context limit are conservative bounds: incomplete check
inventory aborts the scan. Transport failures are logged; undelivered batches remain eligible for retry.

`launchd/install.sh` installs the 10-minute job and prepares its log directory. Configure it first.
Installation and real delivery require separate acceptance; dry-run does not prove wake delivery.
A crash between a successful send and receipt persistence may repeat a batch on the next scan.

## Scope it before installing

The default queries match every open PR you have ever opened, including years-old side projects
and PRs in other organizations. A first dry-run found 79 PRs and drafted 61 messages. Before
installing:

- **Scope `queries` to the repos the fleet works on**, e.g.
  `is:pr is:open repo:OWNER/a repo:OWNER/b` (several `repo:` qualifiers are OR'd), plus
  `is:pr is:open author:YOUR_LOGIN repo:UPSTREAM/x` for upstream PRs you track.
- **Upstream green PRs never fire.** GREEN needs WRITE, MAINTAIN or ADMIN on the repo; without it
  a green PR is OTHER ("waiting on the maintainers"). Red and conflicting upstream PRs still fire.
- **`projects` must match T3's workspace roots exactly**, including case
  (`t3 project` lists them). A wrong path fails with "No T3 Code project matches".
- **Only this Mac's T3 threads are visible.** A PR owned by a thread on another machine looks
  UNLINKED and goes to the escalation thread.
