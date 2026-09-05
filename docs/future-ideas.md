# Golem Ecosystem - Future Ideas

> Planning session for dashboard, Ollama scheduling, and queue behaviors.
> Generated: 2026-02-02

---

## Previous Context (Completed)

1. **Monorepo consolidation** - `golems/` with packages/ralph, packages/zikaron, packages/autonomous
2. **2 Telegram bots** - NotifyBot (3847) + OllamaChat (planned)
3. **Dashboard** - web/widget/app for job recs, draft approval
4. **Sandboxed Ollama** - with Claude validation queue
5. **Night Shift** - 3am creative improvements to repos

---

## 1. Dashboard Tech Stack

### Recommendation: **Expo + React Native**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| React/Next.js | Fast to build, familiar | No native notifications, no widgets | Good for MVP |
| iOS widget | Native feel, always visible | Swift learning curve, iOS-only | Nice-to-have |
| **Expo** | Cross-platform, push notifications, can add widgets later | Slightly heavier | **Best choice** |
| Static site + API | Simplest | No offline, no notifications | Too basic |

### Proposed Architecture

```
dashboard/
├── apps/
│   └── mobile/          # Expo app
│       ├── app/         # Expo Router screens
│       │   ├── (tabs)/
│       │   │   ├── jobs.tsx      # Job matches
│       │   │   ├── drafts.tsx    # Draft approval
│       │   │   └── status.tsx    # Night Shift status
│       │   └── _layout.tsx
│       └── components/
├── packages/
│   └── api/             # Shared API client
└── package.json
```

### Key Features
- **Push notifications** via Expo Notifications (replaces/augments Telegram)
- **Offline support** with local SQLite for job cache
- **Widgets** via expo-widget (future, after MVP)
- **Deep links** to specific drafts from notifications

### MVP Scope
1. Job matches list with filtering
2. Draft approval (swipe to approve/reject)
3. Night Shift status and override
4. Basic notifications

### Tech Choices
- **Expo SDK 51+** with Expo Router
- **NativeWind** for styling (Tailwind syntax)
- **Zustand** for state (simple, no boilerplate)
- **TanStack Query** for data fetching + caching

---

## 2. Ollama Off-Hours Schedule

### Current Schedule

| Time | Task | Agent |
|------|------|-------|
| 2am | Moltbook Learner | Ollama (scrape + embed) |
| 3am | Night Shift | Claude (code improvements) |
| 5-7am, 5-7pm | Job Golem | Ollama (scoring) |
| 8am | Morning Briefing | None (just notification) |

### Proposal: Dashboard Work at **11pm-1am**

**Rationale:**
- During a configured low-traffic window
- Before Moltbook Learner (2am)
- 2 hours is enough for 1 meaningful improvement

### New Schedule

| Time | Task | Duration |
|------|------|----------|
| **11pm** | **Dashboard Builder** (Ollama) | 1-2h |
| 2am | Moltbook Learner | ~30min |
| 3am | Night Shift | 1-3h |
| 5-7am | Job Golem AM | ~30min |
| 8am | Morning Briefing | instant |
| 5-7pm | Job Golem PM | ~30min |

### Dashboard Builder Constraints
- **Time limit**: 90 minutes max per session
- **Scope**: 1 improvement per night (no rabbit holes)
- **Validation**: Claude reviews after Ollama draft
- **Branch**: Always work in `dashboard-wip` branch
- **No deploy**: Only local builds, human deploys

---

## 3. Night Shift Dashboard Improvements

### What Counts as "1 Creative Improvement"?

**Definition**: A single, reviewable change that provides user value.

### Examples of 1 Improvement
- Add pull-to-refresh on jobs list
- Implement swipe-to-dismiss on drafts
- Add haptic feedback on approve/reject
- Create loading skeleton for job cards
- Add filter chip for job score threshold
- Improve empty state illustration
- Add "last updated" timestamp to status

### NOT 1 Improvement (Too Big)
- Redesign entire navigation
- Add authentication system
- Implement real-time sync
- Create new screen from scratch

### Git Strategy

```
main              ─────●───────●───────●──────────
                       │       │       │
dashboard-wip    ────●─┘     ●─┘     ●─┘
                     │       │       │
                   11pm    11pm    11pm
                   build   build   build

Weekly: A maintainer reviews dashboard-wip → squash merge → main
```

