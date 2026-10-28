# Worktree launch guard

Use this before a new worktree launch. Root and scratch launches are independent.
This is local verification, not remote freshness: run on the **target host**, against
its actual project root. Local refs on one Mac never prove refs on another.

## Preflight

Run `node skills/golem-powers/agent-routing/scripts/launch-guard.mjs preflight`
with a JSON object on stdin: `{root,cwd?,baseRef?,startFromOrigin?}`. Check exit 0
and `ok:true` before launching. Preserve the secret-free receipt outside the checkout.
Omit `baseRef` for the verified `origin/HEAD` symbolic target. An explicit ref must
resolve exactly; missing/ambiguous refs, detached/non-Git roots fail closed. There is
no main/master fallback. All Git calls are argv arrays; the helper never fetches,
creates a worktree, invokes hooks/config helpers, or launches anything.

When remote freshness matters, fetch the intended remote ref on the target host
before preflight, verify its fetched OID, and record the ref, OID and fetch timestamp
in the external launch receipt. Preflight still reports `remoteFreshness: NOT_CHECKED`;
local resolution alone never certifies freshness. Refreshing a remote ref does not
update the parent's committed HEAD used by a delegate.

`startFromOrigin:true` fails with `REMOTE_FRESHNESS_UNVERIFIED`, even when local
resolution succeeds. If remote freshness is required, an authorized actor fetches
on that host outside this helper, then explicitly chooses the verified commit and
`startFromOrigin:false`. Do not silently change that intent. For pinned local intent,
pass `receipt.commit` as `workspaceStrategy.baseRef` and `startFromOrigin:false`;
keep the original ref/root/cwd receipt. For a non-T3 manual launch, use an argv-based
Git caller with that OID; lifecycle authorization still precedes creation.

`delegate_task` with `isolation:"worktree"` starts from the parent's committed HEAD,
not the project default. Preflight that explicit parent OID, record it, and verify
the child's actual HEAD on entry. It exposes no baseRef override; do not pretend a
default-ref receipt validates its allocation base. Terminal delegate failures reach
the parent through native completion. Follow the delegate's `next`; never poll.

## Exactly one read after a worktree t3_thread_launch

Use the live T3 API, not an invented MCP CLI or auth wrapper. After a user-authorized
new top-level worktree launch, retain returned threadId/runId, then execute exactly
ONE read (same `environmentId` for remote targets), interpret that actual JSON once:

```js
// unwrap/checkPreparationOnce imported from agent-routing/scripts/launch-guard.mjs in the host runtime.
if (!receipt.ok) throw new Error(JSON.stringify(receipt));
const launched = unwrap(await tools.mcp__t3_code__t3_thread_launch({
  ...launchArgs, workspaceStrategy: {
    ...launchArgs.workspaceStrategy, type: "worktree", baseRef: receipt.commit, startFromOrigin: false,
  },
}));
const verdict = await checkPreparationOnce(async readArgs => await tools.mcp__t3_code__t3_thread_read({
  ...readArgs, ...(launchArgs.environmentId ? { environmentId: launchArgs.environmentId } : {}),
}), {
  threadId: launched.threadId, runId: launched.runId,
  baseRef: receipt.baseRef ?? receipt.resolvedRef, root: receipt.root,
});
if (verdict.status === "ERROR") throw new Error(JSON.stringify(verdict));
// PENDING: report explicitly and stop; READY means preparation passed, not task completion.
return verdict;
```

Where imports are unavailable in code mode, save that result JSON and context through
the host's structured file API, then feed `{result,context}` to the helper's
`preparation` command on stdin. Exit 1 = ERROR, 2 = PENDING, 0 = READY. Do not
interpolate JSON into a shell command. No second read, status poll, watcher or model
retry. A read transport error is ERROR. Launch acceptance alone is never success.
Only run/workspace fields and the matching server preparation command are inspected;
quoted failure strings in user/assistant messages or ordinary commands are ignored.

## t3-mixed-harness integration

The prototype is a Workflow pipeline, not an installed skill. Keep stage ordering,
parallel agents within a stage, rendered prior outputs, schema results and skip-later
failure semantics. Its `delegate_task`/isolation path uses the explicit parent-OID
preflight above; do not replace it with top-level thread launches. Scope its “never
any other tool” rule to disallow retries/polls, while permitting required preflight
and a one-read check only if a separate authorized top-level worktree launch exists.
No proxy execution is needed to adopt this source recipe. Parent owns the active
private mirror; committed generic source is this recipe and `launch-guard.mjs`.
Run that preflight in the proxy's actual T3 parent context before its single
delegation. If its parent identity, shell or helper is unavailable, fail closed;
a receipt for an outer workflow or another host does not validate this allocation.
