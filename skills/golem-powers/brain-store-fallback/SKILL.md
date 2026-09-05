---
name: brain-store-fallback
description: "Fallback for failed brain_store: write memory to docs.local for replay. Triggers: null chunk, DB busy, close."
argument-hint: "[--slug <name>] [--importance <1-10>]"
disable-model-invocation: false
hooks:
  PostToolUse:
    - if: "tool == 'mcp__brainlayer__brain_store' && (result.chunk_id == null || result.elapsed_ms > 25000 || result.text matches 'queued|queue depth|deferred|TOOL_RETURNED_TEXT=no' || error matches 'Transport closed|database is locked|apsw.ReadOnlyError|-32000|Connection closed')"
      action: auto-invoke
      pass_args: { content: content, importance: importance, tags: tags, error_class: error_class }
---

# Brain Store Fallback

Use this skill whenever a `brain_store` call might not have durably written to
BrainLayer.

Wave evidence: 72h-mine found BrainLayer DB-busy and MCP transport closures as
the #2 severity-10 ecosystem pattern, with silent `brain_store` loss across six
or more recent sessions. See `pain-points/_consolidated.md`.

## Core Rule

If `brain_store` does not return a concrete `chunk_id`, do not report that the
content was stored in BrainLayer.

Instead, write the exact original content to:

```text
docs.local/decisions/<YYYY-MM-DD>-<slug>.md
```

Then report:

```text
Queued to docs.local/decisions/<file> pending BrainLayer recovery.
```

## Activation Signals

Activate on any Tier 1 hard failure:

- `Transport closed`
- `-32000: Connection closed`
- `apsw.ReadOnlyError`
- `database is locked`
- Python exception text in the MCP error channel
- `brain_store` returns `null`, undefined, or no `chunk_id`
- Probe result includes `TOOL_RETURNED_TEXT=no`

Activate on any Tier 2 soft queue signal:

- `chunk_id: null`
- Response says `queued`, `queue depth`, `deferred`, or similar without a
  durable chunk id
- The call takes longer than 25 seconds

Treat Tier 3 signals as advisory:

- The latest `brain_search` also failed with a transport error
- Other BrainLayer tools are returning connection failures

Tier 3 means be ready to fall back on the next `brain_store`; it does not by
itself replace the primary `brain_store` attempt.

## Fallback Contract

The fallback file is a local replay queue entry, not a BrainLayer ack.

Write YAML frontmatter followed by the exact original content:

```yaml
---
intended_brain_store: true
importance: <1-10>
tags: [<original tags>]
timestamp: <ISO 8601>
reason: <transport_closed | db_busy | queued_null_chunk | readonly | unknown>
retry_attempted: false
chunk_id:
---
<original brain_store content, byte-for-byte>
```

Preserve all four `brain_store` semantics:

- Content
- Importance
- Tags
- Timestamp

Do not add fallback annotations to the body. Do not reformat the body. Do not
drop tags or importance.

## Filename Rule

Use the original timestamp date plus a deterministic slug:

```text
docs.local/decisions/<YYYY-MM-DD>-<slug>.md
```

If `--slug` is supplied, sanitize it:

- lowercase
- spaces to hyphens
- keep only letters, numbers, and hyphens
- collapse duplicate hyphens

If no slug is supplied, derive one from the content:

```text
<first-8-tokens>-<hash-prefix>
```

Where:

- `first-8-tokens`: split the content on whitespace, trim leading and trailing
  punctuation from each token, lowercase each token, keep only letters,
  numbers, and hyphens, drop empty tokens, take the first eight, then join with
  hyphens.
- `hash-prefix`: first eight characters of the lowercase hex-encoded SHA-256
  hash of the original byte-for-byte content body.

The same content with the same original timestamp must resolve to the same
filename. This prevents retry pollution.

## Immediate Workflow

