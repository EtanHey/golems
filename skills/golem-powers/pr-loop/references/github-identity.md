# GitHub Agent-Identity Convention v1 (RATIFIED 2026-08-08)

> Ratified by Etan by voice, 2026-08-08. Source of truth for the design and its ratification record:
> `$ORCHESTRATOR_ROOT/docs.local/maintenance/2026-08-08-github-identity-convention-DESIGN.md` (v1.1).
> That file is gitignored — the binding rules are reproduced here in full so this skill is
> self-contained (pr-loop's own "PR-Referenced Artifacts Must Be Committed" rule).
>
> **Why it exists:** the 2026-08-03 identity audit found **96.7% of 7,390 PR comments under
> `EtanHey` are agent-written**, with only 8 comments to 6 outside contributors. Nothing on GitHub
> distinguishes Etan from a golem, or one golem from another, or one model from another.

## Scope — what gets signed

| Surface | Signed? | How |
|---|---|---|
| PR comment (`gh pr comment`) | YES | signature block at the end |
| PR body (`gh pr create`) | YES | signature block at the end |
| PR review body (`gh pr review`) | YES | signature block at the end |
| Issue comment (`gh issue comment`) | YES | signature block at the end |
| Inline review-thread replies | YES | signature block at the end |
| Git commits | NO signature block — use the **commit trailer** below |
| Code, docs, collab files | NO | collabs already carry claimed-name addressing |
| Anything typed by Etan himself | **NO** | raw `gh` outside a launcher stays unsigned — unsigned means human |

**Unsigned is load-bearing.** The convention only works if the absence of a signature reliably means
"Etan wrote this." Never sign on a human's behalf, and never strip a signature from your own writes.

## The signature block

Two parts, always together, always last in the body:

**1. Visible line (for humans):**

```
— brainlayerClaude (lead) · claude-code/opus-4.6
```

Shape: `— <seat> (<role>) · <harness>/<model>`

**2. Invisible blob (for machines — GitHub renders an HTML comment as nothing):**

```
<!-- golem-id v1 {"seat":"brainlayerClaude","role":"lead","harness":"claude-code","model":"claude-opus-4.6","model_source":"session-jsonl","session":"db7f3bb9","ts":"2026-08-08T18:40:00Z"} -->
```

The blob is **one line of JSON** — no wrapping, no smart quotes, no trailing comma. A wrapped or
prettified blob is not parseable by the backfill/audit tooling and counts as unsigned.

### Ownership marker (Etan's rule, ratified Q2)

- On repos owned by **`EtanHey`** → the visible line is plain: `— brainlayerClaude (lead) · …`
- On **anyone else's** repo → it opens with possession: `— EtanHey's brainlayerClaude (lead) · …`
  so an outside maintainer immediately knows whose agent is commenting.

Decide by comparing the repo owner to `EtanHey`:
`gh repo view --json owner --jq .owner.login` (the wrapper does this automatically once it ships).

### Field rules

| Field | Source | Notes |
|---|---|---|
| `seat` | launcher env `GOLEM_SEAT` | e.g. `brainlayerClaude`. Launcher knows it at spawn. |
| `role` | launcher env `GOLEM_ROLE` | `lead` or `worker` — canon has no third role. |
| `harness` | launcher env `GOLEM_HARNESS` | `claude-code` · `codex` · `cursor` |
| `model` | **live session metadata, read at write time** | See Provenance below. Never self-report, never spawn registry. |
| `model_source` | where `model` was actually read from | So a later audit can trust or discount the row. Values: `session-jsonl`, `harness-reported`, `unavailable`. |
| `session` | session id prefix (8 chars) | Links comment → JSONL → BrainLayer trace. |
| `ts` | ISO-8601 UTC at write time | `date -u +%Y-%m-%dT%H:%M:%SZ` |

**There is NO `effort` field. Not in the visible line, not in the blob, not in the commit trailer.**
Ratified v1.1 amendment: effort is not public data. It is registered at the BrainLayer commit/PR
checkpoint, keyed session+SHA (brainlayerClaude owns that lane). If you find yourself adding
`effort:` to anything that lands on GitHub, you are working from the pre-v1.1 draft.

`golem-id v1` is versioned on purpose — the format can evolve without breaking parsers. Do not emit
`v1` with fields v1 does not define.

## Provenance (the rule that makes the signature worth anything)

Verbatim from the ratified design, v1.1 amendment 2:

> **"Actual effort, not spawn effort"** (Etan, near-verbatim: *"make sure we get the actual effort
> and not just whatever cmuxlayer captured when the agent was spawned"*): effort (and model)
> provenance is the session's own turn records / work-time state — NEVER cmux spawn registry
> metadata, the surface that produced the xhigh-default lie (cmuxlayer #359 family).

Verbatim from the ratification record, Q1:

> Etan, near-verbatim: *"Sure, but the repoGolem doesn't always determine [the model] … you can't
> boot a maintenance Claude or orc Claude with a model of fable without me changing the model — I
> don't think the repoGolem can determine it for sure."*
> → **Binding design consequence:** `model` and `effort` are read from LIVE session metadata at
> signature time — never from boot-time launcher env. Launcher env supplies only seat/role/harness.
> … **the gh() wrapper must re-read model per invocation, not cache at spawn.**

Three rules fall out, and all three are hard:

1. **Never the model's self-report.** An agent asked "what model are you?" answers from training
   priors, not from fact (AP7 — Codex self-id lies are documented). Read the record, not the claim.
2. **Never the cmux spawn registry.** That surface defaults values it never observed (the
   `xhigh` lie, cmuxlayer #359 family). It records what was *requested at spawn*, not what is
   *running now*.
3. **Never cache at spawn.** Etan switches models mid-session. Model is re-read **per invocation**;
   a value read at boot is stale the moment he changes it. **Measured (2026-08-08):** one
   orchestrator session JSONL (`08d077d1`) carries `claude-fable-5`, `claude-opus-4-8`, and
   `claude-opus-5` turns in the same file. A boot-time read would have mis-signed most of it.

If the live value genuinely cannot be read, emit `"model":"unknown","model_source":"unavailable"`.
Guessing is fabrication (canon #3), and a wrong model in a signature is worse than an honest gap —
it poisons every audit that trusts the field.

Per-harness read paths live in the adapters: [claude](../adapters/claude.md) ·
[codex](../adapters/codex.md) · [cursor](../adapters/cursor.md).

## Commit trailer

Today's fleet habit is a fixed, model-only, seat-blind string (`Co-Authored-By: Claude <model>
<noreply@anthropic.com>` — the Claude Code harness injects this wording by default). Ratified
replacement:

```
Co-Authored-By: <seat> running <model> <noreply@anthropic.com>
```

Example:

```
Co-Authored-By: brainlayerClaude running claude-opus-4.6 <noreply@anthropic.com>
```

- `<model>` obeys the same provenance rules as the blob — live session metadata, read at commit time.
- **No effort in the trailer.** The ratification record's Q3 line quotes an earlier draft with
  `at high effort`; the v1.1 header amendment (later, same session) drops effort from the trailer
  along with everything else public. v1.1 wins. Do not "restore" the effort clause.
- The harness default trailer names only the model, so **this rule overrides the harness default**
  string. If a harness auto-appends its own trailer, the seat-aware form replaces it — one
  `Co-Authored-By` line, not two.
- Canon touch: canon #2 (PR-loop) owns branch→merge but does **not** carry the trailer string —
  as of 2026-08-08 `standards/fleet-canon.md` contains no `Co-Authored-By` text. Canon edits are
  Etan's ratification; this skill documents the form.

## The `gh()` wrapper (contract — NOT built yet)

Build ownership is the **golems / repoGolem lane**, not this skill. Contract as designed:

- Exported by the repoGolem launcher env, so every seat (Claude, Codex, Cursor) inherits it.
- Intercepts `gh pr comment` · `gh pr create` · `gh pr review` · `gh issue comment`.
- Appends the visible line + blob from launcher env (seat/role/harness) + **live** session metadata
  (model/session), re-read per invocation.
- Applies the ownership marker by comparing repo owner to `EtanHey`.
- Raw `gh` invoked outside a launcher stays unsigned — that path is Etan himself, and signing it
  would break the "unsigned means human" invariant.
- Agents change nothing once it lands. Zero per-use hassle was the design requirement.

**Until it lands: append the block by hand on every GitHub write listed in Scope.** Use
`--body-file` or a heredoc so the blob survives shell quoting (see pr-loop Step 7).

## Failure-mode catalog

| # | Failure | What it looks like | Rule |
|---|---|---|---|
| 1 | Self-reported model | `"model":"gpt-5.4"` because the agent believes it is GPT-5.4 | Read the session record; AP7 says the belief is unreliable |
| 2 | Spawn-registry model/effort | model/effort copied from the cmux spawn payload | Banned surface — it produced the `xhigh` lie |
| 3 | Cached-at-spawn model | signature says `fable` all session after Etan switched to Opus | Re-read per invocation |
| 4 | `effort` anywhere on GitHub | `· effort:high` in the visible line, or `"effort"` in the blob/trailer | Strip it. Effort → BrainLayer checkpoint only |
| 5 | Guessed model | any value not actually read | `"model":"unknown","model_source":"unavailable"` |
| 6 | Blob wrapped over lines | pretty-printed JSON inside the HTML comment | One line, or it is unparseable = unsigned |
| 7 | Signature mangled by shell | backticks/quotes eaten by command substitution | `--body-file` / heredoc, never inline `--body "…"` for signed bodies |
| 8 | Missing ownership marker | plain `— seat (role)` on a third-party repo | Prefix `EtanHey's ` when repo owner ≠ `EtanHey` |
| 9 | Signing a human's comment | a signature on something Etan typed | Unsigned means human — never sign for him |
| 10 | Signature block in a commit message | visible line + blob pasted into a commit body | Commits use the trailer form, nothing else |
| 11 | Two `Co-Authored-By` lines | harness default plus the seat-aware form | The seat-aware form replaces the default |
| 12 | Signature above the content | block placed before the body text | Always last — humans read the message first |

## Rollout position

1. **skillCreator (this file + pr-loop/cmux-agents edits)** — documents the convention so agents
   comply before the wrapper exists. ← you are here
2. **golems / repoGolem lane** — `gh()` wrapper + `GOLEM_SEAT`/`GOLEM_ROLE`/`GOLEM_HARNESS` exports.
3. **brainlayer lane** — checkpoint-time effort capture (issue #655 is OPEN, unstarted, and
   model-only; effort is captured nowhere today — `ingest/codex.py:159-162` reads `payload["model"]`
   and discards `effort` from the same `turn_context`).
4. **Backfill decision** — returns to Etan after; not started.
