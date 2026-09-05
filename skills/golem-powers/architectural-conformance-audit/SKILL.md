---
name: architectural-conformance-audit
description: "Pre-R0 diff of implementation vs SOTA research. Triggers: before R0, architectural audit. NOT per-PR review."
argument-hint: "<sprint-name | research-output-path>"
disable-model-invocation: false
---

# Skill: architectural-conformance-audit

> **Wave evidence (severity 10, 4 corroborating digests):** AP1 root cause was *architectural ground-truth blindness*. Researcher's SOTA output at idx [380] LITERALLY cited Letta-on-FastAPI as a counter-example, yet R0→R5 sprint hooks optimized within the daemon assumption anyway. ~35h misdirected work + 2.5h explicit correction. PR #312 fixed it in code (FastAPI daemon deleted, socket-direct CLI added, merged May 22 11:39Z). See `pain-points/_consolidated.md` Pattern 4 for the full chronology. **This skill prevents AP1-class recurrence procedurally.**

---

## WHEN TO ACTIVATE

This skill fires at a **specific sprint moment:** the kickoff of a new R0→R5 sprint OR a `large-plan` phase that builds atop a research output (whichever fires first in a given build arc). It is **NOT** a per-PR check; it is a **per-sprint gate**.

### Tier 1 — Mandatory triggers (always invoke)
- New sprint kickoff that references a prior researcher SOTA output (`research/*.md` or similar).
- New sprint that modifies / extends architecture established in an earlier PR (PR-α, PR-β, etc.).
- After any researcher dispatch whose output explicitly cites counter-examples.
- When a sprint is rebooting after an architectural correction (e.g., resuming from an AP1-class failure).

### Tier 2 — Recommended triggers (invoke unless explicitly skipped)
- New skill development that wraps or extends an MCP/daemon/service.
- When R5 evaluator score < parent-objective threshold (suggests local-optimum trap).
- When implementation language / framework choice was inherited (not first-principles).

### Tier 3 — Manual invocation
- User asks "is the architecture correct?" / "verify against research" / "before we go further, let's audit"

---

## THE AUDIT CONTRACT

The audit produces **three artifacts** before any R0 work begins:

### Artifact 1 — SOTA Excerpt (verbatim)

For each cited research output:
- Pull the SOTA output file (`research/<topic>-research.md` or equivalent).
- Extract every section that mentions architecture, framework choice, OR counter-examples.
- Quote the relevant passages **verbatim** with source indices.

Output → `docs.local/audits/<sprint>/<date>-sota-excerpt.md`.

### Artifact 2 — Implementation Map (concrete)

For the current implementation:
- List every architectural primitive (daemon, service, MCP, queue, socket, HTTP layer, persistence backend).
- For each primitive: cite file path + line range that defines it.
- For each primitive: note whether it was first-principles-derived in this sprint, inherited from a prior PR, or scaffolded by an external generator.

Output → `docs.local/audits/<sprint>/<date>-impl-map.md`.

### Artifact 3 — Conformance Verdict

For each `(SOTA excerpt × impl primitive)` pair:
- **MATCH** — implementation follows SOTA recommendation.
- **DIVERGE — UNJUSTIFIED** — implementation contradicts SOTA without documented rationale.
- **DIVERGE — JUSTIFIED** — implementation contradicts SOTA with documented rationale (cite the rationale).
- **N/A** — SOTA silent on this primitive.

