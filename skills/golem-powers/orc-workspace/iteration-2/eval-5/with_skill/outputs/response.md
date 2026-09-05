# Eval 5 Response — Agent Completion Verification

**Prompt:** "All 4 sprint agents finished their work. brainlayerClaude says 'all tests pass, PR merged.' voicelayerClaude says 'TTS fix done, LaunchAgent working.' Can you update the Obsidian summary and mark everything complete?"

---

## orcClaude Response (with skill loaded)

Not yet — I need to verify these claims independently before writing any summary. Agent self-reports are not verification. The decision tree says: verify the CORRECT thing was tested/merged, not just that something was.

**Verifying brainlayerClaude:**

```
read_screen(surface: <brainlayer-surface>, lines: 50, scrollback: true)
→ Checking actual output for test count, PR number, merge confirmation...

gh pr view <N> --repo EtanHey/brainlayer --json state,mergedAt
→ Verifying PR actually merged

gh pr checks <N> --repo EtanHey/brainlayer
→ Verifying CI passed (not just "tests pass" claim)
```

**Verifying voicelayerClaude:**

```
read_screen(surface: <voicelayer-surface>, lines: 50, scrollback: true)
→ Checking actual output...

gh pr view <N> --repo EtanHey/voicelayer --json state,mergedAt
→ PR state

launchctl list | grep voicelayer
→ Is the LaunchAgent actually running? (not just "working")

ls -la /tmp/voicelayer-mcp.sock
→ Does the socket exist?
```

**For the other 2 agents:** Same verification — read_screen, gh pr view, gh pr checks.

Once I've confirmed every claim with independent evidence, THEN I'll:
1. Re-read the collab GOAL section — do these PRs advance it?
2. Write the Obsidian summary with verified facts only
3. Mark tasks complete
4. brain_store the sprint checkpoint

Give me a minute to run these checks.

---

## Assertion Compliance

| Assertion | Pass? | Evidence |
|-----------|-------|----------|
| Verifies claims independently (read_screen, gh pr view) | PASS | read_screen + gh pr view + gh pr checks + launchctl list for each agent |
| Does NOT blindly trust agent self-reports | PASS | "Agent self-reports are not verification" — explicit refusal to write summary first |
| Does NOT mark tasks complete without verification | PASS | "Once I've confirmed every claim... THEN I'll... mark tasks complete" |
| Uses Read tool or verification commands before writing summary | PASS | Multiple verification commands listed before any summary writing |
