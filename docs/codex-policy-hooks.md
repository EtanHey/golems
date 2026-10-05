# Codex policy hooks: 0.160.0 research and deployment contract

Status: source research complete; installed enforcement requires fresh-seat proof.

## Decision

Use native `PreToolUse` command hooks. They see the complete shell command before
execution and can return a model-visible denial. Keep the existing tmp-block and
git-guardian policies and shared parser; adapt only transport and file envelopes.
Register from the same pinned hooks-live manifest used for Claude.

Pinned source: OpenAI Codex tag `rust-v0.160.0`, commit
`a956835d020762cb2b570053af06f643a11c0ecc`. The installed CLI reports 0.160.0.

## Source evidence

Paths and line numbers below refer to that tag, not the current default branch.

- [hooks/src/events/pre_tool_use.rs:169–190](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/hooks/src/events/pre_tool_use.rs#L169-L190)
  serializes canonical `tool_name`, full `tool_input`, `cwd`, and tool-use ID.
- [core/src/tools/registry.rs:603–630](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/tools/registry.rs#L603-L630)
  runs the hook before the handler and returns the blocking message to the model.
- [hooks/src/events/pre_tool_use.rs:193–293](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/hooks/src/events/pre_tool_use.rs#L193-L293)
  accepts JSON decisions on exit **0**. Exit **2** blocks only with nonempty
  **stderr**; stdout JSON on exit 2 is ignored. Other exit codes, invalid JSON,
  and runtime errors mark the hook failed without setting `should_block`.
- [core/src/tools/handlers/unified_exec/exec_command.rs:520](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L520)
  exposes unified exec as Bash. [apply_patch.rs:415](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/tools/handlers/apply_patch.rs#L415)
  exposes patch text with Edit/Write matcher aliases.
- [core/src/tools/handlers/unified_exec/write_stdin.rs:129](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L129)
  supplies no new pre-tool-use payload for an existing shell session.

The [official hooks documentation](https://learn.chatgpt.com/docs/hooks) describes
`hooks.json` and inline `[hooks]`, Bash/apply_patch payloads, supported deny JSON,
trust review, and the limits of tool coverage. Its current content is not a
version pin; the implementation evidence above establishes the 0.160 contract.

## Alternatives

| Surface | Full command + pre-execution denial | Tradeoff |
| --- | --- | --- |
| Native PreToolUse | Yes | Reuses policy; requires trust and valid output |
| notify | No | After-turn notification, unsuitable for this gate |
| exec-policy `.rules` | Prefix decisions | Starlark argv prefix rules cannot run the shared Python policy |
| Sandbox / permissions | Filesystem boundary | Temp exclusions protect writes but do not classify force pushes |
| Ordinary MCP tool | Only calls to that tool | Does not intercept native shell execution |
| Wrapper shell | Commands routed through that shell | Another execution route can bypass it |

Exec-policy source: [core/src/exec_policy.rs:395](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/exec_policy.rs#L395).
Sandbox temp exclusions: [core/src/config/permissions.rs:84](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/config/permissions.rs#L84).
Notification runs after the agent: [core/src/hook_runtime.rs:609](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/hook_runtime.rs#L609).

## Required proof and limits

The adapter must normalize deliberate Claude denials into exit-0 Codex deny
JSON. Missing gates, exceptions, malformed output, and child timeouts must yield
a static denial with a repair hint. A shell fallback must emit stderr + exit 2
if the adapter or interpreter cannot start. It must not use the fail-open path.

Untrusted or disabled hooks are skipped. Installation alone is not enforcement:
the owner must review the exact definitions through `/hooks`, or use the explicit
one-invocation trust bypass after vetting them. The installer must never forge
trust hashes or silently turn disabled hooks back on.

Codex itself still fails open if the outer hook process times out or cannot be
launched. Persistent interactive shells (`write_stdin`), hosted tools, and MCPs
with their own execution facilities remain outside these two matchers. Native
hooks are guardrails, not a complete security boundary. A sandbox adds filesystem
coverage but changes the fleet's permission behavior and is a separate decision.

The existing git-guardian `CLAUDE_WORKER` exemption is retained for policy parity.
Codex dispatch does not set it, but an inherited value would exempt the same
commands as on Claude. Removing that exemption is a separate policy change.

Scratch-home runtime tests must distinguish policy denial from sandbox failure,
and must prove permitted commands still execute. A deterministic local Responses
fixture can exercise the real CLI without provider charges; it is runtime proof,
not a live-model or installed-fleet claim. The lead owns installation and the
fresh authenticated seat proof after review and merge.
