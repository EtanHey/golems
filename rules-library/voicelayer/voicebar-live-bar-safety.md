---
paths:
  - "flow-bar/**"
  - "scripts/**"
---

# VoiceBar Live-Bar Safety

> Path-scoped rule for any script/agent touching VoiceBar runtime, `/Applications/VoiceBar.app`, or `/tmp/voicelayer*`. Born: the 2026-06-11 v9 incident — a runaway worker re-deployed a rejected build over the lead's restore, on Etan's live bar. Promoted from voicelayer `docs.local/design/v9-incident-rules-drafts.md` via the skills-ctx rules-promotion path (PLAN §9).

---

- **NEVER kill/restart/replace the resident VoiceBar while Etan may be using it** (R-013 — he defected to Wispr Flow the last time; reconfirmed when a runaway worker re-deployed v9 over the lead's restore).
- **NEVER touch `/tmp/.voicelayer-daemon-disabled`** — the app-child watchdog reads it GLOBALLY; setting it to isolate a dev bar killed Etan's live mic daemon (2026-06-11).
- Dev-instance isolation = **socket-path env override ONLY** (`QA_VOICE_SOCKET_PATH` / `QA_VOICE_MCP_SOCKET_PATH`), never the disable flag, never a second daemon owner.
- Workers build to a **dev instance**; deploying to `/Applications/VoiceBar.app` needs an explicit Etan "go". **Never ship an unverified-on-real-screen build to his live bar.**
- One automation driver on the installed app at a time (`pgrep -f auto-f5|voicelayer-verify` first). QA bundles QUIT after screenshotting — never leave one on Etan's screen.
- After any rebuild: cdhash changes → mic grant drops → `tccutil reset Microphone com.voicelayer.voicebar` + Etan re-Allows on F5. Daemon must be an app-child (PPID=app) for TCC inheritance.
