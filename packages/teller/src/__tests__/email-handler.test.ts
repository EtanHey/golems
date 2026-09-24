import { describe, it, expect } from "bun:test";
import type { EmailHandlers } from "@golems/shared/email/router";
import { processSubscriptionEmail } from "../index";

// shared's email router takes domain handlers by injection (it may not import
// teller). This pins that teller's processor fits the tellergolem slot; tsc
// checks the assignment.
describe("teller as an email-router handler", () => {
  it("processSubscriptionEmail fits EmailHandlers.tellergolem", () => {
    const handlers: EmailHandlers = { tellergolem: processSubscriptionEmail };
    expect(handlers.tellergolem).toBe(processSubscriptionEmail);
  });
});
