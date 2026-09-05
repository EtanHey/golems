---
name: ecosystem-health
description: "Health checks for MCP, BrainLayer, skills, friction. Triggers: health check, whats broken, MCP/BL status."
---

# Ecosystem Health Check

Audit the golems ecosystem: MCP servers, BrainLayer, VoiceLayer daemon, JSONL watcher, enrichment, git status, Axiom telemetry, open PRs. Run at session start AND end.

## Why This Exists

The ecosystem has 22 repos, 45+ skills, 5 MCP servers (BrainLayer, VoiceLayer, cmux, exa, supabase), a 7GB semantic memory store, a JSONL watcher, enrichment pipeline, and multiple long-lived Claude sessions. Things break silently — MCP disconnects, daemons crash, watchers die, enrichment stalls, PRs rot. This skill catches those problems before the user notices.

## Quick Check (session start/end)

Run ALL checks. Report results in table format. Stop and flag if any check is RED.

### 1. MCP Connectivity (all 5 servers)

Check each MCP server is connected and responsive:

```
# BrainLayer — must respond with data
brain_recall(mode="stats")
# GREEN if: returns chunk count + entity count
# RED if: timeout, error, "unavailable"

# VoiceLayer — silent ping
voice_speak(message="Health check", mode="think")
# GREEN if: no error (think mode = silent log only)
# RED if: timeout or MCP unavailable

# cmux — check surface listing
mcp__cmuxlayer__list_surfaces()
# GREEN if: returns list (even empty)
# RED if: timeout or MCP unavailable

# exa — verify connection (no query needed, just check tool exists)
# GREEN if: exa tools appear in available tools
# RED if: not listed

# supabase — verify connection
# GREEN if: supabase tools appear in available tools
# RED if: not listed
```

**If any MCP is RED:** Report it immediately. MCP failures cascade — BrainLayer down means no memory, VoiceLayer down means no voice, cmux down means no agent coordination.

### 2. BrainLayer Responsive

Go deeper than connectivity — verify BrainLayer actually returns meaningful data:

```
brain_search("ecosystem health check")
# GREEN if: returns results (any)
# YELLOW if: returns empty (index may need rebuild)
# RED if: timeout or error
```

Also check DB vitals:

```bash
python3 -c "
import sqlite3, os

candidates = [
    '~/.local/share/brainlayer/brainlayer.db',
    '~/.local/share/zikaron/zikaron.db',
]
db = None
for c in candidates:
    p = os.path.expanduser(c)
    if os.path.exists(p) or os.path.exists(p + '-shm'):
        db = p
        break
if not db:
    print('RED: No BrainLayer DB found')
    exit(1)

db_exists = os.path.exists(db)
wal_path = db + '-wal'
wal_size = os.path.getsize(wal_path) if os.path.exists(wal_path) else 0
shm_exists = os.path.exists(db + '-shm')

if not db_exists and shm_exists:
    print(f'WAL-only mode (MCP holds DB in memory)')
    print(f'WAL: {wal_size / 1e6:.0f} MB')
else:
    db_size = os.path.getsize(db)
    conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    chunks = conn.execute('SELECT COUNT(*) FROM chunks').fetchone()[0]
    conn.close()
    print(f'Chunks: {chunks}')
    print(f'DB: {db_size / 1e9:.1f} GB | WAL: {wal_size / 1e6:.0f} MB')
    status = 'RED' if wal_size > 500e6 else 'YELLOW' if wal_size > 100e6 else 'GREEN'
    print(f'WAL status: {status}')
"
```

**Thresholds:**
- WAL > 100MB = YELLOW (checkpoint needed)
- WAL > 500MB = RED (queries will timeout)
- Chunk count dropped vs last check = RED (data loss)

### 3. VoiceLayer Daemon Alive

Check the Voice Bar app + MCP daemon are running:

```bash
# Voice Bar app — persistent macOS server on /tmp/voicelayer.sock
pgrep -x "Voice Bar" || pgrep -x "VoiceBar" || echo "RED: Voice Bar not running"

# VoiceLayer MCP daemon — singleton on /tmp/voicelayer-mcp.sock
pgrep -fl "mcp-server-daemon" || echo "YELLOW: VoiceLayer daemon not running"

# Socket file exists and is a socket
test -S /tmp/voicelayer.sock && echo "Voice Bar socket: OK" || echo "RED: No Voice Bar socket"
test -S /tmp/voicelayer-mcp.sock && echo "MCP daemon socket: OK" || echo "YELLOW: No MCP daemon socket"

# Check daemon log for recent errors
tail -5 /tmp/voicelayer-mcp-daemon.stderr.log 2>/dev/null | grep -i "error\|fatal\|crash" && echo "YELLOW: Recent daemon errors" || echo "Daemon log: clean"
```

**Expected state:**
- Voice Bar running (1 process)
- MCP daemon running (1 process via LaunchAgent)
- Both sockets exist at `/tmp/voicelayer.sock` and `/tmp/voicelayer-mcp.sock`