### Review Policy
- **Autonomous**: Commits to `dashboard-wip` directly
- **Human review**: Weekly squash-merge to main
- **No direct main pushes**: Ever
- **CodeRabbit**: On PR only, not on wip commits

### Safeguards
1. **Time box**: 90 min max, then stop even if incomplete
2. **Build check**: Must pass `bun run build` before commit
3. **No new deps**: Unless explicitly approved in a TODO list
4. **Screenshot**: Generate before/after screenshots for human review

---

## 4. OllamaChat Queue Behavior

### Status Messages

When Ollama is busy, show:
```
⏳ Working on something else. Your message is #2 in queue.
   Estimated wait: ~30 seconds
```

When responding after delay:
```
Sorry for the wait! Here's your answer...
```

### Priority System

| Priority | Type | Example |
|----------|------|---------|
| P0 | Emergency | Contains "urgent", "help now" |
| P1 | Commands | `/status`, `/tonight` |
| P2 | Short questions | <50 chars, ends with ? |
| P3 | Normal | Everything else |
| P4 | Long content | >500 chars, pastes |

### Queue Rules
- **Max queue size**: 5 messages
- **Queue timeout**: 5 minutes (then "Sorry, I got backed up. Please resend.")
- **Duplicate detection**: Same message within 30s = ignore
- **Typing indicator**: Show while processing

### Implementation

```typescript
interface QueueItem {
  id: string;
  ctx: Context;
  text: string;
  priority: 0 | 1 | 2 | 3 | 4;
  timestamp: number;
  status: 'waiting' | 'processing' | 'done';
}

// Sort by priority, then timestamp
queue.sort((a, b) => {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.timestamp - b.timestamp;
});
```

### Busy Detection
- **Ollama busy**: Check `/api/generate` endpoint 503
- **Claude busy**: `isProcessing` flag (already exists)
- **System busy**: Both Claude and Ollama active

---

## 5. Job Recommendations in Dashboard

### Data Flow

```
Job Golem (5am/5pm)
       │
       ▼
~/.golems-zikaron/job-golem/results/YYYY-MM-DD.json
       │
       ▼
Dashboard API reads JSON
       │
       ▼
Display in app with filtering
```

### Persistence Strategy
- **Source of truth**: JSON files from Job Golem runs
- **Dashboard cache**: Local SQLite via expo-sqlite
- **Refresh trigger**: Manual pull-to-refresh OR push notification

### Refresh Logic

```typescript
// On app open:
1. Load from local SQLite (instant)
2. Check if results file is newer than cache
3. If newer, refresh cache and re-render
4. If Job Golem running, show "Searching..." badge
```

### Filtering Options

| Filter | Type | Default |
|--------|------|---------|
| Min Score | Slider 1-10 | 6 |
| Sources | Multi-select | All |
| Posted Within | Days dropdown | 7 |
| Keywords | Text search | - |
| Hide Seen | Toggle | On |

### "Seen" Tracking
- **Seen**: User swiped left (dismiss) or opened detail
- **Saved**: User swiped right or tapped star
- **Applied**: User marked as applied

### Job Card Actions

```
┌─────────────────────────────────────┐
│ 🔥 9/10  Senior Frontend Engineer  │
│ Taboola • Tel Aviv                 │
│ React, TypeScript, AI integration  │
│                                    │
│ "Strong match: React + AI focus"   │
├─────────────────────────────────────┤
│ [Dismiss]  [Save]  [Open]  [Apply] │
└─────────────────────────────────────┘
```

### Integration with Job Golem

```typescript
// Add to job-golem output:
interface JobMatch {
  id: string;
  job: Job;
  score: number;
  reason: string;
  // New fields:
  keywords: string[];      // Extracted keywords
  salaryRange?: string;    // If mentioned
  remotePolicy?: 'full' | 'hybrid' | 'onsite';
}
```

---

## 6. Implementation Priority

### Phase 1: Foundation (Week 1-2)
1. Set up Expo app in `packages/dashboard/`
2. Create basic screens: Jobs, Drafts, Status
3. Connect to existing JSON files for data
4. Basic push notifications via Expo

