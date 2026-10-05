import { $ } from "bun";
import type { GolemInfo } from "./types.js";

// EmailGolem has no LaunchAgent of its own: the cloud worker schedules it.
async function checkCloudWorker(): Promise<boolean> {
  try {
    // Match the bun process only, not an editor or grep with the name open.
    const result = await $`pgrep -f ${"bun.*cloud-worker\\.ts"}`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function countClaudeSessions(): Promise<number> {
  try {
    const result = await $`ps aux`.quiet();
    const lines = result.stdout.toString().split("\n");
    return lines.filter((l) => l.includes("claude") && !l.includes("grep")).length;
  } catch {
    return 0;
  }
}

export interface StatusProbe {
  checkCloudWorker(): Promise<boolean>;
  countClaudeSessions(): Promise<number>;
}

const liveProbe: StatusProbe = { checkCloudWorker, countClaudeSessions };

export async function fetchGolemStatuses(probe: StatusProbe = liveProbe): Promise<GolemInfo[]> {
  const [cloudWorkerRunning, claudeSessions] = await Promise.all([
    probe.checkCloudWorker(),
    probe.countClaudeSessions(),
  ]);
  const scheduled = cloudWorkerRunning ? "running" : "stopped";

  return [
    {
      name: "ClaudeGolem",
      emoji: "🤖",
      status: claudeSessions > 0 ? "running" : "stopped",
      detail: `${claudeSessions} session${claudeSessions !== 1 ? "s" : ""} active`,
      description: "Autonomous coding agent. Spawns → works → dies → remembers.",
      trailerLines: [
        "$ claude -c --resume",
        "🤖 Resuming session... context loaded",
        `🔄 Active sessions: ${claudeSessions}`,
        "💾 Memory: BrainLayer",
      ],
    },
    {
      name: "EmailGolem",
      emoji: "📧",
      status: scheduled,
      detail: cloudWorkerRunning ? "polling" : "cloud worker not running",
      description: "Labels and routes email. Drafts replies. Tracks follow-ups.",
      trailerLines: [
        "$ golems email --triage",
        "📧 Scanning inbox... 23 new emails",
        "🏷️  Career inbox: 8 | Finance: 3 | Dev: 12",
        "✍️  Drafting reply to hiring@startup.com",
        "⏰ Follow-up due: 2 overdue, 5 this week",
      ],
    },
    {
      name: "TellerGolem",
      emoji: "💰",
      status: "running",
      detail: "tracking",
      description: "Financial categorizer. Budget alerts. Tax deduction finder.",
      trailerLines: [
        "$ golems teller --briefing",
        "💰 Monthly spend: $2,847 (↓12% vs last month)",
        "🏷️  Categories: SaaS $890 | Food $420 | Transport $310",
        "⚠️  Alert: AWS bill up 34% — check Lambda usage",
        "📋 Tax deductions found: $1,240 (Schedule C)",
      ],
    },
  ];
}
