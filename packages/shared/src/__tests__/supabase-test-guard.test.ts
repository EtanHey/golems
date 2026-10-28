import { describe, expect, it } from "bun:test";
import { isTestMode } from "../lib/test-mode";

const factory = new URL("../lib/supabase-factory.ts", import.meta.url).pathname;
const db = new URL("../email/db-client.ts", import.meta.url).pathname;

// Fresh processes avoid the suite's module mocks and singleton/env mutations.
function probe(code: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `
    globalThis.fetch = () => { throw new Error("network forbidden in guard probe"); };
    const { getSupabase, getSupabaseAnon } = await import(${JSON.stringify(factory)});
    ${code}
  `], {
    cwd: import.meta.dir,
    env: {
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      SUPABASE_URL: "http://127.0.0.1:9",
      SUPABASE_SERVICE_KEY: "synthetic-service",
      SUPABASE_ANON_KEY: "synthetic-anon",
      ...env,
    },
  });
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().trim();
}

describe("Supabase test boundary", () => {
  const modes: Record<string, string>[] = [
    { NODE_ENV: "test" },
    { NODE_ENV: "production", BUN_ENV: "test" },
  ];
  for (const mode of modes) {
    it(`blocks both factories in ${JSON.stringify(mode)}`, () => {
      expect(probe("console.log(getSupabase() === null && getSupabaseAnon() === null)", mode)).toBe("true");
    });
  }

  it("recognizes the Bun test runner even with production env markers", () => {
    const nodeEnv = process.env.NODE_ENV;
    const bunEnv = process.env.BUN_ENV;
    try {
      process.env.NODE_ENV = "production";
      process.env.BUN_ENV = "production";
      expect(isTestMode()).toBe(true);
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      if (bunEnv === undefined) delete process.env.BUN_ENV;
      else process.env.BUN_ENV = bunEnv;
    }
  });

  it("allows an explicitly opted-in nonproduction client", () => {
    expect(probe("console.log(!!getSupabase() && !!getSupabaseAnon())", {
      GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "1",
    })).toBe("true");
  });

  it("does not treat other opt-in values as permission", () => {
    expect(probe("console.log(getSupabase() === null)", {
      GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "true",
    })).toBe("true");
  });

  it("refuses unknown custom domains even with opt-in", () => {
    expect(probe(`
      process.env.SUPABASE_URL = "https://database.example.invalid";
      console.log(getSupabase() === null && getSupabaseAnon() === null);
    `, { GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "1" })).toBe("true");
  });

  it("allows an opted-in nonproduction project hostname", () => {
    expect(probe(`
      process.env.SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
      console.log(!!getSupabase() && !!getSupabaseAnon());
    `, { GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "1" })).toBe("true");
  });

  for (const url of [
    "https://mkijzwkuubtfjqcemorx.supabase.co",
    "https://MKIJZWKUUBTFJQCEMORX.supabase.co",
    "https://%6dkijzwkuubtfjqcemorx.supabase.co",
  ]) {
    it(`refuses production even with opt-in: ${url}`, () => {
      expect(probe(`
        process.env.SUPABASE_URL = ${JSON.stringify(url)};
        const { createSupabaseClient } = await import(${JSON.stringify(factory)});
        let blocked = false;
        try { createSupabaseClient(process.env.SUPABASE_URL, "synthetic"); }
        catch { blocked = true; }
        console.log(blocked && getSupabase() === null && getSupabaseAnon() === null);
      `, { GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "1" })).toBe("true");
    });
  }

  it("rechecks permission before returning cached clients", () => {
    expect(probe(`
      getSupabase(); getSupabaseAnon();
      delete process.env.GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS;
      console.log(getSupabase() === null && getSupabaseAnon() === null);
    `, { GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "1" })).toBe("true");
  });

  it("cannot reuse a production client cached outside test mode", () => {
    expect(probe(`
      process.env.NODE_ENV = "production";
      process.env.SUPABASE_URL = "https://mkijzwkuubtfjqcemorx.supabase.co";
      getSupabase(); getSupabaseAnon();
      process.env.NODE_ENV = "test";
      process.env.SUPABASE_URL = "http://127.0.0.1:9";
      console.log(getSupabase() === null && getSupabaseAnon() === null);
    `, { GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "1" })).toBe("true");
  });

  it("guards custom email clients too", () => {
    expect(probe(`
      const { createDbClient } = await import(${JSON.stringify(db)});
      let blocked = false;
      try { createDbClient({url: "http://127.0.0.1:9", key: "synthetic"}); }
      catch { blocked = true; }
      console.log(blocked);
    `)).toBe("true");
  });

  it("keeps ordinary runtime client creation working", () => {
    expect(probe("console.log(!!getSupabase() && !!getSupabaseAnon())", {
      NODE_ENV: "production",
    })).toBe("true");
  });

  it("can execute an opted-in local query through the real client", () => {
    expect(probe(`
      let calls = 0;
      globalThis.fetch = (request) => {
        if (!String(request.url ?? request).startsWith("http://127.0.0.1:9/")) throw new Error("unexpected URL");
        calls++;
        return Promise.resolve(new Response("[]", {headers: {"Content-Type": "application/json"}}));
      };
      const { data, error } = await getSupabase().from("synthetic").select("id");
      console.log(calls === 1 && error === null && data.length === 0);
    `, { GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "1" })).toBe("true");
  });
});
