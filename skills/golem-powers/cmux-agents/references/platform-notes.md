Read this for the macOS and launchd mechanics inherited from mac-systems, or when investigating the deferred cmux rename-hook design.

## Mechanical Environment Truths (hard-won — gen-12 weave E14)

> Retired `/mac-systems` (0 skill loads ever) landed its nine truths here on 2026-09-05; the
> rest of that skill's macOS reference lives in git history. See golems PR #15 for the last
> work on it.

One-liners every worker and launchd plist author must internalize:

1. **Tailnet IP bind ban** — NEVER hardcode tailnet IPs in launchd plists or worker-prompt URLs. Bind `127.0.0.1` / loopback or resolve at start. Three live catches: Phoenix phantom listener (two eras), W10 dead `:8852` URL.
2. **Codex detached-child reap** — Codex `exec` reaps detached children (`&` / `nohup` die). **`launchctl submit`** is the surviving detach path; clean up leftover runners after.
3. **pipefail + early-exit consumer** — Under `set -o pipefail`, piping into an early-exit consumer (`awk '{exit}'`) SIGPIPE-kills the producer (exit 141). Buffer first, then consume. See `/shell-hardening`.
4. **zsh read-only specials** — Never use zsh read-only specials (`status`, etc.) as variable names.
5. **nvm FUNCNEST in profiles** — `voicelayer-profile` `node` hits nvm `_lazy_nvm` FUNCNEST recursion — use **bun** for profile scripts.
6. **CloudStorage read bounds** — Bound any read of `~/Library/CloudStorage` — cloud-only placeholders hang naive `tar`/`read`.
7. **Host-identity check first** — Machine-named tasks: verify **current-host vs target-host** identity BEFORE acting ("What you're on is the M4 Max. I was asking about the M1 Pro.").
8. **Computer-use fallback ladder** — When CU fails on a UI element: element click → coords → `osascript` System Events AX → keystroke.
9. **footprint, not RSS, for leak watches** — RSS is a liar under the macOS memory compressor: a leak sampler showed RSS bouncing 444–760MB while footprint sat at 5.1G. Leak watches and escalation thresholds MUST read phys_footprint (`/usr/bin/footprint <PID>`), never `ps -o rss`. Recipe below.

Two mechanical recipes the truths depend on.

**Footprint-based leak watch (truth #9).** `/usr/bin/footprint` summary line is
`name [pid]: 64-bit    Footprint: NNNN KB`. Observed divergence (2026-06-07 cmux leak watch):
RSS bounced 444–760MB while footprint sat at **5.1G** — an RSS-based watch nearly suppressed the
escalation. Threshold on footprint bytes, never `ps -o rss`:

```bash
PID=12345; LIMIT_BYTES=$((4 * 1024 * 1024 * 1024))   # escalate at 4 GiB
while kill -0 "$PID" 2>/dev/null; do
  fp_bytes=$(/usr/bin/footprint --format bytes "$PID" 2>/dev/null \
    | sed -n 's/.*Footprint: \([0-9]*\) B.*/\1/p')
  if [ -n "$fp_bytes" ] && [ "$fp_bytes" -ge "$LIMIT_BYTES" ]; then
    echo "LEAK: phys_footprint=${fp_bytes}B >= ${LIMIT_BYTES}B" >&2
    # escalate here
  fi
  sleep 60
done
```

**Bun environment loading under launchd (pairs with truth #1).** launchd starts jobs from `/`,
not the package directory. A Bun entry point that depends on a repository environment loader
must make it its first import (adjust the relative path as needed):

```typescript
import "../lib/load-env";
```

Also: in scripted zsh, ALWAYS invoke `/usr/bin/log` absolutely — zsh has a `log` builtin that
shadows it and exits 0 with no output, silently fabricating "no log entries" conclusions.

## Known Issues — cmux rename hooks (design proposal, do NOT edit without orcClaude review)

**Background (2026-04-11):** the cmux tab-rename auto-hook (launcher name → display name + color) has 5 observed bugs. Code changes are OUT OF SCOPE for skill-creator — this section is a design proposal for the next orcClaude session to dispatch.

| # | Bug | Symptom | Proposed fix |
|---|---|---|---|
| 5.1 | **Flat tab colors** | All tabs use the same (or default) color; agent type not visually distinguishable | Map launcher function → color in a dict (claude=blue, codex=orange, cursor=purple, gemini=green, kiro=red). Set on spawn. **Blocked on a tool affordance since v0.4.35:** `rename_tab(color=...)` was cut and `update_surface` takes only `action`/`surface`/`title` — there is no color parameter to call, so this fix needs the color channel added first. |
| 5.2 | **Red-to-cyan weirdness** | Some tabs flip from red (error/warning) to cyan unexpectedly; color state machine has a bad transition | Debug: instrument the rename hook to log every color-set call with timestamp + reason. Most likely cause: one code path sets color from agent state, another sets it from default, last write wins. |
| 5.3 | **Nested naming collapses** | Tab names for agents spawned in worktrees or nested panes lose their parent context (e.g. "golemsClaude > feat-X" → "claude") | When generating the display name, walk the surface parent chain and prepend up to 1 level of context. Truncate via ellipsis if longer than the tab width budget. |
| 5.4 | **Weak semantic tag extraction** | Tab names don't reflect what the agent is actually WORKING on (they just say "claude" instead of e.g. "claude: PR#232 fix") | Parse the task prompt on spawn — extract PR numbers (`PR#\d+`), issue refs (`#\d+`), and the first 3-5 imperative words. Fall back to launcher name if none found. |
| 5.5 | **Launcher-to-display-name mapping missing** | Tab shows raw function name (`golemsClaude -s`) instead of a friendly display (`golems • Claude`) | Add a `LAUNCHER_DISPLAY` lookup table keyed on the base launcher pattern (`{repo}Claude` → `{repo} • Claude`, `{repo}Cursor` → `{repo} • Cursor`, etc.). Regex extract `repo` + `agent`. |

**Where the hook lives:** NOT located as of 2026-04-11 by skillCreatorBuddy. Not in `~/.claude/hooks/`, not in `$HOME/Gits/golems/hooks`, not in `~/.config/cmux/settings.json`. Likely candidates to check next session:
- Swift cmux client source (may be built-in tab rename behavior, not a Python hook)
- `$HOME/Gits/cmuxlayer/src/**/rename*`
- A LaunchAgent plist that watches cmux sockets
- Part of the `spawn_agent` implementation / agent-registry wiring in cmuxlayer

**Next action (for orcClaude, NOT for skill-creator):**
1. Locate the actual rename hook source
2. Reproduce each bug in a safe surface
3. Fix behind a feature flag
4. A/B test against the current hook
5. Ship via /pr-loop

**Until then:** manually rename after spawn with `mcp__cmuxlayer__update_surface({action:"rename", surface, title})`, using the display-name conventions in the table above. **Color and status cannot be set at all:** `rename_tab(color=…)`, `set_status` and `set_progress` were cut in v0.4.35 and `update_surface` does `move` and `rename` only — there is no replacement to call.
