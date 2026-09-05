/**
 * Remotion Root — registers all compositions.
 *
 * Compositions:
 * - CodeShowcase: Animated code walkthrough
 * - ArchDiagram: Animated architecture diagram
 * - MetricsDashboard: Animated stats/metrics
 * - ProductHero: Scene sequencer (TitleCard → Screenshots → Metrics → ScreenRecording)
 * - WeeklyJobs: Animated bar chart of top job tags/skills
 * - MonthlyFinance: Animated donut chart of LLM costs by model
 * - BrainGrowth: Animated line chart of knowledge base growth
 *
 * Each composition has YouTube (1920x1080), LinkedIn (1080x1080), and GIF (800x450) variants.
 */

import { Composition } from "remotion";
import { defaultDark } from "./lib";

// Compositions
import { CodeShowcase, type CodeShowcaseProps } from "./compositions/CodeShowcase/CodeShowcase";
import { ArchDiagram, type ArchDiagramProps } from "./compositions/ArchDiagram/ArchDiagram";
import { MetricsDashboard, type MetricsDashboardProps } from "./compositions/MetricsDashboard/MetricsDashboard";
import {
  ProductHero,
  type ProductHeroCompositionProps,
} from "./compositions/ProductHero/ProductHero";
import { WeeklyJobs, type WeeklyJobsProps } from "./compositions/WeeklyJobs/WeeklyJobs";
import { MonthlyFinance, type MonthlyFinanceProps } from "./compositions/MonthlyFinance/MonthlyFinance";
import { BrainGrowth, type BrainGrowthProps } from "./compositions/BrainGrowth/BrainGrowth";

import "./style.css";

// --- Default Props for Preview ---

const codeShowcaseDefaults: CodeShowcaseProps = {
  code: `import { springProgress } from "./motion";
import { useCurrentFrame, useVideoConfig } from "remotion";

export const FadeIn: React.FC<Props> = ({ delay, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = springProgress(frame, fps, "smooth", delay);
  return <div style={{ opacity }}>{children}</div>;
};`,
  brand: defaultDark,
  title: "Spring Animation Helper",
  language: "TypeScript",
  filename: "FadeIn.tsx",
  highlightLines: [5, 6, 7],
  highlightAtFrame: 60,
  terminalLines: [
    { text: "bun run render CodeShowcase", isCommand: true },
    { text: "Rendering... 100% done" },
    { text: "Output: out/code-showcase.mp4", color: "#22C55E" },
  ],
  terminalStartFrame: 100,
  layout: "stacked",
};

const archDiagramDefaults: ArchDiagramProps = {
  title: "Golems Architecture",
  subtitle: "Autonomous AI Agent Ecosystem",
  brand: defaultDark,
  nodes: [
    { id: "claude", label: "ClaudeGolem", icon: "🤖", x: 960, y: 200, variant: "primary", entranceDelay: 5 },
    { id: "jobs", label: "JobGolem", icon: "💼", x: 500, y: 400, variant: "secondary", entranceDelay: 12 },
    { id: "recruiter", label: "RecruiterGolem", icon: "🎯", x: 960, y: 400, variant: "secondary", entranceDelay: 16 },
    { id: "content", label: "ContentGolem", icon: "✍️", x: 1420, y: 400, variant: "secondary", entranceDelay: 20 },
    { id: "shared", label: "@golems/shared", icon: "📦", x: 960, y: 600, variant: "accent", entranceDelay: 25 },
    { id: "supabase", label: "Supabase", icon: "🗄️", x: 600, y: 700, variant: "muted", entranceDelay: 30 },
    { id: "railway", label: "Railway", icon: "🚂", x: 1320, y: 700, variant: "muted", entranceDelay: 30 },
  ],
  edges: [
    { from: "claude", to: "jobs", label: "commands", showDataFlow: true },
    { from: "claude", to: "recruiter", showDataFlow: true },
    { from: "claude", to: "content", label: "commands", showDataFlow: true },
    { from: "jobs", to: "shared" },
    { from: "recruiter", to: "shared" },
    { from: "content", to: "shared" },
    { from: "shared", to: "supabase", label: "data" },
    { from: "shared", to: "railway", label: "deploy" },
  ],
};

