# T3 advisor routing proof

Status: draft implementation; native capture, Mac rows, review and installation pending.

The identity source was inspected in T3's ClaudeAdapterV2: queryOptions.env
sets PortScanner.AGENT_THREAD_ENV to input.threadId, SDK options carry the
thread cwd, and the SDK hook shape includes cwd, session_id, transcript_path
and hook_event_name. PortScanner defines that environment key as
T3CODE_THREAD_ID. No payload contents or environment values were captured.
The fixtures replay these source-derived keys with synthetic values through
the real Node hook executable; this is not a captured native PreToolUse event
or a successful live Fable dispatch.

Base: f25ed72f9a504e30f275607d64b65c6807fd5468 (origin/master).

| Synthetic shape / assertion | Base hook | Changed hook |
|---|---|---|
| T3 apex-root lead, Fable Agent, subagent refusal and delegate_task guidance | FAIL: unknown-seat code, old guidance | PASS |
| Same lead, nested target.model on T3 delegate_task | PASS: tool ignored | PASS: recognized lead and tool |
| Worktree child, nested Fable delegate target | FAIL: allowed | PASS: refused |
| Unknown non-T3 caller, nested Fable delegate target | FAIL: allowed | PASS: refused |

The lead-delegate allowance alone was already green on base because the tool
was ignored; the worker/unknown negative controls catch that bypass. Additional
unit cases reject forged apex seat fields, a Fable worker transcript, mismatched
actual cwd, delegated-prefix ids even at root, and non-apex roots. Both MCP
spellings and both host manifest matchers are checked.

Deterministic eval: 62/62. Node hook suite: 32/33; unchanged 50 ms startup
budget fails on both base (76.57 ms) and branch (73.54 ms). No threshold was
weakened. Node 22 from the install snippet is absent on this host. An alternate
Node 24 probe cannot start due to its missing simdjson library. These are adverse
receipts, not passing installed proof. Broad installer/release suite was
interrupted after repeated 30-second timeouts; complete suite remains unverified.
Instruction-behavior eval: unmeasured; no paid agent comparison was run.

Identity limitation: exact canonical apex roots plus actual process cwd prevent
a tool_input seat claim from granting privilege. They do not authenticate the
thread. A same-user shell worker can change cwd/environment, and an unprefixed
child launched directly at an apex root cannot be distinguished. Owner intent
is a routing contract, not a parsed task-text permission. Non-T3 legacy apex
claims retain their previous trust model. No live installation was performed.

## Fix round 1

Eight new negative fixtures were allowed by base f25ed72f and rejected after
this round: missing target, empty target, Claude instance without a model,
eval instance without a model, unknown instance without a model, alias model
field, missing T3 identity with a seat claim, and missing identity with a
Fable transcript. The prior PR head also failed all eight new assertions.
Only the wire's target.model is accepted as a delegate pin. Unknown instance
aliases require a model because this offline hook has no provider catalog.
Explicit other-provider and cheaper-model controls remain allowed.

Current deterministic result: 72/72, 287 assertions. Node hook replay: 40/41;
the unchanged 50 ms case took 76.99 ms. Earlier adverse receipts above remain.
The old unpinned-Agent action now names the separate-thread route. Cut-tool
reference check passes after removing the retired tool name from the overview.

Real nested CLI probe: parent entrypoint was explicitly set to t3-code to
reproduce the inherited lead environment. The first Bash-tool probe was denied
by the unattended-worker permission hook, so it yielded no variable value.
A per-invocation scratch SessionStart hook on a real nested claude -p process
then read only CLAUDE_CODE_ENTRYPOINT and returned t3-code. The value survives
nesting; it cannot distinguish that child from the T3 parent. No live settings
were edited. An inherited lead id/cwd can still grant that nested process
cmux seat privilege; this same-user policy limitation is explicit in SKILL.md.

Managed diff scan attempted once with targetPath set to this PR worktree,
scope '.', and base f25ed72f. Refusal (no scanId):
"Review changes requires a non-bare Git worktree with a resolvable HEAD."
No replacement scan or wider target was attempted; no new managed CLEAN claim.
