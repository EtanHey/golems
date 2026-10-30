import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function runtimeProbe(source: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "runtime-env-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, ".git"), "gitdir: synthetic\n");
  writeFileSync(join(cwd, ".env"), "PORT=43210\nLLM_BACKEND=mlx\nSTATE_BACKEND=file\nGREEN_INVOICE_ID=synthetic-id\nGREEN_INVOICE_SECRET=synthetic-secret\n");
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", source], {
    cwd,
    env: { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd, NODE_ENV: "production", SUPABASE_URL: "http://127.0.0.1:9" },
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout.toString().trim().split("\n").at(-1)!;
}

it("loads cloud-worker dotenv before defaults and listener configuration", () => {
  expect(runtimeProbe(`
    globalThis.fetch = async () => { throw new Error("network forbidden"); };
    Bun.serve = ({ port }) => {
      console.log(JSON.stringify({ port, backend: process.env.LLM_BACKEND, state: process.env.STATE_BACKEND }));
      process.exit(0);
    };
    await import(${JSON.stringify(join(import.meta.dir, "../cloud-worker.ts"))});
  `)).toBe('{"port":43210,"backend":"mlx","state":"file"}');
});

it("retains Green Invoice credentials from the runtime checkout dotenv", () => {
  expect(runtimeProbe(`
    globalThis.fetch = async () => { throw new Error("network forbidden"); };
    const { getCredentials } = await import(${JSON.stringify(join(import.meta.dir, "../../../green-invoice-mcp/src/api.ts"))});
    const credentials = getCredentials();
    console.log(credentials.id === "synthetic-id" && credentials.secret === "synthetic-secret");
  `)).toBe("true");
});
