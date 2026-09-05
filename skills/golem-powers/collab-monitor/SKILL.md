---
name: collab-monitor
description: "Arm or stop durable tag-scoped collab-file watches. Triggers: collab monitor, watch collab, listen-name, background watch. NOT for file-integrity auditing or worker-registry completion."
version: 1.1.0
type: encoded-preference
last-eval-date: 2026-08-03
compliance-score: "15/15 deterministic checks (not an agent-behavior score)"
---

# Collab Monitor

Use the packaged monitor whenever a collab lane needs forward-only delivery to a declared listen name. Do not hand-roll a `grep`/`tail` loop: the recorded fleet failures are pinned in this skill's evals.

## Start and Stop

```bash
COLLAB_MONITOR=$HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"

# Durable background monitor over N explicit files
bash "$COLLAB_MONITOR" start @your-listen-name \
  "$ORCHESTRATOR_REPO/collab/FLEET-STANDING.md" \
  "$ORCHESTRATOR_REPO/collab/ARM-MONITORS.md"

# Keep this foreground stream attached to the orchestrator's monitored command session
bash "$COLLAB_MONITOR" follow @your-listen-name

# Verify or stop it without remembering a PID
bash "$COLLAB_MONITOR" status @your-listen-name
bash "$COLLAB_MONITOR" stop @your-listen-name
```

Use foreground mode when a parent monitor/supervisor owns the process:

```bash
bash "$COLLAB_MONITOR" run @your-listen-name collab.md another-collab.md
```

`start` is the durable producer; it does not wake an orchestrator by itself. Attach `follow` in a monitored long-running command session before relying on alerts. Each successful `start` begins a fresh session log, and `follow` replays that session from its start before streaming new records until `stop` ends the monitor.

`run --once` performs one deterministic seed/poll and exits. It is appropriate for evals or an external scheduler; repeated calls use the same durable state. It exits non-zero when initial input, lock/state access, or event extraction fails, so a scheduler must treat non-zero as an incomplete poll.

## Participation Law — a collab is a mailbox with no doorbell

Ratified by Etan 2026-08-14 after two leads and a worker each missed messages addressed to them
in a shared collab. Writing to a collab makes a message **durable, not delivered.** Nobody is
notified. A participant without a watcher on that file will not see it, no matter how urgent.

**These rules bind every participant for the life of the collab.**

1. **Arm before you work.** The moment you post to a collab, are addressed in one, or are named
   a participant — arm a watcher on that file BEFORE doing anything else. Not after your task,
   not when convenient. An unwatched collab you are named in is an unread inbox.
2. **Waiting means detached, not looping.** When you finish a unit and are waiting to be
   re-requested: detach a watcher and RETURN. Never hold a foreground turn open to poll, and
   never inspect another agent's pane to infer state — that is monitoring you were not asked to
   do, and it burns a turn that should have ended.
3. **Codex agents have no Monitor tool — use a background bash tail.** This is not optional and
   not a lesser substitute:
   ```
   tail -n0 -F <collab-path> &     # detached, then RETURN
   ```
   Read what it captured when you are re-invoked. A Codex that keeps working, or keeps polling
   in the foreground, because "it has no monitor" is choosing the wrong half of the contract.
4. **Dedup by line hash.** A collab that gets rewritten (formatting, section moves) must not
   re-emit its whole history as new events. Hash lines; emit only unseen ones.
5. **Stop when you post your DONE — not before, not after.** The watcher's life is exactly the
   lane's life. A watcher outliving its lane is noise; a lane outliving its watcher is a silent
   handoff.
6. **Pings are pointers, never restatements.** In-pane: one line saying WHERE to look and the one
   fact that makes it urgent — `Read <file> §<section> — your worker is blocked`. The collab
   holds the detail because the collab survives restarts and the pane does not. A long message
   duplicating a collab post is backwards, and long payloads break the receiving pane.
7. **Leads own reviewer monitoring; workers push, notify, stop.** A worker that keeps watching
   its own reviewer has taken the lead's job and stayed alive to do it.

**Failure mode to recognize:** if a handoff "went unanswered", check whether the recipient had a
watcher on that file before concluding anything about the recipient. Silence from an unwatched
collab is not refusal, disagreement, or absence — it is a message that was never delivered.