**The gate rule:** if ANY `DIVERGE — UNJUSTIFIED` exists → **SPRINT R0 IS BLOCKED** until the divergence is either reconciled (impl changed) or justified (rationale documented + `brain_store`'d).

Output → `docs.local/audits/<sprint>/<date>-conformance-verdict.md`.

---

## WORKFLOW

### Step 1 — Locate the SOTA research output

Canonical scan order (most-recent on tie via `ls -lat`):

```bash
ls -lat research/*.md 2>/dev/null
ls -lat docs.local/research/*.md 2>/dev/null
ls -lat $ORCHESTRATOR_ROOT/docs.local/research/*.md 2>/dev/null
ls -lat $ORCHESTRATOR_ROOT/docs.local/handoffs/**/research/*.md 2>/dev/null
```

If multiple SOTA outputs conflict, the audit MUST list both and **require Etan to pick** the canonical source before proceeding. **Do NOT auto-canonicalize by date** — staleness is the AP1 root cause.

### Step 2 — Extract SOTA architectural claims

Read the SOTA output in full. For each architectural claim, extract:
- The claim itself.
- Source index (line number, section name, or `[N]` reference).
- Whether the claim is positive ("use X"), negative ("avoid Y"), or comparative ("X over Y because Z").
- Any cited **counter-examples** (the FastAPI case: SOTA cited Letta-on-FastAPI as the *thing not to do*).

If extraction grows large or repetitive, follow `workflows/extract-claims.md`.

### Step 3 — Map the implementation

Per architectural primitive in scope:

```bash
find src packages -name "daemon.py" -o -name "service.py" -o -name "*.service.ts" | xargs wc -l
grep -rn "^from fastapi\|^import fastapi\|from socketio\|import asyncio" src packages 2>/dev/null
grep -rn "mcp__server__\|@server\.tool\|@server\.resource" src packages 2>/dev/null
```

For each primitive found: file path + line range; direct vs. transitive (inherited) authorship; first-principles vs. scaffolded. If mapping grows large, follow `workflows/map-impl.md`.

### Step 4 — Diff

For each `(SOTA claim, impl primitive)`:
- SOTA says "use X" + impl uses X → **MATCH**.
- SOTA says "use X" + impl uses Y → **DIVERGE** (look for documented rationale via `git log -p --follow <impl-file>` and `brain_search "<primitive> chosen over <alternative>"`).
- SOTA cites X as **counter-example** + impl uses X → **DIVERGE — UNJUSTIFIED** unless explicitly documented (this IS the AP1 pattern; treat as severity-10).
- SOTA silent → **N/A**.

### Step 5 — Gate decision

- ANY `DIVERGE — UNJUSTIFIED` → **R0 BLOCKED**. Surface to Etan + sprint LEAD with verbatim SOTA cite + impl divergence + proposed reconciliation path (change impl OR document rationale).
- ALL `MATCH | DIVERGE — JUSTIFIED | N/A` → **R0 CLEARED**. `brain_store` the audit verdict at importance ≥8 with tags `[architectural-audit, <sprint>, R0-cleared]`. Composes with `/brain-store-fallback` for transport failures.

**There is no `--override` flag.** Per gen-8 decision: document or change impl — those are the only two paths. Footgun risk too high. If override is later deemed necessary, it must `brain_store` at importance 10 with tag `[audit-override]` + verbatim rationale.

---

## ANTI-PATTERNS

### AP1 — Reading research output but not diffing against impl
The historical case. Researcher's output at idx [380] existed; multiple agents READ it (researcher, R5 evaluator, Codex workers, Cursor auditors). Nobody DIFFED it against `daemon.py`. The audit MUST produce a literal pairwise diff, not "I read the research."

### AP2 — Skipping audit because "we already audited this last sprint"
Architectural assumptions decay. Each sprint must re-audit. If nothing changed, the audit is fast (re-cite the prior verdict). If something changed, the audit catches it.

### AP3 — Treating "the researcher said use X" as gospel
SOTA outputs themselves can be wrong or stale. The audit's job is **conformance** — does impl match SOTA? — NOT validation that SOTA is correct. If SOTA is wrong, that's a separate research-correction sprint (and worth flagging).

### AP4 — Confusing this with code review
Code review reads the diff and checks craft. This audit reads the architecture and checks first-principles alignment. They compose; this fires BEFORE R0, code review fires DURING R3.

### AP5 — Letting the audit become a paperwork exercise
If audits routinely come back MATCH for everything with no friction, suspect false-pass. The audit's value comes from catching real DIVERGE cases. If 3 consecutive sprints show all-MATCH, run a meta-audit on the auditor (was it reading the right SOTA? was it checking the right primitives?).

---

## COMPOSITION

- **Research artifacts** — Claude Desktop/Gemini/web research outputs feed the SOTA output this audit reads.
- **`/never-fabricate`** — audit verdicts cite specific file paths + line ranges; never-fabricate enforces that those citations are real. This skill is the architectural-level fabrication guard; never-fabricate is the file-level guard.
- **`/brain-store-fallback`** (SHIP-2, merged) — audit verdicts get stored at importance ≥8; brain-store-fallback handles transport failures during storage. Mandatory composition.
- **`/coderabbit`** — composes downstream; coderabbit fires per-PR, this skill fires per-sprint.
- **`/plan-validate`** — adjacent skill (general assumption checks); plan-validate is general, this is architecture-specific.
- **`/large-plan/workflows/scaffold`** — the audit is a pre-R0 step in scaffold.md so it isn't skipped by oversight.
- **`/orc`** — orc invokes this skill at sprint kickoff when Tier-1 triggers fire.

---

## EVALS (summary — full scenarios in `evals/evals.json`)

| # | Scenario | Without skill (baseline) | With skill (target) | Assertion |
|---|---|---|---|---|
| 1 | SOTA recommends socket-direct; impl uses FastAPI HTTP (AP1 re-creation) | R5 graded local-optimum 8.85/10; mismatch slips through | DIVERGE — UNJUSTIFIED; R0 blocks until reconciled | Verdict file lists FastAPI primitive with counter-example cite |
| 2 | SOTA recommends X; impl uses X | No-op | MATCH; R0 clears | Verdict shows MATCH; brain_store fires |
| 3 | SOTA silent on primitive Z; impl uses Z | No-op | N/A for Z (doesn't block) | Verdict file shows N/A for Z |
| 4 | Two SOTA outputs conflict | Stale SOTA used silently | Audit lists both; gate held pending Etan pick | Both files referenced; no auto-canonicalize |
| 5 | Mixed MATCH/DIVERGE across multiple primitives | Slips through | Lists all; ANY UNJUSTIFIED blocks | R0 blocked even if 9/10 MATCH |

**The AP1 re-creation eval (scenario 1) is load-bearing.** Fixture: real-world excerpt from the May 2026 brainlayer-readpath research output + synthetic FastAPI daemon snippet mimicking the deleted PR-α `daemon.py`.

**Smoke test (retrospective):** run against the current brainlayer codebase POST-PR #312. Expected: MATCH on socket-direct primitive (the audit retrospectively confirms the fix held). Note: smoke is **read-only** against `$HOME/Gits/brainlayer/` per cross-repo constraint.

---

## DEFINITION OF DONE (per-invocation)

- [ ] Audit produces 3 artifacts in `docs.local/audits/<sprint>/<date>-{sota-excerpt,impl-map,conformance-verdict}.md`.
- [ ] R0 gate is enforced: ANY UNJUSTIFIED DIVERGE blocks proceeding.
- [ ] Verdict is `brain_store`'d at importance ≥8 with tags `[architectural-audit, <sprint>, R0-cleared|R0-blocked]`. Use `/brain-store-fallback` if BL transport fails.
- [ ] Skill composes cleanly with research artifacts, `/coderabbit`, `/large-plan/scaffold`.
- [ ] AP1 re-creation eval passes (scenario 1 fixture).

---

## R5 EVALUATOR EXTENSION — OUT OF SCOPE HERE

Per consolidated.md Pattern 4 system-fix:
> "R5 evaluator skill change: must include 'goal-envelope check' — score against the original parent objective, not the sprint's local optimization."

This skill does **NOT** modify the R5 evaluator (it's a separate skill change, tracked as a future SHIP-9 candidate). This skill surfaces the parent-objective in the audit so the R5 evaluator has a referenceable target. The two compose; they ship independently.

---

## ESCALATION

- Multiple SOTA candidates conflict → list both, require Etan to canonicalize. Do NOT auto-pick by date.
- AP1-class DIVERGE found → R0 BLOCKED message MUST include verbatim SOTA cite, file path of divergent impl, and explicit "change impl OR document rationale" path. No silent block.
- BrainLayer transport fails during verdict storage → fall back via `/brain-store-fallback` and report the fallback file path in the verdict.
