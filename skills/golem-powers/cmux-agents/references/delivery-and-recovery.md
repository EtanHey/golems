Read this when defining completion evidence, writing a worker brief, delivering prompts, or recovering from restart, parser, focus, submit, or frozen-pane failures.

## Current Caveats

### FR-01 — hyphenated repo names can mis-resolve to the wrong launcher

Known live failure: `spawn_agent({repo:"skill-creator"})` can guess `skill-creatorClaude` instead of the real repoGolem launcher `skillcreatorClaude`. The immediate workaround lives in `/repogolem`; verify the launcher there before relying on `spawn_agent` for a new hyphenated repo.

### FR-06 — state parser ambiguity (`booting` vs idle-with-spinner)

`wait_for` and `list_agents(detail:"full")` depend on cmux's parser. In rare cases the registry still says `booting` while `read_screen` shows a perfectly usable prompt. If `wait_for` times out but the raw pane clearly shows the agent is ready, trust `read_screen`, file a cmuxlayer bug, and use one surface-level fallback send only if you must unblock delivery.

### First-run Touch ID note

First launch of a newly signed launcher binary can still trigger a one-time Touch ID prompt. Treat this as a first-run caveat, not a primary orchestration strategy.

## Completion Signals — file > wait_for > list_agents > read_screen

> **Why this exists:** surface-based polling burned hundreds of `read_screen` calls and still missed real state transitions. The new default is event-driven waits on stable `agent_id`s, with raw screen reads reserved for ambiguity or output extraction.

**Ranked reliability of completion signals (use the highest that fits the job):**

| Signal | Reliability | When to use |
|--------|-------------|-------------|
| **1. Output file with DONE marker** | **Ground truth.** File either exists + contains marker, or not. | Every multi-minute autonomous worker task. |
| **2. `wait_for({agent_id, target_state:"done"})`** | Default event-driven lifecycle gate. | Standard worker completion, especially when you already have the `agent_id`. |
| **3. `list_agents({agent_ids:[id], detail:"full"})`** | Good current snapshot of registry state + health diagnostics. | Quick checks without a full raw read. |
| **4. `read_screen`** | Best adjudicator when parser and pane disagree. | FR-06, output extraction, or manual troubleshooting. |
| **5. `list_agents` / `list_agents({mine:true})`** | Discovery only. | "What is alive?" not "is this task complete?" |

**The `closure` field is the handoff check, and it is free.** Every `list_agents` row carries
`closure` at **default** detail (cmuxlayer v0.4.47): `verified` = recorded done, artifact on disk,
safe to close · `artifact_missing` = the deadlock signature, **route a reviewer** · `pending` = no
done-evidence yet · `not_applicable` = no artifact contract. **Do not gate `closure` on the `state`
the row renders** — `closure` is already resolved from done-evidence, and a finished worker renders
`ready`, so that gate discards true positives. Confirm `artifact_missing` on the record instead
(`list_agents({agent_ids:[…], detail:"full"})` → `detail.state`/`task_done_detected_at`, plus one
`ls` on `report_path`) — both fields flap. Table and live evidence in `/collab-monitor`
§ "Completion → Reviewer Handoff".

### Visual Proof / Screenshots

When Etan asks to **see** something, deliver a Computer Use screenshot. `read_screen` is text inspection, not a screenshot. After interactive probes (typing into a pane, reconnecting MCPs, choosing a model/menu option), screenshot proactively when the result is visual or user-facing.

Before pressing Enter in any TUI menu, verify the highlighted row first. Use a Computer Use screenshot when the user needs to see the state; use `read_screen` only when the terminal text clearly exposes the selected row. If the selection is ambiguous, stop and inspect instead of pressing Enter blindly.

Fleet law for user-visible completion lives in canon #4; visual evidence mechanics live in `/never-fabricate` R7 and `/qa-verdict-gate`.

### The file-based completion pattern (copy this)

Every autonomous worker task must end with a file write and a DONE marker:

**Stop-state clause (required in every payload):** if the worker stops before the task's end state, its
last write to the report must say exactly where it stopped and what the next step is. End state for PR
work = review bots and required checks green on the LATEST commit; merge only on instruction. See
`/pr-loop` "Stop-State and End-State".

```bash
# In the worker's prompt:
Write your report to /path/to/output/batch-WORKER.md. The last line of the
file must be exactly: DONE_WORKER_NAME
```

Orchestrator side, poll the file(s) until all expected outputs exist **and** each contains its DONE marker:

