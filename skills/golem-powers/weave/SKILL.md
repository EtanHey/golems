---
name: weave
description: "Orchestrator convergence: mine JSONLs, cite findings, route actions. Triggers: weave, run weave."
---

# `/weave`

> **Version: v1.2**

> **At convergence, fan out deep cross-session mining, then prove each finding
> turned into a real change — or kill it.**

`/weave` is an **orchestrator skill**. The orchestrator wields it and relays the
mining sub-tasks to workers; workers do **not** self-invoke it. It operates
*across* sessions and repos at the moment the fleet goes quiet, catching the
cross-cutting issues no single worker ever sees — recurring frustrations, skill
gaps, anti-patterns, what-worked-vs-what-hurt — and routes each into a ledger
that makes waste visible.

The defining feature is **not** the fan-out. It is the **action-ledger** that
makes token-waste impossible to hide. Anyone can fan out N agents and produce
nice docs; the ledger is what forces every finding to a disposition and reports
**conversion-to-change**.

> ⚠️ This skill, and `batch-session-miners` before it, were lost once because
> they lived as untracked WIP in gitignored `docs.local/`. **A weave run's
> harness, ledger, and retro are committed artifacts.** Never leave them
> untracked. That discipline is the whole reason this skill exists as a skill.

> **Description-length guard (retro law):** keep this frontmatter `description`
> **≤1024 chars** — an over-long description silently skip-loads the skill (the
> weave's own 1272-char description once tripped this). [g1:86 → 2026-05-31.md:69]

## Triggers — arm vs fire

| Spoken | Effect |
|---|---|
| **"weave"** | *Arms* the skill: loads it, runs the convergence gate (`scripts/convergence-gate.sh`), and waits until all conditions pass. Never auto-fires. |
| **"weave now"** | *Fires immediately*, skipping the gate. Operator override — use only when the operator knows the fleet is quiet. |
| **Any weave run** | Runs through `skillcreator` with this formal `/weave` skill loaded. An ad-hoc "lite weave" is not a weave. |

## 1. Convergence gate (why it can't fire mid-flight)

A multi-way deep-mining fan-out next to the live Opus fleet = OOM + token
contention. The weave fires ONLY at convergence. **All four must be true:**

1. **0 open PRs** across golems + brainlayer + voicelayer.
2. **All worker panes idle.**
3. **No in-flight Codex.**
4. **Etan has SEEN + APPROVED the demo.**

Plus a **RAM gate** (same lesson as content-demo's `ram-gate.sh` — quiesce first).

```bash
bash scripts/convergence-gate.sh            # checks 1–3 + RAM; #4 needs operator ack
bash scripts/convergence-gate.sh --ack-demo # operator asserts demo approval → can PASS
```

Condition #4 is **not script-checkable** — the gate stays BLOCKED until the
operator passes `--ack-demo` (or `WEAVE_DEMO_ACK=1`). Human/orchestrator in the
loop; never auto-fire. `"weave now"` is the only path that skips the gate.

> **Convergence signal (2026-07-10):** the gate may key on the orchestrator's
> **SENTINEL** (an explicit quiescence marker orc emits) rather than a raw
> PR-count poll — PR-count alone false-fires while a lead is mid-close. Prefer
> the SENTINEL when orc emits one. [g1:52 → 2026-06-21.md:2]

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
python3 scripts/weave-run.py batches  --workdir "$WD" --size 5     # → batch-manifest.json (one miner per session)
#   ... dispatch one miner agent per session per batch (see §3) ...
python3 scripts/weave-run.py aggregate --workdir "$WD" --tokens <N> # → ACTION-LEDGER.md + ledger.json + conversion-to-change
#   ... synthesize the forward-plan from the ledger ...
#   ... THEN the MANDATORY red-team fact-check closing stage (§4b) before anything is trusted ...
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
- **One miner = one session** (not five shards of one). Parallelism = N sessions
  at once, batches of ~5. **Loop-until-dry** (see §2a phase-recursion) — stop
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
2. **luna/terra (cheap 5.6) at MEDIUM effort** on small slices. [g3:60]
3. **sol for centerpieces only.** [g3:60]

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
2. An audit checkpoint after mining (CP1, opus, "re-derive claimed state") caught 5 real defects incl. an imp-10 cite pointing at an agent paraphrase of Etan (:22-23). Run it.
3. Verify in importance-descending order — it saved the run twice when a limit cut landed at the imp-8 boundary (:24-25).
4. Workflow `args` >4096 elements dies at the VM boundary — embed work lists in the script (:26).
5. Recovery after a spend limit: 1-agent probe → fresh workflow over the disk-diff of missing outputs; never `resumeFromRunId` against a live limit (:27-28).
6. Cost reality: cache reads, not output, are the spend (4.4B cache-read tokens). Bound agent-count × tool-turns (:29-30).
7. Delta verifiers MUST get the snapshot-root override in their prompt — V1 FAILs from wrong-root greps are a measured class (v2 #1).
8. A reset time is not a wake signal — arm a clock monitor (v2 #2).
9. Zero-ref rule cutting needs a blue-critic adjudication pass — 9/11 mechanical candidates were invalid (v2 #3).
10. GRILL-CARRYOVER (verbatim rulings routed per remaining grill repo) is the highest-leverage deliverable per operator — write it early, not last (v2 #4). Added to the §5 emit list as item 3.

**From the 08-24 monthly (Etan rulings and measured harness facts):**

- **Lead reads syntheses, never raw miner output.** Etan: "You're not supposed to waste a fable token on reading these type of stuff." Direction reports → a convergence lens; findings → a synthesis lens; the lead reads ≤250-line syntheses and routes. Reading a worker report into the lead's context is a violation, not a shortcut.
- **Headless fan-out must announce itself.** Etan: "I dont see a weave." A codex-workflows (no-pane) gather is legitimate under §2c, but the lead posts "this fan-out is headless/invisible; N workers; manifests at <path>" at launch — the operator must never discover it by asking who spawned a pane.
- **Lineage, not no-spawn.** Etan (verbatim): "I dont hate that it spawned a codex sol for something, I just wish skillcreator lead would have known its its grandchild." Headless workers inherit the control-plane MCP and CAN spawn. Every worker brief requires `artifacts/children.json` (`{agent_id, surface, cli, model, title, purpose, state_at_exit}`) and names children in its report. The §3 miner skeleton now carries the `children.json` line; `scripts/weave-cursor-run.py` (prompt emitter + status check) and `weave-run.py status` must emit and check it too — owed (golems FOLLOW-UP, cause_layer: code), as is a `children` field in the codex-workflows manifest — registry R-046.
- **Local concurrency is an operator-facing cost.** ~40 local codex workers + BrainLayer daemons pushed load avg to 47.85 and stalled Etan's typing; ~27 workers with daemons stopped was ruled fine. Probe `uptime` before each wave; cap local workers ≈25; run queues with an atomic claim (`mkdir lock-<id>`), never a sequential loop that has to be killed to re-shape.
- **Worker `gh` fails inside the codex-workflows sandbox on first call.** Six miners recovered on an escalated retry; five shipped "unavailable" and lost signal. Brief: escalate on the first `api.github.com` error. Lead: pull merged-PR lists itself (`gh pr list -R <owner/repo> --state merged --search "merged:>=<window>" --limit 500 --json number,title,mergedAt` — `gh` defaults to 30 items; set `--limit` above the window's count or paginate, and assert `count < limit`) as the free evidence upgrade.
- **V1 verifier carve-outs (measured: 0 of 104 Luna FAILs survived Opus appeal across 7 rounds).** The same carve-out applies to the §3 denominator predicate (see the denominators bullet below). Six systematic verifier errors, now mandatory in the V1 brief: (1) long `tool_result`/multi-paragraph records are not "empty" — read the full line, `grep -n -F` the quote before calling it absent; (2) `promptSource:"queued"` and `sdk`+`entrypoint=sdk-cli` are operator speech; `sdk`+`sdk-ts` is a lead relay; `typed` is direct user capture by default (consistent with `/never-fabricate` §direct-capture and `/phoenix-human-view`) and is downgraded to relay ONLY on evidence — a `send_to` delivery receipt (live 9-tool surface; the pre-cut send tools count the same) in a lead session targeting that pane, or third-person self-attribution in the turn ("Etan has ruled…" — measured specimen cmuxlayer__d05bc84f#1). A shared provenance predicate used by weave, never-fabricate, and phoenix-human-view is owed (FOLLOW-UP, golems) so the three consumers cannot diverge; (3) `voice_ask` and `AskUserQuestion` tool_results ARE Etan speaking/typing — never reject them as tool_result; (4) verify `checked_lines` covers the cited `jsonl_line`; (5) ellipsis/backtick/markdown differences are not verbatim failures; (6) a "correction attributed to Etan" in a session where no operator turn mentions the topic is a FABRICATED-ATTRIBUTION finding → CORRECTED + importance cut. The appeal round is not optional; its rescue rate is V1's health metric.
- **Denominator VALUES come from the harness; miners copy, never count.** One owner per step, consistent with §3 and §4i: `prepare-mine-context.py` COMPUTES `user_messages` + the resolved model into the context header (both formats — Codex support owed); each miner COPIES the header into `<label>.denominator.json` (§3 contract unchanged); `weave-run.py aggregate` COMPILES the sidecars into `correction-denominators.json` (automation owed; until then the lead runs the fold script). Miners wrote generic model names ("claude"); Codex contexts carry no `user_messages`. Resolve model per session from the raw JSONL `"model":` field (majority, above 80% or `mixed:`), normalize to a fixed set. **Never drop a correction because its model has no denominator** — keep it in the corpus, the ledger, and the per-model correction COUNT; mark that model's per-100 rate `unavailable` (the fail-closed contract in §4i and `scripts/corrections-rate.py` stands: a missing denominator is a hard error for the RATE, not a reason to shrink the numerator). Until `prepare-mine-context.py` emits `user_messages` for Codex, Codex has counts but no rate; say so. **Denominator predicate carve-out owed:** `prepare-mine-context.py:is_claude_operator_turn` still rejects every content list containing a `tool_result`; `voice_ask` and `AskUserQuestion` results are operator speech and must count in `user_messages` — until that lands, Claude rates are slightly inflated on voice-heavy sessions; disclose it.
- **codex-workflows defects to route (cause_layer: code):** `harvest` aborts the whole run when a declared optional artifact is absent (copy from worktrees instead); `failed_launch` can occur with no log or diagnostic; `parallel` has no concurrency cap.
- **tmp-block reads `k > 7` inside a heredoc as a redirect** — write helper scripts with the Write tool when comparisons are involved.
- **Shape honesty:** the 08-24 run used capped queues + Opus singletons, not the canonical one-expanding-Workflow (§4g). Verification quality held (0 refuted) but the round agenda was hand-driven. Run R2/R4 as a Workflow when the operator says "use a workflow"; otherwise script this fallback end-to-end (fold → collect → adjudicate → aggregate) rather than hand-driving it.

### Miner-prompt hygiene — counter/footer leak guard

Agents inheriting global CLAUDE.md rules append `CLAUDE_COUNTER: N` to returns and occasionally into findings files. Keep the "reply exactly: WEAVE_MINE_DONE …" contract AND **scrub findings files before aggregation** (drop non-JSON lines) — `weave-ledger.py` counts them malformed otherwise (one leaked line scrubbed in gen-15). (Sonnet miners' `CLAUDE_COUNTER: 1` footer can also mask the DONE receipt → disk-truth > receipt.) [g1:26 → 2026-06-03.md:28]

### Harvest sweep + placement pass — research artifacts (standing, Etan 2026-06-10)

Before synthesis: sweep `~/Desktop` + `~/Downloads` (Claude-side: `compass_artifact_<UID>*`, hand-pasted `.rtf/.rtfd`) + the Drive route (Gemini-side) for research artifacts in the run window; save text exports to `<WD>/reports/`, `brain_store` conclusions. At close: the **placement pass** — every research gets its own folder with its owning context (large-plan/design-doc/sprint), moves are deliberate (verify destination first), Desktop originals surfaced to Etan before removal. See claude-desktop-research's OUTPUT-PLACEMENT CONTRACT.

### Context-file hygiene — standing weave step (Etan via orc, 2026-06-09: "Whenever we do the weave, this might be something we send to the skillCreator who does the weave")

Every weave checks whether context files need surgical improvement and routes it: audit the CLAUDE.md/AGENTS.md hierarchy against the 3-layer model (Letter ≤~50 lines intent prose / path-scoped `.claude/rules/` / BrainLayer episodic), flag accumulation-bloat violations, and **promote recurring registry families (`recurring=true`, BROKEN-OPEN) into `.claude/rules/` files at §4c** — Theo's "only encode repeated mistakes," mechanized. Findings route through the ledger like everything else.

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
and sums `user_messages` by model into the `--denominators` JSON object used by §4i. The count is
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

**Dispatch (the bridge between `batches` and `aggregate`):** spawn ONE miner per
session per batch (**waves of 4–6 concurrent** — the frozen 100%-coverage recipe;
~4-6 typical (recipe, not a hard cap)), centerpieces first. Two equivalent mechanisms: [g1:68 →
2026-06-01.md:36; 2026-06-07.md:8]

- **Workflow (preferred for staged mode):** a `pipeline`/`parallel` of `agent()`
  calls, each given the miner prompt below + a findings JSON schema; the workflow
  writes each result to `<WD>/findings/<label>.jsonl`. **Schema-return is fine only
  for ANALYSIS agents**, wrapped in `parallel` `.catch(()=>null)` — never for the
  file-writing miners (see the write-gap below). [g1:67 → 2026-05-31.md:105-106]
- **`session-miner` sub-agent / Task calls** from a skillCreator session (the
  sub-agent is skill-creator-scoped): dispatch N `Agent(subagent_type="session-miner", …)`
  in one message.

Miner prompt skeleton (**return-then-write: write the file, NO competing schema**):
```
Mine ONE session for the weave. Read your context file <WD>/mine-context/<label>.md
(digest + grep excerpts). For verbatim quotes, grep the raw JSONL by **jsonl_line=N**
from the Grep excerpts section — never read the whole file. Digest §N is NOT a jsonl
line. Emit findings (the JSON schema above), one per line, to
<WD>/findings/<label>.jsonl; every correction includes session/model/bucket/ts. Copy the exact
user_messages value from this context file's header into
<WD>/findings/<label>.denominator.json with session/model/user_messages even when the findings file
is empty. Never recount or estimate it. If you spawn ANY child agent (cmux spawn_agent, t3layer,
sub-agent), write <WD>/findings/<label>.children.json — a list of
{agent_id, surface, cli, model, title, purpose, state_at_exit} — and name each child in your reply;
write an empty list if you spawned none. Files only — no brain_store.
Write ALL files FIRST, THEN reply exactly: WEAVE_MINE_DONE <label> <count>.
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

## 4. The action-ledger + conversion-to-change

`scripts/weave-ledger.py` aggregates all findings into `ACTION-LEDGER.md` +
`ledger.json` and computes the metric that decides if the weave was worth it.
**Two denominators are reported — both, always:**

- **conversion-to-change (spec §4, the headline) = converged ÷ TOTAL findings.**
  This is the anti-waste number from the original spec ("0% conversion is
  token-waste, full stop") — it keeps `KEEP` confirmations in the denominator so
  the ratio can't be flattered by reclassifying findings as "not actionable."
- **conversion-to-change (refined) = converged ÷ ACTIONABLE**, where actionable =
  converged + open (`DEEP-RESEARCH`,`FOLLOW-UP`) + dropped (`REJECTED`,`PARKED`,
  `DUPLICATE`); `KEEP` is excluded because you can't "convert" a validated
  what-worked. The refined number is informative, but the **strict ÷-total number
  is the one that governs the SHIP/RETIRE decision** (see `EVAL.md`).
  (converged = `MERGED-PR`+`PR-FILED`+`PR-FIX`+`SKILL-NEW`+`SKILL-EDIT`.)
- **token cost per acted-on finding** = weave tokens ÷ converged (`--tokens N`).
  Report **tok/converted WITH the verification machinery in the denominator** —
  red-team + re-score + boss cost is part of the weave, not free. [g1:101 → 2026-06-06-evening.md:56]
- **Routing is mandatory.** `--strict` exits non-zero if any finding has an
  unknown disposition or is DROPPED without a reason. **Route EVERY finding.**
- **Tracks are mined from ledger dispositions ONLY — "not invented."** The forward
  large-plan's tracks come from real findings, never from a fixed template. [g1:89
  → gen17.md:43; gen17-wide:50; 2026-06-21.md:39]

A weave with 0% conversion is token-burn — the ledger surfaces that instead of
letting "we produced N nice docs" pass for progress.

### 4a. Re-score of the prior run — a PERMANENT stage (the number that can't be gamed)

Every weave re-scores the **prior** run: **proposed-converged ÷ actually-landed**,
`gh`/git verified. This is "the only number that can't be gamed" — the spine
finding was that weaves AUDIT/PROPOSE but don't LAND (true conversion ~9%, not the
claimed 34%). Prefer **LIVE REPRODUCTION** (pipe real payloads into the installed
hooks/gates) over transcript archaeology — it found a "wrong-emitter" defect in one
pass. The re-score writes registry state transitions (§7). [g1:15-16,76 →
2026-05-31.md:20-23,108; 2026-06-06-evening.md:15-18,43-44]

## 4b. Red-team fact-check — MANDATORY closing stage (anti-hallucination guard)

**After synthesis, before ANY finding is trusted or acted on**, a red-team
workflow verifies **every load-bearing fact** in the ledger + synthesis against
the **raw JSONLs**. This is non-negotiable — it is the anti-hallucination guard
for the L0 memory problem: a wrong fact that reaches the plan or `brain_store`
poisons every downstream decision. (Proven valuable: the 2026-05-29 weave's
red-team caught a **wrong WhatsApp number for Etan** plus several other wrong
facts; the 2026-07-10 run's **13-way adversarial red-team overturned 6 solo-
verifier verdicts in both directions**.) [g1:57 → 2026-07-10.md:6; meta:52]

Structure it as **Red / Blue / Red, looping until a round yields nothing new**
(not a single pass). [g1:69 → 2026-05-30.md:82; 2026-06-01.md:38]

**Anchor on the highest-trust ground truth — what the OPERATOR said and did:**
1. **"What Etan SAID"** — every verbatim Etan quote / correction in the window.
   Re-grep the cited JSONL line; confirm the quote is **verbatim** (not
   paraphrased) and the **number / name / path / PR# is exactly right**.
   Cite raw `type:user` turns only. Do not cite relays, `queue-operation`,
   `last-prompt`, `task-notification`, worker summaries, or assistant
   `brain_store` paraphrases as Etan evidence. If the quote appears in both a
   relay and a raw user turn, cite the raw user turn. If no raw user turn exists,
   mark the claim as relay-only and do not treat it as verified operator speech.
2. **"What Etan FIXED"** — his decisions/corrections this window. Confirm the
   finding's claim about what was decided matches what the JSONL actually shows.
3. Then sweep the high-importance (≥8) findings: every cited `[line N]` must
   resolve to the quoted text; every attribution (who did what, which repo, which
   PR) must hold. **Widen sampling below the top-60** — the tail is where
   re-violations hide. [g1:54 → 2026-06-21.md:45]

**Standing verification laws (all enforced at this stage):**
- **Split compound claims before verification** — 0 claims were wholly refuted in
  one run yet **9 sub-claims were wrong** because they were verified as a bundle.
  [g1:71 → 2026-06-07.md:23]
- **Critic-as-gate + tagged-amendment protocol** (strike, never silently edit)
  runs a completeness pass **BEFORE Red-1** (a 22-gap pass caught an unmined
  succession). [g1:72-73 → 2026-06-07.md:9,21; 2026-06-06-evening.md:51-52]
- **Fabrication-auditor / B1 lens audits the weave's OWN artifacts** (brief,
  synthesis, re-score, empirics) — a permanent blue lens. [g1:73 →
  2026-06-06-evening.md:20-21,45; 2026-06-07.md:27]
- **Live-DB empiricist blue lens** — check `typeof(created_at)` etc. against
  sqlite/MCP directly, not just transcripts (a NULL-`created_at` was found via
  sqlite, invisible in a windowed query). [g1:74 → 2026-06-06.md:41-42]
- **Stamps come from `date`. Always.** Head-math timestamps were the systematic
  fabrication class. [g1:79 → 2026-06-07.md:22]

**Mechanism (a fan-out workflow):** one verifier per batch of claims, each
re-greps the raw JSONL and returns `{claim, verbatim_match, correct_attribution,
corrected_value, verdict}`. Any claim that fails is **corrected in place or
dropped with a reason** in the ledger before the plan/retro/`brain_store` are
trusted. **A claim only counts once it survives re-verify after re-mine; a
reverify that still fails is CONFIRMED-FAILED** (bounded — no infinite loop).
Default to skeptical. [g4:6 → weave-2026-07-02-report.md §R2.8]

> A weave's findings are only as trustworthy as this stage makes them. No weave
> output is "done" until the red-team fact-check has run and its corrections are
> folded back into the ledger.

### Correction-propagation sweep — runs after CORRECTIONS compiles (Fix-10)

A strike that doesn't reach ALL copies is laundering with a delay: the
2026-06-07 run struck its confessed-invented "47 sessions staged" at the
origin, a verbatim copy survived in the retirement dump, and the successor
generation's boot read the laundered count (specimen S31 / B1-F7). The
2026-05-29 prototype red-team did this sweep by hand once (the
APPLY-everywhere table) and it was never encoded — this encodes it.

**As soon as the run's CORRECTIONS doc is compiled, run the sweep:**

```bash
python3 skills/golem-powers/weave/scripts/correction-sweep.py \
  <run-dir>/CORRECTIONS.md <orchestrator-root> [<other-root>...]
```

For every §1 strike row it extracts the struck literal strings, greps them
exactly across the target trees — weave doc, S-docs, collab, findings, boot
prompts, plans, dashboards — and emits a patched/not-patched table
(`file [line] | struck-string | ANNOTATED-or-RAW`), exiting non-zero while
any un-annotated copy survives. It is REPORT-only: it never edits. Strikes
stay human-applied — strikethrough + pointer, never a silent edit.

**Gate: RAW (not-patched) rows reach ZERO — or each carries an explicit defer
note in the weave doc — before §4c closes.** A surviving raw copy is exactly
the carrier the next generation boots on.

**Scope limit, stated honestly (B-adversary Fix-10 ruling):** the sweep
catches LITERAL-COPY laundering only. Derived-number laundering ("~14 merges"
→ 22 → 42, or a struck count re-worded into a new sentence) escapes
exact-literal grep by construction; the sweep surfaces such rows as
NO-LITERAL for manual review but cannot clear them. The derived half is
closed by the **canonical-source rule: every load-bearing number cites its
source artifact** (ledger.json, a gh command, a pinned grep method) — a
figure with no source cite is challengeable on sight even when no grep can
find it.

## 4c. §EDITS APPLICATION — MANDATORY final phase (capture ≠ convergence)

> **A weave that only captures is a diary, not convergence.**

After the red-team pass, the run is NOT complete until **every SKILL-EDIT or
SKILL-NEW item** in the weave doc's skill-candidates/edits section (the §3-style
"SKILL CANDIDATES / EDITS" list) is in exactly one of three discharge states:

| State | Required proof |
|---|---|
| **APPLIED** | PR link recorded next to the item (merged or open via `/pr-loop`) |
| **DISPATCHED** | Named owner + collab/inbox link where the owner acknowledged the item |
| **TRACKED** | Ledger row with `confidence` + `evidence_count`, plus the exact evidence references that future weaves can re-check |

No fourth state. "Captured for later" is the failure mode this phase exists to kill:
the gen-10 weave captured 9 behavioral fixes that were never applied — gen-11 then
re-violated them and Etan received the SAME lead-topology correction again
(2026-06-05). The weave doc + retro MUST include the discharge table (item →
state → proof). Do not count TRACKED as APPLIED in conversion-to-change; the
point is to prevent loss without pretending every suggestion became a code or
skill change.

> **"Build the gate, don't write the prose" (gen-18 core doctrine).** The only
> rule-families that held were the ones with a **replayable RED fixture**; 13
> chronic families recurred AGAIN because every prior fix was prose, not a
> replayable RED/GREEN gate. When you discharge a recurring rule, prefer
> converting it into a RED/GREEN fixture (the eval-first lens) over writing more
> prose. [g1:53,91 → 2026-06-21.md:6,33,40,48]

**TRACKED satisfies §4c** when the doctrine says to observe before editing. Etan's
raw `type:user` doctrine, typo preserved: "we can use pheonix to track it or the
ledger... suggestions are possible, not always taken as necessary"
(`orchestrator ce4072bf:[4960]`). Use TRACKED for skill-behavior suggestions
that need evidence across sessions or divergent agents; promote TRACKED -> APPLIED
only when the evidence matures into a multi-instance or unambiguous failure.

The orchestrator running the weave owns this phase. If an item's owner is another
LEAD, DISPATCHED requires the dispatch to have actually landed (collab ack or
monitor loop armed) — not a parking-lot note (orc C7: dispatch now, not later).

## 4d. FULL-RELAY standard — the successor reads EVERYTHING

> Etan (2026-06-05, verbatim): "Everything should be moved from the weaving from the
> previous session to the new session, not just the top things. Everything should be
> relayed so we get a very good next orc."

The successor orc's boot MUST require:
1. **Reading the ENTIRE weave doc** — not a curated highlights subset.
2. **A `brain_search` tag sweep of ALL stored corrections** from the closing session
   (orc-correction + frustration-capture stores), read in full.
3. **Item-by-item ACK** on (a) the §EDITS application table, (b) the corrections
   list, and (c) **every BROKEN-OPEN registry row** (§7) — the successor states
   each item and its current state in its own words. [g1:99 → 2026-06-21.md:47-48]

Boot docs may summarize for orientation, but the summary MUST link the full weave
doc and MANDATE the full read + ACK, and be dispatched as a **one-line pointer**
(payload on disk, §2 pointer-brief law). A boot doc that relays only "the top
things" is a relay failure — the dropped tail is exactly where re-violations come
from.

## 4e. Stale-at-write guards — facts go stale between audit and doc-write

Two self-defects across consecutive runs, same class: a number or state that was
true when audited but false when written (5 of 17 claims stale-at-write in one
re-score). Rules, all enforced at the moment a doc is WRITTEN:

1. **Re-poll every terminal-state claim at doc-write (rule E05).** Any "MERGED" /
   "OPEN" / "CI green" line in a ledger, retro, dashboard, or status board gets a
   fresh `gh pr view` at the moment the doc is written — not at audit time. Never
   relabel an earlier audit snapshot as "snapshot at doc-write". Session-scoped
   truths get gh-re-verified before a successor acts on them. [g1:78 →
   2026-06-06-evening.md:32-33; 2026-06-07.md:24,37]
2. **Day-counts close with the UTC day.** Publish a day-total (merges, PRs,
   sessions) only after the UTC day closes — or carry an explicit
   "as of HH:MMZ" label. A "22 merges" day-total snapshot-true at ~22:18 was
   42 by actual close.
3. **Status-board lines are OUTPUTS, not plans (specimen #0).** Never write a
   checked box, a DONE line, or a result number before the step actually ran.
   The weave seat itself wrote "DONE 18:04 / 47 sessions" from the plan, not
   the output — struck in place. If the weave seat does this under no pressure
   at all, every status line needs the output in hand before the line exists.
4. **Write-verification — every endgame/plan/dashboard write gets a same-turn
   read-back or curl-200 (2026-07-10 D9).** The dashboard post-Write sync gate
   (curl-200, verify CONTENT not status) must run **pre-publish**; a plan/registry
   write gets an immediate mtime/read-back. A write you didn't read back is a
   write you can't cite. [g1:97 → 2026-07-10.md:37; meta:29,48,28]

### 4f. Final-boss exit gate — one apex agent ends the loop (2026-07-10)

> **DESIGN SPEC — harness implementation pending (ships with the substrate-law + phase-recursion + final-boss bundle).**

The design requires the phase-recursion loop to exit only through **one apex agent** (Fable) returning
`FINISH` or `{phases-to-re-run}`. **No workflow self-declares done.** This was
"the single highest-leverage protocol addition… the ONLY mechanism that caught a
completeness defect by refusing to finish, which no eval assertion can express."
[g1:57 → 2026-07-10.md:9; meta:42,50-54; g3:82-89 → tree-wf-review-priorart.md:46]

**The boss diffs predicted-vs-actual against the retro ledger.** Its job is not
only internal grounding — it cross-checks the assembled run against the
**prior-art failure table**: *does this run reproduce a known-paid-for failure
mode?* The gap between what a shape *predicted it would do* and what identical
prior shapes *actually did* is the highest-value pre-launch/pre-finish signal.
[g3:86-89 → tree-wf-review-priorart.md:60-70]

### 4g. Canonical weave shape — the demand-driven agenda (2026-07-02 §R2.8)

The whole run is **ONE self-expanding, demand-driven agenda** — rounds create
rounds (unverified → red-team, gaps → re-gather, hotspots → deep-read, failures →
re-mine); **synthesis is pinned last**; the run **resumes the same run on crash**
(never restarts). Every round is a **~3-agent collaborating panel** with diverse
lenses + intra-round cross-check — majority decides, a single-lens dissent demands
a follow-up round; **never 1/1 micro-rounds**. **Every spawn is model-pinned**
(gather = cursor/codex off-Claude or sonnet/haiku; judgment/synthesis = opus) —
the unpinned-inherits-Fable bug is what capped pass-1. The loop is **budget-aware
loop-until-dry** — the mechanized answer to Etan's "1 haiku, no verifiers"
critique. [g4:3-8 → weave-2026-07-02-report.md:57-58 §R2.8; report.md:11]

## 4h. Per-failure CAUSE ATTRIBUTION — route the fix to the layer that made it possible (Etan, 2026-08-05; corrected framing via orc)

The weave already mines what went wrong. The step that was missing: **for every failure finding,
attribute WHICH LAYER made it possible, and route the fix there** —

- **(a) code** — the behavior was possible because nothing in the software prevented it
  (e.g. no pr-queue gate existed; brain_digest truncated silently)
- **(b) instruction files** — global/repo CLAUDE.md, AGENTS.md, canon prose enabled or failed to
  prevent it (e.g. the fabricated "review-required, wait for a human" stop; 16 dead CLAUDE.md
  symlinks silently loading nothing)
- **(c) tool description** — the rule was contradicted or hidden at the point of use
  (e.g. `server.ts:9212` asserting effort default `xhigh` while the launcher defaults `high` —
  agents "misbehaving" were OBEYING the description; `server.ts:6969`'s documented-but-unread
  `@word` hazard — a (c) of PLACEMENT: move the warning into the refusal path, not the prose)

Miner contract addition: failure findings carry **`cause_layer: "code" | "instructions" |
"tool-description"`** (+ optional `cause_note`), and the ledger's disposition routes to that
layer: (a) → a fix lane with a regression gate; (b) → the instruction-file's grill/edit queue;
(c) → a tool-description fix lane, generalising cmuxlayer #359's validate-at-call guard shape
where the assertion is enforceable. Verifiers treat a wrong `cause_layer` as a claim failure like
any other — attribution is evidence-cited (`file:line`+commit on both the behavior and the layer),
never vibes.

**Supporting technique for detecting (c):** mechanically extract testable assertions from
fleet-owned MCP tool descriptions (defaults, caps, flags, paths) and diff against source/launcher
ground truth; every mismatch is a (c)-finding even before an agent trips it.

Why attribution and not just discovery: the same symptom at different layers takes opposite fixes
— a recurring correction that is really a (c) needs one description edit, not another CLAUDE.md
line; a (b) that is really an (a) needs a gate, not a grill. Mis-routing is how six months of
re-explanation happened.

## 4i. Corrections rate — per-model, bucketed (the comparable number)

The comparable metric is **corrections per 100 user messages, per model**:
`correction_count × 100 ÷ user_messages`. Raw correction counts cannot compare model/harness
combinations observed over different numbers of user turns. The denominator is the sum of actual
user messages across every mined session for that model in the measurement window, including
sessions with zero corrections; it comes from the §3 denominator sidecars, never an estimate.

Each correction uses exactly one bucket:

- **`wrong-impl`** — the implementation or answer is functionally wrong for the requested result.
- **`taste`** — the result works, but violates an expressed user preference or repository taste.
- **`process`** — a required workflow, gate, order of operations, or handoff was not followed.
- **`misread`** — the request, context, constraint, or cited evidence was misunderstood.
- **`tool-misuse`** — the wrong tool/command/flag was used, or the right tool was used incorrectly.
- **`overbuild`** — scope or complexity was added beyond what the request required.

The bucket and §4h `cause_layer` are orthogonal: the bucket says **what the correction was about**;
`cause_layer` says **which layer made it possible**. Do not collapse them. For example, a
`tool-misuse` correction can still have cause `(c) tool-description` when the point-of-use contract
misled the agent.

`scripts/corrections-rate.py` reads schema-pure correction JSONL plus a separate JSON object mapping
model names to positive-integer user-message counts. Before invocation, the aggregating
agent/operator materializes those inputs as follows; the current `weave-run.py aggregate` command
does **not yet automate this compilation**:

1. Read every `<WD>/findings/<label>.jsonl`, keep only `type:"correction"` rows, require the
   §3 correction fields, scrub the known non-JSON miner footer leakage, and write the resulting
   schema-pure rows to `<WD>/corrections.jsonl`. Count every correction record; unlike the action
   ledger, the rate numerator is not title-deduped because repeated user corrections are repeated
   failures.
2. Read every `<label>.denominator.json`; require `user_messages` to be the exact value copied from
   that session's prepared context header (never recounted or estimated), key by stable `session`,
   collapse byte-equivalent re-mine duplicates, and hard-fail if duplicate session IDs disagree on
   `model` or `user_messages`. Sum the deduplicated positive-integer counts by model and write
   `<WD>/correction-denominators.json`.

The script emits deterministic JSON with models sorted, all six buckets present, raw count and
denominator beside each per-100 rate, and rates rounded to one decimal for display only. Unknown
buckets, missing model denominators, and zero denominators are hard errors (exit 2). A model with
fewer than **50 user messages** is marked `low-confidence`; its computed rate is emitted for
inspection but must not be presented as comparable to adequately sampled models.

```bash
python3 scripts/corrections-rate.py "$WD/corrections.jsonl" \
  --denominators "$WD/correction-denominators.json"
```

## 5. What the weave EMITS (it's the front of a snowball, not a report)

`/weave → intent briefs / track intents → domain leads author large-plans → orchestrator runs parallel tracks → ship → re-weave.`
The ledger is the compounding instrument across loops.

**Deliverable 2 is the highest-priority emit** (Etan emphatic 3×), even though
Deliverable 1 is the *terminal* artifact. If you can only land one, land the gate.

1. **Intent briefs / track intents that feed lead-authored large-plans (terminal artifact).**
   The weave **ORGANIZES INTENT; it never designs domain solutions.** It emits up
   to 5 parallel track intents, each **populated by mined findings** (from ledger
   dispositions ONLY, §4 — not invented). Big initial collab = **modularize/
   componentize first**, then 4–5 LEAD orchestrators (one per track). These are
   **example track intents only; leads own the design**:
   - **cmuxLayer** — fix deterministic pane placement (the recurring pain).
   - **BrainLayer** — engine/package split; BrainBar = its own package.
   - **VoiceLayer**.
   - **MCL (Meta-Comms Layer)** — its own *secure* repo, cmux-adjacent, **all AI
     reviewers enforced**; a deep-research candidate.
   - **MCP-layer**.
   Per the project-OS vision, each domain **LEAD** authors and owns that track's
   large-plan from the weave's intent brief; the weave does not author any plan.
   The lead-authored large-plans coordinate through **collab files** (+ Google
   Drive + BrainLayer + **MCL as a
   4th channel**), and the conductor is a **clickable drill-down** (track → that
   domain's lead-authored large-plan).
2. **The self-QA-before-handoff gate (HIGHEST priority).** Formalize the rule
   that closes the verify-gap: **ship = build → FUNCTIONAL self-QA against the
   fix-list → comparison artifact → THEN handoff.** "Generated" ≠ "verified";
   "merged" ≠ "converged into one verified build." Mechanical checks (PID running,
   commit-matches) are NOT a functional pass. Concretely: **gate merges on Codex
   computer-use** — actually click/screenshot/verify the UI (BrainBar / VoiceBar /
   dashboard) before merge. (Same family as `/never-fabricate` + the `/qa-video`
   method-attribution rule.)
   - **Use CODEX for the CU pass, not Claude.** Codex is strong at computer-use
     and **has driven the BrainBar menu-bar app before**; Claude CU is weak at it.
     So route visual/functional QA of menu-bar apps to Codex CU.
   - **Known gotcha (not a hard block):** a CU session can hit a "BrainBar (not
     installed) / 0 apps" grant dialog for the `LSUIElement` menu-bar app — that's
     a grant/focus state, not an impossibility. Fallbacks when it blocks direct
     CU: `screencapture` CLI + coordinate clicks, or an in-app PNG-export
     affordance (qa-video hotspot #13).

3. **GRILL-CARRYOVER — rulings already given, routed per repo (07-28 shuttle v2, "the highest-leverage deliverable per operator").**
   Working copy `<WD>/GRILL-CARRYOVER.md`; **committed copy at
   `$ORCHESTRATOR_ROOT/weave-records/grill-carryover/<date>.md`** (the private records repo — `<WD>`
   is gitignored scratch and does not count). It lists every operator ruling the corpus already
   contains, VERBATIM with its finding id and verification state (V1-PASS / ADJ-CONFIRMED /
   CORRECTED / relay-only / unverified), grouped by the repo/grill it pre-answers, plus a "governs
   every grill" section. Routing contract: the maintenance/grill lead reads it BEFORE asking Etan
   anything; **only entries marked VERIFIED (V1-PASS, ADJ-CONFIRMED, or CORRECTED with the
   corrected text) pre-answer a question** — relay-only or unverified entries stay eligible for
   clarification and are listed under a separate "ask, do not assume" heading (§4b: a relay is
   never operator speech). Write it as soon as the first verified findings land — not at close —
   and update it at each checkpoint. Its absence from a run is a §5 defect.

> **North-star kill target: FALSE-GREEN** (gen-17). "PR merged but live system
> still broken." E2E gates must **assert LIVE behavior** — watcher ingesting,
> enrichment moving, dashboard URLs return **200 with the right CONTENT** (verify
> content, not status — the weave once dogfooded a live false-green: a 200 that
> was really a 404) — **not PR-merged alone**. This is the same axis as
> Deliverable 2. [g1:48,90 → gen17.md:26,93; gen17-wide:103; 2026-06-21.md:34]

## 5b. Name-claim protocol — collab channels (standing rule)

> Born: 2026-06-11 gen-16 night — 6 ephemeral worker identities in one night
> broke @-mentions and monitor targeting (voicebarClaude-builder/-pass2/
> dashboard-audio-agent/dashboard-v2-regen/graphify-pilot/-rollout).
> Etan (verbatim): "Agents need to claim names in colabs and use them to
> monitor and communicate with eachother, so its not flappy."

Every channel the weave coordinates through (§5 item 1: **collab files** +
Drive + BrainLayer + MCL) runs name-claims:

1. **CLAIM-ON-ENTRY.** A seat's first post in any collab channel begins with a
   grep-stable claim line:
   `> CLAIM name=<name> role=<lead|worker|weaver|orc> monitor=<task-id|none>`
   `monitor=none` is an explicit contract: "no delivery guarantee — nudge me."
2. **STABILITY.** The name is immutable for the channel's life; post headers
   are `### <claimed-name> (<ts>)`, byte-identical to the claim. Rename only
   via `> CLAIM name=<new> supersedes=<old>` (rare, loud).
3. **WORKERS INHERIT.** Workers are named `<lead-claim>-w<N>`, assigned at
   spawn by the lead, claimed by the lead on the worker's behalf. Never ad-hoc
   per-post identities.
4. **ADDRESSING.** @-mentions use claimed names ONLY; mentioning an unclaimed
   name is the mentioner's comms error. Channel monitors anchor on claimed
   names (`@<name>|### <name>`) — only safe because of 1–2.

Roster query: `grep '^> CLAIM' <channel-file>`.

> **Collab channels are append-only (2026-07-02 fleet standing contract).** Never
> Edit/Write-tool a live collab (rewrites flood tail monitors) — `cat >>` heredoc
> appends only; claim updates are new posts. Monitors run the **offset-watermark
> loop** (newest-header keyed), never `tail -f`. Worker COMPLETION watching =
> durable artifacts + registry polling, never session heartbeats. [g2:30]

## 5c. Monitor-on-arm law — the weaver/leads are NEVER idle-and-blind (Etan top priority)

> Born: 2026-06-14 — a lead finished its lane, posted "Back to silent 👋" with
> **no monitor armed**; dashboard work routed to it via collab was a **silent
> no-op**. Etan: *"leads and orchestrators should all have very, very good
> rules about monitors."*

The weaver coordinates through collab channels (§5 item 1) — so it lives and dies by the same monitor law it enforces on every lead it seeds:

1. **ARM AN INBOUND MONITOR AS FIRST ACTION.** Persistent native `Monitor` on the channel (`^### |BLOCKED|@<your-name>`, exclude own posts) BEFORE any mining/dispatch. Post your `> CLAIM … monitor=<task-id>` only with the real task id from that monitor. This is what makes the `monitor=<task-id>` field in §5b TRUE instead of aspirational.
2. **NEVER IDLE-AND-BLIND.** Lane/weave done → either pick up monitor-surfaced work or post `✅ DONE … standing by, monitor ARMED` and keep it running. A stopped/never-armed monitor on a "standing by" seat is THE failure.
3. **VERIFY ENGAGEMENT WHEN YOU ROUTE.** When the weave routes an action `@some-lead` (§4/§5 conversion-to-change), confirm the lead actually engaged (`read_screen` / `list_agents({agent_ids:[id], detail:"full"})` shows it on the NEW task) — a route to a monitor-less lead is a dropped action, and dropped actions are exactly what the weave exists to prevent. Flag monitor-suspect leads in the action-ledger.
4. **SEED IT DOWNSTREAM.** Every lead-boot brief the weave emits (§5) MUST include "arm a persistent collab monitor as your FIRST action" as a gate, not a suggestion.

Canonical law + `Monitor` command pattern: `/cmux-agents` → "LEAD/ORCHESTRATOR MONITOR LAW"; orchestrator framing: `/orc` → "THE SECOND CARDINAL RULE".

## 6. The snowball — retros make the next weave better

After each run, write `$ORCHESTRATOR_ROOT/weave-records/retros/<date>.md`
(private records repo): what we learned, what to improve next
time (better miner prompts, better disposition routing, what got missed), **what
the red-team fact-check (§4b) caught and corrected** (the wrong facts that would
otherwise have shipped), **the §4c application table** (every edit item APPLIED or
DISPATCHED with links), the **§4a re-score of the prior run**, the **§7 registry
state transitions**, and a delta vs the prior weave. `brain_store` the
conclusions. The next weave **starts
from the last retro** — that's the compounding. (The reason this never snowballed
before: the weave was never built or committed. Fixed here, permanently.)

## 6b. ROADMAP — model-change-tracking (weave-owned, NOT YET BUILT)

> **ROADMAP dimension — a planned emit, not a shipped mechanism. Do not block a
> run on it; do not report it as implemented.**

A planned weave dimension: whenever a new model
drops, the weave should **auto-surface skill-relevance actions**. Research agents
track what changed between the new model and the prior one (thinking/capability
deltas, what it now does natively), and for **each skill** the weave proposes:
*still needed? · model now smart enough → **RETIRE** · or make it **LEANER**? ·
what changed in the model's reasoning that affects it?* This ties straight into
`/skill-creator`'s **capability-uplift vs encoded-preference** classification:
capability-uplift skills obsolesce as models improve; encoded-preference skills
endure. Routing these proposals through the ledger turns each model bump into more
conversion-to-change. (Fold into a future iteration / retro — not the first build.)

## 7. The RULE REGISTRY — stable IDs + lifecycle states (`$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md`)

> Born 2026-06-07 (Phase-2 Fix-7; adversary verdict KEEP with the named-owner
> amendment). The problem it kills: "E-numbers are PER-RUN namespaces, not stable
> rule IDs… Rules without stable identity cannot accumulate enforcement history"
> (A1 header) — E09 meant three different things across three runs while prose
> carried it as the passivity identity at 4+ generations.

`$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` (private records repo —
retros + registry contain operator comms) is the **durable, committed carrier** for rule FAMILIES: one
row per family with a stable `R-###` ID, born-event (date + cite), every encoding,
every break event, current lifecycle state, and a revisit trigger. States:
**HELD / BROKEN-OPEN / ENCODED-UNTESTED / RETIRED / SUPERSEDED
(/-UNRESOLVED) / LOST**.

**Current state — v1.6 (2026-08-24 IDT):** **49 family rows** (44 at v1.5 + R-046..R-050 appended by the 2026-08-24 monthly weave). R-037 is a burned ID, not a row and not a lifecycle state — it has no row and the validator's state enumeration is unchanged. Transitions written 08-24: R-003 → ENCODED-UNTESTED, R-034 HELD → BROKEN-OPEN (two weave closes without a registry write — the OWNER contract below, violated twice more, discharged by that write), R-044 → ENCODED-UNTESTED (send path). The validator counts main-table rows only (44); section-appended families are not yet counted — fold them into the main table or teach the validator (owed). [retro 2026-08-24-monthly.md]

**The contract (binding on every weave run):**

1. **The weave cites registry IDs, not per-run E-numbers.** Per-run E-numbers stay
   what they are — discharge-table keys local to one run (§4c). Any finding,
   ledger row, or weave-doc claim about a *known rule family* carries its `R-###`.
   New families get a new appended row (IDs never reused). The alias map in
   `$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` resolves historical E-number usage.
2. **Re-score writes state transitions.** The §re-score stage (§4a, the prior-run
   audit) re-verifies every registry row touched by the window and records
   transitions in the row — dated, cited, append-style. Never delete history.
3. **Recurrence reopens — mechanically.** Any recurrence of a HELD / RETIRED /
   ENCODED-UNTESTED family flips it to BROKEN-OPEN with the break event appended.
   No judgment call, no "probably fine."
4. **Two clean weaves retire.** A family retires only on 2 consecutive clean
   weaves with its enforcement substrate live — the R-006 (E35 pane-churn / T08)
   precedent, the corpus's one formal evidence-based retirement.
5. **Supersession requires a cited raw `type:user` turn.** An operator reversal
   without a citable raw turn is SUPERSEDED-UNRESOLVED and MUST be surfaced to
   Etan (standing example: R-010 squash-ban, still SUPERSEDED-UNRESOLVED pending a
   BrainLayer-traceability gate). Latest raw operator turn wins (the 05-29
   prototype arbitration rule, A4 §c.3).

**OWNER (the adversary's named-owner amendment):** the **weave seat** owns the
registry at each run close — **a run whose window contains a break/encoding/
retirement of a registered family and does NOT touch this file has failed §7.**
This is not aspirational: the gen-18 (06-21) and 07-02 weaves both **CLAIMED
re-scores but wrote NOTHING** to the registry — v1.1 stayed frozen across two
claimed re-scores, an OWNER-contract violation recorded twice-silently on R-034
and closed only by the weave-07-10 write. **The registry write is a required
loop-closing exit step, not deferrable.** [g4:11 → RULES.md:161-163,193-194,208;
g1:57,92 → 2026-07-10.md:3; meta:46]
**Between weaves, the orc boot-gate ACKs the BROKEN-OPEN rows** item-by-item
(extends §4d's ACK) and surfaces SUPERSEDED-UNRESOLVED rows. "A registry nobody
updates is carrier decay with better formatting" (B-ADV Fix-7).

Validate after any edit: `bash registry/validate-registry.sh
$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` (asserts: zero
per-run E-number row keys; E09 resolves to ONE stable ID; the R-006 retire path;
valid states; the supersession contract).

Fleet standing contracts are ambient (CLAUDE.md) — this skill states only weave-specific law.

## Files

| Path | Role |
|---|---|
| `$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` | The durable rule registry (PRIVATE records repo — retros + registry contain operator comms): stable `R-###` IDs, lifecycle states, born/encodings/breaks per family (§7); **v1.6, 49 family rows** [retro 2026-08-24-monthly.md] |
| `$ORCHESTRATOR_ROOT/weave-records/retros/<date>.md` | Per-run retros (PRIVATE records repo); `retros/README.md` here is the tombstone pointer |
| `registry/validate-registry.sh` | Re-runnable registry assertions — run `bash registry/validate-registry.sh $ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` after every registry edit |
| `scripts/convergence-gate.sh` | The 4-condition gate + RAM check; arms "weave", bypassed by "weave now" |
| `scripts/weave-run.py` | Reproducible orchestrator: `discover` → `prepare` → `batches` → `aggregate` |
| `scripts/prepare-mine-context.py` | Compact per-session context (digest + grep excerpts with `jsonl_line=N`) for one miner; Claude + Codex formats |
| `scripts/validate-dispatch-brief.py` | Pre-send validation for §EDITS worker briefs (schema + required sections) |
| `scripts/weave-ledger.py` | Action-ledger + conversion-to-change + routing-contract enforcement (flags: `--findings-dir`/`--out-dir`/`--title`, [g1:84]) |
| `scripts/corrections-rate.py` | Per-model corrections per 100 user messages, with six-bucket breakdown and low-confidence floor (§4i) |
| `scripts/correction-sweep.py` | Fix-10 correction-propagation sweep: §1 strikes grepped across all carriers; patched/not-patched table; REPORT-only, exit≠0 on RAW survivors |
| `references/topology.md` | flat-N vs staged, batch size, centerpieces-first, the round structure (see §2a/§2b for the flat-frontier + phase-recursion laws) |
| `EVAL.md` | Backtest baseline, flat-vs-staged eval, the conversion metric, smoke checks |
| `evals/fixtures/findings-{clean,violations}/` | Committed smoke fixtures: clean → `--strict` exit 0; violations → exit 2 |
| `evals/fixtures/correction-sweep/` | Committed RED/GREEN fixture: mini CORRECTIONS + tree-red (1 unpatched copy → exit 1) + tree-green (all struck → exit 0) |
| `evals/fixtures/corrections-rate/` | Committed exact-output fixture plus unknown-bucket and denominator hard-failure cases |

## Wiring (Etan's "right places")

- Invoked by the orchestrator at sprint close (the `/orc` convergence step).
- The ledger output feeds the next sprint's backlog / the gen-N large-plan.
- The mining engine is `/skill-creator` (`session-miner` + `session-miner.py`);
  `/weave` is the orchestrator wrapper that arms it, gates it on convergence, and
  routes its findings through the action-ledger. (`batch-session-miners` was
  folded into `/skill-creator` — single source of truth for mining; `/weave` is
  the only batch-mining *orchestrator* skill.)

## Integration with other skills

- `/skill-creator` — the mining engine (`mine-session`, `session-miner` sub-agent, the parser).
- `/large-plan` — weave intent briefs feed domain lead-authored large-plans; track intents come from findings.
- `/never-fabricate` — every finding cites verbatim evidence; no invented ledger rows.
- `/pr-loop` — converting a `SKILL-EDIT`/`PR-FIX` finding to `MERGED-PR` goes through it.
- `/orc` — convergence detection + dispatch of miners; surfaces the ledger to Etan.