## Arming Is Step 0 — at boot, and again after every compaction

Ratified into doctrine 2026-08-19 from the 2026-08-17 fleet-degradation retro. The doctrine above
was not unreliable — **it was never armed.** A lead only runs when it is spoken to, so a lead that
has not armed a watcher is *idle by construction*. Etan, on the week that produced this section:
*"you and cmuxlayer Claude lead are both just not really moving things along until I ping you."*

**Arm before you dispatch.** Arming is step 0 of every lead boot, and step 0 again after every
compaction — **a monitor dies with its session and nothing re-arms it.** A compacted lead with
workers in flight and no watcher is the exact failure this section exists to stop. Verify with
`bash "$CM" status @<listen-name>` before you send the first worker prompt; if it is not armed,
you are not a lead yet.

### Command 1 — the collab watch (arm, then attach)

```bash
CM=$HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"

bash "$CM" start  @<listen-name> "$ORCHESTRATOR_REPO/collab/<your-collab>.md"
bash "$CM" status @<listen-name>   # prove it armed BEFORE you dispatch
```

`start` is the durable producer and does not wake you by itself. Attach the stream in the same
turn, with the harness `Monitor` tool (Claude seats) — `follow` replays the session then streams:

```text
Monitor({
  command: 'bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh follow @<listen-name>',
  description: '@<listen-name> collab mail',
  persistent: true,
})
```

Codex seats have no `Monitor` tool: use the background tail in Participation Law rule 3 instead.

### Command 2 — the PR-state watch

One notification per state change, and it exits by itself when the PR reaches a terminal state, so
it cannot outlive its lane. This is the shell to run — pass it verbatim:

```bash
PR=<number>; prev=""
while true; do
  cur=$(gh pr view "$PR" --json state,reviewDecision \
        --jq '"\(.state) review=\(if (.reviewDecision//"")=="" then "NONE" else .reviewDecision end)"' 2>/dev/null || true)
  [ -n "$cur" ] && [ "$cur" != "$prev" ] && echo "PR#$PR $cur"
  prev="$cur"
  case "$cur" in MERGED*|CLOSED*) exit 0;; esac
  sleep 60
done
```

Claude seats hand that block to the harness as `Monitor({ command: <the block>, description: 'PR
#<number> state + review decision', persistent: true })`. Codex seats run it detached per
Participation Law rule 3.

**The jq filter is single-quoted, and that is load-bearing.** jq's `\(…)` interpolation is legal only
inside a `"…"` string literal. Spell the filter with double quotes and the shell eats them, jq
receives a bare `\(...)` and dies with `failed to parse jq expression … unexpected token "\\"` on
every tick — a watcher that emits nothing, never exits, and looks armed. Verified 2026-08-19: the
double-quoted spelling exits 1 with that parse error; the single-quoted one prints `OPEN review=NONE`
for #729 and `MERGED review=NONE` for #728, and the `MERGED*|CLOSED*` case then exits 0.

`reviewDecision` comes back as an **empty string, not null**, on a PR with no review — which is why
the `if … == ""` branch is there and why a bare `// "none"` fallback silently prints nothing.

### Filter discipline — a crisis filter keeps firing after the crisis

A watch written while something is burning is scoped to the fire, and then outlives it. Two live
specimens from this fleet:

- a **PR-state watch** left broad enough to narrate every unrelated lane's PR back to the user;
- a **collab watch matching `@skillcreator`** that woke the lead on the lead's *own* posts.

The rule, in three parts:

1. **Match what is addressed TO you** — the anchored routing grammar below, not a bare tag scan.
2. **Exclude your own byline** — this monitor classifies self-authored blocks as `SELF-POST`
   rather than inbound mail; do not defeat that by grepping the raw file for your tag.
3. **Re-narrow when the crisis ends.** The filter is part of the lane, and the lane's close is the
   filter's close: `bash "$CM" stop @<listen-name>`.

### The honest limit — monitors watch artifacts, not handoffs

