# Run Manifest

One manifest is the source of truth for a headless run. It maps every worker to
its branch, worktree, brief, log, PID identity, model/effort, lead, artifacts,
timestamps, extracted signals, token count, and duration.

## Run Fields

- `run_id`, `repo`, `lead`, and `mode`
- `degraded_mode`: exactly `lead-reachable-only`, `no-pane`,
  `no-listen-name`, and `no-self-monitor`
- `workers`: object keyed by validated immutable worker name
- pipeline-only `stages`, `active_stage`, and `continue_on_failure`

Every mutation reloads and atomically rewrites the manifest under its advisory
lock. PID liveness is accepted only when PID, process start time, and command
identity still match.

New process records include `start_kind`: `linux-start-ticks-v1` stores kernel
`/proc/<pid>/stat` field 22 ticks, while `ps-lstart-utc-v1` stores `ps lstart`
sampled with `LC_ALL=C TZ=UTC` on macOS. Both retain command equality and reject
zombies. Linux parses after the final `)` of the comm field.

Legacy records without `start_kind` are re-sampled using fixed-environment
`lstart`. A matching start and command remain live; absent/zombie PIDs or a
different command are dead. A same-command start mismatch is ambiguous (clock
or locale drift versus PID reuse): sweep, launch verification, harvest, and
cleanup raise an actionable error without finalizing or removing evidence.
Verify worker exit before reconciling that manifest; never relabel a legacy
record as a new identity for an unverified PID. Unreadable kernel identity or
an unsupported identity kind also stops the operation.
If launch identity sampling fails while the child may still be alive, its PID
is retained with `start_kind: unobserved`, a nonterminal `running` status, and
the error reason. The launch result is unsuccessful. The shared predicate
blocks further operations while that PID remains live; confirmed exit/zombie
permits normal finalization. Do not replace the marker with a fresh live PID
sample without independently establishing that it is the original worker.

## Worker States

| State | Terminal | Meaning |
|---|---|---|
| `preparing` | no | Branch/worktree/log setup is underway. |
| `running` | no | Startup verification saw a valid Codex event or the process remained alive through the grace period. |
| `watch_timeout` | no | The watch deadline elapsed; the process and log remain intact for a later watch. |
| `failed_launch` | yes | The process died before activity or launcher diagnostics showed an executable/command/fetch failure. |
| `completed` | yes | After process exit, an assistant message contained exact `TASK_DONE`. |
| `failed` | yes | A structured Codex error or turn failure was present. |
| `parser_failed` | yes | A recognized JSONL record was malformed or could not be interpreted safely. |
| `incomplete` | yes | The process exited without a structured failure and without exact `TASK_DONE`. |

`TASK_DONE` and PR URLs are read only from `agent_message` events. Tool output is
ignored because it may contain copied skill docs and false marker text.

## Harvest and Cleanup

`harvested_at`, `harvest_output`, and `harvested_files` prove that the log,
manifest, and declared worktree-contained artifacts have durable copies.
Cleanup refuses a missing harvest receipt, a matching live process, or deletion
of an unmerged branch without explicit force.

Run-level commands accept either `--run-id <id>` (resolved below `--run-dir`) or
an explicit `--manifest`. `harvest --run-id <id>` defaults to
`<run-dir>/<id>/harvest`; artifact patterns are always worktree-relative and
copy below `<output-dir>/<worker>/artifacts/`.