### 4. JSONL Watcher Running

The BrainLayer JSONL watcher tails `~/.claude/projects/*.jsonl` and (arbitrated mode) enqueues chunks to `~/.brainlayer/queue/` for the drain/BrainBar consumers.

**Check launchd LOADED state first, not just the process.** The 2026-06-06 incident: the watcher was silently dead for 20 hours because the service was *unloaded* during a load-shed (`launchctl bootout`) and never restored — `KeepAlive` cannot revive an unloaded service, and a pgrep-only check tells you it's dead but not *why* or how to fix it.

```bash
# 1. Service LOADED? (unloaded = load-shed casualty; KeepAlive can't help)
launchctl list | grep -q "com.brainlayer.watch" \
  || echo "RED: com.brainlayer.watch UNLOADED — fix: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.brainlayer.watch.plist"

# 2. Process alive? (message is neutral — if step 1 said UNLOADED, that's the cause; fix there first)
pgrep -fl "brainlayer watch" || echo "RED: no watcher process"

# 3. Offsets freshness — the watcher writes ~/.local/share/brainlayer/offsets.json on progress.
#    Stale offsets while Claude sessions are active = watcher wedged or dead.
offsets_age_min=$(( ( $(date +%s) - $(stat -f %m ~/.local/share/brainlayer/offsets.json 2>/dev/null || echo 0) ) / 60 ))
echo "offsets.json age: ${offsets_age_min}min"
# GREEN <15min (with active sessions) | YELLOW 15-60min | RED >60min

# 4. Queue backlog (arbitrated mode) — events piling up = consumers (drain/BrainBar) dark
queue_count=$(find ~/.brainlayer/queue -type f 2>/dev/null | wc -l | tr -d ' ')
echo "queue events: $queue_count"
# GREEN <100 | YELLOW 100-1000 | RED >1000 (also check the sibling services below)

# 5. Sibling services that die in the same load-sheds (same bootstrap fix as #1):
for svc in com.brainlayer.drain com.brainlayer.enrichment; do
  launchctl list | grep -q "$svc" || echo "YELLOW: $svc UNLOADED"
done
```