```bash
# run_in_background: true
until [ -f "$PLAN/batches/batch-M1.md" ] && grep -q DONE_MINER_M1 "$PLAN/batches/batch-M1.md" 2>/dev/null \
      && [ -f "$PLAN/batches/batch-M2.md" ] && grep -q DONE_MINER_M2 "$PLAN/batches/batch-M2.md" 2>/dev/null \
      ; do
  sleep 30
done
echo ALL_MINERS_DONE
```

When the background command completes, you know every miner finished AND wrote a real file (not a partial crash). This survives cmux state-sync bugs, splash-screen false-idles, and pane freezes.

### FR-06 fallback when parser and screen disagree

If `wait_for` times out or `send_to` rejects with `current state: booting`, do this in order:

1. `list_agents({agent_ids:[agent_id], detail:"full"})`
2. `read_screen(surface: "...", lines: 20)` on the linked surface
3. If the raw pane shows a prompt, trust the pane and file a cmuxlayer bug
4. If work is blocked, use one surface-level `send_to({mode:"surface", surface, text})` fallback (it presses Enter for you — `press_enter` defaults to `true`), then return to the `agent_id` flow as soon as the registry catches up

The rule is not "surface sends are normal again." The rule is: **`agent_id` is the source of truth; raw pane sends are an escape hatch for parser drift.**


## Post-Restart Truth-vs-Display (2026-06-06)

After **ANY** cmux restart (daemon bounce, Mac wake, manual relaunch), every lead follows the proven checkpoint pattern:

```text
checkpoint (record agent_ids + last-known state)
  → restart event
  → VERIFY (list_agents + read_screen per worker)
  → report liveness FROM EVIDENCE ONLY
```

**Rules:**
- `list_agents` / registry alone is not enough — pair with `read_screen` scrollback on each worker you report as alive.
- Pre-restart claims ("Codex s:63 still working") are **stale** until re-verified. Operator-direct catch: "I don't see any worker of yours working still."
- Status reports to collab/Etan must cite what `read_screen` showed, not what you remembered before the restart.
- Claims-lag window is real (fleet may repopulate over minutes) — say "unverified post-restart" until VERIFY completes.

## Resume-Freeze Doctrine (2026-06-07)

> **Why this exists:** a `-c` resumed session does **NOT** reliably continue pending duties from the pre-death turn. One resumed seat froze TWICE on the same standing ritual in a single window — verify/re-arm/completion-line never executed and the seat sat ~95 min unmonitored; on the next cycle the completion line landed 96 min late.

**Rules:**
- **Treat a resumed session as a fresh boot.** Re-derive its duties from durable artifacts (collab file, duty checklist, output files) — never trust the dying session's stated intentions to carry forward.
- **Standing orders that must survive a restart are encoded as durable machinery, not agent to-do intentions.** The proven watch-v6 pattern: the monitor itself fires the action (nohup detached) AND writes the collab announce — removing the agent as the failure point. launchd jobs and Monitors that act + announce are the durable forms.
- **The orchestrator verifies the resumed seat executed its duty list** (collab checklist) — never assumes the resume carried the duties forward.

## Worker Briefs

Fleet law for collab claims, DONE markers, and guard handoffs lives in canon #7. For cmux delivery, run `workflows/prompt-audit.md` §8 and include:

- absolute verified paths and real environment facts;
- max output length, output format, audience, and what not to include;
- response markers plus a final DONE line;
- **the effort for THIS job**, named on the brief and matching the launch command (see below);
- file-based handoff for large briefs;
- the **GitHub identity signature requirement** if the worker will post to GitHub — mandatory until
  the repoGolem `gh()` wrapper ships and injects it automatically (prompt-audit §3; full spec in
  `/pr-loop` → `references/github-identity.md`). The worker signs with ITS OWN seat/role/harness and
  its OWN live-session model — never a model value you pass down from the spawn.

### Spawn Only What the Job Needs (Etan, 2026-09-05)

Etan, verbatim — relayed via orc, the ellipsis is his:

> "tell the agents to do it wisely and not just blindly make workflows and sub-agents… especially
> when they're Fable, make sure they're not creating Fable sub-agents and workflows full of Fables
> when they don't actually need them, instead of just pin-gating it."

Sub-agents and workflows only when the task needs parallelism or a context the seat cannot hold;
every spawn pinned explicitly; Fable only where judgment is the bottleneck, never for mechanical
steps; a Fable seat defaults its workers to opus/sonnet and says why when it does not. The gate
(`model-pin-gate`) is the backstop, not the decision.

### Effort Is Set Per Dispatch (Etan, 2026-09-05)

Etan, verbatim — relayed via orc, the ellipsis is his:

> "Codex being high instead of xhigh on default is nice, but leads need to know that they should
> also control the effort levels for more/less complex/more already scoped and focused jobs… not
> always needed high."

