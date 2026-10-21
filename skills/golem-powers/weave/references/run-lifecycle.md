# Run lifecycle: convergence, mining, dispatch, and miner contract

Read this when running the convergence gate, preparing the corpus, choosing the mining substrate, dispatching miners, checking their disk artifacts, or running the delta wave.

## 1. Convergence gate (why it can't fire mid-flight)

A multi-way deep-mining fan-out next to the live Opus fleet = OOM + token
contention. The weave fires ONLY at convergence. **All four must be true:**

1. **0 open PRs** across golems + brainlayer + voicelayer.
2. **All workers idle and settled** — cmux panes idle, and/or every T3 worker
   thread settled.
3. **No in-flight Codex** — no busy cmux Codex pane, and/or no T3 delegate
   still working (Codex delegates are T3 threads too).
4. **Etan has SEEN + APPROVED the demo.**

Plus a **RAM gate** (same lesson as content-demo's `ram-gate.sh` — quiesce first).

Conditions 2–3 depend on how the fleet runs. `--fleet` (or `WEAVE_FLEET`) picks
the check:

| `--fleet` | Section [2/3] checks |
|---|---|
| `t3` | The T3 snapshot only (§1.1). No cmux check, no cmux failure. |
| `cmux` | `cmux list-status` + the `pgrep codex` warning only (§1.2). |
| `both` | Both; each must pass. |
| `auto` (default) | `t3` when `--t3-state` is given or the gate runs inside T3 (`T3CODE_CLI_PATH` set); `cmux` when the cmux CLI is on PATH; both when both (inside T3 with `cmux` on PATH that means both, so pass `--fleet t3` for a T3-only fleet). **Nothing detectable = BLOCKED, never a pass.** |

```bash
P="$FLEET_PROJECT_IDS"   # space-separated T3 projectIds the fleet runs in
bash scripts/convergence-gate.sh --fleet t3 --t3-state "$SNAP" --t3-projects "$P"            # #4 still needs the ack
bash scripts/convergence-gate.sh --fleet t3 --t3-state "$SNAP" --t3-projects "$P" --ack-demo # operator asserts demo approval → can PASS
bash scripts/convergence-gate.sh --fleet cmux --ack-demo                                     # cmux fleet
```

Condition #4 is **not script-checkable** — the gate stays BLOCKED until the
operator passes `--ack-demo` (or `WEAVE_DEMO_ACK=1`). Human/orchestrator in the
loop; never auto-fire. `"weave now"` is the only path that skips the gate. The
open-PR gate, the RAM gate and the demo gate run the same way in every fleet mode.

> **Convergence signal (2026-07-10):** the gate may key on the orchestrator's
> **SENTINEL** (an explicit quiescence marker orc emits) rather than a raw
> PR-count poll — PR-count alone false-fires while a lead is mid-close. Prefer
> the SENTINEL when orc emits one. [g1:52 → 2026-06-21.md:2]

### 1.1 T3 fleet — threads + delegated tasks snapshot

Leads and workers now run as T3 threads and `delegate_task` children, and a
shell script cannot call MCP. So the lead running the gate captures what T3
reports into one JSON file, and `scripts/t3-fleet-state.py` judges it.

The gate passes only when convergence is **proven**. Every absence, duplicate,
unknown value or missing liveness field blocks.

**Capture (in the lead's own thread, right before the gate):**

0. **Stamp the clock first.** `captured_at` = `date -u +%Y-%m-%dT%H:%M:%SZ`,
   taken BEFORE the first T3 call. The age check measures from it, so a stamp
   taken at the end would hide how old the first page is.
1. **Sweep every fleet project.** For each fleet `projectId`:
   `t3_thread_list(projectId, settled: false, includeSubagents: true, limit: 100)`,
   following `nextCursor` until it is `null`. Copy every row into `threads` and
   add `"projectId"` (the response's top-level `projectId`) to each row. Record
   `{"projectId": …, "total": …}` (the response's `total`) in `projects`. The
   judge counts the unsettled rows per project against `total`, so a skipped
   page blocks.
   **Slim projection (allowed).** Rows may be copied verbatim or cut to
   `threadId, projectId, title, status, settled, createdBy, parentThreadId,
   updatedAt` (plus `pendingRequestCount` once step 3b reads it). The judge
   requires only `threadId`, `projectId`, `status` and `settled`. Keep
   `createdBy`: without it a user conversation is judged as a worker. The
   2026-10-19 live capture was 300 KB for 244 rows, mostly `pullRequests`
   arrays (one row had 115). Projected, the same rows are about 100 KB, a
   third of that.
2. **Every delegated task.** `task_status(taskId)` for every task you hold;
   copy each result verbatim into `tasks`. The judge requires `taskId`,
   `childThreadId`, `status`, `workState`, `hasPendingChildRuns` and
   `hasPendingQuestion` on every row. A missing field blocks; it is not
   read as `false`.
3. **Prove each child settled.** For every task whose `childThreadId` is not
   already in `threads` (a settled child drops out of the `settled: false`
   listing), `t3_thread_read(childThreadId)` and append its `thread` object
   (it carries `projectId`, `status`, `settled`, `pendingRequestCount`) to
   `threads`. Never append a thread twice: duplicate `threadId`s are rejected.
   **3b. Pending approvals.** `t3_thread_list` rows carry no
   `pendingRequestCount`. For every unsettled `interrupted` or `waiting` row,
   `t3_thread_read(threadId)` and copy its `thread.pendingRequestCount` onto
   that row (only that field; keep the listing row). See the invariant below.
4. **Your own pending questions.** `t3_pending_request_list()` (no `threadId`
   means your own thread) returns `{"requestIds": [...]}`. Record it as
   `{"threadId": <self_thread_id>, "requestIds": [...]}` in `pending_requests`.
   Add one row per extra thread you checked the same way.
5. `self_thread_id` = `currentThreadId` from the list response.

```json
{
  "schema": "weave-t3-fleet/v1",
  "captured_at": "2026-10-18T21:00:00Z",
  "self_thread_id": "thread:orc",
  "projects": [{"projectId": "project:fleet", "total": 1}],
  "threads": [
    {"threadId": "thread:orc", "projectId": "project:fleet", "title": "orc",
     "status": "running", "settled": false, "createdBy": "agent",
     "parentThreadId": null, "updatedAt": "2026-10-18T20:59:41Z"},
    {"threadId": "thread:pr1-worker", "projectId": "project:fleet", "title": "PR1 impl",
     "status": "completed", "settled": true, "pendingRequestCount": 0}
  ],
  "tasks": [{"taskId": "task:pr1-impl", "childThreadId": "thread:pr1-worker",
             "status": "completed", "workState": "result_available",
             "hasPendingChildRuns": false, "hasPendingQuestion": false}],
  "pending_requests": [{"threadId": "thread:orc", "requestIds": []}]
}
```

Write it under the run's `docs.local/` scratch dir (never `/tmp`), then
`bash scripts/convergence-gate.sh --fleet t3 --t3-state <file> --t3-projects "<ids>"`
(or `WEAVE_T3_STATE` + `WEAVE_T3_PROJECTS`). `--t3-projects` is the fleet
project set, given to the gate separately from the snapshot. Without it the gate
blocks. Max age defaults to 15 min (`--t3-max-age-min N`,
`WEAVE_T3_MAX_AGE_MIN`).

**Output and exit codes.** In-flight and waiting blockers print first (running
threads, waiting threads, pending requests, tasks still working). Then come the
other blockers. Finished-but-unsettled workers print as ONE line, for example
`237 finished thread(s) not settled — settle them (209 completed, 14
interrupted, 10 idle, 4 failed); ids: <snapshot>.unsettled.tsv`. Each one still
blocks; the file lists `threadId, status, createdBy, updatedAt, title` per
line. On the 2026-10-19 live fleet this turned 238 per-thread lines into one,
under the 5 running threads they used to hide. The judge exits 0 converged,
1 not converged, 2 invalid snapshot, and the gate prints
`→ T3 judge rc=N (…)`. The gate exits **3** when the judge says the snapshot is
invalid (no T3 verdict exists: recapture it), 1 for any other block, 0 to pass.
A PASS line states what was proven: projects swept, unsettled rows listed
against the totals (the gate runner plus any noted user conversation), tasks
with a settled child, and empty pending-request lists.

**Verdicts. The gate blocks on:**

- a missing, unreadable, malformed or wrong-`schema` snapshot, or a stale /
  future `captured_at`;
- a missing or duplicate field or id: no `projects`, a row without
  `projectId`, a task without `status` / `hasPendingChildRuns` /
  `hasPendingQuestion`, a duplicate `threadId` / `taskId` / `pending_requests`
  thread, or a `pending_requests` row without a `requestIds` list;
- coverage gaps: no `--t3-projects`, a fleet project absent from `projects`, a
  project whose unsettled rows do not add up to its `total`, or an unsettled
  thread from a project that was not swept. When the shortfall is exactly a
  `settled: true` row that is not a task child, the FAIL names that row (a
  `settled: false` sweep cannot return it, so it was edited or changed after
  the sweep) instead of saying "read every page";
- `self_thread_id` absent from `threads`, or the runner itself `waiting` or in
  an unknown status (it is exempt only from the running/unsettled checks);
- any other thread `preparing`/`queued`/`starting`/`running`, or `waiting`
  (a pending question), or with a status outside the `t3_thread_list` enum,
  or with `pendingRequestCount` > 0 ("decline its pending approval in the T3
  app (MCP cannot), then settle");
- any task `working` or `waiting_for_children`, with an unknown `workState`
  or `status`, with `hasPendingQuestion: true`, or `result_available` with a
  live `status` (inconsistent);
- a `result_available` task with `hasPendingChildRuns: true`;
- no `pending_requests` row for `self_thread_id`, or any non-empty `requestIds`.

**Parent/child completion is not a settled worker.** A task at
`result_available` means the child finished its work for the parent. The worker
is converged only once its thread is settled too, and the snapshot has to prove
it. A `result_available` task whose child thread is unsettled, or any finished
thread (`idle`, `completed`, `failed`, …) left unsettled, fails with
**"… not settled — settle it"**. A child thread missing from `threads` fails
with **"… missing from the snapshot — add t3_thread_read(…).thread"**. It is
never assumed settled. Standing rule: "settle idle workers"
(Etan 2026-10-18, via orc collab).

**Etan's own conversations are not workers** (lead ruling, skillcreator-lead,
2026-10-19). A `createdBy: "user"` thread still blocks while it is active,
waiting or holding a pending request. Finished but unsettled, it is a NOTE, not
a FAIL: "settle idle workers" means workers. An `interrupted` user thread
becomes a NOTE only with a `pendingRequestCount` of 0 from step 3b; without it,
it blocks. Any other `createdBy` (`agent`, `system`, missing) is a worker.

**Invariant: no settled thread hides an approval** (lead finding, observed
2026-10-19). T3 refuses to settle a thread with a pending approval ("is waiting
on an approval or question. Answer it before settling"). A cancelled
approval-required child stays `interrupted` with `pendingRequestCount: 1`, and
the MCP cannot decline approvals. So a missing `pendingRequestCount` on a
settled row is safe, and every unsettled worker already blocks. A missing count
never produces a PASS: the judge never assumes 0 for a thread it would let
through (the `interrupted` user conversation above). When a row does carry a
count above 0, decline the approval in the T3 app, then settle.

### 1.2 cmux fleet — pane idleness

With `--fleet cmux` (or `auto` with the cmux CLI on PATH), section [2/3] reads
`cmux list-status`: any surface `working`/`busy`/`running`/`active` blocks, and a
failed or empty `list-status` blocks (fail-safe). Without the cmux CLI the cmux
check blocks. A `pgrep codex` match is a warning only: confirm by hand that no
in-flight worker is behind it.

### 1.4 verify-before-alarming — read the bytes before you publish a finding

Applied to the weave's OWN output: **over-correction is the worst possible
dashboard error.** A miner adjective ("personal", "broken", "never landed") is
**not** evidence — read the actual bytes / re-grep the cited line before any
finding is published or acted on. [g1:75 → 2026-06-03.md:10,32-37]

## 2. The engine — session-mining fan-out

The weave mines the **recent Claude + Codex session JSONLs** (`~/.claude/projects/**`
+ `~/.codex/sessions/**`). "Web" = weaving a web *across sessions*, NOT web-search.
For **Claude** sessions it leans on the `/skill-creator` mining engine (the
deterministic parser `session-miner.py` — Claude-only — + the `session-miner`
sub-agent). **Codex** sessions have a different log shape and are NOT parsed by
`session-miner.py`; this skill's own `prepare-mine-context.py` handles both
formats (digest-if-present + keyword-grep excerpts), so a miner reads a uniform
context file regardless of source. The whole thing is wrapped by this skill's
reproducible harness:

```bash
# WD = the SCRATCH run dir. digests/ + findings/ + mine-context/ are BULKY and
# fully REGENERABLE (re-run discover/prepare), so they may live in gitignored
# docs.local/. They are NOT the durable artifact — do not rely on them surviving.
WD=$ORCHESTRATOR_ROOT/docs.local/weave-$(date +%F)

python3 scripts/weave-run.py discover --hours 24 --workdir "$WD"   # → corpus-manifest.json (centerpieces ★ first)
python3 scripts/weave-run.py prepare  --workdir "$WD"              # → digests/ + mine-context/ (compact per-session)
python3 scripts/weave-run.py batches  --workdir "$WD" --size 5     # → batch-manifest.json (slices of at most 5 sessions)
#   ... regroup manifest items for K-session miners; cap active groups separately (see Dispatch) ...
python3 scripts/weave-run.py aggregate --workdir "$WD" --tokens <N> # → ACTION-LEDGER.md + ledger.json + conversion-to-change
#   ... synthesize the forward-plan from the ledger ...
#   ... THEN the MANDATORY red-team fact-check closing stage (§4b (verification-and-discharge.md)) before anything is trusted ...
```

> ⚠️ **CLI-snippet correction (carried unfixed 3+ gens):** the direct
> `scripts/weave-ledger.py` invocation takes **`--findings-dir` / `--out-dir` /
> `--title`**, NOT `--workdir`. The `weave-run.py aggregate --workdir` wrapper is
> fine; the raw ledger call is not. Verify the flags against `--help` before you
> cite this snippet in a brief. [g1:84 → 2026-06-05.md:47; still-unfixed 2026-06-06.md:52]

> ⚠️ **The durable artifact is NOT the scratch WD.** The bulky digests/findings
> are regenerable; what must be **committed** (so it can't be lost like the
> original weave) is the **conclusions**: the conversion-to-change metrics + the
> high-importance routed findings + the retro. Commit those into the private
> records repo at `$ORCHESTRATOR_ROOT/weave-records/retros/<date>.md` (and
> `brain_store` them). Never leave the conclusions only in `docs.local/`.
> retros + registry contain operator comms — they live in the private records repo.
> Route conclusions to the committed retro **plus** `_brain_store_pending.md` —
> the `brain_store` MCP/DB can vanish mid-run, so the file is the durable copy.
> [g1:87 → 2026-05-31.md:110-111]

- **Centerpieces first.** The orchestrator's own session JSONLs hold the night's
  decisions/corrections/failures. `discover` tags them ★ and orders them first;
  mine them deepest (`references/topology.md`). **Read the centerpiece DIGESTS
  first, map the generational chain against each other, THEN mine workers.**
  [g1:82 → 2026-06-05.md:14,48]
- **Whole sessions, K per miner** (never shards of one session; centerpieces get a
  dedicated miner). Parallelism = waves of ~5 miners. **Loop-until-dry** (see §2a phase-recursion) — stop
  when a round surfaces nothing new.
- Miners read the compact `mine-context/<label>.md` (digest + grep excerpts),
  then grep the raw JSONL only to quote verbatim. They never read a whole MB-scale
  JSONL into context.

### 2a. Phase-recursion loop — no fixed round cap (2026-07-10)

> **DESIGN SPEC — harness implementation pending (ships with the substrate-law + phase-recursion + final-boss bundle).**

Loop-until-dry is specified as a **phase-recursion while-loop**, not a fixed round count:
`gapN → verifyN` runs until **BOTH queues are dry** (no new gap-needs, no
unverified claims). **A fixed cap that silently drops is the single most
expensive weave bug of the last cycle** — a 2-round cap dropped 31/54 gap-needs
and starved 5/9 panels to zero probes. Depth/cap survive **only as runaway
backstops**, never as the terminator; branches stop by **novelty-exhaustion**
(K-empty stable-keyed rounds). [g1:93 → 2026-07-10.md:26; g3:19-29 → tree-wf-review-priorart.md:13-14,33-34]

**Tree corollary (density-weighted frontier):** when the frontier expands as a
tree, weight it by **parent yield** so centerpiece branches aren't starved to
feed shallow ones. [g3:25-29 → tree-wf-review-priorart.md:33-34,70]

### 2b. Fan-out primitive — one flat `parallel()` per depth, NEVER nested (structural law)

> **DESIGN SPEC — harness implementation pending (ships with the substrate-law + phase-recursion + final-boss bundle).**

Expand a tree/frontier as **one flat `parallel()` per depth** over the whole
frontier — collect `CHILD:` lines in plain JS, dedup, cap, reassign as the next
frontier. **Never nest `parallel()` inside `parallel()`:** a parked parent holds
all semaphore permits (zero left for children) so it either **deadlocks** or
**silently serializes** to ~14-wide, buying nothing over a flat frontier. All
three proven scripts use a top-level `while` + one flat `parallel()` per cycle.
[g3:7-17 → tree-wf-review-design.md:17-41,36-41]

> Embed corpus/data as **in-script JS literals, never Workflow `args`** — nested-
> object args are silently dropped by the Workflow runtime. Pass flat args or
> hardcode in-script. [g1:85 → 2026-05-30.md:106; 2026-06-21.md:44]

> **Output-cap guard (workflow-output-cap-law):** a Workflow `agent()` dies at
> ~64K output tokens and **returns `null` without throwing**, so bulk data must
> never transit a single return/write — use grouped collectors + chunked writers.
> A failed miner silently becomes a childless leaf and its subtree vanishes, so
> guard `res == null` explicitly. [g2:29; g3:44-52 → tree-wf-review-design.md:76-87]

### 2c. Substrate ladder — gather off-Claude, quota-probe BEFORE launch (2026-07-10, quantified)

> **DESIGN SPEC — harness implementation pending (ships with the substrate-law + phase-recursion + final-boss bundle).**

Gather runs **entirely off-Claude**; Claude does judgment only. The ladder is
**exhaustible and ordered** — probe quota before you launch, because an AUTO cap
is a calendar fact, not an incident:

1. **cursor-AUTO** (Cursor Pro included tier) — itself exhaustible: explicit
   `--model auto` returned the usage-limit error at ~sess 348/805, operator-verified
   ("we exhausted cursor auto tier"). [g3:54-64 → skills-audit-notes.md:191; tree-wf-review-priorart.md:42-43]
2. Choose the next eligible gather route via `/agent-routing` § Routing rules (SSOT); retain the small-slice boundary. [g3:60]
3. Keep centerpiece mining deepest (`references/topology.md`); use the routing pointer above. [g3:60]

> **Spark is a separate implementation-shaped bucket — its own class, NOT compared to sol.**
> Spark's "unfit for mining" verdict was an **effort-config artifact** (xhigh
> burned 1.0M tok / 0 output; medium produced 15 specimens / 68s). [g3:59-60 →
> skills-audit-notes.md:186,202]

**Before launch:** probe the quota, detect `ActionRequiredError` / usage-limit,
fail over to the cheap tier **gracefully**, and surface quota state in the run UI.
Pin `--model auto` explicitly (never inherit). [g1:96 → meta:44; g3:61-64]

### 2d. Agent-type × effort routing (Codex-5.6 effort ladder)

> **DESIGN SPEC — harness implementation pending (ships with the substrate-law + phase-recursion + final-boss bundle).**

Pin **per-node-role AND per-effort**, not just per-model:

| Task shape | Route | Effort |
|---|---|---|
| Mechanical / bulk transcript extraction | Codex-5.6 (separate rate bucket) | **medium** (44min / 0-fail proven) |
| Judgment / extraction-quality / ambiguity | Codex-5.6 bumped, or Claude | **high** |
| Plan-mode | Claude | **xhigh** |
| Completion-AUDIT of Codex output | Claude only | — never trust Codex self-reported "done" (100%-claimed / 5%-real specimen) |

Codex fan-out is a **separate rate bucket** from the ≤2-3 concurrent Claude-
dispatch law. [g3:66-75 → skills-audit-notes.md:180-181]

### Mine-context line cites — `jsonl_line=N` NOT digest §N

`prepare-mine-context.py` emits **`jsonl_line=N`** for grep excerpts — these are
**raw JSONL line numbers** (1-based `enumerate` over the file). Session-miner digest
**§N / event indices are NOT jsonl lines** — misciting them produces false evidence
(singles#2). Miners grep the raw JSONL by `jsonl_line=` only.

### Dispatch brief validation (before send)

Run `scripts/validate-dispatch-brief.py` on every rendered §EDITS worker brief **before**
dispatch. It checks required sections (`Scope`, `Sources`, `Mechanics`) and that the
findings JSON schema fence is intact — one brief shipped truncated (singles#3).

Briefs that point workers at skill files MUST use the real path: skills live at
`$HOME/.golems/skills/golem-powers/` (registered via `~/.claude/skills/` symlinks);
`$HOME/Gits/golem-powers` does not exist — a brief pointing there strands the worker.

**Pointer-brief law (2026-07-02 fleet standing contract):** pane sends are
**one line** ("Read and follow `<file>`") — the payload lives in the brief/collab
file on disk with report path + DONE marker + green criteria. Boot prompts >1
paragraph get CHUNKED on idle panes and wedge them. The discharge harness stays
**engine-agnostic** (briefs on disk + one-line pointers) so Codex↔Cursor swap in
minutes. [g1:99-100 → 2026-06-06-evening.md:47-48,53-55; g2:22,31]

### 2e. Review the harness script BEFORE you launch it (NEW pre-launch gate)

Any **new workflow-shape script** gets a two-reviewer pre-launch pass — one for
**contract-compliance**, one for **does-it-regress-a-proven-guardrail** — before
the first spawn spends a single agent. Proven at cost: a pre-launch review of an
un-run tree harness returned **"do NOT launch as-is"** and caught 3 P0s /
"reproduces at least 4 failure modes we already paid for". [g3:31-38 →
tree-wf-review-design.md:7,175-184; tree-wf-review-priorart.md:5]

### §EDITS worker evidence greps — scope to cited files/ranges

Worker prompts MUST scope evidence verification to the **files and line-ranges the
ledger already cites** — never directory-wide `rg` over `~/.claude/projects` or the
whole weave run dir. Unscoped greps burned one worker to compaction before edits
started (09-59-00#6).

### Delta wave — sessions keep writing while the weave runs (Etan, 2026-06-09: "make sure there is an extra weave of sessions currently in sesssion, so we dont loose whats in progress")

The corpus freezes at `discover`; live sessions keep appending during mining. **Standing step:**
1. At pass-1 launch, snapshot per-session line counts → `<WD>/delta-baseline.json`.
2. At convergence (fleet quiet / operator close), snapshot the grown files (stable copies); any session grown >20 lines → a **tail miner** scoped `[baseline−200 .. end]` (overlap dedups at aggregate); any session born mid-run → full miner. Suffix outputs `__delta.jsonl`, same schema/rubric.
3. Re-aggregate after the delta wave so the ledger covers the whole run window. (Gen-15 proof: the delta caught orc's PR-sweep/close era — 83 findings pass-1 would have lost.)

### 2f. Retro fold — 2026-07-28 shuttle + 2026-08-24 monthly (R-049 discharge)

> Folded 2026-08-24 by the weave seat. These are measured lessons, not proposals; each cites its retro line.
> Source retros: `$ORCHESTRATOR_ROOT/weave-records/retros/2026-07-28-shuttle.md` (v2 addendum) and `…/2026-08-24-monthly.md`.

**From the 07-28 shuttle (10 lessons, previously unfolded — `rescore.md §3` scored 0/10):**

1. Session-atomic units + stride-with-guaranteed-tail contexts from R0 — removes the double-count class by construction (shuttle retro:20-21).
2. Historical 2026-07-28 evidence: an audit checkpoint after mining (CP1, opus, "re-derive claimed state") caught 5 real defects incl. an imp-10 cite pointing at an agent paraphrase of Etan (:22-23). Run the current checkpoint with `claude.judgment`, resolved through `node scripts/model-roles.mjs claude.judgment --field model`; choose phase effort and pass it explicitly.
3. Verify in importance-descending order — it saved the run twice when a limit cut landed at the imp-8 boundary (:24-25).
4. Workflow `args` >4096 elements dies at the VM boundary — embed work lists in the script (:26).
5. Recovery after a spend limit: 1-agent probe → fresh workflow over the disk-diff of missing outputs; never `resumeFromRunId` against a live limit (:27-28).
6. Cost reality: cache reads, not output, are the spend (4.4B cache-read tokens). Bound agent-count × tool-turns (:29-30).
7. Delta verifiers MUST get the snapshot-root override in their prompt — V1 FAILs from wrong-root greps are a measured class (v2 #1).
8. A reset time is not a wake signal — arm a clock monitor (v2 #2).
9. Zero-ref rule cutting needs a blue-critic adjudication pass — 9/11 mechanical candidates were invalid (v2 #3).
10. GRILL-CARRYOVER (verbatim rulings routed per remaining grill repo) is the highest-leverage deliverable per operator — write it early, not last (v2 #4). Added to the §5 (outputs-and-coordination.md) emit list as item 3.

**From the 08-24 monthly (Etan rulings and measured harness facts):**

- **Lead reads syntheses, never raw miner output.** Etan: "You're not supposed to waste a fable token on reading these type of stuff." Direction reports → a convergence lens; findings → a synthesis lens; the lead reads ≤250-line syntheses and routes. Reading a worker report into the lead's context is a violation, not a shortcut.
- **Headless fan-out must announce itself.** Etan: "I dont see a weave." A codex-workflows (no-pane) gather is legitimate under §2c, but the lead posts "this fan-out is headless/invisible; N workers; manifests at <path>" at launch — the operator must never discover it by asking who spawned a pane.
- **Lineage, not no-spawn.** Etan (verbatim): "I dont hate that it spawned a codex sol for something, I just wish skillcreator lead would have known its its grandchild." Headless workers inherit the control-plane MCP and CAN spawn. Every worker brief requires `artifacts/children.json` (`{agent_id, surface, cli, model, title, purpose, state_at_exit}`) and names children in its report. The §3 miner skeleton now carries the `children.json` line; `scripts/weave-cursor-run.py` (prompt emitter + status check) and `weave-run.py status` must emit and check it too — owed (golems FOLLOW-UP, cause_layer: code), as is a `children` field in the codex-workflows manifest — registry R-046.
- **Local concurrency is an operator-facing cost.** ~40 local codex workers + BrainLayer daemons pushed load avg to 47.85 and stalled Etan's typing; ~27 workers with daemons stopped was ruled fine. Probe `uptime` before each wave; cap local workers ≈25; run queues with an atomic claim (`mkdir lock-<id>`), never a sequential loop that has to be killed to re-shape.
- **Worker `gh` fails inside the codex-workflows sandbox on first call.** Six miners recovered on an escalated retry; five shipped "unavailable" and lost signal. Brief: escalate on the first `api.github.com` error. Lead: pull merged-PR lists itself (`gh pr list -R <owner/repo> --state merged --search "merged:>=<window>" --limit 500 --json number,title,mergedAt` — `gh` defaults to 30 items; set `--limit` above the window's count or paginate, and assert `count < limit`) as the free evidence upgrade.
- **V1 verifier carve-outs (measured: 0 of 104 Luna FAILs survived Opus appeal across 7 rounds).** The same carve-out applies to the §3 denominator predicate (see the denominators bullet below). Six systematic verifier errors, now mandatory in the V1 brief: (1) long `tool_result`/multi-paragraph records are not "empty" — read the full line, `grep -n -F` the quote before calling it absent; (2) `promptSource:"queued"` and `sdk`+`entrypoint=sdk-cli` are operator speech; `sdk`+`sdk-ts` is a lead relay; `typed` is direct user capture by default (consistent with `/never-fabricate` §direct-capture) and is downgraded to relay ONLY on evidence — a `send_to` delivery receipt (live 9-tool surface; the pre-cut send tools count the same) in a lead session targeting that pane, or third-person self-attribution in the turn ("Etan has ruled…" — measured specimen cmuxlayer__d05bc84f#1). A shared provenance predicate used by weave and never-fabricate is owed (FOLLOW-UP, golems) so the two consumers cannot diverge; (3) `voice_ask` and `AskUserQuestion` tool_results ARE Etan speaking/typing — never reject them as tool_result; (4) verify `checked_lines` covers the cited `jsonl_line`; (5) ellipsis/backtick/markdown differences are not verbatim failures; (6) a "correction attributed to Etan" in a session where no operator turn mentions the topic is a FABRICATED-ATTRIBUTION finding → CORRECTED + importance cut. The appeal round is not optional; its rescue rate is V1's health metric.
- **Denominator VALUES come from the harness; miners copy, never count.** One owner per step, consistent with §3 and §4i (verification-and-discharge.md): `prepare-mine-context.py` COMPUTES `user_messages` + the resolved model into the context header (both formats — Codex support owed); each miner COPIES the header into `<label>.denominator.json` (§3 contract unchanged); `weave-run.py aggregate` COMPILES the sidecars into `correction-denominators.json` (automation owed; until then the lead runs the fold script). Miners wrote generic model names ("claude"); Codex contexts carry no `user_messages`. Resolve model per session from the raw JSONL `"model":` field (majority, above 80% or `mixed:`), normalize to a fixed set. **Never drop a correction because its model has no denominator** — keep it in the corpus, the ledger, and the per-model correction COUNT; mark that model's per-100 rate `unavailable` (the fail-closed contract in §4i (verification-and-discharge.md) and `scripts/corrections-rate.py` stands: a missing denominator is a hard error for the RATE, not a reason to shrink the numerator). Until `prepare-mine-context.py` emits `user_messages` for Codex, Codex has counts but no rate; say so. **Denominator predicate carve-out owed:** `prepare-mine-context.py:is_claude_operator_turn` still rejects every content list containing a `tool_result`; `voice_ask` and `AskUserQuestion` results are operator speech and must count in `user_messages` — until that lands, Claude rates are slightly inflated on voice-heavy sessions; disclose it.
- **codex-workflows defects to route (cause_layer: code):** `harvest` aborts the whole run when a declared optional artifact is absent (copy from worktrees instead); `failed_launch` can occur with no log or diagnostic; `parallel` has no concurrency cap.
- **tmp-block reads `k > 7` inside a heredoc as a redirect** — write helper scripts with the Write tool when comparisons are involved.
- **Shape honesty:** the 08-24 run used capped queues + Opus singletons, not the canonical one-expanding-Workflow (§4g (verification-and-discharge.md)). Verification quality held (0 refuted) but the round agenda was hand-driven. Run R2/R4 as a Workflow when the operator says "use a workflow"; otherwise script this fallback end-to-end (fold → collect → adjudicate → aggregate) rather than hand-driving it.

### Miner-prompt hygiene — counter/footer leak guard

Agents inheriting global CLAUDE.md rules append `CLAUDE_COUNTER: N` to returns and occasionally into findings files. Keep the "reply exactly: WEAVE_MINE_DONE …" contract AND **scrub findings files before aggregation** (drop non-JSON lines) — `weave-ledger.py` counts them malformed otherwise (one leaked line scrubbed in gen-15). (Sonnet miners' `CLAUDE_COUNTER: 1` footer can also mask the DONE receipt → disk-truth > receipt.) [g1:26 → 2026-06-03.md:28]

### Harvest sweep + placement pass — research artifacts (standing, Etan 2026-06-10)

Before synthesis: sweep `~/Desktop` + `~/Downloads` (Claude-side: `compass_artifact_<UID>*`, hand-pasted `.rtf/.rtfd`) + the Drive route (Gemini-side) for research artifacts in the run window; save text exports to `<WD>/reports/`, `brain_store` conclusions. At close: the **placement pass** — every research gets its own folder with its owning context (large-plan/design-doc/sprint), moves are deliberate (verify destination first), Desktop originals surfaced to Etan before removal. See claude-desktop-research's OUTPUT-PLACEMENT CONTRACT.

### Context-file hygiene — standing weave step (Etan via orc, 2026-06-09: "Whenever we do the weave, this might be something we send to the skillCreator who does the weave")

Every weave checks whether context files need surgical improvement and routes it: audit the CLAUDE.md/AGENTS.md hierarchy against the 3-layer model (Letter ≤~50 lines intent prose / path-scoped `.claude/rules/` / BrainLayer episodic), flag accumulation-bloat violations, and **promote recurring registry families (`recurring=true`, BROKEN-OPEN) into `.claude/rules/` files at §4c (verification-and-discharge.md)** — the stream author's "only encode repeated mistakes," mechanized. Findings route through the ledger like everything else.

### Corpus discovery — deliberate self-exclusion + orcui attribution

- **`discover --exclude-self <stem>`** records the exclusion in
  `corpus-manifest.json` → `deliberate_exclusions[]` with reason (not silent skip).
  `discover` also skips `subagents/` noise sessions (`_is_noise_session`). [g1:80 → 2026-06-01.md:9,35]
- **Self-exclude prior-run miner transcripts by content marker** — a prior weave's
  own miner outputs must not re-enter the corpus as fresh findings; exclude them by
  a content marker, not just path. [g1:80 → 2026-07-10.md:29; meta:45]
- **External-repo anecdote tag:** `discover` tags non-sprint / non-fleet repos
  (e.g. matchmat) as **anecdote-class** — excluded from fleet-evidence weighting,
  not silently mixed with fleet findings. [g1:98 → 2026-07-10.md:23; meta:47]
- **orcui-LEAD** sessions may write into the orchestrator projects dir — attribute
  sessions by **prompt identity / session stem**, not repo path alone.
- **Gemini-side artifacts** (Etan-fired in UI) are a future corpus modality — note
  in manifest when excluded from JSONL discovery.
- **Artifact-cluster mining is first-class:** Cursor clusters with no JSONLs are a
  real corpus modality (4 clusters → 53 findings in one run), not a skip. [g1:81 → 2026-06-07.md:25]

## 3. The miner contract (per session)

Each miner emits a findings JSONL — one object per line — at
`<WD>/findings/<label>.jsonl`:

```json
{"id":"<label>#N","title":"...","detail":"...","evidence":"verbatim — source ref [line N]","type":"correction|frustration|anti-pattern|skill-gap|skill-candidate|decision|residual-bug|what-worked","track":"cmuxLayer|BrainLayer|VoiceLayer|MCL|MCP-layer|skill-creator|dashboard|plans|collab|cross-cutting","disposition":"MERGED-PR|PR-FILED|PR-FIX|SKILL-NEW|SKILL-EDIT|DEEP-RESEARCH|FOLLOW-UP|REJECTED|PARKED|KEEP|DUPLICATE","importance":1-10,"recurring":true|false,"session":"<required for correction>","model":"<required for correction>","bucket":"wrong-impl|taste|process|misread|tool-misuse|overbuild","ts":"<required for correction>"}
```

For every `type:"correction"` finding, `session`, `model`, `bucket`, and `ts` are required;
non-correction findings omit them. Every miner also writes
`<WD>/findings/<label>.denominator.json`, including for a session with zero corrections:

```json
{"session":"<stable session id>","model":"<runtime model>","user_messages":42}
```

Aggregation requires one denominator sidecar per mined session, counts each stable session once,
and sums `user_messages` by model into the `--denominators` JSON object used by §4i (verification-and-discharge.md). The count is
copied exactly from the `**user_messages:** N` header that `prepare-mine-context.py` computes while
scanning the full source JSONL; miners never count excerpts, run `grep -c`, or invent the number.
For a Claude transcript the counted predicate is concrete: top-level `type:"user"`, excluding
`isSidechain` and `isMeta` rows, any content list carrying a `tool_result`, empty content,
system-reminder injections, slash/local-command expansions (`<command-name>`, `<command-message>`,
`<local-command...>`), and relay rows whose flattened content begins `<queue-operation>`,
`<last-prompt>`, or `<task-notification>`. What remains is operator speech. Zero-correction sessions
still belong in the denominator.

Disposition → conversion class (what `weave-ledger.py` enforces): **converged** =
`MERGED-PR`/`PR-FILED`/`PR-FIX`/`SKILL-NEW`/`SKILL-EDIT`; **open** =
`DEEP-RESEARCH`/`FOLLOW-UP`; **dropped** (reason REQUIRED) =
`REJECTED`/`PARKED`/`DUPLICATE`; **confirmation** (excluded from the refined
denominator) = `KEEP`. (`PR-FILED` = PR opened but not yet merged;
`FOLLOW-UP-FILED` is accepted as an alias of `FOLLOW-UP`.)

Rules (inherit `/never-fabricate` + the `session-miner` discipline): verbatim
evidence with a `[line N]` or `digest §N` cite; miners cite the **raw `type:user`
turn**, not the `brain_store` paraphrase line [g1:70 → 2026-06-01.md:37]; no
`brain_store` (files only); dedup; suppress loop/cron noise; an empty session → an
empty findings file, never an invented one.

> **Miner rule — chase `gh pr view`/git for any "never landed" claim**, not the
> incident narrative. A "PR never merged / fix never shipped" finding is not
> evidence until a `gh pr view` / git check confirms it. [g1:77 → 2026-07-10.md:23,37]

**Dispatch (the bridge between `batches` and `aggregate`):** spawn miners that take K
sessions each (`topology.md` § Fan-out prompt shape; **waves of 4–6 concurrent** — the frozen 100%-coverage recipe;
~4-6 typical (recipe, not a hard cap)), centerpieces first. Two equivalent mechanisms: [g1:68 →
2026-06-01.md:36; 2026-06-07.md:8]

This is **new/manual orchestration guidance**, not a runtime batching change.
`weave-run.py batches --size` remains a **session-count limit**, not a miner count
or concurrency cap. Regroup its `batch-manifest.json` explicitly:

1. Flatten `batches[*].sessions` in manifest order across all slices. Keep each item
   intact, including its exact `label`, `src`, `ctx`, and `out` paths; never interpolate
   raw labels into filenames (the manifest already normalizes `/` to `__`).
2. Extract centerpiece items into dedicated single-item miners and run them first.
3. Partition the remaining items into consecutive K-sized groups, keeping the short
   final group. For example, 100 ordinary sessions at K=10 become 10 miner groups,
   even when the planner emitted 20 slices via `--size 5`.
4. Put each group's items in the prompt's final ITEMS section. Set `denominator` and
   `children` paths by replacing that item's `out` suffix `.jsonl` with
   `.denominator.json` and `.children.json`; keep the exact manifest `ctx`/`out`.
5. Schedule at most C groups concurrently (e.g. C=5), independently of K and `--size`.
   With a reusable common boundary, optionally await a K=1 seed or the full seed batch
   before siblings; the K-label receipt is returned only after the entire batch.
   Verify disk outputs after each wave, then replan missing sessions until dry.

`weave-cursor-run.py` remains **one-session-only**: it asserts exactly one session,
uses an item-first prompt, and does not implement K batching. `--chunk-size >1` is
unsupported; migrating its runner/prompt is a separate follow-up.

- **Workflow (preferred for staged mode):** a `pipeline`/`parallel` of `agent()`
  calls, each given the miner prompt below + a findings JSON schema; the workflow
  writes each result to its manifest `out` path. **Schema-return is fine only
  for ANALYSIS agents**, wrapped in `parallel` `.catch(()=>null)` — never for the
  file-writing miners (see the write-gap below). [g1:67 → 2026-05-31.md:105-106]
- **`session-miner` sub-agent / Task calls** from a skillCreator session (the
  sub-agent is skill-creator-scoped): dispatch N `Agent(subagent_type="session-miner", …)`
  in one message.

Miner prompt skeleton (**return-then-write: write the files, NO competing schema**).
STATIC first and byte-identical across the wave; all paths belong in ITEMS last:
```
You mine weave sessions. For EACH item in ITEMS below, in order: read its exact ctx path
(digest + grep excerpts). For verbatim quotes, grep the raw JSONL
by **jsonl_line=N** from the Grep excerpts section — never read the whole file. Digest §N is NOT
a jsonl line. Emit findings (the JSON schema above), one per line, to
the item's exact out path; every correction includes session/model/bucket/ts. Copy the exact
user_messages value from that context file's header into
the item's denominator path with session/model/user_messages even when the findings file
is empty. Never recount or estimate it. If you spawn ANY child agent (cmux spawn_agent, t3layer,
sub-agent), write the item's children path — a list of
{agent_id, surface, cli, model, title, purpose, state_at_exit} — and name each child in your reply;
write an empty list if you spawned none. Files only — no brain_store.
Write ALL files for a label before starting the next. When every label is done, reply exactly one
line per label: WEAVE_MINE_DONE <label> <count>.

ITEMS:
{label: ..., src: ..., ctx: ..., out: ..., denominator: ..., children: ...}
... (K items, exact manifest paths and derived sidecar paths)
```
[g1:66 → 2026-05-30.md:93-98; 2026-05-31.md:103; 2026-06-06.md:12]

**VERIFY ON DISK — do not trust the agent's word (the weave's own thesis, applied to itself).**
A miner may report success in its return value yet never have written the file
(observed live: a forced structured-output return competed with the Write step,
so ~70% of a 102-agent run self-reported `wrote_file:true` with **no file on
disk**). The findings FILE is authoritative, not the agent's claim. After every
batch run `weave-run.py status --workdir "$WD"` (it checks the actual files), and
**re-mine any session with no file** — with the file-Write as the terminal
deliverable and NO competing return schema. Loop batches until dry.

> **DESIGN SPEC — harness implementation pending (ships with the substrate-law + phase-recursion + final-boss bundle).**

**Fan-out sanity — `batch_count == 0` is a DEFECT, not a fallback (2026-07-10).**
A verify/mine level that silently ran **0 sub-agents** (they lacked fs/Write) and
let a solo agent "fake the fan-out" is a **coverage-loss defect**. **Abort or flag
any level where `batch_count == 0`** — a single-agent fallback is not a
compensation. Guard `res == null` explicitly, surface `failed[]` coverage-loss,
and put a **coverage-verify `agent()` between tree and fold** that `ls`/`wc -l`s
the expected node keys. [g1:95 → 2026-07-10.md:27; g3:40-52 →
tree-wf-review-priorart.md:37-38; tree-wf-review-design.md:54-57,84-87]
