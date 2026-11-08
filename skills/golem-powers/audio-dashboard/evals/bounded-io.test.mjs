import { test, expect } from "bun:test";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { purgeRejectedTakeCaches } from "../src/take-cache.mjs";

mkdirSync(path.resolve("docs.local/p20"), { recursive: true });

async function probe(mode) {
  const dir = mkdtempSync(path.resolve("docs.local/p20/probe-"));
  const out = path.join(dir, "index.html");
  writeFileSync(out, "local");
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const server = createServer((req, res) => {
    res.on("close", closed);
    res.writeHead(200); res.flushHeaders();
    if (mode === "oversize") res.write(Buffer.alloc(1024 * 1024));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const child = Bun.spawn([process.execPath, new URL("../scripts/verify-tailnet-publish.mjs", import.meta.url).pathname,
    "--out", out, "--url", `http://127.0.0.1:${server.address().port}`, "--timeout-ms", "200"], { stdout: "pipe", stderr: "pipe" });
  let watchdog;
  try {
    const result = await Promise.race([
      Promise.all([child.exited, new Response(child.stderr).text()]),
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("probe exceeded 2s watchdog")), 2000); }),
    ]);
    expect(result[0]).not.toBe(0);
    expect(result[1]).toContain(mode === "oversize" ? "response exceeds" : "tailnet probe failed");
    await disconnected;
  } finally {
    clearTimeout(watchdog); child.kill(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true });
  }
}
test("headers succeed but stalled body hits deadline", () => probe("stall"));
test("oversize streaming body is cut off before deadline", () => probe("oversize"));
test("purge receipts distinguish deletion from absence, failure and no attempt", () => {
  const dir = mkdtempSync(path.resolve("docs.local/p20/cache-"));
  try {
    const artifacts = ["deleted", "absent", "failed", "invalid"].map((id, i) => {
      const key = String(i + 1).repeat(64), receipt = path.join(dir, id + ".json");
      writeFileSync(receipt, JSON.stringify({version: 1, cacheKey: id === "invalid" ? "unsafe" : key}));
      if (id === "deleted") writeFileSync(path.join(dir, key + ".wav"), "audio");
      if (id === "failed") mkdirSync(path.join(dir, key + ".wav"));
      return {id, cacheReceiptPath: receipt};
    });
    const receipts = purgeRejectedTakeCaches({artifacts, cacheDir: dir, rejectedSegments: ["deleted", "absent", "failed", "invalid", "unknown"]});
    const outcomes = Object.fromEntries(receipts.map(r => [r.segment, r.deletionOutcome]));
    expect(outcomes).toEqual({deleted: "deleted", absent: "already-absent", failed: "failed", invalid: "never-attempted", unknown: "never-attempted"});
    expect(purgeRejectedTakeCaches({artifacts: artifacts.slice(0, 1), cacheDir: dir, rejectedSegments: ["deleted"]})[0].deletionOutcome).toBe("already-absent");
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
