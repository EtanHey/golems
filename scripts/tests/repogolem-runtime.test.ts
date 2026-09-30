import { afterEach, expect, test } from "bun:test";
import { chmodSync, readFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseCache, readTransferredSecrets, runtimeMcpConfig, runtimeEnvironment, readRuntime } from "../repogolem/runtime-reader";

const scratch = join(import.meta.dir, "../../docs.local/ghb2-runtime-tests");
mkdirSync(scratch, { recursive: true });
const dirs: string[] = [];
const ref = "op://example-vault/example-item/credential";
const key = `REPOGOLEM_SECRET_${createHash("sha256").update(ref).digest("hex").slice(0, 32)}`;
function fixture() {
  const dir = mkdtempSync(join(scratch, "case-")); dirs.push(dir); chmodSync(dir, 0o700);
  const registry = {
    _generated: { configSha256: "fixture", machine: "example-host" },
    global: { env: { SETTING: "enabled" }, mcps: { shared: { command: "shared-server" } } },
    projects: { sample: { path: dir, clis: ["codex"], mcps: ["service", "supabase"], secrets: { API_TOKEN: ref, SUPABASE_ACCESS_TOKEN: ref } } },
    mcpDefinitions: { service: { command: "service-server", env: { API_TOKEN: ref, FROM_ENV: "$EXAMPLE_ENV" } } },
  };
  writeFileSync(join(dir, "registry.json"), JSON.stringify(registry), { mode: 0o600 });
  writeFileSync(join(dir, "secrets.env"), `# config-sha256: fixture\n# machine: example-host\n${key}=$'synthetic\\nvalue\\\'quoted'\n`, { mode: 0o600 });
  return { dir, registry };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("runtime merges cached MCP secrets, global MCPs and strict environment references", () => {
  const { dir } = fixture();
  const registry = readRuntime(dir, { EXAMPLE_ENV: "synthetic-env" });
  const mcp = runtimeMcpConfig(registry, "sample");
  expect(Object.keys(mcp.mcpServers).sort()).toEqual(["service", "shared", "supabase"]);
  expect(mcp.mcpServers.service.env).toEqual({ API_TOKEN: "synthetic\nvalue'quoted", FROM_ENV: "synthetic-env" });
  expect(mcp.mcpServers.supabase.args).not.toContain("--access-token");
  expect(mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN).toBe("synthetic\nvalue'quoted");
  expect(runtimeEnvironment(registry, "sample").SETTING).toBe("enabled");
});

test("missing cached references fail by key name without exposing values", () => {
  const { dir } = fixture();
  writeFileSync(join(dir, "secrets.env"), "# config-sha256: fixture\n# machine: example-host\n");
  expect(() => readRuntime(dir)).toThrow("API_TOKEN");
  expect(() => readRuntime(dir)).not.toThrow(ref);
});

test("runtime refuses stale stamps, permissive caches and symbolic links", () => {
  const { dir } = fixture();
  writeFileSync(join(dir, "secrets.env"), "# config-sha256: stale\n# machine: example-host\n");
  expect(() => readRuntime(dir)).toThrow("stale");
  chmodSync(join(dir, "registry.json"), 0o644);
  expect(() => readRuntime(dir)).toThrow("0600");
  chmodSync(join(dir, "registry.json"), 0o600);
  const alias = `${dir}-link`; dirs.push(alias); symlinkSync(dir, alias);
  expect(() => readRuntime(alias)).toThrow("0700");
});

test("cached shell text is parsed as data and arbitrary commands are refused", () => {
  const { dir } = fixture();
  writeFileSync(join(dir, "secrets.env"), `# config-sha256: fixture\n# machine: example-host\n${key}=$(touch injected)\n`);
  expect(() => readRuntime(dir)).toThrow("invalid cached assignment");
});

test("standalone shell ports all six dependencies without loading Ralph or running op", () => {
  const { dir } = fixture();
  const runtime = join(import.meta.dir, "../repogolem/runtime.zsh");
  const script = `
    export REPOGOLEM_GENERATED_DIR="$1" RALPH_REGISTRY_FILE="$1/registry.json"
    function op() { print -u2 OP_MUST_NOT_RUN; return 91; }
    function _ralph_load_libs() { print -u2 RALPH_MUST_NOT_LOAD; return 92; }
    source "$2" || exit $?
    repoGolem sample "$1" service || exit $?
    for name in repoGolem _ralph_load_libs _ralph_setup_mcps _ralph_setup_secrets _ralph_build_mcp_config _repogolem_build_title; do
      typeset -f "$name" >/dev/null || exit 93
    done
    _golem_setup_env sample || exit $?
    [[ "$API_TOKEN" == $'synthetic\nvalue\\'quoted' && "$SETTING" == enabled ]] || exit 94
    built=$(_ralph_build_mcp_config sample) || exit $?
    [[ "$(print -r -- "$built" | jq -r '.mcpServers.service.command')" == service-server ]] || exit 95
    [[ "$(_repogolem_build_title sample sampleCodex task)" == 'sampleCodex: task' ]] || exit 96
    print RUNTIME_OK
  `;
  const proc = Bun.spawnSync(["zsh", "-f", "-c", script, "_", dir, runtime], { env: { ...process.env, EXAMPLE_ENV: "synthetic-env" } });
  expect(proc.exitCode).toBe(0);
  expect(proc.stdout.toString()).toBe("RUNTIME_OK\n");
  expect(proc.stderr.toString()).toBe("");
});

test("every CLI refuses to launch when its generated secret cache becomes stale", () => {
  const { dir } = fixture();
  const script = `
    export REPOGOLEM_GENERATED_DIR="$1" XDG_RUNTIME_DIR="$1"
    source "$2" || exit $?
    function _golem_setup_title() { return 0; }
    function _golem_reset_title() { return 0; }
    function claude() { print AGENT_MUST_NOT_RUN; }
    function codex() { print AGENT_MUST_NOT_RUN; }
    function cursor() { print AGENT_MUST_NOT_RUN; }
    function agy() { print AGENT_MUST_NOT_RUN; }
    print '# config-sha256: stale' > "$1/secrets.env"
    for cli in Claude Codex Cursor Gemini; do
      sample\${cli} -s && exit 94
      print "BLOCKED_$cli"
    done
  `;
  const proc = Bun.spawnSync(["zsh", "-f", "-c", script, "_", dir, join(import.meta.dir, "../repogolem/runtime.zsh")], { env: { ...process.env, EXAMPLE_ENV: "synthetic-env" } });
  expect(proc.exitCode).toBe(0);
  expect(proc.stdout.toString().split("\n").filter(s => s.startsWith("BLOCKED_")).length).toBe(4);
  expect(proc.stdout.toString()).not.toContain("AGENT_MUST_NOT_RUN");
});

test('cache reads reject writable parent directories and user-owned parent symlinks', () => {
  const { dir } = fixture();
  const parent = `${dir}-parent`; dirs.push(parent); mkdirSync(parent, { mode: 0o700 });
  const alias = join(parent, 'cache'); symlinkSync(dir, alias);
  expect(() => readRuntime(alias, { EXAMPLE_ENV: 'synthetic' })).toThrow();
  // Directly test the parent policy independently of leaf modes.
  const unsafe = join(parent, 'private'); mkdirSync(unsafe, { mode: 0o700 });
  for (const name of ['registry.json','secrets.env']) {
    writeFileSync(join(unsafe, name), readFileSync(join(dir, name)), { mode: 0o600 });
  }
  chmodSync(parent, 0o777);
  expect(() => readRuntime(unsafe, { EXAMPLE_ENV: 'synthetic' })).toThrow('parent');
});

test('runtime rejects a changed machine stamp independently of the config hash', () => {
  const {dir}=fixture();
  const file=join(dir,'secrets.env');
  writeFileSync(file,readFileSync(file,'utf8').replace('# machine: example-host','# machine: other-host'));
  expect(()=>readRuntime(dir,{EXAMPLE_ENV:'synthetic'})).toThrow('stale');
});
test('cache parent symlinks are refused even when the leaf is a real private directory', () => {
  const {dir}=fixture();
  const parent=dir+'-alias';dirs.push(parent);symlinkSync(scratch,parent);
  expect(()=>readRuntime(join(parent,dir.split('/').pop()!),{EXAMPLE_ENV:'synthetic'})).toThrow('parent');
});
test('cache ownership is enforced independently of mode and parent ownership', () => {
  const {dir}=fixture();
  const reader=join(import.meta.dir,'../repogolem/runtime-reader.ts');
  const program=`
    import {mock} from 'bun:test';
    const fs=await import('node:fs');
    const realLstat=fs.lstatSync;
    const leaf=process.argv[1]+'/secrets.env';
    mock.module('node:fs',()=>({...fs,lstatSync(path){
      const stat=realLstat(path);
      return path===leaf?new Proxy(stat,{get(target,key){
        if(key==='uid')return process.getuid()+1;
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }}):stat;
    }}));
    const {readRuntime}=await import(${JSON.stringify(reader)});
    try{readRuntime(process.argv[1],{EXAMPLE_ENV:'synthetic'});process.exit(41);}
    catch(error){if(!error.message.includes('owned'))throw error;}
  `;
  const result=Bun.spawnSync([process.execPath,'-e',program,dir],{stdout:'pipe',stderr:'pipe'});
  expect(result.stderr.toString()).toBe('');expect(result.exitCode).toBe(0);
});

test('transferred caches reject each stale stamp and every key-set mismatch',()=>{
  const {dir}=fixture();const path=join(dir,'secrets.env'),fresh=readFileSync(path,'utf8');
  expect(readTransferredSecrets(path,'fixture','example-host',[ref]).get(ref)).toBe("synthetic\nvalue'quoted");
  for(const [text,message] of [
    [fresh.replace('config-sha256: fixture','config-sha256: stale'),'stale'],
    [fresh.replace('machine: example-host','machine: other-host'),'stale'],
    [fresh.split('\n').filter(line=>!line.startsWith(key)).join('\n'),'references differ'],
    [fresh+`REPOGOLEM_SECRET_${'b'.repeat(32)}=$'extra'\n`,'references differ'],
  ]){
    writeFileSync(path,text);
    expect(()=>readTransferredSecrets(path,'fixture','example-host',[ref])).toThrow(message);
  }
});
test('duplicate cache assignments are rejected even when both values match',()=>{
  const text=`${key}=$'synthetic'\n${key}=$'synthetic'\n`;
  expect(()=>parseCache(text)).toThrow('invalid cached assignment');
});
