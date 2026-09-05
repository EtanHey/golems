---
name: research-lifecycle
description: "Refresh local research context and the Drive grounding corpus. Triggers: stale context, R-number."
---

# Research Lifecycle — Context Freshness Management

> Anti-pattern: R75 says "FTS5 is 96.9% desynced" — but it's been fixed for days. Without lifecycle management, R76 starts from wrong assumptions.

Research context files live at `docs.local/claude-web/projects/<project>/`. After a sprint implements research findings, these files go STALE. The local corpus is the source; Google Drive is the grounding corpus Gemini reads. This skill refreshes both so the next research round starts from truth, not assumptions.

---

## HARVEST GATE — research without a harvest path is PARKED, not done

Every research dispatch — fleet-fired OR **Etan-fired in his own Gemini/NotebookLM UI** (standing **fire=Etan** rule) — MUST carry these fields **at dispatch time**:

| Field | Required content |
|-------|------------------|
| **harvest_owner** | Named agent/LEAD who owns pulling results back into the fleet |
| **harvest_trigger** | What event starts harvest (report complete, Drive export lands, cron poll, Etan says "it's done", etc.) |
| **export_route** | Where results land for the fleet: Drive path, `docs.local/research/`, collab ack, brain_store digest — adapters must name this explicitly |

**Research without all three = PARKED.** Do not mark done, do not brain_store conclusions, do not close the collab row until harvest completes or Etan explicitly parks it.

Applies to `/gemini-research`, `/claude-desktop-research`, and orc W5 research dispatches. The E07 integrity gate catches bad claims; this gate catches **throughput** — results sitting unharvested since morning.

---

## THE LIFECYCLE

```
SPRINT COMPLETES (findings implemented)
  │
  ├─ 1. NEWEST: Add sprint results as new context file
  │     (what changed, benchmark numbers, PRs merged)
  │
  ├─ 2. CONDENSED: Compress older context files
  │     (files 01-50 → one condensed file)
  │
  ├─ 3. UPDATED: Refresh description.md with current state
  │     (facts first, narrative second)
  │
  ├─ 4. ARCHIVED: Move implemented research results
  │     (R-numbers whose findings are now in code)
  │
  └─ 5. MIRRORED: Update Drive AND NotebookLM
        (Drive required; NotebookLM only when a project notebook exists)
```

---

## STEP 1: NEWEST — Add Sprint Results

After a sprint that implements research findings, create a new context file:

```markdown
# File: research-context/NN-sprint-results-{date}.md

## Sprint: {description}
- Date: {date}
- PRs merged: #{N}, #{N}, #{N}

## What Changed
- {specific change 1}: {before state} → {after state}
- {specific change 2}: {before} → {after}

## Benchmark Numbers
- {metric}: {old value} → {new value}
- {metric}: {old} → {new}

## What's Still Open
- {remaining issue 1}
- {remaining issue 2}
```

**Key:** Include BEFORE and AFTER states. The researcher needs to know what was the problem AND what's the current state.

**Naming:** Use sequential numbers (91-, 92-, 93-...) to preserve ordering. Prefix with the topic.

---

## STEP 2: CONDENSED — Compress Stale Context

When context files accumulate (>10 files or >50KB total), condense older ones:

```
BEFORE:
  91-swift-python-root-cause.md     (from 2 weeks ago, findings implemented)
  92-brainbar-ux-current-state.md   (from 1 week ago, partially stale)
  93-inspiration-references.md       (timeless, keep as-is)
  94-search-improvement-collab.md   (from yesterday, still current)

AFTER:
  condensed-pre-R75.md              (91 + 92 merged, updated to current state)
  93-inspiration-references.md       (unchanged — timeless content)
  94-search-improvement-collab.md   (unchanged — still current)
  95-R75-sprint-results.md          (NEW — what the sprint changed)
```

