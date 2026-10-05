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
  exposes unified exec as Bash with only `command`, omitting the per-call
  `workdir`. Hook `cwd` is the session cwd, not necessarily execution cwd.
  [apply_patch.rs:415](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/tools/handlers/apply_patch.rs#L415)
  exposes patch text with Edit/Write matcher aliases.
- [apply-patch/src/streaming_parser.rs:176](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/apply-patch/src/streaming_parser.rs#L176)
  trims header lines; the shared parser therefore accepts indented headers,
  including Unicode whitespace. tmp-block still permits deletes; git-guardian
  projects Delete headers onto its existing sensitive-file Write policy.
- [core/src/tools/handlers/unified_exec/write_stdin.rs:129](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L129)
  supplies no new pre-tool-use payload for an existing shell session.
- [arg0/src/lib.rs:393–402](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/arg0/src/lib.rs#L393-L402)
  installs `apply_patch` and `applypatch` as PATH executables. Their
  [standalone entry point](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/apply-patch/src/standalone_executable.rs#L16-L41)
  reads a patch argument or stdin, beyond the literal heredoc interceptor.

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
JSON. Missing gates, runtime failures and malformed output must yield
a static denial with a repair hint. Unsupported direct shell-patch forms receive
a specific instruction to use native `apply_patch`; timeouts retain the split
hint. A shell fallback must emit stderr + exit 2
if the adapter or interpreter cannot start. It must not use the fail-open path.
The adapter deduplicates patch targets and has a seven-second total budget
inside the ten-second native timeout. Large/timed-out requests receive a static
split-patch hint rather than a misleading reinstall instruction.

Untrusted or disabled hooks are skipped. Installation alone is not enforcement:
the owner must review the exact definitions through `/hooks` from **plain
`codex` with no `--profile`**, or use the explicit
one-invocation trust bypass after vetting them. The installer must never forge
trust hashes or silently turn disabled hooks back on.

Plain Codex persists trust in the base `$CODEX_HOME/config.toml` (default
`~/.codex/config.toml`). A repoGolem seat uses a per-launch `--profile` file and
deletes it on exit (`scripts/repogolem/dispatch/codex.zsh:178,339,401`); trusting
there evaporates on the next launch. Pinned Codex
[cli/src/main.rs:1934](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/cli/src/main.rs#L1934)
selects the profile user-config path, and
[tui/src/hooks_rpc.rs:58](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/tui/src/hooks_rpc.rs#L58)
routes trust writes to that user config. Trust keys contain event/group/handler
indices ([hooks/src/lib.rs:113](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/hooks/src/lib.rs#L113));
reordering hooks requires another native trust review.

`--status` distinguishes registration from base-config trust: `missing`,
`disabled`, or `present-unverified`. A stored hash is not proof it still matches
the current definition: verify through native `/hooks`. Missing/disabled trust
returns nonzero. Status reads only base config; profile/CLI overrides such as
`--disable hooks` or `-c features.hooks=false` can change runtime behavior.
`allow_managed_hooks_only` belongs to managed requirements, not config.toml
([config/src/config_requirements.rs:182](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/config/src/config_requirements.rs#L182));
the installer does not inspect those requirements or assert effective runtime
enablement. Installation honors `CODEX_HOME` and preserves its base config.

Codex itself still fails open if the outer hook process times out or cannot be
launched. Persistent interactive shells (`write_stdin`), hosted tools, and MCPs
with their own execution facilities remain outside these two matchers. Native
hooks are guardrails, not a complete security boundary. A sandbox adds filesystem
coverage but changes the fleet's permission behavior and is a separate decision.

Two holes were independently reproduced with the real 0.160 binary: a relative
write with per-call `workdir` in a temp-class directory is allowed because the
hook sees the ordinary session cwd; a permitted `sh` session followed by
`write_stdin` containing `git push -f` executes without another hook call. This
adapter cannot recover omitted workdir or intercept a tool with no hook payload.
Absolute temp paths are checked. Direct, command-position `apply_patch`/`applypatch`
invocations with supported literal inline envelopes are evaluated through both
existing patch policies, including relative headers after a literal leading
`cd <dir> &&`. Unsupported forms of those recognized direct invocations are
refused with a native-tool hint. Names and markers in docs, quoted arguments or
heredoc data do not trigger extraction; ordinary commands keep their existing
policy decisions. This is lexical coverage, not a blanket denial of opaque or
encoded producers.
Repeated boundary-marker text within a direct shell patch, including literal
patch content, is conservatively refused; use the native patch tool for it.
Parser desync remains a lexical coverage limit; recognizable assignment-prefixed
heredoc heads that lose their command position are refused with the native-tool hint.
Bare command-position patch invocations without a patch marker are also refused.
This does not recover the omitted per-call `workdir`. No broad relative-write or
interactive-shell ban is added to the shared policy; filesystem sandboxing and
upstream hook coverage changes need separate decisions.

**Known coverage hole: indirect shell patch execution.** The PATH executables
accept arguments or stdin. Indirect invocations without a command-position name
visible to the shared parser are not projected into patch policy; the existing
Bash gates evaluate only their shell payload. This was already unchecked at
the parent PR and is not closed here. A sandbox or PATH-level control requires a
separate decision. Fresh-seat proof must state this hole alongside omitted
workdir, unhooked `write_stdin`, trust/enablement skips and native outer hook
failure; persist trust from plain Codex, then verify another launch.

The existing git-guardian `CLAUDE_WORKER` exemption is retained for policy parity.
Codex dispatch does not set it, but an inherited value would exempt the same
commands as on Claude. Removing that exemption is a separate policy change.

Scratch-home runtime tests must distinguish policy denial from sandbox failure,
and must prove permitted commands still execute. A deterministic local Responses
fixture can exercise the real CLI without provider charges; it is runtime proof,
not a live-model or installed-fleet claim. The lead owns installation and the
fresh authenticated seat proof after review and merge.
