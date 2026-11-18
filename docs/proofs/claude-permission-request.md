# Unattended Claude worker: PermissionRequest proof

Date: 2026-11-18. Machine: Apple M1 Pro. Claude Code 2.1.327.
Agent SDK `@anthropic-ai/claude-agent-sdk` 0.3.321, the version bundled in the
T3 Code Nightly app. Live model: claude-haiku-5-5. Total spend under $0.01.

## Harness

A scratch Node script drove one turn through the SDK `query()` with the options
T3 uses for a full-access Claude thread:

- `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true`;
- a `canUseTool` callback that records each call and its abort signal, and
  answers deny. Given a delay, it simulates a card waiting for a person (20 s);
- `pathToClaudeCodeExecutable` set to the installed Claude Code binary;
- `settingSources: []`. The hook was registered only through the SDK `settings`
  option (flag layer). The user's settings file was not read or modified.

The hook command was the branch's hook through the branch's fail-open launcher,
exactly as the installer registers it.

The prompt asked for one Bash call:

```sh
LINES=(${(f)"$(printf "a\nb\n")"}); echo count=${#LINES} > probe.txt
```

This shape raised a real approval card on a delegated Claude child in T3. A
quoted heredoc containing `$(` did **not** prompt under `bypassPermissions`.

## Result

| Case | Hook | `T3CODE_THREAD_ID` | Callback | Callback called | Model received |
|---|---|---|---|---|---|
| RED | not registered | delegated-shaped | instant | yes | callback's deny |
| GREEN | registered | delegated-shaped | 20 s | yes, **aborted after 160 ms / 132 ms / 155 ms** (3 runs) | **hook's deny message** |
| Control, no id | registered | unset | 20 s | yes, answered after 20 s, not aborted | callback's deny |
| Control, lead | registered | a top-level thread with no parent | 20 s | yes, answered after 20 s, not aborted | callback's deny |

A recording wrapper captured the hook's input (`hook_event_name:
"PermissionRequest"`, `permission_mode: "bypassPermissions"`, `tool_name:
"Bash"`, the exact command) and its output, the deny JSON.

With an instant callback the callback wins the race. That case doesn't happen
in T3, whose callback waits for a person.

## What this shows

- Claude Code runs the PermissionRequest hook **concurrently** with the SDK
  `canUseTool` callback, not before it, and the first answer wins.
- For a worker, the hook's deny reaches the model in well under 2 s and the
  SDK aborts the callback. The worker continues and never waits for a person.
- For a lead or a session with no thread id, the hook stays silent and the
  callback keeps the decision, as before.
- `denyInsteadOfPrompting: true` in the SDK flag settings did not stop the
  callback on this path: it was still called and waited the full 20 s.

## What T3 does with the short-lived request

Read from the bundled T3 Code Nightly app (`app.asar`), 18 Nov 2026.

**The card is created before the wait and withdrawn on abort**
(`ClaudeAdapterV2.canUseTool`):

```js
yield* all([ emitProviderEvent({ type: "node.updated", ... }),
             emitProviderEvent({ type: "runtime_request.updated", ... }),
             emitProviderEvent({ type: "turn_item.updated", ... }) ], { concurrency: 1 });
const resolvedDecision = yield* awaitClaudeApprovalDecision(decision, callbackOptions.signal)...;
if (!(yield* isDone(decision))) yield* cancelWithdrawnRequest(artifacts);
```

**Desktop/web client: alerts on a new approval fire at once.** The notification
gate delays only completions (`Hee=5e3`, 5 s). A new attention state with a
request id calls the notifier immediately:

```js
let p=s(o,c,l);if(!c||u.archived)return;if(p){e(o,`input`);return}
```

The notifier then, by the user's notification mode:

```js
if(Mk(f)&&Hk(s,...)  // mode "sound" | "notifications-and-sound": plays the alert sound
...X.add({type:`warning`,title:g /* "Approval needed" */,...})  // in-app toast, if focused on another thread
...new Notification(g,{body:l.title,tag:...,silent:!0})          // OS notification (silent), if unfocused
i(n,l.id,e) → Ik(n.size)                                            // badge count
```

**Mobile relay: an approval state is published at once.** In the agent
awareness relay, only a `null` or `completed` state is held for a 5 s
confirmation. `waiting_for_approval` ("Approval needed") goes straight to
`publishAgentActivity`, and a device's `notifyOnApproval` preference governs
the push.

```js
if (thread.pendingRuntimeRequest !== null && thread.pendingRuntimeRequest.kind !== "auth_refresh") return "waiting_for_approval";
...
if (snapshot.state === null || snapshot.state?.phase === "completed") { ... publishConfirmDeadlines.set(threadId, nowMs + 5e3); ... }
... yield* publishState({ projectId: snapshot.projectId, state, reason: snapshot.reason })
```

**Answer:** if the ~150 ms request reaches the client, T3 has no deliberate
delay that would suppress it. Depending on the owner's notification mode, it
can play the approval sound, show a toast or a silent OS notification, raise
the badge, and publish "Approval needed" to linked phones. T3's live stream
coalesces thread updates (`bufferShellLiveStream`), so a request that is
withdrawn within one buffer window may never reach a client. That timing was not
measured here. Removing the alert fully needs T3 to skip the card for worker
threads. That is an upstream change and was not made here.

## Not proven here

- The installed hook in a real T3 child (this is the SDK path T3 uses, driven
  by a harness, not the app).
- Whether the owner's devices actually alerted during a ~150 ms request.