A monitor fires on a **file changing** or a **PR state changing**. It cannot see two agents waiting
on each other. A merge-state watcher on a green PR is silent in exactly the same way whether the
reviewer is mid-review or was never routed at all — the silence is a fact about the artifact, never
about the handoff. The deadlock in the next section was invisible to every watcher armed at the
time, and it was still a deadlock. Use a monitor for the artifact; use `closure` for the handoff.

## Completion → Reviewer Handoff

**The live specimen (2026-08-17 retro):** the PR #727 implementor sat DONE with an open PR while its
lead waited for a collab marker the implementor never wrote. **Both agents were behaving correctly**
and the lane still stalled. The worker had treated *"the PR is open and I said so on screen"* as
delivery.

### Worker side

**The DONE marker written to the collab is the final write.** Not the PR opening. Not a message on
screen. Not the report file alone. This is already fleet law (canon #7) and it still failed — so the
failure mode is stated beside the rule: a worker that opened its PR, announced it in its pane, and
stopped has produced a durable artifact and **delivered nothing**, because a collab is a mailbox
with no doorbell (Participation Law, above). Post the DONE marker, stop your watcher, end the turn —
in that order.

### Lead side

On a worker's DONE, the lead **routes a reviewer.** That is not a thing to remember; it is the event
the watch exists to deliver. The watch that delivers it is Command 1 above, armed at step 0 on the
same collab the worker posts its DONE to. When the `NEW-FOR-@<listen-name>` line lands carrying that
DONE, the routing step is these two commands.

Write the brief to a file first — it carries the PR URL, the head SHA the review is pinned to, and
the listen name the reviewer reports to, which is more than a pane-safe inline prompt holds:

```bash
gh pr view <number> --json url,headRefOid --jq '"\(.url) @ \(.headRefOid)"'   # the two facts the brief must pin
```

```text
mcp__cmuxlayer__spawn_agent({
  repo: "<repo>", cli: "claude",
  role: "reviewer", authority: "worker", placement: "right",
  boot_prompt_path: "<absolute path to the review brief you just wrote>",
})
```

Then append the routing to the collab — reviewer `agent_id` from the spawn receipt, PR URL, head SHA
— so the next lead reads who is reviewing what without a screen read.

### `closure` — the mechanical check

Shipped in cmuxlayer P11 (v0.4.47) and visible at **default** `list_agents` detail — no
`detail:"full"` needed:

```text
mcp__cmuxlayer__list_agents({ mine: true })
```

**`artifact_missing` gates itself. Do not re-gate it on the `state` the row renders.** `closure` is
already derived from done-evidence, not from the live screen. `agent-engine.ts:1755` computes
`effectiveState = isLiveActive(live) ? live.state : agent.state`, and `isLiveActive`
(`live-agent-state.ts:142`) is `live.state === "working" && live.source === "screen"` — the only live
observation strong enough to overturn a recorded `done`. The AIDEV note above it
(`agent-engine.ts:1746-1754`) states that design outright: *"A `ready` prompt cannot overturn done (a
finished worker sits at one too), and a dead/shell pane must not either: there the record's `done`
plus the missing artifact IS the story."* So `verified` and `artifact_missing` both already mean
*the record says done*, and `pending` means it does not. The row's `state` is the raw live
observation, and on a finished worker it reads `ready` — gating on it throws away the exact rows the
signal exists to raise. (The record saying done is not proof the worker finished; that is what the
three confirm checks below are for.)

| `closure` | row's rendered `state` | Means | Lead's move |
|---|---|---|---|
| `verified` | any | Recorded done, artifact on disk. | Harvest, review, `close_surface`. |
| `artifact_missing` | any | **The deadlock signature.** Recorded done; nothing where the artifact was contracted. | Confirm (three checks below), then **route a reviewer** against its PR. Never `close_surface` on this. |
| `pending` | any | The record does not say done, or a live `working`/`screen` read overrode it. | Nothing. Use the monitor for the artifact. |
| `not_applicable` | any | No artifact contract (bare seats, non-spawned surfaces, orchestrators). | Nothing. |

**Confirm before you route — three checks, all cheap.** `artifact_missing` is a real signal, not a
free pass: the fields flap, and a *false* `done` detection on a still-running worker produces the same
value (`#457-rest`, below). Before routing, establish all three:

