import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as supabaseFactory from "@golems/shared/lib/supabase-factory";
import { getStatus } from "../index";

afterEach(() => mock.restore());

test("status preserves its fallback without accessing retired storage", async () => {
  const storage = spyOn(supabaseFactory, "getSupabase").mockImplementation(() => {
    throw new Error("Retired storage must not be accessed");
  });
  expect(await getStatus()).toEqual({
    name: "TellerGolem", healthy: true, lastRun: null,
    summary: "Financial domain expert",
  });
  expect(storage).not.toHaveBeenCalled();
});