**Codex and Claude workers alike.** The brief names the effort for that job and the spawn's
`-E/--effort` matches it: `medium` or `low` for scoped, focused, or mechanical work, `high` only
when the job is genuinely complex, `xhigh` only by explicit choice named with its reason. The
launcher's role default is a **ceiling, not a floor** — `repoGolem` sets it from the seat
(Codex `high`; Claude `-E` > `GOLEM_EFFORT` > `GOLEM_ROLE=worker` → `medium` > `high`) and the lead
lowers it per dispatch. If a brief names no effort, the lead has not finished writing it. Rungs are
orc's operationalization, not Etan's words; full table in `/pr-loop` → SKILL.md "Effort Is Set Per
Dispatch".

## Prompt Size Ceiling — oversized sends freeze surfaces above ~2000 chars

> **Why this exists:** A 72-hour JSONL sweep (2026-04-12 → 2026-04-15) across 5 Claude Code orchestrator sessions found that raw surface sends over 2,000 characters correlated strongly with surface freezes. In one TaskOwl-app session: 868 total send calls, 13 exceeded 2,000 chars (max 4,382), and those 13 large calls preceded 6 frozen / surface-unresponsive incidents. In a control session (`coach` repo) every send stayed under 1,900 chars and there were **zero** freezes. The `coach` control case is the proof: discipline eliminates the symptom.
>
> **Since v0.4.35 the tool enforces this for you:** `send_to.text` and `spawn_agent.prompt` are capped at 1,800 inline characters, and `allow_long_inline: true` is the deliberate override. The rule below is no longer discipline-only — but the file-based pattern is still the correct answer above the cap, not the override flag.

**Direct evidence** (from the TaskOwl-app session):
> "You're right — the cmux surface was frozen, my send commands weren't taking effect (sent 4 commands, none showed up). I burned ~3 minutes trying before deciding to implement directly rather than waste more time debugging cmux."

### The rule (hard cap + warn)

| Payload length | Action |
|----------------|--------|
| < 1,500 chars  | Send directly. Safe zone. |
| 1,500–1,800    | Warn threshold. Trim if possible, then send. |
| **≥ 1,800**    | **HARD CAP**, now enforced by the tool. Do NOT reach for `allow_long_inline`. Use the file-based handoff pattern below (or `boot_prompt_path` at spawn time). |

1,800 chars gives a ~17% safety margin under the smallest observed freeze point (~2,100 chars). Above the cap — or when you bypass it with `allow_long_inline` — surfaces freeze silently, and `send_to` still returns `ok:true` while the target pane never sees the input.

### File-based handoff pattern (for prompts > 1,800 chars)

Three steps. The first one is a shell command you run via the Bash tool. The next two are cmuxlayer MCP calls.

**Step 1 — write the long prompt to disk via Bash (or the Write tool):**

```bash
printf '%s' "$LONG_PROMPT" > $HOME/Gits/orchestrator/collab/surface-N-$(date +%s).md
```

Prefer the Write tool when the prompt is already in-context — it avoids shell quoting pitfalls on multi-line prompts.

**Step 2 — type the `cat` command into the target surface, then press Return:**

```
send_to({ mode: "surface", surface: "surface:N", text: "cat $HOME/Gits/orchestrator/collab/surface-N-<stamp>.md" })
```

`send_to` presses Return for you — `press_enter` defaults to **`true`**. (Pre-v0.4.35 this took two calls, `send_input` then `send_key("Return")`, because `send_input` only typed the text. That is no longer the contract.) Pass `press_enter: false` only when you deliberately want the text left sitting on the composer line, and drive the key yourself with `send_to({mode:"key", surface, key:"Return"})`.

