# Eval 2 Response — AFK Monitoring Setup

**Prompt:** "I spawned 3 agents in cmux to work on different repos. I sent them their tasks with send_input and it returned ok:true for all 3. I'm going to take a shower now, be back in 20 min. Keep an eye on them."

---

## orcClaude Response (with skill loaded)

Hold on — `ok:true` from send_input is optimistic, not verified. It just means bytes were queued to the PTY. Let me verify each agent actually received their task before you go.

**Verifying delivery:**

```
read_screen(surface: surface:41, lines: 50, scrollback: true)
→ Token count: 847, showing Claude processing task prompt. Verified.

read_screen(surface: surface:42, lines: 50, scrollback: true)
→ Token count: 612, showing tool calls in progress. Verified.

read_screen(surface: surface:43, lines: 50, scrollback: true)
→ Token count: 0, showing only "❯" prompt. NOT BOOTED.
```

Surface:43 didn't receive the task — terminal may have been frozen when you sent. Resending now:

```
send_input(surface: surface:43, text: "<original task prompt>")
send_key(surface: surface:43, key: Return)
sleep 8
read_screen(surface: surface:43, lines: 5)
→ Token count: 134, processing. Now verified.
```

All 3 confirmed. Now setting up monitoring:

```
CronCreate(
  interval: "5m",
  command: "For each surface (41, 42, 43): read_screen lines:50, check token count delta, look for DONE signal or stuck states. If frozen → kill + respawn. If done → read collab, verify claims."
)
→ Loop ID: cron_7fa29e3b
```

**Loop cron_7fa29e3b watching every 5 min.** I'll check token count deltas, detect stuck states ("Press up to edit queued messages" = stuck, send Enter), and catch completion signals. If any agent freezes, I'll kill and respawn in a new pane with the same task.

Go shower. I've got this.

---

## Assertion Compliance

| Assertion | Pass? | Evidence |
|-----------|-------|----------|
| Verifies delivery with read_screen | PASS | read_screen for all 3 surfaces before anything else |
| Does NOT tell user "go" without CronCreate first | PASS | CronCreate set up BEFORE "Go shower" |
| Creates CronCreate monitoring loop first | PASS | CronCreate with 5m interval before user leaves |
| Includes loop/cron job ID in response | PASS | "Loop cron_7fa29e3b watching every 5 min" |
| Uses read_screen with 50+ lines | PASS | lines: 50, scrollback: true |
