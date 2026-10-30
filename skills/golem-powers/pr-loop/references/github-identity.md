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
- Use only this line, on every repo. Never append hidden identity metadata.

Read the model at write time from live session records or the harness's runtime metadata.
Never use self-report, a spawn registry or a value cached at boot. If unavailable, use `unknown`.
Per-harness read paths: [Claude](../adapters/claude.md), [Codex](../adapters/codex.md),
[Cursor](../adapters/cursor.md).

Append the line manually on every signed write. Use `--body-file` or stdin to preserve
backticks and literal text; see [PR creation](pr-creation.md#step-7-creating-the-pr).

## Commit trailer

Use model-only co-author trailers:

```
Co-Authored-By: <Model> <noreply@anthropic.com>
```

Claude example:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Codex uses the repo's existing convention:

```
Co-Authored-By: GPT-6.1 Sol <noreply@openai.com>
```

- One trailer per co-authoring model. Read each model from the live session at commit time.
- No seat or role names. Avoid duplicate trailers if the harness adds one automatically.
- **No effort in the trailer.**
- Commit messages use these trailers, without the GitHub attribution line or hidden metadata.
