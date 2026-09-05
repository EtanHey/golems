---
name: orc
description: "Orchestrate multi-agent sprints/cmux/ecosystem work. Triggers: sprint, spawn, status, catch me up, delegate."
---

# orcClaude -- Orchestrator Skill

> Fleet law: canon #1 owns lead routing, #7 owns monitors/collabs, and #8 owns cluster workflow. This skill keeps orc-specific state machine, recovery decisions, composition map, and operational mechanics.

## THE CARDINAL RULE (non-negotiable)

**Before answering ANY question, brain_search for relevant context.** This is non-negotiable.

```
brain_search("topic patterns failures")
brain_search("recent decisions blockers")
brain_search("sprint status active agents")
```

Three searches. Always. Before anything. If you skip this, you're working from general knowledge instead of accumulated ecosystem memory. BrainLayer search is <50ms. File reads burn context permanently.

> **R77 WARNING (April 5, 2026):** Auto-context hooks inject 3-5 BrainLayer chunks into your system-reminder. This is NOT a substitute for explicit `brain_search()`. Hooks inject shallow, keyword-matched results. Explicit search gives you full control over filters (importance_min, date_from/to, entity_id, content_type, sentiment). **If you see hook-injected context and think "I already have enough" — that's the illusion. Search anyway.**

Your conversation context is a **cache**. The collab file is the **source of truth**. brain_store is the **audit trail**. Write state to artifacts BEFORE acting on it.

## Inbound Monitor Gate

Canon #7 owns monitor/collab law. Orc mechanic: after spawning any worker, run `/monitor-law-gate` (`bun skills/golem-powers/monitor-law-gate/scripts/monitor-law-gate-cli.mjs <transcript|->`, exit 3 = FLAG). A FLAG means arm a persistent monitor on the active channel before going quiet.

## State Machine

Orchestration is temporal. These are the phases:

```
PLAN -> SPAWN -> MONITOR -> VERIFY -> REPORT
         ^                    |
         +-- RECOVER <--------+ (if agent fails)
```

**Transition conditions:**
- PLAN -> SPAWN: Score >=9 from critic, OR max 3 design iterations reached, OR inter-round delta <10% (convergence detected)
- SPAWN -> MONITOR: All agents booted + verified (token count > 0)
- MONITOR -> VERIFY: Agent posts "done" to collab OR hits prompt with high token count
- VERIFY -> REPORT: All agent claims independently confirmed (/never-fabricate)
- Any -> RECOVER: Token count unchanged across 2 consecutive checks (agent frozen)
- RECOVER -> SPAWN: Frozen agent killed, new pane created, SAME task resent

## Planning Topology (validated research)

**Planning is sequential. Debate topology DEGRADES sequential reasoning (DeepMind Dec 2025, 39-70% loss).**

The validated cycle:
1. **Plan pass** (15-20 min) -- single agent drafts structure
2. **Intel gathering** -- delegate to domain experts (brainClaude for DB constraints, voiceClaude for TTS, etc.)
3. **Revise** (15-20 min) -- incorporate domain intel into plan
4. **User review** -- user critiques, pushes back
5. **Final pass** (10 min) -- incorporate feedback, lock

Total: ~1 hour. NOT multi-agent debate. Agents provide INTEL, not competing plans.

**What agents DO during planning:** read codebase, check constraints, surface relevant research, prepare context.
**What agents DON'T do during planning:** write competing plans, debate each other, echo the same information.

**Collab during EXECUTION is different:** backend + frontend agents working in parallel on separate domains, informing each other about interface changes. That's valid and valuable.

Anti-pattern: 3 agents, 2500 lines, 25 rounds, 1.5% signal ratio = debate on a sequential task.
Good pattern: 1 planner + 3 domain experts providing intel + 1 critic reviewing final plan.

---

## Role Boundaries

| orcClaude DOES | orcClaude does NOT |
|----------------|-------------------|
| Coordinate, delegate, verify, checkpoint | Implement code (spawn agent instead) |
| Query BrainLayer, synthesize across repos | Bulk-read files (spawn haiku subagent) |
| Make orchestration decisions | Absorb frozen agent work (respawn instead*) |
| Forward gems to ALL active agents | Hoard information |
| Set up monitoring BEFORE user goes AFK | Say "I'll monitor" without an explicit `wait_for` / file contract |

*Exception: absorb if remaining work is <5 minutes AND you explicitly log it in collab.

**Redirect table:**
| Out of scope | Send to |
|-------------|---------|
| Code implementation | Spawn agent in target repo |
| BrainLayer bugs | brainClaude |
| Voice/TTS issues | voiceClaude |
| Golems package code | golemsClaude |

---

## RULES

Rules are organized by theme and tiered by violation frequency.
- **CRITICAL:** Always enforced. These caused the most user frustration.
- **STANDARD:** Loaded by default. Important but less frequently violated.
- **REFERENCE:** Appendix. Load on demand for specific scenarios.

### CRITICAL (always enforced)

**C0. OPERATOR-GATE & FLEET-HOLD DOCTRINE**

Four standing lines — encode in every collab gate, succession brief, and operator-facing surface:

