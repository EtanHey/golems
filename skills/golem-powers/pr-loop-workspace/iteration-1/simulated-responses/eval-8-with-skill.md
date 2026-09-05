# Eval 8: Daemon PR — Simulated With-Skill Response

## Prompt
> I fixed the BrainBar MCP framing bug. All 37 Swift tests pass and socat returns a valid response. Let's create the PR and merge.

## Simulated Response (with /pr-loop skill loaded)

Good that tests pass, but I need to pump the brakes here. This is a daemon/socket/MCP change, which triggers the **Daemon Verification Gate** before we can proceed to PR creation.

### Why socat isn't enough

The fixture mentions that PRs #87 and #88 on this exact bug passed socat tests but failed with real Claude Code sessions. socat sends a single JSON-RPC request over a short-lived connection. Claude Code maintains a persistent MCP connection with multi-message sessions — the framing mismatch only manifests under those conditions.

Unit tests and socat test the framing logic in isolation. They don't test:
- Persistent connection lifecycle (MCP client stays connected across many tool calls)
- Newline-delimited JSON-RPC framing as actually sent by Claude Code
- Tool discovery (`tools/list`) followed by actual tool invocation in the same session
- Compaction/reconnection behavior

### Daemon Verification Gate — required before PR

```bash
# 1. Open a NEW cmux pane
cmux new-split right  # → surface:N

# 2. Launch a fresh Claude Code session in that pane
cmux send --surface surface:N "source ~/.zshrc && cd ~/Gits/brainlayer && claude -s"
cmux send-key --surface surface:N return

# 3. Wait for Claude to boot (~8s), then test MCP tools
cmux send --surface surface:N "Run brain_search('test query') and tell me what you get"
cmux send-key --surface surface:N return

# 4. Wait ~15s, then read the screen
cmux read-screen --surface surface:N --lines 30

# 5. Verify: MCP tools are available AND return real results
#    - brain_search should return actual chunks, not an error
#    - If "tool not available" or connection error → NOT DONE
```

Only after this verification passes do we proceed with the PR loop:

**Step 4 (VERIFY):** Daemon gate satisfied — real Claude session connects through BrainBar
**Step 5 (COMMIT):** `git add` the 3 changed files, commit with Co-Authored-By
**Step 6 (PUSH):** `git push -u origin fix/brainbar-framing-mismatch`
**Step 7 (PR):** `gh pr create` with summary noting both unit tests AND live client verification
**Step 8 (REVIEW):** Invoke `@coderabbitai review`, wait for feedback
**Step 9 (FIX):** Address any review issues
**Step 10 (MERGE):** `gh pr merge --squash --delete-branch`
**Step 11 (CLEANUP):** `git checkout main && git pull`

Let me start with the daemon verification. Opening a cmux pane now.
