import { mock } from "bun:test";

const dryRun = process.argv[2] === "dry-run";
const effects = {
  saved: [] as any[],
  routed: [] as any[],
  senders: [] as any[],
  subscriptions: [] as any[],
  payments: [] as any[],
  marked: 0,
  requests: 0,
  syncs: 0,
  state: {} as Record<string, unknown>,
};
const emails = ["urgent", "subscription"].map((id) => ({
  id,
  subject: `Synthetic ${id}`,
  from: "Synthetic sender",
  fromName: "Fixture",
  snippet: "Synthetic triage fixture",
  receivedAt: new Date("2026-06-18T00:00:00Z"),
  listUnsubscribe: "synthetic-unsubscribe-id",
}));
mock.module("../../email/gmail-client", () => ({
  fetchRecentEmails: async () => emails,
  fetchEmailsSince: async () => emails,
  searchEmails: async () => [],
  getEmailBodyText: async () => "Synthetic body",
}));
mock.module("../../email/scorer", () => ({
  scoreEmail: async (input: any) => ({
    ...input,
    scoredAt: new Date("2026-06-18T01:00:00Z"),
    score: input.id === "urgent" ? 10 : 6,
    category: input.id === "urgent" ? "interview" : "subscription",
    reason: "Synthetic reason",
    subscription:
      input.id === "subscription"
        ? { serviceName: "Fixture", amount: 12, frequency: "monthly" }
        : undefined,
  }),
  shouldNotifyImmediately: (scored: any) => scored.score === 10,
  shouldTrackSubscription: (scored: any) => scored.category === "subscription",
}));
mock.module("../../email/router", () => ({
  determineTargetGolem: (category: string) => ({
    targetGolem: category === "interview" ? "recruitergolem" : "emailgolem",
    reason: "Synthetic route",
  }),
}));
mock.module("../../lib/event-log", () => ({
  logEvent: async (type: string, data: any) => {
    effects.routed.push({ type, data });
  },
}));
mock.module("../../lib/state-store", () => ({
  getState: async () => null,
  setState: async (key: string, value: unknown) => {
    effects.state[key] = value;
  },
}));
globalThis.fetch = (async () => {
  effects.requests++;
  throw new Error("Synthetic fixture forbids network");
}) as unknown as typeof fetch;
const { processEmails } = await import("../../email/index");
await processEmails({ dryRun, maxEmails: 2 });
console.log(`PIPELINE_EFFECTS=${JSON.stringify(effects)}`);