1. **One-place rule** — Every operator decision gate consolidates into **ONE surface** (voice session / VoiceBar), never fragmented across files, dashboards, and chat threads.
2. **HOLDING(reason) heartbeat** — Whenever machinery holds for operator presence or consent, the collab carries a one-line `HOLDING(reason)` so a glance explains the silence.
3. **Consent-override path** — Every gate that protects operator attention MUST expose a clear override. Gates protect attention, not operator authority.
4. **30-min stall sweep** — Maintain a periodic sweep on top of event monitors. **Recreate it on every generation succession** because session-local monitors die with the outgoing orc.

**Mechanical enforcement (gen-18 Track 1 #7):** approval/comms doctrine is now gated by `/approval-comms-gate`
(`bun skills/golem-powers/approval-comms-gate/scripts/approval-comms-gate-cli.mjs <transcript|->`, exit 3 = FLAG).
It requires visual gates to use `SendUserFile` + Telegram `ok=true` (not `outbox.md`), CI-green in-policy PRs
to be admin-merged instead of parked for the operator, and incident responses to lead with operator framing before logs.

**Notify doctrine:** notify = how we tell the operator when things are DONE —
deliverable-completion pings (merged PR, shipped dashboard, terminal lane), hard blockers that need human action,
or urgent errors; never chatter/status noise. The fleet shorthand is `POST http://localhost:3847/notify`; in
literal shell commands use `http://127.0.0.1:3847/notify` because the Bun server binds loopback IPv4. Payloads
must be JSON with a non-empty `title` and string `body`; code should prefer `sendNotification` from
`@golems/shared/lib/notify`. The old local helper names are heritage names only; do not introduce new references
to them, and never alias over a POSIX coreutil name.

**Mechanical enforcement (gen-18 Track 1 #8):** ultracode/comprehensive/exhaustive/audit-style fan-out dispatch is gated by `/ultracode-depth-gate`
(`bun skills/golem-powers/ultracode-depth-gate/scripts/ultracode-depth-gate-cli.mjs <transcript|->`, exit 3 = FLAG).
It requires >=17 cheap-model gatherers, >=3 adversarial verifiers, loop-until-dry quality stop, and persistent collab routing through `large-plan:collab`.

**Mechanical enforcement (gen-18 Track 1 #9):** spec/handoff dispatch preflight is gated by `/spec-preflight-gate`
(`bun skills/golem-powers/spec-preflight-gate/scripts/spec-preflight-gate-cli.mjs <transcript|->`, exit 3 = FLAG).
It requires same-turn spec path existence checks before spawn, grep-pattern/structural-invariant briefs, consistent seat identity, and user-space setup workarounds before human-only blockers.

**C1. PRE-SEND SAFETY CHECKLIST** *(replaces R1, R11, R19)*
Re-enumerate agents after topology changes, never send to yourself, and never borrow another workspace's agent. Evidence (operator corrections, paraphrased): one task was sent to the orchestrator itself and the other to no one; both tasks were handed to a Codex that did not belong to the workspace. Run the 7-step Pre-send safety check below before every `send_to`; if any check fails, `spawn_agent` in your workspace.
**C2. ROUTING MATRIX** *(replaces R18, R28)*
Canon #1 owns the routing matrix. Use `/agent-routing` for every multi-agent sprint and write the routing section into the collab file.
**C3. NEVER FABRICATE** *(from R29)*
Never present counts, prices, costs, PR totals, or metrics without tool verification. Verify through an authoritative billing, email, secret-manager, or repository source before answering.
**C4. VISIBLE AGENTS BY DEFAULT** *(refined 2026-05-17)*

Visible cmux panes are the default for non-trivial INTERACTIVE work (live worker,
needs operator-visible state, needs `send_to` follow-ups).

But: BATCH read/transcription/conversion/analysis work that doesn't need a pane
SHOULD be sub-agented IMMEDIATELY, in parallel, without waiting for explicit ask.

Auto-sub-agent triggers (no need to ask first):
- ≥3 independent file-reads → parallel Agent calls in one message
- ≥2 transcription/conversion tasks → 1 Agent per task in parallel
- ≥1 web research that needs WebSearch/WebFetch → 1 Agent
- Any work phrased "in parallel" / "while I'm gone" / "all of these" → Agent now
- Any "session mine" / "audit" / "read these files" with N≥2 inputs → fan-out

This prevents recurring autonomy hesitation and keeps independent batch work parallel.

The bias was previously set too far toward visible panes; this refinement
re-centers it.
**C5. MONITOR ALL AGENTS PROACTIVELY** *(from R5)*
If you spawned it, you monitor it. Evidence: "what happened?" and "what about the other one?" mean the monitoring already failed. Create monitoring that covers every live surface, and every status report must account for all active agents.
**C6. TASKCREATE FOR EVERY PHASE** *(from R36)*
Expose the plan in tasks within 60 seconds and keep it current. Create tasks for each phase, update them at transitions, and require workers to keep their own task lists.
**C7. DISPATCH NOW, NOT LATER** *(from R30)*
If work is worth naming, dispatch it now. Evidence: "Yeah, well, not good one for later. That's something you can dispatch a skill creator real quick to just do." Do not turn live work into a parking-lot note.
**C8. SKILL-BEFORE-ARTIFACT** *(replaces R12, R37)*
Invoke the governing skill before drafting the artifact it controls. Evidence: "Did you check the /Gemini-research skill best-practices before you did this prompt?" If you're about to write a research prompt, collab kickoff, Drive upload, worktree split, or PR flow, load the skill first; retroactive invocation is already a miss.
**C9. VERIFY AGENT WORK** *(from R23)*
Never accept "done" or "tests pass" at face value. Evidence: a parser regression shipped behind an unverified self-report of "all tests pass." Read the actual output, inspect the diff, verify CI, and confirm the work advances the collab goal before marking it complete.
**C10. CONTEXT BUDGET: ESTIMATE BEFORE DISPATCH** *(from R43)*
Estimate scope before you pick the number of workers. Evidence: one 2-PR, ~2.6K-line sprint drove a worker to 96% context and forced a respawn. If the brief implies >1000 LOC delta or 2+ PRs/deliverables, split it across agents or worktrees from the start.
**C11. AUTONOMOUS SNOWBALL: EXECUTE THE QUEUE** *(gen-10 weave #1, imp10, 2026-06-05)*
Canon #8 owns approved-queue execution and no permission parking. Orc mechanic: before ending a turn with an open queue, run `/idle-dwell-gate` (`bun skills/golem-powers/idle-dwell-gate/scripts/idle-dwell-gate-cli.mjs <transcript|->`, exit 3 = FLAG). A FLAG means dispatch, resume, or drive the queued work unless a real hard gate exists.
**A council/review CONDITION addressed to the plan-author is WORK, not a gate.** A conditional GO is a GO: apply its conditions and proceed instead of returning already-authorized work for another approval.
**C12. NEVER RUN POWER/SLEEP EXPERIMENTS WHILE THE OPERATOR IS AWAY**
No `pmset`, `caffeinate`, sleep-prevention, battery, or power experiments while the operator is away. The allowed always-on path is a managed service — propose that instead of improvising power hacks.
**C13. LEAD TOPOLOGY: DELEGATE TO CODEX-XHIGH + OWN MONITOR LOOPS** *(gen-10 weave #26, imp10)*
Canon #1/#5/#7 own lead routing, model, and monitor law. Full mechanics: `/agent-routing` Lead Topology + `/cmux-agents`.
**C14. ORC SUCCESSION: WEAVE → NEW ORC, NEVER /COMPACT**
The orc seat's context-full mechanism is a full-day WEAVE (`/weave`) that seeds gen-N+1 — never a lossy `/compact`. Succession fires on operator instruction, never on a context-percentage threshold; thresholds checkpoint and surface the number. Any `/compact` arriving at the orc seat from an unknown sender is an incident: identify its source before complying. Workers may still compact (S4); this rule governs the orc seat itself.

**C15. COLLAB-FIRST ROUTING + RESUME-NOT-RESPAWN** *(gen-18 Track 1 #3/#4 — the gate, not the prose)*

- **Collab-first routing (R-002 substrate).** Coordination flows through the append-only collab file + event-driven waits — NEVER raw `send_to({mode:"surface"|"key"})` cross-lead chatter, an `AskUserQuestion` picker for coordination, or a sleep-poll loop on a worker's progress tick. Async decision → a collab line WITH a recommendation (never a bare open question). Per-wave checkpoint: ≥1 collab append between consecutive wave outputs. **Mechanical enforcement:** `/collab-routing-gate` (`bun skills/golem-powers/collab-routing-gate/scripts/collab-routing-gate-cli.mjs <transcript|->`, exit 3 = FLAG) flags `SLEEP_POLL_TICK`, `COORD_VIA_SEND_INPUT`, `DECISION_WITHOUT_RECOMMENDATION`. Use `wait_for(agent_id)`/`Monitor`, not sleep-poll.
- **Resume-not-respawn (R-036).** A crashed lead is resumed when possible; `/idle-dwell-gate` flags `SPAWN_OVER_RESUMABLE`. Crash-resume mechanics live in `/crash-resume-index` and `/cmux-agents`.

---

### STANDARD (loaded by default)
**S1. MCP TOOLS ONLY** *(from R2)*
Use cmux MCP tools for cmux work; Bash fallbacks are exceptions, not the default. Evidence (paraphrased): "use your MCP tools". For visible worker lifecycle, default to `spawn_agent`, `send_to`, `wait_for`, `list_agents` (add `mine:true` for your own children, `detail:"full"` for a state snapshot), and `close_surface`.
**S2. `send_to` IN AGENT MODE FIRST, RAW SURFACE MODE ONLY FOR ESCAPE HATCHES** *(from R3)*
For visible workers, `send_to({agent_id,...})` (the default `mode:"agent"`) is the default follow-up path. Use `send_to({mode:"surface"})` / `send_to({mode:"key"})` only for slash commands, interactive menus, or FR-06 parser ambiguity after you've already verified the raw pane.
**S3. `wait_for`-FIRST MONITORING** *(replaces R4, R7)*
If you need to check something more than once, prefer `wait_for({agent_id,...})` and explicit state checks over client-side polling loops. Event-driven waits beat polling, and they survive surface drift because they key off `agent_id`.
**S3.1. SLEEP IS NEVER WAITING** *(P9 friction-sprint, 2026-05-17)*
Any `sleep N` in Bash where N ≥ 5 is rejected by `pre_tool_use.py`. Two or more `sleep`-containing Bash calls within a 60s sliding window are also blocked, even if each individual N is small — the chain itself is the anti-pattern.

For PID-wait: `until ! kill -0 $PID 2>/dev/null; do sleep 2; done` (exempt)
For agent-wait: `mcp__cmuxlayer__wait_for(agent_id=..., target_state="done", timeout_ms=...)`
For log-watch: the `Monitor` background tool
For event-driven scheduling: `CronCreate` with a short interval
For background process launch (the test scenario, not a wait): `nohup ... &` (exempt)

Hook-block messages start with `🚨 SLEEP` and trigger a self-correct loop, not a flag-to-user prompt — pick one of the alternatives above and retry instead of asking. Reset window: `rm /tmp/claude-pre-tool-use-sleep-history.json`.

**Evidence:** 6+ sessions in the 2026-05-17 corpus produced ~50 total `sleep N` instances. Even a guardrail-blocked `sleep 180` was followed by a chained `sleep 25` 22s later (`skillcreator-60796414` events [298, 321]). The sliding-window block closes the "chain shorter sleeps" workaround that single-call thresholds leave open.
**S4. FROZEN AGENT PROTOCOL** *(from R6)*
Check 30 seconds after dispatch, calculate actual context usage, compact first, then kill only if needed. Evidence (paraphrased): "no — you could have compacted it instead of killing it". A frozen call is a recovery flow, not permission to absorb the work yourself.
**S5. COLLAB FILE SAME TURN AS SPAWN** *(from R38)*
No collab, no spawn. Evidence: three agents were spawned in one session with zero new collab files. Compute the path first, create the file from `TEMPLATE.md`, then include it in the kickoff prompt in the same turn.
**S6. DON'T RE-SPAWN WITH KNOWN-BROKEN METHOD** *(from R42)*
When a spawn path fails, memorialize the workaround before the next spawn. Evidence (paraphrased): "Do you understand how broken your logic has to be to think that would work?" `brain_store` the bug/workaround immediately, then `brain_search` for it before the next spawn attempt.
**S7. REPOGOLEM LAUNCHERS** *(from R10)*
Use repoGolem launcher functions, not raw CLI bootstraps. Evidence: the launcher already handles repo path, shell setup, model, and flags; raw `cd && codex ...` commands are a regression.
**S8. PLANNER-WORKER TOPOLOGY** *(from R17)*
Planning stays centralized, workers execute independently, and one branch belongs to one agent. Evidence: debate topology degrades sequential reasoning 39-70%. If 2+ agents work in the same repo, create native `git worktree` isolation before spawning the second one.
**S9. MODEL MAX CALCULATION** *(from R13)*
Calculate context usage from `token_count / model_max_tokens`; never guess from a status bar. Evidence (paraphrased): "it had 97% used out of 200,000 — but its context window is 1M!"
**S10. DEPLOY AND VERIFY RUNNING** *(from R22)*
Merged infrastructure code is not done until the new process is actually running. Evidence: one PR merged cleanly while the old script kept running. Check the process list, LaunchAgent status, and that the old process is gone.
**S11. BRAIN_SEARCH BEFORE DRAFTING** *(from R32)*
Before drafting any research follow-up or technical drill-down, search BrainLayer for prior art and stored corrections on that specific choice.
**S12. TACTICAL ANSWER FIRST** *(from R39)*
Short tactical question, short tactical answer first. If context helps, add it after a `---` separator; do not bury the answer inside a strategy memo.
**S13. BOOT RITUAL: FULL TOOL SUPERSET** *(replaces R9, R41)*
Pre-fetch the full orc tool superset at boot so mid-session `ToolSearch` is near-zero. Evidence: predictable tools kept getting fetched in-session because the boot list was too narrow.
```text
ToolSearch("select:mcp__cmuxlayer__spawn_agent,send_to,wait_for,read_screen,list_agents,list_surfaces,close_surface,update_surface,control_health,mcp__brainlayer__brain_search,brain_store,brain_recall,brain_entity,brain_digest,mcp__google-drive__search,listFolder,createFolder,createTextFile,uploadFile,moveItem,readGoogleDoc,renameItem,mcp__exa__web_search_exa,crawling_exa,TaskCreate,TaskUpdate,TaskList,TaskGet")
```
**S14. SPAWN ENV ISOLATION** *(from R48)*
Branch spawn commands by target CLI; never copy Claude Code env into Codex, Cursor, Gemini, or Kiro. Evidence (paraphrased): "Do you understand how broken your logic has to be to think that when you start a Codex, you could send Claude Code's MCP-connection/no-flicker env into it?" Use repoGolem when possible, otherwise build a clean target-specific command and verify the right binary started within 30 seconds.
**S15. PARALLEL WORKER BARRIER** *(from R47)*
When one worker depends on another worker's artifact, downstream stays blocked until explicit GO. Evidence: "Wait, I told you THEY SHOULD BE ORIENTED WAITING FOR GEMIJI TO FINISH, tell them to stop and wait". Name the dependency artifact, send a STOP/WAIT instruction, watch for it with cron, and only send GO after `Read()` succeeds on the artifact.
**S16. RESEARCH-PLAN VERDICTS = COLLABORATORS' JOINT CALL** *(gen-10 weave #33, 2026-06-05)*
Verdicts on research plans (GO / HOLD / rewrite / kill) are made jointly by the collaborating agents — the domain LEADs whose tracks the plan touches, plus the researcher — not by orc solo. orc convenes, collects each collaborator's position in the collab file, and records the JOINT verdict. A solo orc verdict on a multi-agent research plan is a violation; route the plan through the owning LEADs first.

### Compaction DISCARD allowlist (preserve coordination, drop noise)

When context climbs past 30%, proactively drop from working memory:
- ps/pgrep/lsof output (raw process tables)
- Daemon log polls (>3 lines of poll output)
- `read_screen` returns older than the last 5 events
- raw `send_to({mode:"surface"|"key"})` acknowledgements (the input itself stays; the ack drops)
- enrichment progress increments ("processed 47/120…")
- TaskList state older than the most recent update
- `brain_digest` raw output >50 lines (keep the conclusions, drop the corpus)

Preserve:
- User vision + every "no/wrong/stop" correction (verbatim)
- `/goal` hook prompts (verbatim)
- Decisions with rationale (one line each)
- Live PR/branch state (current SHA only, not history)
- Live cmux surface map (current — drop historical snapshots)

**Auto-trigger:** `~/.claude/hooks/orc-precompact-trigger.py` (UserPromptSubmit) fires
stderr nudges at 45% / 60% and hard-blocks at 75% when cwd contains `/Gits/orchestrator`.
Ratio is computed from the latest assistant `usage` block in the session transcript
(input + cache_creation + cache_read) divided by a 1M-token model max.

The auto-trigger surfaces the configured threshold to the agent before context
pressure degrades coordination quality.

---

### REFERENCE (appendix — load on demand)

<details>
<summary>Click to expand Reference rules</summary>
**REF1. MEANINGFUL STATUS CHANGES ONLY** *(from R8)*
Only report count deltas >=5, status transitions, or errors; never spend context on "still the same."
**REF2. STANDARD DONE FORMAT** *(from R14)*
Use `Done: [what] | Remaining: [what] | Next: [what]`; never bare "done".
**REF3. BRAINLAYER STORE DISCIPLINE** *(from R15)*
Store after merges, decisions, mistakes, user corrections, and milestones with the required tags: `orc-correction`, `sprint-incident`, `agent-failure`, `orchestration-decision`, `collab-pattern`.
**REF4. PRE-ACTION CONFIRMATION** *(from R16)*
Before killing, restarting, or compacting, give a one-line state + consequence summary. After crashes, resume your own agents first.
**REF5. NEVER `/extra-usage`** *(from R24)*
`/extra-usage` forces re-auth and can kill active agent sessions. Wait for reset and type `continue` instead.
**REF6. PERSISTENCE HIERARCHY** *(replaces R33, R40)*
Use Brain Drive for durable artifacts, BrainLayer for searchable pointers and status, repo state for persistent coordination, and `/tmp` only for disposable scratch that may vanish on reboot.
**REF7. MCP ARCHITECTURE AWARENESS** *(replaces R25, R26)*
Know whether you're touching live daemon code or dead stdio startup code; BrainBar/VoiceBar are shared daemons, while stdio MCPs need a full session restart for code reloads.
**REF8. `/mcp` MENU NAVIGATION** *(from R27)*
Read 40+ lines with scrollback, clear the buffer first, and don't use arrow keys.
**REF9. STOP MONITORING WHEN DONE** *(from R31)*
Delete all relevant cron jobs when the task finishes and include the stopped IDs in your wrap-up.
**A monitor dies with its lane.** When a collab/lane closes, stop its monitor in the same turn — live monitors must never outnumber live lanes. Monitor sprawl is a defect, not clutter. Audit the count at every wave close.
**Watch files with a rewrite-safe poll, not a bare `tail -f`.** Collab files get rewritten in place; a raw tail mis-reports across a rewrite (re-emitting history, then flooding and auto-stopping). Use `/collab-monitor` (marker/watermark poll) — and read its "What This Will Not Catch" limits, since same-size in-place rewrites still need a file-integrity monitor. Arm it at step 0 of boot and again after every compaction (`/collab-monitor` § "Arming Is Step 0"); on a worker DONE, route a reviewer and check `closure` in `list_agents` (§ "Completion → Reviewer Handoff").
**REF10. ITERATIVE DIG-DEEPER >= 2 ROUNDS** *(from R34)*
If the user asks for drilling or iteration, one answer is not enough; only lock after round 2 or an explicit "good enough."
**REF11. POST-IMPL AUDIT GATE** *(from R44)*
For PRs with >500 added lines, run a read-only Cursor audit before merge to catch dead code, wiring, aggregation, and cross-module logic bugs.
**REF12. RESEARCH AMPLIFICATION GATE** *(from R45)*
Use Gemini Deep Research only when the brief has real ambiguity, external-repo uncertainty, or explicitly low-confidence sections; skip it when the brief is already research-complete.
**REF13. QA ARTIFACT DISAMBIGUATION** *(from R46)*
Before acting on "latest QA" or "QA repro," restate whether you mean a video file, on-device build, branch SHA, or findings file. Evidence (paraphrased): "NO VIDEO — it's what I told you, it's on the latest version". If there's any mismatch, stop and ask for confirmation.
**REF14. STALE-WARNING SWEEP** *(P8 friction-sprint)*
Any "BROKEN" / "stub" / "untested" warning in CLAUDE.md older than 30 days MUST be re-verified before being honored. If the warning's date is stale and the tool in fact works, the agent edits the warning in-session and proceeds with the tool. A stale warning is itself a friction signal — log via `brain_store` with `tag:stale-warning`. Evidence: orchestrator/CLAUDE.md "BROKEN stub" warning for `brain_expand` was 50+ days stale (2026-03-22) while `brain_expand` was verified working 2026-05-17. The stale warning steered orcClaude away from `brain_expand` (cheap chunk-id drill-in) toward bulk `brain_search`.
</details>

---

## SURVIVAL BLOCK Template

Every spawned agent gets this at the top of their prompt. It survives context compaction.

```
## SURVIVAL BLOCK (re-read after ANY compaction)
I am {agentName}. Repo: {repo}. Mission: {one-sentence}.
Collab: {path/to/collab.md}
Merge policy: {autonomous|review-required|ask-on-each}.
First action: brain_search('test'). If fails -> echo 'BRAINLAYER UNAVAILABLE' >> collab.
Sprint started: {timestamp}. Track actual_work_minutes.

## OUTPUT FORMAT (non-negotiable)
When your task is complete, wrap your final deliverable in markers:
---RESPONSE_START---
{your structured output here}
---RESPONSE_END---
Everything between START and END is your deliverable. Terminal noise, tool output,
and deliberation go OUTSIDE these markers. orcClaude parses these to extract results.
```

---

## Skill Composition Map

Don't reinvent -- invoke the right skill at the right time:

| Trigger | Invoke |
|---------|--------|
| Spawning agents | `/cmux-agents` + `/repogolem` (launcher names, flags, spawn sequence) |
| Assigning tasks to agents | `/agent-routing` (R28 -- Cursor=gather, Codex=implement, Claude=orchestrate) |
| Multi-phase sprint with 3+ tasks | `/large-plan` |
| Async multi-agent coordination | `/large-plan:workflows:collab` |
| Model policy / spawn pins | canon #5 + `/repogolem` + `/model-pin-gate` |
| Looking up launcher flags | `/repogolem` (-s, -c, -m, -p, interactive vs headless) |
| Frozen/stuck agent | `/cmux` (recovery section) |
| Creating a PR | `/pr-loop` |
| Claiming done | `/never-fabricate` (enforced by the false-green-gate hook) |
| User corrects you | `/frustration-capture` (detect, categorize, brain_store with importance) |
| Objective fact lands (date, PR #, SHA, correction) | `orc/workflows/fact-propagation.md` (auto-relay to all owning agents BEFORE next dispatch) |
| Planning work | `/prd` (clarifying questions + do-not-implement stop) -> `/large-plan` -> architect-critic if multi-agent |
| Collab kickoff | Read `${ORCHESTRATOR_ROOT:-$HOME/.local/share/golems/orchestrator}/collab/TEMPLATE.md` first + add Agent Routing section (R28) |
| Status check | `brain_search` + `tail -20 collab.md` (inline, no separate skill) |
| 2+ agents in same repo | Native `git worktree` isolation (R17) |
| Research, deep dive | Claude Desktop/Web or Gemini research path |
| Comparing research platforms | Run Claude Desktop/Web and Gemini research with the same prompt, then score both outputs |
| Context high / session ending | `/session-handoff` (structured file, grill answers, verification). **orc-seat exception (C14):** orc succession = full-day weave on operator instruction — never threshold-fired, never `/compact` |
| Fleet wraps / sprint close / going quiet | `/fleet-wrap` (zero polling crons, ONE final dashboard + message, then SILENT) |

---

## Fact Propagation (Objective vs Subjective Facts)

When orc receives a user message containing an objective fact (dates, PR numbers, merge SHAs, corrections), it MUST classify the fact and auto-relay to all owning agents per `workflows/fact-propagation.md`. Conflating an objective fact with a same-turn subjective scope-restriction (e.g., "don't ping coach" + "date is Wed") caused the 67-hour Wed-May-27 propagation gap (F69, gen-7 collapse). The workflow is mandatory for ALL objective facts. Subjective decisions (scope, tone, routing) only propagate to immediately-affected agents.

---

## Decision Trees

### Agent appears frozen
```
list_agents({agent_ids:[agent_id], detail:"full"})
  -> If state says working/ready and output still changes -> WAIT
  -> If state is ambiguous or stuck in booting -> read_screen(lines: 50, scrollback: true)
    -> "Press up to edit queued messages" -> send Enter key
    -> Prompt visible but registry disagrees -> FR-06 parser ambiguity, trust the pane
  -> Token count / output unchanged across 2 checks -> POSSIBLY FROZEN
    -> FIRST: check MODEL MAX (R13) -> is context actually full?
    -> If responsive but low context -> /compact first (R6)
    -> If truly frozen -> read_screen(lines: 100) to capture partial work
    -> close_surface({scope:"agent", agent_id, force:true}) -> spawn_agent({...same task...})
    -> resend SAME task with "NOTE: partial work already done: {summary}"
    -> If 2nd agent ALSO freezes in <5 min -> STOP. Circuit breaker.
      -> Telegram user. brain_store state. Wait. Don't burn context diagnosing.
  -> Long tool call (>5 min, build/test running) -> WAIT. This is normal.
```

### Worker utilization check (R28)
```
For each Claude agent with assigned Cursor/Codex workers:
1. Check Claude's context % (R13 calculation)
2. Check worker agent ids: list_agents(detail:"full") -> token count / status > 0?
   -> Worker has 0 tokens AND Claude context >50% -> ROUTING VIOLATION
   -> Nudge Claude: "Your Cursor worker on agent:XX is idle. Delegate remaining queries."
3. Check worker alive: list_agents({mine:true})
   -> Worker missing -> respawn worker immediately via spawn_agent
   -> Resend original task. Notify the Claude agent of the new agent_id.
4. After sprint: audit utilization
   -> Did Claude do >30% of data gathering itself? -> Flag for process improvement
   -> Did Cursor do code changes? -> Flag (Cursor is read-only)
```

### User going AFK
```
1. For each active worker, ensure you have either `wait_for({agent_id, target_state:"done", timeout_ms:...})` coverage or a file-based completion contract
2. Include the monitored agent ids in your response: "Watching agent:abc123 and agent:def456 while you're away."
3. Re-check active workers with `list_agents` (add `detail:"full"` for state)
4. Forward any gems/research to ALL active agents via `send_to`
5. If agent done -> read collab -> verify claims -> mark task complete
6. When ALL agents are done + verified -> close the sprint and say so explicitly. No silent polling loops.
```

### Agent reports "done"
```
1. Read the actual output (read_screen 80+ lines, scrollback: true)
2. Find ---RESPONSE_START--- / ---RESPONSE_END--- markers -- extract structured deliverable
   (If no markers: fall back to last 50 lines + done signal)
3. gh pr view <N> --json state,mergeable (verify PR exists)
4. gh pr checks <N> (verify CI)
5. Read the collab GOAL section -- does this PR advance it?
6. Only THEN mark complete in tasks + collab
```

### Pre-send safety check (R1, R11, R19)
```
1. list_agents({mine:true}) -> get current mapping
2. Find YOUR worker set in the list
3. Verify target agent_id != your own interactive session (R19)
4. Verify target workspace = your workspace when that matters (R11)
5. Verify target agent is the intended worker, not someone else's (R11)
6. If any check fails -> spawn_agent in YOUR workspace instead
7. THEN send_to (R3)
```

---

## Degraded Mode

### BrainLayer down
```
1. Echo "BRAINLAYER UNAVAILABLE" to collab + Telegram
2. Fall back to: git log --oneline -20, grep with targeted patterns
3. Queue brain_store calls to local file (~/.brainlayer-queue.jsonl)
4. Resume BrainLayer when MCP reconnects, flush queue
5. NEVER read entire files -- use grep, not Read
6. To reconnect agents: tell agent to /exit -> relaunch via repoGolem launcher.
   Do NOT drive /mcp menu via send_to({mode:"key"}) (fragile, menu order varies by session).
```

### Mass agent failure (2+ freeze in <5 min)
```
1. STOP spawning. The root cause is systemic.
2. Commit any WIP in affected repos
3. brain_store full state: surface IDs, open PRs, user's last instruction
4. Telegram: "Sprint degraded -- N PRs merged, deferring rest. [root cause guess]"
5. Wait for user or environment recovery
```

---

## Collab Protocol

1. **Always start from TEMPLATE.md** -- never write collab from scratch
2. **Append-only writes**: `echo >> collab.md`, never Edit/Write (collab-guard.py blocks violations)
3. **Update at every gate**: before starting, before every commit, after PR merge, if blocked
4. **orcClaude owns the header** -- workers only append to Messages section

### Name-Claim Protocol

Canon #7 owns claim-name law. Orc mechanic: post a grep-stable claim before dispatch and include worker claim names in their briefs because Codex/Cursor workers may not load Claude skills.

Roster query: `grep '^> CLAIM' <channel-file>`.

---

## Learning from Corrections

When the user corrects an orchestration decision:

```
brain_store(
  content: "Orc correction: I did [X], user wanted [Y]. Context: [situation]",
  tags: ["orc-correction", "orchestration", "<pattern>"],
  importance: 7
)
```

Before similar decisions: `brain_search("orc-correction <pattern>")`

Categories: agent count, monitoring cadence, merge authority, spawn tool preferences, communication preferences.

**Required tags** (BrainLayer can't find orchestration knowledge without consistent tagging):
`orc-correction`, `sprint-incident`, `agent-failure`, `orchestration-decision`, `collab-pattern`

---

## Anti-Patterns (with real examples)

| Don't | What happened | Do instead |
|-------|--------------|------------|
| Trust remembered surface numbers | surface drift turned the remembered pane into the wrong worker. | Re-discover via `list_agents({mine:true})`, then message by `agent_id` |
| Read only the bottom lines | "Both cooking!" hid a stuck "Press up to edit." prompt. | Read 50+ lines with scrollback before deciding (`S4`) |
| Absorb frozen agent work | surface:42 froze; the orchestrator bloated itself and lost the orchestration role. | Compact first, then respawn the same task if needed (`S4`) |
| Say "I'll monitor" without an explicit `wait_for` / file contract | User went AFK and had to remind twice. | Establish the wait path first and report the agent ids being watched (`S3`, `C5`) |
| Keep iterating past score >=9 | Planning consumed the sprint instead of launching. | Launch and learn from real execution (`S8`) |
| Make verbal commitments only | No durable task, file, or memory existed afterwards. | Turn it into a task, collab update, or `brain_store` entry (`C6`, `REF3`) |
| Propose a revert that recreates the bug | The workaround restored the exact failure mode being fixed. | Fix the real issue instead of reinstating a known-bad path (`S6`, `REF7`) |
| Merge without deployment verification | The PR merged, but the old code kept running. | Check the process list and LaunchAgent state after merge (`S10`) |
| Trust local evals on the wrong code path | Five Python MCP PRs changed dead code while BrainBar kept serving Swift. | Confirm the live runtime architecture first (`REF7`) |
| Use arrow keys in `/mcp` via cmux | Navigation failed with `unknown key`. | Read 40+ lines and navigate with return only (`REF8`) |
| Upload prompts as NotebookLM sources | Query text was treated as context, not as a question. | Sources are context; prompts are questions (`REF12`) |
| Act on "latest QA" without naming the artifact | "latest QA" meant a different artifact than the agent assumed. | Restate the artifact class and confirm before acting (`REF13`) |
| Start downstream workers before upstream output exists | The human had to say "STOP ALL WORK... Wait until I send you GO". | Set an explicit blocked state and release only after `Read()` on the dependency artifact (`S15`) |
| Prepend Claude env vars to Codex/Cursor/Gemini | Spawned the wrong runtime with broken env bleed. | Use repoGolem or a clean CLI-specific command (`S14`, `S7`) |

---

## Session Start

```
Monitor(persistent, <channel.md>: '^### |BLOCKED|@<your-name>')  # FIRST ACTION — inbound monitor (2nd cardinal rule)
brain_recall(mode="context")                    # What's happening now?
brain_search("recent decisions blockers")       # What was decided?
brain_search("orc-correction")                  # What did the user correct before?
TaskList()                                      # Any open tasks?
pgrep -fl BrainBar                              # Daemon health
tail -20 <active-collab-file>                   # Collab state
# THEN post your `> CLAIM name=<n> role=orc monitor=<task-id>` line with the real task id
```

---

## Context Budget

- Approaching compaction warning -> brain_store full state (surface IDs, cron IDs, open PRs, repo locks, user's last instruction)
- Heavy file work -> spawn haiku subagent, keep YOUR context clean
- If you're writing more than 20 lines of code -> you should have spawned an agent
- **CALCULATE context usage** (R13): token_count / model_max_tokens. Don't guess.
- 45% -> brain_store full state + checkpoint + agent resume table
- 50%+ -> keep checkpointing and surface the number to the operator. Workers may compact (S4); the orc seat NEVER `/compact`s (C14)
- Succession: full-day weave that seeds gen-N+1, fired on operator instruction — never on a percentage threshold (C14).

---

<details>
<summary>Concordance (R1-R48 -> C/S/REF)</summary>

| Old | New ID | Old | New ID |
|-----|--------|-----|--------|
| R1 | C1 | R25 | REF7 |
| R2 | S1 | R26 | REF7 |
| R3 | S2 | R27 | REF8 |
| R4 | S3 | R28 | C2 |
| R5 | C5 | R29 | C3 |
| R6 | S4 | R30 | C7 |
| R7 | S3 | R31 | REF9 |
| R8 | REF1 | R32 | S11 |
| R9 | S13 | R33 | REF6 |
| R10 | S7 | R34 | REF10 |
| R11 | C1 | R35 | C4 |
| R12 | C8 | R36 | C6 |
| R13 | S9 | R37 | C8 |
| R14 | REF2 | R38 | S5 |
| R15 | REF3 | R39 | S12 |
| R16 | REF4 | R40 | REF6 |
| R17 | S8 | R41 | S13 |
| R18 | C2 | R42 | S6 |
| R19 | C1 | R43 | C10 |
| R22 | S10 | R44 | REF11 |
| R23 | C9 | R45 | REF12 |
| R24 | REF5 | R46 | REF13 |
|  |  | R47 | S15 |
|  |  | R48 | S14 |

</details>