**Why this matters:** date-windowed write counters (e.g. BrainBar's "Recent writes" gauge) only see *stamped* chunks — a dead watcher reads as "3 writes/hour", not as an alarm. Silence looks like quiet, not failure. After ANY load-shed or reboot, re-run this section and re-bootstrap every unloaded `com.brainlayer.*` service.

### 5. Enrichment Process Alive + Stats

The enrichment pipeline processes raw chunks into entities, relations, and embeddings:

```bash
# Check if enrichment is running
pgrep -fl "brainlayer.*enrich" || pgrep -fl "enrichment" || echo "INFO: No enrichment running (may be idle)"

# Check enrichment stats via BrainLayer
# brain_recall with stats mode includes enrichment info
```

Also check via MCP:
```
brain_recall(mode="stats")
# Look for: enrichment_pending count, last_enrichment timestamp
# GREEN if: pending < 100 and last enrichment < 1 hour ago
# YELLOW if: pending 100-1000 or last enrichment > 6 hours
# RED if: pending > 1000 or last enrichment > 24 hours
```

### 6. Git Status Across Repos

Uncommitted changes = risk of lost work. Check all key repos:

```bash
for repo in golems brainlayer voicelayer orchestrator cmuxlayer; do
  if [ -d ~/Gits/$repo ]; then
    status=$(git -C ~/Gits/$repo status --porcelain 2>/dev/null | head -5)
    branch=$(git -C ~/Gits/$repo branch --show-current 2>/dev/null)
    if [ -z "$status" ]; then
      echo "✓ $repo ($branch): clean"
    else
      count=$(git -C ~/Gits/$repo status --porcelain 2>/dev/null | wc -l | tr -d ' ')
      echo "⚠ $repo ($branch): $count uncommitted files"
    fi
  fi
done
```

**Thresholds:**
- All clean = GREEN
- 1-2 repos dirty = YELLOW (normal during development)
- Repo on non-main branch with dirty state = YELLOW (flag it)
- Repos with uncommitted changes on main = RED (risk of accidental loss)

### 7. Axiom Telemetry Flowing

Check if the watcher is sending heartbeats to Axiom:

```bash
# Check watcher log for recent Axiom sends
grep -c "axiom\|telemetry\|heartbeat" /tmp/brainlayer-watcher.log 2>/dev/null || echo "0"

# Check last heartbeat timestamp
grep -i "heartbeat\|axiom" /tmp/brainlayer-watcher.log 2>/dev/null | tail -1

# If no watcher log, check if Axiom env vars are configured
[ -n "$AXIOM_TOKEN" ] && echo "Axiom token: configured" || echo "YELLOW: AXIOM_TOKEN not set"
[ -n "$AXIOM_DATASET" ] && echo "Axiom dataset: $AXIOM_DATASET" || echo "YELLOW: AXIOM_DATASET not set"
```

**Expected state:**
- Heartbeat within last 15 minutes = GREEN
- Heartbeat > 15 min but < 1 hour = YELLOW
- No heartbeat or no watcher log = RED (telemetry blind)

### 8. Open PRs Across Repos

Stale PRs rot. Check what's open:

```bash
for repo in EtanHey/golems EtanHey/brainlayer EtanHey/voicelayer EtanHey/orchestrator EtanHey/cmuxlayer; do
  prs=$(gh pr list --repo $repo --state open --json number,title,createdAt --jq 'length' 2>/dev/null)
  if [ "$prs" = "0" ] || [ -z "$prs" ]; then
    echo "✓ $repo: no open PRs"
  else
    echo "⚠ $repo: $prs open PR(s)"
    gh pr list --repo $repo --state open --json number,title,createdAt --jq '.[] | "  #\(.number) \(.title) (\(.createdAt | split("T")[0]))"' 2>/dev/null
  fi
done
```

**Thresholds:**
- 0 open PRs = GREEN
- 1-3 open PRs = YELLOW (review and merge or close)
- PR open > 7 days = RED (stale — close or merge)

## Report Format

After running all checks, produce a structured report:

```markdown
# Ecosystem Health Report — YYYY-MM-DD HH:MM

## Overall: GREEN / YELLOW / RED

### Infrastructure
| Check | Status | Value | Notes |
|-------|--------|-------|-------|
| BrainLayer MCP | ✅ | 297K chunks | <1s response |
| VoiceLayer MCP | ✅ | connected | daemon mode |
| cmux MCP | ✅ | connected | N surfaces |
| exa MCP | ✅ | available | — |
| supabase MCP | ✅ | available | — |
| Voice Bar | ✅ | running | socket OK |
| VoiceLayer daemon | ✅ | running | socket OK |
| JSONL watcher | ✅ | running | 0 inbox files |
| Enrichment | ✅ | idle | 0 pending |

### Data
| Check | Status | Value | Notes |
|-------|--------|-------|-------|
| BrainLayer search | ✅ | responsive | results returned |
| WAL size | ✅ | 0 MB | clean |
| Axiom telemetry | ✅ | flowing | last heartbeat 2m ago |

### Development
| Check | Status | Value | Notes |
|-------|--------|-------|-------|
| Git repos clean | ⚠ | 2/5 dirty | golems, orchestrator |
| Open PRs | ✅ | 0 total | — |

### Actions Needed
1. [specific action if any]
```

## Store the Report

After generating, store in BrainLayer:

```
brain_store(
  content: "Ecosystem health YYYY-MM-DD: [overall status]. [summary of findings]. [actions needed]",
  tags: ["health-check", "ecosystem", "maintenance"],
  importance: 6
)
```

## When to Run

- **Session start:** Quick check (all 8 sections) — catch overnight breakage
- **Session end:** Quick check — verify nothing broke during work
- **On demand:** When user asks "is everything working" or "health check"
- **After major changes:** PRs that touch daemons, MCPs, or infrastructure
- **Weekly deep check:** Add friction scan + skill eval sampling (see Deep Check below)

## Deep Check (weekly)

Everything in Quick Check, plus:

### Friction Scan

```bash
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"
python3 "$ORCHESTRATOR_REPO/scripts/friction-scan.py" --threshold 5
```

Compare against previous scan. Look for new friction categories, recurring patterns, trending up/down.

### Skill Eval Sampling

Pick 3-5 skills and verify their evals exist and pass:

```bash
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"
for skill in coach pr-loop commit research cmux-agents; do
  echo "=== $skill ==="
  ls "$ORCHESTRATOR_REPO/skill-evals/$skill/" 2>/dev/null || echo "NO EVALS"
done
```

### BrainLayer Search Quality

Run 3 known-good queries and verify they return expected results:

```
brain_search("component reasoning brainlayer")
brain_search("friction patterns coachClaude")
brain_search("orchestrator architecture golems")
```

If any return empty or irrelevant results, search quality has degraded.

### Cross-Repo Staleness

```bash
for repo in golems brainlayer voicelayer orchestrator cmuxlayer; do
  last=$(git -C ~/Gits/$repo log -1 --format="%ar" 2>/dev/null || echo "not found")
  echo "$repo: $last"
done
```

Repos with no activity > 2 weeks during active development = investigate.

### Hook Health

```bash
ls -la ~/.claude/hooks/brainlayer-*.py 2>/dev/null || echo "No BrainLayer hooks"
cat ~/.claude/settings.json | python3 -m json.tool 2>/dev/null | grep -A5 "hooks" || echo "No hooks in settings"
```

Verify: SessionStart and UserPromptSubmit hooks are wired. No PostToolUse hooks (those cause hangs).
