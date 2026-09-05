# Golem Ecosystem Reference

> Full golem ecosystem reference. Export to `.claude/rules/` if needed.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                        USER (Etan)                              │
│                            │                                    │
│                ┌───────────┴───────────┐                        │
│                ▼                       ▼                        │
│        [Claude Code]            [Telegram]                      │
│                │                       │                        │
│                ▼                       ▼                        │
│      ┌─────────────────┐    ┌──────────────────┐               │
│      │  claude-golem   │    │  golems-zikaron  │               │
│      │     (Ralph)     │◄───│  (Telegram Bot)  │               │
│      └────────┬────────┘    └────────┬─────────┘               │
│               │                      │                          │
│               │         ┌────────────┼────────────┐             │
│               │         ▼            ▼            ▼             │
│               │   [EmailGolem]  [Night Shift]  [Soltome]        │
│               │         │                                       │
│               │    ┌────┴────────────────────┐                  │
│               │    ▼         ▼         ▼     ▼                  │
│               │ Recruiter  Teller  Claude  Email                │
│               │  Golem     Golem   Golem   Golem                │
│               │                                                 │
│               └──────────────┬──────────────────┘               │
│                              ▼                                  │
│                     ┌─────────────────┐                         │
│                     │     zikaron     │                         │
│                     │ (Memory Layer)  │                         │
│                     └─────────────────┘                         │
└────────────────────────────────────────────────────────────────┘
```

### Email Routing (Phase 1)

EmailGolem scores and categorizes incoming emails, then routes them:
- **job, interview** → RecruiterGolem (outreach pipeline)
- **subscription** → TellerGolem (financial tracking)
- **tech-update, urgent** → ClaudeGolem (knowledge/immediate handling)
- **newsletter, promo, social, other** → EmailGolem (default)

---

## Components

### 1. Ralph (claude-golem)
**Location**: `~/Gits/claude-golem`
**Purpose**: Autonomous AI coding loop

**How it works**:
1. Read PRD stories from `prd-json/`
2. Spawn fresh Claude instance
3. Claude implements story
4. CodeRabbit reviews
5. Commit and move to next story

**Key files**:
- `ralph.zsh` - Main entry point
- `lib/` - Modular zsh library
- `ralph-ui/` - React Ink dashboard
- `skills/golem-powers/` - Skills for Claude

**Commands**:
```bash
ralph N          # Run N iterations
ralph -ui        # Dashboard mode
ralph --prd path # Use specific PRD
```

---

### 2. Zikaron (Memory Layer)
**Location**: `~/Gits/zikaron`
**Purpose**: Indexes Claude Code conversations for search/retrieval

**How it works**:
1. Watches `~/.claude/` for new conversations
2. Extracts patterns, solutions, style
3. Indexes for semantic search
4. Provides memory to other golems

**Key outputs**:
- `data/archives/style-*/` - Communication style analysis
- `data/embeddings/` - Vector embeddings for search

**LaunchAgent**: `com.zikaron.watcher` (always running)

---

### 3. GolemsZikaron (Telegram Bot)
**Location**: `~/Gits/golems-zikaron`
**Purpose**: Telegram bridge + Soltome presence

**Features**:
- Receives messages via Telegram
- Routes to appropriate Claude session
- Posts to Soltome (AI discussion platform)
- Runs Night Shift (4am autonomous work)
- Morning briefings (8am)

**LaunchAgents** (6 total):
- `com.golemszikaron.telegram` - Main bot (always on)
- `com.golemszikaron.nightshift` - 4:00 AM
- `com.golemszikaron.briefing` - 8:00 AM
- `com.golemszikaron.job-golem` - 5:00 AM + 5:00 PM
- `com.golemszikaron.email-golem` - Every 10 min
- `com.golemszikaron.ollama` - Local LLM (always on)

**MCP Servers** (3 total):
- `golems-email` - Email tools (7 tools: getRecent, search, subscriptions, urgent, stats, getByGolem, draftReply)
- `golems-jobs` - Job board tools
- `zikaron` - Memory/conversation search

**State files**: `~/.golems-zikaron/`
- `inbox.md` - Messages from Telegram
- `outbox.md` - Responses to send
- `state.json` - Current state

---

### 4. Soltome Integration
**What**: AI discussion platform (credit-based posting)
**Access**: Via golems-zikaron

**Persona**: Collaborative researcher + open source evangelist
**Topics**: Zikaron, Ralph, autonomous coding patterns
**Never post about**: Private projects

---

## State Locations

| Location | Purpose | Managed By |
|----------|---------|------------|
| `~/.golems-zikaron/` | Telegram bridge state | golems-zikaron |
| `~/.config/ralph/` | Ralph runtime config | ralph |
| `~/.claude/` | Claude Code state | Claude Code |
| `~/.claude/agent_states/` | Subagent tracking | hooks |

---

## Symlinks

| Symlink | Target |
|---------|--------|
| `~/.config/claude-golem` | `~/Gits/claude-golem` |
| `~/.config/ralph/*` | `~/Gits/golems/packages/ralph/*` |
| `~/.claude/skill-index.md` | `~/Gits/claude-golem/contexts/skill-index.md` |

---

## Skills

Main skills in `~/Gits/claude-golem/skills/golem-powers/`:

| Skill | Purpose |
|-------|---------|
| `/prd` | Create PRDs for Ralph |
| `/commit` | Atomic commit + CodeRabbit review |
| `/notify` | Send Telegram notification |
| `/coderabbit` | AI code review |
| `/worktrees` | Git worktree management |
| `/catchup` | Context recovery |
| `/1password` | Secrets management |
| `/brave` | Browser automation |

---

## Owner Communication Style

From Zikaron analysis:
- **Formality**: 2/10 (very casual)
- **Languages**: Hebrew ↔ English code-switching
- **Length**: Brief, direct
- **Emojis**: 🫶 sparingly
- **Tone**: Friendly, sometimes playful sarcasm

**Match this style in responses, especially for Telegram.**

---

## Common Tasks

### Send Telegram Notification
```bash
curl -s -X POST http://localhost:3847/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"Done","body":"What you did","source":"claude"}'
```

### Check Night Shift Target
```bash
cat ~/.golems-zikaron/state.json
```

### Run Ralph
```bash
cd ~/Gits/some-project
ralph 5  # Run 5 story iterations
```

### Create a PRD
```
/prd create "Project Name"
```