**Condensation rules:**
- Merge files about the SAME topic into one
- Update claims to current state (remove "FTS5 is broken" if it's fixed)
- Keep timeless content as-is (references, architecture decisions with rationale)
- Remove redundant context (if 3 files say "BrainBar is Swift", keep it in one place)

---

## STEP 3: UPDATED — Refresh description.md

The project description file tells the researcher what the project IS. It must reflect current state.

```
Location: docs.local/claude-web/projects/<project>/description.md
```

**Refresh checklist:**
- [ ] Architecture claims match current code (check recent PRs)
- [ ] Stats are current (chunk count, entity count, test count)
- [ ] Open issues are actually still open (not fixed in latest sprint)
- [ ] "Known limitations" haven't been resolved
- [ ] No claims about features that are stubs (check with /never-fabricate)

**Format:** Facts first, narrative second. Lead with numbers, follow with explanation.

```markdown
## Current State (as of {date})
- Chunks: 299,972 (FTS5: 100% synced ← was 3.1% before R75 sprint)
- Entities: 166 (0.055% coverage ← needs improvement)
- Tests: 675 passing
- MCP: BrainBar (Swift daemon), 5 working tools + 3 stubs

## Architecture
{current architecture, verified against code}
```

---

## STEP 4: ARCHIVED — Move Implemented Research

Research results (R-number files) whose findings are fully implemented should move to archived:

```bash
# Move completed research
mv docs.local/claude-web/projects/brainlayer/R38-knowledge-graph.md \
   docs.local/claude-web/projects/archived/brainlayer/
```

**Archive criteria:**
- ALL findings from the research are implemented (check PRs)
- Benchmark improvements are captured in a sprint results file
- The research is >1 sprint old (keep recent research active for reference)

**DON'T archive:**
- Research with partially-implemented findings (keep, mark which are done)
- Timeless architectural decisions (keep in main project)
- The LATEST research result (always keep the most recent R-number)

---

## STEP 5: MIRRORED — Drive AND NotebookLM

The local corpus is the source to push. Drive is where Gemini grounds, so the Drive refresh is blocking; NotebookLM mirroring is conditional on a project notebook existing.

1. **Prove Drive auth and account identity with real calls.** `"MCP connected"` is NOT evidence of Drive auth. Call `authGetStatus`; continue only when the real call succeeds and returns authed. Tool discovery or a connected-tool count does not pass this gate. Then verify the active account before any upload, replacement, or deletion:
   ```bash
   # Project has a NotebookLM notebook: verify both identities.
   bash skills/golem-powers/_shared/research/verify-account.sh --expect research-account@example.com

   # No project notebook: verify Drive without requiring NotebookLM auth state.
   bash skills/golem-powers/_shared/research/verify-account.sh \
     --expect research-account@example.com --drive-only
   ```
   Save the successful JSON output in the lifecycle receipt. A call failure or account mismatch is blocking; switch profiles and rerun verification instead of reconciling the wrong Drive corpus.

2. **Resolve the canonical destination.** Use `/drive-usage` for the correct numbered folder and naming convention. Use `/braindrive` to resolve current folder IDs and the Gemini-facing corpus; do not trust stale hard-coded IDs.

3. **Reconcile the managed Drive corpus to local truth.** Upload or replace every current local context file under the canonical project corpus, keeping local and Drive relative names identical. Track the complete lifecycle-managed file set. Delete only previously managed Drive files that are absent locally; never delete unrelated Drive documents. Unexpected duplicate managed names fail the gate.

4. **Verify the refresh with a real Drive read.** List/search and download/read the destination after upload. Record every local and Drive relative name, `modifiedTime`, and SHA-256 content digest in a receipt. The completion command independently walks `--local-root`, hashes every regular file, and rejects a receipt that omits or changes any canonical local entry. `DRIVE_FILESET=PASS` requires the Drive names to equal that derived inventory with no duplicates. `DRIVE_FRESHNESS=PASS` requires every Drive digest to match its local source and every Drive `modifiedTime` to be at least as new. Missing or unverifiable content is `FAIL`.

5. **If the project has a NotebookLM notebook** (see `/gemini-research`), add updated replacement files first:
   ```
   source_add(notebook_id, source_type="file", file_path="updated-context.md", wait=True)
   ```

6. Verify the replacements are indexed and readable, then delete the stale sources:
   ```
   source_delete(source_id=stale_source, confirm=True)
   source_list_drive(notebook_id)
   ```
   Record the replacement IDs returned by `source_add`, the stale source IDs, and the final indexed source IDs returned by readback. `NOTEBOOKLM_FRESHNESS=PASS` requires every expected replacement ID to exist and every stale source ID to be absent; a bare `fresh: true` claim does not pass.

7. Update notebook instructions:
   ```
   chat_configure(notebook_id, goal="custom",
     custom_prompt="Context files have been updated as of {date}. Previous findings about {X} are now implemented.")
   ```

**Remember NP3:** .py/.json/.swift/.yaml files must be renamed to .txt for NotebookLM upload.

---

## GEMINI RESEARCH PROMPT PREFLIGHT — BLOCKING

Before emitting any Gemini research prompt, require exactly one `# Grounding` block. That block must contain either a Drive document referenced by name or the exact line `None — web-only research`. Never instruct Etan to attach or upload Drive documents; his connected Drive workspace pulls named documents itself.

Run the executable gate against the prompt file. It checks the block structure and invokes the shared no-attach gate:

```bash
PROMPT=/path/to/R{NN}-prompt.md
node skills/golem-powers/research-lifecycle/scripts/lifecycle-gate.mjs \
  preflight --prompt "$PROMPT"
```

Any non-zero result means `GEMINI_PREFLIGHT=FAIL`: do not emit or fire the prompt. Add the missing named-document grounding or the explicit web-only line, then rerun the checks.

---

## LIFECYCLE COMPLETION GATE — BLOCKING

Write the verification evidence to a receipt, then run the same executable gate:

```json
{
  "driveRoute": {"canonical": true, "resolvedWith": ["/drive-usage", "/braindrive"]},
  "driveAuth": {"callSucceeded": true, "authed": true},
  "accountVerification": {
    "callSucceeded": true,
    "drive_account": "research-account@example.com",
    "notebooklm_account": "research-account@example.com",
    "expected": "research-account@example.com",
    "match": true,
    "drive_only": false
  },
  "localFiles": [
    {"name": "01-context.md", "sha256": "<64 hex chars>", "modifiedTime": "<ISO-8601>"}
  ],
  "driveFiles": [
    {"name": "01-context.md", "sha256": "<64 hex chars>", "modifiedTime": "<ISO-8601>"}
  ],
  "notebooklm": {
    "exists": true,
    "expectedReplacementIds": ["source-new"],
    "indexedSourceIds": ["source-new"],
    "staleSourceIds": ["source-old"]
  }
}
```

```bash
LOCAL_ROOT=docs.local/claude-web/projects/PROJECT
node skills/golem-powers/research-lifecycle/scripts/lifecycle-gate.mjs \
  completion --receipt /path/to/lifecycle-receipt.json --prompt "$PROMPT" \
  --local-root "$LOCAL_ROOT"
```

The lifecycle may be marked complete only when the command exits 0 and every row passes:

| Check | PASS criterion |
|-------|----------------|
| `DRIVE_ROUTE` | Receipt names the canonical destination resolved through `/drive-usage` and `/braindrive` |
| `DRIVE_AUTH` | A real `authGetStatus` call succeeds and returns authed |
| `DRIVE_ACCOUNT` | `verify-account.sh` succeeds and records the intended active Drive identity |
| `LOCAL_INVENTORY` | Receipt local names/digests/timestamps exactly equal the inventory derived from `--local-root` |
| `DRIVE_FILESET` | Managed Drive names exactly equal the derived local inventory; no missing, extra, or duplicate managed file |
| `DRIVE_FRESHNESS` | Every Drive SHA-256 matches local content and every Drive `modifiedTime` is at least as new |
| `NOTEBOOKLM_FRESHNESS` | Explicitly not applicable, or source-ID readback proves expected replacements exist and stale sources are absent |
| `GEMINI_PREFLIGHT` | The next Gemini prompt passes the executable grounding/no-attach preflight |

**If the Drive corpus is older than the local context, the lifecycle is NOT complete.** Auth failure, account mismatch, missing files, or unverifiable Drive freshness also fail the lifecycle; report the failing row instead of silently skipping it.

---

## WHEN TO TRIGGER

| Trigger | Action |
|---------|--------|
| Sprint merged PRs that address research findings | Run full lifecycle (Steps 1-5) |
| Before writing a new R-number research prompt | Run Steps 2-5, then the Gemini prompt preflight |
| Nightly/project maintenance runs | Check if context files are stale (Step 3 at minimum) |
| Context file count > 10 | Run Step 2 (condense) |
| Local context changed | Run Step 5 (Drive refresh is blocking) |
| NotebookLM notebook exists | Run the NotebookLM portion of Step 5 |

---

## STALENESS DETECTION

A context file is STALE when:

1. **It describes a problem that's been fixed** — e.g., "FTS5 is 96.9% desynced" after PR fixing it
2. **Its benchmark numbers are outdated** — e.g., "675 tests" when there are now 720
3. **Its architecture claims are wrong** — e.g., "Python MCP" when it's now Swift BrainBar
4. **It references PRs as "open" that are merged** — check via `gh pr view`
5. **It's >2 sprints old and never updated** — age alone signals staleness

**Quick staleness check:**
```bash
# Find context files older than 7 days with no updates
find docs.local/claude-web/projects/PROJECT/research-context/ -name "*.md" -mtime +7
```

---

## INTEGRATION

| Skill | How Research Lifecycle Uses It |
|-------|------------------------------|
| Claude/Gemini research runs | Create research results → lifecycle manages them afterward |
| `/drive-usage` | Select the canonical Drive folder and stable artifact names |
| `/braindrive` | Resolve current Drive corpus locations and verify Gemini-facing files |
| `/gemini-research` | Enforce Drive grounding preflight and NotebookLM mirroring rules |
| Nightly/project maintenance | Should check research context staleness during sweeps |
| `/never-fabricate` | Verify claims in description.md against actual code before updating |
| `/orc` W5 | Claude Web research prompts consume these context files |

---

## EXAMPLE: Post-R75 Lifecycle

R75 sprint fixed FTS5 sync, implemented detect_entities_in_prompt, improved search.

1. **NEWEST:** Create `95-R75-sprint-results.md` with: FTS5 3.1%→100%, entity detection implemented, search hybrid mode live
2. **CONDENSED:** Merge `91-swift-python-root-cause.md` + `92-brainbar-ux-current-state.md` → `condensed-pre-R75.md` (update "FTS5 broken" → "FTS5 fixed in PR #198")
3. **UPDATED:** Refresh `description.md` — chunk count, entity count, test count, remove "FTS5 broken" from known issues
4. **ARCHIVED:** Move `R38-knowledge-graph.md` (fully implemented) to `archived/brainlayer/`
5. **MIRRORED:** Push the current local corpus to Drive, verify Drive freshness, then replace stale NLM sources
