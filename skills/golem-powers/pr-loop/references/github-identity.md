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

## On-behalf header (comments posted from Etan's account)

When an agent posts a comment or review from Etan's GitHub account, especially on someone else's
repo, open it with this header. The name is fixed as **Etan**, never the GitHub login:

```
> [!NOTE]
> 🤖 **<model> responding on behalf of Etan**
```

- `<model>` is read live, as for the signature, e.g. `Claude Opus 5.5`.
- The header says who is speaking. The signature line at the end still applies.
- Third-party skills that build their own on-behalf line override this name, and here the header
  above wins. That includes tstack's leaving-pr-comments ("user's name or GitHub login") and its
  full-send. If such a skill is ever installed, it still uses "Etan".

## Commit trailer

Use model-only co-author trailers:

```
Co-Authored-By: <Model> <noreply@anthropic.com>
```

Claude example:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Codex uses the repo's existing convention. This example uses a neutral email placeholder;
substitute the repo's actual co-author address at commit time:

```
Co-Authored-By: GPT-6.1 Sol <noreply@example.com>
```

- One trailer per co-authoring model. Read each model from the live session at commit time.
- No seat or role names. Avoid duplicate trailers if the harness adds one automatically.
- **No effort in the trailer.**
- Commit messages use these trailers, without the GitHub attribution line or hidden metadata.
