import { describe, expect, it } from "bun:test";

import * as botShared from "./lib/bot-shared";

describe("bot shared status helpers", () => {
  it("does not expose the retired Railway health probe", () => {
    expect("RAILWAY_HEALTH_URL" in botShared).toBe(false);
    expect("checkRailwayHealth" in botShared).toBe(false);
  });
});
