import { $ } from "bun";
import type { GolemInfo } from "./types.js";

async function checkPort(port: number): Promise<boolean> {
  try {
    const result = await $`lsof -i :${port}`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function checkProcess(name: string): Promise<boolean> {
  try {
    const result = await $`pgrep -q ${name}`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function checkLaunchAgent(svc: string): Promise<"running" | "stopped" | "error"> {
  try {
    const result = await $`launchctl list 2>/dev/null`.quiet();
    const lines = result.stdout.toString();
    const match = lines.split("\n").find(
      (l) => l.includes(`com.golemszikaron.${svc}`) || l.includes(`com.golems.${svc}`)
    );
    if (!match) return "stopped";
    const pid = match.trim().split(/\s+/)[0];
    // PID column: "-" means not running, a number means running
    if (pid === "-") return "stopped";
    return /^\d+$/.test(pid) ? "running" : "error";
  } catch {
    return "stopped";
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

async function getNightShiftTarget(): Promise<string> {
  try {
    const stateFile = `${process.env.HOME}/.golems-zikaron/state.json`;
    const file = Bun.file(stateFile);
    if (await file.exists()) {
      const state = await file.json();
      return state.nightShiftTarget || "none";
    }
  } catch {}
  return "none";
}

export async function fetchGolemStatuses(): Promise<GolemInfo[]> {
  const [
    telegramRunning,
    nightshiftStatus,
    emailStatus,
    jobStatus,
    claudeSessions,
    nightTarget,
  ] = await Promise.all([
    checkPort(3847),
    checkLaunchAgent("nightshift"),
    checkLaunchAgent("email-golem"),
    checkLaunchAgent("job-golem"),
    countClaudeSessions(),
    getNightShiftTarget(),
  ]);

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
        `📂 Working on: ${nightTarget}`,
        `🔄 Active sessions: ${claudeSessions}`,
        "💾 Memory: Zikaron (sqlite-vec + bge-large)",
      ],
    },
    {
      name: "EmailGolem",
      emoji: "📧",
      status: emailStatus,
      detail: emailStatus === "running" ? "polling" : "inactive",
      description: "Routes emails to domain golems. Drafts replies. Tracks follow-ups.",
      trailerLines: [
        "$ golems email --triage",
        "📧 Scanning inbox... 23 new emails",
        "🏷️  Recruiter: 8 | Finance: 3 | Dev: 12",
        "✍️  Drafting reply to hiring@startup.com",
        "⏰ Follow-up due: 2 overdue, 5 this week",
      ],
    },
    {
      name: "RecruiterGolem",
      emoji: "💼",
      status: telegramRunning ? "running" : "stopped",
      detail: telegramRunning ? "ready" : "bot offline",
      description: "Contact finder, outreach pipeline, interview practice with Elo.",
      trailerLines: [
        "$ golems recruit --find \"senior frontend\"",
        "🔍 Exa search... 47 contacts found",
        "📊 Scoring: GitHub activity, blog posts, talks",
        "✉️  Drafting outreach (style-adapted)",
        "🎯 Interview practice: Elo 1450 → 1520",
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
    {
      name: "JobGolem",
      emoji: "🎯",
      status: jobStatus,
      detail: jobStatus === "running" ? "scraping" : "inactive",
      description: "Job board scraper. Matches by skills + preferences. Scores fit.",
      trailerLines: [
        "$ golems jobs --matches",
        "🎯 3 hot matches (>85% fit score)",
        "  → Senior Frontend @ Vercel (92%)",
        "  → Staff Eng @ Linear (88%)",
        "  → Founding Eng @ stealth AI (86%)",
        "📬 Applied: 12 this week, 3 interviews",
      ],
    },
    {
      name: "NightShift",
      emoji: "🌙",
      status: nightshiftStatus,
      detail: nightshiftStatus === "running" ? `target: ${nightTarget}` : "sleeping",
      description: "Autonomous 4am worker. PRs, fixes, improvements while you sleep.",
      trailerLines: [
        "$ golems nightshift --status",
        `🌙 Target: ${nightTarget}`,
        "⏰ Next run: 4:00 AM",
        "📝 Last run: 3 PRs created, 2 merged",
        "🔧 Fix list: 2 items (broken test, stale dep)",
      ],
    },
  ];
}