1. **The record carries done-evidence.** Ask **by id** — never sweep `detail:"full"` across the
   fleet: one full record runs tens of KB, and two of them overflowed a tool-result budget while this
   section was being written.

   ```text
   mcp__cmuxlayer__list_agents({ agent_ids: ["<agent_id>"], detail: "full" })
   ```

   Want `detail.state:"done"` with a non-null `detail.task_done_detected_at`.

2. **The live read is not `working` from `screen`.** That is the *only* observation the engine itself
   treats as overriding a recorded done (`isLiveActive`), and a row rendering it is mid-turn:
   re-sample, do not route. Every other rendered state — `ready` above all — is not a veto.

3. **The artifact is absent.**

   ```bash
   ls -l $HOME/.cmux/agents/<agent_id>/report.md   # detail.report_path
   ```

All three → deadlock confirmed, route the reviewer. Any one missing → re-sample instead.

**Why not the rendered `state`, and not the `state` filter either — live, 2026-08-19, v0.4.47.** A
28-row default sweep at `19:21:21Z` rendered `state:"done"` on **zero** rows, and
`list_agents({state:"done"})` at `19:22:58Z` returned `count: 0`. A gate requiring either fires on
nothing, ever. Seven seconds after that sweep, the two agents it had shown as `working`/`pending`
read:

```text
list_agents({agent_ids:["<AGENT_ID>","<AGENT_ID>"], detail:"full"})
  <AGENT_ID>  state.value "ready" (source screen)  closure "artifact_missing"
            detail.state "done"  task_done_detected_at 2026-08-19T19:12:35.980Z
  <AGENT_ID>  state.value "ready" (source screen)  closure "artifact_missing"
            detail.state "done"  task_done_detected_at 2026-08-19T19:13:11.903Z

$ ls -l $HOME/.cmux/agents/<AGENT_ID>/report.md
ls: ...: No such file or directory
$ ls -l $HOME/.cmux/agents/<AGENT_ID>/report.md
ls: ...: No such file or directory
```

Two real deadlocks — recorded done, done-timestamp set, contracted artifact absent — that a
rendered-`state` gate discards.

**The mechanism, and what is actually the bug.** Two things happen here, and earlier revisions of
this section each caught only one of them.

*By design, not a defect.* `closure` resolves from `effectiveState` (`agent-engine.ts:1897`) under
the fallback rule above: `working`/`screen` takes the live branch → `pending`; `ready`/`screen` does
not → falls back to the recorded `done` → `verified` or `artifact_missing`. Every `ready` specimen
above follows it exactly. A previous revision of this doc gated those rows away as noise; they were
the true positives.

*The actual defect.* The `state` a row renders and the live observation `closure` was computed from
are not guaranteed to be the same sample, so a row can render `working`/`screen` — which by the rule
must give `pending` — while carrying `artifact_missing`. Reproduced live on this agent's own row,
2026-08-19 19:28:46Z, v0.4.47:

```text
list_agents({agent_ids:["<AGENT_ID>"], detail:"full"})
  state.value "working" (source screen, observed 19:28:45.722Z)   closure "artifact_missing"
  detail.state "done"   task_done_detected_at 2026-08-19T19:21:43.047Z
  $ ls -l $HOME/.cmux/agents/<AGENT_ID>/report.md
    No such file or directory
```

That agent was mid-turn and had written no report: the recorded `done` was a false detection, and
check 2 above is what stops it being routed. The same pair showed on four children in an earlier
25-row default sweep, 2026-08-19:

| `agent_id` | rendered `state` | `closure` |
|---|---|---|
| `<AGENT_ID>` | `working` | `artifact_missing` |
| `<AGENT_ID>` | `working` | `artifact_missing` |
| `<AGENT_ID>` | `working` | `artifact_missing` |
| `<AGENT_ID>` | `working` | `artifact_missing` |