const metricsDashboardDefaults: MetricsDashboardProps = {
  title: "Golems Dashboard",
  subtitle: "Last 30 Days",
  brand: defaultDark,
  layout: "grid-2x2",
  metrics: [
    {
      label: "PRs Merged",
      value: 47,
      icon: "🔀",
      trend: "up",
      trendValue: "+12%",
      sparkData: [0.3, 0.4, 0.35, 0.5, 0.6, 0.55, 0.7, 0.8, 0.75, 0.9],
    },
    {
      label: "Lines Changed",
      value: 12400,
      suffix: "+",
      icon: "📝",
      trend: "up",
      trendValue: "+23%",
      sparkData: [0.2, 0.3, 0.5, 0.4, 0.6, 0.7, 0.65, 0.8, 0.85, 0.95],
    },
    {
      label: "Test Coverage",
      value: 89,
      suffix: "%",
      decimals: 0,
      icon: "🧪",
      trend: "up",
      trendValue: "+5%",
      sparkData: [0.6, 0.62, 0.65, 0.68, 0.7, 0.72, 0.75, 0.8, 0.85, 0.89],
    },
    {
      label: "Agent Tasks",
      value: 156,
      icon: "🤖",
      trend: "up",
      trendValue: "+34%",
      sparkData: [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0],
    },
  ],
};

const productHeroDefaults: ProductHeroCompositionProps = {
  brand: defaultDark,
  transition: "crossfade",
  showProgressBar: true,
  scenes: [
    {
      type: "title-card",
      title: "Golems",
      subtitle: "Autonomous AI Agent Ecosystem",
      durationInFrames: 120,
      background: { type: "color", value: "#0F172A" },
    },
    {
      type: "metrics",
      heading: "By the Numbers",
      metrics: [
        { label: "Packages", value: 10, icon: "📦" },
        { label: "PRs", value: 150, suffix: "+", icon: "🔀" },
        { label: "Tests", value: 382, icon: "🧪" },
      ],
      layout: "row",
      durationInFrames: 150,
    },
  ],
};

const weeklyJobsDefaults: WeeklyJobsProps = {
  title: "Top Job Skills This Week",
  subtitle: "Based on 278 scraped listings",
  brand: defaultDark,
  tags: [
    { tag: "TypeScript", count: 45 },
    { tag: "React", count: 38 },
    { tag: "Node.js", count: 32 },
    { tag: "Python", count: 28 },
    { tag: "Next.js", count: 22 },
    { tag: "AWS", count: 18 },
    { tag: "PostgreSQL", count: 15 },
    { tag: "Docker", count: 12 },
  ],
};

const monthlyFinanceDefaults: MonthlyFinanceProps = {
  title: "LLM Costs This Month",
  subtitle: "All golem API usage",
  brand: defaultDark,
  costs: [
    { label: "Gemini Flash", value: 0, color: "#06B6D4" },
    { label: "Claude Haiku", value: 2.40, color: "#6366F1" },
    { label: "Claude Sonnet", value: 8.50, color: "#8B5CF6" },
    { label: "Claude Opus", value: 15.20, color: "#EC4899" },
    { label: "Ollama Local", value: 0, color: "#10B981" },
  ],
};

const brainGrowthDefaults: BrainGrowthProps = {
  title: "Knowledge Base Growth",
  subtitle: "Zikaron indexed chunks over time",
  brand: defaultDark,
  data: [
    { label: "Mar", value: 10000 },
    { label: "Apr", value: 45000 },
    { label: "May", value: 80000 },
    { label: "Jun", value: 120000 },
    { label: "Jul", value: 150000 },
    { label: "Aug", value: 170000 },
    { label: "Sep", value: 190000 },
    { label: "Oct", value: 200000 },
    { label: "Nov", value: 215000 },
    { label: "Dec", value: 230000 },
    { label: "Jan", value: 240000 },
    { label: "Feb", value: 247000 },
  ],
  yAxisLabel: "Chunks",
};

