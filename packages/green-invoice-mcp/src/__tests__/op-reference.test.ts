import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { getToken, resetTokenCache, resolveOpReference } from "../api";

// Ported from packages/teller's former green-invoice copy: credentials may be
// plain values or 1Password op:// references, resolved with `op read`.

type SpawnResult = {
  exited: Promise<number>;
  stdout: ReadableStream;
  stderr: ReadableStream;
};

function streamOf(text: string): ReadableStream {
  const data = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      if (data.length > 0) controller.enqueue(data);
      controller.close();
    },
  });
}

/** Replace Bun.spawn for `op read <ref>`; returns the refs that were read. */
function fakeOp(resolve: (ref: string) => { code: number; out?: string; err?: string }) {
  const originalSpawn = Bun.spawn;
  const reads: string[] = [];
  Bun.spawn = ((args: string[]) => {
    if (args[0] === "op" && args[1] === "read") {
      reads.push(args[2]);
      const { code, out = "", err = "" } = resolve(args[2]);
      return {
        exited: Promise.resolve(code),
        stdout: streamOf(out),
        stderr: streamOf(err),
      } satisfies SpawnResult;
    }
    return originalSpawn(args as never);
  }) as typeof Bun.spawn;
  return { reads, restore: () => (Bun.spawn = originalSpawn) };
}

describe("resolveOpReference", () => {
  it("returns plain values unchanged without invoking op", async () => {
    const op = fakeOp(() => ({ code: 0, out: "should-not-be-used" }));
    try {
      expect(await resolveOpReference("my-plain-api-key")).toBe("my-plain-api-key");
      expect(await resolveOpReference("")).toBe("");
      expect(op.reads).toEqual([]);
    } finally {
      op.restore();
    }
  });

  it("resolves op:// references and trims the output", async () => {
    const op = fakeOp(() => ({ code: 0, out: "resolved-secret-value\n" }));
    try {
      expect(await resolveOpReference("op://development/green-invoice/id")).toBe(
        "resolved-secret-value",
      );
      expect(op.reads).toEqual(["op://development/green-invoice/id"]);
    } finally {
      op.restore();
    }
  });

  it("rejects op:// references when the op CLI fails", async () => {
    const op = fakeOp(() => ({ code: 1, err: "connect to 1Password failed\n" }));
    try {
      await expect(resolveOpReference("op://development/green-invoice/id")).rejects.toThrow(
        "Failed to resolve 1Password reference op://development/green-invoice/id: connect to 1Password failed",
      );
    } finally {
      op.restore();
    }
  });

  it("names the likely cause when op fails silently (killed by the timeout or not signed in)", async () => {
    const op = fakeOp(() => ({ code: 143 }));
    try {
      await expect(resolveOpReference("op://development/green-invoice/id")).rejects.toThrow(
        "op exited 143 with no output; is the 1Password CLI signed in? (10s timeout)",
      );
    } finally {
      op.restore();
    }
  });
});

// r5's #195 nits (GO-4 PR-2b).
describe("resolveOpReference edge cases", () => {
  it("throws on an empty value instead of sending \"\" as a credential", async () => {
    const op = fakeOp(() => ({ code: 0, out: "\n" }));
    try {
      await expect(resolveOpReference("op://development/green-invoice/id")).rejects.toThrow(
        "op read returned an empty value for op://development/green-invoice/id",
      );
    } finally {
      op.restore();
    }
  });

  it("mentions the timeout only when op was killed by it (exit 143)", async () => {
    const op = fakeOp(() => ({ code: 1 }));
    try {
      const err = await resolveOpReference("op://development/green-invoice/id").catch((e: Error) => e);
      expect(String(err)).toContain("op exited 1 with no output; is the 1Password CLI signed in?");
      expect(String(err)).not.toContain("timeout");
    } finally {
      op.restore();
    }
  });

  it("drains stdout while op is still running (no pipe-buffer deadlock)", async () => {
    const originalSpawn = Bun.spawn;
    // op exits only after its whole stdout has been consumed, like a child
    // blocked on a full pipe. Awaiting exit before reading would hang.
    Bun.spawn = ((args: string[]) => {
      let exit!: (code: number) => void;
      const exited = new Promise<number>((resolve) => (exit = resolve));
      const chunks = ["resolved-", "secret"].map((t) => new TextEncoder().encode(t));
      return {
        exited,
        stdout: new ReadableStream({
          pull(controller) {
            const next = chunks.shift();
            if (next) controller.enqueue(next);
            else {
              controller.close();
              exit(0);
            }
          },
        }),
        stderr: streamOf(""),
      };
    }) as unknown as typeof Bun.spawn;
    try {
      const result = await Promise.race([
        resolveOpReference("op://development/green-invoice/id"),
        Bun.sleep(1000).then(() => "DEADLOCK"),
      ]);
      expect(result).toBe("resolved-secret");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });
});

describe("getToken with op:// credentials", () => {
  const originalEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | null = null;

  beforeEach(() => {
    resetTokenCache();
    delete process.env.GREEN_INVOICE_SANDBOX;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
    process.env = { ...originalEnv };
  });

  it("sends the resolved values, never the op:// reference, to the token endpoint", async () => {
    process.env.GREEN_INVOICE_ID = "op://vault/green-invoice/id";
    process.env.GREEN_INVOICE_SECRET = "plain-secret";
    const op = fakeOp((ref) => ({ code: 0, out: ref.endsWith("/id") ? "real-id\n" : "" }));
    let sentBody: unknown = null;
    const fakeFetch = async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response("", { status: 200, headers: { "X-Authorization-Bearer": "jwt" } });
    };
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fakeFetch as unknown as typeof fetch);
    try {
      expect(await getToken()).toBe("jwt");
      expect(sentBody).toEqual({ id: "real-id", secret: "plain-secret" });
      expect(op.reads).toEqual(["op://vault/green-invoice/id"]);
    } finally {
      op.restore();
    }
  });
});