It is tracked. **cmuxlayer #457** (OPEN) names this symptom in its own body — *"P11 Contract C
closure invariant — VIOLATED. `closure:"artifact_missing"` on a working agent, at default detail"* —
and its 2026-08-19T16:57:10Z comment defers "#457-rest", whatever survives PR #466's live-state
resolution, because no audit proved the residual gone. #466 merged 2026-08-18, a day before these
sweeps, so the residual is current, not historical. The nearby #478 (`wait_for`/`watch`) and #473
(`wait_for` short-circuit) are other call paths.

Neither the closure table nor the confirm step depends on that residual being fixed: checks 1-3
catch it, and stay correct once it is gone.

**Sampling note — one clean snapshot refutes nothing.** These values flap on live children.
`<AGENT_ID>` read `artifact_missing`, then `verified`, with no artifact written in
between; a reviewer reproduced a `working → done → working` flip in 17 seconds; and a later sweep
found all four specimens above reading `ready`/`verified` at once; and the two `voicelayerClaude`
deadlocks above read `working`/`pending` at `19:21:21Z` and `ready`/`artifact_missing` seven seconds
later. Sample twice before you believe either field.

## Supervision: Watch, Then Read Once

A supervisor **MUST NOT poll `read_screen` in a loop** for one worker outcome. Repeated screen reads are a defect, not diligence: arm a process-exit or background-log watch, let it wake the supervisor, and read the finished screen/log once.

For headless Codex workers, use the `codex-workflows` skill's `watch` primitive. It observes process exit first and parses the completed log once. For this monitor, keep `follow` attached to the supervisor's monitored long-running command session; do not replace it with repeated screen inspection.

## Routing Grammar

The filter is tag-scoped and anchored on both sides of a mention, so email-like text such as `owner@listener` does not route. For routed headings, only mentions in the recipient field between the arrow and event-summary separator qualify; a listener mentioned later in the summary is not a recipient. It accepts:

- a routed Markdown header such as `### @author → @your-listen-name — event`;
- a direct line beginning `@your-listen-name:` or `→ @your-listen-name`, with the arrow form followed by end-of-line or a `:`, `-`, or `—` separator.

A direct line at the end of a file is held until a standalone trailing author signature (`— @author` or `-- @author`) or later heading closes its message block. Contextual dash lines and signatures that merely cc the listener do not close or classify a block. This prevents a split write from alerting before a self-author signature arrives. A block authored by the listen name—either before the routing arrow in its header or in a trailing `— @your-listen-name` signature—is classified as `SELF-POST` rather than emitted as inbound `NEW-FOR` mail. A recognized foreign signature overrides an earlier self-authored heading so nested inbound mail remains visible.

Prose that merely contains the tag, `TASK_DONE`, `error`, `failed`, `PR`, or `done` is not an event. If a post matters to a listener, address it using the routing grammar.

Fenced and indented code is excluded from routing, so examples of the grammar do not wake the monitor, including four-space fenced blocks nested beneath a Markdown list item and fences opened directly on a list-marker line. Backtick markers whose info remainder contains another backtick are treated as inline content, not as fence openers. A four-space routed reply immediately nested beneath a list item remains prose and can route normally. An unclosed fence emits `WATCH-WARN reason=unclosed-fence`, makes the poll incomplete, and is retried until the fence closes; `start` does not publish readiness while that condition exists.

## Guarantees

1. **Silent seed:** current matching history is hashed without alerting when a file is first watched.
2. **Content-hash dedup:** a previously seen event line does not re-fire when any watched file grows or identical content is appended to another watched file for the same listen name. If the seen-set disappears or becomes unreadable after size baselines exist, the poll fails closed with `reason=state-failed` instead of replaying history.
3. **Self-classification:** self-authored routed headers and trailing-signature blocks emit a distinct `SELF-POST` record, never a normal inbound alert.
4. **Shrink detection:** a byte-size decrease emits a distinct `SHRINK` record with its byte delta.
5. **Bash 3.2 safety:** state lives in ordinary files; the implementation uses neither `declare -A` nor `comm`.
6. **Durable lifecycle:** `start` reports success only after the detached runner completes its first seed/poll, allowing 30 seconds by default for a large healthy historical seed, and records a validated PID plus per-start instance identity by listen name; an interrupted pre-readiness start terminates and reaps its unpublished runner, duplicate starts fail, ambiguous live-PID conflicts preserve their state for recovery instead of signaling or orphaning a process, `stop` never signals a stale/reused PID or a same-name monitor from another state root, and a zombie runner is treated as stopped instead of timing out.
7. **Stable path identity:** relative and absolute spellings resolve to one size-state record, so a spelling change cannot silently re-seed a file.
8. **Transient-file retry:** a watched path that temporarily vanishes or fails mid-read emits `WATCH-WARN` and is retried without killing the foreground monitor; `run --once` reports the incomplete poll with a non-zero exit.
9. **Code-example exclusion:** fenced and indented code cannot impersonate routed mail; an unclosed fence is an explicit incomplete poll rather than silent event loss.
10. **Attached alert consumption:** `follow` streams the current start session's log to the orchestrator and exits after that named monitor stops; detached `start` output alone is never presented as a wake mechanism.

