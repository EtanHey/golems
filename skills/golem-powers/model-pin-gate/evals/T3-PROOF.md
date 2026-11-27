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
