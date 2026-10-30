# GitHub Agent Identity

Agent-authored GitHub writes identify the models and harness that produced them.

## Scope

Sign PR bodies, PR comments, reviews, issues, issue comments and inline review replies.
Never sign on a human's behalf. Code, docs and collab files need no signature.
Commits use the co-author trailer below.

## Signature

End every PR body, PR comment, review and issue we write with ONE plain line (no leading em dash),
naming the model(s) that did the work and the harness:

    🤖 Generated with <model> in <harness>

- One model: `🤖 Generated with Claude Opus 5.5 in T3 Code Nightly`
- Both families did work: `🤖 Generated with Claude Opus 5.5 and GPT-6.1 Sol in T3 Code Nightly`
  (the implementer's model first)
- Outside T3: `🤖 Generated with GPT-6.1 Sol in Codex` / `… in Claude Code`
- Read the model from the live session, never from memory. No effort level, seat or role names in
  the visible line.
- Use this line only on every repo; never append hidden identity metadata.

Read the model at write time from live session records or the harness's runtime metadata.
Never use self-report, a spawn registry or a value cached at boot. If unavailable, use `unknown`.
Per-harness read paths: [Claude](../adapters/claude.md), [Codex](../adapters/codex.md),
[Cursor](../adapters/cursor.md).

Append the line manually on every signed write. Use `--body-file` or stdin to preserve
backticks and literal text; see [PR creation](pr-creation.md#step-7-creating-the-pr).

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

- `<model>` obeys the live-session provenance rule above — live session metadata, read at commit time.
- **No effort in the trailer.** The ratification record's Q3 line quotes an earlier draft with
  `at high effort`; the v1.1 header amendment (later, same session) drops effort from the trailer
  along with everything else public. v1.1 wins. Do not "restore" the effort clause.
- The harness default trailer names only the model, so **this rule overrides the harness default**
  string. If a harness auto-appends its own trailer, the seat-aware form replaces it — one
  `Co-Authored-By` line, not two.
- Canon touch: canon #2 (PR-loop) owns branch→merge but does **not** carry the trailer string —
  as of 2026-08-08 `standards/fleet-canon.md` contains no `Co-Authored-By` text. Canon edits are
  Etan's ratification; this skill documents the form.