// --- Platform Sizes ---

const YOUTUBE = { width: 1920, height: 1080, fps: 30 };
const LINKEDIN = { width: 1080, height: 1080, fps: 30 };
const GIF = { width: 800, height: 450, fps: 15 };

export const Root: React.FC = () => {
  return (
    <>
      {/* ===== CodeShowcase ===== */}
      <Composition
        id="CodeShowcase"
        component={CodeShowcase}
        durationInFrames={180}
        {...YOUTUBE}
        defaultProps={codeShowcaseDefaults}
      />
      <Composition
        id="CodeShowcase-LinkedIn"
        component={CodeShowcase}
        durationInFrames={180}
        {...LINKEDIN}
        defaultProps={codeShowcaseDefaults}
      />

      {/* ===== ArchDiagram ===== */}
      <Composition
        id="ArchDiagram"
        component={ArchDiagram}
        durationInFrames={210}
        {...YOUTUBE}
        defaultProps={archDiagramDefaults}
      />
      <Composition
        id="ArchDiagram-LinkedIn"
        component={ArchDiagram}
        durationInFrames={210}
        {...LINKEDIN}
        defaultProps={archDiagramDefaults}
      />

      {/* ===== MetricsDashboard ===== */}
      <Composition
        id="MetricsDashboard"
        component={MetricsDashboard}
        durationInFrames={150}
        {...YOUTUBE}
        defaultProps={metricsDashboardDefaults}
      />
      <Composition
        id="MetricsDashboard-LinkedIn"
        component={MetricsDashboard}
        durationInFrames={150}
        {...LINKEDIN}
        defaultProps={metricsDashboardDefaults}
      />
      <Composition
        id="MetricsDashboard-GIF"
        component={MetricsDashboard}
        durationInFrames={75}
        {...GIF}
        defaultProps={metricsDashboardDefaults}
      />

      {/* ===== ProductHero ===== */}
      <Composition
        id="ProductHero"
        component={ProductHero}
        durationInFrames={270}
        {...YOUTUBE}
        defaultProps={productHeroDefaults}
      />
      <Composition
        id="ProductHero-LinkedIn"
        component={ProductHero}
        durationInFrames={270}
        {...LINKEDIN}
        defaultProps={productHeroDefaults}
      />

      {/* ===== WeeklyJobs (Data Viz) ===== */}
      <Composition
        id="WeeklyJobs"
        component={WeeklyJobs}
        durationInFrames={150}
        {...YOUTUBE}
        defaultProps={weeklyJobsDefaults}
      />
      <Composition
        id="WeeklyJobs-LinkedIn"
        component={WeeklyJobs}
        durationInFrames={150}
        {...LINKEDIN}
        defaultProps={weeklyJobsDefaults}
      />

      {/* ===== MonthlyFinance (Data Viz) ===== */}
      <Composition
        id="MonthlyFinance"
        component={MonthlyFinance}
        durationInFrames={150}
        {...YOUTUBE}
        defaultProps={monthlyFinanceDefaults}
      />
      <Composition
        id="MonthlyFinance-LinkedIn"
        component={MonthlyFinance}
        durationInFrames={150}
        {...LINKEDIN}
        defaultProps={monthlyFinanceDefaults}
      />

      {/* ===== BrainGrowth (Data Viz) ===== */}
      <Composition
        id="BrainGrowth"
        component={BrainGrowth}
        durationInFrames={180}
        {...YOUTUBE}
        defaultProps={brainGrowthDefaults}
      />
      <Composition
        id="BrainGrowth-LinkedIn"
        component={BrainGrowth}
        durationInFrames={180}
        {...LINKEDIN}
        defaultProps={brainGrowthDefaults}
      />
    </>
  );
};