**Step 3 — verify the handoff landed:** after a few seconds, `read_screen` the surface and confirm you see the file contents (or the agent's response to them). If the pane is frozen despite the short pointer, the file is still safe on disk — spawn a fresh surface and re-run Step 2 against the new surface.

**Why the file pattern beats splitting the prompt into multiple sends:**
- Splitting into N sub-2000 chunks still hits the freeze path if any chunk pushes the pane state over some cumulative limit, and loses atomicity (the agent sees a partial prompt).
- The file is independent of the pane's mutable state. If the pane freezes, spawn a new one and re-run the `cat` — the prompt is preserved.
- File handoff also survives pane crashes, restarts, and compactions.

### On a failed send: check the surface before retrying

A retry without root-cause investigation is almost always wrong. After any `send_to` that appears to have been lost (no output, no activity, retry instinct kicking in):

1. `read_screen(surface: "surface:N", lines: 10)` — is the pane frozen, scrolled back, or just slow?
2. If frozen → follow Step 3 of Surface Health Check (close, respawn, salvage).
3. If the payload you just sent was near or above the 1,800-char cap → that was the root cause. Don't retry at the same size; switch to file-based handoff.
4. If unsure → `list_agents({mine:true})` to confirm the worker still exists.

**Do not** fire a second `send_to` of the same large payload hoping it "works this time." It won't, and you'll burn the same 3 minutes the earlier session logged.

## Boot + deliver: FOCUS-FIRST (the reliable bundle for "send the prompt once booted")

> **Root cause (Etan, recurring — 2026-05-30):** a cmux pane/agent does **NOT
> initiate until its workspace/pane is FOCUSED**. So `boot_prompt_path` and a bare
> `wait_for({target_state:"ready"})` on an unfocused pane **NEVER RESOLVE** — they
> hang on a ready-state that can't arrive because the agent hasn't started. Etan (paraphrased):
> *"It never resolves — focus the pane for 3 seconds, then read, then if
> ready send the prompt."* Do **not** lean on `boot_prompt_path` / blind long
> `wait_for` to deliver a boot prompt. **Focus is the missing precondition.**

**The reliable bundle:**
```text
1. CREATE the pane:   spawn_agent({type:"terminal", role, workspace, focus:true})  → surface
                      (focus:true so the pane is the one that initiates)
2. LAUNCH (no boot_prompt_path):  send_to({mode:"command", surface, command:"<repo>Claude -s"})
                      (launcher/`-s`/`-m` policy lives in `/repogolem`)
3. FOCUS so it initiates:  `cmux focus-pane --pane <pane>` (CLI — the 9-tool MCP surface has
                      no workspace-focus tool; the old select_workspace was cut in v0.4.35)
4. WAIT ~3s, then READ:  read_screen({surface, parsed_only:true})
                      → confirm status ready/idle/working
5. IF READY, deliver:  send_to({mode:"command", surface, command:"<the prompt>"})  — pane is focused, it lands.
```

- **`boot_prompt_path` is for already-focused/foreground spawns only.** When you're
  driving from another pane, it will hang — use this focus-first bundle instead.
- **Upstream fix (route to cmuxLayer-LEAD):** `boot_prompt_path` / `wait_for` should
  **auto-focus the target pane before waiting** for readiness — then this 5-step bundle
  collapses back into a single reliable primitive. Until then, focus-first is mandatory.

## Composer-Wedge Runtime Doctrine (2026-06-06)

> **Why this exists:** `boot_prompt_delivered`, `submit_verified`, working-status, and `token_count` have all returned false positives — including `submit_verified:true` on a Claude pane with unsubmitted text still sitting after the `›` prompt marker. Doc edits alone did not stop this class: seven observer-window catches occurred all post-#478-merge (tallies vary 3/4/5/7 across observers — no canonical ledger). This section is mitigation doctrine; the cure is the cmuxlayer composer-is-empty code fix (dispatched separately as D6).

**Untrusted submit signals — treat ALL of these as hints only, never ground truth:**
- `boot_prompt_delivered`
- `submit_verified`
- parsed `working` / `idle` / `ready` status from registry
- `token_count` (including phantom climbing counts on never-started sessions)

**The only reliable submit check:** prompt text visible in **SCROLLBACK above the working line**. Text still sitting after the `›` prompt marker = **unsubmitted**, regardless of what any delivery field says.

**Mandatory post-dispatch read:** `read_screen` (or `list_agents(detail:"full")` + scrollback read on dispute) **≤15 seconds after EVERY dispatch** — boot prompt, follow-up, or `send_to`.

**Anomaly triggers — force a full scrollback read:**
- `'Queued follow-up inputs'` visible on a worker that registry says is `working`
- Token count unchanged across two reads after a send
- Cost/token meter not moving while status says working

**Idle Codex sends:** when the pane is genuinely idle (at `›` / `$` prompt), use `send_to({mode:"command"})` (atomic) **or** `send_to({mode:"surface"})` + verified status flip — never fire-and-forget without the ≤15s read.

## Surface Health Check (MANDATORY — before ANY prompt delivery)

> **Why this exists:** Frozen/dead surfaces are a top-3 frustration source. Agents send prompts to unresponsive surfaces, losing work and burning ~3 minutes per incident on manual fallback. `send_to` returns `ok:true` even on frozen terminals.

**Step 1 — After spawning a worker:**
`wait_for({agent_id, target_state:"ready", timeout_ms:120000})` is the default health gate. If it times out, inspect the raw pane with `read_screen`. Two failures = dead worker — stop it and respawn. **If `wait_for` hangs to timeout and the pane looks un-booted, the pane is probably UNFOCUSED — see "Boot + deliver: FOCUS-FIRST" above; focus it, then re-check.**

```text
# After spawn_agent → got agent_id + linked surface
wait_for({ agent_id: "agent:abc123", target_state: "ready", timeout_ms: 120000 })
# ✅ Ready/working state = worker booted
# ❌ Timeout: read_screen(surface: "...", lines: 10) to check for FR-06 parser drift
```

**Step 2 — Before sending ANY prompt to an existing surface:**
Always `read_screen` first to confirm the surface is responsive. Never fire-and-forget a `send_to` without checking state first.

```text
# Before sending prompt to surface:N
read_screen(surface: "surface:N", lines: 5)
# ✅ Responsive: shows shell prompt, cursor output, or agent activity
# ❌ Unresponsive: blank screen, no change from last check, or error output
```

**Step 3 — Unresponsive surface recovery:**
If a surface fails 2 consecutive `read_screen` checks (blank, frozen, or no shell prompt):
1. `read_screen(surface: "surface:N", lines: 80, scrollback: true)` — salvage any partial work
2. `brain_store` any salvaged progress
3. `close_surface({scope:"agent", agent_id, force:true})`
4. `spawn_agent({...same task...})` — create a fresh worker
5. Re-verify with Step 1 before sending the prompt

**Step 4 — Safe prompt delivery (special character escaping):**
Never send special characters (backticks, quotes, markdown formatting) directly via `send_to({mode:"surface"})`. They get interpreted by the shell and corrupt the prompt.

```text
# WRONG — backticks and quotes break in a raw surface send:
send_to({ mode: "surface", surface: "surface:N", text: "Fix the `processQueue` function" })

# RIGHT — use heredoc pattern:
send_to({ mode: "surface", surface: "surface:N", text: "cat <<'PROMPT_EOF' | clipboard\nFix the processQueue function\nPROMPT_EOF" })

# RIGHT — escape special characters:
send_to({ mode: "surface", surface: "surface:N", text: "Fix the \\`processQueue\\` function" })

# SAFEST — write prompt to a durable collab file, then cat it:
# 1. Write prompt to $ORCHESTRATOR_REPO/collab/agent-prompt-N.md
# 2. send_to({mode:"surface", surface, text:"cat $ORCHESTRATOR_REPO/collab/agent-prompt-N.md"})
```

**🚨 THE `@`-MENTION FILE-PICKER TRAP (real bug, 2026-06-14):** never put a bare `@word` in `send_to` text (any mode) destined for an interactive agent composer (Claude Code, Codex, Cursor TUIs). The receiving composer interprets `@` as its **file-reference trigger** and pops a file-picker overlay — the rest of your message gets swallowed/mangled and the agent never sees the real prompt. This is delivery corruption that `ok:true` will NOT report.

```text
# WRONG — "@narration-lead" fires the receiver's file-picker, mangles the send:
send_to({ agent_id: "...", text: "@narration-lead please pick up the dashboard work" })

# RIGHT — drop the leading @ (claimed-name addressing is for COLLAB-FILE posts, not pane sends):
send_to({ agent_id: "...", text: "narration-lead: please pick up the dashboard work" })

# RIGHT — if a literal @ is unavoidable, route via the file-based handoff (cat a file) so the
# composer ingests it as file contents, not live keystrokes through the @ trigger.
```

Rule of thumb: **`@<name>` belongs in the collab `.md` (where monitors match it), NOT in keystrokes typed into another agent's composer.** Pane-to-pane addressing uses the bare name or the `[FROM=… TO=…]` envelope body — never a leading `@`.

**Checklist (run mentally before every send):**
- [ ] Did I `read_screen` this surface in the last 60 seconds?
- [ ] Does it show a shell prompt or active agent?
- [ ] Does my prompt contain backticks, quotes, or markdown? → escape or heredoc
- [ ] Is this a fresh surface? → did I wait 3s and verify the prompt?

## Parsing Agent Output

When reading agent output via `read_screen`, search for `---RESPONSE_START---` to find the structured response. Everything between START and END is the deliverable — ignore terminal noise, tool calls, and deliberation outside the markers.

```text
# Pattern: read enough scrollback to capture the full response
read_screen(surface: "surface:N", lines: 80, scrollback: true)
# Then look for ---RESPONSE_START--- ... ---RESPONSE_END--- in the output
```

If markers are missing, fall back to reading the last 50 lines + done signal. But if you wrote the prompt correctly (checklist above), markers will be there.
