---
name: deploy-verify
description: "Verify deployed infra after merge/restart. Triggers: PR merged, deployed, daemon/MCP restart, live probe."
disable-model-invocation: true
---

# Skill: Deploy Verify

> A merged PR is not a deployed system. Verify the runtime, or do not claim the deploy is done.

## When to Use

- After any infra PR merges
- When a worker, collab entry, or review comment says "deployed", "restarted", or "now running"
- Before closing a pane, removing a worktree, or telling the user a runtime fix shipped
- For LaunchAgents, daemons, CLI tools, MCP servers, and app bundles whose merged code must be reflected in a live artifact

Infra PRs include:
- LaunchAgent plist changes
- daemon or socket server changes
- CLI binary changes
- MCP server changes
- app bundle or build-stamp changes

## Composition

This skill composes directly with:

- `/never-fabricate`
- `/post-merge-deploy-check`

`/post-merge-deploy-check` proves merged-PR metadata, registry state, bundle provenance, and canonical-path/process drift. This skill is the agent-side workflow that decides when to run that script, what additional runtime checks must be collected, and when "done" is still unverified.

## The Rule

**After an infra PR merges, do not claim deployed until all four verification steps pass.**

Required sequence:

1. process replacement
2. `launchctl print` status
3. build-stamp match
4. end-to-end live probe

If any step fails, the verdict is `NOT DEPLOYED`. Fix the deploy or open a fix PR. Do not narrate success.

## Step 0: Classify the Merge

Before running the sequence, classify the PR:

- `no_deploy_required`: docs, skill-only, or other artifact-free changes
- `deploy_bearing`: LaunchAgent, daemon, CLI, MCP server, app bundle, socket service, or anything that changes live runtime behavior

If the PR is `no_deploy_required`, say so explicitly and stop.

If it is `deploy_bearing`, continue through all four steps.

## The Four-Step Sequence

### 1. Process Replacement

Goal: prove the old runtime exited and a fresh runtime is now the one serving requests.

Required evidence:
- the old PID is gone, replaced, or otherwise no longer the serving process
- the new PID exists when the service is expected to be running
- the running command path does not point at a stale worktree or dev artifact

Acceptable checks:
- `pgrep -alf <process-pattern>`
- `ps -p <pid> -o pid=,ppid=,etime=,command=`
- path checks against known stale-process patterns from the canonical deploy registry

Failure examples:
- old PID still alive after a merge that required restart
- multiple copies of the same app or daemon are serving simultaneously
- process path still resolves into a worktree or `*-DEV-*` app bundle

### 2. LaunchAgent Status

Goal: prove launchd knows about the correct service state.

Required evidence:
- `launchctl print gui/$(id -u)/<service-label>` or equivalent for the relevant domain
- state is consistent with the intended deploy outcome
- `Program` or `ProgramArguments` point at the canonical artifact, not stale paths

Failure examples:
- `Could not find service`
- state still points at the pre-merge path
- launchd reports the job loaded but the artifact path is wrong

### 3. Build-Stamp Match

Goal: prove the artifact serving requests was built from the merged mainline commit.

Required evidence:
- for app bundles: `Info.plist` provenance fields such as `GitCommit`, `BuildTimeUTC`, and expected bundle metadata
- for CLIs or daemons: `--version`, `version.json`, or equivalent commit/build stamp
- the stamped commit matches the merged main branch commit or a descendant on canonical main

Required action:
- run `/post-merge-deploy-check` when the component is in the canonical deploy registry

What `/post-merge-deploy-check` covers:
- PR is merged
- merge target is the canonical branch
- registry entry resolves to the canonical repo path
- bundle `GitCommit` matches the registry
- deployed artifact is at or after the merged PR commit
- running process path does not match stale forbidden patterns

Failure examples:
- app version updated but commit stamp still points at the old build
- merged PR exists but the deployed artifact lineage does not include it
- registry matches an older build while the collab says "done"

### 4. End-to-End Live Probe

Goal: prove the runtime actually serves post-merge behavior, not just the right metadata.

Use the narrowest real probe that exercises the changed path:

- actual MCP tool call
- socket ping or request/response round-trip
- CLI invocation against the real installed binary
- HTTP endpoint hit
- app-side behavior probe when the change is app-facing

The probe must hit the changed behavior, not just process liveness.

Failure examples:
- socket accepts connections but returns old behavior
- MCP server starts but the changed tool path still fails
- app bundle stamp is correct but the launched service is not the one responding

## Decision Tree

### 1. Merge report arrives

Example inputs:
- "PR #264 merged"
- "worker says the daemon is restarted"
- "collab says deployed"

Action:
- classify whether this is `deploy_bearing`
- if yes, start the four-step sequence

### 2. A worker says `TASK_DONE`

Do not treat this as deployment proof.

Action:
- require process evidence
- require `launchctl print`
- require build-stamp evidence
- require a live probe

Until those exist, the status is `UNVERIFIED DEPLOY CLAIM`.

### 3. `/post-merge-deploy-check` passes but the live probe fails

Verdict:
- `NOT DEPLOYED`

Reason:
- provenance is necessary but insufficient; runtime behavior is still wrong

### 4. Live probe passes but build stamp fails

Verdict:
- `DRIFTED OR NON-CANONICAL DEPLOY`

Reason:
- behavior may look right now, but the agent cannot claim the merged PR is what is serving

## Output Contract

When reporting verification, use this structure:

```text
Deploy verification for <repo>#<pr>:
- Step 1 Process replacement: PASS|FAIL — <evidence>
- Step 2 LaunchAgent status: PASS|FAIL — <evidence>
- Step 3 Build-stamp match: PASS|FAIL — <evidence>
- Step 4 End-to-end probe: PASS|FAIL — <evidence>
- Verdict: DEPLOYED | NOT DEPLOYED | NO DEPLOY REQUIRED
```

If any evidence is missing, say `UNVERIFIED` and keep the verdict negative.

## Hard Rules

### 1. Merge Is Not Deploy

Never answer "done" or "deployed" from GitHub merge state alone.

### 2. Subagent Report Is Not Deploy

`TASK_DONE`, collab notes, and "restarted locally" claims are not verification. `/never-fabricate` applies in full.

### 3. Provenance Alone Is Not Deploy

Passing `/post-merge-deploy-check` is not enough without the end-to-end probe.

### 4. Liveness Alone Is Not Deploy

A running PID or loaded LaunchAgent is not enough without build-stamp evidence.

### 5. Clean Up Only After Verification

Do not close the pane, remove the worktree, or report success until all required steps pass.

## Anti-Patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| "PR merged, so deploy is done" | GitHub state is not runtime state | Run all four verification steps |
| "worker said restarted" | Worker self-report is not proof | Collect process, launchctl, stamp, and probe evidence |
| "PID exists, looks good" | Liveness does not prove the right build or behavior | Check stamp and probe |
| "build stamp matches, so done" | Provenance does not prove serving behavior | Run the live probe |
| "probe works, close pane" | Probe without canonical provenance can hide drift | Run `/post-merge-deploy-check` and record the receipt |

## Receipts

Recommended commands include:

```bash
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"
pgrep -alf '<pattern>'
launchctl print gui/$(id -u)/<service-label>
python3 "$ORCHESTRATOR_REPO/scripts/post-merge-deploy-check.py" <repo> <pr-number>
<canonical-binary> --version
<real socket, MCP, or endpoint probe>
```

Use the canonical deploy registry when available. If the component is not registered yet, say so explicitly and still complete the process, `launchctl`, build-stamp, and live-probe checks with whatever local evidence is available.