1. Call `brain_store` first.
2. Inspect the result.
3. If `chunk_id` is present and non-empty, report the BrainLayer chunk id.
4. If any activation signal appears, write the fallback file.
5. Retry `brain_store` once after a short pause.
6. If retry succeeds, update fallback frontmatter with:
   - `retry_attempted: true`
   - `chunk_id: <returned id>`
7. If retry fails, update fallback frontmatter with:
   - `retry_attempted: true`
   - `chunk_id:`
8. Continue the session without retry-storming.

One retry per call site is the maximum. More retries make DB contention worse.

## Reporting Contract

Use honest status language:

- `Stored in BrainLayer: <chunk_id>` when a concrete chunk id exists.
- `Queued to docs.local/decisions/<file> pending BrainLayer recovery` when the
  fallback file exists but no chunk id exists.
- `BrainLayer store failed and fallback write failed` only if both paths failed.

Never say `stored`, `saved to BrainLayer`, or `BrainLayer updated` when only the
fallback file exists.

## Replay

Boot-time replay lives in [workflows/replay.md](workflows/replay.md).

At the start of any session that expects to call `brain_store`, scan
`docs.local/decisions/*.md` for files with:

- `intended_brain_store: true`
- missing or empty `chunk_id`

Replay each pending file through `brain_store`.

On success, update frontmatter in place with the returned `chunk_id`. Leave the
file where it is. Do not delete it. Do not auto-move it to `_resolved/`.

There is no replay cap for now because the expected queue is small. If a boot
scan finds more than 100 pending files, stop and add a replay budget before
processing them.

## Hook

The frontmatter `hooks:` block is forward-compatible with per-skill hook
support. It covers hard transport/database failures, null chunk ids, common
queue text, `TOOL_RETURNED_TEXT=no`, and slow calls when the runtime exposes
elapsed time. If the runtime does not invoke it automatically, or does not expose
one of those result fields, apply the manual workflow above after every
`brain_store` call.

## Anti-Patterns

### Silent Skip

If `brain_store` returns a queue ack, null chunk id, slow response, or transport
error and you do nothing, you are reproducing the severity-10 failure.

### Retry Storm

Do not loop until BrainLayer recovers. One retry, then fallback queue.

### Body Drift

Do not add notes such as `(fallback)` to the body. Replay deduplication depends
on the original content remaining byte-for-byte identical.

### Missing Metadata

Do not omit `importance`, `tags`, or `timestamp`. Replay without these loses the
search value of the original store.

### False Ack

The fallback file is not proof BrainLayer has the content. Report the fallback
path, not a fake store success.

## Composition

- `/never-fabricate` enforces the status language: fallback files are real, but
  they are not BrainLayer storage.
- `/frustration-capture` can write the user's verbatim feedback into this
  fallback path when BrainLayer is unavailable.
- `/session-handoff` should list pending fallback entries so the next session can
  replay them.
- `/orc` can remind workers to invoke this skill when BrainLayer write cadence
  drops under load.

## Evals

| # | Scenario | Baseline | Target | Assertion |
|---|---|---|---|---|
| 1 | `brain_store` returns `chunk_id: null` | Agent reports `stored` | Agent reports queued fallback path | File exists |
| 2 | MCP returns `Transport closed` | Content is lost | Fallback file is written and cited | File exists and output mentions path |
| 3 | DB busy at >50 percent via mock | Multiple stores are lost | Each distinct content has one fallback file | Same content maps to same file |
| 4 | Successful store | Agent reports stored | Agent reports stored and writes no fallback | Zero fallback files |
| 5 | Boot replay with 3 pending files | Files accumulate | Successful files get `chunk_id`; failed files stay pending | Frontmatter reflects retry state |

Fixtures live in `evals/fixtures/`.

## Done Criteria

- `docs.local/decisions/` is the fallback queue path.
- Fallback files preserve content, importance, tags, and timestamp.
- Replay scans pending files and updates frontmatter in place.
- Hook metadata documents the automatic trigger for future runtime support.
- User-facing output never claims BrainLayer storage without a real `chunk_id`.
- Idempotency maps the same content and timestamp to the same filename.