### Phase 2: Core Features (Week 3-4)
1. Implement queue with priority in telegram-bot.ts
2. Add swipe gestures for drafts
3. Job filtering and "seen" tracking
4. Dashboard Builder launchd at 11pm

### Phase 3: Polish (Week 5-6)
1. Offline support with SQLite
2. Widgets for iOS (expo-widget)
3. Better notifications with deep links
4. Before/after screenshots for dashboard-wip

### Phase 4: OllamaChat Bot (Week 7+)
1. Second Telegram bot for direct Ollama chat
2. Shared queue state between bots
3. "Ollama's life" - autonomous Moltbook browsing

---

## 7. Telegram "Away Mode" Workflow

### Trigger Buttons (Reply Keyboard)
| Button | Meaning | Duration |
|--------|---------|----------|
| 🚶 Walk | Going for a walk | ~30min |
| 🌆 Out for day | Gone for hours | 2-4h |
| 🏠 Back | I'm back | - |

### "Walk" Mode Workflow
1. User taps 🚶 Walk
2. Bot: "Got it! I'll work on dashboard while you're out."
3. Ollama starts dashboard work:
   - Creates branch `dashboard-walk-MMDD`
   - Works for 20-30 min
   - Makes PR (not draft)
   - Scrolls Moltbook for 20 min
   - Checks CodeRabbit review
   - Addresses feedback
4. User taps 🏠 Back
5. Bot: "Welcome back! Made PR #123 - added swipe gestures to drafts. CodeRabbit approved after 1 revision."

### "Out for Day" Mode Workflow
Same but:
- Longer work sessions (multiple improvements)
- More Moltbook scrolling (learn patterns)
- Can do Night Shift style multi-repo work
- Summary is longer with bullet points

### Model Usage
- **qwen3-coder-64k**: Main coding work
- **qwen2.5-coder:7b**: Critique waves (fast iteration)

### Implementation
- Critique wave: generate → critique → refine → polish (using lighter model for speed)
- Build this as PRD for Night Shift to implement
- Store mode in `state.json` with `awayMode: "walk" | "day" | null`

---

## 9. Zikaron Optimization - Deduplicate Redundant Contexts

### Problem
Zikaron indexer runs continuously and hammers Ollama with embedding requests (500%+ CPU).
Much of the content being indexed is redundant:
- Same CLAUDE.md copied to multiple locations
- Shared contexts duplicated across packages
- Similar conversations indexed multiple times

### Proposed Solutions

#### A. Content Deduplication
- Hash content before indexing
- Skip if hash already exists in index
- Store hash → embedding mapping for reuse

#### B. Incremental Indexing
- Track last-indexed timestamp per file
- Only re-index files modified since last run
- Use filesystem watcher more intelligently (debounce)

#### C. Scheduled Indexing
- Don't run continuously
- Run on schedule (e.g., every 2 hours, or after Night Shift)
- Run on-demand when user searches

#### D. Context Deduplication at Source
- Single source of truth for shared contexts (`golems/contexts/`)
- Symlinks instead of copies
- Zikaron excludes symlink targets if source already indexed

### Implementation Priority
1. **Quick win**: Hash-based dedup (skip already-indexed content)
2. **Medium**: Scheduled indexing instead of continuous
3. **Longer**: Proper context management with symlinks

---

## 10. Open Questions (For Later)

1. **Authentication**: Should dashboard require auth? Or just local-only?
2. **Multi-device sync**: If on multiple devices, where's state?
3. **Ollama model**: Use gemma2:9b or something bigger for dashboard work?
4. **Job Golem sources**: Add more boards? LinkedIn integration?
5. **Moltbook posting**: Still blocked on OpenClaw - alternative?

---

## 11. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-02 | Expo for dashboard | Cross-platform, push notifications, widgets later |
| 2026-02-02 | Configured maintenance window | Avoids overlap with interactive work |
| 2026-02-02 | dashboard-wip branch | Autonomous commits, weekly human review |
| 2026-02-02 | Priority queue for Ollama | Better UX when busy |
| 2026-02-02 | JSON → SQLite for jobs | Offline support, fast filtering |

---

*Next steps: Maintainer review, then create a PRD for Phase 1.*