Delivery is at-least-once. The monitor emits an event before atomically persisting its hash and then updating the file-size baseline. A crash at that boundary can duplicate the last alert, but does not intentionally mark an un-emitted alert as delivered.

## Output

```text
MONITOR-ARMED name=@listener files=2 state=/.../listener
WILL-NOT-CATCH :: ...
FOLLOWING name=@listener pid=<pid> log=/.../monitor.log
NEW-FOR-@listener file=/path/collab.md hash=<sha256> :: <literal event line>
SELF-POST-@listener file=/path/collab.md hash=<sha256> :: <literal own-write line>
SHRINK file=/path/collab.md old_bytes=123 new_bytes=80 delta_bytes=43
WATCH-WARN file=/path/collab.md reason=temporarily-absent|read-failed|hash-failed|state-failed|unclosed-fence action=retry
STATE_CONFLICT name=@listener pid=<pid> action=not-started|not-signaled state=preserved
```

State defaults to `~/.local/state/collab-monitor/<listen-name>/`; the special path names `.` and `..` are rejected. Set `MONITOR_STATE_DIR` only for isolated tests or a deliberately managed alternate state root. Set `POLL_SECONDS` to a positive integer or decimal to change the foreground/background polling interval. `start` waits up to 30 seconds for the initial seed/poll; set `START_TIMEOUT_SECONDS` to a positive whole number no greater than 86400 when a very large or slow board needs a longer readiness deadline. Zero and malformed polling or startup values fail before `run` or `start` arms, while `status` and `stop` remain available for recovery.

On `STATE_CONFLICT`, inspect the preserved PID, instance, readiness, and run-lock records before retrying; do not delete state or signal the PID until its command and per-start identity are verified.

## What This Will Not Catch

The runner prints these limits on every arm because silence is not full safety:

- same-size rewrites in place; growth rewrites trigger a scan but may look like appends;
- messages outside the anchored routing grammar;
- unclosed trailing direct messages, which are held until a signature or later heading closes the block;
- inbound direct mail nested in a self-authored block remains self-classified unless a recognized foreign signature closes it;
- process death without an external supervisor;
- worker completion represented only in an agent registry.

Use a tamper/file-integrity monitor for rewrite detection and registry polling for worker completion. This skill is the addressed-message channel, not either of those systems.

One further limit the runner cannot print, because it is not a property of any watched file: **a monitor cannot see two agents waiting on each other.** See "The honest limit" above, and use the `closure` field for handoff state.

## Migration

Until the external orchestrator caller is migrated, this skill is the implementation source of truth. The PR that introduced it proposes turning `orchestrator/scripts/collab-monitor.sh` into a thin compatibility caller rather than maintaining a second monitor implementation.

## Evaluation

Run:

```bash
bash skills/golem-powers/collab-monitor/evals/run-evals.sh candidate
bash skills/golem-powers/collab-monitor/evals/live-two-file-smoke.sh
```

The deterministic suite covers the recorded monitor failures, `/large-plan`'s exact broken `grep done` teaching repro, addressed completion/blocker teaching in linked workflows, rejection of repeated `read_screen` supervision, code-example exclusion and malformed-fence recovery, shrink detection, limitations disclosure, durable lifecycle safety at the shipped poll interval, exact listen-name boundaries, path identity, and transient-file retry.
